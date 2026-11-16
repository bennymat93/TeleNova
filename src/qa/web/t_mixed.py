# -*- coding: utf-8 -*-
"""Kodi devices and browsers on ONE account: the build's real loop (autosync.cycle + users.store_*, as in
qa/t_autosync.py) and the browser's real loop (web/websync.js + web/store.js, run in Node) share one stand-in
document. What must hold: everybody ends with the same users and lists, the browser never touches a setting, and
when nobody changes anything nobody writes - the two implementations must agree to the byte, or they would upload
"corrections" to each other for ever.

  python t_mixed.py          (run by run_web_tests.py)"""
import copy, importlib, io, json, os, shutil, subprocess, sys, tempfile, types

if __name__ == '__main__':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
NOVA = os.path.normpath(os.path.join(HERE, '..', '..', 'plugin.video.nova'))
TMP = tempfile.mkdtemp(prefix='tn_mixed_')
for name in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules.setdefault(name, types.ModuleType(name))
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
CLOUD = os.path.join(TMP, 'cloud.json')
NODE = shutil.which('node')
bad = []


def check(cond, what):
    if not cond:
        bad.append(what)


def cloud():
    try:
        with open(CLOUD, encoding='utf-8') as f:
            return json.load(f)
    except OSError:
        return {'n': 0, 'doc': None}


class Kodi(object):
    """the host autosync.cycle talks to (qa/t_autosync.py Device), with the document in the shared file"""

    def __init__(self, name):
        self.name, self.root = name, os.path.join(TMP, name)
        os.makedirs(self.root)
        self.sett = {'plugin.video.nova': {'tmdb_key': '', 'gemini_key': '', 'content_lang': '0', 'debug': 'false', 'sub_server': ''},
                     'plugin.video.telescope': {'rd_token': '', 'rd_enabled': 'true', 'port': '65220'}}
        self.meta, self.files = {}, {}

    def load_meta(self):
        return copy.deepcopy(self.meta)

    def save_meta(self, m):
        self.meta = json.loads(json.dumps(m))

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
        c = cloud()
        return '' if c['doc'] is None else 'v%d' % c['n']

    def cloud_get(self):
        return json.loads(cloud()['doc'])

    def cloud_put(self, doc):
        c = cloud()
        with open(CLOUD, 'w', encoding='utf-8') as f:      # the text exactly as autosync.KodiHost.cloud_put writes it
            json.dump({'n': c['n'] + 1, 'doc': json.dumps(doc, ensure_ascii=False, separators=(',', ':')), 'by': self.name}, f)
        return 'v%d' % (c['n'] + 1)

    def watch(self, key, ts):
        p = os.path.join(self.root, 'history.json')
        h = [e for e in users._read(p, []) if e['key'] != key]
        h.insert(0, {'key': key, 'label': key, 'when': '16/11/2026 18:00', 'ts': ts, 'play': 'plugin://plugin.video.nova/?a=play&m=movie&id=1',
                     'plot': 'עלילה 😀', 'thumb': '', 'fanart': ''})
        users._write(p, h)

    def cycle(self, now):
        return autosync.cycle(self, now)

    def history(self, uid=None):
        return [e['key'] for e in users.store_data(self.root, uid or users.store_current(self.root))['history']]

    def canon(self):
        d = self.meta['last_doc']
        return syncdoc.canon([d['users'], d['data']])


class Browser(object):
    def __init__(self, name):
        self.name, self.last = name, {}

    def cycle(self, now, *actions):
        p = subprocess.run([NODE, os.path.join(HERE, 't_mixed_browser.js'), TMP, self.name, str(now), json.dumps(actions)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out = json.loads(p.stdout.decode('utf-8') or '{"error": "no output"}')
        if 'error' in out:
            raise SystemExit('FAIL browser %s: %s %s' % (self.name, out['error'], p.stderr.decode('utf-8', 'replace')))
        self.last = out
        return out['res']

    def history(self):
        return self.last['history']

    def canon(self):
        return self.last['canon']


def idle(devs, t, what):
    """a few rounds of everybody with no change anywhere: the document must not be written"""
    n = cloud()['n']
    for i in range(3):
        for d in devs:
            d.cycle(t + i)
    c = cloud()
    check(c['n'] == n, '%s: idle devices kept writing the document (%d -> %d, last by %s)' % (what, n, c['n'], c.get('by')))
    return t + 3


def main():
    T = 1794812400                                   # 16/11/2026
    K1, W1 = Kodi('K1'), Browser('W1')
    r = W1.cycle(T, ['watch', 'movie:603', 'plugin://plugin.video.nova/?a=play&m=movie&id=603&q=The+Matrix'])
    check(r['state'] == 'nodoc' and cloud()['doc'] is None, 'a browser does not found the document: %r' % r)
    K1.sett['plugin.video.nova'].update(tmdb_key='KEY-K1', content_lang='1', debug='true')
    K1.sett['plugin.video.telescope']['rd_token'] = 'RD-K1'
    K1.files['iptv.json'] = {'m3u': ['http://list']}
    K1.watch('movie:1', T - 500.25)                  # times as the hub writes them: floats
    K1.watch('movie:2', float(T - 400))              # ... sometimes whole ones
    r = K1.cycle(T + 1)
    check(r['pushed'], 'the Kodi device founds the document')
    founded = json.loads(cloud()['doc'])
    r = W1.cycle(T + 2)
    check(r['pulled'] and r['pushed'] and W1.history() == ['movie:603', 'movie:2', 'movie:1'], 'the browser joins: takes the lists, adds its own: %r %r' % (r, W1.history()))
    check(W1.last['taken'] == {'tmdb_key': 'KEY-K1', 'content_lang': '1'}, 'and reads the TMDb key: %r' % W1.last['taken'])
    after = json.loads(cloud()['doc'])
    check(syncdoc.canon(after['settings']) == syncdoc.canon(founded['settings']) and syncdoc.canon(after['files']) == syncdoc.canon(founded['files']),
          'the browser\'s upload carries the settings and files untouched')
    r = K1.cycle(T + 3)
    check(r['pulled'] and not r['pushed'] and K1.history() == ['movie:603', 'movie:2', 'movie:1'] and r['applied'] == 0,
          'Kodi takes the browser\'s entry and has nothing to correct: %r %r' % (r, K1.history()))
    check(K1.canon() == W1.canon(), 'Kodi and the browser hold the same users and lists, to the byte')
    t = idle([K1, W1], T + 10, 'after joining')

    # a second browser and a second Kodi device
    W2, K2 = Browser('W2'), Kodi('K2')
    r = W2.cycle(t)
    check(r['pulled'] and not r['pushed'], 'a second browser writes nothing: %r' % r)
    r = K2.cycle(t + 1)
    check(K2.sett['plugin.video.nova']['tmdb_key'] == 'KEY-K1' and K2.sett['plugin.video.telescope']['rd_token'] == 'RD-K1' and
          K2.files.get('iptv.json') == {'m3u': ['http://list']} and K2.history() == ['movie:603', 'movie:2', 'movie:1'],
          'a new Kodi device still receives the founder\'s whole setup after browsers wrote the document')
    check(K2.sett['plugin.video.nova']['debug'] == 'false', 'device-only settings stay on their device')
    t = idle([K1, W1, W2, K2], t + 5, 'four devices')

    # everybody changes something at the same time
    K1.watch('movie:3', t + 0.5)
    K2.sett['plugin.video.nova']['gemini_key'] = 'GEM-K2'
    kids = users.store_create(K2.root, 'Kids', now=t)
    W1.cycle(t + 1, ['watch', 'tv:1399'], ['fav', 'movie', '603', 'The Matrix'], ['search', 'פאודה'], ['user', 'סבתא 😀'])
    W2.cycle(t + 2, ['watch', 'ch:kan11', 'https://kan/playlist.m3u8'], ['fav', 'radio', 'uuid-1', 'Radio', 'https://s/1'], ['unfav', 'radio', 'uuid-1'], ['search', 'dune'], ['unsearch', 'dune'])
    for i in range(3):
        for d in (K1, K2, W1, W2):
            d.cycle(t + 10 + i)
    canons = set([K1.canon(), K2.canon(), W1.canon(), W2.canon()])
    check(len(canons) == 1, 'after changes on all four, everybody holds the same users and lists (%d different)' % len(canons))
    check(set(K2.history('u1')) == {'movie:603', 'movie:2', 'movie:1', 'movie:3', 'ch:kan11', 'tv:1399'} and K1.history('u1') == K2.history('u1'), 'histories of all four: %r' % K1.history('u1'))
    names = [u['name'] for u in users.store_live(K1.root)]
    check(names == ['', 'Kids', 'סבתא 😀'], 'users made on Kodi and in a browser: %r' % names)
    favs = users.store_data(K1.root, 'u1')['favourites']
    check([(f['kind'], f['id']) for f in favs] == [('movie', '603')] and
          [(r_['kind'], r_['id']) for r_ in users.store_data(K1.root, 'u1')['removed']] == [('radio', 'uuid-1')], 'favourites and removal marks of the browsers reach Kodi: %r' % favs)
    check([s['q'] for s in users.store_data(K2.root, 'u1')['searches']] == ['פאודה'], 'searches too, a removed one stays gone')
    check(K1.sett['plugin.video.nova']['gemini_key'] == 'GEM-K2', 'a setting changed on one Kodi device reaches the other through documents browsers rewrote')
    check(K1.sett['plugin.video.nova']['debug'] == 'true' and K2.sett['plugin.video.nova']['debug'] == 'false', 'device-only settings untouched')
    check(W1.last['current'] != 'u1' and W2.last['current'] == 'u1' and users.store_current(K2.root) == 'u1', 'the active user is each device\'s own choice')
    t = idle([K1, K2, W1, W2], t + 20, 'after the changes')

    # clearing on Kodi, deleting a user in a browser
    users._write(os.path.join(K1.root, 'history.json'), [])
    users.mark(K1.root, 'history_cleared', now=t)
    W2.cycle(t + 1, ['delete_user', 'Kids'])
    for i in range(3):
        for d in (K1, K2, W1, W2):
            d.cycle(t + 5 + i)
    check(K2.history('u1') == [] and W2.history() == [], 'a history cleared on Kodi is cleared in the browsers')
    check(kids not in [u['id'] for u in users.store_live(K1.root)] and not os.path.isdir(os.path.join(K2.root, 'users', kids)), 'a user deleted in a browser is gone on Kodi')
    W1.cycle(t + 10, ['switch', 'u1'], ['watch', 'movie:7'])
    for d in (K1, K2, W2, W1, K1):
        d.cycle(t + 12)
    check(K1.history('u1') == ['movie:7'] and len(set([K1.canon(), K2.canon(), W1.canon(), W2.canon()])) == 1, 'new entries after the clearing travel: %r' % K1.history('u1'))
    idle([K1, K2, W1, W2], t + 20, 'at the end')
    check(len(cloud()['doc']) > 0 and syncdoc.same(syncdoc.merge(json.loads(cloud()['doc']), None), json.loads(cloud()['doc'])), 'the document is in normal form')

    shutil.rmtree(TMP, ignore_errors=True)
    for b in bad:
        print('FAIL', b)
    print('KODI + BROWSER TESTS OK (%d writes of the document in all)' % cloud_n if not bad else 'KODI + BROWSER TESTS: %d problems' % len(bad))
    return 1 if bad else 0


if __name__ == '__main__':
    try:
        cloud_n = 0
        _real = cloud

        def cloud():                                 # remembers the count for the last line (the folder is removed before it is printed)
            global cloud_n
            c = _real()
            cloud_n = max(cloud_n, c['n'])
            return c
        sys.exit(main())
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
