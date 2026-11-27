# -*- coding: utf-8 -*-
"""6.5.1: connect / restart / status of the Telegram engine in Kodi always end in a definite state.
The real Service class (plugin.video.telescope/resources/lib/service.py) with a stand-in Telegram client and stubbed
Kodi modules - no Kodi, no account, no network. Ends with TGSTATE TESTS OK.   python t_tgstate.py"""
import concurrent.futures
import io
import os
import sys
import tempfile
import threading
import time
import types

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
ADDON_DIR = os.path.abspath(os.path.join(HERE, '..', 'plugin.video.telescope'))
sys.path.insert(0, ADDON_DIR)
PROFILE = tempfile.mkdtemp(prefix='t_tgstate_')
for name in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules.setdefault(name, types.ModuleType(name))
xbmc, xbmcaddon, xbmcvfs = sys.modules['xbmc'], sys.modules['xbmcaddon'], sys.modules['xbmcvfs']
xbmc.LOGINFO, xbmc.LOGDEBUG, xbmc.LOGWARNING, xbmc.LOGERROR = 1, 0, 2, 3
logged = []
xbmc.log = lambda m, *a: logged.append(str(m))
xbmc.getInfoLabel = lambda *a: '21.0'
xbmc.getCondVisibility = lambda *a: False
xbmc.getLanguage = lambda *a, **k: 'en'
xbmc.executebuiltin = lambda *a, **k: None


class Monitor(object):
    def waitForAbort(self, seconds=0):
        time.sleep(seconds)
        return False

    def abortRequested(self):
        return False


xbmc.Monitor = Monitor


class Addon(object):
    def __init__(self, *a, **k):
        pass

    def getAddonInfo(self, key):
        return {'path': ADDON_DIR, 'profile': PROFILE, 'name': 'TeleScope', 'version': '0', 'id': 'plugin.video.telescope'}.get(key, '')

    def getSetting(self, key):
        return ''

    def setSetting(self, key, value):
        pass

    def getLocalizedString(self, n):
        return ''


xbmcaddon.Addon = Addon
xbmcvfs.translatePath = lambda p: p
from resources.lib import service as S, tgclient, linklogin  # noqa: E402

bad = []


def check(cond, what):
    print(('ok    ' if cond else 'FAIL  ') + what)
    if not cond:
        bad.append(what)


class Client(object):
    def __init__(self, connected=True):
        self.connected = connected

    def is_connected(self):
        return self.connected


class FakeTG(object):
    """what the service uses of tgclient.TG; coroutines are plain values here, run() hands them back"""
    alive = 0
    most = 0
    made = 0
    start_secs = 0.0
    start_error = None

    def __init__(self, *a, **k):
        FakeTG.made += 1
        self.client = None
        self.me = None
        self.hang = False
        self.answer = {'connected': True, 'authorized': True, 'me': {'name': 'Dana', 'username': 'd', 'premium': False}}
        self.reconnects = 0
        self.reconnect_error = None
        self.cancelled = []

    def start(self, timeout=60):
        FakeTG.alive += 1
        FakeTG.most = max(FakeTG.most, FakeTG.alive)
        time.sleep(FakeTG.start_secs)
        self.client = Client()
        if FakeTG.start_error:
            raise FakeTG.start_error

    def stop(self, timeout=10):
        FakeTG.alive -= 1

    def status(self):
        return 'status'

    def reconnect(self):
        return 'reconnect'

    def run(self, what, timeout=60):
        if what == 'status':
            if self.hang:
                raise concurrent.futures.TimeoutError()
            return dict(self.answer)
        if what == 'reconnect':
            self.reconnects += 1
            if self.reconnect_error:
                raise self.reconnect_error
            self.client.connected = True
            return True
        return what

    def bump(self, *a):
        pass

    drop = lower = bump

    def pace_info(self):
        return {}

    def qr_wait(self, timeout=4):
        return {'ok': False, 'url': 'tg://login?token=NEW'}

    def qr_accept(self, token):
        return ('accept', token)

    def submit(self, what):
        tg = self

        class Never(object):
            def result(self, timeout=None):
                raise concurrent.futures.TimeoutError()

            def cancel(self):
                tg.cancelled.append(what)
        return Never()


tgclient.TG = FakeTG
SETTINGS = {'api_id': '12345', 'api_hash': 'abc', 'parallel': 4, 'tg_quiet': True, 'tmdb_key': ''}


def service():
    FakeTG.alive = FakeTG.most = FakeTG.made = 0
    FakeTG.start_secs, FakeTG.start_error = 0.0, None
    svc = S.Service.__new__(S.Service)
    svc.s = dict(SETTINGS)
    svc.tg = svc.tg_error = svc.finder = svc.ai = None
    svc.deps_ok = True
    store = types.SimpleNamespace(on_wait=None, on_drop=None, on_low=None, speed=lambda: 0, size=0,
                                  stats={'hits': 0, 'miss': 0}, inflight=[], positions=[])
    svc.app = types.SimpleNamespace(store=store)
    svc._started = threading.Event()
    svc._started.set()
    svc._init_tg_state()
    svc.builds = 0
    svc._build = lambda: setattr(svc, 'builds', svc.builds + 1)
    return svc


# ------------------------------------------------------------------ K1: a slow Telegram is not "logged out"
svc = service()
svc._start_tg()
st = svc.rpc('status', {})
check(st.get('authorized') and st['me']['name'] == 'Dana' and st['state'] == 'authorized' and not st.get('stale') and not st.get('error'),
      'status of a logged-in engine: authorized, state "authorized"')
svc.tg.hang = True
st = svc.rpc('status', {})
check(st.get('error') == 'timeout', 'Telegram does not answer: the error says "timeout" (it was an empty text): %r' % st.get('error'))
check(st.get('authorized') and (st.get('me') or {}).get('name') == 'Dana' and st.get('stale') is True and st['state'] == 'authorized',
      '... and the answer still carries the account that was last known, marked stale')
svc = service()
svc._start_tg()
svc.tg.hang = True
st = svc.rpc('status', {})
check(st.get('error') == 'timeout' and not st.get('authorized') and 'me' not in st and st['state'] == 'error',
      'no answer ever since the start: "timeout", no account invented, state "error"')
svc.tg.hang = False
svc.tg.answer = {'connected': True, 'authorized': False, 'me': None}
check(svc.rpc('status', {})['state'] == 'connected_unauth', 'connected, nobody logged in: state "connected_unauth"')
svc.tg.answer = {'connected': False, 'authorized': False, 'me': None}
check(svc.rpc('status', {})['state'] == 'connecting', 'no connection: state "connecting"')
svc = service()
svc.s['api_id'] = ''
svc._start_tg()
st = svc.rpc('status', {})
check(st['state'] == 'not_configured' and st['error'] == 'not_configured', 'no API id: state "not_configured"')
svc._started.clear()
check(svc.rpc('status', {})['state'] == 'starting', 'before the start has finished: state "starting"')
svc = service()
svc.deps_ok = False
check(svc.rpc('status', {})['state'] == 'no_deps', 'the Telegram parts are missing: state "no_deps"')

# ------------------------------------------------------------------ K2: one restart at a time, no false "not configured"
svc = service()
FakeTG.start_secs = 0.4
threads = [threading.Thread(target=svc._start_tg) for _ in range(3)]
for t in threads:
    t.start()
time.sleep(0.15)
mid = {}
try:
    svc._need_tg()
    mid['need'] = 'no error'
except RuntimeError as exc:
    mid['need'] = str(exc)
try:
    svc.rpc('qr_check', {})
    mid['rpc'] = 'no error'
except RuntimeError as exc:
    mid['rpc'] = str(exc)
mid['state'] = svc.rpc('status', {})['state']
for t in threads:
    t.join(10)
check(FakeTG.most == 1 and FakeTG.made == 3 and FakeTG.alive == 1,
      'three starts at once: never two clients alive on one session (most %d)' % FakeTG.most)
check(mid['need'] == 'service_starting' and mid['rpc'] == 'service_starting',
      'a call during the restart is told "service_starting", not "not_configured": %r' % mid)
check(mid['state'] == 'starting', 'status during the restart: state "starting"')
check(not svc._restarting and svc._need_tg() is svc.tg, 'after the restart calls go through again')

svc = service()
svc._start_tg()
FakeTG.made = 0
S.Service.SETTLE = 0.4
new = dict(SETTINGS, api_hash='def')
real_load = S.load_settings
S.load_settings = lambda: dict(new)
for _ in range(3):                              # api_id, api_hash, one more - written one after the other
    svc.onSettingsChanged()
    time.sleep(0.1)
check(FakeTG.made == 0 and svc.builds == 0, 'setting changes are not applied one by one')
time.sleep(1.0)
check(FakeTG.made == 1 and svc.builds == 1 and svc.s['api_hash'] == 'def',
      'three changes within a second: ONE engine restart and ONE rebuild (%d / %d)' % (FakeTG.made, svc.builds))
svc.onSettingsChanged()
time.sleep(0.9)
check(FakeTG.made == 1 and svc.builds == 2, 'a change that does not touch the API pair rebuilds without a restart')
svc._importing = True
svc.onSettingsChanged()
time.sleep(0.7)
check(svc.builds == 2, 'writes of an import in progress are still ignored')
svc._importing = False
S.load_settings = real_load

# ------------------------------------------------------------------ K3: a late start failure does not stay for good
svc = service()
FakeTG.start_error = concurrent.futures.TimeoutError()
svc._start_tg()
FakeTG.start_error = None
check(svc.tg is not None and (svc.tg_error or '').startswith('TimeoutError') and svc.tg.client.is_connected(),
      'start cut by its time limit after the connect: the client is kept, the error is set')
check(svc.app.store.on_wait == svc.tg.bump and svc.app.store.on_low == svc.tg.lower,
      '... and the stream store is already bound to this client')
svc.tg.answer = {'connected': True, 'authorized': False, 'me': None}
check(svc.rpc('status', {})['state'] == 'error', '... state "error" until the watchdog has looked')
svc._watchdog()
st = svc.rpc('status', {})
check(svc.tg_error is None and st['error'] is None and st['connected'] and st['state'] == 'connected_unauth',
      'one watchdog round: the client is connected, the old error is gone: %r' % st.get('error'))
check(svc.tg.reconnects == 1, '... and the account is read once')
svc.tg_error = 'not_configured'
svc._watchdog()
check(svc.tg_error == 'not_configured', 'the watchdog never clears "not_configured"')
svc.tg_error = None

del logged[:]
svc.tg.client.connected = False
svc.tg.reconnect_error = concurrent.futures.TimeoutError()
for _ in range(4):
    svc._watchdog()
lost = [m for m in logged if 'disconnected' in m]
failed = [m for m in logged if 'reconnect failed' in m]
check(len(lost) == 1 and len(failed) == 1, 'offline for 4 watchdog rounds: one "disconnected" and one "failed" line (%d / %d)' % (len(lost), len(failed)))
svc.tg.reconnect_error = None
svc._watchdog()
check(svc.tg.client.is_connected() and any('telegram reconnected' in m for m in logged), 'the connection comes back: reconnected, said once')

# ------------------------------------------------------------------ K8: the household sign-in
asked = []


class Mailbox(object):
    def ask(self, secret, token):
        asked.append((secret, token))
        return True

    def take(self, secret):
        return b'T' * 48


real_mailbox = linklogin.Mailbox
linklogin.Mailbox = Mailbox
svc = service()
svc._start_tg()
secret = svc._link_secret(make=True)
svc.tg._qr = types.SimpleNamespace(_resp=types.SimpleNamespace(token=b'first-token'))
check(svc._link_post(svc.tg) is True, 'a device with a household secret posts its login token')
svc.tg._qr._resp.token = b'renewed-token'          # what tgclient._qr_settle does when a token is renewed
res = svc.rpc('qr_wait', {'timeout': 0})
time.sleep(0.6)
check(res.get('url') and (secret, b'renewed-token') in asked and (secret, b'first-token') in asked,
      'a RENEWED token (qr_wait answers with a new url) is posted too: %d posts' % len(asked))
os.remove(os.path.join(PROFILE, 'tg_link.txt'))
del asked[:]
check(svc._link_post(svc.tg) is False and not asked, 'no household secret: nothing is posted')
svc._link_secret(make=True)
svc.tg.me = object()
try:
    svc._link_tick()
    check(False, 'an approval that gets no answer ends in an error')
except concurrent.futures.TimeoutError:
    check(len(svc.tg.cancelled) == 1 and svc.tg.cancelled[0][0] == 'accept',
          'an approval that gets no answer from Telegram is cancelled, not left running')
linklogin.Mailbox = real_mailbox
check(not any('token' in m and ('first' in m or 'renewed' in m) for m in logged), 'no login token in the log')

print('\n' + ('TGSTATE TESTS OK' if not bad else 'TGSTATE TESTS FAILED: %d' % len(bad)))
sys.exit(1 if bad else 0)
