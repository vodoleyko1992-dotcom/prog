'use strict';
// Лог 14.10 23:35: Gorgolos, вихрь 2916 HP при остатке около 3000 HP.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../modules/combat.js'), 'utf8');
const fn = src.slice(src.indexOf('function rbTurnHeal('), src.indexOf('function frenzyDive('));
const heal = vm.runInNewContext(`${fn}; rbTurnHeal`, { Math });
assert.equal(heal({ cur: 3100, max: 6570, spike: 2916, p90: 265, stopPct: 25 }).need, true);
assert.equal(heal({ cur: 5000, max: 6570, spike: 2916, p90: 265, stopPct: 25 }).need, false);
// 20.71: начало полосы учитывает отдельные большие роли Rebirth; здесь проверяется прежний ordinary РБ.
const band = src.slice(src.indexOf('    let potAt = '), src.indexOf('    const hpPot = me && me.pct <= potAt'));
const ctx = { rb: { id: 'boss', hits: [], potOn: false } };
const env = { cfg: { hpPotAt: 50, stopHp: 25, rbBandAuto: true, rbTurnPrice: true, rbPotAt: 75, rbPotTo: 80 }, rt: { rbDb: { boss: { sp: 2916, hitP90: 265 } } }, fightSpikeEta: () => ({ eta: 100, gap: 14 }), turnSec: () => 2, rec: () => {} };
const me = { cur: 3100, max: 6570, pct: 47 };
const potAt = vm.runInNewContext(`(() => { ${band} return potAt; })()`, { env, ctx, me, rebirthBig: () => false, rbTurnHeal: heal, frenzyDive: () => false, epicFrenzyHold: () => false, Math });
assert.equal(potAt, 100, 'even a distant estimated spike must leave enough HP for the next one');
const raid = fs.readFileSync(path.join(__dirname, '../modules/raid.js'), 'utf8');
const shortageFn = raid.slice(raid.indexOf('function rbBuffShortage('), raid.indexOf('async function huntSet('));
const shortage = (balance, buffs, enabled = true) => vm.runInNewContext(`${shortageFn}; rbBuffShortage(1000000)`, {
  env: { cfg: { rbFaFull: enabled }, rt: { faBal: { v: balance, t: 1000000 } }, hudBuffs: () => buffs, faFullIds: () => [1323, 269] }
});
assert.equal(shortage(0, { 269: 2000000 }), 1, 'zero FA and missing Noblesse blocks next raid');
assert.equal(shortage(0, { 1323: 2000000, 269: 2000000 }), 0, 'existing buffs allow raid');
assert.equal(shortage(5, {}), 0, 'positive FA can still buy buffs');
assert.equal(shortage(0, {}, false), 0, 'disabled full buff does not gate raid');
console.log('PASS: RB keeps spike reserve despite estimated rhythm');
