# -*- coding: utf-8 -*-
"""Fixtures for web/matcher.js and web/epmatch.js (WP-2): what the BUILD's own telescope parser / matcher /
sources.union_dedup / plan_queries and nova epmatch answer, for the JS ports to reproduce exactly.

  python gen_tg_fixtures.py [out.json]      (default: web/tests/tg_cases.json)
No Kodi, no network."""
import importlib.util, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..')
sys.path.insert(0, os.path.join(SRC, 'plugin.video.telescope', 'resources'))
from lib import parser as P, matcher as M, sources as S  # noqa: E402

sys.path.insert(0, os.path.join(SRC, 'qa'))
import t_ptt  # noqa: E402


def load(name, *path):
    spec = importlib.util.spec_from_file_location(name, os.path.join(SRC, *path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


EP = load('epmatch', 'plugin.video.nova', 'resources', 'lib', 'epmatch.py')

NAMES = [n for n, _ in t_ptt.CASES] + [
    'The.Matrix.1999.1080p.BluRay.x264.mkv', 'The Matrix Reloaded (2003) 720p.mp4', 'Matrix.Resurrections.2021.2160p.HDR.WEB-DL.mkv',
    'Toy.Story.2.1999.1080p.mkv', 'Toy Story 1995 BDRip.avi', 'Rocky.IV.1985.720p.mkv', 'Dune.Part.Two.2024.HDCAM.mkv',
    'פאודה עונה 4 פרק 3 מתורגם.mp4', 'פאודה ע4 פ3.mkv', 'Fauda.S04E03.1080p.HEB.SUBS.mkv', 'הטבח 2023 מדובב.mp4',
    'Шерлок 2 сезон 3 серия.mkv', 'Шерлок.S02E03.RUS.mkv', 'Брат.1997.DVDRip.avi', 'Сериал 2021 1 серия.mp4',
    'Breaking Bad 2x05 720p HDTV.mkv', 'Breaking.Bad.S05E14.Ozymandias.1080p.WEB-DL.DD5.1.H.264.mkv',
    'Game.of.Thrones.S08.COMPLETE.2160p.mkv', 'Game of Thrones Season 8 Episode 6.mp4', 'Friends.S01E01-E02.mkv',
    '@moviechannel The.Batman.2022.1080p.WEBRip.x265.mkv', '[Tracker] Oppenheimer.2023.1080p.mkv', 'video_123.mp4',
    'Inception.2010.Trailer.mp4', 'Movie.Collection.rar', 'Avatar 2009 Extended 1080p Heb Dub.mkv',
    'Law & Order S20E01.mkv', 'Marvels.Agents.of.S.H.I.E.L.D.S01E01.mkv', '1917.2019.1080p.mkv', '2012 (2009) 720p.mkv',
    'Shogun.2024.S01E01.1920x1080.mkv', 'Чужой (1979) Режиссерская версия 1080p.mkv', 'The Office US S03E10 480p.mp4',
    'פרק 5 - הסדרה.mp4', 'Show.Ep05.mkv', 'מאחורי הקלעים 2020.mp4',
]
CAPTIONS = {
    'video_123.mp4': 'The Matrix (1999)\n1080p תרגום מובנה\n@channel',
    'Брат.1997.DVDRip.avi': 'Брат (1997) многоголосый перевод',
    'פאודה ע4 פ3.mkv': '🎬 פאודה עונה 4\nהועלה ע"י ציקו מדיה',
    'Avatar 2009 Extended 1080p Heb Dub.mkv': 'Trailer: https://youtu.be/x',
}
CHATS = {'Friends.S01E01-E02.mkv': 'Friends season 1', 'Show.Ep05.mkv': 'Show עונה 2'}

SIM = [('The Matrix', 'Matrix'), ('Toy Story 2', 'Toy Story'), ('Rocky IV', 'Rocky 4'), ('Dune Part Two', 'Dune: Part Two'),
       ('פאודה', 'פאודה'), ('Шерлок', 'Шерлок'), ('Agents of SHIELD', "Marvel's Agents of S.H.I.E.L.D."),
       ('Law and Order', 'Law & Order'), ('The Office', 'The Office US'), ('Batman', 'The Batman'), ('', 'x'),
       ('Breaking Bad Ozymandias', 'Breaking Bad'), ('Matrix Resurrections', 'The Matrix Resurrections'), ('ab', 'abc'),
       ('Lord of the Rings Fellowship', 'The Lord of the Rings: The Fellowship of the Ring')]

TARGETS = [
    dict(kind='movie', aliases=['The Matrix', 'מטריקס'], year=1999, runtime=136),
    dict(kind='movie', aliases=['Toy Story'], year=1995, runtime=81),
    dict(kind='movie', aliases=['Dune: Part Two'], year=2024, runtime=166),
    dict(kind='movie', aliases=['Брат'], year='1997', runtime=0),
    dict(kind='episode', aliases=['Fauda', 'פאודה'], season=4, episode=3, runtime=45, total_seasons=4),
    dict(kind='episode', aliases=['Breaking Bad'], season=5, episode=14, runtime=47, total_seasons=5),
    dict(kind='episode', aliases=['Friends'], season=1, episode=2, runtime=22, total_seasons=10),
    dict(kind='episode', aliases=['Sherlock', 'Шерлок'], season=2, episode=3, runtime=88, total_seasons=4),
    dict(kind='episode', aliases=['Show'], season=2, episode=5, runtime=0, total_seasons=3),
    dict(kind='episode', aliases=['Extras'], season=1, episode=1, runtime=30, total_seasons=1),
]
GB = 1024 ** 3


def main():
    out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(SRC, '..', 'web', 'tests', 'tg_cases.json'))
    cases = {'parse': [], 'normalize': [], 'sim': [], 'evaluate': [], 'lang': [], 'clean': [], 'plan': [], 'dedup': [],
             'ep': []}
    for n in NAMES:
        cap, chat = CAPTIONS.get(n, ''), CHATS.get(n, '')
        cases['parse'].append({'args': [n, cap, chat], 'out': P.parse(n, cap, chat)})
        cases['normalize'].append({'in': n, 'out': P.normalize(n)})
        cases['clean'].append({'in': n, 'out': M.clean_query(n)})
    for a, b in SIM:
        cases['sim'].append({'args': [a, b], 'out': M.title_similarity(a, b)})
    for i, n in enumerate(NAMES):
        for j, t in enumerate(TARGETS):
            for size, dur in ((2 * GB, 136 * 60), (700 * 1024 * 1024, 46 * 60), (10 * 1024 * 1024, 0), (GB + 7, 0)):
                if (i + j) % 3 and size != GB + 7:
                    continue
                cand = {'file': n, 'ext': P.split_name(n)[1], 'mime': '', 'size': size, 'duration': dur,
                        'caption': CAPTIONS.get(n, ''), 'chat_title': CHATS.get(n, ''),
                        'parsed': P.parse(n, CAPTIONS.get(n, ''), CHATS.get(n, ''))}
                for strict in (True, False):
                    v = M.evaluate(cand, t, strict)
                    cases['evaluate'].append({'cand': cand, 'target': t, 'strict': strict, 'out': list(v)})
    for langs in ([], ['he_sub'], ['he_text'], ['ru_audio'], ['ru_text'], ['en'], ['he_dub'], ['he_dub', 'en']):
        for pref in ('any', 'he', 'ru', 'en'):
            cases['lang'].append({'args': [langs, pref], 'out': M.language_bonus(langs, pref)})

    class F(object):
        s = {'max_aliases': 4, 'max_queries': 6}
    for t in TARGETS + [dict(kind='movie', aliases=['The Matrix', 'the matrix!', 'Матрица', 'מטריקס', 'A', 'B', 'C'])]:
        cases['plan'].append({'target': t, 'out': S.Finder.plan_queries(F(), t)})

    rows = [
        {'file': 'The.Matrix.1999.1080p.mkv', 'size': 2000000000, 'duration': 8160, 'backend': 'rd', 'score': 50},
        {'file': 'The Matrix 1999 1080p.mkv', 'size': 2010000000, 'duration': 8170, 'backend': 'tg', 'chat_id': 5, 'msg_id': 9, 'score': 40},
        {'file': 'the_matrix_1999_1080p.mp4', 'size': 1990000000, 'backend': 'tg', 'chat_id': 6, 'msg_id': 1, 'probe': 'ok', 'score': 30},
        {'file': 'The.Matrix.1999.1080p.mkv', 'size': 2100000000, 'backend': 'tg', 'chat_id': 7, 'msg_id': 2, 'score': 20},
        {'file': 'The.Matrix.1999.1080p.mkv', 'size': 2000000000, 'duration': 6000, 'backend': 'tg', 'chat_id': 8, 'msg_id': 3},
        {'file': 'short.mkv', 'size': 100, 'backend': 'tg', 'chat_id': 1, 'msg_id': 1},
        {'file': 'short.mkv', 'size': 100, 'backend': 'tg', 'chat_id': 1, 'msg_id': 2},
        {'file': 'פאודה.עונה.4.פרק.3.mp4', 'size': 500000000, 'backend': 'stremio', 'score': 10},
        {'file': 'פאודה עונה 4 פרק 3.mkv', 'size': 501000000, 'backend': 'rd', 'rd_cached': True, 'score': 12},
        {'file': 'NoSize.Movie.2020.mkv', 'size': 0, 'backend': 'tg', 'chat_id': 2, 'msg_id': 4},
        {'file': 'NoSize.Movie.2020.mkv', 'size': 0, 'backend': 'tg', 'chat_id': 2, 'msg_id': 5},
    ]
    import copy
    res, folded = S.Finder.union_dedup(copy.deepcopy(rows))
    cases['dedup'].append({'in': rows, 'out': res, 'folded': folded})

    texts = NAMES + ['S2E5', 'S02.E05', 's2 e5', '2x05', 'Season 2 Episode 5', 'Ep.05', 'E15', 'עונה 2 פרק 5', 'ע2 פ5',
                     'Сезон 2 Серия 5', '2 сезон 5 серия', 'серия 5', 'Серия 1 - 10', 'S02E05 - 720p', 'E05-E08', 'nothing 2024']
    for t in texts:
        cases['ep'].append({'f': 'parse', 'args': [t], 'out': list(EP.parse(t))})
    for want in ((2, 5), (None, 5), (2, None), (None, None), (4, 3)):
        for t in texts[-16:] + ['Fauda S04E03', 'פאודה ע4 פ3']:
            cases['ep'].append({'f': 'matches', 'args': [list(want), t, 'S04E03 inside'], 'out': EP.matches(want, t, 'S04E03 inside')})
    for show, t in (("Marvel's Agents of S.H.I.E.L.D.", 'Agents of SHIELD S01E01'), ('Law & Order', 'Law and Order S01E01'),
                    ('Fauda', 'fauda s1'), ('פאודה', 'פאודה עונה 1'), ('The Office', 'Office'), ('Breaking Bad', 'Bad Breaking 2'),
                    ('Game of Thrones Winter', 'Game Thrones Winter Is Coming'), ('', 'x')):
        cases['ep'].append({'f': 'mentions', 'args': [show, t, ''], 'out': EP.mentions(show, t, '')})
    for args in (('Fauda', 2, 5), ('פאודה', 2, 5), ('Шерлок', 2, None), ('Show', None, 3), ('Show', '', ''), ('', 1, 1)):
        cases['ep'].append({'f': 'query_for', 'args': list(args), 'out': EP.query_for(*args)})
    for args in (('Fauda S02E05', None, None), ('x', 3, 4), ('עונה 2', None, 7), ('', '', '')):
        cases['ep'].append({'f': 'wanted', 'args': list(args), 'out': list(EP.wanted(*args))})
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(cases, fh, ensure_ascii=False, indent=0, sort_keys=True)
    print('%s: %s' % (out, ', '.join('%s %d' % (k, len(v)) for k, v in sorted(cases.items()))))


if __name__ == '__main__':
    main()
