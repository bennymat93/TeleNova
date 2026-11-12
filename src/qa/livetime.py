import os, sys, time
sys.argv = ['x', '0', '0']
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'crawl.py'), encoding='utf-8').read().split('# listing actions')[0])


def stop():
    for p in rpc('Player.GetActivePlayers').get('result') or []:
        rpc('Player.Stop', {'playerid': p['playerid']})
    time.sleep(3)


for label, path in (('menu (noop)', None), ('live resolver kan11 (plugin, direct)', 'plugin://plugin.video.nova/?a=live&ch=kan11'),
                    ('same again', 'plugin://plugin.video.nova/?a=live&ch=kan11'),
                    ('direct stream URL', 'https://kancdn.medonecdn.net/livehls/oil/kancdn-live/live/kan11/live.livx/playlist.m3u8')):
    if path is None:
        t = time.time(); rpc('Files.GetDirectory', {'directory': 'plugin://plugin.video.nova/?a=noop', 'media': 'files'})
        print('%-40s %.1fs' % (label, time.time() - t)); continue
    stop()
    t = time.time()
    rpc('Player.Open', {'item': {'file': path}}, 60)
    ok = False
    while time.time() - t < 40:
        if rpc('Player.GetActivePlayers').get('result'):
            ok = True; break
        time.sleep(0.3)
    print('%-40s %.1fs %s' % (label, time.time() - t, '' if ok else 'NOT STARTED'))
stop()
