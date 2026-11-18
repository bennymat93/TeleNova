'use strict';
// TeleNova web, WP-2: the TeleScope screens (kodi-features T08-T17, T20) on the browser's own Telegram session.
// #/telegram                       root: search, chats, bots, discover, join, Saved Messages, Chiko, pins, settings, account
// #/telegram/link=<t.me link>      a pasted link: a message with a video plays, a channel opens, a bot gets its start
//                                  code, an invite asks before joining
// #/telegram/v=chats[&k=channel|group|bot][&n=100]   dialogs (pinned here first)
// #/telegram/v=chat&c=<id|@name>[&q=..][&o=offset]   videos of one chat, search inside, join / leave / pin / similar
// #/telegram/v=saved[&q=]          Saved Messages: the account's own videos + "send a note to myself"
// #/telegram/v=find&q=..           free Telegram file search over every chat, with "more results" (next pages)
// #/telegram/v=ai&q=..             Gemini -> titles (the key can be typed here)
// #/telegram/v=discover[&p=i|&q=|&similar=<id>|mine]  channel discovery (router.py DISCOVER_PRESETS), join / pin per row
// #/telegram/v=bots                bot chats + chosen bots: always ask / never ask / forget; v=bot&b=<ref>[&q=][&start=]
// #/telegram/v=join                join by link     #/telegram/v=pins   pinned chats     #/telegram/v=chiko
// #/telegram/v=settings            quiet mode, request bots
// Pins are this browser's (TN.put('tg_pins')); the account's synced 'pinned_chats' are searched too (read only).
(function (TN) {
  if (!TN) return;
  TN.i18n.add({
    he: {tgm_title: 'טלגרם', tgm_movies: 'סרטים', tgm_tv: 'סדרות', tgm_heb: 'תוכן ישראלי', tgm_rus: 'תוכן רוסי', tgm_kids: 'ילדים',
      tgm_chiko: "צ'יקו מדיה", tgm_chats: 'הצ\'אטים שלי', tgm_find: 'חיפוש קבצים בטלגרם', tgm_ai: 'חיפוש חכם (AI)', tgm_account: 'חשבון',
      tgm_discover: 'גילוי ערוצים', tgm_join: 'הצטרפות בקישור', tgm_join_ph: 't.me/... או @שם', tgm_joined: 'הצטרפת.', tgm_leave: 'עזיבה',
      tgm_leave_q: 'בטוח? לחצו שוב', tgm_left: 'עזבת.', tgm_pin: 'הצמדה', tgm_unpin: 'ביטול הצמדה', tgm_more: 'עוד', tgm_none: 'לא נמצא כלום.',
      tgm_in_chat: 'חיפוש בצ\'אט', tgm_go: 'חיפוש', tgm_login: 'כניסה לטלגרם', tgm_need_login: 'צריך להתחבר לטלגרם בדפדפן הזה.',
      tgm_busy: 'מחפש... %s/%s', tgm_err: 'שגיאה: %s', tgm_open: 'פתיחה', tgm_p0: 'בוטים לסרטים', tgm_p1: 'ערוצים בעברית', tgm_p2: 'ערוצים ברוסית',
      tgm_p3: 'ערוצים באנגלית', tgm_p4: 'ילדים ומדובבים', tgm_member: 'כבר בפנים', tgm_videos: 'סרטונים', tgm_similar: 'ערוצים דומים',
      tgm_chiko_none: 'לא נמצאו ערוצים של צ\'יקו מדיה בחשבון. אפשר להצטרף אליהם דרך "גילוי ערוצים".',
      tgm_bots: 'הבוטים שלי', tgm_saved: 'הודעות שמורות', tgm_pins: 'צ\'אטים מוצמדים', tgm_settings: 'הגדרות טלגרם', tgm_join_page: 'הצטרפות לערוץ או לקבוצה',
      tgm_join_hint: 'הדביקו קישור t.me, שם משתמש (@שם) או קישור הזמנה. במצב שקט הצ\'אט מושתק ועובר לארכיון.',
      tgm_k_all: 'הכול', tgm_k_channel: 'ערוצים', tgm_k_group: 'קבוצות', tgm_k_bot: 'בוטים', tgm_pinned: 'מוצמד', tgm_members: '%s חברים',
      tgm_more_results: 'עוד תוצאות', tgm_no_more: 'אין עוד תוצאות.', tgm_loading: 'טוען…', tgm_found: '%s קבצים',
      tgm_watched: 'נצפה', tgm_resume: 'המשך מ-%s', tgm_search_in: 'חיפוש בתוך הערוץ', tgm_similar_mine: 'דומים לערוצים שלי',
      tgm_pin_hint: 'צ\'אט מוצמד נסרק בכל חיפוש גם בלי להצטרף אליו.', tgm_pins_none: 'אין צ\'אטים מוצמדים. פתחו ערוץ ולחצו "הצמדה".',
      tgm_synced_pin: 'מסונכרן מהחשבון', tgm_saved_send: 'שליחת הערה לעצמי', tgm_saved_ph: 'טקסט או קישור לשמירה בהודעות השמורות',
      tgm_saved_sent: 'נשלח להודעות השמורות.', tgm_saved_hint: 'ההודעות השמורות הן הצ\'אט הפרטי של החשבון עם עצמו. סרטונים שהעברתם לשם מופיעים כאן.',
      tgm_send: 'שליחה', tgm_link_bad: 'זה לא קישור טלגרם שאפשר לפתוח כאן.', tgm_link_novideo: 'בהודעה הזאת אין קובץ וידאו.',
      tgm_link_invite: 'זה קישור הזמנה לצ\'אט פרטי. להצטרף?', tgm_link_open: 'פתיחת קישור', tgm_play: 'ניגון', tgm_open_chat: 'פתיחת הצ\'אט',
      tgm_open_tg: 'פתיחה בטלגרם', tgm_bot_ask: 'בקשה מבוט', tgm_bot_ask_ph: 'שם הסרט או הסדרה (אפשר S02E05)', tgm_bot_asking: 'כותב לבוט וממתין לתשובה…',
      tgm_bot_files: 'הבוט שלח %s קבצים', tgm_bot_nofiles: 'הבוט ענה, אבל לא שלח קובץ וידאו.', tgm_bot_join: 'הבוט דורש להצטרף קודם לערוץ:',
      tgm_bot_note: 'הבוט אמר: %s', tgm_bot_on: 'לשאול תמיד', tgm_bot_off: 'לא לשאול', tgm_bot_forget: 'לשכוח בחירה', tgm_bot_state_on: 'נשאל בכל חיפוש',
      tgm_bot_state_auto: 'אוטומטי', tgm_bot_state_off: 'לא נשאל', tgm_bot_state_none: 'לא נבחר', tgm_bot_stats: 'נשאל %s פעמים, הביא קבצים %s פעמים',
      tgm_bot_add: 'הוספת בוט לפי שם', tgm_bot_add_ph: '@שם_הבוט', tgm_bots_none: 'אין בוטים בחשבון. אפשר למצוא בוטים ב"גילוי ערוצים".',
      tgm_bots_hint: 'בוט בקשות שולח קובץ רק כשכותבים לו את שם הסרט. בוט שסומן "לשאול תמיד" נשאל אוטומטית בכל חיפוש מקורות.',
      tgm_bot_start: 'הפעלת הבוט עם הקוד מהקישור', tgm_bot_videos: 'הקבצים שבצ\'אט עם הבוט',
      tgm_set_quiet: 'מצב שקט', tgm_set_quiet_hint: 'צ\'אט שהאפליקציה כותבת אליו או מצטרפת אליו מושתק (ומה שהצטרפתם אליו עובר לארכיון), ומה שנקרא מסומן כנקרא - כדי שהטלפון לא יצלצל.',
      tgm_set_bots: 'לשאול בוטים בחיפוש מקורות', tgm_set_bots_hint: 'רק בוטים שסימנתם "לשאול תמיד". כבוי = שום חיפוש לא כותב לאף בוט.',
      tgm_set_auto: 'לשאול גם בוטים שכבר שלחו סרטים', tgm_set_auto_hint: 'בוטים שבצ\'אט שלהם כבר יש קובצי וידאו נשאלים גם בלי שסומנו.',
      tgm_set_autojoin: 'להצטרף לערוץ שבוט דורש', tgm_set_autojoin_hint: 'כשבוט מבקש להצטרף לערוץ לפני שהוא שולח קובץ - להצטרף אוטומטית (במצב שקט).',
      tgm_on: 'פועל', tgm_off: 'כבוי', tgm_ai_key: 'מפתח Gemini', tgm_ai_key_ph: 'הדביקו כאן מפתח Gemini API', tgm_save: 'שמירה', tgm_saved_ok: 'נשמר.',
      tgm_ai_key_hint: 'המפתח נשמר בדפדפן הזה בלבד ונשלח רק לגוגל.', tgm_chat_gone: 'הצ\'אט לא נמצא. ייתכן שהחשבון כבר לא חבר בו.'},
    en: {tgm_title: 'Telegram', tgm_movies: 'Movies', tgm_tv: 'TV shows', tgm_heb: 'Israeli', tgm_rus: 'Russian', tgm_kids: 'Kids',
      tgm_chiko: 'Chiko Media', tgm_chats: 'My chats', tgm_find: 'Search Telegram files', tgm_ai: 'Smart search (AI)', tgm_account: 'Account',
      tgm_discover: 'Discover channels', tgm_join: 'Join by link', tgm_join_ph: 't.me/... or @name', tgm_joined: 'Joined.', tgm_leave: 'Leave',
      tgm_leave_q: 'Sure? Press again', tgm_left: 'Left.', tgm_pin: 'Pin', tgm_unpin: 'Unpin', tgm_more: 'More', tgm_none: 'Nothing found.',
      tgm_in_chat: 'Search in chat', tgm_go: 'Search', tgm_login: 'Telegram sign-in', tgm_need_login: 'Sign in to Telegram in this browser first.',
      tgm_busy: 'Searching... %s/%s', tgm_err: 'Error: %s', tgm_open: 'Open', tgm_p0: 'Movie bots', tgm_p1: 'Hebrew channels', tgm_p2: 'Russian channels',
      tgm_p3: 'English channels', tgm_p4: 'Kids and dubbed', tgm_member: 'Joined', tgm_videos: 'Videos', tgm_similar: 'Similar channels',
      tgm_chiko_none: 'No Chiko Media chats in the account. Join them through "Discover channels".',
      tgm_bots: 'My bots', tgm_saved: 'Saved Messages', tgm_pins: 'Pinned chats', tgm_settings: 'Telegram settings', tgm_join_page: 'Join a channel or a group',
      tgm_join_hint: 'Paste a t.me link, a user name (@name) or an invite link. In quiet mode the chat is muted and archived.',
      tgm_k_all: 'All', tgm_k_channel: 'Channels', tgm_k_group: 'Groups', tgm_k_bot: 'Bots', tgm_pinned: 'Pinned', tgm_members: '%s members',
      tgm_more_results: 'More results', tgm_no_more: 'No more results.', tgm_loading: 'Loading…', tgm_found: '%s files',
      tgm_watched: 'Watched', tgm_resume: 'Resume from %s', tgm_search_in: 'Search inside the channel', tgm_similar_mine: 'Similar to my channels',
      tgm_pin_hint: 'A pinned chat is searched by every search, without joining it.', tgm_pins_none: 'No pinned chats. Open a channel and press "Pin".',
      tgm_synced_pin: 'Synced from the account', tgm_saved_send: 'Send a note to myself', tgm_saved_ph: 'Text or a link to keep in Saved Messages',
      tgm_saved_sent: 'Sent to Saved Messages.', tgm_saved_hint: 'Saved Messages is the account\'s private chat with itself. Videos you forwarded there are listed here.',
      tgm_send: 'Send', tgm_link_bad: 'This is not a Telegram link that can be opened here.', tgm_link_novideo: 'This message has no video file.',
      tgm_link_invite: 'This is an invite link to a private chat. Join it?', tgm_link_open: 'Open a link', tgm_play: 'Play', tgm_open_chat: 'Open the chat',
      tgm_open_tg: 'Open in Telegram', tgm_bot_ask: 'Ask a bot', tgm_bot_ask_ph: 'Movie or series name (S02E05 allowed)', tgm_bot_asking: 'Writing to the bot and waiting for its answer…',
      tgm_bot_files: 'The bot sent %s files', tgm_bot_nofiles: 'The bot answered, but sent no video file.', tgm_bot_join: 'The bot demands joining a channel first:',
      tgm_bot_note: 'The bot said: %s', tgm_bot_on: 'Always ask', tgm_bot_off: 'Never ask', tgm_bot_forget: 'Forget the choice', tgm_bot_state_on: 'Asked by every search',
      tgm_bot_state_auto: 'Automatic', tgm_bot_state_off: 'Never asked', tgm_bot_state_none: 'Not chosen', tgm_bot_stats: 'Asked %s times, brought files %s times',
      tgm_bot_add: 'Add a bot by name', tgm_bot_add_ph: '@bot_name', tgm_bots_none: 'No bots in the account. Bots can be found in "Discover channels".',
      tgm_bots_hint: 'A request bot sends a file only when the title is written to it. A bot marked "Always ask" is asked automatically by every source search.',
      tgm_bot_start: 'Start the bot with the code of the link', tgm_bot_videos: 'Files in the chat with the bot',
      tgm_set_quiet: 'Quiet mode', tgm_set_quiet_hint: 'A chat the app writes to or joins is muted (and a joined one is archived), and what was read is marked as read - so the phone does not ring.',
      tgm_set_bots: 'Ask bots during a source search', tgm_set_bots_hint: 'Only bots you marked "Always ask". Off = no search ever writes to a bot.',
      tgm_set_auto: 'Also ask bots that already sent films', tgm_set_auto_hint: 'Bots whose chat already holds video files are asked without being marked.',
      tgm_set_autojoin: 'Join a channel a bot demands', tgm_set_autojoin_hint: 'When a bot asks to join a channel before it sends a file - join automatically (in quiet mode).',
      tgm_on: 'On', tgm_off: 'Off', tgm_ai_key: 'Gemini key', tgm_ai_key_ph: 'Paste a Gemini API key here', tgm_save: 'Save', tgm_saved_ok: 'Saved.',
      tgm_ai_key_hint: 'The key is kept in this browser only and is sent to Google only.', tgm_chat_gone: 'The chat was not found. The account may no longer be in it.'},
    ru: {tgm_title: 'Telegram', tgm_movies: 'Фильмы', tgm_tv: 'Сериалы', tgm_heb: 'Израильское', tgm_rus: 'Русское', tgm_kids: 'Детям',
      tgm_chiko: 'Chiko Media', tgm_chats: 'Мои чаты', tgm_find: 'Поиск файлов в Telegram', tgm_ai: 'Умный поиск (AI)', tgm_account: 'Аккаунт',
      tgm_discover: 'Поиск каналов', tgm_join: 'Вступить по ссылке', tgm_join_ph: 't.me/... или @имя', tgm_joined: 'Вы вступили.', tgm_leave: 'Выйти',
      tgm_leave_q: 'Точно? Нажмите ещё раз', tgm_left: 'Вы вышли.', tgm_pin: 'Закрепить', tgm_unpin: 'Открепить', tgm_more: 'Ещё', tgm_none: 'Ничего не найдено.',
      tgm_in_chat: 'Поиск в чате', tgm_go: 'Искать', tgm_login: 'Вход в Telegram', tgm_need_login: 'Сначала войдите в Telegram в этом браузере.',
      tgm_busy: 'Поиск... %s/%s', tgm_err: 'Ошибка: %s', tgm_open: 'Открыть', tgm_p0: 'Боты с фильмами', tgm_p1: 'Каналы на иврите', tgm_p2: 'Русские каналы',
      tgm_p3: 'Английские каналы', tgm_p4: 'Детское и дубляж', tgm_member: 'Вы участник', tgm_videos: 'Видео', tgm_similar: 'Похожие каналы',
      tgm_chiko_none: 'В аккаунте нет чатов Chiko Media. Вступите в них через «Поиск каналов».',
      tgm_bots: 'Мои боты', tgm_saved: 'Избранное (Saved Messages)', tgm_pins: 'Закреплённые чаты', tgm_settings: 'Настройки Telegram', tgm_join_page: 'Вступить в канал или группу',
      tgm_join_hint: 'Вставьте ссылку t.me, имя (@имя) или ссылку-приглашение. В тихом режиме чат отключает звук и уходит в архив.',
      tgm_k_all: 'Все', tgm_k_channel: 'Каналы', tgm_k_group: 'Группы', tgm_k_bot: 'Боты', tgm_pinned: 'Закреплён', tgm_members: 'Участников: %s',
      tgm_more_results: 'Ещё результаты', tgm_no_more: 'Больше результатов нет.', tgm_loading: 'Загрузка…', tgm_found: 'Файлов: %s',
      tgm_watched: 'Просмотрено', tgm_resume: 'Продолжить с %s', tgm_search_in: 'Поиск внутри канала', tgm_similar_mine: 'Похожие на мои каналы',
      tgm_pin_hint: 'Закреплённый чат просматривается при каждом поиске, вступать в него не нужно.', tgm_pins_none: 'Закреплённых чатов нет. Откройте канал и нажмите «Закрепить».',
      tgm_synced_pin: 'Синхронизировано из аккаунта', tgm_saved_send: 'Отправить заметку себе', tgm_saved_ph: 'Текст или ссылка для «Избранного»',
      tgm_saved_sent: 'Отправлено в «Избранное».', tgm_saved_hint: '«Избранное» - личный чат аккаунта с самим собой. Видео, которые вы туда переслали, показаны здесь.',
      tgm_send: 'Отправить', tgm_link_bad: 'Это не ссылка Telegram, которую можно открыть здесь.', tgm_link_novideo: 'В этом сообщении нет видеофайла.',
      tgm_link_invite: 'Это приглашение в закрытый чат. Вступить?', tgm_link_open: 'Открыть ссылку', tgm_play: 'Смотреть', tgm_open_chat: 'Открыть чат',
      tgm_open_tg: 'Открыть в Telegram', tgm_bot_ask: 'Запрос боту', tgm_bot_ask_ph: 'Название фильма или сериала (можно S02E05)', tgm_bot_asking: 'Пишем боту и ждём ответа…',
      tgm_bot_files: 'Бот прислал файлов: %s', tgm_bot_nofiles: 'Бот ответил, но видеофайл не прислал.', tgm_bot_join: 'Бот требует сначала вступить в канал:',
      tgm_bot_note: 'Бот ответил: %s', tgm_bot_on: 'Спрашивать всегда', tgm_bot_off: 'Не спрашивать', tgm_bot_forget: 'Забыть выбор', tgm_bot_state_on: 'Спрашивается при каждом поиске',
      tgm_bot_state_auto: 'Автоматически', tgm_bot_state_off: 'Не спрашивается', tgm_bot_state_none: 'Не выбран', tgm_bot_stats: 'Запросов: %s, с файлами: %s',
      tgm_bot_add: 'Добавить бота по имени', tgm_bot_add_ph: '@имя_бота', tgm_bots_none: 'В аккаунте нет ботов. Ботов можно найти в «Поиске каналов».',
      tgm_bots_hint: 'Бот-запросник присылает файл, только когда ему пишут название. Бот с отметкой «Спрашивать всегда» опрашивается при каждом поиске источников.',
      tgm_bot_start: 'Запустить бота с кодом из ссылки', tgm_bot_videos: 'Файлы в чате с ботом',
      tgm_set_quiet: 'Тихий режим', tgm_set_quiet_hint: 'Чат, в который приложение пишет или вступает, отключает звук (а новый уходит в архив), прочитанное отмечается прочитанным - телефон не звонит.',
      tgm_set_bots: 'Спрашивать ботов при поиске источников', tgm_set_bots_hint: 'Только ботов с отметкой «Спрашивать всегда». Выкл. = поиск никогда не пишет ботам.',
      tgm_set_auto: 'Спрашивать и ботов, уже присылавших фильмы', tgm_set_auto_hint: 'Боты, в чате с которыми уже есть видео, опрашиваются без отметки.',
      tgm_set_autojoin: 'Вступать в канал по требованию бота', tgm_set_autojoin_hint: 'Если бот просит вступить в канал, прежде чем прислать файл, - вступать автоматически (в тихом режиме).',
      tgm_on: 'Вкл.', tgm_off: 'Выкл.', tgm_ai_key: 'Ключ Gemini', tgm_ai_key_ph: 'Вставьте ключ Gemini API', tgm_save: 'Сохранить', tgm_saved_ok: 'Сохранено.',
      tgm_ai_key_hint: 'Ключ хранится только в этом браузере и отправляется только в Google.', tgm_chat_gone: 'Чат не найден. Возможно, аккаунт в нём больше не состоит.'},
  });
  const t = TN.t, esc = TN.esc;
  // router.py DISCOVER_PRESETS
  const PRESETS = [['tgm_p0', ['movies bot', 'filter bot', 'סרטים בוט', 'series bot', 'фильмы бот']],
    ['tgm_p1', ['סרטים', 'סדרות', 'סרטים וסדרות', 'תרגום מובנה', 'מדובב']],
    ['tgm_p2', ['фильмы', 'сериалы', 'кино', 'новинки кино']],
    ['tgm_p3', ['movies', 'series', 'tv shows', 'movies hd', 'cinema']],
    ['tgm_p4', ['סרטי ילדים', 'מדובבים', 'мультфильмы', 'cartoons', 'kids movies']]];
  const CHIKO_TAG = /צ['׳’`]?יקו|chiko|chico/iu;
  const chikoKeywords = () => String((TN.settings.synced() || {}).chiko_keywords || "צ'יקו,ציקו,chiko,chico").split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const L = (p) => TN.link('telegram', p);
  const say = (text) => { if (TN.toast) { try { TN.toast(text); } catch (e) {} } };
  const errText = (e) => String((e && (e.errorMessage || e.message)) || e || '');
  const clock = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };

  // pins (this browser; the synced field needs syncdoc.js + syncdoc.py from WP-0)
  const pins = () => { const p = TN.get('tg_pins', []); return Array.isArray(p) ? p.filter((x) => x && x.id) : []; };
  const isPinned = (id) => pins().some((p) => p.id === String(id));
  function togglePin(d) {
    const list = pins().filter((p) => p.id !== String(d.id));
    if (list.length === pins().length) list.unshift({id: String(d.id), title: d.title || '', username: d.username || ''});
    TN.put('tg_pins', list.slice(0, 50));
    return isPinned(d.id);
  }
  // join link -> {invite} | {name} (tgclient.py join)
  function parseJoin(link) {
    link = String(link || '').trim();
    const m = /(?:joinchat\/|\/\+|^\+)([\w-]+)/.exec(link);
    if (m) return {invite: m[1]};
    const name = link.replace(/^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)?@?/i, '').split(/[/?#]/)[0];
    return /^[A-Za-z][\w]{3,31}$/.test(name) ? {name} : null;
  }
  // tgclient.py _found_row: what must never be offered (scam / fake / deleted / restricted chats, people)
  function offerable(ent) {
    if (!ent || ent.scam || ent.fake || ent.deleted) return false;
    if (ent.restricted && ent.restrictionReason && ent.restrictionReason.length) return false;
    return !!ent.bot || ent.title !== undefined;
  }
  const kindOf = (ent) => (ent.bot ? 'bot' : ent.broadcast ? 'channel' : ent.title !== undefined ? 'group' : 'user');
  const KIND_ICON = {bot: '🤖', channel: '📢', group: '👥', user: '👤'};
  const titleOf = (ent) => (ent ? ent.title || [ent.firstName, ent.lastName].filter(Boolean).join(' ') || ent.username || '' : '');

  async function ready() {
    const TG = await TN.tg();
    const S = await TN.provider('tgsearch');
    const c = await TG.client();        // rejects with TG_NO_LOGIN / TG_OTHER_TAB / TG_LOGIN_RUNNING / TG_OFFLINE
    return {TG, S, c, Api: self.GramJS.Api};
  }
  function needLogin(e) {
    const v = TN.view(), box = document.createElement('div');
    box.className = 'panel';
    const msg = /TG_NO_LOGIN/.test(String(e && e.message)) ? t('tgm_need_login') : t('tgm_err', errText(e));
    box.innerHTML = `<p class="msg">${esc(msg)}</p>`;
    box.append(TN.button('btn', t('tgm_login'), () => TN.go('#/tglogin')));
    v.append(box);
  }
  function grid(title, n) { return TN.section(title, n); }
  function tile(g, icon, label, href) {
    const a = document.createElement('a');
    a.className = 'card'; a.href = href;
    a.innerHTML = `<div class="tgm-ic" aria-hidden="true">${icon}</div><div class="t">${esc(label)}</div>`;
    g.append(a);
  }
  const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };
  function note(cls, text) { const p = el('p', cls, text); TN.view().append(p); return p; }
  // one file row: name, details, watched mark / resume point; plays tracked ("another link" = the row after it)
  function fileRow(list, r, S, rows, hist) {
    const st = S.stateOf ? S.stateOf(r, hist) : {seen: false, resume: null};
    const b = el('button', 'hrow' + (st.seen ? ' tgm-seen' : ''));
    const more = st.resume ? t('tgm_resume', clock(st.resume.t)) : st.seen ? t('tgm_watched') : '';
    b.innerHTML = `<span class="t" dir="auto">${st.seen ? `<span class="tgm-w" title="${esc(t('tgm_watched'))}">● </span>` : ''}${esc(r.file || '')}</span>` +
      `<small dir="auto">${esc([S.rowSub(r), more].filter(Boolean).join(' · '))}</small>`;
    if (st.seen) b.setAttribute('aria-label', (r.file || '') + ' - ' + t('tgm_watched'));
    b.onclick = () => S.play(r, '', {rows});
    list.append(b);
    return b;
  }
  function fileList(rows, S) {
    const list = el('div', 'hlist tgm-list');
    const hist = new Set((TN.store && TN.store.history ? TN.store.history() : []).map((h) => h && h.key));
    for (const r of rows) fileRow(list, r, S, rows, hist);
    return list;
  }
  function searchBox(ph, value, go, btn) {
    const f = document.createElement('form');
    f.className = 'tgm-form';
    f.innerHTML = `<input type="search" dir="auto" placeholder="${esc(ph)}" aria-label="${esc(ph)}" value="${esc(value || '')}"><button class="btn" type="submit">${esc(btn || t('tgm_go'))}</button>`;
    f.onsubmit = (e) => { e.preventDefault(); const q = f.firstChild.value.trim(); if (q) go(q); };
    TN.view().append(f);
    return f;
  }
  function style() {
    if (document.getElementById('tgm-style')) return;
    const s = document.createElement('style');
    s.id = 'tgm-style';
    s.textContent = '.tgm-ic{font-size:2.2rem;text-align:center;padding:18px 0}.tgm-form{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 16px;align-items:center}' +
      '.tgm-form input{flex:1 1 180px;min-width:0}.tgm-acts{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.tgm-list .hrow{display:flex;flex-direction:column;' +
      'align-items:flex-start;text-align:start;width:100%}.tgm-list small{opacity:.75}.tgm-w{color:var(--accent)}.tgm-seen .t{opacity:.8}' +
      '.tgm-set .hrow{display:flex;gap:12px;align-items:center;justify-content:space-between;text-align:start}.tgm-set .hrow>div{flex:1 1 auto;min-width:0}' +
      '.tgm-set small{display:block;opacity:.75}.tgm-bot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;text-align:start}' +
      '.tgm-bot>div{flex:1 1 200px;min-width:0}.tgm-bot small{display:block;opacity:.75}.tgm-photo{background-size:cover!important;background-position:center!important}';
    document.head.append(s);
  }

  // small chat pictures: read through the signed-in client only for the cards on the screen (as data: addresses,
  // kept for this visit; nothing is stored)
  const photos = new Map();
  let photoQueue = Promise.resolve(), photoObs = null;
  function photoFor(card, ent, R) {
    const img = card && card.querySelector && card.querySelector('.img');
    if (!img || !ent || !ent.photo || ent.photo.className === 'ChatPhotoEmpty' || ent.photo.className === 'UserProfilePhotoEmpty' || !R.c.downloadProfilePhoto) return;
    const id = R.S.entityId(ent);
    const paint = (u) => { if (u) { img.style.backgroundImage = `url("${u}")`; img.classList.add('tgm-photo'); } };
    if (photos.has(id)) return paint(photos.get(id));
    const load = () => {
      photoQueue = photoQueue.then(async () => {
        if (!document.body.contains(card)) return;
        if (photos.has(id)) return paint(photos.get(id));
        try {
          const buf = await R.c.downloadProfilePhoto(ent, {isBig: false});
          let u = '';
          if (buf && buf.length && buf.length < 200000) {
            let bin = '';
            for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
            u = 'data:image/jpeg;base64,' + btoa(bin);
          }
          photos.set(id, u);
          if (photos.size > 400) photos.delete(photos.keys().next().value);
          paint(u);
        } catch (e) { photos.set(id, ''); }
      });
    };
    if (typeof IntersectionObserver !== 'function') return void load();
    if (!photoObs) photoObs = new IntersectionObserver((es) => { for (const x of es) if (x.isIntersecting) { photoObs.unobserve(x.target); if (x.target._tgmLoad) x.target._tgmLoad(); } }, {rootMargin: '200px'});
    card._tgmLoad = load;
    photoObs.observe(card);
  }
  function chatCard(g, ent, sub, onClick, R) {
    const c = TN.card('', titleOf(ent), sub, onClick, 'wide');
    g.append(c);
    photoFor(c, ent, R);
    return c;
  }

  // ------------------------------------------------------------ screens
  async function root() {
    TN.page('telegram', t('tgm_title'));
    const g = grid('');
    const cat = (m, extra, title) => '#/catalog/' + new URLSearchParams(Object.assign({m, v: 'list', name: title, path: '/discover/' + m, sort_by: 'popularity.desc'}, extra));
    tile(g, '🔍', t('tgm_find'), L({v: 'find'}));
    tile(g, '✈', t('tgm_chats'), L({v: 'chats'}));
    tile(g, '🤖', t('tgm_bots'), L({v: 'bots'}));
    tile(g, '🧭', t('tgm_discover'), L({v: 'discover'}));
    tile(g, '➕', t('tgm_join'), L({v: 'join'}));
    tile(g, '🔖', t('tgm_saved'), L({v: 'saved'}));
    tile(g, '🎞', t('tgm_chiko'), L({v: 'chiko'}));
    tile(g, '📌', t('tgm_pins'), L({v: 'pins'}));
    tile(g, '✨', t('tgm_ai'), L({v: 'ai'}));
    tile(g, '🎬', t('tgm_movies'), '#/movies');
    tile(g, '📺', t('tgm_tv'), '#/tv');
    tile(g, '🇮🇱', t('tgm_heb'), cat('movie', {with_original_language: 'he'}, t('tgm_heb')));
    tile(g, '🇷🇺', t('tgm_rus'), cat('movie', {with_original_language: 'ru'}, t('tgm_rus')));
    tile(g, '🧸', t('tgm_kids'), cat('movie', {with_genres: '16'}, t('tgm_kids')));
    tile(g, '⚙', t('tgm_settings'), L({v: 'settings'}));
    tile(g, '👤', t('tgm_account'), '#/tglogin');
    // a pasted link opens from here too
    const h = el('h2', '', t('tgm_link_open'));
    TN.view().append(h);
    searchBox(t('tgm_join_ph'), '', (q) => TN.go(L({link: q})), t('tgm_open'));
  }

  async function chats(p, ctx) {
    TN.page('telegram', t('tgm_chats'));
    let R;
    try { R = await ready(); } catch (e) { return needLogin(e); }
    if (!ctx.current()) return;
    const kind = ['channel', 'group', 'bot'].includes(p.k) ? p.k : '';
    TN.chips([['', t('tgm_k_all')], ['channel', t('tgm_k_channel')], ['group', t('tgm_k_group')], ['bot', t('tgm_k_bot')]], kind,
      (k) => TN.go(L(Object.assign({v: 'chats'}, k ? {k} : {}))));
    const n = Math.min(500, parseInt(p.n, 10) || 100);
    const sk = TN.skeleton();
    let ds;
    try { ds = await R.c.getDialogs({limit: n}); } catch (e) { if (ctx.current()) { sk.remove(); note('msg', t('tgm_err', errText(e))); } return; }
    if (!ctx.current()) return;
    sk.remove();
    const list = (ds || []).filter((d) => d.entity && !(d.entity.className === 'User' && d.entity.self) && !d.entity.deleted &&
      (d.isChannel || d.isGroup || d.entity.bot || d.entity.title !== undefined));
    R.S.rememberEntities(list.map((d) => d.entity));
    const shown = list.filter((d) => !kind || kindOf(d.entity) === kind);
    shown.sort((a, b) => (isPinned(R.S.entityId(b.entity)) - isPinned(R.S.entityId(a.entity))));
    const g = grid(t('tgm_chats'), shown.length);
    for (const d of shown) {
      const id = R.S.entityId(d.entity), k = kindOf(d.entity);
      const sub = [KIND_ICON[k], isPinned(id) ? '📌' : '', d.unreadCount ? String(d.unreadCount) : ''].filter(Boolean).join(' ');
      chatCard(g, d.entity, sub, () => TN.go(k === 'bot' ? L({v: 'bot', b: d.entity.username ? '@' + d.entity.username : id}) : L({v: 'chat', c: id})), R);
    }
    if (!shown.length) TN.empty(g, t('tgm_none'));
    const acts = el('div', 'tgm-acts');
    if ((ds || []).length >= n && n < 500) acts.append(TN.button('btn ghost', t('tgm_more'), () => TN.go(L(Object.assign({v: 'chats', n: n + 100}, kind ? {k: kind} : {})))));
    acts.append(TN.button('btn ghost', t('tgm_join'), () => TN.go(L({v: 'join'}))));
    TN.view().append(acts);
  }

  function joinForm(box, R, onDone) {
    const f = document.createElement('form');
    f.className = 'tgm-form';
    f.innerHTML = `<input dir="ltr" placeholder="${esc(t('tgm_join_ph'))}" aria-label="${esc(t('tgm_join'))}"><button class="btn" type="submit">${esc(t('tgm_join'))}</button><span class="hint" role="status"></span>`;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const j = parseJoin(f.firstChild.value), st = f.lastChild;
      if (!j) { st.textContent = t('tgm_link_bad'); return; }
      st.textContent = t('tgm_loading');
      try {
        const res = await R.S.join(j);
        st.textContent = t('tgm_joined');
        say(t('tgm_joined'));
        if (onDone) onDone(res);
      } catch (err) { st.textContent = t('tgm_err', errText(err)); }
    };
    box.append(f);
    return f;
  }
  async function joinPage(p, ctx) {
    TN.page('telegram', t('tgm_join_page'));
    let R;
    try { R = await ready(); } catch (e) { return needLogin(e); }
    if (!ctx.current()) return;
    note('hint', t('tgm_join_hint'));
    const f = joinForm(TN.view(), R, (res) => {
      const ch = ((res && res.chats) || [])[0];
      if (ch && ctx.current()) TN.view().append(TN.button('btn', t('tgm_open_chat'), () => TN.go(L({v: 'chat', c: R.S.entityId(ch)}))));
    });
    if (p.l) f.firstChild.value = p.l;
  }
  async function leave(R, ent) {
    const {c, Api} = R;
    if ((ent.className || '').startsWith('Channel')) return c.invoke(new Api.channels.LeaveChannel({channel: ent}));
    if ((ent.className || '').startsWith('Chat')) return c.invoke(new Api.messages.DeleteChatUser({chatId: ent.id, userId: new Api.InputUserSelf()}));
    return c.invoke(new Api.messages.DeleteHistory({peer: ent, maxId: 0, justClear: false, revoke: false}));
  }
  // the buttons of one chat: pin, join / leave, similar. Used on the chat page and in the discovery sheet
  function chatActions(acts, R, ent, opts) {
    opts = opts || {};
    const id = R.S.entityId(ent), title = titleOf(ent);
    const pinB = TN.button('btn ghost', t(isPinned(id) ? 'tgm_unpin' : 'tgm_pin'), () => {
      const on = togglePin({id, title, username: ent.username});
      pinB.textContent = t(on ? 'tgm_unpin' : 'tgm_pin');
      pinB.setAttribute('aria-pressed', String(on));
    });
    pinB.setAttribute('aria-pressed', String(isPinned(id)));
    pinB.title = t('tgm_pin_hint');
    acts.append(pinB);
    const isMember = !(ent.left || opts.notMember);
    if (!isMember && (ent.username || opts.invite)) {
      acts.append(TN.button('btn', t('tgm_join'), async (ev) => {
        ev.target.disabled = true;
        try { await R.S.join(opts.invite ? opts.invite : {name: ent.username}); ev.target.textContent = t('tgm_joined'); say(t('tgm_joined')); }
        catch (e) { ev.target.disabled = false; ev.target.textContent = t('tgm_err', errText(e)); }
      }));
    } else if (!ent.self && !opts.noLeave) {
      let armed = false;
      const lb = TN.button('btn ghost', t('tgm_leave'), async () => {
        if (!armed) { armed = true; lb.textContent = t('tgm_leave_q'); return; }
        try { await leave(R, ent); TN.put('tg_pins', pins().filter((x) => x.id !== id)); lb.textContent = t('tgm_left'); lb.disabled = true; } catch (e) { lb.textContent = t('tgm_err', errText(e)); }
      });
      acts.append(lb);
    }
    if ((ent.className || '') === 'Channel' && ent.broadcast) acts.append(TN.button('btn ghost', t('tgm_similar'), () => { if (opts.sheet && TN.closeModal) TN.closeModal(); TN.go(L({v: 'discover', similar: id})); }));
    if (ent.username) { const a = el('a', 'btn ghost', t('tgm_open_tg')); a.href = 'https://t.me/' + encodeURIComponent(ent.username); a.target = '_blank'; a.rel = 'noopener'; acts.append(a); }
  }

  async function chat(p, ctx, saved) {
    TN.page('telegram', saved ? t('tgm_saved') : '…');
    let R;
    try { R = await ready(); } catch (e) { return needLogin(e); }
    const ref = saved ? 'me' : String(p.c || '');
    if (saved) {
      note('hint', t('tgm_saved_hint'));
      const f = document.createElement('form');
      f.className = 'tgm-form';
      f.innerHTML = `<input dir="auto" maxlength="4000" placeholder="${esc(t('tgm_saved_ph'))}" aria-label="${esc(t('tgm_saved_send'))}"><button class="btn" type="submit">${esc(t('tgm_send'))}</button><span class="hint" role="status"></span>`;
      f.onsubmit = async (e) => {                        // tgclient.py send_saved: a plain text to the account's own chat only
        e.preventDefault();
        const text = f.firstChild.value.trim();
        if (!text) return;
        try { await R.c.sendMessage('me', {message: text.slice(0, 4000), linkPreview: false, silent: true}); f.firstChild.value = ''; f.lastChild.textContent = t('tgm_saved_sent'); }
        catch (err) { f.lastChild.textContent = t('tgm_err', errText(err)); }
      };
      TN.view().append(f);
    }
    const sk = TN.skeleton();
    let res;
    try { res = await R.S.chatVideos(ref, {offsetId: parseInt(p.o, 10) || 0, limit: 50, q: p.q || ''}); } catch (e) {
      if (ctx.current()) { sk.remove(); note('msg', /TG_NO_CHAT|CHANNEL_PRIVATE|USERNAME_NOT_OCCUPIED|USERNAME_INVALID/.test(errText(e) + (e.code || '')) ? t('tgm_chat_gone') : t('tgm_err', errText(e))); }
      return;
    }
    if (!ctx.current()) return;
    sk.remove();
    const ent = res.chat, title = saved ? t('tgm_saved') : titleOf(ent) || ref;
    const h1 = TN.view().querySelector('h1');
    if (h1) h1.textContent = title;
    if (!saved) {
      const acts = el('div', 'tgm-acts');
      chatActions(acts, R, ent);
      if (ent.bot) acts.prepend(TN.button('btn', t('tgm_bot_ask'), () => TN.go(L({v: 'bot', b: ent.username ? '@' + ent.username : R.S.entityId(ent)}))));
      TN.view().append(acts);
    }
    const self2 = (q) => TN.go(L(saved ? {v: 'saved', q} : {v: 'chat', c: ref, q}));
    searchBox(saved ? t('tgm_in_chat') : t('tgm_search_in'), p.q, self2);
    TN.view().append(el('h2', '', t('tgm_videos') + ' ' + res.items.length));
    const list = fileList(res.items, R.S);
    TN.view().append(list);
    if (!res.items.length) list.append(el('p', 'hint', t('tgm_none')));
    if (res.next) TN.view().append(TN.button('btn ghost', t('tgm_more'), () => TN.go(L(Object.assign({}, p, saved ? {v: 'saved'} : {}, {o: res.next})))));
  }

  // free search over every chat, page after page (Telegram's global search)
  async function find(p, ctx) {
    TN.page('telegram', t('tgm_find'));
    searchBox(t('tgm_find'), p.q, (q) => TN.go(L({v: 'find', q})));
    if (!p.q) {
      const recent = (TN.store && TN.store.searches ? TN.store.searches() : []).slice(0, 12).map((s) => (typeof s === 'string' ? s : s && (s.q || s.query || s.text))).filter(Boolean);
      if (recent.length) TN.chips(recent.map((s) => [s, s]), '', (q) => TN.go(L({v: 'find', q})));
      return;
    }
    let R;
    try { R = await ready(); } catch (e) { return needLogin(e); }
    const st = note('hint', t('tgm_loading'));
    st.setAttribute('role', 'status');
    try { TN.store.addSearch(p.q); } catch (e) {}
    let rows;
    try { rows = await R.S.free(p.q, {limit: 60}); } catch (e) { if (ctx.current()) { st.className = 'msg'; st.textContent = t('tgm_err', errText(e)); } return; }
    if (!ctx.current()) return;
    rows = rows.slice();
    const hist = new Set((TN.store && TN.store.history ? TN.store.history() : []).map((h) => h && h.key));
    const list = el('div', 'hlist tgm-list');
    TN.view().append(list);
    for (const r of rows) fileRow(list, r, R.S, rows, hist);
    const count = () => { st.textContent = rows.length ? t('tgm_found', rows.length) : t('tgm_none'); };
    count();
    const moreB = TN.button('btn ghost', t('tgm_more_results'), async () => {
      moreB.disabled = true;
      moreB.textContent = t('tgm_loading');
      try {
        const res = await R.S.freeMore(p.q, {limit: 60, have: rows});
        if (!ctx.current()) return;
        const first = res.items[0] ? list.childNodes.length : -1;
        for (const r of res.items) { rows.push(r); fileRow(list, r, R.S, rows, hist); }
        count();
        if (first >= 0 && list.childNodes[first] && list.childNodes[first].focus) list.childNodes[first].focus();
        if (!res.more || !res.items.length) { moreB.replaceWith(el('p', 'hint', t('tgm_no_more'))); return; }
      } catch (e) { st.textContent = t('tgm_err', errText(e)); }
      moreB.disabled = false;
      moreB.textContent = t('tgm_more_results');
    });
    if (!R.S.freeHasMore || R.S.freeHasMore(p.q)) TN.view().append(moreB);
  }

  async function ai(p, ctx) {
    TN.page('telegram', t('tgm_ai'));
    const S = await TN.provider('tgsearch');
    if (!ctx.current()) return;
    const keyForm = () => {                               // the key can be typed here (this browser only)
      const f = document.createElement('form');
      f.className = 'tgm-form';
      f.innerHTML = `<input type="password" dir="ltr" autocomplete="off" placeholder="${esc(t('tgm_ai_key_ph'))}" aria-label="${esc(t('tgm_ai_key'))}"><button class="btn" type="submit">${esc(t('tgm_save'))}</button><span class="hint" role="status"></span>`;
      f.onsubmit = (e) => { e.preventDefault(); const k = f.firstChild.value.trim(); if (!k) return; TN.settings.set('gemini_key', k); f.firstChild.value = ''; f.lastChild.textContent = t('tgm_saved_ok'); if (p.q) TN.route(); };
      TN.view().append(f, el('p', 'hint', t('tgm_ai_key_hint')));
    };
    if (!S.geminiKey()) { note('msg', t('tgs_no_ai')); keyForm(); return; }
    searchBox(t('tgm_ai'), p.q, (q) => TN.go(L({v: 'ai', q})));
    if (!p.q) return;
    const st = note('hint', t('tgm_loading'));
    let items;
    try { items = await S.aiTitles(p.q); } catch (e) { if (ctx.current()) { st.className = 'msg'; st.textContent = errText(e); if (e.code === 'no_key' || /Gemini 4\d\d/.test(errText(e))) keyForm(); } return; }
    if (!ctx.current()) return;
    st.textContent = items.length ? '' : t('tgm_none');
    const g = grid(t('tgm_ai'), items.length);
    for (const it of items) {
      g.append(TN.card('', it.title, [it.year, it.type === 'tv' ? t('tgm_tv') : t('tgm_movies')].filter(Boolean).join(' · '), async () => {
        if (TN.hasTmdbKey()) {
          try {
            const r = await TN.tmdb('/search/' + it.type, Object.assign({query: it.title}, it.year ? {[it.type === 'tv' ? 'first_air_date_year' : 'year']: it.year} : {}));
            const hit = (r.results || [])[0];
            if (hit) return TN.openTitle(it.type, hit.id);
          } catch (e) {}
        }
        TN.go(L({v: 'find', q: it.title + (it.year && it.type === 'movie' ? ' ' + it.year : '')}));
      }));
    }
  }

  // one discovered chat: what can be done with it (the build's context menu: open, join, pin, search inside, similar)
  function chatSheet(R, ent, joined) {
    const id = R.S.entityId(ent), ref = ent.username ? '@' + ent.username : id, k = kindOf(ent);
    const members = ent.participantsCount || ent.botActiveUsers || 0;
    TN.modal(`<div class="detail" style="grid-template-columns:1fr"><div><h3 dir="auto">${esc(titleOf(ent))}</h3>` +
      `<div class="meta" dir="auto">${esc([KIND_ICON[k], ent.username ? '@' + ent.username : '', members ? t('tgm_members', Number(members).toLocaleString()) : '', joined ? t('tgm_member') : ''].filter(Boolean).join(' · '))}</div>` +
      `<div class="actions" id="acts"></div><p class="hint">${esc(t('tgm_pin_hint'))}</p></div></div>`);
    const acts = document.getElementById('acts');
    if (!acts) return;
    const go = (h) => { if (TN.closeModal) TN.closeModal(); TN.go(h); };
    if (k === 'bot') {
      acts.append(TN.button('btn', t('tgm_bot_ask'), () => go(L({v: 'bot', b: ref}))));
      const info = {title: titleOf(ent), username: ent.username || '', id: String(ent.id)};
      acts.append(TN.button('btn ghost', t('tgm_bot_on'), (e) => { R.S.bots.mark(ent.username || ent.id, true, info); e.target.textContent = t('tgm_bot_state_on'); e.target.disabled = true; }));
      if (ent.username) { const a = el('a', 'btn ghost', t('tgm_open_tg')); a.href = 'https://t.me/' + encodeURIComponent(ent.username); a.target = '_blank'; a.rel = 'noopener'; acts.append(a); }
      return;
    }
    acts.append(TN.button('btn', t('tgm_videos'), () => go(L({v: 'chat', c: ref}))));
    chatActions(acts, R, ent, {notMember: !joined, noLeave: true, sheet: true});
  }

  async function discover(p, ctx) {
    TN.page('telegram', t('tgm_discover'));
    if (p.p === undefined && !p.q && !p.similar) {
      searchBox(t('tgm_discover'), '', (q) => TN.go(L({v: 'discover', q})));
      const g = grid('');
      PRESETS.forEach(([k], i) => tile(g, '🧭', t(k), L({v: 'discover', p: i})));
      tile(g, '✨', t('tgm_similar_mine'), L({v: 'discover', similar: 'mine'}));
      return;
    }
    let R;
    try { R = await ready(); } catch (e) { return needLogin(e); }
    const {c, Api} = R;
    if (p.q) searchBox(t('tgm_discover'), p.q, (q) => TN.go(L({v: 'discover', q})));
    const sk = TN.skeleton();
    const found = new Map();                               // id -> {ent, hits, joined}
    const add = (ch, mine) => {
      if (!offerable(ch)) return;
      const id = R.S.entityId(ch);
      const joined = !!(mine && mine.has(id)) || (!ch.bot && ch.left === false);
      const row = found.get(id);
      if (row) { row.hits++; row.joined = row.joined || joined; } else found.set(id, {ent: ch, hits: 1, joined});
    };
    try {
      if (p.similar) {
        // tgclient.py similar: channels Telegram recommends next to the given ones; for 'mine' next to up to 8 of the
        // account's channels - the ones several of them point to come first
        let bases;
        if (p.similar === 'mine') {
          const ds = await c.getDialogs({limit: 200});
          bases = (ds || []).map((d) => d.entity).filter((e) => e && e.className === 'Channel' && e.broadcast).slice(0, 8);
          R.S.rememberEntities(bases);
        } else bases = [await R.S.resolve(p.similar)];
        for (const b of bases) {
          try {
            const r = await c.invoke(new Api.channels.GetChannelRecommendations({channel: b}));
            (r.chats || []).filter((x) => x.left !== false).forEach((x) => add(x));
          } catch (e) { if (bases.length === 1) throw e; }
          if (!ctx.current()) return;
        }
      } else {
        const qs = (p.q ? [p.q].concat(/bot/i.test(p.q) ? [] : [p.q + ' bot']) : PRESETS[Math.max(0, Math.min(PRESETS.length - 1, parseInt(p.p, 10) || 0))][1])
          .filter((q) => q && q.trim().length >= 2).slice(0, 5);
        for (const q of qs) {
          const r = await c.invoke(new Api.contacts.Search({q, limit: 40}));
          const mine = new Set((r.myResults || []).map((x) => R.S.markedId(x)));
          (r.chats || []).forEach((x) => add(x, mine));
          (r.users || []).filter((u) => u.bot).forEach((x) => add(x, mine));
          if (!ctx.current()) return;
        }
      }
    } catch (e) { if (ctx.current()) note('msg', t('tgm_err', errText(e))); }
    if (!ctx.current()) return;
    sk.remove();
    R.S.rememberEntities([...found.values()].map((x) => x.ent));
    const size = (x) => x.ent.participantsCount || x.ent.botActiveUsers || 0;
    // the build's order: not joined first, found by more wordings first, then by audience
    const rows = [...found.values()].sort((a, b) => (Number(a.joined) - Number(b.joined)) || (b.hits - a.hits) || (size(b) - size(a)) || (Number(!a.ent.username) - Number(!b.ent.username)));
    const title = p.similar ? t(p.similar === 'mine' ? 'tgm_similar_mine' : 'tgm_similar') : p.q ? p.q : t(PRESETS[Math.max(0, Math.min(PRESETS.length - 1, parseInt(p.p, 10) || 0))][0]);
    const g = grid(title, rows.length);
    for (const x of rows) {
      const ch = x.ent, id = R.S.entityId(ch);
      const sub = [KIND_ICON[kindOf(ch)], size(x) ? Number(size(x)).toLocaleString() : '', x.joined ? t('tgm_member') : '', isPinned(id) ? '📌' : '', ch.username ? '@' + ch.username : ''].filter(Boolean).join(' · ');
      chatCard(g, ch, sub, () => chatSheet(R, ch, x.joined), R);
    }
    if (!rows.length) TN.empty(g, t('tgm_none'));
  }

  // "My bots": every bot chat + every chosen bot, with its state; mark; ask
  async function botsPage(p, ctx) {
    TN.page('telegram', t('tgm_bots'));
    let R;
    try { R = await ready(); } catch (e) { return needLogin(e); }
    if (!ctx.current()) return;
    note('hint', t('tgm_bots_hint'));
    const add = searchBox(t('tgm_bot_add_ph'), '', (q) => TN.go(L({v: 'bot', b: q})), t('tgm_bot_add'));
    add.firstChild.dir = 'ltr';
    const sk = TN.skeleton();
    let rows;
    try { rows = await R.S.bots.list(); } catch (e) { if (ctx.current()) { sk.remove(); note('msg', t('tgm_err', errText(e))); } return; }
    if (!ctx.current()) return;
    sk.remove();
    const box = el('div', 'hlist');
    TN.view().append(el('h2', '', t('tgm_bots') + ' ' + rows.length), box);
    const STATE = {on: 'tgm_bot_state_on', auto: 'tgm_bot_state_auto', off: 'tgm_bot_state_off', '': 'tgm_bot_state_none'};
    const draw = () => {
      box.innerHTML = '';
      for (const b of rows) {
        const row = el('div', 'hrow tgm-bot');
        const ref = b.username ? '@' + b.username : b.id;
        const info = el('div');
        info.innerHTML = `<b dir="auto">🤖 ${esc(b.title)}</b><small dir="auto">${esc([b.username ? '@' + b.username : '', t(STATE[b.state] || STATE['']),
          b.stats && b.stats.asked ? t('tgm_bot_stats', b.stats.asked, b.stats.hits || 0) : ''].filter(Boolean).join(' · '))}</small>`;
        const acts = el('div', 'tgm-acts');
        const meta = {title: b.title, username: b.username, id: b.id || undefined};
        const set = (on) => { R.S.bots.mark(b.username || b.id, on, meta); b.state = on === null ? '' : on ? 'on' : 'off'; draw(); };
        acts.append(TN.button('btn', t('tgm_bot_ask'), () => TN.go(L({v: 'bot', b: ref}))));
        if (b.state !== 'on') acts.append(TN.button('btn ghost', t('tgm_bot_on'), () => set(true)));
        if (b.state !== 'off') acts.append(TN.button('btn ghost', t('tgm_bot_off'), () => set(false)));
        if (b.state === 'on' || b.state === 'off') acts.append(TN.button('btn ghost', t('tgm_bot_forget'), () => set(null)));
        row.append(info, acts);
        box.append(row);
      }
      if (!rows.length) box.append(el('p', 'hint', t('tgm_bots_none')));
    };
    draw();
    TN.view().append(TN.button('btn ghost', t('tgm_p0'), () => TN.go(L({v: 'discover', p: 0}))), TN.button('btn ghost', '⚙ ' + t('tgm_settings'), () => TN.go(L({v: 'settings'}))));
  }
  // "Ask a bot": type a title, the bot's files come back as rows. start=<code>: the code of a t.me/<bot>?start= link
  async function botPage(p, ctx) {
    TN.page('telegram', t('tgm_bot_ask'));
    let R;
    try { R = await ready(); } catch (e) { return needLogin(e); }
    let ent;
    try { ent = await R.S.resolve(R.S.bots.ref(p.b)); } catch (e) { if (ctx.current()) note('msg', t('tgs_bot_missing')); return; }
    if (!ctx.current()) return;
    if (!ent || !ent.bot) { note('msg', t('tgs_bot_nobot')); return; }
    const ref = ent.username ? '@' + ent.username : R.S.entityId(ent);
    const h1 = TN.view().querySelector('h1');
    if (h1) h1.textContent = '🤖 ' + titleOf(ent);
    const out = el('div');
    const run = async (query, isStart) => {
      out.innerHTML = '';
      const st = el('p', 'hint', t('tgm_bot_asking'));
      st.setAttribute('role', 'status');
      out.append(st);
      let res;
      try { res = await R.S.bots.ask(ent, isStart ? '/start ' + query : query, {onStep: (r) => { if (r.files.length) st.textContent = t('tgm_bot_asking') + ' ' + t('tgm_found', r.files.length); }}); }
      catch (e) { st.className = 'msg'; st.textContent = t('tgm_err', errText(e)); return; }
      if (!ctx.current() || !document.body.contains(out)) return;
      st.className = res.files.length ? 'hint' : 'msg';
      st.textContent = res.files.length ? t('tgm_bot_files', res.files.length) : res.text || (res.answered ? t('tgm_bot_nofiles') : t('tgs_bot_none'));
      for (const n of (res.notes || []).slice(0, 3)) out.append(el('p', 'hint', t('tgm_bot_note', n)));
      if (res.join && res.join.length) {
        out.append(el('p', 'msg', t('tgm_bot_join')));
        const acts = el('div', 'tgm-acts');
        for (const l of res.join.slice(0, 3)) {
          acts.append(TN.button('btn', t('tgm_join') + ' ' + l.replace(/^https?:\/\/t\.me\//, '@'), async (ev) => {
            ev.target.disabled = true;
            try { await R.S.join(l); ev.target.textContent = t('tgm_joined'); } catch (e) { ev.target.disabled = false; ev.target.textContent = t('tgm_err', errText(e)); }
          }));
        }
        acts.append(TN.button('btn ghost', t('tgm_go'), () => run(query, isStart)));
        out.append(acts);
      }
      if (res.files.length) out.append(fileList(res.files, R.S));
    };
    const f = searchBox(t('tgm_bot_ask_ph'), p.q, (q) => run(q, false), t('tgm_bot_ask'));
    const acts = el('div', 'tgm-acts');
    const info = {title: titleOf(ent), username: ent.username || '', id: String(ent.id)};
    acts.append(TN.button('btn ghost', t('tgm_bot_on'), (e) => { R.S.bots.mark(ent.username || ent.id, true, info); e.target.textContent = t('tgm_bot_state_on'); e.target.disabled = true; }));
    acts.append(TN.button('btn ghost', t('tgm_bot_videos'), () => TN.go(L({v: 'chat', c: ref}))));
    if (p.start) acts.prepend(TN.button('btn', t('tgm_bot_start'), () => run(String(p.start), true)));
    TN.view().append(acts, out);
    if (p.q) run(p.q, false); else if (!p.start) f.firstChild.focus();
  }

  async function pinsPage(p, ctx) {
    TN.page('telegram', t('tgm_pins'));
    note('hint', t('tgm_pin_hint'));
    const S = await TN.provider('tgsearch');
    if (!ctx.current()) return;
    const box = el('div', 'hlist');
    TN.view().append(box);
    const draw = () => {
      box.innerHTML = '';
      const all = S.pinnedChats();
      for (const x of all) {
        const row = el('div', 'hrow tgm-bot');
        const a = el('a', '', '📌 ' + (x.title || x.username || x.id));
        a.href = L({v: 'chat', c: x.username ? '@' + x.username : x.id}); a.dir = 'auto';
        const info = el('div');
        info.append(a);
        row.append(info, x.synced ? el('small', 'hint', t('tgm_synced_pin')) : TN.button('btn ghost', t('tgm_unpin'), () => { togglePin(x); draw(); }));
        box.append(row);
      }
      if (!all.length) box.append(el('p', 'hint', t('tgm_pins_none')));
    };
    draw();
    TN.view().append(TN.button('btn ghost', t('tgm_discover'), () => TN.go(L({v: 'discover'}))));
  }

  // quiet mode and the request bots (the engine's settings that matter in a browser)
  async function settingsPage() {
    TN.page('telegram', t('tgm_settings'));
    const box = el('div', 'panel tgm-set');
    const list = el('div', 'hlist');
    const sw = (key, def, title, hint) => {
      const row = el('div', 'hrow'), info = el('div');
      info.innerHTML = `<b>${esc(t(title))}</b><small>${esc(t(hint))}</small>`;
      const on = () => (def ? TN.settings.get(key, true) !== false : TN.settings.get(key, false) === true);
      const b = TN.button('btn ghost', '', () => { TN.settings.set(key, !on()); paint(); say(t('tgm_saved_ok')); });
      b.setAttribute('role', 'switch');
      const paint = () => { b.textContent = t(on() ? 'tgm_on' : 'tgm_off'); b.setAttribute('aria-checked', String(on())); b.setAttribute('aria-label', t(title)); b.className = on() ? 'btn' : 'btn ghost'; };
      paint();
      row.append(info, b);
      list.append(row);
    };
    sw('telegram_quiet', true, 'tgm_set_quiet', 'tgm_set_quiet_hint');
    sw('tgsearch_bots', true, 'tgm_set_bots', 'tgm_set_bots_hint');
    sw('tgsearch_bots_auto', false, 'tgm_set_auto', 'tgm_set_auto_hint');
    sw('tgsearch_bot_autojoin', false, 'tgm_set_autojoin', 'tgm_set_autojoin_hint');
    box.append(list);
    TN.view().append(box);
    const acts = el('div', 'tgm-acts');
    acts.append(TN.button('btn ghost', t('tgm_bots'), () => TN.go(L({v: 'bots'}))), TN.button('btn ghost', t('tgm_pins'), () => TN.go(L({v: 'pins'}))),
      TN.button('btn ghost', t('tgm_ai'), () => TN.go(L({v: 'ai'}))), TN.button('btn ghost', t('tgm_account'), () => TN.go('#/tglogin')));
    TN.view().append(acts);
  }

  // a pasted t.me link (Services > paste link sends it here as #/telegram/link=<address>)
  async function linkPage(p, ctx) {
    TN.page('telegram', t('tgm_link_open'));
    const url = String(p.link || '').trim();
    const f = searchBox(t('tgm_join_ph'), url, (q) => TN.go(L({link: q})), t('tgm_open'));
    f.firstChild.dir = 'ltr';
    if (!url) return;
    let R;
    try { R = await ready(); } catch (e) { return needLogin(e); }
    if (!ctx.current()) return;
    if (!R.S.tme(url)) { const j = parseJoin(url); if (j && j.name) return TN.go(L({link: 'https://t.me/' + j.name})); note('msg', t('tgm_link_bad')); return; }
    const st = note('hint', t('tgm_loading'));
    let info;
    try { info = await R.S.linkInfo(url); } catch (e) { if (ctx.current()) { st.className = 'msg'; st.textContent = /TG_NO_CHAT|PRIVATE|USERNAME/.test(errText(e) + (e.code || '')) ? t('tgm_chat_gone') : t('tgm_err', errText(e)); } return; }
    if (!ctx.current()) return;
    st.remove();
    if (info.kind === 'bad') return void note('msg', t('tgm_link_bad'));
    if (info.kind === 'invite') {
      note('msg', t('tgm_link_invite'));
      const acts = el('div', 'tgm-acts');
      acts.append(TN.button('btn', t('tgm_join'), async (ev) => {
        ev.target.disabled = true;
        try { const res = await R.S.join(info.link); const ch = ((res && res.chats) || [])[0]; say(t('tgm_joined')); if (ch) TN.go(L({v: 'chat', c: R.S.entityId(ch)})); else ev.target.textContent = t('tgm_joined'); }
        catch (e) { ev.target.disabled = false; ev.target.textContent = t('tgm_err', errText(e)); }
      }));
      TN.view().append(acts);
      return;
    }
    const ref = info.chat.username ? '@' + info.chat.username : R.S.entityId(info.chat);
    if (info.kind === 'bot') return TN.go(L(Object.assign({v: 'bot', b: ref}, info.code ? {start: info.code} : {})));
    if (info.kind === 'chat') return TN.go(L({v: 'chat', c: ref}));
    // a message
    TN.view().append(el('h2', '', titleOf(info.chat)));
    if (info.row) {
      const list = fileList([info.row], R.S);
      TN.view().append(list);
      R.S.play(info.row, '', {rows: [info.row]});
    } else {
      note('msg', t('tgm_link_novideo'));
      if (info.text) { const q = el('p', 'hint', info.text.slice(0, 400)); q.dir = 'auto'; TN.view().append(q); }
    }
    const acts = el('div', 'tgm-acts');
    acts.append(TN.button('btn ghost', t('tgm_open_chat'), () => TN.go(L({v: 'chat', c: ref}))));
    const a = el('a', 'btn ghost', t('tgm_open_tg'));
    a.href = /^https:\/\/(?:t|telegram)\.me\//i.test(url) ? url : 'https://t.me/'; a.target = '_blank'; a.rel = 'noopener';
    acts.append(a);
    TN.view().append(acts);
  }

  async function chiko(p, ctx) {
    TN.page('telegram', t('tgm_chiko'));
    let R;
    try { R = await ready(); } catch (e) { return needLogin(e); }
    const kws = chikoKeywords();
    const sk = TN.skeleton();
    const ds = await R.c.getDialogs({limit: 400});
    if (!ctx.current()) return;
    sk.remove();
    const hit = (ds || []).filter((d) => { const ti = String(d.title || '').toLowerCase(); return kws.some((k) => ti.includes(k)) || CHIKO_TAG.test(d.title || ''); });
    R.S.rememberEntities(hit.map((d) => d.entity));
    const g = grid(t('tgm_chiko'), hit.length);
    for (const d of hit) chatCard(g, d.entity, KIND_ICON[kindOf(d.entity)], () => TN.go(L({v: 'chat', c: R.S.entityId(d.entity)})), R);
    if (!hit.length) { TN.empty(g, t('tgm_chiko_none')); TN.view().append(TN.button('btn', t('tgm_discover'), () => TN.go(L({v: 'discover', q: 'chiko media'})))); }
  }

  const VIEWS = {chats, chat, find, ai, discover, chiko, bots: botsPage, bot: botPage, join: joinPage, pins: pinsPage, settings: settingsPage,
    saved: (p, ctx) => chat(p, ctx, true), link: linkPage};
  // '#/telegram/link=https://t.me/x/5?single' -> the whole address after 'link=' is the link (it may hold & and =)
  function parseArg(arg) {
    arg = String(arg || '');
    if (/^link=/.test(arg)) { let u = arg.slice(5); try { if (/%[0-9a-f]{2}/i.test(u)) u = decodeURIComponent(u); } catch (e) {} return {v: 'link', link: u}; }
    const p = TN.params(arg);
    if (p.link && !p.v) p.v = 'link';
    return p;
  }
  TN.registerPage('telegram', async (arg, ctx) => {
    style();
    const p = parseArg(arg);
    const fn = VIEWS[p.v];
    return fn ? fn(p, ctx) : root(p, ctx);
  });
  // for tests: the pure parts
  self.TNTelegram = {parseJoin, parseArg, PRESETS, chikoKeywords, offerable, kindOf, togglePin, isPinned, VIEWS: Object.keys(VIEWS)};
})(self.TN);
