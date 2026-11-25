# -*- coding: utf-8 -*-
"""Help (last main-menu item): user guide, troubleshooting table, search over both, About.

Content lives in resources/help/guide.json and trouble.json (he + en + ru; a missing ru part shows English).
The language toggle (Hebrew -> English -> Russian)
is the setting help_lang ('' = follow the interface). search() / text helpers are plain Python for unit tests.
"""
import json
import os
import re

HERE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'help')
STR = {
    'guide': ('מדריך למשתמש', 'User guide', 'Руководство'), 'trouble': ('פתרון בעיות', 'Troubleshooting', 'Решение проблем'),
    'search': ('חיפוש בעזרה', 'Search help', 'Поиск по справке'), 'about': ('אודות', 'About', 'О программе'),
    'speed': ('בדיקת מהירות', 'Speed test', 'Тест скорости'),
    'problem': ('בעיה', 'Problem', 'Проблема'), 'causes': ('סיבות אפשריות', 'Possible causes', 'Возможные причины'),
    'fix': ('פתרון מוצע', 'Suggested fix', 'Решение'), 'none': ('לא נמצאו תוצאות', 'No results', 'Ничего не найдено'),
    'build': ('Build', 'Build', 'Build'), 'version': ('גרסה', 'Version', 'Версия'),
    'built': ('תאריך בנייה', 'Build date', 'Дата сборки'),
    'kodi': ('גרסת Kodi', 'Kodi version', 'Версия Kodi'), 'platform': ('פלטפורמה', 'Platform', 'Платформа'),
    'profile': ('סוג מכשיר', 'Device type', 'Тип устройства'),
    'addons': ('תוספים מותקנים', 'Installed add-ons', 'Установленные дополнения'),
    'credits': ('קרדיטים', 'Credits', 'Благодарности'),
    'license': ('רישיון', 'License', 'Лицензия'), 'support': ('תמיכה', 'Support', 'Поддержка'),
}
LI = {'he': 0, 'en': 1, 'ru': 2}
LANGS = ('he', 'en', 'ru')                     # the toggle cycles he -> en -> ru -> he
NAMES = {'he': 'עברית', 'en': 'English', 'ru': 'Русский'}


def loc(d, lang):
    """the lang part of a guide section / table row; English when that language is missing"""
    return d.get(lang) or d['en']


def next_lang(lang):
    return LANGS[(LANGS.index(lang) + 1) % len(LANGS)] if lang in LANGS else 'he'


def load(name):
    with open(os.path.join(HERE, name + '.json'), encoding='utf-8') as f:
        return json.load(f)


def plain(text):
    return re.sub(r'\[/?[A-Z]+[^\]]*\]', ' ', (text or '').replace('[CR]', '\n'))


def search(q, lang):
    """sections and table rows containing every word of the query (either language's text, shown in lang)"""
    words = [w for w in re.findall(r'\w+', (q or '').lower()) if len(w) > 1]
    if not words:
        return []
    out = []
    for sec in load('guide')['sections']:
        hay = ' '.join(plain(sec[l]['title'] + ' ' + sec[l]['body']) for l in LANGS if l in sec).lower()
        if all(w in hay for w in words):
            out.append(('guide', sec['id'], loc(sec, lang)['title']))
    for i, row in enumerate(load('trouble')['rows']):
        hay = ' '.join(' '.join(row[l]) for l in LANGS if l in row).lower()
        if all(w in hay for w in words):
            out.append(('trouble', str(i), loc(row, lang)[0]))
    return out


def trouble_text(rows, lang):
    k = STR
    i = LI.get(lang, 1)
    out = []
    for r in rows:
        p, c, f = loc(r, lang)
        out.append('[COLOR FFE8BE5A][B]%s[/B][/COLOR]\n[B]%s:[/B] %s\n[B]%s:[/B] %s\n' % (p, k['causes'][i], c, k['fix'][i], f))
    return '\n'.join(out)


# ------------------------------------------------------------ Kodi
def _lang():
    from .common import ADDON, ui_lang
    v = ADDON.getSetting('help_lang')
    if v in LI:
        return v
    u = ui_lang()
    return u if u in LI else 'en'


def s(k):
    return STR[k][LI[_lang()]]


def root(handle, url, folder, end):
    from .common import MEDIA
    lang = _lang()
    tile = lambda n: os.path.join(MEDIA, 'cats', 'topic_%s.png' % n)
    folder(s('guide'), url(a='help_guide'), tile('guide'))
    folder(s('trouble'), url(a='help_trouble'), tile('trouble'))
    folder(s('search'), url(a='help_search'), os.path.join(MEDIA, 'search_help.png'))
    folder(s('speed'), url(a='speedtest'), tile('speed'))
    folder(s('about'), url(a='help_about'), tile('about'))
    folder('[COLOR grey]%s ⇄ %s[/COLOR]' % (NAMES[lang], NAMES[next_lang(lang)]), url(a='help_lang'),
           'DefaultAddonLanguage.png')
    end(cache=False)


def cats(handle, url):
    """home row: the Help tiles"""
    import xbmcgui
    import xbmcplugin
    from .common import MEDIA
    for key, a, icon in (('guide', 'help_guide', 'guide'), ('trouble', 'help_trouble', 'trouble'),
                         ('speed', 'speedtest', 'speed'), ('about', 'help_about', 'about')):
        tile = os.path.join(MEDIA, 'cats', 'topic_%s.png' % icon)
        li = xbmcgui.ListItem(s(key))
        li.setArt({'icon': tile, 'thumb': tile})
        xbmcplugin.addDirectoryItem(handle, url(a=a), li, a != 'speedtest')     # the test is an action, not a folder
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)


def guide(handle, url, folder, end):
    lang = _lang()
    for sec in load('guide')['sections']:
        t = loc(sec, lang)
        folder(t['title'], url(a='help_show', kind='guide', id=sec['id']), 'DefaultAddonHelper.png',
               plot=plain(t['body']))
    end(cache=False)


def trouble(handle, url, folder, end):
    lang = _lang()
    folder('[B]%s[/B]' % s('trouble'), url(a='help_show', kind='trouble', id='*'), 'DefaultIconInfo.png')
    for i, r in enumerate(load('trouble')['rows']):
        t = loc(r, lang)
        folder(t[0], url(a='help_show', kind='trouble', id=str(i)), 'DefaultIconWarning.png',
               plot='%s: %s\n%s: %s' % (s('causes'), t[1], s('fix'), t[2]))
    end(cache=False)


def show(kind, rid):
    import xbmcgui
    lang = _lang()
    if kind == 'guide':
        sec = next((x for x in load('guide')['sections'] if x['id'] == rid), None)
        if not sec:
            return
        t = loc(sec, lang)
        xbmcgui.Dialog().textviewer(t['title'], t['body'].replace('[CR]', '\n\n'))
    else:
        rows = load('trouble')['rows']
        rows = rows if rid == '*' else [rows[int(rid)]]
        xbmcgui.Dialog().textviewer(s('trouble'), trouble_text(rows, lang))


def do_search(handle, url, folder, end, q=''):
    import xbmcgui
    if not q:
        q = xbmcgui.Dialog().input(s('search'))
    if not q:
        return end()
    found = search(q, _lang())
    for kind, rid, title in found:
        folder(title, url(a='help_show', kind=kind, id=rid),
               'DefaultAddonHelper.png' if kind == 'guide' else 'DefaultIconWarning.png')
    if not found:
        folder('[COLOR grey]%s[/COLOR]' % s('none'), url(a='noop'), 'DefaultIconInfo.png')
    end(cache=False)


def toggle():
    import xbmc
    from .common import ADDON
    ADDON.setSetting('help_lang', next_lang(_lang()))
    xbmc.executebuiltin('Container.Refresh')


def about_text():
    import platform
    import xbmc
    from .common import ADDON
    lang = _lang()
    i = LI.get(lang, 1)
    built = ''
    try:
        import xbmcvfs
        built = open(xbmcvfs.translatePath('special://userdata/novatv_build.txt'), encoding='utf-8').read().strip()
    except Exception:
        pass
    from . import profiles
    r = json.loads(xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'Addons.GetAddons',
                                                  'params': {'properties': ['name', 'version', 'enabled']}})))
    adds = (r.get('result') or {}).get('addons', [])
    lines = ['[COLOR FFE8BE5A][B]BN Stream[/B][/COLOR]',
             '%s: %s' % (STR['version'][i], ADDON.getAddonInfo('version')),
             '%s: %s' % (STR['built'][i], built or '-'),
             '%s: %s' % (STR['kodi'][i], xbmc.getInfoLabel('System.BuildVersion')),
             '%s: %s (%s)' % (STR['platform'][i], platform.system() or xbmc.getInfoLabel('System.OSVersionInfo'),
                              xbmc.getInfoLabel('System.OSVersionInfo')),
             '%s: %s' % (STR['profile'][i], profiles.label(profiles.current(), lang)),
             '', '[B]%s[/B]' % STR['addons'][i]]
    lines += ['%s  %s%s' % (a.get('name') or a['addonid'], a.get('version', ''), '' if a.get('enabled') else '  (off)')
              for a in sorted(adds, key=lambda a: (a.get('name') or '').lower())]
    lines += ['', '[B]%s[/B]' % STR['credits'][i],
              'Kodi (XBMC Foundation), FENtastic skin, POV, iptv-org, radio-browser.info, TMDb, Open-Meteo, faster-whisper',
              '[B]%s[/B]: GPL-2.0 (Kodi and bundled add-ons keep their own licenses)' % STR['license'][i],
              '[B]%s[/B]: https://github.com/bennymat93/novatv/issues' % STR['support'][i]]
    return '\n'.join(lines)


def about():
    import xbmcgui
    xbmcgui.Dialog().textviewer(s('about'), about_text())
