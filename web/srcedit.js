'use strict';
// BN Stream web 5.6 - "Edit sources": one place per kind of content (films and series, live TV, radio and music,
// Telegram, YouTube, subtitles). Each category shows the sources it has now, lets them be added / edited / switched
// off / removed / checked, and searches EVERY source of that category at once (#/search/cat=<category>&q=<words>).
// The editors that already existed elsewhere (the Stremio servers of sources.js, the IPTV lists of iptv.js, the
// subtitle settings of subs.js) are the same ones, opened from here - one place to look, nothing doubled.
// Also the "Information" page: help, system status, about / update, BN Stream for Kodi - one menu entry for four pages.
(function (root) {
  const TN = root.TN;
  if (!TN) return;
  TN.i18n.add({
    he: {se_title: 'עריכת מקורות', se_intro: 'כל המקורות של הבילד לפי סוג תוכן. בכל קטגוריה: המקורות שקיימים, הוספה, עריכה, כיבוי, מחיקה ובדיקה – וחיפוש בכל מקורות הקטגוריה בבת אחת.',
      se_video: 'סרטים וסדרות', se_video_t: 'קטלוג, טלגרם, שרתי Stremio, Real-Debrid, Internet Archive, Dailymotion, YouTube',
      se_live: 'טלוויזיה לייב', se_live_t: 'ערוצי הבילד, רשימות חינמיות, M3U משלך, Xtream ולוח שידורים (EPG)',
      se_radio: 'רדיו ומוזיקה', se_radio_t: 'אלפי תחנות מכל העולם ותחנות משלך',
      se_tg: 'טלגרם', se_tg_t: 'הערוצים, הקבוצות והבוטים שבהם מחפשים',
      se_yt: 'YouTube', se_yt_t: 'מפתח, ערוצים מועדפים ונושאים',
      se_subs: 'כתוביות', se_subs_t: 'אתרי כתוביות, מפתחות ותרגום AI',
      se_search: 'חיפוש בכל מקורות הקטגוריה', se_go: 'חיפוש', se_have: 'המקורות עכשיו', se_on: 'פעיל', se_off: 'כבוי', se_add: 'הוספה',
      se_open: 'פתיחה', se_check: 'בדיקה', se_checking: 'בודק…', se_ok: 'תקין', se_bad: 'לא עונה', se_remove: 'הסרה',
      se_radio_own: 'תחנות משלי', se_radio_name: 'שם התחנה', se_radio_url: 'כתובת הזרם (https)', se_radio_need_https: 'רק כתובת https מתנגנת בדפדפן ובאפליקציות.',
      se_builtin: 'מובנה', se_tg_open: 'הערוצים והקבוצות שלי', se_tg_login: 'חיבור / חשבון טלגרם', se_yt_key: 'מפתח YouTube Data API (לא חובה – יש עוזר מובנה)',
      se_saved: 'נשמר', se_iptv_open: 'עריכת רשימות IPTV, Xtream ו-EPG', se_rd: 'Real-Debrid וחשבונות', se_lib: 'ספקים שבשימוש',
      info_title: 'מידע ועזרה', info_t: 'מדריך, מצב המערכת, אודות ועדכון', m_srcedit: 'עריכת מקורות', ms_srcedit: 'כל המקורות לפי סוג תוכן',
      m_info: 'מידע ועזרה', ms_info: 'מדריך, מצב, עדכון'},
    en: {se_title: 'Edit sources', se_intro: 'Every source of the build by kind of content. In each: the sources there are, adding, editing, switching off, removing and checking - and a search of every source of the category at once.',
      se_video: 'Films and series', se_video_t: 'Catalogue, Telegram, Stremio servers, Real-Debrid, Internet Archive, Dailymotion, YouTube',
      se_live: 'Live TV', se_live_t: 'The build\'s channels, free lists, your own M3U, Xtream and the guide (EPG)',
      se_radio: 'Radio and music', se_radio_t: 'Thousands of stations worldwide and your own',
      se_tg: 'Telegram', se_tg_t: 'The channels, groups and bots that are searched',
      se_yt: 'YouTube', se_yt_t: 'Key, favourite channels and topics',
      se_subs: 'Subtitles', se_subs_t: 'Subtitle sites, keys and AI translation',
      se_search: 'Search every source of this category', se_go: 'Search', se_have: 'The sources now', se_on: 'on', se_off: 'off', se_add: 'Add',
      se_open: 'Open', se_check: 'Check', se_checking: 'Checking…', se_ok: 'works', se_bad: 'does not answer', se_remove: 'Remove',
      se_radio_own: 'My own stations', se_radio_name: 'Station name', se_radio_url: 'Stream address (https)', se_radio_need_https: 'Only an https address plays in a browser and the apps.',
      se_builtin: 'built in', se_tg_open: 'My channels and groups', se_tg_login: 'Telegram sign-in / account', se_yt_key: 'YouTube Data API key (optional - a helper is built in)',
      se_saved: 'Saved', se_iptv_open: 'Edit IPTV lists, Xtream and EPG', se_rd: 'Real-Debrid and accounts', se_lib: 'Providers in use',
      info_title: 'Information and help', info_t: 'Guide, system status, about and update', m_srcedit: 'Edit sources', ms_srcedit: 'Every source by kind of content',
      m_info: 'Information and help', ms_info: 'Guide, status, update'},
    ru: {se_title: 'Редактор источников', se_intro: 'Все источники сборки по видам контента. В каждом: текущие источники, добавление, правка, отключение, удаление и проверка - и поиск сразу по всем источникам категории.',
      se_video: 'Фильмы и сериалы', se_video_t: 'Каталог, Telegram, серверы Stremio, Real-Debrid, Internet Archive, Dailymotion, YouTube',
      se_live: 'ТВ в прямом эфире', se_live_t: 'Каналы сборки, бесплатные списки, свой M3U, Xtream и телепрограмма (EPG)',
      se_radio: 'Радио и музыка', se_radio_t: 'Тысячи станций со всего мира и свои',
      se_tg: 'Telegram', se_tg_t: 'Каналы, группы и боты, в которых ищем',
      se_yt: 'YouTube', se_yt_t: 'Ключ, избранные каналы и темы',
      se_subs: 'Субтитры', se_subs_t: 'Сайты субтитров, ключи и перевод ИИ',
      se_search: 'Искать во всех источниках категории', se_go: 'Поиск', se_have: 'Источники сейчас', se_on: 'вкл', se_off: 'выкл', se_add: 'Добавить',
      se_open: 'Открыть', se_check: 'Проверить', se_checking: 'Проверяю…', se_ok: 'работает', se_bad: 'не отвечает', se_remove: 'Удалить',
      se_radio_own: 'Мои станции', se_radio_name: 'Название станции', se_radio_url: 'Адрес потока (https)', se_radio_need_https: 'В браузере и приложениях играет только адрес https.',
      se_builtin: 'встроено', se_tg_open: 'Мои каналы и группы', se_tg_login: 'Вход / аккаунт Telegram', se_yt_key: 'Ключ YouTube Data API (не обязателен - помощник встроен)',
      se_saved: 'Сохранено', se_iptv_open: 'Править списки IPTV, Xtream и EPG', se_rd: 'Real-Debrid и аккаунты', se_lib: 'Используемые провайдеры',
      info_title: 'Информация и помощь', info_t: 'Справка, состояние, о программе и обновление', m_srcedit: 'Редактор источников', ms_srcedit: 'Все источники по видам контента',
      m_info: 'Информация и помощь', ms_info: 'Справка, состояние, обновление'},
  });
  const t = (k, ...a) => TN.t(k, ...a);
  const esc = TN.esc;
  // the search providers of each category (hub.js filters its search by this when #/search/cat=<cat>&q=...)
  const CATS = {
    video: {providers: ['tmdb', 'tgsearch', 'archive', 'dailymotion', 'yt', 'topics'], icon: 'movies'},
    live: {providers: ['iptv'], icon: 'live'},
    radio: {providers: ['radio'], icon: 'radio'},
    tg: {providers: ['tgsearch'], icon: 'telegram'},
    yt: {providers: ['yt', 'topics'], icon: 'youtube'},
    subs: {providers: [], icon: 'settings'},
  };
  const OWN_RADIO = 'radio_own';
  const ownRadio = () => { const v = TN.get(OWN_RADIO, []); return Array.isArray(v) ? v.filter((x) => x && x.name && /^https:\/\//i.test(String(x.url))) : []; };

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function panel(into, title) { const p = el('div', 'panel'); p.style.cssText = 'margin:0 0 16px;padding:14px 16px'; if (title) p.append(el('h2', '', title)); into.append(p); return p; }
  function row(into, label, sub, actions) {
    const r = el('div', 'hrow');
    r.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--line,rgba(127,127,127,.25))';
    const tx = el('div'); tx.style.cssText = 'flex:1;min-width:160px';
    const b = el('b', '', label); b.dir = 'auto'; tx.append(b);
    if (sub) { const s = el('small', 'hint', sub); s.style.display = 'block'; s.dir = 'auto'; tx.append(s); }
    r.append(tx);
    (actions || []).filter(Boolean).forEach((a) => r.append(a));
    into.append(r);
    return r;
  }
  const btn = (text, fn, ghost) => TN.button('btn' + (ghost ? ' ghost' : ''), text, fn);
  const link = (text, href, ghost) => Object.assign(el('a', 'btn' + (ghost ? ' ghost' : ''), text), {href});
  // a provider switch (the Library's providers_off), shown in the category it belongs to
  function providerSwitch(name, label) {
    const on = TN.providerOn(name);
    const b = btn(t(on ? 'se_on' : 'se_off'), () => {
      const off = (TN.settings.get('providers_off', []) || []).slice();
      TN.settings.set('providers_off', on ? off.concat([name]) : off.filter((x) => x !== name));
      TN.route(true);
    }, !on);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', label + ': ' + t(on ? 'se_on' : 'se_off'));
    return b;
  }
  async function check(url) {
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 10000);
      const r = await fetch(url, {method: 'GET', signal: ctl.signal, cache: 'no-store', mode: 'no-cors'});
      clearTimeout(tm);
      return r.type === 'opaque' || r.ok;
    } catch (e) { return false; }
  }
  function searchBox(into, cat) {
    const f = el('form', 'hubform');
    f.innerHTML = `<input type="search" autocomplete="off" dir="auto" placeholder="${esc(t('se_search'))}" aria-label="${esc(t('se_search'))}">`;
    f.append(btn(t('se_go'), null));
    f.onsubmit = (e) => { e.preventDefault(); const q = f.firstChild.value.trim(); if (q) { TN.store.addSearch(q); TN.go('#/search/' + encodeURIComponent('cat=' + cat + '&q=' + q)); } };
    into.append(f);
  }

  // ------------------------------------------------------------ the pages
  function home() {
    TN.page('srcedit', t('se_title'));
    const view = TN.view();
    view.append(el('p', 'hint', t('se_intro')));
    const g = el('div', 'menu');
    for (const k of Object.keys(CATS)) {
      const a = el('a', 'tile');
      a.href = '#/srcedit/' + k;
      a.innerHTML = `<span class="ic">${TN.icon(CATS[k].icon)}</span><b>${esc(t('se_' + k))}</b><small>${esc(t('se_' + k + '_t'))}</small>`;
      g.append(a);
    }
    view.append(g);
  }
  async function category(cat) {
    TN.page('srcedit', t('se_' + cat));
    const view = TN.view();
    if (CATS[cat].providers.length) searchBox(view, cat);
    if (cat === 'video') {
      const p = panel(view, t('se_have'));
      for (const [name, label] of [['tmdb', t('se_video')], ['tgsearch', 'Telegram'], ['archive', 'Internet Archive'], ['dailymotion', 'Dailymotion'], ['yt', 'YouTube']]) {
        row(p, label, t('se_builtin'), [providerSwitch(name, label)]);
      }
      const p2 = panel(view, t('se_rd') + ' · Stremio');
      const S = await TN.provider('sources').catch(() => null);
      if (S && S.settingsPanel) { const box = el('div'); p2.append(box); await S.settingsPanel(box); }
      row(p2, t('se_rd'), '', [link(t('se_open'), '#/services', true)]);
    } else if (cat === 'live') {
      const p = panel(view, t('se_have'));
      row(p, t('se_iptv_open'), 'M3U · Xtream · EPG (XMLTV)', [link(t('se_open'), '#/live/sources')]);
      row(p, t('se_live'), t('se_builtin'), [providerSwitch('iptv', t('se_live')), link(t('se_open'), '#/live', true)]);
    } else if (cat === 'radio') {
      const p = panel(view, t('se_have'));
      row(p, 'radio-browser.info', t('se_builtin'), [providerSwitch('radio', 'radio-browser'), link(t('se_open'), '#/radio', true)]);
      const p2 = panel(view, t('se_radio_own'));
      const draw = () => {
        p2.querySelectorAll('.hrow, form, .hint').forEach((x) => x.remove());
        ownRadio().forEach((s, i) => {
          const status = el('span', 'hint', '');
          row(p2, s.name, s.url, [status, btn(t('se_check'), async () => { status.textContent = t('se_checking'); status.textContent = (await check(s.url)) ? t('se_ok') : t('se_bad'); }, true),
            btn(t('se_remove'), () => { TN.put(OWN_RADIO, ownRadio().filter((x, j) => j !== i)); draw(); }, true)]);
        });
        const f = el('form', 'links'), n = el('input', 'bk_in'), u = el('input', 'bk_in'), msg = el('p', 'hint', t('se_radio_need_https'));
        n.placeholder = t('se_radio_name'); u.placeholder = t('se_radio_url'); u.type = 'url'; u.dir = 'ltr';
        f.append(n, u, btn(t('se_add'), null));
        f.onsubmit = async (e) => {
          e.preventDefault();
          if (!/^https:\/\//i.test(u.value.trim()) || !n.value.trim()) { msg.textContent = t('se_radio_need_https'); return; }
          msg.textContent = t('se_checking');
          const ok = await check(u.value.trim());
          TN.put(OWN_RADIO, ownRadio().concat([{name: n.value.trim(), url: u.value.trim()}]).slice(-50));
          msg.textContent = t('se_saved') + ' · ' + t(ok ? 'se_ok' : 'se_bad');
          draw();
        };
        p2.append(f, msg);
      };
      draw();
    } else if (cat === 'tg') {
      const p = panel(view, t('se_have'));
      row(p, t('se_tg_open'), t('se_tg_t'), [link(t('se_open'), '#/telegram')]);
      row(p, t('se_tg_login'), '', [link(t('se_open'), '#/tglogin', true)]);
      row(p, 'Telegram', t('se_builtin'), [providerSwitch('tgsearch', 'Telegram')]);
    } else if (cat === 'yt') {
      const p = panel(view, t('se_have'));
      row(p, 'YouTube', t('se_builtin'), [providerSwitch('yt', 'YouTube'), link(t('se_open'), '#/youtube', true)]);
      const f = el('form', 'links'), k = el('input', 'bk_in');
      k.type = 'password'; k.autocomplete = 'off'; k.dir = 'ltr'; k.placeholder = t('se_yt_key'); k.setAttribute('aria-label', t('se_yt_key'));
      const msg = el('p', 'hint');
      f.append(k, btn(t('se_add'), null));
      f.onsubmit = (e) => { e.preventDefault(); TN.settings.set('yt_key', k.value.trim()); k.value = ''; msg.textContent = t('se_saved'); };
      p.append(el('p', 'hint', t('se_yt_key')), f, msg);
    } else if (cat === 'subs') {
      const p = panel(view, null);
      const S = await TN.provider('subs').catch(() => null);
      if (S && S.settingsPanel) { const box = el('div'); p.append(box); S.settingsPanel(box); }
    }
  }
  TN.registerPage('srcedit', (arg) => (CATS[String(arg || '')] ? category(String(arg)) : home()));

  // Information and help: four pages behind one menu entry
  TN.registerPage('info', () => {
    TN.page('info', t('info_title'));
    const g = el('div', 'menu');
    const INFO_ICON = {help: 'help', status: 'status', about: 'info', bn: 'device'};
    for (const [k, title, sub] of [['help', 'm_help', 'ms_help'], ['status', 'm_status', 'ms_status'], ['about', 'm_about', 'ms_about'], ['bn', 'm_bn', 'ms_bn']]) {
      const a = el('a', 'tile');
      a.href = '#/' + k;
      a.innerHTML = `<span class="ic">${TN.icon(INFO_ICON[k])}</span><b>${esc(TN.N ? TN.N(title) : t(title))}</b><small>${esc(TN.N ? TN.N(sub) : t(sub))}</small>`;
      g.append(a);
    }
    TN.view().append(g);
  });

  TN.registerProvider('srcedit', {kinds: ['service'], label: 'Edit sources', CATS, ownRadio,
    // the providers a category search asks (hub.js)
    providersOf: (cat) => (CATS[cat] ? CATS[cat].providers.slice() : null)});
})(typeof self !== 'undefined' ? self : globalThis);
