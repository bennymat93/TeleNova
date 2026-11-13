# TeleNova 4.0

Kodi 21 build and add-on repository: Hebrew / English / Russian interface, one catalogue for movies and series,
merged IPTV with automatic numbering, radio, AI Hebrew subtitles, and a built-in Telegram engine.

**Install:** Kodi > Settings > File manager > Add source > `https://bennymat93.github.io/TeleNova/` > Add-ons >
Install from zip file > `repository.telenova-4.0.8.zip`, then install **NovaTV Wizard** from the repository.
Guides: [user guide](https://bennymat93.github.io/TeleNova/guide.html) ·
[adding sources](https://bennymat93.github.io/TeleNova/sources_guide.html)

## Windows

Download [`windows/TeleNova-Setup.cmd`](https://bennymat93.github.io/TeleNova/windows/TeleNova-Setup.cmd) and double-click it.
It installs Kodi 21 when it is missing, downloads the build in two parts, joins and checks them against the SHA-256 in
`build.json`, and creates a desktop shortcut. An existing `%APPDATA%\Kodi` folder is renamed to a backup
folder, never deleted. For the Microsoft Store version of Kodi use the wizard inside Kodi instead.

## Web version

[`web/`](https://bennymat93.github.io/TeleNova/web/) runs in any browser: phones, tablets, computers and TV browsers.

- Layouts for small phones, phones on their side, tablets, wide desktop screens and televisions (10-foot view).
- TV remotes and keyboards: the arrows move between items, Enter opens, Back / Escape returns.
- Installable as an app (manifest + service worker); the shell opens without a connection.
- Optional own TMDb key in Settings for the full movie and series catalogue with no server; without it the
  catalogue comes from the Internet Archive. Live TV: iptv-org; radio: radio-browser. The web version has no
  Telegram sources - those need the Kodi build.

## Add-ons in this repository

| Add-on | Version | What it does |
| --- | --- | --- |
| `plugin.video.nova` (TeleNova) | 4.0.8 | The hub: TMDb catalogue, every title opens its list of links, search across every source, IPTV, radio, history, favourites, accounts, subtitles |
| `plugin.video.telescope` (TeleNova Telegram) | 4.0.8 | The Telegram engine: exact movie / episode matching, link testing, range-streaming proxy. Own settings screen |
| `plugin.program.novawizard` (TeleNova Wizard) | 4.0.8 | Installs and updates the build (multi-part download, SHA-256 check) |
| `resource.uisounds.nova` | 1.0.0 | Navigation sounds |
| `repository.telenova` | 4.0.8 | This repository |

The add-on ids are unchanged so that settings, history and favourites survive the update; only the names changed.

## TeleNova 4.0.8 - the new design from the first frame, AI subtitles in Hebrew only

- **Lists no longer open in one design and jump to another.** Every list opened in the skin's first view and was
  switched a moment later by a command the add-on sent after the list was already on the screen
  (`Container.SetViewMode`); that command is gone. The skin picks the view while the list loads
  (`skinpatch.default_views`): the wide-picture view is valid for episodes and single videos only, every other list
  (menus, films, series, seasons) takes the details view. Measured in Kodi by sampling the view every 0.15 s
  (`qa/t_view_live.py`): menus, film lists, series lists, seasons and episodes show one view from the first sample
  on. A view the viewer picks by hand is no longer overridden at the next open.
- **AI / machine subtitles: Hebrew only** (`mtrans.hebrew_only`, used by the add-on and by the PC subtitle
  server). An engine sometimes hands a line back untranslated - Gemini skips one, Google returns the source, the
  last resort kept the original on purpose - and the subtitle jumped between Hebrew and English / Russian. Every
  translated line is now checked: a line that is not Hebrew is translated again on its own (the job's language
  first, then auto-detect), and one that still is not Hebrew is not shown. Gemini's instructions say so too.
  Checked against the real engines: three foreign lines came back in Hebrew. `qa/t_hebrew_only.py`.
  The PC server files (`nova_subs.py`, `live_restream.py`) are not part of this repository; they were patched on the
  owner's PC with dated copies next to them.

## TeleNova 4.0.7 - search history, suggestions while typing, a clearer Telegram account screen

- **Suggestions under the search box** (`searchhist.py`, `skinpatch.keyboard_complete`): the skin's on-screen
  keyboard has a suggestion panel that nothing fed (it waited for an add-on the build does not carry). TeleNova
  feeds it: with nothing typed the latest searches, while typing the earlier searches that contain the text first
  and then titles from the catalogue, the best known first (Hebrew and Latin). A press puts the suggestion into the
  box; the keyboard stays open. Only in SEARCH boxes - a search sets a window property while its keyboard is open -
  so what is typed into a key, address or password box is never looked up and never stored.
  Played live (`qa/t_kb_live.py`): typing "matr" lists The Matrix first, "פאו" lists פאודה; the panel is reached
  with the arrows and a press fills the box.
- **Search history**: every search of the hub and of the Telegram engine is remembered (60, newest first, one
  entry per text). A new "Search history" screen repeats a search with one press, removes one from the context
  menu, or clears all. The history is part of the setup that follows the account.
- **Telegram account screen**: the state on top in one line (connected as ... / not connected / API details
  missing), then the two ways to log in as numbered rows that say what happens in each ("phone number > code from
  the Telegram app > two-step verification", "QR code - fastest, no typing") with the steps in the side text, then
  Real-Debrid, settings and backup, tools - each under its own heading.
- Tests: `qa/t_searchhist.py`, `qa/t_kb_live.py`.

## TeleNova 4.0.6 - Telegram login by phone that can be finished, YouTube live as TV channels

- **Login by phone number, step by step** (`tgauth.py`, engine `send_code` / `resend_code` / `sign_in` /
  `sign_in_password`, `router._phone_login`): number -> the code Telegram sends to the app on another device (or by
  SMS) -> the two-step verification password -> connected. Before, every mistake - a mistyped code, a wrong
  password, a number without its country code - ended the login with a raw error, and the next try asked Telegram
  for a new code; Telegram limits code requests per number, so after a few tries the number was blocked for hours.
  Now a code is asked for once and stays valid: a wrong code or password is typed again, a local number
  (`054...`) is accepted, the screen says where the code went, an empty code field offers "send it another way"
  (SMS / call, when Telegram allows it), the password prompt shows the account's hint, and a block is reported with
  the time to wait and the note that the QR login is not affected. Codes and passwords never reach the log.
  Verified against the build's Telethon (error classes, code delivery types); `qa/t_tgauth.py` runs the whole flow
  against a stand-in Telegram. No real login was run - a test would spend the owner's code requests.
- **A broadcaster's permanent YouTube live broadcast as a TV channel** (`ytlive.py`): the list keeps the channel
  (`yt:UC...`), the video that is live now is looked up when the channel is opened (no API key), and it plays
  through the YouTube add-on. Three official streams added and played in Kodi: Western Wall live cameras, Lev
  HaMedina 91FM studio video, Kol Chai Music clip channel. 36 Israeli channels with licensed sources.
  `docs/RESEARCH-il-channels.md` lists what was checked: the public free lists hold nothing more that is licensed
  (the rest are restreams of pay channels), and the official YouTube channels of news sites and radio stations
  broadcast by day only - they could not be verified at night and are listed there for a daytime check.

## TeleNova 4.0.5 - better lists: Hebrew names, synced subtitles, dead links remembered, faster search

- **A bot that rarely answers no longer holds every search.** A one-series bot that had answered once in six
  requests was still asked for every title and each search waited 11 s for it. A bot with at least four requests
  and one answer in four or fewer now rests for 30 days (it is still asked first for the series it is named after).
  Measured on the real account: an episode search 25.5 s -> 10.3 s, a film 16.9 s -> 4.1 s.
- **Hebrew names from Wikidata** (`hints.py`, keyless): the Hebrew label and spelling variants of the title by its
  IMDb id join TMDb's translations as search names. Asked in the background, kept 30 days.
- **"A Hebrew subtitle in sync exists"** (Wizdom, keyless): the release names that have a Hebrew subtitle for the
  film / episode are compared with every source; the same release, or the same group and source, gets a few points
  and the mark "Wizdom" in the list. A ranking signal only - never a reason to drop a file. A bare "Title.1994" is
  not a release and marks nothing.
- **Real-Debrid links that cannot be played are remembered** (`realdebrid.py`): a file Real-Debrid refuses
  (`infringing_file`) is left out of the lists for 30 days, a torrent that turned out not to be there for 6 hours.
  Network and login failures say nothing about a link and are not remembered. The file keeps hashed names only -
  never a link or the account's key.
- **The length of the very episode.** The link test compared a file with the series' usual episode length; it now
  uses the length of the wanted episode (TMDb season data), and a file far longer than it (several episodes glued
  together, a film under the episode's name) is listed last and marked.
- Tests: `qa/t_hints.py`, a fourth rule test in `qa/agentC/test_botrules.py`, `qa/t_find_live.py` (a real search
  through the running engine).

## TeleNova 4.0.4 - every service on one screen, a setup that follows the Telegram account

- **Services and connections** (`services.py`, hub > Accounts): one row per service with its state - active, off,
  API key missing, login needed, needs setting up, error (with the reason) - and a summary line. One press opens what
  can be done: switch on / off, connect, type the key, open the page that issues the key in the device's own browser
  (`weblink.py`: Windows, Android, macOS, Linux; the address and a QR code are always shown for boxes without a
  browser), test now. The checks run in parallel: the screen opens in about 2 s.
- **Three optional services, all off by default.**
  - *StremThru* (`stremthru.py`): asks a StremThru instance which torrents Real-Debrid really has, file by file, and
    lists those the index did not mark. The Real-Debrid key is sent to that instance - the viewer is told before
    switching it on. API verified against the project's docs and source; not exercised with a real key.
  - *OpenSubtitles ID* (`opensubs.py`): the file fingerprint (first + last 64 KB) of the few best Telegram files
    whose identity rests on the name alone; another film / episode is dropped, a match is marked certain. Needs the
    viewer's free API key. Not exercised with a real key.
  - *Ktuvit, own account* (`ktuvitauth.py`, All_Subs guard v18): the viewer's account instead of the add-on's
    shared one. The site's own password encoding was read from its login script and reimplemented (PBKDF2 + AES-CBC
    + SHA-256, standard library only); the plain password is never stored. Not tested against a real account.
- **The setup follows the Telegram account** (`cloudsync.py`, engine `cloud_*` RPC): settings, keys, service
  logins, IPTV lists, favourites and history as one sealed file (18 KB) in the account's own Saved Messages; one
  file per device. A device uploads after a change (at most every 10 minutes), and offers a newer setup of another
  device at start. A new device: log in to Telegram, answer "yes". The Telegram login itself is never in that file,
  nor anything that belongs to one device (caches, downloaded libraries, device type). Off until switched on.
  Upload, list, download, replace and delete were run against the real account (`qa/t_cloud_live.py`).
- **Export / import with everything** (the Telegram login too) is on the same screen, in the backup menu and in the
  Telegram engine's account screen.
- Tests: `qa/t_services.py` (states, sync decisions, restore, what the synced copy holds, the Ktuvit patch),
  `t_stremthru.py`, `t_opensubs.py`, `t_ktuvitauth.py`, `t_cloud_live.py`.

## TeleNova 4.0.3 - subtitled feeds

- Four more licensed channels: the broadcasters' feeds for the hard of hearing of Kan 11, Keshet 12, Reshet 13 and
  the Knesset channel (33 channels with licensed failover, all played in Kodi).

## TeleNova 4.0.2 - Kodi closes at once, heavy files out of the list, 29 licensed Israeli channels

Every add-on of the repository carries the same number from now on (hub, Telegram engine, wizard, repository).

- **Leaving Kodi after Telegram playback.** Kodi waits for every thread of an add-on; the threads of the local
  streaming server sat in a socket read that Windows does not wake with `shutdown()`. The server now keeps the open
  connections and releases the handles themselves (`socket.close(sock.detach())`), stops the Telegram client with a
  3-second limit and cancels the reads in flight. Measured: Kodi's process ends 14 s after "exit" (before: it never
  ended and had to be killed). `qa/t_exit.py`.
- **Files that cannot play cleanly are not offered.** The account's real rate is measured (4.3-4.5 MB/s without
  Premium). A Telegram file whose data rate is above 80% of it (about 29 Mbit/s) would stall, so it is left out of
  the list - before and after the probe. Two 4K HDR files under the limit were played from Telegram with no stall,
  so 4K as such stays. Other sources: new setting "heaviest file" (`max_mbit`, 40 Mbit/s, 0 = no limit).
- **Bots, tested against the account's real bots** (23 bots, 6 with video). A bot named after a series is asked
  first and in its own words ("עונה 5 פרק 20" - it delivered the file), and is not asked for other titles. A bot that
  gave nothing in two tries rests for 30 days; a bot the viewer marked is always asked. `qa/agentC/test_botrules.py`,
  `qa/t_bots_live.py`.
- **Israeli channels: 14 -> 29 with licensed failover.** What Idan+ carries and really plays is now in the channel
  list whether or not a free playlist brings it: Kalkala 10, Channel 16, Kabbalah 66 and its Russian channel,
  Reshet's comedy / vacation / reality channels, Keshet's Eretz Nehederet / Savri Maranan / comedy / drama / music /
  food channels, 100FM Radius and 89.1FM video. A channel a playlist also carries keeps that stream, between the
  broadcaster's own and Idan+ (`live_extra.json`). All 29 were played in Kodi (`qa/t_live_keys.py`); Big Brother 26,
  Musayof, Ynet Live and the Sport 5 site broadcast did not start and were left out. Paid cable and satellite
  channels have no licensed free source and stay out.

## TeleNova 4.0.1 - Hebrew subtitles: the text decides, not the label

- **What is inside the tracks** (`subprobe.py`): at the start of a film the subtitle tracks of the file itself are
  read (the Matroska track table, then stretches of the file until every text track has shown what it is - 2 to 10 MB
  in practice, 24 MB at most). Each track gets a verdict: Hebrew text, another language, broken encoding, empty,
  picture subtitles (cannot be read), unknown. A track labelled Hebrew that holds English, is empty or is saved in a
  wrong encoding no longer stops the search; Hebrew in a track without any label is found and switched on; a full
  Hebrew track that only carries the "forced" flag (uploaders set it so that players show the track) counts as full.
- **The decision** (`subprobe.decide`, `service.py` `verify_embedded`): Hebrew inside -> that track is switched on,
  nothing is searched or generated. No Hebrew inside -> the search (All_Subs) and the AI generation run as before.
  All_Subs waits for the verdict (`subspatch.py` guard v17, Window property `NovaTV.HebInside`: wait / yes / no).
- **Subtitles burned into the picture** (`hardsub.py`): three frames of the playing film (the lower third) are
  shown to Gemini - is there subtitle text in the picture, in which script; up to three rounds, an answer counts
  only when two frames agree. Burned-in Hebrew -> the subtitles that were added are switched off again. Burned-in
  subtitles in another language -> the Hebrew subtitles are shown on an opaque black box (Kodi's subtitle
  background); the viewer's own style is saved and put back when the film ends, also after a crash. Without a
  Gemini key only the file name is a hint ("HebSub", "ת.מ", "HC", "KORSUB") and nothing is switched on its strength.
- **Engine 4.0.1** (`stream.py`): TeleNova's own short reads are answered at once (the check took 25 s behind the
  player's buffering, 2.6 s now) and never count as the picture.
- **Checked in Kodi on real Telegram files**: a film with a Hebrew track -> "yes" after 2.6 s, track on; an episode
  whose only track is English -> "no", Hebrew subtitle fetched; a "HebSub" release with no tracks -> Hebrew seen in two
  of three frames after about a minute, the fetched subtitle switched off. Not exercised on a real file: the black
  box for foreign burned-in subtitles (unit-tested only), MP4 text tracks (the label still decides there).
- Tests: `src/qa/t_subprobe.py` (16 cases on Matroska files built in the test, plus `live` on real files),
  `src/qa/t_hardsub.py` (22), `src/qa/t_subs_kodi.py` (inside Kodi).
- Research for the next steps: `docs/RESEARCH-device-transfer.md` (set up once, restore on every device - design
  chosen, not implemented), `docs/RESEARCH-sources.md` (finding / checking / verifying links - shortlist and open
  questions), `docs/DESIGN_PRINCIPLES.md` (35 binding design rules for the skin).
## TeleNova 4.0.0 - Telegram playback and search, measured against a real account

Everything below was measured with a logged-in (non-Premium) Telegram account, outside Kodi (`src/qa/tg_bench.py`)
and inside it (`src/qa/tg_play_test.py`: plays a file, jumps three times, counts the time the picture stands still).

**What limits a Telegram stream (findings)**

- A part of a file nobody read lately arrives at about 4.3 MB/s whatever is done: 2.2 MB/s with one request at a
  time, 3.8 with two, 4.2 with four, 4.3-4.5 with eight or twelve, on one connection. More connections add nothing.
- Parts that were read a moment ago arrive at 7-9 MB/s, and that is what Telegram answers with `FLOOD_WAIT`
  (1-3 s without a byte): the account is held to an average rate.
- A request that was cancelled after a seek is still answered by the server; the engine did not count it.
- Kodi keeps several connections of one film open (the picture, the index at the end, and after a jump the old
  position, which it goes on reading slowly). They shared the stream equally.
- On a PC that also runs the AI subtitle server, its ffmpeg opens the same film a few seconds into playback and
  downloads all of it next to the picture.

**Engine (`plugin.video.telescope` 4.0.0)**

- `tgclient.py`: one counter of what is really on the wire (a cancelled request keeps its slot until its answer
  came; one that only waited costs nothing), a queue in which the part a player is blocked on goes first, a
  self-imposed rate (a non-Premium account starts at 4.5 MB/s, a flood wait lowers it, 10 clean seconds raise it),
  a second request when the player's part is not answered in 3 s, four requests side by side instead of eight.
- `stream.py`: after a seek only what was not sent yet is given up - what is on its way is finished and cached;
  an older connection stands back only while a newer one is really pulling data; a reader that is not Kodi's
  player (ffmpeg of the subtitle server) gets what the player leaves over; connections are closed when Kodi
  exits. One log line per connection says what was delivered and how evenly (`served N MB ...`), plus
  `slow answer from Telegram`, `the engine was held up`, `Telegram asked to wait ... paced to ...`.
- Heavy file (3.6 GB, 1080p H.264) in Kodi, same test before / after: picture back after a jump in 4.8-9.9 s /
  1.8-3.9 s; picture standing still in the 15 s after a jump 3.4-7.5 s / 0.0-0.5 s; start 4.3 s / 2.9-3.4 s.

**Search**

- The engine never read the TMDb token the build ships with (`tmdb_token` of TeleNova), so it had no Hebrew or
  Russian names of a title and searched by the English name only. Fixed (`service.py`, `router.py`).
- Telegram's search over all chats returns the newest hits only (measured: a group gave 3 files of a series in the
  global search and 66 from the inside). The chats that showed files of the title, and chats that proved
  themselves in earlier searches (`lib:chats` in the cache), are now searched from the inside (`sources._deep`,
  `tgclient.search_in`).
- More ways of naming an episode are asked for: Hebrew name + `S01E03`, `ע1 פ3`, Latin name + `1x03`.
- The AI no longer holds a search up: names are asked for in the background and waited for 3 s at most, a model
  that does not answer is left alone for ten minutes (`gemini.py`; with a free key `gemini-flash-latest` did not
  answer in 40 s, the Flash-Lite models did in 1-4 s - the light model is now the default).
- A source list made while Telegram was not connected is no longer served after the login (cache key).
- Same four titles before / after (Telegram sources, seconds): 9 in 9.9 s / 14 in 9.6 s; 19 in 19.1 s / 25 in
  8.3 s; 4 in 7.4 s / 25 in 5.4 s; 6 in 7.4 s / 11 in 2.3 s.

**Known and open**

- A 4K remux of tens of GB needs more than the ~36 Mbit/s a non-Premium account gets from Telegram.
- Kodi can still take long to exit right after a Telegram film was played while the AI subtitle server was
  reading it (the server has no way to cancel a job; it keeps downloading the film after playback stopped).
- The first request into a far, never-read region of a very large file sometimes takes 7-15 s on Telegram's side.
- Bots were not exercised against real bots in this round (no bot is written to by the QA tools).
- Guide: new chapter "adding bots, channels and groups to the search" (`guide.html#sources`,
  `TeleNova-sources-guide.pdf`). Research notes on other builds and tools: `src/RESEARCH-kodi-groups.md`.
## Build 3.3.3 - slim notification, home screen on one axis

Skin changes only (`skinpatch.py` in `plugin.video.nova`; applied to the build, and once by the service on boxes
that update from the repository, followed by one skin reload):

- **Notification** (`skinpatch.notification`): Kodi's pop-up is a slim bar in the top right corner - 500 x 100
  instead of 720 x 160 (the visible box is about 76 high), at the top edge instead of 100 below it; both text
  lines have explicit colours.
- **Home screen** (`skinpatch.home_layout`): the menu buttons are centred in the side column (they stood 25 from
  the left and about 80 from the right), the five toolbar icons stand on the same axis at equal distances, the
  update and help icons are drawn at the same visual size as the others, icon and text sit on the vertical middle
  of each menu button.
- Checked on Windows in a 4:3 window (screenshots, arrow-key navigation through the toolbar). Not checked on a
  16:9 screen or during playback, when a sixth toolbar button (full screen) appears.
- QA tools: `src/qa/qa_live.ps1` runs the suites on the profile as it is (`qa_all.ps1` deletes the Kodi profile,
  logins included); `t_rd_live.py` tests Real-Debrid with the logged-in account - 3 titles, 15 sources each,
  9 of 9 links resolved and served video.

## Build 3.3.2 - Paste on the keyboard, configuration transfer, iPhone / iPad

- **Real-Debrid** (engine 3.3.4, `realdebrid.py`): sources = torrents RD already holds (Torrentio index by IMDb
  id; with the key only `[RD+]` cached entries are listed) + the account's own RD cloud (matched by name, the
  episode file picked at play time). Lighter checks than Telegram: index entries for the IMDb id are accepted
  unless the name contradicts the title / episode; no download test while searching; at play the link is
  resolved and a failing one hands over to the next source. Results: **Telegram, then Real-Debrid, then the
  rest**, each group with its own share of the list. Login: RD device code (open-source client id) or a pasted
  token; expired tokens are refreshed. Option to not send the key to the index (then the cache is checked at
  play time through RD itself; a torrent that is not cached is removed from the account again).

- **Paste button** on the build's on-screen keyboard (under voice search): disabled and grey while nothing is
  copied, enabled as soon as text is copied. A press appends the whole copied text; the field is read back and
  restored if it does not hold exactly the expected text - never a partial paste; repeated presses do not hang.
  Kodi itself pastes only on Windows / macOS and only with Ctrl+V; the build reads the device clipboard directly:
  Windows (user32), Android (ClipboardManager through Kodi's own JNI environment), iOS / tvOS (UIPasteboard
  through the Objective-C runtime), macOS (pbpaste), Linux (wl-paste / xclip / xsel).
- **Clipboard history** button: every copied / pasted text, newest first, pin / unpin (pinned stay on top),
  delete, clear (pinned kept). On Android / iOS the system allows reading only when Paste is pressed, so there the
  history records pastes.
- **Telegram configuration export / import** (Account & Status): one `.tncfg` file with every engine setting, the
  Telegram session (no new login on the other device) and the bot choices; optional password (PBKDF2 200k rounds,
  sealed with HMAC-SHA256: a wrong password or a damaged file is refused and nothing is changed).
- **No more offer to install the dedicated BN Stream app** on Android.
- **iOS**: the download page now serves **Kodi 21.3** (official package, repacked as .ipa, content unchanged) -
  the build is tuned for Kodi 21 and several of its settings do not exist in 20.5. Kodi 21.3 for iOS carries
  pvr.iptvsimple and inputstream.adaptive itself (the build's Windows copies are removed on first start) and has
  `ctypes` built in; its OpenSSL lacks the IGE function, so the Telegram engine now uses Apple's CommonCrypto
  (estimated several MB/s; was 0.1). On macOS the engine never loads `/usr/lib/libcrypto.dylib` (Apple aborts any
  process that does).
- Not verified on a physical iPhone / Mac / Android phone: the Apple and Android clipboard paths and CommonCrypto
  were written against the system APIs and checked for symbol availability, not run.

## Telegram engine 3.3.3 (build 3.3.2) - bots, discovery, every link tested, new result rows

**Bots**
- A bot chat is a chat like any other now: it is listed in "My channels & groups" (tagged `bot`), its files can be
  browsed and searched, and the chats of the content bots are searched by name in every search.
- **Bots that send files only on request** are asked for the title while the searches run (`tgbots.py`): the engine
  writes the title (after `/start` when the bot was never opened), reads the answers - including answers the bot
  edits in place (result pages) - takes the video files, presses only the buttons whose text fits the wanted
  film / episode, follows `t.me/<bot>?start=<code>` links to file-store bots and `t.me/<channel>/<id>` links, and
  stops when the bot goes quiet. Inline bots are queried as well; their files play without being sent anywhere.
- Which bots are asked: bots written in the settings, bots switched on in the new **My bots** screen, and - when
  "also ask bots that already sent me videos" is on - bots whose chat already holds a video. No other bot is ever
  written to; Telegram's own service bots are excluded by name. An automatic bot that answered four requests with
  nothing rests for a day; bots that deliver are asked first.
- A bot that demands joining a channel first is reported, not obeyed: the user is asked once ("join and ask
  again?"). Joining without asking is a setting, off by default.
- New settings category **Bots**: on/off, automatic bots, list of bots, bots per search (3), wait per bot (14 s),
  auto-join.

**Discovery**
- "Discover" is a menu: text search, Telegram's **similar channels** for the channels the account already has
  (`channels.GetChannelRecommendations`), and ready topic searches (movie bots, Hebrew, Russian, English, kids).
- A search runs several wordings at once and returns channels, groups **and bots**, ranked (found by more
  wordings, then audience), with "joined" marked; scam / fake / restricted chats are never listed.
- A public channel opens **without joining**; "include in every search (without joining)" adds its @name to the
  pinned chats, which now accept @names and t.me links next to numeric ids.

**Every link tested, the file itself checked**
- The link test covers every source that is listed (it was the first six), all at once - one 128 KiB request per
  link through the client's pacing gate. In the simulated run 15 links are tested in under 6 seconds.
- A dead link whose file also sits in another chat is replaced by that copy and tested again; otherwise removed.
- `mediainfo.py` reads the Matroska / MP4 header from the bytes the test downloads anyway: real duration, picture
  size, video codec, audio and subtitle languages. A "movie" that really runs 4 minutes is removed; Hebrew
  subtitles / audio found **inside** the file are marked with a tick; a missing quality is filled from the real
  picture size; an episode whose inner title names another episode is moved down and marked.
- "Search Telegram files directly" runs as a job with progress: videos only, one row per file, best fit first,
  bots asked, links tested.

**Result rows**
- Source list: line 1 - quality (colour by quality), codec, languages, size, length, test result with the
  measured speed, match percentage; line 2 - where it comes from (bot / channel / group and its name) and the file
  name. The heading says how many links were tested, how many work and how many were removed.
- File lists (chat browsing, free search): clean title with year or SxxEyy, quality tag, size, length, source.

Verified with 23 new unit tests against a scripted fake Telegram (`src/qa/agentC/test_bots.py`: button lists,
file-store deep links, join walls, edited result pages, silent bots, mirrors, samples) plus the 26 existing ones.
Not verified against the real Telegram service: no account is connected on the test machine.

## TeleNova 3.3.1 - defaults tuned against Kodi 21's own source

Every id, value and default below was checked in the Omega branch of Kodi (`system/settings/settings.xml`,
`AdvancedSettings.cpp`, `FileCache.cpp`), not taken from tuning guides - most of those still describe the
`<cache>` section of advancedsettings.xml, which Kodi 21 no longer reads.

- **Adaptive read-ahead** (`filecache.readfactor` 0): 4x while the buffer is empty after a start or a seek, down to
  1.5x when it is full. The cache size still follows the device profile (32-256 MB, at most 64 MB for a 32-bit box).
- **A crash on Android removed.** Kodi announces itself on the local network (`services.zeroconf`, on by default on
  Android); with the network down at that moment the whole app aborted (seen on an Android 15 emulator: SIGABRT in
  `NsdServiceInfo.setHost`). It is off now, together with the search for Windows shares (`services.wsdiscovery`).
  The shipped settings file marked both as "default", so each platform used its own default.
- **Shorter TV guide**: no past day, 2 days ahead (1 on 32-bit boxes, phones and cars) - the guide database and
  every import shrink with it; no pop-up at every guide import; the aerial signal meter is off.
- **32-bit streaming boxes**: menus drawn at 720p (`videoscreen.limitgui`, far less texture memory), menu sounds off
  (they reopened the audio device at every key press), adaptive streams capped at 1080p with a smaller buffer.
- **Cars**: adaptive streams capped at 720p, menu sounds off.
- Audio output mode back to Kodi's default ("optimized"), adaptive streams start at the measured speed instead of
  a fixed 1.5 Mbit/s, the web interface asks for a password when somebody switches it on, no pop-up for every
  add-on update, the build no longer carries the display resolution of the machine it was made on.
- `curlclienttimeout` 15 -> 20 s: Kodi's default is 30 s (not 10, as the old comment said); 15 s cut slow links off.
- A box that updates from the repository gets the new values once: its device profile is applied again.
- All_Subs guard v14 (no subtitle search on a live stream opened by its address) is withdrawn (v16): TV channels
  are already skipped by guard v11, and it was one question less to a player in the middle of a channel change.
- **Known Kodi limit, not fixed:** a play / stop command that arrives while Kodi shows its "busy" dialog for a
  channel that is still opening can freeze Kodi (about one run in three of the zapping test when commands are
  fired into the dialog; 0 of 5 when the test waits for the dialog like a viewer has to). The original 3.2.0
  build freezes the same way. The on-screen menus and a remote cannot send a command at that moment; remote-control
  apps that talk to Kodi directly can.

## Telegram engine 3.3.2 - fast decryption on Android (the real cause of the freezing)

- On Android the engine found no reachable OpenSSL and decrypted block by block in Python: the status line said
  `pycryptodome, 0.1 MB/s` and a video froze every few seconds. The engine now carries its own AES-IGE library
  for Android as well (`resources/bin/android-*/libtnige.so`: ARM 64-bit with the CPU's AES instructions, ARM
  32-bit, x86, x86_64 - built from `src/native/tnige.c` with the NDK).
- Kodi's data folder is on shared storage, where Android refuses to load code from; the library is copied to
  Kodi's private folder (where Kodi puts its own binary add-ons) and loaded from there. Both candidate files for
  the process's pointer size are tried, and a self-test against the Python implementation runs before it is used.
- Checked: all four Android builds give exactly the output of the Windows build that was verified against
  OpenSSL (run on Android 15 / 16 emulators); inside Kodi 21.3 for Android the status line changed from
  `pycryptodome, 0.1 MB/s` to `tnige-armv8, 5.0 MB/s` on an emulator that translates ARM code (a real ARM device
  is much faster). Not yet run on a physical device.
- When the library cannot be loaded, the reason is written next to the speed in the log and in
  Telegram > Account & status > Connection status.

## Telegram engine 3.3.1 - playback that froze every few seconds

- The player often keeps two connections to one file (the picture, and the index at the end of the file). Since
  3.3.0 every new request cancelled the read-ahead of the other connection: data already being downloaded was
  thrown away and asked for again. Read-ahead is now cancelled only when no open connection needs it.
- Telegram answers too many file requests at once with a flood wait. Each request used to sleep by itself while
  the others kept asking, which kept the limit alive. One shared gate now holds every request for the time
  Telegram asks, the number of requests sent side by side is halved (never below 2) and grows back slowly.
- Every stall longer than 4 s and every flood wait is written to Kodi's log with its reason
  (`slow chunk ...`, `Telegram asked to wait ...`), without switching debug logging on.
- Not verified against a real Telegram account (unit tests with a simulated client only).

## 3.3.0 - fast Telegram decryption on Windows, cleaner build

- **Telegram engine on Windows:** Kodi for Windows has no reachable OpenSSL, so chunks were decrypted block by block
  in Python at about 0.2 MB/s. The engine now carries its own small AES-IGE library (`resources/bin/win-*/tnige.dll`,
  AES-NI when the CPU has it, checked against OpenSSL): about 350 MB/s inside Kodi.
- **Removed from the build (about 24 MB unpacked):** the modified copy of Estuary (Kodi's own stays as the fallback
  skin), Python modules nothing uses (beautifulsoup4, soupsieve, dateutil, future, html5lib, kodi-six, routing, six,
  webencodings), music-library scrapers, and the old POV wizard's icons, screenshots and files.
- **Favourites:** the entries that opened removed add-ons (anime, POV wizard, quick update, speed test, favourites
  order) are gone; boxes that update from the repository get the same clean-up once.
- **Embedded Hebrew subtitles are recognised properly.** A Hebrew track is found by its language code *or* by its
  name ("Hebrew" / "עברית" on a track marked `und` - common in Telegram uploads), and the track list is read until it
  stops changing (up to 8 s) instead of giving up 1.5 s into the video. With a full Hebrew track the subtitle add-on
  (All_Subs, guard v13) does not search at all; without one it searches as before. A *forced* Hebrew track (foreign
  lines only) does not count as subtitles of the whole video.
- A live stream opened by its address (not through the TV service) is not searched for subtitles (All_Subs guard
  v14, same rule in TeleNova), and All_Subs no longer fills the log with `EXCEPTION: Kodi is not playing` lines
  after a video is closed quickly (guard v15).
- **Backups:** restoring a backup or a locked profile made on an older build skips the settings of add-ons the build
  no longer has and drops favourites that open them. New backups no longer include All Subs Plus and Magneto.
  `src/tools/nvp_clean.py` removes the same from the two shipped encrypted profiles (asks for their password).
- No more `Unknown addon id` errors (`plugin.video.pov`, `plugin.video.telemedia`) in the log.
- **Wizard 3.3.0 - it works again.** The wizard asked for `xbmc.python` 3.1.0; Kodi 21 has 3.0.1, so Kodi kept it
  disabled and it could not be installed from the repository. Fixed, and TeleNova repairs and switches on a wizard
  that is already installed. "Update" no longer replaces the viewer's own Kodi favourites / sources / passwords;
  "Fresh install (wipe everything)" now really removes the old settings folders (it left all of them, accounts
  included).
- **Skin buttons that did nothing:** "replace source" in the player and Play / seasons / episodes in the information
  window open the same title in TeleNova; "search by year" opens the year list; items with no TeleNova counterpart
  (collections, people, Trakt lists, the POV wizard's skin switch) are hidden.
- **Device profiles, chosen by themselves.** At the first start the build recognises the device and applies its
  profile: Windows computer, streaming box 64-bit, streaming box 32-bit (small cache for the weak boxes), Android
  phone / tablet, Android car screen, iPhone / iPad, Mac. Each profile needs two independent signs that agree, the
  device is read three times and all readings must match - only then is it applied without a question; otherwise
  the viewer is asked with the best guess first. Change it any time in TeleNova > Device type.
- **Safer data:** favourites / history are never overwritten after a failed read (retry + `.bak` copy), caches and
  the channel list are written atomically, a restore accepts only settings files, new backups carry no Google
  Drive sign-in, unlocking a profile no longer needs 150-200 MB of memory.
- **Telegram engine:** reconnects by itself after an outage, answers at once after Kodi starts, no duplicate chunk
  downloads, a seek drops the old read-ahead, results are no longer cut to the 6 tested links, link speed is
  measured correctly, the stream address carries a signed token (other programs on the device cannot read it), API
  keys never reach the log, better file-name rules (trailers, Russian season / episode words, COMPLETE, Heb.Dub).
- **Defaults:** the remote-control port no longer listens on the whole network, Hebrew subtitle files in
  Windows-1255 display correctly, "play next" only for series, original audio language, a "trending this week" row
  first on Movies and Series, POV / DarkSubs names replaced, the skin's widget database rebuilt for TeleNova.
- **Quieter and lighter:** no error box for a stale link, no status collection at start in light mode, slower
  polling loops, a channel that failed is tested again and comes back, empty lists say so.
- `guide.html` rewritten for 3.3 with screenshots, the device profiles and "the most content from Telegram".
- **Faster:** a season's episode list with missing Hebrew descriptions opens in about 4 s instead of 10-15 (the
  translations run side by side); radio lists are answered from a 6-hour cache and retried once when every mirror
  refuses right after start; the Telegram engine's menus open about a second sooner.
- The build package is one file again: `build/TeleNova-3.3.0.zip.part0` (99 MB, was 111 MB).

## 3.2.0 - light build for average and weaker TV boxes

- Removed (and switched off on boxes that update): All Subs Plus (a second automatic subtitle search at every
  start of a video), its plugin cache service, Unpause Jumpback, keyboard autocompletion.
- Light mode (TeleNova setting, on by default): no news ticker, no topic pre-loading, no periodic stream checks,
  no status table at start; backups, Drive sync, IPTV and guide refresh wait until nothing is playing.
- A video is never paused at its start for subtitles unless the setting is turned on again.
- Memory: Kodi video cache is an eighth of the memory (64 MB on a 2 GB box, was 128), the Telegram engine keeps
  48 MB of chunks (was 128).
- Telegram engine: looks for OpenSSL inside Kodi's own library on Android; measures the decryption speed and shows
  it on its status page, with a notice when the device is too slow for heavy files.

## 3.1.1 - subtitles at the start of a video

- A video with its own Hebrew subtitle track: the track is chosen about a second after the start and **nothing is
  searched** (TeleNova, and All_Subs through guard v12).
- Without one, the video is no longer paused while subtitles are looked for. It was paused for up to 25 seconds
  and then waited for an AI subtitle server that a TV box usually cannot reach; now the server gets one 1.5-second
  check, and only when it answers (and the setting asks for it) is the start held.
- Streams of the Telegram engine are local to the box, so the AI server on another machine is not asked for them.
- Player calls made while a video closes can no longer raise inside the subtitle check.

## 3.1.0

- **TeleNova** is the new name of NovaTV. The Telegram engine stays a separate add-on with its own settings, and
  TeleNova uses it everywhere: search all sources, Movies > Search, Series > Search, and every movie / episode.
- **Links like Telemedia:** choosing a title opens one list - Telegram links first (matched by TMDb id, exact
  season and episode, tested), then the other sources. When nothing passes the strict rules the close matches are
  listed, marked `?`.
- **POV removed.** The build no longer contains POV, its repository, or the add-ons that gave no content
  (version check, speed tester, Archive.org add-on, Vimeo, Dailymotion, Red Bull TV, Formula 1, Motorsport Hub,
  Documentary Heaven, Films For Action, ESA, FOSDEM, media.ccc.de, TekThing). The skin's POV links (search, home
  rows, season and episode buttons) point at TeleNova; POV favourites were removed. A box that updates from the
  repository gets the same change once, with a backup copy of every file it touches (`*.pre-telenova`).
- **Faster search:** one Telegram request per query instead of two, a Telegram rate limit fails that one query
  instead of freezing the search, 12-second limit, slow stragglers are not waited for, AI and the channel list
  never hold a search up, link test reads 128 KB. The link list opens as soon as Telegram answered; other sources
  get a few seconds at most.
- **Stability:** a slow box can no longer turn real matches into "nothing found"; an unexpected answer of the
  radio directory no longer breaks the search page; first-run setup of the Telegram engine installs `pyaes` from
  its source archive and retries downloads; the engine installs PyCryptodome for faster decryption.
- **Build:** `build/TeleNova-3.3.0.zip.part0` (one or more parts, each under GitHub's 100 MB limit), joined and checked by
  the wizard and by the Windows installer.

## Notes

- `build.json` lists the parts of the build package and its SHA-256. No APK files are kept in this repository.
- TeleScope AI keeps its own settings screen (login, Chiko Media, Gemini); NovaTV only links to it.
- Content availability depends on the services and Telegram chats each user has access to.
