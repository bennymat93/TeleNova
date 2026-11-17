# -*- coding: utf-8 -*-
"""4.2.7: union de-duplication across Telegram / Real-Debrid / Stremio rows. Run: python t_dedup.py"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'agentC', 'test_bots_shim'))
sys.path.insert(0, os.path.join(HERE, 'agentC'))
import test_bots  # noqa: E402,F401  (Kodi stubs)
from resources.lib import sources  # noqa: E402

GB = 1024 ** 3


def row(backend, name, size, **kw):
    c = {'backend': backend, 'file': name, 'size': size, 'score': kw.pop('score', 50), 'chat_id': kw.pop('chat_id', 0),
         'msg_id': kw.pop('msg_id', 0)}
    c.update(kw)
    return c


class T(unittest.TestCase):
    def setUp(self):
        self.cls = [v for v in vars(sources).values() if isinstance(v, type) and hasattr(v, 'union_dedup')][0]

    def test_same_release_three_sources(self):
        n = 'Movie.2020.1080p.WEB-DL.x264-GRP.mkv'
        rows = [row('servers', n, int(4 * GB), score=70, url='http://s'),
                row('rd', n, int(4 * GB * 1.004), rd_cached=True, url='http://r'),
                row('tg', 'movie 2020 1080p web dl x264 grp.mp4', int(4 * GB * 0.996), probe='ok', chat_id=1, msg_id=2)]
        out, n_f = self.cls.union_dedup(rows)
        self.assertEqual(len(out), 1)
        self.assertEqual(n_f, 2)
        self.assertEqual(out[0]['backend'], 'tg')
        self.assertEqual(out[0]['score'], 70)
        self.assertEqual(sorted(out[0]['also']), ['rd', 'servers'])

    def test_rd_cached_beats_server(self):
        n = 'Show.S01E02.720p.HDTV.x264-ABC.mkv'
        out, _ = self.cls.union_dedup([row('servers', n, GB, url='a'), row('rd', n, GB, rd_cached=True, url='b')])
        self.assertEqual([c['backend'] for c in out], ['rd'])

    def test_size_outside_bucket_kept(self):
        n = 'Movie.2020.1080p.BluRay.x264-GRP.mkv'
        out, f = self.cls.union_dedup([row('tg', n, 4 * GB, chat_id=1, msg_id=1),
                                       row('rd', n, int(4 * GB * 1.05), url='r')])
        self.assertEqual((len(out), f), (2, 0))

    def test_duration_mismatch_kept(self):
        n = 'Movie.2020.1080p.BluRay.x264-GRP.mkv'
        out, _ = self.cls.union_dedup([row('tg', n, GB, duration=6000, chat_id=1, msg_id=1),
                                       row('tg', n, GB, duration=5000, chat_id=2, msg_id=1)])
        self.assertEqual(len(out), 2)

    def test_tg_copies_become_mirrors_and_unknown_size_kept(self):
        n = 'Movie.2020.1080p.BluRay.x264-GRP.mkv'
        out, _ = self.cls.union_dedup([row('tg', n, GB, chat_id=1, msg_id=1), row('tg', n, GB, chat_id=2, msg_id=5),
                                       row('rd', n, 0, url='x'), row('rd', n, 0, url='y')])
        self.assertEqual(len(out), 3)
        self.assertEqual(out[0]['mirrors'], [[2, 5]])

    def test_order_kept(self):
        a = row('tg', 'Alpha.2020.1080p.WEB.mkv', GB, chat_id=1, msg_id=1)
        b = row('tg', 'Beta.2020.1080p.WEB.mkv', GB, chat_id=1, msg_id=2)
        out, _ = self.cls.union_dedup([a, b])
        self.assertEqual(out, [a, b])


if __name__ == '__main__':
    unittest.main()
