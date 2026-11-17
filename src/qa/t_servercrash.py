import sys, time, threading, types
sys.path.insert(0, r'C:\Users\benny\kodi-build\server')
import nova_subs as ns
_sleep = time.sleep
import faulthandler; assert faulthandler.is_enabled()
# unloader: explicit unload under the locks
calls = []
class FM: 
    def unload_model(self): calls.append(threading.current_thread().name)
ns._model = types.SimpleNamespace(model=FM()); ns._last_use[0] = time.time() - 10000
ns.time.sleep = lambda s: (_ for _ in ()).throw(SystemExit) if calls else None
try: ns._unloader()
except SystemExit: pass
assert calls and ns._model is None, calls
# job stop path: pool joined, idle clock reset
ns.time.sleep = _sleep
j = ns.Job({'url': 'http://x/a.mkv', 'title': 't'})
ns._last_use[0] = 0
from concurrent.futures import ThreadPoolExecutor
j._pool = ThreadPoolExecutor(1); done = []
j._pool.submit(lambda: (time.sleep(0.5), done.append(1)))
j.cache_file = r'C:\nonexistent\x.json'
ns.resolve_source = lambda s: (_ for _ in ()).throw(RuntimeError('boom'))
j.run()
print(j.state, j.error, done, j._pool, time.time() - ns._last_use[0])
assert j.state == 'error' and done == [1] and j._pool is None and time.time() - ns._last_use[0] < 5
print('OK')


