# -*- coding: utf-8 -*-
"""NovaTV background service:
 * watch history with date + time for every played item
 * AI Hebrew subtitles when no Hebrew subtitle was found, or on request (player button)
 * every new video starts clean (no subtitles / settings carried over; only 'watched' is kept)
 * periodic IPTV merge
 * open NovaTV on start
"""
import json
import os
import re
import threading
import time
from urllib.parse import urlencode

import xbmc
import xbmcgui
import xbmcvfs

from resources.lib.common import monitor

from resources.lib.common import ADDON, ADDON_PATH, T, load, save, now_str, log, PROFILE
from resources.lib.subsnet import discover_server

# Window(10000) properties that belong to ONE video (cleared at every start)
# 3.3: + AIMode / PrimaryFile - both are set by the menus AFTER the video started (begin() runs first), so clearing
# them here never wipes a value of the current video; it only stops a leftover reaching the next one
SESSION_PROPS = ('NovaTV.ABLoop', 'NovaTV.Dual', 'NovaTV.SyncMarkAudio', 'NovaTV.SyncMarkSub', 'NovaTV.SubsSource', 'BN.OSDInfo',
                 'NovaTV.AIMode', 'NovaTV.PrimaryFile')
HEB_CODES = ('heb', 'he', 'hebrew', 'iw')
WIN = xbmcgui.Window(10000)
_HIST_LOCK = threading.Lock()       # 3.3: history.json is written in a thread - one writer at a time


def status(text):
    """Status visible to skins as $INFO[Window(Home).Property(NovaTV.AISubs)]."""
    WIN.setProperty('NovaTV.AISubs', text)


def forget_file_settings(path):
    """Kodi remembers subtitle/audio track, delays, zoom ... per file (MyVideos 'settings' table).
    Drop them for a played stream so the next start of any video begins clean (history/watched are kept)."""
    import glob
    import sqlite3
    import xbmcvfs
    dbs = sorted(glob.glob(os.path.join(xbmcvfs.translatePath('special://database/'), 'MyVideos*.db')),
                 key=lambda f: int(re.sub(r'\D', '', os.path.basename(f)) or 0))
    if not dbs or not path:
        return 0
    con = sqlite3.connect(dbs[-1], timeout=10)
    try:
        cur = con.execute("DELETE FROM settings WHERE idFile IN (SELECT files.idFile FROM files JOIN path ON "
                          "files.idPath = path.idPath WHERE path.strPath || files.strFilename = ? OR files.strFilename = ?)",
                          (path, path))
        con.commit()
        return cur.rowcount
    finally:
        con.close()


YT_ID = re.compile(r'(?:[?&]file=|video_id=|youtu\.be/|[?&]v=)([\w-]{11})')


def youtube_id(text):
    m = YT_ID.search(text or '')
    return m.group(1) if m and ('youtube' in text or 'youtu.be' in text) else ''


class Flow:
    """Subtitles for ONE video. A flow never touches a later video: every step checks it still owns the player."""

    def __init__(self, player, forced):
        self.p = player
        self.gen = player.gen
        self.file = player.file
        self.forced = forced
        self.cancelled = False
        self.held = False
        self.held_at = 0
        self.bar = None

    def same_video(self):
        return self.gen == self.p.gen and self.p.active

    def alive(self):
        return self.same_video() and not self.cancelled

    # ------------------------------------------------------------ "subtitles ready before watching"
    def hold(self):
        """pause at the start while Hebrew subtitles are prepared (setting ai_prepare)"""
        if not xbmc.getCondVisibility('Player.Paused'):
            self.p.pause()
        self.held, self.held_at = True, time.time()
        self.bar = xbmcgui.DialogProgressBG()
        self.bar.create('TeleNova', T('sub_check'))

    def still_held(self):
        """the viewer pressing Play ends the hold; never hold longer than 4 min"""
        if self.held and (not xbmc.getCondVisibility('Player.Paused') or time.time() - self.held_at > 240):
            self.release()
        return self.held

    def release(self):
        if self.bar:
            try:
                self.bar.close()
            except Exception:
                pass
            self.bar = None
        if self.held:
            self.held = False
            # only un-pause the video we paused - never the next one
            if self.same_video() and xbmc.getCondVisibility('Player.Paused'):
                self.p.pause()

    def run(self):
        try:
            self._run()
        except RuntimeError as e:          # playback ended while we were still reading it: nothing to do
            log('subtitles: playback ended (%s)' % e)
        except Exception as e:
            log('subtitles: %s' % e, xbmc.LOGWARNING)
        finally:
            self.release()
            if self.p.flow is self and not self.alive():
                status('')

    def _run(self):
        p, mon = self.p, monitor()
        if '/live/' in self.file and xbmcgui.Window(10000).getProperty('BN.LiveSubs'):
            return                                   # NovaTV's live-subtitle stream carries its own subtitles
        if xbmc.getCondVisibility('PVR.IsPlayingTV | PVR.IsPlayingRadio | VideoPlayer.Content(livetv)'):
            if self.forced:
                xbmcgui.Dialog().notification('TeleNova', T('ai_nolive'), xbmcgui.NOTIFICATION_WARNING, 4000)
            return                                   # live TV: no end, nothing to transcribe ahead
        path = self.file
        network = path.startswith(('http://', 'https://'))
        use_ai = self.forced or ADDON.getSettingBool('ai_subs')
        import requests
        base = ADDON.getSetting('sub_server').rstrip('/')
        # a stream of this box itself (the Telegram engine's local proxy) can be read by the subtitle server only
        # when that server runs on this same machine
        local_stream = path.startswith(('http://127.0.0.1', 'http://localhost'))
        server_local = '127.0.0.1' in base or 'localhost' in base
        ai_possible = network and (not local_stream or server_local)
        if not self.forced:
            # 3.1.1 - the start of a video, in order, nothing here pauses the video before step 3:
            # 1. this video's own Hebrew track: chosen as soon as the player lists it (about a second) - done,
            #    nothing is searched (All_Subs is told the same by its guard v12)
            # 3.3: the track list of a slow stream (Telegram, IPTV VOD) can arrive a few seconds after the picture:
            # wait until it stopped changing (at most 8 s) instead of a fixed 3 s
            from resources.lib import subdetect
            seen, steady = -1, 0
            for _ in range(16):
                if p.has_hebrew():
                    log('subtitles: embedded Hebrew track - no search')
                    return
                n = len(subdetect.tracks() or [])
                steady = steady + 1 if n == seen else 0
                seen = n
                if not p.isPlayingVideo():
                    return
                if steady >= 3 and subdetect.play_secs() >= 3:      # read as a label: never raises on a closing video
                    break
                if mon.waitForAbort(0.5) or not self.alive():
                    return
            # 3.3: a live stream opened by its address (not through the TV service) has no subtitle file to wait
            # for and nothing to transcribe ahead - the same rule All_Subs follows (guard v14)
            if subdetect.is_live():
                log('subtitles: live stream - nothing to search')
                return
            # 2. is AI generation possible at all? one short check; without a reachable server nothing waits for it
            kind = p.getVideoInfoTag().getMediaType()
            server_ok = False
            if use_ai and ai_possible:
                server_ok = _server_up(base)
                if not server_ok and not self.alive():
                    return
            # 3. the video is paused only when the AI server really answers and the viewer asked for it
            if server_ok and kind in ('movie', 'episode') and ADDON.getSettingBool('ai_prepare'):
                self.hold()
            # a human Hebrew subtitle (All_Subs) gets its chance while the video already plays
            wait = int(ADDON.getSetting('ai_wait') or 10)
            for i in range(wait):
                if mon.waitForAbort(1) or not self.alive():
                    return
                if p.has_hebrew():
                    return
                if self.bar:
                    self.bar.update(int(i * 50 / max(1, wait)), 'TeleNova', T('sub_check'))
                self.still_held()
            if not use_ai or not self.alive():
                return
            if not server_ok:
                log('AI subs: %s' % ('stream of this box - the subtitle server cannot read it' if not ai_possible
                                     else 'subtitle server not reachable'))
                return
        if not network:
            log('AI subs: not a network stream (%s)' % path[:60])
            if self.forced:
                xbmcgui.Dialog().notification('TeleNova', T('ai_nonet'), xbmcgui.NOTIFICATION_WARNING, 5000)
            return
        if self.forced and not ai_possible:
            xbmcgui.Dialog().notification('TeleNova', T('ai_noserver'), xbmcgui.NOTIFICATION_WARNING, 5000)
            return
        if self.forced:
            discover_server()                   # the button: re-find the PC if its address changed
        base = ADDON.getSetting('sub_server').rstrip('/')
        tag = p.getVideoInfoTag()
        job = {'url': path, 'title': tag.getTVShowTitle() or tag.getTitle(), 'season': tag.getSeason(),
               'episode': tag.getEpisode(), 'imdb': tag.getIMDBNumber(), 'tmdb': tag.getUniqueID('tmdb'),
               'position': p.getTime(), 'gemini_key': ADDON.getSetting('gemini_key')}
        # YouTube plays through its local proxy: the PC cannot open that URL - send the video id instead
        mode = WIN.getProperty('NovaTV.AIMode') or 'ai'          # 'mt' = machine translation only (Auto, no AI)
        WIN.clearProperty('NovaTV.AIMode')
        job['mode'] = mode
        yid = youtube_id(path + ' ' + xbmc.getInfoLabel('Player.FilenameAndPath') + ' ' +
                         xbmc.getInfoLabel('Player.FolderPath'))
        if yid:
            job['youtube_id'] = yid
        try:
            r = requests.post(base + '/jobs', json=job, timeout=10)
            r.raise_for_status()
            job_id = r.json()['id']
        except Exception as e:
            log('AI subs server: %s' % e, xbmc.LOGWARNING)
            xbmcgui.Dialog().notification('TeleNova', T('ai_noserver'), xbmcgui.NOTIFICATION_WARNING, 5000)
            return
        xbmcgui.Dialog().notification('TeleNova', T('ai_forced') if self.forced else T('ai_start'),
                                      xbmcgui.NOTIFICATION_INFO, 5000)
        status('%s 0%%' % T('ai_progress'))
        loaded_upto, last_note, down_since, warned = -1.0, 0, 0, False
        other = False       # Hebrew from another source (All_Subs / YouTube captions) arrived before the AI
        # 3.3: loaded_upto also moves when there were no cues yet - "ready"/"stored" need a file that really exists
        have_file, srt_path = False, ''
        ai_dir = os.path.join(PROFILE, 'ai', job_id)
        os.makedirs(ai_dir, exist_ok=True)
        while self.alive() and not mon.abortRequested():
            try:
                r = requests.get('%s/jobs/%s' % (base, job_id), timeout=10)
                if r.status_code == 404:        # server restarted: hand the job over again (it resumes)
                    job['position'] = p.getTime() if self.alive() else job['position']
                    r = requests.post(base + '/jobs', json=job, timeout=10)
                st = r.json()
                down_since, warned = 0, False
            except Exception:
                down_since = down_since or time.time()
                if time.time() - down_since > 120 and not warned:
                    xbmcgui.Dialog().notification('TeleNova', T('ai_noserver'), xbmcgui.NOTIFICATION_WARNING, 5000)
                    warned = True
                    discover_server()
                    base = ADDON.getSetting('sub_server').rstrip('/')
                if mon.waitForAbort(5):
                    return
                continue
            pct = int(st.get('progress', 0))
            status('%s %d%%' % (T('ai_progress'), pct))
            now = time.time()
            if now - last_note > 60 and st.get('state') != 'done':
                xbmcgui.Dialog().notification(T('ai_progress'), '%d%% · %s' % (pct, st.get('stage', '')),
                                              xbmcgui.NOTIFICATION_INFO, 3000, False)
                last_note = now
            ready = float(st.get('ready_until', 0))
            done = st.get('state') == 'done'
            if self.still_held() and self.bar:
                self.bar.update(50 + min(49, pct // 2), 'TeleNova', '%s %d%%' % (T('ai_prepare'), pct))
            # load the first part as soon as it exists, then again for every meaningful new chunk and at the end
            if not self.forced and loaded_upto < 0 and not other and p.has_hebrew():
                # the fastest source wins: keep it on screen, the AI goes on in the background (BN subtitle window)
                other = True
                log('AI subtitles: Hebrew from another source is already showing - AI continues in the background')
            first = loaded_upto < 0 and ready > 0
            if first or ready - loaded_upto >= 120 or (done and ready > loaded_upto):
                try:
                    data = requests.get('%s/jobs/%s/srt' % (base, job_id), timeout=20).content
                    if not self.alive():
                        return
                    if b'-->' not in data:
                        # nothing to show yet: never hand Kodi an empty file ("Unable to create subtitle parser")
                        log('AI subtitles: no cues yet (%d bytes) - not loaded' % len(data))
                        loaded_upto = ready if not done else loaded_upto
                        if done:
                            raise RuntimeError('empty result')
                    else:
                        # a new name per version: Kodi does not reload a path it already has; the name is what
                        # the subtitle list shows ("BN AI" = complete, "BN AI 12m" = first 12 minutes)
                        name = ('BN AI' if job.get('mode') != 'mt' else 'BN auto') + ('' if done else ' %dm' % max(1, int(ready // 60)))
                        srt_path = os.path.join(ai_dir, name + '.he.srt')
                        with open(srt_path, 'wb') as f:
                            f.write(data)
                        WIN.setProperty('NovaTV.AISrt', srt_path)          # the BN subtitle window offers it
                        if not self.forced and (other or WIN.getProperty('NovaTV.SubsChosen') == self.file):
                            # the viewer picked a subtitle by hand: keep it; the AI file waits in the BN menu
                            log('AI subtitles ready up to %ds - kept the viewer\'s choice' % ready)
                            loaded_upto = ready
                            have_file = True
                        else:
                            before = len(p.getAvailableSubtitleStreams())
                            p.setSubtitles(srt_path)      # adds the file and makes it the active track
                            p.chosen = self.gen
                            p.showSubtitles(True)
                            mon.waitForAbort(1)
                            if not self.same_video() or not p.isPlayingVideo():
                                return              # the video is closing: never touch the player mid-close (crash)
                            shown = len(p.getAvailableSubtitleStreams()) > before or _current_sub_is(name)
                            log('AI subtitles loaded up to %ds (%s)%s' % (ready, 'button' if self.forced else 'auto',
                                                                          '' if shown else ' - Kodi did not list the track'))
                            loaded_upto = ready
                            have_file = True
                            if done and not shown:
                                raise RuntimeError('player did not accept the subtitle file')
                    if self.still_held() and (done or ready >= job['position'] + 120):
                        self.release()      # the first part is subtitled: start watching
                except Exception as e:
                    log('AI subs load: %s' % e, xbmc.LOGWARNING)
                    if done:
                        status('')
                        xbmcgui.Dialog().notification('TeleNova', T('ai_empty'), xbmcgui.NOTIFICATION_WARNING, 6000)
                        return
            if done and have_file:
                try:                                   # every created subtitle also goes to the subtitle store
                    from resources.lib import player_menus, substore
                    base = substore.video_base(job['title'], job['season'], job['episode'], self.file)
                    with open(srt_path, encoding='utf-8', errors='replace') as f:
                        stored = substore.save(player_menus.subs_folder(), base, 'he', 'auto' if job.get('mode') == 'mt' else 'ai',
                                               text=f.read())
                    WIN.setProperty('NovaTV.PrimaryFile', srt_path)
                    log('subtitle stored: %s' % stored)
                except Exception as e:
                    log('subtitle store: %s' % e, xbmc.LOGWARNING)
            if done:
                status('')
                if have_file:
                    xbmcgui.Dialog().notification('TeleNova', T('ai_ready'), xbmcgui.NOTIFICATION_INFO, 4000)
                else:
                    xbmcgui.Dialog().notification('TeleNova', T('ai_empty'), xbmcgui.NOTIFICATION_WARNING, 6000)
                return
            if st.get('state') == 'error':
                status('')
                xbmcgui.Dialog().notification('TeleNova', '%s: %s' % (T('error'), st.get('error', '')[:80]),
                                              xbmcgui.NOTIFICATION_ERROR, 6000)
                return
            if mon.waitForAbort(5):
                return


_SERVER = {'at': 0.0, 'ok': False, 'base': ''}


def _server_up(base):
    """the AI subtitle server answers (1.5 s check, remembered for a minute; one LAN re-discovery when it does not)"""
    import requests
    if _SERVER['base'] == base and time.time() - _SERVER['at'] < 60:
        return _SERVER['ok']
    ok = False
    try:
        ok = requests.get(base + '/health', timeout=1.5).status_code == 200
    except Exception:
        ok = False
    if not ok and '127.0.0.1' not in base and 'localhost' not in base:
        try:
            discover_server()
            nb = ADDON.getSetting('sub_server').rstrip('/')
            if nb != base:
                base = nb
                ok = requests.get(base + '/health', timeout=1.5).status_code == 200
        except Exception:
            ok = False
    _SERVER.update(at=time.time(), ok=ok, base=base)
    return ok


def _read_sub(path):
    data = open(path, 'rb').read()
    for enc in ('utf-8-sig', 'cp1255', 'latin-1'):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return ''


def align_job():
    """a subtitle placed by All_Subs (guard v10 sets BN.LastSubFile) is timed for some release, not necessarily this
    file: the subtitle server aligns it to this video's speech (offset + frame-rate drift, server/subalign.py) and the
    synced copy replaces it. Only .srt; nothing happens when the server is away or the file is already in sync."""
    import requests
    win, mon, seen = xbmcgui.Window(10000), monitor(), ''
    waiting, since = '', 0.0
    while not mon.waitForAbort(2):
        f = win.getProperty('BN.LastSubFile')
        if not f or f == seen:
            continue
        # 3.3: a file announced a moment before the playback registers is tried again on the next ticks
        # (at most 30 s for the same file) instead of being skipped for good
        if f != waiting:
            waiting, since = f, time.time()
        if time.time() - since > 30:
            seen = f
            continue
        from resources.lib.player_menus import _pl
        p = _pl()                     # the process's ONE Player (per-call Players crashed Kodi)
        try:
            if not f.lower().endswith('.srt') or ADDON.getSetting('auto_align') == 'false':
                seen = f              # never eligible
                continue
            if not p.isPlayingVideo():
                continue              # nothing plays yet: left unseen
            seen = f
            path = p.getPlayingFile()
            tag = p.getVideoInfoTag()
            spec = {'url': path, 'title': tag.getTVShowTitle() or tag.getTitle(), 'season': tag.getSeason(),
                    'episode': tag.getEpisode(), 'tmdb': tag.getUniqueID('tmdb'), 'srt': _read_sub(f)}
            yid = youtube_id(path + ' ' + xbmc.getInfoLabel('Player.FilenameAndPath'))
            if yid:
                spec['youtube_id'] = yid
            base = ADDON.getSetting('sub_server').rstrip('/')
            if not base:
                continue
            r = requests.post(base + '/align', json=spec, timeout=240).json()
            info = r.get('info') or {}
            log('subtitle align %s: %s' % (os.path.basename(f), info))
            if not r.get('srt') or not p.isPlayingVideo() or p.getPlayingFile() != path:
                continue
            # the viewer (or the AI flow) chose another subtitle meanwhile: keep that choice
            if win.getProperty('NovaTV.SubsChosen') == path or win.getProperty('BN.LastSubFile') != f:
                log('subtitle align: another subtitle was chosen meanwhile - synced copy not loaded')
                continue
            out = os.path.join(PROFILE, 'aligned')
            os.makedirs(out, exist_ok=True)
            name = os.path.splitext(os.path.basename(f))[0]
            name = re.sub(r'\.(he|heb|iw)$', '', name)[:80] + ' BN sync.he.srt'
            dst = os.path.join(out, name)
            with open(dst, 'w', encoding='utf-8') as fh:
                fh.write(r['srt'])
            p.setSubtitles(dst)
            drift = '' if info.get('scale', 1) == 1 else ', fps %.3f' % info['scale']
            xbmcgui.Dialog().notification('TeleNova', T('synced') % (info.get('offset', 0), drift), xbmcgui.NOTIFICATION_INFO, 4000)
        except Exception as e:
            log('subtitle align: %s' % e, xbmc.LOGWARNING)


def _current_sub_is(name):
    """the active subtitle track is the file just loaded (a replaced file of the same name keeps the track count)"""
    try:
        r = json.loads(xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'Player.GetProperties',
                                                        'params': {'playerid': 1, 'properties': ['currentsubtitle']}})))
        return name.split(' ')[0] in ((r.get('result') or {}).get('currentsubtitle') or {}).get('name', '')
    except Exception:
        return False


class Player(xbmc.Player):
    """Every new video starts clean: no subtitles, pause, job or status left over from the previous one.
    Only the history ('watched') is carried over."""

    def __init__(self):
        super().__init__()
        self.gen = 0            # bumped on every start/end: flows of an older video stop by themselves
        self.file = ''
        self.active = False
        self.flow = None
        self.chosen = 0         # gen whose subtitles were deliberately switched on
        self.lock = threading.Lock()

    def playing_file(self):
        try:
            return self.getPlayingFile() if self.isPlayingVideo() else ''
        except RuntimeError:
            return ''

    def onAVStarted(self):
        # 3.3: the "one more try" channel belongs to the playback it was set for - anything else that plays
        # clears it, so a later unrelated playback error never re-opens an old channel
        try:
            cur = self.getPlayingFile() if self.isPlaying() else ''
        except RuntimeError:
            cur = ''
        if cur and cur != getattr(self, 'tv_try', ''):
            self.tv_try = ''
        path = self.playing_file()
        if not path:
            return
        if self.active and path == self.file:
            return          # the same video announced again (stream switch): keep what the viewer chose
        self.begin(path)
        try:
            self.record_history()
        except Exception as e:
            log('history: %s' % e, xbmc.LOGWARNING)
        self.start_flow(forced=False)

    def begin(self, path):
        with self.lock:
            if self.flow:
                self.flow.cancelled = True
            self.gen += 1
            self.file, self.active, self.flow = path, True, None
        status('')
        WIN.clearProperty('NovaTV.AISrt')            # the previous video's AI file is not offered here
        WIN.clearProperty('NovaTV.SubsChosen')
        self.chosen = 0
        gen = self.gen
        # 3.3: live TV keeps the channel's own subtitle choice - only videos start with subtitles off
        live = path.startswith('pvr://') or xbmc.getCondVisibility(
            'PVR.IsPlayingTV | PVR.IsPlayingRadio | VideoPlayer.Content(livetv)')
        if '/live/' in path and WIN.getProperty('BN.LiveSubs'):
            WIN.setProperty('NovaTV.SubsChosen', path)   # the live-subtitle stream: its Hebrew track IS the choice
            self.chosen = gen
        elif not live:
            try:
                self.showSubtitles(False)      # subtitles must be chosen (or generated) for THIS video
            except RuntimeError:
                pass

        for prop in SESSION_PROPS:                     # everything the panels tied to the previous video
            WIN.clearProperty(prop)

        def zero_state():
            """PlaybackSession start (v1.1.0 phase 5): nothing from the previous video carries over"""
            from resources.lib import playerctl
            if monitor().waitForAbort(0.8) or gen != self.gen:
                return
            try:
                # nothing carries over from the previous video - except this video's own remembered manual offset
                want = playerctl.remembered_delay(self.file)
                if abs(playerctl.sub_delay() - want) > 0.001:
                    playerctl.set_sub_delay(want, remember=False)
                if abs(playerctl.audio_delay()) > 0.001:
                    playerctl.set_audio_delay(0.0)
                if abs(playerctl.speed() - 1.0) > 0.05:
                    playerctl.set_speed(1.0)
                playerctl.reset_view()
                policy = ADDON.getSetting('resume_same') or '0'        # 0 ask (Kodi), 1 always, 2 never
                if policy == '2' and self.getTime() > 5:
                    self.seekTime(0)
                # 3.3: the "session start" log line cost 2 JSON-RPC calls at every start - dropped
            except Exception as e:
                log('session reset: %s' % e, xbmc.LOGWARNING)
        threading.Thread(target=zero_state, daemon=True).start()
        threading.Thread(target=self.ab_loop, args=(gen,), daemon=True).start()

        def again():
            # on playlist auto-advance (next episode) Kodi applies the item's saved subtitle state a moment
            # AFTER onAVStarted: switch off again unless this video's subtitles were chosen in the meantime
            if live:                # 3.3: a TV channel's subtitles stay as the channel / viewer set them
                return
            for delay in (1.0, 2.0):
                if monitor().waitForAbort(delay) or gen != self.gen or self.chosen == gen or \
                        WIN.getProperty('NovaTV.SubsChosen') == path:
                    return
                try:
                    self.showSubtitles(False)
                except RuntimeError:
                    return
        threading.Thread(target=again, daemon=True).start()

    def ab_loop(self, gen):
        """A-B loop set in the player settings (Window property 'a,b'), bound to this video"""
        while gen == self.gen and not monitor().abortRequested():
            v = WIN.getProperty('NovaTV.ABLoop')
            if ',' in v:
                try:
                    a, b = [float(x) for x in v.split(',')]
                    if self.isPlayingVideo() and self.getTime() >= b:
                        self.seekTime(a)
                except (ValueError, RuntimeError):
                    pass
            # 3.3: no loop set -> look only every 2 s (was 0.4 s for the whole video)
            if monitor().waitForAbort(0.4 if ',' in v else 2):
                return

    def finish(self):
        with self.lock:
            if self.flow:
                self.flow.cancelled = True
            self.gen += 1
            ended, self.file, self.active, self.flow = self.file, '', False, None
        status('')
        if ':8765/live/' in (ended or '') or '/live/' in (ended or ''):
            try:            # the live-subtitle stream ended (zap / stop): the server stops re-streaming it
                from resources.lib import livesubs
                livesubs.stream_ended(ended)
            except Exception as e:
                log('live subtitles: %s' % e, xbmc.LOGWARNING)
        if ended.startswith(('http://', 'https://')):
            # Kodi stores the file's settings right after the stop: clear them once it has
            def later():
                monitor().waitForAbort(6)
                try:
                    n = forget_file_settings(ended)
                    if n:
                        log('cleared %d stored player setting(s) of the last video' % n)
                except Exception as e:
                    log('player settings reset: %s' % e, xbmc.LOGWARNING)
            threading.Thread(target=later, daemon=True).start()

    def onPlayBackStopped(self):
        self.finish()

    onPlayBackEnded = onPlayBackStopped

    def onPlayBackStarted(self):
        try:        # asked only while something plays: a stream that closes at once wrote an EXCEPTION line per start
            path = self.getPlayingFile() if self.isPlaying() else ''
        except RuntimeError:
            path = ''
        if path.startswith('pvr://'):
            self.tv_try = path

    def onPlayBackError(self):
        # 1.4.11: a TV channel that fails to open gets ONE more try 2 s later - subscription lists allow only 1-2
        # connections and the previous channel's connection may still be open when the viewer zaps quickly
        self.finish()
        path, last = getattr(self, 'tv_try', ''), getattr(self, 'tv_retry', ('', 0))
        if not path or (last[0] == path and time.time() - last[1] < 30):
            return
        self.tv_retry = (path, time.time())

        def again():
            if monitor().waitForAbort(2):       # 3.3: never sleeps through Kodi's exit
                return
            if not self.isPlaying():
                log('TV channel failed to open - one more try: %s' % path)
                self.play(path)
        threading.Thread(target=again, daemon=True).start()

    def start_flow(self, forced):
        with self.lock:
            if self.flow:
                self.flow.cancelled = True
            flow = self.flow = Flow(self, forced)
        threading.Thread(target=flow.run, daemon=True).start()

    def ai_now(self):
        """'AI subtitles' button: generate Hebrew AI subtitles for this video, even when others exist"""
        path = self.playing_file()
        log('AI subtitles requested for %s' % path[:80])
        if not path:
            xbmcgui.Dialog().notification('TeleNova', T('ai_noplay'), xbmcgui.NOTIFICATION_WARNING, 4000)
            return
        if not (self.active and path == self.file):     # started before the service was running
            with self.lock:
                self.gen += 1
                self.file, self.active = path, True
        self.start_flow(forced=True)

    # ------------------------------------------------------------ history
    def record_history(self):
        if not self.isPlayingVideo():
            return
        tag = self.getVideoInfoTag()
        tmdb_id = tag.getUniqueID('tmdb') or xbmc.getInfoLabel('VideoPlayer.UniqueID(tmdb)')
        show = tag.getTVShowTitle()
        s, e = tag.getSeason(), tag.getEpisode()
        if show and e > 0:
            label = '%s  S%02dE%02d  %s' % (show, s, e, tag.getTitle())
            key = 'tv:%s:%s:%s' % (tmdb_id or show, s, e)
            play = ('plugin://plugin.video.nova/?' + urlencode({'a': 'play', 'm': 'episode', 'id': tmdb_id, 's': s, 'e': e,
                                                                'q': '%s %s' % (show, tag.getTitle())})) if tmdb_id else ''
        else:
            label = tag.getTitle() or xbmc.getInfoLabel('Player.Title')
            key = 'movie:%s' % (tmdb_id or label)
            play = ('plugin://plugin.video.nova/?' + urlencode({'a': 'play', 'm': 'movie', 'id': tmdb_id, 'q': label})) if tmdb_id else ''
        entry = {'key': key, 'label': label, 'when': now_str(), 'ts': time.time(), 'play': play,
                 'plot': (tag.getPlot() or '')[:300], 'thumb': xbmc.getInfoLabel('Player.Art(thumb)'),
                 'fanart': xbmc.getInfoLabel('Player.Art(fanart)')}

        def write():
            # 3.3: the file is read and rewritten off the Player callback thread; 500 entries, short plots
            try:
                if WIN.getProperty('NovaTV.restoring'):     # a backup is being restored: never write over it
                    return
                with _HIST_LOCK:
                    hist = [h for h in load('history.json', []) if h.get('key') != key]
                    hist.insert(0, entry)
                    save('history.json', hist[:500])
            except Exception as e:
                log('history: %s' % e, xbmc.LOGWARNING)
        threading.Thread(target=write, daemon=True).start()

    # ------------------------------------------------------------ subtitles
    def has_hebrew(self):
        """a Hebrew track of the playing video (embedded, or added by All_Subs) -> make it the active one.
        Never raises: while a video closes the player calls fail, and that simply means "no"."""
        try:
            if not self.isPlayingVideo():
                return False
            active = (xbmc.getInfoLabel('VideoPlayer.SubtitlesLanguage') or '').lower()
            if xbmc.getCondVisibility('VideoPlayer.SubtitlesEnabled') and active in HEB_CODES:
                self.chosen = self.gen
                return True
            # 3.3: language code OR track name ("Hebrew" / "עברית" on a track marked "und"); a forced track is
            # not a subtitle of the whole video (resources/lib/subdetect.py)
            from resources.lib import subdetect
            subs = subdetect.tracks()
            if subs is None:                 # JSON-RPC not answering: the plain language list
                subs = [{'index': i, 'language': lang} for i, lang in enumerate(self.getAvailableSubtitleStreams())]
            i = subdetect.hebrew_index(subs)
            if i >= 0:
                self.chosen = self.gen
                WIN.setProperty('NovaTV.SubsChosen', self.file)    # nothing switches it off again
                self.setSubtitleStream(i)
                self.showSubtitles(True)
                return True
        except RuntimeError:
            return False
        return False


class Monitor(xbmc.Monitor):
    """NotifyAll(plugin.video.nova,ai_now) from the player's AI button / NovaTV"""

    def __init__(self, player):
        super().__init__()
        self.player = player

    def onNotification(self, sender, method, data):
        if sender == 'plugin.video.nova' and method.endswith('ai_now'):
            threading.Thread(target=self.player.ai_now, daemon=True).start()


def main():
    monitor()               # the shared Monitor is created here, on the main thread, and lives until exit
    player = Player()
    mon = Monitor(player)
    try:        # boxes updated from the repository: add the AI subtitle button to the installed skin once
        import xbmcvfs
        from resources.lib import skinpatch
        skin_xml = xbmcvfs.translatePath('special://home/addons/skin.fentastic/xml')
        if os.path.isdir(skin_xml) and skinpatch.apply(skin_xml):
            log('AI subtitle button added to the skin')
            xbmc.executebuiltin('ReloadSkin()')
    except Exception as e:
        log('skin button: %s' % e, xbmc.LOGWARNING)
        try:    # 3.3: a skin file that changed shape stopped the buttons - the BN player does not depend on them
            if os.path.isdir(skin_xml) and skinpatch.bn_player(skin_xml):
                xbmc.executebuiltin('ReloadSkin()')
        except Exception as e2:
            log('skin BN player: %s' % e2, xbmc.LOGWARNING)
    try:        # every created subtitle is saved in one folder; Kodi uses it as its subtitle folder too
        from resources.lib import player_menus, playerctl
        folder = player_menus.subs_folder()
        playerctl.rpc('Settings.SetSettingValue', setting='subtitles.storagemode', value=1)
        playerctl.rpc('Settings.SetSettingValue', setting='subtitles.custompath', value=folder)
        from resources.lib import substore
        policy = ['keep_all', 'keep_last', 'older_than'][int(ADDON.getSetting('subs_cleanup') or 0)]
        n = int(ADDON.getSetting('subs_keep_last') or 10)
        gone = substore.cleanup(folder, policy, keep_last=n, older_days=n)
        if gone:
            log('subtitle cleanup: %d file(s)' % len(gone))
    except Exception as e:
        log('subtitle folder: %s' % e, xbmc.LOGWARNING)
    try:        # VLC-style keys (docs/v1.1.0/KEYMAP.md)
        import shutil
        import xbmcvfs
        src = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'resources', 'keymaps', 'bn_player.xml')
        dst = xbmcvfs.translatePath('special://profile/keymaps/bn_player.xml')
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.exists(dst) or open(dst, 'rb').read() != open(src, 'rb').read():
            shutil.copyfile(src, dst)
            xbmc.executebuiltin('Action(reloadkeymaps)')
    except Exception as e:
        log('keymap: %s' % e, xbmc.LOGWARNING)
    def bn_player_job():
        # the BN player is the default with every new version; a viewer's own choice is kept until the next one.
        # Set once the skin is loaded and read back (set too early / a skin update that rewrote its settings
        # left installs updated from the repository on another player style).
        version = ADDON.getAddonInfo('version')
        if ADDON.getSetting('bn_player_ver') == version and xbmc.getInfoLabel('Skin.String(__chooseplayer)'):
            return
        mon = monitor()
        try:    # 3.3: only when the installed skin really has the BN player - else the OSD would have no player
            from resources.lib import skinpatch as _sp
            with open(os.path.join(xbmcvfs.translatePath('special://home/addons/skin.fentastic/xml/'), 'VideoOSD.xml'),
                      encoding='utf-8') as fh:
                has_bn = _sp.BN_INCLUDE in fh.read()
        except Exception:
            has_bn = False
        if not has_bn:
            log('player style: the skin has no BN player include - style left as it is', xbmc.LOGWARNING)
            return
        for _ in range(60):
            if xbmc.getCondVisibility('Window.IsVisible(home)'):
                xbmc.executebuiltin('Skin.SetString(__chooseplayer,__bnplayer)')
                if not mon.waitForAbort(1) and xbmc.getInfoLabel('Skin.String(__chooseplayer)') == '__bnplayer':
                    ADDON.setSetting('bn_player_ver', version)
                    log('player style: BN player (version %s)' % version)
                    return
            if mon.waitForAbort(2):
                return
    threading.Thread(target=bn_player_job, daemon=True).start()
    try:        # YouTube's local server port inside a range Windows reserved -> no YouTube playback
        from resources.lib import ytport
        ytport.check(fix=True)
        ytport.ensure_subtitles()
    except Exception as e:
        log('YouTube port: %s' % e, xbmc.LOGWARNING)
    try:        # All_Subs updates itself and loses its guards: put them back (takes effect at its next start)
        import xbmcvfs
        from resources.lib import subspatch
        subs_dir = xbmcvfs.translatePath('special://home/addons/service.subtitles.All_Subs')
        if os.path.isdir(subs_dir) and subspatch.apply(subs_dir):
            log('All_Subs guards applied')
        plus_dir = xbmcvfs.translatePath('special://home/addons/service.subtitles.all_subs_plus')
        if os.path.isdir(plus_dir) and subspatch.apply_plus(plus_dir):
            log('All Subs Plus exit guard applied')
    except Exception as e:
        log('All_Subs guards: %s' % e, xbmc.LOGWARNING)
    try:        # current root certificates for every add-on (Kodi's certifi is from 2023: TED and others failed SSL)
        import filecmp
        import shutil
        import xbmcvfs
        dst = xbmcvfs.translatePath('special://home/addons/script.module.certifi/lib/certifi/cacert.pem')
        src = os.path.join(ADDON_PATH, 'resources', 'cacert.pem')

        def cert_date(path):
            # "## Certificate data from Mozilla as of: Tue Jul  2 03:12:04 2024 GMT" -> (2024, 7, 2), else None
            with open(path, encoding='utf-8', errors='replace') as fh:
                m = re.search(r'as of:\s*\w+\s+(\w{3})\s+(\d+)\s+[\d:]+\s+(\d{4})', fh.read(4096))
            mo = ('jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec')
            if not m or m.group(1).lower() not in mo:
                return None
            return int(m.group(3)), mo.index(m.group(1).lower()) + 1, int(m.group(2))
        if os.path.exists(dst) and os.path.getsize(src) > 100000 and not filecmp.cmp(src, dst, shallow=False):
            # 3.3: never a downgrade - the certifi module updates itself and may be newer than the bundled file.
            # Both files dated: the newer date wins; otherwise only a larger AND newer (file time) bundle is copied
            d_src, d_dst = cert_date(src), cert_date(dst)
            if d_src and d_dst:
                newer = d_src > d_dst
            else:
                newer = os.path.getsize(src) > os.path.getsize(dst) and os.path.getmtime(src) > os.path.getmtime(dst)
            if newer:
                shutil.copy(src, dst)
                log('root certificates updated')
    except Exception as e:
        log('certificates: %s' % e, xbmc.LOGWARNING)
    try:        # Idan+ updates itself: its Kan YouTube episodes need the video-id fix again (resources/lib/idanpatch.py)
        import xbmcvfs
        from resources.lib import idanpatch
        if idanpatch.apply(xbmcvfs.translatePath('special://home/addons/plugin.video.idanplus')):
            log('Idan+ YouTube fix applied')
    except Exception as e:
        log('Idan+ fix: %s' % e, xbmc.LOGWARNING)
    threading.Thread(target=discover_server, daemon=True).start()
    if ADDON.getSettingBool('open_on_start'):
        xbmc.sleep(2500)
        xbmc.executebuiltin('ActivateWindow(Videos,plugin://plugin.video.nova/,return)')
    def lite():
        """3.2 light mode (default): nothing that is not needed to watch runs in the background"""
        return ADDON.getSetting('lite') != 'false'

    def wait_idle():
        """background work never competes with a playing video for network, CPU and memory"""
        m = monitor()
        while xbmc.getCondVisibility('Player.HasMedia'):
            if m.waitForAbort(30):
                return False
        return not m.abortRequested()

    def later(delay, job):
        """run a job after a delay in a background thread that never keeps Kodi from quitting
        (threading.Timer is not a daemon: Kodi waited for it on exit, killed the service and could crash)"""
        def run():
            if not monitor().waitForAbort(delay):
                job()
        threading.Thread(target=run, daemon=True).start()

    # Player callbacks are delivered on this thread while it waits, so long jobs
    # (IPTV / EPG download) must run in their own thread.
    def iptv_job():
        try:
            if not wait_idle():
                return
            from resources.lib import iptv
            iptv.merge(notify=False)
        except Exception as e:
            log('iptv merge: %s' % e, xbmc.LOGWARNING)

    def backup_job():
        try:
            if not wait_idle():
                return
            from resources.lib import backup
            backup.auto_backup()
        except Exception as e:
            log('auto backup: %s' % e, xbmc.LOGWARNING)
    later(600, backup_job)      # 10 min after start, at most once a week

    def streams_job():
        # 1.6.2: dead channels are found from this box's own connection (20 min after start, then every 12 h);
        # newly dead ones leave the list at once, revived ones come back on the next merge
        mon4 = monitor()
        while not mon4.abortRequested():
            try:
                from resources.lib import iptv
                if os.path.exists(iptv.MERGED_M3U) and iptv.check_streams(aborted=mon4.abortRequested):
                    iptv.merge(notify=False)
            except Exception as e:
                log('stream check: %s' % e, xbmc.LOGWARNING)
            if mon4.waitForAbort(12 * 3600):
                return
    if not lite():
        later(1200, streams_job)

    def gdrive_job():
        # Google Drive (when signed in): sync favourites/history/IPTV between devices, weekly backup to Drive
        try:
            from resources.lib import gdrive_ui
            if wait_idle():
                gdrive_ui.auto()
        except Exception as e:
            log('google drive: %s' % e, xbmc.LOGWARNING)
    later(120, gdrive_job)

    def pvr_ready_job():
        # the TV & Radio home rows reload once the TV service has its channels (their path includes this property)
        # ready = the channel groups are loaded too (PVR.HasTVChannels turns true before them: rows came back empty)
        from resources.lib import iptv
        mon = monitor()
        began = time.time()
        while time.time() - began < 1200:
            try:
                gid = iptv.group_id('Israel')
                # 3.3: "is there a channel" needs one item, not the whole list
                n = len(iptv._rpc('PVR.GetChannels', channelgroupid=gid, limits={'start': 0, 'end': 1})
                        .get('result', {}).get('channels', [])) if gid else 0
            except Exception:
                n = 0
            if n:
                xbmcgui.Window(10000).setProperty('BN.PVRReady', '1')
                return
            if mon.waitForAbort(2 if time.time() - began < 60 else 10):     # 3.3: back off after the first minute
                return
    later(1, pvr_ready_job)

    def ticker_job():
        # bottom news + weather ticker (resources/lib/ticker.py); the skin shows it while BN.Ticker is set
        from resources.lib import ticker
        from resources.lib.common import ui_lang
        win = xbmcgui.Window(10000)

        def on():
            v = ADDON.getSetting('ticker') == 'true' and not lite()
            win.setProperty('BN.Ticker', '1' if v else '')
            return v
        try:
            ticker.run(monitor(), on, lambda: ADDON.getSetting('ticker_city') or 'באר שבע',
                       lambda: 'he' if ui_lang() == 'he' else 'en')
        except Exception as e:
            log('ticker: %s' % e, xbmc.LOGWARNING)
    later(3, ticker_job)

    def branding_job():
        # BN name / logo in a plain Kodi: splash, Windows shortcuts, Android offer (resources/lib/branding.py)
        try:
            from resources.lib import branding
            branding.apply()
        except Exception as e:
            log('branding: %s' % e, xbmc.LOGWARNING)
    later(20, branding_job)

    def menu_job():
        # BN main-menu items must stay visible: skin settings from an older install (custom1 was once Idan+ and
        # hidden) survive updates, and then "TV & Radio" was missing from the menu (1.4.9)
        try:
            if xbmc.getSkinDir() == 'skin.fentastic':
                for sid in ('custom1', 'custom2', 'custom3', 'movies', 'tvshows'):
                    if xbmc.getCondVisibility('Skin.HasSetting(homemenuno%sbutton)' % sid):
                        xbmc.executebuiltin('Skin.Reset(homemenuno%sbutton)' % sid)
                        log('menu: %s shown again' % sid)
        except Exception as e:
            log('menu: %s' % e, xbmc.LOGWARNING)
    later(6, menu_job)

    def livesubs_job():
        try:
            from resources.lib import livesubs
            livesubs.set_state({})          # nothing is re-streamed after a restart
        except Exception as e:
            log('live subtitles: %s' % e, xbmc.LOGWARNING)
    later(4, livesubs_job)
    later(5, align_job)

    def profile_job():
        # first start after installation: which device is this? (resources/lib/profiles.py) - never on the test copy
        try:
            from resources.lib import profiles
            if not profiles.current() and 'testkodi' not in xbmcvfs.translatePath('special://xbmc').lower():
                profiles.auto()     # 3.3: recognised and checked three times; asks only when it is not certain
            elif profiles.current():
                # 1.4.0/1.4.1 touch / car / phone profiles zoomed the skin: Kodi then cut off the clock and logo
                r = profiles._rpc('Settings.GetSettingValue', setting='lookandfeel.skinzoom')
                if (r.get('result') or {}).get('value'):
                    profiles._rpc('Settings.SetSettingValue', setting='lookandfeel.skinzoom', value=0)
        except Exception as e:
            log('device profile: %s' % e, xbmc.LOGWARNING)
    later(8, profile_job)

    def binary_job():
        # platform-specific add-ons (YouTube, Pluto, IPTV need inputstream.adaptive / pvr.iptvsimple). The build zip
        # carries the Windows builds: on iPhone/iPad/Apple TV/Mac/Linux Kodi ignored them, nothing installed the
        # right one (the folder existed) and YouTube could not play. Replace a wrong-platform build with this
        # device's from the Kodi repository; if inputstream.adaptive is still missing, YouTube plays without it.
        try:
            from resources.lib import binfix
            binfix.ensure(log)
        except Exception as e:
            log('binary add-ons: %s' % e, xbmc.LOGWARNING)
    later(5, binary_job)            # early: content opened in the first seconds already finds the right add-ons

    def topics_job():
        # learning sections: channel videos into the cache in the background (instant first open), every 6 h
        mon2 = monitor()
        while not mon2.abortRequested():
            WIN.setProperty('BN.Warming', '1')         # tests wait for it: its worker threads are not a leak
            try:
                from resources.lib import topics
                topics.prewarm(aborted=mon2.abortRequested)
            except Exception as e:
                log('topics prewarm: %s' % e, xbmc.LOGWARNING)
            WIN.clearProperty('BN.Warming')
            if mon2.waitForAbort(6 * 3600 - 300):
                return
    if not lite():
        later(180, topics_job)            # 1.4.12: 3 min after start - the first browsing gets the network to itself

    def guide_job():
        # the free TV guide (Israel + the largest countries): built here, in the long-lived service; checked hourly,
        # rebuilt when older than 12 h (or missing), then applied to the playlist and the merged guide
        mon3 = monitor()
        began = time.time()
        while not mon3.abortRequested():
            wait = 3600
            try:
                from resources.lib import iptv
                quiet = 600 - (time.time() - began)
                if not os.path.exists(iptv.MERGED_M3U):
                    wait = 60       # first start: the channel list is not written yet - look again in a minute
                elif iptv.guide_due() and os.path.exists(iptv.FREE_GUIDE) and quiet > 0:
                    # 1.5.1: a guide is there already - the big rebuild (hundreds of channels, downloads + parsing)
                    # waits until 10 min after start: right after start it made the first menus take 15 s
                    wait = quiet
                elif iptv.guide_due() and wait_idle():  # (was: one look at 90 s, then an hour of sleep - no guide for an hour)
                    iptv.guide_from_playlist()
            except Exception as e:
                log('free TV guide job: %s' % e, xbmc.LOGWARNING)
            if mon3.waitForAbort(wait):
                return
    later(90, guide_job)

    def startup_job():
        """tell the viewer when everything is up: add-ons, services, how much content"""
        try:
            # 3.3: light mode without the status table: nothing is gathered at all (it cost 9+ JSON-RPC calls,
            # account checks, TMDb and radio directory downloads at every start)
            if lite() and not ADDON.getSettingBool('status_on_start'):
                return
            import json as _json
            start = time.time()
            # a first start installs the TV add-on and loads channels (~2-5 min): announce after that,
            # so the table never shows "0 channels" just because it was too early
            while not mon.abortRequested() and time.time() - start < 420:
                r = _json.loads(xbmc.executeJSONRPC(_json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'PVR.GetChannels',
                                                                'params': {'channelgroupid': 'alltv',
                                                                           'limits': {'start': 0, 'end': 1}}})))
                busy = WIN.getProperty('NovaTV.iptv_busy') == '1'
                if (r.get('result') or {}).get('channels') and not busy and time.time() - start > 20:
                    break
                if mon.waitForAbort(5):
                    return
            waited = time.time()              # a window left open (keyboard, dialog) delays it at most 5 min
            while xbmc.getCondVisibility('System.HasActiveModalDialog') and time.time() - waited < 300:
                if mon.waitForAbort(2):
                    return
            from resources.lib import status as _status
            data = _status.announce()
            if ADDON.getSettingBool('status_on_start') and not xbmc.getCondVisibility('Player.HasMedia'):
                _status.show_dialog(data)
        except Exception as e:
            log('startup status: %s' % e, xbmc.LOGWARNING)
    threading.Thread(target=startup_job, daemon=True).start()

    def migrate_job():
        """3.1, once per box: the build no longer uses POV - keep its TMDb token, point the skin at TeleNova,
        drop the POV favourites and switch off the add-ons that are no longer part of the build"""
        import json
        from resources.lib import depov
        from resources.lib.common import legacy_tmdb_token
        if ADDON.getSetting('depov_done') == '3.3':     # 3.3 runs once more: favourites of the removed wizard / anime
            return
        try:
            if not ADDON.getSetting('tmdb_token'):
                tok = legacy_tmdb_token()
                if tok:
                    ADDON.setSetting('tmdb_token', tok)
            n = depov.patch_skin(xbmcvfs.translatePath('special://home/addons/skin.fentastic/xml'))
            n += depov.patch_skin33(xbmcvfs.translatePath('special://home/addons/skin.fentastic/xml'))
            f = depov.clean_favourites(xbmcvfs.translatePath('special://profile/favourites.xml'))
            for aid in depov.REMOVED:
                if xbmc.getCondVisibility('System.HasAddon(%s)' % aid):
                    xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'Addons.SetAddonEnabled',
                                                    'params': {'addonid': aid, 'enabled': False}}))
            ADDON.setSetting('depov_done', '3.3')
            log('3.1 migration: %d skin file(s), %d favourite(s)' % (n, f))
            if n and xbmc.getSkinDir() == 'skin.fentastic' and not xbmc.getCondVisibility('Player.HasMedia'):
                xbmc.executebuiltin('ReloadSkin()')
        except Exception as e:
            log('3.1 migration: %s' % e, xbmc.LOGWARNING)

    later(40, migrate_job)

    def wizard_job():
        """3.3: the wizard asked for xbmc.python 3.1.0 - Kodi 21 has 3.0.1, so Kodi kept it disabled (no build
        update from inside Kodi) and a disabled add-on is not updated from the repository either. Its addon.xml is
        corrected in place and the wizard is switched on."""
        import json
        aid = 'plugin.program.novawizard'
        if ADDON.getSetting('wizard_fix') == '3.3':      # once: a viewer who switches the wizard off keeps it off
            return
        try:
            ax = os.path.join(xbmcvfs.translatePath('special://home/addons/%s' % aid), 'addon.xml')
            if not os.path.exists(ax):
                return
            with open(ax, encoding='utf-8') as f:
                src = f.read()
            bad = '<import addon="xbmc.python" version="3.1.0"/>'
            if bad in src:
                with open(ax, 'w', encoding='utf-8') as f:
                    f.write(src.replace(bad, '<import addon="xbmc.python" version="3.0.0"/>'))
                xbmc.executebuiltin('UpdateLocalAddons')
                if monitor().waitForAbort(5):
                    return
            r = json.loads(xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'Addons.GetAddonDetails',
                                                            'params': {'addonid': aid, 'properties': ['enabled']}})))
            if ((r.get('result') or {}).get('addon') or {}).get('enabled') is False:
                xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'Addons.SetAddonEnabled',
                                                'params': {'addonid': aid, 'enabled': True}}))
                log('wizard switched on')
            ADDON.setSetting('wizard_fix', '3.3')
        except Exception as e:
            log('wizard: %s' % e, xbmc.LOGWARNING)
    later(30, wizard_job)

    def lite_job():
        """3.2, once per box: settings of a box that updates from the repository follow the light build - no pause
        at the start of a video, no ticker / status table, a video cache that fits the memory, and the add-ons
        that only ran in the background are switched off"""
        import json
        from resources.lib import depov, profiles
        if ADDON.getSetting('lite_done') == '3.2':
            return
        try:
            for k in ('ticker', 'status_on_start', 'ai_prepare'):
                ADDON.setSetting(k, 'false')
            for aid in depov.REMOVED_LITE:
                if xbmc.getCondVisibility('System.HasAddon(%s)' % aid):
                    xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'Addons.SetAddonEnabled',
                                                    'params': {'addonid': aid, 'enabled': False}}))
            ram = profiles.ram_mb()
            for sid, val in (('filecache.memorysize', profiles.cache_mb(ram, profiles.current() or 'tv')),
                             ('lookandfeel.enablerssfeeds', False), ('epg.epgupdate', 720),
                             ('epg.preventupdateswhileplayingtv', True)):
                xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'Settings.SetSettingValue',
                                                'params': {'setting': sid, 'value': val}}))
            ADDON.setSetting('lite_done', '3.2')
            log('3.2 light build settings applied (memory %s MB)' % ram)
        except Exception as e:
            log('3.2 light build: %s' % e, xbmc.LOGWARNING)
    later(50, lite_job)

    def telescope_job():
        # 1.7.0: the Telegram engine (TeleScope AI) is part of the build - installed from the NovaTV repository
        # when a device does not have it yet (builds installed before 1.7.0)
        try:
            from resources.lib import providers
            from resources.lib.iptv import install_addon
            # 3.1: the engine decrypts Telegram streams much faster with PyCryptodome (official Kodi repository)
            missing = [a for a in (providers.TELESCOPE, 'script.module.pycryptodome')
                       if not xbmc.getCondVisibility('System.HasAddon(%s)' % a)]
            if not missing:
                return
            # 3.3: tried once per TeleNova version, not at every start (a box without the repository waited
            # through the install attempts each time)
            version = ADDON.getAddonInfo('version')
            st = load('firstrun.json', {})
            if st.get('telescope_try') == version:
                return
            st['telescope_try'] = version
            save('firstrun.json', st)
            for a in missing:
                install_addon(a, timeout=90)
        except Exception as e:
            log('telescope install: %s' % e, xbmc.LOGWARNING)

    later(75, telescope_job)

    def cache_job():
        # 3.3: the TMDb answers (one small file per request, never deleted) - files older than 7 days go,
        # at most once per 24 h and only while nothing plays
        m = monitor()
        while not m.abortRequested():
            try:
                st = load('firstrun.json', {})
                if time.time() - float(st.get('cache_clean') or 0) > 86400 and wait_idle():
                    st = load('firstrun.json', {})
                    st['cache_clean'] = time.time()
                    save('firstrun.json', st)
                    cdir, n, gone = os.path.join(PROFILE, 'cache'), 0, 0
                    old = time.time() - 7 * 86400
                    for name in (os.listdir(cdir) if os.path.isdir(cdir) else []):
                        n += 1
                        if n % 200 == 0 and m.abortRequested():
                            return
                        full = os.path.join(cdir, name)
                        try:
                            if os.path.isfile(full) and os.path.getmtime(full) < old:
                                os.remove(full)
                                gone += 1
                        except OSError:
                            pass
                    if gone:
                        log('cache clean-up: %d old file(s)' % gone)
            except Exception as e:
                log('cache clean-up: %s' % e, xbmc.LOGWARNING)
            if m.waitForAbort(3600):
                return
    later(900, cache_job)

    # first refresh 2 minutes after start; 3.3: on a new install (no channel list yet) after 15 s - the TV menu
    # of a fresh build stayed empty for more than two minutes
    from resources.lib import iptv as _iptv0
    first_in = 120 if os.path.exists(_iptv0.MERGED_M3U) else 15
    hours0 = int(ADDON.getSetting('iptv_refresh_h') or 12)
    last_iptv = time.time() - hours0 * 3600 + first_in
    while not mon.abortRequested():
        hours = int(ADDON.getSetting('iptv_refresh_h') or 12)
        from resources.lib import iptv as _iptv
        # 3.3: the cheap time test first (iptv.json was read and parsed every 5 s forever); one look per 30 s
        if time.time() - last_iptv > hours * 3600 and _iptv.all_m3u(_iptv.sources()):
            last_iptv = time.time()
            threading.Thread(target=iptv_job, daemon=True).start()
        due_in = hours * 3600 - (time.time() - last_iptv)      # the first refresh keeps its time (15 s / 2 min)
        if mon.waitForAbort(due_in + 0.5 if 0 < due_in < 30 else 30):
            break
    del player


if __name__ == '__main__':
    main()
