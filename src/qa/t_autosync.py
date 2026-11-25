# -*- coding: utf-8 -*-
"""4.1.0: users and the continuous sync, end to end without Kodi and without Telegram: two (and three) "devices",
each with its own folder and settings, share one stand-in cloud document and run the real loop (autosync.cycle)
against the real user store (users.store_*)."""
import copy, importlib, io, json, os, shutil, sys, tempfile, types

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
NOVA = os.path.join(HERE, '..', 'plugin.video.nova')
TMP = tempfile.mkdtemp(prefix='tn_sync_')
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
autosync = importlib.import_module('resources.lib.autosync')
syncdoc = importlib.import_module('resources.lib.syncdoc')
bad = []


def check(cond, what):
    if not cond:
        bad.append(what)


class Cloud(object):
    def __init__(self):
        self.doc, self.n, self.puts, self.gets, self.down = None, 0, 0, 0, False


class Device(object):
    """the host autosync.cycle talks to: a folder, three settings maps, the shared cloud"""

    def __init__(self, name, cloud):
        self.root = os.path.join(TMP, name)
        os.makedirs(self.root)
        self.cloud = cloud
        self.sett = {'plugin.video.nova': {'tmdb_key': '', 'gemini_key': '', 'debug': 'false', 'sub_server': ''},
                     'plugin.video.telescope': {'rd_token': '', 'rd_enabled': 'true', 'port': '65220'}}
        self.meta = {}
        self.files = {}

    def load_meta(self):
        return copy.deepcopy(self.meta)

    def save_meta(self, m):
        self.meta = json.loads(json.dumps(m))          # what a file on disk would give back

    def users(self):
        return users.store_users(self.root)

    def set_users(self, lst):
        return users.store_set_users(self.root, lst)

    def user_data(self, uid):
        return users.store_data(self.root, uid)

    def put_user_data(self, uid, data):
        return users.store_put(self.root, uid, data)

    def settings(self, aid):
        return dict(self.sett[aid]) if aid in self.sett else None

    def set_setting(self, aid, k, v):
        self.sett[aid][k] = v
        return True

    def file(self, name):
        return copy.deepcopy(self.files.get(name))

    def put_file(self, name, obj):
        self.files[name] = copy.deepcopy(obj)

    def cloud_mark(self):
        return '' if self.cloud.doc is None else 'v%d' % self.cloud.n

    def cloud_get(self):
        if self.cloud.down:
            return None
        self.cloud.gets += 1
        return json.loads(json.dumps(self.cloud.doc))

    def cloud_put(self, doc):
        if self.cloud.down:
            return ''
        self.cloud.doc, self.cloud.n = json.loads(json.dumps(doc)), self.cloud.n + 1
        self.cloud.puts += 1
        return 'v%d' % self.cloud.n

    # what a viewer does on this device
    def watch(self, key, ts):
        p = os.path.join(self.root, 'history.json')
        h = [e for e in users._read(p, []) if e['key'] != key]
        h.insert(0, {'key': key, 'ts': ts, 'when': '16/11/2026 18:00', 'label': key})
        users._write(p, h)

    def history(self, uid=None):
        return [e['key'] for e in users.store_data(self.root, uid or users.store_current(self.root))['history']]


def rounds(devs, t, n=3):
    for i in range(n):
        for d in devs:
            autosync.cycle(d, t + i)


# ---- the user store on one device
root = os.path.join(TMP, 'solo')
os.makedirs(root)
check([u['id'] for u in users.store_live(root)] == ['u1'] and users.store_current(root) == 'u1', 'a first user always exists')
users._write(os.path.join(root, 'history.json'), [{'key': 'a', 'ts': 1}])
users._write(os.path.join(root, 'favourites.json'), [{'kind': 'movie', 'id': 1, 'added': '01/11/2026 10:00'}])
kid = users.store_create(root, '  Kids  ', now=100)
check(users.store_users(root)[1]['name'] == 'Kids', 'name cleaned')
for wrong in ('', 'kids'):
    try:
        users.store_create(root, wrong)
        check(False, 'empty / existing name must be refused: %r' % wrong)
    except ValueError:
        pass
check(users.store_switch(root, kid) and users.store_current(root) == kid, 'switched')
check(not os.path.exists(os.path.join(root, 'history.json')), 'a new user starts with an empty history')
check(users.store_data(root, 'u1')['history'] == [{'key': 'a', 'ts': 1}], 'the other user\'s history waits in their folder')
users._write(os.path.join(root, 'history.json'), [{'key': 'cartoon', 'ts': 5}])
users.store_switch(root, 'u1')
check(users._read(os.path.join(root, 'history.json'), []) == [{'key': 'a', 'ts': 1}] and
      users.store_data(root, kid)['history'] == [{'key': 'cartoon', 'ts': 5}], 'each user gets their own files back')
check(not users.store_switch(root, 'u1') and not users.store_switch(root, 'nobody'), 'switching to the active / an unknown user does nothing')
for uid in ('u1',):
    try:
        users.store_delete(root, uid)
        check(False, 'the active user cannot be deleted')
    except ValueError:
        pass
users.store_delete(root, kid, now=500)
check([u['id'] for u in users.store_live(root)] == ['u1'] and not os.path.isdir(os.path.join(root, 'users', kid)), 'deleted: gone from the list and the disk')
check(users.store_users(root)[1]['deleted'] == 500, 'the deletion is remembered for the other devices')
try:
    users.user_dir(root, '../x')
    check(False, 'a user id is never a path')
except ValueError:
    pass

# ---- two devices
cloud = Cloud()
A, B = Device('A', cloud), Device('B', cloud)
A.sett['plugin.video.nova'].update(tmdb_key='', debug='true', sub_server='http://192.168.1.5:8765')
A.watch('film1', 10)
r = autosync.cycle(A, 1000)
check(r['pushed'] and not r['pulled'] and cloud.puts == 1, 'the first device creates the document')
r = autosync.cycle(A, 1001)
check(not r['pushed'] and not r['pulled'] and cloud.puts == 1 and cloud.gets == 0, 'nothing changed: nothing is sent or fetched')
A.sett['plugin.video.nova']['tmdb_key'] = 'KEY-A'                 # the viewer types a key on A
A.sett['plugin.video.telescope']['rd_token'] = 'RD-A'
A.files['iptv.json'] = {'m3u': ['http://list']}
autosync.cycle(A, 1010)
r = autosync.cycle(B, 1020)                                       # B: freshly installed, just logged in
check(r['pulled'] and B.sett['plugin.video.nova']['tmdb_key'] == 'KEY-A' and B.sett['plugin.video.telescope']['rd_token'] == 'RD-A',
      'a new device takes the keys and logins by itself: %r' % r)
check(B.files.get('iptv.json') == {'m3u': ['http://list']} and B.history() == ['film1'], 'and the IPTV sources and the history')
check(B.sett['plugin.video.nova']['debug'] == 'false' and B.sett['plugin.video.nova']['sub_server'] == '' and
      B.sett['plugin.video.telescope']['port'] == '65220', 'what belongs to one device stays there')
check(A.sett['plugin.video.nova']['tmdb_key'] == 'KEY-A', 'the empty defaults of the new device did not travel back')
rounds([A, B], 1030)
puts = cloud.puts
rounds([A, B], 1040)
check(cloud.puts == puts, 'two idle devices never write (no ping-pong): %d -> %d' % (puts, cloud.puts))

# both change things at the same time
A.watch('film2', 2000)
B.watch('film3', 2001)
B.sett['plugin.video.nova']['gemini_key'] = 'GEM-B'
A.sett['plugin.video.nova']['tmdb_key'] = 'KEY-A2'
kids = users.store_create(B.root, 'Kids', now=2002)
users.store_switch(B.root, kids)
B.watch('cartoon', 2003)
rounds([A, B], 2010)
check(A.history('u1') == ['film3', 'film2', 'film1'] and B.history('u1') == ['film3', 'film2', 'film1'], 'both histories merged on both: %r / %r' % (A.history('u1'), B.history('u1')))
check(A.sett['plugin.video.nova'] == dict(B.sett['plugin.video.nova'], debug='true', sub_server='http://192.168.1.5:8765') and
      A.sett['plugin.video.nova']['gemini_key'] == 'GEM-B' and B.sett['plugin.video.nova']['tmdb_key'] == 'KEY-A2', 'settings changed on either device reach the other')
check([u['name'] for u in users.store_live(A.root)] == ['', 'Kids'] and A.history(kids) == ['cartoon'], 'the new user and their content arrive')
check(users.store_current(A.root) == 'u1' and users.store_current(B.root) == kids, 'which user is active stays each device\'s own choice')
check(B.history() == ['cartoon'], 'the active user of B still sees their own list')

# a change while the cloud is unreachable is not lost
cloud.down = True
A.watch('film4', 3000)
r = autosync.cycle(A, 3001)
check(not r['pushed'], 'no upload while the account cannot be reached')
cloud.down = False
rounds([A, B], 3010)
check('film4' in B.history('u1'), 'sent as soon as the account answers again')

# clearing and removing travel too
users._write(os.path.join(A.root, 'history.json'), [])
users.mark(A.root, 'history_cleared', now=4000)
rounds([A, B], 4010)
check(A.history('u1') == [] and B.history('u1') == [], 'a cleared history stays cleared everywhere (it does not come back from the other device)')
B_main = os.path.join(B.root, 'users', 'u1')
A.watch('film5', 5000)
rounds([A, B], 5010)
check(B.history('u1') == ['film5'], 'and new entries after the clearing do travel')

# a user deleted on one device
users.store_switch(B.root, 'u1')
users.store_delete(B.root, kids, now=6000)
rounds([A, B], 6010)
check([u['id'] for u in users.store_live(A.root)] == ['u1'] and not os.path.isdir(os.path.join(A.root, 'users', kids)), 'deleted everywhere')

# a third device that was the deleted user... (its active user disappears)
C = Device('C', cloud)
autosync.cycle(C, 7000)
guest = users.store_create(C.root, 'Guest', now=7001)
users.store_switch(C.root, guest)
rounds([A, B, C], 7010)
users.store_delete(A.root, guest, now=7100)
rounds([A, B, C], 7110)
check(users.store_current(C.root) == 'u1' and C.history() == ['film5'], 'a device whose active user was deleted elsewhere moves to the first user')
docs = []
for d in (A, B, C):
    autosync.cycle(d, 7200)
for d in (A, B, C):
    autosync.cycle(d, 7201)
    docs.append(syncdoc.canon(d.meta['last_doc']['users']) + syncdoc.canon(d.meta['last_doc']['data']))
check(len(set(docs)) == 1, 'three devices hold the same users and content at the end')
# the device that founds the document is already configured: its setup IS the account's setup (found live 16/11:
# a second device received the content but none of the settings, and wrote the document again for nothing)
cloud2 = Cloud()
F1, F2 = Device('F1', cloud2), Device('F2', cloud2)
F1.sett['plugin.video.nova'].update(tmdb_key='OLD-KEY', gemini_key='OLD-GEM')
F1.sett['plugin.video.telescope']['rd_token'] = 'OLD-RD'
F1.files['iptv.json'] = {'m3u': ['http://old']}
F1.watch('seen', 5)
autosync.cycle(F1, 9000)
puts2 = cloud2.puts
r = autosync.cycle(F2, 9010)
check(F2.sett['plugin.video.nova']['tmdb_key'] == 'OLD-KEY' and F2.sett['plugin.video.telescope']['rd_token'] == 'OLD-RD' and
      F2.files.get('iptv.json') == {'m3u': ['http://old']} and F2.history() == ['seen'], 'a new device receives the founder\'s whole setup')
check(not r['pushed'] and cloud2.puts == puts2, 'and writes nothing back: %r' % r)
rounds([F1, F2], 9020)
check(cloud2.puts == puts2 and F1.sett['plugin.video.nova']['tmdb_key'] == 'OLD-KEY', 'idle afterwards, the founder keeps its values')
F2.sett['plugin.video.nova']['tmdb_key'] = 'NEW-KEY'
rounds([F1, F2], 9100)
check(F1.sett['plugin.video.nova']['tmdb_key'] == 'NEW-KEY', 'a later change on the second device reaches the founder')

check(autosync.syncable({'debug': 'true', 'port': '1', 'tmdb_key': 'k', 'sub_server': 'x', 'wizard_shown': 'true', 'rd_token': 't',
                         'kodion.http.port': '5'}) == {'tmdb_key': 'k', 'rd_token': 't'}, 'the list of device-only settings')

# ---- 6.2.0: session hard exclusion, new device-only keys, sections / files of other peers pass through
check(autosync.syncable({'lite': 'true', 'ui_sounds': 'false', 'open_on_start': 'x', 'readahead': '9', 'cache_mb': '5',
                         'max_mbit': '1', 'tg_session': 'S', 'string_session': 'S', 'auth_key': 'K', 'session': 'S',
                         'Telegram_Session_x': 'S', 'gemini_key': 'g'}) == {'gemini_key': 'g'},
      '6.2.0: device-dependent keys and every session-like key are not synced')
cloud3 = Cloud()
K1, K2 = Device('K1', cloud3), Device('K2', cloud3)
K1.sett['plugin.video.nova'].update(lite='true', tmdb_key='T1', tg_session='SECRET-SESSION')
K1.files['telegram.session'] = {'x': 'SECRET-SESSION'}
autosync.cycle(K1, 10000)
raw = json.dumps(cloud3.doc)
check('SECRET-SESSION' not in raw and 'tg_session' not in raw and 'telegram.session' not in raw, 'the session never enters the document')
check('lite' not in cloud3.doc['settings']['plugin.video.nova'], 'lite stays on the device')
# a browser (web peer) puts its own section, an unknown file and - wrongly - a session key into the document
doc = json.loads(json.dumps(cloud3.doc))
doc['settings']['web'] = {'channels': [['a', 'b'], 10050], 'subs_size': ['32', 10050]}
doc['settings']['plugin.video.unknown'] = {'k': ['v', 10050]}
doc['settings']['plugin.video.nova']['string_session'] = ['BAD-SESSION', 10050]
doc['settings']['plugin.video.nova']['lite'] = ['false', 10050]
doc['settings']['plugin.video.nova']['tmdb_key'] = ['T-WEB', 10050]
doc['files']['radio.json'] = [{'own': [1]}, 10050]
doc['files']['../evil.json'] = [{'x': 1}, 10050]
doc['files']['tg_session'] = ['BAD-SESSION', 10050]
cloud3.doc, cloud3.n = doc, cloud3.n + 1
r = autosync.cycle(K1, 10100)
check(K1.sett['plugin.video.nova']['tmdb_key'] == 'T-WEB', 'a browser change of a twin setting reaches Kodi')
check(K1.sett['plugin.video.nova']['lite'] == 'true', 'a device-only key from another peer is not applied: %r' % K1.sett['plugin.video.nova'].get('lite'))
check('web' not in K1.sett and 'string_session' not in K1.sett['plugin.video.nova'], 'the web section / a session key are never applied')
check('radio.json' not in K1.files and '../evil.json' not in K1.files, 'unknown files are not written to disk')
K1.sett['plugin.video.nova']['gemini_key'] = 'G-K1'                # Kodi changes something and re-puts
autosync.cycle(K1, 10200)
autosync.cycle(K1, 10300)                                          # a round without a fetch
autosync.cycle(K2, 10400)                                          # and another Kodi joins and re-puts
K2.sett['plugin.video.nova']['tmdb_key'] = 'T-K2'
autosync.cycle(K2, 10500)
autosync.cycle(K1, 10600)
d = cloud3.doc
check(d['settings'].get('web') == {'channels': [['a', 'b'], 10050], 'subs_size': ['32', 10050]}, 'the web section survives Kodi merges and re-puts untouched: %r' % d['settings'].get('web'))
check(d['settings'].get('plugin.video.unknown') == {'k': ['v', 10050]}, 'an unknown add-on section survives')
check(d['files'].get('radio.json') == [{'own': [1]}, 10050], 'an unknown file survives')
check(d['settings']['plugin.video.nova']['gemini_key'][0] == 'G-K1' and K1.sett['plugin.video.nova']['tmdb_key'] == 'T-K2', 'and normal sync still works')
raw = json.dumps(d) + json.dumps(K1.meta) + json.dumps(K2.meta)
check('BAD-SESSION' not in raw and 'SECRET-SESSION' not in raw and 'string_session' not in raw, 'a session key put by a peer is removed from the document and the meta')
check(K2.sett['plugin.video.nova'].get('lite') is None, 'the new device did not receive lite')
# 6.2.0 (I): a key another peer put into an installed add-on's section (one this Kodi does not have) survives
# this device's own re-puts, also in rounds without a fetch
doc = json.loads(json.dumps(cloud3.doc))
doc['settings']['plugin.video.nova']['peer_only'] = ['P', 10700]
cloud3.doc, cloud3.n = doc, cloud3.n + 1
autosync.cycle(K1, 10700)
K1.sett['plugin.video.nova'].pop('peer_only', None)                # this Kodi has no such setting
K1.sett['plugin.video.nova']['gemini_key'] = 'G-K1b'
autosync.cycle(K1, 10800)
K1.sett['plugin.video.nova']['gemini_key'] = 'G-K1c'
autosync.cycle(K1, 10900)                                          # re-put without a fetch
check(cloud3.doc['settings']['plugin.video.nova'].get('peer_only') == ['P', 10700] and
      cloud3.doc['settings']['plugin.video.nova']['gemini_key'][0] == 'G-K1c',
      '6.2.0: a peer key in an installed section is carried: %r' % cloud3.doc['settings']['plugin.video.nova'].get('peer_only'))
# 6.2.0 (K): the session-key rule is the web one (websync.js) - shared vectors
for k in ('session', 'tg_session', 'string_session', 'StringSess', 'auth_key', 'authKey', 'AUTHKEY', 'my_session_x'):
    check(autosync.is_session(k), '6.2.0: session-like key: %s' % k)
for k in ('tmdb_key', 'gemini_key', 'rd_token', 'auth', 'key', 'string'):
    check(not autosync.is_session(k), '6.2.0: ordinary key: %s' % k)
backup = importlib.import_module('resources.lib.backup')
for n in ('telegram.session-wal', 'telegram.session-shm', 'telegram.session.new', 'x/Telegram.SESSION-WAL'):
    check(backup.is_session_file(n), '6.2.0 (J): session side file kept out of backups: %s' % n)
for n in ('telegram.session', 'telegram.session-journal','addon_data/plugin.video.telescope/telegram.session', 'tg_session.txt',
          'string_session', 'auth_key.bin'):
    check(backup.is_session_file(n), 'backup never holds / restores the login: %s' % n)
for n in ('settings.xml', 'iptv.json', 'history.json', 'port.json', 'sessions_helper.py'):
    check(not backup.is_session_file(n), 'ordinary file kept in a backup: %s' % n)
for mod in (users,):
    for k, v in mod.STR.items():
        check(len(v) == 3 and all(v), 'string %s in three languages' % k)

for b in bad:
    print('FAIL', b)
print('AUTOSYNC TESTS OK' if not bad else 'AUTOSYNC TESTS: %d problems' % len(bad))
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if bad else 0)
