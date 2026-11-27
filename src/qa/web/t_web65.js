// 6.5.0 regressions (source level): Drive no-SW fallback, lite danger buttons, More actions menu filter
'use strict';
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..', '..', '..', 'web');
const rd = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');
let bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } };

// gdrive.js must fall back for every TGPLAY_NO_SW* code (TGPLAY_NO_SW_RELOAD after Shift+Reload)
const g = rd('gdrive.js');
const m = g.match(/catch \(e\) \{ (const c = [^}]*?throw e;) \}/);
ok(m, 'gdrive.js: no-SW catch not found');
if (m) {
  const handler = new Function('e', m[1] + ' return "fallback";');
  for (const e of [{code: 'TGPLAY_NO_SW'}, {code: 'TGPLAY_NO_SW_RELOAD'}, new Error('TGPLAY_NO_SW_RELOAD'), new Error('TGPLAY_NO_SW')]) {
    let r; try { r = handler(e); } catch (x) { r = 'thrown'; }
    ok(r === 'fallback', 'gdrive.js rethrows ' + (e.code || e.message));
  }
  let r; try { r = handler(new Error('NET')); } catch (x) { r = 'thrown'; }
  ok(r === 'thrown', 'gdrive.js swallows unrelated errors');
}

// style.css: lite mode keeps danger red
const css = rd('style.css');
ok(/html\.lite \.btn\.danger\{background:var\(--danger\)\}/.test(css) &&
   css.indexOf('html.lite .btn.danger') > css.indexOf('html.lite .btn{'), 'style.css: lite .btn.danger override missing');

// app.js: More actions menu skips hidden/disabled buttons
ok(/hold\.children\]\.filter\(\(b\) => !b\.hidden && !b\.disabled/.test(rd('app.js')), 'app.js: tidyActs does not filter disabled/hidden');

// player.js: 'Reload the page' only for TGPLAY_NO_SW_RELOAD; plain TGPLAY_NO_SW keeps 'Download and play here' primary
const pj = rd('player.js');
ok(/s\.swReload = \/TGPLAY_NO_SW_RELOAD\/\.test\(code\)/.test(pj), 'player.js: swReload flag not set from code');
ok(/why === 'nosw' && s\.swReload\) out\.push\(\{label: t\('pl_reload'\)/.test(pj), 'player.js: reload button not gated on swReload');
ok(/label: t\('pl_tg_dl'\), pri: why === 'nosw' && !s\.swReload/.test(pj), 'player.js: download not primary for plain no-SW');

// player.js: the iOS HLS canplay re-seek yields to any viewer seek (seekTo sets s.userSeek, again() checks it)
ok(/function seekTo\(x, quiet\) \{[^}]*s\.userSeek = true;/.test(pj), 'player.js: seekTo does not mark s.userSeek');
ok(/s\.userSeek = false;\s*\/?\/?[^\n]*\n?\s*const again = \(\) => \{ if \(!alive\(\) \|\| s\.wdGen !== gen \|\| s\.userSeek\) return;/.test(pj), 'player.js: canplay re-seek ignores the viewer seek');

// app.js: rebuilding the passphrase row keeps focus inside it
ok(/had = !!\(pr && ae && pr\.contains\(ae\)\)[\s\S]{0,300}if \(had\) \{[^\n]*focusEl\(tgt\)/.test(rd('app.js')), 'app.js: drawPass drops focus to body');

// ---- 6.5.1
// app.js: fmt() puts a user's name in as text ('$&' is not a replacement pattern)
ok(/const fmt = \(k, v\) => String\(X\(k\)\)\.replace\('%s', \(\) => String\(v\)\)/.test(rd('app.js')), 'app.js: fmt expands $ patterns of a user name');
ok('Active user: %s'.replace('%s', () => 'Dan$&') === 'Active user: Dan$&', 'a replacer function keeps $& as text');

// app.js popBackdrop: while a menu / confirmation is up the page and the sheet under it are hidden from assistive
// technology and the sheet is not "modal"; closing restores what was there, also after pop A -> pop B
{
  const src = (rd('app.js').match(/function popBackdrop\(on\) \{[\s\S]*?\n\}/) || [''])[0];
  ok(src, 'app.js: popBackdrop not found');
  if (src) {
    const mk = (id, attrs) => ({id, a: Object.assign({}, attrs), getAttribute(k) { return k in this.a ? this.a[k] : null; }, setAttribute(k, v) { this.a[k] = String(v); }, removeAttribute(k) { delete this.a[k]; }});
    const els = {'#rail': mk('rail'), '#top': mk('top'), '#tabs': mk('tabs', {'aria-hidden': 'true'}), '#toasts': mk('toasts')};
    const view = mk('view'), modalEl = mk('modal', {'aria-modal': 'true'});
    const pb = new Function('$', 'view', 'modalEl', 'let popBack = null; ' + src + ' return popBackdrop;')((q) => els[q] || null, view, modalEl);
    pb(true); pb(true);                                  // (openPop over an open pop)
    ok(view.a['aria-hidden'] === 'true' && els['#rail'].a['aria-hidden'] === 'true' && els['#top'].a['aria-hidden'] === 'true' && modalEl.a['aria-hidden'] === 'true', 'popBackdrop: the background is hidden');
    ok(modalEl.a['aria-modal'] === 'false', 'popBackdrop: the sheet under a pop is not modal');
    ok(!('aria-hidden' in els['#toasts'].a), 'popBackdrop: toasts stay announced');
    pb(false);
    ok(!('aria-hidden' in view.a) && !('aria-hidden' in els['#rail'].a) && !('aria-hidden' in modalEl.a) && els['#tabs'].a['aria-hidden'] === 'true', 'popBackdrop: earlier values come back');
    ok(modalEl.a['aria-modal'] === 'true', 'popBackdrop: the sheet is modal again');
    pb(false);
    ok(!('aria-hidden' in view.a), 'popBackdrop: closing twice is harmless');
  }
  const a = rd('app.js');
  const cp = (a.match(/function closePop\(result\) \{[\s\S]*?\n\}/) || [''])[0];
  ok(cp.indexOf('popBackdrop(false)') > 0 && cp.indexOf('popBackdrop(false)') < cp.indexOf('focusEl(op, true)'), 'app.js: closePop restores the page before the focus returns');
  ok(/box\.setAttribute\('aria-label', \(anchor && anchor\.getAttribute/.test(a), 'app.js: a menu has a label');
}

// osk.js: the keyboard bar stays off a computer with a mouse and a keyboard unless the viewer asked for it
{
  const src = (rd('osk.js').match(/function wanted\(\) \{[\s\S]*?\n  \}/) || [''])[0];
  ok(src, 'osk.js: wanted() not found');
  if (src) {
    const w = (shell, o) => new Function('TN', 'root', 'ls', src + ' return wanted();')({shell: () => shell},
      Object.assign({navigator: {maxTouchPoints: 0}, matchMedia: () => ({matches: false})}, o && o.root), {get: (k, d) => (o && k in (o.ls || {}) ? o.ls[k] : d)});
    ok(w('desktop') === false, 'osk: no bar on a desktop with a mouse');
    ok(w('tv') && w('phone') && w('tablet'), 'osk: television, phone and tablet keep the bar');
    ok(w('desktop', {root: {navigator: {maxTouchPoints: 5}}}) === true, 'osk: a touch screen in the desktop shell (iPad) keeps the bar');
    ok(w('desktop', {root: {matchMedia: () => ({matches: true})}}) === true, 'osk: a coarse pointer keeps the bar');
    ok(w('desktop', {root: {BNNative: {}}}) === true, 'osk: the app shells keep the bar');
    ok(w('desktop', {ls: {bn_osk_show: true}}) === true && w('desktop', {ls: {bn_osk_show: false}}) === false, 'osk: the setting turns it on');
  }
  ok(/if \(!wanted\(\)\) return;[^\n]*\n\s*wrapEl\(\)\.hidden = false;/.test(rd('osk.js')), 'osk.js: focusin does not consult wanted()');
  ok(/put\('osk_show', sw\.checked\)/.test(rd('app.js')), 'app.js: the keyboard-bar switch is missing');
}

// subs.js: the subtitle settings block belongs to the Playback tab only
ok(/ctx\.arg !== 'playback'|ctx\.arg === 'playback'/.test(rd('subs.js')), 'subs.js: the settings block is not tied to the playback tab');
// index.html: one i-dots symbol, no hls.js tag in the head, pinch zoom not disabled
{
  const h = rd('index.html');
  ok((h.match(/id="i-dots"/g) || []).length === 1, 'index.html: i-dots defined once');
  ok(!/hls\.js@/.test(h), 'index.html: hls.js is loaded on demand');
  ok(!/maximum-scale/.test(h), 'index.html: pinch zoom stays possible');
  const ids = (h.match(/<symbol id="[^"]+"/g) || []);
  ok(new Set(ids).size === ids.length, 'index.html: a sprite id is defined twice');
}

console.log(bad ? 't_web65: ' + bad + ' problems' : 't_web65 OK');
process.exit(bad ? 1 : 0);
