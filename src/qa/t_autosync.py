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


# ---- 6.3.0
class Clocked(Device):
    """a device whose clock is off by `off` seconds; the cloud's server time is SRV[0] (its mark: 'n:server time')"""

    def __init__(self, name, cloud, off, srv):
        Device.__init__(self, name, cloud)
        self.off, self.srv = off, srv

    def clock(self):
        return self.srv[0] + self.off

    def cloud_mark(self):
        return '' if self.cloud.doc is None else getattr(self.cloud, 'mark', 'v%d' % self.cloud.n)

    def cloud_put(self, doc):
        m = Device.cloud_put(self, doc)
        if m:
            self.cloud.mark = '%d:%d' % (self.cloud.n, self.srv[0])
        return self.cloud.mark if m else ''


SRV = [1800000000]
cl = Cloud()
S, Fd = Clocked('S', cl, -1800, SRV), Clocked('Fd', cl, 7200, SRV)       # 30 minutes slow, 2 hours fast
Fd.watch('x', 1)
autosync.cycle(Fd, Fd.clock())
autosync.cycle(S, S.clock())
S.sett['plugin.video.nova']['gemini_key'] = 'S0'                       # S writes once, so it learns too
autosync.cycle(S, S.clock())
check(abs(Fd.meta.get('skew', 0) + 7200) < 1 and abs(S.meta.get('skew', 0) - 1800) < 1,
      'L1: each device learns the offset of its clock: %r / %r' % (Fd.meta.get('skew'), S.meta.get('skew')))
check(autosync.skew_of({'skew': 10 ** 9}) == 0 and autosync.skew_of({'skew': True}) == 0, 'L1: an absurd offset is not used')
SRV[0] += 100
Fd.sett['plugin.video.nova']['tmdb_key'] = 'FAST'
autosync.cycle(Fd, Fd.clock())
SRV[0] += 100                                                          # later in real time, on the slow device
S.sett['plugin.video.nova']['tmdb_key'] = 'SLOW'
autosync.cycle(S, S.clock())
for _ in range(2):
    autosync.cycle(Fd, Fd.clock())
    autosync.cycle(S, S.clock())
check(Fd.sett['plugin.video.nova']['tmdb_key'] == 'SLOW' and S.sett['plugin.video.nova']['tmdb_key'] == 'SLOW',
      'L1: the later change wins although its device\'s clock is 2.5 hours behind the other: %r' % Fd.sett['plugin.video.nova']['tmdb_key'])
SRV[0] += 100
Fd.sett['plugin.video.nova']['new_key_x'] = 'v'
S.sett['plugin.video.nova']['new_key_y'] = 'w'
autosync.cycle(Fd, Fd.clock())
autosync.cycle(S, S.clock())
st_ = [cl.doc['settings']['plugin.video.nova'][k][1] for k in ('new_key_x', 'new_key_y')]
check(all(abs(x - SRV[0]) < 5 for x in st_), 'L1: once learned, both devices stamp on the server\'s clock: %r vs %r' % (st_, SRV[0]))
# without a learned offset: a change of this round still goes after the account's stamp of the same key (B2)
cl2 = Cloud()
P1, P2 = Device('P1', cl2), Device('P2', cl2)
autosync.cycle(P1, 50000)
P1.sett['plugin.video.nova']['tmdb_key'] = 'P1'
autosync.cycle(P1, 50010)
autosync.cycle(P2, 40000)                                              # a slow clock that never uploaded
P2.sett['plugin.video.nova']['tmdb_key'] = 'P2'
P1.sett['plugin.video.nova']['gemini_key'] = 'G'
autosync.cycle(P1, 50020)                                              # the account moves on (mark changes)
autosync.cycle(P2, 40100)
check(cl2.doc['settings']['plugin.video.nova']['tmdb_key'] == ['P2', 50011], 'L1/B2: re-stamped after the account\'s stamp: %r' % cl2.doc['settings']['plugin.video.nova']['tmdb_key'])
cl2.doc['settings']['plugin.video.nova']['gemini_key'] = ['G2', 50020 + 10 ** 7]         # a broken writer far in the future
cl2.n += 1
P2.sett['plugin.video.nova']['gemini_key'] = 'P2G'
autosync.cycle(P2, 40200)
pp = {'k': ['v', 40200]}
check(autosync._restamp(pp, 'k', ['x', 10 ** 8], 40200) == 40200 + 86401 and pp['k'] == ['v', 40200 + 86401] and
      cl2.doc['settings']['plugin.video.nova']['gemini_key'][1] == 50020 + 10 ** 7,
      'L1: an account stamp counts as a day ahead at most (a broken stamp never spreads)')

# devices, keyed lists: two Kodi devices add different IPTV lists at the same time - both stay (P1)
cl3 = Cloud()
K3, K4 = Device('K3', cl3), Device('K4', cl3)
K3.files['iptv.json'] = {'m3u': ['http://one'], 'epg': []}
rounds([K3, K4], 60000)
check(list(cl3.doc.get('devices', {}).keys()) == [K3.meta['device_id']] and cl3.doc['devices'][K3.meta['device_id']]['sv'] == syncdoc.LEVEL,
      'the device that wrote is listed (a device that only reads is listed with its first write - no extra uploads)')
check(set(cl3.doc.get('keyed', {}).get('iptv', {}).keys()) == {'http://one'}, 'the keyed IPTV list is in the document: %r' % cl3.doc.get('keyed'))
K3.files['iptv.json'] = {'m3u': ['http://one', 'http://three'], 'epg': []}
K4.files['iptv.json'] = {'m3u': ['http://one', 'http://four'], 'epg': []}
autosync.cycle(K3, 60100)
autosync.cycle(K4, 60101)
rounds([K3, K4], 60200)
want = {'m3u': ['http://one', 'http://four', 'http://three'], 'epg': []}
check(K3.files['iptv.json']['m3u'] and sorted(K3.files['iptv.json']['m3u']) == sorted(want['m3u']) and K4.files['iptv.json'] == K3.files['iptv.json'],
      'P1: both new lists survive on both devices: %r / %r' % (K3.files['iptv.json'], K4.files['iptv.json']))
check(sorted(cl3.doc.get('devices', {}).keys()) == sorted([K3.meta['device_id'], K4.meta['device_id']]) and
      all(e['kind'] == 'kodi' for e in cl3.doc['devices'].values()), 'devices: both Kodi devices listed after both wrote')
K4.files['iptv.json'] = {'m3u': [u for u in K4.files['iptv.json']['m3u'] if u != 'http://one'], 'epg': []}
rounds([K3, K4], 60300)
check('http://one' not in K3.files['iptv.json']['m3u'], 'P1: a removal travels')
puts = cl3.puts
rounds([K3, K4], 60400)
check(cl3.puts == puts, 'P1: idle devices do not write: %d -> %d' % (puts, cl3.puts))
# an older device (no keyed list, no devices) writes the document: the plain value is kept, nothing is lost
old = json.loads(json.dumps(cl3.doc))
old.pop('keyed', None)
old.pop('devices', None)
old['files']['iptv.json'] = [{'m3u': ['http://three', 'http://old'], 'epg': []}, 70000]
cl3.doc, cl3.n = old, cl3.n + 1
rounds([K3, K4], 70010)
check(sorted(K3.files['iptv.json']['m3u']) == ['http://old', 'http://three'] and K4.files['iptv.json'] == K3.files['iptv.json'] and
      'keyed' in cl3.doc, 'P1: an older device\'s newer list is taken whole and the keyed list comes back: %r' % K3.files['iptv.json'])

# the secrets envelope (P2): two devices with the passphrase, one without
cl4 = Cloud()
E1, E2, E3 = Device('E1', cl4), Device('E2', cl4), Device('E3', cl4)
E1.passphrase = E2.passphrase = lambda: 'owner words'
E1.sett['plugin.video.nova']['tmdb_key'] = 'SECRET-TMDB'
autosync.cycle(E1, 80000)
raw = json.dumps(cl4.doc)
check('SECRET-TMDB' not in raw and isinstance(cl4.doc.get('secrets'), dict), 'P2: keys travel sealed only')
autosync.cycle(E2, 80010)
check(E2.sett['plugin.video.nova']['tmdb_key'] == 'SECRET-TMDB', 'P2: a device with the passphrase gets them')
E3.sett['plugin.video.nova']['tmdb_key'] = 'E3-OWN'
r = autosync.cycle(E3, 80020)
check(r['locked'] and E3.sett['plugin.video.nova']['tmdb_key'] == 'E3-OWN' and 'E3-OWN' not in json.dumps(cl4.doc), 'P2: without it nothing is read and its own key is not put in plain text')
E2.sett['plugin.video.nova']['tmdb_key'] = 'NEW-TMDB'
rounds([E1, E2, E3], 80100)
check(E1.sett['plugin.video.nova']['tmdb_key'] == 'NEW-TMDB' and 'NEW-TMDB' not in json.dumps(cl4.doc), 'P2: a change travels sealed')
puts = cl4.puts
rounds([E1, E2, E3], 80200)
check(cl4.puts == puts, 'P2: an idle sealed document is not re-written: %d -> %d' % (puts, cl4.puts))
# an older device (sync level 2) in 'devices' makes the doc not capable(): an opened envelope must still go up sealed
lowdoc = json.loads(json.dumps(cl4.doc))
lowdoc.setdefault('devices', {})['old-box'] = {'sv': 2, 'kind': 'kodi', 'name': 'old', 'at': 80250}
cl4.doc, cl4.n = lowdoc, cl4.n + 1
salt0 = json.dumps(cl4.doc['secrets'].get('salt'))
E1.sett['plugin.video.nova']['gemini_key'] = 'E1-GEM'
autosync.cycle(E1, 80300)
raw = json.dumps(cl4.doc)
check(isinstance(cl4.doc.get('secrets'), dict) and 'NEW-TMDB' not in raw and 'E1-GEM' not in raw,
      'P2: below sync level 3 an opened envelope is sealed again, no plain keys: %s' % raw[:300])
check(json.dumps(cl4.doc['secrets'].get('salt')) == salt0, 'P2: the envelope keeps its salt')
autosync.cycle(E2, 80310)
check(E2.sett['plugin.video.nova']['gemini_key'] == 'E1-GEM', 'P2: the resealed key still reaches the other device')

# categories (P3): switched off here = neither sent nor written here; the account's data passes through
cl5 = Cloud()
G1, G2 = Device('G1', cl5), Device('G2', cl5)
G1.sett['plugin.video.nova']['tmdb_key'] = 'G1'
rounds([G1, G2], 90000)
G2.cats = lambda: {'settings': False}
G2.sett['plugin.video.nova']['tmdb_key'] = 'G2-LOCAL'
G1.sett['plugin.video.nova']['gemini_key'] = 'G1-GEM'
G2.watch('g2film', 90100)
rounds([G1, G2], 90100)
check(G2.sett['plugin.video.nova']['gemini_key'] == '' and G1.sett['plugin.video.nova']['tmdb_key'] == 'G1', 'P3: settings off: none taken, none sent')
check(cl5.doc['settings']['plugin.video.nova']['gemini_key'][0] == 'G1-GEM' and 'g2film' in G1.history(), 'P3: the rest still travels, the account keeps its settings')
# a document of a later release: read, never written over (B3)
cl6 = Cloud()
H1 = Device('H1', cl6)
autosync.cycle(H1, 95000)
fut = json.loads(json.dumps(cl6.doc))
fut['v'], fut['newpart'] = 3, {'x': 1}
cl6.doc, cl6.n = fut, cl6.n + 1
H1.sett['plugin.video.nova']['tmdb_key'] = 'LOCAL'
puts = cl6.puts
r = autosync.cycle(H1, 95100)
check(r['update'] and cl6.puts == puts and cl6.doc['newpart'] == {'x': 1}, 'B3: a later version is read only')
cl6.doc['v'] = 2
cl6.n += 1
autosync.cycle(H1, 95200)
check(cl6.doc.get('newpart') == {'x': 1} and cl6.doc['settings']['plugin.video.nova']['tmdb_key'][0] == 'LOCAL', 'B3: an unknown part survives this device\'s write')
# B4: Kodi's device-only list and the browser's are one list
KEYS = ['debug', 'port', 'device_profile', 'deps_zip', 'wizard_shown', 'sub_server', 'lite', 'ui_sounds', 'open_on_start', 'readahead',
        'cache_mb', 'max_mbit', 'x_done', 'last_x', 'a_ts', 'a_time', 'kodion.a', 'a.port', 'tmdb_key', 'gemini_key', 'sub_server_remote',
        'lite_mode', 'portal', 'rd_token', 'stremio_servers', 'pinned_chats']
import shutil as _sh, subprocess as _sp
node = _sh.which('node')
if node:
    js = ("const TW=require(process.argv[1]);const k=JSON.parse(process.argv[2]);process.stdout.write(JSON.stringify(k.map(x=>TW.KODI_LOCAL_RX.test(x))))")
    res = _sp.run([node, '-e', js, os.path.join(HERE, '..', '..', 'web', 'twins.js'), json.dumps(KEYS)], stdout=_sp.PIPE).stdout
    check(json.loads(res.decode('utf-8')) == [bool(autosync.LOCAL.match(k)) for k in KEYS], 'B4: the browser\'s device-only list is Kodi\'s')
# the sync screen's strings and the devices lines
sync_ui = importlib.import_module('resources.lib.sync_ui')
for k, v in sync_ui.STR.items():
    check(len(v) == 3 and all(v), 'sync_ui string %s in three languages' % k)
cs = importlib.import_module('resources.lib.cloudsync')
for k in ('update', 'locked', 'sync_screen'):
    check(len(cs.STR[k]) == 3 and all(cs.STR[k]), 'cloudsync string %s in three languages' % k)
sys.modules['resources.lib.common'].ui_lang = lambda: 'en'
lines = sync_ui.device_rows([('a', {'kind': 'kodi', 'sv': 3, 'name': 'Living room', 'at': 0}, True), ('b', {'kind': 'web', 'sv': 3}, False)])
check(lines[0].startswith('Living room (this device)') and lines[1].startswith('Web'), 'devices lines: %r' % lines)

for b in bad:
    print('FAIL', b)
print('AUTOSYNC TESTS OK' if not bad else 'AUTOSYNC TESTS: %d problems' % len(bad))
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if bad else 0)
