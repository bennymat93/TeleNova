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
console.log('t_sources OK (' + n + ' checks)');
