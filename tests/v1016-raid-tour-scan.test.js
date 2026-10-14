'use strict';
// 14.10: перечитывание после отказа на странице N не должно удалять более низкие уровни.
const test = require('node:test'), assert = require('node:assert/strict');
const { mk, docOf } = require('./epic-harness.cjs');
function row(id, lvl) {
 return `<div class="l2-rb-row"><span class="l2-rb-row__label">РБ ${lvl}</span><span class="l2-rb-row__level">${lvl}</span><span class="l2-rb-row__status l2-rb-row__status--alive">Жив</span><span class="l2-rb-row__price">100000 аден</span><button class="l2-rb-row__tp" data-spawn-id="${id}">Телепорт</button></div>`;
}
function page(n, last) { return docOf(`<div id="rb-pager-ind">${n} / 2</div><div id="rb-list">${row(n === 1 ? 'lower' : 'upper', n === 1 ? 50 : 60)}</div><button id="rb-pager-next"${last ? ' disabled' : ''}>Дальше</button>`); }
test('неполный хвост списка с последней страницы возвращает к первой и сохраняет младших', async () => {
 const m = mk({ path: '/rb-bosses.html', search: '?page=2', doc: page(2, true), rt: { rbListT: 0, rbList: { lower: { name: 'Младший', lvl: 50, alive: true, page: 1 } } } });
 await m.R.rbListScan(); assert.ok(m.env.rt.rbList.lower); assert.equal(m.env.rt.rbListT, 0); assert.equal(m.loc.href, '/rb-bosses.html?page=1'); assert.equal(m.fires.length, 0);
});
test('полное чтение от первой страницы сохраняет оба уровня', async () => {
 const m = mk({ path: '/rb-bosses.html', search: '?page=1', doc: page(1, false), rt: { rbListT: 0, rbList: {} }, env: { rnd: () => 0 } });
 m.env.fire = () => { m.setDoc(page(2, true)); return true; }; await m.R.rbListScan();
 assert.deepEqual(Object.keys(m.env.rt.rbList), ['lower', 'upper']); assert.ok(m.env.rt.rbListT > 0);
});
for (const field of ['on', 'tabOwner']) test(`перечитывание при ${field}=false не переводит к первой странице`, async () => {
 const m = mk({ path: '/rb-bosses.html', search: '?page=2', doc: page(2, true), env: { [field]: false } });
 await m.R.rbListScan(); assert.equal(m.loc.href, ''); assert.equal(m.fires.length, 0);
});
