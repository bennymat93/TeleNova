// BN Stream Web 4.2: the app shell opens without a connection; catalogue, streams and pictures always come from the network.
// The Telegram client (vendor/gramjs-*.js, 0.7 MB) is not part of the shell: only a viewer who connects fetches it,
// and Telegram cannot work offline anyway (it is cached like any other file once it was fetched).
const CACHE = 'bn-web-4.2.0';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'syncdoc.js', 'store.js', 'websync.js', 'sealed.js', 'tg.js', 'channels_il.json',
               'icon.png', 'icon-192.png', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/api/')) return;
  // network first (a new version shows at once), the cached shell when offline
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, {ignoreSearch: true}).then((r) => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
