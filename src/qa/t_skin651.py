# -*- coding: utf-8 -*-
"""6.5.1 skin patches (skinpatch.plain_text / includes_fix / top_sub and the per-step counts of apply):
first on small made-up files (always the same, whatever this PC's skin looks like), then on a copy of the installed
skin.fentastic xml (or a skin given as argv[1]). The installed files are never written."""
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


def read(p):
    with open(p, encoding='utf-8', newline='') as f:
        return f.read()


def write(p, t):
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(t)


def parses(t):
    try:
        return ET.fromstring(t.encode('utf-8'))
    except ET.ParseError as e:
        print(e)
        return None


# ------------------------------------------------------------------ the focused gold row (plain_text)
VIEW = '''<includes>
\t<include name="V">
\t\t<control type="list" id="60">
\t\t\t<itemlayout height="90" width="690">
\t\t\t\t<control type="label">
\t\t\t\t\t<textcolor>white</textcolor>
\t\t\t\t\t<label>$INFO[ListItem.Label]</label>
\t\t\t\t</control>
\t\t\t</itemlayout>
\t\t\t<focusedlayout height="90" width="690">
\t\t\t\t<control type="image">
\t\t\t\t\t<texture>a.png</texture>
\t\t\t\t</control>
\t\t\t\t<control type="label">
\t\t\t\t\t<left>76</left>
\t\t\t\t\t<textcolor>FF101010</textcolor><shadowcolor>FF101010</shadowcolor>
\t\t\t\t\t<scroll>true</scroll>
\t\t\t\t\t<label>$INFO[ListItem.Label]</label>
\t\t\t\t</control>
\t\t\t\t<control type="label">
\t\t\t\t\t<textcolor>FF2A2618</textcolor>
\t\t\t\t\t<label>$INFO[ListItem.Label2]</label>
\t\t\t\t</control>
\t\t\t</focusedlayout>
\t\t</control>
\t</include>
</includes>
'''
for nl, name in (('\n', 'LF'), ('\r\n', 'CRLF')):
    t = VIEW.replace('\n', nl)
    p = sp.plain_text(t)
    root = parses(p)
    check(p != t and root is not None, 'plain %s: patched and well-formed' % name)
    check(p.count(sp.PLAIN_MARK) == 1 and sp.plain_text(p) == p, 'plain %s: one marker, second run changes nothing' % name)
    check(p.count('\n') == t.count('\n') + 9 and (nl == '\n' or p.count('\n') == p.count('\r\n')), 'plain %s: line endings kept' % name)
    if root is not None:
        fl = root.find('.//focusedlayout')
        titles = [c for c in fl if c.get('type') == 'label' and c.find('textcolor').text == 'FF101010']
        labels = [c.find('label').text for c in titles]
        vis = [c.find('visible').text for c in titles]
        check(labels == ['$INFO[ListItem.Label]', '$INFO[ListItem.Property(bn_plain)]'], 'plain %s: two title labels: %r' % (name, labels))
        check(vis == ['String.IsEmpty(ListItem.Property(bn_plain))', '!String.IsEmpty(ListItem.Property(bn_plain))'],
              'plain %s: one of the two is visible at a time' % name)
        check([c.find('left').text for c in titles] == ['76', '76'] and all(c.find('scroll') is not None for c in titles),
              'plain %s: the copy has the same place and scroll' % name)
        check(len(list(fl)) == 4, 'plain %s: the other focused controls are as they were' % name)
    check(p[:p.index('<focusedlayout')] == t[:t.index('<focusedlayout')], 'plain %s: the unfocused layout is untouched' % name)
check(sp.plain_text(VIEW.replace('FF101010', 'FF202020')) == VIEW.replace('FF101010', 'FF202020'), 'plain: no dark title label -> no change')
two = VIEW.replace('<textcolor>FF2A2618</textcolor>\n\t\t\t\t\t<label>$INFO[ListItem.Label2]</label>',
                   '<textcolor>FF101010</textcolor>\n\t\t\t\t\t<label>$INFO[ListItem.Label]</label>')
check(two != VIEW and sp.plain_text(two) == two, 'plain: two candidates -> no change')
check(sp.plain_text('<a/>') == '<a/>', 'plain: no focused layout -> no change')
both = sp.depth_text(sp.plain_text(VIEW), [('focus', '<focusedlayout height="90" width="690">\n', '<focusedlayout height="90" width="690">\n<!-- x -->\n')])
check('<!-- x -->' in both and sp.PLAIN_MARK in both, 'plain then depth: both land')

# ------------------------------------------------------------------ the top bar's second line (top_sub_text)
SUB = '$INFO[Container.SortMethod,$LOCALIZE[31022]: ,  -  ]$INFO[Container.CurrentItem,, / ]$INFO[Container.NumItems]'
INC = ('<includes>\n\t<include>__backgroundconfiganim__</include>\n\t<include name="TopBar">\n\t\t<param name="sublabel">%s</param>\n'
       '\t\t<definition><control type="label" id="18900"><label>$PARAM[sublabel]</label></control></definition>\n'
       '\t</include>\n</includes>\n' % SUB)
VAR = '<includes>\n\t<variable name="A"><value>1</value></variable>\n</includes>\n'
i2, v2 = sp.top_sub_text(INC, VAR)
check('<param name="sublabel">$VAR[BNTopSub]</param>' in i2 and SUB not in i2, 'top bar: the include points at the variable')
rv = parses(v2)
check(rv is not None and parses(i2) is not None, 'top bar: both files well-formed')
if rv is not None:
    var = [v for v in rv if v.get('name') == 'BNTopSub']
    vals = list(var[0]) if var else []
    check(len(var) == 1 and len(vals) == 2 and not (vals[0].text or '') and 'plugin.video.nova' in vals[0].get('condition')
          and 'plugin.video.telescope' in vals[0].get('condition') and 'String.IsEmpty(Container.Content)' in vals[0].get('condition')
          and vals[1].text == SUB and vals[1].get('condition') is None, 'top bar: empty on plain TeleNova menus, the old line elsewhere')
check(sp.top_sub_text(i2, v2) == (i2, v2), 'top bar: second run changes nothing')
i3, v3 = sp.top_sub_text(INC, v2)
check(i3 == i2 and v3 == v2, 'top bar: a half-done patch (variable only) is finished, the variable is not doubled')
check(sp.top_sub_text(INC.replace('name="TopBar"', 'name="TopBar2"'), VAR) == (INC.replace('name="TopBar"', 'name="TopBar2"'), VAR),
      'top bar: no anchor -> nothing changes, the variable is not added either')
check(sp.top_sub_text(INC, '<x/>') == (INC, '<x/>'), 'top bar: no place for the variable -> nothing changes')

# ------------------------------------------------------------------ includes that do not exist (includes_fix)
OBJ = ('<?xml version="1.0" encoding="UTF-8"?>\n<includes>\n\n<include name="IconSizedBackGround">\n'
       '<param name="width" value="$PARAM[width]" default="$PARAM[width]"/>\n'
       '<param name="SizedBgAnim" value="$PARAM[SizedBgAnim]" default="$PARAM[SizedBgAnim]"/>\n'
       '<definition>\n<control type="group">\n<include>$PARAM[SizedBgAnim]</include>\n<include>$PARAM[animation]</include>\n'
       '</control>\n</definition>\n</include>\n</includes>\n')
V630 = '<includes>\n' + '\t<include content="IconSizedBackGround">\n\t\t<param name="animation"></param>\n\t</include>\n' * 3 + '</includes>\n'
for nl, name in (('\n', 'LF'), ('\r\n', 'CRLF')):
    d = tempfile.mkdtemp()
    try:
        for fn, body in (('Includes.xml', INC), ('Includes_Obj.xml', OBJ), ('View_630_Advanced_List.xml', V630), ('Variables.xml', VAR)):
            write(os.path.join(d, fn), body.replace('\n', nl))
        check(sp.includes_fix(d) == 3, 'includes %s: three files changed' % name)
        check(sp.includes_fix(d) == 0, 'includes %s: second run changes nothing' % name)
        inc, obj, v630 = (read(os.path.join(d, fn)) for fn in ('Includes.xml', 'Includes_Obj.xml', 'View_630_Advanced_List.xml'))
        check('__backgroundconfiganim__' not in inc and inc.count('\n') == INC.count('\n') - 1, 'includes %s: the dead include line is gone' % name)
        ro = parses(obj)
        check(ro is not None and parses(inc) is not None and parses(v630) is not None, 'includes %s: all three well-formed' % name)
        check(obj.count(sp.INC_MARK) == 1 and obj.count('<include name="BNNoInclude">') == 1, 'includes %s: one marker, one stub' % name)
        if ro is not None:
            stub = [i for i in ro if i.get('name') == 'BNNoInclude']
            check(len(stub) == 1 and len(list(stub[0])) == 1, 'includes %s: the stub has a child (an empty include is not registered)' % name)
            params = {p.get('name'): p.get('default') for p in ro.iter('param')}
            check(params.get('SizedBgAnim') == 'BNNoInclude' and params.get('animation') == 'BNNoInclude', 'includes %s: both defaults name the stub' % name)
        check(v630.count('<param name="animation">BNNoInclude</param>') == 3 and '<param name="animation"></param>' not in v630,
              'includes %s: the three empty callers name the stub' % name)
        for t in (inc, obj, v630):
            if nl == '\r\n' and t.count('\n') != t.count('\r\n'):
                check(False, 'includes CRLF: line endings kept')
    finally:
        shutil.rmtree(d, ignore_errors=True)
d = tempfile.mkdtemp()
try:        # the name IS defined somewhere, the parameter line has another shape, two empty callers only
    write(os.path.join(d, 'Includes.xml'), INC)
    write(os.path.join(d, 'Other.xml'), '<includes><include name="__backgroundconfiganim__"><x/></include></includes>')
    write(os.path.join(d, 'Includes_Obj.xml'), OBJ.replace('default="$PARAM[SizedBgAnim]"/>', 'default=""/>'))
    write(os.path.join(d, 'View_630_Advanced_List.xml'), V630.replace('<param name="animation"></param>', '<param name="animation">x</param>', 1))
    check(sp.includes_fix(d) == 0 and read(os.path.join(d, 'Includes.xml')) == INC, 'includes: a skin of another shape is left alone')
finally:
    shutil.rmtree(d, ignore_errors=True)

# ------------------------------------------------------------------ the installed skin (a copy)
if len(sys.argv) > 1:
    src = sys.argv[1]
else:
    src = os.path.join(os.environ.get('APPDATA', ''), 'Kodi', 'addons', 'skin.fentastic', 'xml')
if not os.path.isdir(src):
    print('SKIP (installed-skin part): skin.fentastic not installed')
else:
    base = tempfile.mkdtemp()
    tmp = os.path.join(base, 'xml')         # apply() also writes icons to ../media/bn: keep that inside the temp folder
    try:
        shutil.copytree(src, tmp)
        n1 = sp.apply(tmp)
        last = dict(sp.LAST)
        check(set(last) == {'expr', 'focus', 'wellformed', 'depth', 'includes', 'topbar', 'ai_button', 'menu', 'bn_player'},
              'apply: LAST names every step: %s' % sorted(last))
        check(sum(last.values()) == n1 and not sp.LAST_ERRORS, 'apply: the steps add up to the total (%d = %s)' % (n1, last))
        n2 = sp.apply(tmp)
        check(n2 == 0 and not any(sp.LAST.values()), 'apply: second run changes nothing (%d, %s)' % (n2, sp.LAST))
        broken = [fn for fn in sorted(os.listdir(tmp)) if fn.endswith('.xml') and parses(read(os.path.join(tmp, fn))) is None]
        check(not broken, 'installed skin: every xml file still parses %s' % broken)
        v60 = read(os.path.join(tmp, 'View_60_BN.xml'))
        check(v60.count(sp.PLAIN_MARK) == 1 and v60.count('ListItem.Property(bn_plain)') == 3 and v60.count(sp.DEPTH_MARK) == 1,
              'installed View_60_BN: the plain copy and the depth patch are both there, once')
        inc, obj, var = (read(os.path.join(tmp, fn)) for fn in ('Includes.xml', 'Includes_Obj.xml', 'Variables.xml'))
        check('__backgroundconfiganim__' not in inc and obj.count(sp.INC_MARK) == 1 and '$PARAM[SizedBgAnim]"' not in obj,
              'installed skin: no include without a definition')
        check(inc.count('$VAR[BNTopSub]') == 1 and var.count('name="BNTopSub"') == 1, 'installed skin: the top bar uses BNTopSub')
        for fn in ('View_60_BN.xml', 'Includes.xml', 'Includes_Obj.xml', 'Variables.xml', 'View_630_Advanced_List.xml'):
            a, b = read(os.path.join(src, fn)), read(os.path.join(tmp, fn))
            # a skin file may carry a stray bare LF of its own (Includes.xml has one): the patch must not add any
            if ('\r\n' in a) != ('\r\n' in b) or ('\r\n' in b and b.count('\n') - b.count('\r\n') > a.count('\n') - a.count('\r\n')):
                check(False, fn + ': line endings kept')
    finally:
        shutil.rmtree(base, ignore_errors=True)

print('FAILED: %d' % len(bad) if bad else 'ALL OK')
sys.exit(1 if bad else 0)
