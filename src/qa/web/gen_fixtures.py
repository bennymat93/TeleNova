# -*- coding: utf-8 -*-
"""Fixtures for the web version's cross-language tests: what the BUILD's own code produces, for web/syncdoc.js and
web/sealed.js to reproduce byte for byte.

  python gen_fixtures.py <folder>
writes  syncdoc_cases.json  - calls of syncdoc.py functions with their arguments and the canonical text of the result
        sealed_cases.json   - blobs made by configio.pack (as the engine's _cloud does it) with their passwords
No Kodi, no network."""
import base64, hashlib, importlib.util, io, itertools, json, os, random, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..')


def load(name, *path):
    spec = importlib.util.spec_from_file_location(name, os.path.join(SRC, *path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


sd = load('syncdoc', 'plugin.video.nova', 'resources', 'lib', 'syncdoc.py')
configio = load('configio', 'plugin.video.telescope', 'resources', 'lib', 'configio.py')
rnd = random.Random(20261116)
WORDS = ['Matrix', 'matrix', 'פאודה', 'Фильм', 'dune', 'Dune ', ' x', 'a"b', 'tab\there', 'line\nbreak', 'back\\slash', '😀 emoji', 'יִ yod',
         '\U0001f600', '￮', 'é', 'é', 'ǅ', '__proto__', 'constructor', 'toString', 'İstanbul', 'ΑΣ', '\x7f', '\x01ctl', ' ', '</script>', '', 'q']


def word():
    return rnd.choice(WORDS) if rnd.random() < 0.7 else ''.join(rnd.choice('abאבяж 😀1') for _ in range(rnd.randint(1, 6)))


def ts():
    """times as devices write them: ints, floats (time.time()), whole floats, strings, nothing"""
    r = rnd.random()
    if r < 0.45:
        return rnd.randint(0, 600)
    if r < 0.7:
        return rnd.randint(1, 600) + rnd.choice([0.5, 0.25, 0.123456, 0.1, 0.999999])
    if r < 0.8:
        return float(rnd.randint(0, 600))
    if r < 0.86:
        return 1763312345 + rnd.random()
    if r < 0.9:
        return str(rnd.randint(0, 600))
    if r < 0.94:
        return None
    return rnd.choice([True, False, '', ' 12 ', '1_0', 'abc', '1e2', 1e16, 1.5e17, 12345678901234567890, 1e22, 0.00001, -3, -2.5])


def when():
    r = rnd.random()
    if r < 0.8:
        return '%02d/%02d/2026 %02d:%02d' % (rnd.randint(1, 28), rnd.randint(10, 11), rnd.randint(0, 23), rnd.choice([0, 30]))
    if r < 0.88:
        return '2026-11-%02dT10:00' % rnd.randint(1, 28)
    if r < 0.94:
        return ''
    return rnd.choice([None, 'yesterday', '01/11/2026  09:00 extra', '1/11/2026 09:00'])


def junk():
    return rnd.choice([None, 5, 'text', [], [1], {}, 1.5, True])


def maybe_junk(items, p=0.08):
    return [junk() if rnd.random() < p else x for x in items]


def user(i):
    u = {'id': rnd.choice(['u1', 'u2', 'u3', 'u%d' % i, 7, 'ua1b2c3d4']), 'name': rnd.choice([word(), '', None, 'Kids', 'kids'])}
    for k in ('created', 'renamed', 'deleted'):
        if rnd.random() < 0.8:
            u[k] = rnd.choice([0, 0, ts()]) if k == 'deleted' else ts()
    if rnd.random() < 0.05:
        u.pop('id')
    return u


def hist():
    h = {'key': rnd.choice(['movie:%d' % rnd.randint(1, 9), 'tv:5:1:%d' % rnd.randint(1, 4), 'ch:kan11', word(), None, '']), 'ts': ts(), 'when': when(),
         'label': word(), 'play': rnd.choice(['', 'plugin://plugin.video.nova/?a=play&m=movie&id=5', 'https://x/y.m3u8'])}
    if rnd.random() < 0.3:
        h.update(thumb='https://image.tmdb.org/t/p/w342/a.jpg', fanart='', plot=word() * 3)
    if rnd.random() < 0.1:
        del h['ts']
    if rnd.random() < 0.1:
        del h['when']
    return h


def fav():
    f = {'kind': rnd.choice(['movie', 'series', 'channel', 'radio', 'web_ia', None]), 'id': rnd.choice([1, 2, 3, '1', '2', 'uuid-9', 2.5, None]),
         'label': word(), 'extra': rnd.choice(['', 'pvr_channel_3', 'https://s/1']), 'added': when()}
    if rnd.random() < 0.1:
        del f['added']
    return f


def rem():
    return {'kind': rnd.choice(['movie', 'series', 'channel', 'radio', None]), 'id': rnd.choice([1, 2, 3, '1', '2', 'uuid-9', None]), 'removed': when()}


def srch():
    return {'q': rnd.choice([word(), 'Matrix', 'MATRIX ', ' matrix', None, 3]), 'ts': ts()}


def marks():
    m = {}
    if rnd.random() < 0.7:
        m['history_cleared'] = rnd.choice([0, 0, ts()])
    if rnd.random() < 0.7:
        m['searches_cleared'] = rnd.choice([0, 0, ts()])
    if rnd.random() < 0.7:
        m['searches_removed'] = dict((word().strip().lower(), ts()) for _ in range(rnd.randint(0, 4)))
    return rnd.choice([m, m, m, None, {}])


def lst(make, top):
    return rnd.choice([None, []]) if rnd.random() < 0.1 else maybe_junk([make() for _ in range(rnd.randint(0, top))])


def user_data():
    d = {'history': lst(hist, 8), 'favourites': lst(fav, 6), 'removed': lst(rem, 4), 'searches': lst(srch, 6), 'marks': marks()}
    for k in list(d):
        if rnd.random() < 0.1:
            del d[k]
    return d


def value():
    return rnd.choice(['', 'true', 'KEY-%d' % rnd.randint(1, 3), word(), rnd.randint(0, 3), 1.5, 2.0, None, True, {'m3u': [word()], 'n': rnd.randint(1, 2)}, [1, 'a', None]])


def stamped():
    d = dict(('k%d' % rnd.randint(1, 6), [value(), ts()]) for _ in range(rnd.randint(0, 6)))
    if rnd.random() < 0.15:
        d['bad'] = rnd.choice(['garbage', [1], [1, 2, 3], None, 5])
    if rnd.random() < 0.1:
        d['__proto__'] = ['x', 5]
    return d


def doc(i):
    """a document as a device may hold it - in normal form or not"""
    d = {'v': 2, 'users': maybe_junk([user(i) for _ in range(rnd.randint(0, 4))]),
         'data': dict((rnd.choice(['u1', 'u2', 'u3', 'ghost']), user_data()) for _ in range(rnd.randint(0, 3))),
         'settings': dict((rnd.choice(['plugin.video.nova', 'plugin.video.telescope', 'service.subtitles.All_Subs']), stamped()) for _ in range(rnd.randint(0, 3))),
         'files': stamped()}
    for k in ('users', 'data', 'settings', 'files'):
        if rnd.random() < 0.06:
            d[k] = None
        elif rnd.random() < 0.04:
            del d[k]
    if rnd.random() < 0.2:
        d.update(device='x', stamp=5)
    return d


def tidy_doc(i):
    """the generator of qa/t_syncdoc.py: clean documents, whose merge must not depend on the order"""
    H = lambda key, t: {'key': key, 'ts': t, 'when': '16/11/2026 18:00', 'label': key}
    F = lambda kind, n, added: {'kind': kind, 'id': n, 'label': '%s%s' % (kind, n), 'added': added}
    h = [H('t%d' % rnd.randint(1, 12), rnd.randint(1, 500)) for _ in range(rnd.randint(0, 8))]
    favs = [F('movie', rnd.randint(1, 6), '%02d/11/2026 10:00' % rnd.randint(1, 28)) for _ in range(rnd.randint(0, 5))]
    rm = [{'kind': 'movie', 'id': rnd.randint(1, 6), 'removed': '%02d/11/2026 09:00' % rnd.randint(1, 28)} for _ in range(rnd.randint(0, 3))]
    sr = [{'q': 'q%d' % rnd.randint(1, 8), 'ts': rnd.randint(1, 500)} for _ in range(rnd.randint(0, 6))]
    mk = {'history_cleared': rnd.choice([0, 0, 0, rnd.randint(1, 300)]), 'searches_cleared': rnd.choice([0, 0, rnd.randint(1, 300)]),
          'searches_removed': dict(('q%d' % rnd.randint(1, 8), rnd.randint(1, 500)) for _ in range(rnd.randint(0, 2)))}
    users = [{'id': 'u1', 'name': 'n%d' % i, 'created': 1, 'renamed': rnd.randint(0, 50)}]
    if rnd.random() < 0.5:
        users.append({'id': 'u2', 'name': 'k', 'created': 5, 'deleted': rnd.choice([0, 0, 77])})
    sett = {'nova': dict(('k%d' % n, [rnd.choice(['a', 'b', 'c', '']), rnd.choice([0, rnd.randint(1, 9)])]) for n in range(4))}
    return {'v': 2, 'users': users, 'data': {'u1': {'history': h, 'favourites': favs, 'removed': rm, 'searches': sr, 'marks': mk},
                                             'u2': {'history': [H('z', rnd.randint(1, 9))]}},
            'settings': sett, 'files': {'iptv.json': [{'n': rnd.randint(1, 3)}, rnd.randint(0, 9)]}}


def sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def main(out):
    os.makedirs(out, exist_ok=True)
    cases, skipped = [], 0

    def call(fn, *args):
        """one call of the original; inputs the original itself refuses (it raises) are not part of the contract"""
        nonlocal skipped
        frozen = json.loads(json.dumps(args))          # the arguments as the other side will read them
        try:
            res = getattr(sd, fn)(*args)
        except Exception:
            skipped += 1
            return
        cases.append({'fn': fn, 'args': frozen, 'out': sd.canon(res)})

    # canon: every kind of value
    floats = [0.0, -0.0, 1.0, 5.0, 300.0, 1.5, 0.1, 1 / 3, 1e15, 1e16, 1.5e16, 123456789012345680.0, 1e21, 1e22, 1.7976931348623157e308, 5e-324, 0.0001,
              0.00001, 1.5e-7, 1763312345.123456, 1763312345.0, -2.5, -1e-10, 2 ** 53, 2.0 ** 53, 9007199254740993, -9007199254740992, 10 ** 21, 10 ** 25]
    call('canon', floats)
    call('canon', dict((w, [w, {'k': w}]) for w in WORDS))
    call('canon', {'b': 1, 'a': {'z': None, 'y': [True, False, {}]}, '\U0001f600': 1, '￮': 2, 'יִ': 3, 'B': 4, '': 5, '10': 6, '9': 7})
    for _ in range(150):
        call('canon', [ts() for _ in range(6)] + [value(), word(), when()])
    # every merge function on untidy input
    for i in range(400):
        call('merge_users', lst(lambda: user(i), 5), lst(lambda: user(i), 5))
        call('merge_history', lst(hist, 9), lst(hist, 9), rnd.choice([0, 0, rnd.randint(1, 600), 100.5]))
        call('merge_removed', lst(rem, 6), lst(rem, 6))
        call('merge_favourites', lst(fav, 7), lst(fav, 7), [rem() for _ in range(rnd.randint(0, 5))])
        call('merge_searches', lst(srch, 8), lst(srch, 8), rnd.choice([0, 0, rnd.randint(1, 600)]),
             rnd.choice([None, {}, dict((word().strip().lower(), rnd.randint(1, 600)) for _ in range(3))]))
        call('merge_marks', marks(), marks())
        call('merge_user_data', user_data(), user_data())
        call('merge_stamped', rnd.choice([stamped(), None]), stamped())
        meta = rnd.choice([None, None, stamped()])
        call('stamp_changes', meta, dict(('k%d' % rnd.randint(1, 7), value()) for _ in range(rnd.randint(0, 6))), rnd.randint(700, 900), rnd.choice([0, 650]))
        a, b = doc(i), doc(i + 1)
        call('merge', a, b)
        call('merge', rnd.choice([None, {}, a]), rnd.choice([None, b]))
        call('same', a, rnd.choice([a, b, dict(a, device='y'), None]))
        call('live_users', lst(lambda: user(i), 5))
        call('changed_settings', {'nova': dict((k, v) for k, v in stamped().items() if isinstance(v, list) and len(v) == 2 and isinstance(v[1], (int, float)))},
             rnd.choice([None, {}, {'nova': {'k1': 'KEY-1', 'k2': '', 'k3': value()}}]))
    # limits
    call('merge_history', [{'key': 'k%d' % i, 'ts': i + 1, 'when': '', 'label': 'x'} for i in range(700)], [])
    call('merge_searches', [{'q': 'q%d' % i, 'ts': i + 1} for i in range(90)], [{'q': 'Q%d' % i, 'ts': 500 - i} for i in range(90)])
    call('merge_removed', [{'kind': 'movie', 'id': i, 'removed': '01/11/2026 10:%02d' % (i % 60)} for i in range(1200)], [])
    call('merge_marks', {'searches_removed': dict(('a%d' % i, 100 + i % 7) for i in range(250))}, {'searches_removed': dict(('b%d' % i, 100 + i % 5) for i in range(250))})

    # the whole document: 4 devices, every order of the merges (hash per order) and in pairs
    rounds = []
    for r in range(60):
        docs = [tidy_doc(i) if r < 30 else doc(i) for i in range(4)]
        frozen = json.loads(json.dumps(docs))
        try:
            orders = []
            for order in itertools.permutations(range(4)):
                cur = None
                for i in order:
                    cur = sd.merge(cur, docs[i])
                orders.append(sha(sd.canon(cur)))
            pairs = sd.canon(sd.merge(sd.merge(docs[0], docs[1]), sd.merge(docs[2], docs[3])))
        except Exception:
            skipped += 1
            continue
        if r < 30 and (len(set(orders)) != 1 or sha(pairs) != orders[0]):
            raise SystemExit('the Python merge itself depends on the order (round %d)' % r)
        rounds.append({'docs': frozen, 'orders': orders, 'pairs': pairs})
    with open(os.path.join(out, 'syncdoc_cases.json'), 'w', encoding='utf-8') as f:
        json.dump({'cases': cases, 'rounds': rounds}, f, ensure_ascii=False)

    # sealed files, made exactly as the engine makes the account's document (service.py _cloud + autosync cloud_put)
    sealed = []
    account = 'telenova-setup-v1:%d' % 5550001234
    big = sd.merge(None, {'v': 2, 'users': [{'id': 'u1', 'name': 'ראשי', 'created': 1}],
                          'data': {'u1': {'history': [{'key': 'movie:%d' % i, 'label': 'סרט %d 😀' % i, 'ts': 1763312345.5 + i, 'when': '16/11/2026 18:00',
                                                       'play': 'plugin://plugin.video.nova/?a=play&m=movie&id=%d' % i, 'plot': 'x' * 300} for i in range(400)]}},
                          'settings': {'plugin.video.nova': {'tmdb_key': ['KEY', 5]}}, 'files': {'iptv.json': [{'m3u': ['a']}, 9]}})
    small = sd.merge(None, tidy_doc(1))
    for name, document, password, how in (('big', big, account, zipfile.ZIP_DEFLATED), ('small', small, account, zipfile.ZIP_DEFLATED),
                                          ('stored', small, 'סיסמה 😀', zipfile.ZIP_STORED), ('open', small, '', zipfile.ZIP_DEFLATED)):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', how) as z:
            z.writestr('sync.json', json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
        note = {'device': 'sync-v2', 'name': 'TeleNova sync', 'build': '', 'fp': '', 'v': 1}
        blob = configio.pack({}, {'setup.zip': buf.getvalue()}, password, {'note': note})
        sealed.append({'name': name, 'password': password, 'blob': base64.b64encode(blob).decode('ascii'), 'canon': sd.canon(document),
                       'zip_sha256': hashlib.sha256(buf.getvalue()).hexdigest(), 'note': note})
    for n in (0, 1, 31, 32, 33, 64, 1000):               # payload lengths around the 32-byte keystream block
        data = bytes(rnd.randrange(256) for _ in range(n))
        blob = configio.pack({'api_id': '1', 'שם': 'ערך'}, {'a.bin': data}, 'pw-%d' % n, {'n': n})
        sealed.append({'name': 'raw%d' % n, 'password': 'pw-%d' % n, 'blob': base64.b64encode(blob).decode('ascii'),
                       'settings': {'api_id': '1', 'שם': 'ערך'}, 'file_sha256': hashlib.sha256(data).hexdigest(), 'extra': {'n': n}})
    with open(os.path.join(out, 'sealed_cases.json'), 'w', encoding='utf-8') as f:
        json.dump(sealed, f, ensure_ascii=False)
    print('fixtures: %d calls (%d refused by the original and left out), %d document rounds, %d sealed files' % (len(cases), skipped, len(rounds), len(sealed)))


if __name__ == '__main__':
    main(sys.argv[1])
