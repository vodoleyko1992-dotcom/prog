'use strict';
// 10.0.5 (игрок 13.10 00:38): «автопоиск чемпионов раз в 20 убитых мобов, анализ кого мы можем убить, а кого нет, автообучение этому, проба
// тогда, когда предположительно мы можем убить чемпиона, и отход, если мы его не пробиваем или его бить нецелесообразно по времени — по
// отношению к фарму ФА… и проба бить чемпионов, когда сила возрастает» — modules/champs.js + mobfarm/combat
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const load = (file, env) => { const ctx = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, Promise }; ctx.globalThis = ctx;
  vm.runInNewContext(read(file), ctx); return ctx.L2V7Factories[path.basename(file, '.js')](env); };
let lvl = 66;
const env = { cfg: { champRed: true, champMinLvl: 0 }, rt: { lvl: 66, rbDps: 3000 }, heroLvl: () => lvl, farmRate: () => ({ eps: 5600, sk: 1.5 }), setRt: async p => Object.assign(env.rt, p) };
const C = load('modules/champs.js', env);
(async () => {
  // 1. цена чемпиона в секундах обычного фарма: EXP ÷ EXP/с + шанс FA × (время на моба ÷ 1 %)
  assert.equal(C.limitS({ tier: 'red', exp: 250680, fa: 0.6 }), Math.round(250680 / 5600 + 0.6 * 150));   // ≈135 с
  assert.equal(C.limitS({ tier: 'orange', exp: 188010, fa: 0.2 }), Math.round(188010 / 5600 + 30));    // ≈64 с
  env.farmRate = () => null; assert.equal(C.limitS({ tier: 'red', exp: 250680 }), 120, 'no farm pace yet — default by colour');
  env.farmRate = () => ({ eps: 5600, sk: 1.5 });
  // 2. без своего замера: прогноз по ДПС на РБ → «предположительно можем» = проба до 2× предела, хуже — пропуск
  let j = C.judge({ tier: 'red', lvl: 67, hp: 142632, exp: 250680, fa: 0.6 });   // 142632/3000 ≈ 50 с ≤ 135
  assert.ok(j.ok && j.probe, 'red: probe (no own measurement)');
  j = C.judge({ tier: 'red', lvl: 67, hp: 900000, exp: 250680, fa: 0.6 });       // ≈300 с > 2×135
  assert.ok(!j.ok, 'hopeless even for a probe');
  j = C.judge({ tier: 'blue', lvl: 67, hp: 0 });
  assert.ok(j.ok && j.probe, 'no numbers — probe');
  // 3. в бою: не пробиваю / долго / мало HP → отход
  const ctx = { champ: true, tier: 'red', lvl: 67, chHp0: 142632, chLim: 135 };
  assert.equal(C.fleeCheck(ctx, { pct: 90 }, { cur: 142000, max: 142632 }, 5), null, 'not before 6 s');
  assert.equal(C.fleeCheck(ctx, { pct: 90 }, { cur: 140000, max: 142632 }, 9).kind, 'weak', '< 3 % in 8 s — can\'t pierce');
  assert.equal(C.fleeCheck(ctx, { pct: 90 }, { cur: 135000, max: 142632 }, 12).kind, 'slow', '5 % in 12 s → ≈224 s > 1.3 × 135');
  assert.equal(C.fleeCheck(ctx, { pct: 25 }, { cur: 100000, max: 142632 }, 7).kind, 'danger');
  assert.equal(C.fleeCheck(ctx, { pct: 90 }, { cur: 60000, max: 142632 }, 20), null, 'on pace (≈35 s) — keep fighting');
  assert.equal(C.fleeCheck({ ...ctx, rb: { id: 'x' } }, { pct: 10 }, { cur: 1, max: 2 }, 20), null, 'RB has its own rules');
  // 4. обучение: отход — вердикт до роста силы; ДПС замерен
  await C.learn(ctx, 'slow', 22632, 12);
  assert.equal(env.rt.champLearn.dps.dps, Math.round(22632 / 12));
  assert.ok(env.rt.champLearn.v.red, 'verdict stored');
  j = C.judge({ tier: 'red', lvl: 67, hp: 142632, exp: 250680, fa: 0.6 });
  assert.ok(!j.ok && /жду роста силы/.test(j.why), 'blocked until stronger');
  assert.ok(C.judge({ tier: 'red', lvl: 65, hp: 1000, exp: 250680 }).ok, 'easier (lower gap) red — not blocked by the verdict');
  // сила выросла: уровень героя → снова проба/оценка
  lvl = 67; assert.ok(!/жду роста силы/.test(C.judge({ tier: 'red', lvl: 67, hp: 142632, exp: 250680, fa: 0.6 }).why || ''), 'level up lifts the verdict');
  // 10.0.10: свежий вердикт (< 5 мин) снимает только новый уровень; рост урона +15 % — после выдержки (v.t сдвинут назад)
  lvl = 66; env.rt.rbDps = 3500; assert.ok(/жду роста силы/.test(C.judge({ tier: 'red', lvl: 67, hp: 142632, exp: 250680, fa: 0.6 }).why || ''), '+15 % damage within 5 min — still blocked (10.0.10)');
  env.rt.champLearn.v.red.t -= C.V_HOLD + 1; assert.ok(!/жду роста силы/.test(C.judge({ tier: 'red', lvl: 67, hp: 142632, exp: 250680, fa: 0.6 }).why || ''), '+15 % damage lifts the verdict');
  env.rt.rbDps = 3000;
  // победа снимает вердикт; уход со страницы («left») вердикта не ставит
  await C.learn({ ...ctx, lvl: 67 }, 'win', 142632, 30);
  assert.ok(!env.rt.champLearn.v.red, 'win clears the verdict');
  await C.learn({ ...ctx, tier: 'orange' }, 'left', 0, 1);
  assert.ok(!env.rt.champLearn.v.orange, '«left» is not a verdict');
  assert.equal(env.rt.champLearn.st.red.win, 1);
  // 5. проводка: hook (HP/EXP), mobfarm (оценка, темп зоны), combat (отход, учёт, без «не по зубам» по имени вида), карта раз в 20
  assert.match(read('hook.js'), /x\.kind === 'champion' \? \+x\.maxHp \|\| 0 : 0, x\.kind === 'champion' \? \+x\.rewardExp \|\| 0 : 0/);
  const mf = read('modules/mobfarm.js'), cb = read('modules/combat.js'), ct = read('content.js');
  assert.match(mf, /const j = env\.champs\.judge\(r\);/); assert.match(mf, /if \(!j\.ok\) \{ champSkip\(r, j\.why\); return; \}/);
  assert.match(cb, /const fl = env\.champs\.fleeCheck\(ctx, me, mob, \(Date\.now\(\) - t0\) \/ 1000\);/);
  assert.match(cb, /if \(ctx\.champ && !ctx\.rb\) env\.champs\?\.learn\(ctx, victory\(\) \? 'win' : 'left', dealt, ttk\)[^\n]*\n\s*else if \(!ctx\.rb && ttkOne > 45\)/);
  assert.match(ct, /: champHunt\(\) \? \(mapOff\(\) \? champEvery\(\) : Math\.min\(cfg\.deepEvery, champEvery\(\)\)\)/);
  assert.match(read('manifest.json'), /"modules\/champs\.js",\s*"modules\/rbtimer\.js"/);
  assert.match(read('popup.html'), /id="champLeave"/); assert.match(read('popup.html'), /id="champEvery"/);
  // 6. mobfarm: безнадёжный чемпион — не кандидат, в журнал «пропускаю»
  const recs = [];
  const menv = { cfg: { champRed: true, champMinLvl: 0, /* 10.0.10: красные по умолчанию ВЫКЛ, порог 20 ур. — здесь проверяется логика до галок */  priority: '[квест]\n[чемп]\n[все]', searchChamp: true, searchQuest: true, lvlBelow: 3, lvlAbove: 20, lvlMin: 1, lvlMax: 99 },
    rt: { spawns: { r1: ['Kookaburra', 67], b1: ['Buffalo', 70] }, lvl: 66 }, PAGE_SIZE: 15, champs: C,
    NET_SPAWNS: { t: Date.now(), kind: { r1: 'champion', b1: 'champion' }, tier: { r1: 'red', b1: 'blue' }, hp: { r1: 9000000, b1: 49560 }, exp: { r1: 250680, b1: 136815 } },
    heroLvl: () => 66, isRaidId: () => false, isBoss: () => false, isQuestName: () => false,
    campActive: () => false, campChampOpen: () => false, campChampMin: () => 0, campMobOpen: () => [], farmRules: () => [], recipeRules: () => [],
    rec: (...a) => recs.push(a.join(' | ')), setRt: async p => Object.assign(menv.rt, p) };
  const ctxm = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, Promise, CSS: { escape: s => s }, document: { querySelectorAll: () => [] } }; ctxm.globalThis = ctxm;
  vm.runInNewContext(mf, ctxm); const M = ctxm.L2V7Factories.mobfarm(menv);
  const ids = Array.from(M.candidates(M.parseRules(), { ids: ['r1', 'b1'], quest: [] }, menv.NET_SPAWNS.kind, 99), x => x.id);
  assert.deepEqual(JSON.parse(JSON.stringify(ids)), ['b1'], 'red with 9 M HP skipped, blue kept');
  assert.ok(recs.some(r => /Kookaburra \(67, красный\): пропускаю/.test(r)));
  console.log('PASS: 10.0.5 champion hunt — price in farm seconds (EXP + FA), probe when likely, leave when not piercing / too slow / low HP, learning (DPS, verdict until level or +15 % damage), map every 20 fights, hopeless champions skipped');
})().catch(e => { console.error(e); process.exit(1); });
