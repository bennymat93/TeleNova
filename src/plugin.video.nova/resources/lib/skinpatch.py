# -*- coding: utf-8 -*-
"""AI Subtitle Generation button in the player and the subtitle window of the BN skin (skin.fentastic).

Pure Python (no Kodi modules): used by tools/make_build.py for new builds and by the service at start-up,
so boxes that update NovaTV from the repository get the button too (idempotent)."""
import os
import re

AI_RUN = 'RunPlugin(plugin://plugin.video.nova/?a=ai_subs_now)'
AI_LABEL = 'יצירת כתוביות AI'
MENU_RUN = 'RunPlugin(plugin://plugin.video.nova/?a=subs_menu)'
MENU_LABEL = 'כתוביות BN'


def apply(xml):
    """'AI Subtitle Generation' next to the subtitle buttons of every player style and in the subtitle window.
    Returns how many skin files were changed (0 = already there)."""
    LAST.clear()
    del LAST_ERRORS[:]
    n = 0
    # 4.2.7: expr first, so a skin file that changed shape below does not stop it; review 17/11: an unreadable skin
    # file never stops the other patches. 6.5.1: every step's own count is kept in LAST (the service logs it)
    for name, step in (('expr', expr_fixes), ('focus', focus_label),       # 4.2.7, 4.2.8
                       ('wellformed', wellformed), ('depth', depth),       # 6.0.2, 6.5.0
                       ('includes', includes_fix), ('topbar', top_sub)):   # 6.5.1
        try:
            k = step(xml)
        except Exception:
            LAST_ERRORS.append(name)
            k = 0
        LAST[name] = k
        n += k
    before = n
    try:
        n = _ai_buttons(xml, n)
    finally:
        LAST['ai_button'] = _AI_COUNT[0] - before if _AI_COUNT[0] >= before else 0
    LAST['menu'] = _menu_button(xml)
    LAST['bn_player'] = bn_player(xml)
    return n + LAST['menu'] + LAST['bn_player']


LAST = {}               # 6.5.1: files changed by each step of the last apply() ({'depth': 2, ...})
LAST_ERRORS = []        # steps of the last apply() that raised (their count is 0)
_AI_COUNT = [0]


def _ai_buttons(xml, n):
    """the AI subtitle button itself (raises AssertionError when a player file changed shape) -> n + files changed"""
    _AI_COUNT[0] = n
    item = ('\n\t<item>\n\t\t<label>%s</label>\n\t\t<icon>osd/fullscreen/buttons/subs3.png</icon>\n'
            '\t\t<onclick>%s</onclick>\n\t\t<visible>!VideoPlayer.Content(LiveTV)</visible>\n\t</item>') % (AI_LABEL, AI_RUN)
    # item-list players (advanced, netflix): right after "search subtitles"
    for fn, rx in (('Includes_VideoOsd.xml', r'(<item id="107">.*?</item>)'),
                   ('Includes_VideoOsd1.xml', r'(<item id="107">.*?</item>)'),
                   ('Includes_VideoOsd2.xml', r'(<item>\s*<label>חפש כתובית</label>.*?</item>)')):
        p = os.path.join(xml, fn)
        t = open(p, encoding='utf-8', newline='').read()
        if AI_RUN not in t:
            t, k = re.subn(rx, lambda m: m.group(1) + item, t, count=1, flags=re.S)
            assert k, 'subtitle item not found in ' + fn
            open(p, 'w', encoding='utf-8', newline='').write(t)
            n += 1
            _AI_COUNT[0] = n
    # simple player: a button after the DarkSubs button
    p = os.path.join(xml, 'Includes_VideoOsd3.xml')
    t = open(p, encoding='utf-8', newline='').read()
    if AI_RUN not in t:
        btn = ('\n\t\t\t\t\t<control type="button" id="700452">\n\t\t\t\t\t\t<description>BN AI subtitles</description>\n'
               '\t\t\t\t\t\t<width>225</width>\n\t\t\t\t\t\t<height>76</height>\n\t\t\t\t\t\t<label>[B]AI[/B] כתוביות</label>\n'
               '\t\t\t\t\t\t<font>font12</font>\n\t\t\t\t\t\t<align>center</align>\n\t\t\t\t\t\t<aligny>center</aligny>\n'
               '\t\t\t\t\t\t<textcolor>grey_a</textcolor>\n\t\t\t\t\t\t<focusedcolor>button_focus</focusedcolor>\n'
               '\t\t\t\t\t\t<texturenofocus />\n\t\t\t\t\t\t<texturefocus />\n'
               '\t\t\t\t\t\t<onclick>%s</onclick>\n\t\t\t\t\t\t<visible>!VideoPlayer.Content(LiveTV)</visible>\n'
               '\t\t\t\t\t</control>') % AI_RUN
        t, k = re.subn(r'(<control type="button" id="700451">.*?</control>)', lambda m: m.group(1) + btn, t, count=1, flags=re.S)
        assert k, 'DarkSubs button not found'
        open(p, 'w', encoding='utf-8', newline='').write(t)
        n += 1
        _AI_COUNT[0] = n
    # Kodi's subtitle window (the default "search subtitles" of the player): a button above the services list
    p = os.path.join(xml, 'DialogSubtitles.xml')
    t = open(p, encoding='utf-8', newline='').read()
    if AI_RUN not in t:
        btn = ('<control type="button" id="7160">\n\t\t\t\t\t<description>BN AI subtitles</description>\n'
               '\t\t\t\t\t<left>20</left>\n\t\t\t\t\t<top>120</top>\n\t\t\t\t\t<width>280</width>\n\t\t\t\t\t<height>60</height>\n'
               '\t\t\t\t\t<label>[B]%s[/B]</label>\n\t\t\t\t\t<font>font12</font>\n\t\t\t\t\t<align>center</align>\n'
               '\t\t\t\t\t<aligny>center</aligny>\n\t\t\t\t\t<textcolor>FFE8BE5A</textcolor>\n'
               '\t\t\t\t\t<texturefocus colordiffuse="button_focus">colors/white.png</texturefocus>\n'
               '\t\t\t\t\t<texturenofocus colordiffuse="30FFFFFF">colors/white.png</texturenofocus>\n'
               '\t\t\t\t\t<focusedcolor>black</focusedcolor>\n'
               '\t\t\t\t\t<onleft>120</onleft>\n\t\t\t\t\t<ondown>150</ondown>\n'
               '\t\t\t\t\t<onclick>%s</onclick>\n\t\t\t\t</control>\n\t\t\t\t') % (AI_LABEL, AI_RUN)
        assert '<control type="list" id="150">' in t and '<onup>150</onup>' in t
        t = t.replace('<control type="list" id="150">', btn + '<control type="list" id="150">', 1)
        t = t.replace('<onup>150</onup>', '<onup>7160</onup>', 1)
        open(p, 'w', encoding='utf-8', newline='').write(t)
        n += 1
        _AI_COUNT[0] = n
    # Up from the results list reaches the AI button too (also for skins patched by 0.2.1)
    t = open(p, encoding='utf-8', newline='').read()
    old = '<control type="list" id="120">\n\t\t\t\t<top>50</top>\n\t\t\t\t<onup>false</onup>'
    if old in t:
        t = t.replace(old, old.replace('<onup>false</onup>', '<onup>7160</onup>'), 1)
        open(p, 'w', encoding='utf-8', newline='').write(t)
        n += 1
    _AI_COUNT[0] = n
    return n


# ------------------------------------------------------------------ 6.0.2: well-formed XML
# Six stock FENtastic files were not well-formed XML: bare '&' inside plugin addresses (left from POV, which the build
# no longer carries) and one comment closed with '--->'. Kodi's own parser forgives both, every XML checker stops at
# them. '&amp;' is read by Kodi as the same '&', so the screens do exactly what they did.
_BARE_AMP = re.compile(r'&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)')


def wellformed(xml):
    n = 0
    for fn in sorted(os.listdir(xml)):
        if not fn.endswith('.xml'):
            continue
        p = os.path.join(xml, fn)
        t = open(p, encoding='utf-8', newline='').read()
        new = _BARE_AMP.sub('&amp;', t)
        new = re.sub(r'(<!--(?:(?!-->).)*?)-+-->', lambda m: m.group(1).rstrip('-') + ' -->', new, flags=re.S)
        if new != t:
            open(p, 'w', encoding='utf-8', newline='').write(new)
            n += 1
    return n


def _menu_button(xml):
    """'כתוביות BN' (every track incl. AI, turn AI on by hand, generate, search, sync) right after the AI item"""
    n = 0
    item = ('\n\t<item>\n\t\t<label>%s</label>\n\t\t<icon>osd/fullscreen/buttons/subs.png</icon>\n'
            '\t\t<onclick>%s</onclick>\n\t</item>') % (MENU_LABEL, MENU_RUN)
    for fn in ('Includes_VideoOsd.xml', 'Includes_VideoOsd1.xml', 'Includes_VideoOsd2.xml'):
        p = os.path.join(xml, fn)
        t = open(p, encoding='utf-8', newline='').read()
        if MENU_RUN in t or AI_RUN not in t:
            continue
        i = t.index(AI_RUN)
        j = t.index('</item>', i) + len('</item>')
        t = t[:j] + item + t[j:]
        open(p, 'w', encoding='utf-8', newline='').write(t)
        n += 1
    p = os.path.join(xml, 'Includes_VideoOsd3.xml')
    t = open(p, encoding='utf-8', newline='').read()
    if MENU_RUN not in t and AI_RUN in t:
        btn = ('\n\t\t\t\t\t<control type="button" id="700453">\n\t\t\t\t\t\t<description>BN subtitles</description>\n'
               '\t\t\t\t\t\t<width>225</width>\n\t\t\t\t\t\t<height>76</height>\n\t\t\t\t\t\t<label>%s</label>\n'
               '\t\t\t\t\t\t<font>font12</font>\n\t\t\t\t\t\t<align>center</align>\n\t\t\t\t\t\t<aligny>center</aligny>\n'
               '\t\t\t\t\t\t<textcolor>grey_a</textcolor>\n\t\t\t\t\t\t<focusedcolor>button_focus</focusedcolor>\n'
               '\t\t\t\t\t\t<texturenofocus />\n\t\t\t\t\t\t<texturefocus />\n'
               '\t\t\t\t\t\t<onclick>%s</onclick>\n\t\t\t\t\t</control>') % (MENU_LABEL, MENU_RUN)
        i = t.index('<control type="button" id="700452">')
        j = t.index('</control>', i) + len('</control>')
        t = t[:j] + btn + t[j:]
        open(p, 'w', encoding='utf-8', newline='').write(t)
        n += 1
    return n


BN_OSD = 'Includes_VideoOsdBN.xml'
BN_INCLUDE = '<include condition="String.IsEqual(Skin.String(__chooseplayer),__bnplayer)">videosd_bn</include>'


def bn_player(xml):
    """the BN player style (one row of big buttons, name of the focused one, progress + times) - file shipped
    in resources/skin, registered in Includes.xml and selectable as __chooseplayer = __bnplayer"""
    n = 0
    for fn in (BN_OSD, 'Custom_1190_BNLiveBar.xml'):     # + the live-TV bar window (1.4.4)
        src = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skin', fn)
        dst = os.path.join(xml, fn)
        body = open(src, encoding='utf-8', newline='').read()
        if not os.path.exists(dst) or open(dst, encoding='utf-8', newline='').read() != body:
            open(dst, 'w', encoding='utf-8', newline='').write(body)
            n += 1
    # icons -> the skin's own media folder (skin textures are looked up there)
    icons = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skin', 'icons')
    media = os.path.join(os.path.dirname(os.path.normpath(xml)), 'media', 'bn')
    os.makedirs(media, exist_ok=True)
    for fn in os.listdir(icons):
        a, b = os.path.join(icons, fn), os.path.join(media, fn)
        data = open(a, 'rb').read()
        if not os.path.exists(b) or open(b, 'rb').read() != data:
            open(b, 'wb').write(data)
            n += 1
    p = os.path.join(xml, 'Includes.xml')
    t = open(p, encoding='utf-8', newline='').read()
    if BN_OSD not in t:
        i = t.index('<include file=')
        t = t[:i] + ('<include file="%s" />' % BN_OSD) + chr(10) + chr(9) + t[i:]
        open(p, 'w', encoding='utf-8', newline='').write(t)
        n += 1
    p = os.path.join(xml, 'VideoOSD.xml')
    t = open(p, encoding='utf-8', newline='').read()
    if BN_INCLUDE not in t:
        anchor = '>videosd4</include>'
        i = t.index(anchor) + len(anchor)
        t = t[:i] + chr(10) + chr(9) + BN_INCLUDE + ' <!-- נגן BN -->' + t[i:]
        open(p, 'w', encoding='utf-8', newline='').write(t)
        n += 1
    # the info panel ("מידע") is a Home property: clear it when the OSD closes, so it does not reopen next time
    # (<onunload> is window-level, it cannot live inside the include)
    if OSDINFO_MARK not in t:
        m = re.search(r'<window\b[^>]*>', t)
        if m:
            t = t[:m.end()] + chr(10) + chr(9) + OSDINFO_UNLOAD + t[m.end():]
            open(p, 'w', encoding='utf-8', newline='').write(t)
            n += 1
    return n


OSDINFO_MARK = '<!-- BN osdinfo v1 -->'
OSDINFO_UNLOAD = '<onunload>ClearProperty(BN.OSDInfo,home)</onunload> ' + OSDINFO_MARK


# ------------------------------------------------------------------ 3.3.3: Paste + clipboard history on the keyboard
KB_MARK = '<!-- BN paste v1 -->'
KB_PASTE = 'RunPlugin(plugin://plugin.video.nova/?a=clip_paste)'
KB_HIST = 'RunPlugin(plugin://plugin.video.nova/?a=clip_menu)'
KB_PASTE_LABEL = 'הדבק'
KB_HIST_LABEL = 'היסטוריית העתקות'
# 6.1: "Copy" - what is typed in the keyboard goes to the device clipboard and the history (not in a password box)
KB_COPY_MARK = '<!-- BN copy v1 -->'
KB_COPY = 'RunPlugin(plugin://plugin.video.nova/?a=clip_copy)'
KB_COPY_LABEL = 'העתקה'


def _kb_button(cid, label, run, prop):
    lines = [
        '<control type="button" id="%d">' % cid,
        '\t<width>300</width>',
        '\t<height>67</height>',
        '\t<label>%s</label>' % label,
        '\t<font>font25_title</font>',
        '\t<align>center</align>',
        '\t<wrapmultiline>false</wrapmultiline>',
        '\t<onclick>%s</onclick>' % run,
        # nothing copied -> the button is disabled: grey, not focusable, a click does nothing
        '\t<enable>!String.IsEmpty(Window(home).Property(%s))</enable>' % prop,
        '\t<disabledcolor>FF6E6E6E</disabledcolor>',
        '\t<texturefocus colordiffuse="button_focus">buttons/dfo.png</texturefocus>',
        '\t<texturenofocus colordiffuse="button_focus2">buttons/dnfo.png</texturenofocus>',
        '\t<animation effect="fade" start="100" end="35" time="0" condition="!Control.IsEnabled(%d)">Conditional</animation>' % cid,
        '</control>',
    ]
    pad = '\n' + '\t' * 4
    return pad + pad.join(lines)


def _kb_copy():
    b = _kb_button(3013, KB_COPY_LABEL, KB_COPY, 'bn.clip.hist')
    # enabled while the keyboard holds text and is not a password box (Kodi shows that one as stars)
    b = re.sub(r'<enable>.*?</enable>', '<enable>!String.IsEmpty(Control.GetLabel(312)) + !String.Contains(Control.GetLabel(312),*)</enable>', b)
    return '\n' + '\t' * 4 + KB_COPY_MARK + b


def keyboard_buttons(xml):
    """"Paste" (grey and not clickable while nothing is copied) and "Clipboard history" in the button column of the
    on-screen keyboard, right under the voice-search button. -> 1 when the file was changed, 0 when already there."""
    p = os.path.join(xml, 'DialogKeyboard.xml')
    t = open(p, encoding='utf-8', newline='').read()
    if KB_MARK in t:
        if KB_COPY_MARK in t:
            return 0
        m = re.search(r'<control type="button" id="3012">.*?</control>', t, re.S)
        if not m:
            return 0
        t = t[:m.end()] + _kb_copy() + t[m.end():]
        open(p, 'w', encoding='utf-8', newline='').write(t)
        return 1
    m = re.search(r'<control type="button" id="3010">.*?</control>', t, re.S)
    if not m:
        m = re.search(r'<include content="DefaultDialogButton">\s*<param name="id" value="301" />.*?</include>', t, re.S)
    assert m, 'keyboard button column not found'
    add = ('\n' + '\t' * 4 + KB_MARK + _kb_button(3011, KB_PASTE_LABEL, KB_PASTE, 'bn.clip.has')
           + _kb_button(3012, KB_HIST_LABEL, KB_HIST, 'bn.clip.hist') + _kb_copy())
    t = t[:m.end()] + add + t[m.end():]
    open(p, 'w', encoding='utf-8', newline='').write(t)
    return 1

# ------------------------------------------------------------------ 4.0.8: the right view from the first frame
# Every list opened in the skin's first view and was switched a moment later by a command the add-on sent after the
# list was already on the screen (Container.SetViewMode) - the viewer saw one design, then another. Now the skin itself
# picks the view while the list loads: the wide-picture view (62) is valid for episodes and single videos only, so
# every other list (menus, films, series, seasons) falls to the next view in the window's order, the details view (60).
VIEW_MARK = '<!-- BN view by content v1 -->'
VIEW_RULE = '<visible>Container.Content(episodes) | Container.Content(videos)</visible>'


def default_views(xml):
    """-> 1 when View_62_BNEpisodes.xml was changed, 0 when already there / the skin has no such view"""
    p = os.path.join(xml, 'View_62_BNEpisodes.xml')
    if not os.path.exists(p):
        return 0
    t = open(p, encoding='utf-8', newline='').read()
    if VIEW_MARK in t:
        return 0
    m = re.search(r'([ \t]*)<control type="list" id="62">[ \t]*\r?\n', t)
    if not m:
        return 0
    nl = '\r\n' if '\r\n' in t else '\n'
    t = t[:m.end()] + m.group(1) + '\t' + VIEW_MARK + nl + m.group(1) + '\t' + VIEW_RULE + nl + t[m.end():]
    open(p, 'w', encoding='utf-8', newline='').write(t)
    return 1


# ------------------------------------------------------------------ 4.0.7: search suggestions on the keyboard
# The skin's keyboard has a suggestion panel (id 9010) that was fed by an add-on the build does not carry. It is fed by
# TeleNova instead - in search boxes only (window property bn.search), never in a hidden (password) box.
AC_MARK = '<!-- BN search suggestions v1 -->'
AC_VALUE = ('<value condition="!String.IsEmpty(Window(home).Property(bn.search)) + !System.HasHiddenInput">'
            'plugin://plugin.video.nova/?a=ac&amp;q=$INFO[Control.GetLabel(312).index(1)]</value>')


def keyboard_complete(xml):
    """-> 1 when Variables.xml was changed, 0 when already there or the skin has no such panel"""
    p = os.path.join(xml, 'Variables.xml')
    if not os.path.exists(p):
        return 0
    t = open(p, encoding='utf-8', newline='').read()
    if AC_MARK in t:
        return 0
    m = re.search(r'<variable name="AutoCompletionContentVar">[ \t]*\r?\n', t)
    if not m:
        return 0
    nl = '\r\n' if '\r\n' in t else '\n'
    t = t[:m.end()] + '\t\t' + AC_MARK + nl + '\t\t' + AC_VALUE + nl + t[m.end():]
    open(p, 'w', encoding='utf-8', newline='').write(t)
    return 1


# ------------------------------------------------------------------ 4.2.7: stock FENtastic conditions Kodi cannot parse
# Kodi logged on every start "Misplaced ]" / "Error parsing boolean expression [] + [...]" (InfoWallMovieLayout used
# by the home widgets without its icon* / imagevisible / noneepisodefocus params -> an empty <visible>) and
# "unmatched parentheses in string.isempty(listitem.art(fanart)" (Variables.xml). A condition that fails to parse
# is false, so defaulting the params to false keeps what the screen showed.
WALL_PARAMS = ('iconfocused', 'iconnofocused', 'iconfocusedfolder', 'imagevisible', 'noneepisodefocus')


def _close_parens(m):
    """a condition that only lacks closing ')' at its end gets them (brackets untouched)"""
    c = m.group(2)
    miss = c.count('(') - c.count(')')
    if miss > 0 and c.count('[') == c.count(']') and not c.rstrip().endswith((']', '|', '+')):
        c = c.rstrip() + ')' * miss
    return m.group(1) + c + m.group(3)


def focus_label(xml):
    """4.2.8 (display review): the focused row of the TeleNova lists was drawn as [B]label[/B]; a label that
    carries its own [B] (section headers, the services summary) then showed "[B/]" and lost its text. The gold
    focus bar already marks the row - the focused label is drawn without the wrapper. -> files changed"""
    n = 0
    for fn in ('View_60_BN.xml', 'View_62_BNEpisodes.xml'):
        p = os.path.join(xml, fn)
        if not os.path.exists(p):
            continue
        t = open(p, encoding='utf-8', newline='').read()
        new = t.replace('<label>[B]$INFO[ListItem.Label][/B]</label>', '<label>$INFO[ListItem.Label]</label>')
        # a gold label (section headers) on the gold focus bar was invisible: a dark shadow keeps it readable
        # (FF101010 is the dark text of the focused row only, in both TeleNova views)
        if '<shadowcolor>FF101010' not in new:
            new = new.replace('<textcolor>FF101010</textcolor>',
                              '<textcolor>FF101010</textcolor><shadowcolor>FF101010</shadowcolor>')
        new = plain_text(new)       # 6.5.1
        if new != t:
            with open(p, 'w', encoding='utf-8', newline='') as f:
                f.write(new)
            n += 1
    return n


# ------------------------------------------------------------------ 6.5.1: a gold row stays readable when focused
# A row whose whole label is [COLOR gold]...[/COLOR] was gold text on the gold focus bar: the inline colour wins over
# the dark colour of the focused label. Such rows carry their text without tags in the property bn_plain (common.
# gold_item / default.folder(plain=...)); the focused layout draws that copy instead. Only the focused title label is
# touched; a view without exactly one such label stays as it is. Rows without the property look as before.
PLAIN_MARK = '<!-- BN plain v1 -->'
_PLAIN_RX = re.compile(r'([ \t]*)<control type="label">((?:(?!</control>).)*?)<label>\$INFO\[ListItem\.Label\]</label>'
                       r'((?:(?!</control>).)*?)</control>', re.S)


def plain_text(t):
    """-> the patched text, or t itself (already patched / no single focused title label)"""
    if PLAIN_MARK in t:
        return t
    cut = t.find('<focusedlayout')
    end = t.find('</focusedlayout>', cut)
    if cut < 0 or end < 0:
        return t
    body = t[cut:end]
    hits = [m for m in _PLAIN_RX.finditer(body) if 'FF101010' in m.group(0)]
    if len(hits) != 1 or '<visible>' in hits[0].group(0):
        return t
    m = hits[0]
    nl = '\r\n' if '\r\n' in t else '\n'
    ind = m.group(1)

    def block(label, cond):
        return ('%s<control type="label">%s<label>%s</label>%s%s\t<visible>%s</visible>%s</control>'
                % (ind, m.group(2), label, nl, ind, cond, m.group(3)))
    new = (block('$INFO[ListItem.Label]', 'String.IsEmpty(ListItem.Property(bn_plain))') + nl
           + ind + PLAIN_MARK + nl
           + block('$INFO[ListItem.Property(bn_plain)]', '!String.IsEmpty(ListItem.Property(bn_plain))'))
    return t[:cut] + body[:m.start()] + new + body[m.end():] + t[end:]


# ------------------------------------------------------------------ 6.5.1: includes that do not exist
# Every load of a video window logged "Skin has invalid include": Includes.xml asks for __backgroundconfiganim__
# (defined nowhere) and IconSizedBackGround includes two parameters that are empty for most callers. The missing name
# is removed; the two parameters default to an include that exists and adds nothing.
INC_MARK = '<!-- BN includes v1 -->'
INC_STUB = '<include name="BNNoInclude"><description>BN includes v1</description></include>'
_INC_DEAD = '<include>__backgroundconfiganim__</include>'
_INC_PARAM = '<param name="SizedBgAnim" value="$PARAM[SizedBgAnim]" default="$PARAM[SizedBgAnim]"/>'
_INC_EMPTY = '<param name="animation"></param>'


def _rw(p, new=None):
    if new is None:
        with open(p, encoding='utf-8', newline='') as f:
            return f.read()
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(new)


def includes_fix(xml):
    """-> files changed (0 = already there, not this skin, or the files changed shape)"""
    n = 0
    p = os.path.join(xml, 'Includes.xml')
    if os.path.exists(p):
        t = _rw(p)
        if t.count(_INC_DEAD) == 1:
            defined = False
            for fn in os.listdir(xml):
                if fn.endswith('.xml') and 'name="__backgroundconfiganim__"' in _rw(os.path.join(xml, fn)):
                    defined = True
                    break
            if not defined:
                new, k = re.subn(r'[ \t]*' + re.escape(_INC_DEAD) + r'[ \t]*\r?\n', '', t)
                if k == 1:
                    _rw(p, new)
                    n += 1
    p = os.path.join(xml, 'Includes_Obj.xml')
    if not os.path.exists(p):
        return n
    t = _rw(p)
    if INC_MARK not in t:
        m = re.search(r'<includes>[ \t]*\r?\n', t)
        if m and t.count(_INC_PARAM) == 1 and t.count('<include name="IconSizedBackGround">') == 1 \
                and 'name="BNNoInclude"' not in t:
            nl = '\r\n' if '\r\n' in t else '\n'
            t = t.replace(_INC_PARAM, '<param name="SizedBgAnim" default="BNNoInclude"/>' + nl
                          + '<param name="animation" default="BNNoInclude"/>', 1)
            t = t[:m.end()] + INC_MARK + nl + INC_STUB + nl + t[m.end():]
            _rw(p, t)
            n += 1
    if INC_MARK in t:                  # callers that hand over an empty name (it replaces the default)
        p = os.path.join(xml, 'View_630_Advanced_List.xml')
        if os.path.exists(p):
            v = _rw(p)
            if v.count(_INC_EMPTY) == 3:
                _rw(p, v.replace(_INC_EMPTY, '<param name="animation">BNNoInclude</param>'))
                n += 1
    return n


# ------------------------------------------------------------------ 6.5.1: no "sort by" line on plain TeleNova menus
# The top bar wrote "Sort by: date - 15 / 15" under the title of every TeleNova menu (the main menu, settings, backup),
# where sorting means nothing. On lists of the two TeleNova add-ons that have no content type the line is empty (the
# bar then centres the title by itself); lists of films / series / episodes keep it. The menu's own name comes from
# the add-on (setPluginCategory), which the bar already shows.
TOPSUB_VAR = 'BNTopSub'
_TOPSUB_RX = re.compile(r'(<include name="TopBar">\s*<param name="sublabel">)(\$INFO\[Container\.SortMethod[^<]*)(</param>)')
_TOPSUB_COND = ('[String.IsEqual(Container.PluginName,plugin.video.nova) | '
                'String.IsEqual(Container.PluginName,plugin.video.telescope)] + String.IsEmpty(Container.Content)')


def top_sub_text(inc, var):
    """(Includes.xml, Variables.xml) -> the two patched texts; both unchanged when an anchor is missing"""
    ms = list(_TOPSUB_RX.finditer(inc))
    have = 'name="%s"' % TOPSUB_VAR in var
    if len(ms) != 1:
        return inc, var
    m = ms[0]
    if not have:
        k = var.rfind('</includes>')
        if k < 0:
            return inc, var
        nl = '\r\n' if '\r\n' in var else '\n'
        var = (var[:k] + '\t<variable name="%s">%s\t\t<value condition="%s"></value>%s\t\t<value>%s</value>%s\t</variable>%s'
               % (TOPSUB_VAR, nl, _TOPSUB_COND, nl, m.group(2), nl, nl) + var[k:])
    inc = inc[:m.start(2)] + '$VAR[%s]' % TOPSUB_VAR + inc[m.end(2):]
    return inc, var


def top_sub(xml):
    """-> files changed (0 = already there, not this skin, or the files changed shape)"""
    pi, pv = os.path.join(xml, 'Includes.xml'), os.path.join(xml, 'Variables.xml')
    if not (os.path.exists(pi) and os.path.exists(pv)):
        return 0
    inc, var = _rw(pi), _rw(pv)
    inc2, var2 = top_sub_text(inc, var)
    n = 0
    if var2 != var:                    # the variable first: the bar never points at a name that is not there
        _rw(pv, var2)
        n += 1
    if inc2 != inc:
        _rw(pi, inc2)
        n += 1
    return n


# ------------------------------------------------------------------ 6.5.0: depth in the TeleNova views
# A soft drop shadow under the list panel and a focus "lift" (shadow + slight zoom of the gold bar and the picture) in
# View_60_BN / View_62_BNEpisodes. Exact-text anchors only: when any anchor of a file is missing or not unique the
# file stays as it is (a skin that changed shape is never half-patched). The marker makes it idempotent.
DEPTH_MARK = '<!-- BN depth v1 -->'
_SHADOW = ('{i}<control type="image">{m}\n'
           '{i}\t<left>{l}</left><top>{t}</top><width>{w}</width><height>{h}</height>\n'
           '{i}\t<texture border="24">shadows/shadow-24.png</texture>\n'
           '{i}\t<colordiffuse>{c}</colordiffuse>\n{v}'
           '{i}</control>\n')


def _lift(cid, ind):
    return ('\n%s<animation effect="zoom" end="102" center="auto" time="160" tween="cubic" easing="out" '
            'condition="Control.HasFocus(%d)">Conditional</animation>' % (ind, cid))


def _depth_edits():
    vis60 = '\t\t\t\t<visible>Control.IsVisible(60)</visible>\n'
    return {
        'View_60_BN.xml': [
            ('all', '\t\t\t<control type="image">\n\t\t\t\t<left>1150</left>\n\t\t\t\t<top>90</top>',
             _SHADOW.format(i='\t\t\t', m=' ' + DEPTH_MARK, l=1126, t=66, w=758, h=968, c='B3000000', v=vis60)
             + '\t\t\t<control type="image">\n\t\t\t\t<left>1150</left>\n\t\t\t\t<top>90</top>'),
            ('focus', '<focusedlayout height="90" width="690">\n',
             '<focusedlayout height="90" width="690">\n'
             + _SHADOW.format(i='\t\t\t\t\t', m='', l=-10, t=-6, w=710, h=102, c='99000000',
                              v='\t\t\t\t\t\t<visible>Control.HasFocus(60)</visible>\n')),
            ('focus', '\t\t\t\t\t\t<colordiffuse>FFE8BE5A</colordiffuse>\n\t\t\t\t\t\t<visible>Control.HasFocus(60)</visible>',
             '\t\t\t\t\t\t<colordiffuse>FFE8BE5A</colordiffuse>\n\t\t\t\t\t\t<visible>Control.HasFocus(60)</visible>'
             + _lift(60, '\t\t\t\t\t\t')),
            ('focus', '\t\t\t\t\t\t<texture background="true">$VAR[BNThumb]</texture>',
             '\t\t\t\t\t\t<texture background="true">$VAR[BNThumb]</texture>' + _lift(60, '\t\t\t\t\t\t')),
        ],
        'View_62_BNEpisodes.xml': [
            ('all', '\t\t\t<control type="image">\n\t\t\t\t<left>1150</left><top>80</top><width>720</width><height>950</height>',
             _SHADOW.format(i='\t\t\t', m=' ' + DEPTH_MARK, l=1126, t=56, w=768, h=998, c='B3000000', v='')
             + '\t\t\t<control type="image">\n\t\t\t\t<left>1150</left><top>80</top><width>720</width><height>950</height>'),
            ('focus', '<focusedlayout height="155" width="700">\n',
             '<focusedlayout height="155" width="700">\n'
             + _SHADOW.format(i='\t\t\t\t\t', m='', l=-10, t=-6, w=720, h=167, c='99000000',
                              v='\t\t\t\t\t\t<visible>Control.HasFocus(62)</visible>\n')),
            ('focus', '\t\t\t\t\t\t<colordiffuse>FFE8BE5A</colordiffuse>\n\t\t\t\t\t\t<visible>Control.HasFocus(62)</visible>',
             '\t\t\t\t\t\t<colordiffuse>FFE8BE5A</colordiffuse>\n\t\t\t\t\t\t<visible>Control.HasFocus(62)</visible>'
             + _lift(62, '\t\t\t\t\t\t')),
            ('focus', '\t\t\t\t\t\t<texture background="true">$VAR[BNWideThumb]</texture>',
             '\t\t\t\t\t\t<texture background="true">$VAR[BNWideThumb]</texture>' + _lift(62, '\t\t\t\t\t\t')),
        ],
    }


def depth_text(t, edits):
    """-> the patched text, or t itself when already patched or any anchor is missing / not unique"""
    if DEPTH_MARK in t:
        return t
    nl = '\r\n' if '\r\n' in t else '\n'
    cut = t.find('<focusedlayout')
    if cut < 0:
        return t
    head, tail = t[:cut], t[cut:]
    for scope, old, new in edits:
        old, new = old.replace('\n', nl), new.replace('\n', nl)
        if scope == 'all':
            if t.count(old) != 1 or old not in head:
                return t
            head = head.replace(old, new, 1)
        else:
            if tail.count(old) != 1:
                return t
            tail = tail.replace(old, new, 1)
    return head + tail


def depth(xml):
    """-> files changed (0 = already there, not this skin, or the views changed shape)"""
    n = 0
    for fn, edits in _depth_edits().items():
        p = os.path.join(xml, fn)
        if not os.path.exists(p):
            continue
        t = open(p, encoding='utf-8', newline='').read()
        new = depth_text(t, edits)
        if new != t:
            with open(p, 'w', encoding='utf-8', newline='') as f:
                f.write(new)
            n += 1
    return n


def expr_fixes(xml):
    """-> how many skin files were changed (0 = already fixed or not this skin)"""
    n = 0
    p = os.path.join(xml, 'Variables.xml')
    if os.path.exists(p):
        t = open(p, encoding='utf-8', newline='').read()
        t2 = re.sub(r'(<value condition=")([^"]*)(")', _close_parens, t)
        if t2 != t:
            open(p, 'w', encoding='utf-8', newline='').write(t2)
            n += 1
    p = os.path.join(xml, 'View_54_InfoWall.xml')
    if os.path.exists(p):
        t = open(p, encoding='utf-8', newline='').read()
        m = re.search(r'(<include name="InfoWallMovieLayout">[ \t]*\r?\n)(.*?)([ \t]*<definition>)', t, re.S)
        if m:
            nl = '\r\n' if '\r\n' in m.group(1) else '\n'
            add = ''.join('\t\t<param name="%s">false</param>%s' % (k, nl) for k in WALL_PARAMS
                          if '<param name="%s"' % k not in m.group(2))
            if add:
                t = t[:m.start(3)] + add + t[m.start(3):]
                open(p, 'w', encoding='utf-8', newline='').write(t)
                n += 1
    return n


# ------------------------------------------------------------------ 3.3.3: slim notification at the top of the screen
NOTE_MARK = '<!-- BN notification v1 -->'
NOTE_XML = '''<?xml version="1.0" encoding="UTF-8"?>
<window>
	<zorder>3</zorder>
	<controls>
		<control type="group">
			''' + NOTE_MARK + '''
			<depth>DepthMax</depth>
			<top>-6</top>
			<right>0</right>
			<width>500</width>
			<include>OpenClose_Right</include>
			<visible>String.IsEmpty(Window(Home).Property(script.cinemavision.running))</visible>
			<control type="image">
				<left>0</left>
				<top>0</top>
				<width>500</width>
				<height>100</height>
				<texture colordiffuse="button_focus">masks/dialog-notification-border.png</texture>
				<bordersize>15</bordersize>
			</control>
			<control type="image">
				<left>0</left>
				<top>0</top>
				<width>500</width>
				<height>100</height>
				<texture colordiffuse="dialog_bg">masks/dialog-notification.png</texture>
				<bordersize>17</bordersize>
			</control>
			<control type="image" id="400">
				<description>avatar</description>
				<left>426</left>
				<top>25</top>
				<width>50</width>
				<height>50</height>
				<aspectratio>keep</aspectratio>
			</control>
			<control type="fadelabel" id="401">
				<description>Line 1 Label</description>
				<left>28</left>
				<top>19</top>
				<width>388</width>
				<height>28</height>
				<font>font12</font>
				<textcolor>button_focus</textcolor>
				<align>right</align>
				<aligny>center</aligny>
				<scrollout>false</scrollout>
				<pauseatend>2000</pauseatend>
			</control>
			<control type="fadelabel" id="402">
				<description>Line 2 Label</description>
				<left>28</left>
				<top>49</top>
				<width>388</width>
				<height>28</height>
				<font>font10</font>
				<textcolor>white</textcolor>
				<align>right</align>
				<aligny>center</aligny>
				<scrollout>false</scrollout>
				<pauseatend>2000</pauseatend>
			</control>
		</control>
	</controls>
</window>
'''


def notification(xml):
    """Kodi's pop-up notification as a slim bar in the top corner: 500x100 instead of 720x160 (the visible box is
    about 76 high: the texture has a soft margin), at the top edge instead of 100 px below it, both lines in explicit colours. -> 1 when the file was changed, 0 when already there."""
    p = os.path.join(xml, 'DialogNotification.xml')
    if not os.path.exists(p):
        return 0
    if open(p, encoding='utf-8', newline='').read() == NOTE_XML:
        return 0
    open(p, 'w', encoding='utf-8', newline='').write(NOTE_XML)
    return 1


# ------------------------------------------------------------------ 3.3.3: home screen - toolbar and menu on one axis
HOME_MARK = '<!-- BN home layout v1 -->'
TOOL_BUTTON = '''<include name="BNToolButton">
		<param name="visible">true</param>
		<param name="size">40</param>
		<param name="pos">40</param>
		<definition>
			<control type="radiobutton" id="$PARAM[control_id]">
				<include>FocusBounce</include>
				<width>120</width>
				<height>120</height>
				<align>center</align>
				<aligny>center</aligny>
				<onclick>$PARAM[onclick]</onclick>
				<font></font>
				<label>$PARAM[label]</label>
				<texturefocus colordiffuse="button_focus">buttons/roundbutton-fo.png</texturefocus>
				<texturenofocus />
				<radioposx>$PARAM[pos]</radioposx>
				<radioposy>0</radioposy>
				<radiowidth>$PARAM[size]</radiowidth>
				<radioheight>$PARAM[size]</radioheight>
				<textureradioonfocus colordiffuse="focused_text">$PARAM[icon]</textureradioonfocus>
				<textureradioonnofocus colordiffuse="grey">$PARAM[icon]</textureradioonnofocus>
				<textureradioofffocus colordiffuse="focused_text">$PARAM[icon]</textureradioofffocus>
				<textureradiooffnofocus colordiffuse="grey">$PARAM[icon]</textureradiooffnofocus>
				<visible>$PARAM[visible]</visible>
			</control>
		</definition>
	</include>
	'''


def _sub(rx, new, text, want=None):
    text, k = re.subn(rx, new, text, flags=re.S)
    assert k and (want is None or k == want), 'home layout: %r matched %d times' % (rx, k)
    return text


def home_layout(xml):
    """The side column of the home screen (0..503 wide, centre 251): the menu buttons (395 wide) are centred in it,
    the toolbar icons stand on the same axis at equal distances (82 between centres, glyphs drawn at one visual size:
    the update and help pictures have a transparent margin), icon and text sit on the vertical middle of each button.
    -> 1 when the skin was changed, 0 when already there."""
    p = os.path.join(xml, 'Home.xml')
    b = os.path.join(xml, 'Includes_Buttons.xml')
    if not (os.path.exists(p) and os.path.exists(b)):
        return 0
    t = open(p, encoding='utf-8', newline='').read()
    if HOME_MARK in t:
        return 0
    # ---- toolbar
    i = t.index('<control type="grouplist" id="700">')
    j = t.index('</control>', i)
    bar = t[i:j]
    bar = _sub(r'<itemgap>0</itemgap>', '<itemgap>-38</itemgap>', bar, 1)
    bar = _sub(r'<left>45</left>', '<left>-14</left>', bar, 1)
    bar = _sub(r'<width>380</width>', '<width>530</width>', bar, 1)
    bar = _sub(r'<align>justify</align>', '<align>center</align>', bar, 1)
    bar = _sub(r'content="IconButton"', 'content="BNToolButton"', bar)
    for icon, size in (('icons/bn_update.png', 50), ('icons/sidemenu/bn_help.png', 56)):
        tag = '<param name="icon" value="%s" />' % icon
        assert tag in bar, 'home layout: %s not in the toolbar' % icon
        bar = bar.replace(tag, tag + '<param name="size" value="%d" /><param name="pos" value="%d" />' % (size, (120 - size) // 2))
    # ---- menu
    k = t.index('<control type="fixedlist" id="9000">')
    assert k < i
    e = t.index('<content>', k)
    menu = t[k:e]
    menu = _sub(r'<left>25</left>(\s*)<top>240</top>(\s*)<width>492</width>', r'<left>53</left>\1<top>240</top>\2<width>400</width>', menu, 1)
    menu = _sub(r'<left>5</left>(\s*)<top>1</top>', r'<left>5</left>\1<top>-2</top>', menu, 2)
    menu = _sub(r'<left>96</left>(\s*)<top>0</top>(\s*)<height>95</height>', r'<left>96</left>\1<top>7</top>\2<height>76</height>', menu, 3)
    t = t[:k] + HOME_MARK + menu + t[e:i] + bar + t[j:]
    s = open(b, encoding='utf-8', newline='').read()
    if 'name="BNToolButton"' not in s:
        s = _sub(r'<include name="IconButton">', lambda m: TOOL_BUTTON + m.group(0), s, 1)
        open(b, 'w', encoding='utf-8', newline='').write(s)
    open(p, 'w', encoding='utf-8', newline='').write(t)
    return 1
