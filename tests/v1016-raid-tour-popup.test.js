'use strict';
// 14.10: меню показывает расчёт ядра, ручной запуск снимает только обычный простой.
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
function part(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); }
function box() {
  const now = Date.now(), cfg = { rbMaxBelow: 15, rbMaxAbove: 15 }, rt = { lvl: 60, rbListT: now,
    rbList: { low: { name: 'Низкий', lvl: 50, alive: true }, high: { name: 'Высокий', lvl: 65, alive: true } } }, els = {};
  const b = { Date, cfg, rt, MODE_NAME: {}, toast() {}, save: async () => {}, $: id => els[id] ||= { textContent: '', classList: { toggle(k, v) { this[k] = v; } } },
    chrome: { storage: { local: { get: async () => ({ cfg, rt }) } } },
    menuPatch: async (p, o = {}) => { Object.assign(rt, p); Object.assign(cfg, o.cfgPatch || {}); },
    activateMode: async (p, c) => { Object.assign(rt, p); Object.assign(cfg, c); } };
  vm.runInNewContext(part('function skipGroups(', 'function rbLineOf(') + part('function renderHuntQueue(', "$('fishRodGoal10').onclick")
    + part('const MODES_OFF =', "$('enchantModeToggle').onclick") + part('async function huntToggle()', 'async function epicToggle()'), b);
  b.view = () => ({ at: now, heroLvl: 60, lo: 45, hi: 75, mode: 'up', listT: now, stale: false,
    ready: [{ id: 'high', name: 'Высокий', lvl: 65 }], blocked: [{ id: 'low', name: 'Низкий', lvl: 50, kind: 'limit', why: 'лимит 3 платных телепортов за час' }] });
  b.render = () => { b.renderHuntQueue(rt, cfg); return b.$('huntQueue').textContent; }; return b;
}
test('очередь и отказ показываются из единого расчёта, не пересчитываются меню', () => {
  const b = box(); b.rt.rbTourView = b.view(); const text = b.render();
  assert.match(text, /Последний расчёт/); assert.match(text, /Очередь[^\n]*Высокий 65/); assert.doesNotMatch(text, /Очередь[^\n]*Низкий/); assert.match(text, /лимит 3 платных телепортов/);
});
for (const [key, value] of [['heroLvl', 59], ['lo', 46], ['hi', 74], ['mode', 'down'], ['listT', 1]]) test('устаревшее соответствие ' + key + ' даёт предварительный список', () => {
  const b = box(); b.rt.rbTourView = { ...b.view(), [key]: value }; const text = b.render();
  assert.match(text, /Предварительный список/); assert.doesNotMatch(text, /Последний расчёт|лимит 3 платных/);
});
test('без расчёта меню не объявляет старый вердикт или попытку 3 мин назад запретом', () => {
  const b = box(); b.rt.rbDb = { low: { verdict: 'no', heroLvl: 59 } }; b.rt.rbGoTried = { low: Date.now() - 180000 };
  assert.match(b.render(), /Предварительный список[^\n]*Низкий 50.*Высокий 65/); assert.doesNotMatch(b.render(), /пробовал|не по силам/);
});
test('явная кнопка порядка выключает режим выгоды и сбрасывает старый снимок', async () => {
  const b = box(); b.cfg.rbValueTour = true; b.rt.rbTourView = b.view(); await b.setRbOrder('down');
  assert.equal(b.cfg.rbOrder, 'down'); assert.equal(b.cfg.rbValueTour, false); assert.equal(b.rt.rbTourView, null);
});
test('режим выгоды без расчёта не изображает очередь по уровню', () => {
  const b = box(); b.cfg.rbValueTour = true; assert.match(b.render(), /выгоде.*ожида/); assert.equal(b.$('rbOrderUp').classList.on, false); assert.equal(b.$('rbOrderDown').classList.on, false);
});
for (const [name, start] of [['быстрый режим', b => b.setMode('rb')], ['кнопка раздела', b => b.huntToggle()]]) {
  test(name + ': новый тур отменяет простой, сохраняет историю трат и вердикты', async () => {
    const b = box(); Object.assign(b.rt, { rbHuntIdle: Date.now() + 600000, rbIdleMark: { lvl: 59 }, rbIdleN: 3, rbTourView: b.view(), rbGoCnt: { low: [1, 2, 3] }, rbDb: { low: { verdict: 'no' } } });
    await start(b); assert.equal(b.rt.rbHuntIdle, 0); assert.equal(b.rt.rbIdleMark, null); assert.equal(b.rt.rbIdleN, 0); assert.equal(b.rt.rbTourView, null);
    assert.deepEqual(b.rt.rbGoCnt.low, [1, 2, 3]); assert.equal(b.rt.rbDb.low.verdict, 'no'); assert.equal(b.rt.rbListT, 0);
  });
  test(name + ': недавние два отказа сохраняют защитную паузу', async () => {
    const b = box(), until = Date.now() + 250000; Object.assign(b.rt, { rbHuntIdle: until, rbRefuse: { n: 2, t: Date.now() }, rbIdleMark: { lvl: 60 } });
    await start(b); assert.equal(b.rt.rbHuntIdle, until); assert.equal(b.rt.rbRefuse.n, 2); assert.equal(b.rt.rbIdleMark.lvl, 60);
  });
}
