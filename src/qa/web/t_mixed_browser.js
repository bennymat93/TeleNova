'use strict';
// One "browser" of t_mixed.py: its localStorage lives in <dir>/<name>.ls.json, the account's document in <dir>/cloud.json
// (shared with the Python devices). Does what the viewer did (actions), runs one sync round, prints what it holds.
//   node t_mixed_browser.js <dir> <name> <now> '<json list of actions>'
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..', '..', '..', 'web');
const SD = require(path.join(WEB, 'syncdoc.js'));
const Store = require(path.join(WEB, 'store.js'));
const WS = require(path.join(WEB, 'websync.js')).make(SD);
const [dir, name, nowArg, actionsArg] = process.argv.slice(2);
let now = Number(nowArg);
const lsFile = path.join(dir, name + '.ls.json'), cloudFile = path.join(dir, 'cloud.json');
const mem = fs.existsSync(lsFile) ? JSON.parse(fs.readFileSync(lsFile, 'utf8')) : {};
const ls = {getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; }};
const store = Store.make(ls, SD, {now: () => now});
const cloud = () => (fs.existsSync(cloudFile) ? JSON.parse(fs.readFileSync(cloudFile, 'utf8')) : {n: 0, doc: null});
let taken = null;
// 6.2.0: a browser whose name starts with 'P' has a settings port (bn_cfg + bn_* stores in its localStorage), as the page has
const J = (k) => { try { const v = ls.getItem(k); return v === null ? undefined : JSON.parse(v); } catch (e) { return undefined; } };
const port = {cfgKeys: () => Object.keys(J('bn_cfg') || {}), cfgGet: (k) => (J('bn_cfg') || {})[k],
  cfgSet: (k, v) => { const c = J('bn_cfg') || {}; c[k] = v; ls.setItem('bn_cfg', JSON.stringify(c)); },
  get: (n) => J('bn_' + n), put: (n, v) => ls.setItem('bn_' + n, JSON.stringify(v)), drop: (n) => ls.removeItem('bn_' + n)};
const host = {
  port: name.startsWith('P') ? port : null,
  loadMeta: () => JSON.parse(ls.getItem('bn_sync_meta') || '{}'), saveMeta: (m) => ls.setItem('bn_sync_meta', JSON.stringify(m)),
  users: () => store.users(), userData: (uid) => store.data(uid), setUsers: (l) => store.setUsers(l, true), putUserData: (uid, d) => store.putData(uid, d, true),
  takeSettings: (v) => { taken = v; },
  cloudFind: async () => { const c = cloud(); return c.doc === null ? null : {id: c.n, date: 0}; },
  cloudGet: async () => SD.parse(cloud().doc),                 // the text exactly as the other side wrote it
  cloudPut: async (doc) => { const c = cloud(); fs.writeFileSync(cloudFile, JSON.stringify({n: c.n + 1, doc: SD.canon(doc), by: name})); return (c.n + 1) + ':0'; },
};
(async () => {
  for (const [what, ...a] of JSON.parse(actionsArg || '[]')) {
    if (what === 'watch') store.addHistory({key: a[0], label: a[0], play: a[1] || ''});
    else if (what === 'fav') store.addFav(a[0], a[1], a[2] || '', a[3] || '');
    else if (what === 'unfav') store.removeFav(a[0], a[1]);
    else if (what === 'search') store.addSearch(a[0]);
    else if (what === 'unsearch') store.removeSearch(a[0]);
    else if (what === 'clear_history') store.clearHistory();
    else if (what === 'user') store.switchTo(store.create(a[0]));
    else if (what === 'switch') store.switchTo(a[0]);
    else if (what === 'cfg') port.cfgSet(a[0], a[1]);
    else if (what === 'put') port.put(a[0], a[1]);
    else if (what === 'delete_user') store.remove(store.live().find((u) => u.name === a[0]).id);
    else throw new Error('unknown action ' + what);
    now += 1;
  }
  const res = await WS.cycle(host, now);
  fs.writeFileSync(lsFile, JSON.stringify(mem));
  const d = WS.localDoc(host);
  process.stdout.write(JSON.stringify({res, taken, canon: SD.canon([d.users, d.data]), current: store.current(),
                                       history: store.history().map((h) => h.key), favs: store.favs().map((f) => f.kind + ':' + f.id),
                                       cfg: J('bn_cfg') || {}, stores: Object.fromEntries(Object.keys(mem).filter((k) => k.startsWith('bn_') && k !== 'bn_cfg' && !/^bn_(sync|store|users|data|u_)/.test(k)).map((k) => [k.slice(3), J(k)]))}));
})().catch((e) => { process.stdout.write(JSON.stringify({error: String(e.stack || e)})); process.exit(1); });
