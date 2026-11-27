# -*- coding: utf-8 -*-
"""6.5.1: shared progress helper (tnprogress.py) - ETA math, wording, identical copies in the add-ons."""
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
COPIES = [os.path.join(SRC, 'plugin.video.nova', 'resources', 'lib', 'tnprogress.py'),
          os.path.join(SRC, 'plugin.video.telescope', 'resources', 'lib', 'tnprogress.py'),
          os.path.join(SRC, 'plugin.program.novawizard', 'tnprogress.py')]
sys.path.insert(0, os.path.dirname(COPIES[0]))
import tnprogress as tp  # noqa: E402

fails = []


def check(name, cond):
    print(('ok   ' if cond else 'FAIL ') + name)
    if not cond:
        fails.append(name)


class Clock(object):
    t = 1000.0

    def __call__(self):
        return self.t


class FakeDlg(object):
    def __init__(self):
        self.calls = []

    def create(self, *a):
        pass

    def update(self, *a):
        self.calls.append(a)

    def iscanceled(self):
        return False

    def close(self):
        pass


texts = [io.open(p, encoding='utf-8').read() for p in COPIES]
check('three identical copies', all(t == texts[0] for t in texts))
check('every text in he/en/ru', all(set(r) >= {'he', 'en', 'ru'} for r in tp.TEXTS.values()))
check('fmt_left', tp.fmt_left(80) == '1:20' and tp.fmt_left(3725) == '1:02:05' and tp.fmt_left(-3) == '0:00')
check('step line', tp.step_line(3, 12, 'en') == 'Step 3 of 12' and tp.step_line(0, 0, 'en') == 'Step 1 of 1')

c = Clock()
e = tp.Eta(clock=c)
check('first line: percent only', e.line(0, 1000, 'en') == '0%')
c.t += 1
check('too early: no time', e.line(10, 1000, 'en') == '1%')
for _ in range(8):                       # steady 10 units/s
    c.t += 1
    e.feed(e.done + 10, 1000)
line = e.line(e.done, 1000, 'en')
left = e.seconds_left()
check('steady rate -> about (1000-90)/10 s: %s' % line, left is not None and abs(left - 91) < 3 and '42' not in line
      and line.startswith('9%') and 'about 1:3' in line)
c.t += 1
e.feed(e.done + 100, 1000)               # one burst is smoothed, not taken at face value
check('burst smoothed', e.rate < 50)
check('hebrew wording', u'עוד כ-' in e.line(None, None, 'he'))
e.feed(1000, 1000)
check('done: no time left', e.seconds_left() is None and e.percent() == 100)
e2 = tp.Eta(clock=c)
e2.feed(0, 0)
check('unknown total', e2.line(None, None, 'en') == '0%')

d = FakeDlg()
p = tp.Progress('H', dialog=d)
p.step(2, 5, 'msg')
check('dialog step text', d.calls[-1][0] == 20 and d.calls[-1][1].startswith('msg\nStep 2 of 5'))
bg = tp.Progress('H', bg=True, dialog=FakeDlg())
bg.update(5, 10, 'x')
check('bg update has heading', bg.d.calls[-1][1] == 'H' and bg.d.calls[-1][2].startswith('x\n50%'))

print('%d failed' % len(fails))
sys.exit(1 if fails else 0)
