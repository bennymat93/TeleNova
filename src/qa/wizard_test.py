# -*- coding: utf-8 -*-
"""Runs the TeleNova wizard outside Kodi against the packaged build (stub Kodi modules, a temp Kodi home)."""
import glob, hashlib, json, os, pathlib, runpy, shutil, sys, types

ROOT, SCRATCH = sys.argv[1], sys.argv[2]
wiz = os.path.join(ROOT, 'src', 'plugin.program.novawizard', 'default.py')
parts = sorted(glob.glob(os.path.join(ROOT, 'build', 'TeleNova-*.zip.part*')))
real = json.load(open(os.path.join(ROOT, 'build.json')))
info = dict(real, parts=[pathlib.Path(p).as_uri() for p in parts])
info['url'] = info['parts'][0]
info_path = os.path.join(SCRATCH, 'wiz_build.json')
json.dump(info, open(info_path, 'w'))


def run(choice, plat):
    home = os.path.join(SCRATCH, 'wiz_home')
    shutil.rmtree(home, ignore_errors=True)
    for d in ('addons/plugin.video.pov', 'addons/plugin.video.useraddon', 'addons/plugin.program.novawizard',
              'addons/plugin.video.telemedia', 'addons/pvr.iptvsimple',
              'userdata/addon_data/plugin.video.nova', 'userdata/addon_data/plugin.video.pov', 'userdata/Database', 'temp'):
        os.makedirs(os.path.join(home, d))
    w = lambda rel, text: open(os.path.join(home, rel), 'w', encoding='utf-8').write(text)
    w('addons/plugin.program.novawizard/addon.xml', '<addon id="plugin.program.novawizard" version="RUNNING"/>')
    w('addons/plugin.video.pov/addon.xml', '<addon id="plugin.video.pov"/>')
    w('addons/plugin.video.useraddon/addon.xml', '<addon id="plugin.video.useraddon"/>')
    w('addons/plugin.video.telemedia/addon.xml', '<addon id="plugin.video.telemedia"/>')
    w('addons/pvr.iptvsimple/addon.xml', '<addon id="pvr.iptvsimple"><platform>%s</platform></addon>' % ('android-aarch64' if plat == 'android' else 'windows-x86_64'))
    w('userdata/favourites.xml', '<favourites><favourite name="MINE">x</favourite></favourites>')
    w('userdata/addon_data/plugin.video.nova/history.json', '["my history"]')
    w('userdata/addon_data/plugin.video.pov/settings.xml', '<s/>')
    w('userdata/myfile.txt', 'mine')
    msgs = []

    class Dialog:
        def ok(self, *a): msgs.append(' '.join(str(x) for x in a))
        def select(self, *a): return choice
    class Progress:
        def create(self, *a): pass
        def update(self, *a): pass
        def iscanceled(self): return False
        def close(self): pass
    class Addon:
        def getAddonInfo(self, k): return 'plugin.program.novawizard'
    sys.modules['xbmc'] = types.SimpleNamespace(
        getLanguage=lambda *a: 'en', ISO_639_1=0, LOGWARNING=2, log=lambda m, l=0: msgs.append('LOG ' + m),
        getCondVisibility=lambda c: c == {'android': 'System.Platform.Android', 'windows': 'System.Platform.Windows'}[plat])
    sys.modules['xbmcaddon'] = types.SimpleNamespace(Addon=Addon)
    sys.modules['xbmcgui'] = types.SimpleNamespace(Dialog=Dialog, DialogProgress=Progress)
    sys.modules['xbmcvfs'] = types.SimpleNamespace(
        translatePath=lambda p: os.path.join(home, '' if p == 'special://home/' else 'temp') + os.sep)
    src = open(wiz, encoding='utf-8').read().replace("'https://bennymat93.github.io/TeleNova/build.json'", repr(pathlib.Path(info_path).as_uri()))
    exits = []
    real_exit = os._exit
    os._exit = lambda code: (_ for _ in ()).throw(SystemExit(code))
    try:
        exec(compile(src, wiz, 'exec'), {'__name__': '__main__'})
    except SystemExit as e:
        exits.append(e.code)
    finally:
        os._exit = real_exit
    ex = lambda rel: os.path.exists(os.path.join(home, rel))
    rd = lambda rel: open(os.path.join(home, rel), encoding='utf-8').read()
    name = ('update' if choice == 0 else 'fresh') + '/' + plat
    checks = [
        ('finished and asked Kodi to close', exits == [1]),
        ('no error dialog', not any('Error' in m or 'corrupt' in m for m in msgs)),
        ('build add-ons installed (TeleNova, engine, skin)', ex('addons/plugin.video.nova/default.py') and ex('addons/plugin.video.telescope/resources/bin/win-x64/tnige.dll') and ex('addons/skin.fentastic/addon.xml')),
        ('running wizard not overwritten', 'RUNNING' in rd('addons/plugin.program.novawizard/addon.xml')),
        ('POV add-on removed', not ex('addons/plugin.video.pov')),
        ('temp download removed', not ex('temp/novatv_build.zip')),
    ]
    if choice == 0:
        checks += [('update keeps the viewer\'s Kodi favourites', 'MINE' in rd('userdata/favourites.xml')),
                   ('update keeps TeleNova history', 'my history' in rd('userdata/addon_data/plugin.video.nova/history.json')),
                   ('update keeps other userdata files', ex('userdata/myfile.txt')),
                   ('update keeps Telemedia', ex('addons/plugin.video.telemedia'))]
    else:
        checks += [('fresh install replaces favourites', 'MINE' not in rd('userdata/favourites.xml')),
                   ('fresh install removes old userdata files', not ex('userdata/myfile.txt')),
                   ('fresh install removes old add-on settings', not ex('userdata/addon_data/plugin.video.pov'))]
    if plat == 'android':
        checks += [('Android: the device\'s own TV add-on kept (not the Windows one)', 'android' in rd('addons/pvr.iptvsimple/addon.xml')),
                   ('Android: Windows inputstream not installed', not ex('addons/inputstream.adaptive'))]
    else:
        checks += [('Windows: binary add-ons from the build', ex('addons/inputstream.adaptive/addon.xml'))]
    bad = [c for c, ok in checks if not ok]
    print('%-16s %d checks, %d failed %s' % (name, len(checks), len(bad), bad or ''))
    for m in msgs:
        if m.startswith('LOG'):
            print('   ', m[:150])
    shutil.rmtree(home, ignore_errors=True)
    return not bad


ok = all([run(0, 'windows'), run(1, 'windows'), run(0, 'android'), run(1, 'android')])
print('WIZARD TESTS', 'PASSED' if ok else 'FAILED')
