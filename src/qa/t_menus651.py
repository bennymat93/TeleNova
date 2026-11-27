# -*- coding: utf-8 -*-
"""6.5.1: the hub's menus, checked on the source alone (no Kodi, nothing imported from the add-on but one pure
helper): every row has a picture that exists and a description, every text exists in he / en / ru, the sync screen
has its own action, and an all-gold row carries its plain text for the focused state."""
import ast
import io
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
NOVA = os.path.join(HERE, '..', 'plugin.video.nova')
LIB = os.path.join(NOVA, 'resources', 'lib')
bad = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        bad.append(what)


def read(path):
    with io.open(path, encoding='utf-8') as f:
        return f.read()


def name_of(call):
    f = call.func
    return f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else '')


def literal_dict(tree, name):
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return ast.literal_eval(node.value)
    return None


src = read(os.path.join(NOVA, 'default.py'))
tree = ast.parse(src, feature_version=(3, 8))
funcs = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)]
strings = literal_dict(ast.parse(read(os.path.join(LIB, 'common.py'))), 'STRINGS')

# ------------------------------------------------------------------ icons
fallback = literal_dict(tree, 'ICON_FALLBACK')
check(isinstance(fallback, dict) and len(fallback) >= 18, 'ICON_FALLBACK is a plain dict')
names = set()
for c in calls:
    if name_of(c) == 'icon' and c.args and isinstance(c.args[0], ast.Constant) and isinstance(c.args[0].value, str):
        names.add(c.args[0].value)
check(len(names) >= 15, 'icon() names found in default.py: %d' % len(names))
media = os.path.join(NOVA, 'resources', 'media')
for n in sorted(names - {'fanart'}):
    on_disk = any(os.path.exists(os.path.join(media, n + e)) for e in ('.png', '.jpg'))
    check(n in fallback or on_disk, 'icon %r has a picture or a fallback' % n)
check(os.path.exists(os.path.join(media, 'fanart.jpg')) or os.path.exists(os.path.join(media, 'fanart.png')), 'fanart exists')
for k, v in sorted((fallback or {}).items()):
    if not re.match(r'^Default[A-Za-z0-9]+\.png$', v):
        check(False, 'fallback of %r is a Kodi default texture: %r' % (k, v))
check('DefaultFolder.png' not in (fallback or {}).values(), 'no fallback is the plain folder')

# ------------------------------------------------------------------ descriptions
MENUS = ('root', 'sys_menu', 'src_menu', 'media_root', 'bk_menu')
for fn in MENUS:
    body = [n for n in ast.walk(funcs[fn]) if isinstance(n, ast.Call)]
    rows = [c for c in body if name_of(c) == 'folder']
    missing = [c.lineno for c in rows if not any(k.arg == 'plot' for k in c.keywords)]
    check(rows and not missing, '%s: every folder() row has a plot (%d rows)%s' % (fn, len(rows), ' - lines %s' % missing if missing else ''))
    items = [c for c in body if name_of(c) in ('ListItem', 'gold_item')]
    plots = [c for c in body if name_of(c) == 'setPlot']
    check(len(items) == len(plots), '%s: every hand-built row has a plot (%d / %d)' % (fn, len(plots), len(items)))
    check(any(k.arg == 'title' for c in body if name_of(c) == 'end' for k in c.keywords), '%s: the menu names itself (end(title=...))' % fn)
keys = set()
for c in calls:
    if name_of(c) == 'T' and c.args and isinstance(c.args[0], ast.Constant) and isinstance(c.args[0].value, str):
        keys.add(c.args[0].value)
keys |= set(re.findall(r"'(d_[a-z_]+)'", src))
dkeys = sorted(k for k in keys if k.startswith('d_'))
check(len(dkeys) >= 40, 'description keys used in default.py: %d' % len(dkeys))
for k in dkeys:
    check(k in strings, 'description %s exists' % k)
for k, v in sorted(strings.items()):
    if k.startswith('d_'):
        ok = isinstance(v, tuple) and len(v) == 3 and all(isinstance(x, str) and x.strip() for x in v) and max(len(x) for x in v) <= 170
        if not ok:
            check(False, 'description %s: three non-empty texts of at most 170 characters' % k)
unused = sorted(k for k in strings if k.startswith('d_') and k not in keys)
check(not unused, 'no description without a row: %s' % unused)

# ------------------------------------------------------------------ three languages
check(not re.search(r'\b_he\(', src), 'default.py: no two-language _he() left')
tcalls = [c for c in calls if name_of(c) == '_t']
short = [c.lineno for c in tcalls if not (len(c.args) == 3 or (len(c.args) == 1 and isinstance(c.args[0], ast.Starred)))]
check(len(tcalls) >= 19 and not short, '_t() always gets he, en, ru (%d calls)%s' % (len(tcalls), ' - lines %s' % short if short else ''))
for name in ('SRC_TITLE', 'BK_TITLE', 'SYS_TITLE'):
    v = literal_dict(tree, name)
    check(isinstance(v, tuple) and len(v) == 3 and all(v), '%s in three languages' % name)
n_tables = 0
for fn in sorted(os.listdir(LIB)):
    if not fn.endswith('.py'):
        continue
    mod = ast.parse(read(os.path.join(LIB, fn)))
    for table in ('STR', 'STRINGS', 'LABELS'):
        try:
            d = literal_dict(mod, table)
        except ValueError:          # built with code, not a literal: not this test's business
            continue
        if not isinstance(d, dict) or not d or not all(isinstance(v, tuple) for v in d.values()):
            continue
        n_tables += 1
        wrong = sorted(k for k, v in d.items() if len(v) != 3 or not all(isinstance(x, str) and x for x in v))
        check(not wrong, '%s %s: every text in he / en / ru%s' % (fn, table, ' - %s' % wrong[:8] if wrong else ''))
check(n_tables >= 10, 'string tables checked: %d' % n_tables)
tk = ast.parse(read(os.path.join(LIB, 'ticker.py')))
check(all(len(v) == 3 and all(v) for v in literal_dict(tk, 'WMO').values()), 'ticker: weather words in three languages')
days = literal_dict(tk, 'DAYS')
check(set(days) == {'he', 'en', 'ru'} and all(len(v) == 7 for v in days.values()), 'ticker: day names in three languages')

# ------------------------------------------------------------------ the sync screen's own action
simple = set()
for n in ast.walk(funcs['router']):
    if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'simple' for t in n.targets):
        simple = set(k.value for k in n.value.keys if isinstance(k, ast.Constant))
actions = literal_dict(tree, 'ACTIONS')
check('sync_screen' in simple and 'sync_screen' in actions, 'sync_screen is a routed action that closes the directory first')
check('sync_menu' in simple and 'sync_menu' in actions, 'sync_menu (the player\'s subtitle sync) is still its own action')
check(not (actions - simple), 'every ACTION has a route: %s' % sorted(actions - simple))
check("a='sync_screen'" in ast.get_source_segment(src, funcs['bk_menu']), 'the backup menu has the sync settings row')

# ------------------------------------------------------------------ gold rows carry their plain text
m = re.search(r"_GOLD_RX = .*?\n\n\ndef plain_of\(label\):.*?\n\n\n", read(os.path.join(LIB, 'common.py')), re.S)
ns = {'re': re}
exec(m.group(0), ns)
plain_of = ns['plain_of']
check(plain_of('[COLOR gold]Update[/COLOR]') == 'Update' and plain_of('[COLOR gold][B]All in one[/B][/COLOR]') == 'All in one'
      and plain_of('[COLOR FFE8BE5A]» fix[/COLOR]') == '» fix', 'plain_of: an all-gold label -> its text')
check(plain_of('Movies') == '' and plain_of('x [COLOR gold]on[/COLOR]') == '' and plain_of(None) == ''
      and plain_of('[COLOR gold]a[/COLOR]  [COLOR grey]b[/COLOR]') == '' and plain_of('[COLOR red]x[/COLOR]') == '',
      'plain_of: partly coloured / other labels -> nothing')
for fn in ('root', 'bk_menu'):
    seg = ast.get_source_segment(src, funcs[fn])
    raw = [c for c in ast.walk(funcs[fn]) if isinstance(c, ast.Call) and name_of(c) == 'ListItem'
           and '[COLOR gold]' in ast.get_source_segment(src, c)]
    check(not raw, '%s: no gold row built as a bare ListItem (use gold_item)' % fn)
    for c in ast.walk(funcs[fn]):
        if isinstance(c, ast.Call) and name_of(c) == 'folder' and '[COLOR gold]' in ast.get_source_segment(src, c):
            check(any(k.arg == 'plain' for k in c.keywords), '%s line %d: the gold folder row passes plain=' % (fn, c.lineno))
    check('[COLOR gold]' in seg or 'gold_item(' in seg, '%s still has its gold rows' % fn)
check("setProperty('bn_plain'" in ast.get_source_segment(src, funcs['folder']), 'folder() sets bn_plain')

print('MENUS 6.5.1 TESTS OK' if not bad else 'MENUS 6.5.1 TESTS: %d problems' % len(bad))
sys.exit(1 if bad else 0)
