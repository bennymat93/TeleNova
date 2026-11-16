# -*- coding: utf-8 -*-
"""The services screen rules, the browser command and the All_Subs Ktuvit patch (4.0.4). The sync that
followed 4.0.4's is tested in t_syncdoc.py / t_autosync.py, the backup in t_backup_full.py. No Kodi, no network."""
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

# ---- 2. the texts of the sync / backup menu
for k, v in cloudsync.STR.items():
    check(len(v) == 3 and all(v), 'sync string %s in three languages' % k)
m = cloudsync.settings_map('<settings version="2"><setting id="a">1</setting><setting id="b" default="true" />'
                           '<setting id="c" value="x" /></settings>')
check(m == {'a': '1', 'b': '', 'c': 'x'}, 'both settings.xml formats: %r' % m)

# ---- 3. the browser command
check(weblink.command('https://x.y/a', 'win32') == ('startfile', 'https://x.y/a'), 'windows')
check(weblink.command('https://x.y/a', 'darwin') == ('exec', ['open', 'https://x.y/a']), 'mac')
check(weblink.command('https://x.y/a', 'linux') == ('exec', ['xdg-open', 'https://x.y/a']), 'linux')
check(weblink.command('https://x.y/a"b', 'linux', android=True)[1].count('"') == 2, 'android: no quote can end the argument')
check(weblink.command('file:///etc/passwd', 'linux') is None and weblink.command('javascript:1', 'win32') is None,
      'only web addresses are ever opened')
check(all(u.startswith('https://') for u in weblink.PAGES.values()), 'every page is https')

nova = os.path.join(USERDATA, 'addon_data', 'plugin.video.nova')

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

for b in bad:
    print('FAIL', b)
print('SERVICES TESTS OK' if not bad else 'SERVICES TESTS: %d problems' % len(bad))
import shutil
shutil.rmtree(PROFILE, ignore_errors=True)
sys.exit(1 if bad else 0)
