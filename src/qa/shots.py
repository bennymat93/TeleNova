# -*- coding: utf-8 -*-
"""Screenshots for the user guide, taken by Kodi itself (JSON-RPC)."""
import glob, os, shutil, sys, time
sys.argv = ['x', '0', '0'] + sys.argv[1:]
exec(open(os.path.join(os.path.dirname(__file__), 'crawl.py'), encoding='utf-8').read().split('# listing actions')[0])
out = sys.argv[-1]
tmp = os.path.join(out, '_raw')
shutil.rmtree(tmp, ignore_errors=True)
os.makedirs(tmp)
print('screenshot path set:', rpc('Settings.SetSettingValue', {'setting': 'debug.screenshotpath', 'value': tmp + os.sep}).get('result'))
N = 'plugin://plugin.video.nova/'
T = 'plugin://plugin.video.telescope/'


def shot(name, wait=4):
    time.sleep(wait)
    before = set(glob.glob(os.path.join(tmp, '*')))
    rpc('Input.ExecuteAction', {'action': 'screenshot'})
    for _ in range(20):
        time.sleep(0.5)
        new = set(glob.glob(os.path.join(tmp, '*'))) - before
        if new:
            src = sorted(new)[0]
            last = -1
            for _ in range(40):                    # a 4K PNG takes a few seconds to be written
                time.sleep(0.7)
                size = os.path.getsize(src)
                if size > 0 and size == last:
                    break
                last = size
            shutil.copyfile(src, os.path.join(out, name + os.path.splitext(src)[1]))
            print('  %-10s %d KB' % (name, os.path.getsize(src) // 1024))
            return True
    print('  %-10s NOT captured' % name)
    return False


def videos(path):
    return rpc('GUI.ActivateWindow', {'window': 'videos', 'parameters': [path, 'return']}, 60)


rpc('GUI.ActivateWindow', {'window': 'home'})
shot('home', 6)
videos(N); shot('menu', 5)
videos(N + '?a=list&m=movie&path=%2Ftrending%2Fmovie%2Fweek'); shot('movies', 8)
videos(N + '?a=tv_list&group=1'); shot('tv', 6)
videos(T); shot('telegram', 5)
videos(T + '?mode=account'); shot('account', 5)
# the device-type dialog: started without waiting, so the control channel stays free
rpc('Addons.ExecuteAddon', {'addonid': 'plugin.video.nova', 'params': {'a': 'profile_pick'}, 'wait': False})
shot('device', 5)
rpc('Input.Back')
time.sleep(1)
rpc('GUI.ActivateWindow', {'window': 'home'})
shutil.rmtree(tmp, ignore_errors=True)
rpc('Settings.SetSettingValue', {'setting': 'debug.screenshotpath', 'value': ''})
print('profile still:', 'ok')
