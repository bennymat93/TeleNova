# BN Stream (TeleNova) - Android app

One APK for phones, tablets, Android TV / TV boxes and Android car units: the browser version (`../web`) inside a
native shell. Package `io.github.bennymat93.telenova`, minSdk 24 (Android 7), Java, no build step for the web part.

## Build (one command)

```
powershell -ExecutionPolicy Bypass -File android\build.ps1
```

**Version numbers.** Every release goes up by one inside the series in `android/VERSION` (now `2.6` -> 2.6.1, 2.6.2,
...), the same rule as the iOS app (`ios-app/VERSION`). `build.ps1` counts the published GitHub releases
`apk-<series>.N`, builds `<series>.(N+1)` and writes `versionName` / `versionCode` (`major*10000 + minor*100 + N`) into
`app/build.gradle` - do not edit them by hand; `build.ps1 -DryRun` only prints the next number. After commit + push:
`gh release create apk-X.Y.Z BN-Stream-Android-X.Y.Z.apk --target gh-pages --latest --title "BN Stream Android X.Y.Z"`
(the script prints the exact line). A new series = edit `android/VERSION`. One exact version (to align with Kodi / web, e.g. 6.0.0) =
`build.ps1 -Version 6.0.0`; the next plain build of series 6.0 is then 6.0.1.

It copies `web/` into the app (Gradle task `syncWeb`, see `sync_web.gradle`; `web/tests` and `*.md` are left out),
builds the signed release and writes `apk/TeleNova.apk` + `apk/version.json`. After a web release: run it again.

The Gradle build folder is outside the repository (`%USERPROFILE%\.telenova-build`): folders under the project are
scanned / synced by other programs, which kept files open and failed builds ("Failed to delete some children").

Needs Android Studio (its JDK, `C:\Program Files\Android\Android Studio\jbr`), the Android SDK (platform 36) and the
release key in `%USERPROFILE%\.telenova-keys\` (`telenova-release.jks` + `keystore.properties`). The key is NOT in the
repository and must be backed up: an APK signed with another key cannot be installed over the existing app.

## How it works

| Part | Where |
| --- | --- |
| Shell: WebView, keys, full screen, links, file fields, messages from the page | `app/src/main/java/.../MainActivity.java` |
| The helper Worker built into the app (same rules as `worker/index.js` and `ios-app/Sources/HelperRelay.swift`) | `HelperRelay.java` |
| Files screen (import / export / share / move / rename / delete, also the "choose a file" screen) | `FilesActivity.java`, `Storage.java` |
| Script added to the page at document start (downloads -> app folder, screen-on, "Files" button, `window.TNShell`) | `app/src/main/assets/shell.js` |
| Copy of `web/` + launcher icons, made at build time | `sync_web.gradle` -> `app/build/generated/tn` |

- **Origin.** The page always runs as `https://bennymat93.github.io/TeleNova/web/`. Requests for that folder are answered
  from the APK (`shouldInterceptRequest`, also for the service worker), so the service worker, the Telegram playback
  proxy (`/tgstream/`), IndexedDB and the CSP behave exactly as on the site. `web/data/*` (programme guide) is fetched
  from the site first, the copy in the APK is the offline fallback.
- **The site is the content.** The app loads the live site, so a web release shows after a refresh and needs no new
  APK (the page's own "new version - reload" notice works too; on return to the app the service worker is asked to
  look for an update). The copy inside the APK is the fallback: when the site cannot be loaded (no connection and
  nothing cached, an error, or nothing shown after 15 seconds) the built-in copy is shown on the same origin, so
  logins and data are the same. App menu -> "Refresh" loads the site again; "Content" forces the built-in copy.
  `web/data/*` is fetched from the site even in built-in mode, with the APK copy as the offline answer.
- **Back** = the page's own back (history); at the first page a second press exits. Long press on Back, or the Menu key
  of a remote, opens the app menu (Files, Refresh, Content source, About, Exit); the "Files & refresh" button on the backup / settings pages opens it too, and the launcher icon has Files and Refresh shortcuts. D-pad and media keys go to the page; on TV
  devices the user agent gets `Android TV`, so the page picks its TV layout.
- **Helper built in.** `web/helper.js` sends requests for the hosts without browser CORS (Real-Debrid, StremThru,
  Ktuvit, epgshare01, YouTube innertube) to `<helper address>/p`. In the app that address is
  `https://helper.telenova.invalid` (the same as on iOS; never reaches the network): `shell.js` answers `fetch()` to it
  through `HelperRelay.java`, and writes the address into the page's `helper` setting when the viewer has none. Nothing
  is deployed or typed. Rules = the Worker's: https, allow-listed hosts, listed headers only, a secret header only to
  its hosts, cookies only for Ktuvit, redirects reported not followed, 5 MB request / 41 MB answer / 2 minutes.
- **Telegram sign-in.** `web/tg.js` (5.1.0) calls `dropPending()` / `setFlood()` that it does not define; `shell.js`
  supplies them until the page has its own. While the QR step is on, a "confirm in Telegram on this device" button
  opens the `tg://login` link in the Telegram app.
- **Name.** The app is called "BN Stream" on screen. The package id (`io.github.bennymat93.telenova`) and the download
  name (`apk/TeleNova.apk`) are unchanged, so existing installs update and existing links keep working.
- **Markers and storage.** The page can test `window.TeleNovaAndroid === true`, `window.TeleNovaNative`, or
  `BNStream/<version>` in the user agent. The WebView uses its default persistent storage (localStorage, IndexedDB,
  cookies, service worker): it survives app updates and is removed only with the app or "clear data".
- **One full backup.** A download named `BN_Stream_backup.tncfg` (the page's full backup) replaces the file of that
  name in Backups; every other download gets a free name. `showSaveFilePicker` is hidden from the page: in a WebView
  it is offered but never returns, which left the full-backup button doing nothing.
- **A refused certificate** (most often a wrong device clock, common on TV boxes) is never accepted: the built-in
  copy is shown with a note to check the date and time.
- **BNNative** (page -> app): `fullUpdate()` (reads `apk/version.json`, offers a newer APK, downloads it, checks the
  SHA-256, opens the system installer - `Updater.java`), `clipRead()` / `clipWrite(text)`; `navigator.clipboard.readText`
  / `writeText` are routed to them (a WebView refuses clipboard reads). While the page's own keyboard is open
  (`<html class="osk_on">`, web/osk.js) the focused field gets `inputmode="none"` and the WebView asks for no system
  keyboard, so two keyboards never cover a TV screen.
- **Releases bundle the committed web/**: `build.ps1 -Committed` exports `web/` from the last commit (another session
  may be editing the working tree).
- **Zoom.** Text zoom is fixed at 100% and pinch / control zoom is off: the page has its own display-size control.
- **Full screen** video: system bars hidden, landscape on phones / tablets, screen kept on while a video plays.
- **Files.** A file the page "downloads" (`a[download]` on a `blob:` address: backups, exported settings, playlists,
  small Telegram files) is saved in the app folder (`Android/data/io.github.bennymat93.telenova/files/` - Backups,
  Settings, Subtitles, Playlists, Downloads) and a dialog offers to open the Files screen. A file field of the page
  (`<input type=file>`) asks "app folder / device". Import and export use the system file picker - no storage permission.
- **Links.** `https://bennymat93.github.io/TeleNova/web/#pair=...` and `telenova://...#...` open inside the app, and so does the "move the setup to another device" link
  (`.../web/#setup=...`, or `bnstream://setup/<payload>` from the site's "Open in the BN Stream app"); `t.me`
  links and links shared from other apps open on the Telegram / YouTube page (others: the "paste a link" box, with the
  link on the clipboard). `target=_blank` links open in another app.
- **Permissions:** `INTERNET` and `REQUEST_INSTALL_PACKAGES` (the in-app update). Plain-http addons / direct links
  are allowed (`usesCleartextTraffic`, WebView mixed content always allowed: compatibility mode still blocks `fetch`). The page CSP
  must list `http:` in `connect-src` / `media-src` too.

Limits and what would need a change in `web/`: `WEB_CHANGES_NEEDED.md`.
