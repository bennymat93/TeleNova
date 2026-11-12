# -*- coding: utf-8 -*-
"""3.3.3: what the FILE says about itself, read from the bytes the link test downloads anyway.

A file name can promise anything. The first 128 KiB of a Matroska / MP4 file hold the real duration, the picture
size and the list of audio / subtitle tracks with their languages - enough to tell a full movie from a sample and
to know for certain that Hebrew subtitles are inside. No extra request is made: inspect() gets the probe sample.

Everything here is defensive: a truncated or odd header yields less information, never an exception.
"""
import struct

LANG = {'heb': 'he', 'he': 'he', 'iw': 'he', 'rus': 'ru', 'ru': 'ru', 'eng': 'en', 'en': 'en',
        'ara': 'ar', 'ar': 'ar', 'fre': 'fr', 'fra': 'fr', 'fr': 'fr', 'spa': 'es', 'es': 'es',
        'ger': 'de', 'deu': 'de', 'de': 'de', 'ukr': 'uk', 'uk': 'uk'}

# Matroska element ids
_SEGMENT, _INFO, _TRACKS, _ENTRY, _VIDEO = 0x18538067, 0x1549A966, 0x1654AE6B, 0xAE, 0xE0
_CLUSTER, _CUES, _ATTACH, _CHAPTERS, _TAGS = 0x1F43B675, 0x1C53BB6B, 0x1941A469, 0x1043A770, 0x1254C367
_SCALE, _DURATION, _TITLE = 0x2AD7B1, 0x4489, 0x7BA9
_TTYPE, _TLANG, _TLANG2, _TNAME, _TCODEC = 0x83, 0x22B59C, 0x22B59D, 0x536E, 0x86
_PW, _PH = 0xB0, 0xBA
_MASTERS = (_SEGMENT, _INFO, _TRACKS, _ENTRY, _VIDEO)
_STOP = (_CLUSTER, _CUES)


def lang_code(raw):
    raw = (raw or '').strip().lower().split('-')[0]
    return LANG.get(raw, raw if raw and raw not in ('und', 'zxx', 'mul', '```') else '')


def _vint(data, pos, keep_marker):
    """EBML variable-length integer -> (value, new position) or (None, pos) at the end of the data."""
    if pos >= len(data):
        return None, pos
    first = data[pos]
    if first == 0:
        return None, pos
    length = 1
    mask = 0x80
    while not (first & mask):
        mask >>= 1
        length += 1
    if pos + length > len(data):
        return None, pos
    value = first if keep_marker else first & (mask - 1)
    for b in data[pos + 1:pos + length]:
        value = (value << 8) | b
    if not keep_marker and value == (1 << (7 * length)) - 1:
        value = -1                               # "unknown size" (live muxing)
    return value, pos + length


def _uint(raw):
    v = 0
    for b in raw[:8]:
        v = (v << 8) | b
    return v


def _float(raw):
    try:
        if len(raw) == 4:
            return struct.unpack('>f', raw)[0]
        if len(raw) == 8:
            return struct.unpack('>d', raw)[0]
    except struct.error:
        pass
    return 0.0


def _text(raw):
    try:
        return bytes(raw).split(b'\x00')[0].decode('utf-8', 'replace').strip()
    except Exception:
        return ''


def _mkv_walk(data, pos, end, visit, depth=0):
    """Calls visit(id, payload bytes) for every leaf; descends into the masters we care about. A master that runs
    past the sample is read as far as the sample goes."""
    guard = 0
    while pos < end and guard < 4000:
        guard += 1
        eid, p = _vint(data, pos, True)
        if eid is None:
            return
        size, p = _vint(data, p, False)
        if size is None:
            return
        if eid in _STOP:
            return
        stop = end if size < 0 else min(end, p + size)
        if eid in _MASTERS and depth < 6:
            if eid == _ENTRY:
                visit(_ENTRY, None)
            _mkv_walk(data, p, stop, visit, depth + 1)
        elif size >= 0 and p + size <= end:
            visit(eid, data[p:p + size])
        if size < 0:
            return
        pos = p + size


def _mkv(data):
    info = {'container': 'mkv', 'duration': 0, 'title': '', 'tracks': []}
    state = {'scale': 1000000, 'dur': 0.0, 'cur': None}

    def visit(eid, raw):
        if eid == _ENTRY:
            state['cur'] = {'type': '', 'lang': 'en', 'name': '', 'codec': ''}   # Matroska's default language is English
            info['tracks'].append(state['cur'])
            return
        cur = state['cur']
        if eid == _SCALE:
            state['scale'] = _uint(raw) or 1000000
        elif eid == _DURATION:
            state['dur'] = _float(raw)
        elif eid == _TITLE:
            info['title'] = _text(raw)[:200]
        elif cur is not None:
            if eid == _TTYPE:
                cur['type'] = {1: 'video', 2: 'audio', 0x11: 'sub'}.get(_uint(raw), '')
            elif eid == _TLANG and not cur.get('bcp'):
                cur['lang'] = lang_code(_text(raw))
            elif eid == _TLANG2:
                cur['lang'] = lang_code(_text(raw))
                cur['bcp'] = True
            elif eid == _TNAME:
                cur['name'] = _text(raw)[:80]
            elif eid == _TCODEC:
                cur['codec'] = _text(raw)[:40]
            elif eid == _PW:
                cur['width'] = _uint(raw)
            elif eid == _PH:
                cur['height'] = _uint(raw)

    # the EBML header first, then the Segment
    eid, p = _vint(data, 0, True)
    size, p = _vint(data, p, False)
    if eid != 0x1A45DFA3 or size is None or size < 0:
        return info
    _mkv_walk(data, p + size, len(data), visit)
    if state['dur'] > 0:
        info['duration'] = int(state['dur'] * state['scale'] / 1e9)
    return info


# ------------------------------------------------------------------ MP4 / MOV
_MP4_PARENTS = (b'moov', b'trak', b'mdia')


def _mp4_lang(packed):
    if not packed or packed == 0x7FFF or packed == 0x55C4:
        return ''
    chars = [((packed >> shift) & 0x1F) + 0x60 for shift in (10, 5, 0)]
    if all(0x61 <= c <= 0x7A for c in chars):
        return lang_code(''.join(chr(c) for c in chars))
    return ''


def _mp4_walk(data, pos, end, info, cur, depth=0):
    guard = 0
    while pos + 8 <= end and guard < 2000:
        guard += 1
        size, kind = struct.unpack('>I4s', data[pos:pos + 8])
        head = 8
        if size == 1:
            if pos + 16 > end:
                return
            size = struct.unpack('>Q', data[pos + 8:pos + 16])[0]
            head = 16
        elif size == 0:
            size = end - pos
        if size < head:
            return
        body, stop = pos + head, min(end, pos + size)
        if kind in _MP4_PARENTS and depth < 5:
            nxt = cur
            if kind == b'trak':
                nxt = {'type': '', 'lang': '', 'name': '', 'codec': ''}
                info['tracks'].append(nxt)
            _mp4_walk(data, body, stop, info, nxt, depth + 1)
        elif kind == b'mvhd' and stop - body >= 20:
            ver = data[body]
            try:
                if ver == 1 and stop - body >= 32:
                    scale, dur = struct.unpack('>IQ', data[body + 20:body + 32])
                else:
                    scale, dur = struct.unpack('>II', data[body + 12:body + 20])
                if scale and dur not in (0xFFFFFFFF, 0xFFFFFFFFFFFFFFFF):
                    info['duration'] = int(dur / float(scale))
            except struct.error:
                pass
        elif kind == b'mdhd' and cur is not None and stop - body >= 22:
            ver = data[body]
            off = body + (32 if ver == 1 else 20)
            if off + 2 <= stop:
                cur['lang'] = _mp4_lang(struct.unpack('>H', data[off:off + 2])[0])
        elif kind == b'hdlr' and cur is not None and stop - body >= 12:
            cur['type'] = {b'vide': 'video', b'soun': 'audio', b'sbtl': 'sub', b'subt': 'sub',
                           b'text': 'sub', b'clcp': 'sub'}.get(bytes(data[body + 8:body + 12]), cur['type'])
        elif kind == b'tkhd' and cur is not None:
            ver = data[body] if body < stop else 0
            off = body + (88 if ver == 1 else 76)
            if off + 8 <= stop:
                w, h = struct.unpack('>II', data[off:off + 8])
                if w >> 16 and h >> 16:
                    cur['width'], cur['height'] = w >> 16, h >> 16
        pos += size


def _mp4(data):
    info = {'container': 'mp4', 'duration': 0, 'title': '', 'tracks': []}
    _mp4_walk(data, 0, len(data), info, None)
    info['tracks'] = [t for t in info['tracks'] if t.get('type')]
    return info


# ------------------------------------------------------------------ public
def inspect(data):
    """-> {'container', 'duration' (s), 'title', 'width', 'height', 'video' codec, 'audio': [langs], 'subs': [langs],
    'known': True when the track list was readable}. Empty dict for anything that is not Matroska / MP4."""
    try:
        if not data or len(data) < 16:
            return {}
        data = bytes(data)
        if data[:4] == b'\x1a\x45\xdf\xa3':
            info = _mkv(data)
        elif data[4:8] in (b'ftyp', b'moov', b'free', b'wide', b'skip', b'mdat'):
            info = _mp4(data)
        else:
            return {}
    except Exception:
        return {}
    out = {'container': info['container'], 'duration': int(info.get('duration') or 0),
           'title': info.get('title') or '', 'width': 0, 'height': 0, 'video': '', 'audio': [], 'subs': []}
    for t in info.get('tracks') or []:
        name = (t.get('name') or '').lower()
        if t.get('lang') in ('', 'en') and name:        # an untagged ("und") track that is NAMED Hebrew / Russian
            if u'עברית' in name or 'hebrew' in name or name in ('heb', 'he'):
                t['lang'] = 'he'
            elif u'рус' in name or 'russian' in name or name in ('rus', 'ru'):
                t['lang'] = 'ru'
        if t.get('type') == 'video' and not out['width']:
            out['width'], out['height'] = int(t.get('width') or 0), int(t.get('height') or 0)
            out['video'] = codec_name(t.get('codec') or '')
        elif t.get('type') == 'audio':
            out['audio'].append(t.get('lang') or '')
        elif t.get('type') == 'sub':
            out['subs'].append(t.get('lang') or '')
    out['known'] = bool(info.get('tracks'))
    return out


def codec_name(codec_id):
    c = (codec_id or '').upper()
    if 'HEVC' in c or 'H265' in c:
        return 'HEVC'
    if 'AVC' in c or 'H264' in c:
        return 'H.264'
    if 'AV1' in c:
        return 'AV1'
    if 'VP9' in c:
        return 'VP9'
    return ''


def quality_of(width, height):
    """Release-style quality from the real picture size (a 1920x800 scope film is 1080p)."""
    w, h = int(width or 0), int(height or 0)
    if w >= 3200 or h >= 1800:
        return 2160
    if w >= 1800 or h >= 1000:
        return 1080
    if w >= 1200 or h >= 700:
        return 720
    if w or h:
        return 480
    return 0
