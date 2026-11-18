# -*- coding: utf-8 -*-
"""4.3: what a player needs to know about a file BEFORE it is listed - read from the bytes the link test has anyway.

 - Matroska: is there a seek index (Cues)? Without one every jump in the film scans the file - listed lower.
 - MP4: where is the 'moov' box? In the head: fine. After the picture data: the place is computed from the size of
   'mdat' and one read there proves it. Nowhere (the file ends inside 'mdat'): no player can open it - not listed.
 - Dolby Vision, read from the track header (dvcC / dvvC record): the profile and whether an HDR10 / SDR / HLG
   picture lies underneath. Profile 5 has none: a screen without Dolby Vision shows it green and purple.
 - HDR10 / HLG from the colour description, the video codec (AV1) and the sound formats (TrueHD, DTS, E-AC-3).

device_caps() says what this device can show, judge() turns flags + device into: hide / move down / move up.
Everything is defensive: a truncated or odd header yields less information, never an exception.
"""
import struct

from .mediainfo import _vint, _uint, _text

# ------------------------------------------------------------------ Matroska
_EBML, _SEGMENT, _SEEKHEAD, _SEEK, _SEEKID, _SEEKPOS = 0x1A45DFA3, 0x18538067, 0x114D9B74, 0x4DBB, 0x53AB, 0x53AC
_TRACKS, _ENTRY, _CLUSTER, _CUES = 0x1654AE6B, 0xAE, 0x1F43B675, 0x1C53BB6B
_TTYPE, _TCODEC, _VIDEO, _COLOUR, _TRANSFER = 0x83, 0x86, 0xE0, 0x55B0, 0x55BA
_BAMAP, _BATYPE, _BAEXTRA = 0x41E4, 0x41E7, 0x41ED
_DVCC, _DVVC = 0x64766343, 0x64767643            # 'dvcC', 'dvvC' as numbers (BlockAddIDType)

_V_CODECS = (('HEVC', 'hevc'), ('H265', 'hevc'), ('AVC', 'avc'), ('AV1', 'av1'), ('VP9', 'vp9'))
_A_CODECS = (('TRUEHD', 'truehd'), ('MLP', 'truehd'), ('DTS', 'dts'), ('EAC3', 'eac3'), ('AC3', 'ac3'),
             ('AAC', 'aac'), ('OPUS', 'opus'), ('FLAC', 'flac'))
_MP4_VIDEO = {b'hvc1': 'hevc', b'hev1': 'hevc', b'dvh1': 'hevc', b'dvhe': 'hevc', b'avc1': 'avc', b'avc3': 'avc',
              b'dva1': 'avc', b'dvav': 'avc', b'av01': 'av1', b'dav1': 'av1', b'vp09': 'vp9'}
_MP4_DV_ENTRY = (b'dvh1', b'dvhe', b'dva1', b'dvav', b'dav1')
_MP4_AUDIO = {b'mp4a': 'aac', b'ec-3': 'eac3', b'ac-3': 'ac3', b'mlpa': 'truehd', b'dtsc': 'dts', b'dtse': 'dts',
              b'dtsh': 'dtshd', b'dtsl': 'dtshd', b'dtsx': 'dtshd', b'Opus': 'opus', b'fLaC': 'flac'}
_MP4_TOP = (b'ftyp', b'moov', b'mdat', b'free', b'skip', b'wide', b'uuid', b'moof', b'mfra', b'meta', b'sidx',
            b'styp', b'pnot', b'PICT', b'pdin', b'junk', b'prfl', b'emsg', b'bloc', b'ssix', b'mfro')


def _blank(container):
    return {'container': container, 'video': '', 'audio': [], 'hdr_type': '', 'dv': False, 'dv_profile': None,
            'dv_fallback': None, 'cues': None, 'moov': None, 'next': None, 'known': False}


def dovi_record(raw):
    """DOVIDecoderConfigurationRecord -> (profile, fallback) or (None, None).
    fallback: True when an HDR10 / SDR / HLG picture lies underneath, False when there is none (profile 5)."""
    raw = bytes(raw or b'')
    if len(raw) < 4:
        return None, None
    profile = raw[2] >> 1
    if not 0 < profile <= 20:
        return None, None
    compat = raw[4] >> 4 if len(raw) > 4 else None
    if profile == 5:
        fallback = False
    elif profile == 7 or compat in (1, 2, 4):
        fallback = True
    elif compat == 0:
        fallback = False
    else:
        fallback = None
    return profile, fallback


def _kids(data, pos, end):
    """EBML children of one master -> [(id, payload start, payload end, whole payload is in the sample)]"""
    out, guard = [], 0
    while pos < end and guard < 3000:
        guard += 1
        eid, p = _vint(data, pos, True)
        if eid is None:
            break
        size, p = _vint(data, p, False)
        if size is None:
            break
        if size < 0:
            out.append((eid, p, end, False))
            break
        out.append((eid, p, min(end, p + size), p + size <= end))
        pos = p + size
    return out


def _codec(table, codec_id):
    c = (codec_id or '').upper().replace('.', '').replace('-', '')
    for mark, name in table:
        if mark in c:
            return name
    return ''


def _mkv_track(data, a, b, out):
    kind, codec, transfer, dv = 0, '', 0, None
    for eid, p, e, whole in _kids(data, a, b):
        if not whole and eid not in (_VIDEO, _BAMAP):
            continue
        if eid == _TTYPE:
            kind = _uint(data[p:e])
        elif eid == _TCODEC:
            codec = _text(data[p:e])
        elif eid == _VIDEO:
            for i2, p2, e2, w2 in _kids(data, p, e):
                if i2 == _COLOUR:
                    for i3, p3, e3, w3 in _kids(data, p2, e2):
                        if i3 == _TRANSFER and w3:
                            transfer = _uint(data[p3:e3])
        elif eid == _BAMAP:
            btype, extra = 0, b''
            for i2, p2, e2, w2 in _kids(data, p, e):
                if i2 == _BATYPE and w2:
                    btype = _uint(data[p2:e2])
                elif i2 == _BAEXTRA and w2:
                    extra = data[p2:e2]
            if btype in (_DVCC, _DVVC) and extra:
                dv = dovi_record(extra)
    if kind == 1 and not out['video']:
        out['video'] = _codec(_V_CODECS, codec)
        out['known'] = True
        if dv and dv[0]:
            out['dv'], out['dv_profile'], out['dv_fallback'], out['hdr_type'] = True, dv[0], dv[1], 'dv'
        elif transfer == 16:
            out['hdr_type'] = 'hdr10'
        elif transfer == 18:
            out['hdr_type'] = 'hlg'
    elif kind == 2:
        name = _codec(_A_CODECS, codec)
        if name and name not in out['audio']:
            out['audio'].append(name)


def _mkv(data, size):
    out = _blank('mkv')
    eid, p = _vint(data, 0, True)
    hsize, p = _vint(data, p, False)
    if eid != _EBML or hsize is None or hsize < 0:
        return out
    eid, p = _vint(data, p + hsize, True)
    ssize, seg0 = _vint(data, p, False)
    if eid != _SEGMENT or ssize is None:
        return out
    seek_ids, seekhead, more_heads, cues, cluster, cues_at = set(), False, False, False, False, None
    for eid, a, b, whole in _kids(data, seg0, len(data)):
        if eid == _CLUSTER:
            cluster = True
            break
        if eid == _CUES:
            cues = True
        elif eid == _SEEKHEAD:
            seekhead = whole
            for i2, a2, b2, w2 in _kids(data, a, b):
                if i2 != _SEEK or not w2:
                    continue
                sid, spos = 0, None
                for i3, a3, b3, w3 in _kids(data, a2, b2):
                    if i3 == _SEEKID:
                        sid = _uint(data[a3:b3])
                    elif i3 == _SEEKPOS:
                        spos = _uint(data[a3:b3])
                seek_ids.add(sid)
                if sid == _CUES and spos is not None:
                    cues_at = seg0 + spos
                elif sid == _SEEKHEAD:
                    more_heads = True
        elif eid == _TRACKS:
            for i2, a2, b2, w2 in _kids(data, a, b):
                if i2 == _ENTRY:
                    _mkv_track(data, a2, b2, out)
    if cues:
        out['cues'] = True
    elif cues_at is not None:
        # the index is promised at a place: a file that ends before it was cut short
        out['cues'] = not (size and cues_at >= int(size))
    elif seekhead and not more_heads:
        out['cues'] = False                      # the table of contents is whole and names no index
    elif cluster and not seekhead and not seek_ids:
        out['cues'] = False                      # written as a live stream: no table of contents at all
    return out


# ------------------------------------------------------------------ MP4 / MOV
def _fourcc_ok(kind):
    return len(kind) == 4 and all(0x20 <= c < 0x7f or c == 0xa9 for c in bytearray(kind))


def mp4_layout(data, base=0, size=0):
    """Walks the top-level boxes of an MP4 sample that starts at file offset `base`.
    -> {'moov': file offset of the 'moov' box or None, 'next': file offset where the walk must go on (the sample
        ended before it) or None, 'end': True when the boxes ran to the very end of the file without a 'moov',
        'bad': True when what stands at a box boundary is not a box, 'slice': (start, stop) of moov in `data`}"""
    out = {'moov': None, 'next': None, 'end': False, 'bad': False, 'slice': None}
    pos, n, guard = 0, len(data), 0
    size = int(size or 0)
    while guard < 200:
        guard += 1
        if pos + 8 > n:
            out['next'] = base + pos
            break
        length, kind = struct.unpack('>I4s', bytes(data[pos:pos + 8]))
        head = 8
        if length == 1:
            if pos + 16 > n:
                out['next'] = base + pos
                break
            length = struct.unpack('>Q', bytes(data[pos + 8:pos + 16]))[0]
            head = 16
        if not _fourcc_ok(kind) or (length != 0 and length < head):
            out['bad'] = True
            break
        if kind == b'moov':
            out['moov'] = base + pos
            out['slice'] = (pos, n if length == 0 else min(n, pos + length))
            break
        if length == 0:                          # "this box runs to the end of the file": nothing can follow
            out['end'] = True
            break
        pos += length
    if out['next'] is not None and size:
        if out['next'] >= size:
            out['next'], out['end'] = None, True
    return out


def _mp4_entries(data, out):
    """Sample descriptions (stsd) anywhere in a 'moov' sample: codec names, Dolby Vision record, colour."""
    data = bytes(data)
    pos = 0
    while True:
        pos = data.find(b'stsd', pos)
        if pos < 0:
            break
        box0 = pos - 4
        pos += 4
        if box0 < 0 or box0 + 24 > len(data):
            continue
        box_len = struct.unpack('>I', data[box0:box0 + 4])[0]
        ent = box0 + 16                          # box header 8 + version / flags 4 + entry count 4
        if box_len < 24:
            continue
        ent_len, fmt = struct.unpack('>I4s', data[ent:ent + 8])
        body = data[ent:min(len(data), ent + max(ent_len, 8), box0 + box_len)]
        if fmt in _MP4_VIDEO:
            if out['video']:
                continue
            out['video'], out['known'] = _MP4_VIDEO[fmt], True
            dv = (None, None)
            for mark in (b'dvcC', b'dvvC', b'dvwC'):
                at = body.find(mark)
                if at >= 0:
                    dv = dovi_record(body[at + 4:at + 28])
                    break
            if dv[0] or fmt in _MP4_DV_ENTRY:
                out['dv'], out['dv_profile'], out['dv_fallback'], out['hdr_type'] = True, dv[0], dv[1], 'dv'
                if dv[0] is None and fmt in (b'dvh1', b'dvhe'):
                    out['dv_fallback'] = False   # a 'dvhe' entry is not readable as plain HEVC
            else:
                at = body.find(b'colrnclx')
                if at >= 0 and at + 14 <= len(body):
                    transfer = struct.unpack('>H', body[at + 10:at + 12])[0]
                    out['hdr_type'] = {16: 'hdr10', 18: 'hlg'}.get(transfer, '')
        elif fmt in _MP4_AUDIO:
            if _MP4_AUDIO[fmt] not in out['audio']:
                out['audio'].append(_MP4_AUDIO[fmt])


def _mp4(data, size):
    out = _blank('mp4')
    lay = mp4_layout(data, 0, size)
    if lay['moov'] is not None:
        out['moov'] = 'head'
        _mp4_entries(data[lay['slice'][0]:lay['slice'][1]], out)
    elif lay['end']:
        out['moov'] = 'missing'
    elif lay['bad']:
        out['moov'] = None
    elif lay['next'] is not None:
        out['moov'], out['next'] = 'tail', lay['next']
    return out


def mp4_tail(data, base, size=0):
    """The walk goes on in a second sample read at file offset `base` (the place mp4 flags named in 'next').
    -> (flags of the same shape as inspect(), bytes of the 'moov' box that are in the sample or b'')"""
    out = _blank('mp4')
    try:
        data = bytes(data or b'')
        lay = mp4_layout(data, int(base), size)
        if lay['moov'] is not None:
            out['moov'] = 'tail'
            cut = data[lay['slice'][0]:lay['slice'][1]]
            _mp4_entries(cut, out)
            return out, cut
        if lay['bad'] or lay['end']:
            out['moov'] = 'missing'
        elif lay['next'] is not None:
            out['moov'], out['next'] = 'tail', lay['next']
    except Exception:
        pass
    return out, b''


def inspect(data, size=0):
    """-> {'container': 'mkv' | 'mp4', 'video': 'hevc' | 'avc' | 'av1' | 'vp9' | '', 'audio': [codec names],
           'hdr_type': '' | 'hdr10' | 'hlg' | 'dv', 'dv', 'dv_profile', 'dv_fallback' (True / False / None),
           'cues': True / False / None (Matroska seek index), 'moov': 'head' | 'tail' | 'missing' | None (MP4),
           'next': file offset to read for the 'moov' check, 'known': the video track was readable}
    {} for anything that is not Matroska / MP4. `size` = the size of the whole file when it is known."""
    try:
        if not data or len(data) < 16:
            return {}
        data = bytes(data)
        if data[:4] == b'\x1a\x45\xdf\xa3':
            return _mkv(data, size)
        if data[4:8] in (b'ftyp', b'moov', b'free', b'wide', b'skip', b'mdat'):
            return _mp4(data, size)
    except Exception:
        pass
    return {}


def apply(parsed, flags):
    """Folds what the header says into the parsed release name (the header wins where it is certain).
    -> True when something changed."""
    if not flags or not flags.get('known'):
        return False
    before = (parsed.get('hdr_type'), parsed.get('dv'), parsed.get('dv_profile'), parsed.get('dv_fallback'),
              tuple(parsed.get('audio_fmt') or []))
    if flags.get('dv'):
        parsed['dv'], parsed['hdr_type'] = True, 'dv'
        if flags.get('dv_profile'):
            parsed['dv_profile'] = flags['dv_profile']
        if flags.get('dv_fallback') is not None:
            parsed['dv_fallback'] = flags['dv_fallback']
    else:
        if parsed.get('dv') and flags.get('container') == 'mp4':
            # the name says Dolby Vision, the MP4 track has no Dolby Vision record: an HDR10 / SDR file. (A Matroska
            # file from an older muxer carries Dolby Vision without a record - there the name is believed.)
            parsed['dv'], parsed['dv_profile'], parsed['dv_fallback'] = False, None, None
            parsed['hdr_type'] = flags.get('hdr_type') or ''
        elif flags.get('hdr_type') and not parsed.get('hdr_type'):
            parsed['hdr_type'] = flags['hdr_type']
    if parsed.get('hdr_type'):
        parsed['hdr'] = True
    audio = list(parsed.get('audio_fmt') or [])
    for a in flags.get('audio') or []:
        if a in ('truehd', 'dtshd', 'dts', 'eac3') and a not in audio and not (a == 'dts' and 'dtshd' in audio):
            audio.append(a)
    parsed['audio_fmt'] = audio
    if flags.get('video') == 'av1' and not parsed.get('codec'):
        parsed['codec'] = 'av1'
    return before != (parsed.get('hdr_type'), parsed.get('dv'), parsed.get('dv_profile'), parsed.get('dv_fallback'),
                      tuple(audio))


# ------------------------------------------------------------------ the device
def _tri(value):
    """setting -> True / False / None (auto). Accepts booleans, 'yes' / 'no' / 'auto', '1' / '2' / '0'."""
    if value is True or value is False:
        return value
    v = str(value if value is not None else '').strip().lower()
    if v in ('yes', 'true', 'on', '1'):
        return True
    if v in ('no', 'false', 'off', '2'):
        return False
    return None


def platform():
    """'android' | 'windows' | 'apple' | 'linux' | '' (not known, e.g. outside Kodi)"""
    try:
        import xbmc
        for name, cond in (('android', 'System.Platform.Android'), ('windows', 'System.Platform.Windows'),
                           ('windows', 'System.Platform.UWP'), ('apple', 'System.Platform.IOS'),
                           ('apple', 'System.Platform.TVOS'), ('apple', 'System.Platform.OSX'),
                           ('apple', 'System.Platform.Darwin'), ('linux', 'System.Platform.Linux')):
            if xbmc.getCondVisibility(cond):
                return name
    except Exception:
        pass
    return ''


def device_caps(settings=None, plat=None):
    """What this device can show: {'dv': True / False / None, 'av1': ..., 'hdr': ..., 'platform': name}.
    None = not known - nothing is hidden on a guess. The settings 'dv_support' / 'av1_support' / 'hdr_support'
    ('yes' / 'no' / 'auto') decide when they are set; otherwise: Kodi shows Dolby Vision on Android devices (and a
    few Linux boxes) only - on Windows, macOS, iOS and tvOS it never does."""
    s = settings or {}

    def own(key):
        v = s.get(key)
        if v is None or v == '':
            try:
                from . import common
                v = common.setting(key, '')
            except Exception:
                v = ''
        return _tri(v)
    plat = platform() if plat is None else plat
    dv = own('dv_support')
    if dv is None and plat in ('windows', 'apple'):
        dv = False
    return {'dv': dv, 'av1': own('av1_support'), 'hdr': own('hdr_support'), 'platform': plat}


def judge(parsed, caps):
    """-> (hide, points, note). hide: this device cannot show the file properly; points: added to the score."""
    p, caps = parsed or {}, caps or {}
    dv_ok, hide, pts, note = caps.get('dv'), False, 0.0, ''
    if p.get('dv'):
        fb = p.get('dv_fallback')
        if fb is None and p.get('dv_profile') in (7, 8):
            fb = True
        if dv_ok:
            pts += 2
        elif fb is False:
            note = 'Dolby Vision profile %s: no HDR10 layer' % (p.get('dv_profile') or 5)
            if dv_ok is False:
                hide = True
            else:
                pts -= 4                         # not known whether the screen has Dolby Vision
        elif fb is None:
            note = 'Dolby Vision, HDR10 layer not stated'
            pts -= 10 if dv_ok is False else 2
    codec = (p.get('codec') or '').lower()
    if codec == 'av1' and caps.get('av1') is False:
        hide, note = True, note or 'AV1 video'
    if p.get('hdr_type') and not p.get('dv') and caps.get('hdr') is False:
        pts -= 3                                 # shown tone-mapped: the SDR copy of the same quality goes first
    return hide, pts, note
