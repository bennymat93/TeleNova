# -*- coding: utf-8 -*-
"""B18: old (one giant int) and new (1 MB chunks) preset encryption are interchangeable, bit for bit."""
import hashlib
import hmac
import os
import sys
import tempfile
import types

ROOT = sys.argv[1]          # ...\plugin.video.nova
TMP = tempfile.mkdtemp()

# ---- stub Kodi modules so resources.lib.preset (and common / backup) import
for name in ('xbmc', 'xbmcgui', 'xbmcvfs', 'xbmcaddon', 'xbmcplugin'):
    sys.modules[name] = types.ModuleType(name)
xbmc, xbmcgui, xbmcvfs, xbmcaddon = (sys.modules[n] for n in ('xbmc', 'xbmcgui', 'xbmcvfs', 'xbmcaddon'))
for lvl in ('LOGINFO', 'LOGWARNING', 'LOGERROR', 'LOGDEBUG'):
    setattr(xbmc, lvl, 0)
xbmc.log = lambda *a, **k: None
xbmc.getCondVisibility = lambda *a: False
xbmc.getInfoLabel = lambda *a: ''
xbmc.getLanguage = lambda *a, **k: 'en'
xbmc.Monitor = object
xbmc.Player = object
xbmc.executebuiltin = lambda *a, **k: None
xbmc.executeJSONRPC = lambda *a, **k: '{}'
xbmc.ISO_639_1 = 0
xbmcvfs.translatePath = lambda p: os.path.join(TMP, p.replace('special://', '').replace('/', os.sep))


class _Addon(object):
    def __init__(self, *a, **k):
        pass

    def getAddonInfo(self, k):
        return os.path.join(TMP, k)

    def getSetting(self, k):
        return ''

    def getSettingBool(self, k):
        return False

    def setSetting(self, k, v):
        pass

    def getLocalizedString(self, i):
        return ''


xbmcaddon.Addon = _Addon


class _Any(object):
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, n):
        return lambda *a, **k: ''


xbmcgui.Dialog = xbmcgui.Window = xbmcgui.ListItem = xbmcgui.DialogProgress = _Any
for c in ('ALPHANUM_HIDE_INPUT', 'NOTIFICATION_INFO', 'NOTIFICATION_WARNING', 'NOTIFICATION_ERROR'):
    setattr(xbmcgui, c, 0)

sys.path.insert(0, ROOT)
from resources.lib import preset as new      # noqa: E402

# ---- the OLD implementation, copied verbatim from preset.py before the change
MAGIC = b'NVP1'
ITER = 200000


def _keys(pw, salt):
    k = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), salt, ITER, 64)
    return k[:32], k[32:]


def _stream(key, nonce, data):
    base = hmac.new(key, nonce, hashlib.sha256)
    ks = bytearray()
    for i in range((len(data) + 31) // 32):
        h = base.copy()
        h.update(i.to_bytes(8, 'big'))
        ks += h.digest()
    n = len(data)
    return (int.from_bytes(data, 'big') ^ int.from_bytes(bytes(ks[:n]), 'big')).to_bytes(n, 'big')


def encrypt(pw, plain):
    salt, nonce = os.urandom(16), os.urandom(16)
    ek, mk = _keys(pw, salt)
    ct = _stream(ek, nonce, plain)
    return MAGIC + salt + nonce + hmac.new(mk, MAGIC + salt + nonce + ct, hashlib.sha256).digest() + ct


def decrypt(pw, blob):
    if blob[:4] != MAGIC:
        raise ValueError('not a NovaTV profile')
    salt, nonce, tag, ct = blob[4:20], blob[20:36], blob[36:68], blob[68:]
    ek, mk = _keys(pw, salt)
    if not hmac.compare_digest(tag, hmac.new(mk, blob[:36] + ct, hashlib.sha256).digest()):
        return None
    return _stream(ek, nonce, ct)


# ---- the test
assert sys.set_int_max_str_digits if hasattr(sys, 'set_int_max_str_digits') else True
PW = 'סיסמה-password-1'
SIZES = (0, 1, 31, 32, 33, 1048575, 1048576, 1048577, 3 * 1048576 + 5)
bad = 0
for n in SIZES:
    plain = os.urandom(n)
    old_blob, new_blob = encrypt(PW, plain), new.encrypt(PW, plain)
    checks = {
        'old->new': new.decrypt(PW, old_blob) == plain,
        'new->old': decrypt(PW, new_blob) == plain,
        'new->new': new.decrypt(PW, new_blob) == plain,
        'wrong pw': new.decrypt(PW + 'x', old_blob) is None and new.decrypt(PW + 'x', new_blob) is None,
        'type': isinstance(new.decrypt(PW, old_blob), bytes) and isinstance(new_blob, bytes),
    }
    if n:
        t = bytearray(old_blob)
        t[-1] ^= 1
        checks['tamper'] = new.decrypt(PW, bytes(t)) is None
    # same key + nonce -> identical ciphertext from both keystream implementations
    k, nonce = os.urandom(32), os.urandom(16)
    checks['stream=='] = new._stream(k, nonce, plain) == _stream(k, nonce, plain)
    ok = all(checks.values())
    bad += not ok
    print('%9d bytes  %s  %s' % (n, 'PASS' if ok else 'FAIL', '' if ok else checks))
try:
    new.decrypt(PW, b'XXXX' + b'0' * 80)
    print('magic check FAIL')
    bad += 1
except ValueError:
    print('bad magic -> ValueError  PASS')
print('RESULT: %s' % ('ALL PASS' if not bad else '%d FAILED' % bad))
sys.exit(1 if bad else 0)
