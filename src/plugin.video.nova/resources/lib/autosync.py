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
import copy
import json
import math
import re
import time
import uuid

from . import syncdoc, syncseal, users

FLAGS = 'services.json'          # 'sync_on' (default: on)
META = 'sync_meta.json'          # this device only: what was last seen, with the times of the local changes
# 6.3.0: this device only, never synced: {'cats': {'lists', 'settings', 'files': bool}, 'pass': the owner's passphrase}
LOCAL_FILE = 'sync_local.json'
CATS = ('lists', 'settings', 'files')
MAX_SKEW = 7 * 86400             # 6.3.0 (L1): a learned clock offset larger than this is a broken sample
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


def skew_of(meta):
    """6.3.0 (L1): whole seconds this device's clock is behind the account's server (learned at each upload)"""
    s = (meta or {}).get('skew')
    return int(math.floor(s + 0.5)) if isinstance(s, (int, float)) and not isinstance(s, bool) and abs(s) <= MAX_SKEW else 0


def learn_skew(meta, t0, t1, mark):
    """an upload sent at t0 and answered at t1 (this device's clock) got the server's time in its mark ('id:date');
    the offset is smoothed (EMA); a slow answer (over 30 s) or an absurd offset is not a sample"""
    try:
        srv = float(str(mark).rsplit(':', 1)[1])
    except (IndexError, ValueError):
        return
    if not (0 <= t1 - t0 <= 30) or srv <= 0:
        return
    sample = srv - (t0 + t1) / 2.0
    if abs(sample) > MAX_SKEW:
        return
    old = meta.get('skew')
    meta['skew'] = round(sample if not isinstance(old, (int, float)) or isinstance(old, bool) else 0.7 * old + 0.3 * sample, 2)


def _restamp(pairs, k, R, now):
    """6.3.0 (L1): a key changed in this round gets a time after the account's time of the same key (a slow clock
    never loses a change; an account time more than a day ahead counts as a day ahead)"""
    p = pairs.get(k) if isinstance(pairs, dict) else None
    if not (isinstance(p, list) and len(p) == 2 and isinstance(R, list) and len(R) == 2):
        return None
    rts = syncdoc.stamp(R[1])
    if rts < syncdoc.stamp(p[1]):
        return None
    nts = min(rts, now + syncdoc.DAY) + 1
    if nts <= syncdoc.stamp(p[1]):
        return None
    pairs[k] = [p[0], nts]
    return nts


def norm_cats(c):
    c = c if isinstance(c, dict) else {}
    return dict((k, c.get(k, True) is not False) for k in CATS)


def cats_of(host):
    return norm_cats(host.cats() if hasattr(host, 'cats') else None)


def _cat(spec):
    return 'files' if spec[1] == 'files' else 'settings'


def cycle(host, now=None):
    """one round. host: see KodiHost. -> dict of what happened (for the log and the tests)"""
    now = int(now if now is not None else time.time())
    out = {'pulled': False, 'pushed': False, 'applied': 0, 'users': False, 'data': [], 'update': False, 'locked': False}
    meta = host.load_meta() or {}
    now += skew_of(meta)                       # 6.3.0 (L1): the account's clock, as learned
    cats = cats_of(host)
    pw = (host.passphrase() if hasattr(host, 'passphrase') else '') or ''
    mark = host.cloud_mark()
    founding = now if not mark else 0          # no document in the account yet: this device's setup founds it
    scrub(meta.get('last_doc'))
    last_doc = meta.get('last_doc') if isinstance(meta.get('last_doc'), dict) else {}
    # 1. the local document
    local = syncdoc.empty()
    if cats['lists']:
        local['users'] = host.users()
        for u in syncdoc.live_users(local['users']):
            local['data'][u['id']] = host.user_data(u['id'])
    else:                                      # 6.3.0 (P3): switched off here - the account's lists pass through
        local['users'] = copy.deepcopy(last_doc.get('users') or [])
        local['data'] = copy.deepcopy(last_doc.get('data') or {})
    current, fresh = {}, []                    # fresh: (add-on, key) changed here in this round
    for aid in ADDONS:
        vals = host.settings(aid)
        if vals is None:
            continue
        current[aid] = syncable(vals)
        seen = (meta.get('settings') or {}).get(aid)
        if isinstance(seen, dict):                 # 6.2.0: keys that became device-only (or session-like) leave the meta
            seen = dict((k, v) for k, v in seen.items() if not is_session(k) and not LOCAL.match(k))
        if not cats['settings']:
            if isinstance(seen, dict):
                meta.setdefault('settings', {})[aid] = seen
            continue                               # 6.3.0 (P3): the section comes from the last document below
        new = syncdoc.stamp_changes(seen, current[aid], now, founding)
        for k, p in new.items():
            if p[1] == now and now and (not isinstance(seen, dict) or k not in seen or syncdoc.canon(seen[k][0]) != syncdoc.canon(p[0])):
                fresh.append(('s', aid, k))
        meta.setdefault('settings', {})[aid] = new
        local['settings'][aid] = meta['settings'][aid]
    for part in ('settings', 'files'):          # 6.2.0: an older meta may still remember a session-like key
        if isinstance(meta.get(part), dict):
            scrub({part: meta[part]})
    files = dict((name, host.file(name)) for name in FILES if not is_session(name))
    files = dict((k, v) for k, v in files.items() if v is not None)
    if cats['files']:
        prev = meta.get('files') if 'files' in meta else None
        meta['files'] = syncdoc.stamp_changes(prev, files, now, founding)
        for k, p in meta['files'].items():
            if p[1] == now and now and (not isinstance(prev, dict) or k not in prev or syncdoc.canon(prev[k][0]) != syncdoc.canon(p[0])):
                fresh.append(('f', 'files', k))
                _restamp(meta['files'], k, (prev or {}).get(k), now)        # 6.3.0 (L1): after the stamp it replaces
    elif not isinstance(meta.get('files'), dict):
        meta['files'] = dict(last_doc.get('files') or {})
    # 6.3.0 (L1): a setting changed here goes after the account's stamp of it as last seen (else a slow clock loses its
    # own change to the copy of the account it carries below)
    for part, aid, k in fresh:
        if part == 's':
            _restamp(meta['settings'][aid], k, ((last_doc.get('settings') or {}).get(aid) or {}).get(k), now)
        else:
            _restamp(meta['files'], k, (last_doc.get('files') or {}).get(k), now)
    local['files'] = dict(meta['files'])
    # 6.3.0: what the last document had beyond the four parts (devices, keyed lists, the envelope, parts of a later
    # release) rides along - a round without a fetch must not put the document without them
    carried_extra = []
    for k, v in last_doc.items():
        if k not in ('users', 'data', 'settings', 'files', 'v'):
            local[k] = copy.deepcopy(v)
            carried_extra.append(k)
    # 6.3.0: this device in the list of devices (what it understands); the entry changes only when it does
    if not meta.get('device_id'):
        meta['device_id'] = uuid.uuid4().hex[:12]
    want = {'sv': syncdoc.LEVEL, 'kind': 'kodi', 'name': str(host.device_name() if hasattr(host, 'device_name') else '')[:40]}
    dev = meta.get('device')
    if not isinstance(dev, dict) or any(dev.get(k) != v for k, v in want.items()):
        dev = meta['device'] = dict(want, at=now)
    local['devices'] = dict(local.get('devices') or {})
    local['devices'][meta['device_id']] = dev
    # 6.2.0: sections this device does not own ("web" from the browser/apps, an add-on not installed here) come from
    # the last document seen, untouched - a round without a fetch must not re-put the document without them
    for aid, keys in (last_doc.get('settings') or {}).items():
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
    remote_as_is = json.loads(json.dumps(remote)) if remote is not None else None
    if remote is not None:
        # 6.3.0 (L1): a change of this round is stamped after the account's time of the same key
        for part, aid, k in fresh:
            R = ((remote.get('settings') or {}).get(aid) or {}).get(k) if part == 's' else (remote.get('files') or {}).get(k)
            nts = _restamp(local['settings'].get(aid) if part == 's' else local['files'], k, R, now)
            mine = meta['settings'][aid] if part == 's' else meta['files']
            if nts is not None and isinstance(mine.get(k), list):
                mine[k] = [mine[k][0], nts]
        out['update'] = syncdoc.stamp(remote.get('v')) > syncdoc.VERSION
        # 6.3.0: parts this code does not merge itself are the account's now - an old copy must not win over it
        for k in carried_extra:
            if k not in ('devices', 'keyed', 'secrets'):
                local.pop(k, None)
    elif meta.get('state') == 'update' and mark == meta.get('cloud_mark'):
        out['update'] = True                       # still the later release's document
    # 6.3.0 (P1): what changed in a keyed list here since this device last held it
    keyed_last = meta.get('keyed_last') if isinstance(meta.get('keyed_last'), dict) else {}
    for spec in syncdoc.KEYED:
        if not cats[_cat(spec)]:
            continue
        cur = (current.get(spec[1]) or {}).get(spec[2]) if spec[1] != 'files' else files.get(spec[2])
        lp = syncdoc.flat_pair(local, spec)
        if cur is None or lp is None:
            continue
        ops = syncdoc.keyed_ops(spec, keyed_last.get(spec[0]), cur, syncdoc.stamp(lp[1]))
        if ops:
            local['keyed'] = dict(local.get('keyed') or {})
            local['keyed'][spec[0]] = dict(local['keyed'].get(spec[0]) or {}, **ops)
    # 6.3.0 (P2): open the envelopes this device can open; one it cannot stays untouched
    envs = {}
    for name, d in (('local', local), ('remote', remote)):
        if d is not None and d.get('secrets') is not None:
            opened = syncseal.open_env(d['secrets'], pw)
            if opened is None:
                if name == 'local' and remote is not None:
                    del d['secrets']                   # the account's envelope (or none) is the newer one
                continue
            envs[name] = d.pop('secrets')
            for aid, keys in opened.items():
                if isinstance(keys, dict):
                    d.setdefault('settings', {})[aid] = syncdoc.merge_stamped(d['settings'].get(aid), keys)
    # 3. merge
    merged = syncdoc.merge(local, remote)        # (with nothing fetched this only puts the local copy in its normal form)
    out['locked'] = merged.get('secrets') is not None          # an envelope this device could not open is left as is
    keyed_on = syncdoc.capable(merged)
    if keyed_on:
        for spec in syncdoc.KEYED:
            items = syncdoc.settle(merged, spec)
            if items is not None and cats[_cat(spec)]:
                keyed_last[spec[0]] = items
        meta['keyed_last'] = keyed_last
    else:
        merged.pop('keyed', None)
    # 4. bring the merge here
    if remote is not None:
        if cats['lists'] and host.set_users(merged['users']):
            out['users'] = True
        for uid, data in (merged['data'] if cats['lists'] else {}).items():
            wrote = host.put_user_data(uid, data)
            if wrote:
                out['data'].append(uid)
        for aid, keys in (syncdoc.changed_settings(merged['settings'], current) if cats['settings'] else {}).items():
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
        for name, (obj, ts) in (merged['files'] if cats['files'] else {}).items():
            # 6.2.0: only the known files are written to disk; a file another peer added passes through untouched
            if name in FILES and ts > 0 and syncdoc.canon(files.get(name)) != syncdoc.canon(obj):
                host.put_file(name, obj)
                out['applied'] += 1
            meta['files'][name] = [obj, ts]
    # 6.3.0 (P2): the keys and tokens travel sealed - with this device's passphrase when it can open the envelope (or
    # there is none yet); with an envelope it cannot open, its own keys are never put in plain text next to it
    # an envelope this device opened is always sealed again (same salt), even while an older device keeps the account
    # below sync level 3 - otherwise the opened keys would go up in plain settings and the envelope would be lost
    if out['locked'] or envs or (pw and keyed_on):
        secret = syncseal.take_secrets(merged['settings'])
        if not out['locked']:
            base = envs.get('remote') or envs.get('local')
            merged['secrets'] = syncseal.seal(secret, pw, syncseal.salt_of(base) if base else None)
    # 5. upload when this device has something the account does not
    if remote is None and mark:
        need = bool(meta.get('dirty')) or not syncdoc.same(merged, meta.get('last_doc'))
    else:
        need = remote is None or not syncdoc.same(merged, remote_as_is)
    if out['update']:
        need = False                               # 6.3.0 (B3): written by a later release - read only until updated
    if need:
        t0 = host.clock() if hasattr(host, 'clock') else None
        new_mark = host.cloud_put(merged)
        if new_mark:
            out['pushed'] = True
            mark = new_mark
            meta['dirty'] = False
            if t0 is not None:
                learn_skew(meta, t0, host.clock(), new_mark)
        else:
            meta['dirty'] = True
    meta['cloud_mark'] = mark
    meta['last_doc'] = dict((k, v) for k, v in merged.items() if k != 'v')
    meta['state'] = 'update' if out['update'] else 'locked' if out['locked'] else ''
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

    def clock(self):
        return time.time()

    def device_name(self):
        import xbmc
        try:
            return xbmc.getInfoLabel('System.FriendlyName') or 'Kodi'
        except Exception:
            return 'Kodi'

    def cats(self):
        return local_get().get('cats')

    def passphrase(self):
        p = local_get().get('pass')
        return p if isinstance(p, str) else ''

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


def local_get():
    """6.3.0: this device's own sync choices (categories, passphrase) - never synced"""
    from .common import load
    v = load(LOCAL_FILE, {})
    return v if isinstance(v, dict) else {}


def local_set(**kw):
    from .common import save
    v = local_get()
    for k, x in kw.items():
        if x is None:
            v.pop(k, None)
        else:
            v[k] = x
    save(LOCAL_FILE, v)


def devices():
    """6.3.0: the devices of the last document seen: [(id, entry, is this device)], newest first"""
    from .common import load
    meta = load(META, {}) or {}
    devs = ((meta.get('last_doc') or {}).get('devices') or {})
    me = meta.get('device_id')
    rows = [(k, e, k == me) for k, e in devs.items() if isinstance(e, dict)]
    return sorted(rows, key=lambda r: -syncdoc.stamp(r[1].get('at')))


def is_on():
    from .common import load
    return load(FLAGS, {}).get('sync_on', True) is not False       # 4.1.0: on unless switched off


def set_on(on):
    from .common import load, save
    f = load(FLAGS, {})
    f['sync_on'] = bool(on)
    save(FLAGS, f)


def switch_settled(root=None, now=None):
    """6.5.1: False while a user switch is under way (users.store_switch) - a round then would read one user's lists
    under the other's name. A switch that has been waiting for 30 s was cut: it is finished here first."""
    from . import users
    try:
        root = root or users._root()
        age = users.store_switch_age(root, now)
        if age is None:
            return True
        if age <= 30:
            return False
        users.store_recover(root)
        return users.store_switch_age(root, now) is None
    except Exception:
        return False


def run_once(reason=''):
    """one round with the real host; never raises. -> the round's result or None when it could not run"""
    import xbmc
    import xbmcgui
    from . import cloudsync
    if xbmcgui.Window(10000).getProperty('NovaTV.restoring'):
        return None
    if not cloudsync.account_ready():
        return None
    if not switch_settled():
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
    meta = load(META, {}) or {}
    last = meta.get('last')
    if meta.get('state') in ('update', 'locked'):
        return meta['state'], ''               # 6.3.0: a later release's document / an envelope this device cannot open
    return 'on', time.strftime('%d/%m %H:%M', time.localtime(last)) if last else ''
