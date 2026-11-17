'use strict';
// WP-9: Status (plan rows 45, 50): internet, the services the site talks to, the app (service worker, version),
// Telegram, the helper Worker, and a speed test. Every check is a plain request with nothing secret in it.
(function (TN) {
  TN.i18n.add({
    he: {st_net: 'אינטרנט', st_app: 'האפליקציה', st_sw_on: 'עובדת גם בלי רשת', st_sw_off: 'בלי מטמון לא מקוון', st_tg: 'טלגרם',
         st_helper: 'עוזר (Worker)', st_ok: 'תקין (%s ms)', st_fail: 'לא זמין', st_none: 'לא הוגדר', st_wait: 'בודק...', st_again: 'בדיקה חוזרת',
         st_speed: 'בדיקת מהירות', st_speed_go: 'להתחיל', st_speed_res: '%s Mbps', st_speed_hint: 'הורדה של כ-10MB ומדידת הזמן.',
         st_tg_on: 'מחובר', st_tg_off: 'לא מחובר', st_tg_saved: 'שמור במכשיר, לא פעיל כעת', st_sync_last: 'סנכרון אחרון: %s', st_online: 'מחובר', st_offline: 'אין רשת'},
    en: {st_net: 'Internet', st_app: 'The app', st_sw_on: 'Works offline too', st_sw_off: 'No offline cache', st_tg: 'Telegram',
         st_helper: 'Helper (Worker)', st_ok: 'OK (%s ms)', st_fail: 'Not reachable', st_none: 'Not set', st_wait: 'Checking...', st_again: 'Check again',
         st_speed: 'Speed test', st_speed_go: 'Start', st_speed_res: '%s Mbps', st_speed_hint: 'Downloads about 10 MB and times it.',
         st_tg_on: 'Connected', st_tg_off: 'Not connected', st_tg_saved: 'Saved on this device, not active now', st_sync_last: 'Last sync: %s', st_online: 'Online', st_offline: 'Offline'},
    ru: {st_net: 'Интернет', st_app: 'Приложение', st_sw_on: 'Работает и без сети', st_sw_off: 'Нет офлайн-кэша', st_tg: 'Telegram',
         st_helper: 'Помощник (Worker)', st_ok: 'OK (%s мс)', st_fail: 'Недоступно', st_none: 'Не задан', st_wait: 'Проверка...', st_again: 'Проверить снова',
         st_speed: 'Тест скорости', st_speed_go: 'Начать', st_speed_res: '%s Мбит/с', st_speed_hint: 'Скачивает около 10 МБ и замеряет время.',
         st_tg_on: 'Подключено', st_tg_off: 'Не подключено', st_tg_saved: 'Сохранено на устройстве, сейчас не активно', st_sync_last: 'Последняя синхронизация: %s', st_online: 'В сети', st_offline: 'Нет сети'},
  });
  const t = TN.t;
  // name, address: reachable = any answer (an opaque one counts); the address carries no key
  const PINGS = [['GitHub Pages', 'version.js'], ['TMDb', 'https://api.themoviedb.org/3/configuration'], ['Telegram', 'https://web.telegram.org/'],
                 ['YouTube', 'https://www.youtube-nocookie.com/'], ['Internet Archive', 'https://archive.org/services/search/v1/scrape?q=x&count=100'],
                 ['Radio Browser', 'https://de1.api.radio-browser.info/json/stats'], ['jsDelivr', 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/package.json']];
  const SPEED = [['https://speed.cloudflare.com/__down?bytes=10000000', 10000000], ['vendor/gramjs-2.26.21.min.js', 0]];

  async function ping(url, ms = 8000) {
    const c = new AbortController(), timer = setTimeout(() => c.abort(), ms), t0 = performance.now();
    try {
      const same = !/^https?:/.test(url);
      await fetch(url + (same ? '?_=' + Date.now() : ''), {mode: same ? 'same-origin' : 'no-cors', cache: 'no-store', signal: c.signal, credentials: 'omit'});
      return Math.round(performance.now() - t0);
    } catch (e) { return -1; } finally { clearTimeout(timer); }
  }
  async function speed() {
    for (const [url, size] of SPEED) {
      try {
        const t0 = performance.now();
        const r = await fetch(url + (url.includes('?') ? '&' : '?') + '_=' + Date.now(), {cache: 'no-store', credentials: 'omit'});
        if (!r.ok) continue;
        const n = (await r.arrayBuffer()).byteLength || size;
        const s = (performance.now() - t0) / 1000;
        if (n > 100000 && s > 0) return (n * 8 / s / 1e6).toFixed(1);
      } catch (e) { /* the next one */ }
    }
    return null;
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function line(list, name) {
    const r = el('div', 'panel st_row'); const v = el('span', 'tag st_dim', t('st_wait'));
    r.append(el('b', '', name), v); list.append(r);
    return (text, ok) => { v.textContent = text; v.className = 'tag' + (ok ? '' : ' st_dim'); };
  }

  async function pageStatus(arg, ctx) {
    TN.page('status', t('m_status'));
    const view = TN.view();
    if (!document.getElementById('st_css')) {
      const s = el('style'); s.id = 'st_css';
      s.textContent = '.st_list{display:grid;gap:8px;margin-top:16px;max-width:640px}.st_row{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}' +
        '.st_dim{background:var(--panel2);color:var(--muted)}';
      document.head.append(s);
    }
    const list = el('div', 'st_list'); view.append(list);
    line(list, t('st_net'))(navigator.onLine ? t('st_online') : t('st_offline'), navigator.onLine);
    const sw = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    line(list, t('st_app') + ' ' + TN.version)(t(sw ? 'st_sw_on' : 'st_sw_off'), sw);
    // Telegram: only what tg.js says if it is loaded; nothing is started from here
    let tg = null; if (window.TG && window.TG.ready) { try { tg = window.TG.status(); } catch (e) {} }
    const saved = !!(TN.get('tg_session', '') && TN.get('tg_api', null));
    const tgSet = line(list, t('st_tg'));
    if (tg && tg.state === 'on') tgSet(t('st_tg_on') + (tg.last ? ' · ' + t('st_sync_last', new Date(tg.last * (tg.last < 1e12 ? 1000 : 1)).toLocaleTimeString()) : ''), true);
    else tgSet(saved ? t('st_tg_saved') : t('st_tg_off'), false);
    const helper = TN.settings.helper();
    const hSet = line(list, t('st_helper'));
    const jobs = [];
    if (helper) jobs.push(ping(helper + '/').then((ms) => hSet(ms >= 0 ? t('st_ok', ms) : t('st_fail'), ms >= 0))); else hSet(t('st_none'), false);
    for (const [name, url] of PINGS) { const set = line(list, name); jobs.push(ping(url).then((ms) => { if (ctx.current()) set(ms >= 0 ? t('st_ok', ms) : t('st_fail'), ms >= 0); })); }
    const acts = el('div', 'links');
    acts.append(TN.button('btn ghost', t('st_again'), () => TN.route()));
    view.append(acts);
    // speed test
    const sp = el('div', 'panel settings'); sp.style.marginTop = '16px';
    const res = el('b', '', ''); res.setAttribute('role', 'status');
    const go = TN.button('btn', t('st_speed_go'), async () => {
      go.disabled = true; res.textContent = t('st_wait');
      const v = await speed();
      go.disabled = false; res.textContent = v ? t('st_speed_res', v) : t('st_fail');
    });
    sp.append(el('h2', '', t('st_speed')), el('p', 'hint', t('st_speed_hint')), go, res);
    view.append(sp);
    await Promise.all(jobs);
  }
  TN.registerPage('status', pageStatus);
})(self.TN);
