'use strict';
// node src/qa/web/t_player.js - the playback package (web/player.js, sources.js, subs.js, srt.js, rd.js, tgplay.js):
//   1. the pure parts of player.js: resume points / watched marks, the key map (keyboard + TV remotes), seek steps,
//      links for other players, the error diagnosis
//   2. every text of the six files exists in he / en / ru with the same keys, no empty text, the same %s count
//   3. tgplay.js against a mocked service worker and part source: ranges, read-ahead cache, probe, status, events,
//      error texts, the download fallback with progress, "too big to download"
// No network, no browser. Ends with "t_player OK".
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const WEB = path.join(__dirname, '..', '..', '..', 'web');
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ------------------------------------------------------------ 1. player.js pure helpers
const P = require(path.join(WEB, 'player.js'));
eq([P.clock(0), P.clock(59), P.clock(61), P.clock(3600), P.clock(3725), P.clock(-5), P.clock(NaN)], ['0:00', '0:59', '1:01', '1:00:00', '1:02:05', '0:00', '0:00']);

// resume points: the shape app.js turns into the history entry's 'progress': {t, d}
let all = {};
P.nextResume(all, 'movie:603', 10, 7200, 1000);
eq(all, {}, 'the first 30 s leave no point');
P.nextResume(all, 'movie:603', 1500.4, 7200.2, 2000);
eq(all['movie:603'], {t: 1500, d: 7200, at: 2000});
eq(P.resumePoint(all, 'movie:603').t, 1500);
eq(P.isWatched(all, 'movie:603'), false);
P.nextResume(all, 'movie:603', 7000, 7200, 3000);
eq(all['movie:603'], {t: 7200, d: 7200, at: 3000}, 'watched to 95 %: a finished point stays (the watched mark other devices see)');
eq(P.resumePoint(all, 'movie:603'), null, 'a watched film starts over');
eq(P.isWatched(all, 'movie:603'), true);
P.nextResume(all, 'movie:603', 5, 7200, 4000);
eq(all['movie:603'].t, 7200, 'the first seconds of a new viewing do not wipe the mark');
P.nextResume(all, '', 500, 900, 1);
eq(Object.keys(all), ['movie:603'], 'no key, no point');
P.nextResume(all, 'live', 500, Infinity, 5);
eq(all.live, {t: 500, d: 0, at: 5}, 'an unknown length is 0');
eq(P.resumePoint(all, 'live').t, 500);
const many = {};
for (let i = 0; i < 320; i++) P.nextResume(many, 'k' + i, 100, 1000, i);
eq([Object.keys(many).length, 'k0' in many, 'k319' in many], [300, false, true], 'the 300 newest points are kept');
eq(P.resumePoint({a: {t: 20, d: 100}}, 'a'), null);
eq(P.resumePoint(null, 'a'), null);

// seeking: holding the key speeds up
eq([0, 4, 5, 11, 12, 23, 24, 99].map(P.seekStep), [10, 10, 20, 20, 30, 30, 60, 60]);
eq([P.stepSpeed(1, 1), P.stepSpeed(2, 1), P.stepSpeed(0.5, -1), P.stepSpeed(1.3, 1), P.stepSpeed(1, -1)], [1.25, 2, 0.5, 1.25, 0.75]);

// what is a stream, what can another player open
eq([P.isHlsUrl('https://a/b.m3u8'), P.isHlsUrl('https://a/b.m3u8?x=1'), P.isHlsUrl('https://a/b.mp4'), P.isHlsUrl('https://a/x', 'application/vnd.apple.mpegurl')], [true, true, false, true]);
eq([P.linkKind('https://h/a.mkv'), P.linkKind('blob:https://h/1'), P.linkKind('https://site/web/tgstream/0123456789abcdef01234567'), P.linkKind(''), P.linkKind('javascript:1')],
  ['http', 'blob', 'tg', '', '']);
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/120 Mobile', DESK = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120';
eq(P.vlcLink('https://h/a.mkv', DESK), 'vlc://https://h/a.mkv');
eq(P.vlcLink('https://h/a.mkv?x=1', ANDROID), 'intent://h/a.mkv?x=1#Intent;scheme=https;type=video/*;package=org.videolan.vlc;end');
eq(P.kodiLink('https://h/a.mkv', ANDROID), 'intent://h/a.mkv#Intent;scheme=https;type=video/*;package=org.xbmc.kodi;end');
eq([P.kodiLink('https://h/a.mkv', DESK), P.vlcLink('blob:x', DESK), P.vlcLink('https://s/tgstream/0123456789abcdef', DESK)], ['', '', ''],
  'no link is offered for an address only this page can read');
eq(P.m3uText('https://h/a.mkv', 'Film\n1'), '#EXTM3U\n#EXTINF:-1,Film 1\nhttps://h/a.mkv\n');
ok(P.shiftVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nx', 1.5).includes('00:00:02.500 --> 00:00:04.000'));

// errors
eq(P.errorKind({code: 4, probe: {ok: false}}), {kind: 'dead', why: ''});
eq(P.errorKind({code: 4, probe: {ok: true, verdict: {play: 'no', why: 'video'}}}), {kind: 'codec', why: 'video'});
eq(P.errorKind({code: 4, probe: {ok: true, verdict: {play: 'yes', why: ''}}}), {kind: 'codec', why: ''});
eq(P.errorKind({code: 4, probe: {ok: null}}), {kind: 'unknown', why: ''});
eq(P.errorKind({code: 2}), {kind: 'network', why: ''});
eq(P.errorKind({code: 3}), {kind: 'codec', why: ''});
eq(P.errorKind({hls: 'network'}), {kind: 'network', why: ''});
eq(P.errorKind({hls: 'media'}), {kind: 'codec', why: ''});
eq(P.errorKind(), {kind: 'unknown', why: ''});

// the key map
const K = (key, c, more) => P.keyAction(Object.assign({key}, more), c || {});
eq([K(' '), K('k'), K('K'), K('Enter'), K('MediaPlayPause')], ['toggle', 'toggle', 'toggle', 'toggle', 'toggle']);
eq([K('ArrowLeft'), K('ArrowRight'), K('j'), K('l'), K('MediaRewind'), K('MediaFastForward')], ['rew', 'fwd', 'rew', 'fwd', 'rew', 'fwd']);
eq([K('ArrowUp'), K('ArrowDown'), K('ArrowUp', {tv: true}), K('ArrowDown', {tv: true})], ['volUp', 'volDown', 'show', 'show']);
eq([K('f'), K('m'), K('c'), K('s'), K('a'), K('n'), K('p'), K('g'), K('h'), K('<'), K('>'), K('5'), K('Home'), K('End')],
  ['fullscreen', 'mute', 'subsToggle', 'subsPanel', 'audioPanel', 'next', 'pip', 'subEarlier', 'subLater', 'slower', 'faster', 'jump5', 'jump0', 'jumpEnd']);
eq([K('Escape'), K('BrowserBack'), K('GoBack'), K('Backspace'), K('Backspace', {tv: true})], ['back', 'back', 'back', '', 'back']);
// a focused button keeps its own Enter / Space; the arrows move between the controls
eq([K('Enter', {ctl: true}), K(' ', {ctl: true}), K('ArrowLeft', {ctl: true}), K('ArrowDown', {ctl: true}), K('f', {ctl: true})], ['', '', 'focusLeft', 'focusDown', 'fullscreen']);
// on the seek bar Left / Right seek, Up / Down leave it
eq([K('ArrowLeft', {seek: true}), K('ArrowUp', {seek: true}), K('ArrowDown', {seek: true}), K('Enter', {seek: true})], ['rew', 'focusUp', 'focusDown', 'toggle']);
// an open menu takes the arrows and Enter, letters do nothing there
eq([K('ArrowDown', {panel: true}), K('ArrowLeft', {panel: true}), K('Enter', {panel: true}), K(' ', {panel: true}), K('f', {panel: true}), K('Escape', {panel: true})],
  ['panelDown', 'panelLeft', '', '', '', 'back']);
eq([K('ArrowRight', {card: true}), K('Enter', {card: true})], ['focusRight', '']);
// typing in a field (the OpenSubtitles key, the server address): only Escape is the player's
eq([K('k', {typing: true}), K(' ', {typing: true}), K('ArrowLeft', {typing: true}), K('Backspace', {typing: true, tv: true}), K('Escape', {typing: true})], ['', '', '', '', 'back']);
// shortcuts of the browser are not taken
eq([K('f', {}, {ctrlKey: true}), K('ArrowLeft', {}, {altKey: true}), K('k', {}, {metaKey: true})], ['', '', '']);
// a Hebrew / Russian keyboard layout: the letter by its place on the keyboard
eq([K('ל', {}, {code: 'KeyK'}), K('а', {}, {code: 'KeyF'}), K('צ', {}, {code: 'KeyM'})], ['toggle', 'fullscreen', 'mute']);
// TV remotes: key codes (Tizen 10009 / webOS 461 back, 415 play, 19 pause, 413 stop, 417 / 412 wind) and old key names
const KC = (keyCode, c, key) => P.keyAction({key: key === undefined ? 'Unidentified' : key, keyCode}, c || {tv: true});
eq([KC(10009), KC(461), KC(415), KC(19), KC(413), KC(417), KC(412), KC(10252), KC(10233)], ['back', 'back', 'play', 'pause', 'stop', 'fwd', 'rew', 'toggle', 'next']);
eq([KC(37, {tv: true}, ''), KC(39, {tv: true}, ''), KC(13, {tv: true}, ''), KC(38, {tv: true}, ''), KC(8, {tv: true}, '')], ['rew', 'fwd', 'toggle', 'show', 'back']);
eq([K('Left'), K('Right'), K('Esc'), K('Spacebar')], ['rew', 'fwd', 'back', 'toggle']);
eq(K('1', {}, {keyCode: 49}), 'jump1', 'a digit is a digit, whatever its key code');
eq([P.keyAction(null), K('Tab'), K('Shift'), K('x')], ['', '', '', '']);

// ------------------------------------------------------------ 2. texts: he / en / ru, the same keys
function loadWith(file, extra) {
  const tables = [], providers = {};
  const noop = () => {};
  const TN = {
    i18n: {add: (t) => tables.push(t)}, t: (k, ...a) => k + (a.length ? ':' + a.join(',') : ''), esc: (s) => String(s), lang: () => 'he', rtl: () => true,
    get: (k, d) => (k in store ? store[k] : d), put: (k, v) => { store[k] = v; }, drop: (k) => { delete store[k]; },
    settings: {get: (k, d) => d, set: noop, synced: () => ({}), helper: () => ''},
    registerProvider: (name, impl) => { providers[name] = impl; }, addTitleAction: noop, addHistoryHandler: noop, on: noop, emit: noop,
    provider: async () => null, providers: async () => [], providerOn: () => true, loadScript: async () => {}, load: async () => {},
    httpsOnly: (u) => u, stopRadio: noop, version: 'test',
  };
  const store = {};
  const sandbox = Object.assign({TN, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob, TextDecoder, TextEncoder, Uint8Array, Promise,
    navigator: {userAgent: 'node Chrome/120'}, location: {href: 'https://site.example/web/#/x'}, history: {state: null},
    crypto: require('crypto').webcrypto, addEventListener: noop, innerWidth: 1200, innerHeight: 800,
    document: {documentElement: {classList: {contains: () => false}, getAttribute: () => ''}, getElementById: () => null, createElement: () => ({canPlayType: () => ''})}}, extra || {});
  sandbox.self = sandbox; sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(WEB, file), 'utf8'), sandbox, {filename: file});
  return {tables, providers, TN, store, sandbox};
}
let texts = 0;
const loaded = {};
for (const file of ['player.js', 'sources.js', 'subs.js', 'rd.js', 'tgplay.js']) {
  const L = loaded[file] = loadWith(file);
  ok(L.tables.length >= 1, file + ' adds its texts');
  for (const tb of L.tables) {
    eq(Object.keys(tb).sort(), ['en', 'he', 'ru'], file + ': the three languages');
    const want = Object.keys(tb.en).sort();
    for (const l of ['he', 'ru']) {
      const have = Object.keys(tb[l]).sort();
      eq(have.filter((k) => !want.includes(k)).concat(want.filter((k) => !have.includes(k))), [], file + ': ' + l + ' has the keys of en');
    }
    for (const k of want) {
      const count = (s) => (String(s).match(/%s/g) || []).length;
      for (const l of ['he', 'en', 'ru']) { assert.ok(typeof tb[l][k] === 'string' && tb[l][k].trim(), `${file}: ${l}.${k} is empty`); texts++; }
      assert.strictEqual(count(tb.he[k]), count(tb.en[k]), `${file}: ${k} has another number of %s in he`);
      assert.strictEqual(count(tb.ru[k]), count(tb.en[k]), `${file}: ${k} has another number of %s in ru`);
    }
  }
  // every text the file asks for by a literal key exists in its own table (or is another module's: checked below)
  const src = fs.readFileSync(path.join(WEB, file), 'utf8');
  const own = new Set([].concat(...L.tables.map((tb) => Object.keys(tb.en))));
  const prefix = {'player.js': 'pl_', 'sources.js': 'src_', 'subs.js': 'subs_', 'rd.js': 'rd_', 'tgplay.js': 'tgplay_'}[file];
  for (const m of src.matchAll(/[^\w.]t\('([a-z0-9_]+)'/g)) if (m[1].startsWith(prefix)) assert.ok(own.has(m[1]), `${file} asks for the text ${m[1]}, which does not exist`);
  for (const m of src.matchAll(/TN\.t\('([a-z0-9_]+)'/g)) if (m[1].startsWith(prefix)) assert.ok(own.has(m[1]), `${file} asks for the text ${m[1]}, which does not exist`);
  n++;
}
// the services the files register, with what the other packages call
const PL = loaded['player.js'].providers.player;
ok(PL && typeof PL.open === 'function' && typeof PL.close === 'function' && typeof PL.resumeOf === 'function' && typeof PL.watched === 'function');
ok(loaded['rd.js'].providers.rd && typeof loaded['rd.js'].providers.rd.settingsPanel === 'function' && typeof loaded['rd.js'].providers.rd.servicesPanel === 'function', 'rd: a panel services.js can call');
ok(typeof loaded['sources.js'].providers.sources.servicesPanel === 'function');
const SB = loaded['subs.js'].providers.subs;
ok(SB && typeof SB.settingsPanel === 'function' && typeof SB.auto === 'function' && typeof SB.embedded === 'function' && typeof SB.fromFile === 'function');
for (const p of ['wizdom', 'opensubs', 'yify', 'ktuvit', 'subsrv', 'subs_ai']) ok(loaded['subs.js'].providers[p], 'subs provider ' + p);
// the resume point the player writes is what store / syncdoc carry as 'progress'
{
  const L = loaded['player.js'];
  L.providers.player.saveResume('tv:1399:1:2', 1234.6, 3300);
  const pts = L.store.player_resume;
  eq([pts['tv:1399:1:2'].t, pts['tv:1399:1:2'].d, typeof pts['tv:1399:1:2'].at], [1235, 3300, 'number']);
  const SD = require(path.join(WEB, 'syncdoc.js'));
  const hist = [{key: 'tv:1399:1:2', label: 'x', ts: 1}];
  const withP = (SD.with_progress || SD.SyncDoc.with_progress)(hist, pts);
  eq(withP[0].progress, {t: 1235, d: 3300}, 'syncdoc.with_progress takes the player\'s point as it is');
  eq(L.providers.player.resumeOf('tv:1399:1:2').t, 1235);
  L.providers.player.saveResume('tv:1399:1:2', 3290, 3300);
  eq([L.providers.player.resumeOf('tv:1399:1:2'), L.providers.player.watched('tv:1399:1:2')], [null, true]);
}

// ------------------------------------------------------------ 3. tgplay.js with a mocked service worker
(async () => {
  let swListener = null;
  const made = [];
  const T = loadWith('tgplay.js', {
    navigator: {userAgent: 'Mozilla/5.0 Chrome/120', serviceWorker: {controller: {}, addEventListener: (type, fn) => { if (type === 'message') swListener = fn; }}},
    isSecureContext: true,
    document: {createElement: (tag) => { const e = {tag, style: {}, click() { e.clicked = true; }, remove() {}, canPlayType: (m) => (/mp4/.test(m) ? 'probably' : '')}; made.push(e); return e; },
      body: {append() {}}, documentElement: {classList: {contains: () => false}, getAttribute: () => ''}, getElementById: () => null},
  });
  const tp = T.providers.tgplay;
  ok(swListener, 'tgplay listens to the service worker');
  const PART = tp.PART;
  eq(PART, 512 * 1024);
  const SIZE = PART * 3 + 1000;
  const byteAt = (i) => (i * 7 + (i >> 9)) & 255;
  const reads = [];
  const src = {size: SIZE, mime: 'video/x-matroska', name: 'Film.2020.1080p.mkv', readPart: async (i, size) => {
    reads.push(i);
    const from = i * size, len = Math.max(0, Math.min(size, SIZE - from));
    const b = new Uint8Array(len);
    for (let k = 0; k < len; k++) b[k] = byteAt(from + k);
    return b;
  }};
  const events = [];
  const h = await tp.openSource(src, {onEvent: (e) => events.push(e)});
  ok(/\/tgstream\/[0-9a-f]{24}$/.test(h.url) && !/Film|mkv/.test(h.url), 'the address is a random key: no file name, chat or message in it');
  eq([h.size, h.mime, h.name], [SIZE, 'video/x-matroska', 'Film.2020.1080p.mkv']);
  const ask = (msg) => new Promise((res) => swListener({data: msg, ports: [{postMessage: (m) => res(m)}]}));
  const info = await ask({tgplay: 'info', key: h.key});
  eq([info.known, info.ok, info.size, info.mime], [true, true, SIZE, 'video/webm'], 'Matroska is answered as video/webm for Chromium');
  eq((await ask({tgplay: 'info', key: 'nope'})).known, false);
  const got = await ask({tgplay: 'read', key: h.key, start: PART - 10, end: PART + 9});
  const bytes = new Uint8Array(got.bytes);
  eq(bytes.length, 20);
  eq(Array.from(bytes), Array.from({length: 20}, (x, k) => byteAt(PART - 10 + k)), 'a range across two parts is exact');
  const tail = new Uint8Array((await ask({tgplay: 'read', key: h.key, start: SIZE - 5, end: SIZE + 100})).bytes);
  eq(Array.from(tail), Array.from({length: 5}, (x, k) => byteAt(SIZE - 5 + k)), 'the end of the file is clamped');
  await new Promise((r) => setTimeout(r, 20));
  const before = reads.length;
  await ask({tgplay: 'read', key: h.key, start: 0, end: 99});
  eq(reads.length, before, 'a part that was read is served from the cache');
  const st = tp.status(h.key);
  ok(st.size === SIZE && st.read >= SIZE && st.cached === 4 && st.lastError === '' && st.wait === 0, 'status: bytes read, parts cached');
  ok(events.some((e) => e.type === 'read' && e.bytes > 0), 'read events reach the page');
  eq(tp.status('nope'), null);
  // the link test
  const pr = await tp.probe({key: h.key});
  eq([pr.head.length, pr.size, pr.mime, pr.name, pr.head[5]], [262144, SIZE, 'video/x-matroska', 'Film.2020.1080p.mkv', byteAt(5)]);
  ok(pr.mbit > 0);
  // a failing source: the error reaches the service worker as "not ok" and the page as an event with a text
  const bad = await tp.openSource({size: PART, mime: 'video/mp4', readPart: async () => { const e = new Error('x'); e.errorMessage = 'CHANNEL_PRIVATE'; throw e; }}, {onEvent: (e) => events.push(e)});
  const fail = await ask({tgplay: 'read', key: bad.key, start: 0, end: 10});
  eq([fail.known, fail.ok, fail.status], [true, false, 502]);
  const ev = events.find((e) => e.type === 'error');
  eq([ev.code, ev.text], ['CHANNEL_PRIVATE', 'tgplay_private']);
  eq(tp.status(bad.key).lastError, 'CHANNEL_PRIVATE');
  // error texts: one per case, never the raw text of an address
  eq([{code: 'TGPLAY_NO_SW'}, {code: 'TGPLAY_NO_FILE'}, {code: 'TG_NO_LOGIN'}, {code: 'TG_OTHER_TAB'}, {code: 'TG_OFFLINE'}, {errorMessage: 'FLOOD_WAIT_30', seconds: 30},
    {errorMessage: 'CHANNEL_PRIVATE'}, {message: 'Could not find the input entity for X'}, {message: 'TIMEOUT'}].map(tp.errorText),
  ['tgplay_nosw', 'tgplay_nofile', 'tgplay_login', 'tgplay_other_tab', 'tgplay_offline', 'tgplay_flood:30', 'tgplay_private', 'tgplay_private', 'tgplay_timeout']);
  ok(!/https?:|secret/.test(tp.errorText({message: 'failed https://host/path/secret-token now'})), 'an address never gets into an error text');
  // closing forgets the stream
  tp.close(bad.key);
  eq((await ask({tgplay: 'info', key: bad.key})).known, false);
  // the download fallback (no service worker): the whole file, with progress
  const prog = [];
  const f = await tp.fallback({key: h.key}, {onProgress: (p) => prog.push(p)});
  eq(f.kind, 'blob');
  ok(/^blob:/.test(f.url) && prog[prog.length - 1] === 100 && prog.every((p, i) => !i || p >= prog[i - 1]), 'progress rises to 100');
  f.revoke();
  // stop in the middle
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(tp.fallback({key: h.key}, {signal: ctl.signal}), (e) => e.code === 'TGPLAY_STOPPED'); n++;
  // save to the device where the browser cannot write big files itself: a normal download under 300 MB ...
  made.length = 0;
  const sv = await tp.save({key: h.key}, {});
  const a = made.find((e) => e.tag === 'a');
  eq([sv.saved, sv.name, a.clicked, a.download], [true, 'Film.2020.1080p.mkv', true, 'Film.2020.1080p.mkv']);
  // ... and a clear "too big" above it (the player then offers Telegram itself)
  const huge = await tp.openSource({size: tp.BLOB_MAX + 1, mime: 'video/mp4', name: 'big.mp4', readPart: async () => new Uint8Array(1)});
  await assert.rejects(tp.save({key: huge.key}, {}), (e) => e.code === 'TGPLAY_TOO_BIG' && e.size === tp.BLOB_MAX + 1); n++;
  eq((await tp.fallback({key: huge.key})).kind, 'link');
  eq([tp.tgLink('@some_channel', 5), tp.tgLink('-1001234567', 9), tp.tgLink('x', 0)], ['https://t.me/some_channel/5', 'https://t.me/c/1234567/9', '']);
  tp.closeAll();
  eq(tp.stats().streams, 0);

  console.log('t_player OK (' + n + ' checks, ' + texts + ' texts in he / en / ru)');
})().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1); });
