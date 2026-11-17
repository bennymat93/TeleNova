'use strict';
// TeleNova web (WP-5): the player (plan rows 10 resume, 38 menus).
// Service 'player': open({url | tg, title, mime, poster, subs, resumeKey, history, meta, next, back}) -> Promise.
//   url   an https (or blob:) media address; .m3u8 goes through hls.js where the browser has no native HLS
//   tg    a tgsearch row / {peer, msg}: played through tgplay (the service worker stream), with its fallbacks
//   subs  [{label, lang, vtt | fetchVtt()}] tracks to offer; the menu can also ask every 'subs' provider (WP-6)
//   resumeKey  where the position is kept (this browser, TN.put('player_resume')); history = a history entry to note
//   next  async () => next request or null (series): shows "Next episode", and opens it through sources
// Menus: audio track (video.audioTracks / hls.js), speed, subtitles (+ offset), next episode. Keys: Escape closes.
(function (G) {
  const TN = G.TN;
  TN.i18n.add({
    he: {pl_audio: 'שמע', pl_speed: 'מהירות', pl_subs: 'כתוביות', pl_subs_off: 'ללא', pl_subs_find: 'חפש כתוביות', pl_subs_none: 'לא נמצאו כתוביות',
      pl_next: 'הפרק הבא ⏭', pl_resume: 'המשך מ-%s', pl_start: 'מההתחלה', pl_fail: 'הדפדפן לא מצליח לנגן את הקובץ הזה. נסו קישור אחר.',
      pl_other: 'קישור אחר', pl_tg_open: 'פתח בטלגרם', pl_tg_dl: 'הורד ונגן', pl_loading: 'טוען...', pl_offset: 'הזזה %s ש׳', pl_track: 'רצועה %s'},
    en: {pl_audio: 'Audio', pl_speed: 'Speed', pl_subs: 'Subtitles', pl_subs_off: 'Off', pl_subs_find: 'Find subtitles', pl_subs_none: 'No subtitles found',
      pl_next: 'Next episode ⏭', pl_resume: 'Resume from %s', pl_start: 'From the start', pl_fail: 'This browser cannot play this file. Try another link.',
      pl_other: 'Another link', pl_tg_open: 'Open in Telegram', pl_tg_dl: 'Download and play', pl_loading: 'Loading...', pl_offset: 'Offset %s s', pl_track: 'Track %s'},
    ru: {pl_audio: 'Звук', pl_speed: 'Скорость', pl_subs: 'Субтитры', pl_subs_off: 'Выкл.', pl_subs_find: 'Найти субтитры', pl_subs_none: 'Субтитры не найдены',
      pl_next: 'Следующая серия ⏭', pl_resume: 'Продолжить с %s', pl_start: 'С начала', pl_fail: 'Браузер не может воспроизвести этот файл. Попробуйте другую ссылку.',
      pl_other: 'Другая ссылка', pl_tg_open: 'Открыть в Telegram', pl_tg_dl: 'Скачать и смотреть', pl_loading: 'Загрузка...', pl_offset: 'Сдвиг %s с', pl_track: 'Дорожка %s'},
  });
  const t = TN.t, esc = TN.esc;
  const RES = 'player_resume';
  function clock(s) { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); }
  function saveResume(key, pos, dur) {
    if (!key || !(pos >= 0)) return;
    const all = TN.get(RES, {}) || {};
    if (dur && pos > dur * 0.95) delete all[key];            // watched: start over next time
    else if (pos > 30) all[key] = {t: Math.round(pos), d: Math.round(dur || 0), at: Date.now()};
    const keys = Object.keys(all);
    if (keys.length > 300) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 300).forEach((k) => delete all[k]);
    TN.put(RES, all);
  }
  const resumeOf = (key) => { const r = key && (TN.get(RES, {}) || {})[key]; return r && r.t > 30 && (!r.d || r.t < r.d * 0.95) ? r : null; };

  function style() {
    if (document.getElementById('pl_style')) return;
    const s = document.createElement('style');
    s.id = 'pl_style';
    s.textContent = '.pl_bar{display:flex;flex-wrap:wrap;gap:8px;padding:10px 16px;align-items:center}.pl_bar .btn{padding:6px 12px}' +
      '.pl_menu{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px}.pl_menu .btn[aria-pressed="true"]{background:var(--accent);color:#000}' +
      '.pl_msg{padding:6px 16px}html.tv .pl_bar .btn:focus,html.tv .pl_menu .btn:focus{outline:4px solid var(--accent)}';
    document.head.append(s);
  }
  // shift every cue of a VTT text by sec seconds
  function shiftVtt(vtt, sec) {
    if (!sec) return vtt;
    const fmt = (x) => { x = Math.max(0, x); const h = Math.floor(x / 3600), m = Math.floor(x / 60) % 60, s = x % 60;
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + s.toFixed(3).padStart(6, '0'); };
    return vtt.replace(/(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/g, (all, h, m, s, ms) => fmt((+h || 0) * 3600 + +m * 60 + +s + +ms / 1000 + sec));
  }

  let session = null;                                     // the one playing now
  function end() {
    const s = session;
    if (!s) return;
    session = null;
    try { if (s.video && s.video.duration) saveResume(s.key, s.video.currentTime, s.video.duration); } catch (e) {}
    try { s.obs.disconnect(); } catch (e) {}
    try { if (s.hls) s.hls.destroy(); } catch (e) {}
    try { if (s.video) { s.video.pause(); s.video.removeAttribute('src'); s.video.load(); } } catch (e) {}
    (s.cleanup || []).forEach((f) => { try { f(); } catch (e) {} });
  }

  async function open(o = {}) {
    end();
    style();
    TN.stopRadio && TN.stopRadio();
    TN.modal(`<div class="player"><video id="pl_v" controls autoplay playsinline ${o.poster ? `poster="${esc(TN.httpsOnly(o.poster))}"` : ''}></video></div>` +
      `<div class="pl_bar"><b dir="auto" style="flex:1 1 200px">${esc(o.title || '')}</b><span id="pl_btns"></span></div>` +
      `<div class="pl_menu" id="pl_menu" hidden></div><p class="hint pl_msg" id="pl_msg"></p>`);
    const v = document.getElementById('pl_v'), msg = document.getElementById('pl_msg'), menu = document.getElementById('pl_menu');
    const btns = document.getElementById('pl_btns');
    const s = {video: v, key: o.resumeKey || '', cleanup: [], hls: null, subs: (o.subs || []).slice(), offset: 0, curSub: -1};
    session = s;
    // the app closes the sheet by emptying it: notice that and stop
    s.obs = new MutationObserver(() => { if (!document.body.contains(v)) end(); });
    s.obs.observe(document.getElementById('sheet') || document.body, {childList: true, subtree: true});
    const say = (x) => { msg.textContent = x || ''; };
    say(t('pl_loading'));
    if (o.history && o.history.key) { try { TN.noteHistory(Object.assign({plot: '', play: ''}, o.history)); } catch (e) {} }

    // ---------- the source
    let url = o.url || '', tgp = null, tgh = null;
    if (o.tg) {
      tgp = await TN.provider('tgplay');
      if (!tgp) { say(t('pl_fail')); return; }
      try {
        tgh = await tgp.open(o.tg.message ? {message: o.tg.message} : o.tg.peer ? o.tg : {peer: o.tg.chat_username || o.tg.chat_id, msg: o.tg.msg_id});
        url = tgh.url;
        s.cleanup.push(() => tgp.close(tgh.key));
      } catch (e) { say(t('pl_fail')); tgActions(); return; }
    }
    if (session !== s) return;
    const isHls = /\.m3u8(\?|#|$)/i.test(url) || /mpegurl/i.test(o.mime || '');
    if (isHls && !v.canPlayType('application/vnd.apple.mpegurl') && G.Hls && G.Hls.isSupported()) {
      s.hls = new G.Hls();
      s.hls.on(G.Hls.Events.ERROR, (ev, d) => { if (d && d.fatal) failed(); });
      s.hls.on(G.Hls.Events.AUDIO_TRACKS_UPDATED, drawButtons);
      s.hls.loadSource(url);
      s.hls.attachMedia(v);
    } else v.src = url;

    // ---------- resume
    const rp = resumeOf(s.key);
    let lastSave = 0;
    v.addEventListener('loadedmetadata', () => {
      say('');
      if (rp && v.duration && rp.t < v.duration * 0.95) {
        v.currentTime = rp.t;
        say(t('pl_resume', clock(rp.t)));
        const b = TN.button('btn ghost', t('pl_start'), () => { v.currentTime = 0; b.remove(); say(''); });
        msg.append(' ', b);
      }
      drawButtons();
    }, {once: true});
    v.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - lastSave > 5000 && v.duration) { lastSave = now; saveResume(s.key, v.currentTime, v.duration); }
    });
    v.addEventListener('pause', () => v.duration && saveResume(s.key, v.currentTime, v.duration));
    v.addEventListener('ended', () => { saveResume(s.key, v.duration, v.duration); if (s.nextReq) showNext(true); });
    v.addEventListener('error', () => failed());
    if (tgp && tgh && tgh.playable === 'no') failed();

    function failed() {
      if (session !== s || s.failed) return;
      s.failed = true;
      say(t('pl_fail'));
      if (tgp) tgActions();
      if (o.back) msg.append(' ', TN.button('btn ghost', t('pl_other'), () => o.back()));
    }
    function tgActions() {
      if (!tgp) return;
      const link = (tgh && tgh.tgLink) || '';
      msg.append(' ', TN.button('btn ghost', t('pl_tg_dl'), async () => {
        say(t('pl_loading'));
        try {
          const f = await tgp.fallback(o.tg.message ? {message: o.tg.message} : {peer: o.tg.chat_username || o.tg.chat_id, msg: o.tg.msg_id});
          if (session !== s) { f.revoke && f.revoke(); return; }
          if (f.kind === 'blob') { s.cleanup.push(f.revoke); s.failed = false; v.src = f.url; say(''); } else if (f.url) window.open(f.url, '_blank', 'noopener');
        } catch (e) { say(t('pl_fail')); }
      }));
      if (link) msg.insertAdjacentHTML('beforeend', ` <a class="btn ghost" target="_blank" rel="noopener" href="${esc(link)}">${esc(t('pl_tg_open'))}</a>`);
    }

    // ---------- next episode
    if (o.next) {
      Promise.resolve().then(o.next).then((n) => { if (session === s && n) { s.nextReq = n; drawButtons(); } }).catch(() => {});
    }
    async function showNext() {
      const src = await TN.provider('sources');
      const n = s.nextReq;
      end();
      if (src && n) src.open(n);
    }

    // ---------- menus
    function audioTracks() {
      if (s.hls && s.hls.audioTracks && s.hls.audioTracks.length > 1) {
        return s.hls.audioTracks.map((a, i) => ({label: a.name || a.lang || t('pl_track', i + 1), on: s.hls.audioTrack === i, pick: () => { s.hls.audioTrack = i; }}));
      }
      const at = v.audioTracks;
      if (at && at.length > 1) {
        return Array.from(at).map((a, i) => ({label: a.label || a.language || t('pl_track', i + 1), on: a.enabled,
          pick: () => { for (let j = 0; j < at.length; j++) at[j].enabled = j === i; }}));
      }
      return [];
    }
    function showMenu(items) {
      if (!menu.hidden && menu.dataset.k === items.k) { menu.hidden = true; return; }
      menu.dataset.k = items.k;
      menu.innerHTML = '';
      items.list.forEach((it) => {
        const b = TN.button('btn ghost', it.label, () => { it.pick(); if (!it.stay) menu.hidden = true; else showMenu(Object.assign(items.again(), {k: ''})); });
        b.setAttribute('aria-pressed', it.on ? 'true' : 'false');
        b.dir = 'auto';
        menu.append(b);
      });
      menu.hidden = false;
      const f = menu.querySelector('[aria-pressed="true"]') || menu.querySelector('button');
      if (f) f.focus();
    }
    const speedMenu = () => ({k: 'speed', list: [0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => ({label: r + '×', on: v.playbackRate === r, pick: () => { v.playbackRate = r; }}))});
    function subsMenu() {
      const list = [{label: t('pl_subs_off'), on: s.curSub < 0, pick: () => setSub(-1)}];
      s.subs.forEach((x, i) => list.push({label: [x.label, x.lang].filter(Boolean).join(' · '), on: s.curSub === i, pick: () => setSub(i)}));
      if (s.curSub >= 0) {
        list.push({label: '−0.5s', stay: true, on: false, pick: () => { s.offset -= 0.5; setSub(s.curSub); }, });
        list.push({label: t('pl_offset', s.offset.toFixed(1)), on: false, stay: true, pick: () => { s.offset = 0; setSub(s.curSub); }});
        list.push({label: '+0.5s', stay: true, on: false, pick: () => { s.offset += 0.5; setSub(s.curSub); }});
      }
      list.push({label: t('pl_subs_find'), on: false, pick: findSubs});
      return {k: 'subs', list, again: subsMenu};
    }
    async function findSubs() {
      say(t('pl_loading'));
      const m = o.meta || {};
      const provs = await TN.providers('subs').catch(() => []);
      const got = await Promise.all(provs.map((p) => Promise.resolve(p.find && p.find({imdb: m.imdb || '', tmdb: m.id || '', season: m.season, episode: m.episode,
        lang: TN.lang(), title: m.title || o.title || ''})).catch(() => [])));
      if (session !== s) return;
      const seen = new Set(s.subs.map((x) => x.label));
      got.flat().filter(Boolean).forEach((x) => { if (!seen.has(x.label)) { seen.add(x.label); s.subs.push(x); } });
      say(s.subs.length ? '' : t('pl_subs_none'));
      showMenu(Object.assign(subsMenu(), {k: ''}));
    }
    async function setSub(i) {
      s.curSub = i;
      Array.from(v.querySelectorAll('track')).forEach((el) => { if (el.src.startsWith('blob:')) URL.revokeObjectURL(el.src); el.remove(); });
      if (i < 0) return;
      const x = s.subs[i];
      try {
        if (x.vtt == null) x.vtt = await x.fetchVtt();
        if (session !== s || s.curSub !== i) return;
        const tr = document.createElement('track');
        tr.kind = 'subtitles'; tr.label = x.label || 'sub'; tr.srclang = x.lang || ''; tr.default = true;
        tr.src = URL.createObjectURL(new Blob([shiftVtt(String(x.vtt), s.offset)], {type: 'text/vtt'}));
        v.append(tr);
        tr.track.mode = 'showing';
      } catch (e) { say(t('pl_subs_none')); }
    }
    s.cleanup.push(() => v.querySelectorAll('track').forEach((el) => el.src.startsWith('blob:') && URL.revokeObjectURL(el.src)));
    function drawButtons() {
      if (session !== s) return;
      btns.innerHTML = '';
      const a = audioTracks();
      if (a.length) btns.append(TN.button('btn ghost', '🔊 ' + t('pl_audio'), () => showMenu({k: 'audio', list: audioTracks()})));
      btns.append(TN.button('btn ghost', '⏩ ' + t('pl_speed'), () => showMenu(speedMenu())));
      btns.append(TN.button('btn ghost', '💬 ' + t('pl_subs'), () => showMenu(subsMenu())));
      if (s.nextReq) btns.append(TN.button('btn', t('pl_next'), showNext));
      if (o.back) btns.append(TN.button('btn ghost', t('pl_other'), () => { end(); o.back(); }));
    }
    drawButtons();
    if (s.subs.length) setSub(0);
    v.play && v.play().catch(() => {});
    return {video: v, close: end};
  }

  TN.registerProvider('player', {kinds: ['service'], label: 'Player', open, close: end, resumeOf, saveResume, shiftVtt, clock});
})(self);
