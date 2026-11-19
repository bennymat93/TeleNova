'use strict';
// BN Stream web 5.5 - "All in one" (AIO): every account and service of the household behind ONE user name and password.
//
// How it works (nothing of it is in this repository: no user name, no password, no key):
//  * On a device where everything is already connected, the owner presses "Save my connections to All in one" and types a
//    user name and a password. The whole setup - every setting and key (TMDb, Gemini, OpenSubtitles, YouTube, the Google
//    Drive client, subtitle-site and IPTV accounts), the Real-Debrid sign-in, the Telegram application details and the
//    household secret of the automatic Telegram sign-in, the Stremio servers, the users with their lists - is sealed with
//    a key made from the user name + password (the same full backup as the Backup page) and kept by the helper Worker.
//  * On any new device - site, app or Kodi - "Connect all" + the same user name and password brings all of it back.
//    Telegram then signs in by itself: a device of the household that is open and signed in approves it (tg.js linkServe).
//    A Telegram login itself is never stored (two devices on one login lose both - AUTH_KEY_DUPLICATED).
//
// Keys:  bits = PBKDF2-SHA-256(name.toLowerCase().trim() + "\0" + password, "bn-aio-v1", 310000) -> 64 bytes
//        id   = hex(bits[0..32])     the vault's address at the helper: without the password there is no address
//        seal = base64(bits[32..64]) the password of the sealed file (sealed.js, PBKDF2 200000 on top)
// The helper sees neither the name nor the password; it answers GET /aio/<id> and allows few misses per hour.
// Kodi does the same in Python: plugin.video.telescope/resources/lib/aio.py (checked against this one by qa/web/t_aio.js).
(function (root) {
  const TN = root.TN;
  if (!TN) return;
  const HELPER = 'https://telenova-helper.hmi-analyzer.workers.dev';
  const ROUNDS = 310000;
  TN.i18n.add({
    he: {aio_title: 'חיבור כולל (All in one)', aio_intro: 'משתמש וסיסמה אחד שמחברים את כל החשבונות והשירותים: טלגרם, Real-Debrid, Google Drive, OpenSubtitles, YouTube, TMDb, Gemini, ערוצים ושרתים – בכל מכשיר: אתר, אפליקציה או Kodi.',
      aio_user: 'שם משתמש', aio_pass: 'סיסמה', aio_pass2: 'הסיסמה שוב', aio_go: 'התחבר להכול', aio_save: 'שמור את החיבורים שלי ב-All in one', aio_wait: 'מתחבר… (כמה שניות)',
      aio_saving: 'שומר…', aio_saved: 'נשמר. מעכשיו, בכל מכשיר חדש: "חיבור כולל" + אותו משתמש וסיסמה.', aio_done: 'מחובר: %s', aio_none: 'לא נמצא חיבור כולל עם המשתמש והסיסמה האלה. בדקו את האיות (גם אותיות גדולות וקטנות בסיסמה).',
      aio_busy: 'יותר מדי ניסיונות מהרשת הזו. נסו שוב בעוד שעה.', aio_net: 'אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.', aio_short: 'שם משתמש של 3 תווים לפחות וסיסמה של 8 לפחות.',
      aio_differ: 'שתי הסיסמאות אינן זהות.', aio_save_hint: 'לבעלים: במכשיר שבו הכול כבר מחובר – בחרו משתמש וסיסמה ושמרו. גם כל שמירה חוזרת מעדכנת את החיבור הכולל.',
      aio_first: 'מכשיר חדש? התחברו להכול בבת אחת', aio_first_btn: 'חיבור כולל', aio_tg: 'טלגרם מתחבר עכשיו בעצמו – מכשיר אחר שלכם שמחובר ופתוח מאשר אותו.', aio_open_save: 'שמירה / עדכון של החיבור הכולל'},
    en: {aio_title: 'All in one', aio_intro: 'One user name and password that connect every account and service: Telegram, Real-Debrid, Google Drive, OpenSubtitles, YouTube, TMDb, Gemini, channels and servers - on any device: the site, an app or Kodi.',
      aio_user: 'User name', aio_pass: 'Password', aio_pass2: 'The password again', aio_go: 'Connect all', aio_save: 'Save my connections to All in one', aio_wait: 'Connecting… (a few seconds)',
      aio_saving: 'Saving…', aio_saved: 'Saved. From now on, on every new device: "All in one" + the same user name and password.', aio_done: 'Connected: %s', aio_none: 'No All-in-one account with this user name and password. Check the spelling (capital and small letters in the password too).',
      aio_busy: 'Too many tries from this network. Try again in an hour.', aio_net: 'The server cannot be reached. Check the internet and try again.', aio_short: 'A user name of 3 characters or more and a password of 8 or more.',
      aio_differ: 'The two passwords are not the same.', aio_save_hint: 'For the owner: on a device where everything is connected, choose a user name and password and save. Saving again updates it.',
      aio_first: 'A new device? Connect everything at once', aio_first_btn: 'All in one', aio_tg: 'Telegram is connecting by itself now - another device of yours that is open and signed in approves it.', aio_open_save: 'Save / update All in one'},
    ru: {aio_title: 'Всё в одном', aio_intro: 'Одно имя и пароль, которые подключают все аккаунты и сервисы: Telegram, Real-Debrid, Google Drive, OpenSubtitles, YouTube, TMDb, Gemini, каналы и серверы - на любом устройстве: сайт, приложение или Kodi.',
      aio_user: 'Имя пользователя', aio_pass: 'Пароль', aio_pass2: 'Пароль ещё раз', aio_go: 'Подключить всё', aio_save: 'Сохранить мои подключения во «Всё в одном»', aio_wait: 'Подключение… (несколько секунд)',
      aio_saving: 'Сохраняю…', aio_saved: 'Сохранено. Теперь на любом новом устройстве: «Всё в одном» + те же имя и пароль.', aio_done: 'Подключено: %s', aio_none: 'Аккаунт «Всё в одном» с таким именем и паролем не найден. Проверьте написание (и регистр букв в пароле).',
      aio_busy: 'Слишком много попыток из этой сети. Попробуйте через час.', aio_net: 'Сервер недоступен. Проверьте интернет и попробуйте снова.', aio_short: 'Имя от 3 символов и пароль от 8.',
      aio_differ: 'Пароли не совпадают.', aio_save_hint: 'Для владельца: на устройстве, где всё подключено, выберите имя и пароль и сохраните. Повторное сохранение обновляет данные.',
      aio_first: 'Новое устройство? Подключите всё сразу', aio_first_btn: 'Всё в одном', aio_tg: 'Telegram подключается сам - другое ваше устройство, открытое и подключённое, подтверждает вход.', aio_open_save: 'Сохранить / обновить «Всё в одном»'},
  });
  const t = (k, ...a) => TN.t(k, ...a);

  // ------------------------------------------------------------ keys (pure: also run by qa/web/t_aio.js)
  async function keys(name, password) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', enc.encode(String(name).trim().toLowerCase() + '\u0000' + String(password)), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('bn-aio-v1'), iterations: ROUNDS}, base, 512));
    let s = '';
    for (const b of bits.subarray(32)) s += String.fromCharCode(b);
    return {id: Array.from(bits.subarray(0, 32), (b) => b.toString(16).padStart(2, '0')).join(''), seal: btoa(s)};
  }
  const okInput = (name, pass) => String(name || '').trim().length >= 3 && String(pass || '').length >= 8;
  async function backup() {
    if (!root.TNBackup || !root.TNBackup.fullBackup) await TN.loadScript('backup.js');
    return root.TNBackup;
  }

  // ------------------------------------------------------------ save (the owner, on a device where everything works)
  async function save(name, password) {
    if (!okInput(name, password)) throw Object.assign(new Error('short'), {code: 'aio_short'});
    const k = await keys(name, password);
    const B = await backup();
    const blob = await B.fullBackup(k.seal);
    const r = await fetch(HELPER + '/aio/' + k.id, {method: 'PUT', body: blob, cache: 'no-store'}).catch(() => null);
    if (!r) throw Object.assign(new Error('net'), {code: 'aio_net'});
    if (!r.ok) throw Object.assign(new Error('http ' + r.status), {code: r.status === 429 ? 'aio_busy' : 'aio_net'});
    try { TN.put('aio_done', 1); } catch (e) { /* only the first-run button reads it */ }
    return true;
  }
  // ------------------------------------------------------------ connect (any new device)
  async function connect(name, password) {
    if (!okInput(name, password)) throw Object.assign(new Error('short'), {code: 'aio_short'});
    const k = await keys(name, password);
    const r = await fetch(HELPER + '/aio/' + k.id, {cache: 'no-store'}).catch(() => null);
    if (!r) throw Object.assign(new Error('net'), {code: 'aio_net'});
    if (r.status === 404) throw Object.assign(new Error('none'), {code: 'aio_none'});
    if (r.status === 429) throw Object.assign(new Error('busy'), {code: 'aio_busy'});
    if (!r.ok) throw Object.assign(new Error('http ' + r.status), {code: 'aio_net'});
    const B = await backup();
    const got = await B.fullRestore(new Uint8Array(await r.arrayBuffer()), k.seal);
    try { TN.put('aio_done', 1); } catch (e) { /* see above */ }
    // Telegram: the sign-in page starts by itself; a device of the household approves it (tg.js)
    if (got.autoTg) { try { sessionStorage.setItem('bn_tg_auto', '1'); } catch (e) { /* asked by hand */ } }
    return got;
  }
  const errText = (e) => t(e && /^aio_/.test(e.code) ? e.code : e && (e.code === 'wrong_password' || e.code === 'damaged') ? 'aio_none' : 'aio_net');

  // ------------------------------------------------------------ the panel (accounts page, first-run, its own page)
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function field(type, label, auto) {
    const i = el('input', 'bk_in');
    i.type = type; i.placeholder = label; i.setAttribute('aria-label', label); i.autocomplete = auto; i.dir = 'ltr'; i.spellcheck = false;
    i.style.cssText = 'flex:1 1 200px;min-width:0;min-height:44px;padding:9px 14px;border-radius:10px;border:1px solid var(--line,#555);background:var(--panel,transparent);color:inherit;font:inherit';
    return i;
  }
  function panel(into, opts) {
    opts = opts || {};
    const box = el('div', 'panel aio');
    box.style.cssText = 'border:2px solid var(--accent);border-radius:14px;padding:16px;margin:0 0 20px';
    box.append(el('h2', '', t('aio_title')), el('p', 'hint', t('aio_intro')));
    const f = el('form', 'links'), user = field('text', t('aio_user'), 'username'), pass = field('password', t('aio_pass'), 'current-password');
    const msg = el('p', 'hint'); msg.setAttribute('role', 'status');
    f.append(user, pass, TN.button('btn', t('aio_go'), null));
    f.onsubmit = async (e) => {
      e.preventDefault();
      msg.textContent = t('aio_wait');
      try {
        const got = await connect(user.value, pass.value);
        pass.value = '';
        msg.textContent = t('aio_done', got.names.join(', ') || '-');
        TN.emit('settings', 'aio');
        if (sessionStorage.getItem('bn_tg_auto')) { msg.textContent += ' ' + t('aio_tg'); setTimeout(() => TN.go('#/tglogin'), 2500); }
        if (opts.onDone) opts.onDone(got);
      } catch (err) { msg.textContent = errText(err); pass.value = ''; pass.focus(); }
    };
    box.append(f, msg);
    if (opts.withSave !== false) {
      const sv = el('details');
      sv.append(el('summary', '', t('aio_open_save')), el('p', 'hint', t('aio_save_hint')));
      const f2 = el('form', 'links'), u2 = field('text', t('aio_user'), 'username'), p2 = field('password', t('aio_pass'), 'new-password'), p3 = field('password', t('aio_pass2'), 'new-password');
      const m2 = el('p', 'hint'); m2.setAttribute('role', 'status');
      f2.append(u2, p2, p3, TN.button('btn ghost', t('aio_save'), null));
      f2.onsubmit = async (e) => {
        e.preventDefault();
        if (p2.value !== p3.value) { m2.textContent = t('aio_differ'); return; }
        m2.textContent = t('aio_saving');
        try { await save(u2.value, p2.value); m2.textContent = t('aio_saved'); p2.value = p3.value = ''; }
        catch (err) { m2.textContent = errText(err); }
      };
      sv.append(f2, m2);
      box.append(sv);
    }
    into.append(box);
    return box;
  }
  // nothing connected on this device yet (a fresh install, a new browser): the first-run button on Home
  function fresh() {
    try {
      if (TN.get('aio_done', 0)) return false;
      if (TN.get('tg_session', '') || TN.get('rd_token', '')) return false;
      const c = TN.get('cfg', {}) || {};
      return !(c.tmdb || c.gemini_key || c.subs_os_key || c.yt_key);
    } catch (e) { return false; }
  }

  TN.registerPage('aio', () => { TN.page('aio', t('aio_title')); panel(TN.view()); });
  TN.registerProvider('aio', {kinds: ['service'], label: 'All in one', keys, save, connect, panel, fresh, okInput});
})(typeof self !== 'undefined' ? self : globalThis);
