# -*- coding: utf-8 -*-
"""web/channels_il.json from the build's own Israeli channel table (plugin.video.nova/resources/lib/livefail.py).

  python src/qa/web/gen_channels.py          writes web/channels_il.json

A browser plays direct https HLS streams only. A channel whose sources are Idan+ (a Kodi add-on) or a YouTube live
broadcast ("yt:<channel id>", resolved by the build's YouTube code) is listed all the same, marked "kodi_only": the web
app shows it greyed with the hint "plays in Kodi". run_web_tests.py checks that the file is up to date."""
import importlib.util, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(ROOT, 'web', 'channels_il.json')
HEBREW = re.compile(r'[֐-׿]')


def build():
    spec = importlib.util.spec_from_file_location('livefail', os.path.join(ROOT, 'src', 'plugin.video.nova', 'resources', 'lib', 'livefail.py'))
    lf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(lf)
    out = []
    for key, (names, direct, idan) in lf.CHANNELS.items():
        urls = [u for u in direct if u.startswith('https://')]
        row = {'key': key, 'name': next((n for n in names if not HEBREW.search(n)), names[0]),
               'name_he': next((n for n in names if HEBREW.search(n)), ''), 'names': list(names)}
        if urls:
            row['urls'] = urls
        else:
            row['kodi_only'] = True
            row['why'] = 'youtube' if any(u.startswith('yt:') for u in direct) else 'idanplus'
        out.append(row)
    return out


if __name__ == '__main__':
    rows = build()
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
        f.write('\n')
    sys.stdout.buffer.write(('%d channels, %d play in a browser -> %s\n' % (len(rows), sum(1 for r in rows if 'urls' in r), OUT)).encode('utf-8'))
