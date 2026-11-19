# -*- coding: utf-8 -*-
"""Automatic Telegram sign-in between the devices of one household (web/tg.js does the same in the browser).

Telegram lets a new device in when a device that is ALREADY signed in accepts its login token (auth.acceptLoginToken -
what scanning the QR code does). Every device of the household keeps one secret (`tg_link`, 43 characters). It travels
inside the full backup / configuration file, never anything else of the login: each device gets its own Telegram
login, a session is never copied (two devices on one session lose both - AUTH_KEY_DUPLICATED).

  * a device that is signing in leaves its login token, sealed with the secret, in the helper Worker's mailbox
    (PUT /link/<channel>, 90 s);
  * a device that is signed in looks into the mailbox every few seconds, opens what it finds, removes it and accepts it.

The seal uses only hashlib / hmac, so it runs in any Kodi Python and in any browser (WebCrypto SHA-256 + HMAC):
  channel = sha256("bn-link-channel:" + secret)[:32 hex]
  encKey  = sha256("bn-link-key:" + secret),  macKey = sha256("bn-link-mac:" + secret)
  stream  = sha256(encKey || nonce || u32be(i)) for i = 0, 1, ...      (nonce: 16 random bytes)
  sealed  = nonce || (token XOR stream) || hmac_sha256(macKey, nonce || ct)[:16]
Nothing here imports Kodi (tested outside Kodi: qa/t_linklogin.py, and against the browser code: qa/web/t_tglink.js).
"""
import base64
import hashlib
import hmac
import os
import re
import struct

HELPER = 'https://telenova-helper.hmi-analyzer.workers.dev'
ORIGIN = 'https://bennymat93.github.io'      # the helper answers its own site only
SECRET_RE = re.compile(r'^[\w-]{40,64}$')
MAX = 512


def new_secret():
    return base64.urlsafe_b64encode(os.urandom(32)).decode('ascii').rstrip('=')


def valid(secret):
    return bool(secret) and bool(SECRET_RE.match(str(secret)))


def channel(secret):
    return hashlib.sha256(('bn-link-channel:' + secret).encode('utf-8')).hexdigest()[:32]


def _keys(secret):
    enc = hashlib.sha256(('bn-link-key:' + secret).encode('utf-8')).digest()
    mac = hashlib.sha256(('bn-link-mac:' + secret).encode('utf-8')).digest()
    return enc, mac


def _stream(enc, nonce, n):
    out, i = b'', 0
    while len(out) < n:
        out += hashlib.sha256(enc + nonce + struct.pack('>I', i)).digest()
        i += 1
    return out[:n]


def seal(secret, data, nonce=None):
    enc, mac = _keys(secret)
    nonce = nonce or os.urandom(16)
    ct = bytes(a ^ b for a, b in zip(data, _stream(enc, nonce, len(data))))
    return nonce + ct + hmac.new(mac, nonce + ct, hashlib.sha256).digest()[:16]


def open_(secret, blob):
    """-> the token, or raises ValueError when it was not sealed with this secret (or was changed)"""
    blob = bytes(blob)
    if len(blob) < 33 or len(blob) > MAX + 32:
        raise ValueError('size')
    enc, mac = _keys(secret)
    nonce, ct, tag = blob[:16], blob[16:-16], blob[-16:]
    if not hmac.compare_digest(hmac.new(mac, nonce + ct, hashlib.sha256).digest()[:16], tag):
        raise ValueError('seal')
    return bytes(a ^ b for a, b in zip(ct, _stream(enc, nonce, len(ct))))


class Mailbox(object):
    def __init__(self, http=None, base=HELPER, timeout=10):
        self.http = http
        self.base = base.rstrip('/')
        self.timeout = timeout

    def _http(self):
        if self.http is None:
            import requests
            self.http = requests.Session()
        return self.http

    def _url(self, secret):
        return '%s/link/%s' % (self.base, channel(secret))

    def ask(self, secret, token):
        """the device that wants in: leave its sealed token. -> True when the helper took it"""
        try:
            r = self._http().put(self._url(secret), data=seal(secret, bytes(token)), timeout=self.timeout,
                                 headers={'Origin': ORIGIN, 'Content-Type': 'application/octet-stream'})
            return r.status_code in (200, 204)
        except Exception:
            return False

    def take(self, secret):
        """the device that is in: a waiting token (opened and removed), or None"""
        try:
            r = self._http().get(self._url(secret), timeout=self.timeout, headers={'Origin': ORIGIN})
            if r.status_code != 200 or not r.content:
                return None
            token = open_(secret, r.content)
        except Exception:
            return None
        try:
            self._http().delete(self._url(secret), timeout=self.timeout, headers={'Origin': ORIGIN})
        except Exception:
            pass
        return token if 0 < len(token) <= MAX else None


def token_text(token):
    """the base64url text tgclient.qr_accept takes"""
    return base64.urlsafe_b64encode(bytes(token)).decode('ascii').rstrip('=')
