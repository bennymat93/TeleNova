'use strict';
// 6.2.0: web/twins.js and the settings side of web/websync.js (a browser as a full sync peer): every twin and codec
// round trip, the join rule (stamp 0 = a fresh browser never writes over the account), newer account values applied,
// local changes sent under the build's ids (mirrors with the same stamp), section "web", device-only keys and the
// Telegram session never in the document. Node only, no network:  node src/qa/web/t_twins.js
const path = require('path');
const WEB = path.join(__dirname, '..', '..', '..', 'web');
const SD = require(path.join(WEB, 'syncdoc.js'));
const TW = require(path.join(WEB, 'twins.js'));
const WS = require(path.join(WEB, 'websync.js')).make(SD);
const B = require(path.join(WEB, 'backup.js'));
let fails = 0, n = 0;
const ok = (c, what) => { n++; if (!c) { fails++; console.log('FAIL ' + what); } };
const eq = (a, b, what) => ok(SD.canon(a) === SD.canon(b), what + ': ' + SD.canon(a) + ' != ' + SD.canon(b));
const NOVA = TW.NOVA, TELE = TW.TELE;

// ---- the table
eq(B.TWINS, [['tmdb', 'tmdb_key', 's'], ['gemini_key', 'gemini_key', 's'], ['subs_os_key', 'os_key', 's'], ['stremthru_url', 'st_url', 's'],
  ['stremthru_on', 'st_enabled', 'b'], ['telegram_quiet', 'tg_quiet', 'b'], ['tgsearch_bots', 'bot_request', 'b']], 'the .tncfg list is unchanged');
for (const r of TW.TWINS) {
  ok(r.length === 5 && TW.CODECS[r[3]] || r[3] === 'iptv', 'row shape ' + r.join('|'));
  ok(!TW.SESSION_RX.test(r[0]) && !TW.SESSION_RX.test(r[2]), 'no session in the table ' + r[0]);
  ok(!TW.isLocal(r[0]) && !TW.isLocal(r[2]), 'no device-only key in the table ' + r[0]);
}
for (const k of ['tg_session', 'bn_tg_session', 'auth_key', 'string_session', 'session']) ok(TW.SESSION_RX.test(k) && TW.isLocal(k), 'session is excluded: ' + k);
for (const k of ['device', 'zoom', 'theme', 'helper_token', 'player_resume', 'subs_offsets', 'tn_gd', 'tn_gd_state', 'art', 'rd_dead', 'user']) ok(TW.isLocal(k), 'device-only: ' + k);

// ---- codecs
const C = TW.CODECS;
eq([C.b.enc(true), C.b.enc(false), C.b.enc('x'), C.b.dec('true'), C.b.dec('false'), C.b.dec('maybe')], ['true', 'false', undefined, true, false, undefined], 'switch');
eq([C.s.enc(' k '), C.s.dec(5), C.s.dec({}), C.s.enc(null)], ['k', '5', undefined, undefined], 'text');
eq(C.nl.dec(C.nl.enc(['https://a.b/x', 'https://c.d/y'])), ['https://a.b/x', 'https://c.d/y'], 'list <-> newline');
eq(C.nl.dec('https://a.b/x,javascript:alert(1)\nhttp://x.y'), ['https://a.b/x', 'http://x.y'], 'stremio list: http(s) only (6.2.0: http too)');
const pins = [{id: '-100123', title: 'A', username: ''}, {id: '-100456', title: 'B', username: 'Chan_B'}];
eq(C.pins.enc(pins), '-100123,chan_b', 'pins -> comma text as the engine parses it');
eq(C.pins.dec('-100123,chan_b,-100789,unknownname', pins), pins.concat([{id: '-100789', title: '', username: ''}]), 'comma text -> pins (known kept, new ids added)');
const bots = {cfg: {abot: {state: 'on', username: 'ABot'}, bbot: {state: 'off'}, cbot: {state: 'on'}}, stats: {abot: {asked: 3}}};
eq(C.bots.enc(bots), 'abot,cbot', 'bots switched on -> comma text');
eq(C.bots.dec('@ABot, dbot', bots), {cfg: {bbot: {state: 'off'}, abot: {state: 'on', username: 'ABot'}, dbot: {username: 'dbot', state: 'on'}}, stats: {abot: {asked: 3}}}, 'comma text -> bots (off kept, stats kept)');
const kodiIptv = {m3u: [{name: 'K', url: 'https://k.tv/a.m3u', ua: 'X'}], epg: ['https://k.tv/e.xml'], free: {il: true}};
const p = TW.IPTV.fromDoc(kodiIptv);
eq(p, {m3u: [{name: 'K', url: 'https://k.tv/a.m3u'}], epg: ['https://k.tv/e.xml']}, 'iptv.json -> projection');
eq(TW.IPTV.toDoc({m3u: p.m3u.concat([{name: 'W', url: 'https://w.tv/b.m3u'}]), epg: []}, kodiIptv),
  {m3u: [{name: 'K', url: 'https://k.tv/a.m3u', ua: 'X'}, {name: 'W', url: 'https://w.tv/b.m3u'}], epg: [], free: {il: true}}, 'projection -> iptv.json keeps unknown Kodi fields');
eq(TW.IPTV.toWeb(p, [{name: 'file', rows: [['a', 'b']]}, {name: 'old', url: 'https://o.tv'}]).own, [{name: 'file', rows: [['a', 'b']]}, {name: 'K', url: 'https://k.tv/a.m3u'}], 'iptv: a list made from a file stays on this browser');
// 6.2.0 regressions: what the browser cannot hold is never erased from the account
{
  const big = {m3u: [], epg: [], x: 1};
  for (let i = 0; i < 10; i++) big.m3u.push({name: 'L' + i, url: 'https://l.tv/' + i});
  big.m3u.push({name: 'local', url: 'file:///k.m3u'});
  for (let i = 0; i < 22; i++) big.epg.push('https://e.tv/' + i);
  const w = TW.IPTV.toWeb(TW.IPTV.fromDoc(big), []);
  const pw = TW.IPTV.fromWeb(w.own.filter((x) => x.url !== 'https://l.tv/1'), w.epg.filter((u) => u !== 'https://e.tv/0'));
  const nd = TW.IPTV.toDoc(pw, big);
  eq(nd.m3u.map((x) => x.url), ['https://l.tv/0'].concat([2, 3, 4, 5, 6, 7, 8, 9].map((i) => 'https://l.tv/' + i), ['file:///k.m3u']), 'iptv: overflow + non-http lists kept, removed one dropped');
  ok(nd.epg.length === 21 && !nd.epg.includes('https://e.tv/0') && nd.epg.includes('https://e.tv/21') && nd.x === 1, 'iptv: guides past the cap kept, removed one dropped');
  const kp = [{id: '-100123', title: 'A', username: ''}];
  eq(C.pins.enc(kp, '-100123,kodiname', C.pins.dec('-100123,kodiname', kp)), '-100123,kodiname', 'pins: a Kodi name this browser cannot match is kept');
  const kp2 = kp.concat([{id: '-100456', title: 'B', username: 'chan_b'}]);
  eq(C.pins.enc(kp, '-100123,chan_b,kodiname', kp2), '-100123,kodiname', 'pins: a name removed here is dropped, the unknown one kept');
  eq(C.pins.enc([], '-100123', kp), '', 'pins: an id removed here is dropped');
  eq(C.nl.dec('http://a.b/x, https://c.d/y\nftp://z,magnet:q'), ['http://a.b/x', 'https://c.d/y'], 'stremio list: http and https, newline and comma');
  eq(C.nl.dec(Array.from({length: 15}, (_, i) => 'https://s/' + i).join('\n')).length, 15, 'stremio list: no cap in dec');
  eq(C.nl.enc(['https://c.d/y'], 'https://a.b/x\nplugin://x.y'), 'https://c.d/y\nplugin://x.y', 'stremio list: entries the browser cannot use are kept');
}

// ---- the loop with a settings port
function browser(cfg, stores) {
  const st = Object.assign({}, stores);
  let meta = {};
  const self = {
    cfg: Object.assign({}, cfg), st, taken: null, sent: null, doc: null, n: 0,
    port: {cfgKeys: () => Object.keys(self.cfg), cfgGet: (k) => self.cfg[k], cfgSet: (k, v) => { self.cfg[k] = v; },
           get: (k) => st[k], put: (k, v) => { st[k] = JSON.parse(JSON.stringify(v)); }, drop: (k) => { delete st[k]; }},
    loadMeta: () => JSON.parse(JSON.stringify(meta)), saveMeta: (m) => { meta = JSON.parse(JSON.stringify(m)); }, meta: () => meta,
    users: () => [{id: 'u1', name: '', created: 1, renamed: 0, deleted: 0}], userData: () => SD.merge_user_data({}, {}),
    setUsers: () => false, putUserData: () => false, takeSettings(v) { self.taken = v; },
    cloudFind: async () => (self.doc ? {id: 1 + self.n, date: 100 + self.n} : null),
    cloudGet: async () => SD.parse(SD.canon(self.doc)),
    cloudPut: async (d) => { self.n++; self.doc = SD.parse(SD.canon(d)); self.sent = self.doc; return (1 + self.n) + ':' + (100 + self.n); },
  };
  return self;
}
const S = (d, a, k) => SD.get(SD.get(d.settings, a) || {}, k);
const account = () => ({v: 2, users: [{id: 'u1', name: '', created: 1, renamed: 0, deleted: 0}], data: {},
  settings: {[NOVA]: {tmdb_key: ['ACCT-TMDB', 50], gemini_key: ['G0', 40], content_lang: ['1', 10], device_profile: ['tv64', 5]},
             [TELE]: {gemini_key: ['ACCT-G', 60], rd_token: ['', 70], bots: ['abot', 30], api_id: ['12345', 1], api_hash: ['0123456789abcdef0123456789abcdef', 1],
                      rd_client_id: ['CID', 20], rd_client_secret: ['SEC', 20], rd_refresh: ['REF', 20], chiko_keywords: ['x', 3]}},
  files: {'iptv.json': [kodiIptv, 80]}});

(async () => {
  // 1. a fresh browser joins: the account's newer values are applied, its own untouched ones never overwrite them
  const b = browser({gemini_key: 'LOCAL-G', zoom: 1.2, subs_size: 30, tg_session: 'SECRET-SESSION'},
                    {rd_token: 'LOCALRD123', tg_session: 'SECRET-SESSION', iptv_own: [{name: 'mine', url: 'https://m.tv/x.m3u'}]});
  b.doc = account();
  const r1 = await WS.cycle(b, 1000);
  eq(b.cfg.gemini_key, 'ACCT-G', 'join: the account\'s Gemini key (newer, telescope) is applied');
  eq(b.st.rd_auth, {cid: 'CID', sec: 'SEC', refresh: 'REF', exp: 1}, 'join: the Real-Debrid client bundle from three Kodi ids');
  eq(b.st.tg_api, {id: '12345', hash: '0123456789abcdef0123456789abcdef'}, 'join: the Telegram app id when this browser has none');
  ok(!b.st.rd_token, '6.2.0 join: a token the account cleared (stamp > 0) is cleared here too');
  eq(S(b.sent, TELE, 'rd_token'), ['', 70], '6.2.0: an account value cleared on purpose (stamp > 0) is not overwritten by the join');
  eq(b.st.iptv_own.map((x) => x.url), ['https://k.tv/a.m3u'], 'join: the account\'s iptv.json (newer) is applied');
  eq(b.st.epg_own, ['https://k.tv/e.xml'], 'join: the account\'s guides');
  eq(S(b.sent, 'web', 'subs_size'), [30, 0], 'section web: a setting with no Kodi twin travels, untouched = 0');
  ok(S(b.sent, 'web', 'zoom') === undefined, 'section web: device-only keys never travel');
  ok(!/SECRET-SESSION|session|auth_key/i.test(SD.canon(b.sent)), 'the Telegram session never enters the document');
  eq(S(b.sent, NOVA, 'device_profile'), ['tv64', 5], 'Kodi settings this browser does not know pass through');
  eq(b.taken.chiko_keywords, 'x', 'synced map: every readable setting of the account (dead reads fixed)');
  ok(!('rd_client_secret' in b.taken) && !('api_hash' in b.taken) && b.taken.tmdb_key === 'ACCT-TMDB', 'synced map: no sign-in secrets');
  ok(r1.pushed && r1.settings.includes('gemini_key'), 'the round reports what it applied');
  eq((await WS.cycle(b, 1010)).state, 'idle', 'then nothing to do');

  // 2. a change here: sent under the build's ids, mirrors with the same stamp
  b.cfg.gemini_key = 'NEW-G';
  b.cfg.telegram_quiet = true;
  const r2 = await WS.cycle(b, 2000);
  ok(r2.pushed, 'a local change is sent');
  eq([S(b.sent, TELE, 'gemini_key'), S(b.sent, NOVA, 'gemini_key')], [['NEW-G', 2000], ['NEW-G', 2000]], 'mirrored keys: both, same stamp');
  eq(S(b.sent, TELE, 'tg_quiet'), ['true', 2000], 'a switch as Kodi writes it');
  ok(S(b.sent, NOVA, 'opensubs_key') === undefined, 'a mirror the account does not have is not created');
  eq((await WS.cycle(b, 2010)).state, 'idle', 'idle after sending');

  // 3. Kodi changes a value later: applied here, never sent back changed
  b.doc.settings[TELE].gemini_key = ['KODI-G', 3000];
  b.doc.settings[TELE].bots = ['abot,bbot', 3000];
  b.doc.settings[TELE].tg_quiet = ['maybe', 3001];
  b.n++;
  const r3 = await WS.cycle(b, 3100);
  eq(b.cfg.gemini_key, 'KODI-G', 'a newer Kodi value is applied');
  eq(Object.keys(b.st.tg_bots.cfg).sort(), ['abot', 'bbot'], 'Kodi bots applied');
  eq(b.cfg.telegram_quiet, true, 'a value of the wrong type is never applied');
  // 6.3.0: the account's bots were changed by a writer that does not keep the keyed list: this browser records them item
  // by item (one write), and sends no value of its own back
  ok(!r3.pushed || (SD.canon(S(b.sent, TELE, 'bots')) === SD.canon(['abot,bbot', 3000]) && S(b.sent, TELE, 'gemini_key')[0] === 'KODI-G' &&
     SD.canon(Object.keys(b.sent.keyed.bots).sort()) === '["abot","bbot"]'), 'nothing of its own sent back');
  eq((await WS.cycle(b, 3200)).state, 'idle', '6.3.0: idle after that');

  // 4. a slow clock: a change here still wins over the account's newest stamp
  b.cfg.gemini_key = 'SLOW';
  await WS.cycle(b, 2900); // 6.2.0: slow but inside the 10-minute clamp
  ok(S(b.sent, TELE, 'gemini_key')[0] === 'SLOW' && S(b.sent, TELE, 'gemini_key')[1] > 3000, '6.2.0: stamp = max(now, min(key stamp, now+600) + 1)');

  // 5. a second fresh browser: section web reaches it, the join rule keeps its own untouched values at stamp 0
  const c = browser({subs_size: 40}, {});
  c.doc = b.doc;
  b.cfg.subs_color = 'yellow';
  await WS.cycle(b, 5000);
  c.doc = b.doc;
  await WS.cycle(c, 5100);
  eq([c.cfg.subs_color, c.cfg.subs_size], ['yellow', 40], 'section web: a value set elsewhere arrives; an untouched one stays (both 0)');
  eq(c.cfg.gemini_key, 'SLOW', 'the second browser gets the keys');
  ok(!/session/i.test(SD.canon(c.doc)), 'still no session');

  // 6. no port (the lists-only hosts of t_store.js): settings pass through untouched, as before
  const d = browser({gemini_key: 'X'}, {});
  d.port = null;
  d.doc = account();
  await WS.cycle(d, 6000);
  eq(d.taken, {content_lang: '1', tmdb_key: 'ACCT-TMDB'}, 'without a port: the three reads only');
  ok(d.cfg.gemini_key === 'X' && (!d.sent || SD.canon(d.sent.settings) === SD.canon(account().settings)), 'without a port: nothing written either way');

  // ---- 6.3.0
  // B1: a pin removed here is not merged back from the account (last = tokens this browser held)
  eq(C.pins.enc([{id: '1', title: '', username: 'a'}], 'a,b,kodionly', ['a', 'b']), 'a,kodionly', 'B1: last as tokens - removed here, unknown kept');
  {
    const p = browser({}, {tg_pins: [{id: '1', title: 'A', username: 'a'}, {id: '2', title: 'B', username: 'b'}]});
    p.doc = account();
    p.doc.settings[TELE].pinned_chats = ['a,b,kodionly', 90];
    await WS.cycle(p, 1000);
    eq(S(p.doc, TELE, 'pinned_chats')[0], 'a,b,kodionly', 'B1: joined, nothing changed');
    p.st.tg_pins = [{id: '1', title: 'A', username: 'a'}];
    await WS.cycle(p, 1100);
    eq(S(p.doc, TELE, 'pinned_chats')[0], 'a,kodionly', 'B1: a pin removed on the web leaves the account, the Kodi-only one stays');
    eq((await WS.cycle(p, 1200)).state, 'idle', 'B1: and stays idle');
  }
  // L1: the stamp of a change, the learned offset
  eq([WS.stampFor(1000, ['x', 500]), WS.stampFor(1000, ['x', 1500]), WS.stampFor(1000, ['x', 10 ** 9])], [1000, 1501, 1000 + 86401], 'L1: stampFor (a day ahead at most)');
  {
    const q = browser({gemini_key: 'Q'}, {});
    q.doc = account();
    let local = 1800000000 - 3600;                 // an hour slow
    q.clock = () => local;
    q.cloudPut = async (d) => { q.n++; q.doc = SD.parse(SD.canon(d)); q.sent = q.doc; return (1 + q.n) + ':' + 1800000000; };
    await WS.cycle(q, local);
    q.cfg.gemini_key = 'Q2';
    await WS.cycle(q, local);
    ok(Math.abs(q.meta().skew - 3600) < 1, 'L1: the browser learns its offset: ' + q.meta().skew);
    q.cfg.subs_size = 31;
    await WS.cycle(q, local);
    ok(Math.abs(S(q.sent, TW.WEB, 'subs_size')[1] - 1800000000) < 2, 'L1: then stamps on the server\'s clock');
  }
  // P1: the browser keeps the keyed lists - a Kodi pin added meanwhile survives a pin removed here
  {
    const k = browser({}, {tg_pins: [{id: '1', title: 'A', username: 'a'}, {id: '2', title: 'B', username: 'b'}]});
    k.doc = account();
    k.doc.devices = {kodi1: {sv: 3, at: 1, kind: 'kodi'}};
    k.doc.settings[TELE].pinned_chats = ['a,b', 90];
    await WS.cycle(k, 1000);
    eq(Object.keys(k.doc.keyed.pins).sort(), ['a', 'b'], 'P1: the keyed list seeded from the plain value');
    ok(Object.keys(k.doc.devices).length === 2, 'P1: the browser is listed among the devices');
    // Kodi (keyed-aware) adds c at 2000; this browser removes b at 1990 (its clock) - both must hold
    k.doc.keyed.pins.c = ['c', 2000];
    k.doc.settings[TELE].pinned_chats = ['a,b,c', 2000];
    k.n++;
    k.st.tg_pins = [{id: '1', title: 'A', username: 'a'}];
    await WS.cycle(k, 1990);
    eq(S(k.doc, TELE, 'pinned_chats')[0], 'a,c', 'P1: both changes survive: ' + S(k.doc, TELE, 'pinned_chats')[0]);
    eq(k.doc.keyed.pins.b[0], null, 'P1: the removal is an item of its own');
  }
  // P2: with the passphrase the keys travel sealed; without it the browser never puts its keys in plain text
  {
    const s1 = browser({gemini_key: 'SEALED-G'}, {});
    s1.doc = account();
    s1.passphrase = () => 'owner words';
    await WS.cycle(s1, 1000);
    s1.cfg.gemini_key = 'SEALED-G2';
    await WS.cycle(s1, 1100);
    const raw = SD.canon(s1.doc);
    ok(!raw.includes('SEALED-G2') && !raw.includes('ACCT-TMDB') && SD.get(s1.doc, 'secrets'), 'P2: no key in plain text, an envelope instead');
    const s2 = browser({}, {});
    s2.doc = s1.doc;
    s2.passphrase = () => 'owner words';
    await WS.cycle(s2, 1200);
    eq(s2.cfg.gemini_key, 'SEALED-G2', 'P2: another browser with the passphrase gets the key');
    const s3 = browser({gemini_key: 'MINE'}, {});
    s3.doc = s1.doc;
    const r = await WS.cycle(s3, 1300);
    ok(r.locked && s3.cfg.gemini_key === 'MINE' && !SD.canon(s3.doc).includes('"MINE"'), 'P2: without it: locked, its own key stays here');
  }
  // B3: a document of a later release is read only
  {
    const f = browser({gemini_key: 'F'}, {});
    f.doc = account();
    f.doc.v = 3;
    f.doc.future = {x: 1};
    const r = await WS.cycle(f, 1000);
    ok(r.state === 'update' && !r.pushed && f.n === 0, 'B3: a later version is never written over');
    f.doc.v = 2;
    await WS.cycle(f, 1100);
    eq(f.doc.future, {x: 1}, 'B3: an unknown part passes through a browser write');
  }

  console.log(fails ? 'TWINS FAILED ' + fails + ' of ' + n : 'TWINS OK ' + n + ' checks');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
