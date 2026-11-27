// 6.6: one progress display for every long action (update, link tests, source search, backup / restore, sync,
// IPTV / EPG, subtitles, pairing, the Telegram download in the built-in player). Loaded by index.html before
// app.js, which hands it out as TN.progress:
//   const p = TN.progress.open({title, steps: [names] or null, cancel: fn or null, host: element or null});
//   p.step(i); p.set(done, total); p.note(text); p.done(); p.fail(text);
// A percent is shown only from real numbers (set(done, total)); with steps alone it reads "step x of y". The time
// left comes from the measured rate, smoothed, and only once it is reliable (eta() below - pure, tested in Node).
(function (root) {
  'use strict';
  const MIN_SAMPLES = 3, MIN_SPAN = 3000, WINDOW = 20000, ALPHA = 0.3;

  // samples: [{t: ms, done, total}] in time order. Returns the seconds left, or null while it is not reliable:
  // too few samples, too short a span, no total, no movement, or a rate that jumps too much to trust.
  function eta(samples) {
    const s = (samples || []).filter((x) => x && isFinite(x.t) && isFinite(x.done));
    if (s.length < MIN_SAMPLES) return null;
    const last = s[s.length - 1], total = +last.total;
    if (!(total > 0) || last.done >= total || last.done <= 0) return null;
    const recent = s.filter((x) => x.t >= last.t - WINDOW);
    const win = recent.length >= MIN_SAMPLES ? recent : s.slice(-MIN_SAMPLES);
    if (last.t - win[0].t < MIN_SPAN) return null;
    let rate = null;                              // units per ms, exponentially smoothed over the steps
    const rates = [];
    for (let i = 1; i < win.length; i++) {
      const dt = win[i].t - win[i - 1].t;
      if (dt <= 0) continue;
      const r = Math.max(0, win[i].done - win[i - 1].done) / dt;
      rates.push(r);
      rate = rate === null ? r : ALPHA * r + (1 - ALPHA) * rate;
    }
    const avg = (last.done - win[0].done) / (last.t - win[0].t);
    if (!(avg > 0) || rate === null) return null;
    const mix = 0.5 * rate + 0.5 * avg;           // the smoothed step rate pulled towards the window average
    if (!(mix > 0)) return null;
    const secs = (total - last.done) / mix / 1000;
    return isFinite(secs) && secs < 86400 * 2 ? Math.max(1, Math.round(secs)) : null;
  }

  const T = {
    he: {left: 'נותרו %s', step: 'שלב %1 מתוך %2', cancel: 'ביטול', ok: 'הסתיים', fail: 'נכשל', s: '%s שנ׳', m: '%s דק׳', h: '%s שע׳'},
    en: {left: '%s left', step: 'Step %1 of %2', cancel: 'Cancel', ok: 'Done', fail: 'Failed', s: '%s s', m: '%s min', h: '%s h'},
    ru: {left: 'осталось %s', step: 'Шаг %1 из %2', cancel: 'Отмена', ok: 'Готово', fail: 'Ошибка', s: '%s с', m: '%s мин', h: '%s ч'},
  };
  const lang = () => { const l = ((root.document && document.documentElement.lang) || 'he').slice(0, 2); return T[l] ? l : 'en'; };
  const tx = (k, a, b) => String(T[lang()][k]).replace('%1', a).replace('%2', b).replace('%s', a);
  function fmtLeft(sec) {
    if (Math.round(sec) < 60) return tx('s', Math.round(sec));
    const m = Math.round(sec / 60);   // 6.5.1: round first, then pick the unit (3570 s is '1 h', not '60 min')
    if (m < 60) return tx('m', m);
    return tx('h', Math.round(sec / 360) / 10);
  }

  let styled = false;
  function style() {
    if (styled || !root.document) return;
    styled = true;
    const s = document.createElement('style');
    s.textContent = '.tnp_dock{position:fixed;inset-inline:12px;bottom:12px;z-index:9000;display:flex;flex-direction:column;gap:8px;pointer-events:none;align-items:center}' +
      '.tnp{pointer-events:auto;width:min(480px,100%);background:var(--panel,#1c1c22);color:var(--text,#fff);border-radius:12px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.35);font-size:14px}' +
      '.tnp.inline{width:100%;box-shadow:none;background:var(--panel2,#2a2a32);margin:6px 0}' +
      '.tnp_h{display:flex;align-items:center;gap:8px;min-height:24px}.tnp_t{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.tnp_p{font-variant-numeric:tabular-nums;color:var(--muted,#aaa)}.tnp_x{background:none;border:0;color:var(--muted,#aaa);font:inherit;cursor:pointer;padding:2px 6px;border-radius:6px;min-height:28px}' +
      '.tnp_x:focus-visible{outline:2px solid var(--accent,#f5c518)}' +
      '.tnp_bar{height:4px;border-radius:2px;background:rgba(127,127,127,.25);overflow:hidden;margin:7px 0 5px}' +
      '.tnp_bar i{display:block;height:100%;width:0;background:var(--accent,#f5c518);border-radius:2px;transition:width .3s ease}' +
      '.tnp_bar.ind i{width:30%;animation:tnpi 1.3s ease-in-out infinite}@keyframes tnpi{0%{margin-inline-start:-30%}100%{margin-inline-start:100%}}' +
      'html.lite .tnp_bar.ind i{animation:none;width:100%;opacity:.4}' +
      '.tnp_s{display:flex;gap:8px;color:var(--muted,#aaa);font-size:12.5px;min-height:16px}.tnp_s span:first-child{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.tnp.ok .tnp_bar i{background:#3ddc84}.tnp.bad .tnp_bar i{background:#e5534b;width:100%}' +
      'html.tv .tnp{font-size:18px;padding:14px 16px}html.tv .tnp_s{font-size:15px}';
    document.head.appendChild(s);
  }
  function dock() {
    let d = document.getElementById('tnp_dock');
    if (!d) { d = document.createElement('div'); d.id = 'tnp_dock'; d.className = 'tnp_dock'; document.body.appendChild(d); }
    return d;
  }

  function open(o) {
    o = o || {};
    const steps = Array.isArray(o.steps) && o.steps.length ? o.steps.map(String) : null;
    let stepI = -1, done = 0, total = 0, samples = [], noteTxt = '', closed = false;
    const now = () => (root.performance && performance.now ? performance.now() : Date.now());
    const api = {step() {}, set() {}, note() {}, done() {}, fail() {}, el: null};
    if (!root.document || !document.body) return Object.assign(api, {eta: () => eta(samples)});
    style();
    const el = document.createElement('div');
    el.className = 'tnp' + (o.host ? ' inline' : '');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="tnp_h"><span class="tnp_t" dir="auto"></span><span class="tnp_p"></span></div>' +
      '<div class="tnp_bar ind"><i></i></div><div class="tnp_s"><span dir="auto"></span><span class="tnp_e"></span></div>';
    const q = (c) => el.querySelector(c);
    q('.tnp_t').textContent = o.title || '';
    if (typeof o.cancel === 'function') {
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'tnp_x'; x.textContent = tx('cancel');
      x.onclick = () => { try { o.cancel(); } catch (e) { /* the action stops itself */ } api.done(true); };
      q('.tnp_h').appendChild(x);
    }
    (o.host || dock()).appendChild(el);
    api.el = el;
    function paint() {
      if (closed) return;
      const bar = q('.tnp_bar'), fill = q('.tnp_bar i');
      let pct = null;
      if (total > 0) pct = Math.max(0, Math.min(100, Math.floor(done * 100 / total)));
      else if (steps && stepI >= 0 && o.stepPercent) pct = Math.floor(stepI * 100 / steps.length);
      bar.classList.toggle('ind', pct === null);
      fill.style.width = pct === null ? '' : pct + '%';
      q('.tnp_p').textContent = pct === null ? '' : pct + '%';
      const sName = steps && stepI >= 0 ? steps[stepI] : '';
      const sNum = steps && stepI >= 0 && steps.length > 1 ? tx('step', stepI + 1, steps.length) : '';
      q('.tnp_s span').textContent = [sName, noteTxt, pct === null ? sNum : ''].filter(Boolean).join(' · ');
      const e = total > 0 ? eta(samples) : null;
      q('.tnp_e').textContent = e ? tx('left', fmtLeft(e)) : '';
    }
    function finish(cls, text, wait) {
      if (closed) return;
      if (cls) { el.classList.add(cls); q('.tnp_e').textContent = ''; if (text) q('.tnp_s span').textContent = text; }
      if (cls === 'ok') { const f = q('.tnp_bar i'); q('.tnp_bar').classList.remove('ind'); f.style.width = '100%'; q('.tnp_p').textContent = ''; }
      closed = true;
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, wait);
    }
    Object.assign(api, {
      step(i) { if (steps) { stepI = Math.max(0, Math.min(steps.length - 1, i | 0)); if (!o.keepAcrossSteps) { done = 0; total = 0; samples = []; } paint(); } },
      set(d, t) {
        done = +d || 0; total = +t || 0;
        const t0 = now(), lastS = samples[samples.length - 1];
        if (!lastS || t0 - lastS.t >= 250) samples.push({t: t0, done, total}); else { lastS.done = done; lastS.total = total; }
        if (samples.length > 200) samples = samples.slice(-120);
        paint();
      },
      note(text) { noteTxt = text ? String(text) : ''; paint(); },
      done(quiet) { finish(quiet ? '' : 'ok', quiet ? '' : tx('ok'), quiet ? 0 : 900); },
      fail(text) { finish('bad', text || tx('fail'), 4000); },
      eta: () => eta(samples),
    });
    paint();
    return api;
  }

  const P = {open, eta, fmtLeft};
  root.TNProgress = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
