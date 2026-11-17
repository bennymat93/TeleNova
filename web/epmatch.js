'use strict';
// TeleNova web, WP-2: season / episode parsing and exact matching, ported 1:1 from
// src/plugin.video.nova/resources/lib/epmatch.py (checked against its outputs by src/qa/web/t_matcher.js).
// parse(text) -> [season, episode]; wanted(query, season, episode); matches(want, title, description);
// mentions(show, title, description); filterItems(want, items, titleKey, descKey, show); queryFor(show, season, episode).
// In the page: `await TN.provider('epmatch')` (a 'service') or self.TNEpmatch. Also runs in node.
(function (root) {
  const N = '0*(\\d{1,3})(?!\\d)';
  const B = '(?<![0-9A-Za-z\\u0590-\\u05ff\\u0400-\\u04ff])';
  const r = (s, f) => new RegExp(s, (f || '') + 'du');     // d: group positions
  const PAIR = [
    r(B + 's' + N + '[\\s._-]*e(?:p(?:isode)?)?[\\s._-]*' + N, 'i'),
    r(B + N + 'x' + N + '(?![0-9A-Za-z])', 'i'),
    r(B + 'season[\\s._-]*' + N + '[\\s,._-]*(?:episode|ep\\.?)[\\s._-]*' + N, 'i'),
    r(B + '(?:עונה|ע)[\\s\'"׳._-]*' + N + '[\\s,._-]*(?:פרק|פ)[\\s\'"׳._-]*' + N),
    r(B + 'сезон[\\s._-]*' + N + '[\\s,._-]*(?:серия|эпизод)[\\s._-]*' + N, 'i'),
    r(B + N + '[\\s-]*(?:й|ой)?[\\s-]*сезон[\\s,._-]*' + N + '[\\s-]*(?:я|ая)?[\\s-]*(?:серия|эпизод)', 'i'),
  ];
  const SEASON = [
    r(B + 's' + N + '(?![0-9A-Za-z])', 'i'),
    r(B + 'season[\\s._-]*' + N, 'i'),
    r(B + 'עונה[\\s\'"׳._-]*' + N),
    r(B + 'сезон[\\s._-]*' + N, 'i'),
    r(B + N + '[\\s-]*(?:й|ой)?[\\s-]*сезон', 'i'),
  ];
  const EPISODE = [
    r(B + '(?:episode|ep\\.?|e)[\\s._-]*' + N, 'i'),
    r(B + 'פרק[\\s\'"׳._-]*' + N),
    r(B + '(?:серия|эпизод)[\\s._-]*' + N, 'i'),
    r(B + N + '[\\s-]*(?:я|ая)?[\\s-]*(?:серия|эпизод)', 'i'),
  ];
  const RANGE = r('\\s*[-–—~]\\s*(?:e|ep|episode|серия|פרק)?\\s*\\d{1,3}(?![\\dpPkKiIрк])', 'iy');
  const none = (v) => v === null || v === undefined || v === '';
  function episodeAt(t, m, g) {               // index just after group g of match m
    RANGE.lastIndex = m.indices[g][1];
    return RANGE.test(t) ? null : parseInt(m[g], 10);
  }
  function parse(text) {
    const t = text || '';
    for (const rx of PAIR) { const m = rx.exec(t); if (m) return [parseInt(m[1], 10), episodeAt(t, m, 2)]; }
    let season = null;
    for (const rx of SEASON) { const m = rx.exec(t); if (m) { season = parseInt(m[1], 10); break; } }
    for (const rx of EPISODE) { const m = rx.exec(t); if (m) return [season, episodeAt(t, m, 1)]; }
    return [season, null];
  }
  function wanted(query = '', season = null, episode = null) {
    const [qs, qe] = parse(query);
    return [none(season) ? qs : parseInt(season, 10), none(episode) ? qe : parseInt(episode, 10)];
  }
  function matches(want, title, description = '') {
    const [ws, we] = want;
    if (ws === null && we === null) return true;
    let [ts, te] = parse(title);
    if (ts === null && te === null) [ts, te] = parse(description);
    if (we !== null && te !== we) return false;
    if (ws !== null && ts !== ws) return false;
    return true;
  }
  const words = (t) => String(t || '').toLowerCase().match(/[0-9a-z֐-׿а-яё]+/gu) || [];
  const STOP = ['the', 'a', 'an', 'and', 'of'];
  function mentions(show, title, description = '') {
    let need = words(show).filter((w) => w.length >= 2 && !STOP.includes(w));
    if (!need.length) need = words(show);
    if (!need.length) return true;
    need = [...new Set(need)];
    const least = need.length <= 2 ? need.length : Math.ceil(need.length * 4 / 5);
    return [title, description].some((t) => { const have = new Set(words(t)); return need.filter((w) => have.has(w)).length >= least; });
  }
  function filterItems(want, items, titleKey = 'label', descKey = 'plot', show = '') {
    if (want[0] === null && want[1] === null) return items.slice();
    return items.filter((it) => matches(want, it[titleKey] || '', it[descKey] || '') && (!show || mentions(show, it[titleKey] || '', it[descKey] || '')));
  }
  const p2 = (n) => String(n).padStart(2, '0');
  function queryFor(show, season = null, episode = null) {
    const lang = /[Ѐ-ӿ]/.test(show || '') ? 'ru' : /[֐-׿]/.test(show || '') ? 'he' : 'en';
    const s = none(season) ? null : parseInt(season, 10), e = none(episode) ? null : parseInt(episode, 10);
    const fmt = {
      ru: [() => `${s} сезон ${e} серия`, () => `${s} сезон`, () => `${e} серия`],
      he: [() => `עונה ${s} פרק ${e}`, () => `עונה ${s}`, () => `פרק ${e}`],
      en: [() => `S${p2(s)}E${p2(e)}`, () => `Season ${s}`, () => `Episode ${e}`],
    }[lang];
    const parts = [(show || '').trim()];
    if (s !== null && e !== null) parts.push(fmt[0]()); else if (s !== null) parts.push(fmt[1]()); else if (e !== null) parts.push(fmt[2]());
    return parts.filter(Boolean).join(' ');
  }
  const E = {parse, wanted, matches, mentions, filterItems, queryFor};
  root.TNEpmatch = E;
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
  if (root.TN && root.TN.registerProvider) root.TN.registerProvider('epmatch', Object.assign({kinds: ['service']}, E));
})(typeof self !== 'undefined' ? self : globalThis);
