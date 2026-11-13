# -*- coding: utf-8 -*-
"""4.0.4: the setup follows the Telegram account.

Every device that runs the build and is logged in to the same Telegram account shares one copy of the setup: keys,
service logins (Real-Debrid ...), choices, IPTV lists, favourites, history. The copy is a sealed file in the
account's own "Saved Messages" (written and read by the Telegram engine, see its service._cloud) - no USB stick, no
other cloud account. One file per device; the newest one wins.

What a device does:
  * after a change of its settings it uploads its copy (at most every 10 minutes),
  * at start it looks for a newer copy of another device; if its content differs from what this device has, the
    viewer is asked once whether to take it (a restore closes Kodi),
  * a new device: log in to Telegram, answer "yes" - everything else is back.
The Telegram login itself is never in the copy (a device reads it only after its own login).
Pure logic (decide, fingerprint_of) is separate from the Kodi parts and tested in qa/t_cloudsync.py."""
import hashlib
import json
import os
import re
import time

STATE = 'sync_state.json'        # this device only: never part of a backup
FLAGS = 'services.json'          # choices: carried by a backup ('sync_on')
MIN_GAP = 600                    # seconds between two uploads
# values that change by themselves or belong to one device: not part of "did the setup change?"
VOLATILE = re.compile(r'^(rd_token|rd_refresh|deps_zip|wizard_shown|lite_done|depov_done|wizard_fix|tune_done|'
                      r'debug|port|sub_server|last_\w+|\w+_done|\w+_ts|\w+_time)$')


# ------------------------------------------------------------------ pure logic
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


def fingerprint_of(parts):
    """parts: {name: text or dict} -> short hash that is the same on two devices holding the same setup"""
    h = hashlib.sha256()
    for name in sorted(parts):
        val = parts[name]
        if isinstance(val, dict):
            val = dict((k, v) for k, v in val.items() if not VOLATILE.match(k))
        h.update(name.encode('utf-8') + b'\0' + json.dumps(val, sort_keys=True, ensure_ascii=False).encode('utf-8') + b'\0')
    return h.hexdigest()[:20]


def decide(state, items, local_fp, now=None):
    """What to do with the copies found in the account.
    state: this device's sync_state; items: [{'id','date','note':{'device','name','fp'}}] newest first.
    -> ('none', None) | ('same', item) nothing to take, remember it | ('offer', item) ask the viewer"""
    mine = state.get('device')
    for it in items:
        note = it.get('note') or {}
        if note.get('device') == mine:
            continue
        if it['date'] <= max(state.get('applied', 0), state.get('declined', 0)):
            return 'none', None
        if note.get('fp') and note['fp'] == local_fp:
            return 'same', it
        if it['date'] <= state.get('pushed', 0) and state.get('pushed_fp') == local_fp:
            return 'none', None            # this device uploaded a newer setup afterwards
        return 'offer', it
    return 'none', None


def should_push(state, local_fp, now):
    if not local_fp or local_fp == state.get('pushed_fp') or local_fp == state.get('applied_fp'):
        return False
    return now - state.get('pushed', 0) >= MIN_GAP


# ------------------------------------------------------------------ Kodi side
def _load(name, default):
    from .common import load
    return load(name, default)


def _save(name, data):
    from .common import save
    save(name, data)


def state():
    st = _load(STATE, {})
    if not st.get('device'):
        import uuid
        import xbmc
        st['device'] = uuid.uuid4().hex[:10]
        st['name'] = (xbmc.getInfoLabel('System.FriendlyName') or 'Kodi')[:40]
        _save(STATE, st)
    return st


def is_on():
    return bool(_load(FLAGS, {}).get('sync_on'))


def set_on(on):
    f = _load(FLAGS, {})
    f['sync_on'] = bool(on)
    _save(FLAGS, f)


def fingerprint():
    import xbmcvfs
    base = xbmcvfs.translatePath('special://profile/addon_data/')
    parts = {}
    for aid in ('plugin.video.nova', 'plugin.video.telescope', 'service.subtitles.All_Subs'):
        try:
            with open(os.path.join(base, aid, 'settings.xml'), encoding='utf-8') as f:
                parts[aid] = settings_map(f.read())
        except (OSError, UnicodeDecodeError):
            parts[aid] = {}
    for name in ('iptv.json', 'providers.json', FLAGS, 'favourites.json'):
        parts[name] = _load(name, None)
    try:
        with open(os.path.join(base, 'plugin.video.telescope', 'bots.json'), encoding='utf-8') as f:
            parts['bots'] = (json.load(f) or {}).get('cfg')
    except (OSError, ValueError):
        parts['bots'] = None
    return fingerprint_of(parts)


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


def push(force=False):
    """-> (ok, text). Uploads this device's setup when it changed (or always with force)."""
    import base64
    import xbmc
    import xbmcvfs
    from . import backup
    st = state()
    fp = fingerprint()
    if not force and not should_push(st, fp, time.time()):
        return True, 'unchanged'
    tmp = os.path.join(xbmcvfs.translatePath('special://temp/'), 'tn_sync_up.zip')
    try:
        n = backup.make_zip(tmp, sync=True)
        with open(tmp, 'rb') as f:
            data = f.read()
    finally:
        for p in (tmp, tmp + '.part'):
            try:
                os.remove(p)
            except OSError:
                pass
    build = ''
    try:
        with open(xbmcvfs.translatePath('special://profile/novatv_build.txt'), encoding='utf-8') as f:
            build = f.read().strip().replace('TeleNova ', '')
    except OSError:
        pass
    try:
        res = engine('cloud_put', 200, data=base64.b64encode(data).decode('ascii'), device=st['device'],
                     name=st.get('name', ''), build=build, fp=fp)
    except RuntimeError as e:
        xbmc.log('[NovaTV] setup sync: upload failed: %s' % e, xbmc.LOGWARNING)
        return False, str(e)
    st.update(pushed=int(res.get('date') or time.time()), pushed_fp=fp)
    _save(STATE, st)
    xbmc.log('[NovaTV] setup sync: uploaded %d files, %d KB' % (n, len(data) // 1024), xbmc.LOGINFO)
    return True, '%d KB' % (len(data) // 1024)


def copies():
    return engine('cloud_list', 60) or []


def take(item, ask=True):
    """restores the copy `item` (closes Kodi at the end, like every restore). -> False when not done"""
    import base64
    import zipfile
    import xbmc
    import xbmcgui
    import xbmcvfs
    from . import backup
    d = xbmcgui.Dialog()
    note = item.get('note') or {}
    when = time.strftime('%d/%m/%Y %H:%M', time.localtime(item.get('date') or 0))
    if ask and not d.yesno('TeleNova', s('take_q') % (note.get('name') or '?', when)):
        st = state()
        st['declined'] = item.get('date') or int(time.time())
        _save(STATE, st)
        return False
    busy = xbmcgui.DialogProgressBG()
    busy.create('TeleNova', s('taking'))
    tmp = os.path.join(xbmcvfs.translatePath('special://temp/'), 'tn_sync_down.zip')
    win = xbmcgui.Window(10000)
    try:
        data = base64.b64decode(engine('cloud_get', 200, id=item['id'])['data'])
        with open(tmp, 'wb') as f:
            f.write(data)
        with zipfile.ZipFile(tmp) as z:
            if 'bn_backup.txt' not in z.namelist():
                raise RuntimeError('damaged')
            win.setProperty('NovaTV.restoring', '1')
            done, _ = backup.extract(z)
    except Exception as e:
        win.clearProperty('NovaTV.restoring')
        busy.close()
        xbmc.log('[NovaTV] setup sync: restore failed: %s' % e, xbmc.LOGWARNING)
        d.ok('TeleNova', '%s\n%s' % (s('take_fail'), str(e)[:150]))
        return False
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    busy.close()
    st = state()
    st.update(applied=item.get('date') or int(time.time()), applied_fp=note.get('fp') or fingerprint())
    _save(STATE, st)
    f = _load(FLAGS, {})
    f['sync_on'] = True                      # a device that took the shared setup keeps following it
    _save(FLAGS, f)
    xbmc.log('[NovaTV] setup sync: restored %d files from %s' % (done, note.get('name')), xbmc.LOGINFO)
    d.ok('TeleNova', s('taken'))
    os._exit(1)      # like backup.restore_zip: Kodi must not write its old settings over the restored ones


def check_start():
    """service, a while after start: look once for a newer setup of another device"""
    import xbmc
    st = state()
    on = is_on()
    if not on and st.get('asked'):
        return
    if not account_ready():
        return
    try:
        items = copies()
    except RuntimeError as e:
        xbmc.log('[NovaTV] setup sync: %s' % e, xbmc.LOGWARNING)
        return
    if not on:                        # a device that never used the sync: one offer, when a copy exists
        st['asked'] = int(time.time())
        _save(STATE, st)
    act, item = decide(st, items, fingerprint())
    if act == 'same':
        st.update(applied=item['date'], applied_fp=(item.get('note') or {}).get('fp'))
        _save(STATE, st)
    elif act == 'offer' and not xbmc.getCondVisibility('Player.HasMedia'):
        take(item)


def tick():
    """service, every few minutes"""
    import xbmc
    if is_on() and not xbmc.getCondVisibility('Player.HasMedia') and account_ready():
        push()


# ------------------------------------------------------------------ menu
STR = {
    'title': ('גיבוי שמסתנכרן בין המכשירים', 'Setup that follows your devices', 'Настройки, общие для устройств'),
    'on': ('סנכרון אוטומטי: פעיל', 'Automatic sync: on', 'Автосинхронизация: включена'),
    'off': ('סנכרון אוטומטי: כבוי', 'Automatic sync: off', 'Автосинхронизация: выключена'),
    'need_tg': ('נדרשת כניסה לחשבון טלגרם - הגיבוי נשמר ב"הודעות שמורות" של החשבון',
                'A Telegram login is needed - the copy is kept in the account\'s "Saved Messages"',
                'Нужен вход в Telegram - копия хранится в «Избранном» аккаунта'),
    'push': ('שמור עכשיו את ההגדרות של המכשיר הזה', 'Save this device\'s setup now', 'Сохранить настройки этого устройства'),
    'pull': ('שחזר הגדרות ממכשיר אחר', 'Restore the setup of another device', 'Восстановить настройки другого устройства'),
    'none': ('אין עדיין גיבוי בחשבון', 'No copy in the account yet', 'В аккаунте пока нет копии'),
    'pushed': ('ההגדרות נשמרו בחשבון', 'The setup was saved to the account', 'Настройки сохранены в аккаунте'),
    'push_fail': ('השמירה נכשלה', 'Saving failed', 'Не удалось сохранить'),
    'take_q': ('נמצאו הגדרות חדשות יותר מהמכשיר "%s" (%s).\nלשחזר אותן כאן? Kodi ייסגר בסיום - פתחו אותו שוב.',
               'A newer setup from the device "%s" (%s) was found.\nRestore it here? Kodi closes at the end - open it again.',
               'Найдены более новые настройки с устройства «%s» (%s).\nВосстановить здесь? Kodi закроется - откройте его снова.'),
    'taking': ('משחזר הגדרות...', 'Restoring the setup...', 'Восстановление настроек...'),
    'take_fail': ('השחזור נכשל', 'The restore failed', 'Не удалось восстановить'),
    'taken': ('ההגדרות שוחזרו. Kodi ייסגר עכשיו - פתחו אותו שוב.', 'The setup was restored. Kodi closes now - open it again.',
              'Настройки восстановлены. Kodi закроется - откройте его снова.'),
    'this': ('המכשיר הזה', 'this device', 'это устройство'),
    'explain': ('ההגדרות, המפתחות והחיבורים לשירותים נשמרים כקובץ חתום ב"הודעות שמורות" של חשבון הטלגרם שלך. כל מכשיר '
                'עם הבילד שמחובר לאותו חשבון מקבל אותם. הכניסה לטלגרם עצמה לא נשמרת בקובץ.',
                'Settings, keys and service logins are kept as a sealed file in your Telegram account\'s "Saved Messages". '
                'Every device with the build that is logged in to the same account receives them. The Telegram login '
                'itself is not in the file.',
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
    if not account_ready():
        return 'login', s('need_tg')
    st = state()
    last = max(st.get('pushed', 0), st.get('applied', 0))
    when = time.strftime('%d/%m %H:%M', time.localtime(last)) if last else ''
    return ('on' if is_on() else 'off'), when


def menu():
    import xbmc
    import xbmcgui
    from . import backup
    d = xbmcgui.Dialog()
    while True:
        ready = account_ready()
        rows = [s('on') if is_on() else s('off'), s('push'), s('pull'), s('file_out'), s('file_in')]
        i = d.select(s('title'), rows)
        if i < 0:
            return
        if i in (0, 1, 2) and not ready:
            d.ok('TeleNova', s('need_tg'))
            continue
        if i == 0:
            if not is_on():
                d.ok('TeleNova', s('explain'))
                set_on(True)
                ok, text = push(force=True)
                d.notification('TeleNova', s('pushed') if ok else '%s: %s' % (s('push_fail'), text[:60]),
                               xbmcgui.NOTIFICATION_INFO if ok else xbmcgui.NOTIFICATION_WARNING, 5000)
            else:
                set_on(False)
        elif i == 1:
            ok, text = push(force=True)
            d.ok('TeleNova', s('pushed') + ' (%s)' % text if ok else '%s\n%s' % (s('push_fail'), text[:150]))
        elif i == 2:
            try:
                items = copies()
            except RuntimeError as e:
                d.ok('TeleNova', str(e)[:200])
                continue
            if not items:
                d.ok('TeleNova', s('none'))
                continue
            mine = state()['device']
            labels = ['%s  ·  %s%s' % ((it['note'].get('name') or '?'), time.strftime('%d/%m/%Y %H:%M', time.localtime(it['date'])),
                                      ('  (%s)' % s('this')) if it['note'].get('device') == mine else '') for it in items]
            j = d.select(s('pull'), labels)
            if j >= 0:
                take(items[j])
        elif i == 3:
            backup.backup()
        elif i == 4:
            backup.restore()
    xbmc.executebuiltin('Container.Refresh')
