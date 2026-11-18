# Changes in `web/` that would make the iOS app better

The iOS app works without any of these. They are written here for the session that owns `web/`; nothing in `web/`
was edited by the iOS work.

Inside the app the page can tell where it runs: `window.TeleNovaNative` exists (`platform: 'ios'`), and the user
agent ends with `TeleNovaApp/<version>`.

1. **Google Drive sign-in** (`web/gdrive.js` `signIn()`): it opens a pop-up and waits for `window.opener.postMessage`.
   In the app a pop-up opens in Safari (Google refuses sign-in inside embedded web views), so the answer never comes
   back and the page shows the "pop-up blocked" message. Suggested: when `window.TeleNovaNative` exists, hide the
   Drive connect button or show a line "connect Google Drive in Safari / on a computer". A full fix needs a native
   `ASWebAuthenticationSession` bridge plus a redirect address registered for it in the Google client.
2. **A "Files" entry in Settings > Backup**: when `window.TeleNovaNative` exists, add two buttons that call
   `TeleNovaNative.files()` (opens the app's Documents browser) and `TeleNovaNative.importFiles()`. Today these are
   reached from the app's floating "..." button and from the Home-screen icon menu.
3. **Pairing**: a "Scan pairing code" button that calls `TeleNovaNative.scanPair()` next to the place where the
   viewer types the Telegram API id / hash.
4. **Export message**: after an export the page says the file was downloaded; in the app the file is saved under
   `Files > TeleNova > Backups` (or `Subtitles`, `Playlists`, `Downloads`) and the app shows its own "saved" alert.
   `TeleNovaNative.save(blob, name)` returns `{ok, path}` if the page wants to show the path itself.
5. **Large Telegram saves** (`web/tgplay.js`): `showSaveFilePicker` does not exist in WebKit, so a save builds the
   whole file in memory first. For files over a few hundred MB the page could stream pieces straight to
   `TeleNovaNative` instead (the bridge already writes piece by piece to disk).
6. **Wide (desktop / tablet) layout and the top safe area**: on an iPad (1032 px wide, `data-shell="desktop"`) the
   rail's logo is drawn at the very top, under the system status bar (seen in the simulator screenshot of
   2026-11-18). The app works around it by hiding the status bar on iPad; in Safari on iPad as a home-screen web app
   the overlap would still show. Suggested: `padding-top: env(safe-area-inset-top)` on the rail and the top bar in
   the desktop shell too.
