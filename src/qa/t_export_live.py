# -*- coding: utf-8 -*-
"""The ordinary and the full backup made from the REAL Kodi profile of this machine (read only), into a temp folder
that is removed at the end: how many files, how big, which add-ons count as "installed on top of the build", and
that nothing device-only or oversized slipped in. Kodi need not run. Prints names of add-ons and counts only."""
import importlib, io, os, shutil, sys, tempfile, time, types, zipfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
NOVA = os.path.join(HERE, '..', 'plugin.video.nova')
HOME = os.path.join(os.environ['APPDATA'], 'Kodi')
USERDATA = os.path.join(HOME, 'userdata')
TMP = tempfile.mkdtemp(prefix='tn_export_')
for name in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules[name] = types.ModuleType(name)
x = sys.modules['xbmc']
x.LOGINFO, x.LOGWARNING, x.LOGERROR, x.LOGDEBUG, x.ISO_639_1 = 1, 2, 3, 0, 0
skipped = []
x.log = lambda m, *a, **k: skipped.append(m) if 'backup skip' in m else None
x.getLanguage = lambda *a, **k: 'en'
x.getInfoLabel = lambda *a: ''
x.getCondVisibility = lambda c: False
x.Monitor = type('Monitor', (), {'abortRequested': lambda s: False, 'waitForAbort': lambda s, t=0: False})
sys.modules['xbmcaddon'].Addon = lambda *a: types.SimpleNamespace(
    getAddonInfo=lambda k: {'profile': os.path.join(USERDATA, 'addon_data', 'plugin.video.nova'), 'path': NOVA}.get(k, ''),
    getSetting=lambda k: '', setSetting=lambda k, v: None)
sys.modules['xbmcvfs'].translatePath = lambda p: p.replace('special://profile/', USERDATA + os.sep).replace(
    'special://home/', HOME + os.sep).replace('special://temp/', TMP + os.sep)
sys.path.insert(0, NOVA)
backup = importlib.import_module('resources.lib.backup')
bad = []
try:
    shipped = backup.build_addons()
    ex = backup.extras()
    print('build list: %s | add-ons installed on top of the build: %s' % ('%d add-ons' % len(shipped) if shipped else 'MISSING on this install', ex))
    for kind, full in (('ordinary', False), ('full', True)):
        path = os.path.join(TMP, kind + '.zip')
        t0 = time.time()
        n = backup.make_zip(path, full=full)
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            biggest = sorted(z.infolist(), key=lambda i: -i.file_size)[:3]
            tops = sorted(set(m.split('/')[1] for m in names if m.startswith('addon_data/')))
            addons = sorted(set(m.split('/')[1] for m in names if m.startswith('addons/')))
            if z.testzip():
                bad.append(kind + ': damaged zip')
        print('%-8s %4d files, %5.1f MB, %.1fs | data of %d add-on(s) | add-on folders: %s | biggest: %s' % (
            kind, n, os.path.getsize(path) / 1e6, time.time() - t0, len(tops), addons or '-',
            ', '.join('%s %.1f MB' % (os.path.basename(i.filename)[:28], i.file_size / 1e6) for i in biggest)))
        for m in names:
            if m.endswith(('sync_state.json', 'sync_meta.json', 'gdrive_token.json')) or '/packages/' in m or m.endswith('.pyc'):
                bad.append('%s: must not be in a backup: %s' % (kind, m))
        if any(a in (shipped or ()) or a in backup.OWN for a in addons):
            bad.append(kind + ': an add-on of the build is inside')
        if not full and addons:
            bad.append('the ordinary backup holds add-ons')
    print('files the backup could not read: %d' % len(skipped))
finally:
    shutil.rmtree(TMP, ignore_errors=True)
print('EXPORT LIVE OK' if not bad else 'EXPORT LIVE: %s' % bad[:5])
sys.exit(1 if bad else 0)
