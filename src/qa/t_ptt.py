# -*- coding: utf-8 -*-
"""4.2.7: PTT-style episode / pack patterns and the junk-name gate in telescope's parser."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'plugin.video.telescope', 'resources', 'lib'))
import parser as P  # noqa: E402

# name -> expected subset of parse() fields
CASES = [
    (u'Show.S01E01-E03.mkv', dict(season=1, episode=1, episode_end=3)),
    (u'Show.S01E01E02E03.mkv', dict(season=1, episode=1, episode_end=3)),
    (u'Show.S02.E05-E07.mkv', dict(season=2, episode=5, episode_end=7)),
    (u'Show 1x02.mkv', dict(season=1, episode=2, episode_end=None)),
    (u'Show 01x02-03.mkv', dict(season=1, episode=2, episode_end=3)),
    (u'Show.E01-E05.mkv', dict(episode=1, episode_end=5)),
    (u'Show.Ep.01-05.mkv', dict(episode=1, episode_end=5)),
    (u'Show.S01E05.1080p.mkv', dict(season=1, episode=5, episode_end=None)),
    (u'Show Season 1 Complete.mkv', dict(episode=None, season_hint=1, season_pack=True)),
    (u'Show.S01.COMPLETE.1080p.mkv', dict(episode=None, season_hint=1, season_pack=True)),
    (u'Show.S01-S03.Complete.mkv', dict(season_hint=1, season_end=3, season_pack=True)),
    (u'Show.Season.1-3.mkv', dict(season_hint=1, season_end=3, season_pack=True)),
    (u'Show עונות 1-3.mkv', dict(season_hint=1, season_end=3, season_pack=True)),
    (u'Show сезон 1-3.mkv', dict(season_hint=1, season_end=3, season_pack=True)),
    (u'עונה 2 פרקים 1-5.mkv', dict(season=2, episode=1, episode_end=5)),
    (u'עונה 1 פרק 2.mkv', dict(season=1, episode=2)),
    (u'Show 2 сезон 1-8 серии.mkv', dict(season=2, episode=1, episode_end=8)),
    (u'Сезон 1, Серия 2.mkv', dict(season=1, episode=2)),
    (u'Movie.2020.HDCAM.mkv', dict(is_cam=True, source='cam')),
    (u'Movie.2020.HDTS.mkv', dict(is_cam=True)),
    (u'Movie.2020.1080p.WEB-DL.mkv', dict(is_cam=False, is_junk=False, is_trailer=False)),
    (u'Show.S01E01.sample.mkv', dict(is_trailer=True)),
    (u'Movie.2020.Trailer.mkv', dict(is_trailer=True)),
    (u'Movie.2020.Featurette.mkv', dict(is_junk=True)),
    (u'Movie.Extras.mkv', dict(is_junk=False)),          # review 17/11: no release marker = the word may be the title
    (u'Movie.2019.Extras.mkv', dict(is_junk=True)),
    (u'The.Interview.2014.1080p.mkv', dict(is_junk=False)),
    (u'The Making of a Lady 2012.mkv', dict(is_junk=False)),
    (u'Ricky.Gervais.Extras.S01E01.mkv', dict(is_junk=False)),
    (u'Breaking.Bad.S01E01.Deleted.Scenes.mkv', dict(is_junk=True)),
    (u'Movie.2019.Behind.The.Scenes.mkv', dict(is_junk=True)),
    (u'readme.nfo', dict(is_junk=True)),
    (u'info.txt', dict(is_junk=True)),
    (u'Extras.S01E01.mkv', dict(is_junk=False, season=1, episode=1)),   # the show "Extras"
]


def main():
    bad = 0
    for name, want in CASES:
        r = P.parse(name)
        for k, v in want.items():
            if r.get(k) != v:
                bad += 1
                print('FAIL %r %s=%r want %r' % (name, k, r.get(k), v))
    print('%d cases, %d failures' % (len(CASES), bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
