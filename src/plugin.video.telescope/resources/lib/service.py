# -*- coding: utf-8 -*-
"""Background service: owns the Telegram session, the streaming proxy and the search jobs."""
import os
import secrets
import threading
import time

import xbmc

from . import common, deps, aesfast
from .cache import Cache
from .stream import App
from .meta import Meta
from .gemini import Gemini
from .sources import Finder
from .backends import TelemediaBridge, StremioServers


def _foreign(addon_id, key):
    try:
        import xbmcaddon
        if not xbmc.getCondVisibility('System.HasAddon(%s)' % addon_id):
            return ''                   # asking for a missing add-on writes an EXCEPTION line into Kodi's log
        return (xbmcaddon.Addon(addon_id).getSetting(key) or '').strip()
    except Exception:
        return ''


def load_settings():
    s = _load_settings()
    # embedded in the NovaTV build: keys entered once in NovaTV / POV are used here as well
    if not s['tmdb_key']:
        s['tmdb_key'] = _foreign('plugin.video.nova', 'tmdb_key') or _foreign('plugin.video.pov', 'tmdb_read_token')
    if not s['gemini_key']:
        s['gemini_key'] = _foreign('plugin.video.nova', 'gemini_key')
    return s


def _load_settings():
    g = common.setting
    gi = common.setting_int
    gb = common.setting_bool
    pinned = [x.strip() for x in g('pinned_chats', '').split(',') if x.strip()]
    return {
        'api_id': g('api_id').strip(), 'api_hash': g('api_hash').strip(),
        'tmdb_key': g('tmdb_key').strip(), 'gemini_key': g('gemini_key').strip(),
        'gemini_model': g('gemini_model').strip(), 'ai_aliases': gb('ai_aliases', True),
        'ai_verify': gb('ai_verify', True), 'ai_verify_all': gb('ai_verify_all', False),
        'strict': gb('strict', True), 'lang_pref': ['any', 'he', 'ru', 'en'][min(3, gi('lang_pref', 0))],
        'min_quality': [0, 480, 720, 1080, 2160][min(4, gi('min_quality', 0))], 'hide_cam': gb('hide_cam', True),
        'probe': gb('probe', True), 'probe_count': gi('probe_count', 6), 'probe_timeout': gi('probe_timeout', 6),
        'hide_slow': gb('hide_slow', True), 'keep_unprobed': gb('keep_unprobed', False),
        'max_results': gi('max_results', 25), 'search_limit': gi('search_limit', 100),
        'search_timeout': gi('search_timeout', 12), 'max_aliases': gi('max_aliases', 4),
        'max_queries': gi('max_queries', 6), 'parallel': gi('parallel', 4), 'readahead': gi('readahead', 6),
        'cache_mb': gi('cache_mb', 48), 'port': gi('port', 65220), 'pinned_chats': pinned,
        'debug': gb('debug', False), 'adult': gb('adult', False),
        'use_telemedia': gb('use_telemedia', True), 'chiko': gb('chiko', True),
        'chiko_keywords': g('chiko_keywords', u"\u05e6'\u05d9\u05e7\u05d5,\u05e6\u05d9\u05e7\u05d5,chiko,chico"),
        'chiko_boost': gi('chiko_boost', 15),
        'stremio_servers': [x.strip() for x in g('stremio_servers', '').replace('\n', ',').split(',') if x.strip()],
    }


class Service(xbmc.Monitor):
    def __init__(self):
        super(Service, self).__init__()
        self.s = load_settings()
        self.cache = Cache(common.CACHE_DB)
        self.tg = None
        self.tg_error = None
        self.app = None
        self.finder = None
        self.secret = secrets.token_hex(16)
        self.deps_ok = False
        self.bridge = None
        self.finder = None
        self.meta = None
        self.ai = None
        self._started = threading.Event()   # 3.3: set when start() finished (the HTTP server answers before that)

    # ------------------------------------------------------------------ setup
    def _deps(self):
        try:
            if not deps.installed():
                common.notify(common.lang(30900))
            self.deps_ok = deps.ensure()
            impl = aesfast.patch_telethon()
            common.log('crypto backend: %s, %s MB/s' % (impl, aesfast.bench()), xbmc.LOGINFO)
            if 0 < aesfast.bench() < 1.5:     # below ~12 Mbit/s: heavy files will buffer on this device
                common.notify(u'\u05e4\u05e2\u05e0\u05d5\u05d7 \u05d8\u05dc\u05d2\u05e8\u05dd \u05d0\u05d9\u05d8\u05d9 \u05d1\u05de\u05db\u05e9\u05d9\u05e8 \u05d4\u05d6\u05d4 (%s MB/s): \u05e2\u05d3\u05d9\u05e3 \u05e7\u05d1\u05e6\u05d9\u05dd \u05e2\u05d3 720p' % aesfast.bench())
        except Exception as exc:
            self.deps_ok = False
            self.tg_error = 'deps: %s' % exc
            common.log_error('dependency install failed: %r' % exc)

    def _start_tg(self, timeout=60):
        from .tgclient import TG
        if self.tg:
            try:
                self.tg.stop()
            except Exception:
                pass
            self.tg = None
        if not self.deps_ok:
            return
        if not (self.s['api_id'].isdigit() and self.s['api_hash']):
            self.tg_error = 'not_configured'
            return
        try:
            self.tg = TG(self.s['api_id'], self.s['api_hash'], common.SESSION_FILE, common.log,
                         parallel=self.s['parallel'])
            self.tg.info = lambda m: common.log(m, xbmc.LOGINFO)     # 3.3.1: flood waits are always logged
            self.tg.start(timeout)
            self.tg_error = None
        except Exception as exc:
            self.tg_error = '%s: %s' % (type(exc).__name__, exc)
            common.log_error('telegram start failed: %r' % exc)

    def _build(self):
        meta = Meta(self.s['tmdb_key'], common.tmdb_language(), self.cache, self.s['adult'], common.log)
        ai = Gemini(self.s['gemini_key'], self.s['gemini_model'], log=common.log) if self.s['gemini_key'] else None
        self.meta, self.ai = meta, ai
        if self.app:
            self.app.readahead = self.s['readahead']
            self.app.store.parallel = self.s['parallel']
            self.app.store.max_bytes = self.s['cache_mb'] * 1024 * 1024
        if not getattr(self, 'bridge', None):
            self.bridge = TelemediaBridge(common.log)
        self.s['crypto'] = aesfast.impl_name()
        servers = StremioServers(self.s['stremio_servers'], common.log)
        self.finder = Finder(self.tg, meta, ai, self.app.store if self.app else None, self.cache, self.s,
                             common.log, bridge=self.bridge, servers=servers)

    def _fetch(self, chat, msg, idx):
        if not self.tg:
            raise IOError('telegram not ready')
        return self.tg.submit(self.tg.read_chunk(chat, msg, idx))

    def _file_info(self, chat, msg):
        if not self.tg:
            raise IOError('telegram not ready')
        return self.tg.run(self.tg.file_info(chat, msg), 30)

    def start(self):
        # 3.3: the HTTP server and port.json come first - the dependency download and the Telegram connect can
        # take a minute, and until then port.json of the previous run pointed the plugin at a dead port
        self.app = App(self._fetch, self._file_info, self.rpc, common.log, self.secret,
                       cache_mb=self.s['cache_mb'], parallel=self.s['parallel'], readahead=self.s['readahead'],
                       debug=self.s['debug'])
        self.app.info = lambda m: common.log(m, xbmc.LOGINFO)       # 3.3.1: stalls are always logged
        port = self.app.serve(self.s['port'])
        common.write_json(common.PORT_FILE, {'port': port, 'secret': self.secret, 'pid': os.getpid(),
                                             'started': time.time()})
        try:
            self._deps()
            self._start_tg()
            self._build()
        finally:
            self._started.set()
        common.log('service ready on port %d (telegram: %s)' % (port, self.tg_error or 'ok'), xbmc.LOGINFO)

    def onSettingsChanged(self):
        old = self.s
        self.s = load_settings()
        if (old['api_id'], old['api_hash'], old['parallel']) != (self.s['api_id'], self.s['api_hash'],
                                                                 self.s['parallel']):
            self._start_tg()
        self._build()

    def _watchdog(self):
        """3.3: called about every 30 s. A client that lost its connection for good, or one that could not be
        started (no Wi-Fi when Kodi started), is brought back without restarting Kodi."""
        tg = self.tg
        if tg is not None and tg.client is not None:
            if not tg.client.is_connected():
                common.log('telegram is disconnected - reconnecting', xbmc.LOGINFO)
                tg.run(tg.reconnect(), 30)
                self.tg_error = None
                common.log('telegram reconnected', xbmc.LOGINFO)
        elif self.deps_ok and self.tg_error and self.tg_error != 'not_configured':
            self._start_tg(30)
            if self.tg and not self.tg_error:
                self._build()

    def run(self):
        self.start()
        ticks = 0
        purged = 0
        while not self.abortRequested():
            if self.waitForAbort(10):
                break
            ticks += 1
            if ticks % 3 == 0:
                try:
                    self._watchdog()
                except Exception as exc:
                    common.log('telegram reconnect failed: %r' % exc)
            if time.time() - purged > 86400:        # 3.3: expired cache rows are removed once a day
                purged = time.time()
                try:
                    self.cache.purge_expired()
                except Exception as exc:
                    common.log('cache purge failed: %r' % exc)
        if self.tg:
            self.tg.stop()
        if self.app:
            self.app.shutdown()

    # ------------------------------------------------------------------ RPC
    def _need_tg(self):
        if not self.deps_ok:                     # a failed first-run download is retried on demand
            self._deps()
            if self.deps_ok:
                self._start_tg()
                self._build()
        if not self.tg:
            raise RuntimeError(self.tg_error or 'not_configured')
        return self.tg

    def rpc(self, method, p):
        if method == 'ping':
            return {'ok': True}
        if method != 'status' and not self._started.is_set():
            # 3.3: the server answers while Telegram is still being connected: a call waits for the start instead
            # of failing with "not configured"; the plugin repeats a call that got 'service_starting'
            if not self._started.wait(15):
                raise RuntimeError('service_starting')
        if method == 'status':
            st = {'deps': self.deps_ok, 'error': self.tg_error, 'crypto': '%s, %s MB/s' % (aesfast.impl_name(), aesfast.bench()),
                  'versions': deps.versions(), 'ai': bool(self.ai), 'tmdb': bool(self.s['tmdb_key'])}
            if self.tg:
                try:
                    st.update(self.tg.run(self.tg.status(), 20))
                except Exception as exc:
                    st['error'] = str(exc)
            if self.finder:
                st['telemedia_bridge'] = self.finder.bridge_ok()
                st['stremio_servers'] = len(self.finder.servers.bases) if self.finder.servers else 0
            st['stream'] = {'speed': int(self.app.store.speed()), 'cached_mb': self.app.store.size // 1048576,
                            'hits': self.app.store.stats['hits'], 'miss': self.app.store.stats['miss']}
            return st
        if method == 'reinstall_deps':
            deps.ensure(force=True)
            self._deps()
            self._start_tg()
            self._build()
            return True
        if method == 'clear_cache':
            self.cache.purge(p.get('prefix'))
            return True
        if method == 'ai_test':
            if not self.ai:
                return {'ok': False, 'error': 'no key'}
            return {'ok': self.ai.test(), 'model': self.ai.model}
        if method == 'ai_search':
            if not self.ai:
                raise RuntimeError('no gemini key')
            return self.ai.smart_search(p['text'])

        if method in ('find_start', 'find_status', 'find_cancel', 'chiko_chats', 'chiko_browse'):
            if not self.finder:
                self._build()
            if method == 'find_start':
                return self.finder.start(p['target'])
            if method == 'find_status':
                job = self.finder.jobs.get(p['job'])
                if not job:
                    raise RuntimeError('unknown job')
                return job.as_dict()
            if method == 'find_cancel':
                job = self.finder.jobs.get(p['job'])
                if job:
                    job.cancel = True
                return True
            if method == 'chiko_chats':
                return self.finder.chiko_chats(refresh=bool(p.get('refresh')))
            if method == 'chiko_browse':
                if p.get('backend') == 'telemedia':
                    items = self.finder.bridge.chat_messages(int(p['chat_id']), p.get('query') or '',
                                                             int(p.get('offset') or 0), 50)
                    items.sort(key=lambda c: -int(c['msg_id']))
                    nxt = items[-1]['msg_id'] if len(items) >= 25 else 0
                    return {'items': items, 'next': nxt}
                tg = self._need_tg()
                return tg.run(tg.chat_videos(int(p['chat_id']), int(p.get('offset') or 0), 50, p.get('query')), 60)

        if method == 'raw_search' and not (self.tg and getattr(self.tg, 'me', None)) and self.finder and self.finder.bridge_ok():
            return self.finder.bridge.search(p['query'], int(p.get('limit', 60)))
        tg = self._need_tg()
        t = 60
        simple = {
            'send_code': lambda: tg.send_code(p['phone']),
            'sign_in': lambda: tg.sign_in(p['code']),
            'sign_in_password': lambda: tg.sign_in_password(p['password']),
            'qr_start': lambda: tg.qr_start(),
            'qr_wait': lambda: tg.qr_wait(p.get('timeout', 4)),
            'logout': lambda: tg.logout(),
            'dialogs': lambda: tg.dialogs(p.get('limit', 300)),
            'chat_videos': lambda: tg.chat_videos(int(p['chat_id']), int(p.get('offset', 0)), int(p.get('limit', 50)),
                                                  p.get('query')),
            'join': lambda: tg.join(p['link']),
            'leave': lambda: tg.leave(int(p['chat_id'])),
            'discover': lambda: tg.discover(p['query']),
            'raw_search': lambda: tg.search(p['query'], limit=int(p.get('limit', 60))),
            'file_info': lambda: tg.file_info(int(p['chat_id']), int(p['msg_id'])),
        }
        if method in simple:
            res = tg.run(simple[method](), t)
            if method == 'raw_search':
                for c in res:
                    c.pop('parsed', None)
            if method in ('sign_in', 'sign_in_password', 'qr_wait') and isinstance(res, dict) and res.get('ok'):
                self._build()
            return res
        raise RuntimeError('unknown method %s' % method)


def run():
    Service().run()
