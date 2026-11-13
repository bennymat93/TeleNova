# -*- coding: utf-8 -*-
"""Live: which view does a list open in, and does it change after it is shown? Opens plugin paths in the running
Kodi and samples Container.Viewmode / Container.Content every 0.15 s for 5 s.
   python t_view_live.py            (the standard paths)       python t_view_live.py <plugin url> ..."""
import sys, time
import t_live_keys as t

PATHS = sys.argv[1:] or [
    'plugin://plugin.video.nova/',
    'plugin://plugin.video.nova/?a=media_root&m=movie',
    'plugin://plugin.video.nova/?a=list&m=movie&path=%2Ftrending%2Fmovie%2Fweek',
    'plugin://plugin.video.nova/?a=list&m=tv&path=%2Ftrending%2Ftv%2Fweek',
    'plugin://plugin.video.nova/?a=accounts',
    'plugin://plugin.video.telescope/',
]


def L(*names):
    return t.rpc('XBMC.GetInfoLabels', {'labels': list(names)}).get('result') or {}


bad = 0
for p in PATHS:
    t.rpc('GUI.ActivateWindow', {'window': 'videos', 'parameters': [p, 'return']})
    t0, seen, last = time.time(), [], None
    while time.time() - t0 < 5:
        r = L('Container.Viewmode', 'Container.Content', 'Container.NumItems', 'Container.FolderPath')
        here = (r.get('Container.FolderPath') or '').replace('%2f', '/').replace('%2F', '/')
        if here.rstrip('/') == p.replace('%2F', '/').rstrip('/') and (r.get('Container.NumItems') or '0') != '0':
            cur = (r.get('Container.Viewmode'), r.get('Container.Content'))
            if cur != last:
                seen.append(('%.1fs' % (time.time() - t0),) + cur)
                last = cur
        time.sleep(0.15)
    views = [s[1] for s in seen]
    flick = len(set(views)) > 1
    bad += flick
    print('%s %s\n      %s' % ('FLICKER' if flick else 'steady ', p[:90], seen))
print('VIEW LIVE OK' if not bad else 'VIEW LIVE: %d of %d lists change their view after they are shown' % (bad, len(PATHS)))
sys.exit(1 if bad else 0)
