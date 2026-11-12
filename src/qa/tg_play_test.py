# -*- coding: utf-8 -*-
"""Real playback of a Telegram file inside the running Kodi (account logged in): start time, stalls, seeks.
   python tg_play_test.py ["search text"] [min MB] [seconds to watch]
A stall = the player's clock stands still while it is not paused. Prints numbers and the file name only."""
import json, socket, sys, time
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
        return {'timeout': True}
    finally:
        s.close()
    return {}


def secs(t):
    return t['hours'] * 3600 + t['minutes'] * 60 + t['seconds'] + t['milliseconds'] / 1000.0


def state():
    r = rpc('Player.GetProperties', {'playerid': 1, 'properties': ['time', 'totaltime', 'speed', 'percentage']}).get('result')
    if not r:
        return None
    return secs(r['time']), secs(r['totaltime']), r['speed']


def watch(seconds, label):
    """-> (longest stall, total stalled) while the clock should run"""
    last_t, last_wall, stall, worst, total = None, time.time(), 0.0, 0.0, 0.0
    end = time.time() + seconds
    while time.time() < end:
        st = state()
        now = time.time()
        if st is None:
            print('  %s: player closed' % label)
            return None
        t, _, speed = st
        if last_t is not None and speed == 1 and abs(t - last_t) < 0.05:
            stall += now - last_wall
            worst = max(worst, stall)
            total += now - last_wall
        else:
            stall = 0.0
        last_t, last_wall = t, now
        time.sleep(0.25)
    print('  %-26s %3ds watched | longest stall %.1fs | stalled in total %.1fs' % (label, seconds, worst, total))
    return worst, total


def wait_moving(limit=40):
    t0 = time.time()
    first = None
    while time.time() - t0 < limit:
        st = state()
        if st and st[2] == 1:
            if first is None or not (-1 < st[0] - first < 30):
                first = st[0]
            elif 0.4 < st[0] - first < 30:          # the clock runs (a jump itself moves it by minutes)
                return time.time() - t0
        time.sleep(0.15)
    return None


def main():
    query = sys.argv[1] if len(sys.argv) > 1 else 'breaking bad s01e01'
    min_mb = int(sys.argv[2]) if len(sys.argv) > 2 else 900
    look = int(sys.argv[3]) if len(sys.argv) > 3 else 40
    files = tg_rpc.call('raw_search', query=query, limit=60, timeout=60).get('result') or []
    files = sorted([c for c in files if (c.get('size') or 0) > min_mb * 1048576], key=lambda c: c['size'])
    if not files:
        print('no file found')
        return 1
    c = files[0]
    mbps = (c['size'] * 8 / 1e6 / c['duration']) if c.get('duration') else 0
    print('%s  (%d MB, %.1f Mbit/s)' % ((c.get('file') or '')[:70], c['size'] // 1048576, mbps))
    url = tg_rpc.stream_url(c['chat_id'], c['msg_id'], c.get('file') or 'video.mkv')
    f0 = tg_rpc.call('status')['result']
    for p in rpc('Player.GetActivePlayers').get('result') or []:
        rpc('Player.Stop', {'playerid': p['playerid']})
    time.sleep(1)
    t = time.time()
    rpc('Player.Open', {'item': {'file': url}}, 60)
    started = wait_moving(60)
    print('  picture runs after %s' % ('%.1fs' % (time.time() - t) if started is not None else 'NOT STARTED in 60s'))
    if started is None:
        return 1
    bad = 0
    r = watch(look, 'from the start')
    for pct in (35, 70, 20):
        t = time.time()
        rpc('Player.Seek', {'playerid': 1, 'value': {'percentage': pct}}, 30)
        moved = wait_moving(40)
        print('  jump to %d%%: picture runs again after %s' % (pct, ('%.1fs' % (time.time() - t)) if moved is not None else 'NOT in 40s'))
        r2 = watch(max(15, look // 2), 'after the jump to %d%%' % pct)
        if moved is None or r2 is None or r2[0] > 3:
            bad += 1
    if '--keep' not in sys.argv:
        rpc('Player.Stop', {'playerid': 1})
    st = tg_rpc.call('status')['result']['stream']
    print('  engine: %d MB cached, hits %d, misses %d' % (st['cached_mb'], st['hits'] - f0['stream']['hits'], st['miss'] - f0['stream']['miss']))
    print('PLAY TEST %s' % ('OK' if not bad and r and r[0] <= 3 else 'PROBLEMS'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
