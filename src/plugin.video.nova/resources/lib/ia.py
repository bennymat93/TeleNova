# -*- coding: utf-8 -*-
"""Internet Archive (archive.org) through its public API: search films, list an item's video
files, play the file directly. Replaces the add-on's page scraping, which archive.org broke."""
import re
from urllib.parse import quote

API = 'https://archive.org'
VIDEO = ('.mp4', '.m4v', '.webm', '.mkv', '.ogv', '.avi', '.mpeg')


def _get(path, **params):
    import requests
    r = requests.get(API + path, params=params, headers={'User-Agent': 'NovaTV/1.0'}, timeout=20)
    r.raise_for_status()
    return r.json()


# Archive has no family filter and anyone can upload: a search for "Dune" found a naturist film ("... d'une naturiste")
ADULT = ('(naturis* OR nudis* OR nude OR nudity OR erot* OR porn* OR sex OR sexy OR xxx OR adult OR softcore OR hentai '
         'OR эрот* OR порн* OR секс* OR нудис* OR עירום OR ארוט*)')


# named lists: titles alone found 7 Soviet films; exact subject phrases 621 (loose words pulled in war documentaries)
PRESETS = {'@soviet': ('(subject:("Soviet film") OR subject:("Soviet films") OR subject:("Soviet cinema") OR subject:("Soviet movie") '
                       'OR subject:("Soviet animation") OR subject:("советский фильм") OR subject:("советское кино") OR subject:(мосфильм) '
                       'OR subject:(ленфильм) OR subject:(Mosfilm) OR subject:(Lenfilm) OR subject:(союзмультфильм) OR subject:(Soyuzmultfilm))')}


def query(q):
    """titles only (descriptions matched almost anything), never adult uploads; Lucene syntax in the text is dropped"""
    if q in PRESETS:
        what = PRESETS[q]
    else:
        q = re.sub(r'[:()\[\]{}"^~*?\\/!+\-]', ' ', q or '').strip()
        what = 'title:(%s)' % q if q else 'collection:feature_films'      # no text: the curated feature films
    return '%s AND mediatype:movies AND NOT subject:%s AND NOT title:%s' % (what, ADULT, ADULT)


def search(q, rows=30):
    try:
        d = _get('/advancedsearch.php', q=query(q), rows=rows, output='json',
                 **{'fl[]': ['identifier', 'title', 'year', 'description'], 'sort[]': 'downloads desc'})
        return [{'id': x['identifier'], 'title': x.get('title') if isinstance(x.get('title'), str) else x['identifier'],
                 'year': str(x.get('year') or ''), 'plot': re.sub(r'<[^>]+>', '', x['description'] if isinstance(x.get('description'), str) else '')[:600],
                 'thumb': '%s/services/img/%s' % (API, x['identifier'])} for x in d['response']['docs']]
    except Exception:
        return []


def files(identifier):
    """one playable file per title: prefer h.264 mp4, then any other video format"""
    try:
        m = _get('/metadata/%s' % identifier)
    except Exception:
        return []
    best = {}
    for f in m.get('files', []):
        name = f.get('name', '')
        if not name.lower().endswith(VIDEO) or f.get('source') == 'metadata' and 'thumb' in name.lower():
            continue
        base = name.rsplit('.', 1)[0]
        score = (name.lower().endswith('.mp4'), 'h.264' in (f.get('format') or '').lower(), -int(f.get('size') or 0) if name.lower().endswith('.mp4') else 0)
        if base not in best or score > best[base][0]:
            best[base] = (score, f)
    out = []
    for base in sorted(best):
        f = best[base][1]
        out.append({'title': base.split('/')[-1], 'url': '%s/download/%s/%s' % (API, identifier, quote(f['name'])),
                    'size': int(f.get('size') or 0)})
    md = m.get('metadata') or {}

    def text(v):
        v = v[0] if isinstance(v, list) and v else v
        return re.sub(r'<[^>]+>', '', v) if isinstance(v, str) else ''
    meta = {'title': text(md.get('title')), 'plot': text(md.get('description'))[:1500],
            'year': (text(md.get('year')) or text(md.get('date')))[:4], 'genre': text(md.get('subject'))[:80]}
    for o in out:
        o['meta'] = meta
    return out
