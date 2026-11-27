# -*- coding: utf-8 -*-
"""6.5.1: the user store without Kodi - writes that leave no temp file, a switch that can be finished later, the
rename rule, the sweep of stray temp files, and new history / search entries against the clear marks."""
import glob
import importlib
import io
import json
import os
import shutil
import sys
import tempfile
import time
import types

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
NOVA = os.path.join(HERE, '..', 'plugin.video.nova')
TMP = tempfile.mkdtemp(prefix='tn_users_')
for name in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules[name] = types.ModuleType(name)
x = sys.modules['xbmc']
x.LOGINFO, x.LOGWARNING, x.LOGERROR, x.LOGDEBUG, x.ISO_639_1 = 1, 2, 3, 0, 0
x.log = lambda *a, **k: None
x.getLanguage = lambda *a, **k: 'en'
x.getInfoLabel = lambda *a: ''
x.getCondVisibility = lambda *a: False
x.Monitor = type('Monitor', (), {'abortRequested': lambda s: False, 'waitForAbort': lambda s, t=0: False})
sys.modules['xbmcaddon'].Addon = lambda *a: types.SimpleNamespace(
    getAddonInfo=lambda k: {'profile': os.path.join(TMP, 'kodi'), 'path': NOVA}.get(k, ''), getSetting=lambda k: '', setSetting=lambda k, v: None)
sys.modules['xbmcvfs'].translatePath = lambda p: p
sys.path.insert(0, NOVA)
users = importlib.import_module('resources.lib.users')
searchhist = importlib.import_module('resources.lib.searchhist')
syncdoc = importlib.import_module('resources.lib.syncdoc')
autosync = importlib.import_module('resources.lib.autosync')
bad = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        bad.append(what)


def raises(exc, fn, *a, **k):
    try:
        fn(*a, **k)
    except exc as e:
        return e
    return None


def root(name):
    p = os.path.join(TMP, name)
    os.makedirs(p)
    return p


def put(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f)


def get(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def tmps(r):
    return glob.glob(os.path.join(r, '**', '*.tmp'), recursive=True)


# ------------------------------------------------------------------ _write: no temp file after a failure
r = root('w')
p = os.path.join(r, 'history.json')
users._write(p, [1])
real_dump, real_replace = users.json.dump, os.replace
try:
    def boom(*a, **k):
        raise OSError(28, 'No space left on device')
    users.json.dump = boom
    check(raises(OSError, users._write, p, [2]) is not None, 'write: a failed dump raises')
    users.json.dump = real_dump
    check(not tmps(r) and get(p) == [1], 'write: no temp file, the old content stays')
    calls = []

    def locked(a, b):
        calls.append(1)
        raise PermissionError(13, 'locked')
    os.replace = locked
    check(isinstance(raises(OSError, users._write, p, [3]), PermissionError) and len(calls) == 5, 'write: 5 tries, then the error')
    os.replace = real_replace
    check(not tmps(r) and get(p) == [1], 'write: no temp file after a locked target')
    calls = []

    def twice(a, b):
        calls.append(1)
        if len(calls) < 3:
            raise PermissionError(13, 'locked')
        return real_replace(a, b)
    os.replace = twice
    users._write(p, [4])
    os.replace = real_replace
    check(get(p) == [4] and not tmps(r), 'write: succeeds on the third try')
finally:
    users.json.dump, os.replace = real_dump, real_replace

# ------------------------------------------------------------------ sweep
r = root('s')
old = time.time() - 3600
for rel, age in (('history.json.abc123.tmp', old), ('users/u2/history.json.0f0f0f.tmp', old), ('users.json.aaaaaa.tmp', old),
                 ('favourites.json.bbbbbb.tmp', None), ('merged.m3u.1234.tmp', old), ('x.tmp', old),
                 ('users/bad id!/history.json.abc123.tmp', old), ('history.json.abc12.tmp', old)):
    fp = os.path.join(r, *rel.split('/'))
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    open(fp, 'w').close()
    if age:
        os.utime(fp, (age, age))
n = users.store_sweep(r)
left = sorted(os.path.relpath(f, r).replace(os.sep, '/') for f in tmps(r))
check(n == 3, 'sweep: three old files of our own pattern removed (%d)' % n)
check(left == ['favourites.json.bbbbbb.tmp', 'history.json.abc12.tmp', 'merged.m3u.1234.tmp',
               'users/bad id!/history.json.abc123.tmp', 'x.tmp'], 'sweep: fresh and foreign files stay: %r' % left)
check(users.store_sweep(os.path.join(r, 'nowhere')) == 0, 'sweep: a missing folder is fine')

# ------------------------------------------------------------------ rename
r = root('n')
dana = users.store_create(r, 'Dana', now=10)
tom = users.store_create(r, 'Tom', now=11)
e = raises(ValueError, users.store_rename, r, tom, 'dana', 50)
u = {v['id']: v for v in users.store_users(r)}
check(e is not None and str(e) == 'name exists' and u[tom]['name'] == 'Tom' and u[tom]['renamed'] == 11,
      'rename: another live user\'s name (any case) is refused, nothing changes')
users.store_rename(r, dana, 'DANA', 60)
check({v['id']: v for v in users.store_users(r)}[dana]['name'] == 'DANA', 'rename: own name in another case works')
users.store_switch(r, dana)
users.store_delete(r, tom, 70)
users.store_rename(r, dana, 'tom', 80)
check({v['id']: v for v in users.store_users(r)}[dana]['name'] == 'tom', 'rename: a deleted user\'s name is free')

# ------------------------------------------------------------------ switch
def house(name):
    rr = root(name)
    b = users.store_create(rr, 'Bee', now=5)
    a = users.store_current(rr)
    for i, f in enumerate(users.FILES):
        put(os.path.join(rr, f), {'A': i})
        put(os.path.join(rr, 'users', b, f), {'B': i})
    put(os.path.join(rr, 'history.json.bak'), {'A': 'bak'})
    return rr, a, b


def live(rr):
    return [get(os.path.join(rr, f)) if os.path.exists(os.path.join(rr, f)) else None for f in users.FILES]


A = [{'A': i} for i in range(len(users.FILES))]
B = [{'B': i} for i in range(len(users.FILES))]

r, a, b = house('sw1')
check(users.store_switch(r, b) is True and live(r) == B and users.store_current(r) == b, 'switch: the other user\'s files are live')
st = get(os.path.join(r, users.STATE))
check('switching' not in st and 'since' not in st and users.store_switching(r) is None, 'switch: no mark left')
check([get(os.path.join(r, 'users', a, f)) for f in users.FILES] == A, 'switch: the first user\'s files are kept')
check(not os.path.exists(os.path.join(r, 'history.json.bak')) and not tmps(r), 'switch: no .bak, no temp files')
check(users.store_switch(r, b) is False, 'switch: to the active user changes nothing')

# a failure while the other user's files come in (phase 3)
r, a, b = house('sw2')
real_copy = users._copy_atomic
n = [0]


def flaky(src, dst):
    if os.path.dirname(dst) == r:
        n[0] += 1
        if n[0] == 3:
            raise OSError(28, 'No space left on device')
    return real_copy(src, dst)


users._copy_atomic = flaky
try:
    check(raises(OSError, users.store_switch, r, b) is not None, 'cut switch: the error reaches the caller')
finally:
    users._copy_atomic = real_copy
check(users.store_switching(r) == b and users.store_switch_age(r) is not None, 'cut switch: the mark names the target')
check([get(os.path.join(r, 'users', a, f)) for f in users.FILES] == A, 'cut switch: the first user\'s folder is complete')
check(raises(ValueError, users.store_delete, r, b) is not None, 'cut switch: its target cannot be deleted')
check(autosync.switch_settled(r) is False, 'cut switch: the sync waits (young mark)')
check(users.store_recover(r) is True and live(r) == B and users.store_current(r) == b, 'recover: rolled forward, byte for byte')
check(users.store_switching(r) is None and users.store_switch_age(r) is None and not tmps(r)
      and not os.path.exists(os.path.join(r, 'history.json.bak')), 'recover: no mark, no .bak, no temp files')
check(users.store_recover(r) is False and autosync.switch_settled(r) is True, 'recover: nothing more to do, the sync goes on')

# an old mark is finished by the sync's own check
r, a, b = house('sw2b')
users._mark_switch(r, a, b)
check(autosync.switch_settled(r, now=time.time() + 5) is False, 'settled: a 5 s old switch is left alone')
check(autosync.switch_settled(r, now=time.time() + 60) is True and live(r) == B and users.store_current(r) == b,
      'settled: a 60 s old switch is finished first')

# a failure while the active user's files are saved (phase 1)
r, a, b = house('sw3')


def early(src, dst):
    raise OSError(28, 'No space left on device')


users._copy_atomic = early
try:
    check(raises(OSError, users.store_switch, r, b) is not None, 'early failure: raises')
finally:
    users._copy_atomic = real_copy
check(live(r) == A and users.store_current(r) == a and users.store_switching(r) is None, 'early failure: nothing live changed, no mark')

# the target disappeared while the mark was there
r, a, b = house('sw4')
users.store_switch(r, b)                       # b is active, a's files wait in users/a
users._mark_switch(r, b, 'u9gone')
for f in users.FILES:                          # half-arrived files of the user that no longer exists
    put(os.path.join(r, f), {'junk': 1})
put(os.path.join(r, 'users', b, 'history.json'), {'B': 0})
for i, f in enumerate(users.FILES):
    put(os.path.join(r, 'users', b, f), {'B': i})
check(users.store_recover(r) is True and live(r) == B and users.store_current(r) == b and users.store_switching(r) is None,
      'recover: target gone -> the state user\'s files come back')

# the active user was deleted on another device
r, a, b = house('sw5')
lst = users.store_users(r)
for u in lst:
    if u['id'] == a:
        u['deleted'] = 99
check(users.store_set_users(r, lst) is True and users.store_current(r) == b and live(r) == B
      and users.store_switching(r) is None and not tmps(r), 'set_users: the device moves to the user that is left')

# ------------------------------------------------------------------ new entries against the clear marks
add = searchhist.add
check(add([], 'matrix', now=100, floor=400)[0]['ts'] == 401, 'search: an entry under the mark is stamped mark + 1')
check(add([], 'matrix', now=100, floor=400.7)[0]['ts'] == 401, 'search: a float mark')
check(add([], 'matrix', now=500, floor=400)[0]['ts'] == 500, 'search: a later entry keeps its time')
check(add([], 'matrix', now=100)[0]['ts'] == 100 and add([], 'matrix', now=100, floor=None)[0]['ts'] == 100
      and add([], 'matrix', now=100, floor='x')[0]['ts'] == 100 and add([], 'matrix', now=100, floor=True)[0]['ts'] == 100,
      'search: no mark / a broken mark = as before')
check(searchhist.mark_floor({'searches_cleared': 5, 'searches_removed': {'the matrix': 9, 'x': 50}}, ' The  Matrix ') == 9
      and searchhist.mark_floor(None, 'a') == 0 and searchhist.mark_floor({'searches_removed': 3}, 'a') == 0,
      'search: the mark that covers a text')

r = root('clock')
put(os.path.join(r, 'sync_meta.json'), {'skew': 300})          # the account's clock is 300 s ahead of this box
users.mark(r, 'searches_cleared')
marks = get(os.path.join(r, 'user_marks.json'))
naive = add([], 'matrix')                                      # the device clock: what 6.5.0 wrote
kept = syncdoc.merge_user_data({'searches': naive, 'marks': marks}, {})
fixed = add([], 'matrix', now=users.clock(r), floor=searchhist.mark_floor(marks, 'matrix'))
kept2 = syncdoc.merge_user_data({'searches': fixed, 'marks': marks}, {})
check(not kept.get('searches') and [h['q'] for h in kept2.get('searches') or []] == ['matrix'],
      'search after "clear" on a box whose clock is behind: kept by the sync (was dropped)')

r = root('same')
users.mark(r, 'searches_removed', 'Matrix')
marks = get(os.path.join(r, 'user_marks.json'))
again = add([], 'Matrix', now=marks['searches_removed']['matrix'], floor=searchhist.mark_floor(marks, 'Matrix'))
check([h['q'] for h in syncdoc.merge_user_data({'searches': again, 'marks': marks}, {}).get('searches') or []] == ['Matrix'],
      'search again in the same second as its removal: kept')

r = root('hist')
put(os.path.join(r, 'sync_meta.json'), {'skew': 300})
users.mark(r, 'history_cleared')
marks = get(os.path.join(r, 'user_marks.json'))
ts = users.history_ts(r)
check(ts > marks['history_cleared'], 'history: a new entry is later than the clear mark')
check(users.history_ts(r, now=marks['history_cleared'] - 50) == marks['history_cleared'] + 1, 'history: under the mark -> mark + 1')
check(users.history_ts(root('h0'), now=77) == 77, 'history: no mark -> the clock')
entry = {'key': 'movie:1', 'label': 'x', 'when': '', 'ts': ts}
out = syncdoc.merge_user_data({'history': [entry], 'marks': marks}, {})
check([h['key'] for h in out.get('history') or []] == ['movie:1'], 'history: kept by the sync')
out = syncdoc.merge_user_data({'history': [dict(entry, ts=time.time())], 'marks': marks}, {})
check(not out.get('history'), 'history: (the device clock alone would have lost it)')

shutil.rmtree(TMP, ignore_errors=True)
print('USERS TESTS OK' if not bad else 'USERS TESTS: %d problems' % len(bad))
sys.exit(1 if bad else 0)
