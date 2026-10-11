'use strict';
// 9.0 (игрок 11.10: «давай сделаем функцию исполнения заказов и раздел Маммон — копить на определённую задачу и последовательно
// идти её делать»): заказ торговца из сумки (телепорт → «Здати» → обратно), цель «копить на улучшение у кузнеца», свои GET с токеном
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('modules/mammon.js');
const load = (extra = {}) => { const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, location: { pathname: '/map.html', href: '' }, ...extra }; sb.globalThis = sb; vm.runInNewContext(src, sb); return sb; };
const GEAR = JSON.parse(read('mammon-gear.json'));
const mk = (rt = {}, cfg = {}, over = {}) => {
  const recs = [], fired = [], els = over.els || {};
  const sb = load({ location: over.location || { pathname: '/map.html', href: '' } });
  const env = { rt: { ...rt }, cfg: { mmOrders: true, mmTpMax: 500000, mmGoalLvl: 5, ...cfg }, recs, fired,
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), setStatus: () => {}, sleep: async () => {},
    waitX: async fn => fn(), fire: el => fired.push(el), $q: s => els[s] ?? null, isBattle: () => false, isFishing: () => false, fishState: () => null,
    fishNow: () => false, autonomyMode: () => 'hunt', tvtSoon: () => false, heroNick: () => 'Warlock', invQty: id => (over.inv || {})[id] ?? null,
    ITEMS: { 1458: { n: 'Crystal: D-Grade' }, 1869: { n: 'Iron Ore' }, 1876: { n: 'Mithril Ore' }, 1880: { n: 'Steel' } },
    FARM: { res: { 'iron ore': { name: 'Iron Ore' }, 'mithril ore': { name: 'Mithril Ore' } } },
    gameGet: over.gameGet || (async () => ({ ok: false, status: 401, json: async () => ({}) })), ...over.env };
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
    const f = M.mmFarmGoal(); assert.equal(f.key, 'mithril ore', 'first missing material with a farm source (Crystal D has none)'); assert.equal(f.left, 100);
    assert.ok(p.mats.find(m => m.nm === 'Steel').craft.includes('Iron Ore'), 'Steel recipe hint');
    env.cfg.mmGoalFarm = false; assert.equal(M.mmFarmGoal(), null, 'farming off'); env.cfg.mmGoalFarm = true;
    inv[1876] = 100; assert.equal(M.mmFarmGoal(), null, 'Mithril done → nothing farmable left');
    M.goalNote(); assert.ok(/не хватает Crystal: D-Grade 100, Steel 3/.test(env.rt.mmGoalSt), env.rt.mmGoalSt);
    inv[1458] = 100; inv[1880] = 3; assert.equal(M.goalPlan().ready, true); M.goalNote();
    assert.ok(/всё собрано.*Coin of Luck — улучшение жмёшь сам/.test(env.rt.mmGoalSt), env.rt.mmGoalSt);
    env.rt.mmEq = { belt: [920018, 5] }; assert.equal(M.goalPlan().done, true); }
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
  // 10. безопасность: модуль не шлёт POST и не жмёт «Покращити» (Coin of Luck тратит только игрок)
  assert.ok(!/method:\s*['"]POST/i.test(src), 'no own POST');
  assert.ok(!/Покращ|blacksmith\/upgrade['"`]|l2-mammon-upgrade-card__btn/.test(src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'never presses upgrade');
  // 11. ядро: свои GET с токеном страницы (без него 401), РБ/эпики тоже; цель Маммона в farmGoal; шаг в цикле; манифест; меню
  const c = read('content.js');
  assert.match(c, /const gameAuth = \(\) => \{ try \{ const t = localStorage\.getItem\('token'\); return t \? \{ Authorization: 'Bearer ' \+ t \}/);
  for (const f of ['modules/raid.js', 'modules/epics.js']) assert.match(read(f), /headers: env\.gameAuth\?\.\(\) \|\| \{\}/, f);
  assert.match(c, /cfg\.mmGoalItem\) \{ const m = L2V7Modules\.mammon\.mmFarmGoal\(\); if \(m\) return m; \}/);
  assert.ok(c.indexOf('L2V7Modules.mammon.mmStep()') > c.indexOf("if (rt.zoneGo && !isBattle())"), 'mammon step after zoneGo (return trip works)');
  assert.ok(c.indexOf('L2V7Modules.mammon.mmStep()') < c.indexOf("if (autonomyMode() === 'epic' && !isBattle())"));
  const mf = JSON.parse(read('manifest.json'));
  assert.ok(mf.content_scripts.some(s => s.js.indexOf('modules/mammon.js') >= 0 && s.js.indexOf('modules/mammon.js') < s.js.indexOf('content.js')));
  assert.ok(mf.web_accessible_resources[0].resources.includes('mammon-gear.json'));
  const html = read('popup.html'), pj = read('popup.js');
  for (const id of ['tab-mammon', 'mmOrders', 'mmTpMax', 'mmGoalItem', 'mmGoalLvl', 'mmGoalFarm', 'mmSmithAuto', 'mmOrderBox', 'mmGoalBox']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(pj, /const DEF = \{ mmOrders: true, mmTpMax: 500000, mmGoalItem: 0, mmGoalLvl: 5, mmGoalFarm: true, mmSmithAuto: true,/);
  assert.match(c, /const DEF_CFG = \{ mmOrders: true, mmTpMax: 500000, mmGoalItem: 0, mmGoalLvl: 5, mmGoalFarm: true, mmSmithAuto: true,/);
  const bp = JSON.parse(read('base-profile.json')).cfg; assert.equal(bp.mmOrders, true); assert.equal(bp.mmTpMax, 500000);
  console.log('PASS: 9.0 Mammon — order from bag (teleport ≤ limit, «Здати», winner check, back to the spot), never in battle/tours/TvT; goal «save up for an upgrade» (missing materials in order, farm source, craft hint, ready → player upgrades, Coin of Luck never), smith prices; own GETs with the page token (RB/epics 401 fixed)');
})().catch(e => { console.error(e); process.exit(1); });
