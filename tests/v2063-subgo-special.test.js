'use strict';
// 20.63 (лог 25.10 17:10, смена Arcana Lord → Dreadnought 79): после Rebirth смена класса снимает в сумку всё, бот надел 11 вещей,
// а плащ/тату/пояс остались в сумке (John надел Cloak of Goddard, Тату озера Lv.5, Пояс досвідченого рибалки Lv.5 руками) и вместо
// +25 Намисто Валакаса (P.Atk +10 %) встало Намисто Фринтези (HP/M.Def). План теперь берёт плащ/тату/пояс по уровню улучшения
// и среди эпик-бижутерии сначала урон под класс.
const assert = require('node:assert/strict'), path = require('node:path');
require(path.join(__dirname, '..', 'modules/subgo.js'));
const G = globalThis.L2SubGear;
const lv = (a, b) => ({ levels: { 0: a, 5: b } });
const gear = (itemId, nameUk, slot, grade, extra = {}) => ({ itemId, nameUk, slot, grade, stats: {}, ...extra });
const C = {
 equipmentGradeMinCharLevel: { NG: 1, D: 20, C: 40, B: 52, A: 61, S: 76 },
 gearCatalog: [
  gear(9002282, 'Клановий штормер', 'rhand', 'S', { weaponType: 'pole', weaponMode: 'phys', blocksShield: true, stats: { pAtk: 396 } }),
  gear(6657, 'Намисто Валакаса', 'neck', 'S'), gear(8191, 'Намисто Фринтези', 'neck', 'S'), gear(924, 'Намисто цербера', 'neck', 'A'),
  gear(6656, 'Сережка Антараса', 'earring', 'S'), gear(6659, 'Сережка Закена', 'earring', 'S'),
  gear(6658, 'Кільце Баюма', 'ring', 'S'), gear(6660, 'Кільце Королеви Мурах', 'ring', 'B'),
  gear(910624, 'Татуювання озера', 'tattoo', 'C'), gear(920033, 'Тату Душі', 'tattoo', 'S'),
  gear(910629, 'Пояс досвідченого рибалки', 'belt', 'C'), gear(920018, 'Пояс першопрохідця', 'belt', 'D'),
  gear(920017, 'Cloak of Goddard Guardian', 'cloak', 'A'), gear(920019, 'Плащ Захисника Діона', 'cloak', 'C'),
 ],
 itemStatsHints: {
  6657: { jewelMdefFlat: 495, jewelMaxHp: 2445, epicExtraLinesUk: [{ labelUk: 'P.Atk', valueUk: '+10%' }, { labelUk: 'M.Atk', valueUk: '+15%' }, { labelUk: 'Шанс маг. криту', valueUk: '+30%' }, { labelUk: 'Відкат скілів', valueUk: '-10%' }] },
  8191: { jewelMdefFlat: 695, jewelMaxHp: 4000, pDef: 300, epicExtraLinesUk: [{ labelUk: 'Відкат скілів', valueUk: '-10%' }, { labelUk: 'Швидкість касту', valueUk: '+8%' }, { labelUk: 'Швидкість атаки', valueUk: '+8%' }] },
  924: { jewelMdefFlat: 180, jewelMaxHp: 110 },
  6656: { jewelMdefFlat: 471, epicExtraLinesUk: [{ labelUk: 'Шанс криту', valueUk: '+60' }] },
  6659: { jewelMdefFlat: 281, epicExtraLinesUk: [{ labelUk: 'Швидкість атаки', valueUk: '+6%' }, { labelUk: 'Дод. крит', valueUk: '+40' }] },
  6658: { jewelMdefFlat: 348, epicExtraLinesUk: [{ labelUk: 'Крит. шкода', valueUk: '+65%' }] },
  6660: { jewelMdefFlat: 180, epicExtraLinesUk: [{ labelUk: 'Крит. шкода', valueUk: '+45%' }] },
 },
 specialGearUpgradeHints: { maxLevel: 5, byItemId: {
  910624: lv({ equipFlatPAtk: 250, equipFlatMAtk: 288, equipAttackSpeedPct: 2 }, { equipFlatPAtk: 563, equipFlatMAtk: 648, equipOutgoingPhysicalSkillDamagePct: 10, equipOutgoingMagicalSkillDamagePct: 10, equipAttackSpeedPct: 3.4 }),
  920033: lv({ equipFlatPAtk: 850, equipFlatMAtk: 978, equipAttackSpeedPct: 2 }, { equipFlatPAtk: 1913, equipFlatMAtk: 2201, equipOutgoingPhysicalSkillDamagePct: 10, equipOutgoingMagicalSkillDamagePct: 10, equipAttackSpeedPct: 3.4 }),
  910629: lv({ equipFlatMaxHp: 450, equipPhysicalCritDamagePct: 3 }, { equipFlatMaxHp: 765, equipPhysicalCritDamagePct: 6.75 }),
  920018: lv({ equipFlatMaxHp: 200, equipPhysicalCritDamagePct: 2 }, { equipFlatMaxHp: 340, equipPhysicalCritDamagePct: 4.5 }),
  920017: lv({ cloakMaxHp: 1100, cloakPDefFlat: 260, cloakMDefFlat: 260 }, { cloakMaxHp: 1870, cloakPDefFlat: 442, cloakMDefFlat: 442 }),
  920019: lv({ cloakMaxHp: 350, cloakPDefFlat: 90, cloakMDefFlat: 90 }, { cloakMaxHp: 595, cloakPDefFlat: 153, cloakMDefFlat: 153 }),
 } },
};
// Dreadnought 79 сразу после смены: всё в сумке (как в логе 17:10)
const bag = [
 { itemId: 9002282, qty: 1, enchant: 25, clanWeaponUid: 'w1' }, { itemId: 6657, qty: 1, enchant: 25 }, { itemId: 8191, qty: 1 }, { itemId: 924, qty: 1 },
 { itemId: 6656, qty: 1 }, { itemId: 6659, qty: 1 }, { itemId: 6658, qty: 1 }, { itemId: 6660, qty: 1, enchant: 12 },
 { itemId: 910624, qty: 1, specialGearLevel: 5 }, { itemId: 920033, qty: 1, specialGearLevel: 0 },
 { itemId: 910629, qty: 1, specialGearLevel: 5 }, { itemId: 920018, qty: 1, specialGearLevel: 5 },
 { itemId: 920017, qty: 1, specialGearLevel: 0 }, { itemId: 920019, qty: 1, specialGearLevel: 5 },
];
const hero = (eq = {}, stacks = bag) => ({ level: 79, l2Profession: 'human_dreadnought', revision: 1, inventory: { eq, stacks: JSON.parse(JSON.stringify(stacks)) } });

// 1. плащ/тату/пояс выбираются и надеваются; токен с уровнем улучшения — как у кнопки игры
{ const h = hero(), P = G.planGear(h, C);
  assert.equal(P.slots.l1.id, 9002282);
  assert.equal(P.slots.tattoo.id, 910624, 'Тату озера Lv.5 (563 + умения +10 %) выше Тату Душі Lv.0 (850)');
  assert.equal(P.slots.belt.id, 910629, 'пояс рыбака C Lv.5 (сила крита 6,75 %) выше першопрохідця D Lv.5');
  assert.equal(P.slots.cloak.id, 920017, 'Goddard A Lv.0 выше Діона C Lv.5');
  assert.equal(P.slots.tattoo.token, 'bag:910624:0:u5'); assert.equal(P.slots.cloak.token, 'bag:920017:0:u0');
  const ops = G.diff(h, P), eqd = ops.filter(o => o.op === 'equip').map(o => o.it.id);
  for (const id of [910624, 910629, 920017]) assert.ok(eqd.includes(id), 'надевается ' + id);
  assert.deepEqual(G.body(ops.find(o => o.it?.id === 920017), 7), { action: 'equip', itemId: 920017, enchant: 0, targetInstanceId: 'bag:920017:0:u0', expectedRevision: 7 });
}
// 2. бижутерия воина: Валакас +25 (P.Atk +10 %) выше Фринтези; кольца Баюм + QA, серьги — обе эпик
{ const P = G.planGear(hero(), C);
  assert.equal(P.slots.neck.id, 6657); assert.equal(P.slots.neck.token, 'bag:6657:25');
  assert.deepEqual([P.slots.lr1.id, P.slots.lr2.id], [6658, 6660]);
  assert.deepEqual([P.slots.le1.id, P.slots.le2.id].sort(), [6656, 6659]);
}
// 3. маг: Валакас тоже (M.Atk +15 %, маг. крит), тату — по M.Atk
{ const h = hero(); h.l2Profession = 'human_arcana_lord';
  const P = G.planGear(h, C); assert.equal(P.slots.neck.id, 6657); assert.equal(P.slots.tattoo.id, 910624);
}
// 4. уже надето то же с тем же уровнем — ничего не меняем; надет тот же плащ, но Lv.0 вместо Lv.5 в сумке — меняем
{ const eq = { tattoo: { itemId: 910624, specialGearLevel: 5 }, belt: { itemId: 910629, specialGearLevel: 5 }, cloak: { itemId: 920017, specialGearLevel: 0 } };
  const left = bag.filter(r => ![910624, 910629, 920017].includes(r.itemId));
  const h = hero(eq, left), ops = G.diff(h, G.planGear(h, C));
  assert.ok(!ops.some(o => ['tattoo', 'belt', 'cloak'].includes(o.slot)), 'надетое не трогаем: ' + JSON.stringify(ops.map(o => o.slot)));
  const h2 = hero({ tattoo: { itemId: 920033, specialGearLevel: 0 } }, bag.filter(r => r.itemId !== 920033));
  const P2 = G.planGear(h2, C); assert.equal(P2.slots.tattoo.id, 910624);
  assert.ok(G.diff(h2, P2).some(o => o.slot === 'tattoo' && o.it.id === 910624));
}
// 5. Тату Душі Lv.5 — лучше всех
{ const s = bag.map(r => r.itemId === 920033 ? { ...r, specialGearLevel: 5 } : r);
  assert.equal(G.planGear(hero({}, s), C).slots.tattoo.id, 920033);
}
// 6. каталог без specialGearUpgradeHints и без плаща в gearCatalog — прежнее поведение (слоты пусты, ничего не надеваем)
{ const C0 = { ...C, specialGearUpgradeHints: undefined, gearCatalog: C.gearCatalog.filter(g => !['tattoo', 'belt', 'cloak'].includes(g.slot)) };
  const P = G.planGear(hero(), C0); assert.equal(P.slots.cloak, null);
  assert.ok(!G.diff(hero(), P).some(o => ['tattoo', 'belt', 'cloak'].includes(o.slot)));
}
// 7. место в сумке: при смене класса снимутся и плащ/тату/пояс
{ const h = hero({ l1: { itemId: 9002282, enchant: 25, clanWeaponUid: 'w1' }, cloak: 920019, tattoo: { itemId: 910624, specialGearLevel: 5 }, belt: { itemId: 910629, specialGearLevel: 5 } }, []);
  h.inventoryCapacity = { maxSlots: 10, usedSlots: 8 };
  assert.deepEqual(G.bagRoom(h), { free: 2, need: 4, ok: false });
}
console.log('v2063-subgo-special: OK');
