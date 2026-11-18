'use strict';
// TeleNova Web shell: the parts of the interface that are plain logic (no DOM), so node can test them
// (src/qa/web/t_shell.js). Loaded before app.js; app.js is the only user (self.ShellCore).
(function (root) {
  // ---------------------------------------------------------------- device
  // a TV browser by its user agent. \bTV\b alone misses "SmartTV", VIDAA (Hisense), NETTV (Philips), Android TV boxes.
  const TV_RE = /\b(TV|Tizen|Web0S|WebOS|AFT[A-Z]{1,6}|BRAVIA|GoogleTV|Android TV|CrKey|HbbTV|NetCast|Viera|AppleTV|VIDAA|NETTV|Roku|Chromecast)\b|Smart-?TV|AndroidTV|Opera TV|TV Bro|TVBro|DTV/i;
  function isTvUA(ua) { return TV_RE.test(String(ua || '')); }
  // device setting ('auto' | 'tv' | 'phone' | 'desktop'), the TV test, the window width -> the layout shell
  function pickShell(device, isTv, width) {
    if (device === 'tv' || device === 'phone' || device === 'desktop') return device;
    if (isTv) return 'tv';
    const w = Number(width) || 0;
    return w < 600 ? 'phone' : w < 1024 ? 'tablet' : 'desktop';
  }
  function posterSize(shell, dpr) { return shell === 'tv' || (dpr || 1) >= 2 ? (shell === 'phone' ? 'w342' : 'w500') : shell === 'phone' ? 'w185' : 'w342'; }
  function backdropSize(shell) { return shell === 'phone' ? 'w780' : 'w1280'; }

  // ---------------------------------------------------------------- navigation tables
  // [page key, icon id, group]. Kodi root order inside each group; youtube + topics are home-screen items in Kodi.
  const MENU = [
    ['hub', 'search', 'watch'], ['searchhist', 'searchhist', 'watch'], ['movies', 'movies', 'watch'], ['tv', 'tv', 'watch'],
    ['live', 'live', 'watch'], ['radio', 'radio', 'watch'], ['telegram', 'telegram', 'watch'], ['youtube', 'youtube', 'watch'],
    ['topics', 'topics', 'watch'],
    ['history', 'history', 'mine'], ['favs', 'heart', 'mine'], ['library', 'library', 'mine'], ['users', 'users', 'mine'],
    ['services', 'key', 'system'], ['backup', 'backup', 'system'], ['gdrive', 'cloud', 'system'], ['status', 'status', 'system'],
    ['help', 'help', 'system'], ['device', 'device', 'system'], ['settings', 'settings', 'system'], ['bn', 'download', 'system'],
    ['about', 'info', 'system'],
  ];
  const GROUPS = ['watch', 'mine', 'system'];
  const RAIL = [['', 'home'], ['hub', 'search'], ['movies', 'movies'], ['tv', 'tv'], ['live', 'live'], ['radio', 'radio'], ['telegram', 'telegram'],
                null, ['favs', 'heart'], ['history', 'history'], ['library', 'library'], null, ['menu', 'more']];
  const TABS = [['', 'home'], ['hub', 'search'], ['live', 'live'], ['mine', 'mine'], ['menu', 'more']];
  // where "back" leads from a page, and which bar item it lights up
  const PARENT = {catalog: 'movies', search: 'hub', searchhist: 'hub', title: 'movies', youtube: 'menu', topics: 'menu', users: 'menu',
                  services: 'menu', backup: 'menu', gdrive: 'menu', status: 'menu', help: 'menu', device: 'menu', settings: 'menu', bn: 'menu',
                  about: 'menu', library: 'menu', tglogin: 'settings'};
  function parentOf(key, arg) {
    key = String(key || '');
    if (!key) return '';
    if (key === 'catalog' || key === 'title') return /(^|[&/])(m=tv|tv)([&/]|$)/.test(String(arg || '')) ? 'tv' : 'movies';
    return Object.prototype.hasOwnProperty.call(PARENT, key) ? PARENT[key] : '';
  }
  const backHash = (key, arg) => '#/' + parentOf(key, arg);
  // the bar item a page belongs to: itself when the bar has it, else its parent chain
  function navOwner(key, arg, items) {
    const has = (k) => items.some((it) => it && it[0] === k);
    let k = String(key || ''), a = arg, n = 0;
    // the phone bar has one "My things" item for Favourites and History (asked first: their parent chain ends at home,
    // which every bar has, so the test after the loop never reached this)
    if (!has(k) && has('mine') && (k === 'favs' || k === 'history')) return 'mine';
    while (!has(k) && n++ < 4) { k = parentOf(k, a); a = ''; }
    return has(k) ? k : '';
  }

  // ---------------------------------------------------------------- provider switches
  // the Library's rows 'hub' and 'subs' stand for several registered providers
  const PROVIDER_GROUP = {dailymotion: 'hub', tmdb: 'hub', archive: 'hub', wizdom: 'subs', opensubs: 'subs', yify: 'subs', ktuvit: 'subs',
                          subsrv: 'subs', subs_ai: 'subs'};
  function providerOnIn(off, name) {
    const o = Array.isArray(off) ? off : [];
    if (o.indexOf(name) >= 0) return false;
    const g = PROVIDER_GROUP[name];
    return !(g && o.indexOf(g) >= 0);
  }

  // ---------------------------------------------------------------- history
  const httpsOnly = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');
  // Kodi keeps pictures as image://<encoded address>/
  function picOf(h) {
    let p = h && typeof h.thumb === 'string' ? h.thumb : '';
    if (p.indexOf('image://') === 0) { try { p = decodeURIComponent(p.slice(8).replace(/\/$/, '')); } catch (e) { p = ''; } }
    return httpsOnly(p);
  }
  // one history entry (maybe written by a Kodi device) -> what the browser can do with it
  function histTarget(h) {
    const key = String((h && h.key) || ''), play = h && typeof h.play === 'string' ? h.play : '';
    let m;
    if ((m = /^movie:(\d+)$/.exec(key))) return {type: 'title', media: 'movie', id: m[1]};
    if ((m = /^tv:(\d+)(?::(\d+):(\d+))?$/.exec(key))) return {type: 'title', media: 'tv', id: m[1], season: m[2] || '', episode: m[3] || ''};
    if (key.indexOf('ia:') === 0 && key.length > 3) return {type: 'ia', id: key.slice(3)};
    if (key.indexOf('radio:') === 0 && httpsOnly(play)) return {type: 'radio', id: key.slice(6)};
    if (key.indexOf('ch:il:') === 0) return {type: 'il', id: key.slice(6)};
    if (key.indexOf('ch:') === 0 && httpsOnly(play)) return {type: 'stream'};
    if (/^yt:[A-Za-z0-9_-]{11}$/.test(key) || /plugin\.video\.youtube\/.*video_id=[A-Za-z0-9_-]{11}/.test(play)) return {type: 'module', module: 'yt'};
    if (key.indexOf('dm:') === 0) return {type: 'module', module: 'hub'};
    if (key.indexOf('tg:') === 0) return {type: 'module', module: 'tgsearch'};
    if (play.indexOf('plugin://') === 0) {            // a Kodi address cannot play here; when it names a TMDb title, its page opens instead
      const q = new URLSearchParams(play.split('?')[1] || ''), id = q.get('id') || q.get('tmdb_id') || '';
      if (/^\d+$/.test(id) && /plugin\.video\.(nova|pov)\//.test(play)) return {type: 'title', media: (q.get('m') || q.get('mediatype') || 'movie') === 'movie' ? 'movie' : 'tv', id};
      return {type: 'kodi'};
    }
    if (httpsOnly(play) && /\.m3u8(\?|$)/i.test(play)) return {type: 'stream'};
    return {type: 'kodi'};
  }
  // "Continue watching" (Design Rule 28): started = 2 minutes or 3 % in, finished = under 3 minutes (or 5 %) left;
  // one item per series (its newest episode). history is newest first and carries progress {t, d} in seconds.
  function continueWatching(history, limit) {
    const out = [], shows = {};
    for (const h of Array.isArray(history) ? history : []) {
      if (!h || typeof h !== 'object' || !h.key || !h.progress || typeof h.progress !== 'object') continue;
      const t = Math.floor(Number(h.progress.t) || 0), d = Math.floor(Number(h.progress.d) || 0);
      if (t <= 0) continue;
      const m = /^tv:(\d+):/.exec(String(h.key));
      if (m) { if (shows[m[1]]) continue; shows[m[1]] = true; }        // the newest episode decides for the whole series
      const started = t >= 120 || (d > 0 && t >= d * 0.03);
      const finished = d > 0 && (d - t < 180 || t >= d * 0.95);
      if (!started || finished) continue;
      out.push({entry: h, t, d, frac: d > 0 ? Math.min(1, t / d) : 0, left: d > 0 ? d - t : 0});
      if (limit && out.length >= limit) break;
    }
    return out;
  }
  function leftText(secs) {                           // 5400 -> '1:30', 240 -> '0:04'
    const m = Math.max(1, Math.round(secs / 60));
    return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
  }
  // an entry without Kodi's play address gets one, so a film started here starts in Kodi too (same key on every device)
  function kodiPlay(entry) {
    const m = /^movie:(\d+)$/.exec(String((entry && entry.key) || ''));
    if (!m || (entry.play && String(entry.play).trim())) return entry;
    return Object.assign({}, entry, {play: 'plugin://plugin.video.nova/?' + new URLSearchParams({a: 'play', m: 'movie', id: m[1], q: String(entry.label || '')})});
  }

  // ---------------------------------------------------------------- home rows
  const HOME_ROWS = ['continue', 'favs', 'live', 'trend_movie', 'trend_tv', 'popular', 'il_movies', 'il_series', 'family', 'radio',
                     'searches', 'telegram', 'classics', 'sections'];
  // saved = [{id, on}] in the viewer's order; rows added by a newer version are appended, unknown ones dropped
  function homeRows(saved) {
    const out = [], seen = {};
    for (const r of Array.isArray(saved) ? saved : []) {
      if (!r || HOME_ROWS.indexOf(r.id) < 0 || seen[r.id]) continue;
      seen[r.id] = true;
      out.push({id: r.id, on: r.on !== false});
    }
    for (const id of HOME_ROWS) if (!seen[id]) out.push({id, on: true});
    return out;
  }
  function moveRow(rows, id, by) {
    const list = rows.slice(), i = list.findIndex((r) => r.id === id), j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const x = list[i]; list[i] = list[j]; list[j] = x;
    return list;
  }

  // ---------------------------------------------------------------- focus geometry
  // a grid of `count` items in `cols` columns, in reading order. dir: left / right / up / down on the SCREEN.
  // Returns the new index, or -1 when the move leaves the grid. In RTL the next item is on the left.
  function gridStep(index, count, cols, dir, rtl) {
    cols = Math.max(1, cols | 0);
    if (!(index >= 0 && index < count)) return -1;
    const col = index % cols;
    if (dir === 'up') return index - cols >= 0 ? index - cols : -1;
    if (dir === 'down') {
      if (index + cols < count) return index + cols;
      const lastRow = Math.floor((count - 1) / cols);
      return Math.floor(index / cols) < lastRow ? count - 1 : -1;      // a short last row: its last item
    }
    const fwd = (dir === 'left') === !!rtl;                             // forward in reading order
    if (fwd) return col + 1 < cols && index + 1 < count ? index + 1 : -1;
    return col > 0 ? index - 1 : -1;
  }
  // rects: [{left, top, right, bottom}] ; the best one in direction `dir` from `cur`, or -1.
  // Candidates must lie beyond the current edge; the score prefers overlap on the cross axis, then the nearest.
  function pickDir(cur, rects, dir) {
    const horiz = dir === 'left' || dir === 'right';
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!r) continue;
      const along = dir === 'left' ? cur.left - r.right : dir === 'right' ? r.left - cur.right : dir === 'up' ? cur.top - r.bottom : r.top - cur.bottom;
      if (along < -4) continue;
      // behind the leading edge at all? (an element that merely overlaps is not "in that direction")
      const lead = dir === 'left' ? r.left < cur.left - 1 : dir === 'right' ? r.right > cur.right + 1 : dir === 'up' ? r.top < cur.top - 1 : r.bottom > cur.bottom + 1;
      if (!lead) continue;
      const a0 = horiz ? cur.top : cur.left, a1 = horiz ? cur.bottom : cur.right, b0 = horiz ? r.top : r.left, b1 = horiz ? r.bottom : r.right;
      const overlap = Math.min(a1, b1) - Math.max(a0, b0);
      const gap = overlap > 0 ? 0 : -overlap;                          // distance on the cross axis when they do not overlap
      const centre = Math.abs((a0 + a1) / 2 - (b0 + b1) / 2);
      const score = Math.max(0, along) + gap * 3 + (overlap > 0 ? 0 : 40) + centre * 0.05;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }
  // entering a group: the item with the largest overlap with `cur` on the cross axis, else the nearest centre
  function pickOverlap(cur, rects, dir) {
    const horiz = dir === 'left' || dir === 'right';
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!r) continue;
      const a0 = horiz ? cur.top : cur.left, a1 = horiz ? cur.bottom : cur.right, b0 = horiz ? r.top : r.left, b1 = horiz ? r.bottom : r.right;
      const overlap = Math.min(a1, b1) - Math.max(a0, b0);
      // nearest edge of the group first (top row when coming from above...), then the overlap
      const depth = dir === 'down' ? r.top : dir === 'up' ? -r.bottom : dir === 'right' ? r.left : -r.right;
      const score = -depth * 4 + overlap;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  const api = {isTvUA, pickShell, posterSize, backdropSize, MENU, GROUPS, RAIL, TABS, PARENT, parentOf, backHash, navOwner,
               PROVIDER_GROUP, providerOnIn, httpsOnly, picOf, histTarget, continueWatching, leftText, kodiPlay,
               HOME_ROWS, homeRows, moveRow, gridStep, pickDir, pickOverlap};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShellCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
