'use strict';
// 10.0.10 (лог 13.10 18:13:01–18:13:51, новый Human Fighter «alt1» 8 ур.): после отхода «не пробиваю» бот пять раз подряд снова шёл к тому же
// красному Hook Spider 16 (+8 к герою): уровень героя при вердикте читался как 0/1 (шапка на переходе), окно уровней при неизвестном уровне
// не работало, «сила выросла» срабатывала от скачка среднего ДПС. И 18:31:07: чемпион Tracker Skeleton 17 получил общее «не по зубам» по имени
// вида — обычных Tracker Skeleton 996 HP бот дважды отказался бить.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const mk = extra => { const c = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, Promise, CSS: { escape: s => s }, document: { querySelectorAll: () => [] }, ...extra }; c.globalThis = c; return c; };
const load = (file, env, extra) => { const ctx = mk(extra); vm.runInNewContext(read(file), ctx); return file.endsWith('/champs.js') ? require('./champs-context-fixture.cjs').freshChamps(ctx.L2V7Factories.champs,env) : ctx.L2V7Factories[path.basename(file, '.js')](env); };
(async () => {
  // 1. champs: уровень героя на переходе = 0 → вердикт всё равно по настоящему разрыву (ctx.heroLvl0 / кэш), держит 5 мин
  let lvl = 8;
  const env = { cfg: { champRed: true, champMinLvl: 0 }, rt: { dps: { dps: 298, n: 1 } }, heroLvl: () => lvl, farmRate: () => null, setRt: async p => Object.assign(env.rt, p) };
  const C = load('modules/champs.js', env);
  const spider = { tier: 'red', lvl: 16, hp: 28440, exp: 11400, fa: 0.6 };
  lvl = 0;                                                   // шапка пуста (страница боя закрывается)
  await C.learn({ champ: true, tier: 'red', lvl: 16, chHp0: 28440, chLim: 120, heroLvl0: 8 }, 'weak', 824, 8);
  lvl = 8;
  const v = env.rt.champLearn.v.red;
  assert.equal(v.gap, 8, 'gap from the real hero level, not 0');
  assert.equal(v.chLvl, 16); assert.equal(v.pow.lvl, 8);
  assert.ok(!env.rt.champLearn.dps, '«не пробиваю» — ДПС не запоминается');
  let j = C.judge(spider);
  assert.ok(!j.ok && /жду роста силы/.test(j.why) && /не раньше чем через/.test(j.why), 'same champion right after the retreat — skipped: ' + j.why);
  assert.ok(!C.judge({ ...spider, lvl: 0 }).ok, 'champion level unknown — fresh verdict still holds');
  env.rt.dps = { dps: 420, n: 3 };                            // среднее подскочило после пары боёв (+41 %) — это не рост силы
  assert.ok(!C.judge(spider).ok, 'volatile DPS average does not lift a fresh verdict');
  assert.ok(C.judge({ ...spider, lvl: 9 }).ok, 'an easier red (gap 1 < 8) is still a target');
  lvl = 9; assert.ok(C.judge(spider).ok, 'new level lifts the verdict at once'); lvl = 8;
  env.rt.champLearn.v.red.t -= C.V_HOLD + 1;                 // выдержка прошла
  env.rt.dps = { dps: 420, n: 3 }; assert.ok(!C.judge(spider).ok, 'after 5 min: +41 % from 3 fights is not a firm measurement');
  env.rt.dps = { dps: 345, n: 12 }; assert.ok(C.judge(spider).ok, 'after 5 min: +15 % over ≥ 10 fights lifts it');
  // учёт ДПС: «долго» и победа — пишутся
  await C.learn({ champ: true, tier: 'orange', lvl: 18, chHp0: 20880, chLim: 70, heroLvl0: 13 }, 'slow', 1391, 10);
  assert.equal(env.rt.champLearn.dps.dps, Math.round(1391 / 10));
  // кэш уровня: шапка пуста — последний ненулевой
  lvl = 13; C.judge(spider); lvl = 0; assert.equal(C.powNow().lvl, 13, 'last non-zero hero level is remembered');

  // 2. mobfarm: чемпион без записи в кэше спавнов — имя и уровень из строки списка, окно +5 работает
  const recs = [];
  let hl = 8;
  const row = (id, text) => ({ getAttribute: () => `/battle.html?spawnId=${id}`, textContent: text, classList: { contains: () => false }, className: '' });
  const rows = [row('champ_r_elf_village_2', 'Hook Spider · ур. 16 · чемпион'), row('dense_1', 'Elder Red Keltir · ур. 3')];
  const menv = { cfg: { champRed: true, champMinLvl: 0, /* 10.0.10: красные по умолчанию ВЫКЛ, порог 20 ур. — здесь проверяется логика до галок */  priority: '[квест]\n[чемп]\n[все]', searchChamp: true, searchQuest: true, lvlBelow: 5, lvlAbove: 5, lvlMin: 1, lvlMax: 99, champFa: true },
    rt: { spawns: {} }, PAGE_SIZE: 15, champs: C, LV_RE: /^([^\p{L}\d]*)(.+?)\s*[·•]\s*ур\.?\s*(\d+)/iu, QUEST: /★/, isChamp: t => /чемпион/.test(t),
    NET_SPAWNS: { t: Date.now(), kind: { champ_r_elf_village_2: 'champion' }, tier: { champ_r_elf_village_2: 'red' }, hp: { champ_r_elf_village_2: 28440 }, exp: { champ_r_elf_village_2: 11400 } },
    heroLvl: () => hl, isRaidId: () => false, isBoss: () => false, isQuestName: () => false, cancelRisk: () => null, faPaidLeft: () => 0,
    campActive: () => false, campChampOpen: () => false, campChampMin: () => 0, campMobOpen: () => [], farmRules: () => [], recipeRules: () => [],
    rec: (...a) => recs.push(a.join(' | ')), setRt: async p => Object.assign(menv.rt, p) };
  env.rt.champLearn = {}; env.rt.dps = { dps: 298, n: 1 }; env.heroLvl = () => hl;
  const M = load('modules/mobfarm.js', menv, { document: { querySelectorAll: () => rows } });
  const pick = () => Array.from(M.candidates(M.parseRules(), { ids: ['champ_r_elf_village_2', 'dense_1'], quest: [] }, menv.NET_SPAWNS.kind, 99), x => x.id + ':' + x.lvl);
  assert.deepEqual(JSON.parse(JSON.stringify(pick())), ['dense_1:3'], 'Hook Spider 16 at hero 8 (+8) is outside the +5 window even without a spawn cache entry');
  hl = 12; assert.deepEqual(JSON.parse(JSON.stringify(pick())), ['champ_r_elf_village_2:16'], 'at hero 12 (+4) the champion is a target with its level from the page row (Keltir 3 is now below −5)');

  // 3. проводка: combat — чемпион без метки «не по зубам» по имени; ядро — уровень героя с запасом
  const cb = read('modules/combat.js'), ct = read('content.js');
  assert.match(cb, /if \(ctx\.champ && !ctx\.rb && env\.champs\) \{\s*ctx\.chOut = true;[\s\S]*?await env\.champs\.learn\(ctx, losing \? 'danger' : 'slow', dealtC, secC\);\s*\} else \{\s*await env\.setRt\(\{ hardMobs:/, 'champion hopeless → champs.learn, no hardMobs by name');
  assert.match(cb, /ctx\.heroLvl0 = env\.heroLvl\(\) \|\| env\.rt\.lvl \|\| 0;/);
  assert.match(ct, /const heroLvl = \(\) => \{ const v = parseInt[\s\S]*?if \(v\) lvlSeen = v; return v \|\| lvlSeen \|\| 0; \};/);
  assert.match(ct, /const heroLevel = \(\) => heroLvl\(\);/);
  console.log('PASS: 10.0.10 champion re-pick loop — verdict from the real hero level (ctx.heroLvl0 / cached HUD level), 5-min hold, firm DPS growth only, no DPS from «не пробиваю», level window from the page row, champion never marked «не по зубам» by species name');
})().catch(e => { console.error(e); process.exit(1); });
