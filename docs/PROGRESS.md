# TeleNova - QA / upgrade programme: progress

Updated 2026-11-13 03:20, after TeleNova 4.0.4 (published). Percent = steps finished / steps defined for the phase.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROGRESS  ▓▓▓▓░░░░░░░░░░░░░░░░  Overall: 24%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶️ Phase 0 — Map the build                   25%
✅ Phase 1 — Design research                100%
▶️ Phase 2 — Intensive QA                    30%   ← CURRENT
⏳ Phase 3 — Weakness analysis               10%
⏳ Phase 4 — Screen adaptation                0%
⏳ Phase 5 — Redesign and UX                  0%
▶️ Phase 6 — Fix, verify, regress            25%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Extra tracks asked for by the owner
✅ Subtitles: certain detection of Hebrew   100%  (4.0.1)
✅ Set up once, restore everywhere           90%  (4.0.4: setup follows the Telegram account + full export/import;
                                                   restore on a second real device not yet run)
▶️ Finding / checking / verifying links      45%  (4.0.4: StremThru + OpenSubtitles ID, off by default, not run
                                                   with real keys; shortlist items 1-4 open)
✅ One screen for every service             100%  (4.0.4)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIXES IDENTIFIED: 17  |  Fixed: 13 |  Pending: 4
  Critical: 0          High: 8 (7 fixed)
  Medium:  7 (6 fixed) Low:  2 (0 fixed)
```

## Phases and their steps

| Phase | Steps | Done |
|---|---|---|
| 0 Map | structure map · Kodi API check · `docs/ARCHITECTURE.md` · checkers (kodi-addon-checker, xmllint, pyflakes) | pyflakes-style check (`src/qa/undef.py`) and Python 3.8 syntax run on every change; the rest open |
| 1 Research | 10-foot UI · competitors · visual language · UX · player and subtitles · Kodi specifics · Design Rules | `docs/DESIGN_PRINCIPLES.md` (35 rules) |
| 2 QA | functionality · performance · visual · code and security | Telegram playback and search, subtitles, exit; live-profile suites (`qa_live.ps1`) |
| 3 Weaknesses | list · alternatives · decisions | three entered below; `docs/WEAKNESSES.md` not written |
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
| BUG-010 | High | The configuration export carries the Telegram session: two devices online with it can lose the login on both (AUTH_KEY_DUPLICATED) | `configio.py`, `service.config_export` | pending - replaced by the pairing design |
| BUG-011 | Medium | Kodi is slow to exit right after a Telegram film when the AI subtitle server is reading it (the server cannot cancel a job) | `kodi-build\server\nova_subs.py` (outside this repository) | fixed 4.0.2 on our side: the stream server releases its connections, the hub's wait for the server watches the abort flag; exit after a Telegram film = exit when idle (18-20 s) |
| BUG-012 | Medium | A broken request parameter shows a raw error notification to the viewer | `plugin.video.nova/default.py` | pending |
| BUG-013 | Low | First request into a far, never-read region of a very large Telegram file can take 7-15 s (Telegram's side); a second request is sent after 3 s | `tgclient.py` | mitigated |
| BUG-014 | Low | TV channels: the first open of a stream sometimes fails in the demuxer and the retry adds 8-10 s | `service.py` tv retry / stream sources | pending (seen 2026-11-13 01:10) |
| BUG-015 | High | Kodi never closed after Telegram playback (server threads in a socket read Windows does not wake) | \stream.App.shutdown\, \service._post_wait\ | fixed 4.0.2, verified in Kodi |
| BUG-016 | High | Files too heavy for the account's real rate were offered and stalled | \sources.playable\, setting \max_mbit\ | fixed 4.0.2 |
| BUG-017 | Medium | Every bot was asked for every title: one-series and advert bots wasted the search time | \sources.content_bots\ | fixed 4.0.2, tested against the real bots |

## Next

0. Owner asked to come back to the TV channels after the release: more licensed sources (target ~70 channels); 29 play today.
1. Device pairing ("send my setup to another device"): the protocol core with tests, then the two screens, then a test PC -> Android emulator.
2. Link shortlist items 1-4 (`docs/RESEARCH-sources.md`): Real-Debrid refusals, Wizdom signal, Wikidata aliases, runtime gate.
3. Phase 0 leftovers: architecture map, XML checker for the skin (also Phase 4's tool).
4. Owner's decisions: TorBox, StremThru, OpenSubtitles key (see `docs/RESEARCH-sources.md`).
