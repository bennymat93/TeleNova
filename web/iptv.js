'use strict';
// WP-7 (plan rows 18-20): Live TV. Replaces the built-in #/live page.
//   #/live                 the start list (setting 'live', default the build's Israeli table 'tn')
//   #/live/<list>          tn | il | he | ru | en | kids | docs | news | music (iptv-org lists, as app.js names them)
//   #/live/c:<CC>          one country (iptv-org countries/<cc>.m3u)
//   #/live/countries       the world by country
//   #/live/<list>/g:<Group> one group of a list (Israel, News, Movies, ... like the build's iptv.classify)
// A browser plays https HLS only: http rows are counted and hidden with a note (mixed content). The same channel
// listed twice (same name) becomes one card with all its streams, tried in order (failover, as openChannel does).
// "Check streams" probes each stream with a short GET (a stream the browser cannot read - no CORS - is as dead here).
// Provider 'iptv' (search) finds channels by name in the Israeli lists.
(function (TN) {
  TN.i18n.add({
    he: {iptv_l_tn: 'ערוצי ישראל', iptv_l_il: 'ישראל (iptv-org)', iptv_l_he: 'עברית', iptv_l_ru: 'רוסית', iptv_l_en: 'אנגלית', iptv_l_kids: 'ילדים', iptv_l_docs: 'תעודה', iptv_l_news: 'חדשות', iptv_l_music: 'מוזיקה',
         iptv_countries: 'לפי מדינה', iptv_world: 'העולם לפי מדינה', iptv_all: 'הכול', iptv_check: 'בדיקת ערוצים',
         iptv_checking: 'בודק %s מתוך %s…', iptv_checked: '%s ערוצים לא עונים סומנו', iptv_dead: 'לא עונה',
         iptv_http: '%s ערוצים מוסתרים: הם בכתובת http, שדפדפן לא מנגן בדף מאובטח. הם עובדים ב-Kodi.',
         iptv_filter: 'סינון לפי שם', iptv_guide: 'לוח שידורים', iptv_label: 'ערוצים חיים',
         grp_Israel: 'ישראל', grp_News: 'חדשות', grp_Movies: 'סרטים', grp_Series: 'סדרות', grp_Kids: 'ילדים', grp_Sport: 'ספורט',
         grp_Documentary: 'תעודה', grp_Music: 'מוזיקה', grp_Russian: 'רוסית', grp_Other: 'אחר'},
    en: {iptv_l_tn: 'Israeli channels', iptv_l_il: 'Israel (iptv-org)', iptv_l_he: 'Hebrew', iptv_l_ru: 'Russian', iptv_l_en: 'English', iptv_l_kids: 'Kids', iptv_l_docs: 'Documentary', iptv_l_news: 'News', iptv_l_music: 'Music',
         iptv_countries: 'By country', iptv_world: 'The world by country', iptv_all: 'All', iptv_check: 'Check streams',
         iptv_checking: 'Checking %s of %s…', iptv_checked: '%s streams that do not answer were marked', iptv_dead: 'No answer',
         iptv_http: '%s channels are hidden: they are http streams, which a browser does not play on a secure page. They work in Kodi.',
         iptv_filter: 'Filter by name', iptv_guide: 'TV guide', iptv_label: 'Live channels',
         grp_Israel: 'Israel', grp_News: 'News', grp_Movies: 'Movies', grp_Series: 'Series', grp_Kids: 'Kids', grp_Sport: 'Sport',
         grp_Documentary: 'Documentary', grp_Music: 'Music', grp_Russian: 'Russian', grp_Other: 'Other'},
    ru: {iptv_l_tn: 'Каналы Израиля', iptv_l_il: 'Израиль (iptv-org)', iptv_l_he: 'Иврит', iptv_l_ru: 'Русский', iptv_l_en: 'Английский', iptv_l_kids: 'Детям', iptv_l_docs: 'Документальные', iptv_l_news: 'Новости', iptv_l_music: 'Музыка',
         iptv_countries: 'По странам', iptv_world: 'Мир по странам', iptv_all: 'Все', iptv_check: 'Проверить каналы',
         iptv_checking: 'Проверка %s из %s…', iptv_checked: 'Отмечено неотвечающих каналов: %s', iptv_dead: 'Не отвечает',
         iptv_http: 'Скрыто каналов: %s. Это http-потоки, браузер не играет их на защищённой странице. В Kodi они работают.',
         iptv_filter: 'Фильтр по названию', iptv_guide: 'Телепрограмма', iptv_label: 'Каналы',
         grp_Israel: 'Израиль', grp_News: 'Новости', grp_Movies: 'Фильмы', grp_Series: 'Сериалы', grp_Kids: 'Детям', grp_Sport: 'Спорт',
         grp_Documentary: 'Документальные', grp_Music: 'Музыка', grp_Russian: 'Русские', grp_Other: 'Другое'},
  });

  const LISTS = {il: 'countries/il', he: 'languages/heb', ru: 'languages/rus', en: 'languages/eng',
                 kids: 'categories/kids', docs: 'categories/documentary', news: 'categories/news', music: 'categories/music'};
  const BASE = 'https://iptv-org.github.io/iptv/';
  // the build's iptv.py: BLOCKS order and KEYWORDS
  const GROUPS = ['Israel', 'News', 'Movies', 'Series', 'Kids', 'Sport', 'Documentary', 'Music', 'Russian', 'Other'];
  const KEYWORDS = [
    ['Kids', /kid|cartoon|junior|disney|nick|мульт|детск|ילד|הופ|לוגי/],
    ['Sport', /sport|спорт|ספורט|eurosport|espn|football|футбол|матч/],
    ['News', /news|новост|חדשות|cnn|bbc world|euronews|sky news|россия 24|i24/],
    ['Movies', /movie|cinema|film|кино|фильм|סרט|hbo|cinemax/],
    ['Series', /series|сериал|סדרות|drama/],
    ['Documentary', /docu|discovery|nat.?geo|history|animal|природ|תעוד|viasat/],
    ['Music', /music|музык|מוזיק|mtv|vh1/],
  ];
  const HEB = /[֐-׿]/, CYR = /[Ѐ-ӿ]/;

  function country(attrs) {
    let c = (attrs['tvg-country'] || '').toUpperCase();
    if (!c) { const m = (attrs['tvg-id'] || '').match(/\.([a-z]{2})(?:@|$)/); c = m ? m[1].toUpperCase() : ''; }
    return c;
  }
  function classify(name, group, attrs, src) {
    const text = name + ' ' + group, low = text.toLowerCase(), cc = country(attrs);
    if (HEB.test(text) || /(^|[^a-z])(il|israel)([^a-z]|$)|ישראל/.test(low) || cc === 'IL' || src === 'il' || src === 'he') return 'Israel';
    if (CYR.test(text) || ['RU', 'UA', 'BY', 'KZ'].includes(cc) || src === 'ru') return 'Russian';
    for (const [g, rx] of KEYWORDS) if (rx.test(low)) return g;
    return 'Other';
  }
  // 'Kan 11 (1080p) [Not 24/7]' -> 'Kan 11'
  const displayName = (n) => String(n || '').replace(/\s*\((?:\d{3,4}[pi]|SD|HD|FHD|UHD|4K)\)|\s*\[[^\]]*\]/gi, '').trim() || n;
  const normKey = (n) => String(n || '').toLowerCase().replace(/\b(hd|fhd|uhd|4k|sd|hevc|h265|\+1)\b/g, '').replace(/[\W_]+/gu, '');

  // m3u -> {rows: [{name, logo, group, attrs, url}], http: count of http-only rows}
  function parseM3u(text) {
    const rows = [];
    let cur = null;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('#EXTINF')) {
        const attrs = {};
        line.replace(/([\w-]+)="([^"]*)"/g, (m, k, v) => { attrs[k] = v; return m; });
        const cut = line.lastIndexOf('",');
        const name = line.slice(cut > 0 ? cut + 2 : line.indexOf(',') + 1).trim();
        cur = {name, attrs, logo: attrs['tvg-logo'] || '', group: (attrs['group-title'] || '').split(';')[0].replace(/^Undefined$/, '')};
      } else if (cur && line && !line.startsWith('#')) {
        rows.push(Object.assign(cur, {url: line}));
        cur = null;
      }
    }
    return rows;
  }
  // rows -> channels: https only, one per name, all of its streams kept (failover)
  function merge(rows, src) {
    const by = new Map();
    let http = 0;
    for (const r of rows) {
      if (!/^https:\/\//i.test(r.url)) { if (/^http:\/\//i.test(r.url)) http++; continue; }
      const name = displayName(r.name), k = normKey(name) || r.url;
      const c = by.get(k);
      if (c) { if (!c.urls.includes(r.url)) c.urls.push(r.url); if (!c.logo && r.logo) c.logo = TN.httpsOnly(r.logo); continue; }
      by.set(k, {name, logo: TN.httpsOnly(r.logo) || '', group: r.group, cls: classify(r.name, r.group, r.attrs, src),
                 cc: country(r.attrs), url: r.url, urls: [r.url]});
    }
    // a channel whose name has no Latin/Hebrew/Cyrillic letters at all is still kept; order: Israel first, then A-Z
    const out = [...by.values()].sort((a, b) => GROUPS.indexOf(a.cls) - GROUPS.indexOf(b.cls) || a.name.localeCompare(b.name));
    return {items: out, http};
  }

  const cache = {};
  async function load(list) {
    if (cache[list]) return cache[list];
    if (list === 'tn') {
      const items = await TN.channels('tn');
      return (cache.tn = {items: items.map((c) => Object.assign({cls: 'Israel'}, c)), http: 0});
    }
    const path = list.startsWith('c:') ? 'countries/' + list.slice(2).toLowerCase() : LISTS[list];
    if (!path) return {items: [], http: 0};
    const r = await fetch(BASE + path + '.m3u');
    if (!r.ok) throw new Error('m3u ' + r.status);
    return (cache[list] = merge(parseM3u(await r.text()), list));
  }

  // ---- dead-stream probe: kept a day in this browser (url -> [ok, time])
  const PROBE_KEY = 'iptv_probe', DAY = 864e5;
  const probes = () => { const p = TN.get(PROBE_KEY, {}); return p && typeof p === 'object' ? p : {}; };
  function isDead(c) {
    const p = probes(), now = Date.now();
    const known = (c.urls || [c.url]).map((u) => p[u]).filter((x) => x && now - x[1] < DAY);
    return known.length === (c.urls || [c.url]).length && known.length > 0 && known.every((x) => !x[0]);
  }
  async function probe(url, ms = 6000, fetchFn = fetch) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetchFn(url, {method: 'GET', mode: 'cors', cache: 'no-store', signal: ctl.signal});
      try { if (r.body && r.body.cancel) r.body.cancel(); } catch (e) {}
      return !!r.ok;
    } catch (e) { return false; } finally { clearTimeout(timer); }
  }
  async function checkAll(items, onStep, fetchFn) {
    const urls = [...new Set(items.flatMap((c) => c.urls || [c.url]).filter(Boolean))];
    const p = probes(), now = Date.now();
    let done = 0, i = 0;
    async function worker() {
      while (i < urls.length) {
        const u = urls[i++];
        if (!(p[u] && now - p[u][1] < DAY)) p[u] = [await probe(u, 6000, fetchFn), Date.now()];
        done++;
        if (onStep) onStep(done, urls.length);
      }
    }
    await Promise.all(Array.from({length: Math.min(6, urls.length)}, worker));
    for (const [u, v] of Object.entries(p)) if (Date.now() - v[1] > DAY) delete p[u];
    TN.put(PROBE_KEY, p);
    return items.filter(isDead).length;
  }

  // ---- open a channel: the app's player, plus the guide under it
  async function open(c) {
    const live = (c.urls || [c.url]).filter((u) => !isDead({urls: [u]}));    // known-dead streams go last
    const order = live.concat((c.urls || [c.url]).filter((u) => !live.includes(u)));
    TN.openChannel(Object.assign({}, c, {urls: order, url: order[0] || c.url}));
    const epg = await TN.provider('epg').catch(() => null);
    if (!epg || !(await epg.ready())) return;
    const acts = document.getElementById('acts');
    if (!acts || !epg.keyOf(c)) return;
    acts.parentNode.insertBefore(epg.bar(c), acts);
    if (!c.kodi_only) acts.append(TN.button('btn ghost', TN.t('iptv_guide'), () => epg.sheet(c, c.name_he && TN.lang() === 'he' ? c.name_he : c.name)));
  }
  const shown = (c) => (TN.lang() === 'he' && c.name_he ? c.name_he : c.name);
  function chCard(c, epg) {
    const dead = isDead(c);
    const el = TN.card(c.logo || 'icon.png', shown(c), c.kodi_only ? TN.t('kodi_only') : (TN.t('grp_' + c.cls) || c.group),
                       () => open(c), 'wide' + (c.kodi_only || dead ? ' dim' : ''), c.kodi_only ? 'KODI' : dead ? TN.t('iptv_dead') : 'LIVE');
    if (epg && !c.kodi_only) { const b = epg.bar(c); if (b.childNodes.length) el.append(b); }
    return el;
  }

  // ---- the world by country (iptv-org's country list, names in the viewer's language)
  let countries = null;
  async function countryList() {
    if (!countries) {
      const r = await fetch('https://iptv-org.github.io/api/countries.json');
      const rows = r.ok ? await r.json() : [];
      let dn = null;
      try { dn = new Intl.DisplayNames([TN.lang()], {type: 'region'}); } catch (e) {}
      countries = rows.filter((c) => /^[A-Z]{2}$/.test(c.code))
        .map((c) => ({code: c.code, flag: c.flag || '', name: (dn && dn.of(c.code)) || c.name}))
        .sort((a, b) => (a.code === 'IL' ? -1 : b.code === 'IL' ? 1 : a.name.localeCompare(b.name, TN.lang())));
    }
    return countries;
  }

  async function render(arg, ctx) {
    const [first = '', second = ''] = String(arg || '').split('/');
    const start = TN.settings.get('live', 'tn');
    const list = first === 'countries' || first.startsWith('c:') || first === 'tn' || LISTS[first] ? first : (start === 'tn' || LISTS[start] ? start : 'tn');
    const grp = second.startsWith('g:') ? second.slice(2) : '';
    TN.page('live');
    const names = {};
    ['tn'].concat(Object.keys(LISTS)).forEach((k) => { names[k] = TN.t('iptv_l_' + k); });
    TN.chips(Object.entries(names).concat([['countries', TN.t('iptv_countries')]]),
             list.startsWith('c:') ? 'countries' : list, (k) => TN.go('#/live/' + k));
    const view = TN.view();
    if (list === 'countries') {
      const sk = TN.skeleton();
      const rows = await countryList().catch(() => []);
      if (!ctx.current()) return;
      sk.remove();
      const box = document.createElement('div');
      box.className = 'chips';
      rows.forEach((c) => { const a = document.createElement('a'); a.className = 'chip'; a.href = '#/live/c:' + c.code; a.textContent = (c.flag ? c.flag + ' ' : '') + c.name; box.append(a); });
      const h = document.createElement('h2');
      h.textContent = TN.t('iptv_world');
      view.append(h, box);
      return;
    }
    const sk = TN.skeleton();
    const [data, epg] = await Promise.all([load(list), TN.provider('epg').catch(() => null)]);
    if (epg) await epg.ready();
    if (!ctx.current()) return;
    sk.remove();
    let items = data.items;
    if (list === 'tn') items = items.filter((c) => !c.kodi_only).concat(items.filter((c) => c.kodi_only));
    const present = GROUPS.filter((g) => items.some((c) => c.cls === g));
    if (present.length > 1) {
      TN.chips([['', TN.t('iptv_all')]].concat(present.map((g) => [g, TN.t('grp_' + g)])), grp,
               (g) => TN.go('#/live/' + list + (g ? '/g:' + g : '')));
    }
    if (grp) items = items.filter((c) => c.cls === grp);
    const tools = document.createElement('div');
    tools.className = 'links';
    const filter = document.createElement('input');
    filter.type = 'search'; filter.placeholder = TN.t('iptv_filter'); filter.setAttribute('aria-label', TN.t('iptv_filter')); filter.dir = 'auto';
    const status = document.createElement('span');
    status.className = 'hint'; status.setAttribute('role', 'status');
    tools.append(filter);
    if (list !== 'tn') {
      tools.append(TN.button('btn ghost', TN.t('iptv_check'), async (e) => {
        e.target.disabled = true;
        const n = await checkAll(items, (d, all) => { status.textContent = TN.t('iptv_checking', d, all); });
        if (ctx.current()) { status.textContent = TN.t('iptv_checked', n); draw(); }
      }));
    }
    tools.append(status);
    view.append(tools);
    const title = list.startsWith('c:') ? ((countries || []).find((c) => c.code === list.slice(2)) || {}).name || list.slice(2) : names[list] || list;
    const g = TN.section(title + (grp ? ' · ' + TN.t('grp_' + grp) : ''), items.length);
    function draw() {
      const q = filter.value.trim().toLowerCase();
      g.innerHTML = '';
      const shownItems = items.filter((c) => !q || [c.name, c.name_he].concat(c.names || []).some((n) => n && n.toLowerCase().includes(q)));
      // dead ones last
      shownItems.filter((c) => !isDead(c)).concat(shownItems.filter(isDead)).forEach((c) => g.append(chCard(c, epg)));
      if (!shownItems.length) TN.empty(g);
    }
    filter.addEventListener('input', draw);
    draw();
    if (data.http) view.insertAdjacentHTML('beforeend', `<p class="hint">${TN.esc(TN.t('iptv_http', data.http))}</p>`);
    if (list === 'tn') view.insertAdjacentHTML('beforeend', `<p class="hint">${TN.esc(TN.t('kodi_list_hint'))}</p>`);
  }
  TN.registerPage('live', render);

  TN.registerProvider('iptv', {
    kinds: ['search'], label: TN.t('iptv_label'),
    async search(q, opts = {}) {
      const n = String(q || '').trim().toLowerCase();
      if (n.length < 2) return [];
      const lists = await Promise.all(['tn', 'il'].map((l) => load(l).catch(() => ({items: []}))));
      const seen = new Set(), out = [];
      for (const c of lists.flatMap((d) => d.items)) {
        const hit = [c.name, c.name_he].concat(c.names || []).some((x) => x && x.toLowerCase().includes(n));
        const k = normKey(c.name);
        if (!hit || seen.has(k)) continue;
        seen.add(k);
        out.push({title: shown(c), sub: TN.t('live'), img: c.logo || '', kind: 'live', score: c.name.toLowerCase() === n ? 1 : 0.6, open: () => open(c)});
        if (out.length >= (opts.limit || 20)) break;
      }
      return out;
    },
  });
  // tests
  TN.registerProvider('iptv_lib', {kinds: [], parseM3u, merge, classify, displayName, probe, checkAll, isDead});
})(self.TN);
