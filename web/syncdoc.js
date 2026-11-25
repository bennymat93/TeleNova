'use strict';
// The shared document of an account and how two copies of it are merged: a faithful port of the build's
// src/plugin.video.nova/resources/lib/syncdoc.py (THE specification - read its header for the rules).
// Every device, Kodi or browser, must end with byte-identical canonical text, so the details matter:
//   * canon() writes exactly what Python's json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
//     writes: keys sorted by code point, ints as ints, floats as Python's repr() writes them;
//   * JSON read by JSON.parse() loses the difference between 5 and 5.0, so documents are read with parse() below,
//     which keeps a whole-valued float as a PyFloat (anything else is an ordinary JS value);
//   * strings are compared by code point (Python), never by UTF-16 unit (JS's < and >).
// Pure: no DOM, no storage, no network. Runs in the browser (window.SyncDoc) and in Node (require). Tested against
// the Python original in src/qa/web/.
(function (root) {
  const VERSION = 2, LEVEL = 3, MAX_HISTORY = 500, MAX_SEARCHES = 60, MAX_REMOVED = 1000, DAY = 86400, MAX_TOMBS = 300;
  // 6.3.0: the parts this code merges by their own rule; any other top-level part passes through (syncdoc.py KNOWN)
  const KNOWN = ['v', 'users', 'data', 'settings', 'files', 'devices', 'keyed'];
  const WHO = ['v', 'devices', 'device', 'stamp'];
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const dict = () => Object.create(null);          // a map whose keys come from other devices ("__proto__" is a key like any other)

  // ---------------------------------------------------------------- Python's values in JS
  class PyFloat {                                  // a float with a whole value (5.0, 1e+16, -0.0): JS alone cannot tell it from an int
    constructor(v) { this.v = v; }
    valueOf() { return this.v; }
    toJSON() { return this.v; }
  }
  const isDict = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && !(x instanceof PyFloat);
  const asDict = (x) => (isDict(x) ? x : dict());
  const asList = (x) => (Array.isArray(x) ? x : []);
  const get = (o, k) => (isDict(o) && has(o, k) ? o[k] : undefined);
  function truthy(x) {                             // Python's truth of a JSON value
    if (x === null || x === undefined || x === false || x === 0 || x === '' || x === 0n) return false;
    if (x instanceof PyFloat) return x.v !== 0;
    if (Array.isArray(x)) return x.length > 0;
    if (typeof x === 'object') return Object.keys(x).length > 0;
    return true;
  }

  function floatRepr(x) {                          // Python's repr(float)
    if (x !== x) return 'NaN';
    if (x === Infinity) return 'Infinity';
    if (x === -Infinity) return '-Infinity';
    if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
    const [m, e] = Math.abs(x).toExponential().split('e');      // the shortest digits that read back as x (as Python)
    const digits = m.replace('.', ''), decpt = Number(e) + 1;   // x = 0.<digits> * 10^decpt
    let out;
    if (decpt > -4 && decpt <= 16) {
      if (decpt <= 0) out = '0.' + '0'.repeat(-decpt) + digits;
      else if (decpt >= digits.length) out = digits + '0'.repeat(decpt - digits.length) + '.0';
      else out = digits.slice(0, decpt) + '.' + digits.slice(decpt);
    } else {
      const e2 = decpt - 1;
      out = digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '') + 'e' + (e2 < 0 ? '-' : '+') + String(Math.abs(e2)).padStart(2, '0');
    }
    return (x < 0 ? '-' : '') + out;
  }
  function numRepr(n) {                            // a plain JS number: whole = a Python int, anything else = a float
    if (Number.isInteger(n)) return Number.isSafeInteger(n) ? String(n === 0 ? 0 : n) : BigInt(n).toString();   // exact digits, as a Python int
    return floatRepr(n);
  }

  // code point order (Python compares strings this way; JS compares UTF-16 units, which differs above U+FFFF)
  function cmpStr(a, b) {
    if (a === b) return 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      let x = a.charCodeAt(i), y = b.charCodeAt(i);
      if (x !== y) {
        if (x >= 0xD800 && y >= 0xD800) {          // surrogates stand for U+10000 and above: after U+E000..U+FFFF
          x += x >= 0xE000 ? -0x800 : 0x2000;
          y += y >= 0xE000 ? -0x800 : 0x2000;
        }
        return x < y ? -1 : 1;
      }
    }
    return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
  }
  const cmpNum = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  function cmpAny(a, b) {                          // one element of a Python tuple comparison
    const isNum = (x) => typeof x === 'number' || typeof x === 'bigint' || x instanceof PyFloat;
    const na = isNum(a), nb = isNum(b);
    if (na && nb) return cmpNum(Number(a), Number(b));
    if (typeof a === 'string' && typeof b === 'string') return cmpStr(a, b);
    return cmpStr(canon(a), canon(b));             // (Python refuses to compare mixed types; any fixed order will do)
  }
  function cmpTuple(a, b) {
    for (let i = 0; i < a.length; i++) { const c = cmpAny(a[i], b[i]); if (c) return c; }
    return 0;
  }

  function canon(o) {
    if (o === null || o === undefined) return 'null';
    switch (typeof o) {
      case 'boolean': return o ? 'true' : 'false';
      case 'number': return numRepr(o);
      case 'string': return JSON.stringify(o);
      case 'bigint': return o.toString();
      case 'object': {
        if (o instanceof PyFloat) return floatRepr(o.v);
        if (Array.isArray(o)) { let s = '['; for (let i = 0; i < o.length; i++) s += (i ? ',' : '') + canon(o[i]); return s + ']'; }
        const keys = Object.keys(o).sort(cmpStr);
        let s = '{';
        for (let i = 0; i < keys.length; i++) s += (i ? ',' : '') + JSON.stringify(keys[i]) + ':' + canon(o[keys[i]]);
        return s + '}';
      }
      default: return 'null';
    }
  }

  // JSON text -> values, keeping what canon() needs (whole floats) and safe against any key
  const NUM = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
  function parse(text) {
    let i = 0;
    const n = text.length;
    const fail = () => { throw new SyntaxError('bad JSON at ' + i); };
    const ws = () => { while (i < n) { const c = text.charCodeAt(i); if (c === 32 || c === 10 || c === 13 || c === 9) i++; else break; } };
    function value() {
      ws();
      const c = text[i];
      if (c === '{') {
        const o = dict();
        i++; ws();
        if (text[i] === '}') { i++; return o; }
        for (;;) {
          ws();
          if (text[i] !== '"') fail();
          const k = string();
          ws();
          if (text[i] !== ':') fail();
          i++;
          o[k] = value();
          ws();
          if (text[i] === ',') { i++; continue; }
          if (text[i] === '}') { i++; return o; }
          fail();
        }
      }
      if (c === '[') {
        const a = [];
        i++; ws();
        if (text[i] === ']') { i++; return a; }
        for (;;) {
          a.push(value());
          ws();
          if (text[i] === ',') { i++; continue; }
          if (text[i] === ']') { i++; return a; }
          fail();
        }
      }
      if (c === '"') return string();
      if (text.startsWith('true', i)) { i += 4; return true; }
      if (text.startsWith('false', i)) { i += 5; return false; }
      if (text.startsWith('null', i)) { i += 4; return null; }
      if (text.startsWith('NaN', i)) { i += 3; return NaN; }                       // Python writes these three
      if (text.startsWith('Infinity', i)) { i += 8; return Infinity; }
      if (text.startsWith('-Infinity', i)) { i += 9; return -Infinity; }
      NUM.lastIndex = i;
      const m = NUM.exec(text);
      if (!m) fail();
      i = NUM.lastIndex;
      const v = Number(m[0]);
      if (m[1] || m[2]) return Number.isInteger(v) ? new PyFloat(v) : v;
      return Number.isSafeInteger(v) ? v : BigInt(m[0]);            // an int too large for a JS number keeps its digits
    }
    function string() {
      let j = i + 1;
      for (;;) {
        const c = text.charCodeAt(j);
        if (c === 34) break;
        if (c === 92) j++;
        if (j >= n || c !== c) fail();
        j++;
      }
      const raw = text.slice(i, j + 1);
      i = j + 1;
      return raw.indexOf('\\') < 0 ? raw.slice(1, -1) : JSON.parse(raw);
    }
    const v = value();
    ws();
    if (i < n) fail();
    return v;
  }
  const copy = (o) => parse(canon(o));

  // ---------------------------------------------------------------- the helpers of syncdoc.py
  const WS = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';   // Python's str.isspace()
  const WHEN = new RegExp('^(\\p{Nd}{2})/(\\p{Nd}{2})/(\\p{Nd}{4})' + WS + '+(\\p{Nd}{2}):(\\p{Nd}{2})', 'u');
  const STRIP = new RegExp('^' + WS + '+|' + WS + '+$', 'g');
  const strip = (s) => s.replace(STRIP, '');
  const PYFLOAT = /^[+-]?(?:\d+(?:_\d+)*\.?(?:\d+(?:_\d+)*)?|\.\d+(?:_\d+)*)(?:[eE][+-]?\d+(?:_\d+)*)?$/;

  function when(v) {                               // sortable key of 'dd/mm/YYYY HH:MM' or an ISO time ('' first)
    if (typeof v !== 'string') return '';
    const m = WHEN.exec(v);
    return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}` : v;
  }
  function num(v) {                                // a time as a number; whole numbers stay whole
    let f = 0;
    if (typeof v === 'number') f = v;
    else if (v instanceof PyFloat) f = v.v;
    else if (typeof v === 'bigint') f = Number(v);
    else if (v === true) f = 1;
    else if (typeof v === 'string') { const s = strip(v); f = PYFLOAT.test(s) ? Number(s.replace(/_/g, '')) : 0; }
    return f === f && Math.abs(f) !== Infinity ? f : 0;
  }
  function stamp(v) {                              // 6.3.0: a change time as a whole number (syncdoc.py stamp)
    if (v === false || v === null || v === undefined || v === '') return 0;
    const f = Math.floor(num(v));
    return f === 0 ? 0 : f;
  }
  function pyStr(v) {                              // Python's str() of a JSON value
    if (typeof v === 'string') return v;
    if (v === null || v === undefined) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    if (typeof v === 'number') return numRepr(v);
    if (v instanceof PyFloat) return floatRepr(v.v);
    return canon(v);
  }
  const keyOf = (k) => (typeof k === 'string' ? 's' + k : typeof k === 'number' || typeof k === 'bigint' || k instanceof PyFloat || typeof k === 'boolean' ? 'n' + Number(k) : 'o' + canon(k));
  const pairKey = (o) => keyOf(get(o, 'kind') ?? null) + '\u0000' + pyStr(get(o, 'id'));
  const desc = (f) => (x, y) => -f(x, y);          // sorted(..., reverse=True): equal items keep their order, as in Python

  // ---------------------------------------------------------------- users
  function merge_users(a, b) {
    const best = new Map();
    for (const u of asList(a).concat(asList(b))) {
      if (!isDict(u) || !truthy(get(u, 'id'))) continue;
      const name = get(u, 'name');
      const nw = {id: pyStr(u.id), name: truthy(name) ? name : '', created: num(get(u, 'created')), renamed: num(get(u, 'renamed')), deleted: num(get(u, 'deleted'))};
      const cur = best.get(nw.id);
      if (!cur) { best.set(nw.id, nw); continue; }
      // the later rename wins; two renames in the same second: the same one everywhere
      if (cmpTuple([nw.renamed, nw.name], [cur.renamed, cur.name]) > 0) { cur.name = nw.name; cur.renamed = nw.renamed; }
      cur.deleted = nw.deleted > cur.deleted ? nw.deleted : cur.deleted;
      cur.created = (cur.created || nw.created) ? Math.min(...[cur.created, nw.created].filter((x) => x)) : 0;
    }
    return [...best.values()].sort((x, y) => cmpNum(x.created, y.created) || cmpStr(x.id, y.id));
  }
  const live_users = (users) => asList(users).filter((u) => !truthy(get(u, 'deleted')));

  // ---------------------------------------------------------------- one user's content
  const hts = (h) => num(get(h, 'ts')) || 0;
  function merge_history(a, b, cleared = 0) {
    const best = new Map();
    for (const h of asList(a).concat(asList(b))) {
      const k = isDict(h) ? get(h, 'key') : null;
      if (!truthy(k) || (hts(h) && hts(h) <= cleared)) continue;
      const cur = best.get(keyOf(k));
      if (!cur || cmpTuple([hts(h), when(get(h, 'when')), canon(h)], [hts(cur), when(get(cur, 'when')), canon(cur)]) > 0) best.set(keyOf(k), h);
    }
    return [...best.values()].sort(desc((x, y) => cmpTuple([hts(x), when(get(x, 'when')), x.key], [hts(y), when(get(y, 'when')), y.key]))).slice(0, MAX_HISTORY);
  }
  // resume points live inside the history entry they belong to: 'progress': {t: seconds, d: seconds} (syncdoc.py header)
  const isBool = (x) => typeof x === 'boolean';
  function progress_of(h) {                        // [position, duration] of a history entry's resume point, or null
    const p = isDict(h) ? get(h, 'progress') : undefined;
    if (!isDict(p) || isBool(get(p, 't')) || isBool(get(p, 'd'))) return null;
    const t = Math.trunc(num(get(p, 't'))), d = Math.trunc(num(get(p, 'd')));
    return t > 0 ? [t, Math.max(d, 0)] : null;
  }
  function with_progress(history, points) {        // history + {key: {t, d, at (ms)}} -> entries carrying the newer points
    const out = [];
    for (let h of asList(history)) {
      const k = isDict(h) ? get(h, 'key') : undefined;
      const r = isDict(points) && typeof k === 'string' ? get(points, k) : undefined;
      if (isDict(r) && !isBool(get(r, 't'))) {
        const at = Math.trunc(Math.floor(num(get(r, 'at')) / 1000)), t = Math.trunc(num(get(r, 't'))), d = Math.trunc(num(get(r, 'd')));
        if (t > 0 && at > hts(h)) {
          const c = dict();
          for (const x of Object.keys(h)) c[x] = h[x];
          c.progress = {t, d: Math.max(d, 0)};
          c.ts = at;
          h = c;
        }
      }
      out.push(h);
    }
    return out;
  }
  function progress_points(history) {              // the resume points of a history list: {key: {t, d, at (ms)}}
    const out = dict();
    for (const h of asList(history)) {
      const p = progress_of(h);
      if (p && typeof get(h, 'key') === 'string') out[h.key] = {t: p[0], d: p[1], at: Math.trunc(hts(h) * 1000)};
    }
    return out;
  }
  function merge_removed(a, b) {
    const best = new Map();
    for (const r of asList(a).concat(asList(b))) {
      if (!isDict(r)) continue;
      const k = pairKey(r), cur = best.get(k);
      if (!cur || cmpTuple([when(get(r, 'removed')), canon(r)], [when(get(cur, 'removed')), canon(cur)]) > 0) best.set(k, r);
    }
    const key = (r) => [when(get(r, 'removed')), pyStr(get(r, 'kind')), pyStr(get(r, 'id'))];
    return [...best.values()].sort(desc((x, y) => cmpTuple(key(x), key(y)))).slice(0, MAX_REMOVED);
  }
  function merge_favourites(a, b, removed) {
    const gone = new Map();
    for (const r of asList(removed)) if (isDict(r)) gone.set(pairKey(r), when(get(r, 'removed')));
    const best = new Map();
    for (const f of asList(a).concat(asList(b))) {
      if (!isDict(f)) continue;
      const k = pairKey(f);
      if (gone.has(k) && cmpStr(gone.get(k), when(get(f, 'added'))) >= 0) continue;
      const cur = best.get(k);
      if (!cur || cmpTuple([when(get(f, 'added')), canon(f)], [when(get(cur, 'added')), canon(cur)]) > 0) best.set(k, f);
    }
    const key = (f) => [when(get(f, 'added')), pyStr(get(f, 'kind')), pyStr(get(f, 'id'))];
    return [...best.values()].sort(desc((x, y) => cmpTuple(key(x), key(y))));
  }
  const searchKey = (q) => strip(q).toLowerCase();
  function merge_searches(a, b, cleared = 0, removed = null) {
    removed = asDict(removed);
    const best = new Map();
    for (const s of asList(a).concat(asList(b))) {
      if (!isDict(s) || typeof get(s, 'q') !== 'string' || !s.q) continue;
      const k = searchKey(s.q), ts = num(get(s, 'ts'));
      if (ts <= cleared || ts <= num(get(removed, k))) continue;
      const cur = best.get(k);
      if (!cur || cmpTuple([ts, canon(s)], [num(get(cur, 'ts')), canon(cur)]) > 0) best.set(k, s);
    }
    return [...best.values()].sort(desc((x, y) => cmpTuple([num(get(x, 'ts')), x.q], [num(get(y, 'ts')), y.q]))).slice(0, MAX_SEARCHES);
  }
  function merge_marks(a, b) {                     // clear / remove marks of one user: the later time wins for each
    a = asDict(a); b = asDict(b);
    const out = {history_cleared: Math.max(num(get(a, 'history_cleared')), num(get(b, 'history_cleared'))),
                 searches_cleared: Math.max(num(get(a, 'searches_cleared')), num(get(b, 'searches_cleared'))), searches_removed: dict()};
    for (const src of [asDict(get(a, 'searches_removed')), asDict(get(b, 'searches_removed'))]) {
      for (const k of Object.keys(src)) {
        const ts = num(src[k]);
        if (ts > out.searches_cleared && ts > num(get(out.searches_removed, k))) out.searches_removed[k] = ts;
      }
    }
    const keys = Object.keys(out.searches_removed);
    if (keys.length > 300) {
      const keep = keys.map((k) => [k, out.searches_removed[k]]).sort((x, y) => cmpNum(-x[1], -y[1])).slice(0, 300);
      out.searches_removed = dict();
      for (const [k, v] of keep) out.searches_removed[k] = v;
    }
    return out;
  }
  function merge_user_data(a, b) {
    a = asDict(a); b = asDict(b);
    const marks = merge_marks(get(a, 'marks'), get(b, 'marks'));
    const removed = merge_removed(get(a, 'removed'), get(b, 'removed'));
    return {history: merge_history(get(a, 'history'), get(b, 'history'), marks.history_cleared),
            removed,
            favourites: merge_favourites(get(a, 'favourites'), get(b, 'favourites'), removed),
            searches: merge_searches(get(a, 'searches'), get(b, 'searches'), marks.searches_cleared, marks.searches_removed),
            marks};
  }

  // ---------------------------------------------------------------- settings and small files: last change wins
  const isPair = (p) => Array.isArray(p) && p.length === 2;
  function merge_stamped(a, b) {                   // {key: [value, time]} x2 -> the later one per key; equal times: the larger canonical text
    const out = dict();
    for (const src of [asDict(a), asDict(b)]) {
      for (const k of Object.keys(src)) {
        const pair = src[k];
        if (!isPair(pair)) continue;
        const cur = has(out, k) ? out[k] : null, ts = stamp(pair[1]);     // 6.3.0: whole seconds (B6)
        if (!cur || cmpTuple([ts, canon(pair[0])], [cur[1], canon(cur[0])]) > 0) out[k] = [pair[0], ts];
      }
    }
    return out;
  }
  function stamp_changes(meta, current, now, first = 0) {
    const firstLook = meta === null || meta === undefined;
    const out = dict();
    for (const k of Object.keys(asDict(meta))) if (isPair(meta[k])) out[k] = [meta[k][0], meta[k][1]];
    current = asDict(current);
    for (const k of Object.keys(current)) {
      if (!has(out, k)) out[k] = [current[k], firstLook ? first : now];
      else if (canon(out[k][0]) !== canon(current[k])) out[k] = [current[k], now];
    }
    return out;
  }

  // ---------------------------------------------------------------- the whole document
  const empty = () => ({v: VERSION, users: [], data: dict(), settings: dict(), files: dict()});
  function merge(a, b) {
    a = truthy(a) ? a : empty(); b = truthy(b) ? b : empty();
    const users = merge_users(get(a, 'users'), get(b, 'users'));
    const dead = new Set(users.filter((u) => u.deleted).map((u) => u.id));
    const da = asDict(get(a, 'data')), db = asDict(get(b, 'data')), data = dict();
    // a deleted user's content is not kept anywhere; content of a user this copy has not heard of yet is kept
    for (const uid of new Set(Object.keys(da).concat(Object.keys(db)))) if (!dead.has(uid)) data[uid] = merge_user_data(get(da, uid), get(db, uid));
    const sa = asDict(get(a, 'settings')), sb = asDict(get(b, 'settings')), settings = dict();
    for (const aid of new Set(Object.keys(sa).concat(Object.keys(sb)))) settings[aid] = merge_stamped(get(sa, aid), get(sb, aid));
    const out = {v: Math.max(VERSION, stamp(get(a, 'v')), stamp(get(b, 'v'))), users, data, settings, files: merge_stamped(get(a, 'files'), get(b, 'files'))};
    const devices = merge_devices(get(a, 'devices'), get(b, 'devices'));
    if (Object.keys(devices).length) out.devices = devices;
    const keyed = merge_keyed(get(a, 'keyed'), get(b, 'keyed'));
    if (Object.keys(keyed).length) out.keyed = keyed;
    // 6.3.0 (B3): a part this code does not know passes through; both copies have it: the larger canonical text
    for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) {
      if (KNOWN.includes(k)) continue;
      if (!has(a, k) || !has(b, k)) out[k] = has(a, k) ? a[k] : b[k];
      else out[k] = cmpStr(canon(a[k]), canon(b[k])) >= 0 ? a[k] : b[k];
    }
    return out;
  }
  // 6.3.0: {id: {sv, kind, name, at}} x2 -> per device the entry with the later 'at'
  function merge_devices(a, b) {
    const out = dict();
    for (const src of [asDict(a), asDict(b)]) {
      for (const k of Object.keys(src)) {
        const e = src[k];
        if (!isDict(e)) continue;
        const cur = has(out, k) ? out[k] : null;
        if (!cur || cmpTuple([stamp(get(e, 'at')), canon(e)], [stamp(get(cur, 'at')), canon(cur)]) > 0) out[k] = e;
      }
    }
    return out;
  }
  function merge_keyed(a, b) {                     // 6.3.0: {list: {item key: [item | null, time]}} x2, item by item
    a = asDict(a); b = asDict(b);
    const out = dict();
    for (const n of new Set(Object.keys(a).concat(Object.keys(b)))) out[n] = merge_stamped(asDict(a[n]), asDict(b[n]));
    return out;
  }
  function capable(doc, level = LEVEL) {           // 6.3.0: every device listed understands sync level `level`
    const devs = get(doc, 'devices');
    if (!isDict(devs) || !Object.keys(devs).length) return false;
    return Object.keys(devs).every((k) => isDict(devs[k]) && stamp(get(devs[k], 'sv')) >= level);
  }
  function same(a, b) {                            // two documents hold the same content (who wrote them and when does not count)
    const core = (d) => {
      d = truthy(d) ? d : empty();
      const or = (v, e) => (truthy(v) ? v : e);
      const out = {users: or(get(d, 'users'), []), data: or(get(d, 'data'), {}), settings: or(get(d, 'settings'), {}), files: or(get(d, 'files'), {})};
      for (const k of Object.keys(d)) {
        const v = d[k];
        if (has(out, k) || WHO.includes(k) || v === null || v === undefined) continue;
        if ((isDict(v) || Array.isArray(v)) && !Object.keys(v).length) continue;
        out[k] = v;
      }
      return canon(out);
    };
    return core(a) === core(b);
  }

  // ---------------------------------------------------------------- 6.3.0: keyed lists (syncdoc.py, P1)
  const TELE = 'plugin.video.telescope';
  const KEYED = [
    ['stremio', TELE, 'stremio_servers', 'text', '\n'],
    ['pins', TELE, 'pinned_chats', 'text', ','],
    ['bots', TELE, 'bots', 'text', ','],
    ['iptv', 'files', 'iptv.json', 'rows', 'm3u'],
    ['epg', 'files', 'iptv.json', 'rows', 'epg'],          // 6.5.0: the IPTV guide list (same plain value as iptv)
    ['providers', 'files', 'providers.json', 'map', ''],
  ];
  const tokKey = (arg, t) => (arg === ',' ? t.replace(/^@+/, '').toLowerCase() : t);
  function items_of(spec, value) {
    const [, , , kind, arg] = spec, out = [], seen = new Set();
    const add = (k, v) => { if (k && !seen.has(k) && v !== null && v !== undefined) { seen.add(k); out.push([k, v]); } };
    if (kind === 'text') {
      if (typeof value === 'string') for (let t of value.split(/[\n,]+/)) { t = strip(t); if (t) add(tokKey(arg, t), t); }
    } else if (kind === 'rows') {
      const part = get(value, arg);
      for (const e of asList(part)) {
        if (typeof e === 'string') add(strip(e), e);
        else if (isDict(e) && typeof get(e, 'url') === 'string') add(strip(e.url), e);
      }
    } else if (kind === 'map') {
      if (isDict(value)) for (const k of Object.keys(value).sort(cmpStr)) add(k, value[k]);
    }
    return out;
  }
  function flat_of(spec, items, base) {
    const [, , , kind, arg] = spec;
    if (kind === 'text') return items.map((x) => x[1]).join(arg);
    const out = dict();
    if (kind === 'rows') {
      if (isDict(base)) for (const k of Object.keys(base)) out[k] = base[k];
      if (items.length || has(out, arg)) out[arg] = items.map((x) => x[1]);   // 6.5.0: no empty list the file never had
      return out;
    }
    for (const [k, v] of items) out[k] = v;
    return out;
  }
  function sectionOf(doc, spec, make) {
    if (spec[1] === 'files') {
      if (make && !isDict(get(doc, 'files'))) doc.files = dict();
      return isDict(get(doc, 'files')) ? doc.files : null;
    }
    if (make) {
      if (!isDict(get(doc, 'settings'))) doc.settings = dict();
      if (!isDict(get(doc.settings, spec[1]))) doc.settings[spec[1]] = dict();
    }
    const s = get(doc, 'settings'), sec = isDict(s) ? get(s, spec[1]) : undefined;
    return isDict(sec) ? sec : null;
  }
  function flat_pair(doc, spec) {
    const sec = isDict(doc) ? sectionOf(doc, spec, false) : null;
    const p = sec ? get(sec, spec[2]) : undefined;
    return isPair(p) ? p : null;
  }
  function keyed_ops(spec, last, value, ts) {      // what changed in a list here since this device held `last`
    const ops = dict();
    if (!Array.isArray(last)) return ops;
    const was = new Map();
    for (const p of last) if (isPair(p)) was.set(p[0], p[1]);
    const now = items_of(spec, value), keys = new Set();
    for (const [k, v] of now) { keys.add(k); if (!was.has(k) || canon(was.get(k)) !== canon(v)) ops[k] = [v, ts]; }
    for (const k of was.keys()) if (!keys.has(k)) ops[k] = [null, ts];
    return ops;
  }
  // after a merge: the keyed list and the plain value agree (syncdoc.py settle). 6.5.0: lists sharing one plain value
  // (iptv / epg in iptv.json) are settled together, against the newest item of all of them before any was settled
  function settle(doc, spec) {
    const group = KEYED.filter((s) => s[1] === spec[1] && s[2] === spec[2]);
    if (!group.some((s) => s[0] === spec[0])) group.push(spec);
    const keyed = asDict(get(doc, 'keyed'));
    let kmax = 0;
    for (const s of group) {
      const S = asDict(get(keyed, s[0]));
      for (const k of Object.keys(S)) if (isPair(S[k])) kmax = Math.max(kmax, stamp(S[k][1]));
    }
    let out = null;
    for (const s of group) { const r = settleOne(doc, s, kmax); if (s[0] === spec[0]) out = r; }
    return out;
  }
  function settleOne(doc, spec, kmax) {
    const name = spec[0], keyed = asDict(get(doc, 'keyed')), src = asDict(get(keyed, name)), K = dict();
    for (const k of Object.keys(src)) if (isPair(src[k])) K[k] = src[k];
    const F = flat_pair(doc, spec);
    if (!F && !Object.keys(K).length) return null;
    const fval = F ? F[0] : null, fts = F ? stamp(F[1]) : 0;
    const fitems = F ? items_of(spec, fval) : [], fkeys = new Set(fitems.map((x) => x[0]));
    const isNone = (v) => v === null || v === undefined;
    if (F && fts > kmax) {
      for (const [k, v] of fitems) { const cur = has(K, k) ? K[k] : null; if (!cur || canon(cur[0]) !== canon(v)) K[k] = [v, fts]; }
      for (const k of Object.keys(K)) if (!isNone(K[k][0]) && !fkeys.has(k)) K[k] = [null, fts];
    } else {
      for (const [k, v] of fitems) if (!has(K, k)) K[k] = [v, fts];
    }
    for (const k of Object.keys(K)) K[k] = [isNone(K[k][0]) ? null : K[k][0], stamp(K[k][1])];
    const tombs = Object.keys(K).filter((k) => K[k][0] === null).sort((x, y) => cmpTuple([-K[x][1], x], [-K[y][1], y]));
    for (const k of tombs.slice(MAX_TOMBS)) delete K[k];
    const live = Object.keys(K).filter((k) => K[k][0] !== null);
    const liveSet = new Set(live);
    const order = fitems.map((x) => x[0]).filter((k) => liveSet.has(k))
      .concat(live.filter((k) => !fkeys.has(k)).sort((x, y) => cmpTuple([K[x][1], x], [K[y][1], y])));
    const items = order.map((k) => [k, K[k][0]]);
    const nv = flat_of(spec, items, fval);
    const nts = Math.max(fts, ...Object.keys(K).map((k) => K[k][1]));
    if (!isDict(get(doc, 'keyed'))) doc.keyed = dict();
    doc.keyed[name] = K;
    sectionOf(doc, spec, true)[spec[2]] = [nv, nts];
    return items;
  }
  function changed_settings(merged, current) {     // what must be written on this device: {addon id: {key: value}}
    const out = dict();
    merged = asDict(merged);
    for (const aid of Object.keys(merged)) {
      const cur = asDict(get(current, aid)), keys = asDict(merged[aid]);
      for (const k of Object.keys(keys)) {
        if (!isPair(keys[k])) continue;
        const [v, ts] = keys[k];
        if (Number(ts) > 0 && canon(get(cur, k)) !== canon(v)) { if (!has(out, aid)) out[aid] = dict(); out[aid][k] = v; }
      }
    }
    return out;
  }

  const api = {VERSION, LEVEL, DAY, KNOWN, KEYED, MAX_HISTORY, MAX_SEARCHES, MAX_REMOVED, PyFloat, parse, canon, copy, cmpStr, when, num, stamp, strip, dict, get,
               merge_devices, merge_keyed, capable, items_of, flat_of, flat_pair, keyed_ops, settle,
               merge_users, live_users, merge_history, progress_of, with_progress, progress_points, merge_removed, merge_favourites, merge_searches, merge_marks, merge_user_data,
               merge_stamped, stamp_changes, empty, merge, same, changed_settings};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SyncDoc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
