'use strict';
// WP-7 (plan rows 18-20): Live TV. Replaces the built-in #/live page.
//   #/live                  the start list (setting 'live', default the build's Israeli table 'tn')
//   #/live/<list>           tn | il | he | ru | en | movies | kids | docs | news | music (the build's nine iptv-org lists)
//   #/live/own:<n>          one of the viewer's own playlists (Live TV > Sources)
//   #/live/c:<CC>           one country (iptv-org countries/<cc>.m3u)       #/live/countries   the world by country
//   #/live/<list>/g:<Group> one group of a list (Israel, News, Movies, ... like the build's iptv.classify)
//   #/live/favs             favourite channels        #/live/guide   the programme guide grid
//   #/live/sources          playlists, guide addresses, stream check (the build's "IPTV sources")
// The channel sheet (open) is the build's livefail.live in a browser: every source of a channel is tried in order -
// the broadcaster's https streams, the streams the free playlists carry for it, the official YouTube live broadcast
// (YouTube's own embedded player), Keshet's channels with a ticket from Keshet's own public ticket service (what the
// player on mako.co.il asks for), an https copy of an http stream, and the helper Worker for streams the browser
// may not read (no CORS) - with the state on the screen, and a clear reason plus real ways out (official site,
// another player, Kodi) when nothing plays. Unlicensed restream servers and paid Israeli channels are dropped from
// the free lists exactly as the build drops them (livefail.is_restream / is_paid_il).
// Provider 'iptv' (search) finds channels by name; open(channel) is the sheet for the other modules.
(function (TN) {
  TN.i18n.add({
    he: {iptv_l_tn: 'ערוצי ישראל', iptv_l_il: 'ישראל (iptv-org)', iptv_l_he: 'עברית', iptv_l_ru: 'רוסית', iptv_l_en: 'אנגלית', iptv_l_movies: 'סרטים', iptv_l_kids: 'ילדים', iptv_l_docs: 'תעודה', iptv_l_news: 'חדשות', iptv_l_music: 'מוזיקה',
         iptv_countries: 'לפי מדינה', iptv_world: 'העולם לפי מדינה', iptv_all: 'הכול', iptv_check: 'בדיקת ערוצים',
         iptv_checking: 'בודק %s מתוך %s…', iptv_checked: '%s ערוצים לא עונים סומנו', iptv_dead: 'לא עונה',
         iptv_http: '%s ערוצים משדרים בכתובת http. דף מאובטח מנגן אותם רק דרך עותק https או שרת העזר; הם מסומנים ומופיעים בסוף.',
         iptv_filter: 'סינון לפי שם', iptv_guide: 'לוח שידורים', iptv_label: 'ערוצים חיים',
         iptv_favs: 'מועדפים', iptv_favs_none: 'אין עדיין ערוצים מועדפים. פתחו ערוץ ולחצו "הוסף למועדפים".', iptv_sources: 'מקורות',
         iptv_try: 'מתחבר… מקור %s מתוך %s', iptv_try_helper: 'מנסה דרך שרת העזר… מקור %s מתוך %s', iptv_playing: 'מנגן · מקור %s מתוך %s',
         iptv_next_src: 'מקור אחר', iptv_retry: 'נסו שוב', iptv_prev: 'הערוץ הקודם', iptv_next: 'הערוץ הבא',
         iptv_fail: '%s אינו זמין כרגע מאף מקור - נסו שוב בעוד כמה דקות.', iptv_fail_n: 'נוסו %s מקורות.',
         iptv_why_http: 'המקור משדר ב-http בלבד, ודף מאובטח לא יכול לנגן אותו ישירות.',
         iptv_why_cors: 'ייתכן שהשרת של הערוץ לא מאפשר ניגון מתוך דפדפן (CORS) או שהשידור מוגבל לישראל.',
         iptv_why_helper: 'אפשר להגדיר שרת עזר (שירותים וחיבורים) כדי לנגן מקורות כאלה.',
         iptv_why_refused: 'שרת העזר לא מורשה לגשת לכתובת הזאת. הוסיפו את שם השרת של הערוץ ל-ALLOW_HOSTS של שרת העזר.',
         iptv_why_idan: 'הערוץ הזה משודר רק דרך הנגן הרשמי של הגוף המשדר. אפשר לצפות בו באתר הרשמי או באפליקציית BN Stream ב-Kodi.',
         iptv_why_yt: 'השידור החי מגיע מערוץ היוטיוב הרשמי.',
         iptv_site: 'צפייה באתר הרשמי', iptv_vlc: 'פתיחה ב-VLC', iptv_copy: 'העתקת הכתובת', iptv_copied: 'הכתובת הועתקה', iptv_kodi: 'BN Stream ל-Kodi',
         iptv_b_site: 'אתר', iptv_b_yt: 'YouTube', iptv_b_http: 'http',
         iptv_src_free: 'רשימות חינמיות', iptv_src_own: 'הרשימות שלי', iptv_src_name: 'שם הרשימה', iptv_src_url: 'כתובת M3U (https)',
         iptv_src_add: 'הוספה', iptv_src_file: 'או קובץ M3U מהמכשיר', iptv_src_del: 'מחיקה', iptv_src_none: 'אין עדיין רשימות משלך.',
         iptv_src_bad: 'צריך שם וכתובת https, או קובץ.', iptv_src_fail: 'הרשימה לא נקראה: %s', iptv_src_ok: 'נוספו %s ערוצים.',
         iptv_src_empty: 'לא נמצאו ערוצים ברשימה.', iptv_src_cors: 'האתר לא מאפשר קריאה מדפדפן. העלו את הקובץ מהמכשיר או הגדירו שרת עזר.',
         iptv_src_epg: 'כתובות לוח שידורים (XMLTV)', iptv_src_epg_url: 'כתובת XMLTV (https, אפשר .gz)', iptv_src_epg_file: 'או קובץ XMLTV מהמכשיר (לביקור הזה)',
         iptv_src_check: 'בדיקת ערוצים', iptv_src_check_txt: 'תוצאות הבדיקה נשמרות יום אחד בדפדפן הזה. ערוץ שלא ענה מוצג בסוף הרשימה.',
         iptv_src_clear: 'איפוס תוצאות הבדיקה', iptv_src_cleared: 'אופס.', iptv_src_on: 'מוצג', iptv_src_off: 'מוסתר',
         iptv_src_note: 'הרשימות והכתובות נשמרות בדפדפן הזה בלבד.', iptv_load_fail: 'הרשימה לא נטענה. בדקו את החיבור ונסו שוב.',
         grp_Israel: 'ישראל', grp_News: 'חדשות', grp_Movies: 'סרטים', grp_Series: 'סדרות', grp_Kids: 'ילדים', grp_Sport: 'ספורט',
         grp_Documentary: 'תעודה', grp_Music: 'מוזיקה', grp_Russian: 'רוסית', grp_Other: 'אחר', grp_Mine: 'הרשימה שלי'},
    en: {iptv_l_tn: 'Israeli channels', iptv_l_il: 'Israel (iptv-org)', iptv_l_he: 'Hebrew', iptv_l_ru: 'Russian', iptv_l_en: 'English', iptv_l_movies: 'Movies', iptv_l_kids: 'Kids', iptv_l_docs: 'Documentary', iptv_l_news: 'News', iptv_l_music: 'Music',
         iptv_countries: 'By country', iptv_world: 'The world by country', iptv_all: 'All', iptv_check: 'Check streams',
         iptv_checking: 'Checking %s of %s…', iptv_checked: '%s streams that do not answer were marked', iptv_dead: 'No answer',
         iptv_http: '%s channels broadcast over http. A secure page plays them only through an https copy or the helper server; they are marked and listed last.',
         iptv_filter: 'Filter by name', iptv_guide: 'TV guide', iptv_label: 'Live channels',
         iptv_favs: 'Favourites', iptv_favs_none: 'No favourite channels yet. Open a channel and press "Add to favourites".', iptv_sources: 'Sources',
         iptv_try: 'Connecting… source %s of %s', iptv_try_helper: 'Trying through the helper server… source %s of %s', iptv_playing: 'Playing · source %s of %s',
         iptv_next_src: 'Another source', iptv_retry: 'Try again', iptv_prev: 'Previous channel', iptv_next: 'Next channel',
         iptv_fail: '%s is not available from any source right now - try again in a few minutes.', iptv_fail_n: '%s sources were tried.',
         iptv_why_http: 'The source broadcasts over http only, and a secure page cannot play it directly.',
         iptv_why_cors: 'The channel\'s server may not allow playing inside a browser (CORS), or the broadcast is limited to Israel.',
         iptv_why_helper: 'You can set a helper server (Services) to play such sources.',
         iptv_why_refused: 'The helper server is not allowed to reach this address. Add the channel\'s host name to the helper\'s ALLOW_HOSTS.',
         iptv_why_idan: 'This channel is broadcast only through the broadcaster\'s official player. Watch it on the official site or in the BN Stream app in Kodi.',
         iptv_why_yt: 'The live broadcast comes from the official YouTube channel.',
         iptv_site: 'Watch on the official site', iptv_vlc: 'Open in VLC', iptv_copy: 'Copy the address', iptv_copied: 'Address copied', iptv_kodi: 'BN Stream for Kodi',
         iptv_b_site: 'SITE', iptv_b_yt: 'YouTube', iptv_b_http: 'http',
         iptv_src_free: 'Free lists', iptv_src_own: 'My playlists', iptv_src_name: 'Playlist name', iptv_src_url: 'M3U address (https)',
         iptv_src_add: 'Add', iptv_src_file: 'or an M3U file from this device', iptv_src_del: 'Delete', iptv_src_none: 'No playlists of your own yet.',
         iptv_src_bad: 'A name and an https address, or a file, are needed.', iptv_src_fail: 'The playlist could not be read: %s', iptv_src_ok: '%s channels added.',
         iptv_src_empty: 'No channels were found in the playlist.', iptv_src_cors: 'The site does not allow reading from a browser. Upload the file from this device or set a helper server.',
         iptv_src_epg: 'Guide addresses (XMLTV)', iptv_src_epg_url: 'XMLTV address (https, .gz allowed)', iptv_src_epg_file: 'or an XMLTV file from this device (for this visit)',
         iptv_src_check: 'Stream check', iptv_src_check_txt: 'Check results are kept for one day in this browser. A channel that did not answer is listed last.',
         iptv_src_clear: 'Reset the check results', iptv_src_cleared: 'Reset.', iptv_src_on: 'Shown', iptv_src_off: 'Hidden',
         iptv_src_note: 'Playlists and addresses are kept in this browser only.', iptv_load_fail: 'The list could not be loaded. Check the connection and try again.',
         grp_Israel: 'Israel', grp_News: 'News', grp_Movies: 'Movies', grp_Series: 'Series', grp_Kids: 'Kids', grp_Sport: 'Sport',
         grp_Documentary: 'Documentary', grp_Music: 'Music', grp_Russian: 'Russian', grp_Other: 'Other', grp_Mine: 'My playlist'},
    ru: {iptv_l_tn: 'Каналы Израиля', iptv_l_il: 'Израиль (iptv-org)', iptv_l_he: 'Иврит', iptv_l_ru: 'Русский', iptv_l_en: 'Английский', iptv_l_movies: 'Кино', iptv_l_kids: 'Детям', iptv_l_docs: 'Документальные', iptv_l_news: 'Новости', iptv_l_music: 'Музыка',
         iptv_countries: 'По странам', iptv_world: 'Мир по странам', iptv_all: 'Все', iptv_check: 'Проверить каналы',
         iptv_checking: 'Проверка %s из %s…', iptv_checked: 'Отмечено неотвечающих каналов: %s', iptv_dead: 'Не отвечает',
         iptv_http: 'Каналов с http-потоком: %s. Защищённая страница играет их только через https-копию или вспомогательный сервер; они отмечены и стоят в конце.',
         iptv_filter: 'Фильтр по названию', iptv_guide: 'Телепрограмма', iptv_label: 'Каналы',
         iptv_favs: 'Избранное', iptv_favs_none: 'Избранных каналов пока нет. Откройте канал и нажмите «В избранное».', iptv_sources: 'Источники',
         iptv_try: 'Подключение… источник %s из %s', iptv_try_helper: 'Пробуем через вспомогательный сервер… источник %s из %s', iptv_playing: 'Идёт показ · источник %s из %s',
         iptv_next_src: 'Другой источник', iptv_retry: 'Повторить', iptv_prev: 'Предыдущий канал', iptv_next: 'Следующий канал',
         iptv_fail: '%s сейчас недоступен ни из одного источника - попробуйте через несколько минут.', iptv_fail_n: 'Проверено источников: %s.',
         iptv_why_http: 'Источник вещает только по http, защищённая страница не может играть его напрямую.',
         iptv_why_cors: 'Возможно, сервер канала не разрешает показ в браузере (CORS) или вещание ограничено Израилем.',
         iptv_why_helper: 'Для таких источников можно указать вспомогательный сервер (Сервисы).',
         iptv_why_refused: 'Вспомогательному серверу не разрешён этот адрес. Добавьте хост канала в ALLOW_HOSTS сервера.',
         iptv_why_idan: 'Этот канал идёт только через официальный плеер вещателя. Смотрите его на официальном сайте или в приложении BN Stream в Kodi.',
         iptv_why_yt: 'Прямой эфир идёт с официального канала YouTube.',
         iptv_site: 'Смотреть на официальном сайте', iptv_vlc: 'Открыть в VLC', iptv_copy: 'Скопировать адрес', iptv_copied: 'Адрес скопирован', iptv_kodi: 'BN Stream для Kodi',
         iptv_b_site: 'САЙТ', iptv_b_yt: 'YouTube', iptv_b_http: 'http',
         iptv_src_free: 'Бесплатные списки', iptv_src_own: 'Мои плейлисты', iptv_src_name: 'Название плейлиста', iptv_src_url: 'Адрес M3U (https)',
         iptv_src_add: 'Добавить', iptv_src_file: 'или файл M3U с устройства', iptv_src_del: 'Удалить', iptv_src_none: 'Своих плейлистов пока нет.',
         iptv_src_bad: 'Нужны название и адрес https либо файл.', iptv_src_fail: 'Плейлист не прочитан: %s', iptv_src_ok: 'Добавлено каналов: %s.',
         iptv_src_empty: 'В плейлисте не найдено каналов.', iptv_src_cors: 'Сайт не разрешает чтение из браузера. Загрузите файл с устройства или укажите вспомогательный сервер.',
         iptv_src_epg: 'Адреса телепрограммы (XMLTV)', iptv_src_epg_url: 'Адрес XMLTV (https, можно .gz)', iptv_src_epg_file: 'или файл XMLTV с устройства (на этот визит)',
         iptv_src_check: 'Проверка каналов', iptv_src_check_txt: 'Результаты проверки хранятся сутки в этом браузере. Неответивший канал стоит в конце списка.',
         iptv_src_clear: 'Сбросить результаты проверки', iptv_src_cleared: 'Сброшено.', iptv_src_on: 'Показан', iptv_src_off: 'Скрыт',
         iptv_src_note: 'Плейлисты и адреса хранятся только в этом браузере.', iptv_load_fail: 'Список не загрузился. Проверьте соединение и попробуйте снова.',
         grp_Israel: 'Израиль', grp_News: 'Новости', grp_Movies: 'Фильмы', grp_Series: 'Сериалы', grp_Kids: 'Детям', grp_Sport: 'Спорт',
         grp_Documentary: 'Документальные', grp_Music: 'Музыка', grp_Russian: 'Русские', grp_Other: 'Другое', grp_Mine: 'Мой плейлист'},
  });
  const t = TN.t, esc = TN.esc;

  // the build's nine free lists (iptv.py FREE)
  const LISTS = {il: 'countries/il', he: 'languages/heb', ru: 'languages/rus', en: 'languages/eng', movies: 'categories/movies',
                 kids: 'categories/kids', docs: 'categories/documentary', news: 'categories/news', music: 'categories/music'};
  const BASE = 'https://iptv-org.github.io/iptv/';
  // the build's iptv.py: BLOCKS order and KEYWORDS
  const GROUPS = ['Mine', 'Israel', 'News', 'Movies', 'Series', 'Kids', 'Sport', 'Documentary', 'Music', 'Russian', 'Other'];
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

  // ---- the build's livefail.py rules for the free lists
  const RESTREAM_HOSTS = ['iptvhd.ru', 'freeott.top', 'mcquack.net'];
  const IP_HOST = /^https?:\/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\//i;
  const TOKEN_PATH = /\/(?:iptv|live|play)\/[A-Za-z0-9]{16,}(?:\/|$)|\/live\/[^/]+\/[^/]+\/\d+/i;
  const PAID_IL = /^(?:5\s?(?:sport|plus|live|gold|stars)|sport\s?[1-5]\b|hot\s|hot\d|yes\s|one\s?2?\b|disney|junior|luli|hop!?|nick\s?jr|teennick|jimjam|baby\s?first|viva\s|health channel|sport edge|eurosport)/i;
  function isRestream(url) {
    const u = String(url || '').split('|')[0];
    return RESTREAM_HOSTS.some((h) => u.includes(h)) || IP_HOST.test(u) || TOKEN_PATH.test(u);
  }
  const isPaidIl = (name) => PAID_IL.test(String(name || '').trim());
  // the build's epg.norm: 'Keshet 12 (1080p) [Geo-blocked]' -> 'keshet 12' (the same function as in epg.js)
  function norm(name) {
    let n = String(name || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').trim();
    n = n.replace(/\.(il|uk|us|de|fr|es|it|nl|tr|ru|[a-z]{2})$/i, '');
    n = n.replace(/[._-]/g, ' ');
    n = n.replace(/(^|[^\p{L}\p{N}_])(hd|fhd|uhd|4k|sd|live|tv)(?=$|[^\p{L}\p{N}_])/giu, '$1 ').replace(/שידור חי/g, ' ');
    return n.toLowerCase().replace(/[^\p{L}\p{N}_+! ]/gu, ' ').split(/\s+/).filter(Boolean).join(' ');
  }

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

  // m3u -> [{name, logo, group, attrs, url}]
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
        rows.push(Object.assign(cur, {url: line.split('|')[0]}));
        cur = null;
      }
    }
    return rows;
  }
  // rows -> channels: one per name, every stream kept (https in 'urls', http in 'http'): the failover list.
  // free: a free public list - restream servers and paid Israeli channels are dropped, as the build does;
  // a viewer's own playlist (free = false) is theirs and stays exactly as it is, in its own order
  function merge(rows, src, free) {
    if (free === undefined) free = true;
    const by = new Map();
    let http = 0, dropped = 0;
    for (const r of rows) {
      const secure = /^https:\/\//i.test(r.url), plain = /^http:\/\//i.test(r.url);
      if (!secure && !plain) continue;
      const cls = free ? classify(r.name, r.group, r.attrs, src) : 'Mine';
      if (free && (isRestream(r.url) || (isPaidIl(r.name) && cls === 'Israel'))) { dropped++; continue; }
      const name = displayName(r.name), k = free ? (normKey(name) || r.url) : r.url;
      let c = by.get(k);
      if (!c) {
        c = {name, logo: TN.httpsOnly(r.logo) || '', group: r.group, cls, cc: country(r.attrs), url: '', urls: [], http: []};
        by.set(k, c);
      } else if (!c.logo && r.logo) c.logo = TN.httpsOnly(r.logo);
      const into = secure ? c.urls : c.http;
      if (!into.includes(r.url)) into.push(r.url);
    }
    const all = [...by.values()];
    for (const c of all) { c.url = c.urls[0] || ''; if (!c.urls.length) http++; }
    // order: Israel first, then A-Z (a viewer's own list keeps its order); channels with only http streams last
    const out = free ? all.sort((a, b) => GROUPS.indexOf(a.cls) - GROUPS.indexOf(b.cls) || a.name.localeCompare(b.name)) : all;
    return {items: out.filter((c) => c.urls.length).concat(out.filter((c) => !c.urls.length)), http, dropped};
  }

  // ---- the build's own Israeli table (channels_il.json) + the streams the free Israeli list carries for its channels
  function tnChannel(c) {
    const urls = (c.urls || []).filter(TN.httpsOnly);
    return {key: c.key, name: c.name, name_he: c.name_he || '', names: c.names || [], logo: c.logo || '', group: 'BN Stream', cls: 'Israel', cc: 'IL',
            urls, url: urls[0] || '', http: (c.http || []).slice(), yt: c.yt || '', site: TN.httpsOnly(c.site) || '', guide: c.guide || '',
            mako: (Array.isArray(c.mako) ? c.mako : []).filter((x) => x && typeof x.link === 'string' && x.link.startsWith('/')),
            why: c.why || '', kodi_only: !urls.length && !(c.http || []).length && !c.yt && !(c.mako || []).length};
  }
  // iptv._merge / live_extra.json: a playlist stream of one of the build's channels plays after the broadcaster's own
  function addExtras(tn, listed) {
    const byName = new Map();
    for (const c of tn) for (const n of [c.name, c.name_he].concat(c.names || [])) { const k = norm(n); if (k && !byName.has(k)) byName.set(k, c); }
    let added = 0;
    for (const x of listed || []) {
      if (x.cc && x.cc !== 'IL') continue;                   // the Russian 'Channel12.ru' is not Keshet 12
      const c = byName.get(norm(x.name));
      if (!c) continue;
      for (const u of x.urls || []) if (!c.urls.includes(u)) { c.urls.push(u); added++; }
      for (const u of x.http || []) if (!c.http.includes(u)) { c.http.push(u); added++; }
      if (!c.logo && x.logo) c.logo = x.logo;
      c.url = c.urls[0] || '';
      if (c.urls.length || c.http.length) c.kodi_only = false;
    }
    return added;
  }

  // ---- lists
  const OWN = 'iptv_own', OFF = 'iptv_off';
  const ownLists = () => { const o = TN.get(OWN, []); return Array.isArray(o) ? o.filter((x) => x && typeof x === 'object' && x.name) : []; };
  const offLists = () => { const o = TN.get(OFF, []); return Array.isArray(o) ? o : []; };
  const cache = {};
  let helperLoaded = null;
  function helper() {                                       // the Worker client, when a helper address is set
    const base = TN.settings.helper ? TN.settings.helper() : '';
    if (!base) return Promise.resolve(null);
    if (!helperLoaded) helperLoaded = TN.loadScript('helper.js').then(() => self.TNHelper || null).catch(() => null);
    return helperLoaded;
  }
  // a text file from another site: directly, else through the helper; err.code 'cors' when neither works
  async function fetchText(url) {
    let r = null;
    try { r = await fetch(url, {credentials: 'omit'}); } catch (e) { r = null; }
    if (r && r.ok) return r.text();
    if (r && !r.ok && r.status !== 0) throw new Error('HTTP ' + r.status);
    const base = TN.settings.helper ? TN.settings.helper() : '';
    if (!base) { const e = new Error(t('iptv_src_cors')); e.code = 'cors'; throw e; }
    const h = await fetch(base + '/p', {headers: {'X-TN-Target': url}, credentials: 'omit', cache: 'no-store'});
    if (!h.ok) { const e = new Error(h.status === 403 ? t('iptv_why_refused') : 'helper ' + h.status); e.code = 'helper'; throw e; }
    return h.text();
  }
  async function load(list) {
    if (cache[list]) return cache[list];
    if (list === 'tn') {
      const r = await fetch('channels_il.json');
      const items = (r.ok ? await r.json() : []).map(tnChannel);
      // the free Israeli list may carry more streams of the same channels: wait for it a moment, never fail on it
      const il = await Promise.race([load('il').catch(() => null), new Promise((ok) => setTimeout(() => ok(null), 4000))]);
      if (il) addExtras(items, il.items);
      const data = {items, http: 0};
      if (il) cache.tn = data;
      return data;
    }
    if (list.startsWith('own:')) {
      const o = ownLists()[parseInt(list.slice(4), 10)];
      if (!o) return {items: [], http: 0};
      const rows = Array.isArray(o.rows) ? o.rows.map((x) => ({name: x[0], url: x[1], logo: x[2] || '', group: x[3] || '', attrs: {}})) : parseM3u(await fetchText(o.url));
      return (cache[list] = merge(rows, list, false));
    }
    const path = list.startsWith('c:') ? 'countries/' + list.slice(2).toLowerCase() : LISTS[list];
    if (!path) return {items: [], http: 0};
    const r = await fetch(BASE + path + '.m3u');
    if (!r.ok) throw new Error('m3u ' + r.status);
    return (cache[list] = merge(parseM3u(await r.text()), list.startsWith('c:') ? '' : list, true));
  }
  TN.on('clearcache', () => { for (const k of Object.keys(cache)) delete cache[k]; });

  // ---- favourites (the store's kind 'web_channel': 'il:<key>' or a stream address, extra = logo)
  const favId = (c) => (c.key ? 'il:' + c.key : c.url || (c.http || [])[0] || (c.yt ? 'yt:' + c.yt : ''));
  async function favChannels() {
    const favs = (TN.store.favs() || []).filter((f) => f && f.kind === 'web_channel' && f.id);
    if (!favs.length) return [];
    const tn = favs.some((f) => String(f.id).startsWith('il:')) ? (await load('tn').catch(() => ({items: []}))).items : [];
    const out = [];
    for (const f of favs) {
      const id = String(f.id);
      if (id.startsWith('il:')) { const c = tn.find((x) => x.key === id.slice(3)); if (c) out.push(c); continue; }
      const secure = /^https:\/\//i.test(id);
      if (!secure && !/^http:\/\//i.test(id)) continue;
      out.push({name: f.label || id, logo: TN.httpsOnly(f.extra) || TN.store.art('web_channel', id) || '', group: '', cls: 'Other',
                urls: secure ? [id] : [], http: secure ? [] : [id], url: secure ? id : ''});
    }
    return out;
  }

  // ---- dead-stream probe: kept a day in this browser (url -> [ok, time])
  const PROBE_KEY = 'iptv_probe', DAY = 864e5;
  const probes = () => { const p = TN.get(PROBE_KEY, {}); return p && typeof p === 'object' ? p : {}; };
  const streamsOf = (c) => (c.urls && c.urls.length ? c.urls : c.url ? [c.url] : []);
  function isDead(c) {
    const p = probes(), now = Date.now(), all = streamsOf(c);
    const known = all.map((u) => p[u]).filter((x) => x && now - x[1] < DAY);
    return known.length === all.length && known.length > 0 && known.every((x) => !x[0]);
  }
  function mark(url, ok) {
    if (!url) return;
    const p = probes();
    p[url] = [!!ok, Date.now()];
    TN.put(PROBE_KEY, p);
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
    const urls = [...new Set(items.flatMap(streamsOf).filter(Boolean))];
    const p = probes(), now = Date.now();
    if (!fetchFn) {                                         // with a helper set, a stream without CORS is asked through it
      const H = await helper();
      if (H) fetchFn = (u, o) => H.fetch(u, {signal: o && o.signal, timeout: 6000});
    }
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

  // ---- Keshet's channels (channels_il.json 'mako'): the stream opens with a short-lived ticket that Keshet's public
  // ticket service gives any page without a login - the request the player on mako.co.il makes, and Idan+ in the build.
  // The ticket is the CDN's own access mark for that one stream; it is asked for when the channel opens, used in the
  // stream address as the CDN requires, never stored and never shown.
  const MAKO_TICKETS = 'https://mass.mako.co.il/ClicksStatistics/entitlementsServicesV2.jsp';
  const MAKO_HOST = 'https://mako-streaming.akamaized.net';
  const makoAsk = (feed) => MAKO_TICKETS + '?et=ngt&lp=' + feed.link + '&rv=' + (feed.cdn || 'AKAMAI');
  // the ticket service's answer -> the stream address, or '' (caseId 1 = granted)
  function makoStream(feed, answer) {
    const tk = answer && String(answer.caseId) === '1' && answer.tickets && answer.tickets[0] && answer.tickets[0].ticket;
    if (!tk || typeof tk !== 'string') return '';
    let ticket = tk;
    try { ticket = decodeURIComponent(tk.replace(/\+/g, ' ')); } catch (e) {}
    const host = TN.httpsOnly(feed.host) || MAKO_HOST;
    return host + feed.link + (feed.link.includes('?') ? '&' : '?') + ticket;
  }
  async function makoResolve(feed, fetchFn) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), 8000);
    try {
      const r = await (fetchFn || fetch)(makoAsk(feed), {credentials: 'omit', cache: 'no-store', signal: ctl ? ctl.signal : undefined});
      return r.ok ? makoStream(feed, await r.json()) : '';
    } catch (e) { return ''; } finally { clearTimeout(timer); }
  }

  // ---- the sources of one channel, in the order they are tried (livefail.candidates)
  //   {kind: 'hls' | 'file' | 'yt', url, via: 'direct' | 'ticket' | 'upgrade' | 'helper', from}   from = the address as listed
  const FILE = /\.(mp4|webm|m4v|mov|mp3|aac|m4a|ogg)(\?|#|$)/i;
  function candidates(c, hasHelper) {
    const out = [], p = probes(), now = Date.now();
    const dead = (u) => !!(p[u] && now - p[u][1] < DAY && !p[u][0]);
    const https = streamsOf(c);
    for (const u of https.filter((x) => !dead(x)).concat(https.filter(dead))) out.push({kind: FILE.test(u) ? 'file' : 'hls', url: u, via: 'direct', from: u});
    for (const f of c.mako || []) out.push({kind: 'hls', url: '', via: 'ticket', mako: f, from: 'mako:' + f.link});
    if (c.yt) out.push({kind: 'yt', url: c.yt, via: 'direct', from: 'yt:' + c.yt});
    for (const u of c.http || []) out.push({kind: FILE.test(u) ? 'file' : 'hls', url: u.replace(/^http:/i, 'https:'), via: 'upgrade', from: u});
    if (hasHelper) for (const u of c.http || []) if (!FILE.test(u)) out.push({kind: 'hls', url: u, via: 'helper', from: u});
    return out;
  }
  const ytEmbed = (ref) => (/^UC[0-9A-Za-z_-]{22}$/.test(ref) ? 'https://www.youtube-nocookie.com/embed/live_stream?channel=' + ref + '&autoplay=1&playsinline=1' : '');
  const ytPage = (ref) => 'https://www.youtube.com/' + (ref.startsWith('@') ? ref : 'channel/' + ref) + '/live';
  // hls.js through the helper Worker: every request goes to <helper>/p with the real address in a header (never in
  // the query); the playlist keeps its own address, so relative parts resolve against the broadcaster
  function helperHls(Hls, base) {
    const Base = Hls.DefaultConfig.loader;
    class Loader extends Base {
      load(context, config, callbacks) {
        const real = context.url, done = callbacks.onSuccess;
        callbacks.onSuccess = (response, stats, ctx, net) => { response.url = real; done(response, stats, ctx, net); };
        super.load(context, config, callbacks);
      }
    }
    return {loader: Loader, xhrSetup(xhr, url) { xhr.open('GET', base + '/p', true); xhr.setRequestHeader('X-TN-Target', url); }};
  }

  const shown = (c) => (TN.lang() === 'he' && c.name_he ? c.name_he : c.name);
  let playing = null;                 // the open channel sheet: {stop()}
  function stopPlaying() { const p = playing; playing = null; if (p) p.stop(); }

  // ---- the channel sheet. ctx: {list: [channels], index} for previous / next channel
  async function open(c, ctx) {
    stopPlaying();
    if (TN.stopRadio) TN.stopRadio();
    style();
    const name = shown(c), id = favId(c);
    const zap = ctx && ctx.list && ctx.list.length > 1 ? ctx : null;
    TN.modal(`<div class="player iptv-player" id="iptv_box"><video id="iptv_v" controls autoplay playsinline></video></div>
      <div class="detail" style="grid-template-columns:1fr"><div><h3 dir="auto">${esc(name)}</h3>
      <div class="meta">${esc(c.cls ? t('grp_' + c.cls) : c.group || '')}</div>
      <p class="hint iptv-status" id="iptv_st" role="status" aria-live="polite"></p><div id="iptv_epg"></div>
      <div class="actions" id="acts"></div><div class="actions iptv-more" id="iptv_more"></div></div></div>`);
    const $ = (x) => document.getElementById(x);
    const box = $('iptv_box'), st = $('iptv_st'), acts = $('acts'), more = $('iptv_more');
    let v = $('iptv_v'), hls = null, timer = null, at = -1, tried = 0, refused = false, alive = true;
    let tick = null, obs = null;                           // (set below; a sheet may be closed before it finished opening)
    const me = {stop() { alive = false; clearTimeout(timer); clearInterval(tick); try { if (hls) hls.destroy(); } catch (e) {} hls = null;
      try { if (obs) obs.disconnect(); } catch (e) {} document.removeEventListener('keydown', keys, true);
      try { if (v) { v.pause(); v.removeAttribute('src'); v.load(); } } catch (e) {} }};
    playing = me;
    // the app closes the sheet by emptying it: notice that and stop
    obs = new MutationObserver(() => { if (!document.body.contains(box)) { if (playing === me) playing = null; me.stop(); } });
    obs.observe($('sheet') || document.body, {childList: true, subtree: true});
    const say = (x) => { st.textContent = x || ''; };

    const H = await helper();
    if (!alive) return;
    const cands = candidates(c, !!H);
    // the guide line, refreshed every minute; the buttons
    const epg = await TN.provider('epg').catch(() => null);
    if (epg) await epg.ready();
    if (!alive) return;
    const drawEpg = () => { if (epg) { $('iptv_epg').innerHTML = ''; $('iptv_epg').append(epg.bar(c)); } };
    drawEpg();
    tick = setInterval(() => (alive ? drawEpg() : clearInterval(tick)), 60000);
    if (id) acts.append(TN.favButton({kind: 'web_channel', id, label: name, extra: /^https:/.test(c.logo || '') ? c.logo : '', img: c.logo || ''}));
    if (epg) acts.append(TN.button('btn ghost', t('iptv_guide'), () => epg.sheet(c, name)));
    if (zap) {
      const go = (d) => { const n = zap.list.length, i = ((zap.index + d) % n + n) % n; open(zap.list[i], {list: zap.list, index: i}); };
      acts.append(TN.button('btn ghost', t('iptv_prev'), () => go(-1)), TN.button('btn ghost', t('iptv_next'), () => go(1)));
      me.go = go;
    }
    const nextBtn = TN.button('btn ghost', t('iptv_next_src'), () => { clearTimeout(timer); failed(true); });
    if (cands.length > 1) acts.append(nextBtn);
    function keys(e) {                                     // remote keys: channel up / down
      if (!me.go || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
      if (e.key === 'PageUp' || e.key === 'ChannelUp') { e.preventDefault(); me.go(-1); }
      else if (e.key === 'PageDown' || e.key === 'ChannelDown') { e.preventDefault(); me.go(1); }
    }
    document.addEventListener('keydown', keys, true);

    function ways(url) {                                    // the ways out: official site, another player, Kodi
      more.innerHTML = '';
      const link = (href, text, ext) => { const a = document.createElement('a'); a.className = 'btn ghost'; a.href = href; a.textContent = text;
        if (ext) { a.target = '_blank'; a.rel = 'noopener'; } more.append(a); };
      if (c.site) link(c.site, t('iptv_site'), true);
      if (c.yt && !ytEmbed(c.yt)) link(ytPage(c.yt), 'YouTube', true);
      if (url && /^https?:\/\//i.test(url)) {
        link('vlc://' + url, t('iptv_vlc'), false);
        more.append(TN.button('btn ghost', t('iptv_copy'), async (e) => {
          try { await navigator.clipboard.writeText(url); e.target.textContent = t('iptv_copied'); }
          catch (er) { window.prompt(t('iptv_copy'), url); }
        }));
      }
      link('#/bn', t('iptv_kodi'), false);
    }
    function ok() {
      if (!alive) return;
      clearTimeout(timer);
      const cd = cands[at];
      if (cd.via === 'direct' && cd.kind !== 'yt') mark(cd.url, true);
      say(cands.length > 1 ? t('iptv_playing', at + 1, cands.length) : '');
    }
    function failed(manual) {
      if (!alive) return;
      clearTimeout(timer);
      const cd = cands[at];
      if (cd && cd.via === 'direct' && cd.kind !== 'yt' && !manual) mark(cd.url, false);
      if (cd && cd.via === 'ticket') cd.url = '';          // a ticket lives a few minutes: a new one on the next try
      start(at + 1 < cands.length ? at + 1 : manual ? 0 : -1);
    }
    function allFailed() {
      try { if (hls) hls.destroy(); } catch (e) {}
      hls = null;
      box.hidden = true;
      const why = [];
      if (c.kodi_only || !cands.length) why.push(t('iptv_why_idan'));
      else {
        why.push(t('iptv_fail', name) + (tried > 1 ? ' ' + t('iptv_fail_n', tried) : ''));
        if (refused) why.push(t('iptv_why_refused'));
        if ((c.http || []).length && !streamsOf(c).length) why.push(t('iptv_why_http'));
        else why.push(t('iptv_why_cors'));
        if (!H) why.push(t('iptv_why_helper'));
      }
      st.className = 'msg iptv-status';
      say(why.join(' '));
      nextBtn.remove();
      if (cands.length) acts.append(TN.button('btn', t('iptv_retry'), () => open(c, ctx)));
      for (const x of cands) if (x.via === 'ticket') x.url = '';               // a ticket lives a few minutes: a new one next time
      ways((cands.find((x) => /^https?:/i.test(x.from)) || {}).from || '');
    }
    function freshVideo() {
      try { if (hls) hls.destroy(); } catch (e) {}
      hls = null;
      box.innerHTML = '<video id="iptv_v" controls autoplay playsinline></video>';
      v = box.firstChild;
    }
    function start(i) {
      if (!alive) return;
      if (i < 0 || i >= cands.length) return allFailed();
      at = i; tried++;
      const cd = cands[i], Hls = self.Hls;
      box.hidden = false;
      st.className = 'hint iptv-status';
      say(t(cd.via === 'helper' ? 'iptv_try_helper' : 'iptv_try', i + 1, cands.length));
      ways(/^https?:/i.test(cd.from) ? cd.from : '');
      if (cd.via === 'ticket' && !cd.url) {                // Keshet: ask for the ticket, then play like any stream
        box.hidden = false;
        makoResolve(cd.mako).then((u) => {
          if (!alive || at !== i) return;
          if (!u) return failed();
          cd.url = u;
          tried--;
          start(i);
        });
        return;
      }
      if (cd.kind === 'yt') {
        const src = ytEmbed(cd.url);
        if (!src) return failed();
        try { if (hls) hls.destroy(); } catch (e) {}
        hls = null;
        box.innerHTML = `<iframe src="${esc(src)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="${esc(name)}"></iframe>`;
        v = null;
        say(t('iptv_why_yt'));
        return;
      }
      freshVideo();
      const mine = v;
      mine.addEventListener('playing', () => { if (v === mine) ok(); }, {once: true});
      mine.addEventListener('loadeddata', () => { if (v === mine) ok(); }, {once: true});
      mine.addEventListener('error', () => { if (v === mine && !hls) failed(); });
      timer = setTimeout(() => { if (v === mine && mine.readyState < 2) failed(); }, 20000);
      const native = cd.kind === 'file' || !!mine.canPlayType('application/vnd.apple.mpegurl');
      if (cd.via === 'helper' || (!native && Hls && Hls.isSupported())) {
        if (!(Hls && Hls.isSupported())) return failed();
        const viaHelper = (useHelper) => {
          try { if (hls) hls.destroy(); } catch (e) {}
          hls = new Hls(TN.hlsCfg(useHelper && H ? helperHls(Hls, H.url()) : {}));      // 5.1: tuned for weak connections (app.js)
          TN.hlsWatch(hls);
          let retried = false;
          hls.on(Hls.Events.ERROR, (ev, d) => {
            if (!d || !d.fatal || v !== mine) return;
            const code = d.response && d.response.code;
            if (useHelper && code === 403) refused = true;
            // a stream the browser may not read (no CORS) looks like a network error with no answer: ask the helper once
            if (!useHelper && !retried && H && d.type === Hls.ErrorTypes.NETWORK_ERROR && !code && (cd.via === 'direct' || cd.via === 'ticket')) {
              retried = true;
              say(t('iptv_try_helper', i + 1, cands.length));
              return viaHelper(true);
            }
            failed();
          });
          hls.loadSource(cd.url);
          hls.attachMedia(mine);
        };
        viaHelper(cd.via === 'helper');
      } else mine.src = cd.url;
      const pl = mine.play && mine.play();
      if (pl && pl.catch) pl.catch(() => {});
    }
    if (id && cands.length) {
      try { TN.noteHistory({key: 'ch:' + id, label: name, play: streamsOf(c)[0] || '', thumb: TN.httpsOnly(c.logo) || ''}); } catch (e) {}
    }
    start(cands.length ? 0 : -1);
  }

  function badge(c, dead) {
    if (c.kodi_only) return t('iptv_b_site');
    if (dead) return t('iptv_dead');
    if (!streamsOf(c).length) return (c.mako || []).length ? 'LIVE' : c.yt ? t('iptv_b_yt') : t('iptv_b_http');
    return 'LIVE';
  }
  function chCard(c, epg, ctx) {
    const dead = isDead(c);
    const el = TN.card(c.logo || 'icon.png', shown(c), t('grp_' + c.cls) || c.group, () => open(c, ctx),
                       'wide' + (c.kodi_only || dead ? ' dim' : ''), badge(c, dead));
    if (epg) { const b = epg.bar(c); if (b.childNodes.length) el.append(b); }
    return el;
  }
  function style() {
    if (document.getElementById('iptv-style')) return;
    const s = document.createElement('style');
    s.id = 'iptv-style';
    s.textContent = '.iptv-player iframe{width:100%;aspect-ratio:16/9;border:0;display:block;background:#000}.iptv-status{min-height:1.4em}' +
      '.iptv-more{margin-top:8px}.iptv-more .btn{font-size:.9em}.iptv-src form{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0;align-items:center}' +
      '.iptv-src input[type=text],.iptv-src input[type=url]{flex:1 1 220px;min-width:0}.iptv-src .hrow{display:flex;gap:10px;align-items:center;justify-content:space-between}' +
      '.iptv-src .hrow span{overflow-wrap:anywhere;text-align:start}.iptv-src label.btn{cursor:pointer}';
    document.head.append(s);
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

  // ---- Live TV > Sources (the build's iptv.edit_sources): free lists on / off, own M3U lists, guide addresses
  function compactRows(rows) { return rows.slice(0, 3000).map((r) => [r.name, r.url, TN.httpsOnly(r.logo) || '', r.group || '']); }
  async function pageSources(ctx) {
    style();
    const view = TN.view();
    const box = document.createElement('div');
    box.className = 'iptv-src';
    view.append(box);
    const epg = await TN.provider('epg').catch(() => null);
    if (!ctx.current()) return;
    const draw = () => {
      box.innerHTML = '';
      // free lists
      const p1 = document.createElement('div');
      p1.className = 'panel';
      p1.innerHTML = `<h2>${esc(t('iptv_src_free'))}</h2>`;
      const off = offLists(), list1 = document.createElement('div');
      list1.className = 'hlist';
      Object.keys(LISTS).forEach((k) => {
        const row = document.createElement('div');
        row.className = 'hrow';
        row.innerHTML = `<span dir="auto">${esc(t('iptv_l_' + k))}</span>`;
        const b = TN.button('btn ghost', t(off.includes(k) ? 'iptv_src_off' : 'iptv_src_on'), () => {
          const o = offLists();
          TN.put(OFF, o.includes(k) ? o.filter((x) => x !== k) : o.concat([k]));
          draw();
        });
        b.setAttribute('aria-pressed', String(!off.includes(k)));
        row.append(b);
        list1.append(row);
      });
      p1.append(list1);
      // own playlists
      const p2 = document.createElement('div');
      p2.className = 'panel';
      p2.innerHTML = `<h2>${esc(t('iptv_src_own'))}</h2>`;
      const own = ownLists(), list2 = document.createElement('div');
      list2.className = 'hlist';
      own.forEach((o, i) => {
        const row = document.createElement('div');
        row.className = 'hrow';
        const a = document.createElement('a');
        a.href = '#/live/own:' + i; a.dir = 'auto'; a.textContent = o.name + (o.rows ? ' (' + o.rows.length + ')' : '');
        row.append(a, TN.button('btn ghost', t('iptv_src_del'), () => {
          TN.put(OWN, ownLists().filter((x, j) => j !== i));
          Object.keys(cache).filter((k) => k.startsWith('own:')).forEach((k) => delete cache[k]);
          draw();
        }));
        list2.append(row);
      });
      if (!own.length) list2.innerHTML = `<p class="hint">${esc(t('iptv_src_none'))}</p>`;
      const f = document.createElement('form');
      f.innerHTML = `<input type="text" name="n" dir="auto" maxlength="40" placeholder="${esc(t('iptv_src_name'))}" aria-label="${esc(t('iptv_src_name'))}">` +
        `<input type="url" name="u" dir="ltr" placeholder="${esc(t('iptv_src_url'))}" aria-label="${esc(t('iptv_src_url'))}">` +
        `<button class="btn" type="submit">${esc(t('iptv_src_add'))}</button>` +
        `<label class="btn ghost">${esc(t('iptv_src_file'))}<input type="file" name="f" accept=".m3u,.m3u8,audio/x-mpegurl,text/plain" hidden></label>` +
        '<span class="hint" role="status"></span>';
      const say = (x) => { f.lastChild.textContent = x; };
      const save = (name, rows, url) => {
        if (!rows.length) return say(t('iptv_src_empty'));
        const entry = url ? {name, url} : {name, rows: compactRows(rows)};
        let lists = ownLists().concat([entry]).slice(-8);
        try { TN.put(OWN, lists); } catch (e) {}
        if (ownLists().length !== lists.length && entry.rows) {            // too large for this browser's storage: keep fewer
          entry.rows = entry.rows.slice(0, 600);
          lists = lists.slice(0, -1).concat([entry]);
          TN.put(OWN, lists);
        }
        draw();
        const s2 = box.querySelector('form span[role=status]');
        if (s2) s2.textContent = t('iptv_src_ok', rows.length);
      };
      f.onsubmit = async (e) => {
        e.preventDefault();
        const name = f.n.value.trim(), url = f.u.value.trim();
        if (!name || !/^https:\/\/\S+$/i.test(url)) return say(t('iptv_src_bad'));
        say('…');
        try { save(name, parseM3u(await fetchText(url)), url); } catch (er) { say(er.code === 'cors' ? er.message : t('iptv_src_fail', er.message)); }
      };
      f.f.onchange = async () => {
        const file = f.f.files && f.f.files[0];
        if (!file) return;
        try { save(f.n.value.trim() || file.name.replace(/\.[^.]+$/, ''), parseM3u(await file.text()), ''); } catch (er) { say(t('iptv_src_fail', er.message)); }
      };
      p2.append(list2, f);
      // guide addresses
      const p3 = document.createElement('div');
      p3.className = 'panel';
      p3.innerHTML = `<h2>${esc(t('iptv_src_epg'))}</h2>`;
      if (epg) {
        const list3 = document.createElement('div');
        list3.className = 'hlist';
        const states = epg.ownState();
        epg.sources().forEach((u) => {
          const row = document.createElement('div');
          row.className = 'hrow';
          row.innerHTML = `<span dir="ltr">${esc(u)}<br><small class="hint" dir="auto">${esc((states[u] || {}).text || '…')}</small></span>`;
          row.append(TN.button('btn ghost', t('iptv_src_del'), () => { epg.removeSource(u); draw(); }));
          list3.append(row);
        });
        const g = document.createElement('form');
        g.innerHTML = `<input type="url" name="u" dir="ltr" placeholder="${esc(t('iptv_src_epg_url'))}" aria-label="${esc(t('iptv_src_epg_url'))}">` +
          `<button class="btn" type="submit">${esc(t('iptv_src_add'))}</button>` +
          `<label class="btn ghost">${esc(t('iptv_src_epg_file'))}<input type="file" name="f" accept=".xml,.gz,.xmltv,text/xml" hidden></label><span class="hint" role="status"></span>`;
        g.onsubmit = async (e) => {
          e.preventDefault();
          if (!epg.addSource(g.u.value)) { g.lastChild.textContent = t('iptv_src_bad'); return; }
          g.lastChild.textContent = '…';
          await epg.loadOwn(true);
          if (ctx.current()) draw();
        };
        g.f.onchange = async () => {
          const file = g.f.files && g.f.files[0];
          if (!file) return;
          try {
            let text;
            const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
            if (head[0] === 0x1f && head[1] === 0x8b && typeof DecompressionStream === 'function') text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
            else text = await file.text();
            const r = epg.addText(text);
            g.lastChild.textContent = t('epg_own_ok', r.channels, r.programmes);
          } catch (er) { g.lastChild.textContent = t('epg_own_fail', er.message); }
        };
        p3.append(list3, g);
        if (epg.sources().length && !Object.keys(states).length) epg.loadOwn().then(() => { if (ctx.current() && document.body.contains(box)) draw(); });
      }
      // stream check
      const p4 = document.createElement('div');
      p4.className = 'panel';
      p4.innerHTML = `<h2>${esc(t('iptv_src_check'))}</h2><p class="hint">${esc(t('iptv_src_check_txt'))}</p>`;
      p4.append(TN.button('btn ghost', t('iptv_src_clear'), (e) => { TN.put(PROBE_KEY, {}); e.target.textContent = t('iptv_src_cleared'); }));
      box.append(p1, p2, p3, p4);
      box.insertAdjacentHTML('beforeend', `<p class="hint">${esc(t('iptv_src_note'))}${TN.settings.helper && TN.settings.helper() ? '' : ' ' + esc(t('iptv_why_helper'))}</p>`);
    };
    draw();
  }

  const SPECIAL = ['countries', 'favs', 'guide', 'sources'];
  async function render(arg, ctx) {
    const [first = '', second = ''] = String(arg || '').split('/');
    const start = TN.settings.get('live', 'tn');
    const known = (k) => k === 'tn' || !!LISTS[k] || SPECIAL.includes(k) || k.startsWith('c:') || (k.startsWith('own:') && !!ownLists()[parseInt(k.slice(4), 10)]);
    const list = known(first) ? first : (start === 'tn' || LISTS[start] ? start : 'tn');
    const grp = second.startsWith('g:') ? second.slice(2) : '';
    TN.page('live');
    style();
    const names = {}, off = offLists();
    ['tn'].concat(Object.keys(LISTS).filter((k) => !off.includes(k) || k === list)).forEach((k) => { names[k] = t('iptv_l_' + k); });
    ownLists().forEach((o, i) => { names['own:' + i] = o.name; });
    TN.chips([['favs', '★ ' + t('iptv_favs')], ['guide', t('iptv_guide')]].concat(Object.entries(names))
               .concat([['countries', t('iptv_countries')], ['sources', '⚙ ' + t('iptv_sources')]]),
             list.startsWith('c:') ? 'countries' : list, (k) => TN.go('#/live/' + k));
    const view = TN.view();
    if (list === 'sources') return pageSources(ctx);
    if (list === 'countries') {
      const sk = TN.skeleton();
      const rows = await countryList().catch(() => []);
      if (!ctx.current()) return;
      sk.remove();
      const box = document.createElement('div');
      box.className = 'chips';
      rows.forEach((c) => { const a = document.createElement('a'); a.className = 'chip'; a.href = '#/live/c:' + c.code; a.textContent = (c.flag ? c.flag + ' ' : '') + c.name; box.append(a); });
      const h = document.createElement('h2');
      h.textContent = t('iptv_world');
      view.append(h, box);
      if (!rows.length) view.insertAdjacentHTML('beforeend', `<p class="msg">${esc(t('iptv_load_fail'))}</p>`);
      return;
    }
    const sk = TN.skeleton();
    let data, epg;
    try {
      [data, epg] = await Promise.all([list === 'favs' ? favChannels().then((items) => ({items, http: 0})) : load(list === 'guide' ? 'tn' : list),
                                       TN.provider('epg').catch(() => null)]);
    } catch (e) {
      if (!ctx.current()) return;
      sk.remove();
      view.insertAdjacentHTML('beforeend', `<p class="msg">${esc(e && e.code ? e.message : t('iptv_load_fail'))}</p>`);
      view.append(TN.button('btn', t('iptv_retry'), () => TN.route()));
      return;
    }
    if (epg) { await epg.ready(); if (epg.sources().length) epg.loadOwn(); }
    if (!ctx.current()) return;
    sk.remove();
    let items = data.items;
    if (list === 'guide') {
      const favs = await favChannels().catch(() => []);
      if (!ctx.current()) return;
      const all = items.concat(favs.filter((f) => !f.key));
      const h = document.createElement('h2');
      h.textContent = t('iptv_guide');
      view.append(h);
      if (epg) epg.grid(view, all, {onPlay: (c) => open(c, {list: all, index: all.indexOf(c)}), name: shown});
      else view.insertAdjacentHTML('beforeend', `<p class="msg">${esc(t('iptv_load_fail'))}</p>`);
      return;
    }
    if (list === 'tn') items = items.filter((c) => !c.kodi_only).concat(items.filter((c) => c.kodi_only));
    const present = GROUPS.filter((g) => items.some((c) => c.cls === g));
    if (present.length > 1) {
      TN.chips([['', t('iptv_all')]].concat(present.map((g) => [g, t('grp_' + g)])), grp,
               (g) => TN.go('#/live/' + list + (g ? '/g:' + g : '')));
    }
    if (grp) items = items.filter((c) => c.cls === grp);
    const tools = document.createElement('div');
    tools.className = 'links';
    const filter = document.createElement('input');
    filter.type = 'search'; filter.placeholder = t('iptv_filter'); filter.setAttribute('aria-label', t('iptv_filter')); filter.dir = 'auto';
    const status = document.createElement('span');
    status.className = 'hint'; status.setAttribute('role', 'status');
    tools.append(filter);
    tools.append(TN.button('btn ghost', t('iptv_check'), async (e) => {
      e.target.disabled = true;
      const n = await checkAll(items, (d, all) => { status.textContent = t('iptv_checking', d, all); });
      e.target.disabled = false;
      if (ctx.current()) { status.textContent = t('iptv_checked', n); draw(); }
    }));
    tools.append(status);
    view.append(tools);
    const title = list === 'favs' ? t('iptv_favs') : list.startsWith('c:') ? ((countries || []).find((c) => c.code === list.slice(2)) || {}).name || list.slice(2) : names[list] || list;
    const g = TN.section(title + (grp ? ' · ' + t('grp_' + grp) : ''), items.length);
    function draw() {
      const q = filter.value.trim().toLowerCase();
      g.innerHTML = '';
      const hit = items.filter((c) => !q || [c.name, c.name_he].concat(c.names || []).some((n) => n && n.toLowerCase().includes(q)));
      const order = hit.filter((c) => !isDead(c)).concat(hit.filter(isDead));         // dead ones last
      order.forEach((c, i) => g.append(chCard(c, epg, {list: order, index: i})));
      if (!hit.length) g.innerHTML = `<p class="msg">${esc(list === 'favs' && !q ? t('iptv_favs_none') : t('none'))}</p>`;
    }
    filter.addEventListener('input', draw);
    draw();
    if (data.http) view.insertAdjacentHTML('beforeend', `<p class="hint">${esc(t('iptv_http', data.http))}</p>`);
    if (list === 'tn' && items.some((c) => c.kodi_only)) view.insertAdjacentHTML('beforeend', `<p class="hint">${esc(t('iptv_why_idan'))}</p>`);
  }
  TN.registerPage('live', render);

  // a history row of a channel ('ch:il:<key>' / 'ch:<address>') opens the sheet with failover
  if (TN.addHistoryHandler) {
    TN.addHistoryHandler((entry) => {
      const key = String((entry && entry.key) || '');
      if (!key.startsWith('ch:')) return false;
      const id = key.slice(3);
      if (id.startsWith('il:')) { load('tn').then((d) => { const c = d.items.find((x) => x.key === id.slice(3)); if (c) open(c, {list: d.items, index: d.items.indexOf(c)}); }).catch(() => {}); return true; }
      if (!/^https?:\/\//i.test(id)) return false;
      const secure = /^https:/i.test(id);
      open({name: entry.label || id, logo: TN.httpsOnly(entry.thumb) || '', group: '', cls: 'Other', urls: secure ? [id] : [], http: secure ? [] : [id], url: secure ? id : ''});
      return true;
    });
  }

  TN.registerProvider('iptv', {
    kinds: ['search'], label: t('iptv_label'),
    async search(q, opts = {}) {
      const n = String(q || '').trim().toLowerCase();
      if (n.length < 2) return [];
      const ids = ['tn', 'il'].concat(ownLists().map((o, i) => 'own:' + i));
      const lists = await Promise.all(ids.map((l) => load(l).catch(() => ({items: []}))));
      const seen = new Set(), out = [];
      for (const c of lists.flatMap((d) => d.items)) {
        const hit = [c.name, c.name_he].concat(c.names || []).some((x) => x && x.toLowerCase().includes(n));
        const k = normKey(c.name);
        if (!hit || seen.has(k)) continue;
        seen.add(k);
        out.push({title: shown(c), sub: t('live'), img: c.logo || '', kind: 'live', score: c.name.toLowerCase() === n ? 1 : 0.6, open: () => open(c)});
        if (out.length >= (opts.limit || 20)) break;
      }
      return out;
    },
    open, load, favChannels, close: stopPlaying,
    // by the build's channel key ('kan11') - for favourites / history / the home row of another module
    async openKey(key) { const d = await load('tn'); const c = d.items.find((x) => x.key === key); if (c) open(c, {list: d.items, index: d.items.indexOf(c)}); return !!c; },
  });
  // tests
  TN.registerProvider('iptv_lib', {kinds: [], parseM3u, merge, classify, displayName, probe, checkAll, isDead, isRestream, isPaidIl, norm,
                                   tnChannel, addExtras, candidates, ytEmbed, helperHls, makoAsk, makoStream, makoResolve, LISTS});
})(self.TN);
