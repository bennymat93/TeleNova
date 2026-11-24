# TeleNova - structural weaknesses and risks named in the records

Compiled 2026-11-16 from `src/HANDOFF.md` ([HANDOFF <section>]), `README.md` ([README <version>]),
`docs/PROGRESS.md` ([PROGRESS]), the research notes in `docs/` and `src/qa/`. These are the weaknesses the records
themselves name - no new assessment was made, nothing was run. Where the records hold no alternative or no decision,
that is said. (PROGRESS, Phase 3: "three entered below; `docs/WEAKNESSES.md` not written" - this is that file.)

## W-01 Dependence on third-party add-ons that can stall or change (All_Subs, Idan+, plugin.video.youtube)

- **What**: subtitle search, part of the Israeli channels and every YouTube source run through add-ons the project
  does not own.
- **Evidence**:
  - All_Subs is patched in place by `subspatch.py` guards v11-v18 (v14 was withdrawn by v16) [README 3.3.0, 3.3.1,
    4.0.1, 4.0.4]; its loops filled the log with `EXCEPTION: Kodi is not playing` (guard v15) and its search holds
    Python's GIL so menus take 3-4 s during playback [HANDOFF 0.00, 0.0]; it caches the Ktuvit login for about an hour,
    so a change of account takes effect after an hour or a restart [HANDOFF 4.0.4]; Kodi answers "not installed" for
    its capitalised id [HANDOFF 4.0.4].
  - Idan+: the catalogue of Idan+ 4.0.6 is "used up except the four dead ones" [HANDOFF 4.0.2]; 4 of the channels it
    lists did not start [README 4.0.2]; many table entries have Idan+ as their only source [HANDOFF 4.0.2].
  - YouTube: 403 / 429 / "Sorry" after many plays from one IP [HANDOFF 0.00, 0.0, 8]; on a day YouTube bot-checks
    the address the YouTube add-on needs 30-65 s to start any video [`livefail.py` comment, 16/11].
- **Impact**: slow or failed starts, log noise, a channel disappearing when the add-on changes; each All_Subs update
  can invalidate the guards (the records do not say how a guard failure is detected in the field).
- **Alternatives in the records**: the failover chain broadcaster's own stream -> free-playlist streams -> Idan+
  (`live_extra.json`) [HANDOFF 4.0.2]; HLS streams from the broadcasters' own sites instead of YouTube
  [RESEARCH-il-channels 1]; reading play times as labels on our side instead of player calls [HANDOFF 0.00].
- **Decision**: failover chain implemented in 4.0.2; "no more yt: channels until that path is dependable"
  [`livefail.py` comment]. For All_Subs: keep patching by guard - no alternative subtitle add-on is recorded.

## W-02 Features shipped without ever being exercised with a real account / key / device

- **What / evidence**:
  - StremThru - "not exercised with a real key" [README 4.0.4].
  - OpenSubtitles ID - "not exercised with a real key" [README 4.0.4].
  - Ktuvit, own account - "not tested against a real account"; the test vectors prove agreement with a second
    implementation, "not that the server accepts the value" [README 4.0.4; qa/t_ktuvitauth.py].
  - Restore of the synced setup - unit-tested only (it closes Kodi and overwrites the profile); "restore on a second
    real device not yet run" [HANDOFF 4.0.4; PROGRESS].
  - Telegram phone login after the 4.0.6 rewrite - "no real login was run - a test would spend the owner's code
    requests" [README 4.0.6]. HANDOFF 4.0.7 opens with "the user managed to connect to Telegram (4.0.6)" but does not
    say by which way (phone or QR) - unclear whether this covers the rewritten flow.
  - Real-Debrid `infringing_file` - "no real one was observed"; behaviour unit-tested only [HANDOFF 4.0.5].
  - `weblink.open_url` - "not checked visually" (it opens a real browser) [HANDOFF 4.0.4].
  - Physical Android / iOS / Mac devices - clipboard paths, CommonCrypto, device recognition, `libtnige.so` ran on
    emulators or not at all [README 3.3.2; HANDOFF 0.0000, 4.4]; on Android `RenderCapture` may return a black frame,
    leaving only the file-name hint for burned-in subtitles [HANDOFF 4.0.1].
- **Impact**: the first real use is the first test; a failure would show at the viewer's device.
- **Alternatives in the records**: none beyond "needs a real account / the devices" [HANDOFF 0.00].
- **Decision**: StremThru, OpenSubtitles and Ktuvit-own-account were integrated **off by default** on the owner's
  decision [HANDOFF 4.0.4]. For the rest: undecided (listed as open in each log section).

## W-03 The synced setup file is obfuscated, not strongly encrypted

- **What**: the setup kept in the account's Saved Messages is sealed with a key derived from the account id.
- **Evidence**: "disguise, not protection - the protection is the account itself" [HANDOFF 4.0.4]. The README calls
  the file "sealed" [README 4.0.4]. It holds settings, keys and service logins (not the Telegram login) [README 4.0.4].
- **Impact**: anyone who can read the account's Saved Messages can read the keys and service logins in it; Telegram
  cloud chats are not end-to-end encrypted [RESEARCH-device-transfer 5].
- **Alternatives in the records**: encrypt on the device and protect with a short PIN (PBKDF2, high iteration count)
  [RESEARCH-device-transfer, fallback design]; the LAN pairing with a 6-digit comparison code as the primary route
  [RESEARCH-device-transfer, chosen design].
- **Decision**: shipped in 4.0.4 without a PIN, off until switched on; no decision about adding the PIN is recorded -
  **undecided**. Note: RESEARCH-device-transfer still ends with "Design only. Nothing of this is implemented yet",
  which predates 4.0.4.

## W-04 The full export carries the Telegram session (BUG-010)

- **What**: the `.tncfg` export / "export with everything" copies the Telethon session file.
- **Evidence**: [PROGRESS BUG-010]; "the session file must never be copied" [RESEARCH-device-transfer 2];
  "export / import with everything (the Telegram login too)" still offered on three screens [README 4.0.4].
- **Impact**: two devices online with one session -> `AUTH_KEY_DUPLICATED`, the session is invalidated on the server
  and both must log in again [RESEARCH-device-transfer 2].
- **Alternatives in the records**: transfer api_id / api_hash and mint a session per device; LAN pairing where the
  configured device accepts the new device's login token (`auth.acceptLoginToken`); fallback: scan the new device's
  QR with the phone [RESEARCH-device-transfer].
- **Decision**: "pending - replaced by the pairing design" [PROGRESS]; pairing is "less urgent now that the setup
  syncs through the account" [HANDOFF 4.0.4]. Not implemented.

## W-05 The PC subtitle server lives outside the repository

- **What**: `nova_subs.py` and `live_restream.py` run on the owner's PC from a folder that is not in this repository.
- **Evidence**: the server "has no way to cancel a job; it keeps downloading the film after playback stopped"
  [README 4.0.0; PROGRESS BUG-011]; in 4.0.8 it was "patched on the owner's PC with dated copies next to them"
  [README 4.0.8]; `mtrans.py` was copied into the server's add-on folder because the server imports from there;
  two supervisors and two servers (venv and uv) are running - "existing state, not touched" [HANDOFF 4.0.8]; its
  ffmpeg opens the same film and downloads all of it next to the picture [README 4.0.0].
- **Impact**: no version history or tests for the server; a second copy of `mtrans.py` can drift from the add-on's;
  server load competes with playback on a rate-limited Telegram account; slow Kodi exit (mitigated on our side only).
- **Alternatives in the records**: none for the server itself. Our-side mitigations: the stream server gives a
  non-player reader only what the player leaves over [README 4.0.0]; `service._post_wait` [HANDOFF 4.0.2].
  Related, deliberately not implemented: trusting a subtitle server discovered automatically on the network (the
  Gemini key is sent over HTTP) [HANDOFF 8].
- **Decision**: **undecided** (the records say only "not touched" / "outside this repository").

## W-06 No licensed source for pay channels - 36 channels against a goal of about 70

- **What**: the owner wants about 70 Israeli channels like another build; 36 have licensed sources.
- **Evidence**: "there is no legal way to 70: the public lists are exhausted, the rest are restreams of pay
  channels" [HANDOFF 4.0.6]; "paid cable and satellite channels have no licensed free source and stay out"
  [README 4.0.2]; everything else in the public iptv-org lists is a third-party restream or a pay channel
  [RESEARCH-il-channels 6].
- **Impact**: the owner's target cannot be met with what was found.
- **Alternatives in the records**: 30 official YouTube channels that were not live at night - "recheck in the
  daytime" [RESEARCH-il-channels 5b], `qa/yt_channels_check.py` logs which are live (one run so far: 4 live
  [qa/yt_channels_log.tsv]); 9 official audio-only HLS streams that "may fit a radio section"
  [RESEARCH-il-channels 2]; Musawa HLS (returned 403 on a recheck [HANDOFF 4.0.6]); two live channels whose ownership
  was not proven [RESEARCH-il-channels 5a].
- **Decision**: pay channels stay out; add only what broadcasts around the clock [HANDOFF 4.0.6]; no more `yt:`
  channels for now (see W-01). PROGRESS "Next" still says "29 play today" - stale against 33 [README 4.0.3] and 36
  [README 4.0.6].

## W-07 Telegram's limits for non-Premium accounts

- **What**: the account is held to an average rate, and code requests per number are limited.
- **Evidence**: an unread part arrives at about 4.3 MB/s "whatever is done"; faster reads are answered with
  `FLOOD_WAIT` (1-3 s without a byte) [README 4.0.0]; "a 4K remux of tens of GB needs more than the ~36 Mbit/s a
  non-Premium account gets" [README 4.0.0]; first read of a far region 7-15 s [PROGRESS BUG-013]; a number is blocked
  after a few code requests [README 4.0.6]; repeated test reads "warm" a region and produce flood waits an ordinary
  viewer hardly sees [HANDOFF 4.0.0].
- **Impact**: heavy files cannot play from Telegram; the PC subtitle server's parallel download shares the same rate;
  QA measurements can mislead.
- **Alternatives in the records**: self-imposed pace (starts at 4.5 MB/s, lowered by a flood wait) [README 4.0.0];
  hide Telegram files above 80 % of the measured rate, `max_mbit` for other sources [README 4.0.2]; Real-Debrid as
  the second source group [README 3.3.2]; QR login is not affected by a code block [README 4.0.6].
- **Decision**: pacing (4.0.0) and hiding heavy files (4.0.2) implemented. The records do not discuss Premium as an
  option.

## W-08 The QA programme is partly done (phases 0, 2-6)

- **What**: the owner's seven-phase QA / upgrade programme.
- **Evidence**: overall 24 %: Phase 0 25 %, Phase 1 100 %, Phase 2 30 %, Phase 3 10 %, Phase 4 0 %, Phase 5 0 %,
  Phase 6 25 % [PROGRESS]; "QA phases 0, 2-6" listed as open in [HANDOFF 4.0.2, 4.0.4, 4.0.5]. Phase 0 leftovers:
  architecture map, Kodi API check, kodi-addon-checker, xmllint for the skin [PROGRESS]. The 35 binding design rules
  exist [DESIGN_PRINCIPLES] but screen adaptation and redesign have no step done; skin changes were checked in a 4:3
  window only, not at 16:9 or during playback [README 3.3.3].
- **Impact**: no systematic visual / multi-resolution / RTL check; the skin's XML is not machine-checked (six files
  are formally invalid [HANDOFF 8]).
- **Alternatives in the records**: the checker tools named for Phase 0 and Phase 4 [PROGRESS].
- **Decision**: open; feature requests of the owner were taken first (4.0.2-4.0.8). The board itself was last
  updated "after 4.0.5" and does not reflect 4.0.6-4.0.8.

## W-09 Repository size: a build package is committed with every release

- **What**: each release replaces `build/TeleNova-<version>.zip.part0` and the add-on zips under `repo/` in git.
- **Evidence**: the build package is one file of 99 MB [README 3.3.0]; parts must stay under GitHub's 100 MB limit
  [README 3.1.0]; nine releases 4.0.0-4.0.8 were published within one day [HANDOFF]. **The figure "about 165 MB of
  history per release" is not written in any of the sources read** - it is taken from the brief for this document and
  is unverified here (no git command was run).
- **Impact**: (not stated in the records) clone size and hosting limits grow with every release.
- **Alternatives in the records**: none.
- **Decision**: **undecided** - the records are silent.

## W-10 Encrypted owner profiles in a public repository

- **What**: `preset.nvp` / `build.nvp` (47 MB, encrypted with the owner's password) ship in the build.
- **Evidence**: "they are in a public repository and open to offline password guessing; they may contain the owner's
  Google Drive token (new backups no longer include it)" [HANDOFF 8].
- **Impact**: exposure of whatever the profiles hold if the password is guessed.
- **Alternatives in the records**: `src/tools/nvp_clean.py` removes content from them (asks for the password), then
  repackage [HANDOFF 8; README 3.3.0].
- **Decision**: kept in the build at the owner's request [HANDOFF 8].

## W-11 Keys sent to third-party services

- **What / evidence**: the Real-Debrid key is part of the Torrentio address (option `rd_torrentio_key` avoids it)
  [README 3.3.2; HANDOFF 4.0.5]; a StremThru cache check sends the Real-Debrid token to that instance
  [RESEARCH-sources; README 4.0.4]; Real-Debrid has begun to refuse some cached files [RESEARCH-sources].
- **Impact**: the key is known to the index / instance operator; one resolver only.
- **Alternatives in the records**: self-host StremThru; check the cache through Real-Debrid itself at play time;
  TorBox as a second resolver (paid) [RESEARCH-sources].
- **Decision**: StremThru integrated, off, the viewer is told before switching it on; hashed link names only in
  `rd_dead.json` [HANDOFF 4.0.5]; TorBox - "not answered, not integrated" [HANDOFF 4.0.4].

## W-12 Limits of Kodi itself and of the skin

- **What / evidence**: a play / stop command during the "busy" dialog can freeze Kodi (also in 3.2.0)
  [README 3.3.1]; the JSON-RPC channel is blocked while a modal dialog opened from a directory call is open
  [HANDOFF 8]; one PAPlayer crash [HANDOFF 0.000000]; FENtastic logs `Misplaced ]` and has six formally invalid XML
  files [HANDOFF 8]; about 8 s in "Stopping all" at exit, not investigated [HANDOFF 4.0.2]; the skin is changed by
  patching its files at start (`skinpatch.py`), a skin file change loads only after a restart or `ReloadSkin()`
  [HANDOFF 3.3.3].
- **Impact**: rare freezes reachable from remote-control apps; some screens cannot be tested automatically.
- **Alternatives in the records**: none (the freeze was isolated to Kodi's core after 4-5 runs per state).
- **Decision**: not fixed, documented as known limits [README 3.3.1].

## W-13 The QA environment is the owner's live Kodi

- **What / evidence**: `qa_all.ps1` deletes the Kodi profile, logins included - "do not run it"; `qa_live.ps1`
  replaces it [HANDOFF 3.3.3]; the owner uses Kodi during the work [HANDOFF 3.3.3]; a live check left a keyboard open
  for 5+ minutes [HANDOFF 4.0.8]; the engine's `debug` setting was changed temporarily during work [HANDOFF 4.0.0];
  the stage folder the build is packed from was a session's temporary folder [HANDOFF 3.3.3, 0.1]; several older test
  scripts hold absolute paths of an old temporary folder [qa/t_subs.py, qa/agentA/t.py].
- **Impact**: a QA run can disturb or damage the only configured installation; fresh-install checks have not been
  reported since the accounts were connected (last: build 3.3.2 [HANDOFF 0.000000]).
- **Alternatives in the records**: `qa/deploy_local.py` (copies changed files without touching accounts)
  [HANDOFF 4.0.2]; `qa/android_qa.ps1` on an emulator [HANDOFF 0.00000]; a profile backup of the account files
  [HANDOFF 3.3.3].
- **Decision**: `qa_live.ps1` is the standing rule; no separate test machine / account is recorded.

---
Entries: 13. With a recorded decision: W-01, W-02 (partly), W-04, W-06, W-07, W-10, W-11, W-12, W-13. Undecided or
silent: W-03 (PIN), W-05, W-08 (open), W-09.

## Status on 2026-11-24 (TeleNova 6.0.1: Kodi add-ons, web, Android, iOS, Mac)

Re-checked against the code and the releases since 4.0.x. The entries above stay as written (history); this table
says where each one stands now, and W-14 - W-18 are weaknesses that appeared with the newer parts.

| ID | Now | Evidence / what is left |
|---|---|---|
| W-01 | open, mitigated | failover chain since 4.0.2; 91 channels play (29 Israeli + 62 world, 4.3.0); All_Subs still patched by guard |
| W-02 | open | still not run with real accounts: Xtream, OpenSubtitles key, StremThru, real Telegram sign-in on the apps, physical iPhone / iPad / Mac / Android phone; the apps were checked on emulators / simulators / CI only |
| W-03 | **superseded** | the password backup (`.tncfg`) and All in one are sealed with PBKDF2-SHA256, 310 000 rounds, from the owner's password (`aio.py`, `web/aio.js`); the old account-id seal is only read, not written |
| W-04 | **fixed 4.2.0** | BUG-010: no Telegram session in any file; each device signs in itself (pairing / linked sign-in, `linklogin.py`) |
| W-05 | open, smaller | server still outside the repository; it now answers only with a token over an https tunnel (no Gemini key over plain http); still needs the owner's PC on |
| W-06 | decided | pay channels stay out; owner's decisions pending on Al Jazeera, Russian state channels, the 7 FAST feeds |
| W-07 | open, by design | pacing + hiding heavy files; Premium not considered |
| W-08 | partly closed | Phase 3 = this file. Phase 4/5: web 6.0 design pass (measured at 375 px and 1280 px: no control above 12 % of the phone screen, shortcut buttons removed, compact tiles), Kodi menus aligned in 6.0.1. Not done: the skin itself (16:9 / playback / RTL check, its six invalid XML files) |
| W-09 | open, larger | every release now also commits the APK (8.4 MB), IPA (8 MB) and Mac zip (8.5 MB) besides the 100 MB build; no decision on Git LFS / releases-only hosting |
| W-10 | decided | kept at the owner's request |
| W-11 | open | TorBox still not decided |
| W-12 | open | plus: Kodi on this PC looped on audio errors (DirectSound "default" device not found) - fixed 20/11 by pointing it at the Realtek speakers through WASAPI; WASAPI exclusive can silence other programs while Kodi plays |
| W-13 | open | still the owner's live Kodi; `deploy_local.py` + `qa_live.ps1` only |

## W-14 All in one lives in one place and behind one password

- **What**: one user name + password fetch the full setup from the helper Worker's KV (`/aio`).
- **Impact**: a weak password can be guessed offline by anyone who obtains a vault id; the Worker / KV / Cloudflare
  account is a single point - if it is lost, All in one is lost (the password backup file still works).
- **In place**: PBKDF2 310 000 rounds, the id and the key come from the same derivation (the server never sees the
  password), 20 wrong tries per hour per IP.
- **Alternatives**: a second copy of the vault on Google Drive; a longer password rule. **Decision**: owner's.

## W-15 The AI subtitle server is reachable only while the PC is on, through a quick tunnel

- **What**: `tunnel.py` opens a Cloudflare quick tunnel whose address changes with every start and publishes it to
  the Worker.
- **Impact**: apps away from home get AI subtitles only when the PC is on; a restart leaves a few seconds with a stale
  address.
- **Alternatives**: a named tunnel (fixed address, needs a domain on Cloudflare). **Decision**: open.

## W-16 Unsigned apps

- **What**: the iOS IPA is unsigned (needs the owner's signing), the Mac app is ad-hoc signed (Gatekeeper asks
  "Open anyway" the first time), the Android APK is self-signed (outside Play).
- **Impact**: harder installation; iOS sideloaded apps expire with the signing certificate.
- **Alternatives**: Apple Developer account (paid) / TestFlight; Play Store. **Decision**: owner's (money).

## W-17 Versioned download links rot

- **What**: pages linked `ios/TeleNova-Web-5.1.0.ipa` after the file was replaced - the owner got a 404 (20/11).
- **Fixed**: links updated; the iOS / Mac release now rewrites every versioned link (guide, README, DOWNLOADS,
  `ios/`, `mac/`) in the same commit. Android uses a fixed name (`apk/TeleNova.apk`).
- **Check (24/11)**: `src/qa/t_links.py` - every local link on the site's pages and docs must point at a file in the
  repository (33 links); it is in the HANDOFF test list, run before every push.

## W-18 The records drift from the code

- **What**: PROGRESS listed the web player for every file type and slow-connection playback as "not started" after
  both had shipped (5.1); the board percentages were last set at 4.3.0.
- **Impact**: another session may redo finished work or skip open work.
- **In place**: HANDOFF "IN PROGRESS" is updated with every release. **Left**: PROGRESS board updated 24/11 with this
  file.

---
Entries: 18. Closed or superseded: W-03, W-04. Owner's decision needed: W-06 (channels), W-11 (TorBox), W-14,
W-16. Open technical work: W-08 (skin), W-09, W-15.
