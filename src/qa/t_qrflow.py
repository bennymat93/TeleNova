# -*- coding: utf-8 -*-
"""6.5.1 (K5): the QR login of the Kodi engine always ends in a definite answer - against a stand-in Telethon.
An approval between two short waits is seen at once, Telegram errors come back as a reason (never raised),
cancel removes the update handler, no client -> 'network'. Ends with QRFLOW TESTS OK."""
import asyncio, datetime, io, os, sys, types

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'plugin.video.telescope'))
for name in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules.setdefault(name, types.ModuleType(name))


def mod(name):
    m = types.ModuleType(name)
    sys.modules[name] = m
    return m


class LoginToken(object):
    def __init__(self, token=b't', minutes=1):
        self.token = token
        self.expires = datetime.datetime.now() + datetime.timedelta(minutes=minutes)


class LoginTokenSuccess(object):
    def __init__(self):
        self.authorization = types.SimpleNamespace(user='USER')


class LoginTokenMigrateTo(object):
    pass


class SessionPasswordNeededError(Exception):
    pass


class FloodWaitError(Exception):
    seconds = 30


class AuthTokenExpiredError(Exception):
    pass


tl = mod('telethon')
ev = mod('telethon.events')
ev.Raw = lambda kind: ('raw', kind)
tl.events = ev
tlt = mod('telethon.tl')
tps = mod('telethon.tl.types')
tps.UpdateLoginToken = 'UpdateLoginToken'
tps.auth = types.SimpleNamespace(LoginToken=LoginToken, LoginTokenSuccess=LoginTokenSuccess, LoginTokenMigrateTo=LoginTokenMigrateTo)
fns = mod('telethon.tl.functions')
fns.auth = types.SimpleNamespace(ImportLoginTokenRequest=lambda t: ('import', t))
tlt.types, tlt.functions = tps, fns
err = mod('telethon.errors')
err.SessionPasswordNeededError = SessionPasswordNeededError

from resources.lib import tgclient  # noqa: E402

bad = []


def check(cond, what):
    print(('ok    ' if cond else 'FAIL  ') + what)
    if not cond:
        bad.append(what)


class QR(object):
    def __init__(self):
        self._request = 'EXPORT'
        self._resp = LoginToken()

    @property
    def url(self):
        return 'tg://login?token=%s' % id(self._resp)

    @property
    def expires(self):
        return self._resp.expires


class Client(object):
    def __init__(self):
        self.handlers = []
        self.answers = []          # what the next export request gives (an exception is raised)
        self.connected = True

    def is_connected(self):
        return self.connected

    async def qr_login(self):
        return QR()

    def add_event_handler(self, fn, kind):
        self.handlers.append(fn)

    def remove_event_handler(self, fn):
        self.handlers.remove(fn)

    async def _on_login(self, user):
        pass

    async def __call__(self, request):
        item = self.answers.pop(0) if self.answers else LoginToken()
        if isinstance(item, Exception):
            raise item
        return item


def engine(client):
    tg = object.__new__(tgclient.TG)
    tg.client, tg.me, tg._qr = client, None, None
    tg.log = lambda *a, **k: None

    async def hint():
        return ''
    tg._password_hint = hint
    return tg


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


asyncio.set_event_loop(asyncio.new_event_loop())

tg = engine(None)
check(run(tg.qr_start()).get('error') == 'network', 'no client yet: "network", not AttributeError')
c = Client()
c.connected = False
check(run(engine(c).qr_start()).get('error') == 'network', 'client not connected: "network"')

c = Client()
tg = engine(c)
res = run(tg.qr_start())
check(res.get('url') and len(c.handlers) == 1, 'QR start: a url and ONE update handler')
check(run(tg.qr_wait(0.05)) == {'ok': False}, 'nothing happened: still waiting')


async def approve_between():
    await c.handlers[0](object())              # the update arrives while nobody waits
    c.answers = [LoginTokenSuccess()]
    return await tg.qr_wait(5)
loop = asyncio.get_event_loop()
t0 = loop.time()
res = run(approve_between())
check(res == {'ok': True} and loop.time() - t0 < 1, 'an approval between two waits is seen at once: %r' % res)
check(tg.me == 'USER' and c.handlers == [] and tg._qr is None, 'after the login the handler and the token are gone')

for exc, want in ((ConnectionResetError(), 'network'), (FloodWaitError(), 'flood')):
    c = Client()
    tg = engine(c)
    run(tg.qr_start())
    c.answers = [exc]
    try:
        res = run(tg._qr_settle())
    except Exception as e:                      # noqa: BLE001
        res = {'raised': type(e).__name__}
    check(res.get('ok') is False and res.get('error') == want, '%s: an answer, not an exception: %r' % (type(exc).__name__, res))
check(tg._qr is None and c.handlers == [], 'a definite refusal (flood) ends the login and removes the handler')

c = Client()
tg = engine(c)
run(tg.qr_start())
c.answers = [ConnectionResetError()]
run(tg._qr_settle())
check(tg._qr is not None, 'no network: the login stays, asked again later')

c = Client()
tg = engine(c)
run(tg.qr_start())
c.answers = [AuthTokenExpiredError(), LoginToken()]
res = run(tg._qr_settle())
check(res.get('ok') is False and res.get('url') and tg._qr is not None, 'an expired token is renewed, the login goes on: %r' % res)

c.answers = [SessionPasswordNeededError()]
res = run(tg._qr_settle())
check(res.get('password') is True and c.handlers == [], 'two-step password: asked for, handler removed')

c = Client()
tg = engine(c)
run(tg.qr_start())
check(run(tg.qr_cancel()) == {'ok': True} and c.handlers == [] and tg._qr is None, 'cancel removes the handler and the token')
check(run(tg.qr_wait(0)) == {'ok': False}, 'a wait after cancel answers at once')

# the Kodi window side must ride out a 'network' answer like the engine does (it keeps _qr)
with io.open(os.path.join(HERE, '..', 'plugin.video.telescope', 'resources', 'lib', 'router.py'), encoding='utf-8') as f:
    rsrc = f.read()
qsrc = rsrc[rsrc.index('def _qr_login'):]
qsrc = qsrc[:qsrc.index('\ndef ', 1)]
check(qsrc.index("r.get('error') == 'network'") < qsrc.index("elif r.get('error'):"),
      'router: a network answer keeps waiting, other errors end the QR login')

print('\n' + ('QRFLOW TESTS OK' if not bad else 'QRFLOW TESTS FAILED: %d' % len(bad)))
sys.exit(1 if bad else 0)
