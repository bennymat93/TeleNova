'use strict';
// WP-9: sync, backup / restore, export / import (Kodi K01-K03, K12, X14).
// 1. Sync (K01): the state of the account's document, "Sync now", and - when the account has NO document yet (Kodi
//    never ran on it) - "Create the sync document" from this browser: the users and lists of this browser, sealed
//    exactly as the build seals them (sealed.js, websync.js caption), sent to Saved Messages. Settings stay empty in
//    it: a browser owns no build settings; a Kodi device that joins later adds its own.
// 2. Backup zip (K02 / K03) in the shape of the build's backup (backup.make_zip):
//      bn_backup.txt                                        the marker restore_zip looks for
//      addon_data/plugin.video.nova/users.json              the users (users.py LIST)
//      addon_data/plugin.video.nova/<file>.json             the active user's lists (users.py FILES)
//      addon_data/plugin.video.nova/users/<id>/<file>.json  every other user's lists
//      web/bn_web.json                                      this browser's settings (Kodi's restore ignores it)
//    so a web backup restores in Kodi and a Kodi backup restores here. A restore MERGES (the same merge as the sync).
// 3. Settings file (K12 / T06) in the build's sealed format (.tncfg, configio.py; optional password): this browser's
//    keys under the build's setting names, so Kodi can import it, and a file exported from Kodi imports here
//    (TMDb / Gemini / OpenSubtitles keys, StremThru, quiet mode, bots, Stremio servers, the Real-Debrid token).
// The Telegram session is never part of any of these, and a session inside a Kodi file is never read.
(function (root) {
  const NOVA = 'addon_data/plugin.video.nova/';
  const FILES = [['history.json', 'history', []], ['favourites.json', 'favourites', []], ['favourites_removed.json', 'removed', []],
                 ['search_history.json', 'searches', []], ['user_marks.json', 'marks', null]];
  const MARK = 'bn_backup.txt', WEB = 'web/bn_web.json', MAX = 20 * 1024 * 1024;
  const ID_RX = /^[A-Za-z0-9_-]{1,40}$/;
  // never in a backup: this device's choices and anything that signs in
  const CFG_SKIP = ['helper_token'];
  // 6.1.7: the plain (not encrypted) zip carries no keys or sign-ins - those go only in the password-protected full backup
  const SECRET_RX = /(^|_)(key|token|pass|password|secret|client)$|^(tmdb|helper|stremthru_url|subs_server_url|gdrive_client)$/;
  const DEVICE_ONLY = ['device', 'zoom'];

  // ------------------------------------------------------------ pure (node: src/qa/web/t_services.js)
  // store: the Store object (store.js), SD: SyncDoc, cfg: this browser's settings -> {path: text}
  function makeFiles(store, SD, cfg, now) {
    const out = {};
    out[MARK] = 'BN Stream backup ' + new Date(now || Date.now()).toString() + ' (web)\n';
    const users = store.users();
    out[NOVA + 'users.json'] = SD.canon(users);
    const cur = store.current();
    for (const u of users) {
      if (!u || Number(u.deleted || 0) || !ID_RX.test(String(u.id))) continue;
      const d = store.data(u.id);
      const base = u.id === cur ? NOVA : NOVA + 'users/' + u.id + '/';
      for (const [name, key, dflt] of FILES) {
        const v = d[key];
        if (dflt && Array.isArray(v) && !v.length) continue;
        if (!dflt && (!v || !Object.keys(v).length)) continue;
        out[base + name] = SD.canon(v);
      }
    }
    if (cfg) {
      const c = Object.assign({}, cfg);
      for (const k of Object.keys(c)) if (CFG_SKIP.includes(k) || SECRET_RX.test(k)) delete c[k];
      out[WEB] = JSON.stringify({cfg: c, current: cur, made: Math.floor((now || Date.now()) / 1000)});
    }
    return out;
  }
  // {path: text} of a zip -> {ok, users, data: {uid: {...}}, current, web}
  function readFiles(files, SD) {
    if (!(MARK in files)) return {ok: false};
    const parse = (p, d) => { try { return p in files ? SD.parse(files[p]) : d; } catch (e) { return d; } };
    let users = parse(NOVA + 'users.json', null);
    if (!Array.isArray(users) || !users.length) users = [{id: 'u1', name: '', created: 1, renamed: 0, deleted: 0}];
    const folders = new Set();
    for (const p of Object.keys(files)) {
      const m = p.slice(NOVA.length).match(/^users\/([^/]+)\//);
      if (p.startsWith(NOVA) && m && ID_RX.test(m[1])) folders.add(m[1]);
    }
    const web = parse(WEB, null);
    const live = users.filter((u) => u && !Number(u.deleted || 0)).map((u) => String(u.id));
    // the active user of the device that made it: its lists are the ones at the top (Kodi: sync_state.json, which
    // never travels; a web backup says it in web/bn_web.json)
    let current = web && live.includes(web.current) ? web.current : (live.find((id) => !folders.has(id)) || live[0] || 'u1');
    const data = {};
    for (const id of live) {
      const base = id === current ? NOVA : NOVA + 'users/' + id + '/';
      const d = {};
      for (const [name, key, dflt] of FILES) {
        const v = parse(base + name, dflt || SD.dict());
        d[key] = dflt ? (Array.isArray(v) ? v : []) : (v && typeof v === 'object' && !Array.isArray(v) ? v : SD.dict());
      }
      data[id] = d;
    }
    return {ok: true, users, data, current, web: web && typeof web === 'object' ? web : null};
  }
  // merge a read backup into the store -> number of users touched
  function restoreInto(store, SD, b) {
    const users = SD.merge_users(store.users(), b.users);
    store.setUsers(users);
    const alive = new Set(store.live().map((u) => u.id));
    let n = 0;
    for (const [id, d] of Object.entries(b.data)) {
      if (!alive.has(id)) continue;
      if (store.putData(id, SD.merge_user_data(store.data(id), d))) n++;
    }
    return n;
  }

  // ---- the settings file: this browser's setting <-> the build's setting id (telescope / nova settings.xml)
  // [web setting, build id, kind: 's' text | 'b' switch]
  const TWINS = [['tmdb', 'tmdb_key', 's'], ['gemini_key', 'gemini_key', 's'], ['subs_os_key', 'os_key', 's'], ['stremthru_url', 'st_url', 's'],
                 ['stremthru_on', 'st_enabled', 'b'], ['telegram_quiet', 'tg_quiet', 'b'], ['tgsearch_bots', 'bot_request', 'b']];
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';
  // this browser's settings -> the settings a .tncfg carries (only what is set; switches as the build writes them)
  function webToKodi(cfg, addons) {
    const out = {};
    cfg = cfg || {};
    for (const [w, k, kind] of TWINS) {
      if (!(w in cfg)) continue;
      if (kind === 'b') out[k] = cfg[w] ? 'true' : 'false'; else if (str(cfg[w])) out[k] = str(cfg[w]);
    }
    const list = (addons || []).filter((u) => /^https:\/\//i.test(u));
    if (list.length) out.stremio_servers = list.join('\n');
    return out;
  }
  // what an unpacked .tncfg gives a browser -> {cfg: {web setting: value}, rd: token | '', api: {id, hash} | null, addons: [], names: []}
  // A web export carries the whole browser settings in extra.web.cfg; a Kodi export is read through TWINS. Files (a
  // Telegram session among them) are never looked at.
  function kodiToWeb(packed) {
    const s = (packed && packed.settings) || {}, extra = (packed && packed.extra) || {};
    const out = {cfg: {}, rd: '', api: null, addons: [], names: []};
    const web = extra.web && typeof extra.web === 'object' && extra.web.cfg && typeof extra.web.cfg === 'object' ? extra.web.cfg : null;
    if (web) for (const k of Object.keys(web)) if (!CFG_SKIP.includes(k) && /^[a-z][a-z0-9_]*$/.test(k)) out.cfg[k] = web[k];
    for (const [w, k, kind] of TWINS) {
      if (!(k in s) || w in out.cfg) continue;
      if (kind === 'b') out.cfg[w] = bool(s[k]); else if (str(s[k])) out.cfg[w] = str(s[k]);
    }
    if (!out.cfg.tmdb && str(s.tmdb_token)) out.cfg.tmdb = str(s.tmdb_token);
    if (!out.cfg.subs_os_key && str(s.opensubs_key)) out.cfg.subs_os_key = str(s.opensubs_key);
    if (/^[A-Za-z0-9]{20,80}$/.test(str(s.rd_token))) out.rd = str(s.rd_token);
    if (/^\d{3,12}$/.test(str(s.api_id)) && /^[0-9a-f]{32}$/i.test(str(s.api_hash))) out.api = {id: str(s.api_id), hash: str(s.api_hash).toLowerCase()};
    out.addons = str(s.stremio_servers).split(/[\s,;]+/).filter((u) => /^(https|stremio):\/\//i.test(u)).slice(0, 12);
    const label = {tmdb: 'TMDb', gemini_key: 'Gemini', subs_os_key: 'OpenSubtitles', stremthru_url: 'StremThru', yt_key: 'YouTube', helper: 'Worker',
      subs_server_url: 'AI subtitles', gdrive_client: 'Google Drive'};
    for (const k of Object.keys(label)) if (str(out.cfg[k])) out.names.push(label[k]);
    if (out.rd) out.names.push('Real-Debrid');
    if (out.addons.length) out.names.push('Stremio');
    return out;
  }

  // ---- founding the account's document from a browser. deps: {WS, SD, users(), userData(uid), list() -> [{id, date, note}],
  //      seal(text) -> bytes, send(bytes, name, caption) -> message id | 0}  -> 'exists' | 'made'
  async function found(deps) {
    const WS = deps.WS;
    if (WS.mine(await deps.list())) return 'exists';
    // merged with an empty document: the exact form every later round writes, so the first round has nothing to add
    const doc = deps.SD.merge(WS.localDoc({users: deps.users, userData: deps.userData}), deps.SD.empty());
    const bytes = await deps.seal(deps.SD.canon(doc));
    // (somebody may have founded it meanwhile, a Kodi device starting up: never two documents)
    if (WS.mine(await deps.list())) return 'exists';
    const id = await deps.send(bytes, 'TeleNova-setup-' + WS.DOC_DEVICE + '.tnsync', WS.caption(WS.NOTE));
    if (!id) throw Object.assign(new Error('send'), {code: 'send'});
    return 'made';
  }
  const core = {makeFiles, readFiles, restoreInto, webToKodi, kodiToWeb, found, TWINS, NOVA, MARK, WEB, MAX};
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }

  // ------------------------------------------------------------ the page
  const TN = root.TN;
  root.TNBackup = core;
  TN.i18n.add({
    he: {bk_intro: 'גיבוי של המשתמשים, ההיסטוריה, המועדפים והחיפושים, באותו מבנה של הגיבוי ב-Kodi: אפשר לשחזר אותו ב-Kodi, ולשחזר כאן גיבוי שנעשה ב-Kodi.',
         bk_make: 'הורדת גיבוי', bk_restore: 'שחזור מקובץ', bk_made: 'הגיבוי נשמר (%s)', bk_bad: 'זה אינו קובץ גיבוי של BN Stream',
         bk_h_move: 'העברת כל ההגדרות למכשיר אחר', bk_move_intro: 'כל ההגדרות, המפתחות והחיבורים (Real-Debrid, פרטי טלגרם, שרתים) עוברים למכשיר השני בסריקה אחת וקוד בן 6 ספרות. במכשיר הזה שום דבר לא משתנה.',
         bk_move_show: 'הצג קוד להעברה', bk_move_scan: '1. סרקו את הקוד במצלמה של המכשיר השני (או פתחו בו את הקישור).', bk_move_noqr: 'פתחו את הקישור במכשיר השני:', bk_move_pin_is: '2. הקלידו שם את הקוד:',
         bk_move_copy: 'העתק קישור', bk_move_copied: 'הקישור הועתק', bk_move_note: 'הקישור מוצפן בקוד. אל תשלחו את הקישור והקוד יחד למי שאינו אתם. טלגרם: המכשיר השני מתחבר בעצמו באישור אחד – חיבור טלגרם לא מועתק, כדי שלא יתנתקו שני המכשירים.',
         bk_move_got: 'התקבלו הגדרות ממכשיר אחר. הקלידו את הקוד בן 6 הספרות שמופיע בו:', bk_move_pin: 'קוד בן 6 ספרות', bk_move_take: 'קבל את ההגדרות', bk_move_wait: 'רגע…',
         bk_move_done: 'ההגדרות התקבלו: %s', bk_move_tg: 'נשאר צעד אחד: לחבר את טלגרם במכשיר הזה (אישור אחד באפליקציית טלגרם).', bk_move_paste: 'קיבלתי קישור – הדבק', bk_gd_intro: 'התחברות ל-Google Drive, גיבוי אליו, שחזור ממנו והסרטונים שלך – הכול במסך אחד.', bk_gd_open: 'Google Drive – כל האפשרויות', bk_move_full: 'עובר הכול: הגדרות, חיבורים, משתמשים, היסטוריה, מועדפים וחיפושים. הקוד תקף 15 דקות ולשימוש אחד.', bk_move_part: 'תיבת המסירה לא זמינה כרגע: עוברים ההגדרות והחיבורים בלבד (היסטוריה ומועדפים יסתנכרנו דרך טלגרם).', bk_move_gone: 'הקוד כבר נוצל או שפג תוקפו (15 דקות). הציגו קוד חדש במכשיר הראשון.', bk_move_app: 'פתח באפליקציית BN Stream', bk_move_app_txt: 'משתמשים באפליקציה? העבירו את ההגדרות אליה: לחצו "פתח באפליקציה", או העתיקו את הקישור ולחצו באפליקציה על "קיבלתי קישור – הדבק".', bk_move_nolink: 'לא נמצא קישור העברה בלוח ההעתקה.',
         bk_h_full: 'גיבוי מלא מוגן בסיסמה', bk_full_intro: 'קובץ אחד עם הכול: כל ההגדרות, מפתחות ה-API, חשבונות וסיסמאות (כתוביות, IPTV, Google Drive), החיבור ל-Real-Debrid, פרטי טלגרם, שרתים, והמשתמשים עם ההיסטוריה, המועדפים והחיפושים. הקובץ מוצפן בסיסמה שתבחרו, ואפשר לשחזר אותו בכל מכשיר שמותקן בו BN Stream – אתר, אפליקציה או Kodi.',
         bk_full_pass: 'סיסמה לגיבוי (6 תווים לפחות)', bk_full_pass2: 'הסיסמה שוב', bk_full_make: 'צור גיבוי מלא', bk_full_restore: 'שחזר מגיבוי', bk_full_short: 'הסיסמה צריכה להיות באורך %s תווים לפחות.', bk_full_differ: 'שתי הסיסמאות אינן זהות.',
         bk_full_need_pass: 'הקלידו קודם את סיסמת הגיבוי, ואז בחרו את הקובץ.', bk_full_made: 'הגיבוי נשמר: %s. שמרו את הקובץ ואת הסיסמה – בלי הסיסמה אי אפשר לפתוח אותו.', bk_full_done: 'שוחזר: %s', bk_tg_auto: 'טלגרם: המכשיר הזה מתחבר עכשיו בעצמו. המכשיר השני שלכם, שבו BN Stream פתוח ומחובר לטלגרם, מאשר את הכניסה אוטומטית.', bk_full_one: 'יש קובץ גיבוי אחד: גיבוי חדש מחליף את הקודם.', bk_full_wrong: 'הסיסמה שגויה. שום דבר לא שוחזר – הקלידו את הסיסמה שנבחרה בזמן יצירת הגיבוי ונסו שוב.', bk_full_notfile: 'זה לא קובץ גיבוי של BN Stream, או שהקובץ פגום.',
         bk_full_device: 'סוג המכשיר זוהה אוטומטית: %s. הגדרות התצוגה הותאמו למכשיר הזה, לא למכשיר שממנו נעשה הגיבוי.', bk_dev_phone: 'טלפון', bk_dev_tablet: 'טאבלט', bk_dev_desktop: 'מחשב', bk_dev_tv: 'טלוויזיה',
         bk_done: 'השחזור הושלם: %s משתמשים עודכנו. מה שהיה בדפדפן נשאר, והגיבוי מוזג אליו.', bk_cfg: 'לשחזר גם את הגדרות הדפדפן מהגיבוי',
         bk_note: 'גיבוי לא כולל את הכניסה לטלגרם ואת הכניסה ל-Real-Debrid: כל מכשיר מתחבר בעצמו. הוא כן כולל את המפתחות שהוזנו בדפדפן הזה (TMDb, Gemini, YouTube, OpenSubtitles); שמרו אותו במקום פרטי.',
         bk_drive: 'גיבוי ל-Google Drive', bk_big: 'הקובץ גדול מדי', bk_wait: 'רגע...', bk_fail: 'לא הצליח: %s',
         bk_h_sync: 'סנכרון אוטומטי', bk_h_file: 'גיבוי לקובץ', bk_h_cfg: 'ייצוא וייבוא הגדרות',
         bk_sync_intro: 'כשהדפדפן מחובר לטלגרם, המשתמשים והרשימות מסתנכרנים לבד עם כל מכשיר באותו חשבון (Kodi או דפדפן).',
         bk_sync_off: 'הדפדפן לא מחובר לטלגרם.', bk_sync_connect: 'התחברות לטלגרם', bk_sync_on: 'מחובר', bk_sync_last: 'סנכרון אחרון: %s', bk_sync_now: 'סנכרון עכשיו',
         bk_sync_ran: 'הסנכרון רץ', bk_sync_wait: 'טלגרם מתחבר...', bk_users: 'משתמשים',
         bk_nodoc: 'בחשבון עדיין אין מסמך סנכרון. אפשר ליצור אותו מהדפדפן הזה: המשתמשים והרשימות שכאן יישמרו מוצפנים ב"הודעות שמורות", וכל מכשיר אחר שיתחבר יצטרף אליו.',
         bk_nodoc_kodi: 'אם אתם משתמשים גם ב-Kodi, עדיף לפתוח פעם אחת את האפליקציה שם: היא יוצרת את המסמך יחד עם ההגדרות שלה.',
         bk_found: 'יצירת מסמך הסנכרון', bk_found_q: 'ללחוץ שוב כדי ליצור את מסמך הסנכרון מהדפדפן הזה', bk_found_made: 'המסמך נוצר. הסנכרון פועל.',
         bk_found_exists: 'בחשבון כבר יש מסמך סנכרון. הדפדפן הצטרף אליו.', bk_unreadable: 'מסמך הסנכרון בחשבון לא נקרא. הדפדפן לא יכתוב מעליו; פתחו את Kodi או נסו שוב מאוחר יותר.',
         bk_cfg_intro: 'קובץ אחד עם ההגדרות והמפתחות של הדפדפן, באותו פורמט של "ייצוא הגדרות" ב-Kodi. קובץ שיוצא מ-Kodi מיובא כאן (המפתחות שדפדפן יכול להשתמש בהם); הכניסה לטלגרם אף פעם לא עוברת.',
         bk_pass: 'סיסמה (לא חובה)', bk_export: 'ייצוא הגדרות', bk_import: 'ייבוא הגדרות', bk_exported: 'הקובץ נשמר (%s)', bk_imported: 'יובאו: %s', bk_imported_none: 'בקובץ אין הגדרות שדפדפן יכול להשתמש בהן',
         bk_pass_need: 'הקובץ מוגן בסיסמה: הזינו אותה ונסו שוב', bk_pass_bad: 'סיסמה שגויה (או קובץ פגום)', bk_cfg_bad: 'זה אינו קובץ הגדרות של TeleNova', bk_api_set: 'פרטי ה-API של טלגרם',
         bk_no_crypto: 'הדפדפן הזה לא תומך בהצפנה הדרושה (צריך https)'},
    en: {bk_intro: 'A backup of the users, history, favourites and searches, in the same shape as the Kodi backup: it restores in Kodi, and a Kodi backup restores here.',
         bk_make: 'Download a backup', bk_restore: 'Restore from a file', bk_made: 'Backup saved (%s)', bk_bad: 'This is not a BN Stream backup file',
         bk_h_move: 'Move the whole setup to another device', bk_move_intro: 'Every setting, key and connection (Real-Debrid, the Telegram details, servers) goes to the other device with one scan and a 6-digit code. Nothing changes on this device.',
         bk_move_show: 'Show the transfer code', bk_move_scan: '1. Scan this with the camera of the other device (or open the link on it).', bk_move_noqr: 'Open this link on the other device:', bk_move_pin_is: '2. Type this code there:',
         bk_move_copy: 'Copy the link', bk_move_copied: 'Link copied', bk_move_note: 'The link is sealed with the code. Do not send the link and the code together to anyone else. Telegram: the other device signs in by itself with one confirmation - a Telegram login is never copied, so that neither device is signed out.',
         bk_move_got: 'A setup from another device arrived. Type the 6-digit code it shows:', bk_move_pin: '6-digit code', bk_move_take: 'Take the setup', bk_move_wait: 'One moment…',
         bk_move_done: 'Setup received: %s', bk_move_tg: 'One step left: connect Telegram on this device (one confirmation in the Telegram app).', bk_move_paste: 'I got a link - paste', bk_gd_intro: 'Sign in to Google Drive, back up to it, restore from it and your videos - all on one screen.', bk_gd_open: 'Google Drive - every option', bk_move_full: 'Everything goes: settings, connections, users, history, favourites and searches. The code is good for 15 minutes and for one use.', bk_move_part: 'The drop box is not reachable now: only settings and connections go (history and favourites sync through Telegram).', bk_move_gone: 'This code was already used or has expired (15 minutes). Show a new code on the first device.', bk_move_app: 'Open in the BN Stream app', bk_move_app_txt: 'Using the app? Hand the setup to it: press "Open in the app", or copy the link and press "I got a link - paste" in the app.', bk_move_nolink: 'No transfer link in the clipboard.',
         bk_h_full: 'Full backup, protected by a password', bk_full_intro: 'One file with everything: every setting, API keys, accounts and passwords (subtitles, IPTV, Google Drive), the Real-Debrid sign-in, the Telegram details, servers, and the users with their history, favourites and searches. The file is encrypted with a password you choose and can be restored on any device that has BN Stream - the site, the app or Kodi.',
         bk_full_pass: 'Backup password (6 characters or more)', bk_full_pass2: 'The password again', bk_full_make: 'Make a full backup', bk_full_restore: 'Restore from a backup', bk_full_short: 'The password must be at least %s characters long.', bk_full_differ: 'The two passwords are not the same.',
         bk_full_need_pass: 'Type the backup password first, then choose the file.', bk_full_made: 'Backup saved: %s. Keep the file and the password - without the password it cannot be opened.', bk_full_done: 'Restored: %s', bk_tg_auto: 'Telegram: this device is connecting by itself now. Your other device, where BN Stream is open and connected to Telegram, approves the sign-in automatically.', bk_full_one: 'There is one backup file: a new backup replaces the one before it.', bk_full_wrong: 'Wrong password. Nothing was restored - type the password chosen when the backup was made and try again.', bk_full_notfile: 'This is not a BN Stream backup file, or the file is damaged.',
         bk_full_device: 'The device type was recognised by itself: %s. The display fits this device, not the one the backup came from.', bk_dev_phone: 'phone', bk_dev_tablet: 'tablet', bk_dev_desktop: 'computer', bk_dev_tv: 'television',
         bk_done: 'Restored: %s users updated. What this browser had stays; the backup was merged into it.', bk_cfg: 'Also restore this browser\'s settings from the backup',
         bk_note: 'A backup never holds the Telegram login or the Real-Debrid login: every device signs in by itself. It does hold the keys entered in this browser (TMDb, Gemini, YouTube, OpenSubtitles); keep it somewhere private.',
         bk_drive: 'Back up to Google Drive', bk_big: 'The file is too large', bk_wait: 'One moment...', bk_fail: 'Did not work: %s',
         bk_h_sync: 'Automatic sync', bk_h_file: 'Backup to a file', bk_h_cfg: 'Export and import settings',
         bk_sync_intro: 'While the browser is connected to Telegram, the users and lists sync by themselves with every device on the same account (Kodi or a browser).',
         bk_sync_off: 'This browser is not connected to Telegram.', bk_sync_connect: 'Connect Telegram', bk_sync_on: 'Connected', bk_sync_last: 'Last sync: %s', bk_sync_now: 'Sync now',
         bk_sync_ran: 'The sync ran', bk_sync_wait: 'Telegram is connecting...', bk_users: 'Users',
         bk_nodoc: 'The account has no sync document yet. It can be created from this browser: the users and lists here are kept encrypted in Saved Messages, and every other device that connects joins it.',
         bk_nodoc_kodi: 'If you also use Kodi, it is better to open the app there once: it creates the document together with its own settings.',
         bk_found: 'Create the sync document', bk_found_q: 'Press again to create the sync document from this browser', bk_found_made: 'The document was created. Sync is running.',
         bk_found_exists: 'The account already has a sync document. The browser joined it.', bk_unreadable: 'The account\'s sync document could not be read. The browser will not write over it; open Kodi or try again later.',
         bk_cfg_intro: 'One file with this browser\'s settings and keys, in the format of "Export configuration" in Kodi. A file exported from Kodi imports here (the keys a browser can use); the Telegram login never travels.',
         bk_pass: 'Password (optional)', bk_export: 'Export settings', bk_import: 'Import settings', bk_exported: 'File saved (%s)', bk_imported: 'Imported: %s', bk_imported_none: 'The file has no settings a browser can use',
         bk_pass_need: 'The file is protected by a password: enter it and try again', bk_pass_bad: 'Wrong password (or a damaged file)', bk_cfg_bad: 'This is not a TeleNova settings file', bk_api_set: 'the Telegram API details',
         bk_no_crypto: 'This browser lacks the encryption this needs (https is required)'},
    ru: {bk_intro: 'Резервная копия пользователей, истории, избранного и поисков в том же формате, что в Kodi: её можно восстановить в Kodi, а копию из Kodi — здесь.',
         bk_make: 'Скачать копию', bk_restore: 'Восстановить из файла', bk_made: 'Копия сохранена (%s)', bk_bad: 'Это не файл резервной копии BN Stream',
         bk_h_move: 'Перенести все настройки на другое устройство', bk_move_intro: 'Все настройки, ключи и подключения (Real-Debrid, данные Telegram, серверы) переходят на другое устройство одним сканированием и кодом из 6 цифр. На этом устройстве ничего не меняется.',
         bk_move_show: 'Показать код переноса', bk_move_scan: '1. Отсканируйте камерой другого устройства (или откройте на нём ссылку).', bk_move_noqr: 'Откройте эту ссылку на другом устройстве:', bk_move_pin_is: '2. Введите там код:',
         bk_move_copy: 'Скопировать ссылку', bk_move_copied: 'Ссылка скопирована', bk_move_note: 'Ссылка зашифрована кодом. Не отправляйте ссылку и код вместе посторонним. Telegram: другое устройство входит само одним подтверждением - вход Telegram не копируется, чтобы оба устройства не вышли из аккаунта.',
         bk_move_got: 'Получены настройки с другого устройства. Введите код из 6 цифр, который оно показывает:', bk_move_pin: 'Код из 6 цифр', bk_move_take: 'Принять настройки', bk_move_wait: 'Секунду…',
         bk_move_done: 'Настройки получены: %s', bk_move_tg: 'Остался один шаг: подключить Telegram на этом устройстве (одно подтверждение в приложении Telegram).', bk_move_paste: 'У меня есть ссылка - вставить', bk_gd_intro: 'Вход в Google Drive, копия туда, восстановление оттуда и ваши видео - на одном экране.', bk_gd_open: 'Google Drive - все варианты', bk_move_full: 'Переносится всё: настройки, подключения, пользователи, история, избранное и поиски. Код действует 15 минут и один раз.', bk_move_part: 'Ящик передачи сейчас недоступен: переносятся только настройки и подключения (история и избранное синхронизируются через Telegram).', bk_move_gone: 'Код уже использован или истёк (15 минут). Покажите новый код на первом устройстве.', bk_move_app: 'Открыть в приложении BN Stream', bk_move_app_txt: 'Пользуетесь приложением? Передайте настройки в него: нажмите «Открыть в приложении» или скопируйте ссылку и нажмите в приложении «У меня есть ссылка - вставить».', bk_move_nolink: 'В буфере обмена нет ссылки переноса.',
         bk_h_full: 'Полная резервная копия с паролем', bk_full_intro: 'Один файл со всем: все настройки, ключи API, аккаунты и пароли (субтитры, IPTV, Google Drive), вход Real-Debrid, данные Telegram, серверы и пользователи с историей, избранным и поисками. Файл шифруется вашим паролем и восстанавливается на любом устройстве с BN Stream - сайт, приложение или Kodi.',
         bk_full_pass: 'Пароль копии (не менее 6 символов)', bk_full_pass2: 'Пароль ещё раз', bk_full_make: 'Создать полную копию', bk_full_restore: 'Восстановить из копии', bk_full_short: 'Пароль должен быть не короче %s символов.', bk_full_differ: 'Пароли не совпадают.',
         bk_full_need_pass: 'Сначала введите пароль копии, затем выберите файл.', bk_full_made: 'Копия сохранена: %s. Храните файл и пароль - без пароля его не открыть.', bk_full_done: 'Восстановлено: %s', bk_tg_auto: 'Telegram: это устройство подключается само. Ваше другое устройство, где BN Stream открыт и подключён к Telegram, подтверждает вход автоматически.', bk_full_one: 'Резервная копия одна: новая заменяет предыдущую.', bk_full_wrong: 'Неверный пароль. Ничего не восстановлено - введите пароль, выбранный при создании копии, и попробуйте снова.', bk_full_notfile: 'Это не файл копии BN Stream, или файл повреждён.',
         bk_full_device: 'Тип устройства определён автоматически: %s. Отображение подстроено под это устройство, а не под то, где сделана копия.', bk_dev_phone: 'телефон', bk_dev_tablet: 'планшет', bk_dev_desktop: 'компьютер', bk_dev_tv: 'телевизор',
         bk_done: 'Восстановлено: обновлено пользователей — %s. Данные браузера сохранены, копия объединена с ними.', bk_cfg: 'Восстановить и настройки браузера из копии',
         bk_note: 'Копия не содержит вход в Telegram и вход в Real-Debrid: каждое устройство входит само. В ней есть ключи, введённые в этом браузере (TMDb, Gemini, YouTube, OpenSubtitles); храните её в надёжном месте.',
         bk_drive: 'Копия в Google Drive', bk_big: 'Файл слишком большой', bk_wait: 'Минутку...', bk_fail: 'Не получилось: %s',
         bk_h_sync: 'Автоматическая синхронизация', bk_h_file: 'Копия в файл', bk_h_cfg: 'Экспорт и импорт настроек',
         bk_sync_intro: 'Пока браузер подключён к Telegram, пользователи и списки сами синхронизируются со всеми устройствами того же аккаунта (Kodi или браузер).',
         bk_sync_off: 'Этот браузер не подключён к Telegram.', bk_sync_connect: 'Подключить Telegram', bk_sync_on: 'Подключено', bk_sync_last: 'Последняя синхронизация: %s', bk_sync_now: 'Синхронизировать',
         bk_sync_ran: 'Синхронизация выполнена', bk_sync_wait: 'Telegram подключается...', bk_users: 'Пользователи',
         bk_nodoc: 'В аккаунте ещё нет документа синхронизации. Его можно создать из этого браузера: пользователи и списки отсюда будут храниться зашифрованными в «Избранном», и каждое другое устройство присоединится к нему.',
         bk_nodoc_kodi: 'Если вы пользуетесь и Kodi, лучше один раз открыть приложение там: оно создаёт документ вместе со своими настройками.',
         bk_found: 'Создать документ синхронизации', bk_found_q: 'Нажмите ещё раз, чтобы создать документ синхронизации из этого браузера', bk_found_made: 'Документ создан. Синхронизация работает.',
         bk_found_exists: 'В аккаунте уже есть документ синхронизации. Браузер присоединился к нему.', bk_unreadable: 'Документ синхронизации в аккаунте не прочитан. Браузер не будет писать поверх него; откройте Kodi или попробуйте позже.',
         bk_cfg_intro: 'Один файл с настройками и ключами браузера в формате «Экспорт конфигурации» из Kodi. Файл, экспортированный из Kodi, импортируется здесь (ключи, которые может использовать браузер); вход в Telegram никогда не переносится.',
         bk_pass: 'Пароль (необязательно)', bk_export: 'Экспорт настроек', bk_import: 'Импорт настроек', bk_exported: 'Файл сохранён (%s)', bk_imported: 'Импортировано: %s', bk_imported_none: 'В файле нет настроек, которые может использовать браузер',
         bk_pass_need: 'Файл защищён паролем: введите его и повторите', bk_pass_bad: 'Неверный пароль (или файл повреждён)', bk_cfg_bad: 'Это не файл настроек TeleNova', bk_api_set: 'данные API Telegram',
         bk_no_crypto: 'В этом браузере нет нужного шифрования (требуется https)'},
  });
  const t = TN.t;
  const FFLATE = ['https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js', 'sha384-DT0Ls0mO7JmjTnT+oBuMhEJzYJO1zUqzuuMXNdnOmOQRIpN2BgSjvBV/j50NngIT'];
  async function fflate() { if (!root.fflate) await TN.loadScript(FFLATE[0], FFLATE[1]); return root.fflate; }
  async function sealed() { await fflate(); if (!root.Sealed) await TN.loadScript('sealed.js'); return root.Sealed; }
  const cfgNow = () => { const c = TN.get('cfg', {}) || {}; return typeof c === 'object' ? c : {}; };
  const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()); };
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function makeZip() {
    const F = await fflate();
    const files = makeFiles(TN.store, TN.SyncDoc, cfgNow());
    const z = {};
    for (const [p, s] of Object.entries(files)) z[p] = F.strToU8(s);
    return new Blob([F.zipSync(z, {level: 6})], {type: 'application/zip'});
  }
  const zipName = () => 'bn_backup_web_' + stamp() + '.zip';
  async function readZip(bytes) {
    const F = await fflate();
    let total = 0;
    const raw = F.unzipSync(bytes, {filter: (f) => {
      const ok = (f.name === MARK || f.name === WEB || (f.name.startsWith(NOVA) && f.name.endsWith('.json'))) && f.originalSize <= MAX;
      if (ok) total += f.originalSize;
      return ok && total <= 4 * MAX;
    }});
    const files = {};
    for (const [p, u8] of Object.entries(raw)) files[p] = F.strFromU8(u8);
    return readFiles(files, TN.SyncDoc);
  }
  // used by gdrive.js too: bytes of a zip -> message
  async function restoreBytes(bytes, withCfg) {
    const b = await readZip(bytes);
    if (!b.ok) throw new Error(t('bk_bad'));
    const n = restoreInto(TN.store, TN.SyncDoc, b);
    if (withCfg && b.web && b.web.cfg && typeof b.web.cfg === 'object') {
      for (const [k, v] of Object.entries(b.web.cfg)) if (!CFG_SKIP.includes(k) && !DEVICE_ONLY.includes(k) && /^[a-z][a-z0-9_]*$/.test(k)) TN.settings.set(k, v);
    }
    return t('bk_done', n);
  }

  // ---- the settings file
  async function sourcesSvc() { return TN.provider('sources').catch(() => null); }
  async function exportCfg(password, opt) {
    const SL = await sealed();
    const src = await sourcesSvc();
    const cfg = Object.assign({}, cfgNow());
    CFG_SKIP.forEach((k) => delete cfg[k]);
    const addons = src && src.addons ? src.addons() : [];
    const kodi = webToKodi(cfg, addons), web = {cfg, v: TN.version};
    // 5.2.1 (transfer to another device, always sealed with a code): the connections as well - the Real-Debrid
    // sign-in and the Telegram application details. NEVER a Telegram session: two devices on one session lose both
    // logins (AUTH_KEY_DUPLICATED); the other device signs in to Telegram itself, which is one confirmation.
    if (opt && opt.full && password) {
      const tok = TN.get('rd_token', ''), auth = TN.get('rd_auth', null), api = TN.get('tg_api', null);
      if (/^[A-Za-z0-9]{20,80}$/.test(String(tok || ''))) kodi.rd_token = String(tok);
      if (auth && auth.cid && auth.sec && auth.refresh) web.rd_auth = {cid: auth.cid, sec: auth.sec, refresh: auth.refresh, exp: 1};
      if (api && /^\d{3,12}$/.test(String(api.id)) && /^[0-9a-f]{32}$/.test(String(api.hash))) { kodi.api_id = String(api.id); kodi.api_hash = String(api.hash); }
      web.tg_was_on = !!(tgStatus() && tgStatus().state === 'on') || tgSaved();
      if (opt.zip) web.zip = opt.zip;              // the users and their lists (the Backup zip), base64
      // 5.4: the household secret that lets a device which is signed in to Telegram approve the restored one by itself
      const lk = String(TN.get('tg_link', '') || '');
      if (/^[\w-]{40,64}$/.test(lk)) web.tg_link = lk;
    }
    const bytes = await SL.pack(kodi, {}, password || '', {web, app: 'telenova-web'});
    return new Blob([bytes], {type: 'application/octet-stream'});
  }
  async function importCfg(bytes, password) {
    const SL = await sealed();
    const packed = await SL.unpack(bytes, password || '');
    const got = kodiToWeb(packed);
    const xweb = (packed && packed.extra && packed.extra.web) || {};
    for (const [k, v] of Object.entries(got.cfg)) if (!DEVICE_KEYS.includes(k)) TN.settings.set(k, v);
    const names = got.names.slice();
    if (got.rd) {
      const R = await TN.provider('rd').catch(() => null);
      if (!(R && R.setToken && R.setToken(got.rd))) names.splice(names.indexOf('Real-Debrid'), 1);
      else if (xweb.rd_auth && xweb.rd_auth.cid && xweb.rd_auth.sec && xweb.rd_auth.refresh) TN.put('rd_auth', {cid: String(xweb.rd_auth.cid), sec: String(xweb.rd_auth.sec), refresh: String(xweb.rd_auth.refresh), exp: 1});
    }
    importCfg.tgWasOn = !!xweb.tg_was_on;
    if (/^[\w-]{40,64}$/.test(String(xweb.tg_link || ''))) TN.put('tg_link', String(xweb.tg_link));
    importCfg.autoTg = !!xweb.tg_was_on && /^[\w-]{40,64}$/.test(String(xweb.tg_link || ''));
    importCfg.zip = typeof xweb.zip === 'string' && xweb.zip.length < 4 * 1024 * 1024 ? xweb.zip : '';
    if (got.addons.length) {
      const src = await sourcesSvc();
      if (src && src.setAddons && src.addons) src.setAddons(src.addons().concat(got.addons)); else names.splice(names.indexOf('Stremio'), 1);
    }
    // the account's API details (the same two values the pairing link carries), only when this browser has none
    if (got.api) {
      try { const TG = await TN.tg(); if (TG && TG.hasApi && !TG.hasApi() && TG.setApi && TG.setApi(got.api.id, got.api.hash)) names.push(t('bk_api_set')); } catch (e) {}
    }
    return names;
  }
  // ---- 5.2.1: the whole setup to another device - a QR code / link and a six-digit code
  const b64u = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64u = (text) => { const b = atob(String(text).replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  // 5.3: the hand-over carries EVERYTHING - settings, keys and connections, and the users with their history,
  // favourites and searches (the same zip as "Backup"). That is too much for a QR code, so the sealed blob waits in
  // the helper's drop box (15 minutes, read once) and the code / link carries only its id: '@<32 hex>'. When the drop
  // box cannot be reached the old way still works: settings and connections inside the link itself.
  const DROP_BASES = () => {
    const out = [];
    try { const h = TN.settings.helper && TN.settings.helper(); if (h && !/\.invalid(\/|$)/.test(h)) out.push(h.replace(/\/+$/, '')); } catch (e) { /* none */ }
    if (!out.includes('https://telenova-helper.hmi-analyzer.workers.dev')) out.push('https://telenova-helper.hmi-analyzer.workers.dev');
    return out;
  };
  const u8b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const b64u8 = (b) => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  async function transferOut() {
    const r = new Uint32Array(1);
    crypto.getRandomValues(r);
    const pin = String(r[0] % 1000000).padStart(6, '0');
    const base = location.origin + location.pathname + '#setup=';
    try {
      const zip = new Uint8Array(await (await makeZip()).arrayBuffer());
      if (zip.length <= 2 * 1024 * 1024) {
        const big = new Uint8Array(await (await exportCfg(pin, {full: true, zip: u8b64(zip)})).arrayBuffer());
        for (const b of DROP_BASES()) {
          try {
            const res = await fetch(b + '/drop', {method: 'POST', body: big, cache: 'no-store'});
            const id = res.ok ? String(((await res.json()) || {}).id || '') : '';
            if (/^[0-9a-f]{32}$/.test(id)) return {pin, link: base + '@' + id, size: big.length, full: true};
          } catch (e) { /* the next address, or the link-only way below */ }
        }
      }
    } catch (e) { /* the link-only way below */ }
    const bytes = new Uint8Array(await (await exportCfg(pin, {full: true})).arrayBuffer());
    return {pin, link: base + b64u(bytes), size: bytes.length, full: false};
  }
  let dropBytes = null, dropId = '';             // a drop is read once: kept here so a mistyped code can be typed again
  async function transferIn(text, pin) {
    let bytes;
    const m = /^@([0-9a-f]{32})$/.exec(String(text));
    if (m) {
      if (dropId !== m[1] || !dropBytes) {
        dropBytes = null; dropId = m[1];
        for (const b of DROP_BASES()) {
          try { const res = await fetch(b + '/drop/' + m[1], {cache: 'no-store'}); if (res.ok) { dropBytes = new Uint8Array(await res.arrayBuffer()); break; } } catch (e) { /* the next address */ }
        }
        if (!dropBytes) throw Object.assign(new Error('gone'), {code: 'drop_gone'});
      }
      bytes = dropBytes;
    } else bytes = unb64u(text);
    const names = await importCfg(bytes, String(pin || '').replace(/\D+/g, ''));
    let lists = '';
    if (importCfg.zip) { try { lists = await restoreBytes(b64u8(importCfg.zip), false); } catch (e) { lists = ''; } }
    dropBytes = null; dropId = '';
    return {names, telegram: !!importCfg.tgWasOn, lists, autoTg: !!importCfg.autoTg};
  }
  const pendingSetup = () => { try { return sessionStorage.getItem('bn_setup') || ''; } catch (e) { return ''; } };
  const dropSetup = () => { try { sessionStorage.removeItem('bn_setup'); } catch (e) { /* no storage */ } };
  function transferPanel(view) {
    const box = panel(view, t('bk_h_move'), t('bk_move_intro'));
    const inbox = el('div'), out = el('div'), acts = el('div', 'links');
    box.append(inbox, acts, out, box.msg);
    const receive = (text) => {
      inbox.textContent = '';
      const f = el('form', 'links'), inp = el('input', 'bk_in');
      inp.type = 'text'; inp.inputMode = 'numeric'; inp.autocomplete = 'one-time-code'; inp.maxLength = 6; inp.dir = 'ltr'; inp.placeholder = '000000';
      inp.setAttribute('aria-label', t('bk_move_pin'));
      f.append(inp, TN.button('btn', t('bk_move_take'), null));
      f.onsubmit = async (e) => {
        e.preventDefault();
        box.say(t('bk_move_wait'));
        try {
          const got = await transferIn(text, inp.value);
          dropSetup();
          inbox.textContent = '';
          box.say(t('bk_move_done', got.names.join(', ') || '-') + (got.lists ? ' · ' + got.lists : ''));
          TN.emit('settings', 'transfer');
          result({ok: true, op: 'move_take', items: got.names});
          if (got.telegram && !(tgStatus() && tgStatus().state === 'on')) {
            if (got.autoTg) { try { sessionStorage.setItem('bn_tg_auto', '1'); } catch (e) { /* asked by hand below */ } }
            inbox.append(el('p', '', t(got.autoTg ? 'bk_tg_auto' : 'bk_move_tg')), Object.assign(el('a', 'btn', t('bk_sync_connect')), {href: '#/tglogin'}));
            if (got.autoTg) setTimeout(() => TN.go('#/tglogin'), 2500);
          }
        } catch (err) { box.say(err && err.code === 'drop_gone' ? t('bk_move_gone') : cfgError(err)); result({ok: false, op: 'move_take', error: err}); }
      };
      inbox.append(el('p', '', t('bk_move_got')), f);
      // a phone's camera opens the link in the browser, not in the BN Stream app: one press hands it to the app
      // (the apps answer bnstream://setup/<setup>); the copy button is for pasting it there by hand
      const inApp = !!(root.TeleNovaNative || root.TeleNovaAndroid || /BNStream|TeleNovaApp/i.test(navigator.userAgent));
      if (!inApp && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        const row = el('div', 'links');
        const full = location.origin + location.pathname + '#setup=' + text;
        const cp = TN.button('btn ghost', t('bk_move_copy'), async () => { try { await navigator.clipboard.writeText(full); cp.textContent = t('bk_move_copied'); } catch (e) { box.say(full); } });
        row.append(Object.assign(el('a', 'btn ghost', t('bk_move_app')), {href: 'bnstream://setup/' + text}), cp);
        inbox.append(el('p', 'hint', t('bk_move_app_txt')), row);
      }
      setTimeout(() => { try { inp.focus(); } catch (e) { /* not focusable */ } }, 50);
    };
    if (pendingSetup()) receive(pendingSetup());
    acts.append(TN.button('btn', t('bk_move_show'), async () => {
      out.textContent = ''; box.say(t('bk_move_wait'));
      try {
        const tr = await transferOut();
        const c = el('canvas'), q = el('div', 'qrbox'), pin = el('div', 'rd_code', tr.pin);
        pin.dir = 'ltr'; pin.style.cssText = 'font-size:34px;font-weight:700;letter-spacing:6px;margin:8px 0';
        c.setAttribute('role', 'img'); c.setAttribute('aria-label', t('bk_h_move'));
        q.append(c);
        let drawn = false;
        try {                                    // the same pinned library the Telegram sign-in draws its code with
          if (!root.qrcode) await TN.loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js', 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k');
          const qr = root.qrcode(0, 'L');
          qr.addData(tr.link); qr.make();
          const n = qr.getModuleCount(), cell = 4, pad = 4 * cell, g = c.getContext('2d');
          c.width = c.height = n * cell + 2 * pad;
          g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
          for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) g.fillRect(pad + x * cell, pad + y * cell, cell, cell);
          c.style.width = 'min(100%, 300px)'; c.style.height = 'auto'; c.style.background = '#fff'; q.style.maxWidth = '100%'; q.style.overflow = 'hidden';
          drawn = true;
        } catch (e) { /* too long for a code, or offline: the link below still works */ }
        const copy = TN.button('btn ghost', t('bk_move_copy'), async () => { try { await navigator.clipboard.writeText(tr.link); copy.textContent = t('bk_move_copied'); } catch (e) { box.say(tr.link); } });
        out.append(el('p', '', t(drawn ? 'bk_move_scan' : 'bk_move_noqr')));
        if (drawn) out.append(q);
        out.append(el('p', 'hint', t('bk_move_pin_is')), pin, copy, el('p', 'hint', t(tr.full ? 'bk_move_full' : 'bk_move_part')), el('p', 'hint', t('bk_move_note')));
        box.say('');
        result({ok: true, op: 'move_send', extra: [[t('bk_move_pin'), tr.pin || '']]});
      } catch (e) { box.say(cfgError(e)); result({ok: false, op: 'move_send', error: e}); }
    }));
    acts.append(TN.button('btn ghost', t('bk_move_paste'), async () => {
      let text = '';
      try { text = await navigator.clipboard.readText(); } catch (e) { text = ''; }
      const m = /#setup=(@[0-9a-f]{32}|[\w-]{40,})/.exec(text || '');
      if (m) receive(m[1]); else box.say(t('bk_move_nolink'));
    }));
  }
  // ---- 5.3.2: the full backup file. Everything a person set up, in one password-protected file (.tncfg, the build's
  // sealed format, so the Kodi build opens it too): every setting and key (TMDb, Gemini, OpenSubtitles, YouTube, the
  // Google Drive client, subtitle-site and IPTV accounts with their passwords), the Real-Debrid sign-in, the Telegram
  // application details, the Stremio servers, and the users with their history, favourites and searches.
  // The device type and the display size are never restored: the device that restores is recognised by itself.
  const DEVICE_KEYS = ['device', 'zoom'];
  const PASS_MIN = 6;
  const FULL_NAME = 'BN_Stream_backup.tncfg';
  async function fullBackup(password) {
    if (String(password || '').length < PASS_MIN) throw Object.assign(new Error('short'), {code: 'pass_short'});
    const zip = new Uint8Array(await (await makeZip()).arrayBuffer());
    return exportCfg(password, {full: true, zip: u8b64(zip)});
  }
  async function fullRestore(bytes, password) {
    const names = await importCfg(bytes, password);
    let lists = '';
    if (importCfg.zip) { try { lists = await restoreBytes(b64u8(importCfg.zip), false); } catch (e) { lists = ''; } }
    // this device, not the one the backup was made on: back to automatic recognition, then say what was found
    TN.settings.set('device', 'auto');
    const shell = document.documentElement.getAttribute('data-shell') || 'desktop';
    return {names, lists, telegram: !!importCfg.tgWasOn, shell, autoTg: !!importCfg.autoTg};
  }
  function fullPanel(view) {
    const box = panel(view, t('bk_h_full'), t('bk_full_intro'));
    const pw = el('input', 'bk_in'), pw2 = el('input', 'bk_in');
    for (const [i, key] of [[pw, 'bk_full_pass'], [pw2, 'bk_full_pass2']]) { i.type = 'password'; i.autocomplete = 'new-password'; i.placeholder = t(key); i.setAttribute('aria-label', t(key)); }
    const file = el('input'); file.type = 'file'; file.accept = '.tncfg,application/octet-stream'; file.hidden = true;
    const f = el('form', 'links'), acts = el('div', 'links'), after = el('div');
    f.append(pw, pw2);
    f.onsubmit = (e) => e.preventDefault();
    acts.append(TN.button('btn', t('bk_full_make'), async () => {
      after.textContent = '';
      if (pw.value.length < PASS_MIN) { box.say(t('bk_full_short', PASS_MIN)); pw.focus(); return; }
      if (pw.value !== pw2.value) { box.say(t('bk_full_differ')); pw2.focus(); return; }
      box.say(t('bk_wait'));
      // 5.3.3: ONE backup file, always under the same name - a new backup replaces the one before it. Where the browser
      // lets a page write a file the viewer picked (desktop Chrome / Edge), that very file is overwritten; elsewhere the
      // download carries the fixed name and the device's own "replace?" question does the rest.
      try {
        const blob = await fullBackup(pw.value);
        let how = 'down';
        if (typeof root.showSaveFilePicker === 'function') {
          try {
            const h = await root.showSaveFilePicker({suggestedName: FULL_NAME, types: [{description: 'BN Stream backup', accept: {'application/octet-stream': ['.tncfg']}}]});
            const w = await h.createWritable();
            await w.write(blob); await w.close();
            how = 'saved';
          } catch (e) { if (e && e.name === 'AbortError') { box.say(''); return; } how = 'down'; }
        }
        if (how === 'down') download(blob, FULL_NAME);
        box.say(t('bk_full_made', FULL_NAME) + ' ' + t('bk_full_one'));
        pw.value = pw2.value = '';
        result({ok: true, op: 'full_make', file: FULL_NAME, where: how === 'saved' ? '' : 'down'});
      } catch (e) { box.say(cfgError(e)); result({ok: false, op: 'full_make', error: e}); }
    }), TN.button('btn ghost', t('bk_full_restore'), () => {
      if (!pw.value) { box.say(t('bk_full_need_pass')); pw.focus(); return; }
      file.click();
    }), file);
    file.onchange = async () => {
      const fl = file.files && file.files[0];
      file.value = '';
      if (!fl) return;
      box.say(t('bk_wait')); after.textContent = '';
      try {
        const got = await fullRestore(new Uint8Array(await fl.arrayBuffer()), pw.value);
        pw.value = pw2.value = '';
        box.say(t('bk_full_done', got.names.join(', ') || '-') + (got.lists ? ' · ' + got.lists : ''));
        after.append(el('p', '', t('bk_full_device', t('bk_dev_' + got.shell))));
        if (got.telegram && !(tgStatus() && tgStatus().state === 'on')) {
          // 5.4: Telegram too, by itself - the sign-in page opens and a device of the household approves it
          if (got.autoTg) { try { sessionStorage.setItem('bn_tg_auto', '1'); } catch (e) { /* asked by hand below */ } }
          after.append(el('p', '', t(got.autoTg ? 'bk_tg_auto' : 'bk_move_tg')), Object.assign(el('a', 'btn', t('bk_sync_connect')), {href: '#/tglogin'}));
          if (got.autoTg) setTimeout(() => TN.go('#/tglogin'), 2500);
        }
        TN.emit('settings', 'restore');
        result({ok: true, op: 'full_restore', file: fl.name, items: got.names});
      } catch (e) {
        result({ok: false, op: 'full_restore', file: fl.name, error: e});
        // a wrong password is said as such, in its own words, and the field is ready for another try
        const c = e && e.code;
        if (c === 'wrong_password' || c === 'password_required') { box.say(t('bk_full_wrong')); box.msg.setAttribute('role', 'alert'); pw.value = ''; pw.focus(); }
        else box.say(c === 'not_a_config_file' || c === 'unsupported_version' || c === 'damaged' ? t('bk_full_notfile') : cfgError(e));
      }
    };
    box.append(f, acts, after, box.msg);
  }
  const cfgError = (e) => {
    const c = e && e.code;
    if (c === 'pass_short') return t('bk_full_short', PASS_MIN);
    return c === 'password_required' ? t('bk_pass_need') : c === 'wrong_password' ? t('bk_pass_bad') : c === 'no_webcrypto' ? t('bk_no_crypto')
      : c === 'not_a_config_file' || c === 'unsupported_version' || c === 'damaged' ? t('bk_cfg_bad') : t('bk_fail', (e && e.message) || e);
  };
  // 5.4.3: the result window after every backup / restore / transfer (result.js: one line, details, how to fix)
  const result = (o) => (root.TNResult ? Promise.resolve() : TN.loadScript('result.js')).then(() => { if (root.TNResult) root.TNResult(o); }, () => {});

  // ---- the account's document
  const tgSaved = () => !!(TN.get('tg_session', '') && TN.get('tg_api', null));
  function tgStatus() { let st = null; if (root.TG && root.TG.ready) { try { st = root.TG.status(); } catch (e) {} } return st; }
  async function foundDoc() {
    const TG = await TN.tg();
    if (!TG || !TG.connected || !TG.connected()) throw Object.assign(new Error(t('bk_sync_off')), {code: 'need_tg'});
    let res;
    if (typeof TG.foundDoc === 'function') res = await TG.foundDoc();          // tg.js's own, when it has one
    else {
      const SL = await sealed(), G = root.GramJS, me = TG.me && TG.me();
      const client = await TG.client();
      if (!G || !G.Buffer || !G.CustomFile || !me || !me.id) throw new Error('Telegram');
      const WS = TN.WebSync;
      res = await found({
        WS, SD: TN.SyncDoc, users: () => TN.store.users(), userData: (uid) => TN.store.data(uid),
        async list() {
          const out = [];
          for (const m of await client.getMessages('me', {search: WS.TAG, limit: 30})) {
            const doc = m && m.media && m.media.document, note = WS.noteOf(m && m.message);
            if (doc && note) out.push({id: m.id, date: Number(m.date) || 0, note});
          }
          return out;
        },
        seal: (text) => SL.packDoc(text, SL.cloudKey(me.id), WS.NOTE),
        async send(bytes, name, caption) {
          const buf = G.Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
          const msg = await client.sendFile('me', {file: new G.CustomFile(name, buf.length, '', buf), caption, forceDocument: true, silent: true, parseMode: false, workers: 1});
          return (msg && msg.id) || 0;
        },
      });
    }
    try { await TG.syncNow(); } catch (e) {}
    return res === 'exists' ? 'exists' : 'made';
  }
  root.TNBackup = Object.assign({}, core, {makeZip, zipName, restoreBytes, exportCfg, importCfg, foundDoc, fullBackup, fullRestore});

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function panel(view, title, intro) {
    view.append(el('h2', 'bk_h2', title));
    const box = el('div', 'panel settings'); view.append(box);
    if (intro) box.append(el('p', '', intro));
    const msg = el('p', 'hint'); msg.setAttribute('role', 'status');
    box.say = (s) => { msg.textContent = s || ''; };
    box.msg = msg;
    return box;
  }
  function pageBackup(arg, ctx) {
    TN.page('backup', t('m_backup'));
    const view = TN.view();
    if (!document.getElementById('bk_css')) {
      const s = el('style'); s.id = 'bk_css';
      s.textContent = '.bk_h2{margin:22px 0 8px;font-size:18px}.bk_in{flex:1 1 220px;min-width:0;min-height:44px;background:var(--panel);color:var(--text);border:1px solid var(--muted);' +
        'border-radius:10px;padding:9px 14px;font:inherit}.bk_in:focus-visible{outline:3px solid var(--ring)}.bk_chk{display:flex;gap:8px;align-items:center;font-weight:400;margin:10px 0}' +
        '.bk_chk input{width:22px;height:22px}';
      document.head.append(s);
    }

    // ---------------- the full backup file (5.3.2), then the hand-over to another device (5.2.1)
    fullPanel(view);
    // 5.6: Google Drive lives here (it had its own menu entry): sign in, back up to Drive, restore from it, my videos
    const gd = panel(view, 'Google Drive', t('bk_gd_intro'));
    gd.append(Object.assign(el('a', 'btn', t('bk_gd_open')), {href: '#/gdrive'}));
    transferPanel(view);

    // ---------------- 1. sync (K01)
    const sy = panel(view, t('bk_h_sync'), t('bk_sync_intro'));
    const syState = el('p', ''), syActs = el('div', 'links'), syNote = el('div');
    sy.append(syState, syNote, syActs, sy.msg);
    let armed = false, lastSig = '';
    function paintSync(force) {
      const st = tgStatus(), on = !!(st && st.state === 'on');
      const sig = [on, st && st.sync, st && st.last, tgSaved()].join('|');
      if (!force && sig === lastSig) return;
      lastSig = sig;
      syActs.textContent = ''; syNote.textContent = '';
      if (!on) {
        syState.textContent = tgSaved() ? t('bk_sync_wait') : t('bk_sync_off');
        syActs.append(Object.assign(el('a', 'btn' + (tgSaved() ? ' ghost' : ''), t('bk_sync_connect')), {href: '#/tglogin'}));
      } else {
        const when = st.last ? new Date(st.last * (st.last < 1e12 ? 1000 : 1)).toLocaleTimeString() : '';
        syState.textContent = [t('bk_sync_on'), st.name, when ? t('bk_sync_last', when) : ''].filter(Boolean).join(' · ');
        syActs.append(TN.button('btn', t('bk_sync_now'), async () => {
          sy.say(t('bk_wait'));
          try { const TG = await TN.tg(); await TG.syncNow(); sy.say(t('bk_sync_ran')); } catch (e) { sy.say(t('bk_fail', (e && e.message) || e)); }
          paintSync(true);
        }));
        if (st.sync === 'nodoc') {
          syNote.append(el('p', 'msg', t('bk_nodoc')), el('p', 'hint', t('bk_nodoc_kodi')));
          const b = TN.button('btn', t('bk_found'), async () => {
            if (!armed) { armed = true; sy.say(t('bk_found_q')); return; }
            armed = false; b.disabled = true; sy.say(t('bk_wait'));
            try { const r = await foundDoc(); sy.say(t(r === 'exists' ? 'bk_found_exists' : 'bk_found_made')); } catch (e) { sy.say(t('bk_fail', (e && e.message) || e)); }
            b.disabled = false;
            paintSync(true);
          });
          syActs.append(b);
        } else if (st.sync === 'unreadable') syNote.append(el('p', 'msg', t('bk_unreadable')));
      }
      syActs.append(Object.assign(el('a', 'btn ghost', t('bk_users')), {href: '#/users'}));
    }
    paintSync(true);
    // Telegram resumes a moment after the page opens, and a round takes a few seconds: follow it while the page is shown
    const iv = setInterval(() => { if (!ctx || !ctx.current()) return clearInterval(iv); if (!armed) paintSync(false); }, 2000);
    if (tgSaved() && !(tgStatus() && tgStatus().state === 'on')) TN.tg().then((TG) => { if (TG.resume && TG.state && TG.state() === 'off') TG.resume(); }, () => {});

    // ---------------- 2. backup to a file (K02 / K03)
    const box = panel(view, t('bk_h_file'), t('bk_intro'));
    const acts = el('div', 'links');
    const file = el('input'); file.type = 'file'; file.accept = '.zip,application/zip'; file.hidden = true;
    const cfgBox = el('label', 'bk_chk'); const cb = el('input'); cb.type = 'checkbox';
    cfgBox.append(cb, document.createTextNode(t('bk_cfg')));
    acts.append(TN.button('btn', t('bk_make'), async () => {
      box.say(t('bk_wait'));
      try { const name = zipName(); download(await makeZip(), name); box.say(t('bk_made', name)); result({ok: true, op: 'zip_make', file: name, where: 'down'}); }
      catch (e) { box.say(t('bk_fail', (e && e.message) || e)); result({ok: false, op: 'zip_make', error: e}); }
    }), TN.button('btn ghost', t('bk_restore'), () => file.click()));
    acts.append(Object.assign(el('a', 'btn ghost', t('bk_drive')), {href: '#/gdrive'}));
    file.onchange = async () => {
      const f = file.files && file.files[0]; file.value = '';
      if (!f) return;
      if (f.size > 200 * 1024 * 1024) return box.say(t('bk_big'));
      box.say(t('bk_wait'));
      try { const said = await restoreBytes(new Uint8Array(await f.arrayBuffer()), cb.checked); box.say(said); result({ok: true, op: 'zip_restore', file: f.name, short: said}); }
      catch (e) { box.say(t('bk_fail', (e && e.message) || e)); result({ok: false, op: 'zip_restore', file: f.name, error: e}); }
    };
    box.append(acts, cfgBox, file, box.msg, el('p', 'hint', t('bk_note')));

    // ---------------- 3. the settings file (K12 / T06)
    const cf = panel(view, t('bk_h_cfg'), t('bk_cfg_intro'));
    const pw = el('input', 'bk_in'); pw.type = 'password'; pw.autocomplete = 'new-password'; pw.placeholder = t('bk_pass'); pw.setAttribute('aria-label', t('bk_pass'));
    const cfFile = el('input'); cfFile.type = 'file'; cfFile.accept = '.tncfg,application/octet-stream'; cfFile.hidden = true;
    const cfActs = el('form', 'links');              // (a form, so a password manager treats the field properly; nothing is submitted anywhere)
    const doExport = async () => {
      cf.say(t('bk_wait'));
      try { const name = 'telenova_web_' + stamp() + '.tncfg'; download(await exportCfg(pw.value), name); cf.say(t('bk_exported', name)); result({ok: true, op: 'cfg_export', file: name, where: 'down'}); }
      catch (e) { cf.say(cfgError(e)); result({ok: false, op: 'cfg_export', error: e}); }
    };
    cfActs.onsubmit = (e) => { e.preventDefault(); doExport(); };
    const exBtn = el('button', 'btn', t('bk_export')); exBtn.type = 'submit';
    const imBtn = TN.button('btn ghost', t('bk_import'), () => cfFile.click()); imBtn.type = 'button';
    cfActs.append(pw, exBtn, imBtn);
    cfFile.onchange = async () => {
      const f = cfFile.files && cfFile.files[0]; cfFile.value = '';
      if (!f) return;
      if (f.size > 64 * 1024 * 1024) return cf.say(t('bk_big'));
      cf.say(t('bk_wait'));
      try {
        const names = await importCfg(new Uint8Array(await f.arrayBuffer()), pw.value);
        cf.say(names.length ? t('bk_imported', names.join(', ')) : t('bk_imported_none'));
        result({ok: true, op: 'cfg_import', file: f.name, items: names});
      } catch (e) { cf.say(cfgError(e)); result({ok: false, op: 'cfg_import', file: f.name, error: e}); if (e && (e.code === 'password_required' || e.code === 'wrong_password')) pw.focus(); }
    };
    cf.append(cfActs, cfFile, cf.msg);
  }
  TN.registerPage('backup', pageBackup);
})(typeof self !== 'undefined' ? self : globalThis);
