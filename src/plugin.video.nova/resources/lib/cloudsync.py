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
START_WAIT = 60         # seconds a call waits for an engine that says it is still starting / restarting
START_PAUSE = 2.0


def engine(method, timeout=60, **params):
    """the Telegram engine's local service; raises RuntimeError with its reason. 6.5.1 - three endings that used
    to be one: 'service_down: <Type>' (nothing answers on the port), 'timeout' (the engine took the call and did
    not answer in time), 'service_starting' (it answers, but was still starting after START_WAIT seconds)."""
    import time
    import requests
    import xbmcvfs
    began = time.time()
    while True:
        try:
            with open(xbmcvfs.translatePath('special://profile/addon_data/plugin.video.telescope/port.json'), encoding='utf-8') as f:
                info = json.load(f)
            r = requests.post('http://127.0.0.1:%d/rpc' % info['port'], timeout=timeout,
                              json={'method': method, 'params': params, 'secret': info.get('secret')}).json()
            if not isinstance(r, dict):
                raise ValueError('not the engine')
        except Exception as e:
            if isinstance(e, requests.Timeout) and not isinstance(e, requests.ConnectionError):
                raise RuntimeError('timeout')
            raise RuntimeError('service_down: %s' % type(e).__name__)
        err = str(r.get('error') or '')
        if 'service_starting' in err:
            if time.time() - began < START_WAIT:
                time.sleep(START_PAUSE)
                continue
            raise RuntimeError('service_starting')
        if err:
            raise RuntimeError(err)
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
    'synced': ('הסנכרון בוצע. המכשיר הזה והחשבון זהים.', 'Synced. This device and the account are the same.',
               'Синхронизировано. Это устройство и аккаунт совпадают.'),
    'file_full': ('ייצוא מלא לקובץ - גם כל התוספים', 'Full export to a file - with every add-on', 'Полный экспорт в файл - со всеми дополнениями'),
    'on': ('סנכרון אוטומטי: פעיל', 'Automatic sync: on', 'Автосинхронизация: включена'),
    'off': ('סנכרון אוטומטי: כבוי', 'Automatic sync: off', 'Автосинхронизация: выключена'),
    'wait_tg': ('סנכרון אוטומטי: ממתין לחיבור טלגרם', 'Automatic sync: waiting for a Telegram login',
                'Автосинхронизация: ждёт входа в Telegram'),
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
                'Пользователи, избранное, история, поиски, настройки, ключи и входы в сервисы синхронизируются сами между '
                'всеми устройствами с одним аккаунтом Telegram - без вопросов и без перезапуска. Они хранятся запечатанным '
                'файлом в «Избранном» аккаунта. Сам вход в Telegram там не хранится.'),
    'file_out': ('ייצוא לקובץ - הכול, כולל הכניסה לטלגרם', 'Export to a file - everything, with the Telegram login',
                 'Экспорт в файл - всё, включая вход в Telegram'),
    'file_in': ('ייבוא מקובץ', 'Import from a file', 'Импорт из файла'),
    # 6.3.0
    'update': ('מכשיר אחר כתב גרסה חדשה של הסנכרון - עדכן את TeleNova כדי להמשיך לשלוח שינויים',
               'Another device wrote a newer sync version - update TeleNova to keep sending changes',
               'Другое устройство записало новую версию синхронизации - обновите TeleNova, чтобы отправлять изменения'),
    'locked': ('המפתחות בחשבון נעולים בסיסמה - הזן אותה במסך הסנכרון',
               'The keys in the account are locked with a passphrase - enter it on the sync screen',
               'Ключи в аккаунте закрыты паролем - введите его на экране синхронизации'),
    'sync_screen': ('הגדרות סנכרון: קטגוריות, מכשירים, סיסמה', 'Sync settings: categories, devices, passphrase',
                    'Настройки синхронизации: категории, устройства, пароль'),
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
    elif state in ('update', 'locked'):          # 6.3.0: shown as an error with its reason
        return 'error', s(state)
    return state, detail


MENU_KEYS = ('toggle', 'now', 'screen', 'users', 'out', 'full', 'in', 'send', 'receive')


def head_row(is_on, ready):
    """the key of the first row of the menu: what the sync really does now (pure, tested)"""
    if not is_on:
        return 'off'
    return 'on' if ready else 'wait_tg'


def menu_rows(is_on, ready, user_line, send, receive, label=None):
    """-> [(key, label)] in the order of MENU_KEYS (pure, tested). 6.5.1: the rows are dispatched by key, so moving
    a row cannot wire it to another row's action; the sync settings screen is the third row (was the ninth)"""
    label = label or s
    return [('toggle', label(head_row(is_on, ready))), ('now', label('now')), ('screen', label('sync_screen')),
            ('users', user_line), ('out', label('file_out')), ('full', label('file_full')), ('in', label('file_in')),
            ('send', send), ('receive', receive)]


def menu():
    """4.1.0: the sync works by itself; this menu only switches it, shows the users and makes / reads backup files"""
    import xbmc
    import xbmcgui
    from . import autosync, backup, users
    d = xbmcgui.Dialog()
    sel = 0
    while True:
        from . import pairui                       # 4.2: device pairing
        ready = account_ready()                    # once a round (a call to the engine): the first row and the guard
        rows = menu_rows(autosync.is_on(), ready, '%s: %s' % (users.s('title'), users.current_name()),
                         pairui.s('send'), pairui.s('receive'))
        i = d.select(s('title'), [r[1] for r in rows], preselect=sel)
        if i < 0:
            break
        sel = i
        key = rows[i][0]
        if key in ('toggle', 'now') and not ready:
            d.ok('TeleNova', s('need_tg'))
            continue
        if key == 'toggle':
            if not autosync.is_on():
                d.ok('TeleNova', s('explain'))
            autosync.set_on(not autosync.is_on())
            xbmcgui.Window(10000).setProperty('bn.sync.now', '1')
        elif key == 'now':
            res = autosync.run_once('asked')
            d.ok('TeleNova', s('synced') if res is not None else s('push_fail'))
        elif key == 'users':
            xbmc.executebuiltin('ActivateWindow(Videos,plugin://plugin.video.nova/?a=users,return)')
            break
        elif key == 'out':
            backup.backup(full=False)
        elif key == 'full':
            backup.backup(full=True)
        elif key == 'in':
            backup.restore()
        elif key == 'send':
            pairui.send()
        elif key == 'receive':
            pairui.receive()
        elif key == 'screen':                      # 6.3.0 (P3)
            from . import sync_ui
            if sync_ui.screen():                   # it opened the Telegram login: this menu must not come back over it
                return
    xbmc.executebuiltin('Container.Refresh')
