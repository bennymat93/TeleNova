# -*- coding: utf-8 -*-
"""The hub's side of the account's cloud: the call to the Telegram engine's local service, the reader of Kodi
settings files, and the "automatic sync and backup" menu.

4.0.4 kept one zip per device in the account and asked at start whether to take a newer one (a restore closed
Kodi). 4.1.0 replaced that by the continuous sync (autosync.py + syncdoc.py: one document, merged by every device,
no questions, no restart); the old push / take code was removed in 4.1.1."""
import json
import re


# ------------------------------------------------------------------ pure
def settings_map(xml_text):
    """Kodi settings.xml (either format) -> {id: value}"""
    out = {}
    for m in re.finditer(r'<setting\s+id="([^"]+)"([^>]*?)(?:/>|>(.*?)</setting>)', xml_text or '', re.S):
        sid, attrs, body = m.group(1), m.group(2), m.group(3)
        if body is None:
            v = re.search(r'\bvalue="([^"]*)"', attrs)
            body = v.group(1) if v else ''
        out[sid] = body.strip()
    return out



# ------------------------------------------------------------------ Kodi side
def engine(method, timeout=60, **params):
    """the Telegram engine's local service; raises RuntimeError with its reason"""
    import requests
    import xbmcvfs
    try:
        with open(xbmcvfs.translatePath('special://profile/addon_data/plugin.video.telescope/port.json'), encoding='utf-8') as f:
            info = json.load(f)
        r = requests.post('http://127.0.0.1:%d/rpc' % info['port'], timeout=timeout,
                          json={'method': method, 'params': params, 'secret': info.get('secret')}).json()
    except Exception as e:
        raise RuntimeError('service_down: %s' % type(e).__name__)
    if r.get('error'):
        raise RuntimeError(str(r['error']))
    return r.get('result')


def account_ready():
    try:
        return bool((engine('status', 20) or {}).get('authorized'))
    except RuntimeError:
        return False



# ------------------------------------------------------------------ menu
STR = {
    'title': ('סנכרון אוטומטי וגיבוי', 'Automatic sync and backup', 'Автосинхронизация и копии'),
    'now': ('סנכרן עכשיו', 'Sync now', 'Синхронизировать сейчас'),
    'synced': ('הסנכרון בוצע. המכשיר הזה והחשבון זהים.', 'Synced. This device and the account are the same.', 'Синхронизировано.'),
    'file_full': ('ייצוא מלא לקובץ - גם כל התוספים', 'Full export to a file - with every add-on', 'Полный экспорт в файл - со всеми дополнениями'),
    'on': ('סנכרון אוטומטי: פעיל', 'Automatic sync: on', 'Автосинхронизация: включена'),
    'off': ('סנכרון אוטומטי: כבוי', 'Automatic sync: off', 'Автосинхронизация: выключена'),
    'need_tg': ('נדרשת כניסה לחשבון טלגרם - הגיבוי נשמר ב"הודעות שמורות" של החשבון',
                'A Telegram login is needed - the copy is kept in the account\'s "Saved Messages"',
                'Нужен вход в Telegram - копия хранится в «Избранном» аккаунта'),
    'push_fail': ('השמירה נכשלה', 'Saving failed', 'Не удалось сохранить'),
    'explain': ('המשתמשים, המועדפים, ההיסטוריה, החיפושים, ההגדרות, המפתחות והחיבורים לשירותים מסתנכרנים לבד בין כל המכשירים '
                'שמחוברים לאותו חשבון טלגרם - בלי לשאול ובלי להפעיל מחדש. הם נשמרים כקובץ חתום ב"הודעות שמורות" של החשבון. '
                'הכניסה לטלגרם עצמה לא נשמרת שם.',
                'Users, favourites, history, searches, settings, keys and service logins sync by themselves between all '
                'devices logged in to the same Telegram account - no questions, no restart. They are kept as a sealed '
                'file in the account\'s "Saved Messages". The Telegram login itself is not kept there.',
                'Настройки, ключи и входы в сервисы хранятся запечатанным файлом в «Избранном» вашего Telegram. Каждое '
                'устройство со сборкой и тем же аккаунтом получает их. Сам вход в Telegram в файл не входит.'),
    'file_out': ('ייצוא לקובץ - הכול, כולל הכניסה לטלגרם', 'Export to a file - everything, with the Telegram login',
                 'Экспорт в файл - всё, включая вход в Telegram'),
    'file_in': ('ייבוא מקובץ', 'Import from a file', 'Импорт из файла'),
}


def s(key):
    from .common import ui_lang
    return STR[key][{'he': 0, 'en': 1, 'ru': 2}[ui_lang()]]


def status_line():
    """(state, detail) for the services screen: 'on' | 'off' | 'login'"""
    from . import autosync
    state, detail = autosync.status()
    if state == 'login':
        detail = s('need_tg')
    return state, detail


def menu():
    """4.1.0: the sync works by itself; this menu only switches it, shows the users and makes / reads backup files"""
    import xbmc
    import xbmcgui
    from . import autosync, backup, users
    d = xbmcgui.Dialog()
    while True:
        rows = [s('on') if autosync.is_on() else s('off'), s('now'), '%s: %s' % (users.s('title'), users.current_name()),
                s('file_out'), s('file_full'), s('file_in')]
        i = d.select(s('title'), rows)
        if i < 0:
            break
        if i in (0, 1) and not account_ready():
            d.ok('TeleNova', s('need_tg'))
            continue
        if i == 0:
            if not autosync.is_on():
                d.ok('TeleNova', s('explain'))
            autosync.set_on(not autosync.is_on())
            xbmcgui.Window(10000).setProperty('bn.sync.now', '1')
        elif i == 1:
            res = autosync.run_once('asked')
            d.ok('TeleNova', s('synced') if res is not None else s('push_fail'))
        elif i == 2:
            xbmc.executebuiltin('ActivateWindow(Videos,plugin://plugin.video.nova/?a=users,return)')
            break
        elif i == 3:
            backup.backup(full=False)
        elif i == 4:
            backup.backup(full=True)
        elif i == 5:
            backup.restore()
    xbmc.executebuiltin('Container.Refresh')
