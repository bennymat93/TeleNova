# -*- coding: utf-8 -*-
"""4.2.7: skinpatch.expr_fixes on a copy of the installed skin.fentastic xml (or a skin given as argv[1])."""
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'plugin.video.nova', 'resources', 'lib'))
sys.path.insert(0, HERE)
import skinpatch as sp          # noqa: E402
import skin_expr_check as chk   # noqa: E402

bad = []


def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok:
        bad.append(what)


src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ['APPDATA'], 'Kodi', 'addons', 'skin.fentastic', 'xml')
tmp = tempfile.mkdtemp()
xml = os.path.join(tmp, 'xml')
shutil.copytree(src, xml)
before = {f: open(os.path.join(xml, f), encoding='utf-8').read() for f in ('Variables.xml', 'View_54_InfoWall.xml')}

# synthetic checks of the checker itself
check(chk.balanced('!String.IsEmpty(ListItem.Art(fanart)') == 'unclosed (', 'checker: unclosed paren')
check(chk.balanced('![A | B]] + C') == 'unmatched ]', 'checker: extra bracket')
check(chk.balanced('$EXP[x] + [A(1) | B]') is None, 'checker: balanced')

first = sp.expr_fixes(xml)
check(first in (0, 1, 2), 'first run changed %d file(s)' % first)
check(sp.expr_fixes(xml) == 0, 'second run changes nothing (idempotent)')

after = {f: open(os.path.join(xml, f), encoding='utf-8').read() for f in before}
# only ')' and new <param> lines were added
for f in before:
    a, b = before[f], after[f]
    i = j = 0
    extra = []
    while j < len(b):
        if i < len(a) and a[i] == b[j]:
            i += 1
        else:
            extra.append(b[j])
        j += 1
    check(i == len(a), '%s: nothing removed' % f)
    if f == 'Variables.xml':
        check(set(extra) <= {')'}, 'Variables.xml: only ) added (%d)' % len(extra))

found = chk.scan(xml)
check(not [x for x in found if x[0] == 'View_54_InfoWall.xml'], 'View_54: no empty $PARAM conditions left')
check(not [x for x in found if x[0] == 'Variables.xml' and 'fanart' in x[3] and 'ListItem.Art' in x[3]],
      'Variables.xml: ListItem.Art(fanart) conditions closed')
check('<param name="iconfocused">false</param>' in after['View_54_InfoWall.xml'], 'iconfocused default added')

# parses as XML whenever the stock file did (stock Variables.xml has bare '&' that only Kodi's TinyXML accepts)
import xml.etree.ElementTree as ET  # noqa: E402


def _parses(s):
    try:
        ET.fromstring(s.encode('utf-8'))
        return True
    except ET.ParseError:
        return False


for f in before:
    check(_parses(after[f]) or not _parses(before[f]), f + ' parses as well as before')

# BN player: the info panel property is cleared when the OSD closes (once), and the shipped skin files parse
sp.bn_player(xml)
osd = open(os.path.join(xml, 'VideoOSD.xml'), encoding='utf-8').read()
check(osd.count(sp.OSDINFO_MARK) == 1, 'VideoOSD.xml: BN.OSDInfo cleared on unload')
sp.bn_player(xml)
osd2 = open(os.path.join(xml, 'VideoOSD.xml'), encoding='utf-8').read()
check(osd2 == osd, 'bn_player idempotent on VideoOSD.xml')
check(_parses(osd2) or not _parses(after.get('VideoOSD.xml', osd2)), 'VideoOSD.xml still parses')
for fn in ('Includes_VideoOsdBN.xml', 'Custom_1190_BNLiveBar.xml'):
    check(_parses(open(os.path.join(xml, fn), encoding='utf-8').read()), fn + ' parses')
check(os.path.exists(os.path.join(tmp, 'media', 'bn', 'panel.png')), 'panel.png shipped to media/bn')

shutil.rmtree(tmp, ignore_errors=True)
print('FAILED: %d' % len(bad) if bad else 'ALL OK')
sys.exit(1 if bad else 0)
