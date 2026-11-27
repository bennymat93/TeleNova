// node t_compat_sound.js - 6.6.1: the built-in engine's held sound (iPhone: picture with no sound and no 'tap for sound')
'use strict';
const path = require('path');
let n = 0, fails = 0;
const ok = (c, what) => { n++; if (!c) { fails++; console.log('FAIL ' + what); } };
// a tiny DOM: the <video>, its parent, the engine's box (with the engine's own inner <video>)
class El {
  constructor(tag) { this.tag = tag; this.style = {}; this.kids = []; this.muted = false; this.ev = {}; this.volume = 1; this.clientWidth = 640; this.clientHeight = 360; }
  setAttribute() {} removeAttribute() {} load() {} pause() {} remove() {}
  insertBefore(x) { this.kids.push(x); x.parentNode = this; }
  appendChild(x) { this.kids.push(x); }
  querySelector() { return this.inner || null; }
  addEventListener(name, fn) { (this.ev[name] = this.ev[name] || []).push(fn); }
  dispatchEvent(e) { (this.ev[e.type] || []).forEach((f) => f(e)); }
}
global.Event = class { constructor(t) { this.type = t; } };
global.AudioContext = function () {};
global.addEventListener = () => {}; global.removeEventListener = () => {};
const doc = {createElement: (t) => new El(t)};
global.document = undefined;
let cur = null;
function Fake(o) { cur = this; this.o = o; this.h = {}; this.ac = 'running'; this.vol = []; this.resumed = 0; }
Fake.Events = {};
Object.assign(Fake.prototype, {
  on(n, f) { (this.h[n] = this.h[n] || []).push(f); }, emit(n, x) { (this.h[n] || []).forEach((f) => f(x)); },
  load() { if (this.mse) { const m = new El('video'); m.muted = this.innerMuted; this.o.container.inner = m; } else { const m = new El('video'); m.muted = true; this.o.container.inner = m; } return Promise.resolve(); },
  getStreams() { return [{mediaType: 'Video', id: 0, codecparProxy: {width: 1, height: 1}}, {mediaType: 'Audio', id: 1}, {mediaType: 'Audio', id: 2}]; },
  getDuration() { return 60000; }, seek() { return Promise.resolve(); },
  play() { if (this.blockOnPlay) this.emit('resume'); return Promise.resolve(); },
  isSuspended() { return this.ac === 'suspended'; }, isMSE() { return this.mse; },
  resume() { this.resumed++; if (this.allow) this.ac = 'running'; return Promise.resolve(); },
  setVolume(x) { this.vol.push(x); }, setSubtitleEnable() {}, selectSubtitle() { return Promise.resolve(); }, selectAudio() { return Promise.resolve(); },
  getSelectedAudioStreamId() { return 1; }, resize() {}, stop() { return Promise.resolve(); }, destroy() { return Promise.resolve(); }, setPlaybackRate() {},
});
global.AVPlayer = Fake;
const C = require(path.join(__dirname, '..', '..', '..', 'web', 'compat.js'));
function video() { const p = new El('div'); const v = new El('video'); v.ownerDocument = doc; v.parentNode = p; v.textTracks = []; return v; }
const tick = () => new Promise((r) => setTimeout(r, 0));
(async () => {
  // 1) WebAudio mode, the engine reports RESUME (sound held) while its AudioContext state is not readable as suspended
  let v = video(), gest = 0; v.addEventListener('needgesture', () => gest++);
  Fake.prototype.blockOnPlay = true;
  let h = await C.attach(v, 'blob:x', {});
  ok(h.suspended() === true, 'RESUME event keeps the sound held (st.suspended counts)');
  ok(gest >= 1, 'needgesture fired');
  cur.allow = true; h.resumeAudio(); await tick(); await tick();
  ok(h.suspended() === false && cur.resumed >= 1, 'a tap resumes it and clears the held state');
  h.detach();
  // 2) WebAudio mode, inner element muted by design, AudioContext running: NOT held
  Fake.prototype.blockOnPlay = false;
  v = video(); h = await C.attach(v, 'blob:x', {});
  ok(h.suspended() === false, 'WebAudio: muted inner element + running AC is not held sound');
  h.detach();
  // 3) MSE mode, inner element held muted: held; a tap unmutes it
  Fake.prototype.mse = true; Fake.prototype.innerMuted = true;
  v = video(); h = await C.attach(v, 'blob:x', {});
  ok(h.suspended() === true, 'MSE: a muted inner element is held sound');
  h.resumeAudio(); await tick();
  ok(h.suspended() === false && v.parentNode.kids[0].inner.muted === false, 'MSE: a tap unmutes the inner element');
  h.detach();
  // 4) the viewer muted the film: not 'held'
  v = video(); v.muted = true; h = await C.attach(v, 'blob:x', {});
  ok(h.suspended() === false, 'MSE: the viewer\'s own mute is not held sound');
  // 5) unmuting through the property resumes the held sound
  v.parentNode.kids[0].inner.muted = true; v.muted = false; await tick();
  ok(v.parentNode.kids[0].inner.muted === false, 'unmute resumes held sound');
  h.detach();
  Fake.prototype.mse = false; Fake.prototype.innerMuted = false;
  // 6) selectAudio: a new track while held asks for a tap again
  Fake.prototype.blockOnPlay = true; v = video(); gest = 0; v.addEventListener('needgesture', () => gest++);
  h = await C.attach(v, 'blob:x', {}); const g0 = gest;
  await h.selectAudio(2);
  ok(gest > g0, 'selectAudio while held fires needgesture');
  h.detach(); Fake.prototype.blockOnPlay = false;
  // 7) iOS audio session
  const g = {navigator: {audioSession: {type: 'auto'}}};
  C.iosPlayback(g); ok(g.navigator.audioSession.type === 'playback', 'audioSession set to playback');
  C.iosPlayback({navigator: {}}); C.iosPlayback(null); ok(true, 'no audioSession: no error');
  console.log(fails ? 't_compat_sound FAILED ' + fails + ' of ' + n : 't_compat_sound OK (' + n + ' checks)');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e && e.stack)); process.exit(1); });
