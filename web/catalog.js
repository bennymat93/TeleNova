'use strict';
// WP-4: the Movies / Series catalogue, the same lists as the Kodi add-on's media_root (default.py):
// trending, popular, top rated, the new / Israeli / family / documentary rows, genres, 11 languages, years back to 1950,
// infinite paging, category search (TMDb + Telegram files), seasons and episodes (Hebrew plots), and the Kukhnya tile.
// Pages: #/movies, #/tv, #/catalog/<v=list|genres|langs|years|search|seasons|episodes|kukhnya&...>
// Provider 'catalog' (no kinds; TN.provider('catalog')): roots(m), link(def), fetchPage(def, page), CATS for other modules
// (telegram.js / TeleScope root uses the same discover filters).
(function (TN) {
  if (!TN) return;
  const esc = TN.esc, t = (k, ...a) => TN.t(k, ...a);

  TN.i18n.add({
    he: {cat_search: 'חיפוש', cat_trending: 'חם השבוע', cat_popular: 'פופולרי', cat_top: 'המדורגים ביותר',
      cat_now: 'עכשיו בקולנוע', cat_il_movies: 'סרטים ישראליים', cat_il_series: 'סדרות ישראליות', cat_family: 'משפחה וילדים',
      cat_docu: 'תעודה', cat_on_air: 'משודרות עכשיו', cat_kids_tv: 'סדרות ילדים', cat_genres: 'לפי ז\'אנר', cat_langs: 'לפי שפה',
      cat_years: 'לפי שנה', cat_kukhnya: 'קוכניה (המטבח)', cat_movies: 'סרטים', cat_series: 'סדרות', cat_more: 'עוד',
      cat_empty: 'אין כאן כלום', cat_season: 'עונה', cat_episode: 'פרק', cat_watched: 'נצפה', cat_seasons: 'עונות',
      cat_tg: 'קבצים בטלגרם', cat_no_key: 'לקטלוג המלא צריך מפתח TMDb (בהגדרות, או מחובר לחשבון). בינתיים - מהארכיון:',
      cat_fav_add: 'הוסף למועדפים', cat_fav_rm: 'הסר ממועדפים', cat_q: 'חפש %s...', cat_plot_tr: 'תורגם אוטומטית',
      cat_settings: 'הגדרות', cat_play: 'נגן',
      cat_l_he: 'עברית', cat_l_en: 'אנגלית', cat_l_ru: 'רוסית', cat_l_fr: 'צרפתית', cat_l_es: 'ספרדית', cat_l_ko: 'קוריאנית',
      cat_l_ja: 'יפנית', cat_l_tr: 'טורקית', cat_l_de: 'גרמנית', cat_l_it: 'איטלקית', cat_l_hi: 'הודית'},
    en: {cat_search: 'Search', cat_trending: 'Trending This Week', cat_popular: 'Popular', cat_top: 'Top Rated',
      cat_now: 'Now in cinemas', cat_il_movies: 'Israeli films', cat_il_series: 'Israeli series', cat_family: 'Family & kids',
      cat_docu: 'Documentary', cat_on_air: 'On the air now', cat_kids_tv: 'Kids series', cat_genres: 'By Genre', cat_langs: 'By Language',
      cat_years: 'By Year', cat_kukhnya: 'Kukhnya (Kitchen)', cat_movies: 'Movies', cat_series: 'Series', cat_more: 'More',
      cat_empty: 'Nothing here', cat_season: 'Season', cat_episode: 'Episode', cat_watched: 'Watched', cat_seasons: 'Seasons',
      cat_tg: 'Telegram files', cat_no_key: 'The full catalogue needs a TMDb key (in Settings, or a connected account). Meanwhile, from the Archive:',
      cat_fav_add: 'Add to favourites', cat_fav_rm: 'Remove from favourites', cat_q: 'Search %s...', cat_plot_tr: 'machine translated',
      cat_settings: 'Settings', cat_play: 'Play',
      cat_l_he: 'Hebrew', cat_l_en: 'English', cat_l_ru: 'Russian', cat_l_fr: 'French', cat_l_es: 'Spanish', cat_l_ko: 'Korean',
      cat_l_ja: 'Japanese', cat_l_tr: 'Turkish', cat_l_de: 'German', cat_l_it: 'Italian', cat_l_hi: 'Hindi'},
    ru: {cat_search: 'Поиск', cat_trending: 'Популярное за неделю', cat_popular: 'Популярное', cat_top: 'Лучшие по рейтингу',
      cat_now: 'Сейчас в кино', cat_il_movies: 'Израильские фильмы', cat_il_series: 'Израильские сериалы', cat_family: 'Для всей семьи',
      cat_docu: 'Документальные', cat_on_air: 'Сейчас в эфире', cat_kids_tv: 'Детские сериалы', cat_genres: 'По жанрам', cat_langs: 'По языку',
      cat_years: 'По году', cat_kukhnya: 'Кухня', cat_movies: 'Фильмы', cat_series: 'Сериалы', cat_more: 'Ещё',
      cat_empty: 'Здесь пусто', cat_season: 'Сезон', cat_episode: 'Серия', cat_watched: 'Просмотрено', cat_seasons: 'Сезоны',
      cat_tg: 'Файлы в Telegram', cat_no_key: 'Для полного каталога нужен ключ TMDb (в настройках или через аккаунт). Пока - из архива:',
      cat_fav_add: 'В избранное', cat_fav_rm: 'Убрать из избранного', cat_q: 'Искать %s...', cat_plot_tr: 'машинный перевод',
      cat_settings: 'Настройки', cat_play: 'Смотреть',
      cat_l_he: 'Иврит', cat_l_en: 'Английский', cat_l_ru: 'Русский', cat_l_fr: 'Французский', cat_l_es: 'Испанский', cat_l_ko: 'Корейский',
      cat_l_ja: 'Японский', cat_l_tr: 'Турецкий', cat_l_de: 'Немецкий', cat_l_it: 'Итальянский', cat_l_hi: 'Хинди'},
  });

  // the same ids and order as default.py GENRES / LANGS (tile art: media/cats/genre_<id>.png, lang_<code>.png, year_<y>.png)
  const GENRES = {
    movie: [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 53, 10752, 37],
    tv: [10759, 16, 35, 80, 99, 18, 10751, 10762, 9648, 10763, 10764, 10765, 10766, 10767, 10768, 37],
  };
  // built-in names (he/en/ru) for every id in GENRES, used when TMDb gives no list - a tile never shows a bare number
  const GENRE_NAMES = {
    28: ['פעולה', 'Action', 'Боевик'], 12: ['הרפתקאות', 'Adventure', 'Приключения'], 16: ['אנימציה', 'Animation', 'Мультфильм'],
    35: ['קומדיה', 'Comedy', 'Комедия'], 80: ['פשע', 'Crime', 'Криминал'], 99: ['תעודה', 'Documentary', 'Документальный'],
    18: ['דרמה', 'Drama', 'Драма'], 10751: ['משפחה', 'Family', 'Семейный'], 14: ['פנטזיה', 'Fantasy', 'Фэнтези'],
    36: ['היסטוריה', 'History', 'История'], 27: ['אימה', 'Horror', 'Ужасы'], 10402: ['מוזיקה', 'Music', 'Музыка'],
    9648: ['מסתורין', 'Mystery', 'Детектив'], 10749: ['רומנטיקה', 'Romance', 'Мелодрама'], 878: ['מדע בדיוני', 'Science Fiction', 'Фантастика'],
    53: ['מתח', 'Thriller', 'Триллер'], 10752: ['מלחמה', 'War', 'Военный'], 37: ['מערבון', 'Western', 'Вестерн'],
    10759: ['אקשן והרפתקאות', 'Action & Adventure', 'Боевик и приключения'], 10762: ['ילדים', 'Kids', 'Детский'],
    10763: ['חדשות', 'News', 'Новости'], 10764: ['ריאליטי', 'Reality', 'Реалити-шоу'],
    10765: ['מדע בדיוני ופנטזיה', 'Sci-Fi & Fantasy', 'НФ и фэнтези'], 10766: ['אופרת סבון', 'Soap', 'Мыльная опера'],
    10767: ['אירוח', 'Talk', 'Ток-шоу'], 10768: ['מלחמה ופוליטיקה', 'War & Politics', 'Война и политика'],
  };
  const genreName = (id) => { const n = GENRE_NAMES[id]; return n ? n[{he: 0, ru: 2}[TN.lang()] ?? 1] : ''; };
  const LANGS = ['he', 'en', 'ru', 'fr', 'es', 'ko', 'ja', 'tr', 'de', 'it', 'hi'];
  const FIRST_YEAR = 1950;
  const ART = 'media/cats/';
  const yearField = (m) => (m === 'movie' ? 'primary_release_year' : 'first_air_date_year');
  const disc = (m, f) => Object.assign({path: '/discover/' + m, sort_by: 'popularity.desc'}, f);

  // media_root(m): [key, emoji, list definition | page def]
  function roots(m) {
    const r = [['cat_trending', '🔥', {path: `/trending/${m}/week`}], ['cat_popular', '⭐', {path: `/${m}/popular`}],
               ['cat_top', '🏆', {path: `/${m}/top_rated`}]];
    if (m === 'movie') {
      r.push(['cat_now', '🎟', {path: '/movie/now_playing'}],
             ['cat_il_movies', '🇮🇱', disc(m, {with_origin_country: 'IL', 'vote_count.gte': 3})],
             ['cat_family', '👪', disc(m, {with_genres: 10751})], ['cat_docu', '🎥', disc(m, {with_genres: 99})]);
    } else {
      r.push(['cat_il_series', '🇮🇱', disc(m, {with_origin_country: 'IL', 'vote_count.gte': 3})],
             ['cat_on_air', '📡', {path: '/tv/on_the_air'}],
             ['cat_kids_tv', '🧸', disc(m, {with_genres: 10762})], ['cat_docu', '🎥', disc(m, {with_genres: 99})]);
    }
    r.push(['cat_genres', '🎭', {v: 'genres'}], ['cat_langs', '🌐', {v: 'langs'}], ['cat_years', '📅', {v: 'years'}]);
    if (m === 'tv') r.push(['cat_kukhnya', '🍳', {v: 'kukhnya'}]);
    return r.map(([key, ic, d]) => ({key, ic, def: Object.assign({m, v: d.v || 'list', title: key}, d)}));
  }
  function genreDef(m, id, name) { return Object.assign({m, v: 'list', name}, disc(m, {with_genres: String(id)})); }
  function langDef(m, code) { return Object.assign({m, v: 'list', title: 'cat_l_' + code}, disc(m, {with_original_language: code})); }
  function yearDef(m, y) { return Object.assign({m, v: 'list', name: String(y)}, disc(m, {[yearField(m)]: String(y)})); }
  function years(now) { const out = []; for (let y = now || new Date().getFullYear(); y >= FIRST_YEAR; y--) out.push(y); return out; }

  const link = (def) => '#/catalog/' + new URLSearchParams(def);
  const META = ['m', 'v', 'title', 'name', 'path', 'page'];
  // the TMDb query a list definition makes (default.py list_: discover lists hide stubs with vote_count.gte 15)
  function query(def, page) {
    const q = {};
    for (const [k, v] of Object.entries(def)) if (!META.includes(k) && v !== '' && v != null) q[k] = String(v);
    if (String(def.path || '').startsWith('/discover/') && !('vote_count.gte' in q)) q['vote_count.gte'] = '15';
    q.page = String(page || 1);
    return q;
  }
  const okPath = (p) => /^\/(trending\/(movie|tv)\/(day|week)|(movie|tv)\/(popular|top_rated|now_playing|on_the_air|airing_today|upcoming)|discover\/(movie|tv))$/.test(p || '');
  async function fetchPage(def, page) {
    if (!okPath(def.path)) throw new Error('bad list');
    const d = await TN.tmdb(def.path, query(def, page));
    const rows = (d.results || []).filter((it) => it.media_type !== 'person');
    return {rows, page: d.page || page || 1, pages: Math.min(d.total_pages || 1, 500)};
  }
  const pageTitle = (def) => (def.title ? t(def.title) : def.name || '');

  // ------------------------------------------------------------- small helpers
  const pool = async (items, n, fn) => {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({length: Math.min(n, items.length)}, async () => {
      while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = null; } }
    }));
    return out;
  };
  let genreNames = {};
  async function genreList(m) {
    const k = m + ':' + TN.lang();
    if (!genreNames[k]) genreNames[k] = TN.tmdb(`/genre/${m}/list`).then((d) => d.genres || []).catch(() => { delete genreNames[k]; return []; });
    return genreNames[k];
  }
  function head(title, back) {
    TN.page('', title);
    const b = TN.view().querySelector('.backbtn');
    if (b && back) b.href = back;
  }
  function style() {
    if (document.getElementById('cat-style')) return;
    const s = document.createElement('style');
    s.id = 'cat-style';
    s.textContent = '.cat-cell{position:relative}.cat-cell>.card{width:100%}' +
      '.cat-fav{position:absolute;top:6px;inset-inline-end:6px;z-index:2;width:34px;height:34px;border-radius:50%;border:0;' +
      'background:rgba(0,0,0,.55);color:#fff;font-size:18px;line-height:34px;cursor:pointer;padding:0}.cat-fav.on{color:gold}' +
      '.cat-fav:focus-visible{outline:3px solid #fff}.cat-more{display:block;margin:20px auto}' +
      '.cat-form{display:flex;gap:8px;margin:0 0 16px}.cat-form input{flex:1;min-width:0}' +
      '.cat-ep{display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:start;text-align:start;width:100%}' +
      '.cat-ep .img{aspect-ratio:16/9;border-radius:8px;background:#222 center/cover no-repeat}.cat-ep p{margin:4px 0 0;opacity:.85;font-size:.92em}' +
      '.cat-ep .w{color:limegreen}.cat-ep small{opacity:.7}@media (max-width:520px){.cat-ep{grid-template-columns:110px 1fr}}';
    document.head.append(s);
  }
  // a card with a favourite star (a separate button: a button cannot hold another one)
  function titleCell(it, m, extraSub) {
    const kind = it.media_type || m;
    const name = it.title || it.name || '';
    const year = (it.release_date || it.first_air_date || '').slice(0, 4);
    const poster = it.poster_path ? TN.tmdbImg(it.poster_path, 'w342') : 'icon.png';
    const sub = [year, it.vote_average ? '★ ' + Number(it.vote_average).toFixed(1) : '', extraSub || ''].filter(Boolean).join(' · ');
    const open = kind === 'tv' ? () => TN.go(link({m: 'tv', v: 'seasons', id: String(it.id)})) : () => TN.openTitle('movie', it.id);
    const cell = document.createElement('div');
    cell.className = 'cat-cell';
    const c = TN.card(poster, name, sub, open);
    if (it.overview) c.title = it.overview.slice(0, 300);
    const favKind = kind === 'movie' ? 'movie' : 'series', label = year ? `${name} (${year})` : name;
    const f = document.createElement('button');
    const paint = () => { const on = TN.store.isFav(favKind, it.id); f.className = 'cat-fav' + (on ? ' on' : ''); f.textContent = on ? '★' : '☆';
                          f.title = t(on ? 'cat_fav_rm' : 'cat_fav_add'); f.setAttribute('aria-label', f.title); };
    f.onclick = (e) => {
      e.stopPropagation();
      if (TN.store.isFav(favKind, it.id)) TN.store.removeFav(favKind, it.id);
      else { TN.store.addFav(favKind, it.id, label, ''); if (it.poster_path) TN.store.setArt(favKind, it.id, poster); }
      paint();
    };
    paint();
    cell.append(c, f);
    return cell;
  }
  function tile(href, ic, label, img) {
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = href;
    if (img) {
      a.className = 'card square';
      a.innerHTML = `<div class="img"></div><div class="t" dir="auto">${esc(label)}</div>`;
      TN.paint(a.querySelector('.img'), img);
    } else a.innerHTML = `<span class="ic">${ic}</span><b>${esc(label)}</b>`;
    return a;
  }
  function searchForm(m, q) {
    const f = document.createElement('form');
    f.className = 'cat-form';
    f.innerHTML = `<input type="search" dir="auto" enterkeyhint="search" class="input" placeholder="${esc(t('cat_q', t(m === 'movie' ? 'cat_movies' : 'cat_series')))}">` +
                  `<button class="btn">${esc(t('cat_search'))}</button>`;
    const inp = f.querySelector('input');
    inp.value = q || '';
    f.onsubmit = (e) => { e.preventDefault(); const v = inp.value.trim(); if (v) TN.go(link({m, v: 'search', q: v})); };
    TN.view().append(f);
    return inp;
  }

  // ------------------------------------------------------------- pages
  async function noKey(m, ctx) {
    TN.view().insertAdjacentHTML('beforeend', `<p class="msg">${esc(t('cat_no_key'))} <a href="#/settings">${esc(t('cat_settings'))}</a></p>`);
    const g = TN.skeleton(8);
    const docs = await TN.archive({collection: m === 'movie' ? 'feature_films' : 'classic_tv', rows: 40}).catch(() => []);
    if (!ctx.current()) return;
    if (!docs.length) return TN.empty(g);
    g.className = 'grid';
    g.innerHTML = '';
    docs.forEach((d) => g.append(TN.card(`https://archive.org/services/img/${encodeURIComponent(d.identifier)}`, d.title, d.year || '', () => TN.openArchive(d))));
  }
  function pageRoot(m, ctx) {
    style();
    head(t(m === 'movie' ? 'cat_movies' : 'cat_series'));
    searchForm(m);
    if (!TN.hasTmdbKey()) return noKey(m, ctx);
    const box = document.createElement('div');
    box.className = 'menu';
    for (const r of roots(m)) box.append(tile(link(r.def), r.ic, t(r.key)));
    TN.view().append(box);
  }
  function pageGenres(def, ctx) {
    const m = def.m;
    head(t('cat_genres'), '#/' + (m === 'movie' ? 'movies' : 'tv'));
    const g = TN.section(t('cat_genres'));
    return genreList(m).then((list) => {
      if (!ctx.current()) return;
      const names = Object.fromEntries(list.map((x) => [x.id, x.name]));
      const ids = list.length ? list.map((x) => x.id) : GENRES[m];
      for (const id of ids) {
        const name = names[id] || genreName(id);
        if (!name) continue;
        const img = GENRES[m].includes(id) ? ART + `genre_${id}.png` : 'icon.png';
        g.append(tile(link(genreDef(m, id, name)), '', name, img));
      }
    });
  }
  function pageLangs(def) {
    const m = def.m;
    head(t('cat_langs'), '#/' + (m === 'movie' ? 'movies' : 'tv'));
    const g = TN.section(t('cat_langs'));
    for (const c of LANGS) g.append(tile(link(langDef(m, c)), '', t('cat_l_' + c), ART + `lang_${c}.png`));
  }
  function pageYears(def) {
    const m = def.m;
    head(t('cat_years'), '#/' + (m === 'movie' ? 'movies' : 'tv'));
    const g = TN.section(t('cat_years'));
    const art = (y) => (y <= 2027 ? ART + `year_${y}.png` : 'icon.png');
    for (const y of years()) g.append(tile(link(yearDef(m, y)), '', String(y), art(y)));
  }
  async function pageList(def, ctx) {
    style();
    const m = def.m;
    head(pageTitle(def), '#/' + (m === 'movie' ? 'movies' : 'tv'));
    const g = TN.section(pageTitle(def));
    const sk = TN.skeleton(8);
    const gl = await genreList(m);
    const gname = Object.fromEntries(gl.map((x) => [x.id, x.name]));
    let page = 0, pages = 1, busy = false, io = null;
    const more = TN.button('btn ghost cat-more', t('cat_more'), () => next());
    more.hidden = true;
    TN.view().append(more);
    async function next() {
      if (busy || page >= pages || !ctx.current()) return;
      busy = true;
      more.disabled = true;
      try {
        const r = await fetchPage(def, page + 1);
        if (!ctx.current()) return;
        page = r.page;
        pages = r.pages;
        if (sk.isConnected) sk.remove();
        if (page === 1 && !r.rows.length) { g.insertAdjacentHTML('afterend', `<p class="msg">${esc(t('cat_empty'))}</p>`); }
        for (const it of r.rows) {
          const kind = it.media_type || m;
          if (kind !== 'movie' && kind !== 'tv') continue;
          g.append(titleCell(Object.assign({media_type: kind}, it), m, (it.genre_ids || []).slice(0, 2).map((id) => gname[id] || genreName(id)).filter(Boolean).join(', ')));
        }
      } finally {
        busy = false;
        more.disabled = false;
        more.hidden = page >= pages;
        if (page >= pages && io) io.disconnect();
      }
    }
    await next();
    if ('IntersectionObserver' in window && ctx.current() && page < pages) {
      io = new IntersectionObserver((es) => { if (!ctx.current()) return io.disconnect(); if (es.some((e) => e.isIntersecting)) next().catch(() => {}); },
                                    {rootMargin: '600px'});
      io.observe(more);
    }
  }

  // series / movie search: TMDb titles of that kind, then the Telegram files the engine finds for the same text
  // (series: files that state an episode; movies: files that do not) - default.py search()
  const EP_RE = /(?:^|[^a-z0-9])(?:s\d{1,2}[ ._-]?e\d{1,3}|\d{1,2}x\d{2,3}|(?:ep|episode|серия|פרק)[ ._-]?\d{1,3})(?![0-9])/i;
  function statesEpisode(label) {
    const em = self.EPMATCH || self.epmatch;
    if (em && typeof em.parse === 'function') {
      try { const p = em.parse(label); return Array.isArray(p) ? p[1] != null : !!(p && p.episode != null); } catch (e) {}
    }
    return EP_RE.test(label || '');
  }
  async function pageSearch(def, ctx) {
    style();
    const m = def.m, q = String(def.q || '').trim();
    head(q || t('cat_search'), '#/' + (m === 'movie' ? 'movies' : 'tv'));
    searchForm(m, q);
    if (!q) return;
    try { TN.store.addSearch(q); } catch (e) {}
    const g = TN.section(t(m === 'movie' ? 'cat_movies' : 'cat_series'));
    const tgBox = document.createElement('div');
    TN.view().append(tgBox);
    const tgWork = (async () => {
      const p = await TN.provider('tgsearch');
      if (!p || !TN.providerOn('tgsearch') || typeof p.search !== 'function') return;
      if (!(self.EPMATCH || self.epmatch)) await TN.load('epmatch').catch(() => {});
      const rows = (await p.search(q, {limit: 60}) || []).filter((r) => statesEpisode(r.title || r.sub || '') === (m === 'tv')).slice(0, 30);
      if (!ctx.current() || !rows.length) return;
      tgBox.innerHTML = `<h2>${esc(t('cat_tg'))} <small>${rows.length}</small></h2><div class="grid"></div>`;
      for (const r of rows) tgBox.lastChild.append(TN.card(r.img || 'icon.png', r.title || '', r.sub || '', () => r.open && r.open(), 'wide'));
    })().catch(() => {});
    if (!TN.hasTmdbKey()) { TN.empty(g, t('cat_no_key')); return tgWork; }
    let rows = [];
    try { rows = (await TN.tmdb(`/search/${m}`, {query: q})).results || []; } catch (e) {}
    if (!ctx.current()) return;
    if (!rows.length) TN.empty(g, t('cat_empty'));
    for (const it of rows) g.append(titleCell(Object.assign({media_type: m}, it), m));
    await tgWork;
  }

  async function pageSeasons(def, ctx, show) {
    style();
    const id = String(def.id || '');
    if (!/^\d+$/.test(id)) throw new Error('bad id');
    head('…', '#/tv');
    const sk = TN.skeleton(6);
    show = show || await TN.tmdb('/tv/' + id);
    if (!ctx.current()) return;
    sk.remove();
    TN.view().querySelector('h1').textContent = show.name || '';
    const acts = document.createElement('div');
    acts.className = 'actions';
    acts.append(TN.favButton({kind: 'series', id: Number(id), label: show.name || '', extra: '', img: show.poster_path ? TN.tmdbImg(show.poster_path) : ''}),
                TN.button('btn ghost', 'ⓘ', () => TN.openTitle('tv', id)));
    TN.view().append(acts);
    if (show.overview) TN.view().insertAdjacentHTML('beforeend', `<p class="hint" dir="auto">${esc(show.overview)}</p>`);
    const g = TN.section(t('cat_seasons'));
    const showPoster = show.poster_path ? TN.tmdbImg(show.poster_path) : 'icon.png';
    for (const s of show.seasons || []) {
      if (s.season_number === 0 && !s.episode_count) continue;
      const name = s.name || `${t('cat_season')} ${s.season_number}`;
      const a = TN.card(s.poster_path ? TN.tmdbImg(s.poster_path) : showPoster, name, s.episode_count ? `${s.episode_count} · ${(s.air_date || '').slice(0, 4)}` : '',
                        () => TN.go(link({m: 'tv', v: 'episodes', id, s: String(s.season_number)})));
      g.append(a);
    }
    if (!g.children.length) TN.empty(g, t('cat_empty'));
  }

  // Hebrew interface: episodes TMDb has no Hebrew text for get the English text, translated once through the
  // household's Gemini key (kept in this browser), else shown in English - default.py hebrew_plots()
  const PLOTS = 'cat_plots_he';
  function geminiKey() {
    const s = TN.settings.synced() || {};
    return String(s.gemini_key || TN.settings.get('gemini_key', '') || '').trim();
  }
  async function gemini(texts, key) {
    const body = {contents: [{parts: [{text: 'Translate each text in this JSON array to Hebrew. Answer with a JSON array of strings only, same order.\n' + JSON.stringify(texts)}]}],
                  generationConfig: {responseMimeType: 'application/json', temperature: 0.2}};
    for (const model of ['gemini-flash-lite-latest', 'gemini-flash-latest']) {
      try {
        // the key goes in a header, never in the address
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': key}, body: JSON.stringify(body)});
        if (!r.ok) continue;
        const j = await r.json();
        const txt = (((j.candidates || [])[0] || {}).content || {}).parts.map((p) => p.text || '').join('');
        const arr = JSON.parse(txt);
        if (Array.isArray(arr) && arr.length === texts.length && arr.every((x) => typeof x === 'string' && x.trim())) return arr;
      } catch (e) {}
    }
    return null;
  }
  async function hebrewPlots(tvId, s, season, translate) {
    if (TN.lang() !== 'he' || (season.episodes || []).every((e) => e.overview)) return {plots: {}, tr: false};
    const key = `${tvId}:${s}`, cache = TN.get(PLOTS, {}) || {};
    if (cache[key]) return {plots: cache[key], tr: true};
    let en;
    try { en = await TN.tmdb(`/tv/${tvId}/season/${s}`, {language: 'en-US'}); } catch (e) { return {plots: {}, tr: false}; }
    const have = new Set((season.episodes || []).filter((e) => e.overview).map((e) => e.episode_number));
    const todo = (en.episodes || []).filter((e) => e.overview && !have.has(e.episode_number));
    const plots = Object.fromEntries(todo.map((e) => [e.episode_number, e.overview]));
    const gk = geminiKey();
    if (!todo.length || !gk) return {plots, tr: false};
    const out = await (translate || gemini)(todo.map((e) => e.overview), gk);
    if (!out) return {plots, tr: false};
    todo.forEach((e, i) => { plots[e.episode_number] = out[i]; });
    cache[key] = plots;
    const keys = Object.keys(cache);
    TN.put(PLOTS, keys.length > 400 ? Object.fromEntries(keys.slice(-300).map((k) => [k, cache[k]])) : cache);
    return {plots, tr: true};
  }
  const epKey = (id, s, e) => `tv:${id}:${s}:${e}`;
  async function playEpisode(show, id, s, e) {
    const svc = await TN.provider('sources').catch(() => null);
    const q = {type: 'tv', id: String(id), title: show.name || '', original: show.original_name || '', season: Number(s), episode: Number(e.episode_number),
               year: (show.first_air_date || '').slice(0, 4), imdb: (show.external_ids || {}).imdb_id || ''};
    if (svc && typeof svc.open === 'function') return svc.open(q);
    if (svc && typeof svc.pick === 'function') return svc.pick(q);
    TN.openTitle('tv', id);
  }
  async function pageEpisodes(def, ctx) {
    style();
    const id = String(def.id || ''), s = String(def.s || '');
    if (!/^\d+$/.test(id) || !/^\d+$/.test(s)) throw new Error('bad id');
    head('…', link({m: 'tv', v: 'seasons', id}));
    const sk = TN.skeleton(6);
    const show = await TN.tmdb('/tv/' + id, {append_to_response: `season/${s},external_ids`});
    let season = show['season/' + s];
    if (!season || !season.episodes) season = await TN.tmdb(`/tv/${id}/season/${s}`);
    if (!ctx.current()) return;
    TN.view().querySelector('h1').textContent = `${show.name || ''} · ${season.name || t('cat_season') + ' ' + s}`;
    const seen = Object.fromEntries((TN.store.history() || []).filter((h) => h && h.key).map((h) => [h.key, h]));
    const draw = (plots, tr) => {
      sk.remove();
      const old = TN.view().querySelector('.cat-eps');
      if (old) old.remove();
      const list = document.createElement('div');
      list.className = 'hlist cat-eps';
      const still = (e) => (e.still_path ? TN.tmdbImg(e.still_path, 'w300') : show.backdrop_path ? TN.tmdbImg(show.backdrop_path, 'w300') : 'icon.png');
      for (const e of season.episodes || []) {
        const h = seen[epKey(id, s, e.episode_number)];
        const plot = e.overview || plots[e.episode_number] || '';
        const b = document.createElement('button');
        b.className = 'hrow cat-ep';
        b.innerHTML = '<div class="img"></div><div>' +
          `<b dir="auto">${h ? '<span class="w">● </span>' : ''}${esc(`${s}x${String(e.episode_number).padStart(2, '0')}. ${e.name || ''}`)}</b>` +
          `<br><small>${esc([e.air_date || '', e.runtime ? e.runtime + "'" : '', e.vote_average ? '★ ' + Number(e.vote_average).toFixed(1) : '',
                             h ? `${t('cat_watched')} ${h.when || ''}` : ''].filter(Boolean).join(' · '))}</small>` +
          (plot ? `<p dir="auto">${esc(plot)}${!e.overview && tr ? ` <small>(${esc(t('cat_plot_tr'))})</small>` : ''}</p>` : '') + '</div>';
        TN.paint(b.querySelector('.img'), still(e));
        b.onclick = () => playEpisode(show, id, s, e);
        list.append(b);
      }
      if (!list.children.length) list.innerHTML = `<p class="msg">${esc(t('cat_empty'))}</p>`;
      TN.view().append(list);
    };
    draw({}, false);
    const {plots, tr} = await hebrewPlots(id, s, season);
    if (ctx.current() && Object.keys(plots).length) draw(plots, tr);
  }
  async function pageKukhnya(def, ctx) {
    head(t('cat_kukhnya'), '#/tv');
    const res = await TN.tmdb('/search/tv', {query: 'Кухня', first_air_date_year: '2012', language: 'ru-RU'});
    const hit = (res.results || []).find((r) => r.original_language === 'ru');
    if (!ctx.current()) return;
    if (!hit) { TN.view().insertAdjacentHTML('beforeend', `<p class="msg">${esc(t('cat_empty'))}</p>`); return; }
    return pageSeasons({id: String(hit.id)}, ctx);
  }

  // ------------------------------------------------------------- routing
  function parse(ctx, arg) {
    // the raw rest of the hash, so an encoded '&' in a search stays inside its value
    const raw = ctx && ctx.rest && ctx.rest.length ? ctx.rest.join('/') : String(arg || '');
    const p = Object.fromEntries(new URLSearchParams(raw));
    p.m = p.m === 'tv' ? 'tv' : 'movie';
    return p;
  }
  const VIEWS = {list: pageList, genres: pageGenres, langs: pageLangs, years: pageYears, search: pageSearch,
                 seasons: (d, c) => pageSeasons(d, c), episodes: pageEpisodes, kukhnya: pageKukhnya};
  TN.registerPage('movies', (arg, ctx) => pageRoot('movie', ctx));
  TN.registerPage('tv', (arg, ctx) => pageRoot('tv', ctx));
  TN.registerPage('catalog', (arg, ctx) => {
    const d = parse(ctx, arg);
    const fn = VIEWS[d.v] || VIEWS.list;
    if (fn === pageList && !okPath(d.path)) return pageRoot(d.m, ctx);
    return fn(d, ctx);
  });
  TN.registerProvider('catalog', {kinds: [], label: 'Catalog', roots, link, fetchPage, query, years, hebrewPlots, statesEpisode,
                                  genreDef, langDef, yearDef, GENRES, LANGS, FIRST_YEAR});
})(self.TN);
