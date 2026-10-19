'use strict';
// 18.10 (игрок: «при выключении кнопка не отключается»): в режиме задач «Тур по РБ»/«Эпики» меняют autoTasks, а подпись читала
// плоский rbHuntMode/epicMode → после выключения оставалось «ВКЛ». И «один РБ» выключается отдельной кнопкой вместе с туром.
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '../popup.html'), 'utf8');
function part(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); }
function box(cfg, rt) {
  const els = {}, toasts = [];
  const b = { Date, Object, Set, Promise, cfg, rt, formChar: 'Hero', settingsSerial: 0, DEF: {}, toast: t => toasts.push(t), load: async () => {}, toasts,
    $: id => els[id] ||= { id, textContent: '', hidden: false, classList: { toggle(k, v) { this[k] = v; } } },
    chrome: { storage: { local: { get: async () => ({ cfg, rt, on: false }) } } },
    menuPatch: async (p, o = {}) => { Object.assign(rt, p); Object.assign(cfg, o.cfgPatch || {}); },
    activateMode: async (p, c) => { Object.assign(rt, p); Object.assign(cfg, c); }, rbTourRestart: () => ({}) };
  vm.runInNewContext(part('const AUTO_TASK_LABELS =', 'function currentMode(') + part('async function huntToggle()', 'async function epicToggle()')
    + part("$('rbOneOff').onclick", "// перерисовка меню"), b);
  b.paint = () => { const d = cfg; b.$('huntToggle2').textContent = `🧭 Тур по РБ: ${b.taskSel(d, 'raid') ? 'ВКЛ' : 'ВЫКЛ'}`; return b.$('huntToggle2').textContent; };
  return b;
}
test('подпись кнопки тура в коде берётся из taskSel, не из rbHuntMode', () => {
  assert.match(src, /\$\('huntToggle2'\)\.textContent = `🧭 Тур по РБ: \$\{taskSel\(d, 'raid'\)/);
  assert.match(src, /\$\('epicToggle2'\)\.textContent = `🐉 Эпики: \$\{taskSel\(d, 'epic'\)/);
  assert.doesNotMatch(src, /Тур по РБ: \$\{d\.rbHuntMode/);
});
test('режим задач: выключение тура → ВЫКЛ, хотя старый rbHuntMode=true', async () => {
  const cfg = { autoTasks: ['raid', 'fish'], rbHuntMode: true }, rt = {}, b = box(cfg, rt);
  assert.equal(b.paint(), '🧭 Тур по РБ: ВКЛ');
  await b.huntToggle(); assert.deepEqual([...cfg.autoTasks], ['fish']); assert.equal(b.paint(), '🧭 Тур по РБ: ВЫКЛ');
  await b.huntToggle(); assert.ok(cfg.autoTasks.includes('raid')); assert.equal(b.paint(), '🧭 Тур по РБ: ВКЛ');
});
test('прежний режим без списка: подпись по rbHuntMode', async () => {
  const cfg = { autoTasks: null, rbHuntMode: true }, rt = {}, b = box(cfg, rt);
  assert.equal(b.paint(), '🧭 Тур по РБ: ВКЛ'); await b.huntToggle(); assert.equal(cfg.rbHuntMode, false); assert.equal(b.paint(), '🧭 Тур по РБ: ВЫКЛ');
});
test('выключение тура в режиме задач снимает и «один РБ»', async () => {
  const cfg = { autoTasks: ['raid'] }, rt = { rbOne: { on: true, n: 2 } }, b = box(cfg, rt);
  await b.huntToggle(); assert.equal(rt.rbOne.on, false); assert.equal(rt.rbOne.n, 2);
});
for (const strict of [true, false]) test('кнопка «Выключить один РБ» снимает его и тур' + (strict ? ' (задачи)' : ' (прежний режим)'), async () => {
  const cfg = strict ? { autoTasks: ['raid', 'tvt'] } : { autoTasks: null, rbHuntMode: true, rbMode: true }, rt = { rbOne: { on: true } }, b = box(cfg, rt);
  assert.ok(html.includes('id="rbOneOff"'));
  await b.$('rbOneOff').onclick(); assert.equal(rt.rbOne.on, false);
  if (strict) assert.deepEqual([...cfg.autoTasks], ['tvt']); else assert.equal(cfg.rbHuntMode, false);
});
