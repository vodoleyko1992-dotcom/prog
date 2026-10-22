'use strict';
// 20.46 (John 22.10: голема держим и на мобах/в катах; потеря EXP принята игроком).
const test = require('node:test'), assert = require('node:assert/strict');
const { POLE, YAKSA, KNIGHT, CRYSTAL, hero, make, eqOf } = require('./kit-harness.cjs');
const { flowFixture } = require('./warlock-combat-fixture.cjs');
const pet = () => ({ key: 'mechanic_golem', hp: 10, maxHp: 2400, summonSkillId: 25 });
const requests = A => A.S.posts.map(([p]) => p);
function equipped() {
  const h = hero(); h.activeSummon = pet();
  h.inventory.eq = { l1: { itemId: YAKSA, enchant: 4, enchantPAtkBonus: 16, enchantMAtkBonus: 0 }, l2: { itemId: KNIGHT } };
  h.inventory.stacks = [{ itemId: POLE, qty: 1 }, { itemId: CRYSTAL, qty: 40 }]; return h;
}
test('после РБ пика заменяет булаву и щит, а живой голем остаётся без расхода кристаллов', async () => {
  const A = make({ mode: 'farm', hero: equipped() }); await A.drive(12);
  assert.deepEqual(eqOf(A.S), [POLE, 0, 'mechanic_golem']);
  assert.deepEqual(A.S.posts.map(([p, b]) => [p, b.action, b.slot || b.itemId]), [
    ['/character/equip', 'unequip', 'l2'], ['/character/equip', 'equip', POLE]
  ]);
  assert.equal(A.S.h.inventory.stacks.find(x => x.itemId === CRYSTAL).qty, 40);
  assert.equal(A.S.h.activeSummon.hp, 10, 'малое HP не означает разрешения отзывать слугу');
});
test('фарм, катакомбы, кампания и ресурсная охота сохраняют голема при любом petAuto', async () => {
  for (const mode of ['farm', 'cat', 'campaign', 'tasks']) for (const petAuto of [true, false]) {
    const A = make({ mode, cfg: { petAuto, champRed: false }, hero: equipped() });
    if (mode === 'tasks') A.M.loot = true;
    await A.drive(12);
    assert.equal(A.S.h.activeSummon?.key, 'mechanic_golem', `${mode}, petAuto=${petAuto}`);
    assert.equal(requests(A).some(x => /dismiss|cast|buffer|shop/.test(x)), false);
    assert.equal(A.env.cfg.petAuto, petAuto); assert.equal(A.env.cfg.champRed, false);
  }
});
test('готовая пика с големом не прерывает цепочку даже после часа фарма', async () => {
  const A = make({ mode: 'cat', hero: { activeSummon: pet() } });
  A.M.pet = 'mechanic_golem'; A.M.weapon = { id: POLE, wt: 'древковое', g: 'C' };
  await A.drive(3);
  for (let i = 0; i < 72; i++) {
    A.clock.now += 60000; assert.equal(A.K.chainWant(), false, `минута ${i + 1}`);
  }
  assert.deepEqual(requests(A), []);
});
test('тур РБ → фарм сохраняет уже призванного слугу и прежние правила выбора пики', async () => {
  const A = make({ mode: 'raid' }); await A.drive(14);
  assert.deepEqual(eqOf(A.S), [YAKSA, KNIGHT, 'mechanic_golem']);
  const n = A.S.posts.length; A.M.mode = 'farm'; await A.drive(14);
  assert.deepEqual(eqOf(A.S), [POLE, 0, 'mechanic_golem']);
  assert.ok(A.S.posts.slice(n).every(([p]) => p === '/character/equip'));
});
test('набор не запрещает бою призыв/перепризыв на мобах и в катах: настройки проверяет petStep', () => {
  for (const mode of ['farm', 'cat', 'raid']) {
    const A = make({ mode }); assert.equal(A.K.noSummon(false), false, mode);
  }
});
test('новое разрешение не создаёт кристаллы или платный бафф и не включает выключенные настройки', async () => {
  const A = make({ mode: 'farm', cfg: { petAuto: false, petResummon: false, petFullAuto: false, champRed: false }, hero: { activeSummon: null } });
  const before = JSON.stringify(A.env.cfg); A.env.shopRow = (id, mm) => ({ key: 'mm' + id, mm });
  await A.drive(12); assert.equal(A.S.posts.length, 0); assert.deepEqual(A.K.shopRows([]), []);
  assert.equal(A.S.h.activeSummon, null); assert.equal(JSON.stringify(A.env.cfg), before);
});
test('проверка оружия по-прежнему может прервать цепочку, но голем не является причиной', async () => {
  const A = make({ mode: 'farm', hero: { activeSummon: pet() }, weapons: [{ id: POLE, wt: 'древковое', g: 'C', where: 'сумка' }] });
  A.M.pet = 'mechanic_golem'; A.M.weapon = { id: POLE, wt: 'древковое', g: 'C' };
  await A.drive(3); A.clock.now += 11 * 60000;
  assert.equal(A.K.chainWant(), false);
  A.M.weapon = { id: YAKSA, wt: 'дубина', g: 'C' }; A.env.rt.weaponsT = 2;
  assert.equal(A.K.chainWant(), true, 'реально нужна пика — прежнее правило сохранено');
});
test('выключенный набор, Стоп, чужая вкладка и бой не начинают переодевание', async () => {
  for (const state of ['off', 'stop', 'lease', 'battle']) {
    const A = make({ mode: 'farm', hero: equipped() });
    if (state === 'off') A.env.cfg.crafterKit = false;
    if (state === 'stop') A.env.on = false;
    if (state === 'lease') A.env.tabOwner = false;
    if (state === 'battle') A.M.battle = true;
    assert.equal(await A.K.step(), false); assert.equal(A.S.posts.length, 0); assert.equal(A.S.h.activeSummon.key, 'mechanic_golem');
  }
});
// Настоящий combat.battle → petStep, родная кнопка голема и серверная модель старого сквозного fixture.
// Это проверка исполнения существующего petStep, а не только булева noSummon; запасы/оплата кристаллов — сервер игры.
for (const mode of ['farm', 'cat']) for (const gate of ['on', 'off', 'mp', 'cd']) test(`бой ${mode}: призыв голема, ограничение ${gate}`, async () => {
  const f = flowFixture('pet'), A = make({ mode }); f.summon.title = 'Summon Mechanic Golem';
  let P = { t: Date.now(), has: false };
  f.env.petState = () => P; f.env.crafterKit = A.K; f.env.autonomyMode = () => mode;
  const action = f.env.slotAction, fire = f.env.fire;
  f.env.slotAction = b => b === f.summon ? 'l2_25' : action(b);
  f.env.fire = b => { const r = fire(b); if (b === f.summon) P = { t: Date.now() + 1, has: true, key: 'mechanic_golem', hp: 1000, maxHp: 1000 }; return r; };
  if (gate === 'off') f.env.cfg.petAuto = false;
  if (gate === 'mp') { const cost = f.env.skillMp; f.env.skillMp = s => /Mechanic Golem/.test(s) ? 99999 : cost(s); }
  if (gate === 'cd') f.env.combatCooldown.skillWait = a => a === 'l2_25' ? 5000 : 0;
  await f.combat.battle();
  assert.equal(f.events.filter(x => x === 'Summon Mechanic Golem').length, gate === 'on' ? 1 : 0);
});
