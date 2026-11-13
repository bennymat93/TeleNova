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
        # 3.3.5: the token the build ships with is TeleNova's `tmdb_token` (its `tmdb_key` is the user's own, usually
        # empty). It was never read here, so the engine had no TMDb at all: no Hebrew / Russian names of a title,
        # and every title was searched by its English name only
        s['tmdb_key'] = (_foreign('plugin.video.nova', 'tmdb_key') or _foreign('plugin.video.nova', 'tmdb_token')
                         or _foreign('plugin.video.pov', 'tmdb_read_token'))
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
        # 3.3.3: bots that hand out files on request + testing every listed link
        'bot_request': gb('bot_request', True), 'bot_auto': gb('bot_auto', True),
        'bots': [x.strip().lstrip('@') for x in g('bots', '').replace(' ', ',').split(',') if x.strip()],
        'bot_max': gi('bot_max', 3), 'bot_timeout': gi('bot_timeout', 14), 'bot_autojoin': gb('bot_autojoin', False),
        'probe_all': gb('probe_all', True), 'bots_file': os.path.join(common.PROFILE, 'bots.json'),
        # 3.3.4: Real-Debrid
        'rd_enabled': gb('rd_enabled', True), 'rd_token': g('rd_token').strip(), 'rd_refresh': g('rd_refresh').strip(),
        'rd_client_id': g('rd_client_id').strip(), 'rd_client_secret': g('rd_client_secret').strip(),
        'rd_torrentio_on': gb('rd_torrentio_on', True), 'rd_torrentio_key': gb('rd_torrentio_key', True),
        'rd_cloud': gb('rd_cloud', True), 'rd_max': gi('rd_max', 15),
        'max_mbit': gi('max_mbit', 40),             # 4.0.2: heavier files are not listed (0 = no limit)
        # 4.0.4: optional services, off by default
        'st_enabled': gb('st_enabled', False), 'st_url': g('st_url').strip(),
        'os_enabled': gb('os_enabled', False), 'os_key': g('os_key').strip(),
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
            common.log('crypto backend: %s, %s MB/s%s' % (impl, aesfast.bench(),
                                                         (' (%s)' % aesfast.note()) if aesfast.note() else ''), xbmc.LOGINFO)
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
            if self.app:                 # 3.3.5: the chunk a player waits for is requested before the read-ahead
                self.app.store.on_wait = self.tg.bump
                self.app.store.on_drop = self.tg.drop
                self.app.store.on_low = self.tg.lower
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
        from .realdebrid import RealDebrid
        self.rd = RealDebrid(self.s, self._rd_store, common.log)
        # 4.0.4: two optional helpers, both off until the viewer switches them on in the services screen
        from .stremthru import StremThru, DEFAULT_BASE
        from .opensubs import OpenSubs
        self.st = StremThru((self.s.get('st_url') or DEFAULT_BASE) if self.s.get('st_enabled') else '',
                            lambda: self.rd.token, common.log)
        self.rd.st = self.st
        self.osub = OpenSubs(lambda: self.s.get('os_key') if self.s.get('os_enabled') else '', common.log)
        self.finder = Finder(self.tg, meta, ai, self.app.store if self.app else None, self.cache, self.s,
                             common.log, bridge=self.bridge, servers=servers, rd=self.rd)
        self.finder.osub = self.osub

    def _rd_store(self, key, value):
        """Real-Debrid writes its login into the settings; that write must not restart Telegram or the finder."""
        self._importing = True
        try:
            common.set_setting(key, value)
        finally:
            self._later(2.0, lambda: setattr(self, '_importing', False))

    def _later(self, seconds, job):
        """a daemon timer (threading.Timer is not one: Kodi waits for it on exit)"""
        def run():
            if not self.waitForAbort(seconds):
                job()
        threading.Thread(target=run, daemon=True).start()

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

    # ------------------------------------------------------------------ 3.3.4: configuration file
    SKIP_SETTINGS = ('deps_zip', 'wizard_shown')         # a path on this device / a first-run flag: never carried over

    def _setting_ids(self):
        import re
        try:
            with open(os.path.join(common.ADDON_PATH, 'resources', 'settings.xml'), encoding='utf-8') as fh:
                return [i for i in re.findall(r'<setting id="([\w.]+)"', fh.read()) if i not in self.SKIP_SETTINGS]
        except OSError:
            return []

    def _session_bytes(self):
        """A consistent copy of the Telethon session (an SQLite file that is open while the client runs)."""
        import sqlite3
        path = common.SESSION_FILE + '.session'
        if not os.path.exists(path):
            return None
        if self.tg and self.tg.client:
            try:
                async def save():
                    self.tg.client.session.save()
                self.tg.run(save(), 15)
            except Exception as exc:
                common.log('config export: session save: %s' % exc)
        tmp = path + '.export'
        try:
            src = sqlite3.connect(path, timeout=10)
            dst = sqlite3.connect(tmp)
            try:
                src.backup(dst)
            finally:
                dst.close()
                src.close()
            with open(tmp, 'rb') as fh:
                return fh.read()
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass

    def config_export(self, password=''):
        import base64
        from . import configio
        settings = dict((i, common.setting(i, '')) for i in self._setting_ids())
        files = {}
        sess = self._session_bytes()
        if sess:
            files['telegram.session'] = sess
        bots = self.s.get('bots_file')
        if bots and os.path.exists(bots):
            with open(bots, 'rb') as fh:
                files['bots.json'] = fh.read()
        extra = {'addon': common.ADDON_VERSION, 'shared': {}}
        for key in ('tmdb_key', 'gemini_key'):               # keys typed once in the TeleNova hub and used here
            val = _foreign('plugin.video.nova', key)
            if val:
                extra['shared'][key] = val
        blob = configio.pack(settings, files, password or '', extra)
        return {'name': configio.file_name(), 'data': base64.b64encode(blob).decode('ascii'),
                'session': bool(sess), 'settings': len(settings), 'encrypted': bool(password)}

    def config_import(self, data, password=''):
        """All or nothing: the file is opened and checked completely before the first byte is written."""
        import base64
        from . import configio
        try:
            settings, files, extra, head = configio.unpack(base64.b64decode(data), password or '')
        except configio.ConfigError as exc:
            raise RuntimeError(str(exc))
        sess = files.get('telegram.session')
        if sess is not None and not sess.startswith(b'SQLite format 3'):
            raise RuntimeError('damaged')
        known = set(self._setting_ids())
        self._importing = True
        try:
            if self.tg:
                try:
                    self.tg.stop()
                except Exception:
                    pass
                self.tg = None
            if sess is not None:
                path = common.SESSION_FILE + '.session'
                for junk in (path + '-journal', path + '-wal', path + '-shm'):
                    try:
                        os.remove(junk)
                    except OSError:
                        pass
                with open(path + '.new', 'wb') as fh:
                    fh.write(sess)
                os.replace(path + '.new', path)
            if 'bots.json' in files and self.s.get('bots_file'):
                with open(self.s['bots_file'], 'wb') as fh:
                    fh.write(files['bots.json'])
            n = 0
            for key, val in settings.items():
                if key in known and isinstance(val, str) and common.setting(key, '') != val:
                    common.set_setting(key, val)
                    n += 1
            for key, val in (extra.get('shared') or {}).items():
                if key in ('tmdb_key', 'gemini_key') and val and not _foreign('plugin.video.nova', key):
                    try:
                        import xbmcaddon
                        xbmcaddon.Addon('plugin.video.nova').setSetting(key, str(val))
                    except Exception:
                        pass
            self.s = load_settings()
            self._start_tg()
            self._build()
        finally:
            self._later(4.0, lambda: setattr(self, '_importing', False))
        st = {}
        if self.tg:
            try:
                st = self.tg.run(self.tg.status(), 30)
            except Exception as exc:
                st = {'error': str(exc)}
        return {'ok': True, 'settings': n, 'session': sess is not None, 'authorized': bool(st.get('authorized')),
                'me': st.get('me'), 'error': self.tg_error or st.get('error')}

    # ------------------------------------------------------------------ 4.0.4: setup kept in the account
    def _cloud_key(self):
        """The file sits in the account's own Saved Messages: whoever can read it holds the account already. It is
        sealed all the same (configio), with a key made of the account's id, so that its text - keys, tokens - is
        never readable in a chat window, a search result or an export of the chat."""
        me = getattr(self.tg, 'me', None)
        if me is None:
            self.tg.run(self.tg.status(), 30)
            me = self.tg.me
        if me is None:
            raise RuntimeError('not_authorized')
        return 'telenova-setup-v1:%d' % int(me.id)

    def _cloud(self, method, p):
        import base64
        from . import configio
        if not self.tg:
            raise RuntimeError(self.tg_error or 'not_configured')
        if not self.tg.run(self.tg.status(), 30).get('authorized'):
            raise RuntimeError('not_authorized')
        if method == 'cloud_list':
            return self.tg.run(self.tg.cloud_list(), 40)
        if method == 'cloud_put':
            note = {'device': str(p.get('device') or '')[:40], 'name': str(p.get('name') or '')[:60],
                    'build': str(p.get('build') or '')[:20], 'fp': str(p.get('fp') or '')[:24], 'v': 1}
            blob = configio.pack({}, {'setup.zip': base64.b64decode(p['data'])}, self._cloud_key(), {'note': note})
            if len(blob) > 48 * 1024 * 1024:
                raise RuntimeError('setup file too large')
            return self.tg.run(self.tg.cloud_put('TeleNova-setup-%s.tnsync' % (note['device'] or 'device'), blob, note), 180)
        if method == 'cloud_get':
            blob = self.tg.run(self.tg.cloud_get(p['id']), 180)
            try:
                files = configio.unpack(blob, self._cloud_key())[1]
            except configio.ConfigError as exc:
                raise RuntimeError(str(exc))
            if 'setup.zip' not in files:
                raise RuntimeError('damaged')
            return {'data': base64.b64encode(files['setup.zip']).decode('ascii')}
        if method == 'cloud_delete':
            return {'removed': self.tg.run(self.tg.cloud_delete(p.get('ids') or []), 60)}
        raise RuntimeError('unknown method %s' % method)

    def onSettingsChanged(self):
        if getattr(self, '_importing', False):       # config_import() restarts everything once, at its end
            return
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
        # 3.3.5: Kodi gives a service 5 s to end and then waits for its threads all the same. The connections of
        # the players are closed first (a background reader - the subtitle server's ffmpeg - went on pulling the
        # film for minutes after "quit", and Kodi's process never ended), then Telegram gets 3 s to say goodbye.
        common.log('exit: abort seen, shutting down', xbmc.LOGINFO)
        if self.app:
            try:
                self.app.shutdown()
            except Exception as exc:
                common.log('shutdown: %r' % exc)
        if self.tg:
            self.tg.stop(3)
        # 4.0.2: the workers of the search pool wait on a queue for ever - they are told to go
        pool = getattr(self.finder, '_pool', None)
        if pool is not None:
            try:
                pool.shutdown(wait=False)
            except Exception:
                pass
        self._threads_left('after shutdown')

    def _threads_left(self, when):
        """what is still running in this script when it ends (Kodi waits for every thread): one log line each"""
        try:
            import sys
            import traceback
            me = threading.current_thread()
            frames = sys._current_frames()
            for th in threading.enumerate():
                if th is me or th.name in ('telescope-tg', 'telescope-http') or th.name.startswith('Dummy'):
                    continue
                st = traceback.extract_stack(frames.get(th.ident))[-3:] if th.ident in frames else []
                common.log('exit (%s): thread %s daemon=%s at %s' % (when, th.name, th.daemon, ' < '.join(
                    '%s:%d %s' % (os.path.basename(f.filename), f.lineno, f.name) for f in reversed(st))), xbmc.LOGINFO)
        except Exception as exc:
            common.log('exit: %r' % exc)

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
            st = {'deps': self.deps_ok, 'error': self.tg_error, 'crypto': '%s, %s MB/s%s' % (aesfast.impl_name(), aesfast.bench(),
                                               (' (%s)' % aesfast.note()) if aesfast.note() else ''),
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
                            'hits': self.app.store.stats['hits'], 'miss': self.app.store.stats['miss'],
                            'inflight': len(self.app.store.inflight), 'readers': len(self.app.store.positions)}
            if self.tg:
                try:
                    st['pace'] = self.tg.pace_info()        # 3.3.5: what is on the wire / waiting right now
                except Exception:
                    pass
            return st
        if method == 'reinstall_deps':
            deps.ensure(force=True)
            self._deps()
            self._start_tg()
            self._build()
            return True
        if method.startswith('rd_'):                     # 3.3.4: Real-Debrid
            if not getattr(self, 'rd', None):
                self._build()
            rd = self.rd
            if method == 'rd_status':
                if not rd.token:
                    return {'logged_in': False}
                try:
                    return dict(rd.user(fresh=bool(p.get('fresh'))), logged_in=True)
                except Exception as exc:
                    return {'logged_in': True, 'error': str(exc)}
            if method == 'rd_device_start':
                return rd.device_start()
            if method == 'rd_device_poll':
                return {'ok': rd.device_poll(p['device_code'])}
            if method == 'rd_logout':
                return rd.logout()
            if method == 'rd_resolve':
                return {'url': rd.resolve(p['cand'], p.get('want'))}
            raise RuntimeError('unknown method %s' % method)
        if method == 'svc_check':                        # 4.0.4: the services screen asks whether a helper answers
            if not getattr(self, 'rd', None):
                self._build()
            if p.get('name') == 'stremthru':
                if not self.st.base:
                    return {'ok': None, 'detail': 'off'}
                ok, detail = self.st.health()
                return {'ok': bool(ok) and bool(self.rd.token), 'detail': detail if self.rd.token else 'no Real-Debrid login'}
            if p.get('name') == 'opensubs':
                ok, detail = self.osub.check_key()
                return {'ok': ok, 'detail': detail}
            raise RuntimeError('unknown service')
        if method.startswith('cloud_'):                  # 4.0.4: the setup kept in the account's Saved Messages
            return self._cloud(method, p)
        if method == 'config_export':
            return self.config_export(p.get('password') or '')
        if method == 'config_import':
            return self.config_import(p['data'], p.get('password') or '')
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

        if method in ('find_start', 'find_status', 'find_cancel', 'chiko_chats', 'chiko_browse',
                      'bot_list', 'bot_mark', 'bot_ask', 'similar', 'discover'):
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
            if method == 'bot_mark':             # 3.3.3
                return self.finder.bot_mark(p.get('bot'), p.get('on'), p.get('title') or '', p.get('username') or '',
                                            p.get('id'))
            if method in ('bot_list', 'bot_ask', 'similar', 'discover'):
                tg = self._need_tg()
                if self.finder.tg is not tg:
                    self._build()
                if method == 'bot_list':
                    if p.get('refresh'):
                        self.finder.auto_bots(refresh=True)
                    return self.finder.bot_list()
                if method == 'bot_ask':
                    return self.finder.bot_ask(p['bot'], p['query'], p.get('timeout'))
                if method == 'discover':
                    q = p['query']
                    return tg.run(tg.discover(q if isinstance(q, list) else [q]), 60)
                chats = p.get('chats')
                if not chats:                    # "similar to my channels": the account's own broadcast channels
                    mine = [d for d in tg.run(tg.dialogs(200, False), 60) if d.get('kind') == 'channel']
                    chats = [d['id'] for d in mine[:8]]
                return tg.run(tg.similar(chats), 90)
            if method == 'chiko_browse':
                if p.get('backend') == 'telemedia':
                    items = self.finder.bridge.chat_messages(int(p['chat_id']), p.get('query') or '',
                                                             int(p.get('offset') or 0), 50)
                    items.sort(key=lambda c: -int(c['msg_id']))
                    nxt = items[-1]['msg_id'] if len(items) >= 25 else 0
                    return {'items': items, 'next': nxt}
                tg = self._need_tg()
                return tg.run(tg.chat_videos(p['chat_id'], int(p.get('offset') or 0), 50, p.get('query')), 60)

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
            'chat_videos': lambda: tg.chat_videos(p['chat_id'], int(p.get('offset', 0)), int(p.get('limit', 50)),
                                                  p.get('query')),
            'join': lambda: tg.join(p['link']),
            'leave': lambda: tg.leave(int(p['chat_id'])),
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
