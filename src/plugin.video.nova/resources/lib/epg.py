# -*- coding: utf-8 -*-
"""TV guide for the free channels (1.4.0 Phase 3).

Source: epgshare01.online per-country XMLTV files (free, refreshed daily, 3+ days ahead, times with a UTC offset -
Kodi shows them in the device's time zone, Asia/Jerusalem in Israel incl. DST). The free iptv-org playlists carry
tvg-ids that no free guide uses, so channels are matched to guide channels by NAME: normalised (resolution,
HD/FHD, punctuation, the country suffix dropped) plus a table of Israeli Hebrew/English aliases.

The merged guide keeps only channels that are in the playlist; the playlist gets the guide's id as tvg-id.
Titles (and short descriptions) in other languages are translated to Hebrew (or English) once and cached (epg_tr.json) - the
setting epg_lang chooses he / en / original. match_* / norm / aliases are plain Python for unit tests.
"""
import gzip
import re

BASE = 'https://epgshare01.online/epgshare01/epg_ripper_%s.xml.gz'
# playlist country -> guide files (only those that exist on the server; checked 30/09/2026)
FILES = {'IL': ['IL1'], 'GB': ['UK1'], 'US': ['US2'], 'DE': ['DE1'], 'FR': ['FR1'], 'ES': ['ES1'], 'IT': ['IT1'],
         'NL': ['NL1'], 'TR': ['TR1'], 'AE': ['AE1'], 'SA': ['SA1'], 'CA': ['CA2'], 'AU': ['AU1'], 'IN': ['IN1'],
         'PL': ['PL1'], 'PT': ['PT1'], 'GR': ['GR1'], 'BR': ['BR1'], 'MX': ['MX1'], 'AR': ['AR1'], 'KZ': ['KZ1'],
         'RO': ['RO1'], 'SE': ['SE1'], 'NO': ['NO1'], 'DK': ['DK1'], 'FI': ['FI1'], 'CH': ['CH1'], 'AT': ['AT1'],
         'BE': ['BE2'], 'IE': ['IE1'], 'CZ': ['CZ1'], 'HU': ['HU1'], 'BG': ['BG1'], 'HR': ['HR1'], 'RS': ['RS1'],
         'EG': ['EG1'], 'JP': ['JP1'], 'KR': ['KR1'], 'PH': ['PH1'], 'ZA': ['ZA1']}
# Israeli channels: every spelling seen in playlists / guides -> one key
IL_ALIASES = {
    'kan11': ['kan 11', 'כאן 11', 'ערוץ 11 כאן', 'kan', 'kan 11 israel', 'ערוץ 11'],
    'keshet12': ['keshet 12', 'קשת 12', 'ערוץ 12', 'channel 12', 'keshet', 'קשת', 'n12'],
    'reshet13': ['reshet 13', 'רשת 13', 'ערוץ 13', 'channel 13', 'reshet', 'רשת', 'channel 13 israel'],
    'now14': ['channel 14', 'ערוץ 14', 'now 14', 'now14', 'ch 14'],
    'i24he': ['i24news hebrew', 'i24 עברית', 'עברית i24', 'i24news'],
    'i24en': ['i24news english'], 'i24fr': ['i24news french'], 'i24ar': ['i24news arabic'],
    'knesset': ['knesset', 'ערוץ הכנסת', 'knesset channel', 'channel 99'],
    'kanedu': ['kan educational', 'כאן חינוכית', 'kan chinuchit', 'kan 23', 'hinuchit'],
    'makan33': ['makan 33', 'מכאן', 'makan', 'מכאן 33'],
    'channel24': ['channel 24', 'ערוץ 24', 'music 24', 'מוזיקה 24', 'מוסיקה 24', 'ערוץ 24 בשידור חי'],
    'channel9': ['channel 9', 'ערוץ 9', '9 канал', 'канал 9'],
    'disney': ['disney channel', 'דיסני', 'disney'],
    'junior': ['junior', 'ג’וניור', "ג'וניור", 'גוניור'],
    'teennick': ['teennick', 'ערוץ teennick'],
    'yamtichoni': ['yam tichoni', 'ים תיכוני'],
    'vivaistanbul': ['viva istanbul', 'ויוה איסטנבול'],
    'vivapremium': ['viva premium', 'ויוה פרימיום'],
    'vivatelenovelas': ['viva telenovelas', 'ויוה טלנובלות'],
    'vacation': ['vacation channel', 'ערוץ הנופש'],
    'reality': ['reality channel', 'ערוץ הריאליטי'],
    'hidabroot': ['hidabroot', 'ערוץ הידברות', 'הידברות'],
    'one2': ['one 2', 'one2'],
    'goodlife': ['good life', 'good life+'],
    'homeplus': ['home +', 'home+', 'בית +', 'בית+'],
    'zoom': ['zoom', 'zoom toon'],
}


def norm(name):
    """'Keshet 12 (1080p) [Geo-blocked]' -> 'keshet 12'; Hebrew kept; the guide's dots become spaces"""
    n = re.sub(r'\([^)]*\)|\[[^\]]*\]', ' ', name or '')
    n = re.sub(r'\.(il|uk|us|de|fr|es|it|nl|tr|ru|[a-z]{2})$', '', n.strip(), flags=re.I)
    n = n.replace('.', ' ').replace('_', ' ').replace('-', ' ')
    n = re.sub(r'\b(hd|fhd|uhd|4k|sd|live|tv|שידור חי)\b', ' ', n, flags=re.I)
    return ' '.join(re.sub(r'[^\w֐-׿+! ]', ' ', n.lower()).split())


def alias_key(name):
    n = norm(name)
    for key, names in IL_ALIASES.items():
        if n in (norm(x) for x in names):
            return key
    return n


def channels_of(xml_text):
    """{guide id: [display names]} of an XMLTV text"""
    out = {}
    for m in re.finditer(r'<channel\s+id="([^"]+)"[^>]*>(.*?)</channel>', xml_text, re.S):
        names = re.findall(r'<display-name[^>]*>([^<]+)</display-name>', m.group(2))
        out[m.group(1)] = [m.group(1)] + names
    return out


def match(playlist_names, guide_channels):
    """{playlist name: guide id}: exact alias/normalised-name matches only (a wrong guide is worse than none)"""
    index = {}
    for gid, names in guide_channels.items():
        for n in names:
            index.setdefault(alias_key(n), gid)
    out = {}
    for name in playlist_names:
        gid = index.get(alias_key(name))
        if gid:
            out[name] = gid
    return out


def filter_guide(xml_text, keep_ids):
    """only the channels / programmes of keep_ids (the free guides list hundreds of channels)"""
    parts = []
    for m in re.finditer(r'<channel\s+id="([^"]+)".*?</channel>|<programme\b[^>]*\bchannel="([^"]+)".*?</programme>',
                         xml_text, re.S):
        if (m.group(1) or m.group(2)) in keep_ids:
            parts.append(m.group(0))
    return parts


HEB = re.compile(r'[֐-׿]')
NON_LATIN = re.compile(r'[֐-׿Ѐ-ӿ؀-ۿ]')      # Hebrew, Cyrillic, Arabic: what an English guide translates


def needs(t, mode):
    return not HEB.search(t) if mode == 'he' else bool(NON_LATIN.search(t))


def key(t, mode):
    """translation cache key: Hebrew entries keep the plain text (cache of earlier versions), English ones 'en:'"""
    return t if mode == 'he' else 'en:' + t


def to_translate(parts, mode='he'):
    """unique programme titles / descriptions not in the guide language yet (mode 'he' or 'en')"""
    seen = []
    for p in parts:
        for tag in ('title', 'desc'):
            for t in re.findall(r'<%s[^>]*>([^<]{2,300})</%s>' % (tag, tag), p):
                if needs(t, mode) and t not in seen:
                    seen.append(t)
    return seen


def apply_lang(parts, tr, mode):
    """mode 'he' / 'en': titles and descriptions in that language where a translation exists; 'orig': as the guide has it"""
    if mode not in ('he', 'en') or not tr:
        return parts

    def sub(m):
        return m.group(1) + tr.get(key(m.group(2), mode), m.group(2)) + m.group(3)
    out = []
    for p in parts:
        if p.startswith('<programme'):
            p = re.sub(r'(<title[^>]*>)([^<]+)(</title>)', sub, p)
            p = re.sub(r'(<desc[^>]*>)([^<]+)(</desc>)', sub, p)
        out.append(p)
    return out


class Aborted(Exception):
    """Kodi is quitting: stop the guide work at once (a running guide build held Kodi's exit, 1.4.5 tests)"""


def stream_guide(raw, names, aborted=None):
    """one guide file (gzip or plain bytes) -> ({name: guide id}, [kept parts]) without holding the whole file:
    the country files are 25-80 MB of XML; read as one string + regexes it was ~700 MB of work for 12 countries,
    too much for a 2 GB TV box. XMLTV lists all channels first: match them, then keep only their programmes."""
    import io
    import xml.etree.ElementTree as ET
    stream = gzip.GzipFile(fileobj=io.BytesIO(raw)) if raw[:2] == b'\x1f\x8b' else io.BytesIO(raw)
    chans, xml_of, matched, keep, parts = {}, {}, None, set(), []
    count = 0
    for _, el in ET.iterparse(stream, events=('end',)):
        count += 1
        if aborted and count % 2000 == 0 and aborted():
            raise Aborted()
        if el.tag == 'channel':
            gid = el.get('id')
            chans[gid] = [gid] + [d.text for d in el.findall('display-name') if d.text]
            xml_of[gid] = ET.tostring(el, encoding='unicode')
        elif el.tag == 'programme':
            if matched is None:                         # first programme: the channel list is complete
                matched = match(names, chans)
                keep = set(matched.values())
                parts += [xml_of[g] for g in keep if g in xml_of]
                chans, xml_of = {}, {}
            if el.get('channel') in keep:
                parts.append(ET.tostring(el, encoding='unicode'))
        else:
            continue
        el.clear()
    if matched is None:                                 # a file with channels only
        matched = match(names, chans)
        parts += [xml_of[g] for g in set(matched.values()) if g in xml_of]
    return matched, [p.strip() for p in parts]


# ------------------------------------------------------------ Kodi / network
def build(playlist, errors, fetch, lang_mode='he', translate=None, cache=None, aborted=None):
    """playlist: [(name, country)] -> (parts for the merged guide, {name: guide id}).
    fetch(url) -> bytes; translate(lines) -> lines (in the guide language); cache: dict of earlier translations (updated)."""
    by_cc = {}
    for name, cc in playlist:
        by_cc.setdefault(cc, []).append(name)
    parts, ids = [], {}
    for cc, names in by_cc.items():
        for f in FILES.get(cc, []):
            if aborted and aborted():
                raise Aborted()
            try:
                m, got = stream_guide(fetch(BASE % f), [n for n in names if n not in ids], aborted)
            except Aborted:
                raise
            except Exception as e:
                errors.append('EPG %s: %s' % (f, e))
                continue
            ids.update(m)
            parts += got
    if translate and lang_mode in ('he', 'en'):
        cache = cache if cache is not None else {}
        todo = [t for t in to_translate(parts, lang_mode) if key(t, lang_mode) not in cache]
        for i in range(0, len(todo), 100):
            if aborted and aborted():
                raise Aborted()
            try:
                got = translate(todo[i:i + 100])
                # only real translations are kept: an untranslated line (no engine / time up) is tried again later
                cache.update({key(a, lang_mode): b for a, b in zip(todo[i:i + 100], got) if b and b != a})
            except Exception as e:
                errors.append('EPG translation: %s' % e)
                break
        parts = apply_lang(parts, cache, lang_mode)
    return parts, ids
