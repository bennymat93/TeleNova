# -*- coding: utf-8 -*-
"""The world channel list (plugin.video.nova/resources/channels_world.json) and how it joins the merged list.
The file's shape, unique ids / names / streams, https only, known groups, no restream hosts, no clash with the
Israeli table; iptv.add_world leaves the Israeli rows alone and makes one channel of a world channel that a free
list also carries; the guide rows of the world channels (bn.w.<id>). No Kodi, no network (the streams themselves
are played by qa/check_channels.py)."""
import importlib
import io
import json
import os
import re
import sys
import types
import xml.etree.ElementTree as ET

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
NOVA = os.path.join(HERE, '..', 'plugin.video.nova')
for name in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules.setdefault(name, types.ModuleType(name))
x = sys.modules['xbmc']
x.LOGINFO, x.LOGWARNING, x.LOGERROR, x.LOGDEBUG, x.ISO_639_1 = 1, 2, 3, 0, 0
x.log = lambda *a, **k: None
x.getLanguage = lambda *a, **k: 'en'
x.Monitor = type('Monitor', (), {'abortRequested': lambda s: False, 'waitForAbort': lambda s, t=0: False})
sys.modules['xbmcaddon'].Addon = lambda *a: types.SimpleNamespace(getAddonInfo=lambda k: {'profile': HERE, 'path': NOVA}.get(k, ''),
                                                                 getSetting=lambda k: '', setSetting=lambda k, v: None)
sys.modules['xbmcvfs'].translatePath = lambda p: p
sys.path.insert(0, NOVA)
livefail = importlib.import_module('resources.lib.livefail')
iptv = importlib.import_module('resources.lib.iptv')
epg = importlib.import_module('resources.lib.epg')
bad = []


def check(cond, what):
    if not cond:
        bad.append(what)


# ---- the file
PATH = os.path.join(NOVA, 'resources', 'channels_world.json')
with io.open(PATH, encoding='utf-8') as f:
    doc = json.load(f)
rows = doc.get('channels')
check(isinstance(rows, list) and len(rows) >= 20, 'a "channels" list with the world channels: %r' % (rows and len(rows)))
rows = rows or []
groups = [g for g, _ in iptv.BLOCKS if g != 'Israel']
check(tuple(groups) == tuple(livefail.WORLD_GROUPS), 'livefail.WORLD_GROUPS are the groups of iptv.BLOCKS without Israel')
il_names = {iptv.norm(n) for names, _, _ in livefail.CHANNELS.values() for n in names}
ids, names, urls = set(), set(), set()
for w in rows:
    tag = w.get('id') or w.get('name') or '?'
    for field in ('id', 'name', 'group', 'lang', 'url', 'source'):
        check(isinstance(w.get(field), str) and w[field].strip(), '%s: "%s" is missing' % (tag, field))
    cid, name, url = w.get('id', ''), w.get('name', ''), w.get('url', '')
    check(re.match(r'^[a-z0-9_]+$', cid), '%s: id of a-z 0-9 _ only' % tag)
    check(cid not in ids, '%s: id twice' % tag)
    check(cid not in livefail.CHANNELS, '%s: the id is a key of the Israeli table' % tag)
    check(iptv.norm(name) not in names, '%s: name twice (%s)' % (tag, name))
    check(url not in urls, '%s: stream twice' % tag)
    ids.add(cid)
    names.add(iptv.norm(name))
    urls.add(url)
    check(url.startswith('https://') and '|' not in url and ' ' not in url, '%s: an https stream without header suffix' % tag)
    check('.m3u8' in url.split('?')[0], '%s: an HLS playlist' % tag)
    # (is_restream's token-path rule is for the free lists: it also matches Euronews' own /live/eds/<feed>/<number>)
    check(not any(h in url for h in livefail.RESTREAM_HOSTS) and not livefail._IP_HOST.match(url), '%s: a restream host / bare IP' % tag)
    check(w.get('group') in groups, '%s: group %r is not one of %s' % (tag, w.get('group'), groups))
    check(re.match(r'^[a-z]{2}$', w.get('lang', '')), '%s: lang is a two-letter code' % tag)
    check(not w.get('logo') or w['logo'].startswith('https://'), '%s: the logo is an https address' % tag)
    check('"' not in name and ',' not in name and name == iptv.display_name(name), '%s: the name is shown as written' % tag)
    check(iptv.norm(name) not in il_names and livefail.key_for(name) is None, '%s: the name belongs to an Israeli channel' % tag)
    check(not livefail.is_paid_il(name), '%s: reads as a paid Israeli channel' % tag)
loaded = livefail.world()
check(len(loaded) == len(rows), 'livefail.world() lists every row of the file: %d of %d' % (len(loaded), len(rows)))
check(livefail.world(os.path.join(HERE, 'no_such_file.json')) == [], 'a missing file is an empty list')

# ---- the merge: the Israeli rows are not disturbed
il_before = json.dumps({k: [v[0], v[1], [list(t) for t in v[2]]] for k, v in livefail.CHANNELS.items()}, sort_keys=True)
kan = {'attrs': {'tvg-id': 'Kan11.il'}, 'name': 'Kan 11', 'opts': [], 'src': 'iptv-org IL', 'q': 0, 'group': 'Israel',
       'url': 'https://example.org/kan.m3u8'}
best = {iptv.norm('Kan 11'): dict(kan)}
alts = {}
iptv.add_world(best, alts, loaded)
check(best[iptv.norm('Kan 11')] == kan, 'a channel of a free list that is not a world channel stays as it was')
check(len(best) == 1 + len(loaded), 'every world channel is in the list once: %d' % (len(best) - 1))
check(alts == {}, 'no fallbacks are made up')
for w in loaded:
    c = best.get(iptv.norm(w['name'])) or {}
    check(c.get('world') == w['id'] and c.get('group') == w['group'] and c.get('url') == w['url'] and c.get('src') == 'BN'
          and not c.get('key'), '%s: listed in its group with its own stream' % w['id'])
    check(c.get('attrs', {}).get('tvg-logo', '') == (w.get('logo') or ''), '%s: its logo' % w['id'])
    order = ([b for b, _ in iptv.BLOCKS].index(c.get('group', 'Other')), c.get('name', '').lower())   # the sort key of the merge
    check(order[0] > 0, '%s: after the Israeli block' % w['id'])
check(json.dumps({k: [v[0], v[1], [list(t) for t in v[2]]] for k, v in livefail.CHANNELS.items()}, sort_keys=True) == il_before,
      'the Israeli table is unchanged by the merge')
# a world channel a free list also carries: one channel, the tested stream first, the list's stream as the fallback
if loaded:
    w = loaded[0]
    k = iptv.norm(w['name'])
    listed = {'attrs': {'tvg-id': 'X.fr'}, 'name': w['name'] + ' (1080p)', 'opts': [], 'src': 'iptv-org News', 'q': 0,
              'group': 'News', 'url': 'https://example.org/other.m3u8'}
    k_list = iptv.norm(listed['name'])               # the key the merge files a list channel under
    best, alts = {k_list: listed}, {}
    iptv.add_world(best, alts, [w])
    check(len(best) == 1 and best[k]['name'] == w['name'] and best[k]['url'] == 'plugin://plugin.video.nova/?a=live&alt=' + k,
          'the two become one channel that plays through the fallback list: %r' % best[k].get('url'))
    check(len(alts.get(k, [])) == 2 and alts[k][0].split('|')[0] == w['url'] and alts[k][1].split('|')[0] == listed['url'],
          'the tested stream first, the list stream second: %r' % alts.get(k))
    # the list carried the very same stream: still one direct channel
    same = dict(listed, url=w['url'])
    best, alts = {k_list: same}, {}
    iptv.add_world(best, alts, [w])
    check(list(best) == [k] and best[k]['url'] == w['url'] and alts == {}, 'the same stream twice is one direct stream')
    # the list already had several streams for it
    best = {k_list: dict(listed, url='plugin://plugin.video.nova/?a=live&alt=' + k_list)}
    alts = {k_list: ['https://a/1.m3u8|User-Agent=x', w['url'] + '|User-Agent=x']}
    iptv.add_world(best, alts, [w])
    check(list(alts) == [k] and [u.split('|')[0] for u in alts[k]] == [w['url'], 'https://a/1.m3u8'],
          'joins the existing fallbacks, first, once: %r' % alts)

# ---- the guide rows of the world channels (and the Israeli ones next to them)
if loaded:
    w = loaded[0]
    lines = ['#EXTM3U', '#EXTINF:-1 tvg-id="bn.musawa" tvg-chno="5" group-title="Israel",Musawa', 'http://x',
             '#EXTINF:-1 tvg-id="%s%s" tvg-chno="100" group-title="%s",%s' % (livefail.WORLD_GUIDE, w['id'], w['group'], w['name']), w['url'],
             '#EXTINF:-1 tvg-id="bn.w.nosuchid",X', 'http://z']
    own = livefail.own_rows(lines)
    check([r[0] for r in own] == ['bn.musawa', livefail.WORLD_GUIDE + w['id']], 'own guide rows: Israeli and world, known ids only: %r' % own)
    parts = livefail.own_guide(own, now=1794500000)
    root = ET.fromstring(('<tv>' + ''.join(epg.well_formed(p) for p in parts) + '</tv>').encode('utf-8'))
    check([c.get('id') for c in root.iter('channel')] == ['bn.musawa', livefail.WORLD_GUIDE + w['id']] and
          len(list(root.iter('programme'))) == 24, 'real XML, 12 entries a channel')
    # the Israeli filler never touches a world line
    import tempfile
    m3u = os.path.join(tempfile.mkdtemp(), 'c.m3u')
    with io.open(m3u, 'w', encoding='utf-8') as f:
        f.write(u'\n'.join(lines))
    iptv.fill_unserved(set(), m3u)
    with io.open(m3u, encoding='utf-8') as f:
        check(f.read().split('\n')[3:] == lines[3:], 'fill_unserved leaves the world lines as they are')

for b in bad:
    print('FAIL', b)
print('WORLD CHANNELS TESTS OK (%d channels)' % len(rows) if not bad else 'WORLD CHANNELS TESTS: %d problems' % len(bad))
sys.exit(1 if bad else 0)
