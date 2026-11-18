// TeleNova iOS app: injected into the page (main frame, document start) by WebViewController.swift.
// 1. Files the page exports (<a download href="blob:...">, used by backup.js / tgplay.js / player.js) are written by
//    the app into its Documents folder - WKWebView has no download bar of its own.
// 2. navigator.standalone = true, so the page does not offer "add to home screen".
// 3. window.TeleNovaNative: a small API the page may use later (see ios-app/WEB_CHANGES_NEEDED.md).
(function () {
  'use strict';
  if (window.__tnNative) return;
  var mh = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.telenova;
  if (!mh) return;
  window.__tnNative = true;
  try { Object.defineProperty(navigator, 'standalone', {configurable: true, get: function () { return true; }}); } catch (e) { /* stays as it is */ }

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

  window.TeleNovaNative = {
    platform: 'ios',
    save: save,                                                        // save(blob, name) -> {ok, path}
    files: function () { return mh.postMessage({op: 'files'}); },      // opens the app's file browser
    importFiles: function () { return mh.postMessage({op: 'import'}); },
    scanPair: function () { return mh.postMessage({op: 'scan'}); }
  };
})();
