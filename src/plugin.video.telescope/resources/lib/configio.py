# -*- coding: utf-8 -*-
"""3.3.4: one file that carries the whole configuration of the Telegram add-on to another device.

What is inside: every setting of the add-on (API id / hash, keys, preferences), the Telegram session (the login
itself - after an import no code or QR is needed), the bot choices and statistics.

The session is a key to the account, so the file can be locked with a password:
  key  = PBKDF2-HMAC-SHA256(password, salt, 200,000 rounds) -> 32 bytes for the cipher + 32 bytes for the seal
  data = payload XOR keystream, keystream block i = HMAC-SHA256(cipher key, nonce + i)        (a PRF in counter mode)
  seal = HMAC-SHA256(seal key, header + nonce + data)   - a wrong password or a damaged file is refused, never
                                                          half-imported
Only hashlib / hmac are used: the same file opens on Windows, Android, iOS and macOS.
Pure Python, no Kodi imports (tested outside Kodi).
"""
import base64
import hashlib
import hmac
import json
import os
import time
import zlib

MAGIC = b'TNCFG1\n'
EXT = '.tncfg'
ROUNDS = 200000


class ConfigError(Exception):
    pass


def _keys(password, salt, rounds):
    raw = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, int(rounds), 64)
    return raw[:32], raw[32:]


def _xor_stream(key, nonce, data):
    out = bytearray(len(data))
    view = memoryview(data)
    for i in range(0, len(data), 32):
        block = hmac.new(key, nonce + (i // 32).to_bytes(8, 'big'), hashlib.sha256).digest()
        part = view[i:i + 32]
        n = len(part)
        out[i:i + n] = (int.from_bytes(part, 'big') ^ int.from_bytes(block[:n], 'big')).to_bytes(n, 'big')
    return bytes(out)


def pack(settings, files, password='', extra=None):
    """settings: {id: value}; files: {name: bytes}; -> bytes of the .tncfg file"""
    body = {'settings': settings, 'files': dict((k, base64.b64encode(v).decode('ascii')) for k, v in files.items()),
            'extra': extra or {}}
    payload = zlib.compress(json.dumps(body, ensure_ascii=False).encode('utf-8'), 9)
    head = {'format': 1, 'created': int(time.time()), 'encrypted': bool(password),
            'has_session': any(k.endswith('.session') for k in files), 'check': hashlib.sha256(payload).hexdigest()[:16]}
    if password:
        salt, nonce = os.urandom(16), os.urandom(16)
        head.update(salt=base64.b64encode(salt).decode(), rounds=ROUNDS)
        head.pop('check')
        header = json.dumps(head, sort_keys=True).encode('utf-8') + b'\n'
        k_enc, k_mac = _keys(password, salt, ROUNDS)
        data = _xor_stream(k_enc, nonce, payload)
        seal = hmac.new(k_mac, header + nonce + data, hashlib.sha256).digest()
        return MAGIC + header + nonce + data + seal
    return MAGIC + json.dumps(head, sort_keys=True).encode('utf-8') + b'\n' + payload


def header(blob):
    if not blob or not blob.startswith(MAGIC):
        raise ConfigError('not_a_config_file')
    end = blob.find(b'\n', len(MAGIC))
    if end < 0 or end > 4096:
        raise ConfigError('not_a_config_file')
    try:
        head = json.loads(blob[len(MAGIC):end].decode('utf-8'))
    except ValueError:
        raise ConfigError('not_a_config_file')
    if not isinstance(head, dict) or head.get('format') != 1:
        raise ConfigError('unsupported_version')
    return head, end + 1


def is_encrypted(blob):
    return bool(header(blob)[0].get('encrypted'))


def unpack(blob, password=''):
    """-> (settings, files, extra, header). Raises ConfigError('password_required' | 'wrong_password' | 'damaged')."""
    head, pos = header(blob)
    rest = blob[pos:]
    if head.get('encrypted'):
        if not password:
            raise ConfigError('password_required')
        if len(rest) < 48:
            raise ConfigError('damaged')
        nonce, data, seal = rest[:16], rest[16:-32], rest[-32:]
        try:
            salt = base64.b64decode(head['salt'])
            rounds = int(head.get('rounds') or ROUNDS)
        except Exception:
            raise ConfigError('damaged')
        if not 1000 <= rounds <= 5000000:
            raise ConfigError('damaged')
        k_enc, k_mac = _keys(password, salt, rounds)
        want = hmac.new(k_mac, blob[len(MAGIC):pos] + nonce + data, hashlib.sha256).digest()
        if not hmac.compare_digest(want, seal):
            raise ConfigError('wrong_password')      # (or a damaged file - the seal cannot tell them apart)
        payload = _xor_stream(k_enc, nonce, data)
    else:
        payload = rest
        if head.get('check') and hashlib.sha256(payload).hexdigest()[:16] != head['check']:
            raise ConfigError('damaged')
    try:
        body = json.loads(zlib.decompress(payload).decode('utf-8'))
        settings = body['settings']
        files = dict((str(k), base64.b64decode(v)) for k, v in body['files'].items())
    except Exception:
        raise ConfigError('damaged')
    if not isinstance(settings, dict):
        raise ConfigError('damaged')
    for name in files:
        if os.path.basename(name) != name or name.startswith('.'):
            raise ConfigError('damaged')             # a file name is a plain name - never a path
    return settings, files, body.get('extra') or {}, head


def file_name(now=None):
    return 'TeleNova-config-%s%s' % (time.strftime('%Y%m%d-%H%M', time.localtime(now or time.time())), EXT)
