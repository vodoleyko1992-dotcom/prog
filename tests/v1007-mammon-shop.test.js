'use strict';
// 10.0.7 (игрок 13.10 02:38, скрин раздела «Сырьё»: «Кристал: ранг D · нет в фарме» 900/0/900; «кристаллы покупаются в магазине»):
// сырьё цели Маммона, которое продаёт gm-shop (кристаллы, самоцветы, Soul/Spirit Ore), — «магазин», а не «нет в фарме»; бот докупает
// его в обычной закупке расходников (вкладка грейда, подраздел «Ресурси»), фармить его не пытается; источник в базе фарма ищется
// по всем именам предмета (на скрине «Залізна руда · нет в фарме» при «iron ore» в базе — справочник предметов не был загружен)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, location: { pathname: '/map.html', href: '' }, document: { querySelectorAll: () => [], querySelector: () => null } };
sb.globalThis = sb; vm.runInNewContext(read('modules/mammon.js'), sb); vm.runInNewContext(read('modules/economy.js'), sb);
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);   // объекты из vm — сравнение по JSON
const mk = ({ inv = {}, cfg = {}, ITEMS = null, FARM = { res: { 'iron ore': { name: 'Iron Ore' } } } } = {}) => {
  const recs = [];
  const env = { rt: { mmEq: { belt: [920018, 0] } }, cfg: { mmGoalItem: 920018, mmGoalLvl: 2, mmTpMax: 500000, ...cfg }, recs, setRt: async p => Object.assign(env.rt, p),
    rec: (...a) => recs.push(a.join(' ')), invQty: id => inv[id] ?? null, ITEMS, FARM };
  return { env, M: sb.L2V7Factories.mammon(env) };
};
// Lv.0→1 по MM_KNOWN: 100 Crystal D + 100 Iron Ore + 100 Mithril Ore + 3 Steel (= 15 Iron Ore + 15 Varnish); Lv.1→2 — оценка ×2
const INV = { 57: 9e6, 4037: 3, 1458: 0, 1869: 1984, 1876: 1607, 1865: 2961 };

// 1. сырьё: кристалл D — «магазин» (грейд D, ≈650 аден), не «нет в фарме»; руда — в базе фарма по английскому имени без справочника
{ const { env, M } = mk({ inv: INV });
  const P = M.goalAll(), cr = P.raw.find(r => r.id === 1458), ore = P.raw.find(r => r.id === 1869);
  same(cr.shop, { g: 'D', a: 650 }); assert.equal(cr.miss, 300); assert.equal(cr.farm, false);
  assert.equal(ore.farm, true, 'farm source found by the English name even when the item db is not loaded (nm is Ukrainian/recipe name)');
  assert.equal(P.raw.find(r => r.id === 1876).shop, null, 'Mithril Ore is not sold in the gm-shop');
  // строка плана для меню: [имя, нужно, есть, не хватает, фарм, грейд магазина, цена]
  M.goalNote();
  const row = env.rt.mmGoalPlan.raw.find(r => r[0] === cr.nm);
  same(row.slice(3), [300, 0, 'D', 650]);
  assert.match(env.rt.mmGoalSt, /докуплю в магазине: Crystal: D-Grade 300 ≈ 195\D000 аден/);
  assert.doesNotMatch(env.rt.mmGoalSt, /в базе фарма источников нет/, 'the "no farm source" note goes only when nothing can be bought either');
  // цель фарма: кристалл не фармим (купим), руды хватает → цели нет
  assert.equal(M.mmFarmGoal(), null);
  // позиция для закупки: вкладка D, подраздел «Ресурси», ровно недостача, имя по-украински и по-английски
  const w = M.mmShopWant(); assert.equal(w.length, 1);
  assert.equal(w[0].key, 'mm1458'); assert.equal(w[0].grade, 'D'); assert.equal(w[0].sub, 'resources'); same(w[0].ids, [1458]); same(w[0].mm, [300, 300]);
  assert.ok(w[0].name.test('Кристал: ранг D') && w[0].name.test('Crystal: D-Grade') && !w[0].name.test('Кристал: ранг C'));
  // докупка выключена: в закупку не идёт, в статусе — «продаётся в магазине (докупка выключена)»
  env.cfg.mmShopBuy = false; same(M.mmShopWant(), []);
  M.goalNote(); assert.match(env.rt.mmGoalSt, /продаётся в магазине \(докупка выключена\)/);
}
// 2. в сумке кристаллов хватает → ничего не покупаем; цели нет → пусто
{ const { env, M } = mk({ inv: { ...INV, 1458: 900 } }); same(M.mmShopWant(), []);
  env.cfg.mmGoalItem = 0; same(M.mmShopWant(), []); }
// 3. закупка (economy): позиция Маммона в плане, проверка запасов видит её по сумке из сети, подраздел магазина — «resources»
{ const net = { 3950: 4200, 1061: 921, 728: 900, 1458: 0 };
  const { M } = mk({ inv: INV });
  const env = { cfg: { shopAuto: true, shopShots: '1000/5000', shopHp: '300/1000', shopMp: '200/1000' },
    rt: { weaponsT: Date.now(), weapons: [{ name: "Sprite's Staff", g: 'B', wt: 'двуруч. дубина', pa: 189, ma: 132, where: 'надето' }] },
    MAGE: '#mage', classWeaponTypes: () => ({ types: ['#mage'] }), combatProfileKind: () => 'mage_summoner', heroLevel: () => 56,
    GRADE_LV: { NG: 0, D: 20, C: 40, B: 52, A: 61, S: 76 }, BSPS_IDS: { NG: 3947, D: 3948, C: 3949, B: 3950, A: 3951, S: 3952 }, SHOT_IDS: { NG: 1835, D: 1463, C: 1464 },
    pair: (v, d) => { const m = String(v ?? d).match(/(\d+)\s*\/\s*(\d+)/); return m ? [+m[1], +m[2]] : [0, 0]; },
    qty: () => null, slotsBy: () => [], shotSlot: () => null, invQty: id => net[id] ?? null, setRt: async () => {}, rec: () => {}, mmShopWant: () => M.mmShopWant() };
  const E = sb.L2V7Factories.economy(env);
  const it = E.shopPlan().find(x => x.key === 'mm1458'); assert.ok(it, 'Mammon crystals are in the shop plan'); assert.equal(it.grade, 'D');
  assert.equal(E.shopNeedByPanel(), 'Кристал: ранг D (Маммон) 0 < 300');
  net[1458] = 300; assert.equal(E.shopNeedByPanel(), '', 'enough in the bag — no trip');
  delete net[1458]; assert.equal(E.shopNeedByPanel(), '', 'bag not read from the network yet — wait, no trip');
  env.mmShopWant = () => { throw new Error('boom'); }; assert.ok(E.shopPlan().some(x => x.key === 'shots'), 'a failing Mammon plan does not break the shop plan');
}
// 4. проводка: ядро отдаёт economy геттер mmShopWant, умолчание mmShopBuy = ВКЛ, меню — галка и подпись «магазин» вместо «нет в фарме»
{ const content = read('content.js'), popup = read('popup.js'), html = read('popup.html'), eco = read('modules/economy.js');
  assert.match(content, /get mmShopWant\(\) \{ return \(\) => L2V7Modules\.mammon\?\.mmShopWant\?\.\(\) \|\| \[\]; \}/);
  assert.match(content, /mmGoalFarm: true, mmShopBuy: true,/);
  assert.match(popup, /mmGoalFarm: true, mmShopBuy: true,/); assert.match(popup, /'mmGoalFarm', 'mmShopBuy',/);
  assert.match(popup, /·магазин ≈\$\{fmt\(r\[6\]\)\}/); assert.match(html, /id="mmShopBuy" type="checkbox"/);
  assert.match(eco, /const sub = SUB\[it\.key\] \|\| it\.sub \|\|/);
}
console.log('v1007-mammon-shop: PASS');
