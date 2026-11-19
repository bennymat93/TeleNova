'use strict';
// node undef_web.js - a crude "called but never defined" scan over web/*.js (no dependency, no parser).
// It exists because web/tg.js once called dropPending() / setFlood(), which were written nowhere: every Telegram
// sign-in died at its last step with a ReferenceError and no test saw it (2026-11-18).
// A name that is called as a plain function must appear in the same file as a declaration, a parameter, an assignment
// or a destructured name. Names in ALLOW are false alarms that were looked at by hand.
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || path.join(__dirname, '..', '..', '..', 'web');
const GL = new Set(('window self document navigator location console setTimeout clearTimeout setInterval clearInterval fetch Promise Object Array String Number ' +
  'Boolean Math JSON Date RegExp Error TypeError RangeError Map Set WeakMap WeakSet Symbol parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent ' +
  'encodeURI decodeURI escape unescape atob btoa URL URLSearchParams Blob File FileReader Uint8Array Uint16Array Uint32Array Int32Array Float32Array Float64Array ' +
  'ArrayBuffer DataView TextEncoder TextDecoder crypto performance requestAnimationFrame cancelAnimationFrame matchMedia Image Audio Event CustomEvent ' +
  'AbortController Headers Request Response WebSocket Worker caches indexedDB localStorage sessionStorage alert confirm prompt BigInt Intl Reflect Proxy require ' +
  'module importScripts globalThis IntersectionObserver ResizeObserver MutationObserver MediaSource Notification history screen structuredClone queueMicrotask ' +
  'getComputedStyle open close postMessage if for while switch catch function return typeof new await async super this import export delete void in of ' +
  'instanceof yield do else try throw case default with debugger class extends static get set constructor DOMParser XMLHttpRequest FormData ' +
  'DecompressionStream CompressionStream ReadableStream BroadcastChannel MessageChannel clients skipWaiting registration addEventListener removeEventListener ' +
  'dispatchEvent createImageBitmap OffscreenCanvas Path2D MediaMetadata SubtleCrypto Uint8ClampedArray AggregateError EvalError scrollTo focus blur print stop').split(' '));
const ALLOW = {'app.js': ['bn_'], 'player.js': ['ico', 'm3uText', 'sizeText'], 'sources.js': ['RD'], 'tg.js': ['PHONE_CODE_', 'PHONE_NUMBER_', 'API_ID_'],
  'tgplay.js': ['USERNAME_']};      // inside regular expressions, or defined where the crude scan does not look (checked by hand 2026-11-19)
let bad = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''")
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  // template literals: keep the code inside ${...}, drop the text
  let code = '', i = 0, depth = [];
  while (i < src.length) {
    const c = src[i];
    if (c === '`') { if (depth.length && depth[depth.length - 1] === 'T') depth.pop(); else depth.push('T'); i++; continue; }
    if (depth.length && depth[depth.length - 1] === 'T') {
      if (c === '\\') { i += 2; continue; }
      if (c === '$' && src[i + 1] === '{') { depth.push('E'); code += ' ('; i += 2; continue; }
      i++; continue;
    }
    if (depth.length && depth[depth.length - 1] === 'E') {
      if (c === '{') depth.push('B');
      else if (c === '}') { depth.pop(); code += ') '; i++; continue; }
    } else if (depth.length && depth[depth.length - 1] === 'B') {
      if (c === '{') depth.push('B'); else if (c === '}') depth.pop();
    }
    code += c; i++;
  }
  const calls = new Set();
  const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(code))) if (!GL.has(m[2])) calls.add(m[2]);
  const missing = [];
  for (const name of calls) {
    const n = name.replace(/\$/g, '\\$');
    const decl = new RegExp('(function\\s*\\*?\\s+' + n + '\\b|\\b(const|let|var|class)\\s[^;]*?\\b' + n + '\\b|(^|[^.\\w$])' + n + '\\s*=[^=]|[(,{\\[]\\s*' + n + '\\s*[,)}\\]=:]|\\b' + n +
      '\\s*=>|\\.\\.\\.' + n + '\\b|catch\\s*\\(\\s*' + n + '\\b|:\\s*' + n + '\\s*[,})]|\\b' + n + '\\s*\\([^)]*\\)\\s*\\{)', 'm');
    if (!decl.test(code) && !(ALLOW[f] || []).includes(name)) missing.push(name);
  }
  if (missing.length) { bad += missing.length; console.log('UNDEFINED ' + f + ': ' + missing.join(', ')); }
}
console.log(bad ? 'undef_web: ' + bad + ' name(s) called but not defined' : 'undef_web OK');
process.exit(bad ? 1 : 0);
