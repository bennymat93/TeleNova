'use strict';
// WP-4: the Movies / Series catalogue, the same lists as the Kodi add-on's media_root (default.py):
// trending, popular, top rated, the new / Israeli / family / documentary rows, genres, 11 languages, years back to 1950,
// infinite paging, category search (TMDb + Telegram files), seasons and episodes (Hebrew plots), and the Kukhnya tile.
// Pages: #/movies, #/tv, #/catalog/<v=list|genres|langs|years|search|seasons|episodes|kukhnya&...>
// Provider 'catalog' (no kinds; TN.provider('catalog')): roots(m), link(def), fetchPage(def, page), CATS for other modules
// (telegram.js / TeleScope root uses the same discover filters).
// Engine rows too (TeleScope router.py): Upcoming, Airing today, Turkish / Korean series, the Hebrew, Russian (Soviet films
// up to 1991, animation) and Kids groups (#/catalog/v=group&g=hebrew|russian|kids).
// With no TMDb key the catalogue is never empty: the key-less Cinemeta lists (meta.py _cm_list / _cm_search / _cm_details):
// popular, new, featured, genres, years, search, seasons and episodes, ids are IMDb ids (v=cine | cgenres | cyears | cseasons | cepisodes).
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
      cat_upcoming: 'בקרוב', cat_airing: 'משודרות היום', cat_tr: 'סדרות טורקיות', cat_ko: 'סדרות קוריאניות', cat_g_hebrew: 'עברית וישראל',
      cat_g_russian: 'רוסית', cat_g_kids: 'ילדים', cat_he_movies: 'סרטים בעברית', cat_he_series: 'סדרות בעברית', cat_he_movies_top: 'סרטים בעברית - המדורגים ביותר',
      cat_he_series_top: 'סדרות בעברית - המדורגות ביותר', cat_anim_ilus: 'אנימציה (ישראל וארה"ב)', cat_ru_movies: 'סרטים רוסיים', cat_ru_series: 'סדרות רוסיות',
      cat_ru_movies_top: 'סרטים רוסיים - המדורגים ביותר', cat_ru_series_top: 'סדרות רוסיות - המדורגות ביותר', cat_soviet: 'סרטים סובייטיים', cat_anim: 'אנימציה',
      cat_kids_movies: 'סרטי ילדים ומשפחה', cat_new: 'חדשים', cat_featured: 'מומלצים', cat_keyless: 'הקטלוג פועל בלי מפתח (Cinemeta). מפתח TMDb חינמי מוסיף עברית, רשימות ישראליות, שפות ומועדפים.',
      cat_add_key: 'הוספת מפתח TMDb', cat_classics: 'קלאסיקות מארכיון האינטרנט', cat_all_sources: 'חיפוש בכל המקורות', cat_trailer: 'טריילר', cat_fail: 'הקטלוג לא נטען. בדקו את החיבור ונסו שוב.',
      cat_retry: 'נסו שוב', cat_see_all: 'הכול', cat_details: 'פרטים', cat_continue: 'המשך צפייה',
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
      cat_upcoming: 'Upcoming', cat_airing: 'Airing today', cat_tr: 'Turkish series', cat_ko: 'Korean series', cat_g_hebrew: 'Hebrew & Israel',
      cat_g_russian: 'Russian', cat_g_kids: 'Kids', cat_he_movies: 'Hebrew films', cat_he_series: 'Hebrew series', cat_he_movies_top: 'Hebrew films - top rated',
      cat_he_series_top: 'Hebrew series - top rated', cat_anim_ilus: 'Animation (Israel & USA)', cat_ru_movies: 'Russian films', cat_ru_series: 'Russian series',
      cat_ru_movies_top: 'Russian films - top rated', cat_ru_series_top: 'Russian series - top rated', cat_soviet: 'Soviet films', cat_anim: 'Animation',
      cat_kids_movies: 'Kids & family films', cat_new: 'New', cat_featured: 'Featured', cat_keyless: 'The catalogue works without a key (Cinemeta). A free TMDb key adds Hebrew texts, Israeli lists, languages and favourites.',
      cat_add_key: 'Add a TMDb key', cat_classics: 'Classics from the Internet Archive', cat_all_sources: 'Search all sources', cat_trailer: 'Trailer', cat_fail: 'The catalogue did not load. Check the connection and try again.',
      cat_retry: 'Try again', cat_see_all: 'See all', cat_details: 'Details', cat_continue: 'Continue watching',
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
      cat_upcoming: 'Скоро', cat_airing: 'Сегодня в эфире', cat_tr: 'Турецкие сериалы', cat_ko: 'Корейские сериалы', cat_g_hebrew: 'Иврит и Израиль',
      cat_g_russian: 'Русское', cat_g_kids: 'Детям', cat_he_movies: 'Фильмы на иврите', cat_he_series: 'Сериалы на иврите', cat_he_movies_top: 'Фильмы на иврите - лучшие',
      cat_he_series_top: 'Сериалы на иврите - лучшие', cat_anim_ilus: 'Мультфильмы (Израиль и США)', cat_ru_movies: 'Русские фильмы', cat_ru_series: 'Русские сериалы',
      cat_ru_movies_top: 'Русские фильмы - лучшие', cat_ru_series_top: 'Русские сериалы - лучшие', cat_soviet: 'Советские фильмы', cat_anim: 'Мультфильмы',
      cat_kids_movies: 'Детские и семейные фильмы', cat_new: 'Новинки', cat_featured: 'Рекомендуем', cat_keyless: 'Каталог работает без ключа (Cinemeta). Бесплатный ключ TMDb добавляет иврит, израильские списки, языки и избранное.',
      cat_add_key: 'Добавить ключ TMDb', cat_classics: 'Классика из Интернет-архива', cat_all_sources: 'Искать во всех источниках', cat_trailer: 'Трейлер', cat_fail: 'Каталог не загрузился. Проверьте соединение и попробуйте снова.',
      cat_retry: 'Повторить', cat_see_all: 'Все', cat_details: 'Подробнее', cat_continue: 'Продолжить просмотр',
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
  const genreName = (id) => { const n = GENRE_NAMES[id]; return n ? n[TN.lang() === 'he' ? 0 : TN.lang() === 'ru' ? 2 : 1] : ''; };
  const LANGS = ['he', 'en', 'ru', 'fr', 'es', 'ko', 'ja', 'tr', 'de', 'it', 'hi'];
  const FIRST_YEAR = 1950;
  const ART = 'media/cats/';
  const yearField = (m) => (m === 'movie' ? 'primary_release_year' : 'first_air_date_year');
  const disc = (m, f) => Object.assign({path: '/discover/' + m, sort_by: 'popularity.desc'}, f);

  // media_root(m): [key, emoji, list definition | page def]  (hub rows first, then the engine's rows - router.py movies / tvshows)
  function roots(m) {
    const r = [['cat_trending', '🔥', {path: `/trending/${m}/week`}], ['cat_popular', '⭐', {path: `/${m}/popular`}],
               ['cat_top', '🏆', {path: `/${m}/top_rated`}]];
    if (m === 'movie') {
      r.push(['cat_now', '🎟', {path: '/movie/now_playing'}], ['cat_upcoming', '🗓', {path: '/movie/upcoming'}],
             ['cat_il_movies', '🇮🇱', disc(m, {with_origin_country: 'IL', 'vote_count.gte': 3})],
             ['cat_family', '👪', disc(m, {with_genres: 10751})], ['cat_docu', '🎥', disc(m, {with_genres: 99})]);
    } else {
      r.push(['cat_il_series', '🇮🇱', disc(m, {with_origin_country: 'IL', 'vote_count.gte': 3})],
             ['cat_on_air', '📡', {path: '/tv/on_the_air'}], ['cat_airing', '📺', {path: '/tv/airing_today'}],
             ['cat_kids_tv', '🧸', disc(m, {with_genres: 10762})], ['cat_docu', '🎥', disc(m, {with_genres: 99})],
             ['cat_tr', '🇹🇷', disc(m, {with_original_language: 'tr'})], ['cat_ko', '🇰🇷', disc(m, {with_original_language: 'ko'})]);
    }
    r.push(['cat_g_hebrew', '🕎', {v: 'group', g: 'hebrew'}], ['cat_g_russian', '🪆', {v: 'group', g: 'russian'}], ['cat_g_kids', '🎈', {v: 'group', g: 'kids'}],
           ['cat_genres', '🎭', {v: 'genres'}], ['cat_langs', '🌐', {v: 'langs'}], ['cat_years', '📅', {v: 'years'}]);
    if (m === 'tv') r.push(['cat_kukhnya', '🍳', {v: 'kukhnya'}]);
    return r.map(([key, ic, d]) => ({key, ic, def: Object.assign({m, v: d.v || 'list', title: key}, d)}));
  }
  // the engine's Hebrew / Russian / Kids menus (router.py hebrew, russian, kids): [key, emoji, kind, filters]
  const top = (lang, votes) => ({with_original_language: lang, sort_by: 'vote_average.desc', 'vote_count.gte': votes});
  const GROUPS = {
    hebrew: [['cat_he_movies', '🎬', 'movie', {with_original_language: 'he', 'vote_count.gte': 1}],
             ['cat_he_series', '📺', 'tv', {with_original_language: 'he', 'vote_count.gte': 1}],
             ['cat_he_movies_top', '🏆', 'movie', top('he', 20)], ['cat_he_series_top', '🏆', 'tv', top('he', 10)],
             ['cat_il_movies', '🇮🇱', 'movie', {with_origin_country: 'IL', 'vote_count.gte': 3}],
             ['cat_il_series', '🇮🇱', 'tv', {with_origin_country: 'IL', 'vote_count.gte': 3}],
             ['cat_anim_ilus', '🧚', 'movie', {with_genres: 16, with_origin_country: 'IL|US'}]],
    russian: [['cat_ru_movies', '🎬', 'movie', {with_original_language: 'ru', 'vote_count.gte': 5}],
              ['cat_ru_series', '📺', 'tv', {with_original_language: 'ru', 'vote_count.gte': 2}],
              ['cat_ru_movies_top', '🏆', 'movie', top('ru', 100)], ['cat_ru_series_top', '🏆', 'tv', top('ru', 30)],
              ['cat_soviet', '🎞', 'movie', {with_original_language: 'ru', 'primary_release_date.lte': '1991-12-31', sort_by: 'vote_count.desc', 'vote_count.gte': 1}],
              ['cat_anim', '🧸', 'movie', {with_original_language: 'ru', with_genres: 16, 'vote_count.gte': 1}]],
    kids: [['cat_kids_movies', '👪', 'movie', {with_genres: 10751}], ['cat_anim', '🧚', 'movie', {with_genres: 16}],
           ['cat_kids_tv', '🧸', 'tv', {with_genres: 10762}]],
  };
  function groupRows(g) {
    return (GROUPS[g] || []).map(([key, ic, m, f]) => ({key, ic, def: Object.assign({m, v: 'list', title: key}, disc(m, f))}));
  }
  function genreDef(m, id, name) { return Object.assign({m, v: 'list', name}, disc(m, {with_genres: String(id)})); }
  function langDef(m, code) { return Object.assign({m, v: 'list', title: 'cat_l_' + code}, disc(m, {with_original_language: code})); }
  function yearDef(m, y) { return Object.assign({m, v: 'list', name: String(y)}, disc(m, {[yearField(m)]: String(y)})); }
  function years(now) { const out = []; for (let y = now || new Date().getFullYear(); y >= FIRST_YEAR; y--) out.push(y); return out; }

  const link = (def) => '#/catalog/' + new URLSearchParams(def);
  const META = ['m', 'v', 'title', 'name', 'path', 'page', 'g', 'cat', 'genre', 'q', 'id', 's'];
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
    if (def.v === 'cine') return cinePage(def, page);
    if (!okPath(def.path)) throw new Error('bad list');
    const d = await TN.tmdb(def.path, query(def, page));
    const rows = (d.results || []).filter((it) => it.media_type !== 'person');
    return {rows, page: d.page || page || 1, pages: Math.min(d.total_pages || 1, 500)};
  }

  // ------------------------------------------------------------- Cinemeta: the key-less catalogue (meta.py)
  const CINE = 'https://v3-cinemeta.strem.io';
  const CINE_CATS = ['top', 'year', 'imdbRating'];
  const CINE_GENRES = {
    movie: ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror',
            'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'],
    tv: ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror',
         'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western', 'Reality-TV', 'Talk-Show', 'Game-Show'],
  };
  // Cinemeta genre name -> the TMDb genre id whose art and translated name the tile uses
  const CINE_ART = {Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, History: 36,
    Horror: 27, Mystery: 9648, Romance: 10749, 'Sci-Fi': 878, Thriller: 53, War: 10752, Western: 37, 'Reality-TV': 10764, 'Talk-Show': 10767};
  const IMDB = /^tt\d{5,10}$/;
  const cineType = (m) => (m === 'tv' ? 'series' : 'movie');
  const PAGE = 50;                                  // Cinemeta gives ~50 a page and pages by skip=
  function cineUrl(def, page) {
    const cat = CINE_CATS.includes(def.cat) ? def.cat : 'top';
    const extra = [];
    if (def.q) extra.push('search=' + encodeURIComponent(def.q));
    else {
      if (def.genre) extra.push('genre=' + encodeURIComponent(def.genre));
      if (page > 1) extra.push('skip=' + (page - 1) * PAGE);
    }
    return `${CINE}/catalog/${cineType(def.m)}/${cat}${extra.length ? '/' + extra.join('&') : ''}.json`;
  }
  // a Cinemeta meta -> the TMDb-like row the cards use (id = the IMDb id, cine: true)
  function cineNorm(it, m) {
    const id = String((it && (it.imdb_id || it.id)) || '');
    if (!IMDB.test(id) || !(it.name || it.title)) return null;
    const year = (String(it.releaseInfo || it.year || it.released || '').match(/\d{4}/) || [''])[0];
    const o = {id, imdb: id, cine: true, media_type: m, overview: String(it.description || ''), poster: TN.httpsOnly(it.poster || ''),
      backdrop: TN.httpsOnly(it.background || ''), vote_average: Number(it.imdbRating) || 0, genres: (it.genres || it.genre || []).slice(0, 3),
      runtime: String(it.runtime || ''), trailer: ((it.trailers || [])[0] || {}).source || ((it.trailerStreams || [])[0] || {}).ytId || ''};
    if (m === 'tv') { o.name = it.name || it.title; o.first_air_date = year; } else { o.title = it.name || it.title; o.release_date = year; }
    return o;
  }
  async function cineJson(url) {
    const r = await fetch(url, {credentials: 'omit'});
    if (!r.ok) throw new Error('Cinemeta ' + r.status);
    return r.json();
  }
  async function cinePage(def, page) {
    page = Number(page) || 1;
    const d = await cineJson(cineUrl(def, page));
    const rows = (d.metas || []).map((x) => cineNorm(x, def.m)).filter(Boolean);
    // a search answers once; a list goes on while full pages come
    return {rows, page, pages: !def.q && rows.length >= PAGE - 10 && page < 40 ? page + 1 : page};
  }
  const cineSearch = (m, q) => cinePage({m, v: 'cine', q}, 1).then((r) => r.rows);
  const cineMetaCache = {};
  function cineMeta(m, id) {
    if (!IMDB.test(String(id))) return Promise.reject(new Error('bad id'));
    const k = m + id;
    if (!cineMetaCache[k]) {
      cineMetaCache[k] = cineJson(`${CINE}/meta/${cineType(m)}/${id}.json`).then((d) => d.meta || {});
      cineMetaCache[k].catch(() => { delete cineMetaCache[k]; });
    }
    return cineMetaCache[k];
  }
  // meta.videos -> {season number: [episodes in order]}
  function cineSeasons(meta) {
    const out = {};
    for (const v of (meta && meta.videos) || []) {
      const s = Number(v.season), e = Number(v.episode != null ? v.episode : v.number);
      if (!(s >= 0) || !(e > 0)) continue;
      (out[s] = out[s] || []).push({episode_number: e, name: v.name || v.title || '', air_date: String(v.released || v.firstAired || '').slice(0, 10),
        overview: v.overview || v.description || '', still: TN.httpsOnly(v.thumbnail || ''), vote_average: Number(v.rating) || 0});
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.episode_number - b.episode_number);
    return out;
  }
  function cineRoots(m) {
    const y = String(new Date().getFullYear());
    return [['cat_popular', '⭐', {cat: 'top'}], ['cat_new', '🆕', {cat: 'year', genre: y}], ['cat_featured', '🏆', {cat: 'imdbRating'}],
            ['cat_family', '👪', {cat: 'top', genre: 'Family'}], ['cat_anim', '🧚', {cat: 'top', genre: 'Animation'}], ['cat_docu', '🎥', {cat: 'top', genre: 'Documentary'}],
            ['cat_genres', '🎭', {v: 'cgenres'}], ['cat_years', '📅', {v: 'cyears'}]]
      .map(([key, ic, d]) => ({key, ic, def: Object.assign({m, v: 'cine', title: key}, d)}));
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
      '.cat-form{display:flex;gap:8px;margin:0 0 16px;max-width:720px}.cat-form input{flex:1;min-width:0;background:var(--panel);color:var(--text);' +
      'border:1px solid var(--panel2);border-radius:10px;padding:10px 14px;font:inherit;min-height:44px}.cat-form input:focus-visible{outline:3px solid var(--ring)}' +
      '.cat-sheet{display:grid;grid-template-columns:minmax(120px,220px) 1fr;gap:16px;align-items:start}.cat-sheet .img{aspect-ratio:2/3;border-radius:10px;background:#222 center/cover no-repeat}' +
      '@media (max-width:520px){.cat-sheet{grid-template-columns:1fr}.cat-sheet .img{max-width:160px}}.cat-rowcard{flex:0 0 auto;width:var(--card-w,150px)}' +
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
    const poster = it.cine ? it.poster || 'icon.png' : it.poster_path ? TN.tmdbImg(it.poster_path, 'w342') : 'icon.png';
    const sub = [year, it.vote_average ? '★ ' + Number(it.vote_average).toFixed(1) : '', extraSub || ''].filter(Boolean).join(' · ');
    const open = it.cine ? (kind === 'tv' ? () => TN.go(link({m: 'tv', v: 'cseasons', id: it.id})) : () => openCine(it))
      : kind === 'tv' ? () => TN.go(link({m: 'tv', v: 'seasons', id: String(it.id)})) : () => TN.openTitle('movie', it.id);
    const cell = document.createElement('div');
    cell.className = 'cat-cell';
    const c = TN.card(poster, name, sub, open);
    if (it.overview) c.title = it.overview.slice(0, 300);
    // an IMDb id is not a favourite the other devices understand (they keep TMDb ids): no star on key-less rows
    if (it.cine) { cell.append(c); return cell; }
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
    f.className = 'hubform cat-form';
    f.setAttribute('role', 'search');
    f.innerHTML = `<input type="search" dir="auto" enterkeyhint="search" class="input" autocomplete="off" aria-label="${esc(t('cat_search'))}" placeholder="${esc(t('cat_q', t(m === 'movie' ? 'cat_movies' : 'cat_series')))}">` +
                  `<button class="btn">${esc(t('cat_search'))}</button>`;
    const inp = f.querySelector('input');
    inp.value = q || '';
    f.onsubmit = (e) => { e.preventDefault(); const v = inp.value.trim(); if (v) TN.go(link({m, v: 'search', q: v})); };
    TN.view().append(f);
    return inp;
  }

  // ------------------------------------------------------------- pages
  // TN.state when the shell has it (ui-redesign 5.8), else the plain message line; action: {label, href | onClick}
  function state(kind, text, action) {
    const box = document.createElement('div');
    TN.view().append(box);
    if (typeof TN.state === 'function') { try { TN.state(box, {kind, title: text, text: '', action}); return box; } catch (e) { box.innerHTML = ''; } }
    box.innerHTML = `<p class="msg">${esc(text)}</p>`;
    if (action) {
      const b = action.href ? Object.assign(document.createElement('a'), {className: 'btn ghost', href: action.href, textContent: action.label})
        : TN.button('btn ghost', action.label, action.onClick);
      box.append(b);
    }
    return box;
  }
  const failed = (ctx) => { if (ctx.current()) state(navigator.onLine === false ? 'offline' : 'error', t('cat_fail'), {label: t('cat_retry'), onClick: () => TN.route()}); };
  // a horizontal row (TN.row of the new shell) of the first titles of a list; nothing when the shell has no rows
  async function previewRow(m, key, def, ctx) {
    if (typeof TN.row !== 'function') return;
    let sc;
    try { sc = TN.row(t(key), {more: link(def), href: link(def)}); } catch (e) { return; }
    if (!sc || !sc.append) return;
    try {
      const r = await fetchPage(def, 1);
      if (!ctx.current()) return;
      for (const it of r.rows.slice(0, 20)) {
        const kind = it.media_type || m;
        if (kind !== 'movie' && kind !== 'tv') continue;
        const cell = titleCell(Object.assign({media_type: kind}, it), m);
        cell.classList.add('cat-rowcard');
        sc.append(cell);
      }
    } catch (e) {}
    if (!sc.children.length) { const h = sc.previousElementSibling; if (h && /^H\d$/.test(h.tagName)) h.remove(); sc.remove(); }
  }
  // episodes the viewer stopped in the middle of / watched last (history rows tv:<id>:<s>:<e>): the newest per show
  function continueRows(m) {
    const seen = new Set(), out = [];
    for (const h of TN.store.history() || []) {
      const k = String((h && h.key) || '').match(m === 'tv' ? /^tv:(\d+|tt\d+):(\d+):(\d+)$/ : /^movie:(\d+|tt\d+)$/);
      if (!k || seen.has(k[1])) continue;
      seen.add(k[1]);
      out.push({id: k[1], s: k[2], e: k[3], label: String(h.label || ''), thumb: TN.httpsOnly(h.thumb || '')});
      if (out.length >= 12) break;
    }
    return out;
  }
  function drawContinue(m) {
    const rows = continueRows(m);
    if (!rows.length || typeof TN.row !== 'function') return;
    let sc;
    try { sc = TN.row(t('cat_continue')); } catch (e) { return; }
    if (!sc || !sc.append) return;
    for (const r of rows) {
      const cine = /^tt/.test(r.id);
      const go = m === 'tv' ? () => TN.go(link({m: 'tv', v: cine ? 'cepisodes' : 'episodes', id: r.id, s: r.s}))
        : cine ? () => openCine({id: r.id, imdb: r.id, cine: true, media_type: 'movie', title: r.label}) : () => TN.openTitle('movie', r.id);
      const c = TN.card(r.thumb || 'icon.png', r.label, m === 'tv' ? `S${String(r.s).padStart(2, '0')}E${String(r.e).padStart(2, '0')}` : '', go);
      c.classList.add('cat-rowcard');
      sc.append(c);
    }
  }
  function menuOf(rows) {
    const box = document.createElement('div');
    box.className = 'menu';
    for (const r of rows) box.append(tile(link(r.def), r.ic, t(r.key)));
    TN.view().append(box);
    return box;
  }
  async function noKey(m, ctx) {
    TN.view().insertAdjacentHTML('beforeend', `<p class="hint">${esc(t('cat_keyless'))} <a href="#/services">${esc(t('cat_add_key'))}</a></p>`);
    menuOf(cineRoots(m));
    drawContinue(m);
    const rows = cineRoots(m);
    await previewRow(m, 'cat_popular', rows[0].def, ctx);
    if (!ctx.current()) return;
    // the Internet Archive classics stay, under the lists
    const g = TN.section(t('cat_classics'));
    const docs = await TN.archive({collection: m === 'movie' ? 'feature_films' : 'classic_tv', rows: 24}).catch(() => []);
    if (!ctx.current()) return;
    if (!docs.length) { if (g.previousElementSibling) g.previousElementSibling.remove(); g.remove(); return; }
    docs.forEach((d) => g.append(TN.card(`https://archive.org/services/img/${encodeURIComponent(d.identifier)}`, d.title, d.year || '', () => TN.openArchive(d))));
  }
  async function pageRoot(m, ctx) {
    style();
    head(t(m === 'movie' ? 'cat_movies' : 'cat_series'));
    searchForm(m);
    if (!TN.hasTmdbKey()) return noKey(m, ctx);
    menuOf(roots(m));
    drawContinue(m);
    const r = roots(m);
    await previewRow(m, r[0].key, r[0].def, ctx);
    if (ctx.current()) await previewRow(m, r[2].key, r[2].def, ctx);
  }
  function pageGroup(def) {
    style();
    const g = GROUPS[def.g] ? def.g : 'hebrew';
    head(t('cat_g_' + g), '#/' + (def.m === 'movie' ? 'movies' : 'tv'));
    menuOf(groupRows(g));
  }
  function pageCineGenres(def) {
    const m = def.m;
    head(t('cat_genres'), '#/' + (m === 'movie' ? 'movies' : 'tv'));
    const g = TN.section(t('cat_genres'));
    for (const name of CINE_GENRES[m]) {
      const id = CINE_ART[name];
      g.append(tile(link({m, v: 'cine', cat: 'top', genre: name, name: (id && genreName(id)) || name}), '', (id && genreName(id)) || name,
        id && GENRES.movie.concat(GENRES.tv).includes(id) ? ART + `genre_${id}.png` : 'icon.png'));
    }
  }
  function pageCineYears(def) {
    const m = def.m;
    head(t('cat_years'), '#/' + (m === 'movie' ? 'movies' : 'tv'));
    const g = TN.section(t('cat_years'));
    for (const y of years()) g.append(tile(link({m, v: 'cine', cat: 'year', genre: String(y), name: String(y)}), '', String(y), y <= 2027 ? ART + `year_${y}.png` : 'icon.png'));
  }
  // the key-less title sheet: poster, plot, Play through the sources service (by IMDb id), trailer, search everywhere
  async function openCine(it) {
    style();
    const m = it.media_type === 'tv' ? 'tv' : 'movie';
    const draw = (x) => {
      const name = x.title || x.name || '', year = (x.release_date || x.first_air_date || '');
      const meta = [year, x.runtime, x.vote_average ? '★ ' + Number(x.vote_average).toFixed(1) : '', (x.genres || []).join(', ')].filter(Boolean).join(' · ');
      TN.modal(`<div class="cat-sheet"><div class="img"></div><div><h2 dir="auto">${esc(name)}</h2><p class="hint" dir="auto">${esc(meta)}</p>` +
        `<p dir="auto">${esc(x.overview || '')}</p><div class="actions" id="cat_acts"></div></div></div>`);
      const sheet = document.getElementById('cat_acts');
      if (!sheet) return;
      TN.paint(sheet.closest('.cat-sheet').querySelector('.img'), x.poster || 'icon.png');
      const play = TN.button('btn', '▶ ' + t('cat_play'), async () => {
        const svc = await TN.provider('sources').catch(() => null);
        const q = {type: m, id: x.id, imdb: x.id, title: name, original: name, year: String(year).slice(0, 4)};
        if (svc && typeof svc.open === 'function') return svc.open(q);
        TN.closeModal(); TN.doSearch(name);
      });
      play.setAttribute('data-autofocus', '');
      sheet.append(play);
      if (/^[A-Za-z0-9_-]{11}$/.test(x.trailer || '')) {
        sheet.append(TN.button('btn ghost', t('cat_trailer'), async () => { const Y = await TN.provider('yt').catch(() => null); if (Y && Y.play) Y.play({id: x.trailer, title: name + ' - ' + t('cat_trailer')}); }));
      }
      sheet.append(TN.button('btn ghost', t('cat_all_sources'), () => { TN.closeModal(); TN.doSearch(name); }));
      play.focus();
    };
    draw(it);
    try {
      const full = cineNorm(await cineMeta(m, it.id), m);
      if (full && document.getElementById('cat_acts')) draw(Object.assign({}, it, full));
    } catch (e) {}
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
    const gl = def.v === 'cine' ? [] : await genreList(m);
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
          g.append(titleCell(Object.assign({media_type: kind}, it), m, it.cine ? '' : (it.genre_ids || []).slice(0, 2).map((id) => gname[id] || genreName(id)).filter(Boolean).join(', ')));
        }
      } finally {
        busy = false;
        more.disabled = false;
        more.hidden = page >= pages;
        if (page >= pages && io) io.disconnect();
      }
    }
    try { await next(); } catch (e) { if (sk.isConnected) sk.remove(); more.hidden = true; return failed(ctx); }
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
    let rows = [];
    try { rows = TN.hasTmdbKey() ? (await TN.tmdb(`/search/${m}`, {query: q})).results || [] : await cineSearch(m, q); } catch (e) {}
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
    try { show = show || await TN.tmdb('/tv/' + id); } catch (e) { sk.remove(); return failed(ctx); }
    if (!ctx.current()) return;
    sk.remove();
    TN.view().querySelector('h1').textContent = show.name || '';
    const acts = document.createElement('div');
    acts.className = 'actions';
    acts.append(TN.favButton({kind: 'series', id: Number(id), label: show.name || '', extra: '', img: show.poster_path ? TN.tmdbImg(show.poster_path) : ''}),
                TN.button('btn ghost', 'ⓘ ' + t('cat_details'), () => TN.openTitle('tv', id)),
                TN.button('btn ghost', t('cat_all_sources'), () => TN.doSearch(show.name || '')));
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
    return String(TN.settings.get('gemini_key', '') || s.gemini_key || '').trim();
  }
  // the build's own way (default.py translate_he): Google's public translate endpoint, one text a request, no key.
  // Used when there is no Gemini key; null when it does not answer (the English text is shown then).
  async function gtx(texts) {
    const out = [];
    for (const text of texts) {
      try {
        const r = await fetch('https://translate.googleapis.com/translate_a/single?' + new URLSearchParams({client: 'gtx', sl: 'en', tl: 'iw', dt: 't', q: String(text).slice(0, 1800)}),
          {credentials: 'omit'});
        if (!r.ok) return null;
        const j = await r.json();
        const he = ((j && j[0]) || []).map((p) => (p && p[0]) || '').join('').trim();
        if (!he) return null;
        out.push(he);
      } catch (e) { return null; }
    }
    return out;
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
    if (!todo.length) return {plots, tr: false};
    const texts = todo.map((e) => e.overview);
    const out = translate ? await translate(texts, gk) : (gk && await gemini(texts, gk)) || await gtx(texts.slice(0, 40)).then((a) => (a && a.length === texts.length ? a : null));
    if (!out) return {plots, tr: false};
    todo.forEach((e, i) => { plots[e.episode_number] = out[i]; });
    cache[key] = plots;
    const keys = Object.keys(cache);
    TN.put(PLOTS, keys.length > 400 ? Object.fromEntries(keys.slice(-300).map((k) => [k, cache[k]])) : cache);
    return {plots, tr: true};
  }
  const epKey = (id, s, e) => `tv:${id}:${s}:${e}`;
  // one row of an episode list: still, "1x05. name", date / runtime / rating, the watched mark (green dot + date), the plot
  function episodeRow(o) {
    const e = o.e, h = o.h;
    const b = document.createElement('button');
    b.className = 'hrow cat-ep';
    b.innerHTML = '<div class="img"></div><div>' +
      `<b dir="auto">${h ? `<span class="w" title="${esc(t('cat_watched'))}">● </span>` : ''}${esc(`${o.s}x${String(e.episode_number).padStart(2, '0')}. ${e.name || ''}`)}</b>` +
      `<br><small>${esc([e.air_date || '', e.runtime ? e.runtime + "'" : '', e.vote_average ? '★ ' + Number(e.vote_average).toFixed(1) : '',
                         h ? `${t('cat_watched')} ${h.when || ''}` : ''].filter(Boolean).join(' · '))}</small>` +
      (o.plot ? `<p dir="auto">${esc(o.plot)}${o.tr ? ` <small>(${esc(t('cat_plot_tr'))})</small>` : ''}</p>` : '') + '</div>';
    TN.paint(b.querySelector('.img'), o.still);
    if (h) b.setAttribute('aria-label', `${o.s}x${e.episode_number} ${e.name || ''} - ${t('cat_watched')}`);
    b.onclick = o.play;
    return b;
  }
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
    let show, season;
    try {
      show = await TN.tmdb('/tv/' + id, {append_to_response: `season/${s},external_ids`});
      season = show['season/' + s];
      if (!season || !season.episodes) season = await TN.tmdb(`/tv/${id}/season/${s}`);
    } catch (e) { sk.remove(); return failed(ctx); }
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
        list.append(episodeRow({id, s, e, h: seen[epKey(id, s, e.episode_number)], plot: e.overview || plots[e.episode_number] || '',
          tr: !e.overview && tr && !!plots[e.episode_number], still: still(e), play: () => playEpisode(show, id, s, e)}));
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


  // ------------------------------------------------------------- key-less series pages (Cinemeta ids)
  async function pageCineSeasons(def, ctx) {
    style();
    const id = String(def.id || '');
    if (!IMDB.test(id)) throw new Error('bad id');
    head('…', '#/tv');
    const sk = TN.skeleton(6);
    let meta;
    try { meta = await cineMeta('tv', id); } catch (e) { sk.remove(); return failed(ctx); }
    if (!ctx.current()) return;
    sk.remove();
    const show = cineNorm(meta, 'tv') || {name: '', id};
    TN.view().querySelector('h1').textContent = show.name || '';
    const acts = document.createElement('div');
    acts.className = 'actions';
    acts.append(TN.button('btn ghost', 'ⓘ ' + t('cat_details'), () => openCine(show)), TN.button('btn ghost', t('cat_all_sources'), () => TN.doSearch(show.name || '')));
    TN.view().append(acts);
    if (show.overview) TN.view().insertAdjacentHTML('beforeend', `<p class="hint" dir="auto">${esc(show.overview)}</p>`);
    const g = TN.section(t('cat_seasons'));
    const by = cineSeasons(meta);
    const nums = Object.keys(by).map(Number).sort((a, b) => (a === 0) - (b === 0) || a - b);
    for (const n of nums) {
      g.append(TN.card(show.poster || 'icon.png', `${t('cat_season')} ${n}`, `${by[n].length} · ${(by[n][0].air_date || '').slice(0, 4)}`,
        () => TN.go(link({m: 'tv', v: 'cepisodes', id, s: String(n)}))));
    }
    if (!g.children.length) TN.empty(g, t('cat_empty'));
  }
  async function pageCineEpisodes(def, ctx) {
    style();
    const id = String(def.id || ''), s = String(def.s || '');
    if (!IMDB.test(id) || !/^\d+$/.test(s)) throw new Error('bad id');
    head('…', link({m: 'tv', v: 'cseasons', id}));
    const sk = TN.skeleton(6);
    let meta;
    try { meta = await cineMeta('tv', id); } catch (e) { sk.remove(); return failed(ctx); }
    if (!ctx.current()) return;
    sk.remove();
    const show = cineNorm(meta, 'tv') || {name: '', id};
    TN.view().querySelector('h1').textContent = `${show.name || ''} · ${t('cat_season')} ${s}`;
    const eps = cineSeasons(meta)[Number(s)] || [];
    const seen = Object.fromEntries((TN.store.history() || []).filter((h) => h && h.key).map((h) => [h.key, h]));
    const list = document.createElement('div');
    list.className = 'hlist cat-eps';
    for (const e of eps) list.append(episodeRow({id, s, e, h: seen[epKey(id, s, e.episode_number)], plot: e.overview, tr: false, still: e.still || show.backdrop || show.poster || 'icon.png',
      play: () => playEpisode({name: show.name, original_name: show.name, first_air_date: show.first_air_date, external_ids: {imdb_id: id}}, id, s, e)}));
    if (!list.children.length) list.innerHTML = `<p class="msg">${esc(t('cat_empty'))}</p>`;
    TN.view().append(list);
  }
  // ------------------------------------------------------------- routing
  function parse(ctx, arg) {
    // the raw rest of the hash, so an encoded '&' in a search stays inside its value
    const raw = ctx && ctx.rest && ctx.rest.length ? ctx.rest.join('/') : String(arg || '');
    const p = Object.fromEntries(new URLSearchParams(raw));
    p.m = p.m === 'tv' ? 'tv' : 'movie';
    return p;
  }
  const VIEWS = {list: pageList, cine: pageList, genres: pageGenres, langs: pageLangs, years: pageYears, search: pageSearch, group: pageGroup,
                 cgenres: pageCineGenres, cyears: pageCineYears, cseasons: pageCineSeasons, cepisodes: pageCineEpisodes,
                 seasons: (d, c) => pageSeasons(d, c), episodes: pageEpisodes, kukhnya: pageKukhnya};
  // the lists that need the TMDb key; without one the same address shows the key-less root instead of an error
  const NEED_KEY = ['list', 'genres', 'langs', 'years', 'group', 'seasons', 'episodes', 'kukhnya'];
  TN.registerPage('movies', (arg, ctx) => pageRoot('movie', ctx));
  TN.registerPage('tv', (arg, ctx) => pageRoot('tv', ctx));
  TN.registerPage('catalog', (arg, ctx) => {
    const d = parse(ctx, arg);
    const v = VIEWS[d.v] ? d.v : 'list';
    if (v === 'list' && !okPath(d.path)) return pageRoot(d.m, ctx);
    if (NEED_KEY.includes(v) && !TN.hasTmdbKey()) return pageRoot(d.m, ctx);
    return VIEWS[v](d, ctx);
  });
  TN.registerProvider('catalog', {kinds: [], label: 'Catalog', roots, groupRows, GROUPS, link, fetchPage, query, years, hebrewPlots, statesEpisode,
                                  genreDef, langDef, yearDef, GENRES, LANGS, FIRST_YEAR, continueRows,
                                  cineUrl, cineNorm, cinePage, cineSearch, cineMeta, cineSeasons, cineRoots, openCine, CINE_GENRES});
  // the title sheet's Play button and the history resume come from sources.js (TN.addTitleAction): load it with the
  // catalogue, so a film opened on a fresh page has its Play button
  TN.load('sources').catch(() => {});
})(self.TN);
