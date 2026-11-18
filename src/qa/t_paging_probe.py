# -*- coding: utf-8 -*-
"""4.3: RESEARCH-sources items 5 and 9.
 - the search over all chats, page by page (tgclient.search / search_more, sources.Finder._older)
 - Dolby Vision / HDR flags from names and headers, the device verdict, the tail probe and the mid-file read
Telegram and HTTP are simulated (a fake Telethon package, a fake client). Run: python t_paging_probe.py"""
import asyncio
import collections
import os
import struct
import sys
import tempfile
import types
import unittest
from concurrent.futures import Future, ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp(prefix='tn_paging_')
ADDON_ROOT = os.path.normpath(os.path.join(HERE, '..', 'plugin.video.telescope'))


# ---------------------------------------------------------------- Kodi stubs
class _Addon(object):
    def __init__(self, *a, **k):
        pass

    def getAddonInfo(self, key):
        return {'name': 'TeleScope', 'version': '0', 'path': TMP, 'profile': TMP}.get(key, '')

    def getSetting(self, key):
        return ''

    def setSetting(self, key, value):
        pass

    def getLocalizedString(self, i):
        return str(i)


xbmc = types.ModuleType('xbmc')
xbmc.LOGDEBUG, xbmc.LOGINFO, xbmc.LOGERROR, xbmc.ISO_639_1 = 0, 1, 3, 0
xbmc.log = lambda msg, level=0: None
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


# ---------------------------------------------------------------- a fake Telethon (only what the paging code uses)
class FloodWaitError(Exception):
    def __init__(self, seconds):
        Exception.__init__(self, 'wait %s' % seconds)
        self.seconds = seconds


class _Req(object):
    def __init__(self, **kw):
        self.__dict__.update(kw)


class _Empty(object):
    pass


class MessageEmpty(object):
    pass


_t = types.ModuleType('telethon')
_t.utils = types.ModuleType('telethon.utils')
_t.utils.get_peer_id = lambda x: x.id
_t.errors = types.ModuleType('telethon.errors')
_t.errors.FloodWaitError = FloodWaitError
_t.tl = types.ModuleType('telethon.tl')
_t.tl.functions = types.ModuleType('telethon.tl.functions')
_t.tl.functions.messages = types.ModuleType('telethon.tl.functions.messages')
_t.tl.functions.messages.SearchGlobalRequest = _Req
_t.tl.types = types.ModuleType('telethon.tl.types')
_t.tl.types.InputMessagesFilterEmpty = _Empty
_t.tl.types.InputPeerEmpty = _Empty
_t.tl.types.MessageEmpty = MessageEmpty
for _n, _m in (('telethon', _t), ('telethon.utils', _t.utils), ('telethon.errors', _t.errors), ('telethon.tl', _t.tl),
               ('telethon.tl.functions', _t.tl.functions), ('telethon.tl.functions.messages', _t.tl.functions.messages),
               ('telethon.tl.types', _t.tl.types)):
    sys.modules[_n] = _m

sys.path.insert(0, ADDON_ROOT)
from resources.lib import parser, mediaflags, sources, tgclient  # noqa: E402

MB = 1048576


class Obj(object):
    def __init__(self, **kw):
        self.__dict__.update(kw)


def msg(chat, mid, name='Movie.2020.1080p.mkv', doc=None, with_file=True):
    f = Obj(mime_type='video/x-matroska', name=name, size=900 * MB, ext='.mkv', duration=6000, width=1920,
            height=1080) if with_file else None
    return Obj(id=mid, chat_id=chat, file=f, chat=None, media=Obj(document=Obj(id=doc or (chat * 1000 + mid))),
               message='', date=None, video=None, input_chat=('peer', chat))


class Client(object):
    """Answers messages.searchGlobal from a script: {offset_rate: (messages, next_rate) or an exception}"""

    def __init__(self, script):
        self.script, self.calls = script, []

    async def __call__(self, req):
        self.calls.append(req)
        ans = self.script[req.offset_rate]
        if isinstance(ans, Exception):
            raise ans
        return Obj(messages=ans[0], users=[], chats=[], next_rate=ans[1])


def make_tg(script):
    tg = tgclient.TG.__new__(tgclient.TG)
    tg.log = lambda m: None
    tg._docs = collections.OrderedDict()
    tg.client = Client(script)
    return tg


def arun(tg, make):
    async def go():
        tg._search_sem = asyncio.Semaphore(5)
        return await make()
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(go())
    finally:
        loop.close()


class PagingClient(unittest.TestCase):
    def test_pages_follow_next_rate_and_skip_seen(self):
        tg = make_tg({0: ([msg(1, 1), msg(1, 2), msg(2, 3, with_file=False)], 7),
                      7: ([msg(2, 3, with_file=False), msg(3, 4), MessageEmpty(), msg(3, 5)], 9),
                      9: ([], None)})
        tg.SEARCH_GAP = 0.0
        first = arun(tg, lambda: tg.search('q', 100))
        self.assertEqual([(c['chat_id'], c['msg_id']) for c in first], [(1, 1), (1, 2)])
        self.assertTrue(tg.search_has_more('q'))
        self.assertFalse(tg.search_has_more('other'))
        res = arun(tg, lambda: tg.search_more('q', pages=3, budget=5))
        self.assertEqual([(c['chat_id'], c['msg_id']) for c in res['items']], [(3, 4), (3, 5)])
        self.assertEqual((res['pages'], res['stopped'], res['more']), (2, 'end', False))
        self.assertEqual(res['messages'], 2)                       # message (2, 3) came twice: counted once
        self.assertEqual([r.offset_rate for r in tg.client.calls], [0, 7, 9])
        self.assertEqual((tg.client.calls[1].offset_id, tg.client.calls[1].offset_peer), (3, ('peer', 2)))
        self.assertEqual(tg.client.calls[2].offset_id, 5)
        self.assertFalse(tg.search_has_more('q'))
        n = len(tg.client.calls)
        res = arun(tg, lambda: tg.search_more('q', pages=3, budget=5))
        self.assertEqual((res['pages'], res['stopped'], len(tg.client.calls)), (0, 'end', n))

    def test_page_limit(self):
        tg = make_tg({0: ([msg(1, 1)], 5), 5: ([msg(1, 2)], 6), 6: ([msg(1, 3)], 7), 7: ([msg(1, 4)], 8)})
        tg.SEARCH_GAP = 0.0
        arun(tg, lambda: tg.search('q', 100))
        res = arun(tg, lambda: tg.search_more('q', pages=2, budget=5))
        self.assertEqual((res['pages'], res['stopped'], res['more'], len(res['items'])), (2, 'pages', True, 2))
        self.assertEqual(len(tg.client.calls), 3)

    def test_repeated_page_ends_the_paging(self):
        tg = make_tg({0: ([msg(1, 1)], 5), 5: ([msg(1, 1)], 5)})
        arun(tg, lambda: tg.search('q', 100))
        res = arun(tg, lambda: tg.search_more('q', pages=4, budget=5))
        self.assertEqual((res['pages'], res['stopped'], res['items']), (1, 'end', []))

    def test_flood_wait_closes_the_gate(self):
        tg = make_tg({0: ([msg(1, 1)], 5), 5: FloodWaitError(30)})
        arun(tg, lambda: tg.search('q', 100))
        res = arun(tg, lambda: tg.search_more('q', pages=3, budget=5))
        self.assertEqual((res['pages'], res['stopped'], res['items']), (0, 'flood', []))
        self.assertFalse(tg.search_has_more('q'))                  # not asked again while Telegram says wait
        n = len(tg.client.calls)
        res = arun(tg, lambda: tg.search_more('q', pages=3, budget=5))
        self.assertEqual((res['stopped'], len(tg.client.calls)), ('flood', n))

    def test_time_budget(self):
        tg = make_tg({0: ([msg(1, 1)], 5), 5: ([msg(1, 2)], 6)})
        arun(tg, lambda: tg.search('q', 100))
        res = arun(tg, lambda: tg.search_more('q', pages=3, budget=0.1))
        self.assertEqual((res['pages'], res['stopped']), (0, 'time'))
        self.assertEqual(len(tg.client.calls), 1)

    def test_remembered_queries_are_bounded(self):
        tg = make_tg({0: ([msg(1, 1)], 5)})
        for i in range(tg.SEARCH_QUERIES + 10):
            tg._page_state('q%d' % i)
        self.assertEqual(len(tg._pages()), tg.SEARCH_QUERIES)


def done(value):
    f = Future()
    f.set_result(value)
    return f


def finder(tg=None, **settings):
    f = sources.Finder.__new__(sources.Finder)
    f.tg, f.s, f.log = tg, settings, lambda m: None
    f._pool = ThreadPoolExecutor(max_workers=4)
    return f


class PagingFinder(unittest.TestCase):
    class TG(object):
        def __init__(self, more):
            self.more, self.asked = more, []

        def search_has_more(self, q):
            return q in self.more

        def search_more(self, q, pages, budget):
            self.asked.append((q, pages, budget))
            return self.more[q]

        def submit(self, value):
            return done(value)

    def test_older_pages_only_when_needed_and_without_known_messages(self):
        tg = self.TG({'a': {'items': [{'chat_id': 1, 'msg_id': 1}, {'chat_id': 2, 'msg_id': 5, 'doc_id': 77}],
                            'pages': 2, 'stopped': 'end'},
                      'b': {'items': [{'chat_id': 2, 'msg_id': 5}, {'chat_id': 9, 'msg_id': 9}], 'pages': 1,
                            'stopped': 'pages'}})
        f = finder(tg, paging_pages=2, paging_timeout=3)
        raw = [{'chat_id': 1, 'msg_id': 1, 'good': True}]
        job = sources.Job()
        fresh = f._older(raw, ['a', 'b', 'c'], job, lambda c: c.get('good'))
        self.assertEqual(sorted((c['chat_id'], c['msg_id']) for c in fresh), [(2, 5), (9, 9)])
        self.assertEqual(sorted(tg.asked), [('a', 2, 3.0), ('b', 2, 3.0)])
        self.assertEqual((job.paging['queries'], job.paging['pages'], job.paging['files']), (2, 3, 2))
        # enough good files already: Telegram is not asked for more
        tg.asked = []
        many = [{'chat_id': 1, 'msg_id': i, 'good': True} for i in range(8)]
        self.assertEqual(f._older(many, ['a', 'b'], sources.Job(), lambda c: c.get('good')), [])
        self.assertEqual(tg.asked, [])
        # switched off, and on the reduced clone
        self.assertEqual(finder(tg, search_paging=False)._older(raw, ['a'], sources.Job(), bool), [])
        f2 = finder(tg)
        f2._reduced = True
        self.assertEqual(f2._older(raw, ['a'], sources.Job(), bool), [])
        self.assertEqual(tg.asked, [])

    def test_number_of_queries_is_bounded(self):
        more = dict(('q%d' % i, {'items': [], 'pages': 1, 'stopped': 'end'}) for i in range(9))
        tg = self.TG(more)
        finder(tg)._older([], sorted(more), sources.Job(), bool)
        self.assertEqual(len(tg.asked), 3)


# ---------------------------------------------------------------- names
class NameFlags(unittest.TestCase):
    def test_names(self):
        v = parser.find_video_flags
        a = v('Movie.2023.2160p.WEB-DL.DV.P5.HEVC-GRP.mkv')
        self.assertEqual((a['hdr_type'], a['dv'], a['dv_profile'], a['dv_fallback']), ('dv', True, 5, False))
        a = v('Movie.2023.2160p.BluRay.DoVi.Profile.7.TrueHD.Atmos.mkv')
        self.assertEqual((a['dv_profile'], a['dv_fallback']), (7, True))
        self.assertIn('truehd', a['audio_fmt'])
        a = v('Movie.2023.2160p.DV.HDR10.DTS-HD.MA.mkv')
        self.assertEqual((a['dv'], a['dv_profile'], a['dv_fallback']), (True, None, True))
        self.assertEqual([x for x in a['audio_fmt'] if x.startswith('dts')], ['dtshd'])
        a = v('Movie.2023.2160p.Dolby.Vision.mkv')
        self.assertEqual((a['dv'], a['dv_fallback']), (True, None))
        self.assertEqual(v('Movie.2023.2160p.HDR10+.mkv')['hdr_type'], 'hdr10+')
        self.assertEqual(v('Movie.2023.2160p.HDR.mkv')['hdr_type'], 'hdr10')
        self.assertEqual(v('Movie.2023.2160p.HLG.mkv')['hdr_type'], 'hlg')
        for plain in ('Movie.2023.1080p.WEB-DL.x264.mkv', 'Advent.2023.1080p.mkv', 'Movie.DVDRip.avi',
                      'Movie.HDRip.720p.mkv', 'Movie.2023.HDTV.mkv'):
            a = v(plain)
            self.assertEqual((a['hdr_type'], a['dv']), ('', False), plain)

    def test_parse_carries_the_flags(self):
        p = parser.parse('Movie.2023.2160p.WEB-DL.DV.P5.HEVC-GRP.mkv', '')
        self.assertTrue(p['hdr'] and p['dv'])
        self.assertEqual(p['dv_profile'], 5)
        p = parser.parse('Movie.2023.2160p.mkv', 'Dolby Vision + HDR10')        # the caption speaks when the name is silent
        self.assertEqual((p['dv'], p['dv_fallback']), (True, True))
        p = parser.parse('Movie.2023.1080p.HDR.mkv', 'also in Dolby Vision elsewhere')
        self.assertFalse(p['dv'])                                               # the name decides


# ---------------------------------------------------------------- headers
def box(kind, body):
    return struct.pack('>I4s', 8 + len(body), kind) + body


def dovi(profile, compat):
    return bytes(bytearray([1, 0, profile << 1, 0, compat << 4] + [0] * 19))


def moov(fmt=b'avc1', dv=None, colr=None):
    extra = b''
    if dv:
        extra += box(b'dvcC', dovi(*dv))
    if colr:
        extra += box(b'colr', b'nclx' + struct.pack('>HHH', 9, colr, 9) + b'\x00')
    entry = box(fmt, b'\x00' * 78 + extra)
    stsd = box(b'stsd', b'\x00' * 4 + struct.pack('>I', 1) + entry)
    return box(b'moov', box(b'trak', box(b'mdia', box(b'minf', box(b'stbl', stsd)))))


FTYP = box(b'ftyp', b'isom\x00\x00\x02\x00isomiso2')


def mp4_tail_file(mv, mdat=2 * MB + 4096):
    """ftyp, the picture data, then the index: the layout of a file that was not prepared for streaming"""
    return FTYP + struct.pack('>I4s', 8 + mdat, b'mdat') + b'\x00' * mdat + mv


class Headers(unittest.TestCase):
    def test_dolby_vision_record(self):
        self.assertEqual(mediaflags.dovi_record(dovi(5, 0)), (5, False))
        self.assertEqual(mediaflags.dovi_record(dovi(8, 1)), (8, True))
        self.assertEqual(mediaflags.dovi_record(dovi(7, 6)), (7, True))
        self.assertEqual(mediaflags.dovi_record(dovi(8, 0)), (8, False))
        self.assertEqual(mediaflags.dovi_record(b'\x01'), (None, None))
        self.assertEqual(mediaflags.dovi_record(None), (None, None))

    def test_mp4_index_in_the_head(self):
        fl = mediaflags.inspect(FTYP + moov(b'dvhe', dv=(5, 0)) + box(b'mdat', b'\x00' * 64))
        self.assertEqual((fl['moov'], fl['video'], fl['dv'], fl['dv_profile'], fl['dv_fallback'], fl['hdr_type']),
                         ('head', 'hevc', True, 5, False, 'dv'))
        fl = mediaflags.inspect(FTYP + moov(b'hvc1', colr=16) + box(b'mdat', b'\x00' * 64))
        self.assertEqual((fl['dv'], fl['hdr_type']), (False, 'hdr10'))
        fl = mediaflags.inspect(FTYP + moov(b'av01') + box(b'mdat', b'\x00' * 64))
        self.assertEqual((fl['video'], fl['hdr_type']), ('av1', ''))

    def test_mp4_index_behind_the_data(self):
        data = mp4_tail_file(moov(b'hvc1', dv=(8, 1)))
        fl = mediaflags.inspect(data[:131072], len(data))
        self.assertEqual((fl['moov'], fl['next']), ('tail', len(data) - len(moov(b'hvc1', dv=(8, 1)))))
        fl2, cut = mediaflags.mp4_tail(data[fl['next']:], fl['next'], len(data))
        self.assertEqual((fl2['moov'], fl2['dv_profile'], fl2['dv_fallback']), ('tail', 8, True))
        self.assertTrue(cut.startswith(struct.pack('>I', len(cut)) + b'moov'))
        # the file ends inside the picture data: the index never arrived
        cutfile = data[:1 * MB]
        self.assertEqual(mediaflags.inspect(cutfile[:131072], len(cutfile))['moov'], 'missing')
        # something else stands where the index was promised
        fl3, cut3 = mediaflags.mp4_tail(b'\xff' * 4096, fl['next'], len(data))
        self.assertEqual((fl3['moov'], cut3), ('missing', b''))

    def test_garbage_never_raises(self):
        for junk in (b'', b'\x00' * 8, b'\x1a\x45\xdf\xa3' + b'\xff' * 300, b'\x00\x00\x00\x08ftyp' + b'\x01' * 100,
                     os.urandom(4096)):
            mediaflags.inspect(junk, 10)
            mediaflags.mp4_tail(junk, 5, 10)
        self.assertEqual(mediaflags.inspect(b'RIFF' + b'\x00' * 100), {})

    def test_matroska_samples(self):
        for name in ('hevc.mkv', 'movie100.mkv'):
            path = os.path.join(HERE, 'agentC', 'samples', name)
            if not os.path.exists(path):
                continue
            with open(path, 'rb') as fh:
                data = fh.read(131072)
            fl = mediaflags.inspect(data, os.path.getsize(path))
            self.assertEqual(fl.get('container'), 'mkv', name)
            self.assertIn(fl['cues'], (True, False, None))

    def test_header_beats_the_name(self):
        p = parser.parse('Movie.2023.2160p.DV.mp4', '')
        self.assertTrue(p['dv'])
        mediaflags.apply(p, mediaflags.inspect(FTYP + moov(b'hvc1', colr=16) + box(b'mdat', b'\x00' * 64)))
        self.assertEqual((p['dv'], p['hdr_type'], p['hdr']), (False, 'hdr10', True))
        p = parser.parse('Movie.2023.2160p.mp4', '')
        mediaflags.apply(p, mediaflags.inspect(FTYP + moov(b'dvhe', dv=(5, 0)) + box(b'mdat', b'\x00' * 64)))
        self.assertEqual((p['dv'], p['dv_profile'], p['dv_fallback'], p['hdr']), (True, 5, False, True))


class Device(unittest.TestCase):
    def test_caps(self):
        self.assertIs(mediaflags.device_caps({}, 'windows')['dv'], False)
        self.assertIs(mediaflags.device_caps({}, 'apple')['dv'], False)
        self.assertIsNone(mediaflags.device_caps({}, 'android')['dv'])
        self.assertIs(mediaflags.device_caps({'dv_support': 'yes'}, 'windows')['dv'], True)
        self.assertIs(mediaflags.device_caps({'dv_support': 'no', 'av1_support': 'no'}, 'android')['av1'], False)

    def test_judge(self):
        j = mediaflags.judge
        p5 = {'dv': True, 'dv_profile': 5, 'dv_fallback': False, 'hdr_type': 'dv'}
        p8 = {'dv': True, 'dv_profile': 8, 'dv_fallback': True, 'hdr_type': 'dv'}
        bare = {'dv': True, 'dv_profile': None, 'dv_fallback': None, 'hdr_type': 'dv'}
        self.assertTrue(j(p5, {'dv': False})[0])                    # green and purple picture: not listed
        self.assertFalse(j(p5, {'dv': None})[0])                    # not known: listed lower, never hidden
        self.assertLess(j(p5, {'dv': None})[1], 0)
        self.assertEqual(j(p5, {'dv': True})[:2], (False, 2.0))     # a Dolby Vision screen: listed higher
        self.assertEqual(j(p8, {'dv': False})[:2], (False, 0.0))    # the HDR10 layer plays
        self.assertFalse(j(bare, {'dv': False})[0])
        self.assertLess(j(bare, {'dv': False})[1], j(bare, {'dv': None})[1])
        self.assertTrue(j({'codec': 'av1'}, {'av1': False})[0])
        self.assertFalse(j({'codec': 'av1'}, {'av1': None})[0])
        self.assertLess(j({'hdr_type': 'hdr10'}, {'hdr': False})[1], 0)
        self.assertEqual(j({}, {}), (False, 0.0, ''))

    def test_device_fit(self):
        def cand(name, score=50):
            return {'file': name, 'score': score, 'parsed': parser.parse(name, '')}
        f = finder(dv_support='no')
        a, b = cand('Movie.2023.2160p.DV.P5.mkv', 60), cand('Movie.2023.1080p.x264.mkv')
        keep, hidden = f.device_fit([a, b])
        self.assertEqual(([c['file'] for c in keep], hidden), ([b['file']], 1))
        self.assertTrue(a['device_warn'])
        # the only file there is: listed with its warning rather than "nothing found"
        a2 = cand('Movie.2023.2160p.DV.P5.mkv')
        keep, hidden = f.device_fit([a2])
        self.assertEqual((keep, hidden), ([a2], 0))
        self.assertTrue(a2['loose'] and a2['device_warn'])
        # judged twice (by the name, then by the header): the points are not added twice
        f2 = finder(dv_support='yes')
        c = cand('Movie.2023.2160p.DV.P8.mkv')
        f2.device_fit([c])
        f2.device_fit([c])
        self.assertEqual(c['score'], 52.0)
        self.assertEqual(finder(dv_support='no', device_filter=False).device_fit([a, b])[1], 0)
        row = sources.Finder._public(dict(a, chat_id=1, msg_id=2, size=5, why=['title 0.90']))
        self.assertEqual((row['hdr_type'], row['dv'], row['dv_profile'], row['dv_fallback']), ('dv', True, 5, False))
        self.assertTrue(row['device_warn'])


# ---------------------------------------------------------------- the link test with second reads
class FileTG(object):
    """Telegram files as byte strings: {msg_id: bytes}"""

    def __init__(self, files, hang=()):
        self.files, self.hang, self.chunks = files, set(hang), []

    def read_head(self, chat, mid, size, timed):
        return self.files[mid][:size], 0.05

    def read_chunk(self, chat, mid, idx):
        return ('chunk', mid, idx)

    def submit(self, value):
        return done(value)

    def run(self, value, timeout):
        _, mid, idx = value
        self.chunks.append((mid, idx))
        if mid in self.hang:
            raise asyncio.TimeoutError()
        return self.files[mid][idx * MB:(idx + 1) * MB]


def tg_cand(mid, name, data, score=50, size=None):
    return {'chat_id': 1, 'msg_id': mid, 'file': name, 'size': len(data) if size is None else size, 'score': score,
            'duration': 0, 'parsed': parser.parse(name, ''), 'caption': '', 'why': ['title 0.90']}


class Probe(unittest.TestCase):
    def test_tail_probe_on_telegram(self):
        whole = mp4_tail_file(moov(b'dvhe', dv=(5, 0)))
        plain = mp4_tail_file(moov(b'avc1'))
        swapped = mp4_tail_file(moov(b'avc1'))
        swapped = swapped[:-len(moov(b'avc1'))] + b'\xff' * len(moov(b'avc1'))     # no index where it should stand
        cut = mp4_tail_file(moov(b'avc1'))[:1 * MB + 100]                          # the upload stopped half-way
        head = FTYP + moov(b'avc1') + box(b'mdat', b'\x00' * 200000)
        late = mp4_tail_file(moov(b'avc1'))
        tg = FileTG({1: whole, 2: plain, 3: swapped, 4: cut, 5: head, 6: late}, hang=[6])
        f = finder(tg, dv_support='no', probe_tail_timeout=3, hide_slow=False)
        cands = [tg_cand(1, 'Movie.2023.2160p.mp4', whole, 60), tg_cand(2, 'Movie.2023.1080p.mp4', plain, 55),
                 tg_cand(3, 'Movie.2023.720p.mp4', swapped, 54), tg_cand(4, 'Movie.2023.480p.mp4', cut, 53),
                 tg_cand(5, 'Movie.2023.1080p.WEB.mp4', head, 52), tg_cand(6, 'Movie.2023.1080p.BluRay.mp4', late, 51)]
        job = sources.Job()
        out = f.probe(cands, job)
        by = dict((c['msg_id'], c) for c in cands)
        self.assertEqual(sorted(c['msg_id'] for c in out), [1, 2, 5, 6])
        self.assertEqual((by[3]['probe'], by[4]['probe']), ('bad-container', 'bad-container'))
        self.assertEqual((by[1]['seek'], by[2]['seek'], by[5]['seek'], by[6]['seek']), ('tail', 'tail', 'ok', 'tail?'))
        self.assertEqual(by[6]['probe'], 'ok')                      # an unanswered second read changes nothing
        # the Dolby Vision record was in the index at the END of the file: the name said nothing about it
        p = by[1]['parsed']
        self.assertEqual((p['dv'], p['dv_profile'], p['dv_fallback']), (True, 5, False))
        self.assertIn('container: index at the end of the file', by[1]['why'])
        st = job.stats['checks']
        self.assertEqual((st['second']['tail'], st['second']['tail_ok'], st['second']['tail_bad'],
                          st['second']['unanswered']), (4, 2, 1, 1))
        self.assertEqual((st['broken'], st['ok'], st['wrong']), (2, 4, 2))
        self.assertEqual(sorted(tg.chunks), [(1, 2), (2, 2), (3, 2), (6, 2)])     # one read each, none for 4 and 5
        # ... and this screen has no Dolby Vision: the profile 5 file is not listed
        keep, hidden = f.device_fit(out)
        self.assertEqual((sorted(c['msg_id'] for c in keep), hidden), ([2, 5, 6], 1))

    def test_tail_reads_are_bounded(self):
        data = mp4_tail_file(moov(b'avc1'))
        tg = FileTG(dict((i, data) for i in range(1, 10)))
        f = finder(tg, hide_slow=False)
        out = f.probe([tg_cand(i, 'Movie.2023.1080p.%d.mp4' % i, data, 60 - i) for i in range(1, 10)], sources.Job())
        self.assertEqual(len(out), 9)
        self.assertEqual(sorted(tg.chunks), [(i, 2) for i in range(1, f.TAIL_TG_MAX + 1)])   # the best ones only
        tg.chunks = []
        f = finder(tg, probe_tail=False)
        f.probe([tg_cand(1, 'Movie.2023.1080p.mp4', data)], sources.Job())
        self.assertEqual(tg.chunks, [])

    def test_http_sources(self):
        mkv = b'\x1a\x45\xdf\xa3' + b'\x00' * (MB - 4)
        tail = mp4_tail_file(moov(b'hvc1', dv=(8, 1)))
        asked = []

        def head(url, timeout, size, timed):
            return (tail[:size] if url == 'http://tail' else mkv), 0.2

        def rng(url, start, size, timeout=6):
            asked.append((url, start, size))
            if url == 'http://fast':
                return b'\x00' * size, 0.5, True
            if url == 'http://slow':
                return b'\x00' * size, 10.0, True
            if url == 'http://norange':
                return b'', 0.1, False
            if url == 'http://tail':
                return tail[start:start + size], 0.1, True
            raise IOError('HTTP 500')
        old = sources.http_head_bytes, sources.http_range_bytes
        sources.http_head_bytes, sources.http_range_bytes = head, rng
        try:
            def cand(url, score, size=1024 * MB, name='Movie.2023.1080p.mkv'):
                return {'url': url, 'backend': 'servers', 'chat_id': 0, 'msg_id': 0, 'file': name, 'size': size,
                        'score': score, 'duration': 3600, 'parsed': parser.parse(name, ''), 'caption': '', 'why': []}
            cands = [cand('http://fast', 60), cand('http://slow', 59), cand('http://norange', 58),
                     cand('http://tail', 70, len(tail), 'Movie.2023.2160p.mp4'), cand('http://later', 10)]
            f = finder(None, probe_tail_timeout=3)
            job = sources.Job()
            out = f.probe(cands, job)
            by = dict((c['url'], c) for c in cands)
            self.assertEqual(sorted(c['url'] for c in out), ['http://fast', 'http://later', 'http://norange',
                                                              'http://tail'])    # the slow one is hidden
            self.assertFalse(by['http://slow']['smooth'])
            self.assertTrue(by['http://fast']['smooth'])
            self.assertEqual(by['http://norange']['seek'], 'none')
            self.assertEqual(by['http://tail']['seek'], 'tail')
            self.assertEqual(by['http://tail']['parsed']['dv_profile'], 8)
            self.assertNotIn('http://later', [a[0] for a in asked])              # three middle reads at most
            mid = [a for a in asked if a[0] == 'http://fast'][0]
            self.assertEqual((mid[1], mid[2]), (512 * MB, 2 * MB))
            st = job.stats['checks']['second']
            self.assertEqual((st['tail'], st['tail_ok'], st['mid'], st['mid_slow'], st['no_range']), (1, 1, 3, 1, 1))
        finally:
            sources.http_head_bytes, sources.http_range_bytes = old


if __name__ == '__main__':
    unittest.main(verbosity=1)
