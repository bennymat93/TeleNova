'use strict';
// Package "live": web/iptv.js, web/epg.js, web/radio.js with a fake TN and a stand-in document (no network).
//   node src/qa/web/t_live.js
// Covers: playlists (parse, merge, groups, the build's restream / paid-channel rules), the build's Israeli table with
// the playlist streams added, the failover order of a channel (https, YouTube live, https copy of http, helper),
// dead-stream marks, favourites, the guide (now / next, grid span, own "live broadcast" rows, XMLTV), radio (station
// lists, name cleaning, one row per station, http-only stations, favourites, recent), that every text of the five
// modules exists in Hebrew, English and Russian, and that every Live TV / radio screen draws and its buttons work.
const path = require('path'), fs = require('fs'), vm = require('vm');
const WEB = path.join(__dirname, '..', '..', '..', 'web');
let bad = 0, n = 0;
const ok = (c, what) => { n++; if (!c) { bad++; console.log('FAIL', what); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), what + ': ' + JSON.stringify(a));

const dom = require('./live_fakedom.js').make();
const CHANNELS = JSON.parse(fs.readFileSync(path.join(WEB, 'channels_il.json'), 'utf8'));
const EPG = JSON.parse(fs.readFileSync(path.join(WEB, 'data', 'epg_il.json'), 'utf8'));

// ---- fake TN
const pages = {}, provs = {}, store = {}, cfg = {}, tables = [], histHandlers = [], went = [], radioPlayed = [], history = [], favs = [];
let lang = 'he', helperUrl = '';
const TN = Object.assign({
  i18n: {add: (tb) => tables.push(tb)}, t: (k, ...a) => k + (a.length ? ':' + a.join(',') : ''), lang: () => lang, rtl: () => lang === 'he',
  registerPage: (k, f) => { pages[k] = f; }, registerProvider: (k, v) => { provs[k] = v; }, on() { return () => {}; },
  load: async (name) => { if (!provs[name]) vm.runInContext(fs.readFileSync(path.join(WEB, name + '.js'), 'utf8'), ctx); },
  provider: async (name) => { if (!provs[name] && ['epg', 'iptv', 'radio'].includes(name)) await TN.load(name); return provs[name] || null; },
  settings: {synced: () => ({}), get: (k, d) => (k in cfg ? cfg[k] : d), set: (k, v) => { cfg[k] = v; }, helper: () => helperUrl},
  get: (k, d) => (k in store ? JSON.parse(JSON.stringify(store[k])) : d), put: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
  store: {history: () => history, favs: () => favs, art: () => '', isFav: () => false},
  addHistoryHandler: (f) => histHandlers.push(f), noteHistory: (e) => history.unshift(e),
  go: (h) => went.push(String(h)), route() {}, link: (k, p) => '#/' + k + (p ? '/' + new URLSearchParams(p) : ''), params: (a) => Object.fromEntries(new URLSearchParams(a || '')),
  playRadio: (s) => radioPlayed.push(s), stopRadio() {}, loadScript: async () => { ctx.TNHelper = {url: () => helperUrl, fetch: async () => ({ok: true})}; },
}, dom.ui);

// ---- fake network
const M3U_IL = `#EXTM3U
#EXTINF:-1 tvg-id="Kan11.il" tvg-logo="https://img.example/kan.png" group-title="General",Kan 11 (1080p)
https://stream.example/kan11/index.m3u8
#EXTINF:-1 tvg-id="Keshet12.il" tvg-logo="https://img.example/k12.png" group-title="General",Keshet 12 (720p) [Geo-blocked]
https://free.example/keshet12/master.m3u8
#EXTINF:-1 tvg-id="Keshet12.il" group-title="General",Keshet 12
http://plain.example/keshet12.m3u8
#EXTINF:-1 tvg-id="Sport5.il" group-title="Sports",Sport 5
https://paid.example/sport5.m3u8
#EXTINF:-1 tvg-id="X.il" group-title="General",Restream TV
http://12.34.56.78:8080/live/abc/def/123
#EXTINF:-1 tvg-id="Hop.il" group-title="Kids",Hop! Channel
https://x.iptvhd.ru/hop.m3u8
#EXTINF:-1 tvg-id="Docu.il" group-title="Documentary",Israel Docu HD
http://plain.example/docu.m3u8
#EXTINF:-1 tvg-id="RU1.ru" tvg-country="RU" group-title="News",Россия 24
https://ru.example/r24.m3u8
`;
const STATIONS = [
  {stationuuid: '11111111-1111-1111-1111-111111111111', name: ' Galgalatz  (128k) ', url: 'http://glz.example/glglz', url_resolved: 'https://glz.example/glglz', favicon: 'https://img.example/glz.png', country: 'Israel', countrycode: 'IL', tags: 'pop,hits', bitrate: 128},
  {stationuuid: '22222222-2222-2222-2222-222222222222', name: 'Galgalatz [MP3]', url: 'http://glz2.example/a', url_resolved: 'http://glz2.example/a', favicon: '', country: 'Israel', countrycode: 'IL', tags: 'pop', bitrate: 64},
  {stationuuid: '33333333-3333-3333-3333-333333333333', name: 'Kol Chai', url: 'http://kc.example/live', url_resolved: 'http://kc.example/live', favicon: '', country: 'Israel', countrycode: 'IL', tags: 'jewish', bitrate: 96, homepage: 'https://www.93fm.co.il/'},
  {stationuuid: '44444444-4444-4444-4444-444444444444', name: 'Reshet Bet', url: 'https://kan.example/bet', url_resolved: '', favicon: '', country: 'Israel', countrycode: 'IL', tags: 'news', bitrate: 0},
  {stationuuid: '44444444-4444-4444-4444-444444444444', name: 'Reshet Bet', url: 'https://kan.example/bet', url_resolved: ''},
  {stationuuid: '55555555-5555-5555-5555-555555555555', name: 'No stream', url: 'rtmp://x', url_resolved: ''},
];
const fetched = [];
let radioDown = 0;                                 // how many radio mirrors are "down" (first N answer 503)
async function fetchMock(u, o) {
  u = String(u);
  fetched.push(u);
  const res = (body, status = 200) => ({ok: status >= 200 && status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: {get: () => null}, body: null, arrayBuffer: async () => Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))});
  if (u === 'channels_il.json') return res(CHANNELS);
  if (u === 'data/epg_il.json') return res(EPG);
  if (/iptv-org\.github\.io\/api\/countries\.json/.test(u)) return res([{code: 'IL', name: 'Israel', flag: '🇮🇱'}, {code: 'FR', name: 'France', flag: '🇫🇷'}, {code: 'xx', name: 'bad'}]);
  if (/iptv-org\.github\.io\/iptv\//.test(u)) return res(M3U_IL);
  if (/radio-browser\.info/.test(u)) {
    const i = ['de1', 'all', 'fi1', 'de2', 'nl1'].findIndex((m) => u.includes('//' + m + '.'));
    if (i < radioDown) return res('{}', 503);
    if (/\/json\/countries/.test(u)) return res([{iso_3166_1: 'US', stationcount: 9000}, {iso_3166_1: 'IL', stationcount: 150}, {iso_3166_1: 'il', stationcount: 2}, {iso_3166_1: '', stationcount: 5}, {iso_3166_1: 'ZZ', stationcount: 0}]);
    if (/\/json\/tags/.test(u)) return res([{name: 'pop', stationcount: 5000}, {name: 'jazz', stationcount: 900}, {name: '1234', stationcount: 800}, {name: 'rare', stationcount: 3}]);
    if (/\/json\/url\//.test(u)) return res({ok: true});
    return res(STATIONS);
  }
  if (/dead\.example/.test(u)) throw new Error('network');
  if (/^https:\/\/mass\.mako\.co\.il\//.test(u)) return res({caseId: '1', status: 'Success', tickets: [{vendor: 'AKAMAI', ticket: 'hdnea%3Dst%3D1~exp%3D2~acl%3D%2F*~hmac%3Dabc', url: ''}]});
  if (/^https:\/\/helper\.example\/p/.test(u)) return res('#EXTM3U\n');
  return res('#EXTM3U\n');
}
class FakeAudio {                                  // answers 'canplay' for hosts that have an https copy, 'error' for the rest
  constructor() { this.h = {}; }
  addEventListener(ev, fn) { this.h[ev] = fn; }
  set src(u) { this._src = u; setTimeout(() => { const f = this.h[/kc\.example/.test(u) ? 'error' : 'canplay']; if (f) f(); }, 2); }
  load() {} pause() {} removeAttribute() {}
}
const ctx = vm.createContext({TN, console, URLSearchParams, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Promise, Map, Set, Buffer, Intl, URL,
  fetch: fetchMock, document: dom.document, AbortController, Audio: FakeAudio, TextDecoder, Uint8Array,
  MutationObserver: class { observe() {} disconnect() {} }, navigator: {clipboard: {writeText: async () => {}}}, window: {prompt() {}, open() {}}});
ctx.self = ctx;
for (const f of ['epg', 'iptv', 'radio']) vm.runInContext(fs.readFileSync(path.join(WEB, f + '.js'), 'utf8'), ctx);

(async () => {
  // ================================================================ Live TV: lists
  const L = provs.iptv_lib, I = provs.iptv;
  ok(L && I && typeof pages.live === 'function', 'iptv registered: page live, provider iptv');
  const rows = L.parseM3u(M3U_IL);
  ok(rows.length === 8 && rows[0].name === 'Kan 11 (1080p)' && rows[0].logo === 'https://img.example/kan.png' && rows[0].group === 'General', 'm3u parsed: ' + rows.length);
  const m = L.merge(rows, 'il', true);
  const names = m.items.map((c) => c.name);
  ok(!names.includes('Sport 5') && !names.includes('Restream TV') && !names.some((x) => /Hop/.test(x)), 'paid Israeli channels and restream servers are dropped as in the build: ' + names);
  const k12 = m.items.find((c) => c.name === 'Keshet 12');
  ok(k12 && k12.urls.length === 1 && k12.http.length === 1, 'one channel, every stream kept (https + http): ' + JSON.stringify(k12 && [k12.urls, k12.http]));
  ok(m.http === 1 && m.items[m.items.length - 1].name === 'Israel Docu HD', 'a channel with http streams only is counted and listed last');
  ok(L.displayName('Kan 11 (1080p) [Not 24/7]') === 'Kan 11' && L.norm('Keshet 12 (1080p) [Geo-blocked]') === 'keshet 12', 'names cleaned like the build');
  ok(L.classify('Disney Junior', '', {}, '') === 'Kids' && L.classify('ערוץ 9', '', {}, '') === 'Israel' && L.classify('Матч ТВ', '', {}, '') === 'Russian' &&
     L.classify('CNN', 'News', {}, '') === 'News' && L.classify('X', '', {'tvg-id': 'X.ua'}, '') === 'Russian', 'groups like the build\'s classify');
  ok(L.isRestream('http://12.34.56.78:8080/x') && L.isRestream('https://a.mcquack.net/x') && L.isRestream('https://h/live/user/pass/55') && !L.isRestream('https://kancdn.medonecdn.net/x.m3u8'), 'restream rules');
  ok(L.isPaidIl('Sport 5') && L.isPaidIl('HOT 3') && L.isPaidIl('yes Movies') && !L.isPaidIl('Kan 11'), 'paid channel rules');
  const own = L.merge(L.parseM3u('#EXTINF:-1,Sport 5\nhttps://mine.example/s5.m3u8\n#EXTINF:-1,A\nhttps://mine.example/a.m3u8\n'), 'own:0', false);
  ok(own.items.length === 2 && own.items[0].name === 'Sport 5' && own.items[0].cls === 'Mine', 'the viewer\'s own playlist is kept as it is, in its order');

  // ================================================================ the build's Israeli table
  ok(CHANNELS.length >= 37, 'channels_il.json lists every channel of the build: ' + CHANNELS.length);
  for (const c of CHANNELS) ok(c.key && c.name && (c.urls || c.http || c.yt || c.site), 'channel ' + c.key + ' has a stream or an official site');
  const tn = (await I.load('tn')).items;
  const by = (k) => tn.find((c) => c.key === k);
  ok(by('kan11').urls[0] === CHANNELS.find((c) => c.key === 'kan11').urls[0], 'the broadcaster\'s own stream stays first');
  ok(by('kan11').urls.includes('https://stream.example/kan11/index.m3u8'), 'a playlist stream of the same channel is added as a fallback');
  ok(by('keshet12').urls[0] === 'https://free.example/keshet12/master.m3u8' && by('keshet12').http[0] === 'http://plain.example/keshet12.m3u8' && by('keshet12').kodi_only === false,
     'a channel the build plays only through Idan+ gets the streams the free Israeli list carries: ' + JSON.stringify(by('keshet12').urls));
  ok(by('kotel').yt && !by('kotel').kodi_only, 'a YouTube-live channel plays here (embedded player)');
  ok(tn.filter((c) => c.kodi_only).every((c) => c.site), 'every channel without a stream here has its official site to offer');
  ok(tn.every((c) => c.urls.length || c.yt || c.mako.length), 'every channel of the build has a source a browser can try: ' + tn.filter((c) => !(c.urls.length || c.yt || c.mako.length)).map((c) => c.key));
  for (const k of ['comedy13', 'nofesh13', 'reality13', 'knesset99c', 'radius100', 'pervoe891']) ok(/^https:\/\//.test(CHANNELS.find((c) => c.key === k).urls[0]), k + ': the official direct stream Idan+ plays in the build');
  for (const k of ['keshet12', 'keshet12c', 'ch24', 'eretz', 'savri', 'kcomedy', 'kdrama', 'kmusic', 'kfood']) ok((CHANNELS.find((c) => c.key === k).mako || []).length >= 1, k + ': Keshet\'s stream with its ticket');
  ok(by('keshet12').mako.length === 3 && CHANNELS.every((c) => !c.kodi_only), 'Keshet 12: the main feed and its two backup feeds; no channel is left "Kodi only"');
  // Keshet's ticket: asked from Keshet's public service, joined to the stream address the way the CDN wants it
  const feed = {link: '/stream/hls/live/1/k12/index.m3u8'}, feedQ = {link: '/k12cc/index.m3u8?b-in-range=0-1800', host: 'https://d2249b6f08tjt0.cloudfront.net', cdn: 'AWS'};
  ok(L.makoAsk(feed) === 'https://mass.mako.co.il/ClicksStatistics/entitlementsServicesV2.jsp?et=ngt&lp=/stream/hls/live/1/k12/index.m3u8&rv=AKAMAI' && /&rv=AWS$/.test(L.makoAsk(feedQ)), 'ticket request as the broadcaster\'s player makes it');
  ok(L.makoStream(feed, {caseId: '1', tickets: [{ticket: 'hdnea%3Dx~acl%3D%2F*'}]}) === 'https://mako-streaming.akamaized.net/stream/hls/live/1/k12/index.m3u8?hdnea=x~acl=/*', 'ticket joined to the stream address');
  ok(L.makoStream(feedQ, {caseId: '1', tickets: [{ticket: 'a%3D1'}]}) === 'https://d2249b6f08tjt0.cloudfront.net/k12cc/index.m3u8?b-in-range=0-1800&a=1', 'a stream address with its own query keeps it');
  ok(L.makoStream(feed, {caseId: '4'}) === '' && L.makoStream(feed, null) === '' && L.makoStream(feed, {caseId: '1', tickets: []}) === '', 'no ticket granted: no address (the next source is tried)');
  ok(/^https:\/\/mako-streaming\.akamaized\.net\/stream\/hls\/live\/1\/k12\/index\.m3u8\?hdnea=st=1~exp=2~acl=\/\*~hmac=abc$/.test(await L.makoResolve(feed, fetchMock)), 'ticket asked and used');
  ok((await L.makoResolve(feed, async () => { throw new Error('offline'); })) === '' && (await L.makoResolve(feed, async () => ({ok: false, status: 403}))) === '', 'ticket service down or refusing: no address, no crash');
  eq(L.candidates({name: 'K', urls: ['https://a.example/1.m3u8'], http: ['http://h.example/2.m3u8'], mako: [feed, feedQ], yt: 'UCvcdHbNAQvbe2GuIDLhlwaw'}, false).map((c) => c.via + ':' + c.kind),
     ['direct:hls', 'ticket:hls', 'ticket:hls', 'direct:yt', 'upgrade:hls'], 'failover order: own streams, Keshet feeds, YouTube live, https copy of http');
  ok(by('kan11').logo === 'media/live/kan11.png' && fs.existsSync(path.join(WEB, by('kan11').logo)), 'channel logos are shipped');
  for (const c of tn) if (c.logo && !/^https:/.test(c.logo)) ok(fs.existsSync(path.join(WEB, c.logo)), 'logo file ' + c.logo);

  // ================================================================ failover order, dead marks
  const ch = {name: 'T', urls: ['https://a.example/1.m3u8', 'https://dead.example/2.m3u8'], http: ['http://h.example/3.m3u8'], yt: 'UCvcdHbNAQvbe2GuIDLhlwaw'};
  eq(L.candidates(ch, false).map((c) => c.via + ':' + c.kind), ['direct:hls', 'direct:hls', 'direct:yt', 'upgrade:hls'], 'failover order without a helper');
  eq(L.candidates(ch, true).map((c) => c.via + ':' + c.kind), ['direct:hls', 'direct:hls', 'direct:yt', 'upgrade:hls', 'helper:hls'], 'failover order with the helper');
  ok(L.candidates(ch, true)[3].url === 'https://h.example/3.m3u8' && L.candidates(ch, true)[4].url === 'http://h.example/3.m3u8', 'http stream: its https copy first, then through the helper');
  ok(L.ytEmbed('UCvcdHbNAQvbe2GuIDLhlwaw').startsWith('https://www.youtube-nocookie.com/embed/live_stream?channel=UCvcdHbNAQvbe2GuIDLhlwaw') && L.ytEmbed('@handle') === '', 'YouTube live: the embedded player for a channel id only');
  const dead = await L.checkAll([ch], null, fetchMock);
  ok(dead === 0 && !L.isDead(ch), 'a channel with one live stream is not dead');
  eq(L.candidates(ch, false).map((c) => c.url)[1], 'https://dead.example/2.m3u8', 'a stream that did not answer is tried last');
  const gone = {name: 'G', urls: ['https://dead.example/x.m3u8'], http: []};
  ok((await L.checkAll([gone], null, fetchMock)) === 1 && L.isDead(gone), 'a channel whose only stream does not answer is marked');
  ok(L.candidates({name: 'F', urls: ['https://v.example/f.mp4'], http: []}, false)[0].kind === 'file', 'a plain file is not treated as HLS');
  const cfgH = L.helperHls({DefaultConfig: {loader: class { load() {} }}}, 'https://helper.example');
  let opened = null, header = null;
  cfgH.xhrSetup({open: (m2, u) => { opened = u; }, setRequestHeader: (k, v) => { header = [k, v]; }}, 'http://h.example/3.m3u8?token=abc');
  ok(opened === 'https://helper.example/p' && header[0] === 'X-TN-Target' && header[1] === 'http://h.example/3.m3u8?token=abc' && !/token/.test(opened), 'helper: the stream address travels in a header, never in the query');

  // ================================================================ the guide
  const E = provs.epg;
  ok(await E.ready(), 'the guide file loads');
  const mid2 = (EPG.ch.kan11.p[Math.floor(EPG.ch.kan11.p.length / 2)][0] + 60) * 1000;
  const nn = E.nowNext({key: 'kan11', name: 'Kan 11'}, mid2);
  ok(nn && nn.now && nn.next && nn.now.start <= mid2 && nn.now.stop > mid2 && nn.next.start >= nn.now.stop, 'now / next of a channel by its key');
  ok(E.keyOf('Kan 11 (1080p)') === 'kan11' && E.keyOf('כאן 11') === 'kan11', 'a playlist name finds its guide key');
  ok(E.keyOf({key: 'kan11c', name: 'Kan 11 - subtitled', guide: 'Kan 11'}) === 'kan11', 'a subtitled feed shows the main channel\'s guide');
  const ownG = E.nowNext({key: 'kab66', name: 'Kabbalah', name_he: 'קבלה 66'}, mid2);
  ok(ownG && ownG.now && ownG.now.own && /epg_live/.test(ownG.now.title), 'a channel of the build no guide lists gets "live broadcast" rows');
  ok(E.nowNext({name: 'Unknown channel zz'}, mid2) === null, 'no guide, no line');
  const span = E.span({key: 'kan11'}, mid2 - 3600000, mid2 + 3600000);
  ok(span.length >= 1 && span.every((p) => p.stop > mid2 - 3600000 && p.start < mid2 + 3600000), 'grid: the programmes that touch the window');
  ok(E.xmlTime('20261117070000 +0200') === Date.UTC(2026, 10, 17, 5, 0, 0) / 1000 && E.xmlTime('x') === 0, 'XMLTV times');
  const now0 = Date.UTC(2026, 10, 17, 7, 30, 0);
  const g = E.parseXmltv('<tv><channel id="c1"><display-name>My &amp; Channel</display-name></channel>' +
    '<programme start="20261117070000 +0000" stop="20261117080000 +0000" channel="c1"><title>Show &lt;1&gt;</title><desc>About</desc></programme>' +
    '<programme start="20251117070000 +0000" stop="20251117080000 +0000" channel="c1"><title>Old</title></programme></tv>', now0);
  ok(g.channels === 1 && g.programmes === 1 && g.ch['x:c1'].p[0][2] === 'Show <1>' && g.index[E.norm('My & Channel')] === 'x:c1', 'the viewer\'s own XMLTV guide: ' + JSON.stringify([g.channels, g.programmes]));
  ok(E.addSource('http://x') === false && E.addSource('https://guide.example/a.xml') === true && E.sources().length === 1, 'own guide addresses: https only');
  E.removeSource('https://guide.example/a.xml');

  // ================================================================ radio
  const R = provs.radio;
  ok(R && typeof pages.radio === 'function', 'radio registered');
  ok(R.readable(' Galgalatz  (128k) ') === 'Galgalatz' && R.readable('Kan Bet [AAC]') === 'Kan Bet' && R.readable('- 88FM -') === '88FM' && R.readable('(mp3)') === '(mp3)', 'station names cleaned');
  const sp = R.split(STATIONS);
  eq(sp.items.map((s) => s.name + (s.http_only ? ':http' : '')), ['Galgalatz', 'Reshet Bet', 'Kol Chai:http'], 'one row per station, https first, http-only marked and last');
  ok(sp.http === 1 && sp.items[0].url_resolved === 'https://glz.example/glglz' && sp.items[1].url_resolved === 'https://kan.example/bet', 'the stream a secure page can play is chosen');
  ok(R.playable({url: 'http://a', url_resolved: 'http://b'}) === '', 'http only: nothing to play directly');
  eq(R.parseArg('IL'), {cc: 'IL'}, 'old address #/radio/IL');
  eq(R.parseArg('tag:jazz'), {tag: 'jazz'}, 'old address tag:');
  eq(R.parseArg('favs'), {v: 'favs'}, 'favourites address');
  eq(R.parseArg('q=glz&lang=hebrew'), {lang: 'hebrew', q: 'glz'}, 'search with a language');
  eq(R.parseArg('cc=il'), {cc: 'IL'}, 'country code upper-cased');
  ok(R.flag('IL') === '🇮🇱' && R.flag('x') === '', 'flags from the country code');
  radioDown = 2;
  const st = await R.stations({cc: 'IL'});
  ok(st.items.length === 3 && fetched.some((u) => u.startsWith('https://fi1.api.radio-browser.info')), 'two mirrors down: the third answers');
  radioDown = 0;
  const cl = await R.countryList();
  ok(cl[0].code === 'IL' && cl[0].n === 152 && cl[1].code === 'US' && cl.length === 2, 'countries: Israel first, then most stations; bad rows dropped: ' + JSON.stringify(cl.map((c) => c.code + c.n)));
  const tl = await R.tagList();
  eq(tl.map((x) => x.name), ['pop', 'jazz'], 'styles: the used ones, no numbers');
  favs.push({kind: 'radio', id: 'fav-1', label: 'My FM (128k)', extra: 'https://my.example/fm'}, {kind: 'radio', id: 'fav-2', label: 'Plain FM', extra: 'http://plain.example/fm'},
            {kind: 'movie', id: '5', label: 'x'}, {kind: 'radio', id: 'fav-3', label: 'No stream', extra: ''});
  eq(R.favStations().map((s) => s.name + (s.http_only ? ':http' : '')), ['My FM', 'Plain FM:http'], 'favourite stations (the build\'s shape: the stream in extra)');
  history.push({key: 'radio:r1', label: 'Recent FM', play: 'https://r.example/1', thumb: 'image://https%3A%2F%2Fimg.example%2Fr.png/'}, {key: 'movie:1', label: 'm'},
               {key: 'radio:r1', label: 'dup', play: 'https://r.example/1'}, {key: 'radio:r2', label: 'Kodi only', play: 'plugin://x'});
  const rec = R.recentStations();
  ok(rec.length === 1 && rec[0].stationuuid === 'r1' && rec[0].favicon === 'https://img.example/r.png', 'recently played: from the history, a Kodi picture address decoded: ' + JSON.stringify(rec));
  // playing: an https station goes to the bar; an http-only one tries its https copy, else says why
  R.play(sp.items[0]);
  ok(radioPlayed.length === 1 && radioPlayed[0].url_resolved === 'https://glz.example/glglz' && radioPlayed[0].name === 'Galgalatz', 'an https station plays in the bar');
  ok(fetched.some((u) => /\/json\/url\/11111111-/.test(u)), 'the play is counted, as the API asks');
  await R.play({stationuuid: 'h1', name: 'Has copy', url_resolved: '', http_only: true, http_url: 'http://copy.example/s'});
  ok(radioPlayed.length === 2 && radioPlayed[1].url_resolved === 'https://copy.example/s', 'http-only station with an https copy plays through it');
  const before = dom.texts.length;
  await R.play(sp.items[2]);
  const shown = dom.texts.slice(before).join('\n');
  ok(radioPlayed.length === 2 && /radio_why_http/.test(shown) && /radio_open_tab/.test(shown) && /radio_vlc/.test(shown), 'http-only station without a copy: the reason and the ways out, never a dead button');
  const sr = await R.search('gal');
  ok(sr.length === 2 && sr[0].kind === 'radio' && typeof sr[0].open === 'function', 'search provider: playable stations only');

  // ================================================================ texts: he / en / ru with the same keys; every asked text exists
  for (const f of ['tgsearch', 'telegram']) {            // their tables too (loaded with stand-ins: only i18n.add matters)
    try { vm.runInContext(fs.readFileSync(path.join(WEB, f + '.js'), 'utf8'), ctx); } catch (e) { ok(false, f + '.js did not load: ' + e); }
  }
  const all = {he: {}, en: {}, ru: {}};
  for (const tb of tables) {
    eq(Object.keys(tb).sort(), ['en', 'he', 'ru'], 'a text table has exactly he / en / ru');
    const want = Object.keys(tb.en).sort().join('|');
    for (const l of ['he', 'en', 'ru']) {
      ok(Object.keys(tb[l]).sort().join('|') === want, `texts: ${l} has other keys than en: ` + Object.keys(tb.en).filter((k) => !(k in tb[l])).concat(Object.keys(tb[l]).filter((k) => !(k in tb.en))).slice(0, 8));
      for (const [k, v] of Object.entries(tb[l])) { ok(typeof v === 'string' && v.trim().length > 0, `text ${l}.${k} is empty`); all[l][k] = v; }
    }
    for (const k of Object.keys(tb.en)) {
      const count = (s) => (String(s).match(/%s/g) || []).length;
      ok(count(tb.he[k]) === count(tb.en[k]) && count(tb.ru[k]) === count(tb.en[k]), `text ${k}: the same number of %s in the three languages`);
    }
  }
  ok(tables.length === 5 && Object.keys(all.en).length > 250, 'five modules, ' + Object.keys(all.en).length + ' texts');
  ok(/[֐-׿]/.test(all.he.radio_favs) && /[Ѐ-ӿ]/.test(all.ru.radio_favs) && /^[\x20-\x7e]+$/.test(all.en.radio_favs), 'each language is in its own script');
  const shell = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8') + fs.readFileSync(path.join(WEB, 'i18n.js'), 'utf8');
  const MINE = /^(iptv_|grp_|epg_|radio_|tgm_|tgs_)/;
  for (const f of ['iptv', 'epg', 'radio', 'tgsearch', 'telegram']) {
    const src = fs.readFileSync(path.join(WEB, f + '.js'), 'utf8');
    const asked = new Set();
    for (const m2 of src.matchAll(/(?:^|[^\w.])(?:TN\.)?t\(\s*'([a-zA-Z0-9_]+)'\s*[,)]/g)) asked.add(m2[1]);
    for (const m2 of src.matchAll(/\bt\([^()]*\?\s*'([a-z0-9_]+)'\s*:\s*'([a-z0-9_]+)'/g)) { asked.add(m2[1]); asked.add(m2[2]); }
    for (const k of asked) {
      if (MINE.test(k)) ok(k in all.en, `${f}.js asks for the text ${k}, which does not exist`);
      else ok(new RegExp('\\b' + k + ':').test(shell), `${f}.js asks for the shell text ${k}, which app.js / i18n.js do not have`);
    }
  }
  for (const k of ['tn', 'il', 'he', 'ru', 'en', 'movies', 'kids', 'docs', 'news', 'music']) ok(('iptv_l_' + k) in all.en, 'list name iptv_l_' + k);
  for (const k of ['Mine', 'Israel', 'News', 'Movies', 'Series', 'Kids', 'Sport', 'Documentary', 'Music', 'Russian', 'Other']) ok(('grp_' + k) in all.en, 'group name grp_' + k);
  for (const k of ['news', 'pop', 'rock', 'classical', 'jazz', 'mideast', 'kids', 'jewish']) ok(('radio_t_' + k) in all.en, 'style name radio_t_' + k);
  for (const k of ['tgm_p0', 'tgm_p1', 'tgm_p2', 'tgm_p3', 'tgm_p4', 'tgm_bot_state_on', 'tgm_bot_state_auto', 'tgm_bot_state_off', 'tgm_bot_state_none']) ok(k in all.en, 'text ' + k);
  // no secret can leak into an address: the modules never build a query from a key / token / hash
  for (const f of ['iptv', 'epg', 'radio', 'tgsearch', 'telegram']) {
    const src = fs.readFileSync(path.join(WEB, f + '.js'), 'utf8');
    ok(!/[?&](?:key|token|api_hash|apikey|session)=\$\{|console\.(?:log|info|debug)\(/.test(src), f + '.js: no key in a query, no console logging');
  }

  // ================================================================ every screen draws, every button works
  const draw = async (page, arg, skip) => {
    let alive = true;
    try { await pages[page](arg, {current: () => alive, key: page, arg}); } catch (e) { ok(false, `screen ${page}/${arg} failed: ` + (e && e.stack || e)); }
    const failed = await dom.press(skip || /^$/);
    for (const [label, e] of failed) ok(false, `screen ${page}/${arg}, pressing ${label}: ` + (e && e.stack || e));
    alive = false;
    ok(true, `screen ${page}/${arg}`);
  };
  favs.push({kind: 'web_channel', id: 'il:kan11', label: 'Kan 11'}, {kind: 'web_channel', id: 'https://my.example/ch.m3u8', label: 'My channel', extra: 'https://img.example/l.png'},
            {kind: 'web_channel', id: 'http://plain.example/ch.m3u8', label: 'Plain channel'});
  eq((await I.favChannels()).map((c) => c.name + ':' + c.urls.length + ':' + c.http.length), ['Kan 11:3:0', 'My channel:1:0', 'Plain channel:0:1'], 'favourite channels: the build\'s key or the stream address');
  store.iptv_own = [{name: 'Mine', rows: [['Own One', 'https://mine.example/1.m3u8', '', 'G'], ['Own Two', 'http://mine.example/2.m3u8', '', 'G']]}];
  for (const arg of ['', 'tn', 'tn/g:Israel', 'il', 'news', 'favs', 'guide', 'countries', 'c:FR', 'own:0', 'sources', 'nosuchlist']) await draw('live', arg);
  ok(store.iptv_own.length === 0, 'Sources: deleting an own playlist removes it');
  for (const l of ['en', 'ru']) { lang = l; await draw('live', 'tn'); await draw('live', 'guide'); }
  lang = 'he';
  helperUrl = 'https://helper.example';                     // the same with a helper server set
  await draw('live', 'il');
  helperUrl = '';
  const text = dom.texts.join('\n');
  ok(/כאן 11/.test(text) && /LIVE/.test(text), 'channel cards drawn');
  ok(/iptv_fail|iptv_why_idan|iptv_try/.test(text), 'the channel sheet shows its state');
  ok(/epg_channel/.test(text), 'the guide grid drawn');
  ok(/Own One/.test(text), 'the viewer\'s own playlist drawn');
  ok(history.some((h) => /^ch:/.test(h.key)), 'opening a channel notes it in the history');
  ok(histHandlers.some((h) => h({key: 'ch:il:kan11', label: 'Kan 11'}) === true) && !histHandlers.some((h) => h({key: 'movie:1'}) === true), 'a channel history row opens the channel sheet');
  ok(await I.openKey('kan11') === true && await I.openKey('nosuch') === false, 'openKey for other modules');
  const found = await I.search('kan');
  ok(found.length >= 1 && found[0].kind === 'live', 'search provider finds channels by name');
  for (const arg of ['', 'IL', 'top', 'tag:jazz', 'lang=hebrew', 'q=gal', 'v=favs', 'v=recent', 'v=countries', 'v=tags', 'cc=FR']) await draw('radio', arg);
  const text2 = dom.texts.join('\n');
  ok(/Galgalatz/.test(text2) && /radio_b_http/.test(text2) && /radio_http:1/.test(text2), 'station cards drawn, http-only marked with a note');
  ok(/My FM/.test(text2) && /Recent FM/.test(text2), 'favourites and recently played drawn');
  ok(/radio_n:9,000|radio_n:152/.test(text2), 'country tiles with station counts');
  radioDown = 5;                                            // every mirror down: a message and "try again", not an empty page
  dom.texts.length = 0;
  await draw('radio', 'IL');
  ok(/radio_fail/.test(dom.texts.join('\n')) && /radio_retry/.test(dom.texts.join('\n')), 'radio servers down: a clear message with "try again"');
  radioDown = 0;
  console.log(`${n} checks, ${bad} failures`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
