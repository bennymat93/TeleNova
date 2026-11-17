// node test.mjs - offline checks of the Worker with a mocked upstream fetch
import {handle, allowed} from './index.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const O = 'https://bennymat93.github.io', env = {ALLOW_ORIGINS: O, ALLOW_HOSTS: ''};
let seen = null;
globalThis.fetch = async (u, init) => { seen = {u, init};
  if (u.includes('redir')) return new Response(null, {status: 302, headers: {location: 'https://evil.example/x'}});
  return new Response('{"x":1}', {status: 200, headers: {'content-type': 'application/json', 'set-cookie': 'a=1; Path=/'}}); };
const req = (t, o = {}) => new Request('https://w.dev/p', {method: o.m || 'GET', headers: Object.assign({origin: O}, t ? {'x-tn-target': t} : {}, o.h || {}), body: o.b});
for (const t of ['https://api.real-debrid.com/rest/1.0/user', 'https://stremthru.13377001.xyz/v0/store/user',
  'https://www.ktuvit.me/Services/x', 'https://epgshare01.online/epgshare01/epg_ripper_IL1.xml.gz',
  'https://www.youtube.com/youtubei/v1/search']) {
  const r = await handle(req(t, {h: {authorization: 'Bearer T'}}), env);
  ok(r.status === 200 && r.headers.get('access-control-allow-origin') === O, 'allowed ' + new URL(t).host);
  ok(seen.init.headers.get('authorization') === 'Bearer T' && !seen.init.headers.get('origin'), '  auth passed, origin dropped');
}
ok((await handle(req('https://www.ktuvit.me/x'), env)).headers.get('x-tn-set-cookie') === 'a=1', 'set-cookie exposed');
for (const t of ['https://evil.example/', 'http://api.real-debrid.com/x', 'https://www.youtube.com/watch?v=1',
  'https://api.real-debrid.com.evil.com/', 'https://u:p@api.real-debrid.com/', 'https://api.real-debrid.com:8443/', '']) {
  const r = await handle(req(t), env);
  ok(r.status === 403 && r.headers.get('access-control-allow-origin') === O, 'rejected ' + (t || '(none)'));
}
ok((await handle(new Request('https://w.dev/p', {headers: {origin: 'https://other.io', 'x-tn-target': 'https://api.real-debrid.com/'}}), env)).status === 403, 'other origin rejected');
const pre = await handle(new Request('https://w.dev/p', {method: 'OPTIONS', headers: {origin: O}}), env);
ok(pre.status === 204 && /x-tn-target/.test(pre.headers.get('access-control-allow-headers')), 'preflight');
const rd = await handle(req('https://api.real-debrid.com/redir'), env);
ok(rd.headers.get('x-tn-status') === '302' && (await rd.json()).redirect === null, 'redirect to non-allowlisted host blocked');
ok(allowed('https://my.st.io/x', {ALLOW_HOSTS: 'my.st.io'}) !== null, 'ALLOW_HOSTS extra host');
const pg = await handle(new Request('https://w.dev/ping', {headers: {origin: O}}), env);
ok((await pg.json()).app === 'telenova-helper', 'ping');
console.log(fails ? 'WORKER TESTS FAILED ' + fails : 'WORKER TESTS OK'); process.exit(fails ? 1 : 0);
