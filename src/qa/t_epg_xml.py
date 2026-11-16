# -*- coding: utf-8 -*-
"""4.1.2: the guide the build writes is real XML whatever the free guides and the translations hold. No Kodi."""
import time
import re, time
import importlib, io, os, sys, types
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
epg = importlib.import_module('resources.lib.epg')
bad = []


def check(cond, what):
    if not cond:
        bad.append(what)


SRC = u'''<tv>
<channel id="a.il"><display-name>Kids & Co</display-name><icon src="http://x/y?a=1&b=2"/></channel>
<channel id="other"><display-name>Other</display-name></channel>
<programme start="20261116180000 +0200" stop="20261116190000 +0200" channel="a.il"><title lang="en">Pinkalicious & Peterrific</title><desc>Tom &amp; Jerry &#39;s &lt;best&gt; R&D \x07show</desc></programme>
<programme start="20261116190000 +0200" stop="20261116200000 +0200" channel="a.il"><title lang="en">News</title></programme>
<programme start="20261116190000 +0200" stop="20261116200000 +0200" channel="other"><title>X & Y</title></programme>
</tv>'''
parts = epg.filter_guide(SRC, {'a.il'})
check(len(parts) == 3, 'only the wanted channel: %d parts' % len(parts))
doc = '<tv>' + ''.join(parts) + '</tv>'
root = ET.fromstring(doc.encode('utf-8'))
titles = [p.findtext('title') for p in root.iter('programme')]
check(titles == ['Pinkalicious & Peterrific', 'News'], 'titles read back as they were meant: %r' % titles)
check(root.find('programme').findtext('desc') == u"Tom & Jerry 's <best> R&D show", 'entities kept once, bare & fixed, control character gone: %r' % root.find('programme').findtext('desc'))
check(root.find('channel').find('icon').get('src') == 'http://x/y?a=1&b=2', 'attribute values too')
tr = {'Pinkalicious & Peterrific': u'פינקלישס & פיטריפיק <חדש>', 'News': u'חדשות'}
out = epg.apply_lang(parts, tr, 'he')
root = ET.fromstring(('<tv>' + ''.join(out) + '</tv>').encode('utf-8'))
check([p.findtext('title') for p in root.iter('programme')] == [u'פינקלישס & פיטריפיק <חדש>', u'חדשות'], 'a translation with & and < stays text')
W = epg.well_formed
check(W('a &amp; b &lt; &#39; &#x27; &quot; &apos; &gt;') == 'a &amp; b &lt; &#39; &#x27; &quot; &apos; &gt;', 'what is already right is not touched')
check(W('AT&T &amp R&B;') == 'AT&amp;T &amp;amp R&amp;B;', 'look-alikes are escaped: %r' % W('AT&T &amp R&B;'))
check(W(W('Q & A')) == W('Q & A'), 'applying twice changes nothing')
check(epg.xml_text('a<b>&c') == 'a&lt;b&gt;&amp;c' and epg.xml_text(None) == '', 'plain text between tags')
# 4.1.2: the build's own guide rows for channels no guide lists - built from the playlist lines, real XML, with
# programmes covering now (the free-guide refresh rewrites the guide and used to drop them)
livefail = importlib.import_module('resources.lib.livefail')
lines = ['#EXTM3U', '#EXTINF:-1 tvg-id="bn.musawa" tvg-chno="5",Musawa', 'http://x',
         '#EXTINF:-1 tvg-id="kan.il",Kan 11', 'http://y', '#EXTINF:-1 tvg-id="bn.nosuchkey",X', 'http://z',
         '#EXTINF:-1 tvg-id="bn.musawa",Musawa again', 'http://w']
rows = livefail.own_rows(lines)
check([r[0] for r in rows] == ['bn.musawa'], 'own rows from the playlist (known keys, once): %r' % rows)
now = 1794500000
own = livefail.own_guide(rows, now=now)
root = ET.fromstring(('<tv>' + ''.join(epg.well_formed(p) for p in own) + '</tv>').encode('utf-8'))
progs = list(root.iter('programme'))
check(root.find('channel').get('id') == 'bn.musawa' and len(progs) == 12, 'one channel, 3 days x 4 entries: %d' % len(progs))
stamp = time.strftime('%Y%m%d%H%M%S', time.gmtime(now))
check(any(p.get('start')[:14] <= stamp < p.get('stop')[:14] for p in progs), 'an entry covers now')
# 4.1.2: Israeli channels whose id no guide serves get filler rows UNDER THEIR OWN ID (an id is never replaced);
# only a channel with no id gets one, from a hash of its full name (review findings of 16/11)
iptv = importlib.import_module('resources.lib.iptv')
import tempfile
tmpd = tempfile.mkdtemp()
m3u = os.path.join(tmpd, 'c.m3u')
open(m3u, 'w', encoding='utf-8').write(chr(10).join([
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="kan.il" tvg-chno="1" group-title="Israel",Kan 11', 'http://a',
    '#EXTINF:-1 tvg-id="Channel16.il@SD" tvg-chno="2" group-title="Israel",Channel 16', 'http://b',
    '#EXTINF:-1 tvg-chno="3" group-title="Israel",רשת 13', 'http://c',
    '#EXTINF:-1 tvg-chno="4" group-title="Israel",13 ערוץ הקומדיות', 'http://d',
    '#EXTINF:-1 tvg-id="bn.musawa" tvg-chno="5" group-title="Israel",Musawa', 'http://e',
    '#EXTINF:-1 tvg-id="BBC.uk" tvg-chno="100" group-title="News",BBC', 'http://f']))
# 1st refresh: the guide that serves "kan.il" and "Channel16.il@SD" is down - only nothing is served
parts = iptv.fill_unserved(set(), m3u)
got = open(m3u, encoding='utf-8').read()
ids = re.findall(r'tvg-id="([^"]+)"', got)
check(ids[0] == 'kan.il' and ids[1] == 'Channel16.il@SD' and ids[4] == 'bn.musawa' and ids[5] == 'BBC.uk',
      'existing ids are never replaced, even when their guide is down: %r' % ids)
check(ids[2].startswith('bn.n.') and ids[3].startswith('bn.n.') and ids[2] != ids[3],
      'two Hebrew names with the same digits get different ids: %r' % ids[2:4])
root = ET.fromstring(('<tv>' + ''.join(parts) + '</tv>').encode('utf-8'))
chans = [c.get('id') for c in root.iter('channel')]
check(chans == ['kan.il', 'Channel16.il@SD', ids[2], ids[3], 'bn.musawa'], 'filler while the guide is down: %r' % chans)
names = [c.findtext('display-name') for c in root.iter('channel')]
check(names[2] != names[3], 'each filler row carries its own channel name')
# 2nd refresh: the guide is back - nothing is rewritten, no filler for what it serves
before = got
parts = iptv.fill_unserved({'kan.il', 'Channel16.il@SD', 'bn.musawa', ids[2], ids[3]}, m3u)
check(parts == [] and open(m3u, encoding='utf-8').read() == before, 'when the guide answers again its programmes are used, the playlist is untouched')
# the hash ids are stable between refreshes
parts = iptv.fill_unserved({'kan.il'}, m3u)
check(re.findall(r'tvg-id="([^"]+)"', open(m3u, encoding='utf-8').read()) == ids, 'ids stable over refreshes')
# the guide the running build made (when there is one): must parse
real = os.path.join(os.environ.get('APPDATA', ''), 'Kodi', 'userdata', 'addon_data', 'plugin.video.nova', 'nova_epg.xml.gz')
if os.path.exists(real):
    import gzip
    text = gzip.open(real).read().decode('utf-8', 'replace')
    try:
        ET.fromstring(text.encode('utf-8'))
        print('the guide file of this Kodi: real XML')
    except ET.ParseError as e:
        fixed = '\n'.join(W(l) for l in text.split('\n'))
        try:
            n = len(list(ET.fromstring(fixed.encode('utf-8')).iter('programme')))
            print('the guide file of this Kodi: NOT real XML as written (%s); with the fix it is: %d programmes' % (e, n))
        except ET.ParseError as e2:
            bad.append('the real guide is still not XML after the fix: %s' % e2)
for b in bad:
    print('FAIL', b)
print('EPG XML TESTS OK' if not bad else 'EPG XML TESTS: %d problems' % len(bad))
sys.exit(1 if bad else 0)
