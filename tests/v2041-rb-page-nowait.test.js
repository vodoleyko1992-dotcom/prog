'use strict';
// 20.41 (лог 20.10 21:09:21–26: показана стр. 11, цель на стр. 12 — бот 4 с ждал страницу, которая сама не сменится): отрисовку
// списка ждём только для адреса нужной страницы; другая страница списка — сразу переход, нужная уже показана — без ожидания.
const test = require('node:test'), assert = require('node:assert/strict');
const { mk, docOf } = require('./epic-harness.cjs');
const ID = 'l2dop_rb_77777';
function fixture(urlPage, shownPage) {
  const g = { id: ID, name: 'Audit Raid', lvl: 54, page: 12, price: 1000, unit: 'аден', alive: true, t: Date.now() };
  const pager = `<div id="rb-pager-ind">${shownPage} / 14</div>`;
  const m = mk({ path: '/rb-bosses.html', search: '?page=' + urlPage, doc: docOf(pager), cfg: { epicMode: false },
    rt: { char: 'Warlock', classCur: { prof: 'human_warlock', slot: 0 }, adenaSeen: { v: 1000000, t: Date.now() }, rbHunt: { ...g, step: 'go', t: Date.now() },
      rbListT: Date.now(), rbList: { [ID]: g }, rbStats: { [ID]: { hp: 1000, patk: 1, matk: 1, mdef: 1, pdef: 1, src: 'api' } }, rbDb: {} },
    env: { tabOwner: true, warlock: { raidContext: () => ({ managed: true, key: 'same', powerKey: 'same', prepared: true }) } } });
  m.env.gameGet = async () => ({ ok: true, status: 200, json: async () => ({ character: { name: 'Warlock', inBattle: false, adena: 1000000 } }) });
  m.pageWaits = 0; const waitX = m.env.waitX; m.env.waitX = async (f, ms, step) => { if (ms === 4000) m.pageWaits++; return waitX(f, ms, step); };
  return m;
}
test('другая страница списка (адрес и экран — 11, цель на 12): сразу переход, без 4 с ожидания', async () => {
  const m = fixture(11, 11); await m.R.rbHuntStep();
  assert.equal(m.pageWaits, 0); assert.equal(m.loc.href, '/rb-bosses.html?page=12');
});
test('нужная страница уже на экране: дальше без ожидания отрисовки и без перехода', async () => {
  const m = fixture(12, 12); await m.R.rbHuntStep();
  assert.equal(m.pageWaits, 0); assert.notEqual(m.loc.href, '/rb-bosses.html?page=12');
});
test('адрес нужной страницы, экран ещё старый: ждём отрисовку, как раньше', async () => {
  const m = fixture(12, 11); await m.R.rbHuntStep();
  assert.equal(m.pageWaits, 1);
});
