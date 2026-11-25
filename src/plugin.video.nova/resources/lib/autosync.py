# -*- coding: utf-8 -*-
"""4.1.0: continuous sync between the devices of one Telegram account - nothing to press, nothing to answer.

What travels: the users and each user's history / favourites / search history, the settings of the hub, of the
Telegram engine and of the subtitle add-on (keys, service logins, choices), the IPTV sources and the source choices.
Where: one sealed document in the account's own "Saved Messages" (the engine's cloud_* calls). What never travels:
the Telegram login itself, and what belongs to one device (address of the PC server, debug switches, caches).

Every device runs the same small loop (the hub's service, about every 90 s, at once after a change of user):
  1. look at the local state; a setting that changed here since the last look gets the time of the change
  2. when the document in the account changed since the last look: fetch it
  3. merge both (syncdoc.merge - every device ends with the same result, nobody's change is lost)
  4. write here what the merge brought (settings through Kodi so they take effect at once, lists as files -
     no restart, no question), upload when this device added something
A new device needs its Telegram login only: the first round brings everything else.

cycle() is written against a small "host" object (files, settings, the cloud), so the whole loop - two devices
changing things at the same time - is tested without Kodi and without Telegram (qa/t_autosync.py)."""
import re
import time

from . import syncdoc, users

FLAGS = 'services.json'          # 'sync_on' (default: on)
META = 'sync_meta.json'          # this device only: what was last seen, with the times of the local changes
PERIOD = 90
DOC_DEVICE = 'sync-v2'           # the engine keeps one file per "device" name: this name is the shared document
FILES = ('iptv.json', 'providers.json', 'services.json', 'profiles.json')
ADDONS = ('plugin.video.nova', 'plugin.video.telescope', 'service.subtitles.All_Subs')
# settings that belong to one device or change by themselves: never synced
LOCAL = re.compile(r'^(debug|port|device_profile|deps_zip|wizard_shown|sub_server|lite_done|depov_done|wizard_fix|tune_done|'
                   # 6.2.0: these depend on the box (a phone and a TV differ): lite mode, sounds, what opens at start,
                   # and the player's buffer / speed tuning
                   r'lite|ui_sounds|open_on_start|readahead|cache_mb|max_mbit|'
                   r'\w+_done|last_\w+|\w+_ts|\w+_time|kodion\..*|.*\.port)$')
# 6.2.0: the Telegram login never enters the document - checked before LOCAL, for settings AND files, on the way
# out and on the way in (a copied session ends both logins: AUTH_KEY_DUPLICATED). Same rule in web/websync.js.
SESSION_RX = re.compile(r'(?i)(session|auth_?key|string_?sess)')   # 6.2.0: the same rule as the web (websync.js)


def is_session(key):
    return bool(SESSION_RX.search(str(key or '')))


def syncable(settings):
    return dict((k, v) for k, v in (settings or {}).items() if not is_session(k) and not LOCAL.match(k))


def scrub(doc):
    """6.2.0: the document without any session-like setting or file (also one an old / broken peer put there)"""
    if not isinstance(doc, dict):
        return doc
    sett = doc.get('settings')
    if isinstance(sett, dict):
        for aid in list(sett.keys()):
            if is_session(aid):
                del sett[aid]
            elif isinstance(sett[aid], dict):
                for k in [k for k in sett[aid] if is_session(k)]:
                    del sett[aid][k]
    files = doc.get('files')
    if isinstance(files, dict):
        for k in [k for k in files if is_session(k)]:
            del files[k]
    return doc


def cycle(host, now=None):
    """one round. host: see KodiHost. -> dict of what happened (for the log and the tests)"""
    now = int(now if now is not None else time.time())
    out = {'pulled': False, 'pushed': False, 'applied': 0, 'users': False, 'data': []}
    meta = host.load_meta() or {}
    mark = host.cloud_mark()
    founding = now if not mark else 0          # no document in the account yet: this device's setup founds it
    # 1. the local document
    local = syncdoc.empty()
    local['users'] = host.users()
    for u in syncdoc.live_users(local['users']):
        local['data'][u['id']] = host.user_data(u['id'])
    current = {}
    for aid in ADDONS:
        vals = host.settings(aid)
        if vals is None:
            continue
        current[aid] = syncable(vals)
        seen = (meta.get('settings') or {}).get(aid)
        if isinstance(seen, dict):                 # 6.2.0: keys that became device-only (or session-like) leave the meta
            seen = dict((k, v) for k, v in seen.items() if not is_session(k) and not LOCAL.match(k))
        meta.setdefault('settings', {})[aid] = syncdoc.stamp_changes(seen, current[aid], now, founding)
        local['settings'][aid] = meta['settings'][aid]
    scrub(meta.get('last_doc'))
    for part in ('settings', 'files'):          # 6.2.0: an older meta may still remember a session-like key
        if isinstance(meta.get(part), dict):
            scrub({part: meta[part]})
    files = dict((name, host.file(name)) for name in FILES if not is_session(name))
    files = dict((k, v) for k, v in files.items() if v is not None)
    meta['files'] = syncdoc.stamp_changes(meta.get('files') if 'files' in meta else None, files, now, founding)
    local['files'] = meta['files']
    # 6.2.0: sections this device does not own ("web" from the browser/apps, an add-on not installed here) come from
    # the last document seen, untouched - a round without a fetch must not re-put the document without them
    for aid, keys in ((meta.get('last_doc') or {}).get('settings') or {}).items():
        if not isinstance(keys, dict):
            continue
        if aid not in local['settings']:
            local['settings'][aid] = keys
        else:                                    # 6.2.0: installed here too - keep keys other peers put in the section
            carried = dict((k, v) for k, v in keys.items() if not is_session(k) and not LOCAL.match(k))
            local['settings'][aid] = syncdoc.merge_stamped(carried, local['settings'][aid])
    # 2. the account's document (fetched only when it changed)
    remote = None
    if mark and mark != meta.get('cloud_mark'):
        remote = scrub(host.cloud_get())
        out['pulled'] = remote is not None
    if mark and remote is None and mark != meta.get('cloud_mark'):
        host.save_meta(meta)                       # could not read it now: the next round tries again
        return out
    # 3. merge
    merged = syncdoc.merge(local, remote)        # (with nothing fetched this only puts the local copy in its normal form)
    # 4. bring the merge here
    if remote is not None:
        if host.set_users(merged['users']):
            out['users'] = True
        for uid, data in merged['data'].items():
            wrote = host.put_user_data(uid, data)
            if wrote:
                out['data'].append(uid)
        for aid, keys in syncdoc.changed_settings(merged['settings'], current).items():
            # 6.2.0: only this device's add-ons and only syncable keys are written here; the "web" section, an add-on
            # this box does not have, and device-only keys another peer put in stay in the document untouched
            if aid not in current:
                continue
            for k, v in keys.items():
                if is_session(k) or LOCAL.match(k):
                    continue
                if host.set_setting(aid, k, v):
                    out['applied'] += 1
                    meta['settings'][aid][k] = merged['settings'][aid][k]
        for aid in merged['settings']:
            if aid in meta.get('settings', {}):
                for k, pair in merged['settings'][aid].items():
                    if k in meta['settings'][aid] and syncdoc.canon(meta['settings'][aid][k][0]) == syncdoc.canon(pair[0]):
                        meta['settings'][aid][k] = pair          # the same value: keep the account's time
        for name, (obj, ts) in merged['files'].items():
            # 6.2.0: only the known files are written to disk; a file another peer added passes through untouched
            if name in FILES and ts > 0 and syncdoc.canon(files.get(name)) != syncdoc.canon(obj):
                host.put_file(name, obj)
                out['applied'] += 1
            meta['files'][name] = [obj, ts]
    # 5. upload when this device has something the account does not
    if remote is None and mark:
        need = bool(meta.get('dirty')) or not syncdoc.same(merged, meta.get('last_doc'))
    else:
        need = remote is None or not syncdoc.same(merged, remote)
    if need:
        new_mark = host.cloud_put(merged)
        if new_mark:
            out['pushed'] = True
            mark = new_mark
            meta['dirty'] = False
        else:
            meta['dirty'] = True
    meta['cloud_mark'] = mark
    meta['last_doc'] = {'users': merged['users'], 'data': merged['data'], 'settings': merged['settings'], 'files': merged['files']}
    meta['last'] = now
    host.save_meta(meta)
    return out


# ------------------------------------------------------------------ Kodi
class KodiHost(object):
    """the real files, settings and cloud"""

    def __init__(self):
        from .common import PROFILE
        self.root = PROFILE

    def load_meta(self):
        from .common import load
        return load(META, {})

    def save_meta(self, meta):
        from .common import save
        save(META, meta)

    def users(self):
        return users.store_users(self.root)

    def set_users(self, lst):
        return users.store_set_users(self.root, lst)

    def user_data(self, uid):
        return users.store_data(self.root, uid)

    def put_user_data(self, uid, data):
        return users.store_put(self.root, uid, data)

    def _addon(self, aid):
        import os
        import xbmcaddon
        import xbmcvfs
        if not os.path.isdir(xbmcvfs.translatePath('special://home/addons/%s' % aid)):
            return None
        try:
            return xbmcaddon.Addon(aid)
        except Exception:
            return None

    def settings(self, aid):
        import os
        import xbmcvfs
        from .cloudsync import settings_map
        if self._addon(aid) is None:
            return None
        try:
            with open(xbmcvfs.translatePath('special://profile/addon_data/%s/settings.xml' % aid), encoding='utf-8') as f:
                return settings_map(f.read())
        except (OSError, UnicodeDecodeError):
            return {}

    def set_setting(self, aid, key, value):
        a = self._addon(aid)
        if a is None or not isinstance(value, str):
            return False
        try:
            a.setSetting(key, value)
            return True
        except Exception:
            return False

    def file(self, name):
        from .common import load
        return load(name, None)

    def put_file(self, name, obj):
        from .common import save
        save(name, obj)

    def _mine(self):
        from . import cloudsync
        for it in cloudsync.engine('cloud_list', 60) or []:
            if (it.get('note') or {}).get('device') == DOC_DEVICE:
                return it
        return None

    def cloud_mark(self):
        it = self._mine()
        return '%s:%s' % (it['id'], it.get('date')) if it else ''

    def cloud_get(self):
        import base64
        import io
        import json
        import zipfile
        from . import cloudsync
        it = self._mine()
        if not it:
            return None
        raw = base64.b64decode(cloudsync.engine('cloud_get', 120, id=it['id'])['data'])
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            return json.loads(z.read('sync.json').decode('utf-8'))

    def cloud_put(self, doc):
        import base64
        import io
        import json
        import zipfile
        from . import cloudsync
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('sync.json', json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
        res = cloudsync.engine('cloud_put', 180, data=base64.b64encode(buf.getvalue()).decode('ascii'), device=DOC_DEVICE,
                               name='TeleNova sync', build='', fp='')
        return '%s:%s' % (res.get('id'), res.get('date')) if res and res.get('id') else ''


def is_on():
    from .common import load
    return load(FLAGS, {}).get('sync_on', True) is not False       # 4.1.0: on unless switched off


def set_on(on):
    from .common import load, save
    f = load(FLAGS, {})
    f['sync_on'] = bool(on)
    save(FLAGS, f)


def run_once(reason=''):
    """one round with the real host; never raises. -> the round's result or None when it could not run"""
    import xbmc
    import xbmcgui
    from . import cloudsync
    if xbmcgui.Window(10000).getProperty('NovaTV.restoring'):
        return None
    if not cloudsync.account_ready():
        return None
    try:
        res = cycle(KodiHost())
    except Exception as e:
        xbmc.log('[NovaTV] sync: %s: %s' % (type(e).__name__, str(e)[:120]), xbmc.LOGWARNING)
        return None
    if res['pulled'] or res['pushed'] or res['applied'] or res['data'] or res['users']:
        xbmc.log('[NovaTV] sync%s: %s%s%d setting(s)/file(s) taken, users %s, content of %d user(s) updated' % (
            ' (%s)' % reason if reason else '', 'fetched, ' if res['pulled'] else '', 'uploaded, ' if res['pushed'] else '',
            res['applied'], 'changed' if res['users'] else 'same', len(res['data'])), xbmc.LOGINFO)
    return res


def loop(mon):
    """the hub service's job: a round every PERIOD seconds, at once when a user was switched / created"""
    import xbmcgui
    win = xbmcgui.Window(10000)
    waited = PERIOD                      # the first round right away
    while not mon.abortRequested():
        if win.getProperty('bn.sync.now'):
            win.clearProperty('bn.sync.now')
            waited = PERIOD
        if waited >= PERIOD:
            waited = 0
            if is_on():
                run_once()
        if mon.waitForAbort(3):
            return
        waited += 3


def status():
    """('on' | 'off' | 'login', detail) for the services screen"""
    from . import cloudsync
    from .common import load
    if not is_on():
        return 'off', ''
    if not cloudsync.account_ready():
        return 'login', ''
    last = (load(META, {}) or {}).get('last')
    return 'on', time.strftime('%d/%m %H:%M', time.localtime(last)) if last else ''
