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


