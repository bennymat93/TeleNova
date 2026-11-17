# TeleNova - rules for every session (any account, any machine)

Read `src/HANDOFF.md` section "התחל כאן" first, then `docs/PROGRESS.md`. Answer the owner in Hebrew.

## "תמשיך" - the start command (from any account)
When the owner's message is the word **תמשיך** (alone, or with this folder's path, e.g.
`C:\My Projects\novaTV Addon תמשיך`), do this at once, without asking anything:
1. Work in this folder (if the session started elsewhere, change to the path given and read this file first).
2. Sync: `git status` (keep local changes), `git pull origin gh-pages` if a remote is newer; note the published
   version (`src/plugin.video.nova/addon.xml`) and the last 10 commits (`git log --oneline -10`).
3. Read `src/HANDOFF.md` "התחל כאן" (state, where things are, traps, release recipe, open tasks) and
   `docs/PROGRESS.md` ("Next", pending bugs). Check what is live on this PC: which Kodi listens on 9090, whether
   the subtitle server answers `http://127.0.0.1:8765/health`.
4. Tell the owner in 3-5 Hebrew lines where things stand and which task you start with (the first open task on the
   HANDOFF list that does not need the owner), put the whole list on the task list with estimates.
5. Start working immediately and follow the iron rule below.

## Iron rule - work to the finish
- Work without stopping until EVERY open task, step and phase in `docs/PROGRESS.md` ("Next") and in the HANDOFF
  "open tasks" list is done, tested, and released as a new version (bump, package, push, verify the site serves it).
- Do not end a turn with "should I continue?" / "want me to...?" for work that is already on the list: do it.
  Stop only for (a) something only the owner can do - a password / 2FA code, a login, a physical device, money,
  (b) an owner decision listed as such in PROGRESS, (c) the safety rules below. Then do every other task meanwhile,
  and ask the blocked question once, plainly, at the end.
- After each finished piece: update `docs/PROGRESS.md` and the HANDOFF "open tasks" list in the same commit, so
  another session (another account) can continue from the repository alone.

## Releases
- Every pushed update raises the version. Since 4.2.8 ONE version for all four add-ons:
  `python src/tools/bump.py X.Y.Z "news"`, then the full build (HANDOFF "release recipe"), then commit + push to
  `gh-pages`, then check `https://bennymat93.github.io/TeleNova/repo/addons.xml` shows X.Y.Z.
- Python 3.8 syntax for add-on code; run the unit tests listed in HANDOFF before every release.

## Safety - these stay in force whatever the rule above says
- Never type, read out or store the owner's passwords, 2FA codes, Telegram session, API keys or tokens; the owner
  types them. Never copy a Telegram session between devices (AUTH_KEY_DUPLICATED ends both logins).
- Never run `src/qa/qa_all.ps1` / `qa_fast.ps1` (they wipe the Kodi profile that holds the owner's logins) or
  `t_quiet_live.py`; use `qa_live.ps1` and `deploy_local.py`.
- No secrets in commits (`.nvp`, `gdrive_client.json`, keys); never bypass push protection.
- Check that Kodi is idle (`Player.GetActivePlayers` empty) before restarting it.
