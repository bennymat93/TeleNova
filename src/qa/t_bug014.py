# -*- coding: utf-8 -*-
"""Offline: BUG-014 - a TV channel that failed to open is retried as soon as the player is torn down,
not after a fixed 2 s. Runs onPlayBackError from service.py against stub xbmc objects.   python t_bug014.py"""
import ast, io, os, sys, textwrap, threading, time

SRC = os.path.join(os.path.dirname(__file__), '..', 'plugin.video.nova', 'service.py')
code = io.open(SRC, encoding='utf-8').read()
ast.parse(code, feature_version=(3, 8))
tree = ast.parse(code)
fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'onPlayBackError')
body = textwrap.dedent(ast.get_source_segment(code, fn))

state = {'media_until': 0.0, 'played': None}


class Mon(object):
    def waitForAbort(self, s):
        time.sleep(s)
        return False


class X(object):
    @staticmethod
    def getCondVisibility(c):
        return time.time() < state['media_until']


ns = {'time': time, 'threading': threading, 'xbmc': X, 'monitor': Mon, 'log': lambda *a: None}
exec(body, ns)


class P(object):
    onPlayBackError = ns['onPlayBackError']
    finish = lambda self: None
    isPlaying = lambda self: False

    def play(self, p):
        state['played'] = (p, time.time())


def run(teardown):
    state['played'] = None
    p = P()
    p.tv_try = 'pvr://channels/tv/x.pvr'
    t0 = time.time()
    state['media_until'] = t0 + teardown
    p.onPlayBackError()
    while state['played'] is None and time.time() - t0 < 5:
        time.sleep(0.02)
    return state['played'][1] - t0, p


ok = True
dt, p = run(0)
print('player already idle: retry after %.2f s' % dt); ok &= dt < 0.8
dt, _ = run(0.6)
print('player busy 0.6 s:   retry after %.2f s' % dt); ok &= 0.85 <= dt < 1.3
dt, _ = run(10)
print('player stuck:        retry after %.2f s' % dt); ok &= dt < 2.4
state['played'] = None
p.onPlayBackError(); time.sleep(1)
print('second failure within 30 s: no retry'); ok &= state['played'] is None
print('PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
