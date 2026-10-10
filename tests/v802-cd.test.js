'use strict';
// 8.0.2 (игрок 11.10: «откат может сильно меняться от моих баффов»): откат этого нажатия показан игрой на экране и кончился —
// заклинание готово сразу, старая оценка (без баффа) не держит его; до появления отката на экране — своя оценка; потерянный клик — 0,7 с
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const combat = fs.readFileSync(path.join(__dirname, '..', 'modules/combat.js'), 'utf8');
const src = combat.slice(combat.indexOf('let overlayBusySeen'), combat.indexOf('const uiReady = b =>'));
let now = 1_000_000;
const D = { now: () => now };
const slot = { cdOn: false, timer: '' };
const cdEl = { hidden: false, classList: { contains: () => slot.cdOn }, querySelector: () => ({ textContent: slot.timer }) };
const env = { cdSpawn: () => 'sp1', slotCd: () => cdEl, skKey: () => 'blaze', slotKind: () => 'скилл', slotAction: () => 'l2_1230',
  combatCooldown: { skillKnown: () => false, skillWait: () => 0 }, memLeft: () => 0,
  rt: { cdUse: { blaze: 0 }, skills: { blaze: { cd: 3.1, cdS: [3.1, 3.1, 3.1] } } } };
const api = vm.runInNewContext(`${src}; ({ cdBusy, localCdLeft, lostUntil })`, { env, Date: D, Math, Map, WeakMap, WeakSet, parseFloat });
const b = {};
// нажали Blaze под «Даром Серафима»: старая оценка 3,1 с, реальный откат ≈2,2 с
env.rt.cdUse.blaze = now;
now += 200; assert.ok(api.localCdLeft(b) > 2, 'до появления отката на экране — своя оценка (≈2,4 с)');
slot.cdOn = true; slot.timer = '2.0'; assert.equal(api.cdBusy(b), true);          // откат на экране появился
now += 2000; slot.cdOn = false; slot.timer = ''; assert.equal(api.cdBusy(b), false); // и кончился через 2,2 с после нажатия
assert.equal(api.localCdLeft(b), 0, 'buff-shortened cooldown: ready as soon as the game shows it is ready (was waiting till 2.6 s)');
api.lostUntil.set('blaze', now + 700);
assert.ok(Math.abs(api.localCdLeft(b) - 0.7) < 0.01, 'lost click still blocks 0.7 s');
// сервер знает откат — берём его, своя устаревшая оценка не добавляется
api.lostUntil.delete('blaze'); env.combatCooldown = { skillKnown: () => true, skillWait: () => 0 };
assert.equal(api.localCdLeft(b), 0);
console.log('PASS: 8.0.2 cooldowns follow buffs — on-screen cooldown ended → ready at once; own estimate only until the overlay appears; lost click 0.7 s');
