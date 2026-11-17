'use strict';
// TeleNova web, WP-8: hub search (plan rows 2 and 15) - the build's providers.run_search / rank on the web.
// #/hub: search box, recent searches, the topics and YouTube tiles.  #/search/<q>: every 'search' provider in parallel,
// each section drawn as soon as its provider answers (12 s each at most), ranked like providers.rank; a "best
// matches" row on top mixes the exact hits of all providers. "S01E02" / "עונה 1 פרק 2" in the query is parsed and
// passed on ({season, episode, show}).
// Providers registered here: tmdb, archive, dailymotion (+ live / radio from app.js when WP-7's modules are absent).
(function (TN) {
  if (!TN) return;
  TN.i18n.add({
    he: {hub_best: 'ההתאמות הטובות ביותר', hub_titles: 'סרטים וסדרות', hub_ia: 'ארכיון האינטרנט', hub_dm: 'Dailymotion', hub_live: 'ערוצים',
      hub_radio: 'רדיו', hub_topics: 'אקטואליה וידע', hub_none: 'לא נמצא כלום.', hub_ep: 'מחפש: %s', hub_wait: 'מחפש ב-%s מקורות...',
      hub_yt_need: 'YouTube: צריך מפתח או עוזר כדי לחפש גם שם.'},
    en: {hub_best: 'Best matches', hub_titles: 'Movies & series', hub_ia: 'Internet Archive', hub_dm: 'Dailymotion', hub_live: 'Channels',
      hub_radio: 'Radio', hub_topics: 'News & knowledge', hub_none: 'Nothing found.', hub_ep: 'Looking for: %s', hub_wait: 'Searching %s sources...',
      hub_yt_need: 'YouTube: a key or the helper is needed to search there too.'},
    ru: {hub_best: 'Лучшие совпадения', hub_titles: 'Фильмы и сериалы', hub_ia: 'Интернет-архив', hub_dm: 'Dailymotion', hub_live: 'Каналы',
      hub_radio: 'Радио', hub_topics: 'Новости и знания', hub_none: 'Ничего не найдено.', hub_ep: 'Ищем: %s', hub_wait: 'Поиск в %s источниках...',
      hub_yt_need: 'YouTube: для поиска нужен ключ или помощник.'},
  });
  const PER_TIMEOUT = 12000;

  // ------------------------------------------------------------ pure logic (providers.py rank, epmatch.parse subset)
  const words = (s) => String(s || '').replace(/\[\/?[A-Z]+[^\]]*\]/g, '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
  function score(title, q) {                     // 0 = whole query, 1 = every word, 2 = otherwise
    const qw = words(q);
    if (!qw.length) return 2;
    const w = words(title);
    return (' ' + w.join(' ') + ' ').includes(' ' + qw.join(' ') + ' ') || w.join(' ').includes(qw.join(' ')) ? 0
      : qw.every((x) => w.includes(x)) ? 1 : 2;
  }
  function rank(items, q) {                      // stable: equal scores keep the source's order
    if (!words(q).length) return items.slice();
    return items.map((it, i) => [score(it.title, q), i, it]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
  }
  const N = '(\\d{1,3})';
  const SE = [
    new RegExp('(?:^|[^\\p{L}\\p{N}])s' + N + '[\\s._-]*e' + N + '(?![\\p{N}])', 'iu'),
    new RegExp('(?:^|[^\\p{L}\\p{N}])' + N + 'x' + N + '(?![\\p{N}])', 'iu'),
    new RegExp('season[\\s._-]*' + N + '[\\s,._-]*(?:episode|ep\\.?)[\\s._-]*' + N, 'iu'),
    new RegExp('(?:עונה|ע)[\\s\'"׳._-]*' + N + '[\\s,._-]*(?:פרק|פ)[\\s\'"׳._-]*' + N, 'u'),
    new RegExp(N + '\\s*сезон[\\s,._-]*' + N + '\\s*сери', 'iu'),
  ];
  const S_ONLY = [new RegExp('(?:^|[^\\p{L}\\p{N}])s' + N + '(?![\\p{N}e])', 'iu'), new RegExp('season[\\s._-]*' + N, 'iu'), new RegExp('עונה[\\s\'"׳._-]*' + N, 'u')];
  const E_ONLY = [new RegExp('(?:episode|ep\\.?)[\\s._-]*' + N, 'iu'), new RegExp('פרק[\\s\'"׳._-]*' + N, 'u')];
  function parseQuery(q) {                       // -> {show, season, episode}  (null when not given)
    q = String(q || '');
    for (const rx of SE) {
      const m = q.match(rx);
      if (m) return {show: tidy(q.replace(m[0], ' ')), season: +m[1], episode: +m[2]};
    }
    let season = null, episode = null, rest = q;
    for (const rx of S_ONLY) { const m = rest.match(rx); if (m) { season = +m[1]; rest = rest.replace(m[0], ' '); break; } }
    for (const rx of E_ONLY) { const m = rest.match(rx); if (m) { episode = +m[1]; rest = rest.replace(m[0], ' '); break; } }
    return {show: season == null && episode == null ? tidy(q) : tidy(rest), season, episode};
  }
  const tidy = (s) => s.replace(/[\s,._-]+/g, ' ').trim();
  const seLabel = (w) => [w.season != null ? 'S' + String(w.season).padStart(2, '0') : '', w.episode != null ? 'E' + String(w.episode).padStart(2, '0') : ''].join('');
  function bestOf(groups, q, limit = 12) {     // the whole-query hits of every provider, interleaved
    const lists = groups.map((g) => g.items.filter((it) => score(it.title, q) === 0));
    const out = [], seen = new Set();
    for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) {
      for (const l of lists) {
        const it = l[i];
        if (it && out.length < limit) { const k = (it.title || '').toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(it); } }
      }
    }
    return out;
  }

  // ------------------------------------------------------------ providers
  const fmt = (s) => { s = +s || 0; const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return s ? (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0') : ''; };
  const DM_ID = /^[a-zA-Z0-9]{5,12}$/;
  function playDm(v) {
    if (!DM_ID.test(v.id || '')) return;
    TN.noteHistory({key: 'dm:' + v.id, label: v.title || 'Dailymotion', play: 'https://www.dailymotion.com/video/' + v.id, thumb: v.img || ''});
    TN.modal(`<div class="player"><iframe src="https://www.dailymotion.com/embed/video/${encodeURIComponent(v.id)}?autoplay=1" ` +
      `allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="${TN.esc(v.title || 'Dailymotion')}"></iframe></div>` +
      `<h2 dir="auto">${TN.esc(v.title || '')}</h2><p class="hint" dir="auto">${TN.esc([v.owner, fmt(v.secs)].filter(Boolean).join(' · '))}</p>`);
  }
  TN.addHistoryHandler((e) => {
    const m = String((e && e.key) || '').match(/^dm:([a-zA-Z0-9]{5,12})$/);
    if (!m) return false;
    playDm({id: m[1], title: e.label, img: e.thumb});
    return true;
  });
  function parseDm(d) {
    return ((d && d.list) || []).filter((x) => DM_ID.test(x.id || '')).map((x) => ({id: x.id, title: x.title || '', img: TN.httpsOnly(x.thumbnail_360_url || ''),
      secs: +x.duration || 0, owner: x['owner.screenname'] || ''}));
  }
  TN.registerProvider('dailymotion', {
    kinds: ['search'], label: 'Dailymotion', parse: parseDm, play: playDm,
    async search(q, {signal, limit = 20} = {}) {
      const qs = new URLSearchParams({search: q, fields: 'id,title,thumbnail_360_url,duration,owner.screenname', limit: Math.min(limit, 50),
        sort: 'relevance', family_filter: 'true'});
      const r = await fetch('https://api.dailymotion.com/videos?' + qs, {signal});
      if (!r.ok) return [];
      return parseDm(await r.json()).map((v) => ({title: v.title, sub: [v.owner, fmt(v.secs)].filter(Boolean).join(' · '), img: v.img, kind: 'wide', open: () => playDm(v)}));
    },
  });
  TN.registerProvider('tmdb', {
    kinds: ['search'], label: TN.t('hub_titles'),
    async search(q, {want} = {}) {
      if (!TN.hasTmdbKey()) return [];
      const d = await TN.tmdb('/search/multi', {query: (want && want.show) || q, include_adult: 'false'});
      return (d.results || []).filter((x) => x.media_type === 'movie' || x.media_type === 'tv').map((x) => ({
        title: x.title || x.name, sub: (x.release_date || x.first_air_date || '').slice(0, 4) + (x.media_type === 'tv' && want && (want.season != null) ? ' · ' + seLabel(want) : ''),
        img: x.poster_path ? TN.tmdbImg(x.poster_path) : 'icon.png', kind: '', open: () => TN.openTitle(x.media_type, x.id)}));
    },
  });
  TN.registerProvider('archive', {
    kinds: ['search'], label: TN.t('hub_ia'),
    async search(q) {
      const docs = await TN.archive({q});
      return docs.map((d) => ({title: d.title, sub: String(d.year || ''), img: 'https://archive.org/services/img/' + encodeURIComponent(d.identifier), kind: '', open: () => TN.openArchive(d)}));
    },
  });
  // live / radio: app.js's own lists, only while WP-7's iptv / radio modules do not register their own search
  const fallbacks = [
    ['hub_live', async (q) => {
      const ql = q.toLowerCase(), seen = new Set();
      const all = await Promise.all(['tn', 'il', 'he', 'ru', 'en'].map((l) => TN.channels(l).catch(() => [])));
      return all.flat().filter((c) => (c.names && c.names.length ? c.names : [c.name]).join('\n').toLowerCase().includes(ql) && !seen.has(c.url || c.key) && seen.add(c.url || c.key))
        .slice(0, 40).map((c) => ({title: (TN.lang() === 'he' && c.name_he) || c.name, sub: c.group || '', img: c.logo || 'icon.png', kind: 'wide', open: () => TN.openChannel(c)}));
    }, 'iptv'],
    ['hub_radio', async (q) => (await TN.stations('', q)).map((s) => ({title: String(s.name || '').trim(), sub: [s.country, s.tags && s.tags.split(',')[0]].filter(Boolean).join(' · '),
      img: s.favicon || 'icon.png', kind: 'square', open: () => TN.playRadio(s)})), 'radio'],
  ];

  // ------------------------------------------------------------ pages
  function box(q) {
    const f = document.createElement('form');
    f.className = 'hubform';
    f.innerHTML = `<input type="search" autocomplete="off" dir="auto" aria-label="${TN.esc(TN.t('m_hub'))}" placeholder="${TN.esc(TN.t('search'))}">`;
    f.firstChild.value = q || '';
    f.append(TN.button('btn', TN.t('core_search_go'), null));
    f.onsubmit = (e) => { e.preventDefault(); TN.doSearch(f.firstChild.value); };
    TN.view().append(f);
    return f;
  }
  TN.registerPage('hub', () => {
    TN.page('', TN.t('m_hub'));
    box('').firstChild.focus();
    TN.view().insertAdjacentHTML('beforeend', `<p class="hint">${TN.esc(TN.t('core_hub_txt'))}</p>`);
    const recent = TN.store.searches().slice(0, 12);
    if (recent.length) TN.chips(recent.map((q) => [q, '↺ ' + q]), '', (q) => TN.doSearch(q));
    const g = TN.section('', null);
    g.previousElementSibling.remove();
    g.append(TN.card('data/topics/img/topic_tech.png', TN.t('hub_topics'), null, () => TN.go('#/topics'), 'square'),
      TN.card('data/topics/img/topic_news_world.png', 'YouTube', null, () => TN.go('#/youtube'), 'square'));
  });

  TN.registerPage('search', async (q, ctx) => {
    q = String(q || '').trim();
    const qi = document.getElementById('q');
    if (qi) qi.value = q;
    TN.page('', `${TN.t('results')} “${q}”`);
    if (!q) return;
    const view = TN.view();
    const want = parseQuery(q);
    if (want.season != null || want.episode != null) view.insertAdjacentHTML('beforeend', `<p class="hint" dir="auto">${TN.esc(TN.t('hub_ep', (want.show + ' ' + seLabel(want)).trim()))}</p>`);
    const bestH = document.createElement('h2'), bestG = document.createElement('div');
    bestG.className = 'grid';
    bestH.hidden = bestG.hidden = true;
    bestH.textContent = TN.t('hub_best');
    const status = document.createElement('p');
    status.className = 'hint';
    status.setAttribute('role', 'status');
    view.append(status, bestH, bestG);

    const list = (await TN.providers('search')).filter((p) => typeof p.search === 'function');
    if (!ctx.current()) return;
    const names = new Set(list.map((p) => p.name));
    const jobs = list.map((p) => ({label: p.label || p.name, name: p.name, run: (o) => p.search(o.query, o)}));
    for (const [k, fn, mod] of fallbacks) if (!names.has(mod) && TN.providerOn(mod)) jobs.push({label: TN.t(k), name: mod, run: (o) => fn(o.query)});
    try {                                      // topics: only what this visit already loaded (no new requests)
      const tp = TN.providerOn('topics') ? await TN.provider('topics') : null;
      if (tp && tp.searchLoaded) jobs.push({label: TN.t('hub_topics'), name: 'topics', run: async (o) => {
        const Y = await TN.provider('yt');
        return tp.searchLoaded(o.query).slice(0, 30).map((v) => ({title: v.title, sub: v.channel, img: v.img, kind: 'wide', open: () => Y.play(v)}));
      }});
    } catch (e) {}
    const yt = list.find((p) => p.name === 'yt');
    if (yt && yt.ready && !yt.ready()) view.insertAdjacentHTML('beforeend', `<p class="hint"><a href="#/youtube">${TN.esc(TN.t('hub_yt_need'))}</a></p>`);

    // one place per provider, in registry order, so sections never jump around as answers arrive
    const slots = jobs.map(() => { const d = document.createElement('div'); view.append(d); return d; });
    const groups = [];
    let left = jobs.length, total = 0;
    status.textContent = TN.t('hub_wait', left);
    const ctl = new AbortController();
    const offRoute = TN.on('route', () => { if (!ctx.current()) { ctl.abort(); offRoute(); } });
    await Promise.all(jobs.map(async (j, i) => {
      let items = [];
      const timer = new Promise((res) => setTimeout(() => res([]), PER_TIMEOUT));
      try {
        items = await Promise.race([j.run({query: q, signal: ctl.signal, limit: 30, want, season: want.season, episode: want.episode, show: want.show}), timer]) || [];
      } catch (e) { items = []; }
      left--;
      if (!ctx.current()) return;
      status.textContent = left ? TN.t('hub_wait', left) : '';
      items = rank(items.filter((it) => it && it.title && typeof it.open === 'function'), q);
      if (!items.length) { slots[i].remove(); return; }
      total += items.length;
      groups[i] = {items};
      const h = document.createElement('h2');
      h.innerHTML = TN.esc(j.label) + ` <small>${items.length}</small>`;
      const g = document.createElement('div');
      g.className = 'grid';
      items.forEach((it) => g.append(TN.card(it.img || 'icon.png', it.title, it.sub, () => it.open(), it.kind || '')));
      slots[i].append(h, g);
      const best = bestOf(groups.filter(Boolean), q);
      if (best.length >= 2 && groups.filter(Boolean).length > 1) {
        bestG.replaceChildren(...best.map((it) => TN.card(it.img || 'icon.png', it.title, it.sub, () => it.open(), it.kind || '')));
        bestH.hidden = bestG.hidden = false;
      }
    }));
    offRoute();
    if (ctx.current() && !total) view.insertAdjacentHTML('beforeend', `<p class="msg">${TN.esc(TN.t('hub_none'))}</p>`);
  });

  self.TNHub = {rank, score, parseQuery, seLabel, bestOf, parseDm};     // for the tests
})(self.TN);
