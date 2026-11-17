'use strict';
// TeleNova web, WP-8: YouTube (plan row 13).
// Lists come from one of two paths (the browser cannot call youtube.com's innertube itself - no CORS):
//   A. the viewer's own YouTube Data API v3 key (setting yt_key; sent in the X-Goog-Api-Key header, never in a URL)
//   B. the optional helper Worker (TN.settings.helper()) relaying youtubei/v1, the same endpoint the Kodi build uses
// Playback is always the youtube-nocookie iframe embed.
// Service: TN.provider('yt') -> {search(q), videos(q, {pages}), channelVideos(id, pages), play(v), ready(), parse...}
(function (TN) {
  if (!TN) return;
  TN.i18n.add({
    he: {yt_title: 'YouTube', yt_search: 'חיפוש ביוטיוב', yt_go: 'חיפוש', yt_key: 'מפתח YouTube Data API (לא חובה)',
      yt_key_hint: 'יוטיוב לא מאפשר לדפדפן לחפש בלי מפתח. אפשר להזין מפתח YouTube Data API v3 משלך (נשמר רק בדפדפן הזה), או להגדיר כתובת עוזר (Worker) בהגדרות.',
      yt_need: 'כדי לחפש ביוטיוב צריך מפתח API או עוזר (Worker). הניגון עצמו עובד תמיד.', yt_saved: 'נשמר',
      yt_fail: 'יוטיוב לא ענה. בדקו את המפתח או את העוזר.', yt_channel: 'ערוץ', yt_open: 'פתיחה ביוטיוב', yt_views: '%s צפיות'},
    en: {yt_title: 'YouTube', yt_search: 'Search YouTube', yt_go: 'Search', yt_key: 'YouTube Data API key (optional)',
      yt_key_hint: 'YouTube does not let a browser search without a key. Enter your own YouTube Data API v3 key (kept only in this browser), or set a helper (Worker) URL in Settings.',
      yt_need: 'Searching YouTube needs an API key or the helper (Worker). Playing always works.', yt_saved: 'Saved',
      yt_fail: 'YouTube did not answer. Check the key or the helper.', yt_channel: 'Channel', yt_open: 'Open on YouTube', yt_views: '%s views'},
    ru: {yt_title: 'YouTube', yt_search: 'Поиск в YouTube', yt_go: 'Найти', yt_key: 'Ключ YouTube Data API (необязательно)',
      yt_key_hint: 'YouTube не даёт браузеру искать без ключа. Введите свой ключ YouTube Data API v3 (хранится только в этом браузере) или укажите адрес помощника (Worker) в настройках.',
      yt_need: 'Для поиска в YouTube нужен ключ API или помощник (Worker). Воспроизведение работает всегда.', yt_saved: 'Сохранено',
      yt_fail: 'YouTube не ответил. Проверьте ключ или помощник.', yt_channel: 'Канал', yt_open: 'Открыть в YouTube', yt_views: '%s просмотров'},
  });

  const API = 'https://www.googleapis.com/youtube/v3/';
  const VIDEOS_TAB = 'EgZ2aWRlb3PyBgQKAjoA';
  const ID = /^[A-Za-z0-9_-]{11}$/;
  const CHAN = /^UC[A-Za-z0-9_-]{22}$/;
  const PLAY = 'plugin://plugin.video.youtube/play/?video_id=';
  const mem = new Map();                       // in-memory answers of this visit
  const TTL = 3 * 3600 * 1000;

  // ------------------------------------------------------------ pure helpers (unit-tested with node)
  function seconds(d) {                        // "1:02:03" -> 3723 ; ISO "PT1H2M3S" -> 3723
    d = String(d || '');
    const iso = d.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if (iso && d.length > 1) return (+iso[1] || 0) * 86400 + (+iso[2] || 0) * 3600 + (+iso[3] || 0) * 60 + (+iso[4] || 0);
    let s = 0;
    for (const p of d.split(':')) { if (!/^\d+$/.test(p)) return 0; s = s * 60 + +p; }
    return s;
  }
  function clock(secs) {
    secs = +secs || 0;
    if (!secs) return '';
    const h = Math.floor(secs / 3600), m = Math.floor(secs / 60) % 60, s = secs % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  function views(text) {
    const m = String(text || '').replace(/,/g, '').match(/([\d.]+)\s*([KMB]?)/);
    return m ? Math.round(parseFloat(m[1]) * ({'': 1, K: 1e3, M: 1e6, B: 1e9}[m[2]])) : 0;
  }
  function ageDays(v) {                        // "3 weeks ago" -> 21 ; or from published ms ; unknown -> 1e6
    if (v && v.published) return Math.max(0, Math.floor((Date.now() - v.published) / 864e5));
    const m = String((v && v.age) || '').match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
    if (!m) return 1e6;
    return +m[1] * {second: 0, minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365}[m[2]];
  }
  function text(t) {
    if (!t) return '';
    if (typeof t === 'string') return t;
    if ('simpleText' in t) return t.simpleText;
    if ('content' in t) return t.content;
    return (t.runs || []).map((r) => r.text || '').join('');
  }
  function* walk(o, key) {
    if (Array.isArray(o)) { for (const i of o) yield* walk(i, key); } else if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) { if (k === key) yield v; else yield* walk(v, key); }
    }
  }
  const first = (it, d) => { for (const x of it) return x; return d; };
  // a youtubei answer -> videos {id, title, img, channel, channel_id, secs, views, age, short}; Shorts dropped (yt.py _items)
  function parseInnertube(data) {
    const out = [], seen = new Set();
    const add = (v) => { if (v.id && ID.test(v.id) && !seen.has(v.id) && v.title) { seen.add(v.id); out.push(v); } };
    for (const v of walk(data, 'videoRenderer')) {
      const th = ((v.thumbnail || {}).thumbnails || [{}]);
      const url = first(walk(v.navigationEndpoint || {}, 'url'), '');
      add({id: v.videoId, title: text(v.title), img: (th[th.length - 1] || {}).url || '', channel: text(v.ownerText),
        channel_id: first(walk(v.ownerText || {}, 'browseId'), ''), secs: seconds(text(v.lengthText)),
        views: views(text(v.viewCountText)), age: text(v.publishedTimeText), short: String(url).includes('/shorts/')});
    }
    for (const v of walk(data, 'lockupViewModel')) {
      if (v.contentType && v.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') continue;
      const meta = (v.metadata || {}).lockupMetadataViewModel || {};
      const src = first(walk(v.contentImage || {}, 'sources'), [{}]) || [{}];
      const blob = JSON.stringify(v);
      const dur = (blob.match(/"text":\s*"(\d{1,2}:\d{2}(?::\d{2})?)"/) || [])[1] || '';
      const vw = (blob.match(/"content":\s*"([\d.,]+[KMB]?) (?:views|צפיות)"/) || [])[1] || '';
      const ago = (blob.match(/"content":\s*"(\d+ \w+ ago|לפני [^"]+)"/) || [])[1] || '';
      add({id: v.contentId, title: text(meta.title), img: (src[src.length - 1] || {}).url || '', channel: '', channel_id: '',
        secs: seconds(dur), views: views(vw), age: ago, short: blob.includes('/shorts/')});
    }
    for (const v of walk(data, 'playlistVideoRenderer')) {
      const th = ((v.thumbnail || {}).thumbnails || [{}]);
      add({id: v.videoId, title: text(v.title), img: (th[th.length - 1] || {}).url || '', channel: text(v.shortBylineText),
        channel_id: first(walk(v.shortBylineText || {}, 'browseId'), ''), secs: +v.lengthSeconds || 0, views: 0, age: '', short: false});
    }
    return out.filter((v) => !v.short);
  }
  const continuation = (data) => { for (const c of walk(data, 'continuationCommand')) if (c && c.token) return c.token; return ''; };
  // Data API v3 items (search / playlistItems) + videos.list details -> the same video shape
  function parseApi(items, details) {
    const det = new Map((details || []).map((d) => [d.id, d]));
    const out = [];
    for (const it of items || []) {
      const sn = it.snippet || {};
      const id = (it.id && it.id.videoId) || (sn.resourceId && sn.resourceId.videoId) || (typeof it.id === 'string' ? it.id : '');
      if (!ID.test(id || '')) continue;
      const d = det.get(id) || {};
      const th = sn.thumbnails || {};
      const secs = seconds((d.contentDetails || {}).duration);
      out.push({id, title: decode(sn.title || ''), img: (th.high || th.medium || th.default || {}).url || '',
        channel: sn.videoOwnerChannelTitle || sn.channelTitle || '', channel_id: sn.videoOwnerChannelId || sn.channelId || '',
        secs, views: +((d.statistics || {}).viewCount) || 0, age: '', published: Date.parse(sn.publishedAt) || 0,
        short: !!secs && secs <= 60});
    }
    return out.filter((v) => !v.short);
  }
  function decode(s) { return String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'"}[k])); }
  const uploads = (channelId) => 'UU' + channelId.slice(2);

  // ------------------------------------------------------------ transport
  const key = () => String(TN.settings.get('yt_key', '') || '').trim();
  const ready = () => !!(key() || TN.settings.helper());
  const mode = () => (key() ? 'api' : TN.settings.helper() ? 'helper' : '');
  async function api(path, params, signal) {
    const r = await fetch(API + path + '?' + new URLSearchParams(params), {headers: {'X-Goog-Api-Key': key()}, signal});
    if (!r.ok) throw new Error('yt api ' + r.status);
    return r.json();
  }
  async function inner(endpoint, body, signal) {
    await TN.loadScript('helper.js');
    const hl = {he: 'iw', ru: 'ru'}[TN.lang()] || 'en';
    body = Object.assign({}, body, {context: {client: {clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: body.hl || hl, gl: 'IL'}}});
    delete body.hl;
    const r = await self.TNHelper.fetch('https://www.youtube.com/youtubei/v1/' + endpoint + '?prettyPrint=false',
      {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), via: 'helper', signal, timeout: 15000});
    if (!r.ok) throw new Error('yt inner ' + r.status);
    return r.json();
  }
  function cached(k, fn) {
    const hit = mem.get(k);
    if (hit && Date.now() - hit.t < TTL) return hit.p;
    const p = fn();
    mem.set(k, {t: Date.now(), p});
    p.catch(() => mem.delete(k));
    return p;
  }
  async function details(ids, signal) {
    if (!ids.length) return [];
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const d = await api('videos', {part: 'contentDetails,statistics', id: ids.slice(i, i + 50).join(',')}, signal);
      out.push(...(d.items || []));
    }
    return out;
  }

  // search: videos only. pages: ~20-50 each
  function videos(q, {pages = 1, signal, english} = {}) {
    q = String(q || '').trim();
    if (!q) return Promise.resolve([]);
    const m = mode();
    if (!m) return Promise.reject(Object.assign(new Error('needs key'), {code: 'needs_key'}));
    return cached(['s', m, q.toLowerCase(), pages, english ? 1 : 0].join('|'), async () => {
      let out = [];
      if (m === 'api') {
        let token = '';
        for (let i = 0; i < Math.min(pages, 2); i++) {        // search.list costs 100 quota units a page
          const d = await api('search', Object.assign({part: 'snippet', type: 'video', maxResults: 50, q, safeSearch: 'moderate'},
            token ? {pageToken: token} : {}), signal);
          out.push(...parseApi(d.items, await details((d.items || []).map((x) => x.id && x.id.videoId).filter(Boolean), signal)));
          token = d.nextPageToken || '';
          if (!token) break;
        }
      } else {
        let token = '';
        for (let i = 0; i < pages; i++) {
          const d = await inner('search', token ? {continuation: token} : {query: q, params: 'EgIQAQ==', hl: english ? 'en' : ''}, signal);
          out.push(...parseInnertube(d));
          token = continuation(d);
          if (!token) break;
        }
      }
      const seen = new Set();
      return out.filter((v) => !seen.has(v.id) && seen.add(v.id));
    });
  }
  // the newest videos of a channel (~30-50 per page)
  function channelVideos(id, pages = 2) {
    if (!CHAN.test(id || '')) return Promise.resolve([]);
    const m = mode();
    if (!m) return Promise.reject(Object.assign(new Error('needs key'), {code: 'needs_key'}));
    return cached(['c', m, id, pages].join('|'), async () => {
      const out = [];
      let token = '';
      for (let i = 0; i < pages; i++) {
        if (m === 'api') {
          const d = await api('playlistItems', Object.assign({part: 'snippet', playlistId: uploads(id), maxResults: 50}, token ? {pageToken: token} : {}));
          out.push(...parseApi(d.items, await details((d.items || []).map((x) => x.snippet && x.snippet.resourceId && x.snippet.resourceId.videoId).filter(Boolean))));
          token = d.nextPageToken || '';
        } else {
          const d = await inner('browse', token ? {continuation: token, hl: 'en'} : {browseId: id, params: VIDEOS_TAB, hl: 'en'});
          out.push(...parseInnertube(d));
          token = continuation(d);
        }
        if (!token) break;
      }
      return out.map((v) => Object.assign(v, {channel_id: v.channel_id || id}));
    });
  }

  // ------------------------------------------------------------ playing
  function embed(id) { return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&rel=0'; }
  function play(v) {
    if (!v || !ID.test(v.id || '')) return;
    TN.noteHistory({key: 'yt:' + v.id, label: v.title || 'YouTube', play: PLAY + v.id, thumb: v.img || ''});
    const sub = [v.channel, clock(v.secs), v.views ? TN.t('yt_views', v.views.toLocaleString()) : ''].filter(Boolean).join(' · ');
    TN.modal(`<div class="player"><iframe src="${TN.esc(embed(v.id))}" ` +
      `allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="${TN.esc(v.title || 'YouTube')}"></iframe></div>` +
      `<h2 dir="auto">${TN.esc(v.title || '')}</h2><p class="hint" dir="auto">${TN.esc(sub)}</p><div class="links" id="yt_acts">` +
      `<a class="btn ghost" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}">${TN.esc(TN.t('yt_open'))}</a>` +
      (CHAN.test(v.channel_id || '') ? `<a class="btn ghost" href="${TN.esc(TN.link('youtube', {ch: v.channel_id, n: v.channel || ''}))}">${TN.esc(TN.t('yt_channel'))}</a>` : '') +
      '</div>');
    const acts = document.getElementById('yt_acts');
    if (acts) acts.append(TN.favButton({kind: 'web_yt', id: v.id, label: v.title || 'YouTube', extra: PLAY + v.id, img: v.img}));
    acts && acts.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', () => TN.closeModal()));
  }
  const card = (v) => TN.card(v.img || 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg', v.title,
    [v.channel, clock(v.secs)].filter(Boolean).join(' · '), () => play(v), 'wide');
  // a history row of a YouTube video (also the ones Kodi wrote: plugin.video.youtube/play/?video_id=)
  TN.addHistoryHandler((e) => {
    const m = String((e && e.play) || '').match(/video_id=([A-Za-z0-9_-]{11})/) || String((e && e.key) || '').match(/^yt:([A-Za-z0-9_-]{11})$/);
    if (!m) return false;
    play({id: m[1], title: e.label, img: e.thumb});
    return true;
  });

  // ------------------------------------------------------------ provider (hub search + sources)
  const impl = {
    kinds: ['search', 'source'], label: 'YouTube',
    ready, mode, videos, channelVideos, play, card, embed, clock, seconds, ageDays, parseInnertube, parseApi,
    async search(q, {signal, limit = 30} = {}) {
      if (!ready()) return [];
      const list = await videos(q, {signal});
      return list.slice(0, limit).map((v) => ({title: v.title, sub: [v.channel, clock(v.secs)].filter(Boolean).join(' · '),
        img: v.img, kind: 'wide', open: () => play(v), id: v.id}));
    },
    async sources({title, year, season, episode}, {signal} = {}) {
      if (!ready() || !title) return [];
      const q = [title, season != null && episode != null ? 'S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0') : year, 'full'].filter(Boolean).join(' ');
      const list = (await videos(q, {signal})).filter((v) => v.secs >= 40 * 60).slice(0, 8);
      return list.map((v) => ({label: v.title, quality: '', lang: '', size: clock(v.secs), url: 'https://www.youtube.com/watch?v=' + v.id, open: () => play(v)}));
    },
  };
  TN.registerProvider('yt', impl);

  // ------------------------------------------------------------ page #/youtube/q=...  |  #/youtube/ch=UC...&n=name
  TN.registerPage('youtube', async (arg, ctx) => {
    const p = TN.params(arg);
    const view = TN.view();
    TN.page('', p.n || TN.t('yt_title'));
    const f = document.createElement('form');
    f.className = 'hubform';
    f.innerHTML = `<input type="search" autocomplete="off" dir="auto" aria-label="${TN.esc(TN.t('yt_search'))}" placeholder="${TN.esc(TN.t('yt_search'))}">`;
    f.firstChild.value = p.q || '';
    f.append(TN.button('btn', TN.t('yt_go'), null));
    f.onsubmit = (e) => { e.preventDefault(); const q = f.firstChild.value.trim(); if (q) { TN.store.addSearch(q); TN.go(TN.link('youtube', {q})); } };
    view.append(f);
    if (!ready()) {
      view.insertAdjacentHTML('beforeend', `<p class="msg">${TN.esc(TN.t('yt_need'))}</p>`);
    }
    // the key box (password field: never shown, never put in a URL)
    const box = document.createElement('details');
    box.className = 'panel settings';
    box.open = !ready();
    box.innerHTML = `<summary>${TN.esc(TN.t('yt_key'))}</summary><label>${TN.esc(TN.t('yt_key'))}<input type="password" autocomplete="off" dir="ltr"></label>` +
      `<p class="hint">${TN.esc(TN.t('yt_key_hint'))}</p><span class="hint" role="status"></span>`;
    const inp = box.querySelector('input');
    inp.value = key();
    inp.onchange = () => { TN.settings.set('yt_key', inp.value.trim()); mem.clear(); box.querySelector('[role=status]').textContent = TN.t('yt_saved'); };
    view.append(box);
    if (!ready() || (!p.q && !p.ch)) return;
    const sk = TN.skeleton(8);
    let list;
    try {
      list = p.ch ? await channelVideos(p.ch, 2) : await videos(p.q, {pages: 2});
    } catch (e) {
      if (!ctx.current()) return;
      sk.outerHTML = `<p class="msg">${TN.esc(TN.t('yt_fail'))}</p>`;
      return;
    }
    if (!ctx.current()) return;
    sk.remove();
    const g = TN.section(p.ch ? (p.n || TN.t('yt_channel')) : `“${p.q}”`, list.length);
    if (!list.length) return TN.empty(g);
    list.forEach((v) => g.append(card(v)));
  });
})(self.TN);
