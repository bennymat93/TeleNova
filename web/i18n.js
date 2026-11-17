'use strict';
// TeleNova Web texts (5.x modules). Every text exists in he / en / ru. Modules add their own table once:
//   TN.i18n.add({he: {mykey: '...'}, en: {mykey: '...'}, ru: {mykey: '...'}});
// and read it with TN.t('mykey', arg1, arg2) - each %s is replaced by the next argument.
// Lookup: this table (current language, then English), then the older tables of app.js (L / X3 / X4), then the key.
// Key names: a module prefixes its keys with its own name (hub_, cat_, tg_s_, src_, sub_, live_, yt_, svc_ ...);
// the m_ / ms_ / core_ prefixes belong to the shell (WP-0).
(function (root) {
  const T = {he: {}, en: {}, ru: {}};
  let lang = 'he', fallback = null;
  function add(table) {
    for (const l of ['he', 'en', 'ru']) Object.assign(T[l], (table && table[l]) || {});
  }
  function has(k) { return k in T.en || k in T.he || k in T.ru; }
  function t(k, ...args) {
    let v = T[lang][k];
    if (v == null) v = T.en[k];
    if (v == null && fallback) v = fallback(k);
    if (v == null) v = k;
    let i = 0;
    return String(v).replace(/%s/g, () => (i < args.length ? String(args[i++]) : '%s'));
  }
  root.I18N = {
    add, has, t,
    lang: () => lang,
    setLang(l) { if (T[l]) lang = l; },
    setFallback(fn) { fallback = fn; },
    tables: T,                                   // (read-only use: the tests compare the three languages)
  };

  // ---------------------------------------------------------------- the shell's own texts
  add({
    he: {
      m_hub: 'חיפוש בכל המקורות', ms_hub: 'סרטים, ערוצים, טלגרם ויוטיוב',
      m_searchhist: 'היסטוריית חיפושים', ms_searchhist: 'מה שחיפשתם',
      m_movies: 'סרטים', ms_movies: 'חמים, פופולריים, ז׳אנרים',
      m_tv: 'סדרות', ms_tv: 'עונות ופרקים',
      m_live: 'טלוויזיה', ms_live: 'ערוצים חיים',
      m_radio: 'רדיו', ms_radio: 'תחנות מכל העולם',
      m_telegram: 'טלגרם', ms_telegram: 'TeleScope: חיפוש וצפייה',
      m_history: 'היסטוריה', ms_history: 'המשך צפייה',
      m_favs: 'מועדפים', ms_favs: 'מה ששמרתם',
      m_library: 'ספרייה', ms_library: 'מקורות וספקים',
      m_users: 'משתמשים', ms_users: 'לכל אחד הרשימות שלו',
      m_services: 'חשבונות ושירותים', ms_services: 'טלגרם, Real-Debrid, מפתחות',
      m_backup: 'גיבוי ושחזור', ms_backup: 'קובץ גיבוי של ההגדרות',
      m_gdrive: 'Google Drive', ms_gdrive: 'גיבוי וסרטונים מהדרייב',
      m_status: 'מצב המערכת', ms_status: 'חיבורים ובדיקות',
      m_help: 'מרכז עזרה', ms_help: 'מדריכים ושאלות',
      m_device: 'סוג מכשיר', ms_device: 'טלוויזיה, טלפון או מחשב',
      m_settings: 'הגדרות', ms_settings: 'שפה, תצוגה ועוד',
      m_bn: 'הורדת Kodi', ms_bn: 'האפליקציה המלאה',
      m_about: 'אודות ועדכון', ms_about: 'גרסה, עדכון, ניקוי מטמון',
      m_topics: 'נושאים', m_youtube: 'יוטיוב', m_dailymotion: 'Dailymotion',
      core_soon: 'בקרוב', core_soon_txt: 'המסך הזה עדיין בבנייה בגרסת הרשת. בינתיים הוא זמין באפליקציית BN Stream ב-Kodi.',
      core_load_fail: 'לא ניתן לטעון את המסך. בדקו את החיבור לאינטרנט ונסו שוב.', core_retry: 'נסו שוב',
      core_kodi_only: 'זמין ב-Kodi בלבד', core_helper: 'דורש שרת עזר (Worker)',
      core_version: 'גרסה: %s', core_sw: 'מצב לא מקוון: %s', core_sw_on: 'פעיל', core_sw_off: 'לא פעיל',
      core_update: 'עדכן את האפליקציה', core_update_none: 'זו הגרסה העדכנית', core_update_got: 'נמצאה גרסה חדשה - טוען מחדש...',
      core_clear_cache: 'נקה מטמון', core_cleared: 'המטמון נוקה - טוען מחדש...',
      core_about_txt: 'TeleNova Web היא גרסת הדפדפן של BN Stream. הגדרות Kodi ועדכון המערכת של Kodi אינם רלוונטיים בדפדפן; כאן אפשר לעדכן את האפליקציה ולנקות את המטמון.',
      core_guide: 'המדריך של Kodi', core_more: 'עוד',
      core_hub_txt: 'הקלידו שם של סרט, סדרה, ערוץ או תחנה. החיפוש רץ בכל המקורות במקביל.', core_search_go: 'חפש',
      core_sh_none: 'אין עדיין חיפושים שמורים.', core_sh_remove: 'הסר', core_sh_clear: 'נקה הכול', core_sh_clear_q: 'למחוק את כל החיפושים? לחצו שוב לאישור',
    },
    en: {
      m_hub: 'Search everything', ms_hub: 'Films, channels, Telegram and YouTube',
      m_searchhist: 'Search history', ms_searchhist: 'What you searched',
      m_movies: 'Movies', ms_movies: 'Trending, popular, genres',
      m_tv: 'Series', ms_tv: 'Seasons and episodes',
      m_live: 'Live TV', ms_live: 'Live channels',
      m_radio: 'Radio', ms_radio: 'Stations worldwide',
      m_telegram: 'Telegram', ms_telegram: 'TeleScope: search and watch',
      m_history: 'History', ms_history: 'Continue watching',
      m_favs: 'Favourites', ms_favs: 'What you saved',
      m_library: 'Library', ms_library: 'Sources and providers',
      m_users: 'Users', ms_users: 'Everyone has their own lists',
      m_services: 'Accounts & services', ms_services: 'Telegram, Real-Debrid, keys',
      m_backup: 'Backup & restore', ms_backup: 'A backup file of your settings',
      m_gdrive: 'Google Drive', ms_gdrive: 'Backups and videos from Drive',
      m_status: 'Status', ms_status: 'Connections and checks',
      m_help: 'Help center', ms_help: 'Guides and questions',
      m_device: 'Device type', ms_device: 'TV, phone or computer',
      m_settings: 'Settings', ms_settings: 'Language, display and more',
      m_bn: 'Download Kodi', ms_bn: 'The full app',
      m_about: 'About & update', ms_about: 'Version, update, clear cache',
      m_topics: 'Topics', m_youtube: 'YouTube', m_dailymotion: 'Dailymotion',
      core_soon: 'Coming soon', core_soon_txt: 'This screen is still being built for the web version. Meanwhile it is available in the BN Stream app in Kodi.',
      core_load_fail: 'The screen could not be loaded. Check the internet connection and try again.', core_retry: 'Try again',
      core_kodi_only: 'Kodi only', core_helper: 'Needs the helper (Worker)',
      core_version: 'Version: %s', core_sw: 'Offline mode: %s', core_sw_on: 'on', core_sw_off: 'off',
      core_update: 'Update the app', core_update_none: 'This is the latest version', core_update_got: 'A new version was found - reloading...',
      core_clear_cache: 'Clear cache', core_cleared: 'The cache was cleared - reloading...',
      core_about_txt: 'TeleNova Web is the browser version of BN Stream. Kodi settings and the Kodi system update have no meaning in a browser; here you can update the app and clear its cache.',
      core_guide: 'The Kodi guide', core_more: 'More',
      core_hub_txt: 'Type the name of a film, series, channel or station. Every source is searched at once.', core_search_go: 'Search',
      core_sh_none: 'No saved searches yet.', core_sh_remove: 'Remove', core_sh_clear: 'Clear all', core_sh_clear_q: 'Delete all searches? Press again to confirm',
    },
    ru: {
      m_hub: 'Поиск везде', ms_hub: 'Фильмы, каналы, Telegram и YouTube',
      m_searchhist: 'История поиска', ms_searchhist: 'Что вы искали',
      m_movies: 'Фильмы', ms_movies: 'Популярное, жанры',
      m_tv: 'Сериалы', ms_tv: 'Сезоны и серии',
      m_live: 'ТВ', ms_live: 'Прямые каналы',
      m_radio: 'Радио', ms_radio: 'Станции мира',
      m_telegram: 'Telegram', ms_telegram: 'TeleScope: поиск и просмотр',
      m_history: 'История', ms_history: 'Продолжить просмотр',
      m_favs: 'Избранное', ms_favs: 'Сохранённое',
      m_library: 'Библиотека', ms_library: 'Источники и провайдеры',
      m_users: 'Пользователи', ms_users: 'У каждого свои списки',
      m_services: 'Аккаунты и сервисы', ms_services: 'Telegram, Real-Debrid, ключи',
      m_backup: 'Резервная копия', ms_backup: 'Файл копии настроек',
      m_gdrive: 'Google Drive', ms_gdrive: 'Копии и видео с Диска',
      m_status: 'Состояние', ms_status: 'Подключения и проверки',
      m_help: 'Справка', ms_help: 'Руководства и вопросы',
      m_device: 'Тип устройства', ms_device: 'ТВ, телефон или компьютер',
      m_settings: 'Настройки', ms_settings: 'Язык, вид и другое',
      m_bn: 'Скачать Kodi', ms_bn: 'Полное приложение',
      m_about: 'О программе', ms_about: 'Версия, обновление, кэш',
      m_topics: 'Темы', m_youtube: 'YouTube', m_dailymotion: 'Dailymotion',
      core_soon: 'Скоро', core_soon_txt: 'Этот экран ещё в разработке для веб-версии. Пока он доступен в приложении BN Stream в Kodi.',
      core_load_fail: 'Не удалось загрузить экран. Проверьте подключение к интернету и попробуйте ещё раз.', core_retry: 'Повторить',
      core_kodi_only: 'Только в Kodi', core_helper: 'Нужен помощник (Worker)',
      core_version: 'Версия: %s', core_sw: 'Офлайн-режим: %s', core_sw_on: 'включён', core_sw_off: 'выключен',
      core_update: 'Обновить приложение', core_update_none: 'Это последняя версия', core_update_got: 'Найдена новая версия - перезагрузка...',
      core_clear_cache: 'Очистить кэш', core_cleared: 'Кэш очищен - перезагрузка...',
      core_about_txt: 'TeleNova Web - браузерная версия BN Stream. Настройки Kodi и системное обновление Kodi в браузере не нужны; здесь можно обновить приложение и очистить кэш.',
      core_guide: 'Руководство Kodi', core_more: 'Ещё',
      core_hub_txt: 'Введите название фильма, сериала, канала или станции. Поиск идёт по всем источникам сразу.', core_search_go: 'Найти',
      core_sh_none: 'Сохранённых поисков пока нет.', core_sh_remove: 'Убрать', core_sh_clear: 'Очистить всё', core_sh_clear_q: 'Удалить все поиски? Нажмите ещё раз для подтверждения',
    },
  });
})(self);
