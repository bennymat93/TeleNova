# -*- coding: utf-8 -*-
"""subprobe.py: the text inside the subtitle tracks decides, not their labels.
   python t_subprobe.py            unit tests on Matroska files built here
   python t_subprobe.py live "search text" [min MB]   the same check on a real Telegram file (through the engine)"""
import os, struct, sys, zlib
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.nova', 'resources', 'lib'))
import subprobe


def vint(n):
    for length in range(1, 9):
        if n < (1 << (7 * length)) - 1:
            return (n | (1 << (7 * length))).to_bytes(length, 'big')
    raise ValueError(n)


def el(eid, payload):
    return bytes.fromhex(eid) + vint(len(payload)) + payload


def track(num, codec, lang='', name='', forced=False, ttype=0x11, compressed=False):
    body = el('d7', bytes([num])) + el('83', bytes([ttype])) + el('86', codec.encode())
    if lang:
        body += el('22b59c', lang.encode())
    if name:
        body += el('536e', name.encode('utf-8'))
    if forced:
        body += el('55aa', b'\x01')
    if compressed:
        body += el('6d80', el('6240', el('5034', el('4254', b'\x00'))))
    return el('ae', body)


def block(num, text, raw=None, compressed=False):
    payload = raw if raw is not None else text.encode('utf-8')
    if compressed:
        payload = zlib.compress(payload)
    return el('a3', vint(num) + b'\x00\x00\x80' + payload)


def mkv(tracks, clusters, pad=30000):
    """clusters: list of lists of blocks; video noise between them (with the cluster id bytes appearing by chance)"""
    seg = el('1654ae6b', b''.join(tracks))
    seg += el('ec', b'\x00' * 500)
    noise = (b'\x1f\x43\xb6\x75' + os.urandom(64)) + os.urandom(pad)
    for blocks in clusters:
        video = el('a3', vint(1) + b'\x00\x00\x80' + noise)
        seg += el('1f43b675', el('e7', b'\x00') + video + b''.join(blocks) + video)
    return bytes.fromhex('1a45dfa3') + vint(4) + b'\x42\x82\x88\x6d' + bytes.fromhex('18538067') + vint(len(seg)) + seg


HE = [u'מה שלומך היום?', u'אני לא יודע מה לומר לך.', u'בוא נלך הביתה עכשיו.', u'זה היה יום ארוך מאוד.', u'תודה רבה על העזרה.',
      u'אתה בטוח שזה המקום?', u'כן, אני בטוח לגמרי.', u'אז למה אף אחד לא כאן?']
EN = ['How are you today?', 'I do not know what to tell you.', 'Let us go home now.', 'It was a very long day.',
      'Thank you for the help.', 'Are you sure this is the place?', 'Yes, I am completely sure.', 'Then why is nobody here?']
fails = []


def check(name, cond, extra=''):
    print('%-74s %s %s' % (name, 'ok' if cond else 'FAIL', extra if not cond else ''))
    if not cond:
        fails.append(name)


def run(data, subs):
    res = subprobe.probe(lambda off, n: data[off:off + n], len(data), window=1 << 20)
    return res, subprobe.decide(subs, res)


def unit():
    video = track(1, 'V_MPEG4/ISO/AVC', ttype=1)
    # 1. honest Hebrew track
    d = mkv([video, track(2, 'S_TEXT/UTF8', 'heb')], [[block(2, t) for t in HE[:4]], [block(2, t) for t in HE[4:]]])
    res, dec = run(d, [{'index': 0, 'language': 'heb', 'name': ''}])
    check('Hebrew track with Hebrew text -> yes, certain', dec['hebrew'] == 'yes' and dec['certain'] and dec['index'] == 0, dec)
    # 2. the label lies: "heb" holding English
    d = mkv([video, track(2, 'S_TEXT/UTF8', 'heb', 'Hebrew')], [[block(2, t) for t in EN[:4]], [block(2, t) for t in EN[4:]]])
    res, dec = run(d, [{'index': 0, 'language': 'heb', 'name': 'Hebrew'}])
    check('track labelled Hebrew holding English -> no, certain', dec['hebrew'] == 'no' and dec['certain'], dec)
    # 3. no label at all, Hebrew inside (second track); the first is English
    d = mkv([video, track(2, 'S_TEXT/UTF8', 'eng'), track(3, 'S_TEXT/ASS', 'und')],
            [[block(2, t) for t in EN[:4]] + [block(3, '0,0,Default,,0,0,0,,{\\an8}' + t) for t in HE[:4]],
             [block(2, t) for t in EN[4:]] + [block(3, '1,0,Default,,0,0,0,,' + t) for t in HE[4:]]])
    res, dec = run(d, [{'index': 0, 'language': 'eng', 'name': ''}, {'index': 1, 'language': 'und', 'name': ''}])
    check('unlabelled track holding Hebrew (ASS) -> yes, the right index', dec['hebrew'] == 'yes' and dec['index'] == 1 and dec['certain'], dec)
    check('ASS formatting is stripped from the sample', res['tracks'][1]['sample'] in HE, res['tracks'][1])
    # 4. Hebrew label, empty track (the English one has lines)
    d = mkv([video, track(2, 'S_TEXT/UTF8', 'heb'), track(3, 'S_TEXT/UTF8', 'eng')], [[block(3, t) for t in EN[:4]], [block(3, t) for t in EN[4:]]])
    res, dec = run(d, [{'index': 0, 'language': 'heb'}, {'index': 1, 'language': 'eng'}])
    check('Hebrew label on an empty track -> no', dec['hebrew'] == 'no' and res['tracks'][0]['verdict'] == 'empty', dec)
    # 5. Hebrew in the wrong encoding (cp1255 bytes in a UTF-8 track): garbage on the screen
    d = mkv([video, track(2, 'S_TEXT/UTF8', 'heb')], [[block(2, '', raw=t.encode('cp1255')) for t in HE[:4]], [block(2, '', raw=t.encode('cp1255')) for t in HE[4:]]])
    res, dec = run(d, [{'index': 0, 'language': 'heb'}])
    check('Hebrew saved in a wrong encoding -> no (broken)', dec['hebrew'] == 'no' and res['tracks'][0]['verdict'] == 'broken', dec)
    # 6. picture subtitles labelled Hebrew: cannot be read, the label stays the answer (not certain)
    d = mkv([video, track(2, 'S_HDMV/PGS', 'heb')], [[block(2, '', raw=os.urandom(300))], [block(2, '', raw=os.urandom(300))]])
    res, dec = run(d, [{'index': 0, 'language': 'heb'}])
    check('PGS labelled Hebrew -> yes by label, not certain', dec['hebrew'] == 'yes' and not dec['certain'] and res['tracks'][0]['verdict'] == 'image', dec)
    # 7. forced Hebrew only (foreign lines): not the subtitles of the film
    d = mkv([video, track(2, 'S_TEXT/UTF8', 'heb', 'Forced', forced=True)], [[block(2, t) for t in HE[:2]]])
    res, dec = run(d, [{'index': 0, 'language': 'heb', 'name': 'Forced', 'isforced': True}])
    check('forced Hebrew track with a few lines only -> no', dec['hebrew'] == 'no', dec)
    d = mkv([video, track(2, 'S_TEXT/UTF8', 'heb', forced=True)], [[block(2, t) for t in HE[:4]], [block(2, t) for t in HE[4:]]])
    res, dec = run(d, [{'index': 0, 'language': 'heb', 'isforced': True}])
    check('full Hebrew track that only carries the forced flag -> yes', dec['hebrew'] == 'yes' and dec['certain'], dec)
    # 8. compressed (zlib) Hebrew track
    d = mkv([video, track(2, 'S_TEXT/UTF8', 'heb', compressed=True)], [[block(2, t, compressed=True) for t in HE]])
    res, dec = run(d, [{'index': 0, 'language': 'heb'}])
    check('zlib-compressed Hebrew track is read', dec['hebrew'] == 'yes' and dec['certain'], (dec, res['tracks']))
    # 9. no subtitle tracks
    d = mkv([video], [[]])
    res, dec = run(d, [])
    check('no subtitle tracks -> no, certain', dec['hebrew'] == 'no' and dec['certain'], dec)
    # 10. an external Hebrew file added by the player after the file's own (English) track
    d = mkv([video, track(2, 'S_TEXT/UTF8', 'eng')], [[block(2, t) for t in EN]])
    res, dec = run(d, [{'index': 0, 'language': 'eng'}, {'index': 1, 'language': 'heb', 'name': '(External)'}])
    check('added external Hebrew subtitle after the English track -> yes, index 1', dec['hebrew'] == 'yes' and dec['index'] == 1, dec)
    # 11. not a Matroska file: the labels decide as before
    res = subprobe.probe(lambda off, n: (b'\x00\x00\x00\x18ftypmp42' + b'\x00' * 5000)[off:off + n], 5012)
    dec = subprobe.decide([{'index': 0, 'language': 'he'}], res)
    check('MP4: label decides, marked not certain', dec['hebrew'] == 'yes' and not dec['certain'] and not res['mkv'], dec)
    # 12. garbage never raises
    for junk in (b'', os.urandom(200000), b'\x1a\x45\xdf\xa3' + os.urandom(300000)):
        r = subprobe.probe(lambda off, n: junk[off:off + n], len(junk))
        subprobe.decide([{'index': 0, 'language': 'heb'}], r)
    check('random bytes never raise', True)
    # 13. mixed lines (Hebrew with English names) still Hebrew; English with one Hebrew word still other
    check('classify: Hebrew with Latin names', subprobe.classify([u'ג\'ון אמר ל-Mary שהוא הולך', u'אני חושב ש-FBI בדרך לכאן'])[0] == 'he')
    check('classify: English text', subprobe.classify(EN)[0] == 'other')
    print('\nSUBPROBE TESTS %s' % ('OK' if not fails else 'FAILED: %d' % len(fails)))
    return 1 if fails else 0


def live(query, min_mb):
    import time, urllib.request
    import tg_rpc
    files = tg_rpc.call('raw_search', query=query, limit=60, timeout=60).get('result') or []
    files = sorted([c for c in files if (c.get('size') or 0) > min_mb * 1048576 and (c.get('file') or '').lower().endswith('.mkv')],
                   key=lambda c: c['size'])
    for c in files[:int(sys.argv[4]) if len(sys.argv) > 4 else 3]:
        url = tg_rpc.stream_url(c['chat_id'], c['msg_id'], c.get('file') or 'video.mkv')

        def read(off, n):
            req = urllib.request.Request(url, headers={'Range': 'bytes=%d-%d' % (off, off + n - 1), 'User-Agent': 'TeleNova-subprobe'})
            return urllib.request.urlopen(req, timeout=60).read()
        t = time.time()
        res = subprobe.probe(read, c['size'])
        print('\n%s (%d MB): read %.1f MB in %.1fs' % ((c.get('file') or '')[:70], c['size'] // 1048576, res['read'] / 1048576.0, time.time() - t))
        for i, tr in enumerate(res['tracks']):
            print('   track %d: %-12s lang=%-4s name=%-22s -> %-8s (%d lines, %d blocks) %s' % (
                i + 1, tr['codec'], tr['lang'], (tr['name'] or '')[:22], tr['verdict'], tr['lines'], tr['blocks'], tr['sample'][:40]))
        kodi = [{'index': i, 'language': tr['lang'], 'name': tr['name'], 'isforced': tr['forced']} for i, tr in enumerate(res['tracks'])]
        print('   decision:', subprobe.decide(kodi, res))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'live':
        live(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 100)
    else:
        sys.exit(unit())
