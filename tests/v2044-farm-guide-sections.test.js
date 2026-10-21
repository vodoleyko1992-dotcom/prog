'use strict';
// 20.44 (форум «Фарм ресурсов» обновлён 21.10, ответ GET /game/farm-guide 21.10 22:48 — kb/data/game-farm-guide.json):
// кроме resources[] игра отдаёт rareResources[] и gradePieces[] в том же формате sources[] — бот кладёт их в FARM.res со своим разделом,
// чтобы у редкого сырья рецептов (Mold Lubricant, Enria…) и у частей экипировки D–S появились точки фарма; меню ставит разделы по порядку игры.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const content = read('content.js'), pjs = read('popup.js');
const cut = (re, tag) => { const m = content.match(re); assert.ok(m, 'вырезка ' + tag); return m[0]; };
const src = cut(/function farmGuideMerge\(db, data\) \{[\s\S]*?\n\}\n/, 'farmGuideMerge');
const merge = vm.runInNewContext(`(() => { ${src}; return farmGuideMerge; })()`, { Math, Date, Array, String, Object });

// 1. все три раздела из настоящего ответа игры
const guide = JSON.parse(read('kb/raw/farm-guide.json')).data;
assert.ok(guide.rareResources.length >= 8 && guide.gradePieces.length >= 15, 'в снимке есть новые разделы');
const db = { res: { 'enria': { name: 'Enria', drop: [], sp: [], cat: 'Прочее › Старое', icon: '/icons/old.png' } } };
const m = merge(db, guide);
assert.equal(m.n, guide.resources.length + guide.rareResources.length + guide.gradePieces.length, 'прочитаны все строки трёх разделов');
const st = db.res['stem'], lub = db.res['mold lubricant'], wp = db.res['weapon piece s'];
assert.ok(st.cat === 'Ресурсы' && st.drop.length > 600 && st.sp.length > 600, 'базовый ресурс: дроп и спойл');
assert.ok(st.sp.some(x => x[1] >= 40 && x[2] === 60), 'спойл Stem с мобов 40+ — 60 % (обновление 21.10)');
assert.equal(lub.cat, 'Редкие материалы'); assert.equal(lub.id, 4040);
assert.ok(lub.drop.length >= 3 && lub.drop.every(x => x[1] >= 70 && x[5]), 'Mold Lubricant: дроп с мобов 77+ и телепорт района');
assert.equal(wp.cat, 'Части экипировки D–S'); assert.ok(wp.drop.length > 0 && wp.sp.length === 0, 'части экипировки — только дроп');
assert.ok(db.res['enria'].cat === 'Прочее › Старое' && db.res['enria'].icon === '/icons/old.png' && db.res['enria'].drop.length > 0, 'прежние раздел/картинка не стираются');
assert.ok(db.res['maestro anvil lock'] && db.res['maestro anvil lock'].drop.length === 0, 'без источников — строка без точек');

// 2. старый ответ без новых разделов читается как раньше
{ const d2 = { res: {} }; const m2 = merge(d2, { resources: guide.resources.slice(0, 2) }); assert.equal(m2.n, 2); assert.equal(Object.keys(d2.res).length, 2); }
{ const d3 = { res: {} }; assert.equal(merge(d3, null).n, 0, 'пустой ответ'); }

// 3. меню: новые разделы сразу после «Ресурсы», до «Кейматы»
{ const a = pjs.indexOf('const TREE_ORDER'), b = pjs.indexOf('\n', pjs.indexOf('const treeRank'));
  const ps = {}; vm.runInNewContext(pjs.slice(a, b).replace(/^const (\w+) =/gm, 'globalThis.$1 ='), ps);
  const top = ['Кейматы', 'Части экипировки D–S', 'Прочее', 'Редкие материалы', 'Ресурсы', 'Шмот с РБ'].sort((x, y) => (ps.treeRank(x) - ps.treeRank(y)) || x.localeCompare(y));
  assert.equal(JSON.stringify(top), JSON.stringify(['Ресурсы', 'Редкие материалы', 'Части экипировки D–S', 'Кейматы', 'Шмот с РБ', 'Прочее'])); }

// 4. рецепты и магазин из ответа совпадают со встроенными в mammon.js (MM_RECIPES / MM_SHOP)
{ const mm = read('modules/mammon.js');
  for (const r of guide.craftedResources) {
    const line = mm.match(new RegExp(`\\b${r.itemId}: \\[(\\d+), \\[(.*?\\])\\]\\]`));
    assert.ok(line, 'рецепт в MM_RECIPES: ' + r.nameEn);
    assert.equal(+line[1], r.outputQuantity, 'выход ' + r.nameEn);
    for (const i of r.ingredients) assert.ok(line[2].includes(`'${i.nameEn.replace(/'/g, "\\'")}', ${i.quantity}]`) || line[2].includes(`"${i.nameEn}", ${i.quantity}]`), `${r.nameEn}: ${i.nameEn} ×${i.quantity}`);
  }
  for (const s of guide.shopMaterials) assert.match(mm, new RegExp(`${s.itemId}: \\['${s.grade}', ${s.priceAdena}\\]`), 'цена магазина ' + s.nameEn); }
console.log('PASS: farm-guide 21.10 — редкие материалы и части экипировки в базе фарма, рецепты и цены магазина совпадают');
