# TeleNova iOS app - handoff (continue from here, any account)

Owner's request (2026-11-18): an iPhone + iPad version of the web app as an UNSIGNED `.ipa` that he signs himself;
feels native, same functions as the browser version, file management (import / export / folders). Answer him in Hebrew.
He also asked that this file is kept current so another account can continue smoothly.

## STATE (update this block first)
- 2026-11-18 18:50 UTC - RELEASED: run 44365469704 green; `ios/TeleNova-Web-5.1.0.ipa` (unsigned, 8.4 MB) is on
  gh-pages and downloads from https://bennymat93.github.io/TeleNova/ios/TeleNova-Web-5.1.0.ipa .
  Simulator self-test passed on iPhone and iPad (service worker controls the page, /tgstream/ answered by the SW,
  exports land in Documents, offline fallback loads); the three screenshots were looked at.
- Then pushed (build 3): pinch zoom off, offline bar no longer covers the page's top bar, status bar hidden on iPad
  (the page's logo was under the clock), `ios/README-app.md` with the "what was verified" section.
- 19:05 UTC build 3 CONFIRMED green (bot commit da9b160, IPA 8,420,212 bytes on the site); self-test passed again on
  iPhone + iPad; offline-bar and iPad screenshots looked at - both fixes show. `gh` on this PC prints and then hangs:
  redirect to a file with `timeout` (`timeout 60 gh api ... > x.json`).
- NEXT (nothing is in progress): 1) wait for the owner to sign and install.
  2) Everything in README "לא נבדק" needs the owner's real iPhone / iPad after he signs the IPA; fix what he reports.
  3) Optional, needs `web/` owner: items in `WEB_CHANGES_NEEDED.md` (Google Drive sign-in is the only missing function).

## Rules for this piece of work
- Edit ONLY `ios-app/`, `.github/workflows/ios-app.yml`, `ios/TeleNova-Web-*.ipa`, `ios/README-app.md`.
  Other sessions own `web/`, `src/`, `docs/`, `android/`, `apk/`; never touch `ios/Kodi-*.part*`.
- A change needed in `web/` is written in `WEB_CHANGES_NEEDED.md`, not made.
- Git: commit only these paths, `git pull --rebase --autostash origin gh-pages`, `git push origin gh-pages`, never force.
- The project `CLAUDE.md` safety rules apply (no secrets, never type the owner's passwords).

## Design (decided, with the reasons)
- One `WKWebView` (`Sources/WebViewController.swift`) that loads the LIVE site
  `https://bennymat93.github.io/TeleNova/web/` as an App-Bound Domain (`WKAppBoundDomains` in Info.plist +
  `limitsNavigationsToAppBoundDomains`). Reason: this is the only way a WKWebView gets a service worker, and the
  page needs its service worker for the offline shell and for Telegram playback (`/tgstream/` proxy in `web/sw.js`).
  A custom URL scheme (`WKURLSchemeHandler`) has no service worker. Bonus: a new web version reaches the app without
  a new IPA (important: a free Apple ID signature lasts 7 days).
- Offline fallback: the copy of `web/` inside the bundle, served by `Sources/LocalServer.swift` on
  `http://127.0.0.1:47615/` (loopback counts as app-bound). Used only when the live site fails to load and the
  service worker has nothing cached. Separate storage (different origin), no service worker => no Telegram playback.
- `Resources/bridge.js` (injected at document start): catches `<a download href="blob:">` exports of the page and
  streams them to the app in base64 pieces -> `Documents/Backups|Subtitles|Playlists|Downloads`. Sets
  `navigator.standalone = true`. Exposes `window.TeleNovaNative`.
- Files: `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` (Documents shows in the Files app); the floating
  "..." button opens: app files (document picker in Documents, picked file -> share sheet), import files (copied to
  `Documents/Imports`), QR pairing scan, paste link, reload. The same three as Home-screen quick actions.
  `<input type=file>` of the page works natively.
- Links: `target=_blank` / `window.open` / other sites -> the system browser (t.me opens Telegram). Incoming:
  `telenova://` scheme, QR scan, clipboard: `#pair=<id>.<hash>` -> page reload with the fragment; `t.me/...` ->
  `#/telegram/link=...`.
- Known limit: Google Drive sign-in (`web/gdrive.js`, pop-up + `window.opener`) cannot work inside the app (Google
  blocks embedded web views; pop-ups go to Safari). Written in `WEB_CHANGES_NEEDED.md`.

## Build
- `build.sh prepare|ipa|sim` (Mac only). XcodeGen writes the project from `project.yml`. Version = `WEB_VERSION` of
  `web/version.js`; build number = workflow run number. Bundle id `io.github.bennymat93.telenova`, iOS 15+, universal.
- Workflow `ios-app` (push to `ios-app/**` or manual `gh workflow run ios-app.yml --ref gh-pages`): unsigned IPA ->
  checks -> artifact `TeleNova-Web-ipa`; simulator self-test (`-selftest`, `-forceOffline` launch arguments, results
  written to `Documents/selftest-*.json`) -> artifact `simulator-run`; then commits `ios/TeleNova-Web-<ver>.ipa`
  (replacing the previous one) and fixes the file name inside `ios/README-app.md`.

## Log
- 18:45 UTC first green run (44365469704, build 2): compiled first time after the review fixes; IPA committed by the bot (d227051).
- 18:20 UTC run 44362841328 sat queued 25+ min (macOS runner queue) and was cancelled; a pre-compile review found
  2 compile errors (dictionary literals passed as Any?) + 1 crash path (JS dialog while another sheet closes) + the
  simulator pick; all fixed, pull-to-refresh added, pushed again. Owner (via main session): release the IPA FIRST.
  `ios/README-app.md` is drafted locally, pushed once the IPA exists (verification section still to write).
- 17:49 UTC first push, run 44362841328.
