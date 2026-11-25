# -*- coding: utf-8 -*-
"""Every test of the web version (BN Stream Web / TeleNova Web), in one go:

  python src/qa/web/run_web_tests.py

  1. gen_fixtures.py   the build's own syncdoc.py / configio.py produce documents and sealed files
  2. t_web.js          web/syncdoc.js merges the same inputs to byte-identical text; web/sealed.js opens the sealed
                       files and seals new ones
  3. check_repack.py   the build's code opens what the browser code sealed
  4. t_store.js        users, history, favourites, search history and the sync loop of the browser (no network)
  5. t_mixed.py        the build's real loop (autosync.cycle) and the browser's loop on one account: same result,
                       no write when nothing changed
  6. static checks     channels_il.json is what gen_channels.py makes of livefail.py; every text exists in he / en / ru;
  4b. t_twins.js       6.2.0: twins.js codecs and the settings side of the browser's sync loop (join rule, no session)
                       the service worker caches every local file the page loads

Needs Python 3 and Node 18+ (WebCrypto). fflate (the zlib / zip library the page loads from jsDelivr) is fetched once
into the temp folder and checked against the same hash the page pins. Ends with WEB TESTS OK; exit code 1 otherwise."""
import hashlib, io, json, os, re, shutil, subprocess, sys, tempfile, urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'web'))
FFLATE_URL = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js'
FFLATE_SHA256 = 'c3b34f2e9f5e74d4d7d64e01cac7a0c01954c6c406414d42185c7b53d6875ddf'
bad = []


def fflate():
    """the pinned library, cached in the temp folder"""
    path = os.path.join(tempfile.gettempdir(), 'telenova-web-tests', 'fflate-0.8.2.umd.js')
    ok = lambda: os.path.exists(path) and hashlib.sha256(open(path, 'rb').read()).hexdigest() == FFLATE_SHA256
    if not ok():
        os.makedirs(os.path.dirname(path), exist_ok=True)
        req = urllib.request.Request(FFLATE_URL, headers={'User-Agent': 'web-tests'})
        with urllib.request.urlopen(req, timeout=60) as r, open(path, 'wb') as f:
            f.write(r.read())
        if not ok():
            raise SystemExit('FAIL fflate: the downloaded file does not match the pinned hash')
    return path


def run(what, cmd, quiet=False):
    print('--- %s' % what)
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    text = p.stdout.decode('utf-8', 'replace').rstrip()
    if text:
        # quiet: the last line only (these tests print one line per check), everything when it failed
        print(text if (p.returncode or not quiet) else text.splitlines()[-1])
    if p.returncode:
        bad.append(what)
    return p.returncode == 0


def static_checks():
    print('--- static checks')
    n0 = len(bad)
    # the channel table is the build's
    sys.path.insert(0, HERE)
    import gen_channels
    want = gen_channels.build()
    try:
        with open(os.path.join(WEB, 'channels_il.json'), encoding='utf-8') as f:
            have = json.load(f)
    except (OSError, ValueError):
        have = None
    if have != want:
        bad.append('web/channels_il.json is not what gen_channels.py makes of livefail.py - run gen_channels.py')
    # every text in three languages (the L / X tables of app.js: each language block must have the same keys)
    node = shutil.which('node')
    probe = subprocess.run([node, os.path.join(HERE, 't_texts.js')], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = probe.stdout.decode('utf-8', 'replace').strip()
    if probe.returncode:
        bad.append('texts: ' + out)
    else:
        print(out)
    # the service worker's shell list covers every local file index.html and the scripts load
    with open(os.path.join(WEB, 'sw.js'), encoding='utf-8') as f:
        sw = f.read()
    with open(os.path.join(WEB, 'index.html'), encoding='utf-8') as f:
        index = f.read()
    shell = set(re.findall(r"'([^']+)'", re.search(r'const SHELL = \[(.*?)\];', sw, re.S).group(1)))
    local = set(m for m in re.findall(r'(?:src|href)="([^"#:]+)"', index) if not m.startswith('//'))
    app = ''
    for name in ('app.js', 'tg.js'):
        with open(os.path.join(WEB, name), encoding='utf-8') as f:
            app += f.read()
    local |= set(re.findall(r"'((?:vendor/)?[\w.-]+\.(?:js|json))'", app))
    local -= {'sw.js'}                                # (the service worker itself)
    vendor = set(n for n in local if n.startswith('vendor/'))      # fetched only by a viewer who connects Telegram: not part of the offline shell
    for name in sorted(local):
        if not os.path.exists(os.path.join(WEB, name)):
            bad.append('the page refers to %s, which does not exist' % name)
        elif name not in shell and name not in vendor:
            bad.append('sw.js does not cache %s: the app would not open offline' % name)
    if 'Content-Security-Policy' not in index:
        bad.append('index.html has no Content-Security-Policy')
    for m in re.finditer(r'<script[^>]+src="(https://[^"]+)"[^>]*>', index):
        if 'integrity="sha384-' not in m.group(0) or not re.search(r'@\d+\.\d+\.\d+/', m.group(1)):
            bad.append('a CDN script without a pinned version and hash: %s' % m.group(1))
    print('static checks: %d local files, %s' % (len(local), 'ok' if len(bad) == n0 else 'PROBLEMS'))


def main():
    node = shutil.which('node')
    if not node:
        raise SystemExit('FAIL node is not installed')
    tmp = tempfile.mkdtemp(prefix='tn_web_')
    try:
        lib = fflate()
        if run('fixtures from the build (Python)', [sys.executable, os.path.join(HERE, 'gen_fixtures.py'), tmp]):
            if run('syncdoc.js + sealed.js against them (Node)', [node, os.path.join(HERE, 't_web.js'), tmp, lib]):
                run('the build opens what the browser sealed (Python)', [sys.executable, os.path.join(HERE, 'check_repack.py'), tmp])
        run('users, lists and the sync loop in the browser (Node)', [node, os.path.join(HERE, 't_store.js'), lib])
        run('Kodi devices and browsers on one account (Python + Node)', [sys.executable, os.path.join(HERE, 't_mixed.py')])
        # 4.3.0: the module tests (pure parts, fake DOM) and the helper Worker's own test ran only by hand before
        for name in ('t_matcher', 't_sources', 't_srt', 't_texts', 't_tgsearch', 't_content', 't_live', 't_playback', 't_shell', 't_compat', 'undef_web', 't_tglink', 't_aio',
                     't_player', 't_player_dom', 't_twins', 't_web65'):
            run('%s.js (Node)' % name, [node, os.path.join(HERE, name + '.js')], quiet=True)
        run('helper Worker (Node)', [node, os.path.join(WEB, '..', 'worker', 'test.mjs')], quiet=True)
        static_checks()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    for b in bad:
        print('FAIL', b)
    print('WEB TESTS OK' if not bad else 'WEB TESTS: %d problems' % len(bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
