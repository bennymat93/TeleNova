# -*- coding: utf-8 -*-
"""Copies the changed source files of the hub and the engine into the running Kodi profile (accounts untouched).
addon.xml is left alone (Kodi reads versions at start).  deploy_local.py [--check]"""
import filecmp, os, shutil, sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
KODI = os.path.join(os.environ['APPDATA'], 'Kodi', 'addons')
n = 0
for a in ('plugin.video.nova', 'plugin.video.telescope'):
    base = os.path.join(SRC, a)
    for dp, dn, fn in os.walk(base):
        dn[:] = [d for d in dn if d != '__pycache__']
        for f in fn:
            if not f.endswith(('.py', '.xml', '.po')) or f == 'addon.xml':
                continue
            s = os.path.join(dp, f)
            d = os.path.join(KODI, a, os.path.relpath(s, base))
            if not os.path.exists(d) or not filecmp.cmp(s, d, False):
                n += 1
                print(('differs ' if '--check' in sys.argv else 'copied  ') + os.path.relpath(s, SRC))
                if '--check' not in sys.argv:
                    os.makedirs(os.path.dirname(d), exist_ok=True)
                    shutil.copyfile(s, d)
print('%d file(s)' % n)
