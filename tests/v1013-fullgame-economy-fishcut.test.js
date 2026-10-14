'use strict';
// 10.0.13: char-fishing-cut.js показывает 15 строк; материалы могут занять всю первую страницу.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function setup(start = 1, stuck = false) {
  let page = start, open = null, result = '';
  const cut = [], stacks = Array.from({ length: 15 }, (_, i) => ({ itemId: 9000 + i, qty: 1, name: 'Fish Oil ' + i }));
  stacks.push({ itemId: 9101, qty: 3, name: 'White Fish' }, { itemId: 9102, qty: 2, name: 'Blue Fish' });
  const rows = () => stacks.slice((page - 1) * 15, page * 15).map(j => ({ j, dataset: { itemJson: JSON.stringify(j) }, querySelector: s => s === '.l2-char-bag-name' ? { textContent: j.name } : { open: j } }));
  const buttons = () => [{ disabled: page === 1, target: page - 1 }, { disabled: page >= Math.ceil(stacks.length / 15), target: page + 1 }];
  const tab = { getAttribute: () => 'true' }, action = { cut: true }, close = { close: true }, overlay = { get textContent() { return result; } };
  const query = s => s === 'button[data-fishing-inventory-tab]' ? tab : s === '#char-bag-modal-cut-row' ? open ? {} : null : s === '#char-bag-modal-overlay' ? overlay : s === '#char-bag-modal-cut' ? action : s === '#char-bag-modal-cut-max' ? {} : s === '#char-bag-modal-close' ? close : null;
  const doc = { querySelector: query, querySelectorAll: s => /l2-char-bag-pager__btn/.test(s) ? buttons() : /l2-char-bag-row/.test(s) ? rows() : [] };
  const box = { document: doc, location: { pathname: '/char.html' }, console }; vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../modules/fishing.js'), 'utf8'), box);
  const env = { on: true, rt: {}, cfg: {}, $q: query, shown: x => !!x, MATERIAL_RE: /fish oil/i, itemJson: r => r.j, setStatus() {}, waitFor: async f => f(), waitX: async f => f(), rnd: a => a, sleep: async () => {}, rec() {},
    setRt: async p => Object.assign(env.rt, p), fire: e => { if (e?.target && !e.disabled && !stuck) page = e.target;
      if (e?.open) { open = e.open; result = ''; }
      if (e?.cut) { cut.push(open.itemId); result = 'Ви розрізали ' + open.name + '. Отримано: Fish Oil'; stacks.splice(stacks.indexOf(open), 1); page = Math.max(1, Math.min(page, Math.ceil(stacks.length / 15))); }
      if (e?.close) open = null;
    } };
  return { M: box.L2V7Factories.fishing(env), env, cut, stacks };
}
(async () => {
  for (const start of [1, 2]) { const f = setup(start); await f.M.fishCut(); assert.deepEqual(f.cut, [9101, 9102], 'рыба со второй страницы, старт ' + start); assert.equal(f.stacks.length, 15); }
  const f = setup(1, true); await f.M.fishCut(); assert.equal(f.cut.length, 0, 'застрявший pager не режет материал');
  console.log('PASS: fishCut проходит все страницы, начинает с первой, учитывает удалённые стопки и не режет материалы при stuck pager');
})().catch(e => { console.error(e); process.exitCode = 1; });
