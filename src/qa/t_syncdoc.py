# -*- coding: utf-8 -*-
"""4.1.0: the merge rules of the continuous sync. Whatever two devices did, in whatever order the copies meet,
both end with the same document and nobody's change is lost. No Kodi, no network."""
import copy, importlib.util, io, itertools, json, os, random, shutil, subprocess, sys

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


# ---- 6.3.0 (B3): a part this code does not know passes through, 'v' is the highest seen
d1x = dict(d1, future={'x': 1}, v=2)
d2x = dict(d2, future={'x': 2}, other=[1], v=3)
mx = sd.merge(d1x, d2x)
check(mx['future'] == {'x': 2} and mx['other'] == [1] and mx['v'] == 3, 'B3: unknown parts pass, the larger copy wins, v = max: %r' % {k: mx.get(k) for k in ('future', 'other', 'v')})
check(sd.canon(sd.merge(d1x, d2x)) == sd.canon(sd.merge(d2x, d1x)), 'B3: still independent of the order')
check(not sd.same(d1, dict(d1, future={'x': 1})) and sd.same(d1, dict(d1, devices={'k': {'sv': 3}})), 'B3: an unknown part is content, the device list is not')
# ---- 6.3.0 (B6): stamps are whole seconds
check(sd.merge_stamped({'k': ['a', 5.7]}, {}) == {'k': ['a', 5]} and sd.merge_stamped({'k': ['a', 5.7]}, {'k': ['b', 5]}) == {'k': ['b', 5]},
      'B6: a float stamp is floored (and then compared)')
check(sd.stamp('7.9') == 7 and sd.stamp(None) == 0 and sd.stamp(float('nan')) == 0 and sd.stamp([1]) == 0 and sd.stamp(-0.5) == -1, 'B6: stamp()')
# ---- 6.3.0: devices
dv = sd.merge({'devices': {'a': {'sv': 3, 'at': 5, 'kind': 'kodi'}}}, {'devices': {'a': {'sv': 2, 'at': 4}, 'b': {'sv': 3, 'at': 1}}})
check(dv['devices'] == {'a': {'sv': 3, 'at': 5, 'kind': 'kodi'}, 'b': {'sv': 3, 'at': 1}} and sd.capable(dv), 'devices: the later entry wins; capable')
check(not sd.capable({'devices': {'a': {'sv': 3}, 'b': {'sv': 2}}}) and not sd.capable({}) and not sd.capable({'devices': {}}), 'capable: every device listed, at least one')

# ---- 6.3.0 (P1): keyed lists
PINS = [s for s in sd.KEYED if s[0] == 'pins'][0]
IPTV = [s for s in sd.KEYED if s[0] == 'iptv'][0]
TELE = sd.TELE


def kdoc(flat, ts, keyed=None, devs=True):
    d = {'settings': {TELE: {'pinned_chats': [flat, ts]}}}
    if keyed is not None:
        d['keyed'] = {'pins': keyed}
    if devs:
        d['devices'] = {'x': {'sv': 3, 'at': 1}}
    return d


check(sd.items_of(PINS, ' @A, b ,a,\n-100123') == [['a', '@A'], ['b', 'b'], ['-100123', '-100123']], 'items of a comma list (one key each)')
check(sd.keyed_ops(PINS, [['a', 'a'], ['b', 'b']], 'a,c', 10) == {'c': ['c', 10], 'b': [None, 10]}, 'ops: added and removed since last held')
check(sd.keyed_ops(PINS, None, 'a', 10) == {}, 'no ops before the device held the list once (the join rule)')
# two devices change the list at the same time: A adds x (time 100), B removes b (time 101, its plain value wins)
base = {'a': ['a', 10], 'b': ['b', 10]}
A = kdoc('a,b,x', 100, dict(base, x=['x', 100]))
B = kdoc('a', 101, dict(base, b=[None, 101]))
for m in (sd.merge(A, B), sd.merge(B, A)):
    sd.settle(m, PINS)
    check(m['settings'][TELE]['pinned_chats'] == ['a,x', 101], 'keyed: both changes survive: %r' % m['settings'][TELE]['pinned_chats'])
# an older device (no keyed list) wrote the plain value later: its whole list is the truth at its time
m = sd.merge(kdoc('a,x', 101, {'a': ['a', 10], 'x': ['x', 100], 'b': [None, 101]}), {'settings': {TELE: {'pinned_chats': ['b,z', 200]}}})
sd.settle(m, PINS)
check(m['settings'][TELE]['pinned_chats'] == ['b,z', 200] and m['keyed']['pins']['a'] == [None, 200] and m['keyed']['pins']['b'] == ['b', 200],
      'keyed: a newer plain value from an older device is taken whole: %r' % m['keyed']['pins'])
# a first keyed round: the plain value seeds the list
m = {'settings': {TELE: {'pinned_chats': ['p,q', 50]}}}
check(sd.settle(m, PINS) == [['p', 'p'], ['q', 'q']] and m['keyed']['pins'] == {'p': ['p', 50], 'q': ['q', 50]}, 'keyed: seeded from the plain value')
check(sd.settle({'settings': {}}, PINS) is None, 'no such list: nothing')
# iptv rows keep their other fields
m = {'files': {'iptv.json': [{'m3u': [{'name': 'A', 'url': 'http://a'}], 'free': {'on': 1}}, 5]},
     'keyed': {'iptv': {'http://b': [{'name': 'B', 'url': 'http://b'}, 6]}}}
sd.settle(m, IPTV)
check(m['files']['iptv.json'] == [{'m3u': [{'name': 'A', 'url': 'http://a'}, {'name': 'B', 'url': 'http://b'}], 'free': {'on': 1}}, 6], 'keyed rows: %r' % m['files']['iptv.json'])
# 6.5.0: the guide list (epg) is keyed too, in the same plain value as the iptv rows
EPG = [s for s in sd.KEYED if s[0] == 'epg'][0]
check(sd.items_of(EPG, {'epg': [' http://g1 ', 'http://g2', 'http://g1'], 'm3u': []}) == [['http://g1', ' http://g1 '], ['http://g2', 'http://g2']],
      'epg: items of the guide list (one key each)')
# A removes guide g1 (time 100); B adds m3u row c (time 101, its plain value still holds g1): both changes survive
eb = {'g1': ['http://g1', 10], 'g2': ['http://g2', 10]}
ib = {'http://a': [{'url': 'http://a'}, 10]}
EA = {'files': {'iptv.json': [{'m3u': [{'url': 'http://a'}], 'epg': ['http://g2']}, 100]},
      'keyed': {'iptv': dict(ib), 'epg': {'http://g1': [None, 100], 'http://g2': ['http://g2', 10]}}}
EB = {'files': {'iptv.json': [{'m3u': [{'url': 'http://a'}, {'url': 'http://c'}], 'epg': ['http://g1', 'http://g2']}, 101]},
      'keyed': {'iptv': dict(ib, **{'http://c': [{'url': 'http://c'}, 101]}), 'epg': {'http://g1': ['http://g1', 10], 'http://g2': ['http://g2', 10]}}}
for m in (sd.merge(EA, EB), sd.merge(EB, EA)):
    for spec in sd.KEYED:
        sd.settle(m, spec)
    check(m['files']['iptv.json'][0] == {'m3u': [{'url': 'http://a'}, {'url': 'http://c'}], 'epg': ['http://g2']},
          'epg keyed: a guide removed on one device and a list added on another both survive: %r' % m['files']['iptv.json'])
# an older device (no keyed lists) wrote iptv.json later: its guide list is the truth at its time
m = sd.merge(EA, {'files': {'iptv.json': [{'m3u': [], 'epg': ['http://g9']}, 300]}})
for spec in sd.KEYED:
    sd.settle(m, spec)
check(m['files']['iptv.json'] == [{'m3u': [], 'epg': ['http://g9']}, 300] and m['keyed']['epg']['http://g2'] == [None, 300],
      'epg keyed: a newer plain value from an older device is taken whole: %r' % m['keyed']['epg'])
# property: 200 random operations on 4 devices, merged in any order, settle to one result
prng = random.Random(7)
for round_ in range(12):
    devs_k = []
    for dvi in range(4):
        k = {}
        for _ in range(50):
            key = prng.choice('abcdefgh')
            k[key] = [prng.choice([None, key, key.upper()]), prng.randint(1, 40)]
        devs_k.append(kdoc(','.join(prng.sample('abcdefgh', prng.randint(0, 5))), prng.randint(1, 45), k))
    outs = set()
    for order in itertools.permutations(range(4)):
        cur = None
        for i in order:
            cur = sd.merge(cur, devs_k[i])
        sd.settle(cur, PINS)
        outs.add(sd.canon(cur))
    if len(outs) != 1:
        bad.append('keyed property round %d: %d different results' % (round_, len(outs)))
        break

# ---- 6.3.0 (P2): the secrets envelope
_ss = importlib.util.spec_from_file_location('syncseal', os.path.join(HERE, '..', 'plugin.video.nova', 'resources', 'lib', 'syncseal.py'))
seal_mod = importlib.util.module_from_spec(_ss)
_ss.loader.exec_module(seal_mod)
pairs = {'plugin.video.nova': {'tmdb_key': ['K', 5]}, TELE: {'rd_token': ['R', 6]}}
env = seal_mod.seal(pairs, 'horse battery', b'0123456789abcdef', rounds=20000)
check(seal_mod.open_env(env, 'horse battery') == pairs and seal_mod.open_env(env, 'wrong') is None and seal_mod.open_env(env, '') is None,
      'P2: opens with the passphrase only')
check(seal_mod.seal(pairs, 'horse battery', b'0123456789abcdef', rounds=20000) == env, 'P2: the same content gives the same envelope (no re-upload)')
bad_env = dict(env, data=env['data'][:-4] + 'AAA=')
check(seal_mod.open_env(bad_env, 'horse battery') is None, 'P2: a damaged envelope is refused')
st_ = {'a': {'tmdb_key': [1, 1], 'lang': [2, 2], 'rd_refresh': [3, 3], 'bot_request': [4, 4]}}
check(seal_mod.take_secrets(st_) == {'a': {'tmdb_key': [1, 1], 'rd_refresh': [3, 3]}} and st_ == {'a': {'lang': [2, 2], 'bot_request': [4, 4]}}, 'P2: which keys are sealed')

# ---- 6.3.0: the browser's port gives the same bytes (merge with unknown parts / float stamps / devices / keyed, settle,
# the envelope)
NODE = shutil.which('node')
WEB = os.path.normpath(os.path.join(HERE, '..', '..', 'web'))
if NODE and os.path.exists(os.path.join(WEB, 'syncdoc.js')):
    vec = []
    for i in range(30):
        a, b = rand_doc(i), rand_doc(i + 100)
        a['future'], b['future'] = {'n': prng.randint(0, 3)}, {'n': prng.randint(0, 3)}
        a['v'], b['v'] = 2, prng.choice([2, 3])
        a['settings']['nova']['f'] = ['x', prng.choice([1.5, 2, 2.75])]
        a['devices'] = {'d1': {'sv': 3, 'at': prng.randint(1, 5)}}
        b['devices'] = {'d1': {'sv': 3, 'at': prng.randint(1, 5), 'name': 'B'}, 'd2': {'sv': 3, 'at': 1}}
        a['settings'][TELE] = {'pinned_chats': [','.join(prng.sample('abcdef', 3)), prng.randint(1, 30)]}
        b['keyed'] = {'pins': dict((c, [prng.choice([None, c]), prng.randint(1, 30)]) for c in prng.sample('abcdefg', 4))}
        # 6.5.0: iptv rows + guide list share iptv.json
        a.setdefault('files', {})['iptv.json'] = [{'m3u': [{'url': 'http://' + c} for c in prng.sample('mnop', 2)],
                                                   'epg': ['http://g' + c for c in prng.sample('wxyz', 2)], 'free': {'on': 1}}, prng.randint(1, 30)]
        b['keyed']['epg'] = dict(('http://g' + c, [prng.choice([None, 'http://g' + c]), prng.randint(1, 30)]) for c in prng.sample('wxyz', 3))
        b['keyed']['iptv'] = dict(('http://' + c, [prng.choice([None, {'url': 'http://' + c}]), prng.randint(1, 30)]) for c in prng.sample('mnop', 2))
        vec.append([a, b])
    py = []
    for a, b in vec:
        m = sd.merge(a, b)
        for spec in sd.KEYED:
            sd.settle(m, spec)
        py.append(sd.canon(m))
    js = ("const SD=require(process.argv[1]);let s='';process.stdin.on('data',d=>s+=d).on('end',async()=>{"
          "const v=SD.parse(s);const out=[];for(const [a,b] of v.vec){const m=SD.merge(a,b);for(const sp of SD.KEYED)SD.settle(m,sp);out.push(SD.canon(m));}"
          "const WS=require(process.argv[2]).make(SD);const e=await WS.seal(v.pairs,'horse battery',new Uint8Array(Buffer.from('0123456789abcdef')),20000);"
          "const o=await WS.openEnv(v.env,'horse battery');process.stdout.write(JSON.stringify({out,env:e,opened:SD.canon(o)}));});")
    r = subprocess.run([NODE, '-e', js, os.path.join(WEB, 'syncdoc.js'), os.path.join(WEB, 'websync.js')],
                       input=json.dumps({'vec': vec, 'pairs': pairs, 'env': env}).encode('utf-8'), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        res = json.loads(r.stdout.decode('utf-8'))
    except ValueError:
        res = None
        bad.append('parity: node failed: %s' % r.stderr.decode('utf-8', 'replace')[-400:])
    if res:
        diff = [i for i in range(len(py)) if py[i] != res['out'][i]]
        check(not diff, 'parity: Python and the browser merge / settle to the same bytes (vectors %s)' % diff[:5])
        check(res['env'] == env, 'parity: the browser seals to the same envelope')
        check(res['opened'] == sd.canon(pairs), 'parity: the browser opens a Kodi envelope')
else:
    print('(node not found: the parity part is skipped)')


for b in bad:
    print('FAIL', b)
print('SYNCDOC TESTS OK' if not bad else 'SYNCDOC TESTS: %d problems' % len(bad))
sys.exit(1 if bad else 0)
