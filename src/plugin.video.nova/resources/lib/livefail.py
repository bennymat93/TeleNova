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

# key: (names the playlists / guides use, [direct streams], [(Idan+ url, module, mode)])
CHANNELS = {
    'kan11': (['Kan 11', 'כאן 11'], [KAN % 'kan11'], [('ch_11', 'kan', 10), ('ch_11b', 'tv', 10)]),
    'keshet12': (['Keshet 12', 'קשת 12', 'Channel 12'], [],
                 [('ch_12', 'keshet', 10), ('ch_12b', 'keshet', 10), ('ch_12b2', 'keshet', 10)]),
    'reshet13': (['Channel 13 (Israel)', 'Reshet 13', 'רשת 13', 'Channel 13'], [],
                 [('ch_13', 'reshet', 4), ('ch_13b', 'reshet', 4), ('ch_13b2', 'reshet', 4)]),
    'now14': (['Now 14', 'עכשיו 14', 'Channel 14'], ['https://r.il.cdn-redge.media/livehls/oil/ch14/live/ch14/live.livx/playlist.m3u8'],
              [('ch_14', '14tv', 10), ('ch_14b', 'tv', 10), ('ch_14b2', 'tv', 10)]),
    'kanedu': (['Kan Educational', 'כאן חינוכית'], [], [('ch_23', 'kan', 10), ('ch_23b', 'tv', 10)]),
    'ch24': (['Channel 24 (Israel)', 'Channel 24', 'ערוץ 24'], [], [('ch_24', 'keshet', 10), ('ch_24b', 'keshet', 10)]),
    'makan33': (['Makan 33', 'מכאן 33'], [KAN % 'makan'], [('ch_33', 'kan', 10), ('ch_33b', 'tv', 10)]),
    'knesset': (['Knesset Channel', 'ערוץ הכנסת', 'כנסת 99'], [], [('ch_99', 'tv', 10)]),
    'ch9': (['Channel 9 (Israel)', 'Channel 9', 'ערוץ 9'], ['https://contact.gostreaming.tv/Con-11/index.m3u8'], [('ch_9', 'tv', 10)]),
    'hidabroot': (['Hidabroot', 'הידברות'], ['https://cdn.cybercdn.live/HidabrootIL/Live97/playlist.m3u8'], [('ch_97', 'hidabroot', 10)]),
    'i24he': (['i24NEWS Hebrew', 'i24 עברית'], ['https://i24newshebrew-cdn.encoders.immergo.tv/master.m3u8'], [('ch_i24news', 'tv', 10)]),
    'i24en': (['i24NEWS English'], ['https://i24newsenglish-cdn.encoders.immergo.tv/master.m3u8'], [('ch_i24newsen', 'tv', 10)]),
    'i24fr': (['i24NEWS French'], ['https://i24newsfrench-cdn.encoders.immergo.tv/master.m3u8'], [('ch_i24newsfr', 'tv', 10)]),
    'i24ar': (['i24NEWS Arabic'], ['https://i24newsarabic-cdn.encoders.immergo.tv/master.m3u8'], [('ch_i24newsar', 'tv', 10)]),
    # 4.0.2: the rest of what Idan+ carries - the broadcasters' own free web channels. Every one of them is always in
    # the channel list (iptv._merge adds the keys that no playlist brought), the ones a playlist also carries get
    # Idan+ as their fallback. Paid cable / satellite channels have no licensed free source and stay out.
    'kalkala10': (['Kalkala 10', 'כלכלה 10'], [], [('ch_10', 'tv', 10)]),
    'ch16': (['Channel 16', 'ערוץ 16'], [], [('ch_16tv', 'tv', 10)]),
    'kab66': (['Kabbalah for the People Israel', 'קבלה 66', 'קבלה לעם'], [], [('ch_66', 'tv', 10)]),
    'kabru': (['Kabbalah (Russian)', 'קבלה - רוסית'], [], [('ch_kabru', 'tv', 10)]),
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
    'kan11c': (['Kan 11 - subtitled', 'כאן 11 - לקויי שמיעה'], [], [('ch_11c', 'kan', 10)]),
    'keshet12c': (['Keshet 12 - subtitled', 'קשת 12 - לקויי שמיעה'], [], [('ch_12c', 'keshet', 10)]),
    'reshet13c': (['Reshet 13 - subtitled', 'רשת 13 - לקויי שמיעה'], [], [('ch_13c', 'reshet', 4)]),
    'knesset99c': (['Knesset Channel - subtitled', 'ערוץ הכנסת - לקויי שמיעה'], [], [('ch_99c', 'tv', 10)]),
    'radius100': (['100FM Radius (video)', '100FM רדיוס'], [], [('ch_100', 'tv', 10)]),
    'pervoe891': (['Первое Радио 89.1FM'], [], [('ch_891', 'tv', 10)]),
}


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
    return list(direct) + [IDAN % (u, mode, module) for u, module, mode in idan]


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
        cands, label = list(direct) + listed + [IDAN % (u, mode, module) for u, module, mode in idan], names[0]
    else:
        return xbmcplugin.setResolvedUrl(handle, False, xbmcgui.ListItem())
    for url in cands:
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
