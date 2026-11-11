# -*- coding: utf-8 -*-
"""Remove from the shipped encrypted backups everything that is no longer part of the build.

    python src/tools/nvp_clean.py            (asks for the backup password; it is never stored or printed)

For src/plugin.video.nova/resources/preset.nvp and build.nvp:
  * decrypts with the password (same format as resources/lib/preset.py)
  * drops addon_data/<id>/ of add-ons that are not in the current build package (build/TeleNova-*.zip.part*)
    and are not one of Kodi's own add-ons
  * drops the favourites that open removed add-ons
  * encrypts again with the same password; the original is kept next to it as <name>.bak
Run src/tools/package.py afterwards to rebuild the add-on zip and the build.
"""
import getpass
import glob
import hashlib
import hmac
import io
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RES = os.path.join(ROOT, 'src', 'plugin.video.nova', 'resources')
MAGIC, ITER = b'NVP1', 200000
# add-ons that come with Kodi itself or are installed by it on demand: their settings stay
KEEP_ALWAYS = ('pvr.iptvsimple', 'inputstream.adaptive', 'inputstream.ffmpegdirect', 'inputstream.rtmp',
               'script.module.pycryptodome', 'script.module.pil')
FAV = re.compile(r'[ \t]*<favourite\b[^>]*>[^<]*(?:plugin\.video\.pov|kodipovilai|kodipovilwizard|plugin\.video\.otaku|'
                 r'orderfavourites)[^<]*</favourite>\r?\n?')


def _keys(pw, salt):
    k = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), salt, ITER, 64)
    return k[:32], k[32:]


def _stream(key, nonce, data):
    base = hmac.new(key, nonce, hashlib.sha256)
    ks = bytearray()
    for i in range((len(data) + 31) // 32):
        h = base.copy()
        h.update(i.to_bytes(8, 'big'))
        ks += h.digest()
    n = len(data)
    return (int.from_bytes(data, 'big') ^ int.from_bytes(bytes(ks[:n]), 'big')).to_bytes(n, 'big')


def decrypt(pw, blob):
    salt, nonce, tag, ct = blob[4:20], blob[20:36], blob[36:68], blob[68:]
    ek, mk = _keys(pw, salt)
    if not hmac.compare_digest(tag, hmac.new(mk, blob[:36] + ct, hashlib.sha256).digest()):
        return None
    return _stream(ek, nonce, ct)


def encrypt(pw, plain):
    salt, nonce = os.urandom(16), os.urandom(16)
    ek, mk = _keys(pw, salt)
    ct = _stream(ek, nonce, plain)
    return MAGIC + salt + nonce + hmac.new(mk, MAGIC + salt + nonce + ct, hashlib.sha256).digest() + ct


def build_addons():
    parts = sorted(glob.glob(os.path.join(ROOT, 'build', 'TeleNova-*.zip.part*')))
    if not parts:
        raise SystemExit('no build package in build/ - run src/tools/package.py first')
    blob = b''.join(open(p, 'rb').read() for p in parts)
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        return {n.split('/')[1] for n in z.namelist() if n.startswith('addons/') and n.count('/') >= 2}


def clean(plain, addons):
    out, kept, dropped = io.BytesIO(), 0, {}
    with zipfile.ZipFile(io.BytesIO(plain)) as src, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            parts = info.filename.split('/')
            if len(parts) >= 3 and parts[0] == 'addon_data' and parts[1] not in addons and parts[1] not in KEEP_ALWAYS:
                dropped[parts[1]] = dropped.get(parts[1], 0) + info.file_size
                continue
            data = src.read(info.filename)
            if info.filename == 'favourites.xml':
                text = data.decode('utf-8', 'replace')
                new, n = FAV.subn('', text)
                if n:
                    dropped['favourites (%d)' % n] = len(text) - len(new)
                    data = new.encode('utf-8')
            dst.writestr(info, data)
            kept += 1
    return out.getvalue(), kept, dropped


def main():
    addons = build_addons()
    pw = getpass.getpass('Backup password: ')
    for name in ('preset.nvp', 'build.nvp'):
        path = os.path.join(RES, name)
        if not os.path.exists(path):
            continue
        blob = open(path, 'rb').read()
        if blob[:4] != MAGIC:
            print('%s: not an encrypted profile - skipped' % name)
            continue
        plain = decrypt(pw, blob)
        if plain is None:
            print('%s: wrong password - not changed' % name)
            continue
        new, kept, dropped = clean(plain, addons)
        if not dropped:
            print('%s: nothing to remove (%d files)' % (name, kept))
            continue
        if not os.path.exists(path + '.bak'):
            os.replace(path, path + '.bak')
        with open(path, 'wb') as f:
            f.write(encrypt(pw, new))
        print('%s: %.1f MB -> %.1f MB, %d files kept; removed:' % (name, len(blob) / 1e6, os.path.getsize(path) / 1e6, kept))
        for k, v in sorted(dropped.items(), key=lambda x: -x[1]):
            print('    %-45s %8.1f KB' % (k, v / 1024.0))


if __name__ == '__main__':
    sys.exit(main())
