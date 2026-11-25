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
  // settings that belong to one device or change by themselves: never synced (autosync.LOCAL - 6.3.0: the one copy in twins.js)
  const LOCAL = TW.KODI_LOCAL_RX;
  const MAX_SKEW = 7 * 86400;
  // 6.3.0 (P2): the keys and tokens that travel in the sealed envelope (syncseal.py SECRET_RX)
  const SEAL_RX = /(_key$|token|secret|_hash$|^hash$|refresh|password|_pass$|cookie)/i;
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
    // this browser's value in the document's form (undefined: none); old: the account's value; last: what this browser
    // held when it last looked (6.3.0, B1: a pin removed here is not merged back from the account)
    function project(port, u, old, last) {
      if (u.codec === 'iptv') {
        const own = port.get('iptv_own'), epg = port.get('epg_own');
        return own === undefined && epg === undefined ? undefined : TW.IPTV.fromWeb(own, epg);
      }
      const v = readWeb(port, u.wk);
      if (v === undefined || v === null) return undefined;
      if (u.codec === 'json') return SD.canon(v).length > MAXJ ? undefined : v;
      return TW.CODECS[u.codec].enc(v, old, last);
    }
    // 6.3.0 (B1): the pins this browser itself holds, as tokens (never the account's ones it merged back)
    function held(port, u) {
      if (u.codec !== 'pins') return undefined;
      const s = TW.CODECS.pins.enc(readWeb(port, u.wk));
      return typeof s === 'string' ? s.split(',').map((x) => x.trim()).filter(Boolean) : [];
    }
    // 6.5.0: every keyed list kept in this unit (iptv.json holds two: iptv and epg)
    const keyedSpecs = (u) => SD.KEYED.filter((s) => (s[1] === u.addon || (u.addon === TW.FILES && s[1] === 'files')) && s[2] === u.kid);
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
    // 6.3.0 (L1): the stamp for the one key written now (now = the account's clock, as learned) - after the account's
    // stamp of that key only (a slow clock never loses), never pushed up by another key's stamp; an account stamp
    // more than a day ahead counts as a day ahead (a broken writer)
    const stampFor = (now, R) => Math.max(now, Math.min(Math.floor(st(R)), now + SD.DAY) + 1);
    // 6.2.0: what a value deleted here becomes in the account ('' / an empty projection); undefined: no empty form
    function emptyOf(u) {
      if (u.codec === 'iptv') return TW.IPTV.fromWeb([], []);
      return ['s', 'nl', 'pins', 'bots'].includes(u.codec) ? '' : undefined;
    }
    // stamp this browser's values against meta.set; the ones the account should take go into doc (this browser's side)
    function stampInto(port, meta, remote, doc, now) {
      const first = !isDict(meta.set), ms = first ? {} : meta.set;
      const hs = isDict(meta.held) ? meta.held : (meta.held = {});
      const kl = isDict(meta.keyed_last) ? meta.keyed_last : {};
      for (const u of units(port, remote)) {
        if (u.flags.includes('r')) continue;                        // read only (the Telegram app id): never sent
        const R = pairOf(remote, u), stampNow = stampFor(now, R);
        let P = project(port, u, R ? R[0] : undefined, hs[u.id]), m = ms[u.id];
        if (u.codec === 'pins') hs[u.id] = held(port, u);
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
        const flat = u.codec === 'iptv' ? TW.IPTV.toDoc(P, R && R[0]) : P;
        if (!R || m[1] > st(R)) sectionOf(doc, u, true)[u.kid] = [flat, m[1]];
        // 6.3.0 (P1): a keyed list: what changed here since this browser last held it, item by item
        for (const spec of keyedSpecs(u)) {
          const ops = SD.keyed_ops(spec, kl[spec[0]], flat, m[1]);
          if (Object.keys(ops).length) {
            if (!isDict(doc.keyed)) doc.keyed = SD.dict();
            doc.keyed[spec[0]] = Object.assign(SD.dict(), isDict(doc.keyed[spec[0]]) ? doc.keyed[spec[0]] : {}, ops);
          }
        }
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
    // forced: unit ids of keyed lists - written whenever the account's list differs from this browser's (their stamp
    // is the newest item's, which can equal this browser's own stamp)
    function applyFrom(port, meta, merged, forced) {
      const ms = isDict(meta.set) ? meta.set : (meta.set = {}), done = [], groups = new Map();
      const hs = isDict(meta.held) ? meta.held : (meta.held = {});
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
          const differs = () => forced && forced.has(u.id) && canonOf(docProject(u, M[0])) !== m[0];
          if (u.flags.includes('r') ? emptyish(readWeb(port, u.wk)) : st(M) > m[1] || differs()) newer.push([u, M]);
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
          const old = isPair(ms[u.id]) ? ms[u.id][1] : 0, M = pairOf(merged, u);
          // 6.3.0 (B1): projected against the account's value, so the account's pins this browser cannot hold are counted in
          ms[u.id] = [canonOf(project(port, u, M ? M[0] : undefined)), Math.max(old, st(M))];
          if (u.codec === 'pins') hs[u.id] = held(port, u);
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

    // ---------------------------------------------------------------- 6.3.0 (P2): the secrets envelope (syncseal.py, same bytes)
    const subtle = () => (root.crypto && root.crypto.subtle) || null;
    const utf8 = (s) => new TextEncoder().encode(s);
    const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return root.btoa(s); };
    const unb64 = (t) => { const s = root.atob(String(t)); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
    const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
    const hkey = (raw) => subtle().importKey('raw', raw, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
    const sign = async (k, data) => new Uint8Array(await subtle().sign('HMAC', k, data));
    const keyCache = new Map();
    async function sealKeys(pass, salt, rounds) {
      const ck = pass + '\u0000' + b64(salt) + '\u0000' + rounds;
      if (!keyCache.has(ck)) {
        if (keyCache.size > 8) keyCache.clear();
        const base = await subtle().importKey('raw', utf8(pass), 'PBKDF2', false, ['deriveBits']);
        const raw = new Uint8Array(await subtle().deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds}, base, 512));
        keyCache.set(ck, [await hkey(raw.slice(0, 32)), await hkey(raw.slice(32))]);
      }
      return keyCache.get(ck);
    }
    async function xorStream(kEnc, nonce, data) {
      const out = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i += 32) {
        const ctr = new Uint8Array(8);
        let n = i / 32;
        for (let j = 7; j >= 0; j--) { ctr[j] = n % 256; n = Math.floor(n / 256); }
        const block = await sign(kEnc, cat(nonce, ctr));
        for (let j = 0; j < 32 && i + j < data.length; j++) out[i + j] = data[i + j] ^ block[j];
      }
      return out;
    }
    async function seal(pairs, pass, salt, rounds = 200000) {
      salt = salt || root.crypto.getRandomValues(new Uint8Array(16));
      const [kEnc, kMac] = await sealKeys(pass, salt, rounds);
      const plain = utf8(SD.canon(pairs));
      const nonce = (await sign(kMac, cat(utf8('nonce'), plain))).slice(0, 16);
      const data = await xorStream(kEnc, nonce, plain);
      const tag = await sign(kMac, cat(utf8('TNSEC1'), salt, nonce, data));
      return {v: 1, kdf: rounds, salt: b64(salt), nonce: b64(nonce), data: b64(data), seal: b64(tag)};
    }
    async function openEnv(env, pass) {            // -> {aid: {key: [value, time]}} or null
      if (!pass || !isDict(env) || Number(env.v) !== 1 || !subtle()) return null;
      try {
        const salt = unb64(env.salt), nonce = unb64(env.nonce), data = unb64(env.data), tag = unb64(env.seal);
        const rounds = Number(env.kdf) || 200000;
        if (rounds < 10000 || rounds > 5000000) return null;
        const [kEnc, kMac] = await sealKeys(pass, salt, rounds);
        const want = await sign(kMac, cat(utf8('TNSEC1'), salt, nonce, data));
        if (want.length !== tag.length || want.some((x, i) => x !== tag[i])) return null;
        const out = SD.parse(new TextDecoder().decode(await xorStream(kEnc, nonce, data)));
        return isDict(out) ? out : null;
      } catch (e) { return null; }
    }
    function takeSecrets(settings) {               // removes the secret keys (in place) -> {aid: {key: pair}}
      const out = SD.dict();
      if (!isDict(settings)) return out;
      for (const aid of Object.keys(settings)) {
        const keys = settings[aid];
        if (!isDict(keys)) continue;
        for (const k of Object.keys(keys)) if (SEAL_RX.test(k)) { if (!out[aid]) out[aid] = SD.dict(); out[aid][k] = keys[k]; delete keys[k]; }
      }
      return out;
    }
    // 6.3.0 (L1): the account's clock as this browser learned it (whole seconds), and one more sample of it
    const skewOf = (meta) => (typeof meta.skew === 'number' && Math.abs(meta.skew) <= MAX_SKEW ? Math.floor(meta.skew + 0.5) : 0);
    function learnSkew(meta, t0, t1, mark) {
      const srv = Number(String(mark).split(':').pop());
      if (!(srv > 0) || !(t1 - t0 >= 0 && t1 - t0 <= 30)) return;
      const s = srv - (t0 + t1) / 2;
      if (Math.abs(s) > MAX_SKEW) return;
      meta.skew = Math.round((typeof meta.skew === 'number' ? 0.7 * meta.skew + 0.3 * s : s) * 100) / 100;
    }
    function rid() {
      const a = new Uint8Array(6);
      if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a); else for (let i = 0; i < 6; i++) a[i] = Math.floor(Math.random() * 256);
      return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
    }

    // one round -> {state: 'nodoc' | 'idle' | 'unreadable' | 'ok' | 'update', pulled, pushed, users, data: [user ids whose lists changed here], locked}
    async function cycle(host, now) {
      now = Math.floor(now != null ? now : Date.now() / 1000);
      const out = {state: 'ok', pulled: false, pushed: false, users: false, data: [], locked: false};
      const meta = host.loadMeta() || {};
      now += skewOf(meta);                         // 6.3.0 (L1)
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
      const remoteAsIs = SD.copy(remote);
      // 6.3.0 (P2): open the account's envelope (async: before the part where nothing waits)
      const pw = (host.passphrase ? await host.passphrase() : '') || '';
      const env = isDict(SD.get(remote, 'secrets')) ? remote.secrets : null;
      let opened = null;
      if (env) {
        opened = await openEnv(env, pw);
        if (opened) {
          delete remote.secrets;
          if (!isDict(remote.settings)) remote.settings = SD.dict();
          for (const aid of Object.keys(opened)) if (isDict(opened[aid])) remote.settings[aid] = SD.merge_stamped(SD.get(remote.settings, aid), opened[aid]);
        } else out.locked = true;
      }
      // from here to the upload nothing waits: what the viewer does meanwhile lands either in this merge or in the next round
      const mine = localDoc(host);
      if (!meta.device_id) meta.device_id = rid();             // 6.3.0: this browser in the list of devices
      const want = {sv: SD.LEVEL, kind: 'web', name: String(host.deviceName ? host.deviceName() || '' : '').slice(0, 40)};
      if (!isDict(meta.device) || Object.keys(want).some((k) => meta.device[k] !== want[k])) meta.device = Object.assign({}, want, {at: now});
      mine.devices = SD.dict();
      mine.devices[meta.device_id] = meta.device;
      if (port) stampInto(port, meta, remote, mine, now);        // 6.2.0
      const merged = SD.merge(mine, remote);
      const forced = new Set();
      if (SD.capable(merged)) {                    // 6.3.0 (P1): the keyed lists and their plain values agree
        const kl = isDict(meta.keyed_last) ? meta.keyed_last : (meta.keyed_last = {});
        for (const spec of SD.KEYED) { const items = SD.settle(merged, spec); if (items) kl[spec[0]] = items; }
        if (port) for (const u of units(port, merged)) if (keyedSpecs(u).length) forced.add(u.id);
      } else delete merged.keyed;
      if (host.setUsers(merged.users)) out.users = true;
      for (const uid of Object.keys(merged.data)) if (host.putUserData(uid, merged.data[uid])) out.data.push(uid);
      if (port) { out.settings = applyFrom(port, meta, merged, forced); meta.ssig = ssig(port); }
      host.takeSettings(port ? syncedMap(merged.settings) : reads(merged.settings));
      // 6.3.0 (P2): keys travel sealed when this browser has the passphrase (and every device understands it); next to an
      // envelope it cannot open, its own keys are never put in plain text
      // 6.5.0: an envelope this browser opened is always sealed again (same salt), even while an older device is around
      if (out.locked || (opened && pw && subtle()) || (pw && SD.capable(merged) && subtle())) {
        const secret = takeSecrets(merged.settings);
        if (!out.locked) merged.secrets = await seal(secret, pw, env ? unb64(env.salt) : null);
      }
      meta.sig = sig(host);
      meta.cloud_mark = mark;
      meta.last = now;
      meta.dirty = !SD.same(merged, remoteAsIs);   // this browser has something the account does not
      if (SD.stamp(SD.get(remoteAsIs, 'v')) > SD.VERSION) out.state = 'update';   // 6.3.0 (B3): a later release wrote it: read only
      host.saveMeta(meta);
      if (meta.dirty && out.state !== 'update') {
        const t0 = host.clock ? host.clock() : null;
        const put = await host.cloudPut(merged, item);
        if (put) {
          out.pushed = true;
          const m2 = host.loadMeta() || meta;
          m2.cloud_mark = put;
          m2.dirty = false;
          if (t0 !== null) learnSkew(m2, t0, host.clock(), put);
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
            units, project, stampInto, applyFrom, syncedMap, browserPort, TWINS: TW.TWINS, SESSION_RX: TW.SESSION_RX,
            seal, openEnv, takeSecrets, learnSkew, skewOf, stampFor};
  }
  const api = {make};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WebSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
