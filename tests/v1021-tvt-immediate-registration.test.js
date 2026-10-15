'use strict';
// Лог 15.10 04:57: 14:50:34 регистрация 4/20, цепочка продолжается до ручного вмешательства в14:56.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture(o = {}) {
 let now = 1900000000000, battle = !!o.battle, won = !!o.won;
 const loc = { pathname: o.arena ? '/tvt-arena.html' : o.battle ? '/battle.html' : '/map.html', search: '?spawnId=sdms_disciples_001', href: '' };
 const clicked = [], logs = [], reads = [], leaves = [];
 const button = { id: 'tvt-register-btn' };
 const env = { cfg: { tvtOn: true, tvtOverRb: false }, rt: {}, on: true, tabOwner: true,
  TVT: { phase: 'REGISTRATION', eventId: 'event', isRegistered: false, registeredCount: 4, maxPlayers: 20, registrationEndsAt: now + 570000, schedule: { next: { registrationOpensAt: now, battleStartsAt: now + 600000 } }, t: now },
  $q: s => s === '#tvt-register-btn' && o.arena ? button : null, shown: e => !!e, isBattle: () => battle, victory: () => won,
  rec: (...x) => logs.push(x.join(' ')), setStatus: s => logs.push(s), setRt: async p => Object.assign(env.rt, p),
  sleep: async ms => { now += ms; }, pause: async () => {}, waitX: async f => f(), autonomyMode: () => o.fish ? 'fish' : 'farm',
  leaveMark: id => leaves.push(id), toMap: async () => { battle = false; loc.pathname = '/dungeon.html'; },
  fire: b => { clicked.push(b.id); if (o.confirm) env.TVT = { ...env.TVT, isRegistered: true }; } };
 const box = { console, Date: class extends Date { static now() { return now; } }, location: loc, document: { querySelectorAll: () => [] } };
 vm.runInNewContext(fs.readFileSync(__dirname + '/../modules/tvt.js', 'utf8'), box);
 return { env, T: box.L2V7Factories.tvt(env), loc, clicked, logs, leaves, reads, advance: n => { now += n; }, now: () => now, won: x => { won = x; }, button };
}
test('регистрация важнее активного PvE и старой tvtOverRb=false: сначала штатный выход, затем арена', async () => {
 const f = fixture({ battle: true }); f.env.rt.rbHunt = { step: 'fight' };
 assert.equal(f.T.tvtRegistrationDue(), true); assert.equal(f.T.tvtHold(), true);
 assert.equal(await f.T.tvtStep(), true); assert.equal(f.leaves[0], 'sdms_disciples_001'); assert.equal(f.clicked.length, 0);
 await f.T.tvtStep(); assert.equal(f.loc.href, '/tvt-arena.html');
});
test('победа в катакомбах: сразу на регистрацию без новой цепочки и ожидания leave cooldown', async () => {
 const f = fixture({ battle: true, won: true }); f.T.tvtStep.leaveT = f.now();
 await f.T.tvtStep(); assert.equal(f.loc.href, '/tvt-arena.html'); assert.equal(f.leaves.length, 0);
});
for (const fish of [false, true]) test('после подтверждённой регистрации возвращается прежний ' + (fish ? 'fish' : 'farm'), async () => {
 const f = fixture({ arena: true, confirm: true, fish }), cfg = JSON.stringify(f.env.cfg);
 await f.T.tvtStep(); assert.equal(f.clicked.length, 1); assert.match(f.logs.join('\n'), /регистрация подтверждена/);
 assert.equal(f.loc.href, fish ? '/fishing.html' : '/map.html'); assert.equal(JSON.stringify(f.env.cfg), cfg);
});
test('без подтверждения не объявляет успех и остаётся на арене; повтор раньше двух минут', async () => {
 const f = fixture({ arena: true }); await f.T.tvtStep();
 assert.equal(f.loc.href, ''); assert.doesNotMatch(f.logs.join('\n'), /регистрация подтверждена/);
 await f.T.tvtStep(); assert.equal(f.clicked.length, 1);
 f.advance(5000); await f.T.tvtStep(); assert.equal(f.clicked.length, 2);
});
test('все20мест заняты: не нажимает регистрацию, но проверяет освободившееся место', async () => {
 const f = fixture({ arena: true, confirm: true }); f.env.TVT.registeredCount = 20;
 await f.T.tvtStep(); assert.equal(f.clicked.length, 0); assert.equal(f.loc.href, '');
 f.env.TVT.registeredCount = 19; await f.T.tvtStep(); assert.equal(f.clicked.length, 1);
});
for (const reason of ['stop', 'lease', 'disabled']) test(reason + ' отменяет регистрацию после ожидания', async () => {
 const f = fixture({ arena: true }); f.env.pause = async () => { if (reason === 'stop') f.env.on = false; else if (reason === 'lease') f.env.tabOwner = false; else f.env.cfg.tvtOn = false; };
 await f.T.tvtStep(); assert.equal(f.clicked.length, 0); assert.equal(f.loc.href, '');
});
test('фаза закрылась во время ожидания кнопки — регистрацию не отправляет', async () => {
 const f = fixture({ arena: true }); f.env.waitX = async fn => { f.env.TVT.phase = 'PREPARATION'; return fn(); };
 await f.T.tvtStep(); assert.equal(f.clicked.length, 0);
});
test('обновление статуса на границе расписания не ждёт минутного GET игры', async () => {
 const f = fixture(); f.env.TVT.phase = 'IDLE'; f.env.TVT.eventId = null; f.env.TVT.schedule.next.registrationOpensAt = f.now() + 1000;
 f.env.gameGet = async url => { f.reads.push(url); return { ok: true, json: async () => ({ ...f.env.TVT, phase: f.now() >= 1900000001000 ? 'REGISTRATION' : 'IDLE', serverNow: f.now() }) }; };
 await f.T.tvtRefresh(); assert.equal(f.T.tvtRegistrationDue(), false);
 f.advance(1001); await f.T.tvtRefresh(); assert.equal(f.reads.length, 2); assert.equal(f.T.tvtRegistrationDue(), true);
});
test('далеко от открытия не добавляет фоновые запросы', async () => {
 const f = fixture(); f.env.TVT.phase = 'IDLE'; f.env.TVT.schedule.next.registrationOpensAt = f.now() + 600000;
 f.env.gameGet = async () => { throw Error('не должен вызываться'); }; await f.T.tvtRefresh(); assert.equal(f.env.rt.tvt, undefined);
});
test('параллельные проверки статуса выполняют один GET; Stop не сохраняет запоздалый ответ', async () => {
 const f = fixture(); let resolve; f.env.gameGet = () => { f.reads.push('get'); return new Promise(r => { resolve = r; }); };
 const first = f.T.tvtRefresh(); await f.T.tvtRefresh(); assert.equal(f.reads.length, 1);
 f.env.on = false; resolve({ ok: true, json: async () => ({ phase: 'REGISTRATION' }) }); await first; assert.equal(f.env.rt.tvt, undefined);
});
test('реальный battle проверяет регистрацию до следующего боевого действия', async () => {
 const { flowFixture } = require('./warlock-combat-fixture.cjs'), battle = flowFixture('mage'), f = fixture({ battle: true });
 battle.env.tvtStep = f.T.tvtStep; await battle.combat.battle();
 assert.equal(f.leaves.length, 1); assert.ok(!battle.events.includes('Blaze')); assert.ok(!battle.events.includes('hunt'));
});
test('реальный nextFight не продолжает цепочку катакомб при открытии регистрации', async () => {
 const { flowFixture } = require('./warlock-combat-fixture.cjs'), battle = flowFixture('mage'), f = fixture({ battle: true, won: true });
 battle.env.tvtStep = f.T.tvtStep; await battle.farm.nextFight({});
 assert.equal(f.loc.href, '/tvt-arena.html'); assert.ok(!battle.events.includes('hunt'));
});
