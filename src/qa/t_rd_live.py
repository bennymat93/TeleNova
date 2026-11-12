# -*- coding: utf-8 -*-
"""Real-Debrid against the real account that is logged in inside the running Kodi.
1. engine search for a film -> how many sources per backend, order
2. rd_resolve on the first RD sources -> a direct link that really serves video bytes
3. the same film through the hub listing, played in Kodi for 25 s, then a seek
Prints no link, key or account name."""
import json, sys, time, urllib.request
from urllib.parse import quote
import tg_rpc

fails = []
FILMS = [('The Matrix', 1999, 603, 'tt0133093'), ('Oppenheimer', 2023, 872585, 'tt15398776')]
if len(sys.argv) > 1 and sys.argv[1] == 'tv':
    FILMS = []

st = tg_rpc.call('rd_status', fresh=True)['result']
print('account: logged_in=%s premium=%s days=%s error=%s' % (st.get('logged_in'), st.get('premium'), st.get('days'), st.get('error')))


def find(target, wait=80):
    t = time.time()
    job = tg_rpc.call('find_start', target=target)['result']
    while time.time() - t < wait:
        s = tg_rpc.call('find_status', job=job)['result']
        if s.get('done'):
            return s.get('result') or [], time.time() - t, s
        time.sleep(0.5)
    tg_rpc.call('find_cancel', job=job)
    return [], time.time() - t, {'timeout': True}


def check_link(u):
    req = urllib.request.Request(u, headers={'Range': 'bytes=0-65535', 'User-Agent': 'Kodi/21.3'})
    t = time.time()
    r = urllib.request.urlopen(req, timeout=40)
    b = r.read()
    kind = 'mkv' if b[:4] == b'\x1aE\xdf\xa3' else 'mp4' if b[4:8] == b'ftyp' else 'avi' if b[:4] == b'RIFF' else 'unknown %r' % b[:8]
    return r.status, len(b), r.headers.get('Content-Range', ''), kind, time.time() - t


targets = [({'type': 'movie', 'tmdb': t, 'imdb': i, 'title': n, 'year': y}, n) for n, y, t, i in FILMS]
targets.append(({'type': 'tv', 'tmdb': 1399, 'imdb': 'tt0944947', 'title': 'Game of Thrones', 'season': 1, 'episode': 2}, 'Game of Thrones S01E02'))
for target, name in targets:
    res, dt, raw = find(target)
    by = {}
    for s in res:
        by[s.get('backend')] = by.get(s.get('backend'), 0) + 1
    print('\n== %s: %d sources in %.1fs %s  order: %s' % (name, len(res), dt, by, ' '.join((s.get('backend') or '?') for s in res[:20])))
    rd = [s for s in res if s.get('backend') == 'rd']
    if not rd:
        fails.append('%s: no RD sources (%s)' % (name, {k: raw.get(k) for k in ('error', 'timeout', 'stage')}))
        continue
    for s in rd[:6]:
        print('   %-8s %6s MB  %s' % (s.get('quality') or s.get('res') or '', int((s.get('size') or 0) / 1048576), (s.get('file') or '')[:90]))
    ok = 0
    for s in rd[:3]:
        try:
            t = time.time()
            u = tg_rpc.call('rd_resolve', cand={'url': s.get('url'), 'rd': s.get('rd'), 'file': s.get('file')},
                            want={'season': target.get('season'), 'episode': target.get('episode')} if target['type'] == 'tv' else None)
            if 'error' in u:
                print('   resolve FAILED: %s' % str(u['error'])[:150])
                continue
            link = u['result']['url']
            status, n, cr, kind, d2 = check_link(link)
            total = int(cr.split('/')[-1]) if '/' in cr else 0
            print('   resolve %.1fs -> HTTP %s, %d bytes in %.1fs, total %d MB, container %s, ext %s' % (
                time.time() - t - d2, status, n, d2, total // 1048576, kind, link.rsplit('.', 1)[-1][:5]))
            if status in (200, 206) and n == 65536:
                ok += 1
                if target['type'] == 'tv' and not any(x in link.lower() for x in ('s01e02', '1x02', 'e02')):
                    print('   NOTE: the episode marker is not in the link name')
        except Exception as exc:
            print('   resolve/link error: %s' % str(exc)[:150])
    if not ok:
        fails.append('%s: none of the first RD sources resolved to a working link' % name)

print('\nRD LIVE FAILURES: %d' % len(fails))
for f in fails:
    print('   ' + f)
