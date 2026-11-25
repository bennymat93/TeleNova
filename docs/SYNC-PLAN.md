# KODI
## How sync works on Kodi today (TeleNova 6.1.7, read-only research, nothing edited)

Base path: C:\My Projects\novaTV Addon\src\plugin.video.nova\resources\lib (called lib/ below).

**The main channel is a sync document in Telegram "Saved Messages".** It is built by lib/autosync.py and merged by lib/syncdoc.py. A browser version of the same loop already exists in C:\My Projects\novaTV Addon\web\websync.js and web\syncdoc.js, so the iOS, Android and Mac apps already use this channel through the web app.

### 1. What exists on Kodi and where it is stored

**Hub add-on (plugin.video.nova)**
- Its settings.xml has 40 ids:
  - tmdb_token, tmdb_key, content_lang, open_on_start, help_lang, ui_sounds, lite, ticker, ticker_city
  - ai_subs, auto_align, status_on_start, ai_prepare, ai_wait, sub_server, sub_server_remote
  - subs_folder, subs_cleanup, subs_keep_last, subs_pref_source, opensubs_key, gemini_key
  - resume_same, sync_step, tg_first, free_epg, epg_lang, iptv_refresh_h
  - gd_auto, gd_keep, gd_client_id, gd_client_secret
  - device-only: device_profile, lite_done, depov_done, wizard_fix, tune_done, bn_player_ver, brand_ver, brand_offer
- JSON files in addon_data/plugin.video.nova:
  - iptv.json (M3U and EPG sources), providers.json (which sources are on or off), services.json (on/off flags, including sync_on), profiles.json
  - Per user (lib/users.py): history.json (resume points sit inside the entries as 'progress' {t, d}), favourites.json, favourites_removed.json, search_history.json, user_marks.json
  - users.json: the household's list of users
  - Device-only: sync_state.json (which user is active), sync_meta.json, gdrive_token.json, gdrive_state.json, iptv_status.json, preset.nvp, preset_guard.json
- users/<id>/: the files of the users who are not active.

**Telegram engine add-on (plugin.video.telescope)**
- Its settings.xml has 62 ids:
  - Telegram: api_id, api_hash, phone, pinned_chats, use_telemedia
  - Keys and accounts: tmdb_key, gemini_key, gemini_model; Real-Debrid rd_enabled, rd_token, rd_torrentio_on, rd_torrentio_key, rd_cloud, rd_max, rd_refresh, rd_client_id, rd_client_secret
  - Stremio and subtitles: stremio_servers; st_enabled, st_url (StremThru); os_enabled, os_key (OpenSubtitles)
  - Bots: bot_request, bot_auto, bots, bot_max, bot_timeout, bot_autojoin, tg_quiet
  - Search and AI: meta_language, adult, ai_aliases, ai_verify, ai_verify_all, chiko, chiko_keywords, chiko_boost, strict, lang_pref, min_quality, hide_cam, max_results, autoplay, src_hidden, search_limit, search_timeout, max_aliases, max_queries
  - Link checks and playback: probe, probe_all, probe_count, probe_timeout, hide_slow, max_mbit, keep_unprobed, parallel, readahead, cache_mb
  - Device-only: port, debug, deps_zip, wizard_shown
- The Telegram session file sits in addon_data/plugin.video.telescope. port.json there holds the local service's port and secret.

**Other add-ons**
- service.subtitles.All_Subs settings: these are synced.
- pvr.iptvsimple, plugin.video.youtube and skin.fentastic data, plus Kodi's favourites.xml, sources.xml, passwords.xml and mediasources.xml: these travel only in backup or restore files (lib/backup.py).

**Accounts screen (lib/accounts.py)**
- Rows: Telegram, Real-Debrid, Trakt, TMDb, Gemini, Google Drive, IPTV, subtitle server.
- These are the setting keys listed above. Trakt and some others are read through `_pov(setting)`, which comes from an external add-on.

**Not synced by design**
- Device profile (lib/profiles.py): pc, tv64, tv32, phone, tablet, car, ios, mac.
- lib/kodisettings.py only opens Kodi windows. It stores nothing.

### 2. What is synced today, and how

**A) Continuous sync (autosync.py and syncdoc.py, since 4.1.0). This is the main one.**

- **Where it is kept:** one file in the Telegram account's own "Saved Messages".
  - The caption starts with `#TeleNovaSetup` followed by note JSON `{device:'sync-v2', name:'TeleNova sync', build, fp, v:1}`.
  - The file name is `TeleNova-setup-sync-v2.tnsync`.
  - The engine's RPC calls cloud_list, cloud_put and cloud_get do the work (plugin.video.telescope\resources\lib\service.py around line 394, and tgclient.py lines 140-180). A put deletes older files that have the same note.device.
- **How often:** the hub service runs a round every 90 s (PERIOD). It also runs at once when the user is switched or created, from the menu's "Sync now", and when `bn.sync.now` is set. It is on by default (services.json `sync_on`).
- **"Changed" check:** a document counts as changed when its mark `"<msgid>:<date>"` differs. The file is fetched only then.
- **What travels:**
  - users, and for each user: history (with resume points), favourites, removal tombstones, searches, marks
  - every setting of plugin.video.nova, plugin.video.telescope and service.subtitles.All_Subs, except those matching LOCAL (regex below)
  - the whole files iptv.json, providers.json, services.json, profiles.json
- **Never synced:** the Telegram session, and settings that match LOCAL:
  `^(debug|port|device_profile|deps_zip|wizard_shown|sub_server|lite_done|depov_done|wizard_fix|tune_done|\w+_done|last_\w+|\w+_ts|\w+_time|kodion\..*|.*\.port)$`
- **So keys and logins already travel this way:** api_id/api_hash, rd_token and rd_client_secret, tmdb, gemini and opensubs keys, gd_client_id/secret, and the M3U URLs in iptv.json.
- **Conflict rules (syncdoc.py):**

| Item | Rule |
|---|---|
| Users | Union by id. The later rename wins, with ties broken by name. A deletion is a tombstone (`deleted` time), and a deleted user's data is dropped. |
| History | Union by `key`. The later `ts` wins. Entries older than a "clear history" are removed. Capped at 500. Resume points come in through with_progress() and go out through progress_points(). |
| Favourites | Union by (kind, id). An item removed later than it was added stays removed (tombstones list `removed`, capped at 1000). |
| Searches | Union by `q`. The later `ts` wins. Cleared or removed searches stay gone. Capped at 60. Marks are merged by merge_marks. |
| Settings and files | Each key is stored as `[value, time]` and the later time wins. On a tie, the larger canonical JSON wins. |

  - stamp_changes() sets time 0 for a value this device never changed, so a fresh device never pushes its defaults over the account's values.
  - The device that founds the document stamps everything with the founding time, so its setup becomes the account's setup.
  - Settings are written back through Kodi (set_setting), so they take effect without a restart.
  - The merge is commutative and idempotent.
- **Encryption:** the engine's configio.pack seals the file.
  - The password is `'telenova-setup-v1:<telegram user id>'`.
  - Keys come from PBKDF2-HMAC-SHA256 with 200,000 rounds. The cipher is an HMAC-SHA256 counter-mode keystream XOR, and an HMAC-SHA256 seal covers it.
  - This only obscures the content. The key comes from the account id, so anyone who can read the account can open the file.
- **The web client (websync.js):** it uses the same document, merge and mark.
  - It owns users and their lists only. Settings and files pass through untouched.
  - It reads only tmdb_key, tmdb_token and content_lang.
  - It never founds the document.
  - **This is the main gap for "full sync":** the web, iOS, Android and Mac apps do not apply or stamp the Real-Debrid, IPTV, Gemini, OpenSubtitles or other settings.

**B) Google Drive (gdrive.py and gdrive_ui.py). An older, separate channel.**
- Scope is drive.file, in the folder "BN Stream/{Backups,Sync,Subtitles}".
- Sync merges favourites.json, history.json and favourites_removed.json. iptv.json and providers.json are copied as whole files: the newer copy wins, judged by local mtime against the remote modifiedTime, tracked in gdrive_state.json.
- It runs weekly (`gd_auto`, auto(every_days=7)), as part of the Drive backup, or on demand.
- Only the active user is covered and settings are not. The files are not encrypted.

**C) One-off transfer between devices on the same network (pairing.py and pairflow.py, version 4.2).**
- Handshake: Diffie-Hellman over RFC 3526 group 14, a commitment, then HKDF to derive keys and a 6-digit code compared on both screens. The UDP beacon is on port 47861.
- Frames are encrypted with a SHAKE-256 keystream and an HMAC-SHA256 tag.
- It sends export_bundle(), which is every syncable setting and file, without the session.
- Each device gets its own Telegram login: the configured device approves the new device's QR token (accept_token), with a 2FA password prompt if needed.

**D) Connecting the web version (webpair.py).**
- A QR code or a message to Saved Messages carries `https://bennymat93.github.io/TeleNova/web/#pair=<api_id>.<api_hash>`.
- Only the api_id and api_hash go across. The session is never shared.

**E) Files you make or open by hand (not live sync)**
- backup.py zip, not encrypted. It holds addon_data for nova, telescope, pvr.iptvsimple, All_Subs, youtube and fentastic, plus favourites.xml, sources.xml, passwords.xml and mediasources.xml.
  - "Export everything, including the Telegram login" puts the session in the file. This conflicts with the never-copy-the-session rule.
  - "Full" also includes the build's add-ons.
  - An automatic local backup keeps 3 copies and runs every 7 days.
- preset.py `.nvp` file (MAGIC NVP1), locked with the owner's password: PBKDF2 with 200,000 rounds, an HMAC keystream and a tag.
- configio `.tncfg` export of the engine: format 1, MAGIC `TNCFG1\n`. It contains the session (`has_session`) and can be password-protected.

### 3. Sync document format and version
- The outer file is the configio TNCFG1 header plus the sealed payload. Inside: `{settings:{}, files:{'setup.zip': b64}, extra:{note}}`.
- setup.zip contains one file, `sync.json`, which is compact UTF-8 JSON.
- syncdoc VERSION = 2 (the engine's own name for the document is 'sync-v2'). Shape:
```
{"v":2,
 "users":[{"id","name","created","renamed","deleted"}],
 "data":{"<uid>":{"history":[{key,ts,when,...,"progress":{"t","d"}}],"favourites":[{kind,id,added,...}],
          "removed":[{kind,id,removed}],"searches":[{q,ts}],"marks":{history_cleared?, searches_cleared?, searches_removed:{q:ts}}}},
 "settings":{"plugin.video.nova":{"key":[value,time]},"plugin.video.telescope":{...},"service.subtitles.All_Subs":{...}},
 "files":{"iptv.json":[obj,time],"providers.json":[...],"services.json":[...],"profiles.json":[...]}}
```
- Times are epoch seconds, with whole numbers kept whole. The `when` and `added` fields use "dd/mm/YYYY HH:MM" or ISO format.
- This device's state is kept in sync_meta.json: cloud_mark, settings and files with their stamps, last_doc, dirty, last.
- Tests that cover this: src/qa/t_syncdoc.py, t_autosync.py, t_users.py, t_pairing.py, web/t_store.js, and web/t_mixed.py (Kodi and browser together).

### What full sync with the apps would need
- Let the web app stamp and apply the telescope, nova and All_Subs settings it can use. The main ones are the Real-Debrid token, Gemini, OpenSubtitles, StremThru, iptv.json and providers.json.
- Decide which settings stay per device and extend LOCAL for the app platforms.
- Possibly drop the Drive channel or fold it into the sync document.
- Keep the Telegram session out of every sync path. Each device logs in through the existing approve-from-another-device flow (pairflow) or the web pair link.

# WEB
WEB-SIDE SYNC MAP, TeleNova 6.1.7. This was read-only: no edits, no git, and no secret values were opened.

== (1) WHAT THE WEB SIDE HOLDS ==
Everything lives in localStorage under the `bn_` prefix: TN.get/put/drop in app.js, and store.js writes with SD.canon.
A. Users and content (store.js)
  - bn_users: [{id,name,created,renamed,deleted}]. Same rules as users.py.
  - bn_user: the active user. Kept per device on purpose.
  - bn_data_<uid>: {history[{key,label,play,thumb,fanart,plot,ts,when}], favourites[{kind,id,label,extra,added}], removed[{kind,id,removed}], searches[{q,ts}], marks{history_cleared,searches_cleared,searches_removed}}
  - bn_art: map of 'kind:id' to poster URL. This browser only.
  - bn_player_resume: {key:{t,d,at}}, the resume points.
  - bn_favs / bn_favs_3x: the old 3.x format, migrated once.
B. Browser settings: bn_cfg, used as TN.settings.get/set (app.js:220, 2050). Keys:
  - Display and device: lang, theme, zoom, device, top, categories, channels, min_seconds
  - Content choices: live, radio, providers_off
  - Keys and URLs: tmdb, helper, helper_token, gemini_key, yt_key, subs_os_key, subs_server_url, gdrive_client
  - Subtitles: subs_auto, subs_lang, subs_size, subs_color, subs_bg
  - Sources: sources_hidden, sources_order, other sources_*
  - Player: player_autonext
  - Telegram: telegram_quiet, tgsearch_bots, tgsearch_bots_auto, tgsearch_bot_autojoin
  - StremThru: stremthru_on, stremthru_url
  - Google Drive: gdrive_auto, gdrive_keep
C. Content and sources outside cfg
  - IPTV: bn_iptv_own (own M3U and Xtream lists), bn_iptv_off, bn_iptv_probe (a cache)
  - EPG: bn_epg_own
  - Radio: bn_radio_own
  - Stremio: bn_sources_addons (the server list)
  - Telegram pins and bots: bn_tg_pins, bn_tg_bots, bn_tg_bots_auto, bn_tg_recent
  - Subtitles: bn_subs_offsets, bn_subs_ktuvit (a login)
  - Device-local: bn_home_rows, bn_player_vol, bn_net_bw/_t, bn_install_seen, bn_tv_offer, bn_aio_done, bn_osk_lang, bn_clip_hist
D. Accounts and connections
  - Real-Debrid: bn_rd_token, bn_rd_auth {cid,sec,refresh}, bn_rd_dead, bn_rd_torrentio
  - Telegram: bn_tg_api {id,hash}, bn_tg_session (only when "keep me connected" is ticked), bn_tg_link (the household approve secret)
  - Google Drive: tn_gd / tn_gd_state / tn_gdrive (gdrive.js, an OAuth token)
  - Sync state: bn_sync_meta, bn_synced
  - sessionStorage: bn_setup, bn_tg_pending, bn_tg_flood

== (2) WHAT IS SYNCED TODAY, AND HOW ==
a) Continuous sync: web/websync.js cycle plus tg.js host (tg.js ~489-541)
  - Runs every 45 s, and 3 s after a local change.
  - Uses the sealed document 'sync-v2' (#TeleNovaSetup) in Telegram Saved Messages, so it needs a Telegram login on that browser.
  - Two-way: only the users and each user's history, favourites, removed, searches and marks. Resume points ride inside history[].progress (app.js:274-299, with_progress / progress_points).
  - Read-only: from settings['plugin.video.nova'] the browser takes only READS = tmdb_key, tmdb_token, content_lang. They are stored in bn_synced and used by tmdbKey()/tmdbLang().
  - The browser never stamps or writes settings or files. They pass through the merge untouched (websync.js header). It also never founds the document (state 'nodoc'), except through the manual "Create the sync document" button (backup.js found()), which creates it with empty settings.
b) One-off transfers, all manual:
  - Backup zip (backup.js makeFiles / readFiles). Kodi-compatible layout: addon_data/plugin.video.nova/users.json, the per-user *.json files, and web/bn_web.json holding cfg. Since 6.1.7 cfg is stripped of secrets by SECRET_RX. Restoring merges.
  - Settings file .tncfg (exportCfg / importCfg, sealed.js, the configio format). It goes through TWINS and carries the full web cfg in extra.web.cfg.
  - Full backup with a password, and the hand-over via QR + 6-digit code (transferOut/In; the helper's /drop box, 15 min, one use). Adds rd_token, rd_auth, tg_api (api_id/hash), tg_link, tg_was_on and the zip of lists. It NEVER carries tg_session.
  - Google Drive weekly backup (gdrive.js): the same zip.
c) Telegram on a new device: its own login. After a restore, tg_link lets an open household device approve the sign-in by itself (tg.js linkServe, tglogin.js:221/295). No session is ever copied, which is correct.

== (3) HOW WEB AND KODI DOCUMENTS INTEROPERATE ==
- The document is {v:2, users, data:{uid:{history,removed,favourites,searches,marks}}, settings:{addon_id:{key:[value,ts]}}, files:{name:[content,ts]}}.
- web/syncdoc.js is a byte-exact port of resources/lib/syncdoc.py: canon sorted / Python repr, PyFloat, code-point compare. merge_stamped is last-write-wins per key.
- Kodi autosync.py syncs ADDONS = plugin.video.nova, plugin.video.telescope and service.subtitles.All_Subs (all non-LOCAL settings), plus FILES = iptv.json, providers.json, services.json, profiles.json.
- List shapes are the same on both sides: the users.py files history.json, favourites.json, favourites_removed.json, search_history.json, user_marks.json.
- Web-to-Kodi setting names (backup.js TWINS, used only in .tncfg, NOT in the live sync):
  - tmdb ↔ tmdb_key (fallback tmdb_token)
  - gemini_key ↔ gemini_key
  - subs_os_key ↔ os_key (fallback opensubs_key)
  - stremthru_url ↔ st_url
  - stremthru_on ↔ st_enabled (b)
  - telegram_quiet ↔ tg_quiet (b)
  - tgsearch_bots ↔ bot_request (b)
  - sources_addons list ↔ stremio_servers (newline-separated)
  - rd_token ↔ rd_token
  - tg_api ↔ api_id / api_hash
  - Live READS: tmdb_key, tmdb_token, content_lang
- The two device-only lists differ. Web LOCAL (websync.js:20) lacks `device_profile`, which Kodi LOCAL has. Harmless today because the web never writes settings.
- Tests:
  - src/qa/web/t_mixed.py: the Kodi loop and the browser loop share one document, must agree byte for byte, and the browser must never touch a setting.
  - t_mixed_browser.js, t_store.js, t_tglink.js
  - src/qa/t_syncdoc.py, t_autosync.py: merge rules and the Kodi loop
  - t_sync_live.py: Kodi with the live account
  - t_pairing.py / t_pair_live.py: Kodi-to-Kodi "send setup"

== (4) GAPS FOR FULL SYNC ==
1. No settings travel web→Kodi or Kodi→web live, beyond the three reads. All of bn_cfg (lang, theme, subtitle choices, sources_*, player_autonext, providers_off, keys gemini/yt/os/stremthru/helper, gdrive_*) syncs only by a manual file or hand-over.
2. Dead reads (likely bugs): these readers look at TN.settings.synced(), but WS.reads() keeps only 3 keys, so they always fall back to defaults:
   - telegram.js:121 (chiko_keywords)
   - tgsearch.js:592 (bots), :740 (content_lang, the only one that works), :747 (pinned_chats)
   - tgsearch.js:873 and catalog.js:617 (gemini_key)
3. The Kodi FILES section (iptv.json, providers.json, services.json, profiles.json) is ignored by the web. Web IPTV/EPG/radio-own (bn_iptv_own, bn_iptv_off, bn_epg_own, bn_radio_own) and Stremio servers (bn_sources_addons) are not in the document at all, so there is no mapping to iptv.json or providers.json yet.
4. These have no web→doc path, and no Kodi twin in the live doc: tg_pins / pinned_chats, tg_bots / bots, tg_bots_auto, tg_recent, subs_offsets, player_resume for users other than the active one, and art.
5. Accounts:
   - rd_token / rd_auth: the token itself is a setting in the doc (plugin.video.nova/telescope rd_token, synced by Kodi), but the web neither reads nor writes it live.
   - tg_api: Kodi's api_id/api_hash are in the settings, but the web does not read them, only via #pair or .tncfg.
   - Not synced anywhere live: gdrive tokens, subs_ktuvit, helper_token.
   - tg_session must stay excluded; the approve-from-another-device flow (tg_link) already covers the Telegram login.
6. A browser-founded document has empty settings, and a browser never stamps changes. To make settings two-way, the web would need stamp_changes against a per-key meta, a TWINS map from web cfg to Kodi ids (extend TWINS to subs_*, content_lang↔lang, player_autonext, sources_*, yt_key, helper and others), and writes into the 'plugin.video.nova' / 'plugin.video.telescope' / 'service.subtitles.All_Subs' sections, or a new 'web' section that Kodi passes through. Then: the founding rule (Kodi stamps settings with the founding time, the web would need the same "first=0" join rule), a web LOCAL list (device, zoom, theme?, home_rows, net_bw, player_vol, osk), and t_mixed.py's "browser never touches a setting" assertion, which must change.
7. Without Telegram there is no live sync on the web at all; the transport is Telegram-only. Google Drive and the helper drop are manual snapshots.

Key files:
- C:\My Projects\novaTV Addon\web\websync.js (READS / LOCAL at lines 20-21, cycle)
- C:\My Projects\novaTV Addon\web\syncdoc.js
- C:\My Projects\novaTV Addon\web\store.js
- C:\My Projects\novaTV Addon\web\backup.js (TWINS line 99, SECRET_RX line 27, exportCfg/importCfg lines 286-335, transferOut/In)
- C:\My Projects\novaTV Addon\web\tg.js (sync host ~489-541, tg_link 167-266)
- C:\My Projects\novaTV Addon\web\app.js (cfg line 220, synced line 300, TN.settings 2050)
- C:\My Projects\novaTV Addon\src\plugin.video.nova\resources\lib\autosync.py (ADDONS/FILES/LOCAL lines 28-31)
- C:\My Projects\novaTV Addon\src\qa\web\t_mixed.py

# DESIGN
FULL SYNC DESIGN: Kodi <-> web/iOS/Android/Mac (TeleNova 6.1.7)
This is research only. No edits were made, no git commands were run and no secrets were read. The design builds on the two maps I was given. I did not re-check line numbers against the code.

PRINCIPLE: keep one channel. That channel is the existing sealed "sync-v2" document in Telegram Saved Messages (autosync.py and websync.js). Bump its format to v3 so it can carry everything that is not device-only. The web/apps become full peers: they stamp and apply settings exactly as Kodi does. The Telegram session never enters the document. Drive is reduced to a backup.

== (a) ITEM TABLE ==
Columns: item | Kodi | web | synced live today | plan

CONTENT
- Users (users.json / bn_users) | Y | Y | Y | keep (union + tombstone)
- Active user (sync_state.json / bn_user) | Y | Y | no | per-device: each screen chooses who watches
- History (history.json / bn_data.history) | Y | Y | Y | keep
- Resume points (history[].progress / bn_player_resume) | Y | Y | Y, active user only on web | sync. The web must also apply progress for users who are not active: write it into bn_data_<uid>.history[].progress, not only bn_player_resume
- Watched marks (user_marks.json / marks) | Y | Y | Y | keep
- Favourites + removed | Y | Y | Y | keep
- Searches | Y | Y | Y | keep
- Poster art cache (bn_art) | n | Y | no | per-device. It is a cache and labels already carry thumb
- Telegram recent (bn_tg_recent) | n | Y | no | per-user list in data[uid].tg_recent, union by id, cap 50

SOURCES
- IPTV M3U/Xtream/EPG (iptv.json / bn_iptv_own + bn_epg_own) | Y | Y | Kodi only | sync through files.iptv.json, with a web adapter mapping to and from bn_iptv_own and bn_epg_own. Xtream user/pass are secrets, but they live inside the sealed doc only
- IPTV on/off (providers.json / bn_iptv_off, providers_off) | Y | Y | Kodi only | sync through files.providers.json plus an adapter
- Radio own (bn_radio_own) | n | Y | no | new file radio.json in files. Kodi passes it through and can later read it
- Stremio servers (stremio_servers / bn_sources_addons) | Y | Y | Kodi only | sync. Twin: list <-> newline string
- StremThru on/url, Torrentio on/key | Y | Y | Kodi only | sync
- Subtitle sources (All_Subs settings, os_enabled, subs_pref_source) | Y | partly | Kodi only | sync. Web keeps only the keys it understands; the rest pass through
- Subtitle offsets (bn_subs_offsets) | n | Y | no | per-device, because they are tied to a release file. It could go in files later
- YouTube key (yt_key; Kodi plugin.video.youtube data) | backup only | Y | no | sync yt_key as web-section key 'web.yt_key'. Do not sync Kodi's youtube add-on API data, which needs its own OAuth per device
- Telegram pins/bots (pinned_chats, bots, bot_* / bn_tg_pins, bn_tg_bots, bn_tg_bots_auto) | Y | Y | Kodi only | sync via twins
- services.json, profiles.json | Y | n | Kodi | keep. Web passes them through, but maps sync_on -> web "sync enabled"

UI PREFS
- content_lang / lang, help_lang | Y | Y | read only | sync content_lang <-> lang. Interface language is per device, by choice; default is sync
- theme, zoom, device, top, home_rows, player_vol, net_bw, osk_lang, install_seen, tv_offer, aio_done, clip_hist | n | Y | no | per-device. They depend on screen and network
- categories, channels, live, radio, min_seconds, player_autonext, subs_auto/lang/size/color/bg | partly | Y | no | sync. Keys with no Kodi twin go in a new "web" section, which Kodi passes through. autonext <-> autoplay (b); subs_lang <-> lang_pref where present
- sources_hidden/order/* | partly (src_hidden) | Y | no | sync; sources_hidden <-> src_hidden
- Kodi search/probe/AI tuning (probe*, parallel, readahead, cache_mb, max_mbit, hide_slow) | Y | n | Y between Kodis | keep Kodi-to-Kodi. Web passes them through. readahead, cache_mb and max_mbit should be device-local (add to LOCAL), because they depend on the box
- device_profile, lite, ticker, ui_sounds | Y | n | partly | device_profile is already LOCAL. Also add lite, ui_sounds and open_on_start to LOCAL, because a phone and a TV differ

ACCOUNTS
- Telegram api_id/api_hash | Y | Y (bn_tg_api) | Kodi only | sync. The web reads telescope.api_id/api_hash into bn_tg_api once logged in. For bootstrap without a login, use #pair or a QR, as in (c)
- Telegram session | Y | Y, opt-in | NEVER | per-device, forever. Hard-exclude by regex on both sides plus a test
- tg_link (household approve secret) | n | Y | no | sync as web.tg_link. Kodi should also honour it so it can approve web logins (see (c))
- Real-Debrid rd_token + rd_client_id/secret/refresh | Y | Y (bn_rd_token, bn_rd_auth) | Kodi only | sync all four. RD tokens are per account, not per device. The refresh token must be shared atomically, as one value, so two devices that refresh do not invalidate each other. Twin: rd_auth {cid,sec,refresh} <-> rd_client_id, rd_client_secret, rd_refresh. Last-writer-wins on the bundle
- rd_dead | n | Y | no | per-device cache
- TMDb tmdb_key/token | Y | Y | read only | sync two-way
- Gemini, OpenSubtitles keys | Y | Y | Kodi only | sync two-way (gemini_key; subs_os_key <-> os_key/opensubs_key)
- Trakt | external POV add-on (_pov) | n | no | out of scope: it is owned by a third-party add-on. Show "per-device" in the UI
- Google Drive client id/secret | Y | Y (gdrive_client) | Kodi only | sync gd_client_id/secret <-> gdrive_client
- Google Drive OAuth tokens (gdrive_token.json / tn_gd) | Y | Y | no | per-device. Each device grants its own drive.file OAuth; refresh tokens are not portable across clients and origins
- Subtitle server URL (sub_server LOCAL, sub_server_remote / subs_server_url) | Y | Y | partly | sync sub_server_remote <-> subs_server_url. sub_server stays local because it is a localhost address
- helper URL / helper_token | n | Y | no | sync helper as web.helper. helper_token stays per-device: it pairs one helper to one origin, so leave it out until a review
- Ktuvit login (bn_subs_ktuvit) | n | Y | no | sync as web.subs_ktuvit (secret, sealed doc only)

== (b) CHANNEL AND SECURITY ==
Today the document is sealed by configio.pack. The password is 'telenova-setup-v1:<tg user id>'. Keys come from PBKDF2-HMAC-SHA256 with 200k rounds, the cipher is an HMAC-SHA256 CTR keystream, and an HMAC seal covers it. sealed.js is the web port of this. Because the key derives from the account id, the seal only obscures the content; real access control is "who can read the Telegram account". That is acceptable, since anyone holding the account can already log in, but carrying RD and Xtream secrets raises the stakes.

Plan:
1. Optional "sync passphrase" (v3). If it is set, the key becomes PBKDF2(passphrase || tg_user_id). It is entered once per device and stored only locally: Kodi in sync_meta.json, web in localStorage bn_sync_pp. It is never put in the doc, a URL or logs. Without it, the doc stays at today's level of protection.
2. Put secrets into a sub-object `secrets` inside the doc. On top of the outer seal, it gets a second envelope with the same primitive, so a future plain debug dump of sync.json cannot leak it.
3. Secrets must never appear in URLs (the #pair link carries only api_id.api_hash, as today; no RD or Xtream values ever), in logs (Kodi: redact with backup SECRET_RX-equivalent in autosync logging; web: console guard), in the backup zip (6.1.7 SECRET_RX already strips them; keep it) or in Drive (it holds only the plain backup without keys).
4. Mark secret keys in one shared list, SECRET_KEYS, duplicated in autosync.py and websync.js. A test checks that the two lists are identical.

== (c) TELEGRAM / BOOTSTRAP ==
- Every device logs in itself. Nothing in any sync path copies a session. Add a hard-coded exclusion on both sides, applied before LOCAL: SESSION_RX matching session|auth_key|tg_session|string_session.
- New device, when a configured device exists:
  1. Kodi -> Kodi: pairflow (LAN DH + 6-digit code + accept_token QR approval). It already exists.
  2. Kodi -> web/app: webpair.py QR or Saved Messages link #pair=<api_id>.<api_hash>. The app then shows a Telegram QR login; the Kodi user approves it, either in the Telegram app or through accept_token from Kodi with a new menu item, "Approve a new device".
  3. web -> web/app: transferOut/In over the helper /drop (QR + 6-digit code, 15 min, one use). It carries tg_api and tg_link, never the session. tg_link lets an open household device auto-approve.
  Once logged in, the device's first sync cycle pulls everything else from the doc. Its join rule is stamp 0 for untouched values, so it never overwrites the account's values.
- Device without Telegram (web, no login): there is no live sync. Offer:
  (i) "Join by code". It reuses transferOut/In: a logged-in device sends a sealed snapshot of the current doc payload (settings, files, users, without the session) through the helper drop, protected by the 6-digit code. The receiver gets a read-mostly snapshot, then a banner: "Log in to Telegram for live sync".
  (ii) Manual .tncfg import.
  Either way, the next cycle merges after login. The doc remains the only live channel. No new server is added.

== (d) NAME MAPPING (one TWINS table, used live and in .tncfg) ==
Move TWINS from backup.js to a new web/twins.js shared by backup.js and websync.js. Format: web cfg/bn key -> [addon, kodi id, codec].
- tmdb -> nova.tmdb_key (+ nova.tmdb_token read fallback). Live writes go to tmdb_key only.
- gemini_key -> telescope.gemini_key (mirror nova.gemini_key)
- subs_os_key -> telescope.os_key (mirror nova.opensubs_key)
- stremthru_on -> telescope.st_enabled (b), stremthru_url -> telescope.st_url
- telegram_quiet -> telescope.tg_quiet (b), tgsearch_bots -> telescope.bot_request (b), tgsearch_bots_auto -> telescope.bot_auto (b), tgsearch_bot_autojoin -> telescope.bot_autojoin (b)
- bn_tg_bots -> telescope.bots (list<->newline), bn_tg_pins -> telescope.pinned_chats (list<->comma/newline, as Kodi parses it)
- bn_sources_addons -> telescope.stremio_servers (newline)
- bn_rd_token -> telescope.rd_token (mirror nova if present). bn_rd_auth.cid/sec/refresh -> rd_client_id/rd_client_secret/rd_refresh. bn_rd_torrentio -> rd_torrentio_on/rd_torrentio_key
- bn_tg_api.id/hash -> telescope.api_id/api_hash
- lang -> nova.content_lang, sources_hidden -> telescope.src_hidden, player_autonext -> telescope.autoplay (b), subs_lang -> telescope.lang_pref (only if the semantics match; otherwise web.subs_lang)
- subs_server_url -> nova.sub_server_remote, gdrive_client -> nova.gd_client_id/gd_client_secret, gdrive_auto/keep -> nova.gd_auto/gd_keep
- bn_iptv_own + bn_epg_own <-> files.iptv.json. The adapter converts both ways and keeps unknown fields from Kodi entries.
- bn_iptv_off + providers_off <-> files.providers.json
- Everything without a twin goes to settings["web"]["<key>"]: categories, channels, live, radio, min_seconds, subs_auto, subs_size, subs_color, subs_bg, sources_order, yt_key, helper, tg_link, subs_ktuvit, radio_own. Kodi passes the "web" section through untouched: autosync must keep unknown addon sections when it re-puts.
Mirrored keys (same value under nova and telescope): web writes both with the same stamp, and reads the newer.

== (e) CONFLICT RULES ==
Keep the syncdoc v2 rules, which already work byte-exactly in both ports:
- per-key [value, time], later wins, tie -> larger canonical JSON
- users, history, favourites and searches use union with tombstones
- the merge is commutative and idempotent
New for v3:
- Web stamp_changes. Add bn_sync_meta.settings = {addon/key: [lastSeenCanon, stamp]}. A value changes locally -> stamp = now. A value never touched -> stamp 0 (the join rule). A browser that founds the doc stamps everything with the founding time, like Kodi. The "Create the sync document" button then founds with real settings, not empty ones.
- Deletions of settings and list items:
  - List items such as IPTV sources, radio, bots and pins get stable ids. The files are merged as keyed lists with `removed` tombstones, not as a whole-file LWW. Introduce merge_keyed(list, key, removed) in syncdoc.py and syncdoc.js for iptv.json, radio.json, stremio servers, bots and pins. This prevents two devices from erasing each other's added sources.
  - Settings: a cleared value is just "" with a newer stamp.
- RD refresh race: the rd_auth bundle is one atomic value under rd_bundle in the secrets section. On a 401, a device first re-pulls the doc before refreshing.
- Version: VERSION=3. A v2 reader must not destroy v3 fields. Ship the "pass through unknown top-level keys and sections" change first, in a release before v3 writes start (two-phase rollout).
- Clock skew: the stamp is max(now, lastDocMaxStamp+1) to avoid a device with a slow clock losing forever.

== (f) UI ==
Kodi: the "Sync" menu, a new lib/sync_ui.py or an extension of the existing menu, shows:
- status (on/off, account, last success time, last error)
- "Sync now" (bn.sync.now)
- category toggles stored in services.json: sync_content, sync_sources, sync_settings, sync_accounts (default on), and sync_ui (UI prefs; default on)
- "Devices": the last device names seen in the doc's new `devices` map {devid: {name, platform, last}}, informational only
- "Approve a new device (Telegram QR)"
- "Send pair link to web/app"
- the sync passphrase setting
Web/apps: a Settings -> "Sync" screen (new web/syncui.js, linked from the settings view) with the same items:
- state (needs Telegram login / nodoc / ok / error), last sync time and "Sync now"
- the same category toggles. They are stored as files.services.json keys, so they are household-wide, with a per-device override
- the devices list
- "Join by code" for devices without Telegram
- "Create sync document"
- passphrase
Toggles that are off mean that category is neither stamped nor applied locally. Values still pass through the doc untouched.

== (g) WORK PACKAGES (disjoint files) ==
WP1 Merge core (do first; the others depend on it):
- src/plugin.video.nova/resources/lib/syncdoc.py and web/syncdoc.js: VERSION 3, pass through unknown keys, merge_keyed with tombstones, `devices` map, `secrets` envelope helpers, monotonic stamp helper
- tests: src/qa/t_syncdoc.py (keyed merge, v2<->v3 round trip, commutativity property), web/t_store.js parity vectors

WP2 Kodi loop:
- lib/autosync.py: SESSION_RX hard exclude; extend LOCAL (lite, ui_sounds, open_on_start, readahead, cache_mb, max_mbit); SECRET_KEYS; keep the "web" section; category toggles; radio.json passthrough; devices entry; passphrase key; log redaction
- lib/gdrive.py: drop the list-sync path and keep the backup only (or gate it behind a "legacy" flag)
- lib/backup.py: the "export with Telegram login" option is removed or put behind a hard warning, because it conflicts with the rule
- new lib/sync_ui.py, plus a menu entry in the existing router (default.py/menu module), and strings.po en/he
- telescope service.py: add an `approve_token` RPC used by sync_ui (accept_token already exists in tgclient.py)
- tests: t_autosync.py (LOCAL, session exclusion, toggles, web section survives a Kodi round trip)

WP3 Web loop:
- new web/twins.js
- web/websync.js: full stamp/apply via twins, meta per key, founding rule, adapters (iptv/providers/radio/sources/pins/bots/rd/tg_api), SESSION_RX, LOCAL extended with device/zoom/theme/home_rows/net_bw/player_vol/osk_lang/install_seen/tv_offer/aio_done/clip_hist/art/rd_dead/subs_offsets/helper_token/tn_gd*. Also replace WS.reads() with the full synced map, which fixes the dead reads in telegram.js:121, tgsearch.js:592/740/747/873 and catalog.js:617 with no change to those files.
- web/backup.js: import TWINS from twins.js; found() uses real stamping
- web/app.js: TN.settings.set marks the item dirty -> 3 s sync; progress apply for users who are not active (store.js with_progress)
- web/tg.js: the host passes the passphrase. linkServe also listens for Kodi-originated approvals.
- new web/syncui.js plus its hook in the settings view; Hebrew/English strings. Join-by-code reuses transferOut/In.
- tests: t_mixed_browser.js, t_tglink.js, new web/t_twins.js (round trip of every twin, codec b/list)

WP4 Cross tests:
- src/qa/web/t_mixed.py: replace "browser never touches a setting" with: a browser edit of gemini/rd/iptv appears on Kodi and the reverse; Kodi device-local keys survive; the session never appears in sync.json (grep for session/auth_key in the decoded doc); a v2 Kodi does not drop the web section
- t_sync_live.py: a live smoke run on the owner's account, run by the owner

WP5 Docs:
- guide.html, README, help center pages (en/he): "Full sync", what is shared vs. per-device, how to add a device (QR/approve), the passphrase, and that Trakt/Drive OAuth/session are per-device
- docs/PROGRESS.md and src/HANDOFF.md open tasks

Rollout:
1. Release N: WP1 passthrough-only + WP2/WP3 readers, still read-only on the web.
2. Release N+1: web writes, v3 keyed files, UI.
Bump all four add-ons together (bump.py) and rebuild the apps, since they bundle web.

== (h) RISKS ==
1. Secrets in Saved Messages are protected only by the account-derived key unless the passphrase is set. Account compromise exposes RD, Xtream and API keys. Mitigation: the passphrase and the secrets envelope.
2. An old Kodi (v2) or an old app bundle re-puts the doc and drops v3/web fields. Mitigation: passthrough release first; refuse to write if doc.v > VERSION (read-only mode + "update" banner).
3. Whole-file LWW on iptv.json loses concurrent additions until merge_keyed lands.
4. RD refresh-token races between devices can force a re-auth.
5. Wrong twin codecs (bool "true" vs true, list separators, pinned_chats format) can corrupt Kodi settings. Mitigation: t_twins.js plus the Python mirror vectors; apply through set_setting with validation.
6. The web and Kodi LOCAL lists drift. Mitigation: one shared JSON spec file (src/qa/sync_spec.json) that both tests check.
7. Applying per-device-sensitive values (readahead, lite) from a PC to a weak TV causes playback trouble. These keys are already in the extended LOCAL.
8. The web without Telegram has no live sync. This needs to be clear in the UI.
9. Doc size grows with lists and secrets. Keep the caps (history 500, removed 1000) and add caps for radio/iptv lists.
10. The Telegram flood limit with a 45 s web cycle across many devices. Keep the mark check (msgid:date) and do not use a shorter period.
11. backup.py "export including Telegram login" still violates the session rule. Remove it in WP2.

Key files:
- C:\My Projects\novaTV Addon\src\plugin.video.nova\resources\lib\autosync.py
- C:\My Projects\novaTV Addon\src\plugin.video.nova\resources\lib\syncdoc.py
- C:\My Projects\novaTV Addon\src\plugin.video.nova\resources\lib\gdrive.py
- C:\My Projects\novaTV Addon\src\plugin.video.nova\resources\lib\backup.py
- C:\My Projects\novaTV Addon\web\websync.js
- C:\My Projects\novaTV Addon\web\syncdoc.js
- C:\My Projects\novaTV Addon\web\backup.js
- C:\My Projects\novaTV Addon\web\app.js
- C:\My Projects\novaTV Addon\web\store.js
- C:\My Projects\novaTV Addon\web\tg.js
- C:\My Projects\novaTV Addon\src\qa\web\t_mixed.py