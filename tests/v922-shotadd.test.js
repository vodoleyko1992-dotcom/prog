'use strict';
// 9.2.2 (скрин игрока 12.10, спойлер WestSPOIL 33 ур.): магазин купил заряды души D, а слота зарядов на панели боя не было —
// бот их не ставил (keepShots и shotSlotSwap работали только с уже стоящим слотом). Теперь: нет слота → ставит заряды
// нужного типа (по оружию) и грейда из «Розхідники» на пустой слот; без чтения инвентаря и без нужных зарядов — ничего не трогает
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const cls = (...c) => { const set = new Set(c); return { contains: x => set.has(x), add: x => set.add(x), remove: x => set.delete(x) }; };
const el = (title, src, classes = []) => ({ title, isConnected: true, classList: cls(...classes), querySelector: s => s === 'img' && src ? { getAttribute: () => src } : null });
const empty = el('Додати скіл (слот 2)', '', ['l2-battle-hotbar-slot--empty']);
const mpPot = el('Зілля мани (велика банка) — зілля: натисни для використання', '/icons/drops/resours/Etc_potion_blue_i00_0.jpg');
const pickSsNG = el('Заряд душі воїна ×120', '/icons/drops/resours/etc_spirit_bullet_white_i00.png', ['l2-battle-hotbar-pick']);
const pickSsD = el('Заряд душі воїна ×3000', '/icons/drops/resours/Etc_spirit_bullet_blue_i00_0.jpg', ['l2-battle-hotbar-pick']);
const pickBspsD = el('Благословенний заряд духу ×500', '/icons/drops/resours/Etc_spell_shot_blue_i01_0.jpg', ['l2-battle-hotbar-pick']);
const pickPot = el('Зілля зцілення ×990', '/icons/drops/resours/Etc_potion_scarlet_i00_0.jpg', ['l2-battle-hotbar-pick']);
let modal = false, tab = '', panel, consum;
const fired = [], recs = [];
const tabs = { consumable: el('Розхідники', '', []), remove: el('Прибрати', '', []) };
const closeBtn = { title: 'Закрити' };
const shotCls = x => x.classList.contains('l2-hotbar-shot--disabled') || x.classList.contains('l2-hotbar-shot--enabled');
const doc = {
  querySelectorAll: s => s === '.l2-battle-hotbar-slot--empty' ? panel.filter(x => x.classList.contains('l2-battle-hotbar-slot--empty'))
    : s === '.l2-battle-hotbar-pick' ? (modal && tab === 'consumable' ? consum : [])
    : s === '.l2-hotbar-shot--enabled, .l2-hotbar-shot--disabled' ? panel.filter(shotCls) : [],
  querySelector: s => s === '.l2-battle-hotbar-pick' ? (modal && tab === 'consumable' ? consum[0] || null : null) : null };
const sb = { console, Date, Math, document: doc }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/resources.js'), 'utf8'), sb);
let mage = false;
const env = { rt: { weaponsT: 1 }, cfg: {}, shotGrade: () => ({ g: 'D' }), shotsMage: () => mage, setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), sleep: async () => {},
  shown: x => !!x && (x !== env.panelEl || modal), waitFor: async f => { for (let i = 0; i < 3; i++) { const v = f(); if (v) return v; } return null; },
  $q: s => s === '.l2-battle-hotbar-modal #l2-bh-modal-tabs' ? (modal ? {} : null) : s.startsWith('.l2-battle-hotbar-tab[data-tab-key=') ? tabs[s.match(/"(\w+)"/)[1]] : s === '.l2-battle-hotbar-modal__panel' ? (modal ? env.panelEl : null) : s === '#l2-bh-modal-close' ? (modal ? closeBtn : null) : null,
  fire: x => { fired.push(x.title);
    if (x.classList?.contains('l2-battle-hotbar-slot--empty')) { modal = true; tab = ''; }
    else if (x === tabs.consumable) tab = 'consumable';
    else if (consum.includes(x)) { modal = false; panel = panel.map(p => p === empty ? el(x.title.replace(/\s*×.*$/, '') + ' — натисни для активації', x.querySelector('img').getAttribute(), ['l2-hotbar-shot--disabled']) : p); }
    else if (x === closeBtn) modal = false; },
  shotSlot: () => panel.find(shotCls) || null, shotsOn: () => false, qty: () => 3000, lastShotTry: 0 };
env.panelEl = {};
const R = sb.L2V7Factories.resources(env);
const reset = () => { panel = [mpPot, empty]; consum = [pickPot, pickSsNG, pickBspsD, pickSsD]; modal = false; tab = ''; fired.length = 0; recs.length = 0; env.rt.shotAddT = 0; env.lastShotTry = 0; };
(async () => {
  // воин/спойлер (кастеты), грейд D: слота зарядов нет → ставит «Заряд душі воїна» D, не NG и не благословенные
  reset();
  assert.equal(await R.shotSlotAdd(), true);
  assert.ok(fired.includes('Заряд душі воїна ×3000'), 'picked D soulshots');
  assert.ok(!fired.includes('Заряд душі воїна ×120') && !fired.includes('Благословенний заряд духу ×500'), 'not NG, not spiritshots');
  assert.equal(panel.filter(shotCls).length, 1);
  assert.match(recs.join('\n'), /зарядов на панели не было — поставил «Заряд душі воїна» D \(×3000\) в слот 2/);
  // keepShots сам ставит и сразу включает
  reset();
  await R.keepShots();
  assert.ok(fired.includes('Заряд душі воїна ×3000'), 'keepShots places shots when no slot');
  assert.ok(fired.some(t => /^Заряд душі воїна — натисни/.test(t)), 'and turns them on');
  // повтор не чаще раза в 2 мин; слот уже есть — ничего не делает
  fired.length = 0;
  assert.equal(await R.shotSlotAdd(), false); assert.equal(fired.length, 0);
  // маг: благословенные заряды духа нужного грейда
  reset(); mage = true;
  assert.equal(await R.shotSlotAdd(), true);
  assert.ok(fired.includes('Благословенний заряд духу ×500') && !fired.includes('Заряд душі воїна ×3000'));
  mage = false;
  // нужных зарядов в сумке ещё нет — окно закрыто, ничего не поставлено (докупит магазин)
  reset(); consum = [pickPot, pickSsNG];
  assert.equal(await R.shotSlotAdd(), false);
  assert.equal(modal, false); assert.equal(panel.filter(shotCls).length, 0);
  // инвентарь не прочитан в этой установке (грейд неизвестен) — не трогаем
  reset(); env.rt.weaponsT = 0;
  assert.equal(await R.shotSlotAdd(), false); assert.equal(fired.length, 0);
  env.rt.weaponsT = 1;
  // свободного слота нет — не открываем окно
  reset(); panel = [mpPot];
  assert.equal(await R.shotSlotAdd(), false); assert.equal(fired.length, 0);
  console.log('PASS: shots — no shot slot on the panel → bought shots of the weapon type and grade are placed on an empty slot and turned on');
})().catch(e => { console.error(e); process.exit(1); });
