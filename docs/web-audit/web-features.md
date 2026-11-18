# TeleNova Web - what the browser version really implements today

Audit date: 2026-11-18. Web version in `web/version.js:4` = **4.2.8** (Kodi add-on `src/plugin.video.nova/addon.xml` = 4.2.9).
Scope: `web/*.js`, `web/index.html`, `web/style.css`, `web/sw.js`, `web/data/`, `worker/`. Analysis only - no file was changed.
All findings below come from reading the code paths; nothing was verified against a live Telegram account, a TMDb key
or a deployed Worker. Items marked **(code-read)** are defects derived from the code, not reproduced in a browser.

## 0. Baseline (tests and syntax)

| Check | Result |
|---|---|
| `cd src/qa/web && python run_web_tests.py` | **WEB TESTS OK** - 4974 syncdoc calls, 40 document rounds x 24 orders, 11+12 sealed files both directions, store/sync tests, Kodi+browser tests, 561 texts with identical keys in he/en/ru, 14 local files in static checks |
| `node --check` on every `web/*.js` (36 files) and `worker/index.js` | all pass, no output |
| `cd worker && node test.mjs` | **WORKER TESTS FAILED 3** - the three "auth passed, origin dropped" checks for `www.ktuvit.me`, `epgshare01.online`, `www.youtube.com` fail. The Worker now deliberately drops `Authorization` for hosts it does not belong to (`worker/README.md` "Each secret header goes only to the hosts it belongs to"), the test (`worker/test.mjs`) still expects it to pass everywhere. Stale test, not run by `run_web_tests.py`. |
| i18n keys used through `TN.t('literal')` / `t()` / `N()` / `X()` (431 keys) | all defined. Missing only for dynamic keys: `m_catalog`, `m_tglogin` (see 3.1) |

What the tests do NOT cover (so "WEB TESTS OK" says nothing about them): every page render, the player, sources,
Telegram login/search/playback, catalogue, live TV, YouTube, subtitles, the Worker client. Node tests exist only for the
pure parts (`t_matcher.js`, `t_sources.js`, `t_srt.js`, `t_store.js`, `t_tgsearch.js`, `t_texts.js`, `t_web.js`).

## 1. Architecture as it is

- One static page (`web/index.html`), no build step. Shell = `version.js`, `i18n.js`, `syncdoc.js`, `store.js`, `websync.js`, `app.js` (1246 lines). hls.js 1.5.13 from jsDelivr with SRI.
- `app.js:959-971` `MODULES` = 24 lazy modules; every module file listed there exists in `web/` (so **no page is a "coming soon" stub today** - `stubPage`, `app.js:1018-1024`, only shows if a module file fails to load).
- `app.js:202-205`: main menu = 20 tiles (`MENU`), top bar = 9 links (`NAV`). Emoji icons, no artwork.
- Router: hash routes `#/<key>/<arg>` (`app.js:1155-1180`). All detail views and the player are drawn inside one modal sheet (`#modal`, `app.js:449-461`) - there is no real player page, no fullscreen layout of its own.
- Service worker `web/sw.js`: network-first shell cache + the `/tgstream/<key>` Range proxy for Telegram playback. Registered only when `location.protocol === 'https:'` (`app.js:1245`).
- CSP (`web/index.html:8`): `frame-src https://www.youtube-nocookie.com https://archive.org` only; `connect-src 'self' https: wss://*.web.telegram.org`.
- Helper Worker (`worker/index.js`, client `web/helper.js`): optional, **not deployed/configured by default** (`cfg.helper` empty). `helper.js` is not in `MODULES` nor in the SW precache list (`sw.js:12-14`); modules load it with `TN.loadScript('helper.js')`.

## 2. Feature table - page keys

State: **Impl** = works end to end as coded; **Partial** = works with gaps or only under a precondition; **Stub** = placeholder / tells the viewer to use Kodi.

| Page key (module) | State | Evidence | What works | Missing / broken |
|---|---|---|---|---|
| home (app.js) | Impl | `app.js:552-561` | 20 tiles in Kodi root order | Plain emoji tile grid; no "continue watching", no posters, no rows. `youtube` and `topics` pages are not in the menu (reachable only from two cards on the hub page, `hub.js:149-150`) |
| `hub` (hub.js) | Impl | `hub.js:141-151` | Search box, 12 recent searches, links to Topics / YouTube | - |
| `search` (hub.js) | Partial | `hub.js:153-220` | All `search` providers in parallel with per-provider sections, "best matches", S/E parsing of the query (`hub.js:40-56`) | Dailymotion results cannot play (CSP, see 3.2). YouTube section silent unless key/helper. Result cards from iptv / radio / tgsearch pass `kind: 'live'/'radio'/'tg'` (`iptv.js:270`, `radio.js:142`, `tgsearch.js:318`) which `hub.js:210` uses as the card CSS class - no such classes in `style.css`, so they render as tall poster cards with an empty image **(code-read)** |
| `searchhist` (app.js) | Impl | `app.js:1049-1072` | List, remove one, clear all (synced through store) | - |
| `movies`, `tv`, `catalog` (catalog.js) | Partial | `catalog.js:464-471` | With a TMDb key: trending / popular / top / now playing / Israeli / family / documentary / genres / languages / years (1950-now) / Kukhnya, infinite scroll, favourite star, search (TMDb + Telegram files), seasons, episodes with watched mark, Hebrew plot translation through Gemini | **Needs a TMDb key** (viewer's own or synced from Kodi); without it only 40 Internet Archive classics (`catalog.js:195-204`). No "continue watching", no cast / similar / collections, no watchlist. **Movie "Play" button is missing on a fresh load** (see 3.3) |
| title sheet (app.js `openTitle`) | Partial | `app.js:463-493` | Trailer (YouTube embed), poster, plot, favourite, "Watch free on Internet Archive", history entry | "Play" comes only from the `sources.js` title hook (3.3). Fixed button "Open in the BN Stream app" is only a link to the site root (`app.js:476`). No cast, rating details, seasons inside the sheet |
| sources sheet (sources.js, service) | Partial | `sources.js:273-312` | Groups: Telegram, Real-Debrid (Torrentio), Stremio addon servers, Internet Archive, YouTube, Dailymotion; progressive results, errors per source, settings (addon URLs, RD token) | YouTube rows never play (3.4); YouTube rows show "NaN MB" (3.4); torrent rows are disabled; Dailymotion rows open a new tab; no auto-play of best source; resume is a hint only (`src_start` text defined, never used) |
| player (player.js, service) | Partial | `player.js:71-239` | `<video>` in the sheet, HLS via hls.js, resume point (synced inside history `progress`, `app.js:245-267`), speed, audio tracks, subtitles list + offset, next episode, Telegram fallbacks | Lives inside the modal sheet: no own controls, no keyboard / remote seek keys, no quality switch, no skip intro, no stats. Subtitle search bypasses `subs.js` ranking and its menu (3.6). MKV / HEVC / AC3 files do not play in most browsers ("try another link") |
| `live` (iptv.js + epg.js) | Partial | `iptv.js:193-257` | Build's Israeli table (37 channels), iptv-org lists (il/he/ru/en/kids/docs/news/music), world by country, groups, text filter, dead-stream check, multi-URL failover, now/next bar + guide sheet from `data/epg_il.json` (104 channels, generated 2026-11-17 20:09 UTC by a GitHub workflow) | **16 of the 37 Israeli channels are "Plays in Kodi only"** (15 Idan+: keshet12, ch24, comedy13, nofesh13, reality13, eretz, savri, kcomedy, kdrama, kmusic, kfood, keshet12c, knesset99c, kotel, radius100; 1 YouTube: pervoe891). http streams hidden. No own M3U / Xtream playlists, no PVR, no catch-up, no channel logos for the `tn` list (`app.js:343` sets `logo: ''`), guide only for Israel |
| `radio` (radio.js) | Impl | `radio.js:98-134` | radio-browser with 3 mirror servers, country / language / style chips, search, bottom bar player, favourites, history | http-only stations hidden ("In Kodi they work"). No "recently played" row |
| `telegram` (telegram.js + tgsearch.js) | Partial | `telegram.js:328-333` | After login: my chats (pin, join, leave, similar), videos of a chat with in-chat search, free file search, AI search (Gemini), channel discovery presets, Chiko Media list | Root tiles Movies / Series / Hebrew / Russian / Kids are plain TMDb links (`telegram.js:124-128`), not Telegram content. No chat pictures (`TN.card('', ...)`). Bot search is a stub that always throws (`tgsearch.js:277-280`). AI search needs a Gemini key synced from Kodi - no field to type one on the web. `telegram_quiet` has no UI. Pasted t.me links are not handled (3.5) |
| `tglogin` (tglogin.js + tg.js) | Partial | `tglogin.js:83-274`, `tg.js:150-232` | QR login, phone login (SendCode / ResendCode / SignIn / 2FA), pairing link `#pair=`, manual API id/hash, keep-me-connected, one-tab lock | **Needs the account's own API ID + API Hash first** (pairing QR from Kodi or my.telegram.org); nothing built in. Phone flow: details in `docs/web-audit/tg-phone-login.md`; note `tg.js:150` - when the account has another active session Telegram delivers the code inside the Telegram app, not by SMS, and the only hint is one line of text. `disconnect()` also deletes the API details (`tg.js:137`), so re-login starts from pairing again. Not covered by any test |
| Telegram playback (tgplay.js + sw.js) | Partial | `tgplay.js:167-175`, `sw.js:57-73` | Streams through the SW Range proxy, 512 KB parts, LRU cache, file-reference refresh, flood wait, blob fallback under 300 MB, "open in Telegram" | Needs a controlling service worker (https or localhost; first visit waits up to 4 s). Plays opened from a title go to the player with `resumeKey: 'tg:chat:msg'` and no `history` / `meta` / `next` / `back` (`tgsearch.js:288-290`) - so a film or episode played from Telegram is **not** marked watched, has no next-episode button, no "another link" and subtitle search gets no IMDb id **(code-read)** |
| `history` (app.js) | Partial | `app.js:695-719` | List with pictures, opens TMDb titles / IA / radio / channels / YouTube / Dailymotion, clear all | Entries written by Kodi that are not a TMDb title or https stream show "Plays in Kodi only" (`app.js:680-683`, 693). No per-item remove, no progress bar, no grouping. Episode rows resume only after `sources.js` was loaded (3.3) |
| `favs` (app.js) | Partial | `app.js:646-660` | Movies / series / live / radio sections, lazy posters | **YouTube favourites are saved but never shown**: `yt.js:227` saves kind `web_yt`, `favView` has no such case and returns null (`app.js:643`) **(code-read)**. Kodi PVR channels and http radio favourites are "Kodi only". No remove from the list itself, no sorting |
| `users` (app.js) | Impl | `app.js:722-760` | Create / switch / rename / delete, synced | No PIN / avatar (check against Kodi report) |
| `settings` (app.js) | Partial | `app.js:838-868` | Language, theme, start channel list, start radio country, TMDb key, install as app, clear favourites / history / searches, Telegram sync panel | No helper URL here (it is on the Services page although `worker/README.md` step 4 says Settings). No device profile here (separate `device` page). No content language, quality, subtitle, player or provider settings. `subs_os_key`, `subs_server_url`, `subs_size/color/bg`, `telegram_quiet`, `tgsearch_bots`, `gemini_key` are read by modules but have **no UI anywhere** |
| `services` (services.js) | Partial | `services.js:126-208` | Telegram state + sync now, TMDb state, helper URL field, Gemini key test, update app, clear cache, reset settings, paste link | Real-Debrid row says "Needs the helper" and has no token field, although token mode works without the helper and the field exists only inside the sources sheet (`sources.js:336`, `rd.js:84-99`). Trakt: "Kodi only" (`services.js:185`). Paste of t.me and YouTube links is dead (3.5). No RD device-code login, no account expiry without helper |
| `device` (services.js) | Impl | `services.js:211-225` | auto / TV / phone / desktop class on `<html>` | Only changes sizes; no real layouts per device |
| `library` (library.js) | Partial | `library.js:33-61` | On/off switches for tgsearch, rd, yt, iptv, radio, hub, subs | Switches `hub` and `subs` do nothing: providers are registered as `dailymotion` / `tmdb` / `archive` and `wizdom` / `opensubs` / ... (`hub.js:91-111`, `subs.js:645-653`), `providerOn` is checked by provider name (`app.js:1005`) **(code-read)**. Seven rows are a static "Kodi only" list (POV, Fen Light, The Loop, All Subs, IPTV Simple, TeleScope, YouTube (Kodi)) |
| `backup` (backup.js) | Impl | `backup.js:150-181` | Zip in the Kodi backup shape, download, restore (merge), optional browser settings | Backup holds the TMDb key in clear (stated in the note) |
| `gdrive` (gdrive.js) | Partial | `gdrive.js:113-166` | OAuth implicit flow, upload backup, list / restore backups, list videos | **Viewer must create and paste a Google OAuth client id** - none is built in (`gdrive.js:4`). Videos only say "plays in Kodi" (`gdrive.js:161`). Token lasts one hour |
| `status` (status.js) | Impl | `status.js:54-93` | Online, SW, Telegram, helper ping, service pings (no-cors), speed test | Pings are opaque (`no-cors`): "OK" only means the host answered |
| `help` (help.js) | Partial | `help.js:28-80` | Searchable guide + troubleshooting from `data/help/*.json`, he/en | Guide text is the Kodi guide ("some screens look different on the web"); no Russian |
| `youtube` (yt.js) | Partial | `yt.js:259-298` | Search, channel videos, embed player, favourite, history | **Shows nothing until the viewer pastes a YouTube Data API key or sets the helper** (`yt.js:124`, 270-272). Not in the menu. `#/youtube/url=` unsupported (3.5) |
| `topics` (topics.js) | Partial | `topics.js:159-187` | 7 sections (news, knowledge, PLC, DIY, dogs, smart home, Asian) with categories, top, search | Same YouTube precondition; without it redirects to the YouTube key page (`topics.js:133`). Not in the menu |
| `bn` (app.js) | Impl | `app.js:761-769` | Download links | Hard-coded `repository.telenova-4.2.9.zip` (`app.js:765`); text says "The browser version has the free content" (stale) |
| `about` (app.js) | Impl | `app.js:1078-1092` | Version, SW state, update, clear cache | Footer text hard-codes "BN Stream Web 4.2 · legal sources only" (`app.js:32,56,80`) |

## 2b. Feature table - providers and services

| Provider (file) | Kind | State | Evidence | Notes |
|---|---|---|---|---|
| `tmdb`, `archive` (hub.js) | search | Impl | `hub.js:101-117` | tmdb needs a key |
| `dailymotion` (hub.js) | search | **Broken** | `hub.js:74-80` vs `index.html:8` | iframe to `www.dailymotion.com` is not in CSP `frame-src` -> blocked (3.2) |
| `iptv`, `radio` | search | Impl | `iptv.js:259-276`, `radio.js:136-146` | wrong card class (cosmetic) |
| `tgsearch` | search, source | Partial | `tgsearch.js:314-330` | only when signed in; ported matcher (`matcher.js`, `epmatch.js`, tested in node); bots stub |
| `yt` | search, source | Partial / broken as source | `yt.js:234-255` | needs key or helper; source rows broken (3.4) |
| `rd` | source | Partial | `rd.js:31-41` | Token pasted by the viewer; links through Torrentio RD mode - **the RD token travels in the URL path** (`rd.js:36`), against the rule in `web/MODULES.md` ("never put a token in a URL"). Kodi's synced RD login is not used. `magnet()`, `user()` need the helper; `magnet()` is called only from the Services paste box |
| Stremio addons (sources.js) | source | Impl | `sources.js:111-120` | up to 12 https manifest URLs, this browser only; only addons that send CORS headers answer |
| `sources`, `player` | service | Partial | see table 2 | - |
| `tgplay` | service | Partial | see table 2 | - |
| `epg` | service | Impl | `epg.js:101` | static JSON refreshed by `.github/workflows/epg.yml`; Israel only |
| `subs` + `wizdom`, `opensubs`, `yify`, `ktuvit`, `subsrv`, `subs_ai` (subs.js) | subs / service | Partial | `subs.js:645-653` | wizdom works direct. opensubs needs a key that has no input reachable. ktuvit needs helper + a login form that is unreachable. See 3.6 |
| `gdrive` | service | Partial | `gdrive.js:109` | see table 2 |
| `matcher`, `epmatch`, `srt`, `catalog`, `topics`, `iptv_lib` | libraries | Impl | node tests | - |

## 3. Defects found by reading the code paths

### 3.1 Raw key shown as a page title
`app.js:1168` draws `N('m_' + p)` while a module loads. `i18n.js` has no `m_catalog` and no `m_tglogin`, so opening
`#/catalog/...` or `#/tglogin` first shows the heading "m_catalog" / "m_tglogin" until the module arrives, and
permanently (with the "coming soon ... available in Kodi" panel) if the script fails to load (`app.js:1018-1024`).

### 3.2 Dailymotion cannot play (CSP)
`hub.js:77` puts `https://www.dailymotion.com/embed/video/<id>` in an iframe; `index.html:8` allows frames only from
`www.youtube-nocookie.com` and `archive.org`. Every Dailymotion search result and every `dm:` history row
(`hub.js:81-86`) opens an empty frame. Fix belongs in `index.html` (WP-0).

### 3.3 "Play" on a movie is missing until an episode was opened **(code-read)**
The Play button of the title sheet is added by `TN.addTitleAction` inside `sources.js:342-349`, and the history
resume handler by `sources.js:350-361`. `sources.js` is loaded only by `TN.provider('sources')` from
`catalog.js:398` (clicking an episode), `player.js:153` and `rd.js:33`. Nothing loads it at start-up
(no `TN.load('sources')` anywhere; `app.js:485` just runs whatever hooks exist).
Result on a fresh page load: Movies -> any film -> the sheet has only favourite / Internet Archive / "Open in the
BN Stream app". History rows `tv:<id>:<s>:<e>` open the title sheet instead of resuming. This is probably the single
biggest reason the web version feels like "free content only".

### 3.4 YouTube rows in the sources sheet **(code-read)**
`yt.js:252` returns `{url: 'https://www.youtube.com/watch?v=..', size: clock(v.secs), open}`.
`sources.js:262-266`: because `url` is set, `open()` is skipped and the watch page URL is given to `<video>` ->
"This browser cannot play this file". `sources.js:253` + `sizeText` (`sources.js:31`) print the clock string as
"NaN MB".

### 3.5 Dead deep links from "Paste link"
`services.js:101-102` sends t.me links to `#/telegram/link=<url>` and YouTube links to `#/youtube/url=<url>`.
`telegram.js:327-332` only routes by `v=`; `yt.js:259-298` only reads `q` and `ch`. Both just open the root page.

### 3.6 Subtitles: most of subs.js is unreachable
`player.js:197-210` asks each `subs` provider's `find()` itself and never calls `S.find` (ranking, Hebrew first, AI
fallback), `S.auto`, `S.menu`, `S.setStyle`, `S.ktuvitLogin`. Consequences: no automatic subtitles, no appearance
settings, no Ktuvit login form (`subs.js:508-640` never runs), no place to enter an OpenSubtitles key, results in
provider order instead of best match. The player also passes no `type`, `release` or `url`, so `subsrv` (the owner's
AI subtitle server) cannot work.

### 3.7 Smaller ones
- `web_yt` favourites invisible (`app.js:643`, table 2).
- Library switches `hub` / `subs` have no effect (table 2).
- Search cards with unknown classes `live` / `radio` / `tg` (table 2).
- Services page: RD shown as "needs helper" while token mode works without it; "Set up" for Telegram goes to `#/settings`, not `#/tglogin` (`services.js:139`).
- `tg.js:137` logout deletes the API details.
- Sync cannot start from the web: with no document in Saved Messages the state is `nodoc` and the text tells the viewer to open Kodi once (`websync.js:57`, `app.js:118/152/186`).
- `player.js:83`: a play started from the sources sheet rewrites the history entry with `play: ''`, removing the Kodi play address that `app.js:484` wrote for the same key (to verify against `store.addHistory` merge rules).
- `app.js:295`: without any TMDb key the app calls `api/tmdb` on the static host (404) once per session - a leftover of a server that does not exist on GitHub Pages; same for `api/channels` (`app.js:347`).
- `worker/test.mjs` out of date (section 0). `worker/README.md` says "Settings -> Helper URL"; the field is on Services.
- Stale texts: footer "4.2 · legal sources only", `bn_txt` "browser version has the free content", `tgs_noplayer` "Playing from Telegram is not available in the web version yet".

## 4. What depends on something the viewer does not have by default

| Needs | Features that are empty without it | Where it is set |
|---|---|---|
| TMDb key (own or synced from Kodi) | Whole movies / series catalogue, title sheets, search titles, suggestions, AI search results, sources (IMDb id) | Settings (`app.js:849`) |
| Telegram API id + hash, then login | Telegram pages, Telegram sources, sync of users / history / favourites / resume, synced TMDb + Gemini keys | `#/tglogin` (pairing from Kodi or my.telegram.org) |
| A sync document created by Kodi | Any sync at all | Kodi must run once on the account |
| YouTube Data API key **or** helper Worker | YouTube page, Topics (all 7 sections), YouTube search section and source rows | `#/youtube` key box / Services helper field |
| Helper Worker (Cloudflare, not deployed) | RD account status + magnets, Ktuvit, YouTube without a key, StremThru | Services (`services.js:150-164`) |
| Real-Debrid token pasted in the browser | RD sources (through Torrentio) | Sources sheet -> settings only |
| Google OAuth client id | Google Drive page | `#/gdrive` |
| Gemini key synced from Kodi | AI search, Hebrew plot translation, AI subtitle translation | no web input (only `catalog.js:358` reads an unsettable `gemini_key` browser setting) |
| Controlling service worker (https) | Telegram streaming | automatic |

## 5. Every place the web tells the viewer "only in Kodi" (or sends them to Kodi)

| # | Where | Text / behaviour |
|---|---|---|
| 1 | `app.js:90,124,158` `kodi_only` | "Plays in Kodi only" - card subtitle + badge `KODI` on channels (`app.js:435-436`, `iptv.js:168-169`), favourites (`app.js:655`), history rows (`app.js:706`) |
| 2 | `app.js:503-507` `kodiOnly()` sheet with a button to `#/bn` | called from `app.js:511` (Idan+ / YouTube-live channel: `kodi_idan`, `kodi_yt`), `:636` (`kodi_entry`), `:639` (PVR favourite: `kodi_pvr`), `:642` (http radio favourite), `:691`, `:693` (history entries Kodi wrote), `gdrive.js:161` |
| 3 | `app.js:95,129,163` `kodi_list_hint` | under the Israeli list (`app.js:610`, `iptv.js:255`): "Greyed channels ... play in the BN Stream app in Kodi only" - 16 of 37 channels |
| 4 | `app.js:476` | "Open in the BN Stream app" button on every title sheet |
| 5 | `app.js:29,53,77` `bn_txt` | "The browser version has the free content" |
| 6 | `i18n.js:55,88,121` `core_soon_txt` (`app.js:1021`) | "Coming soon ... available in the BN Stream app in Kodi" - shown when a module file fails to load |
| 7 | `i18n.js:57,90,123` `core_kodi_only` | defined, not used anywhere |
| 8 | `gdrive.js:22,28,34` `gd_play_kodi` | "Playing from Drive on the web is not available yet; the video plays in the Kodi app" |
| 9 | `library.js:7,12,17,25,60` `lb_kodi` | static list: POV, Fen Light, The Loop, All Subs, IPTV Simple, TeleScope, YouTube (Kodi) - "Kodi only" |
| 10 | `services.js:8,24,40,185` `sv_kodi` | Trakt: "Kodi only" |
| 11 | `iptv.js:17,24,31` `iptv_http` | "N channels are hidden: http streams ... They work in Kodi" |
| 12 | `radio.js:~14-20` `radio_http` | "N stations hidden ... In Kodi they work" |
| 13 | `tgplay.js:29,31,33` `tgplay_codec` | "MKV / HEVC / AC3 usually play only in Kodi" (defined; the player shows the generic `pl_fail` instead) |
| 14 | `app.js:118,152,186` `tg_nodoc` | "Open BN Stream in Kodi once ... it creates the document" |
| 15 | `tglogin.js` `tgl_need_api`, `app.js:107,141,175` `tg_api_about` | "scan the code BN Stream shows in Kodi (Services and accounts > Connect web version)" |
| 16 | `tgsearch.js:14,16,18` `tgs_no_ai` | "Smart search needs a Gemini key (synced from Kodi)" |
| 17 | `help.js:9,11,13` `hp_web` | "The guide was written for the Kodi app" |
| 18 | "Needs the helper (Worker)" (not Kodi, but a dead end for a normal viewer) | `services.js:168` RD, `services.js:20,36,52` magnet, `library.js:7,12,17`, `subs.js:36,42,48`, `rd.js` `rd_nohelper`, `i18n.js` `core_helper` |

## 6. Interface notes (for the redesign report)

- `style.css` is 140 minified lines: one dark/light palette, one card grid, breakpoints at 400 / 760 / 1100 / 1700 / 2400 px and an `html.tv` scale-up. Modules inject their own `<style>` blocks (`cat-`, `src_`, `pl_`, `tgl-`, `tgm-`, `sv_`, `lb_`, `st_`, `hp_`, `epg`) with inline styles in places (`rd.js:86`, `gdrive.js:125,148`).
- Every "screen" is `page()` = back link + `<h1>` + content (`app.js:402-405`); the back link always goes to the main menu unless a module rewrites it (`catalog.js:126-130`). No breadcrumbs, no side navigation, no hero / rows.
- Top bar: brand, 9 text links in a horizontally scrolling `nav`, search box; on phones the nav and the search drop to two more rows (`style.css` @760px). No bottom tab bar on phones.
- Icons are emoji; catalogue genre / language / year tiles use the Kodi art in `web/media/cats` (116 files); topics use `data/topics/img`.
- TV / keyboard: spatial arrow navigation and Back handling exist (`app.js:1194-1246`); focus ring only.
- Accessibility basics exist (`dir="auto"`, `aria-label` on inputs, `role="status"`), the modal has no focus trap.
