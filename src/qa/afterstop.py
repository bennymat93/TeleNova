import os, sys, time
sys.argv = ['x', '0', '0']
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'crawl.py'), encoding='utf-8').read().split('# listing actions')[0])
URL = 'https://kancdn.medonecdn.net/livehls/oil/kancdn-live/live/kan11/live.livx/playlist.m3u8'


def noop():
    t = time.time()
    rpc('Files.GetDirectory', {'directory': 'plugin://plugin.video.nova/?a=noop', 'media': 'files'}, 60)
    return time.time() - t


print('idle baseline: %s' % ['%.1f' % noop() for _ in range(3)])
for rnd in range(2):
    rpc('Player.Open', {'item': {'file': URL}}, 60)
    time.sleep(8)
    print('while playing: %.1f' % noop())
    for p in rpc('Player.GetActivePlayers').get('result') or []:
        rpc('Player.Stop', {'playerid': p['playerid']})
    t0 = time.time()
    out = []
    while time.time() - t0 < 22:
        at = time.time() - t0
        out.append('%.0fs:%.1f' % (at, noop()))
        time.sleep(1)
    print('after stop (time since stop : duration of a menu call):', ' '.join(out))
