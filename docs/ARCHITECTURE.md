# TeleNova - Architecture

Written from the source tree as it stood on 2026-11-16 (working tree after release 4.0.8, with uncommitted changes in `livefail.py`, `hints.py`, `sources.py`). Paths are relative to `src/` unless they start with `docs/` or the repository root. `path:line` points at the place a statement rests on. "Not established" means the code that was read does not settle the point.

Short names used below: **hub** = `plugin.video.nova`, **engine** = `plugin.video.telescope`, **wizard** = `plugin.program.novawizard`.

## 1. Overview and component map

TeleNova is a Kodi 21 build made of two Python add-ons and the tooling that packs them. The hub is the only add-on the viewer browses: TMDb catalogues, search over several video add-ons, live TV and radio, subtitles, backup, settings screens. The engine owns one Telegram user session (Telethon), finds files for an exact title in Telegram, Real-Debrid and Stremio-style servers, tests the links and serves Telegram files to Kodi's player through a local HTTP range proxy. The wizard downloads and installs the whole build; `repository.telenova` lets Kodi update the four add-ons. Three third-party add-ons are patched in place because they update themselves and lose the changes: the skin `skin.fentastic`, the subtitle service `service.subtitles.All_Subs` and Idan+ (`plugin.video.idanplus`). AI subtitles are produced by a separate server on a PC that is not part of this repository.

```
                                Kodi 21 (one process, one Python interpreter per add-on script)
 +-----------------------------------------------------------------------------------------------------------+
 |  skin.fentastic (patched: skinpatch.py, depov.py)      service.subtitles.All_Subs (patched: subspatch.py) |
 |        | RunPlugin / $VAR / Window(home) properties            | Window(home) properties                  |
 |        v                                                       v                                          |
 |  plugin.video.nova  (hub)                                                                                 |
 |    default.py   plugin router (?a=...)        service.py   Player + Monitor + background jobs             |
 |        |  Files.GetDirectory("plugin://plugin.video.telescope/?mode=hub...")     |                        |
 |        |  HTTP POST 127.0.0.1:<port>/rpc (cloudsync.py, accounts.py)             | HTTP /jobs /align /live|
 |        v                                                                         v                        |
 |  plugin.video.telescope  (engine)                                        PC subtitle server (outside repo)|
 |    default.py -> router.py (plugin)  --rpc.py: POST /rpc + secret-->  service.py (xbmc.service)           |
 |                                                                         stream.py  HTTP server 127.0.0.1  |
 |    Kodi player --GET /stream/<chat>/<msg>/<hmac>/<name> (Range)-------> ChunkStore -> tgclient.py (asyncio)|
 |                                                                                                           |
 |  pvr.iptvsimple <- nova_channels.m3u / nova_epg.xml.gz (iptv.py)   plugin.video.idanplus (patched)        |
 |  plugin.video.youtube (plays yt: channels, topics)                 inputstream.adaptive (HLS)             |
 |  plugin.program.novawizard (build.json -> build zip)               repository.telenova (repo/addons.xml)  |
 +-----------------------------------------------------------------------------------------------------------+
        |                |               |              |             |              |
   Telegram (MTProto)  TMDb / Cinemeta  Real-Debrid   Torrentio    Gemini      Wizdom, Wikidata, StremThru,
                                                      (Stremio)                OpenSubtitles, YouTube, PyPI,
                                                                               iptv-org lists, epgshare01
```

External services by caller:

| Service | Called from | Purpose |
|---|---|---|
| Telegram (MTProto via Telethon) | `tgclient.py` | search, file download, bots, login, Saved Messages copy of the setup |
| TMDb | hub `common.tmdb` (`resources/lib/common.py:307`), engine `meta.py` | catalogues, names, runtimes, search suggestions |
| Cinemeta (Stremio) | engine `meta.py:195-205` | metadata without a TMDb key |
| Real-Debrid API | engine `realdebrid.py` | device login, cloud list, link resolution |
| Torrentio | engine `realdebrid.py:23,168-171` | torrents by IMDb id; with `rd_torrentio_key` on, the Real-Debrid token is part of the request path |
| StremThru | engine `stremthru.py` | which hashes are cached at Real-Debrid (optional, off by default) |
| OpenSubtitles REST | engine `opensubs.py` | file identification by moviehash (optional, off by default) |
| Gemini REST | engine `gemini.py`, hub `hardsub.py:102` | title aliases, match verification, AI search; frames for burned-in subtitle detection |
| Wikidata, Wizdom | engine `hints.py:28,46` | Hebrew names by IMDb id; releases that have a Hebrew subtitle |
| YouTube | hub `yt.py`, `ytlive.py`, playback by `plugin.video.youtube` | lists without an API key, live broadcast lookup |
| PyPI | engine `deps.py:26,195` | Telethon wheels, SHA-256 checked |
| Google Drive, ktuvit.me, radio-browser, open-meteo, Cloudflare speed test, translate endpoints | hub `gdrive.py`, `ktuvitauth.py`, `radio.py`, `ticker.py`, `speedtest.py`, `mtrans.py` | optional features |

## 2. Processes and threads at run time

Kodi runs every add-on script in its own Python sub-interpreter inside the one Kodi process.

**Services.** Two add-ons declare `xbmc.service`: the hub (`plugin.video.nova/addon.xml:11`, default start) and the engine (`plugin.video.telescope/addon.xml:11`, `start="login"`). The wizard is a script (`plugin.program.novawizard/addon.xml:6`); the repository has no code.

### 2.1 Hub service (`plugin.video.nova/service.py`)

`main()` (`service.py:944`) runs on the service's main thread: it creates the process's one `xbmc.Monitor` (`common.monitor`, `resources/lib/common.py:152`), a `Player` and a `Monitor`, applies the patches of section 5, sets Kodi's subtitle folder, copies the keymap, then loops on `waitForAbort` and starts `iptv_job` when the refresh interval has passed (`service.py:1500-1509`). All jobs are daemon threads started through `later(delay, job)` (`service.py:1095`), which waits with `waitForAbort` so a pending job never holds Kodi's exit.

| Job (`service.py`) | Start | What it does |
|---|---|---|
| `bn_player_job` (999) | at once | selects the BN player style once per version, only if the skin has the include |
| `discover_server` (1079, `subsnet.py`) | at once | finds the PC subtitle server (saved address, UDP broadcast, remote address) |
| `startup_job` (1308) | at once | status table after start; returns immediately in light mode without `status_on_start` |
| `pvr_ready_job` (1165) | 1 s | sets `BN.PVRReady` when the Israel channel group has a channel |
| `clip_job` (1486) | 2 s | `clipui.watch`: keeps `bn.clip.has` / `bn.clip.hist` current |
| `ticker_job` (1186) | 3 s | news and weather ticker; sets `BN.Ticker` |
| `livesubs_job` (1225) | 4 s | clears the live-subtitle state left by a previous run |
| `align_job` (556) | 5 s | polls `BN.LastSubFile` every 2 s; sends a placed `.srt` to the server's `/align` |
| `binary_job` (1256) | 5 s | `binfix.ensure`: replaces binary add-ons built for another platform |
| `menu_job` (1212) | 6 s | un-hides home menu items hidden by old skin settings |
| `profile_job` (1234) | 8 s | device profile at first start (`profiles.auto`) or re-apply once |
| `branding_job` (1203) | 20 s | splash and shortcuts in a plain Kodi |
| `wizard_job` (1369) | 30 s | once: corrects the wizard's `xbmc.python` requirement and enables it |
| `migrate_job` (1340) | 40 s | once: POV removal (`depov.patch_skin`, `patch_skin33`, favourites, disabled add-ons) |
| `lite_job` (1401) | 50 s | once: light-build settings |
| `telescope_job` (1428) | 75 s | installs the engine and `script.module.pycryptodome` when missing, once per version |
| `sync_job` (1124) | 90 s | `cloudsync.check_start`, then `cloudsync.tick` every 300 s |
| `guide_job` (1284) | 90 s | free TV guide, checked hourly, rebuilt when due |
| `gdrive_job` (1155) | 120 s | Google Drive sync and weekly backup when signed in |
| `topics_job` (1268) | 180 s, not in light mode | pre-warms the curated YouTube sections every 6 h; sets `BN.Warming` |
| `backup_job` (1114) | 600 s | `backup.auto_backup`: weekly local zip, three kept |
| `cache_job` (1454) | 900 s | deletes TMDb cache files older than 7 days, at most daily |
| `streams_job` (1139) | 1200 s, not in light mode | checks channel streams every 12 h |
| `iptv_job` (1105) | 15 s on a new install, else 120 s, then every `iptv_refresh_h` | `iptv.merge` |

Jobs that use the network call `wait_idle()` (`service.py:1087`) and do not run while something plays.

Per playback the `Player` (`service.py:657`) starts short daemon threads: `zero_state`, `ab_loop`, `again` (`service.py:727-764`), a `Flow.run` thread for subtitles (`service.py:838-843`) and, inside the flow, `hardsub_check` (`service.py:339`). Each `Flow` carries the generation number of its video and stops when `Player.gen` moves on (`service.py:92-96`).

### 2.2 Engine service (`plugin.video.telescope/resources/lib/service.py`)

`Service.start()` (`service.py:194`) does three things in order: starts the HTTP server, writes `port.json`, then installs dependencies, connects Telegram and builds the finder.

- **HTTP server**: `stream.App.serve` binds `127.0.0.1` on the configured port, then the next 19, then any free port (`stream.py:636-648`); thread name `telescope-http`; one daemon thread per connection (`ThreadingMixIn`, `stream.py:326-328`).
- **asyncio loop**: `TG.start` creates the thread `telescope-tg` running `loop.run_forever()` (`tgclient.py:60-73`). Other threads hand coroutines to it with `TG.run` (blocking) and `TG.submit` (returns a future) (`tgclient.py:107-118`).
- **Thread pool**: `Finder._pool`, 8 workers (`sources.py:113`), for HTTP back-ends, Wikidata, Wizdom, AI aliases and link tests of HTTP sources. Each search job runs in its own thread `telescope-find` (`sources.py:509`).
- **Main thread**: `Service.run` wakes every 10 s, runs `_watchdog` every 30 s (reconnect or restart of the Telegram client) and purges expired cache rows daily (`service.py:400-418`).

### 2.3 How the plugin processes talk to the engine

- `port.json` in the engine's profile holds `port`, `secret`, `pid`, `started` (`service.py:202`). The secret is 16 random bytes, new at every service start (`service.py:93`).
- The engine's plugin side calls `rpc.call(method, **params)`: `POST http://127.0.0.1:<port>/rpc` with `{method, params, secret}`; it retries a connection failure and `service_starting` three times (`rpc.py:19-44`). The server refuses a wrong secret, a `Host` header that is not the loopback name and port, and a body over 1 MiB (`stream.py:404-428`).
- Stream URLs are `/stream/<chat>/<msg>/<token>/<name>`; the token is the first 16 hex digits of HMAC-SHA256 over `chat:msg` with the secret (`rpc.py:47-63`, checked at `stream.py:450-452`).
- The hub reaches the engine in two ways: as a Kodi directory (`providers.read_dir` -> `Files.GetDirectory` on `plugin://plugin.video.telescope/?mode=hub...`, `resources/lib/providers.py:198-200, 414-420`), and directly over the same RPC by reading `port.json` itself (`cloudsync.engine`, `resources/lib/cloudsync.py:131-144`; `accounts.py:58`).
- While `start()` is still connecting, every method except `status` and `ping` waits up to 15 s and then answers `service_starting` (`service.py:466-473`).

### 2.4 Kodi's exit

- Hub: every wait uses the shared monitor's `waitForAbort`; `_post_wait` replaces a blocking POST with a `select` loop that checks the abort flag every second (`service.py:618-644`); at the end the threads still alive are logged (`service.py:1511-1524`).
- Engine: after the abort `App.shutdown()` sets `closing`, cancels in-flight chunk fetches, closes every accepted socket by descriptor (`socket.close(sock.detach())`, because on Windows `shutdown()` does not wake a blocked `recv`), then stops the listener (`stream.py:650-678`); `tg.stop(3)`; the finder's pool is shut down without waiting; remaining threads are logged (`service.py:419-437`).
- A restore (`backup.restore_zip`, `cloudsync.take`) and the wizard end Kodi with `os._exit(1)` so Kodi does not write its old settings over the restored files (`backup.py:193`, `cloudsync.py:246`, `plugin.program.novawizard/default.py:222`).

## 3. Main data flows

### (a) A title -> list of sources

1. Hub `default.play(m, id, q, ...)` (`default.py:347`) calls `providers.play_with_fallback` -> `fallback_pick` (`providers.py:460`). Two threads run: `telegram_sources` (joined for up to 45 s) and the other providers via `run_search` (6 s when Telegram has links, else 13 s).
2. `telegram_sources` reads the engine as a directory: `telegram_url(..., mode='hub')` (`providers.py:414-434`).
3. Engine `router.hub` (`router.py:1469`) builds `target = {type, tmdb, imdb, title, year[, season, episode]}`, adds reduced options when `fast=1`, calls `find_start`, polls `find_status` every 300 ms (10.5 s with reduced options, else 75 s), otherwise `find_cancel` (`router.py:1500-1510`). It lists each source with its stream URL or a `playrd` link.
4. Service `rpc('find_start')` -> `Finder.start` creates a `Job` and a thread (`sources.py:504-510`).
5. `Finder.find` (`sources.py:733`):
   1. cache lookup under `src:<type>:<id>:<s>:<e>:<t|r flags>` (30 min; reduced searches under `:fast`);
   2. `build_target` (`sources.py:522`): metadata, aliases, episode runtime; Wikidata and AI aliases start in the pool;
   3. `plan_queries` (`sources.py:693`): names x episode notations per script (Hebrew, Cyrillic, Latin);
   4. chats: pinned, `library_chats` (chats that gave accepted files before), "chiko" chats, chats of content bots (`sources.py:763-771`);
   5. searches in parallel: `tg.search` per query (first two limited to the chosen chats), Telemedia bridge, Stremio servers, `rd.streams` and `rd.cloud` (`sources.py:781-793`); extra queries when aliases arrive (waited at most `ai_alias_wait`);
   6. bots: `_ask_bot` for each content bot when `bot_request` is on (`sources.py:827-838`);
   7. `_collect` waits until `search_timeout` / `bot_timeout` (`sources.py:1024`); `_deep` searches again inside the chats that showed hits (`sources.py:655`);
   8. de-duplication by `(chat, msg)` and document id, copies kept as `mirrors`; `hints.merge_same_files` folds identical uploads (`sources.py:856-879`);
   9. matching: `parser.parse` + `matcher.evaluate` -> accept / maybe / reject; lighter rule for IMDb-matched server and Real-Debrid rows (`sources.py:881-899`); optional `ai.verify` on the "maybe" rows (`sources.py:905-931`);
   10. language bonus, CAM and minimum quality filters, `_mark_synced` from Wizdom (`sources.py:941-965`);
   11. `playable` drops files whose data rate exceeds what the source delivers (`sources.py:986-1011`);
   12. `probe` (`sources.py:1207`): 128 KiB sample per Telegram link (`tg.read_head`), 1 MiB for HTTP links, `mediainfo` on the sample, mirrors tried for dead links; Real-Debrid rows are marked `probe='rd'` and checked only at play time;
   13. `order_groups` (`sources.py:1510`): Telegram, then Real-Debrid (`rd_max`), then the rest; `_public` strips internal fields; the result is cached for 1800 s.
6. Hub `_pick` shows one list; the chosen item is a normal playable URL.

The engine's own menus use the same job through `router.play` -> `_wait_job` with a progress dialog (`router.py:1294-1389`).

### (b) Playing a Telegram file

1. The list item path is `rpc.stream_url(chat, msg, file)` (`rpc.py:56`). For Real-Debrid rows `router.play` calls `rd_resolve` and tries the next source (up to 4) on failure (`router.py:1366-1378`).
2. Kodi's player opens the URL. `Handler._stream` (`stream.py:441`) checks host and token, gets size and name from `app.file_info` (cached 30 min, `stream.py:621`), answers 200/206 with `Content-Range`.
3. The file is served in aligned 1 MiB chunks from `ChunkStore` (`stream.py:43`): an LRU cache (`cache_mb`), de-duplicated in-flight fetches, `prefetch` of `readahead + 1` chunks, and the last two chunks fetched early when a connection starts at byte 0 (`stream.py:484-487`).
4. Connections are classified by `User-Agent`: `Kodi/` is the player; `TeleNova-` is the hub's own short read (answered at once, never counted as the picture); anything else is a background reader while the player has the file open and gets low priority and 3 chunks of read-ahead (`stream.py:498-544`).
5. `cancel_stale` drops read-ahead that no open connection needs after a seek (`stream.py:250`).
6. A chunk is fetched by `Service._fetch` -> `tg.submit(tg.read_chunk(...))` (`service.py:184-187`): two parallel 512 KiB `upload.getFile` parts (`tgclient.py:958-980`).
7. Pacing in `tgclient` (`tgclient.py:602-760`): one wait queue ordered by urgency; `_pump` grants slots up to `_cap`, plus 2 for a chunk a player is blocked on and plus 6 for link-test samples; a token bucket holds the byte rate (start 4.5 MB/s for a non-Premium account); a flood wait closes one shared gate. `ChunkStore` reports priorities through three hooks set in `_start_tg`: `on_wait -> tg.bump`, `on_drop -> tg.drop`, `on_low -> tg.lower` (`service.py:135-138`).

### (c) Live TV

1. `iptv.merge` (`iptv.py:311`) guards with `NovaTV.iptv_busy`; `_merge` downloads every enabled M3U source, drops dead and restream entries of the free lists, groups by normalised name and keeps the best quality.
2. A channel carried by several sources becomes `plugin://plugin.video.nova/?a=live&alt=<key>`; the URL list goes to `alternates.json` (`iptv.py:391-402`).
3. A channel found in `livefail.CHANNELS` becomes `?a=live&ch=<key>`; streams the free lists carry for it are saved in `live_extra.json`; table channels missing from every list are added (`iptv.py:403-418`).
4. `_merge` writes `nova_channels.m3u` (HLS entries get `#KODIPROP:inputstream=inputstream.adaptive`), merges the guide into `nova_epg.xml.gz`, calls `configure_pvr`, which writes `addon_data/pvr.iptvsimple/instance-settings-1.xml` pointing at both files (`iptv.py:470-492, 732-760`).
5. Playing: pvr.iptvsimple opens the plugin URL -> `default.py:647` -> `livefail.live(handle, key, alt)` (`livefail.py:135`). Candidates in order: the broadcaster's direct streams, the listed streams, Idan+ plugin URLs. A `yt:<channel>` source is resolved by `ytlive.find` to a video id and played as `plugin://plugin.video.youtube/play/?video_id=...` (`ytlive.py:65`). Direct URLs are checked with `_alive_url`; plugin URLs are returned unchecked. The first that passes is given to `setResolvedUrl`.
6. A PVR channel that fails to open gets one retry after 2 s (`service.py:821-836`).

### (d) Subtitles

1. `Player.onAVStarted` -> `begin(path)`: bumps `gen`, clears the per-video properties, switches subtitles off for non-live video, then `start_flow(forced=False)` (`service.py:676-764, 838`).
2. `Flow._run` (`service.py:286`) sets `NovaTV.HebInside = wait`, waits until the track list is steady (at most 8 s), then `verify_embedded` (`service.py:176`): `subprobe.probe` reads the subtitle tracks from the file (range reads, 24 MiB budget, 25 s) and `subprobe.decide` gives the verdict; the property becomes `yes`, `no` or empty.
3. All_Subs reads that property through guard v17 and does not search while it says `wait` or `yes` (`subspatch.py:325-360`). Other guards: one shared `Player` and `Monitor`, no search when nothing plays or Kodi quits, no placement into another video, no search on live TV, `BN.LastSubFile` set after a subtitle is placed (v10, `subspatch.py:176-180`), the viewer's own Ktuvit account (v18).
4. `hardsub_check` runs beside the search (`service.py:215`): frames from `xbmc.RenderCapture` are sent to Gemini with the viewer's key (`hardsub.ask_gemini`); burned-in Hebrew cancels the flow, foreign text turns on a black subtitle box (`hardsub.box_on`, previous style kept in `subbox.json`).
5. AI flow (same `_run`): only for network streams the server can read. `POST <sub_server>/jobs`, poll `GET /jobs/<id>` every 5 s, fetch `/jobs/<id>/srt` when 120 s more are ready, write `ai/<job>/BN AI[ Nm].he.srt`, `setSubtitles` unless the viewer chose another subtitle; the finished file is stored by `substore.save` (`service.py:383-517`). The player button sends `NotifyAll(plugin.video.nova,ai_now)` (`default.py:753-758`) -> `Monitor.onNotification` -> `Player.ai_now` (`service.py:939-941, 845`).
6. `align_job` posts a placed `.srt` to `<sub_server>/align` and loads the synced copy from `aligned/` (`service.py:556-615`).
7. `mtrans.py` (free translation engines, `hebrew_only`) is imported inside the hub only by `iptv.py:582` (guide translation). Its use for subtitles happens on the PC server, which imports the module from an installed copy of the hub (source: `HANDOFF.md:30`); the server code is outside this repository.
8. Live subtitles: `livesubs.start` posts the channel URL to `<sub_server>/live` and plays the returned `/live/<sid>/master.m3u8` (`livesubs.py:158-207`).

### (e) Setup backup and sync

1. `backup.make_zip(path, sync=False)` (`backup.py:99`) zips `_members()`: the `addon_data` folders of six add-ons plus four userdata files, minus `SKIP` (`backup.py:14-19, 32-56`). Used by the manual backup, the weekly `auto_backup`, Google Drive and the locked profile (`preset.py`).
2. `backup.extract` restores only members under `addon_data/` or the four listed files, rejects path tricks, skips data of add-ons that are not installed (`backup.py:59-96`). `restore_zip` sets `NovaTV.restoring` and ends with `os._exit(1)`.
3. Sync copy: `cloudsync.push` (`cloudsync.py:154`) builds `make_zip(sync=True)` (the extra skip lists of section 4), computes `fingerprint()` over settings and choice files without volatile keys (`cloudsync.py:26-28, 111-128`), and calls engine `cloud_put`.
4. Engine `Service._cloud` (`service.py:346`): seals the zip with `configio.pack`, key `telenova-setup-v1:<account id>` (`service.py:334-344`; stated there as obfuscation, the protection is the account), 48 MB limit, and `tg.cloud_put` stores it in the account's Saved Messages, one file per device. `cloud_list`, `cloud_get`, `cloud_delete` are the other three methods.
5. `cloudsync.check_start` (90 s after start) lists the copies and `decide()` returns none / same / offer (`cloudsync.py:54-70`); an offer accepted by the viewer runs `take` -> `backup.extract` -> exit. `tick` (every 300 s) pushes when the fingerprint changed and 600 s passed since the last upload.
6. Separate from both: the engine's `.tncfg` export (`service.config_export` / `config_import`, `service.py:253-331`), which carries the engine settings, `bots.json` and the Telethon session.
7. `resources/lib/syncdoc.py` (merge rules for a shared document, marked 4.1.0) exists in the working tree and is imported only by `qa/t_syncdoc.py`; it is not part of any flow yet.

### (f) Search box suggestions

1. `searchhist.ask(heading)` wraps `Dialog().input`: sets `bn.search`, clears it afterwards, records the answer in `search_history.json` (`searchhist.py:104-115`). The engine's `router._ask` sets the same property and records through `RunPlugin(...?a=sh_add&q=...)` (`router.py:285-291`).
2. `skinpatch.keyboard_complete` adds a first value to the skin variable `AutoCompletionContentVar` in `Variables.xml`: `plugin://plugin.video.nova/?a=ac&q=<typed text>`, only while `bn.search` is set and the input is not hidden (`skinpatch.py:228-245`).
3. `?a=ac` -> `searchhist.suggest` (`default.py:686`, `searchhist.py:130`): returns nothing unless `bn.search` is set; otherwise history matches merged with TMDb `search/multi` titles.
4. A chosen row is `?a=ac_pick` -> `Input.SendText(done=false)` into the open keyboard (`searchhist.py:147-153`).

### (g) Build and release

1. `tools/bump.py <version>` rewrites the version in the four `addon.xml` files, the build marker in `qa/Clean-Build.ps1`, the README table and the repository zip links; removes older repository zips from the root except 3.1.0 (`tools/bump.py:22-41`).
2. `qa/Clean-Build.ps1 -Root <staged Kodi home> -Src <src>`: removes unused add-ons and leftovers, cleans favourites, copies the four add-ons into the stage, writes `userdata/novatv_build.txt`, then runs the patchers on the stage (`qa/Clean-Build.ps1:36-49`).
3. `tools/build_config.py <stage>`: Kodi settings, advanced settings, home rows and labels of the staged build.
4. `tools/package.py <stage>` (`tools/package.py:52`): zips each add-on to `repo/<id>/<id>-<version>.zip` with fixed timestamps, replaces its block in `repo/addons.xml`, writes `addons.xml.md5`, copies the repository zip to the root, zips the stage into `build/TeleNova-<version>.zip.partN` (95 MB parts) and writes `build.json` (`version`, `parts`, `size`, `sha256`).
5. The repository root is the GitHub Pages site (branch `gh-pages`): `build.json`, `build/`, `repo/`, `index.html`, `web/`, guides.
6. The wizard reads `build.json`, downloads and joins the parts, checks the SHA-256, extracts into Kodi's home and exits (`plugin.program.novawizard/default.py:90-222`). "Update" keeps the `addon_data` of the add-ons in `KEEP_ON_UPDATE` and the four userdata files in `KEEP_FILES`.
7. The order 2 -> 3 -> 4 is the one used by `qa/qa_all.ps1:39-42`, `qa/qa_fast.ps1:26-29` and `qa/release_check.ps1:11-14`. Where the stage folder comes from is not in the repository (`HANDOFF.md:115` names a temporary folder).

## 4. Where state is stored

"Backup" = part of a full backup zip; "Sync" = part of the copy kept in the Telegram account (`backup._members(sync=True)`). Full backups skip only `SKIP` names (`backup.py:18-19`); the sync copy also skips `SYNC_SKIP_DIRS`, `SYNC_SKIP_FILES`, `SYNC_SKIP_EXT`, files over 2 MiB and names starting with `yt_cache`, `radio_cache`, `tmdb_cache`, `epg` (`backup.py:24-29, 41`).

### 4.1 `addon_data/plugin.video.nova/`

| File / folder | Owner | Purpose | Backup | Sync |
|---|---|---|---|---|
| `settings.xml` | Kodi | add-on settings incl. keys | yes | yes |
| `history.json` | `service.py:859`, `default.py` | watch history, 500 entries | yes | yes |
| `favourites.json`, `favourites_removed.json` | `default.py`, `gdrive_ui.py` | favourites and removals | yes | yes |
| `search_history.json` | `searchhist.py:15` | 60 latest searches | yes | yes |
| `iptv.json` | `iptv.py:177,903` | the viewer's playlists and guide sources | yes | yes |
| `providers.json` | `providers.py:143,716` | which providers are on | yes | yes |
| `services.json` | `services.py:197-204`, `cloudsync.py:23` | service choices, `sync_on`, Ktuvit account fields | yes | yes |
| `sub_offsets.json` | `playerctl.py:42-53` | remembered subtitle delay per video | yes | yes |
| `epg_tr.json` | `iptv.py:584,605` | translated guide titles | yes | no (name starts with `epg`) |
| `preset_guard.json`, `preset.nvp` | `preset.py` | locked profile | no | no |
| `sync_state.json` | `cloudsync.py:22` | this device's sync state | no | no |
| `gdrive_token.json`, `gdrive_state.json` | `gdrive_ui.py` | Google Drive sign-in and state | no | no |
| `firstrun.json` | `common.flag`, `service.py:1442,1460`, `ytport.py` | once-only flags, last cache clean | yes | no |
| `subbox.json` | `service.py:32`, `hardsub.py` | subtitle style saved while the black box is on | yes | no |
| `alternates.json`, `live_extra.json`, `iptv_status.json` | `iptv.py:402,414,492` | fallback streams, last merge result | yes | no |
| `clipboard.json` | `clipui.py:48` | copy history | yes | no |
| `sysupdate.json`, `status.json`, `plots_he.json` | `sysupdate.py`, `status.py`, `default.py:428-449` | reports, translated plots | yes | no |
| `stream_fail.json` | `iptv.py:87` | failure counts of streams | yes | yes (not in a skip list) |
| `yt_cache.json`, `radio_cache.json` | `yt.py`, `radio.py`, `sysupdate.py` | list caches | yes | no |
| `nova_channels.m3u`, `nova_epg.xml.gz`, `free_guide.json.gz` | `iptv.py:18-19,502` | merged playlist and guide | yes | no (extension) |
| `cache/` | `common.tmdb` (`common.py:307`) | TMDb answers, 6 h | no | no |
| `backups/`, `pre_update.zip` | `backup.py:20`, `sysupdate.py:296` | local backup zips | no (`.zip`) | no |
| `ai/<job>/`, `aligned/`, `subtitles/`, `dual/` | `service.py:409,604`, `player_menus.py:267,443` | created and synced subtitle files | yes | `aligned` skipped by name; the rest are `.srt` (skipped by extension) |

### 4.2 `addon_data/plugin.video.telescope/`

| File / folder | Owner | Purpose | Backup | Sync |
|---|---|---|---|---|
| `settings.xml` | Kodi | API id / hash, keys, Real-Debrid tokens, preferences | yes | yes |
| `telegram.session` | Telethon (`common.py:25`) | the Telegram login | yes (not in `SKIP`) | no |
| `port.json` | `service.py:202` | port, RPC secret, pid | yes | no |
| `cache.db` | `cache.py` (`common.py:26`) | TTL cache: search results, aliases, `lib:chats`, Wikidata, Wizdom | no | no |
| `bots.json` | `sources.py:187-221` | bot choices and statistics | yes | yes |
| `rd_dead.json` | `realdebrid.py` (`service.py:71`) | SHA-1 keys of links refused at play time | yes | yes (not in a skip list) |
| `lib/` (+ `.deps.json`) | `deps.py:25` | downloaded Python packages | yes (not in `SKIP`) | no |

Also in a full backup: `addon_data` of `pvr.iptvsimple`, `service.subtitles.All_Subs`, `plugin.video.youtube`, `skin.fentastic`, and `favourites.xml`, `sources.xml`, `passwords.xml`, `mediasources.xml`. The sync copy leaves out `skin.fentastic`, `pvr.iptvsimple` and every userdata file except `favourites.xml` (`backup.py:34, 55`). Outside `addon_data`: `userdata/novatv_build.txt` (build marker, read by `cloudsync.py:177`) and `userdata/keymaps/bn_player.xml` (copied by `service.py:988-996`).

### 4.3 Window(home) properties used as signals

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

## 5. Patching of third-party files

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

## 6. Security and privacy boundaries implemented in the code

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

## 7. Modules

### 7.1 `plugin.video.nova`

| Module | Responsibility | Main entry points |
|---|---|---|
| `default.py` | plugin router and catalogue screens | `router(p)`, `root`, `play`, `hub_search`, `seasons`, `episodes` |
| `service.py` | player callbacks, subtitle flow, background jobs | `main`, `Player`, `Flow`, `align_job`, `_post_wait` |
| `accounts.py` | older logins screen with live tests | `screen`, `action`, `telegram_status` |
| `backup.py` | backup / restore zip | `make_zip`, `extract`, `auto_backup`, `restore_zip` |
| `binfix.py` | binary add-ons for this platform | `ensure` |
| `branding.py` | name and logo in a plain Kodi | `apply` |
| `clip.py` | clipboard access per platform, paste into the keyboard | `system_read`, `paste`, `Store` |
| `clipui.py` | keyboard buttons' actions and watcher | `paste_now`, `history_menu`, `watch` |
| `cloudsync.py` | setup copy in the Telegram account | `push`, `take`, `check_start`, `tick`, `decide`, `engine` |
| `common.py` | strings, JSON storage, TMDb client, shared Monitor | `T`, `load`, `save`, `flag`, `tmdb`, `monitor`, `log` |
| `depov.py` | removal of POV links and favourites | `patch_skin`, `patch_skin33`, `clean_favourites` |
| `epg.py` | free TV guide matching and build | `build`, `match`, `stream_guide` |
| `epmatch.py` | season / episode parsing and exact matching | `parse`, `matches`, `query_for` |
| `gdrive.py` | Google Drive client and merge rules | `Drive`, `merge_favourites`, `merge_history` |
| `gdrive_ui.py` | Google Drive screens and jobs | `menu`, `action`, `auto`, `sync` |
| `hardsub.py` | burned-in subtitle detection, black box | `ask_gemini`, `verdict`, `box_on`, `box_off` |
| `helpcenter.py` | help, troubleshooting, about | `root`, `guide`, `trouble`, `do_search` |
| `ia.py` | Internet Archive API | `search`, `files` |
| `idanpatch.py` | Idan+ YouTube id fix | `apply` |
| `iptv.py` | playlist merge, guide, PVR configuration, TV menus | `merge`, `configure_pvr`, `check_streams`, `guide_from_playlist`, `channel_list` |
| `kodisettings.py` | shortcuts to Kodi's own settings windows | `menu`, `go` |
| `ktuvitauth.py` | Ktuvit login encoding | `encode_password`, `login` |
| `libraries.py` | optional add-ons from the Kodi repository | `menu`, `install` |
| `livebar.py` | live-TV bar window data | `epg`, `channels`, `play` |
| `livefail.py` | Israeli channel table and failover | `CHANNELS`, `live`, `key_for`, `is_restream` |
| `livesubs.py` | live subtitles through the PC server | `menu`, `start`, `off`, `stream_ended` |
| `mtrans.py` | machine translation without AI | `translate`, `hebrew_only`, `translate_cues` |
| `player_menus.py` | player panels | `sync`, `settings`, `audio`, `picker`, `subs_folder`, `_pl` |
| `playerctl.py` | player controls and remembered delays | `rpc`, `set_sub_delay`, `reset_view` |
| `preset.py` | password-locked profile | `create`, `unlock` |
| `profiles.py` | device profiles | `detect`, `auto`, `apply`, `wizard` |
| `providers.py` | provider search, source picker, engine bridge | `run_search`, `fallback_pick`, `telegram_sources`, `read_dir` |
| `radio.py` | radio directory | `menu`, `listing` |
| `searchhist.py` | search history and suggestions | `ask`, `suggest`, `pick`, `record`, `menu` |
| `services.py` | one screen for every service | `screen`, `action`, `services_state`, `facts` |
| `skinpatch.py` | skin patches | see section 5 |
| `speedtest.py` | internet speed test | `run_dialog` |
| `status.py` | system status table | `gather`, `announce`, `listing` |
| `subdetect.py` | track list of the playing video | `tracks`, `hebrew_index`, `is_live`, `play_secs` |
| `subfix.py` | subtitle decoding and repair | `fix_file`, `parse_subtitles`, `to_srt` |
| `subprobe.py` | text of embedded subtitle tracks | `probe`, `decide` |
| `subsmenu.py` | BN subtitles window | `show` |
| `subsnet.py` | PC server discovery | `discover_server` |
| `subspatch.py` | All_Subs guards | `apply`, `apply_plus` |
| `substore.py` | store of created subtitles | `save`, `cleanup`, `video_base` |
| `syncdoc.py` | merge rules for a shared setup document (not wired) | `merge`, `merge_user_data` |
| `syncmath.py` | delay and dual-subtitle calculations | `bookmark_delay`, `steps`, `merge_dual` |
| `sysupdate.py` | system update and report | `run`, `listing`, `rollback` |
| `ticker.py` | news and weather ticker | `run` |
| `topics.py` | curated YouTube sections | `root`, `prewarm`, `hub` |
| `weblink.py` | open a page in the device browser, QR | `open_url`, `show` |
| `yt.py` | YouTube lists without an API key | `search`, `channel_videos` |
| `ytlive.py` | live broadcast of a YouTube channel | `find`, `play_url` |
| `ytport.py` | YouTube add-on local port check | `check`, `ensure_subtitles` |

### 7.2 `plugin.video.telescope`

| Module | Responsibility | Main entry points |
|---|---|---|
| `default.py`, `service.py` (add-on root) | start `router.run` / `service.run` | - |
| `resources/lib/service.py` | service: settings, RPC dispatch, watchdog, export, cloud | `Service.start`, `Service.rpc`, `load_settings`, `_cloud` |
| `router.py` | plugin menus, login screens, source picker, playback | `run`, `MODES`, `play`, `hub`, `account`, `_wait_job` |
| `rpc.py` | plugin-side RPC client, stream URLs | `call`, `stream_url`, `stream_token` |
| `stream.py` | HTTP server, range proxy, chunk cache | `App`, `ChunkStore`, `make_handler`, `parse_range` |
| `tgclient.py` | Telethon wrapper, pacing | `TG.run`, `submit`, `search`, `read_chunk`, `read_head`, `cloud_*`, `_pump` |
| `sources.py` | source-finding pipeline, bots, link test | `Finder.start`, `find`, `find_free`, `probe`, `order_groups` |
| `matcher.py` | accept / maybe / reject and score | `evaluate`, `language_bonus`, `clean_query` |
| `parser.py` | release-name parser | `parse`, `find_se`, `normalize` |
| `mediainfo.py` | MKV / MP4 header reader | `inspect` |
| `meta.py` | TMDb and Cinemeta | `Meta.details`, `Meta.season` |
| `gemini.py` | Gemini REST helper | `Gemini.aliases`, `verify`, `smart_search`, `healthy` |
| `hints.py` | Wikidata names, Wizdom releases, duplicate folding | `wikidata_he`, `wizdom_versions`, `synced`, `merge_same_files` |
| `realdebrid.py` | Real-Debrid login, sources, resolve | `RealDebrid.streams`, `cloud`, `resolve`, `device_start` |
| `stremthru.py` | cached-hash check | `StremThru.health` |
| `opensubs.py` | moviehash identification | `moviehash`, `OpenSubs.check_key` |
| `tgauth.py` | phone login state and error texts | `normalize_phone`, `error_info`, `LoginState` |
| `tgbots.py` | conversations with bots | `ask`, `ask_many`, `inline`, `ref`, `tme` |
| `backends.py` | Telemedia bridge, Stremio servers | `TelemediaBridge`, `StremioServers` |
| `configio.py` | sealed configuration file | `pack`, `unpack` |
| `aesfast.py` | AES-IGE back-ends for MTProto | `patch_telethon`, `bench`, `impl_name` |
| `cache.py` | SQLite TTL cache | `Cache.get`, `set`, `purge_expired` |
| `deps.py` | download of Python dependencies | `ensure`, `installed`, `versions` |
| `common.py` | settings, logging, paths, list-item helpers | `setting`, `log`, `scrub`, `read_json`, `write_json` |

## 8. Fragile points

1. **One `xbmc.Player` and one `xbmc.Monitor` per script.** Objects created per call and freed while Kodi was notifying them crashed Kodi. Use `common.monitor()` (`resources/lib/common.py:152`) and `player_menus._pl()` (`player_menus.py:37`); the same rule is patched into All_Subs (`subspatch.py:23`).
2. **Threads must end on abort.** Kodi waits for every thread of a script. Use `later()` and `waitForAbort`, never `threading.Timer` or a blocking read (`service.py:1095-1101, 618`; engine `service.py:177-182`).
3. **Third-party add-ons update themselves.** The patches of section 5 depend on exact text in files of the skin, All_Subs and Idan+; a changed file means a patch silently does nothing or, for `skinpatch.apply`, raises (`skinpatch.py:44`, handled at `service.py:968-974`).
4. **`plugin.video.youtube`** plays every `yt:` channel and the topic sections (`ytlive.py:65`); its local port can be blocked on Windows (`ytport.py`).
5. **Idan+** supplies the last candidates of most Israeli channels (`livefail.py:17, 148`); its plugin URLs are returned without a liveness check (`livefail.py:160`).
6. **Shared interpreter lock.** All add-ons run in one process; the log records menus taking 3-4 s during playback because All_Subs searches hold the GIL (`HANDOFF.md:241`).
7. **Telegram rate limits.** The pacing constants were measured on one non-Premium account (`tgclient.py:602-621`); repeated reads of the same region in tests trigger flood waits a viewer rarely sees (`HANDOFF.md:102`).
8. **Which connection is the picture** cannot be told for certain; the rules in `stream.py:133-146, 521-544` are heuristics, and classification rests on the `User-Agent` prefix.
9. **`port.json` can be stale.** The server is started first so the file is correct early (`service.py:195-203`); a caller still has to handle `service_down` (`rpc.py:40-44`).
10. **Restores end Kodi with `os._exit(1)`**; `NovaTV.restoring` must be set first so the service does not write over restored files (`backup.py:176`, `service.py:882`).
11. **Kodi answers "no" to `System.HasAddon` for ids with capitals** (`All_Subs`); folder checks are used instead (`HANDOFF.md:66`, `service.py:1036`).
12. **`Addons.ExecuteAddon` does not run `ac_pick` while the same add-on's keyboard is open**; only a real click on the panel item works (`HANDOFF.md:37`).
13. **`qa/qa_all.ps1` deletes the Kodi profile**; `qa/qa_live.ps1` is the variant for a profile with accounts (`HANDOFF.md:108`).
14. **The PC subtitle server is outside the repository** and imports `mtrans.py` from an installed hub copy (`HANDOFF.md:30`); a change to `mtrans.py` has to be copied there by hand.
15. **Version markers in three places**: `addon.xml` files, `qa/Clean-Build.ps1:44`, README; `tools/bump.py` is the only tool that keeps them equal.
