# -*- coding: utf-8 -*-
"""Device recognition against simulated devices (pure classify(), plus detect() with unstable readings)."""
import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, sys.argv[1])
import profiles as P

A = 'android.'
TV = [A + 'software.leanback', A + 'hardware.wifi', A + 'hardware.faketouch']
PHONE = [A + 'hardware.touchscreen', A + 'hardware.telephony', A + 'hardware.wifi', A + 'hardware.camera']
TAB = [A + 'hardware.touchscreen', A + 'hardware.wifi', A + 'hardware.camera']


def droid(feats, props, bits=64, machine='aarch64'):
    return {'kodi_platform': 'android', 'sys_platform': 'linux', 'os_name': 'posix', 'pointer_bits': bits,
            'machine': machine, 'features': feats, 'props': props}


CASES = [
    ('Windows PC', {'kodi_platform': 'windows', 'sys_platform': 'win32', 'os_name': 'nt', 'pointer_bits': 64, 'machine': 'AMD64'}, 'pc', True),
    ('Windows with odd Python values', {'kodi_platform': 'windows', 'sys_platform': 'linux', 'os_name': 'posix', 'pointer_bits': 64, 'machine': 'AMD64'}, 'pc', False),
    ('Xiaomi Mi Box S (32-bit Kodi)', droid(TV, {'ro.build.characteristics': 'tv', 'ro.product.model': 'MIBOX4', 'ro.product.brand': 'Xiaomi'}, 32, 'armv8l'), 'tv32', True),
    ('32-bit Kodi on a 64-bit box', droid(TV, {'ro.build.characteristics': 'tv', 'ro.product.model': 'KM2 Plus'}, 32, 'aarch64'), 'tv32', True),
    ('Nvidia Shield (64-bit)', droid(TV, {'ro.build.characteristics': 'tv,nosdcard', 'ro.product.model': 'SHIELD Android TV', 'ro.product.brand': 'NVIDIA'}), 'tv64', True),
    ('Fire TV Stick 4K', droid(TV + [A + 'hardware.type.television'], {'ro.build.characteristics': 'tv,nosdcard', 'ro.product.model': 'AFTMM', 'ro.product.brand': 'Amazon'}, 32, 'armv7l'), 'tv32', True),
    ('generic box: tablet build, launcher says TV', droid(TV, {'ro.build.characteristics': 'tablet', 'ro.product.model': 'X96 Max'}), 'tv64', True),
    ('TV feature but a real touch screen and no tv tag', droid(TV + [A + 'hardware.touchscreen'], {'ro.build.characteristics': 'tablet', 'ro.product.model': 'X'}), 'tv64', False),
    ('Pixel 8 phone', droid(PHONE, {'ro.build.characteristics': 'nosdcard', 'ro.product.model': 'Pixel 8', 'ro.product.brand': 'google'}), 'phone', True),
    ('Samsung phone, model with "card" in a tag', droid(PHONE, {'ro.build.characteristics': 'phone', 'ro.product.model': 'SM-S911B', 'ro.build.flavor': 'carrier-user'}), 'phone', True),
    ('Galaxy Tab (Wi-Fi)', droid(TAB, {'ro.build.characteristics': 'tablet', 'ro.product.model': 'SM-X200', 'ro.product.brand': 'samsung'}), 'tablet', True),
    ('Galaxy Tab LTE (has telephony)', droid(PHONE, {'ro.build.characteristics': 'tablet', 'ro.product.model': 'SM-X205'}), 'tablet', True),
    ('Teyes CC3 head unit (FYT)', droid(TAB, {'ro.build.characteristics': 'tablet', 'ro.product.model': 'UIS7862', 'ro.product.brand': 'FYT', 'ro.board.platform': 'ums512'}), 'car', True),
    ('PX6 head unit', droid(TAB, {'ro.build.characteristics': 'tablet', 'ro.product.model': 'PX6', 'ro.product.device': 'px6', 'ro.product.brand': 'rockchip'}), 'car', True),
    ('head unit, one car word only', droid(TAB, {'ro.build.characteristics': 'tablet', 'ro.product.model': 'Android', 'ro.product.device': 'ts10'}), 'car', False),
    ('Android Automotive (Polestar)', droid(TAB + [A + 'hardware.type.automotive'], {'ro.build.characteristics': 'automotive', 'ro.product.model': 'Polestar 2'}), 'car', True),
    ('Android, feature list unreadable', droid([], {'ro.build.characteristics': 'tv'}), 'tv64', False),
    ('Android, nothing readable', droid([], {}), 'tv64', False),
    ('phone with unreadable properties', droid(PHONE, {}), 'phone', False),
    ('iPhone', {'kodi_platform': 'ios', 'sys_platform': 'ios', 'os_name': 'posix', 'pointer_bits': 64, 'machine': 'iPhone14,2'}, 'ios', True),
    ('iPad', {'kodi_platform': 'ios', 'sys_platform': 'darwin', 'os_name': 'posix', 'pointer_bits': 64, 'machine': 'iPad13,4'}, 'ios', True),
    ('iOS, unknown hardware name', {'kodi_platform': 'ios', 'sys_platform': 'ios', 'os_name': 'posix', 'pointer_bits': 64, 'machine': ''}, 'ios', False),
    ('MacBook (Apple silicon)', {'kodi_platform': 'osx', 'sys_platform': 'darwin', 'os_name': 'posix', 'pointer_bits': 64, 'machine': 'arm64'}, 'mac', True),
    ('MacBook (Intel)', {'kodi_platform': 'osx', 'sys_platform': 'darwin', 'os_name': 'posix', 'pointer_bits': 64, 'machine': 'x86_64'}, 'mac', True),
    ('Apple TV', {'kodi_platform': 'tvos', 'sys_platform': 'darwin', 'os_name': 'posix', 'pointer_bits': 64, 'machine': 'AppleTV11,1'}, 'tv64', True),
    ('LibreELEC on a Raspberry Pi (32-bit)', {'kodi_platform': 'linux', 'sys_platform': 'linux', 'os_name': 'posix', 'pointer_bits': 32, 'machine': 'armv7l', 'os_release_id': 'libreelec'}, 'tv32', True),
    ('CoreELEC (64-bit)', {'kodi_platform': 'linux', 'sys_platform': 'linux', 'os_name': 'posix', 'pointer_bits': 64, 'machine': 'aarch64', 'os_release_id': 'coreelec'}, 'tv64', True),
    ('Ubuntu desktop', {'kodi_platform': 'linux', 'sys_platform': 'linux', 'os_name': 'posix', 'pointer_bits': 64, 'machine': 'x86_64', 'os_release_id': 'ubuntu', 'has_display_server': True}, 'pc', True),
    ('Linux, unknown system', {'kodi_platform': 'linux', 'sys_platform': 'linux', 'os_name': 'posix', 'pointer_bits': 64, 'machine': 'x86_64'}, 'pc', False),
    ('unknown platform', {'kodi_platform': 'other', 'sys_platform': 'x', 'os_name': 'posix', 'pointer_bits': 64, 'machine': ''}, 'tv64', False),
]
bad = 0
for name, f, want, sure in CASES:
    prof, certain, why = P.classify(f)
    ok = prof == want and certain == sure
    bad += not ok
    print('%-4s %-46s -> %-6s %s' % ('ok' if ok else 'FAIL', name, prof, 'certain' if certain else 'ask the viewer'))
    if not ok:
        print('       expected %s / %s; reasons: %s' % (want, sure, why))

# detect(): three readings must agree
seq = []
P.facts = lambda: seq.pop(0)
win = CASES[0][1]
seq[:] = [win, win, win]
r1 = P.detect()
seq[:] = [CASES[8][1], CASES[10][1], CASES[8][1]]          # phone, tablet, phone
r2 = P.detect()
seq[:] = [win, None, win]                                   # a reading that fails (classify(None) raises)
r3 = P.detect()
checks = [('three equal certain readings -> applied automatically', r1[0] == 'pc' and r1[1]),
          ('readings that disagree -> ask', not r2[1]),
          ('a failed reading -> ask', not r3[1])]
# every profile yields a valid Kodi plan and a cache size from Kodi's list
for k in P.ORDER + ('tv', 'touch'):
    for ram in (1024, 2048, 4096, 16384):
        s, touch = P.plan(k, ram, 'android')
        checks.append(('plan %s/%d' % (k, ram), s['filecache.memorysize'] in P.MEMSIZES and isinstance(touch, bool)))
checks.append(('32-bit streamer cache never above 64 MB', all(P.cache_mb(r, 'tv32') <= 64 for r in (1024, 2048, 4096, 8192))))
checks.append(('labels in he/en/ru for every profile', all(len(P.LABELS[k]) == 3 and all(P.LABELS[k]) for k in P.PROFILES)))
for name, ok in checks:
    if not ok:
        bad += 1
        print('FAIL', name)
print('caches (MB) 1/2/4 GB:', {k: [P.cache_mb(r, k) for r in (1024, 2048, 4096)] for k in P.ORDER})
print('\n%d device cases + %d checks, %d failed' % (len(CASES), len(checks), bad))
