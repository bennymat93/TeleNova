# -*- coding: utf-8 -*-
"""Live: how dependable is the start of the main TV channels? Opens each channel the way the TV list does (its
tv_list entry), several rounds, and prints the time to a moving picture - and for a channel that did not start, what
Kodi's log says happened.   python t_tv_rounds.py [rounds=3] [seconds to wait=70]
No YouTube. Nothing is changed in Kodi."""
import io, os, re, sys, time
import t_live_keys as t

ROUNDS = int(sys.argv[1]) if len(sys.argv) > 1 else 3
WAIT = int(sys.argv[2]) if len(sys.argv) > 2 else 70
WANT = ('Kan 11', 'Keshet 12', 'Channel 13', 'Now 14', 'i24NEWS Hebrew', 'Channel 9', 'Kan Educational', 'Makan 33')
LOG = os.path.join(os.environ['APPDATA'], 'Kodi', 'kodi.log')


def log_size():
    return os.path.getsize(LOG)


def log_since(pos):
    with io.open(LOG, encoding='utf-8', errors='replace') as f:
        f.seek(pos)
        return f.read().splitlines()


def stop():
    for p in t.rpc('Player.GetActivePlayers').get('result') or []:
        t.rpc('Player.Stop', {'playerid': p['playerid']})
    for _ in range(20):
        if not (t.rpc('Player.GetActivePlayers').get('result') or []):
            return
        time.sleep(0.5)


def moving():
    ps = t.rpc('Player.GetActivePlayers').get('result') or []
    if not ps:
        return False
    pr = t.rpc('Player.GetProperties', {'playerid': ps[0]['playerid'], 'properties': ['time', 'speed', 'live']}).get('result') or {}
    tm = pr.get('time') or {}
    secs = tm.get('hours', 0) * 3600 + tm.get('minutes', 0) * 60 + tm.get('seconds', 0)
    return pr.get('speed') == 1 and (secs >= 2 or bool(pr.get('live')))


files = (t.rpc('Files.GetDirectory', {'directory': 'plugin://plugin.video.nova/?a=tv_list&group=1', 'media': 'files'}, 60).get('result') or {}).get('files') or []
chans = []
for w in WANT:
    f = next((x for x in files if w in x['label']), None)
    if f:
        chans.append((w, f['file']))
print('%d channels, %d rounds, up to %d s each' % (len(chans), ROUNDS, WAIT))
stats = dict((w, []) for w, _ in chans)
KEEP = re.compile(r'NovaTV\] live|idanplus|OpenDemux|Error creating|OpenFile|CCurlFile.*(Failed|failed)|error <|Playlist Player|InputStream|timed out|Timeout|EXCEPTION|Traceback')
for rnd in range(ROUNDS):
    for name, path in chans:
        stop()
        pos, t0 = log_size(), time.time()
        t.rpc('Player.Open', {'item': {'file': path}}, 60)
        ok = False
        while time.time() - t0 < WAIT:
            time.sleep(1)
            if moving():
                ok = True
                break
        took = time.time() - t0
        stats[name].append(took if ok else None)
        responding = (t.rpc('JSONRPC.Ping', timeout=10).get('result') == 'pong')
        print('round %d  %-4s %5.1fs  %s%s' % (rnd + 1, 'OK' if ok else 'FAIL', took, name, '' if responding else '   !! Kodi does not answer'), flush=True)
        if not ok:
            for line in [l for l in log_since(pos) if KEEP.search(l)][:14]:
                line = re.sub(r'^\d{4}-\d\d-\d\d ', '', line)
                line = re.sub(r' T:\d+\s+', ' ', line)
                line = re.sub(r'(token|key|sig|hdnea|hdnts|auth)=[^&\s\'"|]+', r'\1=***', line)
                print('        ' + line[:200], flush=True)
            w = (t.rpc('GUI.GetProperties', {'properties': ['currentwindow']}).get('result') or {}).get('currentwindow') or {}
            print('        window after: %s %s' % (w.get('id'), w.get('label')), flush=True)
            stop()
            t.rpc('Input.Back')
        stop()
print('\nsummary (seconds to a moving picture):')
fails = 0
for name, _ in chans:
    got = stats[name]
    okv = [x for x in got if x is not None]
    fails += len(got) - len(okv)
    print('  %-18s %d/%d   %s' % (name, len(okv), len(got), ' '.join('%4.0f' % x if x is not None else 'FAIL' for x in got)))
print('TV ROUNDS: %d failure(s) in %d starts' % (fails, ROUNDS * len(chans)))
sys.exit(1 if fails else 0)
