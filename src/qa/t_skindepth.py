# -*- coding: utf-8 -*-
"""6.5.0: skinpatch.depth on a copy of the installed skin.fentastic xml (or a skin given as argv[1]).
6.5.1: the copy is made pristine first (the installed skin already carries the patch after the first start of
6.5.0, which made every check here empty and one of them fail); the installed files are never written."""
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


def unpatch(t, edits):
    """the exact inverse of skinpatch.depth_text (last edit first); None when the text is not what the patch wrote"""
    nl = '\r\n' if '\r\n' in t else '\n'
    for scope, old, new in reversed(edits):
        old, new = old.replace('\n', nl), new.replace('\n', nl)
        if t.count(new) != 1:
            return None
        t = t.replace(new, old, 1)
    return t


def read(p):
    with open(p, encoding='utf-8', newline='') as f:
        return f.read()


def write(p, t):
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(t)


FILES = ('View_60_BN.xml', 'View_62_BNEpisodes.xml')
if len(sys.argv) > 1:
    src = sys.argv[1]
else:
    src = os.path.join(os.environ.get('APPDATA', ''), 'Kodi', 'addons', 'skin.fentastic', 'xml')
    if not all(os.path.exists(os.path.join(src, f)) for f in FILES):
        print('SKIP: skin.fentastic not installed')
        sys.exit(0)
tmp = tempfile.mkdtemp()
try:
    edits = sp._depth_edits()
    orig = {}
    for f in FILES:
        shutil.copy(os.path.join(src, f), tmp)
        t = installed = read(os.path.join(tmp, f))
        if sp.DEPTH_MARK in t:
            t = unpatch(t, edits[f])
            check(t is not None, f + ': pristine copy built')
            if t is None:
                t = installed
            else:
                write(os.path.join(tmp, f), t)
                check(sp.depth_text(t, edits[f]) == installed, f + ': patching the pristine copy gives the installed file again')
        orig[f] = t
        check(sp.DEPTH_MARK not in t, f + ': the copy is pristine')
    first = sp.depth(tmp)
    check(first == 2, 'first run patched %d file(s)' % first)
    check(sp.depth(tmp) == 0, 'second run changes nothing (idempotent)')
    for f in FILES:
        t = read(os.path.join(tmp, f))
        try:
            root = ET.fromstring(t.encode('utf-8'))
            ok = True
        except ET.ParseError as e:
            ok, root = False, None
            print(e)
        check(ok, f + ' still parses')
        check(t.count(sp.DEPTH_MARK) == 1, f + ': one marker')
        check(t.count('effect="zoom"') - orig[f].count('effect="zoom"') == 2, f + ': two focus-lift animations')
        crlf = '\r\n' in orig[f]
        check(('\r\n' in t) == crlf and (not crlf or t.count('\n') == t.count('\r\n')), f + ': line endings kept')
        if root is not None:
            fl = root.find('.//focusedlayout')
            check(fl is not None and fl[0].find('texture').text == 'shadows/shadow-24.png', f + ': shadow first in focus')
    # a changed skin: one anchor missing -> untouched
    t = orig[FILES[0]].replace('<focusedlayout height="90" width="690">', '<focusedlayout height="91" width="690">')
    check(t != orig[FILES[0]] and sp.depth_text(t, edits[FILES[0]]) == t, 'missing anchor -> no change')
    t2 = orig[FILES[1]].replace('\r\n', '\n')
    check(sp.depth_text(t2, edits[FILES[1]]) != t2, 'LF copy of View_62 patches too')
    t3 = orig[FILES[1]].replace('\r\n', '\n').replace('\n', '\r\n')
    p3 = sp.depth_text(t3, edits[FILES[1]])
    check(p3 != t3 and p3.count('\n') == p3.count('\r\n'), 'CRLF copy of View_62 patches and stays CRLF')
    check(sp.depth_text('<a/>', []) == '<a/>', 'no focusedlayout -> no change')
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print('FAILED: %d' % len(bad) if bad else 'ALL OK')
sys.exit(1 if bad else 0)
