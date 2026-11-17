'use strict';
// TeleNova web, WP-8: topics / learning hubs (plan row 16) - the build's topics.py on the web.
// Data: web/data/topics/<section>.json (copies of plugin.video.nova/resources/topics/*.json, edit both together)
// Videos come through yt.js (API key or helper Worker). Only in-depth videos (min_seconds), never Shorts.
// Pages: #/topics  |  #/topics/s=<section>  |  #/topics/s=<section>&c=<cat>  |  &top=1  |  &q=<words>
// Provider 'topics' (no kind; TN.provider('topics')): {sections, search(q) over what is already loaded, select, ...}
(function (TN) {
  if (!TN) return;
  TN.i18n.add({
    he: {topics_title: 'אקטואליה וידע', topics_search: 'חיפוש בנושא', topics_top: 'המדורגים ביותר', topics_none: 'אין סרטונים כאן כרגע.',
      topics_loading: 'טוען %s ערוצים...'},
    en: {topics_title: 'News & knowledge', topics_search: 'Search this topic', topics_top: 'Top rated', topics_none: 'No videos here right now.',
      topics_loading: 'Loading %s channels...'},
    ru: {topics_title: 'Новости и знания', topics_search: 'Поиск по теме', topics_top: 'Самые популярные', topics_none: 'Здесь пока нет видео.',
      topics_loading: 'Загрузка каналов: %s...'},
  });
  // the build's HUB list (topics.py), in its order
  const SECTIONS = [
    ['knowledge', ['ידע וטכנולוגיה', 'Knowledge & technology', 'Знания и технологии'], 'tech', 2],
    ['news', ['חדשות', 'News', 'Новости'], 'news_world', 1],
    ['plc', ['בקרה תעשייתית', 'Industrial control', 'Промышленная автоматизация'], 'plc_hub', 2],
    ['smarthome', ['בית חכם', 'Smart home', 'Умный дом'], 'smart_ha', 2],
    ['diy', ['DIY – עשה זאת בעצמך', 'DIY – do it yourself', 'DIY – сделай сам'], 'diy_reno', 2],
    ['dogs', ['אילוף כלבים', 'Dog training', 'Дрессировка собак'], 'puppy', 4],
    ['asian', ['סדרות אסיה', 'Asian dramas', 'Азиатские сериалы'], 'cn', 3],
  ];
  const IMG = (icon) => 'data/topics/img/topic_' + icon + '.png';
  const li = (names) => names[{he: 0, en: 1, ru: 2}[TN.lang()] || 1];
  const label = (e) => (e && (e[TN.lang()] || e.en)) || '';

  // ------------------------------------------------------------ pure logic (topics.py)
  function pyRx(src) {                         // Python "(?i)..." -> JS RegExp with the i flag; a bad one matches all
    if (!src) return null;
    const i = /\(\?i\)/.test(src);
    try { return new RegExp(src.replace(/\(\?i\)/g, ''), i ? 'iu' : 'u'); } catch (e) {
      try { return new RegExp(src.replace(/\(\?i\)/g, ''), i ? 'i' : ''); } catch (e2) { return null; }
    }
  }
  function select(videos, minSeconds, match) {
    const rx = typeof match === 'string' ? pyRx(match) : match || null;
    const seen = new Set();
    return videos.filter((v) => {
      if (v.short || seen.has(v.id) || (+v.secs || 0) < minSeconds) return false;
      if (rx && !rx.test(v.title || '')) return false;
      seen.add(v.id);
      return true;
    });
  }
  const ageDays = (v) => {
    if (v && v.published) return Math.max(0, Math.floor((Date.now() - v.published) / 864e5));
    const m = String((v && v.age) || '').match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
    return m ? +m[1] * {second: 0, minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365}[m[2]] : 1e6;
  };
  const newestFirst = (vs) => vs.map((v, i) => [ageDays(v), i, v]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
  const rankTop = (vs, minSeconds, limit = 40) => select(vs, minSeconds).map((v, i) => [v, i])
    .sort((a, b) => (+b[0].views || 0) - (+a[0].views || 0) || a[1] - b[1]).slice(0, limit).map((x) => x[0]);
  function searchLocal(videos, q) {
    const words = (String(q || '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []).filter((w) => w.length > 1);
    if (!words.length) return [];
    const scored = videos.map((v) => [words.filter((w) => (v.title || '').toLowerCase().includes(w)).length, v]);
    const full = scored.filter(([n]) => n === words.length).map((x) => x[1]);
    if (full.length) return full;
    const best = Math.max(0, ...scored.map(([n]) => n));
    return best ? scored.filter(([n]) => n === best).map((x) => x[1]) : [];
  }
  function allChannels(cfg, section) {
    if (section === 'dogs') return cfg.channels || [];
    const seen = new Set(), out = [];
    for (const cat of cfg.categories || []) for (const c of cat.channels || []) if (!seen.has(c.id)) { seen.add(c.id); out.push(c); }
    return out;
  }

  // ------------------------------------------------------------ data
  const cfgs = {};
  const load = (section) => (cfgs[section] = cfgs[section] || fetch('data/topics/' + section + '.json').then((r) => {
    if (!r.ok) throw new Error('topics ' + r.status);
    return r.json();
  }).catch((e) => { delete cfgs[section]; throw e; }));
  const loaded = new Map();                     // channel id -> videos (this visit), for the hub's quick search
  const pagesOf = (section) => (SECTIONS.find((s) => s[0] === section) || [0, 0, 0, 2])[3];
  async function yt() { const p = await TN.provider('yt'); if (!p) throw new Error('yt missing'); return p; }
  async function channelsVideos(channels, pages) {
    const Y = await yt();
    const out = [];
    let i = 0;
    const worker = async () => {             // 6 at a time: gentle on the API quota / the helper
      while (i < channels.length) {
        const c = channels[i++];
        try {
          const vs = (await Y.channelVideos(c.id, pages)).map((v) => Object.assign({}, v, {channel: v.channel || c.name, channel_id: c.id}));
          loaded.set(c.id, vs);
          out.push(...vs);
        } catch (e) { if (e && e.code === 'needs_key') throw e; }
      }
    };
    await Promise.all(Array.from({length: Math.min(6, channels.length)}, worker));
    return out;
  }
  async function categoryVideos(section, catId) {
    const cfg = await load(section);
    const cat = (cfg.categories || []).find((c) => c.id === catId);
    if (!cat) return [];
    if (section === 'dogs') return newestFirst(select(await channelsVideos(cfg.channels, pagesOf(section)), cfg.min_seconds, cat.match));
    const filter = new Map((cat.channels || []).map((c) => [c.id, !!c.filter]));
    let vids = await channelsVideos(cat.channels || [], pagesOf(section));
    if (cat.queries && cat.queries.length) {
      const Y = await yt();
      const lists = await Promise.all(cat.queries.map((q) => Y.videos(q, {pages: 1, english: true}).catch(() => [])));
      for (const l of lists) vids = vids.concat(l.filter((v) => filter.has(v.channel_id) || cat.search_any));
    }
    const rx = pyRx(cat.match);
    return newestFirst(select(vids, cfg.min_seconds).filter((v) => !(filter.get(v.channel_id) && rx && !rx.test(v.title || ''))));
  }
  async function topVideos(section) {
    const cfg = await load(section);
    return rankTop(await channelsVideos(allChannels(cfg, section), pagesOf(section)), cfg.min_seconds, (cfg.top || {}).limit || 40);
  }
  async function searchSection(section, q) {
    const cfg = await load(section);
    const chans = allChannels(cfg, section), ids = new Set(chans.map((c) => c.id));
    const Y = await yt();
    let found = (await Y.videos(q, {pages: 1}).catch(() => [])).filter((v) => ids.has(v.channel_id));
    found = found.concat(searchLocal(await channelsVideos(chans, pagesOf(section)), q));
    return select(found, cfg.min_seconds);
  }
  // hub: only the videos already loaded in this visit (no new requests)
  function searchLoaded(q) {
    const all = [].concat(...loaded.values());
    const seen = new Set();
    return searchLocal(all, q).filter((v) => !seen.has(v.id) && seen.add(v.id));
  }

  // ------------------------------------------------------------ pages
  async function drawVideos(ctx, title, job) {
    const Y = await yt();
    if (!Y.ready()) { TN.go(TN.link('youtube')); return; }
    const sk = TN.skeleton(8);
    let list;
    try { list = await job(); } catch (e) {
      if (!ctx.current()) return;
      sk.outerHTML = `<p class="msg">${TN.esc(TN.t('yt_fail'))}</p>`;
      return;
    }
    if (!ctx.current()) return;
    sk.remove();
    const g = TN.section(title, list.length);
    if (!list.length) return TN.empty(g, TN.t('topics_none'));
    list.forEach((v) => g.append(Y.card(v)));
  }
  function searchBox(section, q) {
    const f = document.createElement('form');
    f.className = 'hubform';
    f.innerHTML = `<input type="search" autocomplete="off" dir="auto" aria-label="${TN.esc(TN.t('topics_search'))}" placeholder="${TN.esc(TN.t('topics_search'))}">`;
    f.firstChild.value = q || '';
    f.append(TN.button('btn', TN.t('yt_go'), null));
    f.onsubmit = (e) => { e.preventDefault(); const v = f.firstChild.value.trim(); if (v) { TN.store.addSearch(v); TN.go(TN.link('topics', {s: section, q: v})); } };
    TN.view().append(f);
  }
  TN.registerPage('topics', async (arg, ctx) => {
    const p = TN.params(arg);
    const sec = SECTIONS.find((s) => s[0] === p.s);
    if (!sec) {
      TN.page('', TN.t('topics_title'));
      const g = TN.section('', null);
      g.previousElementSibling.remove();
      SECTIONS.forEach(([k, names, icon]) => g.append(TN.card(IMG(icon), li(names), null, () => TN.go(TN.link('topics', {s: k})), 'square')));
      const Y = await yt().catch(() => null);
      if (Y && !Y.ready() && ctx.current()) TN.view().insertAdjacentHTML('beforeend', `<p class="hint">${TN.esc(TN.t('yt_need'))} <a href="#/youtube">YouTube</a></p>`);
      return;
    }
    const cfg = await load(sec[0]);
    if (!ctx.current()) return;
    if (p.q) {
      TN.page('', li(sec[1]));
      searchBox(sec[0], p.q);
      return drawVideos(ctx, `“${p.q}”`, () => searchSection(sec[0], p.q));
    }
    if (p.top) { TN.page('', li(sec[1]) + ' – ' + label(cfg.top) ); return drawVideos(ctx, label(cfg.top), () => topVideos(sec[0])); }
    const cat = (cfg.categories || []).find((c) => c.id === p.c);
    if (cat) { TN.page('', label(cat)); return drawVideos(ctx, li(sec[1]), () => categoryVideos(sec[0], cat.id)); }
    TN.page('', li(sec[1]));
    searchBox(sec[0], '');
    const g = TN.section('', (cfg.categories || []).length);
    g.previousElementSibling.remove();
    if (cfg.top) g.append(TN.card(IMG('top'), label(cfg.top), null, () => TN.go(TN.link('topics', {s: sec[0], top: 1})), 'square'));
    (cfg.categories || []).forEach((c) => g.append(TN.card(IMG(c.icon), label(c), null, () => TN.go(TN.link('topics', {s: sec[0], c: c.id})), 'square')));
  });

  TN.registerProvider('topics', {kinds: [], label: TN.t('topics_title'), sections: SECTIONS, load, select, newestFirst, rankTop,
    searchLocal, pyRx, allChannels, categoryVideos, topVideos, searchSection, searchLoaded});
})(self.TN);
