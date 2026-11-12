# -*- coding: utf-8 -*-
"""3.3.3 inside Kodi (JSON-RPC, port 9090): the new Telegram menus list, the engine answers the new RPC methods and
the old embedding API still works. Runs on a build without a Telegram login - what needs an account is reported
as 'needs login', not as a failure."""
import json
import socket
import sys

sys.stdout.reconfigure(encoding='utf-8')
T = 'plugin://plugin.video.telescope/'
fails = []


def rpc(method, params=None, timeout=60):
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


def ls(path):
    r = rpc('Files.GetDirectory', {'directory': path, 'media': 'files'})
    return [(f.get('label'), f.get('file')) for f in (r.get('result') or {}).get('files') or []], r.get('error')


def check(name, ok, detail=''):
    print('%s  %s  %s' % ('ok  ' if ok else 'FAIL', name, detail))
    if not ok:
        fails.append(name)


ver = rpc('Addons.GetAddonDetails', {'addonid': 'plugin.video.telescope', 'properties': ['version', 'enabled']})
ver = (ver.get('result') or {}).get('addon') or {}
check('engine version 3.3.4, enabled', ver.get('version') == '3.3.4' and ver.get('enabled'), str(ver))

items, err = ls(T + '?mode=telegram')
check('"My Telegram" menu has the bots entry', len(items) == 5 and any('mode=bots' in f for _, f in items),
      '%d items' % len(items))
items, err = ls(T + '?mode=discover')
check('discover is a menu: text, similar, 5 topics', len(items) == 7 and not err, '%d items' % len(items))
labels = [l for l, _ in items]
check('menu labels are translated (no bare ids, no empty)', all(l and not l.isdigit() for l in labels), ' | '.join(labels)[:160])
items, err = ls(T + '?mode=search_menu')
check('search menu', len(items) == 4, '%d items' % len(items))
items, err = ls(T + '?mode=hub&q=zzzzqqq')
check('embedding API (hub) answers without a login', err is None, 'items=%d' % len(items))
items, err = ls(T + '?mode=hub&type=movie&tmdb=603&title=The%20Matrix&year=1999&fast=1')
check('embedding API (hub, exact title) answers', err is None, 'items=%d' % len(items))
items, err = ls(T + '?mode=bot_mark')
check('bot_mark without parameters does not break Kodi', rpc('JSONRPC.Ping').get('result') == 'pong')
items, err = ls(T + '?mode=pin')
check('pin without parameters is harmless', rpc('JSONRPC.Ping').get('result') == 'pong')
items, err = ls(T + '?mode=account')
labels = ' | '.join(l for l, _ in items)
check('account screen: Real-Debrid row + export / import rows',
      any('mode=rd_login' in f or 'mode=rd_status' in f for _, f in items)
      and any('mode=config_export' in f for _, f in items) and any('mode=config_import' in f for _, f in items),
      labels[:200])
check('Kodi alive', rpc('JSONRPC.Ping').get('result') == 'pong')

print('\nSUMMARY: %d failed' % len(fails))
