'use strict';
// node src/qa/web/t_srt.js [fixtureDir]  - offline tests for web/srt.js + web/subs.js (WP-6), with mocked network.
// fixtureDir (optional) may hold real downloads: f.bin (Wizdom zip), y.zip (YIFY zip), y.html (YIFY movie page).
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const WEB = path.join(__dirname, '..', '..', '..', 'web');
const T = require(path.join(WEB, 'srt.js'));
globalThis.TNSrt = T;
const S = require(path.join(WEB, 'subs.js'));
const FIX = process.argv[2];
let n = 0;
const ok = (name) => { n++; console.log('ok', n, name); };

(async () => {
  // ---- parse / vtt / srt / shift
  const srt = '1\r\n00:00:01,500 --> 00:00:03,000\r\n{\\an8}<font color="red">Hello</font> & <i>you</i>\r\n\r\n' +
    '2\n00:01:02,05 --> 00:01:04,000\nLine A\nLine B\n\n3\n00:00:00,000 --> 00:00:00,500\n\n';
  const cues = T.parse(srt);
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[0].text, 'Hello &amp; <i>you</i>');
  assert.strictEqual(cues[1].start, 62.05);
  ok('parse srt (tags, ASS overrides, empty cue, 2-digit ms)');
  const vtt = T.toVtt(srt);
  assert.ok(vtt.startsWith('WEBVTT\n\n00:00:01.500 --> 00:00:03.000\n'));
  assert.deepStrictEqual(T.parse(vtt).map((c) => c.start), [1.5, 62.05]);
  ok('toVtt round trip');
  assert.ok(T.toSrt(cues).includes('00:01:02,050 --> 00:01:04,000'));
  ok('toSrt');
  const sh = T.shift(cues, -2);
  assert.strictEqual(sh[0].start, 0); assert.strictEqual(sh[1].start, 60.05);
  ok('shift clamps at 0');

  // ---- decode
  const heb = new TextDecoder().decode(new Uint8Array([0xd7, 0xa9, 0xd7, 0x9c, 0xd7, 0x95, 0xd7, 0x9d]));
  const cp1255 = new Uint8Array([0xf9, 0xec, 0xe5, 0xed, 0x20, 0x31]);   // "שלום 1"
  assert.strictEqual(T.decode(cp1255, 'he'), heb + ' 1');
  assert.strictEqual(T.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]), 'he'), 'A');
  assert.strictEqual(T.decode(new Uint8Array([0xef, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]), 'ru'), 'привет');
  ok('decode BOM / windows-1255 / windows-1251');

  // ---- releaseScore
  assert.ok(T.releaseScore('The.Matrix.1999.1080p.BluRay.x264-HiDt', 'The.Matrix.1999.1080p.BluRay.DTS.x264-HiDt') > 0.7);
  assert.ok(T.releaseScore('The.Matrix.1999.1080p.BluRay.x264-HiDt', 'Matrix.1999.DVDrip.XviD') < 0.5);
  ok('releaseScore');

  // ---- zip: a stored entry built here, plus the real downloads when given
  const body = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\nhi\n');
  const name = new TextEncoder().encode('a.srt');
  const crc = 0;
  const lh = new Uint8Array(30 + name.length); const dl = new DataView(lh.buffer);
  dl.setUint32(0, 0x04034b50, true); dl.setUint16(8, 0, true); dl.setUint32(18, body.length, true); dl.setUint32(22, body.length, true);
  dl.setUint16(26, name.length, true); lh.set(name, 30);
  const cd = new Uint8Array(46 + name.length); const dc = new DataView(cd.buffer);
  dc.setUint32(0, 0x02014b50, true); dc.setUint16(10, 0, true); dc.setUint32(16, crc, true); dc.setUint32(20, body.length, true);
  dc.setUint32(24, body.length, true); dc.setUint16(28, name.length, true); dc.setUint32(42, 0, true); cd.set(name, 46);
  const eo = new Uint8Array(22); const de = new DataView(eo.buffer);
  de.setUint32(0, 0x06054b50, true); de.setUint16(8, 1, true); de.setUint16(10, 1, true); de.setUint32(12, cd.length, true);
  de.setUint32(16, lh.length + body.length, true);
  const zip = new Uint8Array([...lh, ...body, ...cd, ...eo]);
  assert.ok(T.isZip(zip));
  const ents = await T.unzip(zip);
  assert.strictEqual(T.pickFile(ents).name, 'a.srt');
  assert.strictEqual(T.decode(T.pickFile(ents).bytes), '1\n00:00:01,000 --> 00:00:02,000\nhi\n');
  ok('unzip stored entry');
  let wizBytes = null;
  if (FIX && fs.existsSync(path.join(FIX, 'f.bin'))) {
    wizBytes = fs.readFileSync(path.join(FIX, 'f.bin'));
    const v = await S._internal.toVttText(wizBytes, 'he');
    const c = T.parse(v);
    assert.ok(c.length > 500 && /[א-ת]/.test(c[10].text), 'hebrew cues');
    ok('real Wizdom zip -> ' + c.length + ' Hebrew cues');
  }
  if (FIX && fs.existsSync(path.join(FIX, 'y.zip'))) {
    const v = await S._internal.toVttText(fs.readFileSync(path.join(FIX, 'y.zip')), 'he');
    assert.ok(T.parse(v).length > 300);
    ok('real YIFY deflate zip -> ' + T.parse(v).length + ' cues');
  }
  if (FIX && fs.existsSync(path.join(FIX, 'y.html'))) {
    const rows = S._internal.parseYify(fs.readFileSync(path.join(FIX, 'y.html'), 'utf8'));
    const he = rows.filter((r) => r.lang === 'he');
    assert.ok(rows.length > 50 && he.length >= 1 && he[0].page.startsWith('/subtitles/'));
    ok('parseYify: ' + rows.length + ' rows, ' + he.length + ' Hebrew');
  }

  // ---- Ktuvit password encoding == ktuvitauth.encode_password (values printed by the Python code)
  assert.strictEqual(Buffer.from(S._internal.ktIv('ab-1c@face.co')).toString('hex'), 'ffff0cface0000000000000000000000');
  assert.strictEqual(await S._internal.ktEncode('ab-1c@face.co', 'pässw0rd!'), 'W2Bbpo4keN1IvMWWdm6PAHOIHpJWPaVrA/o9vbyC+fU=');
  assert.strictEqual(await S._internal.ktEncode('x0x1-2ef@d.com', 'pässw0rd!'), 'T9DqlHFP+2RtOG+sgJMdOkeNoDV0o9jD5V1Zqpj2a2M=');
  assert.strictEqual(await S._internal.ktEncode('Test.User@Mail.com', 'pässw0rd!'), 'Jl4UPuonWKGPGgdRz4vz7nqVh70ZpHhhnRKSlUwpEJc=');
  ok('Ktuvit encode_password matches Python');
  const kt = S._internal.parseKtuvitRows('<table><tr><td><div style="float: right; font-weight: bold;">The.Matrix.1999.BluRay<br />x</div></td>' +
    '<td><a data-subtitle-id="ABC123">dl</a></td></tr><tr><td>no id</td></tr></table>');
  assert.deepStrictEqual(kt, [{id: 'ABC123', name: 'The.Matrix.1999.BluRay'}]);
  ok('parseKtuvitRows');

  // ---- Wizdom + aggregate with a mocked network
  const calls = [];
  const searchJson = FIX && fs.existsSync(path.join(FIX, 's.json')) ? fs.readFileSync(path.join(FIX, 's.json'), 'utf8')
    : JSON.stringify([{id: 1, versioname: 'Matrix.1999.DVDrip'}, {id: 2, versioname: 'The.Matrix.1999.1080p.BluRay.x264-HiDt'}]);
  S._fetch = async (url, opts) => {
    calls.push(url);
    if (/wizdom\.xyz\/api\/search/.test(url)) return new Response(searchJson);
    if (/wizdom\.xyz\/api\/files\/sub\//.test(url)) return new Response(wizBytes || zip);
    if (/yifysubtitles/.test(url)) return new Response('', {status: 403});
    throw new Error('unexpected ' + url);
  };
  const errors = {};
  const list = await S.find({type: 'movie', imdb: 'tt0133093', title: 'The Matrix', release: 'The.Matrix.1999.1080p.BluRay.x264-HiDt', lang: 'he'}, {errors});
  assert.ok(list.length >= 2 && list.every((x) => x.lang === 'he' && x.source === 'wizdom'));
  assert.ok(/1080p/.test(list[0].label), 'best release first: ' + list[0].label);
  assert.ok(errors.yify && !errors.wizdom);
  assert.ok(calls[0].includes('action=by_id') && calls[0].includes('imdb=tt0133093'));
  const v = await list[0].fetchVtt();
  assert.ok(v.startsWith('WEBVTT'));
  await list[0].fetchVtt();
  assert.strictEqual(calls.filter((u) => /files\/sub/.test(u)).length, 1, 'download cached');
  ok('Wizdom find + fetchVtt (mocked), YIFY error reported, OpenSubtitles/Ktuvit/AI skipped without keys');

  // ---- Gemini translation with a mocked fetch (no key -> clear error)
  await assert.rejects(S.translate(srt, 'he'), /Gemini|subs_need_key/);
  ok('translate without a key fails with a clear message');
  S._geminiKey = () => 'TESTKEY';
  const realFetch = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (url, o) => {
    seen = {url, key: o.headers['x-goog-api-key']};
    const lines = JSON.parse(JSON.parse(o.body).contents[0].parts[0].text.split('\n').slice(1).join('\n'));
    return new Response(JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify({lines: lines.map((l) => 'HE:' + l)})}]}}]}));
  };
  const tv = await S.translate(srt, 'he');
  globalThis.fetch = realFetch;
  assert.ok(!seen.url.includes('TESTKEY') && seen.key === 'TESTKEY', 'key only in a header');
  assert.deepStrictEqual(T.parse(tv).map((c) => c.text), ['HE:Hello &amp; <i>you</i>', 'HE:Line A\nLine B']);
  ok('Gemini translation (mocked) -> VTT, key in header only');

  console.log(`all ${n} passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
