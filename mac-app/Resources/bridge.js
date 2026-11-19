// BN Stream for Mac: injected into the page (main frame, document start) by MacWebController.swift.
// 1. The helper Worker is built in: fetch() to https://helper.telenova.invalid/p and /ping is answered by the app
//    (HelperRelay.swift, the allow-list of worker/index.js); the address is filled into the page's helper setting.
// 2. Google Drive sign-in: window.open of Google's page runs in the system sign-in sheet, the answer comes back as the
//    pop-up's message (state 'tnapp-', web/gdrive_cb.js).
// 3. window.TeleNovaNative {platform: 'mac'}: the page knows it is inside the app. Downloads and <input type=file> are
//    handled by WebKit itself (save / open panels of macOS).
(function () {
  'use strict';
  if (window.__tnNative) return;
  var mh = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.telenova;
  if (!mh) return;
  window.__tnNative = true;

  function b64(buf) {
    var a = new Uint8Array(buf), s = '', i = 0;
    for (; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(s || ''), a = new Uint8Array(bin.length), i = 0;
    for (; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  // ---- built-in helper
  var HELPER = 'https://helper.telenova.invalid';
  var realFetch = window.fetch;
  async function relay(input, init) {
    var signal = init && init.signal;
    var aborted = function () { return new DOMException('Aborted', 'AbortError'); };
    if (signal && signal.aborted) throw aborted();
    var req = new Request(input, init);
    if (new URL(req.url).pathname === '/ping') {
      return new Response(JSON.stringify({ok: true, app: 'telenova-helper', v: 1, native: 'mac'}),
        {status: 200, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}});
    }
    var headers = {};
    req.headers.forEach(function (v, k) { headers[k.toLowerCase()] = v; });
    var body = '';
    if (req.method !== 'GET' && req.method !== 'HEAD') { var buf = await req.arrayBuffer(); if (buf.byteLength) body = b64(buf); }
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
  var tries = 0, timer = setInterval(function () {
    try {
      var S = self.TN && self.TN.settings;
      if (S) { clearInterval(timer); if (!S.get('helper', '')) S.set('helper', HELPER); return; }
    } catch (e) { clearInterval(timer); return; }
    if (++tries > 240) clearInterval(timer);
  }, 250);

  // ---- Google Drive sign-in
  var realOpen = window.open;
  window.open = function (url) {
    var u = String(url || '');
    if (u.indexOf('https://accounts.google.com/o/oauth2/') !== 0) return realOpen.apply(window, arguments);
    var fake = {closed: false, close: function () { fake.closed = true; }, focus: function () {}, postMessage: function () {}};
    try {
      var x = new URL(u);
      x.searchParams.set('state', 'tnapp-' + (x.searchParams.get('state') || ''));
      mh.postMessage({op: 'gauth', url: x.toString()}).then(function () { fake.closed = true; }, function () { fake.closed = true; });
    } catch (e) { return null; }
    return fake;
  };

  window.TeleNovaNative = {helper: HELPER, platform: 'mac'};
})();
