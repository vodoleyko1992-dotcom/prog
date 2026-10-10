'use strict';
// 7.2.1 (лог 10.10 21:07–21:08): Demon's Staff (C) → Sprite's Staff (B). Бот купил 3000 B-зарядов, а на панели остались C-заряды
// (имя то же — «Благословенний заряд духу»). Теперь бот сам ставит заряды нужного грейда и убирает старые
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const cls = (...c) => { const set = new Set(c); return { contains: x => set.has(x), add: x => set.add(x), remove: x => set.delete(x) }; };
const el = (title, src, classes = [], extra = {}) => ({ title, isConnected: true, classList: cls(...classes), querySelector: s => s === 'img' && src ? { getAttribute: () => src } : null, ...extra });
// снимок 10.10: слот C — зелёная иконка, ×3886; слот B — «#3950 — …», красная
const slotC = el('Благословенний заряд духу — благословений заряд духу: натисни для активації', '/icons/drops/resours/Etc_spell_shot_green_i01_0.jpg', ['l2-hotbar-shot--disabled']);
const empty = el('Додати скіл (слот 22)', '', ['l2-battle-hotbar-slot--empty']);
const pickB = el('Благословенний заряд духу ×3000', '/icons/drops/resours/Etc_spell_shot_red_i01_0.jpg', ['l2-battle-hotbar-pick']);
const pickC = el('Благословенний заряд духу ×3886', '/icons/drops/resours/Etc_spell_shot_green_i01_0.jpg', ['l2-battle-hotbar-pick']);
const remC = el('Благословенний заряд духу', '/icons/drops/resours/Etc_spell_shot_green_i01_0.jpg', ['l2-battle-hotbar-pick']);
let modal = false, tab = '', panel = [slotC, empty];
const fired = [];
const tabs = { consumable: el('Розхідники', '', []), remove: el('Прибрати', '', []) };
const doc = {
  querySelectorAll: s => s === '.l2-battle-hotbar-slot--empty' ? panel.filter(x => x.classList.contains('l2-battle-hotbar-slot--empty'))
    : s === '.l2-battle-hotbar-pick' ? (!modal ? [] : tab === 'consumable' ? [pickC, pickB] : tab === 'remove' ? [remC] : [])
    : s === '.l2-hotbar-shot--enabled, .l2-hotbar-shot--disabled' ? panel.filter(x => x.classList.contains('l2-hotbar-shot--disabled') || x.classList.contains('l2-hotbar-shot--enabled')) : [],
  querySelector: s => s === '.l2-battle-hotbar-pick' ? (modal && tab ? pickB : null) : null };
const sb = { console, Date, Math, document: doc }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/resources.js'), 'utf8'), sb);
const recs = [];
const env = { rt: { weaponsT: 1 }, cfg: {}, shotGrade: () => ({ g: 'B' }), setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), sleep: async () => {},
  shown: x => !!x && (x !== env.panelEl || modal), waitFor: async f => { for (let i = 0; i < 3; i++) { const v = f(); if (v) return v; } return null; },
  $q: s => s === '.l2-battle-hotbar-modal #l2-bh-modal-tabs' ? (modal ? {} : null) : s.startsWith('.l2-battle-hotbar-tab[data-tab-key=') ? tabs[s.match(/"(\w+)"/)[1]] : s === '.l2-battle-hotbar-modal__panel' ? (modal ? env.panelEl : null) : s === '#l2-bh-modal-close' ? (modal ? closeBtn : null) : null,
  fire: x => { fired.push(x.title);
    if (x.classList?.contains('l2-battle-hotbar-slot--empty')) { modal = true; tab = ''; }
    else if (x === tabs.consumable) tab = 'consumable'; else if (x === tabs.remove) tab = 'remove';
    else if (x === pickB) { modal = false; panel = [slotC, el('#3950 — благословений заряд духу: натисни для активації', '/icons/drops/resours/Etc_spell_shot_red_i01_0.jpg', ['l2-hotbar-shot--disabled']), el('Додати скіл (слот 23)', '', ['l2-battle-hotbar-slot--empty'])]; }
    else if (x === remC) { modal = false; slotC.isConnected = false; panel = panel.filter(p => p !== slotC); panel.push(empty); }
    else if (x === closeBtn) modal = false; },
  shotSlot: () => panel.find(x => x.classList.contains('l2-hotbar-shot--disabled')), shotsOn: () => false, qty: () => 1, lastShotTry: Date.now() };
env.panelEl = {};
const closeBtn = { title: 'Закрити' };
const R = sb.L2V7Factories.resources(env);
assert.equal(R.shotGradeOf(slotC), 'C'); assert.equal(R.shotGradeOf(pickB), 'B');
assert.equal(R.shotGradeOf({ title: '#3950 — благословений заряд духу', querySelector: () => null }), 'B', 'id in the title wins');
(async () => {
  assert.equal(await R.shotSlotSwap(slotC), true);
  assert.ok(fired.includes('Благословенний заряд духу ×3000'), 'picked B shots from consumables');
  assert.ok(!fired.includes('Благословенний заряд духу ×3886'), 'not the C ones');
  assert.ok(fired.includes('Благословенний заряд духу') && !slotC.isConnected, 'old C slot removed');
  assert.match(recs.join('\n'), /поставил заряды B \(×3000\), старые убрал/);
  // без чтения инвентаря (базовый профиль) грейд не известен — ничего не трогаем
  env.rt = { weaponsT: 0 }; fired.length = 0;
  assert.equal(await R.shotSlotSwap(slotC), false); assert.equal(fired.length, 0);
  console.log('PASS: shots — slot grade by #id/icon colour, wrong-grade slot swapped for the bought grade, old one removed, nothing without inventory read');
})().catch(e => { console.error(e); process.exit(1); });
