'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 10.0.7 (игрок 13.10: «автофарм расходников на апгрейд выбранного снаряжения… выбор оптимальных локаций, учитывать дроп и спойл;
// заготовка под саб крафтера и спойлера»): точка фарма по всем недостающим материалам цели Маммона, галки дроп/спойл, источники из
// игры (/game/farm-guide → дроп + спойл), заготовка modules/subclass.js (роль класса, свой крафт, помощник основного, передача)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const content = (read('defaults.js') + '\n' + read('content.js')), pj = (read('defaults.js') + '\n' + read('popup.js')), ph = read('popup.html'), bp = JSON.parse(read('base-profile.json')), mf = read('manifest.json');
const load = (file, extra = {}) => { const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, location: { pathname: '/map.html', href: '' }, ...extra }; sb.globalThis = sb; vm.runInNewContext(read(file), sb); return sb; };
// farmWin/farmFit/farmZones — вырезка из content.js (как в v721-farmwin)
const cut = (re, tag) => { const m = content.match(re); assert.ok(m, 'вырезка ' + tag); return m[0]; };
// 10.0.22: необязательный фильтр доступности источников; прежние расчёты без фильтра сохраняются.
const zonesSrc = cut(/const farmWin = L =>[^\n]+\n/, 'farmWin') + cut(/function farmFit\(l, L\) \{[\s\S]*?\n\}\n/, 'farmFit') + cut(/function farmZones\(drop, L, above, sp = \[\], spK = 0\.8, accept = \(\) => true\) \{[\s\S]*?\n\}\n/, 'farmZones');
const mkZones = cfg => vm.runInNewContext(`(cfg => { ${zonesSrc}; return farmZones; })`, { Math, Object })(cfg);
const FOM = 'fields_of_massacre', FOD = 'forest_of_dead', EV = 'enchanted_valley';
const FARM = { res: {
  'mithril ore': { name: 'Mithril Ore', drop: [['Dismal Pole', 58, 7, 1, 3, FOM, 'Fields of Massacre'], ['Fallen Orc Shaman', 58, 7, 1, 3, FOD, 'Forest of the Dead']], sp: [['Dismal Pole', 58, 42, 1, 3, FOM, 'Fields of Massacre'], ['Fallen Orc Shaman', 58, 42, 1, 3, FOD, 'Forest of the Dead']] },
  'iron ore': { name: 'Iron Ore', drop: [['Dismal Pole', 58, 16, 1, 3, FOM, 'Fields of Massacre'], ['Antelope', 68, 16, 1, 3, EV, 'Enchanted Valley'], ['Bandersnatch', 69, 16, 1, 3, EV, 'Enchanted Valley']], sp: [] },
  'varnish': { name: 'Varnish', drop: [['Antelope', 68, 11, 1, 3, EV, 'Enchanted Valley']], sp: [] } } };
const mk = (cfg = {}, rt = {}, over = {}) => {
  const recs = [], env = { rt: { mmGear: [{ id: 920018, n: 'Пояс першопрохідця', lvl: 0, g: 'D' }], ...rt }, cfg: { mmGoalItem: 920018, mmGoalLvl: 1, mmGoalFarm: true, mmShopBuy: true, ...cfg }, recs,
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), setStatus() {}, sleep: async () => {}, waitX: async fn => fn(), fire() {}, $q: () => null,
    isBattle: () => false, isFishing: () => false, fishState: () => null, fishNow: () => false, autonomyMode: () => 'hunt', tvtSoon: () => false, heroNick: () => 'Warlock',
    invQty: id => (over.inv || {})[id] ?? 0, ITEMS: { 1458: { n: 'Crystal: D-Grade' }, 1869: { n: 'Iron Ore' }, 1876: { n: 'Mithril Ore' }, 1880: { n: 'Steel' }, 1865: { n: 'Varnish' } },
    FARM, gameGet: async () => ({ ok: false, status: 401, json: async () => ({}) }), heroLvl: () => over.lvl ?? 61, canSpoil: () => over.spoil ?? false, spoilK: () => 0.8, ...over.env };
  env.farmZones = mkZones(env.cfg);
  const sb = load('modules/mammon.js');
  return { env, M: sb.L2V7Factories.mammon(env) };
};
(async () => {
  // 1. точка по всем материалам: пояс Lv.0→1 = Mithril Ore 100 + Iron Ore 100 + Steel 3 (15 Iron Ore + 15 Varnish) + Crystal D 100 (магазин).
  //    Fields of Massacre (мобы 58) даёт Mithril (редкое) и Iron Ore с одного моба → для героя 61 (окно 58–66) побеждает Enchanted Valley
  //    (мобы 68: Iron Ore + Varnish, но без Mithril); для героя 66 (окно 63–71) — наоборот: точка в окне уровней важнее (farmLvlBelow/Above игрока)
  { assert.equal(mk({}, {}, { lvl: 66 }).M.mmFarmGoal().pick.tp, EV, 'герой 66: мобы 58 вне окна −3…+5 → Enchanted Valley (Iron Ore + Varnish в окне)');
    const { env, M } = mk();
    const P = M.goalAll(); assert.ok(P.raw.find(r => r.nm === 'Mithril Ore').miss === 100 && P.raw.find(r => r.nm === 'Iron Ore').miss === 115, 'недостача: Mithril 100, Iron 115');
    const g = M.mmFarmGoal();
    assert.ok(g?.pick, 'цель с готовой точкой'); assert.equal(g.pick.tp, FOM, 'точка — Fields of Massacre'); assert.equal(g.key, 'mithril ore', 'главный ресурс — редкий Mithril Ore');
    assert.ok(g.pick.names.includes('Dismal Pole') && g.pick.res.length === 2, 'мобы точки и 2 ресурса'); assert.match(g.why, /точка по всем материалам/);
    assert.ok(g.pick.fights > 0 && isFinite(g.pick.fights), 'оценка боёв до закрытия');
    const B = M.farmPlanPt(P); assert.equal(B.pts.length, 2, 'две точки-кандидата (Enchanted Valley 68 > герой 61 + lvlAbove 6 — отсечена, как у фарма ресурса)'); assert.ok(B.pts[0].score > B.pts[1].score, 'лучшая первой');
    // Crystal D — магазин, в точку не идёт
    assert.ok(!B.pts.some(pt => pt.res.some(x => /crystal/i.test(x.nm))), 'кристаллы не фармим');
    // меню: rt.mmGoalPlan.pt
    M.goalNote(); const pt = env.rt.mmGoalPlan?.pt; assert.ok(pt?.pts?.[0]?.tp === FOM && pt.pts[0].r.length === 2 && pt.d === 1 && pt.s === 0, 'план точки в памяти для меню'); }
  // 2. спойл: Авто без умения — только дроп; Авто со спойлом / «Да» — Mithril ×6 (42 % против 7 %); «Нет» — дроп даже у спойлера; дроп выкл → только спойл
  { const dropOnly = mk().M.mmFarmGoal().pick.res.find(x => x.key === 'mithril ore').e;
    const withSp = mk({}, {}, { spoil: true }).M.mmFarmGoal().pick.res.find(x => x.key === 'mithril ore').e;
    const forced = mk({ mmFarmSpoil: 'on' }).M.mmFarmGoal().pick.res.find(x => x.key === 'mithril ore').e;
    const off = mk({ mmFarmSpoil: 'off' }, {}, { spoil: true }).M.mmFarmGoal().pick.res.find(x => x.key === 'mithril ore').e;
    assert.ok(withSp > dropOnly * 3 && Math.abs(withSp - forced) < 1e-9 && Math.abs(off - dropOnly) < 1e-9, `спойл: ${dropOnly.toFixed(2)} → ${withSp.toFixed(2)}`);
    const { M: M2 } = mk({ mmFarmDrop: false, mmFarmSpoil: 'on' }); const g2 = M2.mmFarmGoal(); assert.equal(g2.pick.res.length, 1, 'без дропа — только спойл Mithril');
    const { M: M3 } = mk({ mmFarmDrop: false, mmFarmSpoil: 'off' }); assert.equal(M3.mmFarmGoal(), null, '10.0.14: отключённые источники нельзя возвращать через старый путь');
    const { M: M4 } = mk({ mmFarmBest: false }); assert.equal(M4.mmFarmGoal().pick.res.length, 1, '10.0.14: по одному ресурсу, с точкой по разрешённым источникам'); }
  // 3. content: готовая точка цели важнее своей; тик источников в главном цикле; настройки по умолчанию; меню
  assert.match(content, /function farmPick\(goal\) \{\n  if \(goal\?\.pick\?\.tp\) return goal\.pick;/);
  assert.match(content, /farmGuideTick\(\);/); assert.match(content, /L2V7Modules\.subclass\.tick\(\)/);
  for (const k of ['mmFarmBest: true', "mmFarmSpoil: 'auto'", 'mmFarmDrop: true', 'mmFarmGuide: true', 'subCraftSelf: true', 'subSpoilFirst: true', 'subHelpMain: true']) { assert.ok(content.includes(k), 'DEF_CFG ' + k); assert.ok(pj.includes(k), 'DEF ' + k); }
  for (const k of ['mmFarmBest', 'mmFarmDrop', 'mmFarmSpoil', 'mmFarmGuide', 'subCraftSelf', 'subSpoilFirst', 'subMainNick', 'subHelpMain']) { assert.ok(ph.includes(`id="${k}"`), 'popup.html ' + k); assert.equal(bp.cfg[k] !== undefined, true, 'base-profile ' + k); }
  for (const id of ['mmGuideNow', 'subHandNow', 'subBox']) assert.ok(ph.includes(`id="${id}"`), id);
  assert.match(pj, /'mmFarmSpoil', 'subMainNick'\]/); assert.match(pj, /'subSpoilFirst', 'subHelpMain'\]/); assert.match(pj, /function renderSub\(rt, d\)/); assert.match(pj, /P\.pt\?\.pts\?\.length/);
  assert.match(mf, /"modules\/subclass\.js"/);
  // 4. источники из игры: ответ /game/farm-guide → FARM.res[имя].drop / .sp в формате farmRowParse, раздел и картинка прежние не стираются
  { const src = cut(/function farmGuideMerge\(db, data\) \{[\s\S]*?\n\}\n/, 'farmGuideMerge');
    const merge = vm.runInNewContext(`(() => { ${src}; return farmGuideMerge; })()`, { Math, Date, Array, String, Object });
    const db = { res: { 'mithril ore': { name: 'Mithril Ore', drop: [['Old', 1, 1, 1, 1, 'x', 'X']], sp: [], spoil: 0, cat: 'Ресурсы › Руда', icon: '/icons/old.jpg' } } };
    const data = { resourceTeleportAdenaCost: 50000, resources: [
      { itemId: 1876, nameEn: 'Mithril Ore', iconUrl: '/icons/resources/basic/mithril_ore.jpg', sources: [
        { mode: 'drop', mobName: 'Dismal Pole', mobLevel: 58, locationEn: 'Fields of Massacre', teleportId: FOM, chanceMin: 0.07, chanceMax: 0.07, qtyMin: 1, qtyMax: 3 },
        { mode: 'spoil', mobName: 'Dismal Pole', mobLevel: 58, locationEn: 'Fields of Massacre', teleportId: FOM, chanceMin: 0.42, chanceMax: 0.42, qtyMin: 1, qtyMax: 3 },
        { mode: 'drop', mobName: 'Без телепорта', mobLevel: 58, locationEn: '', teleportId: '', chanceMin: 0.07, chanceMax: 0.07, qtyMin: 1, qtyMax: 3 }] },
      { itemId: 1869, nameEn: 'Iron Ore', iconUrl: '/icons/resources/basic/iron_ore.jpg', sources: [{ mode: 'drop', mobName: 'Antelope', mobLevel: 68, locationEn: 'Enchanted Valley', teleportId: EV, chanceMin: 0.16, chanceMax: 0.16, qtyMin: 1, qtyMax: 3 }] },
      { itemId: 0, nameEn: '', sources: [] }] };
    const m = merge(db, data);
    assert.equal(JSON.stringify([m.n, m.dr, m.sp]), '[2,2,1]', 'ресурсов 2, дропа 2, спойла 1');
    const r = db.res['mithril ore'];
    assert.equal(JSON.stringify(r.drop), JSON.stringify([['Dismal Pole', 58, 7, 1, 3, FOM, 'Fields of Massacre']]), 'дроп в формате farmRowParse (шанс в %)');
    assert.equal(JSON.stringify(r.sp), JSON.stringify([['Dismal Pole', 58, 42, 1, 3, FOM, 'Fields of Massacre']]), 'спойл-источник');
    assert.ok(r.spoil === 1 && r.cat === 'Ресурсы › Руда' && r.icon === '/icons/old.jpg' && r.api === 1 && r.id === 1876, 'раздел/картинка прежние, id и метка api');
    assert.ok(db.res['iron ore'].icon === '/icons/resources/basic/iron_ore.jpg' && db.res['iron ore'].cat === 'Ресурсы', 'новой строке — картинка из ответа и раздел «Ресурсы»');
    assert.ok(!db.res[''], 'пустое имя пропущено'); }
  assert.match(content, /const FARM_GUIDE_URL = '\/game\/farm-guide', FARM_GUIDE_EVERY = 24 \* 3600000;/);
  assert.match(content, /if \(cfg\.mmFarmGuide === false \|\| !\(cfg\.mmGoalItem \|\| \(cfg\.farmRes \|\| ''\)\.trim\(\) \|\| \(cfg\.subMainNick \|\| ''\)\.trim\(\)\)\) return;/, 'без цели не читаем');
  // 5. заготовка под сабы: роль класса, слоты из /character, свой крафт блокирует отправку крафтеру, помощник основного
  { const S = load('modules/subclass.js');
    const shared = {}, recs = [];
    const mkSub = (cfg = {}, rt = {}, over = {}) => {
      const mm = mk(cfg, rt, over);
      const env = Object.assign(mm.env, { recs, rec: (...a) => recs.push(a.join(' ')), mammon: mm.M, heroNick: over.nick ? () => over.nick : mm.env.heroNick,
        sharedGet: async k => shared[k], sharedSet: async (k, v) => { shared[k] = v; } });   // тот же env, что у mammon (craftSelf/handWant видны ему)
      return { env, Sub: S.L2V7Factories.subclass(env), M: mm.M };
    };
    const { Sub } = mkSub();
    assert.equal(Sub.roleOf('dwarf_warsmith'), 'crafter'); assert.equal(Sub.roleOf('dwarf_artisan'), 'crafter'); assert.equal(Sub.roleOf('dwarf_bounty_hunter'), 'spoiler');
    assert.equal(Sub.roleOf('Scavenger'), 'spoiler'); assert.equal(Sub.roleOf('human_warlock'), null); assert.equal(Sub.roleOf('Warlock'), null);
    // слоты классов
    { const { env, Sub } = mkSub();
      assert.equal(Sub.charNote({ classSlots: { activeSlot: 0, secondAndThirdUnlocked: false, slots: [{ slot: 0, owned: true, active: true, profession: 'human_warlock', level: 66 }, { slot: 1, owned: false }] } }), true);
      assert.equal(JSON.stringify(env.rt.subSlots), JSON.stringify([{ slot: 0, prof: 'human_warlock', lvl: 66, on: true }])); assert.equal(env.rt.subUnlock, false);
      assert.equal(Sub.charNote({ classSlots: { activeSlot: 0, secondAndThirdUnlocked: false, slots: [{ slot: 0, owned: true, active: true, profession: 'human_warlock', level: 66 }] } }), false, 'без изменений — не пишем');
      assert.equal(Sub.charNote({}), false); }
    // крафтер: свой крафт → крафтеру не шлём (кнопка объясняет), план крафта из цели Маммона
    { const { env, Sub, M } = mkSub({}, { classCur: { prof: 'dwarf_warsmith', slot: 1 } });
      env.craftSelf = () => Sub.craftSelf();
      assert.equal(Sub.role(), 'crafter'); assert.equal(Sub.craftSelf(), true); assert.equal(Sub.isSub(), true);
      env.rt.mmCraftReq = { t: Date.now() }; const w = M.craftWant(); assert.match(w.drop, /крафтит сам/);
      const C = Sub.craftSelfPlan(); assert.ok(C && C.craft.some(c => c.nm === 'Steel' && c.qty === 3), 'план крафта: Steel 3');
      env.cfg.subCraftSelf = false; assert.equal(Sub.craftSelf(), false); assert.ok(!M.craftWant().drop?.includes('крафтит сам'), 'галка снята — крафтеру как раньше');
      assert.match(Sub.text(), /Warsmith.*саб, слот 1.*крафтер/); }
    // спойлер
    { const { Sub } = mkSub({}, { classCur: { prof: 'dwarf_bounty_hunter', slot: 2 } }); assert.equal(Sub.spoilFirst(), true); assert.match(Sub.text(), /Спойл в приоритете/); }
    // помощник: основной пишет недостачу (без магазинного), помощник читает, цель фарма — точка по всем сразу, передача по кнопке
    { const main = mkSub({}, {});
      await main.Sub.needWrite(); const need = shared[main.Sub.NEED_KEY];
      assert.ok(need && need.nick === 'Warlock' && /Lv\.1/.test(need.goal), 'основной записал цель');
      assert.equal(JSON.stringify(need.items.map(x => x[1]).sort()), JSON.stringify(['Iron Ore', 'Mithril Ore', 'Varnish']), 'сырьё без кристаллов (магазин)');
      const helper = mkSub({ mmGoalItem: 0, subMainNick: 'Warlock' }, { mmGear: [] }, { nick: 'WestSPOIL', spoil: true, inv: { 1876: 30 } });
      assert.equal(helper.Sub.isHelper(), true); assert.equal(helper.Sub.helpGoal(), null, 'пока не прочитал');
      await helper.Sub.needRead(); assert.ok(helper.env.rt.subNeed?.items?.length === 3 && recs.some(r => /помощник: Warlock копит/.test(r)));
      const hg = helper.Sub.helpGoal(); assert.ok(hg?.pick?.tp === FOM && hg.help === 'Warlock' && /помощь Warlock/.test(hg.why), 'цель помощника — та же точка');
      const h = helper.Sub.handover(); assert.equal(JSON.stringify(h), JSON.stringify({ to: 'Warlock', items: [[1876, 30, 'Mithril Ore']] }), 'в сумке 30 Mithril — передать');
      assert.equal(helper.Sub.handWant(), null, 'без кнопки не шлём');
      helper.env.rt.subHandReq = { t: Date.now() }; const hw = helper.Sub.handWant();
      assert.ok(hw?.kind === 'send' && hw.hand === 1 && hw.to === 'Warlock' && hw.items.length === 1 && hw.cmd, 'по кнопке — поход «send» основному');
      helper.env.cfg.subHelpMain = false; assert.equal(helper.Sub.helpGoal(), null, 'помощь выключена');
      const same = mkSub({ subMainNick: 'warlock' }); assert.equal(same.Sub.isHelper(), false, 'сам основной — не помощник'); }
    // mammon: поход передачи основному не считается «у крафтера»
    { const { env, M } = mk(); let finished = null; env.invRefresh = async () => ({ 1876: 0 });
      // sentOk через mmJob: эмулируем J.hand
      await M.sendStep({ kind: 'send', hand: 1, to: 'Warlock', items: [], done: [['Mithril Ore', 30, 1500]], step: 'act', t: Date.now() });
      assert.ok(env.recs.some(r => /крафтеру: ✓ отправил Warlock: Mithril Ore 30.*Пошта → Предмети/.test(r)), 'итог похода передачи: ' + env.recs.at(-1)); }
    assert.match(content, /L2V7Modules\.story\.charNote\(ch\), L2V7Modules\.subclass\.charNote\(ch\)/);
    assert.match(content, /const h = L2V7Modules\.subclass\?\.helpGoal\?\.\(\); if \(h\) return h;/); }
  console.log('PASS: 10.0.7 автофарм под апгрейд — точка по всем материалам, дроп/спойл, источники из игры, заготовка под сабы (крафтер, спойлер, помощник основного)');
})().catch(e => { console.error(e); process.exit(1); });
