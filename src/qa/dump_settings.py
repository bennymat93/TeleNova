"""Current values (and Kodi's own defaults / options) of the settings that matter for smooth playback, from the running Kodi."""
import os, sys, json
sys.argv = ['x', '0', '0']
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'crawl.py'), encoding='utf-8').read().split('# listing actions')[0])
sys.stdout.reconfigure(encoding='utf-8')
r = rpc('Settings.GetSettings', {'level': 'expert'}, 60)
allset = {s['id']: s for s in (r.get('result') or {}).get('settings', [])}
print('settings known to this Kodi:', len(allset))
want = ('filecache.', 'videoplayer.', 'videoscreen.', 'audiooutput.', 'epg.', 'pvrmanager.', 'pvrplayback.', 'pvrmenu.',
        'addons.', 'general.addon', 'lookandfeel.', 'subtitles.', 'debug.', 'network.', 'services.', 'locale.audio',
        'locale.subtitle', 'videolibrary.updateonstartup', 'musiclibrary.updateonstartup', 'weather.', 'screensaver.',
        'powermanagement.', 'input.', 'myvideos.', 'filelists.', 'cache.', 'system.playlistspath', 'eventlog.')
for sid in sorted(allset):
    if not sid.startswith(want):
        continue
    s = allset[sid]
    val, dflt = s.get('value'), s.get('default')
    extra = ''
    if 'options' in s:
        extra = ' opts=' + ','.join(str(o.get('value')) for o in s['options'])[:70]
    elif 'minimum' in s:
        extra = ' range=%s..%s' % (s.get('minimum'), s.get('maximum'))
    mark = '   ' if val == dflt else ' * '
    print('%s%-48s = %-22s default %-14s%s' % (mark, sid, json.dumps(val, ensure_ascii=False)[:22], json.dumps(dflt, ensure_ascii=False)[:14], extra))
