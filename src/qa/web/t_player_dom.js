'use strict';
// node src/qa/web/t_player_dom.js - the player of the web version in a real (headless) browser.
// Serves the repository on 127.0.0.1 (a free port), opens src/qa/web/t_player_dom.html in headless Chrome / Edge with
// a throw-away profile, and waits for the page to report (t_player_dom_page.js runs the scenarios against the real
// web/player.js, subs.js, srt.js with a mocked TN and a generated sound file). No network beyond 127.0.0.1.
//   node t_player_dom.js            the player (t_player_dom.html)
//   node t_player_dom.js sources    the links sheet, link test, Real-Debrid panel (t_sources_dom.html)
// Ends with "t_player_dom OK"; "SKIPPED" (exit 0) when no Chrome / Edge is installed.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const ROOT = path.join(__dirname, '..', '..', '..');
const WHICH = /^[a-z]+$/.test(process.argv[2] || '') ? process.argv[2] : 'player';
const BROWSERS = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
if (!exe) { console.log('t_player_dom SKIPPED (no Chrome / Edge found; set CHROME_BIN)'); process.exit(0); }
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css'};
let finish = null;
const done = new Promise((r) => { finish = r; });
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST' && u.pathname === '/result') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { res.writeHead(204); res.end(); finish(body); });
    return;
  }
  const file = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname)));
  if (!file.startsWith(path.normalize(ROOT)) || !/^[\\/](web|src[\\/]qa[\\/]web)[\\/]/.test(file.slice(path.normalize(ROOT).length))) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
    res.end(data);
  });
});
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tn-player-dom-'));
  const child = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + profile, '--window-size=1280,720',
    `http://127.0.0.1:${port}/src/qa/web/t_${WHICH}_dom.html`], {stdio: 'ignore'});
  const timer = setTimeout(() => finish('FAIL timeout: the page did not report in 120 s'), 120000);
  done.then((text) => {
    clearTimeout(timer);
    try { child.kill(); } catch (e) { /* gone */ }
    server.close();
    setTimeout(() => { try { fs.rmSync(profile, {recursive: true, force: true}); } catch (e) { /* the browser still holds it */ } }, 1500);
    const lines = String(text).split('\n').filter(Boolean);
    const bad = lines.filter((l) => /^FAIL/.test(l));
    lines.forEach((l) => console.log(l));
    console.log(bad.length ? `t_${WHICH}_dom: ${bad.length} problems` : `t_${WHICH}_dom OK (` + lines.filter((l) => /^ok/.test(l)).length + ' checks)');
    setTimeout(() => process.exit(bad.length ? 1 : 0), 1800);
  });
});
