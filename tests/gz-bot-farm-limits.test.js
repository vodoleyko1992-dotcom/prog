'use strict';
// botfarm unit checks (node sandbox, no browser): the server's attacks-per-day limit on a target
// («Превышен лимит количества атак в сутки на данный пункт назначения.») -> 24 h pause of that target, journaled once, other targets
// go on; spy probes = the suite setting spy.probes (OGX.api.spyProbes, else OGX.settings, default 1100).
// The behaviour end to end (the world's bash rule, botcore's step-3 mapping to «attackLimit», the planning pause and its end after
// 24 h) is tests/gz-bot-farm.test.js (k); the world rule itself is tests/gz-bot-mock.test.js «world: bash rule».
//   node tests/gz-bot-farm-limits.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib');
const { assert } = T;

const ROOT = path.resolve(__dirname, '..');
const FILES = ['shared/core/00-ogx.js', 'shared/core/01-util.js', 'shared/core/08-catalog-data.js', 'shared/core/09-catalog.js', 'shared/core/10-calc.js',
  'ogamex-bot/modules/botsim/botsim.js', 'ogamex-bot/modules/botfarm/botfarm.js'];
function sandbox(pre) {
  const sb = { console, setTimeout, clearTimeout, setInterval, clearInterval };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
    if (f === 'shared/core/00-ogx.js' && pre) pre(sb.OGX);
  }
  return sb;
}
const LIMIT_MSG = 'Превышен лимит количества атак в сутки на данный пункт назначения.';
const H = 3600000;

function wctxAt(t) {
  const journal = [];
  return { journal, now: () => t.now, cfg: () => undefined, rec: (ev, what, data) => journal.push({ ev, what, data }) };
}

T.test('attack-per-day limit: target paused 24 h (state attackLimit, persisted on the target), journaled once, the cycle goes on', () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const clock = { now: Date.UTC(2026, 10, 1, 10) };
  const w = wctxAt(clock);
  const Tg = { key: '2:60:8:1', coords: '2:60:8', state: 'reported' };
  assert.equal(L.isAttackLimit({ ok: false, error: 'step3', message: LIMIT_MSG }), true);
  assert.equal(L.isAttackLimit({ ok: false, error: LIMIT_MSG }), true);
  assert.equal(L.isAttackLimit({ ok: false, message: 'Недостаточно топлива' }), false);
  const r1 = L.handleRefusal(w, Tg, { ok: false, error: 'step3', message: LIMIT_MSG }, 'атака');
  assert.equal(r1.stop, false, 'other targets are still planned');
  assert.equal(r1.attackLimit, true);
  assert.equal(Tg.state, 'attackLimit');
  assert.equal(Tg.cooldownUntil, clock.now + 24 * H, '24 h pause');
  assert.ok(/лимит атак/.test(Tg.note));
  const n = w.journal.length;
  assert.equal(w.journal.filter((e) => e.ev === 'cooldown').length, 1);
  clock.now += 60000;
  L.handleRefusal(w, Tg, { ok: false, message: LIMIT_MSG }, 'атака');
  assert.equal(w.journal.length, n, 'a second answer within the pause is not journaled again');
  assert.equal(Tg.cooldownUntil, clock.now - 60000 + 24 * H, 'the pause is not extended');
  // the limit wins over a botcore refusal class that would stop the whole cycle
  const T2 = { key: '2:60:9:1', coords: '2:60:9', state: 'reported' };
  assert.equal(L.handleRefusal(w, T2, { ok: false, refused: 'limit', message: LIMIT_MSG }, 'атака').stop, false);
  assert.equal(T2.state, 'attackLimit');
  // other errors keep their old handling
  const T3 = { key: '2:60:10:1', coords: '2:60:10', state: 'reported' };
  L.handleRefusal(w, T3, { ok: false, error: 'step3', message: 'что-то ещё' }, 'атака');
  assert.equal(T3.state, 'notSuitable');
  assert.equal(T3.cooldownUntil, clock.now + 30 * 60000);
});

T.test('planning skips a target in its attack-limit pause, and the pause ends after 24 h (source rules)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ogamex-bot/modules/botfarm/botfarm.js'), 'utf8');
  assert.ok(/filter\(\(T\) => !\(T\.cooldownUntil && T\.cooldownUntil > now\)\)/.test(src), 'planning list drops paused targets');
  // 0.3.2: 'gone' is no longer reset by the timer (only a newer galaxy view that shows the planet); poor / needFleet are
  assert.ok(/\['notSuitable', 'vacation', 'probesLost', 'noReport', 'active', 'attackLimit', 'needFleet', 'poor'\]\.includes\(T\.state\)/.test(src), 'attackLimit returns to new after the pause (noReport 1 h and active 24 h too)');
});

T.test('spy probes = spy.probes: OGX.api.spyProbes, else OGX.settings.get(spy.probes), else 1100', () => {
  assert.equal(sandbox((O) => { O.api = { spyProbes: () => 555 }; }).OGX.botFarm._lib.spyProbesSetting(), 555);
  assert.equal(sandbox((O) => { O.settings = { get: (k) => (k === 'spy.probes' ? '33' : undefined) }; }).OGX.botFarm._lib.spyProbesSetting(), 33);
  assert.equal(sandbox((O) => { O.settings = { get: () => null }; }).OGX.botFarm._lib.spyProbesSetting(), 1100);
  const L = sandbox((O) => { O.settings = { get: (k) => (k === 'spy.probes' ? 1100 : undefined) }; }).OGX.botFarm._lib;
  assert.equal(L.probesFor({ ourSpy: 12, theirSpy: 3, theirSpyKnown: true }).probes, 1100, 'probesFor defaults to the setting');
  const src = fs.readFileSync(path.join(ROOT, 'ogamex-bot/modules/botfarm/botfarm.js'), 'utf8');
  assert.ok(!/probesFirst/.test(src), 'no module probe count (probesFirst) left');
});

T.test('botcore: the attack-limit answer of step 3 is a refusal (attackLimit), not an error that feeds the error streak', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ogamex-bot/modules/botcore/botcore.js'), 'utf8');
  const m = src.match(/function mapStep3Text\(text\) \{[\s\S]*?\n {2}\}/);
  assert.ok(m, 'mapStep3Text found');
  const map = vm.runInNewContext('(' + m[0] + ')');
  assert.equal(map(LIMIT_MSG), 'attackLimit');
  assert.equal(map('Нет свободных слотов флота'), 'slots');
  assert.equal(map('что-то ещё'), 'other');
  assert.ok(/\['slots', 'fuel', 'cargo', 'ships', 'attackLimit'\]\.includes\(kind\)/.test(src), 'step 3 returns attackLimit as refused (refusals never call registerError)');
});

// ------------------------------------------------------------------ independent audit, second part (botfarm-10..17, journal-9/16, addons-9)
const J = (v) => JSON.parse(JSON.stringify(v));
function farmSandbox(t0) {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const M = sb.OGX.botFarm._M;
  const writes = [];
  M.ctx = { store: { get: async (k, d) => d, set: async (k, v) => { writes.push(k); } } };
  M.cal = {}; M.targets = {}; M.attacks = {}; M.yard = {}; M.scanAt = {};
  const clock = { now: t0 || 1_800_000_000_000 };
  sb.OGX.settings = { get: (k) => ({ 'spy.probes': 1100 })[k] };
  sb.OGX.fmt = { short: (n) => String(Math.round(n)), time: (t) => String(t) };
  sb.OGX.bot = Object.assign(sb.OGX.bot || {}, { isActive: () => false, intel: { get: () => null, put: () => {} } });
  sb.OGX.botSim = Object.assign({}, sb.OGX.botSim, { spyNeeded: () => 3 });
  sb.OGX.fleet = { gz: { dataFor: () => ({}), distance: () => 1000, duration: () => 30, consumption: () => 1, durationRaw: () => 30 } };
  return { sb, L, M, clock, writes };
}

T.test('step 2/3 and fleetAjax facts about the target (botfarm-12, journal-16): GALAXYZ ru / en texts -> gone / vacation / protected / admin with a long pause; own-side texts keep the short retry', () => {
  const { L, clock } = farmSandbox();
  const w = wctxAt(clock);
  const tg = (n) => ({ key: '2:61:' + n + ':1', coords: '2:61:' + n, state: 'reported' });
  const cases = [
    ['Пункт назначения не существует.', 'gone', 24 * H], ['Данного пункта назначения не существует.', 'gone', 24 * H], ['Target planet does not exist!', 'gone', 24 * H],
    ['Игрок находится в режиме отпуска', 'vacation', 24 * H], ['Игрок слишком слаб.', 'notSuitable', 24 * H], ['Игрок слишком силён для Вас.', 'notSuitable', 24 * H],
    ['Игрок находится под защитой новичков.', 'notSuitable', 24 * H], ['Player is too weak', 'notSuitable', 24 * H],
    ['Полёты на администраторов запрещены.', 'notSuitable', 7 * 24 * H],
  ];
  let n = 1;
  for (const [msg, state, ms] of cases) {
    const Tg = tg(n++);
    const r = L.handleRefusal(w, Tg, { ok: false, error: 'target', message: msg, noBackoff: true }, 'атака');
    assert.equal(r.stop, false, msg);
    assert.equal(Tg.state, state, msg); assert.equal(Tg.cooldownUntil, clock.now + ms, msg);
    assert.ok(Tg.db && Tg.db.verdict && Tg.db.verdict.text.includes(msg), 'server text in the verdict: ' + msg);
  }
  // botcore's game-fact refusals (refused + message) are classified by the text before the generic refused branch
  const R = tg(50);
  L.handleRefusal(w, R, { ok: false, refused: 'target', message: 'Пункт назначения не существует.', noBackoff: true }, 'атака');
  assert.equal(R.state, 'gone');
  // fleetAjax codes without a text
  const C = tg(51); L.handleRefusal(w, C, { ok: false, code: 603 }, 'шпионаж'); assert.equal(C.cooldownUntil, clock.now + 24 * H);
  const V = tg(52); L.handleRefusal(w, V, { ok: false, code: 605 }, 'шпионаж'); assert.equal(V.state, 'vacation');
  // another info text of step 2: 3 h; own-side text (fuel) and a plain error: the 30-min retry as before
  const O = tg(53); L.handleRefusal(w, O, { ok: false, error: 'target', message: 'Неизвестный ответ' }, 'атака'); assert.equal(O.cooldownUntil, clock.now + 3 * H);
  const F = tg(54); L.handleRefusal(w, F, { ok: false, error: 'target', message: 'Недостаточно топлива.' }, 'атака'); assert.equal(F.cooldownUntil, clock.now + 30 * 60000);
  const E = tg(55); L.handleRefusal(w, E, { ok: false, error: 'http' }, 'атака'); assert.equal(E.cooldownUntil, clock.now + 30 * 60000);
});

T.test('own attacks per target and day (journal-16): attacksPerDay 6 (2Moons BASH_COUNT) or the learned limit stops the target before any spy / simulation until the oldest raid is 24 h old', () => {
  const { L, M, clock } = farmSandbox();
  const cfg = {};
  const w = Object.assign(wctxAt(clock), { cfg: (k) => cfg[k] });
  const Tg = { key: '2:62:8:1', coords: '2:62:8', state: 'reported' };
  const first = clock.now - 20 * H;
  L.dbOf(Tg).raids = Array.from({ length: 5 }, (_, i) => ({ id: 'r' + i, t: first + i * H, result: 'won' }));
  assert.equal(L.atAttackCap(w, Tg, clock.now), false, '5 < 6');
  L.dbOf(Tg).raids.push({ id: 'r5', t: clock.now - H, result: 'won' }, { id: 'rx', t: clock.now - 30 * 60000, result: 'refused' });
  assert.equal(L.atAttackCap(w, Tg, clock.now), true, '6 own raids in 24 h (the refused one does not count)');
  assert.equal(Tg.state, 'attackLimit'); assert.equal(Tg.cooldownUntil, first + 24 * H, 'until the oldest raid is 24 h old');
  // a learned lower limit wins; attacksPerDay 0 = only the learned one
  const T2 = { key: '2:62:9:1', coords: '2:62:9', state: 'reported' };
  L.dbOf(T2).raids = [{ id: 'a', t: clock.now - 2 * H, result: 'won' }, { id: 'b', t: clock.now - H, result: 'won' }];
  assert.equal(L.atAttackCap(w, T2, clock.now), false);
  M.cal.attackLimit = 2;
  assert.equal(L.atAttackCap(w, T2, clock.now), true);
  M.cal.attackLimit = 0; cfg.attacksPerDay = 0; T2.state = 'reported';
  assert.equal(L.atAttackCap(w, T2, clock.now), false, 'no limit at all');
  const src = fs.readFileSync(path.join(ROOT, 'ogamex-bot/modules/botfarm/botfarm.js'), 'utf8');
  assert.ok(/if \(atAttackCap\(wctx, T, now\)\) continue;/.test(src), 'candidates: the cap before spy / simulation');
});

T.test('spy reports matched by coordinates AND body type (botfarm-16): a newer moon report never becomes the planet\'s intel', () => {
  const { sb, L } = farmSandbox();
  sb.OGX.messages = { parse: { espionageFull: (it) => it.rep } };
  const rep = (type, ts, id) => ({ id, ts, kind: 'spy_report', rep: { id, ts, attackParams: { galaxy: 2, system: 63, position: 9, type } } });
  const list = { items: [rep(3, 2000, 'moon'), rep(1, 1000, 'planet')] };
  assert.deepEqual(J(L.spyReportsFor(list, '2:63:9', 0).map((h) => h.id)), ['planet']);
  assert.deepEqual(J(L.spyReportsFor(list, '2:63:9', 0, 3).map((h) => h.id)), ['moon']);
  // no type in the link (old parser): a planet
  assert.deepEqual(J(L.spyReportsFor({ items: [{ id: 'x', ts: 5, rep: { attackParams: { galaxy: 2, system: 63, position: 9 } } }] }, '2:63:9', 0).map((h) => h.id)), ['x']);
});

T.test('fleetAjax spies leave the body (botfarm-17): the probes the game sent are deducted, a «no probes» refusal drops the cached count', async () => {
  const { sb, L, M, clock } = farmSandbox();
  const acts = [];
  let answer = null;
  const wctx = {
    now: () => clock.now, cfg: (k) => ({ useFleetAjax: true })[k], core: () => undefined, locked: () => null, sleepCheck: () => ({ ok: true }), threats: () => [],
    canSend: async () => ({ ok: true, free: 10, reserve: 1, held: 0 }), available: () => ({}), reserve: () => 'r', release: () => {},
    rec: () => {}, decide: () => {},
    act: async (spec) => { acts.push(J(spec)); return answer || { ok: true, at: clock.now, data: { arrival: clock.now + 30000, shipsSent: { 210: 1100 } } }; },
  };
  const near = { id: 1, key: 'p1', coords: '2:68:6', type: 'planet', ships: { 210: 1500 }, shipsT: clock.now };
  const far = { id: 2, key: 'p2', coords: '2:90:6', type: 'planet', ships: { 210: 5000 }, shipsT: clock.now };
  const env = { research: { 106: 22 }, factors: null, server: {}, bodies: { p1: near, p2: far } };
  sb.OGX.fleet.gz.distance = (a) => (a === '2:68:6' ? 100 : 5000);
  M.shipsSeen = { 1: { t: clock.now, ships: { 210: 1500 } }, 2: { t: clock.now, ships: { 210: 5000 } } };
  const mk = (n) => ({ key: '2:70:' + n + ':1', coords: '2:70:' + n, target: { galaxy: 2, system: 70, position: n, type: 1 }, state: 'new', planetId: 9000 + n });
  await L.spyTarget(wctx, env, mk(1), Object.values(env.bodies), { reason: 'тест' });
  assert.equal(acts[0].type, 'fleet.ajax'); assert.equal(acts[0].bodyId, 1);
  assert.equal(near.ships[210], 400, 'the 1100 probes the game sent left the cached count');
  await L.spyTarget(wctx, env, mk(2), Object.values(env.bodies), { reason: 'тест' });
  assert.equal(acts[1].bodyId, 2, 'the second spy of the run leaves the body that still has a full mission');
  // refusal «Нет свободных шпионских зондов» (fleetAjax 611 -> refused 'ships'): the body's cached ships are dropped
  answer = { ok: false, refused: 'ships', code: 611, message: 'Нет свободных шпионских зондов.' };
  await L.spyTarget(wctx, env, mk(3), Object.values(env.bodies), { reason: 'тест' });
  assert.equal(M.shipsSeen[2], undefined, 'cached fleetTable of that body forgotten');
  assert.ok(M.staleAt && M.staleAt[2] > 0);
});

T.test('undefeatable targets (journal-9): our whole fleet loses / a build > 24 h -> 24 h pause, then doubling up to a week WITHOUT a re-spy while our fleet has not doubled', () => {
  const { L, clock } = farmSandbox();
  const w = Object.assign(wctxAt(clock), { cfg: () => undefined });
  const env = { bodies: { p1: { id: 1, ships: { 215: 1000, 217: 100 } } } };
  const Tg = { key: '2:72:6:1', coords: '2:72:6', state: 'reported' };
  L.tooStrong(w, env, Tg, 'нужно 27.9 млн ЛИ');
  assert.equal(Tg.state, 'notSuitable'); assert.equal(Tg.cooldownUntil, clock.now + 24 * H);
  assert.equal(Tg.db.verdict.kind, 'tooStrong');
  const base = Tg.tooStrong.fleetMsu; assert.ok(base > 0);
  // the pause is over, our fleet grew by 50 %: a longer pause (48 h), no state 'new' (no spy)
  clock.now = Tg.cooldownUntil + 1000;
  env.bodies.p1.ships[215] = 1500;
  assert.equal(L.tooStrongExpired(w, env, Tg), false);
  assert.equal(Tg.state, 'notSuitable'); assert.equal(Tg.cooldownUntil, clock.now + 48 * H); assert.equal(Tg.tooStrong.fleetMsu, base, 'the yardstick stays the first fleet');
  for (let i = 0; i < 5; i++) { clock.now = Tg.cooldownUntil + 1000; L.tooStrongExpired(w, env, Tg); }
  assert.equal(Tg.cooldownUntil, clock.now + 7 * 24 * H, 'capped at a week');
  // the fleet doubled: evaluated again
  clock.now = Tg.cooldownUntil + 1000;
  env.bodies.p1.ships[215] = 3000; env.bodies.p1.ships[217] = 300;
  assert.equal(L.tooStrongExpired(w, env, Tg), true); assert.equal(Tg.tooStrong, null);
  const src = fs.readFileSync(path.join(ROOT, 'ogamex-bot/modules/botfarm/botfarm.js'), 'utf8');
  assert.ok(/T\.tooStrong && T\.state === 'notSuitable' && !tooStrongExpired\(wctx, env, T\)\) continue;/.test(src), 'housekeeping: no reset to new while tooStrong');
  assert.ok(/b\.skipped === 'buildTooLong' && num\(bd\.secs\) \+ num\(bd\.queued\) > 24 \* 3600\) \{ tooStrong\(/.test(src), 'a build > 24 h is tooStrong');
});

T.test('buildShips payback (botfarm-10): a build costs at most a week of the target\'s loot and at most 2 h in the shipyard', () => {
  const { sb, L, M, clock } = farmSandbox();
  M.cal.unitSpeed = 1e6;
  sb.OGX.bot.intel = { get: () => ({ ts: clock.now, res: {}, buildings: {} }) };
  const w = Object.assign(wctxAt(clock), { cfg: (k) => ({ buildMaxWaitMin: 30 })[k], available: () => ({ metal: 1e15, crystal: 1e15, deuterium: 1e15 }) });
  const o = { id: 11, key: 'p11', coords: '2:68:5', type: 'planet', levels: { 21: 12, 15: 3 }, queues: {} };
  const env = { bodies: { p11: o }, factors: null, server: {} };
  const T0 = { key: '2:68:20:1', coords: '2:68:20' };
  const cost = L.unitsMsu({ 215: 1000 });
  // a week of loot: without production = the loot of now (no growth)
  const poor = L.buildCheck(w, env, T0, { origin: o, missing: { 215: 1000 }, duration: 100, fuel: 0, lootExp: cost / 2 }, o, 1e6);
  assert.equal(poor.skip && poor.skip[1], 'buildPayback', JSON.stringify(poor.skip));
  const rich = L.buildCheck(w, env, T0, { origin: o, missing: { 215: 1000 }, duration: 100, fuel: 0, lootExp: cost * 2 }, o, 1e6);
  assert.ok(!rich.skip, JSON.stringify(rich.skip));
  // unknown loot (old plans): no payback check
  assert.ok(!L.buildCheck(w, env, T0, { origin: o, missing: { 215: 1000 }, duration: 100, fuel: 0 }, o, 1e6).skip);
  // more than 2 h in the shipyard even with a long buildMaxWaitMin
  const w2 = Object.assign({}, w, { cfg: (k) => ({ buildMaxWaitMin: 1440 })[k] });
  const slow = L.buildCheck(w2, env, T0, { origin: o, missing: { 215: 8000 }, duration: 100, fuel: 0, lootExp: cost * 100 }, o, 1e6);
  assert.equal(slow.skip && slow.skip[1], 'buildTooLong');
  assert.ok(slow.skip[2].secs > 2 * 3600 && /на верфи > 2 ч/.test(slow.skip[0]), slow.skip[0]);
  // lootWeek: production adds half of it for 7 days, capped at 6 full raids a day
  assert.equal(L.lootWeek(null, 1000, {}), 1000);
});

T.test('galaxy scan pacing (botfarm-11): one batch per 5 min of a twelfth of 80 % of galaxyViewsPerHour; 20 % always left to the other modules', async () => {
  const { sb, L, M, clock } = farmSandbox();
  let remaining = 300;
  sb.OGX.bot.limits = { remaining: () => remaining };
  sb.OGX.galaxy = { cached: async () => null, rememberSystem: async () => {} };
  sb.OGX.storage = { get: async () => null };
  const reads = [];
  const w = Object.assign(wctxAt(clock), { cfg: (k) => ({ scanPerCycle: 40, scanEveryH: 24 })[k], core: (k) => (k === 'galaxyViewsPerHour' ? 300 : 0), decide: () => {},
    act: async (spec) => { reads.push(spec.params.system); remaining--; return { ok: true, at: clock.now, data: { system: { galaxy: 2, system: spec.params.system, t: clock.now, positions: [] } } }; } });
  const systems = new Map(Array.from({ length: 100 }, (_, i) => ['2:' + (i + 1), i]));
  await L.scanSystems(w, systems);
  assert.equal(reads.length, 20, '240 views/h for the farm -> 20 per 5-min batch (not scanPerCycle 40)');
  clock.now += 30000;
  await L.scanSystems(w, systems);
  assert.equal(reads.length, 20, 'a run 30 s later: no new batch');
  clock.now += 5 * 60000;
  remaining = 65;
  await L.scanSystems(w, systems);
  assert.equal(reads.length, 25, 'only what exceeds the 60 views kept for the others');
  clock.now += 5 * 60000; reads.length = 0; remaining = 60;
  await L.scanSystems(w, systems);
  assert.equal(reads.length, 0, '20 % left: no scan');
  // a refused read leaves the system unmarked (rescanned later)
  clock.now += 5 * 60000; remaining = 300; M.scanAt = {};
  w.act = async () => ({ ok: false, refused: 'limit' });
  await L.scanSystems(w, new Map([['2:200', 0]]));
  assert.equal(M.scanAt['2:200'], undefined);
});

T.test('combat report under the AJAX gate (botfarm-15): a page load before the reads, found on the third read -> calibrated, raid result in the database', async () => {
  const { sb, L, M, clock } = farmSandbox();
  let lists = [[], [], null];
  sb.OGX.messages = { parse: { list: (doc) => doc.items || [], battleShort: (it) => it.b } };
  const acts = [];
  const w = Object.assign(wctxAt(clock), { core: () => undefined, decide: () => {},
    act: async (spec) => { acts.push(spec.type); if (spec.type === 'read.messages') { const l = lists.shift(); return { ok: true, at: clock.now, data: { doc: { items: l || [{ ts: A.arrival + 1000, b: { coords: '2:64:4', winner: 'a', loot: { metal: 6e6, crystal: 0, deuterium: 0 }, attacker: { losses: 0 } } }] } } }; } return { ok: true, at: clock.now, data: {} }; } });
  const A = { id: 'farm:2:64:4:1:1', key: '2:64:4:1', coords: '2:64:4', status: 'flying', arrival: clock.now - 6000, back: clock.now + H, predictedLoot: { metal: 5e6, crystal: 0, deuterium: 0 }, plan: {} };
  M.attacks[A.id] = A;
  M.targets[A.key] = { key: A.key, coords: A.coords, state: 'attackFlying', db: { reports: [], raids: [{ id: A.id, t: A.arrival, result: 'flying', lootMsu: null }], totals: {} } };
  for (let i = 0; i < 3; i++) { await L.processCombatReports(w); if (A.combatRead) break; clock.now = A.combatReadAt; }
  assert.equal(A.combatRead, 'yes'); assert.equal(A.combatTries, 2, 'two misses first');
  assert.equal(acts.filter((a) => a === 'read.page').length, 3, 'a page load before every read');
  assert.equal(M.cal.loot.length, 1);
  assert.equal(M.targets[A.key].db.raids[0].result, 'won');
});

T.test('store writes only for changed keys (botfarm-13); fleet-return wakes debounced >= 10 s, identical plans reused for 60 s (botfarm-14)', async () => {
  const { sb, L, M, clock, writes } = farmSandbox();
  await L.load(true);
  await L.save();
  assert.deepEqual(writes, [], 'nothing changed since the load: no write');
  M.targets['2:1:1:1'] = { key: '2:1:1:1', state: 'new' };
  await L.save();
  assert.deepEqual(writes, ['targets']);
  await L.save('targets', 'attacks');
  assert.deepEqual(writes, ['targets'], 'the same content is not written again');
  // wakes
  M.busy = 0; M.lastRunEnd = 1000;
  assert.equal(L.wakeAt(5000), 11000); assert.equal(L.wakeAt(20000), 20000);
  M.busy = 1; assert.equal(L.wakeAt(20000), 30000, 'a wake during a run: 10 s from now'); M.busy = 0;
  const src = fs.readFileSync(path.join(ROOT, 'ogamex-bot/modules/botfarm/botfarm.js'), 'utf8');
  assert.ok(/id: NAME, module: NAME, prio: 'fleet', startJitter: \[40000, 140000\], wakeOn: \['bot:threat'\]/.test(src), 'fleet-returned is not a direct wake of the main worker');
  // plan cache: the second call with the same report / returns / settings does not simulate
  let calls = 0;
  sb.OGX.bot.intel = { get: () => null };
  const w = Object.assign(wctxAt(clock), { cfg: () => undefined });
  const Tg = { key: '2:9:9:1', coords: '2:9:9', state: 'reported' };
  const origSim = sb.OGX.bot.intel.get;
  sb.OGX.bot.intel.get = (k) => { calls++; return origSim(k); };
  const p1 = await L.planCached(w, {}, Tg, [{ id: 1 }]);
  clock.now += 5000;
  const p2 = await L.planCached(w, {}, Tg, [{ id: 1 }]);
  assert.equal(p1, p2, 'the cached result');
  assert.ok(w.journal.some((e) => e.ev === 'sim' && e.data.cached === true));
  clock.now += 5000; M.returnedAt = { 1: clock.now };
  const p3 = await L.planCached(w, {}, Tg, [{ id: 1 }]);
  assert.notEqual(p3, p1, 'a fleet came home: simulated again');
  clock.now += 61000; M.returnedAt = { 1: clock.now - 61000 };
  assert.notEqual(await L.planCached(w, {}, Tg, [{ id: 1 }]), p3, 'older than 60 s: simulated again');
  assert.ok(calls >= 3);
});

T.test('Infinity «Цели» marks (addons-9): avoid colour = never spied / attacked, prefer colour or «цель» = first; no OGX.targets -> nothing changes', async () => {
  const { sb, L, M, clock } = farmSandbox();
  const cfg = {};
  const w = Object.assign(wctxAt(clock), { cfg: (k) => cfg[k] });
  M.targets = { '2:5:1:1': { key: '2:5:1:1', coords: '2:5:1', target: { type: 1 }, playerId: 7 }, '2:5:2:1': { key: '2:5:2:1', coords: '2:5:2', target: { type: 1 }, playerId: 8 },
    '2:5:3:1': { key: '2:5:3:1', coords: '2:5:3', target: { type: 1 }, playerId: 9 }, '2:5:4:1': { key: '2:5:4:1', coords: '2:5:4', target: { type: 1 }, playerId: 10 } };
  let s = await L.markSets(w);
  assert.equal(s.avoid.size + s.prefer.size, 0);
  sb.OGX.targets = { marks: async () => ({ v: 1, planets: { '2:5:1:1': { color: 'red' }, '2:5:2:1': { color: 'green' }, '2:5:3:1': { isTarget: true } }, players: { 10: { color: 'red' } } }) };
  s = await L.markSets(w);
  assert.deepEqual([...s.avoid].sort(), ['2:5:1:1', '2:5:4:1'], 'planet and player marks');
  assert.deepEqual([...s.prefer].sort(), ['2:5:2:1', '2:5:3:1']);
  cfg.markAvoid = ''; cfg.markPrefer = 'red';
  s = await L.markSets(w);
  assert.equal(s.avoid.size, 0); assert.ok(s.prefer.has('2:5:1:1') && s.prefer.has('2:5:3:1'));
  const src = fs.readFileSync(path.join(ROOT, 'ogamex-bot/modules/botfarm/botfarm.js'), 'utf8');
  assert.ok(/if \(marks\.avoid\.has\(T\.key\)\) \{/.test(src), 'candidates drop avoid-marked targets');
});
