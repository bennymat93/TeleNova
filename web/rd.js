'use strict';
// TeleNova web (package player): Real-Debrid, as realdebrid.py of the Kodi build does it.
//   sign-in   RD's device flow for open-source apps (public client id X245A4XAIBGVM): the viewer types a short code at
//             real-debrid.com/device; or pastes an API token. Both stay in this browser only (TN.put), are never
//             synced, logged or shown back.
//   links     Torrentio by IMDb id. Two ways, the viewer chooses (settingsPanel):
//             a) "key mode" (as Kodi): Torrentio's RD mode marks the cached torrents and hands back ready links.
//                HONEST NOTE: Torrentio takes the RD key only inside the address PATH (/realdebrid=<key>/stream/...).
//                It is never in a query, never logged here; with the helper Worker configured (and torrentio.strem.fun
//                on its ALLOW_HOSTS) the address travels in the X-TN-Target header to the helper instead of leaving
//                the browser as an address.
//             b) "hash mode": Torrentio is asked without any key (info hashes only); the chosen torrent is added to RD
//                through its REST API (Authorization header), which answers at once when RD has it cached.
//   REST API  api.real-debrid.com is tried from the browser first and through the helper Worker when the browser is
//             refused (helper.js via 'try'). Without either the panel says so.
//   The device flow itself has one unavoidable detail: RD's /device/credentials is a GET that takes the one-time
//   device code as a parameter (that is RD's API, the same call Kodi makes). The code is useless after sign-in.
// Provider 'rd' (kinds: source): sources(req), hasToken(), setToken(t), user(), magnet(url), resolve(row, {say}),
//   deviceStart(), devicePoll(code), signOut(), state(), settingsPanel(el)  <- services.js can call settingsPanel(el)
(function (G) {
  const TN = G.TN;
  const TORRENTIO = 'https://torrentio.strem.fun';
  const RD = 'https://api.real-debrid.com/rest/1.0';
  const OAUTH = 'https://api.real-debrid.com/oauth/v2';
  const CLIENT = 'X245A4XAIBGVM';               // RD's public client id for open-source apps (documented by RD)
  const GRANT = 'http://oauth.net/grant_type/device/1.0';
  TN.i18n.add({
    he: {rd_token: 'טוקן API של Real-Debrid', rd_save: 'שמור', rd_clear: 'התנתק ומחק', rd_saved: 'מחובר. הפרטים נשמרים בדפדפן הזה בלבד.',
      rd_none: 'לא מחובר. התחברו עם קוד, או הדביקו טוקן מ-real-debrid.com/apitoken', rd_bad: 'הטוקן לא נראה תקין', rd_user: 'מחובר: %s · פרימיום עד %s',
      rd_nohelper: 'הדפדפן לא מצליח לפנות ל-Real-Debrid ישירות. הגדירו את העוזר (Worker) במסך השירותים, או השתמשו במצב המפתח של Torrentio.',
      rd_wait: 'Real-Debrid מכין את הקובץ... %s%', rd_fail: 'Real-Debrid לא הצליח: %s',
      rd_checking: 'בודק את הטוקן…', rd_token_bad: 'Real-Debrid דחה את הטוקן הזה. בדקו שהעתקתם את כולו, או התחברו עם קוד.', rd_unchecked: '(לא נבדק: %s)',
      rd_code_old: 'הקוד פג בלי שאושר.', rd_newcode: 'קוד חדש',
      rd_device: 'התחבר עם קוד', rd_device_go: 'פתחו את %s והקלידו את הקוד:', rd_device_wait: 'מחכה לאישור באתר Real-Debrid...',
      rd_device_ok: 'התחברת ל-Real-Debrid', rd_device_fail: 'ההתחברות לא הושלמה: %s', rd_cancel: 'ביטול', rd_or: 'או הדבקת טוקן:',
      rd_keymode: 'לשאול את Torrentio עם המפתח שלי (מסמן אילו קישורים מוכנים, כמו ב-Kodi)',
      rd_keymode_note: 'גילוי נאות: Torrentio מקבל את המפתח רק בתוך נתיב הכתובת (לא בפרמטרים). כשהעוזר מוגדר, הבקשה עוברת דרכו; אחרת היא יוצאת ישר מהדפדפן ל-torrentio.strem.fun ב-https. כבוי: Torrentio נשאל בלי מפתח, והקישור שנבחר נבדק מול Real-Debrid עצמו.',
      rd_expired: 'ההתחברות ל-Real-Debrid פגה. התחברו שוב.', rd_notprem: 'החשבון אינו פרימיום', rd_open_site: 'פתח את האתר',
      rd_adding: 'מוסיף ל-Real-Debrid...', rd_notcached: 'הקובץ עדיין לא מוכן ב-Real-Debrid (%s%). אפשר לחכות או לבחור קישור אחר.', rd_copy: 'העתק קוד', rd_copied: 'הועתק'},
    en: {rd_token: 'Real-Debrid API token', rd_save: 'Save', rd_clear: 'Sign out and remove', rd_saved: 'Signed in. The details stay in this browser only.',
      rd_none: 'Not signed in. Sign in with a code, or paste a token from real-debrid.com/apitoken', rd_bad: 'That does not look like a token', rd_user: 'Signed in: %s · premium until %s',
      rd_nohelper: 'This browser cannot reach Real-Debrid directly. Set the helper (Worker) on the Services page, or use the Torrentio key mode.',
      rd_wait: 'Real-Debrid is preparing the file... %s%', rd_fail: 'Real-Debrid failed: %s',
      rd_checking: 'Checking the token…', rd_token_bad: 'Real-Debrid refused this token. Check that all of it was copied, or sign in with a code.', rd_unchecked: '(not checked: %s)',
      rd_code_old: 'The code expired before it was approved.', rd_newcode: 'New code',
      rd_device: 'Sign in with a code', rd_device_go: 'Open %s and type this code:', rd_device_wait: 'Waiting for the approval on the Real-Debrid site...',
      rd_device_ok: 'Signed in to Real-Debrid', rd_device_fail: 'The sign-in did not finish: %s', rd_cancel: 'Cancel', rd_or: 'Or paste a token:',
      rd_keymode: 'Ask Torrentio with my key (marks which links are ready, as in Kodi)',
      rd_keymode_note: 'Plainly: Torrentio accepts the key only inside the address path (not in parameters). With the helper set, the request goes through it; otherwise it leaves the browser straight to torrentio.strem.fun over https. Off: Torrentio is asked without a key and the chosen link is checked with Real-Debrid itself.',
      rd_expired: 'The Real-Debrid sign-in expired. Sign in again.', rd_notprem: 'The account is not premium', rd_open_site: 'Open the site',
      rd_adding: 'Adding to Real-Debrid...', rd_notcached: 'Real-Debrid does not have the file ready yet (%s%). Wait or choose another link.', rd_copy: 'Copy code', rd_copied: 'Copied'},
    ru: {rd_token: 'API-токен Real-Debrid', rd_save: 'Сохранить', rd_clear: 'Выйти и удалить', rd_saved: 'Вход выполнен. Данные хранятся только в этом браузере.',
      rd_none: 'Вход не выполнен. Войдите по коду или вставьте токен с real-debrid.com/apitoken', rd_bad: 'Это не похоже на токен', rd_user: 'Вход: %s · премиум до %s',
      rd_nohelper: 'Браузер не может обратиться к Real-Debrid напрямую. Укажите помощник (Worker) на странице сервисов или включите режим ключа Torrentio.',
      rd_wait: 'Real-Debrid готовит файл... %s%', rd_fail: 'Real-Debrid не смог: %s',
      rd_checking: 'Проверяю токен…', rd_token_bad: 'Real-Debrid отклонил этот токен. Проверьте, что он скопирован целиком, или войдите по коду.', rd_unchecked: '(не проверено: %s)',
      rd_code_old: 'Код истёк без подтверждения.', rd_newcode: 'Новый код',
      rd_device: 'Войти по коду', rd_device_go: 'Откройте %s и введите код:', rd_device_wait: 'Ждём подтверждения на сайте Real-Debrid...',
      rd_device_ok: 'Вход в Real-Debrid выполнен', rd_device_fail: 'Вход не завершён: %s', rd_cancel: 'Отмена', rd_or: 'Или вставьте токен:',
      rd_keymode: 'Спрашивать Torrentio с моим ключом (отмечает готовые ссылки, как в Kodi)',
      rd_keymode_note: 'Честно: Torrentio принимает ключ только внутри пути адреса (не в параметрах). Если помощник задан, запрос идёт через него; иначе прямо из браузера на torrentio.strem.fun по https. Выключено: Torrentio спрашивается без ключа, а выбранная ссылка проверяется в самом Real-Debrid.',
      rd_expired: 'Вход в Real-Debrid истёк. Войдите снова.', rd_notprem: 'Аккаунт не премиум', rd_open_site: 'Открыть сайт',
      rd_adding: 'Добавляем в Real-Debrid...', rd_notcached: 'Файл ещё не готов в Real-Debrid (%s%). Подождите или выберите другую ссылку.', rd_copy: 'Скопировать код', rd_copied: 'Скопировано'},
  });
  const t = TN.t, esc = TN.esc;
  const valid = (s) => /^[A-Za-z0-9]{20,80}$/.test(String(s || ''));
  const token = () => { const v = TN.get('rd_token', ''); return valid(v) ? v : ''; };
  const hasToken = () => !!token();
  const auth = () => { const a = TN.get('rd_auth', null); return a && a.cid && a.sec && a.refresh ? a : null; };
  function setToken(v) {
    if (!v) { TN.drop('rd_token'); TN.drop('rd_auth'); return true; }
    if (!valid(v)) return false;
    TN.put('rd_token', String(v)); TN.drop('rd_auth');
    return true;
  }
  const signOut = () => setToken('');
  const keyMode = () => TN.get('rd_torrentio', true) !== false;
  const fail = (code, msg) => Object.assign(new Error(msg || code), {code});
  const clean = (e) => String((e && (e.code || e.message)) || 'error').replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '').slice(0, 80);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const form = (o) => new URLSearchParams(o).toString();
  async function helper() { if (!G.TNHelper) await TN.loadScript('helper.js'); return G.TNHelper; }

  // ---------------------------------------------------------------- RD REST (browser first, then the helper)
  async function call(url, opts) {
    const H = await helper();
    try { return await H.fetch(url, Object.assign({via: 'try', timeout: 25000}, opts)); } catch (e) {
      if (e && e.code === 'needs_helper') throw fail('needs_helper', t('rd_nohelper'));
      throw e;
    }
  }
  let refreshing = null;
  async function fresh() {                         // a device sign-in's token lasts about an hour: renew it in time
    const a = auth();
    if (!a || !(a.exp > 0) || a.exp - Date.now() > 120000) return;
    refreshing = refreshing || (async () => {
      const r = await call(OAUTH + '/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: form({client_id: a.cid, client_secret: a.sec, code: a.refresh, grant_type: GRANT})});
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !valid(j.access_token)) { if (r.status === 400 || r.status === 401 || r.status === 403) signOut(); throw fail('rd_expired', t('rd_expired')); }
      TN.put('rd_token', j.access_token);
      TN.put('rd_auth', {cid: a.cid, sec: a.sec, refresh: j.refresh_token || a.refresh, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000});
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function rdFetch(path, opts) {
    opts = opts || {};
    if (!hasToken()) throw fail('no_token', t('rd_none'));
    await fresh();
    const headers = Object.assign({Authorization: 'Bearer ' + token()}, opts.body ? {'Content-Type': 'application/x-www-form-urlencoded'} : {});
    const r = await call(RD + path, {method: opts.method || 'GET', headers, body: opts.body, signal: opts.signal});
    if (r.status === 204) return {};
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && auth()) { TN.put('rd_auth', Object.assign(auth(), {exp: 1})); }
    if (!r.ok) throw fail(String(j.error || 'http_' + r.status), String(j.error || 'HTTP ' + r.status));
    return j;
  }
  const user = () => rdFetch('/user');

  // ---------------------------------------------------------------- device-code sign-in (realdebrid.py device_start / device_poll)
  async function deviceStart() {
    const r = await call(OAUTH + '/device/code?' + form({client_id: CLIENT, new_credentials: 'yes'}), {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.device_code || !j.user_code) throw fail('device', 'HTTP ' + r.status);
    const direct = String(j.direct_verification_url || '');
    return {device_code: String(j.device_code), user_code: String(j.user_code),
      url: /^https:\/\/real-debrid\.com\//.test(direct) ? direct : 'https://real-debrid.com/device',
      interval: Math.max(3, Number(j.interval) || 5), expires: Date.now() + (Number(j.expires_in) || 600) * 1000};
  }
  // -> true when signed in, false while the viewer has not approved yet
  async function devicePoll(deviceCode) {
    const r = await call(OAUTH + '/device/credentials?' + form({client_id: CLIENT, code: deviceCode}), {});
    if (!r.ok) return false;                       // 403 until approved
    const cred = await r.json().catch(() => ({}));
    if (!cred.client_id || !cred.client_secret) return false;
    const tr = await call(OAUTH + '/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: form({client_id: cred.client_id, client_secret: cred.client_secret, code: deviceCode, grant_type: GRANT})});
    const tok = await tr.json().catch(() => ({}));
    if (!tr.ok || !valid(tok.access_token)) throw fail('device', String(tok.error || 'HTTP ' + tr.status));
    TN.put('rd_token', tok.access_token);
    TN.put('rd_auth', {cid: cred.client_id, sec: cred.client_secret, refresh: tok.refresh_token || '', exp: Date.now() + (Number(tok.expires_in) || 3600) * 1000});
    return true;
  }

  // ---------------------------------------------------------------- links
  const dead = () => TN.get('rd_dead', {}) || {};
  function markDead(hash) {
    if (!hash) return;
    const d = dead(); d[hash] = Date.now();
    const ks = Object.keys(d);
    if (ks.length > 200) ks.sort((a, b) => d[a] - d[b]).slice(0, ks.length - 200).forEach((k) => delete d[k]);
    TN.put('rd_dead', d);
  }
  async function sources(req, o) {
    const signal = o && o.signal;
    if (!hasToken()) return [];
    const S = await TN.provider('sources');
    const id = S.streamId(req);
    if (!id) return [];
    const H = await helper();
    const tail = `/stream/${req.type === 'tv' ? 'series' : 'movie'}/${encodeURIComponent(id)}.json`;
    let r;
    if (keyMode()) {
      await fresh().catch(() => {});
      // the key is part of the PATH (Torrentio's design). Through the helper when there is one (X-TN-Target header).
      r = await H.fetch(`${TORRENTIO}/realdebrid=${token()}${tail}`, {via: H.has() ? 'helper' : 'direct', orDirect: true, signal, timeout: 25000});
    } else r = await H.fetch(TORRENTIO + tail, {via: 'direct', signal, timeout: 25000});
    if (!r.ok) throw new Error('Torrentio HTTP ' + r.status);
    const j = await r.json();
    const gone = dead();
    const rows = ((j && j.streams) || []).map((s) => {
      const row = S.parseStream(s, 'Torrentio');
      if (!row.url && row.hash) { row.status = 'rd'; row.rd = true; }       // hash mode: RD is asked when the row is chosen
      if (row.hash && gone[row.hash]) row.dead = true;
      return row;
    });
    return rows.filter((x) => x.url || x.hash);
  }
  // one torrent (info hash or magnet) -> a direct link. say(text) shows the progress; returns {url, name, mime, size}
  async function resolve(row, o) {
    o = o || {};
    const say = o.say || (() => true);
    const hash = String(row.hash || '').toLowerCase();
    const mag = row.magnet || (/^[a-f0-9]{40}$/.test(hash) ? 'magnet:?xt=urn:btih:' + hash : '');
    if (!mag) throw fail('bad_magnet', 'magnet');
    say(t('rd_adding'));
    try {
      const add = await rdFetch('/torrents/addMagnet', {method: 'POST', body: form({magnet: mag}), signal: o.signal});
      const id = encodeURIComponent(add.id);
      let info = await rdFetch('/torrents/info/' + id, {signal: o.signal});
      const vids = (info.files || []).filter((f) => /\.(mp4|mkv|m4v|webm|avi|mov|ts)$/i.test(f.path));
      const want = String(row.file || '').toLowerCase();
      const best = (want && vids.find((f) => String(f.path).toLowerCase().endsWith(want))) ||
        (row.fileIdx >= 0 && (info.files || []).find((f) => f.id === row.fileIdx + 1 && /\.(mp4|mkv|m4v|webm|avi|mov|ts)$/i.test(f.path))) ||
        (vids.length ? vids : info.files || []).slice().sort((a, b) => b.bytes - a.bytes)[0];
      if (info.status === 'waiting_files_selection' && best) await rdFetch('/torrents/selectFiles/' + id, {method: 'POST', body: 'files=' + best.id, signal: o.signal});
      const max = o.maxWait || 360000, t0 = Date.now();
      for (;;) {
        info = await rdFetch('/torrents/info/' + id, {signal: o.signal});
        if (info.status === 'downloaded') break;
        if (/error|dead|virus/.test(info.status)) { markDead(hash); throw fail(info.status); }
        if (say(t('rd_notcached', info.progress || 0)) === false) { rdFetch('/torrents/delete/' + id, {method: 'DELETE'}).catch(() => {}); throw fail('closed'); }
        if (Date.now() - t0 > max) throw fail('timeout');
        await sleep(3000);
      }
      if (!info.links || !info.links.length) { markDead(hash); throw fail('no_link'); }
      const un = await rdFetch('/unrestrict/link', {method: 'POST', body: form({link: info.links[0]}), signal: o.signal});
      if (!/^https:\/\//i.test(un.download || '')) throw fail('no_link');
      return {url: un.download, name: un.filename || '', mime: un.mimeType || '', size: Number(un.filesize) || 0};
    } catch (e) {
      if (e && (e.code === 'permission_denied' || e.code === 'bad_token')) throw fail(e.code, t('rd_notprem'));
      throw e;
    }
  }
  // a pasted magnet: resolve and play
  async function magnet(url, o) {
    if (!/^magnet:\?/i.test(url)) return;
    TN.modal(`<p class="msg" id="rd_msg" role="status">${esc(t('rd_adding'))}</p>`);
    const say = (s) => { const el = document.getElementById('rd_msg'); if (el) el.textContent = s; return !!el; };
    try {
      const f = await resolve({magnet: url}, {say});
      const pl = await TN.provider('player');
      return pl.open({url: f.url, title: (o && o.title) || f.name || 'Real-Debrid', mime: f.mime, release: f.name});
    } catch (e) { if (e.code !== 'closed') say(e.code === 'needs_helper' || e.code === 'no_token' ? e.message : t('rd_fail', clean(e))); }
  }

  // ---------------------------------------------------------------- the panel (sources settings and the Services page)
  function style() {
    if (document.getElementById('rd_style')) return;
    const s = document.createElement('style');
    s.id = 'rd_style';
    s.textContent = '.rd_in{flex:1 1 220px;min-width:0;min-height:44px;background:var(--panel);color:var(--text);border:1px solid var(--muted);border-radius:10px;padding:9px 14px;font:inherit}' +
      '.rd_code{font:700 28px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.18em;padding:8px 14px;border-radius:10px;background:var(--panel2);display:inline-block;margin:6px 0;user-select:all}' +
      '.rd_sw{display:flex;gap:10px;align-items:flex-start;margin:10px 0}.rd_sw input{width:22px;height:22px;flex:none;margin-top:2px}html.tv .rd_code{font-size:44px}';
    document.head.append(s);
  }
  let pollRun = 0;
  function settingsPanel(el) {
    if (!el) return;
    style();
    const my = ++pollRun;                          // a redraw ends a running code wait
    const on = hasToken();
    el.innerHTML = `<h4>Real-Debrid</h4><p class="hint" id="rd_st" role="status">${esc(on ? t('rd_saved') : t('rd_none'))}</p>` +
      `<div class="links"><button class="btn" id="rd_dev">${esc(t('rd_device'))}</button>` +
      (on ? `<button class="btn ghost" id="rd_cl">${esc(t('rd_clear'))}</button>` : '') + '</div><div id="rd_devbox"></div>' +
      `<p class="hint">${esc(t('rd_or'))}</p><form class="links" id="rd_f"><input class="rd_in" id="rd_in" type="password" autocomplete="off" spellcheck="false" dir="ltr" ` +
      `placeholder="${esc(on ? '••••••••' : t('rd_token'))}" aria-label="${esc(t('rd_token'))}"><button class="btn ghost" type="submit">${esc(t('rd_save'))}</button></form>` +
      `<label class="rd_sw"><input type="checkbox" id="rd_km"${keyMode() ? ' checked' : ''}><span>${esc(t('rd_keymode'))}<br><small class="hint">${esc(t('rd_keymode_note'))}</small></span></label>`;
    const st = el.querySelector('#rd_st'), box = el.querySelector('#rd_devbox');
    el.querySelector('#rd_f').onsubmit = (e) => {
      e.preventDefault();
      const inp = el.querySelector('#rd_in');
      if (!inp.value.trim() || !setToken(inp.value.trim())) { st.textContent = t('rd_bad'); return; }
      inp.value = '';
      st.textContent = t('rd_checking');
      // 5.1.2: the token is asked for its account before it is called signed in (a wrong one used to read "saved")
      user().then(() => { settingsPanel(el); TN.emit('settings', 'rd'); }, (e) => {
        const refused = /^(bad_token|http_401|http_403)$/.test(String(e && e.code));
        if (refused) setToken('');
        settingsPanel(el);
        const s2 = el.querySelector('#rd_st');
        if (s2) s2.textContent = refused ? t('rd_token_bad') : t('rd_saved') + ' ' + t('rd_unchecked', clean(e));
      });
    };
    el.querySelector('#rd_km').onchange = (e) => TN.put('rd_torrentio', !!e.target.checked);
    const cl = el.querySelector('#rd_cl');
    if (cl) cl.onclick = () => { signOut(); settingsPanel(el); };
    el.querySelector('#rd_dev').onclick = async () => {
      box.innerHTML = `<p class="hint">${esc(t('rd_adding').replace(/Real-Debrid.*/, '...'))}</p>`;
      try {
        const d = await deviceStart();
        if (my !== pollRun) return;
        box.innerHTML = `<p>${esc(t('rd_device_go', 'real-debrid.com/device'))}</p><div class="rd_code" dir="ltr">${esc(d.user_code)}</div>` +
          `<div class="links"><a class="btn" target="_blank" rel="noopener noreferrer" href="${esc(d.url)}">${esc(t('rd_open_site'))}</a>` +
          `<button class="btn ghost" id="rd_cp">${esc(t('rd_copy'))}</button><button class="btn ghost" id="rd_cx">${esc(t('rd_cancel'))}</button></div>` +
          `<p class="hint" role="status">${esc(t('rd_device_wait'))}</p>`;
        box.querySelector('#rd_cx').onclick = () => { pollRun++; box.innerHTML = ''; };
        const site = box.querySelector('a.btn');
        if (site) site.addEventListener('click', () => { try { navigator.clipboard.writeText(d.user_code).catch(() => {}); } catch (e) { /* no clipboard */ } });
        box.querySelector('#rd_cp').onclick = (ev) => {
          const done = () => { ev.target.textContent = t('rd_copied'); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(d.user_code).then(done, () => {});
        };
        let wake = null;
        const onVis = () => { if (!document.hidden && wake) wake(); };      // back from the Real-Debrid tab: ask at once
        document.addEventListener('visibilitychange', onVis);
        const nap = (ms) => new Promise((r) => { const id = setTimeout(r, ms); wake = () => { clearTimeout(id); r(); }; });
        const live = () => my === pollRun && document.body.contains(box);
        while (live() && Date.now() < d.expires) {
          await nap(d.interval * 1000);
          if (!live()) { document.removeEventListener('visibilitychange', onVis); return; }
          let okNow = false;
          // a dropped connection or one odd answer is not the end: the code stays good until it expires
          try { okNow = await devicePoll(d.device_code); } catch (e) { if (e && e.code === 'needs_helper') throw e; }
          if (okNow) {
            document.removeEventListener('visibilitychange', onVis);
            settingsPanel(el);
            const s2 = el.querySelector('#rd_st'); if (s2) s2.textContent = t('rd_device_ok');
            if (TN.toast) TN.toast(t('rd_device_ok'));
            TN.emit('settings', 'rd');
            return;
          }
        }
        document.removeEventListener('visibilitychange', onVis);
        if (my === pollRun && document.body.contains(box)) {
          box.innerHTML = `<p class="hint" role="alert">${esc(t('rd_code_old'))}</p><div class="links"><button class="btn" id="rd_again">${esc(t('rd_newcode'))}</button></div>`;
          box.querySelector('#rd_again').onclick = () => el.querySelector('#rd_dev').click();
        }
      } catch (e) {
        if (my === pollRun) box.innerHTML = `<p class="hint" role="alert">${esc(e.code === 'needs_helper' ? e.message : t('rd_device_fail', clean(e)))}</p>`;
      }
    };
    if (on) {
      user().then((u) => { if (document.body.contains(st)) st.textContent = t('rd_user', u.username || '', String(u.expiration || '').slice(0, 10)) + (u.type && u.type !== 'premium' ? ' · ' + t('rd_notprem') : ''); })
        .catch((e) => { if (document.body.contains(st)) st.textContent = t('rd_saved') + (e.code === 'needs_helper' ? ' ' + e.message : e.code === 'rd_expired' ? ' ' + e.message : ''); });
    }
  }
  // for the Services page: {on, text}
  const state = () => ({on: hasToken(), text: hasToken() ? t('rd_saved') : t('rd_none'), keyMode: keyMode()});

  TN.registerProvider('rd', {kinds: ['source'], label: 'Real-Debrid', sources, hasToken, setToken, signOut, user, magnet, resolve,
    deviceStart, devicePoll, state, keyMode, markDead, settingsPanel, servicesPanel: settingsPanel});
})(self);
