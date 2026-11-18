# Changes in `web/` that would improve the Android app

The app works without any of them (it was built not to need a change in `web/`). Each item is optional; none was made
here because `web/` belongs to the web session.

The app marks itself in two ways a page can test:
- `window.TNShell && TNShell.android === true` (object added by `android/app/src/main/assets/shell.js` at document start);
- the user agent ends with `TeleNovaApp/<version>` (and has `Android TV` on TV devices, so `shell_core.js` picks the TV shell).

## 1. A "Files" row instead of the floating button
Today `shell.js` adds a floating "Files" button on `#/backup`, `#/settings*`, `#/services`, `#/library`, `#/gdrive`.
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
