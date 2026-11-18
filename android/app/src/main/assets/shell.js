// Injected by the Android app into the BN Stream page (document start, main origin only). It changes nothing in the
// page's own code: it only (1) hands files the page "downloads" (a[download] on a blob: address) to the app, which
// saves them in the app folder, (2) tells the app when a video plays (screen stays on), (3) shows a "Files" button on
// the backup / settings pages. window.TNAndroid is the message channel the app adds; window.TNShell is a small API a
// later web version may call (see android/WEB_CHANGES_NEEDED.md).
(function () {
  'use strict';
  if (window.__tnShell) return;
  window.__tnShell = 1;
  var seq = 0, pend = {}, wired = false;
  function bridge() {
    var B = window.TNAndroid;
    if (B && !wired) {
      wired = true;
      B.onmessage = function (ev) {
        var d = String(ev.data || ''), i = d.indexOf(':'), k = d.slice(i + 1);
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

  // ---- "Files" button on the pages where files are made or needed
  function fab() {
    if (!document.body || !bridge()) return;
    var want = /^#\/(backup|settings|services|library|gdrive)/.test(location.hash || '');
    var b = document.getElementById('tn-android-files');
    if (want && !b) {
      b = document.createElement('button');
      b.id = 'tn-android-files'; b.type = 'button';
      var he = /^he/i.test(document.documentElement.lang || 'he');
      b.textContent = '\u2630 ' + (he ? '\u05E7\u05D1\u05E6\u05D9\u05DD \u05D5\u05E8\u05E2\u05E0\u05D5\u05DF' : 'Files & refresh');
      b.style.cssText = 'position:fixed;z-index:40;bottom:calc(76px + env(safe-area-inset-bottom,0px));inset-inline-end:16px;' +
        'padding:10px 16px;border-radius:24px;border:1px solid rgba(255,255,255,.28);background:#1b2030;color:#fff;' +
        'font:600 14px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.5);cursor:pointer';
      b.addEventListener('click', function () { post({t: 'menu'}); });
      document.body.appendChild(b);
    } else if (!want && b) b.remove();
  }
  window.addEventListener('hashchange', fab);
  window.addEventListener('popstate', fab);
  document.addEventListener('DOMContentLoaded', fab);
  setInterval(fab, 1500);

  window.TNShell = {
    android: true,
    files: function () { post({t: 'files'}); },
    menu: function () { post({t: 'menu'}); },
    refresh: function () { post({t: 'refresh'}); },
    save: function (blob, name) { return save(blob, name); }
  };
})();
