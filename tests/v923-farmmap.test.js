'use strict';
// 9.2.3 (игрок 12.10: спойлер «пересматривает карту раз в несколько боёв»): точка фарма ресурса включает карту раз в 10 боёв ради
// источников; если все источники цели здесь «не по зубам» (на карте их не выбрать с 9.2.2) — карта впустую, правило не включается
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const grab = name => {   // однострочная const … ; или многострочная, закрытая строкой «};»
  const i = src.indexOf(`const ${name} = `); assert.ok(i >= 0, name);
  const eol = src.indexOf('\n', i), multi = src.slice(i, eol).trimEnd().endsWith('{');
  return multi ? src.slice(i, src.indexOf('\n};', i) + 3) : src.slice(i, eol);
};
const code = grab('hardNow') + '\n' + grab('farmMapOn') + '\nglobalThis.farmMapOn = farmMapOn;';
const sb = { Date, String, rt: {}, lg: null, fr: [], rr: [] };
sb.globalThis = sb;
vm.runInNewContext('var rt = globalThis.rt; const lootGoal = () => globalThis.lg; const farmRules = () => globalThis.fr; const recipeRules = () => globalThis.rr;\n'
  + code.replace(/\brt\./g, 'globalThis.rt.'), sb);
const on = () => sb.farmMapOn();
sb.rt = { zone: 'brekas_stronghold', hardMobs: {} };
sb.lg = { kind: 'farm', name: 'Mithril Ore', zone: 'brekas_stronghold' };
sb.fr = [{ name: 'guardian basilisk', farm: true }];
assert.equal(on(), true, 'источник по силам — карта по правилу точки фарма');
sb.rt.hardMobs = { 'guardian basilisk': { t: Date.now() } };
assert.equal(on(), false, 'единственный источник «не по зубам» — карта впустую не ходит');
sb.fr = [{ name: 'guardian basilisk', farm: true }, { name: 'breka orc', farm: true }];
assert.equal(on(), true, 'есть другой источник по силам — карта нужна');
sb.fr = [{ name: 'guardian basilisk', farm: true }];
sb.rt.hardMobs = { 'guardian basilisk': { t: Date.now() - 3 * 3600000 } };
assert.equal(on(), true, 'метка «не по зубам» старше 2 ч — снова источник');
sb.rt.zone = 'other';
assert.equal(on(), false, 'не на точке фарма — правило не включается');
console.log('PASS: farm map rule skips when every source here is «не по зубам»');
