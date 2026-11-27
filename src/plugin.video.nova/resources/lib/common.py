# -*- coding: utf-8 -*-
"""Shared helpers: i18n (he/en/ru), JSON storage, TMDb client."""
import json
import os
import re
import time

import xbmc
import xbmcaddon
import xbmcvfs

ADDON = xbmcaddon.Addon('plugin.video.nova')
ADDON_ID = 'plugin.video.nova'
PROFILE = xbmcvfs.translatePath(ADDON.getAddonInfo('profile'))
ADDON_PATH = xbmcvfs.translatePath(ADDON.getAddonInfo('path'))
MEDIA = os.path.join(ADDON_PATH, 'resources', 'media')
os.makedirs(PROFILE, exist_ok=True)

# ---------------------------------------------------------------- i18n
STRINGS = {
    'movies':      ('סרטים', 'Movies', 'Фильмы'),
    'series':      ('סדרות', 'Series', 'Сериалы'),
    'tv':          ('ערוצי טלוויזיה', 'TV Channels', 'ТВ-каналы'),
    'radio':       ('רדיו', 'Radio', 'Радио'),
    'history':     ('היסטוריית צפייה', 'Watch History', 'История просмотров'),
    'favourites':  ('מועדפים', 'Favourites', 'Избранное'),
    'accounts':    ('חשבונות וחיבורים', 'Accounts & Connections', 'Аккаунты и подключения'),
    'settings':    ('הגדרות', 'Settings', 'Настройки'),
    'search':      ('חיפוש', 'Search', 'Поиск'),
    'trending':    ('חם השבוע', 'Trending This Week', 'Популярное за неделю'),
    'popular':     ('פופולרי', 'Popular', 'Популярное'),
    'top_rated':   ('המדורגים ביותר', 'Top Rated', 'Лучшие по рейтингу'),
    'genres':      ('לפי ז\'אנר', 'By Genre', 'По жанрам'),
    'languages':   ('לפי שפה', 'By Language', 'По языку'),
    'years':       ('לפי שנה', 'By Year', 'По году'),
    'hebrew':      ('עברית', 'Hebrew', 'Иврит'),
    'english':     ('אנגלית', 'English', 'Английский'),
    'russian':     ('רוסית', 'Russian', 'Русский'),
    'french':      ('צרפתית', 'French', 'Французский'),
    'spanish':     ('ספרדית', 'Spanish', 'Испанский'),
    'german':      ('גרמנית', 'German', 'Немецкий'),
    'italian':     ('איטלקית', 'Italian', 'Итальянский'),
    'turkish':     ('טורקית', 'Turkish', 'Турецкий'),
    'korean':      ('קוריאנית', 'Korean', 'Корейский'),
    'japanese':    ('יפנית', 'Japanese', 'Японский'),
    'hindi':       ('הודית', 'Hindi', 'Хинди'),
    'next_page':   ('עמוד הבא', 'Next page', 'Следующая страница'),
    'season':      ('עונה', 'Season', 'Сезон'),
    'choose_src':  ('בחר מקור ידנית', 'Choose source manually', 'Выбрать источник вручную'),
    'add_fav':     ('הוסף למועדפים', 'Add to favourites', 'Добавить в избранное'),
    'rem_fav':     ('הסר ממועדפים', 'Remove from favourites', 'Удалить из избранного'),
    'fav_added':   ('נוסף למועדפים', 'Added to favourites', 'Добавлено в избранное'),
    'channels':    ('ערוצים', 'Channels', 'Каналы'),
    'guide':       ('מדריך שידורים', 'TV Guide', 'Телепрограмма'),
    'iptv_src':    ('מקורות IPTV', 'IPTV sources', 'Источники IPTV'),
    'israel':      ('ישראל', 'Israel', 'Израиль'),
    'world':       ('ערוצים מהעולם', 'Channels of the world', 'Каналы мира'),
    'russia':      ('רוסיה', 'Russia', 'Россия'),
    'top_world':   ('הפופולריות בעולם', 'Top worldwide', 'Популярные в мире'),
    'watched_at':  ('נצפה', 'Watched', 'Просмотрено'),
    'clear':       ('נקה', 'Clear', 'Очистить'),
    'ok':          ('מחובר', 'Connected', 'Подключено'),
    'missing':     ('לא מוגדר', 'Not set', 'Не задано'),
    'error':       ('שגיאה', 'Error', 'Ошибка'),
    'israeli_tv':  ('ערוצים ישראליים (עידן+)', 'Israeli channels (Idan+)', 'Израильские каналы (Idan+)'),
    'empty':       ('אין פריטים', 'Nothing here yet', 'Пока пусто'),
    'tv_refresh':  ('רענון רשימת הערוצים', 'Refresh the channel list', 'Обновить список каналов'),
    'ai_start':    ('לא נמצאו כתוביות בעברית – מתחיל תרגום AI', 'No Hebrew subtitles found - starting AI subtitles', 'Субтитры на иврите не найдены - запуск ИИ'),
    'ai_ready':    ('כתוביות AI נטענו', 'AI subtitles loaded', 'ИИ-субтитры загружены'),
    'synced':      ('הכתוביות סונכרנו לדיבור (%+.1f ש׳%s)', 'Subtitles synced to the speech (%+.1f s%s)', 'Субтитры синхронизированы (%+.1f с%s)'),
    'ai_progress': ('כתוביות AI', 'AI subtitles', 'ИИ-субтитры'),
    'sub_check':   ('בודק כתוביות בעברית...', 'Checking Hebrew subtitles...', 'Проверка субтитров на иврите...'),
    'ai_prepare':  ('מכין כתוביות AI לפני הצפייה', 'Preparing AI subtitles before playback', 'Готовлю ИИ-субтитры перед просмотром'),
    'ai_noserver': ('שרת כתוביות AI לא זמין', 'AI subtitle server unreachable', 'Сервер ИИ-субтитров недоступен'),
    'ai_now':      ('יצירת כתוביות AI', 'AI Subtitle Generation', 'Создать ИИ-субтитры'),
    'ai_forced':   ('יוצר כתוביות AI לסרטון הזה', 'Generating AI subtitles for this video', 'Создаю ИИ-субтитры для этого видео'),
    'ai_noplay':   ('אין סרטון מתנגן', 'Nothing is playing', 'Ничего не воспроизводится'),
    'ai_nonet':    ('כתוביות AI זמינות רק לסרטונים מהרשת', 'AI subtitles work for streamed videos only', 'ИИ-субтитры только для потокового видео'),
    'ai_empty':    ('לא נוצרו כתוביות AI: לא נמצא דיבור או שלא ניתן לקרוא את השמע', 'No AI subtitles: no speech found or the audio could not be read', 'ИИ-субтитры не созданы: нет речи или звук недоступен'),
    'ai_nolive':   ('אין כתוביות AI לשידור חי', 'No AI subtitles for live TV', 'Нет ИИ-субтитров для прямого эфира'),
    'movies_he':   ('סרטים', 'Movies', 'Фильмы'),
    'grp_israel':  ('ישראלי', 'Israeli', 'Израиль'),
    'grp_news':    ('חדשות', 'News', 'Новости'),
    'grp_movies':  ('סרטים', 'Movies', 'Кино'),
    'grp_series':  ('סדרות', 'Series', 'Сериалы'),
    'grp_kids':    ('ילדים', 'Kids', 'Детские'),
    'grp_sport':   ('ספורט', 'Sport', 'Спорт'),
    'grp_documentary': ('תעודה וטבע', 'Documentary', 'Познавательные'),
    'grp_music':   ('מוזיקה', 'Music', 'Музыка'),
    'grp_russian': ('רוסית', 'Russian', 'Русские'),
    'grp_other':   ('אחר', 'Other', 'Другие'),
    'libraries':   ('ספריות חינמיות', 'Free Libraries', 'Бесплатные библиотеки'),
    'lib_install': ('יותקן בלחיצה', 'installs on click', 'установится по нажатию'),
    'backup_menu': ('גיבוי ושחזור', 'Backup & Restore', 'Резервная копия'),
    'backup':      ('גיבוי עכשיו', 'Back up now', 'Создать копию'),
    'restore':     ('שחזור מגיבוי', 'Restore from backup', 'Восстановить'),
    'bk_where':    ('בחר תיקייה לגיבוי (USB / רשת / מקומי)', 'Choose backup folder (USB / network / local)', 'Папка для копии (USB / сеть / локально)'),
    'bk_done':     ('הגיבוי נשמר', 'Backup saved', 'Копия сохранена'),
    'bk_files':    ('קבצים', 'files', 'файлов'),
    'bk_fail':     ('הפעולה נכשלה', 'Operation failed', 'Ошибка операции'),
    'bk_pick':     ('בחר קובץ גיבוי...', 'Choose a backup file...', 'Выбрать файл...'),
    'bk_auto':     ('גיבוי אוטומטי', 'Automatic backup', 'Автокопия'),
    'bk_invalid':  ('זה לא קובץ גיבוי של BN', 'This is not a BN backup file', 'Это не копия BN'),
    'bk_confirm':  ('לשחזר? ההגדרות הנוכחיות יוחלפו.', 'Restore? Current settings will be replaced.', 'Восстановить? Текущие настройки будут заменены.'),
    'bk_restored': ('השחזור הושלם. Kodi ייסגר – פתח אותו שוב.', 'Restored. Kodi will close - open it again.', 'Готово. Kodi закроется - откройте снова.'),
    'free_src':    ('ערוצים חינמיים מובנים', 'Built-in free channels', 'Встроенные бесплатные каналы'),
    'kukhnya':     ('קוכניה (המטבח)', 'Kukhnya (Kitchen)', 'Кухня'),
    'kodi_settings': ('הגדרות Kodi', 'Kodi settings', 'Настройки Kodi'),
    'il_movies':   ('סרטים ישראליים', 'Israeli films', 'Израильские фильмы'),
    'il_series':   ('סדרות ישראליות', 'Israeli series', 'Израильские сериалы'),
    'now_playing': ('עכשיו בקולנוע', 'Now in cinemas', 'Сейчас в кино'),
    'on_air':      ('משודרות עכשיו', 'On the air now', 'Сейчас в эфире'),
    'family':      ('משפחה וילדים', 'Family & kids', 'Для всей семьи'),
    'kids_tv':     ('סדרות ילדים', 'Kids series', 'Детские сериалы'),
    'docu':        ('תעודה', 'Documentary', 'Документальные'),
    'r_genres':    ('לפי סגנון', 'By style', 'По стилю'),
    'r_news':      ('חדשות ודיבור', 'News & talk', 'Новости и разговор'),
    'r_pop':       ('פופ ולהיטים', 'Pop & hits', 'Поп и хиты'),
    'r_rock':      ('רוק', 'Rock', 'Рок'),
    'r_classical': ('קלאסית', 'Classical', 'Классика'),
    'r_jazz':      ('ג׳אז', 'Jazz', 'Джаз'),
    'r_oriental':  ('מזרח תיכון', 'Middle East', 'Ближний Восток'),
    'r_kids':      ('ילדים', 'Kids', 'Детям'),
    'r_religious': ('יהדות ומסורת', 'Jewish & religious', 'Религия'),
    'usa':         ('ארה"ב', 'USA', 'США'),
    'uk':          ('בריטניה', 'UK', 'Великобритания'),
    'ukraine':     ('אוקראינה', 'Ukraine', 'Украина'),
    # 6.5.1: one sentence per menu row - the BN view shows it in the panel beside the list (it was empty)
    'd_aio': ('שם משתמש וסיסמה אחת מחברים את כל השירותים במכשיר הזה בבת אחת.',
              'One user name and password connect every service on this device at once.',
              'Одно имя пользователя и пароль подключают все сервисы на этом устройстве сразу.'),
    'd_hub_search': ('חיפוש אחד בכל המקורות: סרטים, סדרות, ערוצים, רדיו וטלגרם.',
                     'One search across every source: films, series, channels, radio and Telegram.',
                     'Один поиск по всем источникам: фильмы, сериалы, каналы, радио и Telegram.'),
    'd_movies': ("סרטים לפי פופולריות, דירוג, ז'אנר, שפה ושנה - וחיפוש.",
                 'Films by popularity, rating, genre, language and year - and search.',
                 'Фильмы по популярности, рейтингу, жанру, языку и году - и поиск.'),
    'd_series': ("סדרות לפי פופולריות, דירוג, ז'אנר, שפה ושנה - וחיפוש.",
                 'Series by popularity, rating, genre, language and year - and search.',
                 'Сериалы по популярности, рейтингу, жанру, языку и году - и поиск.'),
    'd_tv': ('ערוצי טלוויזיה בשידור חי מישראל ומהעולם, עם לוח שידורים.',
             'Live TV channels from Israel and the world, with a guide.',
             'Прямые ТВ-каналы Израиля и мира с программой передач.'),
    'd_radio': ('תחנות רדיו מישראל ומהעולם, לפי סגנון ובחיפוש.',
                'Radio stations from Israel and the world, by style and by search.',
                'Радиостанции Израиля и мира: по стилю и поиском.'),
    'd_tg_menu': ('התפריטים של מנוע הטלגרם: הערוצים שלי, Chiko Media והחשבון.',
                  "The Telegram engine's own menus: my channels, Chiko Media and the account.",
                  'Меню движка Telegram: мои каналы, Chiko Media и аккаунт.'),
    'd_history': ('מה שנצפה כאן, החדש למעלה. לחיצה מנגנת שוב.',
                  'What was watched here, newest first. A press plays it again.',
                  'Что смотрели здесь, новое сверху. Нажатие запускает снова.'),
    'd_favourites': ('הסרטים, הסדרות, הערוצים והתחנות ששמרת.',
                     'The films, series, channels and stations you saved.',
                     'Сохранённые фильмы, сериалы, каналы и станции.'),
    'd_src_menu': ('מאיפה מגיע התוכן: מקורות לסרטים ולסדרות, טלוויזיה, רדיו, טלגרם וכתוביות.',
                   'Where the content comes from: sources for films and series, TV, radio, Telegram and subtitles.',
                   'Откуда берётся контент: источники фильмов и сериалов, ТВ, радио, Telegram и субтитров.'),
    'd_accounts': ('החיבורים לשירותים: Real-Debrid, שרתי Stremio, אתרי כתוביות ומפתחות - מה מחובר ומה חסר.',
                   'Service logins: Real-Debrid, Stremio servers, subtitle sites and keys - what is connected and what is missing.',
                   'Входы в сервисы: Real-Debrid, серверы Stremio, сайты субтитров и ключи - что подключено и чего не хватает.'),
    'd_bk_menu': ('סנכרון אוטומטי בין מכשירים, גיבוי לקובץ, שחזור ו-Google Drive.',
                  'Automatic sync between devices, backup to a file, restore and Google Drive.',
                  'Автосинхронизация между устройствами, копия в файл, восстановление и Google Drive.'),
    'd_sys_menu': ('הגדרות Kodi, סוג המכשיר, מצב המערכת ועדכון הבילד.',
                   'Kodi settings, the device type, system status and the build update.',
                   'Настройки Kodi, тип устройства, состояние системы и обновление сборки.'),
    'd_kodi_settings': ('ההגדרות של Kodi עצמו: תצוגה, שמע, נגן ורשת.',
                        "Kodi's own settings: display, audio, player and network.",
                        'Настройки самого Kodi: экран, звук, плеер и сеть.'),
    'd_profile_pick': ('התאמת הבילד למכשיר: קופסה חלשה, טלוויזיה, מחשב או רכב.',
                       'Fits the build to the device: a weak box, a TV, a computer or a car.',
                       'Подстройка сборки под устройство: слабая приставка, ТВ, компьютер или автомобиль.'),
    'd_status': ('מה פועל ומה לא: שירותים, חיבורים וגרסאות.',
                 'What works and what does not: services, logins and versions.',
                 'Что работает, а что нет: службы, входы и версии.'),
    'd_src_video': ('מקורות לסרטים ולסדרות: ספריות, שרתי Stremio, Real-Debrid וטלגרם.',
                    'Sources for films and series: libraries, Stremio servers, Real-Debrid and Telegram.',
                    'Источники фильмов и сериалов: библиотеки, серверы Stremio, Real-Debrid и Telegram.'),
    'd_src_live': ('מקורות לטלוויזיה חיה: רשימות M3U, Xtream ולוח שידורים.',
                   'Sources for live TV: M3U lists, Xtream and the guide.',
                   'Источники прямого ТВ: списки M3U, Xtream и программа передач.'),
    'd_src_radio': ('תחנות הרדיו והמוזיקה.', 'Radio and music stations.', 'Радио и музыкальные станции.'),
    'd_src_tg': ('הערוצים, הקבוצות והבוטים בטלגרם, וחשבון הטלגרם.',
                 'Telegram channels, groups and bots, and the Telegram account.',
                 'Каналы, группы и боты Telegram и сам аккаунт.'),
    'd_src_subs': ('אתרי הכתוביות, המפתחות ותרגום ה-AI.', 'Subtitle sites, keys and AI translation.',
                   'Сайты субтитров, ключи и перевод ИИ.'),
    'd_libs': ('ספריות התוכן המותקנות: הפעלה, כיבוי והתקנה.',
               'The installed content libraries: switch on, off and install.',
               'Установленные библиотеки контента: включение, выключение и установка.'),
    'd_src_iptv': ('הוספה ועריכה של רשימות M3U, חשבונות Xtream וכתובת לוח השידורים (EPG).',
                   'Add and edit M3U lists, Xtream accounts and the guide (EPG) address.',
                   'Добавление и правка списков M3U, аккаунтов Xtream и адреса программы (EPG).'),
    'd_tg_channels': ('הערוצים, הקבוצות והבוטים שמהם מגיעים הקבצים.',
                      'The channels, groups and bots the files come from.',
                      'Каналы, группы и боты, откуда приходят файлы.'),
    'd_tg_account': ('החיבור לטלגרם: מצב, כניסה ויציאה.', 'The Telegram login: state, log in and log out.',
                     'Вход в Telegram: состояние, вход и выход.'),
    'd_subs_keys': ('אילו אתרי כתוביות פעילים, המפתחות שלהם ותרגום ב-AI.',
                    'Which subtitle sites are on, their keys, and AI translation.',
                    'Какие сайты субтитров включены, их ключи и перевод ИИ.'),
    'd_backup': ('שומר את ההגדרות, החיבורים והרשימות לקובץ אחד.',
                 'Saves the settings, logins and lists to one file.',
                 'Сохраняет настройки, входы и списки в один файл.'),
    'd_restore': ('מחזיר הגדרות, חיבורים ורשימות מקובץ גיבוי.',
                  'Brings settings, logins and lists back from a backup file.',
                  'Возвращает настройки, входы и списки из файла копии.'),
    'd_gdrive': ('גיבויים ב-Google Drive, שחזור מהם וקובצי הווידאו שבכונן.',
                 'Backups on Google Drive, restore from them, and the video files on the drive.',
                 'Копии на Google Drive, восстановление из них и видеофайлы на диске.'),
    'd_sync_screen': ('מה מסתנכרן במכשיר הזה, המכשירים בחשבון והסיסמה למפתחות.',
                      'What this device syncs, the devices in the account and the passphrase for the keys.',
                      'Что синхронизирует это устройство, устройства аккаунта и пароль для ключей.'),
    'd_aio_login': ('מחבר את המכשיר הזה לכל השירותים עם שם משתמש וסיסמה אחת.',
                    'Connects this device to every service with one user name and password.',
                    'Подключает это устройство ко всем сервисам одним именем и паролем.'),
    'd_aio_save': ('שומר או מעדכן בחיבור הכולל את מה שמחובר במכשיר הזה.',
                   'Saves or updates in All in one what is connected on this device.',
                   'Сохраняет или обновляет в «Всё в одном» то, что подключено на этом устройстве.'),
    'd_search': ('חיפוש לפי שם, עם השלמות והיסטוריית חיפושים.',
                 'Search by name, with suggestions and the search history.',
                 'Поиск по названию, с подсказками и историей поиска.'),
    'd_trending': ('מה שצופים בו הכי הרבה השבוע.', 'What is watched most this week.',
                   'Что смотрят больше всего на этой неделе.'),
    'd_popular': ('הכותרים הפופולריים ביותר כרגע.', 'The most popular titles right now.', 'Самые популярные сейчас.'),
    'd_top_rated': ('הכותרים עם הדירוג הגבוה ביותר.', 'The titles with the highest rating.', 'С самым высоким рейтингом.'),
    'd_now_playing': ('סרטים שיצאו לאחרונה.', 'Films released recently.', 'Недавно вышедшие фильмы.'),
    'd_il_movies': ('סרטים ישראליים.', 'Israeli films.', 'Израильские фильмы.'),
    'd_il_series': ('סדרות ישראליות.', 'Israeli series.', 'Израильские сериалы.'),
    'd_family': ('סרטים לכל המשפחה.', 'Films for the whole family.', 'Фильмы для всей семьи.'),
    'd_docu': ('סרטים וסדרות תיעודיים.', 'Documentaries.', 'Документальные.'),
    'd_on_air': ('סדרות שמשודרות עכשיו, עם פרקים חדשים.', 'Series on air now, with new episodes.',
                 'Сериалы в эфире с новыми сериями.'),
    'd_kids_tv': ('סדרות לילדים.', 'Series for children.', 'Детские сериалы.'),
    'd_genres': ("בחירה לפי ז'אנר: פעולה, קומדיה, דרמה ועוד.", 'Pick by genre: action, comedy, drama and more.',
                 'Выбор по жанру: боевик, комедия, драма и другие.'),
    'd_languages': ('בחירה לפי שפת המקור.', 'Pick by original language.', 'Выбор по языку оригинала.'),
    'd_years': ('בחירה לפי שנת יציאה.', 'Pick by year of release.', 'Выбор по году выхода.'),
    'd_kukhnya': ('הסדרה הרוסית "קוכניה" (המטבח) - כל העונות.', 'The Russian series "Kukhnya" (Kitchen) - every season.',
                  'Сериал «Кухня» - все сезоны.'),
}
_LANG_INDEX = {'he': 0, 'en': 1, 'ru': 2}

# 6.5.1: a row whose whole label is gold was gold text on the gold focus bar. The row also carries its text without
# tags (property bn_plain); the focused row of the BN view draws that copy (skinpatch.plain_text).
_GOLD_RX = re.compile(r'^\s*\[COLOR (?:gold|FFE8BE5A)\](.*)\[/COLOR\]\s*$', re.S)


def plain_of(label):
    """the text of a label that is ONE gold [COLOR] from end to end, without tags; '' for any other label (pure)"""
    m = _GOLD_RX.match(label or '')
    if not m or '[COLOR' in m.group(1) or '[/COLOR]' in m.group(1):
        return ''
    return re.sub(r'\[/?(?:B|I|UPPERCASE|LOWERCASE|CAPITALIZE|LIGHT)\]', '', m.group(1)).strip()


def mark_plain(li, label):
    """sets bn_plain on a list item whose label is all gold. -> the item"""
    p = plain_of(label)
    if p:
        li.setProperty('bn_plain', p)
    return li


def gold_item(text, bold=False):
    """a list item with a gold label that stays readable on the gold focus bar"""
    import xbmcgui
    return mark_plain(xbmcgui.ListItem(('[COLOR gold][B]%s[/B][/COLOR]' if bold else '[COLOR gold]%s[/COLOR]') % text),
                      '[COLOR gold]%s[/COLOR]' % text)


def ui_lang():
    code = xbmc.getLanguage(xbmc.ISO_639_1) or 'en'
    return code if code in _LANG_INDEX else 'en'


def T(key):
    row = STRINGS.get(key)
    return row[_LANG_INDEX[ui_lang()]] if row else key


def tmdb_lang():
    choice = ADDON.getSetting('content_lang')
    table = {'1': 'he-IL', '2': 'en-US', '3': 'ru-RU'}
    if choice in table:
        return table[choice]
    return {'he': 'he-IL', 'ru': 'ru-RU'}.get(ui_lang(), 'en-US')


_MON = None


def monitor():
    """ONE xbmc.Monitor per Python process, created once and never freed.
    Kodi delivers every notification (playback start/stop ...) to all live Monitors; a Monitor created in a
    short-lived thread and freed while Kodi was delivering one crashed Kodi (access violation in python3.8.dll)."""
    global _MON
    if _MON is None:
        _MON = xbmc.Monitor()
    return _MON


def log(msg, level=xbmc.LOGINFO):
    xbmc.log('[NovaTV] %s' % msg, level)


# ---------------------------------------------------------------- storage
def _path(name):
    return os.path.join(PROFILE, name)


# 3.3: the small files that hold what the user made (a copy "<name>.bak" is kept before each write); big caches
# are not copied
_USER_FILES = ('history.json', 'favourites.json', 'favourites_removed.json', 'iptv.json', 'providers.json')
_COMPACT = ('yt_cache', 'radio_cache')      # big caches: written without indentation


def load(name, default):
    # 3.3: only a file that does not exist means "nothing yet". A read that failed for a moment (another process
    # is replacing the file) used to return the default too, and the callers that read, change and write back
    # (favourites, history) then saved an almost empty file over the user's data
    path = _path(name)
    if not os.path.exists(path):
        return default
    for attempt in range(3):
        try:
            with open(path, encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            if attempt < 2:
                time.sleep(0.05)
    try:
        with open(path + '.bak', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def save(name, data):
    import threading
    tmp = _path('%s.%d.tmp' % (name, threading.get_ident()))   # parallel savers never share one temp file
    dst = _path(name)
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=None if name.startswith(_COMPACT) else 1)
            f.flush()
            os.fsync(f.fileno())                # 3.3: on disk before it replaces the good file (power cut on a box)
        if name in _USER_FILES and os.path.exists(dst):
            try:                                # 3.3: the last good copy, only when it really is readable JSON
                with open(dst, encoding='utf-8') as f:
                    json.load(f)
                import shutil
                shutil.copyfile(dst, dst + '.bak')
            except Exception:
                pass
        for attempt in range(5):                # 3.3: Windows - another process has the file open for a moment
            try:
                os.replace(tmp, dst)
                return
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.04)
    finally:
        if os.path.exists(tmp):                 # the write or the replace failed: no stray temp files
            try:
                os.remove(tmp)
            except OSError:
                pass


def flag(key, value=None):
    """one-time answers (device type, app offer) in firstrun.json, written at once. Kodi's add-on settings were
    not always flushed to disk on Android when the app was closed, so the questions came back on every start."""
    data = load('firstrun.json', {})
    if value is None:
        return data.get(key) or ADDON.getSetting(key)
    data[key] = value
    save('firstrun.json', data)
    try:
        ADDON.setSetting(key, value)
    except Exception:
        pass
    return value


# ---------------------------------------------------------------- TMDb
TMDB = 'https://api.themoviedb.org/3'
IMG = 'https://image.tmdb.org/t/p/'


def _tmdb_auth():
    key = ADDON.getSetting('tmdb_key').strip()
    if key:
        return ({}, {'Authorization': 'Bearer ' + key}) if len(key) > 40 else ({'api_key': key}, {})
    # 3.1: the read token the build ships with lives in TeleNova's own settings (POV is no longer part of the build)
    token = ADDON.getSetting('tmdb_token').strip()
    if not token:
        token = legacy_tmdb_token()
        if token:
            try:
                ADDON.setSetting('tmdb_token', token)
            except Exception:
                pass
    return {}, ({'Authorization': 'Bearer ' + token} if token else {})


def legacy_tmdb_token():
    """boxes updated from a build that had POV: the token it shipped with, read once and kept"""
    import xbmc
    if not xbmc.getCondVisibility('System.HasAddon(plugin.video.pov)'):
        return ''                       # 3.3: a build without POV has nothing to read (and no EXCEPTION log line)
    try:
        token = xbmcaddon.Addon('plugin.video.pov').getSetting('tmdb_read_token')
    except Exception:
        token = ''
    if not token:
        try:
            import re
            px = xbmcvfs.translatePath('special://home/addons/plugin.video.pov/resources/settings.xml')
            with open(px, encoding='utf-8') as f:
                m = re.search(r'id="tmdb_read_token"[^>]*default="([^"]+)"', f.read())
            token = m.group(1) if m else ''
        except Exception:
            token = ''
    return token


_CACHE_TTL = 6 * 3600


_SESSION = None


def _session():
    """one keep-alive connection pool per plugin run: a list page fetches 20 details in parallel, and a new TLS
    handshake per title cost ~0.3-1 s each on slow links (1.4.8)"""
    global _SESSION
    if _SESSION is None:
        import requests
        from requests.adapters import HTTPAdapter
        s = requests.Session()
        s.mount('https://', HTTPAdapter(pool_connections=4, pool_maxsize=24))
        _SESSION = s
    return _SESSION


_ROUTE = []


def _tmdb_route():
    # 4.2.4: a car box on a phone's hotspot could not reach api.themoviedb.org at all
    if not _ROUTE:
        from .netfix import Failover

        def get(url, headers, timeout):
            return _session().get(url, headers=headers, timeout=timeout).text
        _ROUTE.append(Failover((TMDB, 'https://api.tmdb.org/3'), get, log))
    return _ROUTE[0]


def tmdb(path, **params):
    import hashlib
    params.setdefault('language', tmdb_lang())
    q, headers = _tmdb_auth()
    params.update(q)
    ck = hashlib.md5((path + json.dumps(params, sort_keys=True)).encode()).hexdigest()
    cdir = _path('cache')
    os.makedirs(cdir, exist_ok=True)
    cfile = os.path.join(cdir, ck + '.json')
    if os.path.exists(cfile) and time.time() - os.path.getmtime(cfile) < _CACHE_TTL:
        try:
            with open(cfile, encoding='utf-8') as f:
                return json.load(f)
        except (ValueError, OSError):           # 3.3: a half-written / unreadable cache file: ask the network
            pass
    try:
        def one(base):
            r = _session().get(base + path, params=params, headers=headers, timeout=(4, 10))
            r.raise_for_status()
            return r.json()
        data = _tmdb_route().call(one)        # 4.2.4: other name / DNS over HTTPS when the network fails
    except Exception:
        # 3.3: TMDb unreachable: the old answer (past its 6 h) is better than an error screen
        try:
            with open(cfile, encoding='utf-8') as f:
                return json.load(f)
        except (ValueError, OSError):
            pass
        raise
    try:
        import threading
        tmp = cfile + '.%d.tmp' % threading.get_ident()     # 3.3: never a half-written file under the real name
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f)
        os.replace(tmp, cfile)
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass
    return data


def art(item):
    a = {}
    if item.get('poster_path'):
        a['poster'] = a['thumb'] = IMG + 'w500' + item['poster_path']
    if item.get('backdrop_path'):
        a['fanart'] = IMG + 'w1280' + item['backdrop_path']
    if item.get('still_path'):
        a['thumb'] = IMG + 'w500' + item['still_path']
    return a


def now_str(ts=None):
    return time.strftime('%d/%m/%Y %H:%M', time.localtime(ts or time.time()))
