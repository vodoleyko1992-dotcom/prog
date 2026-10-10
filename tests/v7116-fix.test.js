'use strict';
// 7.1.16-fix: банки HP ищутся в подразделе «Банки», а не в последнем открытом «Заряды» (лог 09.10 23:38/23:48)
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
let active = 'charges', bought = null;
const ITEMS = { charges: ['Благословенний заряд духу', 'Заряд душі воїна'], vials: ['Зілля слабкого зцілення', 'Зілля зцілення', 'Зілля мани (мала банка)'], all: ['Благословенний заряд духу', 'Зілля зцілення'] };
const tab = sub => ({ getAttribute: k => k === 'aria-selected' ? String(active === sub) : null, classList: { contains: () => active === sub }, _sub: sub });
const tabs = { charges: tab('charges'), vials: tab('vials'), all: tab('all') };
const row = n => ({ querySelector: s => s === '.l2-gm-shop-name' ? { textContent: n } : s === '.l2-gm-shop-price' ? { textContent: '50' } : s === '.l2-gm-shop-buy' ? { _buy: n } : null });
const document = { querySelectorAll: s => s === '.l2-gm-shop-pager-btn' ? [{ disabled: true }, { disabled: true }] : s === '.l2-gm-shop-name' ? ITEMS[active].map(n => ({ textContent: n })) : s === '.l2-gm-shop-row' ? ITEMS[active].map(row) : [] };
const sb = { document, console, Date }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/economy.js'), 'utf8'), sb);
const env = { cfg: { shopReserve: 0, shopMaxSpend: 1e9 }, rt: {},
  $q: s => { const m = s.match(/data-consumablesub="(\w+)"/); if (m) return tabs[m[1]]; if (s === '.l2-gm-shop-adena__amount') return { textContent: '1000000' }; return null; },
  fire: el => { if (el?._sub) active = el._sub; if (el?._buy) bought = el._buy; return true; },
  waitX: async f => f(), sleep: async () => {}, rnd: () => 1, shown: () => false, setVal() {} };
const eco = sb.L2V7Factories.economy(env);
(async () => {
  await eco.shopBuyOne({ key: 'hp', name: /^(Зілля зцілення|Зелье исцеления|Healing Potion)$/i }, 10);
  assert.equal(active, 'vials', 'HP potions are searched in «Банки»');
  assert.equal(bought, 'Зілля зцілення');
  active = 'vials'; bought = null;
  await eco.shopBuyOne({ key: 'shots', name: /Благословенн\S* заряд дух/i }, 10);
  assert.equal(active, 'charges'); assert.equal(bought, 'Благословенний заряд духу');
  console.log('PASS: shop opens the right consumable sub-tab (vials / charges)');
  // заряды мага: грейд по надетому оружию, иначе по уровню; маг — по профилю/настройкам, даже если профессия ещё не прочитана
  Object.assign(env, { MAGE: '#mage', classWeaponTypes: () => ({ types: [] }), combatProfileKind: () => null, heroLevel: () => 24,
    GRADE_LV: { NG: 0, D: 20, C: 40, B: 52, A: 61, S: 76 }, BSPS_IDS: { NG: 3947, D: 3948, C: 3949, B: 3950, A: 3951, S: 3952 }, SHOT_IDS: { NG: 1835, D: 1463, C: 1464, B: 1465, A: 1466, S: 1467 }, pair: (v, d) => String(v || d).split('/').map(Number) });
  env.cfg.nShots = 'Благословенний заряд духу';
  // 7.1.30: оружие не прочитано — заряды не покупаем вовсе (было: грейд по уровню → куплены C-заряды при посохе D)
  env.rec = () => {}; env.setRt = async () => {};
  let shots = eco.shopPlan().find(x => x.key === 'shots');
  assert.equal(shots, undefined, 'no weapon info yet: shots are skipped, not guessed by level');
  env.rt.weapons = [{ name: 'Staff of Life', g: 'D', where: 'надето', pa: 74, ma: 72, wt: 'дубина' }];
  // 7.2 (лог 10.10 20:08): список оружия из базового профиля, инвентарь в этой установке не читали — заряды не покупаем
  assert.equal(eco.shopPlan().find(x => x.key === 'shots'), undefined, 'weapons from the base profile (no weaponsT) are not trusted');
  env.rt.weaponsT = Date.now();   // инвентарь прочитан
  shots = eco.shopPlan().find(x => x.key === 'shots');
  assert.equal(shots.grade, 'D'); assert.deepEqual([...shots.ids], [3948]); assert.match(shots.label, /Благосл/);
  env.rt.weapons = [{ name: 'Staff of Life', g: 'D', where: 'надето' }]; env.cfg.nShots = ''; env.combatProfileKind = () => 'mage_summoner';
  shots = eco.shopPlan().find(x => x.key === 'shots'); assert.equal(shots.grade, 'D'); assert.match(shots.label, /Благосл.*D/);
  env.rt.weapons = [{ name: 'Apprentice Wand', g: 'NG', where: 'надето' }];
  assert.equal(eco.shopPlan().find(x => x.key === 'shots').grade, 'NG', 'equipped NG weapon → NG shots');
  // вкладка грейда: ссылка grade=D, а игра открыла NG — бот переключает на D, покупает D
  let grade = 'NG'; active = 'charges'; bought = null;
  const gtab = gr => ({ getAttribute: k => k === 'aria-selected' ? String(grade === gr) : null, classList: { contains: () => grade === gr }, _grade: gr });
  const gtabs = { NG: gtab('NG'), D: gtab('D') }, q0 = env.$q, f0 = env.fire;
  env.$q = s => { const m = s.match(/data-grade="(\w+)"/); return m ? gtabs[m[1]] : q0(s); };
  env.fire = el => { if (el?._grade) grade = el._grade; return f0(el); };
  ITEMS.charges = ITEMS.charges.map(n => n);
  await eco.shopBuyOne({ key: 'shots', grade: 'D', name: /Благословенн\S* заряд дух/i }, 10);
  assert.equal(grade, 'D', 'shop switches to the D grade tab before buying');
  console.log('PASS: shop switches the grade tab (page remembers the last grade)');
  console.log('PASS: mage buys Blessed Spiritshot of the equipped weapon grade (level fallback when unknown)');
  // заряды под оружие наперёд: магическое → духа, физическое → души; грейд = грейд оружия
  const W = [
    ['Staff of Life', 'дубина', 'D', 74, 72, true], ['Homunkulus\'s Sword', 'меч', 'C', 111, 101, true], ['Demon\'s Staff', 'двуруч. дубина', 'C', 152, 111, true],
    ['Spell Breaker', 'дубина', 'B', 140, 122, true], ['Dasparion\'s Staff', 'двуруч. дубина', 'A', 207, 143, true], ['Imperial Staff', 'двуруч. дубина', 'S', 274, 175, true],
    ['Arcana Mace', 'дубина', 'S', 225, 175, true], ['Saber', 'меч', 'D', 40, 26, false], ['Samurai Longsword', 'меч', 'C', 156, 83, false],
    ['Sword of Damascus', 'меч', 'B', 194, 99, false], ['Kris', 'кинжал', 'B', 153, 91, false], ['Elven Bow', 'лук', 'D', 105, 32, false],
    ['Dragon Slayer', 'двуруч. меч', 'A', 282, 114, false], ['Star Buster', 'двуруч. дубина', 'B', 236, 99, false], ['Forgotten Blade', 'меч', 'S', 281, 132, false],
    ['Bellion Cestus', 'кастеты', 'B', 236, 99, false], ['Glaive', 'древковое', 'D', 92, 54, false]];
  env.combatProfileKind = () => null; env.cfg.nShots = '';
  for (const [name, wt, g, pa, ma, mage] of W) {
    env.rt.weapons = [{ name, wt, g, pa, ma, where: 'надето' }];
    const sh = eco.shopPlan().find(x => x.key === 'shots');
    assert.equal(sh.grade, g, name + ' grade'); assert.equal(/Благосл/.test(sh.label), mage, name + ' type');
    assert.deepEqual([...sh.ids], [(mage ? env.BSPS_IDS : env.SHOT_IDS)[g]], name + ' item id');
  }
  console.log('PASS: shots follow the equipped weapon — magic/physical type and NG…S grade (' + W.length + ' weapons)');


})().catch(e => { console.error(e); process.exitCode = 1; });
