# -*- coding: utf-8 -*-
"""NovaTV Wizard: download, verify and install the NovaTV build."""
import hashlib
import json
import os
import shutil
import urllib.request
import zipfile

import xbmc
import xbmcaddon
import xbmcgui
import xbmcvfs

BUILD_INFO = 'https://bennymat93.github.io/TeleNova/build.json'
ADDON = xbmcaddon.Addon()
HOME = xbmcvfs.translatePath('special://home/')
TEMP = xbmcvfs.translatePath('special://temp/')
KEEP_ON_UPDATE = ['plugin.video.nova', 'pvr.iptvsimple', 'service.subtitles.All_Subs',
                  'plugin.video.youtube', 'plugin.video.telescope', 'plugin.video.telemedia']
# 0.2.1: add-ons that an update never removes even when the build zip does not carry them (installed from the
# NovaTV repository after the build was made, e.g. the Telegram engine and its downloaded Python modules)
KEEP_ADDONS = {'plugin.video.telescope', 'plugin.video.telemedia', 'repository.nova', 'repository.telenova', 'plugin.video.nova'}
# 3.3: "Update (keep accounts, history and favourites)" replaced Kodi's own favourites and sources with the
# build's - these files of the viewer are no longer overwritten by an update (a fresh install still replaces them)
KEEP_FILES = {'userdata/favourites.xml', 'userdata/sources.xml', 'userdata/passwords.xml', 'userdata/mediasources.xml'}
LANG = (xbmc.getLanguage(xbmc.ISO_639_1) or 'en')
TXT = {
    'title': {'he': 'אשף TeleNova', 'ru': 'Мастер TeleNova', 'en': 'TeleNova Wizard'},
    'fresh': {'he': 'התקנה נקייה (מוחק הכל)', 'ru': 'Чистая установка (всё удалить)', 'en': 'Fresh install (wipe everything)'},
    'update': {'he': 'עדכון (שומר חשבונות, היסטוריה ומועדפים)', 'ru': 'Обновление (сохранить аккаунты, историю, избранное)',
               'en': 'Update (keep accounts, history and favourites)'},
    'dl': {'he': 'מוריד...', 'ru': 'Загрузка...', 'en': 'Downloading...'},
    'ex': {'he': 'מתקין...', 'ru': 'Установка...', 'en': 'Installing...'},
    'bad': {'he': 'הקובץ פגום – נסה שוב.', 'ru': 'Файл повреждён - попробуйте ещё раз.', 'en': 'Download is corrupt - please try again.'},
    'done': {'he': 'ההתקנה הושלמה. Kodi ייסגר כעת – פתח אותו שוב.', 'ru': 'Готово. Kodi закроется - откройте его снова.',
             'en': 'Installed. Kodi will now close - please open it again.'},
    'net': {'he': 'אין חיבור לשרת הבילד. בדוק אינטרנט.', 'ru': 'Нет связи с сервером сборки. Проверьте интернет.',
            'en': 'Cannot reach the build server. Check your internet connection.'},
}


def t(k):
    return TXT[k].get(LANG, TXT[k]['en'])


def platform():
    for name, cond in (('android', 'System.Platform.Android'), ('windows', 'System.Platform.Windows'),
                       ('ios', 'System.Platform.IOS'), ('tvos', 'System.Platform.TVOS'), ('osx', 'System.Platform.OSX'),
                       ('linux', 'System.Platform.Linux')):
        if xbmc.getCondVisibility(cond):
            return name
    return ''


def _platform_tag(xml):
    import re
    m = re.search(r'<platform>([^<]+)</platform>', xml)
    return m.group(1).strip() if m else ''


def foreign_binaries(z, plat):
    """add-ons in the build whose binary is for another platform (e.g. windows-x86_64 on Android)"""
    out = set()
    for n in z.namelist():
        parts = n.split('/')
        if len(parts) == 3 and parts[0] == 'addons' and parts[2] == 'addon.xml':
            tag = _platform_tag(z.read(n).decode('utf-8', 'replace'))
            if tag and tag != 'all' and plat and not tag.startswith(plat):
                out.add(parts[1])
    return out


def foreign_installed(base, plat):
    """the device's own binary add-ons (built for this platform) are kept: the build has no replacement for them"""
    out = set()
    if not base.endswith('addons'):
        return out
    for name in os.listdir(base):
        ax = os.path.join(base, name, 'addon.xml')
        try:
            tag = _platform_tag(open(ax, encoding='utf-8', errors='replace').read())
        except OSError:
            continue
        if tag and tag != 'all' and plat and tag.startswith(plat):
            out.add(name)
    return out


def main():
    d = xbmcgui.Dialog()
    try:
        info = json.loads(urllib.request.urlopen(BUILD_INFO, timeout=20).read().decode())
    except Exception as e:
        d.ok(t('title'), '%s\n%s' % (t('net'), e))
        return
    choice = d.select('%s  v%s' % (t('title'), info['version']), [t('update'), t('fresh')])
    if choice < 0:
        return
    target = os.path.join(TEMP, 'novatv_build.zip')
    pd = xbmcgui.DialogProgress()
    pd.create(t('title'), t('dl'))
    try:
        # 3.1: the build may come in several parts (each under GitHub's 100 MB file limit) that are joined here
        urls = info.get('parts') or [info['url']]
        total = int(info.get('size') or 0)
        sha, got = hashlib.sha256(), 0
        with open(target, 'wb') as f:
            for u in urls:
                for attempt in range(3):         # one dropped connection does not fail the whole install
                    start = got
                    try:
                        req = urllib.request.urlopen(urllib.request.Request(u, headers={'Range': 'bytes=0-'}), timeout=60)
                        while True:
                            chunk = req.read(256 * 1024)
                            if not chunk:
                                break
                            f.write(chunk)
                            got += len(chunk)
                            if total:
                                pd.update(min(100, int(got * 100 / total)), '%s %.1f / %.1f MB' % (t('dl'), got / 1e6, total / 1e6))
                            if pd.iscanceled():
                                pd.close()
                                f.close()
                                os.remove(target)
                                return
                        break
                    except Exception:
                        if attempt == 2:
                            raise
                        f.seek(start)
                        f.truncate()
                        got = start
        with open(target, 'rb') as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b''):
                sha.update(chunk)
        if info.get('sha256') and sha.hexdigest() != info['sha256']:
            pd.close()
            os.remove(target)
            d.ok(t('title'), t('bad'))
            return
        pd.update(0, t('ex'))
        keep_root = os.path.join(TEMP, 'nova_keep')
        shutil.rmtree(keep_root, ignore_errors=True)
        data_dir = os.path.join(HOME, 'userdata', 'addon_data')
        if choice == 0:
            for a in KEEP_ON_UPDATE:
                src = os.path.join(data_dir, a)
                if os.path.isdir(src):
                    shutil.copytree(src, os.path.join(keep_root, a))
        me = ADDON.getAddonInfo('id')
        # 0.2.0 (Android TV boxes crashed here): nothing is deleted BEFORE the new files are in place - Kodi keeps
        # running on its skin, Python modules and binary add-ons while the wizard works. The build is extracted over
        # the old files, binary add-ons built for another platform are skipped (the build zip carries the Windows
        # ones; NovaTV installs the device's own from the Kodi repository at the next start), and only then the
        # leftovers that the build does not contain are removed, right before Kodi closes.
        plat = platform()
        with zipfile.ZipFile(target) as z:
            names = z.namelist()
            foreign = foreign_binaries(z, plat)
            for i, n in enumerate(names):
                top = n.split('/')
                if len(top) > 1 and top[0] == 'addons' and top[1] in foreign:
                    continue
                if len(top) > 1 and top[0] == 'addons' and top[1] == me:
                    continue                 # never overwrite the running wizard
                if choice == 0 and n in KEEP_FILES and os.path.exists(os.path.join(HOME, n)):
                    continue                 # 3.3 update: the viewer's own favourites / sources / passwords stay
                try:
                    z.extract(n, HOME)
                except Exception as e:      # a locked file must not abort the whole install
                    xbmc.log('[NovaWizard] extract %s: %s' % (n, e), xbmc.LOGWARNING)
                if i % 200 == 0:
                    pd.update(int(i * 100 / len(names)), t('ex'))
            in_zip = {tuple(n.split('/')[:2]) for n in names if n.count('/') >= 1}
        for sub in ('addons', 'userdata'):
            base = os.path.join(HOME, sub)
            if not os.path.isdir(base):
                continue
            native = foreign_installed(base, plat)       # 0.2.1: read once, not once per add-on
            for name in os.listdir(base):
                if (sub, name) in in_zip or name in (me, 'packages', 'temp', 'Thumbnails', 'Database') or \
                        name.startswith('kodi.log') or name in native:
                    continue
                if sub == 'addons' and choice == 0 and name in KEEP_ADDONS:
                    continue                 # update: keep the engine installed from the repository
                if sub == 'userdata' and choice == 0:
                    continue                 # update: the viewer's own userdata files stay
                p = os.path.join(base, name)
                try:
                    shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
                except Exception as e:
                    xbmc.log('[NovaWizard] cannot remove %s: %s' % (p, e), xbmc.LOGWARNING)
        if choice == 1 and os.path.isdir(data_dir):
            # 3.3: "Fresh install (wipe everything)" kept every old settings folder - accounts, history and the
            # settings of add-ons that are gone - because only the top level of userdata was compared with the
            # build. Every file under addon_data that the build does not bring is removed.
            wanted = {n for n in names if n.startswith('userdata/addon_data/')}
            for dp, dn, fn in os.walk(data_dir, topdown=False):
                rel = os.path.relpath(dp, HOME).replace(os.sep, '/')
                if rel.split('/')[2:3] == [me]:
                    continue
                for f in fn:
                    if '%s/%s' % (rel, f) not in wanted:
                        try:
                            os.remove(os.path.join(dp, f))
                        except OSError as e:
                            xbmc.log('[NovaWizard] cannot remove %s: %s' % (os.path.join(dp, f), e), xbmc.LOGWARNING)
                if dp != data_dir and not os.listdir(dp):
                    try:
                        os.rmdir(dp)
                    except OSError:
                        pass
        if os.path.isdir(keep_root):
            for a in os.listdir(keep_root):
                dst = os.path.join(data_dir, a)
                shutil.rmtree(dst, ignore_errors=True)
                shutil.copytree(os.path.join(keep_root, a), dst)
        pd.close()
        os.remove(target)
        d.ok(t('title'), t('done'))
        os._exit(1)   # hard exit so Kodi does not overwrite the new guisettings.xml on shutdown
    except Exception as e:
        pd.close()
        try:                                 # 0.2.1: a failed download no longer leaves a 120 MB file in temp
            os.remove(target)
        except OSError:
            pass
        d.ok(t('title'), 'Error: %s' % e)


main()
