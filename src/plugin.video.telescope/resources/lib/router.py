# -*- coding: utf-8 -*-
"""Plugin entry point: menus, catalogs, login UI, source selection and playback."""
import json
import sys
import time

try:
    from urllib.parse import urlencode, parse_qsl, quote
except ImportError:  # pragma: no cover
    from urllib import urlencode, quote
    from urlparse import parse_qsl

import xbmc
import xbmcgui
import xbmcplugin

from . import common, rpc
from .common import lang as L
from .cache import Cache
from .meta import Meta

HANDLE = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].lstrip('-').isdigit() else -1
BASE = sys.argv[0] if sys.argv else 'plugin://%s/' % common.ADDON_ID

LAST_STATS = {}
STAGES = {'metadata': 30071, 'ai_aliases': 30072, 'telegram_search': 30073, 'matching': 30074,
          'ai_verify': 30075, 'probe': 30076, 'done': 30077, 'cached': 30082}


def Lf(string_id, *args):
    """Localized string with safe %-formatting (a translation missing the placeholder never crashes)."""
    text = L(string_id)
    try:
        return text % args
    except (TypeError, ValueError):
        return '%s %s' % (text, ' '.join(str(a) for a in args))


def url(**kw):
    return BASE + '?' + urlencode(dict((k, v if not isinstance(v, (dict, list)) else json.dumps(v))
                                       for k, v in kw.items() if v is not None))


_meta = None


def meta():
    global _meta
    if _meta is None:
        key = common.setting('tmdb_key')
        if not key:
            for aid, k in (('plugin.video.nova', 'tmdb_key'), ('plugin.video.nova', 'tmdb_token'),     # 3.3.5
                           ('plugin.video.pov', 'tmdb_read_token')):
                try:
                    import xbmc
                    import xbmcaddon
                    if not xbmc.getCondVisibility('System.HasAddon(%s)' % aid):
                        continue
                    key = xbmcaddon.Addon(aid).getSetting(k)
                except Exception:
                    key = ''
                if key:
                    break
        _meta = Meta(key, common.tmdb_language(), Cache(common.CACHE_DB),
                     common.setting_bool('adult'), common.log)
    return _meta


# ------------------------------------------------------------------ directory helpers
def add_dir(label, query, icon=None, fanart=None, plot='', folder=True, context=None, info=None, playable=False):
    li = common.make_listitem(label)
    common.set_art(li, icon, fanart)
    if info or plot:
        data = dict(info or {})
        data.setdefault('plot', plot)
        data.setdefault('title', label)
        common.set_video_info(li, data)
    if playable:
        li.setProperty('IsPlayable', 'true')
    if context:
        li.addContextMenuItems(context)
    xbmcplugin.addDirectoryItem(HANDLE, url(**query), li, isFolder=folder)


def end(content=None, cache=True):
    if content:
        xbmcplugin.setContent(HANDLE, content)
    xbmcplugin.endOfDirectory(HANDLE, cacheToDisc=cache)


# ------------------------------------------------------------------ menus
def root(_):
    add_dir(L(30000), {'mode': 'search_menu'})
    add_dir(L(30001), {'mode': 'movies'})
    add_dir(L(30002), {'mode': 'tvshows'})
    add_dir(L(30003), {'mode': 'hebrew'})
    add_dir(L(30004), {'mode': 'russian'})
    add_dir(L(30005), {'mode': 'kids'})
    add_dir(L(30009), {'mode': 'chiko'})
    add_dir(L(30006), {'mode': 'telegram'})
    add_dir(L(30007), {'mode': 'account'})
    add_dir(L(30008), {'mode': 'settings'}, folder=False)
    end(cache=False)
    first_run_check()


def first_run_check():
    if common.setting('api_id') and common.setting('api_hash'):
        return
    if xbmc.getCondVisibility('System.HasAddon(plugin.video.telemedia)'):
        return
    if common.setting_bool('wizard_shown'):
        return
    common.set_setting('wizard_shown', 'true')
    common.notify(L(30063), time=8000)       # never a blocking dialog: hubs read this folder in the background


def movies(_):
    for cat, sid in (('trending', 30010), ('popular', 30011), ('top_rated', 30012), ('now_playing', 30013),
                     ('upcoming', 30014)):
        add_dir(L(sid), {'mode': 'list', 'kind': 'movie', 'cat': cat})
    add_dir(L(30015), {'mode': 'genres', 'kind': 'movie'})
    add_dir(L(30016), {'mode': 'years', 'kind': 'movie'})
    end()


def tvshows(_):
    for cat, sid in (('trending', 30010), ('popular', 30011), ('top_rated', 30012), ('on_the_air', 30018),
                     ('airing_today', 30017)):
        add_dir(L(sid), {'mode': 'list', 'kind': 'tv', 'cat': cat})
    add_dir(L(30015), {'mode': 'genres', 'kind': 'tv'})
    add_dir(L(30016), {'mode': 'years', 'kind': 'tv'})
    add_dir(L(30024), {'mode': 'list', 'kind': 'tv', 'cat': 'discover', 'f': {'with_original_language': 'tr'}})
    add_dir(L(30025), {'mode': 'list', 'kind': 'tv', 'cat': 'discover', 'f': {'with_original_language': 'ko'}})
    end()


def hebrew(_):
    add_dir(L(30019), {'mode': 'list', 'kind': 'movie', 'cat': 'discover',
                       'f': {'with_original_language': 'he', 'min_votes': 1}})
    add_dir(L(30020), {'mode': 'list', 'kind': 'tv', 'cat': 'discover',
                       'f': {'with_original_language': 'he', 'min_votes': 1}})
    add_dir(L(30019) + ' - ' + L(30012), {'mode': 'list', 'kind': 'movie', 'cat': 'discover',
                                           'f': {'with_original_language': 'he', 'sort_by': 'vote_average.desc',
                                                 'min_votes': 20}})
    add_dir(L(30020) + ' - ' + L(30012), {'mode': 'list', 'kind': 'tv', 'cat': 'discover',
                                           'f': {'with_original_language': 'he', 'sort_by': 'vote_average.desc',
                                                 'min_votes': 10}})
    add_dir(L(30026) + ' (' + L(30094) + ')', {'mode': 'list', 'kind': 'movie', 'cat': 'discover',
                                                'f': {'with_genres': '16', 'with_origin_country': 'IL|US',
                                                      'sort_by': 'popularity.desc'}})
    end()


def russian(_):
    add_dir(L(30021), {'mode': 'list', 'kind': 'movie', 'cat': 'discover',
                       'f': {'with_original_language': 'ru', 'min_votes': 5}})
    add_dir(L(30022), {'mode': 'list', 'kind': 'tv', 'cat': 'discover',
                       'f': {'with_original_language': 'ru', 'min_votes': 2}})
    add_dir(L(30021) + ' - ' + L(30012), {'mode': 'list', 'kind': 'movie', 'cat': 'discover',
                                           'f': {'with_original_language': 'ru', 'sort_by': 'vote_average.desc',
                                                 'min_votes': 100}})
    add_dir(L(30022) + ' - ' + L(30012), {'mode': 'list', 'kind': 'tv', 'cat': 'discover',
                                           'f': {'with_original_language': 'ru', 'sort_by': 'vote_average.desc',
                                                 'min_votes': 30}})
    add_dir(L(30023), {'mode': 'list', 'kind': 'movie', 'cat': 'discover',
                       'f': {'with_original_language': 'ru', 'max_year': 1991, 'sort_by': 'vote_count.desc'}})
    add_dir(L(30026), {'mode': 'list', 'kind': 'movie', 'cat': 'discover',
                       'f': {'with_original_language': 'ru', 'with_genres': '16'}})
    end()


def kids(_):
    add_dir(L(30001), {'mode': 'list', 'kind': 'movie', 'cat': 'discover', 'f': {'with_genres': '10751'}})
    add_dir(L(30026), {'mode': 'list', 'kind': 'movie', 'cat': 'discover', 'f': {'with_genres': '16'}})
    add_dir(L(30002), {'mode': 'list', 'kind': 'tv', 'cat': 'discover', 'f': {'with_genres': '10762'}})
    end()


def genres(p):
    kind = p['kind']
    for g in meta().genres(kind):
        f = {'with_genres': str(g['id'])} if meta().has_tmdb else {'genre_name': g['name']}
        add_dir(g['name'], {'mode': 'list', 'kind': kind, 'cat': 'discover', 'f': f})
    end()


def years(p):
    this = time.localtime().tm_year
    for y in range(this, 1929, -1):
        add_dir(str(y), {'mode': 'list', 'kind': p['kind'], 'cat': 'discover', 'f': {'year': y}})
    end()


# ------------------------------------------------------------------ catalog items
def _item_info(it):
    return {'title': it['title'], 'originaltitle': it.get('original_title'), 'year': it.get('year'),
            'plot': it.get('plot'), 'rating': it.get('rating'), 'votes': it.get('votes'),
            'premiered': it.get('premiered'), 'mediatype': 'movie' if it['type'] == 'movie' else 'tvshow',
            'tmdb': it.get('tmdb'), 'imdbnumber': it.get('imdb')}


def _ident(it):
    return {'tmdb': it.get('tmdb')} if it.get('tmdb') else {'imdb': it.get('imdb')}


def show_items(items, kind):
    for it in items:
        label = it['title'] + (' (%s)' % it['year'] if it.get('year') else '')
        if kind == 'movie':
            q = dict(mode='play', type='movie', title=it['title'], year=it.get('year'), **_ident(it))
            ctx = [(L(30080), 'PlayMedia(%s)' % url(select=1, **q)),
                   (L(30081), 'PlayMedia(%s)' % url(refresh=1, select=1, **q))]
            add_dir(label, q, it.get('poster'), it.get('fanart'), folder=False, playable=True,
                    info=_item_info(it), context=ctx)
        else:
            q = dict(mode='seasons', title=it['title'], year=it.get('year'), **_ident(it))
            add_dir(label, q, it.get('poster'), it.get('fanart'), info=_item_info(it))


def list_(p):
    kind, cat, page = p['kind'], p.get('cat', 'popular'), int(p.get('page', 1))
    f = json.loads(p.get('f') or '{}')
    items, pages = meta().listing(kind, cat, page, **f)
    show_items(items, kind)
    if page < pages:
        q = dict(p)
        q['page'] = page + 1
        add_dir('%s (%d)' % (L(30027), page + 1), q)
    end('movies' if kind == 'movie' else 'tvshows')


def seasons(p):
    ident = p.get('tmdb') or 'imdb:%s' % p.get('imdb')
    d = meta().details('tv', ident)
    if not d:
        return end()
    for s in d.get('seasons', []):
        if s['season'] == 0 and not s.get('episodes'):
            continue
        label = L(30029) if s['season'] == 0 else (s.get('name') or Lf(30028, s['season']))
        add_dir(label, dict(mode='episodes', season=s['season'], title=d['title'], year=d.get('year'),
                            **_ident(d)), s.get('poster') or d.get('poster'), d.get('fanart'),
                info={'title': label, 'tvshowtitle': d['title'], 'season': s['season'], 'mediatype': 'season',
                      'plot': d.get('plot')})
    end('seasons')


def episodes(p):
    ident = p.get('tmdb') or 'imdb:%s' % p.get('imdb')
    season = int(p['season'])
    d = meta().details('tv', ident) or {}
    eps = meta().season(d.get('tmdb'), season) if d.get('tmdb') else (d.get('_episodes') or {}).get(season, [])
    today = time.strftime('%Y-%m-%d')
    for e in eps:
        aired = not e.get('premiered') or e['premiered'] <= today
        label = '%dx%02d. %s' % (season, e['episode'], e.get('title') or '')
        if not aired:
            label = '[COLOR gray]%s (%s)[/COLOR]' % (label, e['premiered'])
        q = dict(mode='play', type='tv', title=d.get('title') or p.get('title'), year=d.get('year') or p.get('year'),
                 season=season, episode=e['episode'], ert=e.get('runtime') or d.get('runtime') or 0, **_ident(d or p))
        ctx = [(L(30080), 'PlayMedia(%s)' % url(select=1, **q)),
               (L(30081), 'PlayMedia(%s)' % url(refresh=1, select=1, **q))]
        add_dir(label, q, e.get('thumb') or d.get('poster'), d.get('fanart'), folder=False, playable=True,
                context=ctx, info={'title': e.get('title'), 'tvshowtitle': d.get('title'), 'season': season,
                                   'episode': e['episode'], 'plot': e.get('plot'), 'premiered': e.get('premiered'),
                                   'mediatype': 'episode', 'rating': e.get('rating'),
                                   'duration': (e.get('runtime') or 0) * 60})
    end('episodes')


# ------------------------------------------------------------------ search
def search_menu(_):
    add_dir(L(30030), {'mode': 'search', 'kind': 'movie'})
    add_dir(L(30031), {'mode': 'search', 'kind': 'tv'})
    add_dir(L(30032), {'mode': 'ai_search'})
    add_dir(L(30033), {'mode': 'tg_search'})
    end(cache=False)


def _ask(heading=30034, default=''):
    return xbmcgui.Dialog().input(L(heading), default).strip()


def search(p):
    q = p.get('q') or _ask()
    if not q:
        return end()
    items, _ = meta().search(p['kind'], q)
    show_items(items, p['kind'])
    end('movies' if p['kind'] == 'movie' else 'tvshows', cache=False)


def ai_search(p):
    text = p.get('q') or _ask(30032)
    if not text:
        return end()
    try:
        found = rpc.call('ai_search', text=text, timeout=60)
    except rpc.RPCError as exc:
        common.notify(str(exc))
        return end()
    for f in found:
        kind = f['type']
        items, _ = meta().search(kind, f['title'], year=f.get('year'))
        if not items and f.get('year'):
            items, _ = meta().search(kind, f['title'])
        if items:
            show_items(items[:1], kind)
    end('movies', cache=False)


def tg_search(p):
    """3.3.3: runs as a job in the service - every chat (bot chats and pinned public channels too) is searched,
    the content bots are asked, one row per file, best fit first, every listed link tested."""
    q = p.get('q') or _ask(30033)
    if not q:
        return end()
    try:
        job = rpc.call('find_start', target={'type': 'free', 'query': q, 'refresh': bool(p.get('refresh'))})
        files = _wait_job(job, q)
    except rpc.RPCError as exc:
        return _rpc_fail(exc)
    if files is None:
        return end()
    _bot_join_row(LAST_STATS)
    show_files(files)
    if not files:
        common.notify(L(30078))
    end('videos', cache=False)


# ------------------------------------------------------------------ result rows (3.3.3)
QCOL = {2160: 'FFFFC107', 1080: 'FF4FC3F7', 720: 'FF81C784'}
TICK = u'✓'
DOT = u' · '


def _q_tag(q):
    q = int(q or 0)
    if not q:
        return '[COLOR FF9E9E9E][B]SD?[/B][/COLOR]'
    name = '4K' if q >= 2160 else '%dp' % q
    return '[COLOR %s][B]%s[/B][/COLOR]' % (QCOL.get(q, 'FFBDBDBD'), name)


def _lang_tags(s):
    langs = set(s.get('langs') or [])
    tags = []
    if 'he_dub' in langs:
        tags.append(L(30094) + (' ' + TICK if s.get('he_audio_inside') else ''))
    if 'he_sub' in langs:
        tags.append(L(30093) + (' ' + TICK if s.get('he_sub_inside') else ''))
    elif s.get('he_sub_synced'):          # 4.0.5: a Hebrew subtitle for this very release exists (Wizdom)
        tags.append(L(30093) + ' Wizdom')
    if 'ru_audio' in langs:
        tags.append(L(30095))
    if 'ru_sub' in langs:
        tags.append(L(30096))
    return tags


def _kind_tag(s):
    if s.get('backend') == 'telemedia':
        return 'TM'
    if s.get('backend') == 'stremio':
        return 'SRV'
    if s.get('backend') == 'rd':
        return '[COLOR gold]RD[/COLOR]'
    return {'bot': L(30117), 'channel': L(30118), 'group': L(30119)}.get(s.get('chat_kind') or '', '')


def _status_tag(s):
    if s.get('backend') == 'rd':              # 3.3.4: cached at Real-Debrid - checked when played
        return '[COLOR gold]%s %s[/COLOR]' % (TICK, L(30171))
    if s.get('probe') == 'ok':
        col = 'lime' if s.get('smooth', True) else 'orange'
        sp = (s.get('speed') or 0) / 1048576.0
        return '[COLOR %s]%s %s%s[/COLOR]' % (col, TICK, L(30091), (' %.1f MB/s' % sp) if sp >= 0.05 else '')
    return '[COLOR gray]%s[/COLOR]' % L(30092)


def _where(s):
    kind = _kind_tag(s)
    chat = s.get('chat_title') or ''
    if kind and chat:
        return '%s: %s' % (kind, chat)
    return chat or kind


def _enrich(c):
    """A raw file row (chat browsing) gets the fields a tested search row has - read from its name."""
    if 'quality' in c and 'probe' in c:
        return c
    from .parser import parse as parse_name
    pr = parse_name(c.get('file') or '', c.get('caption') or '', c.get('chat_title') or '')
    c = dict(c)
    c.setdefault('quality', pr.get('quality') or 0)
    c.setdefault('codec', pr.get('codec'))
    c.setdefault('hdr', pr.get('hdr'))
    c.setdefault('langs', pr.get('langs'))
    c.setdefault('season', pr.get('season'))
    c.setdefault('episode', pr.get('episode'))
    c.setdefault('year', pr.get('year'))
    c.setdefault('title', pr.get('title') or '')
    c['_raw'] = True
    return c


def _file_plot(c):
    lines = [c.get('file') or '']
    where = _where(c)
    if where:
        lines.append(where)
    if c.get('date'):
        lines.append(time.strftime('%d/%m/%Y', time.localtime(int(c['date']))))
    m = c.get('media') or {}
    tech = []
    if m.get('width') and m.get('height'):
        tech.append('%dx%d' % (m['width'], m['height']))
    if m.get('video') or c.get('codec'):
        tech.append(str(m.get('video') or c.get('codec')))
    if m.get('audio'):
        tech.append('%s: %s' % (L(30148), ', '.join(m['audio'])))
    if m.get('subs'):
        tech.append('%s: %s' % (L(30149), ', '.join(m['subs'])))
    if tech:
        lines.append(DOT.join(tech))
    if c.get('match'):
        lines.append('%s %d%%' % (L(30133), c['match']))
    if c.get('caption'):
        lines.append('')
        lines.append(c['caption'])
    return '\n'.join(lines)


def _file_label(c):
    name = c.get('title') or ''
    if name and c.get('episode') is not None and c.get('season') is not None:
        name = '%s S%02dE%02d' % (name, int(c['season']), int(c['episode']))
    elif name and c.get('year'):
        name = '%s (%s)' % (name, c['year'])
    if not name:
        name = c.get('file') or (c.get('caption') or '')[:60]
    bits = [common.human_size(c.get('size'))]
    if c.get('duration'):
        bits.append(common.human_duration(c['duration']))
    if c.get('codec'):
        bits.append(str(c['codec']))
    if c.get('hdr'):
        bits.append('HDR')
    label = '%s  %s  [COLOR gray]%s[/COLOR]' % (_q_tag(c.get('quality')), name, DOT.join(b for b in bits if b))
    tags = _lang_tags(c)
    if tags:
        label += '  [COLOR cyan]%s[/COLOR]' % ' / '.join(tags)
    if not c.get('_raw'):
        label += '  ' + _status_tag(c)
    where = _where(c)
    if where:
        label += '  [COLOR FF8D99AE]%s[/COLOR]' % where
    return label


# ------------------------------------------------------------------ telegram browsing
def show_files(files):
    seen = set()
    for c in files:
        key = (c.get('chat_id'), c.get('msg_id'), c.get('url'))
        if key in seen:
            continue
        seen.add(key)
        c = _enrich(c)
        name = c.get('file') or c.get('caption', '')[:60]
        q = ({'mode': 'playurl', 'u': c['url'], 'name': c.get('file', '')} if c.get('url') else
             {'mode': 'playtg', 'chat': c['chat_id'], 'msg': c['msg_id'], 'name': c.get('file', '')})
        add_dir(_file_label(c), q, folder=False, playable=True,
                info={'title': name, 'plot': _file_plot(c), 'duration': c.get('duration') or 0,
                      'mediatype': 'video'})


def telegram(_):
    add_dir(L(30040), {'mode': 'dialogs'})
    add_dir(L(30110), {'mode': 'bots'})
    add_dir(L(30041), {'mode': 'discover'})
    add_dir(L(30042), {'mode': 'join'}, folder=False)
    add_dir(L(30033), {'mode': 'tg_search'})
    end(cache=False)


def _chat_label(c, state=''):
    kind = c.get('kind') or ('channel' if c.get('channel') else 'group')
    col = {'bot': 'FFFFB74D', 'channel': 'FF4FC3F7', 'group': 'FF81C784'}.get(kind, 'gray')
    tag = {'bot': L(30117), 'channel': L(30118), 'group': L(30119)}.get(kind, '')
    label = '[COLOR %s]%s[/COLOR]  %s' % (col, tag, c.get('title') or c.get('username') or '')
    if c.get('verified'):
        label += ' ' + TICK
    extra = []
    if c.get('username'):
        extra.append('@%s' % c['username'])
    if c.get('members'):
        n = int(c['members'])
        extra.append('%.1fM' % (n / 1e6) if n >= 1000000 else ('%dK' % (n // 1000) if n >= 1000 else str(n)))
    if extra:
        label += '  [COLOR gray]%s[/COLOR]' % DOT.join(extra)
    if c.get('joined'):
        label += '  [COLOR lime]%s[/COLOR]' % L(30120)
    if state:
        label += '  ' + state
    return label


def _bot_ctx(ref, title='', username='', bot_id=None):
    q = dict(bot=ref, title=title, username=username or '', id=bot_id)
    return [(L(30111), 'Container.Update(%s)' % url(mode='bot_ask', bot=ref)),
            (L(30114), 'RunPlugin(%s)' % url(mode='bot_mark', on=1, **q)),
            (L(30115), 'RunPlugin(%s)' % url(mode='bot_mark', on=0, **q)),
            (L(30116), 'RunPlugin(%s)' % url(mode='bot_mark', **q))]


def dialogs(_):
    try:
        chats = rpc.call('dialogs')
    except rpc.RPCError as exc:
        return _rpc_fail(exc)
    for c in chats:
        ctx = [(L(30043), 'Container.Update(%s)' % url(mode='chat', chat=c['id'], search=1))]
        q = {'mode': 'chat', 'chat': c['id']}
        if c.get('kind') == 'bot':
            q['bot'] = c.get('username') or c['id']
            ctx += _bot_ctx(c.get('username') or c['id'], c.get('title'), c.get('username'), c['id'])
        ctx.append((L(30044), 'RunPlugin(%s)' % url(mode='leave', chat=c['id'])))
        add_dir(_chat_label(c), q, context=ctx)
    end(cache=False)


def chat(p):
    query = None
    if p.get('search'):
        query = _ask()
        if not query:
            return end()
    ref = p['chat']
    try:
        res = rpc.call('chat_videos', chat_id=ref, offset=int(p.get('offset', 0)), query=query)
    except rpc.RPCError as exc:
        return _rpc_fail(exc)
    if not p.get('offset') and not query:
        if p.get('bot'):
            add_dir('[COLOR FFFFB74D]%s[/COLOR]' % L(30111), {'mode': 'bot_ask', 'bot': p['bot']})
        add_dir(L(30043), {'mode': 'chat', 'chat': ref, 'search': 1})
    show_files(res['items'])
    if res.get('next'):
        add_dir(L(30047), {'mode': 'chat', 'chat': ref, 'offset': res['next'], 'bot': p.get('bot')})
    end('videos', cache=False)


# ------------------------------------------------------------------ bots (3.3.3)
def bots(p):
    try:
        rows = rpc.call('bot_list', refresh=bool(p.get('refresh')), timeout=150)
    except rpc.RPCError as exc:
        return _rpc_fail(exc)
    states = {'on': '[COLOR lime]%s[/COLOR]' % L(30130), 'auto': '[COLOR FF4FC3F7]%s[/COLOR]' % L(30131),
              'off': '[COLOR gray]%s[/COLOR]' % L(30132)}
    for b in rows:
        ref = b.get('username') or b.get('id')
        st = b.get('stats') or {}
        state = states.get(b.get('state') or '', '')
        if st.get('asked'):
            state += '  [COLOR gray]%s[/COLOR]' % Lf(30146, st.get('asked', 0), st.get('files', 0))
        row = dict(b, kind='bot')
        ctx = _bot_ctx(ref, b.get('title'), b.get('username'), b.get('id'))
        if b.get('id'):
            add_dir(_chat_label(row, state), {'mode': 'chat', 'chat': b['id'], 'bot': ref}, context=ctx)
        else:
            add_dir(_chat_label(row, state), {'mode': 'bot_ask', 'bot': ref}, context=ctx)
    if not rows:
        add_dir('[COLOR orange]%s[/COLOR]' % L(30139), {'mode': 'discover', 'preset': 0})
    add_dir(L(30147), {'mode': 'discover', 'preset': 0})
    add_dir(L(30138), {'mode': 'bots', 'refresh': 1})
    end(cache=False)


def bot_mark(p):
    on = None if p.get('on') in (None, '') else p.get('on') == '1'
    try:
        rpc.call('bot_mark', bot=p.get('bot'), on=on, title=p.get('title') or '', username=p.get('username') or '',
                 id=int(p['id']) if (p.get('id') or '').lstrip('-').isdigit() else None)
        common.notify(L(30130 if on else (30132 if on is False else 30131)))
        xbmc.executebuiltin('Container.Refresh')
    except rpc.RPCError as exc:
        common.notify(str(exc)[:150])


def _bot_join_row(stats):
    links = (stats or {}).get('bot_join') or []
    if links:
        add_dir('[COLOR orange]%s[/COLOR]' % Lf(30124, ', '.join(x.split('/')[-1] for x in links[:3])),
                {'mode': 'join', 'link': ','.join(links[:3])}, folder=False)


def bot_ask(p, _again=False):
    bot = p.get('bot') or _ask(30045)
    if not bot:
        return end()
    q = p.get('q') or _ask(30111)
    if not q:
        return end()
    dlg = xbmcgui.DialogProgress()
    dlg.create(common.ADDON_NAME, '%s\n%s' % (L(30121), q))
    try:
        res = rpc.call('bot_ask', bot=bot, query=q, timeout=75)
    except rpc.RPCError as exc:
        dlg.close()
        return _rpc_fail(exc)
    dlg.close()
    files = res.get('files') or []
    if not files and res.get('join') and not _again:
        names = ', '.join(x.split('/')[-1] for x in res['join'][:3])
        if xbmcgui.Dialog().yesno(common.ADDON_NAME, Lf(30125, names)):
            for link in res['join'][:3]:
                try:
                    rpc.call('join', link=link)
                except rpc.RPCError as exc:
                    common.notify(str(exc)[:150])
            return bot_ask(dict(p, bot=bot, q=q), True)
    if not files:
        why = L(30123) if res.get('answered') else L(30122)
        note = (res.get('notes') or [''])[0]
        xbmcgui.Dialog().ok(common.ADDON_NAME, '%s\n%s' % (why, note or res.get('error') or ''))
    show_files(files)
    end('videos', cache=False)


DISCOVER_PRESETS = (
    (30140, ['movies bot', 'filter bot', u'סרטים בוט', 'series bot',
             u'фильмы бот']),
    (30141, [u'סרטים', u'סדרות',
             u'סרטים וסדרות',
             u'תרגום מובנה', u'מדובב']),
    (30142, [u'фильмы', u'сериалы',
             u'кино', u'новинки кино']),
    (30143, ['movies', 'series', 'tv shows', 'movies hd', 'cinema']),
    (30144, [u'סרטי ילדים', u'מדובבים',
             u'мультфильмы', 'cartoons', 'kids movies']),
)


def discover(p):
    """3.3.3: a menu (text search, Telegram's "similar channels", ready topic searches); results hold channels,
    groups AND bots, ranked, with what the account already has marked. A public channel opens without joining."""
    if not (p.get('q') or p.get('ask') or p.get('similar') or p.get('preset') is not None):
        add_dir(L(30113), {'mode': 'discover', 'ask': 1})
        add_dir(L(30112), {'mode': 'discover', 'similar': 1})
        for i, (sid, _) in enumerate(DISCOVER_PRESETS):
            add_dir(L(sid), {'mode': 'discover', 'preset': i})
        return end(cache=False)
    try:
        if p.get('similar'):
            rows = rpc.call('similar', chats=[p['chats']] if p.get('chats') else None, timeout=120)
        else:
            if p.get('preset') is not None:
                queries = DISCOVER_PRESETS[max(0, min(len(DISCOVER_PRESETS) - 1, int(p['preset'])))][1]
            else:
                q = p.get('q') or _ask(30041)
                if not q:
                    return end()
                queries = [q] + ([q + ' bot'] if 'bot' not in q.lower() else [])
            rows = rpc.call('discover', query=queries, timeout=90)
    except (rpc.RPCError, ValueError) as exc:
        return _rpc_fail(exc)
    for c in rows:
        ref = c.get('username') or (c['id'] if c.get('joined') else None)
        if not ref:
            continue                             # a private chat that was not joined cannot be opened
        if c.get('kind') == 'bot':
            ctx = _bot_ctx(ref, c.get('title'), c.get('username'), None)
            add_dir(_chat_label(c), {'mode': 'bot_ask', 'bot': ref}, context=ctx)
        else:
            ctx = [(L(30129), 'RunPlugin(%s)' % url(mode='join', link=ref)),
                   (L(30126), 'RunPlugin(%s)' % url(mode='pin', chat=ref)),
                   (L(30043), 'Container.Update(%s)' % url(mode='chat', chat=ref, search=1)),
                   (L(30112), 'Container.Update(%s)' % url(mode='discover', similar=1, chats=ref))]
            add_dir(_chat_label(c), {'mode': 'chat', 'chat': ref}, context=ctx)
    if not rows:
        common.notify(L(30078))
    end(cache=False)


def pin(p):
    """Adds a public channel to the chats that every search looks into - without joining it."""
    ref = (p.get('chat') or '').strip()
    if not ref:
        return
    cur = [x.strip() for x in common.setting('pinned_chats', '').split(',') if x.strip()]
    if ref.lstrip('@').lower() not in [x.lstrip('@').lower() for x in cur]:
        cur.append(ref if ref.lstrip('-').isdigit() else '@' + ref.lstrip('@'))
        common.set_setting('pinned_chats', ','.join(cur))
    common.notify(L(30127))


def join(p):
    link = p.get('link') or _ask(30045)
    if not link:
        return
    ok = 0
    for one in [x for x in link.split(',') if x.strip()]:
        try:
            rpc.call('join', link=one.strip())
            ok += 1
        except rpc.RPCError as exc:
            common.notify(str(exc))
    if ok:
        common.notify(L(30046))


def leave(p):
    if xbmcgui.Dialog().yesno(common.ADDON_NAME, L(30044) + '?'):
        try:
            rpc.call('leave', chat_id=int(p['chat']))
            xbmc.executebuiltin('Container.Refresh')
        except rpc.RPCError as exc:
            common.notify(str(exc))


# ------------------------------------------------------------------ Chiko Media
def chiko(p):
    try:
        res = rpc.call('chiko_chats', refresh=bool(p.get('refresh')), timeout=90)
    except rpc.RPCError as exc:
        return _rpc_fail(exc)
    found = False
    for backend in ('tg', 'telemedia'):
        for c in res.get(backend) or []:
            found = True
            tag = '' if backend == 'tg' else ' [COLOR gray](Telemedia)[/COLOR]'
            ctx = [(L(30043), 'Container.Update(%s)' % url(mode='chiko_chat', backend=backend, chat=c['id'], search=1))]
            add_dir(c['title'] + tag, {'mode': 'chiko_chat', 'backend': backend, 'chat': c['id']}, context=ctx)
    if not found:
        add_dir('[COLOR orange]%s[/COLOR]' % L(30098), {'mode': 'join'}, folder=False)
    add_dir(L(30042), {'mode': 'join'}, folder=False)
    add_dir(L(30099), {'mode': 'chiko', 'refresh': 1})
    end(cache=False)


def chiko_chat(p):
    query = None
    if p.get('search'):
        query = _ask()
        if not query:
            return end()
    try:
        res = rpc.call('chiko_browse', backend=p.get('backend'), chat_id=int(p['chat']),
                       offset=int(p.get('offset', 0)), query=query)
    except rpc.RPCError as exc:
        return _rpc_fail(exc)
    show_files(res['items'])
    if res.get('next'):
        add_dir(L(30047), {'mode': 'chiko_chat', 'backend': p.get('backend'), 'chat': p['chat'], 'offset': res['next']})
    end('videos', cache=False)


def playurl(p):
    li = common.make_listitem(p.get('name') or 'Telegram', path=p['u'])
    li.setContentLookup(False)
    xbmcplugin.setResolvedUrl(HANDLE, True, li)


# ------------------------------------------------------------------ account
def account(_):
    try:
        st = rpc.call('status', timeout=30)
    except rpc.RPCError as exc:
        st = {'error': str(exc)}
    if st.get('authorized') and st.get('me'):
        add_dir(Lf(30060, st['me']['name']), {'mode': 'status'}, folder=False)
        add_dir(L(30052), {'mode': 'logout'}, folder=False)
    else:
        add_dir(L(30050), {'mode': 'login', 'how': 'phone'}, folder=False)
        add_dir(L(30051), {'mode': 'login', 'how': 'qr'}, folder=False)
    add_dir(L(30053), {'mode': 'status'}, folder=False)
    add_dir(L(30054), {'mode': 'ai_test'}, folder=False)
    add_dir(L(30055), {'mode': 'clear_cache'}, folder=False)
    add_dir(L(30056), {'mode': 'reinstall'}, folder=False)
    try:
        rd = rpc.call('rd_status', timeout=20)
    except rpc.RPCError:
        rd = {}
    if rd.get('logged_in') and rd.get('username'):
        add_dir('[COLOR gold]Real-Debrid[/COLOR]  %s' % Lf(30173, rd['username'], rd.get('days', 0)),
                {'mode': 'rd_status'}, folder=False)
        add_dir(L(30174), {'mode': 'rd_logout'}, folder=False)
    elif rd.get('logged_in'):
        add_dir('[COLOR orange]Real-Debrid: %s[/COLOR]' % common.scrub(rd.get('error') or '')[:60],
                {'mode': 'rd_login'}, folder=False)
    else:
        add_dir('[COLOR gold]Real-Debrid[/COLOR]  ' + L(30175), {'mode': 'rd_login'}, folder=False)
    add_dir(L(30150), {'mode': 'config_export'}, folder=False)       # 3.3.4
    add_dir(L(30151), {'mode': 'config_import'}, folder=False)
    if xbmc.getCondVisibility('System.HasAddon(plugin.video.nova)'):  # 4.0.4: the hub's one screen for every service
        add_dir('[COLOR gold]%s[/COLOR]' % L(30177), {'mode': 'hub_go', 'to': 'accounts'}, folder=False)
        add_dir('[COLOR gold]%s[/COLOR]' % L(30178), {'mode': 'hub_go', 'to': 'backup'}, folder=False)
    end(cache=False)


# ------------------------------------------------------------------ Real-Debrid login (3.3.4)
def rd_login(_):
    """RD's device login: the viewer opens real-debrid.com/device on any phone / computer and types the code."""
    try:
        d = rpc.call('rd_device_start', timeout=30)
    except rpc.RPCError as exc:
        xbmcgui.Dialog().ok('Real-Debrid', common.scrub(exc)[:200])
        return
    dlg = xbmcgui.DialogProgress()
    dlg.create('Real-Debrid', Lf(30176, d['url'], d['user_code']))
    end = time.time() + min(int(d.get('expires_in') or 600), 900)
    ok = False
    try:
        while time.time() < end and not dlg.iscanceled():
            left = int(end - time.time())
            dlg.update(int(100 - 100.0 * left / max(1, d.get('expires_in') or 600)), Lf(30176, d['url'], d['user_code']))
            xbmc.sleep(max(2, int(d.get('interval') or 5)) * 1000)
            try:
                if rpc.call('rd_device_poll', device_code=d['device_code'], timeout=30).get('ok'):
                    ok = True
                    break
            except rpc.RPCError as exc:
                common.log('rd login poll: %s' % exc)
    finally:
        dlg.close()
    if ok:
        st = rpc.call('rd_status', fresh=1, timeout=20)
        xbmcgui.Dialog().ok('Real-Debrid', Lf(30173, st.get('username', ''), st.get('days', 0)))
        xbmc.executebuiltin('Container.Refresh')


def rd_logout(_):
    if xbmcgui.Dialog().yesno('Real-Debrid', L(30174) + '?'):
        rpc.call('rd_logout')
        xbmc.executebuiltin('Container.Refresh')


def rd_status(_):
    st = rpc.call('rd_status', fresh=1, timeout=20)
    if st.get('error'):
        xbmcgui.Dialog().ok('Real-Debrid', common.scrub(st['error'])[:200])
    else:
        xbmcgui.Dialog().ok('Real-Debrid', Lf(30173, st.get('username', ''), st.get('days', 0)))


# ------------------------------------------------------------------ configuration file (3.3.4)
def _vfs_write(path, data):
    import xbmcvfs
    fh = xbmcvfs.File(path, 'w')
    try:
        ok = fh.write(bytearray(data))
    finally:
        fh.close()
    if not ok or not xbmcvfs.exists(path):
        raise IOError('write failed')
    st = xbmcvfs.Stat(path)
    if st.st_size() != len(data):
        raise IOError('written %d of %d bytes' % (st.st_size(), len(data)))


def _vfs_read(path):
    import xbmcvfs
    fh = xbmcvfs.File(path)
    try:
        return bytes(fh.readBytes())
    finally:
        fh.close()


def config_export(_):
    import base64
    dlg = xbmcgui.Dialog()
    # the file holds the Telegram login: the owner is told so, and offered a password, before anything is written
    if not dlg.yesno(common.ADDON_NAME, L(30152), nolabel=L(30153), yeslabel=L(30154)):
        return
    password = ''
    if dlg.yesno(common.ADDON_NAME, L(30155)):
        password = dlg.input(L(30156), option=xbmcgui.ALPHANUM_HIDE_INPUT)
        if not password:
            return
        if dlg.input(L(30157), option=xbmcgui.ALPHANUM_HIDE_INPUT) != password:
            dlg.ok(common.ADDON_NAME, L(30158))
            return
    folder = dlg.browse(3, L(30159), 'files')
    if not folder:
        return
    try:
        res = rpc.call('config_export', password=password, timeout=60)
        path = folder.rstrip('/\\') + ('\\' if '\\' in folder and '/' not in folder else '/') + res['name']
        _vfs_write(path, base64.b64decode(res['data']))
    except (rpc.RPCError, IOError, OSError) as exc:
        dlg.ok(common.ADDON_NAME, '%s\n%s' % (L(30160), common.scrub(exc)[:200]))
        return
    dlg.ok(common.ADDON_NAME, '%s\n%s\n%s' % (L(30161), path, L(30162) if res.get('session') else L(30163)))


def config_import(_):
    import base64
    from . import configio
    dlg = xbmcgui.Dialog()
    path = dlg.browse(1, L(30151), 'files', configio.EXT)
    if not path:
        return
    try:
        blob = _vfs_read(path)
        head = configio.header(blob)[0]
    except Exception:
        dlg.ok(common.ADDON_NAME, L(30164))
        return
    password = ''
    if head.get('encrypted'):
        password = dlg.input(L(30156), option=xbmcgui.ALPHANUM_HIDE_INPUT)
        if not password:
            return
    when = time.strftime('%d/%m/%Y %H:%M', time.localtime(int(head.get('created') or 0)))
    if not dlg.yesno(common.ADDON_NAME, Lf(30165, when)):
        return
    try:
        res = rpc.call('config_import', data=base64.b64encode(blob).decode('ascii'), password=password, timeout=120)
    except rpc.RPCError as exc:
        msg = str(exc)
        text = L(30166) if 'wrong_password' in msg else (L(30164) if ('damaged' in msg or 'not_a_config' in msg
                                                                      or 'unsupported' in msg) else msg[:200])
        dlg.ok(common.ADDON_NAME, text)
        return
    if res.get('authorized') and res.get('me'):
        dlg.ok(common.ADDON_NAME, '%s\n%s' % (L(30167), Lf(30060, res['me'].get('name') or '')))
    else:
        dlg.ok(common.ADDON_NAME, '%s\n%s' % (L(30167), L(30168)))
    xbmc.executebuiltin('Container.Refresh')


def hub_go(p):
    """4.0.4: the hub's services screen / setup backup, reachable from the engine's own account screen"""
    if p.get('to') == 'backup':
        xbmc.executebuiltin('RunPlugin(plugin://plugin.video.nova/?a=svc&do=backup)')
    else:
        xbmc.executebuiltin('ActivateWindow(Videos,plugin://plugin.video.nova/?a=accounts,return)')


def _rpc_fail(exc):
    msg = str(exc)
    if 'not_configured' in msg:
        xbmcgui.Dialog().ok(common.ADDON_NAME, L(30062))
    elif 'service_down' in msg:
        xbmcgui.Dialog().ok(common.ADDON_NAME, L(30064))
    elif 'authoriz' in msg.lower() or 'AuthKey' in msg:
        xbmcgui.Dialog().ok(common.ADDON_NAME, L(30063))
    else:
        common.notify(msg[:200])
    end()


class QRWindow(xbmcgui.WindowDialog):
    def __init__(self, qr_url):
        super(QRWindow, self).__init__()
        img = 'https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=20&data=' + quote(qr_url, safe='')
        self.addControl(xbmcgui.ControlImage(390, 100, 500, 500, img))
        self.addControl(xbmcgui.ControlLabel(140, 620, 1000, 60, L(30061), alignment=2))
        self.closed = False

    def onAction(self, action):
        if action.getId() in (9, 10, 92, 216, 247, 257, 275, 61467, 61448):
            self.closed = True
            self.close()


def login(p):
    try:
        if p.get('how') == 'qr':
            res = rpc.call('qr_start')
            win = QRWindow(res['url'])
            win.show()
            ok = False
            needs_pw = False
            deadline = time.time() + 180
            while not win.closed and time.time() < deadline:
                r = rpc.call('qr_wait', timeout=30)
                if r.get('ok'):
                    ok = True
                    break
                if r.get('password'):
                    needs_pw = True
                    break
                if r.get('url'):
                    win.close()
                    win = QRWindow(r['url'])
                    win.show()
            win.close()
            if needs_pw:
                ok = _password()
        else:
            phone = xbmcgui.Dialog().input(L(30057), common.setting('phone'), type=xbmcgui.INPUT_ALPHANUM)
            if not phone:
                return
            common.set_setting('phone', phone)
            rpc.call('send_code', phone=phone)
            code = xbmcgui.Dialog().input(L(30058), type=xbmcgui.INPUT_NUMERIC)
            if not code:
                return
            r = rpc.call('sign_in', code=code)
            ok = r.get('ok') or (r.get('password') and _password())
        if ok:
            st = rpc.call('status')
            common.notify(Lf(30060, ((st.get('me')) or {}).get('name') or ''))
            xbmc.executebuiltin('Container.Refresh')
    except rpc.RPCError as exc:
        xbmcgui.Dialog().ok(common.ADDON_NAME, str(exc))


def _password():
    pw = xbmcgui.Dialog().input(L(30059), option=xbmcgui.ALPHANUM_HIDE_INPUT)
    if not pw:
        return False
    return bool(rpc.call('sign_in_password', password=pw).get('ok'))


def logout(_):
    if xbmcgui.Dialog().yesno(common.ADDON_NAME, L(30052) + '?'):
        rpc.call('logout')
        common.notify(L(30066))
        xbmc.executebuiltin('Container.Refresh')


def status(_):
    try:
        st = rpc.call('status', timeout=30)
    except rpc.RPCError as exc:
        st = {'error': str(exc)}
    lines = ['%s %s' % (common.ADDON_NAME, common.ADDON_VERSION), 'Kodi %d' % common.KODI_MAJOR]
    for k in ('connected', 'authorized', 'telemedia_bridge', 'stremio_servers', 'deps', 'crypto', 'ai', 'tmdb', 'error'):
        if k in st:
            lines.append('%s: %s' % (k, st[k]))
    if st.get('me'):
        lines.append('user: %s (@%s) premium=%s' % (st['me']['name'], st['me'].get('username'), st['me'].get('premium')))
    if st.get('versions'):
        lines.append('modules: %s' % ', '.join('%s %s' % kv for kv in st['versions'].items()))
    if st.get('stream'):
        s = st['stream']
        lines.append('stream: %.1f MB/s avg, cache %d MB, hits %d / miss %d' % (
            s['speed'] / 1048576.0, s['cached_mb'], s['hits'], s['miss']))
    xbmcgui.Dialog().textviewer(common.ADDON_NAME, '\n'.join(lines))


def ai_test(_):
    try:
        r = rpc.call('ai_test', timeout=60)
        xbmcgui.Dialog().ok('Gemini', 'OK - %s' % r.get('model') if r.get('ok') else 'FAILED: %s' % r.get('error'))
    except rpc.RPCError as exc:
        xbmcgui.Dialog().ok('Gemini', 'FAILED: %s' % exc)


def clear_cache(_):
    rpc.call('clear_cache')
    common.notify(L(30065))


def reinstall(_):
    dlg = xbmcgui.DialogProgressBG()
    dlg.create(common.ADDON_NAME, L(30900))
    try:
        rpc.call('reinstall_deps', timeout=300)
        common.notify(L(30065))
    except rpc.RPCError as exc:
        xbmcgui.Dialog().ok(common.ADDON_NAME, str(exc))
    finally:
        dlg.close()


# ------------------------------------------------------------------ playback
def _source_label(s):
    """First line of a source row: what you get (quality, picture, languages), how big, and whether the link was
    tested. 3.3.3: colour by quality, real data read from the file marked with a tick."""
    parts = []
    if s.get('chiko'):
        parts.append('[COLOR gold]%s[/COLOR]' % L(30009))
    parts.append(_q_tag(s.get('quality')))
    tech = [str(x) for x in [s.get('codec'), 'HDR' if s.get('hdr') else '', (s.get('source') or '').upper()] if x]
    if tech:
        parts.append(' '.join(tech))
    tags = _lang_tags(s)
    if tags:
        parts.append('[COLOR cyan]%s[/COLOR]' % ' / '.join(tags))
    parts.append(common.human_size(s.get('size')))
    if s.get('duration'):
        parts.append(common.human_duration(s['duration']))
    parts.append(_status_tag(s))
    if s.get('loose'):
        parts.append('[COLOR orange]%s ?[/COLOR]' % L(30133))
    elif s.get('match'):
        parts.append('[COLOR FF8D99AE]%s %d%%[/COLOR]' % (L(30133), s['match']))
    if s.get('ai') and s['ai'].get('match'):
        parts.append('[COLOR violet]%s %d%%[/COLOR]' % (L(30097), int(s['ai'].get('confidence', 0) * 100)))
    return DOT.join(parts)


def _source_line2(s):
    """Second line: where it comes from (bot / channel / group and its name), then the file name."""
    where = _where(s)
    if s.get('via_bot') and s.get('chat_kind') != 'bot':
        where = '%s @%s' % (L(30137), s['via_bot'])
    if s.get('backend') == 'rd':
        where = s.get('chat_title') or 'Real-Debrid'
    return DOT.join(x for x in [where, s.get('file') or ''] if x)


def _checks_text(stats):
    ch = (stats or {}).get('checks') or {}
    if not ch.get('tested'):
        return ''
    return Lf(30136, ch.get('tested', 0), ch.get('ok', 0), ch.get('dead', 0) + ch.get('wrong', 0))


def _wait_job(job_id, title):
    dlg = xbmcgui.DialogProgress()
    dlg.create(common.ADDON_NAME, '%s\n%s' % (L(30070), title))
    try:
        while True:
            st = rpc.call('find_status', job=job_id, timeout=30)
            dlg.update(int(st.get('progress') or 0), '%s\n%s' % (title, L(STAGES.get(st.get('stage'), 30070))))
            if st.get('done'):
                if st.get('error'):
                    raise rpc.RPCError(st['error'])
                global LAST_STATS
                LAST_STATS = st.get('stats') or {}
                return st.get('result') or []
            if dlg.iscanceled():
                rpc.call('find_cancel', job=job_id)
                return None
            xbmc.sleep(200)
    finally:
        dlg.close()


def play(p):
    target = {'type': p.get('type'), 'title': p.get('title'), 'year': int(p['year']) if p.get('year') else None,
              'tmdb': p.get('tmdb'), 'imdb': p.get('imdb'), 'refresh': bool(p.get('refresh'))}
    title = target['title'] or ''
    if p.get('type') == 'tv':
        target.update(season=int(p['season']), episode=int(p['episode']), episode_runtime=int(p.get('ert') or 0))
        title = '%s S%02dE%02d' % (title, target['season'], target['episode'])
    try:
        job = rpc.call('find_start', target=target)
        sources = _wait_job(job, title)
    except rpc.RPCError as exc:
        _rpc_fail_play(exc)
        return
    if sources is None:
        return _resolve_fail()
    if not sources:
        st = LAST_STATS
        links = st.get('bot_join') or []
        if links and not p.get('_joined'):
            # 3.3.3: a bot has the title but wants a channel joined first - one question instead of a dead end
            names = ', '.join(x.split('/')[-1] for x in links[:3])
            if xbmcgui.Dialog().yesno(common.ADDON_NAME, Lf(30125, names)):
                for link in links[:3]:
                    try:
                        rpc.call('join', link=link)
                    except rpc.RPCError as exc:
                        common.notify(str(exc)[:150])
                return play(dict(p, refresh='1', _joined='1'))
        why = L(30100) if not st.get('raw') else Lf(30101, st.get('raw', 0))
        asked = ', '.join(b['bot'] for b in st.get('bots') or [])
        if asked:
            why += '\n%s: %s' % (L(30110), asked)
        xbmcgui.Dialog().ok(common.ADDON_NAME, '%s\n%s\n%s' % (L(30078), title, why))
        return _resolve_fail()
    autoplay = common.setting_bool('autoplay', False) and not p.get('select')
    choice = 0
    if not autoplay or sources[0].get('probe') != 'ok':
        items = []
        for s in sources:
            li = common.make_listitem(_source_label(s), _source_line2(s))
            li.setArt({'icon': common.ICON, 'thumb': common.ICON})
            items.append(li)
        head = '%s - %d %s' % (L(30079), len(sources), L(30083))
        checks = _checks_text(LAST_STATS)
        if checks:
            head += DOT + checks
        choice = xbmcgui.Dialog().select(head, items, useDetails=True)
        if choice < 0:
            return _resolve_fail()
    want = {'season': target.get('season'), 'episode': target.get('episode')}
    path = None
    for k in range(choice, min(len(sources), choice + 4)):
        s = sources[k]
        if s.get('backend') != 'rd':
            path = s.get('url') or rpc.stream_url(s['chat_id'], s['msg_id'], s.get('file'))
            break
        try:
            path = _rd_resolve(s, want)
            break
        except rpc.RPCError as exc:           # 3.3.4: the next source is tried, the viewer only sees a notice
            common.log('rd: %s failed: %s' % (s.get('file'), exc))
            common.notify('%s - %s' % (L(30172), common.scrub(exc)[:80]))
            if k + 1 >= len(sources):
                return _resolve_fail()
    if not path:
        return _resolve_fail()
    li = common.make_listitem(title, path=path)
    info = {'title': p.get('title'), 'year': target.get('year'), 'mediatype': 'movie' if p.get('type') == 'movie' else 'episode'}
    if p.get('type') == 'tv':
        info.update(tvshowtitle=p.get('title'), season=target['season'], episode=target['episode'])
    common.set_video_info(li, info)
    li.setContentLookup(False)
    xbmcplugin.setResolvedUrl(HANDLE, True, li)


def _rd_resolve(s, want=None):
    cand = {'url': s.get('url'), 'rd': s.get('rd'), 'file': s.get('file')}
    dlg = xbmcgui.DialogProgressBG()
    dlg.create('Real-Debrid', s.get('file') or '')
    try:
        return rpc.call('rd_resolve', cand=cand, want=want or {}, timeout=40)['url']
    finally:
        dlg.close()


def playrd(p):
    """Real-Debrid item of the embedding listing: resolved when it is played."""
    try:
        s = json.loads(p.get('s') or '{}')
        want = {'season': int(p['season']) if p.get('season') else None,
                'episode': int(p['episode']) if p.get('episode') else None}
        path = _rd_resolve(s, want)
    except (rpc.RPCError, ValueError, KeyError) as exc:
        common.notify('%s - %s' % (L(30172), common.scrub(exc)[:80]))
        return _resolve_fail()
    li = common.make_listitem(p.get('name') or 'Real-Debrid', path=path)
    li.setContentLookup(False)
    xbmcplugin.setResolvedUrl(HANDLE, True, li)


def _rpc_fail_play(exc):
    msg = str(exc)
    if 'not_configured' in msg or 'no_backend' in msg:
        xbmcgui.Dialog().ok(common.ADDON_NAME, L(30062))
    elif 'service_down' in msg:
        xbmcgui.Dialog().ok(common.ADDON_NAME, L(30064))
    elif 'not_authorized' in msg:              # 3.3: logged out - "join channels" was the wrong advice
        xbmcgui.Dialog().ok(common.ADDON_NAME, L(30063))
    else:
        xbmcgui.Dialog().ok(common.ADDON_NAME, msg[:300])
    _resolve_fail()


def _resolve_fail():
    if HANDLE >= 0:
        xbmcplugin.setResolvedUrl(HANDLE, False, common.make_listitem(''))


def playtg(p):
    try:
        li = common.make_listitem(p.get('name') or 'Telegram',
                                  path=rpc.stream_url(int(p['chat']), int(p['msg']), p.get('name')))
    except rpc.RPCError as exc:
        return _rpc_fail_play(exc)
    li.setContentLookup(False)
    xbmcplugin.setResolvedUrl(HANDLE, True, li)


def settings(_):
    common.ADDON.openSettings()


# ------------------------------------------------------------------ embedding API (NovaTV hub / other add-ons)
def _plain_label(s, title):
    q = s.get('quality') or 0
    bits = [title, '%dp' % q if q else '', common.human_size(s.get('size'))]
    langs = set(s.get('langs') or [])
    if langs & {'he_dub'}:
        bits.append(L(30094))
    elif langs & {'he_sub'}:
        bits.append(L(30093))
    if 'ru_audio' in langs:
        bits.append(L(30095))
    if s.get('chiko'):
        bits.append(L(30009))
    if s.get('chat_kind') == 'bot':
        bits.append(L(30117))
    if s.get('loose'):
        bits.append('?')
    elif s.get('probe') == 'ok':
        bits.append(u'\u2713')
    return ' | '.join(b for b in bits if b)


def hub(p):
    """Non-interactive listing for hubs that read this add-on as a directory (Files.GetDirectory):
    ?mode=hub&q=<free text>                       -> Telegram files for the text (episode text is matched exactly)
    ?mode=hub&type=movie|tv&tmdb=..[&season&episode][&title][&year]  -> verified sources for that exact title
    No dialogs are opened; an unavailable service simply yields an empty folder."""
    from .parser import parse as parse_name, find_se, title_part
    from . import matcher
    fast = {'search_timeout': 5, 'probe_timeout': 4, 'probe_count': 6, 'ai_verify': False, 'ai_aliases': False,
            'bot_request': False, 'probe_all': False,     # 3.3.3: a 10-second listing cannot wait for a bot
            'ai_alias_wait': 0, 'deep_timeout': 2.5}      # 3.3.5: ... nor for the AI; a short look inside the chats
    target, title = None, ''
    if p.get('tmdb') or p.get('imdb'):
        target = {'type': p.get('type') or 'movie', 'tmdb': p.get('tmdb'), 'imdb': p.get('imdb'),
                  'title': p.get('title') or '', 'year': int(p['year']) if (p.get('year') or '').isdigit() else None}
        if target['type'] == 'tv':
            target.update(season=int(p['season']), episode=int(p['episode']))
        if p.get('fast'):
            target['opts'] = fast
        title = target['title']
    else:
        q = (p.get('q') or '').strip()
        if not q:
            return end(cache=False)
        s_, e_, _ = find_se(q)
        if e_ is not None and s_ is not None:
            title = title_part(q) or q
            target = {'type': 'tv', 'title': title, 'season': s_, 'episode': e_, 'opts': fast}
    try:
        if target:
            if target['type'] == 'tv':
                title = '%s S%02dE%02d' % (title, target['season'], target['episode'])
            job = rpc.call('find_start', target=target, timeout=20)
            deadline = time.time() + (10.5 if target.get('opts') else 75)
            res = []
            while time.time() < deadline:
                st = rpc.call('find_status', job=job, timeout=15)
                if st.get('done'):
                    res = st.get('result') or []
                    break
                xbmc.sleep(300)
            else:
                rpc.call('find_cancel', job=job, timeout=10)
            for s in res:
                if s.get('backend') == 'rd':
                    path = url(mode='playrd', s={'url': s.get('url'), 'rd': s.get('rd'), 'file': s.get('file')},
                               name=s.get('file') or '', season=target.get('season'), episode=target.get('episode'))
                else:
                    path = s.get('url') or rpc.stream_url(s['chat_id'], s['msg_id'], s.get('file'))
                label = _plain_label(s, title or s.get('file') or '')
                li = common.make_listitem(label, path=path)
                li.setProperty('IsPlayable', 'true')
                common.set_art(li)
                common.set_video_info(li, {'title': label, 'plot': '%s\n%s' % (s.get('file') or '', s.get('chat_title') or ''),
                                           'duration': s.get('duration') or 0, 'mediatype': 'video'})
                xbmcplugin.addDirectoryItem(HANDLE, path, li, isFolder=False)
        else:
            import re
            q = p['q'].strip()
            ym = re.search(r'\s*\(?((?:19|20)\d{2})\)?$', q)
            want_year = int(ym.group(1)) if ym and len(q) > 6 else None
            if want_year:
                q = q[:ym.start()].strip()
            files = rpc.call('raw_search', query=q, limit=60, timeout=20)
            seen, rows = set(), []
            for c in files:
                key = (c['chat_id'], c['msg_id'])
                if key in seen or (c.get('size') or 0) < 40 * 1024 * 1024:
                    continue
                seen.add(key)
                pr = parse_name(c.get('file') or '', c.get('caption') or '')
                if pr.get('is_trailer') or pr.get('is_archive'):
                    continue
                if matcher.caption_trailer(pr, c.get('size') or 0, c.get('duration') or 0):
                    continue
                if want_year and pr.get('year') and abs(pr['year'] - want_year) > 1:
                    continue
                sc, _ = matcher.best_title_score(pr.get('titles') or [], [q])
                if matcher.contains_alias((c.get('file') or '') + ' ' + (c.get('caption') or ''), [q]):
                    sc = max(sc, 0.85)
                if sc < 0.6:
                    continue
                rows.append((sc, pr.get('quality') or 0, c, pr))
            rows.sort(key=lambda r: (-r[0], -r[1]))
            for sc, _, c, pr in rows[:30]:
                name = pr.get('titles') and pr['titles'][-1] or c.get('file')
                if pr.get('episode') is not None and pr.get('season') is not None:
                    name = '%s S%02dE%02d' % (name, pr['season'], pr['episode'])
                elif pr.get('year'):
                    name = '%s (%s)' % (name, pr['year'])
                label = ' | '.join(x for x in [name, '%dp' % pr['quality'] if pr.get('quality') else '',
                                                common.human_size(c.get('size'))] if x)
                path = c.get('url') or rpc.stream_url(c['chat_id'], c['msg_id'], c.get('file'))
                li = common.make_listitem(label, path=path)
                li.setProperty('IsPlayable', 'true')
                common.set_art(li)
                common.set_video_info(li, {'title': label, 'plot': '%s\n%s' % (c.get('file') or '', c.get('chat_title') or ''),
                                           'duration': c.get('duration') or 0, 'mediatype': 'video'})
                xbmcplugin.addDirectoryItem(HANDLE, path, li, isFolder=False)
    except Exception as exc:
        common.log('hub: %s' % exc)
    end('videos', cache=False)


MODES = {
    None: root, 'movies': movies, 'tvshows': tvshows, 'hebrew': hebrew, 'russian': russian, 'kids': kids,
    'genres': genres, 'years': years, 'list': list_, 'seasons': seasons, 'episodes': episodes,
    'search_menu': search_menu, 'search': search, 'ai_search': ai_search, 'tg_search': tg_search,
    'telegram': telegram, 'dialogs': dialogs, 'chat': chat, 'discover': discover, 'join': join, 'leave': leave,
    'account': account, 'login': login, 'logout': logout, 'status': status, 'ai_test': ai_test,
    'clear_cache': clear_cache, 'reinstall': reinstall, 'play': play, 'playtg': playtg, 'settings': settings,
    'chiko': chiko, 'chiko_chat': chiko_chat, 'playurl': playurl, 'hub': hub,
    'bots': bots, 'bot_ask': bot_ask, 'bot_mark': bot_mark, 'pin': pin,
    'config_export': config_export, 'config_import': config_import, 'hub_go': hub_go,
    'rd_login': rd_login, 'rd_logout': rd_logout, 'rd_status': rd_status, 'playrd': playrd,
}


def run(argv=None):
    global HANDLE, BASE
    argv = argv or sys.argv
    BASE = argv[0]
    HANDLE = int(argv[1]) if len(argv) > 1 and argv[1].lstrip('-').isdigit() else -1
    params = dict(parse_qsl(argv[2][1:])) if len(argv) > 2 and argv[2] else {}
    mode = params.get('mode')
    common.log('route %s %s' % (mode, params))
    func = MODES.get(mode, root)
    try:
        func(params)
    except Exception as exc:
        import traceback
        common.log_error(traceback.format_exc())                    # log_error removes API keys (common.scrub)
        common.notify('%s: %s' % (type(exc).__name__, common.scrub(exc)[:150]))
        # 3.3: Kodi waits (busy spinner until its timeout) for a directory / a resolved item that never comes
        try:
            if mode in ('play', 'playtg', 'playurl', 'playrd'):
                _resolve_fail()
            elif HANDLE >= 0:
                xbmcplugin.endOfDirectory(HANDLE, succeeded=False)
        except Exception:
            pass
