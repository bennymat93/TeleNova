# -*- coding: utf-8 -*-
"""Offline: All in one on the Kodi side (plugin.video.telescope/resources/lib/aio.py).
   python t_aio.py           the checks
   python t_aio.py vector    prints the keys of a made-up account for the browser test (qa/web/t_aio.js)"""
import importlib.util, os, sys

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.telescope', 'resources', 'lib', 'aio.py')
spec = importlib.util.spec_from_file_location('aio', P)
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)
NAME, PASS = '  Test-User ', 'not-a-real-pass-123'          # made up: never the owner's
if sys.argv[1:] == ['vector']:
    print('%s %s' % A.keys(NAME, PASS))
    sys.exit(0)
bad = []


def ok(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        bad.append(what)


vid, seal = A.keys(NAME, PASS)
ok(len(vid) == 64 and all(c in '0123456789abcdef' for c in vid) and len(seal) == 44, 'an address of 64 hex characters and a seal of 32 bytes')
ok(A.keys('test-user', PASS) == (vid, seal), 'the user name ignores spaces around it and capital letters')
ok(A.keys(NAME, PASS.upper())[0] != vid, 'the password does not')
ok(A.keys('other', PASS)[0] != vid, 'another user, another address')
ok(not A.ok_input('ab', PASS) and not A.ok_input(NAME, 'short') and A.ok_input(NAME, PASS), 'user name 3+, password 8+')


class R(object):
    def __init__(self, code, content=b''):
        self.status_code, self.content = code, content


class Http(object):
    def __init__(self, code, content=b''):
        self.code, self.content, self.calls = code, content, []

    def get(self, url, timeout=None, headers=None):
        self.calls.append((url, headers.get('Origin')))
        return R(self.code, self.content)


h = Http(200, b'sealed')
ok(A.fetch(NAME, PASS, http=h) == (b'sealed', seal) and h.calls[0] == (A.HELPER + '/aio/' + vid, A.ORIGIN), 'the vault is asked for at its address, as the site')
for code, err in ((404, 'none'), (429, 'busy'), (500, 'net')):
    try:
        A.fetch(NAME, PASS, http=Http(code))
        ok(False, 'http %d -> %s' % (code, err))
    except A.AioError as e:
        ok(str(e) == err, 'http %d -> %s' % (code, err))
try:
    A.fetch('ab', 'x', http=h)
    ok(False, 'too short is refused before any request')
except A.AioError as e:
    ok(str(e) == 'short' and len(h.calls) == 1, 'too short is refused before any request')
print('AIO TESTS OK' if not bad else 'AIO TESTS FAILED %d' % len(bad))
sys.exit(1 if bad else 0)
