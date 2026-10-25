'use strict';
// 20.62 (анонс Rebirth 25.10, тред «Подготовить бота к Rebirth»): защиты бота от новых правил игры.
// 1) смена саба снимает всё надетое в сумку и блокируется без места — проверяем место до телепорта;
// 2) надетое оружие/щит Rebirth (сила на экземпляре) не меняем на старое по грейду; 3) автозаточка не берёт вещи Rebirth.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
require(path.join(__dirname, '..', 'modules/subgo.js'));
require(path.join(__dirname, '..', 'modules/equipment.js'));
const G = globalThis.L2SubGear;
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/subgo-2026-10-21.json'), 'utf8'));
const C = F.catalog, clone = o => JSON.parse(JSON.stringify(o));

// 1. признак перерождённой вещи
assert.equal(G.isRebirth({ itemId: 1, rebirthWeaponAttack: 120 }), true);
assert.equal(G.isRebirth({ itemId: 1, rebirthShieldPoints: 5 }), true);
assert.equal(G.isRebirth({ itemId: 1, rebirthAffixes: [{ k: 'crit' }] }), true);
assert.equal(G.isRebirth({ itemId: 1, enchant: 4 }), false);

// 2. место в сумке под снятые при смене класса вещи
{ const ch = clone(F.ws0), worn = Object.keys(ch.inventory.eq).length;
  assert.equal(G.bagRoom(ch), null, 'без inventoryCapacity не мешаем');
  ch.inventoryCapacity = { usedSlots: 200, maxSlots: 200 };
  const R = G.bagRoom(ch);
  assert.equal(R.ok, false); assert.equal(R.free, 0); assert.ok(R.need > 0 && R.need <= worn, JSON.stringify(R));
  ch.inventoryCapacity = { usedSlots: 200 - R.need, maxSlots: 200 };
  assert.equal(G.bagRoom(ch).ok, true, 'ровно хватает');
  // кольцо, такое же как простая стопка в сумке, места не занимает
  const e = { inventory: { eq: { lr1: { itemId: 884, enchant: 0 } }, stacks: [{ itemId: 884, enchant: 0, qty: 1 }] }, inventoryCapacity: { usedSlots: 50, maxSlots: 50 } };
  assert.deepEqual(G.bagRoom(e), { free: 0, need: 0, ok: true });
}

// 3. надетое оружие Rebirth не меняется на более высокий грейд из сумки
{ const ch = clone(F.ws0), l1 = ch.inventory.eq.l1, row = typeof l1 === 'object' ? l1 : { itemId: l1, enchant: 0 };
  const base = G.planGear(ch, C, { wt: ['pole', 'blunt'], shield: false });
  ch.inventory.eq.l1 = { ...row, rebirthWeaponAttack: 777 };
  // в сумке лежит другое оружие того же вида — без защиты план мог бы его выбрать
  const P = G.planGear(ch, C, { wt: ['blunt', 'pole'], shield: false });
  assert.equal(P.slots.l1.where, 'l1', 'перерождённое оружие остаётся надетым');
  assert.ok(P.why.includes('перерождённое оружие оставляю'));
  assert.ok(!G.diff(ch, P).some(o => o.slot === 'l1'), 'никаких действий с оружием');
  assert.ok(base.slots.l1, 'контроль: обычный план находит оружие');
}

// 4. шаг смены класса: сумка полна — ни телепорта, ни switch, понятная причина
(async () => {
  const W = clone(F.ws0); W.classSlots.activeSlot = 2; W.inventoryCapacity = { usedSlots: 199, maxSlots: 200 };
  const posts = [], res = (status, j) => ({ ok: status >= 200 && status < 300, status, json: async () => j });
  const env = { cfg: {}, rt: { char: 'Hero', subGo: { t: Date.now(), slot: 1 } }, on: true, tabOwner: true,
    isBattle: () => false, sleep: async () => {}, setStatus: () => {}, rec: () => {}, rtCommit: async () => true,
    setRt: async p => { Object.assign(env.rt, p); return { ok: true }; },
    gameGet: async p => p === '/character' ? res(200, { character: clone(W) }) : p === '/character/subclasses' ? res(200, { classes: { nearClassMaster: false } }) : res(404, {}),
    gamePost: async (p, b) => { posts.push([p, b]); return res(500, {}); } };
  const M = globalThis.L2V7Factories.subgo(env);
  assert.equal(await M.step(), true);
  assert.equal(posts.length, 0, 'ничего не отправлено');
  assert.equal(env.rt.subGo, null); assert.equal(env.rt.subGoSay.ok, false);
  assert.match(env.rt.subGoSay.why, /в сумке свободно 1 мест.*освободите/);
  // отказ игры при смене — подсказка про место
  W.inventoryCapacity = null; env.rt.subGo = { t: Date.now(), slot: 1 };
  env.gameGet = async p => p === '/character' ? res(200, { character: clone(W) }) : p === '/character/subclasses' ? res(200, { classes: { nearClassMaster: true } }) : res(404, {});
  env.gamePost = async (p, b) => { posts.push([p, b]); return res(400, { error: 'inventory_full', messageRu: 'Недостатньо місця в інвентарі' }); };
  assert.equal(await M.step(), true);
  assert.equal(posts[0][0], '/character/subclasses/switch');
  assert.match(env.rt.subGoSay.why, /не хватает места/);

  // 5. equipment: перерождённое оружие не выбирается «в класс» и надетое такое не снимается
  const E = globalThis.L2V7Factories.equipment({ rt: { classCur: { prof: 'warlord' } }, cfg: {}, MAGE: 'маг', CLASS_W: { warlord: ['древковое'] },
    normalizeProfession: p => p, combatProfileKind: () => 'fighter', heroLevel: () => 78, GRADE_LV: { NG: 0, D: 20, C: 40, B: 52, A: 61, S: 76 }, itemOf: () => null });
  assert.equal(E.isRebirthRow({ rebirthWeaponAttack: 3 }), true); assert.equal(E.isRebirthRow({ enchant: 3 }), false);
  const R = E.rankWeapons([{ id: 1, name: 'Rebirth Pole', wt: 'древковое', g: 'A', pa: null, ma: null, rebirth: true, unknown: true, where: 'надето' },
    { id: 2, name: 'Old S Pole', wt: 'древковое', g: 'S', pa: 400, ma: 100, where: 'сумка' }]);
  assert.equal(R.main.id, 2, 'рекомендация — известное оружие; надетое Rebirth удерживается флагом unknown');

  // 6. автозаточка: вещь Rebirth в выбор не попадает (по исходнику — фильтр в snapshotItems)
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules/enchant.js'), 'utf8');
  assert.match(src, /rebirthWeaponAttack>0\|\|\+v\.rebirthShieldPoints>0\|\|v\.rebirthAffixes\)\)return;/);
  console.log('v2062-rebirth-guards PASS');
})().catch(e => { console.error(e); process.exit(1); });
