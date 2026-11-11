# -*- coding: utf-8 -*-
"""Unified IPTV: merge any number of M3U + EPG sources into one numbered
channel list and feed it to PVR IPTV Simple Client."""
import gzip
import json
import os
import re
import time

import xbmc
import xbmcgui

from .common import monitor
import xbmcvfs

from .common import T, load, save, PROFILE, log, MEDIA

MERGED_M3U = os.path.join(PROFILE, 'nova_channels.m3u')
MERGED_EPG = os.path.join(PROFILE, 'nova_epg.xml.gz')
PVR = 'pvr.iptvsimple'

# Israeli channels keep their familiar numbers (like Yes/HOT/Partner)
FIXED = [(r'\bkan\s*11\b|כאן\s*11', 11), (r'\bkeshet\s*12\b|\bchannel\s*12\b|קשת\s*12|ערוץ\s*12', 12),
         (r'\breshet\s*13\b|\bchannel\s*13\b|רשת\s*13|ערוץ\s*13', 13), (r'\bchannel\s*14\b|ערוץ\s*14', 14),
         (r'\bi24', 15), (r'\bkan\s*educ|חינוכית', 23), (r'\bmakan\b|מכאן', 33), (r'\bknesset|כנסת', 99),
         (r'\bchannel\s*9\b|\b9\s*канал|ערוץ\s*9', 9)]
# group -> first number of its block
MINE = 'My list'      # the viewer's own playlists (group name in the TV service)
BLOCKS = [('Israel', 1), ('News', 100), ('Movies', 200), ('Series', 300), ('Kids', 400), ('Sport', 500),
          ('Documentary', 600), ('Music', 700), ('Russian', 800), ('Other', 1000)]
KEYWORDS = [
    ('Kids', r'kid|cartoon|junior|disney|nick|мульт|детск|ילד|הופ|לוגי'),
    ('Sport', r'sport|спорт|ספורט|eurosport|espn|football|футбол|матч'),
    ('News', r'news|новост|חדשות|cnn|bbc world|euronews|sky news|россия 24|i24'),
    ('Movies', r'movie|cinema|film|кино|фильм|סרט|hbo|cinemax'),
    ('Series', r'series|сериал|סדרות|drama'),
    ('Documentary', r'docu|discovery|nat.?geo|history|animal|природ|תעוד|viasat'),
    ('Music', r'music|музык|מוזיק|mtv|vh1'),
]
GROUP_KEYS = {'grp_' + b.lower() for b, _ in BLOCKS}
HEB = re.compile('[֐-׿]')
CYR = re.compile('[Ѐ-ӿ]')


# free, publicly available channels (iptv-org community index) - each can be switched off
FREE = [
    ('iptv-org IL', 'https://iptv-org.github.io/iptv/countries/il.m3u'),
    ('iptv-org Hebrew', 'https://iptv-org.github.io/iptv/languages/heb.m3u'),
    ('iptv-org Russian', 'https://iptv-org.github.io/iptv/languages/rus.m3u'),
    ('iptv-org Movies', 'https://iptv-org.github.io/iptv/categories/movies.m3u'),
    ('iptv-org Kids', 'https://iptv-org.github.io/iptv/categories/kids.m3u'),
    ('iptv-org Documentary', 'https://iptv-org.github.io/iptv/categories/documentary.m3u'),
    ('iptv-org News', 'https://iptv-org.github.io/iptv/categories/news.m3u'),
    ('iptv-org Music', 'https://iptv-org.github.io/iptv/categories/music.m3u'),
    ('iptv-org English', 'https://iptv-org.github.io/iptv/languages/eng.m3u'),
]
# large lists start switched off (user can enable them in IPTV sources)
FREE_OFF = {'iptv-org English', 'iptv-org News', 'iptv-org Music'}
DEAD_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'dead_streams.json')


HEALTH_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'stream_health.json')


def stream_health():
    """{stream url: score 0..1} measured by tools/stream_check.py (start time, stalls, stability) - shipped with the
    add-on; unknown streams count 0.5"""
    try:
        with open(HEALTH_FILE, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def dead_streams():
    try:
        with open(DEAD_FILE, encoding='utf-8') as f:
            return set(json.load(f))
    except Exception:
        return set()


# ------------------------------------------------------------------ dead channels, measured on this box (1.6.2)
# The shipped dead_streams.json holds only streams gone for good (404/410). Everything else - timeouts, 403 from a
# server that refuses this network, 5xx - is checked here, from the viewer's own connection: a source that failed
# twice in a row is left out of the list, and comes back as soon as it answers again.
FAIL_FILE = 'stream_fail.json'
FAIL_AFTER = 2


def _base(u):
    return u.split('|')[0]


def probe(u, timeout=8):
    """True when the stream answers with data (the playlist or the first bytes)"""
    import requests
    from urllib.parse import unquote
    url, _, hdr = u.partition('|')
    headers = {'User-Agent': BROWSER_UA}
    for kv in hdr.split('&'):
        if '=' in kv:
            k, v = kv.split('=', 1)
            headers[k] = unquote(v)
    try:
        with requests.get(url, headers=headers, timeout=timeout, stream=True) as r:
            return r.status_code < 400 and bool(next(r.iter_content(512), b''))
    except Exception:
        return False


def drop_failed(channels, free_names, fails):
    """free-list sources that failed FAIL_AFTER checks in a row are left out; the viewer's own playlists never"""
    return [c for c in channels if c.get('src') not in free_names or fails.get(_base(c.get('url', '')), 0) < FAIL_AFTER]


def stream_urls():
    """every source the merged list can play: the direct streams and each channel's alternates"""
    urls = []
    try:
        with open(MERGED_M3U, encoding='utf-8') as f:
            urls = [l.strip() for l in f if l.startswith('http')]
    except Exception:
        pass
    for lst in load('alternates.json', {}).values():
        urls += [u for u in lst if u.startswith('http')]
    return list(dict.fromkeys(urls))


def check_streams(aborted=None, workers=6, probe_fn=None):
    """probe every source; returns how many sources newly reached FAIL_AFTER or came back (the list then needs a
    refresh).
    A round where most sources fail is the box's own connection, not dead channels: it is not counted."""
    import concurrent.futures
    probe_fn = probe_fn or probe
    urls = stream_urls()
    # 3.3: a hidden source is not in the written list any more, so it was never probed again and never came back.
    # The hidden ones are probed too (at most 150 a round, the ones with the fewest failures first - each failure
    # counts, so the rest get their turn); one that answers loses its counter and returns with the next refresh
    known = {_base(u) for u in urls}
    old = load(FAIL_FILE, {})
    hidden = sorted((u for u, n in old.items() if isinstance(n, int) and n >= FAIL_AFTER and u not in known
                     and u.startswith('http')), key=lambda u: old[u])[:150]
    if not urls and not hidden:
        return 0
    with concurrent.futures.ThreadPoolExecutor(workers) as ex:
        res, back = {}, {}
        todo = urls + hidden
        for i, (u, ok) in enumerate(zip(todo, ex.map(lambda u: None if aborted and aborted() else probe_fn(u), todo))):
            if ok is None:
                return 0                       # Kodi is quitting: nothing is recorded
            (res if i < len(urls) else back)[_base(u)] = ok
    bad = sum(1 for ok in res.values() if not ok)
    if res and bad > len(res) / 2:
        log('stream check: %d of %d failed - the connection, not the channels: not counted' % (bad, len(res)))
        return 0
    fails = load(FAIL_FILE, {})
    newly = revived = 0
    for u, ok in res.items():
        if ok:
            fails.pop(u, None)
        else:
            fails[u] = fails.get(u, 0) + 1
            newly += fails[u] == FAIL_AFTER
    for u, ok in back.items():
        if ok:
            revived += fails.pop(u, None) is not None
        elif u in fails:
            fails[u] += 1
    save(FAIL_FILE, fails)
    log('stream check: %d sources, %d failed now, %d newly hidden, %d of %d hidden ones answer again'
        % (len(res), bad, newly, revived, len(back)))
    return newly + revived                     # either way the list needs a refresh


def sources():
    src = load('iptv.json', {'m3u': [], 'epg': []})
    src.setdefault('m3u', [])        # a hand-edited / partial file must not break the TV section
    src.setdefault('epg', [])
    src.setdefault('free', {})
    for name, _ in FREE:
        src['free'].setdefault(name, name not in FREE_OFF)
    return src


def all_m3u(src):
    return list(src['m3u']) + [{'name': n, 'url': u} for n, u in FREE if src['free'].get(n, True)]


def country(attrs):
    c = attrs.get('tvg-country', '').upper()
    if not c:
        m = re.search(r'\.([a-z]{2})(?:@|$)', attrs.get('tvg-id', ''))
        c = m.group(1).upper() if m else ''
    return c


def classify(name, group, attrs, src=''):
    text = '%s %s' % (name, group)
    low = text.lower()
    cc = country(attrs)
    if HEB.search(text) or re.search(r'\b(il|israel|ישראל)\b', low) or cc == 'IL' or src in ('iptv-org IL', 'iptv-org Hebrew'):
        return 'Israel'
    if CYR.search(text) or cc in ('RU', 'UA', 'BY', 'KZ') or src == 'iptv-org Russian':
        return 'Russian'
    for g, rx in KEYWORDS:
        if re.search(rx, low):
            return g
    return 'Other'


ATTR = re.compile(r'([\w-]+)="([^"]*)"')


def parse_m3u(text, source_name):
    out, cur = [], None
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith('#EXTINF'):
            # attributes may contain commas (user-agent) -> name is after the comma following the last quoted value
            m = re.match(r'(#EXTINF[^"]*(?:"[^"]*"[^"]*?)*?),([^"]*)$', line)
            head, name = (m.group(1), m.group(2)) if m else line.partition(',')[::2]
            cur = {'attrs': dict(ATTR.findall(head)), 'name': name.strip(), 'opts': []}
        elif line.startswith('#EXTVLCOPT') or line.startswith('#KODIPROP'):
            if cur is not None:
                cur['opts'].append(line)
        elif line and not line.startswith('#') and cur:
            cur['url'] = line
            cur['src'] = source_name
            out.append(cur)
            cur = None
    return out


BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'


def with_headers(c):
    """Many free streams reject Kodi's default user-agent (HTTP 403). Kodi accepts
    'url|Header=value&...' - add the playlist's own headers, else a browser UA."""
    u = c['url']
    if '|' in u or not u.startswith('http'):
        return u
    from urllib.parse import quote
    h = {}
    for o in c.get('opts', []):
        k, _, v = o.split(':', 1)[-1].partition('=')
        h[k.strip().lower()] = v.strip()
    a = c.get('attrs', {})
    ua = h.get('http-user-agent') or a.get('http-user-agent') or BROWSER_UA
    ref = h.get('http-referrer') or a.get('http-referrer')
    hdr = 'User-Agent=' + quote(ua)
    if ref:
        hdr += '&Referer=' + quote(ref)
    return u + '|' + hdr


def display_name(name):
    """'Kan 11 (1080p)' -> 'Kan 11', 'Hala TV (1080p) [Not 24/7]' -> 'Hala TV' (shown in the guide, the bar, lists)"""
    n = re.sub(r'\s*\((?:\d{3,4}[pi]|SD|HD|FHD|UHD|4K)\)|\s*\[[^\]]*\]', '', name or '').strip()
    return n or name


def norm(name):
    n = re.sub(r'\b(hd|fhd|uhd|4k|sd|hevc|h265|\+1)\b', '', name.lower())
    return re.sub(r'[\W_]+', '', n)


def _fetch(u):
    import requests
    if u.startswith(('http://', 'https://')):
        r = requests.get(u, timeout=60, headers={'User-Agent': 'Kodi'})
        r.raise_for_status()
        return r.content
    with xbmcvfs.File(u, 'rb') as f:
        return bytes(f.readBytes())


def _replace(tmp, dst):
    """3.3: os.replace, tried again for a moment when Windows refuses (the TV service has the file open)"""
    for attempt in range(5):
        try:
            return os.replace(tmp, dst)
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.04)


def _write_atomic(path, text):
    """3.3: the TV service reads these files on its own schedule - written under another name in the same folder
    and swapped in, so it never reads half a list"""
    import threading
    tmp = '%s.%d.tmp' % (path, threading.get_ident())
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(text)
        _replace(tmp, path)
    except PermissionError:
        # the reader keeps the file open and Windows refuses the swap: written in place, as before 3.3
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def merge(notify=True):
    home = xbmcgui.Window(10000)
    if home.getProperty('NovaTV.iptv_busy') == '1':
        # another refresh is running (e.g. the automatic one at start): wait for it, then apply the
        # newest sources - dropping the request would leave the viewer with the old channel list
        if notify:
            xbmcgui.Dialog().notification('TeleNova', '...', xbmcgui.NOTIFICATION_INFO, 2000)
        mon = monitor()
        for _ in range(600):
            if home.getProperty('NovaTV.iptv_busy') != '1' or mon.waitForAbort(0.5):
                break
    home.setProperty('NovaTV.iptv_busy', '1')
    try:
        return _merge(notify)
    finally:
        home.clearProperty('NovaTV.iptv_busy')


def _merge(notify):
    src = sources()
    channels, errors = [], []
    for s in all_m3u(src):
        try:
            data = _fetch(s['url']).decode('utf-8', 'ignore')
            channels.extend(parse_m3u(data, s['name']))
        except Exception as e:
            errors.append('%s: %s' % (s['name'], e))
    dead = dead_streams()
    if dead:
        channels = [c for c in channels if c.get('url') not in dead]
    from . import livefail          # unlicensed restream servers out; main Israeli channels with failover
    # only the free public lists are filtered: a viewer's own playlist (a home tuner on 192.168.x.x, a paid
    # subscription) is theirs and stays as it is
    free_names = {n for n, _ in FREE}

    def pirate(c):
        if c.get('src') not in free_names:
            return False
        return livefail.is_restream(c.get('url')) or (
            livefail.is_paid_il(c['name']) and
            classify(c['name'], c['attrs'].get('group-title', ''), c['attrs'], c.get('src', '')) == 'Israel')
    channels = [c for c in channels if not pirate(c)]
    channels = drop_failed(channels, free_names, load(FAIL_FILE, {}))
    # 1.4.6: the viewer's own playlists are kept exactly as they are - every channel, in the list's order, with its
    # own stream, headers and guide ids. Before, they were de-duplicated against the free lists (channels lost or
    # given another list's stream), the Israeli ones were replaced by the licensed failover, and their tvg-ids by
    # the free guide's (their own EPG no longer matched)
    mine, seen_urls = [], set()
    for c in channels:
        if c.get('src') not in free_names and c.get('url') not in seen_urls:
            seen_urls.add(c.get('url'))
            c['group'] = MINE
            mine.append(c)
    # a provider that does not (yet) recognise the subscription answers with its demo channels only (af-play:
    # 11 Russian "Демонстрация" channels) - those are not the viewer's list: never shown, and the viewer is told (1.4.10)
    demo = [c for c in mine if re.search(r'демонстрац|^demo', c['attrs'].get('group-title', ''), re.I)]
    if demo and len(demo) == len(mine):
        mine = []
        try:
            import xbmc
            xbmc.log('[NovaTV] own playlist returned only %d provider demo channels - subscription not active '
                     'for this device' % len(demo), xbmc.LOGWARNING)
            xbmc.executebuiltin('Notification(BN Stream,%s,12000)' % (
                'הספק החזיר רק ערוצי הדגמה - בדוק את המנוי / המכשיר אצל הספק' if 'he' in xbmc.getLanguage(xbmc.ISO_639_1)
                else 'Your provider returned demo channels only - check the subscription'))
        except Exception:
            pass
    channels = [c for c in channels if c.get('src') in free_names]
    # de-duplicate by normalised name: keep HD/first, remember alternates
    best, alts = {}, {}
    health = stream_health()
    for c in channels:
        k = norm(c['name'])
        quality = 2 if re.search(r'4k|uhd|fhd', c['name'], re.I) else 1 if re.search(r'\bhd\b', c['name'], re.I) else 0
        c['q'] = quality
        c['group'] = classify(c['name'], c['attrs'].get('group-title', ''), c['attrs'], c.get('src', ''))
        alts.setdefault(k, []).append(c)
        if k not in best or quality > best[k]['q']:
            best[k] = c
    # 1.4.4: every source of a channel is kept, best first (measured health from tools/stream_check.py, then
    # quality), the others are automatic fallbacks: the channel plays through ?a=live&alt=<key> (livefail.live)
    alt_urls = {}
    for k, lst in alts.items():
        urls = []
        for c in sorted(lst, key=lambda c: (-health.get(c['url'].split('|')[0], 0.5), -c['q'])):
            u = with_headers(c)
            if u not in urls:
                urls.append(u)
        if len(urls) > 1:
            alt_urls[k] = urls
            best[k]['url'], best[k]['opts'] = 'plugin://plugin.video.nova/?a=live&alt=' + k, []
    save('alternates.json', alt_urls)
    have = set()
    for c in best.values():
        # an Israeli channel unless the list marks it as another country's (the Russian 'Channel12.ru' is not Keshet 12)
        cc = ALIAS.get(country(c['attrs']), country(c['attrs'])) or ''
        key = livefail.key_for(c['name']) if (c['group'] == 'Israel' or cc in ('', 'IL')) and c['group'] != 'Russian' else None
        if key and key not in have:
            c['url'], c['opts'] = 'plugin://plugin.video.nova/?a=live&ch=' + key, []
            have.add(key)
    for key, (names, _, _) in livefail.CHANNELS.items():
        if key not in have:            # only a restream carried it: the licensed sources bring it back
            best['live:' + key] = {'attrs': {}, 'name': names[0], 'opts': [], 'src': 'BN', 'q': 3, 'group': 'Israel',
                                   'url': 'plugin://plugin.video.nova/?a=live&ch=' + key}
    used, lines = set(), ['#EXTM3U']
    ordered = sorted(best.values(), key=lambda c: ([b for b, _ in BLOCKS].index(c['group']), c['name'].lower()))
    if not os.path.exists(FREE_GUIDE):
        # first start: build the guide NOW, before the TV service starts for the first time. Kodi scans the guide
        # once at that start; scanned while empty, it did not ask again (tested 06/10: 0 programmes for hours)
        # Israel only here (one small file, seconds even on a slow box); the other countries follow from the
        # service's guide job - all of them took 4 minutes on the emulator and held the channel list back
        rebuild_guide([x for x in _guide_playlist(ordered) if x[1] == 'IL'], apply=False, budget=30)
        try:
            os.utime(FREE_GUIDE, (OLD, OLD))   # counts as old: the service job adds the other countries soon
        except OSError:
            pass
    guide = free_guide(ordered, errors)            # the free TV guide: matched guide ids become the tvg-ids
    nxt = {g: n for g, n in BLOCKS}
    fixed_nums = {n for _, n in FIXED}
    shift = 0
    if mine:
        n = 0
        for c in mine:
            want = c['attrs'].get('tvg-chno', '')
            num = int(want) if want.isdigit() and int(want) not in used else None
            if num is None:
                n += 1
                while n in used:
                    n += 1
                num = n
            used.add(num)
            attrs = ' '.join('%s="%s"' % (k, v) for k, v in c['attrs'].items() if k not in ('tvg-chno', 'group-title'))
            lines.append('#EXTINF:-1 %s tvg-chno="%d" group-title="%s",%s' % (attrs, num, MINE, c['name']))
            lines.extend(c['opts'])
            lines.append(c['url'])                 # exactly as the list gives it (its own headers / tokens)
        shift = 2000 if max(used) < 2000 else ((max(used) // 1000) + 1) * 1000   # free channels after them
        fixed_nums = set()
        nxt = {g: n + shift for g, n in BLOCKS}
    for c in ordered:
        num = None
        for rx, n in (FIXED if not mine else []):
            if re.search(rx, c['name'], re.I) and n not in used:
                num = n
                break
        if num is None:
            g = c['group']
            starts = [n for _, n in BLOCKS]
            end = next((n for n in starts if n > dict(BLOCKS)[g]), 5000) + shift
            num = nxt[g]
            while num in used or num in fixed_nums:
                num += 1
            if num >= end:          # block full -> overflow range, keeps other blocks' numbers stable
                g = '_overflow'
                num = nxt.setdefault(g, 5000 + shift)
                while num in used:
                    num += 1
            nxt[g] = num + 1
        used.add(num)
        a = dict(c['attrs'])
        gid = guide[1].get(display_name(c['name'])) or guide[1].get(c['name'])   # the guide is keyed by shown names
        if gid:
            a['tvg-id'] = gid
        attrs = ' '.join('%s="%s"' % (k, v) for k, v in a.items() if k not in ('tvg-chno', 'group-title'))
        lines.append('#EXTINF:-1 %s tvg-chno="%d" group-title="%s",%s' % (attrs, num, c['group'], display_name(c['name'])))
        opts = list(c['opts'])
        base = c['url'].split('|')[0].lower()
        if '.m3u8' in base and not c['url'].startswith('plugin://') and not any('inputstream' in o for o in opts):
            # free HLS channels through inputstream.adaptive (quality follows the link); set per channel, not
            # for the whole TV service: subscription (Xtream) streams do not play through it
            opts.append('#KODIPROP:inputstream=inputstream.adaptive')
            opts.append('#KODIPROP:inputstream.adaptive.manifest_type=hls')
        lines.extend(opts)
        lines.append(with_headers(c))
    _write_atomic(MERGED_M3U, '\n'.join(lines) + '\n')
    merge_epg(src['epg'], errors, extra=guide[0])
    if not configure_pvr(force=notify):
        errors.append('PVR IPTV Simple Client could not be installed - check internet, then Accounts > IPTV again')
    save('iptv_status.json', {'when': time.time(), 'channels': len(best), 'errors': errors})
    if notify:
        msg = '%d %s' % (len(best), T('channels'))
        if errors:
            xbmcgui.Dialog().ok('TeleNova', msg + '\n' + '\n'.join(errors))
        else:
            xbmcgui.Dialog().notification('TeleNova', msg, xbmcgui.NOTIFICATION_INFO, 4000)
    return len(best), errors


FREE_GUIDE = os.path.join(PROFILE, 'free_guide.json.gz')     # last built guide: {'ids': {name: id}, 'parts': [...]}


def _guide_playlist(channels, top=6):
    from . import epg
    pl = []
    for c in channels:
        cc = 'IL' if c['group'] == 'Israel' else ALIAS.get(country(c['attrs']), country(c['attrs'])) or ''
        pl.append((c['name'], cc))
    count = {}
    for _, cc in pl:
        count[cc] = count.get(cc, 0) + 1
    keep = {'IL'} | set(sorted((cc for cc in count if cc in epg.FILES and cc != 'IL'), key=lambda cc: -count[cc])[:top])
    return [p for p in pl if p[1] in keep]


def free_guide(channels, errors):
    """the LAST built free guide (instant), and a background rebuild when it is older than 12 h or missing.
    Building it in the merge (13 guide files + translation) held the channel list back for minutes (1.4.0 tests)."""
    from .common import ADDON
    if ADDON.getSetting('free_epg') == 'false':
        return [], {}
    try:
        with gzip.open(FREE_GUIDE, 'rt', encoding='utf-8') as f:
            last = json.load(f)
    except Exception:
        last = {'ids': {}, 'parts': []}
    # building it is the service's job (guide_due / guide_from_playlist): a thread started here died with the
    # short-lived plugin run that merged the list, so the guide was never built (1.4.4 finding)
    return last['parts'], last['ids']


def guide_due():
    try:
        return time.time() - os.path.getmtime(FREE_GUIDE) > 12 * 3600
    except OSError:
        return True


def guide_from_playlist():
    """service: rebuild the free guide from the merged playlist (Israel + the largest countries)"""
    from .common import ADDON
    if ADDON.getSetting('free_epg') == 'false':
        return
    try:
        text = open(MERGED_M3U, encoding='utf-8').read()
    except OSError:
        return
    chans = []
    for c in parse_m3u(text, 'merged'):
        c['group'] = c['attrs'].get('group-title', '')
        chans.append(c)
    if chans:
        rebuild_guide(_guide_playlist(chans))


def forget_epg_scans():
    """Kodi re-reads a channel's guide from the TV service only when its last scan is old; after a scan of an empty
    guide it kept showing nothing (tested 06/10). Clearing the stored scan times makes it read the new guide."""
    import glob
    import sqlite3
    dbs = sorted(glob.glob(os.path.join(xbmcvfs.translatePath('special://database'), 'Epg*.db')))
    if not dbs:
        return
    c = sqlite3.connect(dbs[-1], timeout=10)
    try:
        c.execute('DELETE FROM lastepgscan')
        c.commit()
    finally:
        c.close()


OLD = 315532800      # 1980-01-01: 'old' for the refresh check, still a valid ZIP time (backup skipped 1970 files)


def rebuild_guide(pl, max_new=3000, apply=True, budget=180):
    """download + match + translate (at most max_new new strings per round; the cache keeps the rest for later),
    save it, then rewrite the merged guide and the playlist ids (IPTV Simple reloads the guide on its own cycle)"""
    from . import epg
    from .common import ADDON
    from .mtrans import translate
    errors = []
    cache = load('epg_tr.json', {})
    left = [max_new]
    until = time.time() + budget         # translation never holds the guide back: the rest waits for the next round
    log('free TV guide: building for %d channels' % len(pl))

    mode = ADDON.getSetting('epg_lang') or 'he'

    def tr(lines):
        if left[0] <= 0 or time.time() > until:
            return lines                 # not now: stays in the original language until the next round
        left[0] -= len(lines)
        return translate(lines, 'auto', 'en' if mode == 'en' else 'iw', deadline=until)
    try:
        parts, ids = epg.build(pl, errors, _fetch, mode, tr, cache,
                               aborted=lambda: monitor().abortRequested())
    except epg.Aborted:
        log('free TV guide: stopped, Kodi is quitting')
        return
    except Exception as e:
        log('free TV guide: %s' % e, xbmc.LOGWARNING)
        return
    save('epg_tr.json', dict(list(cache.items())[-30000:]))
    tmp = FREE_GUIDE + '.tmp'
    with gzip.open(tmp, 'wt', encoding='utf-8') as f:
        json.dump({'ids': ids, 'parts': parts}, f, ensure_ascii=False)
    _replace(tmp, FREE_GUIDE)
    log('free TV guide: %d channels matched, %d guide entries%s' % (len(ids), len(parts), ', %s' % errors if errors else ''))
    if not apply:
        return
    # 3.3: the same "busy" mark the merge uses - this reads, edits and writes the merged list, and a refresh of the
    # channel list running at the same moment wrote over it (or the other way round)
    home = xbmcgui.Window(10000)
    mon = monitor()
    for _ in range(600):
        if home.getProperty('NovaTV.iptv_busy') != '1' or mon.waitForAbort(0.5):
            break
    if mon.abortRequested():
        return
    home.setProperty('NovaTV.iptv_busy', '1')
    try:                                  # apply at once: ids into the playlist, parts into the merged guide
        text = open(MERGED_M3U, encoding='utf-8').read()
        out = []
        for line in text.split('\n'):
            if line.startswith('#EXTINF') and 'group-title="%s"' % MINE not in line:   # own lists keep their ids
                name = line.rsplit(',', 1)[1].strip()
                if name in ids:
                    line = re.sub(r' tvg-id="[^"]*"', '', line).replace('#EXTINF:-1 ', '#EXTINF:-1 tvg-id="%s" ' % ids[name], 1)
            out.append(line)
        _write_atomic(MERGED_M3U, '\n'.join(out))
        merge_epg(sources()['epg'], [], extra=parts)
        forget_epg_scans()
        configure_pvr(force=True)        # the TV service reads tvg-ids and the guide when its client starts
    except Exception as e:
        log('free TV guide apply: %s' % e, xbmc.LOGWARNING)
    finally:
        home.clearProperty('NovaTV.iptv_busy')


def merge_epg(urls, errors, extra=()):
    """Stream-merge several XMLTV files into one gzip without loading a DOM (+ the free guide parts first)."""
    tmp = MERGED_EPG + '.tmp'
    seen_channels = set()
    with gzip.open(tmp, 'wt', encoding='utf-8') as out:
        out.write('<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="TeleNova">\n')
        for part in extra:
            out.write(part + '\n')
        for u in urls:
            try:
                raw = _fetch(u)
                if raw[:2] == b'\x1f\x8b':
                    raw = gzip.decompress(raw)
                text = raw.decode('utf-8', 'ignore')
                body = text[text.find('<tv'):]
                body = body[body.find('>') + 1:body.rfind('</tv>')]
                for m in re.finditer(r'<channel\s+id="([^"]+)".*?</channel>|<programme\b.*?</programme>', body, re.S):
                    if m.group(1):
                        if m.group(1) in seen_channels:
                            continue
                        seen_channels.add(m.group(1))
                    out.write(m.group(0) + '\n')
            except Exception as e:
                errors.append('EPG %s: %s' % (u[:40], e))
        out.write('</tv>\n')
    _replace(tmp, MERGED_EPG)


def repo_knows(addon_id):
    """is the add-on in Kodi's repository index (installable)?"""
    r = _jsonrpc('Addons.GetAddons', installed=False, properties=['name'])
    return any(a.get('addonid') == addon_id for a in (r.get('result') or {}).get('addons', []))


def _repo_name(addon_id):
    """the add-on's name as the repository index gives it ('' when unknown) - Kodi's install question shows it"""
    r = _jsonrpc('Addons.GetAddons', installed=False, properties=['name'])
    return next((a.get('name') or '' for a in (r.get('result') or {}).get('addons', []) if a.get('addonid') == addon_id), '')


def _own_prompt(addon_id, name, age):
    """3.3: is the yes/no dialog on top the install question of THIS add-on? Its heading (control 1) and text
    (control 9) are read: with the add-on's name or id in them - yes; readable and about something else - no (an
    unrelated question was confirmed before); not readable - only in the first 20 s after the install was asked"""
    text = ('%s %s' % (xbmc.getInfoLabel('Control.GetLabel(1)'), xbmc.getInfoLabel('Control.GetLabel(9)'))).strip().lower()
    if text and (addon_id.lower() in text or (name and name.lower() in text)):
        return True
    if text and name:
        return False
    return age < 20


def install_addon(addon_id, timeout=120):
    """Install from the official repo and confirm Kodi's yes/no prompt ourselves."""
    mon = monitor()
    for attempt in range(3):                    # dependency downloads sometimes fail - retry
        if not xbmc.getCondVisibility('System.HasAddon(%s)' % addon_id) and not repo_knows(addon_id):
            # Kodi's download of the repository index timed out ("wrong digest"): it knows no add-on to install
            # until its next refresh (up to a day) - refresh now and wait for the index
            log('install %s: not in the repository index - refreshing repositories' % addon_id, xbmc.LOGWARNING)
            xbmc.executebuiltin('UpdateAddonRepos')
            for _ in range(90):
                if repo_knows(addon_id) or mon.waitForAbort(1):
                    break
        name = _repo_name(addon_id)
        xbmc.executebuiltin('InstallAddon(%s)' % addon_id)
        issued, refused = time.time(), False
        for _ in range(timeout * 2 // 3):
            if xbmc.getCondVisibility('System.HasAddon(%s)' % addon_id):
                return True
            if xbmc.getCondVisibility('Window.IsTopMost(yesnodialog)'):
                if _own_prompt(addon_id, name, time.time() - issued):
                    xbmc.executebuiltin('SendClick(yesnodialog,11)')
                elif not refused:
                    refused = True
                    log('install %s: a yes/no dialog that is not this install is open - left alone' % addon_id,
                        xbmc.LOGWARNING)
            if xbmc.getCondVisibility('Window.IsTopMost(okdialog)'):   # "download failed" box
                xbmc.executebuiltin('Dialog.Close(okdialog)')
                log('install %s: attempt %d failed, retrying' % (addon_id, attempt + 1), xbmc.LOGWARNING)
                break
            if mon.waitForAbort(0.5):
                return False
        mon.waitForAbort(3)
    return xbmc.getCondVisibility('System.HasAddon(%s)' % addon_id)


NL = chr(10)


def configure_pvr(force=False):
    """Write IPTV Simple instance settings first, then install (fresh) or restart (existing).

    IPTV Simple re-reads the merged files by itself every hour (m3uRefreshMode), so a running client is only
    restarted when its settings changed or the viewer asked (force). Disabling/enabling the client on every
    refresh crashed Kodi 21 now and then (PVR client destroyed while channels were being read)."""
    was_installed = xbmc.getCondVisibility('System.HasAddon(%s)' % PVR)
    data_dir = xbmcvfs.translatePath('special://profile/addon_data/%s/' % PVR)
    os.makedirs(data_dir, exist_ok=True)
    sp = os.path.join(data_dir, 'instance-settings-1.xml')
    try:
        with open(sp, encoding='utf-8') as f:
            old = f.read()
    except Exception:
        old = ''

    def body(interval):
        settings = {
            'kodi_addon_instance_name': 'TeleNova', 'kodi_addon_instance_enabled': 'true',
            'm3uPathType': '0', 'm3uPath': MERGED_M3U, 'm3uCache': 'true', 'startNum': '1',
            'numberByOrder': 'false', 'epgPathType': '0', 'epgPath': MERGED_EPG, 'epgCache': 'true',
            'epgTimeShift': '0', 'logoPathType': '1', 'logoFromEpg': '1', 'catchupEnabled': 'true',
            'm3uRefreshMode': '1', 'm3uRefreshIntervalMins': interval,
            # 1.4.6: false - forced on every HLS stream it broke subscription (Xtream) lists; the free HLS channels
            # get it per channel (#KODIPROP in the merged list)
            'useInputstreamAdaptiveforHls': 'false',
        }
        return NL.join(['<settings version="2">'] + ['    <setting id="%s">%s</setting>' % (k, v) for k, v in settings.items()]
                         + ['</settings>'])
    new = body('60')
    same = old == new
    enabled = was_installed and _addon_enabled()
    if not same:
        tmp = sp + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(new)
        os.replace(tmp, sp)                    # one change event, never a half-written file
    # let Kodi number channels in our tvg-chno order (only when not already set: a settings change restarts PVR too)
    cur = _rpc('Settings.GetSettingValue', setting='pvrmanager.usebackendchannelnumbers').get('result', {}).get('value')
    if cur is not True:
        _rpc('Settings.SetSettingValue', setting='pvrmanager.usebackendchannelnumbers', value=True)
    if not was_installed:
        return install_addon(PVR)   # picks up the settings file on first start
    mon = monitor()

    def wait(cond, secs):
        for _ in range(secs):
            if cond():
                return True
            if mon.waitForAbort(1):
                return False
        return cond()
    if enabled:
        if same and not force:
            return True             # nothing changed: the client refreshes the files itself
        # Kodi reads instance settings only when the client is created, so the client must be recreated. Freezes seen
        # when this overlapped a start (#1, #2, #5): never while loading, and enable only after the stop fully ended.
        wait(_pvr_available, 120)
        if mon.waitForAbort(10):
            return False
        before = _channel_count()
        _rpc('Addons.SetAddonEnabled', addonid=PVR, enabled=False)
        # Kodi 21 handles the disable asynchronously (~40 s later) and may recreate the client by itself, reading the new
        # settings. A second action (enable) inside that window = two restarts at once = "Start aborted" + freeze (#5).
        # So: wait until the add-on is really disabled and PVR really down, or until the client came back by itself.
        came_back = [False]

        def settled():
            if _addon_enabled() and _pvr_available() and _channel_count() != before:
                came_back[0] = True
                return True
            return not _addon_enabled() and not _pvr_available()
        wait(settled, 150)
        if came_back[0]:
            return True
        if mon.waitForAbort(10):
            return False
        if _addon_enabled():
            return wait(_pvr_available, 180)
    _rpc('Addons.SetAddonEnabled', addonid=PVR, enabled=True)
    if wait(_pvr_available, 180):   # 5000+ channels take a while on slow boxes
        return True
    log('PVR did not come up within 3 min', xbmc.LOGWARNING)
    return False


def _jsonrpc(method, **params):
    try:
        return json.loads(xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})))
    except Exception:
        return {}


def _addon_enabled():
    return bool(_jsonrpc('Addons.GetAddonDetails', addonid=PVR, properties=['enabled']).get('result', {}).get('addon', {}).get('enabled'))


def _channel_count():
    r = _jsonrpc('PVR.GetChannels', channelgroupid='alltv', properties=['channelnumber'], limits={'start': 0, 'end': 1})
    return ((r.get('result') or {}).get('limits') or {}).get('total', -1)


def _pvr_available():
    if not _jsonrpc('PVR.GetProperties', properties=['available']).get('result', {}).get('available'):
        return False
    return bool(_jsonrpc('PVR.GetChannelGroups', channeltype='tv').get('result', {}).get('channelgroups'))


def _rpc(method, **params):
    return json.loads(xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})))


# ------------------------------------------------------------------ UI
def _action_item(handle, label, target, ic):
    import xbmcplugin
    li = xbmcgui.ListItem(label)
    li.setArt({'icon': ic, 'thumb': ic})
    xbmcplugin.addDirectoryItem(handle, target, li, False)


def menu(handle, url, folder, end):
    folder(T('channels'), url(a='tv_list'), 'DefaultTVShows.png')
    all_id = _rpc('PVR.GetChannelGroupDetails', channelgroupid='alltv').get('result', {}).get('channelgroupdetails', {}).get('channelgroupid')
    for g in _rpc('PVR.GetChannelGroups', channeltype='tv').get('result', {}).get('channelgroups', []):
        if g['channelgroupid'] != all_id:
            folder('   ' + T('grp_' + g['label'].lower()) if ('grp_' + g['label'].lower()) in GROUP_KEYS else '   ' + g['label'],
                   url(a='tv_list', group=g['channelgroupid']), 'DefaultTVShows.png')
    _action_item(handle, T('guide'), url(a='tv_do', do='guide'), 'DefaultPVRGuide.png')
    if xbmc.getCondVisibility('System.HasAddon(plugin.video.idanplus)'):
        folder(T('israeli_tv'), 'plugin://plugin.video.idanplus/', 'DefaultTVShows.png')
    folder(T('iptv_src'), url(a='accounts'), 'DefaultAddonService.png')
    end(cache=False)


def action(do):
    if do == 'channels':
        xbmc.executebuiltin('ActivateWindow(TVChannels)')
    elif do == 'guide':
        xbmc.executebuiltin('ActivateWindow(TVGuide)')
    elif do == 'refresh':
        merge()


def edit_sources():
    src = sources()
    d = xbmcgui.Dialog()
    while True:
        free = ['%s %s' % ('[x]' if src['free'].get(n, True) else '[  ]', n) for n, _ in FREE]
        own = ['M3U: %s' % x['name'] for x in src['m3u']]
        epg = ['EPG: %s' % u[:60] for u in src['epg']]
        rows = ['[+] M3U', '[+] EPG'] + free + own + epg + ['[x] ' + T('ok')]
        i = d.select(T('iptv_src'), rows)
        if i < 0 or i == len(rows) - 1:
            break
        if i == 0:
            u = d.input('M3U URL')
            if u:
                name = d.input('Name', 'IPTV %d' % (len(src['m3u']) + 1))
                src['m3u'].append({'name': name or u, 'url': u.strip()})
        elif i == 1:
            u = d.input('EPG URL (xml / xml.gz)')
            if u:
                src['epg'].append(u.strip())
        elif i < 2 + len(free):
            n = FREE[i - 2][0]
            src['free'][n] = not src['free'].get(n, True)
        elif i < 2 + len(free) + len(own):
            if d.yesno('BN', T('clear') + '?'):
                src['m3u'].pop(i - 2 - len(free))
        elif d.yesno('BN', T('clear') + '?'):
            src['epg'].pop(i - 2 - len(free) - len(own))
    save('iptv.json', src)
    if all_m3u(src):
        merge()


_POSTERS = None


def _poster_key(name):
    """channel name -> key: without resolution / quality / [tags] / (Israel), letters and digits only"""
    name = re.sub(r'\((?:\d{3,4}[pi]|israel)\)|\[[^\]]*\]', ' ', (name or '').lower())
    name = re.sub(r'\b(?:hd|fhd|uhd|sd|hevc|israel|\d{3,4}[pi])\b', ' ', name)
    return re.sub(r'[^0-9a-z\u0590-\u05ff]+', '-', name).strip('-')


def channel_poster(label):
    """the 3D poster made for this channel at build time (tools/make_channel_art.py), '' when none"""
    global _POSTERS
    folder = os.path.join(MEDIA, 'channels')
    if _POSTERS is None:
        try:
            with open(os.path.join(folder, 'index.json'), encoding='utf-8') as f:
                _POSTERS = {_poster_key(k.replace('-', ' ')): v for k, v in json.load(f).items()}
        except (OSError, ValueError):
            _POSTERS = {}
    fn = _POSTERS.get(_poster_key(label))
    return os.path.join(folder, fn) if fn else ''


MAIN = ['kan 11', 'keshet 12', 'channel 13', 'now 14', 'i24news hebrew', 'channel 9', 'channel 24', 'kan educational',
        'makan 33', 'knesset', 'sport 1', 'sport 2', 'sport 3', 'sport 4', 'sport 5', '5sport', 'one', 'hot', 'yes']


def _main_rank(label):
    low = (label or '').lower()
    return next((i for i, k in enumerate(MAIN) if low.startswith(k)), len(MAIN))


ALIAS = {'UK': 'GB'}


def _flags():
    try:
        with open(os.path.join(MEDIA, 'flags', 'countries.json'), encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _by_country():
    """{country code: [(name, logo)]} of the merged list (Israel has its own row)"""
    out = {}
    try:
        text = open(MERGED_M3U, encoding='utf-8', errors='replace').read()
    except OSError:
        return out
    for line in text.splitlines():
        if not line.startswith('#EXTINF'):
            continue
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', line))
        cc = ALIAS.get(country(attrs), country(attrs))
        if attrs.get('group-title') in ('Israel', MINE):
            cc = 'IL'                   # 1.4.6: Israel tile = the Israeli channels + the viewer's own list
        if cc:
            out.setdefault(cc, []).append((line.rsplit(',', 1)[1].strip(), attrs.get('tvg-logo', '')))
    return out


def _refresh_row(handle):
    """3.3: an empty TV list is not a blank screen: one row that says so and rebuilds the channel list"""
    _action_item(handle, '%s - %s' % (T('empty'), T('tv_refresh')), 'plugin://plugin.video.nova/?a=tv_do&do=refresh',
                 'DefaultAddonService.png')


def countries_list(handle, url):
    """Channels of the world: one tile per country (its flag), most channels first"""
    import xbmcplugin
    from .common import ui_lang
    names, col = _flags(), {'he': 0, 'en': 1, 'ru': 2}[ui_lang()]
    wait_groups(3)          # 3.3: was up to 180 s - with the TV add-on missing / disabled the menu looked frozen
    by = _by_country()
    shown = 0
    for cc in sorted(by, key=lambda c: (c != 'IL', -len(by[c]))):      # Israel first
        flag = os.path.join(MEDIA, 'flags', cc.lower() + '.png')
        if cc not in names or not os.path.exists(flag):
            continue
        li = xbmcgui.ListItem(names[cc][col])
        li.setArt({'icon': flag, 'thumb': flag})
        li.getVideoInfoTag().setPlot('%d' % len(by[cc]))
        li.setProperty('count', '%d' % len(by[cc]))          # badge on the tile (Includes_BNWidgets)
        xbmcplugin.addDirectoryItem(handle, url(a='tv_country', cc=cc), li, True)
        shown += 1
    if not shown:
        _refresh_row(handle)
    xbmcplugin.setContent(handle, 'files')
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)


def country_channels(handle, cc):
    """the channels of one country: played through the TV service (EPG, numbers) when it has them"""
    import xbmcplugin
    pvr = {c['label']: c for c in _rpc('PVR.GetChannels', channelgroupid='alltv', properties=['icon', 'channelnumber'])
           .get('result', {}).get('channels', [])}
    shown = 0
    for name, logo in _by_country().get(cc, []):
        c = pvr.get(name)
        if not c:
            continue
        shown += 1
        li = xbmcgui.ListItem(re.sub(r'\s*\((?:\d{3,4}[pi])\)|\s*\[[^\]]*\]', '', name).strip())
        art = c.get('icon') or logo or 'DefaultTVShows.png'
        li.setArt({'icon': art, 'thumb': art, 'poster': art})
        li.setProperty('IsPlayable', 'false')
        xbmcplugin.addDirectoryItem(handle, 'plugin://plugin.video.nova/?a=tv_play&id=%d' % c['channelid'], li, False)
    if not shown:
        _refresh_row(handle)
    xbmcplugin.setContent(handle, 'videos')
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)


def wait_groups(timeout=180):
    """the first start after installing builds the channel list (~2 min): a home row asked for channels then
    waits for the TV service instead of answering an empty row the skin keeps"""
    mon = monitor()
    for _ in range(timeout):
        if group_id('Israel') is not None:
            return True
        if mon.waitForAbort(1):
            return False
    return False


def group_id(name):
    """PVR group id by its name (Israel, News, ...), None when missing"""
    for g in _rpc('PVR.GetChannelGroups', channeltype='tv').get('result', {}).get('channelgroups', []):
        if g['label'].lower() == (name or '').lower():
            return g['channelgroupid']
    return None


def channel_list(handle, group=None, gname=None, widget=False):
    """Yes/HOT-style list: number, logo (3D poster for the Israeli channels), what is on now (with progress) and next.
    widget: the home rows - clean names (no number / resolution), the poster is the picture"""
    import xbmcplugin
    # no waiting here: the home rows carry r=$INFO[Window(Home).Property(BN.PVRReady)] in their path, and the service
    # sets that property once the TV service has its channels -> Kodi reloads the rows by itself
    own_order = False
    waited = False
    if gname == 'first':
        # the first TV row: the viewer's own playlist when there is one (all of it, in its own order), else the
        # Israeli channels
        if widget:
            wait_groups(20)     # 3.3: 20 s, once (was 180 s, twice): the row reloads by itself when the TV is ready
            waited = True
        own_order = group_id(MINE) is not None
        gname = MINE if own_order else 'Israel'
    if gname:
        if widget and not waited:
            wait_groups(20)
        group = group_id(gname)
        if group is None:
            if not widget:
                _refresh_row(handle)
            xbmcplugin.endOfDirectory(handle, cacheToDisc=False)
            return
    props = ['channelnumber', 'icon', 'broadcastnow', 'broadcastnext', 'hidden']
    r = _rpc('PVR.GetChannels', channelgroupid=int(group) if group else 'alltv', properties=props)
    chans = sorted(r.get('result', {}).get('channels', []), key=lambda c: c.get('channelnumber') or 0)
    if widget and not own_order:      # the home row opens with the main channels (an own list keeps its order)
        chans.sort(key=lambda c: _main_rank(c['label']))
    from urllib.parse import urlencode
    shown = 0
    for c in chans:
        if c.get('hidden'):
            continue
        shown += 1
        now, nxt = c.get('broadcastnow') or {}, c.get('broadcastnext') or {}
        if widget:
            label = re.sub(r'\s*\((?:\d{3,4}[pi])\)|\s*\[[^\]]*\]', '', c['label']).strip()
        else:
            label = '[B]%s[/B]  %s' % (c.get('channelnumber'), c['label'])
            if now.get('title'):
                label += '   [COLOR grey]%s[/COLOR]' % now['title']
        li = xbmcgui.ListItem(label)
        poster = channel_poster(c['label'])
        logo = c.get('icon') or 'DefaultTVShows.png'
        li.setArt({'icon': poster or logo, 'thumb': poster or logo, 'poster': poster or logo, 'clearlogo': c.get('icon') or ''})
        plot = ''
        if now.get('title'):
            plot = '[B]%s %s[/B]  (%d%%)\n%s' % (now.get('starttime', '')[11:16], now['title'],
                                                int(now.get('progresspercentage') or 0), now.get('plot') or '')
        if nxt.get('title'):
            plot += '\n\n[COLOR grey]%s %s[/COLOR]' % (nxt.get('starttime', '')[11:16], nxt['title'])
        tag = li.getVideoInfoTag()
        tag.setPlot(plot)
        tag.setTitle(c['label'])
        li.setProperty('IsPlayable', 'false')
        target = 'plugin://plugin.video.nova/?a=tv_play&id=%d' % c['channelid']
        # 3.3: urlencode - a name with & , + in it ("Sport 5+", "Arts & Culture") broke the link
        li.addContextMenuItems([(T('add_fav'), 'RunPlugin(plugin://plugin.video.nova/?%s)' % urlencode(
            {'a': 'fav_add', 'kind': 'channel', 'id': c['channelid'], 'label': c['label'],
             'extra': 'pvr_channel_%d' % c['channelid']}))])
        xbmcplugin.addDirectoryItem(handle, target, li, False)
    if not shown and not widget:
        _refresh_row(handle)
    xbmcplugin.setContent(handle, 'videos')
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)


def play_channel(cid):
    _rpc('Player.Open', item={'channelid': int(cid)})
