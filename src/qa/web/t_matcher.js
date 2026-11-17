'use strict';
// WP-2: web/matcher.js + web/epmatch.js must answer exactly what the build's Python answers.
//   python src/qa/web/gen_tg_fixtures.py && node src/qa/web/t_matcher.js
const path = require('path');
const WEB = path.join(__dirname, '..', '..', '..', 'web');
const M = require(path.join(WEB, 'matcher.js'));
const E = require(path.join(WEB, 'epmatch.js'));
const C = require(path.join(WEB, 'tests', 'tg_cases.json'));
let n = 0, bad = 0;
const near = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : false;
function same(a, b) {
  if (near(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    return same(ka, kb) && ka.every((k) => same(a[k], b[k]));
  }
  return a === b;
}
function check(what, got, want) {
  n++;
  if (!same(got, want)) { bad++; if (bad <= 40) console.log('FAIL', what, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want)); }
}
for (const c of C.parse) check('parse ' + JSON.stringify(c.args), M.parse(...c.args), c.out);
for (const c of C.normalize) check('normalize ' + c.in, M.normalize(c.in), c.out);
for (const c of C.clean) check('clean ' + c.in, M.cleanQuery(c.in), c.out);
for (const c of C.sim) check('sim ' + c.args, M.titleSimilarity(...c.args), c.out);
for (const c of C.evaluate) check('evaluate ' + c.cand.file + ' / ' + c.target.aliases[0] + ' ' + c.strict, M.evaluate(c.cand, c.target, c.strict), c.out);
for (const c of C.lang) check('lang ' + c.args, M.languageBonus(...c.args), c.out);
for (const c of C.plan) check('plan ' + c.target.aliases[0], M.planQueries(c.target, {max_aliases: 4, max_queries: 6}), c.out);
for (const c of C.dedup) { const [rows, folded] = M.unionDedup(JSON.parse(JSON.stringify(c.in))); check('dedup', [rows, folded], [c.out, c.folded]); }
const F = {parse: E.parse, matches: E.matches, mentions: E.mentions, query_for: E.queryFor, wanted: E.wanted};
for (const c of C.ep) check('ep.' + c.f + ' ' + JSON.stringify(c.args), F[c.f](...c.args), c.out);
console.log(`${n} cases, ${bad} failures`);
process.exit(bad ? 1 : 0);
