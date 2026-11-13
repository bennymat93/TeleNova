# -*- coding: utf-8 -*-
"""Plays the licensed-failover channels (livefail.CHANNELS) one after another in the running Kodi and reports which
start. Usage: t_live_keys.py [key ...]   (no keys: every key of the table)"""
import io, json, os, re, socket, sys, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))


def rpc(method, params=None, timeout=30):
    s = socket.create_connection(('127.0.0.1', 9090), timeout=5)
    s.settimeout(timeout)
    s.sendall(json.dumps({'jsonrpc': '2.0', 'id': 7, 'method': method, 'params': params or {}}).encode())
    buf, dec = b'', json.JSONDecoder()
    try:
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
            txt, pos = buf.decode('utf-8', 'ignore'), 0
            while pos < len(txt):
                try:
                    obj, end = dec.raw_decode(txt, pos)
                except ValueError:
                    break
                pos = end
                while pos < len(txt) and txt[pos].isspace():
                    pos += 1
                if obj.get('id') == 7:
                    return obj
    except socket.timeout:
        pass
    finally:
        s.close()
    return {}


def keys():
    src = io.open(os.path.join(HERE, '..', 'plugin.video.nova', 'resources', 'lib', 'livefail.py'), encoding='utf-8').read()
    body = src[src.index('CHANNELS = {'):src.index('\n}\n')]
    return re.findall(r"^    '(\w+)': \(", body, re.M)


def playing():
    r = rpc('Player.GetActivePlayers').get('result') or []
    if not r:
        return None
    p = rpc('Player.GetProperties', {'playerid': r[0]['playerid'], 'properties': ['time', 'speed']}).get('result') or {}
    t = p.get('time') or {}
    return t.get('hours', 0) * 3600 + t.get('minutes', 0) * 60 + t.get('seconds', 0) + t.get('milliseconds', 0) / 1000.0


def one(key, wait=40):
    t0 = time.time()
    rpc('Player.Open', {'item': {'file': 'plugin://plugin.video.nova/?a=live&ch=' + key}}, 5)
    first, moved = None, False
    while time.time() - t0 < wait:
        time.sleep(1)
        t = playing()
        if t is None:
            continue
        if first is None:
            first = (t, time.time())
        elif t > first[0] + 1.5:
            moved = True
            break
    took = time.time() - t0
    w = rpc('XBMC.GetInfoLabels', {'labels': ['VideoPlayer.VideoResolution', 'Player.Filenameandpath']}).get('result') or {}
    for p in rpc('Player.GetActivePlayers').get('result') or []:
        rpc('Player.Stop', {'playerid': p['playerid']})
    time.sleep(2)
    return moved, took, w.get('VideoPlayer.VideoResolution', ''), (w.get('Player.Filenameandpath') or '')[:70]


if __name__ == '__main__':
    todo = sys.argv[1:] or keys()
    ok = 0
    for k in todo:
        good, took, res, path = one(k)
        ok += good
        print('%-4s %-11s %5.1fs %5s  %s' % ('OK' if good else 'FAIL', k, took, res, path))
    print('%d of %d play' % (ok, len(todo)))
