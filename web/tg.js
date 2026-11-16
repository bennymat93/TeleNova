'use strict';
// The Telegram side of BN Stream Web: login, the account's shared document in "Saved Messages", and the sync loop.
// Loaded by app.js only when the viewer chooses to connect (or was connected before); everything else in the app
// works without it. NOT covered by automatic tests - it needs a real account (see README.md, "How to test").
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
// Nothing here is ever written to the console, put into an address, or shown: errors show Telegram's error CODE only.
(function (root) {
  const LIBS = [
    ['GramJS', 'vendor/gramjs-2.26.21.min.js', ''],
    ['fflate', 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js', 'sha384-DT0Ls0mO7JmjTnT+oBuMhEJzYJO1zUqzuuMXNdnOmOQRIpN2BgSjvBV/j50NngIT'],
    ['Sealed', 'sealed.js', ''],
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

  const G = () => root.GramJS;
  const creds = () => { const c = A.get('tg_api', null); return c && /^\d{3,12}$/.test(String(c.id)) && /^[0-9a-f]{32}$/.test(String(c.hash)) ? c : null; };
  const savedSession = () => memSession || String(A.get('tg_session', '') || '');
  function set(s, patch) { state = s; Object.assign(info, patch || {}); draw(); }

  async function libs() {
    for (const [name, src, integrity] of LIBS) if (!root[name]) await A.loadScript(src, integrity);
    if (!G() || !root.Sealed || !root.fflate || !root.qrcode) throw new Error('offline');
  }
  // what the viewer may see of an error: a text of ours, or Telegram's error code (PHONE_CODE_INVALID ...) - never anything else
  function say(e) {
    const code = e && typeof e.errorMessage === 'string' && /^[A-Z0-9_]{3,60}$/.test(e.errorMessage) ? e.errorMessage : '';
    if (e && e.seconds && /FLOOD/.test(code)) return A.fmt('e_flood', String(e.seconds));
    if (/^PHONE_CODE_(INVALID|EMPTY)$/.test(code)) return A.X('e_code');
    if (code === 'PHONE_CODE_EXPIRED') return A.X('e_code_expired');
    if (code === 'PASSWORD_HASH_INVALID') return A.X('e_pass');
    if (/^PHONE_NUMBER_(INVALID|BANNED|FLOOD)$/.test(code)) return A.X('e_phone');
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
  async function open() {
    const c = creds();
    if (!c) throw new Error('no api');
    await libs();
    if (client) return client;
    client = new (G().TelegramClient)(new (G().sessions.StringSession)(savedSession()), Number(c.id), c.hash,
                                      {connectionRetries: 3, useWSS: true, deviceModel: 'BN Stream Web', appVersion: A.version, systemVersion: 'Browser'});
    client.setLogLevel('none');
    await client.connect();
    return client;
  }
  async function close() {
    const c = client;
    client = null; me = null; key = '';
    if (c) { try { await c.destroy(); } catch (e) {} }
  }
  async function signedIn(keep) {
    const user = await client.getMe();
    me = {id: String(user.id), name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || ''};
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
    A.drop('tg_session'); A.drop('sync_meta'); A.drop('synced');
    A.onSettings({});
  }
  async function disconnect() {                  // logs out at Telegram (the session stops existing) and wipes this browser
    let reached = true;
    try { if (client) await client.invoke(new (G().Api.auth.LogOut)()); else reached = false; } catch (e) { reached = false; }
    await forget();
    A.drop('tg_api');
    set('off', {error: reached ? '' : A.X('tg_logout_fail'), sync: '', last: 0});
  }

  // ---------------------------------------------------------------- login
  // each step of a login asks the panel for one answer; "cancel" rejects the waiting step and closes the connection
  function ask(step, extra) {
    return new Promise((answer, reject) => { loginUi = Object.assign({step, answer, reject}, extra || {}); draw(); });
  }
  async function login(how, keep) {
    if (!(await lock())) return set('other_tab');
    let cancelled = false;
    const gen = ++loginGen;                      // a cancelled login may end much later (GramJS waits out its QR timer): it must not touch a newer one
    set('login', {error: '', note: ''});
    loginUi = {step: 'wait'};
    draw();
    cancelLogin = async () => {
      cancelled = true; loginGen++; cancelLogin = null;
      const ui = loginUi;
      loginUi = null;
      if (ui && ui.reject) ui.reject(new Error('cancel'));
      await close();
      unlock();
      set('off', {error: ''});
    };
    const onError = async (e) => { if (!cancelled) { info.error = say(e); draw(); } return cancelled || dead(e); };   // true = stop asking
    const password = (hint) => ask('password', {hint: typeof hint === 'string' ? hint : ''});
    try {
      await open();
      const api = {apiId: Number(creds().id), apiHash: creds().hash};
      if (how === 'qr') {
        await client.signInUserWithQrCode(api, {
          qrCode: async (code) => { if (!cancelled) { loginUi = {step: 'qr', url: 'tg://login?token=' + b64url(code.token)}; info.error = ''; draw(); } },
          password, onError});
      } else {
        await client.start({
          phoneNumber: () => ask('phone'),
          phoneCode: (viaApp) => ask('code', {viaApp: viaApp !== false}),
          password, onError});
      }
      if (gen !== loginGen) return;
      loginUi = null; cancelLogin = null;
      await signedIn(keep);
    } catch (e) {
      if (gen !== loginGen) return;
      loginUi = null; cancelLogin = null;
      await close();
      unlock();
      set('off', {error: cancelled || (e && e.message === 'AUTH_USER_CANCEL') ? '' : say(e)});
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

  // ---------------------------------------------------------------- the panel in Settings
  function el(tag, cls, text) { const e = root.document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function field(label, type, name, attrs) {
    const l = el('label', '', label), i = el('input');
    i.type = type; i.name = name; i.autocomplete = 'off'; i.dir = 'ltr';
    Object.assign(i, attrs || {});
    l.append(i);
    return l;
  }
  function draw() {
    const box = panelEl;
    if (!box || !box.isConnected) return;
    const hadFocus = box.contains(root.document.activeElement) && root.document.activeElement.tagName === 'INPUT';
    if (hadFocus && state !== 'login' && !loginUi) return;        // not under the viewer's fingers
    const X = A.X, parts = [];
    const err = () => { const p = el('p', 'tgerr', info.error || ''); p.setAttribute('role', 'alert'); return p; };
    if (state === 'offline') parts.push(el('p', 'hint', X('tg_offline')), err(), A.button('btn', X('tg_connect'), () => resume()));
    else if (state === 'other_tab') parts.push(el('p', 'hint', X('tg_other_tab')), A.button('btn ghost', X('tg_connect'), () => { state = 'off'; if (savedSession()) resume(); else draw(); }));
    else if (state === 'connecting') parts.push(el('p', 'hint', X('tg_wait')));
    else if (state === 'login') parts.push(...loginParts(), err());
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
    } else if (!creds()) {                       // step 1: the API details
      const f = el('form');
      f.append(el('p', 'hint', X('tg_api_about')), field(X('tg_api_id'), 'text', 'id', {inputMode: 'numeric'}), field(X('tg_api_hash'), 'password', 'hash'), err(), A.button('btn', X('tg_continue'), null));
      f.onsubmit = (e) => {
        e.preventDefault();
        const id = f.elements.id.value.trim(), hash = f.elements.hash.value.trim().toLowerCase();
        if (!/^\d{3,12}$/.test(id) || !/^[0-9a-f]{32}$/.test(hash)) { info.error = X('tg_api_bad'); f.querySelector('.tgerr').textContent = info.error; return; }
        A.put('tg_api', {id, hash});
        info.error = '';
        panelEl.replaceChildren(); draw();
      };
      parts.push(f);
    } else {                                     // step 2: how to log in, and whether the login is kept here
      if (info.note) parts.push(el('p', 'hint', info.note));
      const keep = el('label', 'check'), tick = el('input');
      tick.type = 'checkbox'; tick.id = 'tg_keep';
      keep.append(tick, el('span', '', X('tg_keep')));
      const row = el('div', 'links');
      row.append(A.button('btn', X('tg_qr'), () => login('qr', tick.checked)), A.button('btn ghost', X('tg_phone'), () => login('phone', tick.checked)),
                 A.button('btn ghost', X('tg_forget'), () => { A.drop('tg_api'); info.error = ''; info.note = ''; draw(); }));
      parts.push(keep, el('p', 'hint', X('tg_keep_warn')), err(), row);
    }
    box.replaceChildren(...parts);
    if (state === 'login' && loginUi) { const i = box.querySelector('input'); if (i) i.focus(); }
  }
  function loginParts() {
    const X = A.X, ui = loginUi || {step: 'wait'}, out = [];
    const cancel = () => A.button('btn ghost', X('tg_cancel'), (e) => { e.preventDefault(); if (cancelLogin) cancelLogin(); });
    if (ui.step === 'qr') {
      const box = el('div', 'qrbox'), canvas = el('canvas');
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'QR');
      try { drawQr(canvas, ui.url); } catch (e) {}
      box.append(canvas);
      out.push(el('p', 'hint', X('tg_qr_how')), box, cancel());
    } else if (ui.step === 'phone' || ui.step === 'code' || ui.step === 'password') {
      const f = el('form');
      const label = ui.step === 'phone' ? X('tg_phone_label') : ui.step === 'code' ? X(ui.viaApp ? 'tg_code_label' : 'tg_code_sms') : X('tg_pass_label');
      f.append(field(label, ui.step === 'phone' ? 'tel' : ui.step === 'code' ? 'text' : 'password', 'v', ui.step === 'code' ? {inputMode: 'numeric'} : {}));
      if (ui.step === 'password' && ui.hint) f.append(el('p', 'hint', A.fmt('tg_pass_hint', ui.hint)));
      const row = el('div', 'links');
      row.append(A.button('btn', X('tg_send'), null), cancel());
      f.append(row);
      f.onsubmit = (e) => {
        e.preventDefault();
        const v = ui.step === 'password' ? f.elements.v.value : f.elements.v.value.replace(/\s+/g, '');
        if (!v) return;
        loginUi = {step: 'wait'}; info.error = '';
        draw();
        ui.answer(v);
      };
      out.push(f);
    } else out.push(el('p', 'hint', X('tg_wait')), cancel());
    return out;
  }

  const api = {
    ready: false,
    init(app) { A = app; api.ready = true; },
    // draws the panel into `box` (and keeps it up to date while it is on the page)
    panel(box, paired) {
      panelEl = box;
      if (paired) info.note = A.X('tg_paired');
      if (state === 'off' && creds() && savedSession()) resume(); else draw();
    },
    resume, status: () => ({state, sync: info.sync, last: info.last, name: me ? me.name : ''}),
    syncNow: () => round('asked'),
  };
  root.TG = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
