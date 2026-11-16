# -*- coding: utf-8 -*-
"""4.1.0: the full backup (every add-on's data + the add-ons installed on top of the build) and the restore of the
personal content into any user. No Kodi."""
import importlib, io, json, os, shutil, sys, tempfile, types, zipfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
NOVA = os.path.join(HERE, '..', 'plugin.video.nova')
TMP = tempfile.mkdtemp(prefix='tn_bk_')
HOME = os.path.join(TMP, 'home')
USERDATA = os.path.join(HOME, 'userdata')
PROFILE = os.path.join(USERDATA, 'addon_data', 'plugin.video.nova')
for name in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules[name] = types.ModuleType(name)
x = sys.modules['xbmc']
x.LOGINFO, x.LOGWARNING, x.LOGERROR, x.LOGDEBUG, x.ISO_639_1 = 1, 2, 3, 0, 0
x.log = lambda *a, **k: None
x.getLanguage = lambda *a, **k: 'en'
x.getInfoLabel = lambda *a: ''
x.getCondVisibility = lambda c: False
built = []
x.executebuiltin = lambda c: built.append(c)
rpc = []
x.executeJSONRPC = lambda s: rpc.append(json.loads(s)) or '{}'
x.Monitor = type('Monitor', (), {'abortRequested': lambda s: False, 'waitForAbort': lambda s, t=0: False})
sys.modules['xbmcaddon'].Addon = lambda *a: types.SimpleNamespace(
    getAddonInfo=lambda k: {'profile': PROFILE, 'path': NOVA}.get(k, ''), getSetting=lambda k: '', setSetting=lambda k, v: None)
sys.modules['xbmcvfs'].translatePath = lambda p: p.replace('special://profile/', USERDATA + os.sep).replace(
    'special://home/', HOME + os.sep).replace('special://temp/', TMP + os.sep)
g = sys.modules['xbmcgui']
said = []
g.Dialog = lambda: types.SimpleNamespace(ok=lambda *a: said.append(a), yesno=lambda *a, **k: True)
g.Window = lambda *a: types.SimpleNamespace(setProperty=lambda k, v: None, clearProperty=lambda k: None, getProperty=lambda k: '')
sys.path.insert(0, NOVA)
bad = []


def check(cond, what):
    if not cond:
        bad.append(what)


def put(path, text='x'):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(text)


# a Kodi home: the build's add-ons, two extras, data of several add-ons
for aid in ('plugin.video.nova', 'plugin.video.telescope', 'skin.fentastic', 'plugin.video.youtube', 'plugin.video.extra1', 'script.extra2'):
    put(os.path.join(HOME, 'addons', aid, 'addon.xml'), '<addon id="%s"/>' % aid)
put(os.path.join(HOME, 'addons', 'plugin.video.extra1', 'lib', 'code.py'), 'print(1)')
put(os.path.join(HOME, 'addons', 'plugin.video.extra1', 'lib', '__pycache__', 'code.pyc'), 'junk')
put(os.path.join(HOME, 'addons', 'packages', 'some.zip'), 'zip')
put(os.path.join(USERDATA, 'novatv_addons.txt'), 'plugin.video.nova\nplugin.video.telescope\nskin.fentastic\nplugin.video.youtube\n')
put(os.path.join(PROFILE, 'settings.xml'), '<settings/>')
put(os.path.join(PROFILE, 'history.json'), json.dumps([{'key': 'theirs1', 'ts': 50, 'when': '01/11/2026 10:00'}, {'key': 'both', 'ts': 10}]))
put(os.path.join(PROFILE, 'favourites.json'), json.dumps([{'kind': 'movie', 'id': 7, 'label': 'Seven', 'added': '01/11/2026 10:00'}]))
put(os.path.join(PROFILE, 'favourites_removed.json'), json.dumps([{'kind': 'movie', 'id': 99, 'removed': '05/11/2026 10:00'}]))
put(os.path.join(PROFILE, 'search_history.json'), json.dumps([{'q': 'dune', 'ts': 70}]))
put(os.path.join(PROFILE, 'sync_meta.json'), '{}')
put(os.path.join(USERDATA, 'addon_data', 'plugin.video.extra1', 'settings.xml'), '<settings><setting id="k">v</setting></settings>')
put(os.path.join(USERDATA, 'addon_data', 'script.other', 'data.json'), '{}')
put(os.path.join(USERDATA, 'addon_data', 'script.other', 'cache', 'big.bin'), 'cache')
put(os.path.join(USERDATA, 'favourites.xml'), '<favourites/>')
backup = importlib.import_module('resources.lib.backup')
users = importlib.import_module('resources.lib.users')

check(backup.extras() == ['plugin.video.extra1', 'script.extra2'], 'the add-ons installed on top of the build: %r' % backup.extras())
check(backup.extras(['a.b.c', 'plugin.video.nova'], shipped=None) == backup.extras(['a.b.c', 'plugin.video.nova']), 'default list')
check(backup.extras(['x.y.z'], shipped=set()) == [], 'an install without the build list has no "extras" (nothing is guessed)')
std, full = os.path.join(TMP, 'std.zip'), os.path.join(TMP, 'full.zip')
backup.make_zip(std)
backup.make_zip(full, full=True)
zs, zf = set(zipfile.ZipFile(std).namelist()), set(zipfile.ZipFile(full).namelist())
check('addons/plugin.video.extra1/addon.xml' not in zs and backup.MANIFEST not in zs, 'the ordinary backup holds no add-ons')
check({'addons/plugin.video.extra1/addon.xml', 'addons/plugin.video.extra1/lib/code.py', 'addons/script.extra2/addon.xml',
       'addon_data/plugin.video.extra1/settings.xml', 'addon_data/script.other/data.json', backup.MANIFEST} <= zf, 'the full one: extras + every add-on\'s data')
check(not any('pycache' in m or m.startswith('addons/plugin.video.nova') or m.startswith('addons/packages') or '/cache/' in m for m in zf),
      'no build add-ons, no caches, no compiled files')
check(not any(m.endswith(('sync_meta.json', 'sync_state.json')) for m in zf | zs), 'what belongs to this device is in no backup')
check(zs <= zf, 'the full backup holds everything the ordinary one holds')

A = backup.allowed_addon_member
ship = {'plugin.video.nova', 'skin.fentastic'}
want = {'plugin.video.extra1', 'skin.fentastic', 'plugin.video.nova', '..', 'x'}
check(A('addons/plugin.video.extra1/lib/code.py', want, ship), 'an extra the backup lists')
for m in ('addons/plugin.video.nova/default.py', 'addons/skin.fentastic/xml/Home.xml', 'addons/plugin.video.telescope/service.py',
          'addons/other.addon/x.py', 'addons/plugin.video.extra1/../../userdata/x', 'addons/../x/y', 'addons/plugin.video.extra1/',
          'addon_data/x/y', 'addons/x/y.py'):
    check(not A(m, want, ship), 'must be refused: ' + m)

# restore on another device (same build): extras come back and are switched on at the next start
shutil.rmtree(os.path.join(HOME, 'addons', 'plugin.video.extra1'))
shutil.rmtree(os.path.join(HOME, 'addons', 'script.extra2'))
shutil.rmtree(os.path.join(USERDATA, 'addon_data', 'plugin.video.extra1'))
evil = os.path.join(TMP, 'evil.zip')
with zipfile.ZipFile(full) as src, zipfile.ZipFile(evil, 'w') as dst:
    for m in src.namelist():
        dst.writestr(m, src.read(m))
    dst.writestr('addons/plugin.video.nova/default.py', 'EVIL')
    dst.writestr('addons/not.listed/addon.xml', 'EVIL')
    dst.writestr('keymaps/evil.xml', 'EVIL')
with zipfile.ZipFile(evil) as z:
    done, skipped = backup.extract(z)
check(os.path.exists(os.path.join(HOME, 'addons', 'plugin.video.extra1', 'lib', 'code.py')) and
      os.path.exists(os.path.join(USERDATA, 'addon_data', 'plugin.video.extra1', 'settings.xml')), 'the extra add-on and its data are back')
check(not os.path.exists(os.path.join(HOME, 'addons', 'plugin.video.nova', 'default.py')) and
      not os.path.exists(os.path.join(HOME, 'addons', 'not.listed')) and not os.path.exists(os.path.join(USERDATA, 'keymaps')),
      'a build add-on is never replaced, an unlisted add-on and other folders are never written')
check(json.load(open(backup.ENABLE_FILE)) == ['plugin.video.extra1', 'script.extra2'], 'remembered for the next start')
check(backup.enable_restored() == 2 and built == ['UpdateLocalAddons'] and
      [r['params'] for r in rpc] == [{'addonid': 'plugin.video.extra1', 'enabled': True}, {'addonid': 'script.extra2', 'enabled': True}] and
      not os.path.exists(backup.ENABLE_FILE), 'switched on once, after the restart')
check(backup.enable_restored() == 0, 'nothing to do the second time')

# the personal content of a backup into ANOTHER user
kid = users.store_create(PROFILE, 'Kids', now=5)
users.store_switch(PROFILE, kid)
users._write(os.path.join(PROFILE, 'history.json'), [{'key': 'mine', 'ts': 90}, {'key': 'both', 'ts': 80}])
users._write(os.path.join(PROFILE, 'favourites.json'), [{'kind': 'movie', 'id': 99, 'label': 'Kept', 'added': '02/11/2026 10:00'}])
backup.restore_personal(std)
got = users.store_data(PROFILE, kid)
check([h['key'] for h in got['history']] == ['mine', 'both', 'theirs1'] and got['history'][1]['ts'] == 80, 'history merged, the later watch kept: %r' % got['history'])
check(sorted(f['id'] for f in got['favourites']) == [7, 99], 'their favourites are added; their removals do not delete mine: %r' % got['favourites'])
check([s['q'] for s in got['searches']] == ['dune'], 'searches added')
check(users.store_data(PROFILE, 'u1')['history'][0]['key'] == 'theirs1', 'the other user here is untouched')
check(said and 'Kids' in said[-1][1], 'the viewer is told which user received it')
for k, v in backup.STR.items():
    check(len(v) == 3 and all(v) and len(set(t.count('%') for t in v)) == 1, 'string %s in three languages' % k)

for b in bad:
    print('FAIL', b)
print('BACKUP FULL TESTS OK' if not bad else 'BACKUP FULL TESTS: %d problems' % len(bad))
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if bad else 0)
