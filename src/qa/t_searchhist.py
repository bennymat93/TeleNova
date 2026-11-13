# -*- coding: utf-8 -*-
"""4.0.7: search history and the suggestions under the search box. No Kodi, no network."""
import importlib, io, os, sys, tempfile, types

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
NOVA = os.path.join(HERE, '..', 'plugin.video.nova')
TMP = tempfile.mkdtemp(prefix='tn_sh_')
for name in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules[name] = types.ModuleType(name)
x = sys.modules['xbmc']
x.LOGINFO, x.LOGWARNING, x.LOGERROR, x.LOGDEBUG, x.ISO_639_1 = 1, 2, 3, 0, 0
x.log = lambda *a, **k: None
x.getLanguage = lambda *a, **k: 'en'
x.getCondVisibility = lambda c: kb_open[0]
sent = []
x.executeJSONRPC = lambda s: sent.append(s) or '{}'
x.Monitor = type('Monitor', (), {'abortRequested': lambda s: False, 'waitForAbort': lambda s, t=0: False})
sys.modules['xbmcaddon'].Addon = lambda *a: types.SimpleNamespace(
    getAddonInfo=lambda k: {'profile': TMP, 'path': NOVA}.get(k, ''), getSetting=lambda k: '', setSetting=lambda k, v: None)
sys.modules['xbmcvfs'].translatePath = lambda p: p
kb_open = [True]
props, typed, added = {}, [''], []
g, pl = sys.modules['xbmcgui'], sys.modules['xbmcplugin']
g.Window = lambda *a: types.SimpleNamespace(setProperty=lambda k, v: props.__setitem__(k, v),
                                            clearProperty=lambda k: props.pop(k, None), getProperty=lambda k: props.get(k, ''))


class _Dlg(object):
    def input(self, heading, default='', **kw):
        seen_prop.append(props.get('bn.search'))
        if typed[0] is None:
            raise RuntimeError('keyboard failed')
        return typed[0]


class _Item(object):
    def __init__(self, label=''):
        self.label = label

    def setArt(self, a):
        pass

    def setProperty(self, k, v):
        pass


g.Dialog, g.ListItem = _Dlg, _Item
pl.addDirectoryItem = lambda h, u, li, folder: added.append((u, li.label, folder))
pl.endOfDirectory = lambda *a, **k: None
seen_prop = []
sys.path.insert(0, NOVA)
sh = importlib.import_module('resources.lib.searchhist')
bad = []


def check(cond, what):
    if not cond:
        bad.append(what)


# ---- history rules
h = sh.add([], 'The Matrix', 100)
h = sh.add(h, '  fauda   season 2 ', 200)
h = sh.add(h, 'the matrix', 300)
check([e['q'] for e in h] == ['the matrix', 'fauda season 2'], 'newest first, one entry per text: %r' % h)
check(sh.add(h, 'x', 1) == h and sh.add(h, '', 1) == h, 'a single letter / nothing is not a search')
big = []
for i in range(80):
    big = sh.add(big, 'query %d' % i, i)
check(len(big) == sh.KEEP and big[0]['q'] == 'query 79', 'the list is kept short')
check([e['q'] for e in sh.remove(h, 'THE MATRIX')] == ['fauda season 2'], 'remove one')
hist = [{'q': q, 'ts': 1} for q in ('matrix reloaded', 'the matrix', 'fauda', 'Matilda', u'פאודה', u'שובר שורות')]
check(sh.match(hist, '') == [e['q'] for e in hist], 'nothing typed: the latest searches')
check(sh.match(hist, 'mat') == ['matrix reloaded', 'Matilda', 'the matrix'], 'starts-with first, then contains: %r' % sh.match(hist, 'mat'))
check(sh.match(hist, u'שוב') == [u'שובר שורות'] and sh.match(hist, 'zzz') == [], 'Hebrew / no match')
check(sh.match(hist, 'fauda') == [], 'the text itself is not a suggestion')
check(len(sh.match(big, 'query', 9)) == 9, 'limit')
res = [{'media_type': 'movie', 'title': 'The Matrix', 'original_title': 'The Matrix', 'popularity': 90},
       {'media_type': 'movie', 'title': u'מטריקס', 'original_title': 'The Matrix Reloaded', 'popularity': 50},
       {'media_type': 'tv', 'name': 'Matrix', 'popularity': 5}, {'media_type': 'person', 'name': 'Matrix Guy', 'popularity': 99},
       {'media_type': 'movie', 'title': 'The Matrix', 'popularity': 1}]
t = sh.titles_of(res, 'matr')
check(t == ['The Matrix', 'The Matrix Reloaded', 'Matrix'], 'titles: best known first, people left out, no doubles: %r' % t)
m = sh.merge(['the matrix', 'matrix reloaded'], ['The Matrix', 'Matrix', 'matr'], 'matr', 9)
check(m == [('the matrix', 'history'), ('matrix reloaded', 'history'), ('Matrix', 'title')], 'history first, no doubles, never the typed text: %r' % m)
check(len(sh.merge(['a%d' % i for i in range(20)], [], '', 9)) == 9, 'nine at most')

# ---- the search keyboard: suggestions on while it is open, the text is remembered
typed[0] = '  Breaking   Bad '
check(sh.ask('Search') == 'Breaking Bad' and seen_prop[-1] == '1' and 'bn.search' not in props, 'property set during the keyboard only')
check(sh.load()[0]['q'] == 'Breaking Bad', 'the search is in the history')
typed[0] = ''
check(sh.ask('Search') == '' and len(sh.load()) == 1, 'a cancelled keyboard adds nothing')
typed[0] = None
try:
    sh.ask('Search')
except RuntimeError:
    pass
check('bn.search' not in props, 'the property is cleared even when the keyboard fails')

# ---- the panel
sh.online = lambda text: ['Breaking Bad', 'Breaking Dawn'] if text else []
added[:] = []
sh.suggest(1, 'brea')
check(added == [], 'outside a search box nothing is suggested (and nothing looked up)')
props['bn.search'] = '1'
sh.suggest(1, 'brea')
check([a[1] for a in added] == ['Breaking Bad', 'Breaking Dawn'] and all(not a[2] for a in added), 'history hit + catalogue title: %r' % added)
check(added[0][0] == 'plugin://plugin.video.nova/?a=ac_pick&q=Breaking%20Bad', 'the item carries its text, encoded')
added[:] = []
sh.suggest(1, '')
check([a[1] for a in added] == ['Breaking Bad'], 'nothing typed: the history')
sh.pick('Breaking Bad')
check(len(sent) == 1 and '"text": "Breaking Bad"' in sent[0] and '"done": false' in sent[0], 'a pick fills the box and leaves it open')
kb_open[0] = False
sh.pick('x y')
check(len(sent) == 1, 'no keyboard open: nothing is typed anywhere')
for k, v in sh.STR.items():
    check(len(v) == 3 and all(v), 'string %s in three languages' % k)

# ---- the skin patch
sp = importlib.import_module('resources.lib.skinpatch')
xml = os.path.join(TMP, 'xml')
os.makedirs(xml)
var = ('<includes>\r\n\t<variable name="AutoCompletionContentVar">\r\n\t\t<value condition="System.AddonIsEnabled(plugin.program.autocompletion) + '
       '!System.HasHiddenInput">plugin://plugin.program.autocompletion?info=autocomplete</value>\r\n\t</variable>\r\n</includes>\r\n')
io.open(os.path.join(xml, 'Variables.xml'), 'w', encoding='utf-8', newline='').write(var)
check(sp.keyboard_complete(xml) == 1 and sp.keyboard_complete(xml) == 0, 'patched once')
out = io.open(os.path.join(xml, 'Variables.xml'), encoding='utf-8', newline='').read()
from xml.dom import minidom
minidom.parseString(out.encode('utf-8'))
check(out.index('plugin.video.nova/?a=ac') < out.index('plugin.program.autocompletion?info'), 'our value is tried first')
check('bn.search' in out and '!System.HasHiddenInput' in sp.AC_VALUE and '\n' not in out.replace('\r\n', ''), 'search boxes only, never a hidden box; line ends kept')
os.remove(os.path.join(xml, 'Variables.xml'))
io.open(os.path.join(xml, 'Variables.xml'), 'w', encoding='utf-8').write(u'<includes></includes>')
check(sp.keyboard_complete(xml) == 0, 'a skin without the panel is left alone')

for b in bad:
    print('FAIL', b)
print('SEARCHHIST TESTS OK' if not bad else 'SEARCHHIST TESTS: %d problems' % len(bad))
import shutil
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if bad else 0)
