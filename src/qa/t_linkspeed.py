# -*- coding: utf-8 -*-
"""Offline: playing on a weak connection (plugin.video.telescope/resources/lib/linkspeed.py) - the measurement
(simulated downloads, a simulated clock) and the choice of files.   python t_linkspeed.py"""
import importlib.util, os, sys

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.telescope', 'resources', 'lib', 'linkspeed.py')
spec = importlib.util.spec_from_file_location('linkspeed', P)
L = importlib.util.module_from_spec(spec)
spec.loader.exec_module(L)
bad = []


def ok(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        bad.append(what)


class Line(object):
    """a connection that gives `rate` bytes per second; `fail`: 'error' raises, a number is the HTTP status"""
    def __init__(self, rate, fail=None):
        self.rate, self.fail, self.t, self.calls = float(rate), fail, 1000.0, []

    def clock(self):
        return self.t

    def get(self, url, **kw):
        if self.fail == 'error':
            raise IOError('offline')
        size = int(url.rsplit('=', 1)[1])
        self.calls.append(size)
        line = self

        class R(object):
            status_code = line.fail or 200

            def iter_content(self, n):
                left = size
                while left > 0:
                    k = min(n, left)
                    left -= k
                    line.t += k / line.rate
                    yield b'x' * k

            def close(self):
                pass
        return R()


def speed(rate, fail=None):
    line = Line(rate, fail)
    ls = L.LinkSpeed(http=line, clock=line.clock, now=line.clock)
    return ls, line


MB = 1048576.0
ls, line = speed(0.25 * MB)                       # 2 Mbit/s: weak mobile data
r = ls.current()
ok(abs(r - 0.25 * MB) < 0.03 * MB, 'a 2 Mbit/s line is measured as such (%.2f MB/s)' % (r / MB))
ok(line.calls == [L.FIRST], 'one small download is enough on a slow line')
ok(line.t - 1000.0 <= L.MAX_SECONDS + 0.5, 'the measurement stops after %.0f s' % L.MAX_SECONDS)
ls.current()
ok(len(line.calls) == 1, 'the result is kept (no second download within %d s)' % L.KEEP)
line.t += L.KEEP + 1
ls.current()
ok(len(line.calls) == 2, 'and measured again when it is old')

ls, line = speed(1.5 * MB)                        # 12 Mbit/s: medium
r = ls.current()
ok(line.calls == [L.FIRST, L.MORE] and abs(r - 1.5 * MB) < 0.15 * MB, 'a medium line gets the longer read (%.2f MB/s)' % (r / MB))
ls, line = speed(12 * MB)
ok(ls.current() == 0 and ls.measured > L.FAST, 'a fast line: no limit (measured %.0f Mbit/s)' % (ls.measured * 8 / 1e6))
ls, line = speed(1 * MB, fail='error')
ok(ls.current() == 0 and ls.measured == 0, 'offline / blocked: nothing known, no limit, no exception')
ls, line = speed(1 * MB, fail=503)
ok(ls.current() == 0, 'an error answer is not a measurement')
ls, line = speed(12 * MB)
ls.current()
ls.note_slow(0.3 * MB)
ok(ls.current() == int(0.3 * MB), 'a player that was starved lowers the estimate at once')
ls.note_slow(2 * MB)
ok(ls.current() == int(0.3 * MB), '... and a higher reading does not raise it')

ok(L.caps(100, 200, 0) == (100, 200), 'no link limit: the source limits stay')
ok(L.caps(0, 0, 1000) == (750, 750), 'no source limit: three quarters of the line')
ok(L.caps(500, 5000, 1000) == (500, 750), 'the lower of the two')


def film(name, gb, backend='tg', score=50, minutes=100):
    return {'file': name, 'size': int(gb * 1024 ** 3), 'duration': minutes * 60, 'backend': backend, 'score': score, 'why': []}


runtime = 100 * 60
cap = int(0.25 * MB * L.SHARE)                    # the 2 Mbit/s line: 1.5 Mbit/s for the film
big, mid, small, tiny = film('2160p', 12), film('1080p', 2.2), film('720p', 0.9), film('480p', 0.45)
keep, out = L.fit([big, mid, small, tiny], cap, cap, runtime, slow=True)
ok([c['file'] for c in keep] == ['720p', '480p'] and out == 2, 'on a weak line only the files it can carry are listed')
ok(small['score'] < 50 and tiny['score'] == 50, 'a file that needs most of the line loses points, a light one none')
before = small['score']
L.fit([small], cap, cap, runtime, slow=True)
ok(small['score'] == before, 'judged twice: the points are not taken twice')
keep, out = L.fit([film('2160p', 12), film('1080p', 2.2), film('1080p b', 3), film('1080p c', 4), film('1080p d', 5)], cap, cap, runtime, slow=True)
ok([c['file'] for c in keep] == ['1080p', '1080p b', '1080p c'] and out == 2 and all(c.get('heavy') for c in keep),
   'nothing fits: the three lightest stay, marked')
ok(any(w.startswith('connection: ') for w in keep[0]['why']), '... with the reason')
keep, out = L.fit([film('2160p', 12)], cap, cap, runtime, slow=False)
ok(keep == [] and out == 1, 'a source limit alone (not the connection) behaves as before: left out')
rd = film('rd 1080p', 2.2, backend='rd')
keep, out = L.fit([rd, film('tg 1080p', 2.2)], 10 ** 9, cap, runtime, slow=True)
ok([c['file'] for c in keep] == ['tg 1080p'], 'each source is judged by its own cap')
keep, out = L.fit([{'file': 'no size', 'backend': 'tg'}, big], 0, 0, runtime)
ok(len(keep) == 2 and out == 0, 'no cap, or a file of unknown size: kept')

print('LINK SPEED TESTS OK' if not bad else 'LINK SPEED TESTS FAILED %d' % len(bad))
sys.exit(1 if bad else 0)
