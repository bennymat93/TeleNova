'use strict';
// TeleNova web (WP-5): find the ways to play a title and let the viewer choose one (plan rows 9, 10, 35).
// Order, as in the build: Telegram (tgsearch) -> Real-Debrid through Torrentio (rd.js, token mode) -> the viewer's
// Stremio addon servers -> Internet Archive -> YouTube -> anything else registered. One "links" sheet with quality,
// language, size and status per row, like the TeleScope hub screen.
// Service 'sources' (MODULES.md): open(req) | pick(req), find(req, {signal, onRows}), register(name, fn), addons(),
// setAddons(list), nextEpisode(req), resumeOf(key), keyOf(req), parseStream(stream, addon), settingsPanel(el).
// req = {type:'movie'|'tv', id (TMDb), imdb, title, original, year, season, episode, poster}
// Nothing here logs a URL: an addon URL or a Torrentio link can hold the viewer's token.
(function (G) {
  // ------------------------------------------------------------ pure helpers (also tested in node)
  const QUAL = [[/\b(2160p|4k|uhd)\b/i, 2160], [/\b1440p\b/i, 1440], [/\b(1080p|fhd)\b/i, 1080], [/\b720p\b/i, 720],
    [/\b(576p|480p|sd|dvdrip|xvid)\b/i, 480], [/\b360p\b/i, 360]];
  const FLAGS = {'🇮🇱': 'he', '🇷🇺': 'ru', '🇬🇧': 'en', '🇺🇸': 'en', '🇺🇦': 'uk', '🇫🇷': 'fr', '🇩🇪': 'de', '🇪🇸': 'es', '🇮🇹': 'it',
    '🇯🇵': 'ja', '🇰🇷': 'ko', '🇨🇳': 'zh', '🇵🇹': 'pt', '🇧🇷': 'pt', '🇹🇷': 'tr', '🇵🇱': 'pl', '🇳🇱': 'nl', '🇸🇦': 'ar', '🇮🇳': 'hi'};
  const WORDS = [[/\b(heb|hebrew|עברית)\b/i, 'he'], [/\b(rus|russian)\b|русск/i, 'ru'], [/\b(multi)\b/i, 'multi']];
  function quality(text) { for (const [re, q] of QUAL) if (re.test(text)) return q; return 0; }
  function sizeBytes(text) {
    const m = /([\d.,]+)\s*(TB|GB|MB|KB)\b/i.exec(text || '');
    if (!m) return 0;
    const n = parseFloat(m[1].replace(',', '.'));
    return Math.round(n * {KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776}[m[2].toUpperCase()]);
  }
  function langs(text) {
    const out = new Set();
    for (const [f, l] of Object.entries(FLAGS)) if (text.includes(f)) out.add(l);
    for (const [re, l] of WORDS) if (re.test(text)) out.add(l);
    return [...out];
  }
  function sizeText(b) { return !b ? '' : b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.round(b / 1048576) + ' MB'; }
  // a Stremio stream object -> one row. status: 'cached' (RD+), 'rd' (RD will download first), 'direct', 'torrent'
  // (an info hash only: a browser cannot play it), 'external' (only a page link)
  function parseStream(s, addon) {
    const name = String((s && s.name) || ''), title = String((s && (s.title || s.description)) || '');
    const all = name + '\n' + title;
    const file = (s && s.behaviorHints && s.behaviorHints.filename) || title.split('\n')[0] || name;
    let status = 'direct';
    if (/\[RD\+\]|\[RD ✓\]|RD\+/.test(name)) status = 'cached';
    else if (/\[RD( download)?\]|\[RD ⏳\]|\bRD\b/.test(name)) status = 'rd';
    if (!s || !s.url) status = s && s.infoHash ? 'torrent' : 'external';
    const url = s && typeof s.url === 'string' && /^https:\/\//i.test(s.url) ? s.url : '';
    const seeds = /👤\s*(\d+)/.exec(title);
    return {label: String(file).trim(), quality: quality(all), lang: langs(all).join(','), size: sizeBytes(title),
      seeds: seeds ? +seeds[1] : 0, status: url ? status : (status === 'direct' ? 'external' : status), url,
      ext: !url && s && /^https:\/\//i.test(s.externalUrl || '') ? s.externalUrl : '', addon: addon || '',
      notWeb: !!(s && s.behaviorHints && s.behaviorHints.notWebReady)};
  }
  // the order the build uses: cached first, then quality (wanted ceiling 1080p first, like the hub), then size
  const STATUS_RANK = {cached: 0, direct: 1, rd: 2, external: 3, torrent: 4};
  function sortRows(rows, langPref) {
    const pref = langPref || '';
    return rows.slice().sort((a, b) => (STATUS_RANK[a.status] || 0) - (STATUS_RANK[b.status] || 0) ||
      (b.lang.includes(pref) ? 1 : 0) - (a.lang.includes(pref) ? 1 : 0) ||
      (b.quality > 1080 ? 900 : b.quality) - (a.quality > 1080 ? 900 : a.quality) || (b.seeds || 0) - (a.seeds || 0) || (b.size || 0) - (a.size || 0));
  }
  function streamId(req) {
    if (!req.imdb) return '';
    return req.type === 'tv' ? `${req.imdb}:${req.season}:${req.episode}` : req.imdb;
  }
  // an addon manifest URL -> its base (stremio://, trailing /manifest.json, https only)
  function addonBase(u) {
    let s = String(u || '').trim().replace(/^stremio:\/\//i, 'https://');
    s = s.replace(/\/manifest\.json(\?.*)?$/i, '').replace(/\/+$/, '');
    return /^https:\/\/[^\s/]+(\/[^\s]*)?$/i.test(s) ? s : '';
  }
  function addonName(base) { try { return new URL(base).hostname.replace(/^www\./, ''); } catch (e) { return 'addon'; } }
  function keyOf(req) {
    if (req.resumeKey) return req.resumeKey;
    if (!req.id) return '';
    return req.type === 'tv' ? `tv:${req.id}:${req.season}:${req.episode}` : 'movie:' + req.id;
  }
  const pure = {quality, sizeBytes, langs, sizeText, parseStream, sortRows, streamId, addonBase, addonName, keyOf};
  if (typeof module === 'object' && module.exports) { module.exports = pure; return; }
  const TN = G.TN;
  if (!TN) return;

  // ------------------------------------------------------------ texts
  TN.i18n.add({
    he: {src_title: 'מקורות', src_play: '▶ נגן', src_find: 'מחפש מקורות...', src_none: 'לא נמצא מקור שאפשר לנגן בדפדפן.',
      src_tg: 'טלגרם', src_rd: 'Real-Debrid', src_addons: 'שרתי תוספים', src_ia: 'Internet Archive', src_yt: 'YouTube', src_dm: 'Dailymotion', src_other: 'אחר',
      src_cached: 'מוכן', src_rdq: 'יורד ב-RD', src_direct: 'ישיר', src_torrent: 'טורנט - צריך RD', src_external: 'קישור חיצוני',
      src_err: 'שגיאה', src_settings: 'הגדרות מקורות', src_addon_url: 'כתובת manifest של תוסף Stremio', src_add: 'הוסף', src_remove: 'הסר',
      src_addon_bad: 'הכתובת לא תקינה (https בלבד)', src_resume: 'המשך מ-%s', src_start: 'מההתחלה', src_details: 'פרטים',
      src_loading: '%s מתוך %s מקורות ענו', src_ep: 'פרק %s', src_back: 'חזרה לרשימה'},
    en: {src_title: 'Sources', src_play: '▶ Play', src_find: 'Looking for sources...', src_none: 'No source that a browser can play was found.',
      src_tg: 'Telegram', src_rd: 'Real-Debrid', src_addons: 'Addon servers', src_ia: 'Internet Archive', src_yt: 'YouTube', src_dm: 'Dailymotion', src_other: 'Other',
      src_cached: 'Ready', src_rdq: 'RD downloads first', src_direct: 'Direct', src_torrent: 'Torrent - needs RD', src_external: 'External link',
      src_err: 'Error', src_settings: 'Source settings', src_addon_url: 'Stremio addon manifest URL', src_add: 'Add', src_remove: 'Remove',
      src_addon_bad: 'Not a valid address (https only)', src_resume: 'Resume from %s', src_start: 'From the start', src_details: 'Details',
      src_loading: '%s of %s sources answered', src_ep: 'Episode %s', src_back: 'Back to the list'},
    ru: {src_title: 'Источники', src_play: '▶ Смотреть', src_find: 'Ищем источники...', src_none: 'Не найдено источника, который браузер может воспроизвести.',
      src_tg: 'Telegram', src_rd: 'Real-Debrid', src_addons: 'Серверы дополнений', src_ia: 'Internet Archive', src_yt: 'YouTube', src_dm: 'Dailymotion', src_other: 'Другое',
      src_cached: 'Готово', src_rdq: 'RD сначала скачает', src_direct: 'Напрямую', src_torrent: 'Торрент - нужен RD', src_external: 'Внешняя ссылка',
      src_err: 'Ошибка', src_settings: 'Настройки источников', src_addon_url: 'Адрес manifest дополнения Stremio', src_add: 'Добавить', src_remove: 'Удалить',
      src_addon_bad: 'Неверный адрес (только https)', src_resume: 'Продолжить с %s', src_start: 'С начала', src_details: 'Подробнее',
      src_loading: 'Ответили %s из %s источников', src_ep: 'Серия %s', src_back: 'Назад к списку'},
  });
  const t = TN.t, esc = TN.esc;

  // ------------------------------------------------------------ registry and addon servers
  const extra = new Map();                       // name -> fn(req, {signal}) -> rows
  function register(name, fn) { if (/^[a-z][a-z0-9_]*$/.test(name) && typeof fn === 'function') extra.set(name, fn); }
  const addons = () => (TN.get('sources_addons', []) || []).map(addonBase).filter(Boolean);
  function setAddons(list) { TN.put('sources_addons', [...new Set((list || []).map(addonBase).filter(Boolean))].slice(0, 12)); }
  async function addonRows(base, req, signal) {
    const id = streamId(req);
    if (!id) return [];
    const r = await fetch(`${base}/stream/${req.type === 'tv' ? 'series' : 'movie'}/${encodeURIComponent(id)}.json`,
      {signal, credentials: 'omit'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return ((j && j.streams) || []).map((s) => parseStream(s, addonName(base)));
  }

  // ------------------------------------------------------------ request completion (imdb id, names, year)
  async function complete(req) {
    const q = Object.assign({type: 'movie'}, req);
    q.type = q.type === 'tv' || q.season != null ? 'tv' : 'movie';
    if (q.type === 'tv') { q.season = Number(q.season || 1); q.episode = Number(q.episode || 1); }
    if (q.id && TN.hasTmdbKey() && (!q.imdb || !q.title || !q.year)) {
      try {
        const d = await TN.tmdb(`/${q.type}/${q.id}`, {append_to_response: 'external_ids'});
        q.imdb = q.imdb || (d.external_ids || {}).imdb_id || d.imdb_id || '';
        q.title = q.title || d.title || d.name || '';
        q.original = q.original || d.original_title || d.original_name || '';
        q.year = q.year || (d.release_date || d.first_air_date || '').slice(0, 4);
        q.poster = q.poster || TN.tmdbImg(d.poster_path);
        q.show = q.type === 'tv' ? d : null;
      } catch (e) { /* the title stays as given */ }
    }
    return q;
  }
  async function nextEpisode(req) {
    if (req.type !== 'tv' || !req.id || !TN.hasTmdbKey()) return null;
    const s = Number(req.season), e = Number(req.episode);
    try {
      const season = await TN.tmdb(`/tv/${req.id}/season/${s}`);
      const eps = (season.episodes || []).map((x) => x.episode_number);
      if (eps.includes(e + 1)) return Object.assign({}, req, {episode: e + 1, resumeKey: ''});
      const show = req.show || await TN.tmdb('/tv/' + req.id);
      if ((show.number_of_seasons || 0) > s) return Object.assign({}, req, {season: s + 1, episode: 1, resumeKey: ''});
    } catch (er) { /* no next */ }
    return null;
  }

  // ------------------------------------------------------------ find: every group, progressively
  const GROUP_ORDER = ['tgsearch', 'rd', 'addons', 'ia', 'yt', 'dm'];
  const groupLabel = (g) => t({tgsearch: 'src_tg', rd: 'src_rd', addons: 'src_addons', ia: 'src_ia', yt: 'src_yt', dm: 'src_dm'}[g] || 'src_other');
  function withTimeout(p, ms, signal) {
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('timeout')), ms);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(to); rej(new Error('aborted')); }, {once: true});
      p.then((v) => { clearTimeout(to); res(v); }, (e) => { clearTimeout(to); rej(e); });
    });
  }
  async function find(req, {signal, onRows} = {}) {
    const q = await complete(req);
    const jobs = [];
    const provs = await TN.providers('source').catch(() => []);
    for (const p of provs) if (p.sources) jobs.push([p.name, p.label || p.name, () => p.sources(q, {signal})]);
    addons().forEach((b) => jobs.push(['addons', addonName(b), () => addonRows(b, q, signal)]));
    if (q.type === 'movie' && q.title) jobs.push(['ia', 'Internet Archive', iaRows.bind(null, q)]);
    if (q.title) jobs.push(['dm', 'Dailymotion', () => dmRows(q, signal)]);
    for (const [n, fn] of extra) jobs.push([n, n, () => fn(q, {signal})]);
    const out = {req: q, groups: {}, errors: [], total: jobs.length, done: 0};
    await Promise.all(jobs.map(async ([g, label, fn]) => {
      try {
        const rows = (await withTimeout(Promise.resolve().then(fn), g === 'tgsearch' ? 60000 : 25000, signal)) || [];
        out.groups[g] = (out.groups[g] || []).concat(rows.map((r) => Object.assign({group: g, from: label, status: r.status || (r.tg ? 'tg' : 'direct')}, r,
          {lang: Array.isArray(r.lang) ? r.lang.join(',') : String(r.lang || ''), quality: +r.quality || quality(String(r.quality || r.label || ''))})));
      } catch (e) {
        if (!(signal && signal.aborted)) out.errors.push({group: g, from: label, msg: String((e && (e.code || e.message)) || 'error').replace(/https?:\/\/\S+/g, '').slice(0, 80)});
      }
      out.done++;
      if (onRows) try { onRows(out); } catch (e) {}
    }));
    return out;
  }
  async function iaRows(q) {
    const docs = await TN.archive({q: q.original || q.title, rows: 8});
    const y = parseInt(q.year, 10);
    return docs.filter((d) => !y || !d.year || Math.abs(parseInt(d.year, 10) - y) <= 1)
      .map((d) => {
        const row = {label: d.title || d.identifier, quality: 0, lang: '', size: 0, status: 'direct'};
        // direct play: the item's best video file through the player (resume key); the iframe page only as a fallback
        row.open = async () => {
          const f = await iaFile(d.identifier).catch(() => null);
          if (!f) return TN.openArchive(d);
          return play(Object.assign({}, row, {url: f.url, size: f.size, open: null}), q);
        };
        return row;
      });
  }
  // the best playable file of an archive.org item: mp4 > webm > ogv, then the biggest; derived h.264 copies first
  const IA_EXT = {mp4: 3, m4v: 3, webm: 2, ogv: 1};
  function iaBest(files) {
    let best = null, bs = -1;
    for (const f of files || []) {
      const ext = String(f.name || '').toLowerCase().split('.').pop();
      if (!IA_EXT[ext] || /\.(ia|thumbs)\b|_thumb|sample/i.test(f.name)) continue;
      const size = +f.size || 0;
      const score = IA_EXT[ext] * 1e13 + (/h\.?264|mpeg4/i.test(f.format || '') ? 5e12 : 0) + size;
      if (score > bs) { bs = score; best = {name: f.name, size}; }
    }
    return best;
  }
  async function iaFile(id) {
    if (!/^[\w.-]+$/.test(id || '')) return null;
    const r = await fetch('https://archive.org/metadata/' + encodeURIComponent(id), {credentials: 'omit'});
    if (!r.ok) return null;
    const j = await r.json();
    const b = iaBest(j && j.files);
    if (!b) return null;
    return {url: `https://archive.org/download/${encodeURIComponent(id)}/${b.name.split('/').map(encodeURIComponent).join('/')}`, size: b.size};
  }
  // Dailymotion: public search API (no key); plays on dailymotion.com (no direct stream)
  async function dmRows(q, signal) {
    const term = q.type === 'tv' ? `${q.title} ${q.season}x${q.episode}` : `${q.title} ${q.year || ''}`.trim();
    const u = 'https://api.dailymotion.com/videos?fields=id,title,duration&limit=8&longer_than=20&search=' + encodeURIComponent(term);
    const r = await fetch(u, {signal, credentials: 'omit'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return ((j && j.list) || []).filter((v) => /^[a-z0-9]+$/i.test(v.id)).map((v) => ({label: v.title || v.id, quality: 0, lang: '', size: 0,
      status: 'external', ext: 'https://www.dailymotion.com/video/' + v.id, meta_dur: v.duration}));
  }
  function ordered(groups) {
    const names = Object.keys(groups);
    return GROUP_ORDER.filter((g) => names.includes(g)).concat(names.filter((g) => !GROUP_ORDER.includes(g)));
  }

  // ------------------------------------------------------------ resume points (this browser; syncing needs WP-0)
  const RES = 'player_resume';
  function resumeOf(key) { const r = key && (TN.get(RES, {}) || {})[key]; return r && r.t > 30 && (!r.d || r.t < r.d * 0.95) ? r : null; }
  function clock(s) { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); }

  // ------------------------------------------------------------ the links sheet
  function style() {
    if (document.getElementById('src_style')) return;
    const s = document.createElement('style');
    s.id = 'src_style';
    s.textContent = '.src_box{padding:16px}.src_g{margin:14px 0 6px;font-size:15px;color:var(--muted)}' +
      '.src_row{display:grid;grid-template-columns:1fr auto;gap:4px 10px;width:100%;background:var(--panel);border:0;border-radius:10px;padding:10px 12px;margin:6px 0;color:inherit;font:inherit;text-align:start;cursor:pointer}' +
      '.src_row:focus-visible,.src_row:hover{box-shadow:0 0 0 2px var(--ring)}.src_row[disabled]{opacity:.5;cursor:default}' +
      '.src_row b{overflow-wrap:anywhere;font-weight:500}.src_meta{grid-column:1/-1;color:var(--muted);font-size:13px}' +
      '.src_st{font-size:12px;border-radius:999px;padding:1px 9px;background:var(--panel2);white-space:nowrap;align-self:start}' +
      '.src_st.cached,.src_st.tg{background:var(--accent);color:#000}.src_err{color:var(--muted);font-size:13px}' +
      '.src_set input{flex:1 1 220px;min-width:0;background:var(--panel);color:var(--text);border:1px solid var(--panel2);border-radius:10px;padding:9px 14px;font:inherit}' +
      'html.tv .src_row{padding:14px;font-size:19px}html.tv .src_row:focus{outline:4px solid var(--accent)}';
    document.head.append(s);
  }
  const ST = {cached: 'src_cached', rd: 'src_rdq', direct: 'src_direct', torrent: 'src_torrent', external: 'src_external', tg: 'src_tg'};
  function rowEl(r, q) {
    const b = document.createElement('button');
    b.className = 'src_row';
    const meta = [r.quality ? r.quality + 'p' : '', r.lang, sizeText(r.size), r.seeds ? '👤 ' + r.seeds : '', r.from].filter(Boolean).join(' · ');
    b.innerHTML = `<b dir="auto">${esc(r.label || r.from)}</b><span class="src_st ${esc(r.status)}">${esc(t(ST[r.status] || 'src_direct'))}</span>` +
      `<span class="src_meta" dir="auto">${esc(meta)}</span>`;
    const can = !!(r.open || r.url || r.tg || r.ext);
    if (!can || r.status === 'torrent') b.disabled = true;
    b.onclick = () => play(r, q);
    return b;
  }
  async function play(r, q) {
    if (r.open && !r.url) return r.open();
    if (r.ext && !r.url) { window.open(r.ext, '_blank', 'noopener'); return; }
    const pl = await TN.provider('player');
    if (!pl) return r.open && r.open();
    return pl.open({url: r.url, tg: r.tg, title: q.title + (q.type === 'tv' ? ` S${String(q.season).padStart(2, '0')}E${String(q.episode).padStart(2, '0')}` : ''),
      resumeKey: keyOf(q), poster: q.poster, meta: q, back: () => pick(q),
      next: q.type === 'tv' ? () => nextEpisode(q) : null,
      history: {key: keyOf(q), label: q.title + (q.type === 'tv' ? ' · ' + t('src_ep', q.season + 'x' + q.episode) : ''), thumb: q.poster || ''}});
  }
  let current = null;
  async function pick(req) {
    if (current) current.abort();
    const ctl = new AbortController();
    current = ctl;
    style();
    TN.modal(`<div class="src_box"><h3 dir="auto" id="src_h">${esc(req.title || t('src_title'))}</h3><div id="src_resume"></div>` +
      `<p class="hint" id="src_prog">${esc(t('src_find'))}</p><div id="src_list"></div><div id="src_errs"></div>` +
      `<div class="links"><button class="btn ghost" id="src_set">⚙ ${esc(t('src_settings'))}</button>` +
      (req.id ? `<button class="btn ghost" id="src_det">${esc(t('src_details'))}</button>` : '') + '</div><div id="src_setbox"></div></div>');
    const $ = (id) => document.getElementById(id);
    const sheet = $('src_list');
    $('src_set').onclick = () => settingsPanel($('src_setbox'));
    if ($('src_det')) $('src_det').onclick = () => TN.openTitle(req.type === 'tv' ? 'tv' : 'movie', req.id);
    let q = req;
    const draw = (out) => {
      if (current !== ctl || !document.body.contains(sheet)) { ctl.abort(); return; }
      q = out.req;
      const h = $('src_h');
      if (h) h.textContent = q.title + (q.type === 'tv' ? ` · S${String(q.season).padStart(2, '0')}E${String(q.episode).padStart(2, '0')}` : '');
      const box = $('src_resume'), rp = resumeOf(keyOf(q));
      if (rp && box && !box.firstChild) box.innerHTML = `<p class="hint">${esc(t('src_resume', clock(rp.t)))}</p>`;
      sheet.innerHTML = '';
      const pref = TN.lang();
      for (const g of ordered(out.groups)) {
        const rows = g === 'tgsearch' ? out.groups[g] : sortRows(out.groups[g], pref);
        if (!rows.length) continue;
        sheet.insertAdjacentHTML('beforeend', `<h4 class="src_g">${esc(groupLabel(g))} (${rows.length})</h4>`);
        rows.slice(0, 40).forEach((r) => sheet.append(rowEl(r, q)));
      }
      $('src_prog').textContent = out.done < out.total ? t('src_loading', out.done, out.total) : (sheet.firstChild ? '' : t('src_none'));
      $('src_errs').innerHTML = out.errors.map((e) => `<p class="src_err" dir="auto">${esc(e.from)}: ${esc(t('src_err'))} (${esc(e.msg)})</p>`).join('');
    };
    try {
      const out = await find(req, {signal: ctl.signal, onRows: draw});
      draw(out);
      const first = sheet.querySelector('.src_row:not([disabled])');
      if (first && document.activeElement && !document.getElementById('sheet').contains(document.activeElement)) first.focus();
      return out;
    } catch (e) { return null; }
  }

  // ------------------------------------------------------------ settings: addon servers + RD token
  async function settingsPanel(el) {
    if (!el) return;
    style();
    const draw = () => {
      el.innerHTML = `<div class="panel src_set" style="margin-top:12px"><h4>${esc(t('src_addons'))}</h4><div id="src_al"></div>` +
        `<div class="links"><input id="src_ai" type="url" inputmode="url" placeholder="https://.../manifest.json" aria-label="${esc(t('src_addon_url'))}">` +
        `<button class="btn" id="src_aa">${esc(t('src_add'))}</button></div><p class="hint" id="src_am"></p><div id="src_rd"></div></div>`;
      const list = el.querySelector('#src_al');
      addons().forEach((b) => {
        const row = document.createElement('div');
        row.className = 'links';
        row.innerHTML = `<span dir="ltr" style="flex:1;overflow-wrap:anywhere">${esc(addonName(b))}</span>`;
        row.append(TN.button('btn ghost', t('src_remove'), () => { setAddons(addons().filter((x) => x !== b)); draw(); }));
        list.append(row);
      });
      el.querySelector('#src_aa').onclick = () => {
        const v = addonBase(el.querySelector('#src_ai').value);
        if (!v) { el.querySelector('#src_am').textContent = t('src_addon_bad'); return; }
        setAddons(addons().concat(v)); draw();
      };
      TN.provider('rd').then((rd) => rd && rd.settingsPanel && rd.settingsPanel(el.querySelector('#src_rd'))).catch(() => {});
    };
    draw();
  }

  // ------------------------------------------------------------ hooks: Play on the title sheet, history rows
  TN.addTitleAction((acts, {type, id, title, detail, poster}) => {
    const b = TN.button('btn', t('src_play'), () => {
      if (type === 'tv') { TN.closeModal(); TN.go(TN.link('catalog', {m: 'tv', v: 'seasons', id})); return; }
      pick({type: 'movie', id, title, original: detail && detail.original_title, year: ((detail && detail.release_date) || '').slice(0, 4),
        imdb: (detail && detail.imdb_id) || '', poster});
    });
    acts.prepend(b);
  });
  TN.addHistoryHandler((e) => {
    const key = String((e && e.key) || ''), play = String((e && e.play) || '');
    let m = /^tv:(\d+):(\d+):(\d+)$/.exec(key);
    if (m) { pick({type: 'tv', id: m[1], season: +m[2], episode: +m[3], poster: e.thumb || ''}); return true; }
    m = /^movie:(\d+)$/.exec(key);
    if (m && /[?&]a=play\b/.test(play) && /plugin\.video\.nova\//.test(play)) {
      const p = new URLSearchParams(play.split('?')[1] || '');
      pick({type: 'movie', id: m[1], title: p.get('q') || e.label || '', poster: e.thumb || ''});
      return true;
    }
    return false;
  });

  TN.registerProvider('sources', Object.assign({kinds: ['service'], label: t('src_title'),
    open: pick, pick, find, iaBest, register, addons, setAddons, nextEpisode, resumeOf, complete, settingsPanel, clock}, pure));
})(typeof self !== 'undefined' ? self : globalThis);
