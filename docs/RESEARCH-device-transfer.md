# Set up once, restore on every device - research and chosen design

Goal: everything (Telegram, Real-Debrid, Gemini / TMDb keys, add-on settings, bots, favourites, history) is configured
once on one device, and a second device running the build reaches the same state with almost no typing - no USB
stick, no Google Drive, no third-party cloud account. [V] = read in a primary source, [S] = secondary, [I] = inference.

## Findings

**1. Telegram: a new device can be logged in by a device that already is.** The QR-login flow: the new device calls
`auth.exportLoginToken` (token valid about 30 s), an authorized session calls `auth.acceptLoginToken(token)`, the new
device then gets its own session. "Only users can use this method"; the documentation states no api_id restriction and
no official-app requirement [V, core.telegram.org/api/qr-login, core.telegram.org/method/auth.acceptLoginToken].
Two-step verification is not bypassed: the new device gets `SESSION_PASSWORD_NEEDED` and must send the cloud
password [V, Telethon issue 3665]. Telethon 1.x: `client.qr_login()` (`.token`, `.url`, `.wait()`, `.recreate()`),
accept side `functions.auth.AcceptLoginTokenRequest(token)`. Accepting from a Telethon session is allowed by the
documentation but no public example was found - **to be tested once before building on it** [I].

**2. The session file must never be copied.** `AUTH_KEY_DUPLICATED` (406) is raised when one authorization key is
used from two connections at once; the session is invalidated on the server and the user must log in again [V,
core.telegram.org/api/errors]. Telethon's guidance: a different session for each place. *TeleNova's existing
configuration export (`.tncfg`) carries the Telethon session - two devices online with it can lose the login on
both. To be changed: transfer api_id / api_hash and mint a session per device.*

**3. Real-Debrid.** The device-code flow gives user-bound credentials whose refresh token "only expires when your
application rights are revoked by user" [V, api.real-debrid.com]. Whether a refresh on one device invalidates the
refresh token held by another is not documented. The account - not the token - is limited to one public IP at a
time; devices behind one router count as one [S]. Cleanest: an assisted device-code login per device (the new device
asks for a code, the configured device shows it / opens the page); copying the tokens is the zero-click alternative.

**4. Pairing two devices on a LAN with a TV remote.**
- Discovery: Syncthing and KDE Connect broadcast UDP beacons [V]. Android may drop inbound broadcasts for an app that
  holds no multicast lock - Kodi's Python cannot take one [S]. So the **TV listens on TCP and sends the beacon; the
  PC listens for the beacon and connects out** (no inbound firewall prompt on Windows for the transfer). Fallbacks: a
  connect sweep of the /24, then typing the address shown on the TV. Client isolation on a guest Wi-Fi defeats all.
- Authenticating the channel with only Python's standard library:

| Option | Strength | Cost |
|---|---|---|
| PAKE (SPAKE2 / CPace), user types a code | one online guess per attempt | hand-written elliptic-curve arithmetic |
| **Ephemeral Diffie-Hellman + commitment + 6-digit comparison code (SAS)** | a man in the middle succeeds once in a million and is otherwise seen as two different codes; the user only presses OK | small: `pow()`, HMAC, SHA-256 |
| QR with a full key | strongest | Kodi cannot scan |

  A typed 6-digit code must never be used as a key by itself - it is found offline in milliseconds [I].
- Primitives: finite-field DH over RFC 3526 group 14 with `pow(g, x, p)` and a range check of the peer value; HKDF
  from HMAC-SHA256; encrypt-then-MAC with a SHAKE-256 keystream and an HMAC-SHA256 tag (`hmac.compare_digest`).

**5. Not on the same network.** The user's own Telegram account can carry the configuration: an encrypted document
in "Saved Messages", fetched by the new device right after its own login. No third party, works anywhere; the blob
must be encrypted on the device (cloud chats are not end-to-end encrypted), and the new device still needs
api_id / api_hash and a Telegram login first. The public Magic Wormhole mailbox is not a dependency to build on [V].

**6. What makes "restore everywhere" feel effortless** (Nuvio Sync and the account-based apps): the TV only shows
something, typing happens on a device with a keyboard, one confirmation, restore is automatic.

## Chosen design

**Primary - "Send my setup to another device" (same network)**
1. New device, first run or TeleNova > Accounts: **"Receive setup from another device"** - opens a TCP port, sends a
   beacon every second, shows its name and address.
2. Configured device: **"Send setup to another device"** - hears the beacon (else sweeps, else asks for the address),
   connects.
3. Commitment, public values, key derivation; **both screens show the same 6 digits**; the user presses OK on both.
4. The configured device sends the encrypted bundle: all settings of both add-ons, api_id / api_hash, Gemini / TMDb
   keys, Real-Debrid credentials, bots, pinned chats, favourites, history, subtitle store index. **No Telegram session.**
5. The new device exports a Telegram login token and sends it through the channel; the configured device accepts
   it; the new device is logged in with **its own** session. With two-step verification the password is asked once on
   the configured device and passed through the channel, never stored.
6. Acknowledgement; both close. The new device restarts its engine with the new settings.

**Fallback - different networks**: after the Telegram login on the new device (QR scanned with the phone), the
encrypted bundle is taken from Saved Messages; a short PIN protects it (PBKDF2, high iteration count).

**Threat model**: a listener on the network learns nothing (ephemeral DH, encryption); an active attacker is caught
by the mismatching codes; a rogue device answering the beacon likewise; Telegram's servers see only ciphertext
(the PIN is the weakest link of the fallback); malware on either device is out of scope.

**Risks**: `acceptLoginToken` from Telethon untested (fallback: scan the new device's QR with the phone); Real-Debrid
may rotate refresh tokens; discovery fails on isolated Wi-Fi (address entry covers part); hand-written cryptography
(kept to `pow`, HMAC, SHAKE and checked against RFC vectors).

## Status

Design only. Nothing of this is implemented yet. The existing `.tncfg` export still contains the Telegram session
(see finding 2).
