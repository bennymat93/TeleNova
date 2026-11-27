'use strict';
// TeleNova web, WP-2: Telegram file search - the engine's source-finding pipeline (telescope sources.py Finder.find /
// find_free, tgclient.py search / _to_cand, tgbots.py) on the browser's own Telegram session (TG.client(), WP-1).
//   find(target)   plan_queries -> global + per-chat search (+ the chosen request bots) -> _to_cand -> parse ->
//                  matcher.evaluate -> language bonus -> union_dedup (1%) -> order; cached 30 min in IndexedDB (only
//                  the list, never a session or key)
//   free(q)        free text search: every video/document hit, filtered by epmatch when the text states S/E;
//                  freeMore(q) reads the next page of Telegram's global search (tgclient.search_more)
//   aiTitles(text) Gemini smart_search (the key goes in a header, never in the address)
//   bots           "request" bots (tgbots.py): list / mark / ask - writes the title in the bot's chat, reads the answers,
//                  presses the fitting buttons, follows t.me links, takes the video files it sends
//   play(row, title, ctx)   through the player service, tracked: history entry 'tg:<chat>:<msg>' (or the title's own key
//                  when ctx.req names a TMDb title), resume key, next episode from the same chat, "another link"
//   linkInfo(url)  what a t.me link points at (a message with a video, a chat, a bot start code, an invite)
// Provider 'tgsearch': kinds search + source (see MODULES.md).
(function (TN) {
  if (!TN) return;
  TN.i18n.add({
    he: {tgs_label: 'קבצים בטלגרם', tgs_login: 'כדי לחפש בטלגרם צריך להתחבר.', tgs_noplayer: 'הנגן לא נטען. בדקו את החיבור ונסו שוב, או פתחו את הקובץ בטלגרם.',
      tgs_no_ai: 'חיפוש חכם צריך מפתח Gemini. אפשר להזין אותו כאן (נשמר בדפדפן הזה בלבד) או לסנכרן מהחשבון.', tgs_bots_off: 'חיפוש בבוטים כבוי.',
      tgs_open_tg: 'פתיחה בטלגרם', tgs_gone: 'הקובץ הזה כבר לא זמין בטלגרם (נמחק, או שהחשבון לא חבר בצ\'אט).',
      tgs_bot_none: 'הבוט לא ענה.', tgs_bot_nobot: 'זה לא בוט.', tgs_bot_missing: 'הבוט לא נמצא.', tgs_bot_flood: 'טלגרם מבקש להמתין %s שניות.',
      tgs_bot_blocked: 'אי אפשר לכתוב לבוט הזה (חסום או לא זמין).'},
    en: {tgs_label: 'Telegram files', tgs_login: 'Sign in to Telegram to search there.', tgs_noplayer: 'The player did not load. Check the connection and try again, or open the file in Telegram.',
      tgs_no_ai: 'Smart search needs a Gemini key. Type it here (kept in this browser only) or sync it from the account.', tgs_bots_off: 'Bot search is off.',
      tgs_open_tg: 'Open in Telegram', tgs_gone: 'This file is no longer available in Telegram (deleted, or the account is not in the chat).',
      tgs_bot_none: 'The bot did not answer.', tgs_bot_nobot: 'This is not a bot.', tgs_bot_missing: 'The bot was not found.', tgs_bot_flood: 'Telegram asks to wait %s seconds.',
      tgs_bot_blocked: 'This bot cannot be written to (blocked or unavailable).'},
    ru: {tgs_label: 'Файлы в Telegram', tgs_login: 'Чтобы искать в Telegram, нужно войти.', tgs_noplayer: 'Плеер не загрузился. Проверьте соединение и повторите или откройте файл в Telegram.',
      tgs_no_ai: 'Для умного поиска нужен ключ Gemini. Введите его здесь (хранится только в этом браузере) или синхронизируйте из аккаунта.', tgs_bots_off: 'Поиск через ботов выключен.',
      tgs_open_tg: 'Открыть в Telegram', tgs_gone: 'Этот файл больше недоступен в Telegram (удалён, или аккаунт не состоит в чате).',
      tgs_bot_none: 'Бот не ответил.', tgs_bot_nobot: 'Это не бот.', tgs_bot_missing: 'Бот не найден.', tgs_bot_flood: 'Telegram просит подождать %s с.',
      tgs_bot_blocked: 'Этому боту нельзя написать (заблокирован или недоступен).'},
  });
  const CACHE_MS = 30 * 60 * 1000;
  const S = {max_aliases: 4, max_queries: 6, max_results: 25, rd_max: 15, per_query: 60, per_chat: 30, bot_max: 3, bot_timeout: 14};
  let M = null, E = null;
  async function libs() {
    if (!M) { await TN.load('matcher'); M = self.TNMatcher; }
    if (!E) { await TN.load('epmatch'); E = self.TNEpmatch; }
  }
  async function client() { const TG = await TN.tg(); return {TG, c: await TG.client(), Api: self.GramJS.Api}; }
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const errCode = (e) => String((e && (e.errorMessage || e.message)) || e || '');

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
    const chatId = markedId(msg.peerId) || entityId(chat);
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
  const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|webm|ts|mov|wmv|mpg|mpeg|flv)$/i;
  const isVideoCand = (cd) => !!cd && (String(cd.mime || '').toLowerCase().startsWith('video/') || VIDEO_EXT.test(cd.file || '') || !!cd.is_video_attr);

  function bigId(ref) {                          // a marked id string -> the number GramJS expects
    try { return self.GramJS.helpers && self.GramJS.helpers.returnBigInt ? self.GramJS.helpers.returnBigInt(ref) : ref; } catch (e) { return ref; }
  }
  // a chat reference (marked id, '@name', 'name', 'me', an entity) -> its entity. A private chat's numeric id is known
  // to this session only after the chat list was read once: that is done here when needed
  let dialogsRead = null;
  async function resolve(ref, username) {
    if (ref && typeof ref === 'object' && ref.className) { rememberEntities([ref]); return ref; }
    const id = String(ref === undefined || ref === null ? '' : ref).trim();
    if (peers.has(id)) return peers.get(id);
    const {c} = await client();
    const numeric = /^-?\d+$/.test(id);
    if (!numeric || username) {
      try {
        const e = await c.getEntity(numeric ? String(username).replace(/^@/, '') : id === 'me' ? 'me' : id.replace(/^@/, ''));
        if (e) { rememberEntities([e]); return e; }
      } catch (er) { if (!numeric) throw er; }
    }
    try { const e = await c.getEntity(bigId(id)); if (e) { rememberEntities([e]); return e; } } catch (er) {}
    if (!dialogsRead) dialogsRead = c.getDialogs({limit: 400}).then((ds) => rememberEntities((ds || []).map((d) => d.entity))).catch(() => { dialogsRead = null; });
    await dialogsRead;
    if (peers.has(id)) return peers.get(id);
    const e = new Error('TG_NO_CHAT'); e.code = 'TG_NO_CHAT'; throw e;
  }

  // ------------------------------------------------------------ Telegram calls (tgclient.py search / _global_page)
  // one messages.searchGlobal request. cur = {rate, peer, id} of the last message of the page before
  async function globalPage(c, Api, q, cur, limit) {
    cur = cur || {rate: 0, peer: null, id: 0};
    const r = await c.invoke(new Api.messages.SearchGlobal({q, filter: new Api.InputMessagesFilterEmpty(), minDate: 0, maxDate: 0,
      offsetRate: cur.rate || 0, offsetPeer: cur.peer || new Api.InputPeerEmpty(), offsetId: cur.id || 0, limit: Math.max(1, Math.min(50, limit || 50))}));
    rememberEntities(r.chats); rememberEntities(r.users);
    const ms = r.messages || [], cands = [];
    for (const m of ms) { const cd = toCand(m); if (cd) cands.push(cd); }
    let next = null;
    if (ms.length >= 20 && r.className !== 'messages.Messages') {
      const last = ms[ms.length - 1];
      const pe = peer(markedId(last.peerId));
      const ip = pe ? await c.getInputEntity(pe).catch(() => null) : null;
      if (ip) next = {rate: r.nextRate || 0, peer: ip, id: last.id};
    }
    return {cands, next};
  }
  async function searchGlobal(c, Api, q, limit, signal, state) {
    const out = [];
    let cur = (state && state.cur) || null, more = true;
    while (out.length < limit && !(signal && signal.aborted)) {
      const pg = await globalPage(c, Api, q, cur, limit - out.length);
      for (const cd of pg.cands) out.push(cd);
      cur = pg.next;
      if (!cur) { more = false; break; }
    }
    if (state) { state.cur = cur; state.more = more && !!cur; }
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
    const ent = await resolve(ref);
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
  async function pool(tasks, n) {              // run async thunks n at a time (the engine's _search_sem)
    const res = [];
    let i = 0;
    await Promise.all(Array.from({length: Math.min(n, tasks.length)}, async () => {
      while (i < tasks.length) { const k = i++; try { res[k] = await tasks[k](); } catch (e) { res[k] = []; } }
    }));
    return res;
  }

  // ------------------------------------------------------------ quiet mode (tgclient.py hush / seen / join)
  // a chat this app writes to or joins is muted for good (and a joined one archived), and what it read is marked as
  // read - so the viewer's phone does not ring. Setting 'telegram_quiet' (default on).
  const quiet = () => TN.settings.get('telegram_quiet', true) !== false;
  const hushed = new Set();
  async function hush(ent, archive) {
    if (!quiet()) return false;
    try {
      const {c, Api} = await client();
      const k = entityId(ent) + (archive ? ':a' : '');
      if (hushed.has(k)) return true;
      const ip = await c.getInputEntity(ent);
      await c.invoke(new Api.account.UpdateNotifySettings({peer: new Api.InputNotifyPeer({peer: ip}),
        settings: new Api.InputPeerNotifySettings({muteUntil: 2147483647, showPreviews: false, silent: true})}));
      if (archive) await c.invoke(new Api.folders.EditPeerFolders({folderPeers: [new Api.InputFolderPeer({peer: ip, folderId: 1})]}));
      hushed.add(k);
      return true;
    } catch (e) { return false; }
  }
  async function seen(ent) {
    if (!quiet()) return false;
    try { const {c} = await client(); if (c.markAsRead) await c.markAsRead(ent); return true; } catch (e) { return false; }
  }
  // join link -> {invite} | {name} (tgclient.py join)
  function parseJoin(link) {
    link = String(link || '').trim();
    const m = /(?:joinchat\/|\/\+|^\+)([\w-]+)/.exec(link);
    if (m) return {invite: m[1]};
    const name = link.replace(/^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)?@?/i, '').split(/[/?#]/)[0];
    return /^[A-Za-z][\w]{3,31}$/.test(name) ? {name} : null;
  }
  async function join(link, beQuiet) {
    const j = typeof link === 'string' ? parseJoin(link) : link;
    if (!j) throw new Error('?');
    const {c, Api} = await client();
    const res = j.invite ? await c.invoke(new Api.messages.ImportChatInvite({hash: j.invite}))
      : await c.invoke(new Api.channels.JoinChannel({channel: j.name}));
    rememberEntities(res && res.chats);
    if (beQuiet === undefined ? quiet() : beQuiet) for (const ch of (res && res.chats) || []) await hush(ch, true);
    return res;
  }

  // ------------------------------------------------------------ cache (IndexedDB, never throws)
  // 6.5.1: one shared connection (it was opened anew for every read and write and never closed), and the store is
  // pruned once per visit: rows older than CACHE_MS were only ignored, never deleted, so it grew with every distinct
  // search for the life of the profile (a small TV quota then refuses other writes).
  const DB = 'tn_tgsearch', CACHE_MAX = 300;
  let dbP = null, pruned = false;
  function idb() {
    if (dbP) return dbP;
    const p = new Promise((ok) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore('c');
        r.onsuccess = () => {
          const db = r.result;
          db.onversionchange = () => { try { db.close(); } catch (e) { /* closed */ } if (dbP === p) dbP = null; };
          db.onclose = () => { if (dbP === p) dbP = null; };
          ok(db);
        };
        r.onerror = () => { if (dbP === p) dbP = null; ok(null); };
        r.onblocked = () => { if (dbP === p) dbP = null; ok(null); };
      } catch (e) { ok(null); }
    });
    dbP = p;
    p.then((db) => { if (!db && dbP === p) dbP = null; });       // a failure is not kept: the next call tries again
    return p;
  }
  // expired, malformed and future-dated rows go; more than CACHE_MAX live rows (all under 30 minutes old): start over
  function prune(db) {
    try {
      const st = db.transaction('c', 'readwrite').objectStore('c'), r = st.openCursor();
      let kept = 0;
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur) { if (kept > CACHE_MAX) { try { st.clear(); } catch (e) { /* next visit */ } } return; }
        const age = cur.value ? Date.now() - cur.value.t : NaN;
        if (!(age >= 0 && age < CACHE_MS)) cur.delete(); else kept++;
        cur.continue();
      };
    } catch (e) { /* the cache is optional */ }
  }
  async function cacheGet(k) {
    const db = await idb();
    if (!db) return null;
    return new Promise((ok) => {
      try {
        const r = db.transaction('c').objectStore('c').get(k);
        r.onsuccess = () => ok(r.result && Date.now() - r.result.t < CACHE_MS ? r.result.v : null);
        r.onerror = () => ok(null);
      } catch (e) { dbP = null; ok(null); }        // (a connection the browser closed: the next call opens a new one)
    });
  }
  async function cachePut(k, v) {
    const db = await idb();
    if (!db) return;
    try { db.transaction('c', 'readwrite').objectStore('c').put({t: Date.now(), v}, k); } catch (e) { dbP = null; return; }
    if (!pruned) { pruned = true; prune(db); }
  }
  TN.on('clearcache', async () => { freeState.clear(); pruned = false; const db = await idb(); try { if (db) db.transaction('c', 'readwrite').objectStore('c').clear(); } catch (e) { dbP = null; } });

  // ------------------------------------------------------------ t.me links (tgbots.py tme)
  // -> ['start', bot, code] | ['msg', channel | '-100<id>', message id] | ['join', link] | null
  function tme(url) {
    url = String(url || '').trim();
    const kv = (s) => { const o = {}; for (const x of String(s || '').split('&')) { const i = x.indexOf('='); if (i > 0) o[x.slice(0, i)] = x.slice(i + 1); } return o; };
    let m = /^tg:\/\/resolve\?(.+)$/i.exec(url);
    if (m) {
      const q = kv(m[1]);
      if (q.domain && q.start) return ['start', q.domain, q.start];
      if (q.domain && /^\d+$/.test(q.post || '')) return ['msg', q.domain, parseInt(q.post, 10)];
      return q.domain ? ['join', 'https://t.me/' + q.domain] : null;
    }
    m = /^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/(.+)$/i.exec(url);
    if (!m) return null;
    const cut = m[1].split('#')[0], qi = cut.indexOf('?');
    const path = qi < 0 ? cut : cut.slice(0, qi), args = kv(qi < 0 ? '' : cut.slice(qi + 1));
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return null;
    if (parts[0].startsWith('+') || parts[0] === 'joinchat') return ['join', 'https://t.me/' + parts.slice(0, 2).join('/')];
    if (parts[0] === 'c' && parts.length >= 3 && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[parts.length - 1])) return ['msg', '-100' + parts[1], parseInt(parts[parts.length - 1], 10)];
    if (['s', 'share', 'addstickers', 'proxy', 'socks', 'iv', 'addlist', 'boost', 'login', 'setlanguage'].includes(parts[0])) return null;
    if (!/^[A-Za-z][\w]{3,31}$/.test(parts[0])) return null;
    if (args.start) return ['start', parts[0], args.start];
    if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) return ['msg', parts[0], parseInt(parts[parts.length - 1], 10)];
    if (parts.length === 1 && !Object.keys(args).length) return ['join', 'https://t.me/' + parts[0]];
    return null;
  }
  // what a pasted t.me link is: {kind: 'msg', chat, row | null, text} | {kind: 'chat', chat} | {kind: 'bot', chat, code}
  // | {kind: 'invite', link} | {kind: 'bad'}
  async function linkInfo(url) {
    const w = tme(url);
    if (!w) return {kind: 'bad'};
    if (w[0] === 'join') {
      const j = parseJoin(w[1]);
      if (j && j.invite) return {kind: 'invite', link: w[1]};
      const chat = await resolve(j ? j.name : w[1]);
      return chat.bot ? {kind: 'bot', chat, code: ''} : {kind: 'chat', chat};
    }
    const chat = await resolve(w[1]);
    if (w[0] === 'start') return {kind: 'bot', chat, code: String(w[2])};
    await libs();
    const {c} = await client();
    const got = await c.getMessages(chat, {ids: w[2]});
    const m = (got || [])[0] || null;
    const cd = m ? toCand(m, chat) : null;
    return {kind: 'msg', chat, row: cd && isVideoCand(cd) ? slim(withParsed(cd)) : null, text: (m && m.message) || '', msg: w[2]};
  }

  // ------------------------------------------------------------ request bots (tgbots.py)
  const SYSTEM_BOTS = new Set(('botfather spambot stickers gif vid pic bing wiki imdb youtube bold telegram notoscam premiumbot ' +
    'donate wallet like vote gamee replies channel_bot groupanonymousbot discussbot botsupport stars verifybot ' +
    'quizbot pollbot storebot gmailbot ifttt combot rose missrose_bot shieldy_bot grouphelpbot controllerbot ' +
    'livegrambot manybot chatgpt cryptobot durov username_bot fragment tonkeeper jobs_bot').split(' '));
  const X = '[^\\p{L}\\p{N}]*';
  const NAV = new RegExp('^' + X + '(?:next|prev|previous|back|close|cancel|page|pages|more|menu|home|help|about|settings|language|share|donate|report|start|search|' +
    'הבא|הקודם|חזרה|סגור|ביטול|עוד|תפריט|עזרה|שתף|דווח|далее|назад|закрыть|отмена|ещё|меню|помощь)' + X + '$', 'iu');
  const PAGE = new RegExp('^' + X + '\\d+\\s*(?:/|of)\\s*\\d+' + X + '$', 'iu');
  const NEXT = /next|הבא|עוד|далее|ещё|➡|»|›|>>|⏩|▶/iu;
  const JOIN = /join|subscribe|הצטרף|להצטרף|הצטרפו|מנוי|подпис|вступ/iu;
  const RETRY = /try again|retry|joined|i.?ve joined|refresh|check|נסה שוב|הצטרפתי|בדוק|רענן|провер|подписался|ещё раз|✅|\u{1f504}/iu;
  // (no look-behind: old TV browsers do not parse it) group 1 = a bare 't.me/...' link
  const URL_RX = /(?:https?:\/\/|tg:\/\/)[^\s<>"')\]]+|(?:^|[^\w\/@.])(t\.me\/[^\s<>"')\]]+)/gi;
  function linksIn(text) {
    const out = [];
    URL_RX.lastIndex = 0;
    let m;
    while ((m = URL_RX.exec(String(text || '')))) out.push(m[1] || m[0]);
    return out;
  }
  const isSystemBot = (u) => SYSTEM_BOTS.has(String(u || '').toLowerCase());
  const botKey = (b) => String(b === undefined || b === null ? '' : b).trim().replace(/^@/, '').toLowerCase();
  // tgbots.ref: what was typed for a bot ('@name', 'name', a t.me link, a numeric id) -> the name / id to look up
  function botRef(b) {
    const w = tme(String(b || ''));
    if (w && w[0] === 'join') { const j = parseJoin(w[1]); return j && j.name ? j.name.toLowerCase() : ''; }
    return botKey(w ? w[1] : b);
  }
  const wordsOf = (s) => String(s || '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
  function defaultRank(query) {
    const words = new Set(wordsOf(query).filter((w) => w.length > 1));
    return (text) => {
      if (!words.size) return 0;
      const got = new Set(wordsOf(text));
      let n = 0;
      for (const w of words) if (got.has(w)) n++;
      return n / words.size;
    };
  }
  // sources.py _button_rank: how well a button text fits the wanted title, 0..1, or null for "another film / episode"
  function buttonRank(t) {
    return (text) => {
      text = String(text || '').trim();
      if (!text) return 0;
      const p = M.parse(text, '', '');
      if (p.is_trailer || p.is_archive) return null;
      const has = (v) => v !== null && v !== undefined;
      if (t.kind === 'episode') {
        if (has(p.episode)) {
          if (p.episode_end) { if (!(p.episode <= Number(t.episode) && Number(t.episode) <= p.episode_end)) return null; }
          else if (Number(p.episode) !== Number(t.episode)) return null;
        }
        if (has(p.season) && Number(p.season) !== Number(t.season)) return null;
        if (has(p.season_hint) && Number(p.season_hint) !== Number(t.season)) return null;
      } else {
        if (has(p.episode) && has(p.season)) return null;
        if (t.year && p.year && Math.abs(Number(t.year) - Number(p.year)) > 1) return null;
      }
      let sc = M.bestTitleScore((p.titles && p.titles.length ? p.titles : [text]), t.aliases || [])[0];
      if (M.containsAlias && M.containsAlias(text, t.aliases || [])) sc = Math.max(sc, 0.9);
      if (t.kind === 'episode' && has(p.episode) && sc < 0.5 && !(M.normalize ? M.normalize(p.title || '') : p.title)) sc = 0.55;
      return sc;
    };
  }
  const buttonsOf = (m) => {
    const out = [];
    for (const row of (m && m.replyMarkup && m.replyMarkup.rows) || []) for (const b of row.buttons || []) out.push(b);
    return out;
  };
  const dataKey = (d) => { try { return Array.prototype.join.call(d, ','); } catch (e) { return String(d); } };
  const botLocks = new Map();                  // one conversation at a time with one bot
  // tgbots.ask: one request to one bot. Never throws for a bot that misbehaves.
  // o: {timeout (s), clicks, rank, autojoin, speed (tests: every wait divided by it), onStep(res)}
  async function botAskRaw(bot, query, o) {
    o = o || {};
    const speed = o.speed || 1, sec = (s) => (s * 1000) / speed;
    const t0 = Date.now();
    const res = {files: [], join: [], notes: [], answered: false, clicked: 0, bot: null, took: 0, error: null};
    const done = () => { res.took = Math.round((Date.now() - t0) / 10) / 100; return res; };
    let c, Api, ent;
    try { ({c, Api} = await client()); } catch (e) { res.error = errCode(e); return done(); }
    try { ent = await resolve(typeof bot === 'string' ? botRef(bot) : bot); } catch (e) { res.error = 'bot_not_found'; return done(); }
    if (!ent || !ent.bot) { res.error = 'not_a_bot'; return done(); }
    res.bot = {id: String(ent.id), username: ent.username || null, title: ent.firstName || ent.username || ''};
    const lockKey = String(ent.id), prev = botLocks.get(lockKey) || Promise.resolve();
    let release;
    botLocks.set(lockKey, new Promise((ok) => { release = ok; }));
    await prev;
    const rank = o.rank || defaultRank(query);
    const T = {watch: new Map(), seen: new Map(), actions: [], done: new Set(), order: 0, retry: null, files: new Map(), left: o.clicks || 5,
      joined: false, lastStart: null, joins: [], content: false};
    const actKey = (kind, payload) => kind + ':' + (kind === 'click' ? payload.m.id + ':' + dataKey(payload.data) : payload.join('/'));
    const push = (prio, kind, payload, label) => {
      const key = actKey(kind, payload);
      if (T.done.has(key) || T.actions.some((a) => actKey(a[2], a[3]) === key)) return;
      T.order++;
      if (prio >= 0.5) T.content = true;
      T.actions.push([prio, T.order, kind, payload, label]);
    };
    const addFile = (m, chat) => {
      const cd = toCand(m, chat);
      if (!isVideoCand(cd)) return false;
      const key = cd.doc_id || cd.chat_id + ':' + cd.msg_id;
      if (!T.files.has(key)) {
        cd.via_bot = res.bot.username || res.bot.title || '';
        cd.chat_kind = 'bot';
        T.files.set(key, cd);
        res.files.push(cd);
      }
      return true;
    };
    const link = (url, label, text, hasFile, base) => {
      const what = tme(url);
      if (!what) return;
      let r = label ? rank(label) : base;
      if (label && r !== null && r < 0.5 && base !== null && base >= 0.6) r = base;
      if (what[0] === 'join') {
        if (!hasFile && (JOIN.test(label || '') || JOIN.test(text || ''))) T.joins.push(what[1]);
        return;
      }
      if (r === null) return;
      push(r >= 0.5 ? r : r - 1, what[0], what.slice(1), label || url);
    };
    const handle = (m, chat) => {
      res.answered = true;
      const text = m.message || '';
      const hasFile = addFile(m, chat);
      T.joins = []; T.content = false;
      const base = text ? rank(text.slice(0, 300)) : 0;
      const callbacks = [];
      for (const b of buttonsOf(m)) {
        const label = b.text || '';
        if (b.url) link(b.url, label, text, hasFile, base);
        else if (b.data !== undefined && b.data !== null) callbacks.push([label, b.data]);
      }
      for (const [label, data] of callbacks) {
        if (RETRY.test(label) && res.join.length) { T.retry = {m, data, chat}; continue; }
        if (PAGE.test(label)) continue;
        if (NAV.test(label)) { if (NEXT.test(label)) push(-0.5, 'click', {m, data, chat}, label); continue; }
        let r = rank(label);
        if (r === null) continue;
        if (r < 0.5 && base !== null && base >= 0.6 && callbacks.length <= 4) r = 0.5;
        push(r >= 0.5 ? r : r - 1, 'click', {m, data, chat}, label);
      }
      if (!hasFile) {
        const found = new Set();
        for (const en of m.entities || []) {
          const inner = text.substr(en.offset || 0, en.length || 0);
          const u = en.url || (en.className === 'MessageEntityUrl' ? inner : null);
          if (u) { found.add(u); link(u, en.url ? inner : '', text, hasFile, base); }
        }
        for (const u of linksIn(text)) if (!found.has(u)) link(u, '', text, hasFile, base);
      }
      if (!hasFile && !T.content) for (const l of T.joins) if (!res.join.includes(l)) res.join.push(l);
    };
    const poll = async () => {
      let fresh = 0;
      for (const [pid, slot] of T.watch) {
        let got;
        try { got = await c.getMessages(slot[0], {minId: slot[1], limit: 40}); } catch (e) { continue; }
        for (const m of (got || []).slice().sort((a, b) => a.id - b.id)) {
          if (!m || m.out || m.id <= slot[1]) continue;
          const sig = JSON.stringify([m.editDate || 0, (m.message || '').length, buttonsOf(m).map((b) => b.text || '')]);
          const k = pid + ':' + m.id;
          if (T.seen.get(k) === sig) continue;
          T.seen.set(k, sig);
          fresh++;
          try { handle(m, slot[0]); } catch (e) {}
        }
      }
      if (fresh && o.onStep) { try { o.onStep(res); } catch (e) {} }
      return fresh;
    };
    const startBot = async (name, code) => {
      const b = await resolve(botKey(name));
      if (!b || !b.bot) return;
      const id = String(b.id);
      if (!T.watch.has(id)) { const last = await c.getMessages(b, {limit: 1}); T.watch.set(id, [b, last && last[0] ? last[0].id : 0]); }
      await hush(b);
      await c.sendMessage(b, {message: '/start ' + code});
      T.lastStart = [name, code];
    };
    const act = async (a) => {
      const [prio, , kind, payload, label] = a;
      T.done.add(actKey(kind, payload));
      T.left--; res.clicked++;
      try {
        if (kind === 'click') {
          const ans = await Promise.race([c.invoke(new Api.messages.GetBotCallbackAnswer({peer: payload.chat, msgId: payload.m.id, data: payload.data})), sleep(sec(8)).then(() => null)]);
          if (ans && ans.message) { res.notes.push(String(ans.message).slice(0, 200)); if (JOIN.test(ans.message)) res.needs_join = true; }
          if (ans && ans.url) link(ans.url, label, '', false, Math.max(prio, 0.5));
        } else if (kind === 'start') await startBot(payload[0], payload[1]);
        else if (kind === 'msg') {
          const chat = await resolve(payload[0]);
          const got = await c.getMessages(chat, {ids: payload[1]});
          if (got && got[0]) addFile(got[0], chat);
        }
      } catch (e) {}
    };
    const nextAction = (allowWeak) => {
      if (!T.actions.length || T.left <= 0) return null;
      T.actions.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      if (T.actions[0][0] < 0.5 && !allowWeak) return null;
      return T.actions.shift();
    };
    try {
      const id = String(ent.id);
      try {
        await hush(ent);                               // the bot's answers must not ring on the viewer's phone
        const last = await c.getMessages(ent, {limit: 1});
        if (!last || !last.length) {                   // never opened: a bot answers nobody before /start
          const first = await c.sendMessage(ent, {message: '/start'});
          T.watch.set(id, [ent, first.id]);
          const until = Date.now() + sec(3);
          while (Date.now() < until && !(await poll())) await sleep(sec(0.4));
          T.actions = []; res.answered = false;       // the welcome menu is not an answer to the request
        }
        const sent = await c.sendMessage(ent, {message: String(query)});
        T.watch.set(id, [ent, sent.id]);
      } catch (e) {
        const code = errCode(e);
        res.error = /FLOOD/i.test(code) ? 'flood_wait_' + (e.seconds || 0) : (code || 'send_failed');
        return done();
      }
      const deadline = t0 + sec(o.timeout || S.bot_timeout);
      let mark = Date.now();
      while (Date.now() < deadline) {
        await sleep(sec(0.5));
        if (await poll()) mark = Date.now();
        const idle = Date.now() - mark;
        if (res.join.length && o.autojoin && !T.joined) {
          let ok = 0;
          for (const l of res.join.slice(0, 3)) { try { await join(l, true); ok++; } catch (e) {} }
          T.joined = true; res.joined = ok;
          if (ok) {
            if (T.retry) push(1, 'click', T.retry, 'retry');
            else if (T.lastStart) { T.done.delete(actKey('start', T.lastStart)); push(1, 'start', T.lastStart, 'retry'); }
            else { try { const again = await c.sendMessage(ent, {message: String(query)}); T.watch.get(id)[1] = again.id; } catch (e) {} }
            mark = Date.now();
          }
          continue;
        }
        const a = nextAction(!res.files.length && res.answered && idle >= sec(1));
        if (a) { await act(a); mark = Date.now(); continue; }
        if (!res.answered) { if (idle >= sec(7)) { res.error = 'no_answer'; break; } }
        else if (idle >= sec(res.files.length ? 2 : 4.5)) break;
      }
      if (!res.answered && !res.error) res.error = 'no_answer';   // the deadline came before the idle check (slow timers)
      await seen(ent);
      return done();
    } finally { release(); }                    // the next request to this bot may start
  }
  // tgbots.ask_many: the first wording that brings files wins; a second one only with time to spare
  async function botAskMany(bot, queries, o) {
    o = o || {};
    const speed = o.speed || 1, total = o.timeout || S.bot_timeout, t0 = Date.now();
    let res = null;
    for (const q of (queries || []).slice(0, 2)) {
      const left = total - ((Date.now() - t0) / 1000) * speed;
      if (left < 5) break;
      const one = await botAskRaw(bot, q, Object.assign({}, o, {timeout: left}));
      if (res) {
        one.join = [...new Set(res.join.concat(one.join))];
        one.notes = res.notes.concat(one.notes);
        one.clicked += res.clicked;
        one.answered = one.answered || res.answered;
      }
      res = one;
      if (res.files.length || res.error === 'bot_not_found' || res.error === 'not_a_bot' || res.join.length) break;
    }
    if (res) res.took = Math.round((Date.now() - t0) / 10) / 100;
    return res || {files: [], join: [], notes: [], answered: false, clicked: 0, bot: null, took: 0, error: 'no_time'};
  }
  // which bots (this browser: TN.put('tg_bots')): {cfg: {key: {state: 'on' | 'off', title, username, id}}, stats: {key: {asked, hits, files, last, error}}}
  const BOTS = 'tg_bots';
  function botsLoad() {
    const d = TN.get(BOTS, null);
    const ok = (x) => x && typeof x === 'object' && !Array.isArray(x);
    return {cfg: ok(d) && ok(d.cfg) ? d.cfg : {}, stats: ok(d) && ok(d.stats) ? d.stats : {}};
  }
  const botState = (cfg, username, id) => { for (const k of [botKey(username || ''), String(id)]) if (k && cfg[k]) return cfg[k].state || ''; return ''; };
  const settingBots = () => { const s = (TN.settings.synced() || {}).bots; return (Array.isArray(s) ? s : String(s || '').split(/[\s,]+/)).map(botKey).filter(Boolean); };
  let autoBots = null;
  const bots = {
    // asked during a title search: the bots the viewer switched on ("My bots"); bots that already hold videos too when
    // 'tgsearch_bots_auto' is on. 'tgsearch_bots' off = no bot is ever written to by a search.
    enabled: () => TN.settings.get('tgsearch_bots', true) !== false,
    autoOn: () => TN.settings.get('tgsearch_bots_auto', false) === true,
    autojoin: () => TN.settings.get('tgsearch_bot_autojoin', false) === true,
    isSystem: isSystemBot, key: botKey, ref: botRef, tme, defaultRank, buttonRank, linksIn,
    // on: true = always ask, false = never ask, null = forget the choice
    mark(bot, on, info) {
      info = info || {};
      const d = botsLoad();
      const keys = [bot, info.username, info.id].map(botKey).filter(Boolean);
      for (const k of keys) delete d.cfg[k];
      if (on !== null && on !== undefined && keys.length) {
        const main = info.username ? botKey(info.username) : keys[0];
        d.cfg[main] = {state: on ? 'on' : 'off', title: info.title || '', username: info.username || '', id: info.id === undefined ? null : String(info.id)};
      }
      TN.put(BOTS, d);
      return d;
    },
    note(key, res) {
      const d = botsLoad();
      const st = d.stats[key] || {asked: 0, hits: 0, files: 0, last: 0};
      st.asked = (st.asked || 0) + 1;
      if (res.files && res.files.length) { st.hits = (st.hits || 0) + 1; st.files = (st.files || 0) + res.files.length; }
      st.last = Math.round(Date.now() / 1000);
      st.error = res.error || '';
      d.stats[key] = st;
      TN.put(BOTS, d);
    },
    // bots_with_videos: which bot chats already hold a video (= bots that have sent this account films). Kept a day.
    async auto(list, refresh) {
      const saved = TN.get('tg_bots_auto', null);
      if (!refresh && saved && Array.isArray(saved.ids) && Date.now() - saved.t < 864e5) return saved.ids;
      if (autoBots) return autoBots;
      autoBots = (async () => {
        const {c, Api} = await client();
        const good = [];
        for (const b of (list || []).slice(0, 30)) {
          try {
            let got = await c.getMessages(b.entity, {limit: 1, filter: new Api.InputMessagesFilterVideo()});
            if (!got || !got.length) {
              const docs = await c.getMessages(b.entity, {limit: 5, filter: new Api.InputMessagesFilterDocument()});
              got = (docs || []).filter((m) => isVideoCand(toCand(m, b.entity)));
            }
            if (got && got.length) good.push(String(b.id));
          } catch (e) {}
          await sleep(150);
        }
        TN.put('tg_bots_auto', {t: Date.now(), ids: good});
        return good;
      })().finally(() => { autoBots = null; });
      return autoBots;
    },
    // every bot chat of the account + every bot the viewer chose, with its state: 'on' | 'auto' | '' | 'off'
    async list(opts) {
      const {c} = await client();
      const d = botsLoad(), listed = new Set(settingBots());
      const ds = await c.getDialogs({limit: (opts && opts.limit) || 400});
      const mine = (ds || []).map((x) => x.entity).filter((e) => e && e.bot && !e.deleted && !isSystemBot(e.username));
      rememberEntities(mine);
      const withEnt = mine.map((e) => ({id: String(e.id), entity: e}));
      const auto = bots.autoOn() ? new Set(await bots.auto(withEnt, opts && opts.refresh).catch(() => [])) : new Set();
      const rows = [], seenKeys = new Set();
      for (const e of mine) {
        const key = botKey(e.username || e.id);
        seenKeys.add(key);
        let state = botState(d.cfg, e.username, e.id);
        if (!state) state = listed.has(key) ? 'on' : auto.has(String(e.id)) ? 'auto' : '';
        rows.push({id: String(e.id), username: e.username || '', title: [e.firstName, e.lastName].filter(Boolean).join(' ') || e.username || String(e.id),
          state, inline: !!e.botInlinePlaceholder, stats: d.stats[key] || {}, mine: true});
      }
      for (const [key, v] of Object.entries(d.cfg)) {
        if (seenKeys.has(key) || (v.id && rows.some((r) => r.id === String(v.id))) || v.state !== 'on') continue;
        seenKeys.add(key);
        rows.push({id: v.id || '', username: v.username || key, title: v.title || key, state: 'on', inline: false, stats: d.stats[key] || {}, mine: false});
      }
      for (const key of listed) if (!seenKeys.has(key)) rows.push({id: '', username: key, title: key, state: 'on', inline: false, stats: d.stats[key] || {}, mine: false});
      const order = {on: 0, auto: 1, '': 2, off: 3};
      rows.sort((a, b) => order[a.state] - order[b.state] || (b.stats.hits || 0) - (a.stats.hits || 0) || a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
      return rows;
    },
    // the bots a title search asks (sources.py content_bots): chosen ones, then (when allowed) the ones holding videos;
    // a bot that never brought anything in four requests rests
    async content(limit) {
      if (!bots.enabled()) return [];
      const d = botsLoad(), out = [], seenKeys = new Set();
      const add = (ref, title, why) => {
        const key = botKey(ref);
        if (!key || seenKeys.has(key) || isSystemBot(key)) return;
        seenKeys.add(key);
        out.push({ref: /^\d+$/.test(key) ? key : key, title: title || String(ref), why, key});
      };
      for (const name of settingBots()) if (botState(d.cfg, name, null) !== 'off') add(name, name, 'setting');
      for (const [key, v] of Object.entries(d.cfg)) if (v.state === 'on') add(v.username || v.id || key, v.title, 'chosen');
      if (bots.autoOn()) {
        const saved = TN.get('tg_bots_auto', null);
        for (const id of (saved && Array.isArray(saved.ids) ? saved.ids : [])) {
          if (botState(d.cfg, '', id) === 'off') continue;
          const e = peers.get(String(id));
          const key = botKey((e && e.username) || id), st = d.stats[key] || {};
          if ((e && botState(d.cfg, e.username, id) === 'off') || ((st.asked || 0) >= 4 && !(st.hits || 0))) continue;
          add((e && e.username) || id, (e && e.firstName) || String(id), 'auto');
        }
      }
      const hits = (b) => (d.stats[b.key] || {}).hits || 0;
      out.sort((a, b) => hits(b) - hits(a));
      return out.slice(0, limit || S.bot_max);
    },
    // sources.py bot_queries: how a person would type the request
    queries(t, queries) {
      const base = (M.cleanQuery ? M.cleanQuery((t.aliases || [])[0] || t.title || '') : '') || (t.aliases || [])[0] || t.title || '';
      const p2 = (n) => String(parseInt(n, 10)).padStart(2, '0');
      const first = t.kind === 'episode' ? `${base} S${p2(t.season)}E${p2(t.episode)}` : base;
      const script = (x) => (/[֐-׿]/.test(x) ? 'he' : /[Ѐ-ӿ]/.test(x) ? 'ru' : 'la');
      const out = [first];
      const other = (queries || []).find((q) => script(q) !== script(first));
      if (other) out.push(other);
      else if (t.kind === 'episode') out.push(base);
      else if (t.year) out.push(base + ' ' + t.year);
      return out;
    },
    raw: botAskRaw, askMany: botAskMany,
    // one request typed by the viewer ("Ask a bot"): the answer as listable rows + what the bot demanded
    async ask(bot, query, o) {
      await libs();
      o = o || {};
      const res = await botAskMany(bot, [query], Object.assign({clicks: 8, autojoin: bots.autojoin(), timeout: S.bot_timeout + 4, speed: bots._speed || 1}, o));
      bots.note(botKey((res.bot && (res.bot.username || res.bot.id)) || bot), res);
      return {files: res.files.map((cd) => slim(withParsed(cd))), join: res.join, notes: res.notes, answered: res.answered, error: res.error,
        bot: res.bot, took: res.took, clicked: res.clicked, text: bots.errorText(res)};
    },
    errorText(res) {
      const e = String((res && res.error) || '');
      if (!e) return '';
      if (e === 'no_answer' || e === 'no_time') return TN.t('tgs_bot_none');
      if (e === 'not_a_bot') return TN.t('tgs_bot_nobot');
      if (e === 'bot_not_found') return TN.t('tgs_bot_missing');
      if (/^flood_wait_/.test(e)) return TN.t('tgs_bot_flood', e.slice(11));
      if (/BLOCKED|PEER_FLOOD|FORBIDDEN/i.test(e)) return TN.t('tgs_bot_blocked');
      return e.replace(/[^\w .:-]/g, '').slice(0, 80);
    },
  };

  // ------------------------------------------------------------ the pipeline
  function langPref() {
    const cl = String((TN.settings.synced() || {}).content_lang || '0');
    return {1: 'he', 2: 'en', 3: 'ru'}[cl] || TN.lang();
  }
  // chats searched by every search without joining: pinned here (TN.put('tg_pins')) + the account's synced 'pinned_chats'
  function pinnedChats() {
    const p = TN.get('tg_pins', []);
    const out = (Array.isArray(p) ? p : []).filter((x) => x && x.id).slice();
    const synced = (TN.settings.synced() || {}).pinned_chats;
    for (const raw of (Array.isArray(synced) ? synced : String(synced || '').split(/[\s,]+/))) {
      const ref = String(raw || '').trim().replace(/^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)/i, '').replace(/^@/, '').split('/')[0];
      if (!ref) continue;
      const numeric = /^-?\d+$/.test(ref);
      if (out.some((x) => (numeric ? x.id === ref : String(x.username || '').toLowerCase() === ref.toLowerCase()))) continue;
      out.push(numeric ? {id: ref, title: ref, username: '', synced: true} : {id: '@' + ref, title: ref, username: ref, synced: true});
    }
    return out;
  }
  function withParsed(cd) { if (!cd.parsed) { cd.parsed = M.parse(cd.file, cd.caption, cd.chat_title); cd.ext = cd.parsed.ext; } return cd; }
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
      for (const p of pins) tasks.push(async () => searchChat(c, Api, await resolve(p.id, p.username), q, S.per_chat));
    }
    const asked = await bots.content().catch(() => []);
    const botQs = asked.length ? bots.queries(target, queries) : [];
    const botTasks = asked.map((b) => async () => {
      const res = await botAskMany(b.ref, botQs, {rank: buttonRank(target), autojoin: bots.autojoin(), timeout: S.bot_timeout, speed: bots._speed || 1});
      bots.note(b.key, res);
      return res.files;
    });
    let done = 0;
    const all = tasks.length + botTasks.length;
    const step = (t) => async () => { const r = await t(); if (onProgress) onProgress(++done, all); return r; };
    const [lists, botLists] = await Promise.all([pool(tasks.map(step), 3), pool(botTasks.map(step), 3)]);
    const seenRows = new Set(), rows = [];
    const pref = langPref();
    for (const cd of lists.concat(botLists).flat()) {
      if (!cd) continue;
      const k = cd.chat_id + ':' + cd.msg_id;
      if (seenRows.has(k)) continue;
      seenRows.add(k);
      withParsed(cd);
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
      doc_id: cd.doc_id, score: cd.score || 0, verdict: cd.verdict || '', also: cd.also, mirrors: cd.mirrors, via_bot: cd.via_bot || undefined,
      quality: p.quality || 0, langs: p.langs || [], source: p.source || '', season: p.season, episode: p.episode, year: p.year};
  }
  // free text (sources.py find_free): every video file the search gives; S/E in the text must match exactly.
  // The place each wording stopped at is remembered (this visit), so freeMore() goes on from there.
  const freeState = new Map();                 // key -> {qs, states: [{cur, more}], seen: Set, want, show}
  const freeKey = (q) => 'q:' + String(q).toLowerCase().trim();
  function freeFilter(st, q, cands) {
    const rows = [];
    for (const cd of cands) {
      const k = cd.chat_id + ':' + cd.msg_id;
      if (st.seen.has(k)) continue;
      st.seen.add(k);
      withParsed(cd);
      if (!M.isVideoFile(cd) || cd.parsed.is_junk || cd.parsed.is_archive || cd.parsed.is_trailer) continue;
      if (!E.matches(st.want, cd.file, cd.caption)) continue;
      if (st.want[0] !== null || st.want[1] !== null) { if (st.show && !E.mentions(st.show, cd.file, cd.caption)) continue; }
      const [score] = M.bestTitleScore(cd.parsed.titles, [st.show || q]);
      cd.score = score * 50 + (cd.parsed.quality ? 5 : 0) + M.languageBonus(cd.parsed.langs, langPref());
      rows.push(cd);
    }
    rows.sort((a, b) => b.score - a.score);
    return M.unionDedup(rows)[0];
  }
  function freeStart(q) {
    const want = E.wanted(q);
    const show = q.replace(/\bS\d{1,2}\s*E\d{1,3}\b|\b\d{1,2}x\d{2,3}\b|עונה\s*\d+|פרק\s*\d+|\d+\s*сезон|\d+\s*серия/giu, ' ').replace(/\s+/g, ' ').trim();
    const qs = [q];
    if (show && show !== q) qs.push(show);
    const st = {qs, states: qs.map(() => ({cur: null, more: true})), seen: new Set(), want, show};
    freeState.set(freeKey(q), st);
    while (freeState.size > 20) freeState.delete(freeState.keys().next().value);
    return st;
  }
  async function freeRun(q, st, limit, signal) {
    const {c, Api} = await client();
    const lists = await pool(st.qs.map((x, i) => () => (st.states[i].more ? searchGlobal(c, Api, x, limit, signal, st.states[i]) : [])), 2);
    return freeFilter(st, q, lists.flat());
  }
  async function free(q, {signal, limit = 60, refresh = false} = {}) {
    await libs();
    const key = freeKey(q);
    if (!refresh) { const hit = await cacheGet(key); if (hit) return hit; }
    const out = (await freeRun(q, freeStart(q), limit, signal)).slice(0, limit).map(slim);
    await cachePut(key, out);
    return out;
  }
  const freeHasMore = (q) => { const st = freeState.get(freeKey(q)); return !st || st.states.some((s) => s.more); };
  // the next page: -> {items: rows no earlier page gave, more}. After a reload (first page from the cache) the first
  // page is read again quietly to find the place to go on from.
  async function freeMore(q, {signal, limit = 60, have = []} = {}) {
    await libs();
    let st = freeState.get(freeKey(q));
    if (!st) {
      st = freeStart(q);
      await freeRun(q, st, limit, signal);
    }
    for (const r of have) st.seen.add(r.chat_id + ':' + r.msg_id);
    const haveDocs = new Set(have.map((r) => r.doc_id).filter(Boolean));
    let items = [];
    for (let i = 0; i < 3 && !items.length && st.states.some((s) => s.more); i++) {
      items = (await freeRun(q, st, limit, signal)).filter((cd) => !haveDocs.has(cd.doc_id));
    }
    return {items: items.map(slim), more: st.states.some((s) => s.more)};
  }

  // ------------------------------------------------------------ AI search (gemini.py smart_search)
  const geminiKey = () => String(TN.settings.get('gemini_key', '') || (TN.settings.synced() || {}).gemini_key || '').trim();
  async function aiTitles(text, {signal} = {}) {
    const key = geminiKey();
    if (!key) { const e = new Error(TN.t('tgs_no_ai')); e.code = 'no_key'; throw e; }
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

  // ------------------------------------------------------------ playing, tracked
  function sizeText(b) { return b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.round(b / 1048576) + ' MB'; }
  function rowSub(r) {
    return [r.quality ? r.quality + 'p' : '', r.size ? sizeText(r.size) : '', r.duration ? Math.round(r.duration / 60) + '′' : '', r.chat_title,
      r.via_bot ? '🤖 ' + r.via_bot : '', (r.also || []).length ? '+' + r.also.length : ''].filter(Boolean).join(' · ');
  }
  const histKey = (r) => 'tg:' + r.chat_id + ':' + r.msg_id;
  // what is needed to open a file again after the page was reloaded (this browser; no file id, no access hash)
  const RECENT = 'tg_recent';
  function noteRecent(r) {
    const all = TN.get(RECENT, {}) || {};
    all[histKey(r)] = {u: r.chat_username || '', f: String(r.file || '').slice(0, 160), c: String(r.chat_title || '').slice(0, 80), s: r.size || 0, d: r.duration || 0, at: Date.now()};
    const keys = Object.keys(all);
    if (keys.length > 200) keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, keys.length - 200).forEach((k) => delete all[k]);
    TN.put(RECENT, all);
  }
  // the build's own address of the same file (plugin.video.telescope playtg): the history row also plays on a Kodi device
  function kodiPlay(r) {
    if (!/^-?\d+$/.test(String(r.chat_id)) || !r.msg_id) return '';
    return 'plugin://plugin.video.telescope/?' + new URLSearchParams({mode: 'playtg', chat: String(r.chat_id), msg: String(r.msg_id), name: String(r.file || '')});
  }
  const tgLink = (r) => (r.chat_username ? 'https://t.me/' + encodeURIComponent(r.chat_username) + '/' + r.msg_id
    : /^-100\d+$/.test(String(r.chat_id)) ? 'https://t.me/c/' + String(r.chat_id).slice(4) + '/' + r.msg_id : '');
  // watched / resume state of a row: {seen: it is in the history, resume: {t, d} | null}
  function stateOf(r, historyKeys) {
    const key = histKey(r);
    const keys = historyKeys || new Set((TN.store && TN.store.history ? TN.store.history() : []).map((h) => h && h.key));
    const res = (TN.get('player_resume', {}) || {})[key];
    return {key, seen: keys.has(key), resume: res && res.t > 30 && (!res.d || res.t < res.d * 0.95) ? res : null};
  }
  // title / season / episode a file name states ("another episode of the same show" needs them)
  function describe(r) {
    const p = M ? M.parse(r.file || '', r.caption || '', r.chat_title || '') : {};
    const has = (v) => v !== null && v !== undefined;
    return {title: (p.titles && p.titles[0]) || p.title || '', season: has(r.season) ? r.season : has(p.season) ? p.season : null,
      episode: has(r.episode) ? r.episode : has(p.episode) ? p.episode : null, year: r.year || p.year || null};
  }
  // the next episode of the same show in the same chat (the file after this one): a row, or null
  async function nextInChat(r) {
    await libs();
    const d = describe(r);
    if (d.episode === null || !d.title) return null;
    const {c, Api} = await client();
    const ent = await resolve(r.chat_id, r.chat_username);
    const got = (await searchChat(c, Api, ent, d.title, 80)).map(withParsed).filter((cd) => isVideoCand(cd) && !cd.parsed.is_trailer);
    const pick = (season, episode) => {
      const fit = got.filter((cd) => E.matches([season, episode], cd.file, cd.caption) && E.mentions(d.title, cd.file, cd.caption) &&
        cd.parsed.episode !== null && cd.parsed.episode !== undefined);
      // the same release family first: same quality, then the nearest size
      fit.sort((a, b) => (Number(b.parsed.quality === r.quality) - Number(a.parsed.quality === r.quality)) || Math.abs((a.size || 0) - (r.size || 0)) - Math.abs((b.size || 0) - (r.size || 0)));
      return fit[0] || null;
    };
    const cd = pick(d.season, Number(d.episode) + 1) || (d.season !== null ? pick(Number(d.season) + 1, 1) : null);
    return cd ? slim(cd) : null;
  }
  function noPlayer(r) {
    const link = tgLink(r);
    TN.modal(`<div class="detail" style="grid-template-columns:1fr"><div><p class="msg">${TN.esc(TN.t('tgs_noplayer'))}</p><p dir="auto">${TN.esc(r.file || '')}</p>` +
      (link ? `<div class="actions"><a class="btn" target="_blank" rel="noopener" href="${TN.esc(link)}">${TN.esc(TN.t('tgs_open_tg'))}</a></div>` : '') + '</div></div>');
  }
  // ctx: {req: a sources request of a TMDb title (the play is then booked under the title's own key by sources.play),
  //       rows: the list on the screen ("another link" = the row after this one), back: () => reopen that list}
  async function play(r, title, ctx) {
    ctx = ctx || {};
    await libs().catch(() => {});
    if (ctx.req && ctx.req.id) {                           // opened from a title: the sources service books it
      const src = await TN.provider('sources').catch(() => null);
      if (src && typeof src.play === 'function') {
        const rows = (ctx.rows || [r]).map((x) => ({label: x.file, quality: x.quality, size: x.size, tg: x, status: 'tg'}));
        return src.play(rows[(ctx.rows || [r]).indexOf(r)] || rows[0], ctx.req, {rows});
      }
    }
    const pl = await TN.provider('player').catch(() => null);
    if (!pl || !pl.open) return noPlayer(r);
    const key = (ctx.req && ctx.req.resumeKey) || histKey(r);
    const d = describe(r);
    const label = title || r.file || 'Telegram';
    const rest = (ctx.rows || []).slice((ctx.rows || []).indexOf(r) + 1).filter((x) => x && x !== r && x.msg_id);
    const alt = rest.length ? () => play(rest[0], title, Object.assign({}, ctx, {tries: (ctx.tries || 0) + 1})) : null;
    noteRecent(r);
    const ep = d.episode !== null ? {season: d.season === null ? 1 : Number(d.season), episode: Number(d.episode)} : {};
    return pl.open({
      tg: Object.assign({}, r, {peer: r.chat_username || r.chat_id, msg: r.msg_id}),
      title: label, mime: r.mime || '', size: r.size || 0, resumeKey: key,
      sub: [d.episode !== null ? 'S' + String(ep.season).padStart(2, '0') + 'E' + String(ep.episode).padStart(2, '0') : '', r.chat_title || ''].filter(Boolean).join(' · '),
      meta: Object.assign({type: d.episode !== null ? 'tv' : 'movie', title: d.title || label, year: d.year || undefined, release: r.file || ''}, ep, ctx.req || {}),
      history: {key, label, thumb: '', plot: [r.chat_title, r.size ? sizeText(r.size) : ''].filter(Boolean).join(' · '), play: kodiPlay(r)},
      back: ctx.back || (() => { if (TN.closeModal) TN.closeModal(); }),
      alt, autoAlt: false,
      // the player opens the next request through the sources service: the row travels inside it (sources() below)
      next: d.episode !== null ? async () => {
        const n = await nextInChat(r).catch(() => null);
        if (!n) return null;
        const nd = describe(n);
        return {type: 'tv', title: nd.title || d.title, season: nd.season === null ? ep.season : Number(nd.season), episode: Number(nd.episode),
          resumeKey: histKey(n), tgRow: n, open: () => play(n, '', {back: ctx.back})};
      } : null,
    });
  }
  // a history row 'tg:<chat>:<msg>' (this browser's, or the same file noted by another browser of the account)
  async function openHistory(entry) {
    const m = /^tg:(-?\d+|@?[A-Za-z][\w]{3,31}):(\d+)$/.exec(String((entry && entry.key) || ''));
    if (!m) return false;
    const info = (TN.get(RECENT, {}) || {})[entry.key] || {};
    const r = {backend: 'tg', chat_id: m[1], msg_id: parseInt(m[2], 10), file: info.f || entry.label || '', chat_title: info.c || '', chat_username: info.u || null,
      size: info.s || 0, duration: info.d || 0};
    try {
      await libs();
      const ent = await resolve(r.chat_id, r.chat_username);
      r.chat_username = ent.username || r.chat_username;
      r.chat_title = r.chat_title || ent.title || '';
    } catch (e) {
      const code = errCode(e);
      TN.modal(`<div class="detail" style="grid-template-columns:1fr"><div><h3 dir="auto">${TN.esc(r.file)}</h3><p class="msg">${TN.esc(/TG_NO_LOGIN/.test(code) ? TN.t('tgs_login') : TN.t('tgs_gone'))}</p>` +
        `<div class="actions">${/TG_NO_LOGIN/.test(code) ? `<a class="btn" href="#/tglogin">${TN.esc(TN.t('tgs_label'))}</a>` : ''}` +
        (tgLink(r) ? `<a class="btn ghost" target="_blank" rel="noopener" href="${TN.esc(tgLink(r))}">${TN.esc(TN.t('tgs_open_tg'))}</a>` : '') + '</div></div></div>');
      return true;
    }
    await play(r, entry.label || r.file);
    return true;
  }
  if (TN.addHistoryHandler) TN.addHistoryHandler((entry) => { if (!/^tg:/.test(String((entry && entry.key) || ''))) return false; openHistory(entry); return true; });

  // ------------------------------------------------------------ provider glue
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
      return rows.map((r) => ({title: r.file, sub: rowSub(r), img: '', kind: 'tg', score: r.score, tg: r, open: () => play(r, '', {rows})}));
    },
    async sources(req, {signal} = {}) {
      if (!(await loggedIn())) return [];
      // "next episode" of a file played straight from a chat: the row is already known
      const rows = req.tgRow ? [req.tgRow] : await find(await targetFor(req), {signal});
      return rows.map((r) => ({label: r.file, quality: r.quality, lang: (r.langs || []).join(','), size: r.size, tg: r,
        open: () => play(r, req.title, {req, rows})}));
    },
    // for telegram.js / tgplay / the player
    toCand, message, peer, resolve, chatVideos, find, free, freeMore, freeHasMore, aiTitles, geminiKey, bots, play, rowSub, sizeText, targetFor,
    rememberEntities, entityId, markedId, tme, linkInfo, parseJoin, join, hush, seen, quiet, pinnedChats, stateOf, histKey, kodiPlay, tgLink,
    nextInChat, openHistory, isVideoCand, describe,
    planQueries: (t) => (M ? M.planQueries(t, S) : []), libs,
  });
})(self.TN);
