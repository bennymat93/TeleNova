# TeleNova Web modules: the interface (WP-0)

Every package writes plain browser scripts (no build step, no ES `import`), one file per module, named exactly as
below, in `web/`. Each file is an IIFE with `'use strict'` that uses only the global `TN` object:

```js
'use strict';
(function (TN) {
  TN.i18n.add({he: {hub_x: '...'}, en: {hub_x: '...'}, ru: {hub_x: '...'}});
  TN.registerPage('hub', async (arg, ctx) => { TN.page('', TN.t('m_hub')); /* draw into TN.view() */ });
  TN.registerProvider('dailymotion', {kinds: ['search'], async search(q, opts) { return [/* results */]; }});
})(self.TN);
```

Rules
- Only WP-0 edits `app.js`, `index.html`, `style.css`, `i18n.js`, `version.js`. Only WP-3 edits `sw.js`. Need something here? Ask WP-0.
- A module is loaded on demand: the first time one of its pages is opened, when `TN.providers(kind)` asks for a kind it
  declares, or by `TN.load(name)`. Its dependencies are loaded by the module itself: `await TN.load('matcher')`.
- The table of module names, their pages and provider kinds is `MODULES` in `app.js` (copied below). A new page key or
  provider kind not listed there needs WP-0. A module file that does not exist yet leaves a "coming soon" page (or the
  page app.js already draws). Until a file exists, opening its page shows one 404 in the console; that is expected.
- `sw.js` already precaches every file name below (skipped while missing). Extra files (data JSON, images) are
  cached by the SW the first time they are fetched; nothing else is needed.
- Styles: modules use the existing classes (`panel`, `grid`, `card`, `btn`, `btn ghost`, `chips`, `hint`, `msg`, `hlist`,
  `hrow`, `links`, `settings`, `tag`) or set inline styles / inject one `<style>` with a class prefix of their name.
- Texts: every UI string in he / en / ru through `TN.i18n.add` + `TN.t`; keys prefixed with the module name. Hebrew is RTL:
  use `inset-inline-*`, `margin-inline-*`, `text-align:start`, `dir="auto"` on user text.
- TV / keyboard: use real `<button>`/`<a href>` elements; the arrows move focus automatically between them. Back / Escape
  closes the sheet, else `history.back()`.
- Never put a key, token, Telegram session or api hash in a URL query, a log, the console or a commit.
- External scripts: only `TN.loadScript(url, 'sha384-...')` with a pinned version on cdn.jsdelivr.net, or a vendored file.

## Shared API (`self.TN`, frozen)

| Member | What it does |
|---|---|
| `version` | the web version (from `version.js`) |
| `registerPage(key, render(arg, ctx), opts?)` | draws page `#/key/<arg>`. `arg` is the decoded rest of the hash; `ctx = {key, arg, rest[], view, keep, current()}` (`current()` is false once the viewer went elsewhere: check it after every await). May return a promise; a rejection shows "could not load / try again". Replaces a built-in or stub page. |
| `registerProvider(name, impl)` | `impl.kinds` (array) is one or more of `search`, `source`, `subs`, `service`. Shapes below. |
| `providers(kind)` → Promise<impl[]> | loads every module declaring that kind, returns the registered, enabled ones |
| `provider(name)` → Promise<impl\|null> | one provider/service by name (loads the module of that name if needed) |
| `providerOn(name)` / `setProviderOn(name, bool)` | the Library on/off switches (browser setting `providers_off`) |
| `load(moduleName)` → Promise | loads a module file once |
| `addTitleAction(fn(actsEl, {type:'movie'\|'tv', id, title, detail, poster}))` | called each time a title sheet opens; append buttons to `actsEl` |
| `addHistoryHandler(fn(entry, target) → bool)` | called first when a history row is chosen; return true when handled |
| `on(event, fn)` → off(), `emit(event, data)` | events: `route` (ctx), `provider` (impl), `providers`, `settings` (key), `clearcache` |
| `i18n.add(table)`, `t(key, ...args)` | texts; `%s` replaced in order. `t` also finds the older app.js texts |
| `lang()`, `rtl()` | `'he'\|'en'\|'ru'`, true for Hebrew |
| `get(k, d)`, `put(k, v)`, `drop(k)` | this browser's storage (`localStorage` `bn_<k>`, JSON, never throws). Not synced. |
| `store` | the active user's lists in the build's shapes (store.js): `history()`, `addHistory(e)`, `favs()`, `isFav/addFav/removeFav`, `searches()`, `addSearch`, `removeSearch`, `clearSearches`, `art/setArt`, users... |
| `SyncDoc`, `WebSync` | syncdoc.js / websync.js objects |
| `settings.get(k, d)`, `settings.set(k, v)` | this browser's settings (`cfg`): `lang`, `theme`, `live`, `radio`, `tmdb`, `device` (`auto`\|`tv`\|`phone`\|`desktop`, applied as a class on `<html>`), `helper` (Worker URL), `providers_off`, and any `<module>_<name>` key a module adds |
| `settings.synced()` | copy of the account's synced settings (TMDb key, gemini key, content_lang... as the build writes them) |
| `settings.helper()` | the optional Worker base URL (https only, no trailing slash) or `''` |
| `esc(s)`, `$(sel)`, `button(cls, text, onClick)`, `card(img, title, sub, onClick, shapeCls, badge)`, `section(title, count)` → grid el, `page(key, title)` (clears the view, back button + h1), `chips([[k, name]], on, go)`, `skeleton(n)`, `empty(gridEl, text?)` | UI building blocks, the same as the built-in pages |
| `modal(html)`, `closeModal()`, `favButton({kind, id, label, extra, img})`, `kodiOnly(title, text, fav?)` | the sheet |
| `cssUrl(u)`, `paint(el, u)`, `httpsOnly(u)` | safe pictures |
| `view()` | the `<main>` element |
| `loadScript(src, integrity?)` → Promise | adds a `<script>` |
| `go(hash)`, `route()`, `here()` → `{key, arg, rest}`, `params(arg)` → object, `link(key, params)` → `'#/key/...'` | router |
| `tmdb(path, params)` → Promise<json>, `tmdbLang()`, `tmdbImg(path, size)`, `hasTmdbKey()` | TMDb (viewer's key, else the account's synced key) |
| `openTitle(type, id)`, `openArchive(doc)`, `openChannel(c)`, `playRadio(s)`, `stopRadio()`, `archive(opts)`, `channels(list)`, `stations(cc, q, tag)`, `doSearch(q)`, `noteHistory(entry)` | the built-in screens and sources |
| `tg()` → Promise<window.TG> | loads tg.js (WP-1 adds `TG.client()`) |
| `clearCaches()` | deletes the SW caches and emits `clearcache` (listen to clear your IndexedDB) |

Provider shapes (all methods async, all optional except where the kind needs them):
- `search`: `{kinds:['search'], label, search(q, {signal, limit}) → [{title, sub, img, kind, score, open()}]}`
- `source`: `{kinds:['source'], label, sources({type, id, imdb, title, year, season, episode}, {signal}) → [{label, quality, lang, size, url?, tg?, open()}]}`
- `subs`: `{kinds:['subs'], label, find({imdb, tmdb, season, episode, lang}) → [{label, lang, fetchVtt() → string}]}`
- `service`: a singleton other modules use by name, e.g. `player` (`open({url|tg, title, subs, resumeKey})`), `sources`, `tgplay`, `epg`, `gdrive`.

## MODULES (name → pages / provider kinds)

| Package | Module file | Page keys | Kinds |
|---|---|---|---|
| WP-0 | (app.js) | `hub` (box until hub.js), `search`, `searchhist`, `movies`, `tv`, `live`, `radio`, `favs`, `history`, `users`, `settings`, `bn`, `about` | |
| WP-1 | `tglogin.js` | `tglogin` | |
| WP-2 | `matcher.js`, `epmatch.js`, `tgsearch.js`, `telegram.js` | `telegram` | tgsearch: `search`, `source` |
| WP-3 | `tgplay.js` (+ `sw.js`) | | `service` (`tgplay`) |
| WP-4 | `catalog.js` | `movies`, `tv`, `catalog` (replace the built-ins) | |
| WP-5 | `sources.js`, `player.js`, `rd.js` | | sources/player: `service`; rd: `source` |
| WP-6 | `srt.js`, `subs.js` | | subs: `subs` |
| WP-7 | `iptv.js`, `epg.js`, `radio.js` | iptv: `live`; radio: `radio` | iptv, radio: `search`; epg: `service` |
| WP-8 | `yt.js`, `topics.js`, `hub.js` | yt: `youtube`; topics: `topics`; hub: `hub`, `search` | yt: `search`, `source`; hub: `search` (e.g. dailymotion) |
| WP-9 | `services.js`, `library.js`, `backup.js`, `gdrive.js`, `help.js`, `status.js` | services: `services`, `device`; `library`; `backup`; `gdrive`; `help`; `status` | gdrive: `service` |
| WP-10 | `worker/` | | reads `TN.settings.helper()` |

Main menu (Kodi root order): hub, searchhist, movies, tv, live, radio, telegram, history, favs, library, users, services,
backup, gdrive, status, help, device, settings, bn (Download Kodi), about. Page keys with no module are "coming soon".

Sync schema: new synced fields (resume points, provider toggles, pins) need `syncdoc.js` + `syncdoc.py` together - ask WP-0.
Until then `providers_off` and `device` are this browser's settings only.
