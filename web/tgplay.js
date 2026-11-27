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
//   open(ref, {onEvent})  onEvent({type: 'read', bytes, total} | {type: 'flood', seconds, text} | {type: 'error', code, text})
//   status(keyOrUrl) -> {size, read, cached, lastError, wait}   how a stream is doing
//   errorText(error) -> a text for the viewer (not signed in, another tab, private chat, flood wait, no service worker...)
//   probe(ref | {key}) -> {head (first 256 KB), mbit, size, mime, name}   the link test of the sources screen
//   fallback(ref | {key}, {signal, onProgress(percent)})   as above, with progress and a way to stop
//   save(ref | {key}, {signal, onProgress}) -> {saved, name}   the way out for MKV / HEVC / AC3 files the browser cannot
//                      decode: to the device (straight to disk in Chromium, any size; a normal download up to 300 MB
//                      elsewhere, else Error TGPLAY_TOO_BIG), to open in VLC or Kodi there
//   Matroska files are answered to the <video> as video/webm in Chromium (its WebM reader plays MKV with H.264 / VP9 +
//   AAC / Opus); what cannot be decoded is the player's business (it reads the file header through probe()).
//   stats() -> {streams, cached}   (for the status page)
(function (TN) {
  const PART = 512 * 1024;                       // Telegram: offset and limit multiples of 4096, no 1 MiB crossing
  // 6.1.6: room for 30-60 s of read-ahead: 16 MB on iOS (memory), 64 MB elsewhere
  const CACHE_PARTS = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 32 : 128;
  const PART_TIMEOUT = 15000;                    // 6.1.5: one Telegram part read, then it counts as a hiccup
  const AHEAD = 3, PARALLEL = 4, BLOB_MAX = 300 * 1024 * 1024, MAX_STREAMS = 4;
  const RATE_GUESS = 4e6;                        // 6.1.6: bits/s of a file whose duration is unknown
  let lowActive = 0;                             // 6.1.6: read-ahead reads running (one slot stays for needed parts)
  const streams = new Map();                     // key -> {size, mime, name, readPart, peer, msg}
  const cache = new Map();                       // 'key:index' -> Uint8Array, kept in use order (LRU)
  const pending = new Map();                     // 'key:index' -> Promise<Uint8Array>
  let active = 0; const queue = [], hiQueue = [];   // 6.1.5: parts a Range request needs (hi) go before read-ahead
  const queued = new Map();                      // 6.1.5: 'key:index' -> its queue entry (promote / cancel)
  const wants = new Map();                       // 6.1.5: 'key:index' -> Range requests still waiting for it
  const reqs = new Map();                        // 6.1.5: request id from the SW -> ['key:index', ...]
  let floodUntil = 0;                            // 6.1.5: no new Telegram reads before this (FLOOD_WAIT)

  TN.i18n.add({
    he: {tgplay_nosw: 'הדפדפן לא מאפשר הזרמה מטלגרם כאן', tgplay_nosw_reload: 'הדף נטען בלי מנגנון ההזרמה - טען את הדף מחדש (רענון רגיל)', tgplay_codec: 'הדפדפן לא מצליח לנגן את הקובץ הזה (MKV / HEVC / AC3 מתנגנים לרוב רק ב-Kodi)',
      tgplay_open_tg: 'פתח בטלגרם', tgplay_download: 'הורד ונגן', tgplay_nofile: 'בהודעה אין קובץ וידאו',
      tgplay_login: 'צריך להתחבר לטלגרם כדי לנגן את הקובץ', tgplay_other_tab: 'טלגרם פתוח בלשונית אחרת של האתר. סגרו אותה או נגנו שם.', tgplay_offline: 'אין חיבור לטלגרם כרגע. בדקו את הרשת ונסו שוב.',
      tgplay_flood: 'טלגרם מבקש להמתין %s שניות', tgplay_private: 'הערוץ פרטי או שההודעה נמחקה', tgplay_gone: 'ההזרמה נסגרה. פתחו את הקובץ שוב.', tgplay_cdn: 'הקובץ מוגש משרת ה-CDN של טלגרם ואי אפשר להזרים אותו כאן - פתחו אותו בטלגרם',
      tgplay_saving: 'שומר למכשיר... %s%', tgplay_saved: 'הקובץ נשמר', tgplay_too_big: 'הקובץ גדול מדי להורדה בדפדפן הזה (%s). פתחו אותו בטלגרם.', tgplay_save: 'שמור למכשיר',
      tgplay_err: 'שגיאת טלגרם: %s', tgplay_timeout: 'טלגרם לא עונה (פג הזמן)'},
    en: {tgplay_nosw: 'This browser cannot stream from Telegram here', tgplay_nosw_reload: 'The page loaded without its streaming helper - reload the page (a normal reload)', tgplay_codec: 'This browser cannot play this file (MKV / HEVC / AC3 usually play only in Kodi)',
      tgplay_open_tg: 'Open in Telegram', tgplay_download: 'Download and play', tgplay_nofile: 'The message has no video file',
      tgplay_login: 'Connect Telegram to play this file', tgplay_other_tab: 'Telegram is open in another tab of this site. Close it or play there.', tgplay_offline: 'No connection to Telegram right now. Check the network and try again.',
      tgplay_flood: 'Telegram asks to wait %s seconds', tgplay_private: 'The channel is private or the message was deleted', tgplay_gone: 'The stream was closed. Open the file again.', tgplay_cdn: 'This file is served from the Telegram CDN and cannot be streamed here - open it in Telegram',
      tgplay_saving: 'Saving to the device... %s%', tgplay_saved: 'The file was saved', tgplay_too_big: 'The file is too large to download in this browser (%s). Open it in Telegram.', tgplay_save: 'Save to device',
      tgplay_err: 'Telegram error: %s', tgplay_timeout: 'Telegram does not answer (timed out)'},
    ru: {tgplay_nosw: 'Этот браузер не может транслировать из Telegram', tgplay_nosw_reload: 'Страница загрузилась без модуля трансляции - перезагрузите её (обычная перезагрузка)', tgplay_codec: 'Браузер не может воспроизвести этот файл (MKV / HEVC / AC3 обычно играют только в Kodi)',
      tgplay_open_tg: 'Открыть в Telegram', tgplay_download: 'Скачать и смотреть', tgplay_nofile: 'В сообщении нет видеофайла',
      tgplay_login: 'Подключите Telegram, чтобы воспроизвести файл', tgplay_other_tab: 'Telegram открыт в другой вкладке сайта. Закройте её или смотрите там.', tgplay_offline: 'Сейчас нет связи с Telegram. Проверьте сеть и попробуйте снова.',
      tgplay_flood: 'Telegram просит подождать %s с', tgplay_private: 'Канал закрытый или сообщение удалено', tgplay_gone: 'Трансляция закрыта. Откройте файл снова.', tgplay_cdn: 'Файл раздаётся через CDN Telegram и не может воспроизводиться здесь - откройте его в Telegram',
      tgplay_saving: 'Сохраняем на устройство... %s%', tgplay_saved: 'Файл сохранён', tgplay_too_big: 'Файл слишком большой для скачивания в этом браузере (%s). Откройте его в Telegram.', tgplay_save: 'Сохранить на устройство',
      tgplay_err: 'Ошибка Telegram: %s', tgplay_timeout: 'Telegram не отвечает (время вышло)'},
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fail = (code) => { const e = new Error(code); e.code = code; return e; };
  function newKey() { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
  function streamUrl(key) { return new URL('tgstream/' + key, location.href.split('#')[0]).href; }
  // at most PARALLEL Telegram requests at a time; o = {key, id, hi}. 6.1.5: nothing starts while a flood wait runs,
  // and an entry whose stream was closed is dropped (TGPLAY_GONE) instead of read.
  let pumpTimer = 0;
  function pump() {
    // 6.1.6: read-ahead never takes the last free slot, so a part the video waits for starts at once
    while (active < PARALLEL && (hiQueue.length || (queue.length && lowActive < PARALLEL - 1))) {
      if (Date.now() < floodUntil) {
        if (!pumpTimer) pumpTimer = setTimeout(() => { pumpTimer = 0; pump(); }, floodUntil - Date.now() + 5);
        return;
      }
      const n = hiQueue.shift() || queue.shift();
      if (n.id && queued.get(n.id) === n) queued.delete(n.id);
      if (n.key && !streams.has(n.key)) { n.rej(fail('TGPLAY_GONE')); continue; }
      n.run();
    }
  }
  function limit(fn, o) {
    o = o || {};
    return new Promise((res, rej) => {
      const n = {key: o.key, id: o.id, rej, run: () => {
        const low = !o.hi; active++; if (low) lowActive++;   // 6.1.6
        let p; try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
        p.then(res, rej).finally(() => { active--; if (low) lowActive--; pump(); });
      }};
      if (o.id) queued.set(o.id, n);
      (o.hi ? hiQueue : queue).push(n);
      pump();
    });
  }
  // 6.1.5: a FLOOD from readPart is waited out here, outside the limiter (the slot is free meanwhile), then read again
  async function limitFlood(fn, o) {
    for (let tries = 0; ; tries++) {
      try { return await limit(fn, o); } catch (e) {
        if (!(e && e.code === 'FLOOD') || tries >= 2) throw e;
        await sleep(Math.max(0, floodUntil - Date.now()));
        if (o && o.key && !streams.has(o.key)) throw fail('TGPLAY_GONE');
      }
    }
  }
  function dropQueued(id) {                      // 6.1.5: a queued (not started) part nobody waits for any more
    const n = queued.get(id);
    if (!n) return;
    queued.delete(id);
    for (const q of [hiQueue, queue]) { const at = q.indexOf(n); if (at >= 0) q.splice(at, 1); }
    n.rej(fail('TGPLAY_GONE'));
  }

  // ---------------------------------------------------------------- the part cache
  function remember(id, bytes) {
    cache.delete(id); cache.set(id, bytes);
    while (cache.size > CACHE_PARTS) cache.delete(cache.keys().next().value);
  }
  function part(key, s, i, hi) {
    const id = key + ':' + i;
    if (cache.has(id)) { const b = cache.get(id); remember(id, b); return Promise.resolve(b); }
    if (streams.get(key) !== s) return Promise.reject(fail('TGPLAY_GONE'));   // 6.1.5: closed meanwhile
    if (pending.has(id)) {
      const n = queued.get(id), at = n ? queue.indexOf(n) : -1;   // 6.1.5: read-ahead a request now needs -> hi
      if (hi && at >= 0) { queue.splice(at, 1); hiQueue.push(n); }
      const pp = pending.get(id);
      if (hi && pp.o) pp.o.hi = true;   // 6.1.5: a FLOOD re-queue keeps the promotion
      return pp;
    }
    const o = {key, id, hi};
    let t0 = 0;   // 6.1.6: when the read of this part really started (set again on a FLOOD retry)
    const p = limitFlood(() => {
      if (streams.get(key) !== s) return Promise.reject(fail('TGPLAY_GONE'));
      t0 = Date.now();
      return s.readPart(i, PART);
    }, o).then((b) => {
      b = b instanceof Uint8Array ? b : new Uint8Array(b);
      if (streams.get(key) === s) remember(id, b);
      s.got = (s.got || 0) + b.length;
      measure(s, b.length, t0 || Date.now());   // 6.1.6
      if (i === 0) tailCheck(key, s, b);         // 6.1.6
      s.lastError = '';
      note(s, {type: 'read', bytes: b.length, total: s.got, need: !!o.hi});   // 6.5.1: need = a Range request waited for it
      return b;
    }, (e) => {
      if (e && (e.code === 'TGPLAY_GONE' || e.code === 'TGPLAY_STOPPED')) throw e;   // 6.1.5: closed, not an error
      s.lastError = errCode(e) || (e && e.code) || (/CDN Not supported/i.test(String(e && e.message)) ? 'TGPLAY_CDN' : '') || 'error';
      note(s, {type: 'error', code: s.lastError, text: errorText(e)});
      throw e;
    }).finally(() => { pending.delete(id); queued.delete(id); });
    p.o = o;
    pending.set(id, p);
    return p;
  }
  // 6.1.6: the line speed (bits/s): what this stream measured, else the app's last measurement (sources/hls)
  function lineBw(s) {
    if (s.bw > 0) return s.bw;
    let b = 0; try { b = Number(TN.get('net_bw', 0)) || 0; } catch (e) { /* none kept */ }
    return b;
  }
  // 6.1.6: how many parts to read ahead: 60 s of video on a line with 2x headroom, 30 s with some, and only 2 parts
  // on a line slower than the file (so the part the video needs is never stuck behind read-ahead)
  function aheadParts(s) {
    if (!(s.rate > 0)) {   // the <video> playing it knows the duration
      try {
        for (const v of Array.from(document.querySelectorAll('video'))) {
          if (String(v.currentSrc || v.src || '').indexOf(s.key || '\u0000') >= 0 && v.duration > 0 && isFinite(v.duration)) { setRate(s, v.duration); break; }
        }
      } catch (e) { /* no page to look at */ }
    }
    const bw = lineBw(s), rate = s.rate > 0 ? s.rate : RATE_GUESS;
    if (!(bw > 0)) return AHEAD;
    let sec;
    if (bw < rate * 1.1) return 2;
    else if (bw < rate * 2) sec = 30;
    else sec = 60;
    const n = Math.ceil(rate / 8 * sec / PART);
    return Math.max(AHEAD, Math.min(n, CACHE_PARTS - 8));
  }
  // 6.1.6: throughput of this stream from per-part timing: the parts completed in the last 8 s, their bytes over
  // the time from the earliest start among them to now (parallel reads add up, gaps do not reset anything);
  // the first part seeds s.bw, later samples feed an EWMA
  function measure(s, bytes, start) {
    const now = Date.now();
    const done = (s.done || []).filter((d) => now - d.end <= 8000);
    done.push({start, end: now, bytes});
    s.done = done;
    let from = now, sum = 0;
    for (const d of done) { sum += d.bytes; if (d.start < from) from = d.start; }
    const sec = Math.max(0.05, (now - from) / 1000);
    const bw = sum * 8 / sec;
    s.bw = s.bw > 0 ? s.bw * 0.7 + bw * 0.3 : bw;
  }
  // 6.1.6: the top-level atoms in part 0 of an MP4: true when 'mdat' comes before any 'moov' (moov at the end)
  function moovAtEnd(b) {
    let at = 0;
    while (at + 8 <= b.length) {
      let size = ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
      const type = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
      if (type === 'moov') return false;
      if (type === 'mdat') return true;
      if (size === 1) {   // 64-bit largesize
        if (at + 16 > b.length) return false;
        let big = 0;
        for (let j = 8; j < 16; j++) big = big * 256 + b[at + j];
        size = big;
      } else if (size === 0) return false;   // runs to the end of the file, no moov seen
      if (size < 8) return false;
      at += size;
    }
    return false;   // unknown: do not spend the line on the tail
  }
  // 6.1.6: after part 0 arrived: read the tail only for an MP4 whose moov is past mdat, on a line >= 1 Mbit/s
  function tailCheck(key, s, b) {
    if (!s.tailCheck) return;
    s.tailCheck = false;
    const lastPart = Math.floor((s.size - 1) / PART), bw = lineBw(s);
    if (lastPart > 2 && bw >= 1e6 && streams.get(key) === s && moovAtEnd(b)) part(key, s, lastPart).catch(() => {});
  }
  // bytes [start, end] (inclusive), possibly fewer when the range crosses many parts (the browser asks again)
  async function read(key, start, end, rid) {
    const s = streams.get(key);
    if (!s) throw fail('TGPLAY_GONE');
    end = Math.min(end, s.size - 1, start + 4 * PART - 1);
    const first = Math.floor(start / PART), last = Math.floor(end / PART);
    const idx = []; for (let i = first; i <= last; i++) idx.push(i);
    const ids = idx.map((i) => key + ':' + i);
    ids.forEach((id) => wants.set(id, (wants.get(id) || 0) + 1));
    if (rid) reqs.set(rid, ids);
    const need = idx.map((i) => part(key, s, i, true));
    // 6.1.6: read-ahead is queued now (behind the needed parts), not after they arrive, and sized to the line;
    // queued read-ahead outside the new window (left behind by a seek) is dropped so it does not eat the line
    const lastPart = Math.floor((s.size - 1) / PART), ahead = aheadParts(s), stop = Math.min(last + ahead, lastPart);
    for (const [id, n] of [...queued]) {
      if (n.key !== key || wants.has(id)) continue;
      const i = Number(id.slice(key.length + 1));
      if (i < first || i > stop) dropQueued(id);
    }
    // 6.5.1: nothing arrived yet (cold start): part 0 gets the line alone; the next request queues the read-ahead
    if (s.got) for (let i = last + 1; i <= stop; i++) part(key, s, i).catch(() => {});   // read ahead
    let parts;
    try { parts = await Promise.all(need); } finally { release(rid, ids, false); }
    const out = new Uint8Array(end - start + 1);
    let at = 0;
    parts.forEach((b, n) => {
      const base = (first + n) * PART, from = Math.max(start - base, 0), to = Math.min(end - base + 1, b.length);
      if (to > from) { out.set(b.subarray(from, to), at); at += to - from; }
    });
    return at === out.length ? out : out.subarray(0, at);
  }

  // 6.1.5: a request is done or cancelled: parts only it needed and not started yet are dropped (cancel only)
  function release(rid, ids, drop) {
    if (rid && reqs.get(rid) !== ids) return;    // released already (cancel came first)
    if (rid) reqs.delete(rid);
    ids.forEach((id) => {
      const n = (wants.get(id) || 1) - 1;
      if (n > 0) { wants.set(id, n); return; }
      wants.delete(id);
      if (drop) dropQueued(id);
    });
  }

  // ---------------------------------------------------------------- the service worker side
  function onMessage(ev) {
    const d = ev.data, port = ev.ports && ev.ports[0];
    if (d && d.tgplay === 'cancel') { const ids = reqs.get(d.rid); if (ids) release(d.rid, ids, true); return; }   // 6.1.5
    if (!d || !port || (d.tgplay !== 'info' && d.tgplay !== 'read')) return;
    const s = streams.get(d.key);
    if (!s) { port.postMessage({known: false}); return; }
    if (d.tgplay === 'info') { port.postMessage({known: true, ok: true, size: s.size, mime: s.serveMime || s.mime}); return; }
    // 6.1.5: a long flood wait runs: tell the SW to ask again later instead of holding the request
    if (floodUntil - Date.now() > 5000) { port.postMessage({known: true, ok: false, status: 503, wait: floodUntil - Date.now()}); return; }
    read(d.key, d.start, d.end, d.rid).then((b) => {
      const buf = b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.slice().buffer;
      port.postMessage({known: true, ok: true, bytes: buf}, [buf]);
    }, (e) => {
      const w = floodUntil - Date.now();
      port.postMessage(e && e.code === 'FLOOD' && w > 0 ? {known: true, ok: false, status: 503, wait: w} : {known: true, ok: false, status: 502});
    });
  }
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', onMessage);

  async function swReady() {
    const sw = navigator.serviceWorker;
    if (!sw || !window.isSecureContext) return false;
    if (sw.controller) return true;
    let reg = null;
    try { reg = await sw.getRegistration(); if (!reg) reg = await sw.register('sw.js'); } catch (e) { return false; }
    // the first visit is not controlled until the worker claims the page
    const ok = await new Promise((res) => {
      // 6.2.1: the listener goes when the timeout wins (one was left behind per open())
      const on = () => { clearTimeout(t); res(true); };
      const t = setTimeout(() => { sw.removeEventListener('controllerchange', on); res(!!sw.controller); }, 4000);
      sw.addEventListener('controllerchange', on, {once: true});
    });
    // 6.2.1: an active worker that does not control the page = a hard reload (Shift+Reload): a normal reload helps
    if (!ok && reg && reg.active && !sw.controller) throw fail('TGPLAY_NO_SW_RELOAD');
    return ok;
  }

  // what the page is told about a stream: {type: 'read', bytes, total} | {type: 'flood', seconds} | {type: 'error', code, text}
  function note(s, ev) { if (s && typeof s.onEvent === 'function') { try { s.onEvent(ev); } catch (e) { /* the listener's problem */ } } }
  // Chromium reads Matroska with its WebM reader: the answer says video/webm so an .mkv with H.264 / VP9 + AAC / Opus plays
  function serveMimeOf(mime) {
    return /matroska/.test(mime || '') && /Chrome\//.test(navigator.userAgent) ? 'video/webm' : '';
  }
  function register(src, o) {
    while (streams.size >= MAX_STREAMS) close(streams.keys().next().value);
    const key = newKey();
    src.serveMime = serveMimeOf(src.mime);
    src.onEvent = (o && o.onEvent) || null;
    src.got = 0; src.lastError = ''; src.key = key;
    setRate(src, o && o.duration);                 // 6.1.6: bitrate = size / duration when the opener knows it
    streams.set(key, src);
    // 6.1.6: an MP4 whose moov sits at the end: the browser asks for the tail right after the head, so once part 0
    // arrives and shows mdat before moov, the tail is read ahead (see tailCheck); not on faststart files or slow lines
    src.tailCheck = /mp4|quicktime/.test(src.mime || '');
    return {key, url: streamUrl(key), size: src.size, mime: src.mime, name: src.name || '', playable: playable(src.mime)};
  }
  async function openSource(src, o) {
    if (!src || !(src.size > 0) || typeof src.readPart !== 'function') throw fail('TGPLAY_BAD_SOURCE');
    if (!(await swReady())) throw fail('TGPLAY_NO_SW');
    return register({size: Number(src.size), mime: src.mime || 'video/mp4', name: src.name || '', readPart: src.readPart}, o);
  }
  // 6.1.6: the file's duration (s) -> its bitrate, which sizes the read-ahead; setDuration(keyOrUrl, seconds)
  function setRate(s, sec) { sec = Number(sec); if (s && sec > 0 && isFinite(sec)) s.rate = s.size * 8 / sec; }
  function setDuration(k, sec) { setRate(streams.get(String(k || '').replace(/^.*\/tgstream\//, '')), sec); }
  // how a stream is doing: {size, read (bytes fetched from Telegram), cached (parts), lastError, wait (flood seconds left)}
  function status(k) {
    const key = String(k || '').replace(/^.*\/tgstream\//, '');
    const s = streams.get(key);
    if (!s) return null;
    let n = 0;
    for (const id of cache.keys()) if (id.startsWith(key + ':')) n++;
    return {size: s.size, read: s.got || 0, cached: n, lastError: s.lastError || '', wait: Math.max(0, Math.ceil(((s.floodUntil || 0) - Date.now()) / 1000))};
  }
  // an error of open() / a read -> a text for the viewer (never the raw object: it can name a chat)
  function errorText(e) {
    const c = String((e && (e.code || e.errorMessage || e.message)) || e || '');
    if (/TGPLAY_NO_SW_RELOAD/.test(c)) return TN.t('tgplay_nosw_reload');
    if (/TGPLAY_NO_SW/.test(c)) return TN.t('tgplay_nosw');
    if (/TGPLAY_NO_FILE/.test(c)) return TN.t('tgplay_nofile');
    if (/TGPLAY_GONE/.test(c)) return TN.t('tgplay_gone');
    if (/TGPLAY_CDN/.test(c)) return TN.t('tgplay_cdn');
    if (/TG_NO_LOGIN|AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/.test(c)) return TN.t('tgplay_login');
    if (/TG_OTHER_TAB/.test(c)) return TN.t('tgplay_other_tab');
    if (/TG_OFFLINE|TG_CONNECT_FAILED|TG_LOGIN_RUNNING|disconnected|Not connected/i.test(c)) return TN.t('tgplay_offline');
    if (/FLOOD/.test(c)) return TN.t('tgplay_flood', Number(e && e.seconds) || '?');
    if (/CHANNEL_PRIVATE|CHANNEL_INVALID|PEER_ID_INVALID|MSG_ID_INVALID|USERNAME_(INVALID|NOT_OCCUPIED)|CHAT_ID_INVALID|Could not find the input entity/i.test(c)) return TN.t('tgplay_private');
    if (/TIMEOUT|timed? ?out/i.test(c)) return TN.t('tgplay_timeout');
    return TN.t('tgplay_err', c.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '').replace(/[^A-Za-z0-9_ .:-]/g, '').slice(0, 60) || 'error');
  }
  function close(k) {
    const key = String(k || '').replace(/^.*\/tgstream\//, '');
    if (!streams.delete(key)) return;
    for (const id of [...cache.keys()]) if (id.startsWith(key + ':')) cache.delete(id);
    for (const id of [...queued.keys()]) if (id.startsWith(key + ':')) dropQueued(id);   // 6.1.5: free the queue
    for (const q of [hiQueue, queue]) {
      for (let j = q.length - 1; j >= 0; j--) if (q[j].key === key) q.splice(j, 1)[0].rej(fail('TGPLAY_GONE'));
    }
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
    // 6.5.1: nothing here waits forever: the client within 35 s, the message within 15 s (each ends in a clear error)
    const within = (p, ms, code) => { let t = 0; return Promise.race([Promise.resolve(p).finally(() => clearTimeout(t)), new Promise((res, rej) => { t = setTimeout(() => rej(fail(code)), ms); })]); };
    let client = await within(TG.client(), 35000, 'TG_OFFLINE');
    const refresh = async () => { client = await within(TG.client(), 35000, 'TG_OFFLINE'); };
    const G = window.GramJS;
    let peer = ref.peer, msgId = Number(ref.msg), message = ref.message || null;
    if (message) { peer = peer || message.peerId; msgId = msgId || message.id; }
    async function fetchMsg() {
      const [m] = await within(client.getMessages(peer, {ids: msgId}), 15000, 'TGPLAY_TIMEOUT');
      return m || null;
    }
    // 6.5.1: the last time a part of this stream arrived; starts at the open, so a cold slow first part gets the
    // longer wait and the rebuild comes only after 30 s with nothing received
    let gotAt = Date.now();
    if (!message) message = await fetchMsg();
    let doc = docOf(message);
    if (!doc) throw fail('TGPLAY_NO_FILE');
    const meta = info(doc);
    async function once(i, size, box) {
      const it = client.iterDownload({file: new G.Api.InputDocumentFileLocation({id: doc.id, accessHash: doc.accessHash,
        fileReference: doc.fileReference, thumbSize: ''}), dcId: doc.dcId, fileSize: doc.size,
      offset: bigOf(doc, i * size), requestSize: size, chunkSize: size, limit: 1});
      box.it = it;   // 6.1.5: readPart ends it on a timeout
      for await (const chunk of it) return new Uint8Array(chunk);
      return new Uint8Array(0);
    }
    async function readPart(i, size) {
      let timeouts = 0, wait = PART_TIMEOUT;
      for (let tries = 0; ; tries++) {
        let t = 0;
        const box = {};
        try {
          // 6.1.5: a read that never answers ends after 15 s (frees the limit() slot) and counts as a hiccup
          const got = await Promise.race([once(i, size, box), new Promise((res, rej) => { t = setTimeout(() => {
            // 6.1.5: end the abandoned download so it does not keep running outside the slot count
            try { const r = box.it && typeof box.it.return === 'function' && box.it.return(); if (r && r.catch) r.catch(() => {}); } catch (e2) { /* gone anyway */ }
            rej(fail('TGPLAY_TIMEOUT'));
          }, wait); })]);
          gotAt = Date.now();
          if (TG.touch) TG.touch();
          return got;
        } catch (e) {
          const code = errCode(e);
          if (/FLOOD/.test(code) && e.seconds) {   // 6.1.5: never sleep here (inside limit): limitFlood waits it out
            const sec = Math.min(Number(e.seconds), 60);
            floodUntil = Math.max(floodUntil, Date.now() + sec * 1000);
            meta.floodUntil = floodUntil;
            note(meta, {type: 'flood', seconds: sec, text: TN.t('tgplay_flood', sec)});
            throw Object.assign(fail('FLOOD'), {seconds: sec, errorMessage: code});
          }
          // 6.5.1: a file on Telegram's CDN (GramJS cannot follow the redirect): no retries, a clear reason
          if (/CDN Not supported/i.test(String(e && e.message))) throw fail('TGPLAY_CDN');
          if (tries >= 3) throw e;
          if (/^FILE_REFERENCE_/.test(code)) { const m = await fetchMsg(); const d = docOf(m); if (!d) throw e; doc = d; continue; }
          // 6.5.1: on the first timeout of a part the connection is checked (one GetState). A dead one, or one that
          // answers but has sent this stream nothing for 30 s (a stuck media-DC sender), is rebuilt once for all the
          // parallel parts (TG.reconnect is single-flight); a slow line that still delivers only gets a longer wait.
          if (e && e.code === 'TGPLAY_TIMEOUT' && ++timeouts === 1) {
            let okNow = true;
            try { okNow = TG.health ? await TG.health() : true; } catch (e2) { okNow = false; }
            if (!okNow || Date.now() - gotAt > 30000) {
              try { if (TG.reconnect) await TG.reconnect(client); await refresh(); }
              catch (e2) { if (e2 && /^(TG_NO_LOGIN|TG_OFFLINE|TG_OTHER_TAB)$/.test(e2.code || e2.message)) throw e2; /* the next try tells */ }
            } else wait = PART_TIMEOUT * 2;
          }
          if (!code) { await sleep(800 * (tries + 1)); continue; }   // network hiccup (or a timeout)
          throw e;
        } finally { clearTimeout(t); }
      }
    }
    return Object.assign(meta, {readPart, peer, msg: msgId});
  }
  async function open(ref, o) {
    if (!ref) throw fail('TGPLAY_NO_FILE');
    if (!(await swReady())) throw fail('TGPLAY_NO_SW');
    const src = await tgSource(ref);
    const h = register(src, o);
    h.tgLink = tgLink(src.peer, src.msg);
    return h;
  }
  // an open stream (ref.key / ref.url of open()) or a Telegram reference -> its part source
  async function srcOf(ref) {
    if (ref && typeof ref.readPart === 'function') return ref;
    const key = String((ref && (ref.key || ref.url)) || '').replace(/^.*\/tgstream\//, '');
    if (key && streams.has(key)) return streams.get(key);
    return tgSource(ref);
  }
  // the link test of the sources screen (Finder.probe / TG.read_head): the first 256 KB and how fast they came
  async function probe(ref) {
    // 6.1.4: a link test never competes with a video that is playing (the same Telegram queue and connection)
    const own = String((ref && (ref.key || ref.url)) || '').replace(/^.*\/tgstream\//, '');
    if (streams.size && !(own && streams.has(own))) throw fail('TGPLAY_BUSY');
    const src = await srcOf(ref);
    const t0 = Date.now();
    // 6.5.1: an open stream reads part 0 through its cache (no second download); a bare reference reads directly
    const cached = !!(own && streams.has(own) && cache.has(own + ':0'));
    const b = own && streams.has(own) && streams.get(own) === src ? await part(own, src, 0, true)
      : await limitFlood(() => src.readPart(0, PART), {hi: true});   // 6.1.5: waits out a flood
    const sec = Math.max(0.05, (Date.now() - t0) / 1000);
    const u = b instanceof Uint8Array ? b : new Uint8Array(b);
    return {head: u.subarray(0, 262144), mbit: cached ? 0 : Math.round(u.length * 8 / sec / 1e5) / 10, size: src.size, mime: src.mime, name: src.name || ''};
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
  const stopped = (o) => !!(o && o.signal && o.signal.aborted);
  // every part in order, PARALLEL at a time; each(bytes, index) may be async. o = {signal, onProgress(percent, doneBytes, size)}
  async function eachPart(src, each, o) {
    const n = Math.ceil(src.size / PART);
    let done = 0;
    for (let i = 0; i < n; i += PARALLEL) {
      if (stopped(o)) throw fail('TGPLAY_STOPPED');
      const idx = []; for (let j = i; j < Math.min(n, i + PARALLEL); j++) idx.push(j);
      const got = await Promise.all(idx.map((j) => limitFlood(() => src.readPart(j, PART))));
      for (let k = 0; k < got.length; k++) { await each(got[k], idx[k]); done += got[k].length; }
      if (o && o.onProgress) { try { o.onProgress(Math.min(100, Math.floor(done * 100 / src.size)), done, src.size); } catch (e) { /* drawing */ } }
    }
  }
  // no service worker: the whole file into memory (under 300 MB), else only the Telegram link.
  // ref = a Telegram reference or an open stream ({key}); o = {signal, onProgress}
  async function fallback(ref, o) {
    const src = await srcOf(ref);
    const link = tgLink(src.peer, src.msg);
    if (src.size > BLOB_MAX) return {kind: 'link', url: link, size: src.size};
    const parts = [];
    await eachPart(src, (b) => { parts.push(b); }, o);
    const url = URL.createObjectURL(new Blob(parts, {type: src.mime}));
    return {kind: 'blob', url, link, revoke: () => URL.revokeObjectURL(url)};
  }
  // The way out for a file this browser cannot decode (HEVC, AC3 / DTS sound, AVI): save it to the device, to open in
  // VLC or Kodi there. Chromium writes straight to disk (any size, File System Access); other browsers get a normal
  // download of a file built in memory, up to 300 MB. Call it from a click (the save dialog needs the gesture):
  // with an open stream ({key}) nothing has to be asked from Telegram before the dialog.
  // -> {saved: true, name} | throws TGPLAY_TOO_BIG (with .size) | TGPLAY_STOPPED | AbortError (the viewer cancelled)
  const canSaveBig = () => typeof window.showSaveFilePicker === 'function';
  async function save(ref, o) {
    const known = ref && (ref.key || ref.url) && streams.get(String(ref.key || ref.url).replace(/^.*\/tgstream\//, ''));
    let handle = null, src = known || null;
    const nameOf = (s) => String((s && s.name) || 'video').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'video';
    if (canSaveBig()) {
      // the dialog first while the click still counts; the name is known only for an open stream
      handle = await window.showSaveFilePicker({suggestedName: known ? nameOf(known) : 'video.mkv'});
    }
    if (!src) src = await srcOf(ref);
    if (handle) {
      const w = await handle.createWritable();
      try { await eachPart(src, (b) => w.write(b), o); await w.close(); } catch (e) { try { await w.abort(); } catch (e2) { /* closed */ } throw e; }
      return {saved: true, name: handle.name || nameOf(src)};
    }
    if (src.size > BLOB_MAX) { const e = fail('TGPLAY_TOO_BIG'); e.size = src.size; e.link = tgLink(src.peer, src.msg); throw e; }
    const parts = [];
    await eachPart(src, (b) => { parts.push(b); }, o);
    const url = URL.createObjectURL(new Blob(parts, {type: src.mime || 'application/octet-stream'}));
    const a = document.createElement('a');
    a.href = url; a.download = nameOf(src); a.style.display = 'none';
    document.body.append(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 60000);
    return {saved: true, name: a.download};
  }

  const api = {kinds: ['service'], label: 'Telegram playback', open, openSource, close,
    closeAll: () => [...streams.keys()].forEach(close), playable, check, fallback, tgLink, probe, status, errorText, save, canSaveBig,
    stats: () => ({streams: streams.size, cached: cache.size}), setDuration, PART, BLOB_MAX};
  TN.registerProvider('tgplay', api);
})(self.TN);
