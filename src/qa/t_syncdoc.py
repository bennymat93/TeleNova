# -*- coding: utf-8 -*-
"""4.1.0: the merge rules of the continuous sync. Whatever two devices did, in whatever order the copies meet,
both end with the same document and nobody's change is lost. No Kodi, no network."""
import copy, importlib.util, io, itertools, os, random, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('syncdoc', os.path.join(HERE, '..', 'plugin.video.nova', 'resources', 'lib', 'syncdoc.py'))
sd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sd)
bad = []


def check(cond, what):
    if not cond:
        bad.append(what)


def H(key, ts, when='16/11/2026 18:00'):
    return {'key': key, 'ts': ts, 'when': when, 'label': key}


def F(kind, i, added):
    return {'kind': kind, 'id': i, 'label': '%s%s' % (kind, i), 'added': added}


# ---- users
A = [{'id': 'u1', 'name': 'Main', 'created': 100}, {'id': 'u2', 'name': 'Kids', 'created': 200, 'renamed': 250}]
B = [{'id': 'u1', 'name': 'Dad', 'created': 100, 'renamed': 300}, {'id': 'u2', 'name': 'Children', 'created': 200, 'renamed': 240, 'deleted': 400},
     {'id': 'u3', 'name': 'Guest', 'created': 150}]
m = sd.merge_users(A, B)
check([u['id'] for u in m] == ['u1', 'u3', 'u2'], 'union, ordered by creation: %r' % [u['id'] for u in m])
check(m[0]['name'] == 'Dad' and m[2]['name'] == 'Kids', 'the newer name wins')
check([u['id'] for u in sd.live_users(m)] == ['u1', 'u3'], 'a deleted user stays deleted')
check(sd.merge_users(B, A) == m, 'same result in the other order')

# ---- history
a = [H('m1', 300), H('m2', 100)]
b = [H('m1', 200), H('m3', 250)]
check([h['key'] for h in sd.merge_history(a, b)] == ['m1', 'm3', 'm2'] and sd.merge_history(a, b)[0]['ts'] == 300, 'later watch wins, newest first')
check([h['key'] for h in sd.merge_history(a, b, cleared=220)] == ['m1', 'm3'], 'entries older than a clear are gone')
check(len(sd.merge_history([H('k%d' % i, i + 1) for i in range(700)], [])) == sd.MAX_HISTORY, 'history is capped')

# ---- favourites with tombstones
fa = [F('movie', 1, '10/11/2026 10:00'), F('tv', 2, '11/11/2026 10:00')]
fb = [F('movie', 1, '10/11/2026 10:00'), F('movie', 3, '12/11/2026 09:00')]
rem = [{'kind': 'tv', 'id': 2, 'removed': '12/11/2026 08:00'}]
check([(f['kind'], f['id']) for f in sd.merge_favourites(fa, fb, rem)] == [('movie', 3), ('movie', 1)], 'a removed favourite stays removed')
readd = fa + [F('tv', 2, '13/11/2026 10:00')]
check(('tv', 2) in [(f['kind'], f['id']) for f in sd.merge_favourites(readd, fb, rem)], 'added again after the removal: it is back')

# ---- searches
sa = [{'q': 'Matrix', 'ts': 100}, {'q': 'fauda', 'ts': 300}]
sb = [{'q': 'matrix', 'ts': 400}, {'q': 'dune', 'ts': 50}]
check([s['q'] for s in sd.merge_searches(sa, sb)] == ['matrix', 'fauda', 'dune'], 'one entry per text, later use wins')
check([s['q'] for s in sd.merge_searches(sa, sb, cleared=200)] == ['matrix', 'fauda'], 'cleared searches stay gone')
check([s['q'] for s in sd.merge_searches(sa, sb, removed={'fauda': 350})] == ['matrix', 'dune'], 'a removed search stays gone')
check('fauda' in [s['q'] for s in sd.merge_searches(sa + [{'q': 'fauda', 'ts': 500}], sb, removed={'fauda': 350})], 'searched again later: back')

# ---- settings: last change wins, a new device never overrides
st = sd.stamp_changes
meta = st(None, {'tmdb_key': '', 'rd_token': ''}, 1000)
check(meta == {'tmdb_key': ['', 0], 'rd_token': ['', 0]}, 'first sight: time 0')
meta2 = st(meta, {'tmdb_key': 'K1', 'rd_token': ''}, 2000)
check(meta2['tmdb_key'] == ['K1', 2000] and meta2['rd_token'] == ['', 0], 'a change on this device is stamped')
check(st(meta2, {'tmdb_key': 'K1', 'rd_token': ''}, 3000) == meta2, 'no change, no new stamp')
check(st(meta2, {'tmdb_key': 'K1', 'rd_token': '', 'os_key': 'O'}, 3000)['os_key'] == ['O', 3000], 'a setting that appears later is a change')
new_device = st(None, {'tmdb_key': '', 'gemini_key': ''}, 5000)
configured = {'tmdb_key': ['K1', 2000], 'gemini_key': ['G', 1500]}
ms = sd.merge_stamped(new_device, configured)
check(ms['tmdb_key'] == ['K1', 2000] and ms['gemini_key'] == ['G', 1500], 'a fresh device takes the account\'s values, although it is "newer"')
check(sd.changed_settings({'nova': ms}, {'nova': {'tmdb_key': '', 'gemini_key': ''}}) == {'nova': {'tmdb_key': 'K1', 'gemini_key': 'G'}}, 'what to write here')
check(sd.changed_settings({'nova': new_device}, {'nova': {'tmdb_key': 'x'}}) == {}, 'never-changed values are not written anywhere')
check(sd.merge_stamped({'k': ['a', 5]}, {'k': ['b', 5]}) == sd.merge_stamped({'k': ['b', 5]}, {'k': ['a', 5]}), 'equal times: both pick the same')
check(sd.merge_stamped({'k': 'garbage'}, {'k': ['v', 1]}) == {'k': ['v', 1.0]}, 'a damaged entry is ignored')

# ---- the whole document: two devices, changes on both, any order, any number of rounds
def doc(users, data, settings, files):
    return {'v': 2, 'users': users, 'data': data, 'settings': settings, 'files': files}


d1 = doc([{'id': 'u1', 'name': 'Main', 'created': 1}], {'u1': {'history': [H('a', 10), H('b', 30)], 'favourites': [F('movie', 1, '01/11/2026 10:00')],
                                                           'searches': [{'q': 'x', 'ts': 5}]}},
         {'nova': {'tmdb_key': ['K', 50]}, 'tele': {'rd_enabled': ['true', 0]}}, {'iptv.json': [{'m3u': ['a']}, 40]})
d2 = doc([{'id': 'u1', 'name': 'Main', 'created': 1}, {'id': 'u2', 'name': 'Kids', 'created': 60}],
         {'u1': {'history': [H('b', 20), H('c', 25)], 'removed': [{'kind': 'movie', 'id': 1, 'removed': '02/11/2026 10:00'}]},
          'u2': {'favourites': [F('tv', 9, '05/11/2026 10:00')]}},
         {'nova': {'tmdb_key': ['K2', 45], 'gemini_key': ['G', 70]}}, {'iptv.json': [{'m3u': ['b']}, 80]})
m12, m21 = sd.merge(d1, d2), sd.merge(d2, d1)
check(sd.same(m12, m21), 'merge is the same in both orders')
check(sd.same(sd.merge(m12, d1), m12) and sd.same(sd.merge(m12, d2), m12) and sd.same(sd.merge(m12, m12), m12), 'merging again changes nothing')
check([h['key'] for h in m12['data']['u1']['history']] == ['b', 'c', 'a'], 'history of both devices')
check(m12['data']['u1']['favourites'] == [] and m12['data']['u2']['favourites'][0]['id'] == 9, 'removal travels; the new user arrives with content')
check(m12['settings']['nova'] == {'tmdb_key': ['K', 50.0], 'gemini_key': ['G', 70.0]} and m12['files']['iptv.json'][0] == {'m3u': ['b']}, 'settings and files: last change wins')
d3 = copy.deepcopy(m12)
d3['users'][1]['deleted'] = 99
m3 = sd.merge(m12, d3)
check('u2' not in m3['data'] and sd.same(sd.merge(d2, m3), m3), 'a deleted user: content gone and it does not come back from an old copy')
check(sd.same(sd.merge(None, d1), sd.merge(d1, sd.empty())) and sd.same(sd.merge(None, None), sd.empty()), 'nothing in the account yet')
check(not sd.same(d1, d2) and sd.same(d1, dict(d1, device='x', stamp=5)), 'who wrote a copy does not count as a difference')

# ---- many random devices always converge
rnd = random.Random(7)


def rand_doc(n):
    hist = [H('t%d' % rnd.randint(1, 12), rnd.randint(1, 500)) for _ in range(rnd.randint(0, 8))]
    favs = [F('movie', rnd.randint(1, 6), '%02d/11/2026 10:00' % rnd.randint(1, 28)) for _ in range(rnd.randint(0, 5))]
    rem = [{'kind': 'movie', 'id': rnd.randint(1, 6), 'removed': '%02d/11/2026 09:00' % rnd.randint(1, 28)} for _ in range(rnd.randint(0, 3))]
    srch = [{'q': 'q%d' % rnd.randint(1, 8), 'ts': rnd.randint(1, 500)} for _ in range(rnd.randint(0, 6))]
    marks = {'history_cleared': rnd.choice([0, 0, 0, rnd.randint(1, 300)]), 'searches_cleared': rnd.choice([0, 0, rnd.randint(1, 300)]),
             'searches_removed': dict(('q%d' % rnd.randint(1, 8), rnd.randint(1, 500)) for _ in range(rnd.randint(0, 2)))}
    users = [{'id': 'u1', 'name': 'n%d' % n, 'created': 1, 'renamed': rnd.randint(0, 50)}]
    if rnd.random() < 0.5:
        users.append({'id': 'u2', 'name': 'k', 'created': 5, 'deleted': rnd.choice([0, 0, 77])})
    sett = {'nova': dict(('k%d' % i, [rnd.choice(['a', 'b', 'c', '']), rnd.choice([0, rnd.randint(1, 9)])]) for i in range(4))}
    return doc(users, {'u1': {'history': hist, 'favourites': favs, 'removed': rem, 'searches': srch, 'marks': marks},
                       'u2': {'history': [H('z', rnd.randint(1, 9))]}}, sett, {'iptv.json': [{'n': rnd.randint(1, 3)}, rnd.randint(0, 9)]})


for round_ in range(60):
    docs = [rand_doc(i) for i in range(4)]
    results = []
    for order in itertools.permutations(range(4)):
        cur = None
        for i in order:
            cur = sd.merge(cur, docs[i])
        results.append(sd.canon(cur))
    if len(set(results)) != 1:
        bad.append('round %d: the result depends on the order of the merges (%d different results)' % (round_, len(set(results))))
        break
    final = sd.merge(sd.merge(docs[0], docs[1]), sd.merge(docs[2], docs[3]))
    if sd.canon(final) != results[0]:
        bad.append('round %d: merging in pairs gives another result' % round_)
        break

# ---- resume points ride on the history entry (web 5.x): the newer point wins and travels with the entry
hist = [H('movie:1', 100), H('tv:2:1:3', 200), {'key': 'x'}]
pts = {'movie:1': {'t': 600, 'd': 5400, 'at': 150500}, 'tv:2:1:3': {'t': 90, 'd': 0, 'at': 150000}, 'nokey': {'t': 5, 'at': 9e9}}
hp = sd.with_progress(hist, pts)
check(hp[0]['progress'] == {'t': 600, 'd': 5400} and hp[0]['ts'] == 150, 'a newer resume point is folded into its entry')
check('progress' not in hp[1] and hp[1]['ts'] == 200, 'an older resume point never overwrites a later watch')
check('progress' not in hist[0], 'with_progress does not change its input')
check(sd.with_progress(hp, pts) == hp, 'folding the same points again changes nothing')
check(sd.progress_points(hp) == {'movie:1': {'t': 600, 'd': 5400, 'at': 150000}}, 'progress_points reads them back')
check(sd.with_progress(hp, sd.progress_points(hp)) == hp, 'points read back from the document are not newer than it')
check(sd.progress_of({'progress': {'t': True}}) is None and sd.progress_of({'progress': {'t': 0}}) is None, 'no point')
m = dict((h['key'], h) for h in sd.merge_history([H('movie:1', 120)], hp))
check(m['movie:1'].get('progress') == {'t': 600, 'd': 5400}, 'the point wins the merge with its time')


for b in bad:
    print('FAIL', b)
print('SYNCDOC TESTS OK' if not bad else 'SYNCDOC TESTS: %d problems' % len(bad))
sys.exit(1 if bad else 0)
