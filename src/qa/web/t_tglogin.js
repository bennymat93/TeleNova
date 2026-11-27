'use strict';
// node t_tglogin.js - the Telegram lifecycle of web/tg.js with a fake GramJS client and fake timers (6.5.1):
// verified connect, timeouts, the shared resume, a login kept on non-auth errors, the supervisor (health check,
// single-flight rebuild), the sync round that always ends, the early wake-up listeners, the sign-in steps that end
// within 30 s, the QR loop (missed update, 2FA), the pending sign-in that survives the app being killed.
// No network, no real account: a real sign-in is still a manual check (README "How to test").
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'web', 'tg.js'), 'utf8');
let n = 0, fails = 0;
function ok(c, m) { n++; if (!c) { fails++; console.log('FAIL', m); } }
const flush = async (k) => { for (let i = 0; i < (k || 30); i++) await new Promise((r) => setImmediate(r)); };
const never = () => new Promise(() => {});
const rpc = (m) => Object.assign(new Error(m), {errorMessage: m});

function memStore() {
  const m = new Map();
  return {getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), _m: m};
}

// one fresh module per case. plan: {connect(c), invoke(c, req), getMe(c), cycle()} - each returns a promise
function boot(plan, opt) {
  opt = opt || {};
  let clock = 1000000;
  const timers = [];
  let tid = 0;
  const setT = (f, ms) => { const id = ++tid; timers.push({id, at: clock + Math.max(0, ms || 0), f}); return id; };
  const clrT = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  const setI = (f, ms) => { const id = ++tid; const rep = () => { timers.push({id, at: clock + ms, f: () => { rep(); f(); }}); }; rep(); return id; };
  class FDate extends Date { static now() { return clock; } }
  const docL = {}, winL = {};
  const document = {hidden: false, activeElement: null,
    addEventListener: (t, f) => (docL[t] = docL[t] || []).push(f),
    removeEventListener: (t, f) => { docL[t] = (docL[t] || []).filter((x) => x !== f); }};
  const made = [];
  const R = (name) => class { constructor(a) { Object.assign(this, a || {}); this.className = name; } };
  const Api = {updates: {GetState: R('updates.GetState')}, CodeSettings: R('CodeSettings'), Ping: R('Ping'),
    auth: {SendCode: R('auth.SendCode'), ResendCode: R('auth.ResendCode'), SignIn: R('auth.SignIn'), LogOut: R('auth.LogOut'),
      ExportLoginToken: R('auth.ExportLoginToken'), ImportLoginToken: R('auth.ImportLoginToken'), AcceptLoginToken: R('auth.AcceptLoginToken'),
      LoginTokenSuccess: R('auth.LoginTokenSuccess'), LoginToken: R('auth.LoginToken'), LoginTokenMigrateTo: R('auth.LoginTokenMigrateTo'),
      SentCodeSuccess: R('auth.SentCodeSuccess'), AuthorizationSignUpRequired: R('auth.AuthorizationSignUpRequired')}};
  class Client {
    constructor(sess, id, hash, o) { this.sess = sess.s; this.opts = o; this.connected = false; this.handlers = []; this.calls = []; this.nConnect = 0; made.push(this); }
    setLogLevel() {}
    connect() { this.nConnect++; return plan.connect ? plan.connect(this) : (this.connected = true, Promise.resolve(true)); }
    invoke(req) { this.calls.push(req.className); return plan.invoke ? plan.invoke(this, req) : Promise.resolve({}); }
    getMe() { return plan.getMe ? plan.getMe(this) : Promise.resolve({id: 42, firstName: 'Test'}); }
    destroy() { this.connected = false; this.destroyed = true; return Promise.resolve(); }
    disconnect() { this.connected = false; return Promise.resolve(); }
    addEventHandler(f) { this.handlers.push(f); }
    removeEventHandler(f) { this.handlers = this.handlers.filter((x) => x !== f); }
    signInWithPassword() { this.pw = true; return plan.password ? plan.password(this) : Promise.resolve({}); }
    _switchDC(dc) { this.dc = dc; return Promise.resolve(); }
  }
  Client.prototype.session = null;
  const GramJS = {TelegramClient: function (s, id, h, o) { const c = new Client(s, id, h, o); c.session = {save: () => 'SESSION-' + made.length}; return c; },
    sessions: {StringSession: function (s) { this.s = s; }}, Api, Buffer, events: {Raw: function () {}}, network: {}};
  const kv = new Map(Object.entries(opt.kv || {}));
  const box = {
    GramJS, Sealed: {cloudKey: (id) => 'k' + id}, fflate: {}, qrcode: function () {},
    document, navigator: {onLine: true}, location: opt.location || {protocol: 'https:', hostname: 'example.test', hash: ''},
    sessionStorage: opt.ss || memStore(), localStorage: opt.ls || memStore(),
    setTimeout: setT, clearTimeout: clrT, setInterval: setI, clearInterval: clrT, Date: FDate,
    addEventListener: (t, f) => (winL[t] = winL[t] || []).push(f), removeEventListener: (t, f) => { winL[t] = (winL[t] || []).filter((x) => x !== f); },
    fetch: () => Promise.reject(new Error('no network in tests')), crypto: globalThis.crypto, TextEncoder, btoa,
    console, Promise, Error, Object, JSON, Number, String, Array, Uint8Array, Map, Math, Boolean, RegExp,
  };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(src, box);
  const TG = box.TG;
  const cycles = {n: 0};
  const A = {get: (k, d) => (kv.has(k) ? kv.get(k) : d), put: (k, v) => kv.set(k, v), drop: (k) => kv.delete(k),
    X: (k) => k, fmt: (k, a) => k + ':' + a, version: 'test', loadScript: () => Promise.resolve(), onSettings() {}, onSynced() {},
    store: {onChange() {}, users: () => [], data: () => ({})}, button: () => ({}),
    WS: {cycle: () => { cycles.n++; return plan.cycle ? plan.cycle() : Promise.resolve({state: 'ok', users: 0, data: []}); }, TAG: '#t', noteOf: () => null}};
  TG.init(A);
  async function advance(ms) {
    const end = clock + ms;
    for (;;) {
      await flush();
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      clock = t.at;
      try { t.f(); } catch (e) { /* a timer of the module */ }
    }
    clock = end;
    await flush();
  }
  const fire = (t, ev) => { for (const f of (docL[t] || []).slice()) f(ev); };
  const fireWin = (t, ev) => { for (const f of (winL[t] || []).slice()) f(ev); };
  return {TG, A, kv, made, advance, box, document, fire, fireWin, cycles, now: () => clock};
}
const API = {tg_api: {id: '12345', hash: '0123456789abcdef0123456789abcdef'}};
const SIGNED = Object.assign({tg_session: 'OLD-SESSION'}, API);

(async () => {
  // ---- client options
  {
    const b = boot({}, {kv: SIGNED});
    await b.TG.resume();
    const o = b.made[0] && b.made[0].opts;
    ok(o && o.floodSleepThreshold === 10 && o.connectionRetries === 5, 'client options: floodSleepThreshold 10, connectionRetries 5');
    ok(b.TG.state() === 'on', 'a working connection signs in');
  }
  // ---- 1. connect() resolves false: offline, session kept, retry scheduled, getClient TG_OFFLINE
  {
    const b = boot({connect: () => Promise.resolve(false)}, {kv: SIGNED});
    await b.TG.resume();
    ok(b.TG.state() === 'offline', 'connect() false -> offline (was: hanging in connecting)');
    ok(b.kv.get('tg_session') === 'OLD-SESSION', 'connect() false keeps the saved login');
    ok(b.made[0].destroyed, 'the client that did not connect is destroyed');
    let err = '';
    try { await b.TG.client(); } catch (e) { err = e.message; }
    ok(err === 'TG_OFFLINE', 'getClient after a failed connect: TG_OFFLINE, not TG_NO_LOGIN (' + err + ')');
    const before = b.made.length;
    await b.advance(16000);
    ok(b.made.length > before, 'a retry runs by itself within 15 s');
  }
  // ---- 2. connect() never settles: ends within 30 s
  {
    const b = boot({connect: never}, {kv: SIGNED});
    let done = false;
    b.TG.resume().then(() => { done = true; });
    await b.advance(21000);                    // (the connect limit is 20 s; a retry follows 5 s later)
    ok(b.TG.state() !== 'connecting' && done, 'a connect that never answers ends within 30 s');
    ok(b.TG.state() === 'offline' && b.kv.get('tg_session') === 'OLD-SESSION', '... offline, login kept');
  }
  // ---- 3. connect() false but connected ("already connected") is not a failure
  {
    const b = boot({connect: (c) => { c.connected = true; return Promise.resolve(false); }}, {kv: SIGNED});
    await b.TG.resume();
    ok(b.TG.state() === 'on', 'connect() false with client.connected true is a connection');
  }
  // ---- 4. GetState errors: generic keeps the login, AUTH_KEY_UNREGISTERED removes it
  {
    const b = boot({invoke: (c, r) => (r.className === 'updates.GetState' ? Promise.reject(new Error('Request was unsuccessful 5 time(s)')) : Promise.resolve({}))}, {kv: SIGNED});
    await b.TG.resume();
    ok(b.TG.state() === 'offline' && b.kv.get('tg_session') === 'OLD-SESSION', 'a generic error at start-up keeps the login (was: wiped)');
    const d = boot({invoke: (c, r) => (r.className === 'updates.GetState' ? Promise.reject(rpc('AUTH_KEY_UNREGISTERED')) : Promise.resolve({}))}, {kv: SIGNED});
    await d.TG.resume();
    ok(d.TG.state() === 'off' && !d.kv.has('tg_session') && d.TG.error() === 'e_session', 'AUTH_KEY_UNREGISTERED removes the login with e_session');
  }
  // ---- 5. getClient while connecting waits for the same attempt
  {
    let open = null;
    const b = boot({connect: (c) => new Promise((res) => { open = () => { c.connected = true; res(true); }; })}, {kv: SIGNED});
    b.TG.resume();
    await b.advance(10);
    ok(b.TG.state() === 'connecting', 'connecting');
    let got = null, err = '';
    b.TG.client().then((c) => { got = c; }, (e) => { err = e.message; });
    await b.advance(10);
    open();
    await b.advance(10);
    ok(got && !err, 'getClient during connecting resolves with the client (was: TG_NO_LOGIN) ' + err);
    ok(b.made.length === 1, 'only one client was made');
  }
  // ---- 6. a GramJS reconnect in progress: no parallel connect() during the grace
  {
    const b = boot({}, {kv: SIGNED});
    await b.TG.resume();
    const c = b.made[0];
    c.connected = false;
    const n0 = c.nConnect;
    let got = null;
    b.TG.client().then((x) => { got = x; });
    await b.advance(1000);
    c.connected = true;                        // GramJS's own reconnect finished
    await b.advance(1000);
    ok(got === c && c.nConnect === n0, 'no connect() of ours while GramJS reconnects');
  }
  // ---- 7. health fails: one rebuild for 4 callers; reconnect(stale) is a no-op
  {
    let hang = false;
    const b = boot({invoke: (c, r) => (hang && c === b0() ? never() : Promise.resolve({}))}, {kv: SIGNED});
    const b0 = () => b.made[0];
    await b.TG.resume();
    hang = true;
    await b.advance(31000);                    // the last answer is old: the next use checks
    const got = [];
    for (let i = 0; i < 4; i++) b.TG.client().then((x) => got.push(x), (e) => got.push(e));
    await b.advance(25000);
    ok(b.made.length === 2, 'one rebuild for four callers (' + b.made.length + ' clients)');
    ok(got.length === 4 && got.every((x) => x === b.made[1]), 'all four get the new client');
    const r = await b.TG.reconnect(b.made[0]);
    ok(r === b.made[1] && b.made.length === 2, 'reconnect(stale) with an old client is a no-op');
    ok(await b.TG.health() === true, 'TG.health() on the new client');
  }
  // ---- 8. a hanging sync cycle: running / busy reset, the next round runs
  {
    let first = true;
    const b = boot({cycle: () => { if (first) { first = false; return never(); } return Promise.resolve({state: 'ok', users: 0, data: []}); }}, {kv: SIGNED});
    await b.TG.resume();
    await b.advance(10);
    ok(b.TG.busy() === true, 'the first round hangs');
    await b.advance(91000);
    ok(b.TG.busy() === false, 'a hanging round ends after 90 s (was: "syncing" forever)');
    const n0 = b.cycles.n;
    b.TG.syncNow();
    await b.advance(10);
    ok(b.cycles.n === n0 + 1, 'the next round runs');
  }
  // ---- 9. visibilitychange / online before any sign-in triggers resume
  {
    let fail = true;
    const b = boot({connect: (c) => { if (fail) return Promise.resolve(false); c.connected = true; return Promise.resolve(true); }}, {kv: SIGNED});
    await b.TG.resume();
    ok(b.TG.state() === 'offline', 'first resume failed');
    fail = false;
    b.document.hidden = true; b.fire('visibilitychange');
    b.document.hidden = false; b.fire('visibilitychange');
    await b.advance(10);
    ok(b.TG.state() === 'on', 'back to the front after a failed first start: connected at once (was: 45 s timer)');
    const c = boot({connect: () => Promise.resolve(false)}, {kv: SIGNED});
    await c.TG.resume();
    const n0 = c.made.length;
    c.fireWin('online');
    await c.advance(10);
    ok(c.made.length === n0 + 1, 'the network back: a new attempt at once');
  }
  // ---- 10. getMe rejects after an accepted sign-in: the session is already stored
  {
    let meFail = true;
    const b = boot({getMe: () => (meFail ? Promise.reject(new Error('net')) : Promise.resolve({id: 1, firstName: 'X'})),
      invoke: (c, r) => (r.className === 'auth.ExportLoginToken' ? Promise.resolve({className: 'auth.LoginTokenSuccess'}) : Promise.resolve({}))}, {kv: API});
    await b.TG.login('qr', true);
    await b.advance(10);
    ok(typeof b.kv.get('tg_session') === 'string' && b.kv.get('tg_session'), 'getMe failing after the sign-in: the session is kept (was: lost)');
    ok(b.TG.state() !== 'off', 'and the state is not "off" (' + b.TG.state() + ')');
    meFail = false;
    await b.advance(16000);
    ok(b.TG.state() === 'on', 'the retry connects from the stored session');
  }
  // ---- 11. a SignIn that never answers: back to the code step with an error after 30 s
  {
    const b = boot({invoke: (c, r) => (r.className === 'auth.SendCode' ? Promise.resolve({className: 'auth.SentCode', phoneCodeHash: 'H', type: {className: 'auth.SentCodeTypeApp', length: 5}})
      : r.className === 'auth.SignIn' ? never() : Promise.resolve({}))}, {kv: API});
    b.TG.login('phone', true);
    await b.advance(10);
    ok(b.TG.step() && b.TG.step().step === 'phone', 'phone step');
    b.TG.answer('0541234567');
    await b.advance(10);
    ok(b.TG.step() && b.TG.step().step === 'code', 'code step');
    b.TG.answer('12345');
    await b.advance(31000);
    ok(b.TG.step() && b.TG.step().step === 'code' && b.TG.error() === 'e_net', 'a SignIn that hangs: the code step again with "no connection" after 30 s');
    // ---- 15. the pending phone sign-in survives the app being killed (sessionStorage gone, localStorage kept)
    const ls = b.box.localStorage;
    ok(!!ls.getItem('tn_tg_pending') && !/^bn_/.test('tn_tg_pending'), 'kept=true: the pending sign-in is in localStorage, outside the bn_* keys');
    const k = boot({invoke: (c, r) => { if (r.className === 'auth.SendCode') k.sent = (k.sent || 0) + 1; return Promise.resolve({}); }}, {kv: API, ls});
    ok(k.TG.pending() && k.TG.pending().how === 'phone', 'after a restart TG.pending() still knows the phone sign-in');
    k.TG.login('phone', true);
    await k.advance(10);
    ok(k.TG.step() && k.TG.step().step === 'code' && !k.sent, 'resumed at the code field without a new SendCode');
    ok(k.made[0].sess && k.made[0].sess.indexOf('SESSION') === 0, 'on the connection the code was asked on');
  }
  // ---- 13. QR: the update is missed, the next export says Success -> signed in
  {
    let turns = 0;
    const b = boot({invoke: (c, r) => {
      if (r.className !== 'auth.ExportLoginToken') return Promise.resolve({});
      turns++;
      return Promise.resolve(turns === 1 ? {className: 'auth.LoginToken', token: Buffer.from('tok'), expires: Math.floor((b.now() + 30000) / 1000)} : {className: 'auth.LoginTokenSuccess'});
    }}, {kv: API});
    b.TG.login('qr', true);
    await b.advance(10);
    ok(b.TG.step() && b.TG.step().step === 'qr' && /^tg:\/\/login\?token=/.test(b.TG.step().url), 'the QR code is shown');
    ok(b.TG.pending() && b.TG.pending().how === 'qr', 'a pending QR record is kept');
    b.document.hidden = false; b.fire('visibilitychange');           // back from Telegram
    await b.advance(10);
    ok(b.TG.state() === 'on' && turns === 2, 'QR confirmed while away (update missed): signed in on return (was: "Unexpected")');
    ok(!b.TG.pending(), 'the pending record is gone after the sign-in');
  }
  // ---- 14. QR + two-step password
  {
    const b = boot({invoke: (c, r) => (r.className === 'auth.ExportLoginToken' ? Promise.reject(rpc('SESSION_PASSWORD_NEEDED')) : Promise.resolve({}))}, {kv: API});
    await b.TG.login('qr', true);
    await b.advance(10);
    ok(b.made[0].pw && b.TG.state() === 'on', 'SESSION_PASSWORD_NEEDED in the QR loop goes to the password');
  }
  // ---- QR: MigrateTo imports on the new DC; cancel stops the loop
  {
    const b = boot({invoke: (c, r) => (r.className === 'auth.ExportLoginToken' ? Promise.resolve({className: 'auth.LoginTokenMigrateTo', dcId: 4, token: Buffer.from('t')})
      : r.className === 'auth.ImportLoginToken' ? Promise.resolve({className: 'auth.LoginTokenSuccess'}) : Promise.resolve({}))}, {kv: API});
    await b.TG.login('qr', true);
    await b.advance(10);
    ok(b.made[0].dc === 4 && b.made[0].calls.includes('auth.ImportLoginToken') && b.TG.state() === 'on', 'MigrateTo: ImportLoginToken on the new DC');
    const c = boot({invoke: (cl, r) => (r.className === 'auth.ExportLoginToken' ? Promise.resolve({className: 'auth.LoginToken', token: Buffer.from('t'), expires: 0}) : Promise.resolve({}))}, {kv: API});
    c.TG.login('qr', true);
    await c.advance(10);
    const calls = c.made[0].calls.length;
    ok(c.TG.pending() && c.TG.pending().how === 'qr', 'QR wait: a pending record exists before cancel');
    await c.TG.cancel();
    await c.advance(60000);
    ok(c.made[0].calls.length === calls && c.TG.state() === 'off', 'cancel mid-wait: no further export');
    ok(!c.TG.pending() && !c.box.localStorage.getItem('tn_tg_pending') && !c.box.sessionStorage.getItem('bn_tg_pending'),
      'cancel drops the pending record (the login page must not restart the sign-in by itself)');
  }
  // ---- 16. wake: not during a sign-in; the shell's call is accepted
  {
    const b = boot({invoke: (c, r) => (r.className === 'auth.ExportLoginToken' ? Promise.resolve({className: 'auth.LoginToken', token: Buffer.from('t'), expires: 0}) : Promise.resolve({}))}, {kv: API});
    b.TG.login('qr', true);
    await b.advance(10);
    const n0 = b.made.length;
    ok(b.TG.wake(true) === true, 'TG.wake exists for the app shells');
    await b.advance(10);
    ok(b.TG.state() === 'login' && b.made.length === n0, 'wake during a sign-in does nothing');
  }
  // ---- the iOS / Mac offline copy: no sign-in there
  {
    const b = boot({}, {kv: API, location: {protocol: 'http:', hostname: '127.0.0.1', hash: ''}});
    await b.TG.login('qr', true);
    ok(b.made.length === 0 && b.TG.error() === 'tgx_local', 'http://127.0.0.1: TG.login opens no client and says why');
  }
  console.log(fails ? 't_tglogin FAILED ' + fails + ' of ' + n : 't_tglogin OK (' + n + ' checks)');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL', e && e.stack); process.exit(1); });
