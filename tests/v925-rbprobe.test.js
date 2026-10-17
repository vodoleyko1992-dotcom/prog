'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 9.2.5 (игрок 12.10: «я скинул список РБ, в которых бот не уверен, а он всё равно не шёл всех проверять»; лог 12.10 10:51–12:02):
// 1) у Кастора, Фальстона, Тимініеля, Гекатона в памяти лежали неточные цифры базового профиля 8.0.3 (from 'base803', M.Atk Кастора 9339
//    при настоящих 4339) и шли впереди встроенных цифр игры — «спецудар 131 % HP» вместо 61 %;
// 2) «не по силам» по ОЦЕНКЕ спецудара не проверялось никогда — пробный заход (cfg.rbProbe): оценка < 80 % HP, раз на уровень героя,
//    в бою выход, когда HP ниже оценки × 1,1 (спецудар ещё не видели) или прогноз плохой
const assert = require('node:assert/strict');
const { read, clone, mk, base, H } = require('./epic-harness.cjs');

const KASTOR = 'l2dop_rb_25226', me = { max: 6417, cur: 6417, pct: 100 };
const old803 = { hp: 1298827, patk: 7660, pdef: 4550, matk: 9339, mdef: 4550, src: 'api', from: 'base803', t: 1791686400000, adena: 282000 };
const mkK = (o = {}) => mk({ hero: 61, meHp: () => me, ...o, rt: { rbStats: { ...clone(base.rbStats), [KASTOR]: old803 }, rbDb: clone(base.rbDb), ...(o.rt || {}) } });

(async () => {
  // ---------- 1. встроенные цифры важнее записи base803 ----------
  let m = mkK();
  const g = m.R.rbStatsGuess(KASTOR, 62);
  assert.equal(g.matk, 4339, 'built-in M.Atk wins over the stale base803 entry'); assert.equal(g.adena, 282000, 'own extras kept'); assert.equal(g.est, false);
  assert.equal((await m.R.rbInfo(KASTOR)).matk, 4339); assert.equal(m.calls.length, 0, 'no request: built-in numbers are enough');
  m.env.rt.rbStats[KASTOR] = { ...old803, matk: 5000, from: 'api' };
  assert.equal(m.R.rbStatsGuess(KASTOR, 62).matk, 5000, 'a real game answer (from api) stays as is');
  // базовый профиль больше не расходится со встроенными цифрами
  const K = m.R.rbKnown;
  for (const [id, s] of Object.entries(base.rbStats)) {
    const k = K(id); if (!k || s.from !== 'base803') continue;
    for (const f of ['hp', 'patk', 'matk']) assert.equal(s[f], k[f], `base profile ${id}.${f}`);
  }

  // ---------- 2. пробный заход по оценке ----------
  m = mkK();
  const c1 = m.R.rbPreCheck(KASTOR, m.R.rbStatsGuess(KASTOR, 62));
  assert.ok(c1.spPct >= 45 && c1.spPct < 80, 'estimate ' + c1.spPct + '% — blocked before');
  assert.equal(c1.ok, true); assert.equal(c1.probe, true); assert.match(c1.why, /пробный заход/);
  assert.equal(m.R.rbTeleportCheck(KASTOR, { lvl: 62, price: 100000, unit: 'аден' }), null, 'the tour may fly to it');
  m.env.cfg.rbProbe = false; assert.equal(m.R.rbPreCheck(KASTOR, m.R.rbStatsGuess(KASTOR, 62)).ok, false, 'option off → as before'); delete m.env.cfg.rbProbe;
  // свой спецудар уже видели — решают настоящие цифры
  m.env.rt.rbDb[KASTOR] = { sp: 3500 }; let c = m.R.rbPreCheck(KASTOR, m.R.rbStatsGuess(KASTOR, 62));
  assert.equal(c.ok, false); assert.ok(!c.probe, 'measured special → no probe');
  // проба на этом уровне уже была (старше 3 ч) — второй раз нет; на новом уровне — снова
  m.env.rt.rbDb[KASTOR] = { probe: { t: Date.now() - 4 * H, lvl: 61, sp: 3905 } };
  assert.equal(m.R.rbPreCheck(KASTOR, m.R.rbStatsGuess(KASTOR, 62)).ok, false, 'one probe per hero level');
  m.setHero(62); assert.equal(m.R.rbPreCheck(KASTOR, m.R.rbStatsGuess(KASTOR, 62)).probe, true, 'new level → probe again'); m.setHero(61);
  m.env.rt.rbDb[KASTOR] = { probe: { t: Date.now() - H, lvl: 61, sp: 3905 } };
  assert.equal(m.R.rbPreCheck(KASTOR, m.R.rbStatsGuess(KASTOR, 62)).probe, true, 'within 3 h the same probe continues (teleport, rest)');
  // слишком сильный по оценке (≥ 80 % HP), прикидка по другим РБ, «не по силам» по бою, эпик — без пробы
  m.env.rt.rbDb[KASTOR] = {};
  assert.equal(m.R.rbPreCheck(KASTOR, { ...m.R.rbStatsGuess(KASTOR, 62), matk: 9339 }).ok, false, 'estimate ≥ 80 % of HP');
  assert.equal(m.R.rbPreCheck(KASTOR, { ...m.R.rbStatsGuess(KASTOR, 62), est: true }, 1).probe, undefined, 'guess from other RBs → no probe');
  m.env.rt.rbDb[KASTOR] = { verdict: 'no', heroLvl: 61 }; assert.equal(m.R.rbPreCheck(KASTOR, m.R.rbStatsGuess(KASTOR, 62)).ok, false, 'fight verdict holds');
  m.env.rt.rbDb[KASTOR] = {};
  assert.equal(m.R.rbPreCheck('l2dop_rb_29014', { hp: 400000, patk: 1100, matk: 4339 }).probe, undefined, 'epic → no probe');

  // ---------- 3. бой-проба: выход, пока цел ----------
  m.env.rt.rbDb[KASTOR] = { probe: { t: Date.now(), lvl: 61, sp: 3905 } };
  const ctx = { name: 'Roaring Lord Kastor', rb: { id: KASTOR, hits: [] } }, mob = { cur: 1200000, max: 1298827 };
  m.env.logLines = () => []; m.env.newLines = () => []; m.env.activeBuffs = () => [];
  assert.equal(m.R.probeFight(KASTOR), true);
  assert.equal(m.R.rbFlee(ctx, { max: 6417, cur: 6000 }, mob), null, 'HP above the estimate × 1.1 → keep fighting');
  const fl = m.R.rbFlee(ctx, { max: 6417, cur: 4200 }, mob);
  assert.equal(fl.kind, 'probe', 'HP below 3905 × 1.1 = 4296 → leave'); assert.match(fl.why, /пробный заход/);
  m.env.rt.rbDb[KASTOR].sp = 2500;   // спецудар увидели (39 % HP) — дальше обычное правило
  assert.equal(m.R.probeGuard(KASTOR), 0);
  assert.equal(m.R.rbFlee(ctx, { max: 6417, cur: 4200 }, mob), null, 'special measured: 2500 < 45 % → no probe exit');
  m.env.rt.rbDb[KASTOR].probe.t = Date.now() - 4 * H; assert.equal(m.R.probeFight(KASTOR), false);

  // ---------- 4. проводка ----------
  const content = (read('defaults.js') + '\n' + read('content.js')), combat = read('modules/combat.js'), popup = (read('defaults.js') + '\n' + read('popup.js')), html = read('popup.html');
  assert.match(content, /get probeFight\(\) \{ return \(\.\.\.a\) => L2V7Modules\.raid\.probeFight\(\.\.\.a\); \}/);
  assert.match(content, /epicFaFull: true, rbFaFull: true, rbProbe: true,/);
  assert.match(content, /once\('rbStats925', \(\) => \{/);
  assert.match(combat, /const probe = !ordinary && !ep && !!env\.probeFight\?\.\(ctx\.rb\.id\);/);
  assert.match(combat, /env\.cfg\.rbChipRetreat === true \|\| probe/);
  assert.match(combat, /probe \? 'skip' : undefined/);
  assert.match(combat, /d\.probe\?\.sp \|\| 0/);
  assert.match(html, /id="rbProbe" type="checkbox"/); assert.match(popup, /'rbProbe'/); assert.match(popup, /rbProbe: true/);
  // миграция: base803 → встроенные цифры, пропуски «по оценке» сняты
  const body = content.slice(content.indexOf("once('rbStats925'"), content.indexOf("once('faFull925'"));
  const rt = { rbStats: { [KASTOR]: { ...old803, loss: 40 }, x: { hp: 1, from: 'api' } }, rbPreSkip: { a: { t: 1, kind: 'strong' }, b: { t: 1, kind: 'pots' } } }, rf = {};
  const L2V7Modules = { raid: { rbKnown: K } };
  new Function('rt', 'rf', 'L2V7Modules', 'once', body)(rt, rf, L2V7Modules, (f, fn) => fn());
  assert.equal(rf.rbStats[KASTOR].matk, 4339); assert.equal(rf.rbStats[KASTOR].loss, 40); assert.deepEqual(clone(rf.rbStats.x), { hp: 1, from: 'api' });
  assert.deepEqual(Object.keys(rf.rbPreSkip), ['b']);
  console.log('PASS: 9.2.5 RB probe — built-in RB numbers win over stale base803 entries, an RB blocked only by the special-hit estimate (< 80 % HP) gets one probe per hero level, the probe fight leaves below estimate × 1.1 or on a bad forecast');
})().catch(e => { console.error(e); process.exit(1); });
