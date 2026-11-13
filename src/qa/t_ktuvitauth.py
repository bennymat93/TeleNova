# -*- coding: utf-8 -*-
"""ktuvitauth: the Ktuvit password encoding and the login call. No network.

Where the vectors come from: ktuvit.me publishes no test vector, and no real account was used. The VECTORS below were
produced with Node.js by a re-statement of the site's js/Modules/LoginHandler.js Encrypt(): CryptoJS 3.1.2's own
Hex.parse loop copied verbatim (so the genuine JavaScript parseInt / |= / << behaviour decides the IV), and Node's
built-in crypto for PBKDF2-HMAC-SHA1 (3000 iterations, 16 bytes), AES-128-CBC/PKCS7 and SHA-256. They prove that the
pure-Python AES and the Python emulation of the JavaScript quirks agree with a second, independent implementation -
not that the server accepts the value (that needs a real account)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.nova', 'resources', 'lib'))
import ktuvitauth as K   # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
fails = []


def check(name, cond, detail=''):
    print(('ok   ' if cond else 'FAIL ') + name + ((' - ' + str(detail)) if detail and not cond else ''))
    if not cond:
        fails.append(name)


# ---- AES core against FIPS-197 appendix C.1 and NIST SP 800-38A F.2.1 (CBC-AES128, first block)
rk = K._expand_key(bytes(range(16)))
check('AES FIPS-197 C.1', K._encrypt_block(bytes.fromhex('00112233445566778899aabbccddeeff'), rk).hex()
      == '69c4e0d86a7b0430d8cdb78070b4c55a')
ct = K._aes128_cbc_pkcs7(bytes.fromhex('2b7e151628aed2a6abf7158809cf4f3c'), bytes(range(16)),
                         bytes.fromhex('6bc1bee22e409f96e93d7e117393172a'))
check('AES-CBC SP 800-38A F.2.1', ct[:16].hex() == '7649abac8119b246cee98e9b12e9197d' and len(ct) == 32)

# ---- encode_password: (email, password, IV hex the JS computes, encoded)
VECTORS = [
    ('viewer@example.com', 'secret123', '000e0e00000000000000000000000000',
     'InnZqv+U2/tvbA8zFjEij2PeT5w9Jytr4jDSD2Euyiw='),
    ('a-b+c.0xff@Example-Mail.co.il', 'Pa$$w0rd סיסמה', '0a0b0c00ff00000000000a000c000000',
     'MCIQdXGfwe9MWel+uC24yiM0yJpFLs/L7MSnU3qhQoQ='),
    ('x@y.io', '123456', '00000000000000000000000000000000', '4Yzpi+iwvNCbM9+FeKkD8HixVi1/K7RjUV8eTuQIXxg='),
    ('deadbeef-1234567890abcdef-fedcba@long-domain.example.org', 'a much longer password than one block',
     'deadbeefff234567890abcde0ffedcba', '+AP8P76mYwrVjfzTcl4a8huYw9h/QMELYiQUGuzUocE='),
]
for email, pw, iv, want in VECTORS:
    check('iv      ' + email, K._js_hex_iv(email).hex() == iv, K._js_hex_iv(email).hex())
    got = K.encode_password(email, pw)
    check('encode  ' + email, got == want, got)
    check('encoded form ' + email, K.looks_encoded(got))
check('e-mail case matters', K.encode_password('Viewer@example.com', 'secret123') != VECTORS[0][3])
check('parseInt quirks', [K._js_parse_int16(s) for s in ('a@', 'zz', '-1', '+f', '0x', ' a', '0', '')]
      == [10, None, -1, 15, None, 10, 0, None])

# ---- looks_encoded
for v in ('secret123', '', None, 'A' * 44, 'InnZqv+U2/tvbA8zFjEij2PeT5w9Jytr4jDSD2Euyi==', 'InnZqv+U2/tvbA8zFjEij2PeT5w9Jytr4jDSD2Euyiw',
          'InnZqv-U2_tvbA8zFjEij2PeT5w9Jytr4jDSD2Euyiw='):
    check('not encoded: %r' % (v,), not K.looks_encoded(v))
check('encoded with spaces around', K.looks_encoded('  InnZqv+U2/tvbA8zFjEij2PeT5w9Jytr4jDSD2Euyiw=\n'))


# ---- login with a fake http object
class Cookie(object):
    def __init__(self, name, value):
        self.name, self.value = name, value


class Resp(object):
    def __init__(self, body, cookies=(), status=200):
        self._body, self.cookies, self.status_code = body, cookies, status

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class Http(object):
    def __init__(self, resp):
        self.resp, self.calls = resp, []

    def post(self, url, **kw):
        self.calls.append((url, kw))
        if isinstance(self.resp, Exception):
            raise self.resp
        return self.resp


ENC = VECTORS[0][3]
h = Http(Resp({'d': '{"IsSuccess":true,"ErrorMessage":null}'}, [Cookie('Login', 'abc'), Cookie('ASP.NET_SessionId', 's1')]))
res = K.login('viewer@example.com', ENC, timeout=7, http=h)
check('login success', res == ({'Login': 'abc', 'ASP.NET_SessionId': 's1'}, None), res)
url, kw = h.calls[0]
check('login url', url == 'https://www.ktuvit.me/Services/MembershipService.svc/Login')
check('login body', kw['data'] == ('{"request":{"Email":"viewer@example.com","Password":"%s"}}' % ENC).encode(), kw['data'])
check('login headers', kw['headers'].get('content-type') == 'application/json'
      and kw['headers'].get('x-requested-with') == 'XMLHttpRequest' and kw['headers'].get('origin') == 'https://www.ktuvit.me')
check('login timeout', kw['timeout'] == 7)

res = K.login('viewer@example.com', ENC, http=Http(Resp({'d': '{"IsSuccess":false,"ErrorMessage":"wrong details"}'},
                                                        [Cookie('ASP.NET_SessionId', 's1')])))
check('wrong password', res == (None, 'wrong details'), res)
res = K.login('viewer@example.com', ENC, http=Http(Resp({'d': '{"IsSuccess":false}'})))
check('refused without a message', res == (None, 'login refused'), res)
res = K.login('viewer@example.com', ENC, http=Http(Resp({'IsSuccess': True}, {'Login': 'zz'})))
check('answer without the d wrapper, dict cookies', res == ({'Login': 'zz'}, None), res)
res = K.login('viewer@example.com', ENC, http=Http(Resp({'d': '{"IsSuccess":true}'}, [])))
check('success flag but no cookie', res[0] is None and 'cookie' in res[1], res)
res = K.login('viewer@example.com', ENC, http=Http(OSError('down')))
check('network error', res == (None, 'network error: OSError'), res)
res = K.login('viewer@example.com', ENC, http=Http(Resp(ValueError('html'), status=503)))
check('non-JSON answer', res == (None, 'unexpected answer (HTTP 503)'), res)
hn = Http(Resp({}))
check('empty input is not sent', K.login('', ENC, http=hn)[0] is None and K.login('a@b.c', '', http=hn)[0] is None and not hn.calls)

# ---- PATCH anchors (against a synthetic copy of the All_Subs lines; no real values)
import re  # noqa: E402
SRC = ("    # Set email and password\r\n    email = 'someone@example.com'\r\n    password = 'AAAA+/=='\r\n\r\n"
       "    data = f'{{\"request\":{{\"Email\":\"{email}\",\"Password\":\"{password}\"}}}}'\r\n")
out = re.sub(K.PATCH['email_line'], lambda m: m.group(1) + 'E()' + m.group(2), SRC)
out = re.sub(K.PATCH['password_line'], lambda m: m.group(1) + 'P()' + m.group(2), out)
check('PATCH regexes', "    email = E()\r\n    password = P()\r\n" in out and out.count('\r\n') == SRC.count('\r\n'), out)

if fails:
    print('FAILED: %d - %s' % (len(fails), ', '.join(fails)))
    sys.exit(1)
print('KTUVITAUTH TESTS OK')
