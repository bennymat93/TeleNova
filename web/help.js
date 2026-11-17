'use strict';
// WP-9: the help center (plan row 47): the build's own guides (resources/help/guide.json, trouble.json, copied to
// data/help/), with search and a he / en toggle (Russian readers get English: the guides exist in he + en).
// #/help            the guide + troubleshooting
// #/help/q=<text>   with a search
(function (TN) {
  TN.i18n.add({
    he: {hp_search: 'חיפוש במדריך...', hp_guide: 'מדריך למשתמש', hp_trouble: 'פתרון בעיות', hp_cause: 'סיבות', hp_fix: 'פתרון',
         hp_none: 'לא נמצא דבר', hp_lang: 'English', hp_web: 'המדריך נכתב לאפליקציה ב-Kodi; באתר חלק מהמסכים נראים אחרת.', hp_full: 'המדריך המלא באתר'},
    en: {hp_search: 'Search the guide...', hp_guide: 'User guide', hp_trouble: 'Troubleshooting', hp_cause: 'Causes', hp_fix: 'Fix',
         hp_none: 'Nothing found', hp_lang: 'עברית', hp_web: 'The guide was written for the Kodi app; some screens look different on the web.', hp_full: 'The full guide on the site'},
    ru: {hp_search: 'Поиск в руководстве...', hp_guide: 'Руководство', hp_trouble: 'Решение проблем', hp_cause: 'Причины', hp_fix: 'Решение',
         hp_none: 'Ничего не найдено', hp_lang: 'עברית', hp_web: 'Руководство написано для приложения Kodi (на английском); на сайте некоторые экраны выглядят иначе.', hp_full: 'Полное руководство на сайте'},
  });
  const t = TN.t;
  let data = null;
  async function load() {
    if (!data) {
      data = Promise.all(['guide', 'trouble'].map((n) => fetch('data/help/' + n + '.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })));
      data.catch(() => { data = null; });
    }
    return data;
  }
  const text = (s) => String(s || '').replace(/\[CR\]/g, '\n').replace(/\[\/?[BI]\]|\[COLOR [^\]]*\]|\[\/COLOR\]/g, '');
  const fold = (s) => String(s || '').toLowerCase();
  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  let gLang = null;                                  // the guide's language, he or en
  async function pageHelp(arg, ctx) {
    TN.page('help', t('m_help'));
    const view = TN.view();
    if (!document.getElementById('hp_css')) {
      const s = el('style'); s.id = 'hp_css';
      s.textContent = '.hp_bar{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.hp_bar input{flex:1 1 240px;min-width:0;background:var(--panel);color:var(--text);border:1px solid var(--panel2);border-radius:10px;padding:9px 14px;font:inherit}' +
        '.hp_sec{margin-top:10px}.hp_sec summary{cursor:pointer;font-weight:600;padding:6px 0}.hp_sec p{white-space:pre-line;margin:6px 0 0;line-height:1.6}' +
        '.hp_tr{display:grid;gap:4px;margin-top:10px}.hp_tr b{font-size:15px}.hp_tr span{white-space:pre-line}.hp_h2{margin:22px 0 4px;font-size:18px}';
      document.head.append(s);
    }
    if (!gLang) gLang = TN.lang() === 'he' ? 'he' : 'en';
    const q0 = TN.params(arg).q || '';
    const bar = el('form', 'hp_bar');
    const inp = el('input'); inp.type = 'search'; inp.placeholder = t('hp_search'); inp.value = q0; inp.dir = 'auto'; inp.setAttribute('aria-label', t('hp_search'));
    const lb = TN.button('btn ghost', gLang === 'he' ? 'English' : 'עברית', () => { gLang = gLang === 'he' ? 'en' : 'he'; draw(inp.value); lb.textContent = gLang === 'he' ? 'English' : 'עברית'; });
    bar.append(inp, lb);
    bar.onsubmit = (e) => { e.preventDefault(); draw(inp.value); };
    inp.oninput = () => draw(inp.value);
    view.append(bar, el('p', 'hint', t('hp_web')));
    const out = el('div'); out.setAttribute('aria-live', 'polite'); view.append(out);
    const more = el('div', 'links'); const a = el('a', 'btn ghost', t('hp_full')); a.href = '../guide.html'; more.append(a); view.append(more);
    out.append(TN.skeleton(3));
    const [guide, trouble] = await load();
    if (!ctx.current()) return;
    function draw(q) {
      out.innerHTML = '';
      const words = fold(q).split(/\s+/).filter(Boolean);
      const hit = (...parts) => { const s = fold(parts.join(' ')); return words.every((w) => s.includes(w)); };
      const secs = (guide.sections || []).map((s) => s[gLang] || s.en || s.he).filter((s) => s && hit(s.title, text(s.body)));
      const rows = (trouble.rows || []).map((r) => r[gLang] || r.en || r.he).filter((r) => Array.isArray(r) && hit(...r));
      const dir = gLang === 'he' ? 'rtl' : 'ltr';
      if (secs.length) {
        out.append(el('h2', 'hp_h2', t('hp_guide')));
        for (const s of secs) {
          const d = el('details', 'panel hp_sec'); d.dir = dir; if (words.length) d.open = true;
          d.append(el('summary', '', s.title), el('p', '', text(s.body)));
          out.append(d);
        }
      }
      if (rows.length) {
        out.append(el('h2', 'hp_h2', t('hp_trouble')));
        for (const r of rows) {
          const d = el('div', 'panel hp_tr'); d.dir = dir;
          d.append(el('b', '', text(r[0])), el('span', 'hint', t('hp_cause') + ': ' + text(r[1])), el('span', '', t('hp_fix') + ': ' + text(r[2])));
          out.append(d);
        }
      }
      if (!secs.length && !rows.length) out.append(el('p', 'msg', t('hp_none')));
    }
    draw(q0);
  }
  TN.registerPage('help', pageHelp);
})(self.TN);
