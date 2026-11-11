# -*- coding: utf-8 -*-
"""Kodi settings in one place (1.6.4): the screens viewers look for, one click each, with the simplest way to do the
task written under every row. Only Kodi's own windows / builtins from this fixed table can be opened."""
import xbmc
import xbmcgui
import xbmcplugin

from .common import ui_lang

# key, (he, en, ru) label, builtin, (he, en, ru) how-to shown in the info panel
ITEMS = [
    ('addon_repo', ('התקנת הרחבה מהמאגר', 'Install an add-on from a repository', 'Установить дополнение из репозитория'),
     'ActivateWindow(AddonBrowser,addons://repos/,return)',
     ('בוחרים מאגר (למשל Kodi Add-on repository) ← סוג (הרחבות וידאו) ← ההרחבה ← התקן.',
      'Pick a repository (e.g. Kodi Add-on repository) → a type (Video add-ons) → the add-on → Install.',
      'Выберите репозиторий → тип (Видеодополнения) → дополнение → Установить.')),
    ('addon_zip', ('התקנה מקובץ ZIP', 'Install from a zip file', 'Установить из zip-файла'), 'InstallFromZip',
     ('בפעם הראשונה Kodi שואל אם לאשר "מקורות לא ידועים": מאשרים בהגדרות ← מערכת ← הרחבות. אחר כך בוחרים את המקור ואת קובץ ה-ZIP.',
      'The first time Kodi asks to allow "Unknown sources" (Settings → System → Add-ons). Then pick the source and the zip.',
      'В первый раз разрешите "Неизвестные источники" (Система → Дополнения), затем выберите zip.')),
    ('addon_mine', ('ההרחבות שלי', 'My add-ons', 'Мои дополнения'), 'ActivateWindow(AddonBrowser,addons://user/,return)',
     ('כל ההרחבות המותקנות. בוחרים הרחבה ← הגדר (הגדרות), עדכן, השבת או הסר.',
      'Every installed add-on. Pick one → Configure, Update, Disable or Uninstall.',
      'Все установленные дополнения: настроить, обновить, отключить или удалить.')),
    ('addon_updates', ('עדכוני הרחבות', 'Add-on updates', 'Обновления дополнений'), 'ActivateWindow(AddonBrowser,addons://outdated/,return)',
     ('הרחבות שיש להן גרסה חדשה. בוחרים ← עדכן. עדכון מערכת של NovaTV עושה זאת גם לבד.',
      'Add-ons with a newer version. Pick → Update. NovaTV\'s System Update does this too.',
      'Дополнения с новой версией → Обновить. "Обновление системы" NovaTV делает это само.')),
    ('file_manager', ('מנהל קבצים (הוספת מקור)', 'File manager (add a source)', 'Файловый менеджер (добавить источник)'),
     'ActivateWindow(FileManager)',
     ('הוספת מקור: "הוסף מקור" ← "<כלום>" ← מקלידים כתובת (למשל https://bennymat93.github.io/TeleNova/) ← שם ← אישור.',
      'Add source → "<None>" → type the address (e.g. https://bennymat93.github.io/TeleNova/) → a name → OK.',
      'Добавить источник → "<Нет>" → адрес → имя → OK.')),
    ('video_sources', ('מקורות וידאו (תיקיות ושרתים)', 'Video sources (folders and servers)', 'Видеоисточники (папки и серверы)'),
     'ActivateWindow(Videos,sources://video/,return)',
     ('"הוסף וידאו..." ← עיון ← תיקייה במכשיר, כונן USB או שרת ברשת (SMB / NFS / UPnP).',
      '"Add videos..." → Browse → a folder, a USB drive or a network share (SMB / NFS / UPnP).',
      '"Добавить видео..." → папка, USB или сетевой ресурс.')),
    ('player', ('הגדרות נגן', 'Player settings', 'Настройки плеера'), 'ActivateWindow(PlayerSettings)',
     ('וידאו (קצב רענון, האצת חומרה), שמע, כתוביות (גופן, גודל, שפה מועדפת) ו-DVD/Blu-ray. מומלץ: רמת הגדרות "מתקדם" (גלגל השיניים למטה).',
      'Videos (refresh rate, hardware acceleration), audio, subtitles (font, size, preferred language). Tip: switch the level to "Advanced" (bottom cog).',
      'Видео, аудио, субтитры. Совет: уровень "Расширенный" (шестерёнка внизу).')),
    ('subtitles', ('כתוביות', 'Subtitles', 'Субтитры'), 'ActivateWindow(PlayerSettings,subtitles)',
     ('נפתחות הגדרות הנגן: בוחרים בצד "כתוביות" – שפה מועדפת, גופן, גודל וצבע. כתוביות AI בעברית: בהגדרות NovaTV ← כתוביות.',
      'Opens the player settings: pick "Subtitles" on the side - preferred language, font, size and colour. Hebrew AI subtitles: NovaTV settings → Subtitles.',
      'Откроются настройки плеера: слева "Субтитры". AI-субтитры: настройки NovaTV → Субтитры.')),
    ('system', ('מערכת: תצוגה, שמע, אינטרנט', 'System: display, audio, internet', 'Система: экран, звук, интернет'),
     'ActivateWindow(SystemSettings)',
     ('תצוגה (רזולוציה, כיול מסך), שמע (פלט, Passthrough), אינטרנט (Proxy), הרחבות (מקורות לא ידועים, עדכונים) ויומן.',
      'Display (resolution, calibration), Audio (output, passthrough), Internet (proxy), Add-ons (unknown sources, updates) and Logging.',
      'Экран, звук, интернет, дополнения (неизвестные источники), журнал.')),
    ('interface', ('ממשק: שפה, מקלדת, עיצוב', 'Interface: language, keyboard, skin', 'Интерфейс: язык, клавиатура, обложка'),
     'ActivateWindow(InterfaceSettings)',
     ('אזור ושפה (שפה, מקלדת עברית, שעון), עיצוב (Skin), שומר מסך ומצב הפעלה.',
      'Regional (language, Hebrew keyboard, clock), skin, screensaver and startup window.',
      'Язык, раскладки клавиатуры, обложка, заставка.')),
    ('media', ('מדיה וספרייה', 'Media and library', 'Медиа и библиотека'), 'ActivateWindow(MediaSettings)',
     ('ספריית הווידאו (סריקה, עדכון בהפעלה), תמונות ממוזערות ומידע על קבצים.',
      'Video library (scan, update on start), thumbnails and file info.',
      'Видеотека (сканирование), эскизы.')),
    ('pvr', ('טלוויזיה חיה (PVR)', 'Live TV (PVR)', 'Прямое ТВ (PVR)'), 'ActivateWindow(PVRSettings)',
     ('מדריך שידורים, ערוצים והקלטות. ערוצים ומדריך משלך מוסיפים ב-NovaTV ← חשבונות וחיבורים ← IPTV.',
      'Guide, channels and recordings. Your own channels and guide: NovaTV → Accounts → IPTV.',
      'Телегид, каналы. Свои каналы: NovaTV → Учётные записи → IPTV.')),
    ('services', ('שירותים: שלט, AirPlay, שיתוף', 'Services: remote, AirPlay, sharing', 'Службы: пульт, AirPlay'),
     'ActivateWindow(ServiceSettings)',
     ('שליטה מהטלפון (אפליקציית Kore: שליטה ← אפשר שליטה דרך HTTP), AirPlay, UPnP ושם המכשיר.',
      'Control from a phone (Kore app: Control → Allow remote control via HTTP), AirPlay, UPnP and the device name.',
      'Управление с телефона (Kore), AirPlay, UPnP, имя устройства.')),
    ('profiles', ('פרופילים', 'Profiles', 'Профили'), 'ActivateWindow(Profiles)',
     ('פרופיל לכל בן משפחה עם הגדרות ומועדפים משלו; אפשר לנעול בסיסמה.',
      'A profile per family member with its own settings and favourites; can be locked.',
      'Профиль для каждого члена семьи, можно заблокировать.')),
    ('sysinfo', ('מידע על המערכת', 'System information', 'Сведения о системе'), 'ActivateWindow(SystemInfo)',
     ('גרסת Kodi, כתובת IP, זיכרון, אחסון ומעבד. שימושי כשפונים לתמיכה.',
      'Kodi version, IP address, memory, storage and CPU. Handy when asking for help.',
      'Версия Kodi, IP, память, диск.')),
    ('eventlog', ('יומן אירועים', 'Event log', 'Журнал событий'), 'ActivateWindow(EventLog)',
     ('התקנות, עדכונים ושגיאות אחרונים.', 'Recent installs, updates and errors.', 'Последние установки, обновления, ошибки.')),
    ('nova', ('הגדרות NovaTV', 'NovaTV settings', 'Настройки NovaTV'), 'Addon.OpenSettings(plugin.video.nova)',
     ('מקורות, כתוביות, טלוויזיה חיה וכללי.', 'Sources, subtitles, live TV and general.', 'Источники, субтитры, ТВ.')),
    ('all', ('כל ההגדרות של Kodi', 'All Kodi settings', 'Все настройки Kodi'), 'ActivateWindow(Settings)',
     ('המסך הראשי של ההגדרות.', 'The main settings screen.', 'Главный экран настроек.')),
]
_BY_KEY = {i[0]: i for i in ITEMS}


def _col():
    return {'he': 0, 'en': 1, 'ru': 2}[ui_lang()]


def menu(handle, url):
    c = _col()
    for key, label, _, how in ITEMS:
        li = xbmcgui.ListItem(label[c])
        li.setArt({'icon': 'DefaultAddonProgram.png', 'thumb': 'DefaultAddonProgram.png'})
        li.getVideoInfoTag().setPlot(how[c])
        xbmcplugin.addDirectoryItem(handle, url(a='kodi_go', k=key), li, False)
    xbmcplugin.endOfDirectory(handle, cacheToDisc=False)


def go(key):
    item = _BY_KEY.get(key)
    if item:                    # fixed table only: a crafted URL cannot run another builtin
        xbmc.executebuiltin(item[2])
