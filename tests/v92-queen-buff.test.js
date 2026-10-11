'use strict';
// 9.2 (игрок 11.10: «теперь Blessing of Queen — это бафф нашего кота», скрин окна кота Kai Lv.7: «Blessing of Queen Lv.1 · 02:00 · +20% Crit Damage
// слуги»; лог 12.10 02:44:49: нажатие слота «Summon Feline Queen» (l2_1331) → «Blessing of Queen застосовано до героя та активного слуги», MP −87):
// слот больше не призыв королевы, а бафф кота — роль «Баффы кота», не вариант «какого кота призывать», повтор каждые 2 мин даже в цепочке
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const names = s => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

// 1. справочник: IL_FIX 1331 — бафф на слугу, 120 с; миграция настроек
const content = read('content.js');
const fix = content.match(/1331: \{([^}]+)\}/)[1];
assert.match(fix, /c: 'Бафф'/); assert.match(fix, /target: 'PET'/); assert.match(fix, /dur: 120/); assert.match(fix, /mp: 87/);
assert.match(content, /once\('queenBuff92'/, 'миграция: королева → в «Баффы кота», из выбора кота — убрать');
assert.doesNotMatch(read('popup.html'), /<option value="Summon Feline Queen">/);
assert.match(read('popup.html'), /Blessing of Queen/);

// 2. роли панели: «Summon Feline Queen» → «Баффы кота», не призыв и не удар
{
  const IL = { 'Summon Feline Queen': { n: 'Summon Feline Queen', c: 'Бафф', t: 'BUFF', o: 'ACTIVE', target: 'PET', dur: 120, mp: 87 },
    'Summon Kai the Cat': { n: 'Summon Kai the Cat', c: 'Призыв', t: 'SUMMON', target: 'SELF' }, Blaze: { n: 'Blaze', c: 'Маг. атака', t: 'MDAM' },
    'Servitor Heal': { n: 'Servitor Heal', c: 'Лечение', t: 'HEAL', target: 'PET' } };
  const panel = Object.keys(IL).map((n, i) => ({ idx: i, name: n, title: n, kind: 'скилл', img: '' }));
  const env = { cfg: { autoRoles: true }, rt: { skills: {}, weapons: [] }, isBattle: () => true, panelInventory: () => panel, combatProfileKind: () => 'mage_summoner',
    ilOf: v => IL[typeof v === 'string' ? v : v?.name] || null, noEffect: () => false, names, iconStem: s => s, itemOf: () => null, expDmg: () => 1, isChargeName: () => false,
    isForceName: () => false, skillCost: () => 0, ilNum: x => Array.isArray(x) ? x[0] : x, normalizeProfession: x => x || '', CLASS_WEAPONS: {}, isEquip: () => false, slotsBy: () => [],
    heroLvl: () => 61, itemsDb: async () => null, setRt: async () => ({}), rec() {} };
  const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null } }; sb.globalThis = sb;
  vm.runInNewContext(read('modules/equipment.js'), sb);
  const r = sb.L2V7Factories.equipment(env).suggestRoles().roles;
  assert.deepEqual(names(r.nPetBuffs), ['summon feline queen'], 'Blessing of Queen — роль «Баффы кота»');
  assert.doesNotMatch(r.nPower || '', /feline/i); assert.doesNotMatch(r.nBuffs || '', /feline/i); assert.doesNotMatch(r.nHeal || '', /feline/i);
}

// 3. бой: бафф ставится, когда истёк (2 мин), даже если моб умрёт с одного удара (цепочка); королева — не кот для призыва
{
  const mk = (title, cd, il, kind = 'скилл') => ({ title, cd, il, kind, disabled: false, className: '', isConnected: true, getAttribute(k) { return k === 'data-slot-cd' ? this.cd : null; } });
  const queen = mk('Summon Feline Queen', 'l2_1331', { c: 'Бафф', t: 'BUFF', target: 'PET', dur: 120, mp: 87 });
  const haste = mk('Servitor Haste', 'l2_1141', { c: 'Бафф', t: 'BUFF', target: 'PET', dur: 1200 });
  const kai = mk('Summon Kai the Cat', 'l2_1111', { c: 'Призыв', t: 'SUMMON' });
  const slots = [mk('Blaze', 'l2_1220', { c: 'Маг. атака', t: 'MDAM' }), queen, haste, kai];
  const sb = { document: { querySelectorAll: () => slots, querySelector: () => null }, console, Date, sessionStorage: { getItem: () => null, setItem() {} } }; sb.globalThis = sb;
  vm.runInNewContext(read('modules/combat.js'), sb);
  const PET = { has: true, key: 'kai_the_cat', t: Date.now(), hp: 3000, maxHp: 3047 };
  const env = { SLOT: '.slot', cfg: { nPetBuffs: 'Summon Feline Queen, Servitor Haste' }, combatProfileKind: () => 'mage_summoner',
    rt: { skills: { blaze: { dmg: 31000, dmgN: 10, mp: 220, mpN: 10 } } }, $q: () => null, shown: () => false, cleanTitle: s => s, slotKind: b => b.kind, isEquip: () => false,
    ilOf: b => b?.il, slotCd: () => null, memLeft: () => 0, slotAction: b => b.cd, combatCooldown: { skillWait: () => 0 }, battleSpawn: () => 'x', skKey: b => b.title.toLowerCase(),
    names, skillMp: n => /feline/i.test(n) ? 87 : 20, expDmg: () => 3100, mpPotSlot: () => null, qty: () => null, petState: () => PET, heroLvl: () => 61, noEffect: () => false,
    setRt: async p => { Object.assign(env.rt, p); return { ok: true }; }, rec() {} };
  const C = sb.L2V7Factories.combat(env), mp = { cur: 4000, max: 5126 };
  const chain = { cur: 3060, max: 3060, pct: 100 };   // Banshee: умирает с одного Blaze — «осталось < 2 ходов»
  assert.equal(C.petBuffPick({ block: {} }, { pct: 100 }, mp, chain)?.n, 'summon feline queen', 'короткий бафф ставится и на мобе-однохитке');
  env.rt.petBuffAt = { 'summon feline queen': Date.now() - 60000 }; env.rt.petBornT = Date.now() - 600000;
  assert.equal(C.petBuffPick({ block: {} }, { pct: 100 }, mp, chain), null, 'висит (прошла 1 мин из 2) — Haste длинный, на однохитке его не ставим');
  env.rt.petBuffAt = { 'summon feline queen': Date.now() - 116000 };
  assert.equal(C.petBuffPick({ block: {} }, { pct: 100 }, mp, chain)?.n, 'summon feline queen', 'истёк (115 с из 120) — повтор');
  env.rt.petBuffAt = { 'summon feline queen': Date.now() - 1000 };
  assert.equal(C.petBuffPick({ block: {} }, { pct: 100 }, mp, { cur: 700000, max: 771340, pct: 91 })?.n, 'servitor haste', 'на РБ/толстом мобе — длинный бафф как раньше');
  assert.equal(C.petPick(slots.filter(b => /^summon/i.test(b.title)), '')?.title, 'Summon Kai the Cat', 'королева — не кот для призыва');
  assert.equal(C.petPick([queen], 'feline_queen'), null);
}
console.log('PASS: 9.2 Blessing of Queen — «Summon Feline Queen» is the cat buff (IL_FIX 1331: PET, 120 s, MP 87): role «Баффы кота», not a summon choice; recast every 2 min even in the hunt chain; migration queenBuff92');
