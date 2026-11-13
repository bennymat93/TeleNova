# -*- coding: utf-8 -*-
"""StremThru: which torrent info-hashes are really cached at Real-Debrid (file level).

Real-Debrid itself no longer answers "is this hash cached?". StremThru (open source, MIT,
github.com/MunifTanjim/stremthru) keeps that knowledge and answers it through its store API:

  GET <base>/v0/store/torz/check?hash=<h1,h2,...>[&sid=tt1234567[:s:e]]      (max 500 hashes per request)
      X-StremThru-Store-Name: realdebrid
      X-StremThru-Store-Authorization: Bearer <RD token>
  -> {"data": {"items": [{"hash", "magnet", "status": "cached" | "unknown" | ..., "files": [{"index", "name",
      "path", "size", ...}]}]}}          errors: {"error": {"code", "message", ...}} with a 4xx / 5xx status
  (docs/api/torz.md and docs/api/store.md in the repository; older instances serve the same answer at
   /v0/store/magnets/check?magnet=<h1,h2,...> - used automatically when torz/check answers 404.)

  GET <base>/v0/health -> {"data": {"status": "ok"}}                         (no token needed)

The token travels only in a header and is never logged; neither is the URL query.
No Kodi module is imported here (tested outside Kodi).
"""
import re
import time

try:
    import requests
except ImportError:                     # only the injected `http` can be used then (tests)
    requests = None

DEFAULT_BASE = 'https://stremthru.13377001.xyz'
BASES = (DEFAULT_BASE, 'https://stremthru.elfhosted.com')      # public instances (both answer /v0/health)
MAX_HASHES = 500                        # the API's limit per request
BATCH = 100                             # what is sent per request: keeps the URL near 4 KB (proxies cut long URLs)
TTL = 600                               # seconds an answer is remembered per hash
_HASH = re.compile(r'(?<![0-9a-fA-F])([0-9a-fA-F]{40})(?![0-9a-fA-F])')


def _norm(h):
    """An info-hash or a magnet link -> the 40-hex hash in lower case, or '' """
    m = _HASH.search(h if isinstance(h, str) else '')
    return m.group(1).lower() if m else ''


def _int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


class StremThru(object):
    def __init__(self, base, token_getter, log, store='realdebrid', timeout=10, http=None):
        self.base = (base or '').strip().rstrip('/')
        self.token_getter = token_getter            # () -> the Real-Debrid token (read at every use)
        self.log = log
        self.store = store
        self.timeout = timeout
        if http is None:
            http = requests.Session()
            http.headers['User-Agent'] = 'Kodi TeleNova'
        self.http = http
        self.batch = BATCH
        self._now = time.time
        self._cache = {}                            # hash -> (time, token it was asked with, entry)
        self._legacy = False                        # True once torz/check answered 404 (older instance)

    # ------------------------------------------------------------------ account
    @property
    def token(self):
        try:
            return (self.token_getter() or '').strip()
        except Exception:
            return ''

    @property
    def enabled(self):
        return bool(self.base and self.token)

    # ------------------------------------------------------------------ check
    def check(self, hashes, sid=None):
        """-> {hash_lower: {'cached': bool, 'files': [{'index': int, 'name': str, 'size': int}]}}
        Only hashes the instance answered for are in the result (a failed batch adds nothing)."""
        token = self.token
        if not (self.base and token):
            return {}
        want, seen = [], set()
        for h in hashes or []:
            h = _norm(h)
            if h and h not in seen:
                seen.add(h)
                want.append(h)
        out, ask, now = {}, [], self._now()
        for h in want:
            hit = self._cache.get(h)
            if hit and hit[1] == token and now - hit[0] < TTL:
                out[h] = hit[2]
            else:
                ask.append(h)
        step = max(1, min(int(self.batch or BATCH), MAX_HASHES))
        for i in range(0, len(ask), step):
            part = ask[i:i + step]
            got = self._ask(part, sid, token)
            stamp = self._now()
            for h in part:
                if h in got:
                    self._cache[h] = (stamp, token, got[h])
                    out[h] = got[h]
        if len(self._cache) > 5000:                 # drop what has expired
            now = self._now()
            for h in [k for k, v in self._cache.items() if now - v[0] >= TTL]:
                self._cache.pop(h, None)
        return out

    def _ask(self, part, sid, token):
        headers = {'X-StremThru-Store-Name': self.store,
                   'X-StremThru-Store-Authorization': 'Bearer ' + token}
        for _ in range(2):                          # the second round only after a 404 on torz/check
            if self._legacy:
                path, params = '/v0/store/magnets/check', {'magnet': ','.join(part)}
            else:
                path, params = '/v0/store/torz/check', {'hash': ','.join(part)}
            if sid:
                params['sid'] = sid
            try:
                r = self.http.get(self.base + path, params=params, headers=headers, timeout=self.timeout)
            except Exception as exc:
                self.log('stremthru: check failed: %s' % type(exc).__name__)       # never the URL / the token
                return {}
            code = _int(getattr(r, 'status_code', 0))
            if code == 404 and not self._legacy:
                self._legacy = True
                continue
            if code != 200:
                self.log('stremthru: check refused: %s' % self._error(r, code))
                return {}
            try:
                data = r.json()
            except Exception:
                self.log('stremthru: check: bad answer')
                return {}
            return self._parse(data)
        return {}

    @staticmethod
    def _error(r, code):
        """a short text for a failed answer: the status and the API's own error code (never the body)"""
        try:
            err = (r.json() or {}).get('error') or {}
            word = re.sub(r'[^A-Za-z0-9_ -]', '', str(err.get('code') or ''))[:40]
        except Exception:
            word = ''
        return ('%s %s' % (code, word)).strip()

    @staticmethod
    def _parse(data):
        items = ((data or {}).get('data') or {}).get('items') if isinstance(data, dict) else None
        out = {}
        for it in items or []:
            if not isinstance(it, dict):
                continue
            h = _norm(it.get('hash') or '') or _norm(it.get('magnet') or '')
            if not h:
                continue
            files = []
            for f in it.get('files') or []:
                if not isinstance(f, dict):
                    continue
                name = f.get('name') or (f.get('path') or '').replace('\\', '/').rsplit('/', 1)[-1]
                files.append({'index': _int(f.get('index'), -1), 'name': name or '', 'size': _int(f.get('size'), -1)})
            out[h] = {'cached': it.get('status') == 'cached', 'files': files}
        return out

    # ------------------------------------------------------------------ health
    def health(self):
        """-> (ok, detail): does the instance answer at all? No token is sent."""
        if not self.base:
            return False, 'no address'
        try:
            r = self.http.get(self.base + '/v0/health', timeout=self.timeout)
        except Exception as exc:
            return False, 'network: %s' % type(exc).__name__
        code = _int(getattr(r, 'status_code', 0))
        if code != 200:
            return False, 'http %s' % code
        try:
            status = ((r.json() or {}).get('data') or {}).get('status')
        except Exception:
            return False, 'bad answer'
        if status == 'ok':
            return True, 'ok'
        return False, 'status %s' % re.sub(r'[^A-Za-z0-9_ -]', '', str(status))[:40]
