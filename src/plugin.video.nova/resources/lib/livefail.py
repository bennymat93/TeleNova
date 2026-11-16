# -*- coding: utf-8 -*-
"""Israeli channels with automatic failover (1.4.0 Phase 3).

Found by tools/stream_check.py (30/09): the free playlists carry the main Israeli channels only through restream
servers (iptvhd.ru / freeott / mcquack) - unlicensed copies, several paid (HOT, Sport 5), mostly 403. Those hosts
are dropped (RESTREAM_HOSTS, iptv.merge). The main channels play from licensed sources instead, several per
channel, tried in order:
  1. the broadcaster's own public stream (checked in 3 s),
  2. Idan+ (bundled, official broadcaster players) - main feed, then its backup feeds.
The playlist entry of such a channel is plugin://plugin.video.nova/?a=live&ch=<key>; live() resolves it.
"""
import re

RESTREAM_HOSTS = ('iptvhd.ru', 'freeott.top', 'mcquack.net')

KAN = 'https://kancdn.medonecdn.net/livehls/oil/kancdn-live/live/%s/live.livx/playlist.m3u8'
IDAN = 'plugin://plugin.video.idanplus/?url=%s&mode=%s&module=%s&moredata=best'
# 4.1.2: channels whose official direct stream is of a lower quality than what Idan+ gets: Idan+ first, the
# direct stream as the fallback (everywhere else the direct stream comes first - it starts faster and does not
# depend on another add-on)
DIRECT_LAST = ('reshet13',)

# key: (names the playlists / guides use, [direct streams], [(Idan+ url, module, mode)])
CHANNELS = {
    'kan11': (['Kan 11', 'כאן 11'], [KAN % 'kan11'], [('ch_11', 'kan', 10), ('ch_11b', 'tv', 10)]),
    'keshet12': (['Keshet 12', 'קשת 12', 'Channel 12'], [],
                 [('ch_12', 'keshet', 10), ('ch_12b', 'keshet', 10), ('ch_12b2', 'keshet', 10)]),
    'reshet13': (['Channel 13 (Israel)', 'Reshet 13', 'רשת 13', 'Channel 13'], ['https://d198ztbnlup2iq.cloudfront.net/out/v1/850e31c0e6fa4d94a44d6ccd63e4b400/index.m3u8'],   # 720p only: tried after Idan+ (DIRECT_LAST)
                 [('ch_13', 'reshet', 4), ('ch_13b', 'reshet', 4), ('ch_13b2', 'reshet', 4)]),
    'now14': (['Now 14', 'עכשיו 14', 'Channel 14'], ['https://r.il.cdn-redge.media/livehls/oil/ch14/live/ch14/live.livx/playlist.m3u8'],
              [('ch_14', '14tv', 10), ('ch_14b', 'tv', 10), ('ch_14b2', 'tv', 10)]),
    'kanedu': (['Kan Educational', 'כאן חינוכית'], [KAN % 'kan_edu'], [('ch_23', 'kan', 10), ('ch_23b', 'tv', 10)]),
    'ch24': (['Channel 24 (Israel)', 'Channel 24', 'ערוץ 24'], [], [('ch_24', 'keshet', 10), ('ch_24b', 'keshet', 10)]),
    'makan33': (['Makan 33', 'מכאן 33'], [KAN % 'makan'], [('ch_33', 'kan', 10), ('ch_33b', 'tv', 10)]),
    'knesset': (['Knesset Channel', 'ערוץ הכנסת', 'כנסת 99'], ['https://knesetn.gostreaming.tv/Knesset/index.m3u8'], [('ch_99', 'tv', 10)]),
    'ch9': (['Channel 9 (Israel)', 'Channel 9', 'ערוץ 9'], ['https://contact.gostreaming.tv/Con-11/index.m3u8'], [('ch_9', 'tv', 10)]),
    'hidabroot': (['Hidabroot', 'הידברות'], ['https://cdn.cybercdn.live/HidabrootIL/Live97/playlist.m3u8',
                                           'https://htv-live.cybercdn.live/HidabrootIL/Live97/playlist.m3u8'], [('ch_97', 'hidabroot', 10)]),
    'i24he': (['i24NEWS Hebrew', 'i24 עברית'], ['https://i24newshebrew-cdn.encoders.immergo.tv/master.m3u8'], [('ch_i24news', 'tv', 10)]),
    'i24en': (['i24NEWS English'], ['https://i24newsenglish-cdn.encoders.immergo.tv/master.m3u8'], [('ch_i24newsen', 'tv', 10)]),
    'i24fr': (['i24NEWS French'], ['https://i24newsfrench-cdn.encoders.immergo.tv/master.m3u8'], [('ch_i24newsfr', 'tv', 10)]),
    'i24ar': (['i24NEWS Arabic'], ['https://i24newsarabic-cdn.encoders.immergo.tv/master.m3u8'], [('ch_i24newsar', 'tv', 10)]),
    # 4.0.2: the rest of what Idan+ carries - the broadcasters' own free web channels. Every one of them is always in
    # the channel list (iptv._merge adds the keys that no playlist brought), the ones a playlist also carries get
    # Idan+ as their fallback. Paid cable / satellite channels have no licensed free source and stay out.
    'kalkala10': (['Kalkala 10', 'כלכלה 10'], ['https://r.il.cdn-redge.media/livehls/oil/calcala-live/live/channel10/live.livx/playlist.m3u8'], [('ch_10', 'tv', 10)]),
    'ch16': (['Channel 16', 'ערוץ 16'], ['https://ch16israel-cdn.encoders.immergo.tv/2/streamPlaylist.m3u8'], [('ch_16tv', 'tv', 10)]),
    'kab66': (['Kabbalah for the People Israel', 'קבלה 66', 'קבלה לעם'], ['https://edge2.il.kab.tv/live/tv66-heb-high/playlist.m3u8'], [('ch_66', 'tv', 10)]),
    'kabru': (['Kabbalah (Russian)', 'קבלה - רוסית'], ['https://edge3.uk.kab.tv/live/tvrus-rus-high/playlist.m3u8'], [('ch_kabru', 'tv', 10)]),
    # played 13/11 (qa/t_live_keys.py): Big Brother 26, Musayof, Ynet Live and the Sport 5 site did not start - left out
    'comedy13': (['Comedy Channel', '13 ערוץ הקומדיות'], [], [('ch_13comedy', 'reshet', 4)]),
    'nofesh13': (['Vacation Channel', 'ערוץ הנופש'], [], [('ch_13nofesh', 'reshet', 4)]),
    'reality13': (['Reality Channel', 'ערוץ הריאליטי'], [], [('ch_13reality', 'reshet', 4)]),
    'eretz': (['Eretz Nehederet Channel', 'ערוץ ארץ נהדרת'], [], [('ch_erets', 'keshet', 10)]),
    'savri': (['Savri Maranan Channel', 'ערוץ סברי מרנן'], [], [('ch_savri', 'keshet', 10)]),
    'kcomedy': (['Keshet Comedy Channel', 'ערוץ הקומדיה'], [], [('ch_free_comedy', 'keshet', 10)]),
    'kdrama': (['Keshet Drama Channel', 'ערוץ הדרמה'], [], [('ch_free_drama', 'keshet', 10)]),
    'kmusic': (['Keshet Music Channel', 'ערוץ המוזיקה'], [], [('ch_free_music', 'keshet', 10)]),
    'kfood': (['Keshet Food Channel', 'ערוץ האוכל'], [], [('ch_free_food', 'keshet', 10)]),
    # 4.0.3: the broadcasters' feeds for the hard of hearing (subtitled / signed)
    'kan11c': (['Kan 11 - subtitled', 'כאן 11 - לקויי שמיעה'], [KAN % 'kan11_subs'], [('ch_11c', 'kan', 10)]),
    'keshet12c': (['Keshet 12 - subtitled', 'קשת 12 - לקויי שמיעה'], [], [('ch_12c', 'keshet', 10)]),
    'reshet13c': (['Reshet 13 - subtitled', 'רשת 13 - לקויי שמיעה'], ['https://reshet.g-mana.live/media/4607e158-e4d4-4e18-9160-3dc3ea9bc677/mainManifest.m3u8'], [('ch_13c', 'reshet', 4)]),
    'knesset99c': (['Knesset Channel - subtitled', 'ערוץ הכנסת - לקויי שמיעה'], [], [('ch_99c', 'tv', 10)]),
    # 4.0.6: official streams found on the broadcasters' own sites / YouTube channels (docs/RESEARCH-il-channels.md)
    'kotel': (['Western Wall Live', 'הכותל המערבי - שידור חי'], ['yt:UCvcdHbNAQvbe2GuIDLhlwaw'], []),
    'lev91': (['Lev HaMedina 91FM (video)', 'רדיו לב המדינה 91FM - וידאו'], ['https://cdn.cybercdn.live/Lev_Hamedina/Video/playlist.m3u8'], []),
    'kolchaimusic': (['Kol Chai Music', 'קול חי מיוזיק - ערוץ הקליפים'], ['https://media.kcm.fm/rtmp-server/live/musiclip.m3u8'], []),
    # Not added (checked 16/11 18:00): Meir TV and 103FM broadcast on YouTube by day only, and YouTube sources proved
    # less dependable than HLS ones - on a day YouTube asks the address to "sign in to confirm you're not a bot" the
    # YouTube add-on needs 30-65 s to start any video. No more yt: channels until that path is dependable.
    # 4.1.2 (docs/RESEARCH-il-channels-2.md): the channel's own stream, checked three times on 16/11
    'musawa': (['Musawa', 'قناة مساواة', 'מוסאוא'], ['https://pbc.furrera.ps/musawahd/index.m3u8'], []),
    'radius100': (['100FM Radius (video)', '100FM רדיוס'], [], [('ch_100', 'tv', 10)]),
    'pervoe891': (['Первое Радио 89.1FM'], [], [('ch_891', 'tv', 10)]),
}


# 4.1.2: a channel that is a second feed of another one (subtitled / signed) shows the same programmes: it gets
# the guide of the main channel (the value is the name the main channel is shown by)
SAME_GUIDE = {'kan11c': 'Kan 11', 'keshet12c': 'Keshet 12', 'reshet13c': 'Channel 13 (Israel)', 'knesset99c': 'Knesset Channel'}
# ... and wears the logo of the main channel when it has none of its own
SAME_LOGO = {'kan11c': 'kan11', 'keshet12c': 'keshet12', 'reshet13c': 'reshet13', 'knesset99c': 'knesset',
             'kabru': 'kab66', 'comedy13': 'reshet13', 'nofesh13': 'reshet13', 'reality13': 'reshet13',
             'eretz': 'keshet12', 'savri': 'keshet12', 'kcomedy': 'keshet12', 'kdrama': 'keshet12', 'kmusic': 'keshet12',
             'kfood': 'keshet12'}


def own_guide(rows, now=None, days=3, hours=6):
    """guide blocks for the build's channels that no guide lists. rows: [(guide id, [names])] -> XMLTV parts: the
    channel, then one entry per `hours` for `days` days that says "<channel> - live broadcast" (Hebrew + English)"""
    import time
    from xml.sax.saxutils import escape
    now = int(now if now is not None else time.time())
    start = now - now % (hours * 3600)
    parts = []
    for gid, names in rows:
        en = names[0]
        he = next((n for n in names[1:] if re.search(u'[א-ת]', n)), en)
        parts.append('<channel id="%s"><display-name lang="he">%s</display-name><display-name lang="en">%s</display-name></channel>'
                     % (escape(gid, {'"': '&quot;'}), escape(he), escape(en)))
        for i in range(days * 24 // hours):
            a, b = start + i * hours * 3600, start + (i + 1) * hours * 3600
            parts.append('<programme start="%s +0000" stop="%s +0000" channel="%s"><title lang="he">%s</title>'
                         '<desc lang="he">%s</desc></programme>'
                         % (time.strftime('%Y%m%d%H%M%S', time.gmtime(a)), time.strftime('%Y%m%d%H%M%S', time.gmtime(b)),
                            escape(gid, {'"': '&quot;'}), escape(u'%s - שידור חי' % he),
                            escape(u'%s - live broadcast' % en)))
    return parts


def own_rows(m3u_lines):
    """the playlist lines -> [(guide id, names)] of the channels that carry the build's own guide id (bn.<key>)"""
    rows, seen = [], set()
    for line in m3u_lines:
        m = re.search(r'tvg-id="bn\.([^"]+)"', line) if line.startswith('#EXTINF') else None
        if m and m.group(1) in CHANNELS and m.group(1) not in seen:
            seen.add(m.group(1))
            rows.append(('bn.' + m.group(1), CHANNELS[m.group(1)][0]))
    return rows


def logo_for(key, folder=None):
    """the logo the build ships for one of its channels (resources/media/logos/<key>.png) as a path Kodi's TV
    add-on reads, or '' - logos on the web come and go, a file in the add-on does not"""
    import os
    if folder is None:
        folder = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'media', 'logos')
    for k in (key, SAME_LOGO.get(key)):
        if k and os.path.isfile(os.path.join(folder, k + '.png')):
            return 'special://home/addons/plugin.video.nova/resources/media/logos/%s.png' % k
    return ''


# 1.4.4 (owner: "Sport 4 shows loading, then nothing"): restreams also come from bare IPs with a port and
# Xtream-style token paths (/iptv/<token>, /live/<user>/<pass>/) - tokens expire, the stream never starts
_IP_HOST = re.compile(r'^https?://\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?/', re.I)
_TOKEN_PATH = re.compile(r'/(?:iptv|live|play)/[A-Za-z0-9]{16,}(?:/|$)|/live/[^/]+/[^/]+/\d+', re.I)
# paid Israeli cable / satellite channels: no licensed free source exists, whatever server carries them
PAID_IL = re.compile(r'^(?:5\s?(?:sport|plus|live|gold|stars)|sport\s?[1-5]\b|hot\s|hot\d|yes\s|one\s?2?\b|'
                     r'disney|junior|luli|hop!?|nick\s?jr|teennick|jimjam|baby\s?first|viva\s|health channel|'
                     r'sport edge|eurosport)', re.I)


def is_restream(url):
    u = (url or '').split('|')[0]
    return any(h in u for h in RESTREAM_HOSTS) or bool(_IP_HOST.match(u)) or bool(_TOKEN_PATH.search(u))


def is_paid_il(name):
    return bool(PAID_IL.match((name or '').strip()))


def key_for(name):
    """playlist channel name -> CHANNELS key (same normalisation as the guide matching) or None"""
    from .epg import norm
    n = norm(name)
    for key, (names, _, _) in CHANNELS.items():
        if n in (norm(x) for x in names):
            return key
    return None


def candidates(key):
    names, direct, idan = CHANNELS[key]
    via_idan = [IDAN % (u, mode, module) for u, module, mode in idan]
    return via_idan + list(direct) if key in DIRECT_LAST else list(direct) + via_idan


# ------------------------------------------------------------ Kodi
def _alive(url, timeout=3):
    """a direct HLS stream answers with a playlist within the timeout"""
    import requests
    try:
        r = requests.get(url, timeout=timeout, headers={'User-Agent': 'Mozilla/5.0'})
        return r.status_code == 200 and '#EXTM3U' in r.text[:200]
    except Exception:
        return False


def _alive_url(url, timeout=4):
    """a playlist URL with Kodi's '|Header=value' suffix: its headers are used for the check"""
    import requests
    from urllib.parse import unquote
    base, _, h = url.partition('|')
    headers = {k: unquote(v) for k, v in (kv.split('=', 1) for kv in h.split('&') if '=' in kv)}
    headers.setdefault('User-Agent', 'Mozilla/5.0')
    try:
        r = requests.get(base, timeout=timeout, headers=headers, stream=True)
        ok = r.status_code == 200
        if ok and ('.m3u8' in base.lower() or 'mpegurl' in r.headers.get('Content-Type', '').lower()):
            ok = '#EXTM3U' in r.raw.read(512, decode_content=True).decode('utf-8', 'ignore')
        r.close()
        return ok
    except Exception:
        return False


def live(handle, key, alt=''):
    """resolve a channel to the first source that works (licensed table, or the ranked alternates of a playlist
    channel that several sources carry)"""
    import xbmc
    import xbmcgui
    import xbmcplugin
    from .common import log, load
    if alt:
        cands = load('alternates.json', {}).get(alt, [])
        label = alt
    elif key in CHANNELS:
        names, direct, idan = CHANNELS[key]
        listed = [u for u in load('live_extra.json', {}).get(key, []) if u not in direct and not u.startswith('plugin://')]
        via_idan = [IDAN % (u, mode, module) for u, module, mode in idan]
        cands = (via_idan + list(direct) + listed) if key in DIRECT_LAST else (list(direct) + listed + via_idan)
        label = names[0]
    else:
        return xbmcplugin.setResolvedUrl(handle, False, xbmcgui.ListItem())
    n_all = len(cands)
    for pos, url in enumerate(cands):
        if url.startswith('yt:'):          # 4.0.6: the permanent live broadcast of the broadcaster's own YouTube channel
            from . import ytlive
            url = ytlive.play_url(ytlive.find(url[3:]) or '')
            if not url:
                continue                   # not on the air right now: the next source
            log('live %s -> YouTube live (%d of %d)' % (key, pos + 1, n_all))
            return xbmcplugin.setResolvedUrl(handle, True, xbmcgui.ListItem(path=url))
        if url.startswith('plugin://') or _alive_url(url):
            li = xbmcgui.ListItem(path=url)
            if not url.startswith('plugin://') and '.m3u8' in url.split('|')[0].lower() and \
                    xbmc.getCondVisibility('System.AddonIsEnabled(inputstream.adaptive)'):
                li.setProperty('inputstream', 'inputstream.adaptive')
                li.setMimeType('application/vnd.apple.mpegurl')
                li.setContentLookup(False)
            log('live %s -> %s (%d of %d)' % (alt or key, url.split('|')[0][:80], cands.index(url) + 1, len(cands)))
            return xbmcplugin.setResolvedUrl(handle, True, li)
    # every source failed: say so clearly (before: a spinner, then nothing)
    from .common import ui_lang
    msg = ('%s אינו זמין כרגע מאף מקור - נסו שוב בעוד כמה דקות' if ui_lang() == 'he'
           else '%s is not available from any source right now - try again in a few minutes') % label
    xbmcgui.Dialog().notification('BN Stream', msg, xbmcgui.NOTIFICATION_WARNING, 6000)
    return xbmcplugin.setResolvedUrl(handle, False, xbmcgui.ListItem())
