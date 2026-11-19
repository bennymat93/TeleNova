'use strict';
// TeleNova web, WP-6: subtitles (plan row 37). Ports player_menus.py wizdom_search/wizdom_download + auto_subtitles.
//
// Providers (kind 'subs', the MODULES.md shape: find(q) -> [{label, lang, source, score, fetchVtt() -> string}]):
//   wizdom    Hebrew, wizdom.xyz (search + zip file both send ACAO *, checked 2026-11-17), helper as fallback
//   opensubs  OpenSubtitles REST with the viewer's key (browser setting subs_os_key, else the synced os_key /
//             opensubs_key). The key goes in the Api-Key header only.
//   yify      yifysubtitles.ch movie pages (ACAO *; the site can answer with a bot check: then the helper is used,
//             which needs the host added to the Worker's ALLOW_HOSTS)
//   ktuvit    ktuvit.me through the helper Worker + the viewer's ktuvit login (the password is never stored: only
//             the site's own hashed form and the login cookie, in this browser)
//   subsrv    the owner's AI subtitle server (NovaTV Subtitle Server on the PC, same /jobs API as service.py), only
//             when the browser setting subs_server_url (https only: a page on https cannot call http) is set and
//             q.url is a plain http(s) video address the PC can open itself
//   subs_ai   Gemini translation of the best English subtitle into the app language (synced gemini_key)
//
// Service 'subs' (const S = await TN.provider('subs')), for player.js (WP-5):
//   S.find(q)                 all providers, Hebrew/app language first, best release match first
//                             q = {type:'movie'|'tv', imdb, tmdb, title, year, season, episode, release, lang}
//   S.attach(video, vtt, {label, lang, select=true}) -> TextTrack   (a <track> with a blob: URL)
//   S.auto(video, q)          picks the best subtitle in the app language (else AI-translates English) and attaches it
//   S.setOffset(video, sec) / S.offset(video)     moves every cue of the showing track (positive = later)
//   S.style() / S.setStyle({size, color, bg})     ::cue appearance (browser settings subs_size/subs_color/subs_bg)
//   S.menu(video, q, {container})                 an in-player panel: list, offset slider, appearance, Ktuvit login
//   S.embedded(video, hls) / S.off(video, hls)    the file's own subtitle tracks (HLS renditions, MP4 text tracks)
//   S.auto(video, q, {hls, key, say})             the build's order: embedded track -> best human subtitle (text
//                                                 checked to really be in that language) -> AI; S.autoOn() = the switch
//   S.fromFile(file) -> {label, lang, vtt}        a subtitle file from this device (.srt / .vtt / .ass / .zip)
//   S.settingsPanel(el)                           the settings block: automatic, language, appearance + sample, source
//                                                 switches, subs_os_key, subs_server_url (+ test), Ktuvit login.
//                                                 Drawn on the Settings page when this file is loaded; services.js or
//                                                 app.js may call it directly: (await TN.provider('subs')).settingsPanel(el)
//   Browser settings: subs_auto, subs_lang, subs_size, subs_color, subs_bg, subs_os_key, subs_server_url;
//   TN.get('subs_offsets') remembers the offset per video key.
//   S.translate(srtOrCues, toLang, {signal, onProgress}) -> VTT
//   S.ktuvitLogin(email, password) / S.ktuvitLogout()
(function (G) {
  const TN = G.TN;
  const LANG3 = {he: 'heb', en: 'eng', ru: 'rus'};
  const LANG_NAME = {he: 'Hebrew', en: 'English', ru: 'Russian'};

  if (TN) TN.i18n.add({
    he: {subs_title: 'כתוביות', subs_none: 'לא נמצאו כתוביות.', subs_off: 'ללא כתוביות', subs_offset: 'סנכרון: %s שנ׳',
      subs_reset: 'איפוס', subs_size: 'גודל', subs_color: 'צבע', subs_bg: 'רקע', subs_loading: 'מחפש כתוביות…',
      subs_failed: 'טעינת הכתוביות נכשלה: %s', subs_ai: 'תרגום AI', subs_ai_run: 'מתרגם… %s%', subs_need_key: 'צריך מפתח %s',
      subs_need_helper: 'דורש את שרת העזר (Worker)', subs_ktuvit_login: 'כניסה לכתוביות (Ktuvit)', subs_email: 'דוא״ל',
      subs_password: 'סיסמה', subs_login: 'התחברות', subs_logout: 'התנתקות', subs_logged: 'מחובר ל-Ktuvit', subs_os_key: 'מפתח OpenSubtitles',
      subs_save: 'שמירה', subs_srv: 'שרת כתוביות AI (במחשב)', subs_srv_hint: 'כתובת https בלבד. השרת במחשב חייב להיות נגיש ב-https (למשל דרך Cloudflare Tunnel או Tailscale Funnel) - כתובת http://IP:8765 לא תעבוד מדף https.', subs_srv_bad: 'צריך כתובת https://', subs_srv_wait: 'שרת ה-AI מכין כתוביות… %s%', subs_loaded: 'נטענו כתוביות: %s', subs_close: 'סגירה',
      subs_auto: 'כתוביות אוטומטיות בתחילת ניגון', subs_lang: 'שפת כתוביות', subs_lang_app: 'שפת האפליקציה', subs_look: 'מראה הכתוביות',
      subs_sz_s: 'קטן', subs_sz_m: 'רגיל', subs_sz_l: 'גדול', subs_sz_xl: 'ענק', subs_c_white: 'לבן', subs_c_yellow: 'צהוב', subs_c_cyan: 'תכלת',
      subs_bg_none: 'בלי רקע', subs_bg_half: 'רקע שקוף למחצה', subs_bg_full: 'רקע שחור', subs_preview: 'כך ייראו הכתוביות', subs_settings: 'הגדרות כתוביות',
      subs_embedded: 'בתוך הקובץ', subs_srv_test: 'בדיקה', subs_srv_ok: 'השרת עונה', subs_srv_fail: 'השרת לא עונה', subs_saved: 'נשמר', subs_keys: 'חשבונות ומפתחות',
      subs_os_hint: 'מפתח API חינמי מ-opensubtitles.com (Consumers). נשמר בדפדפן הזה בלבד ונשלח רק בכותרת הבקשה.', subs_file: 'טעינת קובץ כתוביות מהמכשיר',
      subs_auto_found: 'כתוביות: %s', subs_auto_none: 'לא נמצאו כתוביות אוטומטיות', subs_wrong_lang: 'הקובץ אינו בשפה שסומנה', subs_synced_key: 'מפתח מסונכרן מהחשבון בשימוש',
      subs_clear: 'מחיקה', subs_src_on: 'מקורות כתוביות'},
    en: {subs_title: 'Subtitles', subs_none: 'No subtitles found.', subs_off: 'Subtitles off', subs_offset: 'Sync: %s s',
      subs_reset: 'Reset', subs_size: 'Size', subs_color: 'Color', subs_bg: 'Background', subs_loading: 'Looking for subtitles…',
      subs_failed: 'Could not load the subtitles: %s', subs_ai: 'AI translation', subs_ai_run: 'Translating… %s%', subs_need_key: 'Needs a %s key',
      subs_need_helper: 'Needs the helper (Worker)', subs_ktuvit_login: 'Subtitle login (Ktuvit)', subs_email: 'E-mail',
      subs_password: 'Password', subs_login: 'Log in', subs_logout: 'Log out', subs_logged: 'Logged in to Ktuvit', subs_os_key: 'OpenSubtitles key',
      subs_save: 'Save', subs_srv: 'AI subtitle server (PC)', subs_srv_hint: 'https address only. The server on the PC must be reachable over https (for example through Cloudflare Tunnel or Tailscale Funnel) - http://IP:8765 does not work from an https page.', subs_srv_bad: 'Needs an https:// address', subs_srv_wait: 'AI server preparing subtitles… %s%', subs_loaded: 'Subtitles loaded: %s', subs_close: 'Close',
      subs_auto: 'Automatic subtitles when playback starts', subs_lang: 'Subtitle language', subs_lang_app: 'App language', subs_look: 'Subtitle appearance',
      subs_sz_s: 'Small', subs_sz_m: 'Normal', subs_sz_l: 'Large', subs_sz_xl: 'Huge', subs_c_white: 'White', subs_c_yellow: 'Yellow', subs_c_cyan: 'Cyan',
      subs_bg_none: 'No background', subs_bg_half: 'Half-transparent background', subs_bg_full: 'Black background', subs_preview: 'This is how subtitles will look', subs_settings: 'Subtitle settings',
      subs_embedded: 'Inside the file', subs_srv_test: 'Test', subs_srv_ok: 'The server answers', subs_srv_fail: 'The server does not answer', subs_saved: 'Saved', subs_keys: 'Accounts and keys',
      subs_os_hint: 'A free API key from opensubtitles.com (Consumers). Kept in this browser only and sent only in the request header.', subs_file: 'Load a subtitle file from this device',
      subs_auto_found: 'Subtitles: %s', subs_auto_none: 'No automatic subtitles found', subs_wrong_lang: 'The file is not in the language it is labelled as', subs_synced_key: 'Using the key synced from the account',
      subs_clear: 'Remove', subs_src_on: 'Subtitle sources'},
    ru: {subs_title: 'Субтитры', subs_none: 'Субтитры не найдены.', subs_off: 'Без субтитров', subs_offset: 'Сдвиг: %s с',
      subs_reset: 'Сброс', subs_size: 'Размер', subs_color: 'Цвет', subs_bg: 'Фон', subs_loading: 'Ищем субтитры…',
      subs_failed: 'Не удалось загрузить субтитры: %s', subs_ai: 'Перевод ИИ', subs_ai_run: 'Перевод… %s%', subs_need_key: 'Нужен ключ %s',
      subs_need_helper: 'Нужен помощник (Worker)', subs_ktuvit_login: 'Вход для субтитров (Ktuvit)', subs_email: 'Эл. почта',
      subs_password: 'Пароль', subs_login: 'Войти', subs_logout: 'Выйти', subs_logged: 'Вход в Ktuvit выполнен', subs_os_key: 'Ключ OpenSubtitles',
      subs_save: 'Сохранить', subs_srv: 'Сервер ИИ-субтитров (ПК)', subs_srv_hint: 'Только адрес https. Сервер на ПК должен быть доступен по https (например через Cloudflare Tunnel или Tailscale Funnel) - http://IP:8765 со страницы https не работает.', subs_srv_bad: 'Нужен адрес https://', subs_srv_wait: 'Сервер ИИ готовит субтитры… %s%', subs_loaded: 'Субтитры загружены: %s', subs_close: 'Закрыть',
      subs_auto: 'Автоматические субтитры при запуске', subs_lang: 'Язык субтитров', subs_lang_app: 'Язык приложения', subs_look: 'Вид субтитров',
      subs_sz_s: 'Мелкий', subs_sz_m: 'Обычный', subs_sz_l: 'Крупный', subs_sz_xl: 'Огромный', subs_c_white: 'Белый', subs_c_yellow: 'Жёлтый', subs_c_cyan: 'Голубой',
      subs_bg_none: 'Без фона', subs_bg_half: 'Полупрозрачный фон', subs_bg_full: 'Чёрный фон', subs_preview: 'Так будут выглядеть субтитры', subs_settings: 'Настройки субтитров',
      subs_embedded: 'Внутри файла', subs_srv_test: 'Проверить', subs_srv_ok: 'Сервер отвечает', subs_srv_fail: 'Сервер не отвечает', subs_saved: 'Сохранено', subs_keys: 'Аккаунты и ключи',
      subs_os_hint: 'Бесплатный API-ключ с opensubtitles.com (Consumers). Хранится только в этом браузере и отправляется только в заголовке запроса.', subs_file: 'Загрузить файл субтитров с устройства',
      subs_auto_found: 'Субтитры: %s', subs_auto_none: 'Автоматические субтитры не найдены', subs_wrong_lang: 'Файл не на том языке, который указан', subs_synced_key: 'Используется ключ, синхронизированный с аккаунтом',
      subs_clear: 'Удалить', subs_src_on: 'Источники субтитров'},
  });

  const t = (k, ...a) => (TN ? TN.t(k, ...a) : k);
  const appLang = () => (TN ? TN.lang() : 'he');
  const synced = () => (TN && TN.settings.synced ? TN.settings.synced() || {} : {});
  const getS = (k, d) => (TN ? TN.settings.get(k, d) : d);
  // the language subtitles are wanted in: the viewer's choice (browser setting subs_lang), else the app language
  const prefLang = () => { const v = String(getS('subs_lang', '') || ''); return LANG3[v] ? v : appLang(); };

  async function srt() {
    if (G.TNSrt) return G.TNSrt;
    await TN.load('srt');
    return G.TNSrt;
  }
  // every network call goes through here: TNHelper when present (CORS fallback to the Worker), else fetch
  const S = {};
  S._fetch = async function (url, opts) {
    opts = opts || {};
    if (!G.TNHelper && TN) { try { await TN.loadScript('helper.js'); } catch (e) { /* plain fetch below */ } }
    if (G.TNHelper) return G.TNHelper.fetch(url, opts);
    return fetch(url, {method: opts.method || 'GET', headers: opts.headers, body: opts.body, signal: opts.signal, credentials: 'omit'});
  };
  const errMsg = (e) => {
    const c = e && e.code;
    if (c === 'needs_helper' || c === 'helper_refused') return t('subs_need_helper');
    return String((e && e.message) || e || '').replace(/key=[^&\s]+/gi, 'key=***').slice(0, 120);
  };

  async function bytesToText(buf, lang) {
    const T = await srt();
    let b = new Uint8Array(buf);
    if (T.isZip(b)) {
      const f = T.pickFile(await T.unzip(b));
      if (!f) throw new Error('no subtitle in the zip');
      b = f.bytes;
    }
    return T.decode(b, lang);
  }
  async function toVttText(buf, lang) {
    const T = await srt();
    const text = await bytesToText(buf, lang);
    const cues = T.repair ? T.repair(T.parse(text)) : T.parse(text);
    if (!cues.length) throw new Error('empty subtitle');
    return T.toVtt(cues);
  }
  function memo(fn) { let p = null; return () => (p = p || fn().catch((e) => { p = null; throw e; })); }

  async function imdbOf(q) {
    if (q.imdb) return String(q.imdb).startsWith('tt') ? q.imdb : 'tt' + q.imdb;
    if (!q.tmdb || !TN || !TN.tmdb) return '';
    try {
      const kind = q.type === 'tv' || q.episode ? 'tv' : 'movie';
      return (await TN.tmdb(`/${kind}/${q.tmdb}/external_ids`)).imdb_id || '';
    } catch (e) { return ''; }
  }

  // ------------------------------------------------------------ Wizdom (Hebrew)
  const wizdom = {
    kinds: ['subs'], label: 'Wizdom', langs: ['he'],
    async find(q) {
      const imdb = await imdbOf(q);
      if (!imdb) return [];
      const p = new URLSearchParams({action: 'by_id', imdb});
      if (q.episode) { p.set('season', q.season || 1); p.set('episode', q.episode); }
      const r = await S._fetch('https://wizdom.xyz/api/search?' + p, {timeout: 15000});
      if (!r.ok) throw new Error('Wizdom ' + r.status);
      const list = (await r.json()) || [];
      const T = await srt();
      return list.filter((x) => x && x.id).map((x) => ({
        label: x.versioname || ('Wizdom ' + x.id), lang: 'he', source: 'wizdom',
        score: T.releaseScore(q.release || q.title, x.versioname || ''),
        fetchVtt: memo(async () => {
          const f = await S._fetch('https://wizdom.xyz/api/files/sub/' + encodeURIComponent(x.id), {timeout: 30000});
          if (!f.ok) throw new Error('Wizdom ' + f.status);
          return toVttText(await f.arrayBuffer(), 'he');
        }),
      }));
    },
  };

  // ------------------------------------------------------------ OpenSubtitles (viewer's API key)
  const OS = 'https://api.opensubtitles.com/api/v1';
  const osKey = () => String(getS('subs_os_key', '') || synced().os_key || synced().opensubs_key || '').trim();
  const osHeaders = () => ({'Api-Key': osKey(), 'X-User-Agent': 'TeleNova v' + ((TN && TN.version) || '1'), Accept: 'application/json'});
  const opensubs = {
    kinds: ['subs'], label: 'OpenSubtitles', langs: ['he', 'en', 'ru'],
    enabled: () => !!osKey(),
    async find(q) {
      if (!osKey()) return [];
      const imdb = await imdbOf(q);
      if (!imdb) return [];
      const langs = [...new Set([q.lang || prefLang(), 'he', 'en'])].join(',');
      const p = new URLSearchParams({languages: langs});
      if (q.episode) { p.set('parent_imdb_id', String(parseInt(imdb.slice(2), 10))); p.set('season_number', q.season || 1); p.set('episode_number', q.episode); }
      else p.set('imdb_id', String(parseInt(imdb.slice(2), 10)));
      const r = await S._fetch(OS + '/subtitles?' + p, {headers: osHeaders(), timeout: 15000});
      if (!r.ok) throw new Error('OpenSubtitles ' + r.status);
      const j = await r.json();
      const T = await srt();
      const out = [];
      for (const it of (j && j.data) || []) {
        const a = it.attributes || {};
        const file = (a.files || [])[0];
        if (!file || !file.file_id) continue;
        const lang = String(a.language || '').slice(0, 2).toLowerCase();
        out.push({
          label: a.release || file.file_name || 'OpenSubtitles', lang: lang === 'iw' ? 'he' : lang, source: 'opensubs',
          score: T.releaseScore(q.release || q.title, a.release || '') + Math.min(0.2, (a.download_count || 0) / 1e6),
          fetchVtt: memo(async () => {
            const d = await S._fetch(OS + '/download', {method: 'POST', timeout: 15000,
              headers: Object.assign({'Content-Type': 'application/json'}, osHeaders()), body: JSON.stringify({file_id: file.file_id})});
            if (!d.ok) throw new Error('OpenSubtitles ' + d.status);
            const link = (await d.json()).link;
            if (!link) throw new Error('OpenSubtitles: no link');
            const f = await S._fetch(link, {timeout: 30000});
            if (!f.ok) throw new Error('OpenSubtitles ' + f.status);
            return toVttText(await f.arrayBuffer(), lang);
          }),
        });
      }
      return out;
    },
  };

  // ------------------------------------------------------------ YIFY (movies only)
  const YIFY = 'https://yifysubtitles.ch';
  const YIFY_LANG = {Hebrew: 'he', English: 'en', Russian: 'ru'};
  function parseYify(html) {
    const rows = [];
    const re = /<tr data-id="(\d+)"[\s\S]*?<span class="sub-lang">([^<]+)<\/span>[\s\S]*?<a href="(\/subtitles\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/tr>/g;
    let m;
    while ((m = re.exec(html))) {
      const rating = Number((/<span class="label[^"]*">(-?\d+)/.exec(m[0]) || [])[1] || 0);
      rows.push({id: m[1], lang: YIFY_LANG[m[2].trim()] || '', page: m[3],
        name: m[4].replace(/<[^>]*>/g, ' ').replace(/^\s*subtitle\s+/i, '').replace(/\s+/g, ' ').trim(), rating});
    }
    return rows;
  }
  const yify = {
    kinds: ['subs'], label: 'YIFY', langs: ['he', 'en', 'ru'],
    async find(q) {
      if (q.episode || q.type === 'tv') return [];
      const imdb = await imdbOf(q);
      if (!imdb) return [];
      const r = await S._fetch(YIFY + '/movie-imdb/' + imdb, {timeout: 15000});
      if (!r.ok) throw new Error('YIFY ' + r.status);
      const want = new Set([q.lang || prefLang(), 'he', 'en']);
      return parseYify(await r.text()).filter((x) => want.has(x.lang)).map((x) => ({
        label: (x.name || 'YIFY').slice(0, 90), lang: x.lang, source: 'yify', score: Math.min(0.3, x.rating / 100),
        fetchVtt: memo(async () => {
          // /subtitles/<slug> -> /subtitle/<slug>.zip (the page's own download link)
          const zip = YIFY + x.page.replace(/^\/subtitles\//, '/subtitle/') + '.zip';
          const f = await S._fetch(zip, {timeout: 30000});
          if (!f.ok) throw new Error('YIFY ' + f.status);
          return toVttText(await f.arrayBuffer(), x.lang);
        }),
      }));
    },
  };

  // ------------------------------------------------------------ Ktuvit (helper Worker + viewer login)
  const KT = 'https://www.ktuvit.me';
  const KT_SALT = 'C8928DC731EC4E30AE6C523A34BE353A';     // the site's inline `var encryptionSalt` (ktuvitauth.py)
  const ktGet = () => (TN ? TN.get('subs_ktuvit', null) : null);
  // CryptoJS.enc.Hex.parse(email) with JS parseInt leniency (ktuvitauth._js_hex_iv)
  function ktIv(email) {
    const words = [0, 0, 0, 0];
    for (let j = 0; j < Math.min(email.length, 32); j += 2) {
      const v = parseInt(email.substr(j, 2), 16);
      if (isNaN(v)) continue;
      words[j >> 3] = (words[j >> 3] | (v << (24 - (j % 8) * 4))) >>> 0;
    }
    const iv = new Uint8Array(16);
    words.forEach((w, i) => { iv[i * 4] = w >>> 24; iv[i * 4 + 1] = (w >>> 16) & 255; iv[i * 4 + 2] = (w >>> 8) & 255; iv[i * 4 + 3] = w & 255; });
    return iv;
  }
  async function ktEncode(email, password) {
    const enc = new TextEncoder(), cs = G.crypto.subtle;
    const base = await cs.importKey('raw', enc.encode(KT_SALT), 'PBKDF2', false, ['deriveKey']);
    const key = await cs.deriveKey({name: 'PBKDF2', hash: 'SHA-1', salt: enc.encode(email), iterations: 3000}, base,
      {name: 'AES-CBC', length: 128}, false, ['encrypt']);
    const ct = await cs.encrypt({name: 'AES-CBC', iv: ktIv(email)}, key, enc.encode(password));
    const h = new Uint8Array(await cs.digest('SHA-256', ct));
    let s = '';
    h.forEach((c) => { s += String.fromCharCode(c); });
    return btoa(s);
  }
  async function ktPost(path, request, cookie) {
    const r = await S._fetch(KT + path, {method: 'POST', via: 'helper', cookie, timeout: 20000,
      headers: {'Content-Type': 'application/json', Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest'},
      body: JSON.stringify({request})});
    if (!r.ok) throw new Error('Ktuvit ' + r.status);
    let d = (await r.clone().json()).d;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { /* plain string */ } }
    return {d, setCookie: r.headers.get('x-tn-set-cookie') || ''};
  }
  S.ktuvitLogin = async function (email, password) {
    const encoded = await ktEncode(email, password);
    const {d, setCookie} = await ktPost('/Services/MembershipService.svc/Login', {Email: email, Password: encoded});
    if (!d || !d.IsSuccess) throw new Error(String((d && d.ErrorMessage) || 'login refused').slice(0, 120));
    if (!/(^|;\s*)Login=/.test(setCookie)) throw new Error('no login cookie');
    TN.put('subs_ktuvit', {email, cookie: setCookie});     // the cookie only; the password is not kept
    return true;
  };
  S.ktuvitLogout = () => TN.drop('subs_ktuvit');
  S.ktuvitLogged = () => !!(ktGet() && ktGet().cookie);
  function parseKtuvitRows(html) {
    const rows = [];
    const re = /<tr[\s\S]*?<\/tr>/g;
    let m;
    while ((m = re.exec(html))) {
      const id = (/data-subtitle-id="([^"]+)"/.exec(m[0]) || [])[1];
      if (!id) continue;
      const name = ((/<div[^>]*font-weight:\s*bold[^>]*>([\s\S]*?)<(?:br|\/div)/i.exec(m[0]) || [])[1] || '')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      rows.push({id, name});
    }
    return rows;
  }
  const ktuvit = {
    kinds: ['subs'], label: 'Ktuvit', langs: ['he'],
    enabled: () => S.ktuvitLogged(),
    async find(q) {
      const acc = ktGet();
      if (!acc || !acc.cookie || !q.title) return [];
      const imdb = await imdbOf(q);
      const {d} = await ktPost('/Services/ContentProvider.svc/SearchPage_search', {FilmName: q.title, Actors: [], Studios: null,
        Directors: [], Genres: [], Countries: [], Languages: [], Year: q.year ? String(q.year) : '', Rating: [], Page: 1,
        SearchType: q.episode ? '1' : '0', WithSubsOnly: false}, acc.cookie);
      const films = (d && d.Films) || [];
      const film = films.find((f) => imdb && String(f.IMDB_Link || '').replace(/\/+$/, '').endsWith(imdb)) ||
        films.find((f) => String(f.EngName || '').toLowerCase() === String(q.title).toLowerCase());
      if (!film) return [];
      const url = q.episode
        ? `${KT}/Services/GetModuleAjax.ashx?moduletype=episode&seriesID=${encodeURIComponent(film.ID)}&season=${q.season || 1}&episode=${q.episode}`
        : `${KT}/MovieInfo.aspx?ID=${encodeURIComponent(film.ID)}`;
      const r = await S._fetch(url, {via: 'helper', cookie: acc.cookie, timeout: 20000});
      if (!r.ok) throw new Error('Ktuvit ' + r.status);
      const T = await srt();
      return parseKtuvitRows(await r.text()).map((x) => ({
        label: x.name || 'Ktuvit', lang: 'he', source: 'ktuvit', score: T.releaseScore(q.release || q.title, x.name) + 0.05,
        fetchVtt: memo(async () => {
          const {d: dl} = await ktPost('/Services/ContentProvider.svc/RequestSubtitleDownload',
            {FilmID: film.ID, SubtitleID: x.id, FontSize: 0, FontColor: '', PredefinedLayout: -1}, acc.cookie);
          const ident = dl && dl.DownloadIdentifier;
          if (!ident) throw new Error('Ktuvit: no download');
          const f = await S._fetch(`${KT}/Services/DownloadFile.ashx?DownloadIdentifier=${encodeURIComponent(ident)}`,
            {via: 'helper', cookie: acc.cookie, timeout: 30000});
          if (!f.ok) throw new Error('Ktuvit ' + f.status);
          return toVttText(await f.arrayBuffer(), 'he');
        }),
      }));
    },
  };

  // ------------------------------------------------------------ Gemini translation (gemini.py-style, the synced key)
  const geminiKey = () => String((S._geminiKey ? S._geminiKey() : synced().gemini_key) || '').trim();   // _geminiKey: tests
  S.translate = async function (input, toLang, opts) {
    opts = opts || {};
    const key = geminiKey();
    if (!key) throw new Error(t('subs_need_key', 'Gemini'));
    const T = await srt();
    const cues = typeof input === 'string' ? T.parse(input) : input;
    const target = LANG_NAME[toLang || appLang()] || 'Hebrew';
    const out = [];
    const CHUNK = 80;
    const models = [synced().gemini_model, 'gemini-flash-lite-latest', 'gemini-flash-latest'].filter(Boolean);
    for (let i = 0; i < cues.length; i += CHUNK) {
      const part = cues.slice(i, i + CHUNK);
      const lines = part.map((c) => c.text.replace(/\n/g, ' ¶ '));
      const prompt = `Translate these movie subtitle lines into natural, short ${target}. Keep the order and the count ` +
        `(${lines.length}); keep the ¶ line breaks. Return JSON {"lines": [string, ...]} only.\n` + JSON.stringify(lines);
      let done = null, last = null;
      for (const model of models) {
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST', signal: opts.signal, credentials: 'omit',
            headers: {'Content-Type': 'application/json', 'x-goog-api-key': key},
            body: JSON.stringify({contents: [{role: 'user', parts: [{text: prompt}]}],
              generationConfig: {responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 8192}})});
          if (!r.ok) { last = new Error('Gemini ' + r.status); continue; }
          const j = await r.json();
          const txt = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text || '').join('');
          const data = JSON.parse(txt.replace(/^```(?:json)?|```$/g, '').trim());
          const arr = Array.isArray(data) ? data : (data && data.lines) || [];
          if (arr.length !== lines.length) { last = new Error('Gemini: line count'); continue; }
          done = arr;
          break;
        } catch (e) { if (e.name === 'AbortError') throw e; last = e; }
      }
      if (!done) throw new Error(String((last && last.message) || 'Gemini').replace(/key=[^&\s]+/gi, 'key=***'));
      part.forEach((c, k) => out.push({start: c.start, end: c.end, text: T.cleanText(String(done[k] || '').replace(/\s*¶\s*/g, '\n'))}));
      if (opts.onProgress) opts.onProgress(Math.round(Math.min(1, (i + CHUNK) / cues.length) * 100));
    }
    return T.toVtt(out);
  };
  const subsAi = {
    kinds: ['subs'], label: 'AI', langs: ['he', 'ru', 'en'],
    enabled: () => !!geminiKey(),
    // returns one entry built on the best English candidate other providers found (S.find adds it)
    fromEnglish(en, lang) {
      return {label: t('subs_ai') + ' · ' + en.label, lang, source: 'subs_ai', score: -1,
        fetchVtt: memo(async () => S.translate(await en.fetchVtt(), lang, {onProgress: (p) => subsAi.onProgress && subsAi.onProgress(p)})),
      };
    },
    async find() { return []; },
  };

  // ------------------------------------------------------------ the owner's AI subtitle server (service.py /jobs API)
  const srvUrl = () => {
    const v = String(getS('subs_server_url', '') || '').trim().replace(/\/+$/, '');
    try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.search ? u.origin + u.pathname.replace(/\/+$/, '') : ''; }
    catch (e) { return ''; }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 5.2.2: the owner's server over https with nothing to set up. The PC opens a tunnel and stores its current address
  // and access token in the helper Worker; the site asks the helper (GET /ai). Kept 10 minutes; asked again after a
  // failure, because the free tunnel gets a new address whenever the PC restarts.
  const BUILTIN_HELPER = 'https://telenova-helper.hmi-analyzer.workers.dev';
  let srvAuto = null, srvAutoAt = 0, srvAutoP = null;
  async function srvLookup(force) {
    if (srvUrl()) return {url: srvUrl(), token: ''};          // an address the viewer typed wins
    if (!force && srvAuto && Date.now() - srvAutoAt < 600000) return srvAuto;
    if (!srvAutoP) {
      srvAutoP = (async () => {
        const bases = [];
        try { const h = TN && TN.settings && TN.settings.helper && TN.settings.helper(); if (h && !/\.invalid(\/|$)/.test(h)) bases.push(h); } catch (e) { /* no setting */ }
        if (!bases.includes(BUILTIN_HELPER)) bases.push(BUILTIN_HELPER);
        for (const b of bases) {
          try {
            const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 8000);
            const r = await fetch(b.replace(/\/+$/, '') + '/ai', {signal: ctl.signal, cache: 'no-store'});
            clearTimeout(tm);
            if (!r.ok) continue;
            const j = await r.json();
            if (j && /^https:\/\/[a-z0-9.-]+$/i.test(String(j.url)) && /^[\w-]{20,80}$/.test(String(j.token))) return {url: String(j.url), token: String(j.token)};
          } catch (e) { /* the next address */ }
        }
        return null;
      })();
    }
    try { srvAuto = await srvAutoP; srvAutoAt = Date.now(); } finally { srvAutoP = null; }
    return srvAuto;
  }
  const subsrv = {
    kinds: ['subs'], label: 'AI server', langs: ['he'],
    enabled: () => true,                         // its address comes from the setting or from the helper, at use
    lookup: srvLookup,
    async find(q) {
      if (!/^https:\/\//i.test(String(q.url || ''))) return [];      // the server reads the video itself: it needs a public address
      const srv = await srvLookup(false);
      const base = srv && srv.url;
      if (!base) return [];
      const job = {url: q.url, title: q.title || '', season: q.season || 0, episode: q.episode || 0, imdb: q.imdb || '',
        tmdb: q.tmdb || '', position: Number(q.position) || 0, mode: 'ai'};
      if (q.youtube_id) job.youtube_id = q.youtube_id;
      const gk = geminiKey();
      if (gk) job.gemini_key = gk;                 // request body only, as Kodi sends it; never in the address
      return [{
        label: 'BN AI', lang: 'he', source: 'subsrv', score: -0.5,
        fetchVtt: memo(async () => {
          const opt = (m, b) => ({method: m, via: 'direct', timeout: 20000, body: b ? JSON.stringify(b) : undefined,
            headers: Object.assign({}, b ? {'Content-Type': 'application/json'} : {}, srv.token ? {'X-BN-Token': srv.token} : {})});
          let r;
          try { r = await S._fetch(base + '/jobs', opt('POST', job)); }
          catch (e) { srvAutoAt = 0; throw new Error('AI server: no answer (is the PC on?)'); }     // the address may have changed: asked again next time
          if (r.status === 401 || r.status >= 500) srvAutoAt = 0;
          if (!r.ok) throw new Error('AI server ' + r.status);
          const id = String(((await r.json()) || {}).id || '');
          if (!/^[\w-]{1,80}$/.test(id)) throw new Error('AI server: no job');
          const until = Date.now() + 15 * 60000;
          while (Date.now() < until) {
            r = await S._fetch(`${base}/jobs/${id}?pos=${Math.round(Number(q.position) || 0)}`, opt('GET'));
            if (!r.ok) throw new Error('AI server ' + r.status);
            const st = (await r.json()) || {};
            if (subsrv.onProgress) subsrv.onProgress(Number(st.progress) || 0);
            if (st.state === 'error') throw new Error('AI server: ' + String(st.stage || 'error').slice(0, 60));
            if (st.state === 'done' || Number(st.ready_until) > 0) {
              const f = await S._fetch(`${base}/jobs/${id}/srt`, Object.assign(opt('GET'), {timeout: 30000}));
              if (!f.ok) throw new Error('AI server ' + f.status);
              const buf = await f.arrayBuffer();
              if (new TextDecoder().decode(buf).includes('-->')) return toVttText(buf, 'he');
              if (st.state === 'done') throw new Error('AI server: empty');
            }
            await sleep(S._pollMs || 5000);
          }
          throw new Error('AI server: timeout');
        }),
      }];
    },
  };

  // ------------------------------------------------------------ aggregate
  const SOURCES = {wizdom, ktuvit, opensubs, yify, subsrv};
  S.find = async function (q, opts) {
    q = Object.assign({}, q);
    if (TN && TN.providerOn && !TN.providerOn('subs')) return [];      // the Library switch "subtitles"
    q.imdb = await imdbOf(q);
    const lang = q.lang || prefLang();
    q.lang = lang;
    const on = (n) => (TN ? TN.providerOn(n) : true) && (!SOURCES[n].enabled || SOURCES[n].enabled());
    const errors = {};
    const lists = await Promise.all(Object.keys(SOURCES).filter(on).map((n) =>
      SOURCES[n].find(q).catch((e) => { errors[n] = errMsg(e); return []; })));
    let all = [].concat(...lists);
    const rank = (x) => (x.lang === lang ? 0 : x.lang === 'he' ? 1 : x.lang === 'en' ? 2 : 3);
    all.sort((a, b) => rank(a) - rank(b) || b.score - a.score);
    if (!all.some((x) => x.lang === lang) && lang !== 'en' && (TN ? TN.providerOn('subs_ai') : true) && subsAi.enabled()) {
      const en = all.find((x) => x.lang === 'en');
      if (en) all.push(subsAi.fromEnglish(en, lang));
    }
    if (opts && opts.errors) Object.assign(opts.errors, errors);
    return all;
  };

  // ------------------------------------------------------------ tracks on a <video>
  const state = new WeakMap();      // video -> {track, el, url, cues: [{cue, start, end}], offset}
  S.attach = function (video, vtt, opts) {
    opts = opts || {};
    S.detach(video);
    const url = URL.createObjectURL(new Blob([vtt], {type: 'text/vtt'}));
    const el = document.createElement('track');
    el.kind = 'subtitles'; el.label = opts.label || 'TeleNova'; el.srclang = opts.lang || 'he'; el.src = url;
    el.dataset.tn = 'subs';
    video.appendChild(el);
    const st = {el, url, track: el.track, cues: null, offset: 0, label: el.label, lang: el.srclang, key: String(opts.key || ''), source: opts.source || ''};
    state.set(video, st);
    const tl = video.textTracks || [];
    for (let i = 0; i < tl.length; i++) if (tl[i] !== el.track) tl[i].mode = 'disabled';
    el.track.mode = opts.select === false ? 'hidden' : 'showing';
    // every video starts clean (Kodi: forget_file_settings); only this video's own remembered offset comes back
    const keep = st.key ? Number((offsets()[st.key] || {}).o) || 0 : 0;
    st.offset = keep;
    el.addEventListener('load', () => { st.cues = null; if (st.offset) S.setOffset(video, st.offset); }, {once: true});
    applyStyle();
    return el.track;
  };
  // remembered subtitle offsets, per video key (sub_offsets.json of the build): {key: {o: seconds, at: ms}}, 200 newest
  function offsets() { return (TN && TN.get('subs_offsets', {})) || {}; }
  function rememberOffset(key, sec) {
    if (!TN || !key) return;
    const all = offsets();
    if (sec) all[key] = {o: sec, at: Date.now()}; else delete all[key];
    const ks = Object.keys(all);
    if (ks.length > 200) ks.sort((a, b) => all[a].at - all[b].at).slice(0, ks.length - 200).forEach((k) => delete all[k]);
    TN.put('subs_offsets', all);
  }
  // subtitle tracks that came with the video itself (HLS renditions, MP4 text tracks where the browser shows them):
  // [{label, lang, on, select()}]. hls = the hls.js object when one plays the stream.
  S.embedded = function (video, hls) {
    const out = [];
    const mine = state.get(video);
    if (hls && hls.subtitleTracks && hls.subtitleTracks.length) {
      hls.subtitleTracks.forEach((tr, i) => out.push({label: tr.name || tr.lang || 'Track ' + (i + 1), lang: String(tr.lang || '').slice(0, 2).toLowerCase(), embedded: true,
        on: hls.subtitleTrack === i && hls.subtitleDisplay !== false,
        select() { S.detach(video); hls.subtitleDisplay = true; hls.subtitleTrack = i; }}));
      return out;
    }
    const tl = (video && video.textTracks) || [];
    for (let i = 0; i < tl.length; i++) {
      const tr = tl[i];
      if ((mine && tr === mine.track) || !/^(subtitles|captions)$/.test(tr.kind)) continue;
      out.push({label: tr.label || tr.language || 'Track ' + (i + 1), lang: String(tr.language || '').slice(0, 2).toLowerCase().replace('iw', 'he'), embedded: true,
        on: tr.mode === 'showing',
        select() { S.detach(video); for (let j = 0; j < tl.length; j++) tl[j].mode = tl[j] === tr ? 'showing' : 'disabled'; }});
    }
    return out;
  };
  // no subtitle at all: ours removed, the file's own tracks hidden
  S.off = function (video, hls) {
    S.detach(video);
    if (hls && hls.subtitleTracks && hls.subtitleTracks.length) { try { hls.subtitleTrack = -1; hls.subtitleDisplay = false; } catch (e) { /* no such track */ } }
    const tl = (video && video.textTracks) || [];
    for (let i = 0; i < tl.length; i++) if (tl[i].mode === 'showing') tl[i].mode = 'disabled';
  };
  // a subtitle file the viewer picked on this device (.srt / .vtt / .ass / .zip) -> {label, lang, vtt}
  S.fromFile = async function (file) {
    const T = await srt();
    const buf = await (file.arrayBuffer ? file.arrayBuffer() : new Response(file).arrayBuffer());
    const text = await bytesToText(buf, prefLang());
    const cues = T.repair(T.parse(text));
    if (!cues.length) throw new Error('empty subtitle');
    return {label: String(file.name || 'file').slice(0, 90), lang: T.scriptOf(cues) || prefLang(), source: 'file', vtt: T.toVtt(cues)};
  };
  S.prefLang = prefLang;
  S.detach = function (video) {
    const st = state.get(video);
    if (!st) return;
    try { st.track.mode = 'disabled'; st.el.remove(); } catch (e) { /* gone */ }
    URL.revokeObjectURL(st.url);
    state.delete(video);
  };
  S.current = (video) => { const st = state.get(video); return st ? {label: st.label, offset: st.offset, lang: st.lang, source: st.source} : null; };
  S.offset = (video) => (state.get(video) || {}).offset || 0;
  S.setOffset = function (video, sec) {
    const st = state.get(video);
    if (!st) return 0;
    const cl = st.track.cues;
    const want = Math.max(-600, Math.min(600, Math.round((Number(sec) || 0) * 10) / 10));
    if (!cl || !cl.length) { st.offset = want; rememberOffset(st.key, want); return st.offset; }
    if (!st.cues) st.cues = Array.from(cl, (c) => ({cue: c, start: c.startTime, end: c.endTime}));
    st.offset = want;
    // set end first when moving later so start <= end holds at every step
    for (const o of st.cues) {
      const s = Math.max(0, o.start + st.offset), e = Math.max(s + 0.01, o.end + st.offset);
      if (s > o.cue.endTime) { o.cue.endTime = e; o.cue.startTime = s; } else { o.cue.startTime = s; o.cue.endTime = e; }
    }
    rememberOffset(st.key, st.offset);
    return st.offset;
  };

  // ------------------------------------------------------------ appearance (::cue)
  const SIZES = {s: '80%', m: '100%', l: '130%', xl: '160%'};
  const COLORS = {white: '#fff', yellow: '#ffeb3b', cyan: '#7ff'};
  const BGS = {none: 'transparent', half: 'rgba(0,0,0,.55)', full: 'rgba(0,0,0,.9)'};
  S.style = () => ({size: getS('subs_size', 'm'), color: getS('subs_color', 'white'), bg: getS('subs_bg', 'half')});
  S.setStyle = function (o) {
    for (const k of ['size', 'color', 'bg']) if (o && o[k]) TN.settings.set('subs_' + k, o[k]);
    applyStyle();
  };
  function applyStyle() {
    if (typeof document === 'undefined') return;
    const s = S.style();
    let el = document.getElementById('subs-style');
    if (!el) { el = document.createElement('style'); el.id = 'subs-style'; document.head.appendChild(el); }
    el.textContent = `video::cue{font-size:${SIZES[s.size] || '100%'};color:${COLORS[s.color] || '#fff'};` +
      `background:${BGS[s.bg] || BGS.half};text-shadow:0 0 4px #000,0 0 2px #000;font-family:system-ui,Arial,sans-serif}` +
      '.subs-panel{position:absolute;inset-block-end:12%;inset-inline-end:12px;z-index:30;max-width:min(440px,92%);max-height:70%;' +
      'overflow:auto;background:rgba(18,20,28,.95);color:#fff;border-radius:12px;padding:12px;box-shadow:0 8px 30px #0008;text-align:start}' +
      '.subs-panel h3{margin:0 0 8px;font-size:1.05rem}.subs-panel .subs-list{display:flex;flex-direction:column;gap:4px;margin:6px 0}' +
      '.subs-panel .subs-list button{text-align:start;white-space:normal;word-break:break-word}' +
      '.subs-panel .subs-list button[aria-pressed="true"]{outline:2px solid var(--accent,#4da3ff)}' +
      '.subs-panel .subs-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0}' +
      '.subs-panel input[type=range]{flex:1;min-width:140px}.subs-panel input[type=email],.subs-panel input[type=password],.subs-panel input[type=text]{flex:1;min-width:120px}' +
      '.subs-panel .tag{font-size:.75rem;margin-inline-end:6px}' +
      '.subs-set{text-align:start}.subs-set h3{margin:0 0 10px}.subs-set h4{margin:16px 0 6px;font-size:.95rem;opacity:.8}' +
      '.subs-set-row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;min-height:44px;margin:4px 0}' +
      '.subs-set-row.sw{justify-content:flex-start}.subs-set-row.sw input{width:22px;height:22px;flex:none}' +
      '.subs-set select,.subs-set input[type=url],.subs-set input[type=password],.subs-set input[type=email]{min-height:44px;min-width:0;flex:1 1 160px;' +
      'background:var(--panel,#1a1d26);color:var(--text,#fff);border:1px solid var(--muted,#888);border-radius:10px;padding:8px 12px;font:inherit}' +
      '.subs-set-row select{flex:0 1 220px}.subs-set-form{margin:12px 0}.subs-set-form label{display:block;margin-bottom:4px}' +
      '.subs-set-line{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.subs-set-src{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:0 12px}' +
      '.subs-sample{background:#333 linear-gradient(135deg,#345,#222);border-radius:10px;padding:22px 10px;text-align:center;margin:8px 0;overflow:hidden}' +
      '.subs-sample span{padding:2px 8px;text-shadow:0 0 4px #000,0 0 2px #000;font-family:system-ui,Arial,sans-serif;font-size:100%}';
  }

  // ------------------------------------------------------------ auto pick (auto_subtitles in player_menus.py)
  // The order of the build's flow: (1) a track inside the file in the wanted language, (2) the best human subtitle in
  // that language (a file labelled Hebrew whose text is not Hebrew is skipped, the next one is tried), (3) the AI
  // paths (Gemini translation of an English subtitle, the home AI server) when they are set up.
  // opts = {hls, key (remembers the offset per video), embeddedOnly, say(text), list (reuse a finished search)}
  // -> {label, lang, source, embedded?} or null. S.autoOn() is the viewer's switch (browser setting subs_auto).
  S.autoOn = () => getS('subs_auto', true) !== false;
  S.pickAuto = function (list, lang) {
    const human = list.filter((x) => x.lang === lang && x.source !== 'subs_ai' && x.source !== 'subsrv');
    const ai = list.filter((x) => x.source === 'subs_ai').concat(list.filter((x) => x.source === 'subsrv'));
    return human.slice(0, 4).concat(ai);
  };
  S.auto = async function (video, q, opts) {
    opts = opts || {};
    q = Object.assign({}, q);
    const lang = q.lang || prefLang();
    q.lang = lang;
    const say = opts.say || (() => {});
    const emb = S.embedded(video, opts.hls).find((x) => x.lang === lang);
    if (emb) { emb.select(); return {label: emb.label, lang, source: 'embedded', embedded: true}; }
    if (opts.embeddedOnly) return null;
    const list = opts.list || await S.find(q);
    const T = await srt();
    for (const cand of S.pickAuto(list, lang)) {
      try {
        if (cand.source === 'subs_ai') subsAi.onProgress = (p) => say(t('subs_ai_run', p));
        if (cand.source === 'subsrv') subsrv.onProgress = (p) => say(t('subs_srv_wait', p));
        const vtt = await cand.fetchVtt();
        const sc = T.scriptOf(T.parse(vtt));
        if (sc && sc !== lang && cand.lang === lang && LANG3[lang]) continue;        // labelled wrong: not this one
        if (opts.alive && !opts.alive()) return null;
        S.attach(video, vtt, {label: cand.label, lang: cand.lang, key: opts.key, source: cand.source});
        return cand;
      } catch (e) { /* the next candidate */ }
    }
    return null;
  };

  // ------------------------------------------------------------ the in-player panel
  S.menu = async function (video, q, opts) {
    opts = opts || {};
    const host = opts.container || video.parentElement || document.body;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    let panel = host.querySelector(':scope > .subs-panel');
    if (panel) { panel.remove(); return null; }        // the same button toggles it
    applyStyle();
    panel = document.createElement('div');
    panel.className = 'subs-panel';
    panel.setAttribute('role', 'dialog');
    panel.dir = TN.rtl() ? 'rtl' : 'ltr';
    host.appendChild(panel);
    const close = () => { panel.remove(); document.removeEventListener('keydown', onKey, true); if (opts.onClose) opts.onClose(); };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Backspace' && !/INPUT/.test(e.target.tagName)) { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);

    const head = document.createElement('div');
    head.className = 'subs-row';
    head.innerHTML = `<h3 style="flex:1">${TN.esc(t('subs_title'))}</h3>`;
    head.append(TN.button('btn ghost', t('subs_close'), close));
    const msg = document.createElement('p'); msg.className = 'hint'; msg.textContent = t('subs_loading');
    const list = document.createElement('div'); list.className = 'subs-list';
    panel.append(head, msg, list, offsetRow(video), styleRow(), accountRow(() => { close(); S.menu(video, q, opts); }));

    const errors = {};
    let found = [];
    try { found = await S.find(q, {errors}); } catch (e) { errors.all = errMsg(e); }
    if (!panel.isConnected) return panel;
    const cur = S.current(video);
    const off = TN.button('btn ghost', t('subs_off'), () => { S.detach(video); mark(off); });
    off.setAttribute('aria-pressed', String(!cur));
    list.append(off);
    const mark = (b) => list.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    for (const s of found.slice(0, 40)) {
      const b = TN.button('btn ghost', '', async () => {
        msg.textContent = s.source === 'subs_ai' ? t('subs_ai_run', 0) : t('subs_loading');
        subsAi.onProgress = (p) => { if (s.source === 'subs_ai') msg.textContent = t('subs_ai_run', p); };
        try {
          S.attach(video, await s.fetchVtt(), {label: s.label, lang: s.lang});
          msg.textContent = t('subs_loaded', s.label);
          mark(b);
        } catch (e) { msg.textContent = t('subs_failed', errMsg(e)); }
      });
      b.innerHTML = `<span class="tag">${TN.esc(s.lang || '?')}</span><span class="tag">${TN.esc(SOURCES[s.source] ? SOURCES[s.source].label : t('subs_ai'))}</span><span dir="auto">${TN.esc(s.label)}</span>`;
      if (cur && cur.label === s.label) b.setAttribute('aria-pressed', 'true');
      list.append(b);
    }
    const errs = Object.entries(errors).map(([n, m]) => `${SOURCES[n] ? SOURCES[n].label : n}: ${m}`);
    msg.textContent = (found.length ? '' : t('subs_none')) + (errs.length ? ' ' + errs.join(' · ') : '');
    const first = list.querySelector('button[aria-pressed="true"]') || list.querySelector('button');
    if (first) first.focus();
    return panel;
  };
  function offsetRow(video) {
    const row = document.createElement('div'); row.className = 'subs-row';
    const lab = document.createElement('label');
    const r = document.createElement('input');
    r.type = 'range'; r.min = '-30'; r.max = '30'; r.step = '0.1'; r.value = String(S.offset(video));
    lab.textContent = t('subs_offset', S.offset(video).toFixed(1));
    r.setAttribute('aria-label', t('subs_offset', ''));
    const set = (v) => { const o = S.setOffset(video, v); r.value = String(o); lab.textContent = t('subs_offset', o.toFixed(1)); };
    r.oninput = () => set(Number(r.value));
    const minus = TN.button('btn ghost', '−0.5', () => set(S.offset(video) - 0.5));
    const plus = TN.button('btn ghost', '+0.5', () => set(S.offset(video) + 0.5));
    const reset = TN.button('btn ghost', t('subs_reset'), () => set(0));
    row.append(lab, minus, r, plus, reset);
    return row;
  }
  function styleRow() {
    const row = document.createElement('div'); row.className = 'subs-row';
    const sel = (key, label, opts) => {
      const s = document.createElement('select');
      s.setAttribute('aria-label', label);
      for (const o of Object.keys(opts)) { const op = document.createElement('option'); op.value = o; op.textContent = optName(key, o); s.append(op); }
      s.value = S.style()[key];
      s.onchange = () => S.setStyle({[key]: s.value});
      const l = document.createElement('label'); l.textContent = label + ' '; l.append(s);
      return l;
    };
    row.append(sel('size', t('subs_size'), SIZES), sel('color', t('subs_color'), COLORS), sel('bg', t('subs_bg'), BGS));
    return row;
  }
  function accountRow(reopen) {
    const box = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = S.ktuvitLogged() ? t('subs_logged') : t('subs_ktuvit_login');
    box.append(sum);
    const helper = !!(TN.settings.helper && TN.settings.helper());
    if (S.ktuvitLogged()) {
      box.append(TN.button('btn ghost', t('subs_logout'), () => { S.ktuvitLogout(); reopen(); }));
    } else if (!helper) {
      const p = document.createElement('p'); p.className = 'hint'; p.textContent = t('subs_need_helper'); box.append(p);
    } else {
      const f = document.createElement('form'); f.className = 'subs-row';
      f.innerHTML = `<input type="email" autocomplete="username" required placeholder="${TN.esc(t('subs_email'))}" dir="ltr">` +
        `<input type="password" autocomplete="current-password" required placeholder="${TN.esc(t('subs_password'))}" dir="ltr">` +
        `<button class="btn" type="submit">${TN.esc(t('subs_login'))}</button><span class="hint" role="status"></span>`;
      f.onsubmit = async (e) => {
        e.preventDefault();
        const [em, pw] = f.querySelectorAll('input');
        const st = f.querySelector('[role=status]');
        st.textContent = '…';
        try { await S.ktuvitLogin(em.value, pw.value); pw.value = ''; reopen(); } catch (err) { pw.value = ''; st.textContent = errMsg(err); }
      };
      box.append(f);
    }
    // the owner's AI subtitle server (this browser): https only, the PC server has to be published over https
    {
      const f = document.createElement('form'); f.className = 'subs-row';
      f.innerHTML = `<input type="url" inputmode="url" autocomplete="off" placeholder="${TN.esc(t('subs_srv'))} - https://" dir="ltr">` +
        `<button class="btn ghost" type="submit">${TN.esc(t('subs_save'))}</button><p class="hint">${TN.esc(t('subs_srv_hint'))}</p>` +
        `<span class="hint" role="status"></span>`;
      f.querySelector('input').value = getS('subs_server_url', '');
      f.onsubmit = (e) => {
        e.preventDefault();
        const v = f.querySelector('input').value.trim();
        if (v && !/^https:\/\/[^\s/?#@]+/i.test(v)) { f.querySelector('[role=status]').textContent = t('subs_srv_bad'); return; }
        TN.settings.set('subs_server_url', v.replace(/\/+$/, '')); reopen();
      };
      box.append(f);
    }
    // OpenSubtitles key (this browser), when the account has none synced
    if (!synced().os_key && !synced().opensubs_key) {
      const f = document.createElement('form'); f.className = 'subs-row';
      f.innerHTML = `<input type="password" autocomplete="off" placeholder="${TN.esc(t('subs_os_key'))}" dir="ltr">` +
        `<button class="btn ghost" type="submit">${TN.esc(t('subs_save'))}</button>`;
      f.querySelector('input').value = getS('subs_os_key', '');
      f.onsubmit = (e) => { e.preventDefault(); TN.settings.set('subs_os_key', f.querySelector('input').value.trim()); reopen(); };
      box.append(f);
    }
    return box;
  }

  // ------------------------------------------------------------ settings UI (Settings / Services pages, the player)
  const optName = (key, o) => t({size: 'subs_sz_', color: 'subs_c_', bg: 'subs_bg_'}[key] + o);
  S.styleOptions = () => ({size: Object.keys(SIZES).map((k) => [k, optName('size', k)]), color: Object.keys(COLORS).map((k) => [k, optName('color', k)]),
    bg: Object.keys(BGS).map((k) => [k, optName('bg', k)])});
  S.cssOf = (st) => { st = st || S.style(); return {fontSize: SIZES[st.size] || '100%', color: COLORS[st.color] || '#fff', background: BGS[st.bg] || BGS.half}; };
  // draws the whole subtitle settings block into el: automatic on/off, language, appearance with a live sample,
  // the sources' switches, the OpenSubtitles key, the home AI server address, the Ktuvit login.
  // opts.compact = true leaves out the heading (inside the player's panel).
  S.settingsPanel = function (el, opts) {
    if (!el || !TN) return;
    opts = opts || {};
    applyStyle();
    const esc = TN.esc;
    const draw = () => {
      const st = S.style(), css = S.cssOf(st), so = S.styleOptions();
      const sel = (id, label, list, cur) => `<label class="subs-set-row"><span>${esc(label)}</span><select id="${id}">` +
        list.map(([v, n]) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(n)}</option>`).join('') + '</select></label>';
      const helper = !!(TN.settings.helper && TN.settings.helper());
      const syncedOs = !!(synced().os_key || synced().opensubs_key);
      el.innerHTML = `<div class="subs-set">${opts.compact ? '' : `<h3>${esc(t('subs_settings'))}</h3>`}` +
        `<label class="subs-set-row sw"><input type="checkbox" id="subs_s_auto"${S.autoOn() ? ' checked' : ''}><span>${esc(t('subs_auto'))}</span></label>` +
        sel('subs_s_lang', t('subs_lang'), [['', t('subs_lang_app')], ['he', 'עברית'], ['en', 'English'], ['ru', 'Русский']], getS('subs_lang', '')) +
        `<h4>${esc(t('subs_look'))}</h4>` + sel('subs_s_size', t('subs_size'), so.size, st.size) + sel('subs_s_color', t('subs_color'), so.color, st.color) +
        sel('subs_s_bg', t('subs_bg'), so.bg, st.bg) +
        `<div class="subs-sample" aria-hidden="true"><span style="font-size:${css.fontSize};color:${css.color};background:${css.background}">${esc(t('subs_preview'))}</span></div>` +
        `<h4>${esc(t('subs_src_on'))}</h4><div class="subs-set-src">` +
        ['wizdom', 'ktuvit', 'opensubs', 'yify', 'subsrv', 'subs_ai'].map((n) => `<label class="subs-set-row sw"><input type="checkbox" data-src="${n}"${TN.providerOn(n) ? ' checked' : ''}>` +
          `<span>${esc(n === 'subs_ai' ? t('subs_ai') : SOURCES[n].label)}${n === 'subsrv' ? ' · ' + esc(t('subs_srv')) : ''}</span></label>`).join('') + '</div>' +
        `<h4>${esc(t('subs_keys'))}</h4>` +
        `<form class="subs-set-form" id="subs_s_os"><label for="subs_s_osk">${esc(t('subs_os_key'))}</label><div class="subs-set-line">` +
        `<input id="subs_s_osk" type="password" autocomplete="off" spellcheck="false" dir="ltr" placeholder="${getS('subs_os_key', '') ? '••••••••' : ''}">` +
        `<button class="btn" type="submit">${esc(t('subs_save'))}</button>` +
        (getS('subs_os_key', '') ? `<button class="btn ghost" type="button" id="subs_s_osx">${esc(t('subs_clear'))}</button>` : '') + '</div>' +
        `<p class="hint">${esc(t('subs_os_hint'))}${syncedOs ? ' ' + esc(t('subs_synced_key')) : ''}</p><p class="hint" role="status"></p></form>` +
        `<form class="subs-set-form" id="subs_s_srv"><label for="subs_s_srvu">${esc(t('subs_srv'))}</label><div class="subs-set-line">` +
        `<input id="subs_s_srvu" type="url" inputmode="url" autocomplete="off" spellcheck="false" dir="ltr" placeholder="https://" value="${esc(getS('subs_server_url', '') || '')}">` +
        `<button class="btn" type="submit">${esc(t('subs_save'))}</button><button class="btn ghost" type="button" id="subs_s_srvt">${esc(t('subs_srv_test'))}</button></div>` +
        `<p class="hint">${esc(t('subs_srv_hint'))}</p><p class="hint" role="status"></p></form>` +
        `<div class="subs-set-form" id="subs_s_kt"><b>${esc(S.ktuvitLogged() ? t('subs_logged') : t('subs_ktuvit_login'))}</b></div></div>`;
      const $ = (id) => el.querySelector('#' + id);
      $('subs_s_auto').onchange = (e) => TN.settings.set('subs_auto', !!e.target.checked);
      $('subs_s_lang').onchange = (e) => TN.settings.set('subs_lang', e.target.value);
      for (const k of ['size', 'color', 'bg']) $('subs_s_' + k).onchange = (e) => { S.setStyle({[k]: e.target.value}); const c = S.cssOf(), sp = el.querySelector('.subs-sample span'); if (sp) { sp.style.fontSize = c.fontSize; sp.style.color = c.color; sp.style.background = c.background; } };
      el.querySelectorAll('input[data-src]').forEach((cb) => { cb.onchange = () => { if (TN.setProviderOn) TN.setProviderOn(cb.dataset.src, !!cb.checked); }; });
      const osf = $('subs_s_os');
      osf.onsubmit = (e) => {
        e.preventDefault();
        const v = $('subs_s_osk').value.trim();
        if (!v) return;
        TN.settings.set('subs_os_key', v);
        $('subs_s_osk').value = '';
        draw();
        const s2 = el.querySelector('#subs_s_os [role=status]'); if (s2) s2.textContent = t('subs_saved');
      };
      if ($('subs_s_osx')) $('subs_s_osx').onclick = () => { TN.settings.set('subs_os_key', ''); draw(); };
      const srvf = $('subs_s_srv'), srvSay = (x) => { srvf.querySelector('[role=status]').textContent = x; };
      const srvVal = () => $('subs_s_srvu').value.trim().replace(/\/+$/, '');
      srvf.onsubmit = (e) => {
        e.preventDefault();
        const v = srvVal();
        if (v && !/^https:\/\/[^\s/?#@]+/i.test(v)) { srvSay(t('subs_srv_bad')); return; }
        TN.settings.set('subs_server_url', v);
        srvSay(t('subs_saved'));
      };
      $('subs_s_srvt').onclick = async () => {
        const v = srvVal();
        if (!/^https:\/\/[^\s/?#@]+/i.test(v)) { srvSay(t('subs_srv_bad')); return; }
        srvSay('…');
        try {
          const r = await S._fetch(v + '/health', {via: 'direct', timeout: 8000});
          srvSay(r.ok ? t('subs_srv_ok') : t('subs_srv_fail') + ' (' + r.status + ')');
        } catch (e) { srvSay(t('subs_srv_fail')); }
      };
      const kt = $('subs_s_kt');
      if (S.ktuvitLogged()) kt.append(' ', TN.button('btn ghost', t('subs_logout'), () => { S.ktuvitLogout(); draw(); }));
      else if (!helper) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = t('subs_need_helper'); kt.append(p); }
      else {
        const f = document.createElement('form'); f.className = 'subs-set-line';
        f.innerHTML = `<input type="email" autocomplete="username" required placeholder="${esc(t('subs_email'))}" aria-label="${esc(t('subs_email'))}" dir="ltr">` +
          `<input type="password" autocomplete="current-password" required placeholder="${esc(t('subs_password'))}" aria-label="${esc(t('subs_password'))}" dir="ltr">` +
          `<button class="btn" type="submit">${esc(t('subs_login'))}</button><span class="hint" role="status"></span>`;
        f.onsubmit = async (e) => {
          e.preventDefault();
          const ins = f.querySelectorAll('input'), stt = f.querySelector('[role=status]');
          stt.textContent = '…';
          try { await S.ktuvitLogin(ins[0].value, ins[1].value); ins[1].value = ''; draw(); } catch (err) { ins[1].value = ''; stt.textContent = errMsg(err); }
        };
        kt.append(f);
      }
    };
    draw();
  };
  S.servicesPanel = S.settingsPanel;
  // The Settings page gets the block by itself when this file is loaded (and at once when the shell offers
  // TN.addSettingsPanel); another page can call (await TN.provider('subs')).settingsPanel(el).
  function hookSettings() {
    if (!TN || typeof document === 'undefined') return;
    if (typeof TN.addSettingsPanel === 'function') { try { TN.addSettingsPanel('subs', {title: t('subs_settings'), render: (el) => S.settingsPanel(el, {compact: true})}); return; } catch (e) { /* the route hook below */ } }
    const put = (ctx) => {
      if (!ctx || ctx.key !== 'settings') return;
      setTimeout(() => {
        const view = TN.view && TN.view();
        if (!view || (TN.here && TN.here().key !== 'settings') || view.querySelector('#subs_settings_box')) return;
        const box = document.createElement('section');
        box.className = 'panel'; box.id = 'subs_settings_box';
        view.append(box);
        S.settingsPanel(box);
      }, 60);
    };
    if (TN.on) TN.on('route', put);
    try { if (TN.here) put(TN.here()); } catch (e) { /* no router yet */ }
  }

  // ------------------------------------------------------------ register
  S._internal = {parseYify, parseKtuvitRows, ktIv, ktEncode, imdbOf, toVttText, SOURCES, subsAi, subsrv, srvUrl};
  G.TNSubs = S;
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
  if (TN && TN.registerProvider) {
    TN.registerProvider('wizdom', wizdom);
    TN.registerProvider('opensubs', opensubs);
    TN.registerProvider('yify', yify);
    TN.registerProvider('ktuvit', ktuvit);
    TN.registerProvider('subsrv', subsrv);
    TN.registerProvider('subs_ai', subsAi);
    S.kinds = ['service']; S.label = 'Subtitles';
    TN.registerProvider('subs', S);            // the object itself, so S._fetch overrides (tests) reach the providers
    hookSettings();
  }
})(typeof self !== 'undefined' ? self : globalThis);
