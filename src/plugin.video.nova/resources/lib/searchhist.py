# -*- coding: utf-8 -*-
"""4.0.7: search history, and completions under the search box while typing.

The skin's on-screen keyboard has a panel for suggestions (three columns above the keys). It is fed from here:
  * nothing typed yet  -> the latest searches,
  * while typing       -> earlier searches that contain the text first, then titles from the catalogue (TMDb).
Choosing a suggestion puts it into the box. The panel works in SEARCH boxes only: a search sets the window property
bn.search for as long as its keyboard is open, so what is typed into a key / address / password box is never sent
anywhere and never stored.

Pure functions (add, match, merge, titles_of) are tested in qa/t_searchhist.py."""
import re
import time

FILE = 'search_history.json'
KEEP = 60
PROP = 'bn.search'


# ------------------------------------------------------------------ pure
def clean(q):
    return re.sub(r'\s+', ' ', (q or '').strip())[:120]


def _key(q):
    return clean(q).lower()


def add(hist, q, now=None):
    """-> new history list, newest first, one entry per text (the old entry moves to the top), KEEP at most"""
    q = clean(q)
    if len(q) < 2:
        return list(hist or [])
    out = [{'q': q, 'ts': int(now if now is not None else time.time())}]
    out += [h for h in hist or [] if isinstance(h, dict) and _key(h.get('q')) != _key(q)]
    return out[:KEEP]


def remove(hist, q):
    return [h for h in hist or [] if _key(h.get('q')) != _key(q)]


def match(hist, text, limit=9):
    """earlier searches for the typed text: those that START with it, then those that contain it; all when empty"""
    t = _key(text)
    qs = [h['q'] for h in hist or [] if isinstance(h, dict) and h.get('q')]
    if not t:
        return qs[:limit]
    starts = [q for q in qs if q.lower().startswith(t) and q.lower() != t]
    inside = [q for q in qs if t in q.lower() and not q.lower().startswith(t)]
    return (starts + inside)[:limit]


def titles_of(results, text, limit=9):
    """TMDb search/multi results -> titles to suggest: films and series only, the best known first ("The Matrix"
    before an obscure "Matriarcas" - measured live, the alphabetical order buried it), no doubles"""
    t = _key(text)
    rows = []
    for r in results or []:
        if r.get('media_type') not in ('movie', 'tv'):
            continue
        for name in (r.get('title') or r.get('name'), r.get('original_title') or r.get('original_name')):
            name = clean(name)
            if name and t and t in name.lower():
                rows.append((0, -(r.get('popularity') or 0), name))
                break
        else:                       # found by another of its names: after the titles that show the typed text
            name = clean(r.get('title') or r.get('name'))
            if name:
                rows.append((1, -(r.get('popularity') or 0), name))
    out, seen = [], set()
    for _, _, name in sorted(rows):
        if name.lower() not in seen:
            seen.add(name.lower())
            out.append(name)
    return out[:limit]


def merge(mine, online, text, limit=9):
    """history first (it is what this viewer looks for), then catalogue titles; no doubles, never the text itself"""
    out, seen = [], {_key(text)}
    for src, items in (('history', mine), ('title', online)):
        for q in items or []:
            if _key(q) not in seen:
                seen.add(_key(q))
                out.append((q, src))
    return out[:limit]


# ------------------------------------------------------------------ Kodi
def load():
    from .common import load as _load
    h = _load(FILE, [])
    return h if isinstance(h, list) else []


def record(q):
    from .common import save
    q = clean(q)
    if len(q) >= 2:
        save(FILE, add(load(), q))


def ask(heading, default=''):
    """the keyboard of a search: suggestions on, the answer goes into the history"""
    import xbmcgui
    win = xbmcgui.Window(10000)
    win.setProperty(PROP, '1')
    try:
        q = clean(xbmcgui.Dialog().input(heading, default))
    finally:
        win.clearProperty(PROP)
    if q:
        record(q)
    return q


def online(text):
    """catalogue titles for the typed text (2 letters and more); never raises"""
    if len(clean(text)) < 2:
        return []
    try:
        from .common import tmdb, tmdb_lang
        data = tmdb('/search/multi', query=clean(text), language=tmdb_lang(), include_adult='false')
        return titles_of((data or {}).get('results'), text)
    except Exception:
        return []


def suggest(handle, text):
    """the content of the keyboard's suggestion panel"""
    import xbmcgui
    import xbmcplugin
    from urllib.parse import quote
    text = clean(text)
    if not xbmcgui.Window(10000).getProperty(PROP):        # not a search box: nothing is looked up, nothing shown
        return xbmcplugin.endOfDirectory(handle, succeeded=True, cacheToDisc=False)
    rows = merge(match(load(), text), online(text), text)
    for q, src in rows:
        li = xbmcgui.ListItem(q)
        li.setArt({'icon': 'DefaultAddonsRecentlyUpdated.png' if src == 'history' else 'DefaultAddonsSearch.png'})
        li.setProperty('IsPlayable', 'false')
        xbmcplugin.addDirectoryItem(handle, 'plugin://plugin.video.nova/?a=ac_pick&q=' + quote(q), li, False)
    xbmcplugin.endOfDirectory(handle, succeeded=True, cacheToDisc=False)


def pick(text):
    """a suggestion was chosen: it replaces the text of the open keyboard (the viewer still confirms with OK)"""
    import json
    import xbmc
    text = clean(text)
    if text and xbmc.getCondVisibility('Window.IsActive(virtualkeyboard)'):
        xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'Input.SendText',
                                        'params': {'text': text, 'done': False}}))


STR = {
    'title': ('היסטוריית חיפושים', 'Search history', 'История поиска'),
    'new': ('חיפוש חדש', 'New search', 'Новый поиск'),
    'clear': ('נקה את ההיסטוריה', 'Clear the history', 'Очистить историю'),
    'clear_q': ('למחוק את כל היסטוריית החיפושים?', 'Delete the whole search history?', 'Удалить всю историю поиска?'),
    'remove': ('הסר מההיסטוריה', 'Remove from the history', 'Убрать из истории'),
    'empty': ('עדיין אין חיפושים', 'No searches yet', 'Поисков пока нет'),
}


def s(key):
    from .common import ui_lang
    return STR[key][{'he': 0, 'en': 1, 'ru': 2}[ui_lang()]]


def menu(handle, url):
    """the history as a screen: new search on top, a press repeats a search, the context menu removes one"""
    import xbmcgui
    import xbmcplugin
    hist = load()
    li = xbmcgui.ListItem('[COLOR gold]%s[/COLOR]' % s('new'))
    li.setArt({'icon': 'DefaultAddonsSearch.png'})
    xbmcplugin.addDirectoryItem(handle, url(a='hub_search'), li, True)
    for h in hist:
        li = xbmcgui.ListItem(h['q'])
        li.setLabel2(time.strftime('%d/%m %H:%M', time.localtime(h.get('ts') or 0)))
        li.setArt({'icon': 'DefaultAddonsRecentlyUpdated.png'})
        li.addContextMenuItems([(s('remove'), 'RunPlugin(%s)' % url(a='sh_remove', q=h['q']))])
        xbmcplugin.addDirectoryItem(handle, url(a='hub_search', q=h['q']), li, True)
    if hist:
        li = xbmcgui.ListItem('[COLOR grey]%s[/COLOR]' % s('clear'))
        li.setArt({'icon': 'DefaultIconError.png'})
        xbmcplugin.addDirectoryItem(handle, url(a='sh_clear'), li, False)
    else:
        li = xbmcgui.ListItem('[COLOR grey]%s[/COLOR]' % s('empty'))
        xbmcplugin.addDirectoryItem(handle, url(a='noop'), li, False)
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)


def clear():
    import xbmc
    import xbmcgui
    from .common import save
    if xbmcgui.Dialog().yesno('TeleNova', s('clear_q')):
        save(FILE, [])
        xbmc.executebuiltin('Container.Refresh')


def forget(q):
    import xbmc
    from .common import save
    save(FILE, remove(load(), q))
    xbmc.executebuiltin('Container.Refresh')
