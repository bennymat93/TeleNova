# -*- coding: utf-8 -*-
"""4.2: "Send my setup to another device" - the protocol core (pure Python, no Kodi; docs/RESEARCH-device-transfer.md).

Two devices on one network. The NEW device ("receiver") listens on a TCP port and announces itself with a UDP beacon;
the CONFIGURED device ("sender") hears the beacon (or the viewer types the address the new device shows) and connects.

Handshake (ephemeral Diffie-Hellman, commitment, 6-digit comparison code - the Bluetooth / ZRTP "numeric comparison"):
  1. S -> R  hello  {v, name, commit = SHA-256(pkS | nS)}           S commits before it sees anything of R
  2. R -> S         {v, name, pkR, nR}
  3. S -> R         {pkS, nS}                                        R checks the commitment
  4. both: z = pk_peer ^ x mod p (RFC 3526 group 14), T = SHA-256 of every handshake byte,
     keys = HKDF-SHA256(z, salt=T); code = 6 digits from HMAC(k_code, T)
  The viewer sees the same 6 digits on both screens and confirms on both. A man in the middle had to commit to its
  value before seeing the other one: it matches both codes once in a million, and is otherwise seen at once.
After that every frame is encrypt-then-MAC: SHAKE-256 keystream per (direction, sequence), HMAC-SHA256 tag over
(direction, sequence, ciphertext). A replayed, reordered, cut or changed frame fails the tag and ends the session.

A 6-digit code is never used as a key; nothing here is secret before the handshake; the Telegram session is never
sent (each device gets its own login - see pairflow.py).
"""
import hashlib
import hmac
import json
import os
import socket
import struct
import time

VERSION = 1
BEACON_PORT = 47861
BEACON_MAGIC = 'tn-pair'
MAX_FRAME = 8 * 1024 * 1024
HANDSHAKE_MAX = 64 * 1024

# RFC 3526, 2048-bit MODP group 14 (safe prime; generator 2). Derived from its definition
# 2^2048 - 2^1984 - 1 + 2^64 * (floor(2^1918 * pi) + 124476) - checked in src/qa/t_pairing.py.
P = int(
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD'
    'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED'
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F'
    '83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B'
    'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510'
    '15728E5A8AACAA68FFFFFFFFFFFFFFFF', 16)
G = 2
PLEN = 256


class PairError(Exception):
    """reason codes: 'closed', 'timeout', 'protocol', 'commitment', 'bad_key', 'tag', 'version', 'too_big',
    'cancelled', 'refused'"""


# ------------------------------------------------------------------ primitives
def hkdf(ikm, salt, info, length):
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    out, block, i = b'', b'', 1
    while len(out) < length:
        block = hmac.new(prk, block + info + bytes([i]), hashlib.sha256).digest()
        out += block
        i += 1
    return out[:length]


def keypair():
    x = int.from_bytes(os.urandom(32), 'big') | (1 << 255)       # 256-bit exponent: 128-bit security, as group 14
    return x, pow(G, x, P)


def check_public(y):
    """a peer's public value must be in [2, p-2] and in the prime-order subgroup (y^q == 1, q = (p-1)/2)"""
    if not isinstance(y, int) or not 2 <= y <= P - 2 or pow(y, (P - 1) // 2, P) != 1:
        raise PairError('bad_key')
    return y


def i2b(n):
    return n.to_bytes(PLEN, 'big')


def commit(pk, nonce):
    return hashlib.sha256(b'tn-pair commit' + i2b(pk) + nonce).hexdigest()


def code_digits(k_code, transcript):
    v = int.from_bytes(hmac.new(k_code, b'tn-pair code' + transcript, hashlib.sha256).digest()[:8], 'big')
    return '%06d' % (v % 1000000)


# ------------------------------------------------------------------ framing
def _recv_exact(sock, n, deadline, cancelled=None):
    buf = b''
    while len(buf) < n:
        if cancelled is not None and cancelled():        # review 16/11: Cancel / Kodi exit end any wait at once
            raise PairError('cancelled')
        left = deadline - time.time()
        if left <= 0:
            raise PairError('timeout')
        sock.settimeout(min(left, 0.5))
        try:
            chunk = sock.recv(n - len(buf))
        except socket.timeout:
            continue
        except OSError:
            raise PairError('closed')
        if not chunk:
            raise PairError('closed')
        buf += chunk
    return buf


def send_frame(sock, data):
    if len(data) > MAX_FRAME:
        raise PairError('too_big')
    try:
        sock.sendall(struct.pack('>I', len(data)) + data)
    except OSError:
        raise PairError('closed')


def recv_frame(sock, timeout, limit=MAX_FRAME, cancelled=None):
    deadline = time.time() + timeout
    n = struct.unpack('>I', _recv_exact(sock, 4, deadline, cancelled))[0]
    if n > limit:
        raise PairError('too_big')
    return _recv_exact(sock, n, deadline, cancelled)


def _json(data):
    try:
        obj = json.loads(data.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        raise PairError('protocol')
    if not isinstance(obj, dict):
        raise PairError('protocol')
    return obj


class Channel(object):
    """the encrypted, authenticated connection after the handshake"""

    def __init__(self, sock, keys, role, code, peer_name):
        self.sock = sock
        self.code = code
        self.peer_name = peer_name
        mine, theirs = ('s', 'r') if role == 'send' else ('r', 's')
        self._out = (keys[mine + '_enc'], keys[mine + '_mac'], mine.encode())
        self._in = (keys[theirs + '_enc'], keys[theirs + '_mac'], theirs.encode())
        self._seq_out = 0
        self._seq_in = 0
        self.cancelled = None                            # set by the flow: the viewer's Cancel ends every wait

    @staticmethod
    def _stream(key, d, seq, n):
        return hashlib.shake_256(key + d + struct.pack('>Q', seq)).digest(n)

    def send(self, obj):
        data = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        enc, mac, d = self._out
        seq = self._seq_out
        self._seq_out += 1
        ks = self._stream(enc, d, seq, len(data))
        ct = bytes(a ^ b for a, b in zip(data, ks)) if data else b''
        tag = hmac.new(mac, d + struct.pack('>Q', seq) + ct, hashlib.sha256).digest()
        send_frame(self.sock, tag + ct)

    def recv(self, timeout=120):
        frame = recv_frame(self.sock, timeout, cancelled=self.cancelled)
        if len(frame) < 32:
            raise PairError('tag')
        tag, ct = frame[:32], frame[32:]
        enc, mac, d = self._in
        seq = self._seq_in
        want = hmac.new(mac, d + struct.pack('>Q', seq) + ct, hashlib.sha256).digest()
        if not hmac.compare_digest(tag, want):
            raise PairError('tag')
        self._seq_in += 1
        ks = self._stream(enc, d, seq, len(ct))
        return _json(bytes(a ^ b for a, b in zip(ct, ks)))

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


def _derive(z, transcript):
    raw = hkdf(i2b(z), transcript, b'tn-pair v1 keys', 32 * 5)
    keys = {'s_enc': raw[0:32], 's_mac': raw[32:64], 'r_enc': raw[64:96], 'r_mac': raw[96:128]}
    return keys, code_digits(raw[128:160], transcript)


# ------------------------------------------------------------------ handshake
def sender_handshake(sock, name, timeout=30, cancelled=None):
    """the configured device, connected to the new one -> Channel (call .code to show the digits)"""
    x, pk = keypair()
    nonce = os.urandom(32)
    m1 = json.dumps({'v': VERSION, 'role': 'send', 'name': str(name)[:60], 'commit': commit(pk, nonce)}).encode()
    send_frame(sock, m1)
    m2 = recv_frame(sock, timeout, HANDSHAKE_MAX, cancelled)
    o2 = _json(m2)
    if o2.get('v') != VERSION:
        raise PairError('version')
    if o2.get('refused'):
        raise PairError('refused')
    try:
        pk_r = check_public(int(o2['pk'], 16))
        n_r = bytes.fromhex(o2['n'])
    except (KeyError, ValueError, TypeError):
        raise PairError('protocol')
    if len(n_r) != 32:
        raise PairError('protocol')
    m3 = json.dumps({'pk': '%x' % pk, 'n': nonce.hex()}).encode()
    send_frame(sock, m3)
    t = hashlib.sha256(b'tn-pair transcript' + struct.pack('>III', len(m1), len(m2), len(m3)) + m1 + m2 + m3).digest()
    keys, code = _derive(pow(pk_r, x, P), t)
    return Channel(sock, keys, 'send', code, str(o2.get('name') or '')[:60])


def receiver_handshake(sock, name, timeout=30, cancelled=None):
    """the new device, after accepting the connection -> Channel"""
    m1 = recv_frame(sock, timeout, HANDSHAKE_MAX, cancelled)
    o1 = _json(m1)
    if o1.get('v') != VERSION:
        send_frame(sock, json.dumps({'v': VERSION, 'refused': 'version'}).encode())
        raise PairError('version')
    cm = o1.get('commit')
    if o1.get('role') != 'send' or not isinstance(cm, str) or len(cm) != 64:
        raise PairError('protocol')
    x, pk = keypair()
    nonce = os.urandom(32)
    m2 = json.dumps({'v': VERSION, 'name': str(name)[:60], 'pk': '%x' % pk, 'n': nonce.hex()}).encode()
    send_frame(sock, m2)
    m3 = recv_frame(sock, timeout, HANDSHAKE_MAX, cancelled)
    o3 = _json(m3)
    try:
        pk_s = check_public(int(o3['pk'], 16))
        n_s = bytes.fromhex(o3['n'])
    except (KeyError, ValueError, TypeError):
        raise PairError('protocol')
    if not hmac.compare_digest(commit(pk_s, n_s), cm):
        raise PairError('commitment')
    t = hashlib.sha256(b'tn-pair transcript' + struct.pack('>III', len(m1), len(m2), len(m3)) + m1 + m2 + m3).digest()
    keys, code = _derive(pow(pk_s, x, P), t)
    return Channel(sock, keys, 'receive', code, str(o1.get('name') or '')[:60])


# ------------------------------------------------------------------ network
def local_address():
    """this device's address on the local network (no packet is sent: a UDP 'connect' only picks the route)"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('192.0.2.1', 9))                   # TEST-NET-1: never routed anywhere real
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


class Listener(object):
    """the new device: a TCP port for one sender + a UDP beacon every second"""

    def __init__(self, name, port=0, beacon=True):
        self.name = name
        self.srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(('0.0.0.0', port))
        self.srv.listen(8)                      # room for a burst of scan connections next to the sender
        self.port = self.srv.getsockname()[1]
        self.address = local_address()
        self.id = os.urandom(6).hex()
        self.beacon = beacon
        self._udp = None
        self._last = 0

    def beacon_bytes(self):
        return json.dumps({'m': BEACON_MAGIC, 'v': VERSION, 'name': self.name[:60], 'port': self.port,
                           'id': self.id}).encode('utf-8')

    def announce(self):
        if not self.beacon or time.time() - self._last < 1.0:
            return
        self._last = time.time()
        try:
            if self._udp is None:
                self._udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                self._udp.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            for target in ('255.255.255.255', _subnet_broadcast(self.address)):
                if target:
                    self._udp.sendto(self.beacon_bytes(), (target, BEACON_PORT))
        except OSError:
            pass

    def accept(self, until, cancelled=lambda: False):
        """waits for one connection, announcing itself meanwhile -> socket or None (time up / cancelled)"""
        self.srv.settimeout(0.5)
        while time.time() < until and not cancelled():
            self.announce()
            try:
                conn, _ = self.srv.accept()
                conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                return conn
            except socket.timeout:
                continue
            except OSError:
                return None
        return None

    def close(self):
        for s in (self.srv, self._udp):
            try:
                if s:
                    s.close()
            except OSError:
                pass


def _subnet_broadcast(addr):
    """x.y.z.255 of a /24 home network (most routers); '' for loopback / unknown"""
    parts = (addr or '').split('.')
    if len(parts) != 4 or parts[0] in ('127', '0'):
        return ''
    return '.'.join(parts[:3] + ['255'])


def listen_beacons(seconds, stop=lambda found: False):
    """the configured device: new devices that announce themselves -> [{'name', 'host', 'port', 'id'}]"""
    found = {}
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(('', BEACON_PORT))
    except OSError:
        s.close()
        return []
    s.settimeout(0.5)
    end = time.time() + seconds
    try:
        while time.time() < end:
            try:
                data, (host, _) = s.recvfrom(2048)
            except socket.timeout:
                if stop(list(found.values())):
                    break
                continue
            except OSError:
                break
            try:
                o = json.loads(data.decode('utf-8'))
                if o.get('m') != BEACON_MAGIC or o.get('v') != VERSION:
                    continue
                port = int(o['port'])
                if not 0 < port < 65536:
                    continue
                found[o.get('id') or host] = {'name': str(o.get('name') or host)[:60], 'host': host, 'port': port,
                                              'id': str(o.get('id') or '')}
            except (ValueError, KeyError, TypeError, UnicodeDecodeError):
                continue
            if stop(list(found.values())):
                break
    finally:
        s.close()
    return list(found.values())


def parse_address(text):
    """'192.168.1.20:51234' / '192.168.1.20 51234' -> (host, port) or None (only private / link-local IPv4)"""
    import re
    m = re.match(r'^\s*(\d{1,3}(?:\.\d{1,3}){3})\s*[: ]\s*(\d{1,5})\s*$', text or '')
    if not m:
        return None
    host, port = m.group(1), int(m.group(2))
    p = [int(x) for x in host.split('.')]
    if any(x > 255 for x in p) or not 0 < port < 65536:
        return None
    private = p[0] == 10 or (p[0] == 172 and 16 <= p[1] <= 31) or (p[0] == 192 and p[1] == 168) or \
        (p[0] == 169 and p[1] == 254) or p[0] == 127
    return (host, port) if private else None


def connect(host, port, timeout=8):
    s = socket.create_connection((host, int(port)), timeout=timeout)
    s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    return s
