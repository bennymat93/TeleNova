'use strict';
// The sync round of a browser: the build's autosync.cycle (plugin.video.nova/resources/lib/autosync.py) with a
// browser as the device. Same document, same merge (syncdoc.js), same mark of "the document changed" (id:date).
//
// What differs from a Kodi device, on purpose:
//   * a browser owns users and their lists only. It has no build settings and no build files, so it never stamps
//     or changes a setting: settings and files pass through the merge exactly as the account holds them. It READS
//     a few values it can use (the TMDb key, the metadata language) and never one of the device-only ones (LOCAL).
//   * a browser never FOUNDS the document. The device that founds it stamps its settings with the founding time
//     ("its setup IS the account's setup"); a document founded by a browser would make every Kodi device join as a
//     newcomer whose settings carry time 0 and never travel. So with no document in the account the browser waits.
//   * the document is fetched before every upload (the browser keeps no copy of the settings between rounds - they
//     hold the household's keys), and nothing awaits between reading the local lists and writing the merged ones.
// Written against a small host object, so the whole loop is tested in Node without Telegram (src/qa/web/t_store.js)
// and against the build's own loop (src/qa/web/t_mixed.py).
//
// 6.2.0: a browser is a full peer for SETTINGS and FILES too (docs/SYNC-PLAN.md, phase 1, document still v2):
//   * through twins.js every setting / store of this browser that has a Kodi twin is stamped and applied under the
//     build's own ids (nova / telescope / files.iptv.json); the rest of bn_cfg travels in section "web".
//   * bn_sync_meta.set = {"<addon>/<id>": [last seen canonical value, stamp]}: a value changed here gets "now", a value
//     never touched here gets 0 (the join rule): a fresh browser never writes over the account; a value of the account
//     with a newer stamp is applied here. An empty value of the account never erases one this browser holds untouched.
//   * device-only keys (twins.LOCAL) and the Telegram session (twins.SESSION_RX) never enter the document.
//   * still never founds the document (backup.js found() does, on the viewer's request).
//   The settings side needs a "port" to this browser's settings: host.port, else the page's TN (web/app.js). A host
//   with neither (the Node tests of the lists) works exactly as before: settings pass through untouched.
(function (root) {
  const TW = typeof module === 'object' && module.exports ? require('./twins.js') : root.TNTwins;
  const DOC_DEVICE = 'sync-v2', TAG = '#TeleNovaSetup', NOVA = 'plugin.video.nova';
  const NOTE = {device: DOC_DEVICE, name: 'TeleNova sync', build: '', fp: '', v: 1};
  // settings that belong to one device or change by themselves: never synced (autosync.LOCAL)
  const LOCAL = /^(debug|port|deps_zip|wizard_shown|sub_server|lite_done|depov_done|wizard_fix|tune_done|\w+_done|last_\w+|\w+_ts|\w+_time|kodion\..*|.*\.port)$/;
  const READS = ['tmdb_key', 'tmdb_token', 'content_lang'];      // what a browser can use of the household's settings

  function make(SD) {
    function hash(s) {                             // cyrb53: only tells "the local lists changed since the last round"
      let a = 0xdeadbeef, b = 0x41c6ce57;
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
      a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
      b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
      return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36) + ':' + s.length;
    }
    function localDoc(host) {
      const doc = SD.empty();
      doc.users = host.users();
      for (const u of SD.live_users(doc.users)) doc.data[u.id] = host.userData(u.id);
      return doc;
    }
    const sig = (host) => { const d = localDoc(host); return hash(SD.canon([d.users, d.data])); };
    // {tmdb_key, tmdb_token, content_lang} out of the document's settings - values that really are settings (strings), never a LOCAL one
    function reads(settings) {
      const out = {}, nova = SD.get(settings, NOVA);
      for (const k of READS) {
        const pair = SD.get(nova, k);
        if (!LOCAL.test(k) && Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string') out[k] = pair[0];
      }
      return out;
    }
    const markOf = (item) => (item ? item.id + ':' + item.date : '');

    // ---------------------------------------------------------------- 6.2.0: settings and files through twins.js
    const isDict = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
    const isPair = (p) => Array.isArray(p) && p.length === 2;
    const NONE = '\u0000', MAXJ = 65536, CFG_RX = /^[a-z][a-z0-9_]{0,40}$/;
    function browserPort() {                       // the page: TN.settings (bn_cfg) and TN.get / put / drop (bn_*)
      const TN = root.TN;
      if (!TN || !TN.settings || typeof TN.settings.set !== 'function' || typeof TN.get !== 'function' || typeof TN.put !== 'function') return null;
      return {cfgKeys: () => Object.keys(TN.get('cfg', {}) || {}), cfgGet: (k) => TN.settings.get(k, undefined), cfgSet: (k, v) => TN.settings.set(k, v),
              get: (n) => TN.get(n, undefined), put: (n, v) => TN.put(n, v), drop: (n) => (TN.drop ? TN.drop(n) : TN.put(n, null))};
    }
    const portOf = (host) => (host && 'port' in host ? host.port : browserPort());
    const banned = (k) => !k || TW.SESSION_RX.test(k) || TW.isLocal(k) || LOCAL.test(String(k).replace(/^bn[:_]/, ''));
    // unit: {id, addon, kid, wk, codec, flags}; wk 'name' (cfg) | 'bn:name' | 'bn:name.field'
    function units(port, remote) {
      const out = [], twinned = new Set();
      for (const [wk, addon, kid, codec, flags] of TW.TWINS) {
        if (banned(kid) || TW.SESSION_RX.test(wk)) continue;
        twinned.add(wk);
        out.push({id: addon + '/' + kid, addon, kid, wk, codec, flags});
      }
      const webKeys = new Set();
      for (const k of port.cfgKeys()) if (CFG_RX.test(k) && !twinned.has(k) && !banned(k)) webKeys.add(k);
      for (const n of TW.WEB_STORES) if (!banned(n)) webKeys.add('bn_' + n);
      const rw = remote && isDict(remote.settings) ? SD.get(remote.settings, TW.WEB) : undefined;   // what other browsers sent
      if (isDict(rw)) for (const k of Object.keys(rw)) if (CFG_RX.test(k) && !twinned.has(k) && !banned(k)) webKeys.add(k);
      for (const k of webKeys) {
        if (k.startsWith('bn_') && !TW.WEB_STORES.includes(k.slice(3))) continue;      // only the listed stores of this browser
        out.push({id: TW.WEB + '/' + k, addon: TW.WEB, kid: k, wk: k.startsWith('bn_') ? 'bn:' + k.slice(3) : k, codec: 'json', flags: ''});
      }
      return out;
    }
    function readWeb(port, wk) {                   // this browser's value of a web key
      if (!wk.startsWith('bn:')) return port.cfgGet(wk);
      const [name, field] = wk.slice(3).split('.');
      const v = port.get(name);
      return field ? (isDict(v) ? v[field] : undefined) : v;
    }
    function project(port, u, old) {               // this browser's value in the document's form (undefined: none); old: the account's value
      if (u.codec === 'iptv') {
        const own = port.get('iptv_own'), epg = port.get('epg_own');
        return own === undefined && epg === undefined ? undefined : TW.IPTV.fromWeb(own, epg);
      }
      const v = readWeb(port, u.wk);
      if (v === undefined || v === null) return undefined;
      if (u.codec === 'json') return SD.canon(v).length > MAXJ ? undefined : v;
      return TW.CODECS[u.codec].enc(v, old);         // 6.2.0: enc(local, oldAccountValue) - an extra argument is harmless
    }
    const docProject = (u, v) => (u.codec === 'iptv' ? TW.IPTV.fromDoc(v) : v);
    const canonOf = (v) => (v === undefined ? NONE : SD.canon(v));
    const emptyish = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ||
      (isDict(v) && Array.isArray(v.m3u) && !v.m3u.length && !(v.epg || []).length);
    function sectionOf(doc, u, make) {
      if (!isDict(doc)) return undefined;
      if (u.addon === TW.FILES) { if (make && !isDict(doc.files)) doc.files = SD.dict(); return doc.files; }
      if (make) { if (!isDict(doc.settings)) doc.settings = SD.dict(); if (!isDict(doc.settings[u.addon])) doc.settings[u.addon] = SD.dict(); }
      return isDict(doc.settings) ? SD.get(doc.settings, u.addon) : undefined;
    }
    function pairOf(doc, u) { const s = sectionOf(doc, u, false); const p = isDict(s) ? SD.get(s, u.kid) : undefined; return isPair(p) ? p : undefined; }
    const st = (p) => Number(p && p[1]) || 0;
    const SKEW = 600;                              // 6.2.0: an account stamp more than 10 minutes ahead is a broken clock
    // 6.2.0: the stamp for the one key written now - after the account's stamp of that key only (a slow clock never loses
    // forever), never pushed up by another key's skewed stamp
    const stampFor = (now, R) => Math.max(now, Math.min(Math.floor(st(R)), now + SKEW) + 1);   // clamped to now + 10 minutes
    // 6.2.0: what a value deleted here becomes in the account ('' / an empty projection); undefined: no empty form
    function emptyOf(u) {
      if (u.codec === 'iptv') return TW.IPTV.fromWeb([], []);
      return ['s', 'nl', 'pins', 'bots'].includes(u.codec) ? '' : undefined;
    }
    // stamp this browser's values against meta.set; the ones the account should take go into doc (this browser's side)
    function stampInto(port, meta, remote, doc, now) {
      const first = !isDict(meta.set), ms = first ? {} : meta.set;
      for (const u of units(port, remote)) {
        if (u.flags.includes('r')) continue;                        // read only (the Telegram app id): never sent
        const R = pairOf(remote, u), stampNow = stampFor(now, R);
        let P = project(port, u, R ? R[0] : undefined), m = ms[u.id];
        // 6.2.0: deleted here (was held, now gone): the account gets the empty form so Kodi clears it too
        if (P === undefined && isPair(m) && m[0] !== NONE) { const e = emptyOf(u); if (e !== undefined) P = e; }
        const c = canonOf(P);
        if (!isPair(m)) m = [c, first || P === undefined ? 0 : stampNow];   // first look: untouched here (the join rule); a key new since: set here
        else if (m[0] !== c) m = [c, stampNow];                     // changed here since the last round
        // joining never erases - 6.2.0: only on this browser's first look and only over an empty value the account never
        // stamped; an account value cleared on purpose (stamp > 0) wins
        if (first && m[1] === 0 && R && st(R) === 0 && !emptyish(P) && emptyish(docProject(u, R[0]))) m = [c, stampNow];
        ms[u.id] = m;
        if (P === undefined || (u.flags.includes('m') && !R)) continue;
        if (!R || m[1] > st(R)) sectionOf(doc, u, true)[u.kid] = [u.codec === 'iptv' ? TW.IPTV.toDoc(P, R && R[0]) : P, m[1]];
      }
      meta.set = ms;
    }
    function okJson(k, v, cur) {                   // a section "web" value is taken only in the shape this browser uses
      if (v === undefined || v === null || banned(k) || SD.canon(v).length > MAXJ) return false;
      if (k === 'bn_tg_link') return typeof v === 'string' && /^[\w-]{40,64}$/.test(v);
      // 6.2.0: the cfg keys that matter are checked one by one
      if (k === 'lang') return ['he', 'en', 'ru'].includes(v);
      if (k === 'live') return typeof v === 'string' && /^[\w-]{1,32}$/.test(v);
      if (k === 'radio') return typeof v === 'string' && /^[A-Z]{2}$/.test(v);
      if (k === 'theme') return ['auto', 'light', 'dark'].includes(v);
      if (k === 'helper') return typeof v === 'string' && v.length < 2048 && /^https:\/\/[^\s]+$/i.test(v);
      const prim = ['string', 'number', 'boolean'].includes(typeof v);
      if (!k.startsWith('bn_') && !prim) return false;               // 6.2.0: an unknown cfg value only as a primitive
      if (cur === undefined || cur === null) return prim || typeof v === 'object';
      return typeof v === typeof cur && Array.isArray(v) === Array.isArray(cur);
    }
    // the merged document's newer values -> this browser. -> [web keys written]
    function applyFrom(port, meta, merged) {
      const ms = isDict(meta.set) ? meta.set : (meta.set = {}), done = [], groups = new Map();
      for (const u of units(port, merged)) {
        const g = u.wk.split('.')[0];
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(u);
      }
      for (const [g, us] of groups) {
        const newer = [];
        for (const u of us) {
          const M = pairOf(merged, u);
          if (!M) continue;
          const m = isPair(ms[u.id]) ? ms[u.id] : [NONE, 0];
          if (u.flags.includes('r') ? emptyish(readWeb(port, u.wk)) : st(M) > m[1]) newer.push([u, M]);
        }
        if (!newer.length) continue;
        let wrote = false;
        if (us[0].wk.includes('.')) {                              // one store object from several Kodi ids
          const name = g.slice(3), cur = port.get(name), obj = Object.assign({}, isDict(cur) ? cur : {});
          for (const [u, M] of newer) { const f = u.wk.split('.')[1], v = TW.CODECS[u.codec].dec(M[0], obj[f]); if (v !== undefined) obj[f] = v; }
          if (name === 'tg_api') {
            if (/^\d{3,12}$/.test(String(obj.id || '')) && /^[0-9a-f]{32}$/i.test(String(obj.hash || ''))) { port.put(name, {id: String(obj.id), hash: String(obj.hash).toLowerCase()}); wrote = true; }
          } else if (name === 'rd_auth') {
            if (!obj.cid && !obj.sec && !obj.refresh) port.drop(name); else port.put(name, Object.assign(obj, {exp: 1}));   // the new refresh token is used at once
            wrote = true;
          } else { port.put(name, obj); wrote = true; }
        } else {
          newer.sort((a, b) => st(b[1]) - st(a[1]));               // mirrors: the newest of them
          const [u, M] = newer[0];
          const cur = u.codec === 'iptv' ? port.get('iptv_own') : readWeb(port, u.wk);
          let v;
          if (u.codec === 'iptv') { const p = TW.IPTV.fromDoc(M[0]); v = p && TW.IPTV.toWeb(p, cur); }
          else if (u.codec === 'json') v = okJson(u.kid, M[0], cur) ? M[0] : undefined;
          else v = TW.CODECS[u.codec].dec(M[0], cur);
          if (v !== undefined) {
            if (u.codec === 'iptv') { port.put('iptv_own', v.own); port.put('epg_own', v.epg); }
            else if (u.wk.startsWith('bn:')) port.put(u.wk.slice(3), v);
            else port.cfgSet(u.wk, v);
            wrote = true;
          }
        }
        if (!wrote) continue;
        done.push(g);
        for (const u of us) {                                        // what this browser holds now, at the account's stamp
          if (u.flags.includes('r')) continue;
          const old = isPair(ms[u.id]) ? ms[u.id][1] : 0;
          ms[u.id] = [canonOf(project(port, u)), Math.max(old, st(pairOf(merged, u)))];
        }
      }
      return done;
    }
    const ssig = (port) => hash(SD.canon(units(port, null).map((u) => [u.id, canonOf(project(port, u))])));
    // 6.2.0: what the page reads of the account's settings (TN.settings.synced()) - an allowlist: READS plus the ids the
    // page actually reads (subs.js / aisubs.js / catalog.js / library.js / telegram.js / tgsearch.js). Nothing else reaches bn_synced.
    const PAGE_READS = ['gemini_key', 'gemini_model', 'os_key', 'opensubs_key', 'chiko_keywords', 'pinned_chats', 'bots'];
    const SECRET_RX = /(_token|_secret|secret|_hash|^hash$|refresh|password|_pass|cookie)/i;
    function syncedMap(settings) {
      const out = {};
      for (const a of ['service.subtitles.All_Subs', TW.TELE, NOVA]) {
        const sec = SD.get(settings, a);
        if (!isDict(sec)) continue;
        for (const k of PAGE_READS) {
          const p = SD.get(sec, k);
          if (!(k in out) && isPair(p) && typeof p[0] === 'string' && p[0] && !SECRET_RX.test(k)) out[k] = p[0];
        }
      }
      return Object.assign(out, reads(settings));
    }

    // one round -> {state: 'nodoc' | 'idle' | 'unreadable' | 'ok', pulled, pushed, users, data: [user ids whose lists changed here]}
    async function cycle(host, now) {
      now = Math.floor(now != null ? now : Date.now() / 1000);
      const out = {state: 'ok', pulled: false, pushed: false, users: false, data: []};
      const meta = host.loadMeta() || {};
      const port = portOf(host);
      const item = await host.cloudFind();         // (throws when the account cannot be reached: the caller shows it)
      const mark = markOf(item);
      if (!mark) {                                 // no document yet: a Kodi device founds it (see above)
        out.state = 'nodoc';
        meta.last = now;
        host.saveMeta(meta);
        return out;
      }
      if (mark === meta.cloud_mark && !meta.dirty && sig(host) === meta.sig && (!port || ssig(port) === meta.ssig)) {
        out.state = 'idle';                        // nothing changed here or there: nothing is fetched, nothing is sent
        meta.last = now;
        host.saveMeta(meta);
        return out;
      }
      const remote = await host.cloudGet(item);
      if (!remote) {                               // could not read it now: the next round tries again
        out.state = 'unreadable';
        return out;
      }
      out.pulled = true;
      // from here to the upload nothing waits: what the viewer does meanwhile lands either in this merge or in the next round
      const mine = localDoc(host);
      if (port) stampInto(port, meta, remote, mine, now);        // 6.2.0
      const merged = SD.merge(mine, remote);
      if (host.setUsers(merged.users)) out.users = true;
      for (const uid of Object.keys(merged.data)) if (host.putUserData(uid, merged.data[uid])) out.data.push(uid);
      if (port) { out.settings = applyFrom(port, meta, merged); meta.ssig = ssig(port); }
      host.takeSettings(port ? syncedMap(merged.settings) : reads(merged.settings));
      meta.sig = sig(host);
      meta.cloud_mark = mark;
      meta.last = now;
      meta.dirty = !SD.same(merged, remote);       // this browser has something the account does not
      host.saveMeta(meta);
      if (meta.dirty) {
        const put = await host.cloudPut(merged, item);
        if (put) {
          out.pushed = true;
          const m2 = host.loadMeta() || meta;
          m2.cloud_mark = put;
          m2.dirty = false;
          host.saveMeta(m2);
        }
      }
      return out;
    }

    // caption of the document's message <-> its note; the list of an account's files -> the shared document (newest)
    const caption = (note) => TAG + ' ' + '{' + Object.keys(note).sort().map((k) => JSON.stringify(k) + ': ' + JSON.stringify(note[k])).join(', ') + '}';
    function noteOf(text) {
      if (typeof text !== 'string' || !text.startsWith(TAG)) return null;
      try { const n = JSON.parse(text.slice(TAG.length).trim() || '{}'); return n !== null && typeof n === 'object' && !Array.isArray(n) ? n : {}; } catch (e) { return {}; }
    }
    const mine = (items) => items.filter((it) => it.note && it.note.device === DOC_DEVICE).sort((a, b) => b.date - a.date)[0] || null;

    return {cycle, localDoc, sig, reads, markOf, caption, noteOf, mine, DOC_DEVICE, TAG, NOTE, LOCAL, READS,
            units, project, stampInto, applyFrom, syncedMap, browserPort, TWINS: TW.TWINS, SESSION_RX: TW.SESSION_RX};
  }
  const api = {make};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WebSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
