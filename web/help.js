'use strict';
// WP-9: the help center (Kodi H01-H06) - the WEB edition of the guide and of the troubleshooting table
// (data/help/guide.json, trouble.json: he + en + ru, written for the browser version, not the Kodi guide).
// #/help            the guide + troubleshooting, in the interface language (a row of chips reads it in another one)
// #/help/q=<text>   with a search: every word of the query, over both files
// #/help/s=<id>     one section open (other pages link here)
(function (root) {
  // ------------------------------------------------------------ pure (node: src/qa/web/t_services.js)
  const LANGS = ['he', 'en', 'ru'];
  const text = (s) => String(s || '').replace(/\[CR\]/g, '\n').replace(/\[\/?[BI]\]|\[COLOR [^\]]*\]|\[\/COLOR\]/g, '');
  const fold = (s) => String(s || '').toLowerCase().replace(/[֑-ׇ]/g, '');      // (Hebrew points do not count)
  const pick = (o, lang) => (o && (o[lang] || o.en || o.he)) || null;
  // -> {sections: [{id, title, body}], rows: [[problem, causes, fix]]} that hold every word of q (all of them when q is empty)
  function search(guide, trouble, lang, q) {
    const words = fold(q).split(/\s+/).filter(Boolean);
    const hit = (parts) => { const s = fold(parts.join(' ')); return words.every((w) => s.includes(w)); };
    const sections = ((guide && guide.sections) || []).map((s) => { const x = pick(s, lang); return x ? {id: s.id || '', title: text(x.title), body: text(x.body)} : null; })
      .filter((s) => s && hit([s.title, s.body]));
    const rows = ((trouble && trouble.rows) || []).map((r) => pick(r, lang)).filter((r) => Array.isArray(r) && r.length >= 3).map((r) => r.map(text)).filter(hit);
    return {sections, rows, words};
  }
  const core = {search, text, fold, pick, LANGS};
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }

  const TN = root.TN;
  if (!TN) return;
  root.TNHelp = core;
  TN.i18n.add({
    he: {hp_search: 'חיפוש במדריך...', hp_guide: 'מדריך למשתמש', hp_trouble: 'פתרון בעיות', hp_cause: 'סיבות', hp_fix: 'פתרון',
         hp_none: 'לא נמצא דבר', hp_clear: 'ניקוי החיפוש', hp_fail: 'המדריך לא נטען. בדקו את החיבור ונסו שוב.', hp_retry: 'נסו שוב',
         hp_tools: 'כלים', hp_status: 'מצב המערכת ובדיקת מהירות', hp_services: 'שירותים וחיבורים', hp_about: 'אודות', hp_kodi: 'האפליקציה ב-Kodi',
         hp_lang: 'שפת המדריך', hp_ver: 'גרסת האתר: %s', hp_found: '%s תוצאות'},
    en: {hp_search: 'Search the guide...', hp_guide: 'User guide', hp_trouble: 'Troubleshooting', hp_cause: 'Causes', hp_fix: 'Fix',
         hp_none: 'Nothing found', hp_clear: 'Clear the search', hp_fail: 'The guide did not load. Check the connection and try again.', hp_retry: 'Try again',
         hp_tools: 'Tools', hp_status: 'System status and speed test', hp_services: 'Services and connections', hp_about: 'About', hp_kodi: 'The Kodi app',
         hp_lang: 'Guide language', hp_ver: 'Site version: %s', hp_found: '%s results'},
    ru: {hp_search: 'Поиск в руководстве...', hp_guide: 'Руководство', hp_trouble: 'Решение проблем', hp_cause: 'Причины', hp_fix: 'Решение',
         hp_none: 'Ничего не найдено', hp_clear: 'Очистить поиск', hp_fail: 'Руководство не загрузилось. Проверьте соединение и попробуйте снова.', hp_retry: 'Повторить',
         hp_tools: 'Инструменты', hp_status: 'Состояние системы и тест скорости', hp_services: 'Сервисы и подключения', hp_about: 'О приложении', hp_kodi: 'Приложение Kodi',
         hp_lang: 'Язык руководства', hp_ver: 'Версия сайта: %s', hp_found: 'Результатов: %s'},
  });
  const t = TN.t;
  let data = null;
  function load() {
    if (!data) {
      data = Promise.all(['guide', 'trouble'].map((n) => fetch('data/help/' + n + '.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })));
      data.catch(() => { data = null; });
    }
    return data;
  }
  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  let gLang = null;                                  // the guide's language (the interface's, until a chip chooses another)
  async function pageHelp(arg, ctx) {
    TN.page('help', t('m_help'));
    const view = TN.view();
    if (!document.getElementById('hp_css')) {
      const s = el('style'); s.id = 'hp_css';
      s.textContent = '.hp_bar{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.hp_bar input{flex:1 1 240px;min-width:0;min-height:44px;background:var(--panel);color:var(--text);border:1px solid var(--muted);border-radius:10px;padding:9px 14px;font:inherit}' +
        '.hp_bar input:focus-visible{outline:3px solid var(--ring)}.hp_sec{margin-top:10px}.hp_sec summary{cursor:pointer;font-weight:600;padding:8px 0;min-height:28px}' +
        '.hp_sec p{white-space:pre-line;margin:6px 0 0;line-height:1.7;text-align:start}.hp_tr{display:grid;gap:4px;margin-top:10px;text-align:start}.hp_tr b{font-size:1.02em}' +
        '.hp_tr span{white-space:pre-line}.hp_h2{margin:22px 0 4px;font-size:18px}';
      document.head.append(s);
    }
    const p = TN.params(arg);
    if (!gLang || !core.LANGS.includes(gLang)) gLang = core.LANGS.includes(TN.lang()) ? TN.lang() : 'en';
    const bar = el('form', 'hp_bar'); bar.setAttribute('role', 'search');
    const inp = el('input'); inp.type = 'search'; inp.placeholder = t('hp_search'); inp.value = p.q || ''; inp.dir = 'auto';
    inp.setAttribute('aria-label', t('hp_search')); inp.setAttribute('enterkeyhint', 'search'); inp.autocomplete = 'off';
    bar.append(inp);
    view.append(bar);
    const chipBox = el('div'); view.append(chipBox);
    const count = el('p', 'hint'); count.setAttribute('role', 'status'); view.append(count);
    const out = el('div'); view.append(out);
    // tools and about (H04 speed test and H07 status live on the Status page)
    view.append(el('h2', 'hp_h2', t('hp_tools')));
    const more = el('div', 'links');
    for (const [k, href] of [['hp_status', '#/status'], ['hp_services', '#/services'], ['hp_kodi', '#/bn'], ['hp_about', '#/about']]) { const a = el('a', 'btn ghost', t(k)); a.href = href; more.append(a); }
    view.append(more, el('p', 'hint', t('hp_ver', TN.version)));
    const sk = TN.skeleton(3);
    let guide, trouble;
    try { [guide, trouble] = await load(); } catch (e) {
      if (!ctx.current()) return;
      if (sk.isConnected) sk.remove();
      out.append(el('p', 'msg', t('hp_fail')), TN.button('btn ghost', t('hp_retry'), () => TN.route()));
      return;
    }
    if (!ctx.current()) return;
    if (sk.isConnected) sk.remove();
    function chips() {
      chipBox.textContent = '';
      const lab = el('span', 'chiplabel', t('hp_lang'));
      const c = el('div', 'chips'); c.append(lab);
      for (const [k, name] of [['he', 'עברית'], ['en', 'English'], ['ru', 'Русский']]) {
        const b = TN.button('chip' + (k === gLang ? ' on' : ''), name, () => { gLang = k; chips(); draw(inp.value); const again = chipBox.querySelector('.chip.on'); if (again) again.focus(); });
        b.setAttribute('aria-pressed', String(k === gLang));
        c.append(b);
      }
      chipBox.append(c);
    }
    function draw(q) {
      out.textContent = '';
      const r = search(guide, trouble, gLang, q);
      const dir = gLang === 'he' ? 'rtl' : 'ltr';
      count.textContent = r.words.length ? t('hp_found', r.sections.length + r.rows.length) : '';
      if (r.sections.length) {
        out.append(el('h2', 'hp_h2', t('hp_guide')));
        for (const s of r.sections) {
          const d = el('details', 'panel hp_sec'); d.dir = dir; d.lang = gLang;
          if (r.words.length || (p.s && p.s === s.id)) d.open = true;
          d.append(el('summary', '', s.title), el('p', '', s.body));
          out.append(d);
        }
      }
      if (r.rows.length) {
        out.append(el('h2', 'hp_h2', t('hp_trouble')));
        for (const row of r.rows) {
          const d = el('div', 'panel hp_tr'); d.dir = dir; d.lang = gLang;
          d.append(el('b', '', row[0]), el('span', 'hint', t('hp_cause') + ': ' + row[1]), el('span', '', t('hp_fix') + ': ' + row[2]));
          out.append(d);
        }
      }
      if (!r.sections.length && !r.rows.length) {
        out.append(el('p', 'msg', t('hp_none')), TN.button('btn ghost', t('hp_clear'), () => { inp.value = ''; draw(''); inp.focus(); }));
      }
    }
    bar.onsubmit = (e) => { e.preventDefault(); draw(inp.value); };
    inp.oninput = () => draw(inp.value);
    chips();
    draw(inp.value);
    if (p.s) { const open = out.querySelector('details[open]'); if (open && open.scrollIntoView) open.scrollIntoView({block: 'start'}); }
  }
  TN.registerPage('help', pageHelp);
})(typeof self !== 'undefined' ? self : globalThis);
