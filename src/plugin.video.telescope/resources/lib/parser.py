# -*- coding: utf-8 -*-
"""Release-name / caption parser tuned for English, Hebrew and Russian Telegram uploads.

parse(filename, caption) -> dict with: title, titles (candidate title strings), year,
season, episode, episode_end, season_pack, quality, source, codec, hdr, langs (set of tags),
is_trailer, is_archive, ext.
"""
import re
import unicodedata

VIDEO_EXT = {'mkv', 'mp4', 'avi', 'm4v', 'mov', 'webm', 'ts', 'm2ts', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'vob'}
ARCHIVE_EXT = {'rar', 'zip', '7z', 'tar', 'gz', 'r00', 'r01', 'iso'}

_HEB = re.compile(u'[֐-׿]')
_CYR = re.compile(u'[Ѐ-ӿ]')

# --- season / episode ------------------------------------------------------------------
# 3.3: the Russian episode word is серия / серии / серий / серию - never the start of "сериал" ("Сериал 2021");
# a 4-digit year is never a season or an episode number
_SER = u'сери[яийю](?![а-яё])'
_NOYEAR = u'(?<!\\d)(?!(?:19|20)\\d{2}(?!\\d))'
_SE_PATTERNS = [
    # S01E02, S1E2, S01.E02, S01 E02, S01E02-E03, S01E02E03, S01E02-03
    re.compile(r'(?<![a-z0-9])s(\d{1,2})[\s._-]*e(\d{1,4})(?:[\s._-]*(?:-|~|e)[\s._-]*e?(\d{1,4}))?(?!\d)', re.I),
    # 1x02, 01x02-03
    re.compile(r'(?<![a-z0-9])(\d{1,2})x(\d{2,3})(?:-(\d{2,3}))?(?![0-9p])', re.I),
    # Season 1 Episode 2 / Season 1 Ep 2 / Season 01 - Episode 02
    re.compile(r'season[\s._-]*(\d{1,2})[\s._,:-]*(?:episode|ep)[\s._:-]*(\d{1,4})(?:[\s]*-[\s]*(\d{1,4}))?', re.I),
    # Hebrew: עונה 1 פרק 2 / עונה 1, פרק 2 / ע1 פ2 / ע'1 פ'2
    re.compile(u'עונה[\\s._:\\-]*(\\d{1,2})[\\s._,:\\-]*פרק(?:ים)?[\\s._:\\-]*(\\d{1,4})(?:[\\s]*-[\\s]*(\\d{1,4}))?'),
    re.compile(u'(?<![א-ת])ע[\'׳"]?\\s*(\\d{1,2})[\\s._,:\\-]*פ[\'׳"]?\\s*(\\d{1,4})(?!\\d)'),
    # Russian: 1 сезон 2 серия / сезон 1 серия 2 / Сезон 1, Серия 2 / 1 сезон, 2-3 серии
    re.compile(u'(?<!\\d)(\\d{1,2})[\\s._-]*сезон\\S*[\\s._,:/\\-]*' + _NOYEAR +
               u'(\\d{1,4})(?:[\\s]*-[\\s]*(\\d{1,4}))?[\\s._-]*' + _SER, re.I),
    re.compile(u'сезон\\S*[\\s._:\\-]*(?<!\\d)(\\d{1,2})(?!\\d)[\\s._,:/\\-]*' + _SER + u'[\\s._:\\-]*' + _NOYEAR +
               u'(\\d{1,4})(?!\\d)(?:[\\s]*-[\\s]*(\\d{1,4}))?', re.I),
]

# episode without season
_EP_ONLY = [
    re.compile(r'(?<![a-z0-9])(?:episode|ep|e)[\s._:-]*(\d{1,4})(?!\d|p)', re.I),
    re.compile(u'פרק[\\s._:\\-]*(\\d{1,4})(?!\\d)'),                    # פרק 5
    re.compile(_NOYEAR + u'(\\d{1,4})[\\s._-]*' + _SER, re.I),                 # 5 серия
    re.compile(_SER + u'[\\s._:\\-]*' + _NOYEAR + u'(\\d{1,4})(?!\\d)', re.I),     # серия 5
]

# season without episode
_SEASON_ONLY = [
    re.compile(r'(?<![a-z0-9])s(\d{1,2})(?![0-9e])', re.I),
    re.compile(r'season[\s._-]*(\d{1,2})', re.I),
    re.compile(u'עונה[\\s._:\\-]*(\\d{1,2})'),                      # עונה 2
    re.compile(u'(?<!\\d)(\\d{1,2})[\\s._-]*сезон', re.I),            # 2 сезон
    re.compile(u'сезон\\S*[\\s._:\\-]*(?<!\\d)(\\d{1,2})(?!\\d)', re.I),      # сезон 2
]

_PACK = re.compile(u'complete|full[\\s._-]*season|כל[\\s]*הפרקים|'
                   u'עונה[\\s]*מלאה|все[\\s]*серии', re.I)

_YEAR = re.compile(r'(?<![0-9])(19[2-9]\d|20[0-4]\d)(?![0-9]|p|i)')

_QUALITY = [
    (2160, re.compile(r'2160p|\b4k\b|\buhd\b', re.I)),
    (1080, re.compile(r'1080[pi]|\bfhd\b|full[\s._-]?hd', re.I)),
    (720, re.compile(r'720p|(?<![a-z])hd(?![a-z])|\bhdrip\b', re.I)),
    (480, re.compile(r'480p|\bsd\b|dvdrip|\bdvd\b', re.I)),
    (360, re.compile(r'360p|240p', re.I)),
]
_SOURCE = [
    ('cam', re.compile(r'\b(?:hd)?cam(?:rip)?\b|\btelesync\b|\bhd-?ts\b|(?<![a-z])ts(?:rip)?(?![a-z])|\btc\b|'
                       u'מצלמה|камрип|экранка', re.I)),
    ('bluray', re.compile(r'blu-?ray|bdrip|brrip|bdremux|remux', re.I)),
    ('web', re.compile(r'web-?dl|webrip|\bweb\b|amzn|nf\b|dsnp|hmax|atvp', re.I)),
    ('hdtv', re.compile(r'hdtv|satrip|iptv', re.I)),
    ('dvd', re.compile(r'dvdrip|dvd', re.I)),
]
_CODEC = [('hevc', re.compile(r'x\.?265|h\.?265|hevc', re.I)), ('av1', re.compile(r'\bav1\b', re.I)),
          ('avc', re.compile(r'x\.?264|h\.?264|avc', re.I))]
_HDR = re.compile(r'\bhdr(?:10)?\+?\b|dolby[\s._-]?vision|\bdv\b', re.I)

_LANG_RULES = [
    ('he_dub', re.compile(u'מדובב|דיבוב|heb(?:rew)?[\\s._-]*dub', re.I)),
    ('he_sub', re.compile(u'תרגום|מתורגם|heb[\\s._-]*subs?|hebsub|hebrew[\\s._-]*sub', re.I)),
    ('ru_audio', re.compile(u'дубляж|дублир|многоголос|'
                            u'озвуч|перевод|\\bmvo\\b|\\bdvo\\b|\\bavo\\b|\\brus(?:sian)?\\b', re.I)),
    ('ru_sub', re.compile(u'субтитр|rus[\\s._-]*subs?', re.I)),
    ('en', re.compile(r'\beng(?:lish)?\b|\boriginal\b', re.I)),
]
_DUB = re.compile(r'\bdub\b', re.I)     # 3.3: "dub" alone says nothing about the language ("Heb.Dub")
_TRAILER = re.compile(u'trailer|teaser|sample|promo|טריילר|טיזר|трейлер|тизер', re.I)

# tokens that terminate the "title" part of a release name
_STOP = re.compile(r'(?<![a-z0-9])(?:s\d{1,2}[\s._-]*e\d{1,4}|s\d{1,2}(?![a-z0-9])|\d{1,2}x\d{2,3}|season|episode|'
                   r'(?:19[2-9]\d|20[0-4]\d)(?![0-9]|p)|2160p|1080[pi]|720p|480p|4k|uhd|bluray|blu-ray|bdrip|brrip|'
                   r'web-?dl|webrip|web|hdtv|hdrip|dvdrip|x\.?26[45]|h\.?26[45]|hevc|hdr|remux|proper|repack|'
                   r'extended|unrated|imax|multi|dubbed|subbed)(?![a-z])'
                   u'|עונה|פרק|מדובב|תרגום|מתורגם'
                   u'|сезон|сери|дубляж|фильм', re.I)

_JUNK = re.compile(r'@[a-z0-9_]{3,}|https?://\S+|www\.\S+|t\.me/\S+|\[[^\]]*\]|\{[^}]*\}', re.I)
# uploader / credit tags seen in Hebrew channels (e.g. 'הועלה ע"י ציקו מדיה', 'קרדיט: ...')
_CREDIT = re.compile(u'\u05d4\u05d5\u05e2\u05dc\u05d4\\s*\u05e2["\u05f4\'\u05f3]?\u05d9[^\\n]*'
                     u'|\u05e7\u05e8\u05d3\u05d9\u05d8[^\\n]*'
                     u"|\u05e6['\u05f3\u2019]?\u05d9\u05e7\u05d5\\s*\u05de\u05d3\u05d9\u05d4|chiko\\s*media", re.I)
_EMOJI = re.compile(u'[\U0001F000-\U0001FAFF☀-➿️‍‎‏‪-‮]')


def strip_marks(text):
    text = unicodedata.normalize('NFKD', text or '')
    return ''.join(ch for ch in text if not unicodedata.combining(ch))


def normalize(text):
    """Lowercase, drop niqqud/accents, unify ё, keep letters & digits of any script."""
    text = strip_marks(text).lower().replace(u'ё', u'е')
    text = text.replace('&', ' and ')
    text = re.sub(r"['’׳״`\"]", '', text)
    text = re.sub(r'[^\w]+', ' ', text, flags=re.UNICODE).replace('_', ' ')
    return re.sub(r'\s+', ' ', text).strip()


def _clean(text):
    text = _EMOJI.sub(' ', text or '')
    text = _CREDIT.sub(' ', text)
    text = _JUNK.sub(' ', text)
    return text


def split_name(filename):
    name = filename or ''
    ext = ''
    m = re.search(r'\.([a-z0-9]{2,4})$', name, re.I)
    if m:
        ext = m.group(1).lower()
        name = name[:m.start()]
    return name, ext


def _dot_space(text):
    # dots/underscores between words -> space (keep "H.264" style tokens readable)
    return re.sub(r'(?<=\w)[._](?=\w)', ' ', text)


def title_part(text):
    """Text before the first technical marker (S/E, year, quality, language tags...)."""
    text = _dot_space(_clean(text))
    text = text.replace('(', ' ').replace(')', ' ')
    text = re.sub(r'\s+', ' ', text)
    cut = len(text)
    rxs = [_STOP] + _SE_PATTERNS + _EP_ONLY + _SEASON_ONLY + [rx for _, rx in _SOURCE] + [rx for _, rx in _QUALITY]
    for rx in rxs:
        for m in rx.finditer(text):
            if m.start() > 0:
                cut = min(cut, m.start())
                break
    text = text[:cut]
    text = re.sub(r'[\s\-|:,~]+$', '', text)
    return re.sub(r'\s+', ' ', text).strip(' -|:.')


def find_se(text):
    """Return (season, episode, episode_end) or (None, None, None)."""
    t = _dot_space(text or '')
    for rx in _SE_PATTERNS:
        m = rx.search(t)
        if m:
            s, e = int(m.group(1)), int(m.group(2))
            end = m.group(3) if (m.lastindex or 0) >= 3 else None
            end = int(end) if end else None
            if end is not None and (end <= e or end - e > 30):
                end = None
            return s, e, end
    return None, None, None


def find_episode_only(text):
    t = _dot_space(text or '')
    for rx in _EP_ONLY:
        m = rx.search(t)
        if m:
            val = int(m.group(1))
            if 0 < val < 3000:
                return val
    return None


def find_season_only(text):
    t = _dot_space(text or '')
    for rx in _SEASON_ONLY:
        m = rx.search(t)
        if m:
            val = int(m.group(1))
            if 0 <= val < 60:
                return val
    return None


def find_year(text):
    t = re.sub(r'\d{3,4}x\d{3,4}', ' ', text or '')
    years = [int(y) for y in _YEAR.findall(t)]
    if not years:
        return None
    # the first year that is not at the very beginning of a title like "1917"/"2012" is ambiguous,
    # prefer a year inside brackets, else the last one before tech markers.
    br = re.search(r'[\(\[](19[2-9]\d|20[0-4]\d)[\)\]]', t)
    if br:
        return int(br.group(1))
    return years[-1] if len(years) > 1 else years[0]


_RES = re.compile(r'(?<!\d)\d{3,4}\s*[x\u00d7]\s*(2160|1080|720|576|480)(?!\d)', re.I)


def find_quality(text):
    m = _RES.search(text or '')
    if m:
        v = int(m.group(1))
        return 480 if v == 576 else v
    for q, rx in _QUALITY:
        if rx.search(text or ''):
            return q
    return 0


def find_source(text):
    for name, rx in _SOURCE:
        if rx.search(text or ''):
            return name
    return ''


def find_langs(text):
    tags = set()
    for tag, rx in _LANG_RULES:
        if rx.search(text or ''):
            tags.add(tag)
    if _HEB.search(text or ''):
        tags.add('he_text')
    if _CYR.search(text or ''):
        tags.add('ru_text')
        if _DUB.search(text or ''):       # 3.3: "dub" means Russian audio only next to Cyrillic text
            tags.add('ru_audio')
    return tags


def parse(filename, caption='', chat_title=''):
    name, ext = split_name(filename or '')
    caption = caption or ''
    first_line = ''
    for line in caption.splitlines():
        line = _clean(line).strip(' -|:*_')
        if len(normalize(line)) >= 2:
            first_line = line
            break
    full = u' '.join([name, caption])

    s, e, e_end = find_se(name)
    if e is None:
        s, e, e_end = find_se(caption)
    season_only = None
    ep_only = None
    if e is None:
        ep_only = find_episode_only(name) or find_episode_only(caption)
        season_only = find_season_only(name) or find_season_only(caption)
        if ep_only is not None:
            e = ep_only
            s = season_only  # may be None -> resolved by matcher with chat title
    year = find_year(name) or find_year(caption)

    titles = []
    for src in (name, first_line):
        tp = title_part(src)
        if tp and normalize(tp) and normalize(tp) not in [normalize(x) for x in titles]:
            titles.append(tp)
    tech = u' '.join([name, caption])
    res = {
        'ext': ext,
        'name': name,
        'title': titles[0] if titles else '',
        'titles': titles,
        'year': year,
        'season': s,
        'episode': e,
        'episode_end': e_end,
        'season_hint': season_only,
        'season_pack': bool(e is None and (season_only is not None or _PACK.search(full))),
        'quality': find_quality(tech),
        'source': find_source(name) or find_source(caption),
        'codec': next((c for c, rx in _CODEC if rx.search(tech)), ''),
        'hdr': bool(_HDR.search(tech)),
        'langs': sorted(find_langs(tech)),
        # 3.3: the FILE NAME decides; a caption often carries a "Трейлер:" link or the word "promo" under a full
        # movie - the matcher uses 'trailer_caption' only together with a short duration / small size
        'is_trailer': bool(_TRAILER.search(name)),
        'trailer_caption': bool(_TRAILER.search(caption)),
        'is_archive': ext in ARCHIVE_EXT,
        'chat_season': find_season_only(chat_title) if chat_title else None,
    }
    return res
