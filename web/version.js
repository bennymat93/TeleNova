'use strict';
// The one place the web version is written. The page (index.html) and the service worker (sw.js, importScripts) both
// read it: the SW cache name is 'bn-web-' + WEB_VERSION, so bumping this line refreshes every installed copy.
self.WEB_VERSION = '5.3.2';
// A browser too old for app.js (a syntax error stops the whole file, and the CSP allows no inline script): when the
// page finished loading and the app object is not there, the plain "this browser is too old" panel of index.html is
// shown instead of an empty page. ES5 only in this block. (Not in the service worker: no document there.)
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function () {
    if (self.TN) return;
    var p = document.getElementById('oldbrowser');
    if (!p) return;
    p.hidden = false;
    p.removeAttribute('hidden');
    var hide = ['rail', 'top', 'view', 'tabs'];
    for (var i = 0; i < hide.length; i++) { var el = document.getElementById(hide[i]); if (el) el.style.display = 'none'; }
  });
}
