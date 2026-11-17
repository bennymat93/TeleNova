'use strict';
// WP-9: Google Drive (plan row 44) - behind a setting. Google sign-in in a browser needs an OAuth "Web application"
// client id registered for this site (authorised JavaScript origin https://bennymat93.github.io, redirect URI
// .../web/gdrive_cb.html). The build has none yet, so until one is written into the setting `gdrive_client`
// (Services > Google Drive, or this page) the page explains that and does nothing else.
// With one: sign-in (OAuth implicit flow in a popup, scope drive.file), backups to "BN Stream/Backups" (the same
// folder the Kodi app uses), restore, and a list of the videos in "BN Stream". The token lives in this tab's memory
// and sessionStorage only (never localStorage, never an address, never the console) and is sent only as a header.
// Note: with the drive.file scope a client sees only the files it created; files the Kodi app uploaded with its own
// client are visible here only if both use the same Google Cloud project.
// Service `gdrive`: {ready(), signIn(), signOut(), folder(path), list(folderId), upload(folderId, name, blob), bytes(id)}
(function (TN) {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3/files', UP = 'https://www.googleapis.com/upload/drive/v3/files';
  const FOLDER = 'application/vnd.google-apps.folder', ROOT = 'BN Stream';
  TN.i18n.add({
    he: {gd_intro: 'גיבויים ל-Google Drive, לתיקייה "BN Stream/Backups" שהאפליקציה ב-Kodi משתמשת בה.',
         gd_noclient: 'החיבור ל-Google Drive מהדפדפן דורש מזהה לקוח OAuth של Google לאתר הזה, ועדיין אין כזה. מי שיש לו מזהה כזה יכול להדביק אותו כאן.',
         gd_client: 'מזהה לקוח OAuth (Client ID)', gd_save: 'שמירה', gd_in: 'כניסה עם Google', gd_out: 'יציאה', gd_backup: 'גיבוי עכשיו',
         gd_backups: 'גיבויים ב-Drive', gd_restore: 'שחזור', gd_videos: 'סרטונים בתיקייה BN Stream', gd_none: 'אין כאן קבצים',
         gd_done: 'בוצע', gd_wait: 'רגע...', gd_fail: 'לא הצליח: %s', gd_popup: 'הדפדפן חסם את חלון הכניסה; אפשרו חלונות קופצים לאתר',
         gd_play_kodi: 'ניגון מ-Drive באתר עוד לא זמין; הסרטון נפתח באפליקציה ב-Kodi.', gd_bad_client: 'זה לא נראה כמו מזהה לקוח של Google'},
    en: {gd_intro: 'Backups to Google Drive, in the "BN Stream/Backups" folder the Kodi app uses.',
         gd_noclient: 'Connecting Google Drive from a browser needs a Google OAuth client id for this site, and there is none yet. If you have one, paste it here.',
         gd_client: 'OAuth client id', gd_save: 'Save', gd_in: 'Sign in with Google', gd_out: 'Sign out', gd_backup: 'Back up now',
         gd_backups: 'Backups on Drive', gd_restore: 'Restore', gd_videos: 'Videos in the BN Stream folder', gd_none: 'No files here',
         gd_done: 'Done', gd_wait: 'One moment...', gd_fail: 'Did not work: %s', gd_popup: 'The browser blocked the sign-in window; allow pop-ups for this site',
         gd_play_kodi: 'Playing from Drive on the web is not available yet; the video plays in the Kodi app.', gd_bad_client: 'This does not look like a Google client id'},
    ru: {gd_intro: 'Резервные копии в Google Drive, в папке "BN Stream/Backups", которой пользуется приложение Kodi.',
         gd_noclient: 'Для Google Drive в браузере нужен идентификатор клиента Google OAuth для этого сайта, а его пока нет. Если он у вас есть, вставьте его сюда.',
         gd_client: 'Идентификатор клиента OAuth', gd_save: 'Сохранить', gd_in: 'Войти через Google', gd_out: 'Выйти', gd_backup: 'Создать копию',
         gd_backups: 'Копии в Drive', gd_restore: 'Восстановить', gd_videos: 'Видео в папке BN Stream', gd_none: 'Здесь нет файлов',
         gd_done: 'Готово', gd_wait: 'Минутку...', gd_fail: 'Не получилось: %s', gd_popup: 'Браузер заблокировал окно входа; разрешите всплывающие окна',
         gd_play_kodi: 'Воспроизведение из Drive на сайте пока недоступно; видео открывается в приложении Kodi.', gd_bad_client: 'Это не похоже на идентификатор клиента Google'},
  });
  const t = TN.t;
  const client = () => String(TN.settings.get('gdrive_client', '') || '').trim();
  const CLIENT_RX = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
  let tok = null;                                    // {token, until}
  try { const s = JSON.parse(sessionStorage.getItem('tn_gd') || 'null'); if (s && s.until > Date.now()) tok = s; } catch (e) {}
  const ready = () => !!(tok && tok.until > Date.now() + 30000);

  function signIn() {
    return new Promise((resolve, reject) => {
      const cid = client();
      if (!CLIENT_RX.test(cid)) return reject(new Error(t('gd_bad_client')));
      const state = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      const redirect = new URL('gdrive_cb.html', location.href).href.split('#')[0].split('?')[0];
      const u = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({client_id: cid, redirect_uri: redirect,
        response_type: 'token', scope: SCOPE, state, include_granted_scopes: 'true', prompt: 'select_account'});
      const w = window.open(u, 'tn_gdrive', 'width=500,height=650');
      if (!w) return reject(new Error(t('gd_popup')));
      const done = (e) => {
        if (e.origin !== location.origin || !e.data || e.data.type !== 'tn_gdrive') return;
        window.removeEventListener('message', done); clearInterval(watch);
        if (e.data.state !== state || !e.data.token) return reject(new Error(e.data.error || 'denied'));
        tok = {token: e.data.token, until: Date.now() + (e.data.expires || 3600) * 1000};
        try { sessionStorage.setItem('tn_gd', JSON.stringify(tok)); } catch (x) {}
        resolve(true);
      };
      window.addEventListener('message', done);
      const watch = setInterval(() => { if (w.closed) { clearInterval(watch); setTimeout(() => { window.removeEventListener('message', done); if (!ready()) reject(new Error('closed')); }, 500); } }, 700);
    });
  }
  function signOut() {
    const old = tok; tok = null;
    try { sessionStorage.removeItem('tn_gd'); } catch (e) {}
    if (old) fetch('https://oauth2.googleapis.com/revoke', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'token=' + encodeURIComponent(old.token)}).catch(() => {});
  }
  async function call(url, opt = {}) {
    if (!ready()) throw new Error('signed out');
    const r = await fetch(url, Object.assign({}, opt, {headers: Object.assign({Authorization: 'Bearer ' + tok.token}, opt.headers || {}), credentials: 'omit'}));
    if (r.status === 401) { signOut(); throw new Error('signed out'); }
    if (!r.ok) throw new Error('Drive ' + r.status);
    return r;
  }
  const qs = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  async function list(parent, foldersOnly) {
    const q = ["'" + qs(parent) + "' in parents", 'trashed=false'];
    if (foldersOnly) q.push("mimeType='" + FOLDER + "'");
    const out = []; let page = '';
    do {
      const p = new URLSearchParams({q: q.join(' and '), fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)', pageSize: '200', orderBy: 'modifiedTime desc'});
      if (page) p.set('pageToken', page);
      const j = await (await call(API + '?' + p)).json();
      out.push(...(j.files || [])); page = j.nextPageToken || '';
    } while (page && out.length < 1000);
    return out;
  }
  const folderIds = {};
  async function folder(path) {                      // id of BN Stream[/path], created when missing
    const key = path || '';
    if (folderIds[key]) return folderIds[key];
    let parent = 'root';
    for (const name of [ROOT].concat(key ? key.split('/') : [])) {
      const found = (await list(parent, true)).find((f) => f.name === name);
      if (found) parent = found.id;
      else parent = (await (await call(API, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, mimeType: FOLDER, parents: [parent]})})).json()).id;
    }
    return (folderIds[key] = parent);
  }
  async function upload(parent, name, blob) {
    const meta = new Blob([JSON.stringify({name, parents: [parent]})], {type: 'application/json'});
    const body = new FormData(); body.append('metadata', meta); body.append('file', blob);
    return (await call(UP + '?uploadType=multipart', {method: 'POST', body})).json();
  }
  async function bytes(id) { return new Uint8Array(await (await call(API + '/' + encodeURIComponent(id) + '?alt=media')).arrayBuffer()); }

  TN.registerProvider('gdrive', {kinds: ['service'], label: 'Google Drive', ready, signIn, signOut, folder, list, upload, bytes});

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  async function pageDrive(arg, ctx) {
    TN.page('gdrive', t('m_gdrive'));
    const view = TN.view();
    const box = el('div', 'panel settings'); view.append(box);
    box.append(el('p', '', t('gd_intro')));
    const msg = el('span', 'hint'); msg.setAttribute('role', 'status');
    const say = (s) => { msg.textContent = s; };
    const err = (e) => say(t('gd_fail', e && e.message || e));
    if (!client()) box.append(el('p', 'hint', t('gd_noclient')));
    // the client id field (a client id is public, not a secret)
    const f = el('form', 'links');
    const inp = el('input'); inp.value = client(); inp.dir = 'ltr'; inp.placeholder = '1234-abc.apps.googleusercontent.com'; inp.setAttribute('aria-label', t('gd_client'));
    inp.style.cssText = 'flex:1 1 260px;min-width:0';
    const sb = el('button', 'btn ghost', t('gd_save')); sb.type = 'submit';
    f.append(inp, sb);
    f.onsubmit = (e) => { e.preventDefault(); const v = inp.value.trim(); if (v && !CLIENT_RX.test(v)) return say(t('gd_bad_client')); TN.settings.set('gdrive_client', v); TN.route(); };
    const lab = el('label', '', t('gd_client')); box.append(lab, f);
    if (!client()) { box.append(msg); return; }
    const acts = el('div', 'links'); box.append(acts, msg);
    if (!ready()) {
      acts.append(TN.button('btn', t('gd_in'), () => signIn().then(() => TN.route(), err)));
      return;
    }
    acts.append(TN.button('btn', t('gd_backup'), async () => {
      say(t('gd_wait'));
      try { const B = (await TN.load('backup'), self.TNBackup); await upload(await folder('Backups'), B.zipName(), await B.makeZip()); say(t('gd_done')); TN.route(); } catch (e) { err(e); }
    }), TN.button('btn ghost', t('gd_out'), () => { signOut(); TN.route(); }));
    // backups and videos
    view.append(el('h2', '', t('gd_backups')));
    const bl = el('div', 'hlist'); view.append(bl);
    view.append(el('h2', '', t('gd_videos')));
    const vl = el('div', 'hlist'); view.append(vl);
    try {
      const backs = (await list(await folder('Backups'))).filter((x) => /\.zip$/i.test(x.name));
      if (!ctx.current()) return;
      if (!backs.length) bl.append(el('p', 'hint', t('gd_none')));
      for (const b of backs.slice(0, 30)) {
        const r = el('div', 'panel'); r.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap';
        const nm = el('b', '', b.name); nm.dir = 'ltr'; nm.style.flex = '1 1 200px';
        r.append(nm, el('span', 'hint', (b.modifiedTime || '').slice(0, 16).replace('T', ' ')), TN.button('btn ghost', t('gd_restore'), async () => {
          say(t('gd_wait'));
          try { await TN.load('backup'); say(await self.TNBackup.restoreBytes(await bytes(b.id), false)); } catch (e) { err(e); }
        }));
        bl.append(r);
      }
      const vids = (await list(await folder(''))).filter((x) => /^video\//.test(x.mimeType || ''));
      if (!ctx.current()) return;
      if (!vids.length) vl.append(el('p', 'hint', t('gd_none')));
      for (const v of vids.slice(0, 100)) {
        const b = TN.button('hrow', v.name, () => TN.kodiOnly(v.name, t('gd_play_kodi')));
        b.dir = 'auto'; vl.append(b);
      }
    } catch (e) { err(e); }
  }
  TN.registerPage('gdrive', pageDrive);
})(self.TN);
