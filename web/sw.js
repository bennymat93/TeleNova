// BN Stream Web: the app shell opens without a connection; catalogue, streams and pictures always come from the network.
// The cache name follows WEB_VERSION (version.js), so a new version replaces the old cache by itself.
// The Telegram client (vendor/gramjs-*.js, 0.7 MB) is not part of the shell: only a viewer who connects fetches it,
// and Telegram cannot work offline anyway (it is cached like any other file once it was fetched).
// WP-3 (Telegram playback): the Range proxy for /tgstream/ below; nobody else edits this file.
importScripts('version.js');
const CACHE = 'bn-web-' + self.WEB_VERSION;
const SHELL = ['./', 'index.html', 'style.css', 'version.js', 'i18n.js', 'shell_core.js', 'app.js', 'osk.js', 'syncdoc.js', 'store.js', 'twins.js', 'websync.js', 'sealed.js', 'tg.js',
               'channels_il.json', 'icon.png', 'icon-180.png', 'icon-192.png', 'manifest.webmanifest'];
// every module file of the plan (web_plan.md section 3). Precached when it exists; a file a package has not written
// yet is skipped without failing the install.
const MODULES = ['tglogin.js', 'matcher.js', 'epmatch.js', 'tgsearch.js', 'telegram.js', 'tgplay.js', 'catalog.js', 'sources.js',
                 'player.js', 'compat.js', 'rd.js', 'srt.js', 'subs.js', 'iptv.js', 'epg.js', 'radio.js', 'yt.js', 'topics.js', 'hub.js',
                 'services.js', 'library.js', 'backup.js', 'result.js', 'aio.js', 'srcedit.js', 'aisubs.js', 'gdrive.js', 'help.js', 'status.js', 'helper.js', 'icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, {cache: 'reload'}))).then(() => Promise.all(MODULES.map((m) => c.add(new Request(m, {cache: 'reload'})).catch(() => {})))))
  );
  // 5.0: no skipWaiting() here. A new version waits until the page asks for it (the "new version - reload" notice of
  // app.js posts SKIP_WAITING), so an open tab never runs old page code against new module files. A first install
  // has nothing to wait for and takes over at once (clients.claim below).
});
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// ---------------------------------------------------------------- Telegram playback (WP-3)
// <video src=".../tgstream/<key>"> : the SW answers each Range request with a 206 built from bytes the page sends over
// a MessageChannel (the page owns the GramJS client; tgplay.js). <key> is a random id the page made - no Telegram
// data is in the address. No page knows the key (the page reloaded or closed): 503 at once, never a hang.
const TG_CAP = 2 * 1024 * 1024;                  // bytes per answer when the browser asks for an open range (bytes=a-)
const TG_WAIT = 25000;                           // one answer from the page (Telegram may need a few seconds)
const TG_READ_WAIT = 75000;                      // 6.1.5: one read answer: a 60 s FLOOD_WAIT inside it must not end in 503
const TG_TOTAL = 90000;                          // 6.1.5: all asks of one Range request, flood waits included
// 'bytes=a-b' | 'bytes=a-' | 'bytes=-n' | none -> {start, end} (inclusive, end capped) or null (416)
function tgRange(header, size, cap) {
  cap = cap || TG_CAP;
  if (!(size > 0)) return null;
  let start = 0, end = -1;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (header && !m) return null;
  if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else if (m) { start = m[1] === '' ? 0 : Number(m[1]); end = m[2] === '' ? -1 : Number(m[2]); }
  if (start >= size || (end >= 0 && end < start)) return null;
  if (end < 0 || end >= size) end = Math.min(size - 1, start + cap - 1);
  if (end - start + 1 > cap) end = start + cap - 1;
  return {start, end};
}
function tgAsk(client, msg, wait, signal) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const done = (v) => { clearTimeout(t); if (signal) signal.removeEventListener('abort', gone); resolve(v); };
    const gone = () => done(null);               // 6.1.5: the browser dropped the request
    const t = setTimeout(() => done(null), wait || TG_WAIT);
    if (signal) { if (signal.aborted) { done(null); return; } signal.addEventListener('abort', gone); }
    ch.port1.onmessage = (ev) => done(ev.data || null);
    try { client.postMessage(msg, [ch.port2]); } catch (err) { done(null); }
  });
}
// every window is asked; the one that knows the key answers with bytes, the others with {known:false}
async function tgFirst(clients, msg, wait, signal) {
  if (!clients.length) return null;
  return new Promise((resolve) => {
    let left = clients.length, done = false;
    clients.forEach((c) => tgAsk(c, msg, wait, signal).then((r) => {
      if (done) return;
      if (r && r.known) { done = true; resolve(r); } else if (--left === 0) resolve(null);
    }));
  });
}
async function tgServe(req, key, signal) {
  const fail = (status) => new Response(null, {status, headers: {'Cache-Control': 'no-store'}});
  signal = signal || req.signal;
  if (signal && signal.aborted) return fail(499);   // 6.1.5: nobody waits for this answer any more
  const all = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
  const info = await tgFirst(all, {tgplay: 'info', key}, TG_WAIT, signal);
  if (signal && signal.aborted) return fail(499);
  if (!info || !info.ok) return fail(info && info.status ? info.status : 503);
  const size = info.size, header = req.headers.get('range');
  const r = tgRange(header || 'bytes=0-', size);
  if (!r) return new Response(null, {status: 416, headers: {'Content-Range': 'bytes */' + size}});
  // 6.1.5: rid names this request so an abort can tell the page which parts nobody needs now
  const rid = Math.random().toString(36).slice(2) + Date.now().toString(36), until = Date.now() + TG_TOTAL;
  const cancel = () => all.forEach((c) => { try { c.postMessage({tgplay: 'cancel', key, rid}); } catch (err) { /* gone */ } });
  if (signal) signal.addEventListener('abort', cancel, {once: true});
  let got;
  try {
    for (;;) {
      got = await tgFirst(all, {tgplay: 'read', key, rid, start: r.start, end: r.end}, Math.max(1000, Math.min(TG_READ_WAIT, until - Date.now())), signal);
      if (signal && signal.aborted) return fail(499);
      // 6.1.5: the page waits out a Telegram flood: ask again after it (within TG_TOTAL) instead of 503
      if (!got || got.ok || !(got.wait > 0) || Date.now() + got.wait >= until) break;
      await new Promise((res) => setTimeout(res, got.wait + 250));
      if (signal && signal.aborted) return fail(499);
    }
  } finally { if (signal) signal.removeEventListener('abort', cancel); }
  if (!got || !got.ok || !got.bytes) return fail(got && got.status ? got.status : 503);
  const body = got.bytes, len = body.byteLength;     // the page may send fewer bytes than asked (end of a part)
  if (!len) return fail(503);
  return new Response(body, {status: 206, headers: {
    'Content-Type': info.mime || 'video/mp4', 'Content-Length': String(len), 'Accept-Ranges': 'bytes',
    'Content-Range': 'bytes ' + r.start + '-' + (r.start + len - 1) + '/' + size, 'Cache-Control': 'no-store'}});
}
self.tgRange = tgRange;                          // for the tests

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  const tgm = u.origin === location.origin && e.request.method === 'GET' && /\/tgstream\/([A-Za-z0-9_-]{8,64})$/.exec(u.pathname);
  if (tgm) { e.respondWith(tgServe(e.request, tgm[1]).catch(() => new Response(null, {status: 503}))); return; }
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/api/')) return;
  // network first (a new version shows at once), the cached shell when offline
  // 6.1.7: past the browser's HTTP cache too, so a new version never stores the old files
  e.respondWith(fetch(e.request, {cache: 'no-cache'}).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, {ignoreSearch: true}).then((r) => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
