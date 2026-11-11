import json, os, re, sys
os.chdir(sys.argv[1])
m = json.load(open('web/manifest.webmanifest', encoding='utf-8'))
icons = [i['src'] for i in m.get('icons', [])]
print('manifest:', m.get('name'), '| icons missing:', [i for i in icons if not os.path.exists(os.path.join('web', i))])
for page, base in (('web/index.html', 'web'), ('index.html', '.'), ('guide.html', '.'), ('sources_guide.html', '.'),
                   ('ios/index.html', 'ios'), ('privacy.html', '.')):
    t = open(page, encoding='utf-8').read()
    refs = set(re.findall(r'(?:src|href)="([^"#:?]+)"', t))
    miss = [r for r in refs if not r.startswith(('http', '//', 'mailto', 'data')) and not os.path.exists(os.path.join(base, r))]
    print('%-22s local refs %2d  missing: %s' % (page, len(refs), miss))
sw = open('web/sw.js', encoding='utf-8').read()
cached = re.findall(r'''['"]((?:\./)?[\w./-]+\.(?:js|css|html|png|webmanifest))['"]''', sw)
print('service worker caches:', cached, '| missing:', [c for c in cached if not os.path.exists(os.path.join('web', c))])
app = open('web/app.js', encoding='utf-8').read()
print('app.js absolute site links:', sorted(set(re.findall(r'\$\{SITE\}([\w./-]+)', app))))
print('files those links need:', [(f, os.path.exists(f)) for f in sorted(set(re.findall(r'\$\{SITE\}([\w./-]+)', app)))])
