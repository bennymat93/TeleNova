'use strict';
// TeleNova web, WP-8: YouTube (plan row 13).
// Lists come from one of two paths (the browser cannot call youtube.com's innertube itself - no CORS):
//   A. the viewer's own YouTube Data API v3 key (setting yt_key; sent in the X-Goog-Api-Key header, never in a URL)
//   B. the optional helper Worker (TN.settings.helper()) relaying youtubei/v1, the same endpoint the Kodi build uses
// Playback is always the youtube-nocookie iframe embed, so a video, a playlist or a pasted link plays with NO key at all;
// only the lists (search, channel, live now) need path A or B. Without either the page still works: paste a link, my
// favourites, what was watched, and one clear line that says where the key / helper is set (Services).
// Page: #/youtube  |  q=<words>[&live=1]  |  ch=UC...&n=name  |  pl=PL...&n=name  |  v=<id>  |  url=<any YouTube link>  (link= too)
// Favourites: kind web_yt (a video, extra = the Kodi play address) and web_ytc (a channel, id = UC...); favs() / favView(f)
// give app.js the {kind, id, label, img, open} shape.
// Service: TN.provider('yt') -> {search(q), videos(q, {pages, live}), channelVideos(id, pages), playlistVideos(id), play(v),
//   parseLink(text), openLink(text), favs(), favView(f), ready(), parse...}
(function (TN) {
  if (!TN) return;
  TN.i18n.add({
    he: {yt_title: 'YouTube', yt_search: 'חיפוש ביוטיוב', yt_go: 'חיפוש', yt_key: 'מפתח YouTube Data API (לא חובה)',
      yt_key_hint: 'יוטיוב לא מאפשר לדפדפן לחפש בלי מפתח. אפשר להזין מפתח YouTube Data API v3 משלך (נשמר רק בדפדפן הזה), או להגדיר כתובת עוזר (Worker) בהגדרות.',
      yt_need: 'כדי לחפש ביוטיוב צריך מפתח API או עוזר (Worker). הניגון עצמו עובד תמיד.', yt_saved: 'נשמר',
      yt_fail: 'יוטיוב לא ענה. בדקו את המפתח או את העוזר.', yt_channel: 'ערוץ', yt_open: 'פתיחה ביוטיוב', yt_views: '%s צפיות',
      yt_live: 'שידורים חיים', yt_all: 'סרטונים', yt_favs: 'המועדפים שלי', yt_fav_ch: 'ערוצים מועדפים', yt_recent: 'נצפו לאחרונה', yt_playlist: 'פלייליסט',
      yt_link: 'הדבקת קישור של YouTube', yt_link_go: 'פתיחה', yt_link_bad: 'זה לא נראה כמו קישור של YouTube', yt_setup: 'להגדרת מפתח או עוזר',
      yt_setup_txt: 'ניגון, קישורים, מועדפים ופלייליסטים עובדים בלי מפתח. לחיפוש, לרשימות ערוצים ולשידורים חיים צריך מפתח YouTube Data API חינמי או כתובת עוזר (Worker) - שניהם במסך "שירותים".',
      yt_retry: 'נסו שוב', yt_none: 'לא נמצאו סרטונים', yt_fav_add_ch: 'הוספת הערוץ למועדפים', yt_ch_need: 'כדי לפתוח ערוץ לפי שם (@) צריך מפתח או עוזר. הערוץ נפתח ב-YouTube.',
      yt_key_how: 'איך מקבלים מפתח', yt_min: "%s דק'"},
    en: {yt_title: 'YouTube', yt_search: 'Search YouTube', yt_go: 'Search', yt_key: 'YouTube Data API key (optional)',
      yt_key_hint: 'YouTube does not let a browser search without a key. Enter your own YouTube Data API v3 key (kept only in this browser), or set a helper (Worker) URL in Settings.',
      yt_need: 'Searching YouTube needs an API key or the helper (Worker). Playing always works.', yt_saved: 'Saved',
      yt_fail: 'YouTube did not answer. Check the key or the helper.', yt_channel: 'Channel', yt_open: 'Open on YouTube', yt_views: '%s views',
      yt_live: 'Live now', yt_all: 'Videos', yt_favs: 'My favourites', yt_fav_ch: 'Favourite channels', yt_recent: 'Watched lately', yt_playlist: 'Playlist',
      yt_link: 'Paste a YouTube link', yt_link_go: 'Open', yt_link_bad: 'This does not look like a YouTube link', yt_setup: 'Set up a key or the helper',
      yt_setup_txt: 'Playing, links, favourites and playlists work without a key. Search, channel lists and live broadcasts need a free YouTube Data API key or a helper (Worker) address - both are on the Services screen.',
      yt_retry: 'Try again', yt_none: 'No videos found', yt_fav_add_ch: 'Add the channel to favourites', yt_ch_need: 'Opening a channel by its @name needs a key or the helper. The channel opens on YouTube.',
      yt_key_how: 'How to get a key', yt_min: '%s min'},
    ru: {yt_title: 'YouTube', yt_search: 'Поиск в YouTube', yt_go: 'Найти', yt_key: 'Ключ YouTube Data API (необязательно)',
      yt_key_hint: 'YouTube не даёт браузеру искать без ключа. Введите свой ключ YouTube Data API v3 (хранится только в этом браузере) или укажите адрес помощника (Worker) в настройках.',
      yt_need: 'Для поиска в YouTube нужен ключ API или помощник (Worker). Воспроизведение работает всегда.', yt_saved: 'Сохранено',
      yt_fail: 'YouTube не ответил. Проверьте ключ или помощник.', yt_channel: 'Канал', yt_open: 'Открыть в YouTube', yt_views: '%s просмотров',
      yt_live: 'Прямые эфиры', yt_all: 'Видео', yt_favs: 'Моё избранное', yt_fav_ch: 'Избранные каналы', yt_recent: 'Недавно просмотренные', yt_playlist: 'Плейлист',
      yt_link: 'Вставьте ссылку YouTube', yt_link_go: 'Открыть', yt_link_bad: 'Это не похоже на ссылку YouTube', yt_setup: 'Настроить ключ или помощник',
      yt_setup_txt: 'Воспроизведение, ссылки, избранное и плейлисты работают без ключа. Для поиска, списков каналов и прямых эфиров нужен бесплатный ключ YouTube Data API или адрес помощника (Worker) - оба на экране «Сервисы».',
      yt_retry: 'Повторить', yt_none: 'Видео не найдены', yt_fav_add_ch: 'Добавить канал в избранное', yt_ch_need: 'Чтобы открыть канал по имени (@), нужен ключ или помощник. Канал откроется в YouTube.',
      yt_key_how: 'Как получить ключ', yt_min: '%s мин'},
  });

  const API = 'https://www.googleapis.com/youtube/v3/';
  const VIDEOS_TAB = 'EgZ2aWRlb3PyBgQKAjoA';
  const ID = /^[A-Za-z0-9_-]{11}$/;
  const CHAN = /^UC[A-Za-z0-9_-]{22}$/;
  const LIST = /^(?:PL|UU|FL|OLAK5uy_|RD|LL)[A-Za-z0-9_-]{10,60}$/;
  const HANDLE = /^@[A-Za-z0-9._-]{3,40}$/;
  const LIVE_FILTER = 'EgJAAQ==';               // youtubei search filter: live now
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
  // any YouTube address (or a bare id) -> {v, list, ch, handle, q}; null when it is not one. Only youtube hosts count.
  function parseLink(text) {
    let s = String(text || '').trim();
    if (!s) return null;
    if (ID.test(s)) return {v: s};
    if (CHAN.test(s)) return {ch: s};
    if (LIST.test(s)) return {list: s};
    if (HANDLE.test(s)) return {handle: s};
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    let u;
    try { u = new URL(s); } catch (e) { return null; }
    const host = u.hostname.toLowerCase().replace(/^(www|m|music|gaming)\./, '');
    const out = {};
    const seg = u.pathname.split('/').filter(Boolean);
    if (host === 'youtu.be') { if (ID.test(seg[0] || '')) out.v = seg[0]; } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v') || '';
      if (ID.test(v)) out.v = v;
      else if (['shorts', 'embed', 'live', 'v'].includes(seg[0]) && ID.test(seg[1] || '')) out.v = seg[1];
      else if (seg[0] === 'channel' && CHAN.test(seg[1] || '')) out.ch = seg[1];
      else if (seg[0] && HANDLE.test(decodeURIComponent(seg[0]))) out.handle = decodeURIComponent(seg[0]);
      else if (seg[0] === 'results' && u.searchParams.get('search_query')) out.q = u.searchParams.get('search_query');
    } else return null;
    const list = u.searchParams.get('list') || '';
    if (LIST.test(list)) out.list = list;
    const tm = (u.searchParams.get('t') || u.searchParams.get('start') || '').match(/^(?:(\d+)h)?(?:(\d+)m)?(\d+)s?$/);
    if (tm && out.v) out.start = (+tm[1] || 0) * 3600 + (+tm[2] || 0) * 60 + (+tm[3] || 0);
    return Object.keys(out).length ? out : null;
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
  function videos(q, {pages = 1, signal, english, live} = {}) {
    q = String(q || '').trim();
    if (!q) return Promise.resolve([]);
    const m = mode();
    if (!m) return Promise.reject(Object.assign(new Error('needs key'), {code: 'needs_key'}));
    return cached(['s', m, q.toLowerCase(), pages, english ? 1 : 0, live ? 1 : 0].join('|'), async () => {
      let out = [];
      if (m === 'api') {
        let token = '';
        for (let i = 0; i < Math.min(pages, 2); i++) {        // search.list costs 100 quota units a page
          const d = await api('search', Object.assign({part: 'snippet', type: 'video', maxResults: 50, q, safeSearch: 'moderate'},
            live ? {eventType: 'live'} : {}, token ? {pageToken: token} : {}), signal);
          // a live broadcast has no length: no details request, and nothing is a "Short"
          out.push(...parseApi(d.items, live ? [] : await details((d.items || []).map((x) => x.id && x.id.videoId).filter(Boolean), signal)).map((v) => (live ? Object.assign(v, {live: true}) : v)));
          token = d.nextPageToken || '';
          if (!token) break;
        }
      } else {
        let token = '';
        for (let i = 0; i < pages; i++) {
          const d = await inner('search', token ? {continuation: token} : {query: q, params: live ? LIVE_FILTER : 'EgIQAQ==', hl: english ? 'en' : ''}, signal);
          out.push(...parseInnertube(d).map((v) => (live ? Object.assign(v, {live: true}) : v)));
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

  // the videos of a playlist (yt.py playlist_videos); with no key and no helper the list cannot be read - playList() still plays it
  function playlistVideos(id, pages = 3) {
    if (!LIST.test(id || '')) return Promise.resolve([]);
    const m = mode();
    if (!m) return Promise.reject(Object.assign(new Error('needs key'), {code: 'needs_key'}));
    return cached(['p', m, id, pages].join('|'), async () => {
      const out = [];
      let token = '';
      for (let i = 0; i < pages; i++) {
        if (m === 'api') {
          const d = await api('playlistItems', Object.assign({part: 'snippet', playlistId: id, maxResults: 50}, token ? {pageToken: token} : {}));
          out.push(...parseApi(d.items, await details((d.items || []).map((x) => x.snippet && x.snippet.resourceId && x.snippet.resourceId.videoId).filter(Boolean))));
          token = d.nextPageToken || '';
        } else {
          const d = await inner('browse', token ? {continuation: token} : {browseId: 'VL' + id});
          out.push(...parseInnertube(d));
          token = continuation(d);
        }
        if (!token) break;
      }
      const seen = new Set();
      return out.filter((v) => !seen.has(v.id) && seen.add(v.id));
    });
  }
  // "@name" -> the channel id (UC...), '' when it cannot be found
  async function resolveHandle(handle) {
    if (!HANDLE.test(handle || '')) return '';
    const m = mode();
    if (!m) throw Object.assign(new Error('needs key'), {code: 'needs_key'});
    return cached(['h', m, handle.toLowerCase()].join('|'), async () => {
      if (m === 'api') {
        const d = await api('channels', {part: 'id', forHandle: handle});
        return (((d.items || [])[0] || {}).id) || '';
      }
      const d = await inner('navigation/resolve_url', {url: 'https://www.youtube.com/' + handle});
      const id = first(walk(d, 'browseId'), '');
      return CHAN.test(id) ? id : '';
    });
  }

  // ------------------------------------------------------------ playing
  // 5.2: subtitles on, in the site's language when YouTube has (or can make) them; the player's own language too
  const ccLang = () => ({he: 'iw', ru: 'ru'}[TN.lang()] || 'en');
  function embed(id, start) { return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&rel=0&cc_load_policy=1&cc_lang_pref=' + ccLang() + '&hl=' + ccLang() + (start > 0 ? '&start=' + Math.floor(start) : ''); }
  // a whole playlist in the embed player (its own next / previous): works with no key
  function embedList(id, firstVideo) {
    return 'https://www.youtube-nocookie.com/embed/' + (ID.test(firstVideo || '') ? encodeURIComponent(firstVideo) : 'videoseries') + '?autoplay=1&rel=0&list=' + encodeURIComponent(id);
  }
  function playList(id, title, firstVideo) {
    if (!LIST.test(id || '')) return;
    TN.modal(`<div class="player"><iframe src="${TN.esc(embedList(id, firstVideo))}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen ` +
      `title="${TN.esc(title || TN.t('yt_playlist'))}"></iframe></div><h2 dir="auto">${TN.esc(title || TN.t('yt_playlist'))}</h2><div class="links">` +
      `<a class="btn ghost" target="_blank" rel="noopener" href="https://www.youtube.com/playlist?list=${encodeURIComponent(id)}">${TN.esc(TN.t('yt_open'))}</a></div>`);
  }
  function play(v) {
    if (!v || !ID.test(v.id || '')) return;
    TN.noteHistory({key: 'yt:' + v.id, label: v.title || 'YouTube', play: PLAY + v.id, thumb: v.img || ''});
    const sub = [v.channel, v.live ? TN.t('yt_live') : clock(v.secs), v.views ? TN.t('yt_views', v.views.toLocaleString()) : ''].filter(Boolean).join(' · ');
    TN.modal(`<div class="player"><iframe src="${TN.esc(embed(v.id, v.start))}" ` +
      `allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="${TN.esc(v.title || 'YouTube')}"></iframe></div>` +
      `<h2 dir="auto">${TN.esc(v.title || '')}</h2><p class="hint" dir="auto">${TN.esc(sub)}</p><div class="links" id="yt_acts">` +
      `<a class="btn ghost" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}">${TN.esc(TN.t('yt_open'))}</a>` +
      (CHAN.test(v.channel_id || '') ? `<a class="btn ghost" href="${TN.esc(TN.link('youtube', {ch: v.channel_id, n: v.channel || ''}))}">${TN.esc(TN.t('yt_channel'))}</a>` : '') +
      '</div>');
    const acts = document.getElementById('yt_acts');
    if (acts) acts.append(TN.favButton({kind: 'web_yt', id: v.id, label: v.title || 'YouTube', extra: PLAY + v.id, img: v.img}));
    acts && acts.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', () => TN.closeModal()));
  }
  const thumb = (id) => 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
  const card = (v) => TN.card(v.img || thumb(v.id), v.title,
    [v.channel, v.live ? '' : clock(v.secs)].filter(Boolean).join(' · '), () => play(v), 'wide', v.live ? 'LIVE' : '');
  // ------------------------------------------------------------ favourites (kinds web_yt = a video, web_ytc = a channel)
  // one stored favourite -> how a list shows and opens it; null = not a YouTube favourite. Kodi's own YouTube favourites
  // (a play address with video_id=) are understood too.
  function favView(f) {
    if (!f || typeof f !== 'object') return null;
    const id = String(f.id == null ? '' : f.id), label = String(f.label || id), extra = typeof f.extra === 'string' ? f.extra : '';
    if (f.kind === 'web_ytc' && CHAN.test(id)) {
      return {kind: 'web_ytc', id, label, img: TN.store.art('web_ytc', id) || 'icon.png', group: 'youtube', shape: 'square', open: () => TN.go(TN.link('youtube', {ch: id, n: label}))};
    }
    const vid = f.kind === 'web_yt' && ID.test(id) ? id : (extra.match(/plugin\.video\.youtube\/play\/\?video_id=([A-Za-z0-9_-]{11})/) || [])[1] || '';
    if (!vid) return null;
    const img = TN.store.art('web_yt', vid) || thumb(vid);
    return {kind: 'web_yt', id: vid, label, img, group: 'youtube', shape: 'wide', open: () => play({id: vid, title: label, img})};
  }
  const favs = () => (TN.store.favs() || []).map(favView).filter(Boolean);
  function favChannelButton(id, name) {
    return TN.favButton({kind: 'web_ytc', id, label: name || id, extra: 'https://www.youtube.com/channel/' + id, img: ''});
  }
  // what was played here lately (history rows yt:<id>)
  function recent(limit) {
    const out = [];
    for (const h of TN.store.history() || []) {
      const m = String((h && h.key) || '').match(/^yt:([A-Za-z0-9_-]{11})$/);
      if (m) out.push({id: m[1], title: String(h.label || 'YouTube'), img: TN.httpsOnly(h.thumb || '') || thumb(m[1])});
      if (out.length >= (limit || 12)) break;
    }
    return out;
  }
  // a link (or id) from the clipboard / another page -> plays or opens the right list; false when it is not YouTube
  function openLink(text) {
    const l = parseLink(text);
    if (!l) return false;
    if (l.v) { play({id: l.v, title: '', start: l.start || 0}); if (l.list) TN.go(TN.link('youtube', {pl: l.list})); return true; }
    if (l.list) { TN.go(TN.link('youtube', {pl: l.list})); return true; }
    if (l.ch) { TN.go(TN.link('youtube', {ch: l.ch})); return true; }
    if (l.handle) { TN.go(TN.link('youtube', {h: l.handle})); return true; }
    if (l.q) { TN.go(TN.link('youtube', {q: l.q})); return true; }
    return false;
  }
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
    ready, mode, videos, channelVideos, playlistVideos, resolveHandle, play, playList, card, embed, embedList, clock, seconds, ageDays, parseInnertube, parseApi,
    parseLink, openLink, favs, favView, recent, clearCache: () => mem.clear(),
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
      // no `url`: a watch page is not a media file - the row plays through open() (the embed). The length goes in the
      // label; `size` is bytes for the sources sheet, and a video's size is not known (0, never a clock text -> "NaN MB").
      return list.map((v) => ({label: [v.title, clock(v.secs)].filter(Boolean).join(' · '), quality: '', lang: '', size: 0, secs: v.secs, ext: 'https://www.youtube.com/watch?v=' + v.id,
        open: () => play(v)}));
    },
  };
  TN.registerProvider('yt', impl);

  // ------------------------------------------------------------ page #/youtube/...
  function note(view, kind, text, action) {      // TN.state of the new shell when it is there, else the message line
    const box = document.createElement('div');
    view.append(box);
    if (typeof TN.state === 'function') { try { TN.state(box, {kind, title: text, text: '', action}); return box; } catch (e) { box.textContent = ''; } }
    box.innerHTML = `<p class="msg">${TN.esc(text)}</p>`;
    if (action) {
      box.append(action.href ? Object.assign(document.createElement('a'), {className: 'btn', href: action.href, textContent: action.label}) : TN.button('btn', action.label, action.onClick));
    }
    return box;
  }
  function grid(view, title, list, shape) {
    if (!list.length) return null;
    const g = TN.section(title, list.length);
    list.forEach((x) => g.append(x.open ? TN.card(x.img || 'icon.png', x.label, null, x.open, shape || x.shape || 'wide') : card(x)));
    return g;
  }
  TN.registerPage('youtube', async (arg, ctx) => {
    const p = TN.params(arg);
    const view = TN.view();
    // a link handed over by "Paste link" (Services), the hub or another device: url= / link=
    const given = p.url || p.link || '';
    if (given) {
      const l = parseLink(given);
      if (l && l.v) { TN.page('', TN.t('yt_title')); play({id: l.v, title: '', start: l.start || 0}); if (l.list) p.pl = l.list; } else if (l && l.list) p.pl = l.list;
      else if (l && l.ch) p.ch = l.ch; else if (l && l.handle) p.h = l.handle; else if (l && l.q) p.q = l.q;
    }
    if (p.v && ID.test(p.v)) { TN.page('', TN.t('yt_title')); play({id: p.v, title: p.n || ''}); }
    TN.page('', p.n || TN.t('yt_title'));
    const f = document.createElement('form');
    f.className = 'hubform';
    f.setAttribute('role', 'search');
    f.innerHTML = `<input type="search" autocomplete="off" dir="auto" aria-label="${TN.esc(TN.t('yt_search'))}" placeholder="${TN.esc(TN.t('yt_search'))}">`;
    f.firstChild.value = p.q || '';
    f.append(TN.button('btn', TN.t('yt_go'), null));
    // the same box takes a pasted link: it opens instead of being searched for
    f.onsubmit = (e) => {
      e.preventDefault();
      const q = f.firstChild.value.trim();
      if (!q) return;
      if (/^(https?:\/\/|www\.|youtu\.be\/|youtube\.com\/)/i.test(q)) { if (!openLink(q)) status.textContent = TN.t('yt_link_bad'); return; }
      TN.store.addSearch(q);
      TN.go(TN.link('youtube', p.live ? {q, live: 1} : {q}));
    };
    const status = document.createElement('p');
    status.className = 'hint';
    status.setAttribute('role', 'status');
    view.append(f, status);
    if (given && !parseLink(given)) status.textContent = TN.t('yt_link_bad');
    if (p.q) TN.chips([['', TN.t('yt_all')], ['1', TN.t('yt_live')]], p.live ? '1' : '', (k) => TN.go(TN.link('youtube', k ? {q: p.q, live: 1} : {q: p.q})));
    if (!ready()) {
      note(view, 'need-key', TN.t('yt_setup_txt'), {label: TN.t('yt_setup'), href: '#/services'});
    }
    // "@name": needs the list path to find the channel id; else it opens on YouTube (never nothing)
    if (p.h && HANDLE.test(p.h) && !p.ch) {
      try { p.ch = await resolveHandle(p.h); } catch (e) { p.ch = ''; }
      if (!ctx.current()) return;
      if (!p.ch) {
        view.insertAdjacentHTML('beforeend', `<p class="msg">${TN.esc(TN.t('yt_ch_need'))}</p><div class="links"><a class="btn" target="_blank" rel="noopener" ` +
          `href="https://www.youtube.com/${encodeURIComponent(p.h)}">${TN.esc(TN.t('yt_open'))}</a></div>`);
        return;
      }
    }
    // a playlist: plays with no key (the embed walks it); with a key / the helper its videos are listed too
    if (p.pl && LIST.test(p.pl)) {
      const acts = document.createElement('div');
      acts.className = 'links';
      acts.append(TN.button('btn', '▶ ' + TN.t('yt_playlist'), () => playList(p.pl, p.n || '')));
      view.append(acts);
      if (!ready()) { playList(p.pl, p.n || ''); return; }
    }
    if (p.ch && CHAN.test(p.ch)) {
      const acts = document.createElement('div');
      acts.className = 'links';
      acts.append(favChannelButton(p.ch, p.n || ''), Object.assign(document.createElement('a'), {className: 'btn ghost', target: '_blank', rel: 'noopener',
        href: 'https://www.youtube.com/channel/' + p.ch, textContent: TN.t('yt_open')}));
      view.append(acts);
    }
    const wants = !!(p.q || p.ch || p.pl);
    if (!wants || !ready()) {
      // the front page (and every page while there is no key): favourites, channels, watched lately - all local
      const all = favs();
      grid(view, TN.t('yt_favs'), all.filter((x) => x.kind === 'web_yt'), 'wide');
      grid(view, TN.t('yt_fav_ch'), all.filter((x) => x.kind === 'web_ytc'), 'square');
      grid(view, TN.t('yt_recent'), recent(12));
      return;
    }
    const sk = TN.skeleton(8);
    let list;
    try {
      list = p.pl ? await playlistVideos(p.pl) : p.ch ? await channelVideos(p.ch, 2) : await videos(p.q, {pages: 2, live: !!p.live});
    } catch (e) {
      if (!ctx.current()) return;
      sk.remove();
      note(view, 'error', TN.t('yt_fail'), {label: TN.t('yt_retry'), onClick: () => { mem.clear(); TN.route(); }});
      return;
    }
    if (!ctx.current()) return;
    sk.remove();
    const g = TN.section(p.pl ? (p.n || TN.t('yt_playlist')) : p.ch ? (p.n || TN.t('yt_channel')) : `“${p.q}”`, list.length);
    if (!list.length) return TN.empty(g, TN.t('yt_none'));
    list.forEach((v) => g.append(card(v)));
  });
  self.TNYt = {parseLink, seconds, clock, parseInnertube, parseApi, embed, embedList, favView};     // for the tests
})(self.TN);
