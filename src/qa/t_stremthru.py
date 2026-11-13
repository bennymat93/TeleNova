# -*- coding: utf-8 -*-
"""stremthru.py without Kodi and without the network: python t_stremthru.py"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.telescope',
                                'resources', 'lib'))
import stremthru                                                       # noqa: E402
from stremthru import StremThru, DEFAULT_BASE                          # noqa: E402

TOKEN = 'RDSECRETTOKEN1234567890ABCDEF'
FAILS = []


def ok(cond, what):
    if not cond:
        FAILS.append(what)
        print('FAIL: ' + what)


class Resp(object):
    def __init__(self, status=200, payload=None, headers=None):
        self.status_code, self.payload, self.headers = status, payload, headers or {}

    def json(self):
        if self.payload is None:
            raise ValueError('no json')
        return self.payload


class Http(object):
    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append({'url': url, 'params': dict(params or {}), 'headers': dict(headers or {}),
                           'timeout': timeout})
        r = self.answer(url, dict(params or {}), dict(headers or {}))
        if isinstance(r, Exception):
            raise r
        return r


def H(n):
    return '%040x' % n


def item(h, status, files=None):
    """one item exactly as /v0/store/torz/check returns it (docs/api/torz.md, store.CheckMagnetDataItem)"""
    return {'hash': h, 'magnet': 'magnet:?xt=urn:btih:' + h, 'status': status, 'files': files or []}


def torz(url, params, headers):
    """every even hash is cached with two files"""
    items = []
    for h in params['hash'].split(','):
        if int(h, 16) % 2 == 0:
            items.append(item(h, 'cached', [
                {'index': 0, 'name': 'Show.S01E01.1080p.mkv', 'path': '/Show.S01/Show.S01E01.1080p.mkv',
                 'size': 1500000000, 'video_hash': ''},
                {'index': 1, 'name': '', 'path': '/Show.S01/Show.S01E02.1080p.mkv', 'size': 1400000000}]))
        else:
            items.append(item(h, 'unknown'))
    return Resp(200, {'data': {'items': items}})


def make(answer, token=TOKEN, base=DEFAULT_BASE):
    logs = []
    http = Http(answer)
    st = StremThru(base, lambda: token, logs.append, http=http)
    return st, http, logs


# ---- enabled
st, http, logs = make(torz)
ok(st.enabled, 'enabled with base and token')
ok(not make(torz, token='')[0].enabled, 'not enabled without a token')
ok(not make(torz, base='')[0].enabled, 'not enabled without a base')
ok(make(torz, token='')[0].check([H(2)]) == {} and make(torz, base='')[0].check([H(2)]) == {}, 'no request when off')
ok(DEFAULT_BASE.startswith('https://') and not DEFAULT_BASE.endswith('/'), 'default base')

# ---- one request: URL, headers, parsing
res = st.check([H(2).upper(), H(3), 'magnet:?xt=urn:btih:%s&dn=x' % H(4), 'junk', H(2)], sid='tt0111161:1:2')
ok(len(http.calls) == 1, 'one request for a small list')
c = http.calls[0]
ok(c['url'] == DEFAULT_BASE + '/v0/store/torz/check', 'check URL: %s' % c['url'])
ok(c['params'] == {'hash': ','.join([H(2), H(3), H(4)]), 'sid': 'tt0111161:1:2'}, 'params: lower case, no doubles, sid')
ok(c['headers'].get('X-StremThru-Store-Name') == 'realdebrid', 'store name header')
ok(c['headers'].get('X-StremThru-Store-Authorization') == 'Bearer ' + TOKEN, 'store authorization header')
ok(TOKEN not in c['url'] and TOKEN not in str(c['params']), 'token only in the header')
ok(c['timeout'] == 10, 'timeout passed')
ok(set(res) == {H(2), H(3), H(4)}, 'all three answered')
ok(res[H(2)]['cached'] is True and res[H(4)]['cached'] is True, 'cached parsed')
ok(res[H(3)] == {'cached': False, 'files': []}, 'not cached parsed')
ok(res[H(2)]['files'] == [{'index': 0, 'name': 'Show.S01E01.1080p.mkv', 'size': 1500000000},
                          {'index': 1, 'name': 'Show.S01E02.1080p.mkv', 'size': 1400000000}], 'files (name from path)')
ok(logs == [], 'nothing logged on success')

# ---- the cache: 10 minutes per hash
clock = [1000.0]
st._now = lambda: clock[0]
st, http, logs = make(torz)
st._now = lambda: clock[0]
st.check([H(2), H(3)])
st.check([H(2), H(3)])
ok(len(http.calls) == 1, 'second check served from memory')
st.check([H(3), H(5)])
ok(len(http.calls) == 2 and http.calls[1]['params']['hash'] == H(5), 'only the new hash is asked')
clock[0] += 599
st.check([H(2)])
ok(len(http.calls) == 2, 'still remembered after 599 s')
clock[0] += 2
r = st.check([H(2)])
ok(len(http.calls) == 3 and r[H(2)]['cached'], 'asked again after 10 minutes')

# ---- batching
st, http, logs = make(torz)
many = [H(i) for i in range(1, 251)]
res = st.check(many)
ok([len(c['params']['hash'].split(',')) for c in http.calls] == [100, 100, 50], 'batches of 100')
ok(len(res) == 250 and sum(1 for v in res.values() if v['cached']) == 125, 'all batches merged')
ok(stremthru.BATCH <= stremthru.MAX_HASHES == 500, 'batch within the API limit')
st, http, logs = make(torz)
st.batch = 9999
st.check([H(i) for i in range(1, 602)])
ok([len(c['params']['hash'].split(',')) for c in http.calls] == [500, 101], 'never more than 500 per request')

# ---- one batch fails: the others still count, the failed one is not remembered
state = {'n': 0}


def second_fails(url, params, headers):
    state['n'] += 1
    if state['n'] == 2:
        return Resp(500, {'error': {'code': 'INTERNAL_SERVER_ERROR', 'message': 'boom ' + TOKEN}})
    return torz(url, params, headers)


st, http, logs = make(second_fails)
res = st.check(many)
ok(len(res) == 150 and H(101) not in res and H(1) in res and H(201) in res, 'failed batch -> nothing for it')
ok(len(logs) == 1 and '500' in logs[0], 'one log line for the failed batch: %r' % logs)
ok(TOKEN not in '\n'.join(logs), 'token not logged (error body)')
res = st.check(many)
ok(len(http.calls) == 4 and len(res) == 250, 'the failed batch is asked again, the rest comes from memory')


# ---- error paths -> {}
class Boom(Exception):
    def __str__(self):
        return 'GET %s/v0/store/torz/check?hash=abc with Bearer %s' % (DEFAULT_BASE, TOKEN)


for name, answer in (
        ('network error', lambda u, p, h: Boom()),
        ('401', lambda u, p, h: Resp(401, {'error': {'code': 'UNAUTHORIZED', 'message': 'Unauthorized',
                                                     'errors': [{'message': 'Unauthorized'}]}})),
        ('403 plain text', lambda u, p, h: Resp(403, None)),
        ('not json', lambda u, p, h: Resp(200, None)),
        ('502', lambda u, p, h: Resp(502, None))):
    st, http, logs = make(answer)
    ok(st.check([H(2), H(3)]) == {}, '%s -> {}' % name)
    ok(len(logs) == 1 and logs[0].startswith('stremthru: '), '%s: one short log line: %r' % (name, logs))
    text = '\n'.join(logs)
    ok(TOKEN not in text and DEFAULT_BASE not in text and '?' not in text and 'hash=' not in text,
       '%s: no token / URL in the log: %r' % (name, logs))
    st.check([H(2)])
    ok(len(http.calls) == 2, '%s: a failure is not remembered' % name)
st, http, logs = make(lambda u, p, h: Resp(401, {'error': {'code': 'UNAUTHORIZED'}}))
st.check([H(2)])
ok(logs == ['stremthru: check refused: 401 UNAUTHORIZED'], 'the API error code is in the log: %r' % logs)

# ---- odd answers
st, http, logs = make(lambda u, p, h: Resp(200, {'data': {'items': None}}))
ok(st.check([H(2)]) == {}, 'no items -> {}')
st, http, logs = make(lambda u, p, h: Resp(200, {'data': {'items': [
    {'hash': H(2).upper(), 'status': 'cached', 'files': [{'index': -1, 'name': 'a.mkv', 'size': -1}]},
    {'hash': '', 'status': 'cached'}, 'x', {'hash': H(4), 'status': 'downloaded', 'files': None}]}}))
res = st.check([H(2), H(4), H(6)])
ok(res == {H(2): {'cached': True, 'files': [{'index': -1, 'name': 'a.mkv', 'size': -1}]},
           H(4): {'cached': False, 'files': []}}, 'odd items: %r' % res)


# ---- an older instance: torz/check is 404 -> magnets/check, remembered
def legacy(url, params, headers):
    if url.endswith('/torz/check'):
        return Resp(404, None)
    return Resp(200, {'data': {'items': [item(h, 'cached') for h in params['magnet'].split(',')]}})


st, http, logs = make(legacy)
res = st.check([H(2), H(3)], sid='tt1')
ok(res.get(H(3), {}).get('cached') is True, 'legacy endpoint answer parsed')
ok([c['url'].rsplit('/v0', 1)[1] for c in http.calls] == ['/store/torz/check', '/store/magnets/check'], 'fallback order')
ok(http.calls[1]['params'] == {'magnet': H(2) + ',' + H(3), 'sid': 'tt1'}, 'legacy params')
st.check([H(8)])
ok(http.calls[-1]['url'].endswith('/v0/store/magnets/check') and len(http.calls) == 3, 'legacy remembered')

# ---- a changed token does not reuse another account's answers
tok = ['A' * 20]
http = Http(torz)
st = StremThru(DEFAULT_BASE + '/', lambda: tok[0], lambda m: None, http=http)
st.check([H(2)])
tok[0] = 'B' * 20
st.check([H(2)])
ok(len(http.calls) == 2 and http.calls[1]['headers']['X-StremThru-Store-Authorization'] == 'Bearer ' + 'B' * 20,
   'new token -> asked again with it')
ok(http.calls[0]['url'] == DEFAULT_BASE + '/v0/store/torz/check', 'trailing slash of the base removed')

# ---- health
st, http, logs = make(lambda u, p, h: Resp(200, {'data': {'status': 'ok'}}))
ok(st.health() == (True, 'ok'), 'health ok')
ok(http.calls[0]['url'] == DEFAULT_BASE + '/v0/health' and http.calls[0]['headers'] == {}, 'health sends no token')
ok(make(lambda u, p, h: Resp(503, None))[0].health() == (False, 'http 503'), 'health 503')
ok(make(lambda u, p, h: Resp(200, None))[0].health() == (False, 'bad answer'), 'health not json')
ok(make(lambda u, p, h: Boom())[0].health() == (False, 'network: Boom'), 'health network error')
ok(make(torz, base='')[0].health()[0] is False, 'health without a base')
st, http, logs = make(lambda u, p, h: Resp(200, {'data': {'status': 'ok'}}), token='')
ok(st.health() == (True, 'ok'), 'health works without a token')

if FAILS:
    print('%d FAILED' % len(FAILS))
    sys.exit(1)
print('STREMTHRU TESTS OK')
