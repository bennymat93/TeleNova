'use strict';
// node t_compat.js - the plain-logic part of the fallback playback engine (web/compat.js). The engine itself
// (libmedia AVPlayer, WebAssembly decoders) needs a browser: it was checked by hand with MKV HEVC + AC3,
// MKV H.264 + DTS and AVI XviD + MP3 files made with ffmpeg (see src/HANDOFF.md).
const path = require('path'), fs = require('fs');
const WEB = path.join(__dirname, '..', '..', '..', 'web');
const C = require(path.join(WEB, 'compat.js'));
let n = 0, fails = 0;
function ok(c, m) { n++; if (!c) { fails++; console.log('FAIL', m); } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ')');

ok(C.toMs(1.5) === 1500n && C.toMs(-3) === 0n && C.toMs('x') === 0n && C.toMs(0.0004) === 0n, 'seconds -> engine milliseconds');
eq([C.fromMs(1500n), C.fromMs(0n), C.fromMs(undefined)], [1.5, 0, 0], 'engine milliseconds -> seconds');

// 6.1.1: the engine runs without its worker - inside it AC3 / E-AC3 / DTS decoders did not open (DDP5.1 releases stopped)
ok(/enableWorker:\s*false/.test(fs.readFileSync(path.join(WEB, 'compat.js'), 'utf8')), 'engine worker stays off (sound decoders)');

const tracks = [
  {mode: 'showing', cues: [{startTime: 1, endTime: 5, text: 'one'}, {startTime: 4, endTime: 8, text: 'two'}]},
  {mode: 'hidden', cues: [{startTime: 0, endTime: 100, text: 'hidden'}]},
  {mode: 'showing', cues: null}, null,
];
eq(C.activeCues(tracks, 0.5), [], 'before the first cue');
eq(C.activeCues(tracks, 4.5), ['one', 'two'], 'two cues at once; a hidden track shows nothing');
eq(C.activeCues(tracks, 5), ['two'], 'the end time is not part of the cue');
eq(C.activeCues(null, 1), [], 'no tracks');

eq(C.cueHtml('<i>a</i>\n<b>b</b>'), '<i>a</i><br><b>b</b>', 'italic / bold and line breaks are kept');
eq(C.cueHtml('<script>alert(1)</script>x'), 'alert(1)x', 'any other tag is dropped');
eq(C.cueHtml('<v Roger>Hi <c.yellow>there</c>'), 'Hi there', 'WebVTT voice and class tags are dropped');
eq(C.cueHtml('a & b < c "q"'), 'a &amp; b &lt; c &quot;q&quot;', 'text is escaped');
ok(!/<img|onerror/i.test(C.cueHtml('<img src=x onerror=alert(1)>')), 'no element can be injected through a cue');

const streams = [
  {id: 0, mediaType: 'Video', metadata: {}},
  {id: 1, mediaType: 'Audio', metadata: {language: 'heb'}},
  {id: 2, mediaType: 'Subtitle', metadata: {language: 'eng', title: 'English'}},
  {id: 3, mediaType: 'Subtitle', metadata: {language: 'heb'}},
  {id: 4, mediaType: 'Subtitle', metadata: {title: 'Russian (forced)'}},
  {id: 5, mediaType: 'Subtitle'},
];
eq(C.pickSubtitle(streams, ['he']), 3, 'Hebrew by its language code (an audio stream in Hebrew is not a subtitle)');
eq(C.pickSubtitle(streams, ['ru']), 4, 'Russian by its title');
eq(C.pickSubtitle(streams, ['fr', 'en']), 2, 'the first wanted language the file has');
eq(C.pickSubtitle(streams, ['fr']), -1, 'none');
eq(C.pickSubtitle(null, ['he']), -1, 'no streams');

// what the page needs for the engine to load at all
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const csp = (/Content-Security-Policy" content="([^"]+)"/.exec(html) || [])[1] || '';
const script = (/script-src ([^;]+)/.exec(csp) || [])[1] || '';
ok(/'wasm-unsafe-eval'/.test(script) && /\bblob:/.test(script), "the page's policy lets WebAssembly and the audio worklet run");
ok(!/'unsafe-inline'|'unsafe-eval'/.test(script), 'and still allows no inline script and no eval');
ok(/worker-src[^;]*blob:/.test(csp), 'workers from blob: (the decoders run off the main thread)');
const vendor = path.join(WEB, 'vendor', 'avplayer-1.3.1');
ok(fs.existsSync(path.join(vendor, 'avplayer.js')) && fs.existsSync(path.join(vendor, 'COPYING.LGPLv3')), 'the engine and its licence are in the repository');
ok(/vendor\/avplayer-1\.3\.1\/avplayer\.js/.test(fs.readFileSync(path.join(WEB, 'compat.js'), 'utf8')), 'compat.js loads that copy');
ok(/compat: \{pages: \[\], kinds: \['service'\]\}/.test(fs.readFileSync(path.join(WEB, 'app.js'), 'utf8')), 'the module table knows compat');
ok(/tryCompat\(/.test(fs.readFileSync(path.join(WEB, 'player.js'), 'utf8')), 'the player falls back to it');

console.log(fails ? 't_compat FAILED ' + fails + ' of ' + n : 't_compat OK (' + n + ' checks)');
process.exit(fails ? 1 : 0);
