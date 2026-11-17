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
      subs_save: 'שמירה', subs_srv: 'שרת כתוביות AI (במחשב)', subs_srv_hint: 'כתובת https בלבד. השרת במחשב חייב להיות נגיש ב-https (למשל דרך Cloudflare Tunnel או Tailscale Funnel) - כתובת http://IP:8765 לא תעבוד מדף https.', subs_srv_bad: 'צריך כתובת https://', subs_srv_wait: 'שרת ה-AI מכין כתוביות… %s%', subs_loaded: 'נטענו כתוביות: %s', subs_close: 'סגירה'},
    en: {subs_title: 'Subtitles', subs_none: 'No subtitles found.', subs_off: 'Subtitles off', subs_offset: 'Sync: %s s',
      subs_reset: 'Reset', subs_size: 'Size', subs_color: 'Color', subs_bg: 'Background', subs_loading: 'Looking for subtitles…',
      subs_failed: 'Could not load the subtitles: %s', subs_ai: 'AI translation', subs_ai_run: 'Translating… %s%', subs_need_key: 'Needs a %s key',
      subs_need_helper: 'Needs the helper (Worker)', subs_ktuvit_login: 'Subtitle login (Ktuvit)', subs_email: 'E-mail',
      subs_password: 'Password', subs_login: 'Log in', subs_logout: 'Log out', subs_logged: 'Logged in to Ktuvit', subs_os_key: 'OpenSubtitles key',
      subs_save: 'Save', subs_srv: 'AI subtitle server (PC)', subs_srv_hint: 'https address only. The server on the PC must be reachable over https (for example through Cloudflare Tunnel or Tailscale Funnel) - http://IP:8765 does not work from an https page.', subs_srv_bad: 'Needs an https:// address', subs_srv_wait: 'AI server preparing subtitles… %s%', subs_loaded: 'Subtitles loaded: %s', subs_close: 'Close'},
    ru: {subs_title: 'Субтитры', subs_none: 'Субтитры не найдены.', subs_off: 'Без субтитров', subs_offset: 'Сдвиг: %s с',
      subs_reset: 'Сброс', subs_size: 'Размер', subs_color: 'Цвет', subs_bg: 'Фон', subs_loading: 'Ищем субтитры…',
      subs_failed: 'Не удалось загрузить субтитры: %s', subs_ai: 'Перевод ИИ', subs_ai_run: 'Перевод… %s%', subs_need_key: 'Нужен ключ %s',
      subs_need_helper: 'Нужен помощник (Worker)', subs_ktuvit_login: 'Вход для субтитров (Ktuvit)', subs_email: 'Эл. почта',
      subs_password: 'Пароль', subs_login: 'Войти', subs_logout: 'Выйти', subs_logged: 'Вход в Ktuvit выполнен', subs_os_key: 'Ключ OpenSubtitles',
      subs_save: 'Сохранить', subs_srv: 'Сервер ИИ-субтитров (ПК)', subs_srv_hint: 'Только адрес https. Сервер на ПК должен быть доступен по https (например через Cloudflare Tunnel или Tailscale Funnel) - http://IP:8765 со страницы https не работает.', subs_srv_bad: 'Нужен адрес https://', subs_srv_wait: 'Сервер ИИ готовит субтитры… %s%', subs_loaded: 'Субтитры загружены: %s', subs_close: 'Закрыть'},
  });

  const t = (k, ...a) => (TN ? TN.t(k, ...a) : k);
  const appLang = () => (TN ? TN.lang() : 'he');
  const synced = () => (TN && TN.settings.synced ? TN.settings.synced() || {} : {});
  const getS = (k, d) => (TN ? TN.settings.get(k, d) : d);

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
    const cues = T.parse(text);
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
      const langs = [...new Set([q.lang || appLang(), 'he', 'en'])].join(',');
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
      const want = new Set([q.lang || appLang(), 'he', 'en']);
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
  const subsrv = {
    kinds: ['subs'], label: 'AI server', langs: ['he'],
    enabled: () => !!srvUrl(),
    async find(q) {
      const base = srvUrl();
      if (!base || !/^https?:\/\//i.test(String(q.url || ''))) return [];
      const job = {url: q.url, title: q.title || '', season: q.season || 0, episode: q.episode || 0, imdb: q.imdb || '',
        tmdb: q.tmdb || '', position: Number(q.position) || 0, mode: 'ai'};
      if (q.youtube_id) job.youtube_id = q.youtube_id;
      const gk = geminiKey();
      if (gk) job.gemini_key = gk;                 // request body only, as Kodi sends it; never in the address
      return [{
        label: 'BN AI', lang: 'he', source: 'subsrv', score: -0.5,
        fetchVtt: memo(async () => {
          const opt = (m, b) => ({method: m, via: 'direct', timeout: 15000, headers: b ? {'Content-Type': 'application/json'} : undefined, body: b ? JSON.stringify(b) : undefined});
          let r = await S._fetch(base + '/jobs', opt('POST', job));
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
    q.imdb = await imdbOf(q);
    const lang = q.lang || appLang();
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
    const st = {el, url, track: el.track, cues: null, offset: 0, label: el.label};
    state.set(video, st);
    for (const tr of video.textTracks) if (tr !== el.track) tr.mode = 'disabled';
    el.track.mode = opts.select === false ? 'hidden' : 'showing';
    const keep = Number(TN ? TN.get('subs_offset', 0) : 0) || 0;
    el.addEventListener('load', () => { st.cues = null; if (keep) S.setOffset(video, keep); }, {once: true});
    applyStyle();
    return el.track;
  };
  S.detach = function (video) {
    const st = state.get(video);
    if (!st) return;
    try { st.track.mode = 'disabled'; st.el.remove(); } catch (e) { /* gone */ }
    URL.revokeObjectURL(st.url);
    state.delete(video);
  };
  S.current = (video) => { const st = state.get(video); return st ? {label: st.label, offset: st.offset} : null; };
  S.offset = (video) => (state.get(video) || {}).offset || 0;
  S.setOffset = function (video, sec) {
    const st = state.get(video);
    if (!st) return 0;
    const cl = st.track.cues;
    if (!cl || !cl.length) { st.offset = Number(sec) || 0; return st.offset; }
    if (!st.cues) st.cues = Array.from(cl, (c) => ({cue: c, start: c.startTime, end: c.endTime}));
    st.offset = Math.round((Number(sec) || 0) * 10) / 10;
    // set end first when moving later so start <= end holds at every step
    for (const o of st.cues) {
      const s = Math.max(0, o.start + st.offset), e = Math.max(s + 0.01, o.end + st.offset);
      if (s > o.cue.endTime) { o.cue.endTime = e; o.cue.startTime = s; } else { o.cue.startTime = s; o.cue.endTime = e; }
    }
    if (TN) TN.put('subs_offset', st.offset);
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
      '.subs-panel .tag{font-size:.75rem;margin-inline-end:6px}';
  }

  // ------------------------------------------------------------ auto pick (auto_subtitles in player_menus.py)
  S.auto = async function (video, q) {
    const list = await S.find(q);
    const lang = q.lang || appLang();
    const best = list.find((x) => x.lang === lang) || list.find((x) => x.source === 'subs_ai');
    if (!best) return null;
    const vtt = await best.fetchVtt();
    S.attach(video, vtt, {label: best.label, lang: best.lang});
    return best;
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
      for (const o of Object.keys(opts)) { const op = document.createElement('option'); op.value = o; op.textContent = o; s.append(op); }
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
  }
})(typeof self !== 'undefined' ? self : globalThis);
