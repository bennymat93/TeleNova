# -*- coding: utf-8 -*-
"""The engine's HTTP server must let go of everything on shutdown: Kodi waits for every thread of a script, and a
thread that sits in a read on a kept-alive connection never ends by itself (Kodi hung on exit after a Telegram film).
Three kinds of connections are left open on purpose - idle keep-alive, a stream the player stopped reading, a reader
waiting for a chunk that never comes - then shutdown() is called and every handler thread must be gone."""
import importlib.util, os, socket, sys, threading, time
from concurrent.futures import Future

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.telescope', 'resources', 'lib')
sp = importlib.util.spec_from_file_location('stream_t', os.path.join(ROOT, 'stream.py'))
stream = importlib.util.module_from_spec(sp)
sp.loader.exec_module(stream)

SIZE = 40 * stream.CHUNK
never = []


def fetch(chat, msg, idx):
    f = Future()
    if idx >= 20:
        never.append(f)                 # a chunk Telegram never answers
    else:
        f.set_result(bytes([idx % 251]) * stream.CHUNK)
    return f


app = stream.App(fetch, lambda chat, msg: {'size': SIZE, 'file': 'film.mkv', 'mime': 'video/x-matroska'},
                 lambda method, params: {'ok': True}, lambda m: None, 'secret', cache_mb=64)
port = app.serve(0)
tok = stream.stream_token('secret', 1, 2)
before = set(threading.enumerate())


def conn(rng, read=0):
    s = socket.create_connection(('127.0.0.1', port))
    s.sendall(('GET /stream/1/2/%s/film.mkv HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nUser-Agent: Kodi/21\r\nRange: bytes=%s\r\n\r\n' % (tok, port, rng)).encode())
    if read:
        got = 0
        while got < read:
            b = s.recv(65536)
            if not b:
                break
            got += len(b)
    return s


keep = conn('0-1023', read=1024 + 100)           # answered in full, connection stays open (keep-alive)
full = conn('0-', read=200000)                   # the player took a little and stopped reading: the write blocks
wait = conn('%d-' % (20 * stream.CHUNK), read=0)  # blocked on a chunk that never arrives
time.sleep(1.0)
mine = [t for t in threading.enumerate() if t not in before]
print('handler threads before shutdown: %d' % len(mine))
t0 = time.time()
app.shutdown()
deadline = time.time() + 4
while time.time() < deadline and any(t.is_alive() for t in mine):
    time.sleep(0.05)
left = [t.name for t in mine if t.is_alive()]
print('shutdown returned after %.2fs; handler threads still alive after %.2fs: %s' % (0, time.time() - t0, left or 'none'))
for s in (keep, full, wait):
    try:
        s.close()
    except OSError:
        pass
ok = len(mine) >= 3 and not left
print('EXIT TEST %s' % ('OK' if ok else 'FAILED'))
sys.exit(0 if ok else 1)
