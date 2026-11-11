# -*- coding: utf-8 -*-
"""TeleNova 3.1: the build no longer uses POV. Pure Python (no Kodi modules) so the same code prepares a new
build and migrates a box that updates from the repository.

patch_skin(xml_dir)      -> every POV link of the BN skin (skin.fentastic) points at TeleNova instead
clean_favourites(path)   -> favourites that open POV (or its helper) are removed
Each changed file is first copied to <name>.pre-telenova and re-parsed after the change; a file that would no
longer be valid XML is restored, so a failed patch can never break the skin.
"""
import os
import re
import shutil
import xml.etree.ElementTree as ET

NOVA = 'plugin://plugin.video.nova/'
# add-ons that gave no content of their own (or only fed POV): not shipped any more, disabled on updated boxes
REMOVED = ['plugin.video.pov', 'repository.kodifitzwell', 'script.module.magneto', 'service.xbmc.versioncheck',
           'script.speedtester', 'plugin.video.archive.org', 'plugin.video.tekthing', 'plugin.video.fosdem',
           'plugin.video.media-ccc-de', 'plugin.video.esa', 'plugin.video.filmsforaction',
           'plugin.video.motorsporthub', 'plugin.video.formula1', 'plugin.video.redbull.tv',
           'plugin.video.documentaryheaven', 'plugin.video.vimeo', 'plugin.video.dailymotion_com']

# 3.2: add-ons that only worked in the background (a second automatic subtitle search at every start of a video,
# resume helpers, keyboard suggestions fetched per key press)
REMOVED_LITE = ['service.subtitles.all_subs_plus', 'script.common.plugin.cache', 'script.xbmc.unpausejumpback',
                'script.module.bossanova808', 'plugin.program.autocompletion', 'script.module.autocompletion']

_P = r'plugin://plugin\.video\.pov/\?'
_A = r'(?:&amp;|&)'
_RULES = [
    # text searches (title, person, keyword, collection ...) -> TeleNova "search all sources"
    (re.compile(_P + r'[^"<]*?' + _A + r'?(?:query|list_id|search_title)=(?=\$)'), NOVA + '?a=hub_search&amp;q='),
    # the search-history pages of movies / series -> the category searches
    (re.compile(_P + r'(?:mode=search_history' + _A + r'action=movie|action=movie' + _A + r'mode=search_history)'),
     NOVA + '?a=search&amp;m=movie'),
    (re.compile(_P + r'(?:mode=search_history' + _A + r'action=tvshow|action=tvshow' + _A + r'mode=search_history)'),
     NOVA + '?a=search&amp;m=tv'),
    # season / episode lists of a title
    (re.compile(_P + r'mode=build_season_list' + _A + r'tmdb_id='), NOVA + '?a=seasons&amp;id='),
    (re.compile(_P + r'mode=build_episode_list' + _A + r'season=(.*?)' + _A + r'tmdb_id='), NOVA + r'?a=episodes&amp;s=\1&amp;id='),
    # home rows
    (re.compile(_P + r'action=trakt_movies_trending[^<"]*'), NOVA + '?a=list&amp;m=movie&amp;path=%2Ftrending%2Fmovie%2Fweek'),
    (re.compile(_P + r'action=trakt_tv_trending[^<"]*'), NOVA + '?a=list&amp;m=tv&amp;path=%2Ftrending%2Ftv%2Fweek'),
    (re.compile(_P + r'[^<"]*mode=build_in_progress_episode[^<"]*'), NOVA + '?a=history'),
    # anything else that opened a POV page -> the TeleNova menu
    (re.compile(_P + r'(?:(?!&quot;)[^"<,)\s])*'), NOVA + '?a=noop'),
    (re.compile(r'plugin://plugin\.video\.pov/?'), NOVA),
    (re.compile(r'Addon\.OpenSettings\(plugin\.video\.pov\)'), 'Addon.OpenSettings(plugin.video.nova)'),
    (re.compile(r'RunAddon\(&quot;plugin\.video\.pov&quot;\)|RunAddon\(plugin\.video\.pov\)'), 'RunAddon(plugin.video.nova)'),
]


# 3.3: what the first pass left behind - menu items that still pointed at nothing (?a=noop) or at the POV wizard.
# "Search by year" opens TeleNova's year list; an item with no TeleNova counterpart (collections, people, Trakt
# lists, the POV wizard's skin switch / update check, POV tools of the power menu) is hidden instead of doing nothing.
_HIDE = '<visible>false</visible>'
_RULES33 = [
    (re.compile(r'<onclick>ActivateWindow\(10025,&quot;plugin://plugin\.video\.nova/\?a=noop&quot;,return\)</onclick>'),
     '<onclick>ActivateWindow(Videos,&quot;plugin://plugin.video.nova/?a=years&amp;m=movie&quot;,return)</onclick>'),
    (re.compile(r'<onclick(?: condition="[^"]*")?>(?:ActivateWindow\(Videos,|PlayMedia\()(?:"|&quot;)'
                r'plugin://plugin\.video\.nova/\?a=noop(?:"|&quot;)(?:,return)?\)</onclick>'), _HIDE),
    (re.compile(r'<onclick>PlayMedia\(&quot;plugin://plugin\.program\.kodipovilwizard/[^<]*</onclick>'), _HIDE),
]
_FILES33 = ('Custom_1107_SearchDialog.xml', 'DialogButtonMenu.xml')


def patch_skin33(xml_dir):
    """returns the number of skin files changed; safe to run again (nothing matches the second time)"""
    changed = 0
    for fn in _FILES33:
        p = os.path.join(xml_dir, fn)
        try:
            with open(p, encoding='utf-8', newline='') as f:
                src = f.read()
        except (OSError, UnicodeDecodeError):
            continue
        out = src
        for rx, rep in _RULES33:
            out = rx.sub(rep, out)
        if out == src:
            continue
        was_valid = _valid(p)
        bak = p + '.pre-telenova33'
        if not os.path.exists(bak):
            shutil.copyfile(p, bak)
        with open(p, 'w', encoding='utf-8', newline='') as f:
            f.write(out)
        if was_valid and not _valid(p):
            shutil.copyfile(bak, p)
            continue
        changed += 1
    return changed


def _valid(path):
    try:
        ET.parse(path)
        return True
    except ET.ParseError:
        return False


def patch_text(text):
    for rx, rep in _RULES:
        text = rx.sub(rep, text)
    return text.replace('plugin.video.pov', 'plugin.video.nova')


def patch_skin(xml_dir):
    """returns the number of skin files changed (0 = nothing to do / already done)"""
    changed = 0
    if not os.path.isdir(xml_dir):
        return 0
    for fn in sorted(os.listdir(xml_dir)):
        if not fn.lower().endswith('.xml'):
            continue
        p = os.path.join(xml_dir, fn)
        try:
            with open(p, encoding='utf-8', newline='') as f:
                src = f.read()
        except (OSError, UnicodeDecodeError):
            continue
        if 'plugin.video.pov' not in src:
            continue
        was_valid = _valid(p)
        bak = p + '.pre-telenova'
        if not os.path.exists(bak):
            shutil.copyfile(p, bak)
        with open(p, 'w', encoding='utf-8', newline='') as f:
            f.write(patch_text(src))
        if was_valid and not _valid(p):         # never leave a broken skin file behind
            shutil.copyfile(bak, p)
            continue
        changed += 1
    return changed


def clean_favourites(path):
    """removes the favourites that open POV / its subscription helper; returns how many were removed"""
    try:
        with open(path, encoding='utf-8') as f:
            src = f.read()
    except (OSError, UnicodeDecodeError):
        return 0
    rx = re.compile(r'[ \t]*<favourite\b[^>]*>[^<]*(?:plugin\.video\.pov|kodipovilai|kodipovilwizard|plugin\.video\.otaku|orderfavourites)[^<]*</favourite>\r?\n?')
    out, n = rx.subn('', src)
    if not n:
        return 0
    bak = path + '.pre-telenova'
    if not os.path.exists(bak):
        shutil.copyfile(path, bak)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(out)
    if not _valid(path):
        shutil.copyfile(bak, path)
        return 0
    return n
