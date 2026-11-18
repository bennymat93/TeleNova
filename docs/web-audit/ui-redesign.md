# TeleNova Web - interface audit and redesign specification

Scope: `web/index.html` (41 lines), `web/style.css` (140), `web/app.js` (1246), `web/i18n.js`, `web/hub.js`,
`web/catalog.js`, `web/player.js`, `web/sw.js`, `web/manifest.webmanifest`, `web/MODULES.md`, `docs/DESIGN_PRINCIPLES.md`.
Analysis only: no existing file was changed. Nothing here was run in a browser or on a TV; every finding comes from
reading the code. Browser-engine version numbers for TV sets (section 1.9) are from memory and must be confirmed on a
real set before they are relied on. Contrast ratios were computed (WCAG formula) from the hex values in `style.css`.

Contents: 1. Defects · 2. What must keep working · 3. Design tokens · 4. Layout shells · 5. Components ·
6. Focus and navigation rules · 7. Implementation plan · 8. Acceptance checks

---

## 1. Defects in the present interface

Severity: **A** = breaks use on a device class, **B** = clearly below a first-class streaming app, **C** = polish.

### 1.1 Navigation model and shell

| # | Sev | Where | Defect |
|---|---|---|---|
| N1 | A | `index.html:31-35`, `style.css:6,62`, `app.js:205,1152` | The only navigation is a top bar: brand, a horizontally scrolling strip of 10 pills (`NAV` + home) and a search box. No side rail (desktop/TV), no bottom tab bar (phone). At <=760 px the header becomes three stacked sticky rows (brand, pills, search), about 150 px of a 640 px phone screen. |
| N2 | A | `app.js:552-561`, `app.js:202-204`, `style.css:42-45` | Home is a wall of 20 equal emoji tiles (the Kodi root list copied as is). No hero, no rows, no "continue watching" (Design Rules 27, 28), no content at all on the first screen. |
| N3 | B | `app.js:202-204` | Icons are emoji mixed with text glyphs (`✈ ↺ ★ ℹ ♥`): colour emoji next to monochrome glyphs, different on every OS, missing (empty boxes) in several TV browser fonts. Principle C "mixed icon styles". |
| N4 | B | `app.js:402-405` | `page()` always draws a "Back to main menu" pill that links to `#/`, whatever the parent is (catalog.js:126-130 patches the href afterwards). The arrow glyph is chosen by `cfg.lang === 'he'` in JS. On TV an on-screen back button contradicts principle A (D-pad row). |
| N5 | A | `app.js:449-458`, `app.js:1233-1236` | A sheet (title, channel, player) is opened without a history entry. The phone's Back gesture / browser Back therefore leaves the page under the sheet instead of closing it; only key events are handled. Worst case: Back during playback throws the viewer out of the app (history is empty on a fresh visit). |
| N6 | B | `app.js:1155-1180` | `route()`: always `window.scrollTo(0, 0)` (line 1178); no scroll or focus restoration when going back to a list (Rule 25); `document.title` never changes (always "BN Stream Web"); the route change is not announced; an unknown page key silently draws Home (line 1166). |
| N7 | B | `app.js:463-493` | A title has no page and no address: it exists only as a modal. It cannot be linked, bookmarked, reloaded or reached with Back/Forward; the sheet is 980 px wide at most (`style.css:32`) even on a 4K screen. |
| N8 | B | `index.html:34`, `app.js:1036-1047`, `hub.js:131-140`, `catalog.js:182-192` | Three different search boxes (header, hub page, catalogue). The catalogue one uses class `input`, for which `style.css` has no rule: it renders as the browser's default white field inside the dark theme. |
| N9 | B | `app.js:1143-1145` | The device setting adds class `phone` or `desktop` to `<html>`, but no CSS rule uses either (`style.css` only knows `html.tv`). Choosing "Phone" or "Computer" changes nothing except switching TV mode off. |
| N10 | C | `app.js:1154` | `markNav()` sets class `on` only; no `aria-current`. `#/catalog/...`, `#/search/...`, `#/users` highlight nothing. |
| N11 | C | `app.js:32,56,80`, `style.css:40,76` | A footer with a hard-coded "BN Stream Web 4.2" line and 84 px bottom padding is on every screen, TV included. |

### 1.2 Responsive layout

| # | Sev | Where | Defect |
|---|---|---|---|
| R1 | B | `style.css:15,63,81,88,90,93` | One wrap grid for everything; there is no horizontal row component anywhere. Search results are up to five stacked grids of up to 40 cards (`app.js:869-898`, `hub.js:186-217`): the third source is several screens down. |
| R2 | B | `style.css:19,49,81` | `card wide` (16:9 channel) and `card square` (radio) sit in the poster grid's columns. At <=400 px that is 3 columns of about 104 px: a channel logo is 104x58 px with a 12 px two-line name. |
| R3 | B | `style.css:20-21` | `.card .t` has a fixed height of 2.7em and `.s` 1.5em, so a card with no subtitle still reserves the line; long Hebrew titles are cut after two lines with no tooltip (only catalog.js:156 sets `title`). |
| R4 | A | `style.css:68` | `scroll-padding: 90px 0 110px` assumes a 90 px header. With the three-row phone header (N1) a focused element scrolled "into view" lies under the sticky header (Rule 18). |
| R5 | B | `style.css:92-99` | TV mode: body 20 px, card subtitle 15 px, hint 13 px (Rules 1-2 need 28 / 24 px at 1080p); side padding 48 px and top padding 12 px (Rule 8: 96 / 54 px); gap 24 px (Rule 11: 40 px); sizes are fixed px, so a TV browser that reports 1280x720 or 960x540 CSS px gets a different physical size. |
| R6 | B | `app.js:207` | TV is detected by user agent only. `\bTV\b` does not match "SmartTV", and VIDAA (Hisense), NETTV (Philips), many Android TV browsers and a PC connected to a television are missed. No detection by input (first D-pad key with no pointer). |
| R7 | C | `style.css:32,84` | `.sheet{max-height:92vh}`: on iOS Safari `vh` includes the collapsed toolbar area, so the sheet's last lines sit under the toolbar (only the landscape rule uses `dvh`). No scroll lock on `<body>` and no `overscroll-behavior`: the page behind the sheet scrolls. |
| R8 | C | `style.css:58-65,87-88` | Breakpoints 400 / 760 / 1100 / 1700 / 2400 are spread through the file as overrides of single properties; there is no layout shell per width, and nothing between 1100 and 1700 px. |
| R9 | C | `style.css:69` | `body{overflow-x:hidden}` hides overflow bugs instead of fixing them and stops `position:sticky` from working in some old WebKit builds. |

### 1.3 Focus, keyboard, remote

| # | Sev | Where | Defect |
|---|---|---|---|
| F1 | A | `app.js:1225` | Arrow keys are ignored while a `<video>` or `<audio>` has the focus, in every direction. On a remote (no Tab key) the focus can never leave the video element again: the buttons under the player (audio, speed, subtitles, next episode, `player.js:225-234`) become unreachable (Rules 24, 30). |
| F2 | A | `app.js:471,496`, `hub.js:77` | When the focus enters the YouTube / Archive / Dailymotion iframe, key events no longer reach the page: no arrow navigation and no Back. Nothing returns the focus to the sheet. |
| F3 | B | `app.js:1199-1219` | `move()` measures every focusable element of the document (`getBoundingClientRect`) on each key press - thousands after a few pages of the infinite catalogue list (`catalog.js:244-285`) or a full channel list. Selection is by centre distance (`along + across * 2.5`): Up/Down from a row does not return to the column it came from, wide elements (search field, `hrow`) win or lose unpredictably, header pills are candidates from everywhere. |
| F4 | B | `app.js:1243-1244` | After a route change the first `.tile/.card/.hrow/.chip/a/button` is focused after a fixed 350 ms: async pages are not drawn yet, so the focus lands on the back button or a skeleton. The previously focused card is never restored (Rule 25). |
| F5 | B | `style.css:11,17,44,71,97,109,115,129`, `catalog.js:138`, `player.js:43`, `subs.js:490` | At least seven different focus styles: 2 px outline, 2 px ring at 33 % alpha, 3 px outline + offset 3, 4 px outline + scale 1.04, background change only with `outline:none` (`.sugitem`), 3 px white (`.cat-fav`), 2 px accent. Rule 15 allows one. The 33 % ring (`--ring`) is about 1.6:1 against the panel, below the 3:1 of WCAG 1.4.11 / 2.4.13. |
| F6 | B | `app.js:1231-1232` | Backspace means "Back" on every device whenever the focus is not in an `<input>`; a desktop user loses the page with one key. `<select>`, a future `<textarea>` and `contenteditable` are not excluded. |
| F7 | B | `app.js:461`, `MODULES.md:28-29` | Escape closes a sheet but never goes back, although the module contract says "Back / Escape closes the sheet, else history.back()". |
| F8 | B | `app.js:449-453` | `modal()` always focuses the `×` button, never the primary action (Play); it is called twice per title (loading, then content). On close the focus is not returned to the card that opened the sheet. Tab leaves the sheet into the page behind it (no focus trap; only the arrow scope is limited, `app.js:1198`). |
| F9 | C | `app.js:1216-1217` | `scrollIntoView({behavior:'smooth'})` runs for every arrow press, ignores `prefers-reduced-motion`, and smooth scrolling stutters on TV chipsets. |
| F10 | C | `app.js:1240-1242` | The keyboard / pointer flag is set by any key, typing in the search box included, and is not exposed to CSS, so hover effects and focus rings cannot follow the input method. |

### 1.4 Accessibility

| # | Sev | Where | Defect |
|---|---|---|---|
| A1 | B | `index.html:38` | The sheet has no `role="dialog"`, `aria-modal`, or label; the close button's label is the fixed English "Close". |
| A2 | B | `index.html:31-39` | No skip link, no `aria-label` on `<nav>`, no live region; Home has no `<h1>`. |
| A3 | B | `app.js:914-935`, `style.css:105-111` | The suggestion list is not a combobox / listbox (`aria-expanded`, `aria-activedescendant`, Up/Down inside the field); focus style is a background change only. |
| A4 | B | `style.css:1-2,41` | Surfaces are told apart by 1.11:1 (dark `--panel` on `--bg`) and 1.06:1 (light `--panel2` on `--bg`); field and chip borders (`--panel2`) are 1.24:1. Inputs, chips and cards have no boundary that meets 3:1. |
| A5 | B | `style.css:112,127`, `catalog.js:137,142` | `.card.dim` text at 45 % opacity (about 2.9:1); `.tgerr` `#e66` on the light panel 3.12:1; `limegreen` "watched" dot 2.12:1 on light; the gold favourite star on a light poster 1.4:1. |
| A6 | B | `app.js:426,492,604,620`, `app.js:1014-1017` | Empty and error states are one grey sentence. Network failures are turned into "Nothing found" (`.catch(() => [])` at 590, 604, 620; `catch` at 492), so "offline" and "empty" look the same. `failPage()` appends its text under a half-drawn page; no `role="alert"`. |
| A7 | B | `app.js:716,748,863,1069` | Confirmations are "press again" label swaps and result texts in bare `<span>`s (`#s_done`, `#unote`) with no `role="status"`; no toast component; the armed state of a destructive button never times out. |
| A8 | C | `style.css:33,110`, `catalog.js:136` | Touch targets of 36 px (`.close`, `.sugx`) and 34 px (`.cat-fav`); the guideline is 44-48 px. |
| A9 | C | `style.css:1-4` | No `color-scheme`: native controls (select list, scrollbars, autofill) stay light inside the dark theme. `index.html:10` `theme-color` is the dark value in the light theme too. |
| A10 | C | `app.js:473,706`, `player.js:431` | Mixed-direction meta lines (`year · genres · ★ 7.1`, `1x02. name`) are joined as plain text with no `<bdi>` isolation (Rule 34). |
| A11 | C | `style.css:4,21,52,117` | Base 15 px, secondary text 12-13 px on every non-TV device. |

### 1.5 Loading, images, performance

| # | Sev | Where | Defect |
|---|---|---|---|
| P1 | A | `app.js:277,384-392` | Every picture is a CSS `background-image` set at once by `paint()`: no lazy loading, no `srcset`, no error fallback (a dead radio favicon or channel logo stays an empty grey box). A live list or a search (`app.js:607-608`, `884-889`) starts hundreds to thousands of image requests together. |
| P2 | B | `app.js:599-611`, `catalog.js:244-285` | Whole lists are put into the DOM (every channel of an iptv-org list; every page of the infinite catalogue list is appended and never released). No windowing, no `content-visibility`. |
| P3 | B | `index.html:21` | hls.js (about 0.4 MB) is in `<head>` for every visitor, including those who only read settings or play radio. |
| P4 | B | `app.js:419-425`, `style.css:23` | One skeleton shape (poster) for posters, channels, radio and rows, so the page jumps when the real cards arrive; `.skel .s` has no style; the title sheet's loading state is the word "Loading..." (`app.js:464`). |
| P5 | C | `app.js:430,443,470` | Posters are always `w342`, the detail poster too; no backdrop is used anywhere although `backdrop_path` is fetched (`app.js:483`). |
| P6 | C | `index.html` | No `preconnect` to `image.tmdb.org` / `api.themoviedb.org`. |

### 1.6 Title detail

`app.js:463-493`: the trailer iframe is created immediately at the top of the sheet (third-party load on every open; principle B says no autoplay previews); below it a 200 px poster, one meta line, the plot and three buttons. Missing compared with the Kodi information screen and with any streaming app: backdrop, runtime, certification, cast, seasons and episodes in the same place (series jump to a different page family, `catalog.js:152,325-351`), similar titles, a clear primary "Play" (the play button only exists if a module's title hook adds one, `app.js:485`), resume state, sources. Any failure shows "Nothing found" (line 492). Opening the sheet already writes a history entry (line 482), before anything was played.

### 1.7 Player chrome

| # | Sev | Where | Defect |
|---|---|---|---|
| V1 | A | `player.js:70-72`, `style.css:32-34` | The player is a native `<video controls>` inside the 980 px sheet with a wrap of pill buttons under it. It is not an immersive player: no full-window mode, no overlay, no auto-hide (Rule 29), the title sits under the picture, menus push the layout (`pl_menu`). The sheet's `×` overlaps the picture's top corner. |
| V2 | A | `app.js:508-534` | Live channels use a second, separate player with no buffering indicator and no error text: when every address fails, `next()` simply stops and the box stays black. |
| V3 | B | `player.js:237`, `app.js:540` | `play().catch(() => {})`: when the browser refuses autoplay with sound (Safari, iOS, Firefox) nothing tells the viewer to press Play. |
| V4 | B | `player.js` whole file | No keyboard map (Space/K, arrows = seek 10 s, F, M, C), no Media Session (lock-screen and headset keys, TV remote media keys), no Picture-in-Picture or AirPlay / Remote Playback button, no wake lock, no double-tap seek on touch. |
| V5 | B | `player.js:108-116` | Resume is applied silently and explained by a text line under the video with a "From the start" button; no progress bars on cards anywhere (principle B). |
| V6 | C | `app.js:536-549`, `style.css:55-57` | The radio bar has Stop only: no pause, volume, loading or error state; it is not offset for a future bottom tab bar. |

### 1.8 PWA

| # | Sev | Where | Defect |
|---|---|---|---|
| W1 | B | `app.js:234-235,851,862` | The install prompt is a hidden button inside Settings. iOS / iPadOS never fire `beforeinstallprompt`, and there is no "Add to Home Screen" hint for them. |
| W2 | B | `sw.js:19-25` | `skipWaiting()` + `clients.claim()` with no message to the page: an open tab keeps the old `app.js` and loads new module files on demand. No "new version - reload" notice (only the manual button on the About page, `app.js:1086-1091`). |
| W3 | C | `manifest.webmanifest` | No `id`, `screenshots`, `shortcuts`, `categories`, `display_override`; `theme_color` fixed dark; `index.html:16` apple-touch-icon is 192 px (iOS wants 180 px). |
| W4 | C | `app.js:1245` | The service worker registration sits inside the key-navigation function. |

### 1.9 Cross-browser

These are the properties and syntax the present files use; the "needs" column is the first engine version I believe supports each one (to be verified). Samsung Tizen and LG webOS browsers stay on the engine the set shipped with, so sets a few years old are affected.

| # | Sev | Where | Feature | Needs (approx.) | Effect when missing |
|---|---|---|---|---|---|
| X1 | A | `style.css:18,19,34,49`, `catalog.js:141` | `aspect-ratio` | Chromium 88, Safari 15, Firefox 89 | `.card .img` and `.player` have height 0: no posters, no video area. |
| X2 | A | `style.css:11,17,44,71,109,115,134` | `:focus-visible` inside a selector list | Chromium 86, Safari 15.4 | The whole rule is dropped, including the `input:focus` part of line 11: no focus ring at all unless `html.tv` was detected. |
| X3 | B | `style.css:6` | `color-mix()` | Chromium 111, Safari 16.2, Firefox 113 | The header has no background; content scrolls visibly behind the navigation text. |
| X4 | B | `style.css:6` | `backdrop-filter` without `-webkit-` | Safari 18 unprefixed | No blur on older iOS (harmless once X3 has a fallback). |
| X5 | B | `style.css:22,30,33,55,105` | `inset`, `inset-inline*` | Chromium 87, Safari 14.1 | Overlay, badge, close button, radio bar and suggestion list are misplaced. |
| X6 | B | `style.css:8,24,37,...` | `gap` on flex containers | Chromium 84, Safari 14.1 | Chips, buttons and nav pills touch each other. |
| X7 | B | `style.css:32,74-76` | `min()`, `max()`, `env()` | Chromium 79, Safari 11.1 | Sheet width and safe-area padding dropped. |
| X8 | A | `app.js:230` (`??`), `app.js:756,815,905,915` (`replaceChildren`), `hub.js:24` (`\p{L}`), `catalog.js:63` | ES2020 syntax, `replaceChildren` (Chromium 86, Safari 14) | Chromium 80-86 | A syntax error stops `app.js` completely: a blank page with header only, and no message (the `<noscript>` text does not cover it). |
| X9 | B | `app.js:523`, `player.js:97` | Native HLS test `canPlayType` | - | Recent Chrome on Android answers "maybe" for HLS in some builds; the code then skips hls.js. Prefer hls.js whenever `Hls.isSupported()` and keep native only for Safari / iOS. To be tested. |
| X10 | C | `style.css` | no `-webkit-tap-highlight-color`, no `touch-action` | - | Blue flash on tap in Android / Samsung Internet; double-tap zoom delay on old WebKit. |
| X11 | C | iOS | Native fullscreen | - | On iPhone only the `<video>` element can go fullscreen; a custom overlay disappears there. The player spec (5.11) keeps native controls on iPhone fullscreen. |

### 1.10 Summary against DESIGN_PRINCIPLES.md

Rules clearly not met on the web today: 1, 2 (TV text sizes), 3 (9 font sizes in `style.css`), 8 (safe area), 11 (card gap), 14 (radii 4, 8, 9, 10, 12, 14, 16, 999 px), 15-17 (focus), 18 (hidden under header), 20 (no scrim, no artwork at all), 23 (first focus), 24 (F1, F2), 25 (restore), 27-28 (continue watching), 29-30 (player), 33-34 (manual arrow glyph, bidi). Met: 4, 5, 19 for main text, 21 (one accent), 22 (150 ms), 32 partly (subs.js has size / colour / background).

---

## 2. What must keep working (module contract)

The 30 module files are not edited in the first six steps. They rely on the following, found by reading and by grep:

| Contract | Used by | Consequence for the redesign |
|---|---|---|
| `TN.page(key, title)` clears `#view` and leaves `.pagehead` with `a.backbtn` and `h1` inside `TN.view()` | `catalog.js:128,334,415`, `telegram.js:199` (`querySelector('.backbtn')`, `querySelector('h1')`) | Keep both elements and class names inside the view. The back link gets its real parent (see 5.3) but stays an `<a class="backbtn">`. |
| `TN.section(title, count)` appends `<h2>` then `<div class="grid">` to the view and returns the grid | `hub.js:148`, `topics.js:165,184` call `g.previousElementSibling.remove()` | The `h2` must stay the grid's previous sibling (no wrapper element around the pair). |
| `TN.card(img, title, sub, onClick, shapeCls, badge)` returns `button.card` with `.img`, `.t`, `.s`, `.badge` children | every module; `catalog.js:146-170` wraps it in `.cat-cell` and adds a sibling `.cat-fav`; `catalog.js:171-181` builds `a.card.square` and `a.tile` by hand | Same element structure and class names. New options go in a 7th argument. Shapes `wide`, `square`, `dim` keep their meaning. |
| `TN.skeleton(n)` appends and returns `div.grid.skelgrid`; `TN.empty(gridEl, text)` replaces the element | `catalog.js:197-202` re-uses the skeleton element as the real grid | Keep. |
| `TN.chips(items, on, go)` appends `.chips` with `button.chip(.on)` and returns it | hub, iptv, radio, topics | Keep; styling changes only. |
| `TN.modal(html)` fills `#sheet` inside `#modal`; `TN.closeModal()` empties it | `player.js:70,78-79` (a `MutationObserver` on `#sheet` ends playback when the video leaves the DOM), `sources.js:310` (`#sheet`), epg, hub, rd, tgsearch, yt | Keep the ids `#modal`, `#sheet`. Closing must still empty `#sheet`. |
| `#q` (header search input) | `hub.js:155` | Keep the id. |
| Class names: `panel grid card btn ghost chips chip chiplabel hint msg hlist hrow links settings tag menu tile ic player detail actions hubform input` | all modules | All stay defined. `input` gets its missing rule. |
| CSS variables `--bg --panel --panel2 --text --muted --accent --ring --r --gap` | `player.js:42-43`, `subs.js:490`, epg, sources, telegram, tglogin style blocks | Stay defined as aliases of the new tokens. |
| `html.tv` | `player.js:43`, `style.css` users | Stays the TV switch. |
| `TN.openTitle(type, id)` | `catalog.js:152,338,403`, `hub.js:108`, `sources.js:286`, `telegram.js:263` | Stays; it now navigates to the title page (5.9). `TN.addTitleAction` hooks are still called with an `#acts` element and the same info object. |
| CSP (`index.html:8`) | - | `font-src` falls back to `'self'`: no web font from a CDN. Icons are an inline SVG sprite (no new file, no `sw.js` change). `style-src 'unsafe-inline'` already allows the modules' style blocks. |
| Ownership (`MODULES.md:16`) | - | Everything below is WP-0 work in `app.js`, `index.html`, `style.css`, `i18n.js`, `version.js`. `sw.js` needs one small change in step 8 (WP-3's file). `player.js` changes in step 7 are WP-5's. |

`TN` is frozen in `app.js:1095`; adding members there is backwards compatible.

---

## 3. Design tokens

All values are CSS custom properties on `:root`. Old names stay as aliases.

### 3.1 Colour

| Token | Dark | Light | Use | Alias for |
|---|---|---|---|---|
| `--bg` | `#0b0d12` | `#f4f5f8` | page | `--bg` |
| `--s1` | `#141821` | `#ffffff` | cards, rail, sheets | `--panel` |
| `--s2` | `#1c2230` | `#e9ecf2` | raised / hover, chips, inputs | `--panel2` |
| `--s3` | `#262d3d` | `#dde1ea` | pressed, selected rows | - |
| `--line` | `#2e3648` | `#d5dae3` | decorative dividers | - |
| `--line-strong` | `#667189` | `#7b8494` | boundaries of inputs, chips, switches (3:1) | - |
| `--text` | `#eef1f6` | `#141821` | main text | `--text` |
| `--text2` | `#aab3c4` | `#4a5364` | secondary text | - |
| `--text3` | `#8d97a8` | `#5d6676` | captions, counts | `--muted` |
| `--accent` | `#e2b13c` | `#e2b13c` | filled primary buttons, selected chip, progress | `--accent` |
| `--on-accent` | `#14110a` | `#14110a` | text on `--accent` | - |
| `--accent-text` | `#e2b13c` | `#7a5600` | links, active nav label, icons in accent | - |
| `--focus` | `#e2b13c` | `#7a5600` | the one focus ring | `--ring` (now solid) |
| `--danger` | `#ff7b72` | `#b3261e` | errors, destructive | - |
| `--ok` | `#4cc38a` | `#1a7f4b` | watched, connected | - |
| `--live` | `#c62828` | `#c62828` | LIVE badge background (white text) | - |
| `--scrim` | `rgba(0,0,0,.7)` | same | under text on artwork, behind sheets | - |

Computed contrast (WCAG): dark `--text`/`--bg` 17.2, `--text2`/`--bg` 9.2, `--text2`/`--s2` 7.5, `--text3`/`--s1` 6.0, `--text3`/`--s2` 5.4, `--line-strong`/`--bg` 4.0, /`--s1` 3.6, /`--s2` 3.3, `--accent`/`--s2` 8.0, `--on-accent`/`--accent` 9.5, `--danger`/`--s1` 7.0, `--ok`/`--s1` 8.0, white/`--live` 5.6. Light: `--text`/`--bg` 16.3, `--text2`/`--bg` 7.1, `--text3`/`--bg` 5.3, `--line-strong`/`--s1` 3.8, /`--bg` 3.5, `--accent-text`/`--s1` 6.7, /`--bg` 6.1, /`--s2` 5.6, `--danger`/`--s1` 6.5, `--ok`/`--s1` 5.0. White text on the 70 % scrim over a white picture: 8.5.

Theme switching stays as today (`data-theme` on `<html>`, `prefers-color-scheme` when "auto", `style.css:2,41`), plus `color-scheme: dark` / `light` on `:root` and a `theme-color` meta updated in `applyCfg()`. One accent, no gradients on surfaces, no textures (principle C).

### 3.2 Type

Font stack (no download, Hebrew and Cyrillic covered by every platform's UI font):
`system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Hebrew", "Noto Sans", Arial, sans-serif`. Weights 400, 600, 700 only (Rule 4). Line height 1.25 for headings, 1.5 for body text, 1.3 for two-line card titles.

| Token | Phone / tablet / desktop | TV (design px on a 1920 canvas) | Use |
|---|---|---|---|
| `--fs-1` | 12 px | 24 | captions, badges, counts |
| `--fs-2` | 14 px | 26 | secondary text, card subtitle, chips |
| `--fs-3` | 16 px | 28 | body, buttons, card title, inputs |
| `--fs-4` | 20 px | 34 | row titles (`h2`), sheet titles |
| `--fs-5` | 26 px | 44 | page title (`h1`) |
| `--fs-6` | 36 px (phone 28) | 60 | hero title, detail title |

Six sizes, steps of at least 1.15-1.3 (Rule 3). On TV `html.tv{font-size:calc(100vw / 120)}` makes 1 rem = 16 px of a 1920-wide canvas, and every TV size and space is written in rem (28 px = 1.75 rem), so a TV browser that reports 1280 or 960 CSS px shows the same physical layout.

### 3.3 Space, radius, elevation, motion, layers

- Space (4 px base): `--sp-1` 4, `--sp-2` 8, `--sp-3` 12, `--sp-4` 16, `--sp-5` 24, `--sp-6` 32, `--sp-7` 48, `--sp-8` 64. Old `--gap` = `--sp-4` (TV: 40 px, Rule 11).
- Radius, two values (Rule 14): `--r-s` 8 px (buttons, chips, inputs, badges, thumbnails), `--r` 14 px (cards, panels, sheets, hero). Circles only for avatars and round icon buttons.
- Elevation: `--e1` `0 1px 2px rgba(0,0,0,.4)` (cards on light), `--e2` `0 8px 24px rgba(0,0,0,.5)` (menus, suggestion list, toasts), `--e3` `0 24px 64px rgba(0,0,0,.6)` (sheets). No shadow on text.
- Motion: `--t-fast` 120 ms (press, hover), `--t` 200 ms (focus, chips, rail), `--t-slow` 320 ms (sheet, page fade); easing `cubic-bezier(.2,0,0,1)`; no bounce (Rule 22). `prefers-reduced-motion`: durations 0, skeleton shimmer off, JS scrolling `behavior:'auto'`.
- Layers: content 0, sticky row headers 5, header 30, rail 30, tab bar 30, mini player 35, suggestion list 40, sheet 50, player 60, toasts 70.
- Targets: 44 px minimum on touch, 40 px with a pointer, 3.5 rem (56 design px) on TV.

---

## 4. Layout shells

The shell is chosen by `applyCfg()` and written to `<html data-shell="phone|tablet|desktop|tv">`: from the device setting when it is `phone`, `desktop` or `tv` (this finally gives N9 a meaning), else `tv` when the TV test is true, else by `matchMedia` width. CSS is keyed on `[data-shell]`, not on scattered media queries. `html.tv` is still set for the modules.

| Shell | When (auto) | Navigation | Header | Content |
|---|---|---|---|---|
| phone | width < 600 px | Bottom tab bar, 5 items, 56 px + safe-area inset | 48 px bar: page title (or logo on Home), search icon, profile avatar. Hides on scroll down, returns on scroll up. | Gutter 16 px. Poster grid 3 columns (>= 360 px), 2 columns under 340 px; wide cards 2 columns; square 3. Rows peek the next card (2.3 posters visible). Sheets are bottom sheets. |
| tablet | 600-1023 px | Rail, 72 px, icons with small labels | 56 px bar: search field (max 560 px) and profile | Gutter 24 px. Posters min 136 px (4-6 columns), wide min 200 px. |
| desktop | >= 1024 px | Rail 72 px; from 1280 px a labelled rail 232 px | 64 px bar: search field centred (max 640 px), profile chip | Gutter 32 px, content max 1760 px. Posters min 168 px (6-8 columns at 1440), wide min 240 px, square min 150 px. Hero 56 % of the viewport height at most. |
| tv | TV test or device = tv | Rail of icons (6 rem wide) inside the safe area; opens over the content to 20 rem with labels while it holds the focus | None. Search is the first rail item; the profile is the last. | Safe area 6 rem left / right, 3.375 rem top / bottom (96 / 54 px at 1080p, Rule 8). Home and catalogue roots are rows only; grids are 6 columns of posters, 4 of wide cards. Gap 2.5 rem. No footer. |

Grid as a structure (`body` becomes a CSS grid): areas `rail | header / rail | main`; on phone `header / main / tabbar`. The rail is on the inline-start side, so it is on the right in Hebrew and on the left in English and Russian without any extra rule (logical properties everywhere).

Navigation content (all 20 Kodi root items stay reachable, in three groups instead of one wall):

- Primary (rail top, in this order): Home, Search (`hub`), Movies, Series, Live TV, Radio, Telegram.
- My things (rail middle): Favorites, History, Library (`library`).
- More (rail bottom "More" item, opens the page `#/menu`): Search history, Users, Services, Backup, Google Drive, Status, Help, Device, Settings, Download Kodi (`bn`), About. `#/menu` is the present tile menu, restyled as a grouped list; it keeps every key of `MENU` (`app.js:202-204`), so a new Kodi root item needs no shell work.
- Phone tab bar: Home, Search, Live TV, My things (favourites + history page with two tabs), More (`#/menu`). Movies, Series, Radio and Telegram are the first Home rows' "see all" targets and the first four entries of More.
- The profile avatar (active user's initial) opens Users; a dot on it shows the Telegram sync state (`tg.js` panel state: connected, syncing, error).

---

## 5. Components

Each component lists the markup (classes), sizes and behaviour. "New" means a new TN member in `app.js`.

### 5.1 Rail (`<nav id="rail" class="rail" aria-label>`)
Items are `<a class="rail-i" href="#/key" data-p="key">` with `<svg class="ico"><use href="#i-key"></use></svg><span>label</span>`. Active item: `aria-current="page"`, 3 px accent bar on the inline-start edge, icon and label in `--accent-text`, background `--s2`. Collapsed width 72 px (label 11 px under the icon on tablet, hidden on desktop under 1280 px with a `title` tooltip); expanded 232 px. TV: icons only until focused, then it slides over the content with a scrim (`--t`), and closes when the focus leaves. Icons: one inline SVG sprite in `index.html` (24 px grid, 1.75 px stroke, `currentColor`), one symbol per `MENU` key plus play, pause, close, back, search, more, heart, check, warning, cast, pip, subtitles, audio, speed, next, fullscreen, volume.

### 5.2 Tab bar (`<nav id="tabs" class="tabs">`, phone only)
Five `<a class="tab">` items, icon 24 px + label `--fs-1`, height 56 px + `env(safe-area-inset-bottom)`, background `--s1` with a `--line` top border. Active = `--accent-text` + `aria-current`. Hidden while the on-screen keyboard is open (`visualViewport` height drop) and inside the player. The mini player (5.12) sits directly above it.

### 5.3 Header and page head
`<header class="top">`: on phone a title bar; elsewhere the search field and profile. The search form keeps `id="search"`, the input `id="q"`, the list `id="sug"`. The field becomes a combobox: `role="combobox" aria-expanded aria-controls="sug"`, the list `role="listbox"`, rows `role="option"`; Down / Up move inside the list, Enter searches, Escape closes then clears. On phone the search icon opens a full-screen search layer (field + recent searches + suggestions) so the keyboard never covers the list. On TV the same layer is the Search page.

`TN.page(key, title, opts?)` keeps `.pagehead > a.backbtn + h1`. Changes: the back link's default target is the parent of the route (a `PARENT` table: catalog -> movies / tv, search -> hub, users / device / services ... -> menu, else Home), its text is an icon with the visible label only on desktop, and `aria-label` is "Back"; on TV it is hidden (the remote's Back does it) and on phone it is the arrow in the title bar. `page()` also sets `document.title`, the phone title bar text and announces the title in the live region. `opts.actions` puts buttons at the inline end of the head.

### 5.4 Hero (new: `TN.hero({title, meta, text, backdrop, poster, actions})`)
Home and title pages. Backdrop `w1280` (phone `w780`) as `<img>` with `object-fit:cover`, a linear scrim from `--bg` (inline-start and bottom) so text holds 4.5:1 (Rule 20). Content block max 560 px at the inline start: kicker (`--fs-1`, e.g. "Continue watching"), title `--fs-6` (2 lines max), meta line `--fs-2` in `<bdi>` parts, plot 3 lines (`--fs-3`, hidden on phone), actions (primary + two ghost buttons). Height: phone 56vw min 220 px, desktop `min(56vh, 620px)`, TV 45 % of the height. On TV the hero shows the focused card of the row below (text and backdrop swap after 400 ms of rest, no video, principle B). No autoplaying trailers anywhere.

### 5.5 Row carousel (new: `TN.row(title, opts?)` -> scroller element)
Markup: `<h2 class="rowh">title <a class="more" href>see all</a></h2><div class="row" role="list">` (the `h2` is again the previous sibling, as with `section`). The scroller is a horizontal flex container, `overflow-x:auto`, `scroll-snap-type: x proximity`, `scroll-padding-inline` equal to the page gutter, hidden scrollbar, cards `flex: 0 0 var(--card-w)`. Desktop: round previous / next buttons appear on hover at the row's ends (`aria-hidden`, they scroll by 80 % of the width); wheel with Shift and trackpads work natively. TV: no buttons, the focused card is kept at the first slot. Rows of more than 20 items end with a "see all" card. Lazy rows: a row whose data is not loaded shows 8 skeleton cards of the right shape and loads when it comes within one screen (`IntersectionObserver`).

### 5.6 Cards (`TN.card(img, title, sub, onClick, shape, badge, opts?)`)
Unchanged structure: `button.card[.wide|.square|.dim] > span.badge? + div.img + div.t + div.s?`.

| Variant | Class | Picture | Text |
|---|---|---|---|
| Poster | `card` | 2:3, cover | title 2 lines `--fs-3`/600 (phone `--fs-2`), sub 1 line `--fs-2` `--text3` |
| Channel / video | `card wide` | 16:9; logos `contain` with 12 % padding on `--s2`, video stills `cover` (`opts.cover`) | title 1 line, sub 1 line (now / next from EPG) |
| Station / tile | `card square` | 1:1, contain | title 2 lines |
| Landscape with progress (new) | `card land` | 16:9 backdrop, cover, title on a bottom scrim | progress bar 4 px `--accent` at the bottom (`opts.progress` 0..1), sub "S02E05 · 23 min left" |
| Unavailable here | `card dim` | picture at 60 %, text at full contrast, a "Kodi" chip | fixes A5 |

Card surface: none on dark (picture + text on the page, like every streaming app), `--s1` + `--e1` on light. Picture radius `--r`. Text height is no longer fixed; rows align by the picture. Hover (pointer only): picture brightens 8 %, no lift. Focus: the one ring (6.1). Badges: inline-start top, `--fs-1`/700, `--live` for LIVE, `--s3` for others. `opts`: `progress`, `cover`, `href` (renders `<a>` so middle-click / "open in new tab" work), `menu` (items for the context menu: long-press on touch, right-click, the Menu key on TV; at most 7), `key` (stable id for focus restore).

Pictures: `.img` stays a `div` (modules call `TN.paint(el, url)`), but `paint()` stops loading at once: it stores the address, and one shared `IntersectionObserver` (root margin 400 px, both axes) sets the background when the card nears the viewport, after a probe `Image` confirmed it loads; on error the placeholder (icon glyph on `--s2`) stays. Size by shell: posters `w185` on phone, `w342` desktop, `w500` on TV and for 2x screens; `TN.tmdbImg(path, size)` keeps its signature and gains size `'auto'`. `aspect-ratio` gets a padding-top fallback under `@supports not (aspect-ratio:1)` (X1).

### 5.7 Grids, lists, chips
- `.grid`: `repeat(auto-fill, minmax(var(--card-w), 1fr))`; `--card-w` per shell (4). A grid whose cards are `wide` or `square` gets `data-shape` from the view decorator (7, step 3) and uses the matching width, which fixes R2 without touching the modules. `content-visibility:auto` with `contain-intrinsic-size` on grids of more than 60 cards; lists longer than 300 items are rendered in pages of 120 with a sentinel (the pattern `catalog.js:280-284` already uses).
- `.hlist` / `.hrow`: rows 64 px (TV 6 rem), thumbnail 96x54 (16:9) or 48 px square, title + one meta line, an optional trailing action; separators `--line`, no boxes on dark.
- `.chips` / `.chip`: height 36 px (touch 40, TV 3.5 rem), radius `--r-s`, `--s2` with a `--line-strong` border, selected = `--accent` + `--on-accent` + `aria-pressed="true"`. One scrolling line on every shell (wrap only inside sheets); the `.chiplabel` stays at the start.
- `.menu` / `.tile`: the `#/menu` page and the catalogue roots (`catalog.js:205-214`): tiles become a 2-4 column list of 72 px rows (icon in a 40 px rounded square, label, one-line description) on phone and tablet, and 16:10 tiles with an SVG icon on desktop / TV. Emoji passed by modules still render inside `.ic`.

### 5.8 States
- Skeletons: `TN.skeleton(n, shape?)` with shapes `poster` (default), `wide`, `square`, `row`, `detail`; same sizes as the real component; shimmer 1.2 s, off with reduced motion.
- New `TN.state(target, {kind, title, text, action})` with kinds `empty`, `error`, `offline`, `need-key`, `need-login`: an SVG icon (48 px), a title `--fs-4`, one sentence `--text2`, and exactly one focused button (retry, open settings, connect Telegram) - principle D, Rule 23. `TN.empty(gridEl, text)` keeps working and renders the `empty` kind. `.msg` keeps its class for the modules' own texts.
- The built-in pages stop swallowing errors: a rejected fetch gives `error` (or `offline` when `navigator.onLine` is false), an empty answer gives `empty`. A thin banner under the header shows "No connection" while offline.
- `failPage()` (`app.js:1014`) clears the half-drawn view first and uses `TN.state(..., {kind:'error'})`.

### 5.9 Title detail page (new route `#/title/<movie|tv>/<id>`)
`TN.openTitle(type, id)` becomes `TN.go('#/title/' + type + '/' + id)`; the present sheet code moves into `pageTitle()`.

Layout: hero (5.4) with backdrop, poster (desktop / TV only, 220 px), title, meta (`year · runtime · certification · ★ rating · genres` in `<bdi>` parts), plot (expandable), and the actions row `#acts`: primary **Play / Resume** (from the `sources` service when registered; the title hooks of `TN.addTitleAction` run here exactly as today), Trailer (opens the YouTube frame in a sheet only when pressed), Favourite, Internet Archive, and "More" for the rest. Under the hero, sections in this order: Seasons and episodes for series (season chips + the episode list of `catalog.js:405-444`, obtained through `TN.provider('catalog')`; the separate `#/catalog/v=seasons` pages keep working), Sources (when the sources service exposes a list), Cast (row of square cards), Similar (row), Details (original title, languages, links). Phone: poster hidden, backdrop on top, actions as a full-width primary button and an icon row. TV: first focus on Play; Down goes to seasons.

Data: one request `tmdb('/<type>/<id>', {append_to_response: 'videos,credits,recommendations,release_dates|content_ratings,external_ids'})` instead of two. A history entry is written when playback starts, not when the page opens (the Kodi-shaped entry of `app.js:482-484` moves to the Play action; to be agreed with the sync owner, since Kodi may count on it).

### 5.10 Sheet (`TN.modal(html, opts?)`)
Same ids. `#modal` gets `role="dialog" aria-modal="true" aria-labelledby`, a translated close label, a focus trap (Tab and arrows stay inside), focus to `[data-autofocus]` or the first button of the content (the `×` last), and focus back to the opener on close. Opening pushes a history state `{sheet: n}`; Back, Escape, the scrim and `×` all end in the same `closeModal()`; `closeModal()` called by a module pops that state. The body is scroll-locked (`overflow:hidden` + stored scroll position for iOS). Sizes: `opts.size` `s` 420 px, `m` 640 px (default for forms and pickers), `l` 980 px, `player` (5.11); phone: bottom sheet, full width, max height `90dvh`, a drag handle, swipe down to close. For the modules that pass no options, `modal()` looks at the content: a first child `.player` selects the `player` size, anything else `l` as today.

New helpers on the same sheet: `TN.confirm({title, text, ok, danger})` -> Promise<boolean> (replaces the "press again" pattern for deleting a user, clearing history, disconnecting Telegram) and `TN.menu(anchorEl, items)` (context menu: popover on desktop, bottom sheet on phone, centred list on TV).

### 5.11 Player overlay
Stage 1 (shell only, no module change): the `player` size makes the sheet the whole window (`100dvw x 100dvh`, black, no radius); the video area fills it; `.pl_bar` and `.pl_menu` (player.js) are laid over the bottom on a scrim by shell CSS; `×` becomes a Back arrow at the inline-start top inside the safe area; the F1 focus trap is fixed in the key handler (Up / Down always leave the `<video>`; Left / Right seek 10 s when the video has the focus).

Stage 2 (`player.js`, WP-5; `openChannel()` in `app.js:508-534` is replaced by a call to the same service so live and on-demand share one player):

- Layers over the video: top bar (Back, title + episode line, clock on TV), centre (large play / pause; a spinner while `waiting`; on touch, double-tap left / right = 10 s), bottom bar (time, seek bar with buffered range and a time bubble, duration; then play / pause, back 10, forward 10, next episode, volume (not on phone / TV), subtitles, audio, speed, picture-in-picture, AirPlay / cast when available, fullscreen). Live streams: no seek bar, a LIVE chip, channel up / down, now / next from the `epg` service.
- The chrome shows on any input and hides after 3 s of playing (5 s on TV, Rule 29), never while paused, while a menu is open or while the focus is inside it for screen readers (`:focus-within` keeps it).
- Menus (subtitles, audio, speed, quality) are one side panel (inline-end, 360 px; phone: bottom sheet) with radio rows; subtitles and audio are one press from the bar, a choice is the second (Rule 30). Subtitle offset is a stepper row. Subtitle appearance links to the settings of subs.js (Rules 31, 32).
- Keys: Space / K / Enter play-pause, Left / Right 10 s (hold = accelerate), Up / Down volume on desktop and "show info" on TV, F fullscreen, M mute, C subtitles, N next, Escape / Back = close menu, then hide chrome, then leave. TV media keys (`MediaPlayPause`, `MediaTrackNext`, 415, 19, 417, 412) are mapped.
- States: resume is a centred card for 8 s ("Resume from 41:20" focused / "From the start"); autoplay refused -> a large Play button with "Press to start"; error -> message with "Another source" and "Try again" (the present `failed()` texts, `player.js:127-133`); "Next episode" card in the last 30 s with a 10 s countdown that any key cancels.
- Integrations: Media Session metadata and actions, Screen Wake Lock while playing, `screen.orientation.lock('landscape')` on phones in fullscreen (ignored where unsupported), `x-webkit-airplay="allow"`. iPhone: the overlay is used inline; native fullscreen falls back to the system controls (X11).
- hls.js is loaded by the player on first use through `TN.loadScript` with the same pinned version and integrity value now in `index.html:21`; native HLS only when hls.js is not supported (X9).

### 5.12 Mini player (radio, later background audio)
`#radiobar` keeps its id. Height 64 px, above the tab bar on phone, at the bottom of the content column elsewhere (not under the rail). Contents: artwork 44 px, name + country / now playing, play / pause (not only Stop), favourite, close; a 2 px indeterminate line while buffering; an error line with Retry when the stream fails. Media Session for lock-screen control. `main` gets bottom padding equal to the bars that are showing (a CSS variable `--bottom-ui` set by JS), replacing the fixed 84 px of `.foot`.

### 5.13 Toasts (new: `TN.toast(text, {kind, action, ms})`)
`<div id="toasts" role="status" aria-live="polite">` at the bottom centre (above the bars; TV: top inline-end inside the safe area). One line, optional one action ("Undo", "Reload"), 4 s (8 s with an action), at most 3 stacked, `--s3` surface with `--e2`. Uses: favourite added / removed (with Undo), settings saved, user switched, sync result, copy, "new version - reload" (W2), offline / online. Errors that need a decision stay in place (`TN.state`), not in toasts.

### 5.14 Settings and forms
`.settings` becomes a list of groups. Each group: a `--fs-4` heading and a `--s1` panel of rows; a row is label (+ one line of help in `--text2`) at the start and the control at the end; on phone the control drops under the label when it is wider than 40 %. Controls: switch (`<input type="checkbox" role="switch">`, 44x24), segmented control for 2-4 choices (language, theme, device), native `<select>` styled with radius `--r-s` for long lists, text / password / tel fields 44 px high with a visible `--line-strong` border, `dir="ltr"` for keys, phone numbers and codes, an eye button on secret fields, an inline error line in `--danger` with `role="alert"`. The classes `settings`, `row`, `panel`, `input`, `links`, `hint`, `tag` keep working for the modules' own forms (services, backup, gdrive, tglogin). The Settings page gets a sub-navigation (General, Playback and subtitles, Accounts and sync, Data, About) as tabs on desktop and a list on phone / TV. Changes save at once and answer with a toast. The install action moves to a visible "Install the app" row and a one-time Home banner; on iOS the row explains Share -> Add to Home Screen.

### 5.15 Home (`pageHome()`)
1. Hero: the newest unfinished item of the active user (from `store.history()` joined with the `player_resume` points, `app.js:245-267`), else the first trending title, else (no TMDb key) the app's welcome panel with "Add a TMDb key" and "Connect Telegram".
2. Row "Continue watching" (`card land` with progress; started after 2 minutes, removed under 3 minutes left - Rule 28), Play within 2 presses from Home (Rule 27).
3. Rows, each lazy: Favourites, Live now (the `tn` list, EPG "now" as subtitle), Trending movies, Trending series, Popular, Israeli films, Israeli series, Family (definitions from `TN.provider('catalog').roots(m)` and `fetchPage`, `catalog.js:71-108,472`), Radio (favourite or top stations), Recent searches (chips), Telegram (pinned chats, when connected), Classics from the Archive (always available without a key).
4. "All sections": the grouped menu of 4, so nothing of the old home is lost.

Row order and visibility are stored per browser (`TN.put('home_rows')`) and editable in Settings.

---

## 6. Focus and navigation rules

### 6.1 One focus style (Rules 15-17)
`:focus-visible` -> `outline: 3px solid var(--focus); outline-offset: 2px` on every interactive element; nothing else changes on focus. TV adds the second cue: 4 design-px outline, offset 4, and `transform: scale(1.05)` for cards, `1.02` for rows and buttons (never covering a neighbour's text: the 40 px gap takes it). Written as two separate rules (`:focus` for `html.tv` and for browsers without `:focus-visible`, then `:focus:not(:focus-visible){outline:none}`), which fixes X2. `<html data-input="key|pointer|touch">` is set from the last input event; hover styles apply only with `pointer`.

### 6.2 Groups
The key handler works on groups, not on the whole document. A group is the rail, the header, the tab bar, a `.row`, a `.grid`, a `.chips`, a `.hlist`, an `.actions` / `.links` / form block, the hero actions. Unknown module markup falls into an "other" group that uses the old nearest-element search, limited to elements inside the viewport plus one screen.

- Inside a row / chips line: Left / Right (mirrored in RTL by geometry, as today) move to the neighbour; at the start edge the "towards the rail" key enters the rail; at the end edge nothing happens (no wrap).
- Inside a grid: four-way by column index (computed from the first row's item count), not by distance.
- Up / Down between groups: go to the next group in document order whose box is in that direction; land on that group's remembered item (`data-last`), else the item with the largest horizontal overlap with the current one.
- The rail remembers its item; leaving it returns to the content item that had the focus.
- Only rectangles of the two groups involved are read per key press (F3).
- Not handled (the browser's own behaviour): `<select>`, `<textarea>`, `contenteditable`, `input[type=range|number|date]`, radio groups, and text fields while the caret can still move in that direction.
- Scrolling: `scrollIntoView({block:'nearest', inline:'nearest'})` with `behavior:'auto'` on TV and under reduced motion; the scroll padding comes from the measured header and bottom bars (R4).

### 6.3 Back, Escape, history
Order for TV Back keys (10009, 461, `BrowserBack`, `GoBack`), Escape and the browser's Back alike: close the player menu -> close the sheet / player -> close the suggestion layer -> (TV only) move the focus to the rail when it is in the content of a top-level page -> `history.back()`; on Home with nothing open the browser / TV decides (no exit confirmation, Rule 26). Backspace is a Back key only when `data-shell="tv"` and the focus is not in a field (F6). Escape on desktop goes back only from a sheet or layer, never from a page.

### 6.4 Restore (Rule 25)
`route()` keeps, per history entry (an index stored in `history.state`), the scroll position and the focused element's `data-key` (cards) or index path. Going back waits for the page's render promise (`pg.render` already returns one) and then restores both; going forward to a new page scrolls to the top and, when the last input was a key or the shell is TV, focuses `[data-autofocus]`, else the first item of the first content group - never the back link, never a skeleton (F4, Rule 23). Lists that load in pages re-load up to the stored page count before restoring.

### 6.5 Screen readers and semantics
Skip link to `#view`; `main` gets `tabindex="-1"` and the focus after a pointer-driven route change; the live region announces the page title, result counts ("12 results") and loading end; rows are `role="list"` with `role="listitem"` wrappers created by the decorator only where the module's markup allows; icons are `aria-hidden` with text labels beside them or `aria-label` on the button.

---

## 7. Implementation plan

Eight steps; each leaves the site working and can ship alone. "Lines" refer to the present files.

### Step 0 - compatibility and blocker fixes (no visual change)
- `style.css`: split every `:focus-visible` selector list (11, 17, 44, 71, 109, 115, 134) per 6.1; add `@supports not (aspect-ratio:1)` padding fallbacks for `.card .img`, `.card.wide .img`, `.card.square .img`, `.player` (18, 19, 34, 49); solid `background:var(--bg)` before the `color-mix` line and `-webkit-backdrop-filter` (6); `top/right/bottom/left` before each `inset` (30, 55, 105) and physical fallbacks for `inset-inline-*` (22, 33); margins as a fallback for flex `gap` on `.chips`, `.actions`, `.links`, `nav`; `:root{color-scheme:dark}` + light variant; `.input` rule (N8); `-webkit-tap-highlight-color:transparent`.
- `app.js`: key handler 1221-1238: let Up / Down leave `<video>` / `<audio>` (F1), exclude `SELECT`, `TEXTAREA`, `contenteditable` from Backspace-Back and restrict Backspace to TV (F6), Escape per the contract (F7); `modal()` / `closeModal()` (449-458): history state + `popstate` (N5), focus return (F8), scroll lock (R7); iframe focus: a transparent focus sentinel after each player frame and a visible "Back" button in the sheet so a remote can leave (F2); `replaceChildren` and `Object.fromEntries` guards at the top of the file; `applyCfg()` (1136-1146): set `data-shell`, update `theme-color`.
- `index.html`: an inline ES5 check before the deferred scripts that shows a plain "this browser is too old - use the Kodi app" panel when optional chaining or `Promise.allSettled` are missing (X8); `role="dialog"` on `#modal`; translated close label set in `shell()`; `apple-touch-icon` 180 px (new file `icon-180.png`).

### Step 1 - tokens and component restyle (`style.css` rewritten in place)
New file order: 1 tokens (dark, light, TV overrides, aliases) · 2 base and typography · 3 shells · 4 navigation (rail, tabs, header, search) · 5 components (card, grid, row, chips, hlist, tile, panel, btn, forms, tag, badge, states, skeleton) · 6 overlays (sheet, player, toasts, mini player) · 7 pages (home, title, settings, users) · 8 utilities, reduced motion, print. Every class of section 2 stays. Removed: the scattered blocks at 58-65, 81-99, 128-130, 139-140 (replaced by shell sections). No `app.js` change is needed for this step except deleting the footer text use (`shell()` line 1151) and the inline `style="..."` attributes at 489, 497, 504, 513 (replaced by classes `detail one`).

### Step 2 - shell markup and navigation
- `index.html`: body becomes `a.skip`, `svg` sprite (hidden), `nav#rail`, `header.top` (title, `form#search` with `#q` and `#sug`, profile button), `main#view`, `nav#tabs`, `div#radiobar`, `div#toasts`, `div#live` (`aria-live`), `div#modal`. The footer element goes (its legal line moves to About).
- `app.js`: `MENU` (202) gains a group field and the icon becomes a sprite id (emoji kept as a fallback text); `NAV` (205) is replaced by `RAIL` and `TABS`; `shell()` (1147-1153) draws rail, tabs, profile, labels; `markNav()` (1154) sets `aria-current` on both bars using a `PARENT` table; `page()` (402-405) per 5.3; `route()` (1155-1180) sets `document.title`, announces, and no longer draws Home for an unknown key (shows `state` "not found"); new `pageMenu()` registered as `menu`; `i18n.js`: texts `nav_home`, `nav_more`, `nav_mine`, `core_back`, `core_close`, `core_skip`, group names, in he / en / ru.

### Step 3 - view decorator, lazy pictures, rows, states, toasts
- `app.js`: `paint()` (277) becomes lazy with the shared observer and error fallback; `card()` (384-392) accepts `opts`; `section()` (393-400) unchanged in output; new `row()`, `hero()`, `state()`, `toast()`, `confirm()`, `menu()`, `icon()`; `skeleton()` (419-425) accepts a shape; `empty()` (426) renders `state`; a `MutationObserver` on `#view` and `#sheet` (the "decorator") that, for nodes modules add, sets `data-shape` on grids from their first card, adds `data-key` to cards, wraps nothing and moves nothing (so `previousElementSibling` and `querySelector` contracts hold); all of these exported on `TN` (1095-1132) and documented in `MODULES.md`.
- Built-in pages: `browse()` (567-596), `pageLive()` (599-611), `pageRadio()` (612-625), `pageSearch()` (869-898) use `state` for errors instead of `.catch(() => [])`; `pageHistory()` (695-719), `pageUsers()` (722-760), `pageSearchHist()` (1049-1072), `pageSettings()` (864-866) use `confirm()` and `toast()`.
- Search results (`pageSearch` and, by WP-8, `hub.js:186-217`): each source is a row with "see all" (opens that source alone as a grid: `#/search/<q>/src=<name>`), so every source is visible on the first screen (R1).

### Step 4 - Home
`pageHome()` (552-561) rewritten per 5.15; continue-watching selection as a pure function next to `store` (testable); `home_rows` setting; the Home banner for install and for "add a TMDb key".

### Step 5 - title page
New `pageTitle(arg, ctx)` registered as `title`; `openTitle()` (463-493) reduced to a redirect; trailer on demand; hooks run on `#acts`; seasons through the catalog provider; history note moved to Play (after agreement). `histTarget` / `openHistory` (668-694) and `favView` (628-645) keep calling `openTitle`.

### Step 6 - focus engine and TV shell
The function at 1194-1246 is replaced by the group engine of 6.2-6.4 (service worker registration moves out, W4); `route()` stores and restores scroll / focus; TV test (207) extended (`SmartTV`, `VIDAA`, `NETTV`, `Android TV` hints, and a one-time offer of TV mode when the first input is a D-pad key and no pointer event was ever seen); TV shell CSS (rail overlay, safe area, rem canvas); hero-follows-focus on TV.

### Step 7 - player
Stage 1 in `style.css` + `modal()` (size `player`). Stage 2 in `player.js` (WP-5) per 5.11; `openChannel()` (508-534) and `playRadio()` (537-549) call the player service / mini player; hls.js removed from `index.html:21` and loaded on demand; Media Session; `subs.js` keydown (522) reconciled with the player's key map.

### Step 8 - settings, PWA, accessibility pass
`pageSettings()` (838-868) per 5.14; `drawTgBox()` (805-816) inside the "Accounts and sync" group; `manifest.webmanifest`: `id`, `shortcuts` (Search, Live TV, Favourites), `screenshots` (phone + wide), `categories`, `display_override`; `sw.js` (WP-3): no `skipWaiting()` until the page asks - the page shows the "new version" toast and posts `SKIP_WAITING`, then reloads on `controllerchange`; `index.html`: `preconnect` to the TMDb hosts; final contrast, bidi (`<bdi>`), target-size and reduced-motion review; `MODULES.md` updated with the new members and classes; `docs/QA_MATRIX.md` gets the checks of section 8.

Dependencies: 0 -> 1 -> 2 -> 3 are in order; 4 and 5 need 3; 6 needs 2 and 3; 7 stage 1 needs 1, stage 2 is independent of 4-6; 8 last. Steps 0 and 1 alone already remove every **A** defect except N1, N2 and V1.

---

## 8. Acceptance checks (to add to the QA matrix)

| Area | Check |
|---|---|
| Phone 360x640, 390x844, landscape | No horizontal scroll; tab bar and mini player never cover content; header <= 48 px; 3 posters per row; sheet closes with the system Back; keyboard does not cover the search list. |
| Tablet 768x1024, 1024x768 | Rail of icons; 4-6 posters; sheets centred. |
| Desktop 1440x900, 1920x1080, 2560x1440 | Labelled rail from 1280 px; 6-8 posters at 1440; hero <= 56 % height; hover only with a pointer; every action reachable with Tab, visible ring. |
| TV 1920x1080, 1280x720 and 960x540 CSS px | Same physical layout at all three; text >= 24 design px; everything inside 96 / 54 px; every control reachable with four arrows + OK + Back; Back order of 6.3; focus restored after Back; a continue-watching item plays within 3 presses. |
| RTL / LTR | Hebrew: rail on the right, rows start on the right, Left / Right keys follow the screen; mixed strings (`S02E05`, years, ratings, phone numbers) read correctly; switch to English and Russian mirrors everything with no reload artefacts. |
| Themes | Dark, light, auto; native controls follow; every text pair of 3.1 measured again in the browser. |
| States | Each list page with the network off (offline state + Retry), with an empty answer (empty state + one action), with a slow network (skeleton of the right shape, no jump). |
| Player | Keys of 5.11; chrome hides in 3 / 5 s; subtitles and audio in <= 2 presses; resume card; autoplay-blocked state on Safari; live failure message; lock-screen controls. |
| Accessibility | Screen reader reads page title on navigation, dialog name, result counts; 200 % zoom without loss; reduced motion stops shimmer and smooth scroll. |
| Performance | Home: no more than about 30 image requests before the first scroll; a 2000-channel list scrolls without stalls; hls.js not requested until something plays. |
| Browsers | Chrome, Edge, Firefox, Safari (macOS, iOS, iPadOS), Samsung Internet, a Samsung TV and an LG TV browser (oldest set available: note its engine version and compare with 1.9), an Android TV browser. |
| Modules | Each of the 30 module pages opens and works unchanged after steps 1, 2, 3 and 6 (the contracts of section 2). |
