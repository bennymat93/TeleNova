'use strict';
// node src/qa/web/t_sources.js - pure parts of web/sources.js (Stremio / Torrentio stream parsing, order, ids)
const assert = require('assert');
const S = require('../../../web/sources.js');
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const tor = S.parseStream({name: '[RD+] Torrentio\n1080p', title: 'The.Matrix.1999.1080p.BluRay.x264.mkv\n👤 120 💾 8.2 GB ⚙️ YTS\n🇬🇧 / 🇮🇱',
  url: 'https://torrentio.strem.fun/resolve/realdebrid/X/abc/null/0/a.mkv', behaviorHints: {bingeGroup: 'x'}}, 'Torrentio');
eq([tor.status, tor.quality, tor.lang, tor.seeds, tor.size], ['cached', 1080, 'he,en', 120, Math.round(8.2 * 1073741824)]);
eq(tor.label, 'The.Matrix.1999.1080p.BluRay.x264.mkv');
const dl = S.parseStream({name: '[RD download] Torrentio\n4k', title: 'M.2160p.mkv\n💾 40 GB', url: 'https://torrentio.strem.fun/r'});
eq([dl.status, dl.quality], ['rd', 2160]);
const tz = S.parseStream({name: 'Torrentio\n720p', title: 'x', infoHash: 'abc'});
eq([tz.status, tz.url], ['torrent', '']);
eq(S.parseStream({name: 'X', url: 'http://insecure/a.mp4'}).status, 'external');
eq(S.parseStream({name: 'X', externalUrl: 'https://e.com/p'}).ext, 'https://e.com/p');
eq(S.parseStream({name: 'Addon', title: 'Film 720p Hebrew', url: 'https://cdn/a.mp4'}).lang, 'he');
const rows = [{status: 'rd', quality: 1080, lang: '', size: 1}, {status: 'cached', quality: 2160, lang: '', size: 9},
  {status: 'cached', quality: 1080, lang: 'he', size: 2}, {status: 'cached', quality: 720, lang: '', size: 3}];
eq(S.sortRows(rows, 'he').map((r) => r.status + r.quality), ['cached1080', 'cached2160', 'cached720', 'rd1080']);
eq(S.streamId({type: 'movie', imdb: 'tt0133093'}), 'tt0133093');
eq(S.streamId({type: 'tv', imdb: 'tt0944947', season: 1, episode: 2}), 'tt0944947:1:2');
eq(S.streamId({type: 'movie'}), '');
eq(S.addonBase('stremio://v3-cinemeta.strem.io/manifest.json'), 'https://v3-cinemeta.strem.io');
eq(S.addonBase('https://a.b/c/manifest.json?x=1'), 'https://a.b/c');
eq(S.addonBase('http://a.b/manifest.json'), '');
eq(S.addonBase('javascript:alert(1)'), '');
eq(S.keyOf({type: 'tv', id: '1399', season: 1, episode: 3}), 'tv:1399:1:3');
eq(S.keyOf({type: 'movie', id: '603'}), 'movie:603');
eq([S.quality('Film.WEB-DL.720p'), S.quality('x'), S.sizeBytes('💾 700 MB'), S.sizeText(1610612736)], [720, 0, 734003200, '1.5 GB']);
// 5.1: the recommendation number (recOf) and the order it gives
const yes = (c, m) => { assert.ok(c, m); n++; };
const row = (label, o) => Object.assign({label, quality: S.quality(label), lang: '', size: 2e9, status: 'direct'}, o || {});
const good = S.recOf(row('Film.2020.1080p.WEB-DL.x264.AAC.mp4', {lang: 'he', probe: {ok: true, mbit: 40, verdict: {play: 'yes'}}}), 'he', 0);
yes(good.pct >= 90 && good.tier === 'top' && good.flags.includes('tested'), 'tested, fast, plays here, wanted language: highly recommended (' + good.pct + ')');
const untested = S.recOf(row('Film.2020.1080p.WEB-DL.x264.AAC.mp4', {lang: 'he'}), 'he', 0);
yes(untested.pct <= 60 && untested.flags.includes('untested'), 'not tested: at most 60 (' + untested.pct + ')');
eq(S.recOf(row('x.1080p.mp4', {dead: true}), '', 0).pct, 0, 'a dead link');
eq(S.recOf(row('x.1080p.mp4', {probe: {ok: false}}), '', 0).pct, 0, 'a link that failed its test');
const cached = S.recOf(row('Film.1080p.mkv', {status: 'cached'}), '', 0), rdLater = S.recOf(row('Film.1080p.mkv', {status: 'rd'}), '', 0);
yes(cached.pct > rdLater.pct && cached.flags.includes('cached'), 'a cached file is above one Real-Debrid must download first');
yes(S.recOf(row('Film.1080p.mkv', {status: 'torrent'}), '', 0).pct <= 30, 'what cannot play here is at the bottom');
const hard = S.recOf(row('Film.2160p.HEVC.DTS.mkv', {probe: {ok: true, mbit: 80, verdict: {play: 'no', why: 'video'}}}), '', 0);
const easy = S.recOf(row('Film.1080p.x264.AAC.mp4', {probe: {ok: true, mbit: 80, verdict: {play: 'yes'}}}), '', 0);
yes(easy.pct > hard.pct, 'a file this browser plays itself is above one that needs the built-in engine');
// a weak line: 4 Mbit/s measured last time
const slow4k = S.recOf(row('Film.2160p.x264.mp4', {probe: {ok: true, mbit: 60, verdict: {play: 'yes'}}}), '', 4e6);
const slow720 = S.recOf(row('Film.720p.x264.mp4', {probe: {ok: true, mbit: 60, verdict: {play: 'yes'}}}), '', 4e6);
yes(slow720.pct > slow4k.pct, 'on a weak connection the lighter picture is recommended more (' + slow720.pct + ' > ' + slow4k.pct + ')');
const fast4k = S.recOf(row('Film.2160p.x264.mp4', {probe: {ok: true, mbit: 60, verdict: {play: 'yes'}}}), '', 80e6);
const fast720 = S.recOf(row('Film.720p.x264.mp4', {probe: {ok: true, mbit: 60, verdict: {play: 'yes'}}}), '', 80e6);
yes(fast4k.pct >= fast720.pct, 'on a fast one the sharper picture is not behind');
const sorted = S.sortRows([row('C.720p.mp4'), row('A.1080p.mp4', {probe: {ok: true, mbit: 30, verdict: {play: 'yes'}}}), row('D.1080p.mp4', {dead: true}),
  row('B.1080p.mp4', {status: 'cached'})], '');
eq(sorted.map((r) => r.label[0]).join(''), 'ABCD', 'the list: tested and recommended first, dead last');
yes(sorted.every((r) => r.rec && typeof r.rec.pct === 'number'), 'every row carries its number');
console.log('t_sources OK (' + n + ' checks)');
