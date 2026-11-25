# -*- coding: utf-8 -*-
"""6.3.0 (P3): the sync screen of this device - what this device takes part in, the devices of the account, and the
owner's passphrase for the keys.

A category switched off here is neither sent from here nor written here; the account's data of that category passes
through this device untouched (nothing is deleted anywhere). The choices and the passphrase stay on this device
(autosync.LOCAL_FILE, kept out of backups) - the passphrase is typed by the owner and never synced."""
import time

from . import autosync

STR = {
    'title': ('הגדרות סנכרון', 'Sync settings', 'Настройки синхронизации'),
    'lists': ('משתמשים, היסטוריה, מועדפים וחיפושים', 'Users, history, favourites and searches',
              'Пользователи, история, избранное и поиски'),
    'settings': ('הגדרות, מפתחות וחיבורים', 'Settings, keys and logins', 'Настройки, ключи и входы'),
    'files': ('רשימות IPTV ובחירת מקורות', 'IPTV lists and source choices', 'Списки IPTV и выбор источников'),
    'on': ('מסונכרן', 'synced', 'синхронизируется'),
    'off': ('לא במכשיר הזה', 'not on this device', 'не на этом устройстве'),
    'devices': ('מכשירים בחשבון', 'Devices in the account', 'Устройства в аккаунте'),
    'this': ('המכשיר הזה', 'this device', 'это устройство'),
    'none': ('עדיין אין מכשירים רשומים - הם נרשמים בשליחה הבאה', 'No devices listed yet - they appear with their next upload',
             'Устройств пока нет - они появятся после следующей отправки'),
    'pass_set': ('סיסמה למפתחות: מוגדרת', 'Passphrase for the keys: set', 'Пароль для ключей: задан'),
    'pass_none': ('סיסמה למפתחות: אין', 'Passphrase for the keys: none', 'Пароль для ключей: нет'),
    'pass_ask': ('סיסמה למפתחות (אותה סיסמה בכל המכשירים)', 'Passphrase for the keys (the same on every device)',
                 'Пароль для ключей (одинаковый на всех устройствах)'),
    'pass_again': ('שוב, לאישור', 'Again, to confirm', 'Ещё раз для проверки'),
    'pass_diff': ('הסיסמאות שונות - לא נשמר', 'The two differ - not saved', 'Не совпадают - не сохранено'),
    'pass_clear': ('להסיר את הסיסמה מהמכשיר הזה?', 'Remove the passphrase from this device?', 'Убрать пароль с этого устройства?'),
    'pass_explain': ('עם סיסמה, המפתחות והטוקנים נשמרים בחשבון נעולים. מכשיר בלי הסיסמה לא יקבל אותם. '
                     'הסיסמה נשמרת רק במכשיר הזה ולא נשלחת לשום מקום.',
                     'With a passphrase the keys and tokens are kept locked in the account; a device without it does '
                     'not receive them. The passphrase stays on this device only and is never sent.',
                     'С паролем ключи и токены хранятся в аккаунте закрытыми; устройство без пароля их не получит. '
                     'Пароль хранится только на этом устройстве.'),
}


def s(key):
    from .common import ui_lang
    return STR[key][{'he': 0, 'en': 1, 'ru': 2}[ui_lang()]]


def device_rows(rows):
    """[(id, entry, mine)] -> the lines of the devices list (pure, tested)"""
    out = []
    for _, e, mine in rows:
        at = e.get('at')
        when = time.strftime('%d/%m/%Y', time.localtime(at)) if isinstance(at, (int, float)) and at > 0 else ''
        name = e.get('name') or ('Kodi' if e.get('kind') == 'kodi' else 'Web')
        out.append('%s%s  [%s · v%s%s]' % (name, ' (%s)' % s('this') if mine else '', e.get('kind') or '?', e.get('sv') or '?',
                                           ' · %s' % when if when else ''))
    return out


def screen():
    import xbmcgui
    d = xbmcgui.Dialog()
    while True:
        loc = autosync.local_get()
        cats = autosync.norm_cats(loc.get('cats'))
        rows = ['%s: %s' % (s(c), s('on') if cats[c] else s('off')) for c in autosync.CATS]
        rows += [s('pass_set') if loc.get('pass') else s('pass_none'), s('devices')]
        i = d.select(s('title'), rows)
        if i < 0:
            break
        if i < len(autosync.CATS):
            c = autosync.CATS[i]
            cats[c] = not cats[c]
            autosync.local_set(cats=cats)
            xbmcgui.Window(10000).setProperty('bn.sync.now', '1')
        elif i == len(autosync.CATS):
            if loc.get('pass'):
                if d.yesno(s('title'), s('pass_clear')):
                    autosync.local_set(**{'pass': None})
                continue
            d.ok(s('title'), s('pass_explain'))
            p1 = d.input(s('pass_ask'), type=xbmcgui.INPUT_ALPHANUM, option=xbmcgui.ALPHANUM_HIDE_INPUT)
            if not p1:
                continue
            p2 = d.input(s('pass_again'), type=xbmcgui.INPUT_ALPHANUM, option=xbmcgui.ALPHANUM_HIDE_INPUT)
            if p1 != p2:
                d.ok(s('title'), s('pass_diff'))
                continue
            autosync.local_set(**{'pass': p1})
            xbmcgui.Window(10000).setProperty('bn.sync.now', '1')
        else:
            lines = device_rows(autosync.devices())
            d.select(s('devices'), lines or [s('none')])
