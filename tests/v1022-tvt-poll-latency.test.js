'use strict';
// 15.10: пропущенная граница расписания и медленный GET не должны останавливать PvE.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture() {
 let now = 1900000000000, resolve, reads = 0, exits = 0;
 const location = { pathname: '/battle.html', search: '?spawnId=test', href: '' };
 const env = { on: true, tabOwner: true, cfg: { tvtOn: true }, rt: {},
  TVT: { phase: 'IDLE', isRegistered: false, schedule: { next: { registrationOpensAt: now - 30000, battleStartsAt: now + 570000 } } },
  gameGet: () => { reads++; return new Promise(r => { resolve = r; }); },
  setRt: async p => Object.assign(env.rt, p), isBattle: () => true, victory: () => false,
  toMap: async () => { exits++; }, sleep: async () => {}, rec: () => {}, $q: () => null };
 const box = { Date: class extends Date { static now() { return now; } }, location, console };
 vm.runInNewContext(fs.readFileSync(__dirname + '/../modules/tvt.js', 'utf8'), box);
 return { env, T: box.L2V7Factories.tvt(env), advance: ms => { now += ms; }, reads: () => reads, exits: () => exits,
  reply: async () => { resolve({ ok: true, json: async () => ({ phase: 'REGISTRATION', eventId: 'new', registeredCount: 4, maxPlayers: 20, registrationEndsAt: now + 500000 }) }); for (let i = 0; i < 8; i++) await Promise.resolve(); } };
}
test('после сна вкладки на30с чтение догоняет открытие регистрации', async () => {
 const f = fixture(), pending = f.T.tvtRefresh(); assert.equal(f.reads(), 1);
 await f.reply(); await pending; assert.equal(f.T.tvtRegistrationDue(), true);
});
test('медленный GET не блокирует PvE; после ответа регистрация сразу прерывает бой', async () => {
 const f = fixture(); let settled = false, result;
 const step = f.T.tvtStep().then(v => { settled = true; result = v; });
 for (let i = 0; i < 8; i++) await Promise.resolve();
 assert.equal(settled, true, 'tvtStep завершился до ответа GET'); assert.equal(result, false);
 await step; await f.T.tvtStep(); assert.equal(f.reads(), 1, 'один запрос в полёте');
 await f.reply(); assert.equal(await f.T.tvtStep(), true); assert.equal(f.exits(), 1);
});
test('известная открытая регистрация не ждёт повторного GET перед выходом', async () => {
 const f = fixture(); f.env.TVT.phase = 'REGISTRATION';
 assert.equal(await f.T.tvtStep(), true); assert.equal(f.exits(), 1); assert.equal(f.reads(), 1);
 f.env.on = false; await f.reply(); assert.equal(f.env.rt.tvt, undefined);
});
test('за пределами окна и после подтверждения регистрации лишних GET нет', async () => {
 const f = fixture(); f.advance(601000); await f.T.tvtRefresh(); assert.equal(f.reads(), 0);
 const g = fixture(); g.env.TVT.isRegistered = true; await g.T.tvtRefresh(); assert.equal(g.reads(), 0);
});
test('неудавшийся опрос не создаёт запрос на каждый удар: повтор через5с', async () => {
 const f = fixture(); f.env.gameGet = async () => { throw Error('offline'); };
 await f.T.tvtStep(); for (let i = 0; i < 8; i++) await Promise.resolve();
 let reads = 0; f.env.gameGet = async () => { reads++; return { ok: false }; };
 await f.T.tvtStep(); assert.equal(reads, 0); f.advance(5001); await f.T.tvtStep(); assert.equal(reads, 1);
});

test('старое registrationEndsAt от прошлого события не скрывает новое окно расписания', async () => {
 const f = fixture(); f.env.TVT.registrationEndsAt = 1899990000000;
 const pending = f.T.tvtRefresh(); assert.equal(f.reads(), 1); await f.reply(); await pending;
 assert.equal(f.T.tvtRegistrationDue(), true);
});
