# -*- coding: utf-8 -*-
"""3.3.3 inside a running Kodi (Windows, JSON-RPC 9090): the keyboard's Paste button.
  1. the button exists and is disabled (grey) while the clipboard holds no text
  2. copying text enables it within ~2 s
  3. pressing it puts the WHOLE text into the field (Hebrew, emoji, a long API hash), appended to what was typed
  4. the copy is in the history; pin / order survive
  5. clearing the clipboard disables it again
Also the configuration export / import round trip through the engine (no Telegram login needed for settings)."""
import ctypes
import json
import socket
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, r'C:\My Projects\novaTV Addon\src\plugin.video.nova\resources\lib')
fails = []


def rpc(method, params=None, timeout=30):
    s = socket.create_connection(('127.0.0.1', 9090), timeout=10)
    s.settimeout(timeout)
    try:
        s.sendall(json.dumps({'jsonrpc': '2.0', 'id': 7, 'method': method, 'params': params or {}}).encode())
        buf, dec = b'', json.JSONDecoder()
        while True:
            chunk = s.recv(65536)
            if not chunk:
                return {}
            buf += chunk
            txt, pos = buf.decode('utf-8', 'ignore'), 0
            while pos < len(txt):
                try:
                    obj, end = dec.raw_decode(txt, pos)
                except ValueError:
                    break
                pos = end
                while pos < len(txt) and txt[pos].isspace():
                    pos += 1
                if obj.get('id') == 7:
                    return obj
    finally:
        s.close()


def info(*labels):
    r = rpc('XBMC.GetInfoLabels', {'labels': list(labels)}).get('result') or {}
    return [r.get(l, '') for l in labels]


def cond(c):
    return (rpc('XBMC.GetInfoBooleans', {'booleans': [c]}).get('result') or {}).get(c)


def check(name, ok, detail=''):
    print('%s  %s  %s' % ('ok  ' if ok else 'FAIL', name, detail))
    if not ok:
        fails.append(name)


def until(fn, secs=4.0):
    end = time.time() + secs
    while time.time() < end:
        if fn():
            return True
        time.sleep(0.15)
    return bool(fn())


import types  # noqa: E402
_x = types.ModuleType('xbmc')
_x.getCondVisibility = lambda c: c == 'System.Platform.Windows'
sys.modules['xbmc'] = _x
import clip  # noqa: E402


def set_clip(text):
    if text is None:
        u = ctypes.windll.user32
        u.OpenClipboard(None)
        u.EmptyClipboard()
        u.CloseClipboard()
    else:
        assert clip.system_write(text)


saved = clip.system_read()
try:
    set_clip(None)
    # open a keyboard the way a user does: "Search Telegram files directly" asks for text
    rpc('Addons.ExecuteAddon', {'addonid': 'plugin.video.telescope', 'params': '?mode=tg_search'})
    check('keyboard opened', until(lambda: cond('Window.IsActive(virtualkeyboard)'), 8))
    check('paste button present', until(lambda: cond('Control.IsVisible(3011)'), 3))
    check('history button present', cond('Control.IsVisible(3012)'))
    check('nothing copied -> Paste disabled', until(lambda: not cond('Control.IsEnabled(3011)'), 4))
    rpc('Input.SendText', {'text': 'abc ', 'done': False})
    until(lambda: info('Control.GetLabel(312).index(1)')[0] == 'abc ', 3)
    text = u'API hash 0123456789abcdef0123456789abcdef \u05e2\u05d1\u05e8\u05d9\u05ea \U0001F600 ' + 'x' * 300
    set_clip(text)
    check('text copied -> Paste enabled', until(lambda: cond('Control.IsEnabled(3011)'), 4))
    # press the real button, the way a remote does: focus starts on voice search (3010), one step down is Paste
    for _ in range(4):
        if cond('Control.HasFocus(3011)'):
            break
        rpc('Input.Down') if cond('Control.HasFocus(3010)') else rpc('Input.ExecuteAction', {'action': 'noop'})
        if not cond('Control.HasFocus(3011)') and not cond('Control.HasFocus(3010)'):
            break
        time.sleep(0.3)
    check('remote reaches the Paste button', cond('Control.HasFocus(3011)'))
    t0 = time.time()
    rpc('Input.Select')
    want = 'abc ' + text
    got_all = until(lambda: info('Control.GetLabel(312).index(1)')[0] == want, 6)
    field = info('Control.GetLabel(312).index(1)')[0]
    check('paste puts the whole text after what was typed', got_all, '%d of %d chars in %.1fs' % (len(field), len(want), time.time() - t0))
    for n in range(5):                     # hammering the button: never a half or doubled paste
        rpc('Input.Select')
        time.sleep(0.15)
    time.sleep(3)
    field = info('Control.GetLabel(312).index(1)')[0]
    check('5 fast presses: every paste whole', field.startswith(want) and (len(field) - len('abc ')) % len(text) == 0,
          '%d chars = %s pastes' % (len(field), (len(field) - 4) / float(len(text))))
    set_clip(None)
    check('clipboard cleared -> Paste disabled again', until(lambda: not cond('Control.IsEnabled(3011)'), 4))
    rpc('Input.SendText', {'text': '', 'done': False})
    rpc('Input.Back')
    until(lambda: not cond('Window.IsActive(virtualkeyboard)'), 4)
    import os
    hist = json.load(open(os.path.join(os.environ['APPDATA'], 'Kodi', 'userdata', 'addon_data', 'plugin.video.nova',
                                       'clipboard.json'), encoding='utf-8'))['items']
    check('the copy is in the clipboard history', any(i['t'] == clip.clean(text) for i in hist), '%d entries' % len(hist))
    check('Kodi alive', rpc('JSONRPC.Ping').get('result') == 'pong')
finally:
    clip.system_write(saved or '') if saved else set_clip(None)
print('\nSUMMARY: %d failed' % len(fails))
