# -*- coding: utf-8 -*-
"""4.1.0: users. Every user of the house has their own history, favourites and search history; the logins to the
services and the settings belong to the household and are shared.

The active user's files are the ordinary ones in the add-on's data folder (nothing else in the hub had to change);
the files of the other users wait in users/<id>/. Switching saves the active user's files there and brings the
other user's in. The list of users travels with the continuous sync (autosync.py), which user is active is a
choice of each device.

store_* functions take the folder as a parameter and are tested without Kodi (qa/t_users.py)."""
import json
import os
import re
import shutil
import time
import uuid

FILES = ('history.json', 'favourites.json', 'favourites_removed.json', 'search_history.json', 'user_marks.json')
LIST = 'users.json'               # shared (part of a backup and of the sync document)
STATE = 'sync_state.json'         # this device only: which user is active here
FIRST = 'u1'


def _read(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _replace(tmp, path):
    """os.replace with a short retry: on Windows another reader of the file makes it fail for a moment"""
    for attempt in range(5):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.04)


def _drop(tmp):
    try:
        if os.path.exists(tmp):
            os.remove(tmp)
    except OSError:
        pass


def _write(path, data):
    """6.5.1: a failed write (full storage, a locked file) leaves no temp file behind - the name is random, so
    every retry of the sync loop used to add one more"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = '%s.%s.tmp' % (path, uuid.uuid4().hex[:6])
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.flush()
            os.fsync(f.fileno())
        _replace(tmp, path)
    finally:
        _drop(tmp)


def _copy_atomic(src, dst):
    """6.5.1: a copy that is either whole or not there (copyfile empties the target first)"""
    tmp = '%s.%s.tmp' % (dst, uuid.uuid4().hex[:6])
    try:
        with open(src, 'rb') as a, open(tmp, 'wb') as b:
            shutil.copyfileobj(a, b)
            b.flush()
            os.fsync(b.fileno())
        _replace(tmp, dst)
    finally:
        _drop(tmp)


def _bring(src_dir, root):
    """a user's files become the live ones (a file the user does not have = no live file). Safe to repeat."""
    for name in FILES:
        src, dst = os.path.join(src_dir, name), os.path.join(root, name)
        if os.path.exists(src):
            _copy_atomic(src, dst)
        elif os.path.exists(dst):
            os.remove(dst)
        if os.path.exists(dst + '.bak'):     # the "last good copy" of the other user must not come back
            os.remove(dst + '.bak')


def clock(root):
    """6.3.0 (L1): now, on the account's clock (the offset the sync learned on this device, autosync.skew_of)"""
    m = _read(os.path.join(root, 'sync_meta.json'), {})
    s = m.get('skew') if isinstance(m, dict) else None
    ok = isinstance(s, (int, float)) and not isinstance(s, bool) and abs(s) <= 7 * 86400
    return time.time() + (s if ok else 0)


def history_ts(root, now=None):
    """6.5.1: the time of a new history entry - the account's clock, and always later than the last "clear history"
    mark (the web's rule; the sync drops entries that are not later than the mark)"""
    ts = now if now is not None else clock(root)
    m = _read(os.path.join(root, 'user_marks.json'), {})
    c = m.get('history_cleared') if isinstance(m, dict) else None
    c = c if isinstance(c, (int, float)) and not isinstance(c, bool) else 0
    return c + 1 if ts <= c else ts


def clean_name(name):
    return re.sub(r'\s+', ' ', (name or '').strip())[:30]


# ------------------------------------------------------------------ the store (pure: a folder in, files out)
def store_users(root):
    """every user ever known here, deleted ones included (the sync needs their tombstones)"""
    users = _read(os.path.join(root, LIST), None)
    if not isinstance(users, list) or not users:
        users = [{'id': FIRST, 'name': '', 'created': 1, 'renamed': 0, 'deleted': 0}]
    return users


def store_live(root):
    return [u for u in store_users(root) if not u.get('deleted')]


def store_current(root):
    cur = (_read(os.path.join(root, STATE), {}) or {}).get('user')
    ids = [u['id'] for u in store_live(root)]
    return cur if cur in ids else (ids[0] if ids else FIRST)


def _set_current(root, uid):
    st = _read(os.path.join(root, STATE), {}) or {}
    st['user'] = uid
    st.pop('switching', None)
    st.pop('since', None)
    _write(os.path.join(root, STATE), st)


def user_dir(root, uid):
    if not re.match(r'^[A-Za-z0-9]{1,16}$', uid or ''):
        raise ValueError('bad user id')
    return os.path.join(root, 'users', uid)


def store_create(root, name, now=None):
    name = clean_name(name)
    if not name:
        raise ValueError('empty name')
    users = store_users(root)
    if any(not u.get('deleted') and (u.get('name') or '').lower() == name.lower() for u in users):
        raise ValueError('name exists')
    now = int(now if now is not None else clock(root))
    uid = 'u' + uuid.uuid4().hex[:8]
    users.append({'id': uid, 'name': name, 'created': now, 'renamed': now, 'deleted': 0})
    _write(os.path.join(root, LIST), users)
    return uid


def store_rename(root, uid, name, now=None):
    name = clean_name(name)
    if not name:
        raise ValueError('empty name')
    users = store_users(root)
    # 6.5.1: the same rule as a new user (another live user's name, in any case, is refused); the user's own name
    # in another case is fine
    if any(u['id'] != uid and not u.get('deleted') and (u.get('name') or '').lower() == name.lower() for u in users):
        raise ValueError('name exists')
    for u in users:
        if u['id'] == uid:
            u['name'], u['renamed'] = name, int(now if now is not None else clock(root))
    _write(os.path.join(root, LIST), users)


def store_delete(root, uid, now=None):
    """the user is marked deleted (the mark reaches the other devices) and their files here are removed"""
    live = store_live(root)
    if len(live) <= 1 or uid == store_current(root):
        raise ValueError('cannot delete the only / the active user')
    if uid == store_switching(root):
        raise ValueError('cannot delete the user a switch is moving to')
    users = store_users(root)
    for u in users:
        if u['id'] == uid:
            u['deleted'] = int(now if now is not None else clock(root))
    _write(os.path.join(root, LIST), users)
    shutil.rmtree(os.path.join(root, 'users', uid), ignore_errors=True)


def _mark_switch(root, cur, uid):
    st = _read(os.path.join(root, STATE), {}) or {}
    st.update({'user': cur, 'switching': uid, 'since': int(time.time())})
    _write(os.path.join(root, STATE), st)


def store_switching(root):
    """the user an unfinished switch is moving to, or None"""
    st = _read(os.path.join(root, STATE), {})
    uid = st.get('switching') if isinstance(st, dict) else None
    return uid if isinstance(uid, str) and re.match(r'^[A-Za-z0-9]{1,16}$', uid) else None


def store_switch_age(root, now=None):
    """seconds since the unfinished switch began (None when there is none)"""
    st = _read(os.path.join(root, STATE), {})
    if not isinstance(st, dict) or 'switching' not in st:
        return None
    since = st.get('since')
    ok = isinstance(since, (int, float)) and not isinstance(since, bool)
    return max(0, (now if now is not None else time.time()) - since) if ok else 10 ** 9


def store_recover(root):
    """finishes a switch that was cut in the middle (full storage, Kodi killed, power cut). The old user's folder
    was complete before the mark was written, so the switch is rolled forward; when its target is gone the old
    user's files come back. -> True when something was finished"""
    st = _read(os.path.join(root, STATE), {})
    if not isinstance(st, dict) or 'switching' not in st:
        return False
    target = store_switching(root)
    live = [u['id'] for u in store_live(root)]
    if target and target in live:
        _bring(user_dir(root, target), root)
        _set_current(root, target)
        return True
    cur = store_current(root)
    back = os.path.join(root, 'users', cur)
    if os.path.isdir(back):
        _bring(back, root)
    _set_current(root, cur)
    return True


def store_switch(root, uid):
    """the active user's files go to their folder, the other user's files come in. -> False when nothing changed.
    6.5.1: in steps that can be finished later - every copy is whole or absent, and a mark in sync_state.json says
    a switch is under way, so a failure in the middle never leaves one user's lists under the other's name"""
    store_recover(root)
    cur = store_current(root)
    if uid == cur or uid not in [u['id'] for u in store_live(root)]:
        return False
    out, inn = user_dir(root, cur), user_dir(root, uid)
    os.makedirs(out, exist_ok=True)
    for name in FILES:                       # 1. keep the active user's files (a failure here changes nothing live)
        src = os.path.join(root, name)
        if os.path.exists(src):
            _copy_atomic(src, os.path.join(out, name))
        elif os.path.exists(os.path.join(out, name)):
            os.remove(os.path.join(out, name))
    _mark_switch(root, cur, uid)             # 2. the mark
    _bring(inn, root)                        # 3. the other user's files come in (nothing yet = no file)
    _set_current(root, uid)                  # 4. done: the mark is removed
    return True


def store_sweep(root, max_age=600, now=None):
    """removes temp files an interrupted write of THIS module left behind (name.<6 hex>.tmp of our own files,
    older than max_age) in the profile and in users/<id>/. Other modules' .tmp files are not touched. -> count"""
    names = '|'.join(re.escape(n) for n in FILES + (LIST, STATE))
    pat = re.compile(r'^(?:%s)\.[0-9a-f]{6}\.tmp$' % names)
    now = now if now is not None else time.time()
    dirs = [root]
    try:
        for d in os.listdir(os.path.join(root, 'users')):
            if re.match(r'^[A-Za-z0-9]{1,16}$', d) and os.path.isdir(os.path.join(root, 'users', d)):
                dirs.append(os.path.join(root, 'users', d))
    except OSError:
        pass
    n = 0
    for d in dirs:
        try:
            files = os.listdir(d)
        except OSError:
            continue
        for f in files:
            if not pat.match(f):
                continue
            p = os.path.join(d, f)
            try:
                if now - os.path.getmtime(p) > max_age:
                    os.remove(p)
                    n += 1
            except OSError:
                pass
    return n


def store_data(root, uid):
    """one user's content as the sync document holds it"""
    base = root if uid == store_current(root) else user_dir(root, uid)
    g = lambda name, default: _read(os.path.join(base, name), default)
    hist, favs, rem, srch = g('history.json', []), g('favourites.json', []), g('favourites_removed.json', []), g('search_history.json', [])
    return {'history': hist if isinstance(hist, list) else [], 'favourites': favs if isinstance(favs, list) else [],
            'removed': rem if isinstance(rem, list) else [], 'searches': srch if isinstance(srch, list) else [],
            'marks': g('user_marks.json', {}) or {}}


def store_put(root, uid, data):
    """writes a user's merged content; only files whose content really differs are touched. -> names written"""
    base = root if uid == store_current(root) else user_dir(root, uid)
    wrote = []
    for name, key, default in (('history.json', 'history', []), ('favourites.json', 'favourites', []),
                               ('favourites_removed.json', 'removed', []), ('search_history.json', 'searches', []),
                               ('user_marks.json', 'marks', {})):
        new = data.get(key, default)
        path = os.path.join(base, name)
        old = _read(path, None)
        if old is None and not new:
            continue
        if json.dumps(old, sort_keys=True) != json.dumps(new, sort_keys=True):
            _write(path, new)
            wrote.append(name)
    return wrote


def store_set_users(root, users):
    """the merged list from the sync; a user deleted elsewhere loses their folder here; when the active user was
    deleted on another device this device moves to the first user that is left. -> True when the list changed"""
    old = store_users(root)
    if json.dumps(old, sort_keys=True) == json.dumps(users, sort_keys=True):
        return False
    cur = store_current(root)
    _write(os.path.join(root, LIST), users)
    live = [u['id'] for u in users if not u.get('deleted')]
    for u in users:
        if u.get('deleted') and u['id'] != cur:
            shutil.rmtree(os.path.join(root, 'users', u['id']), ignore_errors=True)
    if cur not in live and live:
        _mark_switch(root, cur, live[0])                 # 6.5.1: the same steps as a switch, finished later if cut
        _bring(os.path.join(root, 'users', live[0]), root)
        _set_current(root, live[0])
    return True


def mark(root, key, value=None, now=None):
    """remembers a clearing so that it reaches the other devices: 'history_cleared' / 'searches_cleared', or
    'searches_removed' with the text"""
    path = os.path.join(root, 'user_marks.json')
    m = _read(path, {}) or {}
    now = int(now if now is not None else clock(root))
    if key == 'searches_removed':
        m.setdefault('searches_removed', {})[(value or '').strip().lower()] = now
    else:
        m[key] = now
    _write(path, m)


# ------------------------------------------------------------------ Kodi
STR = {
    'title': ('משתמשים', 'Users', 'Пользователи'),
    'main': ('ראשי', 'Main', 'Основной'),
    'active': ('פעיל', 'active', 'активен'),
    'new': ('משתמש חדש', 'New user', 'Новый пользователь'),
    'name': ('שם המשתמש', 'User name', 'Имя пользователя'),
    'switch': ('עבור למשתמש הזה', 'Switch to this user', 'Переключиться'),
    'rename': ('שנה שם', 'Rename', 'Переименовать'),
    'delete': ('מחק משתמש', 'Delete user', 'Удалить пользователя'),
    'delete_q': ('למחוק את המשתמש "%s"? ההיסטוריה, המועדפים והחיפושים שלו יימחקו מכל המכשירים.',
                 'Delete the user "%s"? Their history, favourites and searches are removed from every device.',
                 'Удалить пользователя «%s»? Его история, избранное и поиски будут удалены со всех устройств.'),
    'exists': ('כבר יש משתמש בשם הזה', 'A user with this name exists', 'Пользователь с таким именем уже есть'),
    'switch_fail': ('ההחלפה לא הושלמה - נסה שוב', 'The switch was not completed - try again',
                    'Переключение не завершено - повторите'),
    'now': ('המשתמש הפעיל: %s', 'Active user: %s', 'Активный пользователь: %s'),
    'about': ('לכל משתמש היסטוריה, מועדפים והיסטוריית חיפושים משלו. החיבורים לשירותים וההגדרות משותפים לכולם. '
              'הכול מסתנכרן לבד בין כל המכשירים שמחוברים לאותו חשבון טלגרם.',
              'Every user has their own history, favourites and search history. Service logins and settings are '
              'shared. Everything syncs by itself between all devices logged in to the same Telegram account.',
              'У каждого пользователя своя история, избранное и история поиска. Входы в сервисы и настройки общие. '
              'Всё синхронизируется само между устройствами с одним аккаунтом Telegram.'),
}


def s(key):
    from .common import ui_lang
    return STR[key][{'he': 0, 'en': 1, 'ru': 2}[ui_lang()]]


def _root():
    from .common import PROFILE
    return PROFILE


def display(u):
    return u.get('name') or s('main')


def current_name():
    root = _root()
    cur = store_current(root)
    return next((display(u) for u in store_live(root) if u['id'] == cur), s('main'))


def menu(handle, url):
    import xbmcgui
    import xbmcplugin
    root = _root()
    cur = store_current(root)
    for u in store_live(root):
        on = u['id'] == cur
        li = xbmcgui.ListItem(u'%s%s' % (display(u), u'   [COLOR limegreen]● %s[/COLOR]' % s('active') if on else ''))
        li.getVideoInfoTag().setPlot(s('about'))
        li.setArt({'icon': 'DefaultUser.png'})
        xbmcplugin.addDirectoryItem(handle, url(a='user_do', id=u['id']), li, False)
    from .common import gold_item
    li = gold_item('+ %s' % s('new'))
    li.getVideoInfoTag().setPlot(s('about'))
    li.setArt({'icon': 'DefaultAddSource.png'})
    xbmcplugin.addDirectoryItem(handle, url(a='user_do', id='new'), li, False)
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)


def _wake_sync():
    import xbmcgui
    xbmcgui.Window(10000).setProperty('bn.sync.now', '1')      # the sync loop looks at once instead of in a minute


def action(uid):
    import xbmc
    import xbmcgui
    root = _root()
    d = xbmcgui.Dialog()
    try:                                    # 6.5.1: a switch that was cut earlier is finished first
        store_recover(root)
    except OSError as e:
        xbmc.log('[NovaTV] users: recover: %s' % e, xbmc.LOGWARNING)

    def switch(to, shown):
        try:
            store_switch(root, to)
        except OSError as e:
            xbmc.log('[NovaTV] users: switch failed: %s' % e, xbmc.LOGWARNING)
            d.notification('TeleNova', s('switch_fail'), xbmcgui.NOTIFICATION_WARNING, 5000)
            return
        d.notification('TeleNova', s('now') % shown, xbmcgui.NOTIFICATION_INFO, 3500)
    if uid == 'new':
        name = clean_name(d.input(s('name')))
        if not name:
            return
        try:
            new = store_create(root, name)
        except ValueError:
            return d.ok('TeleNova', s('exists'))
        switch(new, name)
    else:
        user = next((u for u in store_live(root) if u['id'] == uid), None)
        if not user:
            return
        cur = store_current(root)
        opts = ([] if uid == cur else [('switch', s('switch'))]) + [('rename', s('rename'))]
        if uid != cur and len(store_live(root)) > 1:
            opts.append(('delete', s('delete')))
        i = d.select(display(user), [o[1] for o in opts])
        if i < 0:
            return
        what = opts[i][0]
        if what == 'switch':
            switch(uid, display(user))
        elif what == 'rename':
            name = clean_name(d.input(s('name'), user.get('name') or ''))
            if name:
                try:
                    store_rename(root, uid, name)
                except ValueError:
                    return d.ok('TeleNova', s('exists'))
        elif what == 'delete' and d.yesno('TeleNova', s('delete_q') % display(user)):
            store_delete(root, uid)
    _wake_sync()
    xbmc.executebuiltin('Container.Refresh')
