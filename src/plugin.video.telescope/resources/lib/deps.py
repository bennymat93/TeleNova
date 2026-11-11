# -*- coding: utf-8 -*-
"""Dependency bootstrapper.

Kodi has no official Telethon module, so (like several Telegram add-ons) we fetch the
pure-python wheels from PyPI once, verify their SHA-256 digest and unpack them into the
add-on profile.  An offline zip can be supplied in the settings instead.
"""
import hashlib
import io
import os
import re
import shutil
import sys
import zipfile

from . import common

# name -> (major-version upper bound or None, import name)
PACKAGES = [
    ('Telethon', 2, 'telethon'),
    ('pyaes', None, 'pyaes'),
    ('pyasn1', None, 'pyasn1'),
    ('rsa', None, 'rsa'),
]
STAMP = os.path.join(common.LIB_DIR, '.deps.json')
PYPI = 'https://pypi.org/pypi/%s/json'


def _py_ok(requires):
    """Very small PEP 440 'requires_python' check (>=, <, !=)."""
    if not requires:
        return True
    cur = sys.version_info[:2]
    for part in requires.split(','):
        part = part.strip()
        m = re.match(r'(>=|<=|<|>|!=|==)\s*(\d+)(?:\.(\d+))?', part)
        if not m:
            continue
        op, a, b = m.group(1), int(m.group(2)), int(m.group(3) or 0)
        ver = (a, b)
        if op == '>=' and not cur >= ver:
            return False
        if op == '>' and not cur > ver:
            return False
        if op == '<' and not cur < ver:
            return False
        if op == '<=' and not cur <= ver:
            return False
        if op == '==' and not cur[:2] == ver:
            return False
    return True


def _vkey(v):
    return tuple(int(x) if x.isdigit() else 0 for x in re.split(r'[.\-]', v)[:4])


def _pick_dist(name, max_major):
    """Newest stable release: its pure-python wheel, or - for projects that publish no wheel at all
    (pyaes) - its source archive."""
    import requests
    data = requests.get(PYPI % name, timeout=20).json()
    versions = []
    for ver, files in data.get('releases', {}).items():
        if re.search(r'[a-zA-Z]', ver):          # skip pre-releases (a/b/rc/dev)
            continue
        if max_major and _vkey(ver)[0] >= max_major:
            continue
        best = None
        for f in files:
            if f.get('yanked') or not _py_ok(f.get('requires_python')):
                continue
            fn = f.get('filename', '')
            if f.get('packagetype') == 'bdist_wheel' and fn.endswith('-none-any.whl'):
                best = f
                break
            if f.get('packagetype') == 'sdist' and fn.endswith(('.tar.gz', '.tgz', '.zip')) and best is None:
                best = f
        if best:
            versions.append((_vkey(ver), ver, best))
    if not versions:
        raise RuntimeError('No compatible package for %s' % name)
    versions.sort(key=lambda x: x[0], reverse=True)
    return versions[0][1], versions[0][2]


_pick_wheel = _pick_dist     # old name


def _safe(member):
    return not (member.startswith('/') or '..' in member.replace('\\', '/').split('/'))


def _install_wheel(blob):
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        for member in zf.namelist():
            if _safe(member):
                zf.extract(member, common.LIB_DIR)


def _install_sdist(blob, filename, module):
    """Copy the importable package (``<root>/<module>/`` or ``<root>/src/<module>/``, or a single
    ``<module>.py``) out of a source archive - enough for pure-python projects."""
    files = {}
    if filename.endswith('.zip'):
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            for n in zf.namelist():
                if not n.endswith('/'):
                    files[n] = zf.read(n)
    else:
        import tarfile
        with tarfile.open(fileobj=io.BytesIO(blob), mode='r:*') as tf:
            for m in tf.getmembers():
                if m.isfile():
                    files[m.name] = tf.extractfile(m).read()
    done = 0
    for name, data in files.items():
        parts = name.replace('\\', '/').split('/')
        if not _safe(name) or len(parts) < 2:
            continue
        rel = parts[1:]
        if rel and rel[0] in ('src', 'lib') and len(rel) > 1:
            rel = rel[1:]
        if not (rel[0] == module or (len(rel) == 1 and rel[0] == module + '.py')):
            continue
        dest = os.path.join(common.LIB_DIR, *rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'wb') as fh:
            fh.write(data)
        done += 1
    if not done:
        raise RuntimeError('package %s not found inside %s' % (module, filename))


def _install(blob, filename, module):
    if filename.endswith('.whl'):
        _install_wheel(blob)
    else:
        _install_sdist(blob, filename, module)


def installed():
    stamp = common.read_json(STAMP, {}) or {}
    for _, _, mod in PACKAGES:
        if mod not in stamp or not (os.path.isdir(os.path.join(common.LIB_DIR, mod))
                                    or os.path.isfile(os.path.join(common.LIB_DIR, mod + '.py'))):
            return False
    return True


def install_from_zip(path):
    with open(path, 'rb') as fh:
        blob = fh.read()
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = zf.namelist()
        dists = [n for n in names if n.endswith(('.whl', '.tar.gz', '.tgz'))]
        if dists:
            for w in dists:
                base = os.path.basename(w).lower()
                mod = next((m for nm, _, m in PACKAGES if base.startswith(nm.lower())), '')
                _install(zf.read(w), os.path.basename(w), mod)
        else:
            for member in names:
                if _safe(member):
                    zf.extract(member, common.LIB_DIR)
    stamp = dict((mod, 'offline') for _, _, mod in PACKAGES)
    common.write_json(STAMP, stamp)


def ensure(progress=None, force=False):
    """Make sure telethon & friends are importable. Returns True on success."""
    common.add_lib_path()
    if not force and installed():
        return True
    offline = common.setting('deps_zip')
    if offline and os.path.isfile(offline):
        install_from_zip(offline)
        return installed()
    import requests
    if force and os.path.isdir(common.LIB_DIR):
        for entry in os.listdir(common.LIB_DIR):
            p = os.path.join(common.LIB_DIR, entry)
            if os.path.isdir(p):
                shutil.rmtree(p, ignore_errors=True)
    stamp = {}
    total = len(PACKAGES)
    for idx, (name, max_major, mod) in enumerate(PACKAGES):
        if progress:
            progress(int(idx * 100 / total), name)
        blob = None
        for attempt in range(3):                 # a TV box on Wi-Fi: one dropped download must not fail the setup
            try:
                ver, info = _pick_dist(name, max_major)
                blob = requests.get(info['url'], timeout=60).content
                digest = (info.get('digests') or {}).get('sha256')
                if digest and hashlib.sha256(blob).hexdigest() != digest:
                    raise RuntimeError('Checksum mismatch for %s' % name)
                break
            except RuntimeError:
                raise
            except Exception:
                if attempt == 2:
                    raise
                blob = None
        _install(blob, info['filename'], mod)
        stamp[mod] = ver
        common.log('Installed %s %s' % (name, ver))
    common.write_json(STAMP, stamp)
    if progress:
        progress(100, 'done')
    return installed()


def versions():
    return common.read_json(STAMP, {}) or {}
