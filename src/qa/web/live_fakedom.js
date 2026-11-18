'use strict';
// Package "live": a stand-in for the browser's document, for smoke tests of page code in plain node (t_live.js,
// t_tgsearch.js). It is not a DOM: every element is an object that accepts any property and any call and answers
// with another such object. What it does keep: the properties page code sets (so 'f.q.value' and 'el.onclick' read
// back), the text / HTML given to an element, and every function handed over as a handler (onclick / onsubmit /
// addEventListener / TN.button) - press() calls them all with a stand-in event, so the code inside the handlers runs
// too. A page function that names a variable that does not exist, calls something that is not a function on a real
// object, or rejects, fails the test.
function make() {
  const handlers = [];                              // [label, fn]
  const texts = [];                                 // every textContent / innerHTML / insertAdjacentHTML given
  const state = {value: ''};                        // what every input holds (set it to fill the forms in)
  function el(tag) {
    const own = {tagName: String(tag || 'DIV').toUpperCase(), dataset: {}, style: {}, hidden: false, disabled: false, value: state.value, files: []};
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
        if (k === 'querySelectorAll' || k === 'childNodes' || k === 'children') return k === 'querySelectorAll' ? () => [] : [];
        if (k === 'contains') return () => true;
        if (k === 'focus' || k === 'remove' || k === 'append' || k === 'prepend' || k === 'replaceWith' || k === 'setAttribute' || k === 'removeAttribute' ||
            k === 'removeEventListener' || k === 'load' || k === 'pause' || k === 'scrollIntoView') return () => undefined;
        return (own[k] = el(String(k)));
      },
      set(t, k, v) {
        own[k] = v;
        if ((k === 'onclick' || k === 'onsubmit' || k === 'onchange' || k === 'oninput') && typeof v === 'function') handlers.push([own.tagName + ':' + String(k), v]);
        if (k === 'textContent' || k === 'innerHTML') texts.push(String(v));
        return true;
      },
      has() { return true; },
      apply() { return el('x'); },
      construct() { return el('x'); },
    });
    return self;
  }
  const document = {
    createElement: (tag) => el(tag), getElementById: (id) => (id === '__none__' ? null : el('#' + id)), querySelector: () => el('q'), querySelectorAll: () => [],
    head: el('head'), body: el('body'), addEventListener() {}, removeEventListener() {},
  };
  // the TN members that draw: the same stand-in elements; TN.button keeps its handler
  const ui = {
    view: () => document.body, page() {}, section: (title) => { texts.push(String(title)); return el('grid'); }, skeleton: () => el('sk'), empty(g, text) { texts.push(String(text || 'none')); },
    card(img, title, sub, onClick, shape, badge) { texts.push(String(title) + ' | ' + String(sub || '') + ' | ' + String(badge || '')); if (typeof onClick === 'function') handlers.push(['card:' + title, onClick]); return el('card'); },
    chips(items, cur, go) { for (const it of items) texts.push(String(it[1])); if (typeof go === 'function' && items.length) handlers.push(['chips', () => go(items[items.length - 1][0])]); return el('chips'); },
    button(cls, text, fn) { texts.push(String(text)); const b = el('button'); if (typeof fn === 'function') handlers.push(['button:' + text, fn]); b.textContent = String(text); return b; },
    modal(html) { texts.push(String(html)); }, closeModal() {}, favButton: () => el('fav'), esc: (s) => String(s === undefined || s === null ? '' : s),
    httpsOnly: (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : ''), cssUrl: (u) => u, paint() {}, kodiOnly() {},
  };
  // call every handler collected so far (once each), wait for them; -> [label, error] of the ones that failed
  async function press(skip) {
    const failed = [], pressed = new Set();         // a control that redraws its list is pressed once, not once per redraw
    let rounds = 0;
    while (handlers.length && rounds++ < 6) {
      const batch = handlers.splice(0, handlers.length);
      for (const [label, fn] of batch) {
        if ((skip && skip.test(label)) || pressed.has(label)) continue;
        pressed.add(label);
        const ev = {preventDefault() {}, stopPropagation() {}, target: el('target'), key: 'x', currentTarget: el('target')};
        try { await fn(ev); } catch (e) { failed.push([label, e]); }
      }
    }
    return failed;
  }
  return {document, el, ui, handlers, texts, press, state};
}
module.exports = {make};
