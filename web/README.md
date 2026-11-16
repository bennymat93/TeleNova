# BN Stream Web (TeleNova in the browser)

Static site: `index.html`, `app.js`, `style.css`, `sw.js` (offline cache), `manifest.webmanifest`.

| File | What it is |
|---|---|
| `app.js` | the app: catalogue (TMDb through the viewer's / household's key, or Internet Archive), the build's Israeli channels, free iptv-org channels, radio, favourites, history, search history with suggestions, users |
| `store.js` | users and each user's lists, in the same shapes the Kodi build writes (`users.py`, history, favourites, `searchhist.py`) |
| `syncdoc.js` | the build's sync document (`syncdoc.py`) in JavaScript - merges to byte-identical text |
| `sealed.js` | opens / seals the build's sealed files (`configio.py`) |
| `websync.js` | the continuous sync loop (the build's `autosync.cycle`) |
| `tg.js` | Telegram connection, loaded only when the viewer connects; pairing link `#pair=` from the build's QR code |
| `channels_il.json` | generated from `livefail.py` by `src/qa/web/gen_channels.py` - never edit by hand |
| `vendor/gramjs-2.26.21.min.js` | GramJS (npm `telegram` 2.26.21, MIT) bundled by `src/qa/web/build_gramjs.py` |

## The GramJS bundle

It holds the Telegram session, so it is served from this site, not from a CDN that may regenerate it.

Verified on 2026-11-16: rebuilding it with `python src/qa/web/build_gramjs.py` (official npm package `telegram@2.26.21`,
`esbuild@0.25.10`) gives a byte-identical file:

```
sha256 8264a5205486f997fa0420b116d3e837900a0f5fc8deec41832ab732079e27e4   730107 bytes
```

## Tests

`python src/qa/web/run_web_tests.py` (Python 3 + Node 18+): sync document and sealed files against the build's own
Python code in both directions, users / lists / sync loop, Kodi devices and browsers on one account, texts in
he / en / ru, service-worker file list. Ends with `WEB TESTS OK`.

Not covered by the tests: connecting a real Telegram account in a real browser.
