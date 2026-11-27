'use strict';
// node t_shell.js - the plain-logic part of the web shell (web/shell_core.js): device detection, navigation tables,
// provider switches, history targets, "continue watching", home rows, focus geometry. No DOM, no network.
const path = require('path');
const SC = require(path.join(__dirname, '..', '..', '..', 'web', 'shell_core.js'));
let n = 0, fails = 0;
function ok(c, m) { n++; if (!c) { fails++; console.log('FAIL', m); } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ')');

// ---- device
for (const ua of ['Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0)', 'Mozilla/5.0 (Web0S; Linux/SmartTV)', 'Mozilla/5.0 (Linux; Android 11; AFTKA)',
  'Mozilla/5.0 (Linux; Android 12; BRAVIA 4K)', 'Mozilla/5.0 (Linux; VIDAA 6.0)', 'Roku/DVP-12.0', 'Mozilla/5.0 (X11; Linux) HbbTV/1.5'])
  ok(SC.isTvUA(ua), 'TV user agent: ' + ua);
for (const ua of ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', '', null])
  ok(!SC.isTvUA(ua), 'not a TV: ' + ua);
eq(SC.pickShell('auto', false, 375), 'phone', 'narrow window is a phone');
eq(SC.pickShell('auto', false, 800), 'tablet', '800 px is a tablet');
eq(SC.pickShell('auto', false, 1400), 'desktop', 'wide window is a desktop');
eq(SC.pickShell('auto', true, 1920), 'tv', 'TV browser');
eq(SC.pickShell('phone', true, 1920), 'phone', "the viewer's choice wins");
eq([SC.posterSize('phone', 1), SC.posterSize('phone', 3), SC.posterSize('desktop', 1), SC.posterSize('tv', 1)], ['w185', 'w342', 'w342', 'w342'], 'poster sizes');
// 6.5.1: a TV asks for w500 only when it really draws more than 2000 device pixels across
eq([SC.posterSize('tv', 1, 3840), SC.posterSize('tv', 2, 1920), SC.posterSize('tv', 1.5, 1280), SC.posterSize('tv', 2, 960), SC.posterSize('tv', 1, 1920), SC.posterSize('desktop', 2)],
   ['w500', 'w500', 'w342', 'w342', 'w342', 'w500'], 'TV poster size follows the real pixel width');
// 6.5.1: the language of a first visit
eq([SC.pickLang(['uk', 'ru']), SC.pickLang(['de', 'en-US']), SC.pickLang(['iw-IL']), SC.pickLang(['he']), SC.pickLang(['fr', 'de']), SC.pickLang(['ru-RU', 'he']),
    SC.pickLang('en_GB'), SC.pickLang([]), SC.pickLang(undefined), SC.pickLang([null, '']), SC.pickLang(['EN']), SC.pickLang([42, {}, 'ru'])],
   ['ru', 'en', 'he', 'he', 'en', 'ru', 'en', 'he', 'he', 'he', 'en', 'ru'], 'pickLang: first supported entry, English for other languages, Hebrew with no information');
// 6.5.1: storage whose refused writes are read back
{
  const back = {a: 'old'};
  let fail = true, calls = [];
  const ls = {getItem: (k) => (k in back ? back[k] : null), setItem: (k, v) => { if (fail) throw new Error('QuotaExceededError'); back[k] = String(v); }, removeItem: (k) => { delete back[k]; }};
  const st = SC.makeSafeStore(() => ls, (k) => calls.push(k));
  eq(st.getItem('a'), 'old', 'safeStore reads the storage');
  st.setItem('a', 'new');
  eq([st.getItem('a'), back.a, calls], ['new', 'old', ['a']], 'a refused write is read back from memory, and reported');
  st.setItem('a', 'newer');
  eq([st.getItem('a'), calls.length], ['newer', 2], 'every refused write is reported (once per visit is the caller\'s rule)');
  fail = false;
  st.setItem('a', 'stored');
  back.a = 'changed elsewhere';
  eq(st.getItem('a'), 'changed elsewhere', 'a write that worked leaves no stale copy in memory');
  fail = true;
  st.setItem('b', 1);
  st.removeItem('b'); st.removeItem('a');
  eq([st.getItem('b'), st.getItem('a')], [null, null], 'removeItem clears the storage and the memory copy');
  const none = SC.makeSafeStore(() => { throw new Error('SecurityError'); });
  eq(none.getItem('x'), null, 'a browser that refuses storage reads null');
  none.setItem('x', 'v');
  eq(none.getItem('x'), 'v', '... and keeps this visit in memory');
  const boom = SC.makeSafeStore(() => { throw new Error('x'); }, () => { throw new Error('notice failed'); });
  boom.setItem('k', '1');
  eq(boom.getItem('k'), '1', 'a failing notice never breaks the write');
}
eq([SC.backdropSize('phone'), SC.backdropSize('tv')], ['w780', 'w1280'], 'backdrop sizes');

// ---- navigation tables
const keys = SC.MENU.map((m) => m[0]);
ok(new Set(keys).size === keys.length, 'menu keys are unique');
ok(SC.MENU.every((m) => SC.GROUPS.indexOf(m[2]) >= 0), 'every menu item is in a known group');
for (const k of Object.keys(SC.PARENT)) ok(SC.PARENT[k] === '' || keys.indexOf(SC.PARENT[k]) >= 0 || SC.PARENT[k] === 'menu', 'parent of ' + k + ' exists');
eq(SC.parentOf('title', 'tv/1399'), 'tv', 'a series page goes back to Series');
eq(SC.parentOf('title', 'movie/603'), 'movies', 'a film page goes back to Movies');
eq(SC.parentOf('catalog', 'm=tv&list=popular'), 'tv', 'a series list goes back to Series');
eq(SC.parentOf('nosuchpage'), '', 'unknown page goes home');
eq(SC.parentOf('hasOwnProperty'), '', 'no prototype leak');
eq(SC.backHash('searchhist'), '#/hub', 'back from the search history');
eq(SC.navOwner('title', 'tv/1', SC.RAIL), 'tv', 'rail item of a series page');
eq(SC.navOwner('status', '', SC.RAIL), 'menu', 'rail item of a system page');
eq(SC.navOwner('favs', '', SC.TABS), 'mine', 'phone tab of Favourites');
eq(SC.navOwner('tglogin', '', SC.TABS), 'menu', 'phone tab of the Telegram sign-in');
eq(SC.navOwner('', '', SC.TABS), '', 'home is its own tab');
// 6.5.1: a page that is not on the bar and only leads back to Home lights nothing (Home is lit on Home alone)
eq(SC.navOwner('movies', '', SC.TABS), null, 'phone: Movies lights no tab');
eq(SC.navOwner('title', 'tv/1', SC.TABS), null, 'phone: a title page lights no tab');
eq(SC.navOwner('telegram', '', SC.TABS), null, 'phone: Telegram lights no tab');
eq(SC.navOwner('radio', '', SC.TABS), null, 'phone: Radio lights no tab');
eq(SC.navOwner('nosuchpage', '', SC.TABS), null, 'an unknown page lights no tab');
eq(SC.navOwner('youtube', '', SC.TABS), 'menu', 'phone: YouTube lights More');
eq(SC.navOwner('live', '', SC.TABS), 'live', 'phone: Live is its own tab');
eq(SC.navOwner('movies', '', SC.RAIL), 'movies', 'rail: Movies is its own item');
eq(SC.navOwner('', '', SC.RAIL), '', 'rail: home is its own item');

// ---- provider switches
ok(SC.providerOnIn([], 'wizdom') && SC.providerOnIn(null, 'rd'), 'everything is on by default');
ok(!SC.providerOnIn(['subs'], 'wizdom') && !SC.providerOnIn(['subs'], 'subs_ai'), "'subs' switches every subtitle provider off");
ok(!SC.providerOnIn(['hub'], 'dailymotion') && SC.providerOnIn(['hub'], 'rd'), "'hub' switches its three providers off, not the others");
ok(!SC.providerOnIn(['rd'], 'rd'), 'a provider by its own name');

// ---- history
eq(SC.httpsOnly('http://a/b'), '', 'http is not accepted');
eq(SC.httpsOnly('https://a/b'), 'https://a/b', 'https is');
eq(SC.picOf({thumb: 'image://https%3a%2f%2fa.example%2fp.jpg/'}), 'https://a.example/p.jpg', "Kodi's image:// address is decoded");
eq(SC.picOf({thumb: 'image://%E0%A4%A/'}), '', 'a broken address gives no picture');
eq(SC.picOf({thumb: 'special://home/x.png'}), '', 'a Kodi path gives no picture');
eq(SC.histTarget({key: 'movie:603'}), {type: 'title', media: 'movie', id: '603'}, 'film');
eq(SC.histTarget({key: 'tv:1399:2:5'}), {type: 'title', media: 'tv', id: '1399', season: '2', episode: '5'}, 'episode');
eq(SC.histTarget({key: 'ch:il:kan11'}).type, 'il', 'Israeli channel');
eq(SC.histTarget({key: 'radio:abc', play: 'http://x/y'}).type, 'kodi', 'http radio plays in Kodi only');
eq(SC.histTarget({key: 'radio:abc', play: 'https://x/y'}).type, 'radio', 'https radio plays here');
eq(SC.histTarget({key: 'yt:dQw4w9WgXcQ'}), {type: 'module', module: 'yt'}, 'YouTube');
eq(SC.histTarget({key: 'tg:1:2'}), {type: 'module', module: 'tgsearch'}, 'Telegram file');
eq(SC.histTarget({key: 'x', play: 'plugin://plugin.video.nova/?a=play&m=movie&id=603'}), {type: 'title', media: 'movie', id: '603'}, "Kodi's address of a film opens its page");
eq(SC.histTarget({key: 'x', play: 'plugin://plugin.video.other/?id=603'}).type, 'kodi', "another add-on's address plays in Kodi only");
eq(SC.histTarget({key: 'x', play: 'https://a/b.m3u8?t=1'}).type, 'stream', 'an https stream');
eq(SC.histTarget(null).type, 'kodi', 'an empty entry never throws');

const H = [
  {key: 'tv:1:1:3', progress: {t: 600, d: 2400}},        // newest episode of series 1: shown
  {key: 'tv:1:1:2', progress: {t: 900, d: 2400}},        // older episode of the same series: hidden
  {key: 'movie:1', progress: {t: 60, d: 7200}},          // under 2 minutes and under 3 %: not started
  {key: 'movie:2', progress: {t: 7100, d: 7200}},        // under 3 minutes left: finished
  {key: 'movie:3', progress: {t: 3600, d: 7200}},        // half way
  {key: 'movie:4', progress: {t: 30, d: 600}},           // 5 % of a short clip: started
  {key: 'movie:5'}, null, {key: 'movie:6', progress: 'x'},
];
const cw = SC.continueWatching(H);
eq(cw.map((x) => x.entry.key), ['tv:1:1:3', 'movie:3', 'movie:4'], 'continue watching: started, unfinished, one per series');
eq([cw[1].frac, cw[1].left], [0.5, 3600], 'fraction and time left');
eq(SC.continueWatching(H, 1).length, 1, 'limit');
eq(SC.continueWatching(null), [], 'no history');
eq([SC.leftText(5400), SC.leftText(240), SC.leftText(5)], ['1:30', '0:04', '0:01'], 'time left as text');
const kp = SC.kodiPlay({key: 'movie:603', label: 'The Matrix'});
ok(/^plugin:\/\/plugin\.video\.nova\/\?a=play&m=movie&id=603&q=The\+Matrix$/.test(kp.play), 'a film started here gets a Kodi address');
eq(SC.kodiPlay({key: 'movie:603', play: 'x'}).play, 'x', 'an existing address is kept');
eq(SC.kodiPlay({key: 'ch:il:kan11'}).play, undefined, 'only films');

// ---- home rows
const rows = SC.homeRows([{id: 'radio', on: false}, {id: 'nosuch'}, {id: 'radio'}, null, {id: 'live'}]);
eq(rows.slice(0, 3), [{id: 'mainmenu', on: true}, {id: 'radio', on: false}, {id: 'live', on: true}], "the viewer's order and switches are kept; the main menu (new in 5.2) goes first");
eq(SC.homeRows([{id: 'live'}, {id: 'mainmenu', on: false}]).slice(0, 2), [{id: 'live', on: true}, {id: 'mainmenu', on: false}], 'a viewer who moved or hid the main menu keeps that');
eq(rows.length, SC.HOME_ROWS.length, 'new rows are appended, unknown and repeated ones dropped');
eq(SC.homeRows(null).map((r) => r.id), SC.HOME_ROWS, 'default order');
eq(SC.moveRow(rows, 'live', -1).slice(0, 3).map((r) => r.id), ['mainmenu', 'live', 'radio'], 'move up');
eq(SC.moveRow(rows, 'mainmenu', -1).map((r) => r.id), rows.map((r) => r.id), 'the first row cannot move up');

// ---- focus geometry: 7 items in 3 columns
//   0 1 2
//   3 4 5
//   6
eq([SC.gridStep(0, 7, 3, 'right'), SC.gridStep(2, 7, 3, 'right'), SC.gridStep(1, 7, 3, 'left'), SC.gridStep(0, 7, 3, 'left')], [1, -1, 0, -1], 'left / right');
eq([SC.gridStep(0, 7, 3, 'left', true), SC.gridStep(1, 7, 3, 'right', true), SC.gridStep(2, 7, 3, 'left', true)], [1, 0, -1], 'right to left: the next item is on the left');
eq([SC.gridStep(4, 7, 3, 'up'), SC.gridStep(1, 7, 3, 'up'), SC.gridStep(3, 7, 3, 'down'), SC.gridStep(5, 7, 3, 'down'), SC.gridStep(6, 7, 3, 'down')], [1, -1, 6, 6, -1], 'up / down, short last row');
eq(SC.gridStep(9, 7, 3, 'up'), -1, 'an index outside the grid');
const R = (l, t, w, h) => ({left: l, top: t, right: l + (w || 100), bottom: t + (h || 100)});
const cur = R(200, 200);
const rects = [R(0, 200), R(400, 200), R(200, 0), R(200, 400), R(400, 0), R(900, 210), cur];
eq([SC.pickDir(cur, rects, 'left'), SC.pickDir(cur, rects, 'right'), SC.pickDir(cur, rects, 'up'), SC.pickDir(cur, rects, 'down')], [0, 1, 2, 3], 'the nearest item in each direction; never itself');
eq(SC.pickDir(R(0, 0), [R(0, 0)], 'right'), -1, 'nothing in that direction');
eq(SC.pickDir(cur, [null, R(400, 600), R(700, 200)], 'right'), 2, 'the item on the same line wins over a nearer one far below');
eq(SC.pickOverlap(R(210, 0), [R(0, 300), R(200, 300), R(400, 300), R(200, 500)], 'down'), 1, 'entering a group from above: the top item under the focus');
eq(SC.pickOverlap(cur, [], 'down'), -1, 'an empty group');

console.log(fails ? 't_shell FAILED ' + fails + ' of ' + n : 't_shell OK (' + n + ' checks)');
process.exit(fails ? 1 : 0);
