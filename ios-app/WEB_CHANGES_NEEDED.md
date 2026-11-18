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
7. **Built-in helper (owner's request 2026-11-18: the Worker embedded in the build)**: the iOS app answers the
   helper protocol itself (`ios-app/Sources/HelperRelay.swift`, same allow-list and header rules as
   `worker/index.js` - keep the two in step when a host is added). `bridge.js` answers `fetch()` to
   `https://helper.telenova.invalid/p` and `/ping`, and writes that address into the page's `helper` setting when it
   is empty (the only way without a web change, because `TN.settings` is frozen). Cleaner in `web/`:
   `TN.settings.helper()` returns `window.TeleNovaNative.helper` when the viewer set no address of their own, the
   Services row shows "built into the app" instead of a URL field, and a backup made in the app does not carry
   the `.invalid` address to a computer (there it would fail the ping and show "needs helper").

## Sign-in findings (2026-11-18, read-only review of `web/`, each point checked against the code)

Full text with file:line evidence: `login-map.json` in the shared notes folder of the sessions. In order of value:

**Telegram**
1. **BLOCKER - `web/tg.js:145` and `:180` call `dropPending()` and `setFlood(0)`, which are defined nowhere.**
   `signedIn()` throws a ReferenceError before `getMe()`, so every sign-in (QR, phone, resume of a saved session)
   fails at its last step, and `forget()` throws too. Fix: define both next to `savedSession` (sessionStorage
   `bn_tg_pending` / `bn_tg_flood`, inside try/catch). The iOS app defines them as globals in `bridge.js` as a stopgap,
   so the app works before this is fixed; a function inside the module hides the stopgap.
2. A half-finished phone login is lost on any reload / app suspend (the header of `tg.js` describes
   `bn_tg_pending` but the code is not there): store `{phone, hash, where, session, keep, t}` after SendCode and
   resume the code step within 10 minutes.
3. QR sign-in on the phone itself: add a real link `href = st.url` ("confirm in the Telegram app on this device")
   above the QR canvas in `tglogin.js`, and let phones start on the QR tab. (The iOS app shows a native button for
   it already.)
4. Code field: drop `maxLength`, keep digits only on input, submit when `st.length` digits are present; flood wait
   remembered and counted down; a 25 s timeout with a way out while "Connecting..."; `floodSleepThreshold: 0`
   during a fresh login; load fflate / qrcode-generator from `web/vendor/` (today a CDN failure reads "not available
   offline"); a pairing link must not overwrite the API details under a live session; show the normalised phone
   number (the code assumes +972).

**Real-Debrid**
5. Device code: one failed poll ends the whole sign-in (`rd.js` poll loop) - keep polling until the code expires,
   poll at once on `visibilitychange`, offer "New code" on expiry.
6. Use `direct_verification_url` when RD returns it (no retyping of the code), copy the code on "Open the site".
7. A wrong pasted token is reported as "Signed in": check it with `user()` first.

**Other accounts**
8. Google Drive cannot complete inside the apps (pop-up / embedded web view): hide the buttons when
   `window.TeleNovaNative` exists or add the native bridge (needs a change in `gdrive_cb.js`).
9. One-tap "Paste" for keys; a key that fails its test should not stay stored as valid; test results should say what
   is wrong instead of a bare HTTP status; row states that say "on" for things that are not signed in.
