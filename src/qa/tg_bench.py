# -*- coding: utf-8 -*-
"""Telegram engine against the real account logged in inside the running Kodi (no bot is written to).
   python tg_bench.py search            search timings (raw search + full title search)
   python tg_bench.py stream [query]    throughput / first byte / seek latency through the local proxy
Prints file names and numbers only - no chat names, links or account details."""
import json, sys, time, urllib.request
import tg_rpc

NO_BOTS = {'bot_request': False}


def find(target, wait=90):
    target = dict(target, opts=dict(NO_BOTS, **(target.get('opts') or {})))
    t = time.time()
    r = tg_rpc.call('find_start', target=target)
    if 'error' in r:
        return [], 0, {'error': r['error']}
    job, first, last = r['result'], None, {}
    while time.time() - t < wait:
        last = tg_rpc.call('find_status', job=job).get('result') or {}
        n = len(last.get('result') or last.get('partial') or [])
        if n and first is None:
            first = time.time() - t
        if last.get('done'):
            break
        time.sleep(0.25)
    else:
        tg_rpc.call('find_cancel', job=job)
        last['timeout'] = True
    return last.get('result') or [], time.time() - t, dict(last, first=first)


def cmd_search():
    for q in ('matrix', 'פאודה', 'Oppenheimer 2023', 'breaking bad s01e01'):
        t = time.time()
        r = tg_rpc.call('raw_search', query=q, limit=60, timeout=60)
        res = r.get('result') or []
        print('raw_search %-22s %3d files in %5.1fs %s' % (q, len(res), time.time() - t, r.get('error') or ''))
    targets = [
        ({'type': 'movie', 'tmdb': 603, 'imdb': 'tt0133093', 'title': 'The Matrix', 'year': 1999}, 'The Matrix (1999)'),
        ({'type': 'movie', 'tmdb': 872585, 'imdb': 'tt15398776', 'title': 'Oppenheimer', 'year': 2023}, 'Oppenheimer (2023)'),
        ({'type': 'tv', 'tmdb': 1396, 'imdb': 'tt0903747', 'title': 'Breaking Bad', 'season': 1, 'episode': 1}, 'Breaking Bad S01E01'),
        ({'type': 'tv', 'tmdb': 67744, 'imdb': 'tt4565380', 'title': 'Fauda', 'season': 1, 'episode': 1}, 'Fauda S01E01'),
    ]
    for target, name in targets:
        for label, opts in (('full', {}), ('again', {})):
            res, dt, st = find(dict(target, opts=opts))
            by = {}
            for s in res:
                by[s.get('backend')] = by.get(s.get('backend'), 0) + 1
            probes = {}
            for s in res:
                probes[s.get('probe')] = probes.get(s.get('probe'), 0) + 1
            keys = sorted(k for k in st if k not in ('result', 'partial'))
            print('find %-22s %-5s %3d sources in %5.1fs (first after %s) %s probes %s | %s' % (
                name, label, len(res), dt, ('%.1fs' % st['first']) if st.get('first') else '-', by, probes,
                {k: st[k] for k in keys if k in ('stage', 'error', 'timeout', 'note', 'progress')}))
        for s in [x for x in res if x.get('backend') in ('tg', 'telemedia')][:5]:
            print('     %-5s %6d MB  %s' % (s.get('quality') or '', int((s.get('size') or 0) / 1048576), (s.get('file') or '')[:80]))


def pick(query):
    res = tg_rpc.call('raw_search', query=query, limit=60, timeout=60).get('result') or []
    res = [c for c in res if (c.get('size') or 0) > 700 * 1048576]
    res.sort(key=lambda c: c.get('size') or 0)
    return res


def read(url, start, length, label, timeout=120):
    req = urllib.request.Request(url, headers={'Range': 'bytes=%d-%d' % (start, start + length - 1)})
    t = time.time()
    r = urllib.request.urlopen(req, timeout=timeout)
    first, got, marks = None, 0, []
    while got < length:
        b = r.read(min(262144, length - got))
        if not b:
            break
        if first is None:
            first = time.time() - t
        got += len(b)
        marks.append((time.time() - t, got))
    dt = time.time() - t
    # the longest gap between two deliveries = what a viewer would see as a stall
    gap = max([b[0] - a[0] for a, b in zip(marks, marks[1:])] or [0])
    print('  %-34s first byte %5.2fs | %5.1f MB in %5.1fs = %5.2f MB/s | longest pause %4.1fs' % (
        label, first or -1, got / 1048576.0, dt, got / 1048576.0 / max(dt, 0.001), gap))
    return got / 1048576.0 / max(dt, 0.001)


def cmd_stream(query):
    files = pick(query)
    print('candidates over 700 MB:', len(files))
    for c in files[:int(sys.argv[3]) if len(sys.argv) > 3 else 2]:
        size = c['size']
        print('\n%s  (%d MB)' % ((c.get('file') or '')[:70], size // 1048576))
        url = tg_rpc.stream_url(c['chat_id'], c['msg_id'], c.get('file') or 'video.mkv')
        st0 = tg_rpc.call('status')['result']['stream']
        read(url, 0, 65536, 'header 64 KB (cold)')
        read(url, size - 2 * 1048576, 2 * 1048576, 'tail 2 MB (index probe)')
        read(url, 0, 48 * 1048576, 'play 48 MB from the start')
        read(url, int(size * 0.5) // 1048576 * 1048576 + 12345, 24 * 1048576, 'seek to 50% + 24 MB')
        read(url, int(size * 0.8) // 1048576 * 1048576 + 999, 24 * 1048576, 'seek to 80% + 24 MB')
        read(url, int(size * 0.5) // 1048576 * 1048576 + 12345, 8 * 1048576, 'seek back to 50% (cached)')
        st = tg_rpc.call('status')['result']['stream']
        print('  engine: speed %.2f MB/s, cache %s MB, hits %d, miss %d' % (
            st['speed'] / 1048576.0, st['cached_mb'], st['hits'] - st0['hits'], st['miss'] - st0['miss']))


if __name__ == '__main__':
    if sys.argv[1] == 'search':
        cmd_search()
    else:
        cmd_stream(sys.argv[2] if len(sys.argv) > 2 else 'mkv')
