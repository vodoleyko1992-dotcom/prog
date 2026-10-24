'use strict';
// 20.60 (лог 24.10 22:10, John: «есть АК кольцо, оно ЛУЧШЕ, не одивает сам»): при смене саба план комплекта ставил
// Кільце фантому A выше Ring of Queen Ant +12 (B, эпик) — грейд сравнивался первым. Эпическая бижутерия идёт первой.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
require(path.join(__dirname, '..', 'modules/subgo.js'));
const G = globalThis.L2SubGear;
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/subgo-2026-10-21.json'), 'utf8'));
const clone = o => JSON.parse(JSON.stringify(o));
const QA = 6660, PHANTOM = 899, PHOENIX = 6325, BAIUM = 6658;
const cat = (epicLines = true) => { const C = clone(F.catalog);
 C.gearCatalog.push({ itemId: QA, nameUk: 'Кільце Королеви Мурах', slot: 'ring', grade: 'B', jewelryKind: 'ring', stats: {} });
 C.itemStatsHints[String(QA)] = { jewelMdefFlat: 76, grade: 'B', ...(epicLines ? { epicExtraLinesUk: [{ labelUk: 'Точність', valueUk: '+2' }, { labelUk: 'Шанс криту', valueUk: '+30' }] } : {}) };
 return C; };
// Fortune Seeker 76: надеты QA +12 и обычное C-кольцо, в сумке Кільце фантому A и Запечатане кільце фенікса A (без Баюма)
const hero = (baium = false) => { const h = clone(F.fs);
 h.inventory.eq.lr1 = { itemId: QA, enchant: 12 }; h.inventory.eq.lr2 = 884;
 h.inventory.stacks = h.inventory.stacks.filter(r => baium || r.itemId !== BAIUM);
 if (!h.inventory.stacks.some(r => r.itemId === PHANTOM)) h.inventory.stacks.push({ itemId: PHANTOM, qty: 1 });
 return h; };
const rings = P => [P.slots.lr1?.id, P.slots.lr2?.id];

// 1. QA +12 остаётся, лучшее A (Фенікс: M.Def 135 против 122 у Фантома) занимает второе кольцо вместо C
{ const h = hero(), P = G.planGear(h, cat());
  assert.deepEqual(rings(P), [QA, PHOENIX], 'эпик первым, затем грейд');
  const ops = G.diff(h, P);
  assert.ok(!ops.some(o => o.op === 'unequip' && o.slot === 'lr1'), 'QA не снимается');
  assert.ok(!ops.some(o => o.op === 'equip' && o.it?.id === QA), 'QA уже надето — повторно не надеваем');
  assert.ok(ops.some(o => o.op === 'equip' && o.it?.id === PHOENIX), 'A-кольцо вместо C');
}
// 2. каталог без строк эпика — эпик узнаём по ID
{ const P = G.planGear(hero(), cat(false));
  assert.deepEqual(rings(P), [QA, PHOENIX]);
}
// 3. два эпика: Баюм S и QA B — оба, обычное A не надевается
{ const P = G.planGear(hero(true), cat());
  assert.deepEqual(rings(P), [BAIUM, QA]);
}
// 4. QA в сумке, а надет Фантом — план надевает QA
{ const h = hero(); h.inventory.eq.lr1 = PHANTOM; h.inventory.eq.lr2 = 884;
  h.inventory.stacks = h.inventory.stacks.filter(r => r.itemId !== PHANTOM).concat([{ itemId: QA, qty: 1, enchant: 12 }]);
  const P = G.planGear(h, cat());
  assert.deepEqual(rings(P), [QA, PHOENIX]);
  assert.equal(P.slots.lr1.token, 'bag:6660:12');
  assert.ok(G.diff(h, P).some(o => o.op === 'equip' && o.it?.id === QA), 'QA из сумки надевается');
}
// 5. серьги и ожерелье — тот же порядок (Fortune Seeker 76 из снимка 21.10 — эпики Orfen/Core и Frintezza)
{ const P = G.planGear(F.fs, F.catalog);
  assert.deepEqual([P.slots.le1.id, P.slots.le2.id].sort(), [6656, 6659]); assert.equal(P.slots.neck.id, 8191);
}
console.log('v2060-epic-ring: OK');
