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
    n = 0
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
    # Up from the results list reaches the AI button too (also for skins patched by 0.2.1)
    t = open(p, encoding='utf-8', newline='').read()
    old = '<control type="list" id="120">\n\t\t\t\t<top>50</top>\n\t\t\t\t<onup>false</onup>'
    if old in t:
        t = t.replace(old, old.replace('<onup>false</onup>', '<onup>7160</onup>'), 1)
        open(p, 'w', encoding='utf-8', newline='').write(t)
        n += 1
    n += _menu_button(xml)
    n += bn_player(xml)
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
    return n


# ------------------------------------------------------------------ 3.3.3: Paste + clipboard history on the keyboard
KB_MARK = '<!-- BN paste v1 -->'
KB_PASTE = 'RunPlugin(plugin://plugin.video.nova/?a=clip_paste)'
KB_HIST = 'RunPlugin(plugin://plugin.video.nova/?a=clip_menu)'
KB_PASTE_LABEL = 'הדבק'
KB_HIST_LABEL = 'היסטוריית העתקות'


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


def keyboard_buttons(xml):
    """"Paste" (grey and not clickable while nothing is copied) and "Clipboard history" in the button column of the
    on-screen keyboard, right under the voice-search button. -> 1 when the file was changed, 0 when already there."""
    p = os.path.join(xml, 'DialogKeyboard.xml')
    t = open(p, encoding='utf-8', newline='').read()
    if KB_MARK in t:
        return 0
    m = re.search(r'<control type="button" id="3010">.*?</control>', t, re.S)
    if not m:
        m = re.search(r'<include content="DefaultDialogButton">\s*<param name="id" value="301" />.*?</include>', t, re.S)
    assert m, 'keyboard button column not found'
    add = ('\n' + '\t' * 4 + KB_MARK + _kb_button(3011, KB_PASTE_LABEL, KB_PASTE, 'bn.clip.has')
           + _kb_button(3012, KB_HIST_LABEL, KB_HIST, 'bn.clip.hist'))
    t = t[:m.end()] + add + t[m.end():]
    open(p, 'w', encoding='utf-8', newline='').write(t)
    return 1

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
