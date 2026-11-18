# -*- coding: utf-8 -*-
"""Offline: BUG-014 - what Kodi's log says about a TV channel that failed to open is classified and kept
(service.py: tv_mask, tv_fail_window, tv_fail_cause, tv_fail_note). No address path, query or header may reach
tv_fail.json.   python t_tvfail.py"""
import ast, io, json, os, re, sys, tempfile, time

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.nova', 'service.py')
code = io.open(SRC, encoding='utf-8').read()
tree = ast.parse(code, feature_version=(3, 8))
want_fn = ('tv_mask', 'tv_fail_window', 'tv_fail_cause', 'tv_fail_note')
parts = []
for n in tree.body:
    if isinstance(n, ast.Assign) and any(getattr(t, 'id', '').startswith(('TV_FAIL', '_TV_')) for t in n.targets):
        parts.append(ast.get_source_segment(code, n))
    elif isinstance(n, ast.FunctionDef) and n.name in want_fn:
        parts.append(ast.get_source_segment(code, n))
store = {}
logs = []


class X(object):
    LOGWARNING = 2


ns = {'re': re, 'time': time, 'xbmc': X, 'xbmcvfs': None,
      'load': lambda name, default=None: store.get(name, default),
      'save': lambda name, value: store.__setitem__(name, json.loads(json.dumps(value))),
      'log': lambda *a: logs.append(a[0]), 'now_str': lambda: 'now'}
exec('\n\n'.join(parts), ns)
bad = []


def ok(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        bad.append(what)


mask = ns['tv_mask']
m = mask('OpenFile https://user:pw@cdn.example.com/live/secret-token-123/index.m3u8?token=abc&x=1|User-Agent=Foo&Cookie=sid')
ok('cdn.example.com' in m and '.m3u8' in m, 'mask keeps host and extension')
ok(not any(x in m for x in ('secret-token', 'token=abc', 'user:pw', 'Cookie', 'sid', 'User-Agent')), 'mask drops login, path, query, headers')
m = mask('plugin://plugin.video.nova/?mode=live&ch=kan11&key=SECRET')
ok('ch=kan11' in m and 'SECRET' not in m, 'own plugin address keeps only the channel key')
m = mask('plugin://plugin.video.idanplus/?mode=5&url=SECRETURL')
ok(m.startswith('plugin://plugin.video.idanplus/') and 'SECRET' not in m, "another add-on's address keeps only its id")

now = time.time()
stamp = lambda ago: time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(now - ago))


def line(ago, text):
    return '%s.000 T:1   error <general>: %s' % (stamp(ago), text)


old = [line(300, 'CCurlFile::Open - Failed with code 404'), '   continuation of the old line']
new = [line(5, 'CCurlFile::Open - <https://a.example.com/p/x.m3u8?t=1> Failed with code 403:'),
       line(4, 'CVideoPlayer::OpenInputStream - error opening [https://a.example.com/p/x.m3u8?t=1]')]
win = ns['tv_fail_window'](old + new, now)
ok(win == new, 'window keeps only the last seconds (and drops the continuation of an old line)')

cause = ns['tv_fail_cause']
cases = [
    ('http_denied', new),
    ('http_limit', [line(3, 'CCurlFile::Open - <https://b.example.com/x.ts> Failed with code 429:')]),
    ('http_missing', [line(3, 'CCurlFile::Open - <https://b.example.com/x.m3u8> Failed with code 404:')]),
    ('http_server', [line(3, 'CCurlFile::Open - <https://b.example.com/x.m3u8> Failed with code 503:')]),
    ('network', [line(3, 'CCurlFile::Open - <https://b.example.com/x.m3u8> Failed with code 0: Timeout was reached')]),
    ('plugin', [line(3, 'Playlist Player: skipping unplayable item: 0, path [plugin://plugin.video.idanplus/?mode=5]')]),
    ('adaptive', [line(3, 'inputstream.adaptive: failed to open manifest https://b.example.com/x.mpd')]),
    ('demux', [line(3, 'CDVDDemuxFFmpeg::Open - Error, could not open file https://b.example.com/x.m3u8'),
               line(3, 'CVideoPlayer::OpenDemuxStream - Error creating demuxer')]),
    ('unknown', [line(3, 'something unrelated happened')]),
]
for name, lines in cases:
    rec = cause(lines)
    ok(rec['cause'] == name, 'cause %s (got %s)' % (name, rec['cause']))
rec = cause(new)
ok(rec['http'] == 403 and rec['host'] == 'a.example.com', 'http code and host of the stream')
ok(all('t=1' not in l and '/p/' not in l for l in rec['lines']), 'kept lines are masked')
two = [line(6, 'CVideoPlayer::OpenFile: pvr://channels/tv/a.pvr'), line(5, 'CVideoPlayer::OpenFile: pvr://channels/tv/a.pvr'),
       line(4, 'CVideoPlayer::OpenDemuxStream - Error creating demuxer')]
ok(cause(two)['reopen'] is True and cause(new)['reopen'] is False, 'two opens within 3 s are flagged')

tmp = os.path.join(tempfile.mkdtemp(), 'kodi.log')
with io.open(tmp, 'w', encoding='utf-8') as f:
    f.write('\n'.join(['first line is cut by the tail read'] + old + new) + '\n')
note = ns['tv_fail_note']
for i in range(ns['TV_FAIL_KEEP'] + 5):
    rec = note('pvr://channels/tv/All channels/pvr.iptvsimple_123.pvr', 'first', log_path=tmp, now=now)
kept = store.get(ns['TV_FAIL_FILE'])
ok(rec and rec['cause'] == 'http_denied' and rec['kind'] == 'first', 'note stores the classified record')
ok(isinstance(kept, list) and len(kept) == ns['TV_FAIL_KEEP'], 'only the last %d failures are kept' % ns['TV_FAIL_KEEP'])
ok('t=1' not in json.dumps(kept), 'nothing secret in the stored file')
ok(note('x', 'first', log_path=os.path.join(tmp, 'missing'), now=now) is None, 'a missing log never raises')

print('TV FAIL TESTS OK' if not bad else 'TV FAIL TESTS FAILED %d' % len(bad))
sys.exit(1 if bad else 0)
