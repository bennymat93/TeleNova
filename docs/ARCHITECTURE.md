# TeleNova - Architecture map (Phase 0)

Written from the working tree on 2026-11-18: Kodi build 4.2.9 (`src/*/addon.xml`), web version 5.0.0 (`web/version.js`,
being rewritten - the files are described as they are on disk now). It replaces the 4.0.8 edition of this file.
Every statement names the file (and function) it was checked against. Line numbers are left out on purpose: several
sessions edit the code, function names stay. "Not established" = the code that was read does not settle the point.

Companion documents (not repeated here): feature inventory with `file:line` for every screen -
[`docs/web-audit/kodi-features.md`](web-audit/kodi-features.md); the web version as audited -
[`docs/web-audit/web-features.md`](web-audit/web-features.md); module contract of the web version - `web/MODULES.md`;
state, traps and release recipe - `src/HANDOFF.md`; bugs and phases - `docs/PROGRESS.md`.

Short names: **hub** = `src/plugin.video.nova` (`N/`, its `resources/lib/` = `NL/`), **engine** =
`src/plugin.video.telescope` (`TL/` = its `resources/lib/`), **wizard** = `src/plugin.program.novawizard`,
**web** = `web/`, **helper** = the Cloudflare Worker in `worker/`.

## 1. Components and how they talk

```
 Kodi 21 (one process; every add-on script in its own Python interpreter)
 +------------------------------------------------------------------------------------------------------+
 | skin.fentastic (patched: NL/skinpatch.py, depov.py)   service.subtitles.All_Subs (NL/subspatch.py)   |
 |      | RunPlugin, Window(10000) properties                  | Window(10000) properties               |
 |      v                                                      v                                        |
 | HUB  N/default.py (plugin, ?a=...)        N/service.py (xbmc.service: Player, Monitor, ~25 jobs)     |
 |      |  (a) Files.GetDirectory plugin://plugin.video.telescope/?mode=hub...                          |
 |      |  (b) POST http://127.0.0.1:<port>/rpc {method, params, secret}   (port + secret: port.json)   |
 |      v                                                                                               |
 | ENGINE  default.py -> TL/router.py (plugin) --TL/rpc.py--> service.py -> TL/service.py (Service)     |
 |         TL/stream.py HTTP server on 127.0.0.1 (setting `port`, default 65220, +19, then any free)    |
 |         Kodi player --GET /stream/<chat>/<msg>/<hmac16>/<name> (Range)--> ChunkStore -> tgclient     |
 | pvr.iptvsimple <- nova_channels.m3u + nova_epg.xml.gz (NL/iptv.py)    plugin.video.idanplus (patched)|
 | WIZARD (script: build.json -> build zip)             repository.telenova (-> repo/addons.xml)        |
 +------------------------------------------------------------------------------------------------------+
     |  MTProto (Telethon)            | HTTP: /health /jobs /align /live          | UDP 8766 'NOVASUBS?'
     v                                v                                           v
 Telegram account ................ AI subtitle server on a PC, port 8765 (outside this repository)
   "Saved Messages": one sealed sync document (device name `sync-v2`)
     ^  MTProto in the browser (web/vendor/gramjs-2.26.21.min.js)
     |
 WEB  https://bennymat93.github.io/TeleNova/web/  (static page, no build step, service worker web/sw.js)
     |-- optional --> HELPER worker/index.js (relay to an allowlist of hosts that send no CORS headers)
     '-- reads web/data/epg_il.json, refreshed by .github/workflows/epg.yml every 6 h
 Kodi --QR--> WEB: <site>/web/#pair=<api id>.<api hash>  (NL/webpair.py -> web/app.js takePair)
```

| Link | Transport | Where |
|---|---|---|
| hub plugin -> engine, as a directory | Kodi JSON-RPC `Files.GetDirectory` on `plugin://plugin.video.telescope/?mode=hub&...` | `NL/providers.py:read_dir`, `telegram_url`, `telegram_sources` |
| hub -> engine, direct | `POST 127.0.0.1:<port>/rpc`, port and secret read from the engine's `port.json` | `NL/cloudsync.py:engine` (used by `autosync`, `webpair`, `pairui`), `NL/accounts.py` |
| engine plugin -> engine service | same `/rpc`; 3 tries on a dead port or `service_starting` | `TL/rpc.py:call` |
| Kodi player -> engine | `GET /stream/<chat>/<msg>/<token>/<name>`, token = first 16 hex of HMAC-SHA256(secret, `chat:msg`) | `TL/rpc.py:stream_url`, `stream_token`; `TL/stream.py:make_handler` |
| guards of the HTTP server | bind `127.0.0.1` only; `Host` must be `127.0.0.1:<port>` / `localhost:<port>`; secret on every `/rpc` | `TL/stream.py:App.serve`, `make_handler` |
| hub -> AI subtitle server | `GET /health`, `POST /jobs`, `GET /jobs/<id>?pos=`, `GET /jobs/<id>/srt`, `POST /align`, `POST /live` | `N/service.py:Flow._run`, `_server_up`, `align_job`; `NL/livesubs.py` |
| finding that server | saved setting `sub_server`, UDP broadcast `NOVASUBS?` to port 8766, then `sub_server_remote` | `NL/subsnet.py:discover_server` |
| hub -> skin / All_Subs | `Window(10000)` properties (`NovaTV.*`, `BN.*`, `bn.*`), `NotifyAll(plugin.video.nova, ai_now)` | `N/service.py`, `NL/subspatch.py`, `N/default.py:ai_subs_now` |
| Kodi devices <-> each other <-> browsers | one sealed document in the account's Saved Messages | `NL/autosync.py`, `TL/service.py:Service._cloud`, `web/tg.js`, `web/websync.js` |
| Kodi -> web (first connection) | QR of a link whose `#fragment` carries the API id and hash; drawn on the device | `NL/webpair.py:pair_url`, `show`; `NL/qr.py`; `web/app.js:takePair` |
| Kodi device -> new Kodi device (LAN) | UDP beacon + TCP, ephemeral Diffie-Hellman, 6-digit code | `NL/pairing.py`, `NL/pairflow.py`, `NL/pairui.py` |
| web -> helper | target URL in the `X-TN-Target` header; origin and host allowlists; `GET /ping` | `web/helper.js`, `worker/index.js`, `worker/wrangler.toml`, `worker/README.md` |

The AI subtitle server (`nova_subs.py`, `live_restream.py`, `supervisor.py`) lives outside the repository
(`src/HANDOFF.md`, table "where everything is"). Only its HTTP interface above is visible from this code.

## 2. The add-ons

### 2.1 Entry points

| Add-on | `addon.xml` extension points | Starts in |
|---|---|---|
| hub `plugin.video.nova` | `xbmc.python.pluginsource` `default.py` (video, audio); `xbmc.service` `service.py`; engine imported as optional | `N/default.py:router` (table of `?a=` actions, set `ACTIONS` = non-folder actions); `N/service.py:main` |
| engine `plugin.video.telescope` | `xbmc.python.pluginsource` `default.py`; `xbmc.service` `service.py` with `start="login"` | `TL/router.py:run` (table `MODES`, `?mode=`); `TL/service.py:run` -> `Service.start`, `Service.run` |
| wizard `plugin.program.novawizard` | `xbmc.python.script` `default.py` | `default.py:main` |
| `repository.telenova` | `xbmc.addon.repository` -> `https://bennymat93.github.io/TeleNova/repo/addons.xml` (+ `.md5`, zips) | no code |
| `resource.uisounds.nova` (1.0.0) | sound resource, listed in `repo/addons.xml` | no code; not touched by `bump.py` / `package.py` |

### 2.2 Hub modules (`N/`)

| File | Responsibility |
|---|---|
| `default.py` | plugin router, root menu, TMDb catalogue screens, seasons / episodes, history, favourites, `play` |
| `service.py` | `Player` (history, clean start, subtitle `Flow`, A-B loop, TV retry), `Monitor`, start-up patches, background jobs |
| `NL/common.py` | texts (`T`), JSON files (`load` / `save` / `flag`), TMDb client, the one shared `xbmc.Monitor` |
| `NL/netfix.py` | TMDb reachability: alternative host, DNS over HTTPS (`Failover`); identical copy in `TL/netfix.py` |
| `NL/providers.py` | provider registry, hub search (`run_search`, `rank`, `hub_results`), engine bridge, source picker (`fallback_pick`) |
| `NL/epmatch.py`, `NL/searchhist.py` | season / episode parsing and exact match; search history and keyboard completions |
| `NL/iptv.py` | playlist merge, guide build, PVR IPTV Simple configuration, TV menus, dead-stream check |
| `NL/livefail.py`, `NL/ytlive.py`, `NL/livebar.py`, `NL/livesubs.py` | Israeli channel table with failover; YouTube live lookup; live bar window data; live subtitles through the PC server |
| `NL/epg.py` | free guide: epgshare01 XMLTV per country, match by normalised name, translation |
| `NL/radio.py`, `NL/yt.py`, `NL/topics.py`, `NL/ia.py`, `NL/libraries.py`, `NL/ticker.py` | radio-browser; YouTube lists without a key; curated sections (`resources/topics/*.json`); Internet Archive; optional Kodi add-ons; news + weather ticker |
| `NL/subdetect.py`, `NL/subprobe.py`, `NL/hardsub.py` | track list of the playing video; text of embedded tracks read from the file; burned-in check (frames -> Gemini), black box |
| `NL/subfix.py`, `NL/substore.py`, `NL/syncmath.py`, `NL/mtrans.py` | subtitle decode / repair; store of created subtitles; delay and dual-subtitle maths; machine translation, Hebrew-only filter |
| `NL/player_menus.py`, `NL/playerctl.py`, `NL/subsmenu.py` | player panels (sync, settings, audio, picker, appearance, next episode); player controls, remembered delays; BN subtitles window |
| `NL/ktuvitauth.py` | Ktuvit login with the viewer's account |
| `NL/services.py`, `NL/accounts.py`, `NL/weblink.py` | one screen for every login / key and its tests; older accounts screen; open a page in the device browser + QR |
| `NL/users.py` | household users: active user's files are the ordinary ones, others wait in `users/<id>/` |
| `NL/syncdoc.py`, `NL/autosync.py`, `NL/cloudsync.py` | merge rules of the shared document; the sync round (`cycle`, `KodiHost`, `loop`); engine call + sync menu |
| `NL/backup.py`, `NL/preset.py`, `NL/gdrive.py`, `NL/gdrive_ui.py` | backup / restore zip; password-locked profile (`.nvp`); Google Drive client; its screens and jobs |
| `NL/pairing.py`, `NL/pairflow.py`, `NL/pairui.py`, `NL/webpair.py`, `NL/qr.py` | LAN pairing protocol; its two sides without Kodi; its screens; web pairing QR; QR encoder + PNG writer (identical copy in `TL/qr.py`) |
| `NL/profiles.py` | device profiles: detect, plan, apply, repair, wizard |
| `NL/skinpatch.py`, `NL/depov.py`, `NL/subspatch.py`, `NL/idanpatch.py` | patches of the skin, of POV leftovers, of All_Subs, of Idan+ (section 3.7) |
| `NL/sysupdate.py`, `NL/status.py`, `NL/speedtest.py`, `NL/helpcenter.py`, `NL/kodisettings.py` | system update / rollback; status table; speed test; help; shortcuts to Kodi's windows |
| `NL/binfix.py`, `NL/ytport.py`, `NL/branding.py`, `NL/clip.py`, `NL/clipui.py` | binary add-ons per platform; YouTube add-on port; splash / shortcuts; clipboard bridge; its keyboard buttons |
| `resources/` data | `settings.xml`, `topics/*.json`, `help/*.json`, `providers_status.json`, `dead_streams.json`, `stream_health.json`, `media/`, `skin/*.xml`, `keymaps/bn_player.xml`, `cacert.pem`, `build_addons.txt` |

### 2.3 Engine modules (`TL/`)

| File | Responsibility |
|---|---|
| `service.py` | `Service`: settings, dependencies, Telegram start, `rpc` dispatch, `_cloud`, config export / import, `_watchdog` |
| `router.py` | plugin menus, login screens (phone, QR), source picker (`play`, `_wait_job`), `hub` (the hub's entry), `playtg` / `playrd` / `playurl` |
| `rpc.py` | plugin-side RPC client, stream URL and token |
| `stream.py` | HTTP server (`App`), `/rpc` and `/stream` handler, `ChunkStore` (1 MiB chunks, LRU cache, read-ahead, `cancel_stale`) |
| `tgclient.py` | Telethon wrapper `TG` on its own asyncio thread: login, search, bots, `read_head` / `read_chunk`, pacing (`_pump`, `_slot`), `cloud_*`, `hush` |
| `sources.py` | `Finder`: `build_target`, `plan_queries`, `find`, `find_free`, `_deep`, `content_bots`, `playable`, `probe`, `union_dedup`, `order_groups` |
| `parser.py`, `matcher.py` | release-name parser; accept / maybe / reject and score |
| `mediainfo.py`, `mediaflags.py` | MKV / MP4 header reader; seek index, `moov` place, Dolby Vision / HDR / sound formats -> hide / move (`judge`, `device_caps`) |
| `hints.py`, `opensubs.py`, `stremthru.py`, `realdebrid.py`, `backends.py` | Wikidata names, Wizdom releases, duplicate folding; moviehash identification; cached-hash check; Real-Debrid + Torrentio; Telemedia bridge, Stremio servers |
| `meta.py`, `gemini.py` | TMDb + Cinemeta metadata; Gemini aliases / verify / AI search |
| `tgauth.py`, `tgbots.py` | phone-login state and error texts; conversations with bots |
| `configio.py`, `cache.py`, `deps.py`, `aesfast.py`, `common.py` | sealed file format (`pack` / `unpack`); SQLite TTL cache; PyPI wheels; AES-IGE back-ends (`resources/bin/*`, source `src/native/tnige.c`); settings, paths, `scrub` |

RPC methods of `Service.rpc` (checked by name): `ping`, `status`, `reinstall_deps`, `rd_status`, `rd_device_start`,
`rd_device_poll`, `rd_logout`, `rd_resolve`, `svc_check`, `send_saved`, `config_export`, `config_import`,
`clear_cache`, `ai_test`, `ai_search`, `find_start`, `find_status`, `find_cancel`, `chiko_chats`, `chiko_browse`,
`bot_mark`, `bot_list`, `bot_ask`, `discover`, `raw_search`, `cloud_list` / `cloud_put` / `cloud_get` / `cloud_delete`,
and the pass-through set `send_code`, `resend_code`, `sign_in`, `sign_in_password`, `qr_start`, `qr_wait`,
`qr_accept`, `qr_check`, `logout`, `dialogs`, `chat_videos`, `join`, `leave`, `file_info`.

### 2.4 Background loops and threads

Hub (`N/service.py:main`). The main thread applies the patches, then loops on `waitForAbort` and starts `iptv_job`
when `iptv_refresh_h` has passed. Every job is a closure inside `main`, run as a daemon thread by `later(delay, job)`,
which waits with `waitForAbort` so a pending job never holds Kodi's exit. Network jobs call `wait_idle()`.

| Job | First run after | Job | First run after |
|---|---|---|---|
| `bn_player_job`, `discover_server`, `startup_job` | at once | `sync_job` (`autosync.loop`, round every 90 s) | 45 s |
| `pvr_ready_job` | 1 s | `telescope_job` (installs the engine when missing) | 75 s |
| `clip_job` | 2 s | `guide_job` | 90 s |
| `ticker_job` | 3 s | `gdrive_job` | 120 s |
| `livesubs_job` | 4 s | `topics_job` (repeats about every 6 h; guarded start) | 180 s |
| `align_job`, `binary_job` | 5 s | `backup_job` (weekly zip) | 600 s |
| `menu_job` | 6 s | `cache_job` (TMDb cache, hourly check) | 900 s |
| `profile_job` (`profiles.auto` / `apply` / `repair`) | 8 s | `streams_job` (every 12 h; guarded start) | 1200 s |
| `branding_job`, `restored_job` | 20 s | `wizard_job` | 30 s |
| `migrate_job` | 40 s | `lite_job` | 50 s |

Per playback, `Player.begin` raises a generation number and starts the subtitle `Flow` (`Player.start_flow`); a flow
stops when the generation moved on (`Flow.same_video`, `alive`).

Engine. `Service.start` starts the HTTP server and writes `port.json` first, then dependencies, Telegram, `Finder`.

| Thread | Created in | Does |
|---|---|---|
| `telescope-http` + one per connection | `TL/stream.py:App.serve`, `_Server` (ThreadingMixIn) | `/rpc`, `/stream` |
| `telescope-tg` | `TL/tgclient.py:TG.start` | the asyncio loop; other threads use `TG.run` (blocking) / `TG.submit` (future) |
| `telescope-find`, one per search job | `TL/sources.py:Finder.start` | `Finder._run` -> `find` / `find_free` |
| pool of 8 | `TL/sources.py:Finder.__init__` (`ThreadPoolExecutor`) | HTTP back-ends, hints, link tests |
| service main thread | `TL/service.py:Service.run` | `_watchdog` (reconnect), cache purge; on abort `App.shutdown`, `_threads_left` |

## 3. Main flows

### 3.1 Title -> sources -> ranking -> playback

1. `N/default.py:play` -> `NL/providers.py:play_with_fallback` -> `fallback_pick`: Telegram by TMDb id
   (`telegram_sources`, a directory read of the engine with `mode=hub`) and the other providers (`run_search`) at the
   same time; `_pick` shows one list.
2. Engine `TL/router.py:hub` builds the target, calls RPC `find_start`, polls `find_status`, cancels with `find_cancel`.
3. `TL/sources.py:Finder.find`: `build_target` (TMDb names, IMDb id, runtime; Wikidata and Gemini aliases) ->
   `plan_queries` -> chats to search (pinned, `library_chats`, bot chats from `content_bots`) -> `TG.search` /
   `search_in`, `backends`, `realdebrid` in parallel -> `_ask_bot` -> `_collect` -> `_deep` (inside chats with hits).
4. Matching: `TL/parser.py:parse` + `TL/matcher.py:evaluate`; optional `gemini.Gemini.verify` on the doubtful rows.
5. Filters and marks: `playable` (data rate), `_mark_synced` (Wizdom), `_os_identify` (moviehash).
6. `probe`: first bytes of every link (`TG.read_head`, HTTP range), `mediainfo.inspect` -> `_apply_media`,
   `mediaflags.inspect` -> `_apply_flags`, `mediaflags.judge` against `device_caps`.
7. Order: `union_dedup`, `order_groups` (Telegram, Real-Debrid, others). The engine's own picker is
   `TL/router.py:play` with `_wait_job`; a Real-Debrid row is resolved at play time (`rd_resolve`, next source on failure).

Details and line numbers: `docs/web-audit/kodi-features.md` area 4 (P01-P25).

### 3.2 Telegram streaming

1. The list item path is `TL/rpc.py:stream_url(chat, msg, name)`.
2. `TL/stream.py:make_handler` checks `Host` and token, takes size / name from `App.file_info`, answers 200 / 206.
3. Bytes come from `ChunkStore.get` in aligned 1 MiB chunks: LRU cache (setting `cache_mb`), `prefetch`
   (`readahead`), `cancel_stale` after a seek, `set_pos` / `drop_pos` per connection. Connections are told apart by
   `User-Agent` (player, the hub's own short reads, background readers such as the subtitle server).
4. A missing chunk is fetched by `Service._fetch` -> `TG.submit(TG.read_chunk(...))`; `TG._slot` / `_pump` pace the
   requests under Telegram's limits.
5. Exit: `App.shutdown` sets `closing`, cancels fetches and closes sockets so no thread stays in a read
   (`src/qa/t_exit.py`); the hub's long POSTs use `N/service.py:_post_wait` (`src/qa/t_postwait.py`).

### 3.3 Subtitles (detection, search, AI)

1. `Player.onAVStarted` -> `begin` -> `start_flow` -> `Flow._run`.
2. `Flow.verify_embedded`: `NL/subprobe.py:probe` reads the text of embedded tracks, `decide` gives the verdict; the
   result is published in `NovaTV.HebInside` (wait / yes / no), which the patched All_Subs obeys (`NL/subspatch.py`).
3. `Flow.hardsub_check`: frames -> Gemini (`NL/hardsub.py`); burned-in Hebrew ends the flow, foreign text switches
   on the black box (`hardsub.box_on`, restored by `Player._box_off`).
4. Human subtitles: All_Subs searches by itself; the hub's own path is `NL/player_menus.py:auto_subtitles`
   (`wizdom_search`, `wizdom_download`, else `NL/mtrans.py:translate`).
5. AI: when `_server_up` answers, `Flow._run` posts `/jobs`, polls `/jobs/<id>?pos=<play position>`, fetches
   `/jobs/<id>/srt`, sets the subtitle, stores it (`NL/substore.py:save`). Forced start: `N/default.py:ai_subs_now`
   -> `Monitor.onNotification` -> `Player.ai_now`.
6. `align_job` sends a placed subtitle to `/align`. Live channels: `NL/livesubs.py:start` posts `/live` and plays the
   returned re-stream.

### 3.4 Live TV and guide

1. `NL/iptv.py:merge` -> `_merge`: downloads the enabled playlists (`FREE` + the viewer's `iptv.json`), drops dead /
   restream entries (`livefail.is_restream`, `dead_streams.json`, `stream_fail.json`), groups by name; writes
   `alternates.json`, `live_extra.json`, `nova_channels.m3u`.
2. Guide: `free_guide` + `rebuild_guide` (`NL/epg.py:build`, `stream_guide`, `match`, `apply_lang`), `merge_epg`,
   `fill_unserved` + `livefail.own_guide` / `own_rows` -> `nova_epg.xml.gz`. `configure_pvr` writes
   `addon_data/pvr.iptvsimple/instance-settings-1.xml` pointing at both files.
3. Play: the PVR entry is a hub URL -> `NL/livefail.py:live`: `candidates` (direct licensed streams, listed streams,
   Idan+ URLs), `_alive_url`, `ytlive.find` for `yt:` sources; first working one is resolved.
4. A failed open: `Player.onPlayBackError` retries once and records the cause (`tv_fail_note` -> `tv_fail.json`).
5. Upkeep: `streams_job` -> `iptv.check_streams`; `guide_job`; `pvr_ready_job` sets `BN.PVRReady`.
6. Web: `web/channels_il.json` is generated from `livefail.py` by `src/qa/web/gen_channels.py`; the guide is
   `web/data/epg_il.json` from `src/qa/web/gen_epg.py`, run by `.github/workflows/epg.yml` (cron `17 */6 * * *`).

### 3.5 Backup, continuous sync, pairing

| Mechanism | Steps | Files |
|---|---|---|
| Continuous sync (Kodi) | `autosync.loop` every `PERIOD` = 90 s, at once when `bn.sync.now` is set -> `run_once` -> `cycle(host)`: stamp local changes, fetch the document when its mark changed, `syncdoc.merge`, write the result (settings through Kodi, lists as files), upload when this device added something | `NL/autosync.py`, `NL/syncdoc.py`, `NL/cloudsync.py:engine` |
| Its storage | engine `cloud_put`: `configio.pack` of a zip, key `telenova-setup-v1:<account id>` (`_cloud_key`), file `TeleNova-setup-<device>.tnsync` in Saved Messages; the shared document is device name `sync-v2` | `TL/service.py:Service._cloud`, `TL/tgclient.py:cloud_list` / `cloud_put` / `cloud_get` / `cloud_delete` |
| What travels | users + per-user history / favourites / searches / marks; settings of `ADDONS` (hub, engine, All_Subs) except names matching `LOCAL`; `FILES` (`iptv.json`, `providers.json`, `services.json`, `profiles.json`); resume points inside history (`syncdoc.with_progress`). Never the Telegram session | `NL/autosync.py` constants, `NL/syncdoc.py` |
| Continuous sync (web) | same document and merge: round every 45 s while visible, 3 s after a local change | `web/tg.js` (`PERIOD`, `DEBOUNCE`), `web/websync.js`, `web/syncdoc.js`, `web/sealed.js`, `web/store.js` |
| Web pairing | Kodi shows a QR of `<site>/web/#pair=<id>.<hash>` (optionally sends the link to Saved Messages); the page removes the fragment and keeps the pair in that browser; the browser then signs in with its own session | `NL/webpair.py`, `web/app.js:takePair`, `web/tg.js`, `web/tglogin.js` |
| LAN pairing | receiver listens + beacons; sender connects; DH handshake with commitment and 6-digit code; setup sent over the encrypted `Channel`; the new device gets its own Telegram login, approved by the configured one (`qr_accept`) | `NL/pairing.py`, `NL/pairflow.py:run_sender` / `run_receiver`, `NL/pairui.py` |
| Backup file | `backup.make_zip` over `_members` (six `addon_data` folders + four userdata files, minus `SKIP`) or `_members_full`; `extract` + `keep_filled` + `stale`; `restore_zip` ends Kodi with `os._exit(1)`; `restore_personal` merges without a restart; weekly `auto_backup` | `NL/backup.py` |
| Others | Google Drive backup / sync (`NL/gdrive_ui.py`), locked profile (`NL/preset.py`), engine `.tncfg` export without the session (`Service.config_export`) | |

### 3.6 Device profiles

`profile_job` (8 s after start): no profile yet -> `profiles.auto` (`facts`, `detect`, `classify`; asks only when
unsure); else re-apply once per `tune_done`; then always `profiles.repair`, which re-applies the platform's default
when the stored profile does not suit this platform (a profile that arrived by backup / sync) and puts the skin's
`touchmode` and mouse input back to the profile's values. `profiles.apply` sets Kodi settings through JSON-RPC
(`plan`), inputstream.adaptive limits, the skin touch flag, and stores the choice with `common.flag('device_profile')`.
Manual choice: `profiles.wizard` (root menu).

### 3.7 Patching third-party files

All patchers are plain Python (no Kodi imports); they run at service start (`N/service.py:main`) and on the staged
build (`src/qa/Clean-Build.ps1`, step 5). Each looks for its marker or the old text before writing.

| Function | Target | Change |
|---|---|---|
| `skinpatch.apply` (calls `expr_fixes`, `focus_label`, `_menu_button`, `bn_player`) | skin.fentastic player OSD and subtitle dialog XML | AI subtitle button, BN subtitles item, BN player include, repairs of conditions Kodi cannot parse |
| `skinpatch.keyboard_buttons`, `keyboard_complete`, `default_views`, `notification`, `home_layout` | `DialogKeyboard.xml`, `Variables.xml`, view XML, `DialogNotification.xml`, `Home.xml` | Paste / clipboard buttons, search suggestions, view by content, slim notification, home layout |
| `depov.patch_skin`, `patch_skin33`, `clean_favourites` (`migrate_job`) | skin XML, `favourites.xml` | links of the removed POV add-on |
| `subspatch.apply`, `apply_plus` | All_Subs / All Subs Plus Python files | "BN guard" steps: one Player / Monitor, obey `NovaTV.HebInside`, no search on live TV, `BN.LastSubFile` |
| `idanpatch.apply` | Idan+ `resources/lib/common.py` | YouTube id fix, request time limits |

The service calls `ReloadSkin()` after a skin change. Checker for skin conditions: `src/qa/skin_expr_check.py`.

### 3.8 Web version (as on disk)

Shell loaded by `web/index.html`: hls.js (jsDelivr, SRI), `version.js`, `i18n.js`, `syncdoc.js`, `store.js`,
`websync.js`, `shell_core.js`, `app.js`. `app.js` holds the router (hash routes), layout per device, the title page
and the registry `MODULES` (24 lazy modules, `loadModule`, `registerPage`, `registerProvider`, `providers(kind)`).

| Module group (`web/*.js`) | Does |
|---|---|
| `tg.js`, `tglogin.js`, `sealed.js` | GramJS session, sync loop, sign-in page (QR / phone / API details), the build's sealed format |
| `matcher.js`, `epmatch.js`, `tgsearch.js`, `telegram.js` | ports of `parser.py` + `matcher.py`, `epmatch.py`, the `Finder` pipeline, the engine's screens |
| `tgplay.js` + `sw.js` | `<video src=".../tgstream/<key>">`: the service worker turns Range requests into messages; the page reads 512 KB parts through GramJS |
| `catalog.js`, `sources.js`, `player.js`, `rd.js` | TMDb catalogue; link list of a title; own player overlay; Real-Debrid |
| `srt.js`, `subs.js` | subtitle text tools; subtitle providers |
| `iptv.js`, `epg.js`, `radio.js`, `yt.js`, `topics.js`, `hub.js` | live TV, guide, radio, YouTube, curated sections, hub search |
| `services.js`, `library.js`, `backup.js`, `gdrive.js` (+ `gdrive_cb.*`), `help.js`, `status.js` | accounts + device, source switches, sync / backup, Drive (browser OAuth), help, status |
| `helper.js` (not in `MODULES`; loaded with `TN.loadScript`) | client of the helper Worker |

`sw.js`: cache `bn-web-<WEB_VERSION>`, precache lists `SHELL` and `MODULES`, the `/tgstream/` Range proxy.

## 4. Data files and settings

Profile folder of the hub = `userdata/addon_data/plugin.video.nova/`; of the engine = `.../plugin.video.telescope/`.
Shapes of the personal files (history, favourites, users, `iptv.json`...): `docs/web-audit/kodi-features.md` area 16.

| File | Shape (brief) | Written by | Sync |
|---|---|---|---|
| `settings.xml` (hub, engine, All_Subs) | Kodi settings; ids in `N/resources/settings.xml`, engine `resources/settings.xml` | Kodi; `autosync.KodiHost` | yes, except `LOCAL` names |
| `history.json` | list, 500 newest, key `movie:<tmdb>` / `tv:<tmdb>:<s>:<e>`, resume `t` / `d` | `Player.record_history` | yes |
| `favourites.json`, `favourites_removed.json` | `{kind, id, label, extra, added}`; tombstones | `N/default.py:fav_add`, `fav_rm`; `gdrive_ui.remember_removed` | yes |
| `search_history.json` | newest first | `NL/searchhist.py` | yes |
| `users.json`, `users/<id>/*`, `user_marks.json` | users with tombstones; per-user copies | `NL/users.py` | yes |
| `iptv.json`, `providers.json`, `services.json` | playlists + guide URLs; provider switches; service flags incl. `sync_on` | `iptv.edit_sources`, `providers.toggle`, `NL/services.py` | yes |
| `sync_meta.json` | this device's last-seen mark and change times | `NL/autosync.py` | no (`backup.SKIP`) |
| `firstrun.json` | once-only flags, `device_profile` | `common.flag` | not established |
| `alternates.json`, `live_extra.json`, `stream_fail.json`, `tv_fail.json`, `nova_channels.m3u`, `nova_epg.xml.gz` | live TV state (section 3.4) | `NL/iptv.py`, `N/service.py:tv_fail_note` | no |
| `sub_offsets.json`, `subbox.json`, subtitle folders | remembered delays; saved subtitle style; created subtitles | `NL/playerctl.py`, `NL/hardsub.py`, `NL/substore.py` | not established |
| `preset.nvp`, `preset_guard.json`, `gdrive_token.json`, `gdrive_state.json` | locked profile; Drive sign-in | `NL/preset.py`, `NL/gdrive_ui.py` | no (`backup.SKIP`) |
| engine `port.json` | `port`, `secret`, pid; new secret every start | `Service.start` | no (left out by `backup._members`) |
| engine `telegram.session` | Telethon login | Telethon | never in the sync document or `.tncfg` |
| engine `bots.json`, `rd_dead.json`, `cache.db`, `lib/` | bot marks / statistics; refused links; TTL cache; downloaded wheels | `TL/sources.py`, `TL/realdebrid.py`, `TL/cache.py`, `TL/deps.py` | `cache`, `lib` skipped by backup |
| `userdata/novatv_build.txt`, `novatv_addons.txt` | build marker; add-ons the build ships | `src/qa/Clean-Build.ps1` | - |
| browser | users, lists, settings in the build's shapes | `web/store.js` | through `web/websync.js` |

On disk but not tracked by git (a fresh clone lacks them): `N/resources/preset.nvp`, `build.nvp`,
`gdrive_client.json`. Tracked generated file: `N/resources/build_addons.txt` (written by `Clean-Build.ps1` step 3b).

## 5. Build and release pipeline

| Step | Tool | Effect |
|---|---|---|
| 1 version | `python src/tools/bump.py X.Y.Z "news"` | version in the four `addon.xml`; news line of the engine; build marker in `Clean-Build.ps1`; README table; repository zip links in `README.md`, `index.html`, `web/app.js`; old `repository.telenova-*.zip` removed from the root except 3.1.0 |
| 2 stage | by hand: join and extract the previous `build/TeleNova-<prev>.zip.part*` into a temp folder | a Kodi home folder (`src/HANDOFF.md` release recipe) |
| 3 clean | `src/qa/Clean-Build.ps1 -Root <stage> -Src src` | removes unused add-ons and POV leftovers, cleans favourites, writes `build_addons.txt`, copies the four add-ons, writes the build markers, runs the patchers |
| 4 defaults | `python src/tools/build_config.py <stage>`; `python src/qa/addonsdb.py <stage> --fix` | Kodi settings, home rows and labels; every add-on enabled in `Addons33.db` |
| 5 package | `python src/tools/package.py <stage>` | `repo/<id>/<id>-<ver>.zip` for the four add-ons, their blocks in `repo/addons.xml` + `addons.xml.md5`, repository zip copied to the root, `build/TeleNova-<ver>.zip.partN` (parts under 95 MB), `build.json` (version, parts, size, sha256) |
| 6 publish | `git commit`, `git push origin gh-pages` | the repository root is the GitHub Pages site: `index.html`, `guide.html`, `build.json`, `build/`, `repo/`, `web/`, `ios/`, `windows/` |
| 7 verify | open `https://bennymat93.github.io/TeleNova/repo/addons.xml` | shows X.Y.Z |

Consumers: the wizard reads `BUILD_INFO` = `.../build.json`, downloads the parts, checks the SHA-256, extracts into
Kodi's home keeping `KEEP_ON_UPDATE` / `KEEP_FILES`, and exits with `os._exit(1)` (`src/plugin.program.novawizard/default.py:main`).
Installed boxes update the four add-ons through `repository.telenova`.

Other automation: `.github/workflows/epg.yml` is the only workflow (EPG JSON, commits to `gh-pages` itself). The web
version has its own number in `web/version.js`; `bump.py` does not change it. Helper Worker: `npx wrangler deploy` in
`worker/` (`worker/README.md`), not part of the release. `src/tools/nvp_clean.py` trims the shipped `.nvp` files
(asks for the password). Local test deploy: `src/qa/deploy_local.py` (copies changed sources into the main Kodi
profile); live QA `src/qa/qa_live.ps1` (`final_checks.py`, `crawl.py`, `playtest.py`, `stress.py`).
Never run `qa_all.ps1` / `qa_fast.ps1` on a profile with logins (they wipe it - `CLAUDE.md`).

## 6. Test map

All under `src/qa/`. "Offline" = no Kodi, no account.

| Area | Offline tests | Live tests (running Kodi / real account) |
|---|---|---|
| syntax, undefined names | Python 3.8 `ast.parse` one-liner (`src/HANDOFF.md`), `undef.py` | - |
| sync document, sync loop, users | `t_syncdoc.py`, `t_autosync.py` | `t_sync_live.py`, `t_cloud_live.py`, `t_users_live.py` |
| backup, locked profile | `t_backup_full.py`, `agentB/test_preset.py` | `t_export_live.py` |
| LAN pairing | `t_pairing.py` | `t_pair_live.py`, `t_pair_ui_diag.py` |
| parser, matcher, de-dup | `t_ptt.py`, `t_dedup.py`, `agentC/test_all.py` | `t_find_live.py` |
| media flags, paging | `t_paging_probe.py` | - |
| bots | `agentC/test_bots.py`, `agentC/test_botrules.py` | `t_bots_live.py`, `t_bots_kodi.py`, `t_quiet_live.py` (do not run) |
| Real-Debrid, StremThru, OpenSubtitles, hints | `agentC/test_rd.py`, `t_stremthru.py`, `t_opensubs.py`, `t_hints.py` | `t_rd_live.py` |
| Telegram login, engine config, Saved Messages | `t_tgauth.py`, `t_config.py`, `t_send_saved.py` | - |
| stream server exit, hub POST wait | `t_exit.py`, `t_postwait.py` | `tg_play_test.py`, `tg_bench.py`, `afterstop.py` |
| subtitles | `t_subprobe.py`, `t_hardsub.py`, `t_hebrew_only.py`, `t_ktuvitauth.py` | `t_subs_kodi.py`; `t_subs.py`, `t_servercrash.py` (fixed paths of the owner's PC) |
| services screen, search history, clipboard | `t_services.py`, `t_searchhist.py`, `t_clip.py` | `t_kb_live.py`, `t_paste_kodi.py` |
| live TV, guide | `t_live_table.py`, `t_epg_xml.py`, `t_bug014.py`, `t_idanpatch.py`, `check_channels.py` (network) | `t_il_audit.py`, `t_tv_rounds.py`, `t_live_keys.py`, `livetime.py` |
| hub router errors | `t_bug012.py` | `crawl.py`, `stress.py` |
| skin, profiles | `t_skinxml.py`, `skin_expr_check.py`, `t_profiles.py` | `t_view_live.py`, `shots.py`, `inspect_skin.py` |
| build, site | `addonsdb.py`, `sitecheck.py` | `final_checks.py`, `wizard_test.py`, `release_check.ps1`, `android_qa.ps1` |
| web: sync, sealed format, store, texts, SW cache | `web/run_web_tests.py` (runs `gen_fixtures.py`, `t_web.js`, `check_repack.py`, `t_store.js`, `t_mixed.py`, `t_texts.js`, static checks) | - |
| web: other modules | `web/t_matcher.js`, `t_sources.js`, `t_srt.js`, `t_tgsearch.js`, `t_player.js`, `t_player_dom*.js`, `t_live.js`, `t_content.js`, `t_playback.js` - run one by one, not called by `run_web_tests.py` | - |
| helper Worker | `worker/test.mjs` | - |

No test found for: `NL/providers.py` (search, ranking, `fallback_pick`), `NL/iptv.py:_merge` and `configure_pvr`,
`NL/radio.py`, `NL/yt.py`, `NL/topics.py`, `NL/ia.py`, `NL/gdrive*.py`, `NL/webpair.py`, `NL/qr.py`,
`NL/netfix.py`, `NL/sysupdate.py`, `NL/status.py`, `NL/speedtest.py`, `NL/livesubs.py`, `NL/player_menus.py`,
`NL/depov.py`, `NL/binfix.py`, the hub's `Flow._run` as a whole, `TL/stream.py:ChunkStore` read-ahead logic,
`TL/tgclient.py` pacing, `TL/mediainfo.py` on its own, `TL/meta.py`, `TL/gemini.py`, `TL/deps.py`, the wizard
(only the live `wizard_test.py`), `src/tools/*.py`. Most of these are reached only by the live crawl / playback runs.

## 7. Weak points and coupling (observed in the code)

1. **Hand-kept duplicates.** `NL/qr.py` = `TL/qr.py` and `NL/netfix.py` = `TL/netfix.py` (byte-identical today, no
   check enforces it); `web/data/topics/*.json` are copies of `N/resources/topics/*.json`; `web/syncdoc.js`,
   `sealed.js`, `matcher.js`, `epmatch.js` are ports whose specification is the Python file. The sync ports are
   compared by `run_web_tests.py`; the topic copies and the two `.py` pairs are not.
2. **Two registries of web modules.** `MODULES` in `web/app.js` and the `MODULES` list in `web/sw.js` must name the
   same files. `web/shell_core.js` names a test `src/qa/web/t_shell.js` that is not in the tree.
3. **The web test runner covers the sync core only**; the other `t_*.js` files are not wired into it.
4. **The hub reads the engine's `port.json` itself** in two places (`cloudsync.engine`, `accounts.py`) without the
   retry `TL/rpc.py:call` has; a stale file surfaces as `service_down`.
5. **Text-matched patches of files that update themselves** (skin, All_Subs, Idan+): a changed upstream file makes a
   patch do nothing. `skinpatch.py`'s docstring still names `tools/make_build.py`, which does not exist in `src/tools`.
6. **A backup zip has no filter for the engine's `telegram.session`** (`backup._members` skips only `lib/`,
   `port.json`, compiled files and `SKIP`), while the sync document and `.tncfg` leave the session out by design.
   Restoring such a zip on a second device meets the AUTH_KEY_DUPLICATED rule of `CLAUDE.md`. Whether another check
   stops this was not established.
7. **Hard exits.** `backup.restore_zip`, `preset.py` and the wizard end Kodi with `os._exit(1)`.
8. **Very large units.** `N/service.py` (about 1,700 lines; every job is a closure inside `main`),
   `TL/sources.py` (1,900), `TL/router.py` (1,650), `TL/tgclient.py` (1,300), `NL/iptv.py` (1,180), `web/app.js` (2,400).
9. **Version numbers live apart.** `bump.py` covers the four add-ons, `Clean-Build.ps1`, README and links;
   `web/version.js` and `resource.uisounds.nova` are separate; `package.py`'s docstring still speaks of two add-ons
   while `ADDONS` lists four.
10. **The build step writes into the source tree** (`Clean-Build.ps1` 3b -> `N/resources/build_addons.txt`), and the
    stage is made by hand from the previous build's parts: no script rebuilds a build from sources alone.
11. **Files a clone does not have**: `preset.nvp`, `build.nvp`, `gdrive_client.json` (untracked), the AI subtitle
    server, the staged Kodi home.
12. **Tests tied to one PC**: fixed paths in `t_subs.py`, `t_servercrash.py`, `agentA/t.py`, `ige_test.py`,
    `release_check.ps1`; `qa_live.ps1` starts `C:\Program Files\Kodi\kodi.exe`. `src/qa/agentC/` holds some 170
    left-over temporary folders next to its four test files.
13. **`src/qa/check_channels.py` (untracked) reads `resources/channels_world.json`**, which is not in the hub's
    `resources/` folder today.
14. **The EPG workflow pushes to `gh-pages` on its own** every 6 hours: pull before every push.
15. **One `xbmc.Monitor` / `xbmc.Player` per script and threads that end on abort** are rules the code relies on
    (`common.monitor`, `later`, `_post_wait`, `App.shutdown`); new code that blocks in a read holds Kodi's exit.

## Appendix: sections kept from the 4.0.8 edition
Written at 4.0.8 and not re-checked line by line for 4.3.0; kept because the newer text above does not cover them.

### Search box suggestions

1. `searchhist.ask(heading)` wraps `Dialog().input`: sets `bn.search`, clears it afterwards, records the answer in `search_history.json` (`searchhist.py:104-115`). The engine's `router._ask` sets the same property and records through `RunPlugin(...?a=sh_add&q=...)` (`router.py:285-291`).
2. `skinpatch.keyboard_complete` adds a first value to the skin variable `AutoCompletionContentVar` in `Variables.xml`: `plugin://plugin.video.nova/?a=ac&q=<typed text>`, only while `bn.search` is set and the input is not hidden (`skinpatch.py:228-245`).
3. `?a=ac` -> `searchhist.suggest` (`default.py:686`, `searchhist.py:130`): returns nothing unless `bn.search` is set; otherwise history matches merged with TMDb `search/multi` titles.
4. A chosen row is `?a=ac_pick` -> `Input.SendText(done=false)` into the open keyboard (`searchhist.py:147-153`).

### Window(home) properties used as signals

| Property | Set by | Read by | Meaning |
|---|---|---|---|
| `NovaTV.AISubs` | hub `service.status` (`service.py:45`) | skin, `subsmenu.py`, `player_menus.py` | AI subtitle progress text |
| `NovaTV.HebInside` | `Flow` (`service.py:200-212, 272, 315`) | All_Subs guard v17 | wait / yes / no / empty |
| `NovaTV.SubsChosen` | `service.py`, `subsmenu.py`, `player_menus.py` | `service.py:465, 601, 758` | a subtitle was chosen for this file |
| `NovaTV.SubsManual` | setter not established (no `setProperty` found in the two add-ons) | `service.py:276`, cleared at `707` | manual choice survives the burned-in check |
| `NovaTV.AISrt` | `service.py:464` | `subsmenu.py` | path of the AI subtitle file |
| `NovaTV.AIMode` | `player_menus.py` | `service.py:387` | `mt` = machine translation only |
| `NovaTV.PrimaryFile` | `service.py:500`, `player_menus.py` | `player_menus.py` | main subtitle for dual display |
| `NovaTV.ABLoop`, `NovaTV.SyncMarkAudio`, `NovaTV.SyncMarkSub`, `NovaTV.Dual`, `NovaTV.SubsSource` | `player_menus.py` | `service.ab_loop`, `player_menus.py` | per-video panel state, cleared in `begin` (`service.py:28, 724`) |
| `NovaTV.iptv_busy` | `iptv.py:322, 622` | `iptv.merge`, `service.py:1323` | a merge or guide build is running |
| `NovaTV.restoring` | `backup.py:176`, `cloudsync.py`, `preset.py` | `service.py:882` | history must not be written |
| `BN.LastSubFile` | All_Subs guard v10 | `align_job` (`service.py:564`) | last subtitle file placed |
| `BN.LiveSubs`, `BN.LiveSubsLabel`, `BN.ExitTvLabel` | `livesubs.py` | `service.py:288, 715`, skin | live-subtitle stream state and labels |
| `BN.PVRReady` | `pvr_ready_job` | home rows (`iptv.py`) | TV channels are loaded |
| `BN.Ticker` | `ticker_job` | skin | ticker visible |
| `BN.Warming` | `topics_job` | QA scripts | pre-warm threads are running |
| `BN.OSDInfo` | setter not established in Python (used in `resources/skin` XML) | skin | cleared per video (`service.py:28`) |
| `bn.search` | `searchhist.ask`, engine `router._ask` | skin variable, `searchhist.suggest` | a search keyboard is open |
| `bn.clip.has`, `bn.clip.hist` | `clipui.py:77-163` | patched `DialogKeyboard.xml` | Paste / Clipboard buttons enabled |

Other signals: `NotifyAll(plugin.video.nova, ai_now)`; skin string `__chooseplayer`; settings used as once-only flags (`depov_done`, `lite_done`, `wizard_fix`, `tune_done`, `bn_player_ver`).

### Patching of third-party files

All patchers are plain Python without Kodi imports, so the same code runs in the hub service and on a staged build. Each checks its marker (or the absence of the old text) before writing.

| Function | Target | Marker | Change | Runs |
|---|---|---|---|---|
| `skinpatch.apply` (`skinpatch.py:15`) | `Includes_VideoOsd.xml`, `Includes_VideoOsd1/2/3.xml`, `DialogSubtitles.xml` | presence of the `ai_subs_now` RunPlugin string | adds the AI subtitle item and, via `_menu_button`, the BN subtitles item; calls `bn_player` | service start (`service.py:965`), Clean-Build |
| `skinpatch.bn_player` (`:113`) | copies `Includes_VideoOsdBN.xml`, `Custom_1190_BNLiveBar.xml`; edits `Includes.xml`, `VideoOSD.xml` | `BN_INCLUDE` line (`:110`) | registers the BN player style and the live bar window | inside `apply`; alone as fallback (`service.py:971`) |
| `skinpatch.keyboard_buttons` (`:182`) | `DialogKeyboard.xml` | `<!-- BN paste v1 -->` | buttons 3011 Paste and 3012 Clipboard history | service start, Clean-Build |
| `skinpatch.keyboard_complete` (`:233`) | `Variables.xml` | `<!-- BN search suggestions v1 -->` | first value of `AutoCompletionContentVar` | service start, Clean-Build |
| `skinpatch.default_views` (`:208`) | `View_62_BNEpisodes.xml` | `<!-- BN view by content v1 -->` | view 62 visible only for episodes / videos content | service start, Clean-Build |
| `skinpatch.notification` (`:320`) | `DialogNotification.xml` (whole file) | `<!-- BN notification v1 -->` | 500x100 notification in the top corner | service start, Clean-Build |
| `skinpatch.home_layout` (`:371`) | `Home.xml`, `Includes_Buttons.xml` | `<!-- BN home layout v1 -->` | centred menu and toolbar, include `BNToolButton` | service start, Clean-Build |
| `depov.patch_skin` (`depov.py:109`) | every `*.xml` of the skin | none: rules match only POV links; backup `<name>.pre-telenova`, restored if the result is not valid XML | POV links point at the hub | `migrate_job`, once (`depov_done`) |
| `depov.patch_skin33` (`:67`) | `Custom_1107_SearchDialog.xml`, `DialogButtonMenu.xml` | none: rules match once | fixes or hides entries that pointed at `a=noop` / the old wizard | `migrate_job`, Clean-Build |
| `depov.clean_favourites` (`:138`) | `userdata/favourites.xml` | none | removes favourites of removed add-ons | `migrate_job`, `backup.extract` |
| `subspatch.apply` (`subspatch.py:377`) | All_Subs `autosub.py`, `resources/modules/general.py`, `engine.py`, `sub_window.py`, `resources/sources/bsplayer.py`, `ktuvit.py` | `# BN guard v4` ... `# BN guard v18`, one per step | the guards of flow (d) | service start (`service.py:1037`), Clean-Build |
| `subspatch.apply_plus` (`:428`) | All Subs Plus `autosub.py` | `# BN guard plus v1` | main loop ends on abort | service start only |
| `idanpatch.apply` (`idanpatch.py:26`) | Idan+ `resources/lib/common.py` | `# BN fix v1` | `GetYouTube` extracts the video id from `watch?v=` links | service start only (`service.py:1075`) |

The service calls `ReloadSkin()` after a skin change (`service.py:961, 967`). Docstrings name `tools/make_build.py` as a second caller (`idanpatch.py`, `skinpatch.py`, `subspatch.py`); that file is not in `src/tools`, so build-time patching of Idan+ and All Subs Plus is not established. Also at service start, without a marker: the bundled `cacert.pem` replaces `script.module.certifi`'s file when it is newer (`service.py:1044-1071`), and the wizard's `addon.xml` is corrected once (`service.py:1369-1398`).

### Security and privacy boundaries implemented in the code

- **Loopback only.** The engine's server binds `127.0.0.1` (`stream.py:640`) and rejects any `Host` header other than `127.0.0.1:<port>` / `localhost:<port>` (`stream.py:404-409`).
- **RPC secret.** Random per service start, stored in `port.json`, compared on every `/rpc` call (`stream.py:427`). Any process that can read the profile folder can read it.
- **Stream token.** HMAC of chat and message; compared with `hmac.compare_digest` (`stream.py:451`).
- **Secrets in logs.** Engine `common.scrub` replaces `api_key= / key= / token= / secret=` values (`common.py:102-109`); used by `log_error`, `rpc.py:31,43`, `meta.py:44`, `gemini.py`, and the router's dialogs. The hub has no shared equivalent; one local redaction exists at `hardsub.py:112`. Whether every hub log line is free of keys is not established.
- **Real-Debrid links.** Dead links are remembered by the SHA-1 of the link, because a Torrentio link contains the account key (`realdebrid.py:303`, `HANDOFF.md:55`).
- **What leaves the device, and to whom:**
  - Telegram: search queries, file requests, bot messages; the sealed setup file in Saved Messages.
  - TMDb: title queries and ids, including the text typed in a search box (suggestions).
  - Gemini: title and file names for aliases and verification (engine); picture frames (hub `hardsub`), each with the viewer's key in a header.
  - Torrentio: IMDb id, and the Real-Debrid token when `rd_torrentio_key` is on (default on, `service.py:75`).
  - StremThru: info-hashes with the Real-Debrid token (`service.py:161-162`), only when switched on.
  - PC subtitle server: the stream URL, title, ids and the Gemini key (`service.py:383-385`); the subtitle text for `/align`.
  - Wikidata, Wizdom: IMDb id only (`hints.py:28-49`).
- **What does not leave the device (by the skip lists):** the Telegram session and `port.json` are never in the sync copy; `sync_state.json` and the Google Drive token are in no backup.
- **Bots.** Rules stated in the log (`HANDOFF.md:134-138`): messages go only to bots the viewer marked or bots whose chat already holds video; joining a channel a bot demands needs the viewer's answer unless `bot_autojoin` is on; one conversation per bot (`tgclient.bot_lock`). The hub's fast search disables bot requests (`router.py:1477`).
- **Restore.** `backup.extract` writes only under `addon_data/` and four named files (`backup.py:79-84`).
- **Dependencies.** Wheels from PyPI are checked against the digest PyPI reports (`deps.py:195-196`).
- **Known gap stated in the log:** a full backup and the `.tncfg` export contain the Telegram session (`HANDOFF.md:94`, BUG-010); consistent with `backup.py:18` and `service.py:258-260`.
