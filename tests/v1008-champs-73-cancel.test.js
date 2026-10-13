'use strict';
// 10.0.8 (анонс игры 13.10 «Обновление чемпионов и оружия»): с 73 ур. оранжевые/красные чемпионы — HP ×3, атака/защита ×4 (живой
// /game/spawn/<id>/info 13.10: красный Hot Springs Yeti 75 — 476 тыс. HP, M.Def 6 014; красный Canyon Antelope 68 — 145 тыс., 1 366);
// «Cancel» (второй анонс 13.10 06:10 заменил 10/30/60 %): удачный удар снимает до 3 баффов — синий 3 % раз в 30 с, оранжевый 5 %, красный 7 %
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const load = (file, env) => { const ctx = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, Promise }; ctx.globalThis = ctx;
  vm.runInNewContext(read(file), ctx); return ctx.L2V7Factories[path.basename(file, '.js')](env); };
let paid = 0;
const env = { cfg: {}, rt: { lvl: 70, rbDps: 3000 }, heroLvl: () => 70, farmRate: () => ({ eps: 5600, sk: 1.5 }), faPaidLeft: () => paid, setRt: async p => Object.assign(env.rt, p) };
const C = load('modules/champs.js', env);
(async () => {
  // 1. усиленный 73+ — отдельный класс: без своего замера ДПС делится на 4 (защита ×4) → Hot Springs Yeti 75 (476 тыс. HP) безнадёжен
  assert.ok(C.isHard({ tier: 'red', lvl: 75 }) && C.isHard({ tier: 'orange', lvl: 73 }) && !C.isHard({ tier: 'blue', lvl: 75 }) && !C.isHard({ tier: 'red', lvl: 72 }));
  assert.equal(C.tKey({ tier: 'red', lvl: 75 }), 'red73'); assert.equal(C.tKey({ tier: 'red', lvl: 68 }), 'red');
  assert.equal(C.dpsOn(true).dps, 750, 'no own measurement on 73+: general DPS ÷ 4');
  let j = C.judge({ tier: 'red', lvl: 75, hp: 476280, exp: 284100, fa: 0.6 });   // 476280/750 ≈ 637 с > 2 × lim (≈141 с)
  assert.ok(!j.ok && j.hard && /73\+: HP ×3, защита ×4/.test(j.why), j.why);
  j = C.judge({ tier: 'red', lvl: 68, hp: 144648, exp: 206790, fa: 0.6 });        // 144648/3000 ≈ 50 с — как прежде, проба
  assert.ok(j.ok && j.probe && !j.hard, 'red below 73 — unchanged');
  // 2. замер по усиленному — своя память dpsH и свои итоги/вердикты (red73), обычные красные не трогает
  const ctx = { champ: true, tier: 'red', lvl: 75, chHp0: 476280, chLim: 141 };
  await C.learn(ctx, 'slow', 30000, 12);
  assert.equal(env.rt.champLearn.dpsH.dps, 2500); assert.ok(!env.rt.champLearn.dps, 'plain-champion DPS untouched');
  assert.ok(env.rt.champLearn.v.red73 && !env.rt.champLearn.v.red && /красный 73\+ 75 ур\.: слишком долго/.test(env.rt.champLearn.v.red73.why));
  assert.equal(env.rt.champLearn.st.red73.slow, 1);
  assert.ok(C.judge({ tier: 'red', lvl: 68, hp: 144648, exp: 206790, fa: 0.6 }).ok, 'verdict on 73+ does not block the ordinary red');
  assert.ok(/жду роста силы/.test(C.judge({ tier: 'red', lvl: 75, hp: 476280, exp: 284100, fa: 0.6 }).why));
  // с замером 2500/с усиленный с 150 тыс. HP прошёл бы (≈62 с ≤ 141) — проверяем через победу, снимающую вердикт
  await C.learn(ctx, 'win', 476280, 100); assert.ok(!env.rt.champLearn.v.red73);
  assert.ok(C.judge({ tier: 'red', lvl: 75, hp: 150000, exp: 284100, fa: 0.6 }).ok, 'measured DPS on 73+ decides');
  // 3. отход: у усиленного 73+ порог HP 50 % (атака ×4), у обычного — 30 %
  assert.equal(C.fleeCheck(ctx, { pct: 45 }, { cur: 400000, max: 476280 }, 7).kind, 'danger');
  assert.equal(C.fleeCheck({ ...ctx, lvl: 68 }, { pct: 45 }, { cur: 120000, max: 144648 }, 7), null, 'ordinary red: 45 % is fine');
  // 4. «Cancel» — цена: ожидаемо снятые платные баффы × время на 1 FA (150 с) против цены чемпиона; без платных — цена 0
  paid = 3;
  let cc = C.cancelCost({ tier: 'red' }, 50);                      // 50/1,3 × 0,8 × 0,07 ≈ 2,15 срабатывания → до 6,5, но висит 3 → 3 × 150 = 450 с
  assert.equal(cc.fires, 2.15); assert.equal(cc.buffs, 3); assert.equal(cc.s, 450);
  cc = C.cancelCost({ tier: 'blue' }, 100);                        // 100/1,3 × 0,8 × 0,03 ≈ 1,85, задержка 30 с: ≤ 1 + 100/30 — не режет
  assert.equal(cc.fires, 1.85);
  assert.ok(C.cancelCost({ tier: 'blue' }, 1000).fires <= 1 + 1000 / 30, 'blue: at most one fire per 30 s');
  assert.equal(C.cancelCost({ tier: 'red' }, 50).s, 450); paid = 0; assert.equal(C.cancelCost({ tier: 'red' }, 50).s, 0, 'no paid buffs — no cost');
  paid = 3;
  j = C.judge({ tier: 'red', lvl: 68, hp: 144648, exp: 206790, fa: 0.6 });   // бой ≈50 с: потеря ≈450 с > цена ≈135 с
  assert.ok(!j.ok && j.cancel && /снимает баффы \(красный: 7 % за удар, до 3 за раз\) — платных за FA висит 3, за ≈50 с боя потеряю ≈3 \(≈450 с фарма при цене чемпиона 127 с\)/.test(j.why), j.why);
  assert.ok(!C.judge({ tier: 'orange', lvl: 67, hp: 95088, exp: 188010, fa: 0.2 }).ok, 'orange ≈34 s: ≈1.0 fire → 3 buffs ≈450 s > 64 s');
  assert.ok(!C.judge({ tier: 'blue', lvl: 67, hp: 47000, exp: 125000, fa: 0.1 }).ok, 'blue ≈18 s: ≈0.33 fire → ≈1 buff ≈150 s > 38 s');
  paid = 1; assert.ok(!C.judge({ tier: 'red', lvl: 68, hp: 144648, exp: 206790, fa: 0.6 }).ok, 'even one paid buff (≈150 s of farm) outweighs a red worth ≈135 s');
  paid = 0; assert.ok(C.judge({ tier: 'red', lvl: 68, hp: 144648, exp: 206790, fa: 0.6 }).ok, 'no paid buffs — red is the FA source again');
  env.cfg.champCancel = 'never'; assert.ok(/таких не бью \(настройка\)/.test(C.judge({ tier: 'red', lvl: 68, hp: 144648, exp: 206790, fa: 0.6 }).why));
  assert.ok(C.judge({ tier: 'blue', lvl: 67, hp: 47000, exp: 125000, fa: 0.1 }).ok, '«never» is about orange/red only');
  env.cfg.champCancel = 'always'; paid = 5; assert.ok(C.judge({ tier: 'red', lvl: 68, hp: 144648, exp: 206790, fa: 0.6 }).ok);
  env.cfg.champCancel = 'paid'; paid = 0;
  // 5. buffs: оранжевый/красный чемпион — не в память снятий как «свойство вида» (cancelRisk → null), журнал называет правило игры
  const recs = [], benv = { cfg: {}, rt: {}, $q: () => null, TB_KEYS: {}, IL: {}, setRt: async p => Object.assign(benv.rt, p), rec: (...a) => recs.push(a.join(' ')), FA_KNOWN: {}, faCost: () => 1, sleep: async () => {} };
  const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/map.html', href: '' } }; sb.globalThis = sb;
  vm.runInNewContext(read('modules/buffs.js'), sb); const B = sb.L2V7Factories.buffs(benv);
  assert.equal(B.cancelNote(['[Hot Springs Yeti] зняв з вас 3 бафи.'], 'Hot Springs Yeti', { champ: true, tier: 'red' }), 3);
  assert.match(recs.join('\n'), /Hot Springs Yeti \[чемп\] снял с вас 3 бафф\(ов\) за бой \(правило игры: красный 7 % за удар\); бесплатный набор возьму у баффера сразу, при платных баффах за FA чемпиона беру только если он стоит потери/);
  assert.equal(B.cancelRisk('Hot Springs Yeti', true, 'red'), null, 'champions with a tier are judged by champs, not by the species memory');
  assert.equal(B.cancelRisk('Hot Springs Yeti', true, 'blue'), null);
  assert.ok(B.cancelRisk('Hot Springs Yeti', true), 'without a tier (old callers) the memory still answers');
  // 6. проводка: mobfarm передаёт цвет, champs получает faPaidLeft, меню — выбор режима, значение по умолчанию
  const mf = read('modules/mobfarm.js'), ct = read('content.js'), pj = read('popup.js'), ph = read('popup.html');
  assert.match(mf, /env\.cancelRisk\?\.\(name, champ, r\.tier\)/);
  assert.match(ct, /get faPaidLeft\(\) \{ return \(\.\.\.a\) => L2V7Modules\.buffs\.faPaidLeft\(\.\.\.a\); \} \}\);/);
  assert.match(ct, /champCancel: 'paid'/); assert.match(pj, /champCancel: 'paid'/); assert.match(pj, /'champCancel', 'mmFarmSpoil'/);
  assert.match(ph, /<select id="champCancel"><option value="paid">/); assert.match(ph, /синий 3 % \(раз в 30 с\), оранжевый 5 %, красный 7 %/);
  assert.match(pj, /red73: 'красные 73\+/);
  console.log('PASS: 10.0.8 champions 73+ (HP ×3, def ×4 → own DPS class, flee at 50 % HP) and Cancel as a price (blue 3 % / orange 5 % / red 7 % per hit × expected hits × 3 buffs × 150 s per FA vs the champion worth; plain mobs by memory as before)');
})().catch(e => { console.error(e); process.exit(1); });
