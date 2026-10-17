'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12 + quality/L3): единый источник умолчаний defaults.js.
// Проверяем: content.js и popup.js берут одну и ту же таблицу L2Defaults.CFG и не держат своих литеральных копий;
// файл подключён в manifest перед content.js и в popup.html перед popup.js (значит, попадает и в Chrome-zip,
// и в Firefox-сборку, которая копирует корень и manifest как есть); базовый профиль не содержит ключей режимов.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const content = read('content.js'), popup = read('popup.js'), html = read('popup.html'), defSrc = read('defaults.js');
const E = require(path.join(root, 'engine-core.js'));

test('defaults.js: одна таблица для движка и меню, литеральных копий нет', () => {
  assert.match(content, /const \{ DAILY_RANGE, DAILY_KILL_DEF, DAILY_FISH_DEF, DAILY_RANGES_DEF \} = L2Defaults;/);
  assert.match(content, /const DEF_CFG = L2Defaults\.CFG;/);
  assert.match(popup, /const DEF = L2Defaults\.CFG;/);
  for (const [name, src] of [['content.js', content], ['popup.js', popup]]) {
    assert.doesNotMatch(src, /const DEF_CFG = \{|const DEF = \{/, name + ': литеральная таблица умолчаний');
    assert.doesNotMatch(src, /mmOrders: true, mmTpMax: 500000/, name + ': копия строки умолчаний');
    assert.doesNotMatch(src, /const DAILY_RANGE = \{/, name + ': копия дневного диапазона');
  }
});

test('defaults.js грузится как обычный скрипт (content script / <script>) и в Node', () => {
  const box = {}; box.globalThis = box; vm.createContext(box); vm.runInContext(defSrc, box);
  const D = box.L2Defaults; assert.ok(D && D.CFG, 'L2Defaults.CFG в глобальном объекте');
  const N = require(path.join(root, 'defaults.js'));
  assert.equal(JSON.stringify(D.CFG), JSON.stringify(N.CFG));
  assert.deepEqual({ ...N.DAILY_RANGE }, { min: 8434, max: 9119 });
  assert.equal(N.DAILY_KILL_DEF, 8434); assert.equal(N.DAILY_FISH_DEF, 8434);
  assert.equal(N.CFG.dailyKillLimit, 8434); assert.equal(N.CFG.dailyFishLimit, 8434);
  assert.deepEqual(JSON.parse(JSON.stringify(N.CFG.limitRanges)), { dailyKillLimit: { min: 8434, max: 9119 }, dailyFishLimit: { min: 8434, max: 9119 } });
  // точечные прежние значения (движок и меню раньше совпадали в них же)
  const want = { mmCrafter: 'Skye', champEvery: 30, tvtOn: true, warlordAggro: true, fishBait: 'auto', shopReserve: 200000, shopMaxSpend: 2000000,
    rbHuntMode: false, rbOrder: 'up', fighterMpPct: 25, epicMaxDeaths: 5, fishBuyPacks: 100, dockMin: false, magisterSkip: 'Curse Weakness, Poisonous Cloud' };
  for (const [k, v] of Object.entries(want)) assert.equal(N.CFG[k], v, k);
});

test('ключи, добавившиеся в DEF меню, раньше шли через CFG_IMPORT_EXTRA с тем же типом — импорт не меняется', () => {
  const i = popup.indexOf('const CFG_IMPORT_EXTRA = '), j = popup.indexOf('};', i);
  const X = vm.runInNewContext('(' + popup.slice(popup.indexOf('{', i), j + 1) + ')');
  const N = require(path.join(root, 'defaults.js')).CFG, ty = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  for (const k of ['dockMin', 'potSlotAuto', 'weaponClassPick', 'weaponScanAuto', 'rbExpValue', 'rbPotCost', 'magisterSkip'])
    assert.equal(X[k], ty(N[k]), k);
});

test('подключение: manifest перед content.js, popup.html перед popup.js, сборки берут файл', () => {
  const mf = JSON.parse(read('manifest.json')), js = mf.content_scripts.find(s => s.js.includes('content.js')).js;
  assert.ok(js.includes('defaults.js') && js.indexOf('defaults.js') < js.indexOf('content.js'), 'manifest');
  const a = html.indexOf('<script src="defaults.js"></script>'), b = html.indexOf('<script src="popup.js"></script>');
  assert.ok(a >= 0 && a < b, 'popup.html');
  // Firefox-сборка копирует корень, кроме служебных папок/архивов, и оставляет content_scripts как есть
  const ff = read('tests/tools/firefox-build.cjs'), skip = new RegExp(ff.match(/const skip = \/(.+)\/;/)[1]);
  assert.ok(!skip.test('defaults.js'), 'firefox-build не пропускает defaults.js');
  assert.match(ff, /const ff = \{ \.\.\.mf, background:/, 'content_scripts берутся из manifest без изменений');
  assert.match(read('tests/tools/zipload.cjs'), /L2Defaults/, 'zipload проверяет, что меню получило умолчания');
});

test('base-profile.json не содержит ключей режимов (и ручного оружия)', () => {
  const cfg = JSON.parse(read('base-profile.json')).cfg || {};
  const bad = E.BASE_CFG_SKIP.filter(k => Object.hasOwn(cfg, k));
  assert.deepEqual(bad, []);
  for (const k of E.MODE_KEYS) assert.ok(!Object.hasOwn(cfg, k), k);
});
