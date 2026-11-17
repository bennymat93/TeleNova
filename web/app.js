'use strict';
// BN Stream Web: main menu -> Movies, Series, Live TV, Radio, Favorites, BN Stream, Settings.
// Sources: TMDb through the server (api/tmdb, when it is set up) or Internet Archive, the build's own Israeli channel
// table, free iptv-org channels, radio-browser. No unlicensed sources.
// 4.2: the same users, history, favourites and search history as the Kodi build (store.js, in the build's shapes), and,
// when the viewer connects a Telegram account, the build's continuous sync (websync.js + tg.js). Without it everything
// stays in this browser. See README.md.
const L = {
  he: {home: 'תפריט ראשי', back: 'חזרה לתפריט הראשי', movies: 'סרטים', tv: 'סדרות', live: 'טלוויזיה', radio: 'רדיו',
       favs: 'מועדפים', history: 'היסטוריה', users: 'משתמשים', bn: 'BN Stream', settings: 'הגדרות', search: 'חיפוש בכל המקורות...', results: 'תוצאות עבור',
       none: 'לא נמצאו תוצאות', loading: 'טוען...', trailer: 'טריילר', archive: 'צפייה חינם ב-Internet Archive',
       app: 'פתח באפליקציית BN Stream', ch: 'ערוצים', ia: 'Internet Archive', titles: 'סרטים וסדרות', stations: 'תחנות',
       all: 'הכל', fav_add: '♡ הוסף למועדפים', fav_rm: '♥ הסר מהמועדפים', favs_none: 'עדיין אין מועדפים. לחצו ♡ בכל סרט, ערוץ או תחנה.',
       popular: 'הפופולריים', trendM: 'סרטים חמים השבוע', trendT: 'סדרות חמות השבוע', classics: 'סרטים קלאסיים',
       series_classic: 'סדרות קלאסיות', play: 'נגן', stop: 'עצור',
       sub: {movies: 'סרטים קלאסיים מלאים', tv: 'סדרות טלוויזיה', live: 'ערוצים חיים חינמיים', radio: 'תחנות מכל העולם',
             favs: 'מה ששמרתם', history: 'מה שנפתח לאחרונה', users: 'לכל אחד הרשימות שלו', bn: 'האפליקציה המלאה', settings: 'שפה, תצוגה ועוד'},
       lists: {tn: 'ערוצי ישראל · BN Stream', il: 'ישראל', he: 'עברית', ru: 'רוסית', en: 'אנגלית', kids: 'ילדים', docs: 'תעודה', news: 'חדשות', music: 'מוזיקה'},
       countries: {IL: 'ישראל', RU: 'רוסיה', US: 'ארה"ב', GB: 'בריטניה', FR: 'צרפת', DE: 'גרמניה', UA: 'אוקראינה', top: 'הכי מושמעות'},
       genres: {Comedy: 'קומדיה', Drama: 'דרמה', Horror: 'אימה', Western: 'מערבון', 'Science Fiction': 'מדע בדיוני',
                'Film Noir': 'פילם נואר', Animation: 'אנימציה', Silent: 'אילם', '@soviet': 'קולנוע סובייטי'},
       sorts: {popular: 'הנצפים ביותר', top: 'המדורגים ביותר', new: 'נוספו לאחרונה'}, f_sort: 'מיון', f_genre: 'סוגה', f_decade: 'עשור', f_lang: 'שפה', f_style: 'סגנון', f_country: 'מדינה',
       ialangs: {English: 'אנגלית', Russian: 'רוסית', French: 'צרפתית', German: 'גרמנית', Spanish: 'ספרדית', Italian: 'איטלקית'},
       rtags: {news: 'חדשות ודיבור', pop: 'פופ ולהיטים', rock: 'רוק', classical: 'קלאסית', jazz: 'ג׳אז', 'world middle east': 'מזרח תיכון', kids: 'ילדים', jewish: 'יהדות'},
       s_lang: 'שפה', s_theme: 'ערכת צבעים', t_auto: 'לפי המכשיר', t_dark: 'כהה', t_light: 'בהירה',
       s_live: 'רשימת ערוצים בפתיחה', s_radio: 'מדינת רדיו בפתיחה', s_clear: 'מחיקת המועדפים', s_cleared: 'המועדפים נמחקו',
       s_family: 'סינון תוכן למשפחה', s_family_txt: 'פעיל תמיד: תכנים למבוגרים מסוננים מ-Internet Archive.',
       s_store: 'ההגדרות והמועדפים נשמרים בדפדפן הזה בלבד.',
       bn_txt: 'BN Stream היא אפליקציית הטלוויזיה המלאה: סרטים וסדרות עם Real-Debrid, ערוצים ישראליים, כתוביות בעברית ועוד. גרסת הדפדפן כוללת את התכנים החינמיים.',
       bn_kodi: 'התקנה ב-Kodi (מאגר NovaTV)', bn_android: 'אנדרואיד (64 ביט)', bn_android32: 'אנדרואיד (32 ביט)',
       bn_win: 'Windows', bn_guide: 'מדריך למשתמש', bn_kodi_how: 'ב-Kodi: הגדרות ← מנהל קבצים ← הוספת מקור ← https://bennymat93.github.io/TeleNova/ ← הרחבות ← התקנה מקובץ zip',
       foot: 'BN Stream Web 4.2 · מקורות חוקיים בלבד: TMDb, Internet Archive, שידורי הערוצים עצמם, iptv-org, radio-browser'},
  en: {home: 'Main menu', back: 'Back to main menu', movies: 'Movies', tv: 'Series', live: 'Live TV', radio: 'Radio',
       favs: 'Favorites', history: 'History', users: 'Users', bn: 'BN Stream', settings: 'Settings', search: 'Search all sources...', results: 'Results for',
       none: 'Nothing found', loading: 'Loading...', trailer: 'Trailer', archive: 'Watch free on Internet Archive',
       app: 'Open in the BN Stream app', ch: 'Channels', ia: 'Internet Archive', titles: 'Movies & series', stations: 'Stations',
       all: 'All', fav_add: '♡ Add to favorites', fav_rm: '♥ Remove from favorites', favs_none: 'No favorites yet. Press ♡ on any film, channel or station.',
       popular: 'Popular', trendM: 'Trending movies', trendT: 'Trending series', classics: 'Classic films',
       series_classic: 'Classic series', play: 'Play', stop: 'Stop',
       sub: {movies: 'Full classic films', tv: 'TV series', live: 'Free live channels', radio: 'Stations worldwide',
             favs: 'What you saved', history: 'Recently opened', users: 'Everyone has their own lists', bn: 'The full app', settings: 'Language, display and more'},
       lists: {tn: 'Israeli channels · BN Stream', il: 'Israel', he: 'Hebrew', ru: 'Russian', en: 'English', kids: 'Kids', docs: 'Documentary', news: 'News', music: 'Music'},
       countries: {IL: 'Israel', RU: 'Russia', US: 'USA', GB: 'UK', FR: 'France', DE: 'Germany', UA: 'Ukraine', top: 'Most played'},
       genres: {Comedy: 'Comedy', Drama: 'Drama', Horror: 'Horror', Western: 'Western', 'Science Fiction': 'Sci-fi',
                'Film Noir': 'Film noir', Animation: 'Animation', Silent: 'Silent', '@soviet': 'Soviet cinema'},
       sorts: {popular: 'Most watched', top: 'Top rated', new: 'Recently added'}, f_sort: 'Sort', f_genre: 'Genre', f_decade: 'Decade', f_lang: 'Language', f_style: 'Style', f_country: 'Country',
       ialangs: {English: 'English', Russian: 'Russian', French: 'French', German: 'German', Spanish: 'Spanish', Italian: 'Italian'},
       rtags: {news: 'News & talk', pop: 'Pop & hits', rock: 'Rock', classical: 'Classical', jazz: 'Jazz', 'world middle east': 'Middle East', kids: 'Kids', jewish: 'Jewish'},
       s_lang: 'Language', s_theme: 'Theme', t_auto: 'Device', t_dark: 'Dark', t_light: 'Light',
       s_live: 'Channel list on open', s_radio: 'Radio country on open', s_clear: 'Clear favorites', s_cleared: 'Favorites cleared',
       s_family: 'Family filter', s_family_txt: 'Always on: adult uploads are filtered from Internet Archive.',
       s_store: 'Settings and favorites are kept in this browser only.',
       bn_txt: 'BN Stream is the full TV app: movies and series with Real-Debrid, Israeli channels, Hebrew subtitles and more. The browser version has the free content.',
       bn_kodi: 'Install in Kodi (NovaTV repository)', bn_android: 'Android (64-bit)', bn_android32: 'Android (32-bit)',
       bn_win: 'Windows', bn_guide: 'User guide', bn_kodi_how: 'In Kodi: Settings → File manager → Add source → https://bennymat93.github.io/TeleNova/ → Add-ons → Install from zip file',
       foot: 'BN Stream Web 4.2 · legal sources only: TMDb, Internet Archive, official channel streams, iptv-org, radio-browser'},
  ru: {home: 'Главное меню', back: 'Назад в главное меню', movies: 'Фильмы', tv: 'Сериалы', live: 'ТВ', radio: 'Радио',
       favs: 'Избранное', history: 'История', users: 'Пользователи', bn: 'BN Stream', settings: 'Настройки', search: 'Поиск по всем источникам...', results: 'Результаты для',
       none: 'Ничего не найдено', loading: 'Загрузка...', trailer: 'Трейлер', archive: 'Смотреть бесплатно в Internet Archive',
       app: 'Открыть в BN Stream', ch: 'Каналы', ia: 'Internet Archive', titles: 'Фильмы и сериалы', stations: 'Станции',
       all: 'Все', fav_add: '♡ В избранное', fav_rm: '♥ Убрать из избранного', favs_none: 'Пока пусто. Нажмите ♡ у фильма, канала или станции.',
       popular: 'Популярное', trendM: 'Популярные фильмы', trendT: 'Популярные сериалы', classics: 'Классика кино',
       series_classic: 'Классические сериалы', play: 'Играть', stop: 'Стоп',
       sub: {movies: 'Полные классические фильмы', tv: 'Телесериалы', live: 'Бесплатные каналы', radio: 'Станции мира',
             favs: 'Сохранённое', history: 'Недавно открытое', users: 'У каждого свои списки', bn: 'Полное приложение', settings: 'Язык, вид и другое'},
       lists: {tn: 'Каналы Израиля · BN Stream', il: 'Израиль', he: 'Иврит', ru: 'Русский', en: 'Английский', kids: 'Детям', docs: 'Документальные', news: 'Новости', music: 'Музыка'},
       countries: {IL: 'Израиль', RU: 'Россия', US: 'США', GB: 'Великобритания', FR: 'Франция', DE: 'Германия', UA: 'Украина', top: 'Популярные'},
       genres: {Comedy: 'Комедия', Drama: 'Драма', Horror: 'Ужасы', Western: 'Вестерн', 'Science Fiction': 'Фантастика',
                'Film Noir': 'Нуар', Animation: 'Мультфильмы', Silent: 'Немое кино', '@soviet': 'Советское кино'},
       sorts: {popular: 'Самые просматриваемые', top: 'Лучшие по рейтингу', new: 'Недавно добавленные'}, f_sort: 'Сортировка', f_genre: 'Жанр', f_decade: 'Десятилетие', f_lang: 'Язык', f_style: 'Стиль', f_country: 'Страна',
       ialangs: {English: 'Английский', Russian: 'Русский', French: 'Французский', German: 'Немецкий', Spanish: 'Испанский', Italian: 'Итальянский'},
       rtags: {news: 'Новости и разговор', pop: 'Поп и хиты', rock: 'Рок', classical: 'Классика', jazz: 'Джаз', 'world middle east': 'Ближний Восток', kids: 'Детям', jewish: 'Еврейское'},
       s_lang: 'Язык', s_theme: 'Тема', t_auto: 'Как на устройстве', t_dark: 'Тёмная', t_light: 'Светлая',
       s_live: 'Список каналов при открытии', s_radio: 'Страна радио при открытии', s_clear: 'Очистить избранное', s_cleared: 'Избранное очищено',
       s_family: 'Семейный фильтр', s_family_txt: 'Всегда включён: материалы для взрослых из Internet Archive отфильтрованы.',
       s_store: 'Настройки и избранное хранятся только в этом браузере.',
       bn_txt: 'BN Stream — полное ТВ-приложение: фильмы и сериалы с Real-Debrid, израильские каналы, субтитры на иврите и многое другое. В браузере — бесплатный контент.',
       bn_kodi: 'Установка в Kodi (репозиторий NovaTV)', bn_android: 'Android (64 бит)', bn_android32: 'Android (32 бит)',
       bn_win: 'Windows', bn_guide: 'Руководство', bn_kodi_how: 'В Kodi: Настройки → Файловый менеджер → Добавить источник → https://bennymat93.github.io/TeleNova/ → Дополнения → Установить из zip',
       foot: 'BN Stream Web 4.2 · только легальные источники: TMDb, Internet Archive, эфиры самих каналов, iptv-org, radio-browser'},
};
// 3.0: texts added with the all-devices version
const X3 = {
  he: {tmdb: 'מפתח TMDb אישי (רשות)', tmdb_hint: 'עם מפתח חינמי מ-themoviedb.org מתקבל הקטלוג המלא של סרטים וסדרות, בלי שרת. המפתח נשמר רק בדפדפן הזה.', install: 'התקן כאפליקציה במכשיר הזה'},
  en: {tmdb: 'Your TMDb key (optional)', tmdb_hint: 'A free key from themoviedb.org gives the full movie and series catalogue with no server. The key stays in this browser only.', install: 'Install as an app on this device'},
  ru: {tmdb: 'Ваш ключ TMDb (необязательно)', tmdb_hint: 'Бесплатный ключ с themoviedb.org открывает полный каталог без сервера. Ключ хранится только в этом браузере.', install: 'Установить как приложение'},
};
// 4.2: texts added with users, history, the build's channels and the Telegram sync
const X4 = {
  he: {done: 'בוצע', kodi_only: 'מתנגן ב-Kodi בלבד',
       kodi_idan: 'הערוץ הזה משודר דרך Idan+ (תוסף של Kodi לנגני השידור הרשמיים) ולכן אינו זמין בדפדפן. הוא מתנגן באפליקציית BN Stream.',
       kodi_yt: 'הערוץ הזה הוא שידור חי ביוטיוב שהאפליקציה מאתרת בעצמה. הוא מתנגן באפליקציית BN Stream.',
       kodi_pvr: 'זהו ערוץ מרשימת הערוצים של מכשיר Kodi. הוא מתנגן באפליקציית BN Stream באותו מכשיר.',
       kodi_entry: 'הפריט הזה נשמר במכשיר Kodi ואי אפשר לנגן אותו בדפדפן. הוא מתנגן באפליקציית BN Stream.',
       kodi_list_hint: 'ערוצים אפורים משודרים דרך Idan+ או יוטיוב ומתנגנים באפליקציית BN Stream ב-Kodi בלבד.',
       hist_none: 'עדיין אין היסטוריה. מה שתפתחו כאן או ב-BN Stream יופיע כאן.', hist_clear: 'נקה את ההיסטוריה', hist_clear_q: 'למחוק את כל ההיסטוריה? לחצו שוב לאישור',
       sh_clear: 'נקה את היסטוריית החיפושים', sh_remove: 'הסר מההיסטוריה',
       users_about: 'לכל משתמש היסטוריה, מועדפים והיסטוריית חיפושים משלו. עם חיבור לטלגרם הכול מסתנכרן לבד בין כל המכשירים שמחוברים לאותו חשבון.',
       u_main: 'ראשי', u_active: 'פעיל', u_new: 'משתמש חדש', u_name: 'שם המשתמש', u_switch: 'עבור למשתמש הזה', u_rename: 'שנה שם', u_delete: 'מחק משתמש',
       u_delete_q: 'למחוק את המשתמש "%s"? ההיסטוריה, המועדפים והחיפושים שלו יימחקו מכל המכשירים. לחצו שוב לאישור.',
       u_exists: 'כבר יש משתמש בשם הזה', u_now: 'המשתמש הפעיל: %s', u_save: 'שמור', u_cancel: 'ביטול',
       s_user: 'המשתמש הפעיל', s_tmdb_synced: 'כרגע נעשה שימוש במפתח מההגדרות המסונכרנות של החשבון.',
       s_store2: 'בלי חיבור לטלגרם ההגדרות, המשתמשים והרשימות נשמרים בדפדפן הזה בלבד. שפת האתר וערכת הצבעים נשארות תמיד בדפדפן הזה.',
       tg_title: 'סנכרון עם BN Stream (טלגרם)',
       tg_about: 'חיבור לחשבון הטלגרם שלכם מסנכרן משתמשים, היסטוריה, מועדפים וחיפושים עם כל מכשירי BN Stream שמחוברים לאותו חשבון, בלי ללחוץ על דבר. המסמך המשותף נשמר חתום ב"הודעות שמורות" של החשבון; שום דבר לא נשלח לשרת אחר.',
       tg_connect: 'חיבור טלגרם', tg_offline: 'לא זמין ללא חיבור לאינטרנט',
       tg_api_about: 'נדרשים ה-API ID וה-API Hash של החשבון (my.telegram.org ← API development tools), או סריקת קוד החיבור ש-BN Stream מציג ב-Kodi. הם נשמרים בדפדפן הזה בלבד.',
       tg_api_id: 'API ID', tg_api_hash: 'API Hash', tg_continue: 'המשך', tg_api_bad: 'API ID הוא מספר, ו-API Hash הוא 32 תווים (0-9, a-f)',
       tg_paired: 'פרטי ה-API התקבלו מקוד החיבור ונשמרו בדפדפן הזה.',
       tg_keep: 'השאר אותי מחובר בדפדפן הזה',
       tg_keep_warn: 'בסימון, הכניסה לטלגרם נשמרת בדפדפן הזה: כל מי שיש לו גישה לפרופיל הדפדפן הזה יוכל להשתמש בחשבון. "התנתקות" מוחקת אותה. בלי הסימון החיבור נשאר רק עד סגירת הלשונית.',
       tg_qr: 'כניסה עם קוד QR', tg_phone: 'כניסה עם מספר טלפון', tg_forget: 'מחק את פרטי ה-API',
       tg_qr_how: 'בטלפון: טלגרם ← הגדרות ← מכשירים ← קישור מכשיר, וסרקו את הקוד. הקוד מתחלף כל חצי דקה.',
       tg_phone_label: 'מספר טלפון בפורמט בינלאומי (‎+972...)', tg_code_label: 'הקוד שנשלח אליכם בטלגרם', tg_code_sms: 'הקוד שנשלח אליכם ב-SMS',
       tg_pass_label: 'סיסמת האימות הדו-שלבי', tg_pass_hint: 'רמז: %s', tg_send: 'שלח', tg_cancel: 'ביטול', tg_wait: 'מתחבר לטלגרם...',
       tg_on: 'מחובר: %s', tg_sync_now: 'סנכרן עכשיו', tg_disconnect: 'התנתקות', tg_disconnect_q: 'להתנתק ולמחוק את הכניסה מהדפדפן הזה? לחצו שוב לאישור',
       tg_last: 'סנכרון אחרון: %s', tg_syncing: 'מסנכרן...', tg_memory: 'החיבור נשמר עד סגירת הלשונית בלבד.',
       tg_nodoc: 'בחשבון עדיין אין מסמך סנכרון. פתחו פעם אחת את BN Stream ב-Kodi כשהוא מחובר לאותו חשבון - הוא יוצר את המסמך, והדפדפן מצטרף לבד.',
       tg_unreadable: 'לא ניתן לקרוא כרגע את מסמך הסנכרון. ננסה שוב בסבב הבא.', tg_other_tab: 'הסנכרון פועל בלשונית אחרת של הדפדפן הזה.',
       tg_logout_fail: 'לא ניתן היה להגיע לטלגרם. הכניסה נמחקה מהדפדפן הזה; כדאי לסיים אותה גם בטלגרם ← הגדרות ← מכשירים.',
       e_code: 'הקוד שגוי. נסו שוב.', e_code_expired: 'תוקף הקוד פג. התחילו מחדש.', e_pass: 'הסיסמה שגויה. נסו שוב.', e_phone: 'מספר הטלפון אינו תקין',
       e_flood: 'יותר מדי ניסיונות. נסו שוב בעוד %s שניות.', e_api: 'ה-API ID או ה-API Hash שגויים', e_net: 'אין חיבור לטלגרם', e_generic: 'הפעולה נכשלה (%s)',
       e_session: 'הכניסה לטלגרם אינה בתוקף עוד. התחברו מחדש.', e_signup: 'המספר הזה אינו רשום בטלגרם'},
  en: {done: 'Done', kodi_only: 'Plays in Kodi only',
       kodi_idan: 'This channel comes through Idan+ (a Kodi add-on for the broadcasters\' official players), so a browser cannot play it. It plays in the BN Stream app.',
       kodi_yt: 'This channel is a YouTube live broadcast that the app finds by itself. It plays in the BN Stream app.',
       kodi_pvr: 'This is a channel of a Kodi device\'s own channel list. It plays in the BN Stream app on that device.',
       kodi_entry: 'This item was saved on a Kodi device and a browser cannot play it. It plays in the BN Stream app.',
       kodi_list_hint: 'Greyed channels come through Idan+ or YouTube and play in the BN Stream app in Kodi only.',
       hist_none: 'No history yet. What you open here or in BN Stream shows up here.', hist_clear: 'Clear the history', hist_clear_q: 'Delete the whole history? Press again to confirm',
       sh_clear: 'Clear the search history', sh_remove: 'Remove from the history',
       users_about: 'Every user has their own history, favourites and search history. With Telegram connected, everything syncs by itself between all devices logged in to the same account.',
       u_main: 'Main', u_active: 'active', u_new: 'New user', u_name: 'User name', u_switch: 'Switch to this user', u_rename: 'Rename', u_delete: 'Delete user',
       u_delete_q: 'Delete the user "%s"? Their history, favourites and searches are removed from every device. Press again to confirm.',
       u_exists: 'A user with this name exists', u_now: 'Active user: %s', u_save: 'Save', u_cancel: 'Cancel',
       s_user: 'Active user', s_tmdb_synced: 'Right now the key from the account\'s synced settings is in use.',
       s_store2: 'Without a Telegram connection, settings, users and lists are kept in this browser only. The site language and the theme always stay in this browser.',
       tg_title: 'Sync with BN Stream (Telegram)',
       tg_about: 'Connecting your Telegram account syncs users, history, favourites and searches with every BN Stream device logged in to the same account, with nothing to press. The shared document is kept sealed in the account\'s "Saved Messages"; nothing is sent to any other server.',
       tg_connect: 'Connect Telegram', tg_offline: 'Not available offline',
       tg_api_about: 'The account\'s API ID and API Hash are needed (my.telegram.org → API development tools), or scan the pairing code BN Stream shows in Kodi. They are kept in this browser only.',
       tg_api_id: 'API ID', tg_api_hash: 'API Hash', tg_continue: 'Continue', tg_api_bad: 'The API ID is a number and the API Hash is 32 characters (0-9, a-f)',
       tg_paired: 'The API details arrived with the pairing code and are kept in this browser.',
       tg_keep: 'Keep me connected in this browser',
       tg_keep_warn: 'When ticked, the Telegram login is saved in this browser: anyone who can use this browser profile can use the account. "Disconnect" deletes it. Without the tick the connection lasts until the tab is closed.',
       tg_qr: 'Log in with a QR code', tg_phone: 'Log in with a phone number', tg_forget: 'Delete the API details',
       tg_qr_how: 'On your phone: Telegram → Settings → Devices → Link Desktop Device, and scan the code. The code changes every half minute.',
       tg_phone_label: 'Phone number in international format (+972...)', tg_code_label: 'The code Telegram sent you', tg_code_sms: 'The code sent to you by SMS',
       tg_pass_label: 'Two-step verification password', tg_pass_hint: 'Hint: %s', tg_send: 'Send', tg_cancel: 'Cancel', tg_wait: 'Connecting to Telegram...',
       tg_on: 'Connected: %s', tg_sync_now: 'Sync now', tg_disconnect: 'Disconnect', tg_disconnect_q: 'Log out and delete the login from this browser? Press again to confirm',
       tg_last: 'Last sync: %s', tg_syncing: 'Syncing...', tg_memory: 'The connection is kept until the tab is closed only.',
       tg_nodoc: 'The account has no sync document yet. Open BN Stream in Kodi once while it is logged in to the same account - it creates the document, and the browser joins by itself.',
       tg_unreadable: 'The sync document cannot be read right now. The next round tries again.', tg_other_tab: 'The sync is running in another tab of this browser.',
       tg_logout_fail: 'Telegram could not be reached. The login was deleted from this browser; end it in Telegram → Settings → Devices as well.',
       e_code: 'Wrong code. Try again.', e_code_expired: 'The code has expired. Start again.', e_pass: 'Wrong password. Try again.', e_phone: 'The phone number is not valid',
       e_flood: 'Too many attempts. Try again in %s seconds.', e_api: 'The API ID or the API Hash is wrong', e_net: 'No connection to Telegram', e_generic: 'It did not work (%s)',
       e_session: 'The Telegram login is no longer valid. Connect again.', e_signup: 'This number is not registered with Telegram'},
  ru: {done: 'Готово', kodi_only: 'Только в Kodi',
       kodi_idan: 'Этот канал идёт через Idan+ (дополнение Kodi для официальных плееров каналов), поэтому в браузере он недоступен. Он работает в приложении BN Stream.',
       kodi_yt: 'Этот канал - прямой эфир YouTube, который приложение находит само. Он работает в приложении BN Stream.',
       kodi_pvr: 'Это канал из собственного списка каналов устройства Kodi. Он работает в приложении BN Stream на том устройстве.',
       kodi_entry: 'Этот элемент сохранён на устройстве Kodi, браузер не может его воспроизвести. Он работает в приложении BN Stream.',
       kodi_list_hint: 'Серые каналы идут через Idan+ или YouTube и работают только в приложении BN Stream в Kodi.',
       hist_none: 'Истории пока нет. Здесь появится то, что вы откроете здесь или в BN Stream.', hist_clear: 'Очистить историю', hist_clear_q: 'Удалить всю историю? Нажмите ещё раз для подтверждения',
       sh_clear: 'Очистить историю поиска', sh_remove: 'Убрать из истории',
       users_about: 'У каждого пользователя своя история, избранное и история поиска. С подключённым Telegram всё синхронизируется само между устройствами с одним аккаунтом.',
       u_main: 'Основной', u_active: 'активен', u_new: 'Новый пользователь', u_name: 'Имя пользователя', u_switch: 'Переключиться', u_rename: 'Переименовать', u_delete: 'Удалить пользователя',
       u_delete_q: 'Удалить пользователя «%s»? Его история, избранное и поиски будут удалены со всех устройств. Нажмите ещё раз для подтверждения.',
       u_exists: 'Пользователь с таким именем уже есть', u_now: 'Активный пользователь: %s', u_save: 'Сохранить', u_cancel: 'Отмена',
       s_user: 'Активный пользователь', s_tmdb_synced: 'Сейчас используется ключ из синхронизированных настроек аккаунта.',
       s_store2: 'Без подключения Telegram настройки, пользователи и списки хранятся только в этом браузере. Язык сайта и тема всегда остаются в этом браузере.',
       tg_title: 'Синхронизация с BN Stream (Telegram)',
       tg_about: 'Подключение вашего аккаунта Telegram синхронизирует пользователей, историю, избранное и поиски со всеми устройствами BN Stream с тем же аккаунтом - ничего нажимать не нужно. Общий документ хранится запечатанным в «Избранном» аккаунта; ни на какой другой сервер ничего не отправляется.',
       tg_connect: 'Подключить Telegram', tg_offline: 'Недоступно без интернета',
       tg_api_about: 'Нужны API ID и API Hash аккаунта (my.telegram.org → API development tools) или сканирование кода подключения, который BN Stream показывает в Kodi. Они хранятся только в этом браузере.',
       tg_api_id: 'API ID', tg_api_hash: 'API Hash', tg_continue: 'Далее', tg_api_bad: 'API ID - число, API Hash - 32 символа (0-9, a-f)',
       tg_paired: 'Данные API получены из кода подключения и сохранены в этом браузере.',
       tg_keep: 'Оставаться подключённым в этом браузере',
       tg_keep_warn: 'С галочкой вход в Telegram сохраняется в этом браузере: любой, у кого есть доступ к этому профилю браузера, сможет пользоваться аккаунтом. «Отключиться» удаляет его. Без галочки подключение действует до закрытия вкладки.',
       tg_qr: 'Войти по QR-коду', tg_phone: 'Войти по номеру телефона', tg_forget: 'Удалить данные API',
       tg_qr_how: 'На телефоне: Telegram → Настройки → Устройства → Подключить устройство, и отсканируйте код. Код меняется каждые полминуты.',
       tg_phone_label: 'Номер телефона в международном формате (+972...)', tg_code_label: 'Код, который прислал Telegram', tg_code_sms: 'Код, присланный по SMS',
       tg_pass_label: 'Пароль двухэтапной аутентификации', tg_pass_hint: 'Подсказка: %s', tg_send: 'Отправить', tg_cancel: 'Отмена', tg_wait: 'Подключение к Telegram...',
       tg_on: 'Подключено: %s', tg_sync_now: 'Синхронизировать сейчас', tg_disconnect: 'Отключиться', tg_disconnect_q: 'Выйти и удалить вход из этого браузера? Нажмите ещё раз для подтверждения',
       tg_last: 'Последняя синхронизация: %s', tg_syncing: 'Синхронизация...', tg_memory: 'Подключение действует только до закрытия вкладки.',
       tg_nodoc: 'В аккаунте ещё нет документа синхронизации. Откройте один раз BN Stream в Kodi с тем же аккаунтом - он создаст документ, и браузер присоединится сам.',
       tg_unreadable: 'Документ синхронизации сейчас не читается. Следующая попытка - в следующем круге.', tg_other_tab: 'Синхронизация работает в другой вкладке этого браузера.',
       tg_logout_fail: 'Не удалось связаться с Telegram. Вход удалён из этого браузера; завершите его также в Telegram → Настройки → Устройства.',
       e_code: 'Неверный код. Попробуйте ещё раз.', e_code_expired: 'Срок действия кода истёк. Начните заново.', e_pass: 'Неверный пароль. Попробуйте ещё раз.', e_phone: 'Неверный номер телефона',
       e_flood: 'Слишком много попыток. Повторите через %s с.', e_api: 'Неверный API ID или API Hash', e_net: 'Нет связи с Telegram', e_generic: 'Не получилось (%s)',
       e_session: 'Вход в Telegram больше не действует. Подключитесь снова.', e_signup: 'Этот номер не зарегистрирован в Telegram'},
};
const SITE = 'https://bennymat93.github.io/TeleNova/';
const REL = 'https://github.com/bennymat93/novatv/releases/latest/download/';
const TMDB_LANG = {he: 'he-IL', en: 'en-US', ru: 'ru-RU'};
const CONTENT_LANG = {1: 'he-IL', 2: 'en-US', 3: 'ru-RU'};      // the build's "content_lang" setting (0 = follow the interface)
const IMG = 'https://image.tmdb.org/t/p/';
const RADIO = 'https://de1.api.radio-browser.info/json';
const KODI = 'plugin://plugin.video.nova/?';
const MENU = [['movies', '🎬'], ['tv', '📺'], ['live', '📡'], ['radio', '📻'], ['favs', '♥'], ['history', '🕘'], ['users', '👤'], ['bn', '★'], ['settings', '⚙']];
const WEB_VERSION = '4.2.8';

// ---------------------------------------------------------------- per-browser storage (never required)
const mem = new Map();                         // a browser that refuses storage (private mode, blocked cookies): this visit only
const safeStore = {
  getItem(k) { try { return localStorage.getItem(k); } catch (e) { return mem.has(k) ? mem.get(k) : null; } },
  setItem(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem.set(k, String(v)); } },
  removeItem(k) { try { localStorage.removeItem(k); } catch (e) {} mem.delete(k); },
};
function get(k, d) { try { const v = safeStore.getItem('bn_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function put(k, v) { try { safeStore.setItem('bn_' + k, JSON.stringify(v)); } catch (e) {} }
function drop(k) { safeStore.removeItem('bn_' + k); }
const cfg = Object.assign({lang: (navigator.language || 'he').slice(0, 2), theme: 'auto', live: 'tn', radio: 'IL'}, get('cfg', {}));
try { const old = localStorage.getItem('bn_lang'); if (old && !get('cfg', null)) cfg.lang = old; } catch (e) {}
if (!L[cfg.lang]) cfg.lang = 'he';
const t = (k) => L[cfg.lang][k];
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const view = $('#view');
const X = (k) => { const a = X4[cfg.lang] || X4.en, b = X3[cfg.lang] || X3.en; return k in a ? a[k] : b[k]; };
const fmt = (k, v) => String(X(k)).replace('%s', v);
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
let hls = null, hasTmdb = true;

// 4.2: the build's document model. Users and each user's lists live in store.js (in the build's shapes), merged by
// syncdoc.js; `synced` is what the account's document lets a browser read (the TMDb key, the metadata language).
const SD = window.SyncDoc, WS = window.WebSync.make(SD), store = window.Store.make(safeStore, SD);
store.migrate();                               // the 3.x favourites of this browser become the first user's
let synced = get('synced', {}) || {};
// a picture address that came from a list (maybe from another device): https or this site only, safe inside url("")
function cssUrl(u) {
  try {
    const x = new URL(String(u || ''), document.baseURI);
    if (x.protocol !== 'https:' && x.origin !== location.origin) return '';
    return 'url("' + x.href.replace(/["'\\()\s]/g, (c) => encodeURIComponent(c)) + '")';
  } catch (e) { return ''; }
}
const paint = (el, u) => { el.style.backgroundImage = cssUrl(u) || cssUrl('icon.png'); };
const httpsOnly = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');

// ---------------------------------------------------------------- sources
const tmdbLang = () => CONTENT_LANG[synced.content_lang] || TMDB_LANG[cfg.lang];
async function tmdb(path, params = {}) {
  // the viewer's own TMDb key, else the household's from the synced settings: the full catalogue with no server
  const key = String(cfg.tmdb || synced.tmdb_key || synced.tmdb_token || '').trim();
  if (key) {
    const qs = new URLSearchParams({language: tmdbLang(), ...params});
    const bearer = key.length > 40;
    if (!bearer) qs.set('api_key', key);
    const r = await fetch('https://api.themoviedb.org/3' + path + '?' + qs, bearer ? {headers: {Authorization: 'Bearer ' + key}} : {});
    if (!r.ok) throw new Error('TMDb ' + r.status);
    return r.json();
  }
  if (!hasTmdb) throw new Error('no tmdb');
  const qs = new URLSearchParams({path, language: tmdbLang(), ...params});
  const r = await fetch('api/tmdb?' + qs).catch(() => ({status: 404}));
  if (r.status === 503 || r.status === 404) { hasTmdb = false; throw new Error('no tmdb'); }
  if (!r.ok) throw new Error('TMDb ' + r.status);
  return r.json();
}
// same family filter as the Kodi add-on (resources/lib/ia.py)
const ADULT = '(naturis* OR nudis* OR nude OR nudity OR erot* OR porn* OR sex OR sexy OR xxx OR adult OR softcore OR hentai OR эрот* OR порн* OR секс* OR нудис* OR עירום OR ארוט*)';
// same list as the add-on's '@soviet' (exact subject phrases: loose words pulled in war documentaries)
const SOVIET = '(' + ['Soviet film', 'Soviet films', 'Soviet cinema', 'Soviet movie', 'Soviet animation', 'советский фильм', 'советское кино']
  .map((s) => `subject:("${s}")`).concat(['мосфильм', 'ленфильм', 'Mosfilm', 'Lenfilm', 'союзмультфильм', 'Soyuzmultfilm'].map((s) => `subject:(${s})`)).join(' OR ') + ')';
const SORTS = {popular: 'downloads desc', top: 'avg_rating desc', new: 'addeddate desc'};
async function archive({q = '', collection = 'feature_films', subject = '', rows = 40, sort = 'popular', decade = '', language = ''} = {}) {
  q = q.replace(/[:()[\]{}"^~*?\\/!+-]/g, ' ').trim();
  const what = subject === '@soviet' ? SOVIET : q ? `title:(${q})` : `collection:${collection}` + (subject ? ` AND subject:("${subject}")` : '');
  const extra = (decade ? ` AND year:[${decade} TO ${+decade + 9}]` : '') + (language ? ` AND language:(${language})` : '') +
                (sort === 'top' ? ' AND num_reviews:[3 TO 100000]' : '');      // "top rated" needs a few reviews to mean anything
  const qs = new URLSearchParams({q: `${what}${extra} AND mediatype:movies AND NOT subject:${ADULT} AND NOT title:${ADULT}`, rows, output: 'json'});
  qs.append('sort[]', SORTS[sort] || SORTS.popular);
  ['identifier', 'title', 'year'].forEach((f) => qs.append('fl[]', f));
  const r = await fetch('https://archive.org/advancedsearch.php?' + qs);
  return r.ok ? (await r.json()).response.docs : [];
}
// 'tn' is the build's own Israeli table (channels_il.json, made from livefail.py by src/qa/web/gen_channels.py)
const LISTS = {tn: '', il: 'countries/il', he: 'languages/heb', ru: 'languages/rus', en: 'languages/eng',
               kids: 'categories/kids', docs: 'categories/documentary', news: 'categories/news', music: 'categories/music'};
function parseM3u(text) {
  const out = [], seen = new Set();
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF')) {
      const attr = (k) => (line.match(new RegExp(k + '="([^"]*)"')) || [])[1] || '';
      const name = line.slice(line.lastIndexOf('",') > 0 ? line.lastIndexOf('",') + 2 : line.lastIndexOf(',') + 1).trim();
      cur = {name, logo: attr('tvg-logo'), group: attr('group-title').split(';')[0].replace(/^Undefined$/, '')};
    } else if (cur && line && !line.startsWith('#')) {
      if (line.startsWith('https://') && !seen.has(line)) { seen.add(line); out.push({...cur, url: line}); }
      cur = null;
    }
  }
  return out;
}
const chCache = {};
async function channels(list) {
  if (chCache[list]) return chCache[list];
  if (list === 'tn') {
    const r = await fetch('channels_il.json');
    const rows = r.ok ? await r.json() : [];
    // direct https streams play here; Idan+ and YouTube-live channels are listed too, marked "plays in Kodi"
    return (chCache.tn = rows.map((c) => ({key: c.key, name: c.name, name_he: c.name_he || '', names: c.names || [], logo: '', group: 'BN Stream',
                                            urls: (c.urls || []).filter(httpsOnly), url: (c.urls || []).filter(httpsOnly)[0] || '', kodi_only: !!c.kodi_only, why: c.why || ''})));
  }
  try {
    const r = await fetch('api/channels?list=' + list);
    if (r.ok) return (chCache[list] = (await r.json()).items);
  } catch (e) {}
  const r = await fetch(`https://iptv-org.github.io/iptv/${LISTS[list]}.m3u`);
  return (chCache[list] = r.ok ? parseM3u(await r.text()) : []);
}
async function stations(cc, q, tag) {
  const path = tag ? `/stations/bytagexact/${encodeURIComponent(tag)}?` + new URLSearchParams({limit: 120, hidebroken: true, order: 'clickcount', reverse: true})
    : q ? '/stations/search?' + new URLSearchParams({name: q, limit: 60, hidebroken: true, order: 'clickcount', reverse: true})
    : cc === 'top' ? '/stations/topclick/80?hidebroken=true'
      : `/stations/bycountrycodeexact/${cc}?` + new URLSearchParams({limit: 120, hidebroken: true, order: 'clickcount', reverse: true});
  const r = await fetch(RADIO + path);
  // browsers block http audio on an https page: https streams only
  return r.ok ? (await r.json()).filter((s) => (s.url_resolved || '').startsWith('https://')) : [];
}

// ---------------------------------------------------------------- favourites and history (the active user's, in the build's shapes)
// item: {kind, id, label, extra, img}. kinds: movie / series (TMDb id), radio (station id, extra = stream) as the build
// writes them; web_ia (Internet Archive id) and web_channel ('il:<key>' or a stream address, extra = logo) are the
// browser's own - the build keeps and syncs them without showing them.
function favButton(item) {
  const b = document.createElement('button');
  b.className = 'btn ghost';
  const label = () => { b.textContent = store.isFav(item.kind, item.id) ? t('fav_rm') : t('fav_add'); };
  label();
  b.onclick = () => {
    if (store.isFav(item.kind, item.id)) store.removeFav(item.kind, item.id);
    else { store.addFav(item.kind, item.id, item.label, item.extra || ''); if (item.img) store.setArt(item.kind, item.id, item.img); }
    label();
  };
  return b;
}
const noteHistory = (e) => store.addHistory(e);

// ---------------------------------------------------------------- building blocks
const tidy = (n) => String(n || '').replace(/\s*\((\d{3,4}p|\d+i)\)|\s*\[[^\]]*\]/gi, '').trim();     // "Kan 11 (1080p) [Not 24/7]" -> "Kan 11"
const chName = (c) => (c.key ? ((cfg.lang === 'he' && c.name_he) || c.name) : tidy(c.name));
function card(img, title, sub, onClick, kind, badge) {
  const b = document.createElement('button');
  b.className = 'card' + (kind ? ' ' + kind : '');
  b.innerHTML = (badge ? `<span class="badge">${esc(badge)}</span>` : '') + '<div class="img"></div>' +
                `<div class="t" dir="auto">${esc(title)}</div>` + (sub != null ? `<div class="s" dir="auto">${esc(sub)}</div>` : '');
  paint(b.querySelector('.img'), img);
  b.onclick = onClick;
  return b;
}
function section(title, count) {
  const h = document.createElement('h2');
  h.innerHTML = esc(title) + (count != null ? ` <small>${esc(count)}</small>` : '');
  const g = document.createElement('div');
  g.className = 'grid';
  view.append(h, g);
  return g;
}
// every screen except the main menu: a back button to the menu and the screen's title
function page(key, title) {
  view.innerHTML = `<div class="pagehead"><a class="backbtn" href="#/">${cfg.lang === 'he' ? '→' : '←'} ${esc(t('back'))}</a>` +
                   `<h1>${esc(title || t(key))}</h1></div>`;
}
function chips(items, on, go) {
  const box = document.createElement('div');
  box.className = 'chips';
  items.forEach(([k, name]) => {
    const b = document.createElement('button');
    b.className = 'chip' + (k === on ? ' on' : '');
    b.textContent = name;
    b.onclick = () => go(k);
    box.append(b);
  });
  view.append(box);
  return box;
}
function skeleton(n = 12) {
  const g = document.createElement('div');
  g.className = 'grid skelgrid';
  g.innerHTML = '<div class="card skel"><div class="img"></div><div class="t"></div><div class="s"></div></div>'.repeat(n);
  view.append(g);
  return g;
}
const empty = (where, text) => { where.outerHTML = `<p class="msg">${esc(text || t('none'))}</p>`; };
const button = (cls, text, onClick) => { const b = document.createElement('button'); b.className = cls; b.textContent = text; b.onclick = onClick; return b; };
const tmdbCard = (r) => {
  const type = r.media_type || (r.title ? 'movie' : 'tv');
  return card(r.poster_path ? IMG + 'w342' + r.poster_path : 'icon.png', r.title || r.name,
              (r.release_date || r.first_air_date || '').slice(0, 4), () => openTitle(type, r.id));
};
const iaImg = (id) => `https://archive.org/services/img/${encodeURIComponent(id)}`;
const iaCard = (d) => card(iaImg(d.identifier), d.title, d.year || '', () => openArchive(d));
const chCard = (c) => card(c.logo || 'icon.png', chName(c), c.kodi_only ? X('kodi_only') : c.group, () => openChannel(c),
                           'wide' + (c.kodi_only ? ' dim' : ''), c.kodi_only ? 'KODI' : 'LIVE');
const radioCard = (s) => card(s.favicon || 'icon.png', s.name.trim(), [s.country, s.tags && s.tags.split(',')[0]].filter(Boolean).join(' · '),
                               () => playRadio(s), 'square');
// a title that came from another device has no picture here: it is fetched once and remembered in this browser
function lazyPoster(el, media, id) {
  tmdb(`/${media}/${id}`).then((d) => {
    if (!d.poster_path) return;
    store.setArt(media === 'movie' ? 'movie' : 'series', id, IMG + 'w342' + d.poster_path);
    paint(el, IMG + 'w342' + d.poster_path);
  }).catch(() => {});
}

// ---------------------------------------------------------------- players
function modal(html) {
  $('#sheet').innerHTML = html;
  $('#modal').hidden = false;
  $('.close').focus();
}
function closeModal() {
  if (hls) { hls.destroy(); hls = null; }
  $('#sheet').innerHTML = '';
  $('#modal').hidden = true;
}
$('.close').onclick = closeModal;
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

async function openTitle(type, id) {
  modal(`<p class="msg">${esc(t('loading'))}</p>`);
  try {
    const [d, v] = await Promise.all([tmdb(`/${type}/${id}`), tmdb(`/${type}/${id}/videos`, {include_video_language: `${cfg.lang},en,null`})]);
    const tr = (v.results || []).find((x) => x.site === 'YouTube' && x.type === 'Trailer') || (v.results || []).find((x) => x.site === 'YouTube');
    const title = d.title || d.name;
    const genres = (d.genres || []).map((g) => g.name).join(' · ');
    const poster = d.poster_path ? IMG + 'w342' + d.poster_path : '';
    modal(`${tr ? `<div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(tr.key)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="${esc(t('trailer'))}"></iframe></div>` : ''}
      <div class="detail"><img src="${esc(poster || 'icon.png')}" alt="">
      <div><h3>${esc(title)}</h3><div class="meta">${esc([(d.release_date || d.first_air_date || '').slice(0, 4), genres, d.vote_average ? '★ ' + d.vote_average.toFixed(1) : ''].filter(Boolean).join(' · '))}</div>
      <p>${esc(d.overview)}</p><div class="actions" id="acts">
      <button class="btn ghost" id="iaBtn">${esc(t('archive'))}</button>
      <a class="btn" href="${SITE}">${esc(t('app'))}</a></div><div id="iaRes"></div></div></div>`);
    const kind = type === 'movie' ? 'movie' : 'series';
    if (poster) store.setArt(kind, id, poster);
    $('#acts').prepend(favButton({kind, id, label: title, extra: '', img: poster}));
    // history as the build writes it: the same key for a film (one entry on every device), and for a film the build's
    // own play address, so the entry made here starts the film when it is chosen in Kodi
    noteHistory({key: type === 'movie' ? 'movie:' + id : 'tv:' + id, label: title, thumb: poster, plot: d.overview || '',
                 fanart: d.backdrop_path ? IMG + 'w1280' + d.backdrop_path : '',
                 play: type === 'movie' ? KODI + new URLSearchParams({a: 'play', m: 'movie', id: String(id), q: title}) : ''});
    $('#iaBtn').onclick = async () => {
      const docs = await archive({q: d.original_title || d.original_name || title, rows: 12});
      const box = $('#iaRes');
      box.innerHTML = docs.length ? '<div class="grid" style="margin-top:16px"></div>' : `<p class="msg">${esc(t('none'))}</p>`;
      docs.forEach((x) => box.firstChild.append(iaCard(x)));
    };
  } catch (e) { modal(`<p class="msg">${esc(t('none'))}</p>`); }
}
function openArchive(d) {
  const title = d.title || d.identifier;
  modal(`<div class="player"><iframe src="https://archive.org/embed/${encodeURIComponent(d.identifier)}" allowfullscreen title="${esc(title)}"></iframe></div>
    <div class="detail" style="grid-template-columns:1fr"><div><h3 dir="auto">${esc(title)}</h3><div class="meta">${esc(d.year || '')} · Internet Archive</div>
    <div class="actions" id="acts"></div></div></div>`);
  $('#acts').append(favButton({kind: 'web_ia', id: d.identifier, label: title, extra: '', img: iaImg(d.identifier)}));
  noteHistory({key: 'ia:' + d.identifier, label: title, thumb: iaImg(d.identifier)});
}
// something only the Kodi build can play (an Idan+ channel, a PVR favourite, a file found through an add-on)
function kodiOnly(title, text, fav) {
  modal(`<div class="detail" style="grid-template-columns:1fr"><div><h3 dir="auto">${esc(title)}</h3><div class="meta">${esc(X('kodi_only'))}</div>
    <p>${esc(text)}</p><div class="actions" id="acts"><a class="btn" href="#/bn">${esc(t('bn'))}</a></div></div></div>`);
  if (fav) $('#acts').prepend(favButton(fav));
}
function openChannel(c) {
  const name = chName(c), favId = c.key ? 'il:' + c.key : c.url;
  const fav = {kind: 'web_channel', id: favId, label: name, extra: c.logo || '', img: c.logo || ''};
  if (c.kodi_only || !httpsOnly(c.url)) return kodiOnly(name, X(c.why === 'youtube' ? 'kodi_yt' : 'kodi_idan'), store.isFav('web_channel', favId) ? fav : null);
  modal(`<div class="player"><video id="vid" controls autoplay playsinline></video></div>
    <div class="detail" style="grid-template-columns:1fr"><div><h3 dir="auto">${esc(name)}</h3><div class="meta">${esc(c.group || '')}</div>
    <div class="actions" id="acts"></div></div></div>`);
  $('#acts').append(favButton(fav));
  stopRadio();
  noteHistory({key: 'ch:' + favId, label: name, play: c.url, thumb: httpsOnly(c.logo)});
  // the build's table may name several streams of a channel: the next one is tried when one fails
  const urls = c.urls && c.urls.length ? c.urls : [c.url], v = $('#vid');
  let at = 0;
  const next = () => { if (at + 1 < urls.length && $('#vid') === v) { at++; start(); } };
  function start() {
    if (v.canPlayType('application/vnd.apple.mpegurl')) v.src = urls[at];           // Safari / iOS: native HLS
    else if (window.Hls && Hls.isSupported()) {
      if (hls) hls.destroy();
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (ev, data) => { if (data && data.fatal) next(); });
      hls.loadSource(urls[at]);
      hls.attachMedia(v);
    } else v.src = urls[at];
  }
  v.onerror = next;
  start();
}
// radio plays in the bar at the bottom, so you can keep browsing
const audio = new Audio();
function playRadio(s) {
  const name = String(s.name || '').trim();
  audio.src = s.url_resolved;
  audio.play().catch(() => {});
  const bar = $('#radiobar');
  bar.hidden = false;
  bar.innerHTML = `<img src="${esc(httpsOnly(s.favicon) || 'icon.png')}" alt=""><div class="rb-t" dir="auto"><b>${esc(name)}</b><span>${esc(s.country || '')}</span></div>` +
                  `<span id="rbfav"></span><button class="btn" id="rbstop">■ ${esc(t('stop'))}</button>`;
  $('#rbfav').append(favButton({kind: 'radio', id: s.stationuuid, label: name, extra: s.url_resolved, img: httpsOnly(s.favicon)}));
  $('#rbstop').onclick = stopRadio;
  noteHistory({key: 'radio:' + s.stationuuid, label: name, play: s.url_resolved, thumb: httpsOnly(s.favicon)});
}
function stopRadio() { audio.pause(); audio.removeAttribute('src'); $('#radiobar').hidden = true; }

// ---------------------------------------------------------------- screens
function pageHome() {
  view.innerHTML = '<div class="menu"></div>';
  MENU.forEach(([k, ic]) => {
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = '#/' + k;
    a.innerHTML = `<span class="ic">${ic}</span><b>${esc(t(k))}</b><small>${esc(t('sub')[k])}</small>`;
    view.firstChild.append(a);
  });
}
// inner menu: sort, then genre / decade / language - every choice is kept in the address (#/movies/sort=top&d=1950)
function filterRow(label, items, cur, onPick) {
  const row = chips(items, cur, onPick);
  row.insertAdjacentHTML('afterbegin', `<span class="chiplabel">${esc(label)}</span>`);
}
async function browse(key, arg, collection, tmdbPath) {
  page(key);
  try {
    const d = await tmdb(tmdbPath, {sort_by: 'popularity.desc', 'vote_count.gte': 100});
    const g = section(t('popular'));
    d.results.forEach((r) => g.append(tmdbCard({...r, media_type: key === 'movies' ? 'movie' : 'tv'})));
    return;
  } catch (e) {}
  const f = Object.fromEntries(new URLSearchParams(arg));
  f.sort = SORTS[f.sort] ? f.sort : 'popular';
  const go = (k, v) => {
    const n = {...f, [k]: v};
    if (!v) delete n[k];
    location.hash = `#/${key}/` + new URLSearchParams(n);
  };
  filterRow(t('f_sort'), Object.entries(t('sorts')), f.sort, (v) => go('sort', v));
  if (key === 'movies') filterRow(t('f_genre'), [['', t('all')], ...Object.entries(t('genres'))], f.g || '', (v) => go('g', v));
  // series: television starts in the 1940s, and the archive's classic TV is English / Russian / French / German (audit 29/10)
  const decades = (key === 'movies' ? [1910, 1920, 1930] : []).concat([1940, 1950, 1960, 1970, 1980, 1990, 2000]).map((y) => [String(y), y + 's']);
  filterRow(t('f_decade'), [['', t('all')], ...decades], f.d || '', (v) => go('d', v));
  const langs = Object.entries(t('ialangs')).filter(([k]) => key === 'movies' || ['English', 'Russian', 'French', 'German'].includes(k));
  filterRow(t('f_lang'), [['', t('all')], ...langs], f.l || '', (v) => go('l', v));
  const sk = skeleton();
  const docs = await archive({collection, subject: f.g || '', rows: 60, sort: f.sort, decade: f.d || '', language: f.l || ''}).catch(() => []);
  sk.remove();
  const title = [t('sorts')[f.sort], f.g && t('genres')[f.g], f.d && f.d + 's', f.l && t('ialangs')[f.l]].filter(Boolean).join(' · ');
  const g = section(title, docs.length);
  docs.forEach((x) => g.append(iaCard(x)));
  if (!docs.length) empty(g);
}
const pageMovies = (arg) => browse('movies', arg, 'feature_films', '/discover/movie');
const pageSeries = (arg) => browse('tv', arg, 'classic_tv', '/discover/tv');
async function pageLive(list) {
  list = list in LISTS ? list : (cfg.live in LISTS ? cfg.live : 'tn');
  page('live');
  chips(Object.entries(t('lists')), list, (k) => { location.hash = '#/live/' + k; });
  const sk = skeleton();
  let items = await channels(list).catch(() => []);
  sk.remove();
  if (list === 'tn') items = items.filter((c) => !c.kodi_only).concat(items.filter((c) => c.kodi_only));   // what plays here first
  const g = section(t('lists')[list], items.length);
  items.forEach((c) => g.append(chCard(c)));
  if (!items.length) empty(g);
  else if (list === 'tn') view.insertAdjacentHTML('beforeend', `<p class="hint">${esc(X('kodi_list_hint'))}</p>`);
}
async function pageRadio(cc) {
  const tag = cc.startsWith('tag:') ? cc.slice(4) : '';
  if (!tag) cc = t('countries')[cc] ? cc : cfg.radio;
  page('radio');
  filterRow(t('f_country'), Object.entries(t('countries')), tag ? '' : cc,
            (k) => { location.hash = '#/radio/' + k; });
  filterRow(t('f_style'), Object.entries(t('rtags')), tag, (k) => { location.hash = '#/radio/tag:' + encodeURIComponent(k); });
  const sk = skeleton();
  const list = await (tag ? stations('', '', tag) : stations(cc)).catch(() => []);
  sk.remove();
  const g = section(tag ? t('rtags')[tag] : t('countries')[cc], list.length);
  list.forEach((s) => g.append(radioCard(s)));
  if (!list.length) empty(g);
}
const ilChannel = async (key) => (await channels('tn').catch(() => [])).find((c) => c.key === key);
// one favourite (maybe added on a Kodi device) -> how the browser shows and opens it; null = a kind the browser does not know
function favView(f) {
  const id = String(f.id), label = String(f.label || id), extra = typeof f.extra === 'string' ? f.extra : '';
  const fav = {kind: f.kind, id, label, extra};
  switch (f.kind) {
    case 'movie': return {group: 'movies', img: store.art('movie', id), lazy: /^\d+$/.test(id) ? 'movie' : '', open: () => openTitle('movie', id)};
    case 'series': return {group: 'tv', img: store.art('series', id), lazy: /^\d+$/.test(id) ? 'tv' : '', open: () => openTitle('tv', id)};
    case 'web_ia': return {group: 'movies', img: iaImg(id), open: () => openArchive({identifier: id, title: label})};
    case 'web_channel':
      if (id.startsWith('il:')) return {group: 'live', shape: 'wide', img: '', open: async () => { const c = await ilChannel(id.slice(3)); if (c) openChannel(c); else kodiOnly(label, X('kodi_entry'), fav); }};
      return {group: 'live', shape: 'wide', img: extra, open: () => openChannel({name: label, url: id, logo: extra, group: ''})};
    case 'channel':                                // a channel of Kodi's own TV list: its number means something on that device only
      return {group: 'live', shape: 'wide', img: '', dim: true, open: () => kodiOnly(label, X('kodi_pvr'), fav)};
    case 'radio':
      if (httpsOnly(extra)) return {group: 'radio', shape: 'square', img: store.art('radio', id), open: () => playRadio({stationuuid: id, name: label, url_resolved: extra, favicon: store.art('radio', id)})};
      return {group: 'radio', shape: 'square', img: '', dim: true, open: () => kodiOnly(label, X('kodi_entry'), fav)};
    default: return null;
  }
}
function pageFavs() {
  page('favs');
  const all = store.favs().filter((f) => f && typeof f === 'object' && !Array.isArray(f) && f.id != null).map((f) => [f, favView(f)]).filter((x) => x[1]);
  if (!all.length) { view.insertAdjacentHTML('beforeend', `<p class="msg">${esc(t('favs_none'))}</p>`); return; }
  for (const kind of ['movies', 'tv', 'live', 'radio']) {
    const mine = all.filter((x) => x[1].group === kind);
    if (!mine.length) continue;
    const g = section(t(kind), mine.length);
    mine.forEach(([f, v]) => {
      const c = card(v.img || 'icon.png', String(f.label || f.id), v.dim ? X('kodi_only') : '', v.open, (v.shape || '') + (v.dim ? ' dim' : ''), v.dim ? 'KODI' : '');
      if (!v.img && v.lazy) lazyPoster(c.querySelector('.img'), v.lazy, String(f.id));
      g.append(c);
    });
  }
}
// Kodi keeps pictures as image://<encoded address>/
function picOf(h) {
  let p = typeof h.thumb === 'string' ? h.thumb : '';
  if (p.startsWith('image://')) { try { p = decodeURIComponent(p.slice(8).replace(/\/$/, '')); } catch (e) { p = ''; } }
  return httpsOnly(p);
}
// one history entry (maybe written by a Kodi device) -> what the browser can do with it
function histTarget(h) {
  const key = String(h.key || ''), play = typeof h.play === 'string' ? h.play : '';
  let m;
  if ((m = /^movie:(\d+)$/.exec(key))) return {type: 'title', media: 'movie', id: m[1]};
  if ((m = /^tv:(\d+)(?::|$)/.exec(key))) return {type: 'title', media: 'tv', id: m[1]};
  if (key.startsWith('ia:') && key.length > 3) return {type: 'ia', id: key.slice(3)};
  if (key.startsWith('radio:') && httpsOnly(play)) return {type: 'radio', id: key.slice(6)};
  if (key.startsWith('ch:il:')) return {type: 'il', id: key.slice(6)};
  if (key.startsWith('ch:') && httpsOnly(play)) return {type: 'stream'};
  if (play.startsWith('plugin://')) {              // a Kodi address cannot play here; when it names a TMDb title, its page opens instead
    const q = new URLSearchParams(play.split('?')[1] || ''), id = q.get('id') || q.get('tmdb_id') || '';
    if (/^\d+$/.test(id) && /plugin\.video\.(nova|pov)\//.test(play)) return {type: 'title', media: (q.get('m') || q.get('mediatype') || 'movie') === 'movie' ? 'movie' : 'tv', id};
    return {type: 'kodi'};
  }
  if (httpsOnly(play) && /\.m3u8(\?|$)/i.test(play)) return {type: 'stream'};
  return {type: 'kodi'};
}
function openHistory(h, tg) {
  const label = String(h.label || h.key), pic = picOf(h);
  if (tg.type === 'title') return openTitle(tg.media, tg.id);
  if (tg.type === 'ia') return openArchive({identifier: tg.id, title: label});
  if (tg.type === 'radio') return playRadio({stationuuid: tg.id, name: label, url_resolved: h.play, favicon: pic});
  if (tg.type === 'il') return ilChannel(tg.id).then((c) => (c ? openChannel(c) : kodiOnly(label, X('kodi_entry'))));
  if (tg.type === 'stream') return openChannel({name: label, url: h.play, logo: pic, group: ''});
  return kodiOnly(label, X('kodi_entry'));
}
function pageHistory() {
  page('history');
  const all = store.history().filter((h) => h && typeof h === 'object' && !Array.isArray(h) && h.key);
  if (!all.length) { view.insertAdjacentHTML('beforeend', `<p class="msg">${esc(X('hist_none'))}</p>`); return; }
  const box = document.createElement('div');
  box.className = 'hlist';
  all.forEach((h) => {
    const tg = histTarget(h), pic = picOf(h) || (tg.type === 'ia' ? iaImg(tg.id) : tg.type === 'title' ? store.art(tg.media === 'movie' ? 'movie' : 'series', tg.id) : '');
    const b = document.createElement('button');
    b.className = 'hrow' + (tg.type === 'kodi' ? ' dim' : '');
    b.innerHTML = `<span class="himg"></span><span class="htxt"><b dir="auto">${esc(h.label || h.key)}</b>` +
                  `<span>${esc(typeof h.when === 'string' ? h.when : '')}${tg.type === 'kodi' ? ' · ' + esc(X('kodi_only')) : ''}</span></span>`;
    paint(b.firstChild, pic);
    if (!pic && tg.type === 'title') lazyPoster(b.firstChild, tg.media, tg.id);
    b.onclick = () => openHistory(h, tg);
    box.append(b);
  });
  view.append(box);
  const row = document.createElement('div');
  row.className = 'links';
  row.append(button('btn ghost', X('hist_clear'), (e) => {
    if (e.target.dataset.sure) { store.clearHistory(); pageHistory(); } else { e.target.dataset.sure = '1'; e.target.textContent = X('hist_clear_q'); }
  }));
  view.append(row);
}
// users: the build's model (users.py) - everyone has their own history, favourites and searches
const userName = (u) => String(u.name || '') || X('u_main');
function pageUsers(note) {
  page('users');
  view.insertAdjacentHTML('beforeend', `<p class="hint">${esc(X('users_about'))}</p><div class="panel ulist" id="ulist"></div><p class="hint" id="unote">${esc(note || '')}</p>`);
  const box = $('#ulist'), cur = store.current(), live = store.live();
  const say = (text) => { $('#unote').textContent = text; };
  const form = (value, onSave) => {             // a name box in place of the row's buttons
    const f = document.createElement('form');
    f.className = 'uform';
    f.innerHTML = `<input type="text" maxlength="30" autocomplete="off" dir="auto" aria-label="${esc(X('u_name'))}" placeholder="${esc(X('u_name'))}">`;
    f.firstChild.value = value;
    f.append(button('btn', X('u_save'), null), button('btn ghost', X('u_cancel'), (e) => { e.preventDefault(); pageUsers(); }));
    f.onsubmit = (e) => {
      e.preventDefault();
      try { onSave(f.firstChild.value); } catch (err) { say(err.message === 'name exists' ? X('u_exists') : X('u_name')); }
    };
    return f;
  };
  live.forEach((u) => {
    const row = document.createElement('div');
    row.className = 'urow';
    row.innerHTML = `<b dir="auto">👤 ${esc(userName(u))}</b>` + (u.id === cur ? `<span class="tag">${esc(X('u_active'))}</span>` : '') + '<span class="uacts"></span>';
    const acts = row.lastChild;
    if (u.id !== cur) acts.append(button('btn', X('u_switch'), () => { store.switchTo(u.id); pageUsers(fmt('u_now', userName(u))); }));
    acts.append(button('btn ghost', X('u_rename'), () => { acts.replaceWith(form(String(u.name || ''), (name) => { store.rename(u.id, name); pageUsers(); })); row.querySelector('input').focus(); }));
    if (u.id !== cur && live.length > 1) {
      acts.append(button('btn ghost', X('u_delete'), (e) => {
        if (e.target.dataset.sure) { store.remove(u.id); pageUsers(); } else { e.target.dataset.sure = '1'; say(fmt('u_delete_q', userName(u))); e.target.textContent = X('u_delete') + '?'; }
      }));
    }
    box.append(row);
  });
  const add = document.createElement('div');
  add.className = 'urow';
  add.append(button('btn ghost', '+ ' + X('u_new'), () => {
    add.replaceChildren(form('', (name) => { const uid = store.create(name); store.switchTo(uid); pageUsers(fmt('u_now', store.cleanName(name))); }));   // (as the build: a new user becomes the active one)
    add.querySelector('input').focus();
  }));
  box.append(add);
}
function pageBn() {
  page('bn');
  view.insertAdjacentHTML('beforeend', `<div class="panel bnpanel"><img src="icon.png" alt=""><p>${esc(t('bn_txt'))}</p></div>
    <div class="links">
      <a class="btn" href="${SITE}repository.telenova-4.2.8.zip">${esc(t('bn_kodi'))}</a>
      <a class="btn ghost" href="https://github.com/bennymat93/novatv/releases/latest">${esc(t('bn_win'))}</a>
      <a class="btn ghost" href="${SITE}guide.html">${esc(t('bn_guide'))}</a>
    </div><p class="hint" dir="auto">${esc(t('bn_kodi_how'))}</p>`);
}

// ---------------------------------------------------------------- Telegram (tg.js is loaded only when the viewer connects, or was connected)
function loadScript(src, integrity) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src;
    if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
    s.onload = () => ok();
    s.onerror = () => { s.remove(); fail(new Error('offline')); };
    document.head.append(s);
  });
}
let tgLoading = null, paired = false;
function loadTg() {
  if (!tgLoading) {
    tgLoading = loadScript('tg.js').then(() => {
      window.TG.init({SD, WS, store, get, put, drop, X, fmt, esc, button, loadScript, version: WEB_VERSION, onSynced,
                      onSettings: (v) => { synced = v || {}; hasTmdb = true; }});
      return window.TG;
    });
    tgLoading.catch(() => { tgLoading = null; });
  }
  return tgLoading;
}
// the pairing link the build shows as a QR code: <site>/web/#pair=<api id>.<api hash>. A fragment never leaves the
// browser; it is taken out of the address bar and the history at once and kept in this browser only.
function takePair() {
  const m = /^#pair=(\d{3,12})\.([0-9a-f]{32})$/i.exec(location.hash);
  if (!m) return false;
  put('tg_api', {id: m[1], hash: m[2].toLowerCase()});
  paired = true;
  try { history.replaceState(null, '', location.pathname + location.search + '#/settings'); } catch (e) { location.hash = '#/settings'; }
  return true;
}
function drawTgBox() {
  const ui = $('#tgui');
  if (!ui) return;
  if (window.TG && window.TG.ready) { window.TG.panel(ui, paired); paired = false; return; }
  const open = () => {
    ui.innerHTML = `<p class="hint">${esc(t('loading'))}</p>`;
    loadTg().then((TG) => { if ($('#tgui')) { TG.panel($('#tgui'), paired); paired = false; } },
                  () => { if ($('#tgui')) $('#tgui').innerHTML = `<p class="hint">${esc(X('tg_offline'))}</p>`; });
  };
  if (paired || get('tg_session', '')) return open();
  ui.replaceChildren(button('btn', X('tg_connect'), open));
}
// the sync brought something: the pages that show the active user's lists are drawn again - not under the viewer's
// hands (an open sheet, a name being typed), and the place on the page is kept
let refreshTimer = null;
function refreshView() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const p = location.hash.split('/')[1] || '';
    if (!['favs', 'history', 'users'].includes(p)) return;
    const a = document.activeElement;
    if (!$('#modal').hidden || (a && a.tagName === 'INPUT' && view.contains(a))) return refreshView();
    const y = window.scrollY;
    route(true);
    window.scrollTo(0, y);
  }, 400);
}
function onSynced(res) { if (res.users || res.data.includes(store.current())) refreshView(); }
window.addEventListener('storage', (e) => {     // another tab of this browser changed the lists (or synced them)
  if (e.key === 'bn_synced') synced = get('synced', {}) || {};
  if (e.key && /^bn_(data_|users$|user$)/.test(e.key)) refreshView();
});

function pageSettings() {
  page('settings');
  const opt = (pairs, cur) => pairs.map(([v, n]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const me = store.live().find((u) => u.id === store.current());
  const fromAccount = !cfg.tmdb && (synced.tmdb_key || synced.tmdb_token);
  view.insertAdjacentHTML('beforeend', `<div class="panel settings">
    <label>${esc(t('s_lang'))}<select id="s_lang">${opt([['he', 'עברית'], ['en', 'English'], ['ru', 'Русский']], cfg.lang)}</select></label>
    <label>${esc(t('s_theme'))}<select id="s_theme">${opt([['auto', t('t_auto')], ['dark', t('t_dark')], ['light', t('t_light')]], cfg.theme)}</select></label>
    <label>${esc(t('s_live'))}<select id="s_live">${opt(Object.entries(t('lists')), cfg.live)}</select></label>
    <label>${esc(t('s_radio'))}<select id="s_radio">${opt(Object.entries(t('countries')), cfg.radio)}</select></label>
    <div class="row"><b>${esc(X('s_user'))}</b><span dir="auto">${esc(me ? userName(me) : '')}</span><a class="btn ghost" href="#/users">${esc(t('users'))}</a></div>
    <label>${esc(X('tmdb'))}<input id="s_tmdb" type="password" autocomplete="off" dir="ltr" value="${esc(cfg.tmdb || '')}"></label>
    <p class="hint">${esc(X('tmdb_hint'))}${fromAccount ? ' ' + esc(X('s_tmdb_synced')) : ''}</p>
    <div class="row"><button class="btn ghost" id="s_install" hidden>${esc(X('install'))}</button></div>
    <div class="row"><b>${esc(t('s_family'))}</b><span>${esc(t('s_family_txt'))}</span></div>
    <div class="row"><div class="links"><button class="btn ghost" id="s_clear">${esc(t('s_clear'))}</button>
      <button class="btn ghost" id="s_clearh">${esc(X('hist_clear'))}</button><button class="btn ghost" id="s_clears">${esc(X('sh_clear'))}</button></div><span id="s_done"></span></div>
    <p class="hint">${esc(X('s_store2'))}</p></div>
    <div class="panel settings tgpanel"><b>${esc(X('tg_title'))}</b><p class="hint">${esc(X('tg_about'))}</p><div id="tgui"></div></div>
    <p class="hint">BN Stream Web ${WEB_VERSION}</p>`);
  for (const k of ['lang', 'theme', 'live', 'radio']) {
    $('#s_' + k).onchange = (e) => { cfg[k] = e.target.value; put('cfg', cfg); applyCfg(); if (k === 'lang') { shell(); pageSettings(); } };
  }
  $('#s_tmdb').onchange = (e) => { cfg.tmdb = e.target.value.trim(); hasTmdb = true; put('cfg', cfg); };
  if (installEvt) { $('#s_install').hidden = false; $('#s_install').onclick = () => { installEvt.prompt(); installEvt = null; $('#s_install').hidden = true; }; }
  const done = (text) => { $('#s_done').textContent = text; };
  $('#s_clear').onclick = () => { store.clearFavs(); done(t('s_cleared')); };
  $('#s_clearh').onclick = () => { store.clearHistory(); done(X('done')); };
  $('#s_clears').onclick = () => { store.clearSearches(); done(X('done')); };
  drawTgBox();
}
async function pageSearch(q) {
  $('#q').value = q;
  page('', `${t('results')} “${q}”`);
  const ql = q.toLowerCase();
  // every source in parallel; each section appears as soon as its source answers
  const jobs = [
    tmdb('/search/multi', {query: q}).then((d) => {
      const r = (d.results || []).filter((x) => x.media_type === 'movie' || x.media_type === 'tv');
      if (r.length) { const g = section(t('titles'), r.length); r.forEach((x) => g.append(tmdbCard(x))); }
      return r.length;
    }).catch(() => 0),
    archive({q}).then((docs) => {
      if (docs.length) { const g = section(t('ia'), docs.length); docs.forEach((d) => g.append(iaCard(d))); }
      return docs.length;
    }).catch(() => 0),
    Promise.all(['tn', 'il', 'he', 'ru', 'en'].map((l) => channels(l).catch(() => []))).then((all) => {
      const seen = new Set();
      const names = (c) => (c.names && c.names.length ? c.names : [c.name]).join('\n').toLowerCase();
      const hit = all.flat().filter((c) => names(c).includes(ql) && !seen.has(c.url || c.key) && seen.add(c.url || c.key)).slice(0, 40);
      if (hit.length) { const g = section(t('ch'), hit.length); hit.forEach((c) => g.append(chCard(c))); }
      return hit.length;
    }),
    stations('', q).then((list) => {
      if (list.length) { const g = section(t('radio'), list.length); list.forEach((s) => g.append(radioCard(s))); }
      return list.length;
    }).catch(() => 0),
  ];
  const n = (await Promise.all(jobs)).reduce((a, b) => a + b, 0);
  if (!n) view.insertAdjacentHTML('beforeend', `<p class="msg">${esc(t('none'))}</p>`);
}

// ---------------------------------------------------------------- search box: history and suggestions (the build's searchhist.py)
// nothing typed = the latest searches; while typing = earlier searches that contain the text, then catalogue titles
// (TMDb, the best known first). Choosing one searches for it. Only what is searched is remembered, never what is typed.
const sug = $('#sug');
let sugTimer = null, sugSeq = 0;
function hideSug() { sugSeq++; clearTimeout(sugTimer); sug.hidden = true; sug.replaceChildren(); }
function doSearch(q) {
  q = store.clean(q);
  if (!q) return;
  store.addSearch(q);
  hideSug();
  $('#q').blur();
  location.hash = '#/search/' + encodeURIComponent(q);
}
function drawSug(rows, typed) {
  sug.replaceChildren();
  rows.forEach(([q, src]) => {
    const row = document.createElement('div');
    row.className = 'sugrow';
    const b = button('sugitem', (src === 'history' ? '↺ ' : '🔍 ') + q, () => doSearch(q));
    b.type = 'button'; b.dir = 'auto';
    row.append(b);
    if (src === 'history') {
      const x = button('sugx', '×', () => { store.removeSearch(q); $('#q').focus(); refreshSug(); });
      x.type = 'button'; x.setAttribute('aria-label', X('sh_remove') + ': ' + q);
      row.append(x);
    }
    sug.append(row);
  });
  if (!typed && rows.length) {
    const c = button('sugitem sugclear', X('sh_clear'), () => { store.clearSearches(); hideSug(); });
    c.type = 'button';
    sug.append(c);
  }
  sug.hidden = !rows.length;
}
function refreshSug() {
  const text = $('#q').value, typed = store.clean(text), mine = store.match(store.searches(), text);
  drawSug(store.mergeSuggest(mine, [], text), typed);
  clearTimeout(sugTimer);
  const seq = ++sugSeq;
  if (Array.from(typed).length < 2) return;
  sugTimer = setTimeout(() => {
    tmdb('/search/multi', {query: typed, include_adult: 'false'}).then((d) => {
      if (seq !== sugSeq || document.activeElement !== $('#q')) return;        // the viewer typed on, or moved into the list
      drawSug(store.mergeSuggest(mine, store.titlesOf(d.results, text), text), typed);
    }).catch(() => {});
  }, 250);
}
$('#q').addEventListener('focus', refreshSug);
$('#q').addEventListener('input', refreshSug);
$('#search').addEventListener('focusout', (e) => { if (!$('#search').contains(e.relatedTarget)) setTimeout(() => { if (!$('#search').contains(document.activeElement)) hideSug(); }, 200); });
$('#search').addEventListener('keydown', (e) => { if (e.key === 'Escape') hideSug(); });

// ---------------------------------------------------------------- shell
function applyCfg() {
  if (cfg.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', cfg.theme);
}
function shell() {
  document.documentElement.lang = cfg.lang;
  document.documentElement.dir = cfg.lang === 'he' ? 'rtl' : 'ltr';
  $('#q').placeholder = t('search');
  $('#foot').textContent = t('foot');
  $('#nav').innerHTML = `<a href="#/" data-p="">${esc(t('home'))}</a>` + MENU.map(([k]) => `<a href="#/${k}" data-p="${k}">${esc(t(k))}</a>`).join('');
}
function markNav(p) { document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.p === p)); }
function route(keep) {
  if (takePair()) return route();
  if (keep !== true) closeModal();
  const [, p = '', ...rest] = location.hash.split('/');
  let a = rest.join('/');
  try { a = decodeURIComponent(a); } catch (e) {}
  markNav(p);
  if (p !== 'search') $('#q').value = '';
  ({movies: () => pageMovies(a), tv: () => pageSeries(a), live: () => pageLive(a), radio: () => pageRadio(a), favs: pageFavs,
    history: pageHistory, users: () => pageUsers(), bn: pageBn, settings: pageSettings, search: () => pageSearch(a)}[p] || pageHome)();
  if (keep !== true) window.scrollTo(0, 0);
}
$('#search').onsubmit = (e) => {
  e.preventDefault();
  doSearch($('#q').value);
};
window.addEventListener('hashchange', () => route());
applyCfg(); shell(); route();
// a browser that was connected: the sync starts again by itself, after the page is on the screen
if (get('tg_session', '') && get('tg_api', null)) setTimeout(() => loadTg().then((TG) => TG.resume(), () => {}), 1500);


// ---------------------------------------------------------------- 3.0: every device
// TV remotes and keyboards: the arrows move the focus to the nearest item in that direction, Enter opens it,
// Back / Escape closes the open sheet or goes one page back. Touch and mouse are untouched.
(function () {
  const ua = navigator.userAgent;
  const isTv = /\b(TV|Tizen|Web0S|WebOS|AFT[A-Z]|BRAVIA|GoogleTV|Android TV|CrKey|HbbTV|NetCast|Viera|AppleTV)\b/i.test(ua);
  if (isTv) document.documentElement.classList.add('tv');
  const SEL = 'a[href],button:not([disabled]),input,select,[tabindex]:not([tabindex="-1"])';
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('[hidden]'); };
  const scope = () => ($('#modal').hidden ? document : $('#modal'));
  function move(dir) {
    const cur = document.activeElement;
    const all = [...scope().querySelectorAll(SEL)].filter(visible);
    if (!all.length) return false;
    if (!cur || cur === document.body || !all.includes(cur)) { all[0].focus(); return true; }
    const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of all) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect(), dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
      const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
      const across = Math.abs(dir === 'left' || dir === 'right' ? dy : dx);
      if (along < 8) continue;
      const score = along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best) return false;
    best.focus({preventScroll: true});
    best.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'smooth'});
    return true;
  }
  const DIR = {ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down'};
  document.addEventListener('keydown', (e) => {
    const el = document.activeElement, tag = el && el.tagName;
    const typing = tag === 'INPUT' && el.type !== 'checkbox';
    if (DIR[e.key]) {
      if (tag === 'SELECT' || tag === 'VIDEO' || tag === 'AUDIO') return;
      if (typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && el.value) return;   // caret inside the text
      if (move(DIR[e.key])) e.preventDefault();
      return;
    }
    // remote "Back": Tizen 10009, webOS 461, Android TV browsers send BrowserBack / GoBack
    const back = e.key === 'BrowserBack' || e.key === 'GoBack' || e.keyCode === 10009 || e.keyCode === 461 ||
                 (e.key === 'Backspace' && !typing);
    if (back) {
      e.preventDefault();
      if (!$('#modal').hidden) closeModal();
      else if (location.hash && location.hash !== '#/') history.back();
    }
  });
  // a page drawn after a remote / keyboard action starts with the focus on its first item
  let keyboard = false;
  document.addEventListener('keydown', () => { keyboard = true; }, true);
  document.addEventListener('pointerdown', () => { keyboard = false; }, true);
  window.addEventListener('hashchange', () => { if (keyboard || isTv) setTimeout(() => {
    const first = view.querySelector('.tile,.card,.hrow,.chip,a[href],button'); if (first) first.focus({preventScroll: true}); }, 350); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
