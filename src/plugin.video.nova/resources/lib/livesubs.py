# -*- coding: utf-8 -*-
"""Live Hebrew subtitles for TV channels - the "Subtitles" button (1.4.11).

Live channels never search subtitles by themselves. The button (channel bar, the remote's subtitle key, menu key in
the player) offers:
  AI live        the PC server transcribes (Whisper) and translates with Gemini + standard engines   (mode 'ai')
  Automatic live the PC server transcribes and Google Translate and similar engines translate        (mode 'auto')
  Off            back to the channel itself
The server re-streams the channel together with its subtitles (server/livesubs.py), so each line appears exactly
when it is said; the picture runs a few seconds behind the broadcast for that."""
import json
import re
import time

from .common import ADDON, ui_lang, log

PROP = 'BN.LiveSubs'
S = {
    'title': ('כתוביות', 'Subtitles', 'Субтитры'),
    'ai': ('כתוביות AI בזמן אמת', 'AI live subtitles', 'ИИ-субтитры в реальном времени'),
    'ai2': ('תמלול ותרגום AI מדויק, כמה שניות השהיה', 'precise AI transcription + translation, a few seconds delay',
            'точная ИИ-расшифровка и перевод, задержка несколько секунд'),
    'auto': ('כתוביות אוטומטיות בזמן אמת', 'Automatic live subtitles', 'Автоматические субтитры'),
    'auto2': ('Google Translate ודומיו, השהיה קצרה יותר', 'Google Translate and similar, shorter delay',
              'Google Translate и аналоги, меньше задержка'),
    'off': ('כבוי', 'Off', 'Выключить'),
    'on_now': ('פעיל עכשיו', 'on now', 'включено'),
    'starting': ('מכין כתוביות לערוץ...', 'Preparing subtitles for the channel...', 'Готовлю субтитры...'),
    'starting2': ('הערוץ יוצג כמה שניות אחרי השידור כדי שכל שורה תופיע בדיוק בזמן',
                  'The channel shows a few seconds behind the broadcast so every line appears exactly on time',
                  'Канал идёт на несколько секунд позже эфира, чтобы строки совпадали с речью'),
    'no_tv': ('אין ערוץ טלוויזיה בניגון', 'No TV channel is playing', 'Телеканал не воспроизводится'),
    'no_server': ('שרת הכתוביות לא זמין (המחשב כבוי?)', 'Subtitle server not reachable (is the PC on?)',
                  'Сервер субтитров недоступен (ПК выключен?)'),
    'failed': ('לא ניתן ליצור כתוביות לערוץ הזה', 'Could not make subtitles for this channel',
               'Не удалось создать субтитры для этого канала'),
}


def s(key):
    i = {'he': 0, 'ru': 2}.get(ui_lang(), 1)
    return S[key][i]


def _rpc(method, **params):
    import xbmc
    return json.loads(xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})))


def state():
    import xbmcgui
    try:
        return json.loads(xbmcgui.Window(10000).getProperty(PROP) or '{}')
    except ValueError:
        return {}


def set_state(d):
    import xbmcgui
    xbmcgui.Window(10000).setProperty(PROP, json.dumps(d) if d else '')
    label()


def label():
    """the button's text (window property: the skin file works without new skin variables after a repo update)"""
    import xbmcgui
    on = bool(xbmcgui.Window(10000).getProperty(PROP))
    xbmcgui.Window(10000).setProperty('BN.ExitTvLabel', '[B]✕  %s[/B]' % {'he': 'יציאה', 'ru': 'Выход'}.get(ui_lang(), 'Exit'))
    xbmcgui.Window(10000).setProperty('BN.LiveSubsLabel', '[B]%s[/B]%s' % (s('title'), '  [COLOR FFE8BE5A]●[/COLOR]' if on else ''))


def server():
    return (ADDON.getSetting('sub_server') or 'http://127.0.0.1:8765').rstrip('/')


# ------------------------------------------------------------------ channel -> stream URL
def channel_entry(m3u_text, number=None, name=''):
    """(url, name, logo) of a channel in the merged playlist, by its number (tvg-chno), else by name"""
    entry, best = None, None
    for line in m3u_text.splitlines():
        if line.startswith('#EXTINF'):
            entry = line
        elif entry and line.strip() and not line.startswith('#'):
            chno = re.search(r'tvg-chno="(\d+)"', entry)
            label = entry.rsplit(',', 1)[-1].strip()
            logo = (re.search(r'tvg-logo="([^"]*)"', entry) or [None, ''])[1]
            if number and chno and int(chno.group(1)) == int(number):
                return line.strip(), label, logo
            if name and label == name and best is None:
                best = (line.strip(), label, logo)
            entry = None
    return best


def resolve(url):
    """NovaTV's own failover entries (plugin://...?a=live&ch=kan11 / &alt=name) -> the first working stream"""
    from urllib.parse import parse_qs, urlparse
    if not (url or '').startswith('plugin://plugin.video.nova/'):
        return url
    q = {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}
    if q.get('a') != 'live':
        return url
    from . import livefail
    from .common import load
    if q.get('alt'):
        cands = load('alternates.json', {}).get(q['alt'], [])
    elif q.get('ch') in livefail.CHANNELS:
        cands = livefail.candidates(q['ch'])
    else:
        cands = []
    for u in cands:
        if not u.startswith('plugin://') and livefail._alive_url(u):
            return u
    return None


def playing_channel():
    """{id, number, label, url, logo} of the TV channel on screen (or the one live subtitles are running for)"""
    st = state()
    import xbmc
    if st.get('chid') and not xbmc.getCondVisibility('PVR.IsPlayingTV'):
        return st.get('channel')
    r = _rpc('Player.GetItem', playerid=1, properties=['channelnumber', 'thumbnail'])
    it = (r.get('result') or {}).get('item') or {}
    if it.get('type') != 'channel':
        return None
    from .iptv import MERGED_M3U
    try:
        text = open(MERGED_M3U, encoding='utf-8').read()
    except OSError:
        return None
    hit = channel_entry(text, it.get('channelnumber'), it.get('label', ''))
    if not hit:
        return None
    return {'id': it['id'], 'number': it.get('channelnumber'), 'label': it.get('label', hit[1]),
            'url': resolve(hit[0]), 'logo': it.get('thumbnail') or hit[2]}


# ------------------------------------------------------------------ the button
def menu():
    import xbmcgui
    st = state()
    cur = st.get('mode')
    rows = []
    for key in ('ai', 'auto'):
        li = xbmcgui.ListItem(s(key) + ('   [COLOR gold]%s[/COLOR]' % s('on_now') if cur == key else ''))
        li.setLabel2(s(key + '2'))
        rows.append(li)
    rows.append(xbmcgui.ListItem(s('off')))
    pick = xbmcgui.Dialog().select(s('title'), rows, useDetails=True)
    if pick < 0:
        return
    if pick == 2:
        return off()
    start(('ai', 'auto')[pick])


def start(mode):
    import requests
    import xbmc
    import xbmcgui
    ch = playing_channel()
    if not ch or not ch.get('url'):
        return xbmcgui.Dialog().notification(s('title'), s('no_tv'), xbmcgui.NOTIFICATION_WARNING, 4000)
    base = server()
    try:
        requests.get(base + '/health', timeout=3)
    except Exception:
        from . import subsnet
        subsnet.discover_server()
        base = server()
        try:
            requests.get(base + '/health', timeout=4)
        except Exception:
            return xbmcgui.Dialog().notification(s('title'), s('no_server'), xbmcgui.NOTIFICATION_ERROR, 5000)
    old = state()
    if old.get('sid') and old.get('mode') != mode:
        _stop_server(old)
    try:
        info = requests.post(base + '/live', json={'url': ch['url'], 'mode': mode, 'title': ch['label'],
                                                   'gemini_key': ADDON.getSetting('gemini_key')}, timeout=15).json()
    except Exception as e:
        log('live subtitles: %s' % e)
        return xbmcgui.Dialog().notification(s('title'), s('failed'), xbmcgui.NOTIFICATION_ERROR, 5000)
    sid = info.get('id')
    dlg = xbmcgui.DialogProgress()
    dlg.create(s('title'), s('starting') + '\n' + s('starting2'))
    ready = False
    for i in range(90):                          # the server needs 2 finished segments (~8-12 s)
        if dlg.iscanceled():
            break
        try:
            st = requests.get('%s/live/%s/status' % (base, sid), timeout=4).json()
        except Exception:
            st = {}
        if st.get('error'):
            break
        if st.get('ready'):
            ready = True
            break
        dlg.update(min(95, i * 4))
        xbmc.sleep(500)
    dlg.close()
    if not ready:
        _stop_server({'sid': sid, 'server': base})
        return xbmcgui.Dialog().notification(s('title'), s('failed'), xbmcgui.NOTIFICATION_ERROR, 5000)
    url = '%s/live/%s/master.m3u8' % (base, sid)
    li = xbmcgui.ListItem(ch['label'], path=url)
    li.setArt({'icon': ch.get('logo') or '', 'thumb': ch.get('logo') or ''})
    li.setMimeType('application/vnd.apple.mpegurl')
    li.setContentLookup(False)
    li.setProperty('inputstream', 'inputstream.adaptive')
    li.getVideoInfoTag().setTitle(ch['label'])
    set_state({'chid': ch['id'], 'channel': ch, 'sid': sid, 'server': base, 'mode': mode, 'url': url})
    from .player_menus import _pl       # 3.3: the process's ONE Player (a Player per call crashed Kodi)
    _pl().play(url, li)
    _subtitles_on(url)


def _subtitles_on(url):
    """turn the stream's Hebrew track on once the player runs (Kodi starts live streams with subtitles off)"""
    import xbmc
    from .player_menus import _pl       # 3.3: the process's ONE Player
    p = _pl()
    _subtitles_on.hits = 0
    for _ in range(80):
        xbmc.sleep(250)
        try:
            if p.isPlayingVideo() and p.getPlayingFile() == url:
                streams = p.getAvailableSubtitleStreams() or []
                if streams:
                    p.setSubtitleStream(0)
                    p.showSubtitles(True)
                    if xbmc.getCondVisibility('VideoPlayer.SubtitlesEnabled'):
                        ok = getattr(_subtitles_on, 'hits', 0) + 1
                        _subtitles_on.hits = ok
                        if ok >= 4:              # still on 1 s later: nothing switched it off again
                            return True
        except RuntimeError:
            pass
    return False


def _stop_server(st):
    import requests
    try:
        requests.post('%s/live/%s/stop' % (st.get('server') or server(), st['sid']), timeout=3)
    except Exception:
        pass


def off():
    st = state()
    set_state({})
    if not st.get('sid'):
        return
    _stop_server(st)
    _rpc('Player.Open', item={'channelid': int(st['chid'])})


def stream_ended(path):
    """service: the live-subtitle stream stopped (viewer zapped / stopped) -> end the server session"""
    st = state()
    if st.get('url') and path == st['url']:
        _stop_server(st)
        set_state({})
