'use strict';
// 9.2.5 (игрок 12.10: «на основе данных игры разработай фулл баф на РБ и Эпиков за ФА»): готовый набор FA под класс (fa-full.js),
// «auto» в списке РБ-сессии, тот же набор перед разрешённым заходом на эпика (вместо 15 Coin of Luck), городской Lv.2 под FA Lv.3 —
// докупается, пара баффов, что снимают друг друга, замечается при покупке (rt.faClash) и больше не берётся
const assert = require('node:assert/strict');
const { vm, read, base, clone, MIN, docOf, mk } = require('./epic-harness.cjs');

// ---------- 1. наборы ----------
const fsb = {}; fsb.globalThis = fsb; vm.runInNewContext(read('fa-full.js'), fsb);
const F = fsb.L2FaFull;
const mage = [...F.ids({ mage: true })], fighter = [...F.ids({ mage: false })];
assert.equal(mage[0], 1413, "mage: Magnus' Chant first"); assert.ok(mage.includes(1323) && mage.includes(365) && mage.includes(4703) && mage.includes(267));
assert.ok(!mage.includes(1085) && !mage.includes(276), 'cast speed is capped at 3500 — no Acumen / Concentration for the mage');
// 10.0.7: Prophecy of Water (M.Atk +20 %, маг. крит ×2) и Blessing of Queen Lv.3 (кот) — в наборе; пара с Magnus — через rt.faClash
assert.ok(mage.includes(1357) && mage.includes(4699), 'Prophecy of Water and Blessing of Queen are in the default set (10.0.7)');
assert.equal(F.cost({ mage: true }), 28, 'mage full set = 28 FA (10.0.7: +Prophecy of Water 5, +Queen 1)');
assert.equal(fighter[0], 1414); assert.ok(fighter.includes(4699) && fighter.includes(1388) && fighter.includes(1323));
assert.equal(F.cost(null), F.cost({ mage: false }), 'unknown class → fighter set');
assert.equal(new Set(mage).size, mage.length); assert.equal(new Set(fighter).size, fighter.length, 'no duplicates');
assert.deepEqual([...F.resolve('auto', { mage: true })], mage); assert.deepEqual([...F.resolve('', 'mage')], mage);
assert.deepEqual([...F.resolve('1413, 1323 4703', { mage: true })], [1413, 1323, 4703], 'own list kept as is');
assert.deepEqual([...F.dropClash([1413, 1357, 365, 273], { 1357: [1413] })], [1413, 365, 273], 'pair: the earlier one stays');
assert.deepEqual([...F.dropClash([1357, 1413], { 1357: [1413] })], [1357]);
// все номера набора есть у баффера FA (каталог 12.10)
const cat = JSON.parse(read('kb/data/game-buffer.json')).fastAden.sets.flatMap(s => s.skills.map(k => k.skillId));
for (const id of [...mage, ...fighter]) assert.ok(cat.includes(id), 'sold by the FA buffer: ' + id);
for (const [id, lv] of Object.entries(F.UP)) {
  const s = JSON.parse(read('kb/data/game-buffer.json')).fastAden.sets.flatMap(x => x.skills).find(k => k.skillId === +id);
  assert.equal(s.level, lv, 'FA level of ' + id);
}

// ---------- 2. buffs: РБ-сессия «auto», эпик, Lv.2 под Lv.3, пара ----------
const now = Date.now(), E3 = now + 3 * 3600000 - 60000, T24 = now + 20 * 3600000;
let hud = {}, lvl = {};
const hudEl = { querySelectorAll: () => Object.entries(hud).map(([id, e]) => ({ dataset: { skillId: id, expiresAt: String(e) }, getAttribute: k => k === 'title' && lvl[id] ? `x · Lv.${lvl[id]}` : '' })) };
const recs = []; let epicOk = false;
const benv = { cfg: { rbSessBuffs: 'auto', rbSessNob: true, faBuffs: '', townBuffSet: 'basic' }, rt: { faBal: { v: 101, t: now } },
  TB_KEYS: { basic: [1068] }, $q: s => s === '#l2-hud-active-buffs' ? hudEl : null, setRt: async p => Object.assign(benv.rt, p), rec: (...a) => recs.push(a.join(' ')),
  faCost: id => F.COST[id] || 1, heroRole: () => ({ mage: true }), epicFaOk: () => epicOk, waitX: async f => f() || null, epicBuffCol: () => null };
const bsb = { console, Date, Math, JSON, document: { querySelectorAll: () => [] }, location: { pathname: '/map.html' } };
bsb.globalThis = bsb; vm.createContext(bsb); vm.runInContext(read('fa-full.js'), bsb); vm.runInContext(read('modules/buffs.js'), bsb);
const B = bsb.L2V7Factories.buffs(benv);
// 10.0.7 (игрок 13.10: Magnus и Water не стакаются): из группы Greater в наборе остаётся один (без цифр героя — первый по списку)
const mageSet = [...F.dropClash(mage, {})]; assert.ok(mageSet.includes(1413) && !mageSet.includes(1357));
assert.deepEqual([...B.faFullIds()], mageSet, 'auto → mage set');
assert.deepEqual([...B.faWanted()], [], 'no session, no epic → nothing');
epicOk = true; assert.deepEqual([...B.faWanted()], mageSet, 'cleared epic attempt → full FA set');
benv.cfg.epicFaFull = false; assert.deepEqual([...B.faWanted()], [], 'epic FA set switched off'); delete benv.cfg.epicFaFull;
// городской набор висит (24 ч, Empower Lv.2): FA Lv.3 всё равно нужен; набор FA на месте — ничего
hud = Object.fromEntries(mageSet.map(id => [id, E3])); hud[1059] = T24; lvl = { 1059: 2, 1062: 1 }; hud[1062] = T24;
assert.deepEqual([...(B.townBuffNeed()?.fa || [])].sort(), [1059, 1062], 'town Empower Lv.2 / Berserker Lv.1 under the full set → FA Lv.3 / Lv.2');
assert.equal(B.faLow(1059), true); lvl = { 1059: 3, 1062: 2 }; assert.equal(B.faLow(1059), false);
assert.equal(B.townBuffNeed(), null, 'full set on the panel → no trip');
epicOk = false;
// пара: покупка Prophecy of Water сняла Magnus' Chant
(async () => {
  hud = { 1413: now + 2 * 3600000, 1036: T24 }; lvl = {};
  const H0 = { ...hud }; hud = { 1357: now + 3 * 3600000, 1036: T24 };
  assert.deepEqual([...await B.faClashNote(1357, H0)], [1413]);
  assert.deepEqual(clone(benv.rt.faClash), { 1357: [1413] }); assert.match(recs.join('\n'), /покупка 1357 сняла с панели 1413/);
  benv.cfg.rbSessBuffs = '1413, 1357, 365';
  assert.deepEqual([...B.faFullIds()], [1413, 365], 'own list: the clashing Prophecy is dropped');
  // панель не обновилась — ничего не решаем; тот же номер — не пара
  benv.rt.faClash = {}; hud = { 1413: now + 2 * 3600000 };
  assert.deepEqual([...await B.faClashNote(1357, { 1413: now + 2 * 3600000, 1036: T24 })], [], 'bought buff not on the panel yet → no verdict');
  hud = { 1059: now + 3 * 3600000 };
  assert.deepEqual([...await B.faClashNote(1059, { 1059: T24 })], [], 'same id (FA Lv.3 over the town Lv.2) is not a clash');
  // ---------- 3. эпики: фулл бафф за FA вместо 15 Coin of Luck; проверки захода — те же ----------
  const pin = '<div><button class="l2-map-mob-pin l2-map-mob-pin--epic" data-spawn-id="l2dop_rb_29014" title="Орфен · ур. 50 · епік-бос"></button></div>';
  const okDb = { orfen: { id: 'l2dop_rb_29014', col: 1, adena: 0, apiT: Date.now(), alive: true, canAttack: true, lvl: 50, respH: 12, lifeT: Date.now() - 3600000 } };
  const okStats = { ...clone(base.rbStats), l2dop_rb_29014: { hp: 400000, patk: 1100, matk: 700, mdef: 800, pdef: 700, src: 'api' } };
  const m = mk({ doc: docOf(pin), cfg: { epicCoinDailyMax: 20 }, rt: { epicDb: okDb, rbStats: okStats, epic: { step: 'prep', k: 'orfen', route: 'page' }, faBal: { v: 101, t: Date.now() } },
    env: { faFullIds: () => mage, faCost: id => F.COST[id] || 1 } });
  assert.equal(m.E.epicFaOk(), true, 'cleared attempt → FA full set');
  assert.equal(m.E.epicBuffCol(), false, 'paid town set for Coin of Luck is not taken'); assert.match(m.E.epicBuffWhy(), /фулл бафф берётся за FA/);
  m.env.rt.deaths1h = [Date.now() - 1000, Date.now() - 2000]; assert.equal(m.E.epicFaOk(), false, '2 deaths in an hour → no FA either'); m.env.rt.deaths1h = [];
  m.env.rt.epicDb.orfen.apiT = Date.now() - 5 * MIN; assert.equal(m.E.epicFaOk(), false, 'alive not confirmed'); m.env.rt.epicDb.orfen.apiT = Date.now();
  m.env.rt.epic.route = null; assert.equal(m.E.epicFaOk(), false, 'route not decided'); m.env.rt.epic.route = 'page';
  m.env.rt.epic.step = 'pick'; assert.equal(m.E.epicFaOk(), false, 'between epics — no FA'); m.env.rt.epic.step = 'prep';
  m.env.rt.faBal = { v: 10, t: Date.now() }; assert.equal(m.E.epicBuffCol(), true, 'FA balance below the set → the Coin of Luck set as before (within the limit)');
  m.env.rt.faBal = { v: 101, t: Date.now() }; m.env.cfg.epicFaFull = false; assert.equal(m.E.epicBuffCol(), true, 'option off → as before');
  m.env.cfg.epicMode = false; assert.equal(m.E.epicFaOk(), false, 'epic mode off');
  // ---------- 4. проводка: геттеры, манифест, меню, миграция ----------
  const content = read('content.js'), mf = JSON.parse(read('manifest.json'));
  assert.ok(mf.content_scripts.find(x => x.js.includes('content.js')).js.indexOf('fa-full.js') < mf.content_scripts.find(x => x.js.includes('content.js')).js.indexOf('modules/buffs.js'));
  assert.match(read('popup.html'), /<script src="fa-full\.js"><\/script>/);
  assert.match(read('popup.html'), /id="epicFaFull" type="checkbox"/); assert.match(read('popup.html'), /id="rbSessAuto"/);
  assert.match(content, /rbSessBuffs: 'auto', rbSessNob: true, epicFaFull: true,/);
  assert.match(content, /once\('faFull925', \(\) => \{ if \(String\(C\('rbSessBuffs'\) \|\| ''\)\.replace\(\/\\s\+\/g, ''\) === '1413,1323,4703,273,365,1303,264,267,1389'\) cf\.rbSessBuffs = 'auto'; \}\);/);
  assert.match(content, /get epicFaOk\(\) \{ return \(\.\.\.a\) => L2V7Modules\.epics\.epicFaOk\(\.\.\.a\); \}/);
  assert.match(read('modules/raid.js'), /const sessIds = \(\) => env\.faFullIds \? env\.faFullIds\(\)/);
  console.log('PASS: 9.2.5 FA full buff — class sets from game data (mage 22 FA, fighter), auto list, same set before a cleared epic instead of the Coin of Luck set, town Lv.2 upgraded to FA Lv.3, clashing pairs learned and skipped');
})().catch(e => { console.error(e); process.exit(1); });
