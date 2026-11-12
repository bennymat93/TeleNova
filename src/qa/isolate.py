"""Which add-on makes menus slow while / after a video plays? Switch services off one at a time and measure."""
import os, sys, time
sys.argv = ['x', '0', '0']
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'crawl.py'), encoding='utf-8').read().split('# listing actions')[0])
URL = 'https://kancdn.medonecdn.net/livehls/oil/kancdn-live/live/kan11/live.livx/playlist.m3u8'
VOD = sys.argv[-1] if False else None


def noop():
    t = time.time()
    rpc('Files.GetDirectory', {'directory': 'plugin://plugin.video.telescope/?mode=kids', 'media': 'files'}, 60)
    return time.time() - t


def measure(label, path):
    time.sleep(6)
    base = min(noop() for _ in range(3))
    rpc('Player.Open', {'item': {'file': path}}, 60)
    time.sleep(7)
    playing = [noop() for _ in range(3)]
    for p in rpc('Player.GetActivePlayers').get('result') or []:
        rpc('Player.Stop', {'playerid': p['playerid']})
    after = [noop() for _ in range(4)]
    print('%-34s idle %.1f | while playing %s | after stop %s' % (
        label, base, ' '.join('%.1f' % x for x in playing), ' '.join('%.1f' % x for x in after)), flush=True)


def enable(aid, on):
    rpc('Addons.SetAddonEnabled', {'addonid': aid, 'enabled': on})
    time.sleep(4)


video = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vid', 'C_english_only.mkv')
measure('everything on, live HLS', URL)
measure('everything on, local file', video)
for aid in ('service.subtitles.All_Subs', 'plugin.video.idanplus', 'script.fentastic.helper', 'plugin.video.youtube'):
    enable(aid, False)
    measure('without ' + aid.split('.')[-1] + ', live HLS', URL)
    enable(aid, True)
