# -*- coding: utf-8 -*-
"""Audit of the Israel group of the channel list the running build produced: for every channel - is there a logo
and does it load, is there a guide id, and does the guide hold programmes for today? Read only.
   python t_il_audit.py            prints one line per channel and a summary; exit code 1 when something is missing"""
import gzip, io, os, re, sys, time, concurrent.futures as cf
import xml.etree.ElementTree as ET

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import requests

D = os.path.join(os.environ['APPDATA'], 'Kodi', 'userdata', 'addon_data', 'plugin.video.nova')
m3u = io.open(os.path.join(D, 'nova_channels.m3u'), encoding='utf-8').read().splitlines()
chans = []
for i, l in enumerate(m3u):
    if l.startswith('#EXTINF') and re.search(r'group-title="[^"]*(Israel|ישראל)', l):
        g = lambda k: (re.search(r'%s="([^"]*)"' % k, l) or [None, ''])[1]
        url = next((x for x in m3u[i + 1:i + 6] if x and not x.startswith('#')), '')
        chans.append({'name': l.rsplit(',', 1)[-1].strip(), 'logo': g('tvg-logo'), 'id': g('tvg-id'), 'url': url})
# every guide file the build made
guides = [f for f in os.listdir(D) if re.search(r'(guide|epg).*\.(xml|xml\.gz)$', f, re.I)]
prog, names = {}, {}
today = time.strftime('%Y%m%d')
for f in guides:
    p = os.path.join(D, f)
    try:
        raw = gzip.open(p).read() if f.endswith('.gz') else open(p, 'rb').read()
        root = ET.fromstring(raw)
    except Exception as e:
        print('guide file %s unreadable: %s' % (f, type(e).__name__))
        continue
    for c in root.iter('channel'):
        names[c.get('id')] = (c.findtext('display-name') or '')
    for pr in root.iter('programme'):
        cid = pr.get('channel')
        st = prog.setdefault(cid, [0, 0])
        st[0] += 1
        if (pr.get('start') or '').startswith(today):
            st[1] += 1
print('guide files: %s | channels with programmes: %d' % (guides, len(prog)))


def logo_ok(u):
    if not u:
        return 'none'
    if u.startswith(('special://', '/')) or re.match(r'^[A-Za-z]:\\', u):
        path = u.replace('special://home/', os.path.join(os.environ['APPDATA'], 'Kodi') + os.sep).replace('special://profile/', os.path.join(os.environ['APPDATA'], 'Kodi', 'userdata') + os.sep)
        return 'ok' if os.path.exists(path) and os.path.getsize(path) > 1500 else 'missing file'
    try:
        r = requests.get(u, timeout=10, headers={'User-Agent': 'Mozilla/5.0'})
        if r.status_code == 200 and len(r.content) > 1500 and r.headers.get('Content-Type', '').startswith('image/'):
            return 'svg' if 'svg' in r.headers.get('Content-Type', '') else 'ok'
        return 'http %s %s' % (r.status_code, r.headers.get('Content-Type', '')[:20])
    except Exception as e:
        return type(e).__name__


with cf.ThreadPoolExecutor(12) as ex:
    logos = list(ex.map(lambda c: logo_ok(c['logo']), chans))
bad_logo = bad_epg = 0
for c, lg in zip(sorted(chans, key=lambda c: c['name'].lower()), [x for _, x in sorted(zip([c['name'].lower() for c in chans], logos))]):
    st = prog.get(c['id'], [0, 0]) if c['id'] else [0, 0]
    epg = 'today %d / all %d' % (st[1], st[0]) if st[0] else ('id, no programmes' if c['id'] else 'no id')
    bad_logo += lg != 'ok'
    bad_epg += st[1] == 0
    src = 'licensed' if 'a=live&ch=' in c['url'] else 'list'
    print('%-34s %-8s logo: %-14s guide: %s' % (c['name'][:34], src, lg, epg))
print('%d channels | logo missing / broken: %d | no programmes today: %d' % (len(chans), bad_logo, bad_epg))
sys.exit(1 if bad_logo or bad_epg else 0)
