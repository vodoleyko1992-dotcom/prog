'use strict';
// 10.0.13 (аудит 14.10): char.js и gm-shop-pager.js используют общий pager по пять номеров.
// Контракт публичного l2-compact-pagination.js: aria-current, disabled у текущей, << / >> между группами.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
function fixture({ start = 1, total = 8, legacy = false, shop = false, stuck = false } = {}) {
  let page = start, clock = 1e9, money = 100000, modalOpen = false, quantity = 0, worn = '';
  const clicks = [], bought = [], pages = Array.from({ length: total }, (_, i) => [{ itemId: 100 + i, qty: i + 1, targetInstanceId: 'bag:' + i }]);
  const tab = { getAttribute: () => 'true', classList: { contains: () => true } };
  const buttons = () => total <= 1 ? [] : legacy ? [{ textContent: 'Назад', target: page - 1, disabled: page === 1 }, { textContent: 'Вперёд', target: page + 1, disabled: page === total }] : (() => {
    const first = Math.floor((page - 1) / 5) * 5 + 1;
    return [...(first > 1 ? [{ textContent: '<<', target: first - 5 }] : []), ...Array.from({ length: Math.min(5, total - first + 1) }, (_, i) => ({ textContent: String(first + i), target: first + i, disabled: first + i === page })), ...(first + 4 < total ? [{ textContent: '>>', target: first + 5 }] : [])];
  })();
  const itemName = j => 'Item ' + j.itemId;
  const price = { className: 'l2-gm-shop-price l2-gm-shop-price--adena', textContent: '10 Adena', querySelectorAll: () => [] };
  const rows = () => pages[page - 1].map(j => ({ dataset: { itemJson: JSON.stringify(j) }, className: 'l2-gm-shop-row l2-gm-shop-row--grade-ng',
    querySelector: sel => sel === '.l2-char-bag-name' || sel === '.l2-gm-shop-name' ? { textContent: itemName(j) } : sel === '.l2-char-bag-equip--wear' ? { wear: j.targetInstanceId } : sel === '.l2-gm-shop-buy' ? { buy: j.itemId } : sel === '.l2-gm-shop-price' ? price : null }));
  const input = { focus() {} }, confirm = { confirm: true };
  const modal = { querySelector: s => /input/.test(s) ? input : /confirm/.test(s) ? confirm : null };
  const queryAll = sel => {
    if (/l2-compact-pages__btn/.test(sel)) return legacy ? [] : buttons();
    if (/l2-char-bag-pager__btn|l2-gm-shop-pager-btn/.test(sel)) return legacy ? buttons() : [];
    if (/l2-gm-shop-name/.test(sel) || /data-item-json\] \.l2-char-bag-name/.test(sel)) return rows().map(r => r.querySelector('.l2-char-bag-name'));
    if (/l2-char-bag-row|l2-gm-shop-row/.test(sel)) return rows();
    return [];
  };
  const query = sel => {
    if (/aria-current/.test(sel)) return legacy ? null : { textContent: String(page) };
    if (sel === '#char-bag-list') return {};
    if (/data-inv-|data-grade|data-consumablesub/.test(sel)) return tab;
    if (sel === '.l2-gm-shop-adena__amount') return { textContent: String(money) };
    if (sel === '#l2-drops-shop-buy-qty-modal') return modalOpen ? modal : null;
    if (/buy-qty-confirm/.test(sel)) return modalOpen ? confirm : null;
    return null;
  };
  class Clock extends Date { static now() { return clock; } }
  const box = { document: { querySelectorAll: queryAll, querySelector: query }, location: { pathname: shop ? '/gm-shop.html' : '/char.html', search: '' }, Date: Clock, console, URLSearchParams };
  vm.createContext(box);
  for (const mod of ['economy', 'equipment']) vm.runInContext(fs.readFileSync(path.join(root, 'modules', mod + '.js'), 'utf8'), box);
  // Надевание требует работающего бота и владения вкладкой.
  const env = { on: true, tabOwner: true, rt: {}, cfg: { shopReserve: 0, shopMaxSpend: 100000 }, ITEMS: {}, $q: query, shown: x => !!x, itemJson: r => JSON.parse(r.dataset.itemJson),
    waitX: async fn => fn(), sleep: async ms => { clock += ms; }, rnd: a => a, itemsDb: async () => {}, noteBag: async () => {}, setRt: async p => Object.assign(env.rt, p),
    itemOf: id => ({ id, k: 'W', n: 'Item ' + id, wt: 'посох', g: 'NG', pa: id, ma: id }), baseName: s => s, pause: async () => {}, rec: () => {}, EQUIP_OK: /надето/, noticeText: () => worn ? 'надето' : '',
    setVal: (_el, v) => { quantity = +v; }, fire: el => {
      if (!el) return false;
      if (el.target && !el.disabled) { clicks.push(el.target); if (!stuck) page = el.target; }
      if (el.wear) worn = el.wear;
      if (el.buy) { modalOpen = true; bought.push({ id: el.buy, page }); }
      if (el.confirm) { money -= quantity * 10; modalOpen = false; }
      return true;
    } };
  return { E: box.L2V7Factories.economy(env), W: box.L2V7Factories.equipment(env), env, pages, clicks, bought, get page() { return page; }, get worn() { return worn; } };
}
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
for (const start of [1, 8]) check('все запасы с начальной страницы ' + start, async () => {
  const f = fixture({ start }); const result = await f.E.bagCounts();
  for (let i = 0; i < 8; i++) assert.equal(result[100 + i], i + 1, 'остаток предмета со страницы ' + (i + 1));
});
check('оружие со всех страниц, включая предыдущую группу', async () => {
  const f = fixture({ start: 8 }); const weapons = await f.W.scanInventoryWeapons();
  assert.deepEqual([...weapons].map(w => w.id), Array.from({ length: 8 }, (_, i) => 100 + i));
});
check('надевание конкретного экземпляра с другой группы страниц', async () => {
  const f = fixture({ start: 8 }); f.pages[0].push({ itemId: 105, qty: 1, targetInstanceId: 'bag:wrong-copy' });
  assert.equal(await f.W.wearFromBag({ id: 105, inst: 'bag:5', name: 'Item 105', wt: 'посох', g: 'NG' }), true); assert.equal(f.worn, 'bag:5');
});
for (const start of [1, 8]) check('магазин находит и покупает нужную строку с начальной страницы ' + start, async () => {
  const f = fixture({ start, shop: true }); const result = await f.E.shopBuyOne({ key: 'other', grade: 'NG', name: /^Item 105$/ }, 20);
  assert.equal(result.ok, true, result.why); assert.equal(result.qty, 20); assert.deepEqual(f.bought, [{ id: 105, page: 6 }]);
});
check('старый pager сумки и магазина остаётся рабочим', async () => {
  const f = fixture({ start: 3, total: 3, legacy: true }); assert.equal((await f.E.bagCounts())[100], 1);
  const s = fixture({ total: 3, legacy: true, shop: true }); assert.equal((await s.E.shopBuyOne({ key: 'other', grade: 'NG', name: /^Item 102$/ }, 20)).ok, true);
});
check('одна страница без pager читается и покупается', async () => {
  const f = fixture({ total: 1 }); assert.equal((await f.E.bagCounts())[100], 1); assert.equal((await f.W.scanInventoryWeapons()).length, 1);
  const s = fixture({ total: 1, shop: true }); assert.equal((await s.E.shopBuyOne({ key: 'other', grade: 'NG', name: /^Item 100$/ }, 20)).ok, true);
});
check('застрявший pager не дублирует запасы и не покупает соседний товар', async () => {
  const f = fixture({ stuck: true }); const counts = await f.E.bagCounts(); assert.equal(counts[100], 1); assert.equal(counts[101], undefined);
  const s = fixture({ stuck: true, shop: true }); assert.equal((await s.E.shopBuyOne({ key: 'other', grade: 'NG', name: /^Item 105$/ }, 20)).ok, false); assert.equal(s.bought.length, 0);
});
(async () => { let failures = 0; for (const [name, fn] of checks) { try { await fn(); console.log('PASS:', name); } catch (e) { failures++; console.error('FAIL:', name, '\n' + e.message); } } if (failures) process.exitCode = 1; })();
