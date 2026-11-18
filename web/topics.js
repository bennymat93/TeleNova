'use strict';
// TeleNova web, WP-8: topics / learning hubs (plan row 16) - the build's topics.py on the web.
// Data: web/data/topics/<section>.json (copies of plugin.video.nova/resources/topics/*.json, edit both together)
// Videos come through yt.js (API key or helper Worker). Only in-depth videos (min_seconds), never Shorts.
// With no key and no helper a section is still usable: its channels are listed and each one plays in the site
// (the embed player walks the channel's uploads list, newest first) - never an empty page, never a redirect.
// Pages: #/topics  |  #/topics/q=<words> (every section)  |  #/topics/s=<section>  |  &c=<cat>  |  &top=1  |  &q=<words>
//        #/topics/s=news&latest=1 (the newest reports of the news channels)
// Provider 'topics' (no kind; TN.provider('topics')): {sections, searchLoaded(q), searchAll(q), select, ...}
(function (TN) {
  if (!TN) return;
  TN.i18n.add({
    he: {topics_title: 'אקטואליה וידע', topics_search: 'חיפוש בנושא', topics_top: 'המדורגים ביותר', topics_none: 'אין סרטונים כאן כרגע.',
      topics_loading: 'טוען %s ערוצים...', topics_all: 'חיפוש בכל הנושאים', topics_latest: 'חדשות אחרונות', topics_channels: 'ערוצים',
      topics_keyless: 'בלי מפתח YouTube או עוזר אי אפשר למיין סרטונים, אבל כל ערוץ מתנגן כאן מהחדש לישן. מפתח חינמי במסך "שירותים" מוסיף רשימות, חיפוש ו"המדורגים ביותר".',
      topics_setup: 'הגדרת מפתח או עוזר', topics_fail: 'הרשימה לא נטענה. בדקו את החיבור, המפתח או העוזר.', topics_retry: 'נסו שוב', topics_go: 'חיפוש',
      topics_ch_sub: 'כל הסרטונים, מהחדש לישן'},
    en: {topics_title: 'News & knowledge', topics_search: 'Search this topic', topics_top: 'Top rated', topics_none: 'No videos here right now.',
      topics_loading: 'Loading %s channels...', topics_all: 'Search every topic', topics_latest: 'Latest news', topics_channels: 'Channels',
      topics_keyless: 'Without a YouTube key or the helper the videos cannot be sorted, but every channel plays here, newest first. A free key on the Services screen adds lists, search and "Top rated".',
      topics_setup: 'Set up a key or the helper', topics_fail: 'The list did not load. Check the connection, the key or the helper.', topics_retry: 'Try again', topics_go: 'Search',
      topics_ch_sub: 'All videos, newest first'},
    ru: {topics_title: 'Новости и знания', topics_search: 'Поиск по теме', topics_top: 'Самые популярные', topics_none: 'Здесь пока нет видео.',
      topics_loading: 'Загрузка каналов: %s...', topics_all: 'Поиск по всем темам', topics_latest: 'Последние новости', topics_channels: 'Каналы',
      topics_keyless: 'Без ключа YouTube или помощника видео нельзя отсортировать, но каждый канал воспроизводится здесь, от новых к старым. Бесплатный ключ на экране «Сервисы» добавляет списки, поиск и «Самые популярные».',
      topics_setup: 'Настроить ключ или помощник', topics_fail: 'Список не загрузился. Проверьте соединение, ключ или помощник.', topics_retry: 'Повторить', topics_go: 'Найти',
      topics_ch_sub: 'Все видео, от новых к старым'},
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
  const li = (names) => names[{he: 0, en: 1, ru: 2}[TN.lang()] || (TN.lang() === 'he' ? 0 : 1)];
  const label = (e) => (e && (e[TN.lang()] || e.en || e.he)) || '';

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
  // the uploads playlist of a channel (UC... -> UU...): the embed player walks it newest first with no key at all
  const CHAN = /^UC[A-Za-z0-9_-]{22}$/;
  const uploadsOf = (id) => (CHAN.test(String(id || '')) ? 'UU' + String(id).slice(2) : '');

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
    let i = 0, ok = 0, lastErr = null;
    const worker = async () => {             // 6 at a time: gentle on the API quota / the helper
      while (i < channels.length) {
        const c = channels[i++];
        try {
          const vs = (await Y.channelVideos(c.id, pages)).map((v) => Object.assign({}, v, {channel: v.channel || c.name, channel_id: c.id}));
          loaded.set(c.id, vs);
          out.push(...vs);
          ok++;
        } catch (e) { lastErr = e; if (e && e.code === 'needs_key') throw e; }
      }
    };
    await Promise.all(Array.from({length: Math.min(6, channels.length)}, worker));
    if (!ok && lastErr && channels.length) throw lastErr;      // every channel failed: an error, not "no videos"
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
  // every section's channels: id -> {id, name, min}
  async function everyChannel() {
    const out = new Map();
    const all = await Promise.all(SECTIONS.map((x) => load(x[0]).catch(() => null)));
    all.forEach((cfg, i) => {
      if (!cfg) return;
      for (const c of allChannels(cfg, SECTIONS[i][0])) if (!out.has(c.id)) out.set(c.id, Object.assign({min: cfg.min_seconds || 0}, c));
    });
    return out;
  }
  // all sections at once (topics.py hub_search): YouTube's own search kept to the curated channels, plus what this visit loaded
  async function searchAll(q, opts) {
    const Y = await yt();
    const chans = await everyChannel();
    let found = [];
    if (Y.ready()) {
      // (one page, the same request the YouTube search section makes: answered from its cache)
      found = (await Y.videos(q, {pages: 1, signal: opts && opts.signal}).catch(() => []))
        .filter((v) => chans.has(v.channel_id) && (+v.secs || 0) >= (chans.get(v.channel_id).min || 0));
    }
    const seen = new Set();
    return found.concat(searchLoaded(q)).filter((v) => !v.short && !seen.has(v.id) && seen.add(v.id));
  }
  // the newest reports of the news channels (topics.py latest_news)
  async function latestNews(limit) {
    const cfg = await load('news');
    return newestFirst(select(await channelsVideos(allChannels(cfg, 'news'), 1), cfg.min_seconds)).slice(0, limit || 60);
  }

  // ------------------------------------------------------------ pages
  function note(kind, text, action) {            // TN.state of the new shell when it is there, else the message line
    const box = document.createElement('div');
    TN.view().append(box);
    if (typeof TN.state === 'function') { try { TN.state(box, {kind, title: text, text: '', action}); return box; } catch (e) { box.textContent = ''; } }
    box.innerHTML = `<p class="msg">${TN.esc(text)}</p>`;
    if (action) box.append(TN.button('btn', action.label, action.onClick));
    return box;
  }
  const setupHint = () => TN.view().insertAdjacentHTML('beforeend',
    `<p class="hint">${TN.esc(TN.t('topics_keyless'))} <a href="#/services">${TN.esc(TN.t('topics_setup'))}</a></p>`);
  // no key and no helper: the channels themselves, each one playing in the site
  function drawChannels(Y, channels) {
    setupHint();
    const list = (channels || []).filter((c) => c && uploadsOf(c.id));
    const g = TN.section(TN.t('topics_channels'), list.length);
    if (!list.length) return TN.empty(g, TN.t('topics_none'));
    list.forEach((c) => g.append(TN.card('icon.png', c.name || c.id, TN.t('topics_ch_sub'), () => Y.playList(uploadsOf(c.id), c.name || ''), 'wide')));
  }
  async function drawVideos(ctx, title, job, channels) {
    const Y = await yt();
    if (!ctx.current()) return;
    if (!Y.ready()) {
      const list = typeof channels === 'function' ? await channels() : channels;
      if (ctx.current()) drawChannels(Y, list);
      return;
    }
    const sk = TN.skeleton(8);
    let list;
    try { list = await job(); } catch (e) {
      if (!ctx.current()) return;
      sk.remove();
      note(navigator.onLine === false ? 'offline' : 'error', TN.t('topics_fail'), {label: TN.t('topics_retry'), onClick: () => { if (Y.clearCache) Y.clearCache(); TN.route(); }});
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
    f.setAttribute('role', 'search');
    const ph = TN.t(section ? 'topics_search' : 'topics_all');
    f.innerHTML = `<input type="search" class="input" autocomplete="off" dir="auto" enterkeyhint="search" aria-label="${TN.esc(ph)}" placeholder="${TN.esc(ph)}">`;
    f.firstChild.value = q || '';
    f.append(TN.button('btn', TN.t('topics_go'), null));
    f.onsubmit = (e) => {
      e.preventDefault();
      const v = f.firstChild.value.trim();
      if (!v) return;
      TN.store.addSearch(v);
      TN.go(TN.link('topics', section ? {s: section, q: v} : {q: v}));
    };
    TN.view().append(f);
  }
  const backTo = (href) => { const b = TN.view().querySelector('.backbtn'); if (b) b.href = href; };
  TN.registerPage('topics', async (arg, ctx) => {
    const p = TN.params(arg);
    const sec = SECTIONS.find((s) => s[0] === p.s);
    if (!sec) {
      TN.page('', TN.t('topics_title'));
      searchBox('', p.q || '');
      if (p.q) {                                // every section at once
        backTo('#/topics');
        return drawVideos(ctx, `“${p.q}”`, () => searchAll(p.q), async () => [...(await everyChannel()).values()]);
      }
      const g = TN.section('', null);
      g.previousElementSibling.remove();
      g.append(TN.card(IMG('news_il'), TN.t('topics_latest'), null, () => TN.go(TN.link('topics', {s: 'news', latest: 1})), 'square'));
      SECTIONS.forEach(([k, names, icon]) => g.append(TN.card(IMG(icon), li(names), null, () => TN.go(TN.link('topics', {s: k})), 'square')));
      const Y = await yt().catch(() => null);
      if (Y && !Y.ready() && ctx.current()) setupHint();
      return;
    }
    const cfg = await load(sec[0]);
    if (!ctx.current()) return;
    const all = () => allChannels(cfg, sec[0]);
    const home = TN.link('topics', {s: sec[0]});
    if (p.q) {
      TN.page('', li(sec[1]));
      backTo(home);
      searchBox(sec[0], p.q);
      return drawVideos(ctx, `“${p.q}”`, () => searchSection(sec[0], p.q), all);
    }
    if (p.latest && sec[0] === 'news') {
      TN.page('', TN.t('topics_latest'));
      backTo('#/topics');
      return drawVideos(ctx, TN.t('topics_latest'), () => latestNews(60), all);
    }
    if (p.top && cfg.top) {
      TN.page('', li(sec[1]) + ' – ' + label(cfg.top));
      backTo(home);
      return drawVideos(ctx, label(cfg.top), () => topVideos(sec[0]), all);
    }
    const cat = (cfg.categories || []).find((c) => c.id === p.c);
    if (cat) {
      TN.page('', label(cat));
      backTo(home);
      return drawVideos(ctx, li(sec[1]), () => categoryVideos(sec[0], cat.id), sec[0] === 'dogs' ? all : cat.channels || []);
    }
    TN.page('', li(sec[1]));
    backTo('#/topics');
    searchBox(sec[0], '');
    const g = TN.section('', (cfg.categories || []).length);
    g.previousElementSibling.remove();
    if (cfg.top) g.append(TN.card(IMG('top'), label(cfg.top), null, () => TN.go(TN.link('topics', {s: sec[0], top: 1})), 'square'));
    (cfg.categories || []).forEach((c) => g.append(TN.card(IMG(c.icon), label(c), null, () => TN.go(TN.link('topics', {s: sec[0], c: c.id})), 'square')));
  });

  TN.registerProvider('topics', {kinds: [], label: TN.t('topics_title'), sections: SECTIONS, load, select, newestFirst, rankTop,
    searchLocal, pyRx, allChannels, categoryVideos, topVideos, searchSection, searchLoaded, searchAll, latestNews, everyChannel, uploadsOf});
  self.TNTopics = {select, newestFirst, rankTop, searchLocal, pyRx, allChannels, uploadsOf, SECTIONS};     // for the tests
})(self.TN);
