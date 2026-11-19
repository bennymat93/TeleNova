// TeleNova optional helper Worker (WP-10).
// A tiny CORS relay for the few services the web app cannot reach directly from a browser.
// - Only allowlisted https hosts (and, for YouTube, only the youtubei/v1 paths).
// - Stores nothing, logs nothing (no console.log of requests, headers or bodies).
// - The target URL comes in the X-TN-Target header, never in the query, so tokens never land in access logs.
// - Only the configured origins may call it: https://bennymat93.github.io plus any in ALLOW_ORIGINS (added, not replacing).
// - Secret headers go only to the hosts they belong to (SECRET_HOSTS); the cookie relay only to www.ktuvit.me.
'use strict';

const DEFAULT_ORIGINS = ['https://bennymat93.github.io'];

// host -> optional path prefixes (null = any path)
const ALLOW = {
  'api.real-debrid.com': null,
  'stremthru.13377001.xyz': null,
  'stremthru.elfhosted.com': null,
  'www.ktuvit.me': null,
  'epgshare01.online': null,
  'www.youtube.com': ['/youtubei/v1/'],
  'youtubei.googleapis.com': ['/youtubei/v1/'],
};

// request headers passed through to the target (everything else is dropped)
const PASS_REQ = ['authorization', 'content-type', 'accept', 'accept-language', 'range', 'x-goog-api-key',
  'x-youtube-client-name', 'x-youtube-client-version', 'x-stremthru-authorization'];
// response headers passed back
const PASS_RES = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-encoding',
  'cache-control', 'etag', 'last-modified', 'retry-after'];
// secret request headers -> the only hosts that may receive them (an ALLOW_HOSTS host never gets them)
const SECRET_HOSTS = {
  'authorization': ['api.real-debrid.com', 'stremthru.13377001.xyz', 'stremthru.elfhosted.com'],
  'x-stremthru-authorization': ['stremthru.13377001.xyz', 'stremthru.elfhosted.com'],
  'x-goog-api-key': ['www.youtube.com', 'youtubei.googleapis.com'],
};
const COOKIE_HOSTS = ['www.ktuvit.me'];
const MAX_BODY = 5 * 1024 * 1024;

function origins(env) {
  const extra = String((env && env.ALLOW_ORIGINS) || '').split(',').map(s => s.trim()).filter(Boolean);
  return DEFAULT_ORIGINS.concat(extra.filter(o => !DEFAULT_ORIGINS.includes(o)));
}
function extraHosts(env) {
  return String((env && env.ALLOW_HOSTS) || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function cors(origin, okOrigins) {
  const h = new Headers();
  if (okOrigins.includes(origin)) h.set('Access-Control-Allow-Origin', origin);
  h.set('Vary', 'Origin');
  h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, HEAD, OPTIONS');
  h.set('Access-Control-Allow-Headers', ['x-tn-target', 'x-tn-cookie'].concat(PASS_REQ).join(', '));
  h.set('Access-Control-Expose-Headers', PASS_RES.concat(['x-tn-set-cookie', 'x-tn-status']).join(', '));
  h.set('Access-Control-Max-Age', '86400');
  return h;
}

function fail(status, code, origin, okOrigins) {
  const h = cors(origin, okOrigins);
  h.set('content-type', 'application/json');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify({error: code}), {status, headers: h});
}

export function allowed(target, env) {
  let u;
  try { u = new URL(target); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  const host = u.hostname.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ALLOW, host)) {
    const paths = ALLOW[host];
    if (paths && !paths.some(p => u.pathname.startsWith(p))) return null;
    return u;
  }
  if (extraHosts(env).includes(host)) return u;
  return null;
}

export {SECRET_HOSTS, COOKIE_HOSTS};

export async function handle(request, env) {
  const okOrigins = origins(env);
  const origin = request.headers.get('origin') || '';
  if (!okOrigins.includes(origin)) return fail(403, 'origin', origin, okOrigins);
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(origin, okOrigins)});

  const url = new URL(request.url);
  if (url.pathname === '/ping') {
    const h = cors(origin, okOrigins); h.set('content-type', 'application/json'); h.set('cache-control', 'no-store');
    return new Response(JSON.stringify({ok: true, app: 'telenova-helper', v: 1}), {headers: h});
  }
  // the Telegram application details that come with the build, for the site's sign-in page. Set by the owner as
  // secrets (wrangler secret put TG_API_ID / TG_API_HASH) - never in the repository. Only allowed origins get here.
  if (url.pathname === '/tgapp') {
    const h = cors(origin, okOrigins); h.set('content-type', 'application/json'); h.set('cache-control', 'no-store');
    const id = String(env.TG_API_ID || '').trim(), hash = String(env.TG_API_HASH || '').trim().toLowerCase();
    if (!/^\d{3,12}$/.test(id) || !/^[0-9a-f]{32}$/.test(hash)) return new Response(JSON.stringify({error: 'not_set'}), {status: 404, headers: h});
    return new Response(JSON.stringify({id, hash}), {headers: h});
  }
  // where the owner's AI subtitle server is reachable over https right now, and its access token. Both are stored by
  // the PC itself each time its tunnel starts (kodi-build/server/tunnel.py -> wrangler secret put AI_SERVER_URL /
  // AI_SERVER_TOKEN). Only allowed origins get here.
  if (url.pathname === '/ai') {
    const h = cors(origin, okOrigins); h.set('content-type', 'application/json'); h.set('cache-control', 'no-store');
    const at = String(env.AI_SERVER_URL || '').trim().replace(/\/+$/, ''), tok = String(env.AI_SERVER_TOKEN || '').trim();
    if (!/^https:\/\/[a-z0-9.-]+$/i.test(at) || !/^[\w-]{20,80}$/.test(tok)) return new Response(JSON.stringify({error: 'not_set'}), {status: 404, headers: h});
    return new Response(JSON.stringify({url: at, token: tok}), {headers: h});
  }
  const target = allowed(request.headers.get('x-tn-target') || '', env);
  if (!target) return fail(403, 'host', origin, okOrigins);

  const fwd = new Headers();
  const host = target.hostname.toLowerCase();
  for (const k of PASS_REQ) {
    const v = request.headers.get(k);
    if (!v) continue;
    if (SECRET_HOSTS[k] && !SECRET_HOSTS[k].includes(host)) continue;   // a secret never leaves for another host
    fwd.set(k, v);
  }
  const ck = request.headers.get('x-tn-cookie');
  if (ck && COOKIE_HOSTS.includes(host)) fwd.set('cookie', ck);
  fwd.set('user-agent', 'Mozilla/5.0 (TeleNova helper)');

  let body;
  if (!['GET', 'HEAD'].includes(request.method)) {
    const len = Number(request.headers.get('content-length') || 0);
    if (len > MAX_BODY) return fail(413, 'too_large', origin, okOrigins);
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY) return fail(413, 'too_large', origin, okOrigins);
  }

  let res;
  try {
    res = await fetch(target.toString(), {method: request.method, headers: fwd, body, redirect: 'manual'});
  } catch (e) {
    return fail(502, 'upstream', origin, okOrigins);
  }
  const h = cors(origin, okOrigins);
  for (const k of PASS_RES) { const v = res.headers.get(k); if (v) h.set(k, v); }
  // cookies (ktuvit login) go back as a readable header; the browser cannot store third-party cookies anyway
  const sc = !COOKIE_HOSTS.includes(host) ? [] : typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (sc.length) h.set('x-tn-set-cookie', sc.map(c => c.split(';')[0]).join('; '));
  // redirects: only follow to an allowlisted host, else report it
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location') || '';
    let next = null;
    try { next = allowed(new URL(loc, target).toString(), env); } catch (e) { next = null; }
    h.set('x-tn-status', String(res.status));
    h.set('cache-control', 'no-store');
    h.set('content-type', 'application/json');
    return new Response(JSON.stringify({redirect: next ? next.toString() : null}), {status: 200, headers: h});
  }
  if (!h.has('cache-control')) h.set('cache-control', 'no-store');
  return new Response(res.body, {status: res.status, headers: h});
}

export default {fetch: (request, env) => handle(request, env)};
