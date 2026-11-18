# Web version: Telegram sign-in by phone number - "the code never arrives"

Analysis only (2026-11-18). No existing file was changed, no real Telegram login was attempted, the stored API hash
was not read. Everything below was established by reading the code, inspecting the vendored GramJS bundle and running
`web/tg.js` in Node against a mocked client (harness in section 7).

## 1. Short answer

The request the browser sends is **byte-for-byte the same request** the working Kodi engine sends
(`auth.sendCode(phone, api_id, api_hash, codeSettings{})`), and DC migration is followed correctly. There is no
protocol bug that makes Telegram skip the code. What is wrong is everything around that request:

| # | Root cause | Kind | Confidence |
|---|-----------|------|-----------|
| R1 | The code is delivered **inside Telegram** (chat "Telegram", id 777000), not by SMS. The web page says so in one vague line, does not show the number, gives no "where to look", and when Telegram offers no second delivery (`next_type` absent - the normal case for a third-party API ID with other sessions) the page shows **no resend / SMS control and no explanation at all**. | UX / flow | high |
| R2 | **Every retry asks Telegram for a new code** ("Another number" + same number, Cancel + again, page reload). Each new `auth.sendCode` invalidates the previous code, and each new login also creates a brand-new auth key. This is exactly the bug fixed in the Kodi engine in 4.0.6 (`tgauth.LoginState.reusable`, 10 minutes); the web flow never got that fix. Telegram throttles a number after a few requests - and `PHONE_NUMBER_FLOOD` is shown as **"The phone number is not valid"** (`web/tg.js:50`). | bug | high |
| R3 | The pending login lives only in memory. On a phone the viewer must leave the browser to read the code in the Telegram app; the tab is suspended or discarded, the WebSocket dies. Coming back: either the page reloaded (phone form again -> R2), or `auth.signIn` is sent on a dead client and fails with "No connection to Telegram" for ever (`web/tg.js:186,193` never reconnect; `round()` at line 324 does). | bug | high on phones / TV browsers, low on desktop |
| R4 | Resend control: countdown restarts from the full `timeout` on every redraw; `SEND_CODE_UNAVAILABLE` is shown as "It did not work (SEND_CODE_UNAVAILABLE)" and the button stays; `AUTH_RESTART` is not retried. | bug | medium |
| R5 | `normalizePhone` accepts wrong numbers (`+9720541234567`, a 9-digit typo `054 123 456`, a foreign national number such as `4155550100` -> `+4155550100`). The code would go nowhere or to a stranger; the "sent to your Telegram app" line does not show the number, so the viewer cannot notice. | bug | low for the owner (Israeli mobile), real in general |

Refuted: Kodi's quiet mode touching chat 777000 (H2), missing PHONE_MIGRATE handling (H3), CodeSettings flags (H4),
device/app strings (H8), script integrity, the `sigOf` redraw signature hiding the code step.

What cannot be decided without one live attempt by the owner: which of R1-R3 he actually hit. The recommended
changes cover all three, and section 6 has a 2-minute live check that tells them apart.

## 2. How the three implementations compare

| Step | Web (`web/tg.js`) | Kodi engine (`tgclient.py`) | Telethon `send_code_request` |
|------|------------------|-----------------------------|------------------------------|
| Request | `Api.auth.SendCode({phoneNumber, apiId, apiHash, settings: new Api.CodeSettings({})})` line 177 | `client.send_code_request(number)` line 222 | `SendCodeRequest(phone, api_id, api_hash, CodeSettings())` |
| CodeSettings flags | none set | none set | none set |
| PHONE_MIGRATE | GramJS `invoke`: catches `PhoneMigrateError / NetworkMigrateError / UserMigrateError`, `_switchDC(newDc)`, repeats (verified in the bundle) | Telethon `__call__` -> `_switch_dc` | same |
| AUTH_RESTART | **not handled** - shown as `e_generic` | not handled explicitly (reported as 'restart') | retried once |
| Same number again within 10 min | **new SendCode** | reuses the hash (`LoginState.reusable`, `CODE_LIFE = 600`) | n/a |
| Flood memory | none | `LoginState.flood / flood_left` - Telegram is not asked during a block | n/a |
| Resend | `Api.auth.ResendCode({phoneNumber, phoneCodeHash})` line 186, allowed whenever the button is enabled | `ResendCodeRequest`, guarded by `can_resend()` (elapsed >= timeout, `next` present), returns `too_early` / `no_more_ways` | - |
| Session across the login | new `StringSession('')` per `login()` (`open(true)` line 226), destroyed on cancel (`close()` -> `client.destroy()`) | one session file, same auth key for all attempts | - |
| Device strings | `deviceModel 'BN Stream Web'`, `systemVersion 'Browser'`, `appVersion WEB_VERSION` line 79 | `'Kodi' / 'TeleScope' / '1.0'` line 80 | - |
| Text for the in-app code | "The code was sent to your Telegram app (on another signed-in device)." (`tglogin.js` `tgl_via_app`) | "...Open Telegram on the phone - the message is in the chat \"Telegram\"." (`router.py:1067`) + "same code" note when reused | - |
| No code typed | nothing | menu: type again / send another way / cancel (`router._type_code`) | - |

Bundle facts (`web/vendor/gramjs-2.26.21.min.js`, loaded by `libs()` at `tg.js:39-42` through `A.loadScript` with SRI):
- SRI `sha384-vLpLXT...Z747` in `LIBS` matches the file on disk (computed). `sealed.js` matches too.
- `GramJS.version` reports `2.26.20` (the npm package's own version file lags; harmless). TL layer **198**.
- Layer 198 has every type needed: `auth.sentCodeTypeApp/Sms/Call/FlashCall/MissedCall/EmailCode/SetUpEmailRequired/
  FragmentSms/FirebaseSms/SmsWord/SmsPhrase`, `auth.codeTypeSms/Call/FlashCall/MissedCall/FragmentSms`,
  `auth.resendCode#cae47523 flags phone_number phone_code_hash reason?`, `auth.cancelCode`, `auth.reportMissingCode`.
- `invoke` loop (minified): `else if(o instanceof PhoneMigrateError||NetworkMigrateError||UserMigrateError){ ...
  if((Phone||Network) && await t.isUserAuthorized()) throw o; await t._switchDC(o.newDc); s = t._sender }` then the
  request is queued again. `_switchDC` resets the auth key, reconnects to `pluto/venus/aurora/vesta/flora.web.telegram.org:443`.
  The first connection of an empty session goes to `vesta.web.telegram.org` (DC 4).
- Instances carry `className` (`auth.SentCodeTypeApp` ...), so `sentInfo` / `isCls` work on the minified bundle (run in Node).
- `invoke` on a client without a sender throws a plain `Error('Cannot send requests while disconnected...')` -
  no `errorMessage`, so `say()` maps it to `e_net`.

## 3. The hypotheses, one by one

**(1) Code goes to the Telegram service chat and the page does not make it findable - CONFIRMED as the main cause (R1).**
For an account that has other sessions Telegram answers `auth.sentCodeTypeApp`; the code is a message in chat
"Telegram" (777000) on the other devices. A third-party API ID frequently gets no `next_type` (no SMS fallback), or
an SMS that Telegram reports but does not deliver - widely reported for Telethon / GramJS since 2023; not verifiable
here. In the page:
- `tglogin.js:218-219` shows `tgl_via_app` - no chat name, no hint that the chat may be archived / muted, no number
  (`tgl_via_app` has no `%s`), and "on another signed-in device" is wrong when the browser runs on the phone itself.
- `tglogin.js:228` draws the resend button only `if (st.canResend)`; `sentInfo` (`tg.js:164-165`) sets
  `canResend: !!sent.nextType`. With no `next_type` the viewer sees a code field and nothing else (mock run A/C:
  `{"via":"app","next":"","timeout":0,"canResend":false}`).
- A viewer who expects an SMS ("the message with the verification code") waits for something that will never come.

**(2) Kodi quiet mode marks 777000 read / archives it - REFUTED.**
`tgclient.hush()` (503-526) and `seen()` (528-537) are called from exactly three places: `tgbots.py:357` and `:408`
(after `if not getattr(ent, 'bot', False): res['error'] = 'not_a_bot'; return` at 348-350 - user 777000 is not a bot)
and `tgclient.join()` 572-574 (a chat that was just joined). `list_dialogs` (`iter_dialogs`, 477) reads nothing as
"read". The string 777000 appears nowhere in `src/plugin.video.telescope`, `src/plugin.video.nova` or `web/`.
The web's own quiet code (`web/telegram.js:169-176`) only touches chats returned by a join.
Residual: if the owner himself muted/archived the "Telegram" chat, the phone shows no notification - the new text
must say "look in the chat list, also under Archived".

**(3) DC migration not followed - REFUTED.** See the bundle facts. The raw `client.invoke(SendCode)` goes through the
same `invoke` as GramJS's own `sendCode`; GramJS's `client.sendCode` builds the identical request.

**(4) CodeSettings flags - REFUTED.** All three send an empty `CodeSettings`. Layer 198 `codeSettings#ad253d78` has
`allow_flashcall, current_number, allow_app_hash, allow_missed_call, allow_firebase, unknown_number, logout_tokens,
token, app_sandbox`; none is useful to a browser (flash call / missed call / Firebase need a native app). Do not set them.

**(5) Resend timer / swallowed errors / redraw signature - PARTLY CONFIRMED (R4).**
- `sigOf` (`tglogin.js:103-106`) does not hide the code step: `answer()` (`tg.js:423-430`) always passes through
  `{step:'wait'}`, so the signature changes on every step. It should still include `phone`, `next`, `timeout` and
  the send time (cheap, removes a class of future bugs).
- Timer (`tglogin.js:231-234`): `left = st.timeout` on **every** draw, so an error redraw (wrong code) restarts the
  whole wait. It must count from the moment the code was sent.
- `canResend` false -> no control and no text (see (1)).
- `ResendCode` errors are not swallowed (mock run B shows `e_generic:SEND_CODE_UNAVAILABLE`), but the text is raw,
  the button stays enabled, and `PHONE_CODE_EXPIRED` on resend leaves the viewer on a dead code form (only `SignIn`
  breaks out, `tg.js:200`).
- `e_flood` shows raw seconds ("try again in 71234 seconds"); `PHONE_NUMBER_FLOOD` -> `e_phone` (`tg.js:50`), which
  sends the viewer to retype the number and ask again - feeding the block.

**(6) Phone normalisation - PARTLY CONFIRMED (R5).** `normalizePhone` (`tg.js:146-154`), Node results:

| typed | result | verdict |
|-------|--------|---------|
| `054-123 4567`, `+972 54-123-4567`, `972541234567`, `541234567`, `00972541234567`, `(054)1234567`, LRM + `+972541234567` | `+972541234567` | correct |
| `+9720541234567`, `9720541234567` | `+9720541234567` | wrong (trunk 0 kept) |
| `0972541234567` | `+972972541234567` | wrong |
| `054 123 456` (one digit short) | `+97254123456` | wrong, accepted |
| `2125550100`, `4155550100` (foreign national) | `+2125550100`, `+4155550100` | wrong country |
| `07700900123` (UK national) | `+9727700900123` | wrong country |
| Arabic-Indic digits | `''` | rejected (fine, but could be mapped) |

Telegram answers `PHONE_NUMBER_INVALID` for most of these; a number that happens to exist would receive the code.
`tgauth.normalize_phone` has the same behaviour (it is the model). For the owner's own number in any usual form the
result is right, so this is not his bug.

**(7) Connection closed / login cancelled between SendCode and SignIn - CONFIRMED (R2, R3).**
- `cancelLogin` (`tg.js:213-221`) destroys the client; the next `login()` runs `open(true)` with an empty session:
  new auth key, new `SendCode` (mock run D: `SendCode#1 ... destroy#1 SendCode#2`, 2 clients).
- "Another number" (`BACK`, `tg.js:183`) then the same number: new `SendCode` on the same client (run C).
- A page reload or a discarded tab loses `client`, `loginUi`, hash - the page opens on the tabs again.
- Leaving the page inside the app does **not** cancel (the login keeps running; Settings shows "Connect" -> back to
  the code step). Good, keep it.
- `navigator.locks` (`lock()`, 61-71) is released only by `unlock()`; it does not interrupt a login. The service
  worker does not cache or touch the WebSocket. Not a cause.
- Dead socket: run E - `SignIn` on a disconnected client -> `e_net`, the viewer stays on the code form and every
  further try fails the same way, until he cancels (-> new code).

**(8) Device strings / API ID - NOT A CAUSE (no evidence).** `appVersion: A.version` is `WEB_VERSION` (`app.js:786`),
never empty. The API ID is the one from Kodi's pairing link, the same ID with which the Kodi phone login works. A
restricted API ID would answer `API_ID_INVALID` / `API_ID_PUBLISHED_FLOOD` (shown as `e_api`), not silence.

**(9) Other findings**
- `sentInfo`: `SentCodeTypeSetUpEmailRequired` is reported as `email` ("sent to the account's e-mail") although
  nothing was sent - Telegram demands a login e-mail first, which this page cannot set. `SentCodeTypeFragmentSms`
  is reported as `sms` (the code is on fragment.com). `tgauth.sent_info` has the same order bug (`'sms'` is tested
  before `'fragment'`, so its `('fragment','other')` entry is dead code).
- `tgl_via_app` and the other texts live in `tglogin.js`; the Settings panel shows only "Connecting..." during a login.
- `ui.pending` (`tglogin.js:162,198-203`) answers the first `phone` step automatically - correct, no race found.
- Header comment of `tg.js` line 5 still says "NOT covered by automatic tests"; the mocked test in section 7 changes that.

## 4. Recommended changes

### 4.1 `web/tg.js`

(a) Errors - `say()`:
```diff
-    if (e && e.seconds && /FLOOD/.test(code)) return A.fmt('e_flood', String(e.seconds));
+    if (e && e.seconds && /FLOOD/.test(code)) return A.fmt('e_flood_for', waitText(e.seconds));
+    if (/^(PHONE_NUMBER_FLOOD|PHONE_PASSWORD_FLOOD)$/.test(code)) return A.X('e_flood_day');     // "Telegram blocked code requests for this number for some hours. The QR code still works."
+    if (code === 'SEND_CODE_UNAVAILABLE') return A.X('e_no_more_ways');                           // "Telegram offers no other way to send the code. It is in the Telegram app."
-    if (/^PHONE_NUMBER_(INVALID|BANNED|FLOOD)$/.test(code)) return A.X('e_phone');
+    if (/^PHONE_NUMBER_(INVALID|BANNED)$/.test(code)) return A.X('e_phone');
```
`waitText(seconds)` = port of `tgauth.wait_text` (seconds / minutes / hours). New strings `e_flood_for`, `e_flood_day`,
`e_no_more_ways` in `app.js` (he / en / ru).

(b) `normalizePhone` (keep `tgauth.normalize_phone` identical - section 4.3):
```diff
   function normalizePhone(text, cc) {
-    const raw = String(text || '').trim();
-    let d = raw.replace(/\D/g, '');
+    const raw = String(text || '').replace(/[‎‏‪-‮⁦-⁩]/g, '').trim()
+      .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0));
+    let d = raw.replace(/\D/g, '');
     cc = cc || '972';
-    if (raw.startsWith('+')) { /* already international */ } else if (d.startsWith('00')) d = d.slice(2);
-    else if (d.startsWith('0')) d = cc + d.slice(1);
-    else if (d.length <= 9) d = cc + d;
-    return d.length >= 8 && d.length <= 15 ? '+' + d : '';
+    const intl = raw.startsWith('+') || d.startsWith('00');
+    if (d.startsWith('00')) d = d.slice(2);
+    if (!intl) {
+      if (d.startsWith(cc)) { /* 972541234567 */ }
+      else if (d.startsWith('0')) d = cc + d.slice(1);
+      else if (d.length <= 9) d = cc + d;
+      else return '';                                   // a foreign national number: must be typed with + and the country code
+    }
+    if (d.startsWith(cc + '0')) d = cc + d.slice(cc.length + 1);          // +972 054... -> +972 54...
+    if (cc === '972' && d.startsWith('972') && !/^972(5\d{8}|7\d{8}|[23489]\d{7})$/.test(d)) return '';   // Israeli numbers have a fixed length
+    return d.length >= 8 && d.length <= 15 ? '+' + d : '';
   }
```
Expected: `+9720541234567 -> +972541234567`, `054 123 456 -> ''`, `4155550100 -> ''`, `0972541234567 -> ''`,
`+44 7700 900123` unchanged.

(c) `sentInfo` - honest kinds, plus the send time:
```diff
-      for (const [k, v] of [['app', 'app'], ['sms', 'sms'], ['flashcall', 'call'], ['missedcall', 'call'], ['call', 'call'], ['email', 'email']]) if (n.includes(k)) return v;
+      for (const [k, v] of [['setupemail', 'email_setup'], ['fragment', 'fragment'], ['typeapp', 'app'], ['sms', 'sms'], ['flashcall', 'call'], ['missedcall', 'call'], ['call', 'call'], ['email', 'email']]) if (n.includes(k)) return v;
 ...
-            timeout: Number(sent && sent.timeout) || 0, canResend: !!(sent && sent.nextType)};
+            timeout: Number(sent && sent.timeout) || 0, canResend: !!(sent && sent.nextType), sentAt: Date.now()};
```
(`'typeapp'` instead of `'app'`: matches `auth.SentCodeTypeApp` only.)

(d) `phoneFlow` - one code per number for 10 minutes, a living connection, restart handling. Sketch of the new body:
```js
  const CODE_LIFE = 600000;
  let pending = null;                         // {phone, hash, where, session} - survives "another number", Cancel and a reload
  const savePending = () => { try { if (pending) root.sessionStorage.setItem('bn_tg_pending', JSON.stringify(pending)); else root.sessionStorage.removeItem('bn_tg_pending'); } catch (e) {} };
  const loadPending = () => { try { const p = JSON.parse(root.sessionStorage.getItem('bn_tg_pending') || 'null'); return p && Date.now() - p.where.sentAt < CODE_LIFE ? p : null; } catch (e) { return null; } };
  const fresh = (phone) => !!(pending && pending.phone === phone && Date.now() - pending.where.sentAt < CODE_LIFE);
  async function alive() { if (client && !client.connected) await client.connect(); }
  async function call(req) {                  // one reconnect + one repeat when the socket died under the viewer
    try { await alive(); return await client.invoke(req); }
    catch (e) { if (e && e.errorMessage) throw e; await client.connect(); return client.invoke(req); }
  }
  async function sendCode(Api, apiCreds, phone) {
    const req = () => new Api.auth.SendCode({phoneNumber: phone, apiId: apiCreds.apiId, apiHash: apiCreds.apiHash, settings: new Api.CodeSettings({})});
    try { return await call(req()); } catch (e) { if (e && e.errorMessage === 'AUTH_RESTART') return call(req()); throw e; }
  }

  async function phoneFlow(apiCreds, password, onError) {
    const Api = G().Api;
    for (;;) {
      let phone = pending && pending.resume ? pending.phone : normalizePhone(await ask('phone', {}));
      if (!phone) { info.error = A.X('e_phone'); continue; }
      if (!fresh(phone)) {
        let sent;
        try { sent = await sendCode(Api, apiCreds, phone); }
        catch (e) { pending = null; savePending(); if (await onError(e)) throw new Error('AUTH_USER_CANCEL'); continue; }
        if (isCls(sent, 'auth.SentCodeSuccess')) return;
        pending = {phone, hash: sent.phoneCodeHash, where: sentInfo(sent), session: client.session.save()};
      } else pending.where.reused = true;                      // the page says "the same code is still valid"
      delete pending.resume; savePending();
      for (;;) {
        const code = await ask('code', Object.assign({phone}, pending.where));
        if (code === BACK) break;                              // the code is kept: the same number will not ask again
        if (code === RESEND) {
          try {
            const r = await call(new Api.auth.ResendCode({phoneNumber: phone, phoneCodeHash: pending.hash}));
            if (isCls(r, 'auth.SentCodeSuccess')) return;
            pending.hash = r.phoneCodeHash; pending.where = sentInfo(r); info.error = '';
          } catch (e) {
            const m = e && e.errorMessage;
            if (m === 'SEND_CODE_UNAVAILABLE') { pending.where.canResend = false; pending.where.exhausted = true; }
            if (await onError(e)) throw new Error('AUTH_USER_CANCEL');
            if (m === 'PHONE_CODE_EXPIRED') { pending = null; savePending(); break; }
          }
          savePending();
          continue;
        }
        try {
          const r = await call(new Api.auth.SignIn({phoneNumber: phone, phoneCodeHash: pending.hash, phoneCode: String(code)}));
          if (isCls(r, 'auth.AuthorizationSignUpRequired')) { info.error = A.X('e_signup'); pending = null; savePending(); break; }
          pending = null; savePending();
          return;
        } catch (e) {
          const m = e && e.errorMessage;
          if (m === 'SESSION_PASSWORD_NEEDED') { pending = null; savePending(); await client.signInWithPassword(apiCreds, {password, onError}); return; }
          if (await onError(e)) throw new Error('AUTH_USER_CANCEL');
          if (m === 'PHONE_CODE_EXPIRED' || m === 'PHONE_NUMBER_INVALID') { pending = null; savePending(); break; }
        }
      }
    }
  }
```
(e) `open(fresh)` / `login()` - reuse the auth key of a pending code (a `phone_code_hash` belongs to the connection
that asked for it; this is why Kodi's single session file "just works"):
```diff
-  async function open(fresh) {               // fresh: a new login, a new (empty) session
+  async function open(fresh, session) {      // fresh: a new login; session: the not-yet-signed-in session a code was asked on
 ...
-    client = new (G().TelegramClient)(new (G().sessions.StringSession)(fresh ? '' : savedSession()), Number(c.id), c.hash,
+    client = new (G().TelegramClient)(new (G().sessions.StringSession)(fresh ? (session || '') : savedSession()), Number(c.id), c.hash,
```
```diff
   // login():
-      await open(true);
+      if (!pending) pending = loadPending();                    // after a reload
+      if (how !== 'phone' || !pending || Date.now() - pending.where.sentAt >= CODE_LIFE) { pending = null; savePending(); }
+      await open(true, pending && pending.session);
```
and in `cancelLogin` use `c.disconnect()` instead of `destroy()` when `pending` is alive (do **not** log the key out),
leaving `pending` in place. `api.pendingPhone = () => (pending || loadPending() || {}).phone || ''` and
`login('phone', keep, {resume: true})` (sets `pending.resume = true`) let the page go straight back to the code step.
`disconnect()` / `forget()` must clear `pending` and the sessionStorage key.

Security note for the owner's decision: `bn_tg_pending` holds a **not signed-in** session key for at most 10 minutes,
in `sessionStorage` (this tab only, gone when the tab closes); it is removed the moment sign-in succeeds, on
`PHONE_CODE_EXPIRED`, and on logout. It is never the account's session. If even that is unwanted, keep `pending` in
memory only: Cancel / "another number" are still fixed, a reload is not.

### 4.2 `web/tglogin.js`

(a) Texts (he shown; en / ru alike). The number is always shown, the chat is named, the same-device case is covered:
```diff
-      tgl_via_app: 'הקוד נשלח לאפליקציית טלגרם שלכם (במכשיר אחר שמחובר).',
+      tgl_via_app: 'טלגרם שלח קוד בן %2 ספרות אל %1 - בתוך אפליקציית טלגרם, לא ב-SMS.',
+      tgl_via_app_how: 'פתחו את טלגרם (בטלפון, במחשב או ב-web.telegram.org) ← צ\'אט בשם "Telegram" עם סימן אימות כחול. לא רואים? חפשו "Telegram" בחיפוש, ובדקו גם בארכיון.',
+      tgl_via_app_same: 'טלגרם מותקן במכשיר הזה? עברו אליו, העתיקו את הקוד וחזרו ללשונית הזאת - הקוד נשמר 10 דקות.',
+      tgl_same_code: 'אותו קוד עדיין בתוקף - לא נשלח קוד חדש.',
+      tgl_no_more: 'טלגרם לא מציע דרך נוספת (SMS / שיחה) לחיבור הזה. הקוד נמצא באפליקציית טלגרם; אפשר גם להתחבר בקוד QR.',
+      tgl_no_code: 'לא קיבלתי קוד', tgl_use_qr: 'כניסה בקוד QR במקום',
+      tgl_via_email_setup: 'טלגרם דורש להגדיר כתובת דוא"ל לכניסה בחשבון הזה. התחברו בקוד QR.',
+      tgl_via_fragment: 'הקוד מחכה באתר fragment.com (מספר אנונימי).',
```
(b) Code step (`stepParts`, lines 217-238): show the number + digits, the how-to lines, the "same code" note when
`st.reused`, and always a way forward:
```diff
-          const via = st.via === 'sms' ? 'tgl_via_sms' : ... : 'tgl_via_other';
-          out.push(el('p', 'hint', t(via, st.phone || '')));
+          const via = {sms: 'tgl_via_sms', call: 'tgl_via_call', email: 'tgl_via_email', app: 'tgl_via_app', email_setup: 'tgl_via_email_setup', fragment: 'tgl_via_fragment'}[st.via] || 'tgl_via_other';
+          const p = el('p', 'msg', t(via, st.phone || '', String(st.length || 5))); p.dir = 'auto'; out.push(p);
+          if (st.via === 'app') out.push(el('p', 'hint', t('tgl_via_app_how')), el('p', 'hint', t('tgl_via_app_same')));
+          if (st.reused) out.push(el('p', 'hint', t('tgl_same_code')));
 ...
-          if (st.canResend) {
+          if (st.canResend) {
 ...
-            let left = st.timeout || 0;
+            let left = Math.max(0, Math.ceil((st.timeout || 0) - (Date.now() - (st.sentAt || Date.now())) / 1000));
 ...
+          } else {
+            out.push(el('p', 'hint', t('tgl_no_more')));
+            row.append(TN.button('btn ghost', t('tgl_use_qr'), async (e) => { e.preventDefault(); await TG.cancel(); ui.tab = 'qr'; draw(true); TG.login('qr', ui.keep); }));
           }
```
(c) `sigOf`: add `st && st.phone, st && st.next, st && st.timeout, st && st.sentAt, st && st.reused, st && st.exhausted`.

(d) On render, when a code is pending (`TG.pendingPhone()` and `TG.state() === 'off'`): open on the phone tab and call
`TG.login('phone', ui.keep, {resume: true})` so a reloaded / restored tab lands on the code field.

(e) Phone tab: validate with the stricter `normalizePhone` and say **why** (`e_phone_cc`: "Type the number with + and
the country code") when a 10+ digit number has no prefix.

(f) Also listen to `visibilitychange` in `tg.js` while `state === 'login'`: `if (!document.hidden && client && !client.connected) client.connect().catch(() => {})` - the socket is back before the viewer has pasted the code.

### 4.3 Kodi engine (optional, to keep both sides identical)

`src/plugin.video.telescope/resources/lib/tgauth.py`: the same `normalize_phone` rules as 4.1(b), and in `sent_info`
move `('fragment', 'other')` and a new `('setupemail', 'other')` **before** `('sms', ...)` / `('email', ...)`, and
match `'typeapp'` instead of `'app'`. Extend `src/qa/t_tgauth.py` with the table of section 3 (6). No change is
needed in `tgclient.py` quiet mode. Nothing here is required for the web fix.

## 5. Why not something bigger

- Forcing SMS is impossible from a browser: Telegram decides the channel; `ResendCode` is the only lever and it is
  offered only when `next_type` is present. Flash call / missed call / Firebase flags need a native app.
- `auth.reportMissingCode` exists in layer 198 but needs the SIM's MNC and only reports an undelivered SMS; skip.
- The QR path (`signInUserWithQrCode`) needs no code at all and should stay the first suggestion on desktop / TV.
  For a phone-only viewer the Kodi pairing flow (`tgclient.qr_accept`) could approve the browser's token without any
  code - worth a separate work package ("approve this browser from Kodi").

## 6. Test plan

**Automatic (no account):** new `src/qa/web/t_tglogin.js`, run by `run_web_tests.py` like `t_tgsearch.js`.
Loads `web/tg.js` in a `vm` context with a fake `GramJS` (section 7). Assertions:
1. `normalizePhone` table of section 3 (6) with the new expected values; parity file shared with `qa/t_tgauth.py`.
2. `sentInfo` for every `SentCodeType*` / `CodeType*` (class names as in the real bundle: `auth.SentCodeTypeApp` ...);
   optionally against the real bundle, which loads in Node's `vm` with a few globals.
3. Flow: app code -> step `code` carries `phone, via, length, canResend, sentAt`.
4. "Another number" + the same number -> **no second `SendCode`** in the call log, step has `reused: true`.
5. Cancel + new phone login with the same number within 10 min -> no second `SendCode`, the new client was built
   from the pending session string.
6. Pending restored from a fake `sessionStorage` after "reload" (new vm context) -> code step, no `SendCode`.
7. `ResendCode` -> `SEND_CODE_UNAVAILABLE`: error text `e_no_more_ways`, step `canResend: false, exhausted: true`.
8. `SignIn` on a disconnected client (plain `Error`) -> `connect()` called once, request repeated, signed in.
9. `AUTH_RESTART` on `SendCode` -> repeated once, code step reached.
10. `PHONE_NUMBER_FLOOD` -> `e_flood_day`, `FLOOD_WAIT` 7300 s -> text with hours; `PHONE_CODE_EXPIRED` on sign-in ->
    pending cleared, phone step, next submit sends a new code.
11. `SESSION_PASSWORD_NEEDED` -> password step; success clears `bn_tg_pending`.
12. After 600 s (fake clock) the same number asks for a new code.

**Page (headless Chrome, fake `window.TG`):** code step with `canResend:false` shows `tgl_no_more` + QR button; the
countdown continues (does not restart) after an error redraw; the number is visible in the app text; RTL layout at
360 px, 768 px, 1920 px.

**Live, by the owner (2 minutes, tells R1 / R2 / R3 apart):**
1. Desktop browser, Phone tab, type the number once. Read the line on the code screen: "inside the Telegram app"
   -> open Telegram on the phone, chat "Telegram" (search it; check Archived). Code there -> it was R1.
2. No message there either: wait, do not press again; check Telegram > Settings > Devices for a "BN Stream Web"
   login attempt notice; if the page shows a flood text -> R2 (wait it out, use QR meanwhile).
3. On the phone's browser: request, switch to Telegram, copy the code, switch back -> the code field must still be
   there and sign-in must work (R3).
Never repeat the request more than twice in a row while testing - that is what triggers the block.

## 7. Mock harness used for this analysis (base for `t_tglogin.js`)

```js
const fs = require('fs'), vm = require('vm');
function make(script) {                       // script: [{ret: obj} | {err: 'CODE'} | {err: 'text', plain: true}] consumed by invoke()
  const store = new Map([['tg_api', {id: '12345', hash: 'a'.repeat(32)}]]), log = [], clients = [];
  class O { constructor(a) { Object.assign(this, a); } }
  const mk = (n) => { const c = class extends O {}; c.prototype.className = n; return c; };
  const Api = {auth: {}, CodeSettings: mk('CodeSettings')};
  for (const k of ['SendCode', 'ResendCode', 'SignIn', 'SentCode', 'SentCodeSuccess', 'SentCodeTypeApp', 'SentCodeTypeSms', 'CodeTypeSms', 'CodeTypeCall', 'AuthorizationSignUpRequired', 'LogOut']) Api.auth[k] = mk('auth.' + k);
  class TelegramClient {
    constructor(session) { this.connected = false; this.session = {save: () => 'S' + clients.length, from: session.s}; clients.push(this); this.n = clients.length; }
    setLogLevel() {} async connect() { this.connected = true; log.push('connect#' + this.n); }
    async disconnect() { this.connected = false; } async destroy() { this.connected = false; log.push('destroy#' + this.n); }
    async getMe() { return {id: 1, firstName: 'T'}; }
    async invoke(r) { log.push(r.className.replace('auth.', '') + '#' + this.n); const s = script.shift(); if (!s) throw new Error('script empty');
      if (s.err) { const e = new Error(s.err); if (!s.plain) e.errorMessage = s.err; if (s.seconds) e.seconds = s.seconds; throw e; } return s.ret; }
  }
  const root = {navigator: {onLine: true}, document: {hidden: false, addEventListener() {}, createElement: () => ({})}, addEventListener() {}, location: {},
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, sessionStorage: {m: {}, getItem(k) { return this.m[k] || null; }, setItem(k, v) { this.m[k] = v; }, removeItem(k) { delete this.m[k]; }},
    GramJS: {TelegramClient, Api, sessions: {StringSession: class { constructor(s) { this.s = s; } }}, Buffer}, Sealed: {cloudKey: () => 'k'}, fflate: {}, qrcode: () => ({})};
  root.globalThis = root; vm.createContext(root);
  vm.runInContext(fs.readFileSync(WEB + '/tg.js', 'utf8'), root);
  root.TG.init({get: (k, d) => (store.has(k) ? store.get(k) : d), put: (k, v) => store.set(k, v), drop: (k) => store.delete(k), X: (k) => k, fmt: (k, a) => k + ':' + a,
    loadScript: async () => {}, version: 'test', store: {onChange() {}}, WS: {cycle: async () => ({state: 'ok', data: []})}, onSettings() {}, onSynced() {}});
  return {TG: root.TG, Api, log, clients, store, root};
}
// drive: TG.login('phone', false); wait until TG.step().step === 'phone'; TG.answer('0541234567'); wait for 'code'; TG.resend() / TG.back() / TG.answer('12345') / TG.cancel()
```
Observed with today's `tg.js` (the numbers the report quotes):
```
A code step:  {"step":"code","phone":"+972541234567","via":"app","length":5,"next":"sms","timeout":120,"canResend":true}
B resend refused: same step | error: e_generic:SEND_CODE_UNAVAILABLE
C "another number" + same number: log = SendCode#1 ResendCode#1 SendCode#1          <- second code request
D cancel + login again:           log = ... destroy#1 SendCode#2, clients: 2         <- third request, new auth key
E sign-in on a dead socket:       step code | error: e_net                           <- never recovers
F AUTH_RESTART:                   step phone | error: e_generic:AUTH_RESTART
```
