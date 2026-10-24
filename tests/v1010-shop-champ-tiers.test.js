'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 10.0.10 (игрок 13.10 11:33): «адены мало, но хотя бы 1000 или 5000 сосок купить может, или зелья — не 1000, а 100» (лог 19:41: alt1
// 204 960 аден — первыми банки MP по 2 200, на заряды 23 шт.); «включены нападения на красных, которые кидают кансел… уходит и
// возвращается к нему же… добавь опции, каких чемпионов бить, особенно на лоу лвлах».
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const load = (file, env) => { const c = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, Promise, URLSearchParams, document: { querySelector: () => null, querySelectorAll: () => [] }, location: { pathname: '/', search: '' } }; c.window = c; c.globalThis = c; vm.runInNewContext(read(file), c); return file.endsWith('/champs.js') ? require('./champs-context-fixture.cjs').freshChamps(c.L2V7Factories.champs,env) : c.L2V7Factories[path.basename(file, '.js')](env); };
(async () => {
  // 1. закупка: порядок, доли, круглые пачки
  const E = load('modules/economy.js', { cfg: {}, rt: {} });
  assert.deepEqual([E.SHOP_ORDER.shots, E.SHOP_ORDER.hp, E.SHOP_ORDER.mp], [0, 1, 2], 'заряды → HP → MP');
  assert.equal(E.shopShare('shots', ['hp', 'mp', 'spirit']), 0.5, 'заряды — половина денег, если дальше банки');
  assert.equal(E.shopShare('hp', ['mp']), 0.5, 'HP — половина остатка, если дальше MP');
  assert.equal(E.shopShare('mp', ['spirit', 'soul']), 1, 'MP — всё, что осталось (руда не в счёт)');
  assert.equal(E.shopShare('spirit', ['soul']), 1);
  assert.equal(E.packQty(2040, 5000), 2000, '2 040 → пачка 2 000');
  assert.equal(E.packQty(17, 1000), 10, '17 банок → 10');
  assert.equal(E.packQty(460, 997), 400);
  assert.equal(E.packQty(7, 1000), 7, 'меньше 10 — сколько хватает');
  assert.equal(E.packQty(5000, 5000), 5000, 'хватает на всё — без округления');
  // лог 19:41: 204 960 аден, резерв = половина → 102 480 на закупку: заряды 25 → 2 000 шт. (а было 23); банки HP/MP после
  const money = 102480, shots = E.packQty(Math.floor(money * 0.5 / 25), 5000);
  assert.equal(shots, 2000);
  const eco = read('modules/economy.js');
  assert.match(eco, /const needs = \[\.\.\.st\.need\]\.sort\(\(a, b\) => ord\(a\.key\) - ord\(b\.key\)\);/);
  assert.match(eco, /shopBuyOne\(it, n\.buy, spent, shopShare\(n\.key, rest\)\)/);
  assert.match(eco, /const cap = cap0 > 0 \? packQty\(cap0, qtyWant\) : 0;/);

  // 2. чемпионы: галки цвета и порог уровня
  let lvl = 30;
  const env = { cfg: {}, rt: { lvl: 30 }, heroLvl: () => lvl, farmRate: () => null, setRt: async p => Object.assign(env.rt, p) };
  const C = load('modules/champs.js', env);
  assert.match(C.tierOff({ tier: 'red', lvl: 30 }) || '', /красный — таких не бью/, 'красные по умолчанию ВЫКЛ');
  assert.equal(C.tierOff({ tier: 'orange', lvl: 30 }), null);
  assert.equal(C.tierOff({ tier: 'blue', lvl: 30 }), null);
  const j = C.judge({ tier: 'red', lvl: 30, hp: 1000, exp: 100 });
  assert.ok(!j.ok && j.off && /не бью/.test(j.why), 'judge: красный — не цель');
  env.cfg.champRed = true; assert.equal(C.tierOff({ tier: 'red', lvl: 30 }), null, 'галка «Красных» включает');
  env.cfg.champBlue = false; assert.match(C.tierOff({ tier: 'blue' }) || '', /синий/);
  env.cfg.champBlue = true;
  lvl = 15; assert.match(C.tierOff({ tier: 'blue', lvl: 16 }) || '', /герой 15 ур\. — чемпионов бью с 20 ур\./, 'порог 20 ур. по умолчанию');
  env.cfg.champMinLvl = 0; assert.equal(C.tierOff({ tier: 'blue', lvl: 16 }), null, '0 = с любого уровня');
  // вердикт отхода держит и при заходе цепочкой
  lvl = 30; env.cfg.champMinLvl = 0;
  await C.learn({ champ: true, tier: 'orange', lvl: 32, chHp0: 20000, chLim: 60, heroLvl0: 30 }, 'weak', 100, 10);
  assert.match(C.held({ tier: 'orange', lvl: 32 }) || '', /жду роста силы/, 'held: тот же чемпион после отхода');
  assert.equal(C.held({ tier: 'blue', lvl: 32 }), null);
  const cmb = read('modules/combat.js');
  assert.match(cmb, /const off = env\.champs\?\.tierOff\?\.\(ctx\) \|\| env\.champs\?\.held\?\.\(ctx\)/, 'бой цепочкой: выключенный цвет / вердикт → на карту');

  // 3. настройки и меню
  const ct = (read('defaults.js') + '\n' + read('content.js')), pj = (read('defaults.js') + '\n' + read('popup.js')), ph = read('popup.html'), bp = JSON.parse(read('base-profile.json'));
  assert.match(ct, /champBlue: true, champOrange: true, champRed: false, champMinLvl: 20,/);
  assert.match(pj, /const DEF = L2Defaults\.CFG;/);   // 20.13 (шаг 7): меню — те же умолчания, что движок (defaults.js)
  assert.match(pj, /'champBlue', 'champOrange', 'champRed',/); assert.match(pj, /'champMinLvl',/);
  for (const id of ['champBlue', 'champOrange', 'champRed', 'champMinLvl']) assert.match(ph, new RegExp(`id="${id}"`));
  assert.equal(bp.cfg.champRed, false); assert.equal(bp.cfg.champMinLvl, 20);
  console.log('PASS: 10.0.10 shop + champion tiers — shots → HP → MP with budget shares and round packs, colour toggles (red off), hero level floor 20, retreat verdict holds on chain entry');
})().catch(e => { console.error(e); process.exit(1); });
