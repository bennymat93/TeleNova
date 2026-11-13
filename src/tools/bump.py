# -*- coding: utf-8 -*-
"""One version number for the whole repository:  python src/tools/bump.py 4.0.3 ["news line for the engine"]
Rewrites the four addon.xml files, the build marker in Clean-Build.ps1, the README table and the links to the
repository zip (index.html, web/app.js, README)."""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
new = sys.argv[1]
news = sys.argv[2] if len(sys.argv) > 2 else ''


def edit(rel, fn):
    p = os.path.join(ROOT, rel)
    s = io.open(p, encoding='utf-8', newline='').read()
    t = fn(s)
    if t == s:
        print('!! unchanged', rel)
    else:
        io.open(p, 'w', encoding='utf-8', newline='').write(t)
        print('ok', rel)


for a in ('plugin.video.nova', 'plugin.video.telescope', 'plugin.program.novawizard', 'repository.telenova'):
    def f(s, a=a):
        s = re.sub(r'(<addon id="%s"[^>]*\bversion=")[^"]+' % re.escape(a), r'\g<1>' + new, s, 1)
        if news and a == 'plugin.video.telescope':
            s = s.replace('<news>', '<news>%s - %s ' % (new, news), 1)
        return s
    edit(os.path.join('src', a, 'addon.xml'), f)
edit(r'src\qa\Clean-Build.ps1', lambda s: re.sub(r'"TeleNova \d+\.\d+\.\d+`n"', '"TeleNova %s`n"' % new, s))
edit('README.md', lambda s: re.sub(r'repository\.telenova-\d+\.\d+\.\d+\.zip', 'repository.telenova-%s.zip' % new,
                                   re.sub(r'(\| `(?:plugin\.video\.nova|plugin\.video\.telescope|plugin\.program\.novawizard|'
                                          r'repository\.telenova)`[^|]*\| )\d+\.\d+\.\d+', r'\g<1>' + new, s)))
for rel in ('index.html', r'web\app.js'):
    edit(rel, lambda s: re.sub(r'repository\.telenova-\d+\.\d+\.\d+\.zip', 'repository.telenova-%s.zip' % new, s))
# the root keeps the first zip people installed (old links) and the current one only
for f in os.listdir(ROOT):
    m = re.match(r'repository\.telenova-(\d+\.\d+\.\d+)\.zip$', f)
    if m and m.group(1) not in (new, '3.1.0'):
        os.remove(os.path.join(ROOT, f))
        print('removed', f)
