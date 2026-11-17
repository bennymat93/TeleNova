# -*- coding: utf-8 -*-
"""web/data/epg_il.json: the Israeli TV guide for the web app (plan row 21, WP-7).

  python src/qa/web/gen_epg.py                 downloads epgshare01's IL1 guide, writes web/data/epg_il.json
  python src/qa/web/gen_epg.py --in FILE.gz    the same from a local copy (tests)

epgshare01 sends no CORS headers, so a browser cannot read it: the GitHub Action .github/workflows/epg.yml runs this
script a few times a day and commits the JSON next to the app (no server of ours). Channel names are matched with the
build's own rules (plugin.video.nova/resources/lib/epg.py: norm / alias_key / IL_ALIASES), so 'ערוץ 11 כאן שידור חי'
and 'Kan 11' land on the same key 'kan11'.

Output: {"v": 1, "generated": unix, "index": {normalised name: key}, "ch": {key: {"n": name, "p": [[start, stop,
title, desc], ...]}}}. Times are unix seconds (UTC); the browser shows them in its own time zone. Python 3.8."""
import calendar, gzip, html, importlib.util, io, json, os, re, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(ROOT, 'web', 'data', 'epg_il.json')
URL = 'https://epgshare01.online/epgshare01/epg_ripper_IL1.xml.gz'
BEFORE, AFTER = 2 * 3600, 26 * 3600          # keep programmes from 2 h ago to 26 h ahead (the Action runs every 6 h)
DESC = 140                                   # descriptions only for the build's named Israeli channels (keeps the file small)


def _epg():
    spec = importlib.util.spec_from_file_location('epg', os.path.join(ROOT, 'src', 'plugin.video.nova', 'resources', 'lib', 'epg.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def xmltv_time(s):
    """'20261117070000 +0000' -> unix seconds"""
    m = re.match(r'(\d{14})\s*([+-]\d{4})?', s or '')
    if not m:
        return 0
    t = calendar.timegm(time.strptime(m.group(1), '%Y%m%d%H%M%S'))
    off = m.group(2) or '+0000'
    sign = 1 if off[0] == '+' else -1
    return t - sign * (int(off[1:3]) * 3600 + int(off[3:5]) * 60)


def _text(block, tag):
    m = re.search(r'<%s[^>]*>(.*?)</%s>' % (tag, tag), block, re.S)
    return ' '.join(html.unescape(m.group(1)).split()) if m else ''


def build(xml, now=None):
    epg = _epg()
    now = int(now if now is not None else time.time())
    chans = epg.channels_of(xml)                          # {id: [id, display names...]}
    key_of, index, out = {}, {}, {}
    for gid, names in chans.items():
        shown = names[1] if len(names) > 1 else gid
        key = None
        for n in names[1:] + names[:1]:
            k = epg.alias_key(n)
            if k in epg.IL_ALIASES:
                key = k
                break
        key = key or epg.alias_key(shown) or gid
        if key in out:                                    # two guide ids for one channel: the first one wins
            continue
        key_of[gid] = key
        out[key] = {'n': html.unescape(shown), 'p': []}
        for n in names:
            index.setdefault(epg.norm(n), key)
    for key, names in epg.IL_ALIASES.items():
        if key in out:
            for n in names:
                index.setdefault(epg.norm(n), key)
    for m in re.finditer(r'<programme\b([^>]*)>(.*?)</programme>', xml, re.S):
        head, body = m.group(1), m.group(2)
        cid = (re.search(r'channel="([^"]+)"', head) or [None, ''])[1]
        key = key_of.get(cid)
        if not key:
            continue
        start = xmltv_time((re.search(r'start="([^"]+)"', head) or [None, ''])[1])
        stop = xmltv_time((re.search(r'stop="([^"]+)"', head) or [None, ''])[1])
        if not start or stop < now - BEFORE or start > now + AFTER:
            continue
        desc = _text(body, 'desc') if key in epg.IL_ALIASES else ''
        if len(desc) > DESC:
            desc = desc[:DESC - 1].rstrip() + '…'
        out[key]['p'].append([start, stop, _text(body, 'title'), desc])
    for c in out.values():
        c['p'].sort()
    out = {k: c for k, c in out.items() if c['p']}
    index = {n: k for n, k in index.items() if n and k in out}
    return {'v': 1, 'generated': now, 'src': 'epgshare01 IL1', 'index': index, 'ch': out}


def main(argv):
    if '--in' in argv:
        with open(argv[argv.index('--in') + 1], 'rb') as f:
            raw = f.read()
    else:
        from urllib.request import Request, urlopen
        raw = urlopen(Request(URL, headers={'User-Agent': 'TeleNova-EPG/1'}), timeout=120).read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
    data = build(raw.decode('utf-8', 'replace'))
    if not data['ch']:
        sys.stderr.write('no programmes - the old file is kept\n')
        return 1
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    sys.stdout.write('%d channels, %d programmes -> %s\n' % (len(data['ch']), sum(len(c['p']) for c in data['ch'].values()), OUT))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
