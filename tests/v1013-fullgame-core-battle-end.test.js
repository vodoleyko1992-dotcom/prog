'use strict';
// 10.0.13: финальный full-ответ может не содержать battle; игра рисует victory.fullLog / defeat.fullLog.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const hook = read('hook.js'), start = hook.indexOf('  const btOf = '), end = hook.indexOf('  // 9.2 (лист врагов;', start);
assert.ok(start >= 0 && end > start);
const btOf = vm.runInNewContext(hook.slice(start, end) + '\nbtOf;');
const getBt = res => btOf({ pathname: '/game/battle/action' }, res);
for (const kind of ['victory', 'defeat']) test(kind + '.fullLog сохраняется без battle и помечается полным', () => {
  const bt = getBt({ kind: 'full', character: { hp: 500, mp: 1000 }, [kind]: { fullLog: ['Полум’я 3000', { text: 'Конец боя' }] } });
  assert.deepEqual(Array.from(bt.log), ['Полум’я 3000', 'Конец боя']); assert.equal(bt.full, true); assert.equal(bt.end, true);
  assert.equal(kind === 'victory' ? bt.win : bt.lose, true);
});
test('явный delta.logTail сохраняет приоритет перед полным журналом', () => {
  const bt = getBt({ kind: 'delta', delta: { logTail: ['Полум’я 3000'], logSeq: 4 }, victory: { fullLog: ['Енергетична блискавка 1000', 'Полум’я 3000'] } });
  assert.deepEqual(Array.from(bt.log), ['Полум’я 3000']); assert.equal(bt.full, false); assert.equal(bt.seq, 4);
});
test('battle.log сохраняет прежний приоритет, даже когда есть victory.fullLog', () => {
  const bt = getBt({ kind: 'full', battle: { log: ['Полум’я 3000'] }, victory: { fullLog: ['Другая строка'] } });
  assert.deepEqual(Array.from(bt.log), ['Полум’я 3000']); assert.equal(bt.full, true);
});
for (const first of ['full', 'delta']) test('hook → fightlab: финальный полный журнал учитывает только новый урон после ' + first, () => {
  let now = 1e6;
  const box = { console, URLSearchParams, Date: { now: () => now } }; vm.createContext(box); vm.runInContext(read('modules/fightlab.js'), box);
  const env = { rt: {}, cfg: {}, actName: a => a, mobTitle: () => '', isChamp: () => false, isBoss: () => false, rec() {}, fmtT: s => String(s), setRt: async p => Object.assign(env.rt, p) };
  const fl = box.L2V7Factories.fightlab(env), L0 = ['Бой начат: Orc'], L1 = [...L0, 'Енергетична блискавка 1000', 'Слуга [Kai the Cat] атакує [Orc] 200 урону.'];
  const send = (route, res, action) => fl.onNet(route, { status: 200, req: { action, battleSpawnId: 'dense_test' }, res: {}, bt: btOf({ pathname: route }, res) });
  send('/game/battle/start', { battle: { spawnId: 'dense_test', mobName: 'Orc', mobLevel: 60, mobHp: 4200, mobMaxHp: 4200, log: L0, logSeq: 1 } });
  now += 1000;
  const prior = first === 'delta' ? { kind: 'delta', delta: { mobHp: 3000, logSeq: 3, logTail: L1.slice(1) } } : { kind: 'full', battle: { mobHp: 3000, logSeq: 3, log: L1 } };
  assert.equal(send('/game/battle/action', prior, 'energy bolt').own, 1000);
  now += 1000;
  const turn = send('/game/battle/action', { kind: 'full', victory: { fullLog: [...L1, 'Полум’я 3000', 'Победа!'] } }, 'blaze');
  assert.equal(turn.own, 3000, 'финальный урон не теряется и прошлый ход не считается повторно');
  assert.equal(fl.lastSum().dealt, 4000); assert.equal(fl.lastSum().pet, 200); assert.equal(fl.lastSum().outcome, 'win');
});
