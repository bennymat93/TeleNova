# -*- coding: utf-8 -*-
"""6.0.1 (W-17): every local download / page link on the site's pages points at a file that is in the repository.

A release that replaces a versioned file (ios/TeleNova-Web-<v>.ipa, mac/BN-Stream-macOS-<v>.zip) and forgets a page
gave the owner a 404. Run before every push:  python src/qa/t_links.py
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PAGES = ['index.html', 'guide.html', 'sources_guide.html', 'ios/index.html', 'mac/index.html', 'apk/index.html',
         'README.md', 'DOWNLOADS.md', 'ios/README-app.md']
SITE = 'https://bennymat93.github.io/TeleNova/'
bad = []
seen = 0
for page in PAGES:
    path = os.path.join(ROOT, page)
    if not os.path.exists(path):
        continue
    text = open(path, encoding='utf-8').read()
    base = os.path.dirname(path)
    links = re.findall(r'href="([^"]+)"', text) + re.findall(r'\]\(([^)\s]+)\)', text)
    for href in links:
        if href.startswith(SITE):
            target, here = href[len(SITE):], ROOT
        elif re.match(r'^(?:[a-z]+:|#|//)', href):
            continue
        else:
            target, here = href, base
        target = target.split('#')[0].split('?')[0]
        if not target:
            continue
        full = os.path.normpath(os.path.join(here, target))
        if target.endswith('/'):
            full = os.path.join(full, 'index.html')
        seen += 1
        if not os.path.exists(full):
            bad.append('%s -> %s' % (page, href))
for b in bad:
    print('FAIL ' + b)
print('LINKS %s (%d local links checked)' % ('FAIL' if bad else 'OK', seen))
sys.exit(1 if bad else 0)
