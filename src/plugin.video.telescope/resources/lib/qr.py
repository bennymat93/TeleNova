# -*- coding: utf-8 -*-
"""4.2.9: a small QR code encoder (ISO/IEC 18004, byte mode, versions 1-40) and a PNG writer, pure Python + zlib.

Why our own: the pairing link of the web version carries the Telegram API hash, and a login QR carries a login
token - neither may be sent to an outside "make me a QR picture" service. Everything here runs on the device.

    from . import qr
    qr.write_png(qr.encode('https://...'), '/path/file.png', scale=8)

The same file is copied into plugin.video.telescope/resources/lib/qr.py (keep the two identical).
Python 2.7 / 3.8+ compatible, no Kodi imports, no network."""
import struct
import zlib

# error correction level -> the 2 format bits of the standard
_ECL_BITS = {'L': 1, 'M': 0, 'Q': 3, 'H': 2}
_ECL_ORDER = 'LMQH'

# per version (1..40), per level L, M, Q, H: (ec codewords per block, blocks of group 1, data codewords in a group 1
# block, blocks of group 2 [their blocks hold one data codeword more]). Checked at import against the module count.
_BLOCKS = [
    None,
    ((7, 1, 19, 0), (10, 1, 16, 0), (13, 1, 13, 0), (17, 1, 9, 0)),
    ((10, 1, 34, 0), (16, 1, 28, 0), (22, 1, 22, 0), (28, 1, 16, 0)),
    ((15, 1, 55, 0), (26, 1, 44, 0), (18, 2, 17, 0), (22, 2, 13, 0)),
    ((20, 1, 80, 0), (18, 2, 32, 0), (26, 2, 24, 0), (16, 4, 9, 0)),
    ((26, 1, 108, 0), (24, 2, 43, 0), (18, 2, 15, 2), (22, 2, 11, 2)),
    ((18, 2, 68, 0), (16, 4, 27, 0), (24, 4, 19, 0), (28, 4, 15, 0)),
    ((20, 2, 78, 0), (18, 4, 31, 0), (18, 2, 14, 4), (26, 4, 13, 1)),
    ((24, 2, 97, 0), (22, 2, 38, 2), (22, 4, 18, 2), (26, 4, 14, 2)),
    ((30, 2, 116, 0), (22, 3, 36, 2), (20, 4, 16, 4), (24, 4, 12, 4)),
    ((18, 2, 68, 2), (26, 4, 43, 1), (24, 6, 19, 2), (28, 6, 15, 2)),
    ((20, 4, 81, 0), (30, 1, 50, 4), (28, 4, 22, 4), (24, 3, 12, 8)),
    ((24, 2, 92, 2), (22, 6, 36, 2), (26, 4, 20, 6), (28, 7, 14, 4)),
    ((26, 4, 107, 0), (22, 8, 37, 1), (24, 8, 20, 4), (22, 12, 11, 4)),
    ((30, 3, 115, 1), (24, 4, 40, 5), (20, 11, 16, 5), (24, 11, 12, 5)),
    ((22, 5, 87, 1), (24, 5, 41, 5), (30, 5, 24, 7), (24, 11, 12, 7)),
    ((24, 5, 98, 1), (28, 7, 45, 3), (24, 15, 19, 2), (30, 3, 15, 13)),
    ((28, 1, 107, 5), (28, 10, 46, 1), (28, 1, 22, 15), (28, 2, 14, 17)),
    ((30, 5, 120, 1), (26, 9, 43, 4), (28, 17, 22, 1), (28, 2, 14, 19)),
    ((28, 3, 113, 4), (26, 3, 44, 11), (26, 17, 21, 4), (26, 9, 13, 16)),
    ((28, 3, 107, 5), (26, 3, 41, 13), (30, 15, 24, 5), (28, 15, 15, 10)),
    ((28, 4, 116, 4), (26, 17, 42, 0), (28, 17, 22, 6), (30, 19, 16, 6)),
    ((28, 2, 111, 7), (28, 17, 46, 0), (30, 7, 24, 16), (24, 34, 13, 0)),
    ((30, 4, 121, 5), (28, 4, 47, 14), (30, 11, 24, 14), (30, 16, 15, 14)),
    ((30, 6, 117, 4), (28, 6, 45, 14), (30, 11, 24, 16), (30, 30, 16, 2)),
    ((26, 8, 106, 4), (28, 8, 47, 13), (30, 7, 24, 22), (30, 22, 15, 13)),
    ((28, 10, 114, 2), (28, 19, 46, 4), (28, 28, 22, 6), (30, 33, 16, 4)),
    ((30, 8, 122, 4), (28, 22, 45, 3), (30, 8, 23, 26), (30, 12, 15, 28)),
    ((30, 3, 117, 10), (28, 3, 45, 23), (30, 4, 24, 31), (30, 11, 15, 31)),
    ((30, 7, 116, 7), (28, 21, 45, 7), (30, 1, 23, 37), (30, 19, 15, 26)),
    ((30, 5, 115, 10), (28, 19, 47, 10), (30, 15, 24, 25), (30, 23, 15, 25)),
    ((30, 13, 115, 3), (28, 2, 46, 29), (30, 42, 24, 1), (30, 23, 15, 28)),
    ((30, 17, 115, 0), (28, 10, 46, 23), (30, 10, 24, 35), (30, 19, 15, 35)),
    ((30, 17, 115, 1), (28, 14, 46, 21), (30, 29, 24, 19), (30, 11, 15, 46)),
    ((30, 13, 115, 6), (28, 14, 46, 23), (30, 44, 24, 7), (30, 59, 16, 1)),
    ((30, 12, 121, 7), (28, 12, 47, 26), (30, 39, 24, 14), (30, 22, 15, 41)),
    ((30, 6, 121, 14), (28, 6, 47, 34), (30, 46, 24, 10), (30, 2, 15, 64)),
    ((30, 17, 122, 4), (28, 29, 46, 14), (30, 49, 24, 10), (30, 24, 15, 46)),
    ((30, 4, 122, 18), (28, 13, 46, 32), (30, 48, 24, 14), (30, 42, 15, 32)),
    ((30, 20, 117, 4), (28, 40, 47, 7), (30, 43, 24, 22), (30, 10, 15, 67)),
    ((30, 19, 118, 6), (28, 18, 47, 31), (30, 34, 24, 34), (30, 20, 15, 61)),
]


def raw_codewords(ver):
    """all the codewords (data + error correction) a symbol of this version holds"""
    n = (16 * ver + 128) * ver + 64
    if ver >= 2:
        na = ver // 7 + 2
        n -= (25 * na - 10) * na - 55
        if ver >= 7:
            n -= 36
    return n // 8


def data_codewords(ver, ecl):
    ec, b1, d1, b2 = _BLOCKS[ver][_ECL_ORDER.index(ecl)]
    return b1 * d1 + b2 * (d1 + 1)


def _check_table():
    for ver in range(1, 41):
        for ec, b1, d1, b2 in _BLOCKS[ver]:
            if b1 * (d1 + ec) + b2 * (d1 + 1 + ec) != raw_codewords(ver):
                raise AssertionError('qr table, version %d' % ver)


_check_table()

# ---------------------------------------------------------------- GF(256) and Reed-Solomon (polynomial 0x11D)
_EXP = [0] * 512
_LOG = [0] * 256
_x = 1
for _i in range(255):
    _EXP[_i] = _x
    _LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for _i in range(255, 512):
    _EXP[_i] = _EXP[_i - 255]


def _mul(a, b):
    return 0 if a == 0 or b == 0 else _EXP[_LOG[a] + _LOG[b]]


def _rs_generator(degree):
    """coefficients of prod(x - a^i), i < degree, highest power first, the leading 1 left out"""
    g = [1]
    for i in range(degree):
        nxt = [0] * (len(g) + 1)
        for j, c in enumerate(g):
            nxt[j] ^= c
            nxt[j + 1] ^= _mul(c, _EXP[i])
        g = nxt
    return g[1:]


def rs_remainder(data, degree):
    gen = _rs_generator(degree)
    rem = [0] * degree
    for b in data:
        factor = b ^ rem.pop(0)
        rem.append(0)
        if factor:
            for i, c in enumerate(gen):
                rem[i] ^= _mul(c, factor)
    return rem


# ---------------------------------------------------------------- the symbol
def alignment_positions(ver):
    if ver == 1:
        return []
    num = ver // 7 + 2
    size = ver * 4 + 17
    step = 26 if ver == 32 else (ver * 4 + num * 2 + 1) // (num * 2 - 2) * 2
    out = [size - 7 - i * step for i in range(num - 1)]
    return [6] + sorted(out)


def _bch_format(ecl, mask):
    data = (_ECL_BITS[ecl] << 3) | mask
    rem = data
    for _ in range(10):
        rem = (rem << 1) ^ ((rem >> 9) * 0x537)
    return ((data << 10) | (rem & 0x3FF)) ^ 0x5412


def _bch_version(ver):
    rem = ver
    for _ in range(12):
        rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
    return (ver << 12) | (rem & 0xFFF)


_MASKS = (
    lambda x, y: (x + y) % 2 == 0,
    lambda x, y: y % 2 == 0,
    lambda x, y: x % 3 == 0,
    lambda x, y: (x + y) % 3 == 0,
    lambda x, y: (x // 3 + y // 2) % 2 == 0,
    lambda x, y: x * y % 2 + x * y % 3 == 0,
    lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
    lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0,
)


class _Symbol(object):
    def __init__(self, ver):
        self.ver = ver
        self.size = n = ver * 4 + 17
        self.m = [[False] * n for _ in range(n)]       # m[y][x], True = dark
        self.fn = [[False] * n for _ in range(n)]      # the function patterns (not data, never masked)
        self._functions()

    def put(self, x, y, dark):
        self.m[y][x] = bool(dark)
        self.fn[y][x] = True

    def _functions(self):
        n = self.size
        for i in range(n):
            self.put(6, i, i % 2 == 0)
            self.put(i, 6, i % 2 == 0)
        for cx, cy in ((3, 3), (n - 4, 3), (3, n - 4)):
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    x, y = cx + dx, cy + dy
                    if 0 <= x < n and 0 <= y < n:
                        self.put(x, y, max(abs(dx), abs(dy)) not in (2, 4))
        pos = alignment_positions(self.ver)
        last = len(pos) - 1
        for i, ax in enumerate(pos):
            for j, ay in enumerate(pos):
                if (i, j) in ((0, 0), (0, last), (last, 0)):
                    continue
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        self.put(ax + dx, ay + dy, max(abs(dx), abs(dy)) != 1)
        self.format_bits('L', 0)                       # reserves the area; drawn again with the real mask
        if self.ver >= 7:
            bits = _bch_version(self.ver)
            for i in range(18):
                dark = (bits >> i) & 1
                a, b = n - 11 + i % 3, i // 3
                self.put(a, b, dark)
                self.put(b, a, dark)

    def format_bits(self, ecl, mask):
        n = self.size
        bits = _bch_format(ecl, mask)
        bit = lambda i: (bits >> i) & 1
        for i in range(6):
            self.put(8, i, bit(i))
        self.put(8, 7, bit(6))
        self.put(8, 8, bit(7))
        self.put(7, 8, bit(8))
        for i in range(9, 15):
            self.put(14 - i, 8, bit(i))
        for i in range(8):
            self.put(n - 1 - i, 8, bit(i))
        for i in range(8, 15):
            self.put(8, n - 15 + i, bit(i))
        self.put(8, n - 8, True)                       # the dark module

    def place(self, codewords):
        n, i, total = self.size, 0, len(codewords) * 8
        right = n - 1
        while right >= 1:
            if right == 6:
                right = 5
            up = ((right + 1) & 2) == 0
            for vert in range(n):
                y = n - 1 - vert if up else vert
                for j in range(2):
                    x = right - j
                    if not self.fn[y][x] and i < total:
                        self.m[y][x] = bool((codewords[i >> 3] >> (7 - (i & 7))) & 1)
                        i += 1
            right -= 2

    def apply_mask(self, mask):
        f = _MASKS[mask]
        for y in range(self.size):
            row, fn = self.m[y], self.fn[y]
            for x in range(self.size):
                if not fn[x] and f(x, y):
                    row[x] = not row[x]


def _penalty(m):
    n = len(m)
    score = 0
    lines = [row for row in m] + [[m[y][x] for y in range(n)] for x in range(n)]
    pat1 = [True, False, True, True, True, False, True, False, False, False, False]
    pat2 = pat1[::-1]
    for line in lines:
        run, prev = 0, None
        for v in line:
            if v == prev:
                run += 1
            else:
                if run >= 5:
                    score += run - 2
                run, prev = 1, v
        if run >= 5:
            score += run - 2
        for i in range(n - 10):
            seg = line[i:i + 11]
            if seg == pat1 or seg == pat2:
                score += 40
    for y in range(n - 1):
        for x in range(n - 1):
            v = m[y][x]
            if v == m[y][x + 1] == m[y + 1][x] == m[y + 1][x + 1]:
                score += 3
    dark = sum(sum(1 for v in row if v) for row in m)
    total = n * n
    score += ((abs(dark * 20 - total * 10) + total - 1) // total - 1) * 10     # total is odd: never exactly 50%
    return score


def _bits_for(data, ver):
    count_bits = 8 if ver <= 9 else 16
    return 4 + count_bits + 8 * len(data)


def encode(text, ecl='M', mask=None):
    """the QR matrix of `text` (str/unicode as UTF-8, or bytes): a list of rows of booleans, True = dark,
    without the quiet zone"""
    if ecl not in _ECL_BITS:
        raise ValueError('ecl')
    data = bytearray(text.encode('utf-8') if not isinstance(text, (bytes, bytearray)) else text)
    ver = None
    for v in range(1, 41):
        if len(data) < (1 << (8 if v <= 9 else 16)) and _bits_for(data, v) <= data_codewords(v, ecl) * 8:
            ver = v
            break
    if ver is None:
        raise ValueError('too long for a QR code')
    cap = data_codewords(ver, ecl)
    bits = []

    def add(value, length):
        for i in range(length - 1, -1, -1):
            bits.append((value >> i) & 1)
    add(4, 4)
    add(len(data), 8 if ver <= 9 else 16)
    for b in data:
        add(b, 8)
    add(0, min(4, cap * 8 - len(bits)))
    add(0, (8 - len(bits) % 8) % 8)
    words = [int(''.join(str(b) for b in bits[i:i + 8]), 2) for i in range(0, len(bits), 8)]
    pad = 0xEC
    while len(words) < cap:
        words.append(pad)
        pad ^= 0xEC ^ 0x11
    ec, b1, d1, b2 = _BLOCKS[ver][_ECL_ORDER.index(ecl)]
    blocks, k = [], 0
    for i in range(b1 + b2):
        size = d1 + (1 if i >= b1 else 0)
        blocks.append((words[k:k + size], rs_remainder(words[k:k + size], ec)))
        k += size
    out = []
    for i in range(d1 + 1):
        for d, _ in blocks:
            if i < len(d):
                out.append(d[i])
    for i in range(ec):
        for _, e in blocks:
            out.append(e[i])
    best = None
    for msk in ([mask] if mask is not None else range(8)):
        s = _Symbol(ver)
        s.place(out)
        s.apply_mask(msk)
        s.format_bits(ecl, msk)
        p = _penalty(s.m)
        if best is None or p < best[0]:
            best = (p, s.m)
    return best[1]


# ---------------------------------------------------------------- PNG
def png_bytes(matrix, scale=8, border=4):
    """a black-on-white 8-bit grayscale PNG of the matrix, with a quiet zone of `border` modules"""
    n = len(matrix)
    side = (n + 2 * border) * scale
    raw = bytearray()
    white = bytearray([255]) * side
    for y in range(-border, n + border):
        if 0 <= y < n:
            line = bytearray()
            for x in range(-border, n + border):
                dark = 0 <= x < n and matrix[y][x]
                line += bytearray([0 if dark else 255]) * scale
        else:
            line = white
        for _ in range(scale):
            raw += b'\x00' + bytes(line)

    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xFFFFFFFF)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', side, side, 8, 0, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))


def write_png(matrix, path, scale=8, border=4):
    with open(path, 'wb') as f:
        f.write(png_bytes(matrix, scale, border))
    return path
