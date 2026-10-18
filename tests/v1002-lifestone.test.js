'use strict';
// 10.0.2 (обновление игры 12.10 «СИСТЕМА LIFE STONE»): аугментация оружия. Сервер отдаёт ЛС в /character → inventory.eq.l1.augmentation
// {uid, outcomeId, grade}; активный ЛС даёт умение ls_<имя> на панели боя (data-slot-cd="ls_prominence", без номера l2_).
// Бот: читает ЛС из сети (hook aug → rt.weaponAug), узнаёт умение на панели (ilOf → id Interlude, Power 109), не переодевает оружие с полезным ЛС.
// Сам ЛС бот не покупает и не вставляет
const assert = require('node:assert/strict'); const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');

// ---- augment.js: таблица исходов совпадает с кодом игры (weapon-augmentation-display.js, 12.10) ----
const sb = { console }; sb.globalThis = sb; vm.createContext(sb);
vm.runInContext(read('augment.js'), sb);
const A = sb.L2Aug;
const GAME_OUT = ['tempest', 'hurricane', 'vampiric_claw', 'hydro_blast', 'prominence', 'major_heal', 'mage_skill_5', 'mage_crit_damage_5', 'hp_5', 'mp_5',
  'physical_crit_100', 'magic_crit_chance_10', 'matk_6', 'pdef_4', 'mdef_5', 'physical_crit_damage_5', 'physical_skill_10', 'bad_matk_10', 'bad_patk_9', 'bad_pdef_9', 'bad_mdef_9'];
assert.deepEqual(Object.keys(A.OUT).sort(), [...GAME_OUT].sort(), 'all 21 outcomes of the game');
// battle-hotbar.js ACTION_L2_ICON
assert.deepEqual({ ...A.SKILL_IL }, { ls_prominence: 1230, ls_hurricane: 1239, ls_hydro_blast: 1235, ls_vampiric_claw: 1234, ls_tempest: 1176, ls_major_heal: 1401 });
assert.deepEqual({ ...A.LIFE_STONE }, { C: 10409, B: 10410, A: 10411, S: 10412 }); assert.deepEqual({ ...A.GEMSTONE }, { C: 2131, B: 2132, A: 2133, S: 2134 });
// посох игрока Daimon Crystal +7 (A) с ЛС — так сервер отдаёт надетое оружие
const eq = { l1: { itemId: 8688, enchant: 7, enchantMAtkBonus: 46, augmentation: { uid: '0b5d1f2a-1c2d-4e3f-8a9b-0c1d2e3f4a5b', outcomeId: 'prominence', grade: 'A' } }, l3: { itemId: 2409 } };
assert.deepEqual({ ...A.ofEq(eq) }, { w: 8688, e: 7, o: 'prominence', g: 'A' });
assert.deepEqual({ ...A.ofEq({ l1: { itemId: 8688, enchant: 7 } }) }, { w: 8688, e: 7, o: null, g: null }, 'no Life Stone');
assert.deepEqual({ ...A.ofEq({ l3: { itemId: 2409 } }) }, { w: 0, e: 0, o: null, g: null }, 'weapon removed');
assert.equal(A.keep({ o: 'prominence' }), true); assert.equal(A.keep({ o: 'matk_6' }), true); assert.equal(A.keep({ o: 'bad_matk_10' }), false); assert.equal(A.keep({ o: null }), false);
assert.deepEqual({ ...A.tryCost('A') }, { aa: 100000, adena: 30000, aaGem: 187000 }, 'A attempt: Life Stone A 100k AA + Gemstone A 30k adena (gm-shop)');
// шансы из новости игры 12.10: плюсы 6,364 %, умения 9 %, минусы 84,636 %
const sum = k => Object.values(A.OUT).filter(o => o.k === k).reduce((a, o) => a + o.p, 0);
assert.ok(Math.abs(sum('positive') - 6.364) < 0.01 && Math.abs(sum('active') - 9) < 1e-9 && Math.abs(sum('negative') - 84.636) < 1e-9, 'chances as announced');
assert.match(A.OUT.matk_6.n, /M\.Atk \+15%/); assert.match(A.OUT.mage_skill_5.n, /\+15%/);
// магу полезно: 5 ударных (6 %) + M.Atk +15 % + сила умений +15 % ≈ 7,8 % → ≈13 попыток в среднем
assert.ok(Math.abs(A.goodChance('mage') - 0.07818) < 0.0005); assert.equal(Math.round(A.triesFor('mage')), 13);
assert.equal(A.tryCost('D'), null, 'D-grade weapons cannot be augmented');
assert.match(A.text({ o: 'prominence', g: 'A' }), /Prominence.*Power 109.*A/);

// ---- hook.js: aug — только id/заточка/исход, без uid ----
const hook = read('hook.js'), augSrc = hook.match(/const augOf = (o => \{[\s\S]*?\} catch \(e\) \{ return undefined; \} \});/);
assert.ok(augSrc, 'augOf in hook.js'); const augOf = vm.runInNewContext(augSrc[1]);
const got = augOf({ character: { inventory: { stacks: [], eq } } });
assert.deepEqual({ ...got }, { w: 8688, e: 7, o: 'prominence', g: 'A' }); assert.ok(!JSON.stringify(got).includes('uid'), 'uid is not passed');
assert.equal(augOf({ character: { inventory: { stacks: [] } } }), undefined, 'no eq in the answer → nothing');
assert.equal(augOf({ character: { inventory: { eq: {} } } }), undefined, 'empty eq → nothing (not "weapon removed")');
assert.equal((hook.match(/aug: augOf\(o\)/g) || []).length, 2, 'fetch and XHR');

// ---- content.js: умение ls_* на панели → справочник Interlude, Power 109; имя слота запоминается ----
const content = read('content.js');
const region = content.slice(content.indexOf('const IL = typeof IL_DB'), content.indexOf('const ilNum = '));
const csb = { console, rt: { skills: {}, skillDb: {} }, L2Aug: A }; csb.globalThis = csb; vm.createContext(csb);
vm.runInContext(read('skills-il.js').replace('const IL_DB', 'globalThis.IL_DB'), csb);
vm.runInContext(region + content.match(/const ilNum = .*\n/)[0] + content.match(/function powerOf\(k\) \{[\s\S]*?\n\}\n/)[0]
  + 'globalThis.T = { ilOf, powerOf, LS_BY_NAME, IL_FIX };', csb);
const T = csb.T;
const slot = (title, cd) => ({ title, querySelector: s => s === '[data-slot-cd]' ? { dataset: { slotCd: cd } } : null });
const il = T.ilOf(slot('Пломінь', 'ls_prominence'));
assert.equal(il.id, 1230); assert.equal(il.c, 'Маг. атака'); assert.equal(il.pow, 109, 'L2WAP Power 109'); assert.equal(il.t, 'MDAM');
assert.equal(T.LS_BY_NAME['пломінь'], 1230, 'slot name remembered');
assert.equal(T.ilOf('Пломінь').id, 1230, 'found by the game name afterwards');
assert.equal(T.powerOf('пломінь'), 109, 'estimate before the first hit — Power 109');
assert.equal(T.ilOf('ls_hydro_blast').id, 1235, 'disabled slot (weapon removed) is titled by the action id');
assert.equal(T.ilOf(slot('Tempest', 'ls_tempest')).target, 'AREA');
assert.equal(T.ilOf(slot('Major Heal', 'ls_major_heal')).t, 'HEAL');
assert.equal(T.ilOf(slot('Blaze', 'l2_1220')).id, 1220, 'ordinary skills as before');
assert.equal(T.powerOf('blaze'), 0, 'ordinary skill without data — no invented power');
// бой: имя действия хода ls_* → слот панели (анализатор боя)
assert.match(content, /const b = \/\^\(\?:l2_\\d\+\|ls_\[a-z_\]\+\)\$\/\.test\(a\)/);

// ---- content.js augNote: rt.weaponAug и журнал ----
const an = content.match(/function augNote\(a, path\) \{[\s\S]*?\n\}\n/)[0];
const recs = [], nsb = { console, Date, AUG: A, rt: {}, recs, itemOf: id => id === 8688 ? { n: 'Daimon Crystal' } : null }; nsb.globalThis = nsb; vm.createContext(nsb);
vm.runInContext(an + 'globalThis.augNote = augNote; globalThis.setRt = p => Object.assign(rt, p); globalThis.rec = (...a) => recs.push(a);', nsb);
nsb.augNote({ w: 8688, e: 7, o: null, g: null }, '/character');
assert.equal(nsb.rt.weaponAug.w, 8688); assert.equal(recs.length, 0, 'first record without Life Stone — silent');
nsb.augNote({ w: 8688, e: 7, o: 'prominence', g: 'A' }, '/character/weapon-augmentation');
assert.equal(nsb.rt.weaponAug.k, 'active'); assert.equal(recs.length, 1); assert.match(recs[0][2], /Life Stone на Daimon Crystal \+7: Prominence.*панель боя/);
nsb.augNote({ w: 8688, e: 7, o: 'prominence', g: 'A' }, '/character'); assert.equal(recs.length, 1, 'same → no repeat');
nsb.augNote({ w: 8688, e: 7, o: 'bad_matk_10', g: 'A' }, '/character/weapon-augmentation'); assert.match(recs[1][2], /отрицательный/);
nsb.augNote({ w: 8688, e: 7, o: null, g: null }, '/character/weapon-augmentation'); assert.match(recs[2][2], /снят/);
assert.match(content, /if \(d\.aug && tabOwner\) try \{ augNote\(d\.aug, path\); \}/);

// ---- equipment: оружие с полезным ЛС бот сам не меняет ----
const equip = read('modules/equipment.js');
assert.match(equip, /augHold = !!\(aw && aw\.o && \(aw\.k === 'active' \|\| aw\.k === 'positive'\)/);
assert.match(equip, /&& better && !augHold\) \{/);
// ---- проводка ----
assert.match(read('manifest.json'), /"fa-full.js",\s*"augment.js",/); assert.match(read('popup.html'), /<script src="augment.js"><\/script>/);
assert.match(read('popup.js'), /function augLine\(rt\)/);
// Старый боевой слой не отправляет ЛС: новый модуль серии имеет отдельные проверки и лимиты.
for (const f of ['popup.js', 'background.js', 'hook.js', 'augment.js', ...fs.readdirSync(path.join(root, 'modules')).filter(x => x !== 'lifestone.js').map(x => 'modules/' + x)])
  assert.ok(!/\/character\/weapon-augmentation/.test(read(f)), f + ': no augmentation request');
console.log('PASS: 10.0.2 Life Stone — outcomes as in the game, hook aug, ls_* skills (Power 109) on the panel, rt.weaponAug, weapon with a good Life Stone is kept');
