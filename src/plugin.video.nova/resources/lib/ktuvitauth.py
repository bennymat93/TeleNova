# -*- coding: utf-8 -*-
"""Ktuvit.me login with the viewer's own account (pure Python, no xbmc imports).

ktuvit.me never receives the plain password. Its login page (js/Modules/LoginHandler.js, function Encrypt)
computes, with CryptoJS 3.1.2:

    iv   = CryptoJS.enc.Hex.parse(email)                       # the e-mail read AS IF it were hex (quirky, see _js_hex_iv)
    key  = CryptoJS.PBKDF2(encryptionSalt, email, {keySize: 128/32, iterations: 3000})   # HMAC-SHA1, 16 bytes;
                                                               # the site constant is the PBKDF2 *password*, the e-mail the salt
    ct   = AES-128-CBC(key, iv, PKCS7).encrypt(utf8(password))
    sent = base64(SHA256(ct))                                  # 44 characters, ends with '='

`encryptionSalt` is a constant printed inline in the site's pages (Login.aspx: var encryptionSalt = '...').
The e-mail is used exactly as typed (case-sensitive, not trimmed), so it must be typed as it was at registration.
"""
import base64
import binascii
import hashlib
import json
import re

KTUVIT_URL = 'https://www.ktuvit.me'
LOGIN_URL = KTUVIT_URL + '/Services/MembershipService.svc/Login'
ENCRYPTION_SALT = 'C8928DC731EC4E30AE6C523A34BE353A'   # the site's inline `var encryptionSalt`
PBKDF2_ITERATIONS = 3000

# The same headers All_Subs' login_to_ktuvit() sends.
HEADERS = {
    'authority': 'www.ktuvit.me',
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'x-requested-with': 'XMLHttpRequest',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
                  'Chrome/85.0.4183.121 Safari/537.36',
    'content-type': 'application/json',
    'origin': KTUVIT_URL,
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    'accept-language': 'en-US,en;q=0.9',
}

# Anchors in All_Subs' resources/sources/ktuvit.py for an in-place patch (the values are matched, never stored here).
PATCH = {
    'file': 'resources/sources/ktuvit.py',
    'function': 'def login_to_ktuvit():',
    'email_line': r"(?m)^(    email = )'[^'\r\n]*'[ \t]*(\r?)$",
    'password_line': r"(?m)^(    password = )'[^'\r\n]*'[ \t]*(\r?)$",
    'cache_call': "cache.get(login_to_ktuvit,1, table='subs')",
    'cache_call_count': 2,
}

_HEX = '0123456789abcdefABCDEF'
_JS_SPACE = set('\t\n\x0b\x0c\r \xa0            '
                '    　﻿')


# ---------------------------------------------------------------- CryptoJS.enc.Hex.parse(email) -> IV
def _js_parse_int16(s):
    """JavaScript parseInt(s, 16); None stands for NaN."""
    i = 0
    while i < len(s) and s[i] in _JS_SPACE:
        i += 1
    sign = 1
    if i < len(s) and s[i] in '+-':
        sign = -1 if s[i] == '-' else 1
        i += 1
    if s[i:i + 2] in ('0x', '0X'):
        i += 2
    j = i
    while j < len(s) and s[j] in _HEX:
        j += 1
    if j == i:
        return None
    return sign * int(s[i:j], 16)


def _utf16_units(text):
    raw = text.encode('utf-16-le', 'surrogatepass')
    return [chr(raw[k] | (raw[k + 1] << 8)) for k in range(0, len(raw), 2)]


def _js_hex_iv(email):
    """The 16 IV bytes CryptoJS uses for `iv: CryptoJS.enc.Hex.parse(email)`.

    Hex.parse does, for j = 0, 2, 4...:  words[j >>> 3] |= parseInt(str.substr(j, 2), 16) << (24 - (j % 8) * 4)
    An e-mail is not hex, so every pair goes through parseInt's leniency: 'a@' -> 10, 'zz' -> NaN -> 0,
    '-1' -> -1 (which sets all the higher bits of the word), '0x' -> NaN. CBC then reads the first four words
    (a missing word acts as 0; anything after 32 characters is ignored)."""
    units = _utf16_units(email)
    words = [0, 0, 0, 0]
    for j in range(0, min(len(units), 32), 2):
        val = _js_parse_int16(''.join(units[j:j + 2]))
        if val is None:
            continue
        words[j >> 3] |= (val << (24 - (j % 8) * 4)) & 0xFFFFFFFF
    return b''.join(w.to_bytes(4, 'big') for w in words)


# ---------------------------------------------------------------- AES-128 (encrypt only), CBC, PKCS7
def _make_sbox():
    exp, log = [0] * 510, [0] * 256
    x = 1
    for i in range(255):
        exp[i] = x
        log[x] = i
        x ^= ((x << 1) ^ (0x11B if x & 0x80 else 0)) & 0x1FF
        x &= 0xFF
    for i in range(255, 510):
        exp[i] = exp[i - 255]
    box = [0] * 256
    for v in range(256):
        inv = exp[255 - log[v]] if v else 0
        r = inv
        for _ in range(4):
            inv = ((inv << 1) | (inv >> 7)) & 0xFF
            r ^= inv
        box[v] = r ^ 0x63
    return box


_SBOX = _make_sbox()


def _xtime(a):
    return ((a << 1) ^ 0x1B) & 0xFF if a & 0x80 else a << 1


def _expand_key(key):
    w = [list(key[i:i + 4]) for i in range(0, 16, 4)]
    rcon = 1
    for i in range(4, 44):
        t = list(w[i - 1])
        if i % 4 == 0:
            t = [_SBOX[t[1]] ^ rcon, _SBOX[t[2]], _SBOX[t[3]], _SBOX[t[0]]]
            rcon = _xtime(rcon)
        w.append([w[i - 4][k] ^ t[k] for k in range(4)])
    return [sum(w[r * 4:r * 4 + 4], []) for r in range(11)]


def _encrypt_block(block, rkeys):
    s = [block[i] ^ rkeys[0][i] for i in range(16)]
    for rnd in range(1, 11):
        s = [_SBOX[b] for b in s]
        s = [s[(i + 4 * (i % 4)) % 16] for i in range(16)]          # ShiftRows (column-major state)
        if rnd < 10:
            out = []
            for c in range(0, 16, 4):
                a = s[c:c + 4]
                t = a[0] ^ a[1] ^ a[2] ^ a[3]
                out += [a[k] ^ t ^ _xtime(a[k] ^ a[(k + 1) % 4]) for k in range(4)]
            s = out
        s = [s[i] ^ rkeys[rnd][i] for i in range(16)]
    return bytes(s)


def _aes128_cbc_pkcs7(key, iv, data):
    rkeys = _expand_key(key)
    pad = 16 - len(data) % 16
    data = data + bytes([pad]) * pad
    prev, out = iv, []
    for i in range(0, len(data), 16):
        prev = _encrypt_block(bytes(a ^ b for a, b in zip(data[i:i + 16], prev)), rkeys)
        out.append(prev)
    return b''.join(out)


# ---------------------------------------------------------------- public API
def encode_password(email, password, salt=None):
    """The string ktuvit.me's login expects in "Password", computed like the site's LoginHandler.js Encrypt()."""
    site = (salt or ENCRYPTION_SALT).encode('utf-8')
    key = hashlib.pbkdf2_hmac('sha1', site, email.encode('utf-8'), PBKDF2_ITERATIONS, 16)
    cipher = _aes128_cbc_pkcs7(key, _js_hex_iv(email), password.encode('utf-8'))
    return base64.b64encode(hashlib.sha256(cipher).digest()).decode('ascii')


def looks_encoded(value):
    """True when the string already has the encoded form: standard base64 of a 32-byte SHA-256 (44 chars)."""
    if not isinstance(value, str):
        return False
    value = value.strip()
    if len(value) != 44 or not re.match(r'^[A-Za-z0-9+/]{43}=$', value):
        return False
    try:
        return len(base64.b64decode(value, validate=True)) == 32
    except (binascii.Error, ValueError):
        return False


def _cookies_dict(jar):
    if jar is None:
        return {}
    if isinstance(jar, dict):
        return dict(jar)
    out = {}
    for c in jar:                       # the way All_Subs reads them: cookie.name / cookie.value
        if hasattr(c, 'name'):
            out[c.name] = c.value
        else:                           # a mapping-like jar iterates its names
            out[c] = jar[c]
    return out


def login(email, encoded, timeout=10, http=None):
    """POST the request All_Subs posts. -> (cookies_dict, None) on success, (None, short_reason) otherwise.

    Success is what the site's own JS checks: the JSON answer {"d": "<json string>"} whose inner object has
    IsSuccess true (ErrorMessage carries the site's reason otherwise); the login cookie must also be present."""
    if not email or not encoded:
        return None, 'missing e-mail or password'
    if http is None:
        import requests as http
    data = json.dumps({'request': {'Email': email, 'Password': encoded}}, separators=(',', ':'), ensure_ascii=False)
    try:
        resp = http.post(LOGIN_URL, headers=dict(HEADERS), data=data.encode('utf-8'), timeout=timeout)
    except Exception as e:              # requests.RequestException, socket errors, a fake raising in tests
        return None, 'network error: %s' % type(e).__name__
    status = getattr(resp, 'status_code', 200)
    try:
        body = resp.json()
        if isinstance(body, dict) and 'd' in body:
            body = body['d']
            if isinstance(body, str):
                body = json.loads(body)
        if not isinstance(body, dict):
            raise ValueError('unexpected answer')
    except Exception:
        return None, 'unexpected answer (HTTP %s)' % status
    if not body.get('IsSuccess'):
        return None, str(body.get('ErrorMessage') or 'login refused')[:120]
    cookies = _cookies_dict(getattr(resp, 'cookies', None))
    if not cookies.get('Login'):
        return None, 'no login cookie in the answer'
    return cookies, None
