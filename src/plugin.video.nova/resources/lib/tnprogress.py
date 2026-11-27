# -*- coding: utf-8 -*-
"""Shared progress line for long actions (6.5.1): percent plus estimated time left.

The SAME file lives in plugin.video.nova/resources/lib, plugin.video.telescope/resources/lib and
plugin.program.novawizard (qa/t_tnprogress.py checks the copies are identical). No imports from the
add-ons, so it works anywhere; xbmc / xbmcgui are imported lazily.

    eta = Eta();  eta.line(done, total)  -> "42% · about 1:20 left"   (time only once it is reliable)
    step_line(3, 12)                     -> "Step 3 of 12"            (where no true percent exists)
    p = Progress(heading); p.update(done, total, msg); p.step(i, n, msg); p.iscanceled(); p.close()
"""
import time

TEXTS = {
    'left': {'he': u'עוד כ-%s', 'en': u'about %s left', 'ru': u'осталось около %s'},
    'step': {'he': u'שלב %d מתוך %d', 'en': u'Step %d of %d', 'ru': u'Шаг %d из %d'},
}
_lang = None


def lang():
    global _lang
    if _lang is None:
        try:
            import xbmc
            code = (xbmc.getLanguage(xbmc.ISO_639_1) or 'en').lower()[:2]
        except Exception:
            code = 'en'
        _lang = code if code in ('he', 'ru') else 'en'
    return _lang


def tx(key, code=None):
    row = TEXTS[key]
    return row.get(code or lang(), row['en'])


def fmt_left(sec):
    """seconds -> 'm:ss' (or 'h:mm:ss')"""
    sec = int(max(0, round(sec)))
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return '%d:%02d:%02d' % (h, m, s) if h else '%d:%02d' % (m, s)


def step_line(i, n, code=None):
    return tx('step', code) % (max(1, min(i, n)), max(1, n))


class Eta(object):
    """Smoothed rate (exponential moving average over time windows) -> seconds left.

    Reliable only after MIN_TIME seconds, MIN_SAMPLES rate samples and MIN_FRAC of the work,
    so the first jumpy seconds show the percent alone."""
    ALPHA = 0.3
    WINDOW = 0.5          # seconds between rate samples
    MIN_TIME = 3.0
    MIN_SAMPLES = 3
    MIN_FRAC = 0.02

    def __init__(self, clock=None):
        self.clock = clock or time.time
        self.reset()

    def reset(self):
        self.t0 = self.clock()
        self.last_t, self.last_done = self.t0, None
        self.rate, self.samples, self.frac, self.done, self.total = None, 0, 0.0, 0, 0
        self._shown = None

    def feed(self, done, total):
        now = self.clock()
        if self.last_done is None or done < self.last_done:       # first call or the work restarted
            self.last_t, self.last_done = now, done
        dt = now - self.last_t
        if dt >= self.WINDOW:
            r = (done - self.last_done) / dt
            self.rate = r if self.rate is None else self.ALPHA * r + (1 - self.ALPHA) * self.rate
            self.samples += 1
            self.last_t, self.last_done = now, done
        self.done, self.total = done, total
        self.frac = (float(done) / total) if total else 0.0
        return self

    def percent(self):
        return int(max(0, min(100, self.frac * 100)))

    def seconds_left(self):
        if (not self.total or self.rate is None or self.rate <= 0 or self.samples < self.MIN_SAMPLES
                or self.frac < self.MIN_FRAC or self.clock() - self.t0 < self.MIN_TIME or self.frac >= 1):
            return None
        left = (self.total - self.done) / self.rate
        # damp the display so it does not jump up and down every update
        if self._shown is not None and abs(left - self._shown) < max(2.0, 0.1 * self._shown):
            left = self._shown
        self._shown = left
        return left

    def line(self, done=None, total=None, code=None):
        if done is not None:
            self.feed(done, total)
        out = '%d%%' % self.percent()
        left = self.seconds_left()
        if left is not None:
            out += u' · ' + tx('left', code) % fmt_left(left)
        return out


class Progress(object):
    """DialogProgress (bg=False) or DialogProgressBG (bg=True) with the ETA line built in."""

    def __init__(self, heading, message='', bg=False, dialog=None):
        if dialog is None:
            import xbmcgui
            dialog = xbmcgui.DialogProgressBG() if bg else xbmcgui.DialogProgress()
        self.d, self.bg, self.eta, self.heading = dialog, bg, Eta(), heading
        self.d.create(heading, message)

    def _show(self, pct, text):
        if self.bg:
            self.d.update(pct, self.heading, text)
        else:
            self.d.update(pct, text)

    def update(self, done, total, message=''):
        """real amount of work (bytes, files, items): percent + time left"""
        line = self.eta.line(done, total)
        self._show(self.eta.percent(), '%s\n%s' % (message, line) if message else line)

    def step(self, i, n, message=''):
        """i of n steps (1-based); the time left comes from the steps' pace"""
        self.eta.feed(max(0, i - 1), n)
        line = step_line(i, n)
        left = self.eta.seconds_left()
        if left is not None:
            line += u' · ' + tx('left') % fmt_left(left)
        self._show(self.eta.percent(), '%s\n%s' % (message, line) if message else line)

    def text(self, pct, message):
        self._show(pct, message)

    def iscanceled(self):
        if self.bg:
            return False
        try:
            return self.d.iscanceled()
        except Exception:
            return False

    def close(self):
        try:
            self.d.close()
        except Exception:
            pass
