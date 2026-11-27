'use strict';
// Package "content": hub / yt / topics / catalog / help / library / services / gdrive / backup / status.
//   node src/qa/web/t_content.js          (plain node, no network, a stand-in TN and a stand-in document)
// 1. texts      every TN.i18n.add of these files has the same keys in he / en / ru, no empty text, and every
//               TN.t('literal') they ask for exists (their own tables, web/i18n.js or the older tables of app.js)
// 2. pure logic library switches, help search over the real guide files, pasted links, key shapes, StremThru answers,
//               speed-test maths (the build's numbers), version compare, backup files, the settings file both ways,
//               founding the sync document against the real websync.js / syncdoc.js, Drive helpers, topics, hub, yt, catalog
// 3. data       the web guide and troubleshooting exist in three languages; topics channels have valid ids; every
//               local picture / page these files point to exists
// 4. pages      every page of these files draws without throwing, with and without keys, in the three languages
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const WEB = path.join(__dirname, '..', '..', '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');
let n = 0, bad = 0;
const ok = (c, what) => { n++; if (!c) { bad++; console.log('FAIL', what); } };
const plain = (x) => (x !== null && typeof x === 'object' ? JSON.parse(JSON.stringify(x)) : x);      // (objects made inside the vm have another Object)
const eq = (a, b, what) => { n++; a = plain(a); b = plain(b); try { assert.deepStrictEqual(a, b); } catch (e) { bad++; console.log('FAIL', what, '\n   got ', JSON.stringify(a), '\n   want', JSON.stringify(b)); } };
const FILES = ['hub', 'yt', 'topics', 'catalog', 'help', 'library', 'services', 'gdrive', 'backup', 'status'];

// ------------------------------------------------------------------ a stand-in document (not a DOM: it accepts anything)
function fakeDom() {
  const handlers = [], texts = [];
  function el(tag) {
    const own = {tagName: String(tag || 'DIV').toUpperCase(), dataset: {}, style: {}, hidden: false, disabled: false, value: '', files: [], isConnected: true, children: [], childNodes: []};
    const note = (x) => { if (typeof x === 'string') texts.push(x); };
    const self = new Proxy(function () {}, {
      get(t, k) {
        if (k === Symbol.toPrimitive) return () => '';
        if (k === Symbol.iterator) return function* () {};
        if (k === 'then' || k === 'toJSON') return undefined;
        if (k in own) return own[k];
        if (k === 'length') return 0;
        if (k === 'classList') return {add() {}, remove() {}, toggle() {}, contains: () => false};
        if (k === 'addEventListener') return (ev, fn) => { if (typeof fn === 'function') handlers.push([own.tagName + ':' + ev, fn]); };
        if (k === 'insertAdjacentHTML') return (pos, html) => { texts.push(String(html)); };
        if (k === 'append' || k === 'prepend') return (...xs) => { xs.forEach(note); };
        if (k === 'querySelectorAll') return () => [];
        if (k === 'getAttribute') return () => '';
        if (k === 'canPlayType') return () => '';
        return el('x');
      },
      set(t, k, v) {
        own[k] = v;
        if (k === 'textContent' || k === 'innerHTML' || k === 'placeholder') texts.push(String(v));
        if (typeof v === 'function' && /^on/.test(String(k))) handlers.push([own.tagName + ':' + String(k), v]);
        return true;
      },
      has: (t, k) => k in own,
      apply: () => el('x'),
    });
    return self;
  }
  const document = el('document');
  document.createElement = (tag) => el(tag);
  document.getElementById = () => null;              // (no style block yet, no sheet element)
  document.querySelector = () => null;
  document.createTextNode = (s) => { texts.push(String(s)); return el('#text'); };
  document.head = el('head'); document.body = el('body');
  return {document, el, handlers, texts};
}

// ------------------------------------------------------------------ a stand-in TN
function loadI18n() {
  const box = {};
  vm.runInNewContext(read('i18n.js'), {self: box, window: box, globalThis: box});
  const I = box.I18N || (box.self && box.self.I18N);
  if (!I) throw new Error('web/i18n.js gives no I18N');
  return I;
}
function oldTables() {                              // the L / X3 / X4 tables of app.js (the texts TN.t also finds)
  const keys = new Set(), app = read('app.js');
  for (const m of app.matchAll(/^const (L|X3|X4) = (\{[\s\S]*?\n\});$/gm)) { try { for (const k of Object.keys(new Function('return ' + m[2])().en)) keys.add(k); } catch (e) {} }
  return keys;
}
function makeTN(opt) {
  opt = opt || {};
  const I18N = loadI18n();
  I18N.setLang(opt.lang || 'he');
  const dom = fakeDom();
  const added = [];                                 // every table handed to TN.i18n.add
  const pages = {}, provs = new Map(), store = {}, cfg = Object.assign({lang: opt.lang || 'he'}, opt.cfg || {});
  const view = dom.el('main');
  const users = [{id: 'u1', name: 'A', created: 1, renamed: 0, deleted: 0}];
  const data = {u1: {history: opt.history || [], favourites: opt.favs || [], removed: [], searches: [{q: 'the matrix', ts: 1700000000}], marks: {}}};      // (rows {q, ts}, as store.js keeps them)
  const TN = {
    version: '9.9.9',
    registerPage: (k, fn) => { pages[k] = fn; },
    registerProvider: (name, impl) => { impl.name = name; impl.kinds = [].concat(impl.kinds || []); provs.set(name, impl); },
    providers: async (kind) => [...provs.values()].filter((p) => p.kinds.includes(kind) && TN.providerOn(p.name)),
    provider: async (name) => provs.get(name) || null,
    providerOn: (name) => !(cfg.providers_off || []).includes(name),
    setProviderOn(name, on) { const off = new Set(cfg.providers_off || []); if (on) off.delete(name); else off.add(name); cfg.providers_off = [...off]; },
    load: async () => {}, addTitleAction() {}, addHistoryHandler() {}, on: () => () => {}, emit() {},
    i18n: {add: (tb) => { added.push(tb); I18N.add(tb); }}, t: (k, ...a) => I18N.t(k, ...a), lang: () => cfg.lang, rtl: () => cfg.lang === 'he',
    get: (k, d) => (k in store ? store[k] : d), put: (k, v) => { store[k] = v; }, drop: (k) => { delete store[k]; },
    store: {users: () => users, current: () => 'u1', live: () => users, data: (uid) => data[uid], setUsers: () => false, putData: (uid, d) => { data[uid] = d; return true; },
      history: () => data.u1.history, favs: () => data.u1.favourites, searches: () => data.u1.searches, addSearch() {}, isFav: () => false, addFav() {}, removeFav() {},
      art: () => '', setArt() {}},
    SyncDoc: null, WebSync: null,
    settings: {get: (k, d) => (k in cfg ? cfg[k] : d), set: (k, v) => { cfg[k] = v; }, synced: () => Object.assign({}, opt.synced || {}), helper: () => String(cfg.helper || '')},
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])),
    $: () => null,
    icon: (id) => '<svg class="ico" data-i="' + id + '"></svg>',
    button: (cls, text, fn) => { const b = dom.el('button'); b.className = cls; b.textContent = text; if (fn) dom.handlers.push(['button:' + text, fn]); return b; },
    card: (img, title, sub, fn, shape) => { const c = dom.el('button'); dom.texts.push(String(title)); if (shape != null) TN._shapes.push(shape); if (fn) dom.handlers.push(['card:' + title, fn]); return c; },
    section: (title) => { if (title) dom.texts.push(String(title)); return dom.el('div'); },
    page: (key, title) => { dom.texts.push(String(title)); }, chips: (items) => { for (const it of items || []) dom.texts.push(String(it[0]), String(it[1])); return dom.el('div'); }, skeleton: () => dom.el('div'), empty: (g, text) => { dom.texts.push(String(text || '')); },
    modal: (html) => { dom.texts.push(String(html)); }, closeModal() {}, favButton: () => dom.el('button'), kodiOnly: () => { TN._kodiOnly++; },
    cssUrl: (u) => u, paint() {}, httpsOnly: (u) => (/^https:\/\//i.test(String(u || '')) ? String(u) : ''), view: () => view,
    loadScript: async () => {}, go: (h) => { TN._went.push(h); }, route() {}, here: () => ({key: '', arg: '', rest: []}),
    params: (arg) => Object.fromEntries(new URLSearchParams(arg || '')),
    link: (key, params) => '#/' + key + (params ? '/' + (typeof params === 'string' ? encodeURIComponent(params) : new URLSearchParams(params)) : ''),
    tmdb: async () => { if (!opt.tmdb) throw new Error('TMDb 401'); return opt.tmdb; }, tmdbLang: () => 'he-IL', tmdbImg: (p) => 'https://image.tmdb.org/t/p/w342' + p,
    hasTmdbKey: () => !!opt.tmdb, openTitle() {}, openArchive() {}, openChannel() {}, playRadio() {}, stopRadio() {},
    archive: async () => [], channels: async () => [{name: 'Kan 11'}], stations: async () => [], doSearch() {}, noteHistory() {},
    tg: async () => { throw new Error('no telegram in the tests'); }, clearCaches: async () => {},
    _went: [], _shapes: [], _kodiOnly: 0,
  };
  const noNet = async () => { throw new TypeError('no network in the tests'); };
  const sandbox = {TN, document: dom.document, console, URL, URLSearchParams, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, Promise, Date, Math, JSON,
    navigator: {onLine: true, clipboard: null, serviceWorker: null, storage: null}, location: {href: 'https://example.github.io/web/#/x', origin: 'https://example.github.io', hash: '#/x', protocol: 'https:'},
    fetch: opt.fetch || noNet, sessionStorage: {getItem: (k) => (opt.session && k in opt.session ? opt.session[k] : null), setItem: (k, v) => { if (opt.session) opt.session[k] = String(v); },
      removeItem: (k) => { if (opt.session) delete opt.session[k]; }}, crypto: {getRandomValues: (a) => a}, performance: {now: () => Date.now()},
    AbortController, TextDecoder, TextEncoder, Blob: typeof Blob === 'function' ? Blob : function () {}, FormData: function () { this.append = () => {}; },
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }, getSelection: () => dom.el('sel'), open: () => null};
  sandbox.self = sandbox; sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const run = (f) => vm.runInContext(read(f + '.js'), sandbox, {filename: f + '.js'});
  return {TN, sandbox, dom, added, pages, provs, cfg, run, I18N, store};
}
const ctxOf = (arg) => ({key: '', arg, rest: arg ? [arg] : [], current: () => true});

(async () => {
  // ================================================================ 1. texts
  {
    const T = makeTN();
    const shell = oldTables();
    for (const f of FILES) {
      const before = T.added.length;
      T.run(f);
      const tables = T.added.slice(before);
      ok(tables.length >= 1, f + '.js adds its texts');
      const mine = new Set();
      for (const tb of tables) {
        eq(Object.keys(tb).sort(), ['en', 'he', 'ru'], f + ': the three languages');
        const want = Object.keys(tb.en || {}).sort();
        for (const l of ['he', 'en', 'ru']) {
          const have = Object.keys(tb[l] || {}).sort();
          if (have.join('|') !== want.join('|')) { const a = new Set(have), b = new Set(want); ok(false, `${f}.${l}: missing ${[...b].filter((k) => !a.has(k))} / extra ${[...a].filter((k) => !b.has(k))}`); } else ok(true);
          for (const k of have) { mine.add(k); ok(typeof tb[l][k] === 'string' && tb[l][k].trim(), `${f}.${l}.${k} is empty`); }
        }
        // the same number of %s in each language (an argument must not vanish in a translation)
        for (const k of want) { const c = (s) => (String(s).match(/%s/g) || []).length; ok(c(tb.he[k]) === c(tb.en[k]) && c(tb.ru[k]) === c(tb.en[k]), `${f}.${k}: %s count differs between languages`); }
      }
      const src = read(f + '.js');
      for (const m of src.matchAll(/\bt\('([a-z][a-z0-9_]*[a-z0-9])'(?!\s*\+)/g)) ok(T.I18N.has(m[1]) || shell.has(m[1]), `${f}.js asks for the text ${m[1]}, which does not exist`);
      for (const m of src.matchAll(/\? '([a-z]{2,}_[a-z0-9_]+)' : '([a-z]{2,}_[a-z0-9_]+)'\)/g)) for (const k of [m[1], m[2]]) if (/^(sv|st|bk|gd|lb|hp|yt|hub|cat|topics|dv)_/.test(k)) ok(T.I18N.has(k), `${f}.js asks for the text ${k}, which does not exist`);
    }
    // the dynamic keys: every prefix + name the pages build
    const need = [].concat(
      require(path.join(WEB, 'library.js')).NAMES.map((x) => 'lb_n_' + x), ['tmdb', 'tg', 'rd', 'yt', 'helper', 'oskey', 'srv', 'gemini'].map((x) => 'lb_need_' + x),
      ['search', 'play', 'subs'].map((x) => 'lb_g_' + x), ['auto', 'tv', 'phone', 'desktop'].map((x) => 'dv_' + x), ['ping', 'jitter', 'down', 'up'].map((x) => 'st_' + x),
      ['sd', 'hd', 'fhd', 'uhd', 'live'].map((x) => 'st_u_' + x), ['ok', 'weak', 'no'].map((x) => 'st_v_' + x), ['hebrew', 'russian', 'kids'].map((x) => 'cat_g_' + x),
      ['he', 'en', 'ru', 'fr', 'es', 'ko', 'ja', 'tr', 'de', 'it', 'hi'].map((x) => 'cat_l_' + x),
      ['m_library', 'm_services', 'm_backup', 'm_gdrive', 'm_status', 'm_help', 'm_device', 'm_users', 'm_history', 'm_bn', 'm_hub', 'core_search_go', 'core_hub_txt']);
    for (const k of need) ok(T.I18N.has(k) || shell.has(k), 'the text ' + k + ' exists');
    // no "only in Kodi" dead ends left in these files' texts
    for (const tb of T.added) for (const l of ['he', 'en', 'ru']) for (const [k, v] of Object.entries(tb[l])) ok(!/Kodi only|רק ב-Kodi|Только в Kodi/i.test(v), `${k} (${l}) still says "Kodi only"`);
    for (const f of FILES) ok(!/TN\.kodiOnly\(/.test(read(f + '.js')), f + '.js does not send the viewer to Kodi');
  }

  // ================================================================ 2. pure logic
  // ---- library
  {
    const L = require(path.join(WEB, 'library.js'));
    eq(L.migrate(['hub', 'yt']), ['dailymotion', 'archive', 'yt'], 'library: the old "hub" switch becomes its real providers');
    eq(L.migrate(['subs']), ['wizdom', 'opensubs', 'yify', 'ktuvit', 'subsrv', 'subs_ai'], 'library: the old "subs" switch');
    eq(L.migrate(['rd']), ['rd'], 'library: nothing to migrate');
    eq(L.migrate(null), [], 'library: no list');
    eq(L.setAll(['other', 'rd'], true), ['other'], 'library: all on keeps the names of other modules');
    eq(L.setAll(['other'], false).length, 1 + L.NAMES.length, 'library: all off');
    eq(L.setAll([], false, 'subs'), ['wizdom', 'opensubs', 'yify', 'ktuvit', 'subsrv', 'subs_ai'], 'library: one group off');
    eq(L.counts(['rd', 'yt', 'x']), {on: L.NAMES.length - 2, off: 2}, 'library: counts');
    // every switch names a provider that some module really registers under that name
    const all = ['hub', 'yt', 'topics', 'subs', 'rd', 'tgsearch', 'iptv', 'radio'].map((f) => { try { return read(f + '.js'); } catch (e) { return ''; } }).join('\n');
    for (const name of L.NAMES) ok(new RegExp("registerProvider\\('" + name + "'").test(all), 'library: a module registers the provider "' + name + '"');
    ok(L.FREE.length === 13 && L.FREE.every((f) => f.length === 4 && /^(#\/|https:\/\/)/.test(f[3])), 'library: 13 free libraries, each opens somewhere');
    ok(L.RUSSIAN.length === 9 && L.RUSSIAN.every((c) => /^UC[A-Za-z0-9_-]{22}$/.test(c[0]) && c.length === 4), 'library: the nine Russian studio channels');
  }
  // ---- help: search over the real files
  {
    const H = require(path.join(WEB, 'help.js'));
    const guide = JSON.parse(read('data/help/guide.json')), trouble = JSON.parse(read('data/help/trouble.json'));
    ok(guide.edition === 'web' && trouble.edition === 'web', 'help: the web edition of the guide');
    ok(guide.sections.length >= 12 && trouble.rows.length >= 12, 'help: enough sections and rows');
    const ids = new Set();
    for (const s of guide.sections) {
      ok(/^[a-z]+$/.test(s.id) && !ids.has(s.id), 'help: section id ' + s.id); ids.add(s.id);
      for (const l of H.LANGS) ok(s[l] && s[l].title && s[l].body && s[l].body.length > 80, `help: section ${s.id} in ${l}`);
    }
    for (const [i, r] of trouble.rows.entries()) for (const l of H.LANGS) ok(Array.isArray(r[l]) && r[l].length === 3 && r[l].every((x) => x && x.length > 5), `help: trouble row ${i} in ${l}`);
    for (const l of H.LANGS) { const all = H.search(guide, trouble, l, ''); eq([all.sections.length, all.rows.length], [guide.sections.length, trouble.rows.length], 'help: everything listed in ' + l); }
    ok(H.search(guide, trouble, 'en', 'telegram code').rows.some((r) => /code does not arrive/i.test(r[0])), 'help: every word of the query (en)');
    ok(H.search(guide, trouble, 'he', 'טלגרם קוד').sections.length >= 1, 'help: search in Hebrew');
    ok(H.search(guide, trouble, 'ru', 'субтитры').sections.some((s) => s.id === 'subs'), 'help: search in Russian');
    eq(H.search(guide, trouble, 'en', 'zzzqqq'), {sections: [], rows: [], words: ['zzzqqq']}, 'help: nothing found');
    eq(H.text('a[CR]b [B]c[/B]'), 'a\nb c', 'help: Kodi marks are removed');
    // the guide is the web's: it does not describe Kodi screens
    ok(!/POV|System Update|עדכון מערכת|NovaTV settings/.test(JSON.stringify(guide) + JSON.stringify(trouble)), 'help: no Kodi-only screens in the web guide');
  }
  // ---- services
  {
    const S = require(path.join(WEB, 'services.js'));
    eq(S.classify('magnet:?xt=urn:btih:abc extra'), {kind: 'magnet', url: 'magnet:?xt=urn:btih:abc'}, 'paste: magnet');
    eq(S.classify('look https://t.me/movhd/123 here'), {kind: 'telegram', url: 'https://t.me/movhd/123'}, 'paste: t.me message');
    eq(S.classify('t.me/+AbCdEf123').kind, 'telegram', 'paste: invite link without a scheme');
    eq(S.classify('tg://resolve?domain=movhd&post=5').kind, 'telegram', 'paste: tg:// link');
    eq(S.classify('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s'), {kind: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s'}, 'paste: YouTube watch');
    for (const u of ['https://youtu.be/dQw4w9WgXcQ', 'youtube.com/playlist?list=PL1234567890abc', 'https://www.youtube.com/@mosfilm', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ'])
      eq(S.classify(u).kind, 'youtube', 'paste: ' + u);
    eq(S.classify('https://www.dailymotion.com/video/x8abc12'), {kind: 'dailymotion', url: 'https://www.dailymotion.com/video/x8abc12', id: 'x8abc12'}, 'paste: Dailymotion');
    eq(S.classify('https://archive.org/details/night_of_the_living_dead').id, 'night_of_the_living_dead', 'paste: archive.org');
    eq(S.classify('https://cdn.example.com/a/film.mkv?x=1').kind, 'media', 'paste: a direct file');
    eq(S.classify('https://example.com/live/index.m3u8').kind, 'media', 'paste: HLS');
    eq(S.classify('https://example.com/page').kind, 'web', 'paste: a page');
    eq(S.classify('http://example.com/a.mp4').kind, '', 'paste: http is not opened');
    eq(S.classify('hello'), {kind: '', url: ''}, 'paste: not a link');
    eq([S.httpsUrl(' https://a.b/ '), S.httpsUrl(''), S.httpsUrl('http://a.b'), S.httpsUrl('https://a.b/x?k=1'), S.httpsUrl('https://u:p@a.b')], ['https://a.b', '', null, null, null], 'an https address, never one with a query or a login');
    ok(S.keyOk('tmdb', '0123456789abcdef0123456789abcdef') && S.keyOk('tmdb', 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJhYmMifQ.abcdefghijklmnop') && !S.keyOk('tmdb', 'short'), 'key shape: TMDb v3 / v4');
    ok(S.keyOk('gemini', 'AIzaSyA1234567890abcdefghijklmnopqrstuv') && !S.keyOk('gemini', 'has space in it 1234567890123456789012'), 'key shape: Gemini');
    ok(S.keyOk('os', 'AbCdEf0123456789AbCdEf0123456789') && !S.keyOk('os', 'x'), 'key shape: OpenSubtitles');
    eq(S.summary(['on', 'on', 'off', 'fix', undefined]), {on: 2, off: 2, fix: 1}, 'the summary line');
    const h = 'a'.repeat(40), h2 = 'B'.repeat(40);
    eq(S.stHashes([h, 'magnet:?xt=urn:btih:' + h2 + '&dn=x', h, 'zz', 'c'.repeat(41)]), [h, h2.toLowerCase()], 'StremThru: hashes out of hashes and magnets');
    eq(S.stCached({data: {items: [{hash: h, status: 'cached', files: [{index: 1, name: 'a.mkv', size: 5}]}, {hash: h2, status: 'unknown'}, {hash: 'bad', status: 'cached'}]}}),
      {[h]: [{index: 1, name: 'a.mkv', size: 5}]}, 'StremThru: only what is really cached');
    eq(S.stCached(null), {}, 'StremThru: no answer');
    const src = read('services.js');
    ok(!/api_key|access_token=|[?&]key=/.test(src), 'services.js builds no address with a key');
    ok(!/console\.(log|info|debug|warn|error)/.test(FILES.map((f) => read(f + '.js')).join('\n')), 'nothing is written to the console in these files');
  }
  // ---- status
  {
    const S = require(path.join(WEB, 'status.js'));
    eq(S.mbps(12.5e6, 10), 10, 'speed: Mbps');
    eq(S.mbps(1, 0), 0, 'speed: no time');
    eq(S.jitter([10, 14, 12]), 3, 'speed: jitter');
    eq(S.jitter([5]), 0, 'speed: one sample');
    eq(S.trimmed([50, 10, 30, 20]), [10, 20], 'speed: the two slowest samples are warm-up');
    // the build's table (speedtest.py verdict): 3 / 6 / 12 / 30 / 8 Mbps with 25 % headroom
    eq(S.verdict(100, 20), [['sd', 'ok'], ['hd', 'ok'], ['fhd', 'ok'], ['uhd', 'ok'], ['live', 'ok']], 'speed: fast line');
    eq(S.verdict(13, 20), [['sd', 'ok'], ['hd', 'ok'], ['fhd', 'weak'], ['uhd', 'no'], ['live', 'ok']], 'speed: 13 Mbps');
    eq(S.verdict(100, 200)[4], ['live', 'weak'], 'speed: high latency makes live TV borderline');
    eq(S.verdict(2, 20).map((x) => x[1]), ['no', 'no', 'no', 'no', 'no'], 'speed: slow line');
    eq(S.versionOf("self.TN_VERSION = '4.3.0';"), '4.3.0', 'version out of version.js');
    eq(S.versionOf(read('version.js')).split('.').length >= 3, true, 'the real version.js states a version');
    eq([S.newer('4.3.0', '4.2.9'), S.newer('4.2.9', '4.2.9'), S.newer('4.2.10', '4.2.9'), S.newer('4.2', '4.2.1')], [true, false, true, false], 'version compare');
    eq([S.size(1536), S.size(5 * 1048576), S.size(3 * 1073741824)], ['2 KB', '5 MB', '3.0 GB'], 'sizes');
  }
  // ---- backup: files, the settings file, founding the document
  {
    const B = require(path.join(WEB, 'backup.js'));
    const SD = require(path.join(WEB, 'syncdoc.js')), WS = require(path.join(WEB, 'websync.js')).make(SD);
    const users = [{id: 'u1', name: 'Dad', created: 1, renamed: 0, deleted: 0}, {id: 'u2', name: 'Kid', created: 2, renamed: 0, deleted: 0}];
    const data = {u1: {history: [{key: 'movie:603', label: 'The Matrix', when: '2026-01-01 10:00'}], favourites: [{kind: 'movie', id: 603, label: 'The Matrix', added: '2026-01-01 10:00'}], removed: [], searches: [{q: 'matrix', ts: 1700000000}], marks: SD.dict()},
      u2: {history: [], favourites: [], removed: [], searches: [{q: 'bluey', ts: 1700000001}], marks: SD.dict()}};
    const store = {users: () => users, current: () => 'u1', data: (id) => data[id]};
    const files = B.makeFiles(store, SD, {tmdb: 'k', helper_token: 'secret'}, 1700000000000);
    ok(B.MARK in files && (B.NOVA + 'users.json') in files && (B.NOVA + 'history.json') in files && (B.NOVA + 'users/u2/search_history.json') in files, 'backup: the build\'s file layout');
    ok(!(B.NOVA + 'users/u2/history.json' in files), 'backup: empty lists are not written');
    ok(!/secret/.test(files[B.WEB]) && !/"tmdb"/.test(files[B.WEB]), 'backup: browser settings without the device-only ones or keys (6.1.7: keys only in the encrypted full backup)');
    const back = B.readFiles(files, SD);
    eq([back.ok, back.current, Object.keys(back.data).sort()], [true, 'u1', ['u1', 'u2']], 'backup: read back');
    eq(back.data.u1.history[0].key, 'movie:603', 'backup: the active user\'s history');
    eq(back.data.u2.searches.map((s) => s.q), ['bluey'], 'backup: another user\'s list');
    eq(B.readFiles({'x.json': '1'}, SD).ok, false, 'backup: not a backup');
    // the settings file
    eq(B.webToKodi({tmdb: ' abc ', gemini_key: 'g', subs_os_key: '', telegram_quiet: false, tgsearch_bots: true, lang: 'he'}, ['https://a.b/x', 'http://no']),
      {tmdb_key: 'abc', gemini_key: 'g', tg_quiet: 'false', bot_request: 'true', stremio_servers: 'https://a.b/x'}, 'settings file: the build\'s names');
    const fromKodi = B.kodiToWeb({settings: {tmdb_key: 'T', gemini_key: 'G', os_key: 'O', st_url: 'https://st.example', st_enabled: 'false', tg_quiet: 'true', bot_request: 'false',
      rd_token: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', api_id: '123456', api_hash: '0123456789abcdef0123456789ABCDEF', phone: '+972', stremio_servers: 'https://a.b/manifest.json stremio://c.d/manifest.json ftp://x'},
      files: {'telescope.session': new Uint8Array([1, 2, 3])}, extra: {}});
    eq(fromKodi.cfg, {tmdb: 'T', gemini_key: 'G', subs_os_key: 'O', stremthru_url: 'https://st.example', stremthru_on: false, telegram_quiet: true, tgsearch_bots: false}, 'settings file: a Kodi export -> browser settings');
    eq([fromKodi.rd.length, fromKodi.api, fromKodi.addons.length], [36, {id: '123456', hash: '0123456789abcdef0123456789abcdef'}, 2], 'settings file: token, API details, Stremio servers');
    ok(!JSON.stringify(fromKodi).includes('session') && !('phone' in fromKodi.cfg), 'settings file: a session and a phone number are never read');
    eq(fromKodi.names, ['TMDb', 'Gemini', 'OpenSubtitles', 'StremThru', 'Real-Debrid', 'Stremio'], 'settings file: what was imported, by name only');
    const fromWeb = B.kodiToWeb({settings: {tmdb_key: 'old'}, extra: {web: {cfg: {tmdb: 'new', yt_key: 'Y', lang: 'ru', helper_token: 'no', 'bad key': 1}}}});
    eq(fromWeb.cfg, {tmdb: 'new', yt_key: 'Y', lang: 'ru'}, 'settings file: a web export wins over the twins, device-only keys dropped');
    eq(B.kodiToWeb({settings: {tmdb_token: 'TT', opensubs_key: 'OO', rd_token: 'x y', api_id: 'abc', api_hash: 'zz'}}).cfg, {tmdb: 'TT', subs_os_key: 'OO'}, 'settings file: the hub\'s own names, bad values ignored');
    eq(B.kodiToWeb(null).names, [], 'settings file: empty');

    // founding the account's document from a browser, then a round of the real sync loop joins it
    const cloud = [];                               // the account's Saved Messages
    let sends = 0;
    const deps = {WS, SD, users: () => users, userData: (id) => data[id], list: async () => cloud.map((m) => ({id: m.id, date: m.date, note: WS.noteOf(m.caption)})),
      seal: async (text) => Buffer.from(text, 'utf8'), send: async (bytes, name, caption) => { sends++; cloud.push({id: 7, date: 1700000100, caption, name, bytes}); return 7; }};
    eq(await B.found(deps), 'made', 'found: the document is created');
    ok(cloud.length === 1 && /^#TeleNovaSetup \{/.test(cloud[0].caption) && cloud[0].name === 'TeleNova-setup-sync-v2.tnsync', 'found: the caption and file name the build looks for');
    eq(WS.noteOf(cloud[0].caption).device, 'sync-v2', 'found: the note of the shared document');
    const made = SD.parse(cloud[0].bytes.toString('utf8'));
    eq([made.users.length, Object.keys(made.data).sort(), Object.keys(made.settings).length, Object.keys(made.files).length], [2, ['u1', 'u2'], 0, 0], 'found: users and lists, no settings, no files');
    eq(await B.found(deps), 'exists', 'found: never a second document');
    eq(sends, 1, 'found: one upload');
    let meta = {}, puts = 0;
    const host = {loadMeta: () => meta, saveMeta: (m) => { meta = m; }, users: () => users, userData: (id) => data[id], setUsers: () => false, putUserData: () => false, takeSettings() {},
      cloudFind: async () => WS.mine(await deps.list()), cloudGet: async () => SD.parse(cloud[0].bytes.toString('utf8')), cloudPut: async () => { puts++; return '8:1'; }};
    const round = await WS.cycle(host, 1700000200);
    eq([round.state, round.pulled, round.pushed, puts], ['ok', true, false, 0], 'found: the next sync round joins the document and has nothing to add');
    eq((await WS.cycle(host, 1700000300)).state, 'idle', 'found: then the loop is quiet');
    let failed = '';
    try { await B.found(Object.assign({}, deps, {list: async () => [], send: async () => 0})); } catch (e) { failed = e.code; }
    eq(failed, 'send', 'found: a failed upload is an error, not a silent success');
  }
  // ---- Google Drive helpers
  {
    const G = require(path.join(WEB, 'gdrive.js'));
    ok(G.clientOk('1234567890-abcdefgh1234.apps.googleusercontent.com') && !G.clientOk('abc') && !G.clientOk('1234567890-abcdefgh1234.apps.googleusercontent.com.evil.io'), 'drive: client id shape');
    const u = new URL(G.authUrl('1234567890-abcdefgh1234.apps.googleusercontent.com', 'https://x.y/web/gdrive_cb.html', 'st8'));
    eq([u.origin + u.pathname, u.searchParams.get('response_type'), u.searchParams.get('scope'), u.searchParams.get('state'), u.searchParams.get('redirect_uri')],
      ['https://accounts.google.com/o/oauth2/v2/auth', 'token', 'https://www.googleapis.com/auth/drive.file', 'st8', 'https://x.y/web/gdrive_cb.html'], 'drive: the consent address');
    ok(!u.searchParams.has('client_secret') && !u.searchParams.has('access_token'), 'drive: no secret in the address');
    eq(G.parseAnswer('#access_token=ya29.A0abcdefghijklmnopqrstuv&expires_in=3599&state=st8&token_type=Bearer'), {state: 'st8', token: 'ya29.A0abcdefghijklmnopqrstuv', expires: 3599, error: ''}, 'drive: the answer');
    eq(G.parseAnswer('#error=access_denied&state=s'), {state: 's', token: '', expires: 0, error: 'access_denied'}, 'drive: refused');
    eq(G.parseAnswer('#access_token=<script>&state=s').token, '', 'drive: a token of the wrong shape is dropped');
    const files = ['e.zip', 'd.zip', 'note.txt', 'c.zip', 'b.zip', 'a.zip'].map((name) => ({name}));
    eq(G.prune(files, 2).map((f) => f.name), ['c.zip', 'b.zip', 'a.zip'], 'drive: keep the newest N backups');
    eq(G.prune(files, 9), [], 'drive: nothing to prune');
    eq(G.prune(files, 0).length, 0, 'drive: a bad number keeps the default five');
    eq([G.rangeOf(0, 100, 250), G.rangeOf(2, 100, 250), G.rangeOf(3, 100, 250), G.rangeOf(0, 100, 0)], [[0, 99], [200, 249], null, null], 'drive: byte ranges');
    ok(G.isVideo({mimeType: 'video/mp4', name: 'a'}) && G.isVideo({mimeType: 'application/octet-stream', name: 'a.MKV'}) && !G.isVideo({mimeType: 'application/zip', name: 'b.zip'}), 'drive: what is a video');
    eq([G.mimeOf({name: 'a.mkv', mimeType: 'video/x-matroska'}), G.mimeOf({name: 'a.mp4', mimeType: 'video/mp4'}), G.mimeOf({name: 'a.webm', mimeType: ''}), G.mimeOf({name: 'a', mimeType: ''})],
      ['video/webm', 'video/mp4', 'video/webm', 'video/mp4'], 'drive: the type the player is told');
    const src = read('gdrive.js') + read('gdrive_cb.js');
    ok(!/localStorage/.test(src.replace(/\/\/.*$/gm, '')), 'drive: the token never goes to localStorage');
    ok(!/alt=media&access_token|[?&]access_token=/.test(read('gdrive.js')), 'drive: the token is never put in an address');
    ok(/Content-Security-Policy/.test(read('gdrive_cb.html')) && /script-src 'self'/.test(read('gdrive_cb.html')), 'drive: the return page has its own strict policy');
  }

  // ================================================================ 3. modules with a stand-in TN: topics, hub, yt, catalog
  {
    const T = makeTN({lang: 'en'});
    for (const f of ['yt', 'topics', 'hub', 'catalog']) T.run(f);
    const sb = T.sandbox;
    // ---- topics
    const TP = sb.TNTopics;
    const vids = [{id: 'a', title: 'PLC basics course', secs: 900, views: 10, age: '2 days ago'}, {id: 'b', title: 'Short clip', secs: 30, views: 99}, {id: 'c', title: 'Ladder logic deep dive', secs: 1200, views: 50, age: '1 day ago'},
      {id: 'a', title: 'dup', secs: 900}, {id: 'd', title: 'x', secs: 900, short: true}];
    eq(TP.select(vids, 480).map((v) => v.id), ['a', 'c'], 'topics: long videos only, no Shorts, no duplicates');
    eq(TP.select(vids, 480, '(?i)LADDER').map((v) => v.id), ['c'], 'topics: the title filter of a category (Python (?i))');
    eq(TP.newestFirst(TP.select(vids, 480)).map((v) => v.id), ['c', 'a'], 'topics: newest first');
    eq(TP.rankTop(vids, 480, 1).map((v) => v.id), ['c'], 'topics: top by views');
    eq(TP.searchLocal(vids, 'plc course').map((v) => v.id), ['a'], 'topics: every word');
    eq(TP.uploadsOf('UCEK3tT7DcfWGWJpNEDBdWog'), 'UUEK3tT7DcfWGWJpNEDBdWog', 'topics: a channel\'s uploads list (plays with no key)');
    eq(TP.uploadsOf('nope'), '', 'topics: not a channel id');
    let chans = 0;
    for (const [sec] of TP.SECTIONS) {
      const cfg = JSON.parse(read('data/topics/' + sec + '.json'));
      const all = TP.allChannels(cfg, sec);
      chans += all.length;
      ok(all.length > 0 && all.every((c) => /^UC[A-Za-z0-9_-]{22}$/.test(c.id) && c.name), 'topics: ' + sec + ' has channels with valid ids');
      ok(cfg.min_seconds >= 0 && (sec === 'dogs' || (cfg.categories || []).length > 0), 'topics: ' + sec + ' has categories');
      for (const c of cfg.categories || []) {
        ok(c.he && c.en && c.ru, `topics: ${sec}/${c.id} named in three languages`);
        ok(fs.existsSync(path.join(WEB, 'data/topics/img/topic_' + c.icon + '.png')), `topics: the picture of ${sec}/${c.id}`);
        if (c.match) ok(typeof (TP.pyRx(c.match) || {}).test === 'function', `topics: ${sec}/${c.id} title filter compiles`);
      }
    }
    ok(chans >= 100, 'topics: about 116 curated channels (' + chans + ')');
    eq(TP.SECTIONS.map((s) => s[0]), ['knowledge', 'news', 'plc', 'smarthome', 'diy', 'dogs', 'asian'], 'topics: the seven sections of the build');
    // ---- hub
    const H = sb.TNHub;
    eq(['live', 'radio', 'tg', 'wide', '', 'movie', 'square', 'nonsense', 'yt'].map(H.shapeOf), ['wide', 'square', 'wide', 'wide', '', '', 'square', '', 'wide'], 'hub: a result kind becomes a card shape, never a CSS class');
    eq(JSON.parse(JSON.stringify(H.parseQuery('Fauda S02E05'))), {show: 'Fauda', season: 2, episode: 5}, 'hub: S02E05');
    eq(JSON.parse(JSON.stringify(H.parseQuery('פאודה עונה 2 פרק 5'))), {show: 'פאודה', season: 2, episode: 5}, 'hub: Hebrew season / episode');
    eq(H.rank([{title: 'Other'}, {title: 'The Matrix Reloaded'}, {title: 'Matrix'}, {title: 'The Matrix'}], 'the matrix').map((x) => x.title), ['The Matrix Reloaded', 'The Matrix', 'Other', 'Matrix'], 'hub: whole phrase first, source order kept');
    eq(H.recentSearches([{q: 'the matrix', ts: 2}, {q: ' ', ts: 1}, 'old text', {q: 'the matrix', ts: 1}, null, {q: 'b'}], 2), ['the matrix', 'old text'], 'hub: the stored searches are rows {q, ts}; the chips show their texts');
    eq(H.linkTarget('https://t.me/movhd/5'), '#/telegram/link=https%3A%2F%2Ft.me%2Fmovhd%2F5', 'hub: a pasted t.me link opens the Telegram page with link=');
    eq(H.linkTarget('youtu.be/dQw4w9WgXcQ'), '#/youtube/url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ', 'hub: a pasted YouTube link opens the YouTube page with url=');
    eq([H.linkTarget('https://www.dailymotion.com/video/x8abc12'), H.linkTarget('https://archive.org/details/abc_def'), H.linkTarget('the matrix')], ['dm:x8abc12', 'ia:abc_def', ''], 'hub: Dailymotion, archive, plain words');
    eq(H.pickDm({qualities: {auto: [{type: 'application/x-mpegURL', url: 'https://a/b.m3u8'}]}}), {url: 'https://a/b.m3u8', mime: 'application/x-mpegURL'}, 'hub: Dailymotion plays from its HLS description');
    eq(H.pickDm({qualities: {auto: [{type: 'application/x-mpegURL', url: 'http://a/b.m3u8'}]}}), null, 'hub: never an http stream');
    ok(H.frameAllowed('www.dailymotion.com', "default-src 'self'; frame-src https://www.youtube-nocookie.com https://www.dailymotion.com") && !H.frameAllowed('www.dailymotion.com', "frame-src https://www.youtube-nocookie.com"), 'hub: the embed is used only where the page policy allows it');
    ok(['tmdb', 'archive', 'dailymotion'].every((p) => T.provs.has(p) && T.provs.get(p).kinds.includes('search')), 'hub: tmdb, archive and dailymotion search providers');
    // ---- yt
    const Y = sb.TNYt, YP = T.provs.get('yt');
    eq(JSON.parse(JSON.stringify(Y.parseLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij12345&t=1m5s'))), {v: 'dQw4w9WgXcQ', list: 'PLabcdefghij12345', start: 65}, 'yt: a watch link with a list and a time');
    eq(JSON.parse(JSON.stringify(Y.parseLink('https://www.youtube.com/@mosfilm'))), {handle: '@mosfilm'}, 'yt: a channel by name');
    eq(JSON.parse(JSON.stringify(Y.parseLink('https://www.youtube.com/channel/UCEK3tT7DcfWGWJpNEDBdWog'))), {ch: 'UCEK3tT7DcfWGWJpNEDBdWog'}, 'yt: a channel by id');
    eq(Y.parseLink('https://evil.example/watch?v=dQw4w9WgXcQ'), null, 'yt: only YouTube hosts');
    const fv = Y.favView({kind: 'web_yt', id: 'dQw4w9WgXcQ', label: 'Song', extra: 'plugin://plugin.video.youtube/play/?video_id=dQw4w9WgXcQ'});
    eq([fv.kind, fv.id, fv.label, /^https:\/\/i\.ytimg\.com\//.test(fv.img), typeof fv.open], ['web_yt', 'dQw4w9WgXcQ', 'Song', true, 'function'], 'yt: a favourite in the {kind, id, label, img, open} shape app.js can show');
    eq(Y.favView({kind: 'x', id: '1', label: 'Kodi', extra: 'plugin://plugin.video.youtube/play/?video_id=dQw4w9WgXcQ'}).id, 'dQw4w9WgXcQ', 'yt: a favourite Kodi wrote plays too');
    eq(Y.favView({kind: 'movie', id: 603, label: 'x'}), null, 'yt: not a YouTube favourite');
    ok(/youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/.test(Y.embed('dQw4w9WgXcQ', 0)) && /list=UUabc1234567/.test(Y.embedList('UUabc1234567')), 'yt: the embed plays a video and a whole list with no key');
    eq([YP.ready(), await YP.search('x'), (await YP.sources({title: 'x'})).length], [false, [], 0], 'yt: with no key and no helper the lists are empty, not an error');
    T.TN.settings.set('helper', 'https://h.example.workers.dev');
    eq([YP.ready(), YP.mode()], [true, 'helper'], 'yt: the helper is the key-less path');
    T.TN.settings.set('helper', '');
    // ---- catalog (C01-C18)
    const C = T.provs.get('catalog');
    const keysOf = (m) => C.roots(m).map((r) => r.key);
    for (const k of ['cat_trending', 'cat_popular', 'cat_top', 'cat_now', 'cat_upcoming', 'cat_il_movies', 'cat_family', 'cat_docu', 'cat_g_hebrew', 'cat_g_russian', 'cat_g_kids', 'cat_genres', 'cat_langs', 'cat_years'])
      ok(keysOf('movie').includes(k), 'catalog: Movies has ' + k);
    for (const k of ['cat_il_series', 'cat_on_air', 'cat_airing', 'cat_kids_tv', 'cat_tr', 'cat_ko', 'cat_kukhnya', 'cat_genres', 'cat_langs', 'cat_years'])
      ok(keysOf('tv').includes(k), 'catalog: Series has ' + k);
    const soviet = C.groupRows('russian').find((r) => r.key === 'cat_soviet');
    eq([soviet.def['primary_release_date.lte'], soviet.def.with_original_language], ['1991-12-31', 'ru'], 'catalog: Soviet films are Russian films up to 1991');
    ok(C.groupRows('kids').length === 3 && C.groupRows('hebrew').length >= 6, 'catalog: the Kids and Hebrew groups');
    eq(C.LANGS.length, 11, 'catalog: eleven languages');
    eq([C.years(2026)[0], C.years(2026).slice(-1)[0]], [2026, 1950], 'catalog: years back to 1950');
    eq(C.query({m: 'movie', v: 'list', title: 'x', path: '/discover/movie', with_genres: '99'}, 2), {with_genres: '99', 'vote_count.gte': '15', page: '2'}, 'catalog: a discover list hides stubs');
    eq(C.cineUrl({m: 'tv', cat: 'top', genre: 'Drama'}, 2), 'https://v3-cinemeta.strem.io/catalog/series/top/genre=Drama&skip=50.json', 'catalog: the key-less list address');
    eq(C.cineUrl({m: 'movie', q: 'the matrix'}, 1), 'https://v3-cinemeta.strem.io/catalog/movie/top/search=the%20matrix.json', 'catalog: the key-less search');
    const cn = C.cineNorm({id: 'tt0133093', name: 'The Matrix', releaseInfo: '1999', poster: 'https://img/x.jpg', imdbRating: '8.7'}, 'movie');
    eq([cn.id, cn.title, cn.release_date, cn.cine, cn.vote_average], ['tt0133093', 'The Matrix', '1999', true, 8.7], 'catalog: a Cinemeta row as a catalogue row');
    eq(C.cineNorm({id: 'x', name: 'bad'}, 'movie'), null, 'catalog: a row without an IMDb id is dropped');
    eq(Object.keys(C.cineSeasons({videos: [{season: 1, episode: 2, name: 'b'}, {season: 1, episode: 1, name: 'a'}, {season: 2, number: 1}]})).length, 2, 'catalog: key-less seasons');
    ok(C.cineRoots('movie').length >= 6, 'catalog: the key-less root is never empty');
    eq([C.statesEpisode('Show.S01E02.720p'), C.statesEpisode('Film.2019.1080p')], [true, false], 'catalog: which Telegram files state an episode');
    eq(C.continueRows('tv').length, 0, 'catalog: no history, no "continue" row');
    // every local picture the catalogue points to
    for (const m of ['movie', 'tv']) for (const id of C.GENRES[m]) ok(fs.existsSync(path.join(WEB, 'media/cats/genre_' + id + '.png')), 'catalog: genre picture ' + id);
    for (const l of C.LANGS) ok(fs.existsSync(path.join(WEB, 'media/cats/lang_' + l + '.png')), 'catalog: language picture ' + l);
  }
  // every local file these modules name exists
  for (const f of FILES) {
    for (const m of read(f + '.js').matchAll(/'((?:media\/cats|data\/topics\/img|data\/help)\/[\w.-]+\.(?:png|json))'/g)) ok(fs.existsSync(path.join(WEB, m[1])), f + '.js: ' + m[1] + ' exists');
  }
  ok(fs.existsSync(path.join(WEB, 'gdrive_cb.html')) && /gdrive_cb\.js/.test(read('gdrive_cb.html')), 'the Drive return page');

  // ================================================================ 4. pages draw (no key / with keys, three languages)
  const cases = [
    ['hub', ''], ['search', 'https://youtu.be/dQw4w9WgXcQ'], ['youtube', ''], ['youtube', 'url=' + encodeURIComponent('https://youtu.be/dQw4w9WgXcQ')], ['youtube', 'link=PLabcdefghij12345'],
    ['youtube', 'q=news'], ['topics', ''], ['topics', 'q=plc'], ['topics', 's=news'], ['topics', 's=news&c=news_il'], ['topics', 's=dogs&top=1'], ['topics', 's=news&latest=1'],
    ['movies', ''], ['tv', ''], ['catalog', 'm=movie&v=group&g=russian'], ['catalog', 'm=tv&v=cgenres'], ['catalog', 'm=movie&v=cyears'], ['catalog', 'm=movie&v=search&q=matrix'],
    ['help', ''], ['help', 'q=telegram'], ['library', ''], ['services', ''], ['device', ''], ['gdrive', ''], ['backup', ''], ['status', ''],
  ];
  for (const lang of ['he', 'en', 'ru']) {
    for (const withKeys of [false, true]) {
      const jsonFetch = async (url) => {
        const u = String(url);
        const local = /^data\//.test(u) ? path.join(WEB, u.split('?')[0]) : '';
        if (local && fs.existsSync(local)) return {ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(local, 'utf8')), text: async () => fs.readFileSync(local, 'utf8'), headers: {get: () => null}};
        if (/^version\.js/.test(u)) return {ok: true, status: 200, text: async () => read('version.js'), headers: {get: () => null}};
        throw new TypeError('no network in the tests');
      };
      const T = makeTN({lang, fetch: jsonFetch, tmdb: withKeys ? {results: [], total_results: 5, genres: []} : null,
        cfg: withKeys ? {tmdb: '0123456789abcdef0123456789abcdef', yt_key: 'k'.repeat(39), gemini_key: 'g'.repeat(39), helper: 'https://h.example.workers.dev', gdrive_client: '1234567890-abcdefgh1234.apps.googleusercontent.com',
          subs_os_key: 'o'.repeat(32), subs_server_url: 'https://srv.example', providers_off: ['hub', 'subs']} : {},
        favs: [{kind: 'web_yt', id: 'dQw4w9WgXcQ', label: 'Song', extra: ''}], history: [{key: 'yt:dQw4w9WgXcQ', label: 'Song'}, {key: 'tv:1399:1:2', label: 'Show'}]});
      T.TN.SyncDoc = require(path.join(WEB, 'syncdoc.js'));
      T.TN.WebSync = require(path.join(WEB, 'websync.js')).make(T.TN.SyncDoc);
      // the neighbours these pages talk to, as small stand-ins
      T.TN.registerProvider('rd', {kinds: ['source'], hasToken: () => withKeys, setToken: () => true, servicesPanel: (el) => { el.textContent = 'rd panel'; }, user: async () => ({username: 'u', type: 'premium', expiration: '2027-01-01T00:00:00'})});
      T.TN.registerProvider('sources', {kinds: ['service'], addons: () => (withKeys ? ['https://a.b/x'] : []), setAddons() {}, addonBase: (u) => u});
      T.TN.registerProvider('subs', {kinds: ['service'], ktuvitLogin: async () => {}, ktuvitLogged: () => false, ktuvitLogout() {}});
      for (const f of FILES) T.run(f);
      const tag = `[${lang}${withKeys ? ', keys' : ''}]`;
      for (const [key, arg] of cases) {
        ok(typeof T.pages[key] === 'function', `page ${key} is registered ${tag}`);
        const before = T.dom.texts.length;
        let err = null;
        try { await T.pages[key](arg, ctxOf(arg)); } catch (e) { err = e; }
        ok(!err, `page #/${key}/${arg} draws ${tag}: ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`);
        ok(T.dom.texts.length > before, `page #/${key}/${arg} puts something on the screen ${tag}`);
        const junk = T.dom.texts.slice(before).find((x) => /\[object Object\]|undefined|NaN/.test(x.replace(/<style[\s\S]*?<\/style>/g, '')));
        ok(!junk, `page #/${key}/${arg} shows no "[object Object]" / "undefined" / "NaN" ${tag}: ${String(junk).slice(0, 160)}`);
      }
      if (withKeys) eq(T.cfg.providers_off, ['dailymotion', 'archive', 'wizdom', 'opensubs', 'yify', 'ktuvit', 'subsrv', 'subs_ai'], 'library page: the old switch names are replaced ' + tag);
      ok(T.TN._kodiOnly === 0, 'no page sent the viewer to Kodi ' + tag);
      ok(T.TN._shapes.every((s) => ['', 'wide', 'square', undefined, null].includes(s)), 'every card has a known shape ' + tag);
      // every handler of the last pages can be pressed without a crash (no network: each must fail softly)
      let crashed = '';
      for (const [label, fn] of T.dom.handlers.slice(-400)) {
        try { const r = fn({preventDefault() {}, stopPropagation() {}, target: T.dom.el('x'), origin: 'https://example.github.io', data: null}); if (r && typeof r.then === 'function') await r.catch((e) => { crashed = crashed || label + ': ' + e; }); } catch (e) { crashed = crashed || label + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e); }
      }
      ok(!crashed, `pressing the buttons does not crash ${tag}: ${crashed}`);
    }
  }
  // ================================================================ 5. Google Drive signed in: browse, play, backup list, sync (a scripted Drive)
  {
    const calls = [], auth = [];
    const drive = {
      root: [{id: 'folderBN123', name: 'BN Stream', mimeType: 'application/vnd.google-apps.folder'}],
      folderBN123: [{id: 'folderBK123', name: 'Backups', mimeType: 'application/vnd.google-apps.folder'}, {id: 'folderSY123', name: 'Sync', mimeType: 'application/vnd.google-apps.folder'},
        {id: 'vid0000001', name: 'holiday.mp4', mimeType: 'video/mp4', size: '1000', modifiedTime: '2026-11-01T10:00:00Z', webViewLink: 'https://drive.google.com/file/d/vid0000001/view'},
        {id: 'doc0000001', name: 'notes.txt', mimeType: 'text/plain', size: '10'}],
      folderBK123: [{id: 'zip0000001', name: 'bn_backup_web_20261101_1000.zip', mimeType: 'application/zip', size: '2048', modifiedTime: '2026-11-01T10:00:00Z'}],
      folderSY123: [{id: 'fav0000001', name: 'favourites.json', mimeType: 'application/json'}],
    };
    const res = (body, status) => ({ok: (status || 200) < 300, status: status || 200, json: async () => body, text: async () => JSON.stringify(body),
      arrayBuffer: async () => (body instanceof Uint8Array ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : new TextEncoder().encode(JSON.stringify(body)).buffer), headers: {get: () => null}});
    const fetchDrive = async (url, o) => {
      const u = new URL(String(url)), h = (o && o.headers) || {};
      calls.push((o && o.method || 'GET') + ' ' + u.pathname + (h.Range ? ' ' + h.Range : ''));
      auth.push(h.Authorization || '');
      ok(!/access_token|ya29/.test(u.search), 'drive: no token in the address of ' + u.pathname);
      if (u.hostname === 'oauth2.googleapis.com') return res({});
      if (u.pathname === '/drive/v3/about') return res({user: {displayName: 'Dana'}, storageQuota: {usage: '1048576', limit: '16106127360'}});
      if (u.pathname === '/drive/v3/files' && (!o || !o.method || o.method === 'GET')) {
        const q = u.searchParams.get('q') || '';
        const parent = (q.match(/^'([^']+)' in parents/) || [])[1], name = (q.match(/name='([^']+)'/) || [])[1];
        let list = drive[parent] || [];
        if (/mimeType='application\/vnd.google-apps.folder'/.test(q)) list = list.filter((f) => /folder$/.test(f.mimeType));
        if (name) list = list.filter((f) => f.name === name);
        return res({files: list});
      }
      if (/^\/drive\/v3\/files\/vid0000001$/.test(u.pathname) && h.Range) { const m = /bytes=(\d+)-(\d+)/.exec(h.Range); return res(new Uint8Array(Number(m[2]) - Number(m[1]) + 1), 206); }
      if (/^\/drive\/v3\/files\/fav0000001$/.test(u.pathname)) return res([{kind: 'movie', id: 11, label: 'Star Wars', added: '2026-10-01 10:00'}]);
      if (/^\/upload\/drive\/v3\/files/.test(u.pathname)) return res({id: 'new0000001'});
      return res({}, 404);
    };
    const session = {tn_gd: JSON.stringify({token: 'ya29.TESTTOKENTESTTOKENTESTTOKEN', until: Date.now() + 3000000})};
    const T = makeTN({lang: 'en', fetch: fetchDrive, session, cfg: {gdrive_client: '1234567890-abcdefgh1234.apps.googleusercontent.com'}});
    T.TN.SyncDoc = require(path.join(WEB, 'syncdoc.js'));
    let source = null, played = null;
    T.TN.registerProvider('tgplay', {kinds: ['service'], openSource: async (s) => { source = s; return {key: 'k1', url: 'https://example.github.io/web/tgstream/k1'}; }, close() {}});
    T.TN.registerProvider('player', {kinds: ['service'], open: async (o) => { played = o; }});
    T.run('gdrive');
    const G = T.provs.get('gdrive');
    ok(G.ready(), 'drive: a token kept by the return page signs this tab in');
    await T.pages.gdrive('', ctxOf(''));
    const shown = T.dom.texts.join('\n');
    ok(/holiday\.mp4/.test(shown) && /notes\.txt/.test(shown) && /bn_backup_web_20261101_1000\.zip/.test(shown), 'drive: videos, files and backups are listed');
    ok(auth.every((a) => a === 'Bearer ya29.TESTTOKENTESTTOKENTESTTOKEN'), 'drive: the token travels in the Authorization header of every request');
    // play: Range requests -> the stream proxy -> the site player
    await G.play(drive.folderBN123[2]);
    ok(source && source.size === 1000 && source.mime === 'video/mp4' && played && played.url === 'https://example.github.io/web/tgstream/k1' && played.resumeKey === 'gd:vid0000001', 'drive: a video plays in the site player through the stream proxy');
    const part = await source.readPart(0, 512);
    eq([part.length, calls.filter((c) => /bytes=0-511/.test(c)).length], [512, 1], 'drive: a part is one Range request');
    eq((await source.readPart(1, 512)).length, 488, 'drive: the last part is short');
    eq((await source.readPart(5, 512)).length, 0, 'drive: nothing past the end');
    // no service worker: a small file is read whole
    T.provs.get('tgplay').openSource = async () => { throw Object.assign(new Error('TGPLAY_NO_SW'), {code: 'TGPLAY_NO_SW'}); };
    T.sandbox.URL = Object.assign(function (...a) { return new URL(...a); }, {createObjectURL: () => 'blob:x', revokeObjectURL() {}});
    played = null;
    await G.play(drive.folderBN123[2]);
    eq(played && played.url, 'blob:x', 'drive: without a service worker a small file is loaded whole');
    let big = '';
    try { await G.play({id: 'vid0000002', name: 'big.mkv', mimeType: 'video/x-matroska', size: String(400 * 1024 * 1024)}); } catch (e) { big = e.code; }
    eq(big, 'too_big', 'drive: a large file without a service worker says so (the page then offers "Open in Google Drive")');
    // sync: the Drive copy of the favourites is merged into the active user's and written back
    const before = calls.length;
    const nums = await G.syncNow();
    eq(nums[0], 1, 'drive sync: the favourite kept on Drive is counted');
    ok(T.TN.store.favs().some((f) => f.id === 11), 'drive sync: the favourite from Drive is in the store');
    ok(calls.slice(before).filter((c) => /^(PATCH|POST) \/upload/.test(c)).length === 3, 'drive sync: the three files are written back');
    // an expired token is an explained state, never a crash
    session.tn_gd = JSON.stringify({token: 'ya29.TESTTOKENTESTTOKENTESTTOKEN', until: Date.now() - 1});
    const T2 = makeTN({lang: 'he', fetch: fetchDrive, session, cfg: {gdrive_client: '1234567890-abcdefgh1234.apps.googleusercontent.com'}});
    T2.run('gdrive');
    ok(!T2.provs.get('gdrive').ready(), 'drive: an expired token is signed out');
    let e2 = null;
    try { await T2.pages.gdrive('err=denied', ctxOf('err=denied')); } catch (e) { e2 = e; }
    ok(!e2 && /Google/.test(T2.dom.texts.join(' ')), 'drive: the signed-out page draws, with the refusal explained');
  }
  // ================================================================ 6. the real sealed format (when run_web_tests.py has fetched fflate; else skipped)
  {
    const lib = process.argv[2] || path.join(require('os').tmpdir(), 'telenova-web-tests', 'fflate-0.8.2.umd.js');
    if (fs.existsSync(lib) && globalThis.crypto && globalThis.crypto.subtle) {
      const SL = require(path.join(WEB, 'sealed.js')).use(require(lib));
      const B = require(path.join(WEB, 'backup.js')), SD = require(path.join(WEB, 'syncdoc.js')), WS = require(path.join(WEB, 'websync.js')).make(SD);
      const cfg = {tmdb: '0123456789abcdef0123456789abcdef', gemini_key: 'G'.repeat(39), telegram_quiet: true, lang: 'he'};
      for (const pw of ['', 'סיסמה 1']) {
        const file = await SL.pack(B.webToKodi(cfg, ['https://a.b/x']), {}, pw, {web: {cfg, v: '9'}, app: 'telenova-web'});
        const head = SL.header(file)[0];
        eq([head.encrypted, head.has_session, head.format], [!!pw, false, 1], 'settings file: the build\'s header, never a session' + (pw ? ' (password)' : ''));
        const back = B.kodiToWeb(await SL.unpack(file, pw));
        eq(back.cfg, cfg, 'settings file: export -> import gives the same browser settings' + (pw ? ' (password)' : ''));
        eq((await SL.unpack(file, pw)).settings, {tmdb_key: cfg.tmdb, gemini_key: cfg.gemini_key, tg_quiet: 'true', stremio_servers: 'https://a.b/x'}, 'settings file: what Kodi reads from it');
        if (pw) { let code = ''; try { await SL.unpack(file, 'wrong'); } catch (e) { code = e.code; } eq(code, 'wrong_password', 'settings file: a wrong password is refused'); }
      }
      // the founded document, sealed as the build seals it, opens with the account's key and holds the users
      const users = [{id: 'u1', name: 'A', created: 1, renamed: 0, deleted: 0}], data = {u1: {history: [], favourites: [], removed: [], searches: [{q: 'x', ts: 1700000000}], marks: SD.dict()}};
      let sentBytes = null;
      const key = SL.cloudKey(123456789);
      await B.found({WS, SD, users: () => users, userData: (id) => data[id], list: async () => [], seal: (text) => SL.packDoc(text, key, WS.NOTE), send: async (b) => { sentBytes = b; return 1; }});
      const doc = SD.parse(await SL.unpackDoc(sentBytes, key));
      eq([doc.users[0].id, doc.data.u1.searches.map((s) => s.q), SD.same(doc, SD.merge(doc, SD.empty()))], ['u1', ['x'], true], 'found: the sealed document opens with the account\'s key, in the merged form');
    } else console.log('t_content: (the sealed-file round trip is skipped: fflate is not cached yet - run run_web_tests.py once)');
  }
  console.log(bad ? `t_content: ${bad} of ${n} checks FAILED` : `t_content OK (${n} checks)`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL t_content crashed:', e && e.stack || e); process.exit(1); });
