# -*- coding: utf-8 -*-
"""Bots against the real account that is logged in inside the running Kodi.
   python t_bots_live.py list                 the account's bots as the engine sees them (which would be asked)
   python t_bots_live.py ask "<title>" [n]    ask the first n content bots (default 3) for a title
   python t_bots_live.py find "<title> ..."   a full title search WITH bots (what a viewer gets)
Only bots the engine itself would ask are written to (bots whose chat already holds videos, or marked "always").
Nothing is joined. Bot names are printed shortened."""
import json, sys, time
import tg_rpc


def short(name):
    name = name or '?'
    return name[:3] + '..' + name[-3:] if len(name) > 8 else name


def bots(refresh=False):
    r = tg_rpc.call('bot_list', refresh=refresh, timeout=120)
    if 'error' in r:
        print('bot_list failed:', r['error'])
        return []
    return r.get('result') or []


def cmd_list():
    rows = bots(True)
    print('%d bot(s) in the account' % len(rows))
    for b in rows:
        print('  %-12s state=%-8s videos=%-4s files so far=%-3s inline=%s' % (
            short(b.get('username') or b.get('title')), b.get('state') or b.get('mode') or '', b.get('videos', ''),
            (b.get('stats') or {}).get('files', b.get('files', '')), b.get('inline', '')))
    if rows:
        print('fields of one row:', sorted(rows[0].keys()))


def cmd_ask(title, n):
    rows = [b for b in bots() if (b.get('state') or b.get('mode')) not in ('never', 'off')]
    content = [b for b in rows if b.get('videos') or b.get('content') or (b.get('state') or b.get('mode')) in ('always', 'auto')]
    print('%d bot(s), %d the engine would ask' % (len(rows), len(content)))
    for b in content[:n]:
        ref = b.get('ref') or b.get('username') or b.get('id')
        t = time.time()
        r = tg_rpc.call('bot_ask', bot=ref, query=title, timeout=60)
        dt = time.time() - t
        if 'error' in r:
            print('  %-12s ERROR %s' % (short(str(b.get('username') or b.get('title'))), str(r['error'])[:120]))
            continue
        res = r.get('result') or {}
        files = res.get('files') or res.get('items') or []
        print('  %-12s %.1fs: %d file(s), status=%s, clicks=%s, join=%s' % (
            short(str(b.get('username') or b.get('title'))), dt, len(files), res.get('status') or res.get('state'),
            res.get('clicks'), bool(res.get('join'))))
        for f in files[:4]:
            print('       %6d MB  %s' % ((f.get('size') or 0) // 1048576, (f.get('file') or '')[:70]))
        if not files:
            print('       answered=%s error=%s checks=%s' % (res.get('answered'), res.get('error'), res.get('checks')))
            for note in (res.get('notes') or [])[:6]:
                print('       note: %s' % str(note)[:150].replace('\n', ' '))


def cmd_find(title):
    target = {'type': 'movie', 'title': title, 'refresh': True}
    t = time.time()
    job = tg_rpc.call('find_start', target=target)['result']
    last = None
    while time.time() - t < 90:
        st = tg_rpc.call('find_status', job=job)['result']
        if st.get('stage') != last:
            last = st.get('stage')
            print('  %5.1fs %s' % (time.time() - t, last))
        if st.get('done'):
            break
        time.sleep(0.3)
    res = st.get('result') or []
    via = [s for s in res if s.get('via_bot') or s.get('chat_kind') == 'bot']
    stats = st.get('stats') or {}
    print('%d sources in %.1fs, %d from bots' % (len(res), time.time() - t, len(via)))
    print('bots report:', json.dumps(stats.get('bots'), ensure_ascii=False)[:500])
    for s in via[:6]:
        print('   %-6s %6d MB %s' % (s.get('quality') or '', (s.get('size') or 0) // 1048576, (s.get('file') or '')[:70]))


if __name__ == '__main__':
    if sys.argv[1] == 'list':
        cmd_list()
    elif sys.argv[1] == 'ask':
        cmd_ask(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 3)
    else:
        cmd_find(sys.argv[2])
