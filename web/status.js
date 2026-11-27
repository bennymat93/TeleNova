'use strict';
// WP-9: System status (Kodi H07), the web side of System update (H08) and the speed test (H04).
// Every line is a REAL check: a request whose answer is read (never an opaque "the host exists" ping), with the
// viewer's own key where a service needs one. Keys travel in headers through the same functions the pages use;
// nothing secret is written to an address or the console.
//   The app      version here / version on the server (update button), offline cache, storage used
//   Connections  internet, Telegram (state, last sync), helper Worker, Real-Debrid (account, premium until)
//   Services     TMDb (key) or Cinemeta (no key), YouTube, Gemini, OpenSubtitles, AI subtitle server, radio, archive,
//                Dailymotion, the TV guide file
//   Content      films, series, channels, radio stations, favourites, history, users
//   Speed test   latency, jitter, download, upload (speed.cloudflare.com), live, with a verdict per use (speedtest.py)
(function (root) {
  // ------------------------------------------------------------ pure (speedtest.py; node: src/qa/web/t_services.js)
  const NEEDS = [['sd', 3], ['hd', 6], ['fhd', 12], ['uhd', 30], ['live', 8]];      // Mbps a stream of that kind needs
  const mbps = (bytes, secs) => (secs > 0 ? (bytes * 8 / 1e6) / secs : 0);
  function jitter(samples) {                     // mean absolute difference between consecutive latency samples
    if (!samples || samples.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < samples.length; i++) sum += Math.abs(samples[i] - samples[i - 1]);
    return sum / (samples.length - 1);
  }
  function verdict(down, pingMs) {               // [[use, 'ok' | 'weak' | 'no']]; high latency makes live TV borderline
    return NEEDS.map(([key, need]) => {
      let v = down >= need * 1.25 ? 'ok' : down >= need ? 'weak' : 'no';
      if (key === 'live' && v === 'ok' && pingMs > 150) v = 'weak';
      return [key, v];
    });
  }
  // the slowest samples are warm-up (DNS / TLS): drop two of them, as the build does
  const trimmed = (samples) => samples.slice().sort((a, b) => a - b).slice(0, Math.max(1, samples.length - 2));
  // the version a version.js text states ('' when none)
  const versionOf = (text) => { const m = /['"](\d+\.\d+\.\d+(?:\.\d+)?)['"]/.exec(String(text || '')); return m ? m[1] : ''; };
  function newer(a, b) {                         // is version a newer than b?
    const pa = String(a || '').split('.').map(Number), pb = String(b || '').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y; }
    return false;
  }
  const size = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? Math.round(n / 1048576) + ' MB' : Math.round((n || 0) / 1024) + ' KB');
  const core = {NEEDS, mbps, jitter, verdict, trimmed, versionOf, newer, size};
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }

  const TN = root.TN;
  if (!TN) return;
  root.TNStatus = core;
  TN.i18n.add({
    he: {st_g_app: 'האפליקציה', st_g_conn: 'חיבורים', st_g_svc: 'שירותים', st_g_content: 'תוכן', st_ver: 'גרסה', st_ver_same: 'מעודכנת (%s)', st_ver_new: 'יש גרסה חדשה: %s',
         st_ver_unknown: '%s (לא ניתן לבדוק מול השרת)', st_update: 'עדכון עכשיו', st_sw: 'מטמון לא מקוון', st_sw_on: 'פעיל - האתר נפתח גם בלי רשת', st_sw_off: 'לא פעיל (צריך https)',
         st_store: 'אחסון בדפדפן', st_store_of: '%s מתוך %s', st_net: 'אינטרנט', st_online: 'מחובר (%s ms)', st_offline: 'אין רשת', st_tg: 'טלגרם',
         st_tg_on: 'מחובר', st_tg_off: 'לא מחובר', st_tg_saved: 'שמור במכשיר, מתחבר...', st_sync_last: 'סנכרון אחרון %s', st_sync_nodoc: 'אין מסמך סנכרון בחשבון',
         st_sync_unreadable: 'מסמך הסנכרון לא נקרא', st_helper: 'עוזר (Worker)', st_rd: 'Real-Debrid', st_rd_user: '%s · פרימיום עד %s', st_rd_free: '%s · לא פרימיום',
         st_ok: 'תקין (%s ms)', st_fail: 'לא זמין', st_none: 'לא הוגדר', st_wait: 'בודק...', st_again: 'בדיקה חוזרת', st_key_bad: 'המפתח נדחה (%s)', st_key_ok: 'המפתח עובד',
         st_tmdb: 'TMDb', st_cine: 'Cinemeta (קטלוג בלי מפתח)', st_cine_note: 'אין מפתח TMDb: הקטלוג פועל דרך Cinemeta', st_yt: 'YouTube', st_yt_play: 'ניגון בלבד (אין מפתח או עוזר)', st_yt_helper: 'דרך העוזר',
         st_gem: 'Gemini', st_os: 'OpenSubtitles', st_srv: 'שרת כתוביות AI', st_radio: 'Radio Browser', st_ia: 'ארכיון האינטרנט', st_dm: 'Dailymotion', st_epg: 'מדריך שידורים',
         st_epg_date: 'עודכן %s', st_stations: '%s תחנות', st_items: '%s פריטים', st_movies: 'סרטים', st_series: 'סדרות', st_channels: 'ערוצי טלוויזיה (ישראל)', st_favs: 'מועדפים',
         st_hist: 'היסטוריה', st_users: 'משתמשים', st_need_key: 'צריך מפתח TMDb', st_fix: 'הגדרה', st_services: 'שירותים וחיבורים',
         st_speed: 'בדיקת מהירות', st_speed_go: 'התחלת הבדיקה', st_speed_stop: 'עצירה', st_speed_hint: 'זמן תגובה, ג\'יטר, הורדה והעלאה מול Cloudflare. הבדיקה מורידה עד 50MB.',
         st_ping: 'זמן תגובה', st_jitter: 'ג\'יטר', st_down: 'הורדה', st_up: 'העלאה', st_ms: '%s ms', st_mbps: '%s Mbps', st_speed_fail: 'אין חיבור לאינטרנט או שהבדיקה נכשלה',
         st_v_ok: 'מתאים', st_v_weak: 'גבולי', st_v_no: 'לא מספיק', st_u_sd: 'SD / רדיו', st_u_hd: 'HD (720p)', st_u_fhd: 'Full HD (1080p)', st_u_uhd: '4K', st_u_live: 'טלוויזיה חיה'},
    en: {st_g_app: 'The app', st_g_conn: 'Connections', st_g_svc: 'Services', st_g_content: 'Content', st_ver: 'Version', st_ver_same: 'Up to date (%s)', st_ver_new: 'A new version is out: %s',
         st_ver_unknown: '%s (could not check against the server)', st_update: 'Update now', st_sw: 'Offline cache', st_sw_on: 'Active - the site opens without a network too', st_sw_off: 'Not active (needs https)',
         st_store: 'Browser storage', st_store_of: '%s of %s', st_net: 'Internet', st_online: 'Online (%s ms)', st_offline: 'Offline', st_tg: 'Telegram',
         st_tg_on: 'Connected', st_tg_off: 'Not connected', st_tg_saved: 'Saved on this device, connecting...', st_sync_last: 'last sync %s', st_sync_nodoc: 'the account has no sync document',
         st_sync_unreadable: 'the sync document could not be read', st_helper: 'Helper (Worker)', st_rd: 'Real-Debrid', st_rd_user: '%s · premium until %s', st_rd_free: '%s · not premium',
         st_ok: 'OK (%s ms)', st_fail: 'Not reachable', st_none: 'Not set', st_wait: 'Checking...', st_again: 'Check again', st_key_bad: 'The key was refused (%s)', st_key_ok: 'The key works',
         st_tmdb: 'TMDb', st_cine: 'Cinemeta (key-less catalogue)', st_cine_note: 'No TMDb key: the catalogue runs on Cinemeta', st_yt: 'YouTube', st_yt_play: 'Playback only (no key, no helper)', st_yt_helper: 'Through the helper',
         st_gem: 'Gemini', st_os: 'OpenSubtitles', st_srv: 'AI subtitle server', st_radio: 'Radio Browser', st_ia: 'Internet Archive', st_dm: 'Dailymotion', st_epg: 'TV guide',
         st_epg_date: 'updated %s', st_stations: '%s stations', st_items: '%s items', st_movies: 'Movies', st_series: 'Series', st_channels: 'TV channels (Israel)', st_favs: 'Favourites',
         st_hist: 'History', st_users: 'Users', st_need_key: 'Needs a TMDb key', st_fix: 'Set up', st_services: 'Services and connections',
         st_speed: 'Speed test', st_speed_go: 'Start the test', st_speed_stop: 'Stop', st_speed_hint: 'Latency, jitter, download and upload against Cloudflare. The test downloads up to 50 MB.',
         st_ping: 'Latency', st_jitter: 'Jitter', st_down: 'Download', st_up: 'Upload', st_ms: '%s ms', st_mbps: '%s Mbps', st_speed_fail: 'No internet connection or the test failed',
         st_v_ok: 'good', st_v_weak: 'borderline', st_v_no: 'not enough', st_u_sd: 'SD / radio', st_u_hd: 'HD (720p)', st_u_fhd: 'Full HD (1080p)', st_u_uhd: '4K', st_u_live: 'Live TV'},
    ru: {st_g_app: 'Приложение', st_g_conn: 'Подключения', st_g_svc: 'Сервисы', st_g_content: 'Контент', st_ver: 'Версия', st_ver_same: 'Актуальная (%s)', st_ver_new: 'Вышла новая версия: %s',
         st_ver_unknown: '%s (не удалось сверить с сервером)', st_update: 'Обновить сейчас', st_sw: 'Офлайн-кэш', st_sw_on: 'Активен - сайт открывается и без сети', st_sw_off: 'Не активен (нужен https)',
         st_store: 'Хранилище браузера', st_store_of: '%s из %s', st_net: 'Интернет', st_online: 'В сети (%s мс)', st_offline: 'Нет сети', st_tg: 'Telegram',
         st_tg_on: 'Подключено', st_tg_off: 'Не подключено', st_tg_saved: 'Сохранено на устройстве, подключение...', st_sync_last: 'последняя синхронизация %s', st_sync_nodoc: 'в аккаунте нет документа синхронизации',
         st_sync_unreadable: 'документ синхронизации не прочитан', st_helper: 'Помощник (Worker)', st_rd: 'Real-Debrid', st_rd_user: '%s · премиум до %s', st_rd_free: '%s · не премиум',
         st_ok: 'OK (%s мс)', st_fail: 'Недоступно', st_none: 'Не задано', st_wait: 'Проверка...', st_again: 'Проверить снова', st_key_bad: 'Ключ отклонён (%s)', st_key_ok: 'Ключ работает',
         st_tmdb: 'TMDb', st_cine: 'Cinemeta (каталог без ключа)', st_cine_note: 'Нет ключа TMDb: каталог работает через Cinemeta', st_yt: 'YouTube', st_yt_play: 'Только воспроизведение (нет ключа и помощника)', st_yt_helper: 'Через помощник',
         st_gem: 'Gemini', st_os: 'OpenSubtitles', st_srv: 'Сервер ИИ-субтитров', st_radio: 'Radio Browser', st_ia: 'Интернет-архив', st_dm: 'Dailymotion', st_epg: 'Телепрограмма',
         st_epg_date: 'обновлена %s', st_stations: 'Станций: %s', st_items: 'Элементов: %s', st_movies: 'Фильмы', st_series: 'Сериалы', st_channels: 'Телеканалы (Израиль)', st_favs: 'Избранное',
         st_hist: 'История', st_users: 'Пользователи', st_need_key: 'Нужен ключ TMDb', st_fix: 'Настроить', st_services: 'Сервисы и подключения',
         st_speed: 'Тест скорости', st_speed_go: 'Начать тест', st_speed_stop: 'Стоп', st_speed_hint: 'Задержка, джиттер, загрузка и отдача через Cloudflare. Тест скачивает до 50 МБ.',
         st_ping: 'Задержка', st_jitter: 'Джиттер', st_down: 'Загрузка', st_up: 'Отдача', st_ms: '%s мс', st_mbps: '%s Мбит/с', st_speed_fail: 'Нет интернета или тест не удался',
         st_v_ok: 'подходит', st_v_weak: 'на грани', st_v_no: 'недостаточно', st_u_sd: 'SD / радио', st_u_hd: 'HD (720p)', st_u_fhd: 'Full HD (1080p)', st_u_uhd: '4K', st_u_live: 'Прямой эфир'},
  });
  const t = TN.t, S = TN.settings;
  const sval = (k) => String(S.get(k, '') || '').trim();
  const now = () => (root.performance && performance.now ? performance.now() : Date.now());
  const DOWN = 'https://speed.cloudflare.com/__down', UP = 'https://speed.cloudflare.com/__up';

  // a request with a time limit -> {r, ms}; throws on network failure / timeout
  async function timed(url, opt, ms) {
    const c = new AbortController(), timer = setTimeout(() => c.abort(), ms || 9000), t0 = now();
    try {
      const r = await fetch(url, Object.assign({cache: 'no-store', credentials: 'omit', signal: c.signal}, opt || {}));
      return {r, ms: Math.round(now() - t0)};
    } finally { clearTimeout(timer); }
  }
  // a JSON endpoint that answers browsers: ok only when the answer is read and looks right
  async function jsonCheck(url, good, opt) {
    const {r, ms} = await timed(url, opt);
    if (!r.ok) return {ok: false, text: t('st_key_bad', r.status)};
    const j = await r.json();
    const extra = good ? good(j) : '';
    if (extra === false) return {ok: false, text: t('st_fail')};
    return {ok: true, text: t('st_ok', ms) + (extra ? ' · ' + extra : '')};
  }
  const num = (n) => (TN.fmtNum ? TN.fmtNum(n) : Number(n || 0).toLocaleString());       // 6.5.1: in the app's language

  // ------------------------------------------------------------ the speed test
  async function speedTest(on, stopped) {
    const res = {ping: null, jitter: null, down: null, up: null};
    // latency: 8 tiny requests, the two slowest dropped
    const samples = [];
    for (let i = 0; i < 8 && !stopped(); i++) {
      const t0 = now();
      const r = await fetch(DOWN + '?bytes=0&r=' + i + Date.now(), {cache: 'no-store', credentials: 'omit'});
      await r.arrayBuffer();
      samples.push(now() - t0);
    }
    if (!samples.length) return res;
    const keep = trimmed(samples);
    res.ping = keep.reduce((a, b) => a + b, 0) / keep.length;
    res.jitter = jitter(keep);
    on(res);
    // download: growing sizes until one takes long enough to mean something (at most ~8 s in all)
    const tEnd = now() + 8000;
    for (const bytes of [1e6, 5e6, 2e7, 5e7]) {
      if (stopped() || now() > tEnd) break;
      const t0 = now();
      const r = await fetch(DOWN + '?bytes=' + bytes + '&r=' + Date.now(), {cache: 'no-store', credentials: 'omit'});
      if (!r.ok) break;
      let got = 0;
      if (r.body && r.body.getReader) {
        const rd = r.body.getReader();
        for (;;) {
          const x = await rd.read();
          if (x.done) break;
          got += x.value.length;
          const secs = (now() - t0) / 1000;
          if (secs > 0.3) { res.down = mbps(got, secs); on(res); }
          if (stopped()) { try { rd.cancel(); } catch (e) {} break; }
        }
      } else got = (await r.arrayBuffer()).byteLength;
      const secs = (now() - t0) / 1000;
      if (got > 0 && secs > 0) { res.down = mbps(got, secs); on(res); }
      if (secs > 2) break;                         // long enough: a bigger file would only take longer
    }
    // upload: growing bodies, the same way
    const tEnd2 = now() + 6000;
    for (const bytes of [2e5, 1e6, 4e6, 1e7]) {
      if (stopped() || now() > tEnd2) break;
      const body = new Uint8Array(bytes);
      const t0 = now();
      try {
        const r = await fetch(UP, {method: 'POST', body, cache: 'no-store', credentials: 'omit', headers: {'Content-Type': 'application/octet-stream'}});
        if (!r.ok) break;
        await r.text();
      } catch (e) { break; }
      const secs = (now() - t0) / 1000;
      res.up = mbps(bytes, secs); on(res);
      if (secs > 2) break;
    }
    return res;
  }

  // ------------------------------------------------------------ the page
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function line(list, name) {                    // -> set(text, ok: true | false | null, action?)
    const r = el('div', 'panel st_row');
    const v = el('span', 'tag st_dim', t('st_wait'));
    const acts = el('span', 'st_acts');
    r.append(el('b', '', name), v, acts);
    list.append(r);
    return (text, ok, action) => {
      v.textContent = text;
      v.className = 'tag' + (ok === true ? '' : ok === false ? ' st_bad' : ' st_dim');
      acts.textContent = '';
      if (action) acts.append(action.href ? Object.assign(el('a', 'btn ghost', action.label), {href: action.href}) : TN.button('btn ghost', action.label, action.onClick));
    };
  }
  const setup = () => ({label: t('st_fix'), href: '#/services'});

  async function pageStatus(arg, ctx) {
    TN.page('status', t('m_status'));
    const view = TN.view();
    if (!document.getElementById('st_css')) {
      const s = el('style'); s.id = 'st_css';
      s.textContent = '.st_list{display:grid;gap:8px;margin-top:10px;max-width:760px}.st_row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}' +
        '.st_row b{flex:1 1 180px}.st_dim{background:var(--panel2);color:var(--muted)}.st_bad{background:#8a1c1c;color:#fff}.st_h2{margin:22px 0 0;font-size:18px}' +
        '.st_acts:empty{display:none}.st_grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:12px 0}' +
        '.st_cell{background:var(--panel2);border-radius:10px;padding:10px 12px}.st_cell small{display:block;color:var(--muted)}.st_cell b{font-size:1.3em}' +
        '.st_bar{height:6px;border-radius:3px;background:var(--panel2);overflow:hidden;margin:8px 0}.st_bar i{display:block;height:100%;width:0;background:var(--accent);transition:width .3s}' +
        '.st_use{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}';
      document.head.append(s);
    }
    const group = (key) => { view.append(el('h2', 'st_h2', t(key))); const l = el('div', 'st_list'); view.append(l); return l; };
    const alive = () => ctx.current();
    const run = (set, fn) => fn().then((x) => { if (alive() && x) set(x.text, x.ok, x.action); }, () => { if (alive()) set(t('st_fail'), false); });
    const jobs = [];
    const synced = S.synced() || {};

    // ---------------- the app
    let list = group('st_g_app');
    const verSet = line(list, t('st_ver'));
    jobs.push(run(verSet, async () => {
      let srv = '';
      try { const {r} = await timed('version.js?_=' + Date.now(), {}, 6000); if (r.ok) srv = versionOf(await r.text()); } catch (e) {}
      if (!srv) return {ok: null, text: t('st_ver_unknown', TN.version)};
      if (!newer(srv, TN.version)) return {ok: true, text: t('st_ver_same', TN.version)};
      return {ok: false, text: t('st_ver_new', srv), action: {label: t('st_update'), onClick: async () => {
        const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration().catch(() => null);
        if (reg) await reg.update().catch(() => {});
        await TN.clearCaches().catch(() => {});
        location.reload();
      }}};
    }));
    const sw = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    line(list, t('st_sw'))(t(sw ? 'st_sw_on' : 'st_sw_off'), sw ? true : null);
    if (navigator.storage && navigator.storage.estimate) {
      const stSet = line(list, t('st_store'));
      jobs.push(run(stSet, async () => { const e = await navigator.storage.estimate(); return {ok: null, text: t('st_store_of', size(e.usage || 0), size(e.quota || 0))}; }));
    }

    // ---------------- connections
    list = group('st_g_conn');
    const netSet = line(list, t('st_net'));
    jobs.push(run(netSet, async () => {
      if (navigator.onLine === false) return {ok: false, text: t('st_offline')};
      try { const {r, ms} = await timed(DOWN + '?bytes=0&_=' + Date.now(), {}, 7000); await r.arrayBuffer(); return {ok: r.ok, text: r.ok ? t('st_online', ms) : t('st_fail')}; } catch (e) { return {ok: false, text: t('st_offline')}; }
    }));
    // Telegram: what tg.js says (nothing is started from here); a saved login finishes resuming a moment after the page opens
    const tgSet = line(list, t('st_tg'));
    const saved = !!(TN.get('tg_session', '') && TN.get('tg_api', null));
    const paintTg = () => {
      let tg = null;
      if (root.TG && root.TG.ready) { try { tg = root.TG.status(); } catch (e) {} }
      if (tg && tg.state === 'on') {
        const when = tg.last ? (TN.fmtTime ? TN.fmtTime(tg.last * (tg.last < 1e12 ? 1000 : 1)) : new Date(tg.last * (tg.last < 1e12 ? 1000 : 1)).toLocaleTimeString()) : '';
        const bad = tg.sync === 'nodoc' || tg.sync === 'unreadable';
        const extra = tg.sync === 'nodoc' ? t('st_sync_nodoc') : tg.sync === 'unreadable' ? t('st_sync_unreadable') : when ? t('st_sync_last', when) : '';
        tgSet([t('st_tg_on'), tg.name, extra].filter(Boolean).join(' · '), bad ? false : true, tg.sync === 'nodoc' ? {label: t('m_backup'), href: '#/backup'} : null);
        return true;
      }
      tgSet(saved ? t('st_tg_saved') : t('st_tg_off'), null, saved ? null : {label: t('st_fix'), href: '#/tglogin'});
      return false;
    };
    if (!paintTg() && saved) { let n = 0; const iv = setInterval(() => { if (!alive() || paintTg() || ++n > 10) clearInterval(iv); }, 1500); }
    const helper = S.helper();
    const hSet = line(list, t('st_helper'));
    if (!helper) hSet(t('st_none'), null, setup());
    else {
      jobs.push(run(hSet, async () => {
        if (!root.TNHelper) await TN.loadScript('helper.js');
        const t0 = now();
        const ok = await root.TNHelper.ping(helper);
        return {ok, text: ok ? t('st_ok', Math.round(now() - t0)) : t('st_fail'), action: ok ? null : setup()};
      }));
    }
    const rdSet = line(list, t('st_rd'));
    if (!TN.get('rd_token', '')) rdSet(t('st_none'), null, setup());
    else {
      jobs.push(run(rdSet, async () => {
        const R = await TN.provider('rd');
        if (!R || !R.user) return {ok: null, text: t('st_none')};
        try {
          const u = await R.user();
          const prem = u.type === 'premium';
          return {ok: prem, text: prem ? t('st_rd_user', u.username || '', String(u.expiration || '').slice(0, 10)) : t('st_rd_free', u.username || '')};
        } catch (e) { return {ok: false, text: String((e && e.message) || t('st_fail')).slice(0, 90), action: setup()}; }
      }));
    }

    // ---------------- services
    list = group('st_g_svc');
    const svc = await TN.provider('services').catch(() => null);
    const tests = (svc && svc.testers) || {};
    const keyLine = (name, key, tester, none) => {
      const set = line(list, name);
      if (!key) { set(none || t('st_none'), null, setup()); return; }
      if (!tester) { set(t('st_none'), null); return; }
      jobs.push(run(set, async () => { const t0 = now(); const r = await tester(key); return {ok: r.ok, text: r.ok ? t('st_key_ok') + ' · ' + t('st_ok', Math.round(now() - t0)) : r.text, action: r.ok ? null : setup()}; }));
    };
    if (!alive()) return;
    if (TN.hasTmdbKey()) keyLine(t('st_tmdb'), 'x', tests.tmdb);
    else {
      line(list, t('st_tmdb'))(t('st_cine_note'), null, setup());
      jobs.push(run(line(list, t('st_cine')), () => jsonCheck('https://v3-cinemeta.strem.io/manifest.json', (j) => (j && j.id ? '' : false))));
    }
    const ytSet = line(list, t('st_yt'));
    if (sval('yt_key') && tests.yt) jobs.push(run(ytSet, async () => { const r = await tests.yt(sval('yt_key')); return {ok: r.ok, text: r.ok ? t('st_key_ok') : r.text, action: r.ok ? null : setup()}; }));
    else if (helper) ytSet(t('st_yt_helper'), true);
    else ytSet(t('st_yt_play'), null, setup());
    keyLine(t('st_gem'), sval('gemini_key') || String(synced.gemini_key || '').trim(), tests.gemini);
    keyLine(t('st_os'), sval('subs_os_key') || String(synced.os_key || synced.opensubs_key || '').trim(), tests.os);
    keyLine(t('st_srv'), sval('subs_server_url'), tests.srv);
    jobs.push(run(line(list, t('st_radio')), () => jsonCheck('https://de1.api.radio-browser.info/json/stats', (j) => (j && j.stations ? t('st_stations', num(j.stations)) : false))));
    jobs.push(run(line(list, t('st_ia')), () => jsonCheck('https://archive.org/advancedsearch.php?q=mediatype%3Amovies+AND+collection%3Afeature_films&rows=0&output=json',
      (j) => (j && j.response ? t('st_items', num(j.response.numFound)) : false))));
    jobs.push(run(line(list, t('st_dm')), () => jsonCheck('https://api.dailymotion.com/videos?limit=1&fields=id', (j) => (j && Array.isArray(j.list) ? '' : false))));
    jobs.push(run(line(list, t('st_epg')), async () => {
      const {r} = await timed('data/epg_il.json', {method: 'HEAD', cache: 'no-cache'}, 8000);
      if (!r.ok) return {ok: false, text: t('st_fail')};
      const lm = r.headers.get('last-modified');
      const d = lm ? new Date(lm) : null;
      const old = d && Date.now() - d.getTime() > 3 * 864e5;
      return {ok: old ? false : true, text: d && !isNaN(d) ? t('st_epg_date', TN.fmtDate ? TN.fmtDate(d) : d.toLocaleString()) : t('st_ok', 0).replace(/\s*\(.*\)/, '')};
    }));

    // ---------------- content (H07 counts)
    list = group('st_g_content');
    for (const [key, path] of [['st_movies', '/discover/movie'], ['st_series', '/discover/tv']]) {
      const set = line(list, t(key));
      if (!TN.hasTmdbKey()) { set(t('st_need_key'), null, setup()); continue; }
      jobs.push(run(set, async () => { const d = await TN.tmdb(path); return {ok: d.total_results > 0, text: num(d.total_results)}; }));
    }
    jobs.push(run(line(list, t('st_channels')), async () => { const c = await TN.channels('tn'); return {ok: c.length > 0, text: num(c.length)}; }));
    line(list, t('st_favs'))(num((TN.store.favs() || []).length), null);
    line(list, t('st_hist'))(num((TN.store.history() || []).length), null);
    line(list, t('st_users'))(num(TN.store.users().filter((u) => u && !Number(u.deleted || 0)).length), null);

    const acts = el('div', 'links'); acts.style.marginTop = '14px';
    acts.append(TN.button('btn ghost', t('st_again'), () => TN.route()), Object.assign(el('a', 'btn ghost', t('st_services')), {href: '#/services'}));
    view.append(acts);

    // ---------------- speed test
    const sp = el('div', 'panel settings'); sp.style.marginTop = '18px'; sp.style.maxWidth = '760px';
    const grid = el('div', 'st_grid');
    const cells = {};
    for (const k of ['ping', 'jitter', 'down', 'up']) {
      const c = el('div', 'st_cell'); const b = el('b', '', '–');
      c.append(el('small', '', t('st_' + k)), b); grid.append(c); cells[k] = b;
    }
    const bar = el('div', 'st_bar'); const fill = el('i'); bar.append(fill);
    const uses = el('div', 'st_use');
    const msg = el('p', 'hint'); msg.setAttribute('role', 'status');
    let running = false, stop = false;
    const show = (r) => {
      if (r.ping != null) cells.ping.textContent = t('st_ms', Math.round(r.ping));
      if (r.jitter != null) cells.jitter.textContent = t('st_ms', r.jitter.toFixed(1));
      if (r.down != null) cells.down.textContent = t('st_mbps', r.down.toFixed(1));
      if (r.up != null) cells.up.textContent = t('st_mbps', r.up.toFixed(1));
      fill.style.width = (r.up != null ? 90 : r.down != null ? 60 : r.ping != null ? 20 : 5) + '%';
    };
    const go = TN.button('btn', t('st_speed_go'), async () => {
      if (running) { stop = true; return; }
      running = true; stop = false; go.textContent = t('st_speed_stop'); uses.textContent = ''; msg.textContent = t('st_wait');
      for (const k of Object.keys(cells)) cells[k].textContent = '–';
      fill.style.width = '5%';
      let r = null;
      try { r = await speedTest((x) => { if (alive()) show(x); }, () => stop || !alive()); } catch (e) { r = null; }
      running = false;
      if (!alive()) return;
      go.textContent = t('st_speed_go');
      fill.style.width = '100%';
      if (!r || r.down == null) { msg.textContent = t('st_speed_fail'); return; }
      msg.textContent = '';
      for (const [use, v] of verdict(r.down, r.ping || 0)) {
        uses.append(el('span', 'tag' + (v === 'ok' ? '' : v === 'weak' ? ' st_dim' : ' st_bad'), t('st_u_' + use) + ': ' + t('st_v_' + v)));
      }
    });
    sp.append(el('h2', '', t('st_speed')), el('p', 'hint', t('st_speed_hint')), go, bar, grid, uses, msg);
    view.append(sp);
    if (TN.params(arg).speed) go.click();
    await Promise.all(jobs);
  }
  TN.registerPage('status', pageStatus);
})(typeof self !== 'undefined' ? self : globalThis);
