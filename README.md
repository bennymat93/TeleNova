# TeleNova 3.1

Kodi 21 build and add-on repository: Hebrew / English / Russian interface, one catalogue for movies and series,
merged IPTV with automatic numbering, radio, AI Hebrew subtitles, and a built-in Telegram engine.

**Install:** Kodi > Settings > File manager > Add source > `https://bennymat93.github.io/TeleNova/` > Add-ons >
Install from zip file > `repository.telenova-3.1.0.zip`, then install **NovaTV Wizard** from the repository.
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
| `plugin.video.nova` (TeleNova) | 3.3.0 | The hub: TMDb catalogue, every title opens its list of links, search across every source, IPTV, radio, history, favourites, accounts, subtitles |
| `plugin.video.telescope` (TeleNova Telegram) | 3.3.0 | The Telegram engine: exact movie / episode matching, link testing, range-streaming proxy. Own settings screen |
| `plugin.program.novawizard` (TeleNova Wizard) | 3.1.0 | Installs and updates the build (multi-part download, SHA-256 check) |
| `resource.uisounds.nova` | 1.0.0 | Navigation sounds |
| `repository.telenova` | 3.1.0 | This repository |

The add-on ids are unchanged so that settings, history and favourites survive the update; only the names changed.

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
