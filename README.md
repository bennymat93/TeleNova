# TeleNova V3.0

Kodi 21 build and add-on repository: Hebrew / English / Russian interface, one catalogue for movies and series,
merged IPTV with automatic numbering, radio, AI Hebrew subtitles, and a built-in Telegram engine.

**Install:** Kodi > Settings > File manager > Add source > `https://bennymat93.github.io/TeleNova/` > Add-ons >
Install from zip file > `repository.telenova-3.0.0.zip`, then install **NovaTV Wizard** from the repository.
Guides: [user guide](https://bennymat93.github.io/TeleNova/guide.html) ·
[adding sources](https://bennymat93.github.io/TeleNova/sources_guide.html)

## Windows

Download [`windows/TeleNova-Setup.cmd`](https://bennymat93.github.io/TeleNova/windows/TeleNova-Setup.cmd) and double-click it.
It installs Kodi 21 when it is missing, downloads the build (checked against the SHA-256 in `build.json`), puts
NovaTV 3.0.0 over it and creates a desktop shortcut. An existing `%APPDATA%\Kodi` folder is renamed to a backup
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
| `plugin.video.nova` | 3.0.0 | The hub: TMDb catalogue, search across every source, IPTV, radio, history, favourites, accounts, subtitles |
| `plugin.video.telescope` | 3.0.0 | TeleScope AI, the Telegram engine: exact movie / episode matching, link and speed testing, range-streaming proxy |
| `plugin.program.novawizard` | 3.0.0 | Installs and updates the build |
| `resource.uisounds.nova` | 1.0.0 | Navigation sounds |
| `repository.telenova` | 3.0.0 | This repository |

## 3.0.0 – Telegram is part of the build

- NovaTV installs `plugin.video.telescope` from this repository by itself (builds installed before 1.7.0 included).
- **Search all sources** lists Telegram results next to TMDb, the other add-ons, live channels and radio.
  An episode search lists only the exact season and episode.
- **Playing a movie or an episode**: when POV / Real-Debrid has nothing, the source list starts with Telegram links
  that TeleScope matched by TMDb id and tested (first megabyte downloaded, container checked, speed measured).
  Setting *Telegram first* asks Telegram before POV.
- Long-press on a movie or an episode: **Telegram sources (choose)**.
- Main menu: **Telegram – TeleScope AI** (Chiko Media channels, my channels and groups, login and status).
- Login: an installed and logged-in Telemedia add-on is reused; otherwise phone or QR login with your own
  `api_id` / `api_hash` from my.telegram.org. Only chats your account has joined are searched.
- The TMDb and Gemini keys entered in NovaTV are shared with the Telegram engine.

### Fixes in this release

- TeleScope 3.0.0: first-run setup failed with "No compatible wheel for pyaes" (pyaes publishes only a source
  archive) - it is now installed from the source archive, downloads are retried, and login retries the setup.
- Movies > Search and Series > Search also list the files the Telegram engine finds for the same text.

- Wizard 0.2.1: an *update* no longer deletes add-ons that were installed from the repository after the build was
  made; the partly downloaded build file is removed after a cancelled, failed or corrupt download.
- NovaTV: the "searching all sources" progress bar no longer stays on screen when a source search fails;
  duplicate `IsPlayable` property on movie rows removed.
- Repository: old `plugin.video.nova` packages (1.5.1 – 1.6.3, about 325 MB) removed; only 3.0.0 is kept.

### Hub API of the Telegram engine (for other add-ons)

```
plugin://plugin.video.telescope/?mode=hub&q=<text>
plugin://plugin.video.telescope/?mode=hub&type=movie|tv&tmdb=<id>[&season=..&episode=..][&title=..]
```

Both return a plain folder of playable items and never open a dialog.

## Notes

- `build.json` points the wizard to the base build package (hosted in the `novatv` releases); after it is installed,
  NovaTV 3.0.0 and TeleScope AI 3.0.0 arrive through the add-on repository. No APK files are kept in this repository.
- TeleScope AI keeps its own settings screen (login, Chiko Media, Gemini); NovaTV only links to it.
- Content availability depends on the services and Telegram chats each user has access to.
