'use strict';
// WP-7 (plan row 22): Radio. Replaces the built-in #/radio page.
//   #/radio                     the start country (setting 'radio')
//   #/radio/cc=IL | top=1 | tag=jazz | lang=hebrew | q=<name>    (TN.link('radio', {...}); old '#/radio/IL' and 'tag:x' still work)
//   #/radio/v=favs              favourite stations (the store's kind 'radio', as the build writes them)
//   #/radio/v=recent            stations played lately (history rows 'radio:<id>')
//   #/radio/v=countries         every country of radio-browser.info, most stations first
//   #/radio/v=tags              the most used styles (the eight of the build first)
// radio-browser.info (CORS open, five mirrors). A station plays in the bar at the bottom (TN.playRadio) and keeps playing
// while browsing. A browser on an https page plays https streams only: url_resolved when it is https, else url when
// that is https. A station that broadcasts over http only is listed last, marked: pressing it tries the https copy of
// the same address (many servers have one); when there is none the sheet says why and offers the ways out.
// Like the build (radio.py readable / listing): names are cleaned, the same station is listed once.
// Provider 'radio' (search) finds stations by name.
(function (TN) {
  TN.i18n.add({
    he: {radio_country: 'מדינה', radio_style: 'סגנון', radio_t_news: 'חדשות ודיבור', radio_t_pop: 'פופ ולהיטים', radio_t_rock: 'רוק', radio_t_classical: 'קלאסית', radio_t_jazz: 'ג׳אז', radio_t_mideast: 'מזרח תיכון', radio_t_kids: 'ילדים', radio_t_jewish: 'יהדות',
         radio_lang: 'שפה', radio_search: 'חיפוש תחנה', radio_go: 'חיפוש', radio_top: 'הכי מושמעות',
         radio_http: '%s תחנות משדרות ב-http בלבד. הן מסומנות ומופיעות בסוף: לחיצה מנסה את עותק ה-https של אותה כתובת.', radio_label: 'רדיו',
         radio_results: 'תוצאות עבור "%s"', radio_favs: 'מועדפים', radio_recent: 'הושמעו לאחרונה', radio_all_countries: 'כל המדינות', radio_more_styles: 'עוד סגנונות',
         radio_countries: 'רדיו לפי מדינה', radio_styles: 'סגנונות', radio_n: '%s תחנות', radio_favs_none: 'אין עדיין תחנות מועדפות. נגנו תחנה ולחצו "הוסף למועדפים" בנגן שלמטה.',
         radio_recent_none: 'עוד לא הושמעה אף תחנה.', radio_fail: 'הרשימה לא נטענה. בדקו את החיבור ונסו שוב.', radio_retry: 'נסו שוב', radio_filter: 'סינון לפי שם',
         radio_b_http: 'http', radio_trying: 'מנסה את עותק ה-https של התחנה…', radio_why_http: 'התחנה משדרת ב-http בלבד ואין לה עותק https, ודף מאובטח לא יכול לנגן אותה.',
         radio_open_tab: 'פתיחת השידור בלשונית חדשה', radio_vlc: 'פתיחה ב-VLC', radio_copy: 'העתקת הכתובת', radio_copied: 'הכתובת הועתקה', radio_site: 'אתר התחנה',
         radio_kodi: 'BN Stream ל-Kodi', radio_playing: 'מתנגן עכשיו', radio_kbps: '%s kbps', radio_play: 'ניגון'},
    en: {radio_country: 'Country', radio_style: 'Style', radio_t_news: 'News & talk', radio_t_pop: 'Pop & hits', radio_t_rock: 'Rock', radio_t_classical: 'Classical', radio_t_jazz: 'Jazz', radio_t_mideast: 'Middle East', radio_t_kids: 'Kids', radio_t_jewish: 'Jewish',
         radio_lang: 'Language', radio_search: 'Find a station', radio_go: 'Search', radio_top: 'Most played',
         radio_http: '%s stations broadcast over http only. They are marked and listed last: pressing one tries the https copy of the same address.', radio_label: 'Radio',
         radio_results: 'Results for "%s"', radio_favs: 'Favourites', radio_recent: 'Recently played', radio_all_countries: 'All countries', radio_more_styles: 'More styles',
         radio_countries: 'Radio by country', radio_styles: 'Styles', radio_n: '%s stations', radio_favs_none: 'No favourite stations yet. Play a station and press "Add to favourites" in the player below.',
         radio_recent_none: 'No station was played yet.', radio_fail: 'The list could not be loaded. Check the connection and try again.', radio_retry: 'Try again', radio_filter: 'Filter by name',
         radio_b_http: 'http', radio_trying: 'Trying the https copy of the station…', radio_why_http: 'The station broadcasts over http only and has no https copy, and a secure page cannot play it.',
         radio_open_tab: 'Open the stream in a new tab', radio_vlc: 'Open in VLC', radio_copy: 'Copy the address', radio_copied: 'Address copied', radio_site: 'Station site',
         radio_kodi: 'BN Stream for Kodi', radio_playing: 'Playing now', radio_kbps: '%s kbps', radio_play: 'Play'},
    ru: {radio_country: 'Страна', radio_style: 'Стиль', radio_t_news: 'Новости и разговор', radio_t_pop: 'Поп и хиты', radio_t_rock: 'Рок', radio_t_classical: 'Классика', radio_t_jazz: 'Джаз', radio_t_mideast: 'Ближний Восток', radio_t_kids: 'Детям', radio_t_jewish: 'Еврейское',
         radio_lang: 'Язык', radio_search: 'Найти станцию', radio_go: 'Поиск', radio_top: 'Популярные',
         radio_http: 'Станций только с http-потоком: %s. Они отмечены и стоят в конце: нажатие пробует https-копию того же адреса.', radio_label: 'Радио',
         radio_results: 'Результаты для «%s»', radio_favs: 'Избранное', radio_recent: 'Недавно слушали', radio_all_countries: 'Все страны', radio_more_styles: 'Ещё стили',
         radio_countries: 'Радио по странам', radio_styles: 'Стили', radio_n: 'Станций: %s', radio_favs_none: 'Избранных станций пока нет. Включите станцию и нажмите «В избранное» в плеере внизу.',
         radio_recent_none: 'Пока ни одна станция не играла.', radio_fail: 'Список не загрузился. Проверьте соединение и попробуйте снова.', radio_retry: 'Повторить', radio_filter: 'Фильтр по названию',
         radio_b_http: 'http', radio_trying: 'Пробуем https-копию станции…', radio_why_http: 'Станция вещает только по http и не имеет https-копии, защищённая страница не может её играть.',
         radio_open_tab: 'Открыть поток в новой вкладке', radio_vlc: 'Открыть в VLC', radio_copy: 'Скопировать адрес', radio_copied: 'Адрес скопирован', radio_site: 'Сайт станции',
         radio_kodi: 'BN Stream для Kodi', radio_playing: 'Сейчас играет', radio_kbps: '%s кбит/с', radio_play: 'Слушать'},
  });
  const t = TN.t, esc = TN.esc;
  // the build's mirrors (radio.py): the first that answers is remembered
  const SERVERS = ['https://de1.api.radio-browser.info', 'https://all.api.radio-browser.info', 'https://fi1.api.radio-browser.info',
                   'https://de2.api.radio-browser.info', 'https://nl1.api.radio-browser.info'];
  // radio-browser language names -> ISO code for the viewer's language names
  const LANGS = [['hebrew', 'he'], ['russian', 'ru'], ['english', 'en'], ['arabic', 'ar'], ['french', 'fr'], ['spanish', 'es'],
                 ['german', 'de'], ['italian', 'it'], ['yiddish', 'yi'], ['amharic', 'am'], ['ukrainian', 'uk'], ['turkish', 'tr']];
  const COUNTRIES = ['IL', 'RU', 'US', 'GB', 'UA', 'FR', 'DE', 'ES', 'IT', 'TR'];
  const TAGS = [['news', 'news'], ['pop', 'pop'], ['rock', 'rock'], ['classical', 'classical'], ['jazz', 'jazz'],
                ['world middle east', 'mideast'], ['kids', 'kids'], ['jewish', 'jewish']];
  const BASE_Q = {hidebroken: 'true', order: 'clickcount', reverse: 'true'};

  let server = 0;
  async function api(path, params) {
    const qs = params ? '?' + new URLSearchParams(params) : '';
    let err;
    for (let i = 0; i < SERVERS.length; i++) {
      const s = SERVERS[(server + i) % SERVERS.length];
      try {
        const r = await fetch(s + '/json' + path + qs);
        if (r.ok) { server = (server + i) % SERVERS.length; return await r.json(); }
        err = new Error('radio ' + r.status);
      } catch (e) { err = e; }
    }
    throw err;
  }
  // the stream a browser can play, or '' (http only)
  function playable(s) {
    const a = String(s.url_resolved || ''), b = String(s.url || '');
    return a.startsWith('https://') ? a : b.startsWith('https://') ? b : '';
  }
  const httpOf = (s) => { const a = String(s.url_resolved || ''), b = String(s.url || ''); return /^http:\/\//i.test(a) ? a : /^http:\/\//i.test(b) ? b : ''; };
  // radio.py readable: 'Galgalatz  - גלגלצ (128k) [AAC]' -> 'Galgalatz - גלגלצ'
  function readable(name) {
    let n = String(name || '').replace(/[\u0000-\u001f​-‏﻿]/g, ' ');
    n = n.replace(/\s*[\[(]\s*(?:\d{2,3}\s*k(?:bps|bit\/s)?|mp3|aac\+?|ogg|opus|hls|https?|stream|hd|hq|\d{2,3})\s*[\])]/gi, ' ');
    n = n.replace(/\s+/g, ' ').replace(/^[\s\-_|:•·]+|[\s\-_|:•·]+$/g, '');
    return n || String(name || '').trim();
  }
  const sameKey = (name) => readable(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  // rows -> {items (https first, then the http-only ones marked), http}: each station once (by id, then by name:
  // the copy a browser can play wins, then the one with the better sound)
  function split(rows) {
    const by = new Map(), seen = new Set();
    for (const s of rows || []) {
      if (!s || !s.stationuuid || seen.has(s.stationuuid)) continue;
      seen.add(s.stationuuid);
      const u = playable(s), h = u ? '' : httpOf(s);
      if (!u && !h) continue;
      const row = Object.assign({}, s, {url_resolved: u, name: readable(s.name), http_only: !u, http_url: h});
      const nk = sameKey(row.name);
      const k = nk ? nk + '|' + String(s.countrycode || '').toUpperCase() : 'id:' + s.stationuuid;
      const was = by.get(k);
      if (!was) { by.set(k, row); continue; }
      const rank = (x) => (x.http_only ? 0 : 4) + (x.favicon ? 2 : 0);
      if (rank(row) > rank(was) || (rank(row) === rank(was) && (Number(row.bitrate) || 0) > (Number(was.bitrate) || 0))) by.set(k, row);
    }
    const all = [...by.values()];
    const items = all.filter((s) => !s.http_only).concat(all.filter((s) => s.http_only));
    return {items, http: all.filter((s) => s.http_only).length};
  }
  // f: {cc, top, tag, lang, q} -> {items, http}
  async function stations(f, limit = 150) {
    let rows;
    if (f.q) rows = await api('/stations/search', Object.assign({name: f.q, limit: 100}, BASE_Q, f.lang ? {language: f.lang, languageExact: 'true'} : {}));
    else if (f.tag) rows = await api('/stations/bytagexact/' + encodeURIComponent(f.tag), Object.assign({limit}, BASE_Q));
    else if (f.lang) rows = await api('/stations/bylanguageexact/' + encodeURIComponent(f.lang), Object.assign({limit}, BASE_Q));
    else if (f.top) rows = await api('/stations/topclick/100', {hidebroken: 'true'});
    else rows = await api('/stations/bycountrycodeexact/' + encodeURIComponent(f.cc || 'IL'), Object.assign({limit: Math.max(limit, 300)}, BASE_Q));
    return split(rows);
  }

  function langName(code, fallback) {
    try { return new Intl.DisplayNames([TN.lang()], {type: 'language'}).of(code) || fallback; } catch (e) { return fallback; }
  }
  function regionName(cc) {
    try { return new Intl.DisplayNames([TN.lang()], {type: 'region'}).of(cc) || cc; } catch (e) { return cc; }
  }
  const flag = (cc) => (/^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(0x1f1e6 + cc.charCodeAt(0) - 65, 0x1f1e6 + cc.charCodeAt(1) - 65) : '');

  // ---- favourites and recent stations (the active user's lists, in the build's shapes)
  function favStations() {
    const out = [];
    for (const f of (TN.store && TN.store.favs ? TN.store.favs() : []) || []) {
      if (!f || f.kind !== 'radio' || f.id === undefined || f.id === null) continue;
      const extra = typeof f.extra === 'string' ? f.extra : '', secure = /^https:\/\//i.test(extra);
      if (!secure && !/^http:\/\//i.test(extra)) continue;
      out.push({stationuuid: String(f.id), name: readable(f.label || f.id), url_resolved: secure ? extra : '', http_only: !secure, http_url: secure ? '' : extra,
        favicon: (TN.store.art && TN.store.art('radio', String(f.id))) || '', country: '', tags: ''});
    }
    return out;
  }
  function recentStations(limit) {
    const out = [], seen = new Set();
    for (const h of (TN.store && TN.store.history ? TN.store.history() : []) || []) {
      const key = String((h && h.key) || '');
      if (!key.startsWith('radio:') || seen.has(key)) continue;
      seen.add(key);
      const play = typeof h.play === 'string' ? h.play : '', secure = /^https:\/\//i.test(play);
      if (!secure && !/^http:\/\//i.test(play)) continue;
      let thumb = typeof h.thumb === 'string' ? h.thumb : '';
      if (thumb.startsWith('image://')) { try { thumb = decodeURIComponent(thumb.slice(8).replace(/\/$/, '')); } catch (e) { thumb = ''; } }
      out.push({stationuuid: key.slice(6), name: readable(h.label || key.slice(6)), url_resolved: secure ? play : '', http_only: !secure, http_url: secure ? '' : play,
        favicon: TN.httpsOnly(thumb) || '', country: '', tags: ''});
      if (out.length >= (limit || 60)) break;
    }
    return out;
  }

  // ---- playing: the bar at the bottom (TN.playRadio as it is), lock-screen controls, the click the API asks for
  let current = '';                              // the station id playing now (marks its card)
  function markPlaying() {
    document.querySelectorAll('.radio-card').forEach((c) => {
      const on = c.dataset.id === current;
      c.classList.toggle('radio-on', on);
      if (on) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
    });
  }
  function play(s) {
    if (!s || !/^https:\/\//i.test(s.url_resolved || '')) return tryHttp(s);
    const st = {stationuuid: s.stationuuid, name: s.name, url_resolved: s.url_resolved, favicon: TN.httpsOnly(s.favicon) || '', country: s.country || ''};
    // a newer shell may bring its own mini player (play / pause, error line): it is used when it is there
    const mini = TN.miniPlayer || TN.mini || null;
    if (mini && typeof mini.radio === 'function') mini.radio(st); else TN.playRadio(st);
    current = String(s.stationuuid || '');
    markPlaying();
    if (!mini) mediaSession(st);
    if (/^[0-9a-f-]{36}$/i.test(current)) fetch(SERVERS[server] + '/json/url/' + current).catch(() => {});       // counts the play, as the API asks
  }
  function mediaSession(st) {
    try {
      const ms = navigator.mediaSession;
      if (!ms || typeof MediaMetadata !== 'function') return;
      ms.metadata = new MediaMetadata({title: st.name, artist: st.country || t('radio_label'), artwork: st.favicon ? [{src: st.favicon}] : []});
      const stop = () => { TN.stopRadio(); current = ''; markPlaying(); };
      for (const a of ['stop', 'pause']) { try { ms.setActionHandler(a, stop); } catch (e) {} }
    } catch (e) {}
  }
  // does this address start playing here? (an <audio> element, a few seconds)
  function canPlay(url, ms) {
    return new Promise((ok) => {
      let a;
      try { a = new Audio(); } catch (e) { return ok(false); }
      let done = false;
      const end = (v) => { if (done) return; done = true; clearTimeout(timer); try { a.pause(); a.removeAttribute('src'); a.load(); } catch (e) {} ok(v); };
      const timer = setTimeout(() => end(false), ms || 8000);
      a.preload = 'auto'; a.muted = true;
      a.addEventListener('canplay', () => end(true));
      a.addEventListener('loadedmetadata', () => end(true));
      a.addEventListener('error', () => end(false));
      a.src = url;
      try { a.load(); } catch (e) { end(false); }
    });
  }
  // an http-only station: its https copy when the server has one; otherwise the reason and the ways out
  async function tryHttp(s) {
    const http = (s && (s.http_url || httpOf(s))) || '';
    if (!http) return;
    style();
    const name = s.name || '';
    TN.modal(`<div class="detail" style="grid-template-columns:1fr"><div><h3 dir="auto">${esc(name)}</h3>` +
      `<p class="hint" id="radio_st" role="status">${esc(t('radio_trying'))}</p><div class="actions" id="acts"></div></div></div>`);
    const st = document.getElementById('radio_st'), acts = document.getElementById('acts');
    const secure = http.replace(/^http:/i, 'https:');
    const ok = await canPlay(secure, 8000);
    if (!st || !document.body.contains(st)) return;        // the sheet was closed meanwhile
    if (ok) {
      if (TN.closeModal) TN.closeModal();
      return play(Object.assign({}, s, {url_resolved: secure, http_only: false}));
    }
    st.className = 'msg';
    st.textContent = t('radio_why_http');
    const link = (href, text, ext) => { const a = document.createElement('a'); a.className = 'btn ghost'; a.href = href; a.textContent = text;
      if (ext) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } acts.append(a); };
    link(http, t('radio_open_tab'), true);
    link('vlc://' + http, t('radio_vlc'), false);
    acts.append(TN.button('btn ghost', t('radio_copy'), async (e) => {
      try { await navigator.clipboard.writeText(http); e.target.textContent = t('radio_copied'); } catch (er) { window.prompt(t('radio_copy'), http); }
    }));
    if (TN.httpsOnly(s.homepage)) link(s.homepage, t('radio_site'), true);
    link('#/bn', t('radio_kodi'), false);
  }

  function style() {
    if (document.getElementById('radio-style')) return;
    const s = document.createElement('style');
    s.id = 'radio-style';
    s.textContent = '.radio-on{outline:2px solid var(--accent);outline-offset:2px}.radio-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:10px 0}' +
      '.radio-tiles a{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:10px;background:var(--panel);color:inherit;text-decoration:none;text-align:start}' +
      '.radio-tiles a small{opacity:.7}.radio-tiles a:focus-visible{outline:2px solid var(--accent)}html.tv .radio-tiles a:focus{outline:4px solid var(--accent)}' +
      '.radio-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}.radio-tools input{flex:1 1 200px;min-width:0}';
    document.head.append(s);
  }
  function radioCard(s) {
    const sub = [s.country, s.tags && String(s.tags).split(',')[0], Number(s.bitrate) ? t('radio_kbps', s.bitrate) : ''].filter(Boolean).join(' · ');
    const c = TN.card(TN.httpsOnly(s.favicon) || 'icon.png', s.name, sub, () => play(s), 'square' + (s.http_only ? ' dim' : ''), s.http_only ? t('radio_b_http') : '');
    c.classList.add('radio-card');
    c.dataset.id = String(s.stationuuid || '');
    if (c.dataset.id === current) { c.classList.add('radio-on'); c.setAttribute('aria-current', 'true'); }
    return c;
  }
  function row(label, items, cur, go) {
    const box = TN.chips(items, cur, go);
    box.insertAdjacentHTML('afterbegin', `<span class="chiplabel">${esc(label)}</span>`);
    return box;
  }

  function parseArg(arg) {
    arg = String(arg || '');
    if (arg.startsWith('tag:')) return {tag: arg.slice(4)};
    if (/^[A-Za-z]{2}$/.test(arg)) return {cc: arg.toUpperCase()};
    if (arg === 'top') return {top: '1'};
    if (['favs', 'recent', 'countries', 'tags'].includes(arg)) return {v: arg};
    const p = TN.params(arg);
    const f = {};
    for (const k of ['cc', 'top', 'tag', 'lang', 'q', 'v']) if (p[k]) f[k] = p[k];
    if (f.cc) f.cc = String(f.cc).toUpperCase();
    return f;
  }

  // every country (radio-browser /countries), most stations first, Israel at the top; names in the viewer's language
  let countryRows = null;
  async function countryList() {
    if (!countryRows) {
      const rows = await api('/countries', {order: 'stationcount', reverse: 'true', hidebroken: 'true'});
      const by = new Map();
      for (const c of rows || []) {
        const cc = String((c && c.iso_3166_1) || '').toUpperCase();
        if (!/^[A-Z]{2}$/.test(cc) || !(c.stationcount > 0)) continue;
        by.set(cc, (by.get(cc) || 0) + c.stationcount);
      }
      countryRows = [...by.entries()].map(([code, n]) => ({code, n, name: regionName(code)})).sort((a, b) => (a.code === 'IL' ? -1 : b.code === 'IL' ? 1 : b.n - a.n));
    }
    return countryRows;
  }
  let tagRows = null;
  async function tagList() {
    if (!tagRows) {
      const rows = await api('/tags', {order: 'stationcount', reverse: 'true', hidebroken: 'true', limit: '120'});
      tagRows = (rows || []).filter((x) => x && x.name && x.stationcount > 20 && x.name.length < 28 && !/^\d+$/.test(x.name)).map((x) => ({name: x.name, n: x.stationcount})).slice(0, 96);
    }
    return tagRows;
  }
  TN.on('clearcache', () => { countryRows = null; tagRows = null; });

  function failBox(e) {
    const v = TN.view();
    v.insertAdjacentHTML('beforeend', `<p class="msg">${esc(t('radio_fail'))}</p>`);
    v.append(TN.button('btn', t('radio_retry'), () => TN.route()));
  }
  function tiles(rows, href, label, sub) {
    const box = document.createElement('div');
    box.className = 'radio-tiles';
    for (const r of rows) {
      const a = document.createElement('a');
      a.href = href(r);
      a.innerHTML = `<b dir="auto">${esc(label(r))}</b><small>${esc(sub(r))}</small>`;
      box.append(a);
    }
    return box;
  }

  async function render(arg, ctx) {
    const f = parseArg(arg);
    const special = ['favs', 'recent', 'countries', 'tags'].includes(f.v) ? f.v : '';
    if (!special && !f.cc && !f.top && !f.tag && !f.lang && !f.q) f.cc = String(TN.settings.get('radio', 'IL') || 'IL').toUpperCase();
    if (f.cc === 'TOP') { delete f.cc; f.top = '1'; }
    TN.page('radio');
    style();
    const go = (n) => TN.go(TN.link('radio', n));
    const view = TN.view();
    // search box
    const form = document.createElement('form');
    form.className = 'links';
    form.innerHTML = `<input type="search" name="q" dir="auto" placeholder="${esc(t('radio_search'))}" aria-label="${esc(t('radio_search'))}">` +
                     `<button class="btn" type="submit">${esc(t('radio_go'))}</button>`;
    form.q.value = f.q || '';
    form.onsubmit = (e) => { e.preventDefault(); const q = form.q.value.trim(); if (q) go(Object.assign({q}, f.lang ? {lang: f.lang} : {})); };
    view.append(form);
    TN.chips([['favs', '★ ' + t('radio_favs')], ['recent', '↺ ' + t('radio_recent')]], special, (k) => go({v: k}));
    const countries = {};
    COUNTRIES.forEach((c) => { countries[c] = regionName(c); });
    if (f.cc && !countries[f.cc]) countries[f.cc] = regionName(f.cc);
    const cs = Object.entries(countries).map(([k, n]) => [k, (flag(k) ? flag(k) + ' ' : '') + n]);
    row(t('radio_country'), cs.concat([['top', t('radio_top')], ['all', t('radio_all_countries') + ' ›']]),
        special === 'countries' ? 'all' : f.top ? 'top' : (special || f.q || f.tag || f.lang ? '' : f.cc),
        (k) => go(k === 'top' ? {top: 1} : k === 'all' ? {v: 'countries'} : {cc: k}));
    row(t('radio_lang'), LANGS.map(([n, c]) => [n, langName(c, n)]), f.lang || '', (k) => go(f.q ? {q: f.q, lang: k} : {lang: k}));
    const tags = {};
    TAGS.forEach(([k, n]) => { tags[k] = t('radio_t_' + n); });
    if (f.tag && !tags[f.tag]) tags[f.tag] = f.tag;
    row(t('radio_style'), Object.entries(tags).concat([['more', t('radio_more_styles') + ' ›']]), special === 'tags' ? 'more' : f.tag || '',
        (k) => go(k === 'more' ? {v: 'tags'} : {tag: k}));

    if (special === 'countries' || special === 'tags') {
      const sk = TN.skeleton();
      let rows;
      try { rows = await (special === 'countries' ? countryList() : tagList()); } catch (e) { if (ctx.current()) { sk.remove(); failBox(e); } return; }
      if (!ctx.current()) return;
      sk.remove();
      const h = document.createElement('h2');
      h.textContent = t(special === 'countries' ? 'radio_countries' : 'radio_styles');
      view.append(h, special === 'countries'
        ? tiles(rows, (r) => TN.link('radio', {cc: r.code}), (r) => (flag(r.code) ? flag(r.code) + ' ' : '') + r.name, (r) => t('radio_n', r.n.toLocaleString()))
        : tiles(rows, (r) => TN.link('radio', {tag: r.name}), (r) => { const k = TAGS.find((x) => x[0] === r.name); return k ? t('radio_t_' + k[1]) : r.name; }, (r) => t('radio_n', r.n.toLocaleString())));
      return;
    }

    let data;
    if (special === 'favs') { const items = favStations(); data = {items: items.filter((s) => !s.http_only).concat(items.filter((s) => s.http_only)), http: items.filter((s) => s.http_only).length}; }
    else if (special === 'recent') { const items = recentStations(); data = {items, http: items.filter((s) => s.http_only).length}; }
    else {
      const sk = TN.skeleton();
      try { data = await stations(f); } catch (e) { if (ctx.current()) { sk.remove(); failBox(e); } return; }
      if (!ctx.current()) return;
      sk.remove();
    }
    const title = special === 'favs' ? t('radio_favs') : special === 'recent' ? t('radio_recent')
      : f.q ? t('radio_results', f.q) : f.tag ? (tags[f.tag] || f.tag) : f.lang ? langName((LANGS.find((x) => x[0] === f.lang) || [])[1] || f.lang, f.lang)
      : f.top ? t('radio_top') : (countries[f.cc] || f.cc);
    // a long list gets a name filter
    let filter = null;
    if (data.items.length > 24) {
      const tools = document.createElement('div');
      tools.className = 'radio-tools';
      filter = document.createElement('input');
      filter.type = 'search'; filter.dir = 'auto'; filter.placeholder = t('radio_filter'); filter.setAttribute('aria-label', t('radio_filter'));
      tools.append(filter);
      view.append(tools);
    }
    const g = TN.section(title, data.items.length);
    const draw = () => {
      const q = filter ? filter.value.trim().toLowerCase() : '';
      g.innerHTML = '';
      const hit = data.items.filter((s) => !q || s.name.toLowerCase().includes(q) || String(s.tags || '').toLowerCase().includes(q));
      hit.forEach((s) => g.append(radioCard(s)));
      if (!hit.length) {
        if (special && !q) g.innerHTML = `<p class="msg">${esc(t(special === 'favs' ? 'radio_favs_none' : 'radio_recent_none'))}</p>`;
        else TN.empty(g);
      }
    };
    if (filter) filter.addEventListener('input', draw);
    draw();
    if (data.http) view.insertAdjacentHTML('beforeend', `<p class="hint">${esc(t('radio_http', data.http))}</p>`);
    if (f.q) form.q.focus();
  }
  TN.registerPage('radio', render);

  TN.registerProvider('radio', {
    kinds: ['search'], label: t('radio_label'),
    async search(q, opts = {}) {
      q = String(q || '').trim();
      if (q.length < 2) return [];
      const ql = q.toLowerCase();
      let own = [];
      try { own = (TN.get('radio_own', []) || []).filter((s) => s && s.name && /^https:\/\//i.test(String(s.url)) && String(s.name).toLowerCase().includes(ql)); } catch (e) { own = []; }
      const mine = own.map((s) => ({title: s.name, sub: t('radio'), img: '', kind: 'radio', score: 1, open: () => play({name: s.name, url: s.url, url_resolved: s.url, favicon: ''})}));
      const d = await stations({q});
      return mine.concat(d.items.filter((s) => !s.http_only).slice(0, opts.limit || 20).map((s) => ({title: s.name, sub: [s.country, t('radio')].filter(Boolean).join(' · '),
        img: TN.httpsOnly(s.favicon) || '', kind: 'radio', score: s.name.toLowerCase() === q.toLowerCase() ? 1 : 0.5, open: () => play(s)})));
    },
    stations, playable, split, readable, parseArg, favStations, recentStations, play, countryList, tagList, flag, canPlay, SERVERS,
  });
})(self.TN);
