# -*- coding: utf-8 -*-
"""4.2.9: "Connect the web version" - a QR code that opens TeleNova Web with this device's Telegram API ID and hash
already filled in, so the viewer only has to sign in there (by QR or by phone).

The link is <site>/web/#pair=<api id>.<api hash>. The part after '#' never reaches a server; the web app takes it out
of the address bar at once and keeps it in that browser only. The QR picture is drawn here (qr.py) - never by an
outside service - and the file is deleted when the window closes.

What is NOT shared: the Telegram session of this device. The browser signs in by itself as a new device, so this
device stays logged in. The API ID and hash are the app's credentials, not access to the account."""
import os
import re

ENGINE = 'plugin.video.telescope'
WEB_URL = 'https://bennymat93.github.io/TeleNova/web/'

STR = {
    'title': (u'חיבור גרסת הרשת', 'Connect the web version', u'Подключить веб-версию'),
    'scan': (u'סרקו את הקוד בטלפון או במחשב כדי לפתוח את TeleNova Web מחובר',
             'Scan this code on your phone or computer to open TeleNova Web, ready to sign in',
             u'Отсканируйте код на телефоне или компьютере, чтобы открыть TeleNova Web'),
    'send': (u'שלח קישור להודעות השמורות', 'Send link to Saved Messages', u'Отправить ссылку в Избранное'),
    'sent': (u'הקישור נשלח להודעות השמורות שלך בטלגרם', 'The link was sent to your Telegram Saved Messages',
             u'Ссылка отправлена в Избранное Telegram'),
    'send_fail': (u'לא ניתן לשלוח עכשיו. סרקו את הקוד במקום.', 'Could not send it now. Scan the code instead.',
                  u'Сейчас не удалось отправить. Отсканируйте код.'),
    'close': (u'סגירה', 'Close', u'Закрыть'),
    'note': (u'הקוד מעביר רק את פרטי ה-API (של האפליקציה, לא גישה לחשבון). בדפדפן מתחברים בנפרד, וההתחברות כאן נשארת.',
             'The code carries only the API details (the app\'s, not access to the account). The browser signs in '
             'by itself, and this device stays signed in.',
             u'Код передаёт только данные API (приложения, не доступ к аккаунту). Браузер входит сам, а это '
             u'устройство остаётся подключённым.'),
    'no_api': (u'קודם צריך להגדיר API ID ו-API hash של טלגרם (שירותים וחשבונות ← Telegram).',
               'Set the Telegram API ID and API hash first (Services and accounts > Telegram).',
               u'Сначала укажите API ID и API hash Telegram (Сервисы и аккаунты > Telegram).'),
}


def s(key):
    from .common import ui_lang
    return STR[key][{'he': 0, 'en': 1, 'ru': 2}.get(ui_lang(), 1)]


# ------------------------------------------------------------------ rules (no Kodi)
def valid(api_id, api_hash):
    return bool(re.match(r'^\d{3,12}$', str(api_id or '')) and re.match(r'^[0-9a-fA-F]{32}$', str(api_hash or '')))


def pair_url(api_id, api_hash, base=WEB_URL):
    """the pairing link, exactly the shape web/app.js takePair() accepts: #pair=<digits>.<32 hex>"""
    api_id, api_hash = str(api_id).strip(), str(api_hash).strip().lower()
    if not valid(api_id, api_hash):
        raise ValueError('api')
    return '%s#pair=%s.%s' % (base, api_id, api_hash)


def shown_address(base=WEB_URL):
    """what is written under the code: the site only, never the hash"""
    return base.split('://', 1)[-1].rstrip('/')


# ------------------------------------------------------------------ Kodi
def creds():
    """(api id, api hash) of the Telegram engine, or None"""
    import xbmcaddon
    try:
        a = xbmcaddon.Addon(ENGINE)
        api_id, api_hash = a.getSetting('api_id').strip(), a.getSetting('api_hash').strip()
    except Exception:
        return None
    return (api_id, api_hash) if valid(api_id, api_hash) else None


def available():
    return creds() is not None


def send_saved(text):
    """asks the Telegram engine to put the link in this account's Saved Messages. True when it said it did."""
    from . import cloudsync
    try:
        r = cloudsync.engine('send_saved', 30, text=text) or {}
        return bool(r.get('ok'))
    except RuntimeError:
        return False


def show():
    import xbmcgui
    from . import qr
    from .common import PROFILE, log
    d = xbmcgui.Dialog()
    c = creds()
    if not c:
        d.ok('TeleNova', s('no_api'))
        return False
    link = pair_url(*c)
    img = os.path.join(PROFILE, 'webpair_qr.png')
    try:
        qr.write_png(qr.encode(link, 'M'), img, scale=8, border=4)
    except Exception as e:
        log('webpair: qr %s' % type(e).__name__)          # never the link: it holds the hash
        return False

    class Win(xbmcgui.WindowDialog):
        def __init__(self):
            super(Win, self).__init__()
            self.addControl(xbmcgui.ControlImage(0, 0, 1280, 720, 'special://xbmc/media/black.png', colorDiffuse='E6000000'))
            self.addControl(xbmcgui.ControlLabel(140, 30, 1000, 50, '[B]%s[/B]' % s('title'), alignment=2))
            self.addControl(xbmcgui.ControlLabel(90, 80, 1100, 40, s('scan'), alignment=2))
            self.addControl(xbmcgui.ControlImage(470, 125, 340, 340, img))
            self.addControl(xbmcgui.ControlLabel(40, 475, 1200, 40, '[COLOR deepskyblue]%s[/COLOR]' % shown_address(),
                                                 alignment=2))
            note = xbmcgui.ControlTextBox(140, 520, 1000, 70)
            self.addControl(note)
            note.setText('[COLOR grey]%s[/COLOR]' % s('note'))
            self.btn_send = xbmcgui.ControlButton(330, 610, 380, 56, s('send'), alignment=6)
            self.btn_close = xbmcgui.ControlButton(730, 610, 220, 56, s('close'), alignment=6)
            self.addControl(self.btn_send)
            self.addControl(self.btn_close)
            self.btn_send.controlRight(self.btn_close)
            self.btn_close.controlLeft(self.btn_send)
            self.setFocus(self.btn_send)

        def onControl(self, control):
            if control == self.btn_close:
                return self.close()
            if control == self.btn_send:
                ok = send_saved(link)
                d.notification('TeleNova', s('sent') if ok else s('send_fail'),
                               xbmcgui.NOTIFICATION_INFO if ok else xbmcgui.NOTIFICATION_WARNING, 5000)
                if ok:
                    self.close()

        def onAction(self, action):
            if action.getId() in (9, 10, 92, 216, 247, 257, 275, 61467, 61448):
                self.close()

    w = Win()
    try:
        w.doModal()
    finally:
        del w
        try:
            os.remove(img)                         # the picture holds the API hash: not kept on the device
        except OSError:
            pass
    return True
