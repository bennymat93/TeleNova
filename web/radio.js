'use strict';
// WP-7 (plan row 22): Radio. Replaces the built-in #/radio page.
//   #/radio                     the start country (setting 'radio')
//   #/radio/cc=IL | top=1 | tag=jazz | lang=hebrew | q=<name>    (TN.link('radio', {...}); old '#/radio/IL' and 'tag:x' still work)
// radio-browser.info (CORS open). A browser on an https page plays https streams only: url_resolved when it is https,
// else url when that is https; http-only stations are hidden and counted in a note (they play in Kodi).
// Provider 'radio' (search) finds stations by name.
(function (TN) {
  TN.i18n.add({
    he: {radio_country: 'מדינה', radio_style: 'סגנון', radio_t_news: 'חדשות ודיבור', radio_t_pop: 'פופ ולהיטים', radio_t_rock: 'רוק', radio_t_classical: 'קלאסית', radio_t_jazz: 'ג׳אז', radio_t_mideast: 'מזרח תיכון', radio_t_kids: 'ילדים', radio_t_jewish: 'יהדות',
         radio_lang: 'שפה', radio_search: 'חיפוש תחנה', radio_go: 'חיפוש', radio_top: 'הכי מושמעות',
         radio_http: '%s תחנות הוסתרו: הן משדרות ב-http, שדפדפן לא מנגן בדף מאובטח. הן עובדות ב-Kodi.', radio_label: 'רדיו',
         radio_results: 'תוצאות עבור "%s"'},
    en: {radio_country: 'Country', radio_style: 'Style', radio_t_news: 'News & talk', radio_t_pop: 'Pop & hits', radio_t_rock: 'Rock', radio_t_classical: 'Classical', radio_t_jazz: 'Jazz', radio_t_mideast: 'Middle East', radio_t_kids: 'Kids', radio_t_jewish: 'Jewish',
         radio_lang: 'Language', radio_search: 'Find a station', radio_go: 'Search', radio_top: 'Most played',
         radio_http: '%s stations are hidden: they stream over http, which a browser does not play on a secure page. They work in Kodi.', radio_label: 'Radio',
         radio_results: 'Results for "%s"'},
    ru: {radio_country: 'Страна', radio_style: 'Стиль', radio_t_news: 'Новости и разговор', radio_t_pop: 'Поп и хиты', radio_t_rock: 'Рок', radio_t_classical: 'Классика', radio_t_jazz: 'Джаз', radio_t_mideast: 'Ближний Восток', radio_t_kids: 'Детям', radio_t_jewish: 'Еврейское',
         radio_lang: 'Язык', radio_search: 'Найти станцию', radio_go: 'Поиск', radio_top: 'Популярные',
         radio_http: 'Скрыто станций: %s. Они вещают по http, браузер не играет их на защищённой странице. В Kodi они работают.', radio_label: 'Радио',
         radio_results: 'Результаты для «%s»'},
  });
  const SERVERS = ['https://de1.api.radio-browser.info', 'https://all.api.radio-browser.info', 'https://fi1.api.radio-browser.info'];
  // radio-browser language names -> ISO code for the viewer's language names
  const LANGS = [['hebrew', 'he'], ['russian', 'ru'], ['english', 'en'], ['arabic', 'ar'], ['french', 'fr'], ['spanish', 'es'],
                 ['german', 'de'], ['italian', 'it'], ['yiddish', 'yi'], ['amharic', 'am'], ['ukrainian', 'uk'], ['turkish', 'tr']];
  const COUNTRIES = ['IL', 'RU', 'US', 'GB', 'FR', 'DE', 'UA', 'ES', 'IT', 'TR'];
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
  function split(rows) {
    const out = [], seen = new Set();
    let http = 0;
    for (const s of rows || []) {
      if (!s || seen.has(s.stationuuid)) continue;
      seen.add(s.stationuuid);
      const u = playable(s);
      if (!u) { http++; continue; }
      out.push(Object.assign({}, s, {url_resolved: u, name: String(s.name || '').trim()}));
    }
    return {items: out, http};
  }
  // f: {cc, top, tag, lang, q} -> {items, http}
  async function stations(f, limit = 120) {
    let rows;
    if (f.q) rows = await api('/stations/search', Object.assign({name: f.q, limit: 80}, BASE_Q, f.lang ? {language: f.lang, languageExact: 'true'} : {}));
    else if (f.tag) rows = await api('/stations/bytagexact/' + encodeURIComponent(f.tag), Object.assign({limit}, BASE_Q));
    else if (f.lang) rows = await api('/stations/bylanguageexact/' + encodeURIComponent(f.lang), Object.assign({limit}, BASE_Q));
    else if (f.top) rows = await api('/stations/topclick/100', {hidebroken: 'true'});
    else rows = await api('/stations/bycountrycodeexact/' + encodeURIComponent(f.cc || 'IL'), Object.assign({limit}, BASE_Q));
    return split(rows);
  }

  function langName(code, fallback) {
    try { return new Intl.DisplayNames([TN.lang()], {type: 'language'}).of(code) || fallback; } catch (e) { return fallback; }
  }
  function regionName(cc) {
    try { return new Intl.DisplayNames([TN.lang()], {type: 'region'}).of(cc) || cc; } catch (e) { return cc; }
  }
  const radioCard = (s) => TN.card(TN.httpsOnly(s.favicon) || 'icon.png', s.name, [s.country, s.tags && s.tags.split(',')[0]].filter(Boolean).join(' · '),
                                   () => TN.playRadio(s), 'square');
  function row(label, items, cur, go) {
    const box = TN.chips(items, cur, go);
    box.insertAdjacentHTML('afterbegin', `<span class="chiplabel">${TN.esc(label)}</span>`);
  }

  function parseArg(arg) {
    arg = String(arg || '');
    if (arg.startsWith('tag:')) return {tag: arg.slice(4)};
    if (/^[A-Za-z]{2}$/.test(arg)) return {cc: arg.toUpperCase()};
    if (arg === 'top') return {top: '1'};
    const p = TN.params(arg);
    const f = {};
    for (const k of ['cc', 'top', 'tag', 'lang', 'q']) if (p[k]) f[k] = p[k];
    return f;
  }

  async function render(arg, ctx) {
    const f = parseArg(arg);
    if (!f.cc && !f.top && !f.tag && !f.lang && !f.q) f.cc = String(TN.settings.get('radio', 'IL') || 'IL');
    if (f.cc === 'top') { delete f.cc; f.top = '1'; }
    TN.page('radio');
    const go = (n) => TN.go(TN.link('radio', n));
    // search box
    const form = document.createElement('form');
    form.className = 'links';
    form.innerHTML = `<input type="search" name="q" dir="auto" placeholder="${TN.esc(TN.t('radio_search'))}" aria-label="${TN.esc(TN.t('radio_search'))}">` +
                     `<button class="btn" type="submit">${TN.esc(TN.t('radio_go'))}</button>`;
    form.q.value = f.q || '';
    form.onsubmit = (e) => { e.preventDefault(); const q = form.q.value.trim(); if (q) go(Object.assign({q}, f.lang ? {lang: f.lang} : {})); };
    TN.view().append(form);
    const countries = {};
    COUNTRIES.forEach((c) => { countries[c] = regionName(c); });
    if (f.cc && !countries[f.cc]) countries[f.cc] = regionName(f.cc);
    const cs = Object.entries(countries);
    row(TN.t('radio_country'), cs.concat([['top', TN.t('radio_top')]]), f.top ? 'top' : (f.q || f.tag || f.lang ? '' : f.cc),
        (k) => go(k === 'top' ? {top: 1} : {cc: k}));
    row(TN.t('radio_lang'), LANGS.map(([n, c]) => [n, langName(c, n)]), f.lang || '', (k) => go(f.q ? {q: f.q, lang: k} : {lang: k}));
    const tags = {};
    TAGS.forEach(([k, n]) => { tags[k] = TN.t('radio_t_' + n); });
    row(TN.t('radio_style'), Object.entries(tags), f.tag || '', (k) => go({tag: k}));
    const sk = TN.skeleton();
    const data = await stations(f);
    if (!ctx.current()) return;
    sk.remove();
    const title = f.q ? TN.t('radio_results', f.q) : f.tag ? (tags[f.tag] || f.tag) : f.lang ? langName((LANGS.find((x) => x[0] === f.lang) || [])[1] || f.lang, f.lang)
      : f.top ? TN.t('radio_top') : (countries[f.cc] || f.cc);
    const g = TN.section(title, data.items.length);
    data.items.forEach((s) => g.append(radioCard(s)));
    if (!data.items.length) TN.empty(g);
    if (data.http) TN.view().insertAdjacentHTML('beforeend', `<p class="hint">${TN.esc(TN.t('radio_http', data.http))}</p>`);
    if (f.q) form.q.focus();
  }
  TN.registerPage('radio', render);

  TN.registerProvider('radio', {
    kinds: ['search'], label: TN.t('radio_label'),
    async search(q, opts = {}) {
      q = String(q || '').trim();
      if (q.length < 2) return [];
      const d = await stations({q});
      return d.items.slice(0, opts.limit || 20).map((s) => ({title: s.name, sub: [s.country, TN.t('radio')].filter(Boolean).join(' · '),
        img: TN.httpsOnly(s.favicon) || '', kind: 'radio', score: s.name.toLowerCase() === q.toLowerCase() ? 1 : 0.5, open: () => TN.playRadio(s)}));
    },
    stations, playable, split,
  });
})(self.TN);
