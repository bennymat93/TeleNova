'use strict';
// BN Stream web 6.1 - a keyboard of our own (Hebrew, English, Russian) + paste, copy and a clipboard history, on every
// text box of the site and the apps, with nothing to set up.
//
// * A small bar shows over the bottom of the screen while a text box has focus: keyboard / paste / copy / history.
// * On the television shell (a remote, often no Hebrew or Russian keyboard in the system) our keyboard opens by itself;
//   elsewhere the system keyboard stays the default and ours is one press away (a phone without Hebrew / Russian works).
// * The keyboard: three layouts, the language key cycles he -> en -> ru, shift, numbers, space, delete, enter; the last
//   language used is remembered.
// * The history keeps what was copied or pasted here (20 entries, on this device only). Never a password box: nothing is
//   copied out of it, and nothing typed or pasted in it is remembered.
// Same job as the build's keyboard buttons (skinpatch.keyboard_buttons: Paste + clipboard history, Kodi 3.3.3).
(function (root) {
  const TN = root.TN;
  if (!TN) return;
  const doc = document;
  TN.i18n.add({
    he: {osk_kbd: 'מקלדת', osk_paste: 'הדבקה', osk_copy: 'העתקה', osk_hist: 'היסטוריה', osk_close: 'סגירה', osk_space: 'רווח',
      osk_empty: 'עוד לא הועתק כלום.', osk_copied: 'הועתק', osk_noclip: 'אין גישה ללוח – בחרו מההיסטוריה או לחיצה ארוכה ← הדבק.', osk_clear: 'ניקוי ההיסטוריה', osk_lang: 'שפה'},
    en: {osk_kbd: 'Keyboard', osk_paste: 'Paste', osk_copy: 'Copy', osk_hist: 'History', osk_close: 'Close', osk_space: 'Space',
      osk_empty: 'Nothing copied yet.', osk_copied: 'Copied', osk_noclip: 'No access to the clipboard - pick from the history, or long-press > Paste.', osk_clear: 'Clear the history', osk_lang: 'Language'},
    ru: {osk_kbd: 'Клавиатура', osk_paste: 'Вставить', osk_copy: 'Копировать', osk_hist: 'История', osk_close: 'Закрыть', osk_space: 'Пробел',
      osk_empty: 'Пока ничего не скопировано.', osk_copied: 'Скопировано', osk_noclip: 'Нет доступа к буферу - выберите из истории или долгое нажатие > Вставить.', osk_clear: 'Очистить историю', osk_lang: 'Язык'},
  });
  const t = (k) => TN.t(k);

  // ---------------------------------------------------------------- layouts
  const LAYOUTS = {
    he: {name: 'עב', rows: ['1234567890', '/\'קראטוןםפ', 'שדגכעיחלךף', 'זסבהנמצתץ.'], shift: false},
    en: {name: 'EN', rows: ['1234567890', 'qwertyuiop', 'asdfghjkl\'', 'zxcvbnm,.-'], shift: true},
    ru: {name: 'RU', rows: ['1234567890', 'йцукенгшщзх', 'фывапролджэ', 'ячсмитьбю.'], shift: true},
  };
  const ORDER = ['he', 'en', 'ru'];
  const ls = {
    get(k, d) { try { const v = root.localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window */ } },
  };
  let lang = ls.get('bn_osk_lang', null);
  const ui = (() => { try { return String(TN.lang() || ''); } catch (e) { return ''; } })();
  if (!ORDER.includes(lang)) lang = /^ru/.test(ui) ? 'ru' : /^en/.test(ui) ? 'en' : 'he';
  let shift = false;
  let target = null;          // the text box the bar / keyboard work on
  let kbdOpen = false;
  let userClosed = false;     // the viewer closed our keyboard on this box: do not open it again until another box

  // ---------------------------------------------------------------- clipboard history (this device only)
  const HKEY = 'bn_clip_hist';
  const hist = () => ls.get(HKEY, []).filter((x) => typeof x === 'string');
  function remember(text) {
    text = String(text || '');
    if (!text.trim() || text.length > 4000 || isSecret(target)) return;
    const h = hist().filter((x) => x !== text);
    h.unshift(text);
    ls.set(HKEY, h.slice(0, 20));
  }
  const isSecret = (el) => !!el && el.tagName === 'INPUT' && (el.type === 'password' || el.autocomplete === 'one-time-code');
  const isText = (el) => !!el && !el.disabled && !el.readOnly && (el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && /^(text|search|url|email|tel|password|number|)$/i.test(el.type || '')));

  // ---------------------------------------------------------------- writing into the box
  function insert(text) {
    const el = target;
    if (!el) return;
    el.focus({preventScroll: true});
    let s = el.selectionStart, e = el.selectionEnd;
    if (s == null) { s = e = el.value.length; }               // number boxes have no selection
    try { el.setRangeText(text, s, e, 'end'); } catch (er) { el.value = el.value.slice(0, s) + text + el.value.slice(e); }
    el.dispatchEvent(new Event('input', {bubbles: true}));
  }
  function backspace() {
    const el = target;
    if (!el) return;
    el.focus({preventScroll: true});
    let s = el.selectionStart, e = el.selectionEnd;
    if (s == null) { el.value = el.value.slice(0, -1); } else {
      if (s === e && s > 0) s -= 1;
      try { el.setRangeText('', s, e, 'end'); } catch (er) { el.value = el.value.slice(0, s) + el.value.slice(e); }
    }
    el.dispatchEvent(new Event('input', {bubbles: true}));
  }
  function enter() {
    const el = target;
    if (!el) return;
    if (el.tagName === 'TEXTAREA') return insert('\n');
    const o = {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true};
    const go = el.dispatchEvent(new KeyboardEvent('keydown', o));
    el.dispatchEvent(new KeyboardEvent('keyup', o));
    if (go && el.form) { if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit(); }
    closeKbd();
  }

  // ---------------------------------------------------------------- the bar and the keyboard
  let bar = null, kbd = null, list = null;
  function btn(cls, label, run, title) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.addEventListener('mousedown', (e) => e.preventDefault());    // the text box keeps its focus (and the caret)
    b.addEventListener('click', (e) => { e.preventDefault(); run(b); });
    return b;
  }
  function build() {
    if (bar) return;
    bar = doc.createElement('div');
    bar.className = 'osk_bar';
    bar.setAttribute('role', 'toolbar');
    bar.append(
      btn('osk_b', '⌨ ' + t('osk_kbd'), () => (kbdOpen ? closeKbd(true) : openKbd())),
      btn('osk_b', '📋 ' + t('osk_paste'), paste),
      btn('osk_b', '⧉ ' + t('osk_copy'), copy),
      btn('osk_b', '🕘 ' + t('osk_hist'), () => showHist()));
    kbd = doc.createElement('div');
    kbd.className = 'osk_kbd';
    kbd.hidden = true;
    list = doc.createElement('div');
    list.className = 'osk_hist';
    list.hidden = true;
    const wrap = doc.createElement('div');
    wrap.className = 'osk';
    wrap.hidden = true;
    wrap.append(list, kbd, bar);
    doc.body.append(wrap);
  }
  const wrapEl = () => bar && bar.parentNode;
  function drawKbd() {
    const L = LAYOUTS[lang];
    kbd.textContent = '';
    kbd.dir = 'ltr';
    for (const r of L.rows) {
      const row = doc.createElement('div');
      row.className = 'osk_row';
      for (const ch of r) {
        const c = shift && L.shift ? ch.toUpperCase() : ch;
        row.append(btn('osk_k', c, () => { insert(c); if (shift) { shift = false; drawKbd(); } }));
      }
      kbd.append(row);
    }
    const last = doc.createElement('div');
    last.className = 'osk_row';
    const next = ORDER[(ORDER.indexOf(lang) + 1) % ORDER.length];
    last.append(
      btn('osk_k osk_w', '🌐 ' + LAYOUTS[next].name, () => { lang = next; ls.set('bn_osk_lang', lang); shift = false; drawKbd(); }, t('osk_lang')),
      L.shift ? btn('osk_k osk_w' + (shift ? ' on' : ''), '⇧', () => { shift = !shift; drawKbd(); }) : doc.createTextNode(''),
      btn('osk_k osk_space', t('osk_space'), () => insert(' ')),
      btn('osk_k osk_w', '⌫', backspace),
      btn('osk_k osk_w osk_go', '⏎', enter),
      btn('osk_k osk_w', '✕', () => closeKbd(true), t('osk_close')));
    kbd.append(last);
  }
  function openKbd() {
    build();
    list.hidden = true;
    drawKbd();
    kbd.hidden = false;
    kbdOpen = true;
    doc.documentElement.classList.add('osk_on');
    const first = kbd.querySelector('.osk_k');
    if (TN.shell && TN.shell() === 'tv' && first) first.focus();   // the remote starts on the keys
  }
  function closeKbd(byViewer) {
    if (!kbd) return;
    kbd.hidden = true;
    kbdOpen = false;
    if (byViewer) userClosed = true;
    doc.documentElement.classList.remove('osk_on');
    if (target && byViewer) target.focus({preventScroll: true});
  }
  async function paste() {
    let text = '';
    try { text = root.navigator.clipboard && root.navigator.clipboard.readText ? await root.navigator.clipboard.readText() : ''; } catch (e) { text = ''; }
    if (text) { insert(text); remember(text); return; }
    showHist(t('osk_noclip'));
  }
  async function copy() {
    const el = target;
    if (!el || isSecret(el)) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const text = s != null && e > s ? el.value.slice(s, e) : el.value;
    if (!text) return;
    remember(text);
    try { if (TN.copy) TN.copy(text); else await root.navigator.clipboard.writeText(text); } catch (er) { /* the history still has it */ }
  }
  function showHist(note) {
    if (typeof note !== 'string') note = '';           // (a button's click passes the button)
    build();
    if (!list.hidden && !note) { list.hidden = true; return; }
    kbd.hidden = true;
    kbdOpen = false;
    list.textContent = '';
    if (note) { const n = doc.createElement('p'); n.className = 'hint'; n.textContent = note; list.append(n); }
    const h = hist();
    if (!h.length) { const n = doc.createElement('p'); n.className = 'hint'; n.textContent = t('osk_empty'); list.append(n); }
    for (const x of h) {
      const b = btn('osk_h', x.length > 80 ? x.slice(0, 80) + '…' : x, () => { insert(x); remember(x); list.hidden = true; });
      b.dir = 'auto';
      list.append(b);
    }
    if (h.length) list.append(btn('osk_b osk_clear', t('osk_clear'), () => { ls.set(HKEY, []); showHist(); }));
    list.hidden = false;
  }

  // ---------------------------------------------------------------- following the focus
  // 6.5.1: the bar belongs where a keyboard may be missing or lacks Hebrew / Russian - a television, a phone, a tablet,
  // any touch screen (an iPad runs the desktop shell), our own app shells - and wherever the viewer asked for it
  // (Settings > General, bn_osk_show). A computer with a mouse and a keyboard is left alone: there it only covered the
  // page. Decided from the shell and the touch capability, never from data-input (that one flips as the mouse moves).
  function wanted() {
    try {
      const sh = TN.shell ? TN.shell() : '';
      if (sh === 'tv' || sh === 'phone' || sh === 'tablet') return true;
      const nav = root.navigator || {};
      if (nav.maxTouchPoints > 0) return true;
      if (root.matchMedia && root.matchMedia('(any-pointer: coarse)').matches) return true;
      if (root.BNNative) return true;
      return ls.get('bn_osk_show', false) === true;
    } catch (e) { return true; }
  }
  let hideTimer = 0;
  doc.addEventListener('focusin', (e) => {
    const el = e.target;
    if (wrapEl() && wrapEl().contains(el)) { clearTimeout(hideTimer); return; }    // a key of ours
    if (!isText(el)) return;
    clearTimeout(hideTimer);
    if (el !== target) userClosed = false;
    target = el;
    build();
    if (!wanted()) return;                             // (the target is kept: BN_OSK.open() and the history still work)
    wrapEl().hidden = false;
    // a television has a remote and usually no Hebrew / Russian keyboard: ours opens by itself
    if (TN.shell && TN.shell() === 'tv' && !kbdOpen && !userClosed) openKbd();
  });
  doc.addEventListener('focusout', () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const a = doc.activeElement;
      if (a && (isText(a) || (wrapEl() && wrapEl().contains(a)))) return;
      if (wrapEl()) wrapEl().hidden = true;
      if (list) list.hidden = true;
      closeKbd(false);
    }, 250);
  });
  // what the viewer copies or pastes anywhere in the app joins the history (never from a password box)
  doc.addEventListener('copy', () => { try { remember(String(root.getSelection ? root.getSelection() : '')); } catch (e) { /* nothing */ } });
  doc.addEventListener('paste', (e) => {
    if (isSecret(e.target)) return;
    try { remember(e.clipboardData && e.clipboardData.getData('text')); } catch (er) { /* nothing */ }
  });
  root.addEventListener('hashchange', () => { if (wrapEl()) wrapEl().hidden = true; closeKbd(false); });

  // for the tests
  // (TN is frozen: the tests reach the keyboard through its own name)
  root.BN_OSK = {LAYOUTS, ORDER, remember, hist, isText, isSecret, open: openKbd, close: closeKbd, wanted};
})(typeof self !== 'undefined' ? self : this);
