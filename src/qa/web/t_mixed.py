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
                     'plugin.video.telescope': {'rd_token': '', 'rd_enabled': 'true', 'port': '65220', 'gemini_key': '', 'stremio_servers': '',
                                                'session_string': ''}}
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


def doc_text():
    return cloud()['doc'] or ''


def rounds(devs, t, n=2):
    for i in range(n):
        for d in devs:
            d.cycle(t + i)
    return t + n


def peers(K1, K2, W1, W2, t):
    """6.2.0: browsers with a settings port are full peers - twins both ways, the join rule, device-only keys, no session"""
    tele, nova = 'plugin.video.telescope', 'plugin.video.nova'
    K1.sett[tele]['gemini_key'] = 'GEM-K1T'
    K1.sett[tele]['session_string'] = 'KODI-SESSION-XYZ'
    t = rounds([K1, K2, W1, W2], t)
    check('KODI-SESSION-XYZ' not in doc_text(), 'a Kodi Telegram session never enters the document')

    # a fresh browser with its own values joins: it never overwrites the account (join rule), it takes the account's
    P1 = Browser('P1')
    P1.cycle(t, ['cfg', 'tmdb', 'TMDB-P1'], ['cfg', 'gemini_key', 'GEM-P1'], ['put', 'rd_token', 'RD-P1'], ['cfg', 'theme', 'dark'])
    t = rounds([K1, K2, P1], t + 5)
    check(K1.sett[nova]['tmdb_key'] == 'KEY-K1' and K2.sett[nova]['tmdb_key'] == 'KEY-K1', 'join rule: a fresh browser does not overwrite tmdb_key: %r' % K1.sett[nova]['tmdb_key'])
    check(K1.sett[tele]['rd_token'] == 'RD-K1' and K1.sett[tele]['gemini_key'] == 'GEM-K1T', 'join rule: rd_token / gemini_key kept: %r %r' % (K1.sett[tele]['rd_token'], K1.sett[tele]['gemini_key']))
    check(P1.last['cfg'].get('tmdb') == 'KEY-K1' and P1.last['stores'].get('rd_token') == 'RD-K1', 'the joining browser takes the account\'s values: %r %r' % (P1.last['cfg'].get('tmdb'), P1.last['stores'].get('rd_token')))
    check(P1.last['cfg'].get('gemini_key') in ('GEM-K1T', 'GEM-K2'), 'the joining browser takes the account\'s gemini key: %r' % P1.last['cfg'].get('gemini_key'))
    check(P1.last['cfg'].get('theme') == 'dark', 'the browser keeps its device-only theme')

    # browser edits -> Kodi
    P1.cycle(t, ['cfg', 'gemini_key', 'GEM-P1B'], ['put', 'rd_token', 'RD-P1B'], ['put', 'iptv_own', [{'name': 'L', 'url': 'https://iptv.example/a.m3u'}]],
             ['put', 'sources_addons', ['https://addon.example/manifest.json']], ['cfg', 'lang', 'he'], ['cfg', 'debug', True], ['cfg', 'port', 9],
             ['cfg', 'lite', True], ['put', 'tg_session', 'WEB-SESSION-XYZ'], ['cfg', 'tg_auth_key', 'WEB-AUTHKEY-XYZ'])
    t = rounds([K1, K2, P1], t + 20)
    for K in (K1, K2):
        check(K.sett[tele]['gemini_key'] == 'GEM-P1B' and K.sett[nova]['gemini_key'] == 'GEM-P1B', '%s: browser gemini_key (and its mirror) reach Kodi: %r %r' % (K.name, K.sett[tele]['gemini_key'], K.sett[nova]['gemini_key']))
        check(K.sett[tele]['rd_token'] == 'RD-P1B', '%s: browser RD token reaches Kodi: %r' % (K.name, K.sett[tele]['rd_token']))
        check(K.sett[tele]['stremio_servers'] == 'https://addon.example/manifest.json', '%s: browser stremio servers reach Kodi: %r' % (K.name, K.sett[tele]['stremio_servers']))
        m3u = (K.files.get('iptv.json') or {}).get('m3u') or []
        check([e.get('url') for e in m3u if isinstance(e, dict)] == ['https://iptv.example/a.m3u'], '%s: browser IPTV source reaches Kodi: %r' % (K.name, K.files.get('iptv.json')))
        check(K.sett[tele]['port'] == '65220' and 'lite' not in K.sett[nova], '%s: device-only keys never change from a browser' % K.name)
    check(K1.sett[nova]['debug'] == 'true' and K2.sett[nova]['debug'] == 'false', 'debug stays each Kodi device\'s own: %r %r' % (K1.sett[nova]['debug'], K2.sett[nova]['debug']))
    text = doc_text()
    low = text.lower()
    check('session' not in low and 'auth_key' not in low and 'authkey' not in low and 'XYZ' not in text, 'the decoded document never holds a session / auth key')
    web = json.loads(text)['settings'].get('web') or {}
    check(isinstance(web.get('lang'), list) and web['lang'][0] == 'he', 'browser-only settings ride in section "web": %r' % web.get('lang'))
    check(not any(k in web for k in ('debug', 'port', 'lite', 'theme')), 'section "web" holds no device-only key: %r' % sorted(web))

    # Kodi edits -> browser
    K2.sett[tele].update(gemini_key='GEM-K2B', rd_token='RD-K2B', stremio_servers='https://kodi.example/manifest.json')
    K2.files['iptv.json'] = {'m3u': [{'name': 'K', 'url': 'https://kodi.example/l.m3u', 'extra': 1}], 'epg': [], 'free': {'x': 1}}
    t = rounds([K2, K1, P1], t + 5)
    c, s = P1.last['cfg'], P1.last['stores']
    check(c.get('gemini_key') == 'GEM-K2B' and s.get('rd_token') == 'RD-K2B', 'Kodi gemini_key / RD token reach the browser: %r %r' % (c.get('gemini_key'), s.get('rd_token')))
    check(s.get('sources_addons') == ['https://kodi.example/manifest.json'], 'Kodi stremio servers reach the browser: %r' % s.get('sources_addons'))
    check([e.get('url') for e in s.get('iptv_own') or []] == ['https://kodi.example/l.m3u'], 'Kodi IPTV source reaches the browser: %r' % s.get('iptv_own'))
    check(K1.files.get('iptv.json', {}).get('free') == {'x': 1} and K1.files['iptv.json']['m3u'][0].get('extra') == 1, 'unknown iptv.json fields survive: %r' % K1.files.get('iptv.json'))
    check(c.get('debug') is True and c.get('port') == 9, 'the browser\'s own device-only keys untouched')

    # the "web" section survives Kodi round trips, a second fresh browser receives it
    K1.sett[nova]['tmdb_key'] = 'KEY-K1B'
    t = rounds([K1, K2, K1, K2], t + 5)
    web = json.loads(doc_text())['settings'].get('web') or {}
    check(isinstance(web.get('lang'), list) and web['lang'][0] == 'he', 'section "web" survives Kodi rewrites: %r' % web.get('lang'))
    P2 = Browser('P2')
    P2.cycle(t, ['cfg', 'lang', 'en'])
    t = rounds([P2, K1, P1, P2], t + 1)
    check(P2.last['cfg'].get('lang') == 'he' and P2.last['cfg'].get('tmdb') == 'KEY-K1B' and P1.last['cfg'].get('tmdb') == 'KEY-K1B',
          'a new browser gets section "web" and the twins, never overwriting them: %r %r' % (P2.last['cfg'].get('lang'), P2.last['cfg'].get('tmdb')))
    check('session' not in doc_text().lower(), 'still no session at the end')
    t = websync_fixes(K1, K2, P1, P2, t + 5)
    idle([K1, K2, W1, W2, P1, P2], t + 5, 'with settings peers')


def poke_doc(fn):
    """change the account's document as another (broken) device would"""
    c = cloud()
    doc = json.loads(c['doc'])
    fn(doc)
    with open(CLOUD, 'w', encoding='utf-8') as f:
        json.dump({'n': c['n'] + 1, 'doc': json.dumps(doc, ensure_ascii=False, separators=(',', ':')), 'by': 'poke'}, f)


def websync_fixes(K1, K2, P1, P2, t):
    """6.2.0 regressions of web/websync.js: (D) skewed stamps, (E) join vs a cleared value, (F) deletions, (G) bn_synced, (H) okJson"""
    tele, nova = 'plugin.video.telescope', 'plugin.video.nova'
    # (G) only the allowlist reaches the page's synced map: no token / refresh / secret / password
    K1.sett[tele].update(rd_refresh='REF-XYZ', some_secret='SEC-XYZ', trakt_token='TOK-XYZ', web_password='PW-XYZ')
    t = rounds([K1, P1], t)
    taken = P1.last['taken'] or {}
    check(set(taken) <= {'tmdb_key', 'tmdb_token', 'content_lang', 'gemini_key', 'gemini_model', 'os_key', 'opensubs_key', 'chiko_keywords', 'pinned_chats', 'bots'},
          '(G) bn_synced is an allowlist: %r' % sorted(taken))
    check('XYZ' not in json.dumps(taken) and 'rd_token' not in taken, '(G) no secret in bn_synced')

    # (D) one skewed key (a year ahead) does not inflate the stamp of another key written here
    far = t + 365 * 86400
    poke_doc(lambda d: d['settings'][nova].__setitem__('content_lang', [d['settings'][nova]['content_lang'][0], far]))
    P1.cycle(t, ['cfg', 'gemini_key', 'GEM-P1D'])
    pair = json.loads(doc_text())['settings'][tele]['gemini_key']
    check(pair[0] == 'GEM-P1D' and pair[1] < t + 3600, '(D) a browser edit is stamped by its own clock, not the skewed key: %r' % pair)
    t = rounds([K1, K2, P1, P2], t + 5)

    # (F) a deletion in the browser reaches Kodi
    P1.cycle(t, ['put', 'sources_addons', ['https://del.example/manifest.json']])
    t = rounds([K1, K2, P1], t + 5)
    check(K1.sett[tele]['stremio_servers'] == 'https://del.example/manifest.json', '(F) setup: the list reached Kodi: %r' % K1.sett[tele]['stremio_servers'])
    P1.cycle(t, ['put', 'sources_addons', None])
    t = rounds([K1, K2, P1], t + 5)
    for K in (K1, K2):
        check(K.sett[tele]['stremio_servers'] == '', '(F) %s: a list deleted in the browser is cleared in Kodi: %r' % (K.name, K.sett[tele]['stremio_servers']))

    # (E) a value cleared on purpose in Kodi is not resurrected by a browser that joins holding it
    K2.sett[tele]['gemini_key'] = ''
    K2.sett[nova]['gemini_key'] = ''
    t = rounds([K2, K1], t + 5)
    P3 = Browser('P3')
    P3.cycle(t, ['cfg', 'gemini_key', 'GEM-OLD'])
    t = rounds([K1, K2, P3], t + 5)
    check(K1.sett[tele]['gemini_key'] == '' and K2.sett[tele]['gemini_key'] == '', '(E) a cleared key stays cleared: %r' % K1.sett[tele]['gemini_key'])
    check(P3.last['cfg'].get('gemini_key') == '', '(E) the joining browser takes the cleared value: %r' % P3.last['cfg'].get('gemini_key'))

    # (H) section "web" values in a wrong shape are not taken
    poke_doc(lambda d: d['settings']['web'].update(lang=['xx', t + 50], helper=['http://plain.example', t + 50], junk_obj=[{'a': 1}, t + 50]))
    P1.cycle(t + 60)
    c = P1.last['cfg']
    check(c.get('lang') == 'he' and c.get('helper') != 'http://plain.example' and 'junk_obj' not in c, '(H) okJson rejects bad web values: %r' % c)
    t = rounds([K1, K2, P1, P2, P3], t + 70)
    return t


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
    peers(K1, K2, W1, W2, t + 40)

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
