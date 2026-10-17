'use strict';
// 8.0 (аудит РБ, логи 10.10 21:31–23:30): спецудар по M.Atk, «не по силам» до нового уровня, вид пропуска, РБ на карте без
// телепорта, цифры РБ до телепорта, Noblesse при платных баффах, полоса банок по замерам
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const load = (f, extra = {}) => { const sb = { console, Date, Math, JSON, CSS: { escape: s => s }, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/map.html', href: '' }, ...extra }; sb.globalThis = sb; vm.runInNewContext(read(f), sb); return sb; };
const base = require('./helpers/warlock52-rt.cjs')(); // 20.12: замеры Warlock 52 — из фикстуры
// 10.0.14: шаги тура исполняются только включённым владельцем вкладки; fixture проверяет именно разрешённый preflight.
const mk = (rt, extra = {}) => { const env = { on: true, tabOwner: true, cfg: { rbProbe: false, rbMaxBelow: 15, rbMaxAbove: 15, rbRetreatHp: 20, rbRestHp: 95 }, rt, heroLvl: () => 54, RB_WIN: 15, RB_TRY_MS: 0, RB_RETRY_MS: 0,
  meHp: () => ({ max: 4710, cur: 4710, pct: 100 }), potModel: () => ({ pool: 600000, rate: 2000, n: 960 }), hudBuffs: () => ({}), fmtK: n => String(Math.round(n)), fmtT: s => String(Math.round(s)),
  // 15.10: прежний idle-сценарий предполагает обычных мобов на точке.
  $q: s => s.startsWith('#map-mob-list ')?{}:null,
  setRt: async p => Object.assign(env.rt, p), rec: () => {}, ...extra }; return { env, R: load('modules/raid.js', extra.sb || {}).L2V7Factories.raid(env) }; };

// 1. спецудар — от M.Atk: множитель по своим боям (базовый профиль: 0,71–0,90) ≥ 0,9
const { R } = mk({ rbStats: base.rbStats, rbDb: base.rbDb, rbK: base.rbK });
const k = R.rbSpM(); assert.ok(k >= 0.9 && k <= 1.4, 'M.Atk multiplier ' + k);
const verfa = R.rbPreCheck('l2dop_rb_25050', { hp: 771340, patk: 3310, matk: 3110 });          // реально 2600 (60 % HP) — не лезть
assert.equal(verfa.ok, false, 'Верфа is refused: ' + verfa.why);
{ const { env: e9, R: R9 } = mk({ rbStats: base.rbStats, rbDb: base.rbDb, rbK: base.rbK }); delete e9.cfg.rbProbe;   // 9.2.5: оценка 59 % (реально 2600) — пробный заход, выход ниже оценки × 1,1
  assert.equal(R9.rbPreCheck('l2dop_rb_25050', { hp: 771340, patk: 3310, matk: 3110 }).probe, true); }
const golem = R.rbPreCheck('x_golem', { hp: 500000, patk: 3800, matk: 4204 });
assert.equal(golem.ok, false, 'Golem (M.Atk 4204) refused');
const selyan = R.rbPreCheck('l2dop_rb_25013', { hp: 507285, patk: 2894, matk: 2217 });        // убит в логе — должен проходить
assert.match(selyan.why, /спецудар (19|20|21|22|23|24|25|26|27|28|29|30|31)\d\d HP/, 'Селян estimate ≈0,9–1,4 × 2217: ' + selyan.why);
// без M.Atk — как раньше (по P.Atk)
assert.ok(R.rbPreCheck('y', { hp: 300000, patk: 1084 }).ok);

// 2. «не по силам» — только до нового уровня (rbVerdictBlocks), в т.ч. для раненого РБ
const { R: R2 } = mk({ rbList: { a: { name: 'A', lvl: 50, alive: true }, b: { name: 'B', lvl: 51, alive: true } },
  // 15.10: истечение старого запрета не заменяет обязательную разведку точных цифр цели.
  rbStats: { a: { hp: 1000, patk: 1, matk: 1, src: 'api' }, b: { hp: 1000, patk: 1, matk: 1, src: 'api' } },
  rbDb: { a: { verdict: 'no', heroLvl: 52 }, b: { verdict: 'no', heroLvl: 54 } }, rbWound: { a: { cur: 100, max: 1000, t: Date.now() } } });
assert.equal(JSON.stringify(R2.rbEligible().map(x => x[0])), '["a"]', "old 'no' (hero 52, now 54) expired; fresh 'no' blocks");
assert.equal(R2.rbWounded('a'), true, 'wounded boss with expired verdict — finish it');
const combat = read('modules/combat.js');
assert.match(combat, /if \(v\.lethal\) await env\.rbNote\(ctx\.rb\.id, \{ note: v\.why \}\);/, 'lethal hit is not an eternal verdict');

// 3. вид пропуска: «сильный» больше не «мало банок»
const { R: R3 } = mk({ rbPreSkip: { s: { t: Date.now(), kind: 'strong' }, p: { t: Date.now(), kind: 'pots' }, o: Date.now() }, rbDb: {}, rbStats: {} });
assert.match(R3.rbTeleportCheck('s', { lvl: 50 }), /не по силам по оценке/);
assert.match(R3.rbTeleportCheck('p', { lvl: 50 }), /мало банок/);
assert.match(R3.rbTeleportCheck('o', { lvl: 50 }), /пропуск после осмотра/, 'old numeric format still works');

// 4. цифры РБ до телепорта: GET /game/spawn/<id>/info (ответ как в логе 23:30)
const calls = [];
const info = { spawnId: 'l2dop_rb_99050', stats: { maxHp: 771340, pAtk: 3310, pDef: 859, mAtk: 3110, mDef: 929 }, drops: [{ kind: 'adena', chance: 1, min: 204000, max: 264667 }] };
const fetchOk = async u => { calls.push(u); return { ok: true, json: async () => info }; };
// 8.0.3: Верфа (25050) теперь среди встроенных цифр (RB_KNOWN) — запрос проверяем на незнакомом id
const { env: e4, R: R4 } = mk({ rbStats: { l2dop_rb_99050: { loss: 77 }, l2dop_rb_25050: { loss: 55 } }, rbDb: {} }, { sb: { fetch: fetchOk, AbortController, setTimeout, clearTimeout } });
(async () => {
  const kv = await R4.rbInfo('l2dop_rb_25050');
  assert.equal(JSON.stringify([kv.hp, kv.matk, kv.loss, kv.src, calls.length]), JSON.stringify([771340, 3110, 55, 'api', 0]), 'built-in numbers, own measured loss kept, no request');
  const st = await R4.rbInfo('l2dop_rb_99050');
  assert.equal(calls[0], '/game/spawn/l2dop_rb_99050/info');
  assert.equal(JSON.stringify([st.hp, st.patk, st.matk, st.adena, st.loss, st.src]), JSON.stringify([771340, 3310, 3110, 234334, 77, 'api']), 'stats + adena merged with the measured loss');
  await R4.rbInfo('l2dop_rb_99050'); assert.equal(calls.length, 1, 'cached');
  const { env: e5, R: R5 } = mk({ rbStats: {}, rbDb: {} }, { sb: { fetch: async () => { throw new Error('net'); }, AbortController, setTimeout, clearTimeout } });
  assert.equal(await R5.rbInfo('z'), null); assert.ok(e5.rt.rbInfoFail.z, 'failure remembered (8.0.3: 10 min)');
  // 5. код: РБ на карте без телепорта; проверка до телепорта; слияние осмотра; время раненого боя; полоса банок
  const raid = read('modules/raid.js');
  assert.match(raid, /он здесь, на этой карте: без телепорта[\s\S]{0,200}huntSet\(\{ step: 'arrive'/);
  assert.match(raid, /до телепорта по цифрам игры — не полезу/);
  assert.match(raid, /const merged = \{ \.\.\.\(env\.rt\.rbStats\?\.\[r\.id\] \|\| \{\}\), \.\.\.st, t: Date\.now\(\) \};/);
  assert.match(combat, /const fightS = \(Date\.now\(\) - t0\) \/ 1000 \* \(ctx\.hp0 > 0 && ctx\.max > ctx\.hp0 \? Math\.min\(20, ctx\.max \/ ctx\.hp0\) : 1\);/);
  assert.match(combat, /known \? Math\.min\(95, Math\.max\(60, emergencyFloor \/ me\.max \* 100 \+ 15\)\)/);
  // 6. Noblesse при платных баффах FA на РБ
  const H = { 1413: Date.now() + 3600000 };   // Magnus' Chant (5 FA) висит, Noblesse нет
  const box = { querySelectorAll: () => Object.entries(H).map(([id, exp]) => ({ dataset: { skillId: id, expiresAt: String(exp) } })) };
  const benv = { cfg: { rbHuntMode: true, faBuffs: '' }, rt: {}, $q: s => s === '#l2-hud-active-buffs' ? box : null, FA_KNOWN: { 1413: ["Magnus' Chant", 5] }, faCost: () => 1, TB_KEYS: {} };
  const B = load('modules/buffs.js').L2V7Factories.buffs(benv);
  assert.equal(JSON.stringify([...B.faWanted()]), '[1323]', 'Noblesse wanted while paid FA buffs are up');
  benv.cfg.rbHuntMode = false; assert.equal(JSON.stringify([...B.faWanted()]), '[]', 'not in RB modes — nothing');
  // 7. 8.0.3 (эпики): rbPreCheck берёт переданный ДПС и HP героя, отдаёт цифры (sp/spPct/t); окно босса на странице эпиков (#rb-modal-stats)
  { const { R: R7 } = mk({ rbStats: base.rbStats, rbDb: base.rbDb, rbK: base.rbK });
    const c = R7.rbPreCheck('l2dop_rb_25013', { hp: 507285, patk: 2894, matk: 2217 }, 1, 1180);
    assert.equal(c.t, Math.round(507285 / 1180), 'passed DPS used'); assert.ok(c.sp > 1900 && c.spPct === Math.round(c.sp / 4710 * 100), 'sp/spPct returned');
    assert.equal(R7.rbPreCheck('l2dop_rb_25013', { hp: 507285, patk: 2894, matk: 2217 }, 1, 1180, 9420).spPct, Math.round(c.sp / 9420 * 100), 'hero HP passed in');
    const dts = [['hp', '429898'], ['patk', '3150'], ['matk', '2562'], ['exp', '1 179 536']].map(([k, v]) => ({ dataset: { stat: k }, nextElementSibling: { textContent: v } }));
    const sel = []; const { R: Rm } = mk({}, { sb: { document: { querySelectorAll: s => { sel.push(s); return /#rb-modal-stats/.test(s) ? dts : []; }, querySelector: () => null } } });
    const ms = Rm.rbModalStats(); assert.deepEqual([ms.hp, ms.patk, ms.matk, ms.exp], [429898, 3150, 2562, 1179536]); assert.match(sel[0], /#rb-modal-stats dt\[data-stat\]/); }
  // 8. 8.0.3: пассивный разбор /game/spawn/<id>/info (игра сама шлёт его при нажатии на РБ) — src остаётся 'api' (откуда — в from),
  // drops, урезанный hook.js («…ещё N»), не ломает разбор; тур РБ по-прежнему проверяет цифры ДО платного телепорта
  { const id = 'l2dop_rb_25013';
    const { env: e8, R: R8 } = mk({ rbHunt: { step: 'pick' }, rbListT: Date.now(), rbList: { [id]: { name: 'Селян', lvl: 50, alive: true, page: 2, ord: 1 } },
      rbStats: { ...base.rbStats, [id]: { hp: 507285, patk: 2894, matk: 2217, mdef: 904, src: 'api', loss: 77 } }, rbDb: JSON.parse(JSON.stringify(base.rbDb)), rbK: base.rbK, rbDps: base.rbDps, rbLossK: base.rbLossK },
      { meHp: () => ({ max: 6500, cur: 6500, pct: 100 }), isMap: () => true, aroundSig: () => ({ ids: [] }), sb: { document: { querySelectorAll: () => [], querySelector: () => null } }, townBuffStart: async () => false, restoreVitals: async () => false, meMp: () => ({ cur: 100, max: 100 }), recBot: () => {}, setStatus: () => {}, sleep: async () => {}, pair: () => [0, 0] });   // 10.0: выбор — с карты
    // Legacy preflight remains covered outside the ordinary live-target policy.
    e8.cfg.rbHuntMode = false; e8.cfg.rbMode = true; e8.cfg.shopAuto = false;
    const st = await R8.rbInfoNote(id, { stats: { maxHp: 507285, pAtk: 2894, pDef: 708, mAtk: 2217, mDef: 904 }, drops: [{ kind: 'adena', chance: 1, min: 200000, max: 260000 }, '…ещё 5'], rewardExp: 637000, rewardSp: 150000 }, 'page');
    assert.deepEqual([st.src, st.from, st.loss, st.adena, st.exp, st.sp], ['api', 'page', 77, 230000, 637000, 150000], 'passive note keeps src api, measured loss and parses drops');
    assert.equal(await R8.rbInfoNote(id, { stats: {} }, 'page'), null, 'no stats — nothing written');
    let n = 0; e8.potModel = () => (++n === 1 ? { pool: 600000, rate: 2000, n: 960 } : { pool: 0, rate: 2000, n: 0 });
    // 15.10: окончательный выбор выполняется после подготовки; исчезнувшие банки сразу переводят в ожидание.
    e8.map = async () => {};
    await R8.rbHuntStep();
    assert.ok(n >= 2, 'potion stock checked again after preparation, before selecting a paid route');
    assert.match(e8.rt.rbHunt.last || '', /мало банок/, 'fresh preflight still runs after a passive note');
    assert.notEqual(e8.rt.rbHunt.step, 'go'); }
  console.log('PASS: RB special by M.Atk (Верфа/Голем refused, Селян allowed), verdict only until level-up, skip kinds, spawn info before teleport, map boss without teleport, Noblesse with paid buffs, potion band by measurements, rbPreCheck with DPS/HP, #rb-modal-stats, passive spawn info keeps the pre-teleport check');
})().catch(e => { console.error(e); process.exit(1); });
