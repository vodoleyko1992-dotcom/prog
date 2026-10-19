'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 9.0 (игрок 11.10: «давай сделаем функцию исполнения заказов и раздел Маммон — копить на определённую задачу и последовательно
// идти её делать»): заказ торговца из сумки (телепорт → «Здати» → обратно), цель «копить на улучшение у кузнеца», свои GET с токеном
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('modules/mammon.js');
const load = (extra = {}) => { const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, location: { pathname: '/map.html', href: '' }, ...extra }; sb.globalThis = sb; vm.runInNewContext(src, sb); return sb; };
const eqJ = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const GEAR = JSON.parse(read('mammon-gear.json'));
// 10.0.14: имя в FARM ещё не означает доступный источник. План учитывает уровень героя и реальные drop/spoil через farmZones.
const farmCode = (read('defaults.js') + '\n' + read('content.js')), farmCut = re => { const m = farmCode.match(re); assert.ok(m, 'farmZones fixture contract'); return m[0]; };
// 10.0.22: необязательный фильтр доступности источников; прежние расчёты без фильтра сохраняются.
const zonesSrc = farmCut(/const farmWin = L =>[^\n]+\n/) + farmCut(/function farmFit\(l, L\) \{[\s\S]*?\n\}\n/) + farmCut(/function farmZones\(drop, L, above, sp = \[\], spK = 0\.8, accept = \(\) => true\) \{[\s\S]*?\n\}\n/);
const farmRes = {
  'iron ore': { name: 'Iron Ore', drop: [['Dismal Pole', 58, 16, 1, 3, 'fields_of_massacre', 'Fields of Massacre']], sp: [] },
  'mithril ore': { name: 'Mithril Ore', drop: [['Dismal Pole', 58, 7, 1, 3, 'fields_of_massacre', 'Fields of Massacre']], sp: [] }
};
const mk = (rt = {}, cfg = {}, over = {}) => {
  const recs = [], fired = [], els = over.els || {};
  const sb = load({ location: over.location || { pathname: '/map.html', href: '' } });
  const env = { rt: { ...rt }, cfg: { mmOrders: true, mmTpMax: 500000, mmGoalLvl: 5, ...cfg }, recs, fired,
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), setStatus: () => {}, sleep: async () => {},
    waitX: async fn => fn(), fire: el => fired.push(el), $q: s => els[s] ?? null, isBattle: () => false, isFishing: () => false, fishState: () => null,
    fishNow: () => false, autonomyMode: () => 'hunt', tvtSoon: () => false, heroNick: () => 'Warlock', invQty: id => (over.inv || {})[id] ?? null,
    ITEMS: { 1458: { n: 'Crystal: D-Grade' }, 1869: { n: 'Iron Ore' }, 1876: { n: 'Mithril Ore' }, 1880: { n: 'Steel' } },
    FARM: { res: farmRes }, heroLvl: () => 61, canSpoil: () => false,
    gameGet: over.gameGet || (async () => ({ ok: false, status: 401, json: async () => ({}) })), ...over.env };
  env.farmZones = vm.runInNewContext(`(cfg => { ${zonesSrc}; return farmZones; })`, { Math, Object })(env.cfg);
  return { env, M: sb.L2V7Factories.mammon(env), sb };
};
const req = (o = {}) => ({ requestId: 'r1', status: 'OPEN', resourceItemId: 1864, resourceNameEn: 'Stem', quantity: 42, reward: { coinOfLuck: 1, adena: 1500000 },
  expiresAt: new Date(Date.now() + 3600000).toISOString(), winnerName: null, playerHaveQty: 2299, ...o });
(async () => {
  // 1. заказ: ресурс есть → поход к торговцу; не хватает / уже пробовали / выключено / почти истёк — нет
  { const { env, M } = mk();
    const o = M.orderNote(req());
    assert.equal(o.qty, 42); assert.equal(o.have, 2299); assert.equal(o.adena, 1500000);
    assert.ok(env.recs.some(r => /новый заказ: Stem ×42/.test(r)), 'new order logged');
    const w = M.want(); assert.equal(w.kind, 'order'); assert.equal(w.id, 'r1');
    M.orderNote(req({ playerHaveQty: 10 })); assert.equal(M.want(), null, 'not enough → no trip');
    M.orderNote(req({ requestId: 'r2' })); env.rt.mmTried = { r2: Date.now() }; assert.equal(M.want(), null, 'tried once → no loop');
    M.orderNote(req({ requestId: 'r3' })); env.cfg.mmOrders = false; assert.equal(M.want(), null, 'switched off'); env.cfg.mmOrders = true;
    M.orderNote(req({ requestId: 'r4', expiresAt: new Date(Date.now() + 30000).toISOString() })); assert.equal(M.want(), null, 'expires in 30 s → skip');
    M.orderNote(req({ requestId: 'r5', status: 'CLAIMED', winnerName: 'tms' })); assert.equal(M.want(), null, 'claimed by other'); }
  // 2. отлучаться нельзя: бой, тур РБ/эпиков, РБ-сессия, рыба на крючке, перед TvT
  { const { env, M } = mk(); assert.equal(M.modeFree(), true);
    env.isBattle = () => true; assert.equal(M.modeFree(), false); env.isBattle = () => false;
    env.autonomyMode = () => 'raid'; assert.equal(M.modeFree(), false); env.autonomyMode = () => 'epic'; assert.equal(M.modeFree(), false); env.autonomyMode = () => 'hunt';
    env.rt.rbSess = { on: true }; assert.equal(M.modeFree(), false); env.rt.rbSess = null;
    env.isFishing = () => true; env.fishState = () => 'pump'; assert.equal(M.modeFree(), false); env.isFishing = () => false;
    env.cfg.tvtOn = true; env.tvtSoon = () => true; assert.equal(M.modeFree(), false); }
  // 3. поход начинается с точкой возврата (зона охоты), заказ помечен «пробовали»
  { const { env, M } = mk({ zone: 'ancient_battleground' }); M.orderNote(req());
    assert.equal(await M.mmStep(), true);
    assert.equal(env.rt.mmJob.kind, 'order'); assert.equal(env.rt.mmJob.home, 'ancient_battleground'); assert.ok(env.rt.mmTried.r1); }
  // 4. телепорт: дороже лимита / не за адену — не жмём; 500 000 — жмём
  for (const [cost, ok] of [['Ціна телепорту: 900000 Адена', false], ['Ціна телепорту: 5 Coin of Luck', false], ['Ціна телепорту: 500000 Адена', true], ['Ціна телепорту: Безкоштовно · VIP', true]]) {
    const btn = { disabled: false }, loc = { pathname: '/mammon-merchant-loc.html', href: '' };
    const { env, M } = mk({}, {}, { location: loc, els: { '#mammon-loc-teleport-btn': btn, '#mammon-loc-cost': { textContent: cost } } });
    await M.teleport({ kind: 'order', id: 'r1', step: 'go', t: Date.now(), why: 't' });
    assert.equal(env.fired.includes(btn), ok, cost);
    if (ok) assert.equal(env.rt.mmJob.step, 'act'); else assert.equal(env.rt.mmJob, null, 'job closed: ' + cost); }
  // 5. сдача: кнопка другого заказа — не жмём; свой заказ → «Здати» → проверка победителя → обратно на точку
  { const btn = { dataset: { requestId: 'other' }, disabled: false };
    const { env, M } = mk({}, {}, { location: { pathname: '/mammon-merchant.html', href: '' }, els: { '.l2-mammon-order-submit': btn } });
    await M.claim({ kind: 'order', id: 'r1', t: Date.now() }); assert.equal(env.fired.length, 0); assert.ok(env.rt.mmLog[0].why.includes('сменился')); }
  { const btn = { dataset: { requestId: 'r1' }, disabled: false };
    const gameGet = async p => ({ ok: true, status: 200, json: async () => ({ request: req({ status: 'CLAIMED', winnerName: 'Warlock' }) }) });
    const { env, M } = mk({}, {}, { gameGet, location: { pathname: '/mammon-merchant.html', href: '' }, els: { '.l2-mammon-order-submit': btn, '#mammon-merchant-shop-msg': { textContent: 'Замовлення виконано!' } } });
    await M.claim({ kind: 'order', id: 'r1', t: Date.now(), home: 'ancient_battleground' });
    assert.ok(env.fired.includes(btn)); assert.equal(env.rt.mmLog[0].ok, true, JSON.stringify(env.rt.mmLog));
    assert.equal(env.rt.zoneGo.id, 'ancient_battleground', 'back to the hunting spot'); assert.equal(env.rt.mmJob, null); }
  { const btn = { dataset: { requestId: 'r1' }, disabled: false };
    const gameGet = async () => ({ ok: true, status: 200, json: async () => ({ request: req({ status: 'CLAIMED', winnerName: 'Freed0m' }) }) });
    const { env, M } = mk({}, {}, { gameGet, location: { pathname: '/mammon-merchant.html', href: '' }, els: { '.l2-mammon-order-submit': btn } });
    await M.claim({ kind: 'order', id: 'r1', t: Date.now() }); assert.equal(env.rt.mmLog[0].ok, false); assert.ok(/опередил Freed0m/.test(env.rt.mmLog[0].why)); }
  // 6. цель «копить»: Пояс першопрохідця Lv.0 → 1 (цена со скриншота), материалы по порядку, источник — база фарма
  { const inv = { 1458: 0, 1869: 908, 1876: 0, 1880: 0 };
    const { env, M } = mk({ mmEq: { belt: [920018, 0] } }, { mmGoalItem: 920018 }, { inv });
    const p = M.goalPlan(); assert.equal(p.lvl, 0); assert.equal(p.a, 250000); assert.equal(p.col, 1);
    assert.deepEqual(JSON.stringify(p.mats.map(m => [m.nm, m.miss])), JSON.stringify([['Crystal: D-Grade', 100], ['Iron Ore', 0], ['Mithril Ore', 100], ['Steel', 3]]));
    const f = M.mmFarmGoal(); assert.equal(f.key, 'mithril ore', 'first missing material with a farm source (Crystal D has none)'); assert.equal(f.left, 1500, '9.2: all levels ahead (100+200+…+500)');
    assert.ok(p.mats.find(m => m.nm === 'Steel').craft.includes('Iron Ore'), 'Steel recipe hint');
    env.cfg.mmGoalFarm = false; assert.equal(M.mmFarmGoal(), null, 'farming off'); env.cfg.mmGoalFarm = true;
    env.cfg.mmGoalLvl = 1; inv[1876] = 100; assert.equal(M.mmFarmGoal(), null, 'target Lv.1: Mithril done → nothing farmable left (Steel → Varnish has no source in this FARM)');
    M.goalNote(); assert.ok(/наперёд не хватает Crystal: D-Grade 100, Varnish 15/.test(env.rt.mmGoalSt), env.rt.mmGoalSt);
    inv[1458] = 100; inv[1880] = 3; assert.equal(M.goalPlan().ready, true); M.goalNote();
    assert.ok(/всё собрано.*Coin of Luck — лечу к кузнецу улучшать/.test(env.rt.mmGoalSt), env.rt.mmGoalSt);   // 9.2.5: улучшение разрешено
    env.cfg.mmUpgrade = false; M.goalNote(); assert.ok(/всё собрано.*Coin of Luck — улучшение жмёшь сам/.test(env.rt.mmGoalSt), env.rt.mmGoalSt); env.cfg.mmUpgrade = true;
    env.rt.mmEq = { belt: [920018, 5] }; assert.equal(M.goalPlan().done, true); }
  // 6б. 9.2 (игрок 11.10: «собрать ВСЕ ресурсы наперёд», «ресурсы, из которых крафтятся улучшенные — передаю крафтеру»):
  // таблица по уровням до цели (неизвестные — оценка ×(L+1)), итог минус сумка, крафтовое разобрано до сырья, список крафтеру
  { const inv = { 1458: 0, 1869: 908, 1876: 0, 1880: 10, 1865: 0 };
    const { env, M } = mk({ mmEq: { belt: [920018, 0] } }, { mmGoalItem: 920018, mmGoalLvl: 5 }, { inv, env: { FARM: { res: { ...farmRes, varnish: { name: 'Varnish' } } } } });
    const P = M.goalAll();
    eqJ(P.lv.map(x => [x.L, x.est, x.a, x.m.find(m => m[0] === 1458)[2], x.m.find(m => m[0] === 1880)[2]]), [[0, 0, 250000, 100, 3], [1, 1, 500000, 200, 6], [2, 1, 750000, 300, 9], [3, 1, 1000000, 400, 12], [4, 1, 1250000, 500, 15]]);
    assert.equal(P.a, 3750000); assert.equal(P.col, 5);
    const T = Object.fromEntries(P.tot.map(t => [t.nm, [t.need, t.miss]])); eqJ(T, { 'Crystal: D-Grade': [1500, 1500], 'Iron Ore': [1500, 592], 'Mithril Ore': [1500, 1500], Steel: [45, 35] });
    const R = Object.fromEntries(P.raw.map(r => [r.nm, [r.need, r.miss, r.farm]]));
    eqJ(R['Iron Ore'], [1675, 767, true], '1500 direct + 35 Steel × 5, minus 908 in the bag'); eqJ(R.Varnish, [175, 175, true]); assert.equal(R['Crystal: D-Grade'][2], false);
    eqJ(P.craft.map(c => [c.nm, c.qty, c.runs]), [['Steel', 35, 35]], '10 Steel in the bag are not crafted again');
    // вложенный рецепт: Varnish of Purity → Coarse Bone Powder → Animal Bone; Cord (выход 20) → Steel → руда
    env.rt.mmCost = { '910623:1': { a: 1, c: 1, m: [[1887, 'Varnish of Purity', 6], [1884, 'Cord', 30]] } }; env.rt.mmEq = { tattoo: [910623, 1] }; env.cfg.mmGoalItem = 910623; env.cfg.mmGoalLvl = 2;
    const Q = M.goalAll(), RQ = Object.fromEntries(Q.raw.map(r => [r.nm, r.miss]));
    assert.equal(RQ['Animal Bone'], 180, '6 VoP × 3 CBP × 10 bones'); assert.equal(RQ['Stone of Purity'], 6); assert.equal(RQ.Thread, 50, 'Cord 30 → 2 runs (yield 20) × 25 Thread');
    assert.equal(RQ.Varnish, 18 + 0, '6 VoP × 3 Varnish; Steel for Cord comes from the bag (10)');
    assert.ok(Q.craft.findIndex(c => c.nm === 'Coarse Bone Powder') < Q.craft.findIndex(c => c.nm === 'Varnish of Purity'), 'ingredients are crafted first');
    // неизвестная цена без оценки (нет ни одной цены этой вещи и этого грейда) → «узнаю у кузнеца»
    env.rt.mmCost = {}; env.cfg.mmGoalItem = 920031; env.rt.mmEq = { wings: [920031, 0] };
    const U = M.goalAll(); eqJ(U.unk, [0, 1]); assert.equal(U.ready, false);
    // план для меню: компактный, пишется в rt один раз на изменение
    env.cfg.mmGoalItem = 920018; env.cfg.mmGoalLvl = 5; env.rt.mmEq = { belt: [920018, 0] }; M.goalNote();
    const G = env.rt.mmGoalPlan; assert.equal(G.lv.length, 5); assert.equal(G.cr[0][0], 'Steel'); assert.ok(/наперёд не хватает.*· добываю Mithril Ore · докуплю в магазине: Crystal: D-Grade 1\D500 ≈ 975\D000 аден · ≈ часть цен — оценка/.test(env.rt.mmGoalSt), env.rt.mmGoalSt);   // 10.0.7: кристаллы — из магазина
    const n = env.recs.length; M.goalNote(); assert.equal(env.recs.length, n, 'no journal spam');
    assert.equal(M.mmFarmGoal().left, 1500, 'farm the whole plan ahead'); }
  // 7. цены неизвестны → поход к кузнецу (не чаще раза в 6 ч); список кузнеца запоминает цены и уровни
  { const { env, M } = mk({ mmEq: { tattoo: [910623, 0] } }, { mmGoalItem: 910623 });
    assert.equal(M.goalPlan().noCost, true); assert.equal(M.want().kind, 'smith');
    env.rt.mmSmithT = Date.now(); assert.equal(M.want(), null, 'smith visited recently');
    env.rt.mmSmithT = 0; env.rt.mmEq = {}; assert.equal(M.want(), null, 'item not owned → no paid trip'); M.goalNote(); assert.ok(/этой вещи не вижу/.test(env.rt.mmGoalSt)); env.rt.mmEq = { tattoo: [910623, 0] };
    M.smithNote([{ itemId: 910623, nameUk: 'Татуювання річки', grade: 'D', level: 0, locationLabelUk: 'Одягнено', cost: { nextLevel: 1, adena: 300000, coinOfLuck: 1, materials: [{ itemId: 1876, nameUk: 'Міфрилова руда', required: 50 }] } }]);
    assert.deepEqual(JSON.stringify(M.costOf(910623, 0)), JSON.stringify({ a: 300000, c: 1, m: [[1876, 'Міфрилова руда', 50]], t: env.rt.mmCost['910623:0'].t }));
    assert.equal(env.rt.mmGear[0].eq, true); assert.equal(M.goalPlan().mats[0].nm, 'Mithril Ore', 'English name for the farm base'); }
  // 8. экипировка из /character: только улучшаемые вещи, уровень из объекта
  { const { env, M } = mk(); M.eqNote({ l1: 92, belt: 920018, neck: 935, cloak: { itemId: 920019, specialGearLevel: 2 }, tattoo: 910623 });
    assert.deepEqual(JSON.stringify(env.rt.mmEq), JSON.stringify({ belt: [920018, 0], cloak: [920019, 2], tattoo: [910623, 0] })); }
  // 9. справочник: 23 вещи, Lv.0–5, пояс со скриншота (крит 2 → 2,5 %)
  assert.equal(Object.keys(GEAR).length, 23);
  assert.equal(GEAR['920018'].L[1].equipMagicCritDamagePct, 2.5); assert.equal(GEAR['910623'].L[5].equipFlatMAtk, 389);
  // 10. безопасность: модуль не шлёт POST; «Покращити» жмёт только upgrade() (9.2.5: вещь-цель, cfg.mmUpgrade — tests/v925-mammon-upgrade.test.js)
  assert.ok(!/method:\s*['"]POST/i.test(src), 'no own POST');
  { const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''), up = code.slice(code.indexOf('async function upgrade('), code.indexOf('async function mmStep('));
    // 20.29: карточка повторно проверяется после записи намерения; все обращения по-прежнему только в upgrade().
    assert.equal((code.match(/l2-mammon-upgrade-card__btn/g) || []).length, (up.match(/l2-mammon-upgrade-card__btn/g) || []).length, 'upgrade button only in upgrade()'); assert.ok(up.includes('l2-mammon-upgrade-card__btn'));
    assert.ok(!/blacksmith\/upgrade['"`]/.test(code), 'no own upgrade POST'); assert.match(up, /env\.cfg\.mmUpgrade === false/); }
  // 11. ядро: свои GET с токеном страницы (без него 401), РБ/эпики тоже; цель Маммона в farmGoal; шаг в цикле; манифест; меню
  const c = (read('defaults.js') + '\n' + read('content.js'));
  assert.match(c, /const gameAuth = \(\) => \{ try \{ const t = localStorage\.getItem\('token'\); return t \? \{ Authorization: 'Bearer ' \+ t \}/);
  for (const f of ['modules/raid.js', 'modules/epics.js']) assert.match(read(f), /headers: env\.gameAuth\?\.\(\) \|\| \{\}/, f);
  assert.match(c, /cfg\.mmGoalItem\) \{ const m = L2V7Modules\.mammon\.mmFarmGoal\(\); if \(m\) return m; \}/);
  assert.ok(c.indexOf('L2V7Modules.mammon.mmStep()') > c.indexOf("if (rt.zoneGo && !isBattle())"), 'mammon step after zoneGo (return trip works)');
  assert.ok(c.indexOf('L2V7Modules.mammon.mmStep()') < c.indexOf("if (autonomyMode() === 'epic' && !isBattle())"));
  const mf = JSON.parse(read('manifest.json'));
  assert.ok(mf.content_scripts.some(s => s.js.indexOf('modules/mammon.js') >= 0 && s.js.indexOf('modules/mammon.js') < s.js.indexOf('content.js')));
  assert.ok(mf.web_accessible_resources[0].resources.includes('mammon-gear.json'));
  const html = read('popup.html'), pj = (read('defaults.js') + '\n' + read('popup.js'));
  for (const id of ['tab-mammon', 'mmOrders', 'mmTpMax', 'mmGoalItem', 'mmGoalLvl', 'mmGoalFarm', 'mmSmithAuto', 'mmOrderBox', 'mmGoalBox']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(pj, /const DEF = L2Defaults\.CFG;/);   // 20.13 (шаг 7): меню берёт умолчания движка из defaults.js
  assert.match(c, /const DEF_CFG = \{ mmOrders: true, mmTpMax: 500000, mmGoalItem: 0, mmGoalLvl: 5, mmGoalFarm: true, mmShopBuy: true, mmSmithAuto: true,/);
  const bp = JSON.parse(read('base-profile.json')).cfg; assert.equal(bp.mmOrders, true); assert.equal(bp.mmTpMax, 500000);
  console.log('PASS: 9.0 Mammon — order from bag (teleport ≤ limit, «Здати», winner check, back to the spot), never in battle/tours/TvT; goal «save up for an upgrade» (missing materials in order, farm source, craft hint, ready → upgrade at the smith (9.2.5) or the player), smith prices; own GETs with the page token (RB/epics 401 fixed)');
})().catch(e => { console.error(e); process.exit(1); });
