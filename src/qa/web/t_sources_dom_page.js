'use strict';
// The scenarios of "node t_player_dom.js sources": the real web/sources.js + rd.js + helper.js + player.js + subs.js in
// a browser. TN is mocked, every request to another host is answered here (nothing leaves 127.0.0.1) and recorded, so
// the test can say where the Real-Debrid token travelled. Reports "ok N name" / "FAIL N name" to POST /result.
(async function () {
  const lines = [];
  let n = 0;
  const ok = (c, name) => { lines.push((c ? 'ok ' : 'FAIL ') + (++n) + ' ' + name); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 6000)) { try { const v = fn(); if (v) return v; } catch (e) { /* not yet */ } await sleep(40); } return null; };
  const realFetch = window.fetch.bind(window);
  const report = () => realFetch('/result', {method: 'POST', body: lines.join('\n')});
  addEventListener('error', (e) => lines.push('FAIL uncaught: ' + e.message + ' @' + String(e.filename).split('/').pop() + ':' + e.lineno));
  addEventListener('unhandledrejection', (e) => lines.push('FAIL unhandled rejection: ' + String((e.reason && e.reason.stack) || e.reason).slice(0, 300)));
  setTimeout(() => { lines.push('FAIL the scenarios did not finish in 100 s'); report(); }, 100000);

  // ---------------------------------------------------------------- the outside world, answered here
  const calls = [];                                  // {url, method, headers, body}
  const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd';
  const HASH = 'c'.repeat(40);
  let approved = false;
  const json = (o, status) => new Response(JSON.stringify(o), {status: status || 200, headers: {'Content-Type': 'application/json'}});
  window.fetch = async (input, opts) => {
    const url = String(input && input.url ? input.url : input);
    if (!/^https:\/\//i.test(url)) return realFetch(input, opts);       // this page's own files and blob: addresses
    opts = opts || {};
    const headers = {};
    new Headers(opts.headers || {}).forEach((v, k) => { headers[k] = v; });
    calls.push({url, method: opts.method || 'GET', headers, body: typeof opts.body === 'string' ? opts.body : ''});
    const u = new URL(url);
    if (u.hostname === 'torrentio.strem.fun') {
      return json({streams: [
        {name: '[RD+] Torrentio\n1080p', title: 'Film.2020.1080p.BluRay.x264.AAC.mkv\n👤 50 💾 8 GB ⚙️ X\n🇬🇧', url: 'https://torrentio.strem.fun/resolve/realdebrid/x/1/Film.mkv'},
        {name: 'Torrentio\n720p', title: 'Film.2020.720p.WEB.mkv\n👤 9 💾 1.1 GB', infoHash: HASH, fileIdx: 0, behaviorHints: {filename: 'Film.2020.720p.WEB.mkv'}}]});
    }
    if (u.hostname === 'api.real-debrid.com') {
      if (/\/device\/code$/.test(u.pathname)) return json({device_code: 'DEVICECODE1', user_code: 'ABCD1234', interval: 3, expires_in: 600, verification_url: 'https://real-debrid.com/device'});
      if (/\/device\/credentials$/.test(u.pathname)) return approved ? json({client_id: 'CID', client_secret: 'CSECRET'}) : json({error: 'pending'}, 403);
      if (/\/oauth\/v2\/token$/.test(u.pathname)) return json({access_token: 'DEVTOKEN' + 'x'.repeat(30), refresh_token: 'REFRESH', expires_in: 3600});
      if (/\/user$/.test(u.pathname)) return json({username: 'viewer', expiration: '2030-01-02T00:00:00.000Z', type: 'premium'});
      if (/\/torrents\/addMagnet$/.test(u.pathname)) return json({id: 'T1'});
      if (/\/torrents\/info\/T1$/.test(u.pathname)) return json({status: 'downloaded', progress: 100, files: [{id: 1, path: '/Film.2020.720p.WEB.mkv', bytes: 5}], links: ['https://real-debrid.com/d/L1']});
      if (/\/unrestrict\/link$/.test(u.pathname)) return json({download: 'https://dl.example.net/Film.2020.720p.WEB.mkv', filename: 'Film.2020.720p.WEB.mkv', mimeType: 'video/x-matroska', filesize: 5});
      return json({}, 404);
    }
    if (u.hostname === 'api.dailymotion.com') return json({list: [{id: 'x8abc', title: 'Film on DM', duration: 5400}]});
    return json({});
  };

  // ---------------------------------------------------------------- TN mock
  const texts = {}, store = {}, cfg = {}, providers = {}, listeners = {}, titleActions = [], histHandlers = [], ytPlayed = [], playerOpened = [];
  const emit = (ev, d) => (listeners[ev] || []).forEach((f) => f(d));
  const sheet = document.getElementById('sheet'), modalEl = document.getElementById('modal');
  const TN = {
    i18n: {add(t) { Object.assign(texts, t.en); }},
    t(k, ...a) { let s = texts[k] || k; a.forEach((x) => { s = s.replace('%s', x); }); return s; },
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])),
    lang: () => 'en', rtl: () => false, version: 'test',
    get: (k, d) => (k in store ? JSON.parse(JSON.stringify(store[k])) : d), put: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); }, drop: (k) => { delete store[k]; },
    settings: {get: (k, d) => (k in cfg ? cfg[k] : d), set(k, v) { cfg[k] = v; emit('settings', k); }, synced: () => ({}), helper: () => cfg.helper || ''},
    registerProvider(name, impl) { impl.name = name; impl.kinds = [].concat(impl.kinds || []); providers[name] = impl; },
    provider: async (name) => providers[name] || null,
    providers: async (kind) => Object.values(providers).filter((p) => (p.kinds || []).includes(kind)),
    providerOn: () => true, setProviderOn() {},
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }, emit,
    loadScript: (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = /^\//.test(src) ? src : '/web/' + src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.append(s); }),
    load: async () => {}, httpsOnly: (u) => u, stopRadio() {}, noteHistory() {}, store: {history: () => []},
    button(cls, text, on) { const b = document.createElement('button'); b.className = cls; b.textContent = text; b.onclick = on; return b; },
    modal(html) { sheet.innerHTML = html; modalEl.hidden = false; }, closeModal() { sheet.innerHTML = ''; modalEl.hidden = true; },
    go() {}, here: () => ({key: 'x', arg: '', rest: []}), view: () => document.body, link: () => '#/x',
    hasTmdbKey: () => false, tmdb: async () => ({}), tmdbImg: () => '', archive: async () => [], openTitle() {}, openArchive() {},
    addTitleAction(f) { titleActions.push(f); }, addHistoryHandler(f) { histHandlers.push(f); },
  };
  self.TN = TN;
  try {
    for (const f of ['srt.js', 'subs.js', 'player.js', 'rd.js', 'sources.js']) await TN.loadScript(f);
  } catch (e) { lines.push('FAIL scripts: ' + e.message); return report(); }
  const SRC = providers.sources, RD = providers.rd, PL = providers.player;
  ok(SRC && RD && PL && titleActions.length === 1 && histHandlers.length === 1, 'sources.js / rd.js load; the Play button of the title sheet and the history handler are registered');

  function wav(seconds) {
    const rate = 8000, len = rate * seconds, b = new Uint8Array(44 + len), d = new DataView(b.buffer);
    const put = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
    put(0, 'RIFF'); d.setUint32(4, 36 + len, true); put(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
    d.setUint32(24, rate, true); d.setUint32(28, rate, true); d.setUint16(32, 1, true); d.setUint16(34, 8, true); put(36, 'data'); d.setUint32(40, len, true);
    b.fill(128, 44);
    return b;
  }
  const byText = (scope, re) => Array.from(scope.querySelectorAll('button,a')).find((b) => re.test(b.textContent));
  const rowOf = (re) => Array.from(sheet.querySelectorAll('.src_row')).find((b) => re.test(b.textContent));
  const hevcHead = () => { const b = new Uint8Array(4096); b.set([0x1a, 0x45, 0xdf, 0xa3]); const s = 'matroska V_MPEGH/ISO/HEVC A_AC3 S_TEXT/UTF8'; for (let i = 0; i < s.length; i++) b[64 + i] = s.charCodeAt(i); return b; };

  try {
    // the other packages' providers, as they answer today
    providers.yt = {kinds: ['source'], name: 'yt', label: 'YouTube', async sources() { return [{label: 'Film - full movie', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', size: '1:32:10', quality: 0, lang: ''}]; }, play(v) { ytPlayed.push(v); }};
    providers.tgsearch = {kinds: ['search', 'source'], name: 'tgsearch', label: 'Telegram', async sources() {
      return [{label: 'Film.2020.1080p.WEB-DL.H264.AAC.HEB.mkv', quality: 1080, lang: 'he', size: 2147483648, tg: {chat_id: -1001, msg_id: 5}},
        {label: 'Film.2020.2160p.HEVC.DV.Atmos.mkv', quality: 2160, lang: '', size: 9e9, tg: {chat_id: -1001, msg_id: 7}},
        {label: 'Film.2020.HDCAM.x264.mkv', quality: 720, lang: '', size: 9e8, tg: {chat_id: -1001, msg_id: 6}}]; }};
    providers.tgplay = {kinds: ['service'], name: 'tgplay', async probe(ref) { if (ref.msg === 7) return {head: hevcHead(), mbit: 42.5}; if (ref.msg === 6) throw new Error('gone'); return {head: wav(1), mbit: 12}; }};
    const realOpen = PL.open;
    PL.open = async (o) => { playerOpened.push(o); return {video: null, close() {}}; };

    // ---------------------------------------------------------------- A. the sheet without Real-Debrid
    const req = {type: 'movie', id: 603, title: 'Film', year: '2020', imdb: 'tt0133093', poster: ''};
    await SRC.pick(req);
    ok(!modalEl.hidden && sheet.querySelectorAll('.src_row').length === 4, 'A: rows: 2 Telegram + YouTube + Dailymotion (the CAM copy hidden by the default filter)');
    ok(!/NaN/.test(sheet.textContent), 'A: no "NaN MB" anywhere');
    const yt = rowOf(/full movie/);
    ok(yt && /Length 1:32:10/.test(yt.textContent) && /YouTube/.test(yt.querySelector('.src_st').textContent), 'A: the YouTube row shows its running time and says YouTube');
    const tg = rowOf(/1080p\.WEB-DL/);
    const badges = Array.from(tg.querySelectorAll('.src_bd')).map((b) => b.textContent);
    ok(['1080p', 'H.264', 'AAC', 'WEB', 'HE', '2.0 GB'].every((x) => badges.includes(x)), 'A: badges: quality, codec, audio, source, language, size (' + badges.join(' ') + ')');
    const uhd = Array.from(rowOf(/2160p/).querySelectorAll('.src_bd')).map((b) => b.textContent);
    ok(['4K', 'HEVC', 'DV', 'Atmos'].every((x) => uhd.includes(x)), 'A: 4K / HEVC / Dolby Vision / Atmos badges');
    ok(/1 links are hidden/.test(sheet.textContent) && byText(sheet, /Show all/), 'A: says how many links the filters hide, with "Show all"');
    const heads = Array.from(sheet.querySelectorAll('.src_g')).map((h) => h.textContent.replace(/\s*\(\d+\)/, ''));
    ok(heads.join('|') === 'Telegram|YouTube|Dailymotion', 'A: groups in the build\'s order, Telegram first (' + heads.join('|') + ')');
    ok(sheet.querySelectorAll('.src_row')[0] === tg, 'A: inside Telegram the provider\'s own order is kept');
    yt.click();
    ok(await until(() => ytPlayed.length === 1 && ytPlayed[0].id === 'dQw4w9WgXcQ') && playerOpened.length === 0, 'A: a YouTube row opens the YouTube player, never <video>');
    const opens = [];
    const realWinOpen = window.open; window.open = (u) => { opens.push(u); return null; };
    rowOf(/Film on DM/).click();
    ok(opens[0] === 'https://www.dailymotion.com/video/x8abc' && /new tab/.test(rowOf(/Film on DM/).textContent), 'A: a Dailymotion row says it opens in a new tab, and does');
    window.open = realWinOpen;
    // the link test
    byText(sheet, /Test links/).click();
    ok(await until(() => /Works/.test(sheet.textContent) && /does not play/.test(sheet.textContent) && !byText(sheet, /^Stop$/), 8000), 'A: "Test links" ran');
    const tested = rowOf(/1080p\.WEB-DL/), bad = rowOf(/2160p/);
    ok(/Works · 12 Mbit/.test(tested.textContent), 'A: a tested link shows its speed');
    ok(/A codec this browser does not play/.test(bad.textContent) && /HEVC/.test(bad.textContent) && /AC3/.test(bad.textContent), 'A: the file header says HEVC + AC3: marked as not playable here');
    ok(sheet.querySelectorAll('.src_row')[0] === tested, 'A: tested-good links come first');
    byText(sheet, /Show all/).click();
    const cam = rowOf(/HDCAM/);
    ok(cam && Array.from(cam.querySelectorAll('.src_bd.warn')).some((b) => b.textContent === 'CAM'), 'A: "Show all" brings the CAM copy back, marked');
    byText(sheet, /Play the best one/).click();
    ok(await until(() => playerOpened.length === 1) && playerOpened[0].tg.msg_id === 5 && playerOpened[0].resumeKey === 'movie:603' && playerOpened[0].history.key === 'movie:603' &&
      /a=play/.test(playerOpened[0].history.play) && playerOpened[0].meta.imdb === 'tt0133093' && /1080p\.WEB-DL/.test(playerOpened[0].meta.release) && typeof playerOpened[0].back === 'function',
    'A: "Play the best one": the tested Telegram link, with the resume key, history entry, ids and release name for the subtitles');
    ok(typeof playerOpened[0].alt === 'function', 'A: the player gets the next link to fall back to');

    // ---------------------------------------------------------------- B. settings: filters, Real-Debrid sign-in, subtitles
    await SRC.pick(req, {noAuto: true});
    sheet.querySelector('#src_set').click();
    const box = sheet.querySelector('#src_setbox');
    ok(await until(() => box.querySelector('#rd_dev') && box.querySelector('#rd_in')) && box.querySelector('#src_fq') && box.querySelector('#src_fa') && box.querySelector('#src_ai'), 'B: settings: filters, addon servers, the Real-Debrid panel');
    ok(box.querySelector('#rd_in').type === 'password' && /Not signed in/.test(box.textContent), 'B: Real-Debrid: not signed in, the token field hides what is typed');
    box.querySelector('#rd_in').value = 'short'; box.querySelector('#rd_f').dispatchEvent(new Event('submit', {cancelable: true, bubbles: true}));
    ok(/does not look like a token/.test(box.textContent) && !store.rd_token, 'B: a wrong token is refused');
    // the device code
    calls.length = 0;
    box.querySelector('#rd_dev').click();
    const code = await until(() => box.querySelector('.rd_code'));
    ok(code && code.textContent === 'ABCD1234' && byText(box, /Open the site/).getAttribute('href') === 'https://real-debrid.com/device' && /Waiting for the approval/.test(box.textContent), 'B: device sign-in: the code, the site link, waiting');
    approved = true;
    ok(await until(() => RD.hasToken() && /Signed in/.test(box.textContent), 9000), 'B: after the approval on the site the browser is signed in');
    ok(store.rd_auth && store.rd_auth.refresh === 'REFRESH' && !/DEVTOKEN|CSECRET|REFRESH/.test(sheet.innerHTML), 'B: the token is kept for renewal and never drawn on the page');
    ok(await until(() => /viewer/.test(box.textContent) && /2030-01-02/.test(box.textContent)), 'B: the account name and the premium date are shown');
    ok(calls.filter((c) => /api\.real-debrid\.com\/rest/.test(c.url)).every((c) => /^Bearer /.test(c.headers.authorization || '') && !/DEVTOKEN/.test(c.url)), 'B: the REST calls carry the token in the Authorization header only');
    byText(box, /Sign out and remove/).click();
    ok(!RD.hasToken() && !store.rd_token && !store.rd_auth, 'B: sign out removes everything');
    // a pasted token
    const inp = await until(() => box.querySelector('#rd_in'));
    inp.value = TOKEN; box.querySelector('#rd_f').dispatchEvent(new Event('submit', {cancelable: true, bubbles: true}));
    ok(RD.hasToken() && store.rd_token === TOKEN && !sheet.innerHTML.includes(TOKEN), 'B: a pasted token is saved and not shown back');
    ok(box.querySelector('#rd_km').checked && /only inside the address path/.test(box.textContent), 'B: the Torrentio key mode says plainly where the key travels');
    box.querySelector('#src_sb').click();
    ok(await until(() => box.querySelector('#src_subs #subs_s_osk') && box.querySelector('#src_subs #subs_s_srvu')), 'B: the subtitle settings (key, AI server) open from the source settings');
    box.querySelector('#src_fq').value = '1080'; box.querySelector('#src_fq').dispatchEvent(new Event('change'));
    ok(cfg.sources_minq === 1080, 'B: the minimum quality is kept');
    cfg.sources_minq = 0;

    // ---------------------------------------------------------------- C. Real-Debrid rows; where the token goes
    calls.length = 0;
    await SRC.pick(req, {noAuto: true});
    const cached = rowOf(/BluRay\.x264/), tor = rowOf(/720p\.WEB/);
    ok(cached && tor && /Ready/.test(cached.querySelector('.src_st').textContent) && /Checked at RD/.test(tor.querySelector('.src_st').textContent), 'C: Torrentio rows: ready (cached) and "RD is asked when chosen"');
    ok(Array.from(cached.querySelectorAll('.src_bd')).some((b) => b.textContent === '8.0 GB') && /👤 50/.test(cached.textContent) && /EN/.test(cached.textContent), 'C: size, seeds and language from the Torrentio text');
    const tcall = calls.find((c) => /torrentio/.test(c.url));
    const tu = new URL(tcall.url);
    ok(tu.search === '' && tu.pathname.includes('/realdebrid=' + TOKEN + '/') && !tcall.headers.authorization, 'C: key mode: the token is in the address PATH of Torrentio only (its design), never in a query');
    ok(calls.every((c) => !new URL(c.url).search.includes(TOKEN)), 'C: no request has the token in a query');
    // with the helper set, the Torrentio address travels in a header to the helper instead
    cfg.helper = 'https://helper.example.workers.dev';
    calls.length = 0;
    await SRC.pick(req, {noAuto: true});
    const hc = calls.find((c) => /helper\.example/.test(c.url));
    ok(hc && hc.url === 'https://helper.example.workers.dev/p' && (hc.headers['x-tn-target'] || '').includes('/realdebrid=' + TOKEN + '/') && !calls.some((c) => /torrentio\.strem\.fun/.test(c.url)),
      'C: with the helper set the request goes to the helper (target in the X-TN-Target header), not from the browser to Torrentio');
    cfg.helper = '';
    // hash mode: Torrentio without any key
    store.rd_torrentio = false;
    calls.length = 0;
    await SRC.pick(req, {noAuto: true});
    ok(calls.filter((c) => /torrentio/.test(c.url)).every((c) => !c.url.includes(TOKEN)) && calls.some((c) => /torrentio/.test(c.url)), 'C: key mode off: Torrentio is asked without the token at all');
    // choosing the torrent row: Real-Debrid resolves it, the player gets a direct link
    playerOpened.length = 0; calls.length = 0;
    rowOf(/720p\.WEB/).click();
    ok(await until(() => playerOpened.length === 1) && playerOpened[0].url === 'https://dl.example.net/Film.2020.720p.WEB.mkv' && playerOpened[0].autoAlt === true, 'C: a torrent row plays through Real-Debrid (add, wait, unrestrict), with the automatic next link armed');
    const add = calls.find((c) => /addMagnet/.test(c.url));
    ok(add && add.method === 'POST' && add.body.includes(HASH) && add.headers.authorization === 'Bearer ' + TOKEN && !add.url.includes(TOKEN), 'C: the magnet goes in the request body, the token in the header');
    delete store.rd_torrentio;

    // ---------------------------------------------------------------- D. hooks
    const acts = document.createElement('div');
    titleActions[0](acts, {type: 'movie', id: 603, title: 'Film', detail: {release_date: '2020-05-05', imdb_id: 'tt0133093'}, poster: ''});
    ok(acts.querySelector('button') && /Play/.test(acts.querySelector('button').textContent) && acts.querySelector('button').hasAttribute('data-autofocus'), 'D: the title sheet gets a Play button, focused first');
    ok(histHandlers[0]({key: 'tv:1399:1:2', label: 'x'}) === true && (await until(() => /S01E02/.test(sheet.textContent))), 'D: a history row of an episode opens its links');
    ok(histHandlers[0]({key: 'radio:abc'}) === false, 'D: other history rows are left to their owners');
    // the Services page can draw both panels
    const sv = document.createElement('div'); document.body.append(sv);
    RD.servicesPanel(sv);
    ok(sv.querySelector('#rd_dev') && sv.querySelector('#rd_in') && /Signed in/.test(sv.textContent), 'D: rd.servicesPanel(el) draws the sign-in panel anywhere (Services page)');
    PL.open = realOpen;
  } catch (e) {
    lines.push('FAIL exception: ' + String((e && e.stack) || e).slice(0, 500));
  }
  report();
})();
