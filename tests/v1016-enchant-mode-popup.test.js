'use strict';
// 15.10: отдельный режим заточки сохраняет план/историю и выключается всеми ручными путями смены режима.
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
function part(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); }
function fixture() {
  const cfg = { enchantMode: true, enchant: { enabled: true, queue: [{ key: 'exact', targetLevel: 8 }], maxAttempts: 5, maxScrolls: 5, colBudget: 0 } },
    rt = { char: 'Hero', enchant: { runId: 'run', status: 'paused', pending: { id: 'pending' }, history: [{ before: 2 }] }, enchantArchive: [{ runId: 'old' }] };
  const b = { Date, Object, cfg, rt, formChar: 'Hero', modeTab: '', on: false, MODE_NAME: {}, toast() {}, save: async () => {}, showTab: t => { b.modeTab = t; }, showWakeResult: async () => ({ ok: true }),
    chrome: { storage: { local: { get: async () => ({ cfg, rt, on: b.on }), set: async () => {} } } },
    menuPatch: async (p, extra = {}) => { Object.assign(rt, p); Object.assign(cfg, extra.cfgPatch || {}); if ('on' in extra) b.on = extra.on; } };
  vm.runInNewContext(part('async function activateMode(', 'const NUM ') + part('function currentMode(', 'const MODE_NAME =')
    + part('const MODES_OFF =', '// 10.0: повторное нажатие') + part('async function huntToggle()', 'async function epicToggle()')
    + part('async function epicToggle()', "$('epicToggle2').onclick"), b); return b;
}
const saved = b => JSON.stringify([b.cfg.enchant, b.rt.enchant, b.rt.enchantArchive]);
test('режим заточки распознаётся отдельно от наследованных боевых флагов', () => {
  const b = fixture(); assert.equal(b.currentMode({ ...b.cfg, epicMode: true, rbHuntMode: true, fishMode: true }), 'enchant');
});
test('небулевый флаг из импорта не выдаётся за выбранный режим', () => {
  const b = fixture(); for (const enchantMode of [false, undefined, 'false', 'true', 1]) assert.equal(b.currentMode({ enchantMode, taskOnly: true }), 'tasks');
});
test('старый флаг РБ между мобами не включает рейдовый бой', () => {
  const b = fixture(); vm.runInNewContext(part('const rbEff =', 'function ') + '\nthis.rbEffective=rbEff;', b);
  const cfg = { rbBetween: true, enchantMode: true }; assert.equal(b.rbEffective(cfg), false);
  cfg.enchantMode = false; assert.equal(b.rbEffective(cfg), false);
  cfg.rbHuntMode = true; assert.equal(b.rbEffective(cfg), true);
});
test('вход выбирает только заточку, открывает раздел и не создаёт попытку', async () => {
  const b = fixture(); Object.assign(b.cfg, { enchantMode: false, epicMode: true, rbHuntMode: true, fishMode: true, catMode: true, zoneAuto: true, campaign: true, taskOnly: true, rbBetween: true });
  Object.assign(b.rt, { rbGo: { id: 'boss' }, rbWant: 'boss', zoneGo: { id: 'zone' }, dailyFish: { prev: {} }, rbSess: { on: true }, rbOne: { on: true } });
  const before = saved(b); await b.setMode('enchant');
  assert.equal(b.currentMode(b.cfg), 'enchant'); assert.equal(b.modeTab, 'enchant'); assert.equal(b.on, true);
  for (const flag of ['epicMode', 'rbHuntMode', 'fishMode', 'catMode', 'zoneAuto', 'campaign', 'taskOnly', 'rbMode']) assert.equal(b.cfg[flag], false, flag);
  for (const k of ['rbGo', 'rbWant', 'zoneGo', 'dailyFish']) assert.equal(b.rt[k], null, k);
  assert.equal(b.rt.rbSess.on, false); assert.equal(b.rt.rbOne.on, false); assert.equal(saved(b), before);
});
for (const mode of ['tasks', 'farm', 'auto', 'rb', 'epic', 'fish', 'cat']) test('переключение на ' + mode + ' выключает заточку, сохраняя очередь и pending', async () => {
  const b = fixture(), before = saved(b); await b.setMode(mode); assert.equal(b.cfg.enchantMode, false); assert.equal(saved(b), before);
});
for (const [name, run] of [['тур из раздела', b => b.huntToggle()], ['эпики из раздела', b => b.epicToggle()],
  ['кампания', b => b.activateMode({}, { campaign: true })]]) test(name + ': отдельная кнопка тоже выключает заточку', async () => {
  const b = fixture(), before = saved(b); await run(b); assert.equal(b.cfg.enchantMode, false); assert.equal(saved(b), before);
});
test('разовая служба без изменения режима сохраняет выбранную заточку', async () => {
  const b = fixture(), before = saved(b); await b.activateMode({ fishService: 'cut' }, {}); assert.equal(b.cfg.enchantMode, true); assert.equal(saved(b), before);
});
for (const id of ['catMode', 'zoneAuto']) test('явная галка ' + id + ' выключает заточку, фоновое сохранение формы — нет', async () => {
  const b = fixture(), inputs = { catMode: { checked: false }, zoneAuto: { checked: false } };
  Object.assign(b, { BOOL: ['catMode', 'zoneAuto'], NUM: [], TXT: [], $: id => inputs[id] });
  vm.runInNewContext(part('async function save(e)', '// ---------- вкладки ----------'), b);
  await b.save(); assert.equal(b.cfg.enchantMode, true);
  inputs[id].checked = true; await b.save({ target: { id } }); assert.equal(b.cfg.enchantMode, false);
});
