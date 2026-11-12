# -*- coding: utf-8 -*-
"""3.3: does the playing video carry Hebrew subtitles of its own?

The old check read only the language code of every track (Player.getAvailableSubtitleStreams). Many files - Telegram
uploads above all - mark the Hebrew track as "und" or leave the language empty and write "Hebrew" / "עברית" in the
track NAME, so the track was missed and a subtitle search ran for a video that needed none. Kodi's JSON-RPC lists
language, name and the "forced" flag of every track:

  * Hebrew = the language code is Hebrew, or the track name says so
  * a FORCED Hebrew track (only the foreign-language lines) is not a subtitle of the whole video: the search runs

The same rules are written into All_Subs by its guard v13 (subspatch.py) - keep the two in step.
"""
import json
import re

import xbmc

HEB_CODES = ('he', 'heb', 'hebrew', 'iw')
HEB_NAME = re.compile(u'(^|[^a-z])(heb|hebrew|ivrit)([^a-z]|$)|עברית', re.I)


def is_hebrew(track):
    lang = (track.get('language') or '').lower().replace('_', '-').split('-')[0]
    return lang in HEB_CODES or bool(HEB_NAME.search(track.get('name') or ''))


def is_forced(track):
    return bool(track.get('isforced')) or 'forced' in (track.get('name') or '').lower()


def tracks():
    """subtitle tracks of the playing video: [{'index', 'language', 'name', 'isforced', ...}] or None when the
    player cannot be asked right now (opening / closing)"""
    try:
        r = json.loads(xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'Player.GetProperties',
                                                        'params': {'playerid': 1, 'properties': ['subtitles']}})))
        if 'result' not in r:
            return None
        return r['result'].get('subtitles') or []
    except Exception:
        return None


def _hms(label):
    """'01:02:03' -> seconds; '' or anything else -> 0"""
    try:
        parts = [int(x) for x in (label or '').split(':')]
    except ValueError:
        return 0
    secs = 0
    for p in parts:
        secs = secs * 60 + p
    return secs


def play_secs():
    """seconds played, read as a label: unlike Player.getTime() it never raises (and never writes an EXCEPTION
    line into Kodi's log) when the video closed a moment ago"""
    return _hms(xbmc.getInfoLabel('Player.Time(hh:mm:ss)'))


def is_live():
    """the playing video is a live stream (a TV channel, a live HLS address): it has no length, so there is no
    subtitle file to look for and nothing to prepare ahead"""
    if xbmc.getCondVisibility('PVR.IsPlayingTV | PVR.IsPlayingRadio | VideoPlayer.Content(livetv)'):
        return True
    try:
        r = json.loads(xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'Player.GetProperties',
                                                        'params': {'playerid': 1, 'properties': ['live']}})))
        if (r.get('result') or {}).get('live'):
            return True
    except Exception:
        pass
    # a few seconds in and still no length at all
    return play_secs() >= 3 and _hms(xbmc.getInfoLabel('Player.Duration(hh:mm:ss)')) == 0


def hebrew_index(subs=None):
    """index of the full (not forced) Hebrew track, or -1"""
    subs = tracks() if subs is None else subs
    for t in subs or []:
        if is_hebrew(t) and not is_forced(t):
            return int(t.get('index', -1))
    return -1
