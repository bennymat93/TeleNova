# -*- coding: utf-8 -*-
"""Source-finding pipeline (runs in the service).

 1. metadata + aliases (TMDB translations/alternative titles + optional Gemini expansion)
 2. query plan (per language / episode notation) -> parallel Telegram searches
 3. parse every hit, de-duplicate (same document forwarded to many chats)
 4. strict rule-based matching (matcher.evaluate)
 5. Gemini verification of the ambiguous ('maybe') hits (and optionally of all hits)
 6. live probe of the best candidates: first MiB downloaded, container magic checked,
    throughput measured against the file's bitrate -> broken / wrong / too-slow links dropped
 7. ranking (match confidence, quality, language preference, measured speed)
"""
import re
import time
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor, wait as fut_wait, FIRST_COMPLETED

import requests

from . import matcher
from .parser import parse, normalize

MAGIC = (
    (b'\x1a\x45\xdf\xa3', 'mkv/webm'),
    (b'RIFF', 'avi'),
    (b'\x00\x00\x01\xba', 'mpeg-ps'),
    (b'\x30\x26\xb2\x75', 'wmv'),
    (b'FLV', 'flv'),
)
BAD_MAGIC = (b'Rar!', b'PK\x03\x04', b'7z\xbc\xaf', b'%PDF', b'MZ')


def sniff(data):
    if not data or len(data) < 12:
        return None
    for sig in BAD_MAGIC:
        if data.startswith(sig):
            return None
    for sig, name in MAGIC:
        if data.startswith(sig):
            return name
    if data[4:8] in (b'ftyp', b'moov', b'mdat', b'free', b'wide', b'skip'):
        return 'mp4'
    if data[0:1] == b'\x47' and len(data) > 376 and data[188:189] == b'\x47' and data[376:377] == b'\x47':
        return 'mpeg-ts'
    return None


def http_head_bytes(url, timeout=12, size=1048576, timed=False):
    """Fetch the first MiB of an HTTP(S) stream (link check + speed probe).
    3.3: timed=True returns (data, seconds this request took) - the caller's clock also counted the queue."""
    t0 = time.time()
    r = requests.get(url, headers={'Range': 'bytes=0-%d' % (size - 1), 'User-Agent': 'Kodi TeleScope'},
                     stream=True, timeout=timeout)
    try:
        if r.status_code not in (200, 206):
            raise IOError('HTTP %s' % r.status_code)
        buf = b''
        for chunk in r.iter_content(65536):
            buf += chunk
            if len(buf) >= size:
                break
        return (buf[:size], time.time() - t0) if timed else buf[:size]
    finally:
        r.close()


class Job(object):
    def __init__(self):
        self.id = uuid.uuid4().hex[:12]
        self.progress = 0
        self.stage = ''
        self.done = False
        self.cancel = False
        self.result = None
        self.error = None
        self.created = time.time()
        self.stats = {}
        self.bots = []            # 3.3.3: (bot, answer) of every bot that finished

    def update(self, pct, stage):
        self.progress = int(pct)
        self.stage = stage

    def as_dict(self):
        return {'id': self.id, 'progress': self.progress, 'stage': self.stage, 'done': self.done,
                'error': self.error, 'result': self.result if self.done else None, 'stats': self.stats}


PROBE_BYTES = 131072          # link test sample: enough for the container signature and a speed reading
SPEED_SAMPLE_MIN = 512 * 1024  # 3.3: a smaller sample says nothing about throughput - no "slow" verdict from it


CHIKO_TAG = re.compile(u"\u05e6['\u05f3\u2019`]?\u05d9\u05e7\u05d5|chiko|chico", re.I)   # צ'יקו / ציקו


class Finder(object):
    _reduced = False              # 3.3: True on the clone that runs a search with per-request (reduced) options

    def __init__(self, tg, meta, ai, store, cache, settings, log, bridge=None, servers=None, rd=None):
        self.tg = tg
        self.meta = meta
        self.ai = ai
        self.store = store
        self.cache = cache
        self.s = settings
        self.log = log
        self.bridge = bridge
        self.servers = servers
        self.rd = rd                  # 3.3.4: Real-Debrid (realdebrid.RealDebrid) or None
        self.jobs = {}
        self._pool = ThreadPoolExecutor(max_workers=8)
        self._chiko = (0, {'tg': [], 'telemedia': []})
        self._bridge_ok = (0, False)
        self._bots_io = threading.Lock()

    # ------------------------------------------------------------------ backends
    def bridge_ok(self):
        if not self.bridge or not self.s.get('use_telemedia', True):
            return False
        ts, ok = self._bridge_ok
        if time.time() - ts > 60:
            ok = self.bridge.available()
            self._bridge_ok = (time.time(), ok)
        return ok

    def chiko_keywords(self):
        raw = self.s.get('chiko_keywords') or u"\u05e6'\u05d9\u05e7\u05d5,\u05e6\u05d9\u05e7\u05d5,chiko,chico"
        return [k.strip() for k in raw.split(',') if k.strip()]

    def _chiko_bg(self):
        try:
            self.chiko_chats(refresh=True)
        finally:
            self._chiko_busy = False

    def chiko_chats(self, refresh=False, background=False):
        """Chats (channels/groups) of Chiko Media that the user has joined, per back-end."""
        ts, val = self._chiko
        if not refresh and time.time() - ts < 6 * 3600:
            return val
        if not refresh:
            saved = self.cache.get('chiko_chats')
            if saved is not None:
                self._chiko = (time.time(), saved)
                return saved
            if background:                       # first search after install: do not wait for the dialog list
                if not getattr(self, '_chiko_busy', False):
                    self._chiko_busy = True
                    threading.Thread(target=self._chiko_bg, name='telescope-chiko', daemon=True).start()
                return val
        kws = [k.lower() for k in self.chiko_keywords()]
        res = {'tg': [], 'telemedia': []}
        if self.tg:
            try:
                for d in self.tg.run(self.tg.dialogs(500), 60):
                    if any(k in (d['title'] or '').lower() for k in kws) or CHIKO_TAG.search(d['title'] or ''):
                        res['tg'].append({'id': d['id'], 'title': d['title']})
            except Exception as exc:
                self.log('chiko dialogs failed: %s' % exc)
        if self.bridge_ok():
            try:
                res['telemedia'] = [c for c in self.bridge.find_chats(self.chiko_keywords())
                                    if any(k in (c['title'] or '').lower() for k in kws) or CHIKO_TAG.search(c['title'] or '')]
            except Exception as exc:
                self.log('chiko telemedia chats failed: %s' % exc)
        self._chiko = (time.time(), res)
        try:
            self.cache.set('chiko_chats', res, 6 * 3600)
        except Exception:
            pass
        return res

    def is_chiko(self, c, chiko):
        ids = set(x['id'] for x in chiko.get(c.get('backend') or 'tg', []))
        if c.get('chat_id') in ids:
            return True
        return bool(CHIKO_TAG.search(c.get('chat_title') or '') or CHIKO_TAG.search(c.get('caption') or ''))

    # ------------------------------------------------------------------ bots (3.3.3)
    # Which bots are asked for a title:
    #   - the bots written in the settings and the bots the user switched on in "My bots"  (always)
    #   - "auto": bots whose chat already holds a video - they have sent this account films before. A bot that
    #     never did (a bank, a game, an assistant) is never written to on the user's behalf.
    # A bot the user switched off is never asked. An auto bot that answered four requests with nothing rests a day.
    def _bots_load(self):
        path = self.s.get('bots_file')
        data = None
        if path:
            try:
                import io
                import json
                with io.open(path, 'r', encoding='utf-8') as fh:
                    data = json.load(fh)
            except (IOError, OSError, ValueError):
                data = None
        else:
            data = self.cache.get('bots:cfg')
        if not isinstance(data, dict):
            data = {}
        data.setdefault('cfg', {})
        data.setdefault('stats', {})
        return data

    def _bots_save(self, data):
        path = self.s.get('bots_file')
        try:
            if path:
                import io
                import json
                import os
                with self._bots_io:
                    with io.open(path + '.tmp', 'w', encoding='utf-8') as fh:
                        fh.write(json.dumps(data, ensure_ascii=False))
                    os.replace(path + '.tmp', path)
            else:
                self.cache.set('bots:cfg', data, 10 * 365 * 86400)
        except Exception as exc:
            self.log('bots: saving failed: %s' % exc)

    @staticmethod
    def _bot_key(bot):
        return str(bot).strip().lstrip('@').lower()

    def bot_mark(self, bot, on, title='', username='', bot_id=None):
        """on: True = always ask, False = never ask, None = forget the choice (automatic again)."""
        data = self._bots_load()
        keys = [self._bot_key(x) for x in (bot, username, bot_id) if x not in (None, '')]
        for k in keys:
            data['cfg'].pop(k, None)
        if on is not None and keys:
            main = self._bot_key(username) if username else keys[0]
            data['cfg'][main] = {'state': 'on' if on else 'off', 'title': title or '', 'username': username or '',
                                 'id': bot_id}
        self._bots_save(data)
        return True

    def _bot_state(self, cfg, username, bot_id):
        for k in (self._bot_key(username or ''), str(bot_id)):
            if k and k in cfg:
                return cfg[k].get('state') or ''
        return ''

    def _auto_bg(self):
        try:
            self.auto_bots(refresh=True)
        except Exception as exc:
            self.log('bots: scan failed: %s' % exc)
        finally:
            self._auto_busy = False

    def auto_bots(self, refresh=False, background=False):
        """Bots among the account's chats that have already sent it a video (cached for a day)."""
        from . import tgbots
        if not self.tg:
            return []
        if not refresh:
            saved = self.cache.get('bots:auto')
            if saved is not None:
                return saved
            if background:
                if not getattr(self, '_auto_busy', False):
                    self._auto_busy = True
                    threading.Thread(target=self._auto_bg, name='telescope-bots', daemon=True).start()
                return []
        bots = [d for d in self.tg.run(self.tg.dialogs(500), 60)
                if d.get('kind') == 'bot' and not tgbots.is_system_bot(d.get('username'))]
        good = set(self.tg.run(self.tg.bots_with_videos([b['id'] for b in bots]), 120)) if bots else set()
        res = [{'id': b['id'], 'username': b.get('username'), 'title': b['title']} for b in bots if b['id'] in good]
        self.cache.set('bots:auto', res, 86400)
        self.log('bots: %d bot chats, %d of them hold videos' % (len(bots), len(res)))
        return res

    def content_bots(self, limit=None, target=None):
        """The bots a search asks. 4.0.2, after looking at real bot chats: most bots that hold videos are not
        "type a title" bots. Many serve ONE series through a menu (their name is the series), others only send
        adverts. So with a target: a bot named after the wanted series comes first and is asked in its own words
        ("עונה 2 פרק 5"); a bot named after nothing we look for is asked only while it is new (two tries) or after
        it has brought files before; a bot that never brought anything rests for a month, not a day."""
        from . import tgbots
        if not self.tg or not self.s.get('bot_request', True):
            return []
        data = self._bots_load()
        cfg, stats = data['cfg'], data['stats']
        out, seen = [], set()

        def add(ref, title, why, bot_id=None):
            key = self._bot_key(ref)
            if not key or key in seen or (bot_id is not None and str(bot_id) in seen):
                return
            if tgbots.is_system_bot(key):
                return
            seen.add(key)
            if bot_id is not None:
                seen.add(str(bot_id))
            out.append({'ref': tgbots.ref(ref), 'title': title or str(ref), 'why': why, 'key': key})
        for name in self.s.get('bots') or []:
            if self._bot_state(cfg, name, None) != 'off':
                add(name, name, 'setting')
        for key, v in cfg.items():
            if v.get('state') == 'on':
                add(v.get('username') or v.get('id') or key, v.get('title'), 'marked', v.get('id'))
        if self.s.get('bot_auto', True):
            for b in self.auto_bots(background=True):
                if self._bot_state(cfg, b.get('username'), b['id']) == 'off':
                    continue
                add(b.get('username') or b['id'], b['title'], 'auto', b['id'])
        now = time.time()
        aliases = (target or {}).get('aliases') or []
        for b in out:
            b['series'] = bool(aliases) and self._bot_fits(b['title'], aliases)

        def resting(b):
            st = stats.get(b['key']) or {}
            if b['why'] != 'auto' or b['series']:
                return False
            if st.get('named'):
                return True                  # the bot of one series (it delivered when asked for it): not for others
            if st.get('hits'):
                return False
            return st.get('asked', 0) >= 2 and now - st.get('last', 0) < 30 * 86400
        out = [b for b in out if not resting(b)]
        out.sort(key=lambda b: (not b['series'], -(stats.get(b['key']) or {}).get('hits', 0)))
        return out[:int(limit or self.s.get('bot_max', 3))]

    @staticmethod
    def _bot_fits(title, aliases):
        """the bot is named after the wanted title ("על טבעי", "FBI Most Wanted - direct viewing ...")"""
        if matcher.contains_alias(title or '', aliases):
            return True
        nt = normalize(title or '')
        return len(nt) >= 4 and any(nt == normalize(a) for a in aliases)

    def bot_list(self):
        """For the "My bots" screen: every bot chat of the account + every bot the user chose, with its state."""
        from . import tgbots
        data = self._bots_load()
        cfg, stats = data['cfg'], data['stats']
        auto = set(b['id'] for b in self.auto_bots(background=True))
        listed = set(self._bot_key(x) for x in self.s.get('bots') or [])
        rows, seen = [], set()
        if self.tg:
            for d in self.tg.run(self.tg.dialogs(500), 60):
                if d.get('kind') != 'bot' or tgbots.is_system_bot(d.get('username')):
                    continue
                key = self._bot_key(d.get('username') or d['id'])
                seen.add(key)
                state = self._bot_state(cfg, d.get('username'), d['id'])
                if not state:
                    state = 'on' if key in listed else ('auto' if d['id'] in auto and self.s.get('bot_auto', True) else '')
                rows.append({'id': d['id'], 'username': d.get('username'), 'title': d['title'], 'state': state,
                             'inline': d.get('inline', False), 'stats': stats.get(key) or {}})
        for key, v in cfg.items():
            if key not in seen and v.get('state') == 'on':
                seen.add(key)
                rows.append({'id': v.get('id'), 'username': v.get('username') or key, 'title': v.get('title') or key,
                             'state': 'on', 'inline': False, 'stats': stats.get(key) or {}})
        for key in listed - seen:
            rows.append({'id': None, 'username': key, 'title': key, 'state': 'on', 'inline': False,
                         'stats': stats.get(key) or {}})
        order = {'on': 0, 'auto': 1, '': 2, 'off': 3}
        rows.sort(key=lambda r: (order.get(r['state'], 2), -(r['stats'].get('hits') or 0), r['title'].lower()))
        return rows

    def _bot_note(self, results):
        """Remembers how each bot did (asked / brought files) - good bots are asked first next time."""
        if not results:
            return
        data = self._bots_load()
        for key, res in results:
            st = data['stats'].setdefault(key, {'asked': 0, 'hits': 0, 'files': 0, 'last': 0})
            st['asked'] = st.get('asked', 0) + 1
            if res.get('files'):
                st['hits'] = st.get('hits', 0) + 1
                st['files'] = st.get('files', 0) + len(res['files'])
                if res.get('series'):
                    st['named'] = True       # it is named after a title and serves that title
            st['last'] = int(time.time())
            st['error'] = res.get('error') or ''
        self._bots_save(data)

    def bot_ask(self, bot, query, timeout=None):
        """One request typed by the user in "Ask a bot": the answer as listable rows + what the bot demanded."""
        from . import tgbots
        timeout = float(timeout or self.s.get('bot_timeout', 14)) + 4
        res = self.tg.run(self.tg.bot_ask(tgbots.ref(bot), [query], timeout=timeout, clicks=8,
                                          autojoin=self.s.get('bot_autojoin', False)), timeout + 20)
        key = self._bot_key((res.get('bot') or {}).get('username') or bot)
        self._bot_note([(key, res)])
        files = []
        for c in res['files']:
            c['parsed'] = parse(c['file'], c['caption'], c.get('chat_title', ''))
            c['ext'] = c['parsed']['ext']
            c['score'] = 0
            files.append(c)
        if files and self.s.get('probe', True):
            job = Job()
            files = self.probe(files, job)
            res['checks'] = job.stats.get('checks')
        return {'files': [self._public(c) for c in files], 'join': res.get('join') or [], 'notes': res.get('notes') or [],
                'answered': res.get('answered'), 'error': res.get('error'), 'bot': res.get('bot'),
                'took': res.get('took'), 'checks': res.get('checks')}

    def bot_queries(self, t, queries):
        """How a person would type the request: the plain title (with the episode for a series); a second wording
        in the other script (Hebrew / Russian next to Latin) for bots that index translated names."""
        first = queries[0] if queries else t['title']
        base = matcher.clean_query(t['aliases'][0] if t.get('aliases') else t['title']) or t['title']
        if t['kind'] == 'episode':
            first = '%s S%02dE%02d' % (base, int(t['season']), int(t['episode']))
        else:
            first = base

        def script(text):
            if any(u'֐' <= ch <= u'׿' for ch in text):
                return 'he'
            if any(u'Ѐ' <= ch <= u'ӿ' for ch in text):
                return 'ru'
            return 'la'
        out = [first]
        for q in queries:
            if script(q) != script(first):
                out.append(q)
                break
        else:
            if t['kind'] == 'episode':
                out.append(base)
            elif t.get('year'):
                out.append('%s %s' % (base, t['year']))
        return out

    def _button_rank(self, t):
        """How well a button text of a bot fits the wanted title: 0..1, or None for "a different film / episode"."""
        def rank(text):
            text = (text or '').strip()
            if not text:
                return 0.0
            p = parse(text, '', '')
            if p.get('is_trailer') or p.get('is_archive'):
                return None
            if t['kind'] == 'episode':
                if p.get('episode') is not None:
                    if p.get('episode_end'):
                        if not (p['episode'] <= int(t['episode']) <= p['episode_end']):
                            return None
                    elif int(p['episode']) != int(t['episode']):
                        return None
                if p.get('season') is not None and int(p['season']) != int(t['season']):
                    return None
                if p.get('season_hint') is not None and int(p['season_hint']) != int(t['season']):
                    return None
            else:
                if p.get('episode') is not None and p.get('season') is not None:
                    return None
                if t.get('year') and p.get('year') and abs(int(t['year']) - int(p['year'])) > 1:
                    return None
            sc, _ = matcher.best_title_score(p.get('titles') or [text], t['aliases'])
            if matcher.contains_alias(text, t['aliases']):
                sc = max(sc, 0.9)
            if t['kind'] == 'episode' and p.get('episode') is not None and sc < 0.5 and not normalize(p.get('title') or ''):
                # "S02E05 720p" under a message that names the series: the episode fits, the title is implied
                sc = 0.55
            return sc
        return rank

    def _ask_bot(self, bot, queries, rank, job):
        async def go():
            res = await self.tg.bot_ask(bot['ref'], queries, timeout=float(self.s.get('bot_timeout', 14)),
                                        clicks=int(self.s.get('bot_clicks', 5)), rank=rank,
                                        autojoin=self.s.get('bot_autojoin', False))
            res['series'] = bool(bot.get('series'))
            job.bots.append((bot, res))
            if bot.get('series'):
                # the bot of this very series answered this very request: its file needs no title in its name
                # (such bots send "video.mp4" without a caption). A name that says otherwise still rejects it.
                for c in res['files']:
                    c['trusted_id'] = True
            return res['files']
        return self.tg.submit(go())

    def _bots_report(self, job):
        """Statistics + what the plugin shows about the bots of this search."""
        rows, joins = [], []
        for bot, res in list(job.bots):
            rows.append({'bot': bot['title'], 'files': len(res['files']), 'error': res.get('error'),
                         'took': res.get('took'), 'join': res.get('join') or []})
            for link in res.get('join') or []:
                if link not in joins:
                    joins.append(link)
        try:
            self._bot_note([(bot['key'], res) for bot, res in list(job.bots)])
        except Exception as exc:
            self.log('bots: statistics failed: %s' % exc)
        if rows:
            self.log('bots: %s' % ', '.join('%s=%d%s' % (r['bot'], r['files'], (' (%s)' % r['error']) if r['error'] else '')
                                             for r in rows))
        return rows, joins

    # ------------------------------------------------------------------ jobs
    def start(self, target):
        job = Job()
        self.jobs[job.id] = job
        for k in [k for k, j in self.jobs.items() if time.time() - j.created > 3600]:
            self.jobs.pop(k, None)
        threading.Thread(target=self._run, args=(job, target), name='telescope-find', daemon=True).start()
        return job.id

    def _run(self, job, target):
        try:
            job.result = self.find(target, job)
        except Exception as exc:
            self.log('find failed: %r' % exc)
            job.error = '%s: %s' % (type(exc).__name__, exc)
        job.progress = 100
        job.done = True

    # ------------------------------------------------------------------ target
    def build_target(self, req, job):
        kind = 'episode' if req.get('type') == 'tv' else 'movie'
        mkind = 'tv' if kind == 'episode' else 'movie'
        ident = req.get('tmdb') or ('imdb:%s' % req['imdb'] if req.get('imdb') else None)
        if req.get('imdb') and not getattr(self.meta, 'has_tmdb', True):
            ident = 'imdb:%s' % req['imdb']          # 3.3.5: without a TMDb key a TMDb number means nothing
        try:
            details = self.meta.details(mkind, ident) if ident else None
        except Exception as exc:                     # 3.3.5: a metadata outage must not end the search
            self.log('metadata failed: %s' % exc)
            details = None
        aliases = list(req.get('aliases') or [])
        title = req.get('title') or ''
        year = req.get('year')
        runtime = 0
        total_seasons = 1
        if details:
            aliases = details.get('aliases', []) + aliases
            title = title or details['title']
            year = year or details.get('year')
            runtime = details.get('runtime') or 0
            total_seasons = details.get('total_seasons') or 1
        if not aliases:
            aliases = [title]
        if kind == 'episode' and req.get('episode_runtime'):
            runtime = req['episode_runtime']
        ai_fut = None
        if self.ai and self.ai.enabled and self.s.get('ai_aliases', True):
            ck = 'ai_alias:%s:%s' % (mkind, ident or title)
            extra = self.cache.get(ck)
            if extra is None:
                # 3.3.5: the question is asked in the background while Telegram is already being searched (every
                # search used to stand still for up to 6 s here - and for all of them when the model did not answer)
                ai_fut = self._pool.submit(self._ai_aliases, ck, title,
                                           details.get('original_title') if details else title, year,
                                           'TV series' if kind == 'episode' else 'movie', list(aliases))
            else:
                aliases += extra
        seen, uniq = set(), []
        for a in aliases:
            n = normalize(a)
            if n and n not in seen and len(n) >= 2:
                seen.add(n)
                uniq.append(a)
        imdb = req.get('imdb') or (details.get('imdb') if details else None)
        return {'kind': kind, 'title': title, 'aliases': uniq, 'year': year, 'runtime': runtime, 'imdb': imdb,
                'season': req.get('season'), 'episode': req.get('episode'), 'total_seasons': total_seasons,
                'ident': ident, '_ai': ai_fut}

    def _ai_aliases(self, ck, title, original, year, kind, known):
        """Runs in the pool. The answer is kept for 30 days even when the search that asked did not wait for it."""
        try:
            extra = self.ai.aliases(title, original, year, kind, known, timeout=8)
            self.cache.set(ck, extra, 30 * 86400)
            return extra
        except Exception as exc:
            self.log('AI aliases failed: %s' % exc)
            return []

    # ------------------------------------------------------------------ 3.3.5: the chats that hold the files
    def library_chats(self, n=6):
        """Chats that gave accepted files in earlier searches, best first."""
        try:
            data = self.cache.get('lib:chats') or {}
            rows = sorted(data.items(), key=lambda kv: -kv[1])
            return [int(k) for k, v in rows[:n] if v >= 1]
        except Exception:
            return []

    def _learn_chats(self, accepted):
        try:
            data = dict(self.cache.get('lib:chats') or {})
            data = {k: v * 0.97 for k, v in data.items()}
            seen = {}
            for c in accepted:
                if (c.get('backend') or 'tg') == 'tg' and c.get('chat_id') and c.get('chat_kind') in ('channel', 'group', 'bot'):
                    seen[str(c['chat_id'])] = seen.get(str(c['chat_id']), 0) + 1
            for k, v in seen.items():
                data[k] = data.get(k, 0) + min(v, 20)
            data = dict(sorted(data.items(), key=lambda kv: -kv[1])[:60])
            self.cache.set('lib:chats', data, 180 * 86400)
        except Exception as exc:
            self.log('library chats: %s' % exc)

    def deep_queries(self, t, queries):
        """What is asked INSIDE a chat: for an episode the wordings that name the episode, for a movie its names."""
        if t['kind'] == 'movie':
            return queries[:3]
        marked = [q for q in queries if re.search(r'S\d+E\d+|פרק \d+|\d+ серия|ע\d+ פ\d+|\b\d+x\d+\b', q)]
        return (marked or queries)[:4]

    def _deep(self, raw, t, queries, searched, job, is_good):
        """Telegram's search over all chats returns the newest hits only: a chat that holds 200 files of a series
        gives 3 of them. The chats that showed files for this very title (and the ones that proved themselves in
        earlier searches) are therefore searched once more from the inside, where the search is complete."""
        hits = {}
        for c in raw:
            if (c.get('backend') or 'tg') != 'tg' or not c.get('chat_id') or c.get('chat_kind') not in ('channel', 'group', 'bot'):
                continue
            hits[c['chat_id']] = hits.get(c['chat_id'], 0) + 1
        ranked = [k for k, _ in sorted(hits.items(), key=lambda kv: -kv[1])]
        for k in self.library_chats():
            if k not in ranked:
                ranked.append(k)
        chats = [k for k in ranked if k not in searched][:int(self.s.get('deep_chats', 6))]
        dq = self.deep_queries(t, queries)
        if not chats or not dq:
            return []
        limit = int(self.s.get('search_limit', 100))
        futs = [self.tg.submit(self.tg.search_in(chat, q, limit)) for chat in chats for q in dq]
        t0 = time.time()
        deadline = t0 + float(self.s.get('deep_timeout', 5))
        out, pending, n = [], set(futs), 0
        while pending and time.time() < deadline and not job.cancel:
            done, pending = fut_wait(pending, timeout=0.25)
            for f in done:
                n += 1
                try:
                    out.extend(f.result())
                except Exception as exc:
                    self.log('deep search failed: %s' % exc)
            job.update(50, 'telegram_search')
        for f in pending:
            f.cancel()
        self.log('deep search: %d chats x %d queries, %d/%d answered, %d files in %.1fs' % (
            len(chats), len(dq), n, len(futs), len(out), time.time() - t0))
        job.deep = {'chats': len(chats), 'files': len(out), 'seconds': round(time.time() - t0, 1)}
        return out

    def plan_queries(self, t):
        names = []
        for a in t['aliases']:
            q = matcher.clean_query(a)
            if q and normalize(q) not in [normalize(x) for x in names]:
                names.append(q)
        names = names[:int(self.s.get('max_aliases', 4))]
        queries = []
        if t['kind'] == 'movie':
            queries = list(names)
        else:
            s, e = int(t['season']), int(t['episode'])
            later = []
            for n in names:
                queries.append(n)
                heb = any(u'֐' <= ch <= u'׿' for ch in n)
                cyr = any(u'Ѐ' <= ch <= u'ӿ' for ch in n)
                if heb:
                    queries.append(u'%s פרק %d' % (n, e))              # <name> פרק e
                    # 3.3.5: the other ways Hebrew uploads name an episode - the Latin marker after the Hebrew
                    # name, and the short "ע1 פ3". (Telegram matches whole words by their beginning, so "פרק 3"
                    # never finds a file that says "פ3" or "S01E03".)
                    later.append(u'%s S%02dE%02d' % (n, s, e))
                    later.append(u'%s ע%d פ%d' % (n, s, e))
                elif cyr:
                    queries.append(u'%s %d серия' % (n, e))  # <name> e серия
                    later.append(u'%s S%02dE%02d' % (n, s, e))
                else:
                    queries.append('%s S%02dE%02d' % (n, s, e))
                    later.append('%s %dx%02d' % (n, s, e))
            queries += later
        out, seen = [], set()
        for q in queries:
            k = q.lower()
            if k not in seen:
                seen.add(k)
                out.append(q)
        return out[:max(int(self.s.get('max_queries', 6)), 8 if t['kind'] != 'movie' else 0)]

    # ------------------------------------------------------------------ main
    def find(self, req, job):
        if req.get('opts'):                      # per-request overrides (embedded / fast searches)
            import copy
            clone = copy.copy(self)
            clone.s = dict(self.s, **req['opts'])
            clone._reduced = True
            req = dict(req)
            req.pop('opts')
            return clone.find(req, job)
        if req.get('type') == 'free':            # 3.3.3: free-text file search runs as a job too (progress, link tests)
            return self.find_free(req, job)
        logged_in = bool(self.tg and getattr(self.tg, 'me', None))
        rd_on = bool(self.rd and self.rd.enabled)
        # 3.3.5: the key says which sources were available - a list made while Telegram was not connected (Real-
        # Debrid only) used to be served for half an hour after the login
        cache_key = 'src:%s:%s:%s:%s:%s' % (req.get('type'), req.get('tmdb') or req.get('imdb') or req.get('title'),
                                             req.get('season'), req.get('episode'),
                                             ('t' if logged_in else '') + ('r' if rd_on else ''))
        # 3.3: a reduced ("fast" hub) search stores its shorter list under its own key - it used to replace the
        # full result for 30 minutes. It may still read a full result that is already there.
        store_key = cache_key + ':fast' if self._reduced else cache_key
        if not req.get('refresh'):
            hit = self.cache.get(cache_key) or (self.cache.get(store_key) if self._reduced else None)
            if hit:
                job.update(100, 'cached')
                return hit
        job.update(3, 'metadata')
        t = self.build_target(req, job)
        queries = self.plan_queries(t)
        self.log('queries: %s' % queries)
        chats = self._pinned()
        chiko = self.chiko_chats(background=True) if self.s.get('chiko', True) else {'tg': [], 'telemedia': []}
        # 3.3.5: pinned chats, then the chats that proved themselves in earlier searches, then the "chiko" ones
        tg_chats = chats + [c for c in self.library_chats() if c not in chats]
        tg_chats += [c['id'] for c in chiko['tg'] if c['id'] not in tg_chats]
        tm_chats = [c['id'] for c in chiko['telemedia']]
        # 3.3.3: the chats of the content bots are searched by name as well - what a bot sent last week is there
        bots = self.content_bots(target=t) if logged_in else []
        tg_chats += [b['ref'] for b in bots if b['ref'] not in tg_chats]

        job.update(15, 'telegram_search')
        raw = []
        limit = int(self.s.get('search_limit', 100))
        futs = []
        if self.tg and not self.bridge_ok() and not (self.servers and self.servers.enabled and t.get('imdb')) \
                and not rd_on and self._tg_authorized() is False:
            # 3.3: every query of a logged-out client fails quietly and the user was told to "join channels"
            raise RuntimeError('not_authorized')
        if self.tg:
            futs += [self.tg.submit(self.tg.search(q, limit=limit, chats=tg_chats[:8] if i < 2 else None))
                     for i, q in enumerate(queries)]
        if self.bridge_ok():
            futs += [self._pool.submit(self.bridge.search, q, limit, tm_chats[:6] if i < 2 else None)
                     for i, q in enumerate(queries)]
        if self.servers and self.servers.enabled and t.get('imdb'):
            futs.append(self._pool.submit(self.servers.streams, t['kind'], t['imdb'], t.get('season'), t.get('episode')))
        if rd_on:                     # 3.3.4: Real-Debrid - cached torrents by IMDb id + the account's own cloud
            if t.get('imdb'):
                futs.append(self._pool.submit(self.rd.streams, t['kind'], t['imdb'], t.get('season'), t.get('episode')))
            if self.s.get('rd_cloud', True):
                futs.append(self._pool.submit(self.rd.cloud))
        if not futs:
            raise RuntimeError('no_backend')
        # 3.3.5: the AI's extra names arrive while the first queries are already running; they are waited for at
        # most 3 s (never when they are cached), and searched as soon as they are there
        ai_fut = t.pop('_ai', None)
        if ai_fut is not None:
            job.update(15, 'ai_aliases')
            try:
                extra = ai_fut.result(timeout=float(self.s.get('ai_alias_wait', 3)))
            except Exception:
                extra = []
            known = set(normalize(a) for a in t['aliases'])
            new = [a for a in extra if normalize(a) and normalize(a) not in known]
            if new:
                t['aliases'] += new
                more = [q for q in self.plan_queries(t) if q not in queries]
                if self.tg:
                    futs += [self.tg.submit(self.tg.search(q, limit=limit)) for q in more]
                if self.bridge_ok():
                    futs += [self._pool.submit(self.bridge.search, q, limit, None) for q in more]
                queries += more
            job.update(15, 'telegram_search')
        # 3.3.3: bots that hand out files on request are asked while the searches run
        bot_futs = set()
        if bots and self.s.get('bot_request', True):
            bq = self.bot_queries(t, queries)
            rank = self._button_rank(t)
            for b in bots:
                own = bq
                if b.get('series') and t['kind'] == 'episode':
                    # a one-series bot does not read titles: its menu speaks of seasons and episodes
                    own = [u'\u05e2\u05d5\u05e0\u05d4 %d \u05e4\u05e8\u05e7 %d' % (int(t['season']), int(t['episode']))] + bq[:1]
                bot_futs.add(self._ask_bot(b, own, rank, job))
            futs += list(bot_futs)
            self.log('bots asked: %s -> %s' % ([b['title'] for b in bots], bq))
        strict = self.s.get('strict', True)

        def is_good(c):
            c['parsed'] = parse(c['file'], c['caption'], c.get('chat_title', ''))
            c['ext'] = c['parsed']['ext']
            return matcher.evaluate(c, t, strict=strict)[0] == 'accept'
        raw, done_n, total, took = self._collect(futs, bot_futs, job, is_good)
        self.log('search: %d/%d queries, %d files in %.1fs' % (done_n, total, len(raw), took))
        if self.tg and logged_in and not job.cancel and self.s.get('deep_search', True):
            try:
                raw += self._deep(raw, t, queries, set(tg_chats[:8]), job, is_good)
            except Exception as exc:
                self.log('deep search: %r' % exc)
        bot_rows, bot_join = self._bots_report(job)
        if job.cancel:
            return []

        # ---- de-duplicate
        job.update(52, 'matching')
        by_doc, cands, seen_msg = {}, [], set()
        for c in raw:
            mk = (c['chat_id'], c['msg_id'])
            if c.get('url') and not c.get('chat_id'):
                # 3.3: server results have no chat (chat 0, message = position in that server's list): the same
                # position on a second server is another file
                mk = (c.get('backend'), c['url'])
            if mk in seen_msg:
                continue
            seen_msg.add(mk)
            key = c.get('doc_id') or mk
            if key in by_doc:
                by_doc[key].setdefault('mirrors', []).append([c['chat_id'], c['msg_id']])
                continue
            by_doc[key] = c
            cands.append(c)

        accepted, maybe = [], []
        for c in cands:
            c['parsed'] = parse(c['file'], c['caption'], c.get('chat_title', ''))
            c['ext'] = c['parsed']['ext']
            verdict, score, why = matcher.evaluate(c, t, strict=strict)
            if c.get('trusted_id') and verdict != 'accept' and not self._conflicts(c['parsed'], t, c):
                verdict, score, why = 'accept', max(score, 45.0), why + ['matched by IMDb id on server']
            if c.get('backend') == 'rd' and not (c.get('rd') or {}).get('torrent') and verdict != 'accept' \
                    and not self._conflicts(c['parsed'], t, c):
                # 3.3.4: lighter rules for Real-Debrid - the index answered for this IMDb id (and episode)
                verdict, score, why = 'accept', max(score, 45.0), why + ['Real-Debrid index, IMDb id']
            c['chiko'] = self.is_chiko(c, chiko)
            if c['chiko'] and verdict != 'reject':
                score += float(self.s.get('chiko_boost', 15))
            c['score'], c['why'], c['verdict'] = score, why, verdict
            if verdict == 'accept':
                accepted.append(c)
            elif verdict == 'maybe':
                maybe.append(c)
        self.log('candidates: %d raw, %d unique, %d accepted, %d maybe' % (len(raw), len(cands), len(accepted), len(maybe)))
        job.stats = {'raw': len(raw), 'unique': len(cands), 'accepted': len(accepted), 'maybe': len(maybe),
                     'queries': len(queries), 'bots': bot_rows, 'bot_join': bot_join,
                     'deep': getattr(job, 'deep', None)}

        # ---- AI verification
        use_ai = self.ai and self.ai.enabled and self.s.get('ai_verify', True)
        if use_ai and not self.ai.healthy():
            use_ai = False            # 3.3.5: no model answers right now - the search does not wait for one
        if use_ai and (maybe or (accepted and self.s.get('ai_verify_all', False))):
            job.update(60, 'ai_verify')
            pool = sorted(maybe, key=lambda c: -c['score'])[:40]
            if self.s.get('ai_verify_all', False):
                pool += sorted(accepted, key=lambda c: -c['score'])[:30]
            try:
                verdicts = self.ai.verify(t, [self._ai_row(i, c) for i, c in enumerate(pool)], timeout=6)
                for i, c in enumerate(pool):
                    v = verdicts.get(str(i))
                    if not v:
                        continue
                    c['ai'] = v
                    if v['match'] and v['confidence'] >= 0.6:
                        c['score'] += 8 * v['confidence']
                        if c in maybe:
                            maybe.remove(c)
                            accepted.append(c)
                            c['verdict'] = 'accept'
                    elif not v['match'] and v['confidence'] >= 0.7 and c in accepted:
                        accepted.remove(c)
                        c['verdict'] = 'reject'
            except Exception as exc:
                self.log('AI verify failed: %s' % exc)
        if not strict:
            accepted += [c for c in maybe if c['score'] >= 35]
        elif not accepted and maybe:
            # 3.1: nothing passed the strict rules - list the close matches (right episode / year, title a little
            # different), marked as unverified, the way Telemedia lists every link it finds
            for c in maybe:
                c['loose'] = True
            accepted = sorted([c for c in maybe if c['score'] >= 30], key=lambda c: -c['score'])[:15]

        # ---- language preference
        pref = self.s.get('lang_pref', 'any')
        for c in accepted:
            langs = set(c['parsed']['langs'])
            ai = c.get('ai') or {}
            if ai.get('audio') == 'he':
                langs.add('he_dub')
            if ai.get('subs') == 'he':
                langs.add('he_sub')
            if ai.get('audio') == 'ru':
                langs.add('ru_audio')
            c['langs'] = sorted(langs)
            c['score'] += matcher.language_bonus(langs, pref)
            if self.s.get('hide_cam', True) and c['parsed'].get('source') == 'cam':
                c['score'] = -1
        accepted = [c for c in accepted if c['score'] >= 0]
        min_q = int(self.s.get('min_quality', 0))
        if min_q:
            accepted = [c for c in accepted if (c['parsed']['quality'] or 0) >= min_q or not c['parsed']['quality']]
        accepted.sort(key=lambda c: -c['score'])
        if not self._reduced:
            self._learn_chats(accepted)
        # 4.0.2: a file whose data rate is above what its source can deliver cannot play without stalls - it is not
        # listed at all (before the link test by the title's runtime, after it by the file's real length)
        accepted, heavy = self.playable(accepted, (t.get('runtime') or 0) * 60)

        # ---- probe
        if self.s.get('probe', True) and accepted:
            job.update(70, 'probe')
            accepted = self.probe(accepted, job, t)
        accepted, heavy2 = self.playable(accepted, (t.get('runtime') or 0) * 60)
        if heavy or heavy2:
            job.stats = dict(job.stats or {}, too_heavy=heavy + heavy2)
            self.log('%d source(s) left out: data rate above what the source can deliver' % (heavy + heavy2))
        result = [self._public(c) for c in self.order_groups(accepted)]
        if result:
            self.cache.set(store_key, result, 1800)
        job.update(100, 'done')
        return result

    def rate_caps(self):
        """bytes per second a file may need: (Telegram, everything else); 0 = no limit.
        Telegram: four fifths of what the account is being served (4.5 MB/s for a non-Premium account, measured;
        less after flood waits) - about 29 Mbit/s. Others (Real-Debrid ...): the "max_mbit" setting."""
        other = int(self.s.get('max_mbit', 40) or 0) * 125000
        tg = 0
        try:
            rate = self.tg.sustained_rate() if self.tg else 0
            tg = int(rate * 0.8) if rate else 0
        except Exception:
            tg = int(4.5 * 1048576 * 0.8)
        if other and tg:
            tg = min(tg, other)
        return tg or other, other

    def playable(self, cands, runtime):
        tg_cap, other_cap = self.rate_caps()
        keep, dropped = [], 0
        for c in cands:
            cap = tg_cap if (c.get('backend') or 'tg') in ('tg', 'telemedia') else other_cap
            dur = c.get('duration') or runtime
            if cap and dur and c.get('size') and c['size'] / float(dur) > cap:
                dropped += 1
                continue
            keep.append(c)
        return keep, dropped

    def _pinned(self):
        """Pinned chats of the settings: numeric ids, and - 3.3.3 - @names / t.me links of public channels, which
        are searched without joining them."""
        from . import tgbots
        out = []
        for c in self.s.get('pinned_chats', []):
            r = tgbots.ref(c)
            if r != '' and r not in out:
                out.append(r)
        return out

    def _collect(self, futs, bot_futs, job, is_good):
        """Waits for the searches (search_timeout) and the bots (bot_timeout); stops early when enough files really
        match. -> (raw candidates, finished, total, seconds)"""
        raw, done_n, total = [], 0, len(futs)
        t0 = time.time()
        deadline = t0 + float(self.s.get('search_timeout', 12))
        bot_deadline = t0 + float(self.s.get('bot_timeout', 14)) + 1.5
        pending = set(futs)
        checked, good = 0, 0
        while pending and not job.cancel:
            now = time.time()
            bots_left = any(f in bot_futs for f in pending)
            if now >= (max(deadline, bot_deadline) if bots_left else deadline):
                break
            done, pending = fut_wait(pending, timeout=0.25)
            for f in done:
                done_n += 1
                try:
                    raw.extend(f.result())
                except Exception as exc:
                    self.log('query failed: %s' % exc)
            job.update(15 + 35 * done_n / max(1, total), 'telegram_search')
            if not pending or not done:
                continue
            for c in raw[checked:]:
                try:
                    if is_good(c):
                        good += 1
                except Exception:
                    pass
            checked = len(raw)
            elapsed = time.time() - t0
            bots_left = any(f in bot_futs for f in pending)
            if bots_left:
                # a bot is still typing: worth waiting for, unless there is already plenty to choose from
                if good >= 8 and elapsed > 3:
                    break
                if not any(f not in bot_futs for f in pending) and good >= 5 and elapsed > 8:
                    break
            elif done_n * 2 >= total and len(raw) >= 30 and elapsed > 3 and good >= 5:
                # 3.3: "plenty of files" is not enough - 30 wrong files used to cancel the Hebrew / Russian alias
                # queries that were still running. Stragglers are dropped only when 5 files really match.
                break
        for f in pending:
            f.cancel()
        return raw, done_n, total, time.time() - t0

    # ------------------------------------------------------------------ free-text search (3.3.3)
    def find_free(self, req, job):
        """"Search Telegram files directly": the text is searched in every chat (bot chats and pinned public
        channels included), the content bots are asked for it, the hits are cleaned (videos only, one row per
        file), ordered by how well the name fits, and every listed link is tested."""
        from .parser import find_se, title_part
        q = (req.get('query') or '').strip()
        if not q:
            return []
        key = 'free:%s' % q.lower()
        if not req.get('refresh'):
            hit = self.cache.get(key)
            if hit:
                job.update(100, 'cached')
                return hit
        job.update(10, 'telegram_search')
        limit = int(self.s.get('search_limit', 100))
        logged_in = bool(self.tg and getattr(self.tg, 'me', None))
        bots = self.content_bots(target={'aliases': [q]}) if logged_in else []
        futs, bot_futs = [], set()
        if self.tg and (logged_in or not self.bridge_ok()):
            if not logged_in and self._tg_authorized() is False:
                raise RuntimeError('not_authorized')
            chats = (self._pinned() + [b['ref'] for b in bots])[:8]
            futs.append(self.tg.submit(self.tg.search(q, limit=limit, chats=chats)))
        if self.bridge_ok():
            futs.append(self._pool.submit(self.bridge.search, q, limit))
        if self.rd and self.rd.enabled and self.s.get('rd_cloud', True):
            futs.append(self._pool.submit(self.rd.cloud))
        if not futs:
            raise RuntimeError('no_backend')
        s_, e_, _ = find_se(q)
        name = (title_part(q) or q) if e_ is not None else q
        want = [name]

        def relevance(c):
            p = c['parsed']
            sc, _ = matcher.best_title_score(p.get('titles') or [], want)
            if matcher.contains_alias((c.get('file') or '') + ' ' + (c.get('caption') or ''), want):
                sc = max(sc, 0.85)
            return sc

        def is_good(c):
            c['parsed'] = parse(c['file'], c['caption'], c.get('chat_title', ''))
            c['ext'] = c['parsed']['ext']
            return matcher.is_video_file(c) and relevance(c) >= 0.8

        def rank(text):
            p = parse(text or '', '', '')
            if e_ is not None and p.get('episode') is not None and int(p['episode']) != int(e_):
                return None
            if s_ is not None and p.get('season') is not None and int(p['season']) != int(s_):
                return None
            sc, _ = matcher.best_title_score(p.get('titles') or [text or ''], want)
            return max(sc, 0.9) if matcher.contains_alias(text or '', want) else sc
        if bots and self.s.get('bot_request', True):
            for b in bots:
                bot_futs.add(self._ask_bot(b, [q], rank, job))
            futs += list(bot_futs)
        raw, done_n, total, took = self._collect(futs, bot_futs, job, is_good)
        bot_rows, bot_join = self._bots_report(job)
        if job.cancel:
            return []
        job.update(52, 'matching')
        rows, seen = [], set()
        for c in raw:
            keyc = c.get('doc_id') or (c.get('chat_id'), c.get('msg_id'), c.get('url'))
            if keyc in seen:
                continue
            seen.add(keyc)
            if 'parsed' not in c:
                c['parsed'] = parse(c['file'], c['caption'], c.get('chat_title', ''))
                c['ext'] = c['parsed']['ext']
            p = c['parsed']
            if p.get('is_archive') or not matcher.is_video_file(c) or (c.get('size') or 0) < 5 * 1024 * 1024:
                continue
            if e_ is not None and p.get('episode') is not None and int(p['episode']) != int(e_):
                continue
            if s_ is not None and p.get('season') is not None and int(p['season']) != int(s_):
                continue
            rel = relevance(c)
            c['why'] = ['title %.2f' % rel]
            c['score'] = rel * 50.0 + {2160: 12, 1080: 10, 720: 6, 480: 2}.get(p.get('quality') or 0, 3)
            if p.get('is_trailer'):
                c['score'] -= 20
            c['langs'] = p.get('langs')
            c['loose'] = rel < 0.6
            rows.append(c)
        rows.sort(key=lambda c: -c['score'])
        job.stats = {'raw': len(raw), 'unique': len(rows), 'accepted': len(rows), 'maybe': 0, 'queries': 1,
                     'bots': bot_rows, 'bot_join': bot_join}
        self.log('free search %r: %d raw, %d listed in %.1fs' % (q, len(raw), len(rows), took))
        if self.s.get('probe', True) and rows:
            job.update(70, 'probe')
            rows = self.probe(rows, job)
        result = [self._public(c) for c in self.order_groups(rows, max(40, int(self.s.get('max_results', 25))))]
        if result:
            self.cache.set(key, result, 900)
        job.update(100, 'done')
        return result

    def _tg_authorized(self):
        """True / False, or None when it cannot be told right now (no connection)."""
        if getattr(self.tg, 'me', None):
            return True
        try:
            st = self.tg.run(self.tg.status(), 10)
            return bool(st.get('authorized')) if st.get('connected') else None
        except Exception:
            return None

    @staticmethod
    def _conflicts(p, t, c):
        """True when the parsed name contradicts the target (used for server results matched by id)."""
        if p.get('is_archive') or p.get('is_trailer'):
            return True
        if t['kind'] == 'episode':
            if p.get('episode') is not None and not p.get('episode_end') and int(p['episode']) != int(t['episode']):
                return True
            if p.get('episode_end') and not (p['episode'] <= int(t['episode']) <= p['episode_end']):
                return True
            if p.get('season') is not None and int(p['season']) != int(t['season']):
                return True
        else:
            if p.get('episode') is not None and p.get('season') is not None:
                return True
            if t.get('year') and p.get('year') and abs(int(t['year']) - int(p['year'])) > 1:
                return True
        return False

    @staticmethod
    def _ai_row(i, c):
        return {'id': str(i), 'file': c['file'][:180], 'caption': (c.get('caption') or '')[:300],
                'chat': (c.get('chat_title') or '')[:80], 'duration_min': round((c.get('duration') or 0) / 60.0, 1),
                'size_mb': int((c.get('size') or 0) / 1048576)}

    def probe(self, cands, job, target=None):
        """Link test. 3.3.3:
         - EVERY link that will be listed is tested (it was the first probe_count only), all at once - a test is
           one 128 KiB request, the shared pacing gate of the client keeps Telegram's limits;
         - a dead link whose file also sits in another chat (a mirror) is replaced by that copy and tested again;
         - the sample is read as a media header (mediainfo): real duration, picture size, audio / subtitle
           languages. A "movie" that is 4 minutes long is dropped, embedded Hebrew subtitles are marked as
           certain, and a file whose own title names another episode is moved down and marked."""
        from . import mediainfo
        shown = int(self.s.get('max_results', 25))
        n = min(len(cands), max(shown, 5), 40) if self.s.get('probe_all', True) else int(self.s.get('probe_count', 10))
        timeout = float(self.s.get('probe_timeout', 12))
        rd = [c for c in cands if c.get('backend') == 'rd']
        for c in rd:
            c['probe'] = 'rd'                     # 3.3.4: cached at Real-Debrid; checked when played
            c['score'] += 5
        cands = [c for c in cands if c.get('backend') != 'rd']
        head, tail = cands[:n], cands[n:]
        futs = {}
        t0 = time.time()

        def submit(c):
            if c.get('url'):
                return self._pool.submit(http_head_bytes, c['url'], timeout, 1048576, True)
            if self.tg:
                return self.tg.submit(self.tg.read_head(c['chat_id'], c['msg_id'], PROBE_BYTES, True))
            return None
        for c in head:
            fut = submit(c)
            if fut is not None:
                futs[fut] = (c, time.time())
        ok, pending = [], set(futs)
        checks = {'tested': 0, 'ok': 0, 'dead': 0, 'wrong': 0, 'mirror': 0, 'untested': 0}
        deadline = t0 + timeout
        pref = self.s.get('lang_pref', 'any')
        while pending and time.time() < deadline and not job.cancel:
            done, pending = fut_wait(pending, timeout=0.5, return_when=FIRST_COMPLETED)
            for f in done:
                c, start = futs[f]
                try:
                    data, took = f.result()
                except Exception as exc:
                    mirrors = c.get('mirrors') or []
                    used = c.setdefault('_mirrors_used', 0)
                    if not c.get('url') and used < len(mirrors) and used < 2 and time.time() < deadline - 1:
                        # the same file lives in another chat: the copy is tested instead of giving the file up
                        c['_mirrors_used'] = used + 1
                        c['chat_id'], c['msg_id'] = mirrors[used][0], mirrors[used][1]
                        nf = submit(c)
                        if nf is not None:
                            futs[nf] = (c, time.time())
                            pending.add(nf)
                            checks['mirror'] += 1
                            continue
                    c['probe'] = 'error'
                    checks['tested'] += 1
                    checks['dead'] += 1
                    self.log('probe failed %s: %s' % (c['file'], exc))
                    continue
                checks['tested'] += 1
                # 3.3: the time the download itself took - the clock here also counts the queue and the polling,
                # which made normal files look slow
                elapsed = max(0.05, took or (time.time() - start))
                kind = sniff(data)
                if not kind:
                    c['probe'] = 'bad-container'
                    checks['wrong'] += 1
                    continue
                c['container'] = kind
                info = mediainfo.inspect(data)
                if info:
                    wrong = self._apply_media(c, info, target, pref)
                    if wrong:
                        c['probe'] = 'mismatch'
                        checks['wrong'] += 1
                        self.log('probe: %s dropped - %s' % (c['file'], wrong))
                        continue
                c['probe'] = 'ok'
                checks['ok'] += 1
                speed = len(data) / elapsed                              # bytes/s for one request
                c['speed'] = speed
                bitrate = (c['size'] / float(c['duration'])) if c.get('duration') else 0
                c['bitrate'] = bitrate
                # parallel requests multiply the speed only when the network is the limit; with the
                # pure-python crypto fallback the CPU is, so no multiplication is assumed there
                cpu_bound = not c.get('url') and self.s.get('crypto') not in ('openssl', 'cryptg', 'telethon-libssl') \
                    and not str(self.s.get('crypto') or '').startswith('tnige')
                effective = speed * (1.3 if cpu_bound else min(int(self.s.get('parallel', 4)), 4) * 0.75)
                c['smooth'] = (not bitrate) or effective >= bitrate * 1.15
                if len(data) < SPEED_SAMPLE_MIN:
                    c['smooth'] = True           # 3.3: too small a sample for a "slow" verdict (and for hide_slow)
                c['score'] += min(10, speed / 1048576.0 * 2)
                if not c['smooth']:
                    c['score'] -= 15
                ok.append(c)
            job.update(70 + 28 * (len(futs) - len(pending)) / max(1, len(futs)), 'probe')
        late = []
        for f in pending:
            c, _ = futs[f]
            c['probe'] = 'untested'
            late.append(c)
            f.cancel()
        if self.s.get('hide_slow', True):
            ok = [c for c in ok if c.get('smooth', True)] or ok
        ok.sort(key=lambda c: -c['score'])
        if not ok and late:
            # 3.0.1: a slow box / slow moment must never turn real matches into "nothing found":
            # links whose test did not finish in time are listed, marked as untested
            self.log('probe: no link answered in %.0fs - listing %d untested matches' % (timeout, len(late)))
        # 3.3: tested links first, then the ones whose test did not finish, then the matches beyond the tested
        # ones - they used to be thrown away; max_results still limits the list
        ok += sorted(late, key=lambda c: -c['score'])
        for c in tail:
            c['probe'] = 'untested'
        ok += tail
        ok += sorted(rd, key=lambda c: -c['score'])
        checks['untested'] = len(late) + len(tail)
        checks['rd'] = len(rd)
        checks['seconds'] = round(time.time() - t0, 1)
        job.stats = dict(job.stats or {}, checks=checks)
        self.log('probe: %(tested)d tested in %(seconds)ss - %(ok)d ok, %(dead)d dead, %(wrong)d wrong file, '
                 '%(mirror)d mirror retries, %(untested)d untested' % checks)
        return ok

    def _apply_media(self, c, info, target, pref):
        """Folds what the file header says into the candidate. Returns a reason when the file is certainly not the
        wanted one (a sample, a clip), else None."""
        from . import mediainfo
        p = c['parsed']
        c['media'] = {'duration': info.get('duration') or 0, 'width': info.get('width') or 0,
                      'height': info.get('height') or 0, 'video': info.get('video') or '',
                      'audio': [x for x in info.get('audio') or [] if x][:6],
                      'subs': [x for x in info.get('subs') or [] if x][:12]}
        real = info.get('duration') or 0
        if real and not c.get('duration'):
            c['duration'] = real                 # a file sent "as a document" has no duration in Telegram
        q = mediainfo.quality_of(info.get('width'), info.get('height'))
        if q and not p.get('quality'):
            p['quality'] = q
        if info.get('video') and not p.get('codec'):
            p['codec'] = info['video']
        before = set(c.get('langs') or p.get('langs') or [])
        langs = set(before)
        if info.get('known'):
            if 'he' in info.get('subs', []):
                langs.add('he_sub')
                c['he_sub_inside'] = True
            if 'he' in info.get('audio', []):
                langs.add('he_dub')
                c['he_audio_inside'] = True
            if 'ru' in info.get('audio', []):
                langs.add('ru_audio')
            if 'ru' in info.get('subs', []):
                langs.add('ru_sub')
        if langs != before:
            c['score'] += matcher.language_bonus(langs, pref) - matcher.language_bonus(before, pref)
        c['langs'] = sorted(langs)
        if not target or not real:
            return None
        runtime = (target.get('runtime') or 0) * 60
        if target['kind'] == 'movie':
            if runtime:
                if real < 0.6 * runtime or real > 1.7 * runtime:
                    return 'real length %d min, the film runs %d' % (real // 60, runtime // 60)
                if abs(real - runtime) > max(600, 0.15 * runtime):
                    c['score'] -= 8
                    c.setdefault('why', []).append('length differs')
            elif real < 40 * 60:
                return 'real length %d min - too short for a film' % (real // 60)
        else:
            if runtime and real < 0.4 * runtime:
                return 'real length %d min, an episode runs %d' % (real // 60, runtime // 60)
            title = info.get('title') or ''
            if title:
                tp = parse(title + '.mkv', '', '')
                ep, se = tp.get('episode'), tp.get('season')
                other_ep = ep is not None and not tp.get('episode_end') and int(ep) != int(target['episode'])
                other_se = se is not None and int(se) != int(target['season'])
                if other_ep or other_se:
                    c['score'] -= 15                 # the name says one episode, the file itself another
                    c['loose'] = True
                    c.setdefault('why', []).append('inner title: %s' % title[:60])
        return None

    @staticmethod
    def _public(c):
        p = c['parsed']
        match = 0
        for w in c.get('why') or []:
            if isinstance(w, str) and w.startswith('title '):
                try:
                    match = int(round(float(w[6:]) * 100))
                except ValueError:
                    pass
                break
        if c.get('loose'):
            match = min(match, 70)
        return {
            'chat_id': c['chat_id'], 'msg_id': c['msg_id'], 'file': c['file'], 'size': c['size'],
            'duration': c.get('duration') or 0, 'caption': (c.get('caption') or '')[:400],
            'chat_title': c.get('chat_title') or '', 'quality': p.get('quality') or (c.get('height') or 0),
            'source': p.get('source'), 'codec': p.get('codec'), 'hdr': p.get('hdr'),
            'langs': c.get('langs') or p.get('langs'), 'score': round(c['score'], 1),
            'probe': c.get('probe', 'untested'), 'speed': int(c.get('speed') or 0), 'smooth': c.get('smooth', True),
            'container': c.get('container'), 'season': p.get('season'), 'episode': p.get('episode'),
            'ai': c.get('ai'), 'why': c.get('why'), 'mirrors': c.get('mirrors', [])[:5],
            'url': c.get('url'), 'backend': c.get('backend', 'tg'), 'chiko': c.get('chiko', False),
            'loose': c.get('loose', False),
            # 3.3.3
            'chat_kind': c.get('chat_kind') or '', 'via_bot': c.get('via_bot') or '', 'date': c.get('date') or 0,
            'match': match, 'media': c.get('media'), 'he_sub_inside': bool(c.get('he_sub_inside')),
            'he_audio_inside': bool(c.get('he_audio_inside')), 'year': p.get('year'),
            'title': p.get('title') or '',
            'rd': c.get('rd'), 'rd_cached': c.get('rd_cached'),
        }

    GROUP = {'tg': 0, 'telemedia': 0, 'rd': 1}

    def order_groups(self, cands, limit=None):
        """3.3.4: Telegram first, then Real-Debrid, then every other source. Inside a group the order of the
        ranking (tested links first, best score first) is kept. Each group gets its own share of the list, so a
        long Telegram list never pushes Real-Debrid out."""
        limit = int(limit or self.s.get('max_results', 25))
        rd_max = int(self.s.get('rd_max', 15))
        groups = {0: [], 1: [], 2: []}
        for c in cands:
            groups[self.GROUP.get(c.get('backend') or 'tg', 2)].append(c)
        return groups[0][:limit] + groups[1][:rd_max] + groups[2][:max(5, limit // 2)]
