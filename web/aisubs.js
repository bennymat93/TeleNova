'use strict';
// AI subtitles from the SOUND of the video (owner, 2026-11-24): speech -> the viewer's language, for any video the
// player plays - live TV included - with no server on a PC. The audio goes from this device to Google Gemini on the
// viewer's own key (synced gemini_key), which hears and translates in one call; the lines are added to a text track
// of the <video>, drawn like any subtitle (compat.js draws "showing" tracks too).
//
// Where the sound comes from, per playback path (see docs in ios-app/WEB_CHANGES_NEEDED.md / the research notes):
//   hls.js (live TV, HLS films; MSE)  the audio of the fragments hls.js already downloaded (FRAG_LOADED): MPEG-TS ->
//                                     the AAC (ADTS) / MP3 elementary stream; packed audio (.aac); fMP4 audio
//                                     renditions (init + fragment). No second download; fragments load ahead of
//                                     the picture, so the lines are ready before they are needed.
//   same-origin / open (CORS) files   a silent "shadow" <video> of the same file runs ~30 s ahead of the picture and
//   (Telegram /tgstream/, blob:, ...) its sound is read through Web Audio.
//   not possible                      a cross-origin file whose server refuses CORS, native HLS without MSE, the
//                                     built-in MKV/HEVC engine (compat.js) - said plainly to the viewer.
// API: TNAISubs.start({video, hls, url, live, lang, title}, onState) -> Promise<{stop(), track}>; prime() from a tap.
(function (G) {
  if (G.TNAISubs) return;
  const TN = G.TN;
  const TX = {
    he: {wait: 'תרגום AI מהקול: מאזין…', working: 'תרגום AI מהקול פעיל', label: 'תרגום AI (מהקול)', nokey: 'כדי לתרגם מהקול צריך מפתח Gemini: חשבונות ושירותים ← Gemini.',
         cannot: 'אי אפשר לקרוא את הקול של הסרטון הזה (השרת שלו חוסם, או שהוא מתנגן בנגן המובנה). תרגום מכתוביות קיימות עדיין אפשרי.',
         quota: 'מכסת Gemini החינמית התמלאה לרגע - ממשיך בעוד דקה.', prep: 'מכין תרגום מדויק… הסרטון ימשיך בעוד רגע', fail: 'תרגום AI מהקול נכשל: ', codec: 'הקול בערוץ הזה בפורמט ש-Gemini לא מקבל (AC3).'},
    en: {wait: 'AI from the sound: listening…', working: 'AI translation from the sound is on', label: 'AI (from the sound)', nokey: 'Translating from the sound needs a Gemini key: Accounts & services > Gemini.',
         cannot: 'The sound of this video cannot be read (its server refuses, or it plays in the built-in engine). Translating an existing subtitle still works.',
         quota: 'The free Gemini quota is full for the moment - going on in a minute.', prep: 'Preparing an exact translation… the video goes on in a moment', fail: 'AI from the sound failed: ', codec: 'This channel’s sound is in a format Gemini does not take (AC3).'},
    ru: {wait: 'ИИ по звуку: слушаю…', working: 'Перевод ИИ по звуку включён', label: 'ИИ (по звуку)', nokey: 'Для перевода по звуку нужен ключ Gemini: Аккаунты и сервисы > Gemini.',
         cannot: 'Звук этого видео недоступен (сервер запрещает или видео идёт во встроенном плеере). Перевод готовых субтитров работает.',
         quota: 'Бесплатная квота Gemini исчерпана - продолжу через минуту.', prep: 'Готовлю точный перевод… видео продолжится через мгновение', fail: 'Перевод ИИ по звуку не удался: ', codec: 'Звук канала в формате, который Gemini не принимает (AC3).'}
  };
  const tx = (k) => (TX[(TN && TN.lang && TN.lang()) || 'he'] || TX.en)[k];
  const LANG_NAME = {he: 'Hebrew', en: 'English', ru: 'Russian', ar: 'Arabic', fr: 'French', es: 'Spanish', de: 'German'};
  const synced = () => { try { return (TN.settings.synced && TN.settings.synced()) || {}; } catch (e) { return {}; } };
  const geminiKey = () => String(synced().gemini_key || G.__tnAiTestKey || '').trim();   // __tnAiTestKey: the CI test only
  // quality first: Flash (best speech + translation of the fast models, ~9 cents per hour of audio), Flash-Lite as fallback
  const models = () => [...new Set([synced().gemini_model, 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'].filter(Boolean))];

  // ------------------------------------------------------------ audio context (created inside a tap: iOS needs it)
  let actx = null;
  function prime() {
    try {
      if (!actx) actx = G.__tnAiCtx || new (G.AudioContext || G.webkitAudioContext)();   // made by the player in the tap
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
    return actx;
  }

  // ------------------------------------------------------------ MPEG-TS -> audio elementary stream
  // returns {mime, bytes} for the first audio stream (AAC ADTS 0x0F / MP3 0x03,0x04), or {mime: ''} with a reason
  function tsAudio(buf) {
    const d = new Uint8Array(buf);
    let pmt = -1, apid = -1, kind = 0;
    const parts = [];
    let cur = null;
    for (let off = 0; off + 188 <= d.length; off += 188) {
      if (d[off] !== 0x47) { const n = d.indexOf(0x47, off + 1); if (n < 0) break; off = n - 188; continue; }
      const pusi = (d[off + 1] & 0x40) !== 0, pid = ((d[off + 1] & 0x1f) << 8) | d[off + 2], afc = (d[off + 3] >> 4) & 3;
      let p = off + 4;
      if (afc === 2) continue;
      if (afc === 3) p += 1 + d[p];
      if (p >= off + 188) continue;
      if (pid === 0 && pusi) { p += 1 + d[p]; pmt = ((d[p + 10] & 0x1f) << 8) | d[p + 11]; continue; }
      if (pid === pmt && pusi && apid < 0) {
        p += 1 + d[p];
        const secLen = ((d[p + 1] & 0x0f) << 8) | d[p + 2], end = Math.min(p + 3 + secLen - 4, off + 188);
        const piLen = ((d[p + 10] & 0x0f) << 8) | d[p + 11];
        for (let q = p + 12 + piLen; q + 5 <= end;) {
          const st = d[q], epid = ((d[q + 1] & 0x1f) << 8) | d[q + 2], esLen = ((d[q + 3] & 0x0f) << 8) | d[q + 4];
          if ((st === 0x0f || st === 0x03 || st === 0x04 || st === 0x81 || st === 0x06) && apid < 0) { apid = epid; kind = st; }
          q += 5 + esLen;
        }
        continue;
      }
      if (pid !== apid) continue;
      if (pusi) {                                     // a new PES: skip its header
        if (d[p] === 0 && d[p + 1] === 0 && d[p + 2] === 1) p += 9 + d[p + 8];
        cur = true;
      }
      if (cur && p < off + 188) parts.push(d.subarray(p, off + 188));
    }
    if (apid < 0) return {mime: '', why: 'noaudio'};
    if (kind === 0x81 || kind === 0x06) return {mime: '', why: 'codec'};
    let n = 0; for (const x of parts) n += x.length;
    const out = new Uint8Array(n); let o = 0; for (const x of parts) { out.set(x, o); o += x.length; }
    return {mime: kind === 0x0f ? 'audio/aac' : 'audio/mp3', bytes: out};
  }
  // packed audio segment (.aac with an ID3 tag in front)
  function packedAudio(buf) {
    let d = new Uint8Array(buf), p = 0;
    while (d[p] === 0x49 && d[p + 1] === 0x44 && d[p + 2] === 0x33) {
      const size = ((d[p + 6] & 0x7f) << 21) | ((d[p + 7] & 0x7f) << 14) | ((d[p + 8] & 0x7f) << 7) | (d[p + 9] & 0x7f);
      p += 10 + size;
    }
    if (d[p] === 0xff && (d[p + 1] & 0xf6) === 0xf0) return {mime: 'audio/aac', bytes: d.subarray(p)};
    if (d[p] === 0xff && (d[p + 1] & 0xe0) === 0xe0) return {mime: 'audio/mp3', bytes: d.subarray(p)};
    return null;
  }
  const concat = (list) => { let n = 0; for (const x of list) n += x.length; const o = new Uint8Array(n); let i = 0; for (const x of list) { o.set(x, i); i += x.length; } return o; };
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  // 16 kHz mono 16-bit PCM -> WAV
  function wav(pcm) {
    const out = new Uint8Array(44 + pcm.length * 2), v = new DataView(out.buffer);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, pcm[i] * 32767)), true);
    return out;
  }

  // ------------------------------------------------------------ where the speech is (exact timing, silence cuts)
  // energy of 20 ms frames -> speech segments [{s, e}] in seconds; the threshold follows the clip's own noise floor
  function speechSegs(x, sr) {
    const hop = Math.max(1, Math.round(sr * 0.02)), n = Math.floor(x.length / hop);
    if (n < 5) return [];
    const en = new Float32Array(n);
    for (let i = 0; i < n; i++) { let a = 0; for (let k = i * hop, z = k + hop; k < z; k++) a += x[k] * x[k]; en[i] = Math.sqrt(a / hop); }
    const sorted = Float32Array.from(en).sort();
    const floor = sorted[Math.floor(n * 0.15)], peak = sorted[Math.floor(n * 0.97)];
    const thr = Math.max(floor * 2.5, floor + (peak - floor) * 0.12, 0.004);
    const segs = [];
    let on = -1, quiet = 0, loud = 0;
    for (let i = 0; i < n; i++) {
      if (en[i] > thr) { loud++; quiet = 0; if (on < 0 && loud >= 3) on = i - 2; }
      else { loud = 0; if (on >= 0 && ++quiet >= 15) { segs.push({s: on * 0.02, e: (i - quiet + 1) * 0.02}); on = -1; quiet = 0; } }
    }
    if (on >= 0) segs.push({s: on * 0.02, e: n * 0.02});
    return segs.filter((g) => g.e - g.s >= 0.12);
  }
  // the best place to end a chunk near `target` seconds: the middle of the longest pause in [target - 4, target + 1]
  function silenceCut(segs, target, total) {
    let best = -1, bestLen = 0;
    const gaps = [];
    for (let i = 0; i <= segs.length; i++) {
      const a = i === 0 ? 0 : segs[i - 1].e, b = i === segs.length ? total : segs[i].s;
      if (b > a) gaps.push({a, b});
    }
    for (const g of gaps) {
      const mid = (g.a + g.b) / 2;
      if (mid < target - 4 || mid > Math.min(total - 0.3, target + 1)) continue;
      if (g.b - g.a > bestLen) { bestLen = g.b - g.a; best = mid; }
    }
    return best;
  }
  async function decodeMono(bytes) {
    const ac = actx || G.__tnAiCtx;
    if (!ac || !ac.decodeAudioData) return null;
    try {
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const ab = await new Promise((ok, no) => { const p = ac.decodeAudioData(buf, ok, no); if (p && p.then) p.then(ok, no); });
      const a = ab.getChannelData(0), b = ab.numberOfChannels > 1 ? ab.getChannelData(1) : a;
      const out = new Float32Array(a.length); for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
      return {x: out, sr: ab.sampleRate};
    } catch (e) { return null; }
  }
  // ADTS frames of an AAC stream: [{off, len}] and the frame length in seconds
  function adtsFrames(d) {
    const SR = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    const out = [];
    let sr = 0;
    for (let p = 0; p + 7 <= d.length;) {
      if (d[p] !== 0xff || (d[p + 1] & 0xf6) !== 0xf0) { p++; continue; }
      const len = ((d[p + 3] & 3) << 11) | (d[p + 4] << 3) | (d[p + 5] >> 5);
      if (len < 7 || p + len > d.length) break;
      if (!sr) sr = SR[(d[p + 2] >> 2) & 15] || 48000;
      out.push({off: p, len});
      p += len;
    }
    return {frames: out, dur: 1024 / (sr || 48000)};
  }
  // Gemini's times are close (+-1 s); the speech segments of the clip itself are exact: each line is moved to where its
  // words really start and end, lasts long enough to be read (17 characters a second, 1-7 s) and never overlaps the next
  function align(cues, segs, clipLen) {
    const out = [];
    for (const c of cues) {
      let s = Math.max(0, c.s), e = Math.min(clipLen + 0.5, c.e);
      if (segs.length) {
        let bestS = null, bestE = null;
        for (const g of segs) {
          if (Math.abs(g.s - s) <= 1.2 && (bestS === null || Math.abs(g.s - s) < Math.abs(bestS - s))) bestS = g.s;
          if (Math.abs(g.e - e) <= 1.2 && g.e > (bestS != null ? bestS : s) && (bestE === null || Math.abs(g.e - e) < Math.abs(bestE - e))) bestE = g.e;
        }
        if (bestS != null) s = bestS;
        if (bestE != null) e = bestE + 0.15;
      }
      const need = Math.min(7, Math.max(1.0, c.t.replace(/\s+/g, ' ').length / 17));
      if (e - s < need) e = s + need;
      if (e - s > 7) e = s + 7;
      out.push({s, e, t: c.t});
    }
    out.sort((a, b) => a.s - b.s);
    for (let i = 0; i + 1 < out.length; i++) if (out[i].e > out[i + 1].s - 0.05) out[i].e = Math.max(out[i].s + 0.6, out[i + 1].s - 0.05);
    return out;
  }

  // ------------------------------------------------------------ Gemini: sound -> timed lines in the viewer's language
  async function gemini(bytes, mime, ctx, signal) {
    const key = geminiKey();
    if (!key) throw Object.assign(new Error('nokey'), {code: 'nokey'});
    const lang = LANG_NAME[ctx.lang] || 'Hebrew';
    const prompt = 'You are a professional film and TV subtitler. The audio clip is part of a video' +
      (ctx.title ? ' titled "' + String(ctx.title).slice(0, 80) + '"' : '') + '.\n' +
      'Step 1: transcribe exactly what is said, in the original language ("src").\n' +
      'Step 2: translate it into natural, fluent, idiomatic ' + lang + ' subtitles ("t"), faithful to the meaning and tone.\n' +
      'Rules: one cue per sentence or natural phrase; at most 2 lines and about 42 characters per line; "s" and "e" are the ' +
      'exact seconds (decimals) from the start of THIS clip when those words begin and end being spoken; never merge two ' +
      'speakers in one cue - when a cue has two speakers, start each line with "- "; keep names, places and numbers; ' +
      (lang === 'Hebrew' ? 'Hebrew: correct gender and number agreement, everyday spoken register, no niqqud, punctuation at the end of the line; ' : '') +
      'translate idioms by meaning; if the speech is already in ' + lang + ', "t" is the clean transcription; ' +
      'skip music, noise and unclear sounds; a word cut at the very start or end of the clip may be left out.' +
      (ctx.prev && ctx.prev.length ? '\nThe previous subtitles, for context and consistent names and terms (do not repeat them):\n' +
        ctx.prev.map((x) => '- ' + String(x).slice(0, 140)).join('\n') : '') +
      '\nReturn JSON {"cues":[{"s":number,"e":number,"src":"...","t":"..."}]}, {"cues":[]} when nobody speaks.';
    const schema = {type: 'object', properties: {cues: {type: 'array', items: {type: 'object', properties: {
      s: {type: 'number'}, e: {type: 'number'}, src: {type: 'string'}, t: {type: 'string'}}, required: ['s', 'e', 't']}}}, required: ['cues']};
    const mk = (withSchema) => JSON.stringify({contents: [{role: 'user', parts: [{inline_data: {mime_type: mime, data: b64(bytes)}}, {text: prompt}]}],
      generationConfig: Object.assign({responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 6144}, withSchema ? {responseSchema: schema} : {})});
    let body = mk(true), schemaOn = true;
    let last = null;
    for (const m of models()) {
      let r;
      try {
        r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(m) + ':generateContent',
          {method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': key}, body, credentials: 'omit', signal});
      } catch (e) { if (signal && signal.aborted) throw e; last = e; continue; }
      if (r.status === 429) throw Object.assign(new Error('quota'), {code: 'quota'});
      if (r.status === 400 && schemaOn) { schemaOn = false; body = mk(false); r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(m) + ':generateContent',
          {method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': key}, body, credentials: 'omit', signal}).catch((e) => null); if (!r) continue; }
      if (r.status === 429) throw Object.assign(new Error('quota'), {code: 'quota'});
      if (r.status === 404 || r.status === 400) { last = new Error('Gemini ' + r.status + ' (' + m + ')'); continue; }
      if (!r.ok) { last = new Error('Gemini ' + r.status); continue; }
      const j = await r.json().catch(() => null);
      const text = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts &&
        j.candidates[0].content.parts.map((p) => p.text || '').join('');
      let o = null;
      try { o = JSON.parse(String(text || '').replace(/^```(?:json)?|```$/g, '').trim()); } catch (e) { o = null; }
      const cues = o && Array.isArray(o.cues) ? o.cues : Array.isArray(o) ? o : null;
      if (!cues) { last = new Error('Gemini: no cues'); continue; }
      const num = (x) => typeof x === 'number' ? x : /^\d+:\d+(\.\d+)?$/.test(String(x)) ? String(x).split(':').reduce((a, b) => a * 60 + Number(b), 0) : Number(x);
      return cues.map((c) => ({s: num(c.s != null ? c.s : c.start), e: num(c.e != null ? c.e : c.end), t: String(c.t != null ? c.t : c.text || '').trim()}))
        .filter((c) => c.t && isFinite(c.s) && isFinite(c.e) && c.e > c.s);
    }
    throw last || new Error('Gemini');
  }

  // ------------------------------------------------------------ one run
  async function start(o, onState) {
    o = o || {};
    const say = (k, extra) => { try { onState && onState(k, extra); } catch (e) { /* the player is gone */ } };
    if (!geminiKey()) { say('nokey', tx('nokey')); throw Object.assign(new Error('nokey'), {code: 'nokey'}); }
    const v = o.video, lang = o.lang || (TN.lang && TN.lang()) || 'he';
    const track = v.addTextTrack('subtitles', tx('label'), lang);
    for (const t of Array.from(v.textTracks)) if (t !== track && t.mode === 'showing') t.mode = 'disabled';
    track.mode = 'showing';
    const ctl = new AbortController();
    let stopped = false, busy = 0, fails = 0, pausedUntil = 0, gate = null;
    const prev = [];
    const queue = [];
    const stops = [];
    const addCue = (s, e, t, keep) => {
      if (!(e > s)) return;
      const list = Array.from(track.cues || []);
      for (const c of list) if (Math.abs(c.startTime - s) < 2 && c.text === t) return;   // overlap of two chunks
      for (const c of list) if (c.startTime < s && c.endTime > s - 0.05) c.endTime = Math.max(c.startTime + 0.6, s - 0.05);   // no overlap
      try { const C = G.VTTCue || G.TextTrackCue; const q = new C(s, e, t); track.addCue(q); if (!keep) cache.cue(s, e, t); } catch (e2) { /* a cue the browser refuses */ }
    };
    // finished lines are kept on this device (per video and language): watching again costs nothing and starts at once
    const cache = (() => {
      const id = 'tn_aisubs:' + lang + ':' + String(o.key || o.url || '').slice(0, 300);
      let data = {cues: [], ranges: []}, t = 0;
      const save = () => { clearTimeout(t); t = setTimeout(() => { try { localStorage.setItem(id, JSON.stringify({cues: data.cues.slice(-4000), ranges: data.ranges.slice(-2000)})); } catch (e) { /* full */ } }, 1500); };
      try { const got = JSON.parse(localStorage.getItem(id) || 'null'); if (got && Array.isArray(got.cues)) data = got; } catch (e) { /* none */ }
      return {
        load() { for (const c of data.cues) addCue(c[0], c[1], c[2], true); },
        cue(s, e, t2) { data.cues.push([s, e, t2]); save(); },
        add(a, b) { data.ranges.push([a, b]); save(); },
        covered(a, b) { let n = 0; for (const [x, y] of data.ranges) n += Math.max(0, Math.min(b, y) - Math.max(a, x)); return n >= (b - a) * 0.8; }
      };
    })();
    if (!o.live) cache.load();
    async function pump() {
      while (!stopped && busy < 2 && queue.length) {
        if (Date.now() < pausedUntil) { setTimeout(pump, pausedUntil - Date.now() + 50); return; }
        const ch = queue.shift();
        busy++;
        Promise.all([gemini(ch.bytes, ch.mime, {lang, title: o.title, prev: prev.slice(-3)}, ctl.signal),
          ch.segs ? Promise.resolve(ch.segs) : decodeMono(ch.bytes).then((d) => d ? speechSegs(d.x, d.sr) : [])]).then(([cues, segs]) => {
          fails = 0;
          for (const c of align(cues, segs || [], ch.dur)) addCue(ch.start + c.s, ch.start + c.e, c.t);
          for (const c of cues) { prev.push(c.t); if (prev.length > 6) prev.shift(); }
          cache.add(ch.start, ch.start + ch.dur);
          if (gate) gate();
          say('on', tx('working'));
        }, (e) => {
          if (stopped) return;
          if (e && e.code === 'quota') { pausedUntil = Date.now() + 60000; queue.unshift(ch); say('quota', tx('quota')); return; }
          if (e && e.code === 'nokey') { say('nokey', tx('nokey')); stop(); return; }
          if (++fails >= 3) say('error', tx('fail') + String((e && e.message) || e).replace(/key=[^&\s]+/g, '').slice(0, 80));
        }).finally(() => { busy--; pump(); });
      }
    }
    const push = (ch) => {
      if (stopped || !ch.bytes || ch.bytes.length <= 512) return;
      if (!o.live && cache.covered(ch.start, ch.start + ch.dur)) { if (gate) gate(); return; }
      queue.push(ch); if (queue.length > 12) queue.splice(0, queue.length - 12); pump();
    };
    function stop() {
      if (stopped) return;
      stopped = true; ctl.abort();
      for (const f of stops) { try { f(); } catch (e) { /* gone */ } }
    }

    let how = '';
    // ---- 1. hls.js: the fragments it already fetched
    if (o.hls && G.Hls) {
      how = 'hls';
      const E = G.Hls.Events;
      let acc = [], accStart = -1, accDur = 0, accMime = '', inits = {};
      let cutting = Promise.resolve();
      const flush = (force) => {
        if (!acc.length) return;
        const bytes = concat(acc), start = accStart, dur = accDur, mime = accMime;
        acc = []; accStart = -1; accDur = 0;
        if (mime !== 'audio/aac' || force) { push({start, dur, mime, bytes}); return; }
        // a sentence is never cut in the middle: the chunk ends in the longest pause near its end, the rest opens the next
        cutting = cutting.then(async () => {
          const d = await decodeMono(bytes);
          const segs = d ? speechSegs(d.x, d.sr) : null;
          const af = adtsFrames(bytes);
          const total = af.frames.length * af.dur;
          const cut = segs ? silenceCut(segs, total - 2, total) : -1;
          if (cut <= 0 || !af.frames.length) { push({start, dur: total || dur, mime, bytes, segs}); return; }
          const k = Math.max(1, Math.min(af.frames.length - 1, Math.round(cut / af.dur)));
          const head = bytes.subarray(0, af.frames[k].off), tail = bytes.subarray(af.frames[k].off);
          push({start, dur: k * af.dur, mime, bytes: head, segs: segs.filter((g) => g.s < k * af.dur).map((g) => ({s: g.s, e: Math.min(g.e, k * af.dur)}))});
          if (accStart < 0) { accStart = start + k * af.dur; accMime = mime; acc.unshift(tail); accDur += total - k * af.dur; }
          else { acc.unshift(tail); accStart = start + k * af.dur; accDur += total - k * af.dur; }
        });
      };
      const onFrag = (ev, data) => {
        if (stopped) return;
        const f = data && data.frag;
        if (!f || !data.payload || (f.type !== 'main' && f.type !== 'audio')) return;
        if (o.hls.audioTracks && o.hls.audioTracks.length > 1 && f.type === 'main' && o.hls.audioTrack >= 0 && hasAltAudio()) return;
        if (f.sn === 'initSegment') { inits[f.type] = new Uint8Array(data.payload); return; }
        const buf = data.payload;
        const u = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
        let got = null;
        if (u[0] === 0x47) got = tsAudio(buf);
        else got = packedAudio(buf);
        if (!got && f.type === 'audio' && inits.audio) got = {mime: 'audio/mp4', bytes: concat([inits.audio, new Uint8Array(buf)])};
        if (!got) return;
        if (!got.mime) { if (got.why === 'codec') say('error', tx('codec')); return; }
        if (accMime && accMime !== got.mime) flush();
        if (acc.length && Math.abs(accStart + accDur - f.start) > 1.5) flush(true);   // a jump (seek): a new chunk
        if (accStart < 0) accStart = f.start;
        accMime = got.mime; acc.push(got.bytes); accDur += f.duration || 0;
        if (accDur >= (o.live ? 12 : 22)) flush();
      };
      const hasAltAudio = () => { try { return !!(o.hls.levels && o.hls.audioTracks.some((t) => t.url)); } catch (e) { return false; } };
      o.hls.on(E.FRAG_LOADED, onFrag);
      stops.push(() => o.hls.off(E.FRAG_LOADED, onFrag));
      // live: keep the picture ~20 s behind the newest fragment, so each line is ready before its moment
      if (o.live) {
        const keepBehind = () => {
          try {
            const sk = v.seekable;
            if (!sk || !sk.length) return;
            const edge = sk.end(sk.length - 1), from = sk.start(0), want = edge - 22;
            if (v.currentTime > edge - 14 && want > from + 1) v.currentTime = want;
          } catch (e) { /* not seekable */ }
        };
        setTimeout(keepBehind, 1500);
      }
      // what hls.js loaded BEFORE the button was pressed (the buffer ahead of the picture, 30-60 s) does not load again:
      // those fragments are fetched once more here, in order, so the first lines come at once
      (async () => {
        try {
          const lv = o.hls.levels && o.hls.levels[o.hls.currentLevel >= 0 ? o.hls.currentLevel : 0];
          const frags = (lv && lv.details && lv.details.fragments) || [];
          const now = v.currentTime || 0;
          let end = now;
          try { for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= now + 1) end = Math.max(end, v.buffered.end(i)); } catch (e) { /* none */ }
          for (const f of frags) {
            if (stopped) return;
            if (f.start + f.duration <= now || f.start >= end) continue;
            const r = await fetch(f.url, {credentials: 'omit', signal: ctl.signal});
            if (!r.ok) continue;
            onFrag(null, {frag: f, payload: await r.arrayBuffer()});
          }
          flush();
        } catch (e) { /* the next fragments still come */ }
      })();
    } else if (o.compat) {
      how = '';
    } else if (o.url) {
      // ---- 2. a silent shadow copy of the same file, ahead of the picture
      const url = String(o.url);
      const same = url.startsWith('blob:') || new URL(url, location.href).origin === location.origin;
      let open = same;
      if (!same) {
        try { const r = await fetch(url, {headers: {Range: 'bytes=0-1'}, credentials: 'omit', signal: ctl.signal}); open = r.ok || r.status === 206; try { r.body && r.body.cancel(); } catch (e) { /* done */ } }
        catch (e) { open = false; }
      }
      const ac = prime();
      if (open && ac) {
        how = 'shadow';
        const sh = document.createElement('video');
        if (!same) sh.crossOrigin = 'anonymous';
        sh.playsInline = true; sh.setAttribute('playsinline', ''); sh.preload = 'auto';
        sh.src = url;
        sh.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9px;top:-9px';
        document.body.appendChild(sh);
        const node = ac.createMediaElementSource(sh);          // its sound goes only into this graph: nothing is heard
        const proc = ac.createScriptProcessor(4096, 2, 1);
        const mute = ac.createGain(); mute.gain.value = 0;
        node.connect(proc); proc.connect(mute); mute.connect(ac.destination);
        const ratio = ac.sampleRate / 16000;
        let pcm = [], pcmLen = 0, chunkStart = -1;
        const LEAD_MIN = 25, LEAD_MAX = 45, CHUNK = 14;
        const flush = (force) => {
          if (!pcmLen) return;
          const all = new Float32Array(pcmLen); let i = 0; for (const x of pcm) { all.set(x, i); i += x.length; }
          const start = chunkStart, total = pcmLen / 16000;
          pcm = []; pcmLen = 0; chunkStart = -1;
          const segs = speechSegs(all, 16000);
          const cut = force ? -1 : silenceCut(segs, total - 2, total);
          if (cut <= 0) { push({start, dur: total, mime: 'audio/wav', bytes: wav(all), segs}); return; }
          const k = Math.round(cut * 16000);
          push({start, dur: cut, mime: 'audio/wav', bytes: wav(all.subarray(0, k)), segs: segs.filter((g) => g.s < cut).map((g) => ({s: g.s, e: Math.min(g.e, cut)}))});
          pcm = [all.slice(k)]; pcmLen = all.length - k; chunkStart = start + cut;
        };
        proc.onaudioprocess = (e) => {
          if (stopped || sh.paused || sh.seeking) return;
          const a = e.inputBuffer.getChannelData(0), b = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : a;
          const n = Math.floor(a.length / ratio), out = new Float32Array(n);
          for (let k = 0; k < n; k++) { const j = Math.floor(k * ratio); out[k] = (a[j] + b[j]) / 2; }
          if (chunkStart < 0) chunkStart = Math.max(0, sh.currentTime - a.length / ac.sampleRate);
          pcm.push(out); pcmLen += n;
          if (pcmLen / 16000 >= CHUNK + 2) flush();
        };
        // the picture waits (once at the start and after a jump) until the first exact lines are ready: ~15 s
        const hold = () => {
          if (v.paused && !gate) return;
          const wasPlaying = !v.paused;
          try { v.pause(); } catch (e) { /* none */ }
          say('prep', tx('prep'));
          let done = false;
          const go = () => { if (done) return; done = true; gate = null; if (wasPlaying && !stopped) v.play().catch(() => {}); };
          gate = go;
          setTimeout(go, 25000);
        };
        const place = () => { flush(true); pcm = []; pcmLen = 0; chunkStart = -1; try { sh.currentTime = Math.max(0, v.currentTime || 0); } catch (e) { /* not yet */ } hold(); };
        const steer = () => {
          if (stopped) return;
          const lead = sh.currentTime - (v.currentTime || 0);
          if (lead < -2 || lead > 120) { place(); return; }
          if (lead > LEAD_MAX && !sh.paused) { flush(true); sh.pause(); }
          else if (lead < LEAD_MIN && sh.paused && (!v.paused || gate)) sh.play().catch(() => {});
        };
        const onSeek = () => { if (gate) return; queue.length = 0; const ahead = sh.currentTime - (v.currentTime || 0); if (ahead < -1 || ahead > LEAD_MAX + 5) place(); };
        v.addEventListener('seeking', onSeek);
        const timer = setInterval(steer, 1000);
        sh.addEventListener('loadedmetadata', () => { place(); sh.play().catch(() => {}); }, {once: true});
        stops.push(() => { clearInterval(timer); v.removeEventListener('seeking', onSeek); try { proc.disconnect(); node.disconnect(); } catch (e) { /* gone */ } sh.pause(); sh.removeAttribute('src'); sh.load(); sh.remove(); });
      }
    }
    if (!how) {
      try { track.mode = 'disabled'; } catch (e) { /* gone */ }
      say('cannot', tx('cannot'));
      throw Object.assign(new Error('cannot'), {code: 'cannot'});
    }
    say('wait', tx('wait'));
    return {stop, track, how, _queue: queue};
  }

  G.TNAISubs = {start, prime, tsAudio, packedAudio, wav, speechSegs, silenceCut, adtsFrames, align, _gemini: gemini};
})(self);
