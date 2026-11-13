# -*- coding: utf-8 -*-
"""Inside the running Kodi: what does the build decide about the subtitles of a real Telegram file?
   python t_subs_kodi.py "<search text>" <seconds to watch> [name must contain]
Prints the verdict property, the active subtitle and the build's own log lines for that playback."""
import json, os, socket, sys, time
import tg_rpc

_id = [0]


def rpc(method, params=None, timeout=30):
    _id[0] += 1
    s = socket.create_connection(('127.0.0.1', 9090), 5)
    s.settimeout(timeout)
    s.sendall(json.dumps({'jsonrpc': '2.0', 'id': _id[0], 'method': method, 'params': params or {}}).encode('utf-8'))
    buf = b''
    try:
        while True:
            b = s.recv(65536)
            if not b:
                break
            buf += b
            try:
                for part in buf.decode('utf-8', 'replace').replace('}{', '}\n{').split('\n'):
                    d = json.loads(part)
                    if d.get('id') == _id[0]:
                        return d
            except ValueError:
                continue
    except socket.timeout:
        return {}
    finally:
        s.close()
    return {}


def main():
    query, watch = sys.argv[1], int(sys.argv[2])
    must = sys.argv[3] if len(sys.argv) > 3 else ''
    files = tg_rpc.call('raw_search', query=query, limit=60, timeout=60).get('result') or []
    files = [c for c in files if (c.get('file') or '').lower().endswith(('.mkv', '.mp4')) and must.lower() in (c.get('file') or '').lower()]
    files.sort(key=lambda c: c.get('size') or 0)
    if not files:
        print('no file for %r' % query)
        return 1
    c = files[0]
    log = os.path.join(os.environ['APPDATA'], 'Kodi', 'kodi.log')
    start = os.path.getsize(log)
    print('%s (%d MB)' % ((c.get('file') or '')[:80], (c.get('size') or 0) // 1048576))
    for p in rpc('Player.GetActivePlayers').get('result') or []:
        rpc('Player.Stop', {'playerid': p['playerid']})
    time.sleep(2)
    rpc('Player.Open', {'item': {'file': tg_rpc.stream_url(c['chat_id'], c['msg_id'], c.get('file') or 'video.mkv')}}, 60)
    t0 = time.time()
    seen = None
    while time.time() - t0 < watch:
        time.sleep(3)
        lab = (rpc('XBMC.GetInfoLabels', {'labels': ['Window(Home).Property(NovaTV.HebInside)']}).get('result') or {})
        v = lab.get('Window(Home).Property(NovaTV.HebInside)')
        if v != seen:
            seen = v
            print('  %3ds  HebInside = %r' % (time.time() - t0, v))
    pr = rpc('Player.GetProperties', {'playerid': 1, 'properties': ['subtitleenabled', 'currentsubtitle', 'subtitles']}).get('result') or {}
    cur = pr.get('currentsubtitle') or {}
    print('  subtitles on: %s | active: index %s lang %r name %r | tracks: %d' % (
        pr.get('subtitleenabled'), cur.get('index'), cur.get('language'), (cur.get('name') or '')[:30], len(pr.get('subtitles') or [])))
    box = rpc('Settings.GetSettingValue', {'setting': 'subtitles.backgroundtype'}).get('result', {}).get('value')
    op = rpc('Settings.GetSettingValue', {'setting': 'subtitles.bgopacity'}).get('result', {}).get('value')
    print('  subtitle background while playing: type %s, opacity %s' % (box, op))
    rpc('Player.Stop', {'playerid': 1})
    time.sleep(3)
    box2 = rpc('Settings.GetSettingValue', {'setting': 'subtitles.backgroundtype'}).get('result', {}).get('value')
    print('  subtitle background after the stop: type %s' % box2)
    with open(log, 'rb') as f:
        f.seek(start)
        text = f.read().decode('utf-8', 'replace')
    for line in text.splitlines():
        if ('[NovaTV]' in line and ('subtitle' in line.lower() or 'AI subs' in line or 'hard-coded' in line)) or 'BN guard' in line:
            print('   log: ' + line[11:23] + ' ' + line.split('<general>: ', 1)[-1][:190])
    return 0


if __name__ == '__main__':
    sys.exit(main())
