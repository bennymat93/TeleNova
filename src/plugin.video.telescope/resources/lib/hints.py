# -*- coding: utf-8 -*-
"""4.0.5: two free, keyless helpers for Hebrew.

* Wikidata: the Hebrew label and spelling variants of a title by its IMDb id - more names to search Telegram by,
  next to TMDb's translations (uploaders write the Hebrew name in several ways).
* Wizdom: the release names that have a Hebrew subtitle for a film / episode. A source whose release matches one of
  them has a subtitle that is in sync with it - a ranking signal (never a reason to drop a file).

Pure Python, no Kodi imports; `http` is a requests-like object (tests pass a fake one)."""
import re

WIKIDATA = 'https://query.wikidata.org/sparql'
WIZDOM = 'https://wizdom.xyz/api/search'
UA = 'TeleNovaKodi/4.0 (Kodi add-on; Hebrew title lookup)'
_IMDB = re.compile(r'^tt\d{5,10}$')
QUERY = ('SELECT ?heLabel ?heAlt WHERE { ?item wdt:P345 "%s". '
         'OPTIONAL { ?item rdfs:label ?heLabel FILTER(LANG(?heLabel)="he") } '
         'OPTIONAL { ?item skos:altLabel ?heAlt FILTER(LANG(?heAlt)="he") } } LIMIT 40')


def _http(http):
    if http is not None:
        return http
    import requests
    return requests


def wikidata_he(imdb, http=None, timeout=4):
    """-> the Hebrew names of the title (label first), [] when unknown. Raises on network errors."""
    if not _IMDB.match(imdb or ''):
        return []
    r = _http(http).get(WIKIDATA, params={'query': QUERY % imdb, 'format': 'json'}, timeout=timeout,
                        headers={'User-Agent': UA, 'Accept': 'application/sparql-results+json'})
    if r.status_code != 200:
        raise IOError('wikidata HTTP %s' % r.status_code)
    out = []
    for row in (r.json().get('results') or {}).get('bindings') or []:
        for key in ('heLabel', 'heAlt'):
            val = ((row.get(key) or {}).get('value') or '').strip()
            # a name, not a sentence: Wikidata alt-labels sometimes carry descriptions
            if val and 2 <= len(val) <= 60 and val not in out and re.search(u'[א-ת]', val):
                out.append(val)
    return out[:8]


def wizdom_versions(imdb, season=None, episode=None, http=None, timeout=5):
    """-> release names that have a Hebrew subtitle at Wizdom. Raises on network errors."""
    if not _IMDB.match(imdb or ''):
        return []
    params = {'action': 'by_id', 'imdb': imdb}
    if episode is not None:
        params.update(season=int(season or 1), episode=int(episode))
    r = _http(http).get(WIZDOM, params=params, timeout=timeout, headers={'User-Agent': UA})
    if r.status_code != 200:
        raise IOError('wizdom HTTP %s' % r.status_code)
    data = r.json()
    if not isinstance(data, list):
        return []
    return [str(x.get('versioname')) for x in data if isinstance(x, dict) and x.get('versioname')][:200]


_EXT = re.compile(r'\.(mkv|mp4|avi|m4v|ts|mov|wmv|srt|heb|he)$', re.I)
_SOURCES = (('bluray', r'blu[ ._-]?ray|bdrip|brrip|bd9|bdremux|remux'), ('webdl', r'web[ ._-]?dl|webdl|amzn|nf\b|dsnp|hmax|atvp'),
            ('webrip', r'web[ ._-]?rip|webrip'), ('hdtv', r'hdtv|pdtv|dsr'), ('dvd', r'dvd[ ._-]?rip|dvdrip|dvdscr'),
            ('web', r'\bweb\b'), ('cam', r'\bcam\b|hdcam|telesync|\bts\b|hdts'))
_QUAL = re.compile(r'(2160|1080|720|480)[pi]', re.I)
_JUNK = set('mkv mp4 avi heb he hebsub hebsubs eng en x264 x265 h264 h265 hevc avc aac ac3 dts ddp5 dd5 atmos 10bit '
            '8bit hdr hdr10 dv rarbg subs sub proper repack internal'.split())


def squash(name):
    return re.sub(r'[^a-z0-9א-ת]+', '', _EXT.sub('', (name or '').lower()))


def same_file_key(c):
    """4.0.9: one name for "the very same file uploaded again". The same document forwarded between chats is
    already recognised by its id; a file uploaded separately to several channels has another id each time and
    filled the list with identical rows. Same name (letters and digits only) and the same size to the byte is the
    same file. None when the row cannot be told apart safely (no size, a generic name like video_123.mp4)."""
    size = int(c.get('size') or 0)
    name = squash(c.get('file') or '')
    if size < 1048576 or len(name) < 8 or re.match(r'^(video|vid|movie|file|document)?\d*$', name):
        return None
    group = 'tg' if (c.get('backend') or 'tg') in ('tg', 'telemedia') else (c.get('backend') or '')
    return group, name, size


def merge_same_files(cands):
    """-> (kept rows, how many were folded in). A Telegram copy becomes a mirror of the first row (the link test
    falls back to it when the first copy is dead); a repeated server / Real-Debrid row is simply left out."""
    out, seen, folded = [], {}, 0
    for c in cands:
        key = same_file_key(c)
        if key is None or key not in seen:
            if key is not None:
                seen[key] = c
            out.append(c)
            continue
        first = seen[key]
        folded += 1
        if key[0] == 'tg' and not c.get('url') and c.get('chat_id'):
            mirrors = first.setdefault('mirrors', [])
            for m in [[c['chat_id'], c['msg_id']]] + list(c.get('mirrors') or []):
                if m not in mirrors and m != [first.get('chat_id'), first.get('msg_id')]:
                    mirrors.append(m)
    return out, folded


def release_key(name):
    """-> (group, source, quality) of a release name; '' / 0 where it does not say"""
    base = _EXT.sub('', (name or '').strip())
    low = base.lower()
    source = next((k for k, rx in _SOURCES if re.search(rx, low)), '')
    q = _QUAL.search(low)
    group = ''
    m = re.search(r'-([A-Za-z0-9]{2,15})(?:\[[^\]]*\])?\s*$', base)
    if m and m.group(1).lower() not in _JUNK and not m.group(1).isdigit():
        group = m.group(1).lower()
    return group, source, int(q.group(1)) if q else 0


def synced(name, versions):
    """'exact' when the same release has a Hebrew subtitle, 'group' when a release of the same group and source has
    one (quality may differ: 720p / 1080p of one group share timing), else ''."""
    if not name or not versions:
        return ''
    me = squash(name)
    group, source, _ = release_key(name)
    # a bare "Title.1994" says nothing about the release: the same name is not the same timing
    if me and (group or source) and any(me == squash(v) for v in versions):
        return 'exact'
    if not group or not source:
        return ''
    for v in versions:
        g, s, _ = release_key(v)
        if g == group and s == source:
            return 'group'
    return ''
