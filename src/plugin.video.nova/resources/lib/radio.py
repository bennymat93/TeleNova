# -*- coding: utf-8 -*-
"""Radio via the free, open radio-browser.info directory (no key, no quota)."""
import xbmcgui
import xbmcplugin

from .common import T, load, save, log

# radio-browser is run by volunteers on several mirrors; "all" is round-robin DNS and sometimes lands on a
# broken one (HTTP 502). Try each mirror, and fall back to the last good answer.
SERVERS = ['https://all.api.radio-browser.info', 'https://de1.api.radio-browser.info',
           'https://de2.api.radio-browser.info', 'https://fi1.api.radio-browser.info', 'https://nl1.api.radio-browser.info']
HEADERS = {'User-Agent': 'NovaTV/0.2'}
# 3.3: only what the lists read is kept in the cache (a station has ~40 fields; the file was several MB)
_KEEP = ('stationuuid', 'name', 'url_resolved', 'url', 'favicon', 'tags', 'country', 'countrycode', 'language',
         'bitrate', 'codec', 'votes')


def _get(path, **params):
    import requests
    params.setdefault('hidebroken', 'true')
    params.setdefault('order', 'votes')
    params.setdefault('reverse', 'true')
    params.setdefault('limit', 300)
    key = 'radio_cache.json'
    cache = load(key, {})
    ck = path + '?' + '&'.join('%s=%s' % kv for kv in sorted(params.items()))
    import time
    ts = cache.get('_ts') or {}
    # 3.3: an answer younger than 6 hours is used as it is - every radio list (and the home row) asked the
    # directory again each time it was opened (3-4 s)
    if cache.get(ck) and isinstance(cache[ck], list) and time.time() - ts.get(ck, 0) < 6 * 3600:
        return cache[ck]
    t0 = time.time()
    for attempt in range(2):
        began = time.time()
        for base in SERVERS:
            if time.time() - t0 > 8:            # 3.3: five dead mirrors x 10 s held the menu for almost a minute
                break
            try:
                r = requests.get(base + '/json' + path, params=params, headers=HEADERS, timeout=(3, 6))
                r.raise_for_status()
                data = r.json()
                # 3.3: a mirror in trouble answers with a JSON object (an error); cached, it crashed every list
                if not isinstance(data, list):
                    raise ValueError('bad answer')
                data = [{k: s[k] for k in _KEEP if s.get(k) not in (None, '')} for s in data if isinstance(s, dict)]
                cache = load(key, {})           # the home rows run side by side: keep what the others just saved
                ts = cache.get('_ts') or {}
                cache[ck] = data
                ts[ck] = time.time()
                if len(ts) > 60:                # searches add keys: keep the 40 newest answers
                    for old in sorted(ts, key=ts.get)[:-40]:
                        ts.pop(old, None)
                        cache.pop(old, None)
                cache['_ts'] = ts
                save(key, cache)
                return data
            except Exception as e:
                log('radio-browser %s: %s' % (base, e))
        # every mirror refused within a moment: the connection is only coming up (seen right after Kodi starts,
        # when the home row loads) - one more round a little later instead of an empty list
        if cache.get(ck) or attempt or time.time() - began > 4 or time.time() - t0 > 8:
            break
        time.sleep(1.5)
    old = cache.get(ck)
    return old if isinstance(old, list) else []     # 3.3: an error object cached by an older version is not a list


_POSTERS = None


def poster(name):
    """the station's 3D poster (tools/make_radio_art.py, same style as the Israeli TV channels) or None"""
    global _POSTERS
    import json
    import os
    import re
    from .common import MEDIA
    if _POSTERS is None:
        try:
            with open(os.path.join(MEDIA, 'radio', 'index.json'), encoding='utf-8') as f:
                _POSTERS = json.load(f)
        except Exception:
            _POSTERS = {}
    key = re.sub(r'[^0-9a-z֐-׿]+', '-', (name or '').lower()).strip('-')
    fn = _POSTERS.get(key)
    return os.path.join(MEDIA, 'radio', fn) if fn else None


def menu(handle, url, folder, end):
    folder(T('israel'), url(a='radio_list', by='country', v='IL'), 'DefaultMusicGenres.png')
    folder(T('russia'), url(a='radio_list', by='country', v='RU'), 'DefaultMusicGenres.png')
    folder(T('hebrew'), url(a='radio_list', by='language', v='hebrew'), 'DefaultMusicGenres.png')
    folder(T('russian'), url(a='radio_list', by='language', v='russian'), 'DefaultMusicGenres.png')
    folder(T('english'), url(a='radio_list', by='language', v='english'), 'DefaultMusicGenres.png')
    folder(T('top_world'), url(a='radio_list', by='top', v=''), 'DefaultMusicGenres.png')
    folder(T('r_genres'), url(a='radio_tags'), 'DefaultMusicGenres.png')
    for key, cc in (('usa', 'US'), ('uk', 'GB'), ('ukraine', 'UA')):
        folder(T(key), url(a='radio_list', by='country', v=cc), 'DefaultMusicGenres.png')
    folder(T('search'), url(a='radio_list', by='search', v=''), 'DefaultAddonsSearch.png')
    end(cache=False)


# radio-browser tags (stations tag themselves; these are the common ones). Israel first where it has the style
TAGS = [('r_news', 'news'), ('r_pop', 'pop'), ('r_rock', 'rock'), ('r_classical', 'classical'), ('r_jazz', 'jazz'),
        ('r_oriental', 'world middle east'), ('r_kids', 'kids'), ('r_religious', 'jewish')]


def tags(handle, url, folder, end):
    for key, tag in TAGS:
        folder(T(key), url(a='radio_list', by='tag', v=tag), 'DefaultMusicGenres.png')
    end(cache=False)


def listing(handle, url, end, by, v=''):        # v='' is dropped from the URL by parse_qsl ("Top", "Search")
    if by == 'country':
        data = _get('/stations/bycountrycodeexact/' + v)
    elif by == 'language':
        data = _get('/stations/bylanguageexact/' + v)
    elif by == 'tag':
        data = _get('/stations/bytagexact/' + v)
    elif by == 'search':
        q = xbmcgui.Dialog().input(T('search'))
        if not q:
            return end()
        data = _get('/stations/search', name=q)
    else:
        data = _get('/stations/topvote/100')
    seen = set()
    shown = 0
    for s in data:
        if not isinstance(s, dict):
            continue
        name = (s.get('name') or '').strip()
        stream = s.get('url_resolved') or s.get('url')
        if not name or not stream or name.lower() in seen:
            continue
        seen.add(name.lower())
        li = xbmcgui.ListItem(name)
        pic = poster(' '.join(name.split())) or s.get('favicon') or 'DefaultAudio.png'
        li.setArt({'thumb': pic, 'icon': pic, 'poster': pic})
        tag = li.getMusicInfoTag()
        tag.setTitle(name)
        tag.setGenres([g for g in (s.get('tags') or '').split(',') if g][:3])
        tag.setComment('%s · %s kbps' % (s.get('country') or '', s.get('bitrate') or '?'))
        li.setProperty('IsPlayable', 'true')
        li.addContextMenuItems([(T('add_fav'), 'RunPlugin(%s)' % url(a='fav_add', kind='radio',
                                                                     id=s.get('stationuuid', stream),
                                                                     label=name, extra=stream))])
        xbmcplugin.addDirectoryItem(handle, stream, li, False)
        shown += 1
    if not shown:                               # 3.3: an empty list says so (no answer / nothing found)
        li = xbmcgui.ListItem(T('empty'))
        li.setArt({'icon': 'DefaultAudio.png'})
        li.setProperty('IsPlayable', 'false')
        xbmcplugin.addDirectoryItem(handle, url(a='noop'), li, False)
    xbmcplugin.setContent(handle, 'songs')
    end()
