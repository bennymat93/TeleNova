'use strict';
// The build's sealed file (src/plugin.video.telescope/resources/lib/configio.py) in the browser, both directions:
//   file    = "TNCFG1\n" + JSON header line + [nonce(16) + data + seal(32)]            (sealed with a password)
//   keys    = PBKDF2-HMAC-SHA256(password, salt, rounds = 200000) -> 32 bytes cipher key + 32 bytes seal key
//   data    = payload XOR keystream, keystream block i = HMAC-SHA256(cipher key, nonce + i as 8 bytes big-endian)
//   seal    = HMAC-SHA256(seal key, header line + nonce + data)   - a wrong password or a damaged file is refused
//   payload = zlib(JSON {"settings": {}, "files": {name: base64}, "extra": {}})
// The account's shared document travels as files["setup.zip"]: a zip that holds sync.json.
// Needs WebCrypto (crypto.subtle) and fflate (zlib + zip). Browser: window.Sealed, fflate from window.fflate;
// Node: require('sealed.js').use(require('fflate')). Tested against the Python original in src/qa/web/.
(function (root) {
  const MAGIC = 'TNCFG1\n', ROUNDS = 200000;
  let F = root.fflate || null;
  const enc = new TextEncoder(), dec = new TextDecoder('utf-8', {fatal: true});
  const subtle = () => {
    const s = root.crypto && root.crypto.subtle;
    if (!s) throw err('no_webcrypto');             // (an http:// page that is not localhost has none)
    return s;
  };
  const lib = () => { F = F || root.fflate; if (!F) throw err('no_fflate'); return F; };
  function err(code) { const e = new Error(code); e.code = code; return e; }

  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(text) {
    const s = atob(text), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function concat(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }
  const hmacKey = (raw) => subtle().importKey('raw', raw, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  async function keys(password, salt, rounds) {
    const base = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const raw = new Uint8Array(await subtle().deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds}, base, 512));
    return [await hmacKey(raw.subarray(0, 32)), await hmacKey(raw.subarray(32))];
  }
  async function xorStream(key, nonce, data) {
    const out = new Uint8Array(data.length), blocks = Math.ceil(data.length / 32);
    for (let from = 0; from < blocks; from += 512) {                    // in batches: a large file never holds the page
      const jobs = [];
      for (let b = from; b < Math.min(blocks, from + 512); b++) {
        const msg = new Uint8Array(24);
        msg.set(nonce);
        new DataView(msg.buffer).setUint32(20, b);                      // 8 bytes big-endian (the high half stays 0 below 128 GB)
        new DataView(msg.buffer).setUint32(16, Math.floor(b / 0x100000000));
        jobs.push(subtle().sign('HMAC', key, msg));
      }
      const done = await Promise.all(jobs);
      for (let j = 0; j < done.length; j++) {
        const block = new Uint8Array(done[j]), at = (from + j) * 32, n = Math.min(32, data.length - at);
        for (let x = 0; x < n; x++) out[at + x] = data[at + x] ^ block[x];
      }
    }
    return out;
  }
  async function sha256hex(bytes) {
    return [...new Uint8Array(await subtle().digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // settings: {id: value}; files: {name: Uint8Array}; -> Uint8Array of the file
  async function pack(settings, files, password = '', extra = null, now = null) {
    const body = {settings: settings || {}, files: {}, extra: extra || {}};
    for (const k of Object.keys(files || {})) body.files[k] = b64(files[k]);
    const payload = lib().zlibSync(enc.encode(JSON.stringify(body)), {level: 9});
    const created = Math.floor(now != null ? now : Date.now() / 1000);
    const hasSession = Object.keys(body.files).some((k) => k.endsWith('.session'));
    if (!password) {
      const check = (await sha256hex(payload)).slice(0, 16);
      const header = enc.encode(`{"check": "${check}", "created": ${created}, "encrypted": false, "format": 1, "has_session": ${hasSession}}\n`);
      return concat(enc.encode(MAGIC), header, payload);
    }
    const salt = root.crypto.getRandomValues(new Uint8Array(16)), nonce = root.crypto.getRandomValues(new Uint8Array(16));
    const header = enc.encode(`{"created": ${created}, "encrypted": true, "format": 1, "has_session": ${hasSession}, "rounds": ${ROUNDS}, "salt": "${b64(salt)}"}\n`);
    const [kEnc, kMac] = await keys(password, salt, ROUNDS);
    const data = await xorStream(kEnc, nonce, payload);
    const seal = new Uint8Array(await subtle().sign('HMAC', kMac, concat(header, nonce, data)));
    return concat(enc.encode(MAGIC), header, nonce, data, seal);
  }

  function header(blob) {                          // -> [header object, position of what follows the header line]
    const magic = enc.encode(MAGIC);
    if (!blob || blob.length < magic.length || magic.some((b, i) => blob[i] !== b)) throw err('not_a_config_file');
    const end = blob.indexOf(10, magic.length);
    if (end < 0 || end > 4096) throw err('not_a_config_file');
    let head;
    try { head = JSON.parse(dec.decode(blob.subarray(magic.length, end))); } catch (e) { throw err('not_a_config_file'); }
    if (head === null || typeof head !== 'object' || Array.isArray(head) || head.format !== 1) throw err('unsupported_version');
    return [head, end + 1];
  }

  // -> {settings, files: {name: Uint8Array}, extra, header}; throws Error with .code = 'password_required' | 'wrong_password' | 'damaged' | ...
  async function unpack(blob, password = '') {
    const [head, pos] = header(blob);
    const rest = blob.subarray(pos);
    let payload;
    if (head.encrypted) {
      if (!password) throw err('password_required');
      if (rest.length < 48) throw err('damaged');
      const nonce = rest.subarray(0, 16), data = rest.subarray(16, rest.length - 32), seal = rest.subarray(rest.length - 32);
      let salt, rounds;
      try { salt = unb64(head.salt); rounds = Math.trunc(Number(head.rounds || ROUNDS)); } catch (e) { throw err('damaged'); }
      if (!(rounds >= 1000 && rounds <= 5000000)) throw err('damaged');
      const [kEnc, kMac] = await keys(password, salt, rounds);
      const want = new Uint8Array(await subtle().sign('HMAC', kMac, concat(blob.subarray(MAGIC.length, pos), nonce, data)));
      let diff = 0;
      for (let i = 0; i < 32; i++) diff |= want[i] ^ seal[i];
      if (diff) throw err('wrong_password');       // (or a damaged file - the seal cannot tell them apart)
      payload = await xorStream(kEnc, nonce, data);
    } else {
      payload = rest;
      if (head.check && (await sha256hex(payload)).slice(0, 16) !== head.check) throw err('damaged');
    }
    let body;
    const files = {};
    try {
      body = JSON.parse(dec.decode(lib().unzlibSync(payload)));
      for (const k of Object.keys(body.files)) files[k] = unb64(body.files[k]);
    } catch (e) { throw err('damaged'); }
    if (body.settings === null || typeof body.settings !== 'object' || Array.isArray(body.settings)) throw err('damaged');
    for (const name of Object.keys(files)) if (/[\\/]/.test(name) || name.startsWith('.') || !name) throw err('damaged');   // a plain name - never a path
    return {settings: body.settings, files, extra: body.extra || {}, header: head};
  }

  // the account's document: text of sync.json <-> the sealed file the build keeps in Saved Messages
  async function packDoc(text, password, note) {
    const zip = lib().zipSync({'sync.json': [enc.encode(text), {level: 6}]});
    return pack({}, {'setup.zip': zip}, password, {note});
  }
  async function unpackDoc(blob, password) {
    const got = await unpack(blob, password);
    if (!got.files['setup.zip']) throw err('damaged');
    let files;
    try { files = lib().unzipSync(got.files['setup.zip'], {filter: (f) => f.name === 'sync.json'}); } catch (e) { throw err('damaged'); }
    if (!files['sync.json']) throw err('damaged');
    return dec.decode(files['sync.json']);
  }
  const cloudKey = (userId) => 'telenova-setup-v1:' + String(userId);   // exactly service.py _cloud_key(): the account's numeric id

  const api = {MAGIC, ROUNDS, pack, unpack, header, packDoc, unpackDoc, cloudKey, b64, unb64, use(f) { F = f; return api; }};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Sealed = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
