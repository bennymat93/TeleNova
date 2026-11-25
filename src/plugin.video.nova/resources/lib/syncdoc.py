# -*- coding: utf-8 -*-
"""4.1.0: the one document every device of an account shares, and how two copies of it are merged.

Continuous sync without questions needs a rule for every kind of data, so that two devices that changed things at
the same time both keep their changes and always end with the same result (whatever the order of the merges):

  users        union by id; the newer name wins; a deleted user stays deleted (tombstone)
  history      union by title key, the later watch wins; entries older than a "clear history" are gone
  favourites   union by (kind, id); one removed after it was added stays removed (tombstones)
  searches     union by text, the later use wins; removed / cleared ones stay gone
  settings     per setting: the value that was changed last wins (every value carries the time of its change)
  files        whole small files (IPTV sources, source choices): the copy changed last wins
  resume       a resume point is part of the history entry it belongs to: 'progress': {'t': seconds, 'd': seconds}
               (d 0 = unknown), so "continue watching" travels with the entry (the later watch wins, as above).
               A device that keeps its own resume points folds them in with with_progress() and takes the account's
               out with progress_points(). Device-only things (the device profile, ...) are never in the document.

A value this device has never changed carries time 0 - so a freshly installed device takes everything from the
account and never pushes its empty defaults over a configured one.

6.3.0 (same document version 2, every addition is optional and passes through older copies of this code):
  any key       a top-level key this code does not know is kept (the larger canonical text wins) - so a later release
                can add a part without an older device dropping it; 'v' is the highest version seen
  devices       {device id: {'sv': sync level, 'kind', 'name', 'at'}} - which devices write the document and what they
                understand; the later 'at' wins
  keyed         {list: {item key: [item | None, time]}} - lists (Stremio servers, pinned chats, bots, IPTV lists,
                providers) merged item by item (None = removed), so two devices that add different items both keep
                them. The plain value in settings / files is kept as well ("flat"), for devices that do not know keyed.
                Written only while every device in 'devices' understands it (capable()).
  secrets       an optional envelope (syncseal.py) that holds the keys and tokens sealed with the owner's passphrase.

Pure Python, no Kodi imports; tested in qa/t_syncdoc.py."""
import json
import math
import re

VERSION = 2
LEVEL = 3                        # 6.3.0: the sync level of this code: unknown keys pass, devices, keyed lists, secrets
MAX_HISTORY, MAX_SEARCHES, MAX_REMOVED = 500, 60, 1000
KNOWN = ('v', 'users', 'data', 'settings', 'files', 'devices', 'keyed')
WHO = ('v', 'devices', 'device', 'stamp')     # who wrote a copy and when: never a difference of content (same())
DAY = 86400


def _when(v):
    """sortable key of 'dd/mm/YYYY HH:MM' or an ISO time ('' first) - the format the hub writes"""
    m = re.match(r'(\d{2})/(\d{2})/(\d{4})\s+(\d{2}):(\d{2})', v or '')
    if m:
        d, mo, y, h, mi = m.groups()
        return '%s-%s-%sT%s:%s' % (y, mo, d, h, mi)
    return v or ''


def _num(v):
    """a time as a number; whole numbers stay whole, so the same value is written the same way on every device"""
    try:
        f = float(v or 0)
    except (TypeError, ValueError):
        return 0
    return int(f) if f == int(f) else f


def stamp(v):
    """6.3.0: a change time as a whole number (floor), the same on every device (web: num() then Math.floor)"""
    try:
        f = float(v or 0)
    except (TypeError, ValueError):
        return 0
    if f != f or f in (float('inf'), float('-inf')):
        return 0
    return int(math.floor(f))


def canon(obj):
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


# ------------------------------------------------------------------ users
def merge_users(a, b):
    best = {}
    for u in list(a or []) + list(b or []):
        if not isinstance(u, dict) or not u.get('id'):
            continue
        new = {'id': str(u['id']), 'name': u.get('name') or '', 'created': _num(u.get('created')),
               'renamed': _num(u.get('renamed')), 'deleted': _num(u.get('deleted'))}
        cur = best.get(new['id'])
        if cur is None:
            best[new['id']] = new
            continue
        # the later rename wins; two renames in the same second: the same one everywhere
        if (new['renamed'], new['name']) > (cur['renamed'], cur['name']):
            cur['name'], cur['renamed'] = new['name'], new['renamed']
        cur['deleted'] = max(cur['deleted'], new['deleted'])
        cur['created'] = min(x for x in (cur['created'], new['created']) if x) if (cur['created'] or new['created']) else 0
    return sorted(best.values(), key=lambda u: (u['created'], u['id']))


def live_users(users):
    return [u for u in users or [] if not u.get('deleted')]


# ------------------------------------------------------------------ one user's content
def _history_ts(h):
    return _num(h.get('ts')) or 0.0


def merge_history(a, b, cleared=0):
    best = {}
    for h in list(a or []) + list(b or []):
        k = h.get('key') if isinstance(h, dict) else None
        if not k or (_history_ts(h) and _history_ts(h) <= cleared):
            continue
        cur = best.get(k)
        if cur is None or (_history_ts(h), _when(h.get('when')), canon(h)) > (_history_ts(cur), _when(cur.get('when')), canon(cur)):
            best[k] = h
    return sorted(best.values(), key=lambda h: (_history_ts(h), _when(h.get('when')), h['key']), reverse=True)[:MAX_HISTORY]


def progress_of(h):
    """(position, duration) of a history entry's resume point, or None"""
    p = h.get('progress') if isinstance(h, dict) else None
    if not isinstance(p, dict) or isinstance(p.get('t'), bool) or isinstance(p.get('d'), bool):
        return None
    t, d = int(_num(p.get('t'))), int(_num(p.get('d')))
    return (t, max(d, 0)) if t > 0 else None


def with_progress(history, points):
    """history + {key: {'t': s, 'd': s, 'at': ms}} -> history whose entries carry the newer resume points; an entry that
    takes one gets the point's time (whole seconds), so the point wins the merge on every device. Entries with no
    point, and points with no entry, are left alone."""
    out = []
    for h in history or []:
        k = h.get('key') if isinstance(h, dict) else None
        r = points.get(k) if isinstance(points, dict) and isinstance(k, str) else None
        if isinstance(r, dict) and not isinstance(r.get('t'), bool):
            at, t, d = int(_num(r.get('at')) // 1000), int(_num(r.get('t'))), int(_num(r.get('d')))
            if t > 0 and at > _history_ts(h):
                h = dict(h)
                h['progress'] = {'t': t, 'd': max(d, 0)}
                h['ts'] = at
        out.append(h)
    return out


def progress_points(history):
    """the resume points of a history list: {key: {'t': s, 'd': s, 'at': ms}} (the entry's time as 'at')"""
    out = {}
    for h in history or []:
        p = progress_of(h)
        if p and isinstance(h.get('key'), str):
            out[h['key']] = {'t': p[0], 'd': p[1], 'at': int(_history_ts(h) * 1000)}
    return out


def merge_removed(a, b):
    best = {}
    for r in list(a or []) + list(b or []):
        if not isinstance(r, dict):
            continue
        k = (r.get('kind'), str(r.get('id')))
        if k not in best or (_when(r.get('removed')), canon(r)) > (_when(best[k].get('removed')), canon(best[k])):
            best[k] = r
    return sorted(best.values(), key=lambda r: (_when(r.get('removed')), str(r.get('kind')), str(r.get('id'))),
                  reverse=True)[:MAX_REMOVED]


def merge_favourites(a, b, removed):
    gone = dict(((r.get('kind'), str(r.get('id'))), _when(r.get('removed'))) for r in removed or [])
    best = {}
    for f in list(a or []) + list(b or []):
        if not isinstance(f, dict):
            continue
        k = (f.get('kind'), str(f.get('id')))
        if k in gone and gone[k] >= _when(f.get('added')):
            continue
        if k not in best or (_when(f.get('added')), canon(f)) > (_when(best[k].get('added')), canon(best[k])):
            best[k] = f
    return sorted(best.values(), key=lambda f: (_when(f.get('added')), str(f.get('kind')), str(f.get('id'))), reverse=True)


def merge_searches(a, b, cleared=0, removed=None):
    removed = removed or {}
    best = {}
    for s in list(a or []) + list(b or []):
        if not isinstance(s, dict) or not s.get('q'):
            continue
        k = s['q'].strip().lower()
        ts = _num(s.get('ts'))
        if ts <= cleared or ts <= _num(removed.get(k)):
            continue
        if k not in best or (ts, canon(s)) > (_num(best[k].get('ts')), canon(best[k])):
            best[k] = s
    return sorted(best.values(), key=lambda s: (_num(s.get('ts')), s['q']), reverse=True)[:MAX_SEARCHES]


def merge_marks(a, b):
    """clear / remove marks of one user: the later time wins for each"""
    a, b = a or {}, b or {}
    out = {'history_cleared': max(_num(a.get('history_cleared')), _num(b.get('history_cleared'))),
           'searches_cleared': max(_num(a.get('searches_cleared')), _num(b.get('searches_cleared'))), 'searches_removed': {}}
    for src in (a.get('searches_removed') or {}, b.get('searches_removed') or {}):
        for k, ts in src.items():
            if _num(ts) > out['searches_cleared'] and _num(ts) > _num(out['searches_removed'].get(k)):
                out['searches_removed'][k] = _num(ts)
    if len(out['searches_removed']) > 300:
        keep = sorted(out['searches_removed'].items(), key=lambda kv: -kv[1])[:300]
        out['searches_removed'] = dict(keep)
    return out


def merge_user_data(a, b):
    a, b = a or {}, b or {}
    marks = merge_marks(a.get('marks'), b.get('marks'))
    removed = merge_removed(a.get('removed'), b.get('removed'))
    return {'history': merge_history(a.get('history'), b.get('history'), marks['history_cleared']),
            'removed': removed,
            'favourites': merge_favourites(a.get('favourites'), b.get('favourites'), removed),
            'searches': merge_searches(a.get('searches'), b.get('searches'), marks['searches_cleared'], marks['searches_removed']),
            'marks': marks}


# ------------------------------------------------------------------ settings and small files: last change wins
def merge_stamped(a, b):
    """{key: [value, time]} x2 -> the later one per key; equal times: the larger canonical text (any fixed rule
    will do - both devices must pick the same)"""
    out = {}
    for src in (a or {}, b or {}):
        for k, pair in src.items():
            if not (isinstance(pair, list) and len(pair) == 2):
                continue
            cur = out.get(k)
            ts = stamp(pair[1])                    # 6.3.0: whole seconds, as the web port writes them
            if cur is None or (ts, canon(pair[0])) > (cur[1], canon(cur[0])):
                out[k] = [pair[0], ts]
    return out


def stamp_changes(meta, current, now, first=0):
    """meta: {key: [value, time]} as last seen on this device (None = this device never looked before);
    current: {key: value} now -> new meta.
    At the very first look every value gets the time `first`: 0 on a device that joins an account which already
    has a document (unknown age: the account's value wins - a freshly installed device must not push its defaults),
    `now` on the device that founds the document (its values ARE the setup). After that, a value that changed here -
    or a key that appeared here - gets `now`."""
    first_look = meta is None
    out = dict((k, list(v)) for k, v in (meta or {}).items() if isinstance(v, list) and len(v) == 2)
    for k, v in (current or {}).items():
        if k not in out:
            out[k] = [v, first if first_look else now]
        elif canon(out[k][0]) != canon(v):
            out[k] = [v, now]
    return out


# ------------------------------------------------------------------ the whole document
def empty():
    return {'v': VERSION, 'users': [], 'data': {}, 'settings': {}, 'files': {}}


def merge_devices(a, b):
    """6.3.0: {id: entry} x2 -> per device the entry with the later 'at' (equal: the larger canonical text)"""
    out = {}
    for src in (a if isinstance(a, dict) else {}, b if isinstance(b, dict) else {}):
        for k, e in src.items():
            if not isinstance(e, dict):
                continue
            cur = out.get(k)
            if cur is None or (stamp(e.get('at')), canon(e)) > (stamp(cur.get('at')), canon(cur)):
                out[k] = e
    return out


def merge_keyed(a, b):
    """6.3.0: {list: {item key: [item | None, time]}} x2 -> item by item, the later change wins"""
    a, b = a if isinstance(a, dict) else {}, b if isinstance(b, dict) else {}
    out = {}
    for name in set(list(a.keys()) + list(b.keys())):
        la, lb = a.get(name), b.get(name)
        out[name] = merge_stamped(la if isinstance(la, dict) else {}, lb if isinstance(lb, dict) else {})
    return out


def capable(doc, level=LEVEL):
    """6.3.0: every device listed in the document understands sync level `level` (none listed: no)"""
    devs = (doc or {}).get('devices') if isinstance(doc, dict) else None
    if not isinstance(devs, dict) or not devs:
        return False
    return all(isinstance(e, dict) and stamp(e.get('sv')) >= level for e in devs.values())


def merge(a, b):
    a, b = a or empty(), b or empty()
    users = merge_users(a.get('users'), b.get('users'))
    dead = set(u['id'] for u in users if u.get('deleted'))
    data = {}
    for uid in set(list((a.get('data') or {}).keys()) + list((b.get('data') or {}).keys())):
        # a deleted user's content is not kept anywhere; content of a user this copy has not heard of yet is kept
        # (its entry in the user list arrives with another copy)
        if uid not in dead:
            data[uid] = merge_user_data((a.get('data') or {}).get(uid), (b.get('data') or {}).get(uid))
    settings = {}
    for aid in set(list((a.get('settings') or {}).keys()) + list((b.get('settings') or {}).keys())):
        settings[aid] = merge_stamped((a.get('settings') or {}).get(aid), (b.get('settings') or {}).get(aid))
    out = {'v': max(VERSION, stamp(a.get('v')), stamp(b.get('v'))), 'users': users, 'data': data, 'settings': settings,
           'files': merge_stamped(a.get('files'), b.get('files'))}
    devices = merge_devices(a.get('devices'), b.get('devices'))
    if devices:
        out['devices'] = devices
    keyed = merge_keyed(a.get('keyed'), b.get('keyed'))
    if keyed:
        out['keyed'] = keyed
    # 6.3.0 (B3): a part this code does not know passes through; both copies have it: the larger canonical text
    for k in set(list(a.keys()) + list(b.keys())):
        if k in KNOWN:
            continue
        if k not in a or k not in b:
            out[k] = a[k] if k in a else b[k]
        else:
            out[k] = a[k] if canon(a[k]) >= canon(b[k]) else b[k]
    return out


def same(a, b):
    """two documents hold the same content (who wrote them and when does not count; nor the list of devices, which
    only rides along with a write that happens anyway)"""
    def core(d):
        d = d or empty()
        out = {'users': d.get('users') or [], 'data': d.get('data') or {}, 'settings': d.get('settings') or {},
               'files': d.get('files') or {}}
        for k, v in d.items():
            if k not in out and k not in WHO and v not in (None, {}, []):
                out[k] = v
        return canon(out)
    return core(a) == core(b)


# ------------------------------------------------------------------ 6.3.0: keyed lists (P1)
TELE = 'plugin.video.telescope'
# name, section (an add-on id or 'files'), key, kind, argument
KEYED = (
    ('stremio', TELE, 'stremio_servers', 'text', '\n'),
    ('pins', TELE, 'pinned_chats', 'text', ','),
    ('bots', TELE, 'bots', 'text', ','),
    ('iptv', 'files', 'iptv.json', 'rows', 'm3u'),
    ('epg', 'files', 'iptv.json', 'rows', 'epg'),         # 6.5.0: the IPTV guide list (same plain value as iptv)
    ('providers', 'files', 'providers.json', 'map', ''),
)
MAX_TOMBS = 300


def _tok_key(arg, tok):
    return tok.lstrip('@').lower() if arg == ',' else tok


def items_of(spec, value):
    """the items of a list's plain value, in its order, each key once: [[key, item], ...]"""
    kind, arg = spec[3], spec[4]
    out, seen = [], set()

    def add(k, v):
        if k and k not in seen and v is not None:
            seen.add(k)
            out.append([k, v])
    if kind == 'text':
        if isinstance(value, str):
            for t in re.split(r'[\n,]+', value):
                t = t.strip()
                if t:
                    add(_tok_key(arg, t), t)
    elif kind == 'rows':
        part = value.get(arg) if isinstance(value, dict) else None
        for e in part if isinstance(part, list) else []:
            if isinstance(e, str):
                add(e.strip(), e)
            elif isinstance(e, dict) and isinstance(e.get('url'), str):
                add(e['url'].strip(), e)
    elif kind == 'map':
        if isinstance(value, dict):
            for k in sorted(value.keys()):
                add(k, value[k])
    return out


def flat_of(spec, items, base):
    kind, arg = spec[3], spec[4]
    if kind == 'text':
        return arg.join(v for _, v in items)
    if kind == 'rows':
        out = dict(base) if isinstance(base, dict) else {}
        if items or arg in out:                    # 6.5.0: an empty list the file never had is not added
            out[arg] = [v for _, v in items]
        return out
    return dict((k, v) for k, v in items)


def _section(doc, spec, make=False):
    if spec[1] == 'files':
        if make and not isinstance(doc.get('files'), dict):
            doc['files'] = {}
        return doc.get('files') if isinstance(doc.get('files'), dict) else None
    sett = doc.get('settings')
    if make:
        if not isinstance(sett, dict):
            sett = doc['settings'] = {}
        if not isinstance(sett.get(spec[1]), dict):
            sett[spec[1]] = {}
    return sett.get(spec[1]) if isinstance(sett, dict) and isinstance(sett.get(spec[1]), dict) else None


def flat_pair(doc, spec):
    sec = _section(doc or {}, spec)
    p = sec.get(spec[2]) if sec else None
    return p if isinstance(p, list) and len(p) == 2 else None


def keyed_ops(spec, last, value, ts):
    """what changed in a list on this device since it last held `last` ([[key, item], ...]): {key: [item | None, ts]}"""
    if not isinstance(last, list):
        return {}
    was = dict((p[0], p[1]) for p in last if isinstance(p, list) and len(p) == 2)
    now = items_of(spec, value)
    ops = {}
    for k, v in now:
        if k not in was or canon(was[k]) != canon(v):
            ops[k] = [v, ts]
    keys = set(k for k, _ in now)
    for k in was:
        if k not in keys:
            ops[k] = [None, ts]
    return ops


def settle(doc, spec):
    """after a merge: the keyed list and the plain value of one list agree again (doc is changed in place).
    A plain value newer than every item was written by a device that does not keep the keyed list: it is the whole
    truth at its time. Otherwise items of the plain value the keyed list never heard of are added (at the plain
    value's time). The plain value becomes the live items: its own order first, then the others by time.
    6.5.0: lists that share one plain value (iptv / epg in iptv.json) are settled together: a keyed device's change to
    either one stamps the plain value, so "newer than every item" looks at the items of all of them, as they were
    before any of them was settled (settling again is a no-op).
    -> [[key, item], ...] or None (no such list in the document)"""
    group = [s for s in KEYED if s[1] == spec[1] and s[2] == spec[2]] or [spec]
    if not any(s[0] == spec[0] for s in group):
        group.append(spec)
    keyed = doc.get('keyed') if isinstance(doc.get('keyed'), dict) else {}
    kmax = 0
    for s in group:
        S = keyed.get(s[0]) if isinstance(keyed.get(s[0]), dict) else {}
        kmax = max([kmax] + [stamp(p[1]) for p in S.values() if isinstance(p, list) and len(p) == 2])
    out = None
    for s in group:
        r = _settle(doc, s, kmax)
        if s[0] == spec[0]:
            out = r
    return out


def _settle(doc, spec, kmax):
    name = spec[0]
    keyed = doc.get('keyed') if isinstance(doc.get('keyed'), dict) else {}
    K = dict(keyed.get(name) or {}) if isinstance(keyed.get(name), dict) else {}
    K = dict((k, p) for k, p in K.items() if isinstance(p, list) and len(p) == 2)
    F = flat_pair(doc, spec)
    if F is None and not K:
        return None
    fval, fts = (F[0], stamp(F[1])) if F else (None, 0)
    fitems = items_of(spec, fval) if F else []
    fkeys = set(k for k, _ in fitems)
    if F is not None and fts > kmax:
        for k, v in fitems:
            cur = K.get(k)
            if cur is None or canon(cur[0]) != canon(v):
                K[k] = [v, fts]
        for k in list(K.keys()):
            if K[k][0] is not None and k not in fkeys:
                K[k] = [None, fts]
    else:
        for k, v in fitems:
            if k not in K:
                K[k] = [v, fts]
    K = dict((k, [p[0], stamp(p[1])]) for k, p in K.items())
    tombs = sorted([k for k, p in K.items() if p[0] is None], key=lambda k: (-K[k][1], k))
    for k in tombs[MAX_TOMBS:]:
        del K[k]
    live = dict((k, p[0]) for k, p in K.items() if p[0] is not None)
    order = [k for k, _ in fitems if k in live]
    order += sorted([k for k in live if k not in fkeys], key=lambda k: (K[k][1], k))
    items = [[k, live[k]] for k in order]
    new = flat_of(spec, items, fval)
    # never later than the newest item: a plain value newer than every item means "written by an older device"
    nts = max([fts] + [p[1] for p in K.values()])
    if not isinstance(doc.get('keyed'), dict):
        doc['keyed'] = {}
    doc['keyed'][name] = K
    _section(doc, spec, True)[spec[2]] = [new, nts]
    return items


def changed_settings(merged, current):
    """what must be written on this device: {addon id: {key: value}} where the merged value differs from the
    device's and really comes from a change (time > 0)"""
    out = {}
    for aid, keys in (merged or {}).items():
        cur = (current or {}).get(aid) or {}
        for k, (v, ts) in keys.items():
            if ts > 0 and canon(cur.get(k)) != canon(v):
                out.setdefault(aid, {})[k] = v
    return out
