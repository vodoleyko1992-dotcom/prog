'use strict';
// 7.1.31: кот Warlock — разбор ударов кота из лога (обычный, крит, промах), добивание с учётом кота (только когда MP тратится),
// баффы кота, статистика и рекомендация, скиллы «в бою эффекта нет» (L2WAP: Servitor Wind Walk, Body To Mind),
// Corpse Life Drain (лечит, не бьёт) — не в ротации
const assert = require('node:assert/strict'); const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const mk = (title, cd, il, kind = 'скилл') => ({ title, cd, il, kind, disabled: false, className: '', isConnected: true,
  getAttribute(k) { return k === 'aria-disabled' ? null : k === 'data-slot-cd' ? this.cd : null; } });
const atk = mk('Атака', 'attack', null, 'атака');
const blaze = mk('Blaze', 'l2_1220', { c: 'Маг. атака', t: 'MDAM' }), eb = mk('Energy Bolt', 'l2_1274', { c: 'Маг. атака', t: 'MDAM' });
const cld = mk('Corpse Life Drain', 'l2_1151', { c: 'Маг. атака', t: 'DRAIN', target: 'CORPSE_MOB', L: 'Маг. урон с поглощением HP · труп моба' });
const haste = mk('Servitor Haste', 'l2_1141', { c: 'Бафф', t: 'BUFF', target: 'PET', dur: 1200 });
const walk = mk('Servitor Wind Walk', 'l2_9999', { c: 'Бафф', t: 'BUFF', target: 'PET' });
let slots = [atk, blaze, eb, cld, haste, walk];
let mobTxt = '5000 / 5000';
const sb = { document: { querySelectorAll: () => slots, querySelector: () => null }, console, Date,
  sessionStorage: { getItem: () => null, setItem() {} } }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8'), sb);
let PET = { has: true, key: 'mew_the_cat', t: Date.now(), hp: 700, maxHp: 750 };
const NOEFF = ['servitor wind walk', 'body to mind'];
const env = { SLOT: '.slot', cfg: {}, combatProfileKind: () => 'mage_summoner',
  rt: { skills: { blaze: { dmg: 895 * 10, dmgN: 10, mp: 220, mpN: 10 }, 'energy bolt': { dmg: 773 * 10, dmgN: 10, mp: 80, mpN: 10 }, 'атака': { dmg: 10, dmgN: 10 },
    'corpse life drain': { uses: 2, dmgN: 0 } } },
  $q: s => s === '#battle-mob-hp-val' ? { textContent: mobTxt } : null, shown: () => false, cleanTitle: s => s, slotKind: b => b.kind, isEquip: () => false, ilOf: b => b?.il,
  slotCd: () => null, memLeft: () => 0, slotAction: b => b.cd, combatCooldown: { skillWait: () => 0 }, battleSpawn: () => 'x', skKey: b => b.title.toLowerCase(),
  names: s => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
  skillMp: n => ({ blaze: 22, 'energy bolt': 8 })[String(n).toLowerCase()] || 20,
  expDmg: k => { const p = env.rt.skills[String(k).toLowerCase()]; return p?.dmgN ? p.dmg / p.dmgN : 0; },
  mpPotSlot: () => null, qty: () => null, petState: () => PET, heroLvl: () => 50,
  noEffect: b => NOEFF.includes(String(typeof b === 'string' ? b : b?.title).toLowerCase()),
  setRt: async p => { Object.assign(env.rt, p); return { ok: true }; }, rec() {} };
const C = sb.L2V7Factories.combat(env), mp = { cur: 600, max: 1000 };   // MP 60 % — мана тратится, добивание котом включено

// 1. разбор лога (реальные строки лога 10.10 19:35–19:45): обычный удар, крит, промах; пробелы/неразрывные пробелы в тысячах
const hits = [...C.petHits(['Слуга [Mew the Cat] атакує [Unicorn] 1 061 урону.', 'Слуга [Kai the Cat] атакує [Eva\'s Grove Guardian] 1 189 урону.',
  'Слуга [Kai the Cat] завдає критичного удару [Valley Treant Elder] 5 721 урону.', 'Слуга [Kai the Cat] промахнувся по [Unicorn].',
  'Полум’я 895', 'Вірний Слуга Кернона Келон', 'Слуга [Mew the Cat] атакує [Unicorn] 0 урону.'])];
assert.deepEqual(hits.map(h => [h.name, h.dmg, h.crit, h.miss]),
  [['Mew the Cat', 1061, false, false], ['Kai the Cat', 1189, false, false], ['Kai the Cat', 5721, true, false], ['Kai the Cat', 0, false, true]]);

// 2. ожидаемый удар кота: обычные удары (крит не в счёт), ≥ 5 замеров, кот действует почти на каждое действие, промахов ≤ 25 %
assert.equal(C.petExpect({ pet: { hits: 2, hitDmg: 2200, dmg: 2200, acts: 2 } }), 0, 'мало замеров — на кота не рассчитываем');
env.rt.petStat = { mew_the_cat: { hits: 40, hitDmg: 44000, crits: 1, misses: 1, dmg: 49000, acts: 42 } };
assert.equal(Math.round(C.petExpect({ pet: { hits: 0, dmg: 0, acts: 0 } })), Math.round(1100 * 0.85), 'по обычным ударам, крит не в счёт');
assert.equal(Math.round(C.petExpect({ pet: { hits: 2, hitDmg: 2000, dmg: 2000, acts: 2 } })), Math.round(1000 * 0.85), 'удары текущего боя важнее');
env.rt.petStat = { mew_the_cat: { hits: 20, hitDmg: 22000, dmg: 22000, acts: 42 } };
assert.equal(C.petExpect({ pet: { hits: 0, dmg: 0, acts: 0 } }), 0, 'кот бьёт через ход — не рассчитываем');
env.rt.petStat = { mew_the_cat: { hits: 30, hitDmg: 33000, misses: 12, dmg: 33000, acts: 42 } };
assert.equal(C.petExpect({ pet: { hits: 0, dmg: 0, acts: 0 } }), 0, 'промахов 29 % (> 25 %) — не рассчитываем');
env.rt.petStat = { mew_the_cat: { hits: 40, hitDmg: 44000, dmg: 44000, acts: 42 } };
PET = { ...PET, has: false };
assert.equal(C.petExpect({ pet: {} }), 0, 'кота нет — 0');
PET = { ...PET, has: true, t: Date.now() };

// 3. добивание: моб ≤ удара кота → бесплатная атака; чуть больше → дешёвое заклинание (EB 8 MP), а не Blaze
const ctx = () => ({ block: {}, pet: { hits: 0, dmg: 0, acts: 0 } });
mobTxt = '600 / 5000';
let a = C.magePlan(ctx(), mp);
assert.notEqual(a.key, 'attack', 'по умолчанию ВЫКЛ (игрок: MP не экономим, важен ДПС)');
env.cfg.petFinish = true;
a = C.magePlan(ctx(), mp);
assert.equal(a.key, 'attack'); assert.equal(a.pet, true, 'кот добьёт — атака');
a = C.magePlan(ctx(), { cur: 950, max: 1000 });
assert.notEqual(a.key, 'attack', 'MP 95 % — экономить нечего, промах кота стоил бы хода: бьём заклинанием');
mobTxt = '1500 / 5000';                     // кот ≈935 + EB 773 > 1500, Blaze 895 один не добил бы
a = C.magePlan(ctx(), mp);
assert.equal(a.name, 'Energy Bolt'); assert.match(a.why, /вместе с котом/);
env.cfg.petFinish = false;
mobTxt = '600 / 5000'; a = C.magePlan(ctx(), mp);
assert.notEqual(a.key, 'attack', 'выключено — по-старому, атаку мага (≈1) не жмём');
env.cfg.petFinish = true;
a = C.magePlan({ ...ctx(), rb: { id: 1 } }, mp);
assert.notEqual(a.key, 'attack', 'на РБ на кота не рассчитываем');
mobTxt = '5000 / 5000'; a = C.magePlan(ctx(), mp);
assert.equal(a.name, 'Blaze', 'толстый моб — сильнейшее заклинание, как раньше');

// 4. Corpse Life Drain и «в бою эффекта нет» — не в ротации
assert.deepEqual([...C.mageSpellSlots()].map(b => b.title), ['Blaze', 'Energy Bolt']);
env.rt.skills.mystery = { uses: 6, dmgN: 0 }; slots = [...slots, mk('Mystery', 'l2_1', null)];
assert(!C.mageSpellSlots().some(b => b.title === 'Mystery'), '6 нажатий без урона — не удар');
slots = slots.filter(b => b.title !== 'Mystery');

// 5. баффы кота
env.cfg.nPetBuffs = 'Servitor Wind Walk, Servitor Haste';
const big = { cur: 5000, max: 5000, pct: 100 }, hi = { cur: 900, max: 1000 };
const pb = C.petBuffPick({ block: {} }, { pct: 90 }, hi, big);
assert.equal(pb?.n, 'servitor haste', 'Wind Walk пропущен («в бою эффекта нет»), ставим Haste');
env.rt.petBuffAt = { 'servitor haste': Date.now() - 60000 }; env.rt.petBornT = Date.now() - 120000;
assert.equal(C.petBuffPick({ block: {} }, { pct: 90 }, hi, big), null, 'бафф висит — не трогаем');
env.rt.petBornT = Date.now() - 1000;
assert.equal(C.petBuffPick({ block: {} }, { pct: 90 }, hi, big)?.n, 'servitor haste', 'кота призвали заново — бафф снова');
assert.equal(C.petBuffPick({ block: {} }, { pct: 90 }, hi, { cur: 1500, max: 5000, pct: 30 })?.n, 'servitor haste', '9.2.2: моб при смерти — бафф всё равно (кот бьёт и на этот ход, бафф на 20 мин)');
assert.equal(C.petBuffPick({ block: {} }, { pct: 90 }, { cur: 200, max: 1000 }, big), null, 'мало MP — мана на урон');
PET = { ...PET, has: false };
assert.equal(C.petBuffPick({ block: {} }, { pct: 90 }, hi, big), null, 'кота нет — некому');
PET = { ...PET, has: true, t: Date.now() };
env.cfg.petBuffAuto = false;
assert.equal(C.petBuffPick({ block: {} }, { pct: 90 }, hi, big), null);
env.cfg.petBuffAuto = true;

// 6. статистика и рекомендация
(async () => {
  env.rt.petStat = {};
  await C.petFlush({ pet: { hits: 3, hitDmg: 3300, crits: 1, misses: 1, dmg: 9000, acts: 5, deaths: 0, summons: 1, resummons: 0, key: 'mew_the_cat', name: 'Mew the Cat' } }, 5000);
  const m = env.rt.petStat.mew_the_cat;
  assert.equal(m.fights, 1); assert.equal(m.dealt, 5000); assert.equal(m.crits, 1); assert.equal(m.misses, 1); assert.equal(m.hitDmg, 3300); assert.equal(m.dmg, 9000);
  assert.match(env.rt.petAdvice.text, /мало данных: Mew the Cat — 1\/30/);
  env.rt.petStat = { mew_the_cat: { name: 'Mew the Cat', fights: 40, hits: 120, dmg: 120000, acts: 125, summons: 2, resummons: 3, lvMin: 50, lvMax: 50 },
    kai_the_cat: { name: 'Kai the Cat', fights: 35, hits: 100, dmg: 140000, acts: 104, summons: 1, resummons: 1, lvMin: 50, lvMax: 50 } };
  const adv = C.petAdvice(env.rt.petStat);
  assert.equal(adv.best, 'kai_the_cat'); assert.match(adv.text, /держи Kai the Cat/);
  env.rt.petStat.kai_the_cat.dmg = 100000;   // ≈943 против ≈922 за ход — разница 2 %
  assert.match(C.petAdvice(env.rt.petStat).text, /почти равны/);
  env.rt.petStat = { kat_the_cat: { name: 'Kat the Cat', fights: 2000, hits: 6000, dmg: 6e6, acts: 6100, deaths: 40, summons: 40, resummons: 0 } };
  await C.petFlush({ pet: { hits: 3, hitDmg: 3000, dmg: 3000, acts: 3, deaths: 1, summons: 0, resummons: 0, key: 'kat_the_cat', name: 'Kat the Cat' } }, 4000);
  assert.equal(env.rt.petStat.kat_the_cat.fights, 1001, '2000+ боёв — счётчики пополам');
  assert.equal(env.rt.petStat.kat_the_cat.deaths, 21);
  console.log('PASS: cat — hit/crit/miss parsing, expected hit (no crits, miss guard), free attack / cheaper spell only when MP is spent, pet buffs, stats & advice, Corpse Life Drain out');
})().catch(e => { console.error(e); process.exit(1); });
