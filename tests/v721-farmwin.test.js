'use strict';
// 7.2.1 (игрок 10.10): точка фарма — источники в диапазоне −5…+5 ур. от героя (10.0.7; было −3…+5) в первую очередь, диапазон настраивается
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
(async () => {
  const mf = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const ctx = vm.createContext({ addEventListener() {}, removeEventListener() {}, console, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, URL, URLSearchParams, Date, Math,
    crypto: { randomUUID: () => 'x' }, sessionStorage: { getItem: () => null, setItem() {} }, navigator: { userAgent: 'Chrome' },
    location: { pathname: '/map.html', search: '', href: 'https://l2wap.com/map.html', origin: 'https://l2wap.com' }, window: { addEventListener() {}, innerWidth: 1080 },
    document: { visibilityState: 'visible', prerendering: false, createElement() { return { style: {}, append() {}, querySelector() { return null; }, querySelectorAll() { return []; } }; },
      addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, getElementsByTagName() { return []; }, hasFocus() { return true; },
      documentElement: { className: '', clientWidth: 1024, append() {} }, body: { className: '', querySelector() { return null; } } },
    chrome: { runtime: { sendMessage: async () => null, onMessage: { addListener() {} }, getManifest: () => mf, getURL: s => s }, storage: { onChanged: { addListener() {} }, local: { get: () => new Promise(() => {}), set: async () => {} } } } });
  ctx.window.window = ctx.window;
  for (const s of mf.content_scripts.find(x => x.js.includes('content.js')).js) vm.runInContext(fs.readFileSync(path.join(root, s), 'utf8'), ctx);
  // герой 52: Zone A — моб 55 (в диапазоне 49…57), шанс 5 %; Zone B — моб 64 (на 7 выше диапазона), шанс 40 %
  ctx.__drop = [['Mob A', 55, 5, 1, 1, 'zA', 'Zone A'], ['Mob B', 64, 40, 1, 1, 'zB', 'Zone B']];
  vm.runInContext('rt = { ...DEF_RT }; cfg = mergeCfg({})', ctx);
  let z = vm.runInContext('farmZones(__drop, 52, 20)', ctx);
  assert.equal(z[0].tp, 'zA', 'source inside −5…+5 wins even with a lower chance');
  assert.equal(z[0].inWin, true); assert.equal(z[1].inWin, false);
  // поправили диапазон до +15 — теперь обе в диапазоне, выигрывает больший шанс
  vm.runInContext('cfg = mergeCfg({ farmLvlAbove: 15 })', ctx);
  z = vm.runInContext('farmZones(__drop, 52, 20)', ctx);
  assert.equal(z[0].tp, 'zB', 'window widened by the player → higher chance wins');
  // в диапазоне никого — лучшая из остальных, ближе к диапазону — выше
  vm.runInContext('cfg = mergeCfg({})', ctx);
  ctx.__drop = [['Far', 70, 30, 1, 1, 'zF', 'Far'], ['Near', 60, 30, 1, 1, 'zN', 'Near']];
  z = vm.runInContext('farmZones(__drop, 52, 20)', ctx);
  assert.equal(z[0].tp, 'zN', 'nothing in window → closest level first');
  assert.equal(vm.runInContext('farmFit(49, 52)', ctx), 1); assert.equal(vm.runInContext('farmFit(57, 52)', ctx), 1);
  assert.ok(vm.runInContext('farmFit(58, 52)', ctx) < 1); assert.ok(vm.runInContext('farmFit(46, 52)', ctx) < 1);   // 10.0.7: окно −5…+5 (игрок 13.10 03:19)
  const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  assert.match(html, /id="farmLvlBelow"/); assert.match(html, /id="farmLvlAbove"/);
  console.log('PASS: farm spot — sources in −5…+5 levels first (adjustable), otherwise closest level');
})().catch(e => { console.error(e); process.exit(1); });
