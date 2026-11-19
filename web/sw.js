// BN Stream Web: the app shell opens without a connection; catalogue, streams and pictures always come from the network.
// The cache name follows WEB_VERSION (version.js), so a new version replaces the old cache by itself.
// The Telegram client (vendor/gramjs-*.js, 0.7 MB) is not part of the shell: only a viewer who connects fetches it,
// and Telegram cannot work offline anyway (it is cached like any other file once it was fetched).
// WP-3 (Telegram playback): the Range proxy for /tgstream/ below; nobody else edits this file.
importScripts('version.js');
const CACHE = 'bn-web-' + self.WEB_VERSION;
const SHELL = ['./', 'index.html', 'style.css', 'version.js', 'i18n.js', 'shell_core.js', 'app.js', 'syncdoc.js', 'store.js', 'websync.js', 'sealed.js', 'tg.js',
               'channels_il.json', 'icon.png', 'icon-180.png', 'icon-192.png', 'manifest.webmanifest'];
// every module file of the plan (web_plan.md section 3). Precached when it exists; a file a package has not written
// yet is skipped without failing the install.
const MODULES = ['tglogin.js', 'matcher.js', 'epmatch.js', 'tgsearch.js', 'telegram.js', 'tgplay.js', 'catalog.js', 'sources.js',
                 'player.js', 'compat.js', 'rd.js', 'srt.js', 'subs.js', 'iptv.js', 'epg.js', 'radio.js', 'yt.js', 'topics.js', 'hub.js',
                 'services.js', 'library.js', 'backup.js', 'result.js', 'aio.js', 'srcedit.js', 'gdrive.js', 'help.js', 'status.js', 'helper.js', 'icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).then(() => Promise.all(MODULES.map((m) => c.add(m).catch(() => {})))))
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
function tgAsk(client, msg) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), TG_WAIT);
    ch.port1.onmessage = (ev) => { clearTimeout(t); resolve(ev.data || null); };
    try { client.postMessage(msg, [ch.port2]); } catch (err) { clearTimeout(t); resolve(null); }
  });
}
// every window is asked; the one that knows the key answers with bytes, the others with {known:false}
async function tgFirst(clients, msg) {
  if (!clients.length) return null;
  return new Promise((resolve) => {
    let left = clients.length, done = false;
    clients.forEach((c) => tgAsk(c, msg).then((r) => {
      if (done) return;
      if (r && r.known) { done = true; resolve(r); } else if (--left === 0) resolve(null);
    }));
  });
}
async function tgServe(req, key) {
  const fail = (status) => new Response(null, {status, headers: {'Cache-Control': 'no-store'}});
  const all = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
  const info = await tgFirst(all, {tgplay: 'info', key});
  if (!info || !info.ok) return fail(info && info.status ? info.status : 503);
  const size = info.size, header = req.headers.get('range');
  const r = tgRange(header || 'bytes=0-', size);
  if (!r) return new Response(null, {status: 416, headers: {'Content-Range': 'bytes */' + size}});
  const got = await tgFirst(all, {tgplay: 'read', key, start: r.start, end: r.end});
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
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, {ignoreSearch: true}).then((r) => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
