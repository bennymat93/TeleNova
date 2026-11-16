# -*- coding: utf-8 -*-
"""Rebuilds web/vendor/gramjs-2.26.21.min.js - the Telegram client the web version loads when the viewer connects.

Why a file of our own: GramJS (npm "telegram", MIT) ships no browser bundle, and the bundles the CDNs generate on the
fly are both broken at run time (checked 16/11/2026 in headless Chrome: jsDelivr's /+esm fails with "l is not a
constructor" when it connects, esm.sh's with "Cannot read properties of undefined (reading 'generateRandomLong')";
jsDelivr cannot bundle 2.26.22 at all - it imports "net"). The library holds the account's session, so it is also the
one script that should not come from a file a CDN may regenerate. Version 2.26.21 is the npm dist-tag "browser".

  python src/qa/web/build_gramjs.py        needs Node + npm and the network; takes about a minute

It installs telegram@2.26.21 and esbuild into a temp folder, bundles them as one classic script that defines
window.GramJS = {TelegramClient, Api, sessions, password, errors, utils, helpers, version, CustomFile, Buffer},
writes the file and prints its SHA-256 (web/README.md records the one that was verified)."""
import hashlib, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'web', 'vendor', 'gramjs-2.26.21.min.js'))
VERSION, ESBUILD = '2.26.21', '0.25.10'
ENTRY = """const {TelegramClient, Api, sessions, password, errors, utils, helpers, version} = require('telegram');
const {CustomFile} = require('telegram/client/uploads');
module.exports = {TelegramClient, Api, sessions, password, errors, utils, helpers, version, CustomFile, Buffer: require('buffer').Buffer};
"""
BANNER = ('/*! GramJS (npm "telegram") %s with its dependencies, bundled by esbuild %s for BN Stream Web - see src/qa/web/build_gramjs.py. '
          'MIT License, Copyright (c) the GramJS authors (https://github.com/gram-js/gramjs). */' % (VERSION, ESBUILD))


def main():
    npm, npx = shutil.which('npm'), shutil.which('npx')
    if not npm:
        raise SystemExit('npm is not installed')
    tmp = tempfile.mkdtemp(prefix='gramjs_build_')
    try:
        run = lambda cmd: subprocess.run(cmd, cwd=tmp, check=True)
        with open(os.path.join(tmp, 'package.json'), 'w') as f:
            f.write('{"name": "gramjs-build", "private": true}')
        with open(os.path.join(tmp, 'entry.js'), 'w') as f:
            f.write(ENTRY)
        run([npm, 'install', '--no-audit', '--no-fund', '--ignore-scripts', 'telegram@' + VERSION, 'esbuild@' + ESBUILD])
        run([npx, 'esbuild', 'entry.js', '--bundle', '--platform=browser', '--format=iife', '--global-name=GramJS', '--target=es2020', '--minify',
             '--legal-comments=none', '--define:global=globalThis', '--banner:js=' + BANNER, '--outfile=out.js'])
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        shutil.copyfile(os.path.join(tmp, 'out.js'), OUT)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    data = open(OUT, 'rb').read()
    print('%s  %d bytes  sha256 %s' % (OUT, len(data), hashlib.sha256(data).hexdigest()))


if __name__ == '__main__':
    sys.exit(main())
