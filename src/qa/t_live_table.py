# -*- coding: utf-8 -*-
"""The licensed-failover table (livefail.CHANNELS): no name twice, no paid channel, every Idan+ id exists in the
Idan+ catalogue (when Idan+ is installed in this Kodi). No Kodi needed."""
import io, os, sys, types

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
for n in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules.setdefault(n, types.ModuleType(n))
HERE = os.path.dirname(os.path.abspath(__file__))
src = io.open(os.path.join(HERE, '..', 'plugin.video.nova', 'resources', 'lib', 'livefail.py'), encoding='utf-8').read()
ns = {}
exec(compile(src.replace('from .epg import norm', 'norm = lambda s: s.strip().lower()'), 'livefail', 'exec'), ns)
CH = ns['CHANNELS']
bad = []
names = [x.strip().lower() for names, _, _ in CH.values() for x in names]
for x in sorted(set(names)):
    if names.count(x) > 1:
        bad.append('name twice: ' + x)
for key, (nm, direct, idan) in CH.items():
    if not direct and not idan:
        bad.append('no source: ' + key)
    for x in nm:
        if ns['is_paid_il'](x):
            bad.append('paid pattern matches %s (%s)' % (x, key))
        if ns['key_for'](x) != key:
            bad.append('key_for(%s) = %s, not %s' % (x, ns['key_for'](x), key))
    for u in direct:
        if ns['is_restream'](u):
            bad.append('restream as a direct source: ' + key)
cat = os.path.join(os.environ.get('APPDATA', ''), 'Kodi', 'addons', 'plugin.video.idanplus', 'resources', 'channels.json')
if os.path.exists(cat):
    txt = io.open(cat, encoding='utf-8').read()
    for key, (_, _, idan) in CH.items():
        for u, module, mode in idan:
            if '"%s"' % u not in txt:
                bad.append('not in the Idan+ catalogue: %s (%s)' % (u, key))
else:
    print('Idan+ not installed here - catalogue check skipped')
print('%d channels, %d with a direct stream, %d Idan+ entries' % (
    len(CH), sum(1 for v in CH.values() if v[1]), sum(len(v[2]) for v in CH.values())))
for b in bad:
    print('FAIL', b)
print('LIVE TABLE OK' if not bad else 'LIVE TABLE: %d problems' % len(bad))
sys.exit(1 if bad else 0)
