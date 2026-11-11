# -*- coding: utf-8 -*-
"""QA crawl of the TeleNova plugin trees through Kodi's JSON-RPC (TCP 9090)."""
import json
import socket
import sys
import time
from urllib.parse import parse_qsl, urlsplit

sys.stdout.reconfigure(encoding='utf-8')


def rpc(method, params=None, timeout=60):
    s = socket.create_connection(('127.0.0.1', 9090), timeout=5)
    s.settimeout(timeout)
    s.sendall(json.dumps({'jsonrpc': '2.0', 'id': 7, 'method': method, 'params': params or {}}).encode())
    buf, dec = b'', json.JSONDecoder()
    try:
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
    except socket.timeout:
        return {'timeout': True}
    finally:
        s.close()


# listing actions that open no dialog
NOVA_OK = {'media_root', 'genres', 'langs', 'years', 'list', 'seasons', 'episodes', 'kukhnya', 'history', 'favs',
           'accounts', 'tv_root', 'tv_list', 'tv_countries', 'tv_country', 'radio_root', 'radio_tags', 'radio_list',
           'libs', 'lib_cat', 'sources', 'status', 'sysreport', 'kodi_settings', 'bk_menu', 'gd_menu', 'help',
           'help_cats', 'help_guide', 'help_trouble', 'tvradio', 'hub_k', 'topic_root', 'topic_cats', 'topic_cat',
           'topic_top', 'yt_channel', 'ia_search', 'lb_epg', 'lb_channels', 'noop', 'w_search', 'hub_k_news'}
TS_OK = {'movies', 'tvshows', 'hebrew', 'russian', 'kids', 'list', 'genres', 'years', 'search_menu', 'seasons',
         'episodes', 'genre', 'year', 'telegram', 'chiko', 'account'}
stats = {'dirs': 0, 'items': 0, 'err': [], 'slow': [], 'empty': [], 'skipped': {}}
seen = set()


def allowed(path):
    u = urlsplit(path)
    q = dict(parse_qsl(u.query))
    if u.netloc == 'plugin.video.nova':
        a = q.get('a', '')
        if a == 'radio_list' and q.get('by') == 'search':
            return False, a
        return (a in NOVA_OK or not a), a
    if u.netloc == 'plugin.video.telescope':
        m = q.get('mode', '')
        return (m in TS_OK or not m), 'ts:' + m
    return False, u.netloc


def crawl(path, depth, maxdepth, fan):
    if path in seen:
        return
    seen.add(path)
    t = time.time()
    r = rpc('Files.GetDirectory', {'directory': path, 'media': 'files'}, 75)
    dt = time.time() - t
    if r.get('timeout'):
        stats['err'].append(('TIMEOUT', path))
        rpc('Input.Back'); rpc('Input.Back')
        return
    if 'error' in r:
        stats['err'].append((r['error'].get('message', '?'), path))
        return
    files = (r.get('result') or {}).get('files') or []
    stats['dirs'] += 1
    stats['items'] += len(files)
    if dt > 6:
        stats['slow'].append((round(dt, 1), path))
    if not files:
        stats['empty'].append(path)
    print('%s%3d items %5.1fs  %s' % ('  ' * depth, len(files), dt, path[:118]), flush=True)
    if depth >= maxdepth:
        return
    n = 0
    for f in files:
        p = f.get('file', '')
        if f.get('filetype') != 'directory' or not p.startswith('plugin://'):
            continue
        ok, key = allowed(p)
        if not ok:
            stats['skipped'][key] = stats['skipped'].get(key, 0) + 1
            continue
        # static menus are walked completely, long generated lists only through their first entries
        if len(files) > 14 and n >= fan:
            break
        n += 1
        crawl(p, depth + 1, maxdepth, fan)


for root in sys.argv[3:]:
    crawl(root, 0, int(sys.argv[1]), int(sys.argv[2]))
print('\n=== %d directories, %d items' % (stats['dirs'], stats['items']))
print('errors (%d):' % len(stats['err']))
for e in stats['err']:
    print('   %s  ->  %s' % e)
print('slow >6s (%d):' % len(stats['slow']))
for e in sorted(stats['slow'], reverse=True)[:15]:
    print('   %5.1fs  %s' % e)
print('empty (%d):' % len(stats['empty']))
for e in stats['empty'][:25]:
    print('   %s' % e)
print('not walked (dialogs / actions / other add-ons):', json.dumps(stats['skipped'], ensure_ascii=False))
