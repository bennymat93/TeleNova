# -*- coding: utf-8 -*-
"""6.3.0 (P2): the secrets envelope of the shared sync document.

With a passphrase set on a device (typed by the owner, kept on that device only - never in the document, never in
the repository), the keys and tokens of the settings (SECRET_RX) leave the plain settings and travel sealed in
doc['secrets']. A device without the passphrase keeps the envelope untouched and never puts its own keys in plain
text next to it.

The same primitive as the Telegram add-on's .tncfg files (configio.py) - hashlib / hmac only, so it opens on every
Kodi and in the browser (web/websync.js, WebCrypto):
  k            = PBKDF2-HMAC-SHA256(passphrase, salt, 200,000 rounds, 64 bytes): k[:32] cipher, k[32:] seal
  nonce        = HMAC-SHA256(k[32:], b'nonce' + plaintext)[:16]   (deterministic: the same content gives the same
                                                                   envelope, so an idle device never re-uploads)
  data         = plaintext XOR keystream, block i = HMAC-SHA256(k[:32], nonce + i as 8 bytes big-endian)
  seal         = HMAC-SHA256(k[32:], b'TNSEC1' + salt + nonce + data)
  plaintext    = canonical JSON of {addon id: {key: [value, time]}}
Pure Python, no Kodi imports; tested in qa/t_syncdoc.py."""
import base64
import hashlib
import hmac
import json
import os
import re

ROUNDS = 200000
SECRET_RX = re.compile(r'(?i)(_key$|token|secret|_hash$|^hash$|refresh|password|_pass$|cookie)')
_CACHE = {}


def is_secret(key):
    return bool(SECRET_RX.search(str(key or '')))


def _canon(obj):
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def _keys(passphrase, salt, rounds=ROUNDS):
    ck = (passphrase, salt, rounds)
    if ck not in _CACHE:
        if len(_CACHE) > 8:
            _CACHE.clear()
        raw = hashlib.pbkdf2_hmac('sha256', passphrase.encode('utf-8'), salt, int(rounds), 64)
        _CACHE[ck] = (raw[:32], raw[32:])
    return _CACHE[ck]


def _xor(key, nonce, data):
    out = bytearray(len(data))
    for i in range(0, len(data), 32):
        block = hmac.new(key, nonce + (i // 32).to_bytes(8, 'big'), hashlib.sha256).digest()
        part = data[i:i + 32]
        for j in range(len(part)):
            out[i + j] = part[j] ^ block[j]
    return bytes(out)


def _b64(b):
    return base64.b64encode(b).decode('ascii')


def seal(pairs, passphrase, salt=None, rounds=ROUNDS):
    """{aid: {key: [value, time]}} -> the envelope (a dict of short texts)"""
    salt = salt if salt else os.urandom(16)
    k_enc, k_mac = _keys(passphrase, salt, rounds)
    plain = _canon(pairs).encode('utf-8')
    nonce = hmac.new(k_mac, b'nonce' + plain, hashlib.sha256).digest()[:16]
    data = _xor(k_enc, nonce, plain)
    tag = hmac.new(k_mac, b'TNSEC1' + salt + nonce + data, hashlib.sha256).digest()
    return {'v': 1, 'kdf': int(rounds), 'salt': _b64(salt), 'nonce': _b64(nonce), 'data': _b64(data), 'seal': _b64(tag)}


def salt_of(env):
    try:
        return base64.b64decode(env['salt'])
    except Exception:
        return None


def open_env(env, passphrase):
    """the envelope -> {aid: {key: [value, time]}}, or None (no passphrase, a wrong one, a damaged envelope)"""
    if not passphrase or not isinstance(env, dict) or env.get('v') != 1:
        return None
    try:
        salt, nonce = base64.b64decode(env['salt']), base64.b64decode(env['nonce'])
        data, tag = base64.b64decode(env['data']), base64.b64decode(env['seal'])
        rounds = int(env.get('kdf') or ROUNDS)
        if rounds < 10000 or rounds > 5000000:
            return None
        k_enc, k_mac = _keys(passphrase, salt, rounds)
        want = hmac.new(k_mac, b'TNSEC1' + salt + nonce + data, hashlib.sha256).digest()
        if not hmac.compare_digest(want, tag):
            return None
        out = json.loads(_xor(k_enc, nonce, data).decode('utf-8'))
        return out if isinstance(out, dict) else None
    except Exception:
        return None


def take_secrets(settings):
    """removes the secret keys from {aid: {key: pair}} (in place) -> {aid: {key: pair}} of what was removed"""
    out = {}
    for aid, keys in (settings or {}).items():
        if not isinstance(keys, dict):
            continue
        for k in [k for k in keys if is_secret(k)]:
            out.setdefault(aid, {})[k] = keys.pop(k)
    return out
