'use strict';
// 10.0.13: выбранная удочка может находиться на другой странице рыболовной сумки.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
async function run({ pages = [[0], [5]], start = 0, selected = 'Fishing Rod +5', stop = false, stuck = false, attempts = 1 } = {}) {
  let page = start, opened = null, result = '', scrolls = attempts;
  const enchanted = [], rows = pages.map((items, p) => items.map((enchant, i) => {
    const item = { itemId: 6529, enchant, targetInstanceId: p + ':' + i };
    const row = { item, dataset: { itemJson: JSON.stringify(item) }, get textContent() { return 'Fishing Rod +' + item.enchant; },
      querySelector: s => s === '.l2-char-bag-name' ? { textContent: row.textContent } : s === '.l2-char-bag-icon--stats' ? { open: row } : null };
    return row;
  }));
  const tab = { getAttribute: () => 'true' }, enchantButton = { enchant: true }, close = { close: true };
  const all = selector => /pager/.test(selector) ? [{ page: page - 1, disabled: page === 0 }, { page: page + 1, disabled: page === rows.length - 1 }] : rows[page];
  const query = selector => ({
    'button[data-fishing-inventory-tab]': tab, '#char-bag-modal-close': close,
    '#char-bag-modal-title': opened ? { textContent: opened.textContent } : null,
    '#char-bag-modal-rod-enchant-row': opened ? {} : null, '#char-bag-modal-rod-enchant': opened ? enchantButton : null,
    '#char-rod-enchant-scroll-qty': { textContent: String(scrolls) }, '#char-rod-enchant-result': { textContent: result }
  })[selector] || null;
  const box = { console, on: true, tabOwner: true, cfg: { rodEnchantTo: 10 }, rt: { fishRodName: selected, fishProof: 0 },
    ROD_RE2: /fishing rod|вудк|удочк/i, rodLvlOf: t => { const m = String(t || '').match(/\+\s*(\d{1,2})\b/); return m ? +m[1] : null; },
    document: { querySelectorAll: all }, $q: query, itemJson: row => row.item, waitFor: async fn => fn(), waitX: async fn => fn(),
    shown: el => !!el, sleep: async () => {}, rnd: a => a, setStatus() {}, rec() {}, rtCommit: async () => true,
    fishSvcDone: async () => true, fishNow: () => true, location: { href: '/char.html' } };
  box.setRt = async p => Object.assign(box.rt, p);
  box.fire = el => {
    if (!el || !box.on) return false;
    if ('page' in el && !el.disabled) { if (!stuck) page = el.page; if (stop) box.on = false; }
    if (el.open) { opened = el.open; result = ''; }
    if (el.enchant) { enchanted.push(opened.item.targetInstanceId); opened.item.enchant++; scrolls--; result = 'Удочка +' + opened.item.enchant; }
    if (el.close) opened = null;
    return true;
  };
  box.env = { get on() { return box.on; }, get rt(){return box.rt},get cfg(){return box.cfg},get tabOwner(){return box.tabOwner},fire: box.fire, waitX: box.waitX };
  vm.createContext(box);
  // 17.10: pager использует общий контекст продолжения; загружаем настоящую фабрику со всеми его зависимостями.
  vm.runInContext(read('modules/fishing.js') + '\nthis.L2V7Modules={fishing:L2V7Factories.fishing(env)};', box);
  const content = read('content.js'), c0 = content.indexOf('async function rodEnchant()'), c1 = content.indexOf('// «🔪 Разделать', c0);
  assert.ok(c0 >= 0 && c1 > c0); vm.runInContext(content.slice(c0, c1) + '\nthis.run=rodEnchant;', box);
  for (let i = 0; i < attempts; i++) await box.run();
  return enchanted;
}
test('ищет выбранную +5 на следующей странице, не точит +0 на первой', async () => assert.deepEqual(await run(), ['1:0']));
test('возвращается к первой странице, если сумка открыта на второй', async () => assert.deepEqual(await run({ pages: [[5], [0]], start: 1 }), ['0:0']));
test('отсутствующая выбранная удочка не подменяется другой', async () => assert.deepEqual(await run({ pages: [[0], [3]] }), []));
test('одна страница с выбранной удочкой работает', async () => assert.deepEqual(await run({ pages: [[5]] }), ['0:0']));
test('без выбранной удочки сохраняется выбор первой доступной', async () => assert.deepEqual(await run({ pages: [[0]], selected: '' }), ['0:0']));
test('застрявший pager не разрешает заточку другой удочки', async () => assert.deepEqual(await run({ stuck: true }), []));
test('Stop во время перелистывания отменяет заточку', async () => assert.deepEqual(await run({ stop: true }), []));
test('следующая заточка ищет ту же удочку с обновлённым уровнем', async () => assert.deepEqual(await run({ attempts: 2 }), ['1:0', '1:0']));
