# -*- coding: utf-8 -*-
"""The licensed-failover table (livefail.CHANNELS): no name twice, no paid channel, every Idan+ id exists in the
Idan+ catalogue (when Idan+ is installed in this Kodi). No Kodi needed."""
import io, os, sys, types

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
for n in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules.setdefault(n, types.ModuleType(n))
HERE = os.path.dirname(os.path.abspath(__file__))
src = io.open(os.path.join(HERE, '..', 'plugin.video.nova', 'resources', 'lib', 'livefail.py'), encoding='utf-8').read()
ns = {}
exec(compile(src.replace('from .epg import norm', 'norm = lambda s: s.strip().lower()'), 'livefail', 'exec'), ns)
CH = ns['CHANNELS']
bad = []
import importlib.util
_spec = importlib.util.spec_from_file_location('ytlive', os.path.join(HERE, '..', 'plugin.video.nova', 'resources', 'lib', 'ytlive.py'))
YT = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(YT)
# ---- the YouTube live lookup (no network)
CID = 'UC' + 'a' * 22
LIVE = ('<link rel="canonical" href="https://www.youtube.com/watch?v=dRpVPPrxZH0"> ... "isLiveNow":true ... '
        '"channelId":"%s"' % CID)


class _R(object):
    def __init__(self, text, status=200):
        self.text, self.status_code = text, status


class _H(object):
    def __init__(self, resp):
        self.resp, self.urls = resp, []

    def get(self, url, **kw):
        self.urls.append(url)
        if isinstance(self.resp, Exception):
            raise self.resp
        return self.resp


def _chk(cond, what):
    if not cond:
        bad.append('ytlive: ' + what)


_chk(YT.page_url(CID) == 'https://www.youtube.com/channel/%s/live' % CID and YT.page_url('@kan11') == 'https://www.youtube.com/@kan11/live', 'page address')
_chk(YT.page_url('https://evil.example/x') is None and YT.page_url('UCshort') is None and YT.page_url('@a/../b') is None, 'only a channel id or a handle')
_chk(YT.parse(LIVE, CID) == 'dRpVPPrxZH0', 'live video found')
_chk(YT.parse(LIVE, 'UC' + 'b' * 22) is None, "another channel's video is not taken")
_chk(YT.parse('<link rel="canonical" href="https://www.youtube.com/channel/%s">' % CID, CID) is None, 'channel not live')
_chk(YT.parse(LIVE.replace('"isLiveNow":true', '"isUpcoming":true'), CID) is None, 'an upcoming broadcast is not live')
_chk(YT.parse('', CID) is None and YT.parse(None) is None, 'empty page')
h = _H(_R(LIVE))
_chk(YT.find(CID, h) == 'dRpVPPrxZH0' and h.urls == ['https://www.youtube.com/channel/%s/live' % CID], 'find asks the live page')
_chk(YT.find(CID, _H(_R(LIVE, 404))) is None and YT.find(CID, _H(IOError('x'))) is None and YT.find('bad', _H(_R(LIVE))) is None, 'failures give None')
_chk(YT.play_url('dRpVPPrxZH0') == 'plugin://plugin.video.youtube/play/?video_id=dRpVPPrxZH0' and YT.play_url('x&y=1') is None and YT.play_url('') is None, 'play address only for a real video id')
names = [x.strip().lower() for names, _, _ in CH.values() for x in names]
for x in sorted(set(names)):
    if names.count(x) > 1:
        bad.append('name twice: ' + x)
for key, (nm, direct, idan) in CH.items():
    if not direct and not idan:
        bad.append('no source: ' + key)
    for x in nm:
        if ns['is_paid_il'](x):
            bad.append('paid pattern matches %s (%s)' % (x, key))
        if ns['key_for'](x) != key:
            bad.append('key_for(%s) = %s, not %s' % (x, ns['key_for'](x), key))
    for u in direct:
        if ns['is_restream'](u):
            bad.append('restream as a direct source: ' + key)
        if u.startswith('yt:') and not YT.page_url(u[3:]):
            bad.append('not a YouTube channel id / handle: %s (%s)' % (u, key))
        elif not u.startswith(('yt:', 'https://', 'http://')):
            bad.append('odd source %s (%s)' % (u[:30], key))
cat = os.path.join(os.environ.get('APPDATA', ''), 'Kodi', 'addons', 'plugin.video.idanplus', 'resources', 'channels.json')
if os.path.exists(cat):
    txt = io.open(cat, encoding='utf-8').read()
    for key, (_, _, idan) in CH.items():
        for u, module, mode in idan:
            if '"%s"' % u not in txt:
                bad.append('not in the Idan+ catalogue: %s (%s)' % (u, key))
else:
    print('Idan+ not installed here - catalogue check skipped')
print('%d channels, %d with a direct stream, %d Idan+ entries' % (
    len(CH), sum(1 for v in CH.values() if v[1]), sum(len(v[2]) for v in CH.values())))
for b in bad:
    print('FAIL', b)
print('LIVE TABLE OK' if not bad else 'LIVE TABLE: %d problems' % len(bad))
sys.exit(1 if bad else 0)
