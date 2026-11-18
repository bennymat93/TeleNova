'use strict';
// WP-9: Google Drive (Kodi K05-K09) with the BROWSER sign-in flow.
// Sign-in: OAuth 2 implicit flow, scope drive.file, in a pop-up (gdrive_cb.html posts the answer back) or - where pop-ups
//   are blocked (TV browsers, some phones) - in this tab (gdrive_cb.html keeps the answer in sessionStorage and returns).
//   Kodi's device flow needs a client secret and must not ship in a web page; a browser needs an OAuth client id of the
//   "Web application" type instead (a client id is public). The page shows the two addresses to register for it.
//   The token lives in this tab's memory and sessionStorage only (never localStorage, never an address, never the
//   console) and is sent only in the Authorization header.
// What it does: account name and space, backup to "BN Stream/Backups" (kept: the newest N), restore, sync of the active
//   user's favourites / history with "BN Stream/Sync" (the files Kodi's Drive sync keeps), browsing the BN Stream folder,
//   uploading a video, and PLAYING a Drive video in the site player: a <video> cannot send the Authorization header, so
//   the bytes are read with Range requests and handed to the page's stream proxy (tgplay.openSource, the service
//   worker's Range proxy); without a service worker a file up to 300 MB is read whole, a larger one opens in Drive.
// Note (Google's rule, the same for Kodi): with the drive.file scope an app sees only the files it created. The site and
//   Kodi share files when both clients belong to the same Google Cloud project.
// Service `gdrive`: {ready(), signIn(), signOut(), about(), folder(path), list(folderId), upload(folderId, name, blob), bytes(id), play(file)}
(function (root) {
  // ------------------------------------------------------------ pure (node: src/qa/web/t_services.js)
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const CLIENT_RX = /^[0-9]{6,}-[a-z0-9]{8,}\.apps\.googleusercontent\.com$/;
  const clientOk = (v) => CLIENT_RX.test(String(v || '').trim());
  // the address of Google's consent page (nothing secret in it: client id, where to return, the random state)
  function authUrl(cid, redirect, state) {
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({client_id: cid, redirect_uri: redirect, response_type: 'token', scope: SCOPE, state,
      include_granted_scopes: 'true', prompt: 'select_account'});
  }
  // the #fragment Google returns -> {state, token, expires, error}
  function parseAnswer(hash) {
    const h = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    const token = h.get('access_token') || '';
    return {state: h.get('state') || '', token: /^[A-Za-z0-9._~+/-]{20,4096}$/.test(token) ? token : '', expires: Math.max(0, Math.min(86400, Number(h.get('expires_in')) || 0)),
      error: String(h.get('error') || '').slice(0, 80)};
  }
  // backups to delete: all but the newest `keep` (files newest first) - gdrive.py prune
  function prune(files, keep) {
    return (files || []).filter((f) => /\.zip$/i.test((f && f.name) || '')).slice(Math.max(1, Number(keep) || 5));
  }
  // part i of a file -> the inclusive byte range, or null past the end
  function rangeOf(i, part, size) {
    const start = i * part;
    if (!(size > 0) || start >= size || start < 0) return null;
    return [start, Math.min(size, start + part) - 1];
  }
  const VIDEO_EXT = /\.(mp4|m4v|mkv|webm|mov|avi|ts|mpg|mpeg|wmv|flv|3gp)$/i;
  const isVideo = (f) => /^video\//.test((f && f.mimeType) || '') || VIDEO_EXT.test((f && f.name) || '');
  // what the browser is told the file is (a Matroska file is tried as WebM: the same container family)
  function mimeOf(f) {
    const m = String((f && f.mimeType) || ''), n = String((f && f.name) || '');
    if (/\.mkv$/i.test(n) || /matroska/i.test(m)) return 'video/webm';
    if (/^video\//.test(m)) return m;
    return /\.webm$/i.test(n) ? 'video/webm' : 'video/mp4';
  }
  const sizeText = (n) => { n = Number(n) || 0; return n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? Math.round(n / 1048576) + ' MB' : n ? Math.max(1, Math.round(n / 1024)) + ' KB' : ''; };
  const core = {SCOPE, CLIENT_RX, clientOk, authUrl, parseAnswer, prune, rangeOf, isVideo, mimeOf, sizeText};
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }

  const TN = root.TN;
  if (!TN) return;
  root.TNGdrive = core;
  const API = 'https://www.googleapis.com/drive/v3/files', UP = 'https://www.googleapis.com/upload/drive/v3/files';
  const FOLDER = 'application/vnd.google-apps.folder', ROOT = 'BN Stream', BLOB_MAX = 300 * 1024 * 1024, WEEK = 7 * 864e5;
  TN.i18n.add({
    he: {gd_intro: 'גיבויים, סנכרון וסרטונים אישיים ב-Google Drive, בתיקייה "BN Stream" - אותה תיקייה של האפליקציה ב-Kodi.',
         gd_setup: 'הגדרה חד-פעמית', gd_noclient: 'כניסה ל-Google מדפדפן צריכה מזהה לקוח OAuth מסוג "Web application" (חינם). יוצרים אותו ב-Google Cloud Console > APIs & Services > Credentials, מפעילים את Google Drive API, ומזינים שם את שתי הכתובות האלה:',
         gd_origin: 'Authorized JavaScript origin', gd_redirect: 'Authorized redirect URI', gd_copy: 'העתקה', gd_copied: 'הועתק', gd_console: 'פתיחת Google Cloud Console',
         gd_same: 'כדי שהאתר ו-Kodi יראו את אותם קבצים, צרו את המזהה באותו פרויקט Google Cloud שבו נוצר המזהה של Kodi.',
         gd_client: 'מזהה לקוח OAuth (Client ID)', gd_save: 'שמירה', gd_in: 'כניסה עם Google', gd_in_tab: 'כניסה באותה לשונית', gd_out: 'ניתוק', gd_backup: 'גיבוי עכשיו',
         gd_backups: 'גיבויים ב-Drive', gd_restore: 'שחזור', gd_files: 'הקבצים שלי', gd_none: 'אין כאן קבצים', gd_done: 'בוצע', gd_wait: 'רגע...', gd_fail: 'לא הצליח: %s',
         gd_popup: 'הדפדפן חסם את חלון הכניסה. אפשרו חלונות קופצים לאתר, או בחרו "כניסה באותה לשונית".', gd_bad_client: 'זה לא נראה כמו מזהה לקוח של Google',
         gd_acc: 'מחובר: %s', gd_space: '%s מתוך %s בשימוש', gd_keep: 'גיבויים לשמור', gd_auto: 'גיבוי שבועי אוטומטי', gd_auto_hint: 'כשעמוד זה נפתח ואתם מחוברים, נוצר גיבוי אם האחרון בן יותר משבוע (דפדפן לא רץ ברקע).',
         gd_on: 'פעיל', gd_off: 'כבוי', gd_sync: 'סנכרון עכשיו', gd_synced: 'סונכרנו %s מועדפים ו-%s פריטי היסטוריה', gd_sync_hint: 'ממזג את המועדפים וההיסטוריה של המשתמש הפעיל עם התיקייה "BN Stream/Sync".',
         gd_upload: 'העלאת סרטון', gd_uploading: 'מעלה... %s%', gd_up: 'תיקייה למעלה', gd_play: 'נגן', gd_loading: 'טוען את הסרטון... %s%', gd_open_drive: 'פתיחה ב-Google Drive', gd_download: 'הורדה',
         gd_too_big: 'הדפדפן הזה לא יכול להזרים את הקובץ (אין Service Worker) והוא גדול מדי לטעינה מלאה. אפשר לפתוח אותו ב-Google Drive.',
         gd_expired: 'החיבור ל-Google פג (הוא תקף לשעה). התחברו שוב.', gd_closed: 'חלון הכניסה נסגר', gd_denied: 'הכניסה לא אושרה',
         gd_only_own: 'Google מציג לאתר רק קבצים שהאתר (או Kodi מאותו פרויקט) העלה. העלו סרטון מכאן כדי לנגן אותו בכל מכשיר.'},
    en: {gd_intro: 'Backups, sync and your own videos on Google Drive, in the "BN Stream" folder - the same folder the Kodi app uses.',
         gd_setup: 'One-time setup', gd_noclient: 'Signing in to Google from a browser needs an OAuth client id of the "Web application" type (free). Create it in the Google Cloud Console > APIs & Services > Credentials, enable the Google Drive API, and enter these two addresses there:',
         gd_origin: 'Authorized JavaScript origin', gd_redirect: 'Authorized redirect URI', gd_copy: 'Copy', gd_copied: 'Copied', gd_console: 'Open the Google Cloud Console',
         gd_same: 'For the site and Kodi to see the same files, create the client in the same Google Cloud project as Kodi\'s client.',
         gd_client: 'OAuth client id', gd_save: 'Save', gd_in: 'Sign in with Google', gd_in_tab: 'Sign in in this tab', gd_out: 'Disconnect', gd_backup: 'Back up now',
         gd_backups: 'Backups on Drive', gd_restore: 'Restore', gd_files: 'My files', gd_none: 'No files here', gd_done: 'Done', gd_wait: 'One moment...', gd_fail: 'Did not work: %s',
         gd_popup: 'The browser blocked the sign-in window. Allow pop-ups for this site, or choose "Sign in in this tab".', gd_bad_client: 'This does not look like a Google client id',
         gd_acc: 'Signed in: %s', gd_space: '%s of %s used', gd_keep: 'Backups to keep', gd_auto: 'Automatic weekly backup', gd_auto_hint: 'When this page opens and you are signed in, a backup is made if the last one is older than a week (a browser does not run in the background).',
         gd_on: 'On', gd_off: 'Off', gd_sync: 'Sync now', gd_synced: 'Synced %s favourites and %s history items', gd_sync_hint: 'Merges the active user\'s favourites and history with the "BN Stream/Sync" folder.',
         gd_upload: 'Upload a video', gd_uploading: 'Uploading... %s%', gd_up: 'Up one folder', gd_play: 'Play', gd_loading: 'Loading the video... %s%', gd_open_drive: 'Open in Google Drive', gd_download: 'Download',
         gd_too_big: 'This browser cannot stream the file (no service worker) and it is too large to load whole. It can be opened in Google Drive.',
         gd_expired: 'The Google sign-in expired (it lasts one hour). Sign in again.', gd_closed: 'The sign-in window was closed', gd_denied: 'The sign-in was not approved',
         gd_only_own: 'Google shows the site only the files the site (or Kodi from the same project) uploaded. Upload a video here to play it on any device.'},
    ru: {gd_intro: 'Резервные копии, синхронизация и ваши видео в Google Drive, в папке «BN Stream» - той же, что использует приложение Kodi.',
         gd_setup: 'Разовая настройка', gd_noclient: 'Для входа в Google из браузера нужен идентификатор клиента OAuth типа «Web application» (бесплатно). Создайте его в Google Cloud Console > APIs & Services > Credentials, включите Google Drive API и введите там эти два адреса:',
         gd_origin: 'Authorized JavaScript origin', gd_redirect: 'Authorized redirect URI', gd_copy: 'Копировать', gd_copied: 'Скопировано', gd_console: 'Открыть Google Cloud Console',
         gd_same: 'Чтобы сайт и Kodi видели одни и те же файлы, создайте клиент в том же проекте Google Cloud, что и клиент Kodi.',
         gd_client: 'Идентификатор клиента OAuth', gd_save: 'Сохранить', gd_in: 'Войти через Google', gd_in_tab: 'Войти в этой вкладке', gd_out: 'Отключить', gd_backup: 'Создать копию',
         gd_backups: 'Копии в Drive', gd_restore: 'Восстановить', gd_files: 'Мои файлы', gd_none: 'Здесь нет файлов', gd_done: 'Готово', gd_wait: 'Минутку...', gd_fail: 'Не получилось: %s',
         gd_popup: 'Браузер заблокировал окно входа. Разрешите всплывающие окна или выберите «Войти в этой вкладке».', gd_bad_client: 'Это не похоже на идентификатор клиента Google',
         gd_acc: 'Вход выполнен: %s', gd_space: 'Занято %s из %s', gd_keep: 'Сколько копий хранить', gd_auto: 'Автоматическая еженедельная копия', gd_auto_hint: 'Когда эта страница открыта и вход выполнен, копия создаётся, если последней больше недели (браузер не работает в фоне).',
         gd_on: 'Вкл', gd_off: 'Выкл', gd_sync: 'Синхронизировать', gd_synced: 'Синхронизировано: избранное — %s, история — %s', gd_sync_hint: 'Объединяет избранное и историю активного пользователя с папкой «BN Stream/Sync».',
         gd_upload: 'Загрузить видео', gd_uploading: 'Загрузка... %s%', gd_up: 'На папку выше', gd_play: 'Смотреть', gd_loading: 'Загрузка видео... %s%', gd_open_drive: 'Открыть в Google Drive', gd_download: 'Скачать',
         gd_too_big: 'Этот браузер не может передавать файл потоком (нет service worker), а для полной загрузки он слишком велик. Его можно открыть в Google Drive.',
         gd_expired: 'Вход в Google истёк (он действует один час). Войдите снова.', gd_closed: 'Окно входа закрыто', gd_denied: 'Вход не подтверждён',
         gd_only_own: 'Google показывает сайту только файлы, загруженные сайтом (или Kodi из того же проекта). Загрузите видео отсюда, чтобы смотреть его на любом устройстве.'},
  });
  const t = TN.t, S = TN.settings;
  const client = () => String(S.get('gdrive_client', '') || '').trim();
  const redirectUri = () => new URL('gdrive_cb.html', location.href.split('#')[0].split('?')[0]).href;
  const fail = (code, msg) => Object.assign(new Error(msg || code), {code});
  let tok = null;                                    // {token, until}
  function loadTok() {
    try { const s = JSON.parse(sessionStorage.getItem('tn_gd') || 'null'); tok = s && s.token && s.until > Date.now() ? {token: String(s.token), until: Number(s.until)} : null; } catch (e) { tok = null; }
  }
  loadTok();
  const ready = () => !!(tok && tok.until > Date.now() + 30000);
  const newState = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  function keep(answer) {
    tok = {token: answer.token, until: Date.now() + (answer.expires || 3600) * 1000};
    try { sessionStorage.setItem('tn_gd', JSON.stringify(tok)); } catch (x) {}
  }

  function signIn() {                                // the pop-up flow
    return new Promise((resolve, reject) => {
      const cid = client();
      if (!clientOk(cid)) return reject(fail('client', t('gd_bad_client')));
      const state = newState();
      // (a browser that cuts the pop-up off from this window lets gdrive_cb.html finish the sign-in inside the pop-up)
      try { sessionStorage.setItem('tn_gd_state', state); } catch (e) {}
      const w = window.open(authUrl(cid, redirectUri(), state), 'tn_gdrive', 'width=520,height=680');
      if (!w) return reject(fail('popup', t('gd_popup')));
      let watch = 0;
      const done = (e) => {
        if (e.origin !== location.origin || !e.data || e.data.type !== 'tn_gdrive') return;
        window.removeEventListener('message', done); clearInterval(watch);
        if (e.data.state !== state || !e.data.token) return reject(fail('denied', t('gd_denied')));
        keep({token: String(e.data.token), expires: Number(e.data.expires) || 3600});
        resolve(true);
      };
      window.addEventListener('message', done);
      watch = setInterval(() => {
        if (!w.closed) return;
        clearInterval(watch);
        setTimeout(() => { window.removeEventListener('message', done); loadTok(); if (ready()) resolve(true); else reject(fail('closed', t('gd_closed'))); }, 600);
      }, 700);
    });
  }
  function signInHere() {                            // the same flow in this tab (gdrive_cb.html returns to #/gdrive)
    const cid = client();
    if (!clientOk(cid)) throw fail('client', t('gd_bad_client'));
    const state = newState();
    try { sessionStorage.setItem('tn_gd_state', state); } catch (e) { throw fail('storage', 'sessionStorage'); }
    location.assign(authUrl(cid, redirectUri(), state));
  }
  function signOut() {
    const old = tok; tok = null;
    try { sessionStorage.removeItem('tn_gd'); } catch (e) {}
    if (old) fetch('https://oauth2.googleapis.com/revoke', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'token=' + encodeURIComponent(old.token), credentials: 'omit'}).catch(() => {});
  }
  async function call(url, opt) {
    opt = opt || {};
    if (!ready()) throw fail('expired', t('gd_expired'));
    const r = await fetch(url, Object.assign({}, opt, {headers: Object.assign({Authorization: 'Bearer ' + tok.token}, opt.headers || {}), credentials: 'omit'}));
    if (r.status === 401) { tok = null; try { sessionStorage.removeItem('tn_gd'); } catch (e) {} throw fail('expired', t('gd_expired')); }
    if (!r.ok) throw fail('drive', 'Drive ' + r.status);
    return r;
  }
  const qs = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const idOk = (id) => /^[A-Za-z0-9_-]{5,120}$/.test(String(id || '')) || id === 'root';
  async function list(parent, foldersOnly, name) {
    if (!idOk(parent)) throw fail('drive', 'bad id');
    const q = ["'" + qs(parent) + "' in parents", 'trashed=false'];
    if (foldersOnly) q.push("mimeType='" + FOLDER + "'");
    if (name) q.push("name='" + qs(name) + "'");
    const out = []; let page = '';
    do {
      const p = new URLSearchParams({q: q.join(' and '), fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,thumbnailLink)', pageSize: '200', orderBy: 'modifiedTime desc'});
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
      const found = (await list(parent, true, name))[0];
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
  const fileUrl = (id) => API + '/' + encodeURIComponent(id);
  async function bytes(id) { return new Uint8Array(await (await call(fileUrl(id) + '?alt=media')).arrayBuffer()); }
  async function range(id, start, end) {
    const r = await call(fileUrl(id) + '?alt=media', {headers: {Range: 'bytes=' + start + '-' + end}});
    return new Uint8Array(await r.arrayBuffer());
  }
  const remove = (id) => call(fileUrl(id), {method: 'DELETE'});
  async function about() {
    const j = await (await call('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress),storageQuota(usage,limit)')).json();
    return {name: (j.user && (j.user.displayName || j.user.emailAddress)) || '', usage: Number((j.storageQuota || {}).usage) || 0, limit: Number((j.storageQuota || {}).limit) || 0};
  }
  // a JSON file of a folder: read (null when missing), write (the same file is replaced)
  async function readJson(parent, name) {
    const f = (await list(parent, false, name))[0];
    if (!f) return {id: '', data: null};
    try { return {id: f.id, data: JSON.parse(new TextDecoder().decode(await bytes(f.id)))}; } catch (e) { return {id: f.id, data: null}; }
  }
  async function writeJson(parent, name, id, data) {
    const blob = new Blob([JSON.stringify(data)], {type: 'application/json'});
    if (id) return call(UP + '/' + encodeURIComponent(id) + '?uploadType=media', {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: blob});
    return upload(parent, name, blob);
  }

  // ---- backup (K06): upload, then keep only the newest N
  const keepN = () => Math.max(1, Math.min(20, Number(S.get('gdrive_keep', 5)) || 5));
  async function backupNow() {
    await TN.load('backup');
    const B = root.TNBackup, dir = await folder('Backups');
    await upload(dir, B.zipName(), await B.makeZip());
    for (const old of prune(await list(dir), keepN())) await remove(old.id).catch(() => {});
    TN.put('gdrive_last', Date.now());
  }
  // ---- sync (K07): the active user's favourites / history / removed marks, merged both ways with BN Stream/Sync
  async function syncNow() {
    const dir = await folder('Sync'), SD = TN.SyncDoc, store = TN.store, uid = store.current();
    const [fav, his, rem] = await Promise.all(['favourites.json', 'history.json', 'favourites_removed.json'].map((n) => readJson(dir, n)));
    const arr = (x) => (Array.isArray(x.data) ? x.data : []);
    const local = store.data(uid);
    const merged = SD.merge_user_data(local, Object.assign({}, local, {favourites: arr(fav), history: arr(his), removed: arr(rem)}));
    store.putData(uid, merged);
    const now = store.data(uid);
    await writeJson(dir, 'favourites.json', fav.id, now.favourites || []);
    await writeJson(dir, 'history.json', his.id, now.history || []);
    await writeJson(dir, 'favourites_removed.json', rem.id, now.removed || []);
    return [(now.favourites || []).length, (now.history || []).length];
  }

  // ---- play (K08): Range requests with the header -> the page's stream proxy -> the site player
  let lastStream = null;
  async function play(f, say) {
    say = say || (() => {});
    const size = Number(f.size) || 0, mime = mimeOf(f);
    const pl = await TN.provider('player').catch(() => null);
    if (!pl || !pl.open || !size) { if (f.webViewLink) window.open(TN.httpsOnly(f.webViewLink), '_blank', 'noopener'); return; }
    const tgp = await TN.provider('tgplay').catch(() => null);
    const title = f.name || 'Google Drive', resumeKey = 'gd:' + f.id;
    if (tgp && tgp.openSource) {
      try {
        const h = await tgp.openSource({size, mime, name: title, readPart: (i, part) => { const r = rangeOf(i, part, size); return r ? range(f.id, r[0], r[1]) : Promise.resolve(new Uint8Array(0)); }});
        if (lastStream && tgp.close) tgp.close(lastStream);
        lastStream = h.key;
        return pl.open({url: h.url, title, mime, resumeKey, release: title});
      } catch (e) { if (!e || (e.code !== 'TGPLAY_NO_SW' && e.message !== 'TGPLAY_NO_SW')) throw e; }
    }
    if (size > BLOB_MAX) throw fail('too_big', t('gd_too_big'));
    // no service worker: the whole file, in parts, into memory
    const parts = [], PART = 4 * 1024 * 1024;
    for (let i = 0; i * PART < size; i++) {
      const r = rangeOf(i, PART, size);
      parts.push(await range(f.id, r[0], r[1]));
      say(t('gd_loading', Math.round(Math.min(100, (r[1] + 1) * 100 / size))));
    }
    const url = URL.createObjectURL(new Blob(parts, {type: mime}));
    setTimeout(() => URL.revokeObjectURL(url), 6 * 3600 * 1000);
    say('');
    return pl.open({url, title, mime, resumeKey, release: title});
  }
  // a large file in one resumable upload, with progress
  async function uploadBig(parent, file, onPct) {
    const start = await call(UP + '?uploadType=resumable', {method: 'POST', headers: {'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': file.type || 'video/mp4'},
      body: JSON.stringify({name: file.name, parents: [parent]})});
    const session = start.headers.get('Location');
    if (!session || !/^https:\/\/www\.googleapis\.com\//.test(session)) return upload(parent, file.name, file);      // (the header is not readable here: one plain upload)
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('PUT', session);
      x.upload.onprogress = (e) => { if (e.lengthComputable && onPct) onPct(Math.round(e.loaded * 100 / e.total)); };
      x.onload = () => (x.status >= 200 && x.status < 300 ? resolve(true) : reject(fail('drive', 'Drive ' + x.status)));
      x.onerror = () => reject(fail('drive', 'network'));
      x.send(file);
    });
  }

  TN.registerProvider('gdrive', {kinds: ['service'], label: 'Google Drive', ready, signIn, signInHere, signOut, about, folder, list, upload, bytes, range, play, backupNow, syncNow});

  // ------------------------------------------------------------ the page
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function copyLine(label, value) {
    const line = el('div', 'gd_line');
    const code = el('code', '', value); code.dir = 'ltr';
    const b = TN.button('btn ghost', t('gd_copy'), () => {
      const ok = () => { b.textContent = t('gd_copied'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(ok, () => {});
      else { const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); try { if (document.execCommand('copy')) ok(); } catch (e) {} }
    });
    line.append(el('small', '', label), code, b);
    return line;
  }
  function style() {
    if (document.getElementById('gd_css')) return;
    const s = el('style'); s.id = 'gd_css';
    s.textContent = '.gd_line{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0}.gd_line small{flex:1 1 100%;color:var(--muted)}' +
      '.gd_line code{flex:1 1 240px;background:var(--panel2);padding:8px 10px;border-radius:8px;overflow-wrap:anywhere;user-select:all}' +
      '.gd_in{flex:1 1 260px;min-width:0;min-height:44px;background:var(--panel);color:var(--text);border:1px solid var(--muted);border-radius:10px;padding:9px 14px;font:inherit}' +
      '.gd_in:focus-visible{outline:3px solid var(--ring)}.gd_row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.gd_row b{flex:1 1 200px;overflow-wrap:anywhere}' +
      '.gd_h2{margin:22px 0 8px;font-size:18px}.gd_list{display:grid;gap:8px;max-width:820px}.gd_sw{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:10px 0}' +
      '.gd_sw>span{flex:1 1 240px}.gd_sw small{display:block;color:var(--muted)}.gd_sel{min-height:44px;background:var(--panel);color:var(--text);border:1px solid var(--muted);border-radius:10px;padding:6px 10px;font:inherit}';
    document.head.append(s);
  }
  async function pageDrive(arg, ctx) {
    style();
    TN.page('gdrive', t('m_gdrive'));
    const view = TN.view(), p = TN.params(arg);
    loadTok();                                       // (the sign-in in this tab came back with a fresh one)
    const box = el('div', 'panel settings'); view.append(box);
    box.append(el('p', '', t('gd_intro')));
    const msg = el('p', 'hint'); msg.setAttribute('role', 'status');
    const say = (s) => { msg.textContent = s || ''; };
    const err = (e) => say(e && e.code && e.code !== 'drive' ? e.message : t('gd_fail', (e && e.message) || e));

    // ---------------- not set up / signed out
    if (!ready()) {
      const cid = client();
      const setup = el('details', ''); setup.open = !cid;
      setup.append(el('summary', '', t('gd_setup')), el('p', 'hint', t('gd_noclient')), copyLine(t('gd_origin'), location.origin), copyLine(t('gd_redirect'), redirectUri()),
        el('p', 'hint', t('gd_same')));
      const con = el('a', 'btn ghost', t('gd_console')); con.href = 'https://console.cloud.google.com/apis/credentials'; con.target = '_blank'; con.rel = 'noopener noreferrer';
      const f = el('form', 'links');
      const inp = el('input', 'gd_in'); inp.value = cid; inp.dir = 'ltr'; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.placeholder = '1234567890-abc123.apps.googleusercontent.com'; inp.setAttribute('aria-label', t('gd_client'));
      const sb = el('button', 'btn' + (cid ? ' ghost' : ''), t('gd_save')); sb.type = 'submit';
      f.append(inp, sb);
      f.onsubmit = (e) => { e.preventDefault(); const v = inp.value.trim(); if (v && !clientOk(v)) return say(t('gd_bad_client')); S.set('gdrive_client', v); TN.route(); };
      const conLine = el('div', 'links'); conLine.append(con);
      setup.append(conLine, el('label', '', t('gd_client')), f);
      box.append(setup);
      if (cid) {
        const acts = el('div', 'links');
        acts.append(TN.button('btn', t('gd_in'), () => signIn().then(() => TN.route(), err)),
                    TN.button('btn ghost', t('gd_in_tab'), () => { try { signInHere(); } catch (e) { err(e); } }));
        box.append(acts);
      }
      box.append(msg);
      if (p.err) say(p.err === 'denied' ? t('gd_denied') : t('gd_fail', String(p.err).slice(0, 60)));
      return;
    }

    // ---------------- signed in
    const who = el('p', 'hint', ''); box.append(who);
    about().then((a) => { if (ctx.current()) who.textContent = t('gd_acc', a.name) + (a.limit ? ' · ' + t('gd_space', sizeText(a.usage), sizeText(a.limit)) : ''); }, () => {});
    const acts = el('div', 'links');
    acts.append(TN.button('btn', t('gd_backup'), async () => { say(t('gd_wait')); try { await backupNow(); say(t('gd_done')); TN.route(); } catch (e) { err(e); } }),
      TN.button('btn ghost', t('gd_sync'), async () => { say(t('gd_wait')); try { const n = await syncNow(); say(t('gd_synced', n[0], n[1])); } catch (e) { err(e); } }),
      TN.button('btn ghost', t('gd_out'), () => { signOut(); TN.route(); }));
    box.append(acts, el('p', 'hint', t('gd_sync_hint')));
    // keep N and the weekly backup
    const keepLine = el('label', 'gd_sw'); const sel = el('select', 'gd_sel');
    for (let i = 1; i <= 20; i++) { const o = el('option', '', String(i)); o.value = String(i); if (i === keepN()) o.selected = true; sel.append(o); }
    sel.onchange = () => S.set('gdrive_keep', Number(sel.value) || 5);
    keepLine.append(el('span', '', t('gd_keep')), sel);
    const autoLine = el('div', 'gd_sw');
    const autoTxt = el('span', '', t('gd_auto')); autoTxt.append(el('small', '', t('gd_auto_hint')));
    const autoBtn = el('button', 'btn'); autoBtn.type = 'button'; autoBtn.setAttribute('role', 'switch');
    const paintAuto = () => { const on = S.get('gdrive_auto', false) === true; autoBtn.className = 'btn' + (on ? '' : ' ghost'); autoBtn.textContent = t(on ? 'gd_on' : 'gd_off'); autoBtn.setAttribute('aria-checked', String(on)); autoBtn.setAttribute('aria-label', t('gd_auto')); };
    autoBtn.onclick = () => { S.set('gdrive_auto', S.get('gdrive_auto', false) !== true); paintAuto(); };
    paintAuto();
    autoLine.append(autoTxt, autoBtn);
    box.append(keepLine, autoLine, msg);
    if (S.get('gdrive_auto', false) === true && Date.now() - (Number(TN.get('gdrive_last', 0)) || 0) > WEEK) backupNow().then(() => { if (ctx.current()) say(t('gd_done')); }, () => {});

    try {
      // ---------------- the folder being browsed (K08)
      const rootId = await folder('');
      if (!ctx.current()) return;
      const here = p.f && idOk(p.f) && p.f !== 'root' ? p.f : rootId;
      view.append(el('h2', 'gd_h2', here === rootId ? t('gd_files') : (p.n || t('gd_files'))));
      const tools = el('div', 'links');
      if (here !== rootId) tools.append(Object.assign(el('a', 'btn ghost', '↑ ' + t('gd_up')), {href: '#/gdrive'}));
      const pick = el('input'); pick.type = 'file'; pick.accept = 'video/*,.mkv,.mp4,.webm,.mov,.avi'; pick.hidden = true;
      tools.append(TN.button('btn ghost', t('gd_upload'), () => pick.click()), pick);
      pick.onchange = async () => {
        const f = pick.files && pick.files[0]; pick.value = '';
        if (!f) return;
        say(t('gd_uploading', 0));
        try { await uploadBig(here, f, (pct) => say(t('gd_uploading', pct))); say(t('gd_done')); TN.route(); } catch (e) { err(e); }
      };
      view.append(tools);
      const fl = el('div', 'gd_list'); view.append(fl);
      const sk = TN.skeleton(3);
      const files = await list(here);
      if (!ctx.current()) return;
      if (sk.isConnected) sk.remove();
      const dirs = files.filter((x) => x.mimeType === FOLDER), vids = files.filter((x) => x.mimeType !== FOLDER && isVideo(x));
      const rest = files.filter((x) => x.mimeType !== FOLDER && !isVideo(x) && !(here === rootId && /\.zip$/i.test(x.name)));
      if (!dirs.length && !vids.length && !rest.length) fl.append(el('p', 'hint', t('gd_none')));
      for (const d of dirs) {
        const a = el('a', 'panel gd_row'); a.href = TN.link('gdrive', {f: d.id, n: d.name}); a.style.textDecoration = 'none'; a.style.color = 'inherit';
        const nm = el('b', '', '📁 ' + d.name); nm.dir = 'auto';
        a.append(nm); fl.append(a);
      }
      for (const v of vids) {
        const r = el('div', 'panel gd_row');
        const nm = el('b', '', v.name); nm.dir = 'auto';
        const playBtn = TN.button('btn', '▶ ' + t('gd_play'), async () => {
          say(t('gd_wait'));
          try { await play(v, say); say(''); } catch (e) {
            err(e);
            if (e && e.code === 'too_big' && v.webViewLink) { const a = el('a', 'btn', t('gd_open_drive')); a.href = TN.httpsOnly(v.webViewLink); a.target = '_blank'; a.rel = 'noopener noreferrer'; msg.append(' ', a); a.focus(); }
          }
        });
        r.append(nm, el('span', 'hint', [sizeText(v.size), (v.modifiedTime || '').slice(0, 10)].filter(Boolean).join(' · ')), playBtn);
        if (v.webViewLink) { const a = el('a', 'btn ghost', t('gd_open_drive')); a.href = TN.httpsOnly(v.webViewLink); a.target = '_blank'; a.rel = 'noopener noreferrer'; r.append(a); }
        fl.append(r);
      }
      for (const x of rest) {
        const r = el('div', 'panel gd_row');
        const nm = el('b', '', x.name); nm.dir = 'auto';
        r.append(nm, el('span', 'hint', sizeText(x.size)));
        if (x.webViewLink) { const a = el('a', 'btn ghost', t('gd_open_drive')); a.href = TN.httpsOnly(x.webViewLink); a.target = '_blank'; a.rel = 'noopener noreferrer'; r.append(a); }
        fl.append(r);
      }
      if (here === rootId && !vids.length) view.append(el('p', 'hint', t('gd_only_own')));

      // ---------------- backups (K06)
      if (here === rootId) {
        view.append(el('h2', 'gd_h2', t('gd_backups')));
        const bl = el('div', 'gd_list'); view.append(bl);
        const backs = (await list(await folder('Backups'))).filter((x) => /\.zip$/i.test(x.name));
        if (!ctx.current()) return;
        if (!backs.length) bl.append(el('p', 'hint', t('gd_none')));
        for (const b of backs.slice(0, 30)) {
          const r = el('div', 'panel gd_row');
          const nm = el('b', '', b.name); nm.dir = 'ltr';
          r.append(nm, el('span', 'hint', [(b.modifiedTime || '').slice(0, 16).replace('T', ' '), sizeText(b.size)].filter(Boolean).join(' · ')), TN.button('btn ghost', t('gd_restore'), async () => {
            say(t('gd_wait'));
            try { await TN.load('backup'); say(await root.TNBackup.restoreBytes(await bytes(b.id), false)); } catch (e) { err(e); }
            msg.scrollIntoView && msg.scrollIntoView({block: 'center'});
          }));
          bl.append(r);
        }
      }
    } catch (e) {
      if (!ctx.current()) return;
      if (e && e.code === 'expired') return TN.route();
      err(e);
    }
  }
  TN.registerPage('gdrive', pageDrive);
})(typeof self !== 'undefined' ? self : globalThis);
