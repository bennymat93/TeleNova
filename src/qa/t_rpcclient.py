# -*- coding: utf-8 -*-
"""6.5.1 (K4): the plugin's RPC client ends in one of three definite reasons instead of "service down, restart Kodi":
service_starting (the engine answers but is still starting), timeout (it took the call, no answer), service_down."""
import io, os, sys, types

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'plugin.video.telescope'))
for name in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules.setdefault(name, types.ModuleType(name))

req = types.ModuleType('requests')


class RequestException(Exception):
    pass


class ConnectionError_(RequestException):
    pass


class Timeout(RequestException):
    pass


class ReadTimeout(Timeout):
    pass


class ConnectTimeout(ConnectionError_, Timeout):
    pass


req.RequestException, req.ConnectionError, req.Timeout, req.ReadTimeout = RequestException, ConnectionError_, Timeout, ReadTimeout
req.ConnectTimeout = ConnectTimeout
sys.modules['requests'] = req

import resources.lib  # noqa: E402
common = types.ModuleType('resources.lib.common')       # rpc.py needs only these four from it
sys.modules['resources.lib.common'] = resources.lib.common = common
common.PORT_FILE = 'port.json'
from resources.lib import rpc  # noqa: E402

bad = []


def check(cond, what):
    print(('ok    ' if cond else 'FAIL  ') + what)
    if not cond:
        bad.append(what)


class Resp(object):
    def __init__(self, data):
        self.data = data

    def json(self):
        if isinstance(self.data, Exception):
            raise self.data
        return self.data


clock = [0.0]
rpc.time = types.SimpleNamespace(time=lambda: clock[0], sleep=lambda s: clock.__setitem__(0, clock[0] + s))
common.read_json = lambda path, default=None: {'port': 1, 'secret': 's'}
common.log = lambda *a, **k: None
common.scrub = lambda x: str(x)


def answers(*seq):
    seq = list(seq)
    n = [0]

    def post(url, json=None, timeout=None):
        n[0] += 1
        item = seq.pop(0) if len(seq) > 1 else seq[0]
        if isinstance(item, Exception):
            raise item
        return Resp(item)
    req.post = post
    return n


def outcome(method='status'):
    clock[0] = 0.0
    try:
        return 'result', rpc.call(method, timeout=5)
    except rpc.RPCError as exc:
        return 'error', str(exc)


S = {'error': 'service_starting'}
n = answers(S, S, {'result': {'ok': 1}})
check(outcome() == ('result', {'ok': 1}) and n[0] == 3, 'still starting twice, then an answer: the answer')
n = answers(S)
r = outcome()
check(r == ('error', 'service_starting') and clock[0] >= rpc.START_WAIT, 'starting for ever: service_starting after %ds, %r' % (clock[0], r))
n = answers(ReadTimeout('read'))
check(outcome() == ('error', 'timeout') and n[0] == 1, 'a read timeout: "timeout", not repeated')
n = answers(ConnectionError_('refused'))
check(outcome() == ('error', 'service_down') and n[0] == 3, 'nothing on the port: service_down after 3 tries')
n = answers(ConnectTimeout('connect'))
check(outcome() == ('error', 'service_down'), 'a connect timeout is "service down", not "timeout"')
n = answers(['not a dict'])
check(outcome() == ('error', 'service_down'), 'something else on the port: service_down')
n = answers({'error': 'not_authorized'})
check(outcome() == ('error', 'not_authorized') and n[0] == 1, 'an engine error is passed on at once')
common.read_json = lambda path, default=None: {}
check(outcome() == ('error', 'service_down'), 'no port file: service_down')

print('\n' + ('RPCCLIENT TESTS OK' if not bad else 'RPCCLIENT TESTS FAILED: %d' % len(bad)))
sys.exit(1 if bad else 0)
