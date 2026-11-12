# -*- coding: utf-8 -*-
"""3.3.4: Real-Debrid. The RD API and the Torrentio index are simulated (no account is used); one test reads the
public Torrentio index for real (skipped offline). Run: python test_rd.py"""
import json
import os
import sys
import tempfile
import time
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'test_bots_shim'))
import test_bots as tb  # noqa: E402  (Kodi stubs, Finder helpers)
from resources.lib import realdebrid, sources, cache  # noqa: E402

TMP = tempfile.mkdtemp(prefix='rd_', dir=HERE)


class Resp(object):
    def __init__(self, status=200, data=None, headers=None):
        self.status_code, self._data, self.headers = status, data, headers or {}
        self.content = b'' if data is None else json.dumps(data).encode()

    def json(self):
        if self._data is None:
            raise ValueError('no json')
        return self._data

    def close(self):
        pass


class FakeHTTP(object):
    """Real-Debrid + Torrentio. torrents: hash -> {'files': [(path, bytes)], 'cached': bool}"""

    def __init__(self):
        self.headers = {}
        self.calls = []
        self.token_ok = {'TOKEN-OLD'}
        self.torrents = {}
        self.account = {}            # id -> torrent record
        self.seq = 0
        self.index = []

    # requests.Session API
    def get(self, url, params=None, timeout=None, allow_redirects=True, stream=False, headers=None):
        return self.request('GET', url, params=params, headers=headers, allow_redirects=allow_redirects)

    def post(self, url, data=None, timeout=None, headers=None):
        return self.request('POST', url, data=data, headers=headers)

    def request(self, method, url, data=None, timeout=None, headers=None, params=None, allow_redirects=True):
        self.calls.append((method, url.split('?')[0]))
        if 'torrentio' in url:
            if '/resolve/' in url:
                return Resp(302, None, {'Location': 'https://rd.example/d/' + url.rsplit('/', 1)[1]})
            keyed = 'realdebrid=' in url
            out = []
            for st in self.index:
                st = dict(st)
                if keyed:
                    cached = self.torrents.get(st['infoHash'], {}).get('cached')
                    st['name'] = 'Torrentio\n[RD%s] 1080p' % ('+' if cached else ' download')
                    st['url'] = 'https://torrentio.example/resolve/realdebrid/KEY/%s/%s' % (st['infoHash'], st['fileIdx'])
                out.append(st)
            return Resp(200, {'streams': out})
        if '/oauth/v2/token' in url:
            if (data or {}).get('code') == 'REFRESH':
                self.token_ok.add('TOKEN-NEW')
                return Resp(200, {'access_token': 'TOKEN-NEW', 'refresh_token': 'REFRESH'})
            return Resp(400, {'error': 'bad'})
        tok = ((headers or {}).get('Authorization') or '').replace('Bearer ', '')
        if tok not in self.token_ok:
            return Resp(401, {'error': 'bad_token'})
        path = url.split('/rest/1.0', 1)[1]
        if path == '/user':
            return Resp(200, {'username': 'viewer', 'type': 'premium', 'premium': 30 * 86400 + 5})
        if path.startswith('/torrents?'):
            return Resp(200, [dict(id=k, filename=v['filename'], bytes=v['bytes'], status=v['status'], links=v['links'])
                              for k, v in self.account.items()])
        if path == '/torrents/addMagnet':
            h = data['magnet'].split('btih:')[1].split('&')[0]
            self.seq += 1
            tid = 'T%d' % self.seq
            t = self.torrents.get(h, {'files': [('/x.mkv', 1)], 'cached': False})
            self.account[tid] = {'hash': h, 'filename': 'x', 'bytes': 1, 'status': 'magnet_conversion', 'links': [],
                                 'files': [{'id': i + 1, 'path': f[0], 'bytes': f[1], 'selected': 0} for i, f in enumerate(t['files'])],
                                 'polls': 0, 'cached': t['cached']}
            return Resp(201, {'id': tid})
        if path.startswith('/torrents/info/'):
            t = self.account[path.rsplit('/', 1)[1]]
            t['polls'] += 1
            if t['status'] == 'magnet_conversion' and t['polls'] > 1:
                t['status'] = 'waiting_files_selection'
            return Resp(200, {'status': t['status'], 'files': t['files'], 'links': t['links']})
        if path.startswith('/torrents/selectFiles/'):
            t = self.account[path.rsplit('/', 1)[1]]
            ids = [int(x) for x in data['files'].split(',')]
            for f in t['files']:
                f['selected'] = 1 if f['id'] in ids else 0
            if t['cached']:
                t['status'] = 'downloaded'
                t['links'] = ['https://real-debrid.com/d/%s%d' % (t['hash'][:4], i) for i in ids]
            else:
                t['status'] = 'downloading'
            return Resp(204)
        if path.startswith('/torrents/delete/'):
            self.account.pop(path.rsplit('/', 1)[1], None)
            return Resp(204)
        if path == '/unrestrict/link':
            return Resp(200, {'download': data['link'].replace('real-debrid.com/d/', 'dl.real-debrid.com/')})
        return Resp(404, {'error': 'unknown'})


def make_rd(http, **kw):
    s = {'rd_enabled': True, 'rd_token': 'TOKEN-OLD', 'rd_torrentio_on': True, 'rd_torrentio_key': True,
         'rd_cloud': True, 'rd_max': 15}
    s.update(kw)
    saved = {}
    rd = realdebrid.RealDebrid(s, lambda k, v: saved.__setitem__(k, v), lambda m: tb.LOGGED.append((1, m)))
    if http is not None:
        rd.http = http
    return rd, s, saved


IDX = [{'title': 'Big.Buck.Movie.2020.1080p.BluRay.x264\n\U0001F464 50 \U0001F4BE 8.5 GB', 'infoHash': 'aaaa1111',
        'fileIdx': 0, 'behaviorHints': {'filename': 'Big.Buck.Movie.2020.1080p.BluRay.x264.mkv'}},
       {'title': 'Big.Buck.Movie.2020.2160p.UHD\n\U0001F4BE 40.1 GB', 'infoHash': 'bbbb2222', 'fileIdx': 1,
        'behaviorHints': {}},
       {'title': 'Big.Buck.Movie.2020.720p\n\U0001F4BE 900 MB', 'infoHash': 'cccc3333', 'fileIdx': 0,
        'behaviorHints': {'filename': 'Big.Buck.Movie.2020.720p.mkv'}}]


class RDTests(unittest.TestCase):
    def setUp(self):
        self.h = FakeHTTP()
        self.h.index = IDX
        self.h.torrents = {'aaaa1111': {'files': [('/Big.Buck.Movie.mkv', 9 * 10 ** 9)], 'cached': True},
                           'bbbb2222': {'files': [('/sample.mkv', 10 ** 7), ('/Big.Buck.Movie.2160p.mkv', 4 * 10 ** 10)], 'cached': True},
                           'cccc3333': {'files': [('/a.mkv', 10 ** 9)], 'cached': False}}

    def test_index_with_key_lists_only_cached(self):
        rd, _, _ = make_rd(self.h)
        got = rd.streams('movie', 'tt1')
        self.assertEqual([c['file'] for c in got], ['Big.Buck.Movie.2020.1080p.BluRay.x264.mkv',
                                                    'Big.Buck.Movie.2020.2160p.UHD.mkv'])
        self.assertEqual(got[0]['size'], int(8.5 * 1024 ** 3))
        self.assertTrue(all(c['backend'] == 'rd' and c['rd_cached'] for c in got))

    def test_index_without_key_and_play_checks_cache(self):
        rd, _, _ = make_rd(self.h, rd_torrentio_key=False)
        got = rd.streams('movie', 'tt1')
        self.assertEqual(len(got), 3)
        self.assertFalse(any('realdebrid=' in u for _, u in self.h.calls))       # the key never left
        url = rd.resolve(got[1])
        self.assertEqual(url, 'https://dl.real-debrid.com/bbbb2')                  # file 2 of the torrent (fileIdx 1)
        t0 = time.time()
        with self.assertRaises(realdebrid.RDError):
            rd.resolve(got[2], wait=2)                                             # not cached
        self.assertLess(time.time() - t0, 6)
        self.assertEqual(sorted(self.h.account), ['T1'])                          # the failed add was removed again

    def test_keyed_link_resolves_through_redirect(self):
        rd, _, _ = make_rd(self.h)
        c = rd.streams('movie', 'tt1')[0]
        self.assertEqual(rd.resolve(c), 'https://rd.example/d/0')

    def test_cloud_picks_the_episode(self):
        self.h.account = {'X1': {'filename': 'Show.S02.1080p', 'bytes': 5, 'status': 'downloaded', 'polls': 0,
                                 'links': ['https://real-debrid.com/d/L1', 'https://real-debrid.com/d/L2', 'https://real-debrid.com/d/L3'],
                                 'files': [{'id': 1, 'path': '/Show.S02E04.mkv', 'bytes': 9, 'selected': 1},
                                           {'id': 2, 'path': '/Show.S02E05.mkv', 'bytes': 8, 'selected': 1},
                                           {'id': 3, 'path': '/Show.S02E06.mkv', 'bytes': 9, 'selected': 1}]},
                          'X2': {'filename': 'half', 'bytes': 5, 'status': 'downloading', 'links': [], 'files': [], 'polls': 0}}
        rd, _, _ = make_rd(self.h)
        cl = rd.cloud()
        self.assertEqual([c['file'] for c in cl], ['Show.S02.1080p.mkv'])
        self.assertEqual(rd.resolve(cl[0], {'season': 2, 'episode': 5}), 'https://dl.real-debrid.com/L2')

    def test_expired_token_is_refreshed(self):
        rd, s, saved = make_rd(self.h, rd_token='TOKEN-EXPIRED', rd_refresh='REFRESH', rd_client_id='c',
                               rd_client_secret='x')
        self.assertEqual(rd.user()['days'], 30)
        self.assertEqual(saved['rd_token'], 'TOKEN-NEW')
        rd2, _, _ = make_rd(self.h, rd_token='NOPE')
        with self.assertRaises(realdebrid.RDError):
            rd2.user()

    def test_no_token_means_off(self):
        rd, _, _ = make_rd(self.h, rd_token='')
        self.assertFalse(rd.enabled)


class OrderTests(unittest.TestCase):
    def test_telegram_then_rd_then_rest(self):
        f = sources.Finder(None, None, None, None, cache.Cache(os.path.join(TMP, 'o.db')), {'max_results': 3, 'rd_max': 2},
                           lambda m: None)
        mixed = [{'backend': 'stremio', 'n': 1}, {'backend': 'rd', 'n': 2}, {'backend': 'tg', 'n': 3},
                 {'backend': 'rd', 'n': 4}, {'backend': 'telemedia', 'n': 5}, {'backend': 'rd', 'n': 6},
                 {'backend': 'tg', 'n': 7}, {'backend': 'tg', 'n': 8}, {'backend': 'tg', 'n': 9}]
        self.assertEqual([c['n'] for c in f.order_groups(mixed)], [3, 5, 7, 2, 4, 1])


@unittest.skipUnless(tb.HAVE_TELETHON, 'Telethon is not installed here')
class FinderRDTests(unittest.TestCase):
    def setUp(self):
        self.c = tb.FClient()
        self.tg = tb.make_tg(self.c)
        self.mkv = open(os.path.join(tb.SAMPLES, 'movie100.mkv'), 'rb').read()

    def tearDown(self):
        self.tg.loop.call_soon_threadsafe(self.tg.loop.stop)

    def test_search_lists_telegram_first_rd_untested_but_listed(self):
        chan = self.c.add(tb.FEnt(-100900, 'chan', title='Movies', broadcast=True))
        tg_hits = [self.c.post(chan, '', file=tb.FFile('Big.Buck.Movie.2020.720p.mkv'), blob=self.mkv)]
        self.c.search_hits['Big Buck Movie'] = tg_hits
        h = FakeHTTP()
        h.index = IDX
        h.torrents = {'aaaa1111': {'files': [], 'cached': True}, 'bbbb2222': {'files': [], 'cached': True}}
        rd, _, _ = make_rd(h)
        f = tb.finder_for(self.tg, 'rd1', bot_request=False)
        f.rd = rd

        class M(object):
            def details(self, kind, ident):
                return {'title': 'Big Buck Movie', 'year': 2020, 'aliases': ['Big Buck Movie'], 'imdb': 'tt1', 'runtime': 100}
        f.meta = M()
        t0 = time.time()
        j = tb.wait_job(f, f.start({'type': 'movie', 'tmdb': '1', 'title': 'Big Buck Movie', 'year': 2020}))
        self.assertIsNone(j.error)
        kinds = [r['backend'] for r in j.result]
        self.assertEqual(kinds, ['tg', 'rd', 'rd'])
        self.assertEqual(j.result[0]['probe'], 'ok')
        self.assertTrue(all(r['probe'] == 'rd' for r in j.result[1:]))
        self.assertEqual(j.stats['checks']['rd'], 2)
        self.assertLess(time.time() - t0, 8)


class LiveIndexTest(unittest.TestCase):
    def test_public_index_parses(self):
        import requests
        rd, _, _ = make_rd(None, rd_torrentio_key=False)   # the add-on's own session (its User-Agent)
        try:
            requests.get(realdebrid.TORRENTIO, timeout=8)
        except Exception:
            self.skipTest('offline')
        got = rd.streams('movie', 'tt0133093')
        self.assertGreater(len(got), 5)
        self.assertTrue(all(c['rd'].get('hash') and c['file'] for c in got))
        got = rd.streams('episode', 'tt0903747', 1, 1)            # an episode id
        self.assertGreater(len(got), 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
