# Changes in `web/` that would improve the Android app

The app works without any of them (it was built not to need a change in `web/`). Each item is optional; none was made
here because `web/` belongs to the web session.

The app marks itself in three ways a page can test:
- `window.TeleNovaNative` (`{platform: 'android', helper, save, files}`) - the same name the iOS app defines;
- `window.TNShell && TNShell.android === true` (object added by `android/app/src/main/assets/shell.js` at document start);
- the user agent ends with `TeleNovaApp/<version>` (and has `Android TV` on TV devices, so `shell_core.js` picks the TV shell).

## 1. A "Files" row instead of the floating button
Today `shell.js` adds a floating "Files & refresh" button (it opens the app menu) on `#/backup`, `#/settings*`, `#/services`, `#/library`, `#/gdrive`.
Cleaner: in `web/app.js` (settings, "data" group, next to the Backup row) and in `web/backup.js` (top of the page):

```js
if (window.TNShell && TNShell.android) m.append(setRow(N('m_files'), N('ms_files'), TN.button('btn ghost', N('core_open'), () => TNShell.files()), true));
```

with strings `m_files` = "קבצים באפליקציה" / "App files" / "Файлы приложения" and `ms_files` = "גיבויים, כתוביות והגדרות
שנשמרו במכשיר" / "Backups, subtitles and settings saved on the device" / "...". When this exists, remove the `fab()` block
from `shell.js`. `TNShell.menu()` opens the app menu (reload, content source, about) the same way.

## 2. Google Drive sign-in (`web/gdrive.js`)
`gdrive.js` opens Google's consent page with `window.open(...)` and waits for `postMessage` from `gdrive_cb.html`
through `window.opener`. Google refuses OAuth inside an Android WebView, so the app opens that address in the browser;
the browser's `gdrive_cb.html` then has no `opener`, and the token never reaches the app. Needed in `web/`:
- `gdrive_cb.js`: when there is no `opener`, redirect to `telenova://gdrive#<the same fragment>` (the app already
  accepts `telenova://` links and loads `web/` with that fragment);
- `app.js` / `gdrive.js`: at start, when `location.hash` begins with `#access_token=` / `#state=` (or a dedicated
  `#gdrive=` prefix), hand the fragment to the same handler that the `message` listener of `gdrive.js` uses.
Until then Google Drive cannot be connected inside the app (everything else on that page is unaffected).
App side already done (1.0.1): a link to `.../web/gdrive_cb.html#...` that reaches the app is loaded as it is, so the
"sign in in this tab" flow can complete when Android hands the redirect back to the app (Android 12+: only after the
owner enables "open supported links" for the app, or with a verified app link - `assetlinks.json` at the root of
`bennymat93.github.io`, which is another repository). Not tested.

## 3. Large Telegram files (`web/tgplay.js`)
`canSaveBig()` tests `window.showSaveFilePicker`, which a WebView does not have, so only the "small file" path (one
Blob) is offered. To save big files straight to the app folder add a branch:

```js
if (window.TNShell && TNShell.android && TNShell.save) return TNShell.save(blob, nameOf(src));   // returns Promise<boolean>
```

(for real streaming a `TNShell.saveStream(name, size)` -> `{write(Uint8Array), close()}` API would have to be added to
`shell.js` first - say so and it will be added on the Android side.)

## 4. Saved-file notice
After `a.download` the page shows its own "file saved" text (`bk_exported`) and the app shows a dialog with the folder.
Nothing to change; if the double notice is unwanted, skip the page's toast when `TNShell.android`.

## 5. The built-in helper and Live TV (`web/iptv.js`)
The app writes `https://helper.telenova.invalid` into the `helper` setting, so `iptv.js` thinks a general helper exists:
`candidates(c, true)` adds a "through the helper" source for http / CORS-less streams and `helperHls()` asks it by
`XMLHttpRequest` - which the app does not answer (only `fetch()` is), and the built-in relay serves only its seven
fixed hosts anyway. The extra source fails at once and the page moves on, but the texts (`iptv_why_refused`) mislead.
Fix in `web/iptv.js`: treat the app's relay as "no helper" for streams and playlists:

```js
const ownHelper = () => { const b = TN.settings.helper ? TN.settings.helper() : ''; return self.TeleNovaNative && b === self.TeleNovaNative.helper ? '' : b; };
```

and use `ownHelper()` in `helper()`, in `fetchText()` and where `iptv_why_helper` is chosen.

## 6. The app's helper address in a backup (`web/app.js`, `web/backup.js`)
The address is stored in `cfg.helper`, so a settings export made in the app carries it. Restored in a plain browser it
is a helper that never answers. Fix in `web/app.js` (settings.helper):

```js
helper: () => { const h = httpsOnly(String(cfg.helper || '').replace(/\/+$/, '')); return h === 'https://helper.telenova.invalid' && !window.TeleNovaNative ? '' : h; },
```

## 7. Telegram sign-in (`web/tg.js` lines 145, 180)
`dropPending()` and `setFlood(0)` are called but defined nowhere; the apps define them as globals until the page does
(remove `sessionStorage` `bn_tg_pending`; set / remove `bn_tg_flood`). The real fix belongs in `web/tg.js`.
