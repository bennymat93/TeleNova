'use strict';
// What this browser keeps, in the build's own shapes (so that it can be merged with the account's document):
//   users      - the list of users (plugin.video.nova/resources/lib/users.py: same rules for create / rename / delete);
//                which user is active is this browser's own choice
//   per user   - history    [{key, label, play, thumb, fanart, plot, ts, when 'dd/mm/YYYY HH:MM'}]   (service.py record_history)
//                favourites [{kind, id, label, extra, added}] + removed [{kind, id, removed}]        (default.py fav_add / fav_rm)
//                searches   [{q, ts}] + marks {history_cleared, searches_cleared, searches_removed}  (searchhist.py, users.mark)
// and the rules of the search suggestions (searchhist.py: match, titles_of, merge).
// Pure logic over a localStorage-like object: runs in the browser (window.Store) and in Node (tests: src/qa/web/t_store.js).
(function (root) {
  function make(storage, SD, opt = {}) {
    const clock = opt.now || (() => Date.now() / 1000);
    const FIRST = 'u1';
    const listeners = [];
    const changed = (what) => listeners.forEach((f) => { try { f(what); } catch (e) {} });
    const read = (k, d) => { try { const v = storage.getItem('bn_' + k); return v == null ? d : SD.parse(v); } catch (e) { return d; } };
    const write = (k, v) => { try { storage.setItem('bn_' + k, SD.canon(v)); return true; } catch (e) { return false; } };
    const drop = (k) => { try { storage.removeItem('bn_' + k); } catch (e) {} };
    const arr = (x) => (Array.isArray(x) ? x : []);
    const isDict = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && !(x instanceof SD.PyFloat);
    const cut = (s, n) => Array.from(s).slice(0, n).join('');             // Python slices by character, not by UTF-16 unit
    const tidy = (s) => SD.strip(String(s == null ? '' : s)).replace(/\s+/g, ' ');
    const pad = (n) => String(n).padStart(2, '0');
    // 'dd/mm/YYYY HH:MM' in local time, as the hub's now_str()
    function whenStr(ts) {
      const d = new Date((ts == null ? clock() : ts) * 1000);
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // ------------------------------------------------------------ users (users.py store_*)
    function users() {                             // every user ever known here, deleted ones included (the sync needs their marks)
      const u = read('users', null);
      return Array.isArray(u) && u.length ? u : [{id: FIRST, name: '', created: 1, renamed: 0, deleted: 0}];
    }
    const live = () => users().filter((u) => isDict(u) && !Number(u.deleted || 0));
    function current() {
      const cur = read('user', null), ids = live().map((u) => u.id);
      return ids.includes(cur) ? cur : (ids.length ? ids[0] : FIRST);
    }
    const cleanName = (name) => cut(tidy(name), 30);
    function newId() {
      const b = new Uint8Array(4);
      if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(b); else for (let i = 0; i < 4; i++) b[i] = Math.floor(Math.random() * 256);
      return 'u' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    }
    function create(name) {
      name = cleanName(name);
      if (!name) throw new Error('empty name');
      const list = users();
      if (list.some((u) => !Number(u.deleted || 0) && String(u.name || '').toLowerCase() === name.toLowerCase())) throw new Error('name exists');
      const t = Math.floor(clock()), uid = newId();
      list.push({id: uid, name, created: t, renamed: t, deleted: 0});
      write('users', list);
      changed('users');
      return uid;
    }
    function rename(uid, name) {
      name = cleanName(name);
      if (!name) throw new Error('empty name');
      const list = users();
      for (const u of list) if (u.id === uid) { u.name = name; u.renamed = Math.floor(clock()); }
      write('users', list);
      changed('users');
    }
    function remove(uid) {                         // marked deleted (the mark reaches the other devices); the content here is removed
      if (live().length <= 1 || uid === current()) throw new Error('cannot delete the only / the active user');
      const list = users();
      for (const u of list) if (u.id === uid) u.deleted = Math.floor(clock());
      write('users', list);
      drop('data_' + uid);
      changed('users');
    }
    function switchTo(uid) {
      if (uid === current() || !live().some((u) => u.id === uid)) return false;
      write('user', uid);
      changed('user');
      return true;
    }
    function data(uid) {                           // one user's content as the document holds it
      const d = read('data_' + uid, null);
      const g = (k) => (isDict(d) ? d[k] : null);
      return {history: arr(g('history')), favourites: arr(g('favourites')), removed: arr(g('removed')), searches: arr(g('searches')),
              marks: isDict(g('marks')) ? g('marks') : SD.dict()};
    }
    function putData(uid, d, silent) {             // -> true when the content really differs
      const nw = {history: arr(d.history), favourites: arr(d.favourites), removed: arr(d.removed), searches: arr(d.searches), marks: isDict(d.marks) ? d.marks : SD.dict()};
      if (SD.canon(data(uid)) === SD.canon(nw)) return false;
      write('data_' + uid, nw);
      if (!silent) changed('data');
      return true;
    }
    // the merged list from the sync; a user deleted elsewhere loses their content here; when the active user was
    // deleted on another device this browser moves to the first user that is left. -> true when the list changed
    function setUsers(list, silent) {
      if (SD.canon(users()) === SD.canon(list)) return false;
      const cur = current();
      write('users', list);
      const alive = list.filter((u) => !Number(u.deleted || 0)).map((u) => u.id);
      for (const u of list) if (Number(u.deleted || 0)) drop('data_' + u.id);
      if (!alive.includes(cur) && alive.length) write('user', alive[0]);
      if (!silent) changed('users');
      return true;
    }
    const edit = (f) => { const uid = current(), d = data(uid); f(d); putData(uid, d); };

    // ------------------------------------------------------------ history
    function addHistory(e) {
      if (!e || !e.key) return;
      edit((d) => {
        let ts = clock();
        const cleared = SD.num(d.marks.history_cleared);
        if (ts <= cleared) ts = cleared + 1;       // an entry made right after a clearing must survive it
        const entry = {key: String(e.key), label: String(e.label || ''), when: whenStr(ts), ts, play: String(e.play || ''),
                       plot: cut(String(e.plot || ''), 300), thumb: String(e.thumb || ''), fanart: String(e.fanart || '')};
        d.history = [entry].concat(d.history.filter((h) => !isDict(h) || h.key !== entry.key)).slice(0, SD.MAX_HISTORY);
      });
    }
    function clearHistory() {
      edit((d) => { d.history = []; d.marks.history_cleared = Math.ceil(clock()); });
    }

    // ------------------------------------------------------------ favourites
    const sameFav = (f, kind, id) => isDict(f) && f.kind === kind && String(f.id) === String(id);
    const isFav = (kind, id) => data(current()).favourites.some((f) => sameFav(f, kind, id));
    function addFav(kind, id, label, extra) {
      edit((d) => {
        if (d.favourites.some((f) => sameFav(f, kind, id))) return;
        let added = whenStr();
        const tomb = d.removed.find((r) => sameFav(r, kind, id));
        if (tomb && SD.cmpStr(SD.when(tomb.removed), SD.when(added)) >= 0) {
          // removed and added again within the same minute: the merge rule keeps a removal that is not OLDER than the
          // adding, so the adding gets the next minute
          const t = new Date(SD.when(tomb.removed)).getTime();
          if (t === t) added = whenStr(t / 1000 + 60); else d.removed = d.removed.filter((r) => !sameFav(r, kind, id));
        }
        d.favourites = [{kind, id: String(id), label: String(label || ''), extra: String(extra || ''), added}].concat(d.favourites);
      });
    }
    function removeFav(kind, id) {                 // stays removed on the other devices
      edit((d) => {
        if (!d.favourites.some((f) => sameFav(f, kind, id))) return;
        d.favourites = d.favourites.filter((f) => !sameFav(f, kind, id));
        d.removed = [{kind, id: String(id), removed: whenStr()}].concat(d.removed.filter((r) => !sameFav(r, kind, id))).slice(0, SD.MAX_REMOVED);
      });
    }
    function clearFavs() { for (const f of data(current()).favourites.slice()) if (isDict(f)) removeFav(f.kind, f.id); }

    // ------------------------------------------------------------ search history (searchhist.py)
    const clean = (q) => cut(tidy(q), 120);
    const keyOf = (q) => clean(q).toLowerCase();
    function addSearch(q) {
      q = clean(q);
      if (Array.from(q).length < 2) return;
      edit((d) => {
        let ts = Math.floor(clock());
        const floor = Math.max(SD.num(d.marks.searches_cleared), SD.num(SD.get(d.marks.searches_removed, keyOf(q))));
        if (ts <= floor) ts = floor + 1;           // searched again after it was removed / cleared: it is back
        d.searches = [{q, ts}].concat(d.searches.filter((h) => isDict(h) && keyOf(h.q) !== keyOf(q))).slice(0, SD.MAX_SEARCHES);
      });
    }
    function removeSearch(q) {
      edit((d) => {
        d.searches = d.searches.filter((h) => isDict(h) && keyOf(h.q) !== keyOf(q));
        if (!isDict(d.marks.searches_removed)) d.marks.searches_removed = SD.dict();
        d.marks.searches_removed[keyOf(q)] = Math.floor(clock());
      });
    }
    function clearSearches() {
      edit((d) => { d.searches = []; d.marks.searches_cleared = Math.floor(clock()); });
    }
    // earlier searches for the typed text: those that START with it, then those that contain it; all when empty
    function match(hist, text, limit = 9) {
      const t = keyOf(text);
      const qs = arr(hist).filter((h) => isDict(h) && h.q).map((h) => h.q);
      if (!t) return qs.slice(0, limit);
      const starts = qs.filter((q) => q.toLowerCase().startsWith(t) && q.toLowerCase() !== t);
      const inside = qs.filter((q) => q.toLowerCase().includes(t) && !q.toLowerCase().startsWith(t));
      return starts.concat(inside).slice(0, limit);
    }
    // TMDb search/multi results -> titles to suggest: films and series only, the best known first, no doubles
    function titlesOf(results, text, limit = 9) {
      const t = keyOf(text), rows = [];
      for (const r of arr(results)) {
        if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
        let name = '', rank = 1;
        for (const n of [r.title || r.name, r.original_title || r.original_name]) {
          const c = clean(n);
          if (c && t && c.toLowerCase().includes(t)) { name = c; rank = 0; break; }
        }
        if (!name) name = clean(r.title || r.name);     // found by another of its names: after the titles that show the typed text
        if (name) rows.push([rank, -(r.popularity || 0), name]);
      }
      rows.sort((a, b) => a[0] - b[0] || a[1] - b[1] || SD.cmpStr(a[2], b[2]));
      const out = [], seen = new Set();
      for (const [, , name] of rows) if (!seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); out.push(name); }
      return out.slice(0, limit);
    }
    // history first (it is what this viewer looks for), then catalogue titles; no doubles, never the text itself
    function mergeSuggest(mine, online, text, limit = 9) {
      const out = [], seen = new Set([keyOf(text)]);
      for (const [src, items] of [['history', mine], ['title', online]]) {
        for (const q of arr(items)) if (!seen.has(keyOf(q))) { seen.add(keyOf(q)); out.push([q, src]); }
      }
      return out.slice(0, limit);
    }

    // ------------------------------------------------------------ pictures (this browser only: the build's favourites carry none)
    const artKey = (kind, id) => kind + ':' + id;
    function art(kind, id) { const a = read('art', null); return (isDict(a) && typeof a[artKey(kind, id)] === 'string' && a[artKey(kind, id)]) || ''; }
    function setArt(kind, id, url) {
      if (!url || typeof url !== 'string') return;
      let a = read('art', null);
      if (!isDict(a)) a = SD.dict();
      if (a[artKey(kind, id)] === url) return;
      const keys = Object.keys(a);
      if (keys.length > 600) for (const k of keys.slice(0, 100)) delete a[k];
      a[artKey(kind, id)] = url;
      write('art', a);
    }

    // ------------------------------------------------------------ 3.x favourites -> the first user, once
    function migrate() {
      let old;
      try { old = JSON.parse(storage.getItem('bn_favs') || 'null'); } catch (e) { old = null; }
      if (!Array.isArray(old)) return 0;
      const uid = live().length ? live()[0].id : FIRST, d = data(uid), added = whenStr();
      let n = 0;
      for (const f of old) {
        if (!f || typeof f.key !== 'string') continue;
        const dd = f.data || {};
        let kind, id, extra = '';
        if (f.key.startsWith('tmdb:movie:')) { kind = 'movie'; id = f.key.slice(11); }
        else if (f.key.startsWith('tmdb:tv:')) { kind = 'series'; id = f.key.slice(8); }
        else if (f.key.startsWith('ia:')) { kind = 'web_ia'; id = f.key.slice(3); }
        else if (f.key.startsWith('ch:')) { kind = 'web_channel'; id = f.key.slice(3); extra = String(f.img || dd.logo || ''); }
        else if (f.key.startsWith('radio:')) { kind = 'radio'; id = f.key.slice(6); extra = String(dd.url_resolved || dd.url || ''); }
        else continue;
        if (!id || d.favourites.some((x) => sameFav(x, kind, id))) continue;
        d.favourites.push({kind, id: String(id), label: String(f.title || ''), extra, added});
        if (f.img) setArt(kind, id, String(f.img));
        n++;
      }
      putData(uid, d);
      try { storage.setItem('bn_favs_3x', storage.getItem('bn_favs')); storage.removeItem('bn_favs'); } catch (e) {}
      return n;
    }

    return {FIRST, users, live, current, cleanName, create, rename, remove, switchTo, data, putData, setUsers, whenStr,
            addHistory, clearHistory, history: () => data(current()).history,
            favs: () => data(current()).favourites, isFav, addFav, removeFav, clearFavs,
            searches: () => data(current()).searches, addSearch, removeSearch, clearSearches, clean, match, titlesOf, mergeSuggest,
            art, setArt, migrate, onChange: (f) => listeners.push(f)};
  }
  const api = {make};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Store = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
