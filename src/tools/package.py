# -*- coding: utf-8 -*-
"""TeleNova packaging (run from anywhere):  python src/tools/package.py <staged-build-dir>

1. zips src/plugin.video.nova and src/plugin.video.telescope into repo/<id>/<id>-<version>.zip (old zips removed)
2. rewrites their blocks in repo/addons.xml (+ addons.xml.md5), LF line ends
3. zips the staged Kodi home folder into build/TeleNova-<version>.zip.partN (parts under 95 MB) and writes build.json
"""
import hashlib
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'src')
SITE = 'https://bennymat93.github.io/TeleNova/'
ADDONS = ['plugin.video.nova', 'plugin.video.telescope', 'plugin.program.novawizard', 'repository.telenova']
PART = 95 * 1024 * 1024
SKIP_DIRS = {'__pycache__'}
SKIP_EXT = ('.pyc', '.pyo', '.bak')
FIXED = (2026, 1, 1, 0, 0, 0)          # fixed timestamps: the same input gives the same zip


def files_of(base):
    for dp, dn, fn in os.walk(base):
        dn[:] = sorted(d for d in dn if d not in SKIP_DIRS)
        for f in sorted(fn):
            if not f.lower().endswith(SKIP_EXT):
                yield os.path.join(dp, f)


def zip_dir(base, dest, prefix=''):
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in files_of(base):
            arc = prefix + os.path.relpath(p, base).replace(os.sep, '/')
            info = zipfile.ZipInfo(arc, FIXED)
            info.compress_type = zipfile.ZIP_STORED if p.lower().endswith(('.jpg', '.png', '.nvp', '.zip')) \
                else zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(p, 'rb') as f:
                z.writestr(info, f.read())


def addon_xml(aid):
    with open(os.path.join(SRC, aid, 'addon.xml'), encoding='utf-8') as f:
        text = f.read().replace('\r\n', '\n')
    text = re.sub(r'^\s*<\?xml[^>]*\?>\s*', '', text).strip()
    return text, re.search(r'<addon[^>]*\bversion="([^"]+)"', text).group(1)


def main():
    stage = sys.argv[1]
    index = os.path.join(ROOT, 'repo', 'addons.xml')
    with open(index, encoding='utf-8') as f:
        xml = f.read().replace('\r\n', '\n')
    version = ''
    for aid in ADDONS:
        text, ver = addon_xml(aid)
        version = version or ver
        folder = os.path.join(ROOT, 'repo', aid)
        for old in os.listdir(folder):
            if old.endswith('.zip'):
                os.remove(os.path.join(folder, old))
        dest = os.path.join(folder, '%s-%s.zip' % (aid, ver))
        zip_dir(os.path.join(SRC, aid), dest, aid + '/')
        rx = re.compile(r'<addon id="%s".*?</addon>' % re.escape(aid), re.S)
        if not rx.search(xml):
            raise SystemExit('%s not in addons.xml' % aid)
        xml = rx.sub(lambda m: text, xml, 1)
        print('%s %s: %.1f MB' % (aid, ver, os.path.getsize(dest) / 1e6))
        if aid == 'repository.telenova':        # the zip people install first sits at the site's root as well
            import shutil
            shutil.copyfile(dest, os.path.join(ROOT, os.path.basename(dest)))
    with open(index, 'w', encoding='utf-8', newline='\n') as f:
        f.write(xml)
    with open(index + '.md5', 'w', newline='\n') as f:
        f.write(hashlib.md5(xml.encode('utf-8')).hexdigest())

    whole = os.path.join(ROOT, 'build', 'TeleNova-%s.zip' % version)
    for old in os.listdir(os.path.dirname(whole)):
        os.remove(os.path.join(os.path.dirname(whole), old))
    zip_dir(stage, whole)
    size, sha, parts = os.path.getsize(whole), hashlib.sha256(), []
    with open(whole, 'rb') as f:
        n = 0
        while True:
            chunk = f.read(PART)
            if not chunk:
                break
            sha.update(chunk)
            name = '%s.part%d' % (os.path.basename(whole), n)
            with open(os.path.join(os.path.dirname(whole), name), 'wb') as out:
                out.write(chunk)
            parts.append(SITE + 'build/' + name)
            n += 1
    os.remove(whole)
    info = {'name': 'TeleNova', 'version': version, 'kodi': '21', 'parts': parts, 'url': parts[0], 'size': size,
            'sha256': sha.hexdigest()}
    with open(os.path.join(ROOT, 'build.json'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(info, indent=1) + '\n')
    print('build %s: %.1f MB in %d part(s), sha256 %s' % (version, size / 1e6, len(parts), sha.hexdigest()))


if __name__ == '__main__':
    main()
