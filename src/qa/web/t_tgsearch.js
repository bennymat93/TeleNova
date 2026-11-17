'use strict';
// WP-2: web/tgsearch.js + web/telegram.js with a fake TN and a fake GramJS client (no network, no real account).
//   node src/qa/web/t_tgsearch.js
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
Api.messages.SearchGlobal = mk('SearchGlobal'); Api.messages.ImportChatInvite = mk('ImportChatInvite');
Api.channels.JoinChannel = mk('JoinChannel'); Api.account.UpdateNotifySettings = mk('UpdateNotifySettings'); Api.folders.EditPeerFolders = mk('EditPeerFolders');
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
const calls = [];
const client = {
  async invoke(req) { calls.push(req.className); if (req.className === 'SearchGlobal') return {className: 'messages.Messages', messages: HITS.slice(), chats, users: []}; return {chats: []}; },
  async getMessages() { return []; }, async getEntity(x) { return chats[0]; }, async getInputEntity(x) { return x; }, async getDialogs() { return []; },
};

// ---- fake TN
const pages = {}, provs = {}, store = {};
const TN = {
  i18n: {add() {}}, t: (k, ...a) => k + (a.length ? ':' + a.join(',') : ''), lang: () => 'he', esc: (s) => String(s),
  registerPage: (k, f) => { pages[k] = f; }, registerProvider: (k, v) => { provs[k] = v; }, on() { return () => {}; },
  load: async (name) => { if (!provs[name]) vm.runInContext(fs.readFileSync(path.join(WEB, name + '.js'), 'utf8'), ctx); },
  provider: async (name) => { if (!provs[name]) await TN.load(name); return provs[name] || null; },
  tg: async () => ({client: async () => client, connected: () => true, hasSession: () => true}),
  settings: {synced: () => ({content_lang: 1}), get: (k, d) => d}, get: (k, d) => (k in store ? store[k] : d), put: (k, v) => { store[k] = v; },
  hasTmdbKey: () => false, link: (k, p) => '#/' + k + '/' + new URLSearchParams(p), params: (a) => Object.fromEntries(new URLSearchParams(a || '')),
};
const ctx = vm.createContext({TN, console, URLSearchParams, setTimeout, Promise, Map, Set});
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
  // free search: S/E filter
  HITS.push(msg(11, 9, doc(9, 'Fauda.S04E03.1080p.mkv', GB, 2700)), msg(11, 10, doc(10, 'Fauda.S04E04.1080p.mkv', GB, 2700)));
  const fr = await S.search('Fauda S04E03');
  ok(fr.length === 1 && fr[0].title === 'Fauda.S04E03.1080p.mkv', 'free search keeps only the exact episode: ' + fr.map((x) => x.title));
  const fm = await S.search('matrix');
  ok(fm.length >= 3 && !fm.some((x) => /readme|Trailer/.test(x.title)), 'free search: videos only, no trailer: ' + fm.map((x) => x.title));
  ok(S.message('-10011', 1) && S.peer('-10011').title === 'Movies HD', 'message / peer remembered for playback');
  // bots stub
  ok(S.bots.enabled() === false, 'bots off by default');
  // telegram.js pure parts
  const P = ctx.TNTelegram.parseJoin;
  ok(JSON.stringify(P('https://t.me/joinchat/AbC-12')) === '{"invite":"AbC-12"}', 'joinchat link');
  ok(JSON.stringify(P('t.me/+XyZ')) === '{"invite":"XyZ"}', '+invite link');
  ok(JSON.stringify(P('@movhd')) === '{"name":"movhd"}' && JSON.stringify(P('https://t.me/movhd/123')) === '{"name":"movhd"}', '@name / t.me link');
  ok(P('x') === null, 'bad link');
  console.log(`${n} checks, ${bad} failures`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
