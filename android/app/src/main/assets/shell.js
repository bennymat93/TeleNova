// Injected by the Android app into the BN Stream page (document start, main origin only). It changes nothing in the
// page's own code: it only (1) hands files the page "downloads" (a[download] on a blob: address) to the app, which
// saves them in the app folder, (2) tells the app when a video plays (screen stays on), (3) shows a "Files" button on
// the backup / settings pages. window.TNAndroid is the message channel the app adds; window.TNShell is a small API a
// later web version may call (see android/WEB_CHANGES_NEEDED.md).
(function () {
  'use strict';
  if (window.__tnShell) return;
  window.__tnShell = 1;
  window.TeleNovaAndroid = true;
  // A WebView offers the browser's "save as" picker (showSaveFilePicker), and pages prefer it after a real tap - but
  // inside the app it never returns (web/backup.js full backup waited for ever). Without it the page downloads the
  // file, which the app saves in its own folder (the full backup over the old one). Hidden before any page code runs.
  try { delete window.showSaveFilePicker; } catch (e) { /* not there */ }
  try { if ('showSaveFilePicker' in window) Object.defineProperty(window, 'showSaveFilePicker', {value: undefined, configurable: true, writable: true}); } catch (e) { /* stays */ }                 // the page's test for "inside the Android app" (also "BNStream/" in the user agent)
  var seq = 0, pend = {}, wired = false, relays = {}, pendV = {};
  function unb64(s) {
    var bin = atob(s || ''), a = new Uint8Array(bin.length), i = 0;
    for (; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function b64(buf) {
    var a = new Uint8Array(buf), s = '', i = 0;
    for (; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function bridge() {
    var B = window.TNAndroid;
    if (B && !wired) {
      wired = true;
      B.onmessage = function (ev) {
        var d = String(ev.data || ''), i = d.indexOf(':'), k = d.slice(i + 1);
        if (i === 1 && (d.charAt(0) === 'B' || d.charAt(0) === 'R')) {       // an answer of the built-in helper
          var j = d.indexOf(':', 2), rk = d.slice(2, j), rp = relays[rk];
          if (!rp) return;
          if (d.charAt(0) === 'B') { rp.parts.push(unb64(d.slice(j + 1))); return; }
          delete relays[rk];
          var meta; try { meta = JSON.parse(d.slice(j + 1)); } catch (e) { meta = {status: 502, headers: {}}; }
          rp.done({meta: meta, parts: rp.parts});
          return;
        }
        if (i === 1 && d.charAt(0) === 'V') {                                   // a value answer: V:<k>:<json>
          var vj = d.indexOf(':', 2), vk = d.slice(2, vj), vf = pendV[vk];
          if (!vf) return;
          delete pendV[vk];
          var val = null; try { val = JSON.parse(d.slice(vj + 1)); } catch (e) { val = null; }
          vf(val);
          return;
        }
        if (pend[k]) { var f = pend[k]; delete pend[k]; f(d.slice(0, i)); }
      };
    }
    return B;
  }
  function post(o) { var B = bridge(); if (B) { try { B.postMessage(JSON.stringify(o)); } catch (e) {} } }
  function ask(o) {
    return new Promise(function (res) {
      var B = bridge();
      if (!B) return res('err');
      var k = String(++seq); o.k = k; pend[k] = res;
      try { B.postMessage(JSON.stringify(o)); } catch (e) { delete pend[k]; res('err'); }
    });
  }

  // ---- files: blob: addresses made by the page are remembered, so a "download" can be read without the network
  var blobs = new Map();
  var mk = URL.createObjectURL, rv = URL.revokeObjectURL;
  URL.createObjectURL = function (o) {
    var u = mk.apply(URL, arguments);
    try { if (o instanceof Blob) blobs.set(u, o); } catch (e) {}
    return u;
  };
  URL.revokeObjectURL = function (u) { blobs.delete(u); return rv.apply(URL, arguments); };

  async function save(blob, name) {
    var id = 's' + Date.now() + '_' + (++seq);
    if ((await ask({t: 'save0', id: id, name: String(name || 'file'), mime: blob.type || '', size: blob.size})) !== 'ok') return false;
    var CH = 384 * 1024;
    for (var off = 0; off < blob.size; off += CH) {
      var buf = new Uint8Array(await blob.slice(off, off + CH).arrayBuffer()), s = '';
      for (var i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      if ((await ask({t: 'save1', id: id, b: btoa(s)})) !== 'ok') { post({t: 'saveX', id: id}); return false; }
    }
    return (await ask({t: 'save2', id: id})) === 'ok';
  }
  function tryAnchor(a, ev) {
    if (!a || !a.hasAttribute || !a.hasAttribute('download') || !bridge()) return false;
    var h = String(a.href || '');
    if (h.indexOf('blob:') !== 0) return false;
    var b = blobs.get(h);
    if (!b) return false;
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    save(b, a.getAttribute('download') || 'file');
    return true;
  }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[download]');
    if (a) tryAnchor(a, e);
  }, true);
  var click0 = HTMLElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!this.isConnected && tryAnchor(this, null)) return;
    return click0.apply(this, arguments);
  };

  // ---- screen stays on while a video plays
  var playing = new Set(), last = false;
  function mediaEvt(e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO') return;
    if (e.type === 'playing') playing.add(v); else playing.delete(v);
    mediaState();
  }
  function mediaState() {
    playing.forEach(function (v) { if (!v.isConnected || v.paused || v.ended) playing.delete(v); });   // a removed player sends no event
    var on = playing.size > 0;
    if (on !== last) { last = on; post({t: 'play', on: on}); }
  }
  setInterval(mediaState, 3000);
  ['playing', 'pause', 'ended', 'emptied', 'error'].forEach(function (n) { document.addEventListener(n, mediaEvt, true); });

  // ---- Telegram sign-in -----------------------------------------------------------------------------------------
  // web/tg.js (web 5.1.0) calls dropPending() and setFlood() when a sign-in succeeds and when it is wiped, but defines
  // neither, so a sign-in stopped with an error at its last step. Until the page defines its own (its own then win: a
  // function inside the module hides these), the app supplies them - the same way as the iOS app.
  if (typeof window.dropPending !== 'function') {
    window.dropPending = function () { try { sessionStorage.removeItem('bn_tg_pending'); } catch (e) { /* no storage */ } };
  }
  if (typeof window.setFlood !== 'function') {
    window.setFlood = function (until) {
      try { if (until) sessionStorage.setItem('bn_tg_flood', String(until)); else sessionStorage.removeItem('bn_tg_flood'); } catch (e) { /* no storage */ }
    };
  }
  // The QR sign-in shows a code to scan from ANOTHER device. On the phone itself the same tg://login link can be
  // opened in the Telegram app: a "confirm in Telegram" button is shown while the QR step is on. The link is passed
  // on as it is and never kept or logged.
  var QR_RE = /^tg:\/\/login\?token=[A-Za-z0-9_-]+$/;
  setInterval(function () {
    var url = '';
    try {
      var st = window.TG && window.TG.step ? window.TG.step() : null;
      if (st && st.step === 'qr' && QR_RE.test(String(st.url || ''))) url = String(st.url);
    } catch (e) { url = ''; }
    var b = document.getElementById('tn-android-tgqr');
    if (!url || !document.body || !bridge()) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('button');
      b.id = 'tn-android-tgqr'; b.type = 'button';
      var lang = 'he';
      try { lang = String((window.TN && TN.lang && TN.lang()) || document.documentElement.lang || 'he').slice(0, 2); } catch (e) {}
      b.textContent = lang === 'he' ? '\u05D0\u05D9\u05E9\u05D5\u05E8 \u05D1\u05D0\u05E4\u05DC\u05D9\u05E7\u05E6\u05D9\u05D9\u05EA \u05D8\u05DC\u05D2\u05E8\u05DD \u05D1\u05DE\u05DB\u05E9\u05D9\u05E8 \u05D4\u05D6\u05D4'
        : lang === 'ru' ? '\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C \u0432 Telegram \u043D\u0430 \u044D\u0442\u043E\u043C \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0435' : 'Confirm in Telegram on this device';
      b.style.cssText = 'position:fixed;z-index:60;bottom:calc(20px + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%);' +
        'padding:12px 20px;border-radius:24px;border:0;background:#2aabee;color:#fff;font:600 15px system-ui,sans-serif;' +
        'box-shadow:0 4px 14px rgba(0,0,0,.5);cursor:pointer;max-width:90vw';
      b.addEventListener('click', function () { post({t: 'tgqr', url: b.dataset.url || ''}); });
      document.body.appendChild(b);
    }
    b.dataset.url = url;
  }, 700);

  // ---- "Files" button on the pages where files are made or needed
  function fab() {
    if (!document.body || !bridge()) return;
    var want = /^#\/(backup|settings)/.test(location.hash || '');   // 6.0: only where files are made; small, so it covers nothing
    var b = document.getElementById('tn-android-files');
    if (want && !b) {
      b = document.createElement('button');
      b.id = 'tn-android-files'; b.type = 'button';
      b.style.cssText = 'position:fixed;z-index:40;bottom:calc(16px + env(safe-area-inset-bottom,0px));inset-inline-end:16px;' +
        'width:44px;height:44px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.28);background:#1b2030;color:#fff;' +
        'font:600 20px/42px system-ui,sans-serif;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,.5);cursor:pointer;opacity:.85';
      b.addEventListener('click', function () { post({t: 'menu'}); });
      document.body.appendChild(b);
    } else if (!want && b) b.remove();
    if (want && b) {                                   // the page's language can change after the button was made
      var lang = 'he';
      try { lang = String((window.TN && TN.lang && TN.lang()) || document.documentElement.lang || 'he').slice(0, 2); } catch (e) {}
      var txt = '☰ ' + (lang === 'he' ? 'קבצים ורענון'
        : lang === 'ru' ? 'Файлы и обновление' : 'Files & refresh');
      if (b.title !== txt) { b.title = txt; b.setAttribute('aria-label', txt); b.textContent = '☰'; }
      // the phone layout has a tab bar at the bottom: the button sits above it
      var low = document.documentElement.getAttribute('data-shell') === 'phone' ? 84 : 16;
      var bottom = 'calc(' + low + 'px + env(safe-area-inset-bottom,0px))';
      if (b.style.bottom !== bottom) b.style.bottom = bottom;
    }
  }
  window.addEventListener('hashchange', fab);
  window.addEventListener('popstate', fab);
  document.addEventListener('DOMContentLoaded', fab);
  setInterval(fab, 1500);

  // ---- the page's own keyboard (web/osk.js marks <html class="osk_on">): the app keeps Android's keyboard closed
  // meanwhile, so two keyboards never cover the screen
  var oskLast = null, oskMarked = [];
  function oskQuiet(el) {                          // inputmode="none": Chrome shows no virtual keyboard for this field
    if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.hasAttribute('data-tn-im')) return;
    el.setAttribute('data-tn-im', el.getAttribute('inputmode') || '');
    el.setAttribute('inputmode', 'none');
    oskMarked.push(el);
  }
  function oskState() {
    var on = document.documentElement.classList.contains('osk_on');
    if (on === oskLast) return;
    oskLast = on;
    post({t: 'osk', on: on});
    if (on) oskQuiet(document.activeElement);
    else {
      oskMarked.forEach(function (el) {
        var was = el.getAttribute('data-tn-im');
        if (was) el.setAttribute('inputmode', was); else el.removeAttribute('inputmode');
        el.removeAttribute('data-tn-im');
      });
      oskMarked = [];
    }
  }
  try { new MutationObserver(oskState).observe(document.documentElement, {attributes: true, attributeFilter: ['class']}); } catch (e) { /* old engine */ }
  // a field focused while the page's keyboard is open (it sends its letters there) stays quiet too
  document.addEventListener('focusin', function (e) { if (oskLast) oskQuiet(e.target); }, true);
  // the field that opened the page's keyboard: marked before the keyboard draws (focusin comes before osk_on)
  document.addEventListener('focusin', function (e) {
    if (document.documentElement.classList.contains('tv')) oskQuiet(e.target);
  }, true);

  // ---- the helper Worker, built into the app (HelperRelay.java) -------------------------------------------------
  // web/helper.js sends requests for hosts without browser CORS to <helper address>/p with the target in X-TN-Target.
  // Here that address is a name that never reaches the network: fetch() to it is answered by the app itself. The same
  // address is used by the iOS app, so a backup moves between the two.
  var HELPER = 'https://helper.telenova.invalid';
  var realFetch = window.fetch;
  async function relayFetch(input, init) {
    var signal = init && init.signal;
    var aborted = function () { return new DOMException('Aborted', 'AbortError'); };
    if (signal && signal.aborted) throw aborted();
    var req = new Request(input, init);
    if (new URL(req.url).pathname === '/ping') {
      return new Response(JSON.stringify({ok: true, app: 'telenova-helper', v: 1, native: 'android'}),
        {status: 200, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}});
    }
    var B = bridge();
    if (!B) throw new TypeError('helper unavailable');
    var headers = {};
    req.headers.forEach(function (v, k) { headers[k.toLowerCase()] = v; });
    var body = '';
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      var buf = await req.arrayBuffer();
      if (buf.byteLength) body = b64(buf);
    }
    var k = 'r' + (++seq);
    var asked = new Promise(function (done) { relays[k] = {parts: [], done: done}; });
    B.postMessage(JSON.stringify({t: 'relay', k: k, method: req.method, headers: headers, body: body}));
    var r = await (signal ? Promise.race([asked, new Promise(function (res, rej) {
      signal.addEventListener('abort', function () {
        delete relays[k];
        try { B.postMessage(JSON.stringify({t: 'relay-abort', k: k})); } catch (e) { /* app side gone */ }
        rej(aborted());
      }, {once: true});
    })]) : asked);
    var st = Number(r.meta.status) || 502;
    var empty = st === 204 || st === 205 || st === 304 || req.method === 'HEAD';
    return new Response(empty ? null : new Blob(r.parts), {status: st, headers: r.meta.headers || {}});
  }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf(HELPER + '/') !== 0) return realFetch.apply(this, arguments);
    return relayFetch(input, init);
  };
  // the page reads the helper address from its own settings: it is filled in when the viewer has none of their own
  var helperTries = 0, helperTimer = setInterval(function () {
    try {
      var S = window.TN && window.TN.settings;
      if (S) { clearInterval(helperTimer); if (bridge() && !S.get('helper', '')) S.set('helper', HELPER); return; }
    } catch (e) { clearInterval(helperTimer); return; }
    if (++helperTries > 240) clearInterval(helperTimer);
  }, 250);

  // the same small API as the iOS app (ios-app/Resources/bridge.js), so the page can test one name
  // ---- BNNative: what the page may ask the app for (web/app.js fullUpdate, web/osk.js clipboard) -----------------
  function askV(o, ms) {
    return new Promise(function (res) {
      var B = bridge();
      if (!B) return res(null);
      var k = 'v' + (++seq); o.k = k; pendV[k] = res;
      setTimeout(function () { if (pendV[k]) { delete pendV[k]; res(null); } }, ms || 15000);
      try { B.postMessage(JSON.stringify(o)); } catch (e) { delete pendV[k]; res(null); }
    });
  }
  window.BNNative = {
    platform: 'android',
    // the newest app: the app reads apk/version.json; a newer APK is offered (download + install, the system asks);
    // -> {newer, version}. The page then refreshes its own files as it always does.
    fullUpdate: function () { return askV({t: 'update'}, 20000); },
    clipRead: function () { return askV({t: 'clipread'}).then(function (v) { return typeof v === 'string' ? v : ''; }); },
    clipWrite: function (text) { return askV({t: 'clipwrite', text: String(text == null ? '' : text)}).then(function (v) { return v === true; }); }
  };
  // A WebView refuses navigator.clipboard.readText (no permission prompt exists there): both calls go to the app.
  try {
    var cb = navigator.clipboard || {};
    var readT = function () { return window.BNNative.clipRead(); };
    var writeT = function (t) { return window.BNNative.clipWrite(t).then(function (ok) { if (!ok) throw new DOMException('Write refused', 'NotAllowedError'); }); };
    if (navigator.clipboard) {
      try { Object.defineProperty(cb, 'readText', {value: readT, configurable: true, writable: true}); } catch (e) { cb.readText = readT; }
      try { Object.defineProperty(cb, 'writeText', {value: writeT, configurable: true, writable: true}); } catch (e) { cb.writeText = writeT; }
    } else {
      Object.defineProperty(navigator, 'clipboard', {value: {readText: readT, writeText: writeT}, configurable: true});
    }
  } catch (e) { /* the page keeps its own fallback */ }

  window.TeleNovaNative = {
    helper: HELPER,
    platform: 'android',
    save: function (blob, name) { return save(blob, name); },
    files: function () { post({t: 'files'}); }
  };

  window.TNShell = {
    android: true,
    files: function () { post({t: 'files'}); },
    menu: function () { post({t: 'menu'}); },
    refresh: function () { post({t: 'refresh'}); },
    save: function (blob, name) { return save(blob, name); },
    helper: HELPER
  };
})();
