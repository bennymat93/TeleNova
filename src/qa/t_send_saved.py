# -*- coding: utf-8 -*-
"""Engine RPC send_saved(text): a text goes to the account's own Saved Messages ('me') and nowhere else.
Mocked Telegram client and stubbed Kodi modules - no account, no Kodi. Ends with SEND_SAVED TESTS OK.
   python t_send_saved.py"""
import asyncio
import io
import os
import sys
import types

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'plugin.video.telescope'))
for name in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    mod = sys.modules.setdefault(name, types.ModuleType(name))
xbmc = sys.modules['xbmc']
xbmc.LOGINFO, xbmc.LOGDEBUG, xbmc.LOGWARNING, xbmc.LOGERROR = 1, 0, 2, 3
logged = []
xbmc.log = lambda m, *a: logged.append(str(m))
xbmc.Monitor = type('Monitor', (), {})
from resources.lib import tgclient  # noqa: E402

bad = []
LOOP = asyncio.new_event_loop()
SECRET = 'https://example.test/#pair=SECRET-TOKEN-123'


class FakeTelethon(object):
    def __init__(self):
        self.sent = []

    async def send_message(self, entity, text, **kw):
        self.sent.append((entity, text, kw))
        return types.SimpleNamespace(id=77)


class Fake(object):
    def __init__(self):
        self.client = FakeTelethon()
        self.authorized = True

    async def status(self):
        return {'authorized': self.authorized}

    def run(self, coro, timeout=60):
        return LOOP.run_until_complete(coro)

    send_saved = tgclient.TG.send_saved


f = Fake()
r = f.run(f.send_saved(SECRET))
if r != {'ok': True, 'id': 77}:
    bad.append('result %r' % (r,))
if len(f.client.sent) != 1 or f.client.sent[0][0] != 'me' or f.client.sent[0][1] != SECRET:
    bad.append('not sent once to me with the exact text')
try:
    f.run(f.send_saved('   '))
    bad.append('empty text was sent')
except tgclient.TGError:
    pass
f.run(f.send_saved('x' * 9000))
if len(f.client.sent[-1][1]) != 4000:
    bad.append('long text not capped')

# the service route: send_saved goes through the Saved Messages path (needs a logged-in account)
try:
    from resources.lib import service as S
    f2 = Fake()
    svc = types.SimpleNamespace(tg=f2, tg_error=None)
    out = S.Service._cloud(svc, 'send_saved', {'text': SECRET}) if hasattr(S, 'Service') else None
    if out is None:
        print('service class not found - route test skipped')
    elif not out.get('ok') or f2.client.sent[-1][0] != 'me':
        bad.append('service route %r' % (out,))
    f2.authorized = False
    try:
        S.Service._cloud(svc, 'send_saved', {'text': SECRET})
        bad.append('sent while not authorized')
    except RuntimeError as exc:
        if str(exc) != 'not_authorized':
            bad.append('unauthorized error %r' % exc)
except (ImportError, AttributeError) as exc:  # service.py needs a real Kodi to import
    print('service import skipped: %s' % exc)

if any('SECRET' in m for m in logged):
    bad.append('the text reached the log')
print('\n'.join(bad) if bad else 'SEND_SAVED TESTS OK')
sys.exit(1 if bad else 0)
