# -*- coding: utf-8 -*-
"""3.3.3: what the keyboard's "Paste" and "Clipboard" buttons run, and the watcher that keeps "Paste" enabled only
while there is something to paste.

Window(home) properties read by the skin (DialogKeyboard.xml, patched by skinpatch.keyboard_buttons):
  bn.clip.has   '1' while the device clipboard holds text   -> "Paste" enabled, else grey and not clickable
  bn.clip.hist  '1' while the history has entries           -> "Clipboard" enabled
"""
import os
import threading
import time

import xbmc
import xbmcgui

from . import clip
from .common import PROFILE, log, ui_lang

HOME = 10000
STR = {
    'paste': (u'הדבק', 'Paste'),
    'hist': (u'היסטוריית העתקות', 'Clipboard history'),
    'empty': (u'לא הועתק טקסט', 'Nothing was copied'),
    'failed': (u'ההדבקה לא הצליחה - הטקסט בשדה לא השתנה', 'Paste failed - the field was left unchanged'),
    'no_hist': (u'אין עדיין העתקות בהיסטוריה', 'The clipboard history is empty'),
    'act_paste': (u'הדבק', 'Paste'),
    'act_pin': (u'הצמד (נשאר תמיד למעלה)', 'Pin (always on top)'),
    'act_unpin': (u'בטל הצמדה', 'Unpin'),
    'act_del': (u'מחק מההיסטוריה', 'Delete from history'),
    'act_clear': (u'נקה היסטוריה (ההצמדות נשארות)', 'Clear history (pinned stay)'),
    'pinned': (u'מוצמד', 'pinned'),
    'unreadable': (u'במכשיר הזה אין גישה ללוח ההעתקה של המערכת - השתמש בהיסטוריה', 'This device clipboard cannot be read - use the history'),
}


def _s(k):
    return STR[k][0 if ui_lang() == 'he' else 1]


_store = None
_store_lock = threading.Lock()


def store():
    global _store
    with _store_lock:
        if _store is None:
            _store = clip.Store(os.path.join(PROFILE, 'clipboard.json'))
        else:
            _store.load()            # the service and the plugin both write it
        return _store


def _set(prop, on):
    w = xbmcgui.Window(HOME)
    val = '1' if on else ''
    if w.getProperty(prop) != val:
        w.setProperty(prop, val)


def _notify(key):
    xbmcgui.Dialog().notification('TeleNova', _s(key), xbmcgui.NOTIFICATION_INFO, 2500)


# ------------------------------------------------------------------ buttons
_busy = threading.Lock()


def paste_now():
    """The "Paste" button. Never waits on anything without a time limit; a second press while one runs is ignored."""
    if not _busy.acquire(False):
        return
    try:
        text = clip.system_read()
        text = clip.clean(text) if text is not None else ''
        if not text:
            _set('bn.clip.has', False)
            _notify('empty')
            return
        res = clip.paste(text)
        if res == 'ok':
            store().add(text, used=True)
            _set('bn.clip.hist', True)
        elif res == 'failed':
            _notify('failed')
    finally:
        _busy.release()


def history_menu():
    """The "Clipboard" button: the history (pinned first). Choosing an entry pastes it; the context menu (or a
    long press) offers pin / unpin / delete."""
    st = store()
    while True:
        items = st.ordered()
        if not items:
            _set('bn.clip.hist', False)
            xbmcgui.Dialog().ok('TeleNova', _s('no_hist'))
            return
        rows = []
        for i in items:
            li = xbmcgui.ListItem((u'\U0001F4CC ' if i.get('pin') else '') + clip.short(i['t']))
            li.setLabel2(time.strftime('%d/%m %H:%M', time.localtime(i.get('used') or i.get('ts') or 0))
                         + (u' · %s' % _s('pinned') if i.get('pin') else ''))
            rows.append(li)
        rows.append(xbmcgui.ListItem(u'[COLOR grey]%s[/COLOR]' % _s('act_clear')))
        n = xbmcgui.Dialog().select(_s('hist'), rows, useDetails=False)
        if n < 0:
            return
        if n == len(items):
            st.clear(keep_pinned=True)
            continue
        item = items[n]
        acts = [_s('act_paste'), _s('act_unpin') if item.get('pin') else _s('act_pin'), _s('act_del')]
        k = xbmcgui.Dialog().contextmenu(acts)
        if k == 0:
            if clip.keyboard_open():
                if clip.paste(item['t']) == 'ok':
                    st.add(item['t'], used=True)
                else:
                    _notify('failed')
            else:                       # opened from the menu, not from a keyboard: put it on the device clipboard
                clip.system_write(item['t'])
            return
        if k == 1:
            st.pin(item['t'])
        elif k == 2:
            st.remove(item['t'])
        else:
            return


# ------------------------------------------------------------------ watcher (service)
def watch(monitor):
    """Keeps the two properties right. Reads the clipboard text only on Windows / macOS / Linux (to record every
    copy in the history); on Android and iOS it only asks whether there IS text - reading it would make the system
    announce "Kodi pasted from your clipboard" every second."""
    p = clip.platform()
    can_read_quietly = p in ('windows', 'osx', 'linux')
    last_seq, last_text = None, None
    try:
        _set('bn.clip.hist', bool(store().items))
    except Exception:
        pass
    while not monitor.abortRequested():
        kb = clip.keyboard_open()
        try:
            if can_read_quietly:
                seq = clip.system_seq()
                if seq is None or seq != last_seq or kb:
                    last_seq = seq
                    text = clip.system_read()
                    text = clip.clean(text) if text else ''
                    _set('bn.clip.has', bool(text))
                    if text and text != last_text:
                        last_text = text
                        if store().add(text):
                            _set('bn.clip.hist', True)
            elif kb:
                has = clip.system_has()
                _set('bn.clip.has', bool(has))
            if kb:
                _set('bn.clip.hist', bool(store().items))
        except Exception as exc:
            log('clipboard watch: %s' % exc, xbmc.LOGDEBUG)
        if monitor.waitForAbort(0.5 if kb else 1.5):
            break
