'use strict';
// WP-9: the Accounts / Services screen (plan rows 36, 41, 42, 46, 51) and the device profile (row 49).
// Pages: #/services, #/device. Every row says what works on the web, what needs the helper Worker and what is
// Kodi only. Nothing secret is ever written to the console or into an address.
(function (TN) {
  TN.i18n.add({
    he: {sv_intro: 'מה מחובר בדפדפן הזה, מה עובד באתר ומה זמין רק באפליקציה ב-Kodi.', sv_on: 'מחובר', sv_off: 'לא מחובר',
         sv_web: 'עובד באתר', sv_kodi: 'רק ב-Kodi', sv_helper_need: 'דורש עוזר (Worker)', sv_open: 'פתיחה', sv_setup: 'הגדרה',
         sv_tg: 'טלגרם', sv_tg_hint: 'סנכרון משתמשים, היסטוריה ומועדפים בין כל המכשירים. כל מכשיר מתחבר בעצמו.',
         sv_sync: 'סנכרון עכשיו', sv_sync_done: 'הסנכרון התחיל', sv_tmdb: 'מפתח TMDb', sv_tmdb_own: 'מפתח של הדפדפן הזה',
         sv_tmdb_acc: 'מפתח מהחשבון המסונכרן', sv_rd: 'Real-Debrid', sv_rd_hint: 'האתר צריך עוזר (Worker) כדי לפנות ל-Real-Debrid.',
         sv_gd: 'Google Drive', sv_gem: 'Gemini (תרגום כתוביות)', sv_gem_test: 'בדיקת המפתח', sv_gem_ok: 'המפתח עובד',
         sv_gem_bad: 'המפתח לא עבד (%s)', sv_gem_none: 'אין מפתח Gemini בהגדרות המסונכרנות', sv_helper: 'עוזר (Worker) אופציונלי',
         sv_helper_hint: 'כתובת https של ה-Worker שלך. ריק = בלי עוזר.', sv_save: 'שמירה', sv_saved: 'נשמר', sv_bad_url: 'כתובת https בלבד',
         sv_trakt: 'Trakt, OpenSubtitles, Ktuvit', sv_trakt_hint: 'החשבונות האלה מוגדרים באפליקציה ב-Kodi.',
         sv_tools: 'כלים', sv_update: 'עדכון האפליקציה', sv_repair: 'תיקון: ניקוי מטמון', sv_reset: 'איפוס הגדרות הדפדפן',
         sv_reset_q: 'ללחוץ שוב כדי לאפס את הגדרות הדפדפן הזה (הרשימות נשארות)', sv_done: 'בוצע', sv_upd_none: 'זו כבר הגרסה האחרונה',
         sv_upd_got: 'נמצאה גרסה חדשה, טוען מחדש...', sv_paste: 'הדבקה מהלוח', sv_paste_hint: 'קישור t.me, קישור וידאו או magnet',
         sv_paste_btn: 'הדבקה', sv_paste_go: 'פתיחה', sv_paste_no: 'הלוח לא זמין כאן; הדביקו בתיבה', sv_paste_unknown: 'לא זוהה קישור שאפשר לפתוח',
         sv_magnet_need: 'magnet נפתח דרך Real-Debrid, שדורש עוזר (Worker)',
         dv_intro: 'איך האתר מסודר במכשיר הזה.', dv_auto: 'אוטומטי', dv_tv: 'טלוויזיה (שלט / מקלדת)', dv_phone: 'טלפון', dv_desktop: 'מחשב',
         dv_tv_hint: 'בטלוויזיה החצים עוברים בין הכפתורים, Enter בוחר ו-Back חוזר.'},
    en: {sv_intro: 'What is connected in this browser, what works on the web and what is in the Kodi app only.', sv_on: 'Connected', sv_off: 'Not connected',
         sv_web: 'Works on the web', sv_kodi: 'Kodi only', sv_helper_need: 'Needs the helper (Worker)', sv_open: 'Open', sv_setup: 'Set up',
         sv_tg: 'Telegram', sv_tg_hint: 'Syncs users, history and favourites between all devices. Every device logs in by itself.',
         sv_sync: 'Sync now', sv_sync_done: 'Sync started', sv_tmdb: 'TMDb key', sv_tmdb_own: 'This browser\'s key',
         sv_tmdb_acc: 'The key from the synced account', sv_rd: 'Real-Debrid', sv_rd_hint: 'The web needs the helper (Worker) to reach Real-Debrid.',
         sv_gd: 'Google Drive', sv_gem: 'Gemini (subtitle translation)', sv_gem_test: 'Test the key', sv_gem_ok: 'The key works',
         sv_gem_bad: 'The key did not work (%s)', sv_gem_none: 'No Gemini key in the synced settings', sv_helper: 'Optional helper (Worker)',
         sv_helper_hint: 'The https address of your Worker. Empty = no helper.', sv_save: 'Save', sv_saved: 'Saved', sv_bad_url: 'https addresses only',
         sv_trakt: 'Trakt, OpenSubtitles, Ktuvit', sv_trakt_hint: 'These accounts are set up in the Kodi app.',
         sv_tools: 'Tools', sv_update: 'Update the app', sv_repair: 'Repair: clear the cache', sv_reset: 'Reset this browser\'s settings',
         sv_reset_q: 'Press again to reset this browser\'s settings (your lists stay)', sv_done: 'Done', sv_upd_none: 'This is already the latest version',
         sv_upd_got: 'A new version was found, reloading...', sv_paste: 'Paste from the clipboard', sv_paste_hint: 'A t.me link, a video link or a magnet',
         sv_paste_btn: 'Paste', sv_paste_go: 'Open', sv_paste_no: 'The clipboard is not available here; paste into the box', sv_paste_unknown: 'No link that can be opened was found',
         sv_magnet_need: 'A magnet opens through Real-Debrid, which needs the helper (Worker)',
         dv_intro: 'How the site is laid out on this device.', dv_auto: 'Automatic', dv_tv: 'TV (remote / keyboard)', dv_phone: 'Phone', dv_desktop: 'Computer',
         dv_tv_hint: 'On a TV the arrows move between buttons, Enter chooses and Back goes back.'},
    ru: {sv_intro: 'Что подключено в этом браузере, что работает на сайте и что есть только в приложении Kodi.', sv_on: 'Подключено', sv_off: 'Не подключено',
         sv_web: 'Работает на сайте', sv_kodi: 'Только в Kodi', sv_helper_need: 'Нужен помощник (Worker)', sv_open: 'Открыть', sv_setup: 'Настроить',
         sv_tg: 'Telegram', sv_tg_hint: 'Синхронизирует пользователей, историю и избранное между устройствами. Каждое устройство входит само.',
         sv_sync: 'Синхронизировать', sv_sync_done: 'Синхронизация началась', sv_tmdb: 'Ключ TMDb', sv_tmdb_own: 'Ключ этого браузера',
         sv_tmdb_acc: 'Ключ из синхронизированного аккаунта', sv_rd: 'Real-Debrid', sv_rd_hint: 'Сайту нужен помощник (Worker) для Real-Debrid.',
         sv_gd: 'Google Drive', sv_gem: 'Gemini (перевод субтитров)', sv_gem_test: 'Проверить ключ', sv_gem_ok: 'Ключ работает',
         sv_gem_bad: 'Ключ не сработал (%s)', sv_gem_none: 'В синхронизированных настройках нет ключа Gemini', sv_helper: 'Помощник (Worker), по желанию',
         sv_helper_hint: 'Адрес https вашего Worker. Пусто = без помощника.', sv_save: 'Сохранить', sv_saved: 'Сохранено', sv_bad_url: 'Только адреса https',
         sv_trakt: 'Trakt, OpenSubtitles, Ktuvit', sv_trakt_hint: 'Эти аккаунты настраиваются в приложении Kodi.',
         sv_tools: 'Инструменты', sv_update: 'Обновить приложение', sv_repair: 'Исправить: очистить кэш', sv_reset: 'Сбросить настройки браузера',
         sv_reset_q: 'Нажмите ещё раз, чтобы сбросить настройки этого браузера (списки останутся)', sv_done: 'Готово', sv_upd_none: 'Это уже последняя версия',
         sv_upd_got: 'Найдена новая версия, перезагрузка...', sv_paste: 'Вставить из буфера', sv_paste_hint: 'Ссылка t.me, ссылка на видео или magnet',
         sv_paste_btn: 'Вставить', sv_paste_go: 'Открыть', sv_paste_no: 'Буфер здесь недоступен; вставьте в поле', sv_paste_unknown: 'Не найдено ссылки, которую можно открыть',
         sv_magnet_need: 'Magnet открывается через Real-Debrid, которому нужен помощник (Worker)',
         dv_intro: 'Как сайт выглядит на этом устройстве.', dv_auto: 'Автоматически', dv_tv: 'Телевизор (пульт / клавиатура)', dv_phone: 'Телефон', dv_desktop: 'Компьютер',
         dv_tv_hint: 'На телевизоре стрелки переходят между кнопками, Enter выбирает, Back возвращает.'},
  });
  const t = TN.t, esc = TN.esc;

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function linkBtn(cls, text, hash) { const a = el('a', cls, text); a.href = hash; return a; }
  // one row: name, state tag, hint, and action buttons
  function row(name, state, hint, ...acts) {
    const box = el('div', 'panel sv_row');
    const head = el('div', 'sv_head');
    head.append(el('b', '', name));
    if (state) head.append(el('span', 'tag' + (state.on ? '' : ' sv_dim'), state.text));
    box.append(head);
    if (hint) { const p = el('p', 'hint', hint); p.dir = 'auto'; box.append(p); }
    const live = el('span', 'hint sv_msg'); live.setAttribute('role', 'status');
    if (acts.length) { const l = el('div', 'links'); l.append(...acts.filter(Boolean)); box.append(l); }
    box.append(live);
    box.say = (s) => { live.textContent = s; };
    return box;
  }
  function style() {
    if (document.getElementById('sv_css')) return;
    const s = el('style'); s.id = 'sv_css';
    s.textContent = '.sv_list{display:grid;gap:12px;margin-top:16px;max-width:760px}.sv_row{display:grid;gap:6px}' +
      '.sv_head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.sv_dim{background:var(--panel2);color:var(--muted)}' +
      '.sv_row input{flex:1 1 220px;min-width:0;background:var(--panel);color:var(--text);border:1px solid var(--panel2);border-radius:10px;padding:9px 14px;font:inherit}' +
      '.sv_h2{margin:22px 0 0;font-size:18px}.dv_opts{display:grid;gap:10px;max-width:520px;margin-top:16px}' +
      '.dv_opts .btn.on{box-shadow:0 0 0 2px var(--ring)}';
    document.head.append(s);
  }
  const tgSaved = () => !!(TN.get('tg_session', '') && TN.get('tg_api', null));

  // ------------------------------------------------------------ clipboard routing (row 51) - pure, tested in node
  function classify(text) {
    const s = String(text || '').trim();
    if (/^magnet:\?/i.test(s)) return {kind: 'magnet', url: s};
    const m = s.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:c\/)?[A-Za-z0-9_+\-/]+/i);
    if (m) return {kind: 'telegram', url: m[0].startsWith('http') ? m[0] : 'https://' + m[0]};
    const u = s.match(/https:\/\/[^\s"'<>]+/i);
    if (u) {
      if (/\.(m3u8|mp4|webm|mkv|mp3|aac|m4a|ogg|mpd)(\?|#|$)/i.test(u[0])) return {kind: 'media', url: u[0]};
      if (/(youtube\.com\/watch|youtu\.be\/)/i.test(u[0])) return {kind: 'youtube', url: u[0]};
      return {kind: 'web', url: u[0]};
    }
    return {kind: '', url: ''};
  }
  async function openPasted(text, say) {
    const c = classify(text);
    if (c.kind === 'telegram') return TN.go(TN.link('telegram', {link: c.url}));
    if (c.kind === 'youtube') return TN.go(TN.link('youtube', {url: c.url}));
    if (c.kind === 'media') {
      const p = await TN.provider('player').catch(() => null);
      if (p && p.open) return p.open({url: c.url, title: c.url.split('/').pop().split('?')[0]});
      window.open(c.url, '_blank', 'noopener');
      return;
    }
    if (c.kind === 'magnet') {
      const rd = TN.settings.helper() ? await TN.provider('rd').catch(() => null) : null;
      if (rd && rd.magnet) return rd.magnet(c.url);
      return say(t('sv_magnet_need'));
    }
    if (c.kind === 'web') { window.open(c.url, '_blank', 'noopener'); return; }
    say(t('sv_paste_unknown'));
  }

  async function updateApp(say) {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration().catch(() => null);
    if (reg) await reg.update().catch(() => {});
    if (reg && (reg.installing || reg.waiting)) { say(t('sv_upd_got')); setTimeout(() => location.reload(), 1200); } else say(t('sv_upd_none'));
  }
  async function testGemini(key) {
    // the key goes in a header, never in the address
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {headers: {'x-goog-api-key': key}});
    return r.status;
  }

  async function pageServices(arg, ctx) {
    style();
    TN.page('services', t('m_services'));
    const view = TN.view();
    const intro = el('p', 'hint', t('sv_intro')); view.append(intro);
    const list = el('div', 'sv_list'); view.append(list);
    const synced = TN.settings.synced();
    const helper = TN.settings.helper();

    // Telegram
    let tgState = null;
    if (window.TG && window.TG.ready) { try { tgState = window.TG.status(); } catch (e) {} }
    const tgOn = tgState ? tgState.state === 'on' : false;
    const tgRow = row(t('sv_tg'), {on: tgOn, text: tgOn ? t('sv_on') + (tgState.name ? ' · ' + tgState.name : '') : (tgSaved() ? t('sv_web') : t('sv_off'))},
      t('sv_tg_hint'), linkBtn('btn ghost', t('sv_setup'), '#/settings'),
      (tgOn || tgSaved()) ? TN.button('btn', t('sv_sync'), async () => {
        try { const TG = await TN.tg(); TG.syncNow(); tgRow.say(t('sv_sync_done')); } catch (e) { tgRow.say(String(e && e.message || e)); }
      }) : null);
    list.append(tgRow);

    // TMDb
    const own = !!String(TN.settings.get('tmdb', '') || '').trim();
    list.append(row(t('sv_tmdb'), {on: TN.hasTmdbKey(), text: own ? t('sv_tmdb_own') : TN.hasTmdbKey() ? t('sv_tmdb_acc') : t('sv_off')},
      '', linkBtn('btn ghost', t('sv_setup'), '#/settings')));

    // helper Worker
    const hRow = row(t('sv_helper'), {on: !!helper, text: helper ? t('sv_on') : t('sv_off')}, t('sv_helper_hint'));
    const form = el('form', 'links');
    const inp = el('input'); inp.type = 'url'; inp.placeholder = 'https://...workers.dev'; inp.value = helper; inp.dir = 'ltr';
    inp.setAttribute('aria-label', t('sv_helper'));
    const sv = el('button', 'btn', t('sv_save')); sv.type = 'submit';
    form.append(inp, sv);
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = inp.value.trim().replace(/\/+$/, '');
      if (v && !/^https:\/\/[^\s/]+/i.test(v)) return hRow.say(t('sv_bad_url'));
      TN.settings.set('helper', v); hRow.say(t('sv_saved'));
    };
    hRow.insertBefore(form, hRow.lastChild);
    list.append(hRow);

    // Real-Debrid
    list.append(row(t('sv_rd'), {on: !!helper, text: helper ? t('sv_web') : t('sv_helper_need')}, t('sv_rd_hint')));
    // Google Drive
    list.append(row(t('sv_gd'), {on: !!TN.settings.get('gdrive_client', ''), text: TN.settings.get('gdrive_client', '') ? t('sv_web') : t('sv_setup')},
      '', linkBtn('btn ghost', t('sv_open'), '#/gdrive'), linkBtn('btn ghost', t('m_backup'), '#/backup')));
    // Gemini (row 36: test the key)
    const gKey = String(synced.gemini_key || synced.gemini || '').trim();
    const gRow = row(t('sv_gem'), {on: !!gKey, text: gKey ? t('sv_on') : t('sv_off')}, '',
      TN.button('btn ghost', t('sv_gem_test'), async () => {
        if (!gKey) return gRow.say(t('sv_gem_none'));
        gRow.say('...');
        try { const st = await testGemini(gKey); gRow.say(st === 200 ? t('sv_gem_ok') : t('sv_gem_bad', st)); } catch (e) { gRow.say(t('sv_gem_bad', 'network')); }
      }));
    list.append(gRow);
    list.append(row(t('sv_trakt'), {on: false, text: t('sv_kodi')}, t('sv_trakt_hint')));

    // tools (rows 36, 46, 51)
    view.append(el('h2', 'sv_h2', t('sv_tools')));
    const tools = el('div', 'sv_list'); view.append(tools);
    let resetArmed = false;
    const tRow = row(t('sv_tools'), null, '',
      TN.button('btn', t('sv_update'), () => updateApp(tRow.say)),
      TN.button('btn ghost', t('sv_repair'), async () => { await TN.clearCaches(); tRow.say(t('sv_done')); setTimeout(() => location.reload(), 800); }),
      linkBtn('btn ghost', t('m_status'), '#/status'),
      TN.button('btn ghost', t('sv_reset'), () => {
        if (!resetArmed) { resetArmed = true; return tRow.say(t('sv_reset_q')); }
        TN.drop('cfg'); tRow.say(t('sv_done')); setTimeout(() => location.reload(), 600);
      }));
    tRow.querySelector('.sv_head').remove();
    tools.append(tRow);

    const pRow = row(t('sv_paste'), null, t('sv_paste_hint'));
    const pf = el('form', 'links');
    const pi = el('input'); pi.type = 'text'; pi.dir = 'ltr'; pi.setAttribute('aria-label', t('sv_paste'));
    const pb = el('button', 'btn ghost', t('sv_paste_btn')); pb.type = 'button';
    pb.onclick = async () => {
      try { pi.value = await navigator.clipboard.readText(); } catch (e) { pRow.say(t('sv_paste_no')); pi.focus(); return; }
      if (pi.value) openPasted(pi.value, pRow.say);
    };
    const pg = el('button', 'btn', t('sv_paste_go')); pg.type = 'submit';
    pf.append(pi, pb, pg);
    pf.onsubmit = (e) => { e.preventDefault(); openPasted(pi.value, pRow.say); };
    pRow.insertBefore(pf, pRow.lastChild);
    tools.append(pRow);
  }

  function pageDevice() {
    style();
    TN.page('device', t('m_device'));
    const view = TN.view();
    view.append(el('p', 'hint', t('dv_intro')));
    const box = el('div', 'dv_opts'); view.append(box);
    const cur = TN.settings.get('device', 'auto') || 'auto';
    for (const k of ['auto', 'tv', 'phone', 'desktop']) {
      const b = TN.button('btn' + (k === cur ? ' on' : ' ghost'), t('dv_' + k), () => { TN.settings.set('device', k); pageDevice(); });
      b.setAttribute('aria-pressed', String(k === cur));
      box.append(b);
    }
    view.append(el('p', 'hint', t('dv_tv_hint')));
    const f = box.querySelector('.on'); if (f) f.focus();
  }

  TN.registerPage('services', pageServices);
  TN.registerPage('device', pageDevice);
  self.TNServices = {classify};                     // for tests
})(self.TN);
