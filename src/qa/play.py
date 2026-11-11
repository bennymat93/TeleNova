import json, socket, sys, time
def rpc(method, params=None):
    s = socket.create_connection(('127.0.0.1', 9090), timeout=5); s.settimeout(20)
    s.sendall(json.dumps({'jsonrpc': '2.0', 'id': 7, 'method': method, 'params': params or {}}).encode())
    buf = b''; dec = json.JSONDecoder()
    while True:
        buf += s.recv(65536); txt = buf.decode('utf-8', 'ignore'); pos = 0
        while pos < len(txt):
            try: obj, end = dec.raw_decode(txt, pos)
            except ValueError: break
            pos = end
            while pos < len(txt) and txt[pos].isspace(): pos += 1
            if obj.get('id') == 7: s.close(); return obj
rpc('Player.Open', {'item': {'file': sys.argv[1]}})
time.sleep(14)
r = rpc('Player.GetProperties', {'playerid': 1, 'properties': ['subtitles', 'currentsubtitle', 'subtitleenabled']}).get('result', {})
print('   tracks:', [(t.get('language'), t.get('name')) for t in r.get('subtitles', [])], '| enabled:', r.get('subtitleenabled'), '| current:', (r.get('currentsubtitle') or {}).get('language'), (r.get('currentsubtitle') or {}).get('name'))
rpc('Player.Stop', {'playerid': 1}); time.sleep(4)
