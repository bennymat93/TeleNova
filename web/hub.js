'use strict';
// TeleNova web, WP-8: hub search (plan rows 2 and 15) - the build's providers.run_search / rank on the web.
// #/hub: search box, recent searches, the topics and YouTube tiles.  #/search/<q>: every 'search' provider in parallel,
// each section drawn as soon as its provider answers (12 s each at most), ranked like providers.rank; a "best
// matches" row on top mixes the exact hits of all providers. "S01E02" / "עונה 1 פרק 2" in the query is parsed and
// passed on ({season, episode, show}).
// Providers registered here: tmdb (key-less: Cinemeta through catalog.js), archive, dailymotion (+ live / radio from app.js when
// WP-7's modules are absent). Dailymotion plays in the site player from Dailymotion's own HLS description; when that does
// not answer: its embed frame if the page policy allows it, else a link to dailymotion.com (never a dead card).
// A link pasted into the search box (t.me, YouTube, Dailymotion, archive.org) opens directly.
(function (TN) {
  if (!TN) return;
  TN.i18n.add({
    he: {hub_best: 'ההתאמות הטובות ביותר', hub_titles: 'סרטים וסדרות', hub_ia: 'ארכיון האינטרנט', hub_dm: 'Dailymotion', hub_live: 'ערוצים',
      hub_radio: 'רדיו', hub_topics: 'אקטואליה וידע', hub_srcs: 'מקורות שנבדקו', hub_src_off: 'לא מחובר – לחצו לחיבור', hub_src_late: 'לא ענה', hub_src_none: 'אין', hub_none: 'לא נמצא כלום.', hub_ep: 'מחפש: %s', hub_wait: 'מחפש ב-%s מקורות...',
      hub_yt_need: 'YouTube: צריך מפתח או עוזר כדי לחפש גם שם.', hub_dm_open: 'פתיחה ב-Dailymotion', hub_dm_wait: 'טוען את הסרטון...',
      hub_dm_fail: 'הסרטון לא נפתח בנגן של האתר. אפשר לפתוח אותו ב-Dailymotion.', hub_tg: 'חיפוש בטלגרם', hub_yt: 'YouTube', hub_live_tile: 'טלוויזיה חיה',
      hub_radio_tile: 'רדיו', hub_movies: 'סרטים', hub_series: 'סדרות', hub_more: 'עוד מקומות לחפש בהם', hub_all: 'הכול', hub_recent: 'חיפושים אחרונים',
      hub_retry: 'חיפוש חוזר', hub_paste: 'קישור שהודבק נפתח ישר (t.me, YouTube, Dailymotion, archive.org).'},
    en: {hub_best: 'Best matches', hub_titles: 'Movies & series', hub_ia: 'Internet Archive', hub_dm: 'Dailymotion', hub_live: 'Channels',
      hub_radio: 'Radio', hub_topics: 'News & knowledge', hub_srcs: 'Sources searched', hub_src_off: 'not connected - press to connect', hub_src_late: 'no answer', hub_src_none: 'none', hub_none: 'Nothing found.', hub_ep: 'Looking for: %s', hub_wait: 'Searching %s sources...',
      hub_yt_need: 'YouTube: a key or the helper is needed to search there too.', hub_dm_open: 'Open on Dailymotion', hub_dm_wait: 'Loading the video...',
      hub_dm_fail: 'The video did not open in the site player. You can open it on Dailymotion.', hub_tg: 'Telegram search', hub_yt: 'YouTube', hub_live_tile: 'Live TV',
      hub_radio_tile: 'Radio', hub_movies: 'Movies', hub_series: 'Series', hub_more: 'More places to search', hub_all: 'All', hub_recent: 'Recent searches',
      hub_retry: 'Search again', hub_paste: 'A pasted link opens directly (t.me, YouTube, Dailymotion, archive.org).'},
    ru: {hub_best: 'Лучшие совпадения', hub_titles: 'Фильмы и сериалы', hub_ia: 'Интернет-архив', hub_dm: 'Dailymotion', hub_live: 'Каналы',
      hub_radio: 'Радио', hub_topics: 'Новости и знания', hub_srcs: 'Проверенные источники', hub_src_off: 'не подключён - нажмите', hub_src_late: 'нет ответа', hub_src_none: 'нет', hub_none: 'Ничего не найдено.', hub_ep: 'Ищем: %s', hub_wait: 'Поиск в %s источниках...',
      hub_yt_need: 'YouTube: для поиска нужен ключ или помощник.', hub_dm_open: 'Открыть в Dailymotion', hub_dm_wait: 'Загрузка видео...',
      hub_dm_fail: 'Видео не открылось в плеере сайта. Его можно открыть в Dailymotion.', hub_tg: 'Поиск в Telegram', hub_yt: 'YouTube', hub_live_tile: 'Прямой эфир',
      hub_radio_tile: 'Радио', hub_movies: 'Фильмы', hub_series: 'Сериалы', hub_more: 'Где ещё искать', hub_all: 'Все', hub_recent: 'Недавние запросы',
      hub_retry: 'Искать снова', hub_paste: 'Вставленная ссылка открывается сразу (t.me, YouTube, Dailymotion, archive.org).'},
  });
  const PER_TIMEOUT = 20000;                     // 5.2.1: Telegram's deep search and a cold helper need more than 12 s

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

  // a result's `kind` -> the card shape. Providers say what the thing IS (live / radio / tg / yt ...); the grid knows only
  // poster (''), wide and square - an unknown word must never become a CSS class (it drew tall empty poster cards).
  const SHAPES = {'': '', poster: '', movie: '', tv: '', series: '', title: '', wide: 'wide', live: 'wide', channel: 'wide', tg: 'wide', telegram: 'wide',
    video: 'wide', yt: 'wide', youtube: 'wide', dm: 'wide', square: 'square', radio: 'square', station: 'square', topic: 'square'};
  const shapeOf = (kind) => { const k = String(kind || '').trim().split(/\s+/)[0].toLowerCase(); return Object.prototype.hasOwnProperty.call(SHAPES, k) ? SHAPES[k] : ''; };
  // a pasted link in the search box -> where it opens ('' = an ordinary search)
  function linkTarget(q) {
    q = String(q || '').trim();
    if (/\s/.test(q)) return '';
    if (/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/\S+$/i.test(q)) return TN.link('telegram', {link: /^http/i.test(q) ? q : 'https://' + q});
    if (/^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/\S+$/i.test(q)) return TN.link('youtube', {url: /^http/i.test(q) ? q : 'https://' + q});
    const dm = q.match(/^(?:https?:\/\/)?(?:www\.)?(?:dailymotion\.com\/(?:embed\/)?video|dai\.ly)\/([a-zA-Z0-9]{5,12})/i);
    if (dm) return 'dm:' + dm[1];
    const ia = q.match(/^(?:https?:\/\/)?archive\.org\/(?:details|embed)\/([A-Za-z0-9._-]{2,120})/i);
    if (ia) return 'ia:' + ia[1];
    return '';
  }

  // ------------------------------------------------------------ providers
  const fmt = (s) => { s = +s || 0; const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return s ? (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0') : ''; };
  const DM_ID = /^[a-zA-Z0-9]{5,12}$/;
  // Dailymotion's own player description (the address its web player and the Kodi add-on read): the HLS stream of a video
  function pickDm(j) {
    const q = (j && j.qualities) || {};
    const ok = (x) => x && typeof x.url === 'string' && /^https:\/\//i.test(x.url);
    const hls = (q.auto || []).find((x) => ok(x) && /mpegurl/i.test(x.type || ''));
    if (hls) return {url: hls.url, mime: 'application/x-mpegURL'};
    const sizes = Object.keys(q).filter((k) => /^\d+$/.test(k)).sort((a, b) => b - a);
    for (const k of sizes) { const mp4 = (q[k] || []).find((x) => ok(x) && /mp4/i.test(x.type || '')); if (mp4) return {url: mp4.url, mime: 'video/mp4'}; }
    return null;
  }
  // may the page put a frame of this host on the screen (the Content-Security-Policy of index.html)?
  function frameAllowed(host, csp) {
    if (csp == null) { const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]'); csp = m ? m.getAttribute('content') || '' : ''; }
    if (!csp) return true;
    const dir = csp.split(';').map((x) => x.trim().split(/\s+/)).find((x) => x[0] === 'frame-src') || csp.split(';').map((x) => x.trim().split(/\s+/)).find((x) => x[0] === 'default-src');
    if (!dir) return true;
    return dir.slice(1).some((src) => src === 'https:' || src === '*' || src === 'https://' + host || (src.startsWith('https://*.') && host.endsWith(src.slice(9))));
  }
  const dmPage = (id) => 'https://www.dailymotion.com/video/' + encodeURIComponent(id);
  async function playDm(v) {
    if (!DM_ID.test(v.id || '')) return;
    const hist = {key: 'dm:' + v.id, label: v.title || 'Dailymotion', play: dmPage(v.id), thumb: v.img || ''};
    const sub = TN.esc([v.owner, fmt(v.secs)].filter(Boolean).join(' · '));
    const out = `<a class="btn ghost" target="_blank" rel="noopener" href="${TN.esc(dmPage(v.id))}">${TN.esc(TN.t('hub_dm_open'))}</a>`;
    TN.modal(`<p class="msg" id="hub_dm" role="status">${TN.esc(TN.t('hub_dm_wait'))}</p><h2 dir="auto">${TN.esc(v.title || '')}</h2><div class="links">${out}</div>`);
    const mine = document.getElementById('hub_dm');
    let st = null;
    try {
      const r = await fetch('https://www.dailymotion.com/player/metadata/video/' + encodeURIComponent(v.id), {credentials: 'omit'});
      if (r.ok) st = pickDm(await r.json());
    } catch (e) {}
    if (!mine || !mine.isConnected) return;         // the viewer closed the sheet meanwhile
    const pl = st ? await TN.provider('player').catch(() => null) : null;
    if (pl && typeof pl.open === 'function') {
      return pl.open({url: st.url, mime: st.mime, title: v.title || 'Dailymotion', poster: v.img || '', resumeKey: hist.key, history: hist});
    }
    TN.noteHistory(hist);
    if (frameAllowed('www.dailymotion.com')) {
      TN.modal(`<div class="player"><iframe src="https://www.dailymotion.com/embed/video/${encodeURIComponent(v.id)}?autoplay=1" ` +
        `allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="${TN.esc(v.title || 'Dailymotion')}"></iframe></div>` +
        `<h2 dir="auto">${TN.esc(v.title || '')}</h2><p class="hint" dir="auto">${sub}</p><div class="links">${out}</div>`);
      return;
    }
    mine.textContent = TN.t('hub_dm_fail');
    const a = mine.parentNode.querySelector('.links a');
    if (a) { a.className = 'btn'; a.focus(); }
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
    kinds: ['search'], label: 'Dailymotion', parse: parseDm, play: playDm, pick: pickDm,
    async search(q, {signal, limit = 20} = {}) {
      const qs = new URLSearchParams({search: q, fields: 'id,title,thumbnail_360_url,duration,owner.screenname', limit: Math.min(limit, 50),
        sort: 'relevance', family_filter: 'true'});
      const r = await fetch('https://api.dailymotion.com/videos?' + qs, {signal});
      if (!r.ok) return [];
      return parseDm(await r.json()).map((v) => ({title: v.title, sub: [v.owner, fmt(v.secs)].filter(Boolean).join(' · '), img: v.img, kind: 'wide', open: () => playDm(v)}));
    },
  });
  // 5.2.1: the key-less catalogue (Cinemeta) knows English names only, so "פאודה" or "Бригада" found no title at all
  // without a TMDb key. Wikidata (open, CORS) knows a film or series by its name in any language and by its IMDb id:
  // -> [{imdb: 'tt...', en: 'English name'}], at most 4, [] on any failure.
  const WD = 'https://www.wikidata.org/w/api.php?format=json&origin=*&';
  const wikiCache = new Map();
  async function wikiTitles(q, signal) {
    const key = q.toLowerCase();
    if (wikiCache.has(key)) return wikiCache.get(key);
    const lang = /[\u0590-\u05ff]/.test(q) ? 'he' : /[\u0400-\u04ff]/.test(q) ? 'ru' : /[\u0600-\u06ff]/.test(q) ? 'ar' : 'en';
    let out = [];
    try {
      const r = await fetch(WD + new URLSearchParams({action: 'wbsearchentities', search: q, language: lang, uselang: lang, type: 'item', limit: '8'}), {signal});
      const ids = ((await r.json()).search || []).map((x) => x.id).filter((x) => /^Q\d+$/.test(x));
      if (ids.length) {
        const r2 = await fetch(WD + new URLSearchParams({action: 'wbgetentities', ids: ids.join('|'), props: 'claims|labels', languages: 'en'}), {signal});
        const ents = (await r2.json()).entities || {};
        for (const id of ids) {
          const e = ents[id] || {}, c = (e.claims && e.claims.P345 && e.claims.P345[0]) || null;
          const imdb = c && c.mainsnak && c.mainsnak.datavalue && String(c.mainsnak.datavalue.value || '');
          const en = e.labels && e.labels.en && String(e.labels.en.value || '');
          if (/^tt\d{6,10}$/.test(imdb || '') && en) out.push({imdb, en});
          if (out.length >= 4) break;
        }
      }
    } catch (e) { out = []; }
    if (!signal || !signal.aborted) wikiCache.set(key, out);
    return out;
  }
  TN.registerProvider('tmdb', {
    kinds: ['search'], label: TN.t('hub_titles'),
    async search(q, {want, signal} = {}) {
      const text = (want && want.show) || q;
      const se = want && want.season != null ? ' · ' + seLabel(want) : '';
      if (!TN.hasTmdbKey()) {                    // no key: the key-less catalogue (Cinemeta), films and series
        const C = await TN.provider('catalog');
        if (!C || !C.cineSearch) return [];
        let both = await Promise.all(['movie', 'tv'].map((m) => C.cineSearch(m, text).catch(() => [])));
        let out = [];
        for (let i = 0; i < Math.max(both[0].length, both[1].length) && out.length < 40; i++) for (const l of both) if (l[i]) out.push(l[i]);
        if (/[^\u0000-\u024f]/.test(text)) {     // a name not in Latin letters: by its IMDb id through Wikidata, exact titles first
          const exact = [], seen = new Set();
          for (const w of await wikiTitles(text, signal)) {
            both = await Promise.all(['movie', 'tv'].map((m) => C.cineSearch(m, w.en).catch(() => [])));
            for (const row of both[0].concat(both[1])) if (String(row.id) === w.imdb && !seen.has(row.media_type + row.id)) { seen.add(row.media_type + row.id); exact.push(row); }
          }
          out = exact.concat(out.filter((x) => !seen.has(x.media_type + x.id)));
        }
        return out.map((x) => ({title: x.title || x.name, sub: (x.release_date || x.first_air_date || '') + (x.media_type === 'tv' ? se : ''), img: x.poster || 'icon.png', kind: '',
          open: () => (x.media_type === 'tv' ? TN.go(C.link({m: 'tv', v: 'cseasons', id: x.id})) : C.openCine(x))}));
      }
      const d = await TN.tmdb('/search/multi', {query: text, include_adult: 'false'});
      return (d.results || []).filter((x) => x.media_type === 'movie' || x.media_type === 'tv').map((x) => ({
        title: x.title || x.name, sub: (x.release_date || x.first_air_date || '').slice(0, 4) + (x.media_type === 'tv' ? se : ''),
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

  // the stored search history is rows {q, ts} (store.js, the build's search_history.json): -> the texts, newest first
  function recentSearches(list, limit) {
    const out = [];
    for (const h of list || []) {
      const q = String(h && typeof h === 'object' ? h.q || '' : h || '').trim();
      if (q && !out.includes(q)) out.push(q);
      if (out.length >= (limit || 12)) break;
    }
    return out;
  }

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
  function go(q) {
    const tgt = linkTarget(q);
    if (!tgt) return TN.doSearch(q);
    if (tgt.startsWith('dm:')) return playDm({id: tgt.slice(3), title: 'Dailymotion'});
    if (tgt.startsWith('ia:')) return TN.openArchive({identifier: tgt.slice(3), title: tgt.slice(3)});
    TN.go(tgt);
  }
  TN.registerPage('hub', () => {
    TN.page('', TN.t('m_hub'));
    const f = box('');
    f.onsubmit = (e) => { e.preventDefault(); go(f.firstChild.value); };
    f.firstChild.focus();
    TN.view().insertAdjacentHTML('beforeend', `<p class="hint">${TN.esc(TN.t('core_hub_txt'))} ${TN.esc(TN.t('hub_paste'))}</p>`);
    const recent = recentSearches(TN.store.searches(), 12);
    if (recent.length) {
      const c = TN.chips(recent.map((q) => [q, '↺ ' + q]), '', (q) => TN.doSearch(q));
      if (c && c.setAttribute) c.setAttribute('aria-label', TN.t('hub_recent'));
    }
    const g = TN.section(TN.t('hub_more'), null);
    const tiles = [['topics', 'data/topics/img/topic_tech.png', 'hub_topics'], ['youtube', 'data/topics/img/topic_news_world.png', 'hub_yt'],
      ['telegram', 'data/topics/img/topic_control.png', 'hub_tg'], ['movies', 'media/cats/genre_28.png', 'hub_movies'], ['tv', 'media/cats/genre_18.png', 'hub_series'],
      ['live', 'data/topics/img/topic_news_il.png', 'hub_live_tile'], ['radio', 'media/cats/genre_10402.png', 'hub_radio_tile']];
    for (const [key, img, label] of tiles) g.append(TN.card(img, TN.t(label), null, () => TN.go('#/' + key), 'square'));
  });

  TN.registerPage('search', async (q, ctx) => {
    q = String(q || '').trim();
    let cat = '';
    const cm = /^cat=([a-z]+)&q=([\s\S]*)$/.exec(q);
    if (cm) { cat = cm[1]; q = cm[2].trim(); }
    const qi = document.getElementById('q');
    if (qi) qi.value = q;
    // 6.5.1: an empty search (a cleared address, a bad link) is not a blank "Results" page: the search screen, in this
    // history entry (so Back does not come back here)
    if (!q) { setTimeout(() => { if (ctx.current()) TN.go('#/hub', {replace: true}); }, 0); return; }
    TN.page('', `${TN.t('results')} “${q}”`);
    const direct = linkTarget(q);                 // a link typed into the search box opens, it is not searched for
    if (direct) { box(q); return go(q); }
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

    let list = (await TN.providers('search')).filter((p) => typeof p.search === 'function');
    let only = null;
    if (cat) { try { const SE = await TN.provider('srcedit'); only = SE && SE.providersOf(cat); } catch (e) { only = null; } }
    if (only) list = list.filter((p) => only.includes(p.name));
    if (!ctx.current()) return;
    const names = new Set(list.map((p) => p.name));
    const jobs = list.map((p) => ({label: p.label || p.name, name: p.name, run: (o) => p.search(o.query, o)}));
    for (const [k, fn, mod] of fallbacks) if (!names.has(mod) && TN.providerOn(mod) && (!only || only.includes(mod))) jobs.push({label: TN.t(k), name: mod, run: (o) => fn(o.query)});
    try {                                      // topics: only what this visit already loaded (no new requests)
      const tp = TN.providerOn('topics') && (!only || only.includes('topics')) ? await TN.provider('topics') : null;
      if (tp && tp.searchLoaded) jobs.push({label: TN.t('hub_topics'), name: 'topics', run: async (o) => {
        const Y = await TN.provider('yt');
        const found = tp.searchAll && Y && Y.ready && Y.ready() ? await tp.searchAll(o.query, {signal: o.signal}) : tp.searchLoaded(o.query);
        return found.slice(0, 30).map((v) => ({title: v.title, sub: v.channel, img: v.img, kind: 'wide', open: () => Y.play(v)}));
      }});
    } catch (e) {}
    const yt = list.find((p) => p.name === 'yt');
    if (yt && yt.ready && !yt.ready()) view.insertAdjacentHTML('beforeend', `<p class="hint"><a href="#/youtube">${TN.esc(TN.t('hub_yt_need'))}</a></p>`);

    // 5.2.1: "sources searched" - one chip per source with what it gave: a number, "nothing", "not connected" (a
    // link to the place that connects it) or "no answer". Every search asks every source; this line shows it.
    const srcBar = document.createElement('div');
    srcBar.className = 'hub_srcs';
    srcBar.setAttribute('aria-label', TN.t('hub_srcs'));
    if (!document.getElementById('hub_srcs_css')) {
      const st = document.createElement('style');
      st.id = 'hub_srcs_css';
      // 6.5.1: 36 px pills (40 on touch, a TV size), theme colours, and a pill that does nothing is not a focus stop
      st.textContent = '.hub_srcs{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 14px}.hub_src{display:inline-flex;gap:6px;align-items:center;min-height:36px;padding:0 12px;border-radius:999px;' +
        'border:1px solid var(--line,rgba(127,127,127,.35));font-size:13px;color:inherit;text-decoration:none;background:none;cursor:pointer;font-family:inherit}' +
        'html[data-input="touch"] .hub_src,html[data-shell="phone"] .hub_src{min-height:40px}html[data-shell="tv"] .hub_src{min-height:3.5rem;padding:0 1rem;font-size:inherit}' +
        '.hub_src[disabled]{cursor:default}.hub_src b{font-weight:600}.hub_src.ok{border-color:var(--ok,#3ddc84)}.hub_src.ok i{color:var(--ok,#3ddc84)}.hub_src.wait{opacity:.7}.hub_src.none{opacity:.6}' +
        '.hub_src.off,.hub_src.late{border-color:var(--accent-text,#ffc857)}.hub_src i{font-style:normal}';
      document.head.append(st);
    }
    view.insertBefore(srcBar, bestH);
    const chips = jobs.map((j) => {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'hub_src wait';
      c.disabled = true;                          // (a waiting pill does nothing; mark() enables the ones that do)
      c.innerHTML = `<b>${TN.esc(j.label)}</b><i>…</i>`;
      srcBar.append(c);
      return c;
    });
    const LINK = {tgsearch: '#/tglogin', yt: '#/services', rd: '#/services'};
    const mark = (i, state, n) => {
      const c = chips[i], name = jobs[i].name;
      c.className = 'hub_src ' + state;
      c.lastChild.textContent = state === 'ok' ? String(n) : TN.t(state === 'off' ? 'hub_src_off' : state === 'late' ? 'hub_src_late' : 'hub_src_none');
      c.onclick = state === 'ok' ? () => { if (slots[i] && slots[i].scrollIntoView) slots[i].scrollIntoView({behavior: 'smooth', block: 'start'}); }
        : state === 'off' && LINK[name] ? () => TN.go(LINK[name]) : null;
      c.disabled = !c.onclick;
    };
    // is a source that gave nothing simply not connected?
    const isOff = async (name) => {
      try {
        if (name === 'tgsearch') { const TG = await TN.tg(); return !(TG && TG.state && TG.state() === 'on'); }
        if (name === 'yt') return !!(yt && yt.ready && !yt.ready());
      } catch (e) { return name === 'tgsearch'; }
      return false;
    };
    // one place per provider, in registry order, so sections never jump around as answers arrive
    const slots = jobs.map(() => { const d = document.createElement('div'); view.append(d); return d; });
    // 6.5.1: one shared placeholder until the first source brought something (or all answered with nothing)
    const sk = document.createElement('div');
    view.append(sk);
    if (TN.skeleton) TN.skeleton(6, 'poster', sk);
    const dropSk = () => { if (sk.parentNode) sk.remove(); };
    const groups = [];
    let left = jobs.length, total = 0;
    status.textContent = TN.t('hub_wait', left);
    const ctl = new AbortController();
    const offRoute = TN.on('route', () => { if (!ctx.current()) { ctl.abort(); offRoute(); } });
    await Promise.all(jobs.map(async (j, i) => {
      let items = [], late = false, failed = false;
      const timer = new Promise((res) => setTimeout(() => { late = true; res([]); }, PER_TIMEOUT));
      try {
        items = await Promise.race([j.run({query: q, signal: ctl.signal, limit: 30, want, season: want.season, episode: want.episode, show: want.show}), timer]) || [];
      } catch (e) { items = []; failed = true; }
      left--;
      if (!ctx.current()) return;
      status.textContent = left ? TN.t('hub_wait', left) : '';
      items = rank(items.filter((it) => it && it.title && typeof it.open === 'function'), q);
      if (!items.length) {
        slots[i].remove(); slots[i] = null;
        mark(i, (await isOff(j.name)) ? 'off' : late || failed ? 'late' : 'none', 0);
        return;
      }
      mark(i, 'ok', items.length);
      total += items.length;
      groups[i] = {items};
      const h = document.createElement('h2');
      h.innerHTML = TN.esc(j.label) + ` <small>${items.length}</small>`;
      const g = document.createElement('div');
      g.className = 'grid';
      items.forEach((it) => g.append(TN.card(it.img || 'icon.png', it.title, it.sub, () => it.open(), shapeOf(it.kind))));
      dropSk();
      slots[i].append(h, g);
      const best = bestOf(groups.filter(Boolean), q);
      if (best.length >= 2 && groups.filter(Boolean).length > 1) {
        // 6.5.1: one shape for the whole "best matches" grid (posters next to 16:9 cards gave ragged rows): the cards'
        // own shape when they agree, else wide for all (a poster is letterboxed in it); the ranking order is kept
        const shapes = best.map((it) => shapeOf(it.kind)), one = shapes.every((x) => x === shapes[0]) ? shapes[0] : 'wide';
        bestG.textContent = '';
        if (one) bestG.setAttribute('data-shape', one); else bestG.removeAttribute('data-shape');
        best.forEach((it) => bestG.append(TN.card(it.img || 'icon.png', it.title, it.sub, () => it.open(), one)));
        bestH.hidden = bestG.hidden = false;
      }
    }));
    dropSk();
    offRoute();
    if (ctx.current() && !total) {
      const holder = document.createElement('div');
      view.append(holder);
      let drawn = false;
      if (typeof TN.state === 'function') { try { TN.state(holder, {kind: 'empty', title: TN.t('hub_none'), text: '', action: {label: TN.t('hub_retry'), onClick: () => TN.route()}}); drawn = true; } catch (e) { holder.textContent = ''; } }
      if (!drawn) { holder.innerHTML = `<p class="msg">${TN.esc(TN.t('hub_none'))}</p>`; holder.append(TN.button('btn ghost', TN.t('hub_retry'), () => TN.route())); }
    }
  });

  self.TNHub = {rank, score, parseQuery, seLabel, bestOf, parseDm, pickDm, frameAllowed, shapeOf, linkTarget, recentSearches, SHAPES};     // for the tests
})(self.TN);
