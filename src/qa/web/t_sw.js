'use strict';
// node t_sw.js - the service worker's "network first, the cached copy on a stalled link" rule (web/sw.js raceCache,
// 6.5.1). sw.js is run in a bare context (no fetch events fire); only the pure helper is tested.
const fs = require('fs'), path = require('path'), vm = require('vm');
const WEB = path.join(__dirname, '..', '..', '..', 'web');
let n = 0, fails = 0;
function ok(c, m) { n++; if (!c) { fails++; console.log('FAIL', m); } }

const box = {importScripts: () => {}, addEventListener: () => {}, setTimeout, clearTimeout, Promise, URL, console, WEB_VERSION: 'test',
  location: {origin: 'https://example.test'}, caches: {}, Response: function () {}};
box.self = box;
vm.runInNewContext(fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8'), box, {filename: 'sw.js'});
const race = box.raceCache;
const later = (ms, v, fail) => new Promise((res, rej) => setTimeout(() => (fail ? rej(v) : res(v)), ms));
const src0 = () => fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');
const never = () => new Promise(() => {});

(async () => {
  ok(typeof race === 'function', 'sw.js exports raceCache');
  // the network answers before the timer: the network answer, and the cache is never asked
  let asked = 0;
  ok(await race(later(5, 'net'), () => { asked++; return Promise.resolve('cache'); }, 60) === 'net' && asked === 0, 'a quick network answer wins; the cache is not read');
  // the timer fires and there is a cached copy
  ok(await race(later(200, 'net'), () => Promise.resolve('cache'), 20) === 'cache', 'a stalled network: the cached copy after the wait');
  ok(await race(never(), Promise.resolve('cache'), 20) === 'cache', 'a network that never answers: the cached copy (a promise is accepted too)');
  // the timer fires without a cached copy: the wait for the network goes on
  ok(await race(later(80, 'net'), () => Promise.resolve(undefined), 20) === 'net', 'nothing cached: keeps waiting for the network');
  // the network fails
  ok(await race(later(5, new Error('down'), true), () => Promise.resolve('cache'), 500) === 'cache', 'a failed network with a cached copy: the copy, at once');
  let err = null;
  try { await race(later(5, new Error('down'), true), () => Promise.resolve(undefined), 500); } catch (e) { err = e; }
  ok(err && err.message === 'down', 'a failed network with nothing cached: rejects with the network error (the caller falls back)');
  err = null;
  try { await race(later(5, new Error('down'), true), () => Promise.reject(new Error('cache broke')), 500); } catch (e) { err = e; }
  ok(err && err.message === 'down', 'a cache that throws is treated as nothing cached');
  // a late network failure after the cached answer won raises nothing
  let unhandled = 0;
  const onUn = () => { unhandled++; };
  process.on('unhandledRejection', onUn);
  ok(await race(later(60, new Error('late'), true), () => Promise.resolve('cache'), 10) === 'cache', 'the cached copy won ...');
  await later(120);
  process.removeListener('unhandledRejection', onUn);
  ok(unhandled === 0, '... and the late network failure is not an unhandled rejection');
  // 6.5.1: the compat engine asks for 1 MiB + 1 after a seek (ioLoaderOptions.preload): every answer is complete
  const tr = box.tgRange, MB = 1048576, SZ = 50 * MB + 12345;
  [0, 7, MB, 3 * MB + 333].forEach((x) => { const r = tr('bytes=' + x + '-' + (x + MB), SZ); ok(r && r.start === x && r.end === x + MB, 'tgRange gives the full 1 MiB+1 at ' + x); });
  const tail = tr('bytes=' + (SZ - 100) + '-' + (SZ - 100 + MB), SZ);
  ok(tail && tail.end === SZ - 1, 'tgRange at the file tail ends at the last byte');
  ok(tr('bytes=0-' + (5 * MB - 1), SZ).end === 2 * MB - 1, 'a 5 MiB ask is capped at 2 MiB (why compat.js asks 1 MiB)');
  ok(/\(e\.request\.method === 'GET' \|\| e\.request\.method === 'HEAD'\) && \/\\\/tgstream/.test(src0()) && /req\.method === 'HEAD'\) return new Response\(null, \{status: 200/.test(src0()), 'HEAD on /tgstream/ is answered from info (size, no body)');
  // the handler: no race for a query (the update check) or a Range request; a navigation falls back to index.html
  const src = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');
  ok(/if \(\(u\.search && !nav\) \|\| e\.request\.headers\.has\('range'\)\) \{ e\.respondWith\(net\.catch\(offline\)\); return; \}/.test(src), 'a request with a query or a Range header is not raced');
  ok(/nav \? caches\.match\('index\.html'\) : undefined/.test(src) && /e\.waitUntil\(net\.then\(/.test(src), 'a navigation falls back to the shell; a late answer still refreshes the cache');
  console.log(fails ? 't_sw FAILED ' + fails + ' of ' + n : 't_sw OK (' + n + ' checks)');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
