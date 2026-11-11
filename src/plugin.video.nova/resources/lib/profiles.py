# -*- coding: utf-8 -*-
"""Device profiles, chosen by themselves at the first start of the build.

3.3: the build knows five kinds of device and sets itself up for the one it runs on:

    pc      Windows computer (and desktop Linux)
    tv64    streaming box / TV with a remote, 64-bit Kodi
    tv32    streaming box / TV with a remote, 32-bit Kodi (the weaker boxes: smaller cache, lighter player)
    phone   Android phone            tablet  Android tablet (same family as the phone, larger screen)
    car     Android screen of a car
    ios     iPhone / iPad            mac     MacBook / Mac          (the Apple family)

How the device is recognised (facts() -> classify()):
  * every profile needs at least two INDEPENDENT signs that agree (Kodi's platform flag, Python's own platform
    values, Android's feature list, Android's system properties, the hardware name) and no sign against it;
  * the facts are read three times, a moment apart, and all three readings must give the same answer;
  * only then is the profile applied without a question. Anything less than certain - a sign missing, two signs
    disagreeing, readings that differ - and the viewer is asked, with the best guess marked.
The choice can always be changed in TeleNova > Device type.

Older installs stored 'tv' / 'touch': both still work ('tv' is the 64-bit streamer values, 'touch' the tablet's).
plan() and classify() are pure Python (no Kodi modules) for the tests.
"""
import json

ORDER = ('pc', 'tv64', 'tv32', 'phone', 'tablet', 'car', 'ios', 'mac')
LABELS = {
    'pc': ('מחשב Windows', 'Windows computer', 'Компьютер Windows'),
    'tv64': ('סטרימר / טלוויזיה עם שלט (64 ביט)', 'Streaming box / TV with remote (64-bit)', 'ТВ-приставка с пультом (64 бит)'),
    'tv32': ('סטרימר / טלוויזיה עם שלט (32 ביט)', 'Streaming box / TV with remote (32-bit)', 'ТВ-приставка с пультом (32 бит)'),
    'phone': ('טלפון אנדרואיד', 'Android phone', 'Телефон Android'),
    'tablet': ('טאבלט אנדרואיד', 'Android tablet', 'Планшет Android'),
    'car': ('מערכת מולטימדיה ברכב (אנדרואיד)', 'Android car screen', 'Автомагнитола Android'),
    'ios': ('אייפון / אייפד', 'iPhone / iPad', 'iPhone / iPad'),
    'mac': ('מחשב Mac / MacBook', 'Mac / MacBook', 'Mac / MacBook'),
    # stored by older versions
    'tv': ('טלוויזיה / סטרימר עם שלט', 'TV / streaming box with remote', 'ТВ-приставка с пультом'),
    'touch': ('מכשיר עם מסך מגע', 'Touch-screen device', 'Устройство с сенсорным экраном'),
}
# skinzoom: 0 everywhere - Kodi's zoom enlarges from the centre and crops the edges (clock, logo cut at +4 %);
# touch: skin touch mode (on-screen Back, drag scrolling); mouse: pointer input; saver: screensaver minutes
# (0 = never); dim: dim on pause; refresh: switch the display refresh rate to the video's (smooth motion on TVs,
# off where switching blanks the screen or is impossible); readfactor: how far ahead the player reads (x100) -
# more on mobile links; part / cap: the video cache is 1/part of a third of the memory, at most cap MB
PROFILES = {
    'pc':     {'skinzoom': 0, 'touch': False, 'mouse': True,  'saver': 10, 'dim': True,  'refresh': False, 'readfactor': 400,  'part': 8,  'cap': 256},
    'tv64':   {'skinzoom': 0, 'touch': False, 'mouse': False, 'saver': 10, 'dim': True,  'refresh': True,  'readfactor': 400,  'part': 8,  'cap': 256},
    # a 32-bit Kodi has about 2 GB of address space whatever the box's memory: a small cache and a calmer
    # read-ahead keep it away from the out-of-memory kills these boxes are known for
    'tv32':   {'skinzoom': 0, 'touch': False, 'mouse': False, 'saver': 10, 'dim': True,  'refresh': True,  'readfactor': 300,  'part': 10, 'cap': 64},
    'phone':  {'skinzoom': 0, 'touch': True,  'mouse': True,  'saver': 5,  'dim': True,  'refresh': False, 'readfactor': 1000, 'part': 6,  'cap': 128},
    'tablet': {'skinzoom': 0, 'touch': True,  'mouse': True,  'saver': 10, 'dim': True,  'refresh': False, 'readfactor': 500,  'part': 8,  'cap': 192},
    # a car: never a screensaver or dimming while driving, a deep buffer for tunnels and cell hand-overs
    'car':    {'skinzoom': 0, 'touch': True,  'mouse': True,  'saver': 0,  'dim': False, 'refresh': False, 'readfactor': 1000, 'part': 6,  'cap': 128},
    'ios':    {'skinzoom': 0, 'touch': True,  'mouse': True,  'saver': 5,  'dim': True,  'refresh': False, 'readfactor': 800,  'part': 8,  'cap': 128},
    'mac':    {'skinzoom': 0, 'touch': False, 'mouse': True,  'saver': 10, 'dim': True,  'refresh': False, 'readfactor': 400,  'part': 8,  'cap': 256},
}
PROFILES['tv'] = PROFILES['tv64']
PROFILES['touch'] = PROFILES['tablet']

MEMSIZES = (16, 20, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512)


def cache_mb(total_ram_mb, profile):
    """video cache in MB (Kodi uses about 3x this in RAM), from Kodi's own list of sizes"""
    p = PROFILES.get(profile) or PROFILES['tv64']
    want = max(32, min(p['cap'], (total_ram_mb or 2048) // p['part'] // 3))
    return max(v for v in MEMSIZES if v <= want)


def plan(profile, total_ram_mb, platform):
    """-> {kodi setting id: value} + skin touch flag for this device"""
    p = PROFILES[profile]
    s = {
        'lookandfeel.skinzoom': p['skinzoom'],
        'input.enablemouse': p['mouse'],
        'screensaver.mode': '' if p['saver'] == 0 else 'screensaver.xbmc.builtin.dim',
        'screensaver.usedimonpause': p['dim'],
        'screensaver.disableforaudio': True,
        'filecache.buffermode': 4,                  # buffer every network file system (streams included)
        'filecache.memorysize': cache_mb(total_ram_mb, profile),
        'filecache.readfactor': p['readfactor'],
        'videoplayer.adjustrefreshrate': 2 if p['refresh'] else 0,   # 2 = on start/stop, 0 = off
    }
    if p['saver']:
        s['screensaver.time'] = p['saver']
    if platform == 'windows':
        s['videoplayer.usedxva2'] = True            # hardware decoding
    elif platform == 'android':
        s['videoplayer.usemediacodec'] = True
        s['videoplayer.usemediacodecsurface'] = True
    return s, p['touch']


# ------------------------------------------------------------ recognising the device (pure Python)
CAR_WORDS = ('car', 'auto', 'automotive', 'headunit', 'head unit', 'head_unit', 'fyt', 'uis7862', 'uis8581', 'ums512',
             'sc9853', 'px5', 'px6', 'px30', 'ts10', 'ts18', 'teyes', 'joying', 'atoto', 'dasaita', 'mekede', 'junsun',
             'xtrons', 'pumpkin', 'eonon', 'hizpo', 'isudar', 'kaier', 'topway', 'allwinner-t3', 't8', 'ac8227',
             'ac8257', 'mtk8227', 'carplay', 'dudu', 'ownice', 'navifly', 'zlink', 'incar', 'vehicle')
# words inside which "car"/"auto" appear by chance in a product name or build tag
NOT_CAR = ('carrier', 'card', 'carbon', 'autofocus', 'autoupdate', 'cartoon')


def _car_hits(texts):
    """how many DIFFERENT property values name a car system"""
    import re
    n = 0
    for t in texts:
        low = (t or '').lower()
        for w in NOT_CAR:
            low = low.replace(w, ' ')
        if any(re.search(r'(^|[^a-z0-9])%s([^a-z]|$)' % re.escape(w), low) for w in CAR_WORDS):
            n += 1
    return n


def classify(f):
    """f: the facts of one reading (see facts()). -> (profile, certain, [reasons]).
    certain is True only when two independent signs agree and nothing contradicts them."""
    why = []
    bits = f.get('pointer_bits')
    machine = (f.get('machine') or '').lower()
    arch64 = any(k in machine for k in ('64', 'aarch64', 'arm64'))
    only32 = not arch64 and machine.startswith(('armv5', 'armv6', 'armv7', 'armv8l', 'i386', 'i486', 'i586', 'i686'))
    # the process's pointer size decides; the hardware name may only not contradict it: a 64-bit process cannot
    # run on a 32-bit-only machine (a 32-bit Kodi on a 64-bit system is still a 32-bit Kodi)
    bits_agree = bits == 32 or (bits == 64 and not only32)
    kodi, py = f.get('kodi_platform'), f.get('sys_platform') or ''

    def tv(sure):
        prof = 'tv32' if bits == 32 else 'tv64'
        why.append('%s-bit Kodi (pointer %s, machine %s)' % (bits, bits, machine or '?'))
        return prof, bool(sure and bits_agree), why

    if kodi == 'windows':
        ok = py == 'win32' and f.get('os_name') == 'nt'
        why.append('Kodi: Windows; Python: %s / %s' % (py, f.get('os_name')))
        return 'pc', ok, why
    if kodi == 'tvos':
        why.append('Kodi: tvOS')
        return tv(py == 'darwin' or 'appletv' in machine)
    if kodi == 'ios':
        ok = machine.startswith(('iphone', 'ipad', 'ipod'))
        why.append('Kodi: iOS; hardware: %s' % (machine or '?'))
        return 'ios', ok, why
    if kodi == 'osx':
        ok = py == 'darwin' and not machine.startswith(('iphone', 'ipad', 'ipod', 'appletv'))
        why.append('Kodi: macOS; Python: %s; hardware: %s' % (py, machine or '?'))
        return 'mac', ok, why
    if kodi == 'linux':
        osid = (f.get('os_release_id') or '').lower()
        if osid in ('libreelec', 'coreelec', 'osmc', 'xbian', 'batocera'):
            why.append('Kodi: Linux; system: %s (a media-centre system)' % osid)
            return tv(py.startswith('linux'))
        why.append('Kodi: Linux; system: %s' % (osid or '?'))
        return 'pc', bool(osid) and py.startswith('linux') and bool(f.get('has_display_server')), why
    if kodi != 'android':
        why.append('unknown platform %r' % kodi)
        return 'tv64', False, why

    # ---- Android: the feature list and the system properties are two separate sources
    feats = set(f.get('features') or [])
    props = f.get('props') or {}
    chars = (props.get('ro.build.characteristics') or '').lower()
    have_feats, have_props = bool(feats), bool(props)
    leanback = 'android.software.leanback' in feats or 'android.software.leanback_only' in feats
    touch = 'android.hardware.touchscreen' in feats or 'android.hardware.faketouch.multitouch.distinct' in feats
    real_touch = 'android.hardware.touchscreen' in feats
    telephony = 'android.hardware.telephony' in feats
    automotive = 'android.hardware.type.automotive' in feats
    car_n = _car_hits([props.get(k) for k in ('ro.product.model', 'ro.product.brand', 'ro.product.device',
                                               'ro.product.name', 'ro.product.manufacturer', 'ro.board.platform',
                                               'ro.hardware', 'ro.build.product', 'ro.build.display.id',
                                               'ro.build.flavor')])
    why.append('Android; features: %s; characteristics: %s; car words in %d properties' % (
        ','.join(n for n, v in (('tv', leanback), ('touch', real_touch), ('telephony', telephony),
                                ('automotive', automotive)) if v) or ('none' if have_feats else 'unreadable'),
        chars or ('?' if have_props else 'unreadable'), car_n))

    if automotive:
        return 'car', 'tv' not in chars.split(','), why
    if car_n >= 2 and not leanback:
        # an after-market car screen is built as a tablet: two different properties naming a car system,
        # a touch screen and no telephone module together leave no other reading
        return 'car', have_feats and real_touch and not telephony, why
    if leanback or 'tv' in chars.split(','):
        sure = leanback and ('tv' in chars.split(',') or not real_touch) and car_n == 0
        return tv(sure and have_feats and have_props)
    if car_n == 1:
        why.append('one property names a car system - not enough to be sure')
        return 'car', False, why
    if 'tablet' in chars.split(','):
        return 'tablet', have_feats and real_touch and not leanback, why
    if telephony:
        return 'phone', have_props and real_touch and 'tablet' not in chars, why
    if have_feats and real_touch:
        return 'tablet', False, why
    if have_feats and not touch:
        return tv(False)
    why.append('Android without readable features: asked')
    return ('phone' if f.get('battery') else 'tv32' if bits == 32 else 'tv64'), False, why


# ------------------------------------------------------------ Kodi
def _rpc(method, **params):
    import xbmc
    return json.loads(xbmc.executeJSONRPC(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})))


def label(profile, lang='he'):
    return LABELS.get(profile, ('—', '—', '—'))[{'he': 0, 'en': 1, 'ru': 2}.get(lang, 1)]


def current():
    from .common import flag
    return flag('device_profile')


def platform():
    import xbmc
    # iOS and tvOS before OSX, Android before Linux: Kodi reports the general family as true as well
    for k, cond in (('windows', 'Windows'), ('android', 'Android'), ('tvos', 'TVOS'), ('ios', 'IOS'), ('osx', 'OSX'),
                    ('linux', 'Linux')):
        if xbmc.getCondVisibility('System.Platform.' + cond):
            return k
    return 'other'


def ram_mb():
    import re
    import xbmc
    m = re.search(r'(\d+)', xbmc.getInfoLabel('System.Memory(total)').replace(',', ''))
    return int(m.group(1)) if m else 2048


def _run(cmd, timeout=4):
    """output of a small system command, '' when it is missing, fails or takes too long"""
    import subprocess
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
        try:
            out = p.communicate(timeout=timeout)[0]
        except subprocess.TimeoutExpired:
            p.kill()
            p.communicate()
            return ''
        return out.decode('utf-8', 'replace') if p.returncode == 0 else ''
    except Exception:
        return ''


def facts():
    """one reading of everything that tells the device apart; never raises"""
    import os
    import struct
    import sys
    f = {'kodi_platform': platform(), 'sys_platform': sys.platform, 'os_name': os.name,
         'pointer_bits': struct.calcsize('P') * 8, 'machine': ''}
    try:
        import platform as _pf
        f['machine'] = _pf.machine() or ''
    except Exception:
        pass
    if not f['machine']:
        try:
            f['machine'] = os.uname().machine
        except Exception:
            pass
    try:
        import xbmc
        f['battery'] = bool(xbmc.getCondVisibility('System.HasBattery')) if hasattr(xbmc, 'getCondVisibility') else False
    except Exception:
        f['battery'] = False
    if f['kodi_platform'] == 'android':
        out = _run(['/system/bin/pm', 'list', 'features']) or _run(['/system/bin/cmd', 'package', 'list', 'features'])
        f['features'] = sorted(l.split(':', 1)[1].split('=')[0].strip() for l in out.splitlines() if l.startswith('feature:'))
        props = {}
        for line in _run(['/system/bin/getprop']).splitlines():
            if line.startswith('[') and ']: [' in line:
                k, v = line[1:].split(']: [', 1)
                if k.startswith(('ro.product.', 'ro.build.characteristics', 'ro.build.product', 'ro.build.display.id',
                                 'ro.build.flavor', 'ro.board.platform', 'ro.hardware')):
                    props[k] = v.rstrip(']')
        f['props'] = props
    elif f['kodi_platform'] == 'linux':
        try:
            with open('/etc/os-release') as fh:
                for line in fh:
                    if line.startswith('ID='):
                        f['os_release_id'] = line[3:].strip().strip('"')
        except OSError:
            pass
        f['has_display_server'] = bool(os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY'))
    return f


READINGS = 3


def detect(wait=None):
    """reads the device READINGS times (wait(seconds) between them) -> (profile, certain, reasons).
    certain only when every reading says the same profile and each of them is certain by itself."""
    results = []
    for i in range(READINGS):
        if i and wait:
            if wait(1.0):
                break
        try:
            results.append(classify(facts()))
        except Exception as e:                      # a reading that fails is a reading that is not certain
            results.append(('tv64', False, ['reading failed: %s' % e]))
    profs = set(r[0] for r in results)
    certain = len(results) == READINGS and len(profs) == 1 and all(r[1] for r in results)
    why = list(results[-1][2])
    if len(profs) > 1:
        why.append('the readings disagree: %s' % ', '.join(sorted(profs)))
    return results[-1][0], certain, why


def apply(profile):
    import xbmc
    from .common import log
    if profile not in PROFILES:
        profile = 'tv64'
    settings, touch = plan(profile, ram_mb(), platform())
    bad = []
    for k, v in settings.items():
        r = _rpc('Settings.SetSettingValue', setting=k, value=v)
        if 'error' in r:
            bad.append(k)
    xbmc.executebuiltin('Skin.%s(touchmode)' % ('SetBool' if touch else 'Reset'))
    from .common import flag
    flag('device_profile', profile)
    log('device profile %s applied (%d settings%s)' % (profile, len(settings), ', not accepted: %s' % bad if bad else ''))
    return bad


def suggest():
    """the best guess for the list of the manual choice"""
    try:
        return classify(facts())[0]
    except Exception:
        return 'tv64'


def _lang():
    from .common import ui_lang
    return ui_lang() if ui_lang() in ('he', 'ru') else 'en'


def auto():
    """first start of the build: recognise the device, check the answer READINGS times, apply it without a question
    when it is certain - and ask (best guess first) when it is not"""
    import xbmcgui
    from .common import log, monitor
    if current():
        return current()
    prof, certain, why = detect(wait=monitor().waitForAbort)
    log('device detection: %s, %s - %s' % (prof, 'certain' if certain else 'NOT certain', '; '.join(why)))
    if monitor().abortRequested():
        return ''
    if not certain:
        return wizard(first=prof)
    apply(prof)
    lang = _lang()
    xbmcgui.Dialog().notification('TeleNova', '%s: %s' % ({'he': 'זוהה', 'ru': 'Определено', 'en': 'Detected'}[lang],
                                                          label(prof, lang)), xbmcgui.NOTIFICATION_INFO, 6000)
    return prof


def wizard(force=False, first=None):
    """the manual choice: when the device could not be recognised for certain, or from TeleNova > Device type"""
    import xbmcgui
    from .common import log
    if current() and not force:
        return current()
    lang = _lang()
    title = 'TeleNova – ' + {'he': 'איזה מכשיר זה?', 'ru': 'Какое это устройство?', 'en': 'Which device is this?'}[lang]
    first = first or suggest()
    if first not in ORDER:
        first = 'tv64'
    options = sorted(ORDER, key=lambda k: k != first)
    log('device profile wizard shown')          # tools/android_test.py answers it only after this line
    i = xbmcgui.Dialog().select(title, [label(k, lang) for k in options], preselect=0)
    if i < 0:
        if not current():
            apply(first)            # closed without choosing: the best guess, changeable in TeleNova > Device type
        return current()
    apply(options[i])
    xbmcgui.Dialog().notification('TeleNova', label(options[i], lang), xbmcgui.NOTIFICATION_INFO, 3000)
    return options[i]
