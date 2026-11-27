# -*- coding: utf-8 -*-
"""4.2: "send my setup to another device" - protocol core and both flows, two simulated devices on this machine
(real TCP sockets, no Kodi, no Telegram account). Ends with PAIRING TESTS OK.   python t_pairing.py"""
import hashlib
import hmac
import io
import json
import os
import socket
import struct
import sys
import threading
import time
import types

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'plugin.video.nova'))
for name in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules.setdefault(name, types.ModuleType(name))
from resources.lib import pairing as P, pairflow as F  # noqa: E402

bad = []


def check(cond, what):
    print(('ok    ' if cond else 'FAIL  ') + what)
    if not cond:
        bad.append(what)


# ------------------------------------------------------------------ primitives
def arccot(x, unity):
    s = t = unity // x
    n, sign = 1, -1
    while t:
        t //= x * x
        n += 2
        s += sign * (t // n)
        sign = -sign
    return s


B = 2200
pi = 4 * (4 * arccot(5, 1 << B) - arccot(239, 1 << B))
check(P.P == 2 ** 2048 - 2 ** 1984 - 1 + 2 ** 64 * ((pi >> (B - 1918)) + 124476), 'group 14 prime = its RFC 3526 definition')
check(P.P % 8 == 7, 'p = 7 mod 8: 2 generates the prime-order subgroup')
x, y = P.keypair()
check(P.check_public(y) == y and x.bit_length() == 256, 'own public value passes the subgroup check')
for v, why in ((0, 'zero'), (1, 'one'), (P.P - 1, 'p-1'), (P.P, 'p'), (P.P - 2 if pow(P.P - 2, (P.P - 1) // 2, P.P) != 1 else 3, 'outside the subgroup')):
    try:
        P.check_public(v)
        check(False, 'bad public value refused: ' + why)
    except P.PairError:
        check(True, 'bad public value refused: ' + why)
# RFC 5869 test case 1
okm = P.hkdf(bytes.fromhex('0b' * 22), bytes.fromhex('000102030405060708090a0b0c'), bytes.fromhex('f0f1f2f3f4f5f6f7f8f9'), 42)
check(okm.hex() == '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865', 'HKDF = RFC 5869 test case 1')


# ------------------------------------------------------------------ handshake over a real socket pair
def pair_sockets():
    srv = socket.socket()
    srv.bind(('127.0.0.1', 0))
    srv.listen(1)
    c = socket.create_connection(srv.getsockname())
    s, _ = srv.accept()
    srv.close()
    return c, s


def handshake(sender_fn=P.sender_handshake, receiver_fn=P.receiver_handshake):
    a, b = pair_sockets()
    out = {}

    def r():
        try:
            out['r'] = receiver_fn(b, 'TV salon')
        except Exception as e:
            out['r_err'] = e
    t = threading.Thread(target=r)
    t.start()
    try:
        out['s'] = sender_fn(a, 'PC')
    except Exception as e:
        out['s_err'] = e
    t.join(30)
    return out


h = handshake()
check(h['s'].code == h['r'].code and len(h['s'].code) == 6 and h['s'].code.isdigit(), 'both sides show the same 6 digits (%s)' % h['s'].code)
check(h['s'].peer_name == 'TV salon' and h['r'].peer_name == 'PC', 'names exchanged')
h['s'].send({'x': u'שלום', 'n': list(range(3))})
check(h['r'].recv(5) == {'x': u'שלום', 'n': [0, 1, 2]}, 'encrypted message arrives intact')
h['r'].send({'back': True})
check(h['s'].recv(5) == {'back': True}, 'and the other way')
codes = set(handshake()['s'].code for _ in range(6))
check(len(codes) >= 5, 'a new code every session: %d different of 6' % len(codes))

# tampering / replay on the encrypted channel
h = handshake()
raw = []
orig = P.send_frame


def capture(sock, data):
    raw.append(data)
    orig(sock, data)


P.send_frame = capture
h['s'].send({'a': 1})
P.send_frame = orig
check(h['r'].recv(5) == {'a': 1}, 'first copy accepted')
orig(h['s'].sock, raw[0])                                   # the same frame again
try:
    h['r'].recv(5)
    check(False, 'a replayed frame is refused')
except P.PairError as e:
    check(str(e) == 'tag', 'a replayed frame is refused')
h = handshake()
h['s'].send({'a': 1})
frame = P.recv_frame(h['r'].sock, 5)
flipped = frame[:34] + bytes([frame[34] ^ 1]) + frame[35:]
a2, b2 = pair_sockets()
h['r'].sock = b2
orig(a2, flipped)
try:
    h['r'].recv(5)
    check(False, 'a changed frame is refused')
except P.PairError as e:
    check(str(e) == 'tag', 'a changed frame is refused')


# a sender that reveals another key than it committed to
def lying_sender(sock, name):
    x, pk = P.keypair()
    n = os.urandom(32)
    P.send_frame(sock, json.dumps({'v': 1, 'role': 'send', 'name': name, 'commit': P.commit(pk, n)}).encode())
    P.recv_frame(sock, 10)
    x2, pk2 = P.keypair()
    P.send_frame(sock, json.dumps({'pk': '%x' % pk2, 'n': n.hex()}).encode())
    time.sleep(0.3)


h = handshake(sender_fn=lying_sender)
check(isinstance(h.get('r_err'), P.PairError) and str(h['r_err']) == 'commitment', 'a broken commitment is caught')


# a man in the middle relaying two separate handshakes: the codes differ
def mitm():
    s_out, mid_r = pair_sockets()
    mid_s, r_in = pair_sockets()
    res = {}

    def victim_r():
        res['r'] = P.receiver_handshake(r_in, 'TV')

    def mid_as_receiver():
        res['m1'] = P.receiver_handshake(mid_r, 'TV')        # the attacker pretends to be the TV towards the PC

    def mid_as_sender():
        res['m2'] = P.sender_handshake(mid_s, 'PC')          # and the PC towards the TV
    ts = [threading.Thread(target=f) for f in (victim_r, mid_as_receiver, mid_as_sender)]
    [t.start() for t in ts]
    res['s'] = P.sender_handshake(s_out, 'PC')
    [t.join(30) for t in ts]
    return res['s'].code != res['r'].code


check(sum(mitm() for _ in range(5)) == 5, 'a man in the middle shows two different codes (5 of 5)')
# version and size limits
a, b = pair_sockets()
P.send_frame(a, json.dumps({'v': 99, 'role': 'send', 'name': 'x', 'commit': '0' * 64}).encode())
try:
    P.receiver_handshake(b, 'TV', timeout=5)
    check(False, 'another protocol version is refused')
except P.PairError as e:
    check(str(e) == 'version', 'another protocol version is refused')
a, b = pair_sockets()
a.sendall(struct.pack('>I', P.HANDSHAKE_MAX + 1))
try:
    P.receiver_handshake(b, 'TV', timeout=5)
    check(False, 'an oversized handshake frame is refused before it is read')
except P.PairError as e:
    check(str(e) == 'too_big', 'an oversized handshake frame is refused before it is read')
a, b = pair_sockets()
t0 = time.time()
try:
    P.receiver_handshake(b, 'TV', timeout=2)
except P.PairError as e:
    check(str(e) == 'timeout' and time.time() - t0 < 4, 'a silent peer ends in a time-out')

# addresses
check(P.parse_address('192.168.1.20:51234') == ('192.168.1.20', 51234), 'address with colon')
check(P.parse_address(' 10.0.0.7 4000 ') == ('10.0.0.7', 4000), 'address with space')
check(P.parse_address('8.8.8.8:53') is None, 'a public address is refused')
check(P.parse_address('192.168.1.300:1') is None and P.parse_address('x') is None, 'nonsense refused')


# ------------------------------------------------------------------ the two flows
class UI(object):
    def __init__(self, accept=True, passwords=(), cancel_after=None):
        self.accept, self.passwords, self.seen, self.code = accept, list(passwords), [], None
        self.cancel_at = time.time() + cancel_after if cancel_after else None

    def status(self, key, **kw):
        self.seen.append(key)

    def confirm_code(self, code, peer):
        self.code = code
        return self.accept

    def ask_password(self, hint):
        return self.passwords.pop(0) if self.passwords else None

    def cancelled(self):
        return bool(self.cancel_at and time.time() > self.cancel_at)


class Telegram(object):
    """the account on Telegram's side: a token minted by the new device, accepted by the configured one"""

    def __init__(self, password=None, expire_first=False):
        self.password, self.accepted, self.tokens, self.expire_first = password, set(), [], expire_first


class NewEngine(object):
    def __init__(self, tg):
        self.tg, self.state, self.ready = tg, None, False

    def authorized(self):
        return self.state == 'ok'

    def wait_ready(self, s, tick=lambda: None):
        for _ in range(int(getattr(self, 'slow_ready', 0) * 4)):     # an engine that needs a while: ticks keep
            time.sleep(0.25)                                         # the other side informed
            tick()
        return True

    def qr_token(self):
        tok = 'tok%d' % len(self.tg.tokens)
        self.tg.tokens.append(tok)
        self.cur = tok
        return tok

    def qr_wait(self, s):
        time.sleep(0.05)
        if self.tg.expire_first and self.cur == 'tok0':
            return 'TimeoutError: token expired'
        if self.cur in self.tg.accepted:
            if self.tg.password:
                if getattr(self, 'qr_over', False):
                    return 'wait'                      # tgclient drops its QR login after SessionPasswordNeeded
                self.qr_over = True
                return 'password'
            self.state = 'ok'
            return 'ok'
        return 'wait'

    def qr_check(self):
        return self.qr_wait(0)

    def sign_in_password(self, pw):
        if pw == self.tg.password:
            self.state = 'ok'
            return 'ok'
        return 'PasswordHashInvalidError'

    def accept_token(self, t):
        return 'not logged in'


class OldEngine(object):
    def __init__(self, tg, logged_in=True):
        self.tg, self.logged_in = tg, logged_in

    def authorized(self):
        return self.logged_in

    def accept_token(self, token):
        if token in self.tg.tokens and not (self.tg.expire_first and token == 'tok0'):
            self.tg.accepted.add(token)
            return 'ok'
        return 'AuthTokenExpiredError'


class Host(object):
    def __init__(self, bundle=None, slow=0.0):
        self.bundle, self.got, self.slow = bundle, None, slow

    def export_bundle(self):
        return self.bundle

    def apply_bundle(self, b, progress=lambda d, t: None):
        n = sum(len(v) for v in b.get('settings', {}).values())
        for i in range(n):
            time.sleep(self.slow)
            progress(i + 1, n)
        self.got = b
        return n


BUNDLE = {'settings': {'plugin.video.telescope': {'api_id': '12345', 'api_hash': 'abc', 'rd_token': 'R'},
                       'plugin.video.nova': {'tmdb_key': 'T', u'lang': u'עברית'}},
          'files': {'iptv.json': {'x': 1}}}


def run(old_ui, new_ui, tg, logged_in=True, before=None):
    lst = P.Listener('TV salon', beacon=False)
    if before:
        before(lst)
    new_eng, new_host = NewEngine(tg), Host()
    res = {}
    t = threading.Thread(target=lambda: res.__setitem__('r', F.run_receiver(new_ui, new_eng, new_host, 'TV salon', listener=lst)))
    t.start()
    t0 = time.time()
    res['s'] = F.run_sender(old_ui, OldEngine(tg, logged_in), Host(BUNDLE), 'PC', ('127.0.0.1', lst.port))
    t.join(60)
    res['secs'] = time.time() - t0
    return res, new_host, new_eng


r, host, eng = run(UI(), UI(), Telegram())
check(r['s']['ok'] and r['r']['ok'] and r['s']['login'] == 'ok' and r['r']['login'] == 'ok', 'full transfer + own Telegram login: %r / %r' % (r['s'], r['r']))
check(host.got == BUNDLE and r['s']['applied'] == 5, 'every setting arrived and was applied')
check(eng.authorized(), 'the new device is logged in with its own session')
check(r['secs'] < 10, 'took %.1f s' % r['secs'])
r, host, eng = run(UI(passwords=['wrong', 'secret']), UI(), Telegram(password='secret'))
check(r['s']['login'] == 'ok' and r['r']['login'] == 'ok' and eng.authorized(), 'two-step password: a wrong one, then the right one, typed on the configured device')
r, host, eng = run(UI(passwords=[]), UI(), Telegram(password='secret'))
check(r['r']['login'].startswith('failed') and not eng.authorized() and host.got == BUNDLE, 'no password given: setup arrives, login does not')
r, host, eng = run(UI(), UI(), Telegram(expire_first=True))
check(r['r']['login'] == 'ok', 'an expired token is replaced by a fresh one: %r' % r['r'])
r, host, eng = run(UI(), UI(accept=False), Telegram())
check(not r['s']['ok'] and not r['r']['ok'] and r['s']['reason'] == 'cancelled' and host.got is None, 'the new device rejects the code: nothing is sent')
r, host, eng = run(UI(accept=False), UI(), Telegram())
check(not r['s']['ok'] and not r['r']['ok'] and host.got is None, 'the configured device rejects the code: nothing is sent')
def scanner(lst):
    for _ in range(3):                              # a port scan: connects and leaves; one that says nothing
        socket.create_connection(('127.0.0.1', lst.port)).close()
    threading.Thread(target=lambda: (lambda c: (time.sleep(3), c.close()))(socket.create_connection(('127.0.0.1', lst.port)))).start()


def run_late(old_ui, new_ui, tg):
    lst = P.Listener('TV salon', beacon=False)
    new_eng, new_host = NewEngine(tg), Host()
    res = {}
    t = threading.Thread(target=lambda: res.__setitem__('r', F.run_receiver(new_ui, new_eng, new_host, 'TV salon', listener=lst)))
    t.start()
    time.sleep(0.5)
    scanner(lst)                                    # while the new device waits
    time.sleep(4)                                   # the real sender comes after the scanner gave up
    res['s'] = F.run_sender(old_ui, OldEngine(tg), Host(BUNDLE), 'PC', ('127.0.0.1', lst.port))
    t.join(60)
    return res, new_host, new_eng


r, host, eng = run_late(UI(), UI(), Telegram())
check(r['s']['ok'] and r['r']['ok'] and host.got == BUNDLE, 'connections that are not a sender (scan, silent peer) do not end the wait: %r' % r['r'])
t0 = time.time()
lst = P.Listener('TV', beacon=False)
silent = socket.create_connection(('127.0.0.1', lst.port))
res = F.run_receiver(UI(cancel_after=2), NewEngine(Telegram()), Host(), 'TV', listener=lst, wait=60)
silent.close()
check(res['reason'] == 'cancelled' and time.time() - t0 < 6, 'Cancel ends the wait at once (%.1f s)' % (time.time() - t0))
t0 = time.time()
r, host, eng = run(UI(accept=False), UI(), Telegram())
check(time.time() - t0 < 3, 'a rejected code ends both sides at once (%.1f s)' % (time.time() - t0))
r, host, eng = run(UI(passwords=['wrong1', 'wrong2', 'wrong3']), UI(), Telegram(password='secret'))
check(r['r']['login'] == 'failed: wrong_password' and host.got == BUNDLE, 'three wrong passwords: login fails cleanly, setup kept: %r' % r['r'])


class BrokenEngine(NewEngine):
    def qr_token(self):
        raise RuntimeError('service_starting')


lst = P.Listener('TV salon', beacon=False)
box = {}
th = threading.Thread(target=lambda: box.__setitem__('r', F.run_receiver(UI(), BrokenEngine(Telegram()), Host(), 'TV salon', listener=lst)))
th.start()
sres = F.run_sender(UI(), OldEngine(Telegram()), Host(BUNDLE), 'PC', ('127.0.0.1', lst.port))
th.join(60)
check(box['r']['ok'] and box['r']['login'].startswith('failed') and sres['ok'], 'an engine error at login: setup reported as arrived, login as failed: %r / %r' % (box['r'], sres))
class FlakyEngine(NewEngine):
    """6.5.1 (K6): the engine restarts while the setup is applied - two checks fall into the restart"""
    flaky = ['service_down: ReadTimeout', 'service_starting']

    def qr_check(self):
        if self.flaky:
            return self.flaky.pop(0)
        return NewEngine.qr_check(self)


class RefusedEngine(NewEngine):
    def qr_check(self):
        return 'AuthTokenInvalidError'

    def qr_wait(self, s):
        return 'AuthTokenInvalidError'


_pause, F.RETRY_PAUSE = F.RETRY_PAUSE, 0.2
check(F.transient('service_down: ReadTimeout') and F.transient('timeout') and not F.transient('AuthTokenInvalidError'),
      'transient engine states are told apart from Telegram answers')
for eng_cls, want in ((FlakyEngine, 'ok'), (RefusedEngine, 'failed: AuthTokenInvalidError')):
    lst = P.Listener('TV salon', beacon=False)
    box, acct = {}, Telegram()
    th = threading.Thread(target=lambda: box.__setitem__('r', F.run_receiver(UI(), eng_cls(acct), Host(), 'TV salon', listener=lst)))
    th.start()
    t0 = time.time()
    F.run_sender(UI(), OldEngine(acct), Host(BUNDLE), 'PC', ('127.0.0.1', lst.port))
    th.join(60)
    check(box['r']['login'] == want and time.time() - t0 < 15,
          '%s: login %r (want %r)' % (eng_cls.__name__, box['r'].get('login'), want))
F.RETRY_PAUSE = _pause
F.ACK_WAIT, F.PROGRESS_EVERY = 2, 0.5               # a slow box: applying takes 5 s, far over the 2 s ack wait
lst = P.Listener('TV salon', beacon=False)
slow_host, box, acct = Host(slow=1.0), {}, Telegram()      # one account seen by both devices
th = threading.Thread(target=lambda: box.__setitem__('r', F.run_receiver(UI(), NewEngine(acct), slow_host, 'TV salon', listener=lst)))
th.start()
sres = F.run_sender(UI(), OldEngine(acct), Host(BUNDLE), 'PC', ('127.0.0.1', lst.port))
th.join(60)
F.ACK_WAIT, F.PROGRESS_EVERY = 120, 3
F.LOGIN_WAIT, F.PROGRESS_EVERY = 2, 0.5              # the new engine needs 5 s to get ready, far over the 2 s wait
acct, lst, box = Telegram(), P.Listener('TV salon', beacon=False), {}
slow_eng = NewEngine(acct)
slow_eng.slow_ready = 5
th = threading.Thread(target=lambda: box.__setitem__('r', F.run_receiver(UI(), slow_eng, Host(), 'TV salon', listener=lst)))
th.start()
sres = F.run_sender(UI(), OldEngine(acct), Host(BUNDLE), 'PC', ('127.0.0.1', lst.port))
th.join(60)
F.LOGIN_WAIT, F.PROGRESS_EVERY = 150, 3
check(sres['ok'] and box['r']['login'] == 'ok', 'a new device whose engine is slow to get ready still logs in (progress): %r / %r' % (sres, box['r']))
check(sres['ok'] and box['r']['ok'] and box['r']['login'] == 'ok' and slow_host.got == BUNDLE,
      'a slow box (apply longer than the wait) completes, kept alive by progress: %r / %r' % (sres, box['r']))
r, host, eng = run(UI(), UI(), Telegram(), logged_in=False)
check(r['s']['ok'] and r['r']['login'] == 'skipped' and host.got == BUNDLE, 'a sender without Telegram sends the setup only')
_s = socket.socket()
_s.bind(('127.0.0.1', 0))
FREE = _s.getsockname()[1]
_s.close()                                                  # a port nobody listens on
check(F.run_sender(UI(), OldEngine(Telegram()), Host(BUNDLE), 'PC', ('127.0.0.1', FREE))['reason'] == 'unreachable', 'nobody listening: unreachable')

# beacon: the configured device hears the new one
lst = P.Listener('TV kitchen')
heard = []
th = threading.Thread(target=lambda: heard.extend(P.listen_beacons(6, stop=lambda f: any(x['id'] == lst.id for x in f))))
th.start()
time.sleep(0.5)
end = time.time() + 5
while th.is_alive() and time.time() < end:
    lst.announce()
    time.sleep(0.2)
th.join(7)
mine = [x for x in heard if x['id'] == lst.id]
lst.close()
check(bool(mine) and mine[0]['port'] == lst.port and mine[0]['name'] == 'TV kitchen', 'the beacon is heard on this network: %r' % mine)

print('\n' + ('PAIRING TESTS OK' if not bad else 'PAIRING TESTS FAILED: %d' % len(bad)))
sys.exit(1 if bad else 0)
