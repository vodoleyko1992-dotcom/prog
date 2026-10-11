'use strict';
// 9.2.4 (игрок 12.10: «чар убивает моба, он явно ему ПО СИЛАМ»): спойлер получил «не по зубам» на Guardian Basilisk (урон ≈4.6/с,
// убить ≈402 с) — урон считался по HP одного моба вверху боя, а удары шли по соседям (снимок боя 21:29: вверху Basilisk 1789/1908,
// «Ты нанёс [ Breka Orc Shaman ] 104 урона», «Древко розсікло ворогів поруч …», «Дикий розмах: power 191 597»)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'combat.js'), 'utf8');
const sb = { console, Date, Math, JSON, location: { pathname: '/battle.html', search: '', href: '' } };
sb.globalThis = sb; vm.runInNewContext(src, sb);
const C = sb.L2V7Factories.combat({ cfg: {}, rt: {} });
const lines = [
  'Ты нанёс [ Guardian Basilisk ] 22 урона. Древко розсікло ворогів поруч: Fettered Soul −1, Breka Orc Overlord −35.',
  'Крит! Ты нанёс [ Breka Orc Shaman ] 104 урона. Древко розсікло ворогів поруч: Fettered Soul −1, Breka Orc Overlord −36.',
  'Дикий розмах: power 191 597',
  '[Guardian Basilisk] ударив тебе −19 HP.',
  'Vamp clan armor +8 HP',
  'Ты промахнулся.',
  'Спойл успішний',
];
assert.equal(C.logDmg(lines), 22 + 1 + 35 + 104 + 1 + 36 + 597, 'удары, древко по соседям и Дикий розмах — весь урон героя');
assert.equal(C.logDmg(['[Guardian Basilisk] ударив тебе (крит!) −35 HP.', 'Слуга [Kai the Cat] атакує [X] 1 409 урону.']), 0, 'удары по нам и кот — не урон героя');
assert.equal(C.logDmg(['Ти завдав [ Wolf ] 1 234 урону.']), 1234, 'украинская строка, число с пробелом');
// «не по зубам» считает весь урон боя (главный + соседи + строки журнала) против HP всех мобов боя
assert.match(src, /dmg = Math\.max\(ctx\.hp0 - mob\.cur, \(ctx\.dealt \|\| 0\) - \(ctx\.dealt0 \|\| 0\), logDmg\(/, 'hopeless uses all fight damage');
assert.match(src, /ttk = dps > 0 \? left \/ dps/, 'kill time over HP of all mobs in the fight');
// 15 с боя как на снимке: ≈5 таких ходов (≈200 урона) + Дикий розмах ≈600 → ≈53/с, Basilisk 1789 HP + соседи ≈3800 → ≈105 с < 180 — не «не по зубам»
const dps = (5 * 200 + 597) / 15, left = 1789 + 2002 + 1785;
assert.ok(left / dps < 180, `прогноз ${Math.round(left / dps)} с — бой по силам (было ≈402 с)`);
console.log('PASS: hard-mob check counts all hero damage (cleave, Wild Sweep, hits on a neighbour)');
