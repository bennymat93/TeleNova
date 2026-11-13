# -*- coding: utf-8 -*-
"""opensubs.py without Kodi and without the network: python t_opensubs.py"""
import os
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.telescope',
                                'resources', 'lib'))
import opensubs                                                        # noqa: E402
from opensubs import OpenSubs, moviehash, imdb_id                      # noqa: E402

KEY = 'OSSECRETKEY1234567890abcdefXYZ'
FAILS = []


def ok(cond, what):
    if not cond:
        FAILS.append(what)
        print('FAIL: ' + what)


def raises(fn, what):
    try:
        fn()
    except ValueError:
        return
    ok(False, what)


# ================================================================== moviehash
B = 65536
# 1. a synthetic file, the expected value computed here independently (word by word, with struct)
head = bytes(bytearray((i * 7 + 3) % 256 for i in range(B)))
tail = bytes(bytearray((i * 13 + 250) % 256 for i in range(B)))
size = 734003200
expect = size
for block in (head, tail):
    for off in range(0, B, 8):
        expect = (expect + struct.unpack_from('<Q', block, off)[0]) & 0xFFFFFFFFFFFFFFFF
ok(moviehash(size, head, tail) == '%016x' % expect, 'synthetic buffer')
ok(len(moviehash(size, head, tail)) == 16, '16 hex digits')
ok(moviehash(size, bytearray(head), memoryview(tail)) == '%016x' % expect, 'bytearray / memoryview accepted')
# 2. overflow wraps at 64 bits and the result keeps its leading zeros
ff = b'\xff' * B
ok(moviehash(2 * B, ff, ff) == '%016x' % ((2 * B + 2 * 8192 * 0xFFFFFFFFFFFFFFFF) & 0xFFFFFFFFFFFFFFFF), 'wraps at 2^64')
zero = b'\x00' * B
ok(moviehash(12909756, zero, zero) == '0000000000c4fcbc', 'zero blocks -> the size, zero padded')
# 3. the published vector (breakdance.avi, 12 909 756 bytes -> 8e245d9679d31e12). The file is not here, so this only
#    proves the arithmetic: blocks whose words sum to (hash - size) must give exactly the published hash.
need = (0x8e245d9679d31e12 - 12909756) & 0xFFFFFFFFFFFFFFFF
a = 0x1122334455667788
h2 = struct.pack('<Q', a) + zero[8:]
t2 = zero[:-8] + struct.pack('<Q', (need - a) & 0xFFFFFFFFFFFFFFFF)
ok(moviehash(12909756, h2, t2) == '8e245d9679d31e12', 'published vector arithmetic')
# 4. byte order: little-endian words
ok(moviehash(2 * B, b'\x01' + zero[1:], zero) == '%016x' % (2 * B + 1), 'little endian (low byte first)')
ok(moviehash(2 * B, zero[:7] + b'\x01' + zero[8:], zero) == '%016x' % (2 * B + (1 << 56)), 'little endian (high byte)')
# 5. short input
raises(lambda: moviehash(131071, zero, zero), 'size < 131072 must raise')
raises(lambda: moviehash(size, zero[:-1], zero), 'short head must raise')
raises(lambda: moviehash(size, zero, zero[:100]), 'short tail must raise')
raises(lambda: moviehash(size, zero, None), 'missing tail must raise')
ok(moviehash(131072, zero, zero) == '%016x' % 131072, 'the smallest file allowed')

# ================================================================== imdb ids
ok(imdb_id(111161) == 'tt0111161', 'integer -> tt + 7 digits')
ok(imdb_id(558705) == 'tt0558705', 'six digits padded')
ok(imdb_id(10872600) == 'tt10872600', 'eight digits kept')
ok(imdb_id('tt0111161') == 'tt0111161' and imdb_id('0111161') == 'tt0111161', 'strings')
ok(imdb_id(None) == '' and imdb_id(0) == '' and imdb_id('') == '', 'nothing -> empty')


# ================================================================== the API
class Resp(object):
    def __init__(self, status=200, payload=None, headers=None):
        self.status_code, self.payload, self.headers = status, payload, headers or {}

    def json(self):
        if self.payload is None:
            raise ValueError('no json')
        return self.payload


class Http(object):
    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append({'url': url, 'params': list(params or []), 'headers': dict(headers or {}),
                           'timeout': timeout})
        r = self.answer(url, dict(params or {}), dict(headers or {}))
        if isinstance(r, Exception):
            raise r
        return r


def sub(lang, match, fd):
    """one entry shaped as GET /subtitles returns it (the OpenAPI example + the moviehash_match field)"""
    return {'id': '8520224', 'type': 'subtitle', 'attributes': {
        'subtitle_id': '8520224', 'language': lang, 'download_count': 147, 'hearing_impaired': False, 'hd': False,
        'fps': 23.976, 'votes': 0, 'ratings': 0, 'from_trusted': False, 'foreign_parts_only': False,
        'upload_date': '2024-06-26T07:02:57Z', 'ai_translated': False, 'machine_translated': False,
        'release': 'x', 'moviehash_match': match, 'feature_details': fd,
        'uploader': {'uploader_id': None, 'name': 'Anonymous', 'rank': 'anonymous'},
        'files': [{'file_id': 9443515, 'cd_number': 1, 'file_name': 'x'}]}}


def page(data, pages=1):
    return {'total_pages': pages, 'total_count': len(data), 'per_page': 50, 'page': 1, 'data': data}


MOVIE = {'feature_id': 514811, 'feature_type': 'Movie', 'year': 1994, 'title': 'The Shawshank Redemption',
         'movie_name': '1994 - The Shawshank Redemption', 'imdb_id': 111161, 'tmdb_id': 278}
EPISODE = {'feature_id': 805, 'feature_type': 'Episode', 'year': 2004, 'title': 'Come In, Stranger',
           'movie_name': 'Desperate Housewives - S01E05  Come In, Stranger', 'imdb_id': 558705, 'tmdb_id': 38366,
           'season_number': 1, 'episode_number': 5, 'parent_imdb_id': 410975, 'parent_title': 'Desperate Housewives',
           'parent_tmdb_id': 693, 'parent_feature_id': 107}
OTHER = {'feature_id': 1, 'feature_type': 'Movie', 'year': 2001, 'title': 'Wrong', 'imdb_id': 999999}
MH = '8e245d9679d31e12'


def make(answer, key=KEY):
    logs = []
    http = Http(answer)
    return OpenSubs(lambda: key, logs.append, http=http), http, logs


# ---- enabled
ok(make(None)[0].enabled and not make(None, key='')[0].enabled and not make(None, key='  ')[0].enabled, 'enabled')
os_, http, logs = make(lambda u, p, h: Resp(200, page([])), key='')
ok(os_.identify(MH) is None and http.calls == [], 'no key -> no request')

# ---- a movie with a Hebrew subtitle: one request, the right headers
os_, http, logs = make(lambda u, p, h: Resp(200, page([sub('en', True, MOVIE), sub('he', True, MOVIE)])))
res = os_.identify(MH.upper(), size=12909756)
ok(res == {'imdb': 'tt0111161', 'season': None, 'episode': None, 'title': 'The Shawshank Redemption', 'year': 1994,
           'hebrew': True, 'episode_imdb': ''}, 'movie identified: %r' % res)
ok(len(http.calls) == 1, 'one request')
c = http.calls[0]
ok(c['url'] == 'https://api.opensubtitles.com/api/v1/subtitles', 'URL: %s' % c['url'])
ok(c['params'] == [('moviehash', MH), ('moviehash_match', 'only')], 'params sorted, lower case: %r' % c['params'])
ok(c['headers'].get('Api-Key') == KEY, 'Api-Key header')
ok(c['headers'].get('User-Agent') == 'TeleNova v4.0', 'User-Agent header')
ok(KEY not in c['url'] and KEY not in str(c['params']), 'key only in the header')
ok(c['timeout'] == 8 and logs == [], 'timeout, no log on success')

# ---- an episode: the show's id, season, episode, the show's title; no Hebrew
os_, http, logs = make(lambda u, p, h: Resp(200, page([sub('fr', True, EPISODE), sub('en', True, EPISODE)])))
res = os_.identify(MH)
ok(res == {'imdb': 'tt0410975', 'season': 1, 'episode': 5, 'title': 'Desperate Housewives', 'year': 2004,
           'hebrew': False, 'episode_imdb': 'tt0558705'}, 'episode identified: %r' % res)
ok(len(http.calls) == 1, 'a single page -> no second request')

# ---- only moviehash_match true counts
os_, http, logs = make(lambda u, p, h: Resp(200, page([sub('he', False, OTHER), sub('en', False, OTHER)])))
ok(os_.identify(MH) is None, 'no hash match -> None')
os_, http, logs = make(lambda u, p, h: Resp(200, page([sub('he', False, OTHER), sub('en', True, MOVIE)])))
res = os_.identify(MH)
ok(res and res['imdb'] == 'tt0111161' and res['hebrew'] is False, 'unmatched entries (and their Hebrew) ignored')
entry = sub('en', True, MOVIE)
del entry['attributes']['moviehash_match']
ok(make(lambda u, p, h: Resp(200, page([entry])))[0].identify(MH) is None, 'a missing moviehash_match is not trusted')
os_, http, logs = make(lambda u, p, h: Resp(200, page([sub('en', True, OTHER), sub('en', True, MOVIE),
                                                       sub('pt', True, MOVIE)])))
ok(os_.identify(MH)['imdb'] == 'tt0111161', 'the feature most matches agree on wins')
ok(make(lambda u, p, h: Resp(200, page([])))[0].identify(MH) is None, 'empty -> None')
ok(make(lambda u, p, h: Resp(200, page([sub('en', True, {'feature_type': 'Movie', 'title': 'x'})])))[0]
   .identify(MH) is None, 'no imdb id -> None')
os_, http, logs = make(lambda u, p, h: Resp(200, page([])))
ok(os_.identify('nothex') is None and os_.identify('') is None and os_.identify(None) is None and http.calls == [],
   'a bad hash sends nothing')


# ---- more pages and no Hebrew on the first: one second request for Hebrew alone
def paged(url, params, headers):
    if params.get('languages') == 'he':
        return Resp(200, page([sub('he', True, MOVIE)]))
    return Resp(200, page([sub('en', True, MOVIE)] * 50, pages=3))


os_, http, logs = make(paged)
res = os_.identify(MH)
ok(res['hebrew'] is True and len(http.calls) == 2, 'Hebrew found by the second request')
ok(http.calls[1]['params'] == [('languages', 'he'), ('moviehash', MH), ('moviehash_match', 'only')],
   'second request params sorted: %r' % http.calls[1]['params'])
os_, http, logs = make(lambda u, p, h: Resp(200, page([] if p.get('languages') else [sub('en', True, MOVIE)], 2)))
ok(os_.identify(MH)['hebrew'] is False and len(http.calls) == 2, 'second request without Hebrew -> False')


# ---- errors -> None, one short line, never the key
class Boom(Exception):
    def __str__(self):
        return 'GET /subtitles with Api-Key %s failed' % KEY


for name, answer in (('network', lambda u, p, h: Boom()),
                     ('401', lambda u, p, h: Resp(401, {'message': 'No API key found in request ' + KEY})),
                     ('403', lambda u, p, h: Resp(403, {'message': 'You cannot consume this service'})),
                     ('500', lambda u, p, h: Resp(500, None)),
                     ('not json', lambda u, p, h: Resp(200, None)),
                     ('429', lambda u, p, h: Resp(429, {'message': 'API rate limit exceeded'}))):
    os_, http, logs = make(answer)
    ok(os_.identify(MH) is None, '%s -> None' % name)
    ok(len(logs) == 1 and logs[0].startswith('opensubs: ') and len(logs[0]) < 80, '%s: one short line: %r' % (name, logs))
    ok(KEY not in '\n'.join(logs), '%s: the key is not logged' % name)

# ---- a refused key is not tried again until it changes
key = [KEY]
logs = []
http = Http(lambda u, p, h: Resp(403, None) if h['Api-Key'] == KEY else Resp(200, page([sub('he', True, MOVIE)])))
os_ = OpenSubs(lambda: key[0], logs.append, http=http)
os_.identify(MH)
os_.identify(MH)
ok(len(http.calls) == 1 and len(logs) == 1, 'refused key: one request, one line')
key[0] = 'ANOTHERKEY0000000000'
ok(os_.identify(MH) is not None and len(http.calls) == 2, 'a new key is tried')

# ---- 429: quiet for Retry-After, else 60 s
clock = [5000.0]
state = {'limit': True, 'headers': {'Retry-After': '7'}}
os_, http, logs = make(lambda u, p, h: Resp(429, None, state['headers']) if state['limit']
                       else Resp(200, page([sub('en', True, MOVIE)])))
os_._now = lambda: clock[0]
ok(os_.identify(MH) is None and len(http.calls) == 1, '429 -> None')
state['limit'] = False
clock[0] += 6
ok(os_.identify(MH) is None and len(http.calls) == 1, 'quiet during Retry-After')
clock[0] += 2
ok(os_.identify(MH) is not None and len(http.calls) == 2, 'asks again after Retry-After')
state.update(limit=True, headers={})
os_.identify(MH)
state['limit'] = False
clock[0] += 59
ok(os_.identify(MH) is None and len(http.calls) == 3, 'no Retry-After: quiet for 60 s')
clock[0] += 2
ok(os_.identify(MH) is not None and len(http.calls) == 4, 'asks again after 60 s')
ok(len(logs) == 2 and '7 s' in logs[0] and '60 s' in logs[1], 'one line per rate limit: %r' % logs)

# ---- check_key
ok(make(None, key='')[0].check_key() == (None, 'no key'), 'check_key without a key')
os_, http, logs = make(lambda u, p, h: Resp(200, page([])))
ok(os_.check_key() == (True, 'ok'), 'check_key valid')
ok(http.calls[0]['url'].endswith('/api/v1/subtitles') and http.calls[0]['headers']['Api-Key'] == KEY,
   'check_key uses an endpoint that needs the key')
os_, http, logs = make(lambda u, p, h: Resp(403, {'message': 'You cannot consume this service'}))
ok(os_.check_key() == (False, 'key refused (403)'), 'check_key invalid (403)')
ok(os_.check_key()[0] is False and len(http.calls) == 2, 'check_key always asks again')
ok(make(lambda u, p, h: Resp(401, None))[0].check_key()[0] is False, 'check_key invalid (401)')
ok(make(lambda u, p, h: Boom())[0].check_key() == (None, 'network'), 'check_key network error is not "invalid"')
ok(make(lambda u, p, h: Resp(429, None))[0].check_key() == (None, 'rate limit'), 'check_key rate limit')
os_, http, logs = make(lambda u, p, h: Boom())
os_.check_key()
ok(KEY not in '\n'.join(logs) and KEY not in str(os_.check_key()), 'check_key never shows the key')
ok(opensubs.API == 'https://api.opensubtitles.com/api/v1', 'API base')

if FAILS:
    print('%d FAILED' % len(FAILS))
    sys.exit(1)
print('OPENSUBS TESTS OK')
