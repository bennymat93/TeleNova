# -*- coding: utf-8 -*-
"""web/channels_il.json from the build's own Israeli channel table (plugin.video.nova/resources/lib/livefail.py).

  python src/qa/web/gen_channels.py          writes web/channels_il.json and copies the channel logos to web/media/live/

Every channel of the build is listed. What a browser can do with it:
  urls   the broadcaster's direct https HLS streams, in the build's order (failover in web/iptv.js)
  http   direct streams that are http only (a secure page plays them only through an https copy / the helper)
  yt     an official YouTube channel whose permanent live broadcast is the channel ("yt:<id>" in the build): the web
         app plays it in YouTube's own embedded player (no lookup needed)
  mako   Keshet's channels: [{link, cdn?, host?}] - a path on Keshet's CDN that plays with a ticket from Keshet's own
         public ticket service, exactly what the player on mako.co.il (and Idan+ in the build) asks for
  site   the broadcaster's own live page - the "watch on the official site" link when no stream plays here
  logo   the build's own logo file (resources/media/logos), copied next to the app
  guide  the name of the channel whose programme guide this feed shares (livefail.SAME_GUIDE)
A channel the build plays only through Idan+ (the add-on it bundles) gets here the same official address Idan+ plays
(IDAN_DIRECT / IDAN_KESHET below), so it plays in a browser too. A channel with none of urls / http / yt / mako is
marked "kodi_only" with "why": "idanplus": web/iptv.js still looks for it in the free playlists at run time (as the
build's iptv._merge does) and offers the official site. run_web_tests.py checks that the file is up to date."""
import importlib.util, json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(ROOT, 'web', 'channels_il.json')
LOGOS_IN = os.path.join(ROOT, 'src', 'plugin.video.nova', 'resources', 'media', 'logos')
LOGOS_OUT = os.path.join(ROOT, 'web', 'media', 'live')
HEBREW = re.compile(r'[֐-׿]')
YT_REF = re.compile(r'^yt:((?:UC[0-9A-Za-z_-]{22})|(?:@[0-9A-Za-z_.\-]{3,40}))$')

# the broadcasters' own live pages (docs/RESEARCH-il-channels*.md "proof" column): by channel key, then by the
# Idan+ module that plays the channel in the build
SITE_KEY = {
    'keshet12': 'https://www.mako.co.il/mako-vod-live-tv/VOD-6540b8dcb64fd31006.htm',
    'keshet12c': 'https://www.mako.co.il/mako-vod-live-tv/VOD-6540b8dcb64fd31006.htm',
    'knesset': 'https://www.knesset.tv/', 'knesset99c': 'https://www.knesset.tv/',
    'ch9': 'https://www.9tv.co.il/', 'kalkala10': 'https://www.calcalist.co.il/', 'ch16': 'https://www.ch16.co.il/',
    'i24he': 'https://www.i24news.tv/he', 'i24en': 'https://www.i24news.tv/en', 'i24fr': 'https://www.i24news.tv/fr',
    'i24ar': 'https://www.i24news.tv/ar', 'kab66': 'https://www.kab.co.il/', 'kabru': 'https://www.kabbalah.info/rus/tv/',
    'kotel': 'https://thekotel.org/he/', 'lev91': 'https://www.91fm.co.il/', 'kolchaimusic': 'https://www.kcm.fm/',
    'musawa': 'https://musawachannel.com/live', 'radius100': 'https://www.100fm.co.il/', 'pervoe891': 'https://www.891fm.co.il/',
    'hidabroot': 'https://www.hidabroot.org/live', 'now14': 'https://www.c14.co.il/live',
}
SITE_MODULE = {'keshet': 'https://www.mako.co.il/', 'reshet': 'https://13tv.co.il/live/', 'kan': 'https://www.kan.org.il/live/',
               'hidabroot': 'https://www.hidabroot.org/live', '14tv': 'https://www.c14.co.il/live'}


# What the build's bundled Idan+ plays for its channel ids (plugin.video.idanplus 4.0.2, resources/channels.json
# "linkDetails", read 18/11/2026). Module 'tv' / 'reshet' / 'kan' entries are the broadcaster's own plain HLS address
# (all answered a page of another origin on 18/11: 200 + Access-Control-Allow-Origin). They are added AFTER the
# direct streams livefail.py already names, never instead of them.
IDAN_DIRECT = {
    'ch_13comedy': 'https://d15ds134q59udk.cloudfront.net/out/v1/fbba879221d045598540ee783b140fe2/index.m3u8',
    'ch_13nofesh': 'https://d1yd8hohnldm33.cloudfront.net/out/v1/19dee23c2cc24f689bd4e1288661ee0c/index.m3u8',
    'ch_13reality': 'https://d2dffl3588mvfk.cloudfront.net/out/v1/d8e15050ca4148aab0ee387a5e2eb46b/index.m3u8',
    'ch_99': 'https://kneset.gostreaming.tv/p2-kneset/_definst_/myStream/index.m3u8',
    'ch_99c': 'https://kneset.gostreaming.tv/p2-Accessibility/_definst_/myStream/index.m3u8',
    'ch_100': 'https://cdn.cybercdn.live/Radios_100FM/Video/playlist.m3u8',
    # Idan+ reads this address at play time from the station's own player page (https://www.oles.tv/891fm/player/,
    # "streamSource = '...'"); a browser cannot read that page (no CORS), so the address it names is kept here
    'ch_891': 'https://cdn.cybercdn.live/Pervoia/Video/playlist.m3u8',
    'ch_11': 'https://r.il.cdn-redge.media/livehls/oil/kancdn-live/live/kan11/live.livx/playlist.m3u8?dvr=21600000',
}
# Module 'keshet': a path on Keshet's CDN. It plays with a ticket that Keshet's public ticket service
# (mass.mako.co.il/ClicksStatistics/entitlementsServicesV2.jsp?et=ngt&lp=<link>&rv=<cdn>, open to any origin) gives
# without any login: the same request the player on mako.co.il makes. web/iptv.js asks for it when the channel opens.
IDAN_KESHET = {
    'ch_12': {'link': '/stream/hls/live/2033791/k12/index.m3u8'},
    'ch_12b': {'link': '/stream/hls/live/2033791/k12n12wad/index.m3u8'},
    'ch_12b2': {'link': '/stream/hls/live/2033791/k12dvr/index.m3u8'},
    'ch_12c': {'link': '/k12cc/index.m3u8?b-in-range=0-1800', 'host': 'https://d2249b6f08tjt0.cloudfront.net', 'cdn': 'AWS'},
    'ch_24': {'link': '/direct/hls/live/2035340/ch24live/index.m3u8?as=1'},
    'ch_24b': {'link': '/evrideo/hls/live/20001278/ch24live/index.m3u8'},
    'ch_erets': {'link': '/evrideo/hls/live/20001278/erets/index.m3u8'},
    'ch_savri': {'link': '/evrideo/hls/live/20001278/savri/index.m3u8'},
    'ch_free_comedy': {'link': '/evrideo/hls/live/20001278/free_comedy/index.m3u8'},
    'ch_free_drama': {'link': '/evrideo/hls/live/20001278/free_drama/index.m3u8'},
    'ch_free_music': {'link': '/evrideo/hls/live/20001278/free_music/index.m3u8'},
    'ch_free_food': {'link': '/evrideo/hls/live/20001278/free_food/index.m3u8'},
}


def _livefail():
    spec = importlib.util.spec_from_file_location('livefail', os.path.join(ROOT, 'src', 'plugin.video.nova', 'resources', 'lib', 'livefail.py'))
    lf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(lf)
    return lf


def _logo(lf, key):
    """'media/live/<key>.png' when the build ships a logo for the channel (its own, or its main channel's)"""
    for k in (key, getattr(lf, 'SAME_LOGO', {}).get(key)):
        if k and os.path.isfile(os.path.join(LOGOS_IN, k + '.png')):
            return 'media/live/%s.png' % k
    return ''


def build():
    lf = _livefail()
    out = []
    for key, entry in lf.CHANNELS.items():
        names = list(entry[0])
        direct = [str(u).split('|')[0].strip() for u in (entry[1] if len(entry) > 1 else [])]
        idan = list(entry[2]) if len(entry) > 2 else []
        urls = [u for u in direct if u.startswith('https://')]
        http = [u for u in direct if u.startswith('http://')]
        yt = next((YT_REF.match(u).group(1) for u in direct if YT_REF.match(u)), '')
        mako = []
        for i in idan:                                    # the same sources the build reaches through Idan+
            cid = str(i[0])
            if cid in IDAN_DIRECT and IDAN_DIRECT[cid] not in urls:
                urls.append(IDAN_DIRECT[cid])
            if cid in IDAN_KESHET:
                mako.append(dict(IDAN_KESHET[cid]))
        row = {'key': key, 'name': next((n for n in names if not HEBREW.search(n)), names[0]),
               'name_he': next((n for n in names if HEBREW.search(n)), ''), 'names': names}
        if urls:
            row['urls'] = urls
        if http:
            row['http'] = http
        if yt:
            row['yt'] = yt
        if mako:
            row['mako'] = mako
        if not urls and not http and not yt and not mako:
            row['kodi_only'] = True
            row['why'] = 'idanplus'
        elif not urls and yt:
            row['why'] = 'youtube'          # (the shell's own channel sheet reads this; web/iptv.js plays the embed)
        module = next((str(i[1]) for i in idan if len(i) > 1), '')
        site = SITE_KEY.get(key) or SITE_MODULE.get(module, '')
        if site:
            row['site'] = site
        logo = _logo(lf, key)
        if logo:
            row['logo'] = logo
        guide = getattr(lf, 'SAME_GUIDE', {}).get(key)
        if guide:
            row['guide'] = guide
        out.append(row)
    return out


def copy_logos(rows):
    os.makedirs(LOGOS_OUT, exist_ok=True)
    n = 0
    for name in sorted(set(os.path.basename(r['logo']) for r in rows if r.get('logo'))):
        src, dst = os.path.join(LOGOS_IN, name), os.path.join(LOGOS_OUT, name)
        if not os.path.isfile(dst) or os.path.getsize(dst) != os.path.getsize(src):
            shutil.copyfile(src, dst)
        n += 1
    return n


if __name__ == '__main__':
    rows = build()
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
        f.write('\n')
    logos = copy_logos(rows)
    here = sum(1 for r in rows if r.get('urls') or r.get('yt') or r.get('mako'))
    sys.stdout.buffer.write(('%d channels, %d play in a browser from the table (%d by YouTube, %d with Keshet\'s ticket), %d only on the official site, %d logos -> %s\n' % (
        len(rows), here, sum(1 for r in rows if r.get('yt') and not r.get('urls')), sum(1 for r in rows if r.get('mako') and not r.get('urls')),
        sum(1 for r in rows if r.get('kodi_only')), logos, OUT)).encode('utf-8'))
