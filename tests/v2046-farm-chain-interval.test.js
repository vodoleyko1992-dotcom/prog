'use strict';
// 20.46 (лог 22.10 10:41:52): плановая карта после 30 боёв стоит 8,682 с до следующего start.
// Просьба игрока — реже: заводские 100, точечная миграция; настоящие nextFight/mapDue сохраняют срочные исключения.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { flowFixture } = require('./warlock-combat-fixture.cjs');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const defaults = require('../defaults.js').CFG;

function migrate(cfg, applied = {}) {
  const m = source.match(/once\('farmMap100_2046', \(\) => \{[^\n]*\}\);/);
  assert.ok(m, 'есть новая разовая миграция, историческую champInterval30 не переписываем');
  const cf = {}, once = (key, fn) => { if (!applied[key]) { fn(); applied[key] = 1; } };
  vm.runInNewContext(m[0], { cf, C: key => key in cf ? cf[key] : cfg[key], once });
  return { ...cfg, ...cf };
}
function fixture(cfg = {}) {
  const f = flowFixture('fighter'), e = f.env; f.setWon(true);
  Object.assign(e.cfg, { chain: true, searchQuest: true, searchChamp: true, priority: '[квест]\n[чемп]\n[все]',
    deepEvery: defaults.deepEvery, champEvery: defaults.champEvery, shopAuto: false, ...cfg });
  Object.assign(e.rt, { sinceDeep: 0, deepHot: false, chainQ: [], via: 'chain', char: 'Hero', zone: 'here' });
  e.searchActive = () => true;
  const policy = { Math, Date, get cfg() { return e.cfg; }, get rt() { return e.rt; },
    parseRules: () => f.farm.parseRules(), champRuleOn: () => f.farm.champRuleOn(),
    campActive: () => e.campActive(), campChampOpen: () => e.campChampOpen(), campRbOpen: () => e.campRbOpen(),
    lootGoal: () => e.lootGoal?.(), farmRules: () => e.farmRules(), recipeRules: () => e.recipeRules(),
    rbDue: () => e.rbDue(), searchActive: rules => e.searchActive(rules) };
  const p = source.slice(source.indexOf('const CHAMP_EVERY ='), source.indexOf('// цепочка сама'));
  vm.runInNewContext(p + '\nthis.api = {deepN, mapDue, farmMapOn};', policy);
  Object.assign(e, policy.api);
  const ctx = { name: 'Safe Mob', killed: [], champ: false };
  const run = async since => { e.rt.sinceDeep = since; await f.farm.nextFight(ctx); return f.events; };
  return { ...f, run, ctx };
}

test('новая установка: общий плановый интервал и чемпионы — 100', () => {
  assert.equal(defaults.deepEvery, 100); assert.equal(defaults.champEvery, 100);
});
for (const [deepEvery, champEvery, wantDeep, wantChamp] of [
  [30, 30, 100, 100], [0, 30, 0, 100], [30, 0, 100, 0], [37, 75, 37, 75], [100, 100, 100, 100], [50, 60, 50, 60], [99999, 5, 99999, 5]
]) test(`миграция сохраняет ручные интервалы: ${deepEvery}/${champEvery}`, () => {
  const c = migrate({ deepEvery, champEvery, searchChamp: false, chain: false });
  assert.equal(c.deepEvery, wantDeep); assert.equal(c.champEvery, wantChamp);
  assert.equal(c.searchChamp, false); assert.equal(c.chain, false);
});
test('повторная загрузка не отменяет ручной возврат к 30/0 после миграции', () => {
  const applied = {}, first = migrate({ deepEvery: 30, champEvery: 30 }, applied);
  assert.equal(first.deepEvery, 100);
  const next = migrate({ ...first, deepEvery: 30, champEvery: 0 }, applied);
  assert.equal(next.deepEvery, 30); assert.equal(next.champEvery, 0);
});

for (const n of [30, 50, 99]) test(`плановая карта не разрывает настоящую цепочку на ${n}-м бою`, async () => {
  const f = fixture(); await f.run(n);
  assert.equal(f.events.includes('hunt'), true); assert.equal(f.events.includes('map'), false);
  assert.doesNotMatch(f.logs.join('\n'), /плановая проверка целей/);
});
test('на 100-м бою карта проверяется, причина понятна из журнала', async () => {
  const f = fixture(); await f.run(100);
  assert.equal(f.events.includes('hunt'), false); assert.equal(f.events.includes('map'), true);
  assert.match(f.logs.join('\n'), /на карту: плановая проверка целей — раз в 100 боёв/);
});
test('ручной интервал 37 работает до и после границы, без принудительных 100', async () => {
  for (const [n, map] of [[36, false], [37, true]]) {
    const f = fixture({ deepEvery: 37, champEvery: 75 }); await f.run(n);
    assert.equal(f.events.includes('map'), map); assert.equal(f.events.includes('hunt'), !map);
  }
});
test('общая карта 0 без чемпионов остаётся выключенной даже при hot', async () => {
  const f = fixture({ deepEvery: 0, searchChamp: false }); f.env.rt.deepHot = true; await f.run(1000);
  assert.equal(f.events.includes('hunt'), true); assert.equal(f.events.includes('map'), false);
});
for (const [n, map] of [[99, false], [100, true]]) test('резерв поиска чемпионов при deepEvery=0: ' + n, async () => {
  const f = fixture({ deepEvery: 0, champEvery: undefined }); await f.run(n);
  assert.equal(f.events.includes('map'), map);
});
for (const [n, map] of [[49, false], [50, true]]) test('ресурсный интервал 50 не меняется: ' + n, async () => {
  const f = fixture(); f.env.lootGoal = () => ({ zone: 'here' }); await f.run(n);
  assert.equal(f.events.includes('map'), map); assert.equal(f.events.includes('hunt'), !map);
});
test('свежая настоящая ★ цель этой локации сохраняет немедленный выход', async () => {
  const f = fixture(); f.env.isQuestName = n => /quest mob/i.test(n);
  f.env.rt.questTargets = ['Quest Mob']; f.env.rt.zoneMobs = { here: ['Quest Mob', 'Safe Mob'] };
  await f.run(1); assert.equal(f.events.includes('map'), true); assert.equal(f.events.includes('hunt'), false);
  assert.match(f.logs.join('\n'), /не ★ цель квеста/); assert.doesNotMatch(f.logs.join('\n'), /плановая проверка целей/);
});
test('чемпионы незавершённой главы проверяются как прежде раз в 5 боёв', async () => {
  const f = fixture(); f.env.campActive = () => true; f.env.campChampOpen = () => true; f.env.campOn = () => true;
  await f.run(5); assert.equal(f.events.includes('map'), true);
});
test('РБ незавершённой главы сохраняет выход после 3 боёв', async () => {
  const f = fixture(); f.env.campRbOpen = () => ['boss']; await f.run(3);
  assert.equal(f.events.includes('map'), true); assert.doesNotMatch(f.logs.join('\n'), /плановая проверка целей/);
});
test('переход к РБ не выдаётся за плановую проверку мобов', async () => {
  const f = fixture(); f.env.huntOn = () => true; await f.run(1);
  assert.equal(f.events.includes('map'), true); assert.doesNotMatch(f.logs.join('\n'), /плановая проверка целей/);
});
test('обучение после победы не откладывается ради 100 боёв', async () => {
  const f = fixture(); f.env.magisterAfterWin = async () => { f.events.push('magister'); return true; };
  await f.run(1); assert.ok(f.events.includes('magister')); assert.ok(!f.events.includes('hunt'));
});
test('срочная закупка не откладывается ради 100 боёв', async () => {
  const f = fixture(); f.env.rt.shop = { urgent: true }; await f.run(1);
  assert.equal(f.location.href, '/char.html'); assert.ok(!f.events.includes('hunt'));
});
test('неподтверждённый дневной лимит не разрешает новый бой', async () => {
  const f = fixture(); f.env.dailyWorkReady = async () => false; await f.run(1);
  assert.ok(!f.events.includes('hunt')); assert.ok(f.events.includes('map'));
});
test('лечение тура на мобах по-прежнему продолжается цепочкой', async () => {
  const f = fixture(); f.env.huntOn = () => true; f.env.rt.rbHunt = { phase: 'prepare', last: 'лечусь на мобах' };
  f.env.meHp = () => ({ cur: 500, max: 1000, pct: 50 }); await f.run(1);
  assert.ok(f.events.includes('hunt')); assert.ok(!f.events.includes('map'));
});
test('TvT остаётся выше продолжения обычной цепочки', async () => {
  const f = fixture(); f.env.tvtStep = async () => { f.events.push('tvt'); return true; }; await f.run(1);
  assert.equal(JSON.stringify(f.events), '["tvt"]');
});
test('Stop во время ожидания кнопки не запускает новый бой', async () => {
  const f = fixture(); f.env.waitFor = async () => { f.env.on = false; return f.hunt; }; await f.run(30);
  assert.ok(!f.events.includes('hunt')); assert.ok(!f.events.includes('map'));
});
