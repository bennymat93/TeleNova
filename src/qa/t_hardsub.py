# -*- coding: utf-8 -*-
"""hardsub.py without Kodi: name hints, the verdict over the model's frame answers, PNG output, the box on / off."""
import json, os, struct, sys, tempfile, zlib
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.nova', 'resources', 'lib'))
import hardsub

fails = []


def check(name, cond, extra=''):
    print('%-66s %s %s' % (name, 'ok' if cond else 'FAIL', extra if not cond else ''))
    if not cond:
        fails.append(name)


check('name: HebSub release', hardsub.name_hint('Desert.Wounds.2016.WEBRip.x264.HebSub-SMG.mkv') == 'hebrew')
check('name: ת.מ (תרגום מובנה)', hardsub.name_hint(u'לולו_סרטים_בייביסיטרס_1994_ת.מ_DVDRip.mkv') == 'hebrew')
check('name: KORSUB', hardsub.name_hint('Movie.2020.KORSUB.1080p.mkv') == 'foreign')
check('name: HC', hardsub.name_hint('Show.S01E02.HC.HDRip.mkv') == 'foreign')
check('name: plain release', hardsub.name_hint('Movie.2020.1080p.WEB-DL.H264.mkv') == '')
check('name: "hc" inside a word is not a tag', hardsub.name_hint('The.Launch.Code.2020.mkv') == '')
H, L, N = {'subtitle': True, 'script': 'hebrew'}, {'subtitle': True, 'script': 'latin'}, {'subtitle': False, 'script': 'none'}
check('frames: Hebrew in two of three', hardsub.verdict([H, H, N]) == ('hebrew', True))
check('frames: Latin in two of three', hardsub.verdict([L, N, L]) == ('foreign', True))
check('frames: nothing in three', hardsub.verdict([N, N, N]) == ('none', True))
check('frames: one frame with text only -> no verdict', hardsub.verdict([H, N, N])[0] == '')
check('frames: Hebrew and Latin mixed -> no verdict', hardsub.verdict([H, L, N])[0] == '')
check('frames: a single frame is never enough', hardsub.verdict([H])[0] == '')
check('answer in a code fence is parsed', hardsub.parse('```json\n{"frames":[{"subtitle":true,"script":"latin"}]}\n```') == [{'subtitle': True, 'script': 'latin'}])
check('garbage answer -> None', hardsub.parse('sorry, I cannot') is None)
w, h = 960, 540
img = bytearray(os.urandom(w * h * 4))
p = hardsub.png(bytes(img), w, h)
iw, ih = struct.unpack('>II', p[16:24])
raw = zlib.decompress(p[p.index(b'IDAT') + 4:p.index(b'IEND') - 8])
check('PNG: header, lower part, scaled', p[:8] == b'\x89PNG\r\n\x1a\n' and iw == 960 and 190 < ih < 215 and len(raw) == ih * (1 + iw * 3), (iw, ih, len(raw)))
check('PNG: colours in RGB order', raw[1:4] == bytes((img[int(h * 0.62) * w * 4 + 2], img[int(h * 0.62) * w * 4 + 1], img[int(h * 0.62) * w * 4])))
check('black frame is dull, noise is not', hardsub.dull(bytearray(w * h * 4), w, h) and not hardsub.dull(img, w, h))
# the box: the viewer's values are saved, set, and put back - also when the file was left by a crash
state = {'subtitles.backgroundtype': 1, 'subtitles.bgcolorpick': 'FF202020', 'subtitles.bgopacity': 35}


def rpc(method, params):
    if method == 'Settings.GetSettingValue':
        return {'value': state[params['setting']]}
    state[params['setting']] = params['value']
    return True


store = os.path.join(tempfile.mkdtemp(), 'subbox.json')
check('box on: saved and set', hardsub.box_on(rpc, store) and state == hardsub.BOX and json.load(open(store))['subtitles.bgopacity'] == 35)
check('box on twice changes nothing', not hardsub.box_on(rpc, store) and json.load(open(store))['subtitles.bgopacity'] == 35)
check('box off: the viewer\'s values are back, file gone', hardsub.box_off(rpc, store) and state == {'subtitles.backgroundtype': 1, 'subtitles.bgcolorpick': 'FF202020', 'subtitles.bgopacity': 35} and not os.path.exists(store))
check('box off without a file does nothing', not hardsub.box_off(rpc, store))
check('unknown setting: nothing is touched', not hardsub.box_on(lambda m, p: None, store) and not os.path.exists(store))
print('\nHARDSUB TESTS %s' % ('OK' if not fails else 'FAILED: %d' % len(fails)))
sys.exit(1 if fails else 0)
