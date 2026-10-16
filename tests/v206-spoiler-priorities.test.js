'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = process.env.L2_TEST_SOURCE || path.resolve(__dirname, '..');
function load(name, env, globals = {}) {
  const box = { console, URLSearchParams, Date, Math, ...globals };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'modules', name + '.js'), 'utf8'), box);
  return box.L2V7Factories[name](env);
}
const names = s => String(s || '').toLowerCase().split(/[,|]/).map(x => x.trim()).filter(Boolean);
function lootFixture() {
  const solo = { title: 'Spoil' }, mass = { title: 'Spoil Festival' }, slots = [solo, mass];
  const calls = [], lines = []; let marked = false;
  const env = {
    cfg: { nSpoil: 'Spoil', nSpoilMass: 'Spoil Festival' }, rt: {},
    names, slotsBy: n => slots.filter(b => b.title.toLowerCase().startsWith(n.toLowerCase())),
    ready: b => !b.disabled, cleanTitle: s => s, extraMobs: () => [],
    meMp: () => ({ cur: 629, max: 629 }), skillMp: n => /festival/i.test(n) ? 73 : 12,
    logLines: () => lines.slice(), newLines: (a, b) => b.slice(a.length),
    mobSpoiled: () => marked, nameLike: (a, b) => a.toLowerCase() === b.toLowerCase(),
    SPOIL_OK: /спойл успішний/i, SPOIL_FAIL: /спойл не вдався/i,
    waitFor: async fn => fn(), noticeText: () => '', rec() {},
    setRt: async p => Object.assign(env.rt, p)
  };
  const ctx = { block: {}, name: 'Main' }, api = load('loot', env);
  const act = async b => {
    calls.push(b.title); marked = true;
    lines.push(b === mass ? 'Spoil Festival: Main: успіх (100%); Side: успіх (100%)' : 'Спойл успішний');
    return true;
  };
  return { env, ctx, api, solo, mass, slots, calls, lines, act, mob: { cur: 2500, max: 2500 } };
}
test('массовый первым по одной видимой цели и без соседей в DOM', async () => {
  const f = lootFixture(); await f.api.spoilStep(f.ctx, f.act, f.mob);
  assert.deepEqual(f.calls, ['Spoil Festival']); assert.equal(f.ctx.spoiled, true);
});
test('старые настройки nSpoil=Spoil, пустой nSpoilMass: Festival найден на панели', async () => {
  const f = lootFixture(); f.env.cfg.nSpoilMass = '';
  await f.api.spoilStep(f.ctx, f.act, f.mob); assert.deepEqual(f.calls, ['Spoil Festival']);
});
test('на панели только Festival: префикс Spoil не превращает его в соло', async () => {
  const f = lootFixture(); f.slots.shift(); f.env.cfg.nSpoilMass = '';
  await f.api.spoilStep(f.ctx, f.act, f.mob);
  assert.equal(f.env.rt.spoilStat.mass, 1); assert.equal(f.env.rt.spoilStat.ok, undefined);
  assert.equal(f.api.spoilPick({ block: {} }), null);
});
for (const why of ['откат', 'нет маны', 'нет навыка', 'заблокирован']) test('соло как запасной: ' + why, async () => {
  const f = lootFixture();
  if (why === 'откат') f.mass.disabled = true;
  if (why === 'нет маны') f.env.meMp = () => ({ cur: 60, max: 629 });
  if (why === 'нет навыка') f.slots.pop();
  if (why === 'заблокирован') f.ctx.block['spoil:spoil festival'] = Infinity;
  await f.api.spoilStep(f.ctx, f.act, f.mob); assert.deepEqual(f.calls, ['Spoil']);
});
test('хватает ровно стоимости Festival: лишний резерв MP не включает соло', async () => {
  const f = lootFixture(); f.env.meMp = () => ({ cur: 73, max: 629 });
  await f.api.spoilStep(f.ctx, f.act, f.mob); assert.deepEqual(f.calls, ['Spoil Festival']);
});
test('успешный масс-спойл не повторяется и не дополняется соло', async () => {
  const f = lootFixture(); await f.api.spoilStep(f.ctx, f.act, f.mob);
  assert.equal(await f.api.spoilStep(f.ctx, f.act, f.mob), false);
  assert.deepEqual(f.calls, ['Spoil Festival']);
  assert.equal(f.env.rt.spoilStat.massOk, 2); assert.equal(f.env.rt.spoilStat.ok, undefined);
});
test('неудача только главного после массового: запасной соло', async () => {
  const f = lootFixture();
  await f.api.spoilStep(f.ctx, async b => { f.calls.push(b.title); f.lines.push('Spoil Festival: Main: промах (50%); Side: успіх (100%)'); return true; }, f.mob);
  assert.equal(f.ctx.spoiled, undefined); assert.equal(f.env.rt.spoilStat.massFail, 1);
  await f.api.spoilStep(f.ctx, f.act, f.mob); assert.deepEqual(f.calls, ['Spoil Festival', 'Spoil']);
});
for (const result of [false, 'cd', 'noforce', 'lock']) test('непринятое массовое действие не считается применением: ' + result, async () => {
  const f = lootFixture(); await f.api.spoilStep(f.ctx, async () => result, f.mob);
  assert.equal(f.ctx.massTried, undefined); assert.equal(f.env.rt.spoilStat, undefined);
  await f.api.spoilStep(f.ctx, f.act, f.mob); assert.deepEqual(f.calls, ['Spoil Festival']);
});
test('явно недоступный Festival: блок до конца боя, затем соло', async () => {
  const f = lootFixture(); await f.api.spoilStep(f.ctx, async () => 'unavail', f.mob);
  await f.api.spoilStep(f.ctx, f.act, f.mob); assert.deepEqual(f.calls, ['Spoil']);
});
test('обе роли отключены: спойл сам не включается', async () => {
  const f = lootFixture(); f.env.cfg.nSpoil = f.env.cfg.nSpoilMass = '';
  assert.equal(await f.api.spoilStep(f.ctx, f.act, f.mob), false); assert.equal(f.calls.length, 0);
});
test('РБ с запрещённым спойлом: нет действий', async () => {
  const f = lootFixture(); f.ctx.rb = {};
  assert.equal(await f.api.spoilStep(f.ctx, f.act, f.mob), false); assert.equal(f.calls.length, 0);
});
function combatFixture() {
  const atk = { title: 'Атака' }, weak = { title: 'Wild Sweep' }, strong = { title: 'Whirlwind' };
  const slots = [atk, weak, strong]; slots.forEach(b => b.getAttribute = () => null);
  const hp = { textContent: '2500 / 2500' }; let neighbors = [];
  const panel = { querySelectorAll: () => neighbors.map(x => ({ querySelector: s => s.includes('__icon') ? { alt: x.name } : { textContent: `${x.cur} / ${x.max}` } })) };
  const stats = { 'атака': { dmgN: 3, dmg: 3000 }, 'wild sweep': { dmgN: 3, dmg: 9000, cd: 1.1 }, whirlwind: { dmgN: 3, dmg: 18000, cd: 17 } };
  const env = {
    cfg: { nAttack: 'Атака', nPower: 'Wild Sweep, Whirlwind', nUltra: '', skillMpMin: 35, fightMode: 'dps', mageProbe: true },
    rt: { skills: stats }, names, SLOT: '.slot',
    $q: s => s === '#battle-mob-hp-val' ? hp : s === '#battle-whirlwind-extras' && neighbors.length ? panel : null,
    shown: b => !!b, isEquip: () => false, slotKind: b => b === atk ? 'атака' : 'скилл',
    slotAction: b => b.title.toLowerCase(), slotCd: () => null, battleSpawn: () => 'test', memLeft: () => 0,
    combatCooldown: { skillWait: () => 0 }, skKey: b => b.title.toLowerCase(), cleanTitle: s => s,
    combatProfileKind: () => 'fighter', ilOf: () => ({ t: 'PDAM', c: 'Физ. атака' }),
    expDmg: k => stats[k.toLowerCase()]?.dmg / (stats[k.toLowerCase()]?.dmgN || 1) || 0,
    forceNow: () => 0, forceMax: () => 0, forceCosts: () => [], longFightMp: () => null,
    isChargeName: () => false, isForceName: () => false,
    skillMp: n => /whirlwind/i.test(n) ? 40 : 16, mpPotSlot: () => ({}), qty: () => 100,
    actCost: o => o.cd || 0, meHp: () => ({ pct: 100 }), hpPotByDeficit: () => null
  };
  const api = load('combat', env, { document: { querySelectorAll: () => slots }, location: { search: '' } });
  const ctx = { block: {} }, mp = { cur: 600, max: 629 };
  return { env, api, ctx, mp, hp, stats, strong, weak, slots, near: xs => { neighbors = xs; }, pick: () => api.chooseAction(ctx, mp) };
}
test('ДПС: сильный Whirlwind раньше слабого Wild Sweep даже при добивании', () => {
  const f = combatFixture(); assert.equal(f.pick().name, 'Whirlwind');
});
test('ДПС: бесплатная атака не вытесняет готовый более сильный навык', () => {
  const f = combatFixture(); f.hp.textContent = '500 / 2500'; assert.equal(f.pick().name, 'Whirlwind');
});
test('по толстой цели выбирается сильнейший готовый', () => {
  const f = combatFixture(); f.hp.textContent = '20000 / 20000'; assert.equal(f.pick().name, 'Whirlwind');
});
for (const why of ['откат', 'мана', 'блок']) test('недоступная сильная атака: ' + why, () => {
  const f = combatFixture();
  if (why === 'откат') f.strong.disabled = true;
  if (why === 'мана') f.mp.cur = 39;
  if (why === 'блок') f.ctx.block['power:Whirlwind'] = Infinity;
  assert.equal(f.pick().name, 'Wild Sweep');
});
test('режим КПД сохраняет дешёвое добивание', () => {
  const f = combatFixture(); f.env.cfg.fightMode = 'kpd'; assert.equal(f.pick().name, 'Wild Sweep');
});
test('проба неизвестного слабого навыка не вытесняет известный сильный', () => {
  const f = combatFixture(); f.stats['wild sweep'] = { dmgN: 0, dmg: 0 }; f.hp.textContent = '20000 / 20000';
  f.env.expDmg = k => k === 'wild sweep' ? 1500 : k === 'whirlwind' ? 6000 : 1000;
  assert.equal(f.pick().name, 'Whirlwind');
});
test('при одинаковом полезном уроне группы сильный навык раньше слабого', () => {
  const f = combatFixture(); f.near([{ name: 'Side', cur: 1000, max: 1000 }]);
  for (const k of ['wild sweep', 'whirlwind']) Object.assign(f.stats[k], { aoe: 1, spl: 18000, splN: 3 });
  assert.equal(f.pick().name, 'Whirlwind');
});
test('выбор учитывает полезный урон по соседям, а не только главного', () => {
  const f = combatFixture(); f.near([{ name: 'Side', cur: 2000, max: 2000 }]);
  Object.assign(f.stats['wild sweep'], { aoe: 1, spl: 18000, splN: 3 });
  assert.equal(f.pick().name, 'Wild Sweep');
});
