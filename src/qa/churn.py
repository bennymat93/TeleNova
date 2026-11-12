# -*- coding: utf-8 -*-
"""Only the rapid zapping part of stress.py (channels and radio stations alternating, stop at random moments).
   churn.py [rounds] [setting=value ...]   - settings are applied through JSON-RPC before the run."""
import json, os, sys, time
args = sys.argv[1:]
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'stress.py'), encoding='utf-8').read()
exec(src.split('N = \'plugin://plugin.video.nova/\'')[0])          # rpc(), ls(), alive()
N = 'plugin://plugin.video.nova/'
rounds = int(args[0]) if args and args[0].isdigit() else 2
for a in args:
    if '=' in a:
        k, v = a.split('=', 1)
        val = json.loads(v)
        print('set %s = %r -> %s' % (k, val, rpc('Settings.SetSettingValue', {'setting': k, 'value': val}, 15).get('result')))
time.sleep(2)
chans = [f['file'] for f in ((ls(N + '?a=tv_list&group=1')[0].get('result') or {}).get('files') or [])][:8]
radios = [f['file'] for f in ((ls(N + '?a=radio_list&by=country&v=IL')[0].get('result') or {}).get('files') or [])][:6]
seq = []
for i in range(max(len(chans), len(radios))):
    seq += chans[i:i + 1] + radios[i:i + 1]
print('zapping %d channels + %d stations, %d rounds' % (len(chans), len(radios), rounds), flush=True)
dead = None
REAL = 'raw' not in args          # default: behave like a viewer - no new command while Kodi shows its busy dialog
BUSY = ['Window.IsActive(busydialog)', 'Window.IsActive(busydialognocancel)']
waited_busy = 0


def busy():
    r = rpc('XBMC.GetInfoBooleans', {'booleans': BUSY}, 10).get('result') or {}
    return any(r.values())


for i, p in enumerate(seq * rounds):
    if REAL:
        t_b = time.time()
        while busy() and time.time() - t_b < 25:      # the remote is blocked while this dialog is up
            time.sleep(0.2)
        waited_busy += time.time() - t_b
    m = __import__('re').search(r'a=tv_play&id=(\d+)', p)
    if m and 'asfile' not in args:
        # the way the menu does it: the channel entry is NOT a playable file - clicking it runs TeleNova, which asks
        # Kodi to open the channel. Opening the plugin address as a file makes Kodi wait for a stream address that
        # never comes while the channel opens underneath it.
        rpc('Player.Open', {'item': {'channelid': int(m.group(1))}}, 30)
    else:
        rpc('Player.Open', {'item': {'file': p}}, 30)
    time.sleep([0.2, 1.0, 3.0, 0.5, 6.0][i % 5])
    if i % 3 == 0:
        if REAL:                                      # Stop is a key press too: not possible under the busy dialog
            t_b = time.time()
            while busy() and time.time() - t_b < 25:
                time.sleep(0.2)
            waited_busy += time.time() - t_b
        for pl in rpc('Player.GetActivePlayers').get('result') or []:
            rpc('Player.Stop', {'playerid': pl['playerid']})
    if not alive():
        time.sleep(15)
        if not alive():
            dead = (i, p)
            break
if dead:
    print('KODI STOPPED ANSWERING after item %d: %s' % (dead[0], dead[1][:110]))
else:
    for pl in rpc('Player.GetActivePlayers').get('result') or []:
        rpc('Player.Stop', {'playerid': pl['playerid']})
    time.sleep(6)
    print('survived %d items | alive: %s | mode: %s | waited for the busy dialog: %.0fs' % (
        len(seq) * rounds, alive(), 'viewer-like' if REAL else 'raw commands', waited_busy))
