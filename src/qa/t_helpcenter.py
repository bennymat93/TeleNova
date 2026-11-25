# -*- coding: utf-8 -*-
"""Help center: every string and table row is trilingual (he/en/ru); English fallback; toggle cycles 3 languages."""
import os
import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.nova', 'resources', 'lib'))
import helpcenter as H

bad = []
for k, v in H.STR.items():
    if len(v) != 3 or not all(v):
        bad.append('STR %s' % k)
for i, r in enumerate(H.load('trouble')['rows']):
    for l in H.LANGS:
        if len(r.get(l) or ()) != 3:
            bad.append('trouble row %d %s' % (i, l))
for sec in H.load('guide')['sections']:
    for l in ('he', 'en'):
        if not (sec.get(l) or {}).get('title'):
            bad.append('guide %s %s' % (sec['id'], l))
    if H.loc(sec, 'ru') is not (sec.get('ru') or sec['en']):
        bad.append('guide fallback %s' % sec['id'])
if [H.next_lang(x) for x in ('he', 'en', 'ru', '')] != ['en', 'ru', 'he', 'he']:
    bad.append('toggle cycle')
txt = H.trouble_text(H.load('trouble')['rows'][:1], 'ru')
if 'Возможные причины' not in txt or 'Видео' not in txt:
    bad.append('ru trouble text')
if not H.search('звука', 'ru') or H.search('звука', 'ru')[0][2] != 'Нет звука':
    bad.append('ru search')
if H.search('buffering', 'ru')[0][2] != 'Видео постоянно буферизуется':
    bad.append('ru title for an English query')
print('\n'.join(bad) or 'OK helpcenter: %d strings, 3 languages' % len(H.STR))
sys.exit(1 if bad else 0)
