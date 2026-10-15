'use strict';
// 14.10: публичные subclass-quest.js/noblesse-quest.js показывают «Телепорт к NPC», когда сдача вдали ещё недоступна.
// Готовность к походу отличается от actions.canComplete/canAdvance (готовности нажать сдачу на текущем месте).
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'modules/story.js'), 'utf8');
function setup() {
  const sb = { console, Date, sessionStorage: { getItem() {}, setItem() {} }, location: { pathname: '/map.html' } }; sb.globalThis = sb;
  vm.runInNewContext(src, sb);
  const env = { cfg: { storyTurnIn: true }, rt: { zone: 'silent_valley' }, on: true,
    setRt: async p => Object.assign(env.rt, p), rec() {}, isBattle: () => false, fishNow: () => false,
    awayFree: () => true, autonomyMode: () => 'hunt', gameGet: async () => ({ ok: false, json: async () => ({}) }) };
  return { S: sb.L2V7Factories.story(env), env };
}
const cases = [];
const test = (name, f) => cases.push([name, f]);
test('четыре РБ пройдены: вдали от Ladd начинается поход сдачи', async () => {
  const { S, env } = setup();
  S.qNote('subclass', { stage: 'return_to_ladd', location: { atLadd: false },
    npc: { ladd: { name: 'Magister Ladd', teleportId: 'ivory_tower' } }, actions: { canComplete: false } });
  assert.equal(await S.storyStep(), true);
  assert.equal(env.rt.storyJob.kind, 'subclass'); assert.equal(env.rt.storyJob.home, 'silent_valley');
});
test('сабкласс не принят/РБ не добиты: похода сдачи нет', () => {
  const { S } = setup();
  for (const stage of ['not_started', 'hunt_bosses', 'completed']) {
    S.qNote('subclass', { stage, actions: { canComplete: false } }); assert.equal(S.want(), null);
  }
});
const noble = extra => ({ part: 1, active: true, subclassLevel: 50, minLevel: 50, atNpc: false,
  npc: { name: 'Virgil', teleportId: 'rune' }, actions: { canAdvance: false },
  targets: [{ name: 'Vanor Silenos Chieftain', have: 100, need: 100 }, { name: 'Varnish', have: 100, need: 100 }], ...extra });
test('Noblesse: убийства и ресурс набраны, вдали от NPC идём сдавать', async () => {
  const { S, env } = setup(); S.qNote('noblesse', noble());
  assert.equal(await S.storyStep(), true); assert.equal(env.rt.storyJob.kind, 'noblesse');
});
test('Noblesse: часть 4 без целей на нужном сабе идёт к Caradine', () => {
  const { S } = setup(); S.qNote('noblesse', noble({ part: 4, subclassLevel: 75, minLevel: 75, targets: [] }));
  assert.equal(S.want()?.kind, 'noblesse');
});
test('Noblesse: основной класс/слабый саб/нехватка ресурса/нет целей части 1 не начинают сдачу', () => {
  for (const extra of [{ subclassLevel: null }, { subclassLevel: 49 },
    { targets: [{ name: 'Varnish', have: 99, need: 100 }] }, { targets: [] }, { completed: true }]) {
    const { S } = setup(); S.qNote('noblesse', noble(extra)); assert.equal(S.want(), null);
  }
});
test('выключенная сдача не создаёт job', async () => {
  const { S, env } = setup(); env.cfg.storyTurnIn = false;
  S.qNote('subclass', { stage: 'return_to_ladd', actions: { canComplete: false } });
  assert.equal(await S.storyStep(), false); assert.equal(env.rt.storyJob, undefined);
});
test('стоп во время загрузки кнопок отменяет сдачу', async () => {
  const { S, env } = setup(); const fired = [], done = {};
  env.waitX = async () => { env.on = false; return { children: [done], querySelector: () => done }; };
  env.$q = () => null; env.fire = b => fired.push(b); env.sleep = async () => {};
  // step сначала переводит на страницу; для этого теста нужен именно шаг на ней.
  const sb = { console, Date, location: { pathname: '/noblesse-quest.html' }, sessionStorage: { getItem() {}, setItem() {} } }; sb.globalThis = sb;
  vm.runInNewContext(src, sb);
  env.rt.storyJob = { kind: 'noblesse', why: 'часть 1', t: Date.now() }; await sb.L2V7Factories.story(env).step(env.rt.storyJob);
  assert.deepEqual(fired, []);
});
test('стоп во время чтения цены отменяет платный телепорт', async () => {
  const { env } = setup(); const fired = [], tp = { dataset: { noblesseTarget: 'rune' } };
  const box = { children: [tp], querySelector: s => s.includes('teleport') ? tp : null };
  env.waitX = async fn => fn(); env.$q = s => s.includes('-actions') ? box : null;
  env.fire = b => fired.push(b); env.sleep = async () => {};
  env.gameGet = async () => { env.on = false; return { ok: true, json: async () => ({ locations: [{ teleportId: 'rune', adenaCost: 20000 }] }) }; };
  const sb = { console, Date, location: { pathname: '/noblesse-quest.html' }, sessionStorage: { getItem() {}, setItem() {} } }; sb.globalThis = sb;
  vm.runInNewContext(src, sb);
  env.rt.storyJob = { kind: 'noblesse', why: 'часть 1', t: Date.now() }; await sb.L2V7Factories.story(env).step(env.rt.storyJob);
  assert.deepEqual(fired, []);
});
(async () => { let fail = 0; for (const [name, f] of cases) {
  try { await f(); console.log('PASS:', name); } catch (e) { fail++; console.error('FAIL:', name, '\n', e.message); }
} if (fail) process.exitCode = 1; else console.log('v1013-fullgame-systems-story: PASS (' + cases.length + ')'); })();
