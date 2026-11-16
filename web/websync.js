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
(function (root) {
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

    // one round -> {state: 'nodoc' | 'idle' | 'unreadable' | 'ok', pulled, pushed, users, data: [user ids whose lists changed here]}
    async function cycle(host, now) {
      now = Math.floor(now != null ? now : Date.now() / 1000);
      const out = {state: 'ok', pulled: false, pushed: false, users: false, data: []};
      const meta = host.loadMeta() || {};
      const item = await host.cloudFind();         // (throws when the account cannot be reached: the caller shows it)
      const mark = markOf(item);
      if (!mark) {                                 // no document yet: a Kodi device founds it (see above)
        out.state = 'nodoc';
        meta.last = now;
        host.saveMeta(meta);
        return out;
      }
      if (mark === meta.cloud_mark && !meta.dirty && sig(host) === meta.sig) {
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
      const merged = SD.merge(localDoc(host), remote);
      if (host.setUsers(merged.users)) out.users = true;
      for (const uid of Object.keys(merged.data)) if (host.putUserData(uid, merged.data[uid])) out.data.push(uid);
      host.takeSettings(reads(merged.settings));
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

    return {cycle, localDoc, sig, reads, markOf, caption, noteOf, mine, DOC_DEVICE, TAG, NOTE, LOCAL, READS};
  }
  const api = {make};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WebSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
