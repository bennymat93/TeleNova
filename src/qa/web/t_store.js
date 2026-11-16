'use strict';
// The browser's own model and sync loop, without a browser and without Telegram (run by run_web_tests.py):
//   node t_store.js <path of fflate's umd/index.js>
// web/store.js (users, history, favourites, search history - the build's shapes and rules) and web/websync.js (the
// round of the continuous sync) against a stand-in account that keeps the document sealed exactly as the real one
// does (web/sealed.js). The stand-in "Kodi device" writes documents the way autosync.py does.
const path = require('path');
const WEB = path.join(__dirname, '..', '..', '..', 'web');
const SD = require(path.join(WEB, 'syncdoc.js'));
const Sealed = require(path.join(WEB, 'sealed.js')).use(require(path.resolve(process.argv[2])));
const Store = require(path.join(WEB, 'store.js'));
const WS = require(path.join(WEB, 'websync.js')).make(SD);
const bad = [];
const check = (cond, what) => { if (!cond) bad.push(what); };
const throws = (f) => { try { f(); return false; } catch (e) { return true; } };

function storage() {
  const m = new Map();
  return {getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, keys: () => [...m.keys()], map: m};
}
const KEY = Sealed.cloudKey('5550001234');
class Cloud {                                      // the account's Saved Messages: sealed files with a caption
  constructor() { this.msgs = []; this.n = 0; this.puts = 0; this.gets = 0; this.down = false; this.onPut = null; }
  list() { return this.msgs.map((m) => ({id: m.id, date: m.date, note: WS.noteOf(m.caption)})).filter((m) => m.note).sort((a, b) => b.date - a.date); }
  async put(doc) {
    const blob = await Sealed.packDoc(SD.canon(doc), KEY, WS.NOTE);
    const msg = {id: ++this.n, date: 1794800000 + this.n, caption: WS.caption(WS.NOTE), blob};
    this.msgs.unshift(msg);
    this.msgs = this.msgs.filter((m) => m.id === msg.id || (WS.noteOf(m.caption) || {}).device !== WS.DOC_DEVICE);   // older files of the same name go
    this.puts++;
    return msg;
  }
  async doc() { const it = WS.mine(this.list()); return it ? SD.parse(await Sealed.unpackDoc(this.msgs.find((m) => m.id === it.id).blob, KEY)) : null; }
}
class Browser {                                    // the host websync.cycle talks to
  constructor(cloud, t0) {
    this.cloud = cloud; this.t = t0; this.ls = storage(); this.taken = {};
    this.store = Store.make(this.ls, SD, {now: () => this.t});
  }
  loadMeta() { try { return JSON.parse(this.ls.getItem('bn_sync_meta') || '{}'); } catch (e) { return {}; } }
  saveMeta(m) { this.ls.setItem('bn_sync_meta', JSON.stringify(m)); }
  users() { return this.store.users(); }
  userData(uid) { return this.store.data(uid); }
  setUsers(l) { return this.store.setUsers(l, true); }
  putUserData(uid, d) { return this.store.putData(uid, d, true); }
  takeSettings(v) { this.taken = v; }
  async cloudFind() { if (this.cloud.down) throw new Error('offline'); return WS.mine(this.cloud.list()); }
  async cloudGet(item) { if (this.cloud.down) return null; this.cloud.gets++; return SD.parse(await Sealed.unpackDoc(this.cloud.msgs.find((m) => m.id === item.id).blob, KEY)); }
  async cloudPut(doc) { if (this.cloud.down) return ''; if (this.cloud.onPut) this.cloud.onPut(); return WS.markOf(await this.cloud.put(doc)); }
  hist(uid) { return this.store.data(uid || this.store.current()).history.map((h) => h.key); }
}
const rounds = async (devs, n = 3) => { for (let i = 0; i < n; i++) for (const d of devs) { d.t += 1; await WS.cycle(d, d.t); } };

(async () => {
  // ---- the store on one browser: users (the rules of users.py)
  let now = 1794812400;                            // 16/11/2026
  const ls = storage(), st = Store.make(ls, SD, {now: () => now});
  check(st.live().map((u) => u.id).join() === 'u1' && st.current() === 'u1', 'a first user always exists');
  check(SD.canon(st.users()) === '[{"created":1,"deleted":0,"id":"u1","name":"","renamed":0}]', 'the first user is the build\'s first user');
  st.addHistory({key: 'movie:1', label: 'Film'});
  const kid = st.create('  Kids   Room  ');
  check(st.users()[1].name === 'Kids Room' && /^u[0-9a-f]{8}$/.test(kid), 'name cleaned, id as the build makes it');
  check(throws(() => st.create('')) && throws(() => st.create('kids room')) && throws(() => st.create('   ')), 'an empty / existing name is refused');
  check(st.cleanName('x'.repeat(50)).length === 30 && Array.from(st.cleanName('😀'.repeat(50))).length === 30, 'a name is 30 characters at most');
  check(st.switchTo(kid) && st.current() === kid && st.history().length === 0, 'switched: a new user starts empty');
  st.addHistory({key: 'movie:2', label: 'Cartoon'});
  check(st.switchTo('u1') && st.history()[0].key === 'movie:1' && st.data(kid).history[0].key === 'movie:2', 'each user has their own lists');
  check(!st.switchTo('u1') && !st.switchTo('nobody'), 'switching to the active / an unknown user does nothing');
  check(throws(() => st.remove('u1')), 'the active user cannot be deleted');
  now += 10; st.rename(kid, 'Children');
  check(st.users()[1].name === 'Children' && st.users()[1].renamed === now, 'renamed, with the time of the change');
  now += 10; st.remove(kid);
  check(st.live().length === 1 && st.users()[1].deleted === now && ls.getItem('bn_data_' + kid) === null, 'deleted: marked for the other devices, content gone');
  check(throws(() => st.remove('u1')), 'the only user cannot be deleted');

  // ---- history in the build's shape
  const h = st.history()[0];
  check(Object.keys(h).sort().join() === 'fanart,key,label,play,plot,thumb,ts,when' && /^\d\d\/\d\d\/\d{4} \d\d:\d\d$/.test(h.when) && typeof h.ts === 'number', 'a history entry has the build\'s keys');
  now += 5; st.addHistory({key: 'movie:3', label: 'B', plot: 'p'.repeat(500)});
  now += 5; st.addHistory({key: 'movie:1', label: 'Film'});
  check(st.history().map((x) => x.key).join() === 'movie:1,movie:3' && st.history()[1].plot.length === 300, 'one entry per title, newest first, short plots');
  st.clearHistory();
  check(st.history().length === 0 && st.data('u1').marks.history_cleared >= now, 'cleared, with a mark for the other devices');
  st.addHistory({key: 'movie:9', label: 'After'});
  check(SD.merge_user_data(st.data('u1'), null).history.length === 1, 'an entry made in the second of the clearing survives the merge');
  for (let i = 0; i < 520; i++) { now += 1; st.addHistory({key: 'k' + i, label: 'x'}); }
  check(st.history().length === 500, 'history is capped like the build\'s');

  // ---- favourites with removal marks
  st.addFav('movie', 603, 'The Matrix', '');
  st.addFav('movie', '603', 'again', '');
  check(st.favs().length === 1 && st.favs()[0].id === '603' && Object.keys(st.favs()[0]).sort().join() === 'added,extra,id,kind,label' && st.isFav('movie', 603), 'a favourite in the build\'s shape, once');
  st.removeFav('movie', 603);
  check(!st.isFav('movie', 603) && st.data('u1').removed[0].kind === 'movie' && SD.merge_user_data(st.data('u1'), {favourites: [{kind: 'movie', id: '603', label: 'x', added: st.whenStr(now - 3600)}]}).favourites.length === 0,
        'removed: it does not come back from a device that still has it');
  st.addFav('movie', 603, 'The Matrix', '');
  check(SD.merge_user_data(st.data('u1'), null).favourites.length === 1, 'added again in the same minute: it stays (the adding is the later one)');
  st.addFav('radio', 'uuid-1', 'Radio', 'https://s/1'); st.addFav('web_channel', 'il:kan11', 'Kan 11', '');
  st.clearFavs();
  check(st.favs().length === 0 && st.data('u1').removed.length === 3, 'clearing the favourites removes each with its mark');

  // ---- search history and suggestions (searchhist.py)
  now += 100;
  for (const q of ['Matrix', 'fauda', 'x', '  The   Matrix  Reloaded ', 'MATRIX']) { now += 1; st.addSearch(q); }
  check(st.searches().map((s) => s.q).join('|') === 'MATRIX|The Matrix Reloaded|fauda', 'one entry per text, cleaned, the old one moves up, one letter is not a search');
  check(st.match(st.searches(), 'mat').join('|') === 'MATRIX|The Matrix Reloaded' && st.match(st.searches(), 'matrix').join('|') === 'The Matrix Reloaded' &&
        st.match(st.searches(), '').length === 3, 'earlier searches: starting with the text, then containing it; all when nothing is typed');
  const res = [{media_type: 'movie', title: 'Matriarcas', popularity: 1}, {media_type: 'movie', title: 'The Matrix', popularity: 90}, {media_type: 'person', name: 'Matt'},
               {media_type: 'tv', name: 'מטריקס', original_name: 'Matrix TV', popularity: 5}, {media_type: 'tv', name: 'Other name', popularity: 99}, {media_type: 'movie', title: 'the matrix', popularity: 2}];
  check(st.titlesOf(res, 'matri').join('|') === 'The Matrix|Matrix TV|Matriarcas|Other name', 'catalogue titles: films and series, the best known first, no doubles: ' + st.titlesOf(res, 'matri').join('|'));
  check(SD.canon(st.mergeSuggest(['MATRIX', 'The Matrix Reloaded'], ['The Matrix', 'matrix', 'Matriarcas'], 'matri')) === '[["MATRIX","history"],["The Matrix Reloaded","history"],["The Matrix","title"],["Matriarcas","title"]]',
        'history first, then titles, no doubles');
  st.removeSearch('fauda');
  check(!st.searches().some((s) => s.q === 'fauda') && SD.merge_user_data(st.data('u1'), {searches: [{q: 'Fauda', ts: now - 50}]}).searches.every((s) => s.q.toLowerCase() !== 'fauda'), 'a removed search stays gone');
  st.addSearch('fauda');
  check(SD.merge_user_data(st.data('u1'), null).searches.some((s) => s.q === 'fauda'), 'searched again: it is back, even in the same second');
  st.clearSearches(); st.addSearch('dune');
  check(SD.merge_user_data(st.data('u1'), {searches: [{q: 'old', ts: now - 5}]}).searches.map((s) => s.q).join() === 'dune', 'cleared searches stay gone, a new one stays');

  // ---- the 3.x favourites move into the first user
  const ls2 = storage();
  ls2.setItem('bn_favs', JSON.stringify([{key: 'tmdb:movie:603', kind: 'movies', title: 'The Matrix', img: 'https://image.tmdb.org/t/p/w342/m.jpg', data: {type: 'movie', id: 603}},
    {key: 'tmdb:tv:1399', kind: 'tv', title: 'GoT', img: '', data: {type: 'tv', id: 1399}}, {key: 'ia:night_of_the_living_dead', kind: 'movies', title: 'Night', img: 'x', data: {identifier: 'night_of_the_living_dead'}},
    {key: 'ch:https://a/b.m3u8', kind: 'live', title: 'Kan 11', img: 'https://l/o.png', data: {url: 'https://a/b.m3u8'}}, {key: 'radio:uuid-9', kind: 'radio', title: 'Galgalatz', img: '', data: {url_resolved: 'https://r/s'}}, {junk: 1}]));
  const st2 = Store.make(ls2, SD, {now: () => now});
  check(st2.migrate() === 5 && st2.favs().map((f) => f.kind + ':' + f.id + ':' + f.extra).join(' ') === 'movie:603: series:1399: web_ia:night_of_the_living_dead: web_channel:https://a/b.m3u8:https://l/o.png radio:uuid-9:https://r/s',
        'old favourites become the build\'s kinds: ' + st2.favs().map((f) => f.kind + ':' + f.id).join(' '));
  check(st2.migrate() === 0 && ls2.getItem('bn_favs') === null && st2.art('movie', '603').endsWith('m.jpg'), 'once only; the pictures are kept here');

  // ---- the sync loop: a Kodi device founds the document, browsers join
  const cloud = new Cloud();
  const A = new Browser(cloud, 1794820000), B = new Browser(cloud, 1794820000);
  A.store.addHistory({key: 'movie:10', label: 'On A before any document'});
  let r = await WS.cycle(A, A.t);
  check(r.state === 'nodoc' && cloud.puts === 0, 'a browser never founds the account\'s document');
  // what autosync.py uploads from a configured Kodi device
  const kodi = SD.merge(null, {v: 2, users: [{id: 'u1', name: '', created: 1, renamed: 0, deleted: 0}],
    data: {u1: {history: [{key: 'tv:1399:1:2', label: 'GoT  S01E02', when: '16/11/2026 18:00', ts: 1794808800.5, play: 'plugin://plugin.video.nova/?a=play&m=episode&id=1399&s=1&e=2', plot: '', thumb: '', fanart: ''}],
                favourites: [{kind: 'movie', id: '603', label: 'The Matrix', extra: '', added: '15/11/2026 10:00'}]}},
    settings: {'plugin.video.nova': {tmdb_key: ['TMDB-KEY', 1794800000], content_lang: ['1', 1794800000], gemini_key: ['SECRET', 5], debug: ['true', 9], last_check: ['x', 9]},
               'plugin.video.telescope': {rd_token: ['RD-SECRET', 1794800001], api_hash: ['HASH', 1.5]}},
    files: {'iptv.json': [{m3u: ['http://list']}, 1794800002]}});
  await cloud.put(kodi);
  const kodiDoc = SD.canon(await cloud.doc());
  r = await WS.cycle(A, ++A.t);
  check(r.pulled && r.pushed && A.hist().join() === 'movie:10,tv:1399:1:2' && A.store.isFav('movie', '603'), 'the browser takes the account\'s lists and adds its own: ' + JSON.stringify(r));
  check(SD.canon(A.taken) === '{"content_lang":"1","tmdb_key":"TMDB-KEY"}', 'it reads the TMDb key and the language, nothing else: ' + SD.canon(A.taken));
  let doc = await cloud.doc();
  check(SD.canon(doc.settings) === SD.canon(SD.parse(kodiDoc).settings) && SD.canon(doc.files) === SD.canon(SD.parse(kodiDoc).files), 'settings and files pass through untouched');
  check(!A.ls.keys().some((k) => /RD-SECRET|SECRET|HASH/.test(A.ls.getItem(k))), 'no key or token of the household is kept in the browser\'s storage');
  check(cloud.msgs.length === 1, 'the older file of the document was removed after the upload');
  r = await WS.cycle(B, ++B.t);
  check(r.pulled && !r.pushed && B.hist().join() === 'movie:10,tv:1399:1:2', 'a second browser receives everything and writes nothing back: ' + JSON.stringify(r));
  let puts = cloud.puts, gets = cloud.gets;
  await rounds([A, B]);
  check(cloud.puts === puts && cloud.gets === gets, `idle browsers neither fetch nor write: ${puts}->${cloud.puts} puts, ${gets}->${cloud.gets} gets`);

  // both change things at the same time
  A.t += 100; B.t += 101;
  A.store.addHistory({key: 'movie:11', label: 'A2'}); A.store.addFav('series', 1399, 'GoT', '');
  B.store.addHistory({key: 'movie:12', label: 'B2'}); B.store.removeFav('movie', '603'); B.store.addSearch('fauda');
  const kids = B.store.create('Kids'); B.store.switchTo(kids); B.t += 1; B.store.addHistory({key: 'movie:13', label: 'cartoon'});
  await rounds([A, B]);
  check(A.hist('u1').join() === 'movie:12,movie:11,movie:10,tv:1399:1:2' && A.hist('u1').join() === B.hist('u1').join(), 'both histories merged on both: ' + A.hist('u1'));
  check(!A.store.isFav('movie', '603') && A.store.isFav('series', '1399') && B.store.data('u1').favourites.length === 1, 'adding and removing favourites both travel: ' + SD.canon([A.store.data('u1').favourites, A.store.data('u1').removed, B.store.data('u1').favourites]));
  check(A.store.live().map((u) => u.name).join() === ',Kids' && A.hist(kids).join() === 'movie:13' && A.store.data('u1').searches[0].q === 'fauda', 'the new user, their content and the searches arrive');
  check(A.store.current() === 'u1' && B.store.current() === kids, 'which user is active stays each browser\'s own choice');
  puts = cloud.puts; gets = cloud.gets;
  await rounds([A, B]);
  check(cloud.puts === puts && cloud.gets === gets, 'idle again afterwards (no ping-pong)');
  check(SD.same(await cloud.doc(), SD.merge(await cloud.doc(), null)) && SD.canon((await cloud.doc()).settings) === SD.canon(SD.parse(kodiDoc).settings), 'the document stays in normal form, settings untouched');

  // a change while the account is unreachable is not lost; a change made DURING an upload is not lost either
  cloud.down = true; A.t += 50;
  A.store.addHistory({key: 'movie:14', label: 'offline'});
  check(await WS.cycle(A, ++A.t).then(() => false, () => true), 'no account: the round reports it');
  cloud.down = false;
  cloud.onPut = () => { cloud.onPut = null; A.t += 1; A.store.addHistory({key: 'movie:15', label: 'typed while uploading'}); };
  await rounds([A, B]);
  check(B.hist('u1').includes('movie:14') && B.hist('u1').includes('movie:15'), 'sent as soon as the account answers; the change made during the upload follows: ' + B.hist('u1'));

  // clearing travels; a user deleted on one browser disappears on the other, which moves to the first user
  A.t += 50; A.store.clearHistory();
  await rounds([A, B]);
  check(A.hist('u1').length === 0 && B.hist('u1').length === 0, 'a cleared history stays cleared everywhere');
  A.t += 10; A.store.remove(kids);
  await rounds([A, B]);
  check(B.store.current() === 'u1' && B.store.live().length === 1 && B.ls.getItem('bn_data_' + kids) === null && !(kids in (await cloud.doc()).data), 'deleted everywhere, the active user moved');

  // a Kodi device changes a setting meanwhile: the browser fetches, reads, and does not write
  doc = await cloud.doc();
  doc.settings['plugin.video.nova'].tmdb_key = ['NEW-KEY', 1794899999];
  await cloud.put(doc);
  puts = cloud.puts;
  await rounds([A, B], 2);
  check(A.taken.tmdb_key === 'NEW-KEY' && B.taken.tmdb_key === 'NEW-KEY' && cloud.puts === puts, 'a setting changed on Kodi is read here; nothing is written back');
  check(SD.canon(WS.reads({'plugin.video.nova': {tmdb_key: ['K', 0], content_lang: [2, 5], tmdb_token: 'junk', debug: ['true', 1]}})) === '{"tmdb_key":"K"}', 'only well-formed, readable settings are taken');
  for (const k of ['debug', 'port', 'sub_server', 'wizard_shown', 'kodion.http.port', 'last_sync', 'intro_done', 'x_ts']) check(WS.LOCAL.test(k), 'device-only setting: ' + k);
  for (const k of ['tmdb_key', 'rd_token', 'content_lang', 'tmdb_token']) check(!WS.LOCAL.test(k), 'synced setting: ' + k);
  check(WS.caption(WS.NOTE) === '#TeleNovaSetup {"build": "", "device": "sync-v2", "fp": "", "name": "TeleNova sync", "v": 1}', 'the caption is the build\'s: ' + WS.caption(WS.NOTE));
  check(WS.noteOf('#TeleNovaSetup {"device": "sync-v2"}').device === 'sync-v2' && WS.noteOf('hello') === null && SD.canon(WS.noteOf('#TeleNovaSetup junk')) === '{}', 'captions are read like the build reads them');
  check(WS.mine([{id: 1, date: 5, note: {device: 'pc'}}, {id: 2, date: 7, note: {device: 'sync-v2'}}, {id: 3, date: 9, note: {device: 'sync-v2'}}]).id === 3, 'the newest file of the shared document is the one');

  for (const b of bad) console.log('FAIL', b);
  console.log(bad.length ? `WEB STORE / SYNC TESTS: ${bad.length} problems` : 'WEB STORE / SYNC TESTS OK');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.stack || e); process.exit(1); });
