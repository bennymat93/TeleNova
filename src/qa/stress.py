# -*- coding: utf-8 -*-
"""Extreme QA through Kodi's JSON-RPC: parallel plugin calls, hostile parameters, rapid play/stop churn."""
import json, os, socket, sys, threading, time
from urllib.parse import quote

sys.stdout.reconfigure(encoding='utf-8')


def rpc(method, params=None, timeout=90):
    s = None
    for attempt in range(8):        # Kodi's TCP server accepts a few connections at a time: a refusal is retried
        try:
            s = socket.create_connection(('127.0.0.1', 9090), timeout=5)
            break
        except OSError as e:
            err = str(e)
            time.sleep(0.4 + 0.3 * attempt)
    if s is None:
        return {'dead': err}
    s.settimeout(timeout)
    try:
        s.sendall(json.dumps({'jsonrpc': '2.0', 'id': 7, 'method': method, 'params': params or {}}).encode())
        buf, dec = b'', json.JSONDecoder()
        while True:
            chunk = s.recv(65536)
            if not chunk:
                return {'dead': 'closed'}
            buf += chunk
            txt, pos = buf.decode('utf-8', 'ignore'), 0
            while pos < len(txt):
                try:
                    obj, end = dec.raw_decode(txt, pos)
                except ValueError:
                    break
                pos = end
                while pos < len(txt) and txt[pos].isspace():
                    pos += 1
                if obj.get('id') == 7:
                    return obj
    except socket.timeout:
        return {'timeout': True}
    except OSError as e:
        return {'dead': str(e)}
    finally:
        s.close()


def ls(p, t=90):
    t0 = time.time()
    r = rpc('Files.GetDirectory', {'directory': p, 'media': 'files'}, t)
    return r, time.time() - t0


def alive():
    return rpc('JSONRPC.Ping', timeout=10).get('result') == 'pong'


N = 'plugin://plugin.video.nova/'
T = 'plugin://plugin.video.telescope/'
fails = []

# ---------------------------------------------------------------- 1. hostile / malformed parameters
hostile = [
    N + '?a=', N + '?a=doesnotexist', N + '?a=list', N + '?a=list&m=movie', N + '?a=list&m=xx&path=%2Fnope',
    N + '?a=list&m=movie&path=..%2F..%2Fetc', N + '?a=seasons', N + '?a=seasons&id=abc', N + '?a=seasons&id=999999999',
    N + '?a=episodes&id=1399', N + '?a=episodes&id=1399&s=999', N + '?a=episodes&id=-1&s=-1', N + '?a=genres', N + '?a=genres&m=zz',
    N + '?a=years&m=', N + '?a=langs&m=tv', N + '?a=media_root', N + '?a=media_root&m=', N + '?a=tv_list&group=999',
    N + '?a=tv_list&group=abc', N + '?a=tv_country', N + '?a=tv_country&cc=ZZ', N + '?a=radio_list', N + '?a=radio_list&by=nope&v=x',
    N + '?a=radio_list&by=country&v=ZZ', N + '?a=radio_list&by=country&v=' + quote('<script>'), N + '?a=lib_cat', N + '?a=lib_cat&cat=nope',
    N + '?a=lib_open', N + '?a=lib_open&id=nope', N + '?a=favs&kind=nope', N + '?a=topic_root', N + '?a=topic_cat&s=x&c=y',
    N + '?a=yt_channel', N + '?a=yt_channel&id=notachannel', N + '?a=ia_search', N + '?a=ia_search&q=' + quote('"; drop'),
    N + '?a=hub_search&q=' + quote('א' * 300), N + '?a=hub_search&q=%00%ff', N + '?a=hub_search&q=x&s=abc&e=def',
    N + '?a=noopplay_media&mediatype=episode&tmdb_id=1399&season=x&episode=y', N + '?a=noopbuild_episode_list&tmdb_id=1399',
    N + '?a=noopbuild_season_list&tmdb_id=', N + '?a=help_show', N + '?a=sysfix', N + '?a=prov_toggle', N + '?a=fav_rm', N + '?a=acc',
    N + '?a=tv_do', N + '?a=lb_play', N + '?a=gd_play', N + '?' + 'x=' + 'y' * 4000, N + '?a=list&m=movie&path=%2Fmovie%2Fpopular&page=99999',
    T + '?mode=doesnotexist', T + '?mode=list', T + '?mode=list&kind=zz&cat=zz', T + '?mode=list&kind=movie&cat=discover&f=notjson',
    T + '?mode=seasons', T + '?mode=episodes', T + '?mode=genres&kind=zz', T + '?mode=hub', T + '?mode=hub&type=movie&tmdb=abc&fast=1',      # fast: never writes to a bot when an account is connected
    T + '?mode=chiko&chat=abc',      # (mode=play asks "log in to Telegram?" - a modal dialog blocks the RPC channel) T + '?mode=list&kind=movie&cat=trending&page=-5',
]
print('== 1. hostile parameters: %d calls' % len(hostile), flush=True)
slow = []
for p in hostile:
    r, dt = ls(p, 60)
    if r.get('timeout'):
        fails.append(('hostile TIMEOUT (a dialog is probably open)', p[:110]))
        rpc('Input.Back'); rpc('Input.Back')
    elif r.get('dead'):
        fails.append(('hostile KODI DEAD', p[:110]))
        break
    if dt > 15:
        slow.append((round(dt, 1), p[:100]))
    win = (rpc('GUI.GetProperties', {'properties': ['currentwindow']}).get('result') or {}).get('currentwindow') or {}
    if win.get('id') in (10100, 10101, 10103, 12000, 12002, 10147, 12003):       # a dialog was left open
        rpc('Input.Back')
        time.sleep(0.3)
print('   kodi alive: %s | slow >15s: %s' % (alive(), slow), flush=True)

# ---------------------------------------------------------------- 2. parallel load (home-screen burst x4)
burst = [N + '?a=list&m=movie&path=%2Ftrending%2Fmovie%2Fweek', N + '?a=list&m=tv&path=%2Ftv%2Fpopular',
         N + '?a=tv_list&group=1', N + '?a=radio_list&by=country&v=IL', N + '?a=history', N + '?a=favs',
         N + '?a=list&m=movie&path=%2Fmovie%2Fnow_playing', N + '?a=list&m=tv&path=%2Ftrending%2Ftv%2Fweek',
         T + '?mode=list&kind=movie&cat=popular', T + '?mode=list&kind=tv&cat=popular', N, T,
         N + '?a=radio_list&by=country&v=RU', N + '?a=radio_list&by=language&v=hebrew', N + '?a=libs', N + '?a=status']
print('== 2. parallel load: 3 rounds x %d simultaneous plugin calls' % len(burst), flush=True)
for rnd in range(3):
    out = {}

    def work(p):
        r, dt = ls(p, 120)
        out[p] = (len((r.get('result') or {}).get('files') or []), round(dt, 1), r.get('error') or r.get('timeout') or r.get('dead'))
    ths = [threading.Thread(target=work, args=(p,)) for p in burst]
    t0 = time.time()
    [t.start() for t in ths]
    [t.join(150) for t in ths]
    bad = {p[-45:]: v for p, v in out.items() if v[2] or (v[0] == 0 and 'history' not in p)}
    print('   round %d: %.1fs total, slowest %.1fs, failed/empty: %s' % (rnd + 1, time.time() - t0, max(v[1] for v in out.values()), bad or 'none'), flush=True)
    for p, v in bad.items():
        fails.append(('parallel round %d' % (rnd + 1), '%s %s' % (p, v)))
print('   kodi alive: %s' % alive(), flush=True)

# ---------------------------------------------------------------- 3. rapid play / stop / zap churn
chans = [f['file'] for f in ((ls(N + '?a=tv_list&group=1')[0].get('result') or {}).get('files') or [])][:8]
radios = [f['file'] for f in ((ls(N + '?a=radio_list&by=country&v=IL')[0].get('result') or {}).get('files') or [])][:6]
print('== 3. churn: zapping %d channels and %d stations, stop at random moments' % (len(chans), len(radios)), flush=True)
# The zapping itself lives in churn.py: channels are opened the way the menu opens them, and no command is sent while
# Kodi shows its busy dialog (a remote cannot send one then). Commands fired INTO the busy dialog freeze Kodi about
# one run in three - on the original 3.2.0 build as well (churn.py raw): a Kodi limit, reachable only by remote-
# control apps, not by the on-screen menus.
import subprocess
res = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'churn.py'), '2'],
                     capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
last = (res.stdout.strip().splitlines() or ['no output'])[-1]
print('   ' + last, flush=True)
if 'STOPPED' in last or 'survived' not in last:
    fails.append(('churn', last[:150]))
for pl in rpc('Player.GetActivePlayers').get('result') or []:
    rpc('Player.Stop', {'playerid': pl['playerid']})
time.sleep(8)
print('   kodi alive: %s | players left: %s' % (alive(), rpc('Player.GetActivePlayers').get('result')), flush=True)

# ---------------------------------------------------------------- 4. after the abuse: everything still works
r, dt = ls(N)
print('== 4. after stress: main menu %d items in %.1fs' % (len((r.get('result') or {}).get('files') or []), dt), flush=True)
if not (r.get('result') or {}).get('files'):
    fails.append(('post-stress', 'main menu empty'))
print('\nSTRESS FAILURES: %d' % len(fails))
for f in fails:
    print('   %s -> %s' % f)
