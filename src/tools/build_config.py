# -*- coding: utf-8 -*-
"""TeleNova 3.3 - defaults, home rows and labels of the build.   python src/tools/build_config.py <kodi-home-dir>

Applied to the staged build before packaging (safe to run again: every step checks what is there).
Every change is a setting, a label or a few XML lines - no skin layout is redesigned.
"""
import os
import re
import sqlite3
import sys

root = sys.argv[1]
U = os.path.join(root, 'userdata')
SKIN = os.path.join(root, 'addons', 'skin.fentastic')
X = os.path.join(SKIN, 'xml')
done = []


def edit(path, fn):
    if not os.path.exists(path):
        return False
    with open(path, encoding='utf-8', newline='') as f:
        src = f.read()
    out = fn(src)
    if out != src:
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(out)
        return True
    return False


# ------------------------------------------------------------------ 1. Kodi settings
GUI = {
    # remote-control port open to the whole network (phone hotspot, hotel Wi-Fi, car) without a password
    'services.esallinterfaces': 'false',
    'services.devicename': 'TeleNova',
    # the keymap gives OK another job in live TV, so a channel change that waits for OK never happened
    'pvrplayback.confirmchannelswitch': 'false',
    # Hebrew subtitle files that are not UTF-8 are Windows-1255; UTF-8 files are recognised and left alone
    'subtitles.charset': 'CP1255',
    # the next item starts by itself for series only - not after a film or a single clip
    'videoplayer.autoplaynextitem': '1,2',
    # the original sound track of a film, not always the English one (Israeli and dubbed content)
    'locale.audiolanguage': 'mediadefault',
}


def gui(src):
    for sid, val in GUI.items():
        src = re.sub(r'<setting id="%s"(?: default="\w+")?>[^<]*</setting>' % re.escape(sid),
                     '<setting id="%s">%s</setting>' % (sid, val), src)
    # the same UUID was cloned to every install: Kodi makes a new one when the line is missing
    return re.sub(r'[ \t]*<setting id="services\.deviceuuid"[^>]*>[^<]*</setting>\r?\n', '', src)


if edit(os.path.join(U, 'guisettings.xml'), gui):
    done.append('Kodi settings')

if edit(os.path.join(U, 'advancedsettings.xml'),
        lambda s: re.sub(r'[ \t]*<scanirserver>false</scanirserver>\r?\n', '', s)):
    done.append('advancedsettings: obsolete tag removed')

# ------------------------------------------------------------------ 2. skin settings
# 'use_my_custom_list' made the skin's helper pick one of ten third-party MDbList keys and ask that service
# about every title the cursor rests on - a network request per focus on a TV box, with somebody else's key
if edit(os.path.join(U, 'addon_data', 'skin.fentastic', 'settings.xml'),
        lambda s: s.replace('<setting id="mdblist_api_key" type="string">use_my_custom_list</setting>',
                            '<setting id="mdblist_api_key" type="string"></setting>')
        .replace('<setting id="MenuCustom1Label" type="string">[B]עידן פלוס[/B]</setting>',
                 '<setting id="MenuCustom1Label" type="string">[B]טלוויזיה ורדיו[/B]</setting>')):
    done.append('skin settings')

# ------------------------------------------------------------------ 3. the skin's widget database
# its rows still described the POV home screen; any "rebuild" of the skin (version change, profile change, the
# button in the skin settings) would have replaced the TeleNova rows with dead POV widgets
N = 'plugin://plugin.video.nova/'
Y = '[B][COLOR FFE8BE5A]%s[/COLOR][/B]'
ROWS = [
    ('movie.main_menu', N + '?a=media_root&m=movie', '[B]סרטים[/B]', '', ''),
    ('movie.widget.1', N + '?a=list&m=movie&path=/trending/movie/week', Y % 'חם השבוע', 'WidgetListBigPoster', 'BigPoster'),
    ('movie.widget.2', N + '?a=list&m=movie&path=/movie/top_rated', Y % 'המדורגים ביותר', 'WidgetListBigPoster', 'BigPoster'),
    ('movie.widget.3', N + '?a=list&m=movie&path=/movie/now_playing', Y % 'עכשיו בקולנוע', 'WidgetListBigPoster', 'BigPoster'),
    ('movie.widget.4', N + '?a=genres&m=movie', Y % 'לפי קטגוריה', 'WidgetListCategory', 'Category'),
    ('tvshow.main_menu', N + '?a=media_root&m=tv', '[B]סדרות[/B]', '', ''),
    ('tvshow.widget.1', N + '?a=list&m=tv&path=/trending/tv/week', Y % 'חם השבוע', 'WidgetListBigPoster', 'BigPoster'),
    ('tvshow.widget.2', N + '?a=list&m=tv&path=/tv/top_rated', Y % 'המדורגות ביותר', 'WidgetListBigPoster', 'BigPoster'),
    ('tvshow.widget.3', N + '?a=list&m=tv&path=/tv/on_the_air', Y % 'משודרות עכשיו', 'WidgetListBigPoster', 'BigPoster'),
    ('tvshow.widget.4', N + '?a=genres&m=tv', Y % 'לפי קטגוריה', 'WidgetListCategory', 'Category'),
    ('custom1.main_menu', N + '?a=tvradio', '[B]טלוויזיה ורדיו[/B]', '', ''),
    ('custom1.widget.1', N + '?a=tv_list&gname=first', Y % 'ערוצים', 'WidgetListBigLandscape', 'BigLandscape'),
    ('custom1.widget.2', N + '?a=radio_list&by=country&v=IL', Y % 'רדיו', 'WidgetListBigLandscape', 'BigLandscape'),
]
db = os.path.join(U, 'addon_data', 'script.fentastic.helper', 'cpath_cache.db')
if os.path.exists(db):
    c = sqlite3.connect(db)
    stale = c.execute("select count(*) from custom_paths where cpath_path like '%plugin.video.pov%' "
                      "or cpath_path like '%idanplus%' or cpath_header like '%??%'").fetchone()[0]
    if stale:
        c.execute('delete from custom_paths')
        c.executemany('insert into custom_paths (cpath_setting, cpath_path, cpath_header, cpath_type, cpath_label) '
                      'values (?, ?, ?, ?, ?)',
                      [(a, b, h, t, ('%s | %s' % (h, lab)) if lab else '') for a, b, h, t, lab in ROWS])
        c.commit()
        c.execute('vacuum')
        done.append('widget database: %d POV rows replaced' % stale)
    c.close()

# ------------------------------------------------------------------ 4. home rows: something new first
# Movies and Series opened with a search box and three category strips; the week's trending titles (posters)
# now come right after the search and replace the least used strip ("by language")
TREND = '''        <include content="WidgetListBigPoster">
            <param name="content_path" value="plugin://plugin.video.nova/?a=list&amp;m=%s&amp;path=/trending/%s/week"/>
            <param name="widget_header" value="[B][COLOR FFE8BE5A]חם השבוע[/COLOR][/B]"/>
            <param name="widget_target" value="videos"/>
            <param name="list_id" value="%s"/>
        </include>
'''


def rows(kind):
    def fn(src):
        if '/trending/%s/week' % kind in src:
            return src
        m = re.search(r'[ \t]*<include content="\w+">\s*<param name="content_path" value="plugin://plugin\.video\.nova/'
                      r'\?a=langs&amp;m=%s"/>.*?<param name="list_id" value="(\d+)"/>\s*</include>\r?\n' % kind, src, re.S)
        if not m:
            return src
        nl = '\r\n' if '\r\n' in src else '\n'
        src = src[:m.start()] + src[m.end():]
        first = re.search(r'</include>\r?\n', src[src.index('BNSearchWidget'):])
        at = src.index('BNSearchWidget') + first.end()
        return src[:at] + (TREND % (kind, kind, m.group(1))).replace('\n', nl) + src[at:]
    return fn


for fname, kind in (('script-fentastic-widget_movies.xml', 'movie'), ('script-fentastic-widget_tvshows.xml', 'tv')):
    if edit(os.path.join(X, fname), rows(kind)):
        done.append('home row "trending" (%s)' % kind)

# ------------------------------------------------------------------ 5. names the viewer sees
PO = {'700050': ('Open TeleNova Settings', 'הגדרות TeleNova'),
      '700051': ('Open Subtitle Settings', 'הגדרות כתוביות'),
      '700053': ('Clear Subtitle Cache', 'ניקוי מטמון כתוביות'),
      '700061': ('Choose Subtitles', 'בחירת כתוביות')}


def po(lang):
    def fn(src):
        for sid, (en, he) in PO.items():
            src = re.sub(r'(msgctxt "#%s"\s*\nmsgid ")[^"]*("\s*\nmsgstr ")[^"]*(")' % sid,
                         lambda m: m.group(1) + en + m.group(2) + (he if lang == 'he_il' else '') + m.group(3), src)
        return src
    return fn


for lang in ('he_il', 'en_gb'):
    if edit(os.path.join(SKIN, 'language', 'resource.language.' + lang, 'strings.po'), po(lang)):
        done.append('labels (%s)' % lang)

if edit(os.path.join(X, 'Variables.xml'),
        lambda s: re.sub(r'(<value condition="String\.IsEqual\(Skin\.String\(current_search_provider\),[03]\)">)POV(</value>)',
                         r'\1TeleNova\2', s).replace(
            '<value condition="String.IsEqual(Skin.String(current_search_provider),4)">Seren</value>\n\t<value>FEN</value>',
            '<value condition="String.IsEqual(Skin.String(current_search_provider),4)">Seren</value>\n\t<value>TeleNova</value>')):
    done.append('search dialog names TeleNova')

if edit(os.path.join(X, 'Custom_1132_ExtendedInfo.xml'),
        lambda s: s.replace("<label>נגן אוט' Pov</label>", '<label>נגן אוטומטי</label>').replace('<label>נגן Pov</label>', '<label>נגן</label>')):
    done.append('information window buttons renamed')

if edit(os.path.join(X, 'script-fentastic-main_menu_custom3.xml'), lambda s: s.replace('<label>BN</label>', '<label>TeleNova</label>')):
    done.append('home menu item BN -> TeleNova')

# pressing Up in the information window offered to install an add-on that is not part of the build
if edit(os.path.join(X, 'DialogVideoInfo.xml'),
        lambda s: re.sub(r'[ \t]*<onup condition="!System\.HasAddon\(script\.embuary\.info\)[^"]*">InstallAddon\(script\.embuary\.info\)</onup>\r?\n', '', s)):
    done.append('information window: install prompt removed')

# ------------------------------------------------------------------ 6. subtitle fonts without Hebrew letters
# both files answer to the family "NarkisTam Light" but contain no Hebrew code points: chosen as the subtitle
# font they showed empty boxes
fonts = os.path.join(root, 'media', 'fonts')
gone = 0
for fn in ('NarkisTamLight.ttf', 'NTAMLI.ttf'):
    p = os.path.join(fonts, fn)
    if os.path.exists(p):
        os.remove(p)
        gone += 1
if gone:
    edit(os.path.join(fonts, 'fontcache.xml'),
         lambda s: re.sub(r'\s*<font>\s*<filename>(?:NarkisTamLight|NTAMLI)\.ttf</filename>\s*<familyname>[^<]*</familyname>\s*</font>', '', s))
    done.append('%d subtitle fonts without Hebrew removed' % gone)

print('build config:', '; '.join(done) if done else 'nothing to change')
