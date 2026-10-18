'use strict';
// 18.10 (игрок: «у меня есть усиленные HP и MP банки, бот их игнорирует»): «Велике зілля HP/MP» (#920044/#920045, 2500 за импульс)
// стоят на панели рядом с обычными (GET /character 18.10: battleHotbarSlots 728, 1061, …, 920045, 920044). Бот пил обычную HP-банку
// (обычный режим — «самая слабая») и MP-банку по списку имён (сначала «Зілля мани (велика банка)»); слот «#920044 — зілля …» без имени
// (каталог игры не загружен) вообще не узнавался. Теперь усиленные пьются первыми в любом виде подписи, обычные остаются запасом.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const HP_POT_RE = eval(read('content.js').match(/const HP_POT_RE = (\/.*\/i);/)[1]);
let slots = [];
const sb = { console, Date, Math, document: { querySelectorAll: () => slots, querySelector: () => null } }; sb.globalThis = sb;
vm.runInNewContext(read('modules/resources.js'), sb);
const names = s => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const slot = (title, q = 100) => ({ title, q });
const env = {
  cfg: { nMpPot: 'Зілля мани, Зелье маны, Mana Potion', nHpPot: '' }, rt: { pots: {}, skills: {} }, SLOT: '.slot', HP_POT_RE,
  slotKind: () => 'предмет', qty: b => b?.q ?? null, ready: () => true,
  potName: b => (b?.title || '').split(/\s+[—–]\s+/)[0].trim(), potKey: b => (b?.title || '').split(/\s+[—–]\s+/)[0].trim().toLowerCase(), skKey: b => b.title.toLowerCase(),
  slotsBy: str => { const a = names(str); return slots.filter(b => { const t = b.title.toLowerCase(); return a.some(x => t.startsWith(x) && (t.length === x.length || /[\s(:.—–-]/.test(t[x.length]))); }); },
};
const R = sb.L2V7Factories.resources(env);
const T = (n, q) => `${n} — зілля: натисни для використання (${q} у сумці)`;

// 1) названия на украинском
slots = [slot(T('Зілля мани (велика банка)', 983), 983), slot(T('Зілля зцілення', 818), 818), slot(T('Велике зілля MP', 108), 108), slot(T('Велике зілля HP', 210), 210)];
assert.equal(R.hpPotPick(false).title, slots[3].title, 'обычный режим: усиленная HP первой');
assert.equal(R.hpPotPick(true).title, slots[3].title);
assert.equal(R.hpPotByDeficit(300).title, slots[3].title, 'и при малой недостаче');
assert.equal(R.mpPotSlot().title, slots[2].title, 'MP: усиленная раньше «Зілля мани (велика банка)»');
assert.ok(!R.hpPots().some(x => /MP/.test(x.name)), 'усиленная MP не лечит HP');

// 2) слот без имени, пока каталог игры не загружен
slots = [slot(T('#728', 983), 983), slot(T('#1061', 818), 818), slot(T('#920045', 108), 108), slot(T('#920044', 210), 210)];
assert.equal(R.hpPotPick(false).title, slots[3].title, '#920044 узнаётся');
assert.equal(R.hpPots().find(x => x.big).heal, 2500);
assert.equal(R.mpPotSlot().title, slots[2].title, '#920045 узнаётся');

// 3) русский интерфейс
slots = [slot(T('Зелье маны (большая банка)', 50), 50), slot(T('Зелье исцеления', 50), 50), slot(T('Большое зелье MP', 5), 5), slot(T('Большое зелье HP', 5), 5)];
assert.equal(R.hpPotPick(false).title, slots[3].title);
assert.equal(R.mpPotSlot().title, slots[2].title);

// 4) усиленные кончились — обычные из запаса, как раньше (обычный режим — самая слабая)
slots = [slot(T('Зілля мани (велика банка)', 983), 983), slot(T('Зілля слабкого зцілення', 139), 139), slot(T('Зілля зцілення', 818), 818), slot(T('Велике зілля MP', 0), 0), slot(T('Велике зілля HP', 0), 0)];
assert.equal(R.mpPotSlot().title, slots[0].title);
assert.ok(R.hpPotPick(false) && !/Велике/.test(R.hpPotPick(false).title));
// безымянная обычная MP-банка тоже находится
slots = [slot(T('#728', 983), 983)];
assert.equal(R.mpPotSlot().title, slots[0].title);

// 5) бой считает безымянные слоты банками (у банок нет своего отката)
const cs = read('modules/combat.js');
assert.match(cs, /\^#\(\?:726\|728\|920045\)\\b/);
assert.ok(HP_POT_RE.test(T('#920044', 1)) && HP_POT_RE.test(T('#1061', 1)) && !HP_POT_RE.test(T('#920045', 1)));
console.log('PASS: усиленные банки HP/MP (#920044/#920045, UA/RU/без имени) пьются первыми, обычные — запас');
