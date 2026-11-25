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

console.log(bad ? 't_web65: ' + bad + ' problems' : 't_web65 OK');
process.exit(bad ? 1 : 0);
