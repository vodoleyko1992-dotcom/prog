'use strict';
// 8.0 (аудит РБ, логи 10.10 21:31–23:30): спецудар по M.Atk, «не по силам» до нового уровня, вид пропуска, РБ на карте без
// телепорта, цифры РБ до телепорта, Noblesse при платных баффах, полоса банок по замерам
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const load = (f, extra = {}) => { const sb = { console, Date, Math, JSON, CSS: { escape: s => s }, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/map.html', href: '' }, ...extra }; sb.globalThis = sb; vm.runInNewContext(read(f), sb); return sb; };
const base = JSON.parse(read('base-profile.json')).chars.Warlock.rt;
const mk = (rt, extra = {}) => { const env = { cfg: { rbMaxBelow: 15, rbMaxAbove: 15, rbRetreatHp: 20, rbRestHp: 95 }, rt, heroLvl: () => 54, RB_WIN: 15, RB_TRY_MS: 0, RB_RETRY_MS: 0,
  meHp: () => ({ max: 4710, cur: 4710, pct: 100 }), potModel: () => ({ pool: 600000, rate: 2000, n: 960 }), fmtK: n => String(Math.round(n)), fmtT: s => String(Math.round(s)),
  setRt: async p => Object.assign(env.rt, p), rec: () => {}, ...extra }; return { env, R: load('modules/raid.js', extra.sb || {}).L2V7Factories.raid(env) }; };

// 1. спецудар — от M.Atk: множитель по своим боям (базовый профиль: 0,71–0,90) ≥ 0,9
const { R } = mk({ rbStats: base.rbStats, rbDb: base.rbDb, rbK: base.rbK });
const k = R.rbSpM(); assert.ok(k >= 0.9 && k <= 1.4, 'M.Atk multiplier ' + k);
const verfa = R.rbPreCheck('l2dop_rb_25050', { hp: 771340, patk: 3310, matk: 3110 });          // реально 2600 (60 % HP) — не лезть
assert.equal(verfa.ok, false, 'Верфа is refused: ' + verfa.why);
const golem = R.rbPreCheck('x_golem', { hp: 500000, patk: 3800, matk: 4204 });
assert.equal(golem.ok, false, 'Golem (M.Atk 4204) refused');
const selyan = R.rbPreCheck('l2dop_rb_25013', { hp: 507285, patk: 2894, matk: 2217 });        // убит в логе — должен проходить
assert.match(selyan.why, /спецудар (19|20|21|22|23|24|25|26|27|28|29|30|31)\d\d HP/, 'Селян estimate ≈0,9–1,4 × 2217: ' + selyan.why);
// без M.Atk — как раньше (по P.Atk)
assert.ok(R.rbPreCheck('y', { hp: 300000, patk: 1084 }).ok);

// 2. «не по силам» — только до нового уровня (rbVerdictBlocks), в т.ч. для раненого РБ
const { R: R2 } = mk({ rbList: { a: { name: 'A', lvl: 50, alive: true }, b: { name: 'B', lvl: 51, alive: true } },
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
const info = { spawnId: 'l2dop_rb_25050', stats: { maxHp: 771340, pAtk: 3310, pDef: 859, mAtk: 3110, mDef: 929 }, drops: [{ kind: 'adena', chance: 1, min: 204000, max: 264667 }] };
const fetchOk = async u => { calls.push(u); return { ok: true, json: async () => info }; };
const { env: e4, R: R4 } = mk({ rbStats: { l2dop_rb_25050: { loss: 77 } }, rbDb: {} }, { sb: { fetch: fetchOk, AbortController, setTimeout, clearTimeout } });
(async () => {
  const st = await R4.rbInfo('l2dop_rb_25050');
  assert.equal(calls[0], '/game/spawn/l2dop_rb_25050/info');
  assert.equal(JSON.stringify([st.hp, st.patk, st.matk, st.adena, st.loss, st.src]), JSON.stringify([771340, 3310, 3110, 234334, 77, 'api']), 'stats + adena merged with the measured loss');
  await R4.rbInfo('l2dop_rb_25050'); assert.equal(calls.length, 1, 'cached');
  const { env: e5, R: R5 } = mk({ rbStats: {}, rbDb: {} }, { sb: { fetch: async () => { throw new Error('net'); }, AbortController, setTimeout, clearTimeout } });
  assert.equal(await R5.rbInfo('z'), null); assert.ok(e5.rt.rbInfoFail.z, 'failure remembered (6 h)');
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
  console.log('PASS: RB special by M.Atk (Верфа/Голем refused, Селян allowed), verdict only until level-up, skip kinds, spawn info before teleport, map boss without teleport, Noblesse with paid buffs, potion band by measurements');
})().catch(e => { console.error(e); process.exit(1); });
