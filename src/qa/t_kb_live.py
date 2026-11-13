# -*- coding: utf-8 -*-
"""Live: the search keyboard's suggestion panel in the running Kodi. Opens the hub search, types, reads what the
panel shows, moves onto the panel and presses a suggestion like a viewer would, closes the keyboard without
searching."""
import sys, time
import t_live_keys as t          # (it already makes stdout UTF-8)


def L(*names):
    return t.rpc('XBMC.GetInfoLabels', {'labels': list(names)}).get('result') or {}


def cur():
    return L('System.CurrentControlId').get('System.CurrentControlId') or ''


def panel():
    n = L('Container(9010).NumItems').get('Container(9010).NumItems') or '0'
    n = min(int(n) if n.isdigit() else 0, 9)
    got = L(*['Container(9010).ListItemAbsolute(%d).Label' % i for i in range(n)])
    return [got.get('Container(9010).ListItemAbsolute(%d).Label' % i) for i in range(n)]


def kb_open():
    r = t.rpc('XBMC.GetInfoBooleans', {'booleans': ['Window.IsActive(virtualkeyboard)']}).get('result') or {}
    return bool(r.get('Window.IsActive(virtualkeyboard)'))


bad = []
if kb_open():
    t.rpc('Input.Back')
    time.sleep(1.5)
t.rpc('Addons.ExecuteAddon', {'addonid': 'plugin.video.nova', 'params': {'a': 'hub_search'}, 'wait': False})
for _ in range(20):
    time.sleep(0.5)
    if kb_open():
        break
prop = 'Window(home).Property(bn.search)'
print('keyboard open:', kb_open(), '| search property:', L(prop).get(prop))
time.sleep(2.5)
print('nothing typed ->', panel())
for text in ('matr', u'פאו'):
    t.rpc('Input.SendText', {'text': text, 'done': False})
    time.sleep(4)
    p = panel()
    print('%s -> %s' % (text, p))
    if not p:
        bad.append('no suggestions for ' + text)
for mv in ['Left'] * 4 + ['Right'] * 8:                 # onto a key of the keyboard, then up onto the panel
    c = cur()
    if c.isdigit() and (65 <= int(c) <= 200 or int(c) in (8, 32)):
        break
    t.rpc('Input.' + mv)
    time.sleep(0.3)
for _ in range(8):
    if cur() == '9010':
        break
    t.rpc('Input.Up')
    time.sleep(0.4)
if cur() != '9010':
    bad.append('the panel cannot be reached with the arrows')
else:
    want = L('Container(9010).ListItem.Label').get('Container(9010).ListItem.Label')
    t.rpc('Input.Select')
    time.sleep(3)
    now = L('Control.GetLabel(312).index(1)').get('Control.GetLabel(312).index(1)')
    print('pressed %r -> the box holds %r, keyboard still open: %s' % (want, now, kb_open()))
    if now != want or not kb_open():
        bad.append('a press did not fill the box')
if kb_open():
    t.rpc('Input.Back')
time.sleep(1.5)
print('closed:', not kb_open(), '| property after: %r' % L(prop).get(prop))
if kb_open() or L(prop).get(prop):
    bad.append('keyboard / property left behind')
print('KEYBOARD LIVE OK' if not bad else 'KEYBOARD LIVE: %s' % bad)
sys.exit(1 if bad else 0)
