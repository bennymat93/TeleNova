# -*- coding: utf-8 -*-
"""4.0: what is really INSIDE the subtitle tracks of a video.

The label of a track is not proof. Files from Telegram carry tracks marked "heb" that hold English text, Hebrew tracks
marked "und" with no name at all, tracks that are listed and empty, and Hebrew saved in the wrong encoding (question
marks on the screen). So the text itself is read: the track table of the Matroska file, then a few stretches of the
file from which the lines of every subtitle track are collected, and each track gets a verdict:

    'he'       its lines are Hebrew                         -> these are the subtitles, nothing is searched
    'other'    its lines are in another language            -> not Hebrew, whatever the label says
    'broken'   Hebrew in a wrong encoding / unreadable text -> useless on the screen
    'empty'    other tracks have lines in the same stretch, this one has none
    'image'    picture subtitles (PGS / VobSub): cannot be read, the label is all there is
    'unknown'  nothing was seen (too little read, or not a Matroska file)

Pure Python, no Kodi modules: the caller passes read(offset, length) -> bytes. Never raises.
"""
import re
import zlib

SEGMENT, TRACKS, ENTRY, CLUSTER = 0x18538067, 0x1654AE6B, 0xAE, 0x1F43B675
TEXT_CODECS = ('S_TEXT/UTF8', 'S_TEXT/ASS', 'S_TEXT/SSA', 'S_TEXT/WEBVTT', 'S_ASS', 'S_SSA')
IMAGE_CODECS = ('S_HDMV/PGS', 'S_VOBSUB', 'S_DVBSUB', 'S_HDMV/TEXTST', 'S_IMAGE/BMP')
HEB_CODES = ('he', 'heb', 'hebrew', 'iw')
HEB_NAME = re.compile(u'(^|[^a-z])(heb|hebrew|ivrit)([^a-z]|$)|עברית', re.I)
CLUSTER_ID = b'\x1f\x43\xb6\x75'


def _vint(data, pos, keep_marker=False):
    """EBML variable-length integer at pos -> (value, length) or (None, 0)"""
    if pos >= len(data):
        return None, 0
    first = data[pos]
    length = 1
    mask = 0x80
    while length <= 8 and not first & mask:
        mask >>= 1
        length += 1
    if length > 8 or pos + length > len(data):
        return None, 0
    value = first if keep_marker else first & (mask - 1)
    for i in range(1, length):
        value = (value << 8) | data[pos + i]
    return value, length


def _elements(data, pos, end):
    """the elements between pos and end: (id, payload start, payload size, known size?)"""
    while pos < end:
        eid, n = _vint(data, pos, True)
        if eid is None:
            return
        size, m = _vint(data, pos + n)
        if size is None:
            return
        unknown = size == (1 << (7 * m)) - 1
        start = pos + n + m
        if unknown:
            size = end - start
        yield eid, start, size, not unknown
        pos = start + size


def _uint(raw):
    v = 0
    for b in raw:
        v = (v << 8) | b
    return v


def parse_tracks(head):
    """the subtitle tracks named in the first bytes of a Matroska file, in file order:
    [{'number', 'codec', 'lang', 'name', 'forced', 'default', 'zlib', 'strip'}]"""
    out = []
    try:
        for eid, start, size, _ in _elements(head, 0, len(head)):
            if eid != SEGMENT:
                continue
            for cid, cstart, csize, _ in _elements(head, start, min(len(head), start + size)):
                if cid != TRACKS:
                    continue
                for tid, tstart, tsize, _ in _elements(head, cstart, min(len(head), cstart + csize)):
                    if tid != ENTRY:
                        continue
                    t = {'number': 0, 'type': 0, 'codec': '', 'lang': '', 'name': '', 'forced': False, 'default': True,
                         'zlib': False, 'strip': b''}
                    for fid, fstart, fsize, _ in _elements(head, tstart, min(len(head), tstart + tsize)):
                        raw = head[fstart:fstart + fsize]
                        if fid == 0xD7:
                            t['number'] = _uint(raw)
                        elif fid == 0x83:
                            t['type'] = _uint(raw)
                        elif fid == 0x86:
                            t['codec'] = raw.split(b'\x00')[0].decode('ascii', 'replace')
                        elif fid == 0x22B59C and not t['lang']:
                            t['lang'] = raw.split(b'\x00')[0].decode('ascii', 'replace')
                        elif fid == 0x22B59D:
                            t['lang'] = raw.split(b'\x00')[0].decode('ascii', 'replace')
                        elif fid == 0x536E:
                            t['name'] = raw.decode('utf-8', 'replace')
                        elif fid == 0x55AA:
                            t['forced'] = bool(_uint(raw))
                        elif fid == 0x88:
                            t['default'] = bool(_uint(raw))
                        elif fid == 0x6D80:                 # ContentEncodings: zlib / header stripping
                            _encodings(head, fstart, fsize, t)
                    if t['type'] == 0x11 and t['number']:
                        out.append(t)
            break
    except Exception:
        pass
    return out


def _encodings(head, start, size, t):
    for eid, estart, esize, _ in _elements(head, start, start + size):
        if eid != 0x6240:
            continue
        for cid, cstart, csize, _ in _elements(head, estart, estart + esize):
            if cid != 0x5034:
                continue
            algo, settings = 0, b''
            for fid, fstart, fsize, _ in _elements(head, cstart, cstart + csize):
                if fid == 0x4254:
                    algo = _uint(head[fstart:fstart + fsize])
                elif fid == 0x4255:
                    settings = head[fstart:fstart + fsize]
            if algo == 0:
                t['zlib'] = True
            elif algo == 3:
                t['strip'] = settings


def _clean(text, codec):
    if 'ASS' in codec or 'SSA' in codec:
        parts = text.split(',', 8)             # ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text
        if len(parts) == 9:
            text = parts[8]
        text = re.sub(r'\{[^}]*\}', '', text).replace('\\N', ' ').replace('\\n', ' ').replace('\\h', ' ')
    text = re.sub(r'<[^>]{1,40}>', '', text)
    return text.strip()


def _decode(payload):
    """-> (text, ok). ok False = not UTF-8: Kodi shows such a track as garbage"""
    try:
        return payload.decode('utf-8'), True
    except UnicodeDecodeError:
        for enc in ('cp1255', 'cp1251', 'latin-1'):
            try:
                return payload.decode(enc), False
            except UnicodeDecodeError:
                continue
    return '', False


def scan(data, tracks, found):
    """collects the lines of the subtitle tracks from one stretch of the file (it starts anywhere: the first cluster
    is looked for). found: {track number: {'lines': [...], 'blocks': n, 'bad': n}}"""
    by_num = dict((t['number'], t) for t in tracks)
    at = data.find(CLUSTER_ID)
    guard = 0
    while 0 <= at < len(data) - 12 and guard < 4000:
        guard += 1
        size, m = _vint(data, at + 4)
        if size is None:
            break
        start = at + 4 + m
        unknown = size == (1 << (7 * m)) - 1
        end = len(data) if unknown else min(len(data), start + size)
        ok = _cluster(data, start, end, by_num, found)
        nxt = start + size if (ok and not unknown) else at + 4
        at = data.find(CLUSTER_ID, nxt) if (not ok or unknown or nxt >= len(data) or data[nxt:nxt + 4] != CLUSTER_ID) else nxt


def _cluster(data, start, end, by_num, found):
    """-> False when the bytes do not look like a cluster (a chance match of the 4 id bytes inside video data)"""
    seen = 0
    for eid, estart, esize, known in _elements(data, start, end):
        if eid == 0xE7 or eid == 0xA7 or eid == 0xAB:        # timestamp, position, previous size
            seen += 1
        elif eid == 0xA3:
            seen += 1
            _block(data, estart, min(esize, len(data) - estart), by_num, found)
        elif eid == 0xA0:
            seen += 1
            for bid, bstart, bsize, _ in _elements(data, estart, min(len(data), estart + esize)):
                if bid == 0xA1:
                    _block(data, bstart, min(bsize, len(data) - bstart), by_num, found)
        elif eid in (0xEC, 0xBF, 0x5854, 0x58D7):            # void, crc, silent tracks, encrypted block
            continue
        elif seen == 0:
            return False
        else:
            break                                             # the next top-level element
    return seen > 0


def _block(data, start, size, by_num, found):
    num, n = _vint(data, start)
    if num is None or num not in by_num or size < n + 3:
        return
    t = by_num[num]
    payload = data[start + n + 3:start + size]
    slot = found.setdefault(num, {'lines': [], 'blocks': 0, 'bad': 0})
    slot['blocks'] += 1
    if t['codec'] not in TEXT_CODECS and not t['codec'].startswith('S_TEXT'):
        return
    try:
        if t['zlib']:
            payload = zlib.decompress(payload)
        elif t['strip']:
            payload = t['strip'] + payload
    except Exception:
        slot['bad'] += 1
        return
    text, ok = _decode(payload)
    text = _clean(text, t['codec'])
    if not ok:
        slot['bad'] += 1
    if text and len(slot['lines']) < 40:
        slot['lines'].append(text)


def classify(lines):
    """-> ('he' | 'other' | '', Hebrew letters, other letters)"""
    heb = other = 0
    for line in lines:
        for ch in line:
            if u'א' <= ch <= u'ת':
                heb += 1
            elif ch.isalpha():
                other += 1
    total = heb + other
    if total < 12:
        return '', heb, other
    if heb >= 0.6 * total:
        return 'he', heb, other
    if heb <= 0.25 * total:
        return 'other', heb, other
    return '', heb, other


def labelled_hebrew(t):
    lang = (t.get('lang') or '').lower().replace('_', '-').split('-')[0]
    return lang in HEB_CODES or bool(HEB_NAME.search(t.get('name') or ''))


def verdicts(tracks, found):
    any_blocks = any(v['blocks'] for v in found.values())
    out = []
    for t in tracks:
        slot = found.get(t['number']) or {'lines': [], 'blocks': 0, 'bad': 0}
        text = t['codec'] in TEXT_CODECS or t['codec'].startswith('S_TEXT')
        if not text:
            v = 'image' if (slot['blocks'] or not any_blocks) else 'empty'
        elif not slot['blocks']:
            v = 'empty' if any_blocks else 'unknown'
        elif slot['bad'] * 2 > slot['blocks']:
            v = 'broken'
        else:
            v = classify(slot['lines'])[0] or 'unknown'
        out.append(dict(t, verdict=v, lines=len(slot['lines']), blocks=slot['blocks'], labelled=labelled_hebrew(t),
                        sample=(slot['lines'][0][:60] if slot['lines'] else '')))
    return out


def probe(read, size, budget=32 * 1048576, window=4 * 1048576, want_lines=6, alive=None):
    """-> {'tracks': [track + verdict ...], 'read': bytes read, 'mkv': bool}.
    Reads the head of the file, then stretches from several places until every text track has want_lines lines, the
    budget is spent or alive() says stop."""
    out = {'tracks': [], 'read': 0, 'mkv': False}
    try:
        head = read(0, min(size, 2 * 1048576)) or b''
        out['read'] += len(head)
        if head[:4] != b'\x1a\x45\xdf\xa3':
            return out
        out['mkv'] = True
        tracks = parse_tracks(head)
        if not tracks:
            return out
        found = {}
        texts = [t for t in tracks if t['codec'] in TEXT_CODECS or t['codec'].startswith('S_TEXT')]

        def enough():
            # every text track has shown what it is (or has plenty of lines that say nothing either way)
            return all(classify((found.get(t['number']) or {'lines': []})['lines'])[0] and
                       len((found.get(t['number']) or {'lines': []})['lines']) >= want_lines for t in texts)
        # the stretches: spread over the film (the first minutes are often titles without a spoken word)
        spots = [0.30, 0.55, 0.15, 0.75, 0.42, 0.65, 0.88, 0.22]
        if size <= 2 * window:                          # a small file is simply read from its start
            spots, window = [0.0], size
        for frac in spots:
            if out['read'] + window > budget or (alive and not alive()) or (texts and enough()):
                break
            if not texts and any(v['blocks'] for v in found.values()):
                break                                   # picture subtitles only: one stretch shows which are alive
            off = int(size * frac) // 4096 * 4096
            data = read(off, min(window, max(0, size - off))) or b''
            out['read'] += len(data)
            if data:
                scan(data, tracks, found)
        out['tracks'] = verdicts(tracks, found)
    except Exception as exc:
        out['error'] = '%s: %s' % (type(exc).__name__, exc)
    return out


def decide(kodi_subs, probed):
    """What to do with the video that plays.
    kodi_subs: the player's subtitle list [{'index', 'language', 'name', 'isforced'}] (embedded tracks come first, in
    file order); probed: probe()'s result or None.
    -> {'hebrew': 'yes' | 'no', 'index': track to switch on or -1, 'why': text, 'certain': bool}"""
    def is_heb(s):
        lang = (s.get('language') or '').lower().replace('_', '-').split('-')[0]
        return lang in HEB_CODES or bool(HEB_NAME.search(s.get('name') or ''))

    def forced(s):
        return bool(s.get('isforced')) or 'forced' in (s.get('name') or '').lower()
    subs = list(kodi_subs or [])
    tracks = (probed or {}).get('tracks') or []
    seen = any(t['verdict'] in ('he', 'other', 'broken', 'empty') for t in tracks)
    if tracks and len(tracks) <= len(subs):
        # the file's own tracks, one to one with the player's list
        best = None
        for i, t in enumerate(tracks):
            s = subs[i]
            # "forced" is meant for a track with the foreign lines only - but uploaders also set the flag on a full
            # track so that players show it by themselves. The text tells them apart: a full track has lines in
            # every stretch that was read.
            if (forced(s) or t.get('forced')) and not (t['verdict'] == 'he' and t['lines'] >= 5):
                continue
            if t['verdict'] == 'he':
                return {'hebrew': 'yes', 'index': int(s.get('index', i)), 'certain': True,
                        'why': 'track %d holds Hebrew text (%d lines read)' % (i + 1, t['lines'])}
            if (is_heb(s) or t['labelled']) and t['verdict'] in ('image', 'unknown') and best is None:
                best = (i, s, t)
        bad = [t for i, t in enumerate(tracks) if (is_heb(subs[i]) or t['labelled']) and t['verdict'] in ('other', 'broken', 'empty')]
        if best is not None:
            i, s, t = best
            return {'hebrew': 'yes', 'index': int(s.get('index', i)), 'certain': t['verdict'] == 'image' and False,
                    'why': 'track %d is labelled Hebrew (%s: its text could not be read)' % (i + 1, t['verdict'])}
        if bad:
            return {'hebrew': 'no', 'index': -1, 'certain': True,
                    'why': 'the track labelled Hebrew is %s' % bad[0]['verdict']}
        # external Hebrew files the player already added (All_Subs, a saved subtitle) come after the file's tracks
        for s in subs[len(tracks):]:
            if is_heb(s) and not forced(s):
                return {'hebrew': 'yes', 'index': int(s.get('index', -1)), 'certain': False, 'why': 'an added Hebrew subtitle'}
        return {'hebrew': 'no', 'index': -1, 'certain': seen or not any(is_heb(s) for s in subs),
                'why': 'no track holds Hebrew text' if seen else 'no Hebrew track'}
    # the text could not be read (not Matroska, read failed): the labels decide, as before
    for s in subs:
        if is_heb(s) and not forced(s):
            return {'hebrew': 'yes', 'index': int(s.get('index', -1)), 'certain': False, 'why': 'labelled Hebrew (not read)'}
    return {'hebrew': 'no', 'index': -1, 'certain': not subs, 'why': 'no Hebrew track' if subs else 'no subtitle tracks'}
