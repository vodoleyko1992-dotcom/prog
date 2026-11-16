const test = require('node:test');
const assert = require('node:assert');
global.chrome = { storage: { local: { get() {}, set() {} } }, runtime: { sendMessage() {} } };
global.location = { origin: 'https://l2mobi.pro', pathname: '/' };
global.navigator = { userAgent: 'test' };
require('../data/mobs.js'); require('../src/parse.js'); require('../src/net.js'); require('../src/core.js'); require('../src/engine.js');
const E = globalThis.L2MEngine, T = E._test;

test('выбор моба: диапазон −5…+9 и выученный опыт в секунду', () => {
  T.setHero({ name: 'Hero', level: 20 });
  const mobs = [{ name: 'A', level: 14 }, { name: 'B', level: 22 }, { name: 'C', level: 25 }, { name: 'D', level: 30 }];
  assert.equal(T.pickMob(mobs).name !== 'A' && T.pickMob(mobs).name !== 'D', true);
  T.mstats.win('B', 2000, 1000, 2); T.mstats.win('B', 2000, 1000, 2);
  T.mstats.win('C', 20000, 1000, 9); T.mstats.win('C', 20000, 1000, 9);
  assert.equal(T.pickMob(mobs).name, 'B');
  T.mstats.death('B'); T.mstats.death('B');
  assert.equal(T.pickMob(mobs).name, 'C');
});

test('очередь задач: при смерти первым идёт возврат, иначе охота', () => {
  const s = T.sched, st = E.state;
  st.me = { hp: 100, maxHp: 100, mp: 100, maxMp: 100 }; st.lastDaily = ''; st.lastBuff = Date.now();
  E.setCfg({ daily: false, autoLearn: false, buffs: '' });
  assert.equal(s.next(E.cfg, st).key, 'hunt');
  st.dead = true; assert.equal(s.next(E.cfg, st).key, 'survive'); st.dead = false;
  st.me.hp = 10; assert.equal(s.next(E.cfg, st).key, 'rest');
});

test('настройки из файла: только известные ключи нужного типа', () => {
  const n = E.importCfg({ maxLvlAbove: 7, bogus: 1, loot: 'yes' });
  assert.equal(n, 1); assert.equal(E.cfg.maxLvlAbove, 7); assert.equal(E.cfg.loot, true);
});

test('лечение в бою при низком HP и вид «Самолечения»', () => {
  const P = globalThis.L2MParse;
  assert.equal(P.skillKind('Восстанавливает Ваше HP. Power: 42.', 42), 'heal');
  assert.equal(P.skillKind('Атакакует противника сильным порывом ветра. Power: 15.', 15), 'attack');
  const st = E.state;
  st.skillInfo['1216'] = { kind: 'heal', power: 42 }; st.skillInfo['1177'] = { kind: 'attack', power: 15 };
  const hb = { attack: 'a', skills: [{ id: '1177', href: 'g1177' }, { id: '1216', href: 'g1216' }] };
  st.cd = {}; st.me = { hp: 20, maxHp: 100, mp: 50, maxMp: 100 };
  assert.equal(T.chooseAction(hb, 0).skill, '1216');
  st.me.hp = 90;
  assert.equal(T.chooseAction(hb, 0).skill, '1177');
});

test('кнопки во время работы ставят задачу первой в очередь', () => {
  const st = E.state; st.running = true; st.me = { hp: 100, maxHp: 100, mp: 100, maxMp: 100 };
  E.setCfg({ buffs: '3' }); st.lastBuff = Date.now();
  assert.equal(T.sched.next(E.cfg, st).key, 'hunt');
  E.buffNow();
  assert.equal(T.sched.next(E.cfg, st).key, 'buff');
  st.running = false; st.force = {};
});
