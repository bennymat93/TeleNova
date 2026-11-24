# -*- coding: utf-8 -*-
"""Offline: the recommendation number of a link and the order of the list
(plugin.video.telescope/resources/lib/recommend.py).   python t_recommend.py"""
import importlib.util, os, sys

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.telescope', 'resources', 'lib', 'recommend.py')
spec = importlib.util.spec_from_file_location('recommend', P)
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)
bad = []


def ok(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        bad.append(what)


MB = 1048576
RUNTIME = 100 * 60


def link(name, gb=2.0, **kw):
    c = {'file': name, 'size': int(gb * 1024 ** 3), 'duration': RUNTIME, 'match': 95, 'probe': 'ok', 'speed': 4 * MB,
         'quality': 1080, 'langs': [], 'smooth': True}
    c.update(kw)
    return c


best = link('best', he_sub_inside=True)
r = R.rate(best, 0, RUNTIME)
ok(r['pct'] >= 90 and r['tier'] == 'top', 'right file, tested, fast, Hebrew inside, 1080p: highly recommended (%d%%)' % r['pct'])
ok(0 <= r['pct'] <= 100 and abs(sum(r['parts'].values()) - r['pct']) <= 1, 'the number is the sum of its parts, 0-100')
ok(R.rate(link('no he'), 0, RUNTIME)['pct'] < r['pct'], 'the same link without Hebrew is lower')
ok(R.rate(link('sub for release', he_sub_synced='x'), 0, RUNTIME)['pct'] > R.rate(link('no he'), 0, RUNTIME)['pct'], 'a Hebrew subtitle made for the release counts')
u = R.rate(link('untested', probe='untested', speed=0, he_sub_inside=True), 0, RUNTIME)
ok(u['pct'] <= 60 and 'untested' in u['flags'], 'an untested link is never above 60 (%d%%)' % u['pct'])
d = R.rate(link('doubt', match=55, he_sub_inside=True), 0, RUNTIME)
ok(d['pct'] <= 45 and 'doubt' in d['flags'], 'a doubtful match is never "recommended" (%d%%)' % d['pct'])
lo = R.rate(link('loose', loose=True, match=90), 0, RUNTIME)
ok(lo['pct'] <= 45, 'a loose match too')
rd = R.rate(link('rd', probe='rd', speed=0, rd_cached=True), 0, RUNTIME)
ok(rd['parts']['works'] == 22 and 'cached' in rd['flags'] and rd['pct'] > 60, 'a cached Real-Debrid file counts as working (%d%%)' % rd['pct'])

# the connection now: 4 Mbit/s (0.5 MB/s); a 2 GB / 100 min film needs 0.36 MB/s, a 6 GB one 1.07 MB/s
slow = 0.5 * MB
light, heavy = link('2 GB', 2.0), link('6 GB', 6.0, quality=2160)
a, b = R.rate(light, slow, RUNTIME), R.rate(heavy, slow, RUNTIME)
ok(a['parts']['speed'] > b['parts']['speed'] and a['pct'] > b['pct'], 'on a weak line the lighter copy is recommended more (%d%% > %d%%)' % (a['pct'], b['pct']))
a2, b2 = R.rate(light, 0, RUNTIME), R.rate(heavy, 0, RUNTIME)
ok(b2['pct'] >= a2['pct'], 'on a fast line the 2160p copy is not behind (%d%% >= %d%%)' % (b2['pct'], a2['pct']))
h = R.rate(link('heavy', 6.0, heavy=True), slow, RUNTIME)
ok(h['pct'] <= 35 and 'heavy' in h['flags'], 'a file the connection cannot carry: at most 35 (%d%%)' % h['pct'])
dv = R.rate(link('dv', device_warn='Dolby Vision profile 5'), 0, RUNTIME)
ok(dv['pct'] <= 35 and 'device' in dv['flags'], 'a file the device cannot show: at most 35')
st = R.rate(link('stutter', smooth=False), 0, RUNTIME)
ok(st['parts']['speed'] <= 8, 'a link that stuttered in the test gets few speed points')
src_slow = R.rate(link('slow source', speed=int(0.3 * MB)), 0, RUNTIME)
ok(src_slow['parts']['speed'] < 5, 'a source slower than the film needs: almost no speed points')
ok(R.rate({'file': 'bare'}, 0, 0)['pct'] >= 0, 'a row with nothing known does not crash')

rows = [link('doubt', match=50), link('untested', probe='untested', speed=0), link('best', he_sub_inside=True), link('plain'),
        link('heavy', 6.0, heavy=True)]
out = R.rank(rows, slow, RUNTIME)
ok([c['file'] for c in out][:2] == ['best', 'plain'], 'the list is sorted best first (%s)' % [c['file'] + ' %d' % c['rec'] for c in out])
ok(all(out[i]['rec'] >= out[i + 1]['rec'] for i in range(len(out) - 1)) and all('rec_tier' in c and '_i' not in c for c in out), 'every row carries its number and tier')
same = R.rank([link('a'), link('b'), link('c')], 0, RUNTIME)
ok([c['file'] for c in same] == ['a', 'b', 'c'], "equal numbers keep the engine's own order")

for lang in ('he', 'en', 'ru', 'iw', 'fr'):
    b = R.badge(out[0], lang)
    ok(b.startswith('[COLOR ') and ('%d%%' % out[0]['rec']) in b, 'badge in %s' % lang)
ok(set(R.TEXT['he']) == set(R.TEXT['en']) == set(R.TEXT['ru']), 'the same texts in he / en / ru')
det = R.details(out[0], 'en')
ok(len(det) >= 6 and 'Recommendation' in det[0] and any('tested' in x for x in det), 'details window lines')
ok(R.badge({'file': 'old row'}) == '' and R.details({'file': 'old row'}) == [], 'a row from an old cache (no number): no badge')

# 6.1.3: smooth-now links first, filter by source
tight = link('tight 4K 1.1x', gb=40.0, quality=2160, speed=int(40 * 1024 ** 3 / RUNTIME * 1.1), he_sub_inside=True)
roomy = link('roomy 1080p', gb=3.0)
ok(R.safe(roomy, 0, RUNTIME) and not R.safe(tight, 0, RUNTIME), 'a link the source gives barely as fast as it needs is not safe')
ok(not R.safe(link('u', probe='untested'), 0, RUNTIME), 'an untested link is not safe')
ok(not R.safe(roomy, int(3 * 1024 ** 3 / RUNTIME), RUNTIME), 'a slow connection makes a link unsafe')
ok(R.safe({'backend': 'rd', 'rd_cached': True, 'probe': 'rd', 'size': 0}, 0, RUNTIME), 'a cached Real-Debrid file is safe')
o2 = R.rank([tight, link('untested', probe='untested', speed=0), roomy], 0, RUNTIME)
ok(o2[0]['file'] == 'roomy 1080p' and o2[0]['safe'], 'the smooth link is first (%s)' % [c['file'] for c in o2])
mix = [{'backend': 'tg'}, {'backend': 'rd'}, {'backend': 'telemedia'}, {'backend': 'stremio'}]
ok(R.kinds(mix) == [('tg', 2), ('rd', 1), ('stremio', 1)], 'sources counted: Telegram (bots + channels), RD, Stremio')
ok([c['backend'] for c in R.only(mix, ['tg'])] == ['rd', 'stremio'], 'a hidden source is left out')
ok(len(R.only(mix, ['tg', 'rd', 'stremio'])) == 4, 'hiding everything shows everything')

print('RECOMMEND TESTS OK' if not bad else 'RECOMMEND TESTS FAILED %d' % len(bad))
sys.exit(1 if bad else 0)
