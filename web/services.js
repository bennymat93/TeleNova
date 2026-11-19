'use strict';
// WP-9: Accounts and services (Kodi X01-X16, services.py) - ONE screen for every login and key, each with its state,
// its real fields, a test and the page that issues the key - and the device profile.
// Pages: #/services, #/device.
// Where each value lives (all in this browser; nothing is logged, nothing is ever put in an address):
//   tmdb               TN.settings 'tmdb'             (the catalogue reads it, app.js)
//   Gemini             TN.settings 'gemini_key'       (catalog.js reads it; tgsearch.js / subs.js: see the requests)
//   YouTube            TN.settings 'yt_key'           (yt.js)
//   helper Worker      TN.settings 'helper'
//   OpenSubtitles      TN.settings 'subs_os_key'      (subs.js)
//   AI subtitle server TN.settings 'subs_server_url'  (subs.js, https only)
//   Telegram           'telegram_quiet' (default on), 'tgsearch_bots' (default off)
//   StremThru          'stremthru_on' (default on), 'stremthru_url'
//   Real-Debrid        rd.js owns its token: this page shows rd.js's own panel (servicesPanel)
//   Stremio servers    sources.js owns the list (addons / setAddons)
// Service 'services' (TN.provider('services')): {stremthru(), stremthruCheck(hashes, {token, sid, signal}), testers, classify}
(function (root) {
  // ------------------------------------------------------------ pure (node: src/qa/web/t_services.js)
  const ST_DEFAULT = 'https://stremthru.13377001.xyz';
  // what a pasted text is: {kind: 'magnet' | 'telegram' | 'youtube' | 'dailymotion' | 'archive' | 'media' | 'web' | '', url, id?}
  function classify(text) {
    const s = String(text || '').trim();
    if (/^magnet:\?/i.test(s)) return {kind: 'magnet', url: s.split(/\s/)[0]};
    if (/^tg:\/\/resolve\?\S+/i.test(s)) return {kind: 'telegram', url: s.split(/\s/)[0]};
    const tg = s.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/[A-Za-z0-9_+\-/?=&%.]+/i);
    if (tg) return {kind: 'telegram', url: /^https?:/i.test(tg[0]) ? tg[0].replace(/^http:/i, 'https:') : 'https://' + tg[0]};
    const yt = s.match(/(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\/[^\s"'<>]+/i);
    if (yt) return {kind: 'youtube', url: /^https?:/i.test(yt[0]) ? yt[0].replace(/^http:/i, 'https:') : 'https://' + yt[0]};
    const dm = s.match(/(?:https?:\/\/)?(?:www\.)?(?:dailymotion\.com\/(?:embed\/)?video|dai\.ly)\/([a-zA-Z0-9]{5,12})/i);
    if (dm) return {kind: 'dailymotion', url: 'https://www.dailymotion.com/video/' + dm[1], id: dm[1]};
    const ia = s.match(/(?:https?:\/\/)?archive\.org\/(?:details|embed)\/([A-Za-z0-9._-]{2,120})/i);
    if (ia) return {kind: 'archive', url: 'https://archive.org/details/' + ia[1], id: ia[1]};
    const u = s.match(/https:\/\/[^\s"'<>]+/i);
    if (u) {
      if (/\.(m3u8|mp4|m4v|webm|mkv|mov|mp3|aac|m4a|ogg|opus|flac|mpd)(\?|#|$)/i.test(u[0])) return {kind: 'media', url: u[0]};
      return {kind: 'web', url: u[0]};
    }
    return {kind: '', url: ''};
  }
  // a typed https address -> the address without a trailing slash, '' for empty, null when it is not a plain https address
  function httpsUrl(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (!/^https:\/\/[^\s/?#@]+(\/[^\s?#]*)?$/i.test(v)) return null;
    return v.replace(/\/+$/, '');
  }
  // does a typed key look like one? (a cheap check before the real test; never the proof)
  const KEY_RX = {
    tmdb: /^(?:[0-9a-f]{32}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})$/,     // v3 key or v4 read token
    gemini: /^[A-Za-z0-9_-]{30,80}$/, yt: /^[A-Za-z0-9_-]{30,80}$/, os: /^[A-Za-z0-9]{16,64}$/,
  };
  const keyOk = (kind, v) => !!(KEY_RX[kind] && KEY_RX[kind].test(String(v || '').trim()));
  // row states -> the summary line of the Kodi screen: {on, off, fix}
  function summary(states) {
    const out = {on: 0, off: 0, fix: 0};
    for (const s of states || []) { if (s === 'on') out.on++; else if (s === 'fix') out.fix++; else out.off++; }
    return out;
  }
  // StremThru (stremthru.py): 40-hex info hashes out of hashes / magnets, in batches of 100
  function stHashes(list) {
    const out = [];
    for (const h of list || []) {
      const m = /(?:^|[^0-9a-fA-F])([0-9a-fA-F]{40})(?![0-9a-fA-F])/.exec(' ' + String(h || ''));
      if (m && !out.includes(m[1].toLowerCase())) out.push(m[1].toLowerCase());
    }
    return out;
  }
  // the answer of /v0/store/torz/check -> {hash: [{index, name, size}]} for the cached ones
  function stCached(json) {
    const out = {};
    for (const it of ((json && json.data && json.data.items) || [])) {
      if (!it || it.status !== 'cached' || !/^[0-9a-f]{40}$/i.test(it.hash || '')) continue;
      out[String(it.hash).toLowerCase()] = (it.files || []).map((f) => ({index: Number(f.index) || 0, name: String(f.name || f.path || ''), size: Number(f.size) || 0}));
    }
    return out;
  }
  const core = {classify, httpsUrl, keyOk, summary, stHashes, stCached, ST_DEFAULT, KEY_RX};
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }

  const TN = root.TN;
  if (!TN) return;
  TN.i18n.add({
    he: {sv_backup_btn: 'גיבוי מלא / שחזור / העברה למכשיר אחר', sv_quick: 'הגדרה מהירה', sv_quick_txt: 'שני החשבונות ששווה לחבר. לחיצה אחת על כל אחד – ואישור.', sv_q_tg_txt: 'סרטים וסדרות מהערוצים והקבוצות שלך. לוחצים, מאשרים באפליקציית טלגרם – וזהו.',
      sv_q_rd_txt: 'קישורים מהירים ואיכותיים (מנוי בתשלום). לוחצים, מאשרים את הקוד באתר Real-Debrid – וזהו.', sv_q_code: 'התחבר עם קוד',
      sv_ready_txt: 'כל השאר כבר מוגדר ופועל בלי שום פעולה: קטלוג הסרטים והסדרות, ערוצי הטלוויזיה והרדיו, כתוביות בעברית, מנוע העזר, והנגן לכל סוגי הקבצים.', sv_adv: 'כל השירותים והמפתחות (מתקדם)',
      sv_intro: 'כל החיבורים והמפתחות במסך אחד. כל ערך נשמר רק בדפדפן הזה, נשלח רק לשירות שלו, ולעולם לא מופיע בכתובת.',
         sv_sum: '%s פעילים, %s כבויים, %s לתיקון', sv_on: 'פעיל', sv_off: 'כבוי', sv_fix: 'צריך תיקון', sv_set: 'מוגדר', sv_unset: 'לא הוגדר', sv_acc: 'מהחשבון המסונכרן',
         sv_g_sources: 'מקורות', sv_g_subs: 'כתוביות', sv_g_ai: 'בינה מלאכותית ומידע', sv_g_tv: 'טלוויזיה, גיבוי ומעקב', sv_g_sync: 'סנכרון ומכשירים', sv_tools: 'כלים',
         sv_save: 'שמירה', sv_saved: 'נשמר', sv_del: 'מחיקה', sv_deleted: 'נמחק', sv_test: 'בדיקה עכשיו', sv_testing: 'בודק...', sv_ok: 'עובד', sv_bad: 'לא עבד (%s)',
         sv_net: 'אין תשובה (רשת או חסימת דפדפן)', sv_get: 'קבלת מפתח', sv_open: 'פתיחה', sv_site: 'אתר השירות', sv_bad_key: 'זה לא נראה כמו מפתח תקין', sv_bad_url: 'כתובת https בלבד',
         sv_key_ph: 'הדביקו כאן את המפתח', sv_key_kept: 'מפתח שמור (לא מוצג)', sv_switch_on: 'להפעיל', sv_switch_off: 'לכבות',
         sv_tg: 'טלגרם', sv_tg_hint: 'מקור לסרטים ולסדרות, וסנכרון משתמשים, היסטוריה ומועדפים בין כל המכשירים. כל מכשיר מתחבר בעצמו.',
         sv_tg_on: 'מחובר', sv_tg_saved: 'שמור במכשיר', sv_tg_off: 'לא מחובר', sv_tg_connect: 'התחברות', sv_tg_manage: 'ניהול החיבור', sv_sync: 'סנכרון עכשיו', sv_sync_done: 'הסנכרון רץ',
         sv_quiet: 'מצב שקט', sv_quiet_hint: 'ערוצים שהאתר מצטרף אליהם מושתקים ועוברים לארכיון, כדי שהטלפון לא יצלצל.',
         sv_bots: 'חיפוש בבוטים של טלגרם', sv_bots_hint: 'כשאין קובץ, האתר שואל את הבוטים שבחרתם (בעמוד טלגרם). כבוי כברירת מחדל.',
         sv_api_page: 'API ID / Hash: my.telegram.org',
         sv_rd: 'Real-Debrid', sv_rd_hint: 'קישורים מהירים לסרטים ולסדרות. מתחברים עם קוד קצר או עם טוקן; הפרטים נשמרים רק בדפדפן הזה.', sv_rd_token: 'טוקן API של Real-Debrid', sv_rd_missing: 'רכיב Real-Debrid לא נטען. רעננו את העמוד.',
         sv_st: 'StremThru', sv_st_hint: 'בודק אילו קבצים באמת זמינים ב-Real-Debrid לפני שהם מוצגים. שימו לב: מפתח ה-Real-Debrid נשלח לשרת StremThru. צריך עוזר (Worker).',
         sv_st_url: 'כתובת שרת StremThru', sv_need_helper: 'צריך עוזר (Worker)', sv_need_rd: 'צריך Real-Debrid מחובר',
         sv_os: 'OpenSubtitles', sv_os_hint: 'מפתח API חינמי (opensubtitles.com > Consumers) לחיפוש כתוביות.',
         sv_stremio: 'שרתי Stremio', sv_stremio_hint: 'כתובות manifest.json של תוספי Stremio (https) שמוסיפים מקורות. עד 12.', sv_stremio_add: 'הוספה', sv_stremio_rm: 'הסרה',
         sv_stremio_bad: 'צריך כתובת https של manifest.json', sv_stremio_none: 'אין שרתים',
         sv_kt: 'Ktuvit (חשבון אישי)', sv_kt_hint: 'כתוביות בעברית מ-ktuvit.me עם החשבון שלכם. הסיסמה נשלחת רק ל-Ktuvit דרך העוזר ואינה נשמרת.',
         sv_kt_email: 'אימייל', sv_kt_pass: 'סיסמה', sv_kt_login: 'כניסה', sv_kt_logout: 'יציאה', sv_kt_in: 'מחובר',
         sv_subsites: 'אתרי כתוביות (Wizdom, YIFY ועוד)', sv_subsites_hint: 'מפעילים ומכבים כל אתר כתוביות בספרייה.',
         sv_srv: 'שרת כתוביות AI', sv_srv_hint: 'השרת במחשב הביתי (תמלול ותרגום). מהאתר הוא נגיש רק בכתובת https (Tailscale Funnel / Cloudflare Tunnel).',
         sv_gem: 'Gemini AI', sv_gem_hint: 'מפתח חינמי לחיפוש חכם, לתרגום תקצירים ולתרגום כתוביות.',
         sv_tmdb: 'TMDb', sv_tmdb_hint: 'מפתח חינמי לקטלוג המלא בעברית. בלי מפתח הקטלוג פועל דרך Cinemeta.',
         sv_yt: 'YouTube', sv_yt_hint: 'מפתח YouTube Data API חינמי לחיפוש, לרשימות ערוצים ולשידורים חיים. ניגון עובד גם בלי.',
         sv_helper: 'עוזר (Worker)', sv_helper_hint: 'כתובת https של Cloudflare Worker משלכם (התיקייה worker באתר הפרויקט). מאפשר Ktuvit, YouTube בלי מפתח, StremThru וחלק מ-Real-Debrid. ריק = בלי עוזר.',
         sv_helper_ok: 'העוזר ענה', sv_helper_bad: 'בכתובת הזאת אין עוזר של TeleNova',
         sv_iptv: 'IPTV (M3U + מדריך)', sv_iptv_hint: 'רשימות הערוצים והמדריך מנוהלים בעמוד הטלוויזיה החיה.',
         sv_gd: 'Google Drive', sv_gd_hint: 'גיבויים, סנכרון וסרטונים אישיים.',
         sv_trakt: 'Trakt', sv_trakt_hint: 'כמו ב-Kodi: החשבון נפתח באתר Trakt. באתר הזה מה שנצפה נשמר בהיסטוריה ומסתנכרן דרך טלגרם.', sv_trakt_act: 'הפעלת מכשיר (trakt.tv/activate)',
         sv_sync_row: 'סנכרון אוטומטי, משתמשים, גיבוי וייצוא', sv_sync_hint: 'הסנכרון פועל לבד כשטלגרם מחובר. גיבוי לקובץ, שחזור, ייצוא וייבוא הגדרות - בעמוד הגיבוי.',
         sv_pair: 'חיבור גרסת הדפדפן מ-Kodi', sv_pair_hint: 'ב-Kodi: שירותים וחיבורים > חיבור גרסת הדפדפן. סורקים את הקוד בטלפון והאתר נפתח עם פרטי ה-API של החשבון, מוכן להתחברות.',
         sv_update: 'עדכון האפליקציה', sv_repair: 'תיקון: ניקוי מטמון', sv_reset: 'איפוס הגדרות הדפדפן',
         sv_reset_q: 'ללחוץ שוב כדי לאפס את הגדרות הדפדפן הזה (הרשימות והחיבורים נשארים)', sv_done: 'בוצע', sv_upd_none: 'זו כבר הגרסה האחרונה',
         sv_upd_got: 'נמצאה גרסה חדשה, טוען מחדש...', sv_paste: 'הדבקת קישור', sv_paste_hint: 'קישור t.me, YouTube, Dailymotion, archive.org, קישור וידאו ישיר או magnet',
         sv_paste_btn: 'הדבקה מהלוח', sv_paste_go: 'פתיחה', sv_paste_no: 'הלוח לא זמין כאן; הדביקו בתיבה', sv_paste_unknown: 'לא זוהה קישור שאפשר לפתוח',
         sv_magnet_need: 'magnet נפתח דרך Real-Debrid: התחברו ל-Real-Debrid למעלה', sv_newtab: 'הקישור נפתח בלשונית חדשה',
         dv_intro: 'איך האתר מסודר במכשיר הזה.', dv_auto: 'אוטומטי', dv_tv: 'טלוויזיה (שלט / מקלדת)', dv_phone: 'טלפון', dv_desktop: 'מחשב',
         dv_tv_hint: 'בטלוויזיה החצים עוברים בין הכפתורים, Enter בוחר ו-Back חוזר.'},
    en: {sv_backup_btn: 'Full backup / restore / move to another device', sv_quick: 'Quick setup', sv_quick_txt: 'The two accounts worth connecting. One press each - and a confirmation.', sv_q_tg_txt: 'Films and series from your own channels and groups. Press, confirm in the Telegram app - done.',
      sv_q_rd_txt: 'Fast, high-quality links (paid subscription). Press, approve the code on the Real-Debrid site - done.', sv_q_code: 'Sign in with a code',
      sv_ready_txt: 'Everything else is already set and works with no action: the film and series catalogue, TV channels and radio, Hebrew subtitles, the helper, and the player for every file type.', sv_adv: 'All services and keys (advanced)',
      sv_intro: 'Every connection and key on one screen. Each value stays in this browser only, is sent only to its own service, and never appears in an address.',
         sv_sum: '%s on, %s off, %s to fix', sv_on: 'On', sv_off: 'Off', sv_fix: 'Needs fixing', sv_set: 'Set', sv_unset: 'Not set', sv_acc: 'From the synced account',
         sv_g_sources: 'Sources', sv_g_subs: 'Subtitles', sv_g_ai: 'AI and metadata', sv_g_tv: 'TV, backup and tracking', sv_g_sync: 'Sync and devices', sv_tools: 'Tools',
         sv_save: 'Save', sv_saved: 'Saved', sv_del: 'Delete', sv_deleted: 'Deleted', sv_test: 'Test now', sv_testing: 'Checking...', sv_ok: 'Works', sv_bad: 'Did not work (%s)',
         sv_net: 'No answer (network, or the browser was refused)', sv_get: 'Get a key', sv_open: 'Open', sv_site: 'The service\'s site', sv_bad_key: 'That does not look like a valid key', sv_bad_url: 'https addresses only',
         sv_key_ph: 'Paste the key here', sv_key_kept: 'A key is stored (not shown)', sv_switch_on: 'Turn on', sv_switch_off: 'Turn off',
         sv_tg: 'Telegram', sv_tg_hint: 'A source of films and series, and the sync of users, history and favourites between all devices. Every device signs in by itself.',
         sv_tg_on: 'Connected', sv_tg_saved: 'Saved on this device', sv_tg_off: 'Not connected', sv_tg_connect: 'Connect', sv_tg_manage: 'Manage the connection', sv_sync: 'Sync now', sv_sync_done: 'The sync ran',
         sv_quiet: 'Quiet mode', sv_quiet_hint: 'Channels the site joins are muted and archived, so the phone does not ring.',
         sv_bots: 'Search through Telegram bots', sv_bots_hint: 'When no file is found the site asks the bots you chose (on the Telegram page). Off by default.',
         sv_api_page: 'API ID / Hash: my.telegram.org',
         sv_rd: 'Real-Debrid', sv_rd_hint: 'Fast links for films and series. Sign in with a short code or a token; the details stay in this browser only.', sv_rd_token: 'Real-Debrid API token', sv_rd_missing: 'The Real-Debrid part did not load. Reload the page.',
         sv_st: 'StremThru', sv_st_hint: 'Checks which files really are available at Real-Debrid before they are listed. Note: the Real-Debrid key is sent to the StremThru server. Needs the helper (Worker).',
         sv_st_url: 'StremThru server address', sv_need_helper: 'Needs the helper (Worker)', sv_need_rd: 'Needs Real-Debrid connected',
         sv_os: 'OpenSubtitles', sv_os_hint: 'A free API key (opensubtitles.com > Consumers) for subtitle search.',
         sv_stremio: 'Stremio servers', sv_stremio_hint: 'manifest.json addresses of Stremio add-ons (https) that add sources. Up to 12.', sv_stremio_add: 'Add', sv_stremio_rm: 'Remove',
         sv_stremio_bad: 'An https manifest.json address is needed', sv_stremio_none: 'No servers',
         sv_kt: 'Ktuvit (own account)', sv_kt_hint: 'Hebrew subtitles from ktuvit.me with your account. The password goes only to Ktuvit through the helper and is not stored.',
         sv_kt_email: 'Email', sv_kt_pass: 'Password', sv_kt_login: 'Sign in', sv_kt_logout: 'Sign out', sv_kt_in: 'Signed in',
         sv_subsites: 'Subtitle sites (Wizdom, YIFY and more)', sv_subsites_hint: 'Each subtitle site is switched on and off in the Library.',
         sv_srv: 'AI subtitle server', sv_srv_hint: 'The server on the home PC (transcription and translation). From the site it is reachable only at an https address (Tailscale Funnel / Cloudflare Tunnel).',
         sv_gem: 'Gemini AI', sv_gem_hint: 'A free key for smart search, plot translation and subtitle translation.',
         sv_tmdb: 'TMDb', sv_tmdb_hint: 'A free key for the full catalogue in your language. Without one the catalogue runs on Cinemeta.',
         sv_yt: 'YouTube', sv_yt_hint: 'A free YouTube Data API key for search, channel lists and live broadcasts. Playing works without it.',
         sv_helper: 'Helper (Worker)', sv_helper_hint: 'The https address of your own Cloudflare Worker (the worker folder of the project). It enables Ktuvit, YouTube without a key, StremThru and part of Real-Debrid. Empty = no helper.',
         sv_helper_ok: 'The helper answered', sv_helper_bad: 'There is no TeleNova helper at this address',
         sv_iptv: 'IPTV (M3U + guide)', sv_iptv_hint: 'Channel lists and the guide are managed on the Live TV page.',
         sv_gd: 'Google Drive', sv_gd_hint: 'Backups, sync and your own videos.',
         sv_trakt: 'Trakt', sv_trakt_hint: 'As in Kodi: the account opens on the Trakt site. On this site what you watched is kept in the history and syncs through Telegram.', sv_trakt_act: 'Activate a device (trakt.tv/activate)',
         sv_sync_row: 'Automatic sync, users, backup and export', sv_sync_hint: 'The sync runs by itself while Telegram is connected. Backup to a file, restore, export and import of settings are on the Backup page.',
         sv_pair: 'Connect the web version from Kodi', sv_pair_hint: 'In Kodi: Services and accounts > Connect web version. Scan the code with a phone and the site opens with the account\'s API details, ready to sign in.',
         sv_update: 'Update the app', sv_repair: 'Repair: clear the cache', sv_reset: 'Reset this browser\'s settings',
         sv_reset_q: 'Press again to reset this browser\'s settings (your lists and connections stay)', sv_done: 'Done', sv_upd_none: 'This is already the latest version',
         sv_upd_got: 'A new version was found, reloading...', sv_paste: 'Paste a link', sv_paste_hint: 'A t.me, YouTube, Dailymotion or archive.org link, a direct video link or a magnet',
         sv_paste_btn: 'Paste from the clipboard', sv_paste_go: 'Open', sv_paste_no: 'The clipboard is not available here; paste into the box', sv_paste_unknown: 'No link that can be opened was found',
         sv_magnet_need: 'A magnet opens through Real-Debrid: sign in to Real-Debrid above', sv_newtab: 'The link opened in a new tab',
         dv_intro: 'How the site is laid out on this device.', dv_auto: 'Automatic', dv_tv: 'TV (remote / keyboard)', dv_phone: 'Phone', dv_desktop: 'Computer',
         dv_tv_hint: 'On a TV the arrows move between buttons, Enter chooses and Back goes back.'},
    ru: {sv_backup_btn: 'Полная копия / восстановление / перенос на другое устройство', sv_quick: 'Быстрая настройка', sv_quick_txt: 'Два аккаунта, которые стоит подключить. Одно нажатие и подтверждение.', sv_q_tg_txt: 'Фильмы и сериалы из ваших каналов и групп. Нажмите, подтвердите в приложении Telegram - готово.',
      sv_q_rd_txt: 'Быстрые качественные ссылки (платная подписка). Нажмите, подтвердите код на сайте Real-Debrid - готово.', sv_q_code: 'Войти по коду',
      sv_ready_txt: 'Всё остальное уже настроено и работает без действий: каталог фильмов и сериалов, ТВ-каналы и радио, субтитры на иврите, помощник и плеер для любых файлов.', sv_adv: 'Все сервисы и ключи (дополнительно)',
      sv_intro: 'Все подключения и ключи на одном экране. Каждое значение хранится только в этом браузере, отправляется только своему сервису и никогда не попадает в адрес.',
         sv_sum: 'Включено: %s, выключено: %s, требует внимания: %s', sv_on: 'Вкл', sv_off: 'Выкл', sv_fix: 'Требует внимания', sv_set: 'Задано', sv_unset: 'Не задано', sv_acc: 'Из синхронизированного аккаунта',
         sv_g_sources: 'Источники', sv_g_subs: 'Субтитры', sv_g_ai: 'ИИ и метаданные', sv_g_tv: 'ТВ, копии и отслеживание', sv_g_sync: 'Синхронизация и устройства', sv_tools: 'Инструменты',
         sv_save: 'Сохранить', sv_saved: 'Сохранено', sv_del: 'Удалить', sv_deleted: 'Удалено', sv_test: 'Проверить', sv_testing: 'Проверка...', sv_ok: 'Работает', sv_bad: 'Не сработало (%s)',
         sv_net: 'Нет ответа (сеть или браузеру отказано)', sv_get: 'Получить ключ', sv_open: 'Открыть', sv_site: 'Сайт сервиса', sv_bad_key: 'Это не похоже на правильный ключ', sv_bad_url: 'Только адреса https',
         sv_key_ph: 'Вставьте ключ сюда', sv_key_kept: 'Ключ сохранён (не показывается)', sv_switch_on: 'Включить', sv_switch_off: 'Выключить',
         sv_tg: 'Telegram', sv_tg_hint: 'Источник фильмов и сериалов и синхронизация пользователей, истории и избранного между устройствами. Каждое устройство входит само.',
         sv_tg_on: 'Подключено', sv_tg_saved: 'Сохранено на устройстве', sv_tg_off: 'Не подключено', sv_tg_connect: 'Подключить', sv_tg_manage: 'Управление подключением', sv_sync: 'Синхронизировать', sv_sync_done: 'Синхронизация выполнена',
         sv_quiet: 'Тихий режим', sv_quiet_hint: 'Каналы, в которые вступает сайт, отключают звук и уходят в архив, чтобы телефон не звонил.',
         sv_bots: 'Поиск через ботов Telegram', sv_bots_hint: 'Когда файл не найден, сайт спрашивает выбранных вами ботов (на странице Telegram). По умолчанию выключено.',
         sv_api_page: 'API ID / Hash: my.telegram.org',
         sv_rd: 'Real-Debrid', sv_rd_hint: 'Быстрые ссылки на фильмы и сериалы. Вход по короткому коду или токену; данные хранятся только в этом браузере.', sv_rd_token: 'API-токен Real-Debrid', sv_rd_missing: 'Модуль Real-Debrid не загрузился. Обновите страницу.',
         sv_st: 'StremThru', sv_st_hint: 'Проверяет, какие файлы действительно доступны в Real-Debrid, до показа. Внимание: ключ Real-Debrid отправляется на сервер StremThru. Нужен помощник (Worker).',
         sv_st_url: 'Адрес сервера StremThru', sv_need_helper: 'Нужен помощник (Worker)', sv_need_rd: 'Нужен подключённый Real-Debrid',
         sv_os: 'OpenSubtitles', sv_os_hint: 'Бесплатный ключ API (opensubtitles.com > Consumers) для поиска субтитров.',
         sv_stremio: 'Серверы Stremio', sv_stremio_hint: 'Адреса manifest.json дополнений Stremio (https), которые добавляют источники. До 12.', sv_stremio_add: 'Добавить', sv_stremio_rm: 'Убрать',
         sv_stremio_bad: 'Нужен https-адрес manifest.json', sv_stremio_none: 'Серверов нет',
         sv_kt: 'Ktuvit (свой аккаунт)', sv_kt_hint: 'Субтитры на иврите с ktuvit.me с вашим аккаунтом. Пароль отправляется только в Ktuvit через помощник и не сохраняется.',
         sv_kt_email: 'Эл. почта', sv_kt_pass: 'Пароль', sv_kt_login: 'Войти', sv_kt_logout: 'Выйти', sv_kt_in: 'Вход выполнен',
         sv_subsites: 'Сайты субтитров (Wizdom, YIFY и другие)', sv_subsites_hint: 'Каждый сайт субтитров включается и выключается в «Библиотеке».',
         sv_srv: 'Сервер ИИ-субтитров', sv_srv_hint: 'Сервер на домашнем ПК (расшифровка и перевод). С сайта он доступен только по адресу https (Tailscale Funnel / Cloudflare Tunnel).',
         sv_gem: 'Gemini AI', sv_gem_hint: 'Бесплатный ключ для умного поиска, перевода описаний и субтитров.',
         sv_tmdb: 'TMDb', sv_tmdb_hint: 'Бесплатный ключ для полного каталога на вашем языке. Без ключа каталог работает через Cinemeta.',
         sv_yt: 'YouTube', sv_yt_hint: 'Бесплатный ключ YouTube Data API для поиска, списков каналов и прямых эфиров. Воспроизведение работает и без него.',
         sv_helper: 'Помощник (Worker)', sv_helper_hint: 'Адрес https вашего Cloudflare Worker (папка worker проекта). Нужен для Ktuvit, YouTube без ключа, StremThru и части Real-Debrid. Пусто = без помощника.',
         sv_helper_ok: 'Помощник ответил', sv_helper_bad: 'По этому адресу нет помощника TeleNova',
         sv_iptv: 'IPTV (M3U + программа)', sv_iptv_hint: 'Списки каналов и программа настраиваются на странице прямого эфира.',
         sv_gd: 'Google Drive', sv_gd_hint: 'Копии, синхронизация и ваши видео.',
         sv_trakt: 'Trakt', sv_trakt_hint: 'Как в Kodi: аккаунт открывается на сайте Trakt. На этом сайте просмотренное хранится в истории и синхронизируется через Telegram.', sv_trakt_act: 'Активировать устройство (trakt.tv/activate)',
         sv_sync_row: 'Автосинхронизация, пользователи, копии и экспорт', sv_sync_hint: 'Синхронизация идёт сама, пока подключён Telegram. Копия в файл, восстановление, экспорт и импорт настроек - на странице резервной копии.',
         sv_pair: 'Подключить веб-версию из Kodi', sv_pair_hint: 'В Kodi: «Сервисы и аккаунты» > «Подключить веб-версию». Отсканируйте код телефоном, и сайт откроется с данными API аккаунта, готовый ко входу.',
         sv_update: 'Обновить приложение', sv_repair: 'Исправить: очистить кэш', sv_reset: 'Сбросить настройки браузера',
         sv_reset_q: 'Нажмите ещё раз, чтобы сбросить настройки этого браузера (списки и подключения останутся)', sv_done: 'Готово', sv_upd_none: 'Это уже последняя версия',
         sv_upd_got: 'Найдена новая версия, перезагрузка...', sv_paste: 'Вставить ссылку', sv_paste_hint: 'Ссылка t.me, YouTube, Dailymotion или archive.org, прямая ссылка на видео или magnet',
         sv_paste_btn: 'Вставить из буфера', sv_paste_go: 'Открыть', sv_paste_no: 'Буфер здесь недоступен; вставьте в поле', sv_paste_unknown: 'Не найдено ссылки, которую можно открыть',
         sv_magnet_need: 'Magnet открывается через Real-Debrid: войдите в Real-Debrid выше', sv_newtab: 'Ссылка открыта в новой вкладке',
         dv_intro: 'Как сайт выглядит на этом устройстве.', dv_auto: 'Автоматически', dv_tv: 'Телевизор (пульт / клавиатура)', dv_phone: 'Телефон', dv_desktop: 'Компьютер',
         dv_tv_hint: 'На телевизоре стрелки переходят между кнопками, Enter выбирает, Back возвращает.'},
  });
  const t = TN.t;
  // weblink.py PAGES: where each key / account is issued
  const PAGES = {telegram: 'https://my.telegram.org/apps', rd: 'https://real-debrid.com/device', gemini: 'https://aistudio.google.com/apikey',
    tmdb: 'https://www.themoviedb.org/settings/api', opensubs: 'https://www.opensubtitles.com/consumers', ktuvit: 'https://www.ktuvit.me/',
    stremthru: 'https://github.com/MunifTanjim/stremthru', trakt: 'https://trakt.tv/activate', trakt_site: 'https://trakt.tv/',
    yt: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', helper: 'https://developers.cloudflare.com/workers/'};

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function linkBtn(cls, text, href) {
    const a = el('a', cls, text); a.href = href;
    if (/^https:/.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
  }
  const toast = (s) => { if (typeof TN.toast === 'function') { try { TN.toast(s); } catch (e) {} } };
  const S = TN.settings;
  const sval = (k) => String(S.get(k, '') || '').trim();
  async function helperLib() { if (!root.TNHelper) await TN.loadScript('helper.js'); return root.TNHelper; }

  // ------------------------------------------------------------ the tests (each -> {ok, text}); keys travel in headers only
  const verdict = (r) => (r && r.ok ? {ok: true, text: t('sv_ok')} : {ok: false, text: t('sv_bad', r ? r.status : '?')});
  const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { return {ok: false, text: e && e.code === 'needs_helper' ? t('sv_need_helper') : t('sv_net')}; } };
  const testers = {
    // through the shell's own TMDb call (the one the catalogue makes with the saved key): this page builds no address with a key
    tmdb: async () => {
      try { await TN.tmdb('/configuration'); return {ok: true, text: t('sv_ok')}; } catch (e) {
        const m = /(\d{3})/.exec(String(e && e.message));
        return {ok: false, text: m ? t('sv_bad', m[1]) : t('sv_net')};
      }
    },
    gemini: safe(async (key) => verdict(await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {headers: {'x-goog-api-key': key}, credentials: 'omit'}))),
    yt: safe(async (key) => verdict(await fetch('https://www.googleapis.com/youtube/v3/videos?part=id&id=jNQXAC9IVRw', {headers: {'X-Goog-Api-Key': key}, credentials: 'omit'}))),
    os: safe(async (key) => verdict(await fetch('https://api.opensubtitles.com/api/v1/infos/formats',
      {headers: {'Api-Key': key, 'X-User-Agent': 'TeleNova v' + (TN.version || '1'), Accept: 'application/json'}, credentials: 'omit'}))),
    srv: safe(async (url) => verdict(await fetch(url + '/health', {credentials: 'omit', cache: 'no-store'}))),
    helper: safe(async (url) => { const H = await helperLib(); const ok = await H.ping(url); return {ok, text: t(ok ? 'sv_helper_ok' : 'sv_helper_bad')}; }),
    stremthru: safe(async (url) => { const H = await helperLib(); return verdict(await H.fetch(url + '/v0/health', {timeout: 10000})); }),
  };

  // ------------------------------------------------------------ StremThru for rd.js (stremthru.py check): which hashes RD really has
  const stremthru = () => ({on: S.get('stremthru_on', true) !== false, url: httpsUrl(S.get('stremthru_url', '')) || ST_DEFAULT});
  async function stremthruCheck(hashes, o) {
    o = o || {};
    const st = stremthru(), list = stHashes(hashes), out = {};
    if (!st.on || !list.length || !o.token) return out;
    const H = await helperLib();
    for (let i = 0; i < list.length; i += 100) {
      const qs = new URLSearchParams({hash: list.slice(i, i + 100).join(',')});
      if (o.sid) qs.set('sid', String(o.sid));
      const r = await H.fetch(st.url + '/v0/store/torz/check?' + qs, {headers: {'X-StremThru-Store-Name': 'realdebrid',
        'X-StremThru-Store-Authorization': 'Bearer ' + o.token}, signal: o.signal, timeout: 12000});
      if (!r.ok) throw Object.assign(new Error('stremthru ' + r.status), {code: 'stremthru'});
      Object.assign(out, stCached(await r.json()));
    }
    return out;
  }

  // ------------------------------------------------------------ rows
  function style() {
    if (document.getElementById('sv_css')) return;
    const s = el('style'); s.id = 'sv_css';
    s.textContent = '.sv_list{display:grid;gap:12px;margin-top:10px;max-width:820px}.sv_row{display:grid;gap:8px}' +
      '.sv_head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.sv_head b{font-size:1.05em}.sv_dim{background:var(--panel2);color:var(--muted)}' +
      '.sv_warn{background:#8a5a00;color:#fff}.sv_row input[type=text],.sv_row input[type=url],.sv_row input[type=password],.sv_row input[type=email]{flex:1 1 220px;min-width:0;min-height:44px;' +
      'background:var(--panel);color:var(--text);border:1px solid var(--muted);border-radius:10px;padding:9px 14px;font:inherit}' +
      '.sv_row input:focus-visible{outline:3px solid var(--ring)}.sv_h2{margin:24px 0 0;font-size:18px}.sv_row .hint{margin:0}' +
      '.sv_sw{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between}.sv_sw>span{flex:1 1 240px}.sv_sw small{display:block;color:var(--muted)}' +
      '.sv_msg{min-height:1.2em}.dv_opts{display:grid;gap:10px;max-width:520px;margin-top:16px}.dv_opts .btn.on{box-shadow:0 0 0 2px var(--ring)}';
    document.head.append(s);
  }
  // one row: name, state tag, hint; .acts (buttons), .say(text), .setState('on' | 'off' | 'fix', text)
  function row(name, hint) {
    const box = el('div', 'panel sv_row');
    const head = el('div', 'sv_head');
    const tag = el('span', 'tag sv_dim', '');
    head.append(el('b', '', name), tag);
    box.append(head);
    if (hint) { const p = el('p', 'hint', hint); p.dir = 'auto'; box.append(p); }
    const body = el('div', 'sv_row'); box.append(body);
    const acts = el('div', 'links'); box.append(acts);
    const live = el('span', 'hint sv_msg'); live.setAttribute('role', 'status'); box.append(live);
    box.body = body; box.acts = acts; box.state = 'off';
    box.say = (s) => { live.textContent = s || ''; };
    box.setState = (st, text) => {
      box.state = st;
      tag.textContent = text || t(st === 'on' ? 'sv_on' : st === 'fix' ? 'sv_fix' : 'sv_off');
      tag.className = 'tag' + (st === 'on' ? '' : st === 'fix' ? ' sv_warn' : ' sv_dim');
      if (box.onState) box.onState();
    };
    return box;
  }
  // an on / off switch line inside a row
  function switchLine(label, hint, get, set) {
    const line = el('div', 'sv_sw');
    const txt = el('span', '', label);
    if (hint) txt.append(el('small', '', hint));
    const b = el('button', 'btn');
    b.type = 'button'; b.setAttribute('role', 'switch');
    const paint = () => { const on = !!get(); b.className = 'btn' + (on ? '' : ' ghost'); b.textContent = t(on ? 'sv_on' : 'sv_off'); b.setAttribute('aria-checked', String(on)); b.setAttribute('aria-label', label); };
    b.onclick = () => { set(!get()); paint(); toast(t('sv_saved')); };
    paint();
    line.append(txt, b);
    return line;
  }
  // a secret key: its value is never drawn back. o: {name, hint, setting, kind, page, test, synced}
  function keyRow(o) {
    const r = row(o.name, o.hint);
    const form = el('form', 'links');
    const inp = el('input'); inp.type = 'password'; inp.autocomplete = 'off'; inp.spellcheck = false; inp.dir = 'ltr'; inp.setAttribute('aria-label', o.name);
    const save = el('button', 'btn', t('sv_save')); save.type = 'submit';
    form.append(inp, save);
    r.body.append(form);
    const cur = () => sval(o.setting) || String(o.synced || '').trim();
    const paint = () => {
      const own = sval(o.setting);
      inp.placeholder = own ? t('sv_key_kept') : t('sv_key_ph');
      r.setState(cur() ? 'on' : 'off', own ? t('sv_set') : o.synced ? t('sv_acc') : t('sv_unset'));
      del.hidden = !own; test.hidden = !cur();
    };
    const run = async () => {
      if (!cur()) return;
      r.say(t('sv_testing'));
      const res = await o.test(cur());
      r.say(res.text);
      if (!res.ok) r.setState('fix'); else paint();
    };
    const del = TN.button('btn ghost', t('sv_del'), () => { S.set(o.setting, ''); inp.value = ''; r.say(t('sv_deleted')); paint(); });
    const test = TN.button('btn ghost', t('sv_test'), run);
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = inp.value.trim();
      if (!v) return;
      if (!keyOk(o.kind, v)) return r.say(t('sv_bad_key'));
      S.set(o.setting, v); inp.value = '';
      paint(); toast(t('sv_saved'));
      run();                                     // a saved key is tested at once
    };
    r.acts.append(test, del, linkBtn('btn ghost', t('sv_get'), o.page));
    paint();
    return r;
  }
  // an https address. o: {name, hint, setting, placeholder, test, page, okText}
  function urlRow(o) {
    const r = row(o.name, o.hint);
    const form = el('form', 'links');
    const inp = el('input'); inp.type = 'url'; inp.inputMode = 'url'; inp.autocomplete = 'off'; inp.spellcheck = false; inp.dir = 'ltr';
    inp.placeholder = o.placeholder || 'https://'; inp.value = sval(o.setting); inp.setAttribute('aria-label', o.name);
    const save = el('button', 'btn', t('sv_save')); save.type = 'submit';
    form.append(inp, save);
    r.body.append(form);
    const paint = () => { r.setState(sval(o.setting) ? 'on' : 'off', sval(o.setting) ? t('sv_set') : t('sv_unset')); test.hidden = !sval(o.setting); };
    const run = async () => {
      if (!sval(o.setting)) return;
      r.say(t('sv_testing'));
      const res = await o.test(sval(o.setting));
      r.say(res.text);
      if (!res.ok) r.setState('fix'); else paint();
    };
    const test = TN.button('btn ghost', t('sv_test'), run);
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = httpsUrl(inp.value);
      if (v === null) return r.say(t('sv_bad_url'));
      S.set(o.setting, v); inp.value = v;
      r.say(t(v ? 'sv_saved' : 'sv_deleted')); paint(); toast(t('sv_saved'));
      if (o.onSave) o.onSave(v);
      if (v) run();
    };
    r.acts.append(test);
    if (o.page) r.acts.append(linkBtn('btn ghost', t('sv_site'), o.page));
    paint();
    return r;
  }

  // ------------------------------------------------------------ pasted links
  async function openPasted(text, say) {
    const c = classify(text);
    if (c.kind === 'telegram') return TN.go(TN.link('telegram', {link: c.url}));
    if (c.kind === 'youtube') {
      const Y = await TN.provider('yt').catch(() => null);
      if (Y && Y.openLink && Y.openLink(c.url)) return;
      return TN.go(TN.link('youtube', {url: c.url}));
    }
    if (c.kind === 'dailymotion') {
      const D = await TN.provider('dailymotion').catch(() => null) || (await TN.load('hub').catch(() => null), await TN.provider('dailymotion').catch(() => null));
      if (D && D.play) return D.play({id: c.id, title: 'Dailymotion'});
      window.open(c.url, '_blank', 'noopener'); return say(t('sv_newtab'));
    }
    if (c.kind === 'archive') return TN.openArchive({identifier: c.id, title: c.id});
    if (c.kind === 'media') {
      const p = await TN.provider('player').catch(() => null);
      let name = c.url.split('/').pop().split(/[?#]/)[0];
      try { name = decodeURIComponent(name); } catch (e) {}
      if (p && p.open) return p.open({url: c.url, title: name});
      window.open(c.url, '_blank', 'noopener'); return say(t('sv_newtab'));
    }
    if (c.kind === 'magnet') {
      const rd = await TN.provider('rd').catch(() => null);
      if (rd && rd.magnet && rd.hasToken && rd.hasToken()) return rd.magnet(c.url);
      return say(t('sv_magnet_need'));
    }
    if (c.kind === 'web') { window.open(c.url, '_blank', 'noopener'); return say(t('sv_newtab')); }
    say(t('sv_paste_unknown'));
  }

  async function updateApp(say) {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration().catch(() => null);
    if (reg) await reg.update().catch(() => {});
    if (reg && (reg.installing || reg.waiting)) { say(t('sv_upd_got')); setTimeout(() => location.reload(), 1200); } else say(t('sv_upd_none'));
  }
  const tgSaved = () => !!(TN.get('tg_session', '') && TN.get('tg_api', null));
  function tgStatus() {
    let st = null;
    if (root.TG && root.TG.ready) { try { st = root.TG.status(); } catch (e) {} }
    return st;
  }

  async function pageServices(arg, ctx) {
    style();
    TN.page('services', t('m_services'));
    const view = TN.view();
    // 5.2: quick setup - the two accounts worth connecting, one button each; everything else works as installed and
    // sits folded under "All services and keys"
    const quick = el('div', 'sv_quick');
    quick.append(el('h2', '', t('sv_quick')), el('p', 'hint', t('sv_quick_txt')));
    const qrow = (name, text) => {
      const r = el('div', 'sv_q'), dot = el('span', 'dot', '○'), tx = el('div', 'tx'), act = el('div', 'links');
      tx.append(el('b', '', name), el('small', '', text));
      r.append(dot, tx, act);
      r.set = (on, label, btn) => { r.classList.toggle('on', !!on); dot.textContent = on ? '✓' : '○'; tx.lastChild.textContent = label; act.textContent = ''; if (btn) act.append(btn); };
      quick.append(r);
      return r;
    };
    const qTg = qrow(t('sv_tg'), t('sv_q_tg_txt')), qRd = qrow(t('sv_rd'), t('sv_q_rd_txt'));
    quick.append(el('p', 'sv_ready', t('sv_ready_txt')));
    // 5.3.2: the full backup, where the accounts are: one press from here
    const bk = el('div', 'links');
    bk.append(linkBtn('btn ghost', t('sv_backup_btn'), '#/backup'));
    quick.append(bk);
    view.append(quick);
    const adv = el('details', 'sv_adv');
    adv.append(el('summary', '', t('sv_adv')));
    if (arg) adv.open = true;                      // a link to one service (#/services/<name>) opens the full list
    const page = view;
    page.append(adv);
    adv.append(el('p', 'hint', t('sv_intro')));
    const sum = el('p', 'hint'); sum.setAttribute('role', 'status'); adv.append(sum);
    const rows = [];
    const count = () => { const c = summary(rows.map((r) => r.state)); sum.textContent = t('sv_sum', c.on, c.off, c.fix); };
    const group = (key) => { adv.append(el('h2', 'sv_h2', t(key))); const l = el('div', 'sv_list'); adv.append(l); return l; };
    const add = (list, r) => { r.onState = count; rows.push(r); list.append(r); return r; };
    const synced = S.synced() || {};

    // ---------------- sources
    let list = group('sv_g_sources');
    // X01 Telegram (+ X05 bots, quiet mode)
    const tg = add(list, row(t('sv_tg'), t('sv_tg_hint')));
    const paintTg = () => {
      const st = tgStatus(), on = !!(st && st.state === 'on');
      tg.setState(on ? 'on' : 'off', on ? t('sv_tg_on') + (st.name ? ' · ' + st.name : '') : tgSaved() ? t('sv_tg_saved') : t('sv_tg_off'));
      tg.acts.textContent = '';
      tg.acts.append(linkBtn('btn' + (on || tgSaved() ? ' ghost' : ''), t(on || tgSaved() ? 'sv_tg_manage' : 'sv_tg_connect'), '#/tglogin'));
      if (on || tgSaved()) {
        tg.acts.append(TN.button('btn', t('sv_sync'), async () => {
          tg.say(t('sv_testing'));
          try { const TG = await TN.tg(); if (TG.resume && !TG.connected()) await TG.resume(); await TG.syncNow(); tg.say(t('sv_sync_done')); paintTg(); } catch (e) { tg.say(t('sv_bad', String((e && e.message) || e).slice(0, 80))); }
        }));
      }
      tg.acts.append(linkBtn('btn ghost', t('sv_api_page'), PAGES.telegram));
      qTg.set(on, on ? t('sv_tg_on') + (st.name ? ' · ' + st.name : '') : t('sv_q_tg_txt'), linkBtn('btn' + (on ? ' ghost' : ''), t(on ? 'sv_tg_manage' : 'sv_tg_connect'), '#/tglogin'));
    };
    tg.body.append(switchLine(t('sv_quiet'), t('sv_quiet_hint'), () => S.get('telegram_quiet', true) !== false, (v) => S.set('telegram_quiet', !!v)),
                   switchLine(t('sv_bots'), t('sv_bots_hint'), () => S.get('tgsearch_bots', false) === true, (v) => S.set('tgsearch_bots', !!v)));
    paintTg();

    // X02 Real-Debrid: rd.js's own panel (device code, token, account state)
    const rd = add(list, row(t('sv_rd'), t('sv_rd_hint')));
    const rdBox = el('div'); rd.body.append(rdBox);
    rd.acts.append(linkBtn('btn ghost', 'real-debrid.com/device', PAGES.rd));
    const paintRd = (R) => {
      const on = !!(R && R.hasToken && R.hasToken());
      rd.setState(on ? 'on' : 'off', on ? t('sv_tg_on') : t('sv_tg_off'));
      // quick setup: one press shows the code (the device sign-in of rd.js), no scrolling through the list
      qRd.set(on, on ? t('sv_tg_on') : t('sv_q_rd_txt'), TN.button('btn' + (on ? ' ghost' : ''), t(on ? 'sv_tg_manage' : 'sv_q_code'), () => {
        adv.open = true;
        let n = 0;
        const go = () => { const b = rdBox.querySelector('#rd_dev'); if (b) { rd.scrollIntoView({block: 'center'}); if (!on) b.click(); else b.focus(); } else if (n++ < 30) setTimeout(go, 100); };
        go();
      }));
    };
    paintRd(null);
    const offRd = TN.on('settings', (k) => { if (k === 'rd' && ctx.current()) TN.provider('rd').then(paintRd, () => {}); });
    TN.provider('rd').then((R) => {
      if (!ctx.current()) return;
      paintRd(R);
      const panel = R && (R.servicesPanel || R.settingsPanel);
      if (panel) {
        panel(rdBox);
        // the panel redraws itself after a sign-in or sign-out: follow it
        if (typeof MutationObserver === 'function') new MutationObserver(() => { if (ctx.current()) { paintRd(R); paintSt(); } }).observe(rdBox, {childList: true});
        return;
      }
      if (R && R.setToken) {                    // an older rd.js: the token field alone
        const f = el('form', 'links');
        const inp = el('input'); inp.type = 'password'; inp.autocomplete = 'off'; inp.dir = 'ltr'; inp.placeholder = t('sv_rd_token'); inp.setAttribute('aria-label', t('sv_rd_token'));
        const b = el('button', 'btn', t('sv_save')); b.type = 'submit';
        f.append(inp, b);
        f.onsubmit = (e) => { e.preventDefault(); if (!R.setToken(inp.value.trim())) return rd.say(t('sv_bad_key')); inp.value = ''; rd.say(t('sv_saved')); paintRd(R); paintSt(); };
        rdBox.append(f);
        return;
      }
      rd.say(t('sv_rd_missing'));
    }, () => rd.say(t('sv_rd_missing')));

    // X03 StremThru
    const st = add(list, row(t('sv_st'), t('sv_st_hint')));
    const stForm = el('form', 'links');
    const stInp = el('input'); stInp.type = 'url'; stInp.dir = 'ltr'; stInp.autocomplete = 'off'; stInp.value = stremthru().url; stInp.setAttribute('aria-label', t('sv_st_url'));
    const stSave = el('button', 'btn ghost', t('sv_save')); stSave.type = 'submit';
    stForm.append(stInp, stSave);
    function paintSt() {
      const on = stremthru().on;
      if (!on) return st.setState('off');
      if (!S.helper()) return st.setState('fix', t('sv_need_helper'));
      if (!TN.get('rd_token', '')) return st.setState('fix', t('sv_need_rd'));
      st.setState('on');
    }
    st.body.append(switchLine(t('sv_st'), '', () => stremthru().on, (v) => { S.set('stremthru_on', !!v); paintSt(); }), stForm);
    stForm.onsubmit = (e) => {
      e.preventDefault();
      const v = httpsUrl(stInp.value);
      if (v === null) return st.say(t('sv_bad_url'));
      S.set('stremthru_url', v === ST_DEFAULT ? '' : v); stInp.value = stremthru().url; st.say(t('sv_saved'));
    };
    st.acts.append(TN.button('btn ghost', t('sv_test'), async () => { st.say(t('sv_testing')); const r = await testers.stremthru(stremthru().url); st.say(r.text); if (r.ok) paintSt(); }),
                   linkBtn('btn ghost', t('sv_site'), PAGES.stremthru));
    paintSt();

    // X06 Stremio servers (sources.js keeps the list)
    const sm = add(list, row(t('sv_stremio'), t('sv_stremio_hint')));
    const smList = el('div', 'sv_row'); sm.body.append(smList);
    TN.provider('sources').then((SRC) => {
      if (!ctx.current()) return;
      if (!SRC || !SRC.addons || !SRC.setAddons) { sm.setState('off'); sm.say(t('sv_rd_missing')); return; }
      const paint = () => {
        const cur = SRC.addons();
        smList.textContent = '';
        if (!cur.length) smList.append(el('p', 'hint', t('sv_stremio_none')));
        cur.forEach((b) => {
          const line = el('div', 'sv_sw');
          const nm = el('span', '', b.replace(/^https:\/\//, '')); nm.dir = 'ltr'; nm.style.overflowWrap = 'anywhere';
          line.append(nm, TN.button('btn ghost', t('sv_stremio_rm'), () => { SRC.setAddons(SRC.addons().filter((x) => x !== b)); paint(); }));
          smList.append(line);
        });
        sm.setState(cur.length ? 'on' : 'off', cur.length ? String(cur.length) : t('sv_unset'));
      };
      const f = el('form', 'links');
      const inp = el('input'); inp.type = 'url'; inp.inputMode = 'url'; inp.dir = 'ltr'; inp.placeholder = 'https://.../manifest.json'; inp.setAttribute('aria-label', t('sv_stremio'));
      const b = el('button', 'btn', t('sv_stremio_add')); b.type = 'submit';
      f.append(inp, b);
      f.onsubmit = (e) => {
        e.preventDefault();
        const before = SRC.addons().length;
        const base = SRC.addonBase ? SRC.addonBase(inp.value.trim()) : inp.value.trim();
        if (!base) return sm.say(t('sv_stremio_bad'));
        SRC.setAddons(SRC.addons().concat(base));
        sm.say(SRC.addons().length > before ? t('sv_saved') : '');
        inp.value = ''; paint();
      };
      sm.body.append(f);
      paint();
    }, () => sm.say(t('sv_rd_missing')));
    sm.setState('off', t('sv_unset'));

    // ---------------- subtitles
    list = group('sv_g_subs');
    // X04 OpenSubtitles key
    add(list, keyRow({name: t('sv_os'), hint: t('sv_os_hint'), setting: 'subs_os_key', kind: 'os', page: PAGES.opensubs, test: testers.os,
      synced: synced.os_key || synced.opensubs_key || ''}));
    // X07 Ktuvit (own account): the login subs.js keeps
    const kt = add(list, row(t('sv_kt'), t('sv_kt_hint')));
    kt.acts.append(linkBtn('btn ghost', t('sv_site'), PAGES.ktuvit));
    kt.setState(S.helper() ? 'off' : 'fix', S.helper() ? t('sv_tg_off') : t('sv_need_helper'));
    if (S.helper()) {
      TN.provider('subs').then((SB) => {
        if (!ctx.current() || !SB || !SB.ktuvitLogin) return;
        const paint = () => {
          kt.body.textContent = '';
          if (SB.ktuvitLogged && SB.ktuvitLogged()) {
            kt.setState('on', t('sv_kt_in'));
            kt.body.append(TN.button('btn ghost', t('sv_kt_logout'), () => { SB.ktuvitLogout(); paint(); }));
            return;
          }
          kt.setState('off', t('sv_tg_off'));
          const f = el('form', 'links');
          const em = el('input'); em.type = 'email'; em.autocomplete = 'username'; em.required = true; em.dir = 'ltr'; em.placeholder = t('sv_kt_email'); em.setAttribute('aria-label', t('sv_kt_email'));
          const pw = el('input'); pw.type = 'password'; pw.autocomplete = 'current-password'; pw.required = true; pw.dir = 'ltr'; pw.placeholder = t('sv_kt_pass'); pw.setAttribute('aria-label', t('sv_kt_pass'));
          const b = el('button', 'btn', t('sv_kt_login')); b.type = 'submit';
          f.append(em, pw, b);
          f.onsubmit = async (e) => {
            e.preventDefault();
            kt.say(t('sv_testing'));
            try { await SB.ktuvitLogin(em.value, pw.value); pw.value = ''; kt.say(''); paint(); } catch (err) { pw.value = ''; kt.say(t('sv_bad', String((err && (err.code || err.message)) || 'error').slice(0, 60))); }
          };
          kt.body.append(f);
        };
        paint();
      }, () => {});
    }
    // X08 the subtitle sites: switched in the Library
    const ss = add(list, row(t('sv_subsites'), t('sv_subsites_hint')));
    const subNames = ['wizdom', 'opensubs', 'yify', 'ktuvit', 'subsrv', 'subs_ai'], subOn = subNames.filter((n) => TN.providerOn(n)).length;
    ss.setState(subOn ? 'on' : 'off', subOn + ' / ' + subNames.length);
    ss.acts.append(linkBtn('btn ghost', t('m_library'), '#/library'));
    // X09 the AI subtitle server
    add(list, urlRow({name: t('sv_srv'), hint: t('sv_srv_hint'), setting: 'subs_server_url', placeholder: 'https://my-pc.example.ts.net', test: testers.srv}));

    // ---------------- AI and metadata
    list = group('sv_g_ai');
    add(list, keyRow({name: t('sv_gem'), hint: t('sv_gem_hint'), setting: 'gemini_key', kind: 'gemini', page: PAGES.gemini, test: testers.gemini, synced: synced.gemini_key || ''}));
    add(list, keyRow({name: t('sv_tmdb'), hint: t('sv_tmdb_hint'), setting: 'tmdb', kind: 'tmdb', page: PAGES.tmdb, test: testers.tmdb, synced: synced.tmdb_key || synced.tmdb_token || ''}));
    add(list, keyRow({name: t('sv_yt'), hint: t('sv_yt_hint'), setting: 'yt_key', kind: 'yt', page: PAGES.yt, test: testers.yt, synced: ''}));
    add(list, urlRow({name: t('sv_helper'), hint: t('sv_helper_hint'), setting: 'helper', placeholder: 'https://telenova-helper.<name>.workers.dev', test: testers.helper,
      page: PAGES.helper, onSave: () => paintSt()}));

    // ---------------- TV, backup, tracking
    list = group('sv_g_tv');
    const iptv = add(list, row(t('sv_iptv'), t('sv_iptv_hint')));
    iptv.setState('on'); iptv.acts.append(linkBtn('btn ghost', t('sv_open'), '#/live'));
    const gd = add(list, row(t('sv_gd'), t('sv_gd_hint')));
    gd.setState(sval('gdrive_client') ? 'on' : 'off', sval('gdrive_client') ? t('sv_set') : t('sv_unset'));
    gd.acts.append(linkBtn('btn ghost', t('sv_open'), '#/gdrive'));
    const tr = row(t('sv_trakt'), t('sv_trakt_hint'));           // a link, as in Kodi: not counted as a service of this browser
    tr.setState('off', 'trakt.tv');
    tr.acts.append(linkBtn('btn ghost', t('sv_trakt_act'), PAGES.trakt), linkBtn('btn ghost', t('sv_site'), PAGES.trakt_site), linkBtn('btn ghost', t('m_history'), '#/history'));
    list.append(tr);

    // ---------------- sync and devices (X14, X15)
    list = group('sv_g_sync');
    const sy = row(t('sv_sync_row'), t('sv_sync_hint'));
    sy.querySelector('.tag').remove();
    sy.acts.append(linkBtn('btn', t('m_backup'), '#/backup'), linkBtn('btn ghost', t('m_users'), '#/users'), linkBtn('btn ghost', t('m_device'), '#/device'));
    const pr = row(t('sv_pair'), t('sv_pair_hint'));
    pr.querySelector('.tag').remove();
    pr.acts.append(linkBtn('btn ghost', t('sv_tg_connect'), '#/tglogin'), linkBtn('btn ghost', t('m_bn'), '#/bn'));
    list.append(sy, pr);

    // ---------------- tools
    list = group('sv_tools');
    let resetArmed = false;
    const tRow = row(t('sv_tools'), '');
    tRow.querySelector('.sv_head').remove();
    tRow.acts.append(
      TN.button('btn', t('sv_update'), () => updateApp(tRow.say)),
      TN.button('btn ghost', t('sv_repair'), async () => { await TN.clearCaches(); tRow.say(t('sv_done')); setTimeout(() => location.reload(), 800); }),
      linkBtn('btn ghost', t('m_status'), '#/status'), linkBtn('btn ghost', t('m_help'), '#/help'),
      TN.button('btn ghost', t('sv_reset'), () => {
        if (!resetArmed) { resetArmed = true; return tRow.say(t('sv_reset_q')); }
        TN.drop('cfg'); tRow.say(t('sv_done')); setTimeout(() => location.reload(), 600);
      }));
    const pRow = row(t('sv_paste'), t('sv_paste_hint'));
    pRow.querySelector('.tag').remove();
    const pf = el('form', 'links');
    const pi = el('input'); pi.type = 'text'; pi.dir = 'ltr'; pi.autocomplete = 'off'; pi.setAttribute('aria-label', t('sv_paste'));
    const pg = el('button', 'btn', t('sv_paste_go')); pg.type = 'submit';
    pf.append(pi, pg);
    pf.onsubmit = (e) => { e.preventDefault(); pRow.say(''); openPasted(pi.value, pRow.say); };
    pRow.body.append(pf);
    pRow.acts.append(TN.button('btn ghost', t('sv_paste_btn'), async () => {
      try { pi.value = await navigator.clipboard.readText(); } catch (e) { pRow.say(t('sv_paste_no')); pi.focus(); return; }
      if (pi.value) openPasted(pi.value, pRow.say);
    }));
    list.append(tRow, pRow);
    count();
    // a link handed over by another page: #/services/link=<text>
    const given = TN.params(arg).link || TN.params(arg).url || '';
    if (given) { pi.value = given; openPasted(given, pRow.say); }
    // Telegram finishes resuming a moment after the page opens: show its state then
    if (tgSaved() && !(tgStatus() && tgStatus().state === 'on')) setTimeout(() => { if (ctx.current()) paintTg(); }, 4000);
    const offRoute = TN.on('route', () => { if (!ctx.current()) { offRd(); offRoute(); } });
  }

  function pageDevice() {
    style();
    TN.page('device', t('m_device'));
    const view = TN.view();
    view.append(el('p', 'hint', t('dv_intro')));
    const box = el('div', 'dv_opts'); view.append(box);
    const cur = S.get('device', 'auto') || 'auto';
    for (const k of ['auto', 'tv', 'phone', 'desktop']) {
      const b = TN.button('btn' + (k === cur ? ' on' : ' ghost'), t('dv_' + k), () => { S.set('device', k); pageDevice(); });
      b.setAttribute('aria-pressed', String(k === cur));
      box.append(b);
    }
    view.append(el('p', 'hint', t('dv_tv_hint')));
    const f = box.querySelector('.on'); if (f) f.focus();
  }

  TN.registerPage('services', pageServices);
  TN.registerPage('device', pageDevice);
  TN.registerProvider('services', {kinds: [], label: 'Services', stremthru, stremthruCheck, testers, classify, openPasted, PAGES});
  root.TNServices = core;                           // for tests
})(typeof self !== 'undefined' ? self : globalThis);
