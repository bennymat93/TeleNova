# -*- coding: utf-8 -*-
"""Live-TV bar (1.4.4, in the style the owner showed: Partner TV): a bottom row of programme cards for the playing
channel (now with a progress bar, then the next ones with their times) and a column of channels on the right
(number + logo) for quick switching. The window is resources/skin/Custom_1190_BNLiveBar.xml; it opens with OK /
click / tap on live TV (resources/keymaps/bn_player.xml) and fills its two lists from the actions here:
  ?a=lb_epg       programmes of the playing channel (PVR.GetBroadcasts)
  ?a=lb_channels  channels of the playing channel's group, the playing one first
  ?a=lb_play&id=  switch to a channel (Player.Open channelid)
cards() / ordered() are plain Python for tests."""
import json
import time


def _rpc(method, **params):
    import xbmc
    return json.loads(xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})))


def _ts(s):
    """'2026-10-05 19:30:00' (UTC, JSON-RPC) -> epoch"""
    import calendar
    return calendar.timegm(time.strptime(s, '%Y-%m-%d %H:%M:%S'))


def cards(broadcasts, now, limit=8):
    """the programme now on air first, then the following ones (ended ones dropped)"""
    out = []
    for b in sorted(broadcasts, key=lambda b: b['starttime']):
        a, e = _ts(b['starttime']), _ts(b['endtime'])
        if e <= now:
            continue
        pct = int(max(0, min(100, (now - a) * 100.0 / max(1, e - a)))) if a <= now else 0
        out.append({'title': b.get('title') or '', 'start': a, 'end': e, 'progress': pct, 'now': a <= now,
                    'thumb': b.get('thumbnail') or '', 'plot': b.get('plot') or ''})
        if len(out) >= limit:
            break
    return out


def ordered(channels, current_id):
    """the playing channel first, then the rest by number (the column shows 'where am I' at the top)"""
    chans = sorted(channels, key=lambda c: (c.get('channelnumber') or 99999))
    cur = [c for c in chans if c['channelid'] == current_id]
    return cur + [c for c in chans if c['channelid'] != current_id]


# ------------------------------------------------------------ Kodi
def _playing():
    r = _rpc('Player.GetItem', playerid=1, properties=['channelnumber', 'thumbnail'])
    it = (r.get('result') or {}).get('item') or {}
    return it if it.get('type') == 'channel' else None


def _hhmm(epoch):
    return time.strftime('%H:%M', time.localtime(epoch))


_IMG_OK = {}
_IMG_PROP = 'NovaTV.img_ok'


def _img_memory(store=None):
    """3.3: every opening of the bar is a new Python run, so a module variable remembered nothing and the checks
    were repeated each time: the answers live in a home-window property (until Kodi closes), newest 400"""
    try:
        import xbmcgui
        win = xbmcgui.Window(10000)
        if store is None:
            data = json.loads(win.getProperty(_IMG_PROP) or '{}')
            return data if isinstance(data, dict) else {}
        win.setProperty(_IMG_PROP, json.dumps(dict(list(store.items())[-400:])))
    except Exception:
        pass
    return {}


def images_ok(urls):
    """{url: loads?} - the guide's programme images are often dead links (the Israeli guide's all answered 404):
    checked in parallel (2 s each, remembered for the session) so a card never shows an empty frame"""
    import requests
    from concurrent.futures import ThreadPoolExecutor
    if not _IMG_OK:
        _IMG_OK.update(_img_memory())
    todo = [u for u in set(urls) if u and u not in _IMG_OK]

    def check(u):
        try:
            r = requests.head(u, timeout=2, allow_redirects=True)
            ok = r.status_code == 200 and r.headers.get('Content-Type', '').startswith('image')
        except Exception:
            ok = False
        return u, ok
    if todo:
        with ThreadPoolExecutor(8) as ex:
            _IMG_OK.update(ex.map(check, todo))
        _img_memory(_IMG_OK)
    return {u: _IMG_OK.get(u, False) for u in urls}


def epg(handle):
    import xbmcgui
    import xbmcplugin
    ch = _playing()
    if ch:
        r = _rpc('PVR.GetBroadcasts', channelid=ch['id'], properties=['title', 'starttime', 'endtime', 'thumbnail', 'plot'])
        det = _rpc('PVR.GetChannelDetails', channelid=ch['id'], properties=['icon'])
        logo = ((det.get('result') or {}).get('channeldetails') or {}).get('icon') or ''   # the channel's own logo
        found = cards((r.get('result') or {}).get('broadcasts') or [], time.time())
        if not found:                     # no guide for this channel: one card, never an empty row
            from .common import ui_lang
            li = xbmcgui.ListItem(ch.get('label') or '', 'אין לוח שידורים לערוץ זה' if ui_lang() == 'he' else 'No guide for this channel')
            li.setArt({'thumb': logo, 'icon': logo})
            xbmcplugin.addDirectoryItem(handle, 'plugin://plugin.video.nova/?a=noop', li, False)
        ok = images_ok([c['thumb'] for c in found])
        for c in found:
            c['thumb'] = c['thumb'] if ok.get(c['thumb']) else ''
            li = xbmcgui.ListItem(c['title'], '%s - %s' % (_hhmm(c['start']), _hhmm(c['end'])))
            li.setArt({'thumb': c['thumb'] or logo, 'icon': c['thumb'] or logo})
            li.setProperty('progress', str(c['progress']))
            li.setProperty('now', '1' if c['now'] else '')
            li.getVideoInfoTag().setPlot(c['plot'])
            xbmcplugin.addDirectoryItem(handle, 'plugin://plugin.video.nova/?a=noop', li, False)
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)


def channels(handle):
    import xbmcgui
    import xbmcplugin
    from .iptv import group_id
    ch = _playing()
    gid = group_id('Israel') or 'alltv'
    r = _rpc('PVR.GetChannels', channelgroupid=gid, properties=['channelnumber', 'icon'])
    lst = (r.get('result') or {}).get('channels') or []
    if ch and not any(c['channelid'] == ch['id'] for c in lst):          # watching a channel of another group
        r = _rpc('PVR.GetChannels', channelgroupid='alltv', properties=['channelnumber', 'icon'])
        lst = (r.get('result') or {}).get('channels') or []
    for c in ordered(lst, ch['id'] if ch else None)[:120]:
        li = xbmcgui.ListItem(c['label'], str(c.get('channelnumber') or ''))
        li.setArt({'thumb': c.get('icon') or '', 'icon': c.get('icon') or 'DefaultTVShows.png'})
        li.setProperty('playing', '1' if ch and c['channelid'] == ch['id'] else '')
        xbmcplugin.addDirectoryItem(handle, 'plugin://plugin.video.nova/?a=lb_play&id=%d' % c['channelid'], li, False)
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)


def play(chid):
    """switch channel: the current one is stopped first and its connection released (subscription lists allow
    only 1-2 connections - opening the new channel while the old one still streams failed with 'playback failed')"""
    import xbmc
    xbmc.executebuiltin('Dialog.Close(1190)')
    p = xbmc.Player()
    if p.isPlaying():
        p.stop()
        for _ in range(20):
            if not p.isPlaying():
                break
            xbmc.sleep(100)
        xbmc.sleep(300)
    _rpc('Player.Open', item={'channelid': int(chid)})
