# -*- coding: utf-8 -*-
"""3.3.4: Real-Debrid as a source.

Real-Debrid does not search: it turns a torrent it already holds ("cached") into a fast direct HTTPS link. So:
  sources   - Torrentio (the Stremio torrent index) by IMDb id. With the user's key Torrentio also reports which
              torrents RD has cached ("[RD+]"); only those are listed - they start at once. Without sending the key
              (setting) every torrent is listed and the cache is checked when it is played.
            - the user's own RD cloud (torrents already in the account), matched by name.
  checks    - lighter than for Telegram (RD is reliable): no download test while searching. At play time the link
              is resolved; one that fails is skipped and the next source is tried (router.play).
  login     - RD's device flow for open-source apps (client id X245A4XAIBGVM): the user types a short code at
              real-debrid.com/device. A token pasted into the settings works too.
No Kodi module is imported here (tested outside Kodi). `store(key, value)` persists credentials.
"""
import re
import time

import requests

API = 'https://api.real-debrid.com/rest/1.0'
OAUTH = 'https://api.real-debrid.com/oauth/v2'
CLIENT = 'X245A4XAIBGVM'               # RD's client id for open-source apps (documented at api.real-debrid.com)
TORRENTIO = 'https://torrentio.strem.fun'
VIDEO = re.compile(r'\.(mkv|mp4|avi|m4v|ts|webm|mov|wmv|mpg|mpeg)$', re.I)
TRACKERS = ('udp://tracker.opentrackr.org:1337/announce', 'udp://open.stealth.si:80/announce',
            'udp://tracker.torrent.eu.org:451/announce')


class RDError(Exception):
    pass


def _size(text):
    m = re.search(r'(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)', text or '', re.I)
    if not m:
        return 0
    return int(float(m.group(1).replace(',', '.')) * {'TB': 1024 ** 4, 'GB': 1024 ** 3, 'MB': 1024 ** 2}[m.group(2).upper()])


class RealDebrid(object):
    def __init__(self, settings, store, log, timeout=12):
        self.s = settings
        self.store = store                      # store(key, value): writes an add-on setting
        self.log = log
        self.timeout = timeout
        self.http = requests.Session()
        self.http.headers['User-Agent'] = 'Kodi TeleNova'
        self._user = (0, None)

    # ------------------------------------------------------------------ account
    @property
    def token(self):
        return (self.s.get('rd_token') or '').strip()

    @property
    def enabled(self):
        return bool(self.s.get('rd_enabled', True) and self.token)

    def _refresh(self):
        cid, sec, ref = self.s.get('rd_client_id'), self.s.get('rd_client_secret'), self.s.get('rd_refresh')
        if not (cid and sec and ref):
            return False
        try:
            r = self.http.post(OAUTH + '/token', data={'client_id': cid, 'client_secret': sec, 'code': ref,
                                                        'grant_type': 'http://oauth.net/grant_type/device/1.0'},
                               timeout=self.timeout)
            data = r.json()
        except Exception as exc:
            self.log('rd: token refresh failed: %s' % exc)
            return False
        if not data.get('access_token'):
            return False
        self._save(token=data['access_token'], refresh=data.get('refresh_token') or ref)
        return True

    def _save(self, **kw):
        for k, v in kw.items():
            key = {'token': 'rd_token', 'refresh': 'rd_refresh', 'client_id': 'rd_client_id',
                   'client_secret': 'rd_client_secret'}[k]
            self.s[key] = v
            try:
                self.store(key, v)
            except Exception as exc:
                self.log('rd: saving %s failed: %s' % (key, exc))

    def api(self, method, path, data=None, retry=True):
        if not self.token:
            raise RDError('not_logged_in')
        try:
            r = self.http.request(method, API + path, data=data, timeout=self.timeout,
                                  headers={'Authorization': 'Bearer ' + self.token})
        except requests.RequestException as exc:
            raise RDError('network: %s' % exc)
        if r.status_code == 401 and retry and self._refresh():
            return self.api(method, path, data, False)
        if r.status_code in (401, 403):
            raise RDError('bad_token' if r.status_code == 401 else 'not_premium')
        if r.status_code >= 400:
            try:
                msg = r.json().get('error') or r.status_code
            except ValueError:
                msg = r.status_code
            raise RDError('rd %s: %s' % (path.split('/')[1] if '/' in path else path, msg))
        if r.status_code == 204 or not r.content:
            return {}
        try:
            return r.json()
        except ValueError:
            raise RDError('bad answer')

    def user(self, fresh=False):
        """-> {'username', 'premium' (bool), 'days' left} (cached 10 minutes)"""
        ts, val = self._user
        if not fresh and val and time.time() - ts < 600:
            return val
        u = self.api('GET', '/user')
        days = int((u.get('premium') or 0) // 86400)
        val = {'username': u.get('username') or '', 'premium': u.get('type') == 'premium', 'days': days,
               'expiration': u.get('expiration') or ''}
        self._user = (time.time(), val)
        return val

    def device_start(self):
        r = self.http.get(OAUTH + '/device/code', params={'client_id': CLIENT, 'new_credentials': 'yes'},
                          timeout=self.timeout).json()
        if not r.get('device_code'):
            raise RDError('device login not available')
        return {'device_code': r['device_code'], 'user_code': r['user_code'], 'interval': int(r.get('interval') or 5),
                'expires_in': int(r.get('expires_in') or 600), 'url': r.get('verification_url') or 'https://real-debrid.com/device'}

    def device_poll(self, device_code):
        """True once the user has approved (credentials + token stored), False while still waiting."""
        cred = self.http.get(OAUTH + '/device/credentials', params={'client_id': CLIENT, 'code': device_code},
                             timeout=self.timeout).json()
        if not cred.get('client_secret'):
            return False
        tok = self.http.post(OAUTH + '/token', data={'client_id': cred['client_id'], 'client_secret': cred['client_secret'],
                                                     'code': device_code,
                                                     'grant_type': 'http://oauth.net/grant_type/device/1.0'},
                             timeout=self.timeout).json()
        if not tok.get('access_token'):
            raise RDError('token refused')
        self._save(client_id=cred['client_id'], client_secret=cred['client_secret'], token=tok['access_token'],
                   refresh=tok.get('refresh_token') or '')
        self._user = (0, None)
        return True

    def logout(self):
        self._save(token='', refresh='', client_id='', client_secret='')
        self._user = (0, None)
        return True

    # ------------------------------------------------------------------ sources
    def _cand(self, i, fname, size, text, url=None, ref=None, cached=None, doc=None, title='Real-Debrid'):
        if not VIDEO.search(fname or ''):
            fname = (fname or 'video') + '.mkv'
        return {'chat_id': 0, 'msg_id': i, 'file': fname, 'size': int(size or 0), 'mime': 'video/x-matroska',
                'duration': 0, 'width': 0, 'height': 0, 'caption': text or '', 'chat_title': title, 'date': 0,
                'doc_id': doc or ('rd:%s' % (url or ref)), 'is_video_attr': True, 'backend': 'rd', 'url': url,
                'rd': ref, 'rd_cached': cached, 'chat_kind': 'rd'}

    def torrentio(self, kind, imdb, season=None, episode=None):
        """Torrents for an IMDb id. With the key: only those RD has cached, each with a ready RD link."""
        if not imdb:
            return []
        sid = '%s:%s:%s' % (imdb, int(season), int(episode)) if kind == 'episode' else imdb
        skind = 'series' if kind == 'episode' else 'movie'
        with_key = bool(self.s.get('rd_torrentio_key', True))
        base = (self.s.get('rd_torrentio') or TORRENTIO).rstrip('/')
        opts = ('realdebrid=%s' % self.token) if with_key else ''
        url = '%s/%s%sstream/%s/%s.json' % (base, opts, '/' if opts else '', skind, sid)
        try:
            data = self.http.get(url, timeout=self.timeout).json()
        except Exception as exc:
            self.log('rd: torrent index failed: %s' % type(exc).__name__)          # never the URL: it holds the key
            return []
        out, maybe = [], []
        for i, st in enumerate(data.get('streams') or []):
            name, title = st.get('name') or '', st.get('title') or st.get('description') or ''
            hints = st.get('behaviorHints') or {}
            fname = hints.get('filename') or title.split('\n')[0]
            size = hints.get('videoSize') or _size(title)
            if with_key:
                if '[RD+]' not in name or not (st.get('url') or '').startswith('http'):
                    # not cached at RD as far as the index knows: it would have to be downloaded first.
                    # 4.0.4: with StremThru switched on these are asked about once more, below
                    if st.get('infoHash'):
                        maybe.append((i, st.get('infoHash'), st.get('fileIdx'), fname, size, title))
                    continue
                out.append(self._cand(i, fname, size, title, url=st['url'], cached=True,
                                      doc='rd:%s:%s' % (st.get('infoHash') or st['url'], st.get('fileIdx'))))
            else:
                ih = st.get('infoHash')
                if not ih:
                    continue
                ref = {'hash': ih, 'idx': st.get('fileIdx'), 'name': fname}
                out.append(self._cand(i, fname, size, title, ref=ref, cached=None, doc='rd:%s:%s' % (ih, st.get('fileIdx'))))
        st_srv = getattr(self, 'st', None)
        if st_srv is not None and st_srv.enabled:
            try:
                if with_key and maybe:
                    known = st_srv.check([m[1] for m in maybe[:100]], sid=sid)
                    have = set(c['doc_id'] for c in out)
                    for i, ih, idx, fname, size, title in maybe[:100]:
                        doc = 'rd:%s:%s' % (ih, idx)
                        if (known.get(ih.lower()) or {}).get('cached') and doc not in have:
                            have.add(doc)
                            out.append(self._cand(i, fname, size, title, ref={'hash': ih, 'idx': idx, 'name': fname},
                                                  cached=True, doc=doc))
                elif not with_key and out:
                    known = st_srv.check([c['rd']['hash'] for c in out[:100]], sid=sid)
                    for c in out:
                        if (known.get(c['rd']['hash'].lower()) or {}).get('cached'):
                            c['rd_cached'] = True
            except Exception as exc:
                self.log('rd: stremthru check failed: %s' % type(exc).__name__)
        cap = int(self.s.get('rd_max', 40))
        return out[:cap * 2]

    def cloud(self, limit=100):
        """The account's own finished torrents (one candidate each; the file is chosen at play time)."""
        try:
            items = self.api('GET', '/torrents?limit=%d' % int(limit)) or []
        except RDError as exc:
            self.log('rd: cloud failed: %s' % exc)
            return []
        out = []
        for i, t in enumerate(items):
            if t.get('status') != 'downloaded' or not t.get('links'):
                continue
            out.append(self._cand(10000 + i, t.get('filename') or '', t.get('bytes'), t.get('filename') or '',
                                  ref={'torrent': t.get('id')}, cached=True, doc='rdc:%s' % t.get('id'),
                                  title='Real-Debrid Cloud'))
        return out

    def streams(self, kind, imdb, season=None, episode=None):
        out = []
        if self.s.get('rd_torrentio_on', True):
            out += self.torrentio(kind, imdb, season, episode)
        return self.alive(out)

    # ------------------------------------------------------------------ play
    @staticmethod
    def _pick(files, want):
        """files: [(id, path, bytes)] -> the file for the wanted episode, else the biggest video"""
        vids = [f for f in files if VIDEO.search(f[1] or '')] or files
        if want and want.get('episode') is not None:
            s, e = int(want.get('season') or 1), int(want['episode'])
            rx = re.compile(r'(?:s0*%d[ ._-]*e0*%d(?!\d))|(?:\b0*%dx0*%d(?!\d))' % (s, e, s, e), re.I)
            hit = [f for f in vids if rx.search(f[1] or '')]
            if hit:
                return max(hit, key=lambda f: f[2])
        return max(vids, key=lambda f: f[2]) if vids else None

    def unrestrict(self, link):
        r = self.api('POST', '/unrestrict/link', {'link': link})
        url = r.get('download')
        if not url:
            raise RDError('no link')
        return url

    # ------------------------------------------------------------------ 4.0.5: links that cannot be played
    # Real-Debrid refuses some files it holds ("infringing_file") and an index sometimes lists a torrent that is not
    # there any more. Such a link failed at play time and was offered again in the next search. It is remembered:
    # a refusal for 30 days, "not there" for 6 hours.
    DEAD_REFUSED, DEAD_GONE = 30 * 86400, 6 * 3600

    def _dead_load(self):
        if getattr(self, '_dead', None) is None:
            import json
            self._dead = {}
            path = self.s.get('rd_dead_file')
            try:
                if path:
                    with open(path, encoding='utf-8') as fh:
                        data = json.load(fh)
                    if isinstance(data, dict):
                        now = time.time()
                        self._dead = dict((k, v) for k, v in data.items()
                                          if isinstance(v, list) and len(v) == 2 and v[0] > now)
            except (OSError, ValueError):
                pass
        return self._dead

    def mark_dead(self, key, reason, seconds):
        import json
        dead = self._dead_load()
        dead[str(key)] =[int(time.time() + seconds), str(reason)[:60]]
        if len(dead) > 2000:                     # the oldest go first
            for k in sorted(dead, key=lambda k: dead[k][0])[:len(dead) - 2000]:
                dead.pop(k, None)
        path = self.s.get('rd_dead_file')
        if path:
            try:
                with open(path + '.tmp', 'w', encoding='utf-8') as fh:
                    json.dump(dead, fh)
                import os
                os.replace(path + '.tmp', path)
            except OSError as exc:
                self.log('rd: dead list not saved: %s' % type(exc).__name__)

    @staticmethod
    def link_key(cand):
        """One short name for a link, the same in the list and at play time. A hash, because a Torrentio link
        carries the account's key and must never be written to a file."""
        import hashlib
        ref = cand.get('rd') or {}
        raw = cand.get('url') or ('h:%s:%s' % (str(ref.get('hash')).lower(), ref.get('idx')) if ref.get('hash')
                                  else 't:%s' % ref.get('torrent') if ref.get('torrent') else '')
        return hashlib.sha1(raw.encode('utf-8')).hexdigest()[:20] if raw else ''

    def is_dead(self, key):
        v = self._dead_load().get(str(key))
        return bool(key and v and v[0] > time.time())

    def alive(self, cands):
        dead = self._dead_load()
        if not dead:
            return cands
        out = [c for c in cands if not self.is_dead(self.link_key(c))]
        if len(out) != len(cands):
            self.log('rd: %d link(s) left out - refused or gone when last played' % (len(cands) - len(out)))
        return out

    @staticmethod
    def dead_for(message):
        """how long a failure keeps a link out of the lists: seconds, or 0 for a failure that says nothing about
        the link itself (network, login, premium)"""
        m = (message or '').lower()
        if 'infring' in m or 'virus' in m:
            return RealDebrid.DEAD_REFUSED
        if any(x in m for x in ('not cached', 'no video in torrent', 'empty torrent', 'link refused', 'magnet_error',
                                'no link', 'unavailable_file', 'hoster_unavailable')):
            return RealDebrid.DEAD_GONE
        return 0

    def resolve(self, cand, want=None, wait=8.0):
        """A candidate -> a direct HTTPS link Kodi can play. Raises RDError (the caller tries the next source)."""
        try:
            return self._resolve(cand, want, wait)
        except RDError as exc:
            keep, key = self.dead_for(str(exc)), self.link_key(cand)
            if keep and key:
                self.mark_dead(key, str(exc), keep)
                self.log('rd: link remembered as unplayable for %d h: %s' % (keep // 3600, str(exc)[:40]))
            raise

    def _resolve(self, cand, want=None, wait=8.0):
        ref = cand.get('rd') or {}
        url = cand.get('url')
        if url:                                           # Torrentio link: it redirects to the RD download link
            try:
                r = self.http.get(url, allow_redirects=False, timeout=self.timeout, stream=True)
                r.close()
            except requests.RequestException as exc:
                raise RDError('network: %s' % type(exc).__name__)
            loc = r.headers.get('Location') or ''
            if r.status_code in (301, 302, 303, 307, 308) and loc.startswith('http') and 'failed' not in loc.lower():
                return loc
            if 'infring' in loc.lower():
                raise RDError('infringing_file')
            if r.status_code in (200, 206):
                return url
            raise RDError('link refused (%s)' % r.status_code)
        if ref.get('torrent'):                            # a torrent of the account
            info = self.api('GET', '/torrents/info/%s' % ref['torrent'])
            files = [(f['id'], f.get('path'), f.get('bytes') or 0) for f in info.get('files') or [] if f.get('selected')]
            links = info.get('links') or []
            chosen = self._pick(files, want)
            if not chosen or not links:
                raise RDError('empty torrent')
            pos = [f[0] for f in files].index(chosen[0]) if len(links) == len(files) else 0
            return self.unrestrict(links[min(pos, len(links) - 1)])
        if ref.get('hash'):                               # an index entry without the key: add, select, check cache
            magnet = 'magnet:?xt=urn:btih:%s&%s' % (ref['hash'], '&'.join('tr=' + t for t in TRACKERS))
            tid = self.api('POST', '/torrents/addMagnet', {'magnet': magnet}).get('id')
            if not tid:
                raise RDError('add failed')
            info = {}
            try:
                info = self.api('GET', '/torrents/info/%s' % tid)
                end = time.time() + 4
                while info.get('status') == 'magnet_conversion' and time.time() < end:
                    time.sleep(0.5)
                    info = self.api('GET', '/torrents/info/%s' % tid)
                files = [(f['id'], f.get('path'), f.get('bytes') or 0) for f in info.get('files') or []]
                idx = ref.get('idx')
                chosen = None
                if idx is not None and 0 <= int(idx) < len(files):
                    chosen = files[int(idx)]
                chosen = chosen or self._pick(files, want)
                if not chosen:
                    raise RDError('no video in torrent')
                self.api('POST', '/torrents/selectFiles/%s' % tid, {'files': str(chosen[0])})
                end = time.time() + wait
                while True:
                    info = self.api('GET', '/torrents/info/%s' % tid)
                    if info.get('status') == 'downloaded' and info.get('links'):
                        return self.unrestrict(info['links'][0])
                    if info.get('status') in ('error', 'magnet_error', 'virus', 'dead') or time.time() > end:
                        raise RDError('not cached at Real-Debrid')
                    time.sleep(0.7)
            except Exception:
                try:                              # nothing half-added stays in the account
                    if not (info.get('status') == 'downloaded'):
                        self.api('DELETE', '/torrents/delete/%s' % tid)
                except Exception:
                    pass
                raise
        raise RDError('nothing to play')
