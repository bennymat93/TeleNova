'use strict';
// TeleNova web (package player): find the ways to play a title and let the viewer choose one - the "links" screen of
// the Kodi build (TL/sources.Finder + TL/router.play): Telegram -> Real-Debrid (Torrentio) -> the viewer's Stremio
// addon servers -> Internet Archive -> YouTube -> Dailymotion -> anything registered. Rows carry quality / codec /
// HDR / audio / language / size badges, the same release found twice is listed once (union_dedup), the viewer's
// filters apply (min quality, hide CAM, language, Telegram first), links can be tested (first bytes + speed + file
// header), and a failed Real-Debrid link moves on to the next one by itself (router.play, 3 tries).
// Service 'sources': open(req) | pick(req), find(req, {signal, onRows}), play(row, req), register(name, fn), addons(),
//   setAddons(list), nextEpisode(req), resumeOf(key), keyOf(req), settingsPanel(el), testRow(row) + the pure helpers.
// req = {type:'movie'|'tv', id (TMDb), imdb, title, original, year, season, episode, poster}
// Nothing here logs or shows a URL: an addon URL or a Torrentio link can hold the viewer's token.
// Syntax: ES2019 only (this file may be loaded at start-up for the Play button of the title sheet).
(function (G) {
  // ------------------------------------------------------------ pure helpers (also tested in node)
  const QUAL = [[/\b(2160p|4k|uhd)\b/i, 2160], [/\b1440p\b/i, 1440], [/\b(1080p|fhd)\b/i, 1080], [/\b720p\b/i, 720],
    [/\b(576p|480p|sd|dvdrip|xvid)\b/i, 480], [/\b360p\b/i, 360]];
  const FLAGS = {'🇮🇱': 'he', '🇷🇺': 'ru', '🇬🇧': 'en', '🇺🇸': 'en', '🇺🇦': 'uk', '🇫🇷': 'fr', '🇩🇪': 'de', '🇪🇸': 'es', '🇮🇹': 'it',
    '🇯🇵': 'ja', '🇰🇷': 'ko', '🇨🇳': 'zh', '🇵🇹': 'pt', '🇧🇷': 'pt', '🇹🇷': 'tr', '🇵🇱': 'pl', '🇳🇱': 'nl', '🇸🇦': 'ar', '🇮🇳': 'hi'};
  const WORDS = [[/\b(heb|hebrew|hebsub|hebdub)\b|עברית|מדובב|תרגום מובנה/i, 'he'], [/\b(rus|russian)\b|русск|дубляж/i, 'ru'], [/\b(multi)\b/i, 'multi']];
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
  // bytes -> '1.5 GB'; a text some provider gave instead of a number (a running time such as '1:32:10') stays as it is
  function sizeText(b) {
    if (typeof b === 'string' && b && !/^\d+(\.\d+)?$/.test(b)) return b;
    b = Number(b);
    return !(b > 0) ? '' : b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.max(1, Math.round(b / 1048576)) + ' MB';
  }
  // release-name tags (parser.py find_source / codec / hdr ideas): {codec, hdr, audio, src, cam}
  function tags(text) {
    const s = String(text || '');
    const pick = (list) => { for (const [re, v] of list) if (re.test(s)) return v; return ''; };
    const src = pick([[/\b(cam|camrip|hdcam|ts|telesync|hdts|tc|telecine)\b/i, 'CAM'], [/\b(remux)\b/i, 'REMUX'], [/\b(blu-?ray|bdrip|brrip)\b/i, 'BluRay'],
      [/\b(web-?dl|webrip|web)\b/i, 'WEB'], [/\b(hdtv|pdtv)\b/i, 'HDTV'], [/\b(dvdrip|dvd)\b/i, 'DVD']]);
    return {
      codec: pick([[/\b(hevc|[hx]\.?265)\b/i, 'HEVC'], [/\b(av1)\b/i, 'AV1'], [/\b([hx]\.?264|avc)\b/i, 'H.264'], [/\b(xvid|divx)\b/i, 'XviD'], [/\b(vp9)\b/i, 'VP9']]),
      hdr: pick([[/\b(dv|dovi|dolby[ .]?vision)\b/i, 'DV'], [/\b(hdr10\+?|hdr)\b/i, 'HDR']]),
      audio: pick([[/\b(atmos)\b/i, 'Atmos'], [/\b(truehd)\b/i, 'TrueHD'], [/\b(dts(-?hd)?(-?ma)?)\b/i, 'DTS'], [/\b(e-?ac-?3|ddp|dd\+)/i, 'EAC3'],
        [/\b(ac-?3|dd5\.?1)\b/i, 'AC3'], [/\b(aac)\b/i, 'AAC'], [/\b(opus)\b/i, 'Opus']]),
      src, cam: src === 'CAM',
    };
  }
  const ytId = (u) => { const m = /^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#/]|$)/.exec(String(u || '')); return m ? m[1] : ''; };
  // a Stremio stream object -> one row. status: 'cached' (RD+), 'rd' (RD will download first), 'direct', 'torrent'
  // (an info hash only: plays through Real-Debrid when the viewer is signed in), 'external' (only a page link)
  function parseStream(s, addon) {
    const name = String((s && s.name) || ''), title = String((s && (s.title || s.description)) || '');
    const all = name + '\n' + title;
    const hint = (s && s.behaviorHints) || {};
    const file = hint.filename || title.split('\n')[0] || name;
    let status = 'direct';
    if (/\[RD\+\]|\[RD ✓\]|RD\+/.test(name)) status = 'cached';
    else if (/\[RD( download)?\]|\[RD ⏳\]|\bRD\b/.test(name)) status = 'rd';
    if (!s || !s.url) status = s && s.infoHash ? 'torrent' : 'external';
    const url = s && typeof s.url === 'string' && /^https:\/\//i.test(s.url) ? s.url : '';
    const seeds = /👤\s*(\d+)/.exec(title);
    const hash = s && /^[a-fA-F0-9]{40}$/.test(String(s.infoHash || '')) ? String(s.infoHash).toLowerCase() : '';
    const row = {label: String(file).trim(), quality: quality(all), lang: langs(all).join(','), size: sizeBytes(title) || Number(hint.videoSize) || 0,
      seeds: seeds ? +seeds[1] : 0, status: url ? status : (status === 'direct' ? 'external' : status), url,
      ext: !url && s && /^https:\/\//i.test(s.externalUrl || '') ? s.externalUrl : '', addon: addon || '',
      notWeb: !!hint.notWebReady};
    if (hash && !url) { row.hash = hash; row.fileIdx = Number.isInteger(s.fileIdx) ? s.fileIdx : -1; row.file = hint.filename || ''; }
    return row;
  }
  // the order the build uses: tested-good first, dead last, cached first, then the wanted language, quality (the
  // 1080p ceiling first, like the hub), seeds, size
  const STATUS_RANK = {tg: 0, cached: 0, direct: 1, yt: 1, rd: 2, external: 3, torrent: 4};
  const probeRank = (r) => (r.dead || (r.probe && r.probe.ok === false) ? 2 : r.probe && r.probe.ok === true ? 0 : 1);
  function sortRows(rows, langPref) {
    const pref = langPref || '';
    const has = (r) => (pref && String(r.lang || '').split(',').includes(pref) ? 1 : 0);
    const q = (r) => (r.quality > 1080 ? 900 : r.quality || 0);
    return rows.slice().sort((a, b) => probeRank(a) - probeRank(b) || (STATUS_RANK[a.status] || 0) - (STATUS_RANK[b.status] || 0) ||
      has(b) - has(a) || q(b) - q(a) || (b.seeds || 0) - (a.seeds || 0) || (Number(b.size) || 0) - (Number(a.size) || 0));
  }
  // hints.merge_same_files / Finder.union_dedup: the same release (name without punctuation, size within 1 %) is one
  // row; the copy that plays best stays (earlier in the list = better group), the others are counted in .also
  function releaseKey(label) {
    const n = String(label || '').trim().toLowerCase().replace(/\.(mkv|mp4|avi|m4v|ts|webm|mov|wmv)$/, '').replace(/[^0-9a-z֐-׿Ѐ-ӿ]+/g, '');
    return Array.from(n).length >= 8 ? n : '';
  }
  function dedup(rows, tol) {
    tol = tol || 0.01;
    const out = [], index = new Map();
    let folded = 0;
    for (const r of rows) {
      const name = releaseKey(r.label), size = Math.trunc(Number(r.size) || 0);
      let hit = null;
      if (name && size > 0) {
        for (const o of index.get(name) || []) {
          const os = Math.trunc(Number(o.size) || 0);
          if (Math.abs(os - size) <= tol * Math.max(os, size)) { hit = o; break; }
        }
      }
      if (!hit) {
        if (name && size > 0) { if (!index.has(name)) index.set(name, []); index.get(name).push(r); }
        out.push(r);
      } else { folded++; (hit.also = hit.also || []).push(r.from || r.group || ''); if (!hit.lang && r.lang) hit.lang = r.lang; }
    }
    return [out, folded];
  }
  // settings min_quality / hide_cam / lang_pref of the build. f = {minq, hideCam, lang, strictLang}
  function filterRows(rows, f) {
    f = f || {};
    return rows.filter((r) => {
      if (f.minq && r.quality && r.quality < f.minq) return false;
      if (f.hideCam && tags(r.label).cam) return false;
      if (f.strictLang && f.lang && r.lang && !String(r.lang).split(',').some((l) => l === f.lang || l === 'multi')) return false;
      return true;
    });
  }
  // TL/mediainfo.inspect, reduced: what the first bytes of a file say (container, codecs, a Hebrew track tag)
  function sniff(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const out = {container: '', video: '', audio: [], subs: false, he: false};
    if (b.length < 12) return out;
    let s = '';
    const n = Math.min(b.length, 262144);
    for (let i = 0; i < n; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, Math.min(n, i + 8192)));
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) out.container = /webm/.test(s.slice(0, 64)) ? 'webm' : 'mkv';
    else if (s.slice(4, 8) === 'ftyp') out.container = 'mp4';
    else if (s.slice(0, 4) === 'RIFF' && s.slice(8, 12) === 'AVI ') out.container = 'avi';
    else if (b[0] === 0x47 && b.length > 188 && b[188] === 0x47) out.container = 'ts';
    else if (s.slice(0, 3) === 'FLV') out.container = 'flv';
    const V = [[/V_MPEGH\/ISO\/HEVC|hvc1|hev1|dvh1|dvhe/, 'hevc'], [/V_MPEG4\/ISO\/AVC|avc1|avc3/, 'h264'], [/V_AV1|av01/, 'av1'], [/V_VP9|vp09/, 'vp9'],
      [/V_VP8/, 'vp8'], [/V_MPEG4\/ISO\/ASP|V_MS\/VFW|XVID|DX50|mp4v/, 'mpeg4'], [/V_MPEG2/, 'mpeg2']];
    for (const [re, v] of V) if (re.test(s)) { out.video = v; break; }
    const A = [[/A_AAC|mp4a/, 'aac'], [/A_OPUS|Opus/, 'opus'], [/A_VORBIS/, 'vorbis'], [/A_MPEG\/L3|\.mp3/, 'mp3'], [/A_FLAC|fLaC/, 'flac'],
      [/A_EAC3|ec-3/, 'eac3'], [/A_AC3|ac-3/, 'ac3'], [/A_DTS|dtsc|dtsh|dtsl/, 'dts'], [/A_TRUEHD|mlpa/, 'truehd']];
    for (const [re, v] of A) if (re.test(s)) out.audio.push(v);
    out.subs = /S_TEXT|S_ASS|S_SSA|S_HDMV|S_VOBSUB|tx3g/.test(s);
    out.he = /\x22\xb5\x9c\x83heb|\x22\xb5\x9d\x82he|Hebrew|×¢×\u0091×¨×\u0099×ª/.test(s);
    return out;
  }
  // what a browser will do with such a file. can(mimeWithCodecs) -> boolean (video.canPlayType, injected for tests)
  // -> {play: 'yes'|'maybe'|'no', why: ''|'container'|'video'|'audio'}
  const WEB_AUDIO = ['aac', 'opus', 'vorbis', 'mp3', 'flac'];
  function verdict(sn, can) {
    can = can || (() => false);
    if (!sn || !sn.container) return {play: 'maybe', why: ''};
    if (sn.container === 'avi' || sn.container === 'flv' || sn.container === 'ts') return {play: 'no', why: 'container'};
    if (sn.video === 'mpeg4' || sn.video === 'mpeg2') return {play: 'no', why: 'video'};
    if (sn.video === 'hevc' && !can('video/mp4; codecs="hvc1.1.6.L93.B0"') && !can('video/mp4; codecs="hev1.1.6.L93.B0"')) return {play: 'no', why: 'video'};
    if (sn.video === 'av1' && !can('video/mp4; codecs="av01.0.05M.08"')) return {play: 'no', why: 'video'};
    if (sn.audio.length && !sn.audio.some((a) => WEB_AUDIO.includes(a))) {
      const ok = (sn.audio.includes('ac3') && can('audio/mp4; codecs="ac-3"')) || (sn.audio.includes('eac3') && can('audio/mp4; codecs="ec-3"'));
      if (!ok) return {play: 'no', why: 'audio'};
    }
    if (sn.container === 'mkv' && !can('video/x-matroska') && !can('video/webm; codecs="vp9"')) return {play: 'no', why: 'container'};
    return {play: sn.container === 'mkv' ? 'maybe' : 'yes', why: ''};
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
  const pad2 = (n) => String(n).padStart(2, '0');
  const epCode = (q) => (q.type === 'tv' ? `S${pad2(q.season)}E${pad2(q.episode)}` : '');
  function clock(s) { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' + pad2(m) : m) + ':' + pad2(s % 60); }
  const pure = {quality, sizeBytes, langs, sizeText, tags, ytId, parseStream, sortRows, releaseKey, dedup, filterRows, sniff, verdict, streamId,
    addonBase, addonName, keyOf, epCode, clock};
  if (typeof module === 'object' && module.exports) { module.exports = pure; return; }
  const TN = G.TN;
  if (!TN) return;

  // ------------------------------------------------------------ texts
  TN.i18n.add({
    he: {src_title: 'מקורות', src_play: '▶ נגן', src_find: 'מחפש מקורות...', src_none: 'לא נמצא מקור שאפשר לנגן בדפדפן.',
      src_tg: 'טלגרם', src_rd: 'Real-Debrid', src_addons: 'שרתי תוספים', src_ia: 'Internet Archive', src_yt: 'YouTube', src_dm: 'Dailymotion', src_other: 'אחר',
      src_cached: 'מוכן', src_rdq: 'נבדק ב-RD', src_direct: 'ישיר', src_torrent: 'טורנט · דרך RD', src_external: 'נפתח באתר',
      src_err: 'שגיאה', src_settings: 'הגדרות מקורות', src_addon_url: 'כתובת manifest של תוסף Stremio', src_add: 'הוסף', src_remove: 'הסר',
      src_addon_bad: 'הכתובת לא תקינה (https בלבד)', src_resume: 'נקודת המשך: %s', src_start: 'התחל מההתחלה', src_details: 'פרטים',
      src_loading: '%s מתוך %s מקורות ענו', src_ep: 'פרק %s', src_back: 'חזרה לרשימה',
      src_best: '▶ נגן את הטוב ביותר', src_test: 'בדוק קישורים', src_testing: 'בודק קישורים... %s/%s', src_ok: 'תקין', src_dead: 'לא עונה',
      src_untest: 'אי אפשר לבדוק מהדפדפן', src_speed: '%s מגה-ביט', src_nocodec: 'קידוד שהדפדפן לא מנגן', src_hesub: 'כתוביות עברית בפנים (כנראה)',
      src_dup: '+%s עותקים', src_hidden: '%s קישורים הוסתרו לפי ההגדרות.', src_show_all: 'הצג הכול', src_need_rd: 'קישור טורנט מתנגן דרך Real-Debrid. התחברו כאן:',
      src_filters: 'סינון וסדר', src_minq: 'איכות מינימלית', src_any: 'הכול', src_hidecam: 'הסתר צילומי קולנוע (CAM)', src_lang: 'שפה מועדפת',
      src_lang_only: 'הצג רק את השפה המועדפת (כשהיא ידועה)', src_tgfirst: 'טלגרם ראשון ברשימה', src_auto: 'נגן אוטומטית את הקישור הטוב ביותר',
      src_next_try: 'הקישור לא עבד, מנסה את הבא...', src_newtab: 'נפתח בלשונית חדשה', src_notmdb: 'בלי מפתח TMDb החיפוש מוגבל (אין מזהה IMDb).',
      src_dur: 'משך %s', src_stop: 'עצור', src_subs: 'הגדרות כתוביות', src_rd_ready: 'הקישור מוכן. מנגן...'},
    en: {src_title: 'Sources', src_play: '▶ Play', src_find: 'Looking for sources...', src_none: 'No source that a browser can play was found.',
      src_tg: 'Telegram', src_rd: 'Real-Debrid', src_addons: 'Addon servers', src_ia: 'Internet Archive', src_yt: 'YouTube', src_dm: 'Dailymotion', src_other: 'Other',
      src_cached: 'Ready', src_rdq: 'Checked at RD', src_direct: 'Direct', src_torrent: 'Torrent · via RD', src_external: 'Opens on the site',
      src_err: 'Error', src_settings: 'Source settings', src_addon_url: 'Stremio addon manifest URL', src_add: 'Add', src_remove: 'Remove',
      src_addon_bad: 'Not a valid address (https only)', src_resume: 'Resume point: %s', src_start: 'Start from the beginning', src_details: 'Details',
      src_loading: '%s of %s sources answered', src_ep: 'Episode %s', src_back: 'Back to the list',
      src_best: '▶ Play the best one', src_test: 'Test links', src_testing: 'Testing links... %s/%s', src_ok: 'Works', src_dead: 'No answer',
      src_untest: 'Cannot be tested from a browser', src_speed: '%s Mbit', src_nocodec: 'A codec this browser does not play', src_hesub: 'Hebrew subtitles inside (probably)',
      src_dup: '+%s copies', src_hidden: '%s links are hidden by the settings.', src_show_all: 'Show all', src_need_rd: 'A torrent link plays through Real-Debrid. Sign in here:',
      src_filters: 'Filter and order', src_minq: 'Minimum quality', src_any: 'Any', src_hidecam: 'Hide cinema recordings (CAM)', src_lang: 'Preferred language',
      src_lang_only: 'Show only the preferred language (when it is known)', src_tgfirst: 'Telegram first in the list', src_auto: 'Play the best link automatically',
      src_next_try: 'That link did not work, trying the next one...', src_newtab: 'Opens in a new tab', src_notmdb: 'Without a TMDb key the search is limited (no IMDb id).',
      src_dur: 'Length %s', src_stop: 'Stop', src_subs: 'Subtitle settings', src_rd_ready: 'The link is ready. Playing...'},
    ru: {src_title: 'Источники', src_play: '▶ Смотреть', src_find: 'Ищем источники...', src_none: 'Не найдено источника, который браузер может воспроизвести.',
      src_tg: 'Telegram', src_rd: 'Real-Debrid', src_addons: 'Серверы дополнений', src_ia: 'Internet Archive', src_yt: 'YouTube', src_dm: 'Dailymotion', src_other: 'Другое',
      src_cached: 'Готово', src_rdq: 'Проверка в RD', src_direct: 'Напрямую', src_torrent: 'Торрент · через RD', src_external: 'Откроется на сайте',
      src_err: 'Ошибка', src_settings: 'Настройки источников', src_addon_url: 'Адрес manifest дополнения Stremio', src_add: 'Добавить', src_remove: 'Удалить',
      src_addon_bad: 'Неверный адрес (только https)', src_resume: 'Точка продолжения: %s', src_start: 'Начать сначала', src_details: 'Подробнее',
      src_loading: 'Ответили %s из %s источников', src_ep: 'Серия %s', src_back: 'Назад к списку',
      src_best: '▶ Включить лучший', src_test: 'Проверить ссылки', src_testing: 'Проверяем ссылки... %s/%s', src_ok: 'Работает', src_dead: 'Не отвечает',
      src_untest: 'Из браузера проверить нельзя', src_speed: '%s Мбит', src_nocodec: 'Кодек, который браузер не играет', src_hesub: 'Внутри субтитры на иврите (вероятно)',
      src_dup: '+%s копий', src_hidden: 'Скрыто настройками: %s ссылок.', src_show_all: 'Показать все', src_need_rd: 'Торрент-ссылка играет через Real-Debrid. Войдите здесь:',
      src_filters: 'Фильтр и порядок', src_minq: 'Минимальное качество', src_any: 'Любое', src_hidecam: 'Скрыть экранные копии (CAM)', src_lang: 'Предпочитаемый язык',
      src_lang_only: 'Показывать только предпочитаемый язык (когда он известен)', src_tgfirst: 'Telegram первым в списке', src_auto: 'Автоматически включать лучшую ссылку',
      src_next_try: 'Ссылка не сработала, пробуем следующую...', src_newtab: 'Откроется в новой вкладке', src_notmdb: 'Без ключа TMDb поиск ограничен (нет IMDb id).',
      src_dur: 'Длительность %s', src_stop: 'Стоп', src_subs: 'Настройки субтитров', src_rd_ready: 'Ссылка готова. Запускаем...'},
  });
  const t = TN.t, esc = TN.esc;
  const cfg = (k, d) => TN.settings.get('sources_' + k, d);
  const filters = () => ({minq: Number(cfg('minq', 0)) || 0, hideCam: cfg('hidecam', true) !== false, lang: cfg('lang', '') || TN.lang(),
    strictLang: cfg('langonly', false) === true, tgFirst: cfg('tgfirst', true) !== false, auto: cfg('auto', false) === true});

  // ------------------------------------------------------------ registry and addon servers
  const extra = new Map();                       // name -> fn(req, {signal}) -> rows
  function register(name, fn) { if (/^[a-z][a-z0-9_]*$/.test(name) && typeof fn === 'function') extra.set(name, fn); }
  const addons = () => (TN.get('sources_addons', []) || []).map(addonBase).filter(Boolean);
  function setAddons(list) { TN.put('sources_addons', [...new Set((list || []).map(addonBase).filter(Boolean))].slice(0, 12)); }
  async function addonRows(base, req, signal) {
    const id = streamId(req);
    if (!id) return [];
    const r = await fetch(`${base}/stream/${req.type === 'tv' ? 'series' : 'movie'}/${encodeURIComponent(id)}.json`,
      {signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
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
        q.backdrop = q.backdrop || (d.backdrop_path ? TN.tmdbImg(d.backdrop_path, 'w1280') : '');
        q.plot = q.plot || d.overview || '';
        q.runtime = q.runtime || d.runtime || (d.episode_run_time || [])[0] || 0;
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
      const today = new Date().toISOString().slice(0, 10);
      const eps = (season.episodes || []).filter((x) => !x.air_date || x.air_date <= today).map((x) => x.episode_number);
      if (eps.includes(e + 1)) return Object.assign({}, req, {episode: e + 1, resumeKey: ''});
      const show = req.show || await TN.tmdb('/tv/' + req.id);
      if ((show.number_of_seasons || 0) > s) return Object.assign({}, req, {season: s + 1, episode: 1, resumeKey: ''});
    } catch (er) { /* no next */ }
    return null;
  }

  // ------------------------------------------------------------ find: every group, progressively
  const groupOrder = () => (filters().tgFirst ? ['tgsearch', 'rd', 'addons', 'ia', 'yt', 'dm'] : ['rd', 'addons', 'tgsearch', 'ia', 'yt', 'dm']);
  const groupLabel = (g) => t({tgsearch: 'src_tg', rd: 'src_rd', addons: 'src_addons', ia: 'src_ia', yt: 'src_yt', dm: 'src_dm'}[g] || 'src_other');
  function withTimeout(p, ms, signal) {
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('timeout')), ms);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(to); rej(new Error('aborted')); }, {once: true});
      p.then((v) => { clearTimeout(to); res(v); }, (e) => { clearTimeout(to); rej(e); });
    });
  }
  const safeMsg = (e) => String((e && (e.code || e.message)) || 'error').replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '').slice(0, 80);
  function norm(r, g, label) {
    const row = Object.assign({group: g, from: label}, r);
    row.lang = Array.isArray(r.lang) ? r.lang.join(',') : String(r.lang || '');
    row.quality = +r.quality || quality(String(r.quality || '') + ' ' + String(r.label || ''));
    const yid = ytId(r.url);
    if (yid) { row.yt = yid; row.url = ''; row.status = 'yt'; if (typeof r.size === 'string') { row.dur = r.size; row.size = 0; } }
    else if (typeof r.size === 'string' && !/^\d+$/.test(r.size)) { row.dur = r.size; row.size = 0; }
    row.size = Number(row.size) || 0;
    row.status = row.status || (r.tg ? 'tg' : 'direct');
    if (r.tg) row.status = 'tg';
    return row;
  }
  async function find(req, o) {
    const signal = o && o.signal, onRows = o && o.onRows;
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
        out.groups[g] = (out.groups[g] || []).concat(rows.map((r) => norm(r, g, label)));
      } catch (e) {
        if (!(signal && signal.aborted)) out.errors.push({group: g, from: label, msg: safeMsg(e)});
      }
      out.done++;
      if (onRows) try { onRows(out); } catch (e) { /* drawing is not the search's problem */ }
    }));
    return out;
  }
  // every row in the order of the screen: groups in order, filtered, sorted, the same release once
  function arrange(out, showAll) {
    const f = filters();
    const names = Object.keys(out.groups), order = groupOrder();
    const gs = order.filter((g) => names.includes(g)).concat(names.filter((g) => !order.includes(g)));
    let all = [], hidden = 0;
    for (const g of gs) {
      const raw = out.groups[g], kept = showAll ? raw : filterRows(raw, f);
      hidden += raw.length - kept.length;
      all = all.concat(g === 'tgsearch' ? kept.slice().sort((a, b) => probeRank(a) - probeRank(b)) : sortRows(kept, f.lang));
    }
    const d = dedup(all);
    const by = {};
    for (const r of d[0]) (by[r.group] = by[r.group] || []).push(r);
    return {groups: gs.filter((g) => by[g]).map((g) => ({name: g, rows: by[g].slice(0, 40)})), hidden, folded: d[1]};
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
  // Dailymotion: public search API (no key); plays on dailymotion.com (no direct stream, and the page's frame policy
  // does not allow its player inside this site), so the row says plainly that it opens in a new tab
  async function dmRows(q, signal) {
    const term = q.type === 'tv' ? `${q.title} ${q.season}x${q.episode}` : `${q.title} ${q.year || ''}`.trim();
    const u = 'https://api.dailymotion.com/videos?fields=id,title,duration&limit=8&longer_than=20&search=' + encodeURIComponent(term);
    const r = await fetch(u, {signal, credentials: 'omit'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return ((j && j.list) || []).filter((v) => /^[a-z0-9]+$/i.test(v.id)).map((v) => ({label: v.title || v.id, quality: 0, lang: '', size: 0,
      status: 'external', ext: 'https://www.dailymotion.com/video/' + v.id, dur: v.duration ? clock(v.duration) : ''}));
  }

  // ------------------------------------------------------------ resume points (shared with the player)
  const RES = 'player_resume';
  function resumeOf(key) { const r = key && (TN.get(RES, {}) || {})[key]; return r && r.t > 30 && (!r.d || r.t < r.d * 0.95) ? r : null; }
  function dropResume(key) { const all = TN.get(RES, {}) || {}; if (all[key]) { delete all[key]; TN.put(RES, all); } }

  // ------------------------------------------------------------ link test (Finder.probe): first bytes, speed, header
  const canType = (m) => { try { return !!document.createElement('video').canPlayType(m); } catch (e) { return false; } };
  async function probeUrl(url, signal) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 12000);
    if (signal) signal.addEventListener('abort', () => ctl.abort(), {once: true});
    const t0 = Date.now();
    try {
      const r = await fetch(url, {headers: {Range: 'bytes=0-131071'}, credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal, cache: 'no-store'});
      if (!r.ok) return {ok: false, status: r.status};
      const reader = r.body && r.body.getReader ? r.body.getReader() : null;
      let buf = new Uint8Array(0);
      if (reader) {
        while (buf.length < 131072) {
          const x = await reader.read();
          if (x.done) break;
          const nb = new Uint8Array(buf.length + x.value.length); nb.set(buf); nb.set(x.value, buf.length); buf = nb;
        }
        try { reader.cancel(); } catch (e) { /* done */ }
      } else buf = new Uint8Array(await r.arrayBuffer());
      const sec = Math.max(0.05, (Date.now() - t0) / 1000);
      const sn = sniff(buf);
      return {ok: true, mbit: Math.round(buf.length * 8 / sec / 1e5) / 10, sniff: sn, verdict: verdict(sn, canType)};
    } catch (e) {
      if (signal && signal.aborted) throw e;
      // no CORS on that host: the bytes cannot be read here. Is it there at all?
      try {
        await fetch(url, {mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal, cache: 'no-store', headers: {Range: 'bytes=0-1023'}});
        return {ok: null};
      } catch (e2) { return {ok: false, status: 0}; }
    } finally { clearTimeout(to); ctl.abort(); }
  }
  async function testRow(r, signal) {
    if (r.tg) {
      const tp = await TN.provider('tgplay').catch(() => null);
      if (!tp || !tp.probe) return {ok: null};
      try {
        const p = await tp.probe(tgRef(r.tg));
        const sn = sniff(p.head);
        return {ok: true, mbit: p.mbit, sniff: sn, verdict: verdict(sn, canType)};
      } catch (e) { return {ok: false, status: 0}; }
    }
    if (r.url && (r.status === 'cached' || r.status === 'direct')) return probeUrl(r.url, signal);
    return {ok: null};
  }
  const tgRef = (x) => (x.message ? {message: x.message} : x.peer ? x : {peer: x.chat_username || x.chat_id, msg: x.msg_id});

  // ------------------------------------------------------------ the links sheet
  function style() {
    if (document.getElementById('src_style')) return;
    const s = document.createElement('style');
    s.id = 'src_style';
    s.textContent = '.src_box{padding:16px}.src_g{margin:16px 0 6px;font-size:15px;color:var(--muted)}' +
      '.src_row{display:grid;grid-template-columns:1fr auto;gap:6px 10px;width:100%;min-height:48px;background:var(--panel);border:0;border-radius:10px;padding:10px 12px;margin:6px 0;color:inherit;font:inherit;text-align:start;cursor:pointer}' +
      '.src_row:focus-visible,.src_row:hover{outline:2px solid var(--accent);outline-offset:1px}.src_row.dead{opacity:.55}' +
      '.src_row b{overflow-wrap:anywhere;font-weight:500}.src_meta{grid-column:1/-1;color:var(--muted);font-size:13px;display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center}' +
      '.src_bd{font-size:12px;border-radius:6px;padding:1px 7px;background:var(--panel2);white-space:nowrap;color:var(--text)}' +
      '.src_bd.q4{background:#7c4dff;color:#fff}.src_bd.q3{background:#1e88e5;color:#fff}.src_bd.q2{background:#2e7d32;color:#fff}.src_bd.q1{background:#6d6d6d;color:#fff}' +
      '.src_bd.warn{background:#b3261e;color:#fff}.src_bd.good{background:#2e7d32;color:#fff}.src_bd.lang{border:1px solid var(--muted);background:transparent}' +
      '.src_st{font-size:12px;border-radius:999px;padding:1px 9px;background:var(--panel2);white-space:nowrap;align-self:start}' +
      '.src_st.cached,.src_st.tg{background:var(--accent);color:#000}.src_err{color:var(--muted);font-size:13px}' +
      '.src_set input[type=url],.src_set select{flex:1 1 220px;min-width:0;min-height:44px;background:var(--panel);color:var(--text);border:1px solid var(--muted);border-radius:10px;padding:9px 14px;font:inherit}' +
      '.src_set label.sw{display:flex;gap:10px;align-items:center;margin:8px 0;min-height:36px}.src_set label.sw input{width:22px;height:22px;flex:none}' +
      '.src_set label.sel{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0}.src_set label.sel select{flex:0 1 200px}' +
      'html.tv .src_row{padding:14px;font-size:19px}html.tv .src_row:focus{outline:4px solid var(--accent)}html.tv .src_bd,html.tv .src_st{font-size:15px}';
    document.head.append(s);
  }
  const ST = {cached: 'src_cached', rd: 'src_rdq', direct: 'src_direct', torrent: 'src_torrent', external: 'src_external', tg: 'src_tg', yt: 'src_yt'};
  const bd = (text, cls) => (text ? `<span class="src_bd ${cls || ''}" dir="ltr">${esc(text)}</span>` : '');
  function rowHtml(r) {
    const tg = tags(r.label), q = r.quality;
    const p = r.probe;
    const v = p && p.verdict, sn = p && p.sniff;
    const bits = [
      q ? bd(q >= 2160 ? '4K' : q + 'p', q >= 2160 ? 'q4' : q >= 1080 ? 'q3' : q >= 720 ? 'q2' : 'q1') : '',
      bd(sn && sn.video ? sn.video.toUpperCase() : tg.codec, v && v.play === 'no' && v.why === 'video' ? 'warn' : ''), bd(tg.hdr),
      bd(sn && sn.audio.length ? sn.audio.join('+').toUpperCase() : tg.audio, v && v.play === 'no' && v.why === 'audio' ? 'warn' : ''), bd(tg.src, tg.cam ? 'warn' : ''),
      String(r.lang || '').split(',').filter(Boolean).map((l) => bd(l.toUpperCase(), 'lang')).join(''),
      bd(sizeText(r.size)), r.dur ? `<span>${esc(t('src_dur', r.dur))}</span>` : '', r.seeds ? `<span dir="ltr">👤 ${r.seeds}</span>` : '',
      r.also && r.also.length ? `<span>${esc(t('src_dup', r.also.length))}</span>` : '',
      p ? (p.ok === true ? bd(t('src_ok') + (p.mbit ? ' · ' + t('src_speed', p.mbit) : ''), 'good') : p.ok === false ? bd(t('src_dead'), 'warn') : `<span>${esc(t('src_untest'))}</span>`) : '',
      v && v.play === 'no' ? bd(t('src_nocodec'), 'warn') : '', sn && sn.subs && sn.he ? bd(t('src_hesub'), 'good') : '',
      r.status === 'external' ? `<span>${esc(t('src_newtab'))}</span>` : '',
      `<span dir="auto">${esc(r.from || '')}</span>`,
    ].filter(Boolean).join('');
    return `<b dir="auto">${esc(r.label || r.from)}</b><span class="src_st ${esc(r.status)}">${esc(t(ST[r.status] || 'src_direct'))}</span>` +
      `<span class="src_meta">${bits}</span>`;
  }
  const playable = (r) => !!(r.tg || r.url || r.yt || r.hash || r.open || r.ext);
  function rowEl(r, q, ctx) {
    const b = document.createElement('button');
    b.className = 'src_row' + (r.dead || (r.probe && r.probe.ok === false) ? ' dead' : '');
    b.innerHTML = rowHtml(r);
    b.onclick = () => play(r, q, ctx);
    r.el = b;
    return b;
  }
  const titleOf = (q) => (q.title || '') + (q.type === 'tv' ? ' ' + epCode(q) : '');
  // row -> playing. ctx = {rows: the list on the screen (for "next link" when this one fails), tries}
  async function play(r, q, ctx) {
    ctx = ctx || {};
    if (r.yt) {                                   // a YouTube page is not a file: it plays in the YouTube player
      if (typeof r.open === 'function') return r.open();
      const yt = await TN.provider('yt').catch(() => null);
      if (yt && yt.play) return yt.play({id: r.yt, title: r.label});
      window.open('https://www.youtube.com/watch?v=' + r.yt, '_blank', 'noopener');
      return;
    }
    if (r.ext && !r.url && !r.tg && !r.hash) { window.open(r.ext, '_blank', 'noopener'); return; }
    if (r.open && !r.url && !r.tg && !r.hash) return r.open();
    const rest = (ctx.rows || []).filter((x) => x !== r && playable(x) && !x.ext && !x.yt && !(x.probe && x.probe.ok === false));
    const at = (ctx.rows || []).indexOf(r);
    const after = rest.filter((x) => (ctx.rows || []).indexOf(x) > at);
    const alt = after.length ? () => play(after[0], q, {rows: ctx.rows, tries: (ctx.tries || 0) + 1}) : null;
    let url = r.url || '', mime = '';
    if (r.hash && !url) {                         // a torrent: through Real-Debrid
      const rd = await TN.provider('rd').catch(() => null);
      if (!rd || !rd.hasToken()) return needRd();
      TN.modal(`<div class="src_box"><p class="msg" id="src_rdm" role="status">…</p><div class="links" id="src_rda"></div></div>`);
      const say = (s) => { const el = document.getElementById('src_rdm'); if (el) el.textContent = s; return !!el; };
      const acts = document.getElementById('src_rda');
      acts.append(TN.button('btn ghost', t('src_back'), () => pick(q)));
      try {
        const f = await rd.resolve(r, {say, maxWait: 600000});
        if (!document.getElementById('src_rdm')) return;
        url = f.url; mime = f.mime;
        say(t('src_rd_ready'));
      } catch (e) {
        if (e && e.code === 'closed') return;
        if (alt && (ctx.tries || 0) < 3 && e && e.code !== 'needs_helper' && e.code !== 'no_token' && document.getElementById('src_rdm')) { say(t('src_next_try')); return alt(); }
        say(e && (e.code === 'needs_helper' || e.code === 'no_token' || e.code === 'rd_expired') ? e.message : t('src_err') + ': ' + safeMsg(e));
        return;
      }
    }
    const pl = await TN.provider('player');
    if (!pl) return r.open && r.open();
    const key = keyOf(q), p = r.probe || {};
    return pl.open({url, tg: r.tg, mime, title: q.title || r.label, sub: q.type === 'tv' ? epCode(q) : (q.year ? String(q.year) : ''),
      resumeKey: key, poster: q.poster, size: r.size,
      meta: Object.assign({}, q, {release: r.label, embeddedHe: !!(p.sniff && p.sniff.subs && p.sniff.he)}),
      back: () => pick(q), alt, autoAlt: (r.status === 'cached' || r.status === 'rd' || !!r.hash) && (ctx.tries || 0) < 3,
      next: q.type === 'tv' ? () => nextEpisode(q) : null,
      history: key ? {key, label: (q.title || '') + (q.type === 'tv' ? ' · ' + t('src_ep', q.season + 'x' + q.episode) : ''), thumb: q.poster || '',
        fanart: q.backdrop || '', plot: q.plot || '',
        play: q.type === 'movie' && q.id ? 'plugin://plugin.video.nova/?' + new URLSearchParams({a: 'play', m: 'movie', id: String(q.id), q: q.title || ''}) : ''} : null});
  }
  function needRd() {
    TN.modal(`<div class="src_box"><p class="msg">${esc(t('src_need_rd'))}</p><div id="src_rdp" class="panel src_set"></div></div>`);
    TN.provider('rd').then((rd) => rd && rd.settingsPanel(document.getElementById('src_rdp'))).catch(() => {});
  }
  let current = null;
  async function pick(req, opts) {
    if (current) current.abort();
    const ctl = new AbortController();
    current = ctl;
    style();
    TN.modal(`<div class="src_box"><h3 dir="auto" id="src_h">${esc(req.title || t('src_title'))}</h3><div id="src_resume"></div>` +
      `<div class="links" id="src_top"></div><p class="hint" id="src_prog" role="status">${esc(t('src_find'))}</p><div id="src_list"></div><div id="src_errs"></div>` +
      `<div class="links"><button class="btn ghost" id="src_set">⚙ ${esc(t('src_settings'))}</button>` +
      (req.id ? `<button class="btn ghost" id="src_det">${esc(t('src_details'))}</button>` : '') + '</div><div id="src_setbox"></div></div>');
    const $ = (id) => document.getElementById(id);
    const sheet = $('src_list'), top = $('src_top');
    let q = req, last = null, showAll = false, shown = [], testing = false, autoDone = !!(opts && opts.noAuto);
    $('src_set').onclick = () => { const b = $('src_setbox'); if (b.firstChild) b.innerHTML = ''; else settingsPanel(b, () => last && draw(last)); };
    if ($('src_det')) $('src_det').onclick = () => TN.openTitle(req.type === 'tv' ? 'tv' : 'movie', req.id);
    const alive = () => current === ctl && document.body.contains(sheet);
    const draw = (out) => {
      if (!alive()) { ctl.abort(); return; }
      last = out;
      q = out.req;
      const h = $('src_h');
      if (h) h.textContent = q.title + (q.type === 'tv' ? ' · ' + epCode(q) : '');
      const box = $('src_resume'), key = keyOf(q), rp = resumeOf(key);
      if (box) {
        box.innerHTML = '';
        if (rp) {
          const p = document.createElement('p'); p.className = 'hint'; p.textContent = t('src_resume', clock(rp.t)) + ' ';
          p.append(TN.button('btn ghost', t('src_start'), () => { dropResume(key); draw(out); }));
          box.append(p);
        }
      }
      const focusAt = sheet.contains(document.activeElement) ? [...sheet.querySelectorAll('.src_row')].indexOf(document.activeElement) : -1;
      const ar = arrange(out, showAll);
      shown = [].concat(...ar.groups.map((g) => g.rows));
      sheet.innerHTML = '';
      const ctx = {rows: shown};
      for (const g of ar.groups) {
        sheet.insertAdjacentHTML('beforeend', `<h4 class="src_g">${esc(groupLabel(g.name))} (${g.rows.length})</h4>`);
        g.rows.forEach((r) => sheet.append(rowEl(r, q, ctx)));
      }
      if (focusAt >= 0) { const again = sheet.querySelectorAll('.src_row')[focusAt]; if (again) again.focus(); }
      top.innerHTML = '';
      const best = shown.find((r) => playable(r) && !r.ext && !r.yt && !r.dead && !(r.probe && (r.probe.ok === false || (r.probe.verdict && r.probe.verdict.play === 'no'))));
      if (best) top.append(TN.button('btn', t('src_best'), () => play(best, q, ctx)));
      if (shown.some((r) => r.tg || (r.url && (r.status === 'cached' || r.status === 'direct')))) {
        top.append(TN.button('btn ghost', testing ? t('src_stop') : t('src_test'), () => { if (testing) testing = false; else runTest(); draw(out); }));
      }
      const done = out.done >= out.total;
      let msg = !done ? t('src_loading', out.done, out.total) : (shown.length ? '' : t('src_none'));
      if (done && !shown.length && !q.imdb && !TN.hasTmdbKey()) msg += ' ' + t('src_notmdb');
      $('src_prog').textContent = msg;
      if (ar.hidden) {
        const p = document.createElement('span'); p.textContent = ' ' + t('src_hidden', ar.hidden) + ' ';
        p.append(TN.button('btn ghost', t('src_show_all'), () => { showAll = true; draw(out); }));
        $('src_prog').append(p);
      }
      $('src_errs').innerHTML = out.errors.map((e) => `<p class="src_err" dir="auto">${esc(e.from)}: ${esc(t('src_err'))} (${esc(e.msg)})</p>`).join('');
      if (done && !autoDone && filters().auto && best && !resumeBlocked()) { autoDone = true; play(best, q, ctx); }
    };
    const resumeBlocked = () => !alive() || !!$('src_setbox').firstChild;
    async function runTest() {
      testing = true;
      const rows = shown.filter((r) => !r.probe && (r.tg || (r.url && (r.status === 'cached' || r.status === 'direct')))).slice(0, 24);
      let n = 0;
      const one = async (r) => {
        if (!testing || !alive()) return;
        try { r.probe = await testRow(r, ctl.signal); } catch (e) { return; }
        n++;
        if (!alive()) return;
        if (r.el && document.body.contains(r.el)) { r.el.innerHTML = rowHtml(r); r.el.classList.toggle('dead', r.probe.ok === false); }
        $('src_prog').textContent = t('src_testing', n, rows.length);
      };
      const queue = rows.slice();
      await Promise.all([0, 1, 2].map(async () => { while (queue.length && testing && alive()) await one(queue.shift()); }));
      testing = false;
      if (alive() && last) draw(last);             // tested-good links move up, dead ones down
    }
    try {
      const out = await find(req, {signal: ctl.signal, onRows: draw});
      draw(out);
      const first = sheet.querySelector('.src_row');
      const sh = document.getElementById('sheet');
      if (first && alive() && (!sh || !sh.contains(document.activeElement) || document.activeElement.classList.contains('close'))) first.focus();
      return out;
    } catch (e) { return null; }
  }

  // ------------------------------------------------------------ settings: filters, addon servers, Real-Debrid
  async function settingsPanel(el, onChange) {
    if (!el) return;
    style();
    const changed = () => { if (onChange) try { onChange(); } catch (e) { /* the list is gone */ } };
    const draw = () => {
      const f = filters();
      const opt = (v, label, cur) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
      el.innerHTML = `<div class="panel src_set" style="margin-top:12px"><h4>${esc(t('src_filters'))}</h4>` +
        `<label class="sel"><span>${esc(t('src_minq'))}</span><select id="src_fq">${[[0, t('src_any')], [480, '480p'], [720, '720p'], [1080, '1080p'], [2160, '4K']].map(([v, l]) => opt(v, l, f.minq)).join('')}</select></label>` +
        `<label class="sel"><span>${esc(t('src_lang'))}</span><select id="src_fl">${[['he', 'עברית'], ['en', 'English'], ['ru', 'Русский']].map(([v, l]) => opt(v, l, f.lang)).join('')}</select></label>` +
        `<label class="sw"><input type="checkbox" id="src_fo"${f.strictLang ? ' checked' : ''}><span>${esc(t('src_lang_only'))}</span></label>` +
        `<label class="sw"><input type="checkbox" id="src_fc"${f.hideCam ? ' checked' : ''}><span>${esc(t('src_hidecam'))}</span></label>` +
        `<label class="sw"><input type="checkbox" id="src_ft"${f.tgFirst ? ' checked' : ''}><span>${esc(t('src_tgfirst'))}</span></label>` +
        `<label class="sw"><input type="checkbox" id="src_fa"${f.auto ? ' checked' : ''}><span>${esc(t('src_auto'))}</span></label>` +
        `<h4>${esc(t('src_addons'))}</h4><div id="src_al"></div>` +
        `<form class="links" id="src_af"><input id="src_ai" type="url" inputmode="url" dir="ltr" placeholder="https://.../manifest.json" aria-label="${esc(t('src_addon_url'))}">` +
        `<button class="btn" type="submit">${esc(t('src_add'))}</button></form><p class="hint" id="src_am" role="status"></p><div id="src_rd"></div>` +
        `<div class="links"><button class="btn ghost" type="button" id="src_sb" aria-expanded="false">${esc(t('src_subs'))}</button></div><div id="src_subs"></div></div>`;
      const set = (k, v) => { TN.settings.set('sources_' + k, v); changed(); };
      el.querySelector('#src_fq').onchange = (e) => set('minq', Number(e.target.value) || 0);
      el.querySelector('#src_fl').onchange = (e) => set('lang', e.target.value);
      el.querySelector('#src_fo').onchange = (e) => set('langonly', !!e.target.checked);
      el.querySelector('#src_fc').onchange = (e) => set('hidecam', !!e.target.checked);
      el.querySelector('#src_ft').onchange = (e) => set('tgfirst', !!e.target.checked);
      el.querySelector('#src_fa').onchange = (e) => set('auto', !!e.target.checked);
      const list = el.querySelector('#src_al');
      addons().forEach((b) => {
        const row = document.createElement('div');
        row.className = 'links';
        row.innerHTML = `<span dir="ltr" style="flex:1;overflow-wrap:anywhere">${esc(addonName(b))}</span>`;
        row.append(TN.button('btn ghost', t('src_remove'), () => { setAddons(addons().filter((x) => x !== b)); draw(); }));
        list.append(row);
      });
      el.querySelector('#src_af').onsubmit = (e) => {
        e.preventDefault();
        const v = addonBase(el.querySelector('#src_ai').value);
        if (!v) { el.querySelector('#src_am').textContent = t('src_addon_bad'); return; }
        setAddons(addons().concat(v)); draw();
      };
      TN.provider('rd').then((rd) => rd && rd.settingsPanel && rd.settingsPanel(el.querySelector('#src_rd'))).catch(() => {});
      el.querySelector('#src_sb').onclick = (e) => {
        const box = el.querySelector('#src_subs');
        if (box.firstChild) { box.innerHTML = ''; e.currentTarget.setAttribute('aria-expanded', 'false'); return; }
        e.currentTarget.setAttribute('aria-expanded', 'true');
        TN.provider('subs').then((sb) => { if (sb && sb.settingsPanel && document.body.contains(box)) sb.settingsPanel(box, {compact: true}); }).catch(() => {});
      };
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
    b.setAttribute('data-autofocus', '');
    acts.prepend(b);
  });
  TN.addHistoryHandler((e) => {
    const key = String((e && e.key) || ''), playAddr = String((e && e.play) || '');
    let m = /^tv:(\d+):(\d+):(\d+)$/.exec(key);
    if (m) { pick({type: 'tv', id: m[1], season: +m[2], episode: +m[3], poster: e.thumb || ''}); return true; }
    m = /^movie:(\d+)$/.exec(key);
    // a film that was really played (it has a resume point here, or Kodi's play address): straight to the links
    if (m && (resumeOf(key) || (/[?&]a=play\b/.test(playAddr) && /plugin\.video\.nova\//.test(playAddr)))) {
      const p = new URLSearchParams(playAddr.split('?')[1] || '');
      pick({type: 'movie', id: m[1], title: p.get('q') || e.label || '', poster: e.thumb || ''});
      return true;
    }
    return false;
  });

  TN.registerProvider('sources', Object.assign({kinds: ['service'], label: t('src_title'),
    open: pick, pick, find, play, arrange, iaBest, register, addons, setAddons, nextEpisode, resumeOf, dropResume, complete, settingsPanel,
    servicesPanel: settingsPanel, testRow, probeUrl, filters}, pure));
})(typeof self !== 'undefined' ? self : globalThis);
