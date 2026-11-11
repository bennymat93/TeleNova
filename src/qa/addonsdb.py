"""Inspect (and with --fix repair) the Addons33.db a build ships: every add-on folder of the build must be enabled,
and rows of add-ons the build no longer contains are removed."""
import os, sqlite3, sys
root, fix = sys.argv[1], '--fix' in sys.argv
db = os.path.join(root, 'userdata', 'Database', 'Addons33.db')
present = {d for d in os.listdir(os.path.join(root, 'addons')) if os.path.isfile(os.path.join(root, 'addons', d, 'addon.xml'))}
c = sqlite3.connect(db)
cols = [r[1] for r in c.execute('pragma table_info(installed)')]
rows = {r[0]: r[1] for r in c.execute('select addonID, enabled from installed')}
disabled = sorted(a for a, e in rows.items() if not e)
missing_rows = sorted(present - set(rows))
stale = sorted(a for a in rows if a not in present and not a.startswith(('xbmc.', 'kodi.')) and
               not os.path.isdir(os.path.join(r'C:\Program Files\Kodi\addons', a)))
print('columns:', cols)
print('rows: %d | build add-ons: %d' % (len(rows), len(present)))
print('disabled:', disabled)
print('build add-ons without a row:', missing_rows)
print('rows of add-ons not in the build (and not Kodi\'s own):', stale)
if fix:
    for a in disabled:
        if a == 'plugin.program.novawizard':     # pvr.iptvsimple stays off until TeleNova switches it on
            c.execute('update installed set enabled=1 where addonID=?', (a,))
            print('  enabled', a)
    for a in stale:
        c.execute('delete from installed where addonID=?', (a,))
    for a in missing_rows:
        c.execute("insert into installed (addonID, enabled, installDate) values (?, 1, datetime('now'))", (a,))
        print('  added row', a)
    c.commit()
    c.execute('vacuum')
    print('fixed; integrity:', c.execute('pragma integrity_check').fetchone()[0])
c.close()
