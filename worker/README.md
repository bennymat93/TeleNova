# TeleNova helper Worker (optional)

The TeleNova web app (https://bennymat93.github.io/TeleNova/web/) works without this.
A few services have no browser CORS: Real-Debrid auth/API, StremThru, Ktuvit, the epgshare01 EPG and YouTube
innertube (`youtubei/v1`). With this tiny Cloudflare Worker those features turn on; without it they show "needs helper".

What it does
- Relays a request to **allowlisted https hosts only**: `api.real-debrid.com`, `stremthru.13377001.xyz`,
  `stremthru.elfhosted.com`, `www.ktuvit.me`, `epgshare01.online`, `www.youtube.com` and `youtubei.googleapis.com`
  (the last two only under `/youtubei/v1/`). Anything else gets `403 {"error":"host"}`.
- Answers `https://bennymat93.github.io` plus any origins listed (comma separated) in `ALLOW_ORIGINS`, which
  ADDS to the default and never replaces it (for example `http://localhost:8811` for local testing); other origins get
  `403 {"error":"origin"}`.
- Each secret header goes only to the hosts it belongs to, and is silently dropped for any other target:
  `Authorization` -> `api.real-debrid.com` and the two StremThru hosts; `X-StremThru-Authorization` -> the StremThru
  hosts; `X-Goog-Api-Key` -> `www.youtube.com` / `youtubei.googleapis.com`. Hosts added through `ALLOW_HOSTS` never
  receive a secret header. The cookie relay (`X-TN-Cookie` -> `Cookie`, `Set-Cookie` -> `X-TN-Set-Cookie`) works
  only for `www.ktuvit.me`.
- Stores nothing and logs nothing. Your tokens pass through in headers and are not kept.
- The target URL is sent in the `X-TN-Target` header, never in a query string.
- `GET /ping` returns `{"ok":true,"app":"telenova-helper"}` so the app can test the URL.

It runs on your own free Cloudflare account, so it is a trust point only for you.

## Deploy (English)
1. Create a free account at https://dash.cloudflare.com and install Node.js 18+.
2. In this folder: `npx wrangler@3 login` (opens the browser once).
3. `npx wrangler@3 deploy`. It prints a URL like `https://telenova-helper.<you>.workers.dev`.
4. In the TeleNova web app: Settings -> Helper URL -> paste that https URL (no trailing slash) -> Save.
5. Optional: extra hosts (your own StremThru) in `ALLOW_HOSTS` in `wrangler.toml`, then deploy again.

Without the command line: Dashboard -> Workers & Pages -> Create -> "Hello World" Worker -> Edit code ->
paste `index.js` -> Deploy. `ALLOW_ORIGINS` is optional: set it under Settings -> Variables only to add more origins.

## התקנה (עברית)
1. פותחים חשבון חינמי ב-https://dash.cloudflare.com ומתקינים Node.js גרסה 18 ומעלה.
2. בתיקייה הזו מריצים: `npx wrangler@3 login` (נפתח דפדפן פעם אחת לאישור).
3. מריצים: `npx wrangler@3 deploy`. בסוף תופיע כתובת כמו `https://telenova-helper.<שם>.workers.dev`.
4. באפליקציית הווב של TeleNova: הגדרות -> כתובת עוזר (Helper URL) -> מדביקים את הכתובת (https, בלי / בסוף) -> שמירה.
5. רשות: שרת StremThru משלכם מוסיפים ב-`ALLOW_HOSTS` בקובץ `wrangler.toml` ומריצים deploy שוב.

בלי שורת פקודה: בלוח הבקרה Workers & Pages -> Create -> Worker מסוג "Hello World" -> Edit code ->
מדביקים את התוכן של `index.js` -> Deploy. `ALLOW_ORIGINS` הוא רשות: הוא רק מוסיף מקורות (origins) לברירת המחדל `https://bennymat93.github.io` ולא מחליף אותה.

כותרות סודיות עוברות רק לשרת שלהן: `Authorization` רק ל-Real-Debrid ול-StremThru, `X-Goog-Api-Key` רק ל-YouTube, ועוגיות רק ל-`www.ktuvit.me`. שרתים שנוספו ב-`ALLOW_HOSTS` לא מקבלים אף כותרת סודית.

ה-Worker לא שומר שום דבר ולא רושם לוגים. הטוקנים שלכם עוברים רק בכותרות הבקשה.

## Test
`node test.mjs` (in this folder) runs the allowlist / CORS checks with a mocked upstream.
