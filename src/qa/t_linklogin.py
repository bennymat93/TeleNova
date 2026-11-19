# -*- coding: utf-8 -*-
"""Offline: the automatic Telegram sign-in of the Kodi engine (plugin.video.telescope/resources/lib/linklogin.py).
The browser makes the same seal (web/tg.js) - src/qa/web/t_tglink.js checks the two byte for byte.
   python t_linklogin.py            the checks
   python t_linklogin.py vector     prints one sealed sample for the browser test"""
import importlib.util, os, sys

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.telescope', 'resources', 'lib', 'linklogin.py')
spec = importlib.util.spec_from_file_location('linklogin', P)
L = importlib.util.module_from_spec(spec)
spec.loader.exec_module(L)

SECRET = 'A' * 43
TOKEN = bytes((i * 7) % 256 for i in range(48))
NONCE = bytes(range(16))
if sys.argv[1:] == ['vector']:
    print(L.channel(SECRET) + ' ' + L.seal(SECRET, TOKEN, NONCE).hex())
    sys.exit(0)

bad = []


def ok(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        bad.append(what)


s = L.new_secret()
ok(L.valid(s) and len(s) == 43 and L.new_secret() != s, 'a new secret: 43 url-safe characters, never the same')
ok(not L.valid('') and not L.valid('short') and not L.valid('x' * 70) and not L.valid('bad secret with spaces and more than forty chars'), 'malformed secrets are refused')
ok(len(L.channel(SECRET)) == 32 and L.channel(SECRET) == L.channel(SECRET) and L.channel(SECRET) != L.channel('B' * 43), 'one channel per household')
b1, b2 = L.seal(SECRET, TOKEN), L.seal(SECRET, TOKEN)
ok(b1 != b2 and len(b1) == 16 + len(TOKEN) + 16, 'the same token is sealed differently every time')
ok(TOKEN[4:20] not in b1, 'the token cannot be read in the mailbox')
ok(L.open_(SECRET, b1) == TOKEN, 'the household opens it')
for what, blob, sec in (('another household', b1, 'B' * 43), ('a changed message', b1[:20] + bytes([b1[20] ^ 1]) + b1[21:], SECRET), ('too short', b1[:20], SECRET)):
    try:
        L.open_(sec, blob)
        ok(False, what + ' is refused')
    except ValueError:
        ok(True, what + ' is refused')
ok(L.token_text(b'\xfb\xff\x00') == '-_8A', 'token text is base64url without padding (what qr_accept takes)')


class Http(object):
    """the helper's mailbox, in memory, answering the way worker/index.js does"""
    def __init__(self):
        self.box, self.calls = {}, []

    class R(object):
        def __init__(self, code, content=b''):
            self.status_code, self.content = code, content

    def put(self, url, data=None, timeout=None, headers=None):
        self.calls.append(('PUT', headers.get('Origin')))
        self.box[url] = data
        return self.R(204)

    def get(self, url, timeout=None, headers=None):
        self.calls.append(('GET', headers.get('Origin')))
        return self.R(200, self.box[url]) if url in self.box else self.R(204)

    def delete(self, url, timeout=None, headers=None):
        self.box.pop(url, None)
        return self.R(204)


h = Http()
mb = L.Mailbox(http=h)
ok(mb.take(SECRET) is None, 'an empty mailbox: nothing to approve')
ok(mb.ask(SECRET, TOKEN), 'the new device leaves its token')
ok(L.Mailbox(http=h).take('B' * 43) is None, 'another household finds nothing')
ok(mb.take(SECRET) == TOKEN, 'the signed-in device takes it')
ok(mb.take(SECRET) is None, '... once (it is removed)')
ok(all(o == L.ORIGIN for _, o in h.calls), 'every call says it comes from the site (the helper answers no one else)')
h.box[mb._url(SECRET)] = b'not sealed by us at all, long enough to look like one'
ok(mb.take(SECRET) is None, 'something not sealed by the household is never approved')

print('LINK LOGIN TESTS OK' if not bad else 'LINK LOGIN TESTS FAILED %d' % len(bad))
sys.exit(1 if bad else 0)
