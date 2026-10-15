'use strict';
// 10.0.13: после отхода от синего чемпиона выбор новой цели должен соблюдать тот же вердикт, что и начало боя.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
function fixture() {
  const box = { console, Date, Math, document: { querySelectorAll: () => [] } };
  vm.createContext(box);
  for (const name of ['champs', 'dungeons', 'mobfarm']) vm.runInContext(read('modules/' + name + '.js'), box);
  const env = {
    cfg: { catDungeon: 'auto', lvlBelow: 5, lvlAbove: 5, champBlue: true, champOrange: false, champRed: false,
      champMinLvl: 20, noCancelMobs: false, priority: '[все]', searchChamp: false, champFa: true },
    rt: { lvl: 74, rbDps: 1000, spawns: { dense_blue: ['Lilim Great Mystic', 75], ordinary: ['Lilim Slayer', 74] } },
    NET_SPAWNS: { tier: { dense_blue: 'blue' } }, PAGE_SIZE: 15,
    heroLvl: () => env.rt.lvl, setRt: async patch => Object.assign(env.rt, patch), rec() {},
    campActive: () => false, campChampOpen: () => false, campChampMin: () => 0, campMobOpen: () => [], campOpen: () => [],
    isRaidId: () => false, isBoss: () => false, isQuestName: () => false,
    farmRules: () => [], recipeRules: () => [],
  };
  env.champs = require('./champs-context-fixture.cjs').freshChamps(box.L2V7Factories.champs,env);
  return { env, d: box.L2V7Factories.dungeons(env), m: box.L2V7Factories.mobfarm(env),
    blue: { id: 'dense_blue', name: 'Lilim Great Mystic', lvl: 75, champ: true, tier: 'blue' },
    ordinary: { id: 'ordinary', name: 'Lilim Slayer', lvl: 74, champ: false } };
}
function combatReject(env, candidate) {
  // Настоящая проверка входа в бой, а не дубликат её логики в тесте.
  const source = read('modules/combat.js');
  const start = source.indexOf('  if (ctx.champ && !isRb && !ctx.questKill');
  const end = source.indexOf('\n  ctx.hp0 =', start);
  assert.ok(start >= 0 && end > start);
  let left = 0;
  const box = { env: { ...env, toMap: () => ++left }, ctx: { ...candidate, questKill: !!candidate.quest },
    isRb: false, mob0: { cur: 10000, max: 10000 }, extraMobs: () => [] };
  vm.runInNewContext('this.run = async () => {' + source.slice(start, end) + '};', box);
  return box.run().then(() => left);
}
async function learned(f) {
  await f.env.champs.learn({ ...f.blue, heroLvl0: 74 }, 'weak', 100, 8);
  assert.match(f.env.champs.held(f.blue), /жду роста силы/);
  assert.equal(f.env.rt.hardMobs, undefined, 'настоящий отход чемпиона пишет отдельный вердикт, не hardMobs');
}
test('катакомбы после реального learn(weak) выбирают обычного моба вместо отвергнутого синего', async () => {
  const f = fixture(); await learned(f);
  assert.equal(await combatReject(f.env, f.blue), 1, 'тот же чемпион отклоняется на входе в бой');
  assert.equal(f.d.catPick([f.blue, f.ordinary], 74)?.id, 'ordinary', 'нельзя снова отправлять героя в отвергнутый бой');
});
test('ресурсная цель карты не обходит вердикт, который бой применяет к ней', async () => {
  const f = fixture(); await learned(f);
  f.env.farmRules = () => [{ farm: true, name: 'lilim great mystic' }];
  assert.equal(await combatReject(f.env, f.blue), 1);
  const picks = f.m.candidates(f.m.parseRules(), { ids: ['dense_blue', 'ordinary'], quest: [] },
    { dense_blue: 'champion', ordinary: 'passive' }, 99);
  assert.ok(!picks.some(x => x.id === 'dense_blue'), 'ресурс не должен создавать петлю карта → чемпион → карта');
});
test('катакомбы соблюдают минимальный уровень героя для чемпионов', async () => {
  const f = fixture(); f.env.cfg.champMinLvl = 80;
  assert.equal(await combatReject(f.env, f.blue), 1);
  assert.equal(f.d.catPick([f.blue, f.ordinary], 74)?.id, 'ordinary');
});
test('явный квест и глава сохраняют свои исключения вердикта, обычный безопасный выбор работает', async () => {
  const f = fixture();
  assert.equal(f.d.catPick([f.blue, f.ordinary], 74)?.id, 'dense_blue');
  await learned(f);
  const quest = { ...f.blue, quest: true };
  assert.equal(await combatReject(f.env, quest), 0);
  assert.equal(f.d.catPick([quest, f.ordinary], 74)?.id, 'dense_blue');
  f.env.campActive = () => true; f.env.campChampOpen = () => true;
  assert.equal(await combatReject(f.env, f.blue), 0);
  assert.equal(f.d.catPick([f.blue, f.ordinary], 74)?.id, 'dense_blue');
});
