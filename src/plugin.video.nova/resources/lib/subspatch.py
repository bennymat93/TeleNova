# -*- coding: utf-8 -*-
"""Guards for the third-party subtitle services All_Subs and All Subs Plus.

Found by the 0.2.2 deep tests:
  * All_Subs' automatic search keeps running after the video changed or Kodi was asked to quit, then places the
    subtitle it found into whatever plays now (a subtitle of the previous video / another title) and holds Kodi's
    exit. Guards: remember the video of the search (Player.OnPlay), place a subtitle only while that same video
    plays, leave the wait loops as soon as Kodi quits.
  * 1.1.0 (v5): after many quick video starts its queued automatic searches still ran with nothing playing and
    while Kodi quit (Subscene retries held the exit for ~2 min): no search once Kodi quits or no video plays.
  * All Subs Plus' main loop read "Kodi quits" once at start and never ended, so Kodi had to kill it on exit.

Pure Python (no Kodi modules): used by tools/make_build.py and by the NovaTV service at start-up, because the
services update themselves from their repository and lose the change (idempotent, like the POV hook).
"""
import os

MARK = '# BN guard v4'

HELPERS = '''
%s: subtitles only for the video they were searched for, and nothing once Kodi quits
_bn_file = ''
_BN_PLAYER = xbmc.Player()   # ONE Player: Players created in loops and freed while Kodi notified them crashed Kodi


def _bn_playing_file():
    for _ in range(100):
        if monit.abortRequested():
            return ''
        try:
            if _BN_PLAYER.isPlayingVideo():
                return _BN_PLAYER.getPlayingFile()
        except Exception:
            pass
        xbmc.sleep(100)
    return ''


def _bn_same_video():
    try:
        return (not monit.abortRequested()) and _BN_PLAYER.isPlayingVideo() and \\
            (not _bn_file or _BN_PLAYER.getPlayingFile() == _bn_file)
    except Exception:
        return False
''' % MARK

PLACE_SUB = ('def place_sub(video_data,f_result,last_sub_name_in_cache,last_sub_language_in_cache,all_subs,'
             'last_sub_in_cache_is_empty):\n')

EDITS = [
    # every xbmc.Player() of the service -> one shared Player (created with the helpers below)
    ('xbmc.Player()', '_BN_PLAYER'),
    # helpers right after the module's own monitor
    ("ab_req=monit.abortRequested()\n", "ab_req=monit.abortRequested()\n" + HELPERS),
    # both wait loops end when Kodi quits
    ("    while counter<70:\n", "    while counter<70 and not monit.abortRequested():\n"),
    # the video this search is for
    ("        if method=='Player.OnPlay':\n",
     "        if method=='Player.OnPlay':\n            global _bn_file\n            _bn_file = _bn_playing_file()\n"),
    # nothing to download once the video changed or Kodi quits
    (PLACE_SUB, PLACE_SUB + "    if not _bn_same_video():\n        return None, None\n"),
    # its 5 s message pauses end when Kodi quits (xbmc.sleep ignored it: Kodi had to kill the service on exit)
    ('xbmc.sleep(5000)', 'monit.waitForAbort(5)'),
    # never place a subtitle into another video (or while quitting)
    ("            xbmc.sleep(200)\n            _BN_PLAYER.setSubtitles(sub_file)        \n",
     "            xbmc.sleep(200)\n            if not _bn_same_video():\n"
     "                log.warning('BN guard: video changed or Kodi quits - subtitle not placed')\n"
     "                return None, None\n"
     "            _BN_PLAYER.setSubtitles(sub_file)        \n"),
]

PLUS_MARK = '# BN guard plus v1'
PLUS_OLD = "        xbmc.sleep(sleep_time)\n        '''\n        if counter_2_hr"
PLUS_NEW = ("        if monitor.waitForAbort(sleep_time / 1000.0):  %s\n            break\n        '''\n        if counter_2_hr"
            % PLUS_MARK)


def _patch(path, mark, edits):
    with open(path, encoding='utf-8', newline='') as f:
        s = f.read()
    if mark in s:
        return 0
    crlf = '\r\n' in s
    s = s.replace('\r\n', '\n')
    for old, new in edits:
        if old not in s:
            raise RuntimeError('%s changed: %r' % (os.path.basename(os.path.dirname(path)), old[:50]))
        s = s.replace(old, new)
    if crlf:
        s = s.replace('\n', '\r\n')
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(s)
    return 1


MARK5 = '# BN guard v5'
SEARCH = 'def temporary_pop_and_get_subtitles(video_data):\n'
EDITS5 = [(SEARCH, SEARCH + "    if monit.abortRequested() or not _BN_PLAYER.isPlayingVideo():  %s\n"
                            "        return []   # nothing plays any more / Kodi quits: no search\n" % MARK5)]


# v5: the search engine and the message overlay created a new xbmc.Player() every 10-100 ms in worker threads (the
# 0.2.2 crash pattern: Kodi crashed at CloseFile) and never noticed Kodi quitting (exit held ~2 min).
# One Monitor per process (module level, never freed); "is something playing" read as an InfoLabel (no object).
PLAYING = "xbmc.getCondVisibility('Player.HasMedia')"
GENERAL5 = [
    ('import xbmc,xbmcaddon,xbmcvfs,xbmcgui\n',
     'import xbmc,xbmcaddon,xbmcvfs,xbmcgui\n_BN_MON = xbmc.Monitor()   %s: one Monitor per process\n' % MARK5),
    ('            cond=xbmc.Monitor().abortRequested()\n', '            cond=_BN_MON.abortRequested()\n'),
    ('while (not cond) and (xbmc.Player().isPlaying()):', 'while (not _BN_MON.abortRequested()) and %s:' % PLAYING),
    ('xbmc.Player().isPlaying()', PLAYING),
]
ENGINE5 = [
    ('import xbmc,xbmcgui,time,xbmcplugin\n',
     'import xbmc,xbmcgui,time,xbmcplugin\n\n\ndef _bn_quit():   %s\n'
     '    from resources.modules import general\n    return general._BN_MON.abortRequested()\n\n\n' % MARK5),
    ('xbmc.Player().isPlaying()', PLAYING),
    # Kodi quits: stop the source threads like the search time-out does
    ('        if  elapsed_time>ExcludeTime: \n', '        if  elapsed_time>ExcludeTime or _bn_quit(): \n'),
]


# v6: the one-off xbmc.Player() calls of every video start (get_video_data, the sources, the subtitle window) ran in
# worker threads too; each created+freed Player registers for Kodi's player callbacks -> the same crash when freed
# while Kodi delivered one (dump 1.1.0: python3.8.dll+0xdfec1 in a Python thread at CloseFile). One Player per process.
MARK6 = '# BN guard v6'
SHARED = 'from resources.modules.general import _BN_PLAYER   %s\n' % MARK6
# a backlog of queued Player.OnPlay notifications (quick zapping) was replayed one by one, even after Kodi quit
BN_FILE = "            _bn_file = _bn_playing_file()\n"
AUTOSUB6 = [(BN_FILE, BN_FILE + "            if not _bn_file:   %s: nothing plays any more / Kodi quits\n"
                                "                return\n" % MARK6)]
# v7: while Kodi quits the video still counts as playing, so the backlog passed v6: a queued notification for the video
# handled less than 60 s ago is a duplicate (a real replay of the same file after a minute still searches)
MARK7 = '# BN guard v7'
V6_RET = "                return\n"
AUTOSUB7 = [("_bn_file = ''\n", "_bn_file = ''\n_bn_done = ('', 0.0)   %s: the last video handled + when\n" % MARK7),
            ("            if not _bn_file:   %s: nothing plays any more / Kodi quits\n" % MARK6 + V6_RET,
             "            if not _bn_file:   %s: nothing plays any more / Kodi quits\n" % MARK6 + V6_RET +
             "            global _bn_done\n"
             "            if _bn_done[0] == _bn_file and time.time() - _bn_done[1] < 60:\n"
             "                return\n"
             "            _bn_done = (_bn_file, time.time())\n")]
GENERAL6 = [('_BN_MON = xbmc.Monitor()', '_BN_PLAYER = xbmc.Player()   %s: one Player per process\n_BN_MON = xbmc.Monitor()' % MARK6),
            ('xbmc.Player()', '_BN_PLAYER')]



# v8: "no results -> search again in all languages" started a second full search round while Kodi was quitting
MARK8 = '# BN guard v8'
RETRY = "and not all_lang_override:\n"
ENGINE8 = [(RETRY, "and not all_lang_override \\\n"
                   "            and xbmc.getCondVisibility('Player.HasMedia') and not _bn_quit():   %s\n" % MARK8)]


# v9: v5/v6 created the Monitor and Player when general.py was imported, so every short-lived All_Subs script
# (e.g. a search from Kodi's subtitle dialog) created them and freed them at its end - the same crash when that
# happened while a video closed. Created on first real use instead (the long-running service keeps them).
MARK9 = '# BN guard v9'
LAZY = '''class _BNLazy(object):   %s: Kodi objects created on first use, never at import
    def __init__(self, make):
        self._make, self._obj = make, None

    def __getattr__(self, name):
        if self._obj is None:
            self._obj = self._make()
        return getattr(self._obj, name)
''' % MARK9
GENERAL9 = [
    ('_BN_PLAYER = xbmc.Player()   %s: one Player per process\n' % MARK6,
     LAZY + '_BN_PLAYER = _BNLazy(xbmc.Player)   %s: one Player per process\n' % MARK6),
    ('_BN_MON = xbmc.Monitor()   %s: one Monitor per process\n' % MARK5,
     '_BN_MON = _BNLazy(xbmc.Monitor)   %s: one Monitor per process\n' % MARK5),
]


MARK10 = '# BN guard v10'
# the file All_Subs just placed -> NovaTV's service aligns it to the speech (server /align)
AUTOSUB10 = [('_BN_PLAYER.setSubtitles(sub_file)',
              "_BN_PLAYER.setSubtitles(sub_file); __import__('xbmcgui').Window(10000).setProperty('BN.LastSubFile', "
              "str(sub_file))   %s" % MARK10)]


MARK11 = '# BN guard v11'
# 1.4.11: no automatic subtitle search on live TV channels (TV service, or NovaTV's live-subtitle stream): the viewer
# chooses live subtitles with the "Subtitles" button
AUTOSUB11 = [("            if not _bn_file:   %s: nothing plays any more / Kodi quits\n" % MARK6,
              "            if xbmc.getCondVisibility('PVR.IsPlayingTV | PVR.IsPlayingRadio | VideoPlayer.Content(livetv)') "
              "or '/live/' in _bn_file and ':8765/' in _bn_file:   %s\n"
              "                return\n"
              "            if not _bn_file:   %s: nothing plays any more / Kodi quits\n" % (MARK11, MARK6))]


MARK12 = '# BN guard v12'
# 3.1.1: a video with its own Hebrew subtitle track needs no search at all (the search of every video start was the
# slow, heavy part: dozens of site requests in worker threads while the stream was still opening)
HEB12 = '''def _bn_embedded_hebrew():   %s
    """this video carries a Hebrew subtitle track of its own: nothing to search"""
    for _ in range(15):          # the track list is complete a moment after the picture starts
        if monit.abortRequested():
            return False
        try:
            if not _BN_PLAYER.isPlayingVideo():
                return False
            if any((l or '').lower() in ('he', 'heb', 'hebrew', 'iw') for l in _BN_PLAYER.getAvailableSubtitleStreams()):
                return True
            if _BN_PLAYER.getTime() > 1.5:
                return False
        except Exception:
            pass
        xbmc.sleep(200)
    return False


''' % MARK12
AUTOSUB12 = [("def _bn_same_video():\n", HEB12 + "def _bn_same_video():\n"),
             ("            if not _bn_file:   %s: nothing plays any more / Kodi quits\n" % MARK6,
              "            if _bn_file and _bn_embedded_hebrew():   %s\n"
              "                log.warning('BN guard: embedded Hebrew subtitles - no search')\n"
              "                return\n"
              "            if not _bn_file:   %s: nothing plays any more / Kodi quits\n" % (MARK12, MARK6))]


MARK13 = '# BN guard v13'
# 3.3: better detection (the same rules as resources/lib/subdetect.py). v12 read only the language code of each track
# and gave up 1.5 s into the video: a Hebrew track marked "und" with the name "Hebrew" / "עברית" was missed, and so
# was a track list that arrived late on a slow stream - a search ran although the video had Hebrew subtitles. A
# forced Hebrew track (foreign lines only) no longer counts as subtitles of the whole video: the search runs.
HEB13 = '''def _bn_embedded_hebrew():   %s
    """this video carries a full Hebrew subtitle track of its own: nothing to search   %s"""
    import json as _j
    import re as _re
    import time as _t
    rx = _re.compile(u'(^|[^a-z])(heb|hebrew|ivrit)([^a-z]|$)|\\u05e2\\u05d1\\u05e8\\u05d9\\u05ea', _re.I)
    ask = _j.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'Player.GetProperties',
                    'params': {'playerid': 1, 'properties': ['subtitles']}})
    seen, steady, began = -1, 0, _t.time()
    while _t.time() - began < 8 and not monit.abortRequested():
        try:
            if not _BN_PLAYER.isPlayingVideo():
                return False
            res = _j.loads(xbmc.executeJSONRPC(ask)).get('result')
            if res is None:          # the player cannot be asked yet: the plain language list
                subs = [{'language': l} for l in _BN_PLAYER.getAvailableSubtitleStreams()]
            else:
                subs = res.get('subtitles') or []
            for s in subs:
                name = s.get('name') or ''
                lang = (s.get('language') or '').lower().replace('_', '-').split('-')[0]
                if (lang in ('he', 'heb', 'hebrew', 'iw') or rx.search(name)) and \\
                        not (s.get('isforced') or 'forced' in name.lower()):
                    return True
            steady = steady + 1 if len(subs) == seen else 0
            seen = len(subs)
            if steady >= 3 and _BN_PLAYER.getTime() > 2.0:      # the track list stopped changing: no Hebrew
                return False
        except Exception:
            pass
        xbmc.sleep(300)
    return False


''' % (MARK12, MARK13)
AUTOSUB13 = [(HEB12, HEB13)]


MARK14 = '# BN guard v14'
# 3.3: a live stream opened by its address (an HLS channel that is not one of the TV service's) was searched like a
# film: dozens of site requests and parsing threads for a broadcast no subtitle file exists for - and while they
# ran every menu took 3-5 s to open (all Kodi add-ons share one Python lock). No length = live = no search.
# The times are read as labels, which never raise while a video closes (no EXCEPTION lines in Kodi's log).
LIVE14 = '''def _bn_live():   %s
    """the playing video is a live stream: it has no length, so there is no subtitle file to find"""
    try:
        if not _BN_PLAYER.isPlayingVideo():
            return False
        import json as _j

        def _secs(label):
            n = 0
            for part in (xbmc.getInfoLabel(label) or '').split(':'):
                n = n * 60 + int(part)
            return n
        res = _j.loads(xbmc.executeJSONRPC(_j.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'Player.GetProperties',
                                                     'params': {'playerid': 1, 'properties': ['live']}}))).get('result') or {}
        if res.get('live'):
            return True
        return _secs('Player.Time(hh:mm:ss)') >= 3 and _secs('Player.Duration(hh:mm:ss)') == 0
    except Exception:
        return False


''' % MARK14
V12_CALL = ("            if _bn_file and _bn_embedded_hebrew():   %s\n"
            "                log.warning('BN guard: embedded Hebrew subtitles - no search')\n"
            "                return\n" % MARK12)
AUTOSUB14 = [("def _bn_same_video():\n", LIVE14 + "def _bn_same_video():\n"),
             (V12_CALL, V12_CALL +
              "            if _bn_file and _bn_live():   %s\n"
              "                log.warning('BN guard: live stream - no search')\n"
              "                return\n" % MARK14),
             # the track-list wait of v13 read the position with getTime(), which raises on a closing video
             ("            if steady >= 3 and _BN_PLAYER.getTime() > 2.0:      # the track list stopped changing: no Hebrew\n",
              "            if steady >= 3 and (xbmc.getInfoLabel('Player.Time(hh:mm:ss)') or '00:00:00') >= '00:00:03':"
              "      # the track list stopped changing: no Hebrew\n")]


MARK15 = '# BN guard v15'
# 3.3: its two "wait for the video" loops ask the player for the position up to 70 times; when the video was closed
# in the meantime every one of those calls raised and wrote an EXCEPTION line into Kodi's log (47 lines after a few
# quick starts and stops). The position is asked only while a video plays.
AUTOSUB15 = [('vidtime = _BN_PLAYER.getTime()',
              'vidtime = _BN_PLAYER.getTime() if _BN_PLAYER.isPlayingVideo() else 0   %s' % MARK15)]


MARK16 = '# BN guard v16'
# 3.3.1: the v14 check is withdrawn. While a freeze of Kodi during very fast channel changes was hunted, v14 was
# the first suspect (it asks the player about a stream that may just be closing). The freeze later turned out to
# exist in the 3.2.0 build as well, so v14 was not its cause - but the check bought little (TV channels are
# already skipped by guard v11) and it is one question less to a player in the middle of a channel change.
CALL14 = "            if _bn_file and _bn_live():   %s\n" % MARK14
OFF16 = "            if False:   %s (withdrawn in 3.3.1: guard v11 already covers TV channels)   %s\n" % (MARK14, MARK16)
AUTOSUB16 = [(CALL14, OFF16)]


def apply(addon_dir):
    """All_Subs: 1 when a file was changed, 0 when the guards were already there; raises if it changed shape"""
    path = os.path.join(addon_dir, 'autosub.py')
    mods = os.path.join(addon_dir, 'resources', 'modules')
    n = _patch(path, MARK, EDITS) | _patch(path, MARK5, EDITS5) | _patch(path, MARK6, AUTOSUB6) | _patch(path, MARK7, AUTOSUB7) | _patch(path, MARK10, AUTOSUB10) | _patch(path, MARK11, AUTOSUB11) | \
        _patch(os.path.join(mods, 'general.py'), MARK5, GENERAL5) | _patch(os.path.join(mods, 'engine.py'), MARK5, ENGINE5) | \
        _patch(os.path.join(mods, 'engine.py'), MARK8, ENGINE8)
    # general.py first: _BN_PLAYER must exist there before the others import it (replace-all runs after the anchor edit,
    # so general's own new line keeps its xbmc.Player())
    g = os.path.join(mods, 'general.py')
    n |= _patch(g, MARK6, GENERAL6[:1])
    with open(g, encoding='utf-8', newline='') as f:
        s = f.read()
    head, sep, rest = s.partition('_BN_MON = xbmc.Monitor()')
    if 'xbmc.Player()' in rest:
        with open(g, 'w', encoding='utf-8', newline='') as f:
            f.write(head + sep + rest.replace('xbmc.Player()', '_BN_PLAYER'))
        n = 1
    n |= _patch(g, MARK9, GENERAL9)
    for rel in (('resources', 'modules', 'engine.py'), ('resources', 'modules', 'sub_window.py'),
                ('resources', 'sources', 'bsplayer.py')):
        p = os.path.join(addon_dir, *rel)
        if not os.path.exists(p):
            continue
        with open(p, encoding='utf-8', newline='') as f:
            s = f.read()
        if MARK6 in s:
            continue
        crlf = '\r\n' in s
        lines = s.replace('\r\n', '\n').split('\n')
        at = next(i for i, l in enumerate(lines) if l.startswith(('import ', 'from ')) and '__future__' not in l)
        lines.insert(at + 1, SHARED.rstrip('\n'))
        s = '\n'.join(lines[:at + 2]) + '\n' + '\n'.join(lines[at + 2:]).replace('xbmc.Player()', '_BN_PLAYER')
        with open(p, 'w', encoding='utf-8', newline='') as f:
            f.write(s.replace('\n', '\r\n') if crlf else s)
        n = 1
    n |= _patch(path, MARK12, AUTOSUB12)
    n |= _patch(path, MARK13, AUTOSUB13)
    n |= _patch(path, MARK14, AUTOSUB14)
    n |= _patch(path, MARK15, AUTOSUB15)
    n |= _patch(path, MARK16, AUTOSUB16)
    return n


def apply_plus(addon_dir):
    """All Subs Plus: its main loop ends when Kodi quits"""
    return _patch(os.path.join(addon_dir, 'autosub.py'), PLUS_MARK, [(PLUS_OLD, PLUS_NEW)])
