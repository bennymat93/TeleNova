'use strict';
// node src/qa/web/t_playback.js - the playback package, second part (no network, no browser):
//   1. srt.js: ASS / SSA subtitles, repair, "which language is this text really in"
//   2. subs.js: the automatic subtitle flow of the build (a track inside the file first, then the best human
//      subtitle whose TEXT is in the wanted language, then AI), the offset remembered per video, the language choice,
//      the Library switch, a subtitle file from the device
//   3. sources.js: badges (quality / codec / HDR / audio / language / size), order, the same release once, filters,
//      the file-header check, YouTube rows (an id, never a file address, a running time is not a size)
// Ends with "t_playback OK".
const assert = require('assert');
const path = require('path');
const WEB = path.join(__dirname, '..', '..', '..', 'web');
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ------------------------------------------------------------ 1. srt.js
const T = require(path.join(WEB, 'srt.js'));
globalThis.TNSrt = T;
const ASS = '[Script Info]\nTitle: x\n\n[V4+ Styles]\nFormat: Name, Fontname\nStyle: Default,Arial\n\n[Events]\n' +
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
  'Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\an8}Hello, world\\Nsecond line\n' +
  'Comment: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,not shown\n' +
  'Dialogue: 0,0:01:02.05,0:01:04.00,Default,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}\n' +
  'Dialogue: 0,0:00:00.10,0:00:00.90,Default,,0,0,0,,<i>first</i>\\hnow\n';
const ass = T.parse(ASS);
eq(ass.map((c) => [c.start, c.end, c.text]), [[0.1, 0.9, '<i>first</i> now'], [1.5, 3, 'Hello, world\nsecond line']], 'ASS: commas in the text, \\N, overrides, drawings, order');
ok(T.toVtt(ASS).includes('00:00:01.500 --> 00:00:03.000\nHello, world\nsecond line'));
// another column order (SSA v4)
eq(T.parseAss('[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: Marked=0,0:00:05.00,0:00:06.00,D,,0,0,0,,Hi')[0], {start: 5, end: 6, text: 'Hi'});
eq(T.repair([{start: 1, end: 2, text: 'a'}, {start: 2, end: 3, text: 'a'}, {start: 5, end: 99, text: 'b'}, {start: 7, end: 7, text: 'c'}, {start: 8, end: 9, text: ' '}]),
  [{start: 1, end: 3, text: 'a'}, {start: 5, end: 25, text: 'b'}], 'repair: a repeated line is one cue, 20 s at most, empty and zero-length cues go');
const HE = 'שלום לכולם וברוכים הבאים לסרט', RU = 'Привет всем и добро пожаловать', EN = 'Hello everybody and welcome';
eq([T.scriptOf(HE), T.scriptOf(RU), T.scriptOf(EN), T.scriptOf('12 34'), T.scriptOf([{text: '<i>' + HE + '</i>'}])], ['he', 'ru', 'en', '', 'he']);
eq(T.pickFile([{name: 'a.nfo', bytes: new Uint8Array(9)}, {name: 'x.ass', bytes: new Uint8Array(5)}]).name, 'x.ass', '.ass inside a zip is a subtitle');

// ------------------------------------------------------------ 2. subs.js (no TN: the plain defaults)
const S = require(path.join(WEB, 'subs.js'));
const vttOf = (text) => 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n' + text + '\n';
const cand = (label, lang, source, text, log) => ({label, lang, source, score: 0, fetchVtt: async () => { if (log) log.push(label); if (text === null) throw new Error('down'); return vttOf(text); }});
(async () => {
  // the order of candidates: human subtitles in the wanted language (4 at most), then the AI paths
  const list = [cand('h1', 'he', 'wizdom'), cand('e1', 'en', 'opensubs'), cand('h2', 'he', 'ktuvit'), cand('ai', 'he', 'subs_ai'), cand('srv', 'he', 'subsrv'),
    cand('h3', 'he', 'opensubs'), cand('h4', 'he', 'yify'), cand('h5', 'he', 'yify')];
  eq(S.pickAuto(list, 'he').map((x) => x.label), ['h1', 'h2', 'h3', 'h4', 'ai', 'srv']);
  eq(S.pickAuto(list, 'en').map((x) => x.label), ['e1', 'ai', 'srv']);

  const attached = [];
  S.attach = (video, vtt, o) => { attached.push({vtt, o}); video.sub = o.label; return {}; };
  S.detach = (video) => { video.sub = ''; };
  const video = () => ({textTracks: []});
  // a file labelled Hebrew whose text is English is skipped; a download that fails is skipped; the next Hebrew one wins
  let log = [];
  let got = await S.auto(video(), {lang: 'he'}, {key: 'movie:1', list: [cand('wrong', 'he', 'wizdom', EN, log), cand('dead', 'he', 'ktuvit', null, log), cand('good', 'he', 'opensubs', HE, log), cand('later', 'he', 'yify', HE, log)]});
  eq([got.label, log, attached.length, attached[0].o.key, attached[0].o.lang, attached[0].o.source], ['good', ['wrong', 'dead', 'good'], 1, 'movie:1', 'he', 'opensubs']);
  // nothing human in Hebrew: the AI translation of the English one
  attached.length = 0;
  got = await S.auto(video(), {lang: 'he'}, {list: [cand('eng', 'en', 'opensubs', EN), cand('AI · eng', 'he', 'subs_ai', HE)]});
  eq([got.source, attached.length], ['subs_ai', 1]);
  // nothing at all
  attached.length = 0;
  eq([await S.auto(video(), {lang: 'he'}, {list: [cand('eng', 'en', 'opensubs', EN)]}), attached.length], [null, 0]);
  // the viewer left meanwhile: nothing is attached
  eq(await S.auto(video(), {lang: 'he'}, {list: [cand('good', 'he', 'wizdom', HE)], alive: () => false}), null);
  eq(attached.length, 0);
  // a track inside the file in the wanted language wins over any download, and nothing is fetched
  log = [];
  const tracks = [{kind: 'subtitles', label: 'English', language: 'en', mode: 'showing'}, {kind: 'subtitles', label: 'עברית', language: 'he', mode: 'disabled'},
    {kind: 'metadata', label: 'm', language: '', mode: 'hidden'}];
  const v2 = {textTracks: tracks};
  eq(S.embedded(v2).map((x) => [x.label, x.lang, x.on]), [['English', 'en', true], ['עברית', 'he', false]]);
  got = await S.auto(v2, {lang: 'he'}, {list: [cand('net', 'he', 'wizdom', HE, log)]});
  eq([got.embedded, got.source, tracks.map((t) => t.mode), log], [true, 'embedded', ['disabled', 'showing', 'disabled'], []]);
  eq(await S.auto({textTracks: [tracks[0]]}, {lang: 'he'}, {embeddedOnly: true}), null, 'embeddedOnly never searches');
  // HLS subtitle renditions (hls.js)
  const hls = {subtitleTracks: [{name: 'Hebrew', lang: 'he'}, {name: 'Russian', lang: 'rus'}], subtitleTrack: -1, subtitleDisplay: false};
  const emb = S.embedded({textTracks: []}, hls);
  eq(emb.map((x) => [x.label, x.lang, x.on]), [['Hebrew', 'he', false], ['Russian', 'ru', false]]);
  emb[1].select();
  eq([hls.subtitleTrack, hls.subtitleDisplay], [1, true]);
  S.off({textTracks: tracks}, hls);
  eq([hls.subtitleTrack, hls.subtitleDisplay, tracks.map((t) => t.mode)], [-1, false, ['disabled', 'disabled', 'disabled']]);
  // a subtitle file from the device: Windows-1255 Hebrew SRT
  const cp1255 = [0x31, 0x0a, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30, 0x31, 0x2c, 0x30, 0x30, 0x30, 0x20, 0x2d, 0x2d, 0x3e, 0x20, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30, 0x32, 0x2c, 0x30, 0x30, 0x30, 0x0a,
    0xf9, 0xec, 0xe5, 0xed, 0x20, 0xec, 0xeb, 0xe5, 0xec, 0xed, 0x20, 0xe5, 0xe1, 0xf8, 0xe5, 0xeb, 0xe9, 0xed, 0x0a];
  const file = {name: 'my.heb.srt', arrayBuffer: async () => new Uint8Array(cp1255).buffer};
  const ff = await S.fromFile(file);
  eq([ff.label, ff.lang, ff.source], ['my.heb.srt', 'he', 'file']);
  ok(ff.vtt.startsWith('WEBVTT') && ff.vtt.includes('שלום לכולם'), 'a Windows-1255 file becomes readable Hebrew');
  await assert.rejects(S.fromFile({name: 'x.srt', arrayBuffer: async () => new Uint8Array([0x41]).buffer})); n++;
  eq([S.autoOn(), S.prefLang()], [true, 'he'], 'defaults: automatic subtitles on, Hebrew');
  const so = S.styleOptions();
  eq([so.size.map((x) => x[0]), so.color.map((x) => x[0]), so.bg.map((x) => x[0])], [['s', 'm', 'l', 'xl'], ['white', 'yellow', 'cyan'], ['none', 'half', 'full']]);
  eq(S.cssOf({size: 'l', color: 'yellow', bg: 'full'}), {fontSize: '130%', color: '#ffeb3b', background: 'rgba(0,0,0,.9)'});

  // ------------------------------------------------------------ 3. sources.js
  const R = require(path.join(WEB, 'sources.js'));
  eq(R.tags('Dune.2021.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.Atmos-GRP.mkv'), {codec: 'HEVC', hdr: 'DV', audio: 'Atmos', src: 'REMUX', cam: false});
  eq(R.tags('Film.2024.HDCAM.x264.AAC'), {codec: 'H.264', hdr: '', audio: 'AAC', src: 'CAM', cam: true});
  eq([R.tags('Show.S01E02.1080p.WEB-DL.DDP5.1.H.264').audio, R.tags('a.DTS-HD.MA.x265').audio, R.tags('a.AC3.XviD').codec], ['EAC3', 'DTS', 'XviD']);
  eq([R.quality('Film 4K'), R.quality('Film.1080p'), R.quality('Film.DVDRip'), R.langs('Film 🇮🇱 🇷🇺'), R.langs('סרט מדובב'), R.langs('Film.MULTI')], [2160, 1080, 480, ['he', 'ru'], ['he'], ['multi']]);
  // YouTube: recognised by its address, and a running time is never shown as megabytes
  eq([R.ytId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), R.ytId('https://youtu.be/dQw4w9WgXcQ?t=5'), R.ytId('https://www.youtube.com/embed/dQw4w9WgXcQ'),
    R.ytId('https://m.youtube.com/watch?list=x&v=dQw4w9WgXcQ'), R.ytId('https://evil.example/watch?v=dQw4w9WgXcQ'), R.ytId('http://www.youtube.com/watch?v=dQw4w9WgXcQ')],
  ['dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'dQw4w9WgXcQ', '', '']);
  eq([R.sizeText('1:32:10'), R.sizeText('12:05'), R.sizeText(0), R.sizeText(undefined), R.sizeText('NaN'), R.sizeText(5 * 1048576), R.sizeText('734003200')], ['1:32:10', '12:05', '', '', 'NaN', '5 MB', '700 MB']);
  ok(!/NaN MB/.test([R.sizeText('1:32:10'), R.sizeText(NaN), R.sizeText(null), R.sizeText('')].join('|')), 'never "NaN MB"');
  // order: tested-good first, dead last, ready (cached / Telegram) before "RD will fetch", the wanted language, 1080p before 4K
  const rows = [
    {label: 'a', status: 'rd', quality: 1080, lang: 'he', size: 5}, {label: 'b', status: 'cached', quality: 2160, lang: '', size: 9},
    {label: 'c', status: 'cached', quality: 1080, lang: '', size: 2, dead: true}, {label: 'd', status: 'cached', quality: 720, lang: 'he', size: 3},
    {label: 'e', status: 'cached', quality: 1080, lang: '', size: 4}, {label: 'f', status: 'torrent', quality: 1080, lang: '', size: 4, probe: {ok: true}},
    {label: 'g', status: 'cached', quality: 1080, lang: '', size: 8, seeds: 3}];
  eq(R.sortRows(rows, 'he').map((r) => r.label), ['f', 'd', 'g', 'e', 'b', 'a', 'c']);
  // the same release found in two places is one row (name without punctuation, size within 1 %)
  const [kept, folded] = R.dedup([
    {label: 'The.Matrix.1999.1080p.BluRay.x264.mkv', size: 8000000000, group: 'tgsearch', from: 'Telegram'},
    {label: 'The Matrix 1999 1080p BluRay x264', size: 8040000000, group: 'rd', from: 'Torrentio', lang: 'he'},
    {label: 'The.Matrix.1999.1080p.BluRay.x264.mkv', size: 9000000000, group: 'rd', from: 'Torrentio'},
    {label: 'short', size: 5, group: 'x'}, {label: 'short', size: 5, group: 'y'}]);
  eq([kept.length, folded, kept[0].also, kept[0].lang, kept[0].group], [4, 1, ['Torrentio'], 'he', 'tgsearch'], 'the first (best group) stays, the copy is counted, its language is kept');
  // filters of the build: minimum quality (unknown quality stays), hide CAM, only the wanted language when it is known
  const fl = [{label: 'x.720p', quality: 720, lang: 'en'}, {label: 'x.1080p.HDCAM', quality: 1080, lang: ''}, {label: 'x.1080p', quality: 1080, lang: 'he,en'},
    {label: 'x', quality: 0, lang: ''}, {label: 'x.1080p.multi', quality: 1080, lang: 'multi'}, {label: 'x.1080p.ru', quality: 1080, lang: 'ru'}];
  eq(R.filterRows(fl, {minq: 1080, hideCam: true, lang: 'he', strictLang: true}).map((r) => r.label), ['x.1080p', 'x', 'x.1080p.multi']);
  eq(R.filterRows(fl, {}).length, 6);
  // the first bytes of a file: container, codecs, a Hebrew subtitle track; and what a browser does with them
  const bytes = (s, head) => { const b = new Uint8Array(4096); (head || []).forEach((x, i) => { b[i] = x; }); for (let i = 0; i < s.length; i++) b[64 + i] = s.charCodeAt(i) & 255; return b; };
  const mkv = R.sniff(bytes('matroska V_MPEGH/ISO/HEVC A_EAC3 A_AC3 S_TEXT/UTF8 \x22\xb5\x9c\x83heb', [0x1a, 0x45, 0xdf, 0xa3]));
  eq(mkv, {container: 'mkv', video: 'hevc', audio: ['eac3', 'ac3'], subs: true, he: true});
  const none = () => false, chrome = (m) => /avc1|mp4a|matroska|vp9|webm/.test(m);
  eq(R.verdict(mkv, chrome), {play: 'no', why: 'video'}, 'HEVC in a browser without it');
  eq(R.verdict({container: 'mkv', video: 'h264', audio: ['ac3', 'dts'], subs: false, he: false}, chrome), {play: 'no', why: 'audio'}, 'only AC3 / DTS sound');
  eq(R.verdict({container: 'mkv', video: 'h264', audio: ['ac3', 'aac'], subs: false, he: false}, chrome), {play: 'maybe', why: ''}, 'one playable sound track is enough');
  eq(R.verdict({container: 'mkv', video: 'h264', audio: ['aac'], subs: false, he: false}, none), {play: 'no', why: 'container'}, 'MKV in a browser without Matroska');
  const mp4 = R.sniff(bytes('....avc1....mp4a', [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]));
  eq([mp4.container, mp4.video, mp4.audio, R.verdict(mp4, chrome)], ['mp4', 'h264', ['aac'], {play: 'yes', why: ''}]);
  eq(R.verdict(R.sniff(bytes('', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])), chrome), {play: 'no', why: 'container'}, 'AVI');
  // 6.6.1: Safari / WebKit plays no DTS, TrueHD, and (older iOS) no Opus / Vorbis in MP4: such a file goes to the engine,
  // one playable track keeps it native, Edge / Safari keep native AC3 / E-AC3
  const safari = (m) => /avc1|mp4a|ac-3|ec-3/.test(m), oldIos = (m) => /avc1|mp4a/.test(m), edge = (m) => /avc1|mp4a|ac-3|ec-3|webm|opus/.test(m);
  eq(R.verdict({container: 'mp4', video: 'h264', audio: ['dts'], subs: false, he: false}, safari), {play: 'no', why: 'audio'}, 'DTS in MP4 on Safari -> engine');
  eq(R.verdict({container: 'mp4', video: 'h264', audio: ['truehd'], subs: false, he: false}, safari), {play: 'no', why: 'audio'}, 'TrueHD on Safari -> engine');
  eq(R.verdict({container: 'mp4', video: 'h264', audio: ['opus'], subs: false, he: false}, oldIos), {play: 'no', why: 'audio'}, 'Opus in MP4 on older iOS -> engine');
  eq(R.verdict({container: 'mp4', video: 'h264', audio: ['vorbis'], subs: false, he: false}, safari), {play: 'no', why: 'audio'}, 'Vorbis on Safari -> engine');
  eq(R.verdict({container: 'mp4', video: 'h264', audio: ['ac3'], subs: false, he: false}, safari), {play: 'yes', why: ''}, 'AC3 stays native on Safari');
  eq(R.verdict({container: 'mp4', video: 'h264', audio: ['eac3'], subs: false, he: false}, edge), {play: 'yes', why: ''}, 'E-AC3 stays native on Edge');
  eq(R.verdict({container: 'mp4', video: 'h264', audio: ['dts', 'aac'], subs: false, he: false}, safari), {play: 'yes', why: ''}, 'one AAC track keeps it native');
  eq(R.verdict({container: 'mp4', video: 'h264', audio: ['aac'], subs: false, he: false}, none), {play: 'yes', why: ''}, 'AAC MP4 stays native');
  eq(R.verdict({container: 'mp4', video: 'h264', audio: ['opus'], subs: false, he: false}, chrome), {play: 'yes', why: ''}, 'Opus plays in Chrome');
  eq([R.audioPlayable('dts', () => 'maybe'), R.audioPlayable('xyz', () => true), R.audioPlayable('mp3', none)], [true, false, true], 'maybe counts as playable');
  eq(R.verdict(R.sniff(new Uint8Array(4)), chrome), {play: 'maybe', why: ''}, 'nothing known: try');
  // a torrent row (info hash only) carries what Real-Debrid needs, and no address
  const tz = R.parseStream({name: 'Torrentio\n1080p', title: 'Film.1080p.mkv\n👤 12 💾 2.1 GB', infoHash: 'A'.repeat(40), fileIdx: 2, behaviorHints: {filename: 'Film.1080p.mkv'}}, 'Torrentio');
  eq([tz.status, tz.url, tz.hash, tz.fileIdx, tz.file, tz.seeds], ['torrent', '', 'a'.repeat(40), 2, 'Film.1080p.mkv', 12]);
  eq([R.keyOf({type: 'movie', id: 5}), R.keyOf({type: 'tv', id: 7, season: 1, episode: 2}), R.keyOf({resumeKey: 'x'}), R.epCode({type: 'tv', season: 1, episode: 12}), R.clock(3725)],
    ['movie:5', 'tv:7:1:2', 'x', 'S01E12', '1:02:05']);

  console.log('t_playback OK (' + n + ' checks)');
})().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1); });
