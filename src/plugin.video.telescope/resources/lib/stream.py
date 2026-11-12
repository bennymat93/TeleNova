# -*- coding: utf-8 -*-
"""Local HTTP server: byte-range streaming proxy for Telegram files + JSON-RPC for the plugin.

Streaming design (what keeps playback from stalling):
  * files are read in aligned 1 MiB chunks (Telegram upload.getFile constraints)
  * a shared LRU chunk cache (configurable MB) - seeks back and Kodi's probing requests
    (header, tail 'moov' atom, index) are served from memory
  * parallel read-ahead: while chunk N is being written, chunks N+1..N+K are fetched
    concurrently over several MTProto requests, which multiplies throughput
  * per-chunk retry with fresh requests, so a single slow/failed request never kills playback
"""
import collections
import hashlib
import hmac
import json
import re
import socket
import threading
import time
from concurrent.futures import Future, CancelledError, TimeoutError as FutTimeout
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

try:
    from urllib.parse import unquote
except ImportError:  # pragma: no cover
    from urllib import unquote

CHUNK = 1024 * 1024
RPC_MAX_BODY = 1024 * 1024   # 3.3: a JSON-RPC request is a few hundred bytes; anything huge is refused (413)


def stream_token(secret, chat_id, msg_id):
    """3.3: HMAC of chat/message with the service secret - the same formula as rpc.stream_token (plugin side)."""
    return hmac.new((secret or '').encode('utf-8'), ('%d:%d' % (int(chat_id), int(msg_id))).encode('utf-8'),
                    hashlib.sha256).hexdigest()[:16]

MIME = {'mkv': 'video/x-matroska', 'mp4': 'video/mp4', 'm4v': 'video/mp4', 'avi': 'video/x-msvideo',
        'webm': 'video/webm', 'ts': 'video/mp2t', 'mov': 'video/quicktime', 'wmv': 'video/x-ms-wmv',
        'mpg': 'video/mpeg', 'mpeg': 'video/mpeg', 'flv': 'video/x-flv', '3gp': 'video/3gpp'}


class ChunkStore(object):
    """LRU cache of file chunks with de-duplicated in-flight fetches."""

    def __init__(self, fetch, max_bytes=64 * CHUNK, parallel=4, log=None):
        self.fetch = fetch            # fetch(chat, msg, idx) -> concurrent.futures.Future[bytes]
        self.max_bytes = max_bytes
        self.parallel = max(1, parallel)
        self.log = log or (lambda m: None)
        self.cache = collections.OrderedDict()
        self.size = 0
        self.inflight = {}
        self.waiters = {}             # 3.3: key -> number of requests blocked on that chunk right now
        self.positions = {}           # 3.3.1: connection token -> (chat, msg, chunk it reads now)
        self.sizes = {}               # 3.3: (chat, msg) -> file size, told by the HTTP handler
        self.lock = threading.Lock()
        self.stats = {'hits': 0, 'miss': 0, 'bytes': 0, 'fetch_time': 0.0}

    def _put(self, key, data):
        with self.lock:
            if key in self.cache:
                return
            self.cache[key] = data
            self.size += len(data)
            while self.size > self.max_bytes and len(self.cache) > 1:
                _, old = self.cache.popitem(last=False)
                self.size -= len(old)

    def put(self, chat, msg, idx, data):
        self._put((chat, msg, idx), data)

    def _start(self, key):
        """Start fetching key unless cached/in-flight. Caller holds no lock."""
        with self.lock:
            if key in self.cache or key in self.inflight:
                return self.inflight.get(key)
            fut = Future()
            self.inflight[key] = fut
        t0 = time.time()

        def done(src):
            try:
                if src.cancelled():       # 3.3: dropped by cancel_stale() (CancelledError is a BaseException on 3.8)
                    fut.cancel()
                    return
                data = src.result()
                if self._short(key, data):
                    # 3.3: a short chunk in the middle of a file is never cached or served (it would shift the stream)
                    raise IOError('short chunk %d (%d bytes)' % (key[2], len(data)))
                self._put(key, data)
                with self.lock:
                    self.stats['bytes'] += len(data)
                    self.stats['fetch_time'] += time.time() - t0
                fut.set_result(data)
            except Exception as exc:  # propagate
                try:
                    fut.set_exception(exc)
                except Exception:
                    pass
            finally:
                with self.lock:
                    # 3.3: only this fetch's own entry - a newer fetch of the same chunk must stay registered
                    if self.inflight.get(key) is fut:
                        self.inflight.pop(key, None)
        try:
            src = self.fetch(*key)
            fut.src = src
            src.add_done_callback(done)
        except Exception as exc:
            with self.lock:
                self.inflight.pop(key, None)
            fut.set_exception(exc)
        return fut

    def _short(self, key, data):
        size = self.sizes.get(key[:2])
        return bool(size) and key[2] < (size - 1) // CHUNK and len(data) < CHUNK

    def note_size(self, chat, msg, size):
        if len(self.sizes) > 400:
            self.sizes.clear()
        self.sizes[(chat, msg)] = size

    def get(self, chat, msg, idx, timeout=30, retries=3):
        key = (chat, msg, idx)
        with self.lock:               # 3.3: a chunk somebody waits for is never cancelled by a seek elsewhere
            self.waiters[key] = self.waiters.get(key, 0) + 1
        try:
            return self._get(key, timeout, retries)
        finally:
            with self.lock:
                left = self.waiters.get(key, 1) - 1
                if left > 0:
                    self.waiters[key] = left
                else:
                    self.waiters.pop(key, None)

    def _get(self, key, timeout, retries):
        idx = key[2]
        fut = None
        for attempt in range(retries + 1):
            with self.lock:
                data = self.cache.get(key)
                if data is not None:
                    self.cache.move_to_end(key)
                    self.stats['hits'] += 1
                    return data
            self.stats['miss'] += 1
            fut = self._start(key)
            if fut is None:
                continue
            try:
                return fut.result(timeout)
            except CancelledError:
                continue                  # cancelled between lookup and wait: fetched again
            except FutTimeout:
                # 3.3: the download is still running - the next attempt waits for the SAME request instead of
                # starting a second copy of it (duplicates only multiply the load and the flood waits)
                self.log('chunk %s attempt %d: no answer in %ss' % (idx, attempt + 1, timeout))
            except Exception as exc:
                self.log('chunk %s attempt %d failed: %s' % (idx, attempt + 1, exc))
                with self.lock:
                    if self.inflight.get(key) is fut:
                        self.inflight.pop(key, None)
                time.sleep(0.3 * (attempt + 1))
        if fut is not None:
            # every attempt timed out: a request that hangs for good is dropped (unless somebody else still
            # waits for it), so that a later read starts a fresh one
            with self.lock:
                stuck = self.inflight.get(key) is fut and not fut.done() and self.waiters.get(key, 0) <= 1
                if stuck:
                    self.inflight.pop(key, None)
            if stuck:
                self._cancel(fut)
        raise IOError('chunk %d unavailable' % idx)

    @staticmethod
    def _cancel(fut):
        try:
            src = getattr(fut, 'src', None)
            if src is not None:
                src.cancel()              # run_coroutine_threadsafe future: cancels the coroutine
            fut.cancel()
        except Exception:
            pass

    def set_pos(self, token, chat, msg, idx):
        """3.3.1: where each open player connection currently reads (token = that connection)"""
        with self.lock:
            self.positions[token] = (chat, msg, idx)

    def drop_pos(self, token):
        with self.lock:
            self.positions.pop(token, None)

    def cancel_stale(self, chat, msg, readahead, last_idx):
        """After a seek the read-ahead of the old position kept downloading and delayed the new position.
        3.3.1: in-flight chunks of this file are cancelled only when they are outside the read-ahead window of
        EVERY open connection of that file (the player often holds two - the picture and the index at the end of
        the file - and each new request used to cancel the other one's read-ahead: downloaded data was thrown
        away and asked for again, the stream stalled every few seconds). The file's tail and chunks a request
        is blocked on are never cancelled."""
        drop = []
        with self.lock:
            spots = [p[2] for p in self.positions.values() if p[0] == chat and p[1] == msg]
            for key, fut in list(self.inflight.items()):
                if key[0] != chat or key[1] != msg:
                    continue
                if any(p <= key[2] <= p + readahead + 1 for p in spots) or key[2] >= last_idx - 1 or \
                        self.waiters.get(key):
                    continue
                self.inflight.pop(key, None)
                drop.append(fut)
        for fut in drop:
            self._cancel(fut)
        return len(drop)

    def prefetch(self, chat, msg, first, count, last_idx):
        with self.lock:
            busy = len(self.inflight)
        budget = max(0, self.parallel * 2 - busy)
        for idx in range(first, min(first + count, last_idx + 1)):
            if budget <= 0:
                break
            key = (chat, msg, idx)
            with self.lock:
                if key in self.cache or key in self.inflight:
                    continue
            self._start(key)
            budget -= 1

    def speed(self):
        t = self.stats['fetch_time']
        return (self.stats['bytes'] / t) if t else 0


class _Server(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 32


def parse_range(header, size):
    """Return (start, end) inclusive or None for full content; raises ValueError if unsatisfiable."""
    if not header:
        return None
    m = re.match(r'bytes=(\d*)-(\d*)', header.strip())
    if not m:
        return None
    a, b = m.group(1), m.group(2)
    if a == '' and b == '':
        return None
    if a == '':
        n = int(b)
        start, end = max(0, size - n), size - 1
    else:
        start = int(a)
        end = int(b) if b else size - 1
    end = min(end, size - 1)
    if start >= size or start > end:
        raise ValueError('unsatisfiable')
    return start, end


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        server_version = 'TeleScope/1.0'

        def log_message(self, fmt, *args):
            if app.debug:
                app.log('http: ' + fmt % args)

        def _json(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def _host_ok(self):
            # 3.3: only requests addressed to this machine by its loopback name are served - a web page that
            # points its own domain at 127.0.0.1 (DNS rebinding) sends that domain in the Host header
            host = (self.headers.get('Host') or '').strip().lower()
            port = self.server.server_address[1]
            return host in ('127.0.0.1:%d' % port, 'localhost:%d' % port)

        def do_POST(self):
            if not self._host_ok():
                self.close_connection = True
                return self._json(403, {'error': 'forbidden'})
            if self.path.rstrip('/') != '/rpc':
                return self._json(404, {'error': 'not found'})
            # 3.3: the length is checked before anything is read (it used to be parsed outside the try, unbounded)
            try:
                length = int(self.headers.get('Content-Length') or 0)
            except ValueError:
                length = -1
            if length < 0 or length > RPC_MAX_BODY:
                self.close_connection = True
                return self._json(413 if length > 0 else 400, {'error': 'bad length'})
            try:
                req = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
                if req.get('secret') != app.secret:
                    return self._json(403, {'error': 'forbidden'})
                result = app.rpc(req.get('method'), req.get('params') or {})
                self._json(200, {'result': result})
            except Exception as exc:
                app.log('rpc %s error: %r' % (self.path, exc))
                self._json(200, {'error': '%s: %s' % (type(exc).__name__, exc)})

        def do_GET(self):
            self._stream(head=False)

        def do_HEAD(self):
            self._stream(head=True)

        def _stream(self, head):
            if not self._host_ok():
                self.close_connection = True
                return self._json(403, {'error': 'forbidden'})
            if self.path.startswith('/ping'):
                return self._json(200, {'ok': True})
            if not self.path.startswith('/stream/'):
                return self._json(404, {'error': 'not found'})
            # 3.3: /stream/<chat>/<msg>/<token>/<name> - without the token of rpc.stream_url() nothing is served
            m = re.match(r'^/stream/(-?\d+)/(\d+)/([0-9a-f]{16})(?:/([^?]*))?', self.path)
            if not m or not hmac.compare_digest(m.group(3), stream_token(app.secret, m.group(1), m.group(2))):
                return self._json(403, {'error': 'forbidden'})
            chat, msg = int(m.group(1)), int(m.group(2))
            try:
                info = app.file_info(chat, msg)
            except Exception as exc:
                app.log('file info failed: %r' % exc)
                return self._json(502, {'error': str(exc)})
            size = int(info['size'])
            name = unquote(m.group(4) or info.get('file') or '')
            ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
            ctype = MIME.get(ext) or info.get('mime') or 'application/octet-stream'
            try:
                rng = parse_range(self.headers.get('Range'), size)
            except ValueError:
                self.send_response(416)
                self.send_header('Content-Range', 'bytes */%d' % size)
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            start, end = rng if rng else (0, size - 1)
            self.send_response(206 if rng else 200)
            self.send_header('Content-Type', ctype)
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', str(end - start + 1))
            if rng:
                self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
            self.end_headers()
            if head:
                return
            store = app.store
            store.note_size(chat, msg, size)
            last_idx = (size - 1) // CHUNK
            if start == 0 and last_idx > 4:
                # players probe the end of the file (MP4 'moov', MKV cues) right after the header:
                # fetch the tail in the background so that seek is instant.
                store.prefetch(chat, msg, last_idx - 1, 2, last_idx)
            idx = start // CHUNK
            pos = start
            readahead = app.readahead
            token = object()
            say = getattr(app, 'info', app.log)
            store.set_pos(token, chat, msg, idx)
            try:
                store.cancel_stale(chat, msg, readahead, last_idx)   # a seek drops read-ahead nobody reads any more
            except Exception as exc:
                app.log('cancel_stale: %r' % exc)
            try:
                while pos <= end:
                    store.set_pos(token, chat, msg, idx)
                    # keep the pipeline full before blocking on the current chunk
                    store.prefetch(chat, msg, idx, readahead + 1, last_idx)
                    t_wait = time.time()
                    data = store.get(chat, msg, idx, timeout=app.chunk_timeout)
                    waited = time.time() - t_wait
                    if waited > 4:
                        # 3.3.1: always written to the log - a stall the viewer sees has a line that says why
                        say('slow chunk %d of %d: waited %.1fs (download speed %.2f MB/s, %d in flight)' % (
                            idx, last_idx, waited, store.speed() / 1048576.0, len(store.inflight)))
                    off = pos - idx * CHUNK
                    piece = data[off:off + (end - pos + 1)]
                    if not piece:
                        # 3.3: fewer bytes than the promised Content-Length: the socket must not stay open
                        # (keep-alive) with the player waiting for the rest
                        self.close_connection = True
                        break
                    self.wfile.write(piece)
                    pos += len(piece)
                    idx += 1
            except (BrokenPipeError, ConnectionResetError, socket.timeout, ConnectionAbortedError):
                pass  # player seeked / stopped
            except Exception as exc:
                say('stream error at %d: %r' % (pos, exc))
                self.close_connection = True
            finally:
                store.drop_pos(token)
                try:        # this connection is gone: what only it was waiting for is not needed any more
                    store.cancel_stale(chat, msg, readahead, last_idx)
                except Exception:
                    pass
    return Handler


class App(object):
    """Glue object; the service fills rpc/file_info/fetch."""

    def __init__(self, fetch, file_info, rpc, log, secret, cache_mb=128, parallel=4, readahead=8,
                 chunk_timeout=30, debug=False):
        self.log = log
        self.secret = secret
        self.debug = debug
        self._file_info = file_info
        self.rpc = rpc
        self.readahead = readahead
        self.chunk_timeout = chunk_timeout
        self.store = ChunkStore(fetch, max_bytes=cache_mb * CHUNK, parallel=parallel, log=log)
        self._info_cache = collections.OrderedDict()
        self.server = None

    def file_info(self, chat, msg):
        key = (chat, msg)
        hit = self._info_cache.get(key)
        if hit and hit[0] > time.time():
            return hit[1]
        info = self._file_info(chat, msg)
        self._info_cache[key] = (time.time() + 1800, info)
        try:
            self._info_cache.move_to_end(key)
            while len(self._info_cache) > 200:       # 3.3: the service runs for days - the oldest entries go
                self._info_cache.popitem(last=False)
        except KeyError:
            pass
        return info

    def serve(self, port):
        last_exc = None
        for p in [port] + list(range(port + 1, port + 20)) + [0]:
            try:
                self.server = _Server(('127.0.0.1', p), make_handler(self))
                break
            except OSError as exc:
                last_exc = exc
        if not self.server:
            raise last_exc
        t = threading.Thread(target=self.server.serve_forever, name='telescope-http', daemon=True)
        t.start()
        return self.server.server_address[1]

    def shutdown(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
