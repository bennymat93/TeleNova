import os, re, sys, glob
sys.stdout.reconfigure(encoding='utf-8')
st = sys.argv[1]
g = open(os.path.join(st, 'userdata', 'guisettings.xml'), encoding='utf-8').read()
pat = re.compile(r'<setting id="([^"]+)"( default="true")?>([^<]*)</setting>')
print('=== guisettings: non-default values in the areas that matter')
for sid, dflt, val in pat.findall(g):
    if dflt:
        continue
    if sid.startswith(('filecache.', 'videoplayer.', 'videoscreen.', 'audiooutput.', 'epg.', 'pvr', 'addons.', 'general.',
                       'lookandfeel.', 'debug.', 'services.', 'screensaver.', 'powermanagement.', 'input.', 'weather.',
                       'locale.', 'videolibrary.', 'musiclibrary.', 'network.', 'myvideos.', 'cache.', 'eventlog.', 'pictures.')):
        print('  %-46s %s' % (sid, val[:60]))
for a in ('inputstream.adaptive', 'pvr.iptvsimple', 'plugin.video.youtube'):
    for p in glob.glob(os.path.join(st, 'userdata', 'addon_data', a, '*settings*.xml')):
        print('=== %s / %s' % (a, os.path.basename(p)))
        t = open(p, encoding='utf-8').read()
        for sid, dflt, val in pat.findall(t):
            if not dflt and val and not re.search(r'key|token|secret|pass', sid, re.I):
                print('  %-46s %s' % (sid, val[:70]))
print('=== addon_data folders:', sorted(os.listdir(os.path.join(st, 'userdata', 'addon_data'))))
