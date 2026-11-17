'use strict';
// WP-9: the Library (plan row 12): every source / search provider with an on/off switch (TN.setProviderOn, this
// browser's setting `providers_off`) and where it works. Kodi's "install add-on" becomes "on the web: yes / Kodi only".
(function (TN) {
  TN.i18n.add({
    he: {lb_intro: 'המקורות שהאתר משתמש בהם. כיבוי מקור מוציא אותו מהחיפוש ומרשימות המקורות בדפדפן הזה.',
         lb_web: 'זמין באתר', lb_helper: 'דורש עוזר (Worker)', lb_kodi: 'רק ב-Kodi', lb_on: 'פעיל', lb_off: 'כבוי',
         lb_kodi_title: 'תוספים של Kodi', lb_kodi_hint: 'אלה מותקנים באפליקציה ב-Kodi ואינם רצים בדפדפן.',
         lb_tgsearch: 'חיפוש בטלגרם', lb_rd: 'Real-Debrid', lb_yt: 'YouTube', lb_iptv: 'ערוצי טלוויזיה', lb_radio: 'רדיו',
         lb_hub: 'Dailymotion ומקורות חיפוש', lb_subs: 'כתוביות'},
    en: {lb_intro: 'The sources the site uses. Turning one off removes it from search and source lists in this browser.',
         lb_web: 'On the web', lb_helper: 'Needs the helper (Worker)', lb_kodi: 'Kodi only', lb_on: 'On', lb_off: 'Off',
         lb_kodi_title: 'Kodi add-ons', lb_kodi_hint: 'These are installed in the Kodi app and do not run in a browser.',
         lb_tgsearch: 'Telegram search', lb_rd: 'Real-Debrid', lb_yt: 'YouTube', lb_iptv: 'TV channels', lb_radio: 'Radio',
         lb_hub: 'Dailymotion and search sources', lb_subs: 'Subtitles'},
    ru: {lb_intro: 'Источники сайта. Выключенный источник не участвует в поиске и списках источников в этом браузере.',
         lb_web: 'На сайте', lb_helper: 'Нужен помощник (Worker)', lb_kodi: 'Только в Kodi', lb_on: 'Вкл', lb_off: 'Выкл',
         lb_kodi_title: 'Дополнения Kodi', lb_kodi_hint: 'Они установлены в приложении Kodi и не работают в браузере.',
         lb_tgsearch: 'Поиск в Telegram', lb_rd: 'Real-Debrid', lb_yt: 'YouTube', lb_iptv: 'Телеканалы', lb_radio: 'Радио',
         lb_hub: 'Dailymotion и источники поиска', lb_subs: 'Субтитры'},
  });
  const t = TN.t;
  // the provider modules of the plan (MODULES in app.js) that a viewer can switch
  const KNOWN = [['tgsearch', ''], ['rd', 'helper'], ['yt', ''], ['iptv', ''], ['radio', ''], ['hub', ''], ['subs', '']];
  const KODI = ['POV', 'Fen Light', 'The Loop', 'All Subs', 'IPTV Simple', 'TeleScope', 'YouTube (Kodi)'];

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function draw() {
    TN.page('library', t('m_library'));
    const view = TN.view();
    if (!document.getElementById('lb_css')) {
      const s = el('style'); s.id = 'lb_css';
      s.textContent = '.lb_list{display:grid;gap:10px;margin-top:16px;max-width:720px}.lb_row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}' +
        '.lb_row b{flex:1 1 180px}.lb_dim{background:var(--panel2);color:var(--muted)}';
      document.head.append(s);
    }
    view.append(el('p', 'hint', t('lb_intro')));
    const list = el('div', 'lb_list'); view.append(list);
    const helper = TN.settings.helper();
    for (const [name, need] of KNOWN) {
      const on = TN.providerOn(name);
      const r = el('div', 'panel lb_row');
      r.append(el('b', '', t('lb_' + name)));
      const avail = need === 'helper' && !helper ? t('lb_helper') : t('lb_web');
      r.append(el('span', 'tag' + (need === 'helper' && !helper ? ' lb_dim' : ''), avail));
      const b = TN.button('btn' + (on ? '' : ' ghost'), on ? t('lb_on') : t('lb_off'), () => {
        TN.setProviderOn(name, !on); draw();
        const again = [...TN.view().querySelectorAll('.lb_row button')][KNOWN.findIndex((k) => k[0] === name)];
        if (again) again.focus();
      });
      b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(on));
      b.setAttribute('aria-label', t('lb_' + name));
      r.append(b);
      list.append(r);
    }
    view.append(el('h2', '', t('lb_kodi_title')));
    view.append(el('p', 'hint', t('lb_kodi_hint')));
    const k = el('div', 'lb_list'); view.append(k);
    for (const n of KODI) { const r = el('div', 'panel lb_row'); r.append(el('b', '', n), el('span', 'tag lb_dim', t('lb_kodi'))); k.append(r); }
  }

  TN.registerPage('library', () => draw());
})(self.TN);
