# TeleNova - QA / upgrade programme: progress

- 2026-11-27: TeleNova 6.6.0 (V6.6) released (was planned as 6.5.1): Telegram connection supervisor (web + Kodi), player start fixes and a new symmetric toolbar, compact link sheet, shared progress percent + time left (web/progress.js, Kodi tnprogress.py), 67 UX / performance fixes, V6.6 guide section. Next (owner, on a device): airplane mode during playback, long background, Wi-Fi to mobile switch, QR sign-in, the new toolbar look.
- 2026-11-19: BN Stream for Mac 6.0.1 released (`mac/BN-Stream-macOS-6.0.1.zip`, release `mac-6.0.1`, page `mac/`): universal, macOS 12+, desktop layout, built-in helper, open/save panels, Google sign-in sheet; checked on the CI runner (service worker, helper, Real-Debrid code, HLS playback, download saved, no cut at 760x560 and 1600x1000). Not checked: the file-open panel (needs a real click) and real sign-ins.

Updated 2026-11-18 19:40, after TeleNova 4.3.0 (web version 5.0, 62 tested world channels - 91 play, paged Telegram search, media flags, TV failure log, architecture map; OpenSubtitles key test and AI subtitle server fixed). Earlier: 4.2.9 (web pairing by QR, resume points in the sync document, login QR drawn on the device, web modules + EPG job committed). Earlier: 4.2.8 (QA + display review). Per-version detail: README.md; defects: docs/BUGS.md; coverage: docs/QA_MATRIX.md.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROGRESS  ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░  Overall: 55%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Phase 0 — Map the build                  100%
✅ Phase 1 — Design research                100%
▶️ Phase 2 — Intensive QA                    30%   ← CURRENT
✅ Phase 3 — Weakness analysis              100%  (docs/WEAKNESSES.md, status 24/11)
▶️ Phase 4 — Screen adaptation               40%  (web: 375 / 1280 px measured, 6.0; skin not yet)
▶️ Phase 5 — Redesign and UX                 50%  (web + apps 6.0 design pass, Kodi menus 6.0.1)
▶️ Phase 6 — Fix, verify, regress            45%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Extra tracks asked for by the owner
✅ Subtitles: certain detection of Hebrew   100%  (4.0.1)
✅ Set up once, restore everywhere          100%  (4.1.0: users + continuous sync, verified live with a second
                                                   stand-in device against the real account)
▶️ Finding / checking / verifying links      80%  (4.0.4: StremThru + OpenSubtitles ID, off by default, not run
                                                   with real keys; shortlist 1-10 done, 5 and 9 not yet run on the real account)
✅ One screen for every service             100%  (4.0.4)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIXES IDENTIFIED: 29  |  Fixed: 28 |  Pending: 1
  Critical: 0          High: 11 (11 fixed)
  Medium:  9 (8 fixed) Low:  2 (0 fixed)
```

## Phases and their steps

| Phase | Steps | Done |
|---|---|---|
| 0 Map | structure map · Kodi API check · `docs/ARCHITECTURE.md` · checkers (kodi-addon-checker, xmllint, pyflakes) | pyflakes-style check (`src/qa/undef.py`) and Python 3.8 syntax run on every change; the rest open |
| 1 Research | 10-foot UI · competitors · visual language · UX · player and subtitles · Kodi specifics · Design Rules | `docs/DESIGN_PRINCIPLES.md` (35 rules) |
| 2 QA | functionality · performance · visual · code and security | Telegram playback and search, subtitles, exit; live-profile suites (`qa_live.ps1`) |
| 3 Weaknesses | list · alternatives · decisions | `docs/WEAKNESSES.md`: 18 entries with status 24/11 |
| 4 Screens | `<res>` entries · relative layout · safe area · text overflow · RTL · checker tool · screenshots | - |
| 5 Redesign | design system · focus · home · states · OSD · performance · 2-3 directions | - |
| 6 Fix | by severity · tests · regression · fresh-eyes review | fixes below, each with a test |

## Fix list

| ID | Sev. | What | Where | Status |
|---|---|---|---|---|
| BUG-001 | High | Telegram stream froze 1-3 s again and again (flood waits caused by uncounted cancelled requests) | `tgclient.py` pacing | fixed 4.0.0, verified in Kodi |
| BUG-002 | High | Picture took 5-10 s to return after a jump and stuttered after it (old connections and the subtitle server's ffmpeg shared the stream) | `stream.py` | fixed 4.0.0, verified in Kodi |
| BUG-003 | High | Engine never read the build's TMDb token: titles searched by their English name only | `service.py`, `router.py` | fixed 4.0.0 |
| BUG-004 | High | Global Telegram search returns the newest hits only: files in the user's own chats were not found | `sources._deep` | fixed 4.0.0 |
| BUG-005 | Medium | Every search waited 6-16 s for a Gemini model that did not answer | `gemini.py`, `sources.py` | fixed 4.0.0 |
| BUG-006 | Medium | Source list made before the Telegram login was served after it | `sources.find` cache key | fixed 4.0.0 |
| BUG-007 | Medium | A request in flight could be dropped half-way by Python's garbage collector | `tgclient._spawn` | fixed 4.0.0 |
| BUG-008 | High | "Hebrew" label trusted blindly: mislabelled / empty / broken tracks stopped the subtitle search; unlabelled Hebrew tracks were missed | `subprobe.py`, `service.py`, guard v17 | fixed 4.0.1, verified in Kodi |
| BUG-009 | Medium | Burned-in Hebrew subtitles not recognised: a second subtitle was fetched on top | `hardsub.py` | fixed 4.0.1, verified in Kodi |
| BUG-010 | High | The configuration export carries the Telegram session: two devices online with it can lose the login on both (AUTH_KEY_DUPLICATED) | `configio.py`, `service.config_export` | fixed 4.2.0: no session in the file, an old file's session is ignored; pairing gives each device its own login |
| BUG-011 | Medium | Kodi is slow to exit right after a Telegram film when the AI subtitle server is reading it (the server cannot cancel a job) | `kodi-build\server\nova_subs.py` (outside this repository) | fixed 4.0.2 on our side: the stream server releases its connections, the hub's wait for the server watches the abort flag; exit after a Telegram film = exit when idle (18-20 s) |
| BUG-012 | Medium | A broken request parameter shows a raw error notification to the viewer | `plugin.video.nova/default.py` | fixed 4.2.7 (ValueError / IndexError quiet too; `qa/t_bug012.py`) |
| BUG-013 | Low | First request into a far, never-read region of a very large Telegram file can take 7-15 s (Telegram's side); a second request is sent after 3 s | `tgclient.py` | mitigated |
| BUG-014 | Low | TV channels: the first open of a stream sometimes fails in the demuxer and the retry adds 8-10 s | `service.py` tv retry / stream sources | improved 4.2.7: the retry waits for the failed player (0.3 s instead of a fixed 2 s); 4.3.0: every failed open is classified from Kodi's log and kept in `tv_fail.json` - read it after real use |
| BUG-015 | High | Kodi never closed after Telegram playback (server threads in a socket read Windows does not wake) | \stream.App.shutdown\, \service._post_wait\ | fixed 4.0.2, verified in Kodi |
| BUG-016 | High | Files too heavy for the account's real rate were offered and stalled | \sources.playable\, setting \max_mbit\ | fixed 4.0.2 |
| BUG-021 | High | After "Log out" the engine could not connect again until Kodi restarted (Telethon client reused after log_out closed its session) | `tgclient.logout`, `reconnect` | fixed 4.2.0, found in the live pairing test |
| BUG-022 | High | QR login could hang (the accepted-update fell between short waits) or fail with LoginTokenMigrateTo (account in another data centre) | `tgclient.qr_wait`, `_qr_settle` | fixed 4.2.0, found in the live pairing test |
| BUG-023 | High | A restore wrote empty values over working keys (an automatic backup from before Telegram was set up wiped api id / hash) | `backup.keep_filled` | fixed 4.2.6 |
| BUG-024 | High | iPad lost touch scrolling / selection: the computer's device profile and skin touch mode came over by backup / sync | `profiles.repair` | fixed 4.2.3 (not yet seen on the iPad) |
| BUG-025 | High | Car box: TMDb unreachable on its network, every list empty | `netfix.py` | fixed 4.2.4 (not yet seen on the box) |
| BUG-026 | Medium | AI subtitle server kept transcribing after the viewer left; crashed once (0xC0000409) at an idle unload | `kodi-build/server/nova_subs.py` (outside) | fixed 4.2.5 / 4.2.7 |
| BUG-027 | Low | Search said nothing when Telegram was not logged in on a device | `router.hub` | fixed 4.2.1 |
| BUG-028 | Medium | OpenSubtitles key test answered "http 400" for a good key (the test sent sixteen zeros as the file hash; the API refuses that value before it looks at the key) | `opensubs.check_key` | fixed 4.3.0 |
| BUG-029 | Medium | AI subtitle server: a source ffmpeg cannot read (403 / expired address) left the job in "ahead" for 30 minutes with no error and no subtitles | `kodi-build/server/nova_subs.py` (outside) | fixed 18/11, verified with a refused address |
| BUG-019 | High | First version of the guide filler replaced real guide ids while one guide source was down (found by the 4.1.2 review) | `iptv.fill_unserved` | fixed before release: ids are never replaced |
| BUG-020 | Medium | First version of the guide filler built ids from Hebrew names that kept only digits: two channels could share a row (review) | `iptv.fill_unserved` | fixed before release: sha1 of the full name |
| BUG-018 | Medium | The free-guide refresh rewrote the TV guide without the build's own rows: 13 channels showed an empty guide again | `iptv.py` free guide apply | fixed 4.1.2 (`livefail.own_rows`, test in `t_epg_xml.py`) |
| BUG-017 | Medium | Every bot was asked for every title: one-series and advert bots wasted the search time | \sources.content_bots\ | fixed 4.0.2, tested against the real bots |

## Last release: TeleNova 4.1.2 (2026-11-16, evening)

| Step | Estimate | State |
|---|---|---|
| TV channels: official direct streams for 9 channels that played only through Idan+, Musawa, logos in the add-on, guide for Kalkala 10 and the subtitled feeds, filler guide rows | done in code | unit tests pass; **bug found and fixed**: the free-guide refresh dropped the filler rows (BUG-018) |
| Telegram engine: quiet mode (bot chats muted, answers marked read), archived chats searched | done in code | 25/25 engine tests |
| Web version 4.2: users / history / favourites / search history shared with the Kodi build, Telegram sync in the browser | done in code | WEB TESTS OK; GramJS bundle rebuilt from npm byte-identical; real Telegram login in a browser not tested |
| Live QA on the owner's profile (`qa_live.ps1`, channel rounds, audit) | done | crawl 167 screens 0 errors; playback 10/11 (Internet Archive film at the 60 s limit, also on 12/11); stress 0; TV rounds 16/16; audit 41/41 logos + guide |
| Package 4.1.2, docs, publish | done | build 100.3 MB in 2 parts |

## 6.1.3 (2026-11-24)
Done: filter links by source (Kodi + web); smooth-on-this-connection-first ordering; web measures the line at each search and auto-tests the top 8.

## 6.5.0 (2026-11-25) - V6.5
Done: sync phase 2 (clock-skew fix via the Telegram server offset, keyed list merges incl. EPG, optional sync passphrase envelope for keys, Kodi sync screen); web V6.5 redesign (elevation / 3D, Lite look, the ⋯ menu); web and Kodi bug fixes; Kodi skin depth patch; Russian Kodi guide. Open: Android / iOS / Mac 6.5 app builds (own sessions); passphrase on two real devices (owner).

## Next

Done 19/11: v6.0 - one version 6.0.0 for Kodi, web and apps; design pass (smaller buttons, less scrolling, shortcut buttons removed).

Owner's instruction (18/11): work economically - targeted tests, no wide fan-out, early local commits.

0. Web player: every file type (MKV / AVI / TS, HEVC, AC3 / DTS) through a fallback engine (`web/compat.js`, since 5.1). Done.
1. Playback on a slow / poor connection, every version: done (Kodi `t_slowwatch.py`, `t_linkspeed.py`; web player buffer / step down).
2. TV channels: 91 play since 4.3.0 (29 Israeli + 62 world). Owner's decisions: Al Jazeera, Russian state channels, the 7 FAST feeds; logos for 54 world channels.
3. Link shortlist items 5 and 9: run against the real account and real files.
4. BUG-014: read `tv_fail.json` after real use.
5. Phases 4-5 left: the skin at 16:9 / during playback / RTL and its six invalid XML files.
6. Owner's decisions: TorBox. OpenSubtitles: the "http 400" was our bug (BUG-028) - test the key again.
7. Needs the owner's devices: iPad touch repair (4.2.3), car box TMDb route (4.2.4), two physical devices pairing + the 2FA step (4.2.0).
