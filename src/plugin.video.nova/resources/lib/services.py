# -*- coding: utf-8 -*-
"""4.0.4: every service of the build on one screen.

One row per service with its state - active, off, a key is missing, a login is needed, error - and one press opens
what can be done with it: switch on / off, connect, type the key, open the page that issues the key (in the device's
browser), test now. The setup backup (sync through the Telegram account, export, import) is at the top.

The states are worked out in services_state() from plain facts (facts()), so the rules are tested without Kodi
(qa/t_services.py)."""
import threading
import time

ENGINE = 'plugin.video.telescope'
ALLSUBS = 'service.subtitles.All_Subs'

# state -> (colour, mark)
LOOK = {'on': ('limegreen', u'●'), 'off': ('grey', u'○'), 'key': ('orange', u'◐'),
        'login': ('orange', u'◐'), 'setup': ('orange', u'◐'), 'error': ('red', u'●')}

STR = {
    'title': ('שירותים וחיבורים', 'Services and connections', 'Сервисы и подключения'),
    'on': ('פעיל', 'active', 'активен'), 'off': ('כבוי', 'off', 'выключен'),
    'key': ('חסר מפתח API', 'API key missing', 'нет ключа API'),
    'login': ('נדרשת כניסה לחשבון', 'login needed', 'нужен вход'),
    'setup': ('נדרשת הגדרה', 'needs setting up', 'нужна настройка'),
    'error': ('שגיאה', 'error', 'ошибка'),
    'summary': ('פעילים %d  ·  כבויים %d  ·  דורשים טיפול %d  ·  שגיאות %d',
                'active %d  ·  off %d  ·  need attention %d  ·  errors %d',
                'активны %d  ·  выключены %d  ·  требуют внимания %d  ·  ошибки %d'),
    'turn_on': ('הפעל', 'Switch on', 'Включить'), 'turn_off': ('כבה', 'Switch off', 'Выключить'),
    'connect': ('התחבר לחשבון', 'Connect the account', 'Подключить аккаунт'),
    'disconnect': ('התנתק מהחשבון', 'Disconnect the account', 'Отключить аккаунт'),
    'enter_key': ('הזן מפתח API', 'Type the API key', 'Ввести ключ API'),
    'clear_key': ('מחק את המפתח', 'Delete the key', 'Удалить ключ'),
    'open_page': ('פתח בדפדפן את הדף שבו מקבלים מפתח / נכנסים לחשבון', 'Open the key / account page in the browser',
                  'Открыть страницу ключа / аккаунта в браузере'),
    'test': ('בדוק עכשיו', 'Test now', 'Проверить сейчас'),
    'manage': ('פתח את המסך של השירות', 'Open the service\'s own screen', 'Открыть экран сервиса'),
    'address': ('הזן כתובת', 'Type the address', 'Ввести адрес'),
    'email': ('אימייל של החשבון', 'Account e-mail', 'E-mail аккаунта'),
    'password': ('סיסמה', 'Password', 'Пароль'),
    'checking': ('בודק את השירותים...', 'Checking the services...', 'Проверка сервисов...'),
    'backup': ('גיבוי ההגדרות: סנכרון בין מכשירים, ייצוא, ייבוא', 'Setup backup: sync between devices, export, import',
               'Копия настроек: синхронизация, экспорт, импорт'),
    'sync_on': ('סנכרון פעיל', 'sync on', 'синхронизация включена'),
    'sync_off': ('סנכרון כבוי', 'sync off', 'синхронизация выключена'),
    'export': ('ייצוא כל ההגדרות והחיבורים לקובץ', 'Export every setting and login to a file',
               'Экспорт всех настроек и входов в файл'),
    'import': ('ייבוא הגדרות וחיבורים מקובץ', 'Import settings and logins from a file', 'Импорт настроек и входов из файла'),
    'g_sources': ('מקורות לתוכן', 'Content sources', 'Источники'), 'g_subs': ('כתוביות', 'Subtitles', 'Субтитры'),
    'g_ai': ('בינה מלאכותית ומידע', 'AI and metadata', 'ИИ и метаданные'), 'g_tv': ('טלוויזיה וגיבוי', 'TV and backup', 'ТВ и копии'),
    'ok': ('תקין', 'OK', 'OK'),
    'need_rd': ('דורש חשבון Real-Debrid מחובר', 'needs a connected Real-Debrid account', 'нужен подключённый Real-Debrid'),
    'kt_saved': ('החשבון נשמר. ייכנס לשימוש בתוך כשעה (או אחרי הפעלה מחדש של Kodi).',
                 'The account was saved. It is used within about an hour (or after Kodi restarts).',
                 'Аккаунт сохранён. Начнёт использоваться в течение часа (или после перезапуска Kodi).'),
    'kt_bad': ('הכניסה ל-Ktuvit נכשלה', 'The Ktuvit login failed', 'Вход в Ktuvit не удался'),
}

# what each service is, in one line (he, en, ru)
ABOUT = {
    'telegram': ('המקור הראשי: הערוצים, הקבוצות והבוטים של חשבון הטלגרם שלך.',
                 'The main source: the channels, groups and bots of your Telegram account.',
                 'Главный источник: каналы, группы и боты вашего Telegram.'),
    'rd': ('Real-Debrid (בתשלום, של המשתמש): קישורים ישירים מהירים מקבצים שנמצאים כבר בשרתים שלו.',
           'Real-Debrid (paid, your own account): fast direct links to files already on its servers.',
           'Real-Debrid (платный, ваш аккаунт): быстрые прямые ссылки на файлы на его серверах.'),
    'stremthru': ('StremThru (חינמי, קוד פתוח): בודק אילו קבצים באמת זמינים ב-Real-Debrid לפני שהם מוצגים. '
                  'שים לב: מפתח ה-Real-Debrid נשלח לשרת StremThru. כבוי כברירת מחדל.',
                  'StremThru (free, open source): checks which files really are available at Real-Debrid before they '
                  'are listed. Note: the Real-Debrid key is sent to the StremThru server. Off by default.',
                  'StremThru (бесплатно, открытый код): проверяет, какие файлы действительно доступны в Real-Debrid. '
                  'Внимание: ключ Real-Debrid отправляется на сервер StremThru. По умолчанию выключен.'),
    'opensubs': ('זיהוי ודאי של קובץ לפי טביעת האצבע שלו ב-OpenSubtitles (חינמי, דורש מפתח API אישי). כבוי כברירת מחדל.',
                 'Certain identification of a file by its OpenSubtitles fingerprint (free, needs your own API key). '
                 'Off by default.',
                 'Точное опознание файла по отпечатку OpenSubtitles (бесплатно, нужен свой ключ API). По умолчанию выключено.'),
    'ktuvit_own': ('כתוביות מ-Ktuvit עם החשבון האישי שלך במקום החשבון המשותף של התוסף. כבוי כברירת מחדל.',
                   'Ktuvit subtitles through your own account instead of the add-on\'s shared one. Off by default.',
                   'Субтитры Ktuvit через ваш аккаунт вместо общего аккаунта дополнения. По умолчанию выключено.'),
    'sub_ktuvit': ('אתר הכתוביות Ktuvit', 'The Ktuvit subtitle site', 'Сайт субтитров Ktuvit'),
    'sub_wizdom': ('אתר הכתוביות Wizdom', 'The Wizdom subtitle site', 'Сайт субтитров Wizdom'),
    'sub_opensubtitles': ('אתר הכתוביות OpenSubtitles', 'The OpenSubtitles subtitle site', 'Сайт субтитров OpenSubtitles'),
    'sub_yify': ('אתר הכתוביות YIFY (סרטים)', 'The YIFY subtitle site (films)', 'Сайт субтитров YIFY (фильмы)'),
    'bots': ('בוטים בטלגרם שמוסרים קבצים לפי בקשה.', 'Telegram bots that hand out files on request.',
             'Боты Telegram, выдающие файлы по запросу.'),
    'stremio': ('שרתי Stremio של טלגרם שהוספת (כתובת manifest).', 'Stremio Telegram servers you added (manifest address).',
                'Добавленные вами серверы Stremio (адрес manifest).'),
    'gemini': ('Gemini AI (מפתח חינמי): שמות חלופיים לחיפוש, אימות תוצאות, תרגום וזיהוי כתוביות צרובות.',
               'Gemini AI (free key): search aliases, result checks, translation, burned-in subtitle detection.',
               'Gemini AI (бесплатный ключ): варианты названий, проверка результатов, перевод.'),
    'tmdb': ('TMDb: קטלוג הסרטים והסדרות. יש מפתח מובנה; מפתח אישי הוא אופציונלי.',
             'TMDb: the film and series catalogue. A key is built in; your own key is optional.',
             'TMDb: каталог фильмов и сериалов. Ключ встроен; свой ключ необязателен.'),
    'server': ('שרת הכתוביות AI במחשב הביתי (תמלול ותרגום).', 'The AI subtitle server on the home PC (transcription, translation).',
               'Сервер ИИ-субтитров на домашнем ПК.'),
    'iptv': ('רשימת ערוצים אישית (M3U + EPG) מספק ה-IPTV שלך.', 'Your own channel list (M3U + EPG) from your IPTV provider.',
             'Ваш список каналов (M3U + EPG) от провайдера.'),
    'gdrive': ('Google Drive: גיבויים וקבצים אישיים.', 'Google Drive: backups and your own files.', 'Google Drive: копии и ваши файлы.'),
}

# key, name, group, page key (weblink.PAGES)
ROWS = [
    ('telegram', 'Telegram', 'g_sources', 'telegram'),
    ('rd', 'Real-Debrid', 'g_sources', 'rd'),
    ('stremthru', 'StremThru', 'g_sources', 'stremthru'),
    ('opensubs', 'OpenSubtitles ID', 'g_sources', 'opensubs'),
    ('bots', 'Telegram bots', 'g_sources', None),
    ('stremio', 'Stremio servers', 'g_sources', None),
    ('ktuvit_own', 'Ktuvit (own account)', 'g_subs', 'ktuvit'),
    ('sub_ktuvit', 'Ktuvit', 'g_subs', 'ktuvit'),
    ('sub_wizdom', 'Wizdom', 'g_subs', None),
    ('sub_opensubtitles', 'OpenSubtitles', 'g_subs', 'opensubs_account'),
    ('sub_yify', 'YIFY', 'g_subs', None),
    ('server', 'AI Subtitle Server', 'g_subs', None),
    ('gemini', 'Gemini AI', 'g_ai', 'gemini'),
    ('tmdb', 'TMDb', 'g_ai', 'tmdb'),
    ('iptv', 'IPTV (M3U + EPG)', 'g_tv', None),
    ('gdrive', 'Google Drive', 'g_tv', 'gdrive'),
]


def s(key):
    from .common import ui_lang
    return STR[key][{'he': 0, 'en': 1, 'ru': 2}[ui_lang()]]


def about(key):
    from .common import ui_lang
    return ABOUT[key][{'he': 0, 'en': 1, 'ru': 2}[ui_lang()]]


# ------------------------------------------------------------------ rules (no Kodi)
def services_state(f):
    """facts -> {key: (state, detail)}. A fact that is missing counts as "not there"."""
    g = f.get
    out = {}
    tg = g('telegram') or {}
    out['telegram'] = ('on', tg.get('name') or '') if tg.get('ok') else \
        ('error', tg.get('error')) if tg.get('error') else ('login', '')
    rd = g('rd') or {}
    if not g('rd_enabled', True):
        out['rd'] = ('off', rd.get('username') or '')
    elif not rd.get('logged_in'):
        out['rd'] = ('login', '')
    elif rd.get('error'):
        out['rd'] = ('error', rd['error'])
    else:
        out['rd'] = ('on', '%s · %s d' % (rd.get('username') or '', rd.get('days', 0)))
    if not g('st_enabled'):
        out['stremthru'] = ('off', '')
    elif not rd.get('logged_in'):
        out['stremthru'] = ('login', 'Real-Debrid')
    else:
        chk = g('st_check')
        out['stremthru'] = ('error', chk[1]) if chk and chk[0] is False else ('on', (chk or (None, ''))[1])
    if not g('os_enabled'):
        out['opensubs'] = ('off', '')
    elif not g('os_key'):
        out['opensubs'] = ('key', '')
    else:
        chk = g('os_check')
        out['opensubs'] = ('error', chk[1]) if chk and chk[0] is False else ('on', (chk or (None, ''))[1])
    if not g('ktuvit_own'):
        out['ktuvit_own'] = ('off', '')
    elif not (g('ktuvit_email') and g('ktuvit_enc')):
        out['ktuvit_own'] = ('login', '')
    else:
        out['ktuvit_own'] = ('on', g('ktuvit_email'))
    for site in ('ktuvit', 'wizdom', 'opensubtitles', 'yify'):
        v = g('sub_' + site)
        out['sub_' + site] = ('setup', 'All_Subs') if v is None else ('on', '') if v else ('off', '')
    out['bots'] = ('on', '') if g('bot_request', True) else ('off', '')
    n = g('stremio_count', 0)
    out['stremio'] = ('on', str(n)) if n else ('off', '')
    for k in ('gemini', 'tmdb', 'server', 'iptv', 'gdrive'):
        ok, detail = g(k + '_check') or (None, '')
        if ok:
            out[k] = ('on', detail)
        elif ok is None:
            out[k] = ({'gemini': 'key', 'tmdb': 'key', 'server': 'setup', 'iptv': 'setup', 'gdrive': 'off'}[k], detail)
        else:
            out[k] = ('error', detail)
    return out


def summary_counts(states):
    c = {'on': 0, 'off': 0, 'todo': 0, 'error': 0}
    for st, _ in states.values():
        c[st if st in ('on', 'off', 'error') else 'todo'] += 1
    return c['on'], c['off'], c['todo'], c['error']


# ------------------------------------------------------------------ facts (Kodi)
def _flags():
    from .common import load
    return load('services.json', {})


def _set_flags(**kw):
    from .common import load, save
    f = load('services.json', {})
    f.update(kw)
    save('services.json', f)


def _addon(aid):
    import os
    import xbmc
    import xbmcaddon
    import xbmcvfs
    # the folder is asked, not System.HasAddon: Kodi answers "no" for an id with capital letters (All_Subs)
    if not xbmc.getCondVisibility('System.HasAddon(%s)' % aid) and \
            not os.path.isdir(xbmcvfs.translatePath('special://home/addons/%s' % aid)):
        return None
    try:
        return xbmcaddon.Addon(aid)
    except Exception:
        return None


def _engine_bool(a, key, default):
    v = a.getSetting(key) if a else ''
    return default if v == '' else v == 'true'


def facts(deep=True):
    """everything the screen shows, gathered in parallel (each check has its own time limit)"""
    from . import accounts, cloudsync
    eng, subs, fl = _addon(ENGINE), _addon(ALLSUBS), _flags()
    f = {'rd_enabled': _engine_bool(eng, 'rd_enabled', True), 'st_enabled': _engine_bool(eng, 'st_enabled', False),
         'os_enabled': _engine_bool(eng, 'os_enabled', False), 'os_key': (eng.getSetting('os_key') if eng else '').strip(),
         'bot_request': _engine_bool(eng, 'bot_request', True),
         'stremio_count': len([x for x in (eng.getSetting('stremio_servers') if eng else '').replace('\n', ',').split(',') if x.strip()]),
         'ktuvit_own': bool(fl.get('ktuvit_own')), 'ktuvit_email': fl.get('ktuvit_email') or '', 'ktuvit_enc': fl.get('ktuvit_enc') or ''}
    for site in ('ktuvit', 'wizdom', 'opensubtitles', 'yify'):
        f['sub_' + site] = None if subs is None else subs.getSetting(site) != 'false'
    jobs = {}

    def tg():
        ok, detail = accounts.telegram_status()
        f['telegram'] = {'ok': bool(ok), 'name': detail if ok else '', 'error': detail if ok is False else ''}

    def rd():
        try:
            f['rd'] = cloudsync.engine('rd_status', 15) or {}
        except RuntimeError:
            f['rd'] = {}

    def svc(name, key):
        def run():
            try:
                r = cloudsync.engine('svc_check', 15, name=name) or {}
                f[key] = (r.get('ok'), r.get('detail') or '')
            except RuntimeError as e:
                f[key] = (False, str(e)[:80])
        return run

    def acc(k):
        def run():
            f[k + '_check'] = accounts.check(k)
        return run
    jobs['tg'], jobs['rd'] = tg, rd
    if deep:
        if f['st_enabled']:
            jobs['st'] = svc('stremthru', 'st_check')
        if f['os_enabled'] and f['os_key']:
            jobs['os'] = svc('opensubs', 'os_check')
    for k in ('gemini', 'tmdb', 'server', 'iptv', 'gdrive'):
        jobs[k] = acc(k)
    threads = [threading.Thread(target=j, daemon=True) for j in jobs.values()]
    for t in threads:
        t.start()
    end = time.time() + 16
    for t in threads:
        t.join(max(0.1, end - time.time()))
    return f


# ------------------------------------------------------------------ screen
def label(name, state, detail):
    colour, mark = LOOK[state]
    text = '%s   [COLOR %s]%s %s[/COLOR]' % (name, colour, mark, s(state))
    if detail and state in ('on', 'error'):
        text += '   [COLOR grey]%s[/COLOR]' % str(detail)[:60]
    return text


def screen(handle, url):
    import xbmcgui
    import xbmcplugin
    from . import cloudsync, preset
    busy = xbmcgui.DialogProgressBG()
    busy.create('TeleNova', s('checking'))
    try:
        states = services_state(facts())
        sync_state, sync_detail = cloudsync.status_line()
    finally:
        busy.close()

    def row(text, do, plot='', icon='DefaultAddonService.png'):
        li = xbmcgui.ListItem(text)
        li.getVideoInfoTag().setPlot(plot)
        li.setArt({'icon': icon})
        xbmcplugin.addDirectoryItem(handle, url(a='svc', do=do), li, False)

    row('[B]%s[/B]' % (s('summary') % summary_counts(states)), 'refresh', s('title'), 'DefaultIconInfo.png')
    row(label(s('backup'), sync_state, sync_detail).replace(s(sync_state), s('sync_on') if sync_state == 'on' else
                                                           s('sync_off') if sync_state == 'off' else s('login')),
        'backup', cloudsync.s('explain'), 'DefaultAddonProgram.png')
    row(s('export'), 'export', '', 'DefaultAddonProgram.png')
    row(s('import'), 'import', '', 'DefaultAddonProgram.png')
    group = None
    for key, name, grp, _ in ROWS:
        if grp != group:
            group = grp
            row('[COLOR gold][B]%s[/B][/COLOR]' % s(grp), 'refresh', '', 'DefaultFolder.png')
        st, detail = states[key]
        row('    ' + label(name, st, detail), key, '%s\n\n%s' % (about(key), detail or ''))
    for do, key in (('preset_unlock', 'unlock'), ('preset_create', 'create')):
        li = xbmcgui.ListItem('[COLOR gold]%s[/COLOR]' % preset.s(key))
        li.setArt({'icon': 'DefaultUser.png'})
        xbmcplugin.addDirectoryItem(handle, url(a='acc', do=do), li, False)
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)


def _engine_set(key, value):
    a = _addon(ENGINE)
    if a:
        a.setSetting(key, value)


def _test(key):
    """fresh check of one service -> shown to the viewer"""
    import xbmcgui
    st, detail = services_state(facts())[key]
    colour, mark = LOOK[st]
    xbmcgui.Dialog().ok('TeleNova', '[COLOR %s]%s %s[/COLOR]\n%s' % (colour, mark, s(st), detail or ''))


def _ktuvit_login():
    import xbmcgui
    from . import ktuvitauth
    d = xbmcgui.Dialog()
    fl = _flags()
    email = d.input(s('email'), fl.get('ktuvit_email') or '')
    if not email:
        return False
    pw = d.input(s('password'), option=xbmcgui.ALPHANUM_HIDE_INPUT)
    if not pw:
        return False
    try:
        enc = pw if ktuvitauth.looks_encoded(pw) else ktuvitauth.encode_password(email.strip(), pw)
        cookies, reason = ktuvitauth.login(email.strip(), enc)
    except Exception as e:
        cookies, reason = None, str(e)[:120]
    if not cookies:
        d.ok('TeleNova', '%s\n%s' % (s('kt_bad'), reason or ''))
        return False
    _set_flags(ktuvit_email=email.strip(), ktuvit_enc=enc, ktuvit_own=True)     # the plain password is never stored
    d.ok('TeleNova', s('kt_saved'))
    return True


def action(key):
    import xbmc
    import xbmcgui
    from . import accounts, backup, cloudsync, weblink
    d = xbmcgui.Dialog()
    if key == 'refresh':
        return xbmc.executebuiltin('Container.Refresh')
    if key == 'backup':
        cloudsync.menu()
        return xbmc.executebuiltin('Container.Refresh')
    if key == 'sync_now':               # no questions: for a remote button / QA (qa/t_cloud_live.py)
        ok, text = cloudsync.push(force=True)
        return d.notification('TeleNova', cloudsync.s('pushed') if ok else '%s: %s' % (cloudsync.s('push_fail'), text[:60]),
                              xbmcgui.NOTIFICATION_INFO if ok else xbmcgui.NOTIFICATION_WARNING, 5000)
    if key == 'export':
        return backup.backup()
    if key == 'import':
        return backup.restore()
    name, page = next((n, p) for k, n, _, p in ROWS if k == key)
    f = facts(deep=False)
    st, detail = services_state(f)[key]
    opts = []          # (label, action id)
    toggles = {'rd': ('eng', 'rd_enabled'), 'stremthru': ('eng', 'st_enabled'), 'opensubs': ('eng', 'os_enabled'),
               'bots': ('eng', 'bot_request'), 'ktuvit_own': ('flag', 'ktuvit_own'),
               'sub_ktuvit': ('subs', 'ktuvit'), 'sub_wizdom': ('subs', 'wizdom'),
               'sub_opensubtitles': ('subs', 'opensubtitles'), 'sub_yify': ('subs', 'yify')}
    if key in toggles and st != 'setup':
        opts.append((s('turn_on') if st == 'off' else s('turn_off'), 'toggle'))
    if key in ('telegram', 'gdrive', 'iptv', 'stremio'):
        opts.append((s('manage'), 'manage'))
    if key == 'rd':
        opts.append((s('disconnect') if (f.get('rd') or {}).get('logged_in') else s('connect'), 'rd_account'))
    if key == 'ktuvit_own':
        opts.append((s('connect'), 'kt_login'))
    if key in ('gemini', 'tmdb', 'opensubs'):
        opts.append((s('enter_key'), 'enter_key'))
    if key == 'server':
        opts.append((s('address'), 'address'))
    if key == 'stremthru':
        opts.append((s('address'), 'st_url'))
    if page:
        opts.append((s('open_page'), 'page'))
    opts.append((s('test'), 'test'))
    head = '%s  -  %s' % (name, s(st))
    i = d.select(head, [o[0] for o in opts])
    if i < 0:
        return
    act = opts[i][1]
    if act == 'toggle':
        kind, sid = toggles[key]
        turn_on = st == 'off'
        if turn_on and key in ('stremthru', 'opensubs', 'ktuvit_own'):
            d.ok(name, about(key))
        if kind == 'eng':
            _engine_set(sid, 'true' if turn_on else 'false')
        elif kind == 'subs':
            a = _addon(ALLSUBS)
            if a:
                a.setSetting(sid, 'true' if turn_on else 'false')
        elif turn_on and not (f.get('ktuvit_email') and f.get('ktuvit_enc')):
            _ktuvit_login()
        else:
            _set_flags(**{sid: turn_on})
        if turn_on and key == 'opensubs' and not f.get('os_key'):
            act = 'enter_key'
        elif turn_on and key == 'rd' and not (f.get('rd') or {}).get('logged_in'):
            act = 'rd_account'
    if act == 'manage':
        if key == 'stremio':
            a = _addon(ENGINE)
            v = d.input('manifest.json', a.getSetting('stremio_servers') if a else '')
            _engine_set('stremio_servers', v.strip())
        else:
            return accounts.action(key)
    elif act == 'rd_account':
        mode = 'rd_logout' if (f.get('rd') or {}).get('logged_in') else 'rd_login'
        return xbmc.executebuiltin('RunPlugin(plugin://plugin.video.telescope/?mode=%s)' % mode)
    elif act == 'kt_login':
        _ktuvit_login()
    elif act == 'enter_key':
        if key == 'opensubs':
            a = _addon(ENGINE)
            v = d.input('OpenSubtitles API key', a.getSetting('os_key') if a else '')
            _engine_set('os_key', v.strip())
        else:
            return accounts.action(key)
    elif act == 'address':
        return accounts.action('server')
    elif act == 'st_url':
        a = _addon(ENGINE)
        v = d.input('StremThru', (a.getSetting('st_url') if a else '') or 'https://')
        if v.strip().startswith('http'):
            _engine_set('st_url', v.strip())
    elif act == 'page':
        weblink.show(weblink.PAGES[page], name)
    elif act == 'test':
        xbmc.sleep(300)
        _test(key)
    xbmc.executebuiltin('Container.Refresh')
