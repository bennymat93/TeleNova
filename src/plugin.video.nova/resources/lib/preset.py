# -*- coding: utf-8 -*-
"""Password-locked pre-configured profile.

Admin: configure every account on one box -> "Create locked profile" -> choose password.
All account data (Real-Debrid, Trakt, IPTV, keys, subtitle server...) is packed with the
backup engine and encrypted (PBKDF2-SHA256 200k + HMAC-SHA256 stream + HMAC tag, stdlib only).
Users: "Unlock pre-configured profile" -> password -> everything is connected.
Without the password the user simply configures his own details as before.
Credentials are never stored in the repository in clear text.
"""
import hashlib
import hmac
import io
import os
import time
import zipfile

import xbmcgui
import xbmcvfs

from .common import PROFILE, ui_lang, load, save
from . import backup

MAGIC = b'NVP1'
LOCAL = os.path.join(PROFILE, 'preset.nvp')
SHIPPED = xbmcvfs.translatePath('special://home/addons/plugin.video.nova/resources/preset.nvp')
# 1.4.12: two encrypted backups ship inside the build (owner, 09/10): the accounts profile and the whole build
SHIPPED_ALL = [('accounts', SHIPPED),
               ('build', xbmcvfs.translatePath('special://home/addons/plugin.video.nova/resources/build.nvp'))]
ITER = 200000

S = {
    'create': ('צור פרופיל מוגדר מראש (נעול בסיסמה)', 'Create locked pre-configured profile', 'Создать защищённый профиль'),
    'unlock': ('פתח פרופיל מוגדר מראש', 'Unlock pre-configured profile', 'Разблокировать готовый профиль'),
    'pw': ('סיסמה', 'Password', 'Пароль'),
    'pw2': ('הקלד שוב את הסיסמה', 'Repeat password', 'Повторите пароль'),
    'short': ('סיסמה חייבת להכיל לפחות 8 תווים', 'Password must be at least 8 characters', 'Минимум 8 символов'),
    'nomatch': ('הסיסמאות אינן תואמות', 'Passwords do not match', 'Пароли не совпадают'),
    'made': ('הפרופיל נוצר ונשמר', 'Profile created and saved', 'Профиль создан'),
    'export': ('לייצא עותק לתיקייה (USB / רשת)?', 'Export a copy to a folder (USB / network)?', 'Экспортировать копию в папку?'),
    'none': ('לא נמצא פרופיל. בחר קובץ .nvp', 'No profile found. Pick a .nvp file', 'Профиль не найден. Выберите файл .nvp'),
    'bad': ('סיסמה שגויה', 'Wrong password', 'Неверный пароль'),
    'locked': ('יותר מדי ניסיונות. נסה שוב בעוד %d דקות', 'Too many attempts. Try again in %d min', 'Слишком много попыток. Повторите через %d мин'),
    'pick': ('שחזור מגיבוי מובנה', 'Restore a built-in backup', 'Восстановить встроенную копию'),
    'b_accounts': ('גיבוי חשבונות (Real-Debrid, IPTV, מפתחות)', 'Accounts backup (Real-Debrid, IPTV, keys)',
                   'Копия аккаунтов (Real-Debrid, IPTV, ключи)'),
    'b_build': ('גיבוי בילד מלא (הגדרות, מראה, מועדפים וחשבונות)', 'Full build backup (settings, look, favourites, accounts)',
                'Полная копия сборки (настройки, вид, избранное, аккаунты)'),
    'b_file': ('ייבוא קובץ גיבוי מהמכשיר...', 'Import a backup file from this device...', 'Импорт файла копии с устройства...'),
    'browse': ('בחר קובץ גיבוי (.nvp / .zip)', 'Pick a backup file (.nvp / .zip)', 'Выберите файл копии (.nvp / .zip)'),
    'up': ('.. למעלה', '.. up', '.. вверх'),
    'empty': ('אין כאן קבצי גיבוי', 'No backup files here', 'Здесь нет файлов копий'),
    'done': ('כל החשבונות חוברו. Kodi ייסגר – פתח אותו מחדש.', 'All accounts connected. Kodi will close – open it again.',
             'Все аккаунты подключены. Kodi закроется – откройте снова.'),
}


def s(k):
    return S[k][{'he': 0, 'en': 1, 'ru': 2}[ui_lang()]]


def _keys(pw, salt):
    k = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), salt, ITER, 64)
    return k[:32], k[32:]


CHUNK = 1 << 20         # a multiple of 32: every chunk starts on a keystream block


def _stream(key, nonce, data):
    # 3.3: 1 MB at a time. One giant int + the whole keystream took 150-200 MB for the shipped 24 MB profile
    # (1 GB TV boxes were killed). Same keystream as before: block i = HMAC(key, nonce + i as 8 bytes), i counted
    # in 32-byte blocks from the start of the data - files made by older versions decrypt bit for bit
    base = hmac.new(key, nonce, hashlib.sha256)
    view = memoryview(data)
    n = len(view)
    out = bytearray(n)
    for off in range(0, n, CHUNK):
        part = view[off:off + CHUNK]
        m = len(part)
        ks = bytearray()
        for i in range(off // 32, (off + m + 31) // 32):
            h = base.copy()
            h.update(i.to_bytes(8, 'big'))
            ks += h.digest()
        out[off:off + m] = (int.from_bytes(part, 'big') ^ int.from_bytes(ks[:m], 'big')).to_bytes(m, 'big')
    return bytes(out)


def encrypt(pw, plain):
    salt, nonce = os.urandom(16), os.urandom(16)
    ek, mk = _keys(pw, salt)
    ct = _stream(ek, nonce, plain)
    tag = hmac.new(mk, MAGIC + salt + nonce, hashlib.sha256)    # 3.3: same tag, without one more copy of the data
    tag.update(ct)
    return MAGIC + salt + nonce + tag.digest() + ct


def decrypt(pw, blob):
    if blob[:4] != MAGIC:
        raise ValueError('not a NovaTV profile')
    # 3.3: the ciphertext is a view into the blob (no copies of 24 MB), the tag is fed chunk by chunk
    salt, nonce, tag, ct = bytes(blob[4:20]), bytes(blob[20:36]), bytes(blob[36:68]), memoryview(blob)[68:]
    ek, mk = _keys(pw, salt)
    mac = hmac.new(mk, bytes(blob[:36]), hashlib.sha256)
    for off in range(0, len(ct), CHUNK):
        mac.update(ct[off:off + CHUNK])
    if not hmac.compare_digest(tag, mac.digest()):
        return None
    return _stream(ek, nonce, ct)


def create():
    d = xbmcgui.Dialog()
    pw = d.input(s('pw'), option=xbmcgui.ALPHANUM_HIDE_INPUT)
    if len(pw) < 8:
        return d.ok('TeleNova', s('short'))
    if d.input(s('pw2'), option=xbmcgui.ALPHANUM_HIDE_INPUT) != pw:
        return d.ok('TeleNova', s('nomatch'))
    tmp = os.path.join(xbmcvfs.translatePath('special://temp/'), 'nvp.zip')
    try:
        backup.make_zip(tmp)
        with open(tmp, 'rb') as f:
            blob = encrypt(pw, f.read())
    finally:                    # 3.3: the plain copy of every account never stays in temp, also after an error
        for leftover in (tmp, tmp + '.part'):
            if os.path.exists(leftover):
                os.remove(leftover)
    with open(LOCAL, 'wb') as f:
        f.write(blob)
    if d.yesno('TeleNova', '%s\n%s' % (s('made'), s('export'))):
        dest = d.browse(3, 'TeleNova', 'files', '', False, False, '')
        if dest:
            xbmcvfs.copy(LOCAL, dest.rstrip('/\\') + '/preset.nvp')
    d.notification('TeleNova', s('made'))


def roots():
    """every place a backup file may be on this device: Kodi's own folders, the device's storage (internal, SD
    card, USB), Downloads / Desktop, network sources the viewer added"""
    import glob
    import xbmc
    out, seen = [], set()

    def add(label, path):
        p = path.rstrip('/' + chr(92)) + os.sep
        if p not in seen and os.path.isdir(p):
            seen.add(p)
            out.append((label, p))
    home = os.path.expanduser('~')
    for name in ('Downloads', 'Desktop', 'Documents'):
        add(name, os.path.join(home, name))
    if xbmc.getCondVisibility('System.Platform.Android'):
        for p in ['/storage/emulated/0/Download', '/storage/emulated/0', '/sdcard/Download', '/sdcard'] +                 sorted(glob.glob('/storage/*-*')) + sorted(glob.glob('/mnt/media_rw/*')):
            add(p, p)
    elif xbmc.getCondVisibility('System.Platform.Windows'):
        import string
        for d in string.ascii_uppercase:
            add('%s:' % d, '%s:' % d + chr(92))
    else:
        for p in sorted(glob.glob('/media/*')) + sorted(glob.glob('/media/*/*')) + sorted(glob.glob('/mnt/*')) +                 sorted(glob.glob('/Volumes/*')):
            add(p, p)
    for label, sp in (('Kodi – home', 'special://home/'), ('Kodi – userdata', 'special://profile/'),
                      ('Kodi – temp', 'special://temp/')):
        add(label, xbmcvfs.translatePath(sp))
    return out


def pick_file():
    """a file browser over every storage location (Kodi's own browser shows only added sources)"""
    d = xbmcgui.Dialog()
    places = roots()
    path = None
    while True:
        if path is None:
            i = d.select(s('browse'), ['[B]%s[/B]   [COLOR grey]%s[/COLOR]' % (l, p) for l, p in places])
            if i < 0:
                return None
            path = places[i][1]
            continue
        try:
            names = sorted(os.listdir(path), key=str.lower)
        except OSError:
            names = []
        dirs = [n for n in names if os.path.isdir(os.path.join(path, n)) and not n.startswith('.')]
        files = [n for n in names if n.lower().endswith(('.nvp', '.zip'))]
        rows = [s('up')] + ['[COLOR gold]%s[/COLOR]  [COLOR grey]%.1f MB[/COLOR]' % (f, os.path.getsize(os.path.join(path, f)) / 1e6)
                            for f in files] + ['%s/' % n for n in dirs]
        i = d.select('%s – %s' % (s('browse'), path), rows)
        if i < 0:
            return None
        if i == 0:
            parent = os.path.dirname(path.rstrip('/' + chr(92)))
            path = None if parent == path.rstrip('/' + chr(92)) or any(path == p for _, p in places) else parent + os.sep
            continue
        if i <= len(files):
            return os.path.join(path, files[i - 1])
        path = os.path.join(path, dirs[i - 1 - len(files)]) + os.sep


def unlock():
    d = xbmcgui.Dialog()
    guard = load('preset_guard.json', {'fails': 0, 'until': 0})
    if time.time() < guard['until']:
        return d.ok('TeleNova', s('locked') % (1 + (guard['until'] - time.time()) // 60))
    shipped = [(k, p) for k, p in SHIPPED_ALL if os.path.exists(p)]
    if os.path.exists(LOCAL):
        shipped.insert(0, ('accounts', LOCAL))
    rows = [s('b_' + k) for k, _ in shipped] + [s('b_file')]
    i = d.select(s('pick'), rows)
    if i < 0:
        return
    if i < len(shipped):
        path = shipped[i][1]
    else:
        src = pick_file()
        if not src:
            return
        path = src
    with open(path, 'rb') as f:
        blob = f.read()
    if blob[:4] != MAGIC:                       # a plain BN backup zip: restore without a password
        plain = blob
    else:
        pw = d.input(s('pw'), option=xbmcgui.ALPHANUM_HIDE_INPUT)
        if not pw:
            return
        plain = decrypt(pw, blob)
    if plain is None:
        guard['fails'] += 1
        if guard['fails'] >= 5:
            guard = {'fails': 0, 'until': time.time() + 600}
        save('preset_guard.json', guard)
        return d.ok('TeleNova', s('bad'))
    save('preset_guard.json', {'fails': 0, 'until': 0})
    # 3.3: from here the service must not write its files over the restored ones (the profile is unpacked from
    # memory: no temporary file to delete)
    win = xbmcgui.Window(10000)
    win.setProperty('NovaTV.restoring', '1')
    try:
        with zipfile.ZipFile(io.BytesIO(plain)) as z:
            backup.extract(z)       # 3.3: without the settings of add-ons the build no longer has
    except Exception:
        win.clearProperty('NovaTV.restoring')       # the restore failed: Kodi goes on running
        raise
    d.ok('TeleNova', s('done'))
    os._exit(1)
