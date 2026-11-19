'use strict';
// WP-1: the Telegram sign-in page (#/tglogin). Three ways in: a QR code (scanned with Telegram on the phone), the
// phone number (code by app / SMS / call, then the two-step password), or the API details (the pairing link Kodi
// shows under Services and accounts > "Connect the web version", or typed by hand).
// All the Telegram work is in tg.js (window.TG); this page only draws TG.step() and answers it.
// Nothing secret is ever shown, logged or put in an address: the API hash is written once into this browser's storage.
(function (TN) {
  const T = {
    he: {
      tgl_title: 'כניסה לטלגרם', tgl_tab_qr: 'קוד QR', tgl_tab_phone: 'מספר טלפון', tgl_tab_pair: 'פרטי API',
      tgl_qr_start: 'הצג קוד QR', tgl_phone_go: 'שלחו לי קוד',
      tgl_need_api: 'קודם צריך את פרטי ה-API: סרקו את הקוד ב-Kodi (שירותים וחשבונות ← חיבור גרסת הרשת), או הקלידו אותם בלשונית "פרטי API".',
      tgl_pair_paste: 'הדביקו את הקישור מ-Kodi (או id.hash)', tgl_pair_or: 'או הקלידו אותם:', tgl_save: 'שמירה',
      tgl_saved: 'נשמר. עכשיו מתחברים בקוד QR או במספר טלפון.', tgl_bad_link: 'אין בקישור הזה פרטי API תקינים.',
      tgl_api_have: 'API ID %s שמור בדפדפן הזה.', tgl_api_forget: 'מחיקת פרטי ה-API',
      tgl_via_app: 'הקוד נשלח לאפליקציית טלגרם שלכם (במכשיר אחר שמחובר).', tgl_via_sms: 'הקוד נשלח ב-SMS אל %s.',
      tgl_via_call: 'תתקבל שיחה אל %s עם הקוד.', tgl_via_email: 'הקוד נשלח לדואר האלקטרוני של החשבון.', tgl_via_other: 'הקוד נשלח אל %s.',
      tgl_qr_here: 'טלגרם מותקן במכשיר הזה? לחצו כאן לאישור',
      tgl_code: 'הקוד', tgl_resend: 'שלחו את הקוד שוב', tgl_resend_sms: 'שלחו ב-SMS', tgl_resend_call: 'התקשרו אליי', tgl_resend_in: 'אפשר לבקש שוב בעוד %s שניות',
      tgl_change_phone: 'מספר אחר', tgl_use_phone: 'כניסה במספר טלפון במקום', tgl_qr_renew: 'הקוד מתחדש מעצמו.',
      tgl_connected: 'מחובר בתור %s', tgl_open_tg: 'לטלגרם', tgl_settings: 'סנכרון והגדרות', tgl_logout: 'התנתקות מטלגרם בדפדפן הזה', tgl_logout_q: 'בטוח? לחצו שוב',
      tgl_newdevice: 'הדפדפן נכנס כמכשיר חדש בחשבון. Kodi נשאר מחובר.',
    },
    en: {
      tgl_title: 'Telegram sign-in', tgl_tab_qr: 'QR code', tgl_tab_phone: 'Phone number', tgl_tab_pair: 'API details',
      tgl_qr_start: 'Show the QR code', tgl_phone_go: 'Send me a code',
      tgl_need_api: 'The API details are needed first: scan the code in Kodi (Services and accounts > Connect the web version), or type them in the "API details" tab.',
      tgl_pair_paste: 'Paste the link from Kodi (or id.hash)', tgl_pair_or: 'or type them:', tgl_save: 'Save',
      tgl_saved: 'Saved. Now sign in with the QR code or the phone number.', tgl_bad_link: 'This link holds no valid API details.',
      tgl_api_have: 'API ID %s is saved in this browser.', tgl_api_forget: 'Delete the API details',
      tgl_via_app: 'The code was sent to your Telegram app (on another signed-in device).', tgl_via_sms: 'The code was sent by SMS to %s.',
      tgl_via_call: 'A call to %s will give you the code.', tgl_via_email: 'The code was sent to the account\'s e-mail.', tgl_via_other: 'The code was sent to %s.',
      tgl_qr_here: 'Telegram is on this device? Tap here to confirm',
      tgl_code: 'The code', tgl_resend: 'Send the code again', tgl_resend_sms: 'Send it by SMS', tgl_resend_call: 'Call me', tgl_resend_in: 'You can ask again in %s s',
      tgl_change_phone: 'Another number', tgl_use_phone: 'Sign in with the phone number instead', tgl_qr_renew: 'The code renews by itself.',
      tgl_connected: 'Connected as %s', tgl_open_tg: 'Go to Telegram', tgl_settings: 'Sync and settings', tgl_logout: 'Log out of Telegram in this browser', tgl_logout_q: 'Sure? Press again',
      tgl_newdevice: 'This browser signs in as a new device of the account. Kodi stays signed in.',
    },
    ru: {
      tgl_title: 'Вход в Telegram', tgl_tab_qr: 'QR-код', tgl_tab_phone: 'Номер телефона', tgl_tab_pair: 'Данные API',
      tgl_qr_start: 'Показать QR-код', tgl_phone_go: 'Прислать код',
      tgl_need_api: 'Сначала нужны данные API: отсканируйте код в Kodi (Сервисы и аккаунты > Подключить веб-версию) или введите их на вкладке «Данные API».',
      tgl_pair_paste: 'Вставьте ссылку из Kodi (или id.hash)', tgl_pair_or: 'или введите их:', tgl_save: 'Сохранить',
      tgl_saved: 'Сохранено. Теперь войдите по QR-коду или номеру телефона.', tgl_bad_link: 'В этой ссылке нет верных данных API.',
      tgl_api_have: 'API ID %s сохранён в этом браузере.', tgl_api_forget: 'Удалить данные API',
      tgl_via_app: 'Код отправлен в ваше приложение Telegram (на другом подключённом устройстве).', tgl_via_sms: 'Код отправлен по SMS на %s.',
      tgl_via_call: 'На %s поступит звонок с кодом.', tgl_via_email: 'Код отправлен на почту аккаунта.', tgl_via_other: 'Код отправлен на %s.',
      tgl_qr_here: 'Telegram на этом устройстве? Нажмите, чтобы подтвердить',
      tgl_code: 'Код', tgl_resend: 'Отправить код ещё раз', tgl_resend_sms: 'Отправить по SMS', tgl_resend_call: 'Позвоните мне', tgl_resend_in: 'Повторить можно через %s с',
      tgl_change_phone: 'Другой номер', tgl_use_phone: 'Войти по номеру телефона', tgl_qr_renew: 'Код обновляется сам.',
      tgl_connected: 'Подключено: %s', tgl_open_tg: 'К Telegram', tgl_settings: 'Синхронизация и настройки', tgl_logout: 'Выйти из Telegram в этом браузере', tgl_logout_q: 'Точно? Нажмите ещё раз',
      tgl_newdevice: 'Браузер входит как новое устройство аккаунта. Kodi остаётся подключённым.',
    },
  };
  TN.i18n.add(T);
  const t = (k, ...a) => TN.t(k, ...a);
  const doc = document;

  function css() {
    if (doc.getElementById('tgl-style')) return;
    const s = doc.createElement('style');
    s.id = 'tgl-style';
    s.textContent = '.tgl-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}.tgl-tabs .chip[aria-selected=true]{outline:2px solid var(--ring)}' +
      '.tgl-box{display:grid;gap:10px}.tgl-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
      '.tgl-box textarea{width:100%;min-height:64px;background:var(--bg);color:var(--text);border:1px solid var(--panel2);border-radius:10px;padding:9px 14px;font:inherit}' +
      '.tgl-box input[type=text],.tgl-box input[type=password],.tgl-box input[type=tel]{width:100%;box-sizing:border-box}' +
      '.tgl-code input{font-size:22px;letter-spacing:.3em;text-align:center}';
    doc.head.append(s);
  }
  function el(tag, cls, text) { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function input(label, type, name, attrs) {
    const l = el('label', '', label), i = el('input');
    i.type = type; i.name = name; i.autocomplete = 'off'; i.dir = 'ltr'; i.spellcheck = false;
    Object.assign(i, attrs || {});
    l.append(i);
    return l;
  }
  // which tab opens first: the API details when they are missing, the phone on a phone (it cannot scan its own screen)
  function firstTab(TG) {
    if (!TG.hasApi()) return 'pair';
    const h = doc.documentElement.classList;
    if (h.contains('phone')) return 'phone';
    if (h.contains('desktop') || h.contains('tv')) return 'qr';
    return root().matchMedia && root().matchMedia('(pointer: coarse) and (max-width: 900px)').matches ? 'phone' : 'qr';
  }
  const root = () => window;

  // draws the page and keeps it in step with TG until the viewer leaves it
  async function render(arg, ctx) {
    css();
    TN.page('', t('tgl_title'));
    const view = TN.view();
    const box = el('div', 'panel tgpanel tgl');
    view.append(box);
    box.append(el('p', 'hint', t('loading')));
    let TG;
    try { TG = await TN.tg(); } catch (e) { box.replaceChildren(el('p', 'msg', t('tg_offline'))); return; }
    if (!ctx.current()) return;
    const ui = {tab: firstTab(TG), keep: true, phone: '', sig: '', pending: '', pairMsg: '', unsure: false, timer: null};
    const params = TN.params(arg || '');
    if (params.tab && ['qr', 'phone', 'pair'].includes(params.tab)) ui.tab = params.tab;

    const off = TG.on(() => { if (!ctx.current() || !box.isConnected) { off(); clearInterval(ui.timer); return; } draw(); });
    const offRoute = TN.on('route', () => { if (!ctx.current()) { off(); offRoute(); clearInterval(ui.timer); } });

    function sigOf() {
      const st = TG.step();
      return [TG.state(), ui.tab, TG.hasApi(), TG.error(), st && st.step, st && st.url, st && st.via, st && st.canResend, st && st.hint, ui.pairMsg].join('|');
    }
    function draw(force) {
      const s = sigOf();
      if (!force && s === ui.sig) return;
      ui.sig = s;
      const state = TG.state(), parts = [];
      const err = el('p', 'tgerr', TG.error());
      err.setAttribute('role', 'alert');
      clearInterval(ui.timer);
      if (state === 'on') parts.push(...connected());
      else if (state === 'login') parts.push(...stepParts(TG.step() || {step: 'wait'}), err);
      else if (state === 'connecting') parts.push(el('p', 'hint', t('tg_wait')));
      else if (state === 'other_tab') parts.push(el('p', 'hint', t('tg_other_tab')));
      else {
        if (state === 'offline') parts.push(el('p', 'msg', t('tg_offline')));
        if (!TG.hasApi()) ui.tab = 'pair';                // e.g. after a logout, which also drops the API details
        if (TG.note()) parts.push(el('p', 'hint', TG.note()));
        if (ui.pairMsg && ui.tab !== 'pair') parts.push(el('p', 'hint', ui.pairMsg));
        parts.push(tabs(), ...tabParts(), err);
      }
      box.replaceChildren(...parts);
      const first = box.querySelector('input:not([type=checkbox]),textarea');
      if (first && state === 'login') first.focus();
    }
    function tabs() {
      const row = el('div', 'tgl-tabs');
      row.setAttribute('role', 'tablist');
      for (const k of ['qr', 'phone', 'pair']) {
        const b = TN.button('chip' + (ui.tab === k ? ' on' : ''), t('tgl_tab_' + k), () => { ui.tab = k; ui.pairMsg = ''; draw(true); const f = box.querySelector('[aria-selected=true]'); if (f) f.focus(); });
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(ui.tab === k));
        row.append(b);
      }
      return row;
    }
    function keepBox() {
      const l = el('label', 'check'), c = el('input');
      c.type = 'checkbox'; c.checked = ui.keep;
      c.onchange = () => { ui.keep = c.checked; };
      l.append(c, el('span', '', t('tg_keep')));
      return [l, el('p', 'hint', t('tg_keep_warn'))];
    }
    function tabParts() {
      const out = [];
      if (ui.tab === 'pair') return pairParts();
      if (!TG.hasApi()) return [el('p', 'msg', t('tgl_need_api')), TN.button('btn', t('tgl_tab_pair'), () => { ui.tab = 'pair'; draw(true); })];
      out.push(el('p', 'hint', t('tgl_newdevice')));
      if (ui.tab === 'qr') {
        out.push(el('p', 'hint', t('tg_qr_how')), ...keepBox(), TN.button('btn', t('tgl_qr_start'), () => TG.login('qr', ui.keep)));
      } else {
        const f = el('form', 'tgl-box');
        f.append(input(t('tg_phone_label'), 'tel', 'phone', {value: ui.phone, autocomplete: 'tel', inputMode: 'tel'}), ...keepBox(), TN.button('btn', t('tgl_phone_go'), null));
        f.onsubmit = (e) => {
          e.preventDefault();
          const v = f.elements.phone.value.trim();
          if (!TG.normalizePhone(v)) { box.querySelector('.tgerr').textContent = t('e_phone'); return; }
          ui.phone = v; ui.pending = v;
          TG.login('phone', ui.keep);
        };
        out.push(f);
      }
      return out;
    }
    function pairParts() {
      const out = [el('p', 'hint', t('tg_api_about'))];
      if (TG.hasApi()) {
        const row = el('div', 'tgl-row');
        row.append(el('span', '', t('tgl_api_have', TG.apiId())), TN.button('btn ghost', t('tgl_api_forget'), () => { TG.forgetApi(); ui.pairMsg = ''; draw(true); }));
        out.push(row);
      }
      const f = el('form', 'tgl-box');
      const ta = el('textarea');
      ta.name = 'link'; ta.dir = 'ltr'; ta.spellcheck = false; ta.autocomplete = 'off';
      const lab = el('label', '', t('tgl_pair_paste'));
      lab.append(ta);
      f.append(lab, el('p', 'hint', t('tgl_pair_or')), input(t('tg_api_id'), 'text', 'id', {inputMode: 'numeric'}), input(t('tg_api_hash'), 'password', 'hash'));
      if (ui.pairMsg) f.append(el('p', ui.pairMsg === t('tgl_saved') ? 'hint' : 'tgerr', ui.pairMsg));
      f.append(TN.button('btn', t('tgl_save'), null));
      f.onsubmit = (e) => {
        e.preventDefault();
        const link = f.elements.link.value.trim();
        const got = TG.parsePair(link) || {id: f.elements.id.value, hash: f.elements.hash.value};
        f.elements.link.value = ''; f.elements.hash.value = '';         // never left on the screen
        if (TG.setApi(got.id, got.hash)) { ui.pairMsg = t('tgl_saved'); ui.tab = firstTab(TG); }
        else ui.pairMsg = link ? t('tgl_bad_link') : t('tg_api_bad');
        draw(true);
      };
      out.push(f);
      return out;
    }
    const cancelBtn = () => TN.button('btn ghost', t('tg_cancel'), () => TG.cancel());
    function stepParts(st) {
      if (st.step === 'phone' && ui.pending) {             // the number typed on the tab: answered at once
        const v = ui.pending;
        ui.pending = '';
        setTimeout(() => TG.answer(v), 0);
        return [el('p', 'hint', t('tg_wait')), cancelBtn()];
      }
      if (st.step === 'qr') {
        const q = el('div', 'qrbox'), c = el('canvas');
        c.setAttribute('role', 'img'); c.setAttribute('aria-label', t('tgl_tab_qr'));
        try { TG.drawQr(c, st.url); } catch (e) {}
        q.append(c);
        const row = el('div', 'tgl-row');
        row.append(TN.button('btn ghost', t('tgl_use_phone'), async () => { await TG.cancel(); ui.tab = 'phone'; draw(true); }), cancelBtn());
        // 5.1.2: on the phone that has Telegram there is nothing to scan with - the same address as a link opens the
        // Telegram app, which asks to confirm the sign-in
        const here = el('a', 'btn', t('tgl_qr_here'));
        if (/^tg:\/\/login\?token=[\w-]+$/.test(String(st.url || ''))) here.href = st.url; else here.hidden = true;
        here.rel = 'noopener';
        const hereRow = el('div', 'tgl-row');
        hereRow.append(here);
        return [el('p', 'hint', t('tg_qr_how')), hereRow, q, el('p', 'hint', t('tgl_qr_renew')), row];
      }
      if (st.step === 'phone' || st.step === 'code' || st.step === 'password') {
        const f = el('form', 'tgl-box' + (st.step === 'code' ? ' tgl-code' : ''));
        const out = [];
        if (st.step === 'phone') f.append(input(t('tg_phone_label'), 'tel', 'v', {value: ui.phone, autocomplete: 'tel', inputMode: 'tel'}));
        else if (st.step === 'code') {
          const via = st.via === 'sms' ? 'tgl_via_sms' : st.via === 'call' ? 'tgl_via_call' : st.via === 'email' ? 'tgl_via_email' : st.via === 'app' ? 'tgl_via_app' : 'tgl_via_other';
          out.push(el('p', 'hint', t(via, st.phone || '')));
          const codeBox = input(t('tgl_code'), 'text', 'v', {inputMode: 'numeric', autocomplete: 'one-time-code'});
          f.append(codeBox);
          // 5.1.2: a code pasted as "12 345" or "Login code: 12345" keeps its digits (maxLength used to cut it); the
          // form is sent by itself once the number of digits Telegram announced is there
          const codeIn = codeBox.matches && codeBox.matches('input') ? codeBox : codeBox.querySelector && codeBox.querySelector('input');
          if (codeIn) {
            let sentOnce = false;
            codeIn.addEventListener('input', () => {
              const d = codeIn.value.replace(/\D+/g, '').slice(0, 12);
              if (d !== codeIn.value) codeIn.value = d;
              if (st.length && d.length === st.length && !sentOnce) { sentOnce = true; if (f.requestSubmit) f.requestSubmit(); }
            });
          }
        } else {
          f.append(input(t('tg_pass_label'), 'password', 'v', {autocomplete: 'current-password'}));
          if (st.hint) { const h = el('p', 'hint', t('tg_pass_hint', st.hint)); h.dir = 'auto'; f.append(h); }
        }
        const row = el('div', 'tgl-row');
        row.append(TN.button('btn', t('tg_send'), null));
        if (st.step === 'code') {
          if (st.canResend) {
            const label = st.next === 'sms' ? 'tgl_resend_sms' : st.next === 'call' ? 'tgl_resend_call' : 'tgl_resend';
            const rb = TN.button('btn ghost', t(label), (e) => { e.preventDefault(); TG.resend(); });
            let left = st.timeout || 0;
            const tick = () => { rb.disabled = left > 0; rb.textContent = left > 0 ? t('tgl_resend_in', String(left)) : t(label); left--; if (left < -1) clearInterval(ui.timer); };
            tick();
            if (left >= 0) ui.timer = setInterval(() => { if (!rb.isConnected) return clearInterval(ui.timer); tick(); }, 1000);
            row.append(rb);
          }
          row.append(TN.button('btn ghost', t('tgl_change_phone'), (e) => { e.preventDefault(); TG.back(); }));
        }
        row.append(TN.button('btn ghost', t('tg_cancel'), (e) => { e.preventDefault(); TG.cancel(); }));
        f.append(row);
        f.onsubmit = (e) => {
          e.preventDefault();
          let v = f.elements.v.value;
          if (st.step !== 'password') v = v.replace(/\s+/g, '');
          if (!v) return;
          if (st.step === 'phone') ui.phone = v;
          f.elements.v.value = '';
          TG.answer(v);
        };
        out.push(f);
        return out;
      }
      return [el('p', 'hint', t('tg_wait')), cancelBtn()];
    }
    function connected() {
      const me = TG.me() || {};
      const name = me.username ? (me.name ? me.name + ' (@' + me.username + ')' : '@' + me.username) : me.name || '';
      const st = el('div', 'tgstate on');
      const span = el('span', '', t('tgl_connected', name));
      span.dir = 'auto';
      st.append(el('i'), span);
      const row = el('div', 'tgl-row');
      const a1 = el('a', 'btn', t('tgl_open_tg')); a1.href = '#/telegram';
      const a2 = el('a', 'btn ghost', t('tgl_settings')); a2.href = '#/settings';
      row.append(a1, a2, TN.button('btn ghost', t('tgl_logout'), (e) => {
        if (ui.unsure) { ui.unsure = false; TG.logout(); } else { ui.unsure = true; e.target.textContent = t('tgl_logout_q'); }
      }));
      return [st, el('p', 'hint', t('tgl_newdevice')), row];
    }
    draw(true);
    // 5.3: a phone sign-in was waiting for its code when the page went away (reload, app in the background): back to
    // the code field, with no new request to Telegram
    try { const pd = TG.pending && TG.pending(); if (pd && TG.state() === 'off' && TG.hasApi()) { ui.tab = 'phone'; ui.phone = pd.phone; TG.login('phone', pd.keep); } } catch (e) { /* the normal page */ }
    // 5.2: no API details here yet - take the ones that come with the build (when its helper has them) and go
    // straight to the sign-in itself: press, confirm in Telegram, done
    if (!TG.hasApi() && TG.ensureApi) TG.ensureApi().then((ok) => { if (ok && TG.state() !== 'on') { ui.tab = firstTab(TG); draw(true); } });
    // a browser that was signed in before: make sure the connection is up (shows "connecting", then the account)
    if (TG.state() === 'off' && TG.hasApi() && TG.hasSession()) TG.client().catch(() => {});
  }
  TN.registerPage('tglogin', render);
})(self.TN);
