# -*- coding: utf-8 -*-
"""Shared helpers: Kodi API wrappers, settings, logging, paths, version compat (Kodi 19+)."""
import json
import os
import re
import sys
import threading
import time as _time

import xbmc
import xbmcaddon
import xbmcgui
import xbmcvfs

ADDON_ID = 'plugin.video.telescope'
ADDON = xbmcaddon.Addon(ADDON_ID)
ADDON_NAME = ADDON.getAddonInfo('name')
ADDON_VERSION = ADDON.getAddonInfo('version')
ADDON_PATH = xbmcvfs.translatePath(ADDON.getAddonInfo('path'))
PROFILE = xbmcvfs.translatePath(ADDON.getAddonInfo('profile'))
ICON = os.path.join(ADDON_PATH, 'resources', 'icon.png')
FANART = os.path.join(ADDON_PATH, 'resources', 'fanart.jpg')
LIB_DIR = os.path.join(PROFILE, 'lib')          # bootstrapped python deps live here
PORT_FILE = os.path.join(PROFILE, 'port.json')
SESSION_FILE = os.path.join(PROFILE, 'telegram')  # Telethon adds .session
CACHE_DB = os.path.join(PROFILE, 'cache.db')

_lock = threading.Lock()

for _d in (PROFILE, LIB_DIR):
    try:
        if not os.path.isdir(_d):
            os.makedirs(_d)
    except OSError:
        pass


def kodi_major():
    try:
        return int(xbmc.getInfoLabel('System.BuildVersion').split('.')[0])
    except (ValueError, IndexError):
        return 19


KODI_MAJOR = kodi_major()


# ----------------------------------------------------------------- settings
def setting(key, default=''):
    try:
        val = xbmcaddon.Addon(ADDON_ID).getSetting(key)
    except Exception:  # pragma: no cover
        val = ''
    return val if val != '' else default


def setting_bool(key, default=False):
    val = setting(key, '')
    if val == '':
        return default
    return val.lower() == 'true'


def setting_int(key, default=0):
    try:
        return int(float(setting(key, str(default))))
    except ValueError:
        return default


def set_setting(key, value):
    xbmcaddon.Addon(ADDON_ID).setSetting(key, str(value))


# ----------------------------------------------------------------- strings
def lang(string_id):
    try:
        return ADDON.getLocalizedString(string_id) or str(string_id)
    except Exception:  # pragma: no cover
        return str(string_id)


def ui_language():
    """Two letter Kodi UI language code (he / ru / en ...)."""
    try:
        code = xbmc.getLanguage(xbmc.ISO_639_1) or 'en'
    except Exception:
        code = 'en'
    return code.lower()[:2]


def tmdb_language():
    pref = setting('meta_language', 'auto')
    if pref and pref != 'auto':
        return pref
    code = ui_language()
    return {'he': 'he-IL', 'ru': 'ru-RU', 'en': 'en-US'}.get(code, 'en-US')


# ----------------------------------------------------------------- logging
# 3.3: exceptions of requests carry the full URL (?key=..., api_key=...): keys must never reach kodi.log / the screen
_SECRET_RX = re.compile(r'(api_key|key|token|secret)=[^&\s\'"]+', re.I)


def scrub(text):
    try:
        return _SECRET_RX.sub(lambda m: m.group(1) + '=***', u'%s' % (text,))
    except Exception:  # pragma: no cover
        return ''


_debug = [0.0, False]      # 3.3: the debug flag is re-read every 30 s, not with every log line (each read builds an Addon())


def _debug_on():
    now = _time.time()
    if now - _debug[0] > 30 or now < _debug[0]:
        _debug[1] = setting_bool('debug')
        _debug[0] = now
    return _debug[1]


def log(msg, level=None):
    if level is None:
        level = xbmc.LOGINFO if _debug_on() else xbmc.LOGDEBUG
    try:
        xbmc.log('[%s] %s' % (ADDON_ID, msg), level)
    except Exception:  # pragma: no cover
        pass


def log_error(msg):
    log(scrub(msg), xbmc.LOGERROR)


def notify(msg, heading=None, icon=None, time=4000):
    xbmcgui.Dialog().notification(heading or ADDON_NAME, msg, icon or ICON, time)


# ----------------------------------------------------------------- small json store
def read_json(path, default=None):
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def write_json(path, data):
    tmp = path + '.tmp'
    with _lock:
        with open(tmp, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False)
        os.replace(tmp, path)


def add_lib_path():
    if LIB_DIR not in sys.path:
        sys.path.insert(0, LIB_DIR)


# ----------------------------------------------------------------- formatting
def human_size(num):
    num = float(num or 0)
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if num < 1024 or unit == 'TB':
            return ('%.0f %s' if unit in ('B', 'KB') else '%.1f %s') % (num, unit)
        num /= 1024.0
    return '%.1f TB' % num


def human_duration(seconds):
    seconds = int(seconds or 0)
    if seconds <= 0:
        return ''
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return '%d:%02d:%02d' % (h, m, s) if h else '%d:%02d' % (m, s)


# ----------------------------------------------------------------- ListItem compat
def make_listitem(label, label2='', path=None, offscreen=True):
    try:
        li = xbmcgui.ListItem(label, label2, path=path or '', offscreen=offscreen)
    except TypeError:  # very old signature
        li = xbmcgui.ListItem(label, label2, path=path or '')
    return li


def set_video_info(li, info):
    """Set video info labels on Kodi 19 (setInfo) and 20+ (InfoTagVideo)."""
    info = dict((k, v) for k, v in info.items() if v not in (None, '', [], 0) or k in ('season', 'episode'))
    if KODI_MAJOR >= 20 and hasattr(li, 'getVideoInfoTag'):
        tag = li.getVideoInfoTag()
        setters = {
            'title': 'setTitle', 'originaltitle': 'setOriginalTitle', 'plot': 'setPlot',
            'tvshowtitle': 'setTvShowTitle', 'mediatype': 'setMediaType', 'premiered': 'setPremiered',
            'imdbnumber': 'setIMDBNumber', 'mpaa': 'setMpaa', 'tagline': 'setTagLine',
        }
        for key, meth in setters.items():
            if key in info:
                try:
                    getattr(tag, meth)(str(info[key]))
                except Exception:
                    pass
        try:
            if 'year' in info:
                tag.setYear(int(info['year']))
            if 'season' in info and info['season'] is not None:
                tag.setSeason(int(info['season']))
            if 'episode' in info and info['episode'] is not None:
                tag.setEpisode(int(info['episode']))
            if 'duration' in info:
                tag.setDuration(int(info['duration']))
            if 'rating' in info:
                tag.setRating(float(info['rating']), int(info.get('votes') or 0), 'tmdb', True)
            if 'genre' in info:
                g = info['genre']
                tag.setGenres(g if isinstance(g, list) else [g])
            if 'studio' in info:
                s = info['studio']
                tag.setStudios(s if isinstance(s, list) else [s])
            if 'country' in info:
                c = info['country']
                tag.setCountries(c if isinstance(c, list) else [c])
            if 'tmdb' in info and hasattr(tag, 'setUniqueIDs'):
                ids = {'tmdb': str(info['tmdb'])}
                if info.get('imdbnumber'):
                    ids['imdb'] = info['imdbnumber']
                tag.setUniqueIDs(ids, 'tmdb')
        except Exception as exc:
            log('InfoTag error: %s' % exc)
    else:
        legacy = dict(info)
        legacy.pop('tmdb', None)
        legacy.pop('votes', None)
        li.setInfo('video', legacy)


def set_art(li, poster=None, fanart=None, thumb=None):
    art = {'icon': poster or ICON, 'thumb': thumb or poster or ICON, 'poster': poster or ICON,
           'fanart': fanart or FANART}
    li.setArt(art)
