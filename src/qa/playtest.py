# -*- coding: utf-8 -*-
"""QA playback tests through Kodi's JSON-RPC: open an item, wait until it really plays, stop."""
import sys
import time

sys.argv = ['x', '0', '0']
exec(open(__file__.replace('playtest.py', 'crawl.py'), encoding='utf-8').read().split('# listing actions')[0])


def listing(path):
    r = rpc('Files.GetDirectory', {'directory': path, 'media': 'files'}, 90)
    return (r.get('result') or {}).get('files') or []


def active():
    return (rpc('Player.GetActivePlayers').get('result') or [])


def stop():
    for p in active():
        rpc('Player.Stop', {'playerid': p['playerid']})
    for _ in range(20):
        if not active():
            return
        time.sleep(0.5)


def play(label, path, wait=35):
    stop()
    t0 = time.time()
    r = rpc('Player.Open', {'item': {'file': path}}, 60)
    ok, detail = False, ''
    while time.time() - t0 < wait:
        ps = active()
        if ps:
            pid = ps[0]['playerid']
            pr = rpc('Player.GetProperties', {'playerid': pid, 'properties': ['time', 'speed', 'live']}).get('result') or {}
            tm = pr.get('time') or {}
            secs = tm.get('hours', 0) * 3600 + tm.get('minutes', 0) * 60 + tm.get('seconds', 0)
            it = (rpc('Player.GetItem', {'playerid': pid, 'properties': ['title']}).get('result') or {}).get('item') or {}
            detail = '%s "%s"' % (ps[0].get('type'), (it.get('label') or it.get('title') or '')[:40])
            if pr.get('speed') == 1 and (secs >= 2 or pr.get('live')):
                ok = True
                break
        time.sleep(1)
    dlg = rpc('GUI.GetProperties', {'properties': ['currentwindow']}).get('result', {}).get('currentwindow', {})
    print('%-4s %5.1fs  %-34s %s%s' % ('OK' if ok else 'FAIL', time.time() - t0, label, detail,
                                      '' if ok else '  [window: %s %s] %s' % (dlg.get('id'), dlg.get('label'), r.get('error', ''))),
          flush=True)
    stop()
    if not ok:
        rpc('Input.Back')
    return ok


res = []
# --- radio: the first stations of the Israeli list (direct stream URLs)
for f in listing('plugin://plugin.video.nova/?a=radio_list&by=country&v=IL')[:4]:
    res.append(play('radio: ' + f['label'][:24], f['file']))
# --- live TV: Israeli channels of the built-in list
for f in [x for x in listing('plugin://plugin.video.nova/?a=tv_list&group=1')
          if any(k in x['label'] for k in ('Kan 11', 'Keshet 12', 'i24NEWS Hebrew', 'Channel 13', 'Channel 9'))][:5]:
    res.append(play('tv: ' + f['label'].split('[/B]')[-1].split('[COLOR')[0].strip()[:24], f['file'], wait=45))
# --- YouTube through the build's YouTube add-on
res.append(play('youtube video', 'plugin://plugin.video.youtube/play/?video_id=aqz-KE-bpKQ', wait=60))
# --- a library channel of TeleNova (YouTube channel listing -> first video)
vids = [x for x in listing('plugin://plugin.video.nova/?a=yt_channel&id=UCEK3tT7DcfWGWJpNEDBdWog') if x.get('filetype') == 'file']
print('     mosfilm channel listing: %d videos' % len(vids))
if vids:
    res.append(play('library: ' + vids[0]['label'][:22], vids[0]['file'], wait=60))
# --- Internet Archive
ia = listing('plugin://plugin.video.nova/?a=ia_search&q=%40soviet')
print('     internet archive listing: %d items' % len(ia))
print('\nplayback: %d of %d passed' % (sum(res), len(res)))
