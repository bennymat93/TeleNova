'use strict';
// WP-9: backup / restore (plan rows 36, 43). The zip has the shape of the build's backup (backup.make_zip):
//   bn_backup.txt                                        the marker restore_zip looks for
//   addon_data/plugin.video.nova/users.json              the users (users.py LIST)
//   addon_data/plugin.video.nova/<file>.json             the active user's lists (users.py FILES)
//   addon_data/plugin.video.nova/users/<id>/<file>.json  every other user's lists
//   web/bn_web.json                                      this browser's settings (Kodi's restore ignores it)
// so a web backup restores in Kodi and a Kodi backup restores here (only the lists and users; the Kodi settings,
// IPTV and add-on files in it are not for a browser). Here a restore MERGES into what the browser has (the same
// merge as the sync), so nothing is lost. The Telegram session is never part of a backup.
(function (root) {
  const NOVA = 'addon_data/plugin.video.nova/';
  const FILES = [['history.json', 'history', []], ['favourites.json', 'favourites', []], ['favourites_removed.json', 'removed', []],
                 ['search_history.json', 'searches', []], ['user_marks.json', 'marks', null]];
  const MARK = 'bn_backup.txt', WEB = 'web/bn_web.json', MAX = 20 * 1024 * 1024;
  const ID_RX = /^[A-Za-z0-9_-]{1,40}$/;
  // never in a backup: this device's choices and anything that signs in
  const CFG_SKIP = ['helper_token'];

  // ------------------------------------------------------------ pure (node tests: src/qa/web via services tests)
  // store: the Store object (store.js), SD: SyncDoc, cfg: this browser's settings -> {path: text}
  function makeFiles(store, SD, cfg, now) {
    const out = {};
    out[MARK] = 'BN Stream backup ' + new Date(now || Date.now()).toString() + ' (web)\n';
    const users = store.users();
    out[NOVA + 'users.json'] = SD.canon(users);
    const cur = store.current();
    for (const u of users) {
      if (!u || Number(u.deleted || 0) || !ID_RX.test(String(u.id))) continue;
      const d = store.data(u.id);
      const base = u.id === cur ? NOVA : NOVA + 'users/' + u.id + '/';
      for (const [name, key, dflt] of FILES) {
        const v = d[key];
        if (dflt && Array.isArray(v) && !v.length) continue;
        if (!dflt && (!v || !Object.keys(v).length)) continue;
        out[base + name] = SD.canon(v);
      }
    }
    if (cfg) {
      const c = Object.assign({}, cfg);
      CFG_SKIP.forEach((k) => delete c[k]);
      out[WEB] = JSON.stringify({cfg: c, current: cur, made: Math.floor((now || Date.now()) / 1000)});
    }
    return out;
  }
  // {path: text} of a zip -> {ok, users, data: {uid: {...}}, current, web}
  function readFiles(files, SD) {
    if (!(MARK in files)) return {ok: false};
    const parse = (p, d) => { try { return p in files ? SD.parse(files[p]) : d; } catch (e) { return d; } };
    let users = parse(NOVA + 'users.json', null);
    if (!Array.isArray(users) || !users.length) users = [{id: 'u1', name: '', created: 1, renamed: 0, deleted: 0}];
    const folders = new Set();
    for (const p of Object.keys(files)) {
      const m = p.slice(NOVA.length).match(/^users\/([^/]+)\//);
      if (p.startsWith(NOVA) && m && ID_RX.test(m[1])) folders.add(m[1]);
    }
    const web = parse(WEB, null);
    const live = users.filter((u) => u && !Number(u.deleted || 0)).map((u) => String(u.id));
    // the active user of the device that made it: its lists are the ones at the top (Kodi: sync_state.json, which
    // never travels; a web backup says it in web/bn_web.json)
    let current = web && live.includes(web.current) ? web.current : (live.find((id) => !folders.has(id)) || live[0] || 'u1');
    const data = {};
    for (const id of live) {
      const base = id === current ? NOVA : NOVA + 'users/' + id + '/';
      const d = {};
      for (const [name, key, dflt] of FILES) {
        const v = parse(base + name, dflt || SD.dict());
        d[key] = dflt ? (Array.isArray(v) ? v : []) : (v && typeof v === 'object' && !Array.isArray(v) ? v : SD.dict());
      }
      data[id] = d;
    }
    return {ok: true, users, data, current, web: web && typeof web === 'object' ? web : null};
  }
  // merge a read backup into the store -> number of users touched
  function restoreInto(store, SD, b) {
    const users = SD.merge_users(store.users(), b.users);
    store.setUsers(users);
    const alive = new Set(store.live().map((u) => u.id));
    let n = 0;
    for (const [id, d] of Object.entries(b.data)) {
      if (!alive.has(id)) continue;
      if (store.putData(id, SD.merge_user_data(store.data(id), d))) n++;
    }
    return n;
  }
  const core = {makeFiles, readFiles, restoreInto, NOVA, MARK, WEB, MAX};
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }

  // ------------------------------------------------------------ the page
  const TN = root.TN;
  root.TNBackup = core;
  TN.i18n.add({
    he: {bk_intro: 'גיבוי של המשתמשים, ההיסטוריה, המועדפים והחיפושים, באותו מבנה של הגיבוי ב-Kodi: אפשר לשחזר אותו ב-Kodi, ולשחזר כאן גיבוי שנעשה ב-Kodi.',
         bk_make: 'הורדת גיבוי', bk_restore: 'שחזור מקובץ', bk_made: 'הגיבוי נשמר (%s)', bk_bad: 'זה אינו קובץ גיבוי של BN Stream',
         bk_done: 'השחזור הושלם: %s משתמשים עודכנו. מה שהיה בדפדפן נשאר, והגיבוי מוזג אליו.', bk_cfg: 'לשחזר גם את הגדרות הדפדפן מהגיבוי',
         bk_note: 'גיבוי לא כולל את הכניסה לטלגרם: כל מכשיר מתחבר בעצמו. הגיבוי כולל את מפתח ה-TMDb של הדפדפן אם הוגדר; שמרו אותו במקום פרטי.',
         bk_drive: 'גיבוי ל-Google Drive', bk_big: 'הקובץ גדול מדי', bk_wait: 'רגע...', bk_fail: 'לא הצליח: %s'},
    en: {bk_intro: 'A backup of the users, history, favourites and searches, in the same shape as the Kodi backup: it restores in Kodi, and a Kodi backup restores here.',
         bk_make: 'Download a backup', bk_restore: 'Restore from a file', bk_made: 'Backup saved (%s)', bk_bad: 'This is not a BN Stream backup file',
         bk_done: 'Restored: %s users updated. What this browser had stays; the backup was merged into it.', bk_cfg: 'Also restore this browser\'s settings from the backup',
         bk_note: 'A backup never holds the Telegram login: every device logs in by itself. It holds this browser\'s TMDb key if one is set; keep it somewhere private.',
         bk_drive: 'Back up to Google Drive', bk_big: 'The file is too large', bk_wait: 'One moment...', bk_fail: 'Did not work: %s'},
    ru: {bk_intro: 'Резервная копия пользователей, истории, избранного и поисков в том же формате, что в Kodi: её можно восстановить в Kodi, а копию из Kodi — здесь.',
         bk_make: 'Скачать копию', bk_restore: 'Восстановить из файла', bk_made: 'Копия сохранена (%s)', bk_bad: 'Это не файл резервной копии BN Stream',
         bk_done: 'Восстановлено: обновлено пользователей — %s. Данные браузера сохранены, копия объединена с ними.', bk_cfg: 'Восстановить и настройки браузера из копии',
         bk_note: 'Копия не содержит вход в Telegram: каждое устройство входит само. В ней есть ключ TMDb браузера, если он задан; храните её в надёжном месте.',
         bk_drive: 'Копия в Google Drive', bk_big: 'Файл слишком большой', bk_wait: 'Минутку...', bk_fail: 'Не получилось: %s'},
  });
  const t = TN.t;
  const FFLATE = ['https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js', 'sha384-DT0Ls0mO7JmjTnT+oBuMhEJzYJO1zUqzuuMXNdnOmOQRIpN2BgSjvBV/j50NngIT'];
  async function fflate() { if (!root.fflate) await TN.loadScript(FFLATE[0], FFLATE[1]); return root.fflate; }
  const cfgNow = () => { const c = TN.get('cfg', {}) || {}; return typeof c === 'object' ? c : {}; };

  async function makeZip() {
    const F = await fflate();
    const files = makeFiles(TN.store, TN.SyncDoc, cfgNow());
    const z = {};
    for (const [p, s] of Object.entries(files)) z[p] = F.strToU8(s);
    return new Blob([F.zipSync(z, {level: 6})], {type: 'application/zip'});
  }
  function zipName() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return 'bn_backup_web_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + '.zip';
  }
  async function readZip(bytes) {
    const F = await fflate();
    let total = 0;
    const raw = F.unzipSync(bytes, {filter: (f) => {
      const ok = (f.name === MARK || f.name === WEB || (f.name.startsWith(NOVA) && f.name.endsWith('.json'))) && f.originalSize <= MAX;
      if (ok) total += f.originalSize;
      return ok && total <= 4 * MAX;
    }});
    const files = {};
    for (const [p, u8] of Object.entries(raw)) files[p] = F.strFromU8(u8);
    return readFiles(files, TN.SyncDoc);
  }
  // used by gdrive.js too: bytes of a zip -> message
  async function restoreBytes(bytes, withCfg) {
    const b = await readZip(bytes);
    if (!b.ok) throw new Error(t('bk_bad'));
    const n = restoreInto(TN.store, TN.SyncDoc, b);
    if (withCfg && b.web && b.web.cfg && typeof b.web.cfg === 'object') {
      for (const [k, v] of Object.entries(b.web.cfg)) if (k !== 'helper_token') TN.settings.set(k, v);
    }
    return t('bk_done', n);
  }
  root.TNBackup = Object.assign({}, core, {makeZip, zipName, restoreBytes});

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function pageBackup() {
    TN.page('backup', t('m_backup'));
    const view = TN.view();
    const box = el('div', 'panel settings'); view.append(box);
    box.append(el('p', '', t('bk_intro')));
    const acts = el('div', 'links');
    const msg = el('span', 'hint'); msg.setAttribute('role', 'status');
    const say = (s) => { msg.textContent = s; };
    const file = el('input'); file.type = 'file'; file.accept = '.zip,application/zip'; file.hidden = true;
    const cfgBox = el('label'); const cb = el('input'); cb.type = 'checkbox'; cfgBox.style.cssText = 'display:flex;gap:8px;align-items:center;font-weight:400';
    cfgBox.append(cb, document.createTextNode(t('bk_cfg')));
    acts.append(TN.button('btn', t('bk_make'), async () => {
      say(t('bk_wait'));
      try {
        const blob = await makeZip(), name = zipName();
        const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        say(t('bk_made', name));
      } catch (e) { say(t('bk_fail', e && e.message || e)); }
    }), TN.button('btn ghost', t('bk_restore'), () => file.click()));
    const gd = el('a', 'btn ghost', t('bk_drive')); gd.href = '#/gdrive'; acts.append(gd);
    file.onchange = async () => {
      const f = file.files && file.files[0]; file.value = '';
      if (!f) return;
      if (f.size > 200 * 1024 * 1024) return say(t('bk_big'));
      say(t('bk_wait'));
      try { say(await restoreBytes(new Uint8Array(await f.arrayBuffer()), cb.checked)); } catch (e) { say(t('bk_fail', e && e.message || e)); }
    };
    box.append(acts, cfgBox, file, msg, el('p', 'hint', t('bk_note')));
  }
  TN.registerPage('backup', pageBackup);
})(typeof self !== 'undefined' ? self : globalThis);
