'use strict';
// Lite 1.8 (24.10, тред «Упрошенка под Дестра», John: «Добавь в бота секцию: Споил — с режимом спойла мобов спойл фестивалем масс
// или соло спойлом, полностью автономный режим»): режим спойла auto / mass / solo (L.spoilPlan), метки Festival на соседях
// (L.festMarks / L.festFresh), Whirlwind / Wild Sweep спойлера — массовый удар, автономный выбор места (L.spoilAutoSpots / spoilAutoPick),
// и исправление остановки после смертей (lite.cfg больше не затирается настройками активного профиля).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const L = require('../lite/logic.js');
const bot = read('lite/bot.js'), pj = read('lite/popup.js'), html = read('lite/popup.html');

const slot = (id, name, extra = {}) => ({ key: 'l2_' + id, action: 'l2_' + id, id, name, type: 'spoil', on: true, ready: true, mp: L.SK[id][3], i: id, ...extra });
const SPOIL = (o = {}) => slot(254, 'Spoil', o), FEST = (o = {}) => slot(302, 'Spoil Festival', o), CRUSH = (o = {}) => slot(348, 'Spoil Crush', o);
const ME = { hp: 3000, maxHp: 3000, mp: 900, maxMp: 1000 }, MOB = { hp: 10000, maxHp: 10000 };
const plan = (sl, st = {}, opt = {}, me = ME, mob = MOB) => L.spoilPlan(sl, me, mob, st, { now: 10000, ...opt });

test('режимы: auto / mass / solo, незнакомое значение — auto; подписи для меню', () => {
  assert.deepEqual(L.SPOIL_MODES, ['auto', 'mass', 'solo']);
  assert.equal(L.spoilMode('mass'), 'mass'); assert.equal(L.spoilMode('solo'), 'solo');
  for (const x of [undefined, null, '', 'MASS', 'fest']) assert.equal(L.spoilMode(x), 'auto', String(x));
  for (const m of L.SPOIL_MODES) assert.ok(L.SPOIL_MODE_RU[m]);
  assert.equal(L.profCfg({}, 'spoil').spoilMode, 'auto', 'по умолчанию — как 1.6');
  assert.equal(L.profCfg({}, 'spoil').spoilAuto, false, 'автономный выбор места — только по галке');
  const raw = L.profPatch({ on: true }, 'spoil', { spoilMode: 'mass', spoilAuto: true });
  assert.deepEqual(raw.p.spoil, { spoilMode: 'mass', spoilAuto: true });
  assert.equal(L.profCfg(raw, 'destr').spoilMode, 'auto', 'у Дестра своё');
});

test('auto — ровно как 1.6: дубина → Crush, иначе Festival раз за бой, ожидание ≤ 1 с', () => {
  for (const mode of [undefined, 'auto']) {
    assert.equal(plan([SPOIL(), FEST(), CRUSH()], {}, { blunt: true, mode }).kind, 'crush');
    assert.equal(plan([SPOIL(), FEST(), CRUSH()], {}, { blunt: false, mode }).kind, 'mass');
    assert.equal(plan([SPOIL(), FEST({ ready: false, left: 2500 })], {}, { blunt: false, mode }).kind, 'single', 'откат 2,5 с — не ждём');
    assert.equal(plan([SPOIL(), FEST()], { massTried: true }, { blunt: false, mode }).kind, 'single');
    assert.equal(plan([SPOIL()], { spoiled: true, massTried: true, massN: 1 }, { blunt: false, mode, fresh: 3 }), null, 'новые соседи — повторный Festival только в масс-режиме');
  }
});

test('mass: Festival первым и с дубиной; откат до 3 с — ждём (не дольше 3,5 с за бой), удары до него не идут', () => {
  let p = plan([SPOIL(), FEST(), CRUSH()], {}, { blunt: true, mode: 'mass' });
  assert.equal(p.kind, 'mass', 'с дубиной в масс-режиме — Festival, а не Crush');
  p = plan([SPOIL(), FEST({ ready: false, left: 2700 }), CRUSH()], {}, { blunt: true, mode: 'mass' });
  assert.ok(p.wait > 0 && p.wait <= 150); assert.match(p.why, /Spoil Festival/);
  p = plan([SPOIL(), FEST({ ready: false, left: 2700 })], { waitT0: 10000 - 3600 }, { blunt: false, mode: 'mass' });
  assert.equal(p.kind, 'single', 'ждали 3,5 с — дальше обычный Spoil');
  p = plan([SPOIL(), FEST({ ready: false, left: 4000 }), CRUSH()], {}, { blunt: true, mode: 'mass' });
  assert.equal(p.kind, 'crush', 'откат Festival длиннее 3 с — с дубиной Crush');
  p = plan([SPOIL(), FEST({ ready: false, left: 4000 })], {}, { blunt: false, mode: 'mass' });
  assert.equal(p.kind, 'single');
  // Festival не помог главному — его добивает обычный Spoil; Festival на откате не ждём
  p = plan([SPOIL(), FEST({ ready: false, left: 1000 })], { massTried: true, massN: 1 }, { blunt: false, mode: 'mass' });
  assert.equal(p.kind, 'single');
  // Festival нет на панели / мало MP — масс-режим работает как auto
  assert.equal(plan([SPOIL(), CRUSH()], {}, { blunt: true, mode: 'mass' }).kind, 'crush');
  assert.equal(plan([SPOIL(), FEST(), CRUSH()], {}, { blunt: true, mode: 'mass' }, { ...ME, mp: 71 }).kind, 'crush', 'MP 71: на Festival (73) мало, на Crush (70) хватает');
});

test('mass: новые соседи без метки — Festival ещё раз (только готовый), до 3 раз за бой, и когда главный уже помечен', () => {
  const st = { spoiled: true, massTried: true, massN: 1 };
  let p = plan([SPOIL(), FEST()], st, { mode: 'mass', fresh: 2 });
  assert.equal(p.kind, 'mass'); assert.match(p.why, /рядом 2 без метки/);
  assert.equal(plan([SPOIL(), FEST({ ready: false, left: 300 })], st, { mode: 'mass', fresh: 2 }), null, 'на откате не ждём — бьём');
  assert.equal(plan([SPOIL(), FEST()], { ...st, massN: 3 }, { mode: 'mass', fresh: 2 }), null, 'не больше 3 раз за бой');
  assert.equal(plan([SPOIL(), FEST()], st, { mode: 'mass', fresh: 0 }), null, 'все помечены — ход удару');
  assert.equal(plan([SPOIL(), FEST()], { ...st, massN: 0, massTried: false, spoiled: false }, { mode: 'mass', fresh: 2 }).why, 'масс-спойл', 'первый Festival — обычный');
  // главный не помечен и рядом новые — Festival важнее одиночного Spoil (он метит и главного)
  p = plan([SPOIL(), FEST()], { massTried: true, massN: 1, tries: 1 }, { mode: 'mass', fresh: 1 });
  assert.equal(p.kind, 'mass');
});

test('solo: Festival не жмём никогда — Crush с дубиной, иначе Spoil; Festival на панели не ждём', () => {
  assert.equal(plan([SPOIL(), FEST(), CRUSH()], {}, { blunt: true, mode: 'solo' }).kind, 'crush');
  let p = plan([SPOIL(), FEST(), CRUSH()], {}, { blunt: false, mode: 'solo' });
  assert.equal(p.kind, 'single'); assert.equal(p.slot.key, 'l2_254');
  assert.equal(plan([FEST()], {}, { blunt: false, mode: 'solo' }), null, 'только Festival на панели — в соло не спойлим');
  p = plan([SPOIL({ ready: false, left: 400 }), FEST()], {}, { blunt: false, mode: 'solo' });
  assert.equal(p, null, 'Spoil на откате — ход удару, Festival не берём');
  assert.equal(plan([SPOIL()], { tries: 1 }, { mode: 'solo' }).why, 'спойл (2)', 'повторы Spoil — как раньше');
  assert.equal(plan([SPOIL(), FEST()], { spoiled: true, massN: 1 }, { mode: 'solo', fresh: 3 }), null);
});

test('метки Festival: удачи по именам минус главный; промах — без метки; без итога по мобам — помечены все видимые', () => {
  const ex = [{ name: 'Grave Robber', hp: 900, maxHp: 1000 }, { name: 'Grave Robber', hp: 1000, maxHp: 1000 }, { name: 'Rock Golem', hp: 500, maxHp: 2000 }];
  const res = L.festivalParse(['Spoil Festival: Grave Robber: успіх (60%); Grave Robber: промах (55%); Grave Robber: успіх (61%); Rock Golem: вже заспойлено']);
  // главный (Grave Robber) помечен — из двух удач одна его: из двух соседей Grave Robber помечен один, Rock Golem — уже
  assert.deepEqual(L.festMarks(res, ex, 'Grave Robber', true).map(x => x.name), ['Grave Robber', 'Rock Golem']);
  // главный не помечен — промах его, обе удачи у соседей
  assert.deepEqual(L.festMarks(res, ex, 'Grave Robber', false).map(x => x.name), ['Grave Robber', 'Grave Robber', 'Rock Golem']);
  assert.equal(L.festMarks([], ex, 'X', true).length, 3, 'итога нет — не жмём Festival по кругу');
  assert.deepEqual(L.festMarks(res, [{ name: 'Rock Golem', hp: 0, maxHp: 2000 }], 'Grave Robber', true), [], 'мёртвых не метим');
  assert.deepEqual(L.festMarks(res, null, 'Grave Robber', true), []);
});

test('соседи без метки: новые, возродившиеся (HP снова полный) и промахи — только те, кто умрёт вместе с главным', () => {
  const mob = { hp: 5000, maxHp: 8000 };
  const marks = [{ name: 'Grave Robber', maxHp: 6000, hp: 4000 }];
  let f = L.festFresh(marks, [{ name: 'Grave Robber', hp: 3500, maxHp: 6000 }], mob);
  assert.equal(f.fresh, 0); assert.deepEqual(f.marks, [{ name: 'Grave Robber', maxHp: 6000, hp: 3500 }], 'тот же моб: HP падает — метку ведём');
  f = L.festFresh(f.marks, [{ name: 'Grave Robber', hp: 6000, maxHp: 6000 }], { hp: 6500, maxHp: 8000 });
  assert.equal(f.fresh, 1, 'HP вырос — убит и возродился без метки'); assert.deepEqual(f.marks, []);
  f = L.festFresh(marks, [{ name: 'Grave Robber', hp: 3900, maxHp: 6000 }, { name: 'Elder', hp: 3000, maxHp: 3000 }], mob);
  assert.equal(f.fresh, 1, 'подошёл новый');
  f = L.festFresh(marks, [{ name: 'Grave Robber', hp: 3900, maxHp: 6000 }, { name: 'Ogre', hp: 9000, maxHp: 9000 }], mob);
  assert.equal(f.fresh, 0, 'толще главного — не умрёт вместе с ним, его спойл пропал бы');
  f = L.festFresh([], [{ name: 'A', hp: 0, maxHp: 10 }, null], mob);
  assert.equal(f.fresh, 0, 'мёртвые и пустые строки не считаем');
  f = L.festFresh([{ name: '', maxHp: 700, hp: 700 }], [{ name: '', hp: 650, maxHp: 700 }], mob);
  assert.equal(f.fresh, 0, 'без имени — по макс. HP');
});

test('сосед убит одним ударом и тут же снова полный: метку снимает строка «Додаткова ціль повалена»', () => {
  assert.deepEqual(L.exDeaths(['Додаткова ціль повалена: Dark Reaper.', '[12:01:02] Дополнительная цель повержена: Ghoul', 'Ви завдаєте 1 500 урону', null]), ['Dark Reaper', 'Ghoul']);
  assert.deepEqual(L.exDeaths(null), []);
  const mob = { hp: 7500, maxHp: 9000 }, ex = [{ name: 'Grave Robber', hp: 1400, maxHp: 1400 }, { name: 'Ghoul', hp: 1400, maxHp: 1400 }];
  const marks = [{ name: 'Grave Robber', maxHp: 1400, hp: 1400 }, { name: 'Ghoul', maxHp: 1400, hp: 1400 }];
  assert.equal(L.festFresh(marks, ex, mob).fresh, 0, 'по HP — те же мобы');
  let f = L.festFresh(marks, ex, mob, ['Ghoul']);
  assert.equal(f.fresh, 1, 'Ghoul погиб — на его месте новый без метки'); assert.deepEqual(f.marks.map(m => m.name), ['Grave Robber']);
  f = L.festFresh(marks, ex, mob, ['Ghoul', 'Grave Robber', 'Ghoul']);
  assert.equal(f.fresh, 2, 'лишние смерти не ломают счёт'); assert.deepEqual(f.marks, []);
  f = L.festFresh([{ name: '', maxHp: 700, hp: 700 }], [{ name: '', hp: 700, maxHp: 700 }], mob, ['Imp']);
  assert.equal(f.fresh, 1, 'метка без имени снимается любой смертью');
});

test('спойлер с пикой: Whirlwind и Wild Sweep — массовый удар (у Дестра — как раньше); выбор игрока важнее', () => {
  for (const [a, n] of [['l2_36', 'Whirlwind'], ['l2_245', 'Wild Sweep']]) {
    const i = L.skillInfo(a, n);
    assert.equal(L.skillUse(i, null, 'spoil').type, 'aoe', a); assert.equal(L.skillUse(i, null, 'spoil').on, true, a);
    assert.equal(L.skillUse(i, null, 'destr').type, 'attack', 'Дестр: ' + a);
    assert.equal(L.skillUse(i, { on: true, type: 'attack' }, 'spoil').type, 'attack', 'тип, выбранный игроком, важнее');
  }
  assert.equal(L.skillUse(L.skillInfo('l2_260', 'Hammer Crush'), null, 'spoil').type, 'attack', 'приём дубины — одиночный');
  // массовый у спойлера: пока соседи умрут вместе с целью — только он (как у мага), быстрый удар — да
  const ww = { ...L.skillUse(L.skillInfo('l2_36', 'Whirlwind'), null, 'spoil'), key: 'l2_36', action: 'l2_36', ready: true, pow: 2283, mp: 83 };
  const ps = { key: 'l2_99x', action: 'l2_99x', type: 'attack', on: true, ready: true, pow: 9999, name: 'Удар' };
  const t = L.planTurn([ps, ww], ME, { hp: 5000, maxHp: 5000 }, { now: 1, extras: [{ hp: 3000, maxHp: 4000 }, { hp: 4000, maxHp: 4000 }] });
  assert.equal(t.slot.key, 'l2_36'); assert.match(t.why, /массовый/);
  assert.equal(L.fastHit(ww), true);
});

test('автономный спойлер: места под ресурс или по ценности сырья у уровня героя; Ashen не берём', () => {
  const locs = [{ id: 'a', name: 'A', lo: 30, hi: 35 }, { id: 'b', name: 'B', lo: 36, hi: 39 }, { id: 'c', name: 'C', lo: 40, hi: 44 },
    { id: 'd', name: 'D', lo: 46, hi: 52 }, { id: 'e', name: 'E', lo: 60, hi: 66 }, { id: 'ashen_bastion', name: 'Ashen', lo: 85, hi: 85 }, { id: 'x', name: 'X', lo: null, hi: null }];
  // ценность: мобы 36–39 базового сырья не дают — у героя 38 лучше C (40–44) и даже A (30–35), чем B (36–39)
  assert.ok(L.spoilValue(40) > L.spoilValue(38)); assert.ok(L.spoilValue(61) > L.spoilValue(51)); assert.ok(L.spoilValue(51) > L.spoilValue(45));
  assert.ok(L.spoilValue(35) > L.spoilValue(37));
  assert.deepEqual(L.spoilAutoSpots(locs, null, 38).map(x => x.id), ['c', 'a', 'b']);
  assert.deepEqual(L.spoilAutoSpots(locs, '', 47).map(x => x.id), ['d', 'c'], 'D: мобы 51–52 — ещё и Oriharukon');
  assert.deepEqual(L.spoilAutoSpots(locs, 'Mithril Ore', 41).map(x => [x.id, x.v]), [['c', 47], ['d', 47], ['b', 42]], 'шанс равный — ближе к уровню');
  assert.deepEqual(L.spoilAutoSpots(locs, null, 84), [], 'Ashen Bastion без карты — не место для автономного спойлера');
  assert.deepEqual(L.spoilAutoSpots(locs, 'Oriharukon Ore', 84), []);
  assert.deepEqual(L.spoilAutoSpots(locs, null, 0), [], 'уровень не известен');
  assert.deepEqual(L.spoilAutoSpots(locs, 'Mold Glue', 41).map(x => x.id), L.spoilAutoSpots(locs, null, 41).map(x => x.id), 'неизвестный ресурс — как без ресурса');
});

test('автономный спойлер: лучшее неотложенное место; текущее держим, пока оно не хуже (не летаем между равными за адену)', () => {
  const spots = [{ id: 'c', v: 666 }, { id: 'd', v: 666 }, { id: 'b', v: 180 }];
  assert.equal(L.spoilAutoPick(spots, {}).id, 'c');
  assert.equal(L.spoilAutoPick(spots, { cur: 'd' }).id, 'd', 'равное — остаёмся');
  assert.equal(L.spoilAutoPick(spots, { cur: 'b' }).id, 'c', 'хуже — переезжаем');
  assert.equal(L.spoilAutoPick(spots, { cur: 'zz' }).id, 'c', 'текущее больше не подходит (герой перерос) — лучшее');
  assert.equal(L.spoilAutoPick(spots, { bad: ['c'] }).id, 'd');
  assert.equal(L.spoilAutoPick(spots, { bad: new Set(['c', 'd']), cur: 'c' }).id, 'b', 'отложенное текущее — другое');
  assert.equal(L.spoilAutoPick(spots, { bad: ['c', 'd', 'b'] }), null);
  assert.equal(L.spoilAutoPick([], {}), null);
});

test('бот: режим и соседи без метки идут в план спойла; Festival отмечает соседей; Spoil после метки не жмём', () => {
  const ss = bot.slice(bot.indexOf('  function festFreshNow('), bot.indexOf('  // Победа спойлера'));
  assert.match(ss, /if \(L\.spoilMode\(cfg\.spoilMode\) !== 'mass' \|\| !st\.massN \|\| !slots\.some\(s => s\.type === 'aoe' && s\.on !== false\)\) return 0;/, 'без массового удара соседи не гибнут — повторный Festival не нужен');
  assert.match(ss, /const opt = \(\) => \(\{ blunt: wpnBlunt\(\), tries: cfg\.spoilTries, now: Date\.now\(\), mode, fresh: festFreshNow\(st, slots, mobHp\(\) \|\| mob\) \}\);/);
  assert.match(ss, /if \(p\.kind === 'mass'\) \{ st\.massTried = true; st\.massN = \(st\.massN \|\| 0\) \+ 1; \} else st\.tries\+\+;/);
  assert.match(ss, /st\.marks = L\.festMarks\(res, exNow\(\), st\.name, st\.spoiled\); st\.festLog = logLines\(\)\.slice\(-80\);/);
  assert.match(ss, /const lines = logLines\(\), dead = L\.exDeaths\(L\.newLines\(st\.festLog \|\| \[\], lines\)\), f = L\.festFresh\(st\.marks, exNow\(\), mob, dead\);/, 'смерти соседей после прошлой сверки снимают метки');
  assert.match(ss, /if \(dead\.length \|\| JSON\.stringify\(f\.marks\) !== JSON\.stringify\(st\.marks\)\) \{ st\.marks = f\.marks; st\.festLog = lines\.slice\(-80\); spbSave\(\); \}/, 'одна смерть снимает одну метку один раз');
  assert.match(bot, /massN: 0, marks: \[\], waitT0: 0/, 'новая память боя');
  // Старт пишет режим в журнал
  assert.match(bot, /спойл: ' \+ L\.SPOIL_MODE_RU\[L\.spoilMode\(cfg\.spoilMode\)\]/);
});

test('бот: автономный спойлер — выбор места в главном цикле, отложенные места, место из меню не действует', () => {
  assert.match(bot, /const autoOn = \(\) => cfg\.kind === 'spoil' && cfg\.spoilAuto === true;/);
  assert.match(bot, /const zoneCfg = \(\) => \(autoOn\(\) \? '' : cfg\.zone\);/);
  assert.match(bot, /const pick = L\.spoilAutoPick\(spots, \{ bad: Object\.keys\(bad\), cur: rt\.zone\?\.auto \? rt\.zone\.id : '' \}\);/);
  assert.match(bot, /setRt\(\{ zone: \{ id: pick\.id, name: pick\.name, auto: true \}, goZone: '', tpTry: \[\] \}\);/);
  assert.match(bot, /autoTick\(\);\s+\/\/ 1\.8: автономный спойлер[^\n]*\n\s+if \(pg === 'battle'\) return battleStep\(g\);/);
  // переезд: нет мобов 90 с, телепорт не удался, две смерти за 30 мин
  assert.match(bot, /if \(autoOn\(\) && rt\.zone\?\.auto && S && zoneIs\(S\.zone\) && Date\.now\(\) - nm0 > 90000\)/);
  assert.match(bot, /if \(autoOn\(\) && rt\.zone\?\.auto && rt\.zone\.id === id\) autoBad\(id, 30 \* 60000, 'телепорт не удался'\);/);
  assert.match(bot, /if \(list\.length >= 2\) autoBad\(z\.id, 60 \* 60000, `\$\{list\.length\} смерти за 30 мин`\);/);
  assert.match(bot, /log\(`☠ герой погиб \(\$\{deaths\.length\} за 30 мин\)`\);\n\s+autoDeath\(\);/);
  // место из меню: смена места в меню при автономном режиме не трогает выбранное ботом; Старт — без места из меню
  assert.match(bot, /if \(prev\.zone !== cfg\.zone && !autoOn\(\)\) \{/);
  assert.match(bot, /const zc = zoneCfg\(\), P = L\.paceCfg\(cfg\);/);
  assert.doesNotMatch(bot.slice(bot.indexOf('  async function zoneAsk()'), bot.indexOf('  // Почему место не запоминается')), /cfg\.zone/);
  assert.match(bot, /if \(z \|\| zoneCfg\(\)\) return;/);
  assert.match(bot, /spotBad: \{\} \};/, 'память отложенных мест');
});

test('остановка после смертей: выключаем только on в свежем lite.cfg — профили не теряются', async () => {
  const a = bot.indexOf('  async function deathStep('), b = bot.indexOf('  async function cityStep(', a);
  assert.doesNotMatch(bot.slice(a, b), /\{ \.\.\.cfg, on: false \}/);
  // настоящий deathStep: 3-я смерть за 30 мин — в хранилище тот же lite.cfg с on: false
  let store = { 'lite.cfg': { on: true, delayMs: 300, p: { spoil: { spoilMode: 'mass', zone: 'cruma' }, destr: { killLimit: 9 } } } };
  const now = Date.now(), ctx = { K_CFG: 'lite.cfg', cfg: { ...L.profCfg(store['lite.cfg'], 'spoil') }, RAW: store['lite.cfg'], Date, Math,
    rt: { deaths: [now - 1000, now - 2000], revive: null }, $: () => null, shown: () => false, defeatShown: () => true, sess: { set() {}, get: (k, d) => d },
    setRt(p) { Object.assign(ctx.rt, p); }, log() {}, notify() {}, flushRt: async () => {}, autoDeath() {}, sleep: async () => {},
    chrome: { storage: { local: { get: async k => ({ [k]: store[k] }), set: async o => { store = { ...store, ...o }; } } } } };
  vm.createContext(ctx);
  vm.runInContext(bot.slice(a, b) + ';globalThis.deathStep = deathStep;', ctx);
  assert.equal(await ctx.deathStep('battle', 1), true);
  assert.deepEqual(JSON.parse(JSON.stringify(store['lite.cfg'])), { on: false, delayMs: 300, p: { spoil: { spoilMode: 'mass', zone: 'cruma' }, destr: { killLimit: 9 } } });
});

test('меню: режим спойла, автономная галка, места автономного выбора; список мест охоты выключен в автономном режиме', () => {
  for (const id of ['spoilMode', 'spoilModeHint', 'spoilAuto', 'zoneAuto']) assert.match(html, new RegExp(`id="${id}"`), id);
  for (const m of L.SPOIL_MODES) assert.match(html, new RegExp(`<option value="${m}">`), m);
  assert.match(pj, /\$\('spoilMode'\)\.onchange = e => save\(\{ spoilMode: L\.spoilMode\(e\.target\.value\) \}\);/);
  assert.match(pj, /\$\('spoilAuto'\)\.onchange = e => save\(\{ spoilAuto: e\.target\.checked \}\);/);
  assert.match(pj, /const autoView = \(\) => kindView\(\) === 'spoil' && cfg\.spoilAuto === true;/);
  assert.match(pj, /\$\('zone'\)\.disabled = auto;/);
  assert.match(pj, /L\.spoilAutoSpots\(rt\.locs, res, lvl, 5\)/);
  assert.doesNotMatch(pj, /\.innerHTML\s*=/);
});
