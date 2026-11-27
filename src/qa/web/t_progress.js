// 6.6: web/progress.js - the pure time-left estimate (TN.progress.eta) and the no-DOM handle
'use strict';
const path = require('path');
const assert = require('assert');
const P = require(path.join(__dirname, '..', '..', '..', 'web', 'progress.js'));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

ok(P.eta([]) === null, 'no samples: no estimate');
ok(P.eta([{t: 0, done: 0, total: 100}, {t: 1000, done: 10, total: 100}]) === null, 'two samples are too few');
ok(P.eta([{t: 0, done: 0, total: 100}, {t: 500, done: 5, total: 100}, {t: 1000, done: 10, total: 100}]) === null, 'one second is too short');
ok(P.eta([{t: 0, done: 0, total: 0}, {t: 2000, done: 5, total: 0}, {t: 4000, done: 10, total: 0}]) === null, 'no total: no estimate (never invented)');
ok(P.eta([{t: 0, done: 5, total: 100}, {t: 2000, done: 5, total: 100}, {t: 4000, done: 5, total: 100}]) === null, 'no movement: no estimate');
// steady 10 units / s, 40 of 100 done -> 6 s left
const steady = [0, 1, 2, 3, 4].map((s) => ({t: s * 1000, done: s * 10, total: 100}));
ok(P.eta(steady) === 6, 'steady rate: ' + P.eta(steady));
// a burst at the end does not swing the estimate to the burst rate alone
const burst = [{t: 0, done: 0, total: 1000}, {t: 1000, done: 10, total: 1000}, {t: 2000, done: 20, total: 1000}, {t: 3000, done: 30, total: 1000}, {t: 4000, done: 130, total: 1000}];
const e = P.eta(burst);
ok(e > 870 / 100 && e < 870 / 10, 'smoothed between the slow and the burst rate: ' + e);
ok(P.eta(steady.concat([{t: 5000, done: 100, total: 100}])) === null, 'finished: no estimate');
ok(P.fmtLeft(42).indexOf('42') >= 0 && P.fmtLeft(600).indexOf('10') >= 0, 'time formatting');
// 6.5.1: round first, then the unit: 3570-3599 s is 1 h, never '60 min'
ok(P.fmtLeft(3590) === P.fmtLeft(3600) && P.fmtLeft(3590).indexOf('60') < 0, 'no 60 min at the hour edge');
ok(P.fmtLeft(3540).indexOf('59') >= 0 && P.fmtLeft(59.6).indexOf('.') < 0, 'minute / second edges');
// without a DOM the handle is a harmless stub
const h = P.open({title: 'x', steps: ['a', 'b']});
h.step(1); h.set(1, 2); h.note('n'); h.done(); h.fail('f');
ok(h.el === null, 'stub handle');
console.log('t_progress: %d checks ok', n);
