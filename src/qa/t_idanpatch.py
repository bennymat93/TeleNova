# -*- coding: utf-8 -*-
"""4.1.1: Idan+ never waits for ever. The patch is tried on the installed Idan+ (a copy) when it is there, and on a
stand-in file always. No Kodi."""
import importlib.util, io, os, shutil, sys, tempfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('idanpatch', os.path.join(HERE, '..', 'plugin.video.nova', 'resources', 'lib', 'idanpatch.py'))
ip = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ip)
bad = []


def check(cond, what):
    if not cond:
        bad.append(what)


SRC = '''import os, re
def GetYouTube(url):
\tif url.endswith('/'):
\t\turl = url[:-1]
\tvideo_id = url[url.rfind('/')+1:]
\treturn video_id

def OpenURL(url, headers={}, user_data=None, session=None, cookies=None, retries=1, responseMethod='text', verify=True):
\tfor i in range(retries):
\t\ttry:
\t\t\tif session is None:
\t\t\t\tif user_data is None:
\t\t\t\t\tresponse = requests.get(url, headers=headers, cookies=cookies, verify=verify)
\t\t\t\telse:
\t\t\t\t\tresponse = requests.post(url, headers=headers, cookies=cookies, data=user_data, verify=verify)
\t\t\telse:
\t\t\t\tif user_data is None:
\t\t\t\t\tresponse = session.get(url, headers=headers, cookies=cookies, verify=verify)
\t\t\t\telse:
\t\t\t\t\tresponse = session.post(url, data=user_data, headers=headers, cookies=cookies, verify=verify)
\t\texcept Exception as ex:
\t\t\tpass

def other():
\tresponse = scraper.request('get', url, headers=fetchHeaders, timeout=20)
\tresponse = scraper.request('get', url)
\tx = requests.get(url, timeout=3, verify=verify)
'''
for nl in ('\n', '\r\n'):
    out, n = ip.add_timeouts(SRC.replace('\n', nl))
    check(n == 5, 'five calls get a time limit (%r line ends): %d' % (nl, n))
    check(out.count('timeout=%d)' % ip.TIMEOUT) == 4 and out.count("scraper.request('get', url, timeout=20)") == 1, 'the right calls')
    check(out.count('timeout=3, verify=verify)') == 1 and out.count("headers=fetchHeaders, timeout=20)") == 1, 'calls that had a limit are left alone')
    check(ip.add_timeouts(out) == (out, 0), 'applied once')
    check(('\n' not in out.replace('\r\n', '')) == (nl == '\r\n'), 'line ends kept')
    compile(out.replace('\r\n', '\n'), 'common', 'exec')
tmp = tempfile.mkdtemp(prefix='tn_idan_')
try:
    lib = os.path.join(tmp, 'resources', 'lib')
    os.makedirs(lib)
    io.open(os.path.join(lib, 'common.py'), 'w', encoding='utf-8', newline='').write(SRC.replace('\n', '\r\n'))
    check(ip.apply(tmp) is True and ip.apply(tmp) is False, 'apply: changed once, then nothing to do')
    got = io.open(os.path.join(lib, 'common.py'), encoding='utf-8', newline='').read()
    check(ip.MARK in got and ip.MARK2 in got and '\n' not in got.replace('\r\n', ''), 'both fixes in, line ends kept')
    compile(got.replace('\r\n', '\n'), 'common', 'exec')
    check(ip.apply(os.path.join(tmp, 'nothing')) is False, 'no Idan+: nothing happens')
    real = os.path.join(os.environ.get('APPDATA', ''), 'Kodi', 'addons', 'plugin.video.idanplus', 'resources', 'lib', 'common.py')
    if os.path.exists(real):
        text = io.open(real, encoding='utf-8', newline='').read()
        fresh = text.replace(', timeout=%d)' % ip.TIMEOUT, ')').replace("scraper.request('get', url, timeout=20)", "scraper.request('get', url)")
        fresh = fresh.replace(ip.MARK2, '').rstrip('\r\n') + '\n'
        out, n = ip.add_timeouts(fresh)
        left = [l.strip() for l in out.splitlines() if ('requests.' in l or 'session.' in l or 'scraper.request' in l)
                and ('.get(' in l or '.post(' in l or '.request(' in l) and 'response' in l and 'timeout' not in l]
        print('installed Idan+: %d call(s) get a time limit, %d request(s) still without one' % (n, len(left)))
        check(n >= 4, 'the installed Idan+ changed shape: only %d calls found' % n)
        check(not left, 'requests still without a time limit: %r' % left[:3])
        compile(out.replace('\r\n', '\n'), 'common', 'exec')
    else:
        print('Idan+ not installed here - only the stand-in file was checked')
finally:
    shutil.rmtree(tmp, ignore_errors=True)
for b in bad:
    print('FAIL', b)
print('IDANPATCH TESTS OK' if not bad else 'IDANPATCH TESTS: %d problems' % len(bad))
sys.exit(1 if bad else 0)
