import os, sys
p = sys.argv[1]
sys.argv = ['x', '0', '0']
exec(open(os.path.join(os.path.dirname(__file__), 'crawl.py'), encoding='utf-8').read().split('# listing actions')[0])
r = rpc('Files.GetDirectory', {'directory': p, 'media': 'files', 'properties': ['title', 'plot', 'art']}, 90)
for f in ((r.get('result') or {}).get('files') or [])[:8]:
    print(repr(f.get('label')), '|', (f.get('plot') or '')[:60].replace('\n', ' '), '|', f.get('filetype'))
print(r.get('error') or '')
