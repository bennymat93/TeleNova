'use strict';
// The Google sign-in returns here (OAuth implicit flow: the token is in the #fragment, which never reaches a server).
// The fragment is wiped from the address at once. Then one of two things:
//   pop-up flow    the answer goes to the app window that opened this one (same origin only) and this window closes
//   same-tab flow  (no opener: TV browsers, blocked pop-ups) the state is compared with the one the app page kept in
//                  sessionStorage, the token is kept there too (this tab only) and the tab returns to the app's Drive page
// Nothing is logged, nothing is put in an address, and nothing is kept past this tab.
(function () {
  var h = new URLSearchParams(location.hash.slice(1));
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  var token = h.get('access_token') || '';
  if (!/^[A-Za-z0-9._~+\/-]{20,4096}$/.test(token)) token = '';
  var msg = {type: 'tn_gdrive', state: h.get('state') || '', token: token, expires: Math.max(0, Math.min(86400, Number(h.get('expires_in')) || 0)),
             error: String(h.get('error') || '').slice(0, 80)};
  var line = document.querySelector('p');
  var opener = null;
  try { opener = window.opener && !window.opener.closed ? window.opener : null; } catch (e) { opener = null; }
  if (opener) {
    try { opener.postMessage(msg, location.origin); } catch (e) {}
    window.close();
    if (line) line.textContent = msg.token ? 'OK' : 'Google Drive: ' + (msg.error || 'no answer');
    return;
  }
  // the same-tab flow
  var want = '';
  try { want = sessionStorage.getItem('tn_gd_state') || ''; sessionStorage.removeItem('tn_gd_state'); } catch (e) {}
  var ok = !!(msg.token && want && msg.state === want);
  if (ok) {
    try { sessionStorage.setItem('tn_gd', JSON.stringify({token: msg.token, until: Date.now() + (msg.expires || 3600) * 1000})); } catch (e) { ok = false; }
  }
  if (line) line.textContent = ok ? 'OK' : 'Google Drive: ' + (msg.error || 'no answer');
  // back to the app (the error, when there is one, is a short word of Google's, never the token)
  location.replace('./#/gdrive' + (ok ? '' : '/err=' + encodeURIComponent(msg.error === 'access_denied' ? 'denied' : (msg.error || 'failed').replace(/[^a-z_]/gi, '').slice(0, 30))));
})();
