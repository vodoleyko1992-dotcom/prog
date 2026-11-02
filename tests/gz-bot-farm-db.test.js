'use strict';
// botfarm 0.3.2 (John 2026-11-01: «вести базу целей, сканировать мою галактику, фармить с учётом затрат, защиты и окупаемости»):
//   (a) optimizeRaid: old rule unchanged without the new options; mixed fleet of OWN ships (all combat types scaled together,
//       Battle Transporters 217 as extra hull) wins where a single type needs a build — the live case [2:56:7] of 2026-11-01;
//       a draw keeps the fleet: minWin / maxDefeat
//   (b) target database: reports, raids, totals, net, attacks per 24 h, CSV
//   (c) regrowth: a poor target is re-spied when its stock passes minLoot again (production x22000 capped by storage), never = null
//   (d) discovery: scanScope 'galaxy' walks every system of the own galaxies (one storage read per galaxy), radius stays possible;
//       a database planet missing from a newer galaxy view becomes 'gone'
//   node tests/gz-bot-farm-db.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib');
const S = require('../ogamex-bot/modules/botsim/botsim.js');
const { assert } = T;

const ROOT = path.resolve(__dirname, '..');
const FILES = ['shared/core/00-ogx.js', 'shared/core/01-util.js', 'shared/core/08-catalog-data.js', 'shared/core/09-catalog.js', 'shared/core/10-calc.js',
  'ogamex-bot/modules/botsim/botsim.js', 'ogamex-bot/modules/botfarm/botfarm.js'];
function sandbox() {
  const sb = { console, setTimeout, clearTimeout, setInterval, clearInterval };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  return sb;
}
const J = (v) => JSON.parse(JSON.stringify(v));

// [2:56:7] spy report of 2026-11-01 21:41 (live log) and John's hangar on one planet (fleetTable 2026-11-01)
const DEF567 = { units: { 403: 2776, 404: 11017, 405: 1, 406: 465, 408: 1, 409: 1 }, tech: { weapons: 29, shielding: 30, armour: 30 } };
const PLANET567 = { metal: 1771747435716, crystal: 929778436966, deuterium: 348003105853 };
const BONUS = { attack: 190, defense: 170, shield: 150 };
const AVAIL = { 215: 38288, 217: 101302 };

T.test('(a) optimizeRaid: no new options = old rule; John\'s [2:56:7] needs a build with one type, the mixed own fleet wins without one', async () => {
  const base = { defender: DEF567, planet: PLANET567, available: AVAIL, attackerTech: { bonusPct: BONUS }, storageFactor: 0, cargoIds: [217], winMin: 0.99, maxLossShare: 0.25, runs: 60, surplusPct: 10, seed: 'x' };
  const old = S.optimizeRaid(base);
  assert.equal(old.ok, false, 'one type of own ships is not enough at win >= 99 % (live: «построить 215×46496»)');
  assert.equal(old.mixed, undefined);
  // with a build allowance the old answer stays a build (the live log)
  const build = S.optimizeRaid(Object.assign({}, base, { maxShips: { 215: 200000 } }));
  assert.equal(build.ok, true);
  assert.ok(build.missing[215] > 0, 'old rule: build battlecruisers');
  // mixed + draw allowed: own ships only, no build, big loot, tiny losses
  const mix = S.optimizeRaid(Object.assign({}, base, { mixed: true, minWin: 0.8, maxDefeat: 0.01 }));
  assert.equal(mix.ok, true, mix.why);
  assert.deepEqual(J(mix.missing), {}, 'nothing to build');
  for (const [id, n] of Object.entries(mix.ships)) assert.ok(n <= (AVAIL[id] || 0), id + ' within the hangar');
  assert.ok(mix.ships[217] > 0 && mix.ships[215] > 0, 'battlecruisers + Battle Transporters');
  assert.ok(mix.sim.win >= 0.8 && mix.sim.loss <= 0.01, 'win share ' + mix.sim.win + ', defeat ' + mix.sim.loss);
  assert.ok(mix.sim.loot.mean.msu > 1.5e12, 'loot ≈ 2 trillion MSU: ' + mix.sim.loot.mean.msu);
  assert.ok(mix.sim.attackerLoss.mean.msu < 0.001 * mix.sim.loot.mean.msu, 'losses negligible');
  assert.match(mix.why, /смешанный/);
  // minWin defaults to winMin: the same call without minWin is the old strict rule (mixed alone does not pass 99 % here)
  const strict = S.optimizeRaid(Object.assign({}, base, { mixed: true }));
  assert.ok(!strict.ok || strict.sim.win >= 0.99, 'without minWin the win share must be >= winMin');
  // undefended: unchanged cargo-only path
  const empty = S.optimizeRaid(Object.assign({}, base, { defender: { units: {} }, mixed: true, minWin: 0.8, maxDefeat: 0.01 }));
  assert.equal(empty.ok, true); assert.deepEqual(Object.keys(empty.ships), ['217']);
  // botfarm-5: a hangar of Battle Transporters only (John's secondary planets) raids a defended target with them — on Aeternum
  // 217 is a warship (attack 50, shield 120): the smallest winning count, the rest stays home; a hopeless hangar is still refused
  const bt = { defender: { units: { 401: 200, 402: 50 }, tech: { weapons: 10, shielding: 10, armour: 10 } }, planet: { metal: 1e9, crystal: 6e8, deuterium: 4e8 },
    attackerTech: { bonusPct: BONUS }, storageFactor: 0, cargoIds: [217], winMin: 0.99, minWin: 0.8, maxDefeat: 0.01, mixed: true, maxLossShare: 0.25, runs: 60, surplusPct: 10, seed: 'bt' };
  const only217 = S.optimizeRaid(Object.assign({}, bt, { available: { 217: 6000 } }));
  assert.equal(only217.ok, true, only217.why);
  assert.deepEqual(Object.keys(only217.ships), ['217'], JSON.stringify(only217.ships));
  assert.ok(only217.ships[217] > 0 && only217.ships[217] < 6000, 'minimal winning count, not the whole hangar: ' + only217.ships[217]);
  assert.ok(only217.sim.win >= 0.8 && only217.sim.loss <= 0.01, 'win ' + only217.sim.win + ', defeat ' + only217.sim.loss);
  assert.equal(only217.mixed, null, 'no mixed variant for a cargo-only hangar');
  assert.equal(S.optimizeRaid(Object.assign({}, bt, { available: { 217: 10 } })).ok, false, 'ten transporters cannot win');
  const withBc = S.optimizeRaid(Object.assign({}, bt, { available: { 215: 13644, 217: 6000 } }));
  assert.ok(withBc.ok && withBc.ships[215] > 0, 'with battlecruisers at hand they fight as before: ' + JSON.stringify(withBc.ships));
  // the planner passes 217 as a combat id only for such a hangar (source rule)
  const src = require('fs').readFileSync(path.join(ROOT, 'ogamex-bot/modules/botfarm/botfarm.js'), 'utf8');
  assert.ok(/COMBAT_IDS\.some\(\(id\) => available\[id\] > 0\) \? COMBAT_IDS : COMBAT_IDS\.concat\(\[TRANSPORT\]\)/.test(src), 'planAttack: 217 joins the combat ids when no warship is at hand');
});

T.test('(b) target database: reports, raids, totals, net, attacks per 24 h, CSV', async () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const T0 = { key: '2:56:7:1', coords: '2:56:7', playerName: 'Inact', status: 'I', rank: 300, state: 'reported' };
  const intel = { ts: 1000, res: { metal: 3e9, crystal: 2e9, deuterium: 1e9 }, ships: {}, defense: { 401: 10 }, buildings: { 1: 30, 2: 28, 3: 25, 4: 30, 22: 15, 23: 15, 24: 15 }, research: {},
    known: { ships: true, defense: true, buildings: true, research: true }, probesSent: 1100, probesLost: true };
  const row = L.dbReport(T0, intel, {});
  assert.equal(row.resMsu, Math.round(3e9 + 2e9 * 1.5 + 1e9 * 3));
  assert.equal(row.defMsu, Math.round(L.unitsMsu({ 401: 10 })));
  assert.ok(row.defMsu > 0 && row.fleetMsu === 0 && row.prodMsuH > 0);
  assert.equal(T0.db.totals.probesLostMsu, 1100 * 1000 * 1.5, 'lost probes are a cost (1000 crystal each)');
  for (let i = 0; i < 12; i++) L.dbReport(T0, Object.assign({}, intel, { ts: 2000 + i, probesLost: false }), {});
  assert.equal(T0.db.reports.length, 10, 'last 10 reports kept');
  // raid sent -> result
  const P = { fuel: 1000000, net: 0, sim: { attackerLoss: { mean: { msu: 5e6 } } }, lootExp: 4e9 };
  const A = { id: 'farm:1', sentAt: 10_000, arrival: 20_000, originCoords: '2:68:5', ships: { 217: 100 } };
  L.dbRaidSent(T0, A, P);
  assert.equal(T0.db.totals.raids, 1);
  assert.equal(T0.db.totals.fuelMsu, 3000000, 'fuel in MSU (deuterium x3)');
  assert.equal(L.dbNet(T0), -3000000 - 1650000, 'flying raid: no loot yet, costs counted');
  L.dbRaidResult(T0, A, { lootMsu: 4.1e9, lossMsu: 4e6, result: 'won' });
  L.dbRaidResult(T0, A, { lootMsu: 9e9, lossMsu: 0, result: 'won' });
  assert.equal(T0.db.totals.lootMsu, 4.1e9, 'one result per raid');
  assert.equal(L.dbNet(T0), 4.1e9 - 3e6 - 4e6 - 1.65e6);
  assert.equal(L.attacks24(T0, 20_000), 1);
  assert.equal(L.attacks24(T0, 10_000 + 25 * 3600000), 0);
  // CSV: header + one row per target, ; separated, BOM for Excel
  sb.OGX.botFarm._M.targets = { [T0.key]: T0 };
  sb.OGX.time = { serverNow: () => 30_000 };
  const csv = L.dbCsv();
  assert.ok(csv.startsWith('﻿coords;player;'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith('2:56:7;Inact;I;300;'));
});

T.test('(c) regrowth: a poor target waits until its stock passes minLoot again; no mines -> never', async () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const now = 1_800_000_000_000;
  const intel = { ts: now, res: { metal: 50000, crystal: 50000, deuterium: 5000 }, buildings: { 1: 20, 2: 18, 3: 15, 4: 25, 22: 12, 23: 12, 24: 12 }, research: {} };
  const minLoot = 1e8;
  const at = L.regrowAt(intel, minLoot, now, {});
  assert.ok(at > now && at < now + 7 * 24 * 3600000, 'regrows within a week');
  const loot = (t) => { const e = L.expectedAt(intel, t); return (e.metal + e.crystal * 1.5 + e.deuterium * 3) / 2; };
  assert.ok(loot(at) >= minLoot && loot(at - 120000) < minLoot, 'first minute with loot >= minLoot');
  // the live «empty» targets of 2026-11-01: 50k/50k/5k and no buildings -> null (one check per week, not every 3 h)
  assert.equal(L.regrowAt({ ts: now, res: { metal: 50000, crystal: 50000, deuterium: 5000 }, buildings: {}, research: {} }, 1e7, now, {}), null);
  assert.equal(L.regrowAt({ ts: now, res: { metal: 3e7, crystal: 0, deuterium: 0 }, buildings: {} }, 1e7, now, {}), now, 'already enough');
  // poorTarget: cooldown to the regrowth time, verdict in the database
  const recs = [];
  const T1 = { key: '1:1:1:1', coords: '1:1:1', state: 'reported' };
  const wctx = { now: () => now, cfg: (k) => ({ minLoot, regrowRespy: true })[k], rec: (k, w, d) => recs.push({ k, w, d }) };
  sb.OGX.fmt = { short: (n) => String(Math.round(n)), time: (t) => String(t) };
  L.poorTarget(wctx, { server: {} }, T1, { intel, rejects: [{ loot: true, lootMsu: 77500 }] });
  assert.equal(T1.state, 'poor');
  assert.equal(T1.cooldownUntil, Math.max(now + 30 * 60000, at));
  assert.equal(T1.db.verdict.kind, 'poor');
  const T2 = { key: '1:1:2:1', coords: '1:1:2', state: 'reported' };
  L.poorTarget(wctx, { server: {} }, T2, { intel: { ts: now, res: { metal: 50000, crystal: 50000, deuterium: 5000 }, buildings: {} }, rejects: [{ loot: true, lootMsu: 77500 }] });
  assert.equal(T2.cooldownUntil, now + 7 * 24 * 3600000, 'no production: one week');
});

T.test('(d) discovery: the whole own galaxy (one storage read), radius mode, gone planets', async () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const M = sb.OGX.botFarm._M;
  M.targets = {};
  const now = 1_800_000_000_000;
  const row = (pos, name, status, extra) => Object.assign({ position: pos, playerName: name, playerId: 100 + pos, status, rank: 400, own: false }, extra || {});
  // galaxy 2: inactives far away (2:300:4) and near (2:70:9), an active one, a vacation inactive; galaxy 3 has no own planet
  const g2 = { 300: { t: now - 1000, positions: [row(4, 'Far', 'I')] }, 70: { t: now - 1000, positions: [row(9, 'Near', 'i'), row(10, 'Active', ''), row(11, 'Vac', 'vi')] } };
  let reads = 0;
  sb.OGX.storage = { get: async (k) => { reads++; return k === 'galaxy.g2' ? g2 : null; } };
  sb.OGX.galaxy = { _expand: (g, s, c) => ({ galaxy: g, system: s, t: c.t, positions: c.positions }), cached: async () => { throw new Error('must not be called per system'); } };
  const recs = [];
  const cfg = { scanScope: 'galaxy', scanRadius: 15, includeShortInactive: true, minRank: 0, exclude: [], scanGalaxy: false };
  const wctx = { now: () => now, cfg: (k) => cfg[k], core: () => 0, rec: (k, w, d) => recs.push({ k, w, d }) };
  sb.OGX.fmt = { short: (n) => String(n), time: (t) => String(t) };
  const found = await L.discover(wctx, {}, [{ id: 1, coords: '2:68:5' }]);
  assert.deepEqual([...found].sort(), ['2:300:4:1', '2:70:9:1']);
  assert.equal(reads, 1, 'galaxy key read once for 499 systems');
  assert.equal(M.targets['2:300:4:1'].state, 'new');
  // radius mode: only ±15 systems
  M.targets = {}; reads = 0; cfg.scanScope = 'radius';
  const near = await L.discover(wctx, {}, [{ id: 1, coords: '2:68:5' }]);
  assert.deepEqual([...near], ['2:70:9:1']);
  // a newer galaxy view without the planet: gone; it comes back only with a newer view that shows it
  g2[70] = { t: now + 5000, positions: [row(10, 'Active', '')] };
  await L.discover(wctx, {}, [{ id: 1, coords: '2:68:5' }]);
  assert.equal(M.targets['2:70:9:1'].state, 'gone');
  assert.equal(M.targets['2:70:9:1'].db.verdict.kind, 'gone');
  await L.discover(wctx, {}, [{ id: 1, coords: '2:68:5' }]);
  assert.equal(M.targets['2:70:9:1'].state, 'gone', 'same view: stays gone');
  g2[70] = { t: now + 10 * 3600000, positions: [row(9, 'Near', 'I')] };
  M.targets['2:70:9:1'].stateAt = now;
  await L.discover(wctx, {}, [{ id: 1, coords: '2:68:5' }]);
  assert.equal(M.targets['2:70:9:1'].state, 'new', 'back in a newer view');
});

T.test('(e) scan feeds discovery (botfarm-1): a bot read.galaxy creates the targets in the same run and enters the galaxy cache; stale scan marks are redone', async () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const M = sb.OGX.botFarm._M;
  M.targets = {}; M.scanAt = {}; M.ctx = { store: { get: async (k, d) => d, set: async () => {} } };
  const now = 1_800_000_000_000;
  const row = (pos, name, status) => ({ position: pos, playerName: name, playerId: 100 + pos, status, rank: 400, own: false });
  const g2 = {};   // nothing cached: every system of the radius is unknown
  const remembered = [];
  sb.OGX.storage = { get: async (k) => (k === 'galaxy.g2' ? g2 : null) };
  sb.OGX.galaxy = { _expand: (g, s, c) => ({ galaxy: g, system: s, t: c.t, positions: c.positions }), cached: async () => { throw new Error('per-system cached() must not be used'); },
    rememberSystem: async (sys) => { remembered.push(sys.system); g2[sys.system] = { t: sys.t, positions: sys.positions }; } };
  sb.OGX.bot = { status: () => ({ limits: { galaxyViews: { used: 0, max: 300 } } }) };
  sb.OGX.fmt = { short: (n) => String(n), time: (t) => String(t) };
  const recs = []; const reads = [];
  const cfg = { scanScope: 'radius', scanRadius: 1, scanPerCycle: 40, scanEveryH: 24, includeShortInactive: true, minRank: 0, exclude: [], scanGalaxy: true };
  const wctx = {
    now: () => now, cfg: (k) => cfg[k], core: (k) => (k === 'galaxyViewsPerHour' ? 300 : 0), rec: (k, w, d) => recs.push({ k, w, d }), decide: (w, d) => recs.push({ k: 'decision', w, d }),
    act: async (spec) => {
      reads.push(spec.params.galaxy + ':' + spec.params.system);
      if (spec.params.system === 69) return { ok: false, refused: 'limit', message: 'лимит' };
      const positions = spec.params.system === 67 ? [row(7, 'Scanned', 'I')] : [];
      return { ok: true, at: now, data: { system: { galaxy: 2, system: spec.params.system, t: now, positions } } };
    },
  };
  // a mark from the build that never stored its reads (no cached row for 2:69): it must not hide the system for 24 h
  M.scanAt['2:69'] = now - 1000;
  const found = await L.discover(wctx, {}, [{ id: 1, coords: '2:68:5' }]);
  assert.deepEqual(reads, ['2:68', '2:67', '2:69'], 'nearest first, the stale mark of 2:69 ignored, stop at the refused read');
  assert.deepEqual([...found], ['2:67:7:1'], 'the target of the scanned system exists in the same run');
  assert.equal(M.targets['2:67:7:1'].state, 'new');
  assert.deepEqual(remembered, [68, 67], 'every ok read entered the galaxy cache');
  assert.ok(M.scanAt['2:68'] === now && M.scanAt['2:67'] === now, 'scan marks for the ok reads');
  assert.equal(M.scanAt['2:69'], undefined, 'no mark for the refused read (and the stale one is gone)');
  assert.ok(recs.some((r) => r.k === 'target' && r.d.key === '2:67:7:1'), 'journal: new target');
  // the next batch (5 min later: scan pacing, botfarm-11): the cache holds the rows, nothing is read again within scanEveryH
  reads.length = 0; M.scanBatchAt = 0;
  await L.discover(wctx, {}, [{ id: 1, coords: '2:68:5' }]);
  assert.deepEqual(reads, ['2:69'], 'only the never-read system is tried again');
});


T.test('(f) loot gate before the ships check (botfarm-3 / rules-8 / journal-4): a poor target reads no fleetTable and never becomes «shortage»; shortage relief only by a ship fleet back on a lacking origin', async () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const M = sb.OGX.botFarm._M;
  const now = 1_800_000_000_000;
  const intelPoor = { ts: now - 60000, res: { metal: 50000, crystal: 50000, deuterium: 5000 }, ships: {}, defense: {}, buildings: {}, research: {}, known: { ships: true, defense: true, buildings: false, research: false } };
  const intelRich = Object.assign({}, intelPoor, { res: { metal: 3e9, crystal: 2e9, deuterium: 1e9 } });
  let intel = intelPoor;
  sb.OGX.bot = { intel: { get: () => intel }, isActive: () => false, cfg: () => undefined };
  sb.OGX.fleet = { gz: { dataFor: () => ({}), distance: (a, b) => Math.abs(+a.split(':')[1] - +b.split(':')[1]) * 95 + 2700, duration: () => 60, consumption: () => 10, durationRaw: () => 60 } };
  sb.OGX.fmt = { short: (n) => String(Math.round(n)), time: (t) => String(t) };
  sb.OGX.time = { serverNow: () => now };
  const acts = []; const recs = [];
  const A = { id: 1, key: 'p1', coords: '2:68:5', type: 'planet', ships: {}, shipsT: now, levels: {} };            // no ships at all
  const B = { id: 2, key: 'p2', coords: '2:70:5', type: 'planet', ships: { 217: 100 }, shipsT: now, levels: {} };  // Battle Transporters
  const C = { id: 3, key: 'p3', coords: '2:72:5', type: 'planet', ships: { 217: 100 }, shipsT: now, levels: {} };  // under a threat lock
  const env = { research: { 106: 12, 109: 10, 110: 10, 111: 10 }, server: {}, stats: {}, factors: null, bonus: null, bodies: { p1: A, p2: B, p3: C }, fleetSpeed: 7, storageFactor: 0 };
  const cfg = { minLoot: 1e7, winMin: 0.99, minWin: 0.8, mixedFleet: true, maxLossShare: 0.25, simRuns: 60, surplusPct: 10, maxFlightSec: 7200, maxFuelShare: 0.1, buildShips: false, partialLoot: true, minLootShare: 0.5 };
  const wctx = { now: () => now, cfg: (k) => cfg[k], core: () => undefined, locked: (bk) => bk === 'p3', rec: (k, w, d) => recs.push({ k, w, d }), decide: (w, d) => recs.push({ k: 'decision', w, d }),
    act: async (spec) => { acts.push(spec); return { ok: true, at: now, data: { fleetTable: { ships: [] } } }; }, available: () => ({ metal: 1e12, crystal: 1e12, deuterium: 1e12 }) };
  const T1 = { key: '2:69:7:1', coords: '2:69:7', target: { galaxy: 2, system: 69, position: 7, type: 1 }, state: 'reported' };
  // buildShips off, an origin without ships, a poor target: loot verdict only (the 0.3.1 K2 loop started with «нет кораблей» here)
  const poor = await L.planAttack(wctx, env, T1, [A, B, C]);
  assert.equal(poor.skip, 'noPlan');
  assert.ok(poor.rejects.length && poor.rejects.every((x) => x.loot), JSON.stringify(poor.rejects));
  assert.deepEqual(acts, [], 'no fleetTable read for a poor target');
  // the rich target: planned from B; A lacks ships (shortage reject), C is locked
  intel = intelRich;
  const rich = await L.planAttack(wctx, env, T1, [A, B, C]);
  assert.ok(rich.plan, JSON.stringify(rich.rejects));
  assert.equal(rich.plan.origin.id, 2);
  assert.ok(rich.rejects.some((x) => x.origin === 1 && x.shortage && /нет кораблей/.test(x.why)), JSON.stringify(rich.rejects));
  assert.ok(rich.rejects.some((x) => x.origin === 3 && x.shortage && /угроз/.test(x.why)));
  // shortage relief: only a fleet WITH ships back on a lacking origin after the pause began, at most once per 10 min
  const T2 = { key: '2:69:8:1', coords: '2:69:8', state: 'notSuitable', shortage: true, shortageOrigins: [1], stateAt: now, cooldownUntil: now + 20 * 60000 };
  M.returnedShips = {}; M.returnedAt = {};
  L.markReturned(2, now + 1000, 1);              // an attack back on another body
  L.markReturned(1, now + 2000, 15);             // an expedition back on the lacking origin
  L.markReturned(1, now + 3000, 6);              // probes back
  assert.equal(L.shortageRelief(T2, [A, B], now + 4000), null, 'probe / expedition returns and other bodies do not re-plan');
  assert.ok(M.returnedAt[1] === now + 3000, 'but the cached ship counts of that body are stale anyway');
  L.markReturned(1, now + 5000, 1);
  assert.equal(L.shortageRelief(T2, [A, B], now + 6000), 1, 'an attack fleet back on the lacking origin does');
  T2.shortageResetAt = now + 6000; T2.stateAt = now + 6000;
  L.markReturned(1, now + 7000, 3);
  assert.equal(L.shortageRelief(T2, [A, B], now + 8000), null, 'at most once per 10 min');
  assert.equal(L.shortageRelief(T2, [A, B], now + 11 * 60000), 1);
  // the main loop uses the helper, not «any return of any body» (source rule)
  const src = require('fs').readFileSync(path.join(ROOT, 'ogamex-bot/modules/botfarm/botfarm.js'), 'utf8');
  assert.ok(/else if \(shortageRelief\(T, originList\(wctx, env\), now\)\)/.test(src));
  assert.ok(!/M\.lastReturnAt \|\| 0\) > \(\+T\.stateAt/.test(src), 'no reset on any return of any body');
});

T.test('(g) inactivity re-check (botfarm-6, missed [botfarm] 2): a newer galaxy row of an active player pauses the target 24 h, a new owner resets it; before a raid a row older than 1 h is read again, no row -> no raid', async () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const M = sb.OGX.botFarm._M;
  M.targets = {}; M.scanAt = {}; M.ctx = { store: { get: async (k, d) => d, set: async () => {} } };
  let now = 1_800_000_000_000;
  const H = 3600000;
  const row = (pos, name, status, id) => ({ position: pos, playerName: name, playerId: id, status, rank: 400, own: false });
  const g2 = {};
  sb.OGX.storage = { get: async (k) => (k === 'galaxy.g2' ? g2 : null) };
  const remembered = [];
  sb.OGX.galaxy = { _expand: (g, s, c) => ({ galaxy: g, system: s, t: c.t, positions: c.positions }), cached: async () => null,
    rememberSystem: async (sys) => { remembered.push(sys.system); g2[sys.system] = { t: sys.t, positions: sys.positions }; } };
  let left = 10;
  sb.OGX.bot = { status: () => ({ limits: { galaxyViews: { used: 0, max: 300 } } }), limits: { remaining: () => left } };
  sb.OGX.fmt = { short: (n) => String(n), time: (t) => String(t) };
  const recs = []; const reads = [];
  let world = { 68: [row(7, 'Sleepy', 'I', 107), row(8, 'Dozy', 'i', 108)] };
  const cfg = { scanScope: 'radius', scanRadius: 0, scanPerCycle: 40, scanEveryH: 24, includeShortInactive: true, minRank: 0, exclude: [], scanGalaxy: false };
  const wctx = {
    now: () => now, cfg: (k) => cfg[k], core: (k) => (k === 'galaxyViewsPerHour' ? 300 : 0), rec: (k, w, d) => recs.push({ k, w, d }), decide: (w, d) => recs.push({ k: 'decision', w, d }),
    act: async (spec) => { reads.push(spec.type + ' ' + spec.params.galaxy + ':' + spec.params.system); return { ok: true, at: now, data: { system: { galaxy: 2, system: spec.params.system, t: now, positions: world[spec.params.system] || [] } } }; },
  };
  g2[68] = { t: now - 1000, positions: world[68] };
  await L.discover(wctx, {}, [{ id: 1, coords: '2:68:5' }]);
  const A = M.targets['2:68:7:1']; const B = M.targets['2:68:8:1'];
  assert.ok(A && B && A.state === 'new' && B.state === 'new');
  // 1. discover: a newer cached row shows Sleepy active, position 8 now belongs to another (inactive) player
  now += 2 * H;
  g2[68] = { t: now - 1000, positions: [row(7, 'Sleepy', '', 107), row(8, 'Newbie', 'I', 555)] };
  A.lastReportAt = now - 3 * H; A.theirSpy = 9; A.theirSpyKnown = true;
  B.theirSpy = 9; B.theirSpyKnown = true;
  await L.discover(wctx, {}, [{ id: 1, coords: '2:68:5' }]);
  assert.equal(A.state, 'active'); assert.equal(A.cooldownUntil, now + 24 * H, 'active player: 24 h');
  assert.equal(A.db.verdict.kind, 'active');
  assert.equal(B.state, 'new'); assert.equal(B.playerName, 'Newbie'); assert.equal(B.playerId, 555);
  assert.equal(B.ownerAt, now - 1000, 'intel older than the owner change does not count'); assert.equal(B.theirSpyKnown, false);
  // 2. verifyInactive: row < 1 h old -> no read
  reads.length = 0;
  assert.equal((await L.verifyInactive(wctx, B)).ok, true); assert.deepEqual(reads, []);
  // row older than 1 h, nothing newer cached -> one read.galaxy, still inactive -> ok, cache fed
  now += 2 * H;
  world = { 68: [row(7, 'Sleepy', '', 107), row(8, 'Newbie', 'I', 555)] };
  assert.equal((await L.verifyInactive(wctx, B)).ok, true);
  assert.deepEqual(reads, ['read.galaxy 2:68']); assert.equal(B.galaxyT, now); assert.ok(remembered.includes(68));
  // the player logged in since: the read shows him active -> no raid, 24 h pause, journal
  now += 2 * H; reads.length = 0;
  world = { 68: [row(7, 'Sleepy', '', 107), row(8, 'Newbie', '', 555)] };
  const v = await L.verifyInactive(wctx, B);
  assert.equal(v.ok, false); assert.equal(v.verdict.kind, 'active');
  assert.equal(B.state, 'active'); assert.equal(B.cooldownUntil, now + 24 * H);
  assert.ok(recs.some((r) => r.k === 'verify' && r.d.key === '2:68:8:1' && r.d.kind === 'active'));
  // no galaxy views left: no raid on an unverified row (20-min pause), no read
  const C = { key: '2:69:9:1', coords: '2:69:9', target: { galaxy: 2, system: 69, position: 9, type: 1 }, playerId: 109, playerName: 'Old', status: 'I', galaxyT: now - 3 * H, state: 'reported' };
  left = 0; reads.length = 0;
  assert.equal((await L.verifyInactive(wctx, C)).ok, false); assert.deepEqual(reads, []);
  assert.equal(C.state, 'notSuitable'); assert.equal(C.cooldownUntil, now + 20 * 60000);
  assert.ok(recs.some((r) => r.k === 'skip' && r.d.reason === 'galaxyStale' && r.d.key === '2:69:9:1'));
  // a fresh cached row (another module's view) needs no read: position 9 of 2:68 is empty there -> gone
  left = 10; reads.length = 0;
  const D = { key: '2:68:9:1', coords: '2:68:9', target: { galaxy: 2, system: 68, position: 9, type: 1 }, playerId: 109, playerName: 'Old', status: 'I', galaxyT: now - 3 * H, state: 'reported', db: null };
  assert.equal((await L.verifyInactive(wctx, D)).verdict.kind, 'gone'); assert.deepEqual(reads, [], 'the cache row (read 0 min ago) is used');
  assert.equal(D.state, 'gone');
  // pure verdicts
  const T0 = { playerId: 1, playerName: 'X' };
  assert.equal(L.rowVerdict(T0, row(1, 'X', 'iI', 1)), null);
  assert.equal(L.rowVerdict(T0, row(1, 'X', 'vI', 1)).kind, 'vacation');
  assert.equal(L.rowVerdict(T0, row(1, 'Y', 'I', 2)).kind, 'owner');
  assert.equal(L.rowVerdict(T0, null).kind, 'gone');
  assert.equal(L.rowVerdict(T0, row(1, 'X', 'i', 1), { includeShort: false }).kind, 'active', 'i excluded by the setting: not a target');
  // source rules: attack() verifies before the send; candidates skip intel older than an owner change
  const src = require('fs').readFileSync(path.join(ROOT, 'ogamex-bot/modules/botfarm/botfarm.js'), 'utf8');
  assert.ok(/const ver = await verifyInactive\(wctx, T\);\s*\n\s*if \(!ver\.ok\)/.test(src));
  assert.ok(/!\(T\.ownerAt && intel\.ts < T\.ownerAt\)/.test(src));
});
