'use strict';
// TeleNova web (5.1): the fallback playback engine. A browser plays MP4 / WebM / HLS with H.264 + AAC and little
// else; most Telegram and Real-Debrid releases are MKV with HEVC and AC3 / E-AC3 / DTS sound, and old ones are AVI /
// XviD or MPEG-TS. This module plays those through libmedia's AVPlayer (LGPL, vendor/avplayer-1.3.1/COPYING.LGPLv3):
// demuxing in JavaScript, then - per stream - the browser's own decoder (MSE / WebCodecs) when it has one, else a
// WebAssembly decoder (fetched from jsDelivr at the pinned version the first time that codec is met).
//
// The player (player.js) keeps its whole interface: attach(v, url, opts) makes the <video> element it already drives
// answer for the engine - currentTime, duration, paused, volume, playbackRate, play(), pause() and the media events
// (loadedmetadata, playing, pause, timeupdate, seeking, seeked, waiting, ended, error) - so buttons, keys, the resume
// point, "next episode" and the subtitle search work as with any other video. Subtitles added to the <video> as text
// tracks are drawn by this module (the element itself shows nothing while the engine plays).
//
// Service 'compat': supported() -> bool; attach(v, url, {at, live, onInfo}) -> Promise<{detach(), engine, info()}>;
// pure helpers for node tests: toMs, fromMs, activeCues, cueHtml, pickSubtitle, codecName.
// Limits (said plainly in the player when they bite): software decoding of 4K HEVC is too slow on weak devices; the
// first use of a codec downloads its decoder (0.3-2 MB); picture in picture and AirPlay belong to the <video> element
// and are not available while this engine plays.
(function (G) {
  const VENDOR = 'vendor/avplayer-1.3.1/avplayer.js';
  // ------------------------------------------------------------ pure helpers
  const toMs = (sec) => BigInt(Math.max(0, Math.floor((Number(sec) || 0) * 1000)));
  const fromMs = (ms) => { try { return Number(ms) / 1000 || 0; } catch (e) { return 0; } };
  // the cues to show at time t (seconds) from tracks = [{mode, cues: [{startTime, endTime, text}]}]
  function activeCues(tracks, t) {
    const out = [];
    for (const tr of tracks || []) {
      if (!tr || tr.mode !== 'showing' || !tr.cues) continue;
      for (let i = 0; i < tr.cues.length; i++) {
        const c = tr.cues[i];
        if (c && c.startTime <= t && t < c.endTime) out.push(String(c.text || ''));
      }
    }
    return out;
  }
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  // WebVTT cue text -> safe HTML: only <i> <b> <u> survive, every other tag is dropped, line breaks kept
  function cueHtml(text) {
    return esc(String(text || '').replace(/\r/g, ''))
      .replace(/&lt;(\/?)([ibu])&gt;/gi, '<$1$2>')
      .replace(/&lt;\/?[a-z][^&]*?&gt;/gi, '')
      .replace(/\n/g, '<br>');
  }
  // streams = [{id, mediaType, metadata: {language, title}}]; the subtitle stream in one of the wanted languages, or -1
  function pickSubtitle(streams, langs) {
    const want = (langs || []).map((l) => String(l).toLowerCase());
    const NAMES = {he: ['he', 'heb', 'iw', 'hebrew', 'עברית'], ru: ['ru', 'rus', 'russian', 'русский'], en: ['en', 'eng', 'english']};
    for (const l of want) {
      const names = NAMES[l] || [l];
      for (const st of streams || []) {
        if (!st || String(st.mediaType).toLowerCase() !== 'subtitle') continue;
        const md = st.metadata || {};
        const lang = String(md.language || md.LANGUAGE || '').toLowerCase(), title = String(md.title || md.TITLE || '').toLowerCase();
        if (names.indexOf(lang) >= 0 || names.some((n) => n.length > 2 && title.indexOf(n) >= 0)) return st.id;
      }
    }
    return -1;
  }
  function supported() {
    return typeof G.WebAssembly === 'object' && typeof G.BigInt === 'function' && typeof G.AudioContext !== 'undefined' ||
           (typeof G.WebAssembly === 'object' && typeof G.BigInt === 'function' && typeof G.webkitAudioContext !== 'undefined');
  }

  // ------------------------------------------------------------ the engine
  let libP = null;
  function lib() {
    if (G.AVPlayer) return Promise.resolve(G.AVPlayer.default || G.AVPlayer);
    if (!libP) {
      libP = G.TN.loadScript(VENDOR).then(() => {
        const A = G.AVPlayer && (G.AVPlayer.default || G.AVPlayer);
        if (!A) throw new Error('engine');
        return A;
      }).catch((e) => { libP = null; throw e; });
    }
    return libP;
  }
  const PROPS = ['currentTime', 'duration', 'paused', 'ended', 'volume', 'muted', 'playbackRate', 'readyState', 'videoWidth', 'videoHeight',
                 'buffered', 'error', 'play', 'pause', 'seeking'];

  // v: the player's <video>; url: https / same-origin / blob address. Resolves when the first picture or sound is ready.
  async function attach(v, url, opts) {
    opts = opts || {};
    if (!supported()) throw new Error('unsupported');
    const AV = await lib();
    const doc = v.ownerDocument;
    const box = doc.createElement('div');
    box.className = 'cp-box';
    box.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:#000';
    const cues = doc.createElement('div');
    cues.className = 'cp-cues';
    cues.setAttribute('aria-live', 'off');
    cues.style.cssText = 'position:absolute;left:4%;right:4%;bottom:9%;text-align:center;pointer-events:none;font-size:clamp(16px,2.6vw,40px);' +
      'line-height:1.35;color:#fff;text-shadow:0 0 4px #000,0 0 4px #000,0 2px 6px #000;white-space:pre-wrap;z-index:1';
    // the element itself goes quiet and invisible; it stays in the page because the player and subs.js hold it
    try { v.pause(); } catch (e) { /* nothing played */ }
    try { v.removeAttribute('src'); v.load(); } catch (e) { /* no source */ }
    const oldVis = v.style.visibility;
    v.style.visibility = 'hidden';
    v.parentNode.insertBefore(box, v.nextSibling);
    v.parentNode.insertBefore(cues, box.nextSibling);

    const st = {t: Number(opts.at) || 0, dur: NaN, paused: true, ended: false, vol: v.volume, muted: v.muted, rate: 1, ready: 0, seeking: false,
                err: null, w: 0, h: 0, dead: false, info: {}, seekAt: 0};
    const fire = (name) => { if (!st.dead) { try { v.dispatchEvent(new Event(name)); } catch (e) { /* closed */ } } };
    const player = new AV({container: box, enableHardware: true, enableWebCodecs: true, enableWorker: true, isLive: !!opts.live,
      // the browser's own pipeline whenever it can take every stream (MKV with H.264 + AAC): least CPU, real <video>
      preLoadTime: 6});
    const E = AV.Events || {};
    let chain = Promise.resolve();                     // the engine's calls must not overlap
    const run = (fn) => { chain = chain.then(() => (st.dead ? null : fn())).catch((e) => { fail(e); }); return chain; };
    function fail(e) {
      if (st.dead || st.err) return;
      st.err = {code: 4, message: String((e && e.message) || e || 'engine')};
      fire('error');
    }
    const applyVol = () => { try { player.setVolume(st.muted ? 0 : st.vol, true); } catch (e) { /* not ready */ } };
    function drawCues() {
      const list = activeCues(Array.prototype.slice.call(v.textTracks || []), st.t);
      const html = list.map(cueHtml).join('<br>');
      if (cues._html !== html) { cues._html = html; cues.innerHTML = html ? '<span dir="auto" style="background:rgba(0,0,0,.45);padding:.08em .4em;border-radius:.2em;box-decoration-break:clone;-webkit-box-decoration-break:clone">' + html + '</span>' : ''; }
    }
    // while a jump is in flight the engine still reports the old place; a jump that never reports back (asked for
    // while the file was still opening) must not freeze the clock, so after 4 s the engine's time counts again
    player.on(E.TIME || 'time', (pts) => {
      if (st.seeking) { if (Date.now() - st.seekAt < 4000) return; st.seeking = false; fire('seeked'); }
      st.t = fromMs(pts); drawCues(); fire('timeupdate');
    });
    player.on(E.PLAYED || 'played', () => { st.paused = false; st.ended = false; fire('play'); fire('playing'); });
    player.on(E.PAUSED || 'paused', () => { st.paused = true; fire('pause'); });
    player.on(E.ENDED || 'ended', () => { st.ended = true; st.paused = true; fire('pause'); fire('ended'); });
    player.on(E.SEEKING || 'seeking', () => { st.seeking = true; st.seekAt = Date.now(); fire('seeking'); fire('waiting'); });
    player.on(E.SEEKED || 'seeked', () => { st.seeking = false; fire('seeked'); if (!st.paused) fire('playing'); });
    player.on(E.ERROR || 'error', (e) => fail(e));
    player.on(E.TIMEOUT || 'timeout', () => fail(new Error('timeout')));

    const saved = {};
    const def = (name, d) => { saved[name] = Object.getOwnPropertyDescriptor(v, name); Object.defineProperty(v, name, Object.assign({configurable: true, enumerable: true}, d)); };
    def('currentTime', {get: () => st.t, set: (x) => {
      const to = Math.max(0, Number(x) || 0);
      st.t = to; st.seeking = true; st.seekAt = Date.now(); drawCues(); fire('seeking');
      run(() => player.seek(toMs(to))).then(() => { if (st.seeking) { st.seeking = false; fire('seeked'); } });
    }});
    def('duration', {get: () => st.dur});
    def('paused', {get: () => st.paused});
    def('ended', {get: () => st.ended});
    def('seeking', {get: () => st.seeking});
    def('readyState', {get: () => st.ready});
    def('videoWidth', {get: () => st.w});
    def('videoHeight', {get: () => st.h});
    def('error', {get: () => st.err});
    def('buffered', {get: () => ({length: 0, start: () => 0, end: () => 0})});
    def('volume', {get: () => st.vol, set: (x) => { st.vol = Math.max(0, Math.min(1, Number(x) || 0)); applyVol(); fire('volumechange'); }});
    def('muted', {get: () => st.muted, set: (x) => { st.muted = !!x; applyVol(); fire('volumechange'); }});
    def('playbackRate', {get: () => st.rate, set: (x) => { st.rate = Number(x) || 1; try { player.setPlaybackRate(st.rate); } catch (e) { /* not ready */ } fire('ratechange'); }});
    def('play', {value: () => run(() => (st.ended ? player.seek(toMs(0)).then(() => player.play()) : player.play())), writable: true});
    def('pause', {value: () => { run(() => player.pause()); }, writable: true});

    function detach() {
      if (st.dead) return;
      st.dead = true;
      for (const name of PROPS) {
        if (!(name in saved)) continue;
        try { if (saved[name]) Object.defineProperty(v, name, saved[name]); else delete v[name]; } catch (e) { /* the element is going away */ }
      }
      v.style.visibility = oldVis;
      // stop() is the one call the engine takes in the middle of another; destroy() only after it, or the instance
      // stays behind in its shared pipelines and the next file never starts
      const kill = () => { try { const p = player.destroy(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* gone */ } };
      try { const q = player.stop(true); if (q && q.then) q.then(kill, kill); else kill(); } catch (e) { kill(); }
      box.remove(); cues.remove();
    }
    const onSize = () => { try { player.resize(box.clientWidth, box.clientHeight); } catch (e) { /* not ready */ } };
    G.addEventListener('resize', onSize);
    const api = {detach: () => { G.removeEventListener('resize', onSize); detach(); }, engine: player, info: () => st.info,
      // embedded subtitle streams of the file: [{id, lang, title}], and choosing one (-1 = none)
      subtitles: () => (player.getStreams() || []).filter((x) => String(x.mediaType).toLowerCase() === 'subtitle')
        .map((x) => ({id: x.id, lang: String((x.metadata || {}).language || ''), title: String((x.metadata || {}).title || '')})),
      selectSubtitle: (id) => run(() => { if (id < 0) { player.setSubtitleEnable(false); return null; } player.setSubtitleEnable(true); return player.selectSubtitle(id); }),
      audios: () => (player.getStreams() || []).filter((x) => String(x.mediaType).toLowerCase() === 'audio')
        .map((x) => ({id: x.id, lang: String((x.metadata || {}).language || ''), title: String((x.metadata || {}).title || ''), on: x.id === player.getSelectedAudioStreamId()})),
      selectAudio: (id) => run(() => player.selectAudio(id))};
    try {
      await player.load(url, {http: {credentials: 'omit'}});
      if (st.dead) throw new Error('closed');
      const streams = player.getStreams() || [];
      const d = fromMs(player.getDuration());
      st.dur = d > 0 && !opts.live ? d : (opts.live ? Infinity : NaN);
      const vs = streams.find((x) => String(x.mediaType).toLowerCase() === 'video');
      try { st.w = (vs && vs.codecparProxy && vs.codecparProxy.width) || 0; st.h = (vs && vs.codecparProxy && vs.codecparProxy.height) || 0; } catch (e) { /* unknown */ }
      st.info = {streams: streams.length, mse: false, embeddedSubs: api.subtitles()};
      st.ready = 1;
      fire('durationchange'); fire('loadedmetadata');
      // subtitles inside the file: the viewer's language when the file has it, else none (subs.js looks for one)
      const subId = pickSubtitle(streams, opts.langs || ['he']);
      st.info.subtitle = subId;
      if (st.t > 0) await player.seek(toMs(st.t));
      applyVol();
      await player.play({subtitle: subId >= 0});
      if (subId >= 0) { try { await player.selectSubtitle(subId); } catch (e) { /* the default one stays */ } } else { try { player.setSubtitleEnable(false); } catch (e) { /* none */ } }
      try { st.info.mse = !!player.isMSE(); } catch (e) { /* unknown */ }
      st.ready = 4; st.paused = false;
      fire('canplay'); fire('play'); fire('playing');
      onSize();
      return api;
    } catch (e) {
      api.detach();
      throw e;
    }
  }

  const api = {supported, attach, toMs, fromMs, activeCues, cueHtml, pickSubtitle};
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (G.TN && G.TN.registerProvider) G.TN.registerProvider('compat', Object.assign({kinds: ['service'], label: 'Compatibility player'}, api));
})(typeof self !== 'undefined' ? self : globalThis);
