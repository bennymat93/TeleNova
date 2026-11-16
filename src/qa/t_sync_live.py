# -*- coding: utf-8 -*-
"""Live: the continuous sync with the real account. A stand-in "second device" (a temp folder, empty settings) runs
the real loop against the account's document through the engine of the running Kodi:
  1. it must receive the users, the history and the settings without sending anything back,
  2. a search it adds must show up in Kodi's own search history within two rounds - with nobody touching Kodi,
  3. removing that search must travel too (the test leaves nothing behind).
Prints counts only, never values."""
import base64, importlib, io, json, os, shutil, sys, tempfile, time, types, zipfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
NOVA = os.path.join(HERE, '..', 'plugin.video.nova')
import tg_rpc

TMP = tempfile.mkdtemp(prefix='tn_dev2_')
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
    getAddonInfo=lambda k: {'profile': TMP, 'path': NOVA}.get(k, ''), getSetting=lambda k: '', setSetting=lambda k, v: None)
sys.modules['xbmcvfs'].translatePath = lambda p: p
sys.path.insert(0, NOVA)
users = importlib.import_module('resources.lib.users')
autosync = importlib.import_module('resources.lib.autosync')
KODI = os.path.join(os.environ['APPDATA'], 'Kodi', 'userdata', 'addon_data', 'plugin.video.nova')
TEXT = 'qa sync selftest %d' % int(time.time())
bad = []


class Dev2(object):
    def __init__(self):
        self.root, self.meta, self.files, self.sett = TMP, {}, {}, dict((a, {}) for a in autosync.ADDONS)
        self.applied = 0

    load_meta = lambda self: json.loads(json.dumps(self.meta))

    def save_meta(self, m):
        self.meta = json.loads(json.dumps(m))

    users = lambda self: users.store_users(self.root)
    set_users = lambda self, lst: users.store_set_users(self.root, lst)
    user_data = lambda self, uid: users.store_data(self.root, uid)
    put_user_data = lambda self, uid, data: users.store_put(self.root, uid, data)
    settings = lambda self, aid: dict(self.sett[aid])

    def set_setting(self, aid, k, v):
        self.sett[aid][k] = v
        self.applied += 1
        return True

    file = lambda self, name: self.files.get(name)

    def put_file(self, name, obj):
        self.files[name] = obj

    def _mine(self):
        for it in tg_rpc.call('cloud_list', timeout=60)['result'] or []:
            if (it.get('note') or {}).get('device') == autosync.DOC_DEVICE:
                return it
        return None

    def cloud_mark(self):
        it = self._mine()
        return '%s:%s' % (it['id'], it.get('date')) if it else ''

    def cloud_get(self):
        it = self._mine()
        raw = base64.b64decode(tg_rpc.call('cloud_get', timeout=120, id=it['id'])['result']['data'])
        return json.loads(zipfile.ZipFile(io.BytesIO(raw)).read('sync.json').decode('utf-8'))

    def cloud_put(self, doc):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('sync.json', json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
        res = tg_rpc.call('cloud_put', timeout=180, data=base64.b64encode(buf.getvalue()).decode('ascii'),
                          device=autosync.DOC_DEVICE, name='TeleNova sync', build='', fp='')['result']
        return '%s:%s' % (res.get('id'), res.get('date'))


def kodi_searches():
    try:
        return [s.get('q') for s in json.load(io.open(os.path.join(KODI, 'search_history.json'), encoding='utf-8'))]
    except (OSError, ValueError):
        return []


def wait_kodi(pred, seconds=240):
    t0 = time.time()
    while time.time() - t0 < seconds:
        if pred():
            return time.time() - t0
        time.sleep(5)
    return None


try:
    d = Dev2()
    r = autosync.cycle(d)
    data = users.store_data(TMP, users.store_current(TMP))
    print('second device, first round: fetched=%s uploaded=%s | users %d | history %d | favourites %d | settings received %d | files %s' % (
        r['pulled'], r['pushed'], len(users.store_live(TMP)), len(data['history']), len(data['favourites']), d.applied, sorted(d.files)))
    if not r['pulled'] or r['pushed']:
        bad.append('a new device must fetch and must not write: %r' % r)
    if not d.applied:
        bad.append('no settings arrived')
    # 2. a search made on the second device
    p = os.path.join(TMP, 'search_history.json')
    users._write(p, [{'q': TEXT, 'ts': int(time.time())}] + users._read(p, []))
    r = autosync.cycle(d)
    print('second device added a search: uploaded=%s' % r['pushed'])
    took = wait_kodi(lambda: TEXT in kodi_searches())
    print('Kodi has it in its own search history: %s' % ('after %.0f s' % took if took is not None else 'NOT within 4 minutes'))
    if took is None:
        bad.append('the change did not reach Kodi')
    # 3. remove it again - the removal must travel
    users._write(p, [s for s in users._read(p, []) if s.get('q') != TEXT])
    users.mark(TMP, 'searches_removed', TEXT)
    r = autosync.cycle(d)
    took = wait_kodi(lambda: TEXT not in kodi_searches())
    print('removed on the second device: gone from Kodi %s' % ('after %.0f s' % took if took is not None else 'NOT within 4 minutes'))
    if took is None:
        bad.append('the removal did not reach Kodi')
finally:
    shutil.rmtree(TMP, ignore_errors=True)
print('SYNC LIVE OK' if not bad else 'SYNC LIVE: %s' % bad)
sys.exit(1 if bad else 0)
