'use strict';
// TeleNova web (WP-5): Real-Debrid, token mode (plan row 33).
// The RD REST API has no browser CORS. Without the helper Worker the viewer pastes an RD API token here and links come
// from Torrentio's RD mode (torrentio.strem.fun answers with CORS and hands back RD-resolved links). With the helper
// (settings.helper()) the account status and magnet links work too, through helper.js. Device-code login is not done
// here (it needs the Worker too) - see the report.
// The token stays in this browser (TN.put('rd_token')), is never synced to Kodi, never logged and never shown back.
// It travels only in the Torrentio path (as Torrentio requires) and in the Authorization header to RD.
// Provider 'rd' (kinds: source): sources(req), hasToken(), setToken(t), user(), magnet(url), settingsPanel(el).
(function (G) {
  const TN = G.TN;
  const TORRENTIO = 'https://torrentio.strem.fun';
  const RD = 'https://api.real-debrid.com/rest/1.0';
  TN.i18n.add({
    he: {rd_token: 'טוקן API של Real-Debrid', rd_save: 'שמור', rd_clear: 'מחק טוקן', rd_saved: 'הטוקן נשמר בדפדפן הזה בלבד.',
      rd_none: 'אין טוקן. אפשר להעתיק אותו מ-real-debrid.com/apitoken', rd_bad: 'הטוקן לא נראה תקין', rd_user: 'מחובר: %s · פרימיום עד %s',
      rd_nohelper: 'מצב החשבון וקישורי מגנט צריכים את העוזר (Worker).', rd_wait: 'Real-Debrid מכין את הקובץ... %s%', rd_fail: 'Real-Debrid לא הצליח: %s'},
    en: {rd_token: 'Real-Debrid API token', rd_save: 'Save', rd_clear: 'Remove token', rd_saved: 'The token is saved in this browser only.',
      rd_none: 'No token. Copy it from real-debrid.com/apitoken', rd_bad: 'That does not look like a token', rd_user: 'Signed in: %s · premium until %s',
      rd_nohelper: 'Account status and magnet links need the helper (Worker).', rd_wait: 'Real-Debrid is preparing the file... %s%', rd_fail: 'Real-Debrid failed: %s'},
    ru: {rd_token: 'API-токен Real-Debrid', rd_save: 'Сохранить', rd_clear: 'Удалить токен', rd_saved: 'Токен сохранён только в этом браузере.',
      rd_none: 'Нет токена. Скопируйте его с real-debrid.com/apitoken', rd_bad: 'Это не похоже на токен', rd_user: 'Вход: %s · премиум до %s',
      rd_nohelper: 'Для статуса аккаунта и magnet-ссылок нужен помощник (Worker).', rd_wait: 'Real-Debrid готовит файл... %s%', rd_fail: 'Real-Debrid не смог: %s'},
  });
  const t = TN.t, esc = TN.esc;
  const valid = (s) => /^[A-Za-z0-9]{20,80}$/.test(String(s || ''));
  const token = () => { const v = TN.get('rd_token', ''); return valid(v) ? v : ''; };
  const hasToken = () => !!token();
  function setToken(v) { if (!v) { TN.drop('rd_token'); return true; } if (!valid(v)) return false; TN.put('rd_token', String(v)); return true; }

  async function sources(req, {signal} = {}) {
    if (!hasToken()) return [];
    const S = await TN.provider('sources');
    const id = S.streamId(req);
    if (!id) return [];
    const r = await fetch(`${TORRENTIO}/realdebrid=${token()}/stream/${req.type === 'tv' ? 'series' : 'movie'}/${encodeURIComponent(id)}.json`,
      {signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (!r.ok) throw new Error('Torrentio HTTP ' + r.status);
    const j = await r.json();
    return ((j && j.streams) || []).map((s) => S.parseStream(s, 'Torrentio')).filter((x) => x.url);
  }

  // ---------------------------------------------------------------- helper mode (Worker)
  async function rdFetch(path, opts = {}) {
    if (!hasToken()) throw Object.assign(new Error('no token'), {code: 'no_token'});
    if (!G.TNHelper) await TN.loadScript('helper.js');
    const headers = Object.assign({Authorization: 'Bearer ' + token()}, opts.body ? {'Content-Type': 'application/x-www-form-urlencoded'} : {});
    const r = await G.TNHelper.fetch(RD + path, {method: opts.method || 'GET', headers, body: opts.body, via: 'helper', signal: opts.signal});
    if (r.status === 204) return {};
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), {code: j.error || 'http_' + r.status});
    return j;
  }
  const user = () => rdFetch('/user');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // a magnet: add, choose the biggest video file, wait until RD has it, unrestrict, play
  async function magnet(url, {title} = {}) {
    if (!/^magnet:\?/i.test(url)) return;
    if (!TN.settings.helper()) { TN.modal(`<p class="msg">${esc(t('rd_nohelper'))}</p>`); return; }
    TN.modal(`<p class="msg" id="rd_msg">${esc(t('rd_wait', 0))}</p>`);
    const say = (s) => { const el = document.getElementById('rd_msg'); if (el) el.textContent = s; return !!el; };
    try {
      const add = await rdFetch('/torrents/addMagnet', {method: 'POST', body: new URLSearchParams({magnet: url}).toString()});
      let info = await rdFetch('/torrents/info/' + encodeURIComponent(add.id));
      const vids = (info.files || []).filter((f) => /\.(mp4|mkv|m4v|webm|avi|mov|ts)$/i.test(f.path));
      const best = (vids.length ? vids : info.files || []).sort((a, b) => b.bytes - a.bytes)[0];
      if (best) await rdFetch('/torrents/selectFiles/' + encodeURIComponent(add.id), {method: 'POST', body: 'files=' + best.id});
      for (let i = 0; i < 120; i++) {
        info = await rdFetch('/torrents/info/' + encodeURIComponent(add.id));
        if (info.status === 'downloaded') break;
        if (/error|dead|virus|magnet_error/.test(info.status)) throw new Error(info.status);
        if (!say(t('rd_wait', info.progress || 0))) return;          // the viewer closed the sheet
        await sleep(3000);
      }
      if (info.status !== 'downloaded') throw new Error('timeout');
      const un = await rdFetch('/unrestrict/link', {method: 'POST', body: new URLSearchParams({link: info.links[0]}).toString()});
      const pl = await TN.provider('player');
      return pl.open({url: un.download, title: title || un.filename || 'Real-Debrid', mime: un.mimeType || ''});
    } catch (e) { say(t('rd_fail', String(e.code || e.message || 'error').replace(/https?:\/\/\S+/g, ''))); }
  }

  function settingsPanel(el) {
    if (!el) return;
    el.innerHTML = `<h4>Real-Debrid</h4><div class="links"><input id="rd_in" type="password" autocomplete="off" spellcheck="false" ` +
      `placeholder="${esc(hasToken() ? '••••••••' : t('rd_token'))}" aria-label="${esc(t('rd_token'))}" style="flex:1 1 220px;min-width:0;background:var(--panel);color:var(--text);border:1px solid var(--panel2);border-radius:10px;padding:9px 14px;font:inherit">` +
      `<button class="btn" id="rd_sv">${esc(t('rd_save'))}</button>${hasToken() ? `<button class="btn ghost" id="rd_cl">${esc(t('rd_clear'))}</button>` : ''}</div>` +
      `<p class="hint" id="rd_st">${esc(hasToken() ? t('rd_saved') : t('rd_none'))}</p>`;
    const st = el.querySelector('#rd_st');
    el.querySelector('#rd_sv').onclick = () => {
      const inp = el.querySelector('#rd_in');
      if (!setToken(inp.value.trim())) { st.textContent = t('rd_bad'); return; }
      inp.value = '';
      settingsPanel(el);
    };
    const cl = el.querySelector('#rd_cl');
    if (cl) cl.onclick = () => { setToken(''); settingsPanel(el); };
    if (hasToken() && TN.settings.helper()) {
      user().then((u) => { st.textContent = t('rd_user', u.username || '', String(u.expiration || '').slice(0, 10)); }).catch(() => {});
    } else if (hasToken()) st.textContent = t('rd_saved') + ' ' + t('rd_nohelper');
  }

  TN.registerProvider('rd', {kinds: ['source'], label: 'Real-Debrid', sources, hasToken, setToken, user, magnet, settingsPanel});
})(self);
