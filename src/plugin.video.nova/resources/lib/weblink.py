# -*- coding: utf-8 -*-
"""4.0.4: the pages where a key is issued or an account is opened, in the device's own browser.

A television box often has no browser, so the address is always shown as well - as text and as a QR code to scan
with a phone. Nothing but the public address of the page goes into the QR image request."""
import os
import subprocess
import sys

PAGES = {
    'telegram': 'https://my.telegram.org/apps',
    'rd': 'https://real-debrid.com/device',
    'rd_account': 'https://real-debrid.com/',
    'gemini': 'https://aistudio.google.com/apikey',
    'tmdb': 'https://www.themoviedb.org/settings/api',
    'opensubs': 'https://www.opensubtitles.com/consumers',
    'opensubs_account': 'https://www.opensubtitles.com/users/sign_up',
    'ktuvit': 'https://www.ktuvit.me/',
    'stremthru': 'https://github.com/MunifTanjim/stremthru',
    'gdrive': 'https://www.google.com/device',
    'trakt': 'https://trakt.tv/activate',
}


def command(url, platform=None, android=False):
    """what opens `url` in the default browser on this system: ('builtin', text) for Kodi, ('exec', [argv]),
    ('startfile', url) or None when the system has no way (iOS, tvOS, an unknown box)"""
    if not url.lower().startswith(('http://', 'https://')):
        return None
    platform = platform or sys.platform
    if android:
        return 'builtin', 'StartAndroidActivity(,android.intent.action.VIEW,,"%s")' % url.replace('"', '%22')
    if platform.startswith('win'):
        return 'startfile', url
    if platform == 'darwin':
        return 'exec', ['open', url]
    if platform.startswith('linux'):
        return 'exec', ['xdg-open', url]
    return None


def open_url(url):
    """True when the request to open the page was handed to the system (not a proof that a browser exists)"""
    import xbmc
    ios = xbmc.getCondVisibility('System.Platform.IOS') or xbmc.getCondVisibility('System.Platform.TVOS')
    cmd = None if ios else command(url, android=bool(xbmc.getCondVisibility('System.Platform.Android')))
    if not cmd:
        return False
    try:
        if cmd[0] == 'builtin':
            xbmc.executebuiltin(cmd[1])
        elif cmd[0] == 'startfile':
            os.startfile(cmd[1])                       # noqa (Windows only)
        else:
            subprocess.Popen(cmd[1], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
        return True
    except Exception as e:
        xbmc.log('[NovaTV] open page: %s' % e, xbmc.LOGWARNING)
        return False


def show(url, title='TeleNova'):
    """opens the page and shows its address with a QR code (for a phone) until the viewer closes the window"""
    import xbmc
    import xbmcgui
    from urllib.parse import quote
    from .common import ui_lang
    opened = open_url(url)
    he, ru = ui_lang() == 'he', ui_lang() == 'ru'
    line = ('הדף נפתח בדפדפן של המכשיר. אפשר גם לסרוק את הקוד בטלפון:' if he else
            'Страница открыта в браузере устройства. Можно также отсканировать код телефоном:' if ru else
            'The page was opened in this device\'s browser. You can also scan the code with a phone:') if opened else \
           ('סרקו את הקוד בטלפון, או הקלידו את הכתובת בדפדפן:' if he else
            'Отсканируйте код телефоном или введите адрес в браузере:' if ru else
            'Scan the code with a phone, or type the address in a browser:')

    class Win(xbmcgui.WindowDialog):
        def __init__(self):
            super(Win, self).__init__()
            img = 'https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=16&data=' + quote(url, safe='')
            self.addControl(xbmcgui.ControlImage(0, 0, 1280, 720, 'special://xbmc/media/black.png', colorDiffuse='E6000000'))
            self.addControl(xbmcgui.ControlLabel(140, 70, 1000, 50, '[B]%s[/B]' % title, alignment=2))
            self.addControl(xbmcgui.ControlLabel(140, 120, 1000, 40, line, alignment=2))
            self.addControl(xbmcgui.ControlImage(430, 175, 420, 420, img))
            self.addControl(xbmcgui.ControlLabel(40, 610, 1200, 50, '[COLOR deepskyblue]%s[/COLOR]' % url, alignment=2))

        def onAction(self, action):
            self.close()

        def onClick(self, control):
            self.close()

    w = Win()
    w.doModal()
    del w
    return opened
