# -*- coding: utf-8 -*-
"""OpenSubtitles "moviehash": certain identification of a video file.

The hash is made of the file size and the first and last 64 KB, so it names one exact release file. The REST API
(https://api.opensubtitles.com/api/v1, docs: opensubtitles.stoplight.io) tells which film / episode the subtitles
uploaded for that very file belong to:

  GET /subtitles?moviehash=<16 hex>&moviehash_match=only        headers: Api-Key: <key>, User-Agent: <App vX.Y>
  -> {"total_pages", "total_count", "per_page", "page", "data": [{"id", "type": "subtitle", "attributes": {
      "language": "he", "moviehash_match": true, "feature_details": {"feature_type": "Movie" | "Episode",
      "year", "title", "movie_name", "imdb_id" (integer), "season_number", "episode_number", "parent_imdb_id",
      "parent_title", ...}, ...}}]}
  Only entries whose attributes.moviehash_match is true are trusted. Parameters are sent alphabetically sorted
  and in lower case (the API redirects otherwise). 429 = rate limit (5 requests / second per IP).

The key travels only in a header and is never logged. No Kodi module is imported here (tested outside Kodi).
"""
import re
import struct
import time

try:
    import requests
except ImportError:                     # only the injected `http` can be used then (tests)
    requests = None

API = 'https://api.opensubtitles.com/api/v1'
USER_AGENT = 'TeleNova v4.0'            # the API refuses requests without "<app name> v<version>"
BLOCK = 65536
_MASK = 0xFFFFFFFFFFFFFFFF
_WORDS = struct.Struct('<%dQ' % (BLOCK // 8))


def moviehash(size, head, tail):
    """The OSDb hash: (size + the 64-bit little-endian words of the first and the last 64 KB) mod 2^64, 16 hex digits.
    size: the file size in bytes; head / tail: the first / the last 65536 bytes."""
    size = int(size)
    if size < 2 * BLOCK:
        raise ValueError('file too small for a moviehash')
    if head is None or tail is None or len(head) < BLOCK or len(tail) < BLOCK:
        raise ValueError('a 64 KB block is short')
    total = size
    total += sum(_WORDS.unpack(bytes(head[:BLOCK])))
    total += sum(_WORDS.unpack(bytes(tail[-BLOCK:])))
    return '%016x' % (total & _MASK)


def imdb_id(value):
    """558705 / '0111161' / 'tt111161' -> 'tt0558705' / 'tt0111161' ('tt' + at least 7 digits); '' when there is none"""
    digits = re.sub(r'\D', '', str(value if value is not None else ''))
    if not digits or not int(digits):
        return ''
    return 'tt%07d' % int(digits)


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


class OpenSubs(object):
    def __init__(self, key_getter, log, timeout=8, http=None):
        self.key_getter = key_getter                # () -> the user's API key (read at every use)
        self.log = log
        self.timeout = timeout
        if http is None:
            http = requests.Session()
        self.http = http
        self._now = time.time
        self._quiet = 0                             # no request before this time (after a 429)
        self._bad = None                            # a key the API refused: not tried again

    @property
    def key(self):
        try:
            return (self.key_getter() or '').strip()
        except Exception:
            return ''

    @property
    def enabled(self):
        return bool(self.key)

    # ------------------------------------------------------------------ requests
    def _get(self, path, params, force=False):
        """-> (status, json | None). status: 200, 401 / 403 (key refused), 429, another HTTP status,
        0 = network error or unreadable answer, -1 = nothing sent (no key, refused key, rate-limit pause)."""
        key = self.key
        if not key:
            return -1, None
        if not force and (key == self._bad or self._now() < self._quiet):
            return -1, None
        try:
            r = self.http.get(API + path, params=sorted((params or {}).items()), timeout=self.timeout,
                              headers={'Api-Key': key, 'User-Agent': USER_AGENT, 'Accept': 'application/json'})
        except Exception as exc:
            self.log('opensubs: request failed: %s' % type(exc).__name__)          # never the key
            return 0, None
        code = _int(getattr(r, 'status_code', 0)) or 0
        if code in (401, 403):
            self._bad = key
            self.log('opensubs: the API key was refused (%s)' % code)
            return code, None
        if code == 429:
            wait = _int((getattr(r, 'headers', None) or {}).get('Retry-After'))
            wait = min(max(wait, 1), 3600) if wait else 60
            self._quiet = self._now() + wait
            self.log('opensubs: rate limit, quiet for %d s' % wait)
            return code, None
        if code != 200:
            self.log('opensubs: http %s' % code)
            return code, None
        try:
            data = r.json()
        except Exception:
            self.log('opensubs: bad answer')
            return 0, None
        self._bad = None
        return 200, data if isinstance(data, dict) else {}

    @staticmethod
    def _matched(data):
        out = []
        for it in (data or {}).get('data') or []:
            attr = it.get('attributes') if isinstance(it, dict) else None
            if isinstance(attr, dict) and attr.get('moviehash_match') is True:
                out.append(attr)
        return out

    # ------------------------------------------------------------------ identify
    def identify(self, mhash, size=None):
        """-> None, or {'imdb': 'tt0111161', 'season': int|None, 'episode': int|None, 'title': str,
        'year': int|None, 'hebrew': bool, 'episode_imdb': str}.
        For an episode 'imdb' is the show's id (as the rest of the engine uses it) and 'episode_imdb' the episode's.
        `size` is accepted for the caller's convenience; the REST API has no size parameter."""
        mhash = (mhash or '').strip().lower()
        if not re.match(r'^[0-9a-f]{16}$', mhash):
            return None
        code, data = self._get('/subtitles', {'moviehash': mhash, 'moviehash_match': 'only'})
        if code != 200:
            return None
        hits = self._matched(data)
        votes, first = {}, {}
        for attr in hits:
            fd = attr.get('feature_details') or {}
            episode = (fd.get('feature_type') or '').lower() == 'episode'
            show = imdb_id(fd.get('parent_imdb_id')) if episode else ''
            own = imdb_id(fd.get('imdb_id'))
            ident = (show or own, _int(fd.get('season_number')) if episode else None,
                     _int(fd.get('episode_number')) if episode else None)
            if not ident[0]:
                continue
            votes[ident] = votes.get(ident, 0) + 1
            first.setdefault(ident, (fd, own if show else ''))
        if not votes:
            return None
        ident = max(votes, key=lambda k: votes[k])              # the feature most matching subtitles agree on
        fd, ep_imdb = first[ident]
        hebrew = False
        for attr in hits:
            if (attr.get('language') or '').lower() in ('he', 'heb', 'iw'):
                hebrew = True
                break
        if not hebrew and (_int(data.get('total_pages')) or 1) > 1:        # more pages: ask for Hebrew alone
            code, more = self._get('/subtitles', {'languages': 'he', 'moviehash': mhash, 'moviehash_match': 'only'})
            hebrew = code == 200 and bool(self._matched(more))
        title = (fd.get('parent_title') if ident[2] is not None or ident[1] is not None else '') or \
            fd.get('title') or fd.get('movie_name') or ''
        return {'imdb': ident[0], 'season': ident[1], 'episode': ident[2], 'title': title,
                'year': _int(fd.get('year')) or None, 'hebrew': hebrew, 'episode_imdb': ep_imdb}

    # ------------------------------------------------------------------ key
    def check_key(self):
        """-> (ok, detail). True: the key works; False: the API refuses it; None: no key, or it could not be
        decided now (network error, rate limit) - the detail says which.
        Uses a tiny /subtitles search: the /infos/* endpoints answer without a valid key."""
        if not self.key:
            return None, 'no key'
        code, _ = self._get('/subtitles', {'moviehash': '0000000000000000', 'moviehash_match': 'only'}, force=True)
        if code == 200:
            return True, 'ok'
        if code in (401, 403):
            return False, 'key refused (%s)' % code
        if code == 429:
            return None, 'rate limit'
        if code == 0:
            return None, 'network'
        return None, 'http %s' % code
