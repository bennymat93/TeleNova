# -*- coding: utf-8 -*-
"""4.2: the two screens of "send my setup to another device" (Kodi side of pairflow.py).

  receive()   the NEW device: shows its name and address, waits for a sender, shows the 6-digit code, takes the setup,
              logs in to Telegram with its own session (the configured device approves it)
  send()      the CONFIGURED device: finds new devices that announce themselves (or takes a typed address), shows the
              same code, sends the setup, approves the new device's Telegram login (asks the two-step password, if
              the account has one, here - where there is a keyboard)
"""
import time

import xbmc
import xbmcgui

from . import pairflow, pairing
from .common import log, ui_lang

STR = {
    'send': (u'שליחת ההגדרות למכשיר אחר', 'Send my setup to another device',
           'Отправить мои настройки на другое устройство'),
    'receive': (u'קבלת הגדרות ממכשיר אחר', 'Receive setup from another device',
           'Получить настройки с другого устройства'),
    'listening': (u'המכשיר מחכה. במכשיר המוגדר: TeleNova > גיבוי וסנכרון > [B]שליחת ההגדרות למכשיר אחר[/B][CR]'
                  u'שם: [B]{name}[/B]   כתובת: [B]{address}:{port}[/B]',
                  'Waiting. On the configured device: TeleNova > Backup & sync > [B]Send my setup to another device[/B][CR]'
                  'Name: [B]{name}[/B]   Address: [B]{address}:{port}[/B]',
           'Ожидание. На настроенном устройстве: TeleNova > Копии и синхронизация > [B]Отправить мои настройки на другое устройство[/B][CR]Имя: [B]{name}[/B]   Адрес: [B]{address}:{port}[/B]'),
    'searching': (u'מחפש מכשירים שמחכים להגדרות ברשת הזאת...', 'Looking for devices waiting for a setup on this network...',
           'Поиск устройств, ожидающих настройки, в этой сети...'),
    'none_found': (u'לא נמצא מכשיר שמחכה. הקלד את הכתובת שמופיעה במכשיר החדש (למשל 192.168.1.20:51234)',
                   'No waiting device found. Type the address shown on the new device (e.g. 192.168.1.20:51234)',
           'Ожидающее устройство не найдено. Введите адрес, показанный на новом устройстве (например 192.168.1.20:51234)'),
    'type_address': (u'הקלדת כתובת...', 'Type an address...',
           'Ввести адрес...'),
    'bad_address': (u'כתובת לא תקינה - צריך כתובת ברשת הביתית ומספר, למשל 192.168.1.20:51234',
                    'Not a valid address - a home-network address and a port, e.g. 192.168.1.20:51234',
           'Неверный адрес - нужен адрес домашней сети и порт, например 192.168.1.20:51234'),
    'pick': (u'לאיזה מכשיר לשלוח?', 'Send to which device?',
           'На какое устройство отправить?'),
    'connecting': (u'מתחבר ל-{host}...', 'Connecting to {host}...',
           'Подключение к {host}...'),
    'code': (u'האם במסך השני מופיע אותו קוד?[CR][CR][B]{code}[/B][CR][CR]מכשיר: {peer}',
             'Does the other screen show the same code?[CR][CR][B]{code}[/B][CR][CR]Device: {peer}',
           'На другом экране тот же код?[CR][CR][B]{code}[/B][CR][CR]Устройство: {peer}'),
    'same': (u'כן, אותו קוד', 'Yes, the same',
           'Да, тот же'),
    'different': (u'לא', 'No',
           'Нет'),
    'waiting_peer_confirm': (u'מחכה לאישור במכשיר השני...', 'Waiting for the other device to confirm...',
           'Ожидание подтверждения на другом устройстве...'),
    'applying': (u'מחיל את ההגדרות: {done} מתוך {total}', 'Applying the setup: {done} of {total}',
                 u'Применение настроек: {done} из {total}'),
    'applying_peer': (u'המכשיר החדש מחיל את ההגדרות: {done} מתוך {total}', 'The new device is applying the setup: {done} of {total}',
                      u'Новое устройство применяет настройки: {done} из {total}'),
    'sending': (u'שולח את ההגדרות...', 'Sending the setup...',
           'Отправка настроек...'),
    'receiving': (u'מקבל את ההגדרות...', 'Receiving the setup...',
           'Получение настроек...'),
    'login_prepare': (u'מכין התחברות לטלגרם...', 'Preparing the Telegram login...',
           'Подготовка входа в Telegram...'),
    'login_wait': (u'מתחבר לטלגרם...', 'Logging in to Telegram...',
           'Вход в Telegram...'),
    'login_approve': (u'מאשר את ההתחברות של המכשיר החדש לטלגרם...', 'Approving the new device\'s Telegram login...',
           'Подтверждение входа нового устройства в Telegram...'),
    'password': (u'סיסמת האימות הדו-שלבי של טלגרם', 'Telegram two-step verification password',
           'Пароль двухэтапной проверки Telegram'),
    'done_send': (u'ההגדרות נשלחו ל-{peer} ({n} ערכים).', 'The setup was sent to {peer} ({n} values).',
           'Настройки отправлены на {peer} ({n} значений).'),
    'done_recv': (u'ההגדרות התקבלו מ-{peer} ({n} ערכים).', 'The setup arrived from {peer} ({n} values).',
           'Настройки получены с {peer} ({n} значений).'),
    'login_ok': (u'טלגרם מחובר במכשיר החדש, עם התחברות משלו.', 'Telegram is logged in on the new device, with a login of its own.',
           'Telegram подключён на новом устройстве, со своим входом.'),
    'login_skipped': (u'טלגרם לא מחובר במכשיר השולח - בלי התחברות לטלגרם.', 'Telegram is not logged in on the sending device - no Telegram login.',
           'Telegram не подключён на отправляющем устройстве - без входа в Telegram.'),
    'login_failed': (u'ההתחברות לטלגרם לא הושלמה ({why}). ההגדרות כן הועברו; אפשר להתחבר בחשבון ומצב.',
                     'The Telegram login did not finish ({why}). The setup did arrive; log in from Account & Status.',
           'Вход в Telegram не завершён ({why}). Настройки переданы; войдите в «Аккаунт и статус».'),
    'failed': (u'ההעברה לא הושלמה: {why}', 'The transfer did not finish: {why}',
           'Передача не завершена: {why}'),
    'why_cancelled': (u'בוטל', 'cancelled',
           'отменено'),
    'why_timeout': (u'לא הגיע מכשיר בזמן', 'no device came in time',
           'устройство не подключилось вовремя'),
    'why_unreachable': (u'המכשיר לא עונה בכתובת הזאת', 'the device does not answer at that address',
           'устройство не отвечает по этому адресу'),
    'why_commitment': (u'זוהה ניסיון התחזות - ההעברה נעצרה', 'an impersonation attempt was detected - stopped',
           'обнаружена попытка подмены - остановлено'),
    'why_tag': (u'המידע שונה בדרך - ההעברה נעצרה', 'the data was changed on the way - stopped',
           'данные изменены по пути - остановлено'),
    'why_version': (u'גרסאות שונות של TeleNova - עדכנו את שני המכשירים', 'different TeleNova versions - update both devices',
           'разные версии TeleNova - обновите оба устройства'),
    'why_closed': (u'החיבור נסגר', 'the connection was closed',
           'соединение закрыто'),
}


def s(key, **kw):
    text = STR[key][{'he': 0, 'en': 1, 'ru': 2}.get(ui_lang(), 1)]
    for k, v in kw.items():
        text = text.replace('{%s}' % k, str(v))
    return text.replace('[CR]', '\n')


def why(reason):
    key = 'why_' + str(reason)
    return s(key) if key in STR else str(reason)


def device_name():
    name = xbmc.getInfoLabel('System.FriendlyName') or ''
    if not name or name.lower() == 'kodi':
        for cond, label in (('System.Platform.Android', 'Android'), ('System.Platform.Windows', 'Windows'),
                            ('System.Platform.IOS', 'iPhone / iPad'), ('System.Platform.OSX', 'Mac'),
                            ('System.Platform.Linux', 'Linux')):
            if xbmc.getCondVisibility(cond):
                name = 'TeleNova %s' % label
                break
    return (name or 'TeleNova')[:60]


# ------------------------------------------------------------------ adapters
class UI(object):
    def __init__(self, title):
        self.title = title
        self.dlg = None
        self._cancel = False
        self.line = ''

    def _open(self):
        if self.dlg is None:
            self.dlg = xbmcgui.DialogProgress()
            self.dlg.create('TeleNova', self.line)

    def close(self):
        if self.dlg is not None:
            try:
                self.dlg.close()
            except Exception:
                pass
            self.dlg = None

    def status(self, key, **kw):
        self.line = s(key, **kw) if key in STR else key
        self._open()
        self.dlg.update(0, self.line)

    def cancelled(self):
        if self.dlg is not None and self.dlg.iscanceled():
            self._cancel = True
        return self._cancel or xbmc.Monitor().abortRequested()

    def confirm_code(self, code, peer):
        self.close()
        pretty = '%s %s' % (code[:3], code[3:])
        return xbmcgui.Dialog().yesno('TeleNova', s('code', code=pretty, peer=peer or '?'),
                                      nolabel=s('different'), yeslabel=s('same'))

    def ask_password(self, hint):
        self.close()
        pw = xbmcgui.Dialog().input(s('password'), option=xbmcgui.ALPHANUM_HIDE_INPUT)
        return pw or None


class Engine(object):
    """the Telegram engine of this device, through its local service"""

    def __init__(self):
        from . import cloudsync
        self.call = cloudsync.engine

    def authorized(self):
        try:
            return bool((self.call('status', 20) or {}).get('authorized'))
        except RuntimeError:
            return False

    def wait_ready(self, seconds, tick=lambda: None):
        """review 16/11: the new API id and hash were written one after the other, and each write restarts the
        engine. Wait until the restarts are over: a few quiet seconds, then two 'connected' answers 3 s apart."""
        end = time.time() + seconds
        mon = xbmc.Monitor()
        if mon.waitForAbort(5):
            return False
        seen = 0
        while time.time() < end and not mon.abortRequested():
            try:
                st = self.call('status', 20) or {}
                seen = seen + 1 if (st.get('connected') and not st.get('error')) else 0
            except RuntimeError:
                seen = 0
            if seen >= 2:
                return True
            tick()
            mon.waitForAbort(3)
        return False

    def qr_token(self):
        """a fresh login token; '' when the engine cannot give one now (it is restarting) - one more try"""
        for attempt in range(2):
            try:
                url = (self.call('qr_start', 60) or {}).get('url') or ''
                if 'token=' in url:
                    return url.split('token=', 1)[-1]
            except RuntimeError as e:
                log('pairing: qr_start: %s' % e)
            if attempt == 0 and not self.wait_ready(30):
                break
        return ''

    def qr_wait(self, seconds):
        try:
            r = self.call('qr_wait', 30) or {}          # the engine waits 4 s by itself
        except RuntimeError as e:
            return str(e)[:80]
        if r.get('ok'):
            return 'ok'
        if r.get('password'):
            return 'password'
        return 'wait'

    def qr_check(self):
        try:
            r = self.call('qr_check', 30) or {}
        except RuntimeError as e:
            return str(e)[:80]
        if r.get('ok'):
            return 'ok'
        if r.get('password'):
            return 'password'
        return 'wait' if not r.get('error') else str(r['error'])

    def sign_in_password(self, pw):
        try:
            r = self.call('sign_in_password', 60, password=pw) or {}
            return 'ok' if r.get('ok') else str(r.get('error') or 'refused')
        except RuntimeError as e:
            return str(e)[:80]

    def accept_token(self, token):
        try:
            r = self.call('qr_accept', 30, token=token) or {}
            return 'ok' if r.get('ok') else str(r.get('error') or 'refused')
        except RuntimeError as e:
            return str(e)[:80]


class Host(object):
    """this device's settings, files, users and lists - the same pieces the continuous sync carries"""

    def __init__(self):
        from . import autosync
        self.a = autosync
        self.h = autosync.KodiHost()

    def export_bundle(self):
        out = {'settings': {}, 'files': {}, 'users': self.h.users(), 'data': {}}
        for aid in self.a.ADDONS:
            st = self.h.settings(aid)
            if st:
                out['settings'][aid] = self.a.syncable(st)
        for name in self.a.FILES:
            obj = self.h.file(name)
            if obj is not None:
                out['files'][name] = obj
        for u in out['users'] or []:
            uid = u.get('id') if isinstance(u, dict) else None
            if uid:
                out['data'][uid] = self.h.user_data(uid)
        return out

    def apply_bundle(self, b, progress=lambda done, total: None):
        from . import syncdoc
        n = 0
        # the Telegram add-on last: its API id / hash restart its engine once, with everything else already in place
        order = sorted((b.get('settings') or {}).items(), key=lambda kv: kv[0] == 'plugin.video.telescope')
        todo = []
        for aid, kv in order:
            if aid not in self.a.ADDONS or not isinstance(kv, dict):
                continue
            have = self.h.settings(aid) or {}
            # live test 17/11: every write wakes the add-ons' services - a value that is already the same is skipped
            todo += [(aid, k, v) for k, v in self.a.syncable(kv).items() if isinstance(v, str) and have.get(k) != v]
        for i, (aid, k, v) in enumerate(todo):
            if self.h.set_setting(aid, k, v):
                n += 1
            progress(i + 1, len(todo))
        for name, obj in (b.get('files') or {}).items():
            if name in self.a.FILES:
                self.h.put_file(name, obj)
                n += 1
        if b.get('users'):
            self.h.set_users(syncdoc.merge_users(self.h.users(), b['users']))
        for uid, data in (b.get('data') or {}).items():
            if isinstance(data, dict):
                self.h.put_user_data(uid, syncdoc.merge_user_data(self.h.user_data(uid), data))
                n += 1
        xbmcgui.Window(10000).setProperty('bn.sync.now', '1')      # the continuous sync takes over from here
        return n


# ------------------------------------------------------------------ the two entries
def _report(res, sending):
    d = xbmcgui.Dialog()
    if not res.get('ok'):
        d.ok('TeleNova', s('failed', why=why(res.get('reason'))))
        return
    lines = [s('done_send' if sending else 'done_recv', peer=res.get('peer') or '?', n=res.get('applied', 0))]
    login = res.get('login') or 'skipped'
    lines.append(s('login_ok') if login == 'ok' else s('login_skipped') if login == 'skipped'
                 else s('login_failed', why=login.replace('failed: ', '')))
    d.ok('TeleNova', '\n'.join(lines))


def receive():
    ui = UI(s('receive'))
    try:
        res = pairflow.run_receiver(ui, Engine(), Host(), device_name())
    except Exception as e:                       # never leave a progress dialog behind
        log('pairing receive: %r' % e, xbmc.LOGWARNING)
        res = {'ok': False, 'reason': type(e).__name__}
    finally:
        ui.close()
    log('pairing receive: %s' % dict((k, v) for k, v in res.items() if k != 'peer'))
    _report(res, False)


def _choose_target(ui):
    ui.status('searching')
    found = pairing.listen_beacons(8, stop=lambda f: ui.cancelled())
    ui.close()
    if ui.cancelled():
        return None
    d = xbmcgui.Dialog()
    rows = ['%s  [COLOR grey]%s[/COLOR]' % (f['name'], f['host']) for f in found] + [s('type_address')]
    if found:
        i = d.select(s('pick'), rows)
        if i < 0:
            return None
        if i < len(found):
            return (found[i]['host'], found[i]['port'])
    else:
        d.ok('TeleNova', s('none_found'))
    while True:
        text = d.input(s('type_address'))
        if not text:
            return None
        target = pairing.parse_address(text)
        if target:
            return target
        d.ok('TeleNova', s('bad_address'))


def send():
    ui = UI(s('send'))
    try:
        target = _choose_target(ui)
        if not target:
            return
        res = pairflow.run_sender(ui, Engine(), Host(), device_name(), target)
    except Exception as e:
        log('pairing send: %r' % e, xbmc.LOGWARNING)
        res = {'ok': False, 'reason': type(e).__name__}
    finally:
        ui.close()
    log('pairing send: %s' % dict((k, v) for k, v in res.items() if k != 'peer'))
    _report(res, True)
