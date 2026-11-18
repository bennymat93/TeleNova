# -*- coding: utf-8 -*-
"""Re-test every TV stream the build ships, live, from this computer. No Kodi.

For each channel: the playlist answers 200 with #EXTM3U, a variant is chosen, its media playlist answers, and the
FIRST SEGMENT really downloads (a playlist that answers while its segments are refused / geo-blocked is the usual
way a stream "exists" and does not play).

    python qa/check_channels.py                 the build's list: resources/channels_world.json + the direct
                                                streams of livefail.CHANNELS (Idan+ / YouTube sources need Kodi)
    python qa/check_channels.py --world         only channels_world.json
    python qa/check_channels.py --tsv FILE      research: candidates, one per line "name<TAB>guide id<TAB>url"
    python qa/check_channels.py --json OUT      also write the results as JSON

Prints one line per channel and, last, "playable: N of M". Exit code 1 when a shipped world channel fails.
"""
import concurrent.futures
import importlib.util
import io
import json
import os
import re
import sys
import time
from urllib.parse import urljoin

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'plugin.video.nova', 'resources')
WORLD = os.path.join(RES, 'channels_world.json')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
MIN_BYTES = 20000            # of the first segment (a whole segment smaller than that counts when it is complete)


def _get(url, headers, timeout, stream=False):
    return requests.get(url, headers=headers, timeout=timeout, stream=stream, allow_redirects=True)


def _lines(text):
    return [l.strip() for l in text.splitlines() if l.strip()]


def test_stream(url, headers=None, timeout=12):
    """-> (ok, detail). detail: 'WxH, N kB in T s' or the reason it failed (http status, geo, no segment)"""
    h = {'User-Agent': UA}
    h.update(headers or {})
    t0 = time.time()
    try:
        r = _get(url, h, timeout)
        if r.status_code != 200:
            return False, 'playlist http %d%s' % (r.status_code, ' (geo-block?)' if r.status_code in (403, 451) else '')
        text = r.text
        if '#EXTM3U' not in text[:400]:
            return False, 'not an HLS playlist'
        base, res = r.url, ''
        for _ in range(3):                         # master -> variant (-> a nested one)
            ls = _lines(text)
            if not any(l.startswith('#EXT-X-STREAM-INF') for l in ls):
                break
            best, best_bw = None, -1
            for i, l in enumerate(ls):
                if l.startswith('#EXT-X-STREAM-INF'):
                    nxt = next((x for x in ls[i + 1:] if not x.startswith('#')), None)
                    bw = int((re.search(r'[:,]BANDWIDTH=(\d+)', l) or [0, 0])[1])
                    m = re.search(r'RESOLUTION=(\d+x\d+)', l)
                    # the middle of the ladder is enough to prove the stream plays; the top one for the report
                    if nxt and bw > best_bw:
                        best, best_bw, res = nxt, bw, (m.group(1) if m else res)
            if not best:
                return False, 'master playlist without variants'
            base = urljoin(base, best)
            r = _get(base, h, timeout)
            if r.status_code != 200:
                return False, 'variant http %d%s' % (r.status_code, ' (geo-block?)' if r.status_code in (403, 451) else '')
            text = r.text
        ls = _lines(text)
        segs = [l for l in ls if not l.startswith('#')]
        if not segs:
            return False, 'media playlist without segments'
        seg = urljoin(base, segs[-1] if '#EXT-X-ENDLIST' not in text else segs[0])
        got = 0
        with _get(seg, h, timeout, stream=True) as s:
            if s.status_code not in (200, 206):
                return False, 'segment http %d%s' % (s.status_code, ' (geo-block?)' if s.status_code in (403, 451) else '')
            whole = int(s.headers.get('Content-Length') or 0)
            for chunk in s.iter_content(16384):
                got += len(chunk)
                if got >= 300000:
                    break
        if got < MIN_BYTES and not (whole and got >= whole and got > 2000):
            return False, 'segment too small (%d bytes)' % got
        return True, '%s%d kB in %.1f s' % (res + ', ' if res else '', got // 1000, time.time() - t0)
    except requests.exceptions.Timeout:
        return False, 'timeout'
    except requests.exceptions.SSLError:
        return False, 'TLS error'
    except requests.exceptions.ConnectionError:
        return False, 'no connection'
    except Exception as e:
        return False, '%s: %s' % (type(e).__name__, str(e)[:60])


def test_twice(url, headers=None):
    ok, d = test_stream(url, headers)
    if not ok and not d.startswith(('playlist http 4', 'variant http 4', 'segment http 4', 'not an HLS')):
        time.sleep(2)                              # a hiccup is not a dead channel
        ok, d = test_stream(url, headers)
    return ok, d


def split_headers(u):
    """Kodi's 'url|Header=value&...' -> (url, headers)"""
    from urllib.parse import unquote
    base, _, hdr = u.partition('|')
    return base, {k: unquote(v) for k, v in (kv.split('=', 1) for kv in hdr.split('&') if '=' in kv)}


def world():
    with io.open(WORLD, encoding='utf-8') as f:
        return json.load(f)['channels']


def israeli_direct():
    spec = importlib.util.spec_from_file_location('livefail', os.path.join(RES, 'lib', 'livefail.py'))
    lf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(lf)
    direct, other = [], []
    for key, (names, urls, idan) in lf.CHANNELS.items():
        http = [u for u in urls if u.startswith('http')]
        if http:
            direct.append((key, names[0], http))
        else:
            other.append((key, names[0], 'YouTube live' if urls else 'Idan+'))
    return direct, other


def run(rows, workers=10):
    """rows: [(id, name, [urls])] -> [(id, name, ok, detail, url)] (a channel plays when one of its urls does)"""
    def one(row):
        cid, name, urls = row
        d = 'no url'
        for u in urls:
            base, hdr = split_headers(u)
            ok, d = test_twice(base, hdr)
            if ok:
                return cid, name, True, d, base
        return cid, name, False, d, split_headers(urls[0])[0] if urls else ''
    with concurrent.futures.ThreadPoolExecutor(workers) as ex:
        return list(ex.map(one, rows))


def main(argv):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    out_json = argv[argv.index('--json') + 1] if '--json' in argv else None
    not_here = []
    if '--tsv' in argv:
        rows = []
        with io.open(argv[argv.index('--tsv') + 1], encoding='utf-8') as f:
            for line in f:
                p = line.rstrip('\n').split('\t')
                if len(p) >= 3 and p[2].startswith('http'):
                    rows.append((p[1] or p[0], p[0], [p[2]]))
        n_world = 0
    else:
        rows = [(c['id'], c['name'], [c['url']]) for c in world()]
        n_world = len(rows)
        if '--world' not in argv:
            direct, not_here = israeli_direct()
            rows += direct
    res = run(rows)
    for cid, name, ok, d, u in res:
        print('%-4s %-22s %-34s %s' % ('OK' if ok else 'FAIL', cid[:22], name[:34], d))
    for key, name, why in not_here:
        print('%-4s %-22s %-34s %s' % ('-', key, name[:34], 'plays through %s: not testable without Kodi' % why))
    good = sum(1 for r in res if r[2])
    if out_json:
        with io.open(out_json, 'w', encoding='utf-8') as f:
            json.dump([{'id': r[0], 'name': r[1], 'ok': r[2], 'detail': r[3], 'url': r[4]} for r in res], f,
                      ensure_ascii=False, indent=1)
    if n_world:
        w_good = sum(1 for r in res[:n_world] if r[2])
        print('world channels: %d of %d' % (w_good, n_world))
        if len(res) > n_world:
            print('Israeli direct streams: %d of %d (+%d channels through Idan+ / YouTube, not tested here)'
                  % (good - w_good, len(res) - n_world, len(not_here)))
    print('playable: %d of %d' % (good, len(res)))
    return 1 if n_world and any(not r[2] for r in res[:n_world]) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
