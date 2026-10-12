'use strict';
// 10.0.3 (игрок 12.10 14:26: «Alt+R вызывает окно загрузки таймингов»): фон принимает таймеры боссов со страницы игры (команда rbtImport)
// только ключом rbTimer и только с l2wap.com; меню и страница игры откликаются на Alt+R, подсказка в нижней строке меню
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
(async () => {
  const store = { rt: { char: 'Warlock', zoneStat: { a: 1 }, rbTimer: { b: {} } } }, L = [];
  const ev = () => ({ addListener: f => L.push(f) });
  const chrome = new Proxy({
    runtime: { onMessage: { addListener: f => L.push(f) }, getURL: p => 'chrome-extension://x/' + p, getManifest: () => ({ version: '1' }), onInstalled: ev(), onStartup: ev(), id: 'x' },
    storage: { local: { get: async k => Object.fromEntries([].concat(k || Object.keys(store)).map(x => [x, store[x]])), set: async v => Object.assign(store, v), remove: async () => {} }, onChanged: ev(), session: { get: async () => ({}), set: async () => {} } },
    alarms: { create() {}, clear: async () => {}, get: async () => null, onAlarm: ev() }, tabs: { onRemoved: ev(), onUpdated: ev(), query: async () => [], get: async () => ({}) }
  }, { get: (o, k) => k in o ? o[k] : new Proxy({}, { get: (_, kk) => kk.startsWith('on') ? ev() : async () => {} }) });
  const ctx = { chrome, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, indexedDB: undefined, self: {}, fetch: async () => ({ ok: false }) };
  ctx.globalThis = ctx; vm.createContext(ctx);
  try { vm.runInContext(read('background.js'), ctx); } catch (e) {}
  const send = (m, s) => new Promise(r => { let done = false; for (const f of L) { const ret = f(m, s, x => { done = true; r(x); }); if (ret === true || done) return; } r(undefined); });
  const T = { b: { l2dop_rb_9: { n: 'Lokness', l: 70, al: false, dl: 1, dh: 2 } } };
  const bad = await send({ cmd: 'rbtImport', rbTimer: T }, { url: 'https://evil.example/x', tab: { id: 1 } });
  assert(!bad?.ok, 'чужая страница не пишет таймеры');
  assert(!(await send({ cmd: 'rbtImport', rbTimer: [] }, { url: 'https://l2wap.com/map.html', tab: { id: 1 } }))?.ok, 'мусор не пишется');
  const ok = await send({ cmd: 'rbtImport', rbTimer: T, rtPatch: { zoneStat: null } }, { url: 'https://l2wap.com/map.html', tab: { id: 1 } });
  assert(ok?.ok, 'страница игры пишет таймеры: ' + JSON.stringify(ok));
  assert.strictEqual(store.rt.rbTimer.b.l2dop_rb_9.n, 'Lokness'); assert.deepStrictEqual(store.rt.zoneStat, { a: 1 }, 'прочая память не тронута');
  const pop = read('popup.js'), html = read('popup.html'), content = read('content.js');
  assert(/e\.code === 'KeyR'\) \{ e\.preventDefault\(\); showTab\('rbtimer'\); \$\('rbtFile'\)\.click\(\)/.test(pop), 'Alt+R в меню');
  assert(/rbtimer: 'rb'/.test(pop), 'вкладка таймеров в разделе РБ');
  assert(/<span class="kbd">Alt\+R<\/span> таймеры/.test(html), 'подсказка Alt+R в нижней строке');
  assert(/e\.code !== 'KeyR'\) return; e\.preventDefault\(\); e\.stopPropagation\(\); rbtPick\(\)/.test(content), 'Alt+R на странице игры');
  console.log('PASS: 10.0.3 Alt+R — boss timers from a file: background accepts only rbTimer and only from l2wap.com, menu and game page hotkeys, footer hint');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
