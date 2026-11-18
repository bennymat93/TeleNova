'use strict';
// TeleNova web, WP-6: subtitle text tools. Pure logic, no DOM: also runs in node (module.exports) for
// src/qa/web/t_srt.js. In the page: `const S = await TN.provider('srt')` (a 'service'), or self.TNSrt.
//   decode(bytes, langHint)      -> string   (BOM, strict UTF-8, else windows-1255 for Hebrew / windows-1251 / 1252)
//   unzip(bytes)                 -> Promise<[{name, bytes}]>   (stored + deflate entries, DecompressionStream)
//   parse(text)                  -> [{start, end, text}]       (SRT or WebVTT, seconds)
//   toVtt(cuesOrText)            -> string   (WebVTT; SRT text is parsed first)
//   toSrt(cues)                  -> string
//   shift(cues, seconds)         -> new cues (times never below 0)
//   pickFile(entries)            -> the best .srt/.vtt entry of a zip
//   releaseScore(a, b)           -> 0..1 token overlap of two release names (the Kodi subfix.match_score idea)
//   parseAss(text) (parse() calls it for ASS / SSA), repair(cues), scriptOf(cuesOrText) -> 'he' | 'ru' | 'en' | ''
//   isZip(bytes), cleanText(s)
(function (root) {
  const SUB_EXT = /\.(srt|vtt|ass|ssa|sub|txt)$/i;

  function u8(b) {
    if (b instanceof Uint8Array) return b;
    if (b instanceof ArrayBuffer) return new Uint8Array(b);
    if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return new Uint8Array(b || []);
  }
  const isZip = (b) => { b = u8(b); return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04; };

  // ------------------------------------------------------------ text decoding
  function tryDecode(enc, b, fatal) {
    try { return new TextDecoder(enc, {fatal: !!fatal}).decode(b); } catch (e) { return null; }
  }
  function decode(bytes, langHint) {
    const b = u8(bytes);
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return tryDecode('utf-8', b.subarray(3)) || '';
    if (b[0] === 0xff && b[1] === 0xfe) return tryDecode('utf-16le', b.subarray(2)) || '';
    if (b[0] === 0xfe && b[1] === 0xff) return tryDecode('utf-16be', b.subarray(2)) || '';
    const utf = tryDecode('utf-8', b, true);
    if (utf !== null) return utf;
    // legacy code pages: score by how many letters of the expected script come out
    const order = langHint === 'ru' ? ['windows-1251', 'windows-1255', 'windows-1252']
      : langHint === 'en' ? ['windows-1252', 'windows-1255', 'windows-1251'] : ['windows-1255', 'windows-1251', 'windows-1252'];
    const score = {
      'windows-1255': (s) => (s.match(/[א-ת]/g) || []).length,
      'windows-1251': (s) => (s.match(/[а-яА-Я]/g) || []).length,
      'windows-1252': (s) => (s.match(/[a-zA-Z]/g) || []).length * 0.2,
    };
    let best = null, bestScore = -1;
    for (const enc of order) {
      const s = tryDecode(enc, b);
      if (s === null) continue;
      const sc = score[enc](s);
      if (sc > bestScore * 1.2 || best === null) { best = s; bestScore = sc; }
    }
    return best !== null ? best : (tryDecode('utf-8', b) || '');
  }

  // ------------------------------------------------------------ zip (local headers + central directory sizes)
  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') throw new Error('no DecompressionStream');
    const ds = new DecompressionStream('deflate-raw');
    const out = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  async function unzip(bytes) {
    const b = u8(bytes);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    // central directory: reliable sizes even when the local header uses a data descriptor
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('bad zip');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = [];
    for (let n = 0; n < count && p + 46 <= b.length; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const flags = dv.getUint16(p + 8, true);
      const local = dv.getUint32(p + 42, true);
      const nameBytes = b.subarray(p + 46, p + 46 + nlen);
      const name = (flags & 0x800) ? tryDecode('utf-8', nameBytes) : (tryDecode('utf-8', nameBytes, true) || tryDecode('windows-1255', nameBytes));
      p += 46 + nlen + xlen + clen;
      if (/\/$/.test(name) || dv.getUint32(local, true) !== 0x04034b50) continue;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = b.subarray(start, start + csize);
      if (method === 0) out.push({name, bytes: data});
      else if (method === 8) out.push({name, bytes: await inflateRaw(data)});
    }
    return out;
  }
  function pickFile(entries) {
    const subs = (entries || []).filter((e) => SUB_EXT.test(e.name) && !/__MACOSX/.test(e.name));
    subs.sort((a, b) => (/\.srt$/i.test(b.name) - /\.srt$/i.test(a.name)) || (b.bytes.length - a.bytes.length));
    return subs[0] || null;
  }

  // ------------------------------------------------------------ SRT / VTT
  const TIME = /(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[,.:](\d{1,3}))?/;
  function toSec(s) {
    const m = TIME.exec(s);
    if (!m) return NaN;
    const ms = m[4] ? Number((m[4] + '00').slice(0, 3)) : 0;
    return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + ms / 1000;
  }
  function stamp(sec, sep) {
    sec = Math.max(0, sec);
    let ms = Math.round(sec * 1000);
    const h = Math.floor(ms / 3600000); ms -= h * 3600000;
    const m = Math.floor(ms / 60000); ms -= m * 60000;
    const s = Math.floor(ms / 1000); ms -= s * 1000;
    const p = (n, w) => String(n).padStart(w, '0');
    return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)}${sep}${p(ms, 3)}`;
  }
  // keep <i> <b> <u>; drop every other tag and ASS overrides like {\an8}; escape stray < and &
  function cleanText(s) {
    return String(s || '')
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/<\s*(\/?)\s*([ibu])\s*>/gi, '\u0001$1$2\u0002')
      .replace(/<[^>]*>/g, '')
      .replace(/&(?!(?:amp|lt|gt|lrm|rlm|nbsp);)/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\u0001/g, '<').replace(/\u0002/g, '>')
      .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  }
  function parse(text) {
    const src = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    if (/^\[Script Info\]/mi.test(src.slice(0, 4000)) || /^Dialogue:\s*\d/m.test(src.slice(0, 20000))) return parseAss(src);
    const blocks = src.split(/\n[ \t]*\n+/);
    const cues = [];
    for (const blk of blocks) {
      const lines = blk.split('\n');
      const ti = lines.findIndex((l) => /-->/.test(l));
      if (ti < 0) continue;
      const [a, b] = lines[ti].split('-->');
      const start = toSec(a), end = toSec(b);
      if (!isFinite(start) || !isFinite(end)) continue;
      const body = cleanText(lines.slice(ti + 1).join('\n'));
      if (!body) continue;
      cues.push({start, end: end > start ? end : start + 2, text: body});
    }
    cues.sort((x, y) => x.start - y.start);
    return cues;
  }
  // ASS / SSA (the "Dialogue:" lines; the column order comes from the "Format:" line of [Events])
  function parseAss(src) {
    const cues = [];
    let cols = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    let inEvents = false;
    for (const line of String(src || '').replace(/\r\n?/g, '\n').split('\n')) {
      const l = line.trim();
      if (/^\[.*\]$/.test(l)) { inEvents = /^\[events\]$/i.test(l); continue; }
      if (inEvents && /^Format:/i.test(l)) { cols = l.slice(7).split(',').map((c) => c.trim().toLowerCase()); continue; }
      if (!/^Dialogue:/i.test(l)) continue;
      const parts = l.slice(9).trim().split(',');
      const n = cols.length;
      if (parts.length < n) continue;
      const f = parts.slice(0, n - 1).concat(parts.slice(n - 1).join(','));
      const start = toSec(f[cols.indexOf('start')] || ''), end = toSec(f[cols.indexOf('end')] || '');
      if (!isFinite(start) || !isFinite(end)) continue;
      const ti = cols.indexOf('text');
      const raw = String(f[ti < 0 ? n - 1 : ti] || '');
      if (/\{[^}]*\\p[1-9]/.test(raw)) continue;                     // a vector drawing, not text
      const body = cleanText(raw.replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' '));
      if (!body) continue;
      cues.push({start, end: end > start ? end : start + 2, text: body});
    }
    cues.sort((x, y) => x.start - y.start);
    return cues;
  }
  // subfix.repair_cues, reduced: the same line twice in a row is one cue, nothing lasts more than 20 s
  function repair(cues) {
    const out = [];
    for (const c of cues || []) {
      if (!c || !(c.end > c.start) || !String(c.text || '').trim()) continue;
      const last = out[out.length - 1];
      if (last && last.text === c.text && c.start - last.end < 0.05) { last.end = Math.max(last.end, c.end); continue; }
      out.push({start: c.start, end: Math.min(c.end, c.start + 20), text: c.text});
    }
    return out;
  }
  // which script most of the letters are in: 'he' | 'ru' | 'en' | '' (a track labelled Hebrew with English text is not Hebrew)
  function scriptOf(cuesOrText) {
    const s = typeof cuesOrText === 'string' ? cuesOrText : (cuesOrText || []).slice(0, 400).map((c) => c.text).join(' ');
    const txt = s.replace(/<[^>]*>/g, ' ');
    const he = (txt.match(/[א-ת]/g) || []).length, ru = (txt.match(/[а-яА-Я]/g) || []).length,
      en = (txt.match(/[a-zA-Z]/g) || []).length;
    const top = Math.max(he, ru, en);
    if (top < 8) return '';
    return he === top ? 'he' : ru === top ? 'ru' : 'en';
  }
  function toVtt(cuesOrText) {
    const cues = typeof cuesOrText === 'string' ? parse(cuesOrText) : (cuesOrText || []);
    return 'WEBVTT\n\n' + cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}`).join('\n\n') + '\n';
  }
  function toSrt(cues) {
    return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${String(c.text).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')}`).join('\n\n') + '\n';
  }
  function shift(cues, sec) {
    const d = Number(sec) || 0;
    return (cues || []).map((c) => ({start: Math.max(0, c.start + d), end: Math.max(0.01, c.end + d), text: c.text}))
      .filter((c) => c.end > 0.01 || d >= 0);
  }

  // ------------------------------------------------------------ release names
  const STOP = new Set(['the', 'a', 'and', 'of', 'mkv', 'mp4', 'avi', 'srt', 'heb', 'hebrew', 'eng']);
  const toks = (s) => String(s || '').toLowerCase().replace(/\.(srt|mkv|mp4|avi|vtt)$/, '').split(/[^a-z0-9א-ת]+/)
    .filter((t) => t && !STOP.has(t));
  function releaseScore(a, b) {
    const A = new Set(toks(a)), B = new Set(toks(b));
    if (!A.size || !B.size) return 0;
    let hit = 0;
    for (const t of A) if (B.has(t)) hit++;
    return hit / Math.max(A.size, B.size);
  }

  const S = {decode, unzip, pickFile, parse, parseAss, repair, scriptOf, toVtt, toSrt, shift, releaseScore, isZip, cleanText, toSec, stamp};
  root.TNSrt = S;
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
  if (root.TN && root.TN.registerProvider) root.TN.registerProvider('srt', Object.assign({kinds: ['service']}, S));
})(typeof self !== 'undefined' ? self : globalThis);
