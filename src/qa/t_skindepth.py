# -*- coding: utf-8 -*-
"""6.5.0: skinpatch.depth on a copy of the installed skin.fentastic xml (or a skin given as argv[1])."""
import os
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'plugin.video.nova', 'resources', 'lib'))
import skinpatch as sp  # noqa: E402

bad = []


def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok:
        bad.append(what)


FILES = ('View_60_BN.xml', 'View_62_BNEpisodes.xml')
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ['APPDATA'], 'Kodi', 'addons', 'skin.fentastic', 'xml')
tmp = tempfile.mkdtemp()
try:
    for f in FILES:
        shutil.copy(os.path.join(src, f), tmp)
    orig = {f: open(os.path.join(tmp, f), encoding='utf-8', newline='').read() for f in FILES}
    first = sp.depth(tmp)
    check(first == sum(sp.DEPTH_MARK not in orig[f] for f in FILES), 'first run patched %d file(s)' % first)
    check(sp.depth(tmp) == 0, 'second run changes nothing (idempotent)')
    for f in FILES:
        t = open(os.path.join(tmp, f), encoding='utf-8', newline='').read()
        try:
            root = ET.fromstring(t.encode('utf-8'))
            ok = True
        except ET.ParseError as e:
            ok, root = False, None
            print(e)
        check(ok, f + ' still parses')
        check(t.count(sp.DEPTH_MARK) == 1, f + ': one marker')
        check(t.count('effect="zoom"') - orig[f].count('effect="zoom"') == (0 if sp.DEPTH_MARK in orig[f] else 2),
              f + ': two focus-lift animations')
        check(('\r\n' in orig[f]) == ('\r\n' in t) and t.count('\n') == t.count('\r\n') or '\r\n' not in t,
              f + ': line endings kept')
        if root is not None:
            fl = root.find('.//focusedlayout')
            check(fl is not None and fl[0].find('texture').text == 'shadows/shadow-24.png', f + ': shadow first in focus')
    # a changed skin: one anchor missing -> untouched
    t = orig[FILES[0]].replace('<focusedlayout height="90" width="690">', '<focusedlayout height="91" width="690">')
    check(sp.depth_text(t, sp._depth_edits()[FILES[0]]) == t, 'missing anchor -> no change')
    t2 = orig[FILES[1]].replace('\r\n', '\n')
    check(sp.depth_text(t2, sp._depth_edits()[FILES[1]]) != t2, 'LF copy of View_62 patches too')
    check(sp.depth_text('<a/>', []) == '<a/>', 'no focusedlayout -> no change')
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print('FAILED: %d' % len(bad) if bad else 'ALL OK')
sys.exit(1 if bad else 0)
