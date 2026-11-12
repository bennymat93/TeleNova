# -*- coding: utf-8 -*-
"""3.3.3: Paste button + clipboard history for the on-screen keyboard.

Why this exists: Kodi itself can paste only on Windows and macOS (CWinSystemBase::GetClipboardText() is empty on
Android, iOS, tvOS, Linux) and only with a physical Ctrl+V. On a phone or a TV box an API hash copied in the browser
could not be pasted at all.

Parts:
  system_has() / system_read()   the device clipboard, per platform, every call guarded:
        Windows  user32 through ctypes            Android  ClipboardManager through JNI (libkodi's own JNIEnv)
        macOS    pbpaste                          iOS/tvOS UIPasteboard through the Objective-C runtime
        Linux    wl-paste / xclip / xsel
      "has" never reads the text (Android 12+ and iOS announce every read to the user), "read" does.
  Store                          clipboard.json in the add-on's profile: every text that was pasted / received,
                                 newest first, pinned entries kept forever
  paste()                        current field text + clipboard -> the keyboard, then read back and compared; if
                                 the field does not hold exactly the expected text it is put back as it was -
                                 the field is never left with half a paste
Pure helpers (clean, Store) import no Kodi module and are tested outside Kodi.
"""
import json
import os
import threading
import time

MAX_LEN = 20000          # one entry
KEEP = 60                # unpinned entries kept
_lock = threading.RLock()


def clean(text, single_line=True):
    """What may go into a one-line text field: no NULs / control characters, line breaks become spaces."""
    if text is None:
        return ''
    if isinstance(text, bytes):
        text = text.decode('utf-8', 'replace')
    text = text.replace('\x00', '')
    if single_line:
        text = text.replace('\r\n', ' ').replace('\r', ' ').replace('\n', ' ').replace('\t', ' ')
    text = ''.join(ch for ch in text if ch >= ' ' or ch in '\n\t')
    text = text.strip()
    return text[:MAX_LEN]


class Store(object):
    """Clipboard history: [{'t': text, 'ts': first seen, 'used': last used, 'pin': bool, 'n': times used}]"""

    def __init__(self, path):
        self.path = path
        self.items = []
        self.load()

    def load(self):
        with _lock:
            try:
                with open(self.path, 'r', encoding='utf-8') as fh:
                    data = json.load(fh)
                items = data.get('items') if isinstance(data, dict) else None
                self.items = [i for i in (items or []) if isinstance(i, dict) and isinstance(i.get('t'), str) and i['t']]
            except (OSError, ValueError):
                self.items = []

    def save(self):
        with _lock:
            try:
                tmp = self.path + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as fh:
                    json.dump({'items': self.items}, fh, ensure_ascii=False)
                os.replace(tmp, self.path)
            except OSError:
                pass

    def add(self, text, used=False):
        """Newest first; a text that is already there moves up instead of appearing twice. -> True when stored"""
        text = clean(text)
        if not text:
            return False
        with _lock:
            now = self._stamp()
            for i in self.items:
                if i['t'] == text:
                    i['used'] = now
                    if used:
                        i['n'] = int(i.get('n') or 0) + 1
                    break
            else:
                self.items.append({'t': text, 'ts': now, 'used': now, 'pin': False, 'n': 1 if used else 0})
            loose = sorted([i for i in self.items if not i.get('pin')], key=lambda i: -i.get('used', 0))
            drop = set(id(i) for i in loose[KEEP:])
            self.items = [i for i in self.items if id(i) not in drop]
            self.save()
        return True

    def _stamp(self):
        """Strictly increasing: two copies in the same second still keep their order (and the trim keeps the newest)."""
        last = max([float(i.get('used') or 0) for i in self.items] + [0.0])
        return max(round(time.time(), 3), round(last + 0.001, 3))

    def ordered(self):
        """Pinned entries first (most used first), then the rest, newest first."""
        with _lock:
            pinned = sorted([i for i in self.items if i.get('pin')], key=lambda i: (-int(i.get('n') or 0), -i.get('used', 0)))
            rest = sorted([i for i in self.items if not i.get('pin')], key=lambda i: -i.get('used', 0))
            return pinned + rest

    def latest(self):
        with _lock:
            if not self.items:
                return ''
            return max(self.items, key=lambda i: i.get('used', 0))['t']

    def pin(self, text, on=None):
        with _lock:
            for i in self.items:
                if i['t'] == text:
                    i['pin'] = (not i.get('pin')) if on is None else bool(on)
                    self.save()
                    return i['pin']
        return False

    def remove(self, text):
        with _lock:
            n = len(self.items)
            self.items = [i for i in self.items if i['t'] != text]
            self.save()
            return n != len(self.items)

    def clear(self, keep_pinned=True):
        with _lock:
            self.items = [i for i in self.items if keep_pinned and i.get('pin')]
            self.save()


def short(text, n=70):
    text = ' '.join((text or '').split())
    return text if len(text) <= n else text[:n - 1] + u'…'


# ------------------------------------------------------------------ the device clipboard
_platform = None


def platform():
    global _platform
    if _platform is None:
        import xbmc
        for name, cond in (('windows', 'Windows'), ('android', 'Android'), ('tvos', 'TVOS'), ('ios', 'IOS'),
                           ('osx', 'OSX'), ('linux', 'Linux')):
            if xbmc.getCondVisibility('System.Platform.' + cond):
                _platform = name
                break
        else:
            _platform = 'other'
    return _platform


# ---- Windows
def _win():
    import ctypes
    from ctypes import wintypes
    u, k = ctypes.windll.user32, ctypes.windll.kernel32
    u.OpenClipboard.argtypes = [wintypes.HWND]
    u.OpenClipboard.restype = wintypes.BOOL
    u.GetClipboardData.argtypes = [wintypes.UINT]
    u.GetClipboardData.restype = ctypes.c_void_p
    u.SetClipboardData.argtypes = [wintypes.UINT, ctypes.c_void_p]
    u.SetClipboardData.restype = ctypes.c_void_p
    u.IsClipboardFormatAvailable.argtypes = [wintypes.UINT]
    k.GlobalLock.argtypes = [ctypes.c_void_p]
    k.GlobalLock.restype = ctypes.c_void_p
    k.GlobalUnlock.argtypes = [ctypes.c_void_p]
    k.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    k.GlobalAlloc.restype = ctypes.c_void_p
    k.GlobalSize.argtypes = [ctypes.c_void_p]
    k.GlobalSize.restype = ctypes.c_size_t
    return ctypes, u, k


def _win_has():
    _, u, _k = _win()
    return bool(u.IsClipboardFormatAvailable(13))


def _win_seq():
    import ctypes
    return int(ctypes.windll.user32.GetClipboardSequenceNumber())


def _win_read():
    ctypes, u, k = _win()
    for _ in range(10):                      # another program may hold the clipboard for a moment
        if u.OpenClipboard(None):
            break
        time.sleep(0.03)
    else:
        return None
    try:
        if not u.IsClipboardFormatAvailable(13):       # CF_UNICODETEXT
            return ''
        h = u.GetClipboardData(13)
        if not h:
            return ''
        p = k.GlobalLock(h)
        if not p:
            return ''
        try:
            size = k.GlobalSize(h)
            chars = max(0, int(size // 2))
            return ctypes.wstring_at(p, chars).split('\x00')[0] if chars else ''
        finally:
            k.GlobalUnlock(h)
    finally:
        u.CloseClipboard()


def _win_write(text):
    ctypes, u, k = _win()
    data = (text + '\x00').encode('utf-16-le')
    for _ in range(10):
        if u.OpenClipboard(None):
            break
        time.sleep(0.03)
    else:
        return False
    try:
        u.EmptyClipboard()
        h = k.GlobalAlloc(0x0002, len(data))             # GMEM_MOVEABLE
        if not h:
            return False
        p = k.GlobalLock(h)
        ctypes.memmove(p, data, len(data))
        k.GlobalUnlock(h)
        return bool(u.SetClipboardData(13, h))
    finally:
        u.CloseClipboard()


# ---- macOS / Linux: helper programs
def _run(cmd, data=None, timeout=3):
    import subprocess
    try:
        p = subprocess.run(cmd, input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
        return p.stdout if p.returncode == 0 else None
    except Exception:
        return None


def _linux_cmd():
    import shutil
    for cmd in (['wl-paste', '--no-newline'], ['xclip', '-selection', 'clipboard', '-o'], ['xsel', '--clipboard', '--output']):
        if shutil.which(cmd[0]):
            return cmd
    return None


# ---- Android: ClipboardManager through the JNIEnv Kodi itself exports (libkodi.so: xbmc_jnienv())
class _Jni(object):
    """Just enough JNI for: ActivityThread.currentApplication().getSystemService("clipboard") and its methods.
    Every call is followed by an exception check; a pending Java exception is cleared and reported as failure."""
    I = {'FindClass': 6, 'ExceptionClear': 17, 'PushLocalFrame': 19, 'PopLocalFrame': 20, 'GetMethodID': 33,
         'CallObjectMethodA': 36, 'CallBooleanMethodA': 39, 'CallIntMethodA': 51, 'GetStaticMethodID': 113,
         'CallStaticObjectMethodA': 116, 'NewStringUTF': 167, 'GetStringUTFChars': 169, 'ReleaseStringUTFChars': 170,
         'ExceptionCheck': 228}

    def __init__(self):
        import ctypes
        self.c = ctypes
        lib = ctypes.CDLL('libkodi.so')
        get = getattr(lib, '_Z11xbmc_jnienvv')
        get.restype = ctypes.c_void_p
        get.argtypes = []
        self.env = get()
        if not self.env:
            raise RuntimeError('no JNIEnv')
        table = ctypes.cast(self.env, ctypes.POINTER(ctypes.c_void_p))[0]
        self.table = ctypes.cast(table, ctypes.POINTER(ctypes.c_void_p))
        P, S, I = ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int
        sig = {'FindClass': (P, [P, S]), 'ExceptionClear': (None, [P]), 'PushLocalFrame': (I, [P, I]),
               'PopLocalFrame': (P, [P, P]), 'GetMethodID': (P, [P, P, S, S]), 'CallObjectMethodA': (P, [P, P, P, P]),
               'CallBooleanMethodA': (ctypes.c_ubyte, [P, P, P, P]), 'CallIntMethodA': (I, [P, P, P, P]),
               'GetStaticMethodID': (P, [P, P, S, S]), 'CallStaticObjectMethodA': (P, [P, P, P, P]),
               'NewStringUTF': (P, [P, S]), 'GetStringUTFChars': (P, [P, P, P]),
               'ReleaseStringUTFChars': (None, [P, P, P]), 'ExceptionCheck': (ctypes.c_ubyte, [P])}
        self.f = {}
        for name, (res, args) in sig.items():
            self.f[name] = ctypes.CFUNCTYPE(res, *args)(self.table[self.I[name]])

    def call(self, name, *args):
        res = self.f[name](self.env, *args)
        if self.f['ExceptionCheck'](self.env):
            self.f['ExceptionClear'](self.env)
            raise RuntimeError('java exception in %s' % name)
        return res

    def args(self, *values):
        arr = (self.c.c_int64 * max(1, len(values)))()
        for i, v in enumerate(values):
            arr[i] = int(v or 0)
        return self.c.cast(arr, self.c.c_void_p)

    def manager(self):
        cls = self.call('FindClass', b'android/app/ActivityThread')
        mid = self.call('GetStaticMethodID', cls, b'currentApplication', b'()Landroid/app/Application;')
        app = self.call('CallStaticObjectMethodA', cls, mid, self.args())
        if not app:
            raise RuntimeError('no application')
        ctx = self.call('FindClass', b'android/content/Context')
        mid = self.call('GetMethodID', ctx, b'getSystemService', b'(Ljava/lang/String;)Ljava/lang/Object;')
        name = self.call('NewStringUTF', b'clipboard')
        man = self.call('CallObjectMethodA', app, mid, self.args(name))
        if not man:
            raise RuntimeError('no clipboard service')
        return app, man, self.call('FindClass', b'android/content/ClipboardManager')

    def has(self):
        self.call('PushLocalFrame', 16)
        try:
            _, man, cls = self.manager()
            mid = self.call('GetMethodID', cls, b'hasPrimaryClip', b'()Z')
            return bool(self.call('CallBooleanMethodA', man, mid, self.args()))
        finally:
            self.f['PopLocalFrame'](self.env, None)

    def read(self):
        self.call('PushLocalFrame', 24)
        try:
            app, man, cls = self.manager()
            mid = self.call('GetMethodID', cls, b'getPrimaryClip', b'()Landroid/content/ClipData;')
            clip = self.call('CallObjectMethodA', man, mid, self.args())
            if not clip:
                return ''
            ccls = self.call('FindClass', b'android/content/ClipData')
            mid = self.call('GetMethodID', ccls, b'getItemCount', b'()I')
            if self.call('CallIntMethodA', clip, mid, self.args()) < 1:
                return ''
            mid = self.call('GetMethodID', ccls, b'getItemAt', b'(I)Landroid/content/ClipData$Item;')
            item = self.call('CallObjectMethodA', clip, mid, self.args(0))
            if not item:
                return ''
            icls = self.call('FindClass', b'android/content/ClipData$Item')
            mid = self.call('GetMethodID', icls, b'coerceToText', b'(Landroid/content/Context;)Ljava/lang/CharSequence;')
            seq = self.call('CallObjectMethodA', item, mid, self.args(app))
            if not seq:
                return ''
            ocls = self.call('FindClass', b'java/lang/Object')
            mid = self.call('GetMethodID', ocls, b'toString', b'()Ljava/lang/String;')
            jstr = self.call('CallObjectMethodA', seq, mid, self.args())
            if not jstr:
                return ''
            chars = self.call('GetStringUTFChars', jstr, None)
            if not chars:
                return ''
            try:
                raw = self.c.string_at(chars)
            finally:
                self.f['ReleaseStringUTFChars'](self.env, jstr, chars)
            try:
                return raw.decode('utf-8')
            except UnicodeDecodeError:       # "modified UTF-8": characters outside the BMP come as surrogate pairs
                return raw.decode('utf-8', 'surrogatepass').encode('utf-16', 'surrogatepass').decode('utf-16', 'replace')
        finally:
            self.f['PopLocalFrame'](self.env, None)


# ---- iOS / tvOS: UIPasteboard through the Objective-C runtime (system libraries only, nothing is loaded)
class _ObjC(object):
    def __init__(self):
        import ctypes
        self.c = ctypes
        lib = ctypes.CDLL(None)
        self.get_class = lib.objc_getClass
        self.get_class.restype = ctypes.c_void_p
        self.get_class.argtypes = [ctypes.c_char_p]
        self.sel = lib.sel_registerName
        self.sel.restype = ctypes.c_void_p
        self.sel.argtypes = [ctypes.c_char_p]
        self.lib = lib

    def send(self, obj, selector, restype=None):
        fn = self.c.cast(self.lib.objc_msgSend, self.c.CFUNCTYPE(restype or self.c.c_void_p, self.c.c_void_p, self.c.c_void_p))
        return fn(obj, self.sel(selector))

    def board(self):
        cls = self.get_class(b'UIPasteboard')
        if not cls:
            raise RuntimeError('no UIPasteboard')
        pb = self.send(cls, b'generalPasteboard')
        if not pb:
            raise RuntimeError('no pasteboard')
        return pb

    def has(self):
        return bool(self.send(self.board(), b'hasStrings', self.c.c_bool))

    def read(self):
        s = self.send(self.board(), b'string')
        if not s:
            return ''
        raw = self.send(s, b'UTF8String', self.c.c_char_p)
        return raw.decode('utf-8', 'replace') if raw else ''


_native = {}
_broken = {}


def _helper(kind):
    """The JNI / Objective-C helper, built once; a platform where it cannot be built is remembered as unreadable."""
    if kind in _broken:
        return None
    if kind not in _native:
        try:
            _native[kind] = _Jni() if kind == 'android' else _ObjC()
        except Exception as exc:
            _broken[kind] = str(exc)
            return None
    return _native[kind]


def readable():
    """Can this device's clipboard be reached at all?"""
    p = platform()
    if p == 'windows' or p == 'osx':
        return True
    if p == 'linux':
        return _linux_cmd() is not None
    if p in ('android', 'ios', 'tvos'):
        return _helper('android' if p == 'android' else 'objc') is not None
    return False


def system_has():
    """True / False, or None when the device clipboard cannot be asked. Never reads the text itself."""
    p = platform()
    try:
        if p == 'windows':
            return _win_has()
        if p == 'osx':
            return bool(_run(['pbpaste']))
        if p == 'linux':
            cmd = _linux_cmd()
            return bool(_run(cmd)) if cmd else None
        if p in ('android', 'ios', 'tvos'):
            h = _helper('android' if p == 'android' else 'objc')
            return h.has() if h else None
    except Exception:
        return None
    return None


def system_read():
    """The text on the device clipboard ('' when it holds none), or None when it cannot be read."""
    p = platform()
    try:
        if p == 'windows':
            return _win_read()
        if p == 'osx':
            out = _run(['pbpaste'])
            return out.decode('utf-8', 'replace') if out is not None else None
        if p == 'linux':
            cmd = _linux_cmd()
            out = _run(cmd) if cmd else None
            return out.decode('utf-8', 'replace') if out is not None else None
        if p in ('android', 'ios', 'tvos'):
            h = _helper('android' if p == 'android' else 'objc')
            return h.read() if h else None
    except Exception:
        return None
    return None


def system_write(text):
    p = platform()
    try:
        if p == 'windows':
            return _win_write(text)
        if p == 'osx':
            return _run(['pbcopy'], text.encode('utf-8')) is not None
    except Exception:
        pass
    return False


def system_seq():
    """A number that changes whenever the Windows clipboard changes (cheap), else None."""
    if platform() == 'windows':
        try:
            return _win_seq()
        except Exception:
            return None
    return None


# ------------------------------------------------------------------ the keyboard
EDIT = 312               # the text field of DialogKeyboard.xml (CTL_EDIT)


def keyboard_open():
    import xbmc
    return bool(xbmc.getCondVisibility('Window.IsActive(virtualkeyboard)'))


def field_text():
    import xbmc
    return xbmc.getInfoLabel('Control.GetLabel(%d).index(1)' % EDIT)


def _send(text):
    import xbmc
    req = {'jsonrpc': '2.0', 'id': 1, 'method': 'Input.SendText', 'params': {'text': text, 'done': False}}
    try:
        return 'error' not in json.loads(xbmc.executeJSONRPC(json.dumps(req)))
    except Exception:
        return False


def _wait_field(expected, seconds=1.2):
    import xbmc
    end = time.time() + seconds
    while time.time() < end:
        if field_text() == expected:
            return True
        xbmc.sleep(40)
    return field_text() == expected


def paste(text):
    """Appends `text` to what the keyboard field holds. -> 'ok' | 'closed' | 'empty' | 'failed'.
    All or nothing: when the field does not end up holding exactly old + text, the old text is put back."""
    text = clean(text)
    if not text:
        return 'empty'
    if not keyboard_open():
        return 'closed'
    with _lock:
        old = field_text()
        hidden = bool(old) and set(old) == {'*'}
        if hidden:
            # a password field shows only stars: what it holds cannot be read back, so the paste replaces it
            new, expect = text, '*' * len(text)
        else:
            new = expect = old + text
        for _ in range(3):
            if not keyboard_open():
                return 'closed'
            if _send(new) and (_wait_field(expect) or (not old and _wait_field('*' * len(text), 0.3))):
                return 'ok'
        if hidden:
            return 'failed'
        if keyboard_open() and field_text() != old:
            _send(old)
            _wait_field(old, 0.6)
        return 'failed'
