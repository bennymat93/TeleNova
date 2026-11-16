# -*- coding: utf-8 -*-
"""Live: users through the real screens of the running Kodi. Creates a second user with the on-screen keyboard,
checks that the active user's files were swapped (empty history for the new user, the first user's history kept),
switches back, deletes the test user - and leaves the profile exactly as it was. Prints counts only."""
import io, json, os, sys, time
import t_live_keys as t

ROOT = os.path.join(os.environ['APPDATA'], 'Kodi', 'userdata', 'addon_data', 'plugin.video.nova')
NAME = 'QA %d' % (int(time.time()) % 100000)
bad = []


def rd(name, default):
    try:
        return json.load(io.open(os.path.join(ROOT, name), encoding='utf-8'))
    except (OSError, ValueError):
        return default


def users():
    return [u for u in rd('users.json', [{'id': 'u1', 'name': ''}]) if not u.get('deleted')]


def current():
    return (rd('sync_state.json', {}) or {}).get('user') or 'u1'


def active(win):
    r = t.rpc('XBMC.GetInfoBooleans', {'booleans': ['Window.IsActive(%s)' % win]}).get('result') or {}
    return bool(r.get('Window.IsActive(%s)' % win))


def wait(pred, seconds=15):
    t0 = time.time()
    while time.time() - t0 < seconds:
        if pred():
            return True
        time.sleep(0.4)
    return False


def run(uid):
    t.rpc('Addons.ExecuteAddon', {'addonid': 'plugin.video.nova', 'params': {'a': 'user_do', 'id': uid}, 'wait': False})


hist0, fav0, cur0, n0 = len(rd('history.json', [])), len(rd('favourites.json', [])), current(), len(users())
print('before: %d user(s), history %d, favourites %d' % (n0, hist0, fav0))
try:
    # 1. a new user, typed on the keyboard
    run('new')
    if not wait(lambda: active('virtualkeyboard')):
        bad.append('the name keyboard did not open')
    t.rpc('Input.SendText', {'text': NAME, 'done': True})
    if not wait(lambda: any(u.get('name') == NAME for u in users()) and current() != cur0):
        bad.append('the user was not created / made active')
    new = next((u['id'] for u in users() if u.get('name') == NAME), None)
    time.sleep(1)
    print('created and active: %s | their history %d, favourites %d | the first user\'s history kept aside: %d' % (
        bool(new), len(rd('history.json', [])), len(rd('favourites.json', [])), len(rd(os.path.join('users', cur0, 'history.json'), []))))
    if rd('history.json', []) or rd('favourites.json', []):
        bad.append('a new user must start empty')
    if len(rd(os.path.join('users', cur0, 'history.json'), [])) != hist0:
        bad.append('the first user\'s history was not kept')
    # 2. back to the first user: the select dialog's first row is "switch"
    run(cur0)
    if not wait(lambda: active('selectdialog')):
        bad.append('the user menu did not open')
    t.rpc('Input.Select')
    if not wait(lambda: current() == cur0):
        bad.append('switching back failed')
    time.sleep(1)
    print('back on the first user: history %d, favourites %d' % (len(rd('history.json', [])), len(rd('favourites.json', []))))
    if len(rd('history.json', [])) < hist0 or len(rd('favourites.json', [])) != fav0:
        bad.append('the first user did not get their files back')
    # 3. delete the test user: rows are switch / rename / delete, then "yes"
    if new:
        run(new)
        if wait(lambda: active('selectdialog')):
            t.rpc('Input.Down')
            time.sleep(0.3)
            t.rpc('Input.Down')
            time.sleep(0.3)
            t.rpc('Input.Select')
            if wait(lambda: active('yesnodialog')):
                # the focus of a yes/no dialog starts on "no": find "yes" by its control id (11)
                for _ in range(4):
                    cid = (t.rpc('XBMC.GetInfoLabels', {'labels': ['System.CurrentControlId']}).get('result') or {}).get('System.CurrentControlId')
                    if cid == '11':
                        break
                    t.rpc('Input.Left')
                    time.sleep(0.3)
                t.rpc('Input.Select')
        if not wait(lambda: not any(u.get('name') == NAME for u in users())):
            bad.append('the test user was not deleted through the screen')
finally:
    for w in ('yesnodialog', 'selectdialog', 'virtualkeyboard'):
        if active(w):
            t.rpc('Input.Back')
            time.sleep(0.5)
    left = [u for u in users() if u.get('name') == NAME]
    if left or current() != cur0:
        # the screen path failed half-way: put the profile back with the store itself
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.nova', 'resources', 'lib'))
        import importlib.util
        spec = importlib.util.spec_from_file_location('users_store', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.nova', 'resources', 'lib', 'users.py'))
        us = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(us)
        if us.store_current(ROOT) != cur0:
            us.store_switch(ROOT, cur0)
        for u in left:
            us.store_delete(ROOT, u['id'])
        print('cleaned up with the store functions')
print('after: %d user(s), active unchanged: %s, history %d, favourites %d' % (len(users()), current() == cur0, len(rd('history.json', [])), len(rd('favourites.json', []))))
if len(users()) != n0 or current() != cur0 or len(rd('favourites.json', [])) != fav0:
    bad.append('the profile is not as it was')
print('USERS LIVE OK' if not bad else 'USERS LIVE: %s' % bad)
sys.exit(1 if bad else 0)
