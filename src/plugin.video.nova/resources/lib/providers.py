# -*- coding: utf-8 -*-
"""NovaTV hub: every video add-on is a *provider* behind NovaTV.

Kodi only talks to NovaTV. NovaTV runs one query against all enabled providers at the
same time (TMDb/POV, Idan+, YouTube, Internet Archive, Dailymotion, Vimeo, TED, live
channels, radio ...) and shows one merged list. When POV finds no source for a title,
play_with_fallback() searches the other providers for the same title.

Only add-ons from the official Kodi repository (plus Idan+/POV that ship with the build).
Which providers are stable is decided by tools/provider_audit.py -> resources/providers_status.json.
"""
import json
import os
import re
import threading
import time
from urllib.parse import quote, quote_plus, urlencode

import xbmc
import xbmcgui

from .common import monitor
import xbmcplugin

from .common import T, ui_lang, load, save, log, ADDON_PATH, ADDON

# ------------------------------------------------------------------ registry
# id, add-on, (he, en, ru), category, search template ({q} = url-quoted query) or None = browse only
DM_API = ('https://api.dailymotion.com/videos?fields=description,duration,id,owner.username,taken_time,'
          'thumbnail_large_url,title,views_total&search={q}&sort=relevance&limit=25&family_filter=1&localization=en_EN&page=1')
PROVIDERS = [
    # 3.1: Telegram first; POV, its repository and the add-ons that gave no content were removed
    ('telescope', 'plugin.video.telescope', ('טלגרם – סרטים וסדרות (TeleScope AI, צ\'יקו מדיה)', 'Telegram – movies & series (TeleScope AI)',
                                             'Telegram – фильмы и сериалы (TeleScope AI)'), 'movies',
     'plugin://plugin.video.telescope/?mode=hub&q={q}'),     # 1.7.0: NovaTV's own Telegram engine, part of the build
    ('idanplus', 'plugin.video.idanplus', ('עידן+ – כאן, קשת, רשת, 14, 9', 'Idan+ – Israeli broadcasters', 'Idan+ – израильские каналы'), 'israel',
     'plugin://plugin.video.idanplus/?mode=4&url={q}'),
    ('youtube', 'plugin.video.youtube', ('YouTube', 'YouTube', 'YouTube'), 'video',
     'internal:yt'),        # NovaTV reads YouTube itself: the add-on needs personal API keys for lists
    ('archive', 'plugin.video.archive.org', ('Internet Archive – סרטים קלאסיים וסובייטיים', 'Internet Archive – classic & Soviet films', 'Internet Archive – классика и советское кино'), 'movies',
     'internal:ia'),        # NovaTV uses archive.org's API: the add-on's page scraper no longer plays
]
# NovaTV's own result groups: switched on/off in the same Sources screen as the add-ons
BUILTIN = [
    ('tmdb', ('סרטים וסדרות (TMDb)', 'Movies & series (TMDb)', 'Фильмы и сериалы (TMDb)')),
    ('live_tv', ('ערוצים חיים', 'Live channels', 'Прямые каналы')),
    ('radio', ('רדיו', 'Radio', 'Радио')),
]
CATS = [('israel', ('ישראל', 'Israel', 'Израиль')), ('russian', ('ברוסית', 'Russian', 'На русском')),
        ('movies', ('סרטים וסדרות', 'Movies & series', 'Фильмы и сериалы')), ('video', ('פלטפורמות וידאו', 'Video platforms', 'Видеоплатформы')),
        ('docs', ('תעודה ולימוד', 'Documentaries & learning', 'Документальное и обучение')), ('news', ('חדשות', 'News', 'Новости')),
        ('kids', ('ילדים', 'Kids', 'Детям')), ('sport', ('ספורט', 'Sport', 'Спорт')), ('music', ('מוזיקה', 'Music', 'Музыка')),
        ('live', ('ערוצים חיים (ארה"ב)', 'Free live channels (US)', 'Прямые каналы (США)'))]

# official Russian studio channels on YouTube (free, published by the rights holders)
RUSSIAN = [
    ('UCEK3tT7DcfWGWJpNEDBdWog', ('מוספילם – סרטים סובייטיים ורוסיים', 'Mosfilm – Soviet & Russian films', 'Мосфильм – советское и российское кино')),
    ('UCC2mTjSz2Hohl3zDBTCqF1Q', ('מוספילם לילדים', 'Mosfilm for kids', 'Мосфильм – для детей')),
    ('UCHS2LM1n3f5cyL-ebgkqyLw', ('סויוזמולטפילם – סרטים מצוירים', 'Soyuzmultfilm – animation', 'Союзмультфильм')),
    ('UC8p4E9GyMy-3OdLFx0GswTQ', ('סויוזמולטפילם לפעוטות', 'Soyuzmultfilm for toddlers', 'Союзмультфильм для мам и малышей')),
    ('UC5A-Wp9ujcr5g9sYagAafEA', ('סמשריקי', 'Smeshariki', 'Смешарики')),
    ('UCfU8IgesHohe5D8XkcY99Jw', ('בלרוספילם', 'Belarusfilm', 'Беларусьфильм')),
    ('UC4tlrTXCBw6NPZ9nCA3_s9w', ('קינופויסק – טריילרים וסקירות', 'Kinopoisk – trailers & reviews', 'Кинопоиск')),
    # "Непосредственно Каха" (owner, 06/10): the creators' own channel (the web series, 6 seasons) and their
    # production company KTV (full seasons "Женитьба", "Развод"). The two feature films are paid releases
    # (Kinopoisk / START / Okko) - YouTube copies come from unrelated channels, not added
    ('UCqg_YIWVnzRbeW0KBkuIcvA', ('קאחה – הסדרה (הערוץ הרשמי)', 'Kakha – the series (official)', 'Непосредственно Каха – официальный канал')),
    ('UCYFc8A8ZxeanxfBm4dyJUNg', ('קאחה – עונות מלאות (KTV)', 'Kakha – full seasons (KTV)', 'KTV – Непосредственно Каха')),
]

STATUS_FILE = os.path.join(ADDON_PATH, 'resources', 'providers_status.json')
S = {
    'hub_search': ('חיפוש בכל המקורות', 'Search all sources', 'Поиск по всем источникам'),
    'sources': ('מקורות ותוספים', 'Sources & add-ons', 'Источники и дополнения'),
    'searching': ('מחפש בכל המקורות...', 'Searching all sources...', 'Поиск по всем источникам...'),
    'more': ('עוד תוצאות מ-%s', 'More from %s', 'Ещё из %s'),
    'none': ('לא נמצא באף מקור', 'Not found in any source', 'Ничего не найдено'),
    'no_exact': ('אין התאמה מדויקת לעונה/פרק %s', 'No exact matches for %s', 'Нет точных совпадений для %s'),
    'pov_none': ('לא נמצאו מקורות ב-POV – מחפש בשאר המקורות', 'POV found no sources – searching all other sources',
                 'POV ничего не нашёл – ищу в остальных источниках'),
    'pick': ('נמצא במקורות נוספים', 'Found in other sources', 'Найдено в других источниках'),
    'on': ('פעיל', 'on', 'вкл'), 'off': ('כבוי', 'off', 'выкл'), 'not_inst': ('לא מותקן', 'not installed', 'не установлено'),
    'unstable': ('לא יציב כרגע', 'currently unstable', 'сейчас нестабильно'),
    'searchable': ('כלול בחיפוש', 'in search', 'в поиске'),
    'toggle': ('הפעל / כבה', 'Enable / disable', 'Вкл / выкл'), 'open': ('פתח', 'Open', 'Открыть'),
    'settings': ('הגדרות התוסף', 'Add-on settings', 'Настройки дополнения'),
    'install': ('התקן', 'Install', 'Установить'), 'install_all': ('התקן את כל המקורות היציבים', 'Install all stable sources', 'Установить все стабильные'),
    'live': ('ערוצים חיים', 'Live channels', 'Прямые каналы'), 'radio': ('רדיו', 'Radio', 'Радио'),
    'movies_series': ('סרטים וסדרות', 'Movies & series', 'Фильмы и сериалы'),
    'library': ('הספרייה המרכזית', 'Central library', 'Центральная библиотека'),
    'builtin': ('מקורות מובנים', 'Built-in sources', 'Встроенные источники'),
    'addons': ('תוספי וידאו', 'Video add-ons', 'Видеодополнения'),
    'all_on': ('הפעל הכל', 'Enable all', 'Включить все'), 'all_off': ('כבה הכל', 'Disable all', 'Выключить все'),
    'browse': ('עיון בלבד', 'browse only', 'только просмотр'),
    'tg': ('טלגרם', 'Telegram', 'Telegram'),
    'tg_src': ('מקורות טלגרם (בחירה)', 'Telegram sources (choose)', 'Источники Telegram (выбор)'),
    'tg_menu': ('טלגרם – TeleScope AI', 'Telegram – TeleScope AI', 'Telegram – TeleScope AI'),
    'tg_searching': ('מחפש בטלגרם ובודק קישורים...', 'Searching Telegram and testing links...', 'Поиск в Telegram и проверка ссылок...'),
}


def s(k):
    return S[k][{'he': 0, 'en': 1, 'ru': 2}[ui_lang()]]


def name_of(p):
    return p[2][{'he': 0, 'en': 1, 'ru': 2}[ui_lang()]]


CORE = {'telescope', 'idanplus', 'youtube', 'archive'}      # ship with the build; never hidden by the audit


# 3.3: read once per run - every list item asked telegram_on() -> is_on() -> both files again (providers.json and
# the 400-line providers_status.json, parsed 20-40 times for one page). forget() after anything that changes them
_MEMO = {}


def forget():
    _MEMO.clear()


def status():
    if 'status' in _MEMO:
        return _MEMO['status']
    try:
        with open(STATUS_FILE, encoding='utf-8') as f:
            st = json.load(f)
    except Exception:
        st = {}
    for pid in CORE:
        st.setdefault(pid, {})['stable'] = True
    _MEMO['status'] = st
    return st


def installed(addon_id):
    # installed AND enabled: calling a disabled add-on fails ("Unknown addon id")
    return xbmc.getCondVisibility('System.HasAddon(%s) + System.AddonIsEnabled(%s)' % (addon_id, addon_id))


def enabled_map():
    if 'enabled' not in _MEMO:
        m = load('providers.json', {})
        _MEMO['enabled'] = m if isinstance(m, dict) else {}
    return dict(_MEMO['enabled'])       # a copy: toggle() changes what it gets


def is_on(pid):
    """user switch; default on for providers the audit marked stable"""
    m = enabled_map()
    if pid in m:
        return bool(m[pid])
    st = status().get(pid)
    return st is None or st.get('stable', True)


def available(p):
    """Archive is searched and played by NovaTV itself (archive.org API): it needs no add-on"""
    return p[4] == 'internal:ia' or installed(p[1])


def search_targets():
    return [p for p in PROVIDERS if p[4] and is_on(p[0]) and available(p)]


def build_url(p, q):
    if p[4] == 'internal:yt':
        return 'plugin://plugin.video.nova/?' + urlencode({'a': 'yt_search', 'q': q})
    if p[4] == 'internal:ia':
        return 'plugin://plugin.video.nova/?' + urlencode({'a': 'ia_search', 'q': q})
    return p[4].format(q=quote(q), dm=quote_plus(DM_API.format(q=quote_plus(q))))


def ia_rows(items):
    return [{'label': ('%s (%s)' % (i['title'], i['year'])) if i['year'] else i['title'],
             'file': 'plugin://plugin.video.nova/?' + urlencode({'a': 'ia_item', 'id': i['id']}), 'filetype': 'directory',
             'thumbnail': i['thumb'], 'art': {'thumb': i['thumb'], 'poster': i['thumb']}, 'plot': i['plot']} for i in items]


def yt_rows(videos):
    from .yt import PLAY
    return [{'label': v['title'], 'file': PLAY % v['id'], 'filetype': 'file', 'thumbnail': v['thumb'],
             'art': {'thumb': v['thumb'], 'icon': v['thumb']},
             'plot': ' · '.join(x for x in (v.get('channel'), v.get('duration'), v.get('plot')) if x)} for v in videos]


# ------------------------------------------------------------------ JSON-RPC directory reads
def _rpc(method, **params):
    try:
        return json.loads(xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})))
    except Exception as e:
        return {'error': str(e)}


PROPS = ['title', 'thumbnail', 'art', 'plot', 'year', 'file']


def read_dir(path):
    r = _rpc('Files.GetDirectory', directory=path, media='video', properties=PROPS)
    return (r.get('result') or {}).get('files') or []


def _useful(items):
    """drop navigation / history / settings rows that search pages add around the results"""
    out = []
    for it in items:
        lab = re.sub(r'\[/?[A-Z]+[^\]]*\]', '', it.get('label') or '').strip()
        f = it.get('file') or ''
        if not lab or lab in ('..',) or re.search(r'(?i)(next page|nächste|history|היסטוריה|הגדרות|settings|new search|חיפוש חדש)', lab):
            continue
        if re.search(r'(?i)(search_history|/settings|action=clear|mode=History)', f):
            continue
        it['label'] = lab
        out.append(it)
    return out


# ------------------------------------------------------------------ hub search
def run_search(q, providers=None, per_timeout=12):
    """query every provider in parallel. returns [(provider, items)] in registry order"""
    providers = search_targets() if providers is None else providers
    results = {}
    gate = threading.Semaphore(5)          # each search starts a Python interpreter: spare small TV boxes

    def work(p):
        t = time.time()
        try:
            # YouTube / Archive are plain web requests in this process: they never wait for an interpreter slot
            if p[4] == 'internal:yt':
                from . import yt
                results[p[0]] = yt_rows(yt.search(q))
            elif p[4] == 'internal:ia':
                from . import ia
                results[p[0]] = ia_rows(ia.search(q))
            else:
                with gate:
                    results[p[0]] = _useful(read_dir(build_url(p, q)))
        except Exception as e:
            log('hub search %s: %s' % (p[0], e), xbmc.LOGWARNING)
            results[p[0]] = []
        log('hub search %s: %d items in %.1fs' % (p[0], len(results[p[0]]), time.time() - t))

    threads = [threading.Thread(target=work, args=(p,), daemon=True) for p in providers]
    for th in threads:
        th.start()
    deadline = time.time() + per_timeout
    for th in threads:
        th.join(max(0.1, deadline - time.time()))
    done = dict(results)            # snapshot: a provider answering after the deadline is ignored, never merged later
    return [(p, rank(done[p[0]], q)) for p in providers if done.get(p[0])]


def _words(text):
    return re.findall(r'\w+', re.sub(r'\[/?[A-Z]+[^\]]*\]', '', text or '').lower())


def rank(items, q):
    """titles that contain the whole query first, then those with every query word; the source's order otherwise"""
    qw = _words(q)
    if not qw:
        return items
    phrase = ' '.join(qw)

    def score(it):
        w = _words(it.get('label'))
        return 0 if phrase in ' '.join(w) else 1 if all(x in w for x in qw) else 2
    return sorted(items, key=score)          # stable: equal scores keep the source's own relevance order


def exact(found, want, show=''):
    """keep only results of the wanted season/episode (and show, when known); providers left with nothing are dropped"""
    from . import epmatch
    if want == (None, None):
        return found
    out = []
    for p, items in found:
        items = epmatch.filter_items(want, items, show=show)
        if items:
            out.append((p, items))
    return out


def se_label(want):
    return ' '.join(x for x in ('S%02d' % want[0] if want[0] is not None else '',
                                'E%02d' % want[1] if want[1] is not None else '') if x)


def _live_matches(q):
    r = _rpc('PVR.GetChannels', channelgroupid='alltv', properties=['channelnumber', 'icon'])
    ql = q.lower()
    return [c for c in (r.get('result') or {}).get('channels', []) if ql in c['label'].lower()][:30]


def _radio_matches(q):
    from .radio import _get
    try:                    # radio-browser down / no network: the rest of the search still shows
        r = _get('/stations/search', name=q, limit=20, order='clickcount') or []
        return [x for x in r if isinstance(x, dict)] if isinstance(r, list) else []   # an error page is not a result
    except Exception as e:
        log('hub radio: %s' % e, xbmc.LOGWARNING)
        return []

def _header(handle, text, target='plugin://plugin.video.nova/?a=noop', folder=False):
    li = xbmcgui.ListItem('[COLOR gold][B]%s[/B][/COLOR]' % text)
    li.setArt({'icon': 'DefaultAddonsSearch.png', 'thumb': 'DefaultAddonsSearch.png'})
    xbmcplugin.addDirectoryItem(handle, target, li, folder)


def _empty_row(handle):
    """3.3: a list with nothing in it says so (one row that does nothing) instead of a blank screen"""
    li = xbmcgui.ListItem(T('empty'))
    li.setArt({'icon': 'DefaultFolder.png'})
    li.setProperty('IsPlayable', 'false')
    xbmcplugin.addDirectoryItem(handle, 'plugin://plugin.video.nova/?a=noop', li, False)


def _add_foreign(handle, p, it):
    name = '%s  [COLOR grey]· %s[/COLOR]' % (it['label'], name_of(p).split(' – ')[0])
    li = xbmcgui.ListItem(name)
    a = it.get('art') or {}
    if it.get('thumbnail') and 'thumb' not in a:
        a['thumb'] = it['thumbnail']
    li.setArt(a)
    tag = li.getVideoInfoTag()
    tag.setTitle(it['label'])
    tag.setPlot(it.get('plot') or '')
    is_dir = it.get('filetype') == 'directory'
    if not is_dir:
        li.setProperty('IsPlayable', 'true')
    xbmcplugin.addDirectoryItem(handle, it['file'], li, is_dir)


def hub_results(handle, q, media_item, per_provider=8, season=None, episode=None):
    """one merged list: movies & series (TMDb -> POV), every add-on, live channels, radio.
    An episode search (season/episode given, or written in q) lists only exact season/episode matches."""
    from .common import tmdb
    from . import epmatch
    want = epmatch.wanted(q, season, episode)
    if want != (None, None):
        return hub_episode(handle, q, want, season, episode)
    tm = {}

    def tmdb_work():
        try:
            tm['r'] = tmdb('/search/multi', query=q).get('results', [])
        except Exception:
            tm['r'] = []
    def radio_work():
        tm['radio'] = _radio_matches(q)
    th = threading.Thread(target=tmdb_work, daemon=True)
    if is_on('tmdb'):
        th.start()
    rth = threading.Thread(target=radio_work, daemon=True)     # radio-browser runs beside the add-on searches
    if is_on('radio'):
        rth.start()
    found = run_search(q)
    if th.is_alive():
        th.join(20)
    total = 0
    titles = [r for r in tm.get('r', []) if r.get('media_type') in ('movie', 'tv')]
    if titles:
        _header(handle, '%s (%d)' % (s('movies_series'), len(titles)))
        for r in titles[:20]:
            media_item(r['media_type'], r)
        total += len(titles)
    for p, items in found:
        _header(handle, '%s (%d)' % (name_of(p), len(items)))
        for it in items[:per_provider]:
            _add_foreign(handle, p, it)
        if len(items) > per_provider:
            _header(handle, '   ' + s('more') % name_of(p).split(' – ')[0], build_url(p, q), True)
        total += len(items)
    live = _live_matches(q) if is_on('live_tv') else []
    if live:
        _header(handle, '%s (%d)' % (s('live'), len(live)))
        for c in live:
            li = xbmcgui.ListItem('%s  %s' % (c.get('channelnumber') or '', c['label']))
            li.setArt({'icon': c.get('icon') or 'DefaultTVShows.png', 'thumb': c.get('icon') or 'DefaultTVShows.png'})
            xbmcplugin.addDirectoryItem(handle, 'plugin://plugin.video.nova/?a=tv_play&id=%d' % c['channelid'], li, False)
        total += len(live)
    if rth.is_alive():
        rth.join(10)
    radios = tm.get('radio') or []
    if radios:
        _header(handle, '%s (%d)' % (s('radio'), len(radios)))
        for st in radios:
            stream = st.get('url_resolved') or st.get('url')
            if not stream:
                continue
            li = xbmcgui.ListItem(st.get('name', '').strip())
            li.setArt({'thumb': st.get('favicon') or 'DefaultAudio.png', 'icon': st.get('favicon') or 'DefaultAudio.png'})
            li.setProperty('IsPlayable', 'true')
            xbmcplugin.addDirectoryItem(handle, stream, li, False)
        total += len(radios)
    if not total:
        xbmcgui.Dialog().notification('TeleNova', s('none'), xbmcgui.NOTIFICATION_INFO, 4000)
    return total


# ------------------------------------------------------------------ sources of one title (3.1: no POV)
TELESCOPE = 'plugin.video.telescope'


def telegram_on():
    # kept for a minute at most (a plugin run is shorter; a long-lived caller still sees an install / removal)
    hit = _MEMO.get('tg')
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    on = bool(is_on('telescope') and installed(TELESCOPE))
    _MEMO['tg'] = (time.time(), on)
    return on


def telegram_url(mediatype, tmdb_id, season=None, episode=None, title='', mode='hub', **extra):
    """TeleScope link for one exact title (TMDb id): mode=hub lists verified sources, mode=play opens its picker"""
    q = {'mode': mode, 'type': 'movie' if mediatype == 'movie' else 'tv', 'tmdb': tmdb_id, 'title': title or ''}
    if mediatype != 'movie':
        q.update(season=season, episode=episode)
    q.update(extra)
    return 'plugin://%s/?%s' % (TELESCOPE, urlencode(q))


def telegram_sources(mediatype, tmdb_id, season=None, episode=None, title=''):
    """verified Telegram sources of exactly this movie / episode (TeleScope matched and probed them): [(provider, items)]"""
    if not tmdb_id or not telegram_on():
        return []
    try:
        items = _useful(read_dir(telegram_url(mediatype, tmdb_id, season, episode, title)))
    except Exception as e:
        log('telegram sources: %s' % e, xbmc.LOGWARNING)
        items = []
    p = next(x for x in PROVIDERS if x[0] == 'telescope')
    return [(p, items)] if items else []


def play_with_fallback(pov_url, query, alt_query='', timeout=240, season=None, episode=None, show='', alt_show='',
                       tmdb_id=None, mediatype='movie', title=''):
    """3.1: the links of this exact title, Telegram first (matched by TMDb id and tested by the engine), then
    the other sources - one list to pick from, the way Telemedia shows its links. (pov_url is ignored: kept so
    older callers still work.)"""
    return fallback_pick(query, alt_query, season, episode, show, alt_show,
                         tmdb_id=tmdb_id, mediatype=mediatype, title=title)


def hub_episode(handle, q, want, season=None, episode=None):
    """episode search: every source, the text states the episode, and only exact matches are listed"""
    from . import epmatch
    explicit = season not in (None, '') or episode not in (None, '')
    query = epmatch.query_for(q, season, episode) if explicit else q
    found = exact(run_search(query), want, show=q if explicit else '')
    if not found:
        _header(handle, s('no_exact') % se_label(want))
        return
    for p, items in found:
        _header(handle, '%s (%d)' % (name_of(p), len(items)))
        for it in items:
            _add_foreign(handle, p, it)


def fallback_pick(query, alt_query='', season=None, episode=None, show='', alt_show='', tmdb_id=None, mediatype='movie',
                  title=''):
    """3.1: Telegram (by TMDb id) and the other sources are asked at the same time. As soon as Telegram has
    links the list opens - the other sources get a few seconds at most and never hold it up."""
    want = (int(season), int(episode)) if season not in (None, '') and episode not in (None, '') else (None, None)
    pd = xbmcgui.DialogProgressBG()
    pd.create('TeleNova', s('tg_searching') if tmdb_id and telegram_on() else s('searching'))
    tg, other = {}, {}
    try:
        others = [p for p in search_targets() if not (tmdb_id and p[0] == 'telescope')]   # Telegram is not asked twice

        def other_work():
            try:
                found = exact(run_search(query, others, per_timeout=7), want, show)
                if not found and alt_query and alt_query.lower() != query.lower():
                    found = exact(run_search(alt_query, others, per_timeout=5), want, alt_show)
                other['r'] = found
            except Exception as e:
                log('other sources: %s' % e, xbmc.LOGWARNING)
        tth = threading.Thread(target=lambda: tg.update(r=telegram_sources(mediatype, tmdb_id, season, episode, title)),
                               daemon=True)
        oth = threading.Thread(target=other_work, daemon=True)
        t0 = time.time()
        tth.start()
        oth.start()
        tth.join(45)
        # with Telegram links in hand the rest gets what is left of 6 seconds; with none, its full time
        oth.join(max(0.1, 6 - (time.time() - t0)) if tg.get('r') else 13)
        found = (tg.get('r') or []) + list(other.get('r') or [])      # tested Telegram links lead the list
    finally:
        pd.close()                               # the progress bar never stays on screen after an error
    if not found and want != (None, None):
        xbmcgui.Dialog().ok('TeleNova', s('no_exact') % se_label(want))
        return False
    return _pick(found, exact_all=want != (None, None))


def _pick(found, exact_all=False):
    rows, labels = [], []
    for p, items in found:
        for it in (items if exact_all or p[0] == 'telescope' else items[:10]):   # every exact match is listed
            rows.append(it)
            labels.append('%s  [COLOR grey]· %s[/COLOR]' % (it['label'], name_of(p).split(' – ')[0]))
    if not rows:
        xbmcgui.Dialog().ok('TeleNova', s('none'))
        return False
    i = xbmcgui.Dialog().select(s('pick'), labels)
    if i < 0:
        return False
    it = rows[i]
    if it.get('filetype') == 'directory':
        xbmc.executebuiltin('ActivateWindow(Videos,%s,return)' % it['file'])
    else:
        xbmc.executebuiltin('PlayMedia(%s)' % it['file'])
    return True


def library(handle, url):
    """all providers by category, plus the Russian studio channels"""
    col = {'he': 0, 'en': 1, 'ru': 2}[ui_lang()]
    st = status()
    for cat, names in CATS:
        if cat == 'russian':
            n = len(RUSSIAN) + 1
        else:
            n = len([p for p in PROVIDERS if p[3] == cat and st.get(p[0], {}).get('stable', True)])
        if n:
            li = xbmcgui.ListItem('%s  [COLOR grey](%d)[/COLOR]' % (names[col], n))
            li.setArt({'icon': 'DefaultAddonVideo.png', 'thumb': 'DefaultAddonVideo.png'})
            xbmcplugin.addDirectoryItem(handle, url(a='lib_cat', cat=cat), li, True)
    li = xbmcgui.ListItem('[COLOR gold]%s[/COLOR]' % s('sources'))
    li.setArt({'icon': 'DefaultAddonProgram.png'})
    xbmcplugin.addDirectoryItem(handle, url(a='sources'), li, True)
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)


def library_cat(handle, url, cat):
    col = {'he': 0, 'en': 1, 'ru': 2}[ui_lang()]
    if cat == 'russian':
        for cid, names in RUSSIAN:
            li = xbmcgui.ListItem(names[col])
            li.setArt({'icon': 'special://home/addons/plugin.video.youtube/icon.png', 'thumb': 'special://home/addons/plugin.video.youtube/icon.png'})
            xbmcplugin.addDirectoryItem(handle, url(a='yt_channel', id=cid), li, True)
        li = xbmcgui.ListItem(('ארכיון האינטרנט – סרטים סובייטיים', 'Internet Archive – Soviet films', 'Internet Archive – советские фильмы')[col])
        li.setArt({'icon': 'DefaultAddonVideo.png'})
        xbmcplugin.addDirectoryItem(handle, url(a='ia_search', q='@soviet'), li, True)
        xbmcplugin.endOfDirectory(handle, cacheToDisc=False)
        return
    st = status()
    for p in PROVIDERS:
        if p[3] != cat or not st.get(p[0], {}).get('stable', True):
            continue
        ok = available(p)
        label = name_of(p) if ok else '%s  [COLOR grey](%s)[/COLOR]' % (name_of(p), T('lib_install'))
        li = xbmcgui.ListItem(label)
        ic = 'special://home/addons/%s/icon.png' % p[1] if ok else 'DefaultAddonVideo.png'
        li.setArt({'icon': ic, 'thumb': ic})
        li.addContextMenuItems([(s('settings'), 'Addon.OpenSettings(%s)' % p[1])] if ok else [])
        xbmcplugin.addDirectoryItem(handle, url(a='lib_open', id=p[0]), li, True)
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)


def open_provider(handle, pid, q=''):
    """a provider's own menu (or a query), shown *inside* NovaTV; installs on first use"""
    p = next(x for x in PROVIDERS if x[0] == pid)
    if p[4] == 'internal:ia':          # the add-on's scraper no longer plays: NovaTV's own Archive listing
        return ia_search(handle, q)
    if not installed(p[1]):
        from .iptv import install_addon
        xbmcgui.Dialog().notification('TeleNova', '%s: %s' % (T('lib_install'), name_of(p)), xbmcgui.NOTIFICATION_INFO, 3000)
        if not install_addon(p[1]):
            xbmcgui.Dialog().ok('TeleNova', '%s\n%s' % (T('bk_fail'), p[1]))
            return xbmcplugin.endOfDirectory(handle, False)
    path = build_url(p, q) if q and p[4] else 'plugin://%s/' % p[1]
    items = read_dir(path)
    for it in items:
        lab = it.get('label') or ''
        li = xbmcgui.ListItem(lab)
        a = it.get('art') or {}
        if it.get('thumbnail') and 'thumb' not in a:
            a['thumb'] = it['thumbnail']
        li.setArt(a)
        li.getVideoInfoTag().setPlot(it.get('plot') or '')
        is_dir = it.get('filetype') == 'directory'
        if not is_dir:
            li.setProperty('IsPlayable', 'true')
        xbmcplugin.addDirectoryItem(handle, it['file'], li, is_dir)
    if not items:
        _empty_row(handle)
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)


def list_rows(handle, rows):
    for it in rows:
        li = xbmcgui.ListItem(it['label'])
        li.setArt(it.get('art') or {})
        tag = li.getVideoInfoTag()
        tag.setTitle(it['label'])
        tag.setPlot(it.get('plot') or '')
        li.setProperty('IsPlayable', 'true')
        xbmcplugin.addDirectoryItem(handle, it['file'], li, False)


def yt_channel(handle, url, cid, token=''):
    from . import yt
    videos, nxt = yt.channel(cid, token)
    list_rows(handle, yt_rows(videos))
    if not videos and not nxt:
        _empty_row(handle)
    if nxt:
        li = xbmcgui.ListItem('[B]%s >>[/B]' % T('next_page'))
        xbmcplugin.addDirectoryItem(handle, url(a='yt_channel', id=cid, token=nxt), li, True)
    xbmcplugin.setContent(handle, 'videos')
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)
    xbmc.executebuiltin('Container.SetViewMode(60)')      # BN Details view


def ia_search(handle, q):
    from . import ia
    rows = ia_rows(ia.search(q))
    for it in rows:
        li = xbmcgui.ListItem(it['label'])
        li.setArt(it['art'])
        li.getVideoInfoTag().setPlot(it['plot'])
        xbmcplugin.addDirectoryItem(handle, it['file'], li, True)
    if not rows:
        _empty_row(handle)
    xbmcplugin.setContent(handle, 'movies')
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)
    xbmc.executebuiltin('Container.SetViewMode(60)')      # BN Details view


def ia_item(handle, identifier):
    from . import ia
    thumb = 'https://archive.org/services/img/%s' % identifier
    files = ia.files(identifier)
    if not files:
        _empty_row(handle)
    for f in files:
        li = xbmcgui.ListItem(f['title'])
        li.setArt({'thumb': thumb, 'poster': thumb, 'fanart': thumb})
        tag = li.getVideoInfoTag()
        meta = f.get('meta') or {}
        tag.setTitle(f['title'])
        tag.setMediaType('movie')
        tag.setPlot(meta.get('plot', ''))
        if meta.get('year', '').isdigit():
            tag.setYear(int(meta['year']))
        if meta.get('genre'):
            tag.setGenres([g.strip() for g in re.split(r'[;,]', meta['genre']) if g.strip()][:3])
        tag.setTagLine(meta.get('title', '') if meta.get('title') != f['title'] else '')
        li.setProperty('IsPlayable', 'true')
        target = 'plugin://plugin.video.nova/?' + urlencode({'a': 'ia_play', 'u': f['url'], 't': f['title'], 'id': identifier})
        xbmcplugin.addDirectoryItem(handle, target, li, False)
    xbmcplugin.setContent(handle, 'videos')
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)
    xbmc.executebuiltin('Container.SetViewMode(60)')      # BN Details view


def ia_play(handle, u, t, identifier=''):
    """resolve an Archive film with its details, so the player knows it is a movie (subtitles, history)"""
    li = xbmcgui.ListItem(t, path=u)
    thumb = 'https://archive.org/services/img/%s' % identifier if identifier else ''
    li.setArt({'thumb': thumb, 'poster': thumb})
    tag = li.getVideoInfoTag()
    tag.setTitle(t)
    tag.setMediaType('movie')
    xbmcplugin.setResolvedUrl(handle, True, li)


def yt_search(handle, q):
    from . import yt
    rows = yt_rows(yt.search(q))
    list_rows(handle, rows)
    if not rows:
        _empty_row(handle)
    xbmcplugin.setContent(handle, 'videos')
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)
    xbmc.executebuiltin('Container.SetViewMode(60)')      # BN Details view


def _row(handle, url, pid, label, flags, on, icon):
    li = xbmcgui.ListItem('[COLOR %s]●[/COLOR] %s  [COLOR grey](%s)[/COLOR]' % ('limegreen' if on else 'grey', label, ', '.join(flags)))
    li.setArt({'icon': icon, 'thumb': icon})
    li.addContextMenuItems([(s('toggle'), 'RunPlugin(%s)' % url(a='prov_toggle', id=pid))])
    xbmcplugin.addDirectoryItem(handle, url(a='prov_toggle', id=pid), li, False)
    return li


def sources_screen(handle, url):
    """every source NovaTV searches: a green dot = searched, grey = ignored by every search"""
    st = status()
    for key, a, icon in (('install_all', 'prov_install_all', 'DefaultAddonService.png'),
                         ('all_on', 'prov_all_on', 'DefaultAddonService.png'), ('all_off', 'prov_all_off', 'DefaultAddonService.png')):
        li = xbmcgui.ListItem('[COLOR gold]%s[/COLOR]' % s(key))
        li.setArt({'icon': icon})
        xbmcplugin.addDirectoryItem(handle, url(a=a), li, False)
    _header(handle, s('builtin'))
    lang = {'he': 0, 'en': 1, 'ru': 2}[ui_lang()]
    for pid, names in BUILTIN:
        _row(handle, url, pid, names[lang], [s('on') if is_on(pid) else s('off'), s('searchable')], is_on(pid), 'DefaultAddonVideo.png')
    _header(handle, s('addons'))
    for p in PROVIDERS:
        ok = available(p)
        flags = [s('on') if is_on(p[0]) else s('off')]
        if not ok:
            flags.append(s('not_inst'))
        if not st.get(p[0], {}).get('stable', True):
            flags.append(s('unstable'))
        flags.append(s('searchable') if p[4] or p[0] == 'pov' else s('browse'))   # POV: through the TMDb titles
        li = _row(handle, url, p[0], name_of(p), flags, is_on(p[0]) and ok,
                  'special://home/addons/%s/icon.png' % p[1] if ok else 'DefaultAddonVideo.png')
        if installed(p[1]):
            li.addContextMenuItems([(s('settings'), 'Addon.OpenSettings(%s)' % p[1])])
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)


def toggle(pid):
    m = enabled_map()
    m[pid] = not is_on(pid)
    save('providers.json', m)
    forget()
    p = next((x for x in PROVIDERS if x[0] == pid), None)
    if m[pid] and p and not available(p):                # switched on but missing: install it now
        from .iptv import install_addon
        install_addon(p[1], timeout=90)
        forget()


def set_all(on):
    save('providers.json', {pid: bool(on) for pid in [b[0] for b in BUILTIN] + [p[0] for p in PROVIDERS]})
    forget()


def install_all():
    from .iptv import install_addon
    st = status()
    todo = [p for p in PROVIDERS if not installed(p[1]) and st.get(p[0], {}).get('stable', True)]
    pd = xbmcgui.DialogProgress()
    pd.create('TeleNova', s('install_all'))
    for i, p in enumerate(todo):
        if pd.iscanceled():
            break
        pd.update(int(i * 100 / max(1, len(todo))), name_of(p))
        install_addon(p[1], timeout=90)
    pd.close()
    forget()
