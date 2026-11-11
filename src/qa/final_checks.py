# -*- coding: utf-8 -*-
"""Checks on a fresh install of the packaged build (run after the services are up)."""
import sys, time
sys.argv = ['x', '0', '0']
exec(open(__file__.replace('final_checks.py', 'crawl.py'), encoding='utf-8').read().split('# listing actions')[0])

ads = rpc('Addons.GetAddons', {'properties': ['enabled', 'broken', 'version'], 'installed': True})['result']['addons']
byid = {a['addonid']: a for a in ads}
print('add-ons installed: %d | disabled: %s | broken: %s' % (
    len(ads), [a['addonid'] for a in ads if not a['enabled']], [a['addonid'] for a in ads if a.get('broken')]))
for a in ('plugin.video.nova', 'plugin.video.telescope', 'plugin.program.novawizard'):
    print('   %-28s %s enabled=%s' % (a, byid[a]['version'], byid[a]['enabled']))
gone = ['skin.estuary.modified', 'script.module.six', 'script.module.future', 'script.module.beautifulsoup4', 'plugin.video.pov']
print('removed add-ons absent:', all(g not in byid for g in gone))
print('skin:', rpc('Settings.GetSettingValue', {'setting': 'lookandfeel.skin'})['result']['value'])


def ls(p, t=90):
    t0 = time.time()
    r = rpc('Files.GetDirectory', {'directory': p, 'media': 'files'}, t)
    return (r.get('result') or {}).get('files') or [], time.time() - t0, r.get('error') or r.get('timeout')

for label, p in (('search all sources "matrix"', 'plugin://plugin.video.nova/?a=hub_search&q=matrix'),
                 ('episode search (Fauda s1e1)', 'plugin://plugin.video.nova/?a=hub_search&q=Fauda&s=1&e=1'),
                 ('player button -> seasons', 'plugin://plugin.video.nova/?a=noopbuild_season_list&tmdb_id=1399'),
                 ('player button, IMDb id only', 'plugin://plugin.video.nova/?a=noop&mediatype=movie&tmdb_id=tt0133093'),
                 ('year list (search by year)', 'plugin://plugin.video.nova/?a=years&m=movie'),
                 ('radio IL', 'plugin://plugin.video.nova/?a=radio_list&by=country&v=IL'),
                 ('radio IL again (cache)', 'plugin://plugin.video.nova/?a=radio_list&by=country&v=IL'),
                 ('episodes (uncached plots)', 'plugin://plugin.video.nova/?a=episodes&id=45994&s=3'),
                 ('telegram engine static menu', 'plugin://plugin.video.telescope/?mode=kids'),
                 ('status page', 'plugin://plugin.video.nova/?a=status'),
                 ('system report', 'plugin://plugin.video.nova/?a=sysreport')):
    files, dt, err = ls(p)
    print('%-32s %3d items %5.1fs %s' % (label, len(files), dt, ('ERROR %s' % err) if err else ''))
    if 'status' in label or 'report' in label:
        for f in files[:40]:
            lab = f.get('label', '')
            if any(k in lab for k in ('✗', 'red', 'לא מותקן', 'כבוי', 'broken', 'missing')):
                print('      !', lab[:110])
