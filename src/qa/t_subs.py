import sys, types, io, zipfile, os, ast
sys.path.insert(0, r'C:\My Projects\novaTV Addon\src\plugin.video.nova\resources\lib')
sys.path.insert(0, r'C:\My Projects\novaTV Addon\src\tools')
# --- 1. All_Subs guard v13 on the build's (already v12-patched) copy
import subspatch
p = r'C:\Users\benny\AppData\Local\Temp\claude\0df07f8c0e21f4a7\f8dd45ee-32ee-4d66-b008-da9e8aed6da8\scratchpad\allsubs_test\autosub.py'
before = open(p, encoding='utf-8').read()
print('v12 present before:', subspatch.MARK12 in before, '| v13 before:', subspatch.MARK13 in before)
print('apply ->', subspatch.apply(r'C:\Users\benny\AppData\Local\Temp\claude\0df07f8c0e21f4a7\f8dd45ee-32ee-4d66-b008-da9e8aed6da8\scratchpad\allsubs_test'), '| again ->', subspatch.apply(r'C:\Users\benny\AppData\Local\Temp\claude\0df07f8c0e21f4a7\f8dd45ee-32ee-4d66-b008-da9e8aed6da8\scratchpad\allsubs_test'))
after = open(p, encoding='utf-8').read()
ast.parse(after)
print('v13 after:', subspatch.MARK13 in after, '| compiles: True | getTime() > 1.5 gone:', 'getTime() > 1.5' not in after)
# run the generated function against fake players
src = after[after.index('def _bn_embedded_hebrew'):after.index('def _bn_same_video')]
import json
def run(subs, t=5.0):
    class P:
        def isPlayingVideo(self): return True
        def getTime(self): return t
        def getAvailableSubtitleStreams(self): return [s.get('language') for s in subs]
    class M:
        def abortRequested(self): return False
    x = types.SimpleNamespace(executeJSONRPC=lambda q: json.dumps({'result': {'subtitles': subs}}), sleep=lambda ms: None)
    g = {'_BN_PLAYER': P(), 'monit': M(), 'xbmc': x}
    exec(src, g); return g['_bn_embedded_hebrew']()
cases = [('heb code', [{'language': 'heb', 'name': ''}], True),
         ('und + name Hebrew', [{'language': 'und', 'name': 'Hebrew'}], True),
         ('empty + name in Hebrew letters', [{'language': '', 'name': u'\u05e2\u05d1\u05e8\u05d9\u05ea'}], True),
         ('he-IL', [{'language': 'he-IL', 'name': ''}], True),
         ('forced Hebrew only', [{'language': 'heb', 'name': 'Forced', 'isforced': True}], False),
         ('English only', [{'language': 'eng', 'name': 'English'}], False),
         ('name "Hebe" is not Hebrew', [{'language': 'eng', 'name': 'Hebe SDH'}], False),
         ('no tracks', [], False),
         ('eng + und/Heb', [{'language': 'eng', 'name': ''}, {'language': 'und', 'name': 'HEB'}], True)]
ok = True
for name, subs, want in cases:
    got = run(subs); ok &= got == want
    print('  %-32s -> %-5s %s' % (name, got, 'ok' if got == want else 'WRONG'))
# --- 2. the same rules in TeleNova's own module
sys.modules['xbmc'] = types.SimpleNamespace(executeJSONRPC=lambda q: '{}')
import subdetect
for name, subs, want in cases:
    got = subdetect.hebrew_index([dict(s, index=i) for i, s in enumerate(subs)]) >= 0
    ok &= got == want
print('subdetect agrees with the guard on all cases:', ok)
# --- 3. backup cleaner round trip on a synthetic encrypted profile
import nvp_clean
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w') as z:
    z.writestr('bn_backup.txt', 'x'); z.writestr('addon_data/plugin.video.nova/settings.xml', '<s/>')
    z.writestr('addon_data/plugin.video.pov/settings.xml', '<s/>' * 500); z.writestr('addon_data/pvr.iptvsimple/settings.xml', '<s/>')
    z.writestr('favourites.xml', '<favourites>\n    <favourite name=\"a\">RunAddon(plugin.video.idanplus)</favourite>\n    <favourite name=\"b\">RunAddon(\"plugin.video.otaku\")</favourite>\n</favourites>')
blob = nvp_clean.encrypt('test-pass-1', buf.getvalue())
print('wrong password rejected:', nvp_clean.decrypt('nope', blob) is None)
new, kept, dropped = nvp_clean.clean(nvp_clean.decrypt('test-pass-1', blob), {'plugin.video.nova'})
names = zipfile.ZipFile(io.BytesIO(new)).namelist()
print('kept:', names); print('dropped:', sorted(dropped))
print('build add-ons read from package:', len(nvp_clean.build_addons()))
