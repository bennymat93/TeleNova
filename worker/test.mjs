// node test.mjs - offline checks of the Worker with a mocked upstream fetch
import {handle, allowed, SECRET_HOSTS} from './index.js';
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
  // a secret header goes only to the hosts it belongs to (SECRET_HOSTS in index.js); every other host gets none
  const mine = SECRET_HOSTS.authorization.includes(new URL(t).host);
  ok(seen.init.headers.get('authorization') === (mine ? 'Bearer T' : null) && !seen.init.headers.get('origin'),
     mine ? '  auth passed, origin dropped' : '  auth kept back from a host it does not belong to, origin dropped');
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
const noApp = await handle(new Request('https://w.dev/tgapp', {headers: {origin: O}}), env);
ok(noApp.status === 404, 'tgapp: nothing set -> 404');
const app = await handle(new Request('https://w.dev/tgapp', {headers: {origin: O}}), Object.assign({}, env, {TG_API_ID: '12345', TG_API_HASH: '0123456789abcdef0123456789ABCDEF'}));
ok(app.status === 200 && (await app.json()).hash === '0123456789abcdef0123456789abcdef', 'tgapp: the stored details, to an allowed origin');
ok((await handle(new Request('https://w.dev/tgapp', {headers: {origin: 'https://other.io'}}), Object.assign({}, env, {TG_API_ID: '12345', TG_API_HASH: '0123456789abcdef0123456789abcdef'}))).status === 403, 'tgapp: another origin gets nothing');
ok((await handle(new Request('https://w.dev/ai', {headers: {origin: O}}), env)).status === 404, 'ai: nothing set -> 404');
const aiEnv = Object.assign({}, env, {AI_SERVER_URL: 'https://a-b-c.trycloudflare.com/', AI_SERVER_TOKEN: 'abcdefghijklmnopqrstuvwxyz012345'});
const ai = await handle(new Request('https://w.dev/ai', {headers: {origin: O}}), aiEnv);
ok(ai.status === 200 && (await ai.json()).url === 'https://a-b-c.trycloudflare.com', 'ai: the address and token, to an allowed origin');
ok((await handle(new Request('https://w.dev/ai', {headers: {origin: 'https://other.io'}}), aiEnv)).status === 403, 'ai: another origin gets nothing');
ok((await handle(new Request('https://w.dev/ai', {headers: {origin: O}}), Object.assign({}, aiEnv, {AI_SERVER_URL: 'http://192.168.1.2:8765'}))).status === 404, 'ai: an http address is never handed out');
// the drop box, with an in-memory KV
const kv = new Map(), DROP = {put: async (k, v) => { kv.set(k, v); }, get: async (k) => kv.get(k) || null, delete: async (k) => { kv.delete(k); }};
const dEnv = Object.assign({}, env, {DROP});
const put = await handle(new Request('https://w.dev/drop', {method: 'POST', headers: {origin: O}, body: new Uint8Array([1, 2, 3, 4])}), dEnv);
const dropId = (await put.json()).id;
ok(put.status === 200 && /^[0-9a-f]{32}$/.test(dropId), 'drop: a blob is taken and gets a random id');
const got1 = await handle(new Request('https://w.dev/drop/' + dropId, {headers: {origin: O}}), dEnv);
ok(got1.status === 200 && new Uint8Array(await got1.arrayBuffer()).join() === '1,2,3,4', 'drop: the other device reads it');
ok((await handle(new Request('https://w.dev/drop/' + dropId, {headers: {origin: O}}), dEnv)).status === 404, 'drop: only once');
ok((await handle(new Request('https://w.dev/drop', {method: 'POST', headers: {origin: 'https://other.io'}, body: 'x'}), dEnv)).status === 403, 'drop: another origin is refused');
ok((await handle(new Request('https://w.dev/drop', {method: 'POST', headers: {origin: O}, body: new Uint8Array(3 * 1024 * 1024 + 1)}), dEnv)).status === 413, 'drop: too large is refused');
ok((await handle(new Request('https://w.dev/drop', {method: 'POST', headers: {origin: O}, body: 'x'}), env)).status === 503, 'drop: no store configured -> 503');
const ch = 'https://w.dev/link/' + 'ab'.repeat(16);
ok((await handle(new Request(ch, {headers: {origin: O}}), dEnv)).status === 204, 'link: an empty mailbox answers 204');
ok((await handle(new Request(ch, {method: 'PUT', headers: {origin: O}, body: new Uint8Array([9, 8, 7])}), dEnv)).status === 204, 'link: a request is left');
const lg = await handle(new Request(ch, {headers: {origin: O}}), dEnv);
ok(lg.status === 200 && new Uint8Array(await lg.arrayBuffer()).join() === '9,8,7', 'link: the approving device reads it');
ok((await handle(new Request(ch, {method: 'DELETE', headers: {origin: O}}), dEnv)).status === 204 && (await handle(new Request(ch, {headers: {origin: O}}), dEnv)).status === 204, 'link: and removes it');
ok((await handle(new Request(ch, {method: 'PUT', headers: {origin: O}, body: new Uint8Array(2049)}), dEnv)).status === 413, 'link: too large is refused');
ok((await handle(new Request('https://w.dev/link/xyz', {headers: {origin: O}}), dEnv)).status === 400, 'link: a bad channel name is refused');
ok((await handle(new Request(ch, {headers: {origin: 'https://other.io'}}), dEnv)).status === 403, 'link: another origin gets nothing');
const vid = 'https://w.dev/aio/' + 'cd'.repeat(32);
ok((await handle(new Request(vid, {headers: {origin: O}}), dEnv)).status === 404, 'aio: an unknown vault -> 404');
ok((await handle(new Request(vid, {method: 'PUT', headers: {origin: O}, body: new Uint8Array([5, 6])}), dEnv)).status === 204, 'aio: a vault is saved');
const av = await handle(new Request(vid, {headers: {origin: O}}), dEnv);
ok(av.status === 200 && new Uint8Array(await av.arrayBuffer()).join() === '5,6', 'aio: and read back');
let last = 0;
for (let i = 0; i < 25; i++) last = (await handle(new Request('https://w.dev/aio/' + String(i).padStart(64, '0'), {headers: {origin: O, 'cf-connecting-ip': '1.2.3.4'}}), dEnv)).status;
ok(last === 429, 'aio: many misses from one network are stopped');
ok((await handle(new Request(vid, {headers: {origin: O, 'cf-connecting-ip': '5.6.7.8'}}), dEnv)).status === 200, 'aio: other networks are not');
ok((await handle(new Request('https://w.dev/aio/short', {headers: {origin: O}}), dEnv)).status === 400, 'aio: a malformed address is refused');
ok((await handle(new Request(vid, {headers: {origin: 'https://other.io'}}), dEnv)).status === 403, 'aio: another origin gets nothing');
const pg = await handle(new Request('https://w.dev/ping', {headers: {origin: O}}), env);
ok((await pg.json()).app === 'telenova-helper', 'ping');
console.log(fails ? 'WORKER TESTS FAILED ' + fails : 'WORKER TESTS OK'); process.exit(fails ? 1 : 0);
