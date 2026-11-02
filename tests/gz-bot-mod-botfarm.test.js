'use strict';
// botfarm: module unit checks (node sandbox, the file as the extension loads it) + the safety gates in the WORLD mock.
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
    maxFlightSec: 7200, maxFuelShare: 0.1, maxReportAgeMin: 30, escort: true, escortLeadSec: 60, recallOnChange: true, winMin: 0.99, minWin: 0.8, mixedFleet: true, maxLossShare: 0.25,
    simRuns: 60, surplusPct: 10, partialLoot: true, minLootShare: 0.5, maxSlots: 3, buildShips: true, buildMaxWaitMin: 30, regrowRespy: true, needFleetPauseH: 6, dbKeepDays: 14,
    maxProbeRetries: 2, useFleetAjax: true, deleteReports: true, targetsPerCycle: 10, exclude: [] };
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

// ------------------------------------------------------------------ browser gates
const HOME = 254102;
const OTHER_BOT = ['botsave', 'botdebris', 'botbuild', 'botexpo'];
const BASE = Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])),
  { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.userIdleSec': 0, 'botfarm.minLoot': 100000, 'botfarm.escort': false });
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
