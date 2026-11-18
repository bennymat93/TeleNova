# -*- coding: utf-8 -*-
"""How fast is this device's connection right now, and which files can it play without stopping?

Until 5.0 a file was "too heavy" only against what its SOURCE can deliver (the Telegram account's rate, the
"max_mbit" setting). On a weak connection - mobile data with poor reception, a hotel, a car - the connection
itself is the limit: a 12 GB film was offered, started, and stopped every few seconds.

 * LinkSpeed.current() -> bytes per second this connection gives now, or 0 = fast enough / unknown (no limit).
   A short download from speed.cloudflare.com (no key): 1 MB first; only when that was quick, 4 MB more to tell
   "fast" from "medium". At most MAX_SECONDS, kept for KEEP seconds, one measurement at a time. A connection that
   gives FAST or more is reported as 0: nothing is limited on a good line.
 * fit(cands, tg_cap, other_cap, runtime) -> (kept, left_out): files whose data rate is above the cap are left out;
   among the kept ones a file that needs most of the line loses points (so the lighter copy of the same film is
   offered first); when NOTHING fits, the lightest LIGHTEST files stay, marked - a list with a warning is worth
   more than "nothing found".
 * share: the part of the measured speed a film may use (the rest is head room for the dips of a weak line).

No Kodi module is imported here (tested outside Kodi: qa/t_linkspeed.py)."""
import threading
import time

try:
    import requests
except ImportError:                     # only the injected `http` can be used then (tests)
    requests = None

URL = 'https://speed.cloudflare.com/__down?bytes=%d'
FIRST = 1000000                 # bytes of the first read
MORE = 4000000                  # ... of the second, only on a line that took the first in under QUICK seconds
QUICK = 1.5
MAX_SECONDS = 4.0               # one measurement never takes longer
FAST = 3 * 1048576              # 24 Mbit/s and more: no limit from the connection
KEEP = 600                      # seconds a measurement is good for
KEEP_FAILED = 120               # ... and a failed one (offline, blocked): not asked again at once
SHARE = 0.75                    # the part of the line a film may need
TIGHT = 0.6                     # above this part of the cap a file starts to lose points
LIGHTEST = 3
MIN_RATE = 20000                # below 160 kbit/s nothing plays; such a reading is "unknown", not a limit


class LinkSpeed(object):
    def __init__(self, log=None, http=None, now=None, clock=None):
        self.log = log or (lambda *a: None)
        self.http = http
        self._now = now or time.time
        self._clock = clock or time.time
        self._lock = threading.Lock()
        self._rate = 0
        self._at = 0
        self._ok = False
        self.measured = 0               # the raw reading (also when it is "fast"), for the status page / the log

    def _read(self, size, limit):
        """-> (bytes, seconds) of one download, stopped at `limit` seconds; the clock starts at the first byte"""
        http = self.http or requests
        r = http.get(URL % size, stream=True, timeout=(5, 5), headers={'Accept-Encoding': 'identity'})
        try:
            if getattr(r, 'status_code', 200) != 200:
                raise IOError('http %s' % getattr(r, 'status_code', '?'))
            got, t0 = 0, None
            for chunk in r.iter_content(32768):
                if t0 is None:
                    t0 = self._clock()
                    continue                        # the first block also carries the connection set-up
                got += len(chunk)
                if self._clock() - t0 >= limit:
                    break
            return got, (self._clock() - t0) if t0 is not None else 0
        finally:
            try:
                r.close()
            except Exception:
                pass

    def measure(self):
        """One measurement now. -> bytes per second, 0 when it could not be measured."""
        try:
            got, took = self._read(FIRST, MAX_SECONDS)
            if got and took < QUICK:
                more, took2 = self._read(MORE, max(0.5, MAX_SECONDS - took))
                if more:
                    got, took = more, took2         # the longer read alone: the first one is mostly slow start
            rate = int(got / max(took, 0.01)) if got else 0      # a read too quick to time is a fast line
        except Exception as exc:
            self.log('link speed: not measured (%s)' % type(exc).__name__)
            rate = 0
        return rate

    def current(self, fresh=False):
        """bytes per second to plan with; 0 = no limit (a fast line, or nothing is known)"""
        with self._lock:
            age = self._now() - self._at
            if fresh or not self._at or age > (KEEP if self._ok else KEEP_FAILED):
                rate = self.measure()
                self._at = self._now()
                self._ok = rate >= MIN_RATE
                self.measured = rate if self._ok else 0
                self._rate = rate if self._ok and rate < FAST else 0
                if self._ok:
                    self.log('link speed: %.1f Mbit/s%s' % (rate * 8 / 1e6, '' if self._rate else ' (fast: no limit)'))
            return self._rate

    def note_slow(self, rate):
        """the player was starved at about `rate` bytes per second: the next list is planned with no more than that"""
        with self._lock:
            if rate and rate >= MIN_RATE and (not self._rate or rate < self._rate):
                self._rate, self._at, self._ok, self.measured = int(rate), self._now(), True, int(rate)


_shared = None
_shared_lock = threading.Lock()


def shared(log=None):
    global _shared
    with _shared_lock:
        if _shared is None:
            _shared = LinkSpeed(log)
        return _shared


def caps(tg_cap, other_cap, link):
    """the source's own caps (0 = none) narrowed by the connection (0 = no limit) -> (tg, other)"""
    if not link:
        return tg_cap, other_cap
    mine = int(link * SHARE)
    return (min(tg_cap, mine) if tg_cap else mine), (min(other_cap, mine) if other_cap else mine)


def _need(c, runtime):
    dur = c.get('duration') or runtime
    size = c.get('size')
    return (size / float(dur)) if dur and size else 0


def fit(cands, tg_cap, other_cap, runtime, slow=False):
    """-> (kept, left_out). `slow`: the caps come from a weak connection - then lighter copies also go first and,
    when nothing fits, the LIGHTEST lightest files are kept (c['heavy'] = True, a line in c['why'])."""
    keep, out = [], []
    for c in cands:
        cap = tg_cap if (c.get('backend') or 'tg') in ('tg', 'telemedia') else other_cap
        need = _need(c, runtime)
        if cap and need and need > cap:
            out.append((need, c))
            continue
        if slow and cap and need:
            used = need / float(cap)
            pts = -round(10 * (used - TIGHT) / (1 - TIGHT), 1) if used > TIGHT else 0.0
            c['score'] = (c.get('score') or 0) + pts - c.get('_link_pts', 0.0)     # judged twice: only the difference
            c['_link_pts'] = pts
        keep.append(c)
    if slow and out and not keep:
        out.sort(key=lambda x: x[0])
        for need, c in out[:LIGHTEST]:
            c['heavy'] = True
            why = [w for w in c.get('why') or [] if not (isinstance(w, str) and w.startswith('connection: '))]
            why.append('connection: needs %.1f Mbit/s, more than this connection gives now' % (need * 8 / 1e6))
            c['why'] = why
            keep.append(c)
        out = out[LIGHTEST:]
    return keep, len(out)
