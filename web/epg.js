'use strict';
// WP-7 (plan row 21): the TV guide as a service. The guide is web/data/epg_il.json, built from epgshare01's Israeli
// XMLTV file by src/qa/web/gen_epg.py, run every 6 hours by .github/workflows/epg.yml (epgshare01 has no CORS, so the
// browser never reads it directly; no server of ours is involved). Channel names are matched like the build does:
// normalised name -> key through the file's own index (the build's IL_ALIASES table).
// Like the build (livefail.SAME_GUIDE / own_guide): a second feed of a channel (subtitled) shows the main channel's
// guide, and a channel of the build's own table that no guide lists gets "live broadcast" rows of six hours.
// The viewer's own XMLTV addresses (Live TV > Sources) are read in the browser (directly, else through the helper).
//
//   const epg = await TN.provider('epg');
//   await epg.ready()                    -> true when a guide is loaded
//   epg.keyOf(name | {key, name, names, guide}) -> guide key or ''
//   epg.nowNext(channel, at?)            -> {now, next, key} | null    (programme: {start, stop, title, desc} in ms)
//   epg.day(channel, at?)                -> programmes from now on (the guide sheet)
//   epg.bar(channel) / epg.sheet(channel)-> HTML element / opens the guide sheet
//   epg.grid(box, channels, {onPlay, hours, name}) -> draws the guide grid (channels down, time across)
//   epg.sources() / addSource(url) / removeSource(url) / loadOwn() -> the viewer's own XMLTV guides
(function (TN) {
  TN.i18n.add({
    he: {epg_now: 'עכשיו', epg_next: 'אחר כך', epg_guide: 'לוח שידורים', epg_none: 'אין לוח שידורים לערוץ הזה',
         epg_old: 'לוח השידורים לא עודכן מ-%s', epg_src: 'מקור: epgshare01, מתעדכן כל 6 שעות',
         epg_live: '%s - שידור חי', epg_watch: 'צפייה בערוץ', epg_earlier: 'מוקדם יותר', epg_later: 'מאוחר יותר', epg_to_now: 'עכשיו',
         epg_channel: 'ערוץ', epg_nothing: 'אין מידע', epg_grid_none: 'אין לוח שידורים לערוצים האלה כרגע.',
         epg_own_big: 'קובץ לוח השידורים גדול מדי לדפדפן (%s MB).', epg_own_fail: 'לא ניתן לקרוא את לוח השידורים מהכתובת הזאת: %s',
         epg_own_ok: 'נקראו %s ערוצים, %s תוכניות', epg_need_helper: 'האתר לא מאפשר קריאה מדפדפן. הגדירו את שרת העזר (שירותים וחיבורים) או העלו קובץ.'},
    en: {epg_now: 'Now', epg_next: 'Next', epg_guide: 'TV guide', epg_none: 'No guide for this channel',
         epg_old: 'The guide was last updated %s', epg_src: 'Source: epgshare01, updated every 6 hours',
         epg_live: '%s - live broadcast', epg_watch: 'Watch the channel', epg_earlier: 'Earlier', epg_later: 'Later', epg_to_now: 'Now',
         epg_channel: 'Channel', epg_nothing: 'No information', epg_grid_none: 'There is no guide for these channels right now.',
         epg_own_big: 'The guide file is too large for a browser (%s MB).', epg_own_fail: 'The guide at this address could not be read: %s',
         epg_own_ok: '%s channels, %s programmes read', epg_need_helper: 'The site does not allow reading from a browser. Set the helper server (Services) or upload a file.'},
    ru: {epg_now: 'Сейчас', epg_next: 'Далее', epg_guide: 'Телепрограмма', epg_none: 'Нет программы для этого канала',
         epg_old: 'Программа обновлялась %s', epg_src: 'Источник: epgshare01, обновляется каждые 6 часов',
         epg_live: '%s - прямой эфир', epg_watch: 'Смотреть канал', epg_earlier: 'Раньше', epg_later: 'Позже', epg_to_now: 'Сейчас',
         epg_channel: 'Канал', epg_nothing: 'Нет данных', epg_grid_none: 'Для этих каналов сейчас нет программы.',
         epg_own_big: 'Файл программы слишком большой для браузера (%s МБ).', epg_own_fail: 'Не удалось прочитать программу по этому адресу: %s',
         epg_own_ok: 'Прочитано каналов: %s, передач: %s', epg_need_helper: 'Сайт не разрешает чтение из браузера. Укажите вспомогательный сервер (Сервисы) или загрузите файл.'},
  });

  // the build's epg.norm, in JS: 'Keshet 12 (1080p) [Geo-blocked]' -> 'keshet 12'
  function norm(name) {
    let n = String(name || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').trim();
    n = n.replace(/\.(il|uk|us|de|fr|es|it|nl|tr|ru|[a-z]{2})$/i, '');
    n = n.replace(/[._-]/g, ' ');
    n = n.replace(/(^|[^\p{L}\p{N}_])(hd|fhd|uhd|4k|sd|live|tv)(?=$|[^\p{L}\p{N}_])/giu, '$1 ').replace(/שידור חי/g, ' ');
    return n.toLowerCase().replace(/[^\p{L}\p{N}_+! ]/gu, ' ').split(/\s+/).filter(Boolean).join(' ');
  }

  let data = null, loading = null;
  const HOUR = 3600000;
  function ready() {
    if (data) return Promise.resolve(true);
    if (!loading) {
      loading = fetch('data/epg_il.json', {cache: 'no-cache'}).then((r) => (r.ok ? r.json() : null))
        .then((d) => { data = d && d.ch ? d : null; if (!data) loading = null; return !!data; })
        .catch(() => { loading = null; return false; });
    }
    return loading;
  }
  TN.on('clearcache', () => { data = null; loading = null; ownDone = null; });

  function keyOf(c) {
    if (!data || !c) return '';
    if (typeof c === 'object' && c.key && data.ch[c.key]) return c.key;
    const names = typeof c === 'string' ? [c] : [c.name, c.name_he].concat(c.names || []).concat(c.guide ? [c.guide] : []);
    for (const n of names) {
      const k = n && data.index[norm(n)];
      if (k) return k;
    }
    return '';
  }
  const prog = (p) => ({start: p[0] * 1000, stop: p[1] * 1000, title: p[2] || '', desc: p[3] || ''});
  // a channel of the build's own table with no guide: "<channel> - live broadcast" every six hours (livefail.own_guide)
  function ownRows(c, at, hours) {
    if (!c || typeof c !== 'object' || !c.key || !(c.name || c.name_he)) return [];
    const name = TN.lang() === 'he' && c.name_he ? c.name_he : c.name || c.name_he;
    const step = 6 * HOUR, first = at - (at % step), out = [];
    for (let i = 0; i < Math.ceil((hours || 24) / 6) + 1; i++) {
      out.push({start: first + i * step, stop: first + (i + 1) * step, title: TN.t('epg_live', name), desc: '', own: true});
    }
    return out;
  }
  function day(c, at = Date.now()) {
    const k = keyOf(c);
    if (!k) return ownRows(c, at);
    return data.ch[k].p.map(prog).filter((p) => p.stop > at);
  }
  // every programme that touches [from, to) - the grid
  function span(c, from, to) {
    const k = keyOf(c);
    const list = k ? data.ch[k].p.map(prog) : ownRows(c, from, (to - from) / HOUR + 6);
    return list.filter((p) => p.stop > from && p.start < to);
  }
  function nowNext(c, at = Date.now()) {
    const k = keyOf(c);
    const list = day(c, at);
    if (!list.length) return null;
    const now = list.find((p) => p.start <= at && p.stop > at) || null;
    const next = list.find((p) => p.start >= (now ? now.stop : at)) || null;
    return now || next ? {key: k, now, next} : null;
  }
  const hm = (ms) => new Date(ms).toLocaleTimeString(TN.lang() === 'he' ? 'he-IL' : TN.lang(), {hour: '2-digit', minute: '2-digit'});

  // the now / next line under a channel (a card or the player sheet)
  function bar(c) {
    const el = document.createElement('div');
    el.className = 'epgbar';
    const nn = nowNext(c);
    if (!nn) return el;
    const pct = nn.now ? Math.min(100, Math.max(0, (Date.now() - nn.now.start) / (nn.now.stop - nn.now.start) * 100)) : 0;
    el.innerHTML = (nn.now ? `<div dir="auto"><b>${TN.esc(TN.t('epg_now'))}</b> ${nn.now.own ? '' : TN.esc(hm(nn.now.start)) + ' '}${TN.esc(nn.now.title)}</div>` +
                             (nn.now.own ? '' : `<div class="epgprog"><i style="width:${pct.toFixed(0)}%"></i></div>`) : '') +
                   (nn.next && !nn.next.own ? `<div dir="auto" class="epgnext"><b>${TN.esc(TN.t('epg_next'))}</b> ${TN.esc(hm(nn.next.start))} ${TN.esc(nn.next.title)}</div>` : '');
    return el;
  }
  function sheet(c, title) {
    const list = day(c);
    const rows = list.map((p) => `<div class="hrow epgrow${p.start <= Date.now() ? ' on' : ''}"><b>${TN.esc(hm(p.start))}</b>` +
      `<div><div dir="auto">${TN.esc(p.title)}</div>${p.desc ? `<small dir="auto">${TN.esc(p.desc)}</small>` : ''}</div></div>`).join('');
    const old = data && Date.now() - data.generated * 1000 > 18 * 3600 * 1000;
    TN.modal(`<div class="detail" style="grid-template-columns:1fr"><div><h3 dir="auto">${TN.esc(title || (c && c.name) || '')} · ${TN.esc(TN.t('epg_guide'))}</h3>
      ${old ? `<p class="msg">${TN.esc(TN.t('epg_old', new Date(data.generated * 1000).toLocaleString()))}</p>` : ''}
      <div class="hlist">${rows || `<p class="hint">${TN.esc(TN.t('epg_none'))}</p>`}</div>
      <p class="hint">${TN.esc(TN.t('epg_src'))}</p></div></div>`);
  }

  // ---- the guide grid: channels down, time across (the page's direction: right to left in Hebrew)
  const PX_MIN = 4;                    // width of one minute
  function grid(box, channels, opts) {
    opts = opts || {};
    const hours = opts.hours || 4, nameOf = opts.name || ((c) => (TN.lang() === 'he' && c.name_he ? c.name_he : c.name));
    const wrap = document.createElement('div');
    wrap.className = 'epgg';
    const tools = document.createElement('div');
    tools.className = 'links';
    let from = Date.now() - (Date.now() % (HOUR / 2));
    const first = from;
    const draw = () => {
      const to = from + hours * HOUR, now = Date.now();
      const rows = channels.map((c) => [c, span(c, from, to)]).filter((x) => x[1].length);
      let html = `<div class="epgg-row epgg-head"><div class="epgg-ch">${TN.esc(TN.t('epg_channel'))}</div><div class="epgg-track">`;
      for (let t = from; t < to; t += HOUR / 2) html += `<div class="epgg-tick" style="width:${30 * PX_MIN}px">${TN.esc(hm(t))}</div>`;
      html += '</div></div>';
      wrap.innerHTML = html;
      rows.forEach(([c, list]) => {
        const row = document.createElement('div');
        row.className = 'epgg-row';
        const ch = document.createElement('button');
        ch.className = 'epgg-ch';
        ch.dir = 'auto';
        ch.textContent = nameOf(c);
        ch.onclick = () => opts.onPlay && opts.onPlay(c);
        const track = document.createElement('div');
        track.className = 'epgg-track';
        let at = from;
        for (const p of list) {
          const a = Math.max(p.start, from), b = Math.min(p.stop, to);
          if (b <= at) continue;
          if (a > at) track.append(Object.assign(document.createElement('div'), {className: 'epgg-gap', style: `width:${(a - at) / 60000 * PX_MIN}px`}));
          const cell = document.createElement('button');
          cell.className = 'epgg-p' + (p.start <= now && p.stop > now ? ' on' : '');
          cell.style.width = Math.max(8, (b - Math.max(a, at)) / 60000 * PX_MIN) + 'px';
          cell.dir = 'auto';
          cell.title = `${hm(p.start)} ${p.title}`;
          cell.innerHTML = `<b>${TN.esc(p.title || TN.t('epg_nothing'))}</b><small>${TN.esc(hm(p.start))}–${TN.esc(hm(p.stop))}</small>`;
          cell.onclick = () => detail(c, p, nameOf(c), opts.onPlay);
          track.append(cell);
          at = b;
        }
        row.append(ch, track);
        wrap.append(row);
      });
      if (!rows.length) wrap.insertAdjacentHTML('beforeend', `<p class="msg">${TN.esc(TN.t('epg_grid_none'))}</p>`);
      if (now >= from && now < to) {
        const line = document.createElement('div');
        line.className = 'epgg-now';
        line.style[TN.rtl && TN.rtl() ? 'right' : 'left'] = `calc(var(--epgg-ch) + ${(now - from) / 60000 * PX_MIN}px)`;
        wrap.append(line);
      }
    };
    tools.append(TN.button('btn ghost', TN.t('epg_earlier'), () => { from -= 2 * HOUR; draw(); }),
                 TN.button('btn ghost', TN.t('epg_to_now'), () => { from = first; draw(); }),
                 TN.button('btn ghost', TN.t('epg_later'), () => { from += 2 * HOUR; draw(); }));
    box.append(tools, wrap);
    if (data && Date.now() - data.generated * 1000 > 18 * HOUR) {
      box.insertAdjacentHTML('beforeend', `<p class="msg">${TN.esc(TN.t('epg_old', new Date(data.generated * 1000).toLocaleString()))}</p>`);
    }
    box.insertAdjacentHTML('beforeend', `<p class="hint">${TN.esc(TN.t('epg_src'))}</p>`);
    draw();
    return {redraw: draw};
  }
  function detail(c, p, name, onPlay) {
    TN.modal(`<div class="detail" style="grid-template-columns:1fr"><div><h3 dir="auto">${TN.esc(p.title)}</h3>
      <div class="meta" dir="auto">${TN.esc(name)} · ${TN.esc(hm(p.start))}–${TN.esc(hm(p.stop))}</div>
      ${p.desc ? `<p dir="auto">${TN.esc(p.desc)}</p>` : ''}<div class="actions" id="acts"></div></div></div>`);
    const acts = document.getElementById('acts');
    if (acts && onPlay) acts.append(TN.button('btn', TN.t('epg_watch'), () => onPlay(c)));
  }

  // ---- the viewer's own XMLTV guides (this browser: TN.put('epg_own'))
  const OWN = 'epg_own', MAX_BYTES = 40 * 1024 * 1024;
  const sources = () => { const s = TN.get(OWN, []); return Array.isArray(s) ? s.filter((u) => typeof u === 'string') : []; };
  function xmlTime(s) {
    const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\s*([+-])?(\d\d)?(\d\d)?/.exec(String(s || ''));
    if (!m) return 0;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const off = m[7] ? (m[7] === '-' ? -1 : 1) * ((+m[8] || 0) * 60 + (+m[9] || 0)) : 0;
    return Math.round(t / 1000) - off * 60;
  }
  const unesc = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  // XMLTV text -> the same shape as the shipped file: {index, ch}; programmes from 2 h ago to 26 h ahead
  function parseXmltv(xml, now) {
    now = Math.round((now || Date.now()) / 1000);
    const ch = {}, index = {}, idKey = {};
    const reCh = /<channel\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/g;
    let m;
    while ((m = reCh.exec(xml))) {
      const id = unesc(m[1]), names = [];
      m[2].replace(/<display-name[^>]*>([^<]+)<\/display-name>/g, (a, n) => { names.push(unesc(n)); return a; });
      const key = 'x:' + id;
      idKey[m[1]] = key;
      ch[key] = {n: names[0] || id, p: []};
      for (const n of names.concat([id])) { const k = norm(n); if (k && !index[k]) index[k] = key; }
    }
    const reP = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
    while ((m = reP.exec(xml))) {
      const cid = (/channel="([^"]+)"/.exec(m[1]) || [])[1], key = idKey[cid];
      if (!key) continue;
      const start = xmlTime((/start="([^"]+)"/.exec(m[1]) || [])[1]), stop = xmlTime((/stop="([^"]+)"/.exec(m[1]) || [])[1]);
      if (!start || stop < now - 7200 || start > now + 26 * 3600) continue;
      const title = unesc((/<title[^>]*>([\s\S]*?)<\/title>/.exec(m[2]) || [])[1]);
      let desc = unesc((/<desc[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]) || [])[1]);
      if (desc.length > 140) desc = desc.slice(0, 139).trim() + '…';
      ch[key].p.push([start, stop, title, desc]);
    }
    let progs = 0;
    for (const k of Object.keys(ch)) {
      if (!ch[k].p.length) { delete ch[k]; continue; }
      ch[k].p.sort((a, b) => a[0] - b[0]);
      progs += ch[k].p.length;
    }
    for (const k of Object.keys(index)) if (!ch[index[k]]) delete index[k];
    return {index, ch, channels: Object.keys(ch).length, programmes: progs};
  }
  // the shipped guide keeps its channels; an own guide adds the ones it does not have
  function mergeGuide(g) {
    if (!data) data = {v: 1, generated: Math.round(Date.now() / 1000), index: {}, ch: {}};
    for (const k of Object.keys(g.ch)) if (!data.ch[k]) data.ch[k] = g.ch[k];
    for (const k of Object.keys(g.index)) if (!data.index[k]) data.index[k] = g.index[k];
  }
  async function readBody(r) {
    const len = Number(r.headers.get('content-length') || 0);
    if (len > MAX_BYTES) { const e = new Error(TN.t('epg_own_big', Math.round(len / 1048576))); e.code = 'big'; throw e; }
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) { const e = new Error(TN.t('epg_own_big', Math.round(buf.length / 1048576))); e.code = 'big'; throw e; }
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      if (typeof DecompressionStream !== 'function') throw new Error('gzip');
      const st = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      return await new Response(st).text();
    }
    return new TextDecoder('utf-8').decode(buf);
  }
  async function fetchGuide(url) {
    if (!/^https:\/\//i.test(url)) throw new Error('https');
    let r = null;
    try { r = await fetch(url, {credentials: 'omit'}); } catch (e) { r = null; }
    if (!r || !r.ok) {
      const base = TN.settings.helper ? TN.settings.helper() : '';
      if (!base) throw new Error(r ? 'HTTP ' + r.status : TN.t('epg_need_helper'));
      r = await fetch(base + '/p', {headers: {'X-TN-Target': url}, credentials: 'omit', cache: 'no-store'});
      if (!r.ok) throw new Error('helper ' + r.status);
    }
    return parseXmltv(await readBody(r));
  }
  let ownDone = null;
  const ownState = {};                 // url -> {ok, text}
  function loadOwn(force) {
    if (ownDone && !force) return ownDone;
    ownDone = (async () => {
      await ready();
      for (const u of sources()) {
        try { const g = await fetchGuide(u); mergeGuide(g); ownState[u] = {ok: true, text: TN.t('epg_own_ok', g.channels, g.programmes)}; }
        catch (e) { ownState[u] = {ok: false, text: e.code === 'big' ? e.message : TN.t('epg_own_fail', String((e && e.message) || e))}; }
      }
      return ownState;
    })();
    return ownDone;
  }
  function addSource(url) {
    url = String(url || '').trim();
    if (!/^https:\/\/[^\s]+$/i.test(url)) return false;
    const s = sources().filter((u) => u !== url);
    s.push(url);
    TN.put(OWN, s.slice(-6));
    ownDone = null;
    return true;
  }
  function removeSource(url) { TN.put(OWN, sources().filter((u) => u !== url)); delete ownState[url]; }
  // an XMLTV file the viewer picked from the device (works with no CORS and no helper; kept for this visit)
  function addText(xml) { const g = parseXmltv(xml); mergeGuide(g); return g; }

  if (typeof document !== 'undefined' && document.getElementById && !document.getElementById('epg-style')) {
    const st = document.createElement('style');
    st.id = 'epg-style';
    st.textContent = `.epgbar{font-size:.8em;opacity:.9;padding:2px 8px 6px;text-align:start;line-height:1.35}
.epgbar b{font-weight:600;margin-inline-end:4px}.epgnext{opacity:.75}
.epgprog{height:3px;background:rgba(128,128,128,.3);border-radius:2px;margin:3px 0}.epgprog i{display:block;height:100%;background:currentColor;border-radius:2px}
.epgrow{display:flex;gap:12px;align-items:flex-start}.epgrow small{display:block;opacity:.7}.epgrow.on{font-weight:600}
.epgg{--epgg-ch:9.5rem;position:relative;overflow-x:auto;overflow-y:hidden;border-radius:10px;background:var(--panel);margin:10px 0;-webkit-overflow-scrolling:touch}
.epgg-row{display:flex;align-items:stretch;min-width:max-content;border-bottom:1px solid var(--panel2)}
.epgg-ch{flex:0 0 var(--epgg-ch);width:var(--epgg-ch);position:sticky;left:0;right:0;z-index:2;background:var(--panel2);color:inherit;border:0;font:inherit;font-weight:600;padding:8px 10px;text-align:start;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
.epgg-head .epgg-ch{cursor:default;font-weight:400;opacity:.8}
.epgg-track{display:flex;flex:0 0 auto}.epgg-tick{flex:0 0 auto;box-sizing:border-box;padding:6px 6px;font-size:.8em;opacity:.8;border-inline-start:1px solid var(--panel2)}
.epgg-gap{flex:0 0 auto}.epgg-p{flex:0 0 auto;box-sizing:border-box;background:transparent;color:inherit;border:0;border-inline-start:1px solid var(--panel2);font:inherit;font-size:.85em;padding:6px 8px;text-align:start;overflow:hidden;white-space:nowrap;cursor:pointer;min-height:3.2em}
.epgg-p b{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis}.epgg-p small{opacity:.65}
.epgg-p.on{background:rgba(128,128,128,.22)}.epgg-p:hover,.epgg-p:focus-visible,.epgg-ch:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.epgg-now{position:absolute;top:0;bottom:0;width:2px;background:var(--accent);pointer-events:none;z-index:1}
html.tv .epgg-p:focus,html.tv .epgg-ch:focus{outline:4px solid var(--accent);outline-offset:-4px}
@media (max-width:600px){.epgg{--epgg-ch:6.5rem}}`;
    document.head.append(st);
  }

  TN.registerProvider('epg', {kinds: ['service'], label: 'TV guide', ready, keyOf, nowNext, day, span, bar, sheet, grid, norm,
                              sources, addSource, removeSource, addText, loadOwn, ownState: () => ownState, parseXmltv, xmlTime,
                              _set(d) { data = d; }});      // _set: tests only
})(self.TN);
