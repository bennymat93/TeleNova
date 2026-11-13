# -*- coding: utf-8 -*-
"""service._post_wait: answers like requests.post(...).json(), and gives up within ~1 s when Kodi closes."""
import ast, io, json, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
src = io.open(os.path.join(HERE, '..', 'plugin.video.nova', 'service.py'), encoding='utf-8').read()
fn = [n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == '_post_wait'][0]
ns = {'json': json, 'time': time}
exec(compile(ast.Module(body=[fn], type_ignores=[]), 'service', 'exec'), ns)
post = ns['_post_wait']


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])).decode('utf-8'))
        time.sleep(body.get('sleep', 0))
        out = json.dumps({'echo': body.get('x'), 'path': self.path}).encode('utf-8')
        try:
            self.send_response(500 if body.get('fail') else 200)
            self.send_header('Content-Length', str(len(out)))
            self.end_headers()
            self.wfile.write(out)
        except Exception:
            pass

    def log_message(self, *a):
        pass


class Mon(object):
    def __init__(self, after=None):
        self.t = time.time() + after if after is not None else None

    def abortRequested(self):
        return self.t is not None and time.time() >= self.t


srv = HTTPServer(('127.0.0.1', 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:%d' % srv.server_address[1]
bad = []
r = post(base + '/align', {'x': u'שלום', 'sleep': 2.5}, 20, Mon())
if r != {'echo': u'שלום', 'path': '/align'}:
    bad.append('answer: %r' % (r,))
t = time.time()
r = post(base + '/align', {'sleep': 8}, 20, Mon(after=1.2))
took = time.time() - t
if r is not None or took > 3:
    bad.append('abort: %r after %.1fs' % (r, took))
try:
    post(base + '/align', {'fail': 1}, 20, Mon())
    bad.append('HTTP 500 not raised')
except RuntimeError:
    pass
try:
    post(base + '/align', {'sleep': 4}, 1.5, Mon())
    bad.append('timeout not raised')
except TimeoutError:
    pass
try:
    post('http://127.0.0.1:9/align', {}, 5, Mon())
    bad.append('refused connection not raised')
except OSError:
    pass
for b in bad:
    print('FAIL', b)
print('POSTWAIT OK (abort seen after %.1fs)' % took if not bad else 'POSTWAIT: %d problems' % len(bad))
sys.exit(1 if bad else 0)
