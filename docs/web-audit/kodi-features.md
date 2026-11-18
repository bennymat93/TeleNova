# TeleNova (Kodi build 4.2.9) - complete feature inventory for the web port

Analysis only (no code was changed). Sources read: `src/plugin.video.nova/default.py` (router, `ACTIONS`, root menu),
`src/plugin.video.nova/service.py`, every module in `src/plugin.video.nova/resources/lib/`, `resources/settings.xml`
(setting ids only), `resources/help/*.json`, `resources/topics/*.json`, and the Telegram engine
`src/plugin.video.telescope/resources/lib/*` + its `settings.xml`. No key, hash, token or session was read out or copied.

Paths: `N/` = `src/plugin.video.nova/`, `NL/` = `src/plugin.video.nova/resources/lib/`,
`TL/` = `src/plugin.video.telescope/resources/lib/`. Numbers after a function are line numbers.

## How to read the "Browser" column

| Verdict | Meaning |
|---|---|
| **yes** | runs in a plain browser page (fetch with CORS, WebSocket, IndexedDB, `<video>`/hls.js) |
| **yes\*** | runs in the browser, but the endpoint's CORS behaviour was not measured in this audit - verify, keep the helper as fallback |
| **helper** | needs the CORS helper (`worker/`): the endpoint sends no CORS headers, needs cookies / a custom User-Agent, or is http-only |
| **kodi-only** | depends on a Kodi capability (PVR, skin, add-on manager, JSON-RPC, LAN sockets, native player). The "web equivalent" says what replaces it, when anything does |

Cross-cutting browser limits that affect many rows (not repeated in every row):

1. **Containers / codecs.** Kodi plays MKV, HEVC, AC3/DTS/E-AC3, AVI. Browsers play MP4/WebM (H.264/AAC, VP9, AV1; HEVC only
   on Safari and some Chrome/Edge hardware). Most Telegram / Real-Debrid releases are MKV. A web player needs: MKV demux in
   JS (remux to fMP4 through MSE) and a visible "this file cannot play here - open in VLC / Kodi / download" path for
   AC3/DTS/HEVC. This is the largest single functional gap and cannot be closed 100 % in any browser.
2. **Mixed content.** The site is https; http streams (many IPTV / radio entries) and `http://<PC>:8765` (AI subtitle
   server) are blocked unless proxied through an https helper.
3. **HLS.** Safari / iOS / many TV browsers play HLS natively (no CORS need for the media itself); Chrome / Firefox need
   hls.js, which needs CORS on the playlist and segments -> helper for streams without CORS.
4. **No background service.** Kodi's `service.py` runs always; a web page runs only while open (a Service Worker helps for
   caching and Telegram streaming, not for periodic jobs).
5. **No add-on ecosystem.** Anything that is "another Kodi add-on" (Idan+, YouTube add-on, All_Subs, PVR IPTV Simple, the
   skin) must be re-implemented or replaced.

---

## 1. Main menu (root) - `N/default.py:root()` 120

Order exactly as the viewer sees it. Routes are `?a=<action>`; the table of actions is `router()` 610-751, non-folder
actions are in `ACTIONS` 754-756.

| id | Menu path (viewer) | What it does | Entry point | Data | Browser |
|---|---|---|---|---|---|
| R01 | Search all sources | one text -> merged results of every source | `default.hub_search` 342 -> `NL/providers.hub_results` 333 | see area 3 | yes (per source, see area 3) |
| R02 | Search history | earlier searches, repeat / remove / clear | `NL/searchhist.menu` 172 | `search_history.json` | yes |
| R03 | Movies | catalogue menu | `default.media_root('movie')` 187 | TMDb | yes |
| R04 | Series | catalogue menu | `default.media_root('tv')` 187 | TMDb | yes |
| R05 | TV (live channels) | groups, guide, Israeli VOD, IPTV sources | `NL/iptv.menu` 922 | area 6 | partly (area 6) |
| R06 | Radio | country / language / genre / search | `NL/radio.menu` 140 | radio-browser.info | yes |
| R07 | Telegram - TeleScope AI (only when the engine is on: `providers.telegram_on` 404) | the engine's own menus | `plugin://plugin.video.telescope/` -> `TL/router.root` 92 | area 5 | yes (MTProto in browser) |
| R08 | History | watched items with date + time, replay, clear | `default.history` 540 | `history.json` | yes |
| R09 | Favourites | 4 kinds: movies / series / channels / radio | `default.favs` 564 | `favourites.json` | yes |
| R10 | Central library | providers by category + Sources screen | `NL/providers.library` 517 | area 9 | partly |
| R11 | Users: <name> | household users | `NL/users.menu` 248 | `users.json`, `users/<id>/` | yes |
| R12 | Services and connections | every login / key on one screen | `NL/services.screen` 298 | area 11 | partly |
| R13 | Kodi settings | shortcuts to Kodi's own windows | `NL/kodisettings.menu` 92 | fixed table | kodi-only (web: own Settings page) |
| R14 | Backup | cloud sync menu, backup file, restore, Drive | `default.bk_menu` 150 | area 12 | partly |
| R15 | Google Drive | sign-in, backup, restore, sync, browse, play | `NL/gdrive_ui.menu` 152 | Drive API | yes (different sign-in flow) |
| R16 | System status | add-ons, services, content counts | `NL/status.listing` 187 | area 14 | partly |
| R17 | Device type: <profile> | pick pc / tv64 / tv32 / phone / tablet / car... | `NL/profiles.wizard` 438 | `firstrun.json` | kodi-only (web: layout mode `device`) |
| R18 | System update | refresh repos + add-ons, report, Auto-Fix, rollback | `NL/sysupdate.listing` 337, `default.system_update` 759 | Kodi repos | kodi-only (web: SW update + "what's new") |

Screens that exist but are NOT in `root()` - they are opened from the skin's home screen (widgets / buttons) or from other
screens. A web main menu must list them explicitly:

| id | Reached from | What | Entry point |
|---|---|---|---|
| R19 | home tile / `?a=help` | Help centre | `NL/helpcenter.root` 71 |
| R20 | home row `?a=hub_k` | Knowledge hub (topic sections as tiles) | `NL/topics.hub` 252 |
| R21 | home row `?a=topic_root&s=<section>` | one learning section | `NL/topics.root` 179 |
| R22 | home row `?a=hub_k_news` | latest news videos | `NL/topics.show_latest_news` 307 |
| R23 | home tile `?a=tvradio` | TV & Radio: Israel / Channels / World / Radio | `default.tvradio` 268 |
| R24 | home tiles `?a=w_search&m=..`, `w_topic_search`, `w_hub_k_search`, `w_help_search` | "search box" tiles | `default.w_search` 258 |
| R25 | Central library, first row | Sources & add-ons (switches) | `NL/providers.sources_screen` 685 |
| R26 | Services screen row | Connect the web version (QR) | `NL/webpair.show` 88 |
| R27 | Backup menu / Services | Send / receive my setup (device pairing) | `NL/pairui.send` 353, `receive` 314 |
| R28 | player OSD buttons / keymap | player panels (area 7) | `NL/player_menus.*`, `NL/livebar.*` |
| R29 | on-screen keyboard buttons | Paste, Clipboard history | `NL/clipui.paste_now` 69, `history_menu` 90 |
| R30 | skin info-window buttons `?a=noop<mode>&tmdb_id=` | compatibility links of the skin (open seasons / play) | `default.router` 614-632 |

---

## 2. Catalogue: movies and series (TMDb)

Client: `NL/common.tmdb` 321 (key from `tmdb_key` setting or built-in token, 6 h cache, fail-over between
`api.themoviedb.org/3` and `api.tmdb.org/3`, DNS-over-HTTPS fallback `NL/netfix.Failover` 67). Images:
`https://image.tmdb.org/t/p/<size>` (`common.art` 365). Language from `content_lang` (`common.tmdb_lang` 141).

| id | Menu path | What it does | Entry point | Data | Browser |
|---|---|---|---|---|---|
| C01 | Movies > Search | TMDb titles + Telegram files that do NOT state an episode | `default.search` 364 | TMDb `/search/movie`; engine `?mode=hub&q=` | yes |
| C02 | Movies > Trending / Popular / Top rated / Now playing | paged lists (20 per page, "next page" row, 4 sort methods) | `default.list_` 316 | `/trending/movie/week`, `/movie/popular`, `/movie/top_rated`, `/movie/now_playing` | yes |
| C03 | Movies > Israeli movies / Family / Documentary | discover rows | `default.media_root` 193-198 | `/discover/movie` (`with_origin_country=IL`, genres 10751, 99; `vote_count.gte`) | yes |
| C04 | Series > Israeli series / On the air / Kids / Documentary | discover rows | `default.media_root` 200-204 | `/discover/tv`, `/tv/on_the_air`, genres 10762, 99 | yes |
| C05 | Movies/Series > Genres | genre tiles (build-time art `media/cats/genre_<id>.png`) | `default.genres` 220 | `/genre/<m>/list` | yes |
| C06 | Movies/Series > Languages | 11 languages (he, en, ru, fr, es, ko, ja, tr, de, it, hi) | `default.langs` 232, `LANGS` 183 | `/discover` `with_original_language` | yes |
| C07 | Movies/Series > Years | current year down to 1950 | `default.years` 239 | `/discover` `primary_release_year` / `first_air_date_year` | yes |
| C08 | Series > "Kukhnya" shortcut | opens the Russian series Кухня directly | `default.kukhnya` 530 | `/search/tv` | yes |
| C09 | title card details | runtime, genres, tagline, 8 cast with photos, director / creators, studio, age rating (IL/US), season + episode totals | `default.details` 54, `apply_details` 79 | `/movie/<id>` + `credits,release_dates`; `/tv/<id>` + `credits,content_ratings` (8 parallel) | yes |
| C10 | Series > show > Seasons | season list with posters (show poster as fallback), specials hidden when empty | `default.seasons` 407 | `/tv/<id>` | yes |
| C11 | Season > Episodes | `1x05. name`, still as background, air date, runtime, rating; **watched mark** (green dot + date) from history | `default.episodes` 483 | `/tv/<id>?append_to_response=season/<n>`, `history.json` | yes |
| C12 | Episode plots in Hebrew | missing Hebrew overviews machine-translated once and cached | `default.hebrew_plots` 432, `translate_he` 463 | `translate.googleapis.com/translate_a/single` (gtx), `plots_he.json` | yes\* |
| C13 | context: Add to favourites | on every movie / series | `default._fav_ctx` 277, `fav_add` 594 | `favourites.json` | yes |
| C14 | context: Telegram sources (choose) | opens the engine's source picker for this exact title | `providers.telegram_url` 414 (`mode=play&select=1`) | engine | yes |
| C15 | context: Search all sources | hub search with the title (and S/E for an episode) | `default.hub_search` 342 | area 3 | yes |
| C16 | click a movie / episode | **Play**: list of links, Telegram first, then other sources | `default.play` 353 -> `providers.play_with_fallback` 436 -> `fallback_pick` 460 | area 4 | yes (codec limits) |
| C17 | TMDb unreachable | one short notice per minute, alternative host, DoH | `default` 822-832, `NL/netfix` | `1.1.1.1/dns-query`, `8.8.8.8/resolve` | n/a (browser resolves itself); keep host fail-over |
| C18 | Engine catalogue (Telegram menu) | its own Movies / Series / Hebrew / Russian / Kids lists with a key-less **Cinemeta fallback** when no TMDb key | `TL/router.movies` 118, `tvshows` 127, `hebrew` 138, `russian` 155, `kids` 173, `genres` 180, `years` 188, `TL/meta.Meta` 8 | TMDb; `https://v3-cinemeta.strem.io` | yes |

Engine-only catalogue rows not in the hub (must exist in web for 1:1): Upcoming, Airing today, Turkish series, Korean
series, Hebrew top-rated movies / series, Israeli+US animation, Russian top-rated, Soviet films (<= 1991), Russian
animation, Kids movies / animation / kids series.

---

## 3. Search (hub search, history, completions)

| id | Menu path | What it does | Entry point | Data | Browser |
|---|---|---|---|---|---|
| S01 | Search all sources | parallel query of every enabled provider, one merged list in sections: TMDb movies & series, Telegram files, Idan+, YouTube, Internet Archive, live channels, radio. Ranking: whole phrase first, then all words (`providers.rank` 257) | `providers.hub_results` 333, `run_search` 219 | per provider below | yes (per provider) |
| S02 | episode search | text or params state season / episode -> ONLY exact matches are listed, header "S02E05" | `providers.hub_episode` 445, `exact` 270, `NL/epmatch.parse` 53 / `matches` 73 / `filter_items` 112 | pure logic (he / en / ru notations) | yes |
| S03 | provider: TMDb | `/search/multi` (persons dropped) | `hub_results` | TMDb | yes |
| S04 | provider: Telegram (TeleScope) | `?mode=hub&q=` free-text file search, verified | `TL/router.hub` 1495 | MTProto | yes |
| S05 | provider: Idan+ | Kan / Keshet / Reshet / 14 / 9 VOD search | `plugin://plugin.video.idanplus/?mode=4` | Idan+ add-on | kodi-only (web: re-implement per broadcaster, helper + geo-limits) |
| S06 | provider: YouTube | videos only, 3 pages, Shorts removed | `NL/yt.search` 218, `providers.yt_search` 667 | `https://www.youtube.com/youtubei/v1/search` (POST) | helper (list); play = iframe embed: yes |
| S07 | provider: Internet Archive | title search, no adult uploads | `NL/ia.search` 39, `providers.ia_search` 616 | `https://archive.org/advancedsearch.php`, `/metadata/<id>` | yes |
| S08 | provider: Dailymotion (URL template in `providers.py` ~29) | API search with family filter | providers registry | `https://api.dailymotion.com/videos` | yes |
| S09 | built-in: live channels | channel names containing the text | `providers._live_matches` 288 | merged playlist | yes |
| S10 | built-in: radio | station search | `providers._radio_matches` 294 | radio-browser `/stations/search` | yes |
| S11 | Search history screen | "new search" on top, press repeats, context removes one, clear all; 1 entry per text | `NL/searchhist.menu` 172, `add` 29, `remove` 39, `clear` 196 | `search_history.json` (per user, synced, with tombstones) | yes |
| S12 | completions while typing | nothing typed -> latest searches; typing -> own searches first (prefix, then contains), then TMDb titles (films + series, best known first) | `searchhist.suggest` 130, `match` 43, `online` 118, `titles_of` 54, `merge` 79 | TMDb `/search/multi` | yes (native `<input>` + list) |
| S13 | category search (Movies / Series) | see C01; series search lists only files that state an episode | `default.search` 364 | | yes |
| S14 | AI search (engine) | free description -> Gemini proposes titles -> catalogue | `TL/router.ai_search` 304, `TL/gemini.smart_search` 189 | Gemini `generativelanguage.googleapis.com/v1beta` | yes |
| S15 | Search Telegram files directly | every chat incl. bot chats and pinned public channels, bots asked, one row per file, best first | `TL/router.tg_search` 323, `TL/sources.Finder.find_free` 1075 | MTProto | yes |

---

## 4. Finding, ranking and playing sources

The link list of one exact title. Hub side: `NL/providers.fallback_pick` 460 (Telegram by TMDb id and the other sources at
the same time; the list opens as soon as Telegram has links). Engine side: a job in the service -
`TL/sources.Finder.find` 733, polled by `TL/router._wait_job` 1314, shown by `TL/router.play` 1335.

| id | Feature | What it does | Entry point | Data | Browser |
|---|---|---|---|---|---|
| P01 | target + aliases | TMDb translations / alternative titles, IMDb id, runtime; Hebrew names from Wikidata; optional Gemini alias expansion (30-day cache) | `Finder.build_target` 522, `_wikidata` 588, `_ai_aliases` 613, `TL/hints.wikidata_he` 28 | TMDb; `https://query.wikidata.org/sparql`; Gemini | yes |
| P02 | query plan | per language / episode notation, capped by `max_queries`, `max_aliases` | `Finder.plan_queries` 693, `deep_queries` 648 | pure | yes |
| P03 | Telegram search | global search + inside pinned chats + "library chats" that gave files before (learned) + deep search inside a chat | `TL/tgclient.TG.search` 433, `search_in` 458, `Finder._deep` 655, `library_chats` 624, `_pinned` 1016 | MTProto `messages.searchGlobal` / `messages.search` | yes |
| P04 | release-name parser | title, year, S/E, ranges, season packs, quality, source, codec, HDR, language tags, trailer / archive / junk; he / en / ru | `TL/parser.parse` 306 (+ `find_se` 179, `find_quality` 274, `find_langs` 292, `is_junk_name` 223) | pure | yes (port 1:1) |
| P05 | strict matcher | exact season+episode, year +-1, duration fits runtime, trailers / packs rejected, title similarity score, language bonus | `TL/matcher.evaluate` 99, `title_similarity` 33, `language_bonus` 211 | pure | yes (port 1:1) |
| P06 | AI verification | Gemini checks the ambiguous ("maybe") hits, optionally all | `TL/gemini.Gemini.verify` 153; settings `ai_verify`, `ai_verify_all` | Gemini | yes |
| P07 | request bots | asks content bots like a person: type the title, press the best button, follow `/start` links to file-store bots, optional auto-join of demanded channels; per-bot statistics; "always / never ask" marks | `TL/tgbots._Talk` 120, `TG.bot_ask` 700, `Finder.content_bots` 275, `bot_queries` 408, `_button_rank` 436, `bot_mark` 226 | MTProto; `bots.json` | yes |
| P08 | link test (probe) | every listed link is tested: first bytes downloaded, speed measured, slow links hidden (`hide_slow`, `max_mbit`) | `Finder.probe` 1210, `sources.http_head_bytes` 50, `TG.read_head` 1075 | MTProto / HTTP range | yes (TG); HTTP links: yes\* (range + CORS) |
| P09 | file header inspection | real duration, resolution, codecs, audio + subtitle track languages from the first 128 KiB (MKV / MP4) - a sample or wrong film is rejected, "Hebrew subs inside" is certain | `TL/mediainfo.inspect` 220, `Finder._apply_media` 1412 | file bytes | yes (port; also tells the web player if the codec is playable) |
| P10 | OpenSubtitles moviehash identification | certain identification of the file (size + first / last 64 KB) | `TL/opensubs.moviehash` 34, `OpenSubs.identify` 133, `Finder._os_identify` 1346 | `https://api.opensubtitles.com/api/v1/subtitles?moviehash=` (own API key) | yes\* |
| P11 | "synced Hebrew subtitle exists" bonus | release names that have a Hebrew subtitle at Wizdom raise the score | `TL/hints.wizdom_versions` 46, `synced` 122, `Finder._mark_synced` 1394 | `https://wizdom.xyz/api/search` | helper (CORS unverified) |
| P12 | Real-Debrid | device-code login; Torrentio by IMDb id (only RD-cached torrents with the key); own RD cloud; unrestrict at play time; dead-link memory | `TL/realdebrid.RealDebrid` 40: `device_start` 123, `device_poll` 131, `torrentio` 162, `cloud` 220, `resolve` 337, `mark_dead` 285 | `https://api.real-debrid.com/rest/1.0`, `/oauth/v2`; `https://torrentio.strem.fun`; `rd_dead.json` | yes\* (Torrentio is a Stremio add-on = CORS; RD REST: verify, device OAuth probably helper) |
| P13 | StremThru | which hashes are really cached at RD (file level); on by default | `TL/stremthru.StremThru.check` 78, `health` 172 | `<st_url>/v0/store/torz/check` (defaults `stremthru.13377001.xyz`, `stremthru.elfhosted.com`) | yes\* |
| P14 | Stremio Telegram servers | user-configured Stremio-protocol stream servers (manifest URL) | `TL/backends.StremioServers` 171 | `<server>/stream/<type>/<id>.json` | yes (Stremio add-ons send CORS) |
| P15 | Telemedia bridge | re-uses a logged-in Telemedia add-on's TDLib | `TL/backends.TelemediaBridge` 24 | `http://127.0.0.1:<port>` | kodi-only (not applicable on web) |
| P16 | TorBox | named in the task; **not present in the code** (no module, no setting). RD + StremThru only | - | - | n/a - decide whether it is a new feature |
| P17 | de-dup + order | same document forwarded = one row; same release in TG / RD / Stremio listed once; groups: Telegram, Real-Debrid, others; tested first | `TL/hints.merge_same_files` 88, `Finder.union_dedup` 1531, `order_groups` 1578, `_plays_best` 1521 | pure | yes |
| P18 | filters | min quality, hide CAM, language preference (any / he / ru / en), max results, strict mode, keep untested | settings `min_quality`, `hide_cam`, `lang_pref`, `max_results`, `strict`, `keep_unprobed` | | yes |
| P19 | source picker | 2-line rows: quality (coloured), resolution, languages, size, test result / speed; line 2: bot / channel / group name + file name; header with counts and checks; autoplay best when tested ok | `TL/router._source_label` 1271, `_source_line2` 1297, `_checks_text` 1307, `play` 1335 | job result | yes |
| P20 | nothing found | reason (0 raw hits / N rejected), bots asked; "a bot wants you to join X - join and retry?" | `TL/router.play` 1349-1366 | | yes |
| P21 | automatic next source | when RD resolve fails the next 3 sources are tried silently | `TL/router.play` 1384-1398 | | yes |
| P22 | Telegram streaming | local HTTP range proxy: aligned 1 MiB chunks, LRU chunk cache (`cache_mb`), parallel read-ahead (`parallel`, `readahead`), seek cancels stale fetches, flood-wait pacing, HMAC-signed URLs | `TL/stream.py` (`ChunkStore` 43, `make_handler` 363), `TG.read_chunk` 1094, `_slot` 950, `rpc.stream_url` 56 | MTProto `upload.getFile` | yes (Service Worker range responses + MSE) |
| P23 | AES speed | fast AES-IGE (PyCryptodome / tgcrypto / pure) | `TL/aesfast.py` | | yes (WebCrypto / WASM) |
| P24 | other-source fallback | when Telegram has nothing: Idan+, YouTube, Archive results for the same title, exact S/E only | `providers.fallback_pick` 460, `_pick` 497 | | partly (Idan+ kodi-only) |
| P25 | setting `tg_first` | Telegram first in the list | `N/resources/settings.xml` | | yes |

---

## 5. Telegram engine (TeleScope) - `TL/router.py`, `TL/service.py`, `TL/tgclient.py`

Engine root menu `TL/router.root` 92: Search, Movies, Series, Hebrew, Russian, Kids, Chiko Media, Telegram, Account,
Settings. The plugin talks to its service through JSON-RPC (`TL/rpc.call` 19 -> `Service.rpc` 499).

| id | Menu path | What it does | Entry point | Data | Browser |
|---|---|---|---|---|---|
| T01 | Account > status line | connected as <name> / not configured (no API id) / not connected | `router.account` 780, `Service.rpc('status')` | MTProto | yes |
| T02 | Account > Login by phone | number (normalised, default +972) -> code (app / SMS / call / e-mail, shown where it went, length, resend only after Telegram's timeout, the SAME code request reused - no second request) -> 2FA password with hint; every Telegram error mapped to a plain text; flood wait shown as "2 minutes" | `router._phone_login` 1129, `_type_code` 1175, `_password` 1198, `_login_error` 1110; `TL/tgauth.normalize_phone` 18, `sent_info` 35, `error_info` 61, `LoginState` 75, `wait_text` 108; `TG.send_code` 211, `resend_code` 233, `sign_in` 255, `sign_in_password` 278 | MTProto `auth.sendCode` / `auth.resendCode` / `auth.signIn` / `auth.checkPassword` | yes - **this is the flow the owner reports broken on web; the Kodi logic in `tgauth.py` is the reference to port** |
| T03 | Account > Login by QR | QR drawn locally (`TL/qr.py`), waits, handles 2FA, DC migration | `router.login` 1016, `QRWindow` 982; `TG.qr_start` 291, `qr_wait` 350, `_qr_settle` 315 | MTProto `auth.exportLoginToken` | yes |
| T04 | Account > Log out | | `router.logout` 1218 | | yes |
| T05 | Account > Real-Debrid | connect (device code), status (user, days left), disconnect | `router.rd_login` 830, `rd_status` 866, `rd_logout` 860 | RD | yes\* |
| T06 | Account > Export / Import configuration | one `.tncfg` file: all settings + the Telegram session + bot choices, optional password (PBKDF2 + HMAC stream) | `router.config_export` 898, `config_import` 925; `TL/configio.pack` 48, `unpack` 86; `Service.config_export` 276, `config_import` 298 | local file | partly: settings yes; **the session must not be imported into a second device** (AUTH_KEY_DUPLICATED rule) - web keeps its own session |
| T07 | Account > Tools | status report (deps, crypto speed, stream stats), AI test, clear cache, reinstall libraries | `router.status` 1225, `ai_test` 1245, `clear_cache` 1253, `reinstall` 1258; `TL/deps.py` (PyPI wheels) | PyPI | status / AI test / clear cache: yes; reinstall: kodi-only |
| T08 | Telegram > My chats | every channel / group / bot of the account; open one -> its videos (paged), search inside | `router.dialogs` 530, `chat` 546; `TG.dialogs` 471, `chat_videos` 539 | MTProto | yes |
| T09 | Telegram > My bots | bot chats + chosen bots with state; context: always ask / never ask / forget; "Ask a bot" with typed text | `router.bots` 568, `bot_mark` 594, `bot_ask` 612; `Finder.bot_list` 338, `bot_ask` 386 | MTProto, `bots.json` | yes |
| T10 | Telegram > Discover channels | text search, "similar channels", 4 ready topic searches (bots, Hebrew, Russian, English); rows show joined / pinned; context: join, pin (search without joining), search inside, similar | `router.discover` 659, `DISCOVER_PRESETS` 645; `TG.discover` 615, `similar` 654 | MTProto `contacts.search`, `channels.getChannelRecommendations` | yes |
| T11 | Telegram > Join by link / Leave | t.me link or invite hash; quiet mode | `router.join` 712, `leave` 727; `TG.join` 561, `leave` 577 | MTProto | yes |
| T12 | pin a public channel | adds to `pinned_chats` - searched by every search without joining | `router.pin` 700 | setting | yes |
| T13 | quiet mode | chats the engine joined are muted / archived so the viewer's Telegram app is not flooded | `TG.hush` 503, `quiet_mode` 500; setting `tg_quiet` | MTProto | yes |
| T14 | Chiko Media | the account's Chiko Media chats (keywords setting, score boost), browse + search inside, refresh | `router.chiko` 737, `chiko_chat` 756; `Finder.chiko_chats` 138, `is_chiko` 175 | MTProto | yes |
| T15 | file rows | label with quality / language / kind / status tags, plot with size, duration, chat, caption | `router._file_label` 447, `_file_plot` 420, `_enrich` 401, `show_files` 475 | | yes |
| T16 | play one Telegram file | `playtg` (chat + message), `playurl`, `playrd` | `router.playtg` 1453, `playurl` 773, `playrd` 1420 | | yes (codec limits) |
| T17 | cloud ("Saved Messages") storage | list / put / get / delete sealed documents in the account's own Saved Messages; send a text to Saved Messages | `TG.cloud_list` 144, `cloud_put` 159, `cloud_get` 172, `cloud_delete` 188, `send_saved` 180; `Service._cloud` 375, `_cloud_key` 363 | MTProto | yes |
| T18 | accept a login token (pairing) | a logged-in device approves another device's QR token | `TG.qr_accept` 295 | MTProto `auth.acceptLoginToken` | yes |
| T19 | watchdog / reconnect | reconnects a lost client every ~30 s | `Service._watchdog` 418, `TG.reconnect` 90 | | yes (page lifetime only) |
| T20 | engine settings | 9 categories: Telegram (api id / hash, phone, pinned chats, Telemedia, Stremio servers), Metadata (TMDb key, language, adult), AI (Gemini key / model, aliases, verify), Chiko, Debrid (RD, Torrentio, cloud, StremThru, OpenSubtitles), Bots, Matching / results, Streaming (parallel, read-ahead, cache MB, port), Advanced (debug, max aliases / queries) | `TL/../settings.xml`, `Service._load_settings` 64 | | yes (as a Settings page; `port`, `deps_zip`, `use_telemedia` not applicable) |
| T21 | first-run notice | "configure API id" notification once | `router.first_run_check` 107 | | yes |

---

## 6. Live TV, guide, Israeli channels

| id | Menu path | What it does | Entry point | Data | Browser |
|---|---|---|---|---|---|
| L01 | TV > Channels / group folders | Yes/HOT-style list: number, logo (3D poster for Israeli channels), now + next with progress | `NL/iptv.channel_list` 1113, `menu` 922 | Kodi PVR JSON-RPC (`PVR.GetChannels`, `GetBroadcasts`) | kodi-only as built; web: own list from the merged playlist + own EPG store |
| L02 | merged channel list | free lists (9 iptv-org playlists, 3 off by default) + the viewer's own M3U lists -> one numbered list; classify into groups (Israel, Russian, News, Kids...); clean names; restream / paid-IL hosts dropped; per-stream request headers (UA / Referer) | `iptv._merge` 329, `parse_m3u` 215, `classify` 198, `with_headers` 238, `display_name` 258; `FREE` 46 | `https://iptv-org.github.io/iptv/{countries/il,languages/heb,languages/rus,languages/eng,categories/movies,kids,documentary,news,music}.m3u`; `iptv.json`; shipped `dead_streams.json`, `stream_health.json` | playlists: yes (GitHub Pages = CORS). Streams: HLS native on Safari / TVs; hls.js needs CORS -> helper; http streams -> helper; custom UA / Referer headers -> helper only |
| L03 | Israeli channels with failover | ~45 channels (Kan 11, Keshet 12, Reshet 13, Now 14, Kan Educational, Makan 33, Knesset, 9, 24, i24 x4, Hidabroot, Kalkala 10, 16, Kabbalah, Keshet / Reshet free channels, subtitled feeds, Western Wall...) each with several licensed sources; first working one plays; Idan+ entries as alternates | `NL/livefail.live` 199, `CHANNELS` (~30-80), `candidates` 164, `_alive` 171 | direct HLS URLs in `livefail.py` (kan / cdn-redge / gostreaming / immergo / cybercdn / g-mana / kab.tv ...); `alternates.json`, `live_extra.json` | direct HLS: yes on native-HLS browsers, helper for hls.js without CORS; some are geo-limited to Israel; Idan+ alternates: kodi-only |
| L04 | YouTube live as a channel | channel ref `yt:UC..` -> the video live now is looked up at play time | `NL/ytlive.find` 48, `parse` 28 | `https://www.youtube.com/channel/<id>/live` (HTML) | helper for the lookup; play via iframe `embed/live_stream?channel=<id>`: yes without lookup |
| L05 | TV > Guide | Kodi's TV guide window | `iptv.action('guide')` 936 | PVR | kodi-only window; web: own guide grid |
| L06 | free guide (EPG) | per-country XMLTV from epgshare01 (25-80 MB each, gz), channels matched by normalised NAME, stream-filtered, titles / descriptions translated to he / en (cache), merged with the viewer's EPG URLs; rebuilt every 12 h in the background | `NL/epg.build` 211, `stream_guide` 176, `match` 81, `apply_lang` 154; `iptv.rebuild_guide` 589, `merge_epg` 657, `free_guide` 530 | `https://epgshare01.online/epgshare01/epg_ripper_<CC>.xml.gz`; `epg_tr.json`, `free_guide.json.gz`; settings `free_epg`, `epg_lang` | helper (size + CORS) - best done by the Worker on a schedule, serving a small JSON per country |
| L07 | own guide rows | channels no guide lists get "24 h broadcast" rows; subtitled feeds reuse the main channel's guide | `livefail.own_guide` 89, `SAME_GUIDE` 52; `iptv.fill_unserved` 700 | | yes |
| L08 | TV > Israeli TV (Idan+) | broadcasters' VOD catalogues | `plugin://plugin.video.idanplus/`; fixes `NL/idanpatch.py` | Idan+ | kodi-only |
| L09 | TV > IPTV sources | add M3U (URL + name), add EPG URL, switch each free list, delete own entries; then re-merge | `iptv.edit_sources` 945 (opened through Services > IPTV) | `iptv.json` (synced) | yes |
| L10 | Channels of the world | country tiles with flags, most channels first -> that country's channels | `iptv.countries_list` 1047, `country_channels` 1071, `_by_country` 1022 | merged list, `countries.json` | yes |
| L11 | dead-stream check | every source probed from this device 20 min after start, then every 12 h; a free source failing N times in a row leaves the list; own lists never dropped | `iptv.check_streams` 130, `probe` 95, `drop_failed` 112 | `stream_fail.json` | partly (no background; check on open / on error; helper for non-CORS) |
| L12 | live bar (OK on live TV) | bottom row of programme cards (now with progress, next with times, dead images hidden) + channel column for zapping; old stream released before the new one opens | `NL/livebar.epg` 100, `channels` 126, `play` 145, `cards` 25; `resources/skin/Custom_1190_BNLiveBar.xml`, `resources/keymaps/bn_player.xml` | PVR | kodi-only as built; web: overlay in the web player |
| L13 | live Hebrew subtitles | "Subtitles" on a live channel: AI live / automatic live / off; the PC server re-streams the channel with a subtitle track | `NL/livesubs.menu` 140, `start` 158, `off` 252 | `POST <server>/live`, `GET /live/<sid>/status`, `/live/<sid>/master.m3u8`, `POST /live/<sid>/stop` | helper / https tunnel to the PC server (mixed content); then yes |
| L14 | favourites: channel | context "add to favourites"; plays by channel id | `default.favs` 582, `iptv.play_channel` 1182 | | yes (store name + url, not PVR id) |
| L15 | PVR setup | writes IPTV Simple settings, installs / restarts it | `iptv.configure_pvr` 802, `install_addon` 764 | Kodi | kodi-only (no web need) |
| L16 | refresh interval | `iptv_refresh_h` | settings | | yes |

---

## 7. Player, subtitles, resume, next episode (service + player menus)

| id | Feature (where the viewer sees it) | What it does | Entry point | Data | Browser |
|---|---|---|---|---|---|
| V01 | watch history | every played video: label (`Show S01E02 title`), date + time, plot, thumb, fanart, replay link; 500 newest | `N/service.py Player.record_history` 874 | `history.json` | yes |
| V02 | resume | Kodi's own resume point per item; policy `resume_same`: ask / always / never; resume points travel between devices inside the history entries | `service.py Player.begin` 706 (`zero_state` ~736-756); `NL/syncdoc.progress_of` 92, `with_progress` 101, `progress_points` 119 | Kodi DB; sync doc | yes (store position per history key; the sync schema already carries `t`/`d`/`at`) |
| V03 | clean start of every video | subtitle delay (except this video's remembered one), audio delay, speed, zoom reset; per-file Kodi settings dropped | `service.py forget_file_settings` 50; `NL/playerctl.remembered_delay` 40 | `sub_offsets.json` | yes |
| V04 | automatic Hebrew subtitles (the flow) | order: (1) wait for the track list; (2) READ the text of embedded tracks - a track labelled Hebrew with English text does not count, unlabelled Hebrew is found and switched on; (3) burned-in subtitle check (frames -> Gemini): Hebrew -> stop, foreign -> black box; (4) human subtitle (All_Subs: Ktuvit / Wizdom / OpenSubtitles / YIFY); (5) AI generation when a server answers; optional pause until ready (`ai_prepare`, `ai_wait`) | `service.py Flow._run` 286, `verify_embedded` 176, `hardsub_check` 215; `NL/subdetect.py`, `NL/subprobe.probe` 268 / `decide` 309, `NL/hardsub.py` | file bytes; Gemini vision; AI server | embedded text probe: yes (JS MKV reader on the Telegram stream); burned-in check: yes (canvas frame -> Gemini); human subs: helper; AI: via PC server (helper / tunnel) |
| V05 | AI subtitles (server job) | PC server transcribes (Whisper) + translates (Gemini + engines); job polled with the play position, SRT fetched when ready, resumes after a server restart; YouTube sent by video id | `service.py` 395-460 (`POST /jobs`, `GET /jobs/<id>?pos=`, `GET /jobs/<id>/srt`), `_server_up` 532 (`/health`) | `<sub_server>` (default `http://<PC>:8765`), LAN discovery UDP 8766 (`NL/subsnet.discover_server` 7), Tailscale address `sub_server_remote` | server calls: helper / https address (mixed content, no UDP discovery in a browser - the address must be typed or come from sync). Note: the server must be able to READ the video; a Telegram stream that exists only inside the browser cannot be read by it -> needs a new upload-audio path or a server-side Telegram reader |
| V06 | "AI subtitles now" button | forces generation for the playing video | `default.ai_subs_now` 768 -> `service.py Player.ai_now` 860 | | as V05 |
| V07 | automatic subtitles without AI | Hebrew from Wizdom (best release match), else machine translation of an existing subtitle through free engines with per-line Hebrew validation | `NL/player_menus.auto_subtitles` 330, `wizdom_search` 294, `wizdom_download` 308; `NL/mtrans.translate` 90, `hebrew_only` 137 | `wizdom.xyz/api`; `clients5.google.com/translate_a/t`, `translate.googleapis.com/translate_a/single`, `api.mymemory.translated.net/get` | Wizdom: helper; gtx / MyMemory: yes\*; dict-chrome-ex: helper |
| V08 | subtitle alignment | a downloaded subtitle is aligned to this file's speech by the server (`auto_align`) | `service.py align_job` 565 (`POST /align`) | AI server | as V05 |
| V09 | Subtitles menu (player button) | rows: in preparation (live progress), download subtitle (auto, no AI), AI subtitles, choose subtitle, subtitle language, background, size, opacity, advanced, on / off | `default.subs_menu` 781 -> `player_menus.subtitles` 485 | | yes (web player panel; styling through `::cue` / own renderer) |
| V10 | unified subtitle picker | one list: embedded tracks / local folder / generated auto / generated AI / online; per-entry actions (use, preview, rename, delete, sync) | `player_menus.picker` 380, `_entry_actions` 429, `online` 463; "BN subtitles" window `NL/subsmenu.show` 78 | `NL/substore.py` files | yes (IndexedDB store instead of a folder) |
| V11 | subtitle store | every created subtitle saved as `<video>.<lang>.<source>[.vN].srt`, versions, cleanup policy (keep all / last N / older than) | `NL/substore.save` 42, `entries` 65, `cleanup` 101; settings `subs_folder`, `subs_cleanup`, `subs_keep_last`, `subs_pref_source` | local folder | yes (IndexedDB) |
| V12 | subtitle repair | encoding detection (UTF-8, cp1255, ISO-8859-8 incl. visual Hebrew), tolerant SRT / VTT parse, repair overlaps / duplicates, tag normalisation, Hebrew RTL punctuation fixes | `NL/subfix.py` (`decode_bytes` 80, `parse_subtitles` 142, `repair_cues` 170, `fix_hebrew_line` 201) | pure | yes (port; `TextDecoder('windows-1255')`) |
| V13 | sync panel | subtitle delay and audio delay: fine / coarse steps (step remembered, `sync_step`), VLC-style bookmark sync ("I hear it now" / "I see it now"), reset; offset remembered per video | `player_menus.sync` 59; `NL/syncmath.bookmark_delay` 14; `playerctl.set_sub_delay` 56, `remember_delay` 45 | `sub_offsets.json` | subtitle delay: yes; audio delay: no native API (kodi-only; possible only with WebAudio re-routing) |
| V14 | dual subtitles | two languages in one file (secondary on top) | `syncmath.merge_dual` 35 | pure | yes |
| V15 | Settings (gear) menu | next-episode autoplay on / off, audio settings, subtitle settings (+advanced), video settings, switch audio stream, toggle subtitle, speed (0.5-2.0), aspect / zoom (6 modes), A-B loop, jump to time, screenshot | `player_menus.settings` 127, `_jump_to_time` 117; A-B loop `service.py Player.ab_loop` 775 | | speed, zoom (CSS object-fit), A-B loop, jump, subtitle toggle: yes; audio-track switch: only where `audioTracks` exists (Safari) or via MSE remux; screenshot: canvas (CORS-clean video only) |
| V16 | Audio menu | audio stream list, language | `player_menus.audio` 201 | | partly (see V15) |
| V17 | subtitle appearance | font size, colour, background type, opacity, position | `player_menus.appearance` 238 | Kodi settings | yes (own renderer) |
| V18 | Next episode | next playlist item, else the next episode by TMDb id through the normal play flow | `player_menus.next_episode` 539 | TMDb | yes (also add "last episode of season -> next season") |
| V19 | black box behind burned-in foreign subtitles | subtitle style switched to a full box for this film only, restored afterwards | `NL/hardsub.box_on` 135, `box_off` 152; `service.py Player._box_off` 908 | `subbox.json` | yes (CSS) |
| V20 | BN player OSD + keymap | own player skin (one row of big buttons), VLC-style keys | `NL/skinpatch.bn_player` 120; `resources/skin/Includes_VideoOsdBN.xml`, `resources/keymaps/bn_player.xml` | | kodi-only as built; web: own player UI with the same buttons and keyboard shortcuts |
| V21 | All_Subs guards | patches for the third-party subtitle add-ons | `NL/subspatch.py` | | kodi-only (not needed on web) |
| V22 | Ktuvit with own account | login with the viewer's e-mail + site-specific password encoding | `NL/ktuvitauth.login` 203, `encode_password` 168; `services._ktuvit_login` 356 | `https://www.ktuvit.me` (cookies) | helper (cookies + CORS); password typed by the viewer only |
| V23 | upload subtitles to Drive | created subtitles copied to `BN Stream/Subtitles` | `NL/gdrive_ui.upload_subtitles` 330 | Drive | yes |

---

## 8. Radio, YouTube, topics, Internet Archive

| id | Menu path | What it does | Entry point | Data | Browser |
|---|---|---|---|---|---|
| A01 | Radio > Israel / Russia / Hebrew / Russian / English / Top world / USA / UK / Ukraine | station lists (name cleaned, duplicates removed, genres, country + bitrate, 3D poster for known stations) | `NL/radio.menu` 140, `listing` 165, `readable` 26, `poster` 122 | `https://all.api.radio-browser.info` (+ de1 / de2 / fi1 / nl1 mirrors): `/stations/bycountrycodeexact/<CC>`, `/bylanguageexact/<lang>`, `/topvote/100`; `radio_cache.json` | yes (API has CORS); http-only streams -> helper |
| A02 | Radio > Genres | 8 tags: news, pop, rock, classical, jazz, oriental, kids, religious | `radio.tags` 159, `TAGS` | `/stations/bytagexact/<tag>` | yes |
| A03 | Radio > Search | by station name | `radio.listing(by='search')` | `/stations/search?name=` | yes |
| A04 | redirect resolving | redirect services resolved once to the direct address (35 s -> instant) | `radio.direct` 37 | `radio_direct.json` | helper (cannot read a cross-origin redirect target); or just let `<audio>` follow it |
| A05 | radio favourite | context "add to favourites" (stream URL kept in `extra`) | `radio.listing` 195 | | yes |
| A06 | YouTube lists without an API key | search, channel videos (paged), playlists; Shorts removed; 6 h cache with stale fallback | `NL/yt.search` 218, `channel` 238, `channel_videos` 247, `playlist_videos` 261; `providers.yt_channel` 603 | `POST https://www.youtube.com/youtubei/v1/{search,browse}`; `yt_cache.json` | helper for lists; playback: YouTube iframe embed = yes (no own subtitles / no AI subtitles on embeds) |
| A07 | Russian studio channels | 9 official channels (Mosfilm, Soyuzmultfilm, Smeshariki, Belarusfilm, Kinopoisk, Kakha...) in Central library > Russian | `providers.RUSSIAN` ~55, `library_cat` 536 | YouTube channel ids | as A06 |
| A08 | Knowledge hub | 7 curated sections as tiles: knowledge (power / control / tech), dog training, DIY (8 cats), PLC (11 cats), smart home (4), news (IL / world / finance / tech), Asian (China / Korea / Japan); ~116 channels | `NL/topics.hub` 252, `load` 71 | `N/resources/topics/{knowledge,dogs,diy,plc,smarthome,news,asian}.json` | data: yes (static JSON); videos: as A06 |
| A09 | section > categories > videos | long videos only (`min_seconds`), optional title regex, newest first | `topics.root` 179, `categories` 192, `show_category` 206, `category_videos` 111, `select` 30 | topics JSON + yt | as A06 |
| A10 | section > Top | most-watched long lessons over all channels of the section | `topics.show_top` 210, `rank_top` 48 | | as A06 |
| A11 | section > Search / hub search | only this section's channels; hub search over all sections | `topics.show_search` 214, `search` 153, `show_hub_search` 286, `hub_search` 265 | | as A06 |
| A12 | Latest news row | newest reports of Israeli + world news channels | `topics.latest_news` 297 | | as A06 |
| A13 | prewarm | all channels fetched into the cache 3 min after start | `topics.prewarm` 90 | | n/a (helper-side cache instead) |
| A14 | Internet Archive | search, item page (one playable file: h.264 mp4 preferred), play with film details | `NL/ia.search` 39, `files` 50; `providers.ia_search` 616, `ia_item` 630, `ia_play` 656 | `https://archive.org/advancedsearch.php`, `/metadata/<id>`, `/download/<id>/<file>`, `/services/img/<id>` | yes |
| A15 | news + weather ticker (home screen bottom) | Israeli headlines + 3-day weather for `ticker_city`, one combined RSS | `NL/ticker.Ticker` 71, `weather_line` 48 | `https://www.ynet.co.il/Integration/StoryRss1854.xml`, `https://rss.walla.co.il/feed/22`; `https://api.open-meteo.com/v1/forecast`, `https://geocoding-api.open-meteo.com/v1/search` | weather: yes; RSS: helper |

---

## 9. Central library, providers, sources screen

| id | Menu path | What it does | Entry point | Data | Browser |
|---|---|---|---|---|---|
| B01 | Central library | "Sources & add-ons" row, then categories (Israel, Russian, Movies & series, Video platforms, Docs, News, Kids, Sport, Music, Live US) | `providers.library` 517, `CATS` ~47 | `PROVIDERS` ~31, `providers_status.json` (audit: stable flags) | yes for the built-in ones |
| B02 | category > provider | a provider's own menu shown inside TeleNova; installed on first use | `providers.library_cat` 536, `open_provider` 562, `read_dir` 198 (`Files.GetDirectory`) | other Kodi add-ons | kodi-only (web: only providers that have a web module) |
| B03 | Sources & add-ons | every source with a green / grey dot; toggle one, all on, all off, install all stable; built-in groups (TMDb, live channels, radio) switch the same way | `providers.sources_screen` 685, `toggle` 713, `set_all` 725, `install_all` 730, `is_on` 148 | `providers.json` (synced) | yes (switches); install: kodi-only |
| B04 | Free legal libraries | 13 add-ons from the official Kodi repository (Pluto TV, Crackle, Plex free, Dailymotion, Vimeo, Twitch, NASA, Red Bull TV, NHK World, ARTE, PBS Kids...) installed on first use | `NL/libraries.menu` 28, `install` 44, `LIBRARIES` 10 | Kodi repository | kodi-only (web: link out to each service's own site, or a web module per service) |

---

## 10. Users, favourites, history

| id | Menu path | What it does | Entry point | Data | Browser |
|---|---|---|---|---|---|
| U01 | Users | list with the active one marked; + New user | `NL/users.menu` 248 | `users.json` | yes |
| U02 | user > Switch / Rename / Delete | each user has own history, favourites, search history; logins + settings are shared; deleted users keep a tombstone for the sync | `users.action` 271, `store_create` 75, `store_switch` 113, `store_rename` 89, `store_delete` 100 | `users/<id>/{history,favourites,favourites_removed,search_history,user_marks}.json` | yes |
| U03 | Favourites > Movies / Series / Channels / Radio (with counts) | open: movie -> play flow, series -> seasons, channel -> play, radio -> stream; context: remove (tombstone kept so it stays removed on other devices) | `default.favs` 564, `fav_add` 594, `fav_rm` 602; `gdrive_ui.remember_removed` 391 | `favourites.json`, `favourites_removed.json` | yes |
| U04 | History | newest first, 500 rows, date + time, plot, replay; Clear history (mark synced) | `default.history` 540; router `history_clear` 670 -> `users.mark` 191 | `history.json` | yes |
| U05 | watched marks in episode lists | see C11 | | | yes |

---

## 11. Services and connections (one screen for every login / key)

`NL/services.py`: rows `ROWS` ~104, states (active / off / key missing / login needed / needs setting up / error) from
`services_state` 143 with facts gathered in parallel (`facts` 236); summary line "N on, N off, N to fix, N errors";
per-row actions (`action` 380): switch on / off, connect / disconnect, type the key, delete the key, open the issuing
page in the browser + QR (`NL/weblink.show` 62, `PAGES`), test now (`_test` 348), open the service's own screen.
Older variant with fix hints: `NL/accounts.screen` 141, `check` 71.

| id | Row | Group | Test endpoint | Browser |
|---|---|---|---|---|
| X01 | Telegram | sources | engine `status` | yes |
| X02 | Real-Debrid | sources | `https://api.real-debrid.com/rest/1.0/user` | yes\* |
| X03 | StremThru | sources | engine `svc_check` -> `StremThru.health` | yes\* |
| X04 | OpenSubtitles ID (moviehash) | sources | `OpenSubs.check_key` 175 | yes\* |
| X05 | Telegram bots | sources | switch (`bot_request`) | yes |
| X06 | Stremio servers | sources | manifest address | yes |
| X07 | Ktuvit (own account) | subtitles | `ktuvitauth.login` | helper |
| X08 | Ktuvit / Wizdom / OpenSubtitles / YIFY (subtitle sites, All_Subs switches) | subtitles | add-on settings | helper per site (web must call the sites itself) |
| X09 | AI Subtitle Server | subtitles | `<server>/health` | helper / https address |
| X10 | Gemini AI | AI | `generativelanguage.googleapis.com/v1beta/models` | yes |
| X11 | TMDb | AI + metadata | `api.themoviedb.org/3/configuration` | yes |
| X12 | IPTV (M3U + EPG) | TV | `iptv.json`, `iptv_status.json` | yes |
| X13 | Google Drive | TV + backup | Drive sign-in state | yes |
| X14 | top row: Automatic sync / users / export / import | - | `NL/cloudsync.menu` 91 | partly (area 12) |
| X15 | row: Connect the web version | - | `NL/webpair.show` 88: QR of `<site>/web/#pair=<api id>.<api hash>` drawn locally, optionally sent to Saved Messages | the web side is the receiver (`takePair()` in `web/app.js`) |
| X16 | key pages opened in the device browser | - | `weblink.PAGES`: my.telegram.org/apps, real-debrid.com/device, aistudio.google.com/apikey, themoviedb.org/settings/api, opensubtitles.com, ktuvit.me, google.com/device, trakt.tv/activate, StremThru GitHub | yes (plain links) |

---

## 12. Sync, backup, restore, Google Drive, pairing, locked profile

| id | Menu path | What it does | Entry point | Data | Browser |
|---|---|---|---|---|---|
| K01 | Backup > Automatic sync and backup (on / off, Sync now) | continuous sync between the devices of ONE Telegram account: users + each user's history / favourites / searches / marks, settings of the hub, the engine and the subtitle add-on, IPTV sources, provider switches; one sealed document in Saved Messages; conflict-free merge rules per data kind | `NL/cloudsync.menu` 91; `NL/autosync.cycle` 39, `loop` 256, `KodiHost` 117; `NL/syncdoc.merge` 233 (+ `merge_users` 52, `merge_history` 80, `merge_favourites` 141, `merge_searches` 155, `merge_stamped` 197, `stamp_changes` 211) | engine `cloud_list` / `cloud_put` / `cloud_get`; `sync.json`, `sync_meta.json` | yes (web already has `syncdoc.js` / `websync.js`; must stay byte-compatible with `syncdoc.py`) |
| K02 | Backup > Backup to a file (personal / full) | zip of accounts, history, favourites, IPTV, settings; full = every add-on's data + extra add-ons | `NL/backup.backup` 270, `make_zip` 224, `_members` 21 | local zip | personal part: yes (download a JSON / zip); full Kodi profile: kodi-only |
| K03 | Backup > Restore | restore a zip (stale members skipped, filled settings kept), Kodi restarts; "merge personal only" keeps Kodi running | `backup.restore` 308, `restore_zip` 399, `extract` 166, `restore_personal` 348, `keep_filled` 143 | local zip | personal merge: yes (read a Kodi backup zip in JS and merge favourites / history / searches); full: kodi-only |
| K04 | weekly local safety copy | automatic | `backup.auto_backup` 297 (service `backup_job`) | | n/a |
| K05 | Google Drive > Connect | sign-in with a code on the TV (device flow), account name, space used | `NL/gdrive.Drive.start_login` 74, `poll_login` 86; `gdrive_ui.login` 110 | `https://oauth2.googleapis.com/device/code`, `/token`, `/revoke`; scope `drive.file` | yes, but with the browser flow (Google Identity Services token client); the device flow + client secret must NOT ship in a web page |
| K06 | Google Drive > Backup now / Restore / keep N | zip in `BN Stream/Backups`, pruned to `gd_keep` | `gdrive_ui.backup_now` 212, `restore` 223; `gdrive.prune` 289 | `https://www.googleapis.com/drive/v3`, `/upload/drive/v3/files` | yes (personal part) |
| K07 | Google Drive > Sync now | favourites / history / IPTV / providers merged with `BN Stream/Sync` | `gdrive_ui.sync` 288; `gdrive.merge_favourites` 253, `merge_history` 269 | Drive | yes |
| K08 | Google Drive > Browse my files / play | the `BN Stream` folder, video streamed straight from Drive (token as a header) | `gdrive_ui.browse` 352, `play` 382 | Drive `files?alt=media` | partly (a `<video>` cannot send an Authorization header: fetch + MSE / blob, or a Service Worker that adds the header) |
| K09 | Google Drive > Automatic weekly backup on / off; Disconnect | | `gdrive_ui._toggle_auto` 190, `auto` 244, `logout` 146 | | on / off: n/a without a background job; disconnect: yes |
| K10 | Send my setup to another device / Receive | two devices on one network: UDP beacon + TCP, ephemeral Diffie-Hellman with a 6-digit confirmation code, encrypted channel; settings + users + lists are sent; the new device gets its OWN Telegram session (QR token approved by the configured device, 2FA typed on the configured device) | `NL/pairing.py` (protocol), `NL/pairflow.run_sender` 199 / `run_receiver` 86, `NL/pairui.send` 353 / `receive` 314 | LAN sockets | kodi-only transport (no raw sockets in a browser). Web equivalent already designed: X15 (`#pair=` link) + sign in + K01 sync. A web page CAN act as approver through MTProto `auth.acceptLoginToken` (scan the TV's QR with the phone's camera) |
| K11 | Locked pre-configured profile | admin packs every account into an encrypted file with a password; a user unlocks it | `NL/preset.create` 113, `unlock` 201, `encrypt` 90 / `decrypt` 99 | `preset.nvp` | settings part: yes (WebCrypto PBKDF2 + HMAC); never the Telegram session |
| K12 | engine config export / import | see T06 | | | see T06 |

---

## 13. Help, status, system update, speed test

| id | Menu path | What it does | Entry point | Data | Browser |
|---|---|---|---|---|---|
| H01 | Help > User guide | sections (he + en) | `NL/helpcenter.guide` 99, `show` 116 | `N/resources/help/guide.json` (`sections`) | yes (static JSON) |
| H02 | Help > Troubleshooting | problem / cause / fix table | `helpcenter.trouble` 107, `trouble_text` 50 | `N/resources/help/trouble.json` (`rows`) | yes |
| H03 | Help > Search | every word of the query over both files | `helpcenter.do_search` 128, `search` 33 | | yes |
| H04 | Help > Speed test | latency, jitter, download, upload, live progress, verdict per use (HD / Full HD / 4K / live TV) | `NL/speedtest.run_dialog` 115, `Test` 44, `verdict` 33 | `https://speed.cloudflare.com/__down`, `/__up` | yes (CORS open) |
| H05 | Help > About | version, components, issue link | `helpcenter.about` 183, `about_text` 150 | `https://github.com/bennymat93/novatv/issues` | yes |
| H06 | Help > language toggle | Hebrew <-> English for the help only (`help_lang`) | `helpcenter.toggle` 143 | | yes |
| H07 | System status | add-ons (installed / enabled / version / broken), services (internet + each login), content counts: movies, series, live channels, radio stations, sources, Russian channels, Soviet films, favourites, history; shown once after start (`status_on_start`) | `NL/status.gather` 147, `addon_rows` 52, `service_rows` 72, `content_rows` 94, `announce` 177 | TMDb `total_results`; radio-browser; `archive.org/advancedsearch.php`; `google.com/generate_204` | services + content: yes; add-on rows: kodi-only (web: module / Service Worker / helper status instead) |
| H08 | System update | refresh repositories, install updates, check every core add-on, skin, subtitle guards, YouTube port, services, IPTV, PVR, radio, content cache; report; Auto-Fix row under each failed line; roll back | `NL/sysupdate.run` 287, `listing` 337, `fix` 228, `rollback` 372 | Kodi repos | kodi-only. Web equivalent: version check (`version.js`), Service Worker update, "clear caches", "re-test services" |

---

## 14. Device profiles, Kodi settings, platform helpers (mostly Kodi-only)

| id | Feature | What it does | Entry point | Browser |
|---|---|---|---|---|
| D01 | device profiles | recognises pc / tv64 / tv32 / phone / tablet / car, 3 readings, applies cache size, player, touch mode; manual choice | `NL/profiles.auto` 418, `detect` 356, `classify` 143, `plan` 71, `wizard` 438 | kodi-only logic; web equivalent = responsive layout + `device` setting (auto / tv / phone / desktop) with TV focus navigation |
| D02 | Kodi settings shortcuts | 15 rows (install from repo / zip, my add-ons, updates, file manager, video sources, player, subtitles, system, interface, media, PVR, services, profiles...) each with a how-to text | `NL/kodisettings.menu` 92, `go` 102 | kodi-only (nothing to port; web has its own Settings page) |
| D03 | hub settings | General: `tmdb_key`, `content_lang`, `open_on_start`, `ui_sounds`, `lite`, `ticker`, `ticker_city`, `help_lang`; Subtitles: `ai_subs`, `auto_align`, `ai_prepare`, `ai_wait`, `sub_server`, `sub_server_remote`, `subs_folder`, `subs_cleanup`, `subs_keep_last`, `subs_pref_source`, `opensubs_key`, `resume_same`, `sync_step`, `gemini_key`, `status_on_start`, `gd_auto`, `gd_keep`, `gd_client_id`; Sources: `tg_first`; Live TV: `free_epg`, `epg_lang`, `iptv_refresh_h` | `N/resources/settings.xml` | yes as a Settings page (not applicable: `open_on_start`, `ui_sounds`, `lite`, `subs_folder`) |
| D04 | interface languages | he / en / ru everywhere (`common.T` 136, per-module `s()` tables, engine `.po` files) | `NL/common.py`, `TL/../language/` | yes |
| D05 | paste + clipboard history on the on-screen keyboard | device clipboard per platform (Win32, JNI, ObjC, xclip), history with pin / delete | `NL/clip.py`, `NL/clipui.py` | not needed (native paste); optional `navigator.clipboard` button for TV browsers |
| D06 | skin patches | AI button, BN player, keyboard buttons, notification bar, home layout, default views | `NL/skinpatch.py`, `NL/depov.py` | kodi-only |
| D07 | branding | splash, Windows shortcuts | `NL/branding.py` | kodi-only (web: PWA manifest, icons, splash) |
| D08 | binary add-ons per platform, YouTube port fix | | `NL/binfix.py`, `NL/ytport.py` | kodi-only |
| D09 | light mode (`lite`) for weak boxes | fewer background jobs | `service.py lite_job` | web equivalent: reduced-motion / low-memory mode for TV browsers |
| D10 | open TeleNova on start, UI sounds | | `service.py menu_job`; `resource.uisounds.nova` | PWA start URL; sounds optional |
| D11 | first-run wizard add-on | `src/plugin.program.novawizard` | | kodi-only (web: first-run onboarding page) |

---

## 15. Background jobs of the hub service (`N/service.py main()` 959 onward)

No web page has a permanent service. Each job needs one of: run on page open, run in the Service Worker, run in the
Worker helper on a schedule, or be dropped.

| Job | What | Web placement |
|---|---|---|
| `sync_job` | continuous sync every period + at once after a user switch | on open, on visibility change, after each write |
| `iptv_job`, `guide_job`, `streams_job` | merge playlists, rebuild guide, dead-stream check | helper on a schedule (guide), page on open (playlist) |
| `topics_job` | prewarm YouTube channel caches | helper cache |
| `backup_job`, `gdrive_job` | weekly backups | on open when older than N days |
| `ticker_job` | news + weather feed | on the home page while open |
| `cache_job` | TMDb cache cleanup (7 days) | Service Worker cache expiry |
| `startup_job` | status announcement | optional toast on open |
| `profile_job`, `binary_job`, `branding_job`, `migrate_job`, `wizard_job`, `lite_job`, `telescope_job`, `bn_player_job`, `clip_job`, `pvr_ready_job`, `restored_job`, `livesubs_job` | Kodi housekeeping | dropped |
| `Player` callbacks | history, subtitles flow, clean start, A-B loop | the web player module |

---

## 16. Data files (the build's shapes - the web store must read / write the same)

| File | Shape | Written by |
|---|---|---|
| `history.json` | `[{key ('movie:<tmdb>' / 'tv:<tmdb>:<s>:<e>'), label, when ('dd/mm/YYYY HH:MM'), ts, play, plot, thumb, fanart, +resume t/d}]`, 500 max | `service.py` 874 |
| `favourites.json` | `[{kind (movie / series / channel / radio), id, label, extra, added}]` | `default.fav_add` 594 |
| `favourites_removed.json` | tombstones `(kind, id, time)` | `gdrive_ui.remember_removed` 391 |
| `search_history.json` | newest first, one entry per text | `searchhist.add` 29 |
| `users.json`, `users/<id>/`, `user_marks.json` | users with tombstones, per-user files, clear / remove marks | `users.py` |
| `iptv.json` | `{free: {name: bool}, m3u: [{name, url}], epg: [url]}` | `iptv.edit_sources` 945 |
| `providers.json` | provider on / off map | `providers.toggle` 713 |
| `services.json` | service flags | `services._set_flags` 209 |
| `sync.json`, `sync_meta.json` | sync switch, per-key `[value, time]` stamps | `autosync.py` |
| `bots.json` (engine) | bot marks + statistics | `Finder._bots_save` 206 |
| `sub_offsets.json` | per-video subtitle offset, 500 newest | `playerctl.remember_delay` 45 |
| `plots_he.json` | translated episode plots | `default.hebrew_plots` 432 |
| shipped data | `resources/topics/*.json`, `resources/help/*.json`, `resources/providers_status.json`, `resources/dead_streams.json`, `resources/stream_health.json`, `media/logos/*.png`, `media/cats/*.png` | build tools |

---

## 17. Summary of verdicts

- **Runs in the browser as is (yes):** the whole TMDb catalogue (area 2), search history + completions, hub search over
  TMDb / Telegram / Archive / Dailymotion / live / radio, the entire Telegram engine incl. phone + QR login, chats, bots,
  discover, Chiko, cloud storage, source finding / matching / ranking (parser, matcher, mediainfo are pure logic), users,
  favourites, history, sync document, radio, Internet Archive, help, speed test, Gemini features, services screen logic,
  Drive (with the browser sign-in flow).
- **Needs the CORS helper:** YouTube lists and live lookup (youtubei), EPG (epgshare01, size + CORS), subtitle sites
  (Wizdom, Ktuvit, YIFY, OpenSubtitles downloads), RSS ticker, http-only or CORS-less IPTV / radio streams and streams
  that need a custom User-Agent / Referer, the AI subtitle server on the home PC (mixed content), radio redirect
  resolving; to be verified and possibly added: Real-Debrid OAuth / REST, StremThru, OpenSubtitles API, free translate
  endpoints.
- **Kodi-only (needs a replacement or is dropped):** PVR windows (TV guide, channel manager), the live bar skin window,
  Idan+ and every "other add-on" provider, the free-libraries installer, System update / rollback, Kodi-settings
  shortcuts, device profiles as Kodi tuning, skin patches, branding, clipboard bridge, LAN device pairing transport,
  Telemedia bridge, audio-delay control, full-profile backup / restore, playback of MKV / HEVC / AC3 / DTS in browsers
  that lack the codecs.
- **Not found in the Kodi code:** TorBox (no module or setting); Trakt appears only as a help text / link
  (`accounts.py`, `weblink.py`), there is no Trakt integration in the current build.
