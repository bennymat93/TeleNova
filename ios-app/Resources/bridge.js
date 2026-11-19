// TeleNova iOS app: injected into the page (main frame, document start) by WebViewController.swift.
// 1. Files the page exports (<a download href="blob:...">, used by backup.js / tgplay.js / player.js) are written by
//    the app into its Documents folder - WKWebView has no download bar of its own.
// 2. navigator.standalone = true, so the page does not offer "add to home screen".
// 3. The helper Worker is built in: requests to the helper address are relayed by the app (HelperRelay.swift).
// 4. window.TeleNovaNative: a small API the page may use later (see ios-app/WEB_CHANGES_NEEDED.md).
(function () {
  'use strict';
  if (window.__tnNative) return;
  var mh = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.telenova;
  if (!mh) return;
  window.__tnNative = true;
  try { Object.defineProperty(navigator, 'standalone', {configurable: true, get: function () { return true; }}); } catch (e) { /* stays as it is */ }

  // ---- iOS look: denser, closer to a native app (owner, 2026-11-19: "smaller buttons, use the space") -------------
  // Only inside the iOS app (class tnios on <html>); the web site itself is unchanged. Sizes stay at or above the
  // 36-44 pt touch range. The header no longer slides away while scrolling: its back button must always be there.
  document.documentElement.classList.add('tnios');
  var IOS_CSS = [
    'html.tnios[data-shell="phone"],html.tnios[data-shell="tablet"]{--ctl:38px;--gutter:12px;--gap:10px;--top-h:44px;',
    '  --fs-1:11px;--fs-2:13px;--fs-3:15px;--fs-4:18px;--fs-5:20px;--fs-6:24px;--sp-4:12px;--sp-5:16px;--sp-6:24px;',
    '  --r:12px;--r-s:8px;--card-w:100px;--wide-w:144px;--sq-w:96px;--land-w:220px;--tabs-h:50px}',
    'html.tnios[data-shell="tablet"]{--gutter:20px;--card-w:128px;--wide-w:188px;--sq-w:120px;--land-w:250px}',
    'html.tnios .btn{padding:0 14px;font-size:var(--fs-3)}',
    'html.tnios .btn.ghost,html.tnios .chip{min-height:34px}',
    'html.tnios .panel{padding:var(--sp-4);margin-top:var(--sp-4)}',
    'html.tnios .setrow{min-height:48px;padding:8px var(--sp-3)}',
    'html.tnios .pagehead{margin:var(--sp-3) 0 var(--sp-2)}',
    'html.tnios input,html.tnios select,html.tnios textarea{font-size:16px}',      /* 16 px: iOS does not zoom a field */
    'html.tnios[data-shell="phone"] .tabs{height:calc(50px + var(--safe-b))}',
    'html.tnios[data-shell="phone"] .tab svg,html.tnios[data-shell="phone"] .tab .ico{width:22px;height:22px}',
    'html.tnios.hdr-hide .top{transform:none!important}',
    'html.tnios[data-shell="phone"] .top{padding-left:6px;padding-right:6px}'
  ].join('\n');
  function addIosCss() {
    if (document.getElementById('tn-ios-css')) return;
    var st = document.createElement('style');
    st.id = 'tn-ios-css';
    st.textContent = IOS_CSS;
    (document.head || document.documentElement).appendChild(st);     // after style.css: these rules win
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addIosCss); else addIosCss();

  // ---- Telegram sign-in ------------------------------------------------------------------------------------------
  // web/tg.js (web 5.1.0) calls dropPending() and setFlood() when a sign-in succeeds and when it is wiped, but defines
  // neither, so every sign-in stopped with an error at its last step. Until the page defines its own (its own then
  // win: a function inside the module hides these), the app supplies them.
  if (typeof window.dropPending !== 'function') {
    window.dropPending = function () { try { sessionStorage.removeItem('bn_tg_pending'); } catch (e) { /* no storage */ } };
  }
  if (typeof window.setFlood !== 'function') {
    window.setFlood = function (until) {
      try { if (until) sessionStorage.setItem('bn_tg_flood', String(until)); else sessionStorage.removeItem('bn_tg_flood'); } catch (e) { /* no storage */ }
    };
  }
  // The QR sign-in shows a code to scan from ANOTHER device. On the phone itself the same tg://login link can be
  // opened in the Telegram app: the app is told the current link and offers a native "confirm in Telegram" button.
  // The link is passed on as it is and never kept or logged.
  var lastQr = '';
  setInterval(function () {
    var url = '';
    try {
      var st = window.TG && window.TG.step ? window.TG.step() : null;
      if (st && st.step === 'qr' && /^tg:\/\/login\?token=[A-Za-z0-9_-]+$/.test(String(st.url || ''))) url = String(st.url);
    } catch (e) { url = ''; }
    if (url === lastQr) return;
    lastQr = url;
    try { mh.postMessage({op: 'tgqr', url: url}).catch(function () {}); } catch (e) { /* app side gone */ }
  }, 700);

  var blobs = new Map();                          // blob: address -> Blob, while the address is alive
  var make = URL.createObjectURL, drop = URL.revokeObjectURL;
  URL.createObjectURL = function (o) {
    var u = make.apply(URL, arguments);
    try { if (o instanceof Blob) blobs.set(u, o); } catch (e) { /* not a blob */ }
    return u;
  };
  URL.revokeObjectURL = function (u) {
    blobs.delete(u);
    return drop.apply(URL, arguments);
  };

  function b64(buf) {
    var a = new Uint8Array(buf), s = '', i = 0;
    for (; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  }
  var STEP = 3 * 256 * 1024;                      // a multiple of 3: every piece is whole base64
  async function save(blob, name) {
    var r = await mh.postMessage({op: 'begin', name: String(name || 'file'), size: blob.size, mime: blob.type || ''});
    try {
      for (var off = 0; off < blob.size; off += STEP) {
        var buf = await blob.slice(off, off + STEP).arrayBuffer();
        await mh.postMessage({op: 'chunk', id: r.id, data: b64(buf)});
      }
      return await mh.postMessage({op: 'end', id: r.id});
    } catch (e) {
      try { await mh.postMessage({op: 'abort', id: r.id}); } catch (x) { /* gone */ }
      throw e;
    }
  }
  // true: the app took the file, the browser must not follow the link
  function take(a) {
    try {
      if (!a || !a.hasAttribute || !a.hasAttribute('download')) return false;
      var href = String(a.href || ''), name = a.getAttribute('download') || 'file';
      if (href.indexOf('blob:') === 0) {
        var b = blobs.get(href);
        if (!b) return false;
        save(b, name).catch(function () {});
        return true;
      }
      if (href.indexOf('data:') === 0) {
        mh.postMessage({op: 'dataurl', name: name, url: href}).catch(function () {});
        return true;
      }
    } catch (e) { /* the browser handles it */ }
    return false;
  }
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (take(this)) return undefined;
    return click.apply(this, arguments);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (a && take(a)) e.preventDefault();
  }, true);

  // ---- the helper Worker, built into the app (HelperRelay.swift) -----------------------------------------------
  // web/helper.js sends requests for hosts without browser CORS to <helper URL>/p with the target in X-TN-Target.
  // Here that address is a name that never reaches the network: fetch() to it is answered by the app itself.
  var HELPER = 'https://helper.telenova.invalid';
  var realFetch = window.fetch;
  function unb64(s) {
    var bin = atob(s || ''), a = new Uint8Array(bin.length), i = 0;
    for (; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  async function relay(input, init) {
    var signal = init && init.signal;
    var aborted = function () { return new DOMException('Aborted', 'AbortError'); };
    if (signal && signal.aborted) throw aborted();
    var req = new Request(input, init);
    var path = new URL(req.url).pathname;
    if (path === '/ping') {
      return new Response(JSON.stringify({ok: true, app: 'telenova-helper', v: 1, native: 'ios'}),
        {status: 200, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}});
    }
    var headers = {};
    req.headers.forEach(function (v, k) { headers[k.toLowerCase()] = v; });
    var body = '';
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      var buf = await req.arrayBuffer();
      if (buf.byteLength) body = b64(buf);
    }
    var asked = mh.postMessage({op: 'relay', method: req.method, headers: headers, body: body});
    var r = await (signal ? Promise.race([asked, new Promise(function (res, rej) {
      signal.addEventListener('abort', function () { rej(aborted()); }, {once: true});
    })]) : asked);
    var st = Number(r.status) || 502;
    var empty = st === 204 || st === 205 || st === 304 || req.method === 'HEAD';
    return new Response(empty ? null : unb64(r.body), {status: st, headers: r.headers || {}});
  }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf(HELPER + '/') !== 0) return realFetch.apply(this, arguments);
    return relay(input, init);
  };
  // the page reads the helper address from its own settings: fill it in when the viewer has none of their own
  var tries = 0, timer = setInterval(function () {
    try {
      var S = self.TN && self.TN.settings;
      if (S) { clearInterval(timer); if (!S.get('helper', '')) S.set('helper', HELPER); return; }
    } catch (e) { clearInterval(timer); return; }
    if (++tries > 240) clearInterval(timer);
  }, 250);

  window.TeleNovaNative = {
    helper: HELPER,                                                    // the built-in relay's address
    platform: 'ios',
    save: save,                                                        // save(blob, name) -> {ok, path}
    files: function () { return mh.postMessage({op: 'files'}); },      // opens the app's file browser
    importFiles: function () { return mh.postMessage({op: 'import'}); },
    scanPair: function () { return mh.postMessage({op: 'scan'}); }
  };
})();
