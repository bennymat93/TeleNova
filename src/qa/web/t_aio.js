'use strict';
// node t_aio.js - All in one: the browser's keys (web/aio.js) are the Kodi engine's (aio.py), and the round trip
// save -> connect brings a setup back. The helper and the backup module are simulated; a made-up account only.
const fs = require('fs'), path = require('path'), vm = require('vm');
const {execFileSync} = require('child_process');
let n = 0, fails = 0;
function ok(c, m) { n++; if (!c) { fails++; console.log('FAIL', m); } }
const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'web', 'aio.js'), 'utf8');
const pages = {}, providers = {}, store = {}, session = {};
const TN = {i18n: {add() {}}, t: (k, ...a) => k + (a.length ? ':' + a.join(',') : ''), registerPage: (k, f) => { pages[k] = f; },
  registerProvider: (k, p) => { providers[k] = p; }, put: (k, v) => { store[k] = v; }, get: (k, d) => (k in store ? store[k] : d), loadScript: async () => {}};
const vault = new Map(), calls = [];
const box = {TN, crypto: globalThis.crypto, TextEncoder, Uint8Array, Array, Math, Error, Object, String, Number, btoa, atob, setTimeout,
  sessionStorage: {getItem: (k) => session[k] || null, setItem: (k, v) => { session[k] = v; }, removeItem: (k) => { delete session[k]; }},
  fetch: async (url, opt) => {
    opt = opt || {};
    calls.push([opt.method || 'GET', url]);
    const id = url.split('/aio/')[1];
    if (opt.method === 'PUT') { vault.set(id, new Uint8Array(await new Response(opt.body).arrayBuffer())); return {ok: true, status: 204}; }
    if (!vault.has(id)) return {ok: false, status: 404};
    return {ok: true, status: 200, arrayBuffer: async () => vault.get(id).buffer};
  },
  TNBackup: {
    fullBackup: async (pw) => { box.lastSeal = pw; return new Blob([new TextEncoder().encode('SEALED:' + pw)]); },
    fullRestore: async (bytes, pw) => {
      const txt = new TextDecoder().decode(bytes);
      if (txt !== 'SEALED:' + pw) throw Object.assign(new Error('wrong'), {code: 'wrong_password'});
      return {names: ['Real-Debrid', 'Telegram'], autoTg: true};
    },
  }};
box.self = box;
vm.createContext(box);
vm.runInContext(src, box);
const A = providers.aio;
(async () => {
  ok(A && typeof A.keys === 'function' && pages.aio, 'the module registers its page and its service');
  const name = '  Test-User ', pass = 'not-a-real-pass-123';
  const k = await A.keys(name, pass);
  const py = execFileSync(process.env.PYTHON || 'python', [path.join(__dirname, '..', 't_aio.py'), 'vector']).toString().trim().split(' ');
  ok(k.id === py[0] && k.seal === py[1], 'the same address and seal as Kodi (aio.py)');
  ok(!src.includes('BNmat') && !/BennyAIO/i.test(src), 'no real user name or password in the code');
  await A.save(name, pass);
  ok(vault.has(k.id) && calls[0][0] === 'PUT' && box.lastSeal === k.seal, 'save: the setup is sealed with the account key and kept at its address');
  ok(!calls[0][1].includes('Test') && !calls[0][1].includes(pass), 'nothing of the user name or password leaves the device');
  const got = await A.connect('test-user', pass);
  ok(got.names.join() === 'Real-Debrid,Telegram' && session.bn_tg_auto === '1', 'connect: everything back, and Telegram starts by itself');
  let code = '';
  try { await A.connect(name, pass + 'x'); } catch (e) { code = e.code; }
  ok(code === 'aio_none', 'a wrong password: "not found" (no hint which part was wrong)');
  code = '';
  try { await A.connect('ab', 'short'); } catch (e) { code = e.code; }
  ok(code === 'aio_short', 'too short: refused before any request');
  ok(store.aio_done === 1, 'the first-run button goes away after a connect');
  for (const k2 of Object.keys(store)) delete store[k2];
  ok(A.fresh() === true, 'a device with nothing connected shows the first-run button');
  store.rd_token = 'x';
  ok(A.fresh() === false, 'one connected service hides it');
  console.log(fails ? 't_aio FAILED ' + fails + ' of ' + n : 't_aio OK (' + n + ' checks)');
  process.exit(fails ? 1 : 0);
})();
