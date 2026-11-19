# TeleNova iOS app - handoff (continue from here, any account)

Owner's request (2026-11-18): an iPhone + iPad version of the web app as an UNSIGNED `.ipa` that he signs himself;
feels native, same functions as the browser version, file management (import / export / folders). Answer him in Hebrew.
He also asked that this file is kept current so another account can continue smoothly.

## STATE (update this block first)
- 2026-11-19, asked by the web session (owner: the full backup is ONE file, a new one overwrites the old):
  `FileStore.singleFiles` - a download named exactly `BN_Stream_backup.tncfg` replaces
  `Documents/Backups/BN_Stream_backup.tncfg`; all other names keep numbered copies. Self-test keys:
  `oneBackupFiles` must hold exactly one path, `oneBackupSize` must be 6 (the second save). Pushed as the next
  build - check those two keys.
- 2026-11-19 01:45 UTC. CURRENT RELEASE: iOS 2.0 build 8 (run 44429344023 green, bot commit f195387, release
  `ios-2.0-b8`), bundled web 5.2.1, self-test passed on iPhone + iPad. `bnstream://` check: the simulator showed the
  system question "Open in BN Stream?" (so the scheme is registered and reaches the app), but nobody taps it in
  CI, so the LANDING on the Backup page with the code box is NOT verified - only on the owner's device, or by
  adding a tap to the workflow. Sent to the owner. Nothing in progress.
- 2026-11-19 (after 2.0 b7), asked by the web session for web 5.2.1 "move the setup to another device": URL scheme
  `bnstream` registered; `bnstream://setup/<payload>` and a scanned / pasted `...#setup=<payload>` link load the
  page with `#setup=<payload>` and reload it (`handleIncoming`). The workflow opens `bnstream://setup/...` in the
  simulator and saves `phone-setup-link.png` - LOOK AT IT in the next green build (must show the Backup page with
  the code box). `window.TeleNovaNative` is defined at document start; the data store is the default persistent one.
- 2026-11-19 01:30 UTC. CURRENT RELEASE: iOS app 2.0, build 7 (run 44427144401 green, bot commit ef09550):
  `ios/TeleNova-Web-2.0.ipa` (8,450,890 bytes) + GitHub release `ios-2.0-b7` (made by the workflow's new last
  step - it works). Version now comes from `ios-app/VERSION` (not from the web version); bundled web copy 5.2.0.
  Self-test passed on iPhone + iPad, live and offline; phone screenshot checked (web 5.2 home with the menu tiles,
  "..." button in the bottom-left strip). Sent to the owner. Nothing in progress.
  Seen in the screenshot, a `web/` matter: on the Home tiles in English the labels sit right-aligned under centred
  icons (RTL rule applied to an LTR language).
- OWNER'S BUDGET RULE (2026-11-18, all sessions): 15 USD loaded - finish the iOS app first, in the cheapest way
  (no agent fan-out, no long polling, short answers), then the APK if money is left; everything else is STOPPED
  until he connects another account.
- 2026-11-18 22:05 UTC. iOS IS DONE AND RELEASED: build 6 (bot commit e62add2, 8,440,561 bytes) is on the site and
  was sent to the owner. Self-test passed on iPhone + iPad, live and offline: built-in helper (ping, relay 200,
  foreign host 403, YouTube path rule 403, `TNHelper.has()`), a Real-Debrid device code returned through it,
  Telegram stopgap functions present; screenshot checked - the "..." button sits in the bottom-left strip under the
  tab bar. Nothing is in progress in this session.
- If a build "fails" in seconds with no steps, GitHub had no free macOS runner ("job was not acquired by Runner"):
  re-run it (`timeout 50 gh api -X POST repos/bennymat93/TeleNova/actions/runs/<id>/rerun > x`).
- NEXT (only when the owner reports from his iPhone / iPad): fix what he reports. Not verifiable here: a real
  Telegram and Real-Debrid sign-in, playback, the "confirm in Telegram" button (the simulator has no Telegram).
- 2026-11-19: owner asked for downloads in the repo with versions kept. DONE: GitHub Releases
  (https://github.com/bennymat93/TeleNova/releases): `ios-5.1.0-b6` and `apk-1.1.0` created by hand; the iOS
  workflow now creates `ios-<ver>-b<run>` after every green build (last step; its first real use is the NEXT
  build - check it once). `DOWNLOADS.md` at the repo root explains it, with the one command for a new APK release.
- Owner's requests since the first release and their state:
  1. Telegram sign-in: ROOT CAUSE FIXED IN WEB (commit 6ba19d5, live): `web/tg.js` called `dropPending()` /
     `setFlood()` that were never defined. iOS also carries a stopgap in `bridge.js` and a native button that opens
     the `tg://login?token=` link of the QR step in the Telegram app. Remaining web items: `WEB_CHANGES_NEEDED.md`.
  2. Worker "embedded in the build, generally": (a) deployed to the owner's Cloudflare account (wrangler was
     already signed in on this PC): https://telenova-helper.hmi-analyzer.workers.dev , tests + live checks OK;
     (b) `web/app.js` `TN.settings.helper()` defaults to it (commit 6ba19d5); (c) iOS has its own native relay
     (`Sources/HelperRelay.swift`, no Cloudflare needed); (d) Android did the same in its 1.1.0 (its session).
     Redeploy after a change in `worker/`: `cd worker && npx wrangler@3 deploy`. Remove: `npx wrangler@3 delete`.
  3. Real-Debrid sign-in: works through the helper (device code verified through the deployed Worker and, in
     build 4+, through the native relay); approval page opens in an in-app Safari sheet (build 5). Web-side
     polish (poll loop, direct link, token check): `WEB_CHANGES_NEEDED.md` 5-7, not done.
  4. Name BN Stream: iOS display name (build 5); bundle id / file names unchanged on purpose. APK: Android session.
- This session edited `web/` twice only (tg.js fix, app.js helper default), each as a HEAD-blob + one-hunk index
  commit so the web session's uncommitted work was untouched. Everything else in `web/` stays with its owner.
- NOT verifiable here: a real Telegram / Real-Debrid sign-in (needs the owner's accounts and device).
- `gh` on this PC prints and then hangs: always `timeout 60 gh api ... > file`.

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
