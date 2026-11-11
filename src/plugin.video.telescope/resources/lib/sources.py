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

    def __init__(self, tg, meta, ai, store, cache, settings, log, bridge=None, servers=None):
        self.tg = tg
        self.meta = meta
        self.ai = ai
        self.store = store
        self.cache = cache
        self.s = settings
        self.log = log
        self.bridge = bridge
        self.servers = servers
        self.jobs = {}
        self._pool = ThreadPoolExecutor(max_workers=8)
        self._chiko = (0, {'tg': [], 'telemedia': []})
        self._bridge_ok = (0, False)

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
        details = self.meta.details(mkind, ident) if ident else None
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
        if self.ai and self.ai.enabled and self.s.get('ai_aliases', True):
            job.update(8, 'ai_aliases')
            ck = 'ai_alias:%s:%s' % (mkind, ident or title)
            extra = self.cache.get(ck)
            if extra is None:
                try:
                    # 3.3: the timeout goes with the call (it used to be written into the shared Gemini object)
                    extra = self.ai.aliases(title, details.get('original_title') if details else title, year,
                                            'TV series' if kind == 'episode' else 'movie', aliases, timeout=6)
                    self.cache.set(ck, extra, 30 * 86400)
                except Exception as exc:
                    self.log('AI aliases failed: %s' % exc)
                    extra = []
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
                'ident': ident}

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
            for n in names:
                queries.append(n)
                heb = any(u'֐' <= ch <= u'׿' for ch in n)
                cyr = any(u'Ѐ' <= ch <= u'ӿ' for ch in n)
                if heb:
                    queries.append(u'%s פרק %d' % (n, e))              # <name> פרק e
                elif cyr:
                    queries.append(u'%s %d серия' % (n, e))  # <name> e серия
                else:
                    queries.append('%s S%02dE%02d' % (n, s, e))
        out, seen = [], set()
        for q in queries:
            k = q.lower()
            if k not in seen:
                seen.add(k)
                out.append(q)
        return out[:int(self.s.get('max_queries', 6))]

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
        cache_key = 'src:%s:%s:%s:%s' % (req.get('type'), req.get('tmdb') or req.get('imdb') or req.get('title'),
                                          req.get('season'), req.get('episode'))
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
        chats = [int(c) for c in self.s.get('pinned_chats', []) if str(c).lstrip('-').isdigit()]
        chiko = self.chiko_chats(background=True) if self.s.get('chiko', True) else {'tg': [], 'telemedia': []}
        tg_chats = chats + [c['id'] for c in chiko['tg'] if c['id'] not in chats]
        tm_chats = [c['id'] for c in chiko['telemedia']]

        job.update(15, 'telegram_search')
        raw = []
        limit = int(self.s.get('search_limit', 100))
        futs = []
        if self.tg and not self.bridge_ok() and not (self.servers and self.servers.enabled and t.get('imdb')) \
                and self._tg_authorized() is False:
            # 3.3: every query of a logged-out client fails quietly and the user was told to "join channels"
            raise RuntimeError('not_authorized')
        if self.tg:
            futs += [self.tg.submit(self.tg.search(q, limit=limit, chats=tg_chats[:6] if i < 2 else None))
                     for i, q in enumerate(queries)]
        if self.bridge_ok():
            futs += [self._pool.submit(self.bridge.search, q, limit, tm_chats[:6] if i < 2 else None)
                     for i, q in enumerate(queries)]
        if self.servers and self.servers.enabled and t.get('imdb'):
            futs.append(self._pool.submit(self.servers.streams, t['kind'], t['imdb'], t.get('season'), t.get('episode')))
        if not futs:
            raise RuntimeError('no_backend')
        total = len(futs)
        done_n = 0
        t_search = time.time()
        deadline = t_search + float(self.s.get('search_timeout', 12))
        pending = set(futs)
        strict = self.s.get('strict', True)
        checked, good = 0, 0
        while pending and time.time() < deadline and not job.cancel:
            done, pending = fut_wait(pending, timeout=0.25)
            for f in done:
                done_n += 1
                try:
                    raw.extend(f.result())
                except Exception as exc:
                    self.log('query failed: %s' % exc)
            job.update(15 + 35 * done_n / max(1, total), 'telegram_search')
            if pending and done_n * 2 >= total and len(raw) >= 30 and time.time() - t_search > 3:
                # 3.3: "plenty of files" is not enough - 30 wrong files used to cancel the Hebrew / Russian alias
                # queries that were still running. Stragglers are dropped only when 5 files really match.
                for c in raw[checked:]:
                    try:
                        c['parsed'] = parse(c['file'], c['caption'], c.get('chat_title', ''))
                        c['ext'] = c['parsed']['ext']
                        if matcher.evaluate(c, t, strict=strict)[0] == 'accept':
                            good += 1
                    except Exception:
                        pass
                checked = len(raw)
                if good >= 5:
                    break
        self.log('search: %d/%d queries, %d files in %.1fs' % (done_n, total, len(raw), time.time() - t_search))
        for f in pending:
            f.cancel()
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
                     'queries': len(queries)}

        # ---- AI verification
        use_ai = self.ai and self.ai.enabled and self.s.get('ai_verify', True)
        if use_ai and (maybe or (accepted and self.s.get('ai_verify_all', False))):
            job.update(60, 'ai_verify')
            pool = sorted(maybe, key=lambda c: -c['score'])[:40]
            if self.s.get('ai_verify_all', False):
                pool += sorted(accepted, key=lambda c: -c['score'])[:30]
            try:
                verdicts = self.ai.verify(t, [self._ai_row(i, c) for i, c in enumerate(pool)], timeout=10)
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

        # ---- probe
        if self.s.get('probe', True) and accepted:
            job.update(70, 'probe')
            accepted = self.probe(accepted, job)
        result = [self._public(c) for c in accepted[:int(self.s.get('max_results', 25))]]
        if result:
            self.cache.set(store_key, result, 1800)
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

    def probe(self, cands, job):
        n = int(self.s.get('probe_count', 10))
        timeout = float(self.s.get('probe_timeout', 12))
        head, tail = cands[:n], cands[n:]
        futs = {}
        t0 = time.time()
        for c in head:
            if c.get('url'):
                fut = self._pool.submit(http_head_bytes, c['url'], timeout, 1048576, True)
            elif self.tg:
                fut = self.tg.submit(self.tg.read_head(c['chat_id'], c['msg_id'], PROBE_BYTES, True))
            else:
                continue
            futs[fut] = (c, time.time())
        ok, pending = [], set(futs)
        deadline = t0 + timeout
        while pending and time.time() < deadline and not job.cancel:
            done, pending = fut_wait(pending, timeout=0.5, return_when=FIRST_COMPLETED)
            for f in done:
                c, start = futs[f]
                try:
                    data, took = f.result()
                except Exception as exc:
                    c['probe'] = 'error'
                    self.log('probe failed %s: %s' % (c['file'], exc))
                    continue
                # 3.3: the time the download itself took - the clock here also counts the queue and the polling,
                # which made normal files look slow
                elapsed = max(0.05, took or (time.time() - start))
                kind = sniff(data)
                if not kind:
                    c['probe'] = 'bad-container'
                    continue
                c['probe'] = 'ok'
                c['container'] = kind
                speed = len(data) / elapsed                              # bytes/s for one request
                c['speed'] = speed
                bitrate = (c['size'] / float(c['duration'])) if c.get('duration') else 0
                c['bitrate'] = bitrate
                # parallel requests multiply the speed only when the network is the limit; with the
                # pure-python crypto fallback the CPU is, so no multiplication is assumed there
                cpu_bound = not c.get('url') and self.s.get('crypto') not in ('openssl', 'cryptg', 'telethon-libssl')
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
        # 3.3: tested links first, then the ones whose test did not finish, then the matches beyond probe_count -
        # they used to be thrown away (the list was cut to probe_count); max_results still limits the list
        ok += sorted(late, key=lambda c: -c['score'])
        for c in tail:
            c['probe'] = 'untested'
        ok += tail
        return ok

    @staticmethod
    def _public(c):
        p = c['parsed']
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
        }
