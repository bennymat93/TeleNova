import json
import os
import sys
import tempfile
import time
import types

ROOT = r'C:\My Projects\novaTV Addon\src\plugin.video.nova'
PROF = tempfile.mkdtemp(prefix='novatest_')
PROPS = {}


class Any(object):
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, n):
        return lambda *a, **k: ''


class Win(Any):
    def getProperty(self, k):
        return PROPS.get(k, '')

    def setProperty(self, k, v):
        PROPS[k] = v

    def clearProperty(self, k):
        PROPS.pop(k, None)


class Addon(Any):
    def getAddonInfo(self, k):
        return PROF if k == 'profile' else ROOT

    def getSetting(self, k):
        return ''


class Mon(Any):
    def waitForAbort(self, t=0):
        return False

    def abortRequested(self):
        return False


for name in ('xbmc', 'xbmcgui', 'xbmcaddon', 'xbmcvfs', 'xbmcplugin'):
    sys.modules[name] = types.ModuleType(name)
x = sys.modules['xbmc']
x.LOGINFO, x.LOGWARNING, x.LOGERROR, x.ISO_639_1 = 1, 2, 3, 0
x.getLanguage = lambda *a: 'en'
x.log = lambda *a: None
x.Monitor = Mon
x.getCondVisibility = lambda *a: False
x.getInfoLabel = lambda *a: ''
x.executebuiltin = lambda *a: None
x.executeJSONRPC = lambda *a: '{}'
sys.modules['xbmcgui'].Window = Win
sys.modules['xbmcgui'].ListItem = Any
sys.modules['xbmcgui'].Dialog = Any
sys.modules['xbmcaddon'].Addon = Addon
sys.modules['xbmcvfs'].translatePath = lambda p: p
sys.path.insert(0, ROOT)
from resources.lib import common, epmatch, yt, radio, iptv, livebar, providers   # noqa

R = []


def check(name, cond):
    R.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name)


# ---------------- epmatch
m = epmatch.mentions
check('shield', m("Marvel's Agents of S.H.I.E.L.D.", "Marvel's Agents of SHIELD S02E05 720p"))
check('shield dotted', m("Marvel's Agents of S.H.I.E.L.D.", 'Marvel Agents.of.S.H.I.E.L.D. S02E05'))
check('law & order', m('Law and Order', 'Law & Order S01E02'))
check('law & order rev', m('Law & Order', 'Law and Order S01E02'))
check('two words need both', not m('Breaking Bad', 'Breaking News S01E02'))
check('one word', not m('Lost', 'Found S01E01') and m('Lost', 'Lost S01E01'))
check('5 words 4 ok', m('alpha beta gamma delta epsilon', 'alpha beta gamma delta'))
check('5 words 3 not', not m('alpha beta gamma delta epsilon', 'alpha beta gamma'))
check('3 words need 3', not m('game of thrones winter', 'game thrones'))   # game thrones winter -> need 3 (ceil 2.4)
check('hebrew', m('הבורר', 'הבורר עונה 2 פרק 5') and not m('הבורר', 'פאודה עונה 2 פרק 5'))
check('description', m('Fauda', 'S01E01', 'Fauda season one'))
check('filter_items', len(epmatch.filter_items((2, 5), [{'label': 'Law & Order S02E05'}, {'label': 'Other S02E05'}],
                                              show='Law and Order')) == 1)

# ---------------- load / save
check('missing -> default', common.load('nope.json', [1]) == [1])
common.save('favourites.json', [{'id': 1}])
check('no bak on first save', not os.path.exists(os.path.join(PROF, 'favourites.json.bak')))
common.save('favourites.json', [{'id': 1}, {'id': 2}])
check('bak holds previous', json.load(open(os.path.join(PROF, 'favourites.json.bak'), encoding='utf-8')) == [{'id': 1}])
check('roundtrip', common.load('favourites.json', []) == [{'id': 1}, {'id': 2}])
open(os.path.join(PROF, 'favourites.json'), 'w').write('{broken')
t = time.time()
check('corrupt -> bak', common.load('favourites.json', []) == [{'id': 1}])
check('retry took ~0.1s', 0.08 < time.time() - t < 1)
common.save('favourites.json', [{'id': 3}])
check('corrupt file never becomes bak', json.load(open(os.path.join(PROF, 'favourites.json.bak'), encoding='utf-8')) == [{'id': 1}])
common.save('cachefile.json', {'a': 1})
common.save('cachefile.json', {'a': 2})
check('no bak for caches', not os.path.exists(os.path.join(PROF, 'cachefile.json.bak')))
open(os.path.join(PROF, 'x.json'), 'w').write('{broken')
check('corrupt, no bak -> default', common.load('x.json', 'D') == 'D')
check('no tmp left', not [f for f in os.listdir(PROF) if f.endswith('.tmp')])
# PermissionError retry
real = os.replace
calls = []


def flaky(a, b):
    calls.append(1)
    if len(calls) < 3:
        raise PermissionError('locked')
    return real(a, b)


os.replace = flaky
common.save('history.json', [1])
os.replace = real
check('replace retried', len(calls) == 3 and common.load('history.json', []) == [1])


def never(a, b):
    raise PermissionError('locked')


os.replace = never
try:
    common.save('history.json', [2])
    raised = False
except PermissionError:
    raised = True
os.replace = real
check('final failure raises, tmp removed, data kept', raised and common.load('history.json', []) == [1]
      and not [f for f in os.listdir(PROF) if f.endswith('.tmp')])

# ---------------- tmdb cache
import requests   # noqa


class Resp(object):
    def __init__(self, data, code=200):
        self.data, self.status_code, self.headers = data, code, {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError('boom https://api/x?api_key=SECRET')

    def json(self):
        return self.data


class Sess(object):
    def __init__(self):
        self.n, self.fail, self.kw = 0, False, None

    def get(self, url, **kw):
        self.n += 1
        self.kw = kw
        if self.fail:
            raise requests.ConnectionError('down')
        return Resp({'n': self.n})


S = Sess()
common._SESSION = S
check('tmdb net', common.tmdb('/x') == {'n': 1} and S.kw['timeout'] == (4, 10))
check('tmdb cached', common.tmdb('/x') == {'n': 1} and S.n == 1)
cdir = os.path.join(PROF, 'cache')
cf = os.path.join(cdir, os.listdir(cdir)[0])
open(cf, 'w').write('{half')
check('tmdb corrupt cache -> network', common.tmdb('/x') == {'n': 2})
os.utime(cf, (1, 1))
S.fail = True
check('tmdb stale on failure', common.tmdb('/x') == {'n': 2})
try:
    common.tmdb('/never')
    ok = False
except requests.ConnectionError:
    ok = True
check('tmdb raises with no cache', ok)
check('tmdb no tmp left', not [f for f in os.listdir(cdir) if f.endswith('.tmp')])

# ---------------- yt._cached
n = [0]


def boom(*a, **k):
    n[0] += 1
    raise requests.ConnectionError('down')


yt._post = boom
t = time.time()
res = yt.search('some query')
el = time.time() - t
check('yt.search offline: [] with 2 posts, no sleep (%.2fs, %d posts)' % (el, n[0]), res == [] and n[0] == 2 and el < 0.5)
n[0] = 0
t = time.time()
res = yt.search_videos('abc')
el = time.time() - t
check('yt top-level: 2 tries, 1 sleep (%.2fs)' % el, res == [] and n[0] == 2 and 0.9 < el < 1.6)
n[0] = 0
yt._post = lambda *a, **k: (n.__setitem__(0, n[0] + 1), {})[1]
t = time.time()
check('yt empty answer: no retry', yt.search_videos('zzz') == [] and n[0] == 1 and time.time() - t < 0.5)
check('yt depth reset', getattr(yt._DEPTH, 'n', 0) == 0)

# ---------------- radio._get
seq = []


def rget(url, **kw):
    seq.append(kw.get('timeout'))
    if len(seq) == 1:
        return Resp({'error': 'x'})
    return Resp([{'name': 'A', 'url': 'http://a', 'stationuuid': 'u1', 'junk': 'x' * 100, 'favicon': ''}, 'bad'])


requests.get = rget
d = radio._get('/stations/topvote/100')
check('radio: object answer skipped, list slimmed', d == [{'stationuuid': 'u1', 'name': 'A', 'url': 'http://a'}]
      and seq[0] == (3, 6) and len(seq) == 2)
raw = open(os.path.join(PROF, 'radio_cache.json'), encoding='utf-8').read()
check('radio cache compact', '\n' not in raw.strip())
seq[:] = []
check('radio fresh cache used', radio._get('/stations/topvote/100') == d and not seq)
c = common.load('radio_cache.json', {})
c['/bad?x'] = {'error': 1}
common.save('radio_cache.json', c)

# ---------------- iptv.check_streams
open(iptv.MERGED_M3U, 'w', encoding='utf-8').write('#EXTM3U\nhttp://v1/a\nhttp://v2/a\nhttp://v3/a\n')
common.save(iptv.FAIL_FILE, {'http://h1/a': 2, 'http://h2/a': 5, 'http://v3/a': 1})
alive = {'http://v1/a', 'http://v2/a', 'http://h1/a'}
probed = []


def pf(u):
    probed.append(u)
    return u in alive


r = iptv.check_streams(probe_fn=pf)
f = common.load(iptv.FAIL_FILE, {})
check('hidden probed, revived cleared, others counted (ret %s, %s)' % (r, f),
      r == 2 and f == {'http://h2/a': 6, 'http://v3/a': 2} and set(probed) == {'http://v1/a', 'http://v2/a', 'http://v3/a', 'http://h1/a', 'http://h2/a'})
common.save(iptv.FAIL_FILE, dict(('http://h%d/a' % i, 2) for i in range(400)))
probed[:] = []
iptv.check_streams(probe_fn=pf)
check('hidden bounded to 150', len([u for u in probed if '//h' in u]) == 150)
# connection down: nothing recorded
common.save(iptv.FAIL_FILE, {'http://h1/a': 2})
check('connection down: not counted', iptv.check_streams(probe_fn=lambda u: False) == 0
      and common.load(iptv.FAIL_FILE, {}) == {'http://h1/a': 2})
# atomic write
iptv._write_atomic(iptv.MERGED_M3U, 'hello\n')
check('atomic write', open(iptv.MERGED_M3U).read() == 'hello\n' and not [x for x in os.listdir(PROF) if x.endswith('.tmp')])
os.replace = never
iptv._write_atomic(iptv.MERGED_M3U, 'again\n')
os.replace = real
check('atomic write falls back in place', open(iptv.MERGED_M3U).read() == 'again\n'
      and not [x for x in os.listdir(PROF) if x.endswith('.tmp')])
# own prompt
x.getInfoLabel = lambda k: {'Control.GetLabel(1)': 'Add-ons', 'Control.GetLabel(9)': 'To continue[CR]PVR IPTV Simple Client[CR]download?'}.get(k, '')
check('prompt match by name', iptv._own_prompt('pvr.iptvsimple', 'PVR IPTV Simple Client', 100))
check('prompt other dialog refused', not iptv._own_prompt('pvr.iptvsimple', 'Other Thing', 1))
x.getInfoLabel = lambda k: ''
check('prompt unreadable: 20 s window', iptv._own_prompt('a.b', 'N', 5) and not iptv._own_prompt('a.b', 'N', 25))

# ---------------- livebar
heads = []


def head(u, **kw):
    heads.append(u)
    r = Resp(None)
    r.headers = {'Content-Type': 'image/png'}
    return r


requests.head = head
check('img first', livebar.images_ok(['http://i/1', 'http://i/2']) == {'http://i/1': True, 'http://i/2': True} and len(heads) == 2)
livebar._IMG_OK.clear()                      # a new interpreter
check('img from window property', livebar.images_ok(['http://i/1', 'http://i/3'])['http://i/1'] and len(heads) == 3)

# ---------------- providers memo
opens = [0]
ro = providers.load
providers.load = lambda *a: (opens.__setitem__(0, opens[0] + 1), ro(*a))[1]
providers.forget()
for _ in range(30):
    providers.is_on('youtube')
    providers.telegram_on()
check('providers.json read once', opens[0] == 1)
providers.installed = lambda a: False
providers.toggle('youtube')
check('toggle invalidates', providers.is_on('youtube') is False and common.load('providers.json', {}) == {'youtube': False})
providers.set_all(True)
check('set_all invalidates', providers.is_on('youtube') is True)

print('\n%d passed, %d failed' % (sum(1 for _, ok in R if ok), sum(1 for _, ok in R if not ok)))
