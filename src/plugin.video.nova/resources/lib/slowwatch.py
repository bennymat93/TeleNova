# -*- coding: utf-8 -*-
"""5.0: the player keeps stopping to load - the connection is weaker than the file needs.

StallMeter (plain logic, tested outside Kodi: qa/t_slowwatch.py) is fed once a second with what the player does.
A "stop" is buffering that lasts STOP_MIN seconds or more, after the first WARM_UP seconds of a video and not
right after a jump (both buffer by nature). Three stops, or LONG seconds of buffering in all, within WINDOW
seconds -> one alarm, then quiet for QUIET seconds.

On an alarm run() (the Kodi side) leaves a time stamp in the home window (PROP). The Telegram engine reads it
before its next source list (plugin.video.telescope sources.Finder.link_hint): it measures the connection again
and offers only files this connection can carry (linkspeed.py). The viewer gets one short notice."""
import time

PROP = 'telenova.link_slow'
STOP_MIN = 2.0
WARM_UP = 20.0
AFTER_SEEK = 10.0
WINDOW = 180.0
STOPS = 3
LONG = 25.0
QUIET = 600.0

TEXT = {
    'he': ('החיבור איטי', 'הניגון נעצר לטעינה שוב ושוב. ברשימת הקישורים הבאה יוצעו קבצים קלים יותר.'),
    'en': ('Slow connection', 'Playback keeps stopping to load. The next list of links will offer lighter files.'),
    'ru': ('Медленное соединение', 'Воспроизведение часто останавливается. В следующем списке будут файлы полегче.'),
}


class StallMeter(object):
    def __init__(self):
        self.reset(0)
        self.quiet_until = 0

    def reset(self, now):
        self.started = now          # when this video began
        self.since = None           # the buffering going on now began here
        self.counted = False        # ... and was already counted as a stop
        self.seek_at = -1e9
        self.stops = []             # [(time, seconds)]

    def feed(self, now, playing, caching, seeking=False):
        """-> True when the alarm goes off. playing: a video plays (not paused by the viewer)."""
        if not playing:
            self.reset(now)
            return False
        if not self.started:
            self.started = now
        if seeking:
            self.seek_at = now
        natural = now - self.started < WARM_UP or now - self.seek_at < AFTER_SEEK
        if not caching or natural:
            if self.since is not None and self.counted and self.stops:
                self.stops[-1] = (self.stops[-1][0], now - self.since)
            self.since, self.counted = None, False
            return False
        if self.since is None:
            self.since = now
        took = now - self.since
        if took >= STOP_MIN:
            if not self.counted:
                self.counted = True
                self.stops.append((self.since, took))
            elif self.stops:
                self.stops[-1] = (self.since, took)
        self.stops = [s for s in self.stops if now - s[0] <= WINDOW]
        if now < self.quiet_until:
            return False
        if len(self.stops) >= STOPS or sum(s[1] for s in self.stops) >= LONG:
            self.quiet_until = now + QUIET
            self.stops = []
            return True
        return False


def run(monitor, log=None):
    """the loop of the hub service: one check a second while something plays, one every 5 s otherwise"""
    import xbmc
    import xbmcgui
    meter = StallMeter()
    cond = xbmc.getCondVisibility
    while not monitor.abortRequested():
        try:
            video = cond('Player.HasVideo') and not cond('Player.Paused') and not cond('VideoPlayer.Content(livetv)')
            if meter.feed(time.time(), bool(video), bool(cond('Player.Caching')), bool(cond('Player.Seeking'))):
                xbmcgui.Window(10000).setProperty(PROP, str(int(time.time())))
                lang = (xbmc.getLanguage(xbmc.ISO_639_1) or 'en').lower()
                title, text = TEXT.get(lang if lang in TEXT else ('he' if lang == 'iw' else 'en'))
                xbmcgui.Dialog().notification(title, text, xbmcgui.NOTIFICATION_INFO, 7000, False)
                if log:
                    log('slow connection: the player kept stopping to load - the engine will measure the line again')
        except Exception as exc:
            if log:
                log('slow watch: %s' % exc)
        if monitor.waitForAbort(1 if cond('Player.HasVideo') else 5):
            break
