# -*- coding: utf-8 -*-
"""Diagnosis: the PC's "send" screens against a local stand-in receiver (no Telegram login: the stand-in sends a
token Telegram refuses). Prints every window / focus change, and what each key press hit."""
import io
import json
import os
import socket
import sys
import threading
import time
import types

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'plugin.video.nova'))
for n in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules.setdefault(n, types.ModuleType(n))
from resources.lib import pairing as P, pairflow as F  # noqa: E402


def rpc(m, p=None):
    s = socket.create_connection(('127.0.0.1', 9090), timeout=10)
    s.settimeout(30)
    s.sendall(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': m, 'params': p or {}}).encode())
    buf = b''
    while True:
        buf += s.recv(65536)
        try:
            return json.loads(buf.decode('utf-8'))
        except ValueError:
            pass


def state():
    r = rpc('XBMC.GetInfoLabels', {'labels': ['System.CurrentWindow', 'System.CurrentControlId', 'System.CurrentControl',
                                              'Window.Property(xmlfile)']}).get('result') or {}
    return '%s [%s] focus=%s "%s"' % (r.get('System.CurrentWindow'), r.get('Window.Property(xmlfile)'),
                                      r.get('System.CurrentControlId'), r.get('System.CurrentControl'))


class AutoUI(object):
    def status(self, k, **kw):
        print('   receiver:', k)

    def confirm_code(self, code, peer):
        print('   receiver: code', code)
        return True

    def ask_password(self, h):
        return None

    def cancelled(self):
        return False


class FakeEng(object):
    def wait_ready(self, s):
        return True

    def qr_token(self):
        return 'AAAA'                                  # Telegram refuses it: nothing happens to the account

    def qr_wait(self, s):
        time.sleep(1)
        return 'wait'


class Host(object):
    def apply_bundle(self, b):
        print('   receiver: bundle with', sorted((b.get('settings') or {}).keys()))
        return 1


lst = P.Listener('DIAG receiver')
res = {}
th = threading.Thread(target=lambda: res.setdefault('r', F.run_receiver(AutoUI(), FakeEng(), Host(), 'DIAG receiver', listener=lst, wait=120)))
th.start()
rpc('GUI.ActivateWindow', {'window': 'videos', 'parameters': ['plugin://plugin.video.nova/?a=pair_send']})
last, end, pressed = '', time.time() + 90, set()
while time.time() < end and th.is_alive():
    st = state()
    if st != last:
        print(time.strftime('%H:%M:%S'), st)
        last = st
    if 'DialogSelect' in st and 'DIAG' in st and 'select' not in pressed:
        pressed.add('select')
        print('   >> Input.Select (choose the device)')
        rpc('Input.Select')
    if 'DialogConfirm' in st or 'DialogYesNo' in st:
        if 'yes' not in pressed:
            pressed.add('yes')
            print('   >> focus is on', st)
            if not st.split('focus=')[1].startswith('11'):
                rpc('Input.Right')
                time.sleep(0.4)
                print('   >> after Right:', state())
            print('   >> Input.Select (confirm)')
            rpc('Input.Select')
    time.sleep(0.25)
th.join(30)
print('receiver result:', res.get('r'))
print('PC log:', [l.strip()[-160:] for l in open(os.path.join(os.environ['APPDATA'], 'Kodi', 'kodi.log'), encoding='utf-8', errors='replace') if 'pairing send' in l][-1:])
