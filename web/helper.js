'use strict';
// TeleNova web: client for the optional helper Worker (WP-10, see worker/README.md).
// Usage (from any module):  await TN.loadScript('helper.js');  const r = await self.TNHelper.fetch(url, opts);
//   opts: {method, headers, body, cookie, via: 'auto'|'direct'|'helper', timeout(ms), signal}
//   Returns a normal Response. Throws Error with .code === 'needs_helper' when the host has no CORS and no helper
//   URL is set, .code === 'helper_refused' when the Worker rejects the host/origin.
// Tokens go only in headers; the target URL travels in the X-TN-Target header, never in a query. Nothing is logged.
(function (G) {
  // hosts known to have no browser CORS: go straight through the helper (or fail fast with needs_helper)
  const NO_CORS = ['api.real-debrid.com', 'stremthru.13377001.xyz', 'stremthru.elfhosted.com', 'www.ktuvit.me',
    'epgshare01.online', 'www.youtube.com', 'youtubei.googleapis.com'];
  const directFailed = new Set();   // hosts whose direct fetch failed in this session

  function helperUrl() {
    try {
      const TN = G.TN;
      const u = TN && TN.settings && TN.settings.helper ? TN.settings.helper() : '';
      return /^https:\/\//i.test(u || '') ? String(u).replace(/\/+$/, '') : '';
    } catch (e) { return ''; }
  }
  function err(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
  function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ''; } }
  function needsHelper(url) { const h = hostOf(url); return NO_CORS.includes(h) || directFailed.has(h); }

  function withTimeout(opts) {
    const ms = opts.timeout || 20000;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    if (opts.signal) opts.signal.addEventListener('abort', () => ctl.abort(), {once: true});
    return {signal: ctl.signal, done: () => clearTimeout(t)};
  }

  async function viaHelper(base, url, opts, hops) {
    const headers = new Headers(opts.headers || {});
    headers.set('X-TN-Target', url);
    if (opts.cookie) headers.set('X-TN-Cookie', opts.cookie);
    const to = withTimeout(opts);
    let r;
    try {
      r = await fetch(base + '/p', {method: opts.method || 'GET', headers, body: opts.body, signal: to.signal,
        credentials: 'omit', cache: 'no-store'});
    } finally { to.done(); }
    if (r.status === 403) {
      let code = '';
      try { code = (await r.clone().json()).error; } catch (e) { /* not json */ }
      if (code === 'host' || code === 'origin') throw err('helper_refused', 'helper refused: ' + code);
    }
    if (r.headers.get('x-tn-status')) {          // upstream redirect, reported by the Worker
      let next = null;
      try { next = (await r.json()).redirect; } catch (e) { next = null; }
      if (!next || hops >= 4) throw err('redirect', 'redirect not allowed');
      const m = (opts.method || 'GET').toUpperCase();
      const keep = m === 'GET' || m === 'HEAD';
      return viaHelper(base, next, Object.assign({}, opts, keep ? {} : {method: 'GET', body: undefined}), hops + 1);
    }
    return r;
  }

  async function hfetch(url, opts) {
    opts = opts || {};
    if (!/^https:\/\//i.test(String(url))) throw err('bad_url', 'https only');
    const base = helperUrl();
    const via = opts.via || 'auto';
    if (via === 'helper' || (via === 'auto' && needsHelper(url))) {
      if (!base) throw err('needs_helper', 'needs helper');
      return viaHelper(base, url, opts, 0);
    }
    const to = withTimeout(opts);
    try {
      return await fetch(url, {method: opts.method || 'GET', headers: opts.headers, body: opts.body,
        signal: to.signal, credentials: 'omit'});
    } catch (e) {
      if (e && e.name === 'AbortError' && !(opts.signal && opts.signal.aborted)) throw err('timeout', 'timeout');
      if (opts.signal && opts.signal.aborted) throw e;
      if (via === 'direct') throw e;
      // TypeError: CORS or network. Remember the host and try the helper.
      directFailed.add(hostOf(url));
      if (!base) throw err('needs_helper', 'needs helper');
      return viaHelper(base, url, opts, 0);
    } finally { to.done(); }
  }

  async function ping(base) {
    base = base ? String(base).replace(/\/+$/, '') : helperUrl();
    if (!/^https:\/\//i.test(base)) return false;
    try {
      const r = await fetch(base + '/ping', {credentials: 'omit', cache: 'no-store'});
      const j = await r.json();
      return !!(j && j.ok && j.app === 'telenova-helper');
    } catch (e) { return false; }
  }

  G.TNHelper = Object.freeze({
    fetch: hfetch,
    ping,
    url: helperUrl,
    has: () => !!helperUrl(),
    needsHelper,
    NO_CORS: Object.freeze(NO_CORS.slice()),
  });
})(self);
