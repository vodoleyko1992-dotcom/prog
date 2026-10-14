'use strict';
// 9.2.3 (игрок 11.10: «мы уже не играем на кастетах, функция писалась ради того, чтобы Тиром бегать с копьём… оружие в класс
// делалось давно и на коленке»): смена оружия ради баффа (кастеты) убрана целиком; «в класс» — сумка перечитывается сама,
// когда в ней новое оружие или открылся новый грейд; M.Atk заточки при надевании по сети; меню мага сортирует по M.Atk
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');

// 1. кастеты/смена оружия ради баффа — нигде не осталось
for (const f of ['content.js', 'popup.js', 'popup.html', 'ui-v7.js', 'modules/combat.js', 'modules/equipment.js', 'base-profile.json'])
  assert.doesNotMatch(read(f).replace(/once\('fistOff923'[^\n]*/, ''), /nWeaponBuff|weaponSwap|buffSwap|canSwap|isFistName/, f + ': остатки смены оружия ради баффа');
assert.match(read('content.js'), /once\('fistOff923', \(\) => \{ cf\.nWeaponBuff = ''; cf\.weaponSwap = false; rf\.buffSwap = null; \}\)/);
assert.match(read('content.js'), /ma:bonusesKnown && typeof it\.ma === 'number' \? it\.ma \+ \(\+req\.enchantMAtkBonus \|\| 0\)/, 'M.Atk заточки при надевании');
assert.match(read('popup.js'), /const atkOf = w => \(types\[0\] === '#mage' \? w\.ma : w\.pa\)/, 'меню мага — по M.Atk');

// 2. equipment.weaponRescanWhy
const ITEMS = { 100: { n: 'Daimon Crystal Staff', k: 'W', wt: 'посох', g: 'A', ma: 150 }, 101: { n: 'Staff of Life', k: 'W', wt: 'посох', g: 'D', ma: 72 },
  102: { n: 'Sword of Valhalla', k: 'W', wt: 'посох', g: 'S', ma: 200 }, 103: { n: 'Arcana Mace', k: 'W', wt: 'дубина', g: 'A', ma: 160 }, 7: { n: 'Fishing Rod', k: 'W', wt: 'удочка' }, 57: { n: 'Adena', k: 'E' } };
const GRADE_LV = { NG: 0, D: 20, C: 40, B: 52, A: 61, S: 76 };
let now = 1e9;
const mk = rt => {
  const env = { rt, cfg: {}, GRADE_LV, itemOf: id => ITEMS[id] ? { id, ...ITEMS[id] } : null };
  const sb = { console, Date: { now: () => now }, Math, document: { querySelectorAll: () => [], querySelector: () => null } }; sb.globalThis = sb;
  vm.runInNewContext(read('modules/equipment.js'), sb);
  return sb.L2V7Factories.equipment(env);
};
const base = () => ({ weaponsT: 1, weaponRec: { lv: 61 }, weapons: [{ id: 100, g: 'A', where: 'надето' }] });
assert.equal(mk({ ...base(), weaponsT: 0 }).weaponRescanWhy({ 103: 1 }, 61), '', 'сумку ещё не читали — обычное первое чтение, не повод');
assert.equal(mk(base()).weaponRescanWhy({ 100: 1, 57: 1e6, 7: 1 }, 61), '', 'ничего нового');
assert.match(mk(base()).weaponRescanWhy({ 103: 1 }, 61), /новое оружие в сумке: Arcana Mace/);
assert.equal(mk(base()).weaponRescanWhy({ 101: 1 }, 61), '', 'D-посох с дропа при надетом A — не повод');
assert.equal(mk(base()).weaponRescanWhy({ 102: 1 }, 61), '', 'S до 76 ур. — не повод');
assert.match(mk(base()).weaponRescanWhy({ 102: 1 }, 76), /открыт грейд S \(76 ур\.\).*Sword of Valhalla/);
assert.match(mk({ ...base(), weaponRec: { lv: 58 } }).weaponRescanWhy(null, 61), /открыт грейд A/);
assert.equal(mk({ ...base(), weaponRec: { lv: 58 } }).weaponRescanWhy(null, 60), '');
// один и тот же повод — один раз; новый повод — не чаще раза в 10 мин
const why = mk(base()).weaponRescanWhy({ 103: 1 }, 61);
assert.equal(mk({ ...base(), weapRescan: { sig: why, t: now - 3600e3 } }).weaponRescanWhy({ 103: 1 }, 61), '', 'тот же повод повторно');
assert.equal(mk({ ...base(), weapRescan: { sig: 'x', t: now - 60e3 } }).weaponRescanWhy({ 103: 1 }, 61), '', 'не чаще раза в 10 мин');
assert.ok(mk({ ...base(), weapRescan: { sig: 'x', t: now - 700e3 } }).weaponRescanWhy({ 103: 1 }, 61));

// 3. rankWeapons больше не ищет «оружие для баффов»; ядро перечитывает сумку по поводу
assert.doesNotMatch(read('modules/equipment.js'), /fists|buff: types/);
assert.match(read('content.js'), /const why = L2V7Modules\.equipment\.weaponRescanWhy\([^\n]*\n\s*if \(why\) \{ rec\('B', 'оружие', `перечитываю сумку: \$\{why\}`\); await setRt\(\{ weapRescan: \{ sig: why, t: Date\.now\(\) \} \}\); await invScanStart\(\)/);
console.log('v923-weapons PASS');
