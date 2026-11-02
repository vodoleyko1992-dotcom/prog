'use strict';
// botfarm: module unit checks (node sandbox, the file as the extension loads it) + the safety gates in the WORLD mock.
//   unit: report reads behind the 2Moons AJAX gate (page load first, schedule, paging, noReport, rescue), escort timing / reads
//   unit: settings schema = BOT_CONTRACT C5 botfarm (keys, defaults, all off), target filter, probe count (MissionCaseSpy via
//         botSim.spyNeeded), expected resources (calc.production capped by storage, 2Moons ExecCalc), intel from a spy report,
//         defender side (unknown research -> ours + 2), undefended test, requirements
//   (f) limits: botcore.maxFleetSendsPerHour refuses the attack ('limit', journaled, no crash); then maxSlots 1 -> one farm attack
//   (g) slot reserve, sleep window, threat lock on the origin -> nothing sent; each refusal journaled
//   node tests/gz-bot-mod-botfarm.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib');
const B = require('./gz-bot-lib');
const S = require('../ogamex-bot/modules/botsim/botsim.js');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

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

T.test('unit: module registration and settings = contract C5 (everything on by default since 0.3.2)', async () => {
  const sb = sandbox();
  const def = sb.OGX.modules.botfarm;
  assert.equal(def.title, 'Бот: фарм неактивных');
  const want = { on: true, origins: [], scanGalaxy: true, scanScope: 'galaxy', scanRadius: 15, scanPerCycle: 40, scanEveryH: 24, includeShortInactive: true, minRank: 0, minLoot: 10000000,
    maxFlightSec: 7200, maxFuelShare: 0.1, maxReportAgeMin: 30, escort: true, escortLeadSec: 90, recallOnChange: true, winMin: 0.99, minWin: 0.8, mixedFleet: true, maxLossShare: 0.25,
    simRuns: 60, surplusPct: 10, partialLoot: true, minLootShare: 0.5, maxSlots: 0, buildShips: true, buildMaxWaitMin: 30, regrowRespy: true, needFleetPauseH: 6, dbKeepDays: 14,
    maxProbeRetries: 2, probeReserve: 0, probeBuild: true, probeBuildPerHour: 50000, useFleetAjax: true, deleteReports: true, attacksPerDay: 6, targetsPerCycle: 10, exclude: [], markAvoid: 'red', markPrefer: 'green' };
  assert.deepEqual(Object.keys(def.settings).sort(), Object.keys(want).sort());
  for (const [k, v] of Object.entries(want)) assert.deepEqual(J(def.settings[k].default), v, k);
  for (const [k, s] of Object.entries(def.settings)) assert.ok(/[а-яё]/i.test(s.label), k + ': Russian label');
});

T.test('unit: ship rules (BOT_CONTRACT C10): loot only in 217 with the core cargo (officer / measured), recyclers 219, shortage count', async () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  assert.equal(L.TRANSPORT, 217); assert.equal(L.RECYCLER, 219);
  // storage factor for the simulator = the core's cargo of one 217 over the catalog 40 M (measured factor / Storage expert)
  assert.equal(L.storageFactorOf({ 217: { cargo: 60000000 } }, { ShipStorage: 0 }), 0.5, 'measured 1.5 wins over the officer sum');
  assert.equal(L.storageFactorOf({}, { ShipStorage: 1 }), 1, 'no shipStats: officer 607 level 2');
  assert.equal(L.transportCap({ stats: { 217: { cargo: 60000000 } }, storageFactor: 0.5 }), 60000000);
  assert.equal(L.transportCap({ stats: {}, storageFactor: 0.5 }), 60000000, 'catalog 40 M x 1.5 (John\'s rule: 40 M, not the upstream 400 M)');
  // shortage in Battle Transporters for the whole loot (minCapacityForLoot of the expected stock)
  const planet = { metal: 100000000, crystal: 60000000, deuterium: 20000000 };
  const need = S.minCapacityForLoot(planet);
  const env = { stats: {}, storageFactor: 0 };
  assert.equal(L.transportShort({}, planet, env), Math.ceil(need / 40000000), 'nothing at hand: every 217 missing');
  assert.equal(L.transportShort({ 217: Math.ceil(need / 40000000) }, planet, env), 0, 'enough 217');
  assert.equal(L.transportShort({ 217: 1 }, planet, env), Math.ceil((need - 40000000) / 40000000));
  // only the 217 hold counts: 202/203 or the escort's hold are never a substitute carrier (review fix)
  assert.equal(L.transportShort({ 202: 100000, 203: 100000, 207: 1000 }, planet, env), Math.ceil(need / 40000000), 'other holds do not count');
  // no 202 / 203 / 209 is ever picked by the module code
  const src = fs.readFileSync(path.join(ROOT, 'ogamex-bot/modules/botfarm/botfarm.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.ok(!/\b(202|203|209)\b/.test(src), 'no 202 / 203 / 209 in the code');
});

T.test('unit: target filter, probes, expected stock, intel, sides', async () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  // F8: inactive i / I only; vacation, banned, admin never
  assert.equal(L.inactiveClass('i'), 'i'); assert.equal(L.inactiveClass('I'), 'I'); assert.equal(L.inactiveClass('iI'), 'I');
  for (const s of ['', 'v', 'vi', 'iv', 'vI', 'b', 'ib', 'n', 's', 'A']) assert.equal(L.inactiveClass(s), null, s);
  assert.equal(L.inactiveClass('i', { includeShort: false }), null);
  assert.equal(L.excluded(['2:68:10'], { coords: '2:68:10' }), true);
  assert.equal(L.excluded(['Bob'], { coords: '1:1:1', playerName: 'bob' }), true);
  assert.equal(L.excluded([3900], { coords: '1:1:1', playerId: 3900 }), true);
  assert.equal(L.excluded(['2:68:11', 'x'], { coords: '2:68:10', playerName: 'y' }), false);
  // probes: the suite setting spy.probes (default 1100) is the count; the 2Moons formula (F7: unknown -> ours - 2, +2 per retry;
  // known -> exact) is only the minimum
  const f12 = S.spyNeeded({ ourSpy: 12, theirSpy: 10, want: 'defense' });
  assert.deepEqual(J(L.probesFor({ ourSpy: 12, theirSpyKnown: false, tries: 0, spyProbes: 1100 })), { probes: Math.max(1100, f12), min: Math.max(1, f12), theirSpyEstimate: 10 });
  assert.deepEqual(J(L.probesFor({ ourSpy: 8, theirSpyKnown: false, tries: 2, spyProbes: 1 })), { probes: S.spyNeeded({ ourSpy: 8, theirSpy: 10, want: 'defense' }), min: S.spyNeeded({ ourSpy: 8, theirSpy: 10, want: 'defense' }), theirSpyEstimate: 10 });
  assert.equal(L.probesFor({ ourSpy: 12, theirSpy: 3, theirSpyKnown: true, spyProbes: 1100 }).probes, 1100);
  assert.equal(L.probesFor({ ourSpy: 12, theirSpy: 3, theirSpyKnown: true, spyProbes: 1100 }).min, 1);
  assert.equal(L.probesFor({ ourSpy: 12, theirSpyKnown: false }).probes >= 1100, true, 'default = OGX.api.spyProbes() / 1100');
  assert.equal(L.probesFor({ ourSpy: 7, theirSpy: 9, theirSpyKnown: true, spyProbes: 1 }).probes, S.spyNeeded({ ourSpy: 7, theirSpy: 9, want: 'defense' }));
  // expected stock: production x dt only below storage (ExecCalc), capped at storage
  const C = sb.OGX.calc;
  const intel = { res: { metal: 1000, crystal: 999999999, deuterium: 0 }, ts: 0, buildings: { 1: 20, 2: 18, 3: 15, 4: 25, 22: 5, 23: 5, 24: 5 }, research: {} };
  const ph = L.perHourOf(intel);
  const want = C.production({ levels: intel.buildings, tempMax: 40, research: {} }).perHour;
  assert.ok(Math.abs(ph.metal - want.metal) < 1e-6 && ph.metal > 0, 'calc.production');
  const at = L.expectedAt(intel, 1800000);
  const cap = C.storageCapacity(5);
  assert.equal(at.metal, Math.floor(Math.min(cap, 1000 + ph.metal / 2)));
  assert.equal(at.crystal, 999999999, 'above storage: no growth, no cut');
  assert.equal(L.expectedAt(intel, 1000 * 3600 * 1000).metal, cap, 'capped at storage');
  assert.deepEqual(J(L.expectedAt({ res: { metal: 5, crystal: 6, deuterium: 7 }, ts: 0, buildings: null }, 3600000)), { metal: 5, crystal: 6, deuterium: 7 }, 'no section 0: report stock');
  // intel from an espionageFull result
  const rep = { id: 9, ts: 1000, resources: { metal: 10, crystal: 20, deuterium: 30, energy: 5 }, ships: { 202: 0, 204: 3 }, defense: { 401: 2, 502: 7 },
    buildings: { 1: 5 }, research: { 106: 4, 109: 1 }, known: { ships: true, defense: true, buildings: true, research: false }, probesDestroyed: false, exact: true };
  const it = J(L.intelFrom(rep, '1:2:3:1', { ts: 2000, probesSent: 2 }));
  assert.deepEqual([it.ts, it.res, it.ships, it.defense, it.research, it.probesSent, it.probesLost], [2000, { metal: 10, crystal: 20, deuterium: 30 }, { 204: 3 }, { 401: 2 }, null, 2, false]);
  assert.equal(L.isUndefended(it), false);
  assert.equal(L.isUndefended({ ships: { 210: 0 }, defense: { 502: 3 } }), true, 'missiles never fight');
  assert.equal(L.isUndefended({ ships: { 212: 1 }, defense: {} }), false, 'a satellite is a unit (draw = no loot)');
  // defender: research unknown -> ours + 2; known -> report
  assert.deepEqual(J(L.defenderSide(it, { 109: 10, 110: 9, 111: 8 }).tech), { weapons: 12, shielding: 11, armour: 10 });
  assert.deepEqual(J(L.defenderSide(Object.assign({}, it, { research: { 109: 3, 110: 2, 111: 1 } }), {}).tech), { weapons: 3, shielding: 2, armour: 1 });
  // attacker: fleetTable bonus % wins over research
  assert.deepEqual(J(L.attackerSide({ 207: 1 }, { bonus: { attack: 100, defense: 90, shield: 80 }, research: { 109: 1 } }).bonusPct), { attack: 100, defense: 90, shield: 80 });
  assert.deepEqual(J(L.attackerSide({ 207: 1 }, { bonus: null, research: { 109: 1, 110: 2, 111: 3 } }).tech), { weapons: 1, shielding: 2, armour: 3 });
  // requirements: research from the player, buildings from the body, or the unit already present on the body
  assert.equal(L.reqMet(203, { levels: {}, ships: { 203: 1 } }, { 115: 6 }), true);
  assert.equal(L.reqMet(203, { levels: {}, ships: {} }, { 115: 6 }), false, 'shipyard level unknown');
  assert.equal(L.reqMet(203, { levels: { 21: 4 }, ships: {} }, { 115: 6 }), true);
  assert.equal(L.reqMet(203, { levels: { 21: 4 }, ships: {} }, { 115: 5 }), false);
  assert.equal(L.keyOf({ galaxy: 2, system: 68, position: 10 }), '2:68:10:1');
});

T.test('unit: shipyard queue read only right before a build order (never per cycle), cached with its end time; messages/fleetTable re-read when older than the event', async () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const M = sb.OGX.botFarm._M;
  M.ctx = { store: { get: async (k, d) => d, set: async () => {} } };
  M.cal = {};
  let t = 1_800_000_000_000;
  sb.OGX.bot = Object.assign(sb.OGX.bot || {}, { intel: { get: () => ({ ts: t - 60000 }) } });
  const acts = []; const recs = [];
  let avail = { metal: 1e12, crystal: 1e12, deuterium: 1e12 };
  const o = { id: 11, key: 'p11', coords: '2:68:5', type: 'planet', levels: { 21: 12, 15: 3 }, queues: {} };
  const bodies = { p11: o };
  const answers = [];
  const wctx = {
    now: () => t, cfg: (k) => ({ buildMaxWaitMin: 30, maxReportAgeMin: 30 })[k], core: () => undefined,
    rec: (k, w, d) => recs.push({ k, w, d }), decide: (w, d) => recs.push({ k: 'decision', w, d }),
    act: async (spec) => { acts.push(J(spec)); return answers.length ? answers.shift() : { ok: true, verified: true, at: t, data: {} }; },
    bodies: async () => bodies, available: () => Object.assign({}, avail), reserve: () => 'r1', release: () => {},
  };
  const env = { bodies, factors: null };
  const P = (key) => ({ origin: o, missing: { 217: 2 }, duration: 100, fuel: 1000, T: key });
  const tgt = (n) => ({ key: '2:68:' + n + ':1', coords: '2:68:' + n, state: 'reported' });
  // 1. unit speed unknown: one look at the shipyard (calibration chance), skip + short target pause; the next target: no read
  const T1 = tgt(10);
  await L.buildMissing(wctx, env, T1, P());
  assert.deepEqual(acts.map((a) => a.type + ':' + (a.params.page || '') + ':' + !!a.fresh), ['read.page:shipyard:false']);
  assert.equal(T1.state, 'notSuitable'); assert.ok(T1.cooldownUntil > t, 'paused, not re-simulated every cycle');
  assert.ok(recs.some((r) => r.k === 'skip' && r.d.reason === 'unitTimeUnknown'));
  await L.buildMissing(wctx, env, tgt(11), P());
  t += 10 * 60000;
  await L.buildMissing(wctx, env, tgt(12), P());
  assert.equal(acts.length, 1, 'no shipyard read per cycle while the speed is unknown (30 min)');
  // 2. speed known, not affordable: decided on known data, no read
  acts.length = 0; recs.length = 0;
  M.cal.unitSpeed = 1000;
  avail = { metal: 0, crystal: 0, deuterium: 0 };
  await L.buildMissing(wctx, env, tgt(13), P());
  assert.deepEqual(acts, [], 'buildCost known without a read');
  assert.ok(recs.some((r) => r.k === 'skip' && r.d.reason === 'buildCost'));
  // 3. affordable: the shipyard queue read fresh right before the order, then build.units
  avail = { metal: 1e12, crystal: 1e12, deuterium: 1e12 };
  t += 31 * 60000;
  const T4 = tgt(14);
  const r4 = await L.buildMissing(wctx, env, T4, P());
  assert.equal(r4.built, true, JSON.stringify(recs.slice(-3)));
  assert.deepEqual(acts.map((a) => a.type + ':' + !!a.fresh), ['read.page:true', 'build.units:false']);
  assert.ok(M.yard[11].endsAt > t, 'queue end remembered from the order');
  // a second plan of the same cycle on the same origin: the remembered queue, no second read
  acts.length = 0;
  await L.buildMissing(wctx, env, tgt(15), P());
  assert.deepEqual(acts.map((a) => a.type), ['build.units']);
  // 4. the remembered queue end makes the wait too long: skipped without a read
  acts.length = 0; recs.length = 0;
  M.yard[11] = { t: t - 20 * 60000, endsAt: t + 3 * 3600000 };
  await L.buildMissing(wctx, env, tgt(16), P());
  assert.deepEqual(acts, []);
  assert.ok(recs.some((r) => r.k === 'skip' && r.d.reason === 'buildTooLong'));
  // 5. building 21 / 15 in the body's queue: no read
  M.yard[11] = { t: t - 20 * 60000, endsAt: 0 };
  o.queues = { building: { objectId: 21, endsAt: t + 60000 } };
  await L.buildMissing(wctx, env, tgt(17), P());
  assert.deepEqual(acts, []);
  assert.ok(recs.some((r) => r.k === 'skip' && r.d.reason === 'shipyardBusy'));
  o.queues = {};
  // 6. messages: a (cached) list read before the report could exist is read again, fresh
  acts.length = 0;
  answers.push({ ok: true, at: t - 30000, data: {} }, { ok: true, at: t, data: {} });
  await L.readCategory(wctx, 0, 'тест', { notBefore: t - 10000 });
  assert.deepEqual(acts.map((a) => a.type + ':' + !!a.fresh), ['read.messages:false', 'read.messages:true']);
  acts.length = 0;
  answers.push({ ok: true, at: t - 5000, data: {} });
  await L.readCategory(wctx, 0, 'тест', { notBefore: t - 10000 });
  assert.equal(acts.length, 1, 'a list read after the report time is used as is');
  acts.length = 0;
  await L.readCategory(wctx, 0, 'тест', { fresh: true });
  assert.deepEqual(acts.map((a) => !!a.fresh), [true], 'escort / retries: never the cached list');
});

T.test('unit: escort probes refused for ships (the stored count was wrong): the next body with probes is tried once, same deadline', async () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const M = sb.OGX.botFarm._M;
  let t = 1_800_000_000_000;
  sb.OGX.bot = Object.assign(sb.OGX.bot || {}, { intel: { get: () => ({ research: { 106: 3 } }) } });
  sb.OGX.fleet = { gz: { dataFor: () => ({}), distance: (a, b) => (a === b ? 5 : Math.abs(+a.split(':')[2] - +b.split(':')[2]) * 5 + 1000), duration: () => 5, consumption: () => 1, durationRaw: () => 5 } };
  const acts = []; const recs = [];
  const ghost = { id: 21, key: 'p21', coords: '2:68:12', type: 'planet', ships: { 210: 60 }, shipsT: t };   // nearest, phantom probes
  const real = { id: 22, key: 'p22', coords: '2:68:6', type: 'planet', ships: { 210: 20 }, shipsT: t };
  const env = { bodies: { p21: ghost, p22: real }, research: { 106: 12 }, stats: {}, factors: null };
  const wctx = {
    now: () => t, cfg: () => undefined, core: () => undefined, locked: () => null, canSend: async () => ({ ok: true }),
    rec: (k, w, d) => recs.push({ k, w, d }), decide: (w, d) => recs.push({ k: 'decision', w, d }),
    act: async (spec) => { acts.push(J(spec)); return +spec.bodyId === 21 ? { ok: false, refused: 'ships', message: 'корабль 210: есть 0, нужно 5' } : { ok: true, at: t, data: { fleetId: 7, arrival: t + 5000 } }; },
  };
  const A = { id: 'farm:2:68:13:1:x', key: '2:68:13:1', coords: '2:68:13', target: { galaxy: 2, system: 68, position: 13, type: 1 }, arrival: t + 60000, escort: { state: 'pending' } };
  await L.escortSpy(wctx, env, A);
  assert.deepEqual(acts.map((a) => +a.bodyId), [21, 22], 'the nearest body first, then the next one ' + JSON.stringify(recs.map((r) => r.w)));
  assert.equal(A.escort.state, 'sent');
  assert.equal(A.escort.origin, 22);
  assert.ok(recs.some((r) => r.k === 'escort-spy' && /пробую другое тело/.test(r.w)));
  // every origin refuses: tried at most 3 bodies, then failed (no loop)
  acts.length = 0;
  wctx.act = async (spec) => { acts.push(J(spec)); return { ok: false, refused: 'ships', message: 'нет' }; };
  const B2 = Object.assign({}, A, { id: 'b2', escort: { state: 'pending' } });
  await L.escortSpy(wctx, env, B2);
  assert.ok(acts.length <= 3, String(acts.length));
  assert.ok(['failed', 'skipped'].includes(B2.escort.state), B2.escort.state);
  void M;
});

T.test('unit: farm attack slots (botfarm-7): 0 = auto share of the fleet slots, computed before the simulations; the spy loop survives a full farm', async () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const M = sb.OGX.botFarm._M;
  const now = 1_800_000_000_000;
  sb.OGX.time = { serverNow: () => now };
  let maxSlots = 0;
  const wctx = { cfg: (k) => (k === 'maxSlots' ? maxSlots : undefined) };
  M.attacks = {};
  assert.equal(L.maxFarmSlots(wctx, { ok: true, free: 17, reserve: 1 }), 12, '22 slots, 5 used by others: 17 free - 1 reserve - 4 for other modules');
  for (let i = 0; i < 12; i++) M.attacks['a' + i] = { status: 'flying', arrival: now + 600000 };
  assert.equal(L.farmFlying(), 12);
  assert.equal(L.maxFarmSlots(wctx, { ok: true, free: 5, reserve: 1 }), 12, 'the raids it already holds count: the share stays 12 while they fly');
  M.attacks = {};
  assert.equal(L.maxFarmSlots(wctx, { ok: true, free: 6, reserve: 1 }), 3, 'never below 3');
  assert.equal(L.maxFarmSlots(wctx, { ok: false, free: null, reserve: 1 }), 3, 'slots unknown: 3');
  maxSlots = 5;
  assert.equal(L.maxFarmSlots(wctx, { ok: true, free: 17, reserve: 1 }), 5, 'a set value wins');
  // source rules: the slot room is computed before the evaluation loop and a full farm does not stop the espionage loop
  const src = fs.readFileSync(path.join(ROOT, 'ogamex-bot/modules/botfarm/botfarm.js'), 'utf8');
  assert.ok(/const room = Math\.max\(0, maxSlots - farmFlying\(\)\);[\s\S]*for \(const T of toEval\.slice\(0, Math\.min\(per, room\)\)\)/.test(src), 'room before planning');
  assert.ok(/return \{ stop: false, full: true \};/.test(src) && /if \(r\.full\) break;/.test(src), 'maxSlots case is full, not stop');
});

T.test('unit: probe stock (journal-1, botfarm-9): spies keep botexpo keepProbes + the farm reserve (escorts use it), the farm orders probes on the main when the next cycle is short, never twice, capped per hour; OGX.bot.probeDemand', async () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const M = sb.OGX.botFarm._M;
  M.ctx = { store: { get: async (k, d) => d, set: async () => {} } };
  M.cal = {}; M.targets = {}; M.attacks = {}; M.yard = {};
  let t = 1_800_000_000_000;
  let expoOn = true;
  const settings = { 'botexpo.keepProbes': 2000, 'spy.probes': 1100 };
  sb.OGX.settings = { get: (k) => settings[k] };
  sb.OGX.bot = Object.assign(sb.OGX.bot || {}, { isActive: (m) => (m === 'botexpo' ? expoOn : true), intel: { get: () => null, put: () => {} } });
  sb.OGX.fleet = { gz: { dataFor: () => ({}), distance: (a, b) => (a === '2:68:6' ? 1000 : 5000), duration: () => 30, consumption: () => 1, durationRaw: () => 30 } };
  const cfg = { probeBuild: true, probeBuildPerHour: 5000, useFleetAjax: false };
  const acts = []; const recs = [];
  let yardQueue = null;
  const wctx = {
    now: () => t, cfg: (k) => cfg[k], core: () => undefined, locked: () => null, sleepCheck: () => ({ ok: true }),
    canSend: async () => ({ ok: true, free: 10, reserve: 1, held: 0 }), available: () => ({ metal: 1e12, crystal: 1e12, deuterium: 1e12 }),
    reserve: () => 'res1', release: () => {}, bodies: async () => env.bodies,
    rec: (k, w, d) => recs.push({ k, w, d }), decide: (w, d) => recs.push({ k: 'decision', w, d }),
    act: async (spec) => {
      acts.push(J(spec));
      if (spec.type === 'read.page') { env.bodies.p1.queues = { unit: yardQueue }; return { ok: true, at: t, data: {} }; }
      if (spec.type === 'fleet.send') return { ok: true, at: t, data: { arrival: t + 30000 } };
      return { ok: true, at: t, data: {} };
    },
  };
  const env = { research: { 106: 22 }, factors: null, server: {}, bodies: {
    p1: { id: 1, key: 'p1', coords: '2:68:6', type: 'planet', levels: { 1: 40, 2: 38, 3: 35, 21: 14 }, ships: { 210: 2500 }, shipsT: t },
    p2: { id: 2, key: 'p2', coords: '2:90:4', type: 'planet', levels: { 1: 30, 2: 28, 3: 25 }, ships: { 210: 20000 }, shipsT: t },
  } };
  // 1. the reserve: botexpo keepProbes (only while botexpo runs) + probeReserve (default 0)
  assert.equal(L.probeReserve(wctx), 2000);
  expoOn = false; assert.equal(L.probeReserve(wctx), 0, 'botexpo off: only the farm reserve'); expoOn = true;
  cfg.probeReserve = 500; assert.equal(L.probeReserve(wctx), 2500, 'probeReserve set'); delete cfg.probeReserve;
  // 2. spyTarget: the near body has only 500 above the reserve -> the far body with 20000 sends the full 1100
  const T0 = { key: '2:70:8:1', coords: '2:70:8', target: { galaxy: 2, system: 70, position: 8, type: 1 }, state: 'new' };
  M.targets[T0.key] = T0;
  const origins = Object.values(env.bodies);
  sb.OGX.botSim = Object.assign({}, sb.OGX.botSim, { spyNeeded: () => 3 });
  wctx.threats = () => [];
  const sr = await L.spyTarget(wctx, env, T0, origins, { reason: 'тест' });
  const spy = acts.find((a) => a.type === 'fleet.send');
  assert.ok(spy && spy.bodyId === 2 && spy.params.ships[210] === 1100, 'the 20000-probe body sends 1100: ' + JSON.stringify(acts) + JSON.stringify(sr));
  acts.length = 0; recs.length = 0;
  env.bodies.p2.ships = { 210: 2800 };
  const T1 = { key: '2:70:9:1', coords: '2:70:9', target: { galaxy: 2, system: 70, position: 9, type: 1 }, state: 'new' };
  await L.spyTarget(wctx, env, T1, origins, { reason: 'тест' });
  const s1 = acts.find((a) => a.type === 'fleet.send');
  assert.ok(s1.bodyId === 1 && s1.params.ships[210] === 500, 'nobody full: the nearest sends only what is above the reserve (2500 - 2000): ' + JSON.stringify(s1));
  acts.length = 0;
  env.bodies.p1.ships = { 210: 2002 }; env.bodies.p2.ships = { 210: 2002 };
  await L.spyTarget(wctx, env, T1, origins, { reason: 'тест' });
  assert.ok(!acts.some((a) => a.type === 'fleet.send') && recs.some((r) => r.k === 'skip' && r.d.reason === 'noProbes' && r.d.reserve === 2000), 'below the formula minimum above the reserve: no spy');
  acts.length = 0; recs.length = 0;
  env.bodies.p1.ships = { 210: 2500 }; env.bodies.p2.ships = { 210: 20000 };
  const src = fs.readFileSync(path.join(ROOT, 'ogamex-bot/modules/botfarm/botfarm.js'), 'utf8');
  assert.ok(/const free = have - reserve;\s*\n\s*if \(free < p\.min\)/.test(src) && /n: Math\.min\(p\.probes, free\)/.test(src), 'spy origins keep probeReserve()');
  // 3. ensureProbes: 2 spies due -> need 2200; stock above the reserve = 500 + 18000 -> nothing to build
  assert.equal(await L.ensureProbes(wctx, env, origins, 2), null);
  assert.equal(acts.length, 0);
  // stock short: p2 down to 4000 (500 + 2000 above the reserve), 3 spies -> need 3300: order on the main p1 (highest mines),
  // after one shipyard read; n = 3300 - 2500 = 800
  env.bodies.p2.ships = { 210: 4000 };
  const o = await L.ensureProbes(wctx, env, origins, 3);
  assert.deepEqual(acts.map((a) => a.type + (a.params.page ? ':' + a.params.page : '')), ['read.page:shipyard', 'build.units']);
  assert.equal(acts[1].bodyId, 1); assert.deepEqual(acts[1].params.units, { 210: 800 }); assert.equal(o.n, 800);
  assert.ok(recs.some((r) => r.k === 'probe-build' && r.d.n === 800));
  // no second order while ours is in the yard
  acts.length = 0;
  assert.equal(await L.ensureProbes(wctx, env, origins, 3), null); assert.equal(acts.length, 0, 'our order still building');
  // later: the yard holds botexpo's probe order -> no duplicate, read at most once per 10 min
  t += 5 * 60000; M.cal.probeOrder.readyAt = t - 1; M.yard = {}; yardQueue = { endsAt: t + 60000, techId: 210, queued: [] };
  assert.equal(await L.ensureProbes(wctx, env, origins, 3), null);
  assert.deepEqual(acts.map((a) => a.type), ['read.page'], 'one shipyard read, no order');
  acts.length = 0; env.bodies.p1.queues = null; yardQueue = null;
  // per-hour cap: 800 of 5000 used -> at most 4200 more; with the cap used up nothing is ordered
  t += 60000;
  M.yard[1] = { t, endsAt: 0 };
  const o2 = await L.ensureProbes(wctx, env, origins, 20);
  assert.equal(o2.n, 4200, 'capped by probeBuildPerHour'); acts.length = 0;
  M.cal.probeOrder.readyAt = t - 1;
  assert.equal(await L.ensureProbes(wctx, env, origins, 20), null); assert.equal(acts.length, 0, 'cap reached');
  assert.ok(recs.some((r) => r.k === 'skip' && r.d.reason === 'probeCap'));
  // probeBuild off: nothing; the demand registry: lost probes per day
  cfg.probeBuild = false; t += 2 * 3600000;
  assert.equal(await L.ensureProbes(wctx, env, origins, 20), null); assert.equal(acts.length, 0);
  assert.equal(typeof sb.OGX.bot.probeDemand.get, 'function');
  M.cal.probeT0 = t - 12 * 3600000; M.cal.probeLost = [[t - 3600000, 1100], [t - 7200000, 1100]];
  assert.equal(L.probeLossPerDay(t), 4400, '2200 lost in 12 h -> 4400 per day');
  await L.ensureProbes(wctx, env, origins, 1);
  assert.equal(sb.OGX.bot.probeDemand.get('botfarm'), 4400); assert.equal(sb.OGX.bot.probeDemand.total(), 4400);
});

T.test('unit: fast spy count (rules-4): fleetAjax sending fewer probes than needed (game «Зондов на шпионаж») -> warning once per hour, the next spies go by fleet.send with the exact count for 24 h', async () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const M = sb.OGX.botFarm._M;
  M.ctx = { store: { get: async (k, d) => d, set: async () => {} } };
  M.cal = {}; M.targets = {}; M.attacks = {}; M.yard = {};
  let t = 1_800_000_000_000;
  sb.OGX.settings = { get: (k) => ({ 'spy.probes': 1100 })[k] };
  sb.OGX.bot = Object.assign(sb.OGX.bot || {}, { isActive: () => false, intel: { get: () => null, put: () => {} } });
  sb.OGX.botSim = Object.assign({}, sb.OGX.botSim, { spyNeeded: () => 3 });
  sb.OGX.fleet = { gz: { dataFor: () => ({}), distance: () => 1000, duration: () => 30, consumption: () => 1, durationRaw: () => 30 } };
  const acts = []; const recs = [];
  const wctx = {
    now: () => t, cfg: (k) => ({ useFleetAjax: true, probeBuild: false })[k], core: () => undefined, locked: () => null, sleepCheck: () => ({ ok: true }), threats: () => [],
    canSend: async () => ({ ok: true, free: 10, reserve: 1, held: 0 }), available: () => ({}), reserve: () => 'r', release: () => {},
    rec: (k, w, d) => recs.push({ k, w, d }), decide: (w, d) => recs.push({ k: 'decision', w, d }),
    act: async (spec) => {
      acts.push(J(spec));
      if (spec.type === 'fleet.ajax') return { ok: true, at: t, data: { arrival: t + 30000, shipsSent: { 210: 1 } } };
      return { ok: true, at: t, data: { arrival: t + 30000 } };
    },
  };
  const env = { research: { 106: 22 }, factors: null, server: {}, bodies: { p1: { id: 1, key: 'p1', coords: '2:68:6', type: 'planet', ships: { 210: 50000 }, shipsT: t } } };
  const origins = Object.values(env.bodies);
  const mk = (n) => ({ key: '2:70:' + n + ':1', coords: '2:70:' + n, target: { galaxy: 2, system: 70, position: n, type: 1 }, state: 'new', planetId: 9000 + n });
  const A = mk(1);
  await L.spyTarget(wctx, env, A, origins, { reason: 'тест' });
  assert.equal(acts[0].type, 'fleet.ajax');
  assert.equal(A.spy.probes, 1, 'the real count is recorded');
  const warn = recs.filter((r) => r.k === 'skip' && r.d.reason === 'ajaxShort');
  assert.equal(warn.length, 1); assert.ok(/«Зондов на шпионаж» должно быть 1100/.test(warn[0].w), warn[0].w);
  assert.deepEqual(J(M.cal.ajaxShort), { sent: 1, n: 1100, t });
  // the same target again and another one: fleet.send with ships {210: 1100}
  acts.length = 0; A.state = 'needMoreProbes'; A.spy = null;
  await L.spyTarget(wctx, env, A, origins, { reason: 'тест' });
  await L.spyTarget(wctx, env, mk(2), origins, { reason: 'тест' });
  assert.deepEqual(acts.map((a) => a.type + ':' + (a.params.ships ? a.params.ships[210] : '-')), ['fleet.send:1100', 'fleet.send:1100']);
  assert.equal(L.ajaxAllowed(wctx, mk(3), 1), true, 'a need the game count covers may still use fleetAjax');
  // after 24 h fleetAjax is tried again; still short -> warned again (more than an hour since the last warning)
  t += 24 * 3600000 + 1000; acts.length = 0; recs.length = 0; env.bodies.p1.shipsT = t;
  await L.spyTarget(wctx, env, mk(4), origins, { reason: 'тест' });
  assert.equal(acts[0].type, 'fleet.ajax');
  assert.equal(recs.filter((r) => r.k === 'skip' && r.d.reason === 'ajaxShort').length, 1);
  // within the hour a second short answer is not journaled again
  recs.length = 0; t += 60000;
  L.checkAjaxCount(wctx, { data: { shipsSent: { 210: 1 } } }, 1100, 'тест');
  assert.equal(recs.filter((r) => r.k === 'skip' && r.d.reason === 'ajaxShort').length, 0, 'once per hour');
  // the game setting fixed: a full fleetAjax send clears the flag
  L.checkAjaxCount(wctx, { data: { shipsSent: { 210: 1100 } } }, 1100, 'тест');
  assert.equal(M.cal.ajaxShort, null);
});

// ------------------------------------------------------------------ browser gates
const HOME = 254102;
const OTHER_BOT = ['botsave', 'botdebris', 'botbuild', 'botexpo'];
const BASE = Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])),
  { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.userIdleSec': 0, 'botfarm.minLoot': 100000, 'botfarm.escort': false,
    'botfarm.probeBuild': false });   // the gates below count every POST: the farm's own probe orders (journal-1) are a unit test
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function leader(env) { await env.until(async () => { const s = await env.botStatus(); return s && s.leader; }, { timeoutMs: 25000, label: 'leader' }); }
async function kick(env) {
  await sleep(2600);
  const p = await env.page();
  await env.evalOgx(p, () => { OGX.bus.emit('bot:fleet-returned', { fleetId: 0, mission: 0, bodyKey: null, at: OGX.time.serverNow(), why: 'test kick' }); });
}
async function clean(env, what) {
  assert.deepEqual(env.ogxErrors().map((e) => e.text), [], what + ': no [OGX errors');
  const mine = env.consoleErrors().filter((e) => /OGX|ogx-|bot/i.test((e.text || '') + (e.stack || '')) && !/Failed to load resource/i.test(e.text || ''));
  assert.deepEqual(mine.map((e) => e.text), [], what + ': no console errors from the bot');
}
async function decisionsFirst(env, what) {
  const j = await env.journal();
  for (const a of j.filter((e) => e.k === 'botcore:action-queued' && e.d && e.d.module === 'botfarm' && e.d.type !== 'read.fleetTable')) {
    assert.ok(j.some((e) => e.k === 'botfarm:decision' && e.d && e.d.run === a.d.run && e.t <= a.t), what + ': decision before ' + a.d.type);
  }
}
const ev = (env, kind, pred, timeoutMs = 150000) => env.waitJournal(kind, { pred, timeoutMs, stepMs: 700 });

T.test('unit: spy reports (journal-2, botfarm-2, botfarm-8): a page load before every read (2Moons AJAX gate), reads at +5/30/90/300/900 s, pages 2-3, 1 h noReport instead of the 24 h ban, late report rescue, probesLost only with evidence', async () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const M = sb.OGX.botFarm._M;
  M.ctx = { store: { get: async (k, d) => d, set: async () => {} } };
  M.cal = {}; M.targets = {};
  let t = 1_800_000_000_000;
  const intelStore = {};
  sb.OGX.bot = Object.assign(sb.OGX.bot || {}, { intel: { put: (k, v) => { intelStore[k] = v; }, get: (k) => intelStore[k] || null } });
  // the sandbox has no 19-messages.js: list rows carry the parsed report directly
  sb.OGX.messages = { parse: { list: (doc) => doc.items || [], espionageFull: (it) => it.rep, battleShort: () => null } };
  const acts = []; const recs = [];
  const pageSets = [];   // one { site: items } per report pass
  let cur = {};
  let kickOk = true;
  const wctx = {
    now: () => t, cfg: (k) => ({ deleteReports: true, maxProbeRetries: 2 })[k], core: () => undefined,
    rec: (k, w, d) => recs.push({ k, w, d }), decide: (w, d) => recs.push({ k: 'decision', w, d }),
    act: async (spec) => {
      acts.push(J(spec));
      if (spec.type === 'read.page') return kickOk ? { ok: true, verified: true, at: t, data: {} } : { ok: false, refused: 'limit', message: 'лимит' };
      if (spec.type === 'read.messages') { if (spec.params.site === 1) cur = pageSets.shift() || {}; return { ok: true, at: t, data: { doc: { items: cur[spec.params.site] || [] } } }; }
      return { ok: true, at: t, data: {} };
    },
  };
  const row = (coords, ts, { id, destroyed = false, complete = true } = {}) => {
    const [g, s, p] = coords.split(':').map(Number);
    return { id, ts, kind: 'spy_report', rep: { id, ts, attackParams: { galaxy: g, system: s, position: p }, resources: { metal: 5e6, crystal: 2e6, deuterium: 1e6 },
      known: { ships: true, defense: complete, buildings: true, research: true }, ships: { 204: 20 }, defense: complete ? { 401: 50 } : null, buildings: { 1: 20 }, research: { 106: 3 }, probesDestroyed: destroyed } };
  };
  const mk = (n, sentAt) => { const key = '2:68:' + n + ':1'; const T = { key, coords: '2:68:' + n, target: { galaxy: 2, system: 68, position: n, type: 1 }, state: 'probing', stateAt: sentAt, spy: { sentAt, arrival: sentAt + 5000, probes: 1100, origin: 11, reportAt: sentAt + 10000 } }; M.targets[key] = T; return T; };
  const off = (T) => (T.spy.reportAt - T.spy.arrival) / 1000;
  // 1. the schedule: overview GET (plain, never cached, no cp) before the list; misses at +5/+30/+90/+300/+900 s, then 1 h noReport
  const t0 = t;
  const A = mk(10, t0);
  t = t0 + 10000; pageSets.push({ 1: [] });
  await L.processSpyReports(wctx, {});
  assert.deepEqual(acts.map((a) => a.type + ':' + (a.params.page || a.params.site) + ':' + !!a.fresh), ['read.page:overview:true', 'read.messages:1:false'], 'a page load before the first read');
  assert.equal(acts[0].params.after, A.spy.arrival, 'read.page { after: arrival } for a core that skips it when a page was loaded since');
  assert.equal(acts[0].bodyId, undefined, 'no planet switch for the page load');
  assert.equal(A.state, 'probing'); assert.equal(A.spy.reads, 1);
  assert.ok(off(A) >= 30 && off(A) < 34, 'next read at arrival + 30 s: ' + off(A));
  for (const [i, exp] of [[2, 90], [3, 300], [4, 900]]) {
    t = A.spy.reportAt; acts.length = 0; pageSets.push({ 1: [] });
    await L.processSpyReports(wctx, {});
    assert.equal(A.spy.reads, i); assert.ok(off(A) >= exp && off(A) < exp + 4, 'read ' + i + ' -> next at +' + exp + ' s: ' + off(A));
    assert.ok(acts.some((a) => a.type === 'read.page') && acts.some((a) => a.type === 'read.messages' && a.fresh), 'page load + fresh list on every read');
  }
  t = A.spy.reportAt; acts.length = 0; pageSets.push({ 1: [] });
  await L.processSpyReports(wctx, {});
  assert.equal(A.state, 'noReport'); assert.equal(A.cooldownUntil, t + 3600000, '1 h, not 24 h'); assert.equal(A.spy, null);
  assert.deepEqual([A.spyPending.sentAt, A.spyPending.arrival, A.spyPending.probes], [t0, t0 + 5000, 1100], 'the spy kept for a late report');
  assert.ok(!recs.some((r) => r.k === 'cooldown' && r.d.state === 'probesLost'), 'never probesLost without evidence');
  // 2. a read without a page load after the arrival does not count (the server has not processed the probes); a core that knows
  //    of a page load (OGX.bot.lastPageAt) needs no extra request
  const B = mk(11, t);
  t = B.spy.reportAt; acts.length = 0; kickOk = false; pageSets.push({ 1: [] });
  await L.processSpyReports(wctx, {});
  assert.equal(B.spy.reads || 0, 0, 'not counted');
  assert.ok(B.spy.reportAt >= t + 15000 && B.spy.reportAt <= t + 30000, 'retried in 15-30 s: ' + (B.spy.reportAt - t));
  assert.ok(recs.some((r) => r.k === 'skip' && r.d.reason === 'kick'));
  kickOk = true;
  sb.OGX.bot.lastPageAt = () => t + 1;
  t = B.spy.reportAt; acts.length = 0; pageSets.push({ 1: [] });
  await L.processSpyReports(wctx, {});
  assert.ok(!acts.some((a) => a.type === 'read.page'), 'no request when the core saw a page load after the arrival');
  assert.equal(B.spy.reads, 1);
  delete sb.OGX.bot.lastPageAt;
  delete M.targets[B.key];
  // 3. the report in the 5th list: reported, intel stored, deleted; no pause at all
  const C = mk(12, t);
  for (let i = 0; i < 4; i++) { t = C.spy.reportAt; pageSets.push({ 1: [] }); await L.processSpyReports(wctx, {}); }
  assert.equal(C.spy.reads, 4);
  t = C.spy.reportAt; acts.length = 0; pageSets.push({ 1: [row('2:68:12', C.spy.arrival, { id: 501 })] });
  await L.processSpyReports(wctx, {});
  assert.equal(C.state, 'reported'); assert.equal(C.cooldownUntil, undefined); assert.ok(intelStore['2:68:12:1'], 'intel put');
  const del = acts.find((a) => a.type === 'messages.delete');
  assert.deepEqual(del && del.params, { ids: [501], cat: 0 }, 'processed report deleted');
  // 4. paging: page 1 full of newer rows -> page 2 holds the due report; found on page 1 -> no page 2
  const D = mk(13, t);
  t = D.spy.reportAt; acts.length = 0;
  const newer = Array.from({ length: 10 }, (_, i) => row('3:1:' + (i + 1), t - i * 100, { id: 600 + i }));
  pageSets.push({ 1: newer, 2: [row('2:68:13', D.spy.arrival, { id: 520 })] });
  await L.processSpyReports(wctx, {});
  assert.deepEqual(acts.filter((a) => a.type === 'read.messages').map((a) => a.params.site), [1, 2], 'page 2 read while page 1 holds only newer rows');
  assert.equal(D.state, 'reported');
  const E = mk(14, t);
  t = E.spy.reportAt; acts.length = 0;
  pageSets.push({ 1: newer.slice(0, 9).concat([row('2:68:14', E.spy.arrival, { id: 530 })]), 2: [] });
  await L.processSpyReports(wctx, {});
  assert.deepEqual(acts.filter((a) => a.type === 'read.messages').map((a) => a.params.site), [1], 'found on page 1: no paging');
  assert.equal(E.state, 'reported');
  // 5. evidence: probes destroyed + complete report -> reported (cost noted); destroyed + incomplete -> 2 h probesLost;
  //    incomplete without evidence -> more probes, as before
  const F = mk(15, t); t = F.spy.reportAt; recs.length = 0;
  pageSets.push({ 1: [row('2:68:15', F.spy.arrival, { id: 540, destroyed: true })] });
  await L.processSpyReports(wctx, {});
  assert.equal(F.state, 'reported'); assert.equal(intelStore['2:68:15:1'].probesLost, true);
  assert.ok(recs.some((r) => r.k === 'report' && r.d.probesLost === true && /уничтожены/.test(r.w)));
  const G = mk(16, t); t = G.spy.reportAt;
  pageSets.push({ 1: [row('2:68:16', G.spy.arrival, { id: 550, destroyed: true, complete: false })] });
  await L.processSpyReports(wctx, {});
  assert.equal(G.state, 'probesLost'); assert.equal(G.cooldownUntil, t + 2 * 3600000, '2 h');
  const H = mk(17, t); t = H.spy.reportAt;
  pageSets.push({ 1: [row('2:68:17', H.spy.arrival, { id: 560, complete: false })] });
  await L.processSpyReports(wctx, {});
  assert.equal(H.state, 'needMoreProbes');
  // 6. rescue: the late report of A (paused as noReport) in a list read for another target ends the pause
  const K = mk(18, t); t = K.spy.reportAt; recs.length = 0;
  pageSets.push({ 1: [row('2:68:10', A.spyPending.arrival + 1000, { id: 570 })] });
  await L.processSpyReports(wctx, {});
  assert.equal(A.state, 'reported'); assert.equal(A.cooldownUntil, null); assert.equal(A.spyPending, null);
  assert.ok(recs.some((r) => r.k === 'report-late' && r.d.key === '2:68:10:1'));
  assert.equal(K.state, 'probing');
  // source rules: the 30-min housekeeping line is a noReport pause too; the first read is scheduled at arrival + 5 s
  const src = fs.readFileSync(path.join(ROOT, 'ogamex-bot/modules/botfarm/botfarm.js'), 'utf8');
  assert.ok(/giveUpSpy\(wctx, T, 'доклад не прочитан за 30 мин/.test(src), 'housekeeping: noReport, not probesLost');
  assert.ok(/reportAt: arrival \+ REPORT_READS\[0\] \* 1000 \+ rnd\(0, 3000\)/.test(src), 'first read at arrival + 5 s');
  assert.ok(!/cooldown\(wctx, T, 'probesLost', 'доклад не найден/.test(src), 'the 24 h «доклад не найден» ban is gone');
  assert.equal(L.COOLDOWN.probesLost, 2 * 3600000); assert.equal(L.COOLDOWN.noReport, 3600000);
});

T.test('unit: escort under the AJAX gate (botfarm-4, journal-7): probes arrive escortLeadSec..+30 s before the hit, a page load before every read, reads at +5/+30/+90 s until the hit - 20 s, then fly on with intel < 30 min or recall; the escort report is deleted', async () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const M = sb.OGX.botFarm._M;
  M.ctx = { store: { get: async (k, d) => d, set: async () => {} } }; M.targets = {}; M.attacks = {}; M.cal = {};
  let t = 1_800_000_000_000;
  let intel = { ts: t - 10 * 60000, research: { 106: 3 }, known: { ships: true, defense: true }, ships: {}, defense: {}, res: { metal: 1e6, crystal: 1e6, deuterium: 1e5 } };
  sb.OGX.bot = Object.assign(sb.OGX.bot || {}, { intel: { get: () => intel, put: (k, v) => { intel = v; } }, battles: { remove: () => {}, put: () => {} } });
  sb.OGX.fleet = { gz: { dataFor: () => ({}), distance: () => 1005, duration: () => 5, consumption: () => 1, durationRaw: () => 5 } };
  sb.OGX.messages = { parse: { list: (doc) => doc.items || [], espionageFull: (it) => it.rep, battleShort: () => null } };
  const acts = []; const recs = []; let items = [];
  const wctx = {
    now: () => t, cfg: (k) => ({ escortLeadSec: 90, deleteReports: true, recallOnChange: true })[k], core: () => undefined, locked: () => null, canSend: async () => ({ ok: true }),
    rec: (k, w, d) => recs.push({ k, w, d }), decide: (w, d) => recs.push({ k: 'decision', w, d }),
    act: async (spec) => {
      acts.push(J(spec));
      if (spec.type === 'read.messages') return { ok: true, at: t, data: { doc: { items } } };
      if (spec.type === 'fleet.send') return { ok: true, at: t, data: { fleetId: 7, arrival: (spec.at || t) + 5000 } };
      return { ok: true, at: t, data: {} };
    },
  };
  const home = { id: 22, key: 'p22', coords: '2:68:6', type: 'planet', ships: { 210: 2000 }, shipsT: t };
  const env = { bodies: { p22: home }, research: { 106: 12 }, stats: {}, factors: null, server: {} };
  // 1. timing: hit in 400 s, probe flight 5 s -> the probes arrive 90-120 s before the hit, latest 30 s before it
  const A = { id: 'farm:2:68:13:1:x', key: '2:68:13:1', coords: '2:68:13', target: { galaxy: 2, system: 68, position: 13, type: 1 }, origin: 22, fleetId: 99, arrival: t + 400000, sentAt: t, status: 'flying', ships: { 217: 10 }, escort: { state: 'pending' } };
  M.attacks[A.id] = A;
  M.targets[A.key] = { key: A.key, coords: A.coords, target: A.target, state: 'attackFlying', attackId: A.id };
  await L.escortSpy(wctx, env, A);
  const send = acts.find((a) => a.type === 'fleet.send');
  assert.ok(send, 'escort sent: ' + JSON.stringify(recs.map((r) => r.w)));
  const leadMs = A.arrival - (send.at + 5000);
  assert.ok(leadMs >= 90000 && leadMs <= 120000, 'probes arrive 90-120 s before the hit: ' + leadMs / 1000);
  assert.equal(send.deadline, A.arrival - 5000 - 20000 - 10000, 'latest send: probes 30 s before the hit');
  assert.equal(A.escort.state, 'sent');
  assert.ok(A.escort.reportAt >= A.escort.spyArrival + 5000 && A.escort.reportAt <= A.escort.spyArrival + 7000, 'first read at spyArrival + 5 s');
  assert.ok(recs.some((r) => r.k === 'decision' && /за 90–120 с до атаки/.test(r.d.why)));
  // 2. reads: a page load before each; +5, +30, then +90 bounded by the hit - 23 s; nothing -> the raid flies on (intel 10 min old)
  acts.length = 0; recs.length = 0;
  const E = A.escort; const deadline = A.arrival - 20000;
  t = E.reportAt; await L.escortReport(wctx, env, A);
  assert.deepEqual(acts.map((a) => a.type + ':' + (a.params.page || a.params.site)), ['read.page:overview', 'read.messages:1'], 'page load, then the list');
  assert.equal(acts[0].params.after, E.spyArrival);
  assert.equal(E.reads, 1); assert.ok(E.reportAt >= E.spyArrival + 30000 && E.reportAt < deadline, '2nd read at +30 s: ' + (E.reportAt - E.spyArrival));
  t = E.reportAt; acts.length = 0; await L.escortReport(wctx, env, A);
  assert.equal(E.reads, 2);
  assert.ok(E.reportAt <= deadline - 3000 && E.reportAt >= Math.min(E.spyArrival + 90000, deadline - 3000), '3rd read at +90 s, before the decision point: ' + (E.reportAt - E.spyArrival));
  t = E.reportAt; acts.length = 0; await L.escortReport(wctx, env, A);
  assert.equal(E.state, 'noReport', 'no further read fits before the hit - 20 s');
  assert.ok(!acts.some((a) => a.type === 'fleet.recall'), 'intel 10 min old: the raid flies on');
  const nr = recs.find((r) => r.k === 'escort-report');
  assert.ok(nr && nr.d.noReport && nr.d.intelAgeMin < 30 && /продолжается/.test(nr.w), JSON.stringify(nr));
  assert.equal(A.status, 'flying');
  // 3. intel older than 30 min and no report: recall (kind noReport), the target pauses 1 h as noReport
  intel = Object.assign({}, intel, { ts: t - 40 * 60000 });
  const A2 = Object.assign(J(A), { id: 'farm:2:68:13:1:y', fleetId: 98, arrival: t + 15000, escort: { state: 'sent', sentAt: t - 100000, spyArrival: t - 95000, reportAt: t, probes: 5, reads: 2 } });
  M.attacks[A2.id] = A2; M.targets[A.key].attackId = A2.id;
  acts.length = 0; recs.length = 0;
  await L.escortReport(wctx, env, A2);
  const rc = acts.find((a) => a.type === 'fleet.recall');
  assert.ok(rc && rc.params.fleetId === 98, 'recalled: ' + JSON.stringify(acts.map((a) => a.type)) + ' ' + JSON.stringify(recs.map((r) => r.w)));
  assert.equal(A2.status, 'recalled');
  assert.equal(M.targets[A.key].state, 'noReport'); assert.equal(M.targets[A.key].cooldownUntil, t + 3600000);
  // 4. the report found: compared (no change), deleted like a spy report; a late report of another target in the list rescued
  const A3 = Object.assign(J(A), { id: 'farm:2:68:13:1:z', fleetId: 97, arrival: t + 200000, escort: { state: 'sent', sentAt: t, spyArrival: t + 5000, reportAt: t + 10000, probes: 5 } });
  M.attacks[A3.id] = A3;
  M.targets['2:68:10:1'] = { key: '2:68:10:1', coords: '2:68:10', target: { galaxy: 2, system: 68, position: 10, type: 1 }, state: 'noReport', cooldownUntil: t + 3000000, spyPending: { sentAt: t - 600000, arrival: t - 595000, probes: 5 } };
  const rep = (coords, ts, id, complete) => { const [g, s, p] = coords.split(':').map(Number); return { id, ts, kind: 'spy_report', rep: { id, ts, attackParams: { galaxy: g, system: s, position: p }, resources: { metal: 1e6, crystal: 1e6, deuterium: 1e5 }, known: { ships: true, defense: complete, buildings: true, research: true }, ships: {}, defense: complete ? {} : null, buildings: {}, research: { 106: 3 }, probesDestroyed: false } }; };
  items = [rep('2:68:13', t + 5000, 701, false), rep('2:68:10', t - 590000, 702, true)];
  t = A3.escort.reportAt; acts.length = 0; recs.length = 0;
  await L.escortReport(wctx, env, A3);
  assert.equal(A3.escort.state, 'reported');
  const er = recs.find((r) => r.k === 'escort-report'); assert.ok(er && er.d.changed === false, JSON.stringify(er));
  const del = acts.find((a) => a.type === 'messages.delete');
  assert.deepEqual(del && del.params.ids.sort(), [701, 702], 'escort report deleted together with the rescued late report');
  assert.equal(M.targets['2:68:10:1'].state, 'reported'); assert.equal(M.targets['2:68:10:1'].cooldownUntil, null);
});

T.test('(f) limits: fleet sends per hour refuse the attack (journaled); maxSlots 1 -> one farm attack in flight', async () => {
  const env = await B.launchBot({ world: 'botfarm-three', settings: BASE });
  try {
    const W = env.world;
    await env.game('galaxy', { query: { galaxy: 2, system: 68 } });
    await env.setSettings({ 'botcore.master': true, 'botcore.dryRun': false, 'botfarm.on': true, 'botcore.maxFleetSendsPerHour': 2 });
    await leader(env);
    await kick(env);
    await ev(env, 'botfarm:spy-sent', (e) => e.d.key === '2:68:13:1');
    await ev(env, 'botfarm:spy-sent', (e) => e.d.key === '2:68:10:1');
    const lim = await ev(env, 'botfarm:skip', (e) => e.d.reason === 'limit');
    assert.ok(/атака|шпионаж/.test(lim.w), lim.w);
    await env.waitJournal('botcore:limit', { timeoutMs: 5000 });
    assert.equal(W.log.sent.length, 2, 'only the two espionage sends');
    assert.equal((await env.botStatus()).limits.fleetSends.used, 2);
    // more sends allowed, but one farm slot
    await env.setSettings({ 'botcore.maxFleetSendsPerHour': 30, 'botfarm.maxSlots': 1 });
    await kick(env);
    await ev(env, 'botfarm:attack-sent');
    const ms = await ev(env, 'botfarm:skip', (e) => e.d.reason === 'maxSlots');
    assert.equal(ms.d.maxSlots, 1);
    assert.equal(W.log.sent.filter((x) => x.mission === 1).length, 1, 'one attack');
    await decisionsFirst(env, '(f)');
    await clean(env, '(f)');
  } finally { await env.close(); }
}, { timeout: 300000 });

T.test('(g) slot reserve, sleep window, threat lock on the origin: nothing sent, every refusal journaled', async () => {
  const env = await B.launchBot({ world: 'botfarm-three', settings: BASE });
  try {
    const W = env.world;
    await env.game('galaxy', { query: { galaxy: 2, system: 68 } });
    const t0 = Date.now();
    // 1. slot reserve = all 13 slots
    await env.setSettings({ 'botcore.master': true, 'botcore.dryRun': false, 'botfarm.on': true, 'botcore.slotsReserve': 10, 'botcore.maxActionsPerHour': 2000 });
    W.player.extraSlots = -3;   // 1 + 12 - 3 = 10 slots, all reserved
    await leader(env);
    await kick(env);
    const sk = await ev(env, 'botfarm:skip', (e) => e.d.reason === 'slots');
    assert.equal(sk.d.reserve, 10);
    assert.equal(W.log.sent.length, 0);
    // 2. sleep window around the server time: the worker does not run at all
    const w = W.clock.wall();
    const hm = (m) => { const x = ((w.h * 60 + w.m + m) % 1440 + 1440) % 1440; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
    await env.setSettings({ 'botcore.slotsReserve': 1, 'botcore.sleepOn': true, 'botcore.sleepFrom': hm(-60), 'botcore.sleepTo': hm(60) });
    await env.until(async () => (await env.botStatus()).state === 'sleeping', { timeoutMs: 20000, label: 'sleeping' });
    const nSleep = (await env.journal({ kind: /^botfarm:/ })).length;
    await kick(env);
    await sleep(15000);
    const during = (await env.journal({ kind: /^botfarm:/ })).slice(nSleep);
    assert.deepEqual(during.map((e) => e.k + ' ' + e.w), [], 'asleep: no farm run');
    assert.equal(W.log.sent.length, 0);
    // 3. awake, but a hostile attack on the only body with probes and cargos: locked
    const h = W.addHostile({ toBodyId: HOME, mission: 1, ships: { 204: 500 }, ownerId: 3843, flightSec: 1800 });
    await env.setSettings({ 'botcore.sleepOn': false });
    await env.game('overview', { cp: HOME });
    await env.until(async () => (await env.evalOgx(await env.page(), () => Object.keys(OGX.bot.lockedBodies()))).includes('p' + HOME), { timeoutMs: 20000, label: 'lock' });
    await kick(env);
    const th = await ev(env, 'botfarm:skip', (e) => /шпионаж/.test(e.w) && e.d.origins && e.d.origins.some((o) => o.id === HOME && o.why === 'угроза'));
    assert.ok(th, 'origin locked by the threat ' + h.id);
    await sleep(3000);
    assert.equal(W.log.sent.length, 0, 'nothing sent');
    assert.deepEqual(env.mutating().filter((r) => r.t >= t0 && r.page !== 'galaxy').map((r) => r.method + ' ' + r.url), [], 'no POST / messages / fleetAjax');
    await decisionsFirst(env, '(g)');
    await clean(env, '(g)');
  } finally { await env.close(); }
}, { timeout: 300000 });
