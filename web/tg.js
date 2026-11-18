'use strict';
// The Telegram side of BN Stream Web: login, the account's shared document in "Saved Messages", and the sync loop.
// Loaded by app.js only when the viewer chooses to connect (or was connected before); everything else in the app
// works without it. The sign-in screen is tglogin.js (page #/tglogin); other modules get the signed-in client from
// TG.client() (WP-1 interface, see MODULES.md). The browser signs in as its own device: Kodi's session is never used.
// The phone-number login is tested with a mocked client (src/qa/web/t_tglogin.js); a real sign-in needs a real account
// (see README.md, "How to test").
//
// Libraries, fetched here on first use:
//   vendor/gramjs-2.26.21.min.js  GramJS, the MTProto client (window.GramJS) - our own bundle, see src/qa/web/build_gramjs.py
//   fflate 0.8.2 + sealed.js      the build's sealed file format (zlib, zip, PBKDF2 / HMAC through WebCrypto)
//   qrcode-generator 1.4.4        draws the login QR code on a canvas
// What is kept in this browser (localStorage, keys bn_*):
//   tg_api      {id, hash} - typed by the viewer or taken from the build's pairing link (#pair=<id>.<hash>)
//   tg_session  the GramJS session string - ONLY when the viewer ticked "keep me connected" under the warning
//   sync_meta   the mark of the document last seen, a hash of the local lists
//   synced      the few settings a browser may read from the document (TMDb key, metadata language)
// In sessionStorage (this tab only, gone when the tab closes):
//   bn_tg_pending  a phone login that waits for its code: {phone, hash, where, session, keep} - the session is NOT signed
//                  in; kept at most 10 minutes so that Cancel / "another number" / a reload do not ask Telegram for a new
//                  code (every new request cancels the previous code). Removed on success, expiry and logout.
//   bn_tg_flood    until when Telegram asked not to request codes (a time, nothing else)
// Nothing here is ever written to the console, put into an address, or shown: errors show Telegram's error CODE only.
(function (root) {
  const LIBS = [
    ['GramJS', 'vendor/gramjs-2.26.21.min.js', 'sha384-vLpLXTCvkXKJ+0bVYmKOYufkvr49+ItiV6bVYF6xfsSg3iFTAv2CJyTGGDL9Z747'],
    ['fflate', 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js', 'sha384-DT0Ls0mO7JmjTnT+oBuMhEJzYJO1zUqzuuMXNdnOmOQRIpN2BgSjvBV/j50NngIT'],
    ['Sealed', 'sealed.js', 'sha384-3QiOYAjKOjUimzokSr13TVO6o8T7mwjpx2sVoXcfFSLnX+slMlEH14GsyFCW1hgC'],
    ['qrcode', 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js', 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k'],
  ];
  const PERIOD = 45000, DEBOUNCE = 3000, MAX_DOC = 16 * 1024 * 1024;
  let A = null;                                  // what app.js hands over: SD, WS, store, get, put, drop, X, fmt, esc, button, loadScript, onSynced, onSettings
  let client = null, me = null, key = '';
  let state = 'off';                             // off | connecting | login | on | other_tab | offline
  let info = {sync: '', last: 0, error: '', busy: false, kept: false, note: ''};
  let memSession = '';                           // a login the viewer did not ask to keep: this tab only
  let panelEl = null, loginUi = null, cancelLogin = null, releaseLock = null;
  let timer = null, debounce = null, running = false, again = false, wired = false, loginGen = 0;
  let listeners = [];                            // TG.on(fn): fn(state) after every change of state or login step

  const G = () => root.GramJS;
  const creds = () => { const c = A.get('tg_api', null); return c && /^\d{3,12}$/.test(String(c.id)) && /^[0-9a-f]{32}$/.test(String(c.hash)) ? c : null; };
  const savedSession = () => memSession || String(A.get('tg_session', '') || '');
  // a phone login that waits for its code, and the time Telegram asked to wait (see the header): this tab's
  // sessionStorage only. Called when a sign-in succeeds and when the login is wiped; storage that refuses must
  // never break a sign-in. (Both were called but not defined: every sign-in failed at its last step.)
  function dropPending() { try { sessionStorage.removeItem('bn_tg_pending'); } catch (e) { /* no storage */ } }
  function setFlood(until) {
    try { if (until) sessionStorage.setItem('bn_tg_flood', String(Number(until) || 0)); else sessionStorage.removeItem('bn_tg_flood'); } catch (e) { /* no storage */ }
  }
  function set(s, patch) { state = s; Object.assign(info, patch || {}); draw(); }

  async function libs() {
    for (const [name, src, integrity] of LIBS) if (!root[name]) await A.loadScript(src, integrity);
    if (!G() || !root.Sealed || !root.fflate || !root.qrcode) throw new Error('offline');
  }
  // what the viewer may see of an error: a text of ours, or Telegram's error code (PHONE_CODE_INVALID ...) - never anything else
  // the texts this file adds to the app's (he / en / ru, the same keys in each)
  const TEXTS = {
    he: {
      tge_flood_for: 'טלגרם מבקש להמתין %s לפני ניסיון נוסף. אל תבקשו קוד שוב עד אז - כל בקשה מאריכה את החסימה. כניסה בקוד QR עדיין אפשרית.',
      tge_flood_day: 'טלגרם חסם בקשות קוד למספר הזה לכמה שעות (יותר מדי בקשות). המתינו ואל תבקשו שוב. כניסה בקוד QR עדיין אפשרית.',
      tge_no_more_ways: 'טלגרם לא מציע דרך אחרת לשלוח את הקוד. הקוד נמצא באפליקציית טלגרם, בצ\'אט בשם "Telegram".',
      tge_too_early: 'אפשר לבקש משלוח נוסף בעוד %s.',
      tge_restart: 'טלגרם איפס את תהליך הכניסה. נסו שוב.',
      tge_w_sec: '%s שניות', tge_w_min: '%s דקות', tge_w_hour: 'כ-%s שעות',
    },
    en: {
      tge_flood_for: 'Telegram asks you to wait %s before another attempt. Do not ask for a code again until then - every request makes the block longer. Signing in with the QR code still works.',
      tge_flood_day: 'Telegram blocked code requests for this number for some hours (too many requests). Wait and do not ask again. Signing in with the QR code still works.',
      tge_no_more_ways: 'Telegram offers no other way to send the code. The code is in the Telegram app, in the chat named "Telegram".',
      tge_too_early: 'Another delivery can be asked for in %s.',
      tge_restart: 'Telegram restarted the sign-in. Try again.',
      tge_w_sec: '%s seconds', tge_w_min: '%s minutes', tge_w_hour: 'about %s hours',
    },
    ru: {
      tge_flood_for: 'Telegram просит подождать %s перед новой попыткой. Не запрашивайте код до этого - каждый запрос продлевает блокировку. Вход по QR-коду по-прежнему работает.',
      tge_flood_day: 'Telegram на несколько часов заблокировал запросы кода для этого номера (слишком много запросов). Подождите и не запрашивайте снова. Вход по QR-коду по-прежнему работает.',
      tge_no_more_ways: 'Telegram не предлагает другого способа отправить код. Код находится в приложении Telegram, в чате «Telegram».',
      tge_too_early: 'Запросить другую доставку можно через %s.',
      tge_restart: 'Telegram перезапустил вход. Попробуйте ещё раз.',
      tge_w_sec: '%s сек.', tge_w_min: '%s мин.', tge_w_hour: 'около %s ч.',
    },
  };
  let textsIn = false;
  function tx(k, a) {
    const N = root.TN;
    if (N && N.t) {
      if (!textsIn && N.i18n && N.i18n.add) { N.i18n.add(TEXTS); textsIn = true; }
      return a == null ? N.t(k) : N.t(k, a);
    }
    return a == null ? k : k + ':' + a;          // (no page around: the tests)
  }
  // 45 -> '45 seconds', 90 -> '2 minutes', 7300 -> 'about 2 hours' (tgauth.wait_text)
  function waitText(seconds) {
    const s = Math.max(1, Math.floor(Number(seconds) || 0));
    if (s < 90) return tx('tge_w_sec', String(s));
    if (s < 5400) return tx('tge_w_min', String(Math.floor((s + 59) / 60)));
    return tx('tge_w_hour', String(Math.floor((s + 1800) / 3600)));
  }
  function say(e) {
    const code = e && typeof e.errorMessage === 'string' && /^[A-Z0-9_]{3,60}$/.test(e.errorMessage) ? e.errorMessage : '';
    if (e && e.seconds && /FLOOD/.test(code)) return tx('tge_flood_for', waitText(e.seconds));
    if (/^(PHONE_NUMBER_FLOOD|PHONE_PASSWORD_FLOOD)$/.test(code)) return tx('tge_flood_day');
    if (code === 'SEND_CODE_UNAVAILABLE') return tx('tge_no_more_ways');
    if (code === 'AUTH_RESTART') return tx('tge_restart');
    if (/^PHONE_CODE_(INVALID|EMPTY)$/.test(code)) return A.X('e_code');
    if (code === 'PHONE_CODE_EXPIRED') return A.X('e_code_expired');
    if (code === 'PASSWORD_HASH_INVALID') return A.X('e_pass');
    if (/^PHONE_NUMBER_(INVALID|BANNED)$/.test(code)) return A.X('e_phone');
    if (code === 'PHONE_NUMBER_UNOCCUPIED') return A.X('e_signup');
    if (/^API_ID_(INVALID|PUBLISHED_FLOOD)$/.test(code)) return A.X('e_api');
    if (dead(e)) return A.X('e_session');
    if (code) return A.fmt('e_generic', code);
    return root.navigator.onLine === false ? A.X('tg_offline') : A.X('e_net');
  }
  const dead = (e) => !!(e && typeof e.errorMessage === 'string' && /^(AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|USER_DEACTIVATED_BAN|AUTH_KEY_DUPLICATED)$/.test(e.errorMessage));

  // ---------------------------------------------------------------- the client
  // one tab of a browser holds the Telegram connection (two connections on one session disturb each other)
  function lock() {
    if (releaseLock) return Promise.resolve(true);
    if (!root.navigator.locks) { releaseLock = () => {}; return Promise.resolve(true); }
    return new Promise((got) => {
      root.navigator.locks.request('bn-tg', {ifAvailable: true}, (l) => {
        if (!l) { got(false); return undefined; }
        got(true);
        return new Promise((free) => { releaseLock = free; });
      }).catch(() => got(false));
    });
  }
  function unlock() { if (releaseLock) { releaseLock(); releaseLock = null; } }
  // fresh: a new login. session: the not-yet-signed-in session a code was asked on (the code belongs to its key);
  // without it a fresh login starts on an empty session
  async function open(fresh, session) {
    const c = creds();
    if (!c) throw new Error('no api');
    await libs();
    if (client) return client;
    client = new (G().TelegramClient)(new (G().sessions.StringSession)(fresh ? (session || '') : savedSession()), Number(c.id), c.hash,
                                      {connectionRetries: 3, useWSS: true, deviceModel: 'BN Stream Web', appVersion: A.version, systemVersion: 'Browser'});
    client.setLogLevel('none');
    await client.connect();
    return client;
  }
  async function close(keepKey) {            // keepKey: a code is waiting on this connection's key - only hang up
    const c = client;
    client = null; me = null; key = '';
    if (c) { try { if (keepKey) await c.disconnect(); else await c.destroy(); } catch (e) {} }
  }
  async function signedIn(keep) {
    dropPending(); setFlood(0);
    const user = await client.getMe();
    me = {id: String(user.id), name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || '', username: user.username || ''};
    key = root.Sealed.cloudKey(me.id);           // the document's password is made of the account's id, as the build makes it
    const s = client.session.save();
    if (keep) { A.put('tg_session', s); memSession = ''; } else if (!A.get('tg_session', '')) memSession = s;
    info.kept = !!A.get('tg_session', '');
    set('on', {error: '', note: ''});
    startLoop();
    round('login');
  }
  // a browser that was connected before: connect and start syncing, with nothing on the screen
  async function resume() {
    if (state === 'on' || state === 'connecting' || state === 'login' || !creds() || !savedSession()) return;
    if (!(await lock())) { set('other_tab'); retryLater(); return; }
    set('connecting');
    try {
      await open();
      if (await client.checkAuthorization()) return await signedIn(!!A.get('tg_session', ''));
      await forget();                            // logged out from another device: the stale login is removed here
      set('off', {error: A.X('e_session')});
    } catch (e) {
      await close();
      unlock();
      set(root.GramJS ? 'off' : 'offline', {error: say(e)});
      retryLater();
    }
  }
  let retry = null;
  function retryLater() { clearTimeout(retry); retry = setTimeout(() => { if (state !== 'on' && state !== 'login' && state !== 'connecting' && savedSession()) resume(); }, PERIOD); }
  async function forget() {
    stopLoop();
    await close();
    unlock();
    memSession = '';
    dropPending(); setFlood(0);
    A.drop('tg_session'); A.drop('sync_meta'); A.drop('synced');
    A.onSettings({});
  }
  // logs out at Telegram (the session stops existing) and wipes the login from this browser. The API details stay:
  // they are the app's, not the account's, and the next sign-in needs them (TG.forgetApi() deletes them).
  async function disconnect() {
    let reached = true;
    try { if (client) await client.invoke(new (G().Api.auth.LogOut)()); else reached = false; } catch (e) { reached = false; }
    await forget();
    set('off', {error: reached ? '' : A.X('tg_logout_fail'), sync: '', last: 0});
  }

  // ---------------------------------------------------------------- login
  // A login runs as a chain of steps; each step that needs the viewer publishes `loginUi` ({step, ...}) and waits for
  // answer(). The page that draws it (tglogin.js) only reads step() and calls
  // answer / resend / back / cancel. Steps: wait | qr {url, expires} | phone | code {phone, via, length, next, timeout,
  // canResend} | password {hint}.
  // The browser always signs in as a NEW device (its own authorization): the session of Kodi is never used here.
  const RESEND = {resend: true}, BACK = {back: true};
  function ask(step, extra) {
    return new Promise((answer, reject) => { loginUi = Object.assign({step, answer, reject}, extra || {}); draw(); });
  }
  // '054-123 4567' -> '+972541234567', as tgauth.normalize_phone; '' when it cannot be a number
  function normalizePhone(text, cc) {
    const raw = String(text || '').trim();
    let d = raw.replace(/\D/g, '');
    cc = cc || '972';
    if (raw.startsWith('+')) { /* already international */ } else if (d.startsWith('00')) d = d.slice(2);
    else if (d.startsWith('0')) d = cc + d.slice(1);
    else if (d.length <= 9) d = cc + d;
    return d.length >= 8 && d.length <= 15 ? '+' + d : '';
  }
  // auth.SentCode -> where the code went (tgauth.sent_info)
  function sentInfo(sent) {
    const kind = (o) => {
      const n = String((o && (o.className || (o.constructor && o.constructor.name))) || '').toLowerCase();
      if (!n) return '';
      for (const [k, v] of [['app', 'app'], ['sms', 'sms'], ['flashcall', 'call'], ['missedcall', 'call'], ['call', 'call'], ['email', 'email']]) if (n.includes(k)) return v;
      return 'other';
    };
    const t = sent && sent.type;
    return {via: kind(t) || 'other', length: Number(t && t.length) || 0, next: kind(sent && sent.nextType),
            timeout: Number(sent && sent.timeout) || 0, canResend: !!(sent && sent.nextType)};
  }
  const isCls = (o, name) => !!(o && (o.className === name || (G().Api.auth[name.replace(/^auth\./, '')] && o instanceof G().Api.auth[name.replace(/^auth\./, '')])));

  async function phoneFlow(apiCreds, password, onError) {
    const Api = G().Api;
    for (;;) {
      const raw = await ask('phone', {});
      const phone = normalizePhone(raw);
      if (!phone) { info.error = A.X('e_phone'); continue; }
      let sent;
      try {
        sent = await client.invoke(new Api.auth.SendCode({phoneNumber: phone, apiId: apiCreds.apiId, apiHash: apiCreds.apiHash, settings: new Api.CodeSettings({})}));
      } catch (e) { if (await onError(e)) throw new Error('AUTH_USER_CANCEL'); continue; }
      if (isCls(sent, 'auth.SentCodeSuccess')) return;
      let hash = sent.phoneCodeHash, where = sentInfo(sent);
      for (;;) {
        const code = await ask('code', Object.assign({phone}, where));
        if (code === BACK) break;
        if (code === RESEND) {
          try {
            const r = await client.invoke(new Api.auth.ResendCode({phoneNumber: phone, phoneCodeHash: hash}));
            if (isCls(r, 'auth.SentCodeSuccess')) return;
            hash = r.phoneCodeHash; where = sentInfo(r); info.error = '';
          } catch (e) { if (await onError(e)) throw new Error('AUTH_USER_CANCEL'); }
          continue;
        }
        try {
          const r = await client.invoke(new Api.auth.SignIn({phoneNumber: phone, phoneCodeHash: hash, phoneCode: String(code)}));
          if (isCls(r, 'auth.AuthorizationSignUpRequired')) { info.error = A.X('e_signup'); break; }
          return;
        } catch (e) {
          const m = e && e.errorMessage;
          if (m === 'SESSION_PASSWORD_NEEDED') { await client.signInWithPassword(apiCreds, {password, onError}); return; }
          if (await onError(e)) throw new Error('AUTH_USER_CANCEL');
          if (m === 'PHONE_CODE_EXPIRED' || m === 'PHONE_NUMBER_INVALID') break;      // back to the number
        }
      }
    }
  }
  async function login(how, keep) {
    if (state === 'login' || state === 'on') return;
    if (!creds()) return set('off', {error: A.X('e_api')});
    if (!(await lock())) return set('other_tab');
    let cancelled = false;
    const gen = ++loginGen;                      // a cancelled login may end much later (GramJS waits out its QR timer): it must not touch a newer one
    loginUi = {step: 'wait'};
    set('login', {error: '', note: ''});
    cancelLogin = async () => {
      cancelled = true; loginGen++; cancelLogin = null;
      const ui = loginUi;
      loginUi = null;
      if (ui && ui.reject) ui.reject(new Error('cancel'));
      await close();
      unlock();
      set('off', {error: ''});
    };
    const onError = async (e) => { if (!cancelled && gen === loginGen) { info.error = say(e); draw(); } return cancelled || gen !== loginGen || dead(e); };   // true = stop asking
    const password = (hint) => ask('password', {hint: typeof hint === 'string' ? hint : ''});
    try {
      if (client) await close();                 // a fresh connection for a fresh login
      await open(true);
      const apiCreds = {apiId: Number(creds().id), apiHash: creds().hash};
      if (how === 'qr') {
        await client.signInUserWithQrCode(apiCreds, {
          qrCode: async (code) => {
            if (cancelled || gen !== loginGen) return;
            loginUi = {step: 'qr', url: 'tg://login?token=' + b64url(code.token), expires: Number(code.expires) || 0};
            info.error = ''; draw();
          },
          password, onError});
      } else await phoneFlow(apiCreds, password, onError);
      if (gen !== loginGen) return;
      loginUi = null; cancelLogin = null;
      await signedIn(keep);
    } catch (e) {
      if (gen !== loginGen) return;
      loginUi = null; cancelLogin = null;
      await close();
      unlock();
      set('off', {error: cancelled || (e && e.message === 'AUTH_USER_CANCEL') ? info.error : say(e)});
    }
  }
  const b64url = (buf) => G().Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  function drawQr(canvas, text) {
    const qr = root.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount(), cell = 6, pad = 4 * cell, ctx = canvas.getContext('2d');
    canvas.width = canvas.height = n * cell + 2 * pad;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(pad + c * cell, pad + r * cell, cell, cell);
  }
  // the pairing link of the build (webpair.py): <site>/web/#pair=<id>.<hash>, or just "<id>.<hash>" / "<id> <hash>"
  function parsePair(text) {
    const s = String(text || '').trim();
    const m = /(?:#pair=|^)(\d{3,12})[.\s:]+([0-9a-f]{32})(?:$|[&\s])/i.exec(s);
    return m ? {id: m[1], hash: m[2].toLowerCase()} : null;
  }
  function setApi(id, hash) {
    id = String(id || '').trim(); hash = String(hash || '').trim().toLowerCase();
    if (!/^\d{3,12}$/.test(id) || !/^[0-9a-f]{32}$/.test(hash)) return false;
    const was = creds();
    if (was && (was.id !== id || was.hash !== hash) && state !== 'off') return false;      // not under a running login
    A.put('tg_api', {id, hash});
    info.error = ''; draw();
    return true;
  }

  // ---------------------------------------------------------------- the account's document (tgclient.py cloud_list / cloud_get / cloud_put)
  async function cloudList() {
    const msgs = await client.getMessages('me', {search: A.WS.TAG, limit: 30});
    const out = [];
    for (const m of msgs) {
      const doc = m && m.media && m.media.document, note = A.WS.noteOf(m && m.message);
      if (!doc || !note) continue;               // a file whose caption starts with the tag - nothing else is ever touched
      out.push({id: m.id, date: Number(m.date) || 0, size: Number(doc.size) || 0, note, msg: m});
    }
    return out.sort((a, b) => b.date - a.date);
  }
  const host = {
    loadMeta: () => A.get('sync_meta', {}) || {},
    saveMeta: (m) => A.put('sync_meta', m),
    users: () => A.store.users(),
    userData: (uid) => A.store.data(uid),
    setUsers: (list) => A.store.setUsers(list, true),
    putUserData: (uid, d) => A.store.putData(uid, d, true),
    takeSettings: (v) => { A.put('synced', v); A.onSettings(v); },
    cloudFind: async () => A.WS.mine(await cloudList()),
    async cloudGet(item) {
      if (item.size > MAX_DOC) return null;
      const buf = await client.downloadMedia(item.msg, {});
      if (!buf || !buf.length) return null;
      try { return A.SD.parse(await root.Sealed.unpackDoc(new Uint8Array(buf.buffer, buf.byteOffset, buf.length), key)); } catch (e) { return null; }   // not readable: never written over
    },
    async cloudPut(doc) {
      const blob = await root.Sealed.packDoc(A.SD.canon(doc), key, A.WS.NOTE);
      const buf = G().Buffer.from(blob.buffer, blob.byteOffset, blob.length);
      const file = new (G().CustomFile)('TeleNova-setup-' + A.WS.DOC_DEVICE + '.tnsync', buf.length, '', buf);
      const msg = await client.sendFile('me', {file, caption: A.WS.caption(A.WS.NOTE), forceDocument: true, silent: true, parseMode: false, workers: 1});
      if (!msg || !msg.id) return '';
      // the older files of the document go, as after an upload of the build
      const old = (await cloudList()).filter((x) => x.id !== msg.id && x.note.device === A.WS.DOC_DEVICE).map((x) => x.id);
      if (old.length) await client.deleteMessages('me', old, {revoke: true});
      return msg.id + ':' + (Number(msg.date) || Math.floor(Date.now() / 1000));
    },
  };

  // ---------------------------------------------------------------- the loop: every 45 s while the page is visible, 3 s after a local
  // change, and when the page comes back to the front or the network comes back
  async function round(why) {
    if (state !== 'on' || !client) return;
    if (root.document.hidden && why === 'timer') return;
    if (root.navigator.onLine === false) return;
    if (running) { again = true; return; }
    running = true;
    info.busy = true; draw();
    try {
      if (!client.connected) await client.connect();
      const res = await A.WS.cycle(host);
      info.sync = res.state; info.last = Date.now(); info.error = '';
      if (res.users || res.data.length) A.onSynced(res);
    } catch (e) {
      if (dead(e)) { await forget(); running = false; info.busy = false; return set('off', {error: A.X('e_session')}); }
      info.error = say(e);
    }
    running = false; info.busy = false;
    draw();
    if (again) { again = false; changed(); }
  }
  function changed() { clearTimeout(debounce); debounce = setTimeout(() => round('change'), DEBOUNCE); }
  function startLoop() {
    clearInterval(timer);
    timer = setInterval(() => round('timer'), PERIOD);
    if (wired) return;
    wired = true;
    A.store.onChange(() => { if (state === 'on') changed(); });
    root.document.addEventListener('visibilitychange', () => { if (!root.document.hidden) round('visible'); });
    root.addEventListener('online', () => round('online'));
  }
  function stopLoop() { clearInterval(timer); clearTimeout(debounce); timer = null; }


  // ---------------------------------------------------------------- the panel in Settings (the login itself is the page #/tglogin)
  function el(tag, cls, text) { const e = root.document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const loginLink = (cls, text) => { const a = el('a', cls, text); a.href = '#/tglogin'; return a; };
  function draw() {
    for (const fn of listeners.slice()) { try { fn(state); } catch (e) {} }
    const box = panelEl;
    if (!box || !box.isConnected) return;
    const hadFocus = box.contains(root.document.activeElement) && root.document.activeElement.tagName === 'INPUT';
    if (hadFocus) return;                        // not under the viewer's fingers
    const X = A.X, parts = [];
    const err = () => { const p = el('p', 'tgerr', info.error || ''); p.setAttribute('role', 'alert'); return p; };
    if (state === 'offline') parts.push(el('p', 'hint', X('tg_offline')), err(), A.button('btn', X('tg_connect'), () => resume()));
    else if (state === 'other_tab') parts.push(el('p', 'hint', X('tg_other_tab')), A.button('btn ghost', X('tg_connect'), () => { state = 'off'; if (savedSession()) resume(); else draw(); }));
    else if (state === 'connecting') parts.push(el('p', 'hint', X('tg_wait')));
    else if (state === 'login') parts.push(el('p', 'hint', X('tg_wait')), err(), loginLink('btn', X('tg_connect')));
    else if (state === 'on') {
      const st = el('div', 'tgstate ' + (info.error ? 'err' : 'on'));
      st.append(el('i'), el('span', '', A.fmt('tg_on', me ? me.name : '')));
      parts.push(st);
      const line = info.busy ? X('tg_syncing') : info.sync === 'nodoc' ? X('tg_nodoc') : info.sync === 'unreadable' ? X('tg_unreadable')
        : info.last ? A.fmt('tg_last', new Date(info.last).toLocaleTimeString()) : '';
      parts.push(el('p', 'hint', line));
      if (!info.kept) parts.push(el('p', 'hint', X('tg_memory')));
      parts.push(err());
      const row = el('div', 'links');
      row.append(A.button('btn', X('tg_sync_now'), () => round('asked')), A.button('btn ghost', X('tg_disconnect'), (e) => {
        if (e.target.dataset.sure) disconnect(); else { e.target.dataset.sure = '1'; e.target.textContent = X('tg_disconnect_q'); }
      }));
      parts.push(row);
    } else {
      if (info.note) parts.push(el('p', 'hint', info.note));
      parts.push(el('p', 'hint', X('tg_api_about')), err(), loginLink('btn', X('tg_connect')));
    }
    box.replaceChildren(...parts);
  }

  // the client for the other modules (search, playback...): connected and signed in, or an Error with message
  // TG_NO_LOGIN | TG_OTHER_TAB | TG_LOGIN_RUNNING | TG_OFFLINE
  let resuming = null;
  async function getClient() {
    if (!A) throw new Error('TG_NO_LOGIN');
    if (state === 'on' && client) {
      if (!client.connected) await client.connect();
      return client;
    }
    if (state === 'login') throw new Error('TG_LOGIN_RUNNING');
    if (!creds() || !savedSession()) throw new Error('TG_NO_LOGIN');
    if (!resuming) resuming = resume().finally(() => { resuming = null; });
    await resuming;
    if (state === 'on' && client) return client;
    throw new Error(state === 'other_tab' ? 'TG_OTHER_TAB' : state === 'offline' ? 'TG_OFFLINE' : 'TG_NO_LOGIN');
  }
  const publicStep = () => {
    if (!loginUi) return state === 'login' ? {step: 'wait'} : null;
    const out = {};
    for (const [k, v] of Object.entries(loginUi)) if (typeof v !== 'function') out[k] = v;
    return out;
  };
  function answer(v) {
    const ui = loginUi;
    if (!ui || !ui.answer) return false;
    loginUi = {step: 'wait'}; info.error = '';
    draw();
    ui.answer(v);
    return true;
  }

  const api = {
    ready: false,
    init(app) { A = app; api.ready = true; },
    // the small panel in Settings (state, sync, disconnect; "Connect" leads to #/tglogin)
    panel(box, paired) {
      panelEl = box;
      if (paired) {
        info.note = A.X('tg_paired');
        if (state === 'off' && !savedSession()) { root.location.hash = '#/tglogin'; return; }      // straight to the sign-in
      }
      if (state === 'off' && creds() && savedSession()) resume(); else draw();
    },
    resume, status: () => ({state, sync: info.sync, last: info.last, name: me ? me.name : ''}),
    syncNow: () => round('asked'),
    // ---- for the other modules
    client: getClient,
    connected: () => state === 'on' && !!client,
    me: () => (me ? {id: me.id, name: me.name, username: me.username || ''} : null),
    on(fn) { listeners.push(fn); return () => { listeners = listeners.filter((f) => f !== fn); }; },
    // ---- for the login page (tglogin.js)
    state: () => state,
    error: () => info.error || '',
    note: () => info.note || '',
    step: publicStep,
    hasApi: () => !!creds(),
    apiId: () => (creds() ? creds().id : ''),
    setApi, parsePair,
    forgetApi() { if (state === 'off' || state === 'offline') { A.drop('tg_api'); info.error = ''; info.note = ''; draw(); return true; } return false; },
    hasSession: () => !!savedSession(),
    login,
    answer,
    resend: () => answer(RESEND),
    back: () => answer(BACK),
    cancel: () => (cancelLogin ? cancelLogin() : Promise.resolve()),
    logout: () => disconnect(),
    drawQr,
    loadLibs: () => libs(),
    normalizePhone, sentInfo,
  };
  root.TG = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
