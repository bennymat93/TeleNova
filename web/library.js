'use strict';
// WP-9: the Central library (Kodi B01-B04) on the web.
//   Sources: every provider the site really has, by the NAME it registers under (TN.providerOn checks that name), with a
//            switch that switches: search (tmdb, tgsearch, yt, dailymotion, archive, iptv, radio, topics), play sources
//            (tgsearch, rd, yt) and subtitles (wizdom, opensubs, yify, ktuvit, subsrv, subs_ai). All on / all off.
//            A row also says what the source still needs (a key, a login, the helper) with a link to where it is set.
//   Browse:  the build's library categories as links to the pages that hold them here.
//   Russian studio channels (providers.py RUSSIAN): the nine official YouTube channels, playing in the site.
//   Free legal libraries (libraries.py): Kodi installs an add-on; here each service opens on its own site.
// The switches are this browser's setting `providers_off` (not synced: Kodi's provider list names add-ons).
(function (root) {
  // ------------------------------------------------------------ pure (node: src/qa/web/t_services.js)
  // [provider name, group, what it needs: '' | 'tmdb' | 'tg' | 'rd' | 'yt' | 'helper' | 'oskey' | 'srv' | 'gemini']
  const SOURCES = [
    ['tmdb', 'search', ''], ['tgsearch', 'search', 'tg'], ['yt', 'search', 'yt'], ['dailymotion', 'search', ''], ['archive', 'search', ''],
    ['iptv', 'search', ''], ['radio', 'search', ''], ['topics', 'search', 'yt'],
    ['rd', 'play', 'rd'],
    ['wizdom', 'subs', ''], ['opensubs', 'subs', 'oskey'], ['yify', 'subs', ''], ['ktuvit', 'subs', 'helper'], ['subsrv', 'subs', 'srv'], ['subs_ai', 'subs', 'gemini'],
  ];
  const NAMES = SOURCES.map((s) => s[0]);
  // the two switches of the first web version that switched nothing: what they meant
  const OLD = {hub: ['dailymotion', 'archive'], subs: ['wizdom', 'opensubs', 'yify', 'ktuvit', 'subsrv', 'subs_ai']};
  // providers_off as it was stored -> the list with the old names replaced by the real ones (same list when nothing to do)
  function migrate(off) {
    const list = Array.isArray(off) ? off.filter((x) => typeof x === 'string') : [];
    if (!list.some((n) => OLD[n])) return list;
    const out = [];
    for (const n of list) for (const k of OLD[n] || [n]) if (!out.includes(k)) out.push(k);
    return out;
  }
  // the list after switching every source of a group (or all of them) on / off; names of other modules are kept
  function setAll(off, on, group) {
    const mine = SOURCES.filter((s) => !group || s[1] === group).map((s) => s[0]);
    const rest = migrate(off).filter((n) => !mine.includes(n));
    return on ? rest : rest.concat(mine);
  }
  const counts = (off) => { const o = migrate(off); const n = NAMES.filter((x) => o.includes(x)).length; return {on: NAMES.length - n, off: n}; };
  // libraries.py LIBRARIES: [he, en, ru, where it opens] - an in-app page ('#/...') or the service's own site
  const FREE = [
    ['Pluto TV – מאות ערוצים וסרטים', 'Pluto TV – hundreds of free channels & movies', 'Pluto TV – сотни каналов и фильмов', 'https://pluto.tv/'],
    ['Crackle – סרטים וסדרות', 'Crackle – free movies & series', 'Crackle – фильмы и сериалы', 'https://www.crackle.com/'],
    ['Internet Archive – סרטים קלאסיים (כולל רוסיים)', 'Internet Archive – classic films (incl. Soviet)', 'Internet Archive – классика (в т.ч. советское кино)', '#/movies'],
    ['Plex – סרטים חינם', 'Plex – free movies', 'Plex – бесплатные фильмы', 'https://watch.plex.tv/'],
    ['YouTube', 'YouTube', 'YouTube', '#/youtube'],
    ['Dailymotion', 'Dailymotion', 'Dailymotion', '#/hub'],
    ['Vimeo', 'Vimeo', 'Vimeo', 'https://vimeo.com/watch'],
    ['Twitch – שידורים חיים', 'Twitch – live streams', 'Twitch – стримы', 'https://www.twitch.tv/'],
    ['NASA', 'NASA', 'NASA', 'https://plus.nasa.gov/'],
    ['Red Bull TV – ספורט אתגרי', 'Red Bull TV – extreme sports', 'Red Bull TV – экстрим', 'https://www.redbull.com/int-en/discover'],
    ['NHK World – חדשות', 'NHK World – news', 'NHK World – новости', 'https://www3.nhk.or.jp/nhkworld/en/live/'],
    ['ARTE – תרבות ותעודה', 'ARTE – culture & documentaries', 'ARTE – культура и документалистика', 'https://www.arte.tv/'],
    ['PBS Kids – ילדים', 'PBS Kids', 'PBS Kids – детям', 'https://pbskids.org/videos'],
  ];
  // providers.py RUSSIAN: the official studio channels
  const RUSSIAN = [
    ['UCEK3tT7DcfWGWJpNEDBdWog', 'מוספילם – סרטים סובייטיים ורוסיים', 'Mosfilm – Soviet & Russian films', 'Мосфильм – советское и российское кино'],
    ['UCC2mTjSz2Hohl3zDBTCqF1Q', 'מוספילם לילדים', 'Mosfilm for kids', 'Мосфильм – для детей'],
    ['UCHS2LM1n3f5cyL-ebgkqyLw', 'סויוזמולטפילם – סרטים מצוירים', 'Soyuzmultfilm – animation', 'Союзмультфильм'],
    ['UC8p4E9GyMy-3OdLFx0GswTQ', 'סויוזמולטפילם לפעוטות', 'Soyuzmultfilm for toddlers', 'Союзмультфильм для мам и малышей'],
    ['UC5A-Wp9ujcr5g9sYagAafEA', 'סמשריקי', 'Smeshariki', 'Смешарики'],
    ['UCfU8IgesHohe5D8XkcY99Jw', 'בלרוספילם', 'Belarusfilm', 'Беларусьфильм'],
    ['UC4tlrTXCBw6NPZ9nCA3_s9w', 'קינופויסק – טריילרים וסקירות', 'Kinopoisk – trailers & reviews', 'Кинопоиск'],
    ['UCqg_YIWVnzRbeW0KBkuIcvA', 'קאחה – הסדרה (הערוץ הרשמי)', 'Kakha – the series (official)', 'Непосредственно Каха – официальный канал'],
    ['UCYFc8A8ZxeanxfBm4dyJUNg', 'קאחה – עונות מלאות (KTV)', 'Kakha – full seasons (KTV)', 'KTV – Непосредственно Каха'],
  ];
  const core = {SOURCES, NAMES, OLD, migrate, setAll, counts, FREE, RUSSIAN};
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }

  const TN = root.TN;
  if (!TN) return;
  root.TNLibrary = core;
  TN.i18n.add({
    he: {lb_intro: 'כל המקורות שהאתר משתמש בהם. מקור כבוי לא משתתף בחיפוש, ברשימות המקורות ובכתוביות בדפדפן הזה.',
         lb_on: 'פעיל', lb_off: 'כבוי', lb_all_on: 'הפעלת הכול', lb_all_off: 'כיבוי הכול', lb_sum: '%s פעילים, %s כבויים',
         lb_g_search: 'חיפוש ותוכן', lb_g_play: 'מקורות ניגון', lb_g_subs: 'כתוביות', lb_set: 'הגדרה', lb_ready: 'מוכן',
         lb_n_tmdb: 'סרטים וסדרות (TMDb / Cinemeta)', lb_n_tgsearch: 'טלגרם (חיפוש וניגון)', lb_n_yt: 'YouTube', lb_n_dailymotion: 'Dailymotion',
         lb_n_archive: 'ארכיון האינטרנט', lb_n_iptv: 'ערוצי טלוויזיה', lb_n_radio: 'רדיו', lb_n_topics: 'אקטואליה וידע',
         lb_n_rd: 'Real-Debrid', lb_n_wizdom: 'Wizdom', lb_n_opensubs: 'OpenSubtitles', lb_n_yify: 'YIFY', lb_n_ktuvit: 'Ktuvit',
         lb_n_subsrv: 'שרת כתוביות AI', lb_n_subs_ai: 'תרגום כתוביות (Gemini)',
         lb_need_tmdb: 'בלי מפתח TMDb: קטלוג Cinemeta', lb_need_tg: 'צריך להתחבר לטלגרם', lb_need_rd: 'צריך להתחבר ל-Real-Debrid',
         lb_need_yt: 'ניגון וקישורים עובדים; לחיפוש צריך מפתח או עוזר', lb_need_helper: 'צריך עוזר (Worker)', lb_need_oskey: 'צריך מפתח OpenSubtitles',
         lb_need_srv: 'צריך כתובת https של השרת', lb_need_gemini: 'צריך מפתח Gemini',
         lb_browse: 'עיון בספרייה', lb_b_movies: 'סרטים', lb_b_tv: 'סדרות', lb_b_live: 'טלוויזיה חיה', lb_b_radio: 'רדיו', lb_b_youtube: 'YouTube',
         lb_b_topics: 'אקטואליה וידע', lb_b_telegram: 'טלגרם', lb_b_hebrew: 'עברית וישראל', lb_b_russian: 'רוסית', lb_b_kids: 'ילדים',
         lb_ru_title: 'אולפנים רוסיים (ערוצים רשמיים)', lb_free_title: 'ספריות חוקיות בחינם',
         lb_free_hint: 'ב-Kodi אלה תוספים; באתר כל שירות נפתח באתר שלו (לשונית חדשה) או בעמוד שלו כאן.', lb_newtab: 'נפתח בלשונית חדשה', lb_here: 'כאן באתר'},
    en: {lb_intro: 'Every source the site uses. A source that is off takes no part in search, source lists and subtitles in this browser.',
         lb_on: 'On', lb_off: 'Off', lb_all_on: 'All on', lb_all_off: 'All off', lb_sum: '%s on, %s off',
         lb_g_search: 'Search and content', lb_g_play: 'Play sources', lb_g_subs: 'Subtitles', lb_set: 'Set up', lb_ready: 'Ready',
         lb_n_tmdb: 'Movies & series (TMDb / Cinemeta)', lb_n_tgsearch: 'Telegram (search and play)', lb_n_yt: 'YouTube', lb_n_dailymotion: 'Dailymotion',
         lb_n_archive: 'Internet Archive', lb_n_iptv: 'TV channels', lb_n_radio: 'Radio', lb_n_topics: 'News & knowledge',
         lb_n_rd: 'Real-Debrid', lb_n_wizdom: 'Wizdom', lb_n_opensubs: 'OpenSubtitles', lb_n_yify: 'YIFY', lb_n_ktuvit: 'Ktuvit',
         lb_n_subsrv: 'AI subtitle server', lb_n_subs_ai: 'Subtitle translation (Gemini)',
         lb_need_tmdb: 'No TMDb key: the Cinemeta catalogue', lb_need_tg: 'Needs a Telegram sign-in', lb_need_rd: 'Needs a Real-Debrid sign-in',
         lb_need_yt: 'Playing and links work; search needs a key or the helper', lb_need_helper: 'Needs the helper (Worker)', lb_need_oskey: 'Needs an OpenSubtitles key',
         lb_need_srv: 'Needs the server\'s https address', lb_need_gemini: 'Needs a Gemini key',
         lb_browse: 'Browse the library', lb_b_movies: 'Movies', lb_b_tv: 'Series', lb_b_live: 'Live TV', lb_b_radio: 'Radio', lb_b_youtube: 'YouTube',
         lb_b_topics: 'News & knowledge', lb_b_telegram: 'Telegram', lb_b_hebrew: 'Hebrew & Israel', lb_b_russian: 'Russian', lb_b_kids: 'Kids',
         lb_ru_title: 'Russian studios (official channels)', lb_free_title: 'Free legal libraries',
         lb_free_hint: 'In Kodi these are add-ons; here each service opens on its own site (a new tab) or on its page here.', lb_newtab: 'Opens in a new tab', lb_here: 'Here on the site'},
    ru: {lb_intro: 'Все источники сайта. Выключенный источник не участвует в поиске, списках источников и субтитрах в этом браузере.',
         lb_on: 'Вкл', lb_off: 'Выкл', lb_all_on: 'Включить все', lb_all_off: 'Выключить все', lb_sum: 'Включено: %s, выключено: %s',
         lb_g_search: 'Поиск и контент', lb_g_play: 'Источники воспроизведения', lb_g_subs: 'Субтитры', lb_set: 'Настроить', lb_ready: 'Готово',
         lb_n_tmdb: 'Фильмы и сериалы (TMDb / Cinemeta)', lb_n_tgsearch: 'Telegram (поиск и воспроизведение)', lb_n_yt: 'YouTube', lb_n_dailymotion: 'Dailymotion',
         lb_n_archive: 'Интернет-архив', lb_n_iptv: 'Телеканалы', lb_n_radio: 'Радио', lb_n_topics: 'Новости и знания',
         lb_n_rd: 'Real-Debrid', lb_n_wizdom: 'Wizdom', lb_n_opensubs: 'OpenSubtitles', lb_n_yify: 'YIFY', lb_n_ktuvit: 'Ktuvit',
         lb_n_subsrv: 'Сервер ИИ-субтитров', lb_n_subs_ai: 'Перевод субтитров (Gemini)',
         lb_need_tmdb: 'Без ключа TMDb: каталог Cinemeta', lb_need_tg: 'Нужен вход в Telegram', lb_need_rd: 'Нужен вход в Real-Debrid',
         lb_need_yt: 'Воспроизведение и ссылки работают; для поиска нужен ключ или помощник', lb_need_helper: 'Нужен помощник (Worker)', lb_need_oskey: 'Нужен ключ OpenSubtitles',
         lb_need_srv: 'Нужен https-адрес сервера', lb_need_gemini: 'Нужен ключ Gemini',
         lb_browse: 'Обзор библиотеки', lb_b_movies: 'Фильмы', lb_b_tv: 'Сериалы', lb_b_live: 'Прямой эфир', lb_b_radio: 'Радио', lb_b_youtube: 'YouTube',
         lb_b_topics: 'Новости и знания', lb_b_telegram: 'Telegram', lb_b_hebrew: 'Иврит и Израиль', lb_b_russian: 'Русское', lb_b_kids: 'Детям',
         lb_ru_title: 'Русские студии (официальные каналы)', lb_free_title: 'Бесплатные легальные библиотеки',
         lb_free_hint: 'В Kodi это дополнения; здесь каждый сервис открывается на своём сайте (в новой вкладке) или на своей странице здесь.', lb_newtab: 'Откроется в новой вкладке', lb_here: 'Здесь, на сайте'},
  });
  const t = TN.t;
  const li = () => ({he: 0, en: 1, ru: 2}[TN.lang()] === undefined ? 1 : {he: 0, en: 1, ru: 2}[TN.lang()]);
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const offList = () => TN.settings.get('providers_off', []) || [];
  // what a source still lacks: '' when it can work now
  function lacks(need) {
    const s = TN.settings, syn = s.synced() || {};
    if (need === 'tmdb') return TN.hasTmdbKey() ? '' : need;
    if (need === 'tg') return TN.get('tg_session', '') && TN.get('tg_api', null) ? '' : need;
    if (need === 'rd') return TN.get('rd_token', '') ? '' : need;
    if (need === 'yt') return String(s.get('yt_key', '') || '').trim() || s.helper() ? '' : need;
    if (need === 'helper') return s.helper() ? '' : need;
    if (need === 'oskey') return String(s.get('subs_os_key', '') || syn.os_key || syn.opensubs_key || '').trim() ? '' : need;
    if (need === 'srv') return String(s.get('subs_server_url', '') || '').trim() ? '' : need;
    if (need === 'gemini') return String(s.get('gemini_key', '') || syn.gemini_key || '').trim() ? '' : need;
    return '';
  }
  const SETUP = {tg: '#/tglogin'};                     // everything else is set on the Services screen

  function draw(focusName) {
    TN.page('library', t('m_library'));
    const view = TN.view();
    if (!document.getElementById('lb_css')) {
      const s = el('style'); s.id = 'lb_css';
      s.textContent = '.lb_list{display:grid;gap:10px;margin-top:10px;max-width:760px}.lb_row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}' +
        '.lb_row b{flex:1 1 180px}.lb_dim{background:var(--panel2);color:var(--muted)}.lb_h2{margin:22px 0 0;font-size:18px}' +
        '.lb_row .btn{min-width:84px}.lb_row a.tag{text-decoration:underline}';
      document.head.append(s);
    }
    // the first web version stored 'hub' and 'subs', names no provider has: replace them once by what they meant
    const stored = offList(), fixed = migrate(stored);
    if (fixed.join() !== stored.join()) TN.settings.set('providers_off', fixed);
    view.append(el('p', 'hint', t('lb_intro')));
    const c = counts(offList());
    const sum = el('p', 'hint', t('lb_sum', c.on, c.off)); sum.setAttribute('role', 'status'); view.append(sum);
    const top = el('div', 'links');
    top.append(TN.button('btn ghost', t('lb_all_on'), () => { TN.settings.set('providers_off', setAll(offList(), true)); TN.emit('providers', null); draw('!on'); }),
               TN.button('btn ghost', t('lb_all_off'), () => { TN.settings.set('providers_off', setAll(offList(), false)); TN.emit('providers', null); draw('!off'); }));
    top.firstChild.dataset.lb = '!on'; top.lastChild.dataset.lb = '!off';
    view.append(top);
    for (const group of ['search', 'play', 'subs']) {
      view.append(el('h2', 'lb_h2', t('lb_g_' + group)));
      const list = el('div', 'lb_list'); view.append(list);
      for (const [name, g, need] of SOURCES) {
        if (g !== group) continue;
        const on = TN.providerOn(name);
        const r = el('div', 'panel lb_row');
        r.append(el('b', '', t('lb_n_' + name)));
        const miss = lacks(need);
        if (miss) { const a = el('a', 'tag lb_dim', t('lb_need_' + miss)); a.href = SETUP[miss] || '#/services'; r.append(a); } else r.append(el('span', 'tag', t('lb_ready')));
        const b = TN.button('btn' + (on ? '' : ' ghost'), on ? t('lb_on') : t('lb_off'), () => { TN.setProviderOn(name, !on); draw(name); });
        b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(on));
        b.setAttribute('aria-label', t('lb_n_' + name)); b.dataset.lb = name;
        r.append(b);
        list.append(r);
      }
    }
    if (focusName) { const again = view.querySelector('[data-lb="' + focusName + '"]'); if (again) again.focus(); }

    // browse (the build's library categories -> the pages that hold them here)
    const cat = (m, g) => '#/catalog/' + new URLSearchParams({m, v: 'group', g});
    const g1 = TN.section(t('lb_browse'), null);
    [['lb_b_movies', '#/movies', 'media/cats/genre_28.png'], ['lb_b_tv', '#/tv', 'media/cats/genre_18.png'], ['lb_b_live', '#/live', 'data/topics/img/topic_news_il.png'],
     ['lb_b_radio', '#/radio', 'media/cats/genre_10402.png'], ['lb_b_youtube', '#/youtube', 'data/topics/img/topic_news_world.png'],
     ['lb_b_topics', '#/topics', 'data/topics/img/topic_tech.png'], ['lb_b_telegram', '#/telegram', 'data/topics/img/topic_control.png'],
     ['lb_b_hebrew', cat('movie', 'hebrew'), 'media/cats/lang_he.png'], ['lb_b_russian', cat('movie', 'russian'), 'media/cats/lang_ru.png'],
     ['lb_b_kids', cat('movie', 'kids'), 'media/cats/genre_10751.png']]
      .forEach(([k, href, img]) => g1.append(TN.card(img, t(k), null, () => TN.go(href), 'square')));

    // the Russian studios: with a key / the helper the channel's list, else the channel plays in the embed (its uploads, newest first)
    const g2 = TN.section(t('lb_ru_title'), RUSSIAN.length);
    RUSSIAN.forEach((ch) => g2.append(TN.card('media/cats/lang_ru.png', ch[1 + li()], null, async () => {
      const Y = await TN.provider('yt').catch(() => null);
      if (Y && Y.ready && !Y.ready() && Y.playList) return Y.playList('UU' + ch[0].slice(2), ch[1 + li()]);
      TN.go(TN.link('youtube', {ch: ch[0], n: ch[1 + li()]}));
    }, 'square')));

    // free legal libraries: each on its own site, or its page here
    view.append(el('h2', 'lb_h2', t('lb_free_title')), el('p', 'hint', t('lb_free_hint')));
    const fl = el('div', 'lb_list'); view.append(fl);
    for (const f of FREE) {
      const here = f[3].charAt(0) === '#';
      const a = el('a', 'panel lb_row');
      a.href = f[3];
      if (!here) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      a.style.textDecoration = 'none'; a.style.color = 'inherit';
      const nm = el('b', '', f[li()]); nm.dir = 'auto';
      a.append(nm, el('span', 'tag lb_dim', t(here ? 'lb_here' : 'lb_newtab')));
      fl.append(a);
    }
  }

  TN.registerPage('library', () => draw());
})(typeof self !== 'undefined' ? self : globalThis);
