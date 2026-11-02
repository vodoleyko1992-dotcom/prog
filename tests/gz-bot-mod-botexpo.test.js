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
