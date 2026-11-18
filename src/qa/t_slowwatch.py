# -*- coding: utf-8 -*-
"""Offline: the stall meter of the hub (plugin.video.nova/resources/lib/slowwatch.py).   python t_slowwatch.py"""
import importlib.util, os, sys

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.nova', 'resources', 'lib', 'slowwatch.py')
spec = importlib.util.spec_from_file_location('slowwatch', P)
W = importlib.util.module_from_spec(spec)
spec.loader.exec_module(W)
bad = []


def ok(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        bad.append(what)


def play(script, start=1000.0):
    """script: [(seconds, state)] state: 'p' plays, 'c' buffering, 's' seeking+buffering, 'x' nothing plays.
    -> the seconds (from the start) at which the alarm went off"""
    m, now, alarms = W.StallMeter(), start, []
    for secs, state in script:
        for _ in range(int(secs)):
            if m.feed(now, state != 'x', state in 'cs', state == 's'):
                alarms.append(int(now - start))
            now += 1
    return alarms


ok(play([(600, 'p')]) == [], 'smooth playback: no alarm')
ok(play([(15, 'c'), (600, 'p')]) == [], 'buffering at the start of a video is not a stop')
ok(play([(60, 'p'), (1, 'c'), (30, 'p'), (1, 'c'), (30, 'p'), (1, 'c'), (30, 'p')]) == [], 'one-second hiccups are not stops')
a = play([(60, 'p'), (4, 'c'), (30, 'p'), (4, 'c'), (30, 'p'), (4, 'c'), (60, 'p')])
ok(len(a) == 1 and 125 <= a[0] <= 135, 'three stops within three minutes: one alarm (%s)' % a)
a = play([(60, 'p'), (40, 'c'), (60, 'p')])
ok(len(a) == 1 and 80 <= a[0] <= 90, 'one long wait of 25 s: alarm (%s)' % a)
ok(play([(60, 'p'), (4, 'c'), (200, 'p'), (4, 'c'), (200, 'p'), (4, 'c'), (200, 'p')]) == [], 'three stops far apart: no alarm')
ok(play([(60, 'p'), (1, 's'), (8, 'c'), (60, 'p'), (1, 's'), (8, 'c'), (60, 'p'), (1, 's'), (8, 'c'), (60, 'p')]) == [],
   'loading after a jump is not a stop')
a = play([(60, 'p'), (4, 'c'), (20, 'p'), (4, 'c'), (20, 'p'), (4, 'c'), (20, 'p'), (4, 'c'), (20, 'p'), (4, 'c'), (20, 'p'), (4, 'c'), (20, 'p'), (4, 'c'), (60, 'p')])
ok(len(a) == 1, 'after an alarm: quiet for ten minutes (%s)' % a)
ok(play([(60, 'p'), (4, 'c'), (20, 'p'), (4, 'c'), (5, 'x'), (60, 'p'), (4, 'c'), (60, 'p')]) == [], 'a new video starts counting again')
ok(all(len(v) == 2 and all(v) for v in W.TEXT.values()) and set(W.TEXT) == {'he', 'en', 'ru'}, 'the notice exists in he / en / ru')

print('SLOW WATCH TESTS OK' if not bad else 'SLOW WATCH TESTS FAILED %d' % len(bad))
sys.exit(1 if bad else 0)
