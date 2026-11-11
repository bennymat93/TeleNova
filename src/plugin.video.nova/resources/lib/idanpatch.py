# -*- coding: utf-8 -*-
"""Fix for Idan+ (plugin.video.idanplus 4.0.x): Kan's VOD episodes are YouTube links like
https://www.youtube.com/watch?v=ID, and common.GetYouTube took the last path part -> video_id "watch" ->
YouTube "This video is unavailable" on every such episode (found 08/10/2026, provider audit).

Pure Python, idempotent: applied by tools/make_build.py and by the NovaTV service at start-up, because Idan+
updates itself from its repository and loses the change (like the POV hook / subspatch).
"""
import os

MARK = '# BN fix v1'
OLD = '''def GetYouTube(url):
\tif url.endswith('/'):
\t\turl = url[:-1]
\tvideo_id = url[url.rfind('/')+1:]'''
NEW = '''def GetYouTube(url):
\t%s: watch?v=ID / youtu.be/ID / embed/ID / shorts/ID
\t_m = re.search(r'(?:[?&]v=|youtu\\.be/|/embed/|/shorts/|/live/)([\\w-]{11})', url)
\tif _m:
\t\treturn '{0}/play/?video_id={1}'.format(youtubePlugin, _m.group(1))
\tif url.endswith('/'):
\t\turl = url[:-1]
\tvideo_id = url[url.rfind('/')+1:]''' % MARK


def apply(addon_dir):
    """True when the file was changed"""
    p = os.path.join(addon_dir, 'resources', 'lib', 'common.py')
    if not os.path.exists(p):
        return False
    with open(p, encoding='utf-8') as f:
        s = f.read()
    if MARK in s or OLD not in s:
        return False
    s = s.replace(OLD, NEW, 1)
    if '\nimport re' not in s and 'import re,' not in s and ', re' not in s.split('\n\n')[0]:
        s = 'import re\n' + s
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)
    return True
