import glob, os, re, sqlite3, sys
sys.stdout.reconfigure(encoding='utf-8')
st = sys.argv[1]
X = os.path.join(st, 'addons', 'skin.fentastic', 'xml')
rd = lambda p: open(p, encoding='utf-8').read()
print('=== widget files')
for f in sorted(glob.glob(os.path.join(X, 'script-fentastic-*.xml'))):
    print('  ', os.path.basename(f), os.path.getsize(f))
for name in ('script-fentastic-widget_movies.xml', 'script-fentastic-main_menu_custom3.xml'):
    print('===', name)
    for l in rd(os.path.join(X, name)).splitlines():
        print('  ', l.rstrip()[:220])
print('=== DialogVideoInfo embuary')
for i, l in enumerate(rd(os.path.join(X, 'DialogVideoInfo.xml')).splitlines(), 1):
    if 'embuary' in l and 'InstallAddon' in l:
        print('  ', i, l.strip()[:200])
for lang in ('he_il', 'en_gb'):
    po = rd(os.path.join(st, 'addons', 'skin.fentastic', 'language', 'resource.language.' + lang, 'strings.po'))
    for sid in ('700050', '700051', '700053', '700061'):
        m = re.search(r'msgctxt "#%s"\s*\nmsgid "(.*?)"\s*\nmsgstr "(.*?)"' % sid, po)
        print('  ', lang, sid, m.groups() if m else None)
v = rd(os.path.join(X, 'Variables.xml')).splitlines()
for i, l in enumerate(v):
    if 'CurrentSearchProviderVar' in l:
        print('=== Variables', i + 1)
        for x in v[i:i + 8]:
            print('  ', x.strip())
for i, l in enumerate(rd(os.path.join(X, 'Custom_1132_ExtendedInfo.xml')).splitlines(), 1):
    if 'pov' in l.lower() and '<label' in l.lower():
        print('   ExtendedInfo', i, l.strip())
print('=== cpath db')
c = sqlite3.connect(os.path.join(st, 'userdata', 'addon_data', 'script.fentastic.helper', 'cpath_cache.db'))
print([r[1] for r in c.execute('pragma table_info(custom_paths)')])
for r in c.execute('select * from custom_paths'):
    print('  ', [str(x)[:95] for x in r])
print('=== skin settings of interest')
for l in rd(os.path.join(st, 'userdata', 'addon_data', 'skin.fentastic', 'settings.xml')).splitlines():
    if re.search(r'mdblist|firsttimerun|MenuCustom|IdanPlus|current_search|homemenuno', l):
        print('  ', l.strip()[:150])
print('=== guisettings of interest')
for l in rd(os.path.join(st, 'userdata', 'guisettings.xml')).splitlines():
    if re.search(r'esallinterfaces|devicename|deviceuuid|confirmchannelswitch|subtitles\.charset|autoplaynextitem|locale\.audiolanguage|webserverauthentication', l):
        print('  ', l.strip()[:150])
print('=== fonts'); print('  ', rd(os.path.join(st, 'media', 'fonts', 'fontcache.xml'))[:900])
print('=== advancedsettings'); print(rd(os.path.join(st, 'userdata', 'advancedsettings.xml')))
