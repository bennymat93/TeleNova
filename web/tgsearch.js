'use strict';
// TeleNova web, WP-2: Telegram file search - the engine's source-finding pipeline (telescope sources.py Finder.find /
// find_free, tgclient.py search / _to_cand) on the browser's own Telegram session (TG.client(), WP-1).
//   find(target)   plan_queries -> global + per-chat search -> _to_cand -> parse -> matcher.evaluate -> language bonus
//                  -> union_dedup (1%) -> order; cached 30 min in IndexedDB (only the list, never a session or key)
//   free(q)        free text search: every video/document hit, filtered by epmatch when the text states S/E
//   aiTitles(text) Gemini smart_search (the synced gemini_key goes in a header, never in the address)
// Provider 'tgsearch': kinds search + source (see MODULES.md). Extra members for telegram.js / tgplay: toCand, message,
// peer, chatVideos, find, free, aiTitles, bots (off by default, phase 2 stub).
(function (TN) {
  if (!TN) return;
  TN.i18n.add({
    he: {tgs_label: 'קבצים בטלגרם', tgs_login: 'כדי לחפש בטלגרם צריך להתחבר.', tgs_noplayer: 'הניגון מטלגרם עדיין לא זמין בגרסת הרשת.',
      tgs_no_ai: 'חיפוש חכם צריך מפתח Gemini (מסונכרן מ-Kodi).', tgs_bots_off: 'חיפוש בבוטים כבוי.'},
    en: {tgs_label: 'Telegram files', tgs_login: 'Sign in to Telegram to search there.', tgs_noplayer: 'Playing from Telegram is not available in the web version yet.',
      tgs_no_ai: 'Smart search needs a Gemini key (synced from Kodi).', tgs_bots_off: 'Bot search is off.'},
    ru: {tgs_label: 'Файлы в Telegram', tgs_login: 'Чтобы искать в Telegram, нужно войти.', tgs_noplayer: 'Воспроизведение из Telegram в веб-версии пока недоступно.',
      tgs_no_ai: 'Для умного поиска нужен ключ Gemini (синхронизируется из Kodi).', tgs_bots_off: 'Поиск через ботов выключен.'},
  });
  const CACHE_MS = 30 * 60 * 1000;
  const S = {max_aliases: 4, max_queries: 6, max_results: 25, rd_max: 15, per_query: 60, per_chat: 30};
  let M = null, E = null;
  async function libs() {
    if (!M) { await TN.load('matcher'); M = self.TNMatcher; }
    if (!E) { await TN.load('epmatch'); E = self.TNEpmatch; }
  }
  async function client() { const TG = await TN.tg(); return {TG, c: await TG.client(), Api: self.GramJS.Api}; }

  // ------------------------------------------------------------ messages -> candidates (tgclient.py _to_cand)
  const msgs = new Map();                      // 'chat:msg' -> {msg, peer}; the last 500, for playback / mirrors
  const peers = new Map();                     // marked chat id -> entity (with its access hash)
  const num = (v) => (v === null || v === undefined ? 0 : Number(String(v)));
  function markedId(peer) {
    if (!peer) return '';
    if (peer.channelId !== undefined) return '-100' + String(peer.channelId);
    if (peer.chatId !== undefined) return '-' + String(peer.chatId);
    if (peer.userId !== undefined) return String(peer.userId);
    return '';
  }
  function entityId(ent) {
    if (!ent) return '';
    const c = ent.className || '';
    if (c.startsWith('Channel')) return '-100' + String(ent.id);
    if (c.startsWith('Chat')) return '-' + String(ent.id);
    return String(ent.id);
  }
  function rememberEntities(list) { for (const e of list || []) { const id = entityId(e); if (id) peers.set(id, e); } }
  function remember(chatId, msgId, msg) {
    const k = chatId + ':' + msgId;
    msgs.delete(k); msgs.set(k, msg);
    while (msgs.size > 500) msgs.delete(msgs.keys().next().value);
  }
  function chatKind(ch) {
    if (!ch) return '';
    if (ch.bot) return 'bot';
    if (ch.broadcast) return 'channel';
    if (ch.title !== undefined) return 'group';
    return 'user';
  }
  function toCand(msg, chat) {
    const media = msg && msg.media;
    const doc = media && (media.document || (media.className === 'Document' ? media : null));
    if (!doc || doc.className !== 'Document') return null;
    const attrs = doc.attributes || [];
    const fa = attrs.find((a) => a.className === 'DocumentAttributeFilename');
    const va = attrs.find((a) => a.className === 'DocumentAttributeVideo');
    const mime = doc.mimeType || '';
    const chatId = markedId(msg.peerId);
    chat = chat || peers.get(chatId) || null;
    let name = (fa && fa.fileName) || '';
    if (!name && mime.startsWith('video/')) name = `video_${msg.id}.${(mime.split('/')[1] || 'mp4').replace(/^x-/, '').replace('quicktime', 'mov').replace('x-matroska', 'mkv')}`;
    remember(chatId, msg.id, msg);
    const title = chat ? (chat.title || [chat.firstName, chat.lastName].filter(Boolean).join(' ')) : '';
    return {
      backend: 'tg', chat_kind: chatKind(chat), chat_id: chatId, msg_id: msg.id, file: name, size: num(doc.size), mime,
      duration: va && va.duration ? Math.trunc(va.duration) : 0, width: (va && va.w) || 0, height: (va && va.h) || 0,
      caption: msg.message || '', chat_title: title || '', chat_username: (chat && chat.username) || null,
      date: msg.date || 0, doc_id: String(doc.id), is_video_attr: !!va && !(va.roundMessage),
    };
  }
  const message = (chatId, msgId) => msgs.get(chatId + ':' + msgId) || null;
  const peer = (chatId) => peers.get(String(chatId)) || null;

  // ------------------------------------------------------------ Telegram calls (tgclient.py search)
  async function searchGlobal(c, Api, q, limit, signal) {
    const out = [];
    let offRate = 0, offPeer = new Api.InputPeerEmpty(), offId = 0;
    while (out.length < limit && !(signal && signal.aborted)) {
      const r = await c.invoke(new Api.messages.SearchGlobal({q, filter: new Api.InputMessagesFilterEmpty(), minDate: 0, maxDate: 0,
        offsetRate: offRate, offsetPeer: offPeer, offsetId: offId, limit: Math.min(50, limit - out.length)}));
      rememberEntities(r.chats); rememberEntities(r.users);
      const ms = r.messages || [];
      for (const m of ms) { const cd = toCand(m); if (cd) out.push(cd); }
      if (ms.length < 20 || r.className === 'messages.Messages') break;
      const last = ms[ms.length - 1];
      offRate = r.nextRate || 0; offId = last.id;
      const pe = peer(markedId(last.peerId));
      if (!pe) break;
      offPeer = await c.getInputEntity(pe).catch(() => null);
      if (!offPeer) break;
    }
    return out;
  }
  async function searchChat(c, Api, ent, q, limit, filter) {
    const r = await c.getMessages(ent, {search: q || undefined, limit, filter: filter ? new Api[filter]() : undefined});
    const out = [];
    rememberEntities([ent]);
    for (const m of r || []) { const cd = toCand(m, ent); if (cd) out.push(cd); }
    return out;
  }
  // chat_videos (tgclient.py): videos, and when few, documents that are videos; newest first; next = offset for more
  async function chatVideos(ref, {offsetId = 0, limit = 50, q = ''} = {}) {
    const {c, Api} = await client();
    const ent = peer(ref) || await c.getEntity(/^-?\d+$/.test(ref) ? bigId(ref) : ref);
    rememberEntities([ent]);
    let out = [], last = 0;
    const take = async (filter, keep) => {
      const r = await c.getMessages(ent, {limit, offsetId, search: q || undefined, filter: new Api[filter]()});
      for (const m of r || []) {
        const cd = toCand(m, ent);
        last = last ? Math.min(last, m.id) : m.id;
        if (cd && keep(cd) && !out.some((x) => x.msg_id === cd.msg_id)) out.push(cd);
      }
    };
    await take('InputMessagesFilterVideo', () => true);
    if (out.length < limit / 2) await take('InputMessagesFilterDocument', (cd) => cd.mime.startsWith('video/') || /\.(mkv|mp4|avi|m4v|webm|ts)$/i.test(cd.file));
    out.sort((a, b) => b.msg_id - a.msg_id);
    return {chat: ent, items: out, next: out.length >= Math.floor(limit / 2) ? last : 0};
  }
  function bigId(ref) {                          // a marked id string -> the number GramJS expects
    try { return self.GramJS.helpers && self.GramJS.helpers.returnBigInt ? self.GramJS.helpers.returnBigInt(ref) : ref; } catch (e) { return ref; }
  }
  async function pool(tasks, n) {              // run async thunks n at a time (the engine's _search_sem)
    const res = [];
    let i = 0;
    await Promise.all(Array.from({length: Math.min(n, tasks.length)}, async () => {
      while (i < tasks.length) { const k = i++; try { res[k] = await tasks[k](); } catch (e) { res[k] = []; } }
    }));
    return res;
  }

  // ------------------------------------------------------------ cache (IndexedDB, never throws)
  const DB = 'tn_tgsearch';
  function idb() {
    return new Promise((ok) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore('c');
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ok(null);
      } catch (e) { ok(null); }
    });
  }
  async function cacheGet(k) {
    const db = await idb();
    if (!db) return null;
    return new Promise((ok) => {
      try {
        const r = db.transaction('c').objectStore('c').get(k);
        r.onsuccess = () => ok(r.result && Date.now() - r.result.t < CACHE_MS ? r.result.v : null);
        r.onerror = () => ok(null);
      } catch (e) { ok(null); }
    });
  }
  async function cachePut(k, v) {
    const db = await idb();
    try { if (db) db.transaction('c', 'readwrite').objectStore('c').put({t: Date.now(), v}, k); } catch (e) {}
  }
  TN.on('clearcache', async () => { const db = await idb(); try { if (db) db.transaction('c', 'readwrite').objectStore('c').clear(); } catch (e) {} });

  // ------------------------------------------------------------ the pipeline
  function langPref() {
    const cl = String((TN.settings.synced() || {}).content_lang || '0');
    return {1: 'he', 2: 'en', 3: 'ru'}[cl] || TN.lang();
  }
  function pinnedChats() { const p = TN.get('tg_pins', []); return Array.isArray(p) ? p : []; }
  // target: {kind:'movie'|'episode', aliases[], year, season, episode, runtime, total_seasons}
  async function find(target, {signal, refresh, strict = true, onProgress} = {}) {
    await libs();
    const key = 'f:' + JSON.stringify([target.kind, target.aliases, target.year, target.season, target.episode, strict]);
    if (!refresh) { const hit = await cacheGet(key); if (hit) return hit; }
    const {c, Api} = await client();
    const queries = M.planQueries(target, S);
    const pins = pinnedChats();
    const tasks = [];
    for (const q of queries) {
      tasks.push(() => searchGlobal(c, Api, q, S.per_query, signal));
      for (const p of pins) tasks.push(async () => searchChat(c, Api, peer(p.id) || await c.getEntity(p.username || bigId(p.id)), q, S.per_chat));
    }
    let done = 0;
    const lists = await pool(tasks.map((t) => async () => { const r = await t(); if (onProgress) onProgress(++done, tasks.length); return r; }), 3);
    const seen = new Set(), rows = [];
    const pref = langPref();
    for (const cd of lists.flat()) {
      const k = cd.chat_id + ':' + cd.msg_id;
      if (seen.has(k)) continue;
      seen.add(k);
      cd.parsed = M.parse(cd.file, cd.caption, cd.chat_title);
      cd.ext = cd.parsed.ext;
      const [verdict, score, reasons] = M.evaluate(cd, target, strict);
      if (verdict === 'reject') continue;
      cd.verdict = verdict; cd.reasons = reasons;
      cd.score = score + M.languageBonus(cd.parsed.langs, pref) + (verdict === 'accept' ? 20 : 0);
      rows.push(cd);
    }
    rows.sort((a, b) => b.score - a.score);
    const [deduped] = M.unionDedup(rows);
    const out = M.orderGroups(deduped, S.max_results, S.rd_max).map(slim);
    await cachePut(key, out);
    return out;
  }
  function slim(cd) {                          // what is kept / handed on: no Message objects
    const p = cd.parsed || {};
    return {backend: cd.backend, chat_id: cd.chat_id, msg_id: cd.msg_id, chat_title: cd.chat_title, chat_username: cd.chat_username,
      file: cd.file, size: cd.size, mime: cd.mime, duration: cd.duration, caption: (cd.caption || '').slice(0, 400), date: cd.date,
      doc_id: cd.doc_id, score: cd.score || 0, verdict: cd.verdict || '', also: cd.also, mirrors: cd.mirrors,
      quality: p.quality || 0, langs: p.langs || [], source: p.source || '', season: p.season, episode: p.episode, year: p.year};
  }
  // free text (sources.py find_free): every video file the search gives; S/E in the text must match exactly
  async function free(q, {signal, limit = 60} = {}) {
    await libs();
    const key = 'q:' + q.toLowerCase().trim();
    const hit = await cacheGet(key);
    if (hit) return hit;
    const {c, Api} = await client();
    const want = E.wanted(q);
    const show = q.replace(/\bS\d{1,2}\s*E\d{1,3}\b|\b\d{1,2}x\d{2,3}\b|עונה\s*\d+|פרק\s*\d+|\d+\s*сезон|\d+\s*серия/giu, ' ').replace(/\s+/g, ' ').trim();
    const qs = [q];
    if (show && show !== q) qs.push(show);
    const lists = await pool(qs.map((x) => () => searchGlobal(c, Api, x, limit, signal)), 2);
    const seen = new Set(), rows = [];
    for (const cd of lists.flat()) {
      const k = cd.chat_id + ':' + cd.msg_id;
      if (seen.has(k)) continue;
      seen.add(k);
      cd.parsed = M.parse(cd.file, cd.caption, cd.chat_title);
      cd.ext = cd.parsed.ext;
      if (!M.isVideoFile(cd) || cd.parsed.is_junk || cd.parsed.is_archive || cd.parsed.is_trailer) continue;
      if (!E.matches(want, cd.file, cd.caption)) continue;
      if (want[0] !== null || want[1] !== null) { if (show && !E.mentions(show, cd.file, cd.caption)) continue; }
      const [score] = M.bestTitleScore(cd.parsed.titles, [show || q]);
      cd.score = score * 50 + (cd.parsed.quality ? 5 : 0) + M.languageBonus(cd.parsed.langs, langPref());
      rows.push(cd);
    }
    rows.sort((a, b) => b.score - a.score);
    const out = M.unionDedup(rows)[0].slice(0, limit).map(slim);
    await cachePut(key, out);
    return out;
  }

  // ------------------------------------------------------------ AI search (gemini.py smart_search)
  async function aiTitles(text, {signal} = {}) {
    const key = String((TN.settings.synced() || {}).gemini_key || '').trim();
    if (!key) throw new Error(TN.t('tgs_no_ai'));
    const prompt = `The user of a movie/TV app typed (any language): "${String(text).replace(/"/g, "'")}".\n` +
      'Identify up to 8 real movies or TV series that best fit. Return JSON ' +
      '{"items": [{"title": english title, "year": number|null, "type": "movie"|"tv"}]}';
    const body = JSON.stringify({contents: [{role: 'user', parts: [{text: prompt}]}],
      generationConfig: {responseMimeType: 'application/json', maxOutputTokens: 1024}});
    let last = null;
    for (const model of ['gemini-flash-lite-latest', 'gemini-flash-latest']) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': key}, body, signal});
        if (!r.ok) { last = new Error('Gemini ' + r.status); continue; }
        const j = await r.json();
        const txt = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text || '').join('');
        const data = JSON.parse(txt.replace(/^```(?:json)?|```$/g, '').trim());
        const items = Array.isArray(data) ? data : (data && data.items) || [];
        return items.filter((it) => it && it.title).map((it) => ({title: String(it.title), year: it.year || null, type: it.type === 'tv' ? 'tv' : 'movie'}));
      } catch (e) { if (e.name === 'AbortError') throw e; last = e; }
    }
    throw new Error(String((last && last.message) || 'Gemini').replace(/key=[^&\s]+/gi, 'key=***'));
  }

  // ------------------------------------------------------------ bots (plan row 31): phase 2, off by default
  const bots = {
    enabled: () => TN.settings.get('tgsearch_bots', false) === true,
    async ask() { throw new Error(TN.t('tgs_bots_off')); },
  };

  // ------------------------------------------------------------ provider glue
  function sizeText(b) { return b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.round(b / 1048576) + ' MB'; }
  function rowSub(r) {
    return [r.quality ? r.quality + 'p' : '', sizeText(r.size || 0), r.duration ? Math.round(r.duration / 60) + '′' : '', r.chat_title,
      (r.also || []).length ? '+' + r.also.length : ''].filter(Boolean).join(' · ');
  }
  async function play(r, title) {
    const pl = await TN.provider('player').catch(() => null);
    if (pl && pl.open) return pl.open({tg: r, title: title || r.file, resumeKey: 'tg:' + r.chat_id + ':' + r.msg_id});
    TN.modal(`<p class="msg">${TN.esc(TN.t('tgs_noplayer'))}</p><p dir="auto">${TN.esc(r.file)}</p>` +
      (r.chat_username ? `<p><a class="btn" target="_blank" rel="noopener" href="https://t.me/${encodeURIComponent(r.chat_username)}/${r.msg_id}">t.me</a></p>` : ''));
  }
  async function loggedIn() { try { const TG = await TN.tg(); return !!(TG.connected() || TG.hasSession()); } catch (e) { return false; } }
  async function targetFor(req) {
    const kind = req.type === 'tv' || req.season ? 'episode' : 'movie';
    const t = {kind, aliases: [req.title].filter(Boolean), year: req.year, season: req.season, episode: req.episode, runtime: 0, total_seasons: 1};
    if (req.id && TN.hasTmdbKey()) {
      try {
        const m = req.type === 'tv' ? 'tv' : 'movie';
        const d = await TN.tmdb(`/${m}/${req.id}`, {append_to_response: 'translations'});
        const names = [d.title || d.name, d.original_title || d.original_name];
        for (const tr of (d.translations && d.translations.translations) || []) {
          if (['he', 'ru', 'en'].includes(tr.iso_639_1)) names.push((tr.data || {}).title || (tr.data || {}).name);
        }
        t.aliases = [...new Set(t.aliases.concat(names).filter(Boolean))];
        t.year = t.year || parseInt((d.release_date || d.first_air_date || '').slice(0, 4), 10) || null;
        t.runtime = d.runtime || (d.episode_run_time || [])[0] || 0;
        t.total_seasons = d.number_of_seasons || 1;
      } catch (e) {}
    }
    return t;
  }
  TN.registerProvider('tgsearch', {
    kinds: ['search', 'source'], label: TN.t('tgs_label'),
    async search(q, {signal, limit = 40} = {}) {
      if (!q || !(await loggedIn())) return [];
      const rows = await free(q, {signal, limit});
      return rows.map((r) => ({title: r.file, sub: rowSub(r), img: '', kind: 'tg', score: r.score, tg: r, open: () => play(r)}));
    },
    async sources(req, {signal} = {}) {
      if (!(await loggedIn())) return [];
      const rows = await find(await targetFor(req), {signal});
      return rows.map((r) => ({label: r.file, quality: r.quality, lang: (r.langs || []).join(','), size: r.size, tg: r,
        open: () => play(r, req.title)}));
    },
    // for telegram.js / tgplay / the player
    toCand, message, peer, chatVideos, find, free, aiTitles, bots, play, rowSub, targetFor, rememberEntities, entityId,
    planQueries: (t) => (M ? M.planQueries(t, S) : []), libs,
  });
})(self.TN);
