# -*- coding: utf-8 -*-
"""3.3.3 tests: request bots, discovery, link tests with media headers, result rows.

Telegram is simulated: a fake client with scripted bots (button lists, file-store deep links, "join first" walls,
edited result pages, silent bots). The real Telethon package is imported only for its request / error classes.
Run:  python test_bots.py            (needs the Telethon copy Kodi installed, see LIB below)
"""
import asyncio
import glob
import os
import sys
import tempfile
import threading
import time
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp(prefix='bots_', dir=HERE)
ADDON_ROOT = os.path.normpath(os.path.join(HERE, '..', '..', 'plugin.video.telescope'))
LIB = os.path.join(os.environ.get('APPDATA', ''), 'Kodi', 'userdata', 'addon_data', 'plugin.video.telescope', 'lib')
SAMPLES = os.environ.get('TN_SAMPLES') or os.path.join(HERE, 'samples')

SETTINGS = {'debug': 'false'}
LOGGED = []


class _Addon(object):
    def __init__(self, *a, **k):
        pass

    def getAddonInfo(self, key):
        return {'name': 'TeleScope', 'version': '0', 'path': TMP, 'profile': TMP}.get(key, '')

    def getSetting(self, key):
        return SETTINGS.get(key, '')

    def setSetting(self, key, value):
        SETTINGS[key] = value

    def getLocalizedString(self, i):
        return {30136: '%d tested, %d working, %d removed', 30146: 'asked %d, files %d'}.get(i, 'S%d' % i)


xbmc = types.ModuleType('xbmc')
xbmc.LOGDEBUG, xbmc.LOGINFO, xbmc.LOGERROR, xbmc.ISO_639_1 = 0, 1, 3, 0
xbmc.log = lambda msg, level=0: LOGGED.append((level, msg))
xbmc.getInfoLabel = lambda x: '21.0'
xbmc.getLanguage = lambda *a: 'en'
xbmc.getCondVisibility = lambda x: False
xbmc.Monitor = object
xbmcaddon = types.ModuleType('xbmcaddon')
xbmcaddon.Addon = _Addon
xbmcgui = types.ModuleType('xbmcgui')
xbmcgui.WindowDialog = object
xbmcvfs = types.ModuleType('xbmcvfs')
xbmcvfs.translatePath = lambda p: p
xbmcplugin = types.ModuleType('xbmcplugin')
for _m in (xbmc, xbmcaddon, xbmcgui, xbmcvfs, xbmcplugin):
    sys.modules[_m.__name__] = _m
sys.path.insert(0, ADDON_ROOT)
if os.path.isdir(LIB):
    sys.path.insert(0, LIB)

from resources.lib import mediainfo, tgbots, sources, matcher, cache  # noqa: E402
from resources.lib.tgclient import TG  # noqa: E402

try:
    import telethon  # noqa: F401
    HAVE_TELETHON = True
except Exception:
    HAVE_TELETHON = False


def sample(name):
    path = os.path.join(SAMPLES, name)
    with open(path, 'rb') as fh:
        return fh.read(131072)


# ------------------------------------------------------------------ fake Telegram
class FFile(object):
    def __init__(self, name, size=900 * 1024 * 1024, mime='video/x-matroska', duration=0):
        self.name, self.size, self.mime_type, self.duration = name, size, mime, duration
        self.ext = os.path.splitext(name)[1]
        self.width = self.height = 0


class FBtn(object):
    def __init__(self, text, data=None, url=None):
        self.text, self.data, self.url = text, data, url


class FEnt(object):
    def __init__(self, eid, username=None, bot=False, title=None, first_name=None, broadcast=False, **kw):
        self.id, self.username, self.bot = eid, username, bot
        if title is not None:
            self.title = title
            self.broadcast = broadcast
            self.left = kw.pop('left', True)
            self.participants_count = kw.pop('members', None)
        else:
            self.first_name = first_name or username
            self.last_name = ''
        self.bot_inline_placeholder = kw.pop('inline', None)
        for k, v in kw.items():
            setattr(self, k, v)


class FMsg(object):
    def __init__(self, client, chat, mid, text='', out=False, file=None, buttons=None, blob=None):
        self._client, self.chat, self.id, self.message, self.out = client, chat, mid, text, out
        self.chat_id = chat.id
        self.file, self.buttons, self.edit_date = file, buttons, None
        self.media = types.SimpleNamespace(document=types.SimpleNamespace(id=hash((chat.id, file.name)) if file else 0),
                                           blob=blob) if file else None
        self.video = True if file and file.mime_type.startswith('video/') else None
        self.date = None

    def get_entities_text(self):
        return []

    async def click(self, data=None):
        self._client.clicks.append((self.chat.username, data))
        script = self._client.scripts.get(self.chat.id)
        if script and hasattr(script, 'on_click'):
            return script.on_click(self._client, self.chat, self, data)
        return None


class FClient(object):
    def __init__(self):
        self.ents, self.hist, self.scripts = {}, {}, {}
        self.seq = 100
        self.clicks, self.sent, self.started, self.joined = [], [], [], []
        self.search_hits = {}
        self.dead = set()
        self.search_result = None
        self.recommend = {}
        self.dialog_list = []

    def add(self, ent, script=None):
        self.ents[ent.id] = ent
        if ent.username:
            self.ents[ent.username.lower()] = ent
        self.hist.setdefault(ent.id, [])
        if script:
            self.scripts[ent.id] = script
        return ent

    def post(self, chat, text='', file=None, buttons=None, out=False, blob=None):
        self.seq += 1
        m = FMsg(self, chat, self.seq, text, out, file, buttons, blob)
        self.hist[chat.id].append(m)
        return m

    async def get_entity(self, ref):
        if isinstance(ref, FEnt):
            return ref
        key = ref.lower() if isinstance(ref, str) else ref
        if key not in self.ents:
            raise ValueError('no entity %r' % (ref,))
        return self.ents[key]

    async def get_input_entity(self, ref):
        return await self.get_entity(ref)

    async def get_messages(self, ent, limit=None, min_id=0, ids=None, filter=None):
        ent = await self.get_entity(ent)
        msgs = self.hist.get(ent.id, [])
        if ids is not None:
            for m in msgs:
                if m.id == ids and (ent.id, m.id) not in self.dead:
                    return m
            return None
        out = [m for m in msgs if m.id > (min_id or 0)]
        if filter is not None:
            out = [m for m in out if m.file is not None]
        out = sorted(out, key=lambda m: -m.id)
        return out[:limit] if limit else out

    async def send_message(self, ent, text):
        ent = await self.get_entity(ent)
        m = self.post(ent, text, out=True)
        self.sent.append((ent.username, text))
        script = self.scripts.get(ent.id)
        if script:
            script.on_message(self, ent, text)
        return m

    async def __call__(self, request):
        name = type(request).__name__
        if name == 'StartBotRequest':
            ent = await self.get_entity(request.bot)
            self.started.append((ent.username, request.start_param))
            self.post(ent, '/start ' + request.start_param, out=True)
            self.scripts[ent.id].on_start(self, ent, request.start_param)
            return None
        if name == 'SearchRequest':
            return self.search_result(request.q) if callable(self.search_result) else self.search_result
        if name == 'GetChannelRecommendationsRequest':
            return types.SimpleNamespace(chats=self.recommend.get(request.channel.id, []))
        if name in ('JoinChannelRequest', 'ImportChatInviteRequest'):
            self.joined.append(getattr(request, 'channel', None) or getattr(request, 'hash', None))
            return None
        raise NotImplementedError(name)

    def iter_messages(self, entity, search=None, limit=None, **kw):
        client = self

        async def gen():
            if entity is None:
                for m in client.search_hits.get(search, []):
                    yield m
            else:
                try:
                    ent = await client.get_entity(entity)
                except ValueError:
                    return
                for m in client.hist.get(ent.id, []):
                    if m.file and search and search.lower().split()[0] in (m.file.name + ' ' + m.message).lower():
                        yield m
        return gen()

    def iter_dialogs(self, limit=None):
        client = self

        async def gen():
            for d in client.dialog_list:
                yield d
        return gen()

    def iter_download(self, media, offset=0, request_size=0, chunk_size=0, limit=1):
        async def gen():
            await asyncio.sleep(0.02)
            if getattr(media, 'blob', None) is None:
                raise IOError('file is gone')
            yield media.blob[offset:offset + request_size]
        return gen()

    async def inline_query(self, ent, query):
        return []


def make_tg(client):
    tg = TG(1, 'hash', os.path.join(TMP, 'session'), lambda m: LOGGED.append((1, m)), parallel=4)
    th = threading.Thread(target=tg._run_loop, daemon=True)
    th.start()
    tg._ready.wait(5)
    tg.client = client
    tg.me = types.SimpleNamespace(first_name='Tester', last_name='', username='tester')

    async def join(link):
        client.joined.append(link)
        return True
    tg.join = join
    return tg


def movie_file(name='Big.Buck.Movie.2020.1080p.WEB-DL.mkv', **kw):
    return FFile(name, **kw)


# ---- scripted bots
class FilterBot(object):
    """Answers a title with a page of buttons; a button sends the file. 'next' edits the page."""
    def __init__(self, pages, blob=None):
        self.pages, self.blob, self.page_msg = pages, blob, None

    def _rows(self, n):
        rows = [[FBtn(label, data=('f:%s' % label).encode())] for label in self.pages[n]]
        rows.append([FBtn('1/%d' % len(self.pages), data=b'pg'), FBtn(u'Next ⏩', data=('n:%d' % (n + 1)).encode())])
        return rows

    def on_message(self, client, ent, text):
        if text == '/start':
            client.post(ent, 'Welcome! Send me a movie name', buttons=[[FBtn('Help', data=b'help')]])
            return
        self.page_msg = client.post(ent, 'Results for %s' % text, buttons=self._rows(0))

    def on_click(self, client, ent, msg, data):
        data = data.decode()
        if data.startswith('f:'):
            client.post(ent, '', file=FFile(data[2:]), blob=self.blob)
        elif data.startswith('n:') and int(data[2:]) < len(self.pages):
            msg.buttons = self._rows(int(data[2:]))
            msg.edit_date = time.time()
        return types.SimpleNamespace(message=None, url=None)


class LinkBot(object):
    """Answers with a URL button to a file-store bot."""
    def __init__(self, store, code='abc123'):
        self.store, self.code = store, code

    def on_message(self, client, ent, text):
        if text == '/start':
            return
        client.post(ent, 'Found: %s' % text,
                    buttons=[[FBtn(u'\U0001f4e5 Download 1080p', url='https://t.me/%s?start=%s' % (self.store, self.code))],
                             [FBtn('Our channel', url='https://t.me/some_ads_channel')]])


class StoreBot(object):
    def __init__(self, name, blob=None, wall=None):
        self.name, self.blob, self.wall, self.calls = name, blob, wall, 0

    def on_message(self, client, ent, text):
        pass

    def on_start(self, client, ent, code):
        self.calls += 1
        if self.wall and self.wall not in [str(x) for x in client.joined]:
            client.post(ent, 'You must join our channel to use this bot',
                        buttons=[[FBtn('Join channel', url=self.wall)], [FBtn(u'✅ Joined', data=b'retry')]])
            return
        client.post(ent, self.name, file=FFile(self.name), blob=self.blob)

    def on_click(self, client, ent, msg, data):
        if data == b'retry':
            self.on_start(client, ent, 'again')
        return None


class SilentBot(object):
    def on_message(self, client, ent, text):
        pass


def run(tg, coro, timeout=40):
    return tg.run(coro, timeout)


@unittest.skipUnless(HAVE_TELETHON, 'Telethon is not installed here')
class BotTalkTests(unittest.TestCase):
    def setUp(self):
        self.c = FClient()
        self.tg = make_tg(self.c)

    def tearDown(self):
        self.tg.loop.call_soon_threadsafe(self.tg.loop.stop)

    def test_buttons_right_episode_only(self):
        pages = [['Show.Name.S02E04.720p.mkv', 'Show.Name.S02E05.1080p.WEB.mkv', 'Show.Name.S02E05.720p.mkv',
                  'Show.Name.S02E06.1080p.mkv', 'Other.Show.S02E05.1080p.mkv']]
        bot = self.c.add(FEnt(501, 'filterbot', bot=True), FilterBot(pages))
        self.c.post(bot, 'old chat')                        # the bot was opened before
        f = sources.Finder(self.tg, None, None, None, cache.Cache(os.path.join(TMP, 'c1.db')), {}, lambda m: None)
        t = {'kind': 'episode', 'title': 'Show Name', 'aliases': ['Show Name'], 'season': 2, 'episode': 5, 'year': 2020}
        t0 = time.time()
        res = run(self.tg, self.tg.bot_ask(bot.id, ['Show Name S02E05'], timeout=12, rank=f._button_rank(t)))
        names = sorted(c['file'] for c in res['files'])
        self.assertEqual(names, ['Show.Name.S02E05.1080p.WEB.mkv', 'Show.Name.S02E05.720p.mkv'])
        clicked = [d.decode() for _, d in self.c.clicks]
        self.assertNotIn('f:Show.Name.S02E04.720p.mkv', clicked)
        self.assertNotIn('f:Other.Show.S02E05.1080p.mkv', clicked)
        self.assertEqual(self.c.sent, [('filterbot', 'Show Name S02E05')])      # no /start for a known bot
        self.assertTrue(all(c['chat_kind'] == 'bot' and c['via_bot'] == 'filterbot' for c in res['files']))
        self.assertLess(time.time() - t0, 9)

    def test_first_contact_sends_start_and_ignores_menu(self):
        bot = self.c.add(FEnt(502, 'newbot', bot=True), FilterBot([['Big.Buck.Movie.2020.1080p.mkv']]))
        res = run(self.tg, self.tg.bot_ask('@newbot', ['Big Buck Movie'], timeout=12))
        self.assertEqual([t for _, t in self.c.sent], ['/start', 'Big Buck Movie'])
        self.assertEqual([c['file'] for c in res['files']], ['Big.Buck.Movie.2020.1080p.mkv'])
        self.assertNotIn(('newbot', b'help'), self.c.clicks)

    def test_next_page_when_first_page_has_nothing(self):
        pages = [['Wrong.Film.2011.mkv', 'Another.One.2012.mkv'], ['Big.Buck.Movie.2020.2160p.mkv']]
        bot = self.c.add(FEnt(503, 'pager', bot=True), FilterBot(pages))
        self.c.post(bot, 'old')
        f = sources.Finder(self.tg, None, None, None, cache.Cache(os.path.join(TMP, 'c2.db')), {}, lambda m: None)
        t = {'kind': 'movie', 'title': 'Big Buck Movie', 'aliases': ['Big Buck Movie'], 'year': 2020}
        res = run(self.tg, self.tg.bot_ask(bot.id, ['Big Buck Movie'], timeout=14, rank=f._button_rank(t)))
        self.assertEqual([c['file'] for c in res['files']], ['Big.Buck.Movie.2020.2160p.mkv'])
        self.assertNotIn(b'f:Wrong.Film.2011.mkv', [d for _, d in self.c.clicks])

    def test_deep_link_to_file_store_bot(self):
        self.c.add(FEnt(511, 'storebot1', bot=True), StoreBot('Big.Buck.Movie.2020.1080p.mkv'))
        bot = self.c.add(FEnt(510, 'linker', bot=True), LinkBot('storebot1'))
        self.c.post(bot, 'old')
        res = run(self.tg, self.tg.bot_ask(bot.id, ['Big Buck Movie'], timeout=12))
        self.assertEqual(self.c.started, [('storebot1', 'abc123')])
        self.assertEqual([c['file'] for c in res['files']], ['Big.Buck.Movie.2020.1080p.mkv'])
        self.assertEqual(res['files'][0]['chat_id'], 511)        # the file plays from the store bot's chat
        self.assertEqual(res['join'], [])                         # "Our channel" under an answer is not a demand

    def test_join_wall_is_reported_not_guessed(self):
        self.c.add(FEnt(521, 'storebot2', bot=True), StoreBot('Big.Buck.Movie.2020.mkv', wall='https://t.me/must_join_me'))
        bot = self.c.add(FEnt(520, 'linker2', bot=True), LinkBot('storebot2'))
        self.c.post(bot, 'old')
        res = run(self.tg, self.tg.bot_ask(bot.id, ['Big Buck Movie'], timeout=10))
        self.assertEqual(res['files'], [])
        self.assertEqual(res['join'], ['https://t.me/must_join_me'])
        self.assertEqual(self.c.joined, [])

    def test_join_wall_with_permission(self):
        self.c.add(FEnt(531, 'storebot3', bot=True), StoreBot('Big.Buck.Movie.2020.mkv', wall='https://t.me/must_join_me'))
        bot = self.c.add(FEnt(530, 'linker3', bot=True), LinkBot('storebot3'))
        self.c.post(bot, 'old')
        res = run(self.tg, self.tg.bot_ask(bot.id, ['Big Buck Movie'], timeout=14, autojoin=True))
        self.assertEqual(self.c.joined, ['https://t.me/must_join_me'])
        self.assertEqual([c['file'] for c in res['files']], ['Big.Buck.Movie.2020.mkv'])

    def test_silent_bot_costs_only_its_time_limit(self):
        bot = self.c.add(FEnt(540, 'deadbot', bot=True), SilentBot())
        self.c.post(bot, 'old')
        t0 = time.time()
        res = run(self.tg, self.tg.bot_ask(bot.id, ['Anything'], timeout=3))
        self.assertEqual(res['files'], [])
        self.assertFalse(res['answered'])
        self.assertLess(time.time() - t0, 5)

    def test_not_a_bot_is_never_written_to(self):
        self.c.add(FEnt(550, 'aperson', bot=False, first_name='Dana'))
        res = run(self.tg, self.tg.bot_ask('aperson', ['Movie']))
        self.assertEqual(res['error'], 'not_a_bot')
        self.assertEqual(self.c.sent, [])

    def test_two_requests_to_one_bot_do_not_mix(self):
        bot = self.c.add(FEnt(560, 'busy', bot=True), FilterBot([['Big.Buck.Movie.2020.1080p.mkv']]))
        self.c.post(bot, 'old')

        async def both():
            return await asyncio.gather(self.tg.bot_ask(bot.id, ['Big Buck Movie'], timeout=10),
                                        self.tg.bot_ask(bot.id, ['Big Buck Movie'], timeout=10))
        a, b = run(self.tg, both(), 40)
        self.assertEqual(len(a['files']), 1)
        self.assertEqual(len(b['files']), 1)


class LinkParseTests(unittest.TestCase):
    def test_links(self):
        T = tgbots.tme
        self.assertEqual(T('https://t.me/FileBot?start=Zm9v'), ('start', 'FileBot', 'Zm9v'))
        self.assertEqual(T('tg://resolve?domain=FileBot&start=x1'), ('start', 'FileBot', 'x1'))
        self.assertEqual(T('t.me/somechan/1234'), ('msg', 'somechan', 1234))
        self.assertEqual(T('https://t.me/c/1234567890/55'), ('msg', -1001234567890, 55))
        self.assertEqual(T('https://t.me/+AbCdEf123'), ('join', 'https://t.me/+AbCdEf123'))
        self.assertEqual(T('https://t.me/joinchat/AAAA'), ('join', 'https://t.me/joinchat/AAAA'))
        self.assertEqual(T('https://t.me/movies_il'), ('join', 'https://t.me/movies_il'))
        self.assertIsNone(T('https://example.com/x?start=1'))
        self.assertIsNone(T('https://t.me/share/url?url=x'))
        self.assertIsNone(T(''))

    def test_refs(self):
        self.assertEqual(tgbots.ref('-100123'), -100123)
        self.assertEqual(tgbots.ref('@Some_Bot'), 'Some_Bot')
        self.assertEqual(tgbots.ref('https://t.me/Some_Chan/55'), 'Some_Chan')
        self.assertTrue(tgbots.is_system_bot('BotFather'))
        self.assertFalse(tgbots.is_system_bot('moviesbot'))


class MediaInfoTests(unittest.TestCase):
    def test_mkv_tracks(self):
        info = mediainfo.inspect(sample('hevc.mkv'))
        self.assertEqual((info['container'], info['duration'], info['width'], info['height']), ('mkv', 65, 1920, 800))
        self.assertEqual(info['audio'], ['he', 'en'])
        self.assertEqual(info['subs'], ['he'])
        self.assertEqual(info['video'], 'HEVC')
        self.assertEqual(info['title'], 'Some.Show.S02E05.1080p')
        self.assertEqual(mediainfo.quality_of(1920, 800), 1080)

    def test_mp4(self):
        info = mediainfo.inspect(sample('fast.mp4'))
        self.assertEqual((info['duration'], info['width'], info['height'], info['audio']), (30, 1280, 720, ['ru']))
        self.assertFalse(mediainfo.inspect(sample('slow.mp4'))['known'])    # moov at the end: nothing claimed

    def test_garbage_never_raises(self):
        import random
        random.seed(7)
        base = bytearray(sample('hevc.mkv'))
        for _ in range(1500):
            x = bytearray(base[:random.randint(0, 5000)])
            for _ in range(random.randint(1, 25)):
                if x:
                    x[random.randrange(len(x))] = random.randrange(256)
            mediainfo.inspect(bytes(x))
        self.assertEqual(mediainfo.inspect(b''), {})
        self.assertEqual(mediainfo.inspect(b'Rar!\x1a\x07\x00' + b'\x00' * 50), {})


class FakeMeta(object):
    def details(self, kind, ident):
        return None


def finder_for(tg, name, **settings):
    s = {'search_timeout': 6, 'probe_timeout': 6, 'bot_timeout': 10, 'max_results': 25, 'probe': True,
         'probe_all': True, 'bot_request': True, 'bot_auto': False, 'bots': [], 'chiko': False, 'strict': True,
         'ai_aliases': False, 'ai_verify': False, 'bots_file': os.path.join(TMP, name + '.json'),
         'crypto': 'tnige-aesni', 'hide_slow': True}
    s.update(settings)
    return sources.Finder(tg, FakeMeta(), None, None, cache.Cache(os.path.join(TMP, name + '.db')), s,
                          lambda m: LOGGED.append((1, m)))


def wait_job(f, job_id, limit=40):
    t0 = time.time()
    while time.time() - t0 < limit:
        j = f.jobs[job_id]
        if j.done:
            return j
        time.sleep(0.05)
    raise AssertionError('job did not finish')


@unittest.skipUnless(HAVE_TELETHON, 'Telethon is not installed here')
class FinderTests(unittest.TestCase):
    def setUp(self):
        self.c = FClient()
        self.tg = make_tg(self.c)
        self.mkv = open(os.path.join(SAMPLES, 'movie100.mkv'), 'rb').read(200000)
        self.clip = open(os.path.join(SAMPLES, 'hevc.mkv'), 'rb').read(200000)

    def tearDown(self):
        self.tg.loop.call_soon_threadsafe(self.tg.loop.stop)

    def test_bot_only_title_is_found_and_verified(self):
        """Search finds nothing; the request bot has the film -> listed, tested, marked as coming from a bot."""
        self.c.add(FEnt(601, 'reqbot', bot=True), FilterBot([['Big.Buck.Movie.2020.1080p.WEB-DL.mkv']], self.mkv))
        self.c.post(self.c.ents[601], 'old')
        f = finder_for(self.tg, 'f1', bots=['reqbot'])
        t0 = time.time()
        j = wait_job(f, f.start({'type': 'movie', 'title': 'Big Buck Movie', 'year': 2020}))
        took = time.time() - t0
        self.assertIsNone(j.error)
        self.assertEqual(len(j.result), 1)
        r = j.result[0]
        self.assertEqual((r['probe'], r['chat_kind'], r['via_bot']), ('ok', 'bot', 'reqbot'))
        self.assertEqual(r['media']['subs'], ['he'])
        self.assertTrue(r['he_sub_inside'])
        self.assertIn('he_sub', r['langs'])
        self.assertEqual(j.stats['bots'][0]['files'], 1)
        self.assertEqual(j.stats['checks']['ok'], 1)
        self.assertLess(took, 9)
        stats = f._bots_load()['stats']['reqbot']
        self.assertEqual((stats['asked'], stats['hits']), (1, 1))

    def _hits(self, chat, names, blob, **kw):
        out = []
        for n in names:
            out.append(self.c.post(chat, '', file=FFile(n, **kw), blob=blob))
        return out

    def test_every_link_is_tested_dead_and_sample_dropped(self):
        chan = self.c.add(FEnt(-100700, 'chan', title='Movies HD', broadcast=True))
        good = self._hits(chan, ['Big.Buck.Movie.2020.%dp.x%d.mkv' % (q, i) for i, q in
                                 enumerate([1080, 720, 2160, 1080, 720, 480, 1080, 720, 1080, 2160, 720, 1080])], self.mkv)
        dead = self._hits(chan, ['Big.Buck.Movie.2020.1080p.DEAD.mkv'], None)
        clip = self._hits(chan, ['Big.Buck.Movie.2020.1080p.CLIP.mkv'], self.clip)       # really 65 seconds long
        rar = self._hits(chan, ['Big.Buck.Movie.2020.1080p.FAKE.mkv'], b'Rar!\x1a\x07\x00' + b'\x00' * 5000)
        self.c.search_hits['Big Buck Movie'] = good + dead + clip + rar
        f = finder_for(self.tg, 'f2', bot_request=False)
        t0 = time.time()
        j = wait_job(f, f.start({'type': 'movie', 'title': 'Big Buck Movie', 'year': 2020}))
        took = time.time() - t0
        self.assertIsNone(j.error)
        names = [r['file'] for r in j.result]
        self.assertEqual(len(names), 12)
        for bad in ('DEAD', 'CLIP', 'FAKE'):
            self.assertFalse(any(bad in n for n in names), bad)
        self.assertTrue(all(r['probe'] == 'ok' for r in j.result))
        ch = j.stats['checks']
        self.assertEqual((ch['tested'], ch['ok'], ch['dead'], ch['wrong'], ch['untested']), (15, 12, 1, 2, 0))
        self.assertLess(took, 6, 'fifteen link tests must take seconds, took %.1f' % took)
        self.assertTrue(all(r['chat_kind'] == 'channel' and r['match'] >= 90 for r in j.result))

    def test_dead_link_is_replaced_by_its_mirror(self):
        a = self.c.add(FEnt(-100710, 'chan_a', title='A', broadcast=True))
        b = self.c.add(FEnt(-100711, 'chan_b', title='B', broadcast=True))
        m1 = self.c.post(a, '', file=FFile('Big.Buck.Movie.2020.1080p.mkv'), blob=None)        # deleted / dead
        m2 = self.c.post(b, '', file=FFile('Big.Buck.Movie.2020.1080p.mkv'), blob=self.mkv)
        m2.media.document.id = m1.media.document.id                                          # the same document
        self.c.search_hits['Big Buck Movie'] = [m1, m2]
        f = finder_for(self.tg, 'f3', bot_request=False)
        j = wait_job(f, f.start({'type': 'movie', 'title': 'Big Buck Movie', 'year': 2020}))
        self.assertEqual(len(j.result), 1)
        self.assertEqual((j.result[0]['probe'], j.result[0]['chat_id']), ('ok', -100711))
        self.assertEqual(j.stats['checks']['mirror'], 1)

    def test_free_search_asks_bots_and_lists_clean_rows(self):
        chan = self.c.add(FEnt(-100720, 'chan', title='Stuff', broadcast=True))
        hits = self._hits(chan, ['Big.Buck.Movie.2020.720p.mkv'], self.mkv)
        hits += [self.c.post(chan, 'Big Buck Movie poster', file=FFile('poster.jpg', 90000, 'image/jpeg'))]
        hits += [self.c.post(chan, '', file=FFile('Big.Buck.Movie.2020.rar', 5 * 10 ** 8, 'application/x-rar'))]
        self.c.search_hits['big buck movie'] = hits
        self.c.add(FEnt(602, 'reqbot2', bot=True), FilterBot([['Big.Buck.Movie.2020.2160p.mkv']], self.mkv))
        self.c.post(self.c.ents[602], 'old')
        f = finder_for(self.tg, 'f4', bots=['@reqbot2'])
        j = wait_job(f, f.start({'type': 'free', 'query': 'big buck movie'}))
        self.assertIsNone(j.error)
        self.assertEqual(sorted(r['file'] for r in j.result),
                         ['Big.Buck.Movie.2020.2160p.mkv', 'Big.Buck.Movie.2020.720p.mkv'])
        self.assertEqual(j.result[0]['quality'], 2160)             # best quality first at equal fit
        self.assertTrue(all(r['probe'] == 'ok' for r in j.result))

    def test_which_bots_are_asked(self):
        def dlg(ent):
            return types.SimpleNamespace(entity=ent, id=ent.id, name=getattr(ent, 'first_name', None) or ent.title,
                                         is_user=not hasattr(ent, 'title'), is_group=False,
                                         is_channel=hasattr(ent, 'title'), unread_count=0)
        films = self.c.add(FEnt(701, 'filmsbot', bot=True))
        bank = self.c.add(FEnt(702, 'mybankbot', bot=True))
        father = self.c.add(FEnt(703, 'BotFather', bot=True))
        person = self.c.add(FEnt(704, 'dana', first_name='Dana'))
        chan = self.c.add(FEnt(-100730, 'chan', title='Movies', broadcast=True))
        self.c.post(films, '', file=FFile('Old.Film.2001.mkv'))
        self.c.post(father, '', file=FFile('weird.mkv'))
        self.c.post(bank, 'your balance')
        self.c.dialog_list = [dlg(x) for x in (films, bank, father, person, chan)]
        rows = run(self.tg, self.tg.dialogs(50))
        self.assertEqual(sorted((r['kind'], r['title']) for r in rows),
                         [('bot', 'BotFather'), ('bot', 'filmsbot'), ('bot', 'mybankbot'), ('channel', 'Movies')])
        f = finder_for(self.tg, 'f5', bot_auto=True)
        self.assertEqual([b['id'] for b in f.auto_bots(refresh=True)], [701])     # holds a video, is not a system bot
        self.assertEqual([b['ref'] for b in f.content_bots()], ['filmsbot'])
        f.bot_mark('mybankbot', True, 'Bank', 'mybankbot', 702)                   # the user's explicit choice counts
        self.assertEqual(sorted(b['ref'] for b in f.content_bots()), ['filmsbot', 'mybankbot'])
        f.bot_mark('filmsbot', False, 'Films', 'filmsbot', 701)
        self.assertEqual([b['ref'] for b in f.content_bots()], ['mybankbot'])
        states = dict((r['username'], r['state']) for r in f.bot_list())
        self.assertEqual(states, {'filmsbot': 'off', 'mybankbot': 'on'})
        f.bot_mark('filmsbot', None, '', 'filmsbot', 701)
        f._bot_note([('filmsbot', {'files': []})] * 4)                            # four empty answers: rests a day
        self.assertEqual([b['ref'] for b in f.content_bots()], ['mybankbot'])
        f.s['bot_request'] = False
        self.assertEqual(f.content_bots(), [])

    def test_discover_ranks_and_filters(self):
        ch1 = FEnt(801, 'films_il', title='Films IL', broadcast=True, members=52000)
        ch2 = FEnt(802, 'small', title='Small films', broadcast=True, members=300)
        scam = FEnt(803, 'scammy', title='Free films', broadcast=True, members=900000, scam=True)
        mine = FEnt(804, 'mine', title='My films', broadcast=True, members=10, left=False)
        bot = FEnt(805, 'films_bot', bot=True, first_name='Films Bot')
        person = FEnt(806, 'someone', first_name='Some One')

        def result(q):
            if q == 'films':
                return types.SimpleNamespace(chats=[ch2, ch1, scam, mine], users=[person], my_results=[])
            return types.SimpleNamespace(chats=[ch1], users=[bot, person], my_results=[])
        self.c.search_result = result
        rows = run(self.tg, self.tg.discover(['films', 'films bot']))
        self.assertEqual([r['username'] for r in rows], ['films_il', 'small', 'films_bot', 'mine'])
        self.assertEqual([r['kind'] for r in rows], ['channel', 'channel', 'bot', 'channel'])
        self.assertTrue(rows[-1]['joined'])
        self.assertEqual(rows[0]['hits'], 2)

    def test_pinned_names_and_bot_chats_are_searched(self):
        pub = self.c.add(FEnt(-100740, 'public_films', title='Public', broadcast=True))
        self._hits(pub, ['Big.Buck.Movie.2020.1080p.PUBLIC.mkv'], self.mkv)
        f = finder_for(self.tg, 'f6', bot_request=False, pinned_chats=['@public_films', '-100999', 'https://t.me/x_y_z'])
        self.assertEqual(f._pinned(), ['public_films', -100999, 'x_y_z'])
        j = wait_job(f, f.start({'type': 'movie', 'title': 'Big Buck Movie', 'year': 2020}))
        self.assertEqual([r['file'] for r in j.result], ['Big.Buck.Movie.2020.1080p.PUBLIC.mkv'])


class RowTests(unittest.TestCase):
    def test_labels(self):
        from resources.lib import router
        s = {'quality': 1080, 'codec': 'HEVC', 'hdr': True, 'langs': ['he_sub'], 'he_sub_inside': True,
             'size': 2 * 1024 ** 3, 'duration': 6000, 'probe': 'ok', 'speed': 3 * 1048576, 'smooth': True,
             'match': 96, 'chat_kind': 'bot', 'chat_title': 'Films Bot', 'file': 'A.mkv', 'via_bot': 'films_bot'}
        line = router._source_label(s)
        for part in ('1080p', 'HEVC HDR', u'✓', '2.0 GB', '1:40:00', '3.0 MB/s', '96%'):
            self.assertIn(part, line)
        self.assertEqual(router._source_line2(s), u'S30117: Films Bot · A.mkv')
        self.assertIn('4K', router._q_tag(2160))
        self.assertEqual(router._checks_text({'checks': {'tested': 15, 'ok': 12, 'dead': 1, 'wrong': 2}}),
                         '15 tested, 12 working, 3 removed')
        raw = router._enrich({'file': 'Show.Name.S02E05.720p.HEVC.mkv', 'size': 5 * 10 ** 8, 'chat_title': 'X'})
        label = router._file_label(raw)
        self.assertIn('Show Name S02E05', label)
        self.assertIn('720p', label)
        self.assertNotIn('S30092', label)                    # a browsed row makes no claim about a test
        loose = dict(s, loose=True, probe='untested')
        self.assertIn('S30133 ?', router._source_label(loose))
        self.assertIn('S30092', router._source_label(loose))

    def test_every_string_exists_in_three_languages(self):
        import re
        used = set()
        for path in glob.glob(os.path.join(ADDON_ROOT, 'resources', 'lib', '*.py')):
            text = open(path, encoding='utf-8').read()
            used.update(int(x) for x in re.findall(r'\bLf?\((3\d{4})', text))
            used.update(int(x) for x in re.findall(r'\b(30\d{3})\b(?=[,)\]} ])', text) if 30000 <= int(x) <= 30999)
        xml = open(os.path.join(ADDON_ROOT, 'resources', 'settings.xml'), encoding='utf-8').read()
        used.update(int(x) for x in re.findall(r'label="(\d{5})"', xml))
        for x in re.findall(r'lvalues="([\d|]+)"', xml):
            used.update(int(y) for y in x.split('|'))
        sets = []
        for lang in ('en_gb', 'he_il', 'ru_ru'):
            po = open(os.path.join(ADDON_ROOT, 'resources', 'language', 'resource.language.' + lang, 'strings.po'),
                      encoding='utf-8').read()
            ids = set(int(x) for x in re.findall(r'msgctxt "#(\d+)"', po))
            sets.append(ids)
            self.assertFalse(sorted(used - ids), 'missing in %s' % lang)
            if lang != 'en_gb':
                empty = re.findall(r'msgctxt "#(3\d{4})"\nmsgid "[^"]+"\nmsgstr ""', po)
                self.assertEqual(empty, [], 'untranslated in %s' % lang)
        self.assertEqual(sets[0], sets[1])
        self.assertEqual(sets[0], sets[2])


if __name__ == '__main__':
    unittest.main(verbosity=2)
