'use strict';
// 23.10: общий темп ждём до выбора действия и его sent-маркеров, сохраняя Stop и свежие условия боя.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { world } = require('./v1014-fishing-controls.test.js');
const combat = fs.readFileSync(__dirname + '/../modules/combat.js', 'utf8');
const tvt = fs.readFileSync(__dirname + '/../modules/tvt.js', 'utf8');

function pve() {
 let now = 1000000, hp = 70, globalUntil = 0;
 const calls = [], clicked = [];
 const env = { on: true, tabOwner: true, cfg: { nDrain: '' }, rt: {}, isBattle: () => true,
  combatCooldown: { globalWait: () => Math.max(0, globalUntil - now), skillWait: () => 0 }, slotAction: () => 'attack', cdSpawn: () => 'mob',
  names: () => [], meHp: () => ({ pct: hp }), cleanTitle: s => s, observeSlot() {}, rec() {}, fire: b => { clicked.push({ b, at: now }); return true; },
  actionWait: async valid => { calls.push('pace'); now += 1000; return valid(); } };
 const box = { env, Date: { now: () => now }, Math, document: { documentElement: { dataset: {} } },
  pendingTurn: null, actionContext: () => 'owner', battleOwner: 'owner', victory: () => false, defeat: () => false,
  pulse: async ms => { now += ms; }, gameFree: async valid => { calls.push('gameFree'); return valid() && {}; },
  managedToggleIds: [], ctx: { mePct0: 70 }, healSlot: () => false, noticeText: () => '', fastMark() {}, lockA: 120, lockB: 50 };
 const start = combat.indexOf('  const act = async (b, status,'), end = combat.indexOf('    lastAct = Date.now();', start);
 assert.ok(start > 0 && end > start);
 vm.runInNewContext(combat.slice(start, end) + '\nreturn true; }; this.act = act;', box);
 return { env, box, calls, clicked, setHp: n => { hp = n; }, setGlobal: n => { globalUntil = n; } };
}
test('PvE: общая пауза предшествует gameFree и фактическому клику', async () => {
 const f = pve(); assert.equal(await f.box.act({ title: 'Attack' }, 'удар'), true);
 assert.deepEqual(f.calls, ['pace', 'gameFree']); assert.equal(f.clicked[0].at, 1001000);
});
test('PvE: Stop в общей паузе не начинает gameFree и не отправляет действие', async () => {
 const f = pve(); f.env.actionWait = async valid => { f.env.on = false; return valid(); };
 assert.equal(await f.box.act({}, 'удар'), false); assert.equal(f.clicked.length, 0); assert.deepEqual(f.calls, []);
});
test('PvE: упавший за паузу HP отменяет выбранный удар', async () => {
 const f = pve(); f.env.actionWait = async valid => { f.setHp(20); return valid(); };
 assert.equal(await f.box.act({ title: 'Attack' }, 'удар', true), 'lock'); assert.equal(f.clicked.length, 0);
});
test('PvE: общий темп не сокращает ещё действующий серверный КД', async () => {
 const f = pve(); f.setGlobal(1001800); assert.equal(await f.box.act({}, 'удар'), true);
 assert.equal(f.clicked[0].at, 1001800);
});

function arena() {
 let now = 1000000, hp = 100, waits = 0, pet = { id: 'pet-old', disabled: false };
 const clicks = [], attack = { id: 'attack', title: 'Атака' }, pot = { id: 'pot', title: 'Зелье HP' };
 const state = { id: 'event', phase: 'ACTIVE', start: now - 1000, now }, enemy = { id: 'enemy', name: 'Enemy', hp: 4000, cp: 0, lvl: 1 };
 const env = { on: true, cfg: { tvtPet: true, nAttack: 'attack' }, rt: { tvtIn: 'event' },
  TVTC: { selectedTarget: { ...enemy, characterId: 'enemy', alive: true }, t: now, actN: 0, selfSummon: { alive: true } },
  shown: b => !!b, $q: s => s === '#tvt-summon-attack-btn' ? pet : null,
  names: s => String(s || '').split(',').filter(Boolean), slotsBy: n => n === 'attack' ? [attack] : [],
  meHp: () => ({ pct: hp }), hpPotPick: () => pot, forceCosts: () => [], hudForce: () => 0, forceNow: () => 0, forceMax: () => 0,
  ready: () => true, cleanTitle: s => s, setStatus() {}, rec() {}, rnd: a => a,
  waitX: async fn => fn(), sleep: async ms => { now += ms; },
  actionWait: async valid => { waits++; if (clicks.length) now = Math.max(now, clicks.at(-1).at + 1000); return valid(); },
  fire: b => { clicks.push({ b, at: now }); if (b === attack) { env.TVTC.actN++; env.TVTC.actT = now; } else env.on = false; } };
 const box = { env, Date: { now: () => now }, Math, Map, canRun: () => env.on, token: () => env.rt.char,
  active: t => env.on && t === env.rt.char, tvtState: () => state, isArena: () => true, tvtNow: () => now, tvtMs: n => +n || 0,
  tvtEnemies: () => [enemy], tvtSkillsRefresh: async () => {}, tvtRefresh: async () => {}, mpNow: () => 100, mpMax: () => 0, skillInfo: () => ({}), chargeState: () => ({ n: 0, off: true }),
  tvtSkillAllowed: () => true, notStuck: () => true, srvReady: () => true, mpOk: () => true,
  misses: new Map(), slotKey: b => b.id, stuckNote: () => assert.fail('Намеренная пауза не должна считаться потерянным кликом') };
 const start = tvt.indexOf('async function tvtFight()'), end = tvt.indexOf('\n return { tvtNow', start);
 assert.ok(start > 0 && end > start); vm.runInNewContext(tvt.slice(start, end) + '\nthis.fight = tvtFight;', box);
 return { env, box, clicks, attack, pot, waits: () => waits, replacePet: () => { pet = { id: 'pet-new', disabled: false }; }, setHp: n => { hp = n; } };
}
test('TvT: после общей паузы заново выбирает необходимую банку HP', async () => {
 const f = arena(); f.env.actionWait = async valid => { f.setHp(20); return valid(); };
 await f.box.fight(); assert.equal(f.clicks.length, 1); assert.equal(f.clicks[0].b, f.pot);
});
test('TvT: атака кота соблюдает интервал и получает свежую кнопку', async () => {
 const f = arena(), wait = f.env.actionWait; f.env.actionWait = async valid => { const result = await wait(valid); if (f.waits() === 2) f.replacePet(); return result; };
 await f.box.fight(); assert.deepEqual(f.clicks.map(x => x.b.id), ['attack', 'pet-new']); assert.equal(f.clicks[1].at - f.clicks[0].at, 1000);
});
test('TvT: смена героя во время паузы отменяет старый выбор действия', async () => {
 const f = arena(); f.env.actionWait = async valid => { f.env.rt.char = 'Other'; return valid(); };
 await f.box.fight(); assert.equal(f.clicks.length, 0);
});

function fish() {
 const f = world({ cfg: { reactMin: 0, reactMax: 0 } }); f.active = true; f.remain = '01:00:00'; f.need = 'Pumping';
 for (const kind of ['pumping', 'reeling']) f.slots[kind] = { kind, disabled: false };
 const base = f.env.$q;
 f.env.$q = s => s === '#fishing-target' ? f.active && { textContent: 'White Fish 140 / 140 ' + f.need,
  querySelector: q => ({ textContent: /__name/.test(q) ? 'White Fish' : /__hp/.test(q) ? '140 / 140' : f.need }) } : base(s);
 return f;
}
test('рыбалка: новая подсказка после паузы не отправляет старый pumping и не создаёт sent-снимок', async () => {
 const f = fish(); f.env.actionWait = async valid => { f.need = 'Reeling'; return valid(); };
 const lines = await f.F.fishAct('pumping'); assert.equal(lines.retry, true); assert.equal(lines.rej, false);
 assert.equal(f.clicks.length, 0); assert.equal(f.env.fishLastPre, undefined); assert.equal(f.env.rt.fishCdStat, undefined);
});
test('рыбалка: Stop во время паузы не создаёт попытку и не ждёт ложный ответ', async () => {
 const f = fish(); f.env.actionWait = async valid => { f.env.on = false; return valid(); };
 await f.F.fishAct('pumping'); assert.equal(f.clicks.length, 0); assert.equal(f.env.fishLastPre, undefined); assert.equal(f.reloads, 0);
});
test('рыбалка: цикл выбирает reeling по подсказке, обновившейся за паузу', async () => {
 const f = fish(); f.env.actionWait = async valid => { f.need = 'Reeling'; return valid(); };
 f.env.fire = b => { f.clicks.push(b); f.active = false; f.env.on = false; };
 await f.F.fishFight(); assert.deepEqual(f.clicks.map(x => x.kind), ['reeling']);
});
test('рыбалка: прерванная пауза pager не отправляет перелистывание', async () => {
 const f = fish(); f.env.actionWait = async () => false;
 assert.equal(await f.F.fishBagPage(true), false); assert.equal(f.clicks.length, 0);
});
