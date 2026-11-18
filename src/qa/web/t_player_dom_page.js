'use strict';
// The scenarios of t_player_dom.js: the real web/player.js + subs.js + srt.js in a browser, TN mocked, media = a sound
// file made here (so no codec or network is needed). Reports "ok N name" / "FAIL N name" lines to POST /result.
(async function () {
  const lines = [];
  let n = 0;
  const ok = (c, name) => { lines.push((c ? 'ok ' : 'FAIL ') + (++n) + ' ' + name); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 6000)) { try { const v = fn(); if (v) return v; } catch (e) { /* not yet */ } await sleep(40); } return null; };
  const report = () => fetch('/result', {method: 'POST', body: lines.join('\n')});
  addEventListener('error', (e) => lines.push('FAIL uncaught: ' + e.message + ' @' + String(e.filename).split('/').pop() + ':' + e.lineno));
  addEventListener('unhandledrejection', (e) => lines.push('FAIL unhandled rejection: ' + String((e.reason && e.reason.stack) || e.reason).slice(0, 300)));
  setTimeout(() => { lines.push('FAIL the scenarios did not finish in 80 s'); report(); }, 80000);

  // ---------------------------------------------------------------- TN mock
  const texts = {}, store = {}, cfg = {}, providers = {}, listeners = {}, hist = [], went = [], opened = [];
  const emit = (ev, d) => (listeners[ev] || []).forEach((f) => f(d));
  const TN = {
    i18n: {add(t) { Object.assign(texts, t.en); }},
    t(k, ...a) { let s = texts[k] || k; a.forEach((x) => { s = s.replace('%s', x); }); return s; },
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])),
    lang: () => 'en', rtl: () => false, version: 'test',
    get: (k, d) => (k in store ? JSON.parse(JSON.stringify(store[k])) : d), put: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); }, drop: (k) => { delete store[k]; },
    settings: {get: (k, d) => (k in cfg ? cfg[k] : d), set(k, v) { cfg[k] = v; emit('settings', k); }, synced: () => ({}), helper: () => ''},
    registerProvider(name, impl) { impl.name = name; providers[name] = impl; },
    provider: async (name) => providers[name] || null,
    providers: async (kind) => Object.values(providers).filter((p) => (p.kinds || []).includes(kind)),
    providerOn: () => true, setProviderOn() {},
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }, emit,
    loadScript: (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.append(s); }),
    load: async () => {}, httpsOnly: (u) => u, stopRadio() {}, noteHistory(e) { hist.push(e); },
    store: {history: () => [{key: 'movie:1', label: 'Old label', play: 'plugin://plugin.video.nova/?a=play&m=movie&id=1', plot: 'Kodi plot', thumb: '', fanart: 'https://img.example/f.jpg'}]},
    button(cls, text, on) { const b = document.createElement('button'); b.className = cls; b.textContent = text; b.onclick = on; return b; },
    go(h) { went.push(h); }, here: () => ({key: 'x', arg: '', rest: []}), view: () => document.body, tmdb: async () => ({}), addTitleAction() {}, addHistoryHandler() {},
  };
  self.TN = TN;
  providers.sources = {kinds: ['service'], name: 'sources', open(req) { opened.push(req); }};
  try {
    await TN.loadScript('/web/srt.js');
    await TN.loadScript('/web/subs.js');
    await TN.loadScript('/web/player.js');
  } catch (e) { lines.push('FAIL scripts: ' + e.message); return report(); }
  const P = providers.player, S = providers.subs;
  ok(P && S && self.TNSrt, 'player.js, subs.js and srt.js load and register');

  // a 200 s sound file (8 kHz, 8 bit): a finite length, seekable, no codec question
  function wav(seconds) {
    const rate = 8000, len = rate * seconds, b = new Uint8Array(44 + len), d = new DataView(b.buffer);
    const put = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
    put(0, 'RIFF'); d.setUint32(4, 36 + len, true); put(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
    d.setUint32(24, rate, true); d.setUint32(28, rate, true); d.setUint16(32, 1, true); d.setUint16(34, 8, true); put(36, 'data'); d.setUint32(40, len, true);
    b.fill(128, 44);
    return b;
  }
  const media = URL.createObjectURL(new Blob([wav(200)], {type: 'audio/wav'}));
  const junk = URL.createObjectURL(new Blob([crypto.getRandomValues(new Uint8Array(4000))], {type: 'video/mp4'}));
  const rootEl = () => document.querySelector('.pl-root');
  const cardEl = () => { const c = document.querySelector('.pl-card'); return c && !c.hidden ? c : null; };
  const byText = (scope, re) => Array.from(scope.querySelectorAll('button,a')).find((b) => re.test(b.textContent));
  const key = (k, more) => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', Object.assign({key: k, bubbles: true, cancelable: true}, more)));
  let leaked = 0;
  document.addEventListener('keydown', () => { leaked++; });
  const HE_VTT = 'WEBVTT\n\n00:00:01.000 --> 00:03:00.000\nשלום לכולם וברוכים הבאים\n';

  try {
    // ---------------------------------------------------------------- A. the overlay, history, subtitles, keys
    document.getElementById('opener').focus();
    let backCalled = 0;
    const h = await P.open({url: media, mime: 'audio/wav', title: 'Test film', sub: '2020', resumeKey: 'movie:1',
      history: {key: 'movie:1', label: 'Test film', thumb: '', plot: '', play: ''}, meta: {type: 'movie', title: 'Test film'},
      subs: [{label: 'Given he', lang: 'he', vtt: HE_VTT}], back: () => { backCalled++; }});
    const root = rootEl(), v = h.video;
    ok(root && root.getAttribute('role') === 'dialog' && root.getAttribute('aria-modal') === 'true' && !v.controls && getComputedStyle(root).position === 'fixed', 'A: an overlay of its own over the window, no native controls');
    ok(['.pl-play', '.pl-rew', '.pl-fwd', '.pl-seek', '.pl-mute', '.pl-vol', '.pl-subs', '.pl-audio', '.pl-gear', '.pl-full', '.pl-back', '.pl-other'].every((c) => root.querySelector(c)), 'A: every control exists');
    ok(Array.from(root.querySelectorAll('.pl-btn')).every((b) => b.getAttribute('aria-label')), 'A: every button has a name for screen readers');
    ok(root.querySelector('.pl-titles b').textContent === 'Test film' && root.querySelector('.pl-titles span').textContent === '2020', 'A: title and second line');
    ok(hist.length === 0, 'A: no history entry before the picture starts');
    ok(await until(() => !v.paused && v.currentTime > 0.2), 'A: it plays');
    ok(hist.length === 1 && hist[0].key === 'movie:1' && hist[0].label === 'Test film' && /a=play/.test(hist[0].play) && hist[0].plot === 'Kodi plot' && /f\.jpg/.test(hist[0].fanart),
      'A: one history entry at the start; the play address / plot / fanart Kodi wrote are kept');
    ok(await until(() => v.textTracks.length === 1 && v.textTracks[0].mode === 'showing' && S.current(v) && S.current(v).label === 'Given he'), 'A: the subtitle that came with the video is on, through subs.js');
    ok(history.state && history.state.tnPlayer, 'A: the player has its own history entry (the Back button closes it)');
    ok(root.querySelector('.pl-seek').getAttribute('aria-valuemax') === '200' && /3:20/.test(root.querySelector('.pl-dur').textContent), 'A: the seek bar knows the length');
    ok(root.querySelector('.pl-pip').hidden || true, 'A: picture-in-picture button only where the browser has it');
    let t0 = v.currentTime;
    key('ArrowRight');
    ok(await until(() => v.currentTime > t0 + 8, 2500), 'A: Right = 10 s forward');
    t0 = v.currentTime; key('ArrowLeft');
    ok(await until(() => v.currentTime < t0 - 5, 2500), 'A: Left = 10 s back');
    key(' '); ok(await until(() => v.paused), 'A: Space pauses');
    key('k'); ok(await until(() => !v.paused), 'A: K plays');
    key('m'); ok(v.muted === true, 'A: M mutes'); key('m'); ok(v.muted === false, 'A: M again unmutes');
    key('ArrowDown'); ok(v.volume < 1 && store.player_vol && store.player_vol.v === v.volume, 'A: Down lowers the volume and it is remembered');
    key('ArrowUp');
    key('>'); ok(v.playbackRate === 1.25, 'A: > speeds up'); key('<'); ok(v.playbackRate === 1, 'A: < back to normal');
    key('ל', {code: 'KeyK'}); ok(await until(() => v.paused), 'A: K on a Hebrew keyboard layout'); key('k'); await until(() => !v.paused);
    key('MediaPlayPause'); ok(await until(() => v.paused), 'A: the remote\'s play / pause key');
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Unidentified', keyCode: 415, bubbles: true})); ok(await until(() => !v.paused), 'A: TV remote Play (415)');
    // the subtitle panel
    key('s');
    const panel = root.querySelector('.pl-panel');
    ok(!panel.hidden && panel.querySelectorAll('.pl-prow').length >= 4 && panel.contains(document.activeElement), 'A: S opens the subtitle panel and the focus is in it');
    ok(Array.from(panel.querySelectorAll('.pl-prow[aria-checked="true"]')).some((b) => /Given he/.test(b.textContent)), 'A: the showing subtitle is marked');
    const f1 = document.activeElement; key('ArrowDown');
    ok(document.activeElement !== f1 && panel.contains(document.activeElement), 'A: the arrows move inside the panel');
    key('ArrowUp');
    byText(panel, /^\+0\.5$/).click();
    ok(S.offset(v) === 0.5 && store.subs_offsets && store.subs_offsets['movie:1'].o === 0.5, 'A: timing +0.5 s, remembered for this video only');
    ok(/\+0\.5/.test(panel.querySelector('.pl-val').textContent), 'A: the panel shows the offset');
    byText(panel, /^Yellow$/).click();
    ok(cfg.subs_color === 'yellow' && /#ffeb3b/.test(document.getElementById('subs-style').textContent), 'A: appearance: colour applied to the cues and kept');
    byText(panel, /^Large$/).click();
    ok(cfg.subs_size === 'l' && /130%/.test(document.getElementById('subs-style').textContent), 'A: appearance: size');
    byText(panel, /Subtitle settings, keys/).click();
    ok(panel.querySelector('#subs_s_osk') && panel.querySelector('#subs_s_srvu') && panel.querySelector('#subs_s_auto') && panel.querySelector('#subs_s_kt'), 'A: the settings of subs.js open inside the player (key, server, automatic, Ktuvit)');
    const osk = panel.querySelector('#subs_s_osk');
    osk.focus(); const wasPaused = v.paused; key('k'); key(' ');
    ok(v.paused === wasPaused, 'A: typing in a field is not taken as player keys');
    osk.value = 'abc123key'; panel.querySelector('#subs_s_os').dispatchEvent(new Event('submit', {cancelable: true, bubbles: true}));
    ok(cfg.subs_os_key === 'abc123key' && !/abc123key/.test(panel.innerHTML), 'A: the OpenSubtitles key is saved and not shown back');
    let srv = panel.querySelector('#subs_s_srvu');
    srv.value = 'http://192.168.1.5:8765'; panel.querySelector('#subs_s_srv').dispatchEvent(new Event('submit', {cancelable: true, bubbles: true}));
    ok(!cfg.subs_server_url && /https/.test(panel.querySelector('#subs_s_srv [role=status]').textContent), 'A: an http AI-server address is refused with the reason');
    srv = panel.querySelector('#subs_s_srvu');
    srv.value = 'https://subs.example.net/'; panel.querySelector('#subs_s_srv').dispatchEvent(new Event('submit', {cancelable: true, bubbles: true}));
    ok(cfg.subs_server_url === 'https://subs.example.net', 'A: the AI subtitle server address is saved');
    panel.querySelector('#subs_s_auto').focus();
    key('Escape'); ok(!panel.hidden && !panel.querySelector('#subs_s_osk') && panel.querySelector('.pl-prow'), 'A: Escape goes back from the settings to the subtitle list');
    key('Escape'); ok(panel.hidden && rootEl(), 'A: Escape closes the panel, not the player');
    key('c'); ok(await until(() => !S.current(v) && v.textTracks.length === 0), 'A: C turns the subtitles off');
    key('c'); ok(await until(() => S.current(v) && S.current(v).label === 'Given he'), 'A: C turns the same subtitle on again');
    ok(S.offset(v) === 0.5, 'A: the remembered timing comes back with it');
    key('a'); ok(!panel.hidden && /sound track/.test(panel.textContent), 'A: A opens the audio panel; with no choice it says why');
    key('Escape');
    root.querySelector('.pl-gear').click();
    ok(!panel.hidden && byText(panel, /^1\.5×$/) && byText(panel, /Fill the screen/), 'A: playback settings: speed and picture');
    byText(panel, /^1\.5×$/).click(); ok(v.playbackRate === 1.5, 'A: speed chip'); byText(panel, /^Normal$/).click();
    byText(panel, /Fill the screen/).click(); ok(root.classList.contains('pl-cover'), 'A: fill the screen');
    key('Escape');
    key('5'); ok(await until(() => Math.abs(v.currentTime - 100) < 4), 'A: 5 jumps to the middle');
    ok(leaked === 0, 'A: no key reaches the page under the player (' + leaked + ')');
    root.focus();
    ok(await until(() => root.classList.contains('pl-idle'), 5000), 'A: the controls hide by themselves while it plays');
    root.dispatchEvent(new MouseEvent('mousemove', {bubbles: true}));
    ok(!root.classList.contains('pl-idle'), 'A: any movement shows them');
    v.pause(); await sleep(3400);
    ok(!root.classList.contains('pl-idle'), 'A: they stay while paused');
    ok(!navigator.mediaSession || (navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === 'Test film'), 'A: Media Session carries the title');
    // Tab stays inside
    for (let i = 0; i < 30; i++) { key('Tab'); const a = document.activeElement; if (a && a !== document.body && !root.contains(a)) { ok(false, 'A: Tab left the player'); break; } }
    root.querySelector('.pl-other').click();
    ok(await until(() => backCalled === 1 && !rootEl()), 'A: "Another link" closes the player and calls back');
    ok(store.player_resume && store.player_resume['movie:1'].t >= 95 && store.player_resume['movie:1'].d === 200 && store.player_resume['movie:1'].at > 0, 'A: the resume point is kept as {t, d, at}');
    ok(await until(() => !(history.state && history.state.tnPlayer)), 'A: its history entry is gone');
    ok(document.activeElement && document.activeElement.id === 'opener', 'A: the focus returns to where it was');

    // ---------------------------------------------------------------- B. resume card, the browser's Back
    const h2 = await P.open({url: media, mime: 'audio/wav', title: 'Test film', resumeKey: 'movie:1'});
    const rc = await until(cardEl);
    ok(rc && /Resuming from 1:\d\d/.test(rc.textContent) && rc.contains(document.activeElement) && /Continue/.test(document.activeElement.textContent), 'B: resume card, "Continue" focused');
    ok(await until(() => h2.video.currentTime > 90), 'B: playback continues from the point');
    byText(rc, /From the start/).click();
    ok(await until(() => h2.video.currentTime < 6 && !cardEl()), 'B: "From the start"');
    ok(hist.length === 1, 'B: no history entry was asked for, none written');
    rootEl().querySelector('.pl-subs').click();
    history.back();
    ok(await until(() => rootEl() && rootEl().querySelector('.pl-panel').hidden) && history.state && history.state.tnPlayer, 'B: Back with a menu open closes the menu only');
    history.back();
    ok(await until(() => !rootEl()), 'B: Back closes the player');

    // ---------------------------------------------------------------- C. the end: watched mark, next episode
    const h3 = await P.open({url: media, mime: 'audio/wav', title: 'Show', sub: 'S01E01', resumeKey: 'tv:5:1:1', next: async () => ({type: 'tv', id: 5, season: 1, episode: 2})});
    await until(() => !h3.video.paused && h3.video.currentTime > 0.1);
    ok(await until(() => !rootEl().querySelector('.pl-next').hidden), 'C: "Next episode" button when there is one');
    key('End');
    const nc = await until(() => cardEl() && /Next episode/.test(cardEl().textContent) && cardEl(), 4000);
    ok(nc && byText(nc, /Play now/), 'C: next-episode card in the last 30 s');
    const cc = await until(() => cardEl() && /Next episode in \d+/.test(cardEl().textContent) && cardEl(), 9000);
    ok(cc, 'C: at the end a countdown to the next episode');
    ok(P.watched('tv:5:1:1') && P.resumeOf('tv:5:1:1') === null && store.player_resume['tv:5:1:1'].t === 200, 'C: watched to the end = a finished point (the watched mark), no resume');
    key('x');
    ok(await until(() => cardEl() && /Finished/.test(cardEl().textContent)) && opened.length === 0, 'C: any key cancels the countdown');
    byText(cardEl(), /Next episode/).click();
    ok(await until(() => opened.length === 1 && opened[0].episode === 2 && !rootEl()), 'C: the next episode goes through the sources service');
    await sleep(300);

    // ---------------------------------------------------------------- D. errors and the ways out
    let alt = 0, back = 0;
    await P.open({url: junk, mime: 'video/mp4', title: 'Bad file', back: () => { back++; }, alt: () => { alt++; }});
    const ec = await until(cardEl);
    ok(ec && /cannot play/.test(ec.textContent) && byText(ec, /Try again/) && byText(ec, /Next link/) && byText(ec, /Another link/) && byText(ec, /Close/), 'D: a file the browser cannot play: reason + try again / next link / another link');
    ok(!byText(ec, /Copy link|VLC|Kodi/), 'D: no "copy link / VLC / Kodi" for an address only this page can read');
    ok(ec.contains(document.activeElement) && /Next link/.test(document.activeElement.textContent), 'D: the focus is on the best way out');
    byText(ec, /Next link/).click();
    ok(await until(() => alt === 1 && !rootEl()), 'D: "Next link"');
    await P.open({url: junk, mime: 'video/mp4', title: 'Bad file', alt: () => { alt++; }, autoAlt: true});
    ok(await until(() => alt === 2 && !rootEl(), 5000), 'D: a failed Real-Debrid link moves to the next one by itself');
    await sleep(300);
    const dead = location.origin + '/web/no-such-file.mp4';
    await P.open({url: dead, title: 'Gone'});
    const dc = await until(cardEl);
    const vl = dc && byText(dc, /Open in VLC/), m3u = dc && byText(dc, /Playlist file/);
    ok(dc && byText(dc, /Copy link/) && vl && vl.getAttribute('href') === 'vlc://' + dead && byText(dc, /Open in Kodi/) && m3u && /^blob:/.test(m3u.href) && /\.m3u$/.test(m3u.download),
      'D: a real address: copy link, open in VLC, open in Kodi, playlist file');
    byText(dc, /Open in Kodi/).click();
    ok(cardEl() && /Kore|Play URL/.test(cardEl().textContent) && byText(cardEl(), /Copy link/), 'D: "Open in Kodi" explains the working way and keeps the buttons');
    ok(!/no-such-file/.test(cardEl().textContent), 'D: the address itself is not shown unless asked');
    byText(cardEl(), /Close/).click();
    ok(await until(() => !rootEl()), 'D: Close');
    await sleep(300);

    // ---------------------------------------------------------------- E. autoplay refused
    const realPlay = HTMLMediaElement.prototype.play;
    let refused = 0;
    HTMLMediaElement.prototype.play = function () { if (!refused++) return Promise.reject(new DOMException('no gesture', 'NotAllowedError')); return realPlay.call(this); };
    const h5 = await P.open({url: media, mime: 'audio/wav', title: 'Needs a press'});
    const bigB = await until(() => { const b = rootEl().querySelector('.pl-big'); return !b.hidden && b; });
    ok(bigB && /Press to start/.test(rootEl().textContent) && document.activeElement === bigB, 'E: autoplay refused: a large Play button with a text, focused');
    bigB.click();
    ok(await until(() => !h5.video.paused && bigB.hidden), 'E: one press starts it');
    HTMLMediaElement.prototype.play = realPlay;
    emit('route', {key: 'x', keep: true});
    ok(rootEl(), 'E: a redraw of the page keeps the player');
    emit('route', {key: 'movies'});
    ok(!rootEl(), 'E: going to another page closes it');
    await sleep(200);

    // ---------------------------------------------------------------- F. Telegram
    let mode = 'nosw', closedKeys = [], lastEvent = null;
    providers.tgplay = {kinds: ['service'], name: 'tgplay',
      async open(ref, o) {
        if (mode === 'nosw') { const e = new Error('TGPLAY_NO_SW'); e.code = 'TGPLAY_NO_SW'; throw e; }
        if (mode === 'login') { const e = new Error('TG_NO_LOGIN'); e.code = 'TG_NO_LOGIN'; throw e; }
        lastEvent = o && o.onEvent;
        return {key: 'k1', url: media, mime: 'audio/wav', size: 1000, name: 'f.mp4', tgLink: 'https://t.me/c/1/2', playable: 'yes'};
      },
      close(k) { closedKeys.push(k); },
      errorText: (e) => (e.code === 'TGPLAY_NO_SW' ? 'No streaming here' : e.code === 'TG_NO_LOGIN' ? 'Connect Telegram first' : 'Telegram error'),
      async fallback(ref, o) { o.onProgress(50); await sleep(50); o.onProgress(100); return {kind: 'blob', url: media, revoke() {}}; },
      async save() { return {saved: true, name: 'f.mp4'}; }};
    const h6 = await P.open({tg: {chat_id: -1001, msg_id: 2}, title: 'From Telegram', resumeKey: 'tg:-1001:2'});
    const tc = await until(cardEl);
    ok(tc && /No streaming here/.test(tc.textContent) && byText(tc, /Download and play here/) && byText(tc, /Save to device/), 'F: no service worker: the reason, "download and play here", "save to device"');
    byText(tc, /Download and play here/).click();
    ok(await until(() => !h6.video.paused && h6.video.currentTime > 0.1), 'F: the downloaded file plays in the same player');
    h6.close(); await sleep(300);
    mode = 'login';
    await P.open({tg: {chat_id: -1001, msg_id: 2}, title: 'From Telegram'});
    const lc = await until(cardEl);
    ok(lc && /Connect Telegram first/.test(lc.textContent) && byText(lc, /^Connect Telegram$/), 'F: not signed in: says so, with a button to the sign-in page');
    byText(lc, /^Connect Telegram$/).click();
    ok(await until(() => went.includes('tglogin') && !rootEl()), 'F: the button leads to the sign-in page');
    await sleep(300);
    mode = 'ok';
    const h7 = await P.open({tg: {chat_id: -1001, msg_id: 2}, title: 'From Telegram'});
    ok(await until(() => !h7.video.paused && h7.video.currentTime > 0.1), 'F: a Telegram stream plays');
    lastEvent({type: 'flood', seconds: 7, text: 'Telegram asks to wait 7 seconds'});
    ok(/wait 7 seconds/.test(rootEl().querySelector('.pl-status').textContent), 'F: a Telegram wait is shown');
    rootEl().querySelector('.pl-gear').click();
    const gp = rootEl().querySelector('.pl-panel');
    const tgl = byText(gp, /Open in Telegram/);
    ok(tgl && tgl.getAttribute('href') === 'https://t.me/c/1/2' && byText(gp, /Save to device/) && !byText(gp, /VLC/), 'F: ways out for a Telegram file: Telegram itself, save to device (no VLC link: the address is this page\'s)');
    h7.close();
    ok(closedKeys.includes('k1'), 'F: the stream is released when the player closes');
    await sleep(300);

    // ---------------------------------------------------------------- G. the automatic subtitle flow
    const realFind = S.find;
    let asked = null;
    const mk = (label, lang, source, text) => ({label, lang, source, score: 1, fetchVtt: async () => 'WEBVTT\n\n00:00:01.000 --> 00:01:00.000\n' + text + '\n'});
    S.find = async (q) => { asked = q; return [mk('Mislabelled', 'en', 'opensubs', 'שלום לכולם וברוכים הבאים לסרט הזה'), mk('Best en', 'en', 'opensubs', 'Hello everybody and welcome to this film'), mk('He', 'he', 'wizdom', 'שלום לכולם')]; };
    const h8 = await P.open({url: media, mime: 'audio/wav', title: 'Auto', resumeKey: 'movie:77', meta: {type: 'movie', id: 77, imdb: 'tt0000077', title: 'Auto', year: '2020', release: 'Auto.2020.1080p.WEB'}});
    ok(await until(() => S.current(h8.video) && S.current(h8.video).label === 'Best en', 5000), 'G: automatic subtitles: the best one in the viewer\'s language whose text really is that language');
    ok(asked && asked.imdb === 'tt0000077' && asked.tmdb === 77 && asked.release === 'Auto.2020.1080p.WEB' && asked.type === 'movie' && asked.url === '', 'G: the search gets the ids and the release name (and no address for a stream only this page can read)');
    key('s');
    const sp = rootEl().querySelector('.pl-panel');
    ok(await until(() => byText(sp, /Mislabelled/) && byText(sp, /^He/)) && Array.from(sp.querySelectorAll('.pl-prow[aria-checked="true"]')).some((b) => /Best en/.test(b.textContent)), 'G: the picker lists what was found, the one in use marked');
    byText(sp, /^He/).click();
    ok(await until(() => S.current(h8.video) && S.current(h8.video).label === 'He'), 'G: another subtitle chosen from the list');
    h8.close(); await sleep(300);
    cfg.subs_auto = false; asked = null;
    const h9 = await P.open({url: media, mime: 'audio/wav', title: 'Auto off', meta: {type: 'movie', id: 77, imdb: 'tt0000077', title: 'Auto'}});
    await until(() => !h9.video.paused && h9.video.currentTime > 0.3);
    await sleep(300);
    ok(asked === null && !S.current(h9.video), 'G: with automatic subtitles off nothing is searched');
    h9.close(); await sleep(300);
    S.find = realFind; delete cfg.subs_auto;

    // ---------------------------------------------------------------- H. the settings block on its own (Settings / Services page)
    const box = document.createElement('div');
    document.body.append(box);
    S.settingsPanel(box);
    ok(box.querySelector('h3') && box.querySelector('#subs_s_auto').checked && box.querySelector('#subs_s_lang') && box.querySelector('#subs_s_size').value === 'l' && box.querySelector('#subs_s_color').value === 'yellow' &&
      box.querySelector('.subs-sample span').style.color && box.querySelectorAll('input[data-src]').length === 6 && /helper/i.test(box.querySelector('#subs_s_kt').textContent), 'H: subs.settingsPanel(el): automatic, language, appearance + sample, sources, key, server, Ktuvit');
    box.querySelector('#subs_s_auto').checked = false; box.querySelector('#subs_s_auto').dispatchEvent(new Event('change'));
    box.querySelector('#subs_s_lang').value = 'ru'; box.querySelector('#subs_s_lang').dispatchEvent(new Event('change'));
    ok(cfg.subs_auto === false && cfg.subs_lang === 'ru' && S.prefLang() === 'ru' && S.autoOn() === false, 'H: the switches are kept as browser settings');
    emit('route', {key: 'settings'});
    TN.here = () => ({key: 'settings'});
    emit('route', {key: 'settings'});
    ok(await until(() => document.querySelector('#subs_settings_box #subs_s_osk'), 1500), 'H: on the Settings page the block is added by subs.js itself');
  } catch (e) {
    lines.push('FAIL exception: ' + String((e && e.stack) || e).slice(0, 500));
  }
  report();
})();
