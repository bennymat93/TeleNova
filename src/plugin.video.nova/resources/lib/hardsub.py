# -*- coding: utf-8 -*-
"""4.0: subtitles burned into the picture, and the black box that hides them.

A file can carry subtitles that are part of the picture itself (hard-coded). No track list shows them. Two things
are wanted from them:
  * burned-in HEBREW  -> the film already has its Hebrew subtitles: nothing is searched, nothing is generated;
  * burned-in subtitles in ANOTHER language -> Hebrew subtitles are fetched / generated as usual and shown on an
    opaque black box, so the foreign lines under them cannot be read through.

How they are found:
  1. the file name ("HC", "HardSub", "KORSUB", "תרגום מובנה" ...) - a hint, never proof;
  2. the picture itself: three frames of the playing film (the lower third, taken while speech is likely) are shown
     to Gemini with one question - is there subtitle text in the picture, and in which script. Only an answer that
     agrees on at least two frames counts. Needs the Gemini key; without it the name is all there is and the
     result is marked uncertain.

The box is Kodi's own subtitle style (background type / colour / opacity). The viewer's values are saved before they
are changed and put back when the film ends - also after a crash (the saved values wait in a file).
"""
import base64
import json
import os
import re
import struct
import zlib

HC_FOREIGN = re.compile(r'(^|[^a-z])(hc|hcsub|hardsub(s|bed)?|hard[ ._-]?coded|korsub|kor[ ._-]?sub|engsub[ ._-]?hc)([^a-z]|$)', re.I)
HC_HEBREW = re.compile(u'תרגום מובנה|כתוביות מובנות|תרגום צרוב|'
                       u'כתוביות צרובות|heb[ ._-]?hc|hc[ ._-]?heb|heb[ ._-]?sub(s|bed)?|'
                       u'(^|[^א-ת])ת[._]מ([^א-ת]|$)', re.I)   # "HebSub", "ת.מ" (תרגום מובנה)
BOX = {'subtitles.backgroundtype': 3, 'subtitles.bgcolorpick': 'FF000000', 'subtitles.bgopacity': 100}
MODELS = ('gemini-flash-lite-latest', 'gemini-flash-latest')
ASK = ('These are frames from one film (the lower part of the picture). Is there SUBTITLE text that is part of the '
       'picture itself (burned in: lines of dialogue near the bottom, the same style in several frames)? Ignore logos, '
       'channel marks, credits, signs and text that belongs to the scene. Answer JSON only: '
       '{"frames": [{"subtitle": true|false, "script": "hebrew"|"latin"|"cyrillic"|"arabic"|"cjk"|"other"|"none"}]} '
       '- one entry per frame, in order.')


def name_hint(*names):
    """-> 'hebrew' | 'foreign' | '' from the file name / caption (a hint only)"""
    text = u' '.join(n for n in names if n)
    if HC_HEBREW.search(text):
        return 'hebrew'
    if HC_FOREIGN.search(text):
        return 'foreign'
    return ''


def png(bgra, width, height, top=0.62, max_width=640):
    """the lower part of a BGRA frame as PNG bytes (scaled down by whole steps: no image library on a Kodi box)"""
    step = max(1, width // max_width)
    first = int(height * top)
    rows = []
    for y in range(first, height, step):
        base = y * width * 4
        row = bytearray([0])
        for x in range(0, width - step + 1, step):
            i = base + x * 4
            row += bytes((bgra[i + 2], bgra[i + 1], bgra[i]))
        rows.append(bytes(row))
    w, h = (len(rows[0]) - 1) // 3 if rows else 0, len(rows)

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(b''.join(rows), 6)) + chunk(b'IEND', b''))


def dull(bgra, width, height):
    """a black / empty frame (a fade, a capture that failed): nothing to look at"""
    n = len(bgra) // 4
    if not n:
        return True
    step = max(1, n // 2000)
    vals = [bgra[i * 4 + 1] for i in range(0, n, step)]
    return max(vals) - min(vals) < 24


def verdict(frames):
    """the model's per-frame answers -> ('hebrew' | 'foreign' | 'none' | '', certain?)"""
    scripts = [f.get('script') or 'none' for f in frames if isinstance(f, dict) and f.get('subtitle')]
    if len(frames) < 2:
        return '', False
    if len(scripts) < 2:
        return ('none', len(frames) >= 3 and not scripts) if len(scripts) == 0 else ('', False)
    heb = sum(1 for s in scripts if s == 'hebrew')
    if heb >= 2 and heb * 2 > len(scripts):
        return 'hebrew', True
    if heb == 0:
        return 'foreign', True
    return '', False


def ask_gemini(key, pngs, post, timeout=25, log=None):
    """post(url, json=..., headers=..., timeout=...) -> response (requests-like). -> list of frame answers or None"""
    body = {'contents': [{'role': 'user', 'parts': [{'text': ASK}] + [
        {'inline_data': {'mime_type': 'image/png', 'data': base64.b64encode(p).decode('ascii')}} for p in pngs]}],
        'generationConfig': {'responseMimeType': 'application/json', 'maxOutputTokens': 300}}
    for model in MODELS:
        try:
            r = post('https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent' % model, json=body,
                     headers={'x-goog-api-key': key}, timeout=timeout)
            if r.status_code != 200:
                if log:
                    log('hard-coded subtitles: %s answered HTTP %s' % (model, r.status_code))
                continue
            text = ''.join(p.get('text', '') for p in r.json()['candidates'][0]['content']['parts'] if not p.get('thought'))
            return parse(text)
        except Exception as exc:
            if log:
                log('hard-coded subtitles: %s: %s' % (model, re.sub(r'key=[^&\s]+', 'key=***', str(exc))[:120]))
    return None


def parse(text):
    text = (text or '').strip()
    if text.startswith('```'):
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text)
    try:
        data = json.loads(text)
    except ValueError:
        m = re.search(r'\{.*\}', text, re.S)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
        except ValueError:
            return None
    frames = data.get('frames') if isinstance(data, dict) else data
    return frames if isinstance(frames, list) else None


# ------------------------------------------------------------------ the black box (Kodi's subtitle style)
def box_on(rpc, store):
    """rpc(method, params) -> result dict; store = path of the file that keeps the viewer's own values"""
    if os.path.exists(store):
        return False                                  # already on (for this film or left from a crash)
    saved = {}
    for sid in BOX:
        r = rpc('Settings.GetSettingValue', {'setting': sid})
        if r is None or 'value' not in r:
            return False                              # this Kodi does not know the setting: nothing is touched
        saved[sid] = r['value']
    with open(store, 'w') as f:
        json.dump(saved, f)
    for sid, val in BOX.items():
        rpc('Settings.SetSettingValue', {'setting': sid, 'value': val})
    return True


def box_off(rpc, store):
    if not os.path.exists(store):
        return False
    try:
        with open(store) as f:
            saved = json.load(f)
        for sid, val in saved.items():
            rpc('Settings.SetSettingValue', {'setting': sid, 'value': val})
    except Exception:
        pass
    try:
        os.remove(store)
    except OSError:
        pass
    return True
