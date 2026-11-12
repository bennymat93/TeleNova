# -*- coding: utf-8 -*-
import os
import sys
from urllib.parse import parse_qsl, urlencode

import xbmc
import xbmcgui

from resources.lib.common import monitor
import xbmcplugin

from resources.lib.common import (T, tmdb, art, load, save, now_str, MEDIA, log, IMG)
from resources.lib import accounts, iptv, radio, backup, libraries, providers, status, sysupdate

HANDLE = int(sys.argv[1])
BASE = sys.argv[0]


def url(**kw):
    return BASE + '?' + urlencode(kw)


def icon(name):
    import os
    for ext in ('.png', '.jpg'):
        p = os.path.join(MEDIA, name + ext)
        if os.path.exists(p):
            return p
    return 'DefaultFolder.png'


def folder(label, target, ic=None, plot='', fanart=None, context=None):
    li = xbmcgui.ListItem(label)
    li.setArt({'icon': ic or 'DefaultFolder.png', 'thumb': ic or 'DefaultFolder.png',
               'fanart': fanart or icon('fanart')})
    li.getVideoInfoTag().setPlot(plot)
    if context:
        li.addContextMenuItems(context)
    xbmcplugin.addDirectoryItem(HANDLE, target, li, True)


BN_VIEW = 60          # BN Details view: backdrop + full info of the focused title (skin View_60_BN.xml)
BN_EPISODES = 62      # BN Episodes view (1.4.12, skin View_62_BNEpisodes.xml)


def end(content='', cache=True):
    if content:
        xbmcplugin.setContent(HANDLE, content)
    xbmcplugin.endOfDirectory(HANDLE, cacheToDisc=cache)
    if content in ('episodes', 'videos'):
        xbmc.executebuiltin('Container.SetViewMode(%d)' % BN_EPISODES)    # wide pictures, per-episode background
    elif content in ('movies', 'tvshows', 'seasons'):
        xbmc.executebuiltin('Container.SetViewMode(%d)' % BN_VIEW)


def details(m, ids):
    """full TMDb details for a page of titles, fetched in parallel (cached 6 h by tmdb())"""
    import time
    from concurrent.futures import ThreadPoolExecutor
    out = {}
    until = time.time() + 12            # titles still waiting for a worker after 12 s are shown without details

    def one(i):
        try:
            if time.time() > until:
                return
            if m == 'movie':
                out[i] = tmdb('/movie/%s' % i, append_to_response='credits,release_dates')
            else:
                out[i] = tmdb('/tv/%s' % i, append_to_response='credits,content_ratings')
        except Exception:
            pass
    ids = list(ids)
    if ids:
        # 3.3: at most 8 requests at a time (was one thread per title, 20 at once - small boxes choked)
        with ThreadPoolExecutor(max_workers=min(8, len(ids))) as pool:
            list(pool.map(one, ids))
    return out


def apply_details(li, tag, m, d):
    """runtime, genres, tagline, cast, director, age rating, studio on the list item itself"""
    if not d:
        return
    tag.setGenres([g['name'] for g in d.get('genres', [])])
    if d.get('tagline'):
        tag.setTagLine(d['tagline'])
    rt = d.get('runtime') or (d.get('episode_run_time') or [0])[0]
    if rt:
        tag.setDuration(int(rt) * 60)
    cr = d.get('credits') or {}
    cast = []
    for c in (cr.get('cast') or [])[:8]:
        a = xbmc.Actor(c.get('name', ''), c.get('character', ''), c.get('order', 0),
                       ('https://image.tmdb.org/t/p/w185' + c['profile_path']) if c.get('profile_path') else '')
        cast.append(a)
    if cast:
        tag.setCast(cast)
    directors = [c['name'] for c in cr.get('crew', []) if c.get('job') == 'Director']
    if m != 'movie':
        directors = [c['name'] for c in d.get('created_by', [])]
    if directors:
        tag.setDirectors(directors[:2])
    studios = [c['name'] for c in (d.get('production_companies') or d.get('networks') or [])][:2]
    if studios:
        tag.setStudios(studios)
    mpaa = ''
    for r in (d.get('release_dates') or {}).get('results', []):
        if r.get('iso_3166_1') in ('IL', 'US'):
            mpaa = next((x.get('certification') for x in r.get('release_dates', []) if x.get('certification')), '') or mpaa
    for r in (d.get('content_ratings') or {}).get('results', []):
        if r.get('iso_3166_1') in ('IL', 'US') and r.get('rating'):
            mpaa = r['rating']
    if mpaa:
        tag.setMpaa(mpaa)
    if m != 'movie':
        li.setProperty('TotalSeasons', str(d.get('number_of_seasons') or ''))
        li.setProperty('TotalEpisodes', str(d.get('number_of_episodes') or ''))


# ------------------------------------------------------------------ root
def root():
    folder(providers.s('hub_search'), url(a='hub_search'), os.path.join(MEDIA, 'search_all.png'))   # a search-box tile
    folder(T('movies'), url(a='media_root', m='movie'), icon('movies'))
    folder(T('series'), url(a='media_root', m='tv'), icon('series'))
    folder(T('tv'), url(a='tv_root'), icon('tv'))
    folder(T('radio'), url(a='radio_root'), icon('radio'))
    if providers.telegram_on():                 # 1.7.0: the Telegram engine's own menus (Chiko Media, my channels, login)
        folder(providers.s('tg_menu'), 'plugin://plugin.video.telescope/',
               'special://home/addons/plugin.video.telescope/resources/icon.png')
    folder(T('history'), url(a='history'), icon('history'))
    folder(T('favourites'), url(a='favs'), icon('favourites'))
    folder(providers.s('library'), url(a='libs'), icon('libraries'))
    folder(T('accounts'), url(a='accounts'), icon('accounts'))
    folder(T('kodi_settings'), url(a='kodi_settings'), icon('accounts'))
    folder(T('backup_menu'), url(a='bk_menu'), icon('backup'))
    folder('Google Drive', url(a='gd_menu'), 'DefaultNetwork.png')
    folder(status.s('title'), url(a='status'), icon('accounts'))
    from resources.lib import profiles
    from resources.lib.common import ui_lang
    he = ui_lang() == 'he'
    folder('%s: %s' % ('סוג מכשיר' if he else 'Device type', profiles.label(profiles.current(), 'he' if he else 'en')),
           url(a='profile_pick'), 'DefaultAddonProgram.png')
    folder(sysupdate.s('title'), url(a='sysreport'), icon('accounts'),
           plot=sysupdate.s('running'))
    end(cache=False)


def bk_menu():
    for label, act in ((T('backup'), 'bk_do'), (T('restore'), 'bk_restore')):
        li = xbmcgui.ListItem(label)
        li.setArt({'icon': 'DefaultAddonProgram.png'})
        xbmcplugin.addDirectoryItem(HANDLE, url(a=act), li, False)
    folder('Google Drive', url(a='gd_menu'), 'DefaultNetwork.png')      # backups on Drive, restore, sync
    end(cache=False)


def _gd():
    from resources.lib import gdrive_ui
    return gdrive_ui


GENRES = {  # tmdb genre ids (movie, tv)
    'movie': [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 53, 10752, 37],
    'tv': [10759, 16, 35, 80, 99, 18, 10751, 10762, 9648, 10763, 10764, 10765, 10766, 10767, 10768, 37],
}
LANGS = [('he', 'hebrew'), ('en', 'english'), ('ru', 'russian'), ('fr', 'french'), ('es', 'spanish'), ('ko', 'korean'),
         ('ja', 'japanese'), ('tr', 'turkish'), ('de', 'german'), ('it', 'italian'), ('hi', 'hindi')]


def media_root(m):
    folder(T('search'), url(a='search', m=m), icon('search'))
    folder(T('trending'), url(a='list', m=m, path='/trending/%s/week' % m), icon('trending'))
    folder(T('popular'), url(a='list', m=m, path='/%s/popular' % m), icon('popular'))
    folder(T('top_rated'), url(a='list', m=m, path='/%s/top_rated' % m), icon('top'))
    # 1.6.3: the rows a viewer looks for first (the split the big services use): new, Israeli, family
    if m == 'movie':
        folder(T('now_playing'), url(a='list', m=m, path='/movie/now_playing'), icon('trending'))
        folder(T('il_movies'), url(a='list', m=m, path='/discover/movie', with_origin_country='IL',
                                    sort_by='popularity.desc', **{'vote_count.gte': 3}), icon('languages'))
        folder(T('family'), url(a='list', m=m, path='/discover/movie', with_genres=10751, sort_by='popularity.desc'), icon('genres'))
        folder(T('docu'), url(a='list', m=m, path='/discover/movie', with_genres=99, sort_by='popularity.desc'), icon('genres'))
    else:
        folder(T('il_series'), url(a='list', m=m, path='/discover/tv', with_origin_country='IL',
                                    sort_by='popularity.desc', **{'vote_count.gte': 3}), icon('languages'))
        folder(T('on_air'), url(a='list', m=m, path='/tv/on_the_air'), icon('trending'))
        folder(T('kids_tv'), url(a='list', m=m, path='/discover/tv', with_genres=10762, sort_by='popularity.desc'), icon('genres'))
        folder(T('docu'), url(a='list', m=m, path='/discover/tv', with_genres=99, sort_by='popularity.desc'), icon('genres'))
    folder(T('genres'), url(a='genres', m=m), icon('genres'))
    folder(T('languages'), url(a='langs', m=m), icon('languages'))
    folder(T('years'), url(a='years', m=m), icon('years'))
    if m == 'tv':
        folder(T('kukhnya'), url(a='kukhnya'), icon('kitchen'))
    end(cache=False)


def _tile(name, fallback):
    """category tile made at build time (tools/make_category_art.py): symbol / year / language on a card"""
    import os
    p = os.path.join(MEDIA, 'cats', name + '.png')
    return p if os.path.exists(p) else fallback


def genres(m):
    try:
        gl = tmdb('/genre/%s/list' % m)['genres']
    except Exception as e:                  # no internet / TMDb down: an empty row, not a traceback
        log('genres: %s' % e, xbmc.LOGWARNING)
        return end()
    for g in gl:
        folder(g['name'], url(a='list', m=m, path='/discover/%s' % m, with_genres=g['id'],
                              sort_by='popularity.desc'), _tile('genre_%d' % g['id'], icon('genres')))
    end()


def langs(m):
    for code, key in LANGS:
        folder(T(key), url(a='list', m=m, path='/discover/%s' % m, with_original_language=code,
                           sort_by='popularity.desc'), _tile('lang_' + code, icon('lang_' + code)))
    end()


def years(m):
    import datetime
    field = 'primary_release_year' if m == 'movie' else 'first_air_date_year'
    for y in range(datetime.date.today().year, 1949, -1):
        folder(str(y), url(a='list', m=m, path='/discover/%s' % m, sort_by='popularity.desc', **{field: y}),
               _tile('year_%d' % y, icon('years')))
    end()


def _topics():
    from resources.lib import topics
    return topics


def _help():
    from resources.lib import helpcenter
    return helpcenter


def w_search(m, action='search'):
    """widget: one "search" tile shaped like a search field (movies / series / a learning section)"""
    tile = os.path.join(MEDIA, 'search_%s.png' % m)
    li = xbmcgui.ListItem(T('search'))
    li.setArt({'thumb': tile, 'poster': tile, 'landscape': tile, 'icon': tile})   # the full tile (no fanart: it filled the screen)
    target = url(a=action, m=m) if action == 'search' else (url(a=action) if m == 'help' else url(a=action, s=m))
    xbmcplugin.addDirectoryItem(HANDLE, target, li, True)
    end(cache=False)


def tvradio():
    """TV & Radio (main menu): Israeli channels first, every channel group, the guide, radio"""
    folder(T('israel'), url(a='tv_list', gname='Israel'), 'DefaultTVShows.png')
    folder(T('channels'), url(a='tv_root'), 'DefaultTVShows.png')
    folder(T('world'), url(a='tv_countries'), 'DefaultCountry.png')
    folder(T('radio'), url(a='radio_root'), 'DefaultMusicGenres.png')
    end(cache=False)


def _fav_ctx(kind, item_id, label, extra=''):
    return [(T('add_fav'), 'RunPlugin(%s)' % url(a='fav_add', kind=kind, id=item_id, label=label, extra=extra))]


def media_item(m, it, d=None):
    title = it.get('title') or it.get('name') or ''
    year = (it.get('release_date') or it.get('first_air_date') or '')[:4]
    label = '%s (%s)' % (title, year) if year else title
    li = xbmcgui.ListItem(label)
    li.setArt(art(it))
    tag = li.getVideoInfoTag()
    tag.setTitle(title)
    tag.setOriginalTitle(it.get('original_title') or it.get('original_name') or '')
    tag.setPlot(it.get('overview') or '')
    tag.setRating(float(it.get('vote_average') or 0), int(it.get('vote_count') or 0), 'tmdb', True)
    if year:
        tag.setYear(int(year))
    tag.setUniqueIDs({'tmdb': str(it['id'])}, 'tmdb')
    tag.setPremiered(it.get('release_date') or it.get('first_air_date') or '')
    apply_details(li, tag, 'movie' if m == 'movie' else 'tv', d)
    ctx = _fav_ctx('movie' if m == 'movie' else 'series', it['id'], label)
    if m == 'movie':
        tag.setMediaType('movie')
        li.setProperty('IsPlayable', 'false')
        orig = it.get('original_title') or ''
        target = url(a='play', m='movie', id=it['id'], q=('%s %s' % (title, year)).strip(),
                     alt=('%s %s' % (orig, year)).strip() if orig and orig != title else '')
        if providers.telegram_on():
            ctx.append((providers.s('tg_src'), 'PlayMedia(%s)' % providers.telegram_url('movie', it['id'], title=title,
                                                                                      mode='play', year=year, select=1)))
        ctx.append((providers.s('hub_search'), 'Container.Update(%s)' % url(a='hub_search', q=title)))
        li.addContextMenuItems(ctx)
        xbmcplugin.addDirectoryItem(HANDLE, target, li, False)
    else:
        tag.setMediaType('tvshow')
        li.addContextMenuItems(ctx)
        xbmcplugin.addDirectoryItem(HANDLE, url(a='seasons', id=it['id']), li, True)


def list_(m, path, page='1', **filters):
    if path.startswith('/discover/'):
        filters.setdefault('vote_count.gte', 15)   # hide stubs / junk entries
    data = tmdb(path, page=page, **filters)
    rows = [it for it in data.get('results', []) if it.get('media_type') not in ('person',)]
    full = {}
    for kind in ('movie', 'tv'):
        ids = [it['id'] for it in rows if (it.get('media_type') or m) == kind]
        full.update({(kind, k): v for k, v in details(kind, ids).items()})
    for it in rows:
        kind = it.get('media_type') or m
        media_item(kind, it, full.get((kind, it['id'])))
    if not rows:                        # 3.3: an empty list says so
        folder(T('empty'), url(a='noop'))
    if int(page) < min(int(data.get('total_pages', 1)), 500):
        li = xbmcgui.ListItem('[B]%s >>[/B]' % T('next_page'))
        li.setArt({'icon': icon('next'), 'thumb': icon('next'), 'fanart': icon('fanart')})
        li.setProperty('SpecialSort', 'bottom')         # stays last whatever the viewer sorts by
        xbmcplugin.addDirectoryItem(HANDLE, url(a='list', m=m, path=path, page=int(page) + 1, **filters), li, True)
    # 3.3: the viewer can sort a title list (TMDb's own order stays the default)
    for sm in (xbmcplugin.SORT_METHOD_UNSORTED, xbmcplugin.SORT_METHOD_LABEL, xbmcplugin.SORT_METHOD_VIDEO_YEAR,
               xbmcplugin.SORT_METHOD_VIDEO_RATING):
        xbmcplugin.addSortMethod(HANDLE, sm)
    end('movies' if m == 'movie' else 'tvshows')


def hub_search(q='', s=None, e=None):
    if not q:
        q = xbmcgui.Dialog().input(providers.s('hub_search'))
    if not q:
        return end()
    xbmcplugin.setPluginCategory(HANDLE, q)
    providers.hub_results(HANDLE, q, media_item, season=s, episode=e)
    end('videos', cache=False)


def play(m, id, q, alt='', s=None, e=None):
    """3.1: a title opens its list of links (Telegram first, then the other sources)"""
    if m != 'movie':
        from resources.lib import epmatch       # other sources: the text states the episode, results match it exactly
        return providers.play_with_fallback('', epmatch.query_for(q, s, e), epmatch.query_for(alt, s, e) if alt else '',
                                            season=s, episode=e, show=q, alt_show=alt,
                                            tmdb_id=id, mediatype='episode', title=q)
    import re
    providers.play_with_fallback('', q, alt, tmdb_id=id, mediatype='movie', title=re.sub(r'\s*\(?\d{4}\)?$', '', q))


def search(m):
    """category search (Movies / Series): TMDb titles of that kind, then the files the Telegram engine
    (TeleScope) finds for the same text - 3.0.0"""
    import threading
    from resources.lib import epmatch
    q = xbmcgui.Dialog().input(T('search'))
    if not q:
        return end()
    xbmcplugin.setPluginCategory(HANDLE, q)
    tg = {}

    def tg_work():
        try:
            p = next(x for x in providers.PROVIDERS if x[0] == 'telescope')
            items = providers._useful(providers.read_dir(providers.build_url(p, q)))
            # series search: files that state an episode; movie search: files that do not
            is_ep = lambda it: epmatch.parse(it.get('label') or '')[1] is not None
            tg['p'], tg['r'] = p, [it for it in items if is_ep(it) == (m == 'tv')]
        except Exception as e:
            log('category search telegram: %s' % e, xbmc.LOGWARNING)
    th = threading.Thread(target=tg_work, daemon=True)
    if providers.telegram_on():
        th.start()
    try:
        rows = tmdb('/search/%s' % m, query=q).get('results', [])
    except Exception as e:
        log('category search tmdb: %s' % e, xbmc.LOGWARNING)
        rows = []
    full = details(m, [it['id'] for it in rows])
    for it in rows:
        media_item(m, it, full.get(it['id']))
    if th.is_alive():
        th.join(14)
    if tg.get('r'):
        providers._header(HANDLE, '%s (%d)' % (providers.s('tg'), len(tg['r'])))
        for it in tg['r'][:30]:
            providers._add_foreign(HANDLE, tg['p'], it)
    if not rows and not tg.get('r'):
        xbmcgui.Dialog().notification('TeleNova', providers.s('none'), xbmcgui.NOTIFICATION_INFO, 4000)
    end('movies' if m == 'movie' else 'tvshows', cache=False)


def seasons(tv_id):
    show = tmdb('/tv/%s' % tv_id)
    for s in show.get('seasons', []):
        if s.get('season_number') == 0 and not s.get('episode_count'):
            continue
        li = xbmcgui.ListItem(s.get('name') or '%s %s' % (T('season'), s['season_number']))
        a = art(s) or art(show)
        a.setdefault('fanart', art(show).get('fanart'))
        li.setArt(a)
        tag = li.getVideoInfoTag()
        tag.setPlot(s.get('overview') or show.get('overview') or '')
        try:                            # 3.3: the skin's season views read these
            tag.setMediaType('season')
            tag.setSeason(int(s['season_number']))
            tag.setTvShowTitle(show.get('name') or '')
        except Exception:
            pass
        xbmcplugin.addDirectoryItem(HANDLE, url(a='episodes', id=tv_id, s=s['season_number']), li, True)
    end('seasons')


def hebrew_plots(tv_id, s, season):
    """episode descriptions TMDb has no Hebrew text for: the English ones, machine-translated once and kept
    (Hebrew interface only). {episode number: text}"""
    from resources.lib.common import ui_lang
    if ui_lang() != 'he' or all(e.get('overview') for e in season.get('episodes', [])):
        return {}
    cache = load('plots_he.json', {})
    key = '%s:%s' % (tv_id, s)
    if key in cache:
        return {int(k): v for k, v in cache[key].items()}
    try:
        en = tmdb('/tv/%s/season/%s' % (tv_id, s), language='en-US')
        todo = {e['episode_number']: e['overview'] for e in en.get('episodes', [])
                if e.get('overview') and not next((x for x in season.get('episodes', [])
                                                   if x['episode_number'] == e['episode_number'] and x.get('overview')), None)}
        src = list(todo.values())
        out = dict(zip(todo, translate_he(src))) if todo else {}
    except Exception as ex:
        log('episode plots: %s' % ex)
        return {}
    # 3.3: a text that came back unchanged was not translated (no network / the limit passed): the season is kept
    # only when every text is really Hebrew - before, the English text was stored for good as the "Hebrew" one
    if any(out[k] == t for k, t in todo.items()):
        return out
    cache[key] = {str(k): v for k, v in out.items()}
    if len(cache) > 400:
        cache = dict(list(cache.items())[-300:])
    save('plots_he.json', cache)
    return out


def translate_he(texts):
    """free Google endpoint (the same one the subtitle server falls back to), one request per text"""
    import requests
    # 3.3: the requests run side by side (one after another a season of 20 episodes took 10-15 s to open), each
    # with a short limit; a text that could not be translated in time stays in English
    from concurrent.futures import ThreadPoolExecutor

    def one(t):
        try:
            r = requests.get('https://translate.googleapis.com/translate_a/single', timeout=5,
                             params={'client': 'gtx', 'sl': 'auto', 'tl': 'iw', 'dt': 't', 'q': t})
            return ''.join(p[0] for p in r.json()[0] if p[0]) or t
        except Exception:
            return t
    if not texts:
        return []
    with ThreadPoolExecutor(max_workers=min(8, len(texts))) as pool:
        return list(pool.map(one, texts))


def episodes(tv_id, s):
    # 3.3: the show and the season in one request (TMDb puts the season under the key "season/<n>")
    show = tmdb('/tv/%s' % tv_id, append_to_response='season/%s' % s)
    season = show.get('season/%s' % s)
    if not isinstance(season, dict) or 'episodes' not in season:
        season = tmdb('/tv/%s/season/%s' % (tv_id, s))
    history = {h.get('key'): h for h in load('history.json', [])}
    plots = hebrew_plots(tv_id, s, season)
    tg_on = providers.telegram_on()
    for e in season.get('episodes', []):
        key = 'tv:%s:%s:%s' % (tv_id, s, e['episode_number'])
        seen = history.get(key)
        label = '%dx%02d. %s' % (int(s), e['episode_number'], e.get('name') or '')
        if seen:
            label = '[COLOR limegreen]●[/COLOR] %s  [COLOR grey](%s %s)[/COLOR]' % (label, T('watched_at'), seen['when'])
        li = xbmcgui.ListItem(label)
        a = art(e)
        # the focused episode's own picture is the screen background (the show's when it has none)
        a['fanart'] = (IMG + 'w1280' + e['still_path']) if e.get('still_path') else art(show).get('fanart', '')
        a.setdefault('poster', art(show).get('poster', ''))
        li.setArt(a)
        tag = li.getVideoInfoTag()
        tag.setMediaType('episode')
        tag.setTitle(e.get('name') or '')
        tag.setTvShowTitle(show.get('name') or '')
        tag.setSeason(int(s))
        tag.setEpisode(e['episode_number'])
        tag.setPlot(e.get('overview') or plots.get(e['episode_number']) or show.get('overview') or '')
        tag.setFirstAired(e.get('air_date') or '')
        if e.get('runtime'):
            tag.setDuration(int(e['runtime']) * 60)
        if e.get('vote_average'):
            tag.setRating(float(e['vote_average']), int(e.get('vote_count') or 0), 'tmdb', True)
        tag.setUniqueIDs({'tmdb': str(tv_id)}, 'tmdb')
        li.setProperty('IsPlayable', 'false')
        tgctx = [(providers.s('tg_src'), 'PlayMedia(%s)' % providers.telegram_url(
            'episode', tv_id, s, e['episode_number'], show.get('name') or '', mode='play', select=1,
            ert=e.get('runtime') or 0))] if tg_on else []
        li.addContextMenuItems(tgctx + [
                                (providers.s('hub_search'), 'Container.Update(%s)' % url(a='hub_search', q=show.get('name') or '',
                                                                                         s=s, e=e['episode_number']))])
        target = url(a='play', m='episode', id=tv_id, s=s, e=e['episode_number'], q=show.get('name') or '',
                     alt=show.get('original_name') if show.get('original_name') != show.get('name') else '')
        xbmcplugin.addDirectoryItem(HANDLE, target, li, False)
    end('episodes', cache=False)


def kukhnya():
    res = tmdb('/search/tv', query='Кухня', first_air_date_year=2012, language='ru-RU')
    hit = next((r for r in res.get('results', []) if r.get('original_language') == 'ru'), None)
    if not hit:
        xbmcgui.Dialog().notification('TeleNova', T('empty'))
        return end()
    seasons(hit['id'])


# ------------------------------------------------------------------ history / favourites
def history():
    items = load('history.json', [])
    if not items:
        folder(T('empty'), url(a='noop'))
    for h in items[:500]:
        li = xbmcgui.ListItem('[COLOR grey]%s[/COLOR]  %s' % (h['when'], h['label']))
        li.setArt({'thumb': h.get('thumb', ''), 'fanart': h.get('fanart', '')})
        li.getVideoInfoTag().setPlot('%s: %s\n%s' % (T('watched_at'), h['when'], h.get('plot', '')))
        target = h.get('play') or url(a='noop')
        if target.startswith('plugin://plugin.video.pov/'):       # entries saved before 0.1.8
            q = dict(parse_qsl(target.split('?', 1)[1]))
            target = url(a='play', m=q.get('mediatype', 'movie'), id=q.get('tmdb_id', ''), q=h['label'],
                         **({'s': q['season'], 'e': q['episode']} if q.get('season') else {}))
        li.setProperty('IsPlayable', 'false' if target.startswith(BASE) else 'true')
        xbmcplugin.addDirectoryItem(HANDLE, target, li, False)
    if items:
        li = xbmcgui.ListItem('[COLOR red]%s[/COLOR]' % T('clear'))
        xbmcplugin.addDirectoryItem(HANDLE, url(a='history_clear'), li, False)
    end(cache=False)


FAV_KINDS = [('movie', 'movies'), ('series', 'series'), ('channel', 'channels'), ('radio', 'radio')]


def favs(kind=None):
    data = load('favourites.json', [])
    if not kind:
        for k, label in FAV_KINDS:
            n = sum(1 for f in data if f['kind'] == k)
            folder('%s (%d)' % (T(label), n), url(a='favs', kind=k), icon(label))
        return end(cache=False)
    if not any(f['kind'] == kind for f in data):        # 3.3: an empty list says so
        folder(T('empty'), url(a='noop'))
    for f in [f for f in data if f['kind'] == kind]:
        rm = [(T('rem_fav'), 'RunPlugin(%s)' % url(a='fav_rm', kind=kind, id=f['id']))]
        if kind == 'movie':
            li = xbmcgui.ListItem(f['label'])
            li.setProperty('IsPlayable', 'false')
            li.addContextMenuItems(rm)
            xbmcplugin.addDirectoryItem(HANDLE, url(a='play', m='movie', id=f['id'], q=f['label']), li, False)
        elif kind == 'series':
            folder(f['label'], url(a='seasons', id=f['id']), context=rm)
        elif kind == 'channel':
            li = xbmcgui.ListItem(f['label'])
            li.addContextMenuItems(rm)
            xbmcplugin.addDirectoryItem(HANDLE, url(a='tv_play', id=f['id']), li, False)
        else:
            li = xbmcgui.ListItem(f['label'])
            li.setProperty('IsPlayable', 'true')
            li.addContextMenuItems(rm)
            xbmcplugin.addDirectoryItem(HANDLE, f.get('extra', ''), li, False)
    end(cache=False)


def fav_add(kind, id, label, extra=''):
    data = load('favourites.json', [])
    if not any(f['kind'] == kind and str(f['id']) == str(id) for f in data):
        data.insert(0, {'kind': kind, 'id': id, 'label': label, 'extra': extra, 'added': now_str()})
        save('favourites.json', data)
    xbmcgui.Dialog().notification('TeleNova', T('fav_added'), icon('favourites'), 2500)


def fav_rm(kind, id):
    data = [f for f in load('favourites.json', []) if not (f['kind'] == kind and str(f['id']) == str(id))]
    save('favourites.json', data)
    _gd().remember_removed(kind, id)          # stays removed on the other devices after a Google Drive sync
    refresh()


# ------------------------------------------------------------------ router
def router(p):
    a = p.pop('a', None)
    if not a:
        return root()
    if a.startswith('noop') and a != 'noop' or (a == 'noop' and p.get('tmdb_id')):
        # 3.3: buttons of the skin that used to open POV ("replace source" in the player, Play / seasons in the
        # information window) arrive as ?a=noop<pov mode>&mediatype=..&tmdb_id=.. - they open the same title here
        mode, tid = a[4:], p.get('tmdb_id', '')
        if not tid.isdigit():           # no TMDb id (an IMDb number, or nothing): nothing to open
            a = 'noop'
        elif mode == 'build_season_list':
            return seasons(tid)
        elif mode == 'build_episode_list':
            return episodes(tid, p.get('season') or '1')
        elif p.get('mediatype') == 'episode' and (p.get('season') or '').isdigit() and (p.get('episode') or '').isdigit():
            show = tmdb('/tv/%s' % tid)
            return play('episode', tid, show.get('name') or p.get('query', ''), s=int(p['season']), e=int(p['episode']),
                        alt=show.get('original_name') if show.get('original_name') != show.get('name') else '')
        else:
            mv = tmdb('/movie/%s' % tid)
            year = (mv.get('release_date') or '')[:4]
            return play('movie', tid, ('%s %s' % (mv.get('title') or p.get('query', ''), year)).strip(),
                        alt=mv.get('original_title') if mv.get('original_title') != mv.get('title') else '')
    simple = {
        'media_root': lambda: media_root(p['m']),
        'genres': lambda: genres(p['m']),
        'w_search': lambda: w_search(p['m']),
        'topic_root': lambda: _topics().root(HANDLE, url, p['s'], folder, end),
        'topic_cats': lambda: _topics().categories(HANDLE, url, p['s']),
        'topic_cat': lambda: _topics().show_category(HANDLE, p['s'], p['c']),
        'topic_top': lambda: _topics().show_top(HANDLE, p['s']),
        'topic_search': lambda: _topics().show_search(HANDLE, p['s'], p.get('q', '')),
        'w_topic_search': lambda: w_search(p['s'], action='topic_search'),
        'hub_k': lambda: _topics().hub(HANDLE, url),
        'hub_k_search': lambda: _topics().show_hub_search(HANDLE, p.get('q', '')),
        'w_hub_k_search': lambda: w_search('hub', action='hub_k_search'),
        'hub_k_news': lambda: _topics().show_latest_news(HANDLE),
        'help': lambda: _help().root(HANDLE, url, folder, end),
        'help_cats': lambda: _help().cats(HANDLE, url),
        'help_guide': lambda: _help().guide(HANDLE, url, folder, end),
        'help_trouble': lambda: _help().trouble(HANDLE, url, folder, end),
        'help_search': lambda: _help().do_search(HANDLE, url, folder, end, p.get('q', '')),
        'w_help_search': lambda: w_search('help', action='help_search'),
        'help_show': lambda: _help().show(p['kind'], p['id']),
        'help_about': lambda: _help().about(),
        'help_lang': lambda: _help().toggle(),
        'profile_pick': lambda: (__import__('resources.lib.profiles', fromlist=['x']).wizard(force=True), refresh()),
        'live': lambda: __import__('resources.lib.livefail', fromlist=['x']).live(HANDLE, p.get('ch', ''), p.get('alt', '')),
        'lb_epg': lambda: __import__('resources.lib.livebar', fromlist=['x']).epg(HANDLE),
        'lb_channels': lambda: __import__('resources.lib.livebar', fromlist=['x']).channels(HANDLE),
        'lb_play': lambda: __import__('resources.lib.livebar', fromlist=['x']).play(p['id']),
        'speedtest': lambda: __import__('resources.lib.speedtest', fromlist=['x']).run_dialog(),
        'tvradio': tvradio,
        'langs': lambda: langs(p['m']),
        'years': lambda: years(p['m']),
        'search': lambda: search(p['m']),
        'seasons': lambda: seasons(p['id']),
        'episodes': lambda: episodes(p['id'], p['s']),
        'kukhnya': kukhnya,
        'history': history,
        'history_clear': lambda: (save('history.json', []), refresh()),
        'favs': lambda: favs(p.get('kind')),
        'fav_add': lambda: fav_add(**p),
        'fav_rm': lambda: fav_rm(**p),
        'accounts': lambda: accounts.screen(HANDLE, url),
        'acc': lambda: accounts.action(p['do']),
        'tv_root': lambda: iptv.menu(HANDLE, url, folder, end),
        'tv_do': lambda: iptv.action(p['do']),
        'tv_list': lambda: iptv.channel_list(HANDLE, p.get('group'), p.get('gname'), p.get('w') == '1'),
        'tv_play': lambda: iptv.play_channel(p['id']),
        'tv_countries': lambda: iptv.countries_list(HANDLE, url),
        'tv_country': lambda: iptv.country_channels(HANDLE, p['cc']),
        'radio_root': lambda: radio.menu(HANDLE, url, folder, end),
        'radio_tags': lambda: radio.tags(HANDLE, url, folder, end),
        'radio_list': lambda: radio.listing(HANDLE, url, end, **p),
        'noop': lambda: HANDLE >= 0 and xbmcplugin.endOfDirectory(HANDLE, succeeded=True, cacheToDisc=False),
        'libs': lambda: providers.library(HANDLE, url),
        'lib_cat': lambda: providers.library_cat(HANDLE, url, p['cat']),
        'lib_open': lambda: providers.open_provider(HANDLE, p['id'], p.get('q', '')),
        'sources': lambda: providers.sources_screen(HANDLE, url),
        'prov_toggle': lambda: (providers.toggle(p['id']), refresh()),
        'prov_all_on': lambda: (providers.set_all(True), refresh()),
        'prov_all_off': lambda: (providers.set_all(False), refresh()),
        'prov_install_all': lambda: (providers.install_all(), refresh()),
        'hub_search': lambda: hub_search(p.get('q', ''), p.get('s'), p.get('e')),
        'status': lambda: status.listing(HANDLE),
        'sysreport': lambda: sysupdate.listing(HANDLE, url),
        'sysupdate': system_update,
        'sysfix': lambda: (sysupdate.do_fix(p['id']), refresh()),
        'sysrollback': sysupdate.rollback,
        'ai_subs_now': ai_subs_now,
        'subs_menu': subs_menu,
        'live_subs': lambda: __import__('resources.lib.livesubs', fromlist=['x']).menu(),
        'live_subs_start': lambda: __import__('resources.lib.livesubs', fromlist=['x']).start(p.get('mode', 'auto')),
        'live_subs_off': lambda: __import__('resources.lib.livesubs', fromlist=['x']).off(),
        'sync_menu': lambda: _pm().sync(),
        'settings_menu': lambda: _pm().settings(),
        'kodi_settings': lambda: __import__('resources.lib.kodisettings', fromlist=['x']).menu(HANDLE, url),
        'kodi_go': lambda: __import__('resources.lib.kodisettings', fromlist=['x']).go(p.get('k', '')),
        'audio_menu': lambda: _pm().audio(),
        'subs_pick': lambda: _pm().picker(),
        'next_episode': lambda: _pm().next_episode(),
        'yt_channel': lambda: providers.yt_channel(HANDLE, url, p['id'], p.get('token', '')),
        'yt_search': lambda: providers.yt_search(HANDLE, p['q']),
        'ia_search': lambda: providers.ia_search(HANDLE, p.get('q', '')),
        'ia_item': lambda: providers.ia_item(HANDLE, p['id']),
        'ia_play': lambda: providers.ia_play(HANDLE, p['u'], p.get('t', ''), p.get('id', '')),
        'play': lambda: play(**p),
        'lib_install': lambda: libraries.install(p['id']),
        'bk_menu': bk_menu,
        'gd_menu': lambda: _gd().menu(HANDLE, url),
        'gd': lambda: _gd().action(p['do']),
        'gd_browse': lambda: _gd().browse(HANDLE, url, p.get('id', '')),
        'gd_play': lambda: _gd().play(HANDLE, p['id'], p.get('name', '')),
        'bk_do': backup.backup,
        'bk_restore': backup.restore,
        'bk_auto': lambda: backup.auto_backup(every_days=0),
        'clip_paste': lambda: __import__('resources.lib.clipui', fromlist=['x']).paste_now(),
        'clip_menu': lambda: __import__('resources.lib.clipui', fromlist=['x']).history_menu(),
    }
    if a == 'list':
        m, path = p.pop('m'), p.pop('path')
        return list_(m, path, **p)
    if a in ACTIONS:
        # actions are not folders: close the directory request first, refresh afterwards
        if HANDLE >= 0:
            xbmcplugin.endOfDirectory(HANDLE, succeeded=False, updateListing=False, cacheToDisc=False)
        simple[a]()
        return
    simple[a]()


ACTIONS = {'fav_add', 'fav_rm', 'history_clear', 'acc', 'tv_do', 'tv_play', 'lib_install', 'bk_do', 'bk_restore', 'bk_auto', 'gd', 'gd_play',
           'play', 'prov_toggle', 'prov_all_on', 'prov_all_off', 'prov_install_all', 'sysupdate', 'sysfix', 'sysrollback', 'help_show', 'help_about', 'help_lang', 'speedtest', 'profile_pick', 'lb_play', 'ai_subs_now', 'subs_menu', 'live_subs', 'live_subs_start', 'live_subs_off', 'sync_menu',
           'settings_menu', 'audio_menu', 'subs_pick', 'next_episode', 'kodi_go', 'clip_paste', 'clip_menu'}


def system_update():
    rep = sysupdate.run()
    xbmcgui.Dialog().notification('BN Stream', sysupdate.summary(rep), xbmcgui.NOTIFICATION_INFO, 6000)
    if xbmc.getCondVisibility('Window.IsActive(videos)'):
        xbmc.executebuiltin('Container.Update(%s)' % url(a='sysreport'))
    else:                   # started from the home-screen button: open the report (with the Auto-Fix rows)
        xbmc.executebuiltin('ActivateWindow(Videos,%s,return)' % url(a='sysreport'))


def ai_subs_now():
    """AI Subtitle Generation button (player / subtitle window): the service does the work"""
    if not xbmc.getCondVisibility('Player.HasVideo'):
        return xbmcgui.Dialog().notification('TeleNova', T('ai_noplay'), xbmcgui.NOTIFICATION_WARNING, 4000)
    xbmc.executebuiltin('Dialog.Close(subtitlesearch)')
    xbmc.executebuiltin('NotifyAll(plugin.video.nova,ai_now)')


def _pm():
    from resources.lib import player_menus
    return player_menus


def subs_menu():
    """the Subtitles menu (player button): generation actions, picker, appearance; on live TV (or its live-subtitle
    stream) the live-subtitle choice instead"""
    from resources.lib import livesubs
    if xbmc.getCondVisibility('PVR.IsPlayingTV') or livesubs.state().get('sid'):
        return livesubs.menu()
    _pm().subtitles()


def refresh():
    # never refresh while Kodi is still building a listing (crashes Kodi 21)
    mon = monitor()
    for _ in range(40):
        if not xbmc.getCondVisibility('Container.IsUpdating'):
            break
        mon.waitForAbort(0.1)
    xbmc.executebuiltin('Container.Refresh')


if __name__ == '__main__':
    try:
        router(dict(parse_qsl(sys.argv[2][1:])))
    except (KeyError, TypeError):
        # 3.3: a link without one of its parameters (an old skin button, a widget saved by another version): logged,
        # no "Error: 'm'" message on the screen, the directory is closed as failed
        import traceback
        xbmc.log('[NovaTV] bad link %s: %s' % (sys.argv[2][:200], traceback.format_exc()), xbmc.LOGWARNING)
        if HANDLE >= 0:
            try:
                xbmcplugin.endOfDirectory(HANDLE, succeeded=False, cacheToDisc=False)
            except Exception:
                pass
    except Exception as e:
        import re
        import traceback
        xbmc.log('[NovaTV] ' + traceback.format_exc(), xbmc.LOGERROR)
        # 3.3: the message on the screen never carries an address or a key (requests errors hold the whole URL)
        msg = re.sub(r'https?://\S+', '', str(e))
        msg = re.sub(r'(api_key|key|token)=[^&\s]+', '', msg).strip()
        xbmcgui.Dialog().notification('TeleNova', ('%s: %s %s' % (T('error'), type(e).__name__, msg[:120])).strip(),
                                      xbmcgui.NOTIFICATION_ERROR)
        try:
            xbmcplugin.endOfDirectory(HANDLE, False)
        except Exception:
            pass
    finally:
        # Kodi crashes (access violation in python3.8.dll) when a plugin script ends while its worker threads
        # (TMDb details, parallel source search) still run: let them finish first - the listing is already shown
        import threading
        for th in threading.enumerate():
            if th is not threading.current_thread() and th.is_alive():
                th.join(30)
