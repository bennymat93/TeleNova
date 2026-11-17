'use strict';
// TeleNova web, WP-2: the Kodi engine's release-name parser and exact matcher, ported 1:1 from
// src/plugin.video.telescope/resources/lib/parser.py + matcher.py, plus sources.py plan_queries / union_dedup /
// order_groups. Pure logic, no DOM: also runs in node (module.exports) for src/qa/web/t_matcher.js, which checks it
// against fixtures the Python code wrote (src/qa/web/gen_tg_fixtures.py -> web/tests/tg_cases.json).
// In the page: `const M = await TN.provider('matcher')` (a 'service'), or self.TNMatcher.
(function (root) {
  const W = '\\p{L}\\p{N}_';                          // Python's Unicode \w
  const BD = `(?:(?<=[${W}])(?![${W}])|(?<![${W}])(?=[${W}]))`;   // Python's \b
  // Python-style source -> JS RegExp: \b and \w get their Unicode meaning, always the 'u' flag
  const rx = (src, flags) => new RegExp(src.replace(/\\b/g, BD), (flags || '') + 'u');
  const glob = (r) => new RegExp(r.source, r.flags.includes('g') ? r.flags : r.flags + 'g');

  const VIDEO_EXT = new Set(['mkv', 'mp4', 'avi', 'm4v', 'mov', 'webm', 'ts', 'm2ts', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'vob']);
  const ARCHIVE_EXT = new Set(['rar', 'zip', '7z', 'tar', 'gz', 'r00', 'r01', 'iso']);
  const JUNK_EXT = new Set(['nfo', 'txt', 'srt', 'sub', 'idx', 'ass', 'jpg', 'jpeg', 'png', 'sfv', 'md5', 'url', 'exe', 'lnk']);
  const HEB = /[֐-׿]/u, CYR = /[Ѐ-ӿ]/u;

  const SER = 'сери[яийю](?![а-яё])';
  const NOYEAR = '(?<!\\d)(?!(?:19|20)\\d{2}(?!\\d))';
  const SE_PATTERNS = [
    rx('(?<![a-z0-9])s(\\d{1,2})[\\s._-]*e(\\d{1,4})(?:[\\s._-]*(?:-|~|e)[\\s._-]*e?(\\d{1,4}))?(?!\\d)', 'i'),
    rx('(?<![a-z0-9])(\\d{1,2})x(\\d{2,3})(?:-(\\d{2,3}))?(?![0-9p])', 'i'),
    rx('season[\\s._-]*(\\d{1,2})[\\s._,:-]*(?:episode|ep)[\\s._:-]*(\\d{1,4})(?:[\\s]*-[\\s]*(\\d{1,4}))?', 'i'),
    rx('עונה[\\s._:\\-]*(\\d{1,2})[\\s._,:\\-]*פרק(?:ים)?[\\s._:\\-]*(\\d{1,4})(?:[\\s]*-[\\s]*(\\d{1,4}))?'),
    rx('(?<![א-ת])ע[\'׳"]?\\s*(\\d{1,2})[\\s._,:\\-]*פ[\'׳"]?\\s*(\\d{1,4})(?!\\d)'),
    rx('(?<!\\d)(\\d{1,2})[\\s._-]*сезон\\S*[\\s._,:/\\-]*' + NOYEAR + '(\\d{1,4})(?:[\\s]*-[\\s]*(\\d{1,4}))?[\\s._-]*' + SER, 'i'),
    rx('сезон\\S*[\\s._:\\-]*(?<!\\d)(\\d{1,2})(?!\\d)[\\s._,:/\\-]*' + SER + '[\\s._:\\-]*' + NOYEAR + '(\\d{1,4})(?!\\d)(?:[\\s]*-[\\s]*(\\d{1,4}))?', 'i'),
  ];
  const EP_ONLY = [
    rx('(?<![a-z0-9])(?:episode|ep|e)[\\s._:-]*(\\d{1,4})(?!\\d|p)', 'i'),
    rx('פרק[\\s._:\\-]*(\\d{1,4})(?!\\d)'),
    rx(NOYEAR + '(\\d{1,4})[\\s._-]*' + SER, 'i'),
    rx(SER + '[\\s._:\\-]*' + NOYEAR + '(\\d{1,4})(?!\\d)', 'i'),
  ];
  const SEASON_ONLY = [
    rx('(?<![a-z0-9])s(\\d{1,2})(?![0-9e])', 'i'),
    rx('season[\\s._-]*(\\d{1,2})', 'i'),
    rx('עונה[\\s._:\\-]*(\\d{1,2})'),
    rx('(?<!\\d)(\\d{1,2})[\\s._-]*сезон', 'i'),
    rx('сезон\\S*[\\s._:\\-]*(?<!\\d)(\\d{1,2})(?!\\d)', 'i'),
  ];
  const PACK = rx('complete|full[\\s._-]*season|כל[\\s]*הפרקים|עונה[\\s]*מלאה|все[\\s]*серии', 'i');
  const YEAR = rx('(?<![0-9])(19[2-9]\\d|20[0-4]\\d)(?![0-9]|p|i)', 'g');
  const EP_CHAIN = rx('(?<![a-z0-9])s\\d{1,2}[\\s._-]*e\\d{1,4}((?:[\\s._-]*e\\d{1,4})+)(?!\\d)', 'i');
  const EP_RANGE = rx('(?<![a-z0-9])(?:episodes?|eps?|e)[\\s._:-]*(\\d{1,4})[\\s._]*-[\\s._]*e?(\\d{1,4})(?!\\d|p)', 'i');
  const SEASON_RANGE = [
    rx('(?<![a-z0-9])s(\\d{1,2})[\\s._]*-[\\s._]*s?(\\d{1,2})(?![0-9e])', 'i'),
    rx('seasons?[\\s._-]*(\\d{1,2})[\\s._]*-[\\s._]*(\\d{1,2})(?!\\d)', 'i'),
    rx('עונות[\\s._:\\-]*(\\d{1,2})\\s*-\\s*(\\d{1,2})(?!\\d)'),
    rx('(?<!\\d)(\\d{1,2})\\s*-\\s*(\\d{1,2})[\\s._-]*сезон', 'i'),
    rx('сезон\\S*[\\s._:\\-]*(?<!\\d)(\\d{1,2})\\s*-\\s*(\\d{1,2})(?!\\d)', 'i'),
  ];
  const JUNK_NAME = rx('(?<![a-z0-9])(?:featurettes?|extras|behind[\\s._-]*the[\\s._-]*scenes|deleted[\\s._-]*scenes|' +
    'making[\\s._-]*of|bloopers|gag[\\s._-]*reel)(?![a-z0-9])|מאחורי[\\s]*הקלעים|סצנות[\\s]*שנמחקו|за[\\s]*кадром|бонус', 'gi');
  const RELEASE_MARK = rx('(?<![0-9])(?:19|20)\\d{2}(?![0-9])|[Ss]\\d{1,2}[ ._-]?[Ee]\\d{1,3}|\\d{1,2}x\\d{2}|' +
    '(?<![0-9])(?:480|576|720|1080|2160)[pi]', 'i');
  const QUALITY = [
    [2160, rx('2160p|\\b4k\\b|\\buhd\\b', 'i')],
    [1080, rx('1080[pi]|\\bfhd\\b|full[\\s._-]?hd', 'i')],
    [720, rx('720p|(?<![a-z])hd(?![a-z])|\\bhdrip\\b', 'i')],
    [480, rx('480p|\\bsd\\b|dvdrip|\\bdvd\\b', 'i')],
    [360, rx('360p|240p', 'i')],
  ];
  const SOURCE = [
    ['cam', rx('\\b(?:hd)?cam(?:rip)?\\b|\\btelesync\\b|\\bhd-?ts\\b|(?<![a-z])ts(?:rip)?(?![a-z])|\\btc\\b|מצלמה|камрип|экранка', 'i')],
    ['bluray', rx('blu-?ray|bdrip|brrip|bdremux|remux', 'i')],
    ['web', rx('web-?dl|webrip|\\bweb\\b|amzn|nf\\b|dsnp|hmax|atvp', 'i')],
    ['hdtv', rx('hdtv|satrip|iptv', 'i')],
    ['dvd', rx('dvdrip|dvd', 'i')],
  ];
  const CODEC = [['hevc', rx('x\\.?265|h\\.?265|hevc', 'i')], ['av1', rx('\\bav1\\b', 'i')], ['avc', rx('x\\.?264|h\\.?264|avc', 'i')]];
  const HDR = rx('\\bhdr(?:10)?\\+?\\b|dolby[\\s._-]?vision|\\bdv\\b', 'i');
  const LANG_RULES = [
    ['he_dub', rx('מדובב|דיבוב|heb(?:rew)?[\\s._-]*dub', 'i')],
    ['he_sub', rx('תרגום|מתורגם|heb[\\s._-]*subs?|hebsub|hebrew[\\s._-]*sub', 'i')],
    ['ru_audio', rx('дубляж|дублир|многоголос|озвуч|перевод|\\bmvo\\b|\\bdvo\\b|\\bavo\\b|\\brus(?:sian)?\\b', 'i')],
    ['ru_sub', rx('субтитр|rus[\\s._-]*subs?', 'i')],
    ['en', rx('\\beng(?:lish)?\\b|\\boriginal\\b', 'i')],
  ];
  const DUB = rx('\\bdub\\b', 'i');
  const TRAILER = rx('trailer|teaser|sample|promo|טריילר|טיזר|трейлер|тизер', 'i');
  const STOP = rx('(?<![a-z0-9])(?:s\\d{1,2}[\\s._-]*e\\d{1,4}|s\\d{1,2}(?![a-z0-9])|\\d{1,2}x\\d{2,3}|season|episode|' +
    '(?:19[2-9]\\d|20[0-4]\\d)(?![0-9]|p)|2160p|1080[pi]|720p|480p|4k|uhd|bluray|blu-ray|bdrip|brrip|' +
    'web-?dl|webrip|web|hdtv|hdrip|dvdrip|x\\.?26[45]|h\\.?26[45]|hevc|hdr|remux|proper|repack|' +
    'extended|unrated|imax|multi|dubbed|subbed)(?![a-z])|עונה|פרק|מדובב|תרגום|מתורגם|сезон|сери|дубляж|фильм', 'i');
  const JUNK = rx('@[a-z0-9_]{3,}|https?://\\S+|www\\.\\S+|t\\.me/\\S+|\\[[^\\]]*\\]|\\{[^}]*\\}', 'gi');
  const CREDIT = rx('הועלה\\s*ע["״\'׳]?י[^\\n]*|קרדיט[^\\n]*|' +
    'צ[\'׳’]?יקו\\s*מדיה|chiko\\s*media', 'gi');
  const EMOJI = /[\u{1F000}-\u{1FAFF}☀-➿\ufe0f\u200d\u200e\u200f\u202a-\u202e]/gu;

  // ---------------------------------------------------------------- parser.py
  const stripMarks = (t) => String(t || '').normalize('NFKD').replace(/\p{Mn}/gu, '');
  function normalize(text) {
    let t = stripMarks(text).toLowerCase().replace(/ё/g, 'е');
    t = t.replace(/&/g, ' and ').replace(/['’׳״`"]/g, '');
    t = t.replace(/[^\p{L}\p{N}_]+/gu, ' ').replace(/_/g, ' ');
    return t.replace(/\s+/g, ' ').trim();
  }
  const clean = (t) => String(t || '').replace(EMOJI, ' ').replace(CREDIT, ' ').replace(JUNK, ' ');
  function splitName(filename) {
    let name = filename || '', ext = '';
    const m = /\.([a-z0-9]{2,4})$/i.exec(name);
    if (m) { ext = m[1].toLowerCase(); name = name.slice(0, m.index); }
    return [name, ext];
  }
  const dotSpace = (t) => t.replace(rx(`(?<=[${W}])[._](?=[${W}])`, 'g'), ' ');
  const stripChars = (s, chars) => {           // Python str.strip(chars)
    let a = 0, b = s.length;
    while (a < b && chars.includes(s[a])) a++;
    while (b > a && chars.includes(s[b - 1])) b--;
    return s.slice(a, b);
  };
  const TITLE_RXS = [STOP, ...SE_PATTERNS, ...EP_ONLY, ...SEASON_ONLY, ...SOURCE.map((x) => x[1]), ...QUALITY.map((x) => x[1])].map(glob);
  function titlePart(text) {
    let t = dotSpace(clean(text)).replace(/[()]/g, ' ').replace(/\s+/g, ' ');
    let cut = t.length;
    for (const r of TITLE_RXS) {
      for (const m of t.matchAll(r)) if (m.index > 0) { cut = Math.min(cut, m.index); break; }
    }
    t = t.slice(0, cut).replace(/[\s\-|:,~]+$/u, '');
    return stripChars(t.replace(/\s+/g, ' ').trim(), ' -|:.');
  }
  function findSe(text) {
    const t = dotSpace(text || '');
    for (const r of SE_PATTERNS) {
      const m = r.exec(t);
      if (m) {
        const s = +m[1], e = +m[2];
        let end = m[3] ? +m[3] : null;
        if (end !== null && (end <= e || end - e > 30)) end = null;
        return [s, e, end];
      }
    }
    return [null, null, null];
  }
  function findEpisodeEnd(text, s, e) {
    const t = dotSpace(text || '');
    let end = null;
    let m = EP_CHAIN.exec(t);
    if (m && s !== null) {
      const nums = (m[1].match(/\d+/g) || []).map(Number);
      end = nums.length ? nums[nums.length - 1] : null;
    } else {
      m = EP_RANGE.exec(t);
      if (m && e !== null && +m[1] === e) end = +m[2];
    }
    if (end !== null && e !== null && (end <= e || end - e > 30)) end = null;
    return end;
  }
  function findSeasonRange(text) {
    const t = dotSpace(text || '');
    for (const r of SEASON_RANGE) {
      const m = r.exec(t);
      if (m) { const a = +m[1], b = +m[2]; if (a >= 0 && a < b && b < 60) return [a, b]; }
    }
    return [null, null];
  }
  function isJunkName(name, ext) {
    if (JUNK_EXT.has((ext || '').toLowerCase())) return true;
    const t = dotSpace(name || '');
    const mk = RELEASE_MARK.exec(t);
    if (!mk) return false;
    JUNK_NAME.lastIndex = mk.index + mk[0].length;
    return !!JUNK_NAME.exec(t);
  }
  function findEpisodeOnly(text) {
    const t = dotSpace(text || '');
    for (const r of EP_ONLY) { const m = r.exec(t); if (m) { const v = +m[1]; if (v > 0 && v < 3000) return v; } }
    return null;
  }
  function findSeasonOnly(text) {
    const t = dotSpace(text || '');
    for (const r of SEASON_ONLY) { const m = r.exec(t); if (m) { const v = +m[1]; if (v >= 0 && v < 60) return v; } }
    return null;
  }
  function findYear(text) {
    const t = String(text || '').replace(/\d{3,4}x\d{3,4}/g, ' ');
    const years = [...t.matchAll(YEAR)].map((m) => +m[1]);
    if (!years.length) return null;
    const br = /[([](19[2-9]\d|20[0-4]\d)[)\]]/.exec(t);
    if (br) return +br[1];
    return years.length > 1 ? years[years.length - 1] : years[0];
  }
  const RES = /(?<!\d)\d{3,4}\s*[x×]\s*(2160|1080|720|576|480)(?!\d)/iu;
  function findQuality(text) {
    const m = RES.exec(text || '');
    if (m) { const v = +m[1]; return v === 576 ? 480 : v; }
    for (const [q, r] of QUALITY) if (r.test(text || '')) return q;
    return 0;
  }
  function findSource(text) {
    for (const [n, r] of SOURCE) if (r.test(text || '')) return n;
    return '';
  }
  function findLangs(text) {
    const t = text || '', tags = new Set();
    for (const [tag, r] of LANG_RULES) if (r.test(t)) tags.add(tag);
    if (HEB.test(t)) tags.add('he_text');
    if (CYR.test(t)) { tags.add('ru_text'); if (DUB.test(t)) tags.add('ru_audio'); }
    return tags;
  }
  const or = (a, b) => (a ? a : b);            // Python `a or b` (0 / null / '' fall through)
  function parse(filename, caption, chatTitle) {
    const [name, ext] = splitName(filename || '');
    caption = caption || '';
    let firstLine = '';
    for (let line of caption.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/)) {
      line = stripChars(clean(line), ' -|:*_');
      if (normalize(line).length >= 2) { firstLine = line; break; }
    }
    const full = name + ' ' + caption;
    let [s, e, eEnd] = findSe(name);
    if (e === null) [s, e, eEnd] = findSe(caption);
    let seasonOnly = null, epOnly = null;
    if (e === null) {
      epOnly = or(findEpisodeOnly(name), findEpisodeOnly(caption));
      seasonOnly = or(findSeasonOnly(name), findSeasonOnly(caption));
      if (epOnly !== null) { e = epOnly; s = seasonOnly; }
    }
    const year = or(findYear(name), findYear(caption));
    if (e !== null) {
      const more = findEpisodeEnd(name, s, e);
      if (more !== null && (eEnd === null || more > eEnd)) eEnd = more;
    }
    let [sFirst, sLast] = findSeasonRange(name);
    if (sFirst === null) [sFirst, sLast] = findSeasonRange(caption);
    if (e === null && seasonOnly === null && sFirst !== null) seasonOnly = sFirst;
    const titles = [];
    for (const src of [name, firstLine]) {
      const tp = titlePart(src);
      if (tp && normalize(tp) && !titles.map(normalize).includes(normalize(tp))) titles.push(tp);
    }
    const tech = name + ' ' + caption;
    const source = or(findSource(name), findSource(caption));
    const codec = CODEC.find(([, r]) => r.test(tech));
    return {
      ext, name, title: titles[0] || '', titles, year: year === undefined ? null : year,
      season: s, episode: e, episode_end: eEnd, season_hint: seasonOnly === undefined ? null : seasonOnly,
      season_pack: !!(e === null && (seasonOnly !== null || PACK.test(full))),
      quality: findQuality(tech), source, codec: codec ? codec[0] : '', hdr: HDR.test(tech),
      langs: [...findLangs(tech)].sort(),
      is_trailer: TRAILER.test(name), trailer_caption: TRAILER.test(caption), is_archive: ARCHIVE_EXT.has(ext),
      is_junk: isJunkName(name, ext), is_cam: source === 'cam', season_end: e === null ? sLast : null,
      chat_season: chatTitle ? findSeasonOnly(chatTitle) : null,
    };
  }

  // ---------------------------------------------------------------- difflib.SequenceMatcher(None, a, b).ratio()
  function seqRatio(a, b) {
    a = Array.from(a); b = Array.from(b);
    const la = a.length, lb = b.length;
    if (!la && !lb) return 1;
    const b2j = new Map();
    b.forEach((ch, j) => { if (!b2j.has(ch)) b2j.set(ch, []); b2j.get(ch).push(j); });
    if (lb >= 200) {                            // autojunk, as difflib does
      const ntest = Math.floor(lb / 100) + 1;
      for (const [ch, idx] of [...b2j]) if (idx.length > ntest) b2j.delete(ch);
    }
    function longest(alo, ahi, blo, bhi) {
      let bi = alo, bj = blo, k = 0, j2len = new Map();
      for (let i = alo; i < ahi; i++) {
        const nj = new Map();
        for (const j of b2j.get(a[i]) || []) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const kk = (j2len.get(j - 1) || 0) + 1;
          nj.set(j, kk);
          if (kk > k) { bi = i - kk + 1; bj = j - kk + 1; k = kk; }
        }
        j2len = nj;
      }
      // isjunk is None: nothing is junk, so the match grows over equal (popular) neighbours, as in difflib
      while (bi > alo && bj > blo && a[bi - 1] === b[bj - 1]) { bi--; bj--; k++; }
      while (bi + k < ahi && bj + k < bhi && a[bi + k] === b[bj + k]) k++;
      return [bi, bj, k];
    }
    let matches = 0;
    const queue = [[0, la, 0, lb]];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const [i, j, k] = longest(alo, ahi, blo, bhi);
      if (k) {
        matches += k;
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    return 2 * matches / (la + lb);
  }

  // ---------------------------------------------------------------- matcher.py
  const ROMAN = {ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10'};
  const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'le', 'la', 'il', 'der', 'die', 'das']);
  const tokens = (text) => { const n = normalize(text); return n ? n.split(' ').map((t) => ROMAN[t] || t) : []; };
  const isDigits = (t) => /^\p{Nd}+$/u.test(t);
  const setDiff = (a, b) => new Set([...a].filter((x) => !b.has(x)));
  function titleSimilarity(candidate, alias) {
    const ct = tokens(candidate), at = tokens(alias);
    if (!ct.length || !at.length) return 0;
    const cn = ct.join(' '), an = at.join(' ');
    if (cn === an) return 1;
    const cset = new Set(ct.filter((t) => !STOPWORDS.has(t)));
    let aset = new Set(at.filter((t) => !STOPWORDS.has(t)));
    if (!aset.size) aset = new Set(at);
    const numC = new Set(ct.filter(isDigits)), numA = new Set(at.filter(isDigits));
    const extraN = new Set([...setDiff(numC, numA), ...setDiff(numA, numC)]);
    if (extraN.size && [...extraN].some((n) => Array.from(n).length <= 2)) return Math.min(0.45, seqRatio(cn, an));
    let ratio = seqRatio(cn, an);
    if ([...aset].every((x) => cset.has(x))) {
      ratio = Math.max(ratio, 0.97 - 0.06 * setDiff(cset, aset).size);
    } else if ([...cset].every((x) => aset.has(x)) && cset.size >= Math.max(1, aset.size - 1) && aset.size >= 3) {
      ratio = Math.max(ratio, 0.86);
    }
    return ratio;
  }
  function bestTitleScore(texts, aliases) {
    let best = 0, bestAlias = '';
    for (const t of texts) {
      if (!t) continue;
      for (const a of aliases) { const sc = titleSimilarity(t, a); if (sc > best) { best = sc; bestAlias = a; } }
    }
    return [best, bestAlias];
  }
  function containsAlias(text, aliases) {
    const nt = ' ' + tokens(text).join(' ') + ' ';
    return aliases.some((a) => { const na = tokens(a).join(' '); return Array.from(na).length >= 4 && nt.includes(' ' + na + ' '); });
  }
  function isVideoFile(c) {
    const ext = (c.ext || '').toLowerCase(), mime = (c.mime || '').toLowerCase();
    return mime.startsWith('video/') || VIDEO_EXT.has(ext) || !!c.is_video_attr;
  }
  const captionTrailer = (p, size, dur) => !!p.trailer_caption && !!((dur && dur < 600) || (size && size < 150 * 1024 * 1024));
  const f2 = (x) => Number(x).toFixed(2);
  const round2 = (x) => Number(Number(x).toFixed(2));
  const isNone = (v) => v === null || v === undefined;

  function evaluate(cand, target, strict = true) {
    const reasons = [], p = cand.parsed;
    if (p.is_archive || !isVideoFile(cand)) return ['reject', 0, ['not a video']];
    if (p.is_trailer) return ['reject', 0, ['trailer/sample']];
    if (p.is_junk) return ['reject', 0, ['extras/junk']];
    const size = cand.size || 0, duration = cand.duration || 0;
    if (captionTrailer(p, size, duration)) return ['reject', 0, ['trailer/sample']];
    if (size && size < 15 * 1024 * 1024) return ['reject', 0, ['too small']];
    const aliases = target.aliases || [];
    let [tscore] = bestTitleScore(p.titles || [], aliases);
    const captionHit = containsAlias(cand.caption || '', aliases) || containsAlias(p.name || '', aliases);
    const chatHit = containsAlias(cand.chat_title || '', aliases);
    if (captionHit) tscore = Math.max(tscore, 0.88);
    if (chatHit && tscore < 0.8) tscore = Math.max(tscore, target.kind === 'episode' ? 0.8 : tscore);
    reasons.push('title ' + f2(tscore));
    let verdict = 'accept', score = tscore * 50;
    const runtime = (target.runtime || 0) * 60;
    if (target.kind === 'movie') {
      if (!isNone(p.episode) && !isNone(p.season)) return ['reject', 0, ['episode file']];
      if (p.season_pack && !isNone(p.season_hint)) return ['reject', 0, ['season pack']];
      const ty = target.year, py = p.year;
      if (ty && py) {
        const diff = Math.abs(parseInt(ty, 10) - parseInt(py, 10));
        if (diff > 1) return ['reject', 0, [`year ${py} != ${ty}`]];
        score += diff === 0 ? 10 : 2;
      } else if (ty) { verdict = 'maybe'; reasons.push('no year'); }
      if (runtime && duration) {
        const tol = Math.max(600, 0.15 * runtime);
        if (Math.abs(duration - runtime) > tol) return ['reject', 0, [`duration ${Math.floor(duration / 60)} vs ${Math.floor(runtime / 60)}`]];
        score += Math.abs(duration - runtime) < 0.06 * runtime ? 10 : 4;
        if (verdict === 'maybe' && tscore >= 0.9) verdict = 'accept';
      } else if (duration && duration < 2400) return ['reject', 0, ['too short for a movie']];
    } else {
      const sReq = parseInt(target.season, 10), eReq = parseInt(target.episode, 10);
      if (p.season_pack && isNone(p.episode)) return ['reject', 0, ['season pack']];
      const ep = p.episode;
      if (isNone(ep)) return ['reject', 0, ['no episode marker']];
      const epEnd = p.episode_end;
      if (epEnd) {
        if (!(ep <= eReq && eReq <= epEnd)) return ['reject', 0, [`episode range ${ep}-${epEnd}`]];
        score -= 8; reasons.push('multi-episode');
      } else if (ep !== eReq) return ['reject', 0, [`episode ${ep} != ${eReq}`]];
      let season = p.season;
      if (isNone(season)) season = p.season_hint;
      if (isNone(season)) season = p.chat_season;
      if (isNone(season)) {
        if (sReq === 1 && (target.total_seasons || 1) === 1) reasons.push('season implied');
        else { verdict = 'maybe'; reasons.push('season unknown'); }
      } else if (parseInt(season, 10) !== sReq) return ['reject', 0, [`season ${season} != ${sReq}`]];
      else score += 10;
      if (runtime && duration) {
        const tol = Math.max(360, 0.35 * runtime);
        if (Math.abs(duration - runtime) > tol && duration < runtime) {
          if (verdict === 'accept') verdict = 'maybe';
          reasons.push('short episode');
        }
      }
    }
    const threshold = strict ? 0.82 : 0.72;
    if (tscore < 0.55) return ['reject', 0, reasons.concat(['title mismatch'])];
    if (tscore < threshold) verdict = 'maybe';
    const q = p.quality || 0;
    score += ({2160: 12, 1080: 10, 720: 6, 480: 2})[q] ?? 3;
    if (p.source === 'cam') { score -= 30; reasons.push('CAM'); }
    if (p.hdr) score += 1;
    return [verdict, round2(score), reasons];
  }
  function languageBonus(langs, pref) {
    const l = new Set(langs || []), any = (...xs) => xs.some((x) => l.has(x));
    if (pref === 'he') { if (any('he_sub', 'he_dub')) return 15; if (l.has('he_text')) return 6; }
    else if (pref === 'ru') { if (l.has('ru_audio')) return 15; if (any('ru_sub', 'ru_text')) return 6; }
    else if (pref === 'en') { if (l.has('en') || !any('he_dub', 'ru_audio')) return 5; }
    return 0;
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  const episodeLabel = (s, e) => `S${pad2(parseInt(s, 10))}E${pad2(parseInt(e, 10))}`;
  const cleanQuery = (t) => String(t || '').replace(/[:!?.,"'()[\]]/g, ' ').replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------- sources.py (Finder)
  function planQueries(t, s = {}) {
    const names = [];
    for (const a of t.aliases || []) {
      const q = cleanQuery(a);
      if (q && !names.map(normalize).includes(normalize(q))) names.push(q);
    }
    names.splice(parseInt(s.max_aliases ?? 4, 10));
    let queries = [];
    if (t.kind === 'movie') queries = names.slice();
    else {
      const se = parseInt(t.season, 10), e = parseInt(t.episode, 10), later = [];
      for (const n of names) {
        queries.push(n);
        if (/[֐-׿]/.test(n)) { queries.push(`${n} פרק ${e}`); later.push(`${n} S${pad2(se)}E${pad2(e)}`, `${n} ע${se} פ${e}`); }
        else if (/[Ѐ-ӿ]/.test(n)) { queries.push(`${n} ${e} серия`); later.push(`${n} S${pad2(se)}E${pad2(e)}`); }
        else { queries.push(`${n} S${pad2(se)}E${pad2(e)}`); later.push(`${n} ${se}x${pad2(e)}`); }
      }
      queries = queries.concat(later);
    }
    const out = [], seen = new Set();
    for (const q of queries) { const k = q.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(q); } }
    return out.slice(0, Math.max(parseInt(s.max_queries ?? 6, 10), t.kind !== 'movie' ? 8 : 0));
  }
  const GROUP = {tg: 0, telemedia: 0, rd: 1};
  function releaseName(c) {
    let n = String(c.file || '').trim().toLowerCase().replace(/\.(mkv|mp4|avi|m4v|ts|webm|mov|wmv)$/, '');
    n = n.replace(/[^0-9a-z֐-׿]+/g, '');
    return Array.from(n).length >= 8 ? n : '';
  }
  function playsBest(c) {
    const b = c.backend || 'tg';
    if (b === 'tg' || b === 'telemedia') return c.probe === 'ok' ? 0 : 1;
    if (b === 'rd') return c.rd_cached || c.probe === 'rd' ? 2 : 3;
    return 4;
  }
  function unionDedup(cands, tol = 0.01) {
    const groups = [], index = new Map();
    for (const c of cands) {
      const name = releaseName(c), size = Math.trunc(+c.size || 0);
      let hit = null;
      if (name && size > 0) {
        for (const gi of index.get(name) || []) {
          const g = groups[gi][0], gs = Math.trunc(+g.size || 0), gd = g.duration || 0, d = c.duration || 0;
          if (Math.abs(gs - size) > tol * Math.max(gs, size)) continue;
          if (gd && d && Math.abs(gd - d) > 0.02 * Math.max(gd, d)) continue;
          hit = gi; break;
        }
      }
      if (hit === null) {
        if (name && size > 0) { if (!index.has(name)) index.set(name, []); index.get(name).push(groups.length); }
        groups.push([c]);
      } else groups[hit].push(c);
    }
    const out = [];
    let folded = 0;
    for (const g of groups) {
      if (g.length === 1) { out.push(g[0]); continue; }
      let best = g[0];
      for (const x of g) if (playsBest(x) < playsBest(best)) best = x;
      best.score = Math.max(...g.map((x) => x.score || 0));
      const also = best.also || (best.also = []);
      for (const x of g) {
        if (x === best) continue;
        folded++;
        also.push(x.backend || 'tg');
        if ((x.backend || 'tg') === 'tg' && !x.url && x.chat_id && (best.backend || 'tg') === 'tg') {
          const mirrors = best.mirrors || (best.mirrors = []);
          if (!mirrors.some((m) => m[0] === x.chat_id && m[1] === x.msg_id)) mirrors.push([x.chat_id, x.msg_id]);
        }
      }
      out.push(best);
    }
    return [out, folded];
  }
  function orderGroups(cands, limit = 25, rdMax = 15) {
    const g = {0: [], 1: [], 2: []};
    for (const c of cands) g[GROUP[c.backend || 'tg'] ?? 2].push(c);
    return g[0].slice(0, limit).concat(g[1].slice(0, rdMax), g[2].slice(0, Math.max(5, Math.floor(limit / 2))));
  }

  const M = {
    VIDEO_EXT, normalize, splitName, titlePart, parse, isJunkName, findYear, findQuality, seqRatio, titleSimilarity,
    bestTitleScore, containsAlias, isVideoFile, evaluate, languageBonus, episodeLabel, cleanQuery, planQueries,
    releaseName, playsBest, unionDedup, orderGroups,
  };
  root.TNMatcher = M;
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
  if (root.TN && root.TN.registerProvider) root.TN.registerProvider('matcher', Object.assign({kinds: ['service']}, M));
})(typeof self !== 'undefined' ? self : globalThis);
