# -*- coding: utf-8 -*-
"""BN Stream name and logo when the build was installed into a plain Kodi (file-manager link / repository).

What an add-on can and cannot do: the launcher name and icon belong to the Kodi app (on Android they are fixed in
its APK), so they cannot be renamed from inside. What this does, once per version, from the service:
  1. every device: the BN splash screen (Kodi shows special://home/media/splash.jpg instead of its own)
  2. Windows: "BN Stream" shortcuts with the BN icon on the desktop and in the Start menu, opening this Kodi
  (3.3.3: the one-time offer to install the dedicated BN Stream app on Android was removed)
The APK and the Windows installer already carry the name and logo; there only step 1 runs (harmless).
"""
import os
import shutil
import subprocess

import xbmc
import xbmcgui
import xbmcvfs

from .common import ADDON, MEDIA, log

def splash():
    """Kodi prefers special://home/media/splash.jpg over its own"""
    dst = xbmcvfs.translatePath('special://home/media')
    os.makedirs(dst, exist_ok=True)
    src = os.path.join(MEDIA, 'bn_splash.jpg')
    if os.path.exists(os.path.join(dst, 'splash.jpg')):
        return                            # the full build ships its own BN splash (full resolution): keep it
    for name in ('splash.jpg', 'splash.png'):
        target = os.path.join(dst, name)
        if name.endswith('.png'):
            try:
                from PIL import Image                  # not always available inside Kodi: jpg alone is enough
                Image.open(src).save(target)
            except Exception:
                pass
        elif not os.path.exists(target) or os.path.getsize(target) != os.path.getsize(src):
            shutil.copyfile(src, target)


def _is_our_app():
    """our APK (org.bn.stream) or our Windows installer (folder "BN Stream"): the name and logo are already BN"""
    paths = ' '.join(xbmcvfs.translatePath(p) for p in ('special://xbmc', 'special://home', 'special://temp')).lower()
    return 'org.bn.stream' in paths or 'bn stream' in paths or 'bn-stream' in paths


def windows_shortcuts():
    """desktop + Start-menu "BN Stream" shortcuts to this Kodi (portable when it runs portable), BN icon"""
    exe = os.path.join(xbmcvfs.translatePath('special://xbmc'), 'kodi.exe')
    if 'testkodi' in exe.lower():          # the build machine's test copy never touches the desktop
        return False
    if not os.path.exists(exe):
        return False
    ico_dir = xbmcvfs.translatePath('special://home/media')
    os.makedirs(ico_dir, exist_ok=True)
    ico = os.path.join(ico_dir, 'bn.ico')
    shutil.copyfile(os.path.join(MEDIA, 'bn.ico'), ico)
    portable = 'portable_data' in xbmcvfs.translatePath('special://home')
    places = [os.path.join(os.path.expanduser('~'), 'Desktop'),
              os.path.join(os.environ.get('APPDATA', ''), 'Microsoft', 'Windows', 'Start Menu', 'Programs')]
    ps = []
    for folder in places:
        if not os.path.isdir(folder):
            continue
        lnk = os.path.join(folder, 'BN Stream.lnk')
        ps.append("$s=$w.CreateShortcut('%s');$s.TargetPath='%s';$s.Arguments='%s';$s.WorkingDirectory='%s';"
                  "$s.IconLocation='%s';$s.Description='BN Stream';$s.Save()"
                  % (lnk.replace("'", "''"), exe.replace("'", "''"), '-p' if portable else '',
                     os.path.dirname(exe).replace("'", "''"), ico.replace("'", "''")))
    if not ps:
        return False
    cmd = '$w=New-Object -ComObject WScript.Shell;' + ';'.join(ps)
    subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', cmd], timeout=30,
                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    return True


def apply():
    """service: once per add-on version"""
    ver = ADDON.getAddonInfo('version')
    from .common import flag
    if flag('brand_ver') == ver:
        return
    try:
        splash()
    except Exception as e:
        log('branding splash: %s' % e, xbmc.LOGWARNING)
    if not _is_our_app():
        try:
            if xbmc.getCondVisibility('System.Platform.Windows'):
                windows_shortcuts()
            # 3.3.3: the offer to install the dedicated BN Stream app on Android was removed (owner's decision):
            # the build stays inside the Kodi it was installed into and never suggests another app
        except Exception as e:
            log('branding: %s' % e, xbmc.LOGWARNING)
    flag('brand_ver', ver)
