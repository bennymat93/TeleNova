# -*- coding: utf-8 -*-
"""4.0.2: which bots a search asks. Rules learned from real bot chats: one-series menu bots, advert bots."""
import os, sys, time, types, unittest

for name in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules.setdefault(name, types.ModuleType(name))
ADDON_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'plugin.video.telescope')
sys.path.insert(0, ADDON_ROOT)
try:
    from resources.lib import sources
except Exception as exc:                 # the module needs the Kodi-side helpers the big suites build
    import test_all  # noqa: F401  (installs the fake Kodi modules)
    from resources.lib import sources


class Rules(unittest.TestCase):
    def finder(self, stats, auto):
        f = sources.Finder.__new__(sources.Finder)
        f.tg = object()
        f.s = {'bot_request': True, 'bot_auto': True, 'bots': [], 'bot_max': 3}
        f._bots_load = lambda: {'cfg': {}, 'stats': stats}
        f.auto_bots = lambda background=False, refresh=False: auto
        return f

    def test_series_bot_first_and_only_for_its_series(self):
        now = int(time.time())
        auto = [{'id': 1, 'username': 'supernatural_bot', 'title': u'על טבעי'},
                {'id': 2, 'username': 'fbi_bot', 'title': u'אף בי איי המבוקשים ביותר לצפייה ישירה'},
                {'id': 3, 'username': 'ads_bot', 'title': u'יוטיוב פרימיום | אפליקציות'},
                {'id': 4, 'username': 'movies_bot', 'title': 'Movies search'},
                {'id': 5, 'username': 'new_bot', 'title': 'Brand new bot'}]
        stats = {'supernatural_bot': {'asked': 3, 'hits': 1, 'files': 1, 'named': True, 'last': now},
                 'fbi_bot': {'asked': 2, 'hits': 0, 'last': now},
                 'ads_bot': {'asked': 2, 'hits': 0, 'last': now},
                 'movies_bot': {'asked': 9, 'hits': 6, 'files': 20, 'last': now}}
        f = self.finder(stats, auto)
        sup = {'aliases': ['Supernatural', u'על טבעי']}
        got = [b['key'] for b in f.content_bots(target=sup)]
        self.assertEqual(got[0], 'supernatural_bot')            # named after the series: first
        self.assertIn('movies_bot', got)                        # a bot that brought files before
        self.assertIn('new_bot', got)                           # a new bot gets its tries
        self.assertNotIn('ads_bot', got)                        # two tries, nothing: rests for a month
        self.assertNotIn('fbi_bot', got)                        # another series' bot that never delivered
        self.assertTrue(f.content_bots(target=sup)[0]['series'])
        other = [b['key'] for b in f.content_bots(target={'aliases': ['Inception', u'התחלה']})]
        self.assertNotIn('supernatural_bot', other)             # a one-series bot is not asked for another title
        self.assertEqual(other[0], 'movies_bot')
        fbi = [b['key'] for b in f.content_bots(target={'aliases': ['FBI: Most Wanted', u'אף בי איי: המבוקשים ביותר']})]
        self.assertEqual(fbi[0], 'fbi_bot')                     # ... but always for its own, however it did before

    def test_advert_bot_comes_back_after_a_month(self):
        old = int(time.time()) - 31 * 86400
        f = self.finder({'ads_bot': {'asked': 2, 'hits': 0, 'last': old}}, [{'id': 3, 'username': 'ads_bot', 'title': 'Ads'}])
        self.assertEqual([b['key'] for b in f.content_bots(target={'aliases': ['Inception']})], ['ads_bot'])

    def test_bot_that_rarely_answers_rests(self):
        now = int(time.time())
        auto = [{'id': 1, 'username': 'rare_bot', 'title': u'על טבעי'}, {'id': 2, 'username': 'good_bot', 'title': 'Movies'},
                {'id': 3, 'username': 'young_bot', 'title': 'New'}]
        stats = {'rare_bot': {'asked': 8, 'hits': 1, 'files': 1, 'last': now},        # answered once in eight
                 'good_bot': {'asked': 8, 'hits': 3, 'files': 9, 'last': now},
                 'young_bot': {'asked': 3, 'hits': 1, 'files': 1, 'last': now}}       # too few requests to judge
        f = self.finder(stats, auto)
        got = [b['key'] for b in f.content_bots(target={'aliases': ['Breaking Bad', u'שובר שורות']})]
        self.assertNotIn('rare_bot', got)
        self.assertEqual(got, ['good_bot', 'young_bot'])
        own = [b['key'] for b in f.content_bots(target={'aliases': ['Supernatural', u'על טבעי']})]
        self.assertEqual(own[0], 'rare_bot')                    # still asked for the series it is named after
        stats['rare_bot']['last'] = now - 31 * 86400
        self.assertIn('rare_bot', [b['key'] for b in f.content_bots(target={'aliases': ['Breaking Bad']})])

    def test_marked_bot_is_always_asked(self):
        f = self.finder({'my_bot': {'asked': 9, 'hits': 0, 'last': int(time.time())}}, [])
        f._bots_load = lambda: {'cfg': {'my_bot': {'state': 'on', 'username': 'my_bot', 'title': 'Mine'}},
                                'stats': {'my_bot': {'asked': 9, 'hits': 0, 'last': int(time.time())}}}
        self.assertEqual([b['key'] for b in f.content_bots(target={'aliases': ['Inception']})], ['my_bot'])


if __name__ == '__main__':
    unittest.main(verbosity=1)
