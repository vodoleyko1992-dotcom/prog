'use strict';
// botexpo pure rules (no browser): module definition and C5 defaults, allowed colonisation positions (upstream allowPlanetPosition),
// staytime option by its hour text, slots min(expedition free, fleet free - reserve), dm / resources compositions, outcome mapping,
// stats incl. the F5 check, colonisation candidates (blacklist TTL, own coords), colonizer payload. Loaded in a vm sandbox with the
// real catalog (shared/core/08-catalog-data.js) and OGX.botSim; the F5 formula is re-checked against botSim.expeditionFind.
//   node tests/gz-bot-mod-botexpo.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib');
const { assert } = T;

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'ogamex-bot', 'modules', 'botexpo', 'botexpo.js');
const SIM = require(path.join(ROOT, 'ogamex-bot', 'modules', 'botsim', 'botsim.js'));
const CAT = SIM.loadCatalog(path.join(ROOT, 'shared', 'core', '08-catalog-data.js'));

function load() {
  const mods = [];
  const window = { OGX: { module: (def) => mods.push(def), botSim: SIM, catalog: CAT } };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { window, setTimeout, clearTimeout, console }, { filename: FILE });
  const L = {};
  for (const [k, v] of Object.entries(window.OGX.botExpo._lib)) L[k] = (...a) => { const r = v(...a); return r === undefined || r === null ? r : JSON.parse(JSON.stringify(r)); };
  return { L, mods: mods.map((m) => Object.assign({}, m, { settings: JSON.parse(JSON.stringify(m.settings)) })), OGX: window.OGX };
}

T.test('module definition: name, title, every contract C5 setting with its default, everything on (0.3.2)', () => {
  const { mods, OGX } = load();
  assert.equal(mods.length, 1);
  const m = mods[0];
  assert.equal(m.name, 'botexpo'); assert.equal(m.title, 'Бот: экспедиции и колонизация');
  const want = { on: true, expeditions: true, mode: 'dm', expoProbes: 5000, fleetShare: 0.1, ships: [], addCheapTypes: true, stayHours: 1, origins: [], betweenMinSec: 5, betweenMaxSec: 15,
    afterReturnMinSec: 3, afterReturnMaxSec: 15, dmValueMsu: 0, colonize: true, colonizeTargets: [], colonizeMinFields: {}, colonizePayload: true, buildColonizers: true,
    learnFleets: [{ ships: { 210: 1 } }, { ships: { 210: 100 } }, { ships: { 210: 2000 } }, { ships: { 210: 10000 } }, { ships: { 210: 1 }, stay: 2 }],
    learnMinTrips: 8, learnExplore: 0.1, keepProbes: 2000, probeBuild: true, probeStock: 0,
    dmHunt: true, dmShipsPerFleet: 60, dmMaxFleets: 0, dmTargets: [], dmBuild: true, dmStock: 400 };
  assert.deepEqual(Object.keys(m.settings).sort(), Object.keys(want).sort());
  for (const [k, v] of Object.entries(want)) assert.deepEqual(m.settings[k].default, v, k);
  assert.deepEqual(m.settings.mode.options.map((o) => o.value), ['dm', 'learn', 'auto', 'resources']);
  for (const [k, d] of Object.entries(m.settings)) assert.ok(/[а-яё]/i.test(d.label), 'russian label ' + k);
  assert.equal(OGX.botExpo.version, '1.1.2');
  assert.equal(typeof m.init, 'function');
});

T.test('allowed positions = upstream PlayerUtil::allowPlanetPosition (1/15 >= 8, 2/14 >= 6, 3/13 >= 4, else >= 1)', () => {
  const { L } = load();
  const allowed = (a) => Array.from({ length: 15 }, (_, i) => i + 1).filter((p) => L.allowedPosition(p, a));
  assert.deepEqual(allowed(0), []);
  assert.deepEqual(allowed(1), [4, 5, 6, 7, 8, 9, 10, 11, 12], 'astro 1-3: 4..12 (TBot would allow nothing)');
  assert.deepEqual(allowed(4), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(allowed(6), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.deepEqual(allowed(8), Array.from({ length: 15 }, (_, i) => i + 1));
  assert.equal(L.allowedPosition(16, 20), false, '16 is the expedition position');
});

T.test('staytime: the option whose hour TEXT equals stayHours, else the smallest (never the key)', () => {
  const { L } = load();
  const half = [1, 2, 3, 4].map((v) => ({ value: v, hours: v / 2 }));   // haltSpeed 2: texts 0.5 1 1.5 2
  assert.deepEqual(L.pickStay(half, 1), { option: { value: 2, hours: 1 }, exact: true });
  assert.deepEqual(L.pickStay(half, 0.75), { option: { value: 1, hours: 0.5 }, exact: false });
  assert.deepEqual(L.pickStay([{ value: 3, hours: 0.03 }, { value: 1, hours: 0.01 }], 5), { option: { value: 1, hours: 0.01 }, exact: false });
  assert.equal(L.pickStay([], 1), null);
});

T.test('slots: min(expedition free, fleet free - reserve)', () => {
  const { L } = load();
  assert.deepEqual(L.slotsToSend({ fleet: { used: 3, max: 13 }, expedition: { used: 1, max: 3 } }, 1), { n: 2, expFree: 2, fleetFree: 9 });
  assert.deepEqual(L.slotsToSend({ fleet: { used: 1, max: 2 }, expedition: { used: 0, max: 2 } }, 1), { n: 0, expFree: 2, fleetFree: 0 });
  assert.deepEqual(L.slotsToSend({ fleet: { used: 0, max: 2 }, expedition: { used: 0, max: 2 } }, 1), { n: 1, expFree: 2, fleetFree: 1 });
  assert.equal(L.slotsToSend(null, 1).n, 0, 'unknown slots: nothing');
});

T.test('compositions: dm = cheapest flyable (210, else 202 when 15 was not offered); resources = 217 only, share split over slots, + 1 probe', () => {
  const { L } = load();
  assert.equal(L.dmShip({ 210: 5, 202: 3 }), 210);
  assert.equal(L.dmShip({ 210: 5, 202: 3 }, { probeOk: { 210: false } }), 202, 'step 2 did not offer 15 for the probe');
  assert.equal(L.dmShip({ 203: 9 }), null);
  // John's rule: resources mode carries in Battle Transporters 217 only (202/203 never, no fallback); + 1 probe for ship finds
  assert.deepEqual(L.resourcesFleet({ 202: 300, 203: 150, 217: 30, 210: 50, 204: 99 }, { share: 0.1, slots: 3 }), { 217: 1, 210: 1 });
  assert.deepEqual(L.resourcesFleet({ 217: 150, 202: 1, 210: 1 }, { share: 0.1, slots: 3 }), { 217: 5, 210: 1 }, '+1 probe for ship finds, never a light cargo');
  assert.deepEqual(L.resourcesFleet({ 217: 150 }, { share: 0.1, slots: 3, addCheap: false }), { 217: 5 });
  assert.equal(L.resourcesFleet({ 217: 5 }, { share: 0.1, slots: 3 }), null, 'share rounds to 0 ships');
  assert.equal(L.resourcesFleet({ 202: 300, 203: 150, 210: 50 }, { share: 0.1, slots: 3 }), null, 'no 217: no resources fleet (no 202/203 fallback)');
  assert.deepEqual(L.resourcesFleet({ 205: 100, 217: 100 }, { share: 0.5, slots: 2, ids: [205, 217], addCheap: false }), { 217: 25 }, 'a user list is cut to 217');
  assert.equal(L.resourcesFleet({ 205: 100, 203: 100 }, { share: 0.5, slots: 2, ids: [205, 203], addCheap: false }), null, 'a user list without 217 sends nothing');
  // F5: the find limit for these fleets = min(free base cargo, sum(M+C)) (botSim.expeditionFind)
  const f = SIM.expeditionFind({ ships: { 203: 5, 210: 1 } });
  assert.equal(f.max, Math.min(5 * 25000 + 5, 5 * 12000 + 1000));
});

T.test('outcomes: parse.expedition outcome names -> stats buckets; stats count events and compare finds with the F5 limit', () => {
  const { L } = load();
  const map = { resources: 'resources', darkmatter: 'darkMatter', ships: 'ships', nothing: 'nothing', delay: 'time', speedup: 'time', battle_pirates: 'battle', battle_aliens: 'battle', fleet_lost: 'blackHole', '': 'unknown' };
  for (const [k, v] of Object.entries(map)) assert.equal(L.outcomeOf({ outcome: k }), v, k);
  assert.equal(L.outcomeOf({ outcome: 'unknown', key: 'expedition_loss_of_fleet' }), 'unknown', 'outcome wins over key');
  assert.equal(L.outcomeOf({ key: 'expedition_loss_of_fleet' }), 'blackHole');
  let s = L.emptyStats();
  const trip = { ships: { 210: 1 }, sentAt: 1, stayEnd: 2, back: 3, outcome: 'resources', expectedFind: { free: 5, points: 5, max: 5 } };
  s = L.addOutcome(s, trip, 'resources');
  s = L.addAmounts(s, trip, { metal: 5, crystal: 0, deuterium: 0, darkMatter: 0 });
  s = L.addOutcome(s, { ships: { 202: 1 }, stayEnd: 4 }, 'blackHole');
  s = L.addAmounts(s, { outcome: 'darkMatter' }, { metal: 0, crystal: 0, deuterium: 0, darkMatter: 250 });
  assert.equal(s.trips, 2); assert.equal(s.outcomes.resources, 1); assert.equal(s.outcomes.blackHole, 1);
  assert.deepEqual(s.lostShips, { 202: 1 });
  assert.equal(s.finds.length, 1); assert.equal(s.finds[0].ratio, 1); assert.equal(s.finds[0].sumMC, 1000);
  assert.equal(s.dm, 250); assert.equal(s.found.metal, 5);
});

T.test('colonisation candidates: ranges in position order, allowed by 124, own coordinates and live blacklist entries skipped; payload metal then crystal', () => {
  const { L } = load();
  const targets = [{ galaxy: 2, systems: [68, 69], positions: [10, 1, 9] }, '3:100:8'];
  const c = L.colonizeCandidates(targets, { astro: 6, own: new Set(['2:68:9']), black: { '2:69:10': { until: 2000 }, '2:69:9': { until: 500 } }, now: 1000 });
  assert.deepEqual(c.map((x) => x.coords), ['2:68:10', '2:69:9', '3:100:8'], 'pos 1 needs 124 >= 8; own 2:68:9; 2:69:10 blacklisted; an expired entry is ignored');
  assert.deepEqual(L.colonizeCandidates([{ galaxy: 2, systems: [5, 5] }], { astro: 1 }).map((x) => x.position), [8, 7, 9, 6, 10], 'default position order');
  assert.deepEqual(L.colonizePayload(7500 - 118, { metal: 5000, crystal: 9e9 }), { metal: 5000, crystal: 2382, deuterium: 0 });
  assert.deepEqual(L.colonizePayload(7382, { metal: 9e9, crystal: 9e9 }), { metal: 7382, crystal: 0, deuterium: 0 });
  assert.equal(L.expoTarget('2:68:5').position, 16);
});


T.test('messages: a (cached) list read before the awaited message is read again with fresh:true; retries never take the cache', async () => {
  const { OGX } = load();
  const readMessages = OGX.botExpo._lib.readMessages;
  const t = 1_800_000_000_000;
  const acts = []; const answers = [];
  const wctx = { now: () => t, act: async (spec) => { acts.push(JSON.parse(JSON.stringify(spec))); return answers.shift() || { ok: true, at: t, data: {} }; } };
  answers.push({ ok: true, at: t - 40000, data: {} }, { ok: true, at: t, data: {} });
  const r = await readMessages(wctx, 15, 'Экспедиции: отчёты', { notBefore: t - 20000 });
  assert.equal(r.at, t, 'the fresh answer is used');
  assert.deepEqual(acts.map((a) => [a.type, a.params.cat, !!a.fresh]), [['read.messages', 15, false], ['read.messages', 15, true]]);
  acts.length = 0;
  answers.push({ ok: true, at: t - 10000, data: {} });
  await readMessages(wctx, 4, 'Экспедиции: возврат флота', { notBefore: t - 20000 });
  assert.equal(acts.length, 1, 'read after the event: used as is');
  acts.length = 0;
  await readMessages(wctx, 4, 'Экспедиции: возврат флота', { fresh: true });
  assert.deepEqual(acts.map((a) => !!a.fresh), [true]);
  acts.length = 0;
  answers.push({ ok: false, dry: true, refused: 'dryRun', at: t - 99999 });
  await readMessages(wctx, 4, 'x', { notBefore: t });
  assert.equal(acts.length, 1, 'dry-run / refusal: no second read');
});

T.test('mode dm composition: expoProbes probes above keepProbes, never a probe out of the reserve (null -> skip), 1x202 only when no probe is there at all or step 2 refused 15 to a probe', () => {
  const { L } = load();
  assert.equal(L.dmComposition({ 210: 1500 }, { want: 5000, keep: 2000 }), null, 'below the reserve: nothing (was 1 probe)');
  assert.deepEqual(L.dmComposition({ 210: 7000 }, { want: 5000, keep: 2000 }), { 210: 5000 });
  assert.deepEqual(L.dmComposition({ 210: 3000 }, { want: 5000, keep: 2000 }), { 210: 1000 });
  assert.equal(L.dmComposition({ 210: 2000 }, { want: 5000, keep: 2000 }), null, 'exactly the reserve: nothing');
  assert.deepEqual(L.dmComposition({ 210: 1 }, { want: 1, keep: 0 }), { 210: 1 });
  assert.deepEqual(L.dmComposition({ 210: 50 }, { want: 1, keep: 0 }), { 210: 1 }, 'expoProbes 1');
  assert.equal(L.dmComposition({ 210: 1500, 202: 5 }, { want: 5000, keep: 2000 }), null, 'reserved probes are not replaced by a 202');
  assert.deepEqual(L.dmComposition({ 202: 5 }, { want: 5000, keep: 2000 }), { 202: 1 }, 'no probe at all: the documented 1x202 fallback');
  assert.deepEqual(L.dmComposition({ 210: 5, 202: 3 }, { want: 5000, keep: 0, probeOk: { 210: false } }), { 202: 1 }, 'step 2 refused 15 to the probe: 1x202');
  assert.equal(L.dmComposition({ 203: 9 }, { want: 5000, keep: 0 }), null);
});

T.test('result schedule (resultDue): first read 20 s after the event and only after a full-page request since it (else wait 30 s, after 45 s a page request of our own), retries 30 s x n, give up after 6 reads or 15 min', () => {
  const { L } = load();
  const E = 1800000000000;
  const d = (o) => L.resultDue(Object.assign({ eventAt: E }, o));
  assert.deepEqual(d({ now: E + 5000 }), { read: false, force: false, giveUp: false, nextAt: E + 20000 }, 'too early');
  assert.deepEqual(d({ now: E + 20000 }), { read: true, force: false, giveUp: false, nextAt: E + 20000 }, 'no page clock known: read');
  assert.deepEqual(d({ now: E + 20000, pageAt: E + 1000 }), { read: true, force: false, giveUp: false, nextAt: E + 20000 }, 'a page request after the event: read');
  assert.deepEqual(d({ now: E + 20000, pageAt: E - 1000 }), { read: false, force: false, giveUp: false, nextAt: E + 45000 }, 'no page request since the event: the report does not exist yet, wait (30 s, at most until 45 s after it)');
  assert.deepEqual(d({ now: E + 30000, pageAt: E - 1000 }), { read: false, force: false, giveUp: false, nextAt: E + 45000 }, '... until 45 s after the event');
  assert.deepEqual(d({ now: E + 45000, pageAt: E - 1000 }), { read: true, force: true, giveUp: false, nextAt: E + 20000 }, 'then a page request of our own first');
  assert.deepEqual(d({ now: E + 40000, tries: 1, nextAt: E + 50000 }), { read: false, force: false, giveUp: false, nextAt: E + 50000 }, 'a retry not before its time');
  assert.equal(d({ now: E + 50000, tries: 1, nextAt: E + 50000 }).read, true);
  assert.equal(d({ now: E + 50000, tries: 6, nextAt: E + 50000 }).giveUp, true, 'six reads: give up (the trip is closed as unread, never flying forever)');
  assert.equal(d({ now: E + 15 * 60000 + 1, tries: 2 }).giveUp, true, '15 min after the event: give up');
  assert.equal(d({ now: E, eventAt: 0 }).nextAt, null, 'no event time: nothing to plan');
});

T.test('message <-> trip matching: by date FIFO, the nearest unresolved trip within +-5 s; a missing report never lets a trip claim its neighbour\'s (trips 4 s apart)', () => {
  const { OGX } = load();
  const assign = OGX.botExpo._lib.assignByTime;
  const A = { id: 'a', stayEnd: 1000000 }; const Bt = { id: 'b', stayEnd: 1004000 };
  let m = assign([{ ts: 1004000, id: 'm2' }], [A, Bt], (x) => x.stayEnd);
  assert.equal(m.get(Bt).id, 'm2'); assert.ok(!m.has(A), 'only B\'s report present: A stays unresolved');
  m = assign([{ ts: 1004000, id: 'm2' }, { ts: 1000000, id: 'm1' }], [A, Bt], (x) => x.stayEnd);
  assert.equal(m.get(A).id, 'm1'); assert.equal(m.get(Bt).id, 'm2');
  m = assign([{ ts: 1002000, id: 'm1' }], [A, Bt], (x) => x.stayEnd);
  assert.equal(m.get(A).id, 'm1', 'equal distance: the earlier trip');
  m = assign([{ ts: 1010000, id: 'x' }], [A, Bt], (x) => x.stayEnd);
  assert.equal(m.size, 0, 'outside +-5 s: nobody');
  m = assign([{ ts: 1010000, id: 'x' }], [A, Bt], (x) => x.stayEnd, (x, r) => x === Bt && Math.abs(r.ts - x.stayEnd) <= 10000);
  assert.equal(m.get(Bt).id, 'x', 'a trip with its own wider tolerance (time shift)');
});

T.test('time shift (upstream MissionCaseExpedition event 6): a delay returns at end_stay + back leg + stay + 2 s (one stay later than planned); a speed-up lands at the next run of the fleet handler', () => {
  const { L } = load();
  const H = 3600000;
  const x = { arrival: 10 * H, stayEnd: 11 * H, back: 11.5 * H, stayHours: 1, sentAt: 9.5 * H };
  const d = L.shiftedBack(x, 'delay', 11 * H + 10000);
  assert.equal(d.kind, 'delay'); assert.equal(d.back, 11 * H + 0.5 * H + 1 * H + 2000, 'planned back + stay + 2 s'); assert.equal(d.tol, 5000);
  const s = L.shiftedBack(x, 'speedup', 11 * H + 10000);
  assert.equal(s.kind, 'speedup'); assert.equal(s.back, 11 * H + 10000 + 1000); assert.equal(s.tol, 120000);
  const noTimes = L.shiftedBack({ stayEnd: 11 * H, stayHours: 2 }, 'delay', 0);
  assert.equal(noTimes.back, 11 * H + 2 * H + 2000, 'without the exact times: the configured stay, no back leg known');
});

T.test('view after a send (no page read before the next fleet): ships minus the fleet, the fleet slot (+ the expedition slot) taken; probes of fleet rows by name, by id, spy amount', () => {
  const { L } = load();
  const ft = { t: 5, ships: { 210: 7000, 202: 3 }, slots: { fleet: { used: 2, max: 10 }, expedition: { used: 1, max: 4 } }, flights: [1] };
  assert.deepEqual(L.viewAfterSend(ft, { 210: 5000 }, { expedition: true }), { t: 5, ships: { 210: 2000, 202: 3 }, slots: { fleet: { used: 3, max: 10 }, expedition: { used: 2, max: 4 } }, flights: [1], view: true });
  assert.deepEqual(L.viewAfterSend(ft, { 202: 3 }, { expedition: false, t: 9 }).slots, { fleet: { used: 3, max: 10 }, expedition: { used: 1, max: 4 } }, 'mission 11: no expedition slot');
  assert.equal(L.viewAfterSend(ft, { 202: 3 }).ships[202], undefined, 'none left: the type disappears');
  assert.equal(L.probesIn({ missionId: 15, ships: { 'Espionage Probe': 30, 'Light Cargo': 2 } }), 30);
  assert.equal(L.probesIn({ missionId: 6, ships: { 'Шпионский зонд': 1100 } }), 1100);
  assert.equal(L.probesIn({ missionId: 6, amount: 50, ships: {} }), 50, 'no ship list: a spy fleet is probes only');
  assert.equal(L.probesIn({ missionId: 15, amount: 50, ships: {} }), 0);
  assert.equal(L.probesIn({ missionType: 15, ships: { 210: 12 } }), 12, 'flight cache: by id');
});

T.test('fleet page rows of returning expeditions: a trip home on time keeps its return, the row of a delayed neighbour goes to the delayed trip (smallest distance to the shifted return), never to a trip that already came home', () => {
  const { OGX } = load();
  const M = OGX.botExpo._M;
  const S = 1000;
  // A (sent first) came home on time at 585 s; B is delayed: planned 588 s, real return 588 + stay 36 + 2 = 626 s
  const mk = (id, arrival) => ({ id, fleetId: id, origin: 1, originCoords: '2:68:5', ships: { 210: 1 }, arrival: arrival * S, stayEnd: (arrival + 36) * S, back: (arrival + 41) * S, done: false });
  M.trips = { a: mk('a', 544), b: mk('b', 547) };
  const recs = [];
  const wctx = { now: () => 600 * S, rec: (k, w, d) => recs.push({ k, w, d }) };
  const row = (t) => ({ missionId: 15, returning: true, timerUnix: t, origin: '2:68:5', ships: {} });
  OGX.botExpo._lib.noteFleetRows(wctx, { id: 1, coords: '2:68:5' }, [row(626)]);
  assert.equal(M.trips.a.back, 585 * S, 'A keeps its planned return (it is home)');
  assert.equal(M.trips.a.timeShift, undefined);
  assert.equal(M.trips.b.back, 626 * S, 'B takes the row: ' + M.trips.b.back);
  assert.equal(M.trips.b.timeShift, 'delay'); assert.equal(M.trips.b.shiftSeen, 'fleetTable');
  // a row at the expected return of a trip is that trip's (first pass), the delayed one gets the other row
  M.trips = { a: mk('a', 544), b: mk('b', 547) };
  OGX.botExpo._lib.noteFleetRows({ now: () => 580 * S, rec() {} }, { id: 1, coords: '2:68:5' }, [row(626), row(585)]);
  assert.equal(M.trips.a.back, 585 * S); assert.ok(!M.trips.a.timeShift, 'A confirmed on time');
  assert.equal(M.trips.b.back, 626 * S, 'B delayed');
});

T.test('probes away from an origin: live trips until their return or the fleet rows (whichever is larger) + spy flights; the flight cache counts a fleet once (outward, hold end and return legs) and only for its home', () => {
  const { OGX } = load();
  const M = OGX.botExpo._M;
  const pf = OGX.botExpo._lib.probesFlying;
  const o = { id: 1, key: 'p1', coords: '2:68:5' };
  M.trips = { a: { id: 'a', origin: 1, ships: { 210: 30 }, back: 2000, done: false }, b: { id: 'b', origin: 1, ships: { 210: 30 }, back: 500, done: false },
    c: { id: 'c', origin: 2, ships: { 210: 99 }, back: 2000, done: false } };
  assert.deepEqual(JSON.parse(JSON.stringify(pf(o, null, 1000, []))), { total: 30, expo: 30, spy: 0 }, 'b is back (its probes are home), c is another origin');
  const spy = [
    { own: true, realMissionId: 7, fleetId: 7, missionType: 6, returnFlight: false, originKey: 'p1', destKey: null, ships: { 210: 20 } },
    { own: true, realMissionId: 7, fleetId: 7, missionType: 6, returnFlight: true, originKey: null, destKey: 'p1', ships: { 210: 20 } },
    { own: true, realMissionId: 8, fleetId: 8, missionType: 6, returnFlight: false, originKey: 'p2', destKey: null, ships: { 210: 500 } },
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(pf(o, null, 1000, spy))), { total: 50, expo: 30, spy: 20 }, 'the spy fleet once, another planet\'s not');
  const ft = { flights: [{ missionId: 15, origin: '2:68:5', ships: { 'Шпионский зонд': 60 } }, { missionId: 6, origin: '2:68:5', amount: 20, ships: {} }] };
  assert.deepEqual(JSON.parse(JSON.stringify(pf(o, ft, 1000, spy))), { total: 80, expo: 60, spy: 20 }, 'fleet rows show more expedition probes than the live trips (a closed trip)');
});
