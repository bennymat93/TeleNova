'use strict';
// WP-3 Telegram playback: plays a Telegram video in the page's own <video> without downloading it first.
// The service worker (sw.js) turns each Range request of the <video> for ".../tgstream/<key>" into a message to this
// page; this page reads the needed 512 KB parts through the signed-in GramJS client (TG.client(), WP-1) and answers.
// <key> is a random id made here: no chat, message, file id or session is ever in an address.
//
// Service `tgplay` (TN.provider('tgplay')):
//   open(ref)          ref = {peer, msg} (peer: anything client.getEntity takes - numeric id, '-100...', '@name') or
//                      {message} (a GramJS Message with a document). -> {url, mime, size, name, key, playable, tgLink}
//                      Rejects with Error('TGPLAY_NO_SW') when no service worker controls the page (use fallback()),
//                      'TGPLAY_NO_FILE' when the message has no document, or the TG.client() codes (TG_NO_LOGIN ...).
//   openSource({size, mime, name, readPart(index, partSize) -> Uint8Array}) -> same shape; any part source (tests).
//   close(keyOrUrl), closeAll()   stop serving a stream (call when video.src changes)
//   playable(mime) -> 'yes' | 'maybe' | 'no'        what this browser says about the type
//   check(video, ms) -> Promise<'ok' | 'fail'>     after setting video.src: did it really start (codec / MKV / HEVC)
//   fallback(ref) -> {kind:'blob', url, revoke()} for files under 300 MB, else {kind:'link', url} (open in Telegram)
//   tgLink(peer, msg) -> 'https://t.me/...' or ''
//   stats() -> {streams, cached}   (for the status page)
(function (TN) {
  const PART = 512 * 1024;                       // Telegram: offset and limit multiples of 4096, no 1 MiB crossing
  const CACHE_PARTS = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 12 : 24;   // 6 MB on iOS, 12 MB elsewhere
  const AHEAD = 3, PARALLEL = 4, BLOB_MAX = 300 * 1024 * 1024, MAX_STREAMS = 4;
  const streams = new Map();                     // key -> {size, mime, name, readPart, peer, msg}
  const cache = new Map();                       // 'key:index' -> Uint8Array, kept in use order (LRU)
  const pending = new Map();                     // 'key:index' -> Promise<Uint8Array>
  let active = 0; const queue = [];

  TN.i18n.add({
    he: {tgplay_nosw: 'הדפדפן לא מאפשר הזרמה מטלגרם כאן', tgplay_codec: 'הדפדפן לא מצליח לנגן את הקובץ הזה (MKV / HEVC / AC3 מתנגנים לרוב רק ב-Kodi)',
      tgplay_open_tg: 'פתח בטלגרם', tgplay_download: 'הורד ונגן', tgplay_nofile: 'בהודעה אין קובץ וידאו'},
    en: {tgplay_nosw: 'This browser cannot stream from Telegram here', tgplay_codec: 'This browser cannot play this file (MKV / HEVC / AC3 usually play only in Kodi)',
      tgplay_open_tg: 'Open in Telegram', tgplay_download: 'Download and play', tgplay_nofile: 'The message has no video file'},
    ru: {tgplay_nosw: 'Этот браузер не может транслировать из Telegram', tgplay_codec: 'Браузер не может воспроизвести этот файл (MKV / HEVC / AC3 обычно играют только в Kodi)',
      tgplay_open_tg: 'Открыть в Telegram', tgplay_download: 'Скачать и смотреть', tgplay_nofile: 'В сообщении нет видеофайла'},
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fail = (code) => { const e = new Error(code); e.code = code; return e; };
  function newKey() { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
  function streamUrl(key) { return new URL('tgstream/' + key, location.href.split('#')[0]).href; }
  function limit(fn) {                           // at most PARALLEL Telegram requests at a time (FLOOD_WAIT)
    return new Promise((res, rej) => {
      const run = () => { active++; fn().then(res, rej).finally(() => { active--; const n = queue.shift(); if (n) n(); }); };
      if (active < PARALLEL) run(); else queue.push(run);
    });
  }

  // ---------------------------------------------------------------- the part cache
  function remember(id, bytes) {
    cache.delete(id); cache.set(id, bytes);
    while (cache.size > CACHE_PARTS) cache.delete(cache.keys().next().value);
  }
  function part(key, s, i) {
    const id = key + ':' + i;
    if (cache.has(id)) { const b = cache.get(id); remember(id, b); return Promise.resolve(b); }
    if (pending.has(id)) return pending.get(id);
    const p = limit(() => s.readPart(i, PART)).then((b) => {
      b = b instanceof Uint8Array ? b : new Uint8Array(b);
      if (streams.get(key) === s) remember(id, b);
      return b;
    }).finally(() => pending.delete(id));
    pending.set(id, p);
    return p;
  }
  // bytes [start, end] (inclusive), possibly fewer when the range crosses many parts (the browser asks again)
  async function read(key, start, end) {
    const s = streams.get(key);
    if (!s) throw fail('TGPLAY_GONE');
    end = Math.min(end, s.size - 1, start + 4 * PART - 1);
    const first = Math.floor(start / PART), last = Math.floor(end / PART);
    const idx = []; for (let i = first; i <= last; i++) idx.push(i);
    const parts = await Promise.all(idx.map((i) => part(key, s, i)));
    const lastPart = Math.floor((s.size - 1) / PART);
    for (let i = last + 1; i <= Math.min(last + AHEAD, lastPart); i++) part(key, s, i).catch(() => {});   // read ahead
    const out = new Uint8Array(end - start + 1);
    let at = 0;
    parts.forEach((b, n) => {
      const base = (first + n) * PART, from = Math.max(start - base, 0), to = Math.min(end - base + 1, b.length);
      if (to > from) { out.set(b.subarray(from, to), at); at += to - from; }
    });
    return at === out.length ? out : out.subarray(0, at);
  }

  // ---------------------------------------------------------------- the service worker side
  function onMessage(ev) {
    const d = ev.data, port = ev.ports && ev.ports[0];
    if (!d || !port || (d.tgplay !== 'info' && d.tgplay !== 'read')) return;
    const s = streams.get(d.key);
    if (!s) { port.postMessage({known: false}); return; }
    if (d.tgplay === 'info') { port.postMessage({known: true, ok: true, size: s.size, mime: s.mime}); return; }
    read(d.key, d.start, d.end).then((b) => {
      const buf = b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.slice().buffer;
      port.postMessage({known: true, ok: true, bytes: buf}, [buf]);
    }, () => port.postMessage({known: true, ok: false, status: 502}));
  }
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', onMessage);

  async function swReady() {
    const sw = navigator.serviceWorker;
    if (!sw || !window.isSecureContext) return false;
    if (sw.controller) return true;
    try { if (!(await sw.getRegistration())) await sw.register('sw.js'); } catch (e) { return false; }
    // the first visit is not controlled until the worker claims the page
    return new Promise((res) => {
      const t = setTimeout(() => res(!!sw.controller), 4000);
      sw.addEventListener('controllerchange', () => { clearTimeout(t); res(true); }, {once: true});
    });
  }

  function register(src) {
    while (streams.size >= MAX_STREAMS) close(streams.keys().next().value);
    const key = newKey();
    streams.set(key, src);
    return {key, url: streamUrl(key), size: src.size, mime: src.mime, name: src.name || '', playable: playable(src.mime)};
  }
  async function openSource(src) {
    if (!src || !(src.size > 0) || typeof src.readPart !== 'function') throw fail('TGPLAY_BAD_SOURCE');
    if (!(await swReady())) throw fail('TGPLAY_NO_SW');
    return register({size: Number(src.size), mime: src.mime || 'video/mp4', name: src.name || '', readPart: src.readPart});
  }
  function close(k) {
    const key = String(k || '').replace(/^.*\/tgstream\//, '');
    if (!streams.delete(key)) return;
    for (const id of [...cache.keys()]) if (id.startsWith(key + ':')) cache.delete(id);
  }

  // ---------------------------------------------------------------- Telegram
  function docOf(m) { const d = m && m.media && m.media.document; return d && d.className === 'Document' ? d : (d && d.id ? d : null); }
  function info(doc) {
    const attrs = doc.attributes || [];
    const fn = attrs.find((a) => a.className === 'DocumentAttributeFilename');
    let mime = String(doc.mimeType || '').toLowerCase();
    const name = fn ? fn.fileName : '';
    if (!/^(video|audio)\//.test(mime)) mime = /\.mkv$/i.test(name) ? 'video/x-matroska' : /\.webm$/i.test(name) ? 'video/webm' : 'video/mp4';
    return {mime, name, size: Number(String(doc.size))};
  }
  function bigOf(doc, n) { return doc.size.multiply(0).add(n); }   // a GramJS big-integer (the bundle does not export the constructor)
  function errCode(e) { return e && typeof e.errorMessage === 'string' ? e.errorMessage : ''; }

  async function tgSource(ref) {
    const TG = await TN.tg();
    const client = await TG.client();
    const G = window.GramJS;
    let peer = ref.peer, msgId = Number(ref.msg), message = ref.message || null;
    if (message) { peer = peer || message.peerId; msgId = msgId || message.id; }
    async function fetchMsg() {
      const [m] = await client.getMessages(peer, {ids: msgId});
      return m || null;
    }
    if (!message) message = await fetchMsg();
    let doc = docOf(message);
    if (!doc) throw fail('TGPLAY_NO_FILE');
    const meta = info(doc);
    async function readPart(i, size) {
      for (let tries = 0; ; tries++) {
        try {
          const it = client.iterDownload({file: new G.Api.InputDocumentFileLocation({id: doc.id, accessHash: doc.accessHash,
            fileReference: doc.fileReference, thumbSize: ''}), dcId: doc.dcId, fileSize: doc.size,
          offset: bigOf(doc, i * size), requestSize: size, chunkSize: size, limit: 1});
          for await (const chunk of it) return new Uint8Array(chunk);
          return new Uint8Array(0);
        } catch (e) {
          const code = errCode(e);
          if (tries >= 3) throw e;
          if (/^FILE_REFERENCE_/.test(code)) { const m = await fetchMsg(); const d = docOf(m); if (!d) throw e; doc = d; continue; }
          if (/FLOOD/.test(code) && e.seconds) { await sleep(Math.min(Number(e.seconds), 60) * 1000); continue; }
          if (!code) { await sleep(800 * (tries + 1)); continue; }   // network hiccup
          throw e;
        }
      }
    }
    return Object.assign(meta, {readPart, peer, msg: msgId});
  }
  async function open(ref) {
    if (!ref) throw fail('TGPLAY_NO_FILE');
    if (!(await swReady())) throw fail('TGPLAY_NO_SW');
    const src = await tgSource(ref);
    const h = register(src);
    h.tgLink = tgLink(src.peer, src.msg);
    return h;
  }

  // ---------------------------------------------------------------- what plays, and what to do when it does not
  function playable(mime) {
    const v = document.createElement('video');
    const r = v.canPlayType(mime || 'video/mp4');
    if (r === 'probably') return 'yes';
    if (r === 'maybe') return 'maybe';
    return /matroska/.test(mime) && /Chrome|Firefox/.test(navigator.userAgent) && !/Edg\/|iPhone|iPad/.test(navigator.userAgent) ? 'maybe' : 'no';
  }
  function check(video, ms) {
    return new Promise((res) => {
      let done = false;
      const end = (r) => { if (done) return; done = true; clearTimeout(t); video.removeEventListener('error', bad); video.removeEventListener('loadedmetadata', meta); res(r); };
      const bad = () => end('fail');
      const meta = () => end(video.videoWidth > 0 || /audio/.test(video.currentSrc) ? 'ok' : 'fail');
      const t = setTimeout(() => end(video.readyState >= 1 && video.videoWidth > 0 ? 'ok' : 'fail'), ms || 20000);
      if (video.readyState >= 1) { meta(); return; }
      video.addEventListener('error', bad); video.addEventListener('loadedmetadata', meta);
    });
  }
  function tgLink(peer, msg) {
    const p = String(peer && (peer.username || peer.channelId || peer) || '');
    if (!msg) return '';
    if (/^@?[A-Za-z][A-Za-z0-9_]{3,}$/.test(p)) return 'https://t.me/' + p.replace(/^@/, '') + '/' + msg;
    const id = p.replace(/^-100/, '');
    return /^\d+$/.test(id) ? 'https://t.me/c/' + id + '/' + msg : '';
  }
  async function fallback(ref) {
    const src = ref.readPart ? ref : await tgSource(ref);
    const link = tgLink(src.peer, src.msg);
    if (src.size > BLOB_MAX) return {kind: 'link', url: link};
    const n = Math.ceil(src.size / PART), parts = [];
    for (let i = 0; i < n; i += PARALLEL) {
      const idx = []; for (let j = i; j < Math.min(n, i + PARALLEL); j++) idx.push(j);
      parts.push(...(await Promise.all(idx.map((j) => limit(() => src.readPart(j, PART))))));
    }
    const url = URL.createObjectURL(new Blob(parts, {type: src.mime}));
    return {kind: 'blob', url, link, revoke: () => URL.revokeObjectURL(url)};
  }

  const api = {kinds: ['service'], label: 'Telegram playback', open, openSource, close,
    closeAll: () => [...streams.keys()].forEach(close), playable, check, fallback, tgLink,
    stats: () => ({streams: streams.size, cached: cache.size}), PART};
  TN.registerProvider('tgplay', api);
})(self.TN);
