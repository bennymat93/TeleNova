'use strict';
// WP-2: web/tgsearch.js + web/telegram.js with a fake TN and a fake GramJS client (no network, no real account).
//   node src/qa/web/t_tgsearch.js
// Covers: the search pipeline, free search and its paging, t.me links (against what the build's tgbots.tme answers),
// request bots (a scripted bot: buttons, start links, "join first"), tracked playing (history / resume key / next
// episode / another link), the history handler, the Telegram page's pure parts.
const path = require('path'), fs = require('fs'), vm = require('vm');
const WEB = path.join(__dirname, '..', '..', '..', 'web');
let bad = 0, n = 0;
const ok = (c, what) => { n++; if (!c) { bad++; console.log('FAIL', what); } };

// ---- fake GramJS
class O { constructor(a) { Object.assign(this, a); this.className = this.constructor.name; } }
const mk = (name) => ({[name]: class extends O {}})[name];
const Api = {messages: {}, channels: {}, contacts: {}, account: {}, folders: {}};
for (const k of ['InputPeerEmpty', 'InputMessagesFilterEmpty', 'InputMessagesFilterVideo', 'InputMessagesFilterDocument', 'InputNotifyPeer',
  'InputPeerNotifySettings', 'InputFolderPeer', 'InputUserSelf']) Api[k] = mk(k);
for (const k of ['SearchGlobal', 'ImportChatInvite', 'GetBotCallbackAnswer', 'DeleteChatUser', 'DeleteHistory']) Api.messages[k] = mk(k);
for (const k of ['JoinChannel', 'LeaveChannel', 'GetChannelRecommendations']) Api.channels[k] = mk(k);
Api.contacts.Search = mk('Search'); Api.account.UpdateNotifySettings = mk('UpdateNotifySettings'); Api.folders.EditPeerFolders = mk('EditPeerFolders');
const GB = 1024 ** 3;
const doc = (id, file, size, dur, mime = 'video/x-matroska') => ({className: 'Document', id, size: {toString: () => String(size)}, mimeType: mime,
  attributes: [{className: 'DocumentAttributeFilename', fileName: file}].concat(dur ? [{className: 'DocumentAttributeVideo', duration: dur, w: 1920, h: 1080}] : [])});
const msg = (ch, id, d, caption = '') => ({className: 'Message', id, date: 1700000000, message: caption, peerId: {channelId: ch}, media: {className: 'MessageMediaDocument', document: d}});
const chats = [{className: 'Channel', id: 11, title: 'Movies HD', broadcast: true, username: 'movhd'}, {className: 'Channel', id: 22, title: 'סרטים', broadcast: true}];
const HITS = [
  msg(11, 1, doc(1, 'The.Matrix.1999.1080p.BluRay.mkv', 2 * GB, 8160)),
  msg(22, 5, doc(2, 'The Matrix 1999 1080p BluRay.mkv', 2 * GB + 1000, 8165)),          // same release elsewhere -> folded
  msg(11, 2, doc(3, 'The.Matrix.Reloaded.2003.720p.mkv', GB, 8280)),                    // sequel title -> rejected for the target
  msg(11, 3, doc(4, 'The.Matrix.1999.Trailer.mp4', 30 * 1024 * 1024, 120)),              // trailer -> rejected
  msg(22, 6, doc(5, 'readme.txt', 1000, 0, 'text/plain')),
  msg(22, 7, {className: 'Photo'}),
  msg(11, 4, doc(6, 'Matrix.1999.720p.HEB.mkv', 1.4 * GB, 8150), 'מטריקס תרגום מובנה'),
];
// ---- scripted bots: moviesbot (buttons -> a file), joinbot (demands a channel), linkbot (a start link to storebot)
const BOTS = {
  moviesbot: {className: 'User', id: 900, bot: true, username: 'moviesbot', firstName: 'Movies Bot'},
  joinbot: {className: 'User', id: 901, bot: true, username: 'joinbot', firstName: 'Join Bot'},
  linkbot: {className: 'User', id: 902, bot: true, username: 'linkbot', firstName: 'Link Bot'},
  storebot: {className: 'User', id: 903, bot: true, username: 'storebot', firstName: 'Store Bot'},
  deadbot: {className: 'User', id: 904, bot: true, username: 'deadbot', firstName: 'Dead Bot'},
  someone: {className: 'User', id: 905, username: 'someone', firstName: 'A person'},
};
const botChat = {};                               // bot id -> [messages]
let mid = 1000;
const sent = [];                                  // [bot username, text] of every message this account wrote
const say = (bot, m) => { (botChat[bot.id] = botChat[bot.id] || []).push(Object.assign({className: 'Message', id: ++mid, date: 1700000000, out: false, peerId: {userId: bot.id}, message: ''}, m)); };
const cb = (text, data) => ({className: 'KeyboardButtonCallback', text, data: Buffer.from(data)});
const url = (text, u) => ({className: 'KeyboardButtonUrl', text, url: u});
function botGets(bot, text) {
  (botChat[bot.id] = botChat[bot.id] || []).push({className: 'Message', id: ++mid, out: true, message: text, peerId: {userId: bot.id}});
  sent.push([bot.username, text]);
  const id = mid;
  if (bot.username === 'deadbot') return id;
  if (text === '/start') { say(bot, {message: 'Welcome! Send me a title.', replyMarkup: {rows: [{buttons: [cb('Help', 'help'), cb('Popular film 2020', 'pop')]}]}}); return id; }
  if (bot.username === 'moviesbot') {
    say(bot, {message: 'Choose a file:', replyMarkup: {rows: [{buttons: [cb('The Matrix 1999 1080p', 'a'), cb('Shrek 2001 720p', 'b')]}, {buttons: [cb('1/3', 'p'), cb('Next »', 'n')]}]}});
  } else if (bot.username === 'joinbot') {
    say(bot, {message: 'To use this bot, please join our channel first', replyMarkup: {rows: [{buttons: [url('Join channel', 'https://t.me/needjoin'), cb('✅ I joined', 'chk')]}]}});
  } else if (bot.username === 'linkbot') {
    say(bot, {message: 'The Matrix 1999', replyMarkup: {rows: [{buttons: [url('Download The Matrix 1999', 'https://t.me/storebot?start=CODE1')]}]}});
  } else if (bot.username === 'storebot' && text === '/start CODE1') {
    say(bot, {message: '', media: {className: 'MessageMediaDocument', document: doc(71, 'The.Matrix.1999.2160p.UHD.mkv', 20 * GB, 8170)}});
  }
  return id;
}
const calls = [];
let globalPages = null;                           // when set: SearchGlobal answers page by page (paging test)
const client = {
  async invoke(req) {
    calls.push(req.className);
    if (req.className === 'SearchGlobal') {
      if (globalPages) {
        const page = req.offsetId ? 1 : 0;
        return {className: 'messages.MessagesSlice', nextRate: page ? 0 : 7, messages: globalPages[page] || [], chats, users: []};
      }
      return {className: 'messages.Messages', messages: HITS.slice(), chats, users: []};
    }
    if (req.className === 'GetBotCallbackAnswer') {
      const d = req.data.toString();
      if (d === 'a') say(req.peer, {message: 'Here it is', media: {className: 'MessageMediaDocument', document: doc(70, 'The.Matrix.1999.1080p.WEB.x264.mkv', 3 * GB, 8160)}});
      if (d === 'b') say(req.peer, {message: '', media: {className: 'MessageMediaDocument', document: doc(72, 'Shrek.2001.720p.mkv', GB, 5400)}});
      if (d === 'n') return {message: 'No more pages'};
      return {};
    }
    if (req.className === 'JoinChannel') return {chats: [{className: 'Channel', id: 33 + String(req.channel).length, title: 'Joined', broadcast: true, username: req.channel}]};
    if (req.className === 'Search') return {chats: chats.concat([{className: 'Channel', id: 44, title: 'Scam chat', broadcast: true, scam: true, username: 'scamx'}]), users: [BOTS.moviesbot, BOTS.someone], myResults: [{channelId: 11}]};
    if (req.className === 'GetChannelRecommendations') return {chats: [{className: 'Channel', id: 55, title: 'Similar chan', broadcast: true, username: 'simchan', left: true, participantsCount: 1200}]};
    return {chats: []};
  },
  async sendMessage(ent, o) { if (ent === 'me') { sent.push(['me', o.message]); return {id: ++mid}; } return {id: botGets(ent, o.message)}; },
  async getMessages(ent, o = {}) {
    if (ent && ent.bot) {
      let list = (botChat[ent.id] || []).slice();
      if (o.ids !== undefined) return list.filter((m) => m.id === o.ids);
      if (o.filter) return [];
      if (o.minId !== undefined) list = list.filter((m) => m.id > o.minId);
      return list.sort((a, b) => b.id - a.id).slice(0, o.limit || 100);
    }
    if (o.ids !== undefined) return HITS.filter((m) => m.id === o.ids && ('-100' + m.peerId.channelId === '-100' + ent.id));
    if (o.search) return HITS.filter((m) => m.peerId.channelId === ent.id && m.media.document && m.media.document.attributes &&
      m.media.document.attributes[0].fileName.toLowerCase().includes(String(o.search).toLowerCase().split(' ')[0]));
    return [];
  },
  async getEntity(x) {
    const k = String(x).replace(/^@/, '').toLowerCase();
    if (BOTS[k]) return BOTS[k];
    if (k === 'movhd') return chats[0];
    if (k === 'nosuch') throw new Error('USERNAME_NOT_OCCUPIED');
    return chats[0];
  },
  async getInputEntity(x) { return x; }, async getDialogs() { return [{entity: chats[0], title: 'Movies HD', isChannel: true, unreadCount: 3}, {entity: chats[1], title: "צ'יקו מדיה סרטים", isChannel: true}, {entity: BOTS.moviesbot, title: 'Movies Bot'}, {entity: BOTS.joinbot, title: 'Join Bot'}]; },
  async markAsRead() { calls.push('markAsRead'); },
};

// ---- fake TN
const pages = {}, provs = {}, store = {}, cfg = {}, histHandlers = [], modals = [];
const history = [];
const played = [];                                // what the player was asked to open
const srcPlays = [];                              // what the sources service was asked to play
const TN = {
  i18n: {add() {}}, t: (k, ...a) => k + (a.length ? ':' + a.join(',') : ''), lang: () => 'he', esc: (s) => String(s),
  registerPage: (k, f) => { pages[k] = f; }, registerProvider: (k, v) => { provs[k] = v; }, on() { return () => {}; },
  load: async (name) => { if (!provs[name]) vm.runInContext(fs.readFileSync(path.join(WEB, name + '.js'), 'utf8'), ctx); },
  provider: async (name) => { if (!provs[name] && fs.existsSync(path.join(WEB, name + '.js')) && ['matcher', 'epmatch', 'tgsearch'].includes(name)) await TN.load(name); return provs[name] || null; },
  tg: async () => ({client: async () => client, connected: () => true, hasSession: () => true}),
  settings: {synced: () => ({content_lang: 1, pinned_chats: 'movhd, -10022'}), get: (k, d) => (k in cfg ? cfg[k] : d), set: (k, v) => { cfg[k] = v; }},
  get: (k, d) => (k in store ? store[k] : d), put: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
  store: {history: () => history, addSearch() {}},
  addHistoryHandler: (f) => histHandlers.push(f), modal: (h) => modals.push(h), closeModal() {},
  hasTmdbKey: () => false, link: (k, p) => '#/' + k + '/' + new URLSearchParams(p), params: (a) => Object.fromEntries(new URLSearchParams(a || '')),
};
provs.player = {open: async (o) => { played.push(o); return {}; }};
provs.sources = {play: async (row, req, c) => { srcPlays.push({row, req, c}); }};
const ctx = vm.createContext({TN, console, URLSearchParams, setTimeout, clearTimeout, Promise, Map, Set, Buffer});
ctx.self = ctx; ctx.GramJS = {Api, helpers: {}};
vm.runInContext(fs.readFileSync(path.join(WEB, 'tgsearch.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, 'telegram.js'), 'utf8'), ctx);

(async () => {
  const S = provs.tgsearch;
  ok(S && S.kinds.includes('search') && S.kinds.includes('source'), 'provider registered with search + source');
  ok(typeof pages.telegram === 'function', 'page telegram registered');
  const target = {kind: 'movie', aliases: ['The Matrix', 'מטריקס'], year: 1999, runtime: 136};
  const rows = await S.find(target);
  const files = rows.map((r) => r.file);
  ok(files.includes('The.Matrix.1999.1080p.BluRay.mkv') || files.includes('The Matrix 1999 1080p BluRay.mkv'), 'the 1080p release found');
  ok(!files.some((f) => /Reloaded|Trailer|readme/.test(f)), 'sequel / trailer / text rejected: ' + files);
  const r1080 = rows.find((r) => /1080p/.test(r.file));
  ok(r1080 && (r1080.also || []).length === 1 && (r1080.mirrors || []).length === 1, 'same release in two chats listed once with a mirror');
  ok(rows.length === 2, 'two rows (1080p + 720p HEB): ' + rows.length);
  ok(rows.every((r) => r.chat_id.startsWith('-100') && !('parsed' in r)), 'marked chat ids, slim rows');
  ok(calls.filter((c) => c === 'SearchGlobal').length === S.planQueries(target).length, 'one global search per planned query');
  const he = rows.find((r) => /HEB/.test(r.file));
  ok(he && he.langs.includes('he_sub'), 'Hebrew subs tag kept');
  ok(sent.length === 0, 'a search writes to no bot while none was chosen');
  // the account's synced pinned chats are searched too (read only)
  const pins = S.pinnedChats();
  ok(pins.length === 2 && pins[0].id === '@movhd' && pins[1].id === '-10022' && pins.every((p) => p.synced), 'synced pinned_chats: ' + JSON.stringify(pins));
  // free search: S/E filter
  HITS.push(msg(11, 9, doc(9, 'Fauda.S04E03.1080p.mkv', GB, 2700)), msg(11, 10, doc(10, 'Fauda.S04E04.1080p.mkv', GB, 2700)));
  const fr = await S.search('Fauda S04E03');
  ok(fr.length === 1 && fr[0].title === 'Fauda.S04E03.1080p.mkv', 'free search keeps only the exact episode: ' + fr.map((x) => x.title));
  const fm = await S.search('matrix');
  ok(fm.length >= 3 && !fm.some((x) => /readme|Trailer/.test(x.title)), 'free search: videos only, no trailer: ' + fm.map((x) => x.title));
  ok(S.message('-10011', 1) && S.peer('-10011').title === 'Movies HD', 'message / peer remembered for playback');
  ok(S.freeHasMore('matrix') === false, 'a search Telegram answered in one page has no "more"');

  // ---- paging of the global search (tgclient.search_more)
  const many = (from, to, name) => { const out = []; for (let i = from; i < to; i++) out.push(msg(11, 2000 + i, doc(5000 + i, `${name}.Part${i}.2010.720p.mkv`, GB + i * 7 * 1024 * 1024, 5000 + i * 60))); return out; };
  globalPages = [many(0, 25, 'Paging.Film'), many(25, 37, 'Paging.Film')];
  const p1 = await S.free('paging film', {limit: 25});
  ok(p1.length === 25, 'first page: 25 rows, got ' + p1.length);
  ok(S.freeHasMore('paging film') === true, 'the first page says there is more');
  const p2 = await S.freeMore('paging film', {limit: 25, have: p1});
  ok(p2.items.length === 12 && !p2.items.some((r) => p1.some((x) => x.msg_id === r.msg_id)), 'second page: the 12 rows no earlier page gave, got ' + p2.items.length);
  ok(p2.more === false, 'after the last page: no more');
  const p3 = await S.freeMore('paging film', {limit: 25, have: p1.concat(p2.items)});
  ok(p3.items.length === 0 && p3.more === false, 'asking again gives nothing and does not loop');
  globalPages = null;

  // ---- t.me links: exactly what the build's tgbots.tme answers
  const TME = [['https://t.me/movhd/123', ['msg', 'movhd', 123]], ['t.me/movhd', ['join', 'https://t.me/movhd']], ['https://t.me/c/1234567/89', ['msg', -1001234567, 89]],
    ['https://t.me/filebot?start=abc_DEF-1', ['start', 'filebot', 'abc_DEF-1']], ['tg://resolve?domain=filebot&start=xyz', ['start', 'filebot', 'xyz']],
    ['tg://resolve?domain=movhd&post=77', ['msg', 'movhd', 77]], ['tg://resolve?domain=movhd', ['join', 'https://t.me/movhd']],
    ['https://t.me/+AbCdEf', ['join', 'https://t.me/+AbCdEf']], ['https://t.me/joinchat/AbC-12', ['join', 'https://t.me/joinchat/AbC-12']], ['https://t.me/s/movhd', null],
    ['https://example.com/x', null], ['https://t.me/addstickers/pack', null], ['https://telegram.me/movhd/5?single', ['msg', 'movhd', 5]], ['https://t.me/ab', null],
    ['https://t.me/movhd?foo=1', null], ['http://www.t.me/movhd/12/34', ['msg', 'movhd', 34]], ['https://t.me/', null], ['t.me/c/12/x', null],
    ['https://t.me/share/url?url=x', null], ['https://t.me/movhd/abc', null]];
  for (const [u, want] of TME) {
    const got = S.tme(u);
    ok(JSON.stringify(got ? got.map(String) : got) === JSON.stringify(want ? want.map(String) : want), 'tme ' + u + ' -> ' + JSON.stringify(got));
  }
  ok(JSON.stringify(S.bots.linksIn('see t.me/chan1 and https://t.me/b?start=1, not a@t.me/x')) === '["t.me/chan1","https://t.me/b?start=1,"]', 'links in a text: ' + JSON.stringify(S.bots.linksIn('see t.me/chan1 and https://t.me/b?start=1, not a@t.me/x')));
  // linkInfo: a message with a video, a chat, a bot start code, an invite
  const li = await S.linkInfo('https://t.me/movhd/9');
  ok(li.kind === 'msg' && li.row && li.row.file === 'Fauda.S04E03.1080p.mkv' && li.row.season === 4 && li.row.episode === 3, 'link to a message with a video: ' + JSON.stringify(li.row && li.row.file));
  const li2 = await S.linkInfo('https://t.me/movhd/7777');
  ok(li2.kind === 'msg' && li2.row === null, 'link to a message without a video');
  ok((await S.linkInfo('https://t.me/movhd')).kind === 'chat', 'link to a channel');
  const li3 = await S.linkInfo('https://t.me/storebot?start=CODE1');
  ok(li3.kind === 'bot' && li3.code === 'CODE1', 'link with a bot start code');
  ok((await S.linkInfo('https://t.me/+AbCdEf')).kind === 'invite', 'invite link asks before joining');
  ok((await S.linkInfo('https://example.com')).kind === 'bad', 'not a Telegram link');

  // ---- request bots
  const B = S.bots;
  ok(B.enabled() === true && B.autoOn() === false && B.autojoin() === false, 'bots: only chosen ones are asked; auto and auto-join are off by default');
  ok((await B.content()).length === 0, 'no bot chosen -> no bot asked');
  ok(B.isSystem('BotFather') && !B.isSystem('moviesbot'), 'system bots are never asked');
  const rank = B.defaultRank('The Matrix 1999');
  ok(rank('The Matrix 1999 1080p') === 1 && rank('Shrek 2001') === 0 && Math.abs(rank('matrix reloaded') - 1 / 3) < 1e-9, 'default rank = share of the wanted words');
  // moviesbot: never opened -> /start, then the title; the fitting button is pressed, the file taken, the other film is not
  const a1 = await B.raw('@moviesbot', 'The Matrix 1999', {speed: 25});
  ok(a1.error === null && a1.answered && a1.files.length === 1 && a1.files[0].file === 'The.Matrix.1999.1080p.WEB.x264.mkv', 'bot: file after pressing the fitting button: ' + JSON.stringify([a1.error, a1.files.map((f) => f.file)]));
  ok(a1.clicked === 1, 'bot: exactly one button pressed (not "Shrek", not the page counter): ' + a1.clicked);
  ok(a1.files[0].via_bot === 'moviesbot' && a1.files[0].chat_kind === 'bot' && a1.files[0].chat_id === '900', 'bot file: marked as brought by the bot');
  ok(JSON.stringify(sent.filter((x) => x[0] === 'moviesbot').map((x) => x[1])) === '["/start","The Matrix 1999"]', 'bot never opened: /start first, then the request: ' + JSON.stringify(sent));
  ok(calls.includes('UpdateNotifySettings') && calls.includes('markAsRead'), 'quiet mode: the bot chat is muted and its answers marked as read');
  ok(!calls.includes('EditPeerFolders'), 'a bot chat is muted, not archived');
  // joinbot: "join our channel first" is reported, nothing is joined without permission
  const a2 = await B.raw('joinbot', 'The Matrix 1999', {speed: 25});
  ok(a2.files.length === 0 && JSON.stringify(a2.join) === '["https://t.me/needjoin"]' && !calls.includes('JoinChannel'), 'bot demands a channel: reported, not joined: ' + JSON.stringify(a2.join));
  const a2b = await B.raw('joinbot', 'The Matrix 1999', {speed: 25, autojoin: true});
  ok(a2b.joined === 1 && calls.includes('JoinChannel') && calls.includes('EditPeerFolders'), 'with auto-join allowed: joined, muted and archived');
  // linkbot: a t.me/<bot>?start=<code> link is followed, the file store bot sends the file
  const a3 = await B.raw('https://t.me/linkbot', 'The Matrix 1999', {speed: 25});
  ok(a3.files.length === 1 && a3.files[0].file === 'The.Matrix.1999.2160p.UHD.mkv' && sent.some((x) => x[0] === 'storebot' && x[1] === '/start CODE1'), 'bot start link followed: ' + JSON.stringify(a3.files.map((f) => f.file)));
  const a4 = await B.raw('deadbot', 'x y', {speed: 60});
  ok(a4.error === 'no_answer' && !a4.answered, 'a bot that never answers: no_answer, got ' + a4.error);
  ok((await B.raw('someone', 'x', {speed: 25})).error === 'not_a_bot', 'a person is never written to');
  ok(!sent.some((x) => x[0] === 'someone'), 'nothing was sent to a person');
  ok((await B.raw('nosuch', 'x', {speed: 25})).error === 'bot_not_found', 'unknown name: bot_not_found');
  // the viewer's request ("Ask a bot"): rows + statistics
  const ask = await B.ask('moviesbot', 'The Matrix 1999', {speed: 25});
  ok(ask.files.length === 1 && ask.files[0].quality === 1080 && !('parsed' in ask.files[0]) && ask.text === '', 'ask: slim rows with quality: ' + JSON.stringify(ask.files[0] && ask.files[0].quality));
  ok(store.tg_bots.stats.moviesbot.asked === 1 && store.tg_bots.stats.moviesbot.hits === 1, 'ask: the bot\'s statistics are kept');
  ok(B.errorText({error: 'no_answer'}) === 'tgs_bot_none' && B.errorText({error: 'flood_wait_30'}) === 'tgs_bot_flood:30' && B.errorText({}) === '', 'bot errors as texts');
  // marking: always ask / never ask / forget; the list
  B.mark('moviesbot', true, {title: 'Movies Bot', username: 'moviesbot', id: 900});
  B.mark('joinbot', false, {title: 'Join Bot', username: 'joinbot', id: 901});
  B.mark('@extbot', true, {title: 'Ext', username: 'extbot'});
  const list = await B.list();
  ok(list.map((b) => b.username + ':' + b.state).join() === 'moviesbot:on,extbot:on,joinbot:off', 'my bots: chosen first, switched off last: ' + list.map((b) => b.username + ':' + b.state));
  ok((await B.content()).map((b) => b.key).join() === 'moviesbot,extbot', 'a search asks the chosen bots only: ' + (await B.content()).map((b) => b.key));
  B.mark('extbot', null);
  ok(!store.tg_bots.cfg.extbot, 'forget removes the choice');
  ok(JSON.stringify(B.queries({kind: 'episode', aliases: ['Fauda'], season: 4, episode: 3}, ['Fauda', 'פאודה'])) === '["Fauda S04E03","פאודה"]', 'bot wording for an episode + the other script');
  ok(JSON.stringify(B.queries({kind: 'movie', aliases: ['The Matrix'], year: 1999}, ['The Matrix'])) === '["The Matrix","The Matrix 1999"]', 'bot wording for a film');
  // a title search now also asks the chosen bot, and its file is ranked with the rest
  B._speed = 60;
  const before = sent.length;
  const rows2 = await S.find(target, {refresh: true});
  ok(sent.length > before && sent[sent.length - 1][0] === 'moviesbot', 'find asks the chosen bot');
  ok(rows2.some((r) => r.via_bot === 'moviesbot'), 'the bot\'s file is among the sources: ' + rows2.map((r) => r.file + '/' + (r.via_bot || '')));
  cfg.tgsearch_bots = false;
  const b2 = sent.length;
  await S.find(target, {refresh: true});
  ok(sent.length === b2, 'with bot search switched off nothing is written');
  delete cfg.tgsearch_bots;
  const br = B.buttonRank({kind: 'episode', aliases: ['Fauda'], season: 4, episode: 3});
  ok(br('Fauda S04E03 720p') >= 0.9 && br('Fauda S04E04') === null, 'button rank: the wanted episode yes, another episode never');

  // ---- playing, tracked
  const row = fr[0].tg;                                             // Fauda.S04E03 from the free search
  await S.play(row, '', {rows: [row, fm[0].tg]});
  const o = played[played.length - 1];
  ok(o.resumeKey === 'tg:-10011:9' && o.history.key === 'tg:-10011:9' && o.history.label === 'Fauda.S04E03.1080p.mkv', 'played file: resume key and history entry: ' + JSON.stringify(o.history));
  ok(/^plugin:\/\/plugin\.video\.telescope\/\?mode=playtg&chat=-10011&msg=9&name=/.test(o.history.play), 'history row carries the build\'s own play address: ' + o.history.play);
  ok(o.tg.peer === 'movhd' && o.tg.msg === 9, 'player gets the chat and message: ' + o.tg.peer + '/' + o.tg.msg);
  ok(o.meta.type === 'tv' && o.meta.season === 4 && o.meta.episode === 3 && /fauda/i.test(o.meta.title), 'subtitle search gets title / season / episode: ' + JSON.stringify(o.meta));
  ok(typeof o.alt === 'function' && typeof o.back === 'function', '"another link" and back are offered');
  const nx = await o.next();
  ok(nx && nx.season === 4 && nx.episode === 4 && nx.tgRow.file === 'Fauda.S04E04.1080p.mkv' && nx.resumeKey === 'tg:-10011:10', 'next episode: the file after it in the same chat: ' + JSON.stringify(nx && nx.tgRow && nx.tgRow.file));
  const viaSources = await S.sources(nx);
  ok(viaSources.length === 1 && viaSources[0].tg.msg_id === 10, 'the sources service gets that row for the next request');
  await o.alt();
  ok(played[played.length - 1].tg.msg_id === fm[0].tg.msg_id, '"another link" plays the row after it');
  ok(store.tg_recent['tg:-10011:9'].u === 'movhd', 'what is needed to reopen the file is kept (no file id, no hash): ' + JSON.stringify(store.tg_recent['tg:-10011:9']));
  // a film: no next episode
  await S.play(rows[0], 'The Matrix');
  const om = played[played.length - 1];
  ok(om.next === null && om.meta.type === 'movie' && om.title === 'The Matrix', 'a film: no next-episode button');
  // opened from a title: booked by the sources service under the title's key
  const req = {type: 'tv', id: 123, title: 'Fauda', season: 4, episode: 3};
  const np = played.length;
  await S.play(row, 'Fauda', {req, rows: [row]});
  ok(srcPlays.length === 1 && srcPlays[0].req === req && srcPlays[0].row.tg === row && played.length === np, 'a play from a title goes through the sources service (history, watched mark, next episode)');
  // watched / resume state of a row
  history.push({key: 'tg:-10011:9'});
  store.player_resume = {'tg:-10011:10': {t: 600, d: 2700}};
  ok(S.stateOf(row).seen === true && S.stateOf(nx.tgRow).resume.t === 600 && S.stateOf(rows[0]).seen === false, 'watched mark and resume point of a row');
  // the history handler: a 'tg:' row is opened again after a reload
  ok(histHandlers.length === 1 && histHandlers[0]({key: 'movie:5'}) === false, 'history handler leaves other rows alone');
  const hp = played.length;
  ok(histHandlers[0]({key: 'tg:-10011:9', label: 'Fauda.S04E03.1080p.mkv'}) === true, 'history handler takes a tg: row');
  await new Promise((r) => setTimeout(r, 30));
  ok(played.length === hp + 1 && played[played.length - 1].resumeKey === 'tg:-10011:9', 'the history row plays again');
  ok(S.tgLink({chat_id: '-1001234', msg_id: 7}) === 'https://t.me/c/1234/7' && S.tgLink({chat_username: 'movhd', chat_id: '-10011', msg_id: 7}) === 'https://t.me/movhd/7', 'open-in-Telegram links');

  // ---- telegram.js pure parts
  const T = ctx.TNTelegram, P = T.parseJoin;
  ok(JSON.stringify(P('https://t.me/joinchat/AbC-12')) === '{"invite":"AbC-12"}', 'joinchat link');
  ok(JSON.stringify(P('t.me/+XyZ')) === '{"invite":"XyZ"}', '+invite link');
  ok(JSON.stringify(P('@movhd')) === '{"name":"movhd"}' && JSON.stringify(P('https://t.me/movhd/123')) === '{"name":"movhd"}', '@name / t.me link');
  ok(P('x') === null, 'bad link');
  ok(JSON.stringify(T.parseArg('link=https://t.me/movhd/5?single&x=1')) === '{"v":"link","link":"https://t.me/movhd/5?single&x=1"}', 'a pasted link keeps its own & and =');
  ok(T.parseArg('link=https%3A%2F%2Ft.me%2Fmovhd%2F5').link === 'https://t.me/movhd/5', 'an encoded link is decoded');
  ok(T.parseArg('v=chat&c=-10011').c === '-10011' && T.parseArg('').v === undefined, 'ordinary arguments');
  for (const v of ['chats', 'chat', 'find', 'ai', 'discover', 'chiko', 'bots', 'bot', 'join', 'pins', 'settings', 'saved', 'link']) ok(T.VIEWS.includes(v), 'view ' + v);
  ok(T.offerable({title: 'x'}) && T.offerable({bot: true}) && !T.offerable({title: 'x', scam: true}) && !T.offerable({title: 'x', fake: true}) && !T.offerable({firstName: 'p'}) &&
    !T.offerable({title: 'x', restricted: true, restrictionReason: [{}]}), 'discovery never offers scam / fake / restricted chats or people');
  ok(T.togglePin({id: '-10011', title: 'Movies HD', username: 'movhd'}) === true && T.isPinned('-10011') && T.togglePin({id: '-10011'}) === false, 'pin / unpin');
  // join (quiet mode: muted + archived)
  calls.length = 0;
  await S.join('https://t.me/somechannel');
  ok(calls.includes('JoinChannel') && calls.includes('UpdateNotifySettings') && calls.includes('EditPeerFolders'), 'join in quiet mode: muted and archived');
  calls.length = 0; cfg.telegram_quiet = false;
  await S.join('@otherchan');
  ok(calls.includes('JoinChannel') && !calls.includes('UpdateNotifySettings'), 'quiet mode off: joined, not muted');
  delete cfg.telegram_quiet;

  // ---- every Telegram screen draws and every button on it works (stand-in document, the fake account above)
  const dom = require('./live_fakedom.js').make();
  const went = [];
  Object.assign(TN, dom.ui, {go: (h) => went.push(String(h)), route() {}, openTitle() {}, tmdb: async () => ({results: []}), toast() {}});
  ctx.document = dom.document; ctx.window = {open() {}, prompt() {}}; ctx.navigator = {};
  B._speed = 200;
  const draw = async (arg) => {
    let alive = true;
    try { await pages.telegram(arg, {current: () => alive, key: 'telegram', arg}); }
    catch (e) { ok(false, 'screen ' + arg + ' failed: ' + (e && e.stack || e)); }
    const failed = await dom.press(/chips/);
    for (const [label, e] of failed) ok(false, 'screen ' + arg + ', pressing ' + label + ': ' + (e && e.stack || e));
    alive = false;
    ok(true, 'screen ' + arg);
  };
  const SCREENS = ['', 'v=chats', 'v=chats&k=bot', 'v=chat&c=-10011', 'v=chat&c=@movhd&q=fauda', 'v=saved', 'v=find', 'v=find&q=matrix', 'v=ai', 'v=ai&q=robots',
    'v=discover', 'v=discover&p=0', 'v=discover&q=movies', 'v=discover&similar=mine', 'v=discover&similar=-10011', 'v=bots', 'v=bot&b=@moviesbot',
    'v=bot&b=@moviesbot&q=The Matrix 1999', 'v=bot&b=https://t.me/storebot&start=CODE1', 'v=bot&b=someone', 'v=join', 'v=pins', 'v=settings', 'v=chiko',
    'link=https://t.me/movhd/9', 'link=https://t.me/movhd/7777', 'link=https://t.me/movhd', 'link=https://t.me/storebot?start=CODE1', 'link=https://t.me/+AbCdEf',
    'link=https://example.com/x', 'link=@movhd', 'v=nosuchview'];
  for (const s of SCREENS) await draw(s);
  dom.state.value = 'matrix';                       // the same screens with their forms filled in
  for (const s of ['', 'v=saved', 'v=join', 'v=find', 'v=bots', 'v=chat&c=-10011', 'v=discover', 'v=ai', 'v=ai&q=robots', 'link=']) await draw(s);
  dom.state.value = '';
  const all = dom.texts.join('\n');
  ok(/Movies HD/.test(all) && /Fauda\.S04E03\.1080p\.mkv/.test(all), 'chats and file rows were drawn');
  ok(/tgm_watched/.test(all), 'a watched file is marked in the list');
  ok(/tgm_bot_files:1/.test(all), 'the bot screen shows what the bot sent');
  ok(/tgm_link_novideo/.test(all) && /tgm_link_invite/.test(all) && /tgm_link_bad/.test(all), 'link screens: no video / invite / not a link');
  ok(/tgs_no_ai/.test(all), 'smart search without a key says so and offers the key field');
  ok(/tgs_bot_nobot/.test(all), 'asking a person as a bot is refused with a text');
  ok(!/Scam chat/.test(all) && /Similar chan/.test(all), 'discovery: scam chats hidden, recommendations shown');
  ok(went.some((h) => /v=chat/.test(h)) && went.some((h) => /v=bot/.test(h)), 'links to channels and bots lead to their screens: ' + went.slice(0, 4));
  ok(played.some((o) => o.resumeKey === 'tg:-10011:9' && played.indexOf(o) > hp), 'a pasted link to a video plays it, tracked');
  ok(sent.some((x) => x[0] === 'me'), 'Saved Messages: the note was sent to the account\'s own chat only');
  ok(cfg.telegram_quiet === false || cfg.telegram_quiet === true, 'the quiet mode switch writes the setting');
  ok(cfg.gemini_key === 'matrix', 'the Gemini key typed on the smart search screen is kept in this browser\'s settings');
  ok(went.some((h) => /v=find&q=matrix/.test(h)) && went.some((h) => /link=matrix/.test(h)), 'search and link forms lead on: ' + went.filter((h) => /matrix/.test(h)).slice(0, 5));
  console.log(`${n} checks, ${bad} failures`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
