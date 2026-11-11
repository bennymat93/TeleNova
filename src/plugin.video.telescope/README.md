# TeleScope AI – Kodi add-on (Kodi 19 Matrix → 22)

## התקנה והגדרה (עברית)
1. קודי > הגדרות > מערכת > הרחבות > הפעל "מקורות לא ידועים".
2. הרחבות > התקנה מקובץ ZIP > בחר `plugin.video.telescope-1.0.0.zip`.
3. בהפעלה הראשונה השירות מוריד מ-PyPI את רכיבי טלגרם (Telethon, pyaes, rsa, pyasn1), מאמת SHA-256 ומתקין בתיקיית הפרופיל.
4. בהגדרות ההרחבה הזן:
   * **API ID / API hash** – בחינם ב-https://my.telegram.org > API development tools.
   * **מפתח TMDB** (מומלץ, חינמי) – בלעדיו ההרחבה עובדת עם Cinemeta (באנגלית בלבד).
   * **מפתח Gemini** (אופציונלי) – מ-https://aistudio.google.com – מפעיל הרחבת שמות ואימות AI.
5. "חשבון ומצב" > התחברות בטלפון או בקוד QR.
6. הצטרף לערוצים/קבוצות טלגרם שמהם תרצה לצפות. החיפוש עובר על כל הצ'אטים שאתה חבר בהם.

## Architecture
```
default.py  -> router.py      Kodi menus (TMDB/Cinemeta catalogs, Hebrew/Russian sections, search, Telegram browser)
service.py  -> service.py     long-lived service: Telethon session + local HTTP server (127.0.0.1)
                 tgclient.py  asyncio loop thread, login (phone/QR/2FA), global + per-chat search, chunk download
                 stream.py    Range proxy, LRU chunk cache, parallel read-ahead, JSON-RPC for the plugin
                 sources.py   search pipeline: aliases -> queries -> parse -> strict match -> AI -> live probe -> rank
                 parser.py    release-name/caption parser (S01E02, 1x02, עונה 2 פרק 3, ע2 פ3, 2 сезон 3 серия ...)
                 matcher.py   exact-match rules (episode/season/year/runtime/sequel guard) + scoring
                 gemini.py    Gemini REST (model auto-discovery, JSON output)
                 meta.py      TMDB v3/v4 + Cinemeta fallback, translations/alternative titles
                 aesfast.py   fast AES-256-IGE (OpenSSL via ctypes / PyCryptodome) patched into Telethon
                 deps.py      PyPI wheel bootstrapper with SHA-256 verification
```

## Link quality guarantees
* Episodes: season **and** episode must match exactly; season packs, other episodes, trailers, archives rejected.
* Movies: year ±1, TMDB runtime vs. real video duration, sequel-number guard, CAM filter.
* Every shown link (configurable count) is probed live: first MiB downloaded, container magic verified
  (MKV/MP4/AVI/TS), throughput measured against the file bitrate; dead, fake or too slow links are hidden.
* The probed first MiB is kept in cache, so playback starts instantly.
