'use strict';
// Every text of the web app exists in Hebrew, English and Russian: the tables L, X3 and X4 of web/app.js must have
// the same keys in each language (nested tables too), no empty text, and every X('key') / t('key') the code asks for
// must exist. Also: tg.js asks only for texts that exist.     node t_texts.js      (run by run_web_tests.py)
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..', '..', '..', 'web');
const app = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8'), tg = fs.readFileSync(path.join(WEB, 'tg.js'), 'utf8');
const bad = [];
const tables = {};
for (const m of app.matchAll(/^const (L|X3|X4) = (\{[\s\S]*?\n\});$/gm)) tables[m[1]] = new Function('return ' + m[2])();
for (const name of ['L', 'X3', 'X4']) if (!tables[name]) bad.push('table ' + name + ' not found in app.js');
const keys = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, pre + k + '.') : [pre + k]));
let n = 0;
for (const [name, tb] of Object.entries(tables)) {
  const langs = Object.keys(tb);
  if (langs.join() !== 'he,en,ru') bad.push(`${name}: languages ${langs}`);
  const want = keys(tb.en).sort().join('|');
  for (const l of langs) {
    if (keys(tb[l]).sort().join('|') !== want) {
      const a = new Set(keys(tb[l])), b = new Set(keys(tb.en));
      bad.push(`${name}.${l}: missing ${[...b].filter((k) => !a.has(k))} / extra ${[...a].filter((k) => !b.has(k))}`);
    }
    for (const k of keys(tb[l])) { n++; const v = k.split('.').reduce((o, p) => o[p], tb[l]); if (typeof v !== 'string' || !v.trim()) bad.push(`${name}.${l}.${k} is empty`); }
  }
}
const x = new Set([...Object.keys(tables.X3.en), ...Object.keys(tables.X4.en)]), l = new Set(Object.keys(tables.L.en));
for (const [src, text] of [['app.js', app], ['tg.js', tg]]) {
  for (const m of text.matchAll(/\b(?:A\.)?(?:X|fmt)\('([a-z0-9_]+)'/g)) if (!x.has(m[1])) bad.push(`${src} asks for the text ${m[1]}, which does not exist`);
  for (const m of text.matchAll(/X\([^)]*\? '([a-z0-9_]+)' : '([a-z0-9_]+)'\)/g)) for (const k of [m[1], m[2]]) if (!x.has(k)) bad.push(`${src} asks for the text ${k}, which does not exist`);
}
for (const m of app.matchAll(/[^\w.]t\('([a-zA-Z0-9_]+)'\)/g)) if (!l.has(m[1])) bad.push(`app.js asks for the text ${m[1]}, which does not exist`);
for (const b of bad) console.log('FAIL', b);
console.log(bad.length ? `texts: ${bad.length} problems` : `texts: ${n} texts, the same keys in he / en / ru`);
process.exit(bad.length ? 1 : 0);
