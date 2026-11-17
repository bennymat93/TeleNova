'use strict';
// The Google sign-in returns here (OAuth implicit flow: the token is in the #fragment, which never reaches a server).
// The fragment is wiped from the address at once, the answer goes to the app window that opened this one (same
// origin only), and this window closes. Nothing is stored or logged here.
(function () {
  const h = new URLSearchParams(location.hash.slice(1));
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  const msg = {type: 'tn_gdrive', state: h.get('state') || '', token: h.get('access_token') || '', expires: Number(h.get('expires_in') || 0),
               error: h.get('error') || ''};
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(msg, location.origin);
    window.close();
  }
  document.querySelector('p').textContent = msg.token ? 'OK - you can close this window.' : 'Google Drive: ' + (msg.error || 'no answer');
})();
