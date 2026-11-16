# -*- coding: utf-8 -*-
"""Fixes for Idan+ (plugin.video.idanplus 4.0.x). Pure Python, idempotent: applied by the build and by the NovaTV
service at start-up, because Idan+ updates itself from its repository and loses the changes (like subspatch).

v1 (08/10/2026, provider audit): Kan's VOD episodes are YouTube links like https://www.youtube.com/watch?v=ID, and
   common.GetYouTube took the last path part -> video_id "watch" -> "This video is unavailable" on every episode.

v2 (16/11/2026, 4.1.1): every request of common.OpenURL was made WITHOUT a time limit. When a broadcaster's server
   did not answer (Keshet 12, then Reshet 13, seen in the log of a Kodi that stopped responding), Idan+ waited for
   ever: the channel never opened, the busy sign stayed, and the Python threads that wait pile up. Every request now
   gives up after 12 s (20 s for the scraper call) - the channel then fails cleanly and TeleNova's own failover /
   "not available right now" message takes over.
"""
import os
import re

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

MARK2 = '# BN fix v2: time limits'
TIMEOUT = 12
# inside common.OpenURL: the four calls that end "verify=verify)" and name no timeout
_CALL = re.compile(r'^(\s*response = (?:requests|session)\.(?:get|post)\((?:(?!timeout)[^\n])*verify=verify)\)[ \t]*(?=\r?$)', re.M)
_SCRAPER = re.compile(r"^(\s*response = scraper\.request\('get', url)\)[ \t]*(?=\r?$)", re.M)


def add_timeouts(text):
    """-> (new text, number of calls that got a time limit)"""
    if MARK2 in text:
        return text, 0
    text, n = _CALL.subn(r'\1, timeout=%d)' % TIMEOUT, text)
    text, m = _SCRAPER.subn(r'\1, timeout=20)', text)
    if n + m:
        nl = '\r\n' if '\r\n' in text else '\n'
        text = text.rstrip('\r\n') + nl + MARK2 + nl
    return text, n + m


def apply(addon_dir):
    """True when the file was changed"""
    p = os.path.join(addon_dir, 'resources', 'lib', 'common.py')
    if not os.path.exists(p):
        return False
    with open(p, encoding='utf-8', newline='') as f:
        s = f.read()
    orig = s
    nl = '\r\n' if '\r\n' in s else '\n'
    old, new = OLD.replace('\n', nl), NEW.replace('\n', nl)
    if MARK not in s and old in s:
        s = s.replace(old, new, 1)
        if nl + 'import re' not in s and 'import re,' not in s and ', re' not in s.split(nl + nl)[0]:
            s = 'import re' + nl + s
    s, _ = add_timeouts(s)
    if s == orig:
        return False
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)
    return True
