# -*- coding: utf-8 -*-
"""Runs src/native/tntest on an Android device / emulator (adb) for every ABI it can execute and compares the output
with the values of the Windows build, which was verified against OpenSSL."""
import ctypes, os, subprocess, sys
ROOT = r'C:\My Projects\novaTV Addon\src'
SDK = os.path.expandvars(r'%LOCALAPPDATA%\Android\Sdk')
ADB = os.path.join(SDK, 'platform-tools', 'adb.exe')
CLANG = os.path.join(SDK, 'ndk', '28.2.13676358', 'toolchains', 'llvm', 'prebuilt', 'windows-x86_64', 'bin', 'clang.exe')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ntest')
os.makedirs(OUT, exist_ok=True)

# ---- reference from the Windows DLL (same inputs as tntest.c)
dll = ctypes.CDLL(os.path.join(ROOT, 'plugin.video.telescope', 'resources', 'bin', 'win-x64', 'tnige.dll'))
dll.tn_ige.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_size_t, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
dll.tn_ige.restype = None
key = bytes((i * 7 + 3) & 255 for i in range(32))
iv = bytes((200 - i * 5) & 255 for i in range(32))
data = bytes((i * 31 + (i >> 8) * 17) & 255 for i in range(65536))


def fnv(b):
    h = 1469598103934665603
    for x in b:
        h = ((h ^ x) * 1099511628211) & 0xFFFFFFFFFFFFFFFF
    return '%016x' % h


def run(buf, flags):
    out = ctypes.create_string_buffer(len(buf))
    dll.tn_ige(buf, out, len(buf), key, iv, flags)
    return out.raw


want = {'enc': fnv(run(data, 1)), 'dec': fnv(run(data, 0))}
assert want['enc'] == fnv(run(data, 3)) and want['dec'] == fnv(run(data, 2))
print('reference (Windows build, verified against OpenSSL): enc %s dec %s' % (want['enc'], want['dec']))


def adb(*a, **k):
    return subprocess.run([ADB] + list(a), capture_output=True, text=True, timeout=k.get('timeout', 120))


abis = (adb('shell', 'getprop', 'ro.product.cpu.abilist').stdout.strip() or '').split(',')
print('device ABIs:', abis, '| android', adb('shell', 'getprop', 'ro.build.version.release').stdout.strip())
TARGET = {'arm64-v8a': 'aarch64-linux-android21', 'armeabi-v7a': 'armv7a-linux-androideabi21',
          'x86_64': 'x86_64-linux-android21', 'x86': 'i686-linux-android21'}
bad = 0
for abi in abis:
    if abi not in TARGET:
        continue
    exe = os.path.join(OUT, 'tntest_' + abi)
    r = subprocess.run([CLANG, '--target=' + TARGET[abi], '-O2', '-fPIE', '-pie', '-o', exe,
                        os.path.join(ROOT, 'native', 'tntest.c'), os.path.join(ROOT, 'native', 'tnige.c')],
                       capture_output=True, text=True)
    if r.returncode:
        print(abi, 'BUILD FAILED', r.stderr[:300]); bad += 1; continue
    dev = '/data/local/tmp/tntest_' + abi
    adb('push', exe, dev)
    adb('shell', 'chmod', '755', dev)
    res = adb('shell', dev)
    lines = dict(l.rsplit(' ', 1) for l in res.stdout.strip().splitlines() if ' ' in l)
    ok = (lines.get('enc flags=0') == want['enc'] and lines.get('enc flags=2') == want['enc'] and
          lines.get('dec flags=0') == want['dec'] and lines.get('dec flags=2') == want['dec'] and
          lines.get('roundtrip flags=0') == 'ok' and lines.get('roundtrip flags=2') == 'ok')
    bad += not ok
    print('%-12s %s | AES instructions used: %s%s' % (abi, 'MATCHES the reference' if ok else 'MISMATCH',
                                                      'yes' if lines.get('info') == '2' else 'no (portable code)',
                                                      '' if ok else ' | output: %r %r' % (res.stdout[:300], res.stderr[:200])))
    # the shared library itself: loadable from an executable folder, refused on shared storage?
    so = os.path.join(ROOT, 'plugin.video.telescope', 'resources', 'bin', 'android-' + abi, 'libtnige.so')
    adb('push', so, '/data/local/tmp/libtnige_%s.so' % abi)
print('\nnative test: %s' % ('ALL MATCH' if not bad else '%d FAILED' % bad))
