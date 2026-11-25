# -*- coding: utf-8 -*-
"""Backup / restore of everything personal: accounts, history, favourites, IPTV, settings."""
import os
import time
import zipfile

import xbmc
import xbmcgui
import xbmcvfs

from .common import T, PROFILE, log

USERDATA = xbmcvfs.translatePath('special://profile/')
ADDON_DATA = ['plugin.video.nova', 'plugin.video.telescope', 'pvr.iptvsimple', 'service.subtitles.All_Subs',
              'plugin.video.youtube', 'skin.fentastic']
FILES = ['favourites.xml', 'sources.xml', 'passwords.xml', 'mediasources.xml']
# 3.3: + the Google Drive sign-in of the box that makes the backup (never part of a backup / locked profile)
SKIP = ('cache', 'cache.db', 'Thumbnails', 'temp', 'packages', '.tmp', 'preset.nvp', 'preset_guard.json',
        'gdrive_token.json', 'gdrive_state.json', 'sync_state.json', 'sync_meta.json')
AUTO_DIR = os.path.join(PROFILE, 'backups')


def is_session_file(name):
    """6.2.0: the Telegram login (Telethon's telegram.session + its -journal, or any *session* file) never goes into a
    backup and is never restored from one: a session copied to another device ends both logins
    (AUTH_KEY_DUPLICATED). Every device logs in itself (approve-from-another-device)."""
    import re  # 6.2.0: also SQLite -wal/-shm and an atomic-write .new beside the session
    base = name.replace('\\', '/').rsplit('/', 1)[-1]
    return bool(re.search(r'(?i)(\.session(-journal|-wal|-shm|\.new)?$|^(tg_|string_)?session(\.\w+)?$|auth_key)', base))


def _members():
    for a in ADDON_DATA:
        base = os.path.join(USERDATA, 'addon_data', a)
        for d, dirs, files in os.walk(base):
            # 4.1.1: no compiled files, and not the Telegram engine's downloaded libraries (lib/): they are built for
            # the device they were fetched on - restored on another system they break the engine, and it fetches
            # its own anyway. port.json is the address of this device's running service.
            dirs[:] = [x for x in dirs if x not in SKIP and x != '__pycache__'
                       and not (a == 'plugin.video.nova' and x == 'backups')
                       and not (a == 'plugin.video.telescope' and d == base and x == 'lib')]
            files = [f for f in files if not (a == 'plugin.video.telescope' and f == 'port.json') and not f.endswith(('.pyc', '.pyo'))]
            for fn in files:
                # never a backup inside a backup (pre_update.zip lives in this folder: it zipped itself to 37 GB)
                if not fn.endswith(SKIP) and not fn.endswith(('.zip', '.part', '.tmp')) and not is_session_file(fn):
                    full = os.path.join(d, fn)
                    yield full, os.path.relpath(full, USERDATA)
    for fn in FILES:
        p = os.path.join(USERDATA, fn)
        if os.path.exists(p):
            yield p, fn


# ------------------------------------------------------------------ 4.1.0: the full backup - settings AND add-ons
# The ordinary backup holds the data of the build's own add-ons. The full one holds the data of EVERY add-on and the
# add-ons the viewer installed on top of the build (their folders), so that another device - or another user - gets
# the same Kodi back. Which add-ons belong to the build is written at build time (userdata/novatv_addons.txt).
HOME = xbmcvfs.translatePath('special://home/')
BUILD_LIST = os.path.join(USERDATA, 'novatv_addons.txt')
MANIFEST = 'bn_addons.json'
ENABLE_FILE = os.path.join(PROFILE, 'restore_enable.json')
ID_RX = r'^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$'
OWN = ('plugin.video.nova', 'plugin.video.telescope', 'plugin.program.novawizard', 'repository.telenova')


def build_addons():
    """ids the build ships with: the list written into the build (userdata), else the one that comes with the hub
    itself (an install that was updated through the repository has only that one). None when neither is there -
    then nothing counts as "extra"."""
    from .common import ADDON_PATH
    for path in (BUILD_LIST, os.path.join(ADDON_PATH, 'resources', 'build_addons.txt')):
        try:
            with open(path, encoding='utf-8') as f:
                ids = set(x.strip() for x in f.read().split() if x.strip())
            if ids:
                return ids
        except OSError:
            continue
    return None


def extras(folders=None, shipped=None):
    """add-ons installed on top of the build (folder names under addons/)"""
    import re
    shipped = build_addons() if shipped is None else shipped
    if not shipped:
        return []
    if folders is None:
        base = os.path.join(HOME, 'addons')
        folders = [d for d in os.listdir(base) if os.path.isfile(os.path.join(base, d, 'addon.xml'))] if os.path.isdir(base) else []
    return sorted(d for d in folders if d not in shipped and d not in OWN and re.match(ID_RX, d)
                  and d not in ('packages', 'temp'))


def _members_full():
    """every add-on's data + the extra add-ons themselves"""
    base = os.path.join(USERDATA, 'addon_data')
    seen = set()
    for full, arc in _members():
        seen.add(arc)
        yield full, arc
    for a in sorted(os.listdir(base)) if os.path.isdir(base) else []:
        if a in ADDON_DATA:
            continue
        for d, dirs, files in os.walk(os.path.join(base, a)):
            dirs[:] = [x for x in dirs if x not in SKIP and x.lower() not in ('cache', 'temp', 'tmp', 'thumbnails', '__pycache__')]
            for fn in files:
                full = os.path.join(d, fn)
                try:
                    small = os.path.getsize(full) <= 20 * 1024 * 1024
                except OSError:
                    continue
                if small and not fn.endswith(SKIP) and not is_session_file(fn) and not fn.endswith(('.zip', '.part', '.tmp', '.log', '.pyc', '.pyo')):
                    yield full, os.path.relpath(full, USERDATA)
    for a in extras():
        for d, dirs, files in os.walk(os.path.join(HOME, 'addons', a)):
            dirs[:] = [x for x in dirs if x != '__pycache__']
            for fn in files:
                if not fn.endswith(('.pyc', '.pyo')):
                    full = os.path.join(d, fn)
                    yield full, os.path.relpath(full, HOME)


def allowed_addon_member(member, wanted, shipped):
    """a zip member 'addons/<id>/...' that a restore may write: the id is one the backup itself lists as an extra,
    is a plain add-on id, and is NOT an add-on of the build (a crafted "backup" must never replace the hub, the
    skin or any add-on the build ships)"""
    import re
    parts = member.split('/')
    if len(parts) < 3 or parts[0] != 'addons' or not parts[-1]:
        return False
    aid = parts[1]
    if aid in OWN or aid in (shipped or ()) or aid not in wanted or not re.match(ID_RX, aid):
        return False
    return all(x not in ('', '.', '..') for x in parts[1:])


def stale(member, _known={}):
    """3.3: a backup made on an older build also holds settings of add-ons the build no longer has (POV, All Subs
    Plus, the modified Estuary ...). Restoring them left dead settings folders behind, so they are skipped:
    anything under addon_data/<id>/ whose add-on is not installed on this box."""
    parts = member.replace('\\', '/').split('/')
    if len(parts) < 3 or parts[0] != 'addon_data':
        return False
    aid = parts[1]
    if aid in ADDON_DATA:           # the build's own add-ons (a binary one may be installed only after the restore)
        return False
    if aid not in _known:
        _known[aid] = bool(xbmc.getCondVisibility('System.HasAddon(%s)' % aid)) or \
            os.path.isdir(xbmcvfs.translatePath('special://home/addons/%s' % aid))
    return not _known[aid]


def keep_filled(backup_xml, current_xml):
    """settings.xml of a backup with every value it has EMPTY taken from this device's file when that one is set.
    -> (xml, number of values kept). Pure (tested outside Kodi)."""
    import re
    rx = re.compile(r'(<setting id="([^"]+)"[^>]*?)(/>|>([^<]*)</setting>)')
    have = dict((m.group(2), m.group(4)) for m in rx.finditer(current_xml) if (m.group(4) or '').strip())
    kept = [0]

    def fix(m):
        sid, val = m.group(2), m.group(4)
        if (val or '').strip() or sid not in have:
            return m.group(0)
        kept[0] += 1
        head = re.sub(r'\s+default="true"', '', m.group(1))
        return '%s>%s</setting>' % (head, have[sid])
    out = rx.sub(fix, backup_xml)
    for sid, val in have.items():          # a setting the old backup did not know at all
        if ('id="%s"' % sid) not in out and '</settings>' in out:
            out = out.replace('</settings>', '    <setting id="%s">%s</setting>\n</settings>' % (sid, val), 1)
            kept[0] += 1
    return out, kept[0]


def extract(z):
    """restore the members of an open backup zip into userdata; returns (restored, skipped as stale)"""
    import json
    done = skipped = 0
    wanted, shipped = set(), build_addons()
    if MANIFEST in z.namelist():                 # 4.1.0: a full backup - the add-ons installed on top of the build
        try:
            wanted = set(x for x in (json.loads(z.read(MANIFEST).decode('utf-8')).get('extras') or []) if isinstance(x, str))
        except (ValueError, UnicodeDecodeError):
            wanted = set()
    new_addons = set()
    for m in z.namelist():
        if m in ('bn_backup.txt', MANIFEST) or m.startswith('/') or '..' in m or ':' in m or '\\' in m:
            continue
        if m.startswith('addon_data/') and is_session_file(m):                 # 6.2.0: an older backup may hold the login: never written here
            skipped += 1
            continue
        if m.startswith('addons/'):
            if shipped and allowed_addon_member(m, wanted, shipped):
                z.extract(m, HOME)
                new_addons.add(m.split('/')[1])
                done += 1
            continue
        # 3.3: a backup restores add-on data and the few userdata files a backup holds - nothing else
        # (a crafted "backup" could drop keymaps/, advancedsettings.xml, playercorefactory.xml)
        if not m.startswith('addon_data/') and m not in FILES:
            continue
        if stale(m) and not (m.split('/')[1] in wanted and shipped):
            skipped += 1
            continue
        dest = os.path.join(USERDATA, *m.split('/'))
        if m.endswith('/settings.xml') and os.path.exists(dest):
            # 4.2.6: a restore never puts an empty value over one this device has (an old automatic backup made
            # before Telegram was set up wiped the working api id / hash on the owner's PC, 17/11)
            try:
                with open(dest, encoding='utf-8') as f:
                    mine = f.read()
                merged, kept = keep_filled(z.read(m).decode('utf-8'), mine)
                with open(dest, 'w', encoding='utf-8') as f:
                    f.write(merged)
                if kept:
                    log('restore %s: kept %d value(s) of this device that the backup had empty' % (m.split('/')[1], kept))
                done += 1
                continue
            except (OSError, UnicodeDecodeError, ValueError) as e:
                log('restore merge %s: %s' % (m, e), xbmc.LOGWARNING)
        z.extract(m, USERDATA)
        done += 1
    if new_addons:                               # Kodi enables them at its next start (enable_restored)
        os.makedirs(PROFILE, exist_ok=True)
        with open(ENABLE_FILE, 'w', encoding='utf-8') as f:
            json.dump(sorted(new_addons), f)
    try:        # favourites of a backup from an older build: entries that open removed add-ons
        from . import depov
        depov.clean_favourites(os.path.join(USERDATA, 'favourites.xml'))
    except Exception as e:
        log('restore favourites: %s' % e, xbmc.LOGWARNING)
    log('restore: %d file(s), %d skipped (add-ons no longer in the build)' % (done, skipped))
    return done, skipped


def make_zip(path, full=False):
    n = 0
    part = path + '.part'                   # only a complete file gets the real name
    with zipfile.ZipFile(part, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('bn_backup.txt', 'BN Stream backup %s\n' % time.ctime())
        if full:
            import json
            z.writestr(MANIFEST, json.dumps({'extras': extras(), 'made': int(time.time())}))
        for full_path, arc in (_members_full() if full else _members()):
            try:
                z.write(full_path, arc.replace(os.sep, '/'))
                n += 1
            except Exception as e:
                log('backup skip %s: %s' % (arc, e), xbmc.LOGWARNING)
    os.replace(part, path)
    return n


STR = {
    'kind': ('מה לגבות?', 'What to back up?', 'Что сохранить?'),
    'k_std': ('הגדרות, חיבורים לשירותים, משתמשים ותוכן', 'Settings, service logins, users and content',
              'Настройки, входы в сервисы, пользователи и контент'),
    'k_full': ('הכול: גם הנתונים של כל התוספים והתוספים שהותקנו בנוסף (%d)',
               'Everything: also the data of every add-on and the add-ons installed on top (%d)',
               'Всё: также данные всех дополнений и установленные сверху дополнения (%d)'),
    'how': ('איך לשחזר?', 'How to restore?', 'Как восстановить?'),
    'r_all': ('שחזור מלא - הכול חוזר למצב שבגיבוי (Kodi ייסגר)', 'Full restore - everything as in the backup (Kodi closes)',
              'Полное восстановление - всё как в копии (Kodi закроется)'),
    'r_me': ('רק מועדפים, היסטוריה וחיפושים - אל המשתמש "%s"', 'Favourites, history and searches only - into the user "%s"',
             'Только избранное, история и поиски - пользователю «%s»'),
    'me_done': ('התוכן מוזג אל המשתמש "%s": %d מועדפים, %d בהיסטוריה, %d חיפושים',
                'The content was merged into the user "%s": %d favourites, %d history entries, %d searches',
                'Контент добавлен пользователю «%s»: избранное %d, история %d, поиски %d'),
    'addons_q': ('הגיבוי כולל %d תוספים שהותקנו בנוסף לבילד. תוספים מריצים קוד - לשחזר אותם רק מגיבוי שיצרתם בעצמכם. להמשיך?',
                 'The backup holds %d add-ons installed on top of the build. Add-ons run code - restore them only from a '
                 'backup you made yourself. Continue?',
                 'Копия содержит %d дополнений, установленных сверху. Дополнения выполняют код - восстанавливайте их только '
                 'из своей копии. Продолжить?'),
}


def _s(key):
    from .common import ui_lang
    return STR[key][{'he': 0, 'en': 1, 'ru': 2}[ui_lang()]]


def backup(full=None):
    d = xbmcgui.Dialog()
    if full is None:
        i = d.select(_s('kind'), [_s('k_std'), _s('k_full') % len(extras())])
        if i < 0:
            return
        full = i == 1
    dest = d.browse(3, T('bk_where'), 'files', '', False, False, '')   # 3 = writeable folder
    if not dest:
        return
    name = 'BN-%s-%s.zip' % ('full' if full else 'backup', time.strftime('%Y%m%d-%H%M'))
    tmp = os.path.join(xbmcvfs.translatePath('special://temp/'), name)
    busy = xbmcgui.DialogProgressBG()
    busy.create('TeleNova', T('backup'))
    try:
        n = make_zip(tmp, full=full)
    finally:
        busy.close()
    target = dest.rstrip('/\\') + ('/' if '://' in dest else os.sep) + name
    ok = xbmcvfs.copy(tmp, target)
    os.remove(tmp)
    if ok:
        d.ok('BN', '%s\n%s\n(%d %s)' % (T('bk_done'), target, n, T('bk_files')))
    else:
        d.ok('BN', '%s\n%s' % (T('bk_fail'), target))


def auto_backup(keep=3, every_days=7):
    """Weekly local safety copy (called by the service)."""
    os.makedirs(AUTO_DIR, exist_ok=True)
    existing = sorted(f for f in os.listdir(AUTO_DIR) if f.endswith('.zip'))
    if existing and time.time() - os.path.getmtime(os.path.join(AUTO_DIR, existing[-1])) < every_days * 86400:
        return
    make_zip(os.path.join(AUTO_DIR, 'BN-auto-%s.zip' % time.strftime('%Y%m%d-%H%M')))
    for old in sorted(f for f in os.listdir(AUTO_DIR) if f.endswith('.zip'))[:-keep]:
        os.remove(os.path.join(AUTO_DIR, old))


def restore():
    d = xbmcgui.Dialog()
    autos = sorted((f for f in os.listdir(AUTO_DIR) if f.endswith('.zip')), reverse=True) if os.path.isdir(AUTO_DIR) else []
    choices = [T('bk_pick')] + ['%s  (%s)' % (T('bk_auto'), f[8:21]) for f in autos]
    i = d.select(T('restore'), choices)
    if i < 0:
        return
    if i == 0:
        src = d.browse(1, T('restore'), 'files', '.zip', False, False, '')
        if not src:
            return
        local = os.path.join(xbmcvfs.translatePath('special://temp/'), 'bn_restore.zip')
        if not xbmcvfs.copy(src, local):
            d.ok('BN', T('bk_fail'))
            return
    else:
        local = os.path.join(AUTO_DIR, autos[i - 1])
    from . import users                               # 4.1.0: everything, or the personal content into this user
    j = d.select(_s('how'), [_s('r_all'), _s('r_me') % users.current_name()])
    if j == 1:
        return restore_personal(local)
    if j == 0:
        restore_zip(local)


def personal_from(z):
    """the personal content inside an open backup zip (the user that was active when it was made)"""
    import json
    base = 'addon_data/plugin.video.nova/'
    out = {}
    for name, key in (('history.json', 'history'), ('favourites.json', 'favourites'), ('favourites_removed.json', 'removed'),
                      ('search_history.json', 'searches')):
        try:
            val = json.loads(z.read(base + name).decode('utf-8'))
        except (KeyError, ValueError, UnicodeDecodeError):
            val = []
        out[key] = val if isinstance(val, list) else []
    return out


def restore_personal(local):
    """merges the backup's favourites / history / searches into the active user - nothing is replaced, nothing else is
    touched, Kodi keeps running. A backup made by ANY user (or device) can be brought into any user this way."""
    from . import syncdoc, users
    d = xbmcgui.Dialog()
    try:
        with zipfile.ZipFile(local) as z:
            if 'bn_backup.txt' not in z.namelist():
                return d.ok('BN', T('bk_invalid'))
            theirs = personal_from(z)
    except zipfile.BadZipFile:
        return d.ok('BN', T('bk_invalid'))
    finally:
        tmp = os.path.join(xbmcvfs.translatePath('special://temp/'), 'bn_restore.zip')
        if os.path.normcase(os.path.abspath(local)) == os.path.normcase(os.path.abspath(tmp)) and os.path.exists(tmp):
            os.remove(tmp)
    uid = users.store_current(PROFILE)
    mine = users.store_data(PROFILE, uid)
    theirs['removed'] = []                     # their removals are not ours: only what they have is added
    merged = syncdoc.merge_user_data(mine, theirs)
    users.store_put(PROFILE, uid, merged)
    xbmcgui.Window(10000).setProperty('bn.sync.now', '1')
    d.ok('TeleNova', _s('me_done') % (users.current_name(), len(merged['favourites']), len(merged['history']), len(merged['searches'])))
    xbmc.executebuiltin('Container.Refresh')


def enable_restored():
    """service start after a full restore: the add-ons the backup brought are registered and switched on"""
    import json
    if not os.path.exists(ENABLE_FILE):
        return 0
    try:
        with open(ENABLE_FILE, encoding='utf-8') as f:
            ids = [x for x in json.load(f) if isinstance(x, str)]
    except (OSError, ValueError):
        ids = []
    os.remove(ENABLE_FILE)
    if not ids:
        return 0
    xbmc.executebuiltin('UpdateLocalAddons')
    xbmc.Monitor().waitForAbort(6)
    n = 0
    for aid in ids:
        if os.path.isfile(os.path.join(HOME, 'addons', aid, 'addon.xml')):
            xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'Addons.SetAddonEnabled',
                                            'params': {'addonid': aid, 'enabled': True}}))
            n += 1
    log('restore: %d add-on(s) from the backup switched on' % n)
    return n


def restore_zip(local):
    """restore a BN backup zip (local file, from a folder or from Google Drive) and restart Kodi"""
    d = xbmcgui.Dialog()
    win = xbmcgui.Window(10000)
    try:
        try:
            with zipfile.ZipFile(local) as z:
                if 'bn_backup.txt' not in z.namelist():
                    d.ok('BN', T('bk_invalid'))
                    return
                if not d.yesno('BN', T('bk_confirm')):
                    return
                if MANIFEST in z.namelist():           # a full backup with add-ons: said plainly before they are written
                    import json
                    try:
                        n_extra = len(json.loads(z.read(MANIFEST).decode('utf-8')).get('extras') or [])
                    except (ValueError, UnicodeDecodeError):
                        n_extra = 0
                    if n_extra and build_addons() and not d.yesno('TeleNova', _s('addons_q') % n_extra):
                        return
                # 3.3: from here the service must not write its files over the restored ones
                win.setProperty('NovaTV.restoring', '1')
                extract(z)
        except zipfile.BadZipFile:
            win.clearProperty('NovaTV.restoring')
            d.ok('BN', T('bk_invalid'))
            return
        except Exception:
            win.clearProperty('NovaTV.restoring')       # the restore failed: Kodi goes on running
            raise
    finally:
        # 3.3: the temporary copy of the backup never stays on disk (the weekly / pre-update zips are kept)
        tmp = os.path.join(xbmcvfs.translatePath('special://temp/'), 'bn_restore.zip')
        if os.path.normcase(os.path.abspath(local)) == os.path.normcase(os.path.abspath(tmp)):
            try:
                os.remove(tmp)
            except OSError:
                pass
    d.ok('BN', T('bk_restored'))
    os._exit(1)     # restart without Kodi rewriting the restored files
