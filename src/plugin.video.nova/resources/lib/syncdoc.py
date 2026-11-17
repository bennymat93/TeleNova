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

Pure Python, no Kodi imports; tested in qa/t_syncdoc.py."""
import json
import re

VERSION = 2
MAX_HISTORY, MAX_SEARCHES, MAX_REMOVED = 500, 60, 1000


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
            if cur is None or (_num(pair[1]), canon(pair[0])) > (_num(cur[1]), canon(cur[0])):
                out[k] = [pair[0], _num(pair[1])]
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
    return {'v': VERSION, 'users': users, 'data': data, 'settings': settings,
            'files': merge_stamped(a.get('files'), b.get('files'))}


def same(a, b):
    """two documents hold the same content (who wrote them and when does not count)"""
    def core(d):
        d = d or empty()
        return canon({'users': d.get('users') or [], 'data': d.get('data') or {}, 'settings': d.get('settings') or {},
                      'files': d.get('files') or {}})
    return core(a) == core(b)


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
