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
    'on': ('פעיל', 'on', 'включено'),
    # 6.5.1: what really happens now, when nothing can sync
    'no_tg': ('טלגרם לא מחובר - אין סנכרון כרגע (לחץ לחיבור)', 'Telegram is not connected - nothing syncs now (press to log in)',
              'Telegram не подключён - синхронизации нет (нажмите для входа)'),
    'sync_off': ('הסנכרון האוטומטי כבוי - אין סנכרון כרגע', 'Automatic sync is off - nothing syncs now',
                 'Автосинхронизация выключена - сейчас ничего не синхронизируется'),
    'none_tg': ('טלגרם לא מחובר - רשימת המכשירים תופיע אחרי החיבור', 'Telegram is not connected - the devices appear after the login',
                'Telegram не подключён - устройства появятся после входа'),
    'pass_short': ('הסיסמה קצרה (פחות מ-6 תווים) וקלה לניחוש. להשתמש בה בכל זאת?',
                   'This passphrase is short (under 6 characters) and easy to guess. Use it anyway?',
                   'Пароль короткий (меньше 6 символов), его легко подобрать. Всё равно использовать?'),
    'saved': ('נשמר - יסונכרן מיד', 'Saved - syncing now', 'Сохранено - синхронизация'),
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
    'pass_clear': ('להסיר את הסיסמה מהמכשיר הזה? המפתחות בחשבון נשארים נעולים: המכשיר הזה יפסיק לקבל ולשלוח אותם, '
                   'ושאר המכשירים ממשיכים כרגיל עם הסיסמה.',
                   'Remove the passphrase from this device? The keys in the account stay locked: this device stops '
                   'receiving and sending them; the other devices carry on with the passphrase.',
                   'Убрать пароль с этого устройства? Ключи в аккаунте остаются закрытыми: это устройство перестанет '
                   'получать и отправлять их, остальные устройства продолжат работать с паролем.'),
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


def screen_rows(cats, has_pass, ready, sync_on, n_devices=0, label=None):
    """-> ([(text, state)], head): the rows of the screen and how many notice rows stand before the real ones
    (pure, tested). state is 'on' / 'off' for a switch, '' for the rest. 6.5.1: when nothing can sync (Telegram
    not connected, or the automatic sync switched off) the first row says so - the screen used to read "synced"."""
    label = label or s
    rows, head = [], 0
    if not ready:
        rows.append((label('no_tg'), ''))
        head = 1
    elif not sync_on:
        rows.append((label('sync_off'), ''))
        head = 1
    for c in autosync.CATS:
        on = bool(cats.get(c))
        rows.append(('%s: %s' % (label(c), label('on') if on else label('off')), 'on' if on else 'off'))
    rows.append((label('pass_set') if has_pass else label('pass_none'), ''))
    rows.append((label('devices') + (' (%d)' % n_devices if n_devices else ''), ''))
    return rows, head


def paint(row):
    """the state at the end of a switch row in colour: green = on, grey = not on this device"""
    text, state = row
    if state and ': ' in text:
        a, b = text.rsplit(': ', 1)
        return '%s: [COLOR %s]%s[/COLOR]' % (a, 'limegreen' if state == 'on' else 'grey', b)
    return text


def screen():
    """-> True when the screen left for the Telegram login window (the caller must not open a dialog over it)"""
    import xbmc
    import xbmcgui
    from . import cloudsync                       # inside: cloudsync imports this module the same way
    d = xbmcgui.Dialog()
    win = xbmcgui.Window(10000)
    hidden = dict(type=xbmcgui.INPUT_ALPHANUM, option=xbmcgui.ALPHANUM_HIDE_INPUT)
    sel = 0
    while True:
        loc = autosync.local_get()
        cats = autosync.norm_cats(loc.get('cats'))
        ready = cloudsync.account_ready()         # once a round
        devs = autosync.devices()
        rows, head = screen_rows(cats, bool(loc.get('pass')), ready, autosync.is_on(), len(devs))
        i = d.select(s('title'), [paint(r) for r in rows], preselect=sel)
        if i < 0:
            return False
        sel = i                                   # the chosen row keeps the focus when the list is drawn again
        if head and i == 0:
            if not ready:                         # the dialog is closed; the login window opens
                xbmc.executebuiltin('ActivateWindow(Videos,plugin://plugin.video.telescope/?mode=account,return)')
                return True
            continue
        i -= head
        if i < len(autosync.CATS):
            c = autosync.CATS[i]
            cats[c] = not cats[c]
            autosync.local_set(cats=cats)
            win.setProperty('bn.sync.now', '1')
            if ready and autosync.is_on():
                d.notification(s('title'), s('saved'), xbmcgui.NOTIFICATION_INFO, 2000, False)
        elif i == len(autosync.CATS):
            if loc.get('pass'):
                if d.yesno(s('title'), s('pass_clear')):
                    autosync.local_set(**{'pass': None})
                    win.setProperty('bn.sync.now', '1')      # the "locked" state shows at once
                continue
            d.ok(s('title'), s('pass_explain'))
            p1 = (d.input(s('pass_ask'), **hidden) or '').strip()
            if not p1:
                continue
            # a short passphrase is allowed (the web has no minimum - a block would lock this device out of an
            # account that already uses one), the owner is asked first
            if len(p1) < 6 and not d.yesno(s('title'), s('pass_short')):
                continue
            p2 = (d.input(s('pass_again'), **hidden) or '').strip()
            if p1 != p2:
                d.ok(s('title'), s('pass_diff'))
                continue
            autosync.local_set(**{'pass': p1})
            win.setProperty('bn.sync.now', '1')
        else:
            lines = device_rows(devs)
            d.textviewer(s('devices'), '\n'.join(lines) if lines else (s('none') if ready else s('none_tg')))
