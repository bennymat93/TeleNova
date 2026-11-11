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
        'gdrive_token.json', 'gdrive_state.json')
AUTO_DIR = os.path.join(PROFILE, 'backups')


def _members():
    for a in ADDON_DATA:
        base = os.path.join(USERDATA, 'addon_data', a)
        for d, dirs, files in os.walk(base):
            dirs[:] = [x for x in dirs if x not in SKIP and not (a == 'plugin.video.nova' and x == 'backups')]
            for fn in files:
                # never a backup inside a backup (pre_update.zip lives in this folder: it zipped itself to 37 GB)
                if not fn.endswith(SKIP) and not fn.endswith(('.zip', '.part', '.tmp')):
                    full = os.path.join(d, fn)
                    yield full, os.path.relpath(full, USERDATA)
    for fn in FILES:
        p = os.path.join(USERDATA, fn)
        if os.path.exists(p):
            yield p, fn


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


def extract(z):
    """restore the members of an open backup zip into userdata; returns (restored, skipped as stale)"""
    done = skipped = 0
    for m in z.namelist():
        if m == 'bn_backup.txt' or m.startswith('/') or '..' in m or ':' in m or '\\' in m:
            continue
        # 3.3: a backup restores add-on data and the few userdata files a backup holds - nothing else
        # (a crafted "backup" could drop keymaps/, advancedsettings.xml, playercorefactory.xml)
        if not m.startswith('addon_data/') and m not in FILES:
            continue
        if stale(m):
            skipped += 1
            continue
        z.extract(m, USERDATA)
        done += 1
    try:        # favourites of a backup from an older build: entries that open removed add-ons
        from . import depov
        depov.clean_favourites(os.path.join(USERDATA, 'favourites.xml'))
    except Exception as e:
        log('restore favourites: %s' % e, xbmc.LOGWARNING)
    log('restore: %d file(s), %d skipped (add-ons no longer in the build)' % (done, skipped))
    return done, skipped


def make_zip(path):
    n = 0
    part = path + '.part'                   # only a complete file gets the real name
    with zipfile.ZipFile(part, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('bn_backup.txt', 'BN Stream backup %s\n' % time.ctime())
        for full, arc in _members():
            try:
                z.write(full, arc.replace(os.sep, '/'))
                n += 1
            except Exception as e:
                log('backup skip %s: %s' % (arc, e), xbmc.LOGWARNING)
    os.replace(part, path)
    return n


def backup():
    d = xbmcgui.Dialog()
    dest = d.browse(3, T('bk_where'), 'files', '', False, False, '')   # 3 = writeable folder
    if not dest:
        return
    name = 'BN-backup-%s.zip' % time.strftime('%Y%m%d-%H%M')
    tmp = os.path.join(xbmcvfs.translatePath('special://temp/'), name)
    n = make_zip(tmp)
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
    restore_zip(local)


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
