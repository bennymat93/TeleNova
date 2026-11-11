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
| `plugin.video.nova` (TeleNova) | 3.1.0 | The hub: TMDb catalogue, every title opens its list of links, search across every source, IPTV, radio, history, favourites, accounts, subtitles |
| `plugin.video.telescope` (TeleNova Telegram) | 3.1.0 | The Telegram engine: exact movie / episode matching, link testing, range-streaming proxy. Own settings screen |
| `plugin.program.novawizard` (TeleNova Wizard) | 3.1.0 | Installs and updates the build (multi-part download, SHA-256 check) |
| `resource.uisounds.nova` | 1.0.0 | Navigation sounds |
| `repository.telenova` | 3.1.0 | This repository |

The add-on ids are unchanged so that settings, history and favourites survive the update; only the names changed.

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
- **Build:** `build/TeleNova-3.1.0.zip.part0` + `.part1` (each under GitHub's 100 MB limit), joined and checked by
  the wizard and by the Windows installer.

## Notes

- `build.json` lists the parts of the build package and its SHA-256. No APK files are kept in this repository.
- TeleScope AI keeps its own settings screen (login, Chiko Media, Gemini); NovaTV only links to it.
- Content availability depends on the services and Telegram chats each user has access to.
