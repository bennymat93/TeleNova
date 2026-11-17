'use strict';
// WP-7 (plan row 21): the TV guide as a service. The guide is web/data/epg_il.json, built from epgshare01's Israeli
// XMLTV file by src/qa/web/gen_epg.py, run every 6 hours by .github/workflows/epg.yml (epgshare01 has no CORS, so the
// browser never reads it directly; no server of ours is involved). Channel names are matched like the build does:
// normalised name -> key through the file's own index (the build's IL_ALIASES table).
//
//   const epg = await TN.provider('epg');
//   await epg.ready()                    -> true when a guide is loaded
//   epg.keyOf(name | {key, name, names}) -> guide key or ''
//   epg.nowNext(channel, at?)            -> {now, next, key} | null    (programme: {start, stop, title, desc} in ms)
//   epg.day(channel, at?)                -> programmes from now on (the guide sheet)
//   epg.bar(channel) / epg.sheet(channel)-> HTML element / opens the guide sheet
(function (TN) {
  TN.i18n.add({
    he: {epg_now: 'עכשיו', epg_next: 'אחר כך', epg_guide: 'לוח שידורים', epg_none: 'אין לוח שידורים לערוץ הזה',
         epg_old: 'לוח השידורים לא עודכן מ-%s', epg_src: 'מקור: epgshare01, מתעדכן כל 6 שעות'},
    en: {epg_now: 'Now', epg_next: 'Next', epg_guide: 'TV guide', epg_none: 'No guide for this channel',
         epg_old: 'The guide was last updated %s', epg_src: 'Source: epgshare01, updated every 6 hours'},
    ru: {epg_now: 'Сейчас', epg_next: 'Далее', epg_guide: 'Телепрограмма', epg_none: 'Нет программы для этого канала',
         epg_old: 'Программа обновлялась %s', epg_src: 'Источник: epgshare01, обновляется каждые 6 часов'},
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
  function ready() {
    if (data) return Promise.resolve(true);
    if (!loading) {
      loading = fetch('data/epg_il.json', {cache: 'no-cache'}).then((r) => (r.ok ? r.json() : null))
        .then((d) => { data = d && d.ch ? d : null; if (!data) loading = null; return !!data; })
        .catch(() => { loading = null; return false; });
    }
    return loading;
  }
  TN.on('clearcache', () => { data = null; loading = null; });

  function keyOf(c) {
    if (!data || !c) return '';
    if (typeof c === 'object' && c.key && data.ch[c.key]) return c.key;
    const names = typeof c === 'string' ? [c] : [c.name, c.name_he].concat(c.names || []);
    for (const n of names) {
      const k = n && data.index[norm(n)];
      if (k) return k;
    }
    return '';
  }
  const prog = (p) => ({start: p[0] * 1000, stop: p[1] * 1000, title: p[2] || '', desc: p[3] || ''});
  function day(c, at = Date.now()) {
    const k = keyOf(c);
    return k ? data.ch[k].p.map(prog).filter((p) => p.stop > at) : [];
  }
  function nowNext(c, at = Date.now()) {
    const k = keyOf(c);
    if (!k) return null;
    const list = day(c, at);
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
    el.innerHTML = (nn.now ? `<div dir="auto"><b>${TN.esc(TN.t('epg_now'))}</b> ${TN.esc(hm(nn.now.start))} ${TN.esc(nn.now.title)}</div>` +
                             `<div class="epgprog"><i style="width:${pct.toFixed(0)}%"></i></div>` : '') +
                   (nn.next ? `<div dir="auto" class="epgnext"><b>${TN.esc(TN.t('epg_next'))}</b> ${TN.esc(hm(nn.next.start))} ${TN.esc(nn.next.title)}</div>` : '');
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
  if (!document.getElementById('epg-style')) {
    const st = document.createElement('style');
    st.id = 'epg-style';
    st.textContent = `.epgbar{font-size:.8em;opacity:.9;padding:2px 8px 6px;text-align:start;line-height:1.35}
.epgbar b{font-weight:600;margin-inline-end:4px}.epgnext{opacity:.75}
.epgprog{height:3px;background:rgba(128,128,128,.3);border-radius:2px;margin:3px 0}.epgprog i{display:block;height:100%;background:currentColor;border-radius:2px}
.epgrow{display:flex;gap:12px;align-items:flex-start}.epgrow small{display:block;opacity:.7}.epgrow.on{font-weight:600}`;
    document.head.append(st);
  }

  TN.registerProvider('epg', {kinds: ['service'], label: 'TV guide', ready, keyOf, nowNext, day, bar, sheet, norm,
                              _set(d) { data = d; }});      // _set: tests only
})(self.TN);
