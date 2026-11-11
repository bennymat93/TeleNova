import json, socket, time, sys
def rpc(method, params=None, timeout=60):
    s = socket.create_connection(('127.0.0.1', 9090), timeout=5); s.settimeout(timeout)
    s.sendall(json.dumps({'jsonrpc': '2.0', 'id': 7, 'method': method, 'params': params or {}}).encode())
    buf = b''; dec = json.JSONDecoder()
    while True:
        chunk = s.recv(65536)
        if not chunk: break
        buf += chunk
        txt = buf.decode('utf-8', 'ignore'); pos = 0
        while pos < len(txt):
            try: obj, end = dec.raw_decode(txt, pos)
            except ValueError: break
            pos = end
            while pos < len(txt) and txt[pos].isspace(): pos += 1
            if obj.get('id') == 7: s.close(); return obj
    s.close(); return {}
print('ping:', rpc('JSONRPC.Ping').get('result'))
print('window:', rpc('GUI.GetProperties', {'properties': ['currentwindow', 'skin']}).get('result'))
def ls(path, depth=0, maxdepth=1, seen=None):
    t = time.time()
    r = rpc('Files.GetDirectory', {'directory': path, 'media': 'files', 'properties': ['title']}, 90)
    dt = time.time() - t
    if 'error' in r:
        print('%sERR %.1fs %s -> %s' % ('  ' * depth, dt, path[:110], r['error'].get('message'))); return
    files = (r.get('result') or {}).get('files') or []
    print('%s%2d items %.1fs  %s' % ('  ' * depth, len(files), dt, path[:120]))
    if depth == 0:
        for f in files: print('     - %s  [%s]' % (f.get('label'), f.get('file', '')[:90]))
    if depth < maxdepth:
        for f in files:
            if f.get('filetype') == 'directory' and f.get('file', '').startswith('plugin://'):
                ls(f['file'], depth + 1, maxdepth)
ls(sys.argv[1], 0, int(sys.argv[2]))
