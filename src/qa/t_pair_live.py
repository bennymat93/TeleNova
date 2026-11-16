# -*- coding: utf-8 -*-
"""4.2, live: "send my setup to another device" from this PC's Kodi to Kodi on the Android emulator, driven like a
viewer (JSON-RPC). The owner allowed (16/11) that this adds a logged-in device to the account; the new device is
logged out again at the end. A two-step password, if the account has one, is typed by the owner on the PC.
   python t_pair_live.py
Needs: emulator running with the build (adb), Kodi on both, the pairing code deployed to both."""
import io
import json
import os
import re
import socket
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
ADB = os.path.join(os.environ['LOCALAPPDATA'], 'Android', 'Sdk', 'platform-tools', 'adb.exe')
EMU_RPC = 9095                                   # adb forward -> the emulator's Kodi 9090
EMU_ENGINE = 9096                               # adb forward -> the emulator's Telegram engine
EMU_HOME = '/sdcard/Download/tn/.kodi'
bad = []


def say(t):
    print(time.strftime('%H:%M:%S ') + t, flush=True)


def check(cond, what):
    say(('ok    ' if cond else 'FAIL  ') + what)
    if not cond:
        bad.append(what)


def adb(*args, timeout=60):
    return subprocess.run([ADB] + list(args), capture_output=True, text=True, timeout=timeout).stdout


def rpc(port, method, params=None, timeout=30):
    s = socket.create_connection(('127.0.0.1', port), timeout=10)
    s.settimeout(timeout)
    try:
        s.sendall(json.dumps({'jsonrpc': '2.0', 'id': 7, 'method': method, 'params': params or {}}).encode())
        buf, dec = b'', json.JSONDecoder()
        while True:
            chunk = s.recv(65536)
            if not chunk:
                return {}
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
    finally:
        s.close()


def labels(port, *ls):
    r = rpc(port, 'XBMC.GetInfoLabels', {'labels': list(ls)}).get('result') or {}
    return [r.get(l, '') for l in ls]


def window(port):
    return ((rpc(port, 'GUI.GetProperties', {'properties': ['currentwindow']}).get('result') or {}).get('currentwindow') or {}).get('id')


def dialog_text(port):
    """the text of the open yes/no / ok / progress dialog"""
    return ' '.join(labels(port, 'Control.GetLabel(9)', 'Control.GetLabel(10)', 'Control.GetLabel(1)', 'Control.GetLabel(2)'))


def wait_for(fn, secs, step=0.5):
    end = time.time() + secs
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(step)
    return fn()


def code_on(port):
    m = re.search(r'\b(\d{3}) (\d{3})\b', dialog_text(port))
    return (m.group(1) + m.group(2)) if m else ''


def press_yes(port):
    """the yes/no dialog with the code: move the focus to the button labelled "yes, the same" and press it. Kodi 21
    draws its progress window with the same layout file, whose focused button is Cancel - so the label decides,
    never the window or the control id"""
    yes = (u'כן, אותו קוד', 'Yes, the same')   # "כן, אותו קוד"
    for _ in range(6):
        cur = labels(port, 'System.CurrentControl')[0]
        if cur in yes:
            rpc(port, 'Input.Select')
            return True
        rpc(port, 'Input.Right' if _ % 2 == 0 else 'Input.Left')
        time.sleep(0.4)
    return False


def engine_call(method, **params):
    """the emulator's Telegram engine, through adb forward of its own port"""
    info = json.loads(adb('shell', 'cat', EMU_HOME + '/userdata/addon_data/plugin.video.telescope/port.json'))
    # the PC's own engine holds the same port number here: forward a free local port to the emulator's
    adb('forward', 'tcp:%d' % EMU_ENGINE, 'tcp:%d' % info['port'])
    import urllib.request
    req = urllib.request.Request('http://127.0.0.1:%d/rpc' % EMU_ENGINE, method='POST',
                                 data=json.dumps({'method': method, 'params': params, 'secret': info.get('secret')}).encode(),
                                 headers={'Content-Type': 'application/json',
                                          'Host': '127.0.0.1:%d' % info['port']})   # the engine accepts its own port only
    return json.loads(urllib.request.urlopen(req, timeout=60).read().decode())


# ---------------------------------------------------------------- 0. both sides up
adb('forward', 'tcp:%d' % EMU_RPC, 'tcp:9090')
check(rpc(9090, 'JSONRPC.Ping').get('result') == 'pong', 'PC Kodi answers')
check(wait_for(lambda: rpc(EMU_RPC, 'JSONRPC.Ping').get('result') == 'pong', 60, 3), 'emulator Kodi answers')
st = engine_call('status').get('result') or {}
check(not st.get('authorized'), 'the emulator starts NOT logged in to Telegram')

# ---------------------------------------------------------------- 1. new device: receive
rpc(EMU_RPC, 'GUI.ActivateWindow', {'window': 'videos', 'parameters': ['plugin://plugin.video.nova/?a=pair_receive']})
port = 0
for _ in range(90):                               # a slow device takes a while to open the screen
    out = adb('shell', 'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null')
    # ports in LISTEN state (st 0A) on the emulator - the address on screen counts only when its port really
    # listens (the dialog can still show the previous run's text for a while)
    listening = set(int(h, 16) for h in re.findall(r'^\s*\d+:\s+[0-9A-F]+:([0-9A-F]{4})\s+[0-9A-F]+:[0-9A-F]{4}\s+0A\s', out, re.M))
    txt = dialog_text(EMU_RPC)
    m = re.search(r':(\d{4,5})\b', txt)
    if m and int(m.group(1)) in listening:
        port = int(m.group(1))
        break
    time.sleep(1)
check(port > 0, 'the new device shows its address: %s' % (dialog_text(EMU_RPC)[:160]))
adb('forward', 'tcp:%d' % port, 'tcp:%d' % port)       # the emulator's network is behind NAT: the PC reaches it here

# ---------------------------------------------------------------- 2. configured device: find it (beacon) or type it
rpc(9090, 'GUI.ActivateWindow', {'window': 'videos', 'parameters': ['plugin://plugin.video.nova/?a=pair_send']})
say('PC: listening for beacons (8 s) ...')
listed = wait_for(lambda: window(9090) == 12000 and 'TeleNova' in labels(9090, 'System.CurrentControl')[0], 25)
if listed:
    check(True, 'PC: the new device was found by its beacon and is listed')
    rpc(9090, 'Input.Select')
else:
    say('PC: not heard - typing the address')
    if window(9090) == 12002:
        rpc(9090, 'Input.Select')
    wait_for(lambda: rpc(9090, 'XBMC.GetInfoBooleans', {'booleans': ['Window.IsActive(virtualkeyboard)']}).get('result', {}).get('Window.IsActive(virtualkeyboard)'), 15)
    rpc(9090, 'Input.SendText', {'text': '127.0.0.1:%d' % port, 'done': True})

# ---------------------------------------------------------------- 3. the same code on both screens, confirmed on both
def settled(port, secs):
    """the code once the dialog shows the same digits on three reads 1 s apart (a slow screen can still carry the
    previous dialog's text for a moment)"""
    end, seen = time.time() + secs, []
    while time.time() < end:
        c = code_on(port)
        seen = (seen + [c])[-3:]
        if c and len(seen) == 3 and len(set(seen)) == 1:
            return c
        time.sleep(1)
    return seen[-1] if seen else ''


c_pc = settled(9090, 40)
c_emu = settled(EMU_RPC, 40)
if c_pc and c_emu and c_pc != c_emu:               # give the slower screen 20 s more to draw the new dialog
    c_emu = wait_for(lambda: code_on(EMU_RPC) == c_pc and c_pc, 20) or code_on(EMU_RPC)
check(bool(c_pc) and c_pc == c_emu, 'both screens show the same code: PC %s / emulator %s' % (c_pc, c_emu))
if not c_pc or c_pc != c_emu:
    # a viewer who sees two different codes answers "No" - the test never confirms a mismatch
    say('codes differ: answering No on both and stopping')
    for port in (EMU_RPC, 9090):
        rpc(port, 'Input.Back')
    print('\nPAIR LIVE FAILED: codes differ')
    sys.exit(1)
check(press_yes(EMU_RPC), 'emulator: "yes, the same" pressed')
time.sleep(1)
check(press_yes(9090), 'PC: "yes, the same" pressed')

# ---------------------------------------------------------------- 4. setup + login; a 2FA password is the owner's
t0 = time.time()
asked = False
result_pc = ''
while time.time() - t0 < 300:
    if rpc(9090, 'XBMC.GetInfoBooleans', {'booleans': ['Window.IsActive(virtualkeyboard)']}).get('result', {}).get('Window.IsActive(virtualkeyboard)'):
        if not asked:
            say('>>> the account has two-step verification: the OWNER types the password on the PC now <<<')
            asked = True
    w = window(9090)
    txt = dialog_text(9090)
    if w == 12002 and ('נשלחו' in txt or 'sent to' in txt or 'לא הושלמה' in txt or 'did not finish' in txt):
        result_pc = txt
        break
    time.sleep(1.5)
say('PC result: ' + result_pc[:200])
check('נשלחו' in result_pc or 'sent to' in result_pc, 'PC: the setup was sent')
check('טלגרם מחובר במכשיר החדש' in result_pc or 'logged in on the new device' in result_pc, 'PC: the new device is logged in')
rpc(9090, 'Input.Select')
res_emu = wait_for(lambda: dialog_text(EMU_RPC) if window(EMU_RPC) == 12002 else '', 60)
say('emulator result: ' + res_emu[:200])
rpc(EMU_RPC, 'Input.Select')

# ---------------------------------------------------------------- 5. the new device: own session, settings arrived
st = engine_call('status').get('result') or {}
check(bool(st.get('authorized')), 'the emulator engine is logged in: %s' % ((st.get('me') or {}).get('name', '')[:2] + '...' if st.get('me') else st))
pc_st = json.loads(json.dumps(rpc(9090, 'JSONRPC.Ping')))
sess_pc = os.path.join(os.environ['APPDATA'], 'Kodi', 'userdata', 'addon_data', 'plugin.video.telescope', 'telegram.session')
emu_sess = adb('shell', 'ls -la ' + EMU_HOME + '/userdata/addon_data/plugin.video.telescope/telegram.session')
check(os.path.exists(sess_pc) and 'telegram.session' in emu_sess, 'each device has its own session file')
pc_ok = engine_call  # placeholder to keep names apart
# the PC's own login still works (its session was not copied or ended)
import urllib.request
info = json.load(open(os.path.join(os.environ['APPDATA'], 'Kodi', 'userdata', 'addon_data', 'plugin.video.telescope', 'port.json')))
req = urllib.request.Request('http://127.0.0.1:%d/rpc' % info['port'], method='POST',
                             data=json.dumps({'method': 'status', 'params': {}, 'secret': info.get('secret')}).encode(),
                             headers={'Content-Type': 'application/json'})
pc = json.loads(urllib.request.urlopen(req, timeout=60).read().decode()).get('result') or {}
check(bool(pc.get('authorized')), 'the PC is still logged in')

# ---------------------------------------------------------------- 6. clean up: the test device leaves the account
out = engine_call('logout')
st = engine_call('status').get('result') or {}
check(not st.get('authorized'), 'the emulator session was logged out of the account again')
print('\n' + ('PAIR LIVE OK' if not bad else 'PAIR LIVE FAILED: %d' % len(bad)))
