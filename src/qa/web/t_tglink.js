'use strict';
// node t_tglink.js - the seal of the automatic Telegram sign-in between a household's devices (web/tg.js: linkKeys,
// linkSeal, linkOpen). The Telegram side itself (auth.AcceptLoginToken on the device that is signed in) needs a real
// account and was not run here.
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'web', 'tg.js'), 'utf8').split('\r\n').join('\n');
let n = 0, fails = 0;
function ok(c, m) { n++; if (!c) { fails++; console.log('FAIL', m); } }
// the three functions, cut out of the module (they use only WebCrypto and TextEncoder)
const cut = (name) => { const i = src.indexOf('  async function ' + name + '('); const j = src.indexOf('\n  }\n', i) + 5; if (i < 0) throw new Error('missing ' + name); return src.slice(i, j); };
const box = {crypto: globalThis.crypto, TextEncoder, Uint8Array, Array};
vm.createContext(box);
vm.runInContext(cut('linkKeys') + cut('linkSeal') + cut('linkOpen') + '\nthis.api = {linkKeys, linkSeal, linkOpen};', box);
const L = box.api;
(async () => {
  const secret = 'A'.repeat(43), other = 'B'.repeat(43);
  const token = Uint8Array.from({length: 48}, (_, i) => (i * 7) % 256);
  const a = await L.linkSeal(secret, token), b = await L.linkSeal(secret, token);
  ok(/^[0-9a-f]{32}$/.test(a.chan), 'the channel is 32 hex characters');
  ok(a.chan === b.chan, 'one household, one channel');
  ok((await L.linkSeal(other, token)).chan !== a.chan, 'another household, another channel');
  ok(Buffer.from(a.body).toString('hex') !== Buffer.from(b.body).toString('hex'), 'the same token is sealed differently every time');
  ok(!Buffer.from(a.body).toString('latin1').includes(Buffer.from(token).toString('latin1').slice(8, 24)), 'the token is not readable in the mailbox');
  ok(Buffer.from(await L.linkOpen(secret, a.body)).equals(Buffer.from(token)), 'the household opens it');
  let refused = false;
  try { await L.linkOpen(other, a.body); } catch (e) { refused = true; }
  ok(refused, 'another household cannot open it');
  const bent = new Uint8Array(a.body); bent[20] ^= 1;
  refused = false;
  try { await L.linkOpen(secret, bent); } catch (e) { refused = true; }
  ok(refused, 'a changed message is refused');
  ok(!a.chan.includes(secret.slice(0, 8)) && a.body.length === 12 + token.length + 16, 'nothing of the secret is in what leaves the device');
  // the wiring
  ok(/linkAsk\(code\.token\)/.test(src) && /AcceptLoginToken/.test(src) && /linkStart\(\)/.test(src), 'the sign-in asks, and a signed-in device answers');
  ok(!/A\.put\('tg_session'[^)]*\)[^\n]*link|tg_session[^\n]*web\.tg_link/.test(src), 'a Telegram session is not part of it');
  const bk = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'web', 'backup.js'), 'utf8');
  ok(/web\.tg_link = lk/.test(bk) && !/web\.tg_session|tg_session'\)[^\n]*web\./.test(bk), 'the backup carries the household secret, never a Telegram session');
  console.log(fails ? 't_tglink FAILED ' + fails + ' of ' + n : 't_tglink OK (' + n + ' checks)');
  process.exit(fails ? 1 : 0);
})();
