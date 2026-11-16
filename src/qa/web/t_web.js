'use strict';
// Cross-language tests of the web version's shared-document layer (run by run_web_tests.py):
//   node t_web.js <fixtures folder> <path of fflate's umd/index.js>
// (a) web/syncdoc.js gives byte-identical canonical text to the build's syncdoc.py for every recorded call and for
//     every order of merging four devices;
// (b) web/sealed.js opens what the build's configio.pack sealed, refuses a wrong password / a damaged file, and
//     seals documents that check_repack.py then opens with the build's own code.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [dir, fflatePath] = process.argv.slice(2);
const WEB = path.join(__dirname, '..', '..', '..', 'web');
const SD = require(path.join(WEB, 'syncdoc.js'));
const Sealed = require(path.join(WEB, 'sealed.js')).use(require(path.resolve(fflatePath)));
const bad = [];
const check = (cond, what) => { if (!cond) bad.push(what); };
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const read = (name) => SD.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const short = (s) => (s.length > 300 ? s.slice(0, 300) + '...' : s);
function firstDiff(a, b) { let i = 0; while (i < a.length && a[i] === b[i]) i++; return `at ${i}: js ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 60))} / py ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 60))}`; }

(async () => {
  // ---- (a) the merge rules
  const fx = read('syncdoc_cases.json');
  const perFn = {};
  let failed = 0;
  for (const c of fx.cases) {
    perFn[c.fn] = (perFn[c.fn] || 0) + 1;
    let got;
    try { got = SD.canon(SD[c.fn](...c.args)); } catch (e) { got = 'EXCEPTION ' + e.message; }
    if (got !== c.out && failed++ < 8) bad.push(`${c.fn}: ${firstDiff(got, c.out)}\n      args ${short(SD.canon(c.args))}`);
  }
  if (failed > 8) bad.push(`... and ${failed - 8} more calls differ`);
  const perms = (n) => { const out = []; const go = (cur, rest) => { if (!rest.length) return out.push(cur); rest.forEach((x, i) => go(cur.concat(x), rest.slice(0, i).concat(rest.slice(i + 1)))); }; go([], [...Array(n).keys()]); return out; };
  const orders = perms(4);                                             // the order of Python's itertools.permutations
  let orderBad = 0;
  fx.rounds.forEach((r, n) => {
    orders.forEach((order, k) => {
      let cur = null;
      for (const i of order) cur = SD.merge(cur, r.docs[i]);
      if (sha(SD.canon(cur)) !== r.orders[k] && orderBad++ < 3) bad.push(`document round ${n}, order ${order}: another result than Python`);
    });
    const pairs = SD.canon(SD.merge(SD.merge(r.docs[0], r.docs[1]), SD.merge(r.docs[2], r.docs[3])));
    if (pairs !== r.pairs && orderBad++ < 3) bad.push(`document round ${n}, merged in pairs: ${firstDiff(pairs, r.pairs)}`);
    // merging must not change its inputs (the app keeps them)
    const before = SD.canon(r.docs);
    SD.merge(r.docs[0], r.docs[1]);
    check(SD.canon(r.docs) === before, `document round ${n}: merge changed its input`);
  });
  // parse / canon / copy on their own
  check(SD.canon(SD.parse('{"b":1.0,"a":[5,5.0,-0.0,1e2,1E+2,12345678901234567890],"__proto__":{"x":1}}')) === '{"__proto__":{"x":1},"a":[5,5.0,-0.0,100.0,100.0,12345678901234567890],"b":1.0}', 'parse keeps whole floats, big ints and any key');
  check(({}).x === undefined, 'no prototype pollution');
  for (const wrong of ['', '{', '[1,]', '{"a":1,}', 'nul', '"abc', '1 2', '{"a" 1}']) {
    let threw = false;
    try { SD.parse(wrong); } catch (e) { threw = true; }
    check(threw, 'bad JSON must be refused: ' + wrong);
  }
  console.log(`syncdoc.js: ${fx.cases.length} calls (${Object.entries(perFn).map(([k, v]) => k + ' ' + v).join(', ')}), ${fx.rounds.length} rounds x ${orders.length} orders`);

  // ---- (b) the sealed file
  const sealed = read('sealed_cases.json');
  const out = [];
  for (const c of sealed) {
    const blob = Sealed.unb64(c.blob);
    if (c.canon !== undefined) {
      let text = null;
      try { text = await Sealed.unpackDoc(blob, c.password); } catch (e) { bad.push(`sealed ${c.name}: ${e.message}`); continue; }
      check(SD.canon(SD.parse(text)) === c.canon, `sealed ${c.name}: the document inside differs`);
      const got = await Sealed.unpack(blob, c.password);
      check(crypto.createHash('sha256').update(got.files['setup.zip']).digest('hex') === c.zip_sha256, `sealed ${c.name}: the zip differs`);
      check(SD.canon(got.extra) === SD.canon({note: c.note}), `sealed ${c.name}: the note differs`);
      check(!!got.header.encrypted === !!c.password, `sealed ${c.name}: header`);
      // seal it again here: Python must open it and find the same document (and one changed in the browser)
      const doc = SD.merge(SD.parse(text), {v: 2, users: [{id: 'uweb', name: 'דפדפן 😀', created: 1763312400, renamed: 1763312400, deleted: 0}],
        data: {uweb: {history: [{key: 'movie:603', label: 'The Matrix', when: '16/11/2026 21:00', ts: 1763312400.25, play: 'plugin://plugin.video.nova/?a=play&m=movie&id=603&q=The+Matrix', thumb: '', fanart: '', plot: ''}]}}});
      const again = await Sealed.packDoc(SD.canon(doc), c.password, c.note);
      out.push({name: c.name, password: c.password, blob: Sealed.b64(again), canon: SD.canon(doc), note: c.note});
    } else {
      let got = null;
      try { got = await Sealed.unpack(blob, c.password); } catch (e) { bad.push(`sealed ${c.name}: ${e.message}`); continue; }
      check(crypto.createHash('sha256').update(got.files['a.bin']).digest('hex') === c.file_sha256, `sealed ${c.name}: the file differs`);
      check(SD.canon(got.settings) === SD.canon(c.settings) && SD.canon(got.extra) === SD.canon(c.extra), `sealed ${c.name}: settings / extra differ`);
      const again = await Sealed.pack(got.settings, got.files, c.password, got.extra);
      out.push({name: c.name, password: c.password, blob: Sealed.b64(again), settings: c.settings, file_sha256: c.file_sha256, extra: c.extra});
    }
  }
  const refuses = async (blob, password, code, what) => {
    try { await Sealed.unpack(blob, password); bad.push(what + ': accepted'); } catch (e) { check(e.code === code, `${what}: ${e.code || e.message} instead of ${code}`); }
  };
  const one = sealed.find((c) => c.name === 'small'), blob = Sealed.unb64(one.blob);
  await refuses(blob, one.password + 'x', 'wrong_password', 'a wrong password');
  await refuses(blob, '', 'password_required', 'no password');
  const hurt = blob.slice(); hurt[hurt.length - 40] ^= 1;
  await refuses(hurt, one.password, 'wrong_password', 'a damaged sealed file');
  await refuses(blob.subarray(0, blob.indexOf(10, 7) + 20), one.password, 'damaged', 'a cut file');
  await refuses(new TextEncoder().encode('hello'), 'x', 'not_a_config_file', 'not a config file');
  const open = Sealed.unb64(sealed.find((c) => c.name === 'open').blob).slice(); open[open.length - 3] ^= 1;
  await refuses(open, '', 'damaged', 'a damaged open file');
  check(Sealed.cloudKey(5550001234n) === 'telenova-setup-v1:5550001234' && Sealed.cloudKey('5550001234') === 'telenova-setup-v1:5550001234', 'the password is made of the account id exactly as the build makes it');
  // an unsealed file made here
  const plain = await Sealed.pack({a: 'b'}, {'x.bin': new Uint8Array([1, 2, 3])}, '', {k: 1});
  out.push({name: 'plain-js', password: '', blob: Sealed.b64(plain), settings: {a: 'b'}, file_sha256: crypto.createHash('sha256').update(Buffer.from([1, 2, 3])).digest('hex'), extra: {k: 1}});
  fs.writeFileSync(path.join(dir, 'repacked.json'), JSON.stringify(out));
  console.log(`sealed.js: opened ${sealed.length} files sealed by Python, sealed ${out.length} for Python`);

  for (const b of bad) console.log('FAIL', b);
  console.log(bad.length ? `WEB DOCUMENT TESTS: ${bad.length} problems` : 'WEB DOCUMENT TESTS OK');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.stack || e); process.exit(1); });
