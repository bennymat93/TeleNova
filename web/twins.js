'use strict';
// 6.2.0: one table of "this browser's setting <-> the build's setting", shared by the live sync (websync.js) and the
// settings file (backup.js, .tncfg). docs/SYNC-PLAN.md section (d).
//
// A row: [web key, addon id, Kodi id, codec, flags]
//   web key  'name'            this browser's setting (TN.settings / bn_cfg)
//            'bn:name'         a store of this browser (TN.get / TN.put 'name')
//            'bn:name.field'   one field of a store that is an object (bn_rd_auth -> three Kodi ids)
//   addon    plugin.video.nova | plugin.video.telescope | 'files' (a whole file of the document, Kodi's addon_data)
//   codec    s text | b switch ('true' / 'false' as Kodi writes them) | nl list <-> newline text |
//            pins list of chats <-> comma text (as the engine parses pinned_chats) | bots "My bots" <-> comma text |
//            iptv own lists + own guides <-> iptv.json (unknown Kodi fields kept)
//   flags    m  mirror: the same value under a second Kodi id, written only when the account already has that id
//            r  read only: taken from the account when this browser has none, never sent (the Telegram app id: the
//               engine's login is bound to it)
//            t  also in the settings file (.tncfg), in this order (backup.js webToKodi / kodiToWeb)
// Everything of bn_cfg without a twin goes to settings section "web" (Kodi passes it through), except LOCAL.
// The Telegram session / auth key is NEVER in any of this (SESSION_RX, checked on both directions).
(function (root) {
  const NOVA = 'plugin.video.nova', TELE = 'plugin.video.telescope', FILES = 'files', WEB = 'web';
  const TWINS = Object.freeze([
    ['tmdb', NOVA, 'tmdb_key', 's', 't'],
    ['gemini_key', TELE, 'gemini_key', 's', 't'],
    ['gemini_key', NOVA, 'gemini_key', 's', 'm'],
    ['subs_os_key', TELE, 'os_key', 's', 't'],
    ['subs_os_key', NOVA, 'opensubs_key', 's', 'm'],
    ['stremthru_url', TELE, 'st_url', 's', 't'],
    ['stremthru_on', TELE, 'st_enabled', 'b', 't'],
    ['telegram_quiet', TELE, 'tg_quiet', 'b', 't'],
    ['tgsearch_bots', TELE, 'bot_request', 'b', 't'],
    ['tgsearch_bots_auto', TELE, 'bot_auto', 'b', ''],
    ['tgsearch_bot_autojoin', TELE, 'bot_autojoin', 'b', ''],
    ['subs_server_url', NOVA, 'sub_server_remote', 's', ''],
    ['gdrive_client', NOVA, 'gd_client_id', 's', ''],
    ['bn:sources_addons', TELE, 'stremio_servers', 'nl', ''],
    ['bn:tg_pins', TELE, 'pinned_chats', 'pins', ''],
    ['bn:tg_bots', TELE, 'bots', 'bots', ''],
    ['bn:rd_token', TELE, 'rd_token', 's', ''],
    ['bn:rd_token', NOVA, 'rd_token', 's', 'm'],
    ['bn:rd_auth.cid', TELE, 'rd_client_id', 's', ''],
    ['bn:rd_auth.sec', TELE, 'rd_client_secret', 's', ''],
    ['bn:rd_auth.refresh', TELE, 'rd_refresh', 's', ''],
    ['bn:rd_torrentio', TELE, 'rd_torrentio_key', 'b', ''],
    ['bn:tg_api.id', TELE, 'api_id', 's', 'r'],
    ['bn:tg_api.hash', TELE, 'api_hash', 's', 'r'],
    ['bn:iptv_own', FILES, 'iptv.json', 'iptv', ''],
  ].map((r) => Object.freeze(r)));
  // the old .tncfg list [web setting, build id, 's' | 'b'] (backup.js), unchanged
  const TNCFG = Object.freeze(TWINS.filter((r) => r[4].includes('t')).map((r) => Object.freeze([r[0], r[2], r[3]])));
  // stores of this browser that travel in section "web" as 'bn_<name>' (no Kodi twin)
  const WEB_STORES = Object.freeze(['radio_own', 'iptv_off', 'tg_link']);
  // never synced: this device's screen, network, caches and pairings (bn_cfg keys and bn_* stores)
  const LOCAL = Object.freeze(['device', 'zoom', 'theme', 'home_rows', 'net_bw', 'net_bw_t', 'player_vol', 'osk_lang', 'osk_show', 'install_seen', 'tv_offer',
    'aio_done', 'clip_hist', 'art', 'rd_dead', 'subs_offsets', 'helper_token', 'tn_gd', 'tn_gd_state', 'tn_gdrive', 'user', 'player_resume',
    'subs_ktuvit', 'synced', 'sync_meta', 'cfg', 'iptv_probe',
    // 6.2.0: the same device-only keys as Kodi's autosync.LOCAL
    'lite', 'ui_sounds', 'open_on_start', 'readahead', 'cache_mb', 'max_mbit',
    // 6.3.0: the owner's sync passphrase stays on this device
    'sync_pass']);
  const LOCAL_RX = /^(tn_gd\w*|\w+_done|last_\w+|\w+_ts|\w+_time|debug|port|device_profile)$/;
  // 6.3.0 (B4): exactly Kodi's autosync.LOCAL (one list; src/qa/t_autosync.py runs both over the same keys)
  const KODI_LOCAL_RX = new RegExp('^(debug|port|device_profile|deps_zip|wizard_shown|sub_server|lite_done|depov_done|wizard_fix|tune_done|' +
    'lite|ui_sounds|open_on_start|readahead|cache_mb|max_mbit|' +
    '\\w+_done|last_\\w+|\\w+_ts|\\w+_time|kodion\\..*|.*\\.port)$');
  // 6.2.0: the Telegram login of a device never enters the document - whatever the key is called
  const SESSION_RX = /session|auth_?key|string_?sess/i;
  const isLocal = (k) => { const b = String(k).replace(/^bn[:_]/, ''); return LOCAL.includes(b) || LOCAL_RX.test(b) || SESSION_RX.test(String(k)); };

  // ------------------------------------------------------------ codecs: enc(web value) -> Kodi value | undefined,
  // dec(Kodi value, current web value) -> web value | undefined (undefined = not valid: nothing is written)
  const MAXS = 4096;
  const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && isFinite(v) ? String(v) : undefined);
  const botKey = (b) => String(b == null ? '' : b).trim().replace(/^@/, '').toLowerCase();
  const isDict = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const httpUrl = (u) => typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u.trim()) && u.length < 2048;
  // 6.2.0: enc(v, old, last) - old = the account's current Kodi value (text) or undefined, last = this browser's web
  // value as last applied / sent (optional). Entries of `old` the browser could not hold are kept; only what the
  // user removed here is dropped.
  const nlSplit = (v) => (typeof v === 'string' ? v.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean) : []);
  const nlUse = (u) => /^https?:\/\/[^\s]+$/i.test(u);
  const pinTok = (p) => (p.username ? botKey(p.username) : String(p.id));
  const CODECS = {
    s: {enc: (v) => { const s = str(v); return s === undefined ? undefined : s.slice(0, MAXS); },
        dec: (v) => { const s = str(v); return s === undefined || s.length > MAXS ? undefined : s; }},
    b: {enc: (v) => (v === true || v === 'true' ? 'true' : v === false || v === 'false' ? 'false' : undefined),
        dec: (v) => (v === true || v === 'true' || v === 1 || v === '1' ? true : v === false || v === 'false' || v === 0 || v === '0' ? false : undefined)},
    // 6.2.0: as Kodi's service.py - split on newline and comma, http and https; no cap here (the browser caps where it
    // uses the list); enc keeps the account's entries this browser cannot use
    nl: {enc(v, old) {
           if (!Array.isArray(v)) return undefined;
           const out = v.filter((u) => typeof u === 'string' && u.trim()).map((u) => u.trim());
           for (const u of nlSplit(old)) if (!nlUse(u) && !out.includes(u)) out.push(u);
           return out.join('\n');
         },
         dec: (v) => (typeof v !== 'string' ? undefined : nlSplit(v).filter(nlUse))},
    // [{id, title, username}] <-> "name,-100123" (a username when known, else the chat id). Kodi's names this browser
    // has no chat id for stay in the account (searched through the synced 'pinned_chats'), never dropped from it.
    // 6.2.0: enc(v, old, last): tokens of `old` that dec could not match (a username unknown here) are merged back,
    // unless `last` held them and `v` no longer does (removed here).
    pins: {enc(v, old, last) {
             if (!Array.isArray(v)) return undefined;
             const out = v.filter((p) => p && p.id).map(pinTok);
             // 6.3.0 (B1): `last` is either the tokens this browser last sent (strings, what websync passes) or chats
             const had = Array.isArray(last) ? last.filter((p) => typeof p === 'string' ? p.trim() : p && p.id) : [];
             const hadTok = (t) => had.some((p) => (typeof p === 'string' ? botKey(p) === botKey(t)
               : (p.username && botKey(p.username) === botKey(t)) || String(p.id) === t));
             for (const t of String(typeof old === 'string' ? old : '').split(',').map((x) => x.trim()).filter(Boolean)) {
               if (/^-?\d{3,20}$/.test(t) || out.some((x) => botKey(x) === botKey(t)) || hadTok(t)) continue;
               out.push(t);
             }
             return out.join(',');
           },
           dec(v, cur) {
             if (typeof v !== 'string') return undefined;
             const have = Array.isArray(cur) ? cur.filter((p) => p && p.id) : [], out = [];
             for (const tok of v.split(',').map((x) => x.trim()).filter(Boolean)) {
               const p = have.find((x) => (x.username && botKey(x.username) === botKey(tok)) || String(x.id) === tok);
               if (p) out.push(p); else if (/^-?\d{3,20}$/.test(tok)) out.push({id: tok, title: '', username: ''});
             }
             return out.slice(0, 50);
           }},
    // tg_bots {cfg: {key: {state, title, username, id}}, stats} <-> "bot1,bot2" (the bots switched on)
    bots: {enc: (v) => (isDict(v) && isDict(v.cfg) ? Object.keys(v.cfg).filter((k) => v.cfg[k] && v.cfg[k].state === 'on').map((k) => botKey(v.cfg[k].username || k)).filter(Boolean).join(',') : undefined),
           dec(v, cur) {
             if (typeof v !== 'string') return undefined;
             const want = v.replace(/ /g, ',').split(',').map(botKey).filter((k) => /^[a-z0-9_]{3,64}$/.test(k));
             const base = isDict(cur) ? cur : {}, cfg = {}, old = isDict(base.cfg) ? base.cfg : {};
             for (const k of Object.keys(old)) if (old[k] && old[k].state !== 'on') cfg[k] = old[k];
             for (const k of want) {
               const hit = Object.keys(old).find((x) => x === k || botKey(old[x] && old[x].username) === k);
               cfg[hit || k] = Object.assign({}, hit ? old[hit] : {username: k}, {state: 'on'});
             }
             return {cfg, stats: isDict(base.stats) ? base.stats : {}};
           }},
  };
  // iptv.json {m3u: [{name, url, ...}], epg: [url], free: {...}} <-> this browser's own lists (bn_iptv_own, bn_epg_own).
  // A list uploaded as a file (rows, no address) stays on this browser. What both sides compare is the projection
  // {m3u: [{name, url}], epg: [url]}; writing keeps every other field of the account's file and of its entries.
  const IPTV = {
    fromWeb(own, epg) {
      return {m3u: (Array.isArray(own) ? own : []).filter((x) => isDict(x) && httpUrl(x.url)).map((x) => ({name: String(x.name || x.url).slice(0, 80), url: x.url.trim()})),
              epg: (Array.isArray(epg) ? epg : []).filter(httpUrl).map((u) => u.trim())};
    },
    fromDoc(doc) {
      if (!isDict(doc)) return undefined;
      return {m3u: (Array.isArray(doc.m3u) ? doc.m3u : []).filter((x) => isDict(x) && httpUrl(x.url)).map((x) => ({name: String(x.name || x.url).slice(0, 80), url: x.url.trim()})),
              epg: (Array.isArray(doc.epg) ? doc.epg : []).filter(httpUrl).map((u) => u.trim())};
    },
    // 6.2.0: toDoc(p, base, curOwn): p = this browser's projection, base = the account's iptv.json, curOwn = this
    // browser's bn_iptv_own (optional, for the exact count of lists it held). The browser held toWeb(fromDoc(base));
    // an entry it held and p lacks was removed here; every other entry of base (past the cap, non-http) is kept.
    toDoc(p, base, curOwn) {
      const out = Object.assign({}, isDict(base) ? base : {});
      const old = Array.isArray(out.m3u) ? out.m3u : [];
      const oldEpg = Array.isArray(out.epg) ? out.epg : [];
      const bp = IPTV.fromDoc(out), held = IPTV.toWeb(bp, curOwn);
      const heldUrls = held.own.filter((x) => httpUrl(x.url)).map((x) => x.url), heldEpg = held.epg;
      const m3u = p.m3u.map((e) => Object.assign({}, old.find((x) => isDict(x) && typeof x.url === 'string' && x.url.trim() === e.url) || {}, {name: e.name, url: e.url}));
      for (const x of old) {
        const u = isDict(x) && typeof x.url === 'string' ? x.url.trim() : null;
        if (u !== null && (p.m3u.some((e) => e.url === u) || heldUrls.includes(u))) continue;
        m3u.push(x);
      }
      const epg = p.epg.slice();
      for (const u of oldEpg) {
        const t = typeof u === 'string' ? u.trim() : u;
        if (epg.includes(t) || heldEpg.includes(t)) continue;
        epg.push(u);
      }
      out.m3u = m3u;
      out.epg = epg;
      return out;
    },
    // the projection -> {own, epg} for this browser (file-made lists of this browser kept first, 8 lists at most)
    toWeb(p, curOwn) {
      const rows = (Array.isArray(curOwn) ? curOwn : []).filter((x) => isDict(x) && !httpUrl(x.url) && x.rows);
      return {own: rows.concat(p.m3u.map((e) => ({name: e.name, url: e.url}))).slice(0, 8), epg: p.epg.slice(0, 20)};
    },
  };

  const api = {TWINS, TNCFG, WEB_STORES, LOCAL, LOCAL_RX, KODI_LOCAL_RX, SESSION_RX, CODECS, IPTV, isLocal, botKey, NOVA, TELE, FILES, WEB};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TNTwins = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
