# -*- coding: utf-8 -*-
"""All in one (the same as web/aio.js): the household's whole setup behind one user name and password.

  bits = PBKDF2-SHA-256(name.strip().lower() + "\\0" + password, b"bn-aio-v1", 310000) -> 64 bytes
  id   = hex(bits[:32])                the vault's address at the helper Worker (GET /aio/<id>)
  seal = base64(bits[32:])             the password of the sealed file inside (configio.py / web sealed.js)

The vault is a full backup made by the site (web/backup.js fullBackup): settings and keys, the Real-Debrid sign-in, the
Telegram application details and the household secret of the automatic Telegram sign-in (linklogin.py). Never a
Telegram login itself. Nothing of the user name or password is kept on the device.
No Kodi module is imported here (tested outside Kodi: qa/t_aio.py, and against the browser: qa/web/t_aio.js)."""
import base64
import hashlib

HELPER = 'https://telenova-helper.hmi-analyzer.workers.dev'
ORIGIN = 'https://bennymat93.github.io'
ROUNDS = 310000


class AioError(Exception):
    pass


def keys(name, password):
    bits = hashlib.pbkdf2_hmac('sha256', (str(name).strip().lower() + '\0' + str(password)).encode('utf-8'),
                               b'bn-aio-v1', ROUNDS, 64)
    return bits[:32].hex(), base64.b64encode(bits[32:]).decode('ascii')


def ok_input(name, password):
    return len(str(name or '').strip()) >= 3 and len(str(password or '')) >= 8


def fetch(name, password, http=None, timeout=20):
    """-> (sealed bytes, seal password). Raises AioError('short' | 'none' | 'busy' | 'net')."""
    if not ok_input(name, password):
        raise AioError('short')
    vid, seal = keys(name, password)
    if http is None:
        import requests
        http = requests
    try:
        r = http.get('%s/aio/%s' % (HELPER, vid), timeout=timeout, headers={'Origin': ORIGIN})
    except Exception:
        raise AioError('net')
    code = getattr(r, 'status_code', 0)
    if code == 404:
        raise AioError('none')
    if code == 429:
        raise AioError('busy')
    if code != 200 or not r.content:
        raise AioError('net')
    return r.content, seal
