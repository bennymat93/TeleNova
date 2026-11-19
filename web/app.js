'use strict';
// BN Stream Web 5.0 - the shell: layout per device (phone tab bar, tablet / desktop rail, TV rail), Home with hero and
// rows, the title page, sheets, toasts, the focus / remote engine, settings, and the module registry (MODULES.md).
// Plain logic lives in shell_core.js (tested in node). Sources: TMDb with the viewer's or the account's key, Internet
// Archive, the build's own Israeli channel table, free iptv-org channels, radio-browser. No unlicensed sources.
// The same users, history, favourites and search history as the Kodi build (store.js, in the build's shapes), and,
// when the viewer connects a Telegram account, the build's continuous sync (websync.js + tg.js). See README.md.
// Syntax: ES2019 at most in this file (old TV browsers); version.js shows a plain panel when even that fails.
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
       bn_txt: 'BN Stream ב-Kodi היא האפליקציה המלאה לטלוויזיה: נגן שמנגן כל קובץ (MKV, HEVC, AC3), ערוצי Idan+ ורשימות הערוצים של המכשיר, והכול בשלט אחד. גרסת הדפדפן חולקת איתה משתמשים, היסטוריה, מועדפים והמשך צפייה.',
       bn_kodi: 'התקנה ב-Kodi (מאגר NovaTV)', bn_android: 'אנדרואיד (64 ביט)', bn_android32: 'אנדרואיד (32 ביט)',
       bn_win: 'Windows', bn_guide: 'מדריך למשתמש', bn_kodi_how: 'ב-Kodi: הגדרות ← מנהל קבצים ← הוספת מקור ← https://bennymat93.github.io/TeleNova/ ← הרחבות ← התקנה מקובץ zip'},
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
       bn_txt: 'BN Stream in Kodi is the full TV app: a player for every file (MKV, HEVC, AC3), the Idan+ channels and the channel lists of the device, all with one remote. The browser version shares its users, history, favourites and resume points.',
       bn_kodi: 'Install in Kodi (NovaTV repository)', bn_android: 'Android (64-bit)', bn_android32: 'Android (32-bit)',
       bn_win: 'Windows', bn_guide: 'User guide', bn_kodi_how: 'In Kodi: Settings → File manager → Add source → https://bennymat93.github.io/TeleNova/ → Add-ons → Install from zip file'},
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
       bn_txt: 'BN Stream в Kodi - полное ТВ-приложение: плеер для любых файлов (MKV, HEVC, AC3), каналы Idan+ и списки каналов устройства, всё одним пультом. Браузерная версия делит с ним пользователей, историю, избранное и точки продолжения.',
       bn_kodi: 'Установка в Kodi (репозиторий NovaTV)', bn_android: 'Android (64 бит)', bn_android32: 'Android (32 бит)',
       bn_win: 'Windows', bn_guide: 'Руководство', bn_kodi_how: 'В Kodi: Настройки → Файловый менеджер → Добавить источник → https://bennymat93.github.io/TeleNova/ → Дополнения → Установить из zip'},
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
const SC = self.ShellCore;                           // shell_core.js: the shell's plain logic (tested in node, t_shell.js)
const SITE = 'https://bennymat93.github.io/TeleNova/';
const TMDB_LANG = {he: 'he-IL', en: 'en-US', ru: 'ru-RU'};
const CONTENT_LANG = {1: 'he-IL', 2: 'en-US', 3: 'ru-RU'};      // the build's "content_lang" setting (0 = follow the interface)
const IMG = 'https://image.tmdb.org/t/p/';
const RADIO = 'https://de1.api.radio-browser.info/json';
// 5.0: the main menu is SC.MENU = [page key, icon id, group] in the Kodi root order (plus YouTube and Topics, which are
// home-screen items in Kodi). Labels are I18N 'm_<key>' / 'ms_<key>'. Kodi settings and System update have no browser
// meaning: 'about' (version, update app, clear cache) replaces them.
const MENU = SC.MENU;
const IS_TV = SC.isTvUA(navigator.userAgent);
const WEB_VERSION = self.WEB_VERSION || '0';           // version.js (the one place it is written)
const HTML = document.documentElement;
// engines of 2019-2020 (old TV sets): the two newer calls the shell and the modules use
if (!Element.prototype.replaceChildren) {
  Element.prototype.replaceChildren = function () { while (this.lastChild) this.removeChild(this.lastChild); this.append.apply(this, arguments); };
}
if (!Object.fromEntries) Object.fromEntries = (it) => { const o = {}; for (const [k, v] of it) o[k] = v; return o; };

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
// the 5.x texts (i18n.js); falls back to the tables above, so TN.t() reads every text of the app
const I18N = self.I18N;
I18N.setLang(cfg.lang);
I18N.setFallback((k) => { const a = X4[cfg.lang] || X4.en, b = X3[cfg.lang] || X3.en, c = L[cfg.lang]; return k in a ? a[k] : k in b ? b[k] : (typeof c[k] === 'string' ? c[k] : null); });
const N = (k, ...a) => I18N.t(k, ...a);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const view = $('#view');
const X = (k) => { const a = X4[cfg.lang] || X4.en, b = X3[cfg.lang] || X3.en; return k in a ? a[k] : b[k]; };
const fmt = (k, v) => String(X(k)).replace('%s', v);
// one icon of the sprite in index.html (24 px grid, stroke = currentColor); always decorative: the label is text beside it
const icon = (id, cls) => '<svg class="ico' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false"><use href="#i-' + id + '" xlink:href="#i-' + id + '"></use></svg>';
// mixed-direction lines (a year, "S02E05", a rating inside Hebrew text): every part is isolated
const bdis = (parts, sep) => parts.filter(Boolean).map((p) => '<bdi>' + esc(p) + '</bdi>').join(sep == null ? ' · ' : sep);
const noGlyph = (s) => String(s).replace(/^[♡♥■↺🔍]\s*/, '');
let liveTimer = null;
function announce(text) {                      // the screen reader's line (a page title, a result count)
  const el = $('#live');
  if (!el) return;
  el.textContent = '';
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { el.textContent = String(text || ''); }, 60);
}
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion:reduce)').matches; } catch (e) { return false; } };
let shellName = HTML.getAttribute('data-shell') || 'desktop';
const isTvShell = () => shellName === 'tv';

// ---------------------------------------------------------------- the last input method (<html data-input>)
// 'key' (keyboard / remote), 'pointer' (mouse), 'touch'. Hover styles apply with a pointer only; a page drawn after a
// key press starts with the focus on its first item. Typing in a field is not "keyboard navigation".
const DIR = {ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down'};
let inputMode = 'pointer', sawPointer = false;
function setInput(m) { if (inputMode !== m) { inputMode = m; HTML.setAttribute('data-input', m); } }
// remote "Back": Tizen 10009, webOS 461, Android TV browsers send BrowserBack / GoBack
const isBackKey = (e) => e.key === 'BrowserBack' || e.key === 'GoBack' || e.keyCode === 10009 || e.keyCode === 461;
document.addEventListener('keydown', (e) => { if (DIR[e.key] || e.key === 'Tab' || isBackKey(e)) setInput('key'); }, true);
document.addEventListener('pointerdown', (e) => { sawPointer = true; setInput(e.pointerType === 'touch' ? 'touch' : 'pointer'); }, true);
document.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' && inputMode === 'key' && Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0) > 3) { sawPointer = true; setInput('pointer'); }
}, true);

let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; emit('install', null); });
window.addEventListener('appinstalled', () => { installEvt = null; put('install_seen', 1); emit('install', null); });
let hls = null;

// 4.2: the build's document model. Users and each user's lists live in store.js (in the build's shapes), merged by
// syncdoc.js; `synced` is what the account's document lets a browser read (the TMDb key, the metadata language).
const SD = window.SyncDoc, WS = window.WebSync.make(SD), store = window.Store.make(safeStore, SD);
store.migrate();                               // the 3.x favourites of this browser become the first user's
// resume points (player.js / sources.js keep them in 'player_resume') travel inside the active user's history entries
// as Kodi's 'progress' field (syncdoc with_progress / progress_points), so "continue watching" crosses devices.
// The device profile, providers_off and tg_pins stay in this browser: Kodi has no such synced fields.
{
  const rawData = store.data, rawPut = store.putData, RES = 'player_resume';
  store.data = (uid) => {
    const d = rawData(uid);
    if (uid === store.current()) d.history = SD.with_progress(d.history, get(RES, {}) || {});
    return d;
  };
  store.putData = (uid, d, silent) => {
    if (d && uid === store.current()) {
      const mine = get(RES, {}) || {}, from = SD.progress_points(d.history);
      let n = 0;
      for (const k of Object.keys(from)) {
        const cur = mine[k], p = from[k];
        if (cur && Number(cur.at) >= p.at) continue;
        if (p.d && p.t >= p.d * 0.95) { if (cur) { delete mine[k]; n++; } continue; }
        mine[k] = p;
        n++;
      }
      if (n) put(RES, mine);
    }
    return rawPut(uid, d, silent);
  };
}
let synced = get('synced', {}) || {};
// a picture address that came from a list (maybe from another device): https or this site only, safe inside url("")
function cssUrl(u) {
  try {
    const x = new URL(String(u || ''), document.baseURI);
    if (x.protocol !== 'https:' && x.origin !== location.origin) return '';
    return 'url("' + x.href.replace(/["'\\()\s]/g, (c) => encodeURIComponent(c)) + '")';
  } catch (e) { return ''; }
}
const httpsOnly = SC.httpsOnly;
// Pictures are lazy: paint() only remembers the address; one shared observer loads it when the element comes near the
// screen, after a probe confirmed that it loads. A dead logo or favicon leaves the placeholder (class noimg), never
// an empty box. No address (or the app icon) = the placeholder at once.
const picOk = new Set();
function loadPic(el) {
  const u = el._pic, css = u && cssUrl(u);
  if (!u) return;
  if (!css) { el.classList.add('noimg'); return; }
  if (picOk.has(u)) { el.style.backgroundImage = css; return; }
  const im = new Image();
  im.onload = () => { picOk.add(u); if (el._pic === u) { el.classList.remove('noimg'); el.style.backgroundImage = css; } };
  im.onerror = () => { if (el._pic === u) { el.style.backgroundImage = ''; el.classList.add('noimg'); } };
  try { im.src = new URL(u, document.baseURI).href; } catch (e) { el.classList.add('noimg'); }
}
const picIO = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) { picIO.unobserve(en.target); loadPic(en.target); }
}, {rootMargin: '400px'}) : null;
function paint(el, u) {
  if (!el) return;
  if (picIO) picIO.unobserve(el);
  u = String(u || '');
  el.style.backgroundImage = '';
  if (!u || u === 'icon.png') { el._pic = ''; el.classList.add('noimg'); return; }
  el.classList.remove('noimg');
  el._pic = u;
  if (picIO) picIO.observe(el); else loadPic(el);
}
const posterSize = () => SC.posterSize(shellName, window.devicePixelRatio || 1);
const tmdbImg = (p, size) => (p ? IMG + (size === 'auto' ? posterSize() : size || 'w342') + p : '');

// ---------------------------------------------------------------- sources
const tmdbLang = () => CONTENT_LANG[synced.content_lang] || TMDB_LANG[cfg.lang];
const tmdbKey = () => String(cfg.tmdb || synced.tmdb_key || synced.tmdb_token || '').trim();
// TMDb with the viewer's own key, else the household's from the synced settings: the full catalogue with no server.
// No key = an error with code 'need-key' (the pages show "add a TMDb key", not "nothing found").
async function tmdb(path, params) {
  const key = tmdbKey();
  if (!key) { const e = new Error('no tmdb'); e.code = 'need-key'; throw e; }
  const qs = new URLSearchParams(Object.assign({language: tmdbLang()}, params || {}));
  const bearer = key.length > 40;
  if (!bearer) qs.set('api_key', key);
  const r = await fetch('https://api.themoviedb.org/3' + path + '?' + qs, bearer ? {headers: {Authorization: 'Bearer ' + key}} : {});
  if (!r.ok) { const e = new Error('TMDb ' + r.status); e.status = r.status; if (r.status === 401) e.code = 'need-key'; throw e; }
  return r.json();
}
// what a failed request is, for TN.state: no connection, no key, or a plain error
const errKind = (e) => (navigator.onLine === false ? 'offline' : e && e.code === 'need-key' ? 'need-key' : 'error');
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
  if (!r.ok) throw new Error('archive ' + r.status);
  return (await r.json()).response.docs;
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
      if (line.startsWith('https://') && !seen.has(line)) { seen.add(line); out.push(Object.assign({}, cur, {url: line})); }
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
    if (!r.ok) throw new Error('channels ' + r.status);
    const rows = await r.json();
    // direct https streams play here; Idan+ and YouTube-live channels are listed too, marked "plays in Kodi"
    return (chCache.tn = rows.map((c) => ({key: c.key, name: c.name, name_he: c.name_he || '', names: c.names || [], logo: httpsOnly(c.logo) || (/^media\/[\w.\/-]+$/.test(c.logo || '') ? c.logo : ''), group: 'BN Stream',
                                            urls: (c.urls || []).filter(httpsOnly), url: (c.urls || []).filter(httpsOnly)[0] || '', kodi_only: !!c.kodi_only, why: c.why || ''})));
  }
  if (!LISTS[list]) return [];
  const r = await fetch(`https://iptv-org.github.io/iptv/${LISTS[list]}.m3u`);
  if (!r.ok) throw new Error('channels ' + r.status);
  return (chCache[list] = parseM3u(await r.text()));
}
async function stations(cc, q, tag) {
  const path = tag ? `/stations/bytagexact/${encodeURIComponent(tag)}?` + new URLSearchParams({limit: 120, hidebroken: true, order: 'clickcount', reverse: true})
    : q ? '/stations/search?' + new URLSearchParams({name: q, limit: 60, hidebroken: true, order: 'clickcount', reverse: true})
    : cc === 'top' ? '/stations/topclick/80?hidebroken=true'
      : `/stations/bycountrycodeexact/${cc}?` + new URLSearchParams({limit: 120, hidebroken: true, order: 'clickcount', reverse: true});
  const r = await fetch(RADIO + path);
  if (!r.ok) throw new Error('radio ' + r.status);
  // browsers block http audio on an https page: https streams only
  return (await r.json()).filter((s) => (s.url_resolved || '').startsWith('https://'));
}

// ---------------------------------------------------------------- favourites and history (the active user's, in the build's shapes)
// item: {kind, id, label, extra, img}. kinds: movie / series (TMDb id), radio (station id, extra = stream) as the build
// writes them; web_ia (Internet Archive id), web_channel ('il:<key>' or a stream address, extra = logo), web_yt /
// web_ytc (YouTube video / channel, yt.js) are the browser's own - the build keeps and syncs them without showing them.
function toggleFav(item, quiet) {
  const was = store.isFav(item.kind, item.id);
  if (was) store.removeFav(item.kind, item.id);
  else { store.addFav(item.kind, item.id, item.label, item.extra || ''); if (item.img) store.setArt(item.kind, item.id, item.img); }
  if (!quiet) toast(N(was ? 'core_fav_removed' : 'core_fav_added'), {kind: 'ok', action: {label: N('core_undo'), onClick: () => { toggleFav(item, true); emit('favs', item); }}});
  emit('favs', item);
  return !was;
}
function favButton(item) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ghost favbtn';
  const label = () => {
    const on = store.isFav(item.kind, item.id);
    b.innerHTML = icon('heart') + '<span class="favlabel">' + esc(noGlyph(t(on ? 'fav_rm' : 'fav_add'))) + '</span>';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', noGlyph(t(on ? 'fav_rm' : 'fav_add')));
  };
  label();
  b.onclick = () => { toggleFav(item); label(); };
  const off = on('favs', (it) => { if (!b.isConnected) off(); else if (it && it.kind === item.kind && String(it.id) === String(item.id)) label(); });
  return b;
}
// every history entry gets Kodi's play address when it is a film, so a film started here starts in Kodi too
const noteHistory = (e) => store.addHistory(SC.kodiPlay(e));

// ---------------------------------------------------------------- building blocks
const tidy = (n) => String(n || '').replace(/\s*\((\d{3,4}p|\d+i)\)|\s*\[[^\]]*\]/gi, '').trim();     // "Kan 11 (1080p) [Not 24/7]" -> "Kan 11"
const chName = (c) => (c.key ? ((cfg.lang === 'he' && c.name_he) || c.name) : tidy(c.name));
function hashKey(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return 'k' + (h >>> 0).toString(36); }
// card(img, title, sub, onClick, shape, badge, opts): button.card[.wide|.square|.land|.dim] > .badge? + .img + .t + .s?
// opts: progress 0..1 (a bar under the picture), cover (a 16:9 / 1:1 picture fills its box), href (an <a>: "open in a
// new tab" works), menu ([{label, icon, onClick, danger}] or a function returning it: long-press, right-click, the
// Menu key), key (a stable id for focus restore), hero ({title, meta, text, backdrop}: the TV hero follows the focus).
function card(img, title, sub, onClick, kind, badge, opts) {
  opts = opts || {};
  const b = document.createElement(opts.href ? 'a' : 'button');
  if (opts.href) b.href = opts.href; else b.type = 'button';
  b.className = 'card' + (kind ? ' ' + kind : '') + (opts.cover ? ' cover' : '');
  const p = Number(opts.progress) > 0 ? Math.max(2, Math.min(100, Math.round(Number(opts.progress) * 100))) : 0;
  b.innerHTML = (badge ? `<span class="badge">${esc(badge)}</span>` : '') + '<div class="img">' + (p ? `<span class="prog"><i style="width:${p}%"></i></span>` : '') + '</div>' +
                `<div class="t" dir="auto">${esc(title)}</div>` + (sub != null ? `<div class="s" dir="auto">${esc(sub)}</div>` : '');
  b.title = String(title == null ? '' : title);
  b.setAttribute('data-key', opts.key ? String(opts.key) : hashKey(String(title) + '|' + String(img || '')));
  paint(b.querySelector('.img'), img);
  if (onClick) b.onclick = onClick;
  if (opts.menu) attachMenu(b, opts.menu);
  if (opts.hero) b._hero = opts.hero;
  return b;
}
function section(title, count, into) {
  const h = document.createElement('h2');
  h.innerHTML = `<span dir="auto">${esc(title)}</span>` + (count != null ? ` <small>${esc(count)}</small>` : '');
  const g = document.createElement('div');
  g.className = 'grid';
  (into || view).append(h, g);
  return g;
}
// Every screen except Home: <div class="pagehead"><a class="backbtn"> <h1> <div class="pageacts">. The back link leads
// to the page's parent (SC.PARENT); when the previous screen of this visit IS that parent, it goes back in the
// history instead, so the place and the focus there come back. opts: {back: '#/...', actions: [elements], solo: true
// (the phone title bar already shows the title: hide the head there)}.
let pageTitleText = '';
function page(key, title, opts) {
  opts = opts || {};
  const here = hereNow(), text = String(title || (key ? (I18N.has('m_' + key) ? N('m_' + key) : t(key)) : '') || '');
  const back = opts.back || SC.backHash(here.key, here.arg);
  view.innerHTML = `<div class="pagehead${opts.solo === false ? '' : ' solo'}"><a class="backbtn" href="${esc(back)}" aria-label="${esc(N('core_back'))}">${icon('back')}<span>${esc(N('core_back'))}</span></a>` +
                   `<h1 dir="auto">${esc(text)}</h1><div class="pageacts"></div></div>`;
  if (opts.actions) { const box = view.querySelector('.pageacts'); [].concat(opts.actions).forEach((a) => a && box.append(a)); view.firstChild.classList.remove('solo'); }
  setTitle(text);
  return view.firstChild;
}
function setTitle(text) {
  pageTitleText = String(text || '');
  document.title = pageTitleText ? pageTitleText + ' · BN Stream' : 'BN Stream Web';
  const p = $('#ptitle');
  if (p) p.textContent = pageTitleText;
  announce(pageTitleText || N('nav_home'));
}
function chips(items, on, go, into) {
  const box = document.createElement('div');
  box.className = 'chips';
  items.forEach(([k, name]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (k === on ? ' on' : '');
    b.setAttribute('aria-pressed', k === on ? 'true' : 'false');
    b.textContent = name;
    b.onclick = () => go(k);
    box.append(b);
  });
  (into || view).append(box);
  return box;
}
// skeleton(n, shape, into): placeholders of the real component's size. shape: poster (default) | wide | square | land |
// row (list rows) | detail (a hero box)
function skeleton(n, shape, into) {
  n = n == null ? 12 : n;
  const g = document.createElement('div');
  if (shape === 'row') { g.className = 'hlist skelgrid'; g.innerHTML = '<div class="hrow skel"><span class="himg"></span><span class="htxt"><b></b></span></div>'.repeat(n); }
  else if (shape === 'detail') { g.className = 'skelgrid'; g.innerHTML = '<div class="skelbox"></div>'; }
  else {
    g.className = 'grid skelgrid';
    if (shape && shape !== 'poster') g.setAttribute('data-shape', shape);
    g.innerHTML = `<div class="card skel${shape && shape !== 'poster' ? ' ' + esc(shape) : ''}"><div class="img"></div><div class="t"></div><div class="s"></div></div>`.repeat(n);
  }
  g.setAttribute('aria-hidden', 'true');
  (into || view).append(g);
  return g;
}
// state(target, {kind, title, text, action}): what a list shows instead of items. kind: empty | error | offline |
// need-key | need-login | loading. One icon, one title, one sentence and at most one button ({label, onClick | href}).
// target: an element that is filled (null = a new box at the end of the view). Returns the box.
const STATE_ICON = {empty: 'empty', error: 'warn', offline: 'offline', 'need-key': 'key', 'need-login': 'lock', loading: 'refresh'};
function state(target, o) {
  o = o || {};
  const kind = STATE_ICON[o.kind] ? o.kind : 'empty';
  const box = target || document.createElement('div');
  if (!target) view.append(box);
  let title = o.title, text = o.text, action = o.action;
  if (title == null) title = kind === 'offline' ? N('core_offline') : kind === 'need-key' ? N('core_need_key') : kind === 'need-login' ? N('core_need_login') : kind === 'error' ? N('core_error') : kind === 'loading' ? t('loading') : t('none');
  if (text == null) text = kind === 'offline' ? N('core_offline_txt') : kind === 'need-key' ? N('core_need_key_txt') : kind === 'need-login' ? N('core_need_login_txt') : kind === 'error' ? N('core_error_txt') : '';
  if (action === undefined) {
    action = kind === 'need-key' ? {label: N('core_open_settings'), href: '#/settings/accounts'} : kind === 'need-login' ? {label: X('tg_connect'), href: '#/tglogin'}
      : kind === 'error' || kind === 'offline' ? {label: N('core_retry'), onClick: () => route(true)} : null;
  }
  box.classList.add('state', 'k-' + kind);
  box.setAttribute('role', kind === 'error' || kind === 'offline' ? 'alert' : 'status');
  box.innerHTML = (kind === 'loading' ? '<span class="spinner"></span>' : icon(STATE_ICON[kind])) + `<h3 dir="auto">${esc(title)}</h3>` + (text ? `<p dir="auto">${esc(text)}</p>` : '');
  if (action && action.label) {
    let b;
    if (action.href) { b = document.createElement('a'); b.className = 'btn'; b.href = action.href; b.textContent = action.label; }
    else b = button('btn', action.label, action.onClick);
    b.setAttribute('data-autofocus', '');
    box.append(b);
    // a state that replaced the list under a remote / keyboard: its one button takes the focus
    if ((inputMode === 'key' || isTvShell()) && view.contains(box) && (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected)) focusEl(b);
  }
  return box;
}
// empty(gridEl, text): the list had nothing - the element is replaced by the 'empty' state
function empty(where, text) {
  const box = document.createElement('div');
  if (where && where.parentNode) where.replaceWith(box); else view.append(box);
  return state(box, {kind: 'empty', title: text || t('none'), text: '', action: null});
}
const button = (cls, text, onClick) => { const b = document.createElement('button'); b.className = cls; b.textContent = text; b.onclick = onClick; return b; };
const iconButton = (cls, ic, label, onClick) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.innerHTML = icon(ic); b.setAttribute('aria-label', label); b.title = label; b.onclick = onClick; return b; };
const labelButton = (cls, ic, text, onClick) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.innerHTML = icon(ic) + '<span>' + esc(text) + '</span>'; b.onclick = onClick; return b; };
// row(title, opts): a horizontal carousel. Appends <h2 class="rowh"> and <div class="row"> (siblings: the h2 is the
// scroller's previousElementSibling, as with section) and returns the scroller; cards are appended to it.
// opts: more / href (the "see all" address), shape (poster | wide | square | land), into (a container, default the
// view), count, load(scroller) (an async filler: 8 skeletons until the row comes within one screen; a row that stays
// empty is removed, a failed one too).
function row(title, opts) {
  opts = opts || {};
  const more = opts.more || opts.href || '';
  const h = document.createElement('h2');
  h.className = 'rowh';
  h.innerHTML = `<span class="rowt" dir="auto">${esc(title)}${opts.count != null ? ` <small>${esc(opts.count)}</small>` : ''}</span>` +
    (more ? `<a class="more" href="${esc(more)}">${esc(N('core_see_all'))}${icon('next')}</a>` : '') +
    `<span class="rownav" aria-hidden="true"><button type="button" tabindex="-1">${icon('back')}</button><button type="button" tabindex="-1">${icon('next')}</button></span>`;
  const sc = document.createElement('div');
  sc.className = 'row';
  sc.setAttribute('role', 'list');
  if (opts.shape && opts.shape !== 'poster') sc.setAttribute('data-shape', opts.shape);
  const step = (fwd) => { const d = sc.clientWidth * 0.8 * (fwd ? 1 : -1) * (cfg.lang === 'he' ? -1 : 1); sc.scrollBy({left: d, behavior: reducedMotion() ? 'auto' : 'smooth'}); };
  const nav = h.querySelectorAll('.rownav button');
  nav[0].onclick = () => step(false);
  nav[1].onclick = () => step(true);
  (opts.into || view).append(h, sc);
  if (typeof opts.load === 'function') {
    const n = 8, shape = opts.shape && opts.shape !== 'poster' ? ' ' + opts.shape : '';
    sc.innerHTML = `<div class="card skel${shape}"><div class="img"></div><div class="t"></div></div>`.repeat(n);
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      Promise.resolve().then(() => opts.load(sc, () => { sc.querySelectorAll('.skel').forEach((x) => x.remove()); })).catch(() => {}).then(() => {
        sc.querySelectorAll('.skel').forEach((x) => x.remove());
        if (!sc.children.length) { h.remove(); sc.remove(); }
      });
    };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) { io.disconnect(); start(); } }, {rootMargin: '100% 0px'});
      io.observe(sc);
    } else start();
  }
  return sc;
}
// hero({kicker, title, meta: [parts], text, backdrop, poster, actions: [elements], plain}) -> element (not appended).
// No video and no autoplay; the backdrop fades in when it loaded. set(o) swaps the texts and the picture (TV: the
// hero follows the focused card).
function hero(o) {
  o = o || {};
  const el = document.createElement('section');
  el.className = 'hero' + (o.backdrop ? '' : ' plain');
  el.innerHTML = '<img class="hero-bg" alt="" hidden><div class="hero-in">' + (o.poster && cssUrl(o.poster) ? `<img class="hero-poster" alt="" src="${esc(new URL(o.poster, document.baseURI).href)}">` : '') +
    '<div class="hero-txt"><div class="kicker"></div><div class="hero-t" dir="auto"></div><div class="hmeta"></div><p class="plot" dir="auto"></p><div class="actions hero-acts"></div></div></div>';
  const bg = el.querySelector('.hero-bg');
  bg.onload = () => { bg.classList.add('on'); };
  bg.onerror = () => { bg.hidden = true; el.classList.add('plain'); };
  el.set = (v) => {
    el.querySelector('.kicker').textContent = v.kicker || '';
    const tt = el.querySelector('.hero-t');
    tt.textContent = v.title || '';
    tt.setAttribute('role', 'heading'); tt.setAttribute('aria-level', '1');
    el.querySelector('.hmeta').innerHTML = bdis(v.meta || [], '');
    el.querySelector('.plot').textContent = v.text || '';
    const src = v.backdrop && cssUrl(v.backdrop) ? new URL(v.backdrop, document.baseURI).href : '';
    if (src && bg.getAttribute('src') !== src) { bg.classList.remove('on'); bg.hidden = false; el.classList.remove('plain'); bg.src = src; }
    else if (!src) { bg.hidden = true; bg.removeAttribute('src'); el.classList.add('plain'); }
  };
  el.set(o);
  const acts = el.querySelector('.hero-acts');
  [].concat(o.actions || []).forEach((a) => a && acts.append(a));
  el.acts = acts;
  return el;
}
const tmdbCard = (r, o) => {
  const type = r.media_type || (r.title ? 'movie' : 'tv'), title = r.title || r.name || '', year = (r.release_date || r.first_air_date || '').slice(0, 4);
  return card(r.poster_path ? tmdbImg(r.poster_path, 'auto') : '', title, year, null, '', '', Object.assign({
    href: '#/title/' + type + '/' + r.id, key: type + ':' + r.id,
    hero: {title, meta: [year, r.vote_average ? '★ ' + Number(r.vote_average).toFixed(1) : ''], text: r.overview || '', backdrop: r.backdrop_path ? IMG + SC.backdropSize(shellName) + r.backdrop_path : ''}}, o || {}));
};
const iaImg = (id) => `https://archive.org/services/img/${encodeURIComponent(id)}`;
const iaCard = (d) => card(iaImg(d.identifier), d.title, d.year || '', () => openArchive(d), '', '', {key: 'ia:' + d.identifier});
const chCard = (c) => card(c.logo || '', chName(c), c.kodi_only ? X('kodi_only') : c.group, () => openChannel(c),
                           'wide' + (c.kodi_only ? ' dim' : ''), c.kodi_only ? 'KODI' : 'LIVE', {key: 'ch:' + (c.key || c.url)});
const radioCard = (s) => card(httpsOnly(s.favicon) || '', String(s.name || '').trim(), [s.country, s.tags && s.tags.split(',')[0]].filter(Boolean).join(' · '),
                               () => playRadio(s), 'square', '', {key: 'radio:' + s.stationuuid});
// a title that came from another device has no picture here: it is fetched once and remembered in this browser
function lazyPoster(el, media, id) {
  tmdb(`/${media}/${id}`).then((d) => {
    if (!d.poster_path) return;
    store.setArt(media === 'movie' ? 'movie' : 'series', id, IMG + 'w342' + d.poster_path);
    paint(el, IMG + 'w342' + d.poster_path);
  }).catch(() => {});
}

// ---------------------------------------------------------------- overlays: sheet, pop layer (menu / confirm), toasts
// The sheet (#modal > .sheet > #sheet) is a dialog: opening it adds a history entry, so the phone's Back gesture, the
// browser's Back, a remote's Back key, Escape, the scrim and the close button all end in the same closeModal().
// The focus goes to [data-autofocus] or the first control of the content and returns to the opener on close; Tab and
// the arrows stay inside. The page behind does not scroll.
// modal(html, opts): opts.size 's' 420 px | 'm' 640 px | 'l' 980 px | 'player' (the whole window; chosen by itself
// when the content starts with .player or .pl-host), opts.close === false hides the close button (the content has
// its own), opts.label names the dialog when it has no heading.
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
const modalEl = $('#modal'), sheetBox = modalEl.querySelector('.sheet'), sheetEl = $('#sheet'), closeBtn = modalEl.querySelector('.close');
let sheetOpen = false, sheetOpener = null, sheetSeq = 0, sheetPopPending = false, pendingNav = '', focusTimer = null;
let hIdx = 0;                                          // the index of the current history entry (router, below)
const shown = (el) => !!(el && el.isConnected && (el.offsetWidth || el.offsetHeight || el.getClientRects().length) && !el.closest('[hidden]'));
function focusEl(el, quiet) {
  if (!el || !el.focus) return false;
  try { el.focus({preventScroll: true}); } catch (e) { try { el.focus(); } catch (e2) { return false; } }
  if (!quiet && el.scrollIntoView && (inputMode === 'key' || isTvShell())) {
    const inRow = isTvShell() && el.parentNode && el.parentNode.classList && el.parentNode.classList.contains('row');
    try { el.scrollIntoView({block: 'nearest', inline: inRow ? 'start' : 'nearest', behavior: isTvShell() || reducedMotion() ? 'auto' : 'smooth'}); } catch (e) { el.scrollIntoView(false); }
  }
  return document.activeElement === el;
}
function focusSheet() {
  clearTimeout(focusTimer);
  if (!modalEl.contains(document.activeElement)) focusEl(closeBtn, true);
  // modules add their buttons right after modal() returns: the content is looked at a moment later
  focusTimer = setTimeout(() => {
    if (!sheetOpen) return;
    const a = document.activeElement;
    if (a && a !== closeBtn && sheetEl.contains(a)) return;
    const target = sheetEl.querySelector('[data-autofocus]') || Array.from(sheetEl.querySelectorAll(FOCUSABLE)).find(shown);
    if (target) focusEl(target, true);
  }, 60);
}
function modal(html, opts) {
  opts = opts || {};
  if (typeof html === 'string') sheetEl.innerHTML = html; else if (html) sheetEl.replaceChildren(html); else sheetEl.innerHTML = '';
  const first = sheetEl.firstElementChild;
  const size = opts.size || (first && (first.classList.contains('player') || first.classList.contains('pl-host')) ? 'player' : 'l');
  sheetBox.className = 'sheet sz-' + size + (opts.close === false ? ' noclose' : '');
  modalEl.classList.toggle('full', size === 'player');
  HTML.classList.toggle('immersive', size === 'player');
  closeBtn.innerHTML = icon(size === 'player' ? 'back' : 'close');
  closeBtn.classList.toggle('back', size === 'player');
  closeBtn.setAttribute('aria-label', N(size === 'player' ? 'core_back' : 'core_close'));
  const h = sheetEl.querySelector('h1,h2,h3');
  if (h) { if (!h.id) h.id = 'sheet_title'; modalEl.setAttribute('aria-labelledby', h.id); modalEl.removeAttribute('aria-label'); }
  else { modalEl.removeAttribute('aria-labelledby'); modalEl.setAttribute('aria-label', opts.label || pageTitleText || 'BN Stream'); }
  sheetEl.scrollTop = 0;
  if (!sheetOpen) {
    sheetOpen = true;
    const a = document.activeElement;
    sheetOpener = a && a !== document.body ? a : null;
    modalEl.hidden = false;
    HTML.classList.add('locked');
    try { history.pushState({i: hIdx, sheet: ++sheetSeq}, ''); } catch (e) {}
    emit('sheet', true);
  }
  focusSheet();
  return sheetEl;
}
// closeModal(): empties #sheet (player.js watches that to end a playback), gives the focus back, and takes the
// sheet's history entry away. `fromHistory` is true when Back already did that.
function closeModal(fromHistory) {
  if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
  const was = sheetOpen;
  clearTimeout(focusTimer);
  sheetEl.innerHTML = '';
  modalEl.hidden = true;
  sheetOpen = false;
  HTML.classList.remove('locked', 'immersive');
  if (!was) return;
  const op = sheetOpener;
  sheetOpener = null;
  if (fromHistory !== true) { try { if (history.state && history.state.sheet) { sheetPopPending = true; history.back(); } } catch (e) {} }
  if (op && op.isConnected && shown(op)) focusEl(op, true);
  emit('sheet', false);
}
closeBtn.onclick = () => closeModal();
modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });
// a player inside a frame (YouTube, Archive, Dailymotion) swallows every key once it has the focus. On a remote there
// is no way out, so on TV the focus comes back to the sheet's Back button a moment after a click went into the frame.
window.addEventListener('blur', () => {
  setTimeout(() => {
    const a = document.activeElement;
    if (sheetOpen && isTvShell() && a && a.tagName === 'IFRAME' && sheetEl.contains(a)) { try { window.focus(); } catch (e) {} focusEl(closeBtn, true); }
  }, 400);
});
// swipe the bottom sheet down (phone) to close it
{
  let y0 = null;
  sheetBox.addEventListener('touchstart', (e) => { y0 = shellName === 'phone' && sheetEl.scrollTop <= 0 && !sheetBox.classList.contains('sz-player') && e.touches.length === 1 ? e.touches[0].clientY : null; }, {passive: true});
  sheetBox.addEventListener('touchend', (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 110) closeModal(); y0 = null; }, {passive: true});
}
// playerHost(opts): the whole-window stage for a player module. Returns the <div class="pl-host"> inside the sheet
// (already open, size 'player'); the module puts its <video> and its overlay layers (.pl-top, .pl-center, .pl-bottom,
// .pl-panel ... - style.css section 6) into it. Back / Escape / the Back button close it through closeModal().
function playerHost(opts) {
  opts = opts || {};
  stopRadio();
  modal('<div class="pl-host" id="pl_host"></div>', {size: 'player', close: opts.close, label: opts.title || ''});
  return document.getElementById('pl_host');
}

// ---- the pop layer: one context menu or one confirmation at a time, above sheets
const popEl = $('#pop');
let popOpen = false, popOpener = null, popDone = null;
function openPop(node, at) {
  if (popOpen) closePop();
  const a = document.activeElement;
  popOpener = a && a !== document.body ? a : null;
  popEl.replaceChildren(node);
  popEl.className = 'pop' + (at ? ' at' : '');
  popEl.hidden = false;
  popOpen = true;
}
function closePop(result) {
  if (!popOpen) return;
  popOpen = false;
  popEl.hidden = true;
  popEl.replaceChildren();
  const done = popDone, op = popOpener;
  popDone = null; popOpener = null;
  if (op && op.isConnected && shown(op)) focusEl(op, true);
  if (done) done(result === true);
}
popEl.addEventListener('click', (e) => { if (e.target === popEl) closePop(false); });
// menu(anchorEl, items, pos?): items = [{label, icon?, onClick, danger?}] (at most 7). A popover beside the anchor on
// desktop / tablet, a bottom sheet on phones, a centred list on TV.
function menu(anchor, items, pos) {
  items = (typeof items === 'function' ? items() : items || []).filter(Boolean).slice(0, 7);
  if (!items.length) return;
  const box = document.createElement('div');
  box.className = 'popmenu';
  box.setAttribute('role', 'menu');
  items.forEach((it) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    if (it.danger) b.className = 'danger';
    b.innerHTML = (it.icon ? icon(it.icon) : '') + '<span dir="auto">' + esc(it.label) + '</span>';
    b.onclick = () => { closePop(); try { if (it.onClick) it.onClick(); } catch (e) {} };
    box.append(b);
  });
  const at = !!anchor && (shellName === 'desktop' || shellName === 'tablet');
  openPop(box, at);
  if (at) {
    const r = anchor.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    const given = pos && (pos.x || pos.y);
    let x = given ? pos.x : (cfg.lang === 'he' ? r.right - w : r.left), y = given ? pos.y : r.bottom + 6;
    if (!given && y + h > vh - 8) y = r.top - h - 6;
    box.style.left = Math.max(8, Math.min(x, vw - w - 8)) + 'px';
    box.style.top = Math.max(8, Math.min(y, vh - h - 8)) + 'px';
  }
  focusEl(box.firstChild, true);
}
function attachMenu(el, items) {
  el._menu = items;
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); menu(el, items, {x: e.clientX, y: e.clientY}); });
  let timer = null, fired = false;
  const cancel = () => clearTimeout(timer);
  el.addEventListener('touchstart', () => { fired = false; cancel(); timer = setTimeout(() => { if (!popOpen) { fired = true; menu(el, items); } }, 600); }, {passive: true});
  el.addEventListener('touchmove', cancel, {passive: true});
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('touchend', (e) => { cancel(); if (fired && e.cancelable) e.preventDefault(); });
}
// confirm({title, text, ok, cancel, danger}) -> Promise<boolean>. Replaces every "press again to confirm".
function confirmBox(o) {
  o = o || {};
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'dialog';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = `<h3 id="dlg_t" dir="auto">${esc(o.title || '')}</h3>` + (o.text ? `<p dir="auto">${esc(o.text)}</p>` : '') + '<div class="actions"></div>';
    box.setAttribute('aria-labelledby', 'dlg_t');
    const no = button('btn ghost', o.cancel || X('u_cancel'), () => closePop(false));
    const yes = button('btn' + (o.danger ? ' danger' : ''), o.ok || N('core_ok'), () => closePop(true));
    no.type = yes.type = 'button';
    box.lastChild.append(no, yes);
    openPop(box, false);
    popDone = resolve;
    focusEl(o.danger ? no : yes, true);
  });
}
// toast(text, {kind: 'ok' | 'error', action: {label, onClick}, ms}) -> close(). One line, at most three at a time,
// 4 s (8 s with an action). Things that need a decision are not toasts (TN.state / TN.confirm).
function toast(text, o) {
  o = o || {};
  const box = $('#toasts');
  if (!box) return () => {};
  const el = document.createElement('div');
  el.className = 'toast' + (o.kind ? ' k-' + String(o.kind).replace(/[^a-z]/g, '') : '');
  el.innerHTML = (o.kind === 'error' ? icon('warn') : o.kind === 'ok' ? icon('check') : '') + '<span dir="auto"></span>';
  el.querySelector('span').textContent = String(text == null ? '' : text);
  let timer = null;
  const close = () => { clearTimeout(timer); el.remove(); };
  if (o.action && o.action.label) {
    const b = button('', o.action.label, () => { close(); try { if (o.action.onClick) o.action.onClick(); } catch (e) {} });
    b.type = 'button';
    el.append(b);
  }
  while (box.children.length >= 3) box.firstChild.remove();
  box.append(el);
  const ms = o.ms === 0 ? 0 : Number(o.ms) || (o.action ? 8000 : 4000);
  if (ms) timer = setTimeout(close, ms);
  return close;
}
function copyText(text) {
  const done = () => toast(N('core_copied'), {kind: 'ok'});
  const old = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    if (ok) done(); else toast(text, {ms: 12000});
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, old); else old();
}

// ---------------------------------------------------------------- players
// the trailer: a YouTube frame, opened only when the viewer asks for it (no third-party request before that)
function openTrailer(key, title) {
  stopRadio();
  modal(`<div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="${esc(t('trailer'))}"></iframe></div>` +
        `<div class="detail one"><div><h3 dir="auto">${esc(title || t('trailer'))}</h3><div class="meta">${esc(t('trailer'))} · YouTube</div></div></div>`);
}
function openArchive(d) {
  const title = d.title || d.identifier;
  stopRadio();
  modal(`<div class="player"><iframe src="https://archive.org/embed/${encodeURIComponent(d.identifier)}" allow="autoplay; fullscreen" allowfullscreen title="${esc(title)}"></iframe></div>
    <div class="detail one"><div><h3 dir="auto">${esc(title)}</h3><div class="meta">${bdis([d.year, 'Internet Archive'])}</div>
    <div class="actions" id="acts"><a class="btn ghost" target="_blank" rel="noopener" href="https://archive.org/details/${encodeURIComponent(d.identifier)}">${esc(N('core_open_site'))}</a></div></div></div>`);
  $('#acts').prepend(favButton({kind: 'web_ia', id: d.identifier, label: title, extra: '', img: iaImg(d.identifier)}));
  noteHistory({key: 'ia:' + d.identifier, label: title, thumb: iaImg(d.identifier)});
}
// something only the Kodi build can play (an Idan+ channel, a PVR favourite, a file found through an add-on)
function kodiOnly(title, text, fav) {
  modal(`<div class="detail one"><div><h3 dir="auto">${esc(title)}</h3><div class="meta"><span class="tag alt">${esc(X('kodi_only'))}</span></div>
    <p dir="auto">${esc(text)}</p><div class="actions" id="acts"><a class="btn" href="#/bn" data-autofocus>${esc(N('m_bn'))}</a></div></div></div>`, {size: 'm'});
  if (fav) $('#acts').append(favButton(fav));
}
// A live channel in the sheet. hls.js when the browser can run it (also on Chrome for Android, which only says
// "maybe" for native HLS), the browser's own HLS otherwise (Safari, iOS). The build's table may name several streams
// of a channel: the next one is tried when one fails; when all failed the viewer gets a message with "try again" and
// "copy the address" (for VLC / Kodi) instead of a black box.
function openChannel(c) {
  const name = chName(c), favId = c.key ? 'il:' + c.key : c.url;
  const fav = {kind: 'web_channel', id: favId, label: name, extra: httpsOnly(c.logo), img: c.logo || ''};
  if (c.kodi_only || !httpsOnly(c.url)) return kodiOnly(name, X(c.why === 'youtube' ? 'kodi_yt' : 'kodi_idan'), store.isFav('web_channel', favId) ? fav : null);
  stopRadio();
  modal(`<div class="player" id="chp"><video id="vid" controls autoplay playsinline x-webkit-airplay="allow"></video><span class="spinner pwait" id="chw"></span></div>
    <div class="detail one"><div><h3 dir="auto">${esc(name)}</h3><div class="meta">${bdis([c.group, 'LIVE'])}</div>
    <div class="actions" id="acts"></div></div></div>`);
  $('#acts').append(favButton(fav));
  noteHistory({key: 'ch:' + favId, label: name, play: c.url, thumb: httpsOnly(c.logo)});
  const urls = c.urls && c.urls.length ? c.urls : [c.url], v = $('#vid'), wait = $('#chw'), box = $('#chp');
  let at = 0;
  const mine = () => $('#vid') === v;
  const over = (html) => { const old = box.querySelector('.perr'); if (old) old.remove(); if (html == null) return null; const d = document.createElement('div'); d.className = 'perr'; d.setAttribute('role', 'alert'); d.innerHTML = html; box.append(d); return d; };
  const failed = () => {
    if (!mine()) return;
    wait.hidden = true;
    const d = over(`<b dir="auto">${esc(N('core_live_fail'))}</b>`);
    const acts = document.createElement('div');
    acts.className = 'actions';
    const again = button('btn', N('core_retry'), () => { at = 0; over(null); start(); });
    again.setAttribute('data-autofocus', '');
    acts.append(again, button('btn ghost', N('core_copy_link'), () => copyText(urls[0])));
    d.append(acts);
    if (inputMode === 'key' || isTvShell()) focusEl(again, true);
  };
  const next = () => { if (!mine()) return; if (at + 1 < urls.length) { at++; start(); } else failed(); };
  function start() {
    wait.hidden = false;
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls(hlsCfg());
      hlsWatch(hls);
      hls.on(window.Hls.Events.ERROR, (ev, data) => { if (data && data.fatal) next(); });
      hls.loadSource(urls[at]);
      hls.attachMedia(v);
    } else v.src = urls[at];
    const p = v.play();
    if (p && p.catch) p.catch((e) => {          // the browser refused to start with sound: one clear button
      if (!mine() || !e || e.name !== 'NotAllowedError') return;
      wait.hidden = true;
      const d = over('');
      const b = labelButton('btn', 'play', N('core_press_play'), () => { over(null); v.play().catch(() => {}); });
      d.append(b);
    });
  }
  v.addEventListener('error', () => { if (!hls) next(); });
  v.addEventListener('waiting', () => { wait.hidden = false; });
  v.addEventListener('playing', () => { wait.hidden = true; over(null); });
  v.addEventListener('canplay', () => { wait.hidden = true; });
  start();
}
// radio plays in the mini player above the tab bar / at the bottom of the content, so the viewer can keep browsing
const audio = new Audio();
audio.preload = 'none';
let radioNow = null;
const radioBar = $('#radiobar');
function radioState() {
  if (!radioNow || radioBar.hidden) return;
  const b = radioBar.querySelector('#rbplay'), sub = radioBar.querySelector('.rb-t span');
  const err = !!audio.error && !!audio.getAttribute('src');
  if (b) { b.innerHTML = icon(audio.paused || err ? 'play' : 'pause'); b.setAttribute('aria-label', audio.paused || err ? t('play') : N('core_pause')); }
  if (sub) { sub.textContent = err ? N('core_radio_fail') : radioNow.country || ''; sub.classList.toggle('err', err); }
  if (err) radioBar.classList.remove('wait');
}
['playing', 'pause', 'error', 'emptied'].forEach((ev) => audio.addEventListener(ev, () => { if (ev !== 'pause') radioBar.classList.remove('wait'); radioState(); }));
['waiting', 'loadstart', 'stalled'].forEach((ev) => audio.addEventListener(ev, () => { if (radioNow && !audio.paused) radioBar.classList.add('wait'); }));
function radioStart() {
  if (!radioNow) return;
  radioBar.classList.add('wait');
  if (audio.error || audio.getAttribute('src') !== radioNow.url_resolved) audio.src = radioNow.url_resolved;
  const p = audio.play();
  if (p && p.catch) p.catch(() => { radioBar.classList.remove('wait'); radioState(); });
}
function playRadio(s) {
  const name = String(s.name || '').trim();
  radioNow = Object.assign({}, s, {name});
  radioBar.hidden = false;
  HTML.classList.add('has-radio');
  radioBar.innerHTML = `<i class="rb-line"></i><img alt=""><div class="rb-t" dir="auto"><b></b><span></span></div><span id="rbfav"></span>`;
  const img = radioBar.querySelector('img');
  img.onerror = () => { img.onerror = null; img.src = 'icon.png'; };
  img.src = httpsOnly(s.favicon) || 'icon.png';
  radioBar.querySelector('b').textContent = name;
  $('#rbfav').append(favButton({kind: 'radio', id: s.stationuuid, label: name, extra: s.url_resolved, img: httpsOnly(s.favicon)}));
  const pp = iconButton('iconbtn', 'pause', N('core_pause'), () => { if (audio.paused || audio.error) radioStart(); else audio.pause(); });
  pp.id = 'rbplay';
  const stop = iconButton('iconbtn', 'close', t('stop'), stopRadio);
  stop.id = 'rbstop';
  radioBar.append(pp, stop);
  audio.src = s.url_resolved;
  radioStart();
  radioState();
  noteHistory({key: 'radio:' + s.stationuuid, label: name, play: s.url_resolved, thumb: httpsOnly(s.favicon)});
  if ('mediaSession' in navigator && window.MediaMetadata) {
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({title: name, artist: s.country || 'BN Stream', artwork: httpsOnly(s.favicon) ? [{src: s.favicon}] : [{src: 'icon-192.png', sizes: '192x192', type: 'image/png'}]});
      navigator.mediaSession.setActionHandler('play', radioStart);
      navigator.mediaSession.setActionHandler('pause', () => audio.pause());
      navigator.mediaSession.setActionHandler('stop', stopRadio);
    } catch (e) {}
  }
}
function stopRadio() {
  if (!radioNow && radioBar.hidden) return;
  radioNow = null;
  audio.pause();
  audio.removeAttribute('src');
  try { audio.load(); } catch (e) {}
  radioBar.hidden = true;
  radioBar.classList.remove('wait');
  HTML.classList.remove('has-radio');
  if ('mediaSession' in navigator) { try { navigator.mediaSession.metadata = null; } catch (e) {} }
}

// ---------------------------------------------------------------- screens: menu and Home
function menuTile(k, ic) {
  const a = document.createElement('a');
  a.className = 'tile';
  a.href = '#/' + k;
  a.setAttribute('data-key', 'm:' + k);
  a.innerHTML = `<span class="ic">${icon(ic)}</span><b>${esc(N('m_' + k))}</b><small>${esc(N('ms_' + k))}</small>`;
  return a;
}
// every page of the app in three groups (Watch, My things, System): the Kodi root list, nothing lost
function menuGroups(into) {
  for (const g of SC.GROUPS) {
    const h = document.createElement('h2');
    h.className = 'menuh';
    h.textContent = N('grp_' + g);
    const box = document.createElement('div');
    box.className = 'menu';
    MENU.filter((m) => m[2] === g).forEach((m) => box.append(menuTile(m[0], m[1])));
    into.append(h, box);
  }
}
// 5.1: display size. 100 % by default; the viewer changes it with - / + or by typing a percentage (50-200), kept in
// the browser settings of this device (never synced). CSS zoom scales the whole interface, the player included.
const ZOOM_MIN = 50, ZOOM_MAX = 200, ZOOM_STEP = 10;
const zoomOf = (x) => { const n = Math.round(Number(String(x).replace('%', '').trim())); return n >= ZOOM_MIN && n <= ZOOM_MAX ? n : (n > ZOOM_MAX ? ZOOM_MAX : n > 0 ? ZOOM_MIN : 100); };
function applyZoom() { const z = zoomOf(cfg.zoom || 100); HTML.style.zoom = z === 100 ? '' : String(z / 100); }
function zoomControl() {
  const box = document.createElement('div');
  box.className = 'zoomctl';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', N('set_zoom'));
  const mk = (txt, label) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost zoombtn'; b.textContent = txt; b.setAttribute('aria-label', label); return b; };
  const minus = mk('\u2212', N('set_zoom_out')), plus = mk('+', N('set_zoom_in')), reset = mk('100%', N('set_zoom_reset'));
  const inp = document.createElement('input');
  inp.type = 'text'; inp.inputMode = 'numeric'; inp.className = 'input zoominp'; inp.setAttribute('aria-label', N('set_zoom_pct')); inp.maxLength = 4; inp.dir = 'ltr';
  const show = () => { const z = zoomOf(cfg.zoom || 100); inp.value = z + '%'; minus.disabled = z <= ZOOM_MIN; plus.disabled = z >= ZOOM_MAX; };
  const set = (z) => { cfg.zoom = zoomOf(z); put('cfg', cfg); applyZoom(); show(); emit('settings', 'zoom'); };
  minus.onclick = () => set(zoomOf(cfg.zoom || 100) - ZOOM_STEP);
  plus.onclick = () => set(zoomOf(cfg.zoom || 100) + ZOOM_STEP);
  reset.onclick = () => set(100);
  inp.onchange = () => set(inp.value);
  inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); set(inp.value); } };
  inp.onfocus = () => { try { inp.select(); } catch (e) { /* not selectable */ } };
  box.append(minus, inp, plus, reset);
  show();
  return box;
}
function pageMenu() {
  page('menu', N('nav_more'));
  const z = document.createElement('div');
  z.className = 'zoomrow';
  const lab = document.createElement('b');
  lab.textContent = N('set_zoom');
  z.append(lab, zoomControl());
  view.append(z);
  menuGroups(view);
}
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => { try { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; } };
function installNow() {
  if (!installEvt) return;
  const ev = installEvt;
  installEvt = null;
  try { ev.prompt(); if (ev.userChoice) ev.userChoice.then(() => emit('install', null), () => {}); } catch (e) {}
  put('install_seen', 1);
}
function banner(ic, title, text, acts) {
  const el = document.createElement('div');
  el.className = 'banner';
  el.innerHTML = icon(ic) + `<div class="btxt"><b dir="auto">${esc(title)}</b>${text ? `<small dir="auto">${esc(text)}</small>` : ''}</div><div class="bacts"></div>`;
  acts.forEach((a) => a && el.lastChild.append(a));
  return el;
}
const linkBtn = (cls, text, href) => { const a = document.createElement('a'); a.className = cls; a.href = href; a.textContent = text; return a; };
// the picture of a history entry's wide artwork (Kodi keeps image://<encoded address>/)
const fanartOf = (h) => SC.picOf({thumb: h && typeof h.fanart === 'string' ? h.fanart : ''});
function continueCard(c) {
  const h = c.entry, tg = SC.histTarget(h), m = /^tv:\d+:(\d+):(\d+)$/.exec(String(h.key));
  const se = m ? 'S' + String(m[1]).padStart(2, '0') + 'E' + String(m[2]).padStart(2, '0') : '';
  const sub = [se, c.left ? N('home_left', SC.leftText(c.left)) : ''].filter(Boolean).join(' · ');
  const pic = fanartOf(h) || SC.picOf(h) || (tg.type === 'title' ? store.art(tg.media === 'movie' ? 'movie' : 'series', tg.id) : '');
  const el = card(pic, String(h.label || h.key), sub, () => openHistory(h, tg), 'land', '', {progress: c.frac || 0.02, key: 'h:' + h.key,
    hero: {kicker: N('home_continue'), title: String(h.label || ''), meta: [se, c.left ? N('home_left', SC.leftText(c.left)) : ''], text: typeof h.plot === 'string' ? h.plot : '', backdrop: fanartOf(h)}});
  if (!pic && tg.type === 'title') lazyPoster(el.querySelector('.img'), tg.media, tg.id);
  return el;
}
let homeHero = null, heroFollow = null;
function tmdbRow(root, title, path, params, type, more) {
  if (!tmdbKey()) return;
  row(title, {into: root, more, load: async (sc) => {
    const d = await tmdb(path, params);
    (d.results || []).filter((r) => r.poster_path).slice(0, 20).forEach((r) => sc.append(tmdbCard(Object.assign({media_type: type}, r))));
  }});
}
const HOME = {
  continue(root, cont) {
    if (!cont.length) return;
    const sc = row(N('home_continue'), {into: root, shape: 'land', more: '#/history'});
    cont.forEach((c) => sc.append(continueCard(c)));
  },
  favs(root) {
    const all = favItems().filter((x) => x[1].group === 'movies' || x[1].group === 'tv').slice(0, 20);
    if (!all.length) return;
    const sc = row(N('m_favs'), {into: root, more: '#/favs'});
    all.forEach(([f, v]) => sc.append(favCard(f, v)));
  },
  live(root) {
    row(N('home_live'), {into: root, shape: 'wide', more: '#/live', load: async (sc) => {
      const list = (await channels('tn')).filter((c) => !c.kodi_only).slice(0, 20);
      let epg = null;
      try { epg = await provider('epg'); if (epg && typeof epg.ready === 'function') await epg.ready(); } catch (e) { epg = null; }
      list.forEach((c) => {
        const el = chCard(c);
        try { const nn = epg && epg.nowNext && epg.nowNext(c); if (nn && nn.now && nn.now.title) el.querySelector('.s').textContent = nn.now.title; } catch (e) {}
        sc.append(el);
      });
    }});
  },
  trend_movie(root) { tmdbRow(root, t('trendM'), '/trending/movie/week', {}, 'movie', '#/movies'); },
  trend_tv(root) { tmdbRow(root, t('trendT'), '/trending/tv/week', {}, 'tv', '#/tv'); },
  popular(root) { tmdbRow(root, t('popular'), '/movie/popular', {}, 'movie', '#/movies'); },
  il_movies(root) { tmdbRow(root, N('home_il_movies'), '/discover/movie', {with_original_language: 'he', sort_by: 'popularity.desc'}, 'movie', '#/movies'); },
  il_series(root) { tmdbRow(root, N('home_il_series'), '/discover/tv', {with_original_language: 'he', sort_by: 'popularity.desc'}, 'tv', '#/tv'); },
  family(root) { tmdbRow(root, N('home_family'), '/discover/movie', {with_genres: '10751', sort_by: 'popularity.desc', 'vote_count.gte': '200'}, 'movie', '#/movies'); },
  radio(root) {
    row(N('m_radio'), {into: root, shape: 'square', more: '#/radio', load: async (sc) => {
      const mine = store.favs().filter((f) => f && f.kind === 'radio' && httpsOnly(f.extra)).slice(0, 20)
        .map((f) => ({stationuuid: String(f.id), name: String(f.label || ''), url_resolved: f.extra, favicon: store.art('radio', String(f.id)), country: ''}));
      mine.forEach((s) => sc.append(radioCard(s)));
      if (mine.length >= 6) return;
      const seen = new Set(mine.map((s) => s.stationuuid));
      (await stations(t('countries')[cfg.radio] ? cfg.radio : 'IL')).filter((s) => !seen.has(s.stationuuid)).slice(0, 20 - mine.length).forEach((s) => sc.append(radioCard(s)));
    }});
  },
  searches(root) {
    const recent = store.searches().slice(0, 12);
    if (!recent.length) return;
    const sc = row(N('m_searchhist'), {into: root, more: '#/searchhist'});
    recent.forEach((q) => { const b = labelButton('chip', 'searchhist', q, () => doSearch(q)); b.dir = 'auto'; sc.append(b); });
  },
  telegram(root) {
    const pins = get('tg_pins', []);
    if (!get('tg_session', '') || !Array.isArray(pins) || !pins.length) return;
    const sc = row(N('m_telegram'), {into: root, shape: 'square', more: '#/telegram'});
    pins.slice(0, 20).forEach((p) => { if (p && p.id) sc.append(card('', String(p.title || p.username || p.id), p.username ? '@' + p.username : '', null, 'square', '', {href: '#/telegram/' + new URLSearchParams({v: 'chat', c: String(p.id)}), key: 'tg:' + p.id})); });
  },
  classics(root) {
    row(t('classics'), {into: root, more: '#/movies', load: async (sc) => { (await archive({rows: 20})).forEach((d) => sc.append(iaCard(d))); }});
  },
  // 5.2: the main menu of the Kodi build, as large tiles at the top of Home: what to watch, my things, accounts
  mainmenu(root) {
    const box = document.createElement('div');
    box.className = 'menu mainmenu';
    box.setAttribute('role', 'navigation');
    box.setAttribute('aria-label', N('home_mainmenu'));
    for (const key of ['movies', 'tv', 'live', 'radio', 'telegram', 'youtube', 'hub', 'favs', 'history', 'services', 'settings']) {
      const m = MENU.find((x) => x[0] === key);
      if (m) box.append(menuTile(m[0], m[1]));
    }
    root.append(box);
  },
  sections(root) {
    const h = document.createElement('h2');
    h.textContent = N('home_sections');
    root.append(h);
    menuGroups(root);
  },
};
function pageHome(arg, ctx) {
  setTitle('');
  view.innerHTML = '<div class="home"></div>';
  const root = view.firstChild, tv = isTvShell();
  const cont = SC.continueWatching(store.history(), 20);
  const slot = document.createElement('div');
  root.append(slot);
  homeHero = null;
  const put1 = (el) => { slot.replaceChildren(el); homeHero = el; };
  if (cont.length) {
    const c = cont[0], h = c.entry, tg = SC.histTarget(h);
    const play = labelButton('btn', 'play', N('home_resume'), () => openHistory(h, tg));
    play.setAttribute('data-autofocus', '');
    const more = tg.type === 'title' ? linkBtn('btn ghost', N('home_details'), '#/title/' + tg.media + '/' + tg.id) : null;
    put1(hero({kicker: N('home_continue'), title: String(h.label || ''), meta: [c.left ? N('home_left', SC.leftText(c.left)) : ''], text: typeof h.plot === 'string' ? h.plot : '',
               backdrop: fanartOf(h), poster: SC.picOf(h), actions: tv ? [] : [play, more]}));
  } else if (tmdbKey()) {
    slot.innerHTML = '<div class="skelbox"></div>';
    tmdb('/trending/all/week').then((d) => {
      if (!ctx.current() || !slot.isConnected) return;
      const r = (d.results || []).find((x) => x.backdrop_path && (x.media_type === 'movie' || x.media_type === 'tv'));
      if (!r) { slot.innerHTML = ''; return; }
      const title = r.title || r.name || '', kind = r.media_type === 'movie' ? 'movie' : 'series';
      const open = linkBtn('btn', N('home_details'), '#/title/' + r.media_type + '/' + r.id);
      open.setAttribute('data-autofocus', '');
      put1(hero({kicker: N('home_trending'), title, meta: [(r.release_date || r.first_air_date || '').slice(0, 4), r.vote_average ? '★ ' + Number(r.vote_average).toFixed(1) : ''], text: r.overview || '',
                 backdrop: IMG + SC.backdropSize(shellName) + r.backdrop_path,
                 actions: tv ? [] : [open, favButton({kind, id: r.id, label: title, extra: '', img: r.poster_path ? IMG + 'w342' + r.poster_path : ''})]}));
    }).catch(() => { if (slot.isConnected) slot.innerHTML = ''; });
  } else {
    const a = linkBtn('btn', N('home_add_key'), '#/settings/accounts');
    a.setAttribute('data-autofocus', '');
    put1(hero({kicker: 'BN Stream', title: N('home_welcome'), text: N('home_welcome_txt'), actions: [a, linkBtn('btn ghost', X('tg_connect'), '#/tglogin'), linkBtn('btn ghost', t('classics'), '#/movies')]}));
  }
  // one-time banners: install the app (with the iOS way), add a TMDb key
  if (!get('install_seen', 0) && !standalone() && (installEvt || IOS) && !tv) {
    const el = banner('install', N('pwa_title'), IOS && !installEvt ? N('pwa_ios') : N('pwa_txt'),
      [installEvt ? button('btn', X('install'), () => { installNow(); el.remove(); }) : null, button('btn ghost', N('pwa_later'), () => { put('install_seen', 1); el.remove(); })]);
    root.append(el);
  }
  if (!tmdbKey() && cont.length) root.append(banner('key', N('core_need_key'), N('core_need_key_txt'), [linkBtn('btn ghost', N('core_open_settings'), '#/settings/accounts')]));
  for (const r of SC.homeRows(get('home_rows', null))) {
    if (!r.on || !HOME[r.id]) continue;
    try { HOME[r.id](root, cont); } catch (e) {}
  }
}
// TV: the hero shows the focused card of the rows below (texts and backdrop swap after 400 ms of rest; no video)
document.addEventListener('focusin', (e) => {
  clearTimeout(heroFollow);
  const el = e.target;
  if (!isTvShell() || !homeHero || !homeHero.isConnected || !el || !el._hero) return;
  heroFollow = setTimeout(() => { if (document.activeElement === el && homeHero && homeHero.isConnected) homeHero.set(el._hero); }, 400);
});

// ---------------------------------------------------------------- favourites, history, users
const ilChannel = async (key) => (await channels('tn').catch(() => [])).find((c) => c.key === key);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
// one favourite (maybe added on a Kodi device) -> how the browser shows and opens it; null = a kind the browser does not know
function favView(f) {
  const id = String(f.id), label = String(f.label || id), extra = typeof f.extra === 'string' ? f.extra : '';
  const fav = {kind: f.kind, id, label, extra};
  const viaYt = (shape, img) => ({group: 'youtube', shape, cover: shape === 'wide', img, open: async () => {
    const y = await provider('yt'), v = y && typeof y.favView === 'function' ? y.favView(f) : null;
    if (v && typeof v.open === 'function') v.open(); else kodiOnly(label, X('kodi_entry'), fav);
  }});
  switch (f.kind) {
    case 'movie': return {group: 'movies', img: store.art('movie', id), lazy: /^\d+$/.test(id) ? 'movie' : '', href: /^\d+$/.test(id) ? '#/title/movie/' + id : '', open: () => openTitle('movie', id)};
    case 'series': return {group: 'tv', img: store.art('series', id), lazy: /^\d+$/.test(id) ? 'tv' : '', href: /^\d+$/.test(id) ? '#/title/tv/' + id : '', open: () => openTitle('tv', id)};
    case 'web_ia': return {group: 'movies', img: iaImg(id), open: () => openArchive({identifier: id, title: label})};
    case 'web_channel':
      if (id.startsWith('il:')) return {group: 'live', shape: 'wide', img: '', open: async () => { const c = await ilChannel(id.slice(3)); if (c) openChannel(c); else kodiOnly(label, X('kodi_entry'), fav); }};
      return {group: 'live', shape: 'wide', img: extra, open: () => openChannel({name: label, url: id, logo: extra, group: ''})};
    case 'channel':                                // a channel of Kodi's own TV list: its number means something on that device only
      return {group: 'live', shape: 'wide', img: '', dim: true, open: () => kodiOnly(label, X('kodi_pvr'), fav)};
    case 'radio':
      if (httpsOnly(extra)) return {group: 'radio', shape: 'square', img: store.art('radio', id), open: () => playRadio({stationuuid: id, name: label, url_resolved: extra, favicon: store.art('radio', id)})};
      return {group: 'radio', shape: 'square', img: '', dim: true, open: () => kodiOnly(label, X('kodi_entry'), fav)};
    case 'web_yt': return YT_ID.test(id) ? viaYt('wide', store.art('web_yt', id) || 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg') : null;
    case 'web_ytc': return viaYt('square', store.art('web_ytc', id));
    default: {                                     // a YouTube favourite made in Kodi (its play address names the video)
      const m = /plugin\.video\.youtube\/play\/\?video_id=([A-Za-z0-9_-]{11})/.exec(extra);
      return m ? viaYt('wide', 'https://i.ytimg.com/vi/' + m[1] + '/mqdefault.jpg') : null;
    }
  }
}
const favItems = () => store.favs().filter((f) => f && typeof f === 'object' && !Array.isArray(f) && f.id != null).map((f) => [f, favView(f)]).filter((x) => x[1]);
function favCard(f, v, redraw) {
  const label = String(f.label || f.id);
  const c = card(v.img || '', label, v.dim ? X('kodi_only') : null, v.href ? null : v.open, (v.shape || '') + (v.dim ? ' dim' : ''), v.dim ? 'KODI' : '', {
    href: v.href || '', cover: !!v.cover, key: 'f:' + f.kind + ':' + f.id,
    menu: [{label: noGlyph(t('fav_rm')), icon: 'trash', danger: true, onClick: () => {
      const item = {kind: f.kind, id: f.id, label, extra: typeof f.extra === 'string' ? f.extra : '', img: v.img || ''};
      store.removeFav(f.kind, f.id);
      emit('favs', item);
      if (redraw) redraw();
      toast(N('core_fav_removed'), {kind: 'ok', action: {label: N('core_undo'), onClick: () => { toggleFav(item, true); if (redraw) redraw(); }}});
    }}]});
  if (!v.img && v.lazy) lazyPoster(c.querySelector('.img'), v.lazy, String(f.id));
  return c;
}
function drawFavs(root) {
  root.innerHTML = '';
  const all = favItems();
  if (!all.length) { state(root.appendChild(document.createElement('div')), {kind: 'empty', title: N('m_favs'), text: noGlyph(t('favs_none')), action: {label: N('m_movies'), href: '#/movies'}}); return; }
  const names = {movies: N('m_movies'), tv: N('m_tv'), live: N('m_live'), radio: N('m_radio'), youtube: N('m_youtube')};
  for (const kind of ['movies', 'tv', 'live', 'radio', 'youtube']) {
    const mine = all.filter((x) => x[1].group === kind);
    if (!mine.length) continue;
    const g = section(names[kind], mine.length, root);
    const shape = mine[0][1].shape;
    if (shape) g.setAttribute('data-shape', shape);
    mine.forEach(([f, v]) => g.append(favCard(f, v, () => drawFavs(root))));
  }
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = N('core_fav_hint');
  root.append(hint);
}
function pageFavs() {
  page('favs');
  const root = document.createElement('div');
  view.append(root);
  drawFavs(root);
}
async function openHistory(h, tg) {
  tg = tg || SC.histTarget(h);
  const label = String(h.label || h.key), pic = SC.picOf(h);
  // the modules that resume a play (sources, yt, hub, tgsearch) register their handlers when they load
  const need = tg.type === 'module' ? tg.module : tg.type === 'title' ? 'sources' : '';
  if (need && MODULES[need]) await loadModule(need).catch(() => {});
  for (const fn of HOOKS.history) { try { if (fn(h, tg)) return; } catch (e) {} }     // a module took it (e.g. resume a web play)
  if (tg.type === 'title') return openTitle(tg.media, tg.id);
  if (tg.type === 'ia') return openArchive({identifier: tg.id, title: label});
  if (tg.type === 'radio') return playRadio({stationuuid: tg.id, name: label, url_resolved: h.play, favicon: pic});
  if (tg.type === 'il') return ilChannel(tg.id).then((c) => (c ? openChannel(c) : kodiOnly(label, X('kodi_entry'))));
  if (tg.type === 'stream') return openChannel({name: label, url: h.play, logo: pic, group: ''});
  return kodiOnly(label, X('kodi_entry'));
}
function drawHistory(root) {
  root.innerHTML = '';
  const all = store.history().filter((h) => h && typeof h === 'object' && !Array.isArray(h) && h.key);
  if (!all.length) { state(root.appendChild(document.createElement('div')), {kind: 'empty', title: N('m_history'), text: X('hist_none'), action: {label: N('nav_home'), href: '#/'}}); return; }
  const prog = {};
  SC.continueWatching(all).forEach((c) => { prog[c.entry.key] = c; });
  const box = document.createElement('div');
  box.className = 'hlist';
  all.forEach((h) => {
    const tg = SC.histTarget(h), pic = SC.picOf(h) || (tg.type === 'ia' ? iaImg(tg.id) : tg.type === 'title' ? store.art(tg.media === 'movie' ? 'movie' : 'series', tg.id) : '');
    const c = prog[h.key];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hrow' + (tg.type === 'kodi' ? ' dim' : '');
    b.setAttribute('data-key', 'h:' + h.key);
    b.innerHTML = `<span class="himg">${c ? `<span class="prog"><i style="width:${Math.round(c.frac * 100)}%"></i></span>` : ''}</span><span class="htxt"><b dir="auto">${esc(h.label || h.key)}</b>` +
                  `<span>${bdis([typeof h.when === 'string' ? h.when : '', c && c.left ? N('home_left', SC.leftText(c.left)) : '', tg.type === 'kodi' ? X('kodi_only') : ''])}</span></span>`;
    paint(b.firstChild, pic);
    if (!pic && tg.type === 'title') lazyPoster(b.firstChild, tg.media, tg.id);
    b.onclick = () => openHistory(h, tg);
    box.append(b);
  });
  root.append(box);
}
const clearHistoryBtn = (redraw) => labelButton('btn ghost', 'trash', X('hist_clear'), async () => {
  if (!(await confirmBox({title: X('hist_clear'), text: N('core_hist_clear_q'), ok: N('core_delete'), danger: true}))) return;
  store.clearHistory();
  toast(X('done'), {kind: 'ok'});
  redraw();
});
function pageHistory() {
  const root = document.createElement('div');
  page('history', '', {actions: store.history().length ? [clearHistoryBtn(() => pageHistory())] : []});
  view.append(root);
  drawHistory(root);
}
// phone tab "My things": favourites and history on one page with two tabs
function pageMine(arg) {
  const tab = arg === 'history' ? 'history' : 'favs';
  page('mine', N('nav_mine'));
  chips([['favs', N('m_favs')], ['history', N('m_history')]], tab, (k) => go('#/mine/' + k));
  const root = document.createElement('div');
  view.append(root);
  if (tab === 'favs') drawFavs(root);
  else { drawHistory(root); if (store.history().length) { const l = document.createElement('div'); l.className = 'links'; l.append(clearHistoryBtn(() => pageMine('history'))); view.append(l); } }
}
// users: the build's model (users.py) - everyone has their own history, favourites and searches
const userName = (u) => String(u.name || '') || X('u_main');
const initial = (name) => Array.from(String(name || '').trim())[0] || '';
function pageUsers() {
  page('users');
  view.insertAdjacentHTML('beforeend', `<p class="hint">${esc(X('users_about'))}</p><div class="panel ulist" id="ulist"></div><p class="err" id="unote" role="alert"></p>`);
  const box = $('#ulist'), cur = store.current(), live = store.live();
  const say = (text) => { $('#unote').textContent = text; };
  const form = (value, onSave) => {             // a name box in place of the row's buttons
    const f = document.createElement('form');
    f.className = 'uform';
    f.innerHTML = `<input type="text" maxlength="30" autocomplete="off" dir="auto" aria-label="${esc(X('u_name'))}" placeholder="${esc(X('u_name'))}">`;
    f.firstChild.value = value;
    const cancel = button('btn ghost', X('u_cancel'), () => pageUsers());
    cancel.type = 'button';
    f.append(button('btn', X('u_save'), null), cancel);
    f.onsubmit = (e) => {
      e.preventDefault();
      try { onSave(f.firstChild.value); } catch (err) { say(err.message === 'name exists' ? X('u_exists') : X('u_name')); }
    };
    return f;
  };
  live.forEach((u) => {
    const row1 = document.createElement('div');
    row1.className = 'urow';
    row1.innerHTML = `<b dir="auto"><span class="avatar">${esc(initial(userName(u)))}</span>${esc(userName(u))}</b>` + (u.id === cur ? `<span class="tag">${esc(X('u_active'))}</span>` : '') + '<span class="uacts"></span>';
    const acts = row1.lastChild;
    if (u.id !== cur) acts.append(button('btn', X('u_switch'), () => { store.switchTo(u.id); drawMe(); pageUsers(); toast(fmt('u_now', userName(u)), {kind: 'ok'}); }));
    acts.append(button('btn ghost', X('u_rename'), () => { acts.replaceWith(form(String(u.name || ''), (name) => { store.rename(u.id, name); drawMe(); pageUsers(); })); focusEl(row1.querySelector('input'), true); }));
    if (u.id !== cur && live.length > 1) {
      acts.append(button('btn ghost danger', X('u_delete'), async () => {
        if (!(await confirmBox({title: X('u_delete'), text: N('core_user_delete_q', userName(u)), ok: N('core_delete'), danger: true}))) return;
        store.remove(u.id);
        pageUsers();
        toast(X('done'), {kind: 'ok'});
      }));
    }
    box.append(row1);
  });
  const add = document.createElement('div');
  add.className = 'urow';
  add.append(labelButton('btn ghost', 'plus', X('u_new'), () => {
    add.replaceChildren(form('', (name) => { const uid = store.create(name); store.switchTo(uid); drawMe(); pageUsers(); toast(fmt('u_now', store.cleanName(name)), {kind: 'ok'}); }));   // (as the build: a new user becomes the active one)
    focusEl(add.querySelector('input'), true);
  }));
  box.append(add);
}
function pageBn() {
  page('bn');
  view.insertAdjacentHTML('beforeend', `<div class="panel bnpanel"><img src="icon.png" alt=""><p>${esc(t('bn_txt'))}</p></div>
    <div class="links">
      <a class="btn" href="${SITE}repository.telenova-5.0.0.zip" data-autofocus>${esc(t('bn_kodi'))}</a>
      <a class="btn ghost" href="https://github.com/bennymat93/novatv/releases/latest" target="_blank" rel="noopener">${esc(t('bn_win'))}</a>
      <a class="btn ghost" href="${SITE}guide.html">${esc(t('bn_guide'))}</a>
    </div><p class="hint" dir="auto">${esc(t('bn_kodi_how'))}</p>`);
}

// ---------------------------------------------------------------- the title page  #/title/<movie|tv>/<id>
// One request (details + videos + credits + recommendations + ratings). The actions row keeps the id "acts" and the
// hooks of TN.addTitleAction run on it exactly as on the old sheet (sources.js adds Play there - it is loaded first,
// so Play exists on a fresh page load). The trailer frame is created only when the viewer presses Trailer.
// History: nothing is written by just looking at a title; an entry is made when something is played (the player,
// the trailer).
const openTitle = (type, id) => go('#/title/' + (type === 'tv' || type === 'series' ? 'tv' : 'movie') + '/' + encodeURIComponent(String(id)));
async function pageTitle(arg, ctx) {
  const type = ctx.rest[0] === 'tv' ? 'tv' : 'movie', id = String(ctx.rest[1] || '').replace(/[^0-9]/g, '');
  const head = page('title', N(type === 'tv' ? 'm_tv' : 'm_movies'), {back: '#/' + (type === 'tv' ? 'tv' : 'movies')});
  if (!id) { state(null, {kind: 'empty', action: {label: N('nav_home'), href: '#/'}}); return; }
  const sk = skeleton(1, 'detail');
  let d;
  try {
    d = await tmdb(`/${type}/${id}`, {append_to_response: 'videos,credits,recommendations,external_ids,' + (type === 'movie' ? 'release_dates' : 'content_ratings'),
                                      include_video_language: `${cfg.lang},en,null`});
  } catch (e) {
    if (!ctx.current()) return;
    sk.remove();
    state(null, {kind: errKind(e), title: e && e.status === 404 ? t('none') : undefined});
    return;
  }
  await loadModule('sources').catch(() => {});
  if (!ctx.current()) return;
  sk.remove();
  const title = d.title || d.name || '', year = (d.release_date || d.first_air_date || '').slice(0, 4);
  const poster = d.poster_path ? IMG + 'w342' + d.poster_path : '', kind = type === 'movie' ? 'movie' : 'series';
  const vids = (d.videos && d.videos.results) || [];
  const tr = vids.find((x) => x.site === 'YouTube' && x.type === 'Trailer') || vids.find((x) => x.site === 'YouTube');
  const mins = type === 'movie' ? d.runtime : (d.episode_run_time || [])[0];
  let cert = '';
  try {
    if (type === 'movie') { const rs = (d.release_dates.results || []); const r = rs.find((x) => x.iso_3166_1 === 'IL') || rs.find((x) => x.iso_3166_1 === 'US'); cert = ((r && r.release_dates) || []).map((x) => x.certification).find(Boolean) || ''; }
    else { const rs = (d.content_ratings.results || []); const r = rs.find((x) => x.iso_3166_1 === 'IL') || rs.find((x) => x.iso_3166_1 === 'US'); cert = (r && r.rating) || ''; }
  } catch (e) {}
  const genres = (d.genres || []).map((g) => g.name).slice(0, 3).join(', ');
  const meta = [year, mins ? mins + ' ' + N('core_min') : '', type === 'tv' && d.number_of_seasons ? N('title_seasons_n', d.number_of_seasons) : '', cert, d.vote_average ? '★ ' + Number(d.vote_average).toFixed(1) : '', genres];
  head.querySelector('h1').textContent = title;
  setTitle(title);
  if (poster) store.setArt(kind, id, poster);
  const h = hero({title, meta, text: d.overview || '', backdrop: d.backdrop_path ? IMG + SC.backdropSize(shellName) + d.backdrop_path : '', poster});
  const acts = h.acts;
  acts.id = 'acts';
  view.append(h);
  const entry = {key: type + ':' + id, label: title, thumb: poster, plot: d.overview || '', fanart: d.backdrop_path ? IMG + 'w1280' + d.backdrop_path : ''};
  if (tr) acts.append(labelButton('btn ghost', 'play', t('trailer'), () => { openTrailer(tr.key, title); noteHistory(entry); }));
  acts.append(favButton({kind, id, label: title, extra: '', img: poster}));
  const iaBox = document.createElement('div');
  acts.append(button('btn ghost', t('archive'), async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    iaBox.innerHTML = '';
    try {
      const docs = await archive({q: d.original_title || d.original_name || title, rows: 12});
      if (!docs.length) state(iaBox.appendChild(document.createElement('div')), {kind: 'empty', title: t('none'), text: N('title_ia_none'), action: null});
      else { const sc = row(t('ia'), {into: iaBox, count: docs.length}); docs.forEach((x) => sc.append(iaCard(x))); if (inputMode === 'key' || isTvShell()) focusEl(sc.firstChild); }
    } catch (err) { state(iaBox.appendChild(document.createElement('div')), {kind: errKind(err), action: null}); }
    b.disabled = false;
  }));
  try { d.imdb_id = d.imdb_id || (d.external_ids && d.external_ids.imdb_id) || ''; } catch (e) {}
  runHooks('title', acts, {type, id: String(id), title, detail: d, poster});      // e.g. the sources module's "Play"
  if (type === 'tv' && !acts.querySelector('[data-autofocus]')) {                 // (the sources module did not load: the seasons are still one press away)
    const s = linkBtn('btn', N('title_seasons'), '#/catalog/' + new URLSearchParams({m: 'tv', v: 'seasons', id}));
    s.setAttribute('data-autofocus', '');
    acts.prepend(s);
  }
  const first = acts.querySelector('[data-autofocus]') || acts.querySelector('.btn');
  if (first) { first.classList.remove('ghost'); first.setAttribute('data-autofocus', ''); }
  if (d.overview) { const p = document.createElement('p'); p.className = 'plotfull'; p.dir = 'auto'; p.textContent = d.overview; view.append(p); }
  view.append(iaBox);
  if (type === 'tv' && (d.seasons || []).length) {
    const sc = row(N('title_seasons'), {more: '#/catalog/' + new URLSearchParams({m: 'tv', v: 'seasons', id})});
    d.seasons.filter((s) => s.season_number > 0 || d.seasons.length === 1).forEach((s) => sc.append(card(s.poster_path ? tmdbImg(s.poster_path, 'auto') : poster, s.name || N('title_season_n', s.season_number),
      s.episode_count ? N('title_eps_n', s.episode_count) : '', null, '', '', {href: '#/catalog/' + new URLSearchParams({m: 'tv', v: 'episodes', id, s: String(s.season_number)}), key: 's:' + id + ':' + s.season_number})));
  }
  const cast = ((d.credits && d.credits.cast) || []).slice(0, 20);
  if (cast.length) {
    const sc = row(N('title_cast'), {shape: 'square'});
    cast.forEach((c) => sc.append(card(c.profile_path ? IMG + 'w185' + c.profile_path : '', c.name, c.character || '', null, 'square cover round', '', {href: '#/search/' + encodeURIComponent(c.name), key: 'p:' + c.id})));
  }
  const sim = ((d.recommendations && d.recommendations.results) || []).filter((r) => r.poster_path).slice(0, 20);
  if (sim.length) { const sc = row(N('title_similar')); sim.forEach((r) => sc.append(tmdbCard(Object.assign({media_type: type}, r)))); }
  const facts = [[N('title_original'), d.original_title || d.original_name], [N('title_date'), d.release_date || d.first_air_date], [N('title_genres'), (d.genres || []).map((g) => g.name).join(', ')],
                 [N('title_lang'), (d.spoken_languages || []).map((l) => l.name || l.english_name).filter(Boolean).join(', ')], [N('title_status'), d.status]].filter((f) => f[1]);
  const sec = document.createElement('section');
  sec.className = 'title-sec';
  sec.innerHTML = `<h2>${esc(N('title_details'))}</h2><dl class="facts">${facts.map((f) => `<dt>${esc(f[0])}</dt><dd dir="auto">${esc(f[1])}</dd>`).join('')}</dl><div class="links">` +
    `<a class="btn ghost" target="_blank" rel="noopener" href="https://www.themoviedb.org/${type}/${esc(id)}">TMDb</a>` +
    (d.imdb_id && /^tt\d+$/.test(d.imdb_id) ? `<a class="btn ghost" target="_blank" rel="noopener" href="https://www.imdb.com/title/${esc(d.imdb_id)}/">IMDb</a>` : '') + '</div>';
  view.append(sec);
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
                      onSettings: (v) => { synced = v || {}; }});
      try { if (typeof window.TG.on === 'function') window.TG.on(() => drawMe()); } catch (e) {}
      drawMe();
      return window.TG;
    });
    tgLoading.catch(() => { tgLoading = null; });
  }
  return tgLoading;
}
// the pairing link the build shows as a QR code: <site>/web/#pair=<api id>.<api hash>. A fragment never leaves the
// browser; it is taken out of the address bar and the history at once and kept in this browser only.
function takePair() {
  // optional extras after '&' (k=, lang=, ...) are allowed and dropped with the fragment
  const m = /^#pair=(\d{3,12})\.([0-9a-f]{32})(?:&.*)?$/i.exec(location.hash);
  if (!m) return false;
  put('tg_api', {id: m[1], hash: m[2].toLowerCase()});
  paired = true;
  try { history.replaceState({i: hIdx}, '', location.pathname + location.search + '#/settings/accounts'); } catch (e) { location.hash = '#/settings/accounts'; }
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
    if (!['favs', 'history', 'users', 'mine'].includes(p)) return;
    const a = document.activeElement;
    if (sheetOpen || popOpen || (a && a.tagName === 'INPUT' && view.contains(a))) return refreshView();
    const y = window.scrollY, key = a && view.contains(a) ? a.getAttribute('data-key') : '';
    route(true);
    window.scrollTo(0, y);
    if (key) { const el = findKey(key); if (el) focusEl(el, true); }
  }, 400);
}
function onSynced(res) { if (res.users || res.data.includes(store.current())) { refreshView(); drawMe(); } }
window.addEventListener('storage', (e) => {     // another tab of this browser changed the lists (or synced them)
  if (e.key === 'bn_synced') synced = get('synced', {}) || {};
  if (e.key && /^bn_(data_|users$|user$)/.test(e.key)) refreshView();
});

// ---------------------------------------------------------------- settings
// Groups of rows: a label (+ one line of help) at the start, the control at the end. Changes are saved at once and
// answered with a toast. Tabs: #/settings/<general | playback | accounts | data | app>.
function setRow(label, help, ctl, short) {
  const r = document.createElement('div');
  r.className = 'setrow';
  r.innerHTML = `<div class="lab"><b>${esc(label)}</b>${help ? `<small dir="auto">${esc(help)}</small>` : ''}</div><div class="ctl${short ? ' short' : ''}"></div>`;
  [].concat(ctl || []).forEach((c) => c && r.lastChild.append(c));
  return r;
}
function seg(pairs, cur, onPick, label) {
  const box = document.createElement('div');
  box.className = 'seg';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', label);
  pairs.forEach(([v, n]) => {
    const b = button('', n, () => { box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); onPick(v); });
    b.type = 'button';
    b.setAttribute('aria-pressed', v === cur ? 'true' : 'false');
    box.append(b);
  });
  return box;
}
function selectBox(pairs, cur, onPick, label) {
  const s = document.createElement('select');
  s.className = 'input';
  s.setAttribute('aria-label', label);
  pairs.forEach(([v, n]) => { const o = document.createElement('option'); o.value = v; o.textContent = n; if (v === cur) o.selected = true; s.append(o); });
  s.onchange = () => onPick(s.value);
  return s;
}
const saved = () => toast(N('core_saved'), {kind: 'ok', ms: 2000});
function setCfg(k, v) { cfg[k] = v; put('cfg', cfg); applyCfg(); emit('settings', k); saved(); }
const SET_TABS = ['general', 'playback', 'accounts', 'data', 'app'];
function pageSettings(arg) {
  const tab = SET_TABS.includes(arg) ? arg : 'general';
  page('settings');
  chips(SET_TABS.map((k) => [k, N('set_' + k)]), tab, (k) => go('#/settings/' + k));
  const group = document.createElement('div');
  group.className = 'setgroup';
  view.append(group);
  const list = (title) => { const h = document.createElement('h2'); h.textContent = title; const l = document.createElement('div'); l.className = 'setlist'; group.append(h, l); return l; };
  const note = (text) => { const p = document.createElement('p'); p.className = 'hint'; p.textContent = text; group.append(p); };
  if (tab === 'general') {
    const l = list(N('set_general'));
    l.append(setRow(t('s_lang'), '', seg([['he', 'עברית'], ['en', 'English'], ['ru', 'Русский']], cfg.lang, (v) => { cfg.lang = v; put('cfg', cfg); applyCfg(); shell(); emit('settings', 'lang'); route(true); saved(); }, t('s_lang'))));
    l.append(setRow(t('s_theme'), '', seg([['auto', t('t_auto')], ['dark', t('t_dark')], ['light', t('t_light')]], cfg.theme, (v) => setCfg('theme', v), t('s_theme'))));
    l.append(setRow(N('set_zoom'), N('set_zoom_txt'), zoomControl()));
    l.append(setRow(N('m_device'), N('set_device_txt'), seg([['auto', N('set_dev_auto')], ['tv', N('set_dev_tv')], ['phone', N('set_dev_phone')], ['desktop', N('set_dev_desktop')]],
      ['tv', 'phone', 'desktop'].includes(cfg.device) ? cfg.device : 'auto', (v) => setCfg('device', v), N('m_device'))));
    const hl = list(N('set_home_rows'));
    hl.classList.add('homerows');
    const drawRows = () => {
      hl.innerHTML = '';
      const rows = SC.homeRows(get('home_rows', null));
      const save = (next) => { put('home_rows', next); drawRows(); };
      rows.forEach((r, i) => {
        const el = document.createElement('div');
        el.className = 'hr-row';
        el.innerHTML = `<b>${esc(N('hr_' + r.id))}</b>`;
        const sw = document.createElement('input');
        sw.type = 'checkbox'; sw.className = 'switch'; sw.setAttribute('role', 'switch'); sw.checked = r.on; sw.setAttribute('aria-label', N('hr_' + r.id));
        sw.onchange = () => save(rows.map((x) => (x.id === r.id ? {id: x.id, on: sw.checked} : x)));
        const up = iconButton('iconbtn', 'up', N('set_up') + ': ' + N('hr_' + r.id), () => { save(SC.moveRow(rows, r.id, -1)); const b = hl.children[Math.max(0, i - 1)]; if (b) focusEl(b.querySelector('.iconbtn:not([disabled])') || b.querySelector('input'), true); });
        const down = iconButton('iconbtn', 'down', N('set_down') + ': ' + N('hr_' + r.id), () => { save(SC.moveRow(rows, r.id, 1)); const b = hl.children[Math.min(rows.length - 1, i + 1)]; if (b) focusEl(b.querySelectorAll('.iconbtn:not([disabled])')[1] || b.querySelector('.iconbtn:not([disabled])') || b.querySelector('input'), true); });
        up.disabled = i === 0; down.disabled = i === rows.length - 1;
        el.append(up, down, sw);
        hl.append(el);
      });
    };
    drawRows();
    note(N('set_home_rows_txt'));
  } else if (tab === 'playback') {
    const l = list(N('set_playback'));
    l.append(setRow(t('s_live'), '', selectBox(Object.entries(t('lists')), cfg.live, (v) => setCfg('live', v), t('s_live'))));
    l.append(setRow(t('s_radio'), '', selectBox(Object.entries(t('countries')), cfg.radio, (v) => setCfg('radio', v), t('s_radio'))));
    l.append(setRow(t('s_family'), t('s_family_txt'), null));
    const m = list(N('set_more'));
    m.append(setRow(N('m_library'), N('ms_library'), linkBtn('btn ghost', N('core_open'), '#/library'), true));
    m.append(setRow(N('m_services'), N('ms_services'), linkBtn('btn ghost', N('core_open'), '#/services'), true));
  } else if (tab === 'accounts') {
    const me = store.live().find((u) => u.id === store.current());
    const l = list(N('set_accounts'));
    l.append(setRow(X('s_user'), me ? userName(me) : '', linkBtn('btn ghost', N('m_users'), '#/users'), true));
    const fromAccount = !cfg.tmdb && (synced.tmdb_key || synced.tmdb_token);
    const box = document.createElement('div');
    box.className = 'secret';
    box.innerHTML = `<input class="input" id="s_tmdb" type="password" autocomplete="off" spellcheck="false" dir="ltr" aria-label="${esc(X('tmdb'))}">`;
    const inp = box.firstChild;
    inp.value = cfg.tmdb || '';
    inp.onchange = () => { cfg.tmdb = inp.value.trim(); put('cfg', cfg); emit('settings', 'tmdb'); saved(); };
    box.append(iconButton('iconbtn', 'eye', N('set_show'), () => { inp.type = inp.type === 'password' ? 'text' : 'password'; }));
    l.append(setRow(X('tmdb'), X('tmdb_hint') + (fromAccount ? ' ' + X('s_tmdb_synced') : ''), box));
    l.append(setRow(N('m_services'), N('ms_services'), linkBtn('btn ghost', N('core_open'), '#/services'), true));
    group.insertAdjacentHTML('beforeend', `<h2>${esc(X('tg_title'))}</h2><div class="panel settings tgpanel" style="margin-top:0"><p class="hint">${esc(X('tg_about'))}</p><div id="tgui"></div></div>`);
    drawTgBox();
    note(X('s_store2'));
  } else if (tab === 'data') {
    const l = list(N('set_data'));
    const wipe = (title, q, run) => labelButton('btn ghost danger', 'trash', N('core_delete'), async () => {
      if (!(await confirmBox({title, text: q, ok: N('core_delete'), danger: true}))) return;
      run();
      toast(X('done'), {kind: 'ok'});
    });
    l.append(setRow(t('s_clear'), '', wipe(t('s_clear'), N('core_favs_clear_q'), () => { store.clearFavs(); emit('favs', null); }), true));
    l.append(setRow(X('hist_clear'), '', wipe(X('hist_clear'), N('core_hist_clear_q'), () => store.clearHistory()), true));
    l.append(setRow(X('sh_clear'), '', wipe(X('sh_clear'), N('core_sh_clear_ask'), () => store.clearSearches()), true));
    const m = list(N('set_more'));
    m.append(setRow(N('m_backup'), N('ms_backup'), linkBtn('btn ghost', N('core_open'), '#/backup'), true));
    m.append(setRow(N('m_gdrive'), N('ms_gdrive'), linkBtn('btn ghost', N('core_open'), '#/gdrive'), true));
    note(X('s_store2'));
  } else {
    const l = list(N('set_app'));
    const isIn = standalone();
    l.append(setRow(X('install'), isIn ? N('pwa_installed') : installEvt ? N('pwa_txt') : IOS ? N('pwa_ios') : N('pwa_manual'),
      installEvt && !isIn ? labelButton('btn', 'install', X('install'), () => { installNow(); route(true); }) : null, true));
    l.append(setRow(N('core_version', WEB_VERSION), N('core_sw', N(navigator.serviceWorker && navigator.serviceWorker.controller ? 'core_sw_on' : 'core_sw_off')), linkBtn('btn ghost', N('m_about'), '#/about'), true));
    l.append(setRow(N('m_help'), N('ms_help'), linkBtn('btn ghost', N('core_open'), '#/help'), true));
    l.append(setRow(N('m_status'), N('ms_status'), linkBtn('btn ghost', N('core_open'), '#/status'), true));
  }
}

// ---------------------------------------------------------------- search box: a combobox with history and suggestions (the build's searchhist.py)
// nothing typed = the latest searches; while typing = earlier searches that contain the text, then catalogue titles
// (TMDb, the best known first). Choosing one searches for it. Only what is searched is remembered, never what is typed.
// Keys: Down / Up move inside the list, Enter searches, Escape closes the list, then clears the field.
// Phone: the search icon of the title bar opens the field as a full-screen layer, so the keyboard never covers the list.
const sug = $('#sug'), qEl = $('#q');
let sugTimer = null, sugSeq = 0, sugAt = -1;
const sugItems = () => Array.from(sug.querySelectorAll('.sugitem[role="option"]'));
function sugMark(i) {
  const items = sugItems();
  sugAt = items.length ? Math.max(-1, Math.min(i, items.length - 1)) : -1;
  items.forEach((b, n) => b.setAttribute('aria-selected', n === sugAt ? 'true' : 'false'));
  if (sugAt >= 0) { qEl.setAttribute('aria-activedescendant', items[sugAt].id); try { items[sugAt].scrollIntoView({block: 'nearest'}); } catch (e) {} }
  else qEl.removeAttribute('aria-activedescendant');
}
function hideSug() { sugSeq++; clearTimeout(sugTimer); sug.hidden = true; sug.replaceChildren(); sugAt = -1; qEl.setAttribute('aria-expanded', 'false'); qEl.removeAttribute('aria-activedescendant'); }
function closeSearchLayer() { HTML.classList.remove('searching'); hideSug(); }
function doSearch(q) {
  q = store.clean(q);
  if (!q) return;
  store.addSearch(q);
  closeSearchLayer();
  qEl.blur();
  go('#/search/' + encodeURIComponent(q));
}
function drawSug(rows, typed) {
  sug.replaceChildren();
  rows.forEach(([q, src], i) => {
    const row1 = document.createElement('div');
    row1.className = 'sugrow';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sugitem'; b.dir = 'auto'; b.id = 'sug_' + i; b.tabIndex = -1;
    b.setAttribute('role', 'option'); b.setAttribute('aria-selected', 'false');
    b.innerHTML = icon(src === 'history' ? 'searchhist' : 'search') + '<span>' + esc(q) + '</span>';
    b.onclick = () => doSearch(q);
    row1.append(b);
    if (src === 'history') {
      const x = iconButton('sugx', 'close', X('sh_remove') + ': ' + q, () => { store.removeSearch(q); qEl.focus(); refreshSug(); });
      x.tabIndex = -1;
      row1.append(x);
    }
    sug.append(row1);
  });
  if (!typed && rows.length) {
    const c = button('sugitem sugclear', X('sh_clear'), () => { store.clearSearches(); hideSug(); qEl.focus(); });
    c.type = 'button'; c.tabIndex = -1;
    sug.append(c);
  }
  sug.hidden = !rows.length;
  qEl.setAttribute('aria-expanded', rows.length ? 'true' : 'false');
  sugAt = -1;
  qEl.removeAttribute('aria-activedescendant');
}
function refreshSug() {
  const text = qEl.value, typed = store.clean(text), mine = store.match(store.searches(), text);
  drawSug(store.mergeSuggest(mine, [], text), typed);
  clearTimeout(sugTimer);
  const seq = ++sugSeq;
  if (Array.from(typed).length < 2 || !tmdbKey()) return;
  sugTimer = setTimeout(() => {
    tmdb('/search/multi', {query: typed, include_adult: 'false'}).then((d) => {
      if (seq !== sugSeq || document.activeElement !== qEl) return;        // the viewer typed on, or moved away
      const at = sugAt;
      drawSug(store.mergeSuggest(mine, store.titlesOf(d.results, text), text), typed);
      if (at >= 0) sugMark(at);
    }).catch(() => {});
  }, 250);
}
qEl.addEventListener('focus', refreshSug);
qEl.addEventListener('input', refreshSug);
$('#search').addEventListener('focusout', () => { setTimeout(() => { if (!$('#search').contains(document.activeElement) && !HTML.classList.contains('searching')) hideSug(); }, 200); });
qEl.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (sug.hidden) { if (e.key === 'ArrowDown' && !isTvShell()) { refreshSug(); if (!sug.hidden) { e.preventDefault(); e.stopPropagation(); } } return; }   // (nothing to show: the arrows move the focus)
    const n = sugItems().length;
    if (e.key === 'ArrowUp' && sugAt < 0) { hideSug(); return; }
    if (e.key === 'ArrowDown' && sugAt >= n - 1) { e.preventDefault(); e.stopPropagation(); return; }
    e.preventDefault(); e.stopPropagation();
    sugMark(sugAt + (e.key === 'ArrowDown' ? 1 : -1));
  } else if (e.key === 'Enter' && sugAt >= 0 && !sug.hidden) {
    const b = sugItems()[sugAt];
    if (b) { e.preventDefault(); b.click(); }
  } else if (e.key === 'Escape') {
    e.stopPropagation();
    if (!sug.hidden) hideSug();
    else if (qEl.value) qEl.value = '';
    else { closeSearchLayer(); qEl.blur(); }
  }
});
$('#search').onsubmit = (e) => { e.preventDefault(); doSearch(qEl.value); };
$('#sopen').onclick = () => { HTML.classList.add('searching'); qEl.focus(); refreshSug(); };
$('#sclose').onclick = () => { closeSearchLayer(); qEl.value = ''; focusEl($('#sopen'), true); };

// ---------------------------------------------------------------- 5.x: module registry (see MODULES.md)
// Each package's file is a plain script (no build step) that calls TN.registerPage / TN.registerProvider. A module is
// loaded the first time one of its pages is opened, or when its providers are asked for (TN.providers(kind)).
// name -> {pages: page keys it draws, kinds: provider kinds it registers}. Module names are file names without '.js'.
const MODULES = {
  tglogin: {pages: ['tglogin'], kinds: []},                                     // WP-1
  matcher: {pages: [], kinds: []}, epmatch: {pages: [], kinds: []},             // WP-2 (libraries)
  tgsearch: {pages: [], kinds: ['search', 'source']}, telegram: {pages: ['telegram'], kinds: []},
  tgplay: {pages: [], kinds: ['service']},                                      // WP-3
  catalog: {pages: ['movies', 'tv', 'catalog'], kinds: []},                     // WP-4
  sources: {pages: [], kinds: ['service']}, player: {pages: [], kinds: ['service']}, rd: {pages: [], kinds: ['source']},     // WP-5
  srt: {pages: [], kinds: []}, subs: {pages: [], kinds: ['subs']},             // WP-6
  compat: {pages: [], kinds: ['service']},                                      // 5.1: MKV / HEVC / AC3 / DTS through vendor/avplayer
  iptv: {pages: ['live'], kinds: ['search']}, epg: {pages: [], kinds: ['service']}, radio: {pages: ['radio'], kinds: ['search']},   // WP-7
  yt: {pages: ['youtube'], kinds: ['search', 'source']}, topics: {pages: ['topics'], kinds: []}, hub: {pages: ['hub', 'search'], kinds: ['search']},   // WP-8
  services: {pages: ['services', 'device'], kinds: []}, library: {pages: ['library'], kinds: []}, backup: {pages: ['backup'], kinds: []},            // WP-9
  gdrive: {pages: ['gdrive'], kinds: ['service']}, help: {pages: ['help'], kinds: []}, status: {pages: ['status'], kinds: []},
};
const MODULE_OF = {};
for (const [m, d] of Object.entries(MODULES)) for (const p of d.pages) MODULE_OF[p] = m;
const PAGES = {}, PROVIDERS = new Map(), HOOKS = {title: [], history: []}, LISTENERS = {};
const modState = {};                                   // name -> promise of its load (dropped when the load failed: it may be tried again)
let routeSeq = 0, rerouteTimer = null;
function rerouteSoon(key) {                            // a page arrived late: draw it, if it is the one on the screen
  clearTimeout(rerouteTimer);
  rerouteTimer = setTimeout(() => { if ((location.hash.split('/')[1] || '') === key) route(true); }, 0);
}
function registerPage(key, render, opts = {}) {
  if (!/^[a-z][a-z0-9_]*$/.test(key) || typeof render !== 'function') throw new Error('registerPage: bad key or render');
  const was = PAGES[key];
  PAGES[key] = {render, stub: false, title: opts.title || ''};
  if (was && was.stub) rerouteSoon(key);
}
function registerProvider(name, impl) {
  if (!/^[a-z][a-z0-9_]*$/.test(name) || !impl || typeof impl !== 'object') throw new Error('registerProvider: bad name or impl');
  impl.name = name;
  impl.kinds = [].concat(impl.kinds || impl.kind || []);
  PROVIDERS.set(name, impl);
  emit('provider', impl);
}
function loadModule(name) {
  if (!MODULES[name]) return Promise.reject(new Error('unknown module ' + name));
  if (!modState[name]) {
    const p = loadScript(name + '.js');
    modState[name] = p;
    p.catch(() => { if (modState[name] === p) delete modState[name]; });
  }
  return modState[name];
}
// the Library's switches (browser setting providers_off). A switch may stand for several providers: 'hub' covers
// dailymotion / tmdb / archive, 'subs' covers every subtitle provider (SC.PROVIDER_GROUP).
const providerOn = (name) => SC.providerOnIn(cfg.providers_off, name);
async function providers(kind) {
  await Promise.all(Object.entries(MODULES).filter(([, d]) => d.kinds.includes(kind)).map(([m]) => loadModule(m).catch(() => {})));
  return [...PROVIDERS.values()].filter((p) => p.kinds.includes(kind) && providerOn(p.name));
}
async function provider(name) {
  if (!PROVIDERS.has(name) && MODULES[name]) await loadModule(name).catch(() => {});
  return PROVIDERS.get(name) || null;
}
function on(ev, fn) { (LISTENERS[ev] = LISTENERS[ev] || []).push(fn); return () => { LISTENERS[ev] = (LISTENERS[ev] || []).filter((f) => f !== fn); }; }
function emit(ev, data) { for (const fn of (LISTENERS[ev] || []).slice()) { try { fn(data); } catch (e) {} } }
function runHooks(name, ...args) { for (const fn of HOOKS[name]) { try { fn(...args); } catch (e) {} } }
const pageName = (key) => (key && I18N.has('m_' + key) ? N('m_' + key) : '');
// a page that threw or whose request failed: the half-drawn view is cleared, then "could not load" with one button.
// No connection reads "No connection", a missing TMDb key reads "add a key" - never "Nothing found".
function failPage(key, e) {
  page('', pageName(key) || pageTitleText);
  state(null, {kind: errKind(e), text: errKind(e) === 'error' ? N('core_load_fail') : undefined});
}
function stubPage(key) {
  return () => {
    page('', pageName(key));
    view.insertAdjacentHTML('beforeend', `<div class="panel soonpanel"><span class="tag">${esc(N('core_soon'))}</span><p>${esc(N('core_soon_txt'))}</p>` +
      `<div class="links"><a class="btn ghost" href="#/bn" data-autofocus>${esc(N('m_bn'))}</a></div></div>`);
  };
}
// the pages app.js draws itself (a module's registerPage may replace one)
const builtin = (key, render) => { PAGES[key] = {render, stub: false}; };
builtin('menu', () => pageMenu()); builtin('mine', (a) => pageMine(a)); builtin('title', (a, ctx) => pageTitle(a, ctx));
builtin('favs', () => pageFavs()); builtin('history', () => pageHistory()); builtin('users', () => pageUsers()); builtin('bn', () => pageBn());
builtin('settings', (a) => pageSettings(a)); builtin('searchhist', () => pageSearchHist()); builtin('about', () => pageAbout());
// every other page belongs to a module: a placeholder until its file registered it
for (const k of [...MENU.map((m) => m[0]), ...Object.keys(MODULE_OF)]) if (!PAGES[k]) PAGES[k] = {render: stubPage(k), stub: true};

// search history (the build's searchhist.py): every search, remove one, clear all
function pageSearchHist() {
  const all = store.searches();
  const clear = labelButton('btn ghost', 'trash', N('core_sh_clear'), async () => {
    if (!(await confirmBox({title: N('core_sh_clear'), text: N('core_sh_clear_ask'), ok: N('core_delete'), danger: true}))) return;
    store.clearSearches();
    pageSearchHist();
    toast(X('done'), {kind: 'ok'});
  });
  page('searchhist', '', {actions: all.length ? [clear] : []});
  if (!all.length) { state(null, {kind: 'empty', title: N('m_searchhist'), text: N('core_sh_none'), action: {label: N('nav_search'), href: '#/hub'}}); return; }
  const box = document.createElement('div');
  box.className = 'hlist';
  all.forEach((q) => {
    const row1 = document.createElement('div');
    row1.className = 'shrow';
    const goBtn = document.createElement('button');
    goBtn.type = 'button'; goBtn.className = 'hrow'; goBtn.dir = 'auto';
    goBtn.setAttribute('data-key', 'q:' + q);
    goBtn.innerHTML = icon('searchhist') + '<span class="htxt"><b>' + esc(q) + '</b></span>';
    goBtn.onclick = () => doSearch(q);
    const x = iconButton('iconbtn', 'close', N('core_sh_remove') + ': ' + q, () => {
      store.removeSearch(q);
      pageSearchHist();
      toast(N('core_sh_removed'), {action: {label: N('core_undo'), onClick: () => { store.addSearch(q); if (hereNow().key === 'searchhist') pageSearchHist(); }}});
    });
    row1.append(goBtn, x);
    box.append(row1);
  });
  view.append(box);
}
// about / version / update app / clear cache (replaces Kodi settings + System update, plan rows 1, 46, 48)
async function clearCaches() {
  try { for (const k of await caches.keys()) await caches.delete(k); } catch (e) {}
  emit('clearcache', null);
}
let swAsked = false;
function pageAbout() {
  page('about');
  const swOn = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  view.insertAdjacentHTML('beforeend', `<div class="panel settings"><p>${esc(N('core_about_txt'))}</p>
    <div class="row"><b>${esc(N('core_version', WEB_VERSION))}</b><span>${esc(N('core_sw', N(swOn ? 'core_sw_on' : 'core_sw_off')))}</span></div>
    <div class="links" id="ab_acts"></div><span id="ab_done" class="hint" role="status"></span>
    <div class="links"><a class="btn ghost" href="${SITE}guide.html">${esc(N('core_guide'))}</a><a class="btn ghost" href="${SITE}privacy.html">${esc(N('core_privacy'))}</a></div></div>
    <p class="foot">${esc(N('core_legal', WEB_VERSION))}</p>`);
  const say = (k) => { $('#ab_done').textContent = N(k); };
  const upd = button('btn', N('core_update'), async () => {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration().catch(() => null);
    if (!reg) { say('core_update_none'); return; }
    await reg.update().catch(() => {});
    const w = reg.waiting || reg.installing;
    if (!w) { say('core_update_none'); return; }
    say('core_update_got');
    swAsked = true;
    const ask = () => { try { w.postMessage({type: 'SKIP_WAITING'}); } catch (e) {} };
    if (w.state === 'installed') ask(); else w.addEventListener('statechange', () => { if (w.state === 'installed') ask(); });
    setTimeout(() => location.reload(), 4000);       // (an older worker that never answers: the reload still brings the new files)
  });
  upd.setAttribute('data-autofocus', '');
  $('#ab_acts').append(upd, button('btn ghost', N('core_clear_cache'), async () => { await clearCaches(); say('core_cleared'); setTimeout(() => location.reload(), 800); }));
}

// the one object every module uses (frozen: modules add to it only through the functions)
const hereNow = () => { const [, p = '', ...rest] = location.hash.split('/'); let a = rest.join('/'); try { a = decodeURIComponent(a); } catch (e) {} return {key: p, arg: a, rest}; };
// go(hash): while a sheet is open (or is just being closed) the sheet's history entry is taken away first, so the
// new page does not land on top of it
function go(hash) {
  hash = String(hash || '');
  hash = hash.startsWith('#') ? hash : '#/' + hash;
  if (sheetPopPending) { pendingNav = hash; return; }
  if (sheetOpen && history.state && history.state.sheet) { pendingNav = hash; closeModal(); return; }
  location.hash = hash;
}
// 5.1, weak connections - one tuning for every HLS stream of the site (live channels here and in iptv.js; the film
// player has the same values): start from what this device's line gave last time (1 Mbit/s when nothing is known,
// never the top level first), go up carefully and down quickly, hold a long buffer, ask again for a segment that did
// not arrive. hlsWatch keeps the measured speed and, after three waits within a minute, caps the picture one level
// lower for that stream - a lower picture that keeps playing is better than a sharp one that stops.
function hlsCfg(extra) {
  let last = 0;
  try { last = Number(get('net_bw', 0)) || 0; } catch (e) { /* nothing kept */ }
  return Object.assign({enableWorker: true, capLevelToPlayerSize: true, startLevel: -1,
    abrEwmaDefaultEstimate: Math.max(300000, Math.min(last || 1000000, 8000000)), abrBandWidthFactor: 0.8, abrBandWidthUpFactor: 0.6,
    maxBufferLength: 60, maxMaxBufferLength: 180, backBufferLength: 30, maxBufferHole: 0.5, nudgeMaxRetry: 12,
    fragLoadingMaxRetry: 8, fragLoadingRetryDelay: 800, fragLoadingMaxRetryTimeout: 16000,
    manifestLoadingMaxRetry: 4, manifestLoadingRetryDelay: 800, levelLoadingMaxRetry: 6, levelLoadingRetryDelay: 800}, extra || {});
}
function hlsWatch(h, onLower) {
  const Hls = window.Hls;
  if (!h || !Hls) return;
  let n = 0, stalls = [];
  h.on(Hls.Events.FRAG_BUFFERED, () => { if (++n % 5) return; try { const b = Math.round(h.bandwidthEstimate || 0); if (b > 50000) put('net_bw', b); } catch (e) { /* not kept */ } });
  h.on(Hls.Events.ERROR, (ev, d) => {
    if (!d || d.fatal || d.details !== 'bufferStalledError') return;
    const now = Date.now();
    stalls = stalls.filter((x) => now - x < 60000); stalls.push(now);
    if (stalls.length < 3 || !h.levels || h.levels.length < 2 || !h.autoLevelEnabled) return;
    const cur = h.currentLevel >= 0 ? h.currentLevel : h.loadLevel;
    if (cur > 0) { h.autoLevelCapping = cur - 1; stalls = []; if (onLower) { try { onLower(); } catch (e) { /* the note is optional */ } } }
  });
}
const TN = Object.freeze({
  hlsCfg, hlsWatch,
  version: WEB_VERSION,
  // registry
  registerPage, registerProvider, providers, provider, providerOn,
  setProviderOn(name, onOff) { const off = new Set(cfg.providers_off || []); if (onOff) off.delete(name); else off.add(name); cfg.providers_off = [...off]; put('cfg', cfg); emit('providers', null); },
  load: loadModule,
  addTitleAction(fn) { HOOKS.title.push(fn); },
  addHistoryHandler(fn) { HOOKS.history.push(fn); },
  on, emit,
  // texts
  i18n: I18N, t: N, lang: () => cfg.lang, rtl: () => cfg.lang === 'he',
  // storage: per browser (bn_ prefix, JSON); the user's synced lists are in store
  get, put, drop, store, SyncDoc: SD, WebSync: WS,
  // settings: this browser's (cfg) and the account's synced ones (read only here)
  settings: Object.freeze({
    get: (k, d) => (k in cfg ? cfg[k] : d),
    set(k, v) { cfg[k] = v; put('cfg', cfg); applyCfg(); emit('settings', k); },
    synced: () => Object.assign({}, synced),
    // the helper Worker is built in: the project's own deployment (worker/) unless the viewer typed another address
    helper: () => httpsOnly(String(cfg.helper || 'https://telenova-helper.hmi-analyzer.workers.dev').replace(/\/+$/, '')),
  }),
  // HTML / UI helpers
  esc, $, button, card, section, page, chips, skeleton, empty, modal, closeModal, favButton, cssUrl, paint, httpsOnly, kodiOnly,
  view: () => view,
  loadScript,
  // 5.0 interface: icons, rows, hero, states, toasts, confirmation, context menu, the player stage
  icon, row, hero, state, toast, confirm: confirmBox, menu, playerHost, announce, copy: copyText, bdi: bdis,
  shell: () => shellName, input: () => inputMode, focus: (el) => focusEl(el), setTitle,
  // router
  go,
  route: () => route(true),
  here: hereNow,
  params: (arg) => Object.fromEntries(new URLSearchParams(arg || '')),
  link: (key, params) => '#/' + key + (params ? '/' + (typeof params === 'string' ? encodeURIComponent(params) : new URLSearchParams(params)) : ''),
  back: () => goBack(),
  // catalogue
  tmdb, tmdbLang, tmdbImg, hasTmdbKey: () => !!tmdbKey(),
  openTitle, openArchive, openChannel, playRadio, stopRadio, archive, channels, stations, doSearch,
  noteHistory,
  // Telegram (tg.js is loaded on demand: TN.tg() -> window.TG)
  tg: () => loadTg(),
  clearCaches,
});
self.TN = TN;

// ---------------------------------------------------------------- shell
// The layout shell is chosen here and written to <html data-shell>: the device setting when it names one, else 'tv'
// for a TV browser, else by the window width (phone < 600 <= tablet < 1024 <= desktop). CSS is keyed on it.
function applyCfg() {
  if (cfg.theme === 'auto') HTML.removeAttribute('data-theme');
  else HTML.setAttribute('data-theme', cfg.theme);
  I18N.setLang(cfg.lang);
  applyZoom();
  HTML.lang = cfg.lang;
  HTML.dir = cfg.lang === 'he' ? 'rtl' : 'ltr';
  // device profile (plan row 49): 'auto' goes back to what the browser says; never synced (Kodi 4.2.3 rule)
  const dev = ['tv', 'phone', 'desktop'].includes(cfg.device) ? cfg.device : 'auto';
  shellName = SC.pickShell(dev, IS_TV, window.innerWidth || HTML.clientWidth);
  HTML.setAttribute('data-shell', shellName);
  for (const c of ['phone', 'desktop']) HTML.classList.toggle(c, dev === c);
  HTML.classList.toggle('tv', shellName === 'tv');
  let light = cfg.theme === 'light';
  try { if (cfg.theme === 'auto') light = matchMedia('(prefers-color-scheme: light)').matches; } catch (e) {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', light ? '#f4f5f8' : '#0b0d12');
}
const navLabel = (k) => (k === '' ? N('nav_home') : k === 'hub' ? N('nav_search') : k === 'menu' ? N('nav_more') : k === 'mine' ? N('nav_mine') : N('m_' + k));
function drawMe() {
  const me = store.live().find((u) => u.id === store.current()), name = me ? userName(me) : '';
  const av = $('#avatar'), dot = $('#medot');
  if (av) { if (initial(name)) av.textContent = initial(name); else av.innerHTML = icon('user'); }
  $('#me').setAttribute('aria-label', N('m_users') + (name ? ': ' + name : ''));
  $('#me').title = name;
  let st = '';
  try { if (window.TG && window.TG.ready) st = window.TG.state(); } catch (e) {}
  if (dot) { dot.hidden = !st || st === 'off'; dot.className = 'dot' + (st === 'on' ? ' on' : st === 'connecting' || st === 'login' ? ' busy' : st ? ' err' : ''); }
}
function shell() {
  HTML.lang = cfg.lang;
  HTML.dir = cfg.lang === 'he' ? 'rtl' : 'ltr';
  qEl.placeholder = t('search');
  qEl.setAttribute('aria-label', N('nav_search'));
  $('#skip').textContent = N('core_skip');
  const rail = $('#rail'), tabs = $('#tabs');
  rail.setAttribute('aria-label', N('nav_main'));
  tabs.setAttribute('aria-label', N('nav_main'));
  let seps = 0;
  rail.innerHTML = '<a class="rail-brand" href="#/" tabindex="-1" aria-hidden="true"><img src="icon.png" alt="" width="32" height="32"><span>BN Stream</span></a>' +
    SC.RAIL.map((it) => (it ? `<a class="rail-i" href="#/${it[0]}" data-p="${it[0]}" title="${esc(navLabel(it[0]))}">${icon(it[1])}<span>${esc(navLabel(it[0]))}</span></a>`
      : seps++ ? '<i class="rail-sp"></i>' : '<i class="rail-sep"></i>')).join('') +
    `<a class="rail-i rail-me" href="#/users" data-p="users" title="${esc(N('m_users'))}">${icon('user')}<span>${esc(N('m_users'))}</span></a>`;
  tabs.innerHTML = SC.TABS.map((it) => `<a class="tab" href="#/${it[0]}" data-p="${it[0]}">${icon(it[1])}<span>${esc(navLabel(it[0]))}</span></a>`).join('');
  const hb = $('#hback');
  hb.innerHTML = icon('back'); hb.setAttribute('aria-label', N('core_back'));
  const so = $('#sopen'), sc = $('#sclose');
  so.innerHTML = icon('search'); so.setAttribute('aria-label', N('nav_search'));
  sc.innerHTML = icon('close'); sc.setAttribute('aria-label', N('core_close'));
  $('#brand').setAttribute('aria-label', N('nav_home'));
  closeBtn.setAttribute('aria-label', N('core_close'));
  $('#netbar').textContent = N('core_offline');
  drawMe();
  const h = hereNow();
  markNav(h.key, h.arg);
}
function markNav(p, a) {
  const mark = (sel, items) => {
    const own = SC.navOwner(p, a, items);
    document.querySelectorAll(sel).forEach((el) => {
      const onIt = el.getAttribute('data-p') === own && !(sel === '#rail .rail-i' && el.classList.contains('rail-me') && own !== 'users');
      el.classList.toggle('on', onIt);
      if (onIt) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
  };
  mark('#rail .rail-i', SC.RAIL.filter(Boolean).concat([['users', 'user']]));
  mark('#tabs .tab', SC.TABS);
}

// ---------------------------------------------------------------- router
// Every history entry of this visit carries an index (history.state.i). Leaving a page stores its scroll position and
// the focused item under that index; coming back with Back / Forward restores both once the page is drawn again
// (Design Rule 25). A new page starts at the top, with the focus on its first item when the last input was a key
// or the shell is TV - never on the back link, never on a skeleton.
const hSaved = {};
let lastHash = location.hash, pendingAfter = null;
try { history.scrollRestoration = 'manual'; } catch (e) {}
{
  const st = history.state;
  if (st && typeof st.i === 'number') { hIdx = st.i; if (st.sheet) { try { history.replaceState({i: hIdx}, ''); } catch (e) {} } }
  else { try { history.replaceState({i: 0}, ''); } catch (e) {} }
}
function findKey(key) {
  if (!key) return null;
  for (const el of view.querySelectorAll('[data-key]')) if (el.getAttribute('data-key') === key) return shown(el) ? el : null;
  return null;
}
function saveEntry() {
  const a = document.activeElement, inView = !!a && view.contains(a);
  hSaved[hIdx] = {hash: lastHash, y: window.scrollY || 0, key: inView ? a.getAttribute('data-key') || '' : '',
                  idx: inView ? Array.from(view.querySelectorAll(FOCUSABLE)).indexOf(a) : -1};
}
// fn() is tried now and after each change of the view, until it says true, the page changes, the viewer acts, or
// `ms` passed (then one last try with `last` = true)
function tryUntil(fn, ms) {
  const seq = routeSeq;
  if (fn(false)) return;
  let timer = null, stop = null;
  const end = () => { if (mo) mo.disconnect(); clearTimeout(timer); clearTimeout(stop); document.removeEventListener('keydown', cancel, true); document.removeEventListener('pointerdown', cancel, true); document.removeEventListener('wheel', cancel, true); document.removeEventListener('touchmove', cancel, true); };
  const cancel = () => end();
  const run = (last) => { if (seq !== routeSeq) return end(); if (fn(last) || last) end(); };
  const mo = 'MutationObserver' in window ? new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => run(false), 80); }) : null;
  if (mo) mo.observe(view, {childList: true, subtree: true});
  stop = setTimeout(() => run(true), ms);
  document.addEventListener('keydown', cancel, true);
  document.addEventListener('pointerdown', cancel, true);
  document.addEventListener('wheel', cancel, {capture: true, passive: true});
  document.addEventListener('touchmove', cancel, {capture: true, passive: true});
}
function firstTarget() {
  const auto = view.querySelector('[data-autofocus]');
  if (auto && shown(auto)) return auto;
  for (const el of view.querySelectorAll(FOCUSABLE)) {
    if (el.tabIndex < 0 || el.closest('.pagehead') || el.closest('.skel') || el.classList.contains('more')) continue;
    if (shown(el)) return el;
  }
  return null;
}
function afterRender() {
  const info = pendingAfter;
  pendingAfter = null;
  if (!info) return;
  const s = info.restore;
  if (s) {
    tryUntil((last) => {
      const el = s.key ? findKey(s.key) : null, tall = HTML.scrollHeight >= s.y + window.innerHeight * 0.6 || s.y < 40;
      if (!last && ((s.key && !el) || !tall || view.querySelector('.skelgrid'))) return false;
      window.scrollTo(0, s.y);
      const target = el || (s.idx >= 0 && !s.key ? Array.from(view.querySelectorAll(FOCUSABLE))[s.idx] : null);
      if (target && shown(target) && (inputMode === 'key' || isTvShell())) focusEl(target, true);
      return true;
    }, 5000);
  } else if (inputMode === 'key' || isTvShell()) {
    tryUntil((last) => {
      if (!last && view.querySelector('.skelgrid')) return false;
      const a = document.activeElement;
      if (a && a !== document.body && view.contains(a)) return true;       // the page already put the focus somewhere
      const el = firstTarget();
      if (!el) return false;
      focusEl(el);
      return true;
    }, 4000);
  } else if (info.nav) { try { view.focus({preventScroll: true}); } catch (e) {} }
}
function route(keep) {
  if (takePair()) return route();
  if (keep !== true) { closeModal(); closePop(); closeSearchLayer(); }
  const here = hereNow(), p = here.key, a = here.arg;
  markNav(p, a);
  if (p !== 'search') qEl.value = '';
  const seq = ++routeSeq;
  const ctx = {key: p, arg: a, rest: here.rest.slice(), view, keep: keep === true, current: () => seq === routeSeq};
  $('#top').classList.toggle('sub', !!p);
  const hb = $('#hback');
  hb.hidden = !p;
  hb.setAttribute('href', SC.backHash(p, a));
  homeHero = null;
  HTML.classList.remove('hdr-hide');
  const pg = p ? PAGES[p] : {render: pageHome};
  let done = null, real = true;
  if (!pg) {
    page('', N('core_notfound'));
    state(null, {kind: 'empty', title: N('core_notfound'), text: N('core_notfound_txt'), action: {label: N('nav_home'), href: '#/'}});
  } else if (pg.stub && MODULE_OF[p]) {       // its module draws this page: load it, then draw (the registration re-routes)
    real = false;
    page('', pageName(p));
    skeleton(6);
    loadModule(MODULE_OF[p]).then(() => {
      if (seq !== routeSeq) return;
      if (PAGES[p].stub) { PAGES[p].render(a, ctx); afterRender(); } else rerouteSoon(p);
    }, (e) => { if (seq === routeSeq) { failPage(p, e); afterRender(); } });
  } else {
    try {
      const r = pg.render(a, ctx);
      if (r && r.then) done = r.then(null, (e) => { if (seq === routeSeq) failPage(p, e); });
    } catch (e) { failPage(p, e); }
  }
  if (keep !== true && !(pendingAfter && pendingAfter.restore)) window.scrollTo(0, 0);
  const bh = view.querySelector('.backbtn');
  if (bh && hb.getAttribute('href') !== bh.getAttribute('href')) hb.setAttribute('href', bh.getAttribute('href'));
  emit('route', ctx);
  if (real) Promise.resolve(done).then(() => { if (seq === routeSeq) afterRender(); });
}
function onHash() {
  const st = history.state;
  saveEntry();
  let restore = null;
  if (st && typeof st.i === 'number') {       // Back / Forward to an entry of this visit
    if (st.sheet && !sheetOpen) { try { history.back(); } catch (e) {} }      // an entry a sheet left behind: step over it
    hIdx = st.i;
    const s = hSaved[hIdx];
    if (s && s.hash === location.hash) restore = s;
  } else {                                    // a new entry
    hIdx += 1;
    try { history.replaceState({i: hIdx}, ''); } catch (e) {}
  }
  lastHash = location.hash;
  pendingAfter = {restore, nav: true};
  route();
}
window.addEventListener('hashchange', onHash);
window.addEventListener('popstate', (e) => {
  const st = e.state;
  sheetPopPending = false;
  closePop(false);
  if (sheetOpen && !(st && st.sheet)) closeModal(true);       // Back (gesture, button, remote) closed the sheet
  if (pendingNav && !(st && st.sheet)) { const h = pendingNav; pendingNav = ''; setTimeout(() => { location.hash = h; }, 0); }
});
// "Back": inside the app's own history when there is one, else up to the page's parent
function goBack() {
  const here = hereNow();
  if (hIdx > 0) history.back(); else if (here.key) go(SC.backHash(here.key, here.arg));
}
// the back links (page head, phone title bar): when the previous entry IS the link's target, go back in the history,
// so that page returns with its scroll position and focus; else follow the link
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const a = e.target.closest ? e.target.closest('a.backbtn,a.hback') : null;
  if (!a) return;
  const prev = hSaved[hIdx - 1];
  if (hIdx > 0 && prev && prev.hash === a.getAttribute('href')) { e.preventDefault(); history.back(); }
});

// ---------------------------------------------------------------- the view decorator
// Modules build their lists with TN.card / TN.section or by hand. For what they add to the view or to a sheet, this
// observer marks each grid / row with the shape of its cards (data-shape: the grid then uses that shape's column
// width - channel and radio cards no longer sit in poster columns) and gives hand-made cards a data-key for focus
// restore. It wraps nothing and moves nothing, so previousElementSibling / querySelector contracts hold.
const shapeOf = (c) => (c.classList.contains('land') ? 'land' : c.classList.contains('wide') || c.classList.contains('live') || c.classList.contains('tg') ? 'wide'
  : c.classList.contains('square') || c.classList.contains('radio') ? 'square' : '');
function decorate(node) {
  if (node.nodeType !== 1) return;
  const cards = node.classList.contains('card') ? [node] : node.querySelector ? node.querySelectorAll('.card') : [];
  let lastBox = null;
  for (const c of cards) {
    if (!c.hasAttribute('data-key') && !c.classList.contains('skel')) { const tt = c.querySelector('.t'); c.setAttribute('data-key', hashKey((tt ? tt.textContent : c.textContent) || '')); }
    const box = c.closest('.grid,.row');
    if (!box || box === lastBox) continue;
    lastBox = box;
    if (!box.hasAttribute('data-shape')) { const s = shapeOf(c); if (s) box.setAttribute('data-shape', s); else box.setAttribute('data-shape', 'poster'); }
    if (box.classList.contains('grid') && box.children.length > 60) box.classList.add('big');
  }
}
if ('MutationObserver' in window) {
  const mo = new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) decorate(n); });
  mo.observe(view, {childList: true, subtree: true});
  mo.observe(sheetEl, {childList: true, subtree: true});
}

// ---------------------------------------------------------------- focus, arrows, remote
// The arrows move the focus by groups, not over the whole document: a group is the rail, the header, the tab bar, a
// row, a grid, a chips line, a list, an actions / links block, a form. Inside a row: the neighbour. Inside a grid:
// by column. Between groups: the nearest group in that direction, landing on the item that group had last (else the
// one under / beside the current item). Only the two groups' rectangles are read per key press.
// A module that wants a key for itself listens on its own element (or in the capture phase) and calls
// preventDefault(): the handler below then leaves the event alone.
const GROUP_SEL = '.row,.grid,.chips,.hlist,.menu,.actions,.links,.seg,.rail,.tabs,.top,.pagehead,.sug,.popmenu,.dialog,.toasts,.radiobar,.setlist,.ulist,.banner,.pl-controls,.pl-row,.pl-panel,.pl_bar,.pl_menu,form';
const grpLast = new WeakMap();
let lastContent = null;
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!el || !el.closest) return;
  const g = el.closest(GROUP_SEL);
  if (g) grpLast.set(g, el);
  if (view.contains(el)) lastContent = el;
  HTML.classList.toggle('rail-open', isTvShell() && !!el.closest('#rail'));
});
const scopeEl = () => (popOpen ? popEl : sheetOpen ? modalEl : document.body);
function move(dir) {
  const scope = scopeEl(), cur = document.activeElement, rtl = cfg.lang === 'he';
  const all = Array.from(scope.querySelectorAll(FOCUSABLE)).filter((el) => el.tabIndex >= 0 && !el.classList.contains('skip') && shown(el));
  if (!all.length) return false;
  if (!cur || cur === document.body || !scope.contains(cur) || all.indexOf(cur) < 0) return focusEl((scope === document.body ? firstTarget() : null) || all[0]);
  const groupOf = (el) => { const g = el.closest(GROUP_SEL); return g && scope.contains(g) && g !== scope ? g : null; };
  const g = groupOf(cur), cr = cur.getBoundingClientRect();
  const horiz = dir === 'left' || dir === 'right';
  // 1. inside the current group
  if (g) {
    const items = all.filter((el) => groupOf(el) === g), i = items.indexOf(cur);
    let target = null;
    if (g.classList.contains('row')) {
      if (horiz) { const j = i + ((dir === 'left') === rtl ? 1 : -1); if (j >= 0 && j < items.length) target = items[j]; else if ((dir === 'left') === rtl) return true; }   // the end of a row: no wrap, nothing happens
    } else if ((g.classList.contains('grid') || g.classList.contains('menu')) && items.length === g.children.length && items.length > 1) {
      const top0 = items[0].getBoundingClientRect().top;
      let cols = 1;
      while (cols < items.length && Math.abs(items[cols].getBoundingClientRect().top - top0) < 4) cols++;
      const j = SC.gridStep(i, items.length, cols, dir, rtl);
      if (j >= 0) target = items[j];
    } else {
      const lo = Math.max(0, i - 80), part = items.slice(lo, i + 81);
      const k = SC.pickDir(cr, part.map((el) => (el === cur ? null : el.getBoundingClientRect())), dir);
      if (k >= 0) target = part[k];
    }
    if (target) return focusEl(target);
    // the rail is a column and the tab bar a line: at their ends nothing happens (the focus does not jump into the page)
    if ((g.id === 'rail' && !horiz) || (g.id === 'tabs' && horiz)) return true;
  }
  // 2. leaving the rail towards the content: back to the item that had the focus there
  if (g && g.id === 'rail' && horiz && (dir === 'right') !== rtl && lastContent && lastContent.isConnected && shown(lastContent) && scope === document.body) return focusEl(lastContent);
  // 3. another group (one rectangle each), or a control that belongs to no group
  const buckets = new Map(), cands = [], rects = [], vh = window.innerHeight;
  for (const el of all) {
    if (el === cur) continue;
    const gg = groupOf(el);
    if (gg && gg === g) continue;
    if (gg && !gg.contains(cur)) { if (!buckets.has(gg)) { buckets.set(gg, []); cands.push(gg); rects.push(gg.getBoundingClientRect()); } buckets.get(gg).push(el); continue; }
    const r = el.getBoundingClientRect();           // loose (or of a group around the current one): only near the screen
    if (r.bottom > -vh && r.top < 2 * vh) { cands.push(el); rects.push(r); }
  }
  const k = SC.pickDir(cr, rects, dir);
  if (k < 0) return false;
  const pick = cands[k], items = buckets.get(pick);
  if (!items) return focusEl(pick);
  let target = grpLast.get(pick);
  if (!target || items.indexOf(target) < 0) target = null;
  if (!target && (pick.id === 'rail' || pick.id === 'tabs')) { const c = pick.querySelector('[aria-current="page"]'); if (c && items.indexOf(c) >= 0) target = c; }
  if (!target) {
    const part = dir === 'up' ? items.slice(-80) : items.slice(0, 80);
    const j = SC.pickOverlap(cr, part.map((el) => el.getBoundingClientRect()), dir);
    target = part[j >= 0 ? j : 0];
  }
  return focusEl(target);
}
function trapTab(e) {
  const scope = scopeEl();
  const all = Array.from(scope.querySelectorAll(FOCUSABLE)).filter((el) => el.tabIndex >= 0 && shown(el));
  if (!all.length) { e.preventDefault(); return; }
  const a = document.activeElement, first = all[0], last = all[all.length - 1];
  if (!scope.contains(a)) { e.preventDefault(); focusEl(first, true); }
  else if (e.shiftKey && a === first) { e.preventDefault(); focusEl(last, true); }
  else if (!e.shiftKey && a === last) { e.preventDefault(); focusEl(first, true); }
}
function focusRail() {
  const rail = $('#rail');
  const el = rail.querySelector('[aria-current="page"]') || rail.querySelector('.rail-i');
  return el && shown(el) ? focusEl(el) : false;
}
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  const el = document.activeElement, tag = el && el.tagName;
  const editable = !!el && (tag === 'TEXTAREA' || el.isContentEditable || (tag === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|file|color)$/.test(el.type)));
  if (e.key === 'Tab') { if (sheetOpen || popOpen) trapTab(e); return; }
  if (DIR[e.key] && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const dir = DIR[e.key];
    // the browser's own behaviour: lists, text areas, sliders, date / number fields, radio groups, a frame
    if (tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'IFRAME' || (el && el.isContentEditable)) return;
    if (tag === 'INPUT' && /^(range|number|date|time|datetime-local|month|week|radio|color)$/.test(el.type)) return;
    if (editable && (dir === 'left' || dir === 'right') && el.value) return;      // the caret can still move
    if (tag === 'VIDEO' || tag === 'AUDIO') {       // Left / Right seek 10 s; Up / Down always leave the player (a remote has no Tab)
      if (dir === 'left' || dir === 'right') {
        if (isFinite(el.duration) && el.duration > 0) { el.currentTime = Math.max(0, Math.min(el.duration, el.currentTime + (dir === 'right' ? 10 : -10))); e.preventDefault(); }
        return;
      }
    }
    if (move(dir)) e.preventDefault();
    return;
  }
  // Back: the remote's Back keys everywhere; Escape and Backspace count as Back on TV only (Backspace never inside a
  // field). Order: the menu / confirmation, the sheet, the search layer, then (TV) the rail, then one page back.
  const tvBack = isBackKey(e) || (isTvShell() && (e.key === 'Escape' || (e.key === 'Backspace' && !editable && tag !== 'SELECT')));
  if (e.key === 'Escape' || tvBack) {
    if (popOpen) { e.preventDefault(); closePop(false); return; }
    if (sheetOpen) { e.preventDefault(); closeModal(); return; }
    if (HTML.classList.contains('searching') || !sug.hidden) { e.preventDefault(); closeSearchLayer(); return; }
    if (!tvBack) return;                             // Escape on a desktop never leaves a page
    const here = hereNow();
    if (isTvShell() && el && view.contains(el) && SC.RAIL.some((it) => it && it[0] === here.key) && focusRail()) { e.preventDefault(); return; }
    if (!here.key) return;                           // Home with nothing open: the browser / the TV decides
    e.preventDefault();
    goBack();
    return;
  }
  if (e.key === '/' && !editable && !sheetOpen && !popOpen && !e.ctrlKey && !e.metaKey && !e.altKey) {     // desktop habit: "/" = search
    e.preventDefault();
    if (shellName === 'phone') HTML.classList.add('searching');
    if (shown(qEl)) qEl.focus(); else go('#/hub');
  }
});
// a set whose first input is a D-pad key and that never showed a pointer is probably a television the user agent did
// not give away: TV mode is offered once (never forced)
document.addEventListener('keydown', (e) => {
  if (!DIR[e.key] || sawPointer || isTvShell() || get('tv_offer', 0) || ['tv', 'phone', 'desktop'].includes(cfg.device) || window.innerWidth < 900) return;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  put('tv_offer', 1);
  toast(N('tv_offer'), {ms: 15000, action: {label: N('set_dev_tv'), onClick: () => setCfg('device', 'tv')}});
}, true);

// ---------------------------------------------------------------- window: size, connection, keyboard, scrolling
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { const was = shellName; applyCfg(); if (was !== shellName) emit('shell', shellName); }, 150);
});
try { const mq = matchMedia('(prefers-color-scheme: light)'); const f = () => applyCfg(); if (mq.addEventListener) mq.addEventListener('change', f); else if (mq.addListener) mq.addListener(f); } catch (e) {}
function netState(first) {
  const off = navigator.onLine === false;
  $('#netbar').hidden = !off;
  if (!first) toast(N(off ? 'core_offline' : 'core_online'), {kind: off ? 'error' : 'ok'});
}
window.addEventListener('offline', () => netState(false));
window.addEventListener('online', () => netState(false));
// phone: the title bar hides while scrolling down and returns on the way up; the tab bar hides under the on-screen keyboard
{
  let lastY = 0, ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking || shellName !== 'phone') return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY || 0;
      if (Math.abs(y - lastY) > 12) { HTML.classList.toggle('hdr-hide', y > lastY && y > 96); lastY = y; }
      ticking = false;
    });
  }, {passive: true});
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { HTML.classList.toggle('kbd', window.visualViewport.height < window.innerHeight - 140); });
}

// ---------------------------------------------------------------- the service worker: offline shell and the "new version" notice
// The new worker waits; the page tells the viewer and, when they press Reload, asks the worker to take over
// (SKIP_WAITING) and reloads once it did. A first install announces nothing.
function swSetup() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  const offer = (w) => {
    if (!w || !navigator.serviceWorker.controller) return;
    toast(N('pwa_update'), {ms: 0, action: {label: N('pwa_reload'), onClick: () => { swAsked = true; try { w.postMessage({type: 'SKIP_WAITING'}); } catch (e) {} setTimeout(() => location.reload(), 3000); }}});
  };
  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
    setInterval(() => { reg.update().catch(() => {}); }, 3600000);       // a tab that stays open for days (a TV)
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (swAsked && !reloaded) { reloaded = true; location.reload(); } });
}

// ---------------------------------------------------------------- start
applyCfg(); shell(); netState(true);
pendingAfter = {restore: null, nav: false};
route();
swSetup();
// the module that adds Play to a title and resumes history rows is fetched in the background, so both are there
// on a fresh page load without waiting for the first title
setTimeout(() => { loadModule('sources').catch(() => {}); }, 2500);
// a browser that was connected: the sync starts again by itself, after the page is on the screen
if (get('tg_session', '') && get('tg_api', null)) setTimeout(() => loadTg().then((TG) => TG.resume(), () => {}), 1500);
