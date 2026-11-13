# -*- coding: utf-8 -*-
"""4.0.4: the services screen rules, the setup-sync decisions, the browser command, the sync backup filter and the
All_Subs Ktuvit patch. No Kodi, no network."""
import importlib, io, os, sys, tempfile, types

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
NOVA = os.path.join(HERE, '..', 'plugin.video.nova')
PROFILE = tempfile.mkdtemp(prefix='tn_services_')
USERDATA = os.path.join(PROFILE, 'userdata')
os.makedirs(os.path.join(USERDATA, 'addon_data', 'plugin.video.nova'))


class _Addon(object):
    def __init__(self, aid='plugin.video.nova'):
        self.aid = aid

    def getAddonInfo(self, k):
        return {'profile': os.path.join(USERDATA, 'addon_data', self.aid), 'path': NOVA}.get(k, '')

    def getSetting(self, k):
        return ''

    def setSetting(self, k, v):
        pass


for name in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules[name] = types.ModuleType(name)
x = sys.modules['xbmc']
x.LOGINFO, x.LOGWARNING, x.LOGERROR, x.LOGDEBUG = 1, 2, 3, 0
x.log = lambda *a, **k: None
x.getLanguage = lambda *a, **k: 'en'
x.getInfoLabel = lambda *a: ''
x.getCondVisibility = lambda *a: False
x.ISO_639_1 = 0
x.Monitor = type('Monitor', (), {'abortRequested': lambda s: False, 'waitForAbort': lambda s, t=0: False})
sys.modules['xbmcaddon'].Addon = _Addon
sys.modules['xbmcvfs'].translatePath = lambda p: p.replace('special://profile/', USERDATA + os.sep).replace('special://temp/', PROFILE + os.sep)
sys.path.insert(0, NOVA)
bad = []


def check(cond, what):
    if not cond:
        bad.append(what)


services = importlib.import_module('resources.lib.services')
cloudsync = importlib.import_module('resources.lib.cloudsync')
weblink = importlib.import_module('resources.lib.weblink')
backup = importlib.import_module('resources.lib.backup')
subspatch = importlib.import_module('resources.lib.subspatch')

# ---- 1. the states of the services screen
st = services.services_state({})
check(st['telegram'][0] == 'login', 'telegram without a login')
check(st['rd'][0] == 'login', 'rd on by default, not logged in -> login needed')
for k in ('stremthru', 'opensubs', 'ktuvit_own'):
    check(st[k][0] == 'off', '%s must be off by default: %s' % (k, st[k]))
check(st['bots'][0] == 'on' and st['stremio'][0] == 'off', 'bots on / stremio off by default')
check(st['gemini'][0] == 'key' and st['server'][0] == 'setup' and st['gdrive'][0] == 'off', 'missing key / address')
check(st['sub_wizdom'][0] == 'setup', 'All_Subs not installed -> needs setting up')
st = services.services_state({
    'telegram': {'ok': True, 'name': 'Dana'}, 'rd': {'logged_in': True, 'username': 'u', 'days': 12},
    'st_enabled': True, 'st_check': (True, 'ok'), 'os_enabled': True, 'os_key': '', 'ktuvit_own': True,
    'sub_ktuvit': True, 'sub_wizdom': False, 'gemini_check': (False, 'HTTP 400'), 'tmdb_check': (True, 'built-in'),
    'stremio_count': 2, 'bot_request': False})
check(st['telegram'] == ('on', 'Dana') and st['rd'][0] == 'on' and '12' in st['rd'][1], 'connected services')
check(st['stremthru'][0] == 'on', 'stremthru on with an RD login')
check(st['opensubs'][0] == 'key', 'opensubs on without a key -> key missing')
check(st['ktuvit_own'][0] == 'login', 'own Ktuvit account on without credentials -> login needed')
check(st['sub_ktuvit'][0] == 'on' and st['sub_wizdom'][0] == 'off', 'subtitle sites follow All_Subs')
check(st['gemini'][0] == 'error' and st['tmdb'][0] == 'on', 'failed / passed key checks')
check(st['stremio'] == ('on', '2') and st['bots'][0] == 'off', 'stremio count / bots off')
check(services.services_state({'st_enabled': True})['stremthru'] == ('login', 'Real-Debrid'), 'stremthru needs RD')
check(services.services_state({'rd_enabled': False, 'rd': {'logged_in': True, 'username': 'u'}})['rd'] == ('off', 'u'),
      'rd switched off keeps showing the account')
check(services.services_state({'rd': {'logged_in': True, 'error': 'HTTP 401'}})['rd'][0] == 'error', 'rd error')
on, off, todo, err = services.summary_counts(st)
check(on + off + todo + err == len(services.ROWS) and err == 1, 'summary counts every row once')
check(set(k for k, _, _, _ in services.ROWS) == set(st), 'a state for every row and a row for every state')
for k, _, _, page in services.ROWS:
    check(k in services.ABOUT and len(services.ABOUT[k]) == 3, 'explanation in three languages: ' + k)
    check(page is None or page in weblink.PAGES, 'page of %s' % k)
for k, v in services.STR.items():
    check(len(v) == 3 and all(v), 'string %s in three languages' % k)
check('[COLOR limegreen]' in services.label('X', 'on', 'd') and 'd' in services.label('X', 'on', 'd'), 'label')

# ---- 2. setup sync decisions
fp = cloudsync.fingerprint_of
a = fp({'s': {'tmdb_key': 'k', 'rd_token': 'T1', 'debug': 'true'}, 'iptv.json': {'m3u': ['u']}})
b = fp({'s': {'tmdb_key': 'k', 'rd_token': 'T2', 'debug': 'false'}, 'iptv.json': {'m3u': ['u']}})
c = fp({'s': {'tmdb_key': 'other'}, 'iptv.json': {'m3u': ['u']}})
check(a == b, 'tokens that refresh by themselves and device flags are not a change of the setup')
check(a != c, 'another key is a change')
m = cloudsync.settings_map('<settings version="2"><setting id="a">1</setting><setting id="b" default="true" />'
                           '<setting id="c" value="x" /></settings>')
check(m == {'a': '1', 'b': '', 'c': 'x'}, 'both settings.xml formats: %r' % m)
me = {'device': 'me1', 'pushed': 100, 'pushed_fp': 'L'}
other = {'id': 7, 'date': 200, 'note': {'device': 'tv2', 'name': 'TV', 'fp': 'R'}}
mine = {'id': 8, 'date': 300, 'note': {'device': 'me1', 'fp': 'L'}}
D = cloudsync.decide
check(D(me, [mine, other], 'L') == ('offer', other), 'a newer setup of another device is offered')
check(D(me, [mine], 'L') == ('none', None), 'my own copy is never offered')
check(D(me, [other], 'R') == ('same', other), 'same content: nothing to take')
check(D(dict(me, applied=200), [other], 'L')[0] == 'none', 'already taken')
check(D(dict(me, declined=200), [other], 'L')[0] == 'none', 'declined once: not asked again')
check(D(dict(me, pushed=250), [other], 'L')[0] == 'none', 'this device saved a newer setup afterwards')
check(D(dict(me, pushed=250, pushed_fp='old'), [other], 'L')[0] == 'offer', 'local changes not yet saved: ask')
check(D({'device': 'new'}, [mine, other], 'x') == ('offer', mine), 'a new device is offered the newest copy')
check(D(me, [], 'L') == ('none', None), 'nothing in the account')
S = cloudsync.should_push
check(S({'pushed': 0}, 'A', 10000) and not S({'pushed': 9900, 'pushed_fp': 'B'}, 'A', 10000), 'at most every 10 min')
check(not S({'pushed_fp': 'A'}, 'A', 10 ** 9) and not S({'applied_fp': 'A'}, 'A', 10 ** 9), 'unchanged / just taken')
for k, v in cloudsync.STR.items():
    check(len(v) == 3 and all(v), 'sync string %s in three languages' % k)

# ---- 3. the browser command
check(weblink.command('https://x.y/a', 'win32') == ('startfile', 'https://x.y/a'), 'windows')
check(weblink.command('https://x.y/a', 'darwin') == ('exec', ['open', 'https://x.y/a']), 'mac')
check(weblink.command('https://x.y/a', 'linux') == ('exec', ['xdg-open', 'https://x.y/a']), 'linux')
check(weblink.command('https://x.y/a"b', 'linux', android=True)[1].count('"') == 2, 'android: no quote can end the argument')
check(weblink.command('file:///etc/passwd', 'linux') is None and weblink.command('javascript:1', 'win32') is None,
      'only web addresses are ever opened')
check(all(u.startswith('https://') for u in weblink.PAGES.values()), 'every page is https')

# ---- 4. what the synced copy holds
backup.USERDATA = USERDATA
tele = os.path.join(USERDATA, 'addon_data', 'plugin.video.telescope')
os.makedirs(os.path.join(tele, 'lib', 'telethon'))
nova = os.path.join(USERDATA, 'addon_data', 'plugin.video.nova')
for path, data in ((os.path.join(tele, 'settings.xml'), '<settings/>'), (os.path.join(tele, 'telegram.session'), 'S'),
                   (os.path.join(tele, 'bots.json'), '{}'), (os.path.join(tele, 'port.json'), '{}'),
                   (os.path.join(tele, 'cache.db'), 'x'), (os.path.join(tele, 'lib', 'telethon', 'a.py'), 'x'),
                   (os.path.join(nova, 'settings.xml'), '<settings/>'), (os.path.join(nova, 'iptv.json'), '{}'),
                   (os.path.join(nova, 'services.json'), '{}'), (os.path.join(nova, 'sync_state.json'), '{}'),
                   (os.path.join(nova, 'firstrun.json'), '{}'), (os.path.join(nova, 'nova_channels.m3u'), '#'),
                   (os.path.join(USERDATA, 'favourites.xml'), '<favourites/>'), (os.path.join(USERDATA, 'sources.xml'), '<s/>')):
    with open(path, 'w') as fh:
        fh.write(data)
full = set(arc.replace(os.sep, '/') for _, arc in backup._members())
sync = set(arc.replace(os.sep, '/') for _, arc in backup._members(sync=True))
T, N = 'addon_data/plugin.video.telescope/', 'addon_data/plugin.video.nova/'
check(T + 'telegram.session' in full and T + 'settings.xml' in full and 'sources.xml' in full, 'the file export holds everything, the Telegram login too')
check(N + 'sync_state.json' not in full, 'the identity of the device is never in a backup')
check(T + 'telegram.session' not in sync, 'the synced copy never holds the Telegram login')
for gone in (T + 'port.json', T + 'cache.db', T + 'lib/telethon/a.py', N + 'firstrun.json', N + 'nova_channels.m3u', 'sources.xml'):
    check(gone not in sync, 'device-only file in the synced copy: ' + gone)
for kept in (T + 'settings.xml', T + 'bots.json', N + 'settings.xml', N + 'iptv.json', N + 'services.json', 'favourites.xml'):
    check(kept in sync, 'missing from the synced copy: ' + kept)

# ---- 5. the Ktuvit patch of All_Subs
src_dir = os.path.join(PROFILE, 'allsubs', 'resources', 'sources')
os.makedirs(src_dir)
orig = ("def login_to_ktuvit():\r\n    # Set email and password\r\n    email = 'shared@example.com'\r\n"
        "    password = 'ENC='\r\n\r\n    # Set login request data\r\n"
        "    data = f'{{\"request\":{{\"Email\":\"{email}\",\"Password\":\"{password}\"}}}}'\r\n    return data\r\n")
kt = os.path.join(src_dir, 'ktuvit.py')
with open(kt, 'w', encoding='utf-8', newline='') as fh:
    fh.write(orig)
check(subspatch._patch(kt, subspatch.MARK18, subspatch.KTUVIT18) == 1, 'ktuvit patch applied')
check(subspatch._patch(kt, subspatch.MARK18, subspatch.KTUVIT18) == 0, 'ktuvit patch applied once only')
text = io.open(kt, encoding='utf-8', newline='').read()
check('\r\n' in text and '\n' not in text.replace('\r\n', ''), 'line ends kept')
ns = {}
flags = os.path.join(nova, 'services.json')


def run_login():
    exec(compile(text.replace('\r\n', '\n'), 'ktuvit', 'exec'), ns)
    return ns['login_to_ktuvit']()


check('shared@example.com' in run_login(), 'own account off: the shared account stays')
with open(flags, 'w', encoding='utf-8') as fh:
    fh.write('{"ktuvit_own": true, "ktuvit_email": "me@example.org", "ktuvit_enc": "MINE="}')
out = run_login()
check('me@example.org' in out and 'MINE=' in out and 'shared' not in out, 'own account on: it is used')
with open(flags, 'w', encoding='utf-8') as fh:
    fh.write('{"ktuvit_own": false, "ktuvit_email": "me@example.org", "ktuvit_enc": "MINE="}')
check('shared@example.com' in run_login(), 'switched off again: the shared account')
with open(flags, 'w', encoding='utf-8') as fh:
    fh.write('not json')
check('shared@example.com' in run_login(), 'a damaged file never breaks the subtitle source')

# ---- 6. taking the setup of another device: the files land, the state is remembered, Kodi is closed
import base64, json, zipfile
g = sys.modules['xbmcgui']
asked = []


class _Dlg(object):
    def yesno(self, *a, **k):
        asked.append(a)
        return answer[0]

    def ok(self, *a, **k):
        pass


class _Busy(object):
    def create(self, *a):
        pass

    def close(self):
        pass


class _Win(object):
    props = {}

    def __init__(self, *a):
        pass

    def setProperty(self, k, v):
        _Win.props[k] = v

    def clearProperty(self, k):
        _Win.props.pop(k, None)


g.Dialog, g.DialogProgressBG, g.Window = _Dlg, _Busy, _Win
x.getCondVisibility = lambda c: 'plugin.video' in c or 'service.subtitles' in c
remote = io.BytesIO()
with zipfile.ZipFile(remote, 'w') as z:
    z.writestr('bn_backup.txt', 'x')
    z.writestr('addon_data/plugin.video.nova/iptv.json', '{"m3u": ["http://from-the-other-device"]}')
    z.writestr('addon_data/plugin.video.telescope/settings.xml', '<settings><setting id="os_key">K</setting></settings>')
    z.writestr('../evil.txt', 'no')
    z.writestr('keymaps/evil.xml', 'no')
calls = []


def fake_engine(method, timeout=60, **p):
    calls.append(method)
    if method == 'cloud_get':
        return {'data': base64.b64encode(remote.getvalue()).decode()}
    raise RuntimeError('unexpected ' + method)


class Closed(Exception):
    pass


def closed(code):
    raise Closed()


cloudsync.engine = fake_engine
real_exit, os._exit = os._exit, closed
item = {'id': 5, 'date': 1700000000, 'note': {'device': 'tv2', 'name': 'TV', 'fp': 'REMOTE'}}
try:
    answer = [False]
    check(cloudsync.take(item) is False and calls == [], 'declined: nothing is downloaded')
    check(cloudsync.state().get('declined') == 1700000000, 'declined copy is remembered')
    answer = [True]
    try:
        cloudsync.take(item)
        check(False, 'Kodi must close after a restore')
    except Closed:
        pass
finally:
    os._exit = real_exit
check(json.load(open(os.path.join(nova, 'iptv.json')))['m3u'] == ['http://from-the-other-device'], 'restored file in place')
check('os_key' in open(os.path.join(tele, 'settings.xml')).read(), 'engine settings restored')
check(not os.path.exists(os.path.join(PROFILE, 'evil.txt')) and not os.path.exists(os.path.join(USERDATA, 'keymaps')),
      'nothing outside add-on data is ever written')
st2 = cloudsync.state()
check(st2.get('applied') == 1700000000 and st2.get('applied_fp') == 'REMOTE', 'taken copy is remembered')
check(cloudsync.is_on(), 'a device that took the shared setup follows it from then on')
check(_Win.props.get('NovaTV.restoring') == '1', 'the service is told not to write over the restored files')
check(cloudsync.decide(st2, [item], 'whatever')[0] == 'none', 'the same copy is not offered again')
check(os.path.exists(os.path.join(tele, 'telegram.session')), 'the Telegram login of this device is untouched')

for b in bad:
    print('FAIL', b)
print('SERVICES TESTS OK' if not bad else 'SERVICES TESTS: %d problems' % len(bad))
import shutil
shutil.rmtree(PROFILE, ignore_errors=True)
sys.exit(1 if bad else 0)
