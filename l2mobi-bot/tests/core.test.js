const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/core.js');

test('планировщик: приоритет, пауза после 3 сбоев, снятие паузы', () => {
  let now = 1e6; const clock = () => now;
  const sv = [
    { key: 'hunt', prio: 10, enabled: () => true, due: () => true },
    { key: 'buff', prio: 70, enabled: c => c.buff, due: () => true },
  ];
  const s = C.createScheduler(sv, clock);
  assert.equal(s.next({ buff: true }).key, 'buff');
  assert.equal(s.next({ buff: false }).key, 'hunt');
  assert.equal(s.fail('buff', 'x'), false); s.fail('buff', 'x');
  assert.equal(s.fail('buff', 'нет баффера'), true);
  assert.equal(s.next({ buff: true }).key, 'hunt');
  assert.equal(s.view({ buff: true }).find(v => v.key === 'buff').held, 30);
  now += 31 * 60000;
  assert.equal(s.next({ buff: true }).key, 'buff');
  s.hold('buff', 5, 'y'); s.release('buff');
  assert.equal(s.next({ buff: true }).key, 'buff');
});

test('откат: растущая пауза, стоп на повторяющейся ошибке кода', () => {
  let now = 0; const r = C.createRecovery(() => now);
  const a = r.failure('hunt', new Error('Failed to fetch')); now += 1000;
  const b = r.failure('hunt', new Error('Failed to fetch'));
  assert.ok(b.delay > a.delay && a.network && a.action === 'retry');
  r.progress('hunt');
  const e = new TypeError("Cannot read properties of null (reading 'x')");
  assert.equal(r.failure('rest', e).action, 'retry'); r.failure('rest', e);
  assert.equal(r.failure('rest', e).action, 'halt');
});

test('сторож: смена места, потом стоп', () => {
  let now = 0; const w = C.createWatchdog(() => now);
  w.progress('a'); now += 5 * 60000; assert.equal(w.check(10), 'ok');
  now += 6 * 60000; assert.equal(w.check(10), 'relocate');
  now += 11 * 60000; assert.equal(w.check(10), 'relocate');
  now += 11 * 60000; assert.equal(w.check(10), 'halt');
  w.progress('b'); now += 60000; assert.equal(w.check(10), 'ok');
});

test('обучение по мобам: опыт в секунду и опасные мобы', () => {
  const m = C.createMobStats();
  m.win('Волк', 4000, 400, 3); assert.equal(m.rate('Волк'), null);
  m.win('Волк', 4000, 400, 3); assert.equal(m.rate('Волк'), 100);
  m.win('Орк', 10000, 500, 6); m.win('Орк', 10000, 500, 6);
  assert.equal(m.top()[0].name, 'Волк');
  m.death('Орк'); m.death('Орк'); assert.equal(m.dangerous('Орк'), true);
});

test('база мобов: индекс и ценность опыта за HP', () => {
  const db = C.mobDbIndex(require('../data/mobs.js'));
  assert.ok(db.size > 500);
  const r = db.byEid(20006); assert.equal(r[1], 'Орк Стрелок'); assert.equal(r[2], 8);
  assert.ok(db.value('Орк Стрелок') > 0);
});
