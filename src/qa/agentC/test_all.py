# -*- coding: utf-8 -*-
"""Throw-away tests for the 3.3 fixes (stubbed Kodi modules)."""
import io
import json
import os
import sys
import tempfile
import threading
import time
import types
import unittest
import urllib.error
import urllib.request
from concurrent.futures import Future

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp(prefix='agentC_', dir=HERE)
ADDON_ROOT = r'C:\My Projects\novaTV Addon\src\plugin.video.telescope'

# ---------------------------------------------------------------- Kodi stubs
SETTINGS = {'debug': 'false'}
SETTING_READS = [0]
LOGGED = []


class _Addon(object):
    def __init__(self, *a, **k):
        pass

    def getAddonInfo(self, key):
        return {'name': 'TeleScope', 'version': '0', 'path': TMP, 'profile': TMP}.get(key, '')

    def getSetting(self, key):
        SETTING_READS[0] += 1
        return SETTINGS.get(key, '')

    def setSetting(self, key, value):
        SETTINGS[key] = value

    def getLocalizedString(self, i):
        return str(i)


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
xbmcvfs = types.ModuleType('xbmcvfs')
xbmcvfs.translatePath = lambda p: p
xbmcplugin = types.ModuleType('xbmcplugin')
for _m in (xbmc, xbmcaddon, xbmcgui, xbmcvfs, xbmcplugin):
    sys.modules[_m.__name__] = _m

sys.path.insert(0, ADDON_ROOT)
from resources.lib import common, parser, matcher, cache, rpc, stream  # noqa: E402


def P(name, caption=''):
    return parser.parse(name, caption)


class ParserTests(unittest.TestCase):
    def test_c9_russian(self):
        p = P(u'Сериал 2021 Серия 3.mkv')
        self.assertEqual(p['episode'], 3)
        self.assertIsNone(p['season'])
        p = P(u'Сезон 2 Серия 5.mkv')
        self.assertEqual((p['season'], p['episode']), (2, 5))
        p = P(u'2 сезон 5 серия.mkv')
        self.assertEqual((p['season'], p['episode']), (2, 5))
        p = P(u'Имя.mkv', u'Сериал 2021\nсезон 2021')
        self.assertIsNone(p['episode'])
        self.assertIsNone(p['season'])
        self.assertIsNone(p['season_hint'])
        self.assertEqual(parser.find_se(u'1 сезон, 2-3 серии'), (1, 2, 3))
        self.assertEqual(parser.find_episode_only(u'12 серия'), 12)
        self.assertEqual(parser.find_season_only(u'3 сезон'), 3)
        self.assertEqual(parser.find_season_only(u'сезон 4'), 4)

    def test_c9_unchanged(self):
        self.assertEqual(parser.find_se('Show.S01E02.720p'), (1, 2, None))
        self.assertEqual(parser.find_se('Show 1x02'), (1, 2, None))
        self.assertEqual(parser.find_se(u'עונה 1 פרק 2'), (1, 2, None))

    def test_c8_trailer(self):
        cap = u'Отличный фильм\nТрейлер: https://youtu.be/x  promo'
        p = P('Movie.2019.1080p.mkv', cap)
        self.assertFalse(p['is_trailer'])
        self.assertTrue(p['trailer_caption'])
        t = {'kind': 'movie', 'aliases': ['Movie'], 'year': 2019, 'runtime': 0}
        big = {'parsed': p, 'ext': 'mkv', 'mime': 'video/x-matroska', 'size': 2 * 1024 ** 3, 'duration': 0,
               'caption': cap, 'chat_title': ''}
        self.assertEqual(matcher.evaluate(big, t)[0], 'accept')
        small = dict(big, size=80 * 1024 ** 2)
        self.assertEqual(matcher.evaluate(small, t), ('reject', 0, ['trailer/sample']))
        short = dict(big, duration=150)
        self.assertEqual(matcher.evaluate(short, t), ('reject', 0, ['trailer/sample']))
        p2 = P('Movie.2019.Trailer.mp4')
        self.assertTrue(p2['is_trailer'])
        self.assertEqual(matcher.evaluate(dict(big, parsed=p2, ext='mp4'), t)[0], 'reject')

    def test_c10_complete_and_dub(self):
        p = P('Movie.2019.COMPLETE.BluRay.1080p.mkv')
        t = {'kind': 'movie', 'aliases': ['Movie'], 'year': 2019, 'runtime': 0}
        c = {'parsed': p, 'ext': 'mkv', 'mime': '', 'size': 2 * 1024 ** 3, 'duration': 0, 'caption': '',
             'chat_title': ''}
        self.assertEqual(matcher.evaluate(c, t)[0], 'accept')
        p = P('Show.Season.2.COMPLETE.1080p.mkv')
        c = dict(c, parsed=p)
        self.assertEqual(matcher.evaluate(c, dict(t, aliases=['Show'], year=None)), ('reject', 0, ['season pack']))
        self.assertNotIn('ru_audio', P('Movie.2019.Heb.Dub.mkv')['langs'])
        self.assertIn('he_dub', P('Movie.2019.Heb.Dub.mkv')['langs'])
        self.assertIn('ru_audio', P('Movie.2019.Rus.Dub.mkv')['langs'])
        self.assertIn('ru_audio', P('Movie.2019.Dub.mkv', u'Фильм 2019')['langs'])
        self.assertNotIn('ru_audio', P('Movie.2019.Dub.mkv')['langs'])


class CommonTests(unittest.TestCase):
    def test_c7_scrub(self):
        s = common.scrub("HTTPError: 401 for url: https://api.themoviedb.org/3/x?api_key=ABC123&language=he "
                         "https://g/v1?key=SECRET9&pageSize=2 token=tt' secret=zz")
        for bad in ('ABC123', 'SECRET9', 'tt', 'zz'):
            self.assertNotIn(bad, s.replace('https', ''))
        self.assertIn('language=he', s)
        self.assertIn('pageSize=2', s)
        del LOGGED[:]
        common.log_error('boom ?api_key=ABC123')
        self.assertNotIn('ABC123', LOGGED[-1][1])

    def test_c18_debug_flag_cached(self):
        common.log('warm')
        before = SETTING_READS[0]
        for _ in range(50):
            common.log('x')
        self.assertEqual(SETTING_READS[0], before)


class CacheTests(unittest.TestCase):
    def test_c17_purge_expired(self):
        c = cache.Cache(os.path.join(TMP, 'c.db'))
        c.set('forever', 1)
        c.set('fresh', 2, 3600)
        c.set('old1', 3, 0.01)
        c.set('old2', 4, 0.01)
        time.sleep(0.05)
        self.assertEqual(c.purge_expired(), 2)
        import sqlite3
        conn = sqlite3.connect(c.path)
        keys = sorted(r[0] for r in conn.execute('SELECT k FROM kv'))
        conn.close()
        self.assertEqual(keys, ['forever', 'fresh'])
        self.assertEqual(c.get('fresh'), 2)


class TokenTests(unittest.TestCase):
    def test_c6_token(self):
        tok = stream.stream_token('s3cret', -1001234, 77)
        self.assertEqual(len(tok), 16)
        self.assertEqual(tok, rpc.stream_token('s3cret', -1001234, 77))
        self.assertNotEqual(tok, stream.stream_token('s3cret', -1001234, 78))
        self.assertNotEqual(tok, stream.stream_token('other', -1001234, 77))
        common.write_json(common.PORT_FILE, {'port': 4321, 'secret': 's3cret'})
        url = rpc.stream_url(-1001234, 77, 'a b.mkv')
        self.assertEqual(url, 'http://127.0.0.1:4321/stream/-1001234/77/%s/a%%20b.mkv' % tok)


# ---------------------------------------------------------------- HTTP server
SIZE = 5 * 1024 * 1024 + 12345
BLOB = bytes(bytearray((i * 7 + (i >> 11)) % 251 for i in range(SIZE)))
CHAT, MSG = -100777, 42


class Fake(object):
    def __init__(self):
        self.calls = []
        self.hold = {}            # idx -> Future kept pending (manual completion)
        self.lock = threading.Lock()

    def fetch(self, chat, msg, idx):
        with self.lock:
            self.calls.append(idx)
        fut = Future()
        if idx in self.hold:
            self.hold[idx].append(fut)
            return fut
        fut.set_result(BLOB[idx * stream.CHUNK:(idx + 1) * stream.CHUNK])
        return fut

    def info(self, chat, msg):
        if (chat, msg) != (CHAT, MSG):
            raise IOError('message not found')
        return {'size': SIZE, 'file': 'movie.mkv', 'mime': 'video/x-matroska'}


def http(url, method='GET', headers=None, data=None):
    req = urllib.request.Request(url, method=method, headers=headers or {}, data=data)
    try:
        r = urllib.request.urlopen(req, timeout=20)
        return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


class StreamTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = Fake()
        cls.rpc_calls = []

        def rpc_fn(method, params):
            cls.rpc_calls.append(method)
            return {'pong': method}
        cls.app = stream.App(cls.fake.fetch, cls.fake.info, rpc_fn, lambda m: None, 'topsecret', cache_mb=16,
                             parallel=4, readahead=2, chunk_timeout=5)
        cls.port = cls.app.serve(0)
        cls.base = 'http://127.0.0.1:%d' % cls.port
        cls.tok = stream.stream_token('topsecret', CHAT, MSG)
        cls.url = '%s/stream/%d/%d/%s/movie.mkv' % (cls.base, CHAT, MSG, cls.tok)

    @classmethod
    def tearDownClass(cls):
        cls.app.shutdown()

    def test_range(self):
        a, b = 1048000, 2200000         # crosses two chunk borders
        code, h, body = http(self.url, headers={'Range': 'bytes=%d-%d' % (a, b)})
        self.assertEqual(code, 206)
        self.assertEqual(h['Content-Range'], 'bytes %d-%d/%d' % (a, b, SIZE))
        self.assertEqual(h['Content-Length'], str(b - a + 1))
        self.assertEqual(h['Content-Type'], 'video/x-matroska')
        self.assertEqual(body, BLOB[a:b + 1])

    def test_open_ended_range(self):
        a = SIZE - 1500000
        code, h, body = http(self.url, headers={'Range': 'bytes=%d-' % a})
        self.assertEqual(code, 206)
        self.assertEqual(h['Content-Range'], 'bytes %d-%d/%d' % (a, SIZE - 1, SIZE))
        self.assertEqual(body, BLOB[a:])

    def test_suffix_range(self):
        code, h, body = http(self.url, headers={'Range': 'bytes=-5000'})
        self.assertEqual(code, 206)
        self.assertEqual(h['Content-Range'], 'bytes %d-%d/%d' % (SIZE - 5000, SIZE - 1, SIZE))
        self.assertEqual(body, BLOB[-5000:])

    def test_full(self):
        code, h, body = http(self.url)
        self.assertEqual(code, 200)
        self.assertEqual(len(body), SIZE)
        self.assertEqual(body, BLOB)

    def test_unsatisfiable(self):
        code, h, _ = http(self.url, headers={'Range': 'bytes=%d-' % (SIZE + 5)})
        self.assertEqual(code, 416)

    def test_head(self):
        code, h, body = http(self.url, method='HEAD')
        self.assertEqual(code, 200)
        self.assertEqual(h['Content-Length'], str(SIZE))
        self.assertEqual(h['Accept-Ranges'], 'bytes')
        self.assertEqual(body, b'')
        code, h, body = http(self.url.replace(self.tok, '0' * 16), method='HEAD')
        self.assertEqual(code, 403)

    def test_token_required(self):
        old = '%s/stream/%d/%d/movie.mkv' % (self.base, CHAT, MSG)
        self.assertEqual(http(old)[0], 403)
        self.assertEqual(http('%s/stream/%d/%d' % (self.base, CHAT, MSG))[0], 403)
        bad = self.tok[:-1] + ('0' if self.tok[-1] != '0' else '1')
        self.assertEqual(http(self.url.replace(self.tok, bad))[0], 403)
        other = '%s/stream/%d/%d/%s/movie.mkv' % (self.base, CHAT, MSG + 1, self.tok)   # token of another message
        self.assertEqual(http(other)[0], 403)
        self.assertEqual(http(self.base + '/nothing')[0], 404)

    def test_host_header(self):
        self.assertEqual(http(self.url, headers={'Host': 'evil.example:%d' % self.port, 'Range': 'bytes=0-9'})[0], 403)
        self.assertEqual(http(self.url, headers={'Host': '127.0.0.1', 'Range': 'bytes=0-9'})[0], 403)
        code, _, body = http(self.url, headers={'Host': 'localhost:%d' % self.port, 'Range': 'bytes=0-9'})
        self.assertEqual((code, body), (206, BLOB[:10]))
        body = json.dumps({'method': 'x', 'params': {}, 'secret': 'topsecret'}).encode()
        self.assertEqual(http(self.base + '/rpc', 'POST', {'Host': 'evil.example'}, body)[0], 403)

    def test_rpc(self):
        body = json.dumps({'method': 'hello', 'params': {}, 'secret': 'topsecret'}).encode()
        code, _, out = http(self.base + '/rpc', 'POST', {'Content-Type': 'application/json'}, body)
        self.assertEqual((code, json.loads(out.decode())), (200, {'result': {'pong': 'hello'}}))
        bad = json.dumps({'method': 'hello', 'secret': 'nope'}).encode()
        self.assertEqual(http(self.base + '/rpc', 'POST', {}, bad)[0], 403)

    def test_rpc_body_limit(self):
        import socket
        for length, want in (('99999999', b'413'), ('abc', b'400'), ('-5', b'400')):
            s = socket.create_connection(('127.0.0.1', self.port), timeout=10)
            s.sendall(('POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nContent-Length: %s\r\n\r\n'
                       % (self.port, length)).encode())
            line = s.recv(200).split(b'\r\n')[0]
            s.close()
            self.assertIn(want, line)


class StoreTests(unittest.TestCase):
    def make(self, hold=()):
        fake = Fake()
        for i in hold:
            fake.hold[i] = []
        return fake, stream.ChunkStore(fake.fetch, max_bytes=64 * stream.CHUNK, parallel=8)

    def test_c4a_timeout_keeps_one_download(self):
        fake, st = self.make(hold=[3])
        with self.assertRaises(IOError):
            st.get(CHAT, MSG, 3, timeout=0.1, retries=2)
        self.assertEqual(fake.calls.count(3), 1)            # three attempts, ONE download
        self.assertEqual(st.inflight, {})                   # the hung one was dropped at the end
        self.assertTrue(fake.hold[3][0].cancelled())
        self.assertEqual(st.waiters, {})

    def test_c4a_late_answer_reaches_next_waiter(self):
        fake, st = self.make(hold=[3])
        res = []
        t = threading.Thread(target=lambda: res.append(st.get(CHAT, MSG, 3, timeout=0.3, retries=3)))
        t.start()
        time.sleep(0.5)                                     # first attempt timed out, second is waiting
        fake.hold[3][0].set_result(b'x' * 10)
        t.join(5)
        self.assertEqual(res, [b'x' * 10])
        self.assertEqual(fake.calls.count(3), 1)

    def test_c4a_done_pops_only_own_entry(self):
        fake, st = self.make(hold=[1])
        key = (CHAT, MSG, 1)
        f1 = st._start(key)
        with st.lock:
            st.inflight.pop(key)
        f2 = st._start(key)                                 # a newer fetch of the same chunk
        self.assertIsNot(f1, f2)
        fake.hold[1][0].set_exception(IOError('old one failed'))
        self.assertIs(st.inflight.get(key), f2)             # the old callback left the new entry alone
        fake.hold[1][1].set_result(b'ok')
        self.assertNotIn(key, st.inflight)

    def test_c4b_seek_cancels_old_readahead(self):
        fake, st = self.make(hold=list(range(0, 60)))
        last = 59
        old, new = object(), object()
        st.set_pos(old, CHAT, MSG, 10)
        st.prefetch(CHAT, MSG, 58, 2, last)                 # tail
        st.prefetch(CHAT, MSG, 10, 5, last)                 # read-ahead of the old position: 10..14
        st.prefetch(CHAT + 1, MSG, 10, 2, last)             # another file
        waiter = threading.Thread(target=lambda: self._quiet(st, 10))
        waiter.start()                                      # a request is blocked on chunk 10
        time.sleep(0.2)
        # 3.3.1: a second connection of the same file opens at chunk 40 while the first still reads at 10 -
        # nothing of the first one's read-ahead may be cancelled (this thrash made the stream stall)
        st.set_pos(new, CHAT, MSG, 40)
        self.assertEqual(st.cancel_stale(CHAT, MSG, 3, last), 0)
        for i in (10, 11, 12, 13, 14):
            self.assertIn((CHAT, MSG, i), st.inflight)
        # the first connection closes (a real seek): now its read-ahead is dropped, except what is waited for
        st.drop_pos(old)
        n = st.cancel_stale(CHAT, MSG, 3, last)
        self.assertEqual(n, 4)                              # 11, 12, 13, 14
        for i in (11, 12, 13, 14):
            self.assertTrue(fake.hold[i][0].cancelled(), i)
            self.assertNotIn((CHAT, MSG, i), st.inflight)
        for key in ((CHAT, MSG, 10), (CHAT, MSG, 58), (CHAT, MSG, 59), (CHAT + 1, MSG, 10), (CHAT + 1, MSG, 11)):
            self.assertIn(key, st.inflight)
        self.assertFalse(fake.hold[10][0].cancelled())
        fake.hold[10][0].set_result(b'z')
        waiter.join(5)
        self.assertEqual(self.got, b'z')
        self.assertEqual(st.cancel_stale(CHAT, MSG, 3, last), 0)
        st.prefetch(CHAT, MSG, 11, 1, last)                 # a cancelled chunk can be fetched again
        # 3 = the first read-ahead, chunk 11 of the OTHER file (the fake records the index only), the new fetch
        self.assertEqual(fake.calls.count(11), 3)

    def test_pacing_flood_gate(self):
        """3.3.1: a flood wait closes one gate for every request and halves the parallel requests"""
        import asyncio
        from resources.lib import tgclient
        tg = tgclient.TG.__new__(tgclient.TG)
        tg.parallel = 4
        tg.log = lambda m: None
        said = []
        tg.info = said.append
        tg._pace_init()
        self.assertEqual(tg._cap, 8)
        tg._flood(7)
        self.assertEqual(tg._cap, 4)
        self.assertGreater(tg._gate, time.time() + 6)
        self.assertTrue(said and 'flood' in said[0])
        tg._flood(2); tg._flood(2); tg._flood(2)
        self.assertEqual(tg._cap, 2)                        # never below 2

        async def run():
            tg._gate = time.time() + 0.4
            order = []

            async def fake_now(msg, offset, size, took=None):
                order.append(time.time())
                await asyncio.sleep(0.05)
                return b'x'
            tg._read_part_now = fake_now
            t0 = time.time()
            await asyncio.gather(*[tg._read_part(None, i, 1) for i in range(6)])
            return t0, order
        t0, order = asyncio.new_event_loop().run_until_complete(run())
        self.assertGreaterEqual(min(order) - t0, 0.35)      # nobody asked before the gate opened
        self.assertEqual(tg._running, 0)

    def _quiet(self, st, idx):
        self.got = st.get(CHAT, MSG, idx, timeout=5, retries=0)

    def test_c15_short_chunk_not_cached(self):
        calls = []

        def fetch(chat, msg, idx):
            calls.append(idx)
            f = Future()
            f.set_result(b'a' * 100 if idx == 1 else b'b' * stream.CHUNK)
            return f
        st = stream.ChunkStore(fetch)
        st.note_size(CHAT, MSG, 3 * stream.CHUNK + 100)
        with self.assertRaises(IOError):
            st.get(CHAT, MSG, 1, timeout=1, retries=1)
        self.assertNotIn((CHAT, MSG, 1), st.cache)
        self.assertEqual(calls.count(1), 2)
        st.note_size(CHAT, MSG, stream.CHUNK + 100)         # now chunk 1 is the last one: short is right
        self.assertEqual(len(st.get(CHAT, MSG, 1, timeout=1)), 100)
        self.assertIn((CHAT, MSG, 1), st.cache)

    def test_c15_empty_chunk_closes_connection(self):
        def fetch(chat, msg, idx):
            f = Future()
            f.set_result(BLOB[:stream.CHUNK] if idx == 0 else b'')
            return f
        app = stream.App(fetch, lambda c, m: {'size': stream.CHUNK + 500, 'file': 'x.mp4'}, None, lambda m: None, 's',
                         readahead=1, chunk_timeout=2)
        port = app.serve(0)
        try:
            import socket
            s = socket.create_connection(('127.0.0.1', port), timeout=10)
            s.sendall(('GET /stream/1/2/%s/x.mp4 HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n\r\n'
                       % (stream.stream_token('s', 1, 2), port)).encode())
            got = b''
            while True:                                     # must reach EOF (server closed), not hang on keep-alive
                part = s.recv(65536)
                if not part:
                    break
                got += part
            s.close()
            head, _, body = got.partition(b'\r\n\r\n')
            self.assertIn(b'Content-Length: %d' % (stream.CHUNK + 500), head)
            self.assertEqual(len(body), stream.CHUNK)
        finally:
            app.shutdown()

    def test_c18_info_cache_cap(self):
        app = stream.App(None, lambda c, m: {'size': 1}, None, lambda m: None, 's')
        for i in range(450):
            app.file_info(1, i)
        self.assertEqual(len(app._info_cache), 200)
        self.assertIn((1, 449), app._info_cache)
        self.assertNotIn((1, 0), app._info_cache)


if __name__ == '__main__':
    unittest.main(verbosity=2)
