'use strict';
// 14.10: живой Changed Creation 74 — строка сервера содержит маркер skillId и «— 5002 урона».
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function make() {
  const b = { console, URLSearchParams, location: { search: '?spawnId=dense_live' } }; vm.createContext(b);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../modules/fightlab.js'), 'utf8'), b);
  const env = { rt: { prof: 'human_warlock' }, cfg: {}, rec() {}, fmtT: () => '1 с', setRt: async p => Object.assign(env.rt, p), actName: () => 'Blaze', mobTitle: () => 'Changed Creation · ур. 74', isChamp: () => false, isBoss: () => false };
  return { F: b.L2V7Factories.fightlab(env), env };
}
const checks = [];
const check = (n, fn) => checks.push([n, fn]);
check('живой магический удар с маркером даёт 5002, а не 0', () => {
  const { F } = make(), r = F.parseLog(['\u20601220\u200bПолум’я — 5002 урона'], 'Changed Creation');
  assert.equal(r.own, 5002); assert.equal(r.ownN, 1); assert.equal(r.crit, 0);
});
check('магический крит с маркером и разделителями тысяч', () => {
  const { F } = make(), r = F.parseLog(['\u20601220\u200bПолум’я · КРИТ — 12\u00a0345 урона.'], 'Changed Creation');
  assert.equal(r.own, 12345); assert.equal(r.crit, 1); assert.equal(r.ownN, 1);
});
check('новый физический удар и крит не смешиваются с котом и входящим', () => {
  const { F } = make(), r = F.parseLog(['Ти завдав [Changed Creation] 230 урона.', 'Крит! Ти завдав [Changed Creation] 460 урона.', 'Слуга [Kai the Cat] атакує [Changed Creation] 200 урону.', '[Changed Creation] ударив тебе −90 HP.'], 'Changed Creation');
  assert.equal(r.own, 690); assert.equal(r.ownN, 2); assert.equal(r.crit, 1); assert.equal(r.pet, 200); assert.equal(r.hits[0].dmg, 90);
});
check('награды и чужие удары не записываются в собственный урон', () => {
  const { F } = make(), r = F.parseLog(['Changed Creation — 500 урона', '[Player] — 777 урона', 'EXP + 46479', 'SP + 9696', '+42648 аден', 'Adamantite Nugget ×6', 'Перемога!'], 'Changed Creation');
  assert.equal(r.own, 0); assert.equal(r.ownN, 0);
});
check('новый формат спецудара РБ остаётся входящим', () => {
  const { F } = make(), r = F.parseLog(['Verfa · Гідроудар — 1995 урона'], 'Verfa');
  assert.equal(r.own, 0); assert.equal(r.spikes[0]?.dmg, 1995);
});
check('смертельный удар записывается в замер и память даже без оставшегося HP', () => {
  const { F } = make();
  F.onNet('/game/battle/start', { status: 200, req: {}, res: {}, bt: { spawn: 'dense_live', name: 'Changed Creation', lvl: 74, kind: 'passive', mob: 3732, mobMax: 3732, hp: 7777, mp: 5855, full: true, log: ['Бій розпочато: [Changed Creation] (ур. 74).'] } });
  const turn = F.onNet('/game/battle/action', { status: 200, req: { action: 'l2_1220', battleSpawnId: 'dense_live' }, res: {}, bt: { mob: null, mp: 5825, end: true, win: true, full: true, log: ['Бій розпочато: [Changed Creation] (ур. 74).', '\u20601220\u200bПолум’я — 5002 урона', 'Перемога!', '+42648 аден'] } });
  assert.equal(turn.own, 5002); assert.equal(F.lastSum().dealt, 5002); assert.equal(F.lastSum().outcome, 'win'); assert.equal(F.recall('m:changed creation')?.a?.blaze?.s?.[0], 5002);
});
let failed = 0; for (const [n, fn] of checks) { try { fn(); console.log('PASS:', n); } catch (e) { failed++; console.error('FAIL:', n, e.message); } } if (failed) process.exitCode = 1;
