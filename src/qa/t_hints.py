# -*- coding: utf-8 -*-
"""4.0.5: Hebrew helpers (Wikidata names, Wizdom synced-subtitle signal) and Real-Debrid's memory of links that
cannot be played. No Kodi, no network (answers shaped like the real ones, read live on 13/11/2026)."""
import io, json, os, sys, tempfile, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'plugin.video.telescope'))
from resources.lib import hints, realdebrid  # noqa: E402

bad = []


def check(cond, what):
    if not cond:
        bad.append(what)


class R(object):
    def __init__(self, data, status=200):
        self.status_code, self._d = status, data

    def json(self):
        return self._d


class Http(object):
    def __init__(self, data, status=200):
        self.data, self.status, self.calls = data, status, []

    def get(self, url, params=None, timeout=None, headers=None):
        self.calls.append((url, params, headers))
        return R(self.data, self.status)


# ---- Wikidata
wd = {'head': {'vars': ['heLabel', 'heAlt']}, 'results': {'bindings': [
    {'heLabel': {'xml:lang': 'he', 'type': 'literal', 'value': u'שובר שורות'}, 'heAlt': {'value': u'ברייקינג בד'}},
    {'heLabel': {'value': u'שובר שורות'}, 'heAlt': {'value': 'Breaking Bad'}},
    {'heLabel': {'value': u'שובר שורות'}, 'heAlt': {'value': u'סדרת טלוויזיה אמריקאית על מורה לכימיה שהופך לסוחר סמים ומסתבך עם קרטל'}}]}}
h = Http(wd)
names = hints.wikidata_he('tt0903747', h)
check(names == [u'שובר שורות', u'ברייקינג בד'], 'label first, variants after, no Latin, no sentences: %r' % names)
check('tt0903747' in h.calls[0][1]['query'] and 'User-Agent' in h.calls[0][2], 'query carries the id and a User-Agent')
check(hints.wikidata_he('tt0903747"} UNION {', Http(wd)) == [] and hints.wikidata_he('', Http(wd)) == [],
      'only a real IMDb id ever reaches the query')
check(hints.wikidata_he('tt0000001', Http({'results': {'bindings': []}})) == [], 'unknown title')
try:
    hints.wikidata_he('tt0903747', Http({}, 429))
    check(False, 'HTTP error must raise (so the empty answer is not cached)')
except IOError:
    pass

# ---- Wizdom
wz = [{'id': 3235, 'versioname': 'Breaking.Bad.S01E01.1080p.BluRay.X264-REWARD', 'score': 0},
      {'id': 66761, 'versioname': 'Breaking.Bad.S01E01.720p.BluRay.DD5.1.x264-CtrlHD', 'score': 0},
      {'id': 1, 'versioname': 'Breaking.Bad.S01E01.HDTV.XviD-FQM', 'score': 0}, {'id': 2}]
h = Http(wz)
vers = hints.wizdom_versions('tt0903747', 1, 1, h)
check(len(vers) == 3 and h.calls[0][1] == {'action': 'by_id', 'imdb': 'tt0903747', 'season': 1, 'episode': 1}, 'episode query')
h = Http(wz)
hints.wizdom_versions('tt0111161', None, None, h)
check(h.calls[0][1] == {'action': 'by_id', 'imdb': 'tt0111161'}, 'film query has no season / episode')
check(hints.wizdom_versions('tt0111161', http=Http({'error': 'x'})) == [], 'an answer that is not a list')
K = hints.release_key
check(K('Breaking.Bad.S01E01.1080p.BluRay.X264-REWARD.mkv') == ('reward', 'bluray', 1080), 'release key: %r' % (K('Breaking.Bad.S01E01.1080p.BluRay.X264-REWARD.mkv'),))
check(K('Show.S01E01.720p.WEB-DL.DDP5.1.H.264-NTb') == ('ntb', 'webdl', 720), 'web-dl: %r' % (K('Show.S01E01.720p.WEB-DL.DDP5.1.H.264-NTb'),))
check(K('Movie.2019.1080p.BluRay.x264')[0] == '' and K('Movie 2019 720p HDTV x264-x265')[0] == '', 'a codec is not a group')
S = hints.synced
check(S('breaking.bad.s01e01.1080p.bluray.x264-reward.mkv', vers) == 'exact', 'same release')
check(S('Breaking.Bad.S01E01.2160p.BluRay.HEVC-REWARD.mkv', vers) == 'group', 'same group and source, other quality')
check(S('Breaking.Bad.S01E01.1080p.WEB-DL.x264-REWARD.mkv', vers) == '', 'same group, another source: timing differs')
check(S('Breaking.Bad.S01E01.1080p.BluRay.x264-OTHER.mkv', vers) == '', 'another group')
check(S('The Shawshank Redemption (1994).mp4', ['The.Shawshank.Redemption.1994']) == '', 'a bare title is no release')
check(S('Breaking Bad S01E01.mkv', vers) == '' and S('', vers) == '' and S('x-REWARD.mkv', []) == '', 'nothing to compare')

# ---- Real-Debrid: links that cannot be played
tmp = tempfile.mkdtemp(prefix='tn_rd_')
dead_file = os.path.join(tmp, 'rd_dead.json')
logs = []
rd = realdebrid.RealDebrid({'rd_token': 'SECRET-TOKEN', 'rd_dead_file': dead_file}, lambda k, v: None, logs.append)
D = realdebrid.RealDebrid.dead_for
check(D('rd unrestrict: infringing_file') == rd.DEAD_REFUSED, 'a refused file is remembered for a month')
check(D('not cached at Real-Debrid') == rd.DEAD_GONE and D('link refused (404)') == rd.DEAD_GONE, 'gone: 6 hours')
check(D('network: ConnectTimeout') == 0 and D('bad_token') == 0 and D('not_premium') == 0 and D('not_logged_in') == 0,
      'a network / login failure says nothing about the link')
a = {'url': 'https://torrentio.example/resolve/realdebrid/SECRET-TOKEN/abc/1/x.mkv', 'doc_id': 'rd:abc:1'}
b = {'rd': {'hash': 'DEF', 'idx': 2}, 'doc_id': 'rd:DEF:2'}
c = {'rd': {'torrent': 'T9'}, 'doc_id': 'rdc:T9'}
keys = [rd.link_key(x) for x in (a, b, c)]
check(len(set(keys)) == 3 and all(len(k) == 20 for k in keys), 'three links, three names')
check(rd.link_key({'rd': {'hash': 'def', 'idx': 2}}) == keys[1], 'the name does not depend on letter case / extra fields')
check(rd.link_key({}) == '', 'nothing to name')


def boom(msg):
    def f(cand, want=None, wait=8.0):
        raise realdebrid.RDError(msg)
    return f


rd._resolve = boom('rd unrestrict: infringing_file')
try:
    rd.resolve(a)
    check(False, 'the error must still reach the caller (it tries the next source)')
except realdebrid.RDError:
    pass
rd._resolve = boom('network: ReadTimeout')
try:
    rd.resolve(b)
except realdebrid.RDError:
    pass
check(rd.alive([a, b, c]) == [b, c], 'refused link left out, the one that only timed out stays')
text = io.open(dead_file, encoding='utf-8').read()
check('SECRET-TOKEN' not in text and 'torrentio' not in text, 'the file holds no link and no key')
check(not any('SECRET-TOKEN' in line for line in logs), 'no key in the log')
rd2 = realdebrid.RealDebrid({'rd_token': 'T', 'rd_dead_file': dead_file}, lambda k, v: None, logs.append)
check(rd2.alive([a, b]) == [b], 'remembered after a restart')
stored = json.load(io.open(dead_file, encoding='utf-8'))
stored[keys[0]][0] = int(time.time()) - 5
json.dump(stored, io.open(dead_file, 'w', encoding='utf-8'))
rd3 = realdebrid.RealDebrid({'rd_token': 'T', 'rd_dead_file': dead_file}, lambda k, v: None, logs.append)
check(rd3.alive([a, b]) == [a, b], 'offered again when the time is over')
io.open(dead_file, 'w', encoding='utf-8').write(u'not json')
rd4 = realdebrid.RealDebrid({'rd_token': 'T', 'rd_dead_file': dead_file}, lambda k, v: None, logs.append)
check(rd4.alive([a]) == [a], 'a damaged file never hides links')
rd5 = realdebrid.RealDebrid({'rd_token': 'T'}, lambda k, v: None, logs.append)
rd5.mark_dead('k', 'x', 60)
check(rd5.is_dead('k'), 'works in memory without a file')

for b_ in bad:
    print('FAIL', b_)
print('HINTS TESTS OK' if not bad else 'HINTS TESTS: %d problems' % len(bad))
import shutil
shutil.rmtree(tmp, ignore_errors=True)
sys.exit(1 if bad else 0)
