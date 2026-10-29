'use strict';
// 20.82 (John 30.10: «старайся убивать в подземелье мобов масс-магией»; лог 29.10 16:55 Rebirth Windsus 13 543 HP):
// «Удар полум’я» в подземелье бьёт двоих невидимых соседей (extras []), их рана остаётся до следующего боя.
const test = require('node:test'), assert = require('node:assert/strict');
const { flowFixture } = require('./warlock-combat-fixture.cjs');
const MOB = 13543;
function setup({ model = { n: 3, kills: 0, targets: 2, damage: 8310 }, search = '?spawnId=rebirth_raid_x_1_1_25082_lv39_mob_25' } = {}) {
  const f = flowFixture('mage'), e = f.env, flame = { title: 'Flame Strike', getAttribute: () => null };
  f.slots.push(flame); f.hp.textContent = `${MOB} / ${MOB}`; e.cfg.mageProbe = false; f.location.search = search;
  e.cfg.nPower = 'Blaze|Flame Strike|Vampiric Touch'; e.combatProfileKind = () => 'mage';
  e.isChargeName = () => false; e.isForceName = () => false;
  e.rt.skills.blaze = { dmg: 10000 * 5, dmgN: 5 };
  e.rt.skills['flame strike'] = { dmg: 8310 * 5, dmgN: 5, aoe: 1, spl: 16620 * 5, splN: 5 };
  e.expDmg = k => k === 'атака' ? 1 : (e.rt.skills[k.toLowerCase()]?.dmg || 0) / (e.rt.skills[k.toLowerCase()]?.dmgN || 1);
  e.skillMp = n => /flame/i.test(n) ? 40 : 30; e.ilOf = () => ({ c: 'Маг. атака', t: 'MDAM', mp: 40 });
  e.fightGroupOn = name => /flame/i.test(name) ? model : null;
  return { ...f, flame, pick: (ctx = {}) => f.combat.chooseAction({ block: {}, ...ctx }, { cur: 1100, max: 1850 }) };
}
const mob = { rebirth: { role: 'mob', current: () => true } };
test('Rebirth: полный моб — сначала АОЕ по невидимым соседям, а не Blaze', () => {
  const a = setup().pick(mob);
  assert.equal(a.name, 'Flame Strike'); assert.equal(a.group, true); assert.match(a.why, /подземелье: АОЕ по соседям/);
  assert.equal(a.useful, 8310 * 3);
});
test('катакомбы (sdms_) по той же модели тоже бьют АОЕ', () => {
  assert.equal(setup({ search: '?spawnId=sdms_martyrdom_020' }).pick().name, 'Flame Strike');
});
test('обычная карта без видимых соседей: прежний одиночный удар', () => {
  assert.equal(setup({ search: '?spawnId=first-mob' }).pick().name, 'Blaze');
});
test('модель без соседей (targets 0) не выдумывает выгоду', () => {
  assert.equal(setup({ model: { n: 3, kills: 0, targets: 0, damage: 0 } }).pick(mob).name, 'Blaze');
});
test('чемпион, РБ и босс Rebirth основной целью — АОЕ их не цепляет, одиночный удар', () => {
  assert.equal(setup().pick({ rebirth: { role: 'champion', current: () => true } }).name, 'Blaze');
  assert.equal(setup().pick({ rebirth: { role: 'raid', current: () => true } }).name, 'Blaze');
  assert.equal(setup({ search: '?spawnId=sdms_martyrdom_020' }).pick({ champ: true }).name, 'Blaze');
});
test('нет свежей модели в подземелье — одна проба АОЕ, даже если основной моб не добивается', () => {
  const a = setup({ model: null }).pick(mob);
  assert.equal(a.name, 'Flame Strike'); assert.equal(a.probe, true); assert.match(a.why, /сколько соседей задевает/);
});
test('АОЕ на откате — не ждём, бьём готовым одиночным', () => {
  const f = setup(); f.env.memLeft = b => b === f.flame ? 10 : 0;
  assert.equal(f.pick(mob).name, 'Blaze');
});
