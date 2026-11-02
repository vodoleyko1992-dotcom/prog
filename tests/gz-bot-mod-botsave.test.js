'use strict';
// botsave pure rules (no browser): payload, silo math, interceptor count, hypotheses (cascade, speeds, fuel), recall moment and
// the threat filters, from OGX.botSave exported by ogamex-bot/modules/botsave/botsave.js loaded in a sandbox.
//   node tests/gz-bot-mod-botsave.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib');
const { assert } = T;

const FILE = path.join(__dirname, '..', 'ogamex-bot', 'modules', 'botsave', 'botsave.js');
function load() {
  const mods = [];
  const window = { OGX: { module: (def) => mods.push(def) } };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { window, setTimeout, clearTimeout, console }, { filename: FILE });
  // results cross the vm realm: clone them into this realm for deepStrictEqual
  const S = {};
  for (const [k, v] of Object.entries(window.OGX.botSave)) S[k] = typeof v === 'function' ? (...a) => { const r = v(...a); return r === undefined ? r : JSON.parse(JSON.stringify(r)); } : v;
  return { S, mods: mods.map((m) => Object.assign({}, m, { settings: JSON.parse(JSON.stringify(m.settings)) })) };
}
const PRICES = { 202: [2000, 2000, 0], 204: [3000, 1000, 0], 207: [45000, 15000, 0], 210: [0, 1000, 0], 401: [2000, 0, 0], 402: [1500, 500, 0] };
const catalog = (id) => (PRICES[id] ? { price: { metal: PRICES[id][0], crystal: PRICES[id][1], deuterium: PRICES[id][2] } } : null);
const cfgOf = (o) => (k) => (k in o ? o[k] : { whitelist: [], abm: true, ignoreProbes: true, defense: true, weakIgnore: false, weakRatio: 3, minFleetPoints: 0 }[k]);

T.test('module definition: name, title, every contract C5 setting with its default, everything on (0.3.2)', () => {
  const { mods, S } = load();
  assert.equal(mods.length, 1);
  const m = mods[0];
  assert.equal(m.name, 'botsave'); assert.equal(m.title, 'Бот: сейв флота и защита');
  const want = { on: true, defense: true, ignoreProbes: true, weakIgnore: false, weakRatio: 3, whitelist: [], minFleetPoints: 0, saveLeadMinSec: 30, saveLeadMaxSec: 90,
    marginPct: 30, deutToLeave: 0, missionOrder: ['deploy', 'transport', 'harvest', 'expedition'], moonsFirst: true, recall: true, recallJitterMinSec: 40,
    recallJitterMaxSec: 140, abm: true, spyAttacker: true, sleepSave: true, sleepSaveOnlyMoons: true, sleepDeutToLeave: 0, resSave: true };
  assert.deepEqual(Object.keys(m.settings).sort(), Object.keys(want).sort());
  for (const [k, v] of Object.entries(want)) assert.deepEqual(m.settings[k].default, v, k);
  for (const [k, d] of Object.entries(m.settings)) assert.ok(/[а-яё]/i.test(d.label), 'russian label ' + k);
  assert.equal(S.version, '1.0.0');
});

T.test('payload: all M/C and deuterium minus fuel when it fits; D > C > M when the hold is short; resSave off -> empty', () => {
  const { S } = load();
  assert.deepEqual(S.payload({ stock: { metal: 300, crystal: 200, deuterium: 100 }, fuel: 15, fleetroom: 10000 }), { metal: 300, crystal: 200, deuterium: 85 });
  assert.deepEqual(S.payload({ stock: { metal: 300, crystal: 200, deuterium: 100 }, fuel: 15, fleetroom: 10000, deutKeep: 50 }), { metal: 300, crystal: 200, deuterium: 35 });
  // room = 250 - 15 = 235: deuterium 85 first, crystal 150, metal 0
  assert.deepEqual(S.payload({ stock: { metal: 300, crystal: 200, deuterium: 100 }, fuel: 15, fleetroom: 250 }), { metal: 0, crystal: 150, deuterium: 85 });
  assert.deepEqual(S.payload({ stock: { metal: 300, crystal: 200, deuterium: 100 }, fuel: 15, fleetroom: 400 }), { metal: 100, crystal: 200, deuterium: 85 });
  assert.deepEqual(S.payload({ stock: { metal: 3, crystal: 2, deuterium: 1 }, fuel: 15, fleetroom: 400 }), { metal: 3, crystal: 2, deuterium: 0 });
  assert.deepEqual(S.payload({ stock: { metal: 300, crystal: 200, deuterium: 100 }, fuel: 15, fleetroom: 400, resSave: false }), { metal: 0, crystal: 0, deuterium: 0 });
  // resources ride only in 217: room = min(fleetroom - fuel, count(217) x 217 cargo); no 217 -> nothing (big 203 hold ignored)
  assert.deepEqual(S.payload({ stock: { metal: 300, crystal: 200, deuterium: 100 }, fuel: 15, fleetroom: 25000000, transportRoom: 0 }), { metal: 0, crystal: 0, deuterium: 0 });
  assert.deepEqual(S.payload({ stock: { metal: 300, crystal: 200, deuterium: 100 }, fuel: 15, fleetroom: 25000000, transportRoom: 235 }), { metal: 0, crystal: 150, deuterium: 85 });
  assert.deepEqual(S.payload({ stock: { metal: 300, crystal: 200, deuterium: 100 }, fuel: 15, fleetroom: 250, transportRoom: 40000000 }), { metal: 0, crystal: 150, deuterium: 85 });
});

T.test('silo math: silo·10·max(factor,1) - 502 - 2·503 - queued; interceptor count = min(free, needed, affordable, in time)', () => {
  const { S } = load();
  assert.equal(S.siloFree({ silo: 3, abm: 10, ipm: 5 }), 10);
  assert.equal(S.siloFree({ silo: 3, abm: 10, ipm: 5, queuedAbm: 4, queuedIpm: 1 }), 4);
  assert.equal(S.siloFree({ silo: 3, abm: 10, ipm: 5, siloFactor: 2 }), 40);
  assert.equal(S.siloFree({ silo: 3, abm: 10, ipm: 5, siloFactor: 0 }), 10, 'factor below 1 counts as 1');
  assert.equal(S.siloFree({ silo: 1, abm: 10 }), 0);
  const stock = { metal: 1e9, crystal: 0, deuterium: 1e9 };
  assert.equal(S.abmCount({ free: 10, needed: 15, stock, perUnitSec: 1, secondsLeft: 100 }), 10);
  assert.equal(S.abmCount({ free: 10, needed: 4, stock, perUnitSec: 1, secondsLeft: 100 }), 4);
  assert.equal(S.abmCount({ free: 10, needed: 15, stock: { metal: 24000, deuterium: 1e9 }, perUnitSec: 1, secondsLeft: 100 }), 3, '3 x 8000 metal');
  assert.equal(S.abmCount({ free: 10, needed: 15, stock: { metal: 1e9, deuterium: 5000 }, perUnitSec: 1, secondsLeft: 100 }), 2, '2 x 2000 deuterium');
  assert.equal(S.abmCount({ free: 10, needed: 15, stock, perUnitSec: 20, queueSec: 40, secondsLeft: 100 }), 3, '(100 - 40) / 20');
  assert.equal(S.abmCount({ free: 10, needed: 15, stock, perUnitSec: 200, secondsLeft: 100 }), 0, 'never finishes before the impact');
});

T.test('hypotheses: first speed 10..1 reaching the threshold, fuel limits, moons first, deploy landing fallback, circular needs half', () => {
  const { S } = load();
  // duration = base[target] / speed·10, fuel = speed·k
  const base = { moon: 600, far: 3000, near: 400 };
  const flight = (t, sp) => ({ duration: base[t.k] * 10 / (sp * 10) * (11 - sp) / 1, fuel: sp * (t.k === 'far' ? 100 : 10) });
  const cands = [
    { mission: 4, target: { k: 'far' }, group: 1, label: 'planet' },
    { mission: 4, target: { k: 'moon' }, group: 0, label: 'moon' },
    { mission: 3, target: { k: 'near' }, group: 2, label: 'transport' },
  ];
  const hs = S.hypotheses({ candidates: cands, flight, minFlightSec: 300, deutLimit: 1e9, fleetroom: 1e9 });
  assert.deepEqual(hs.map((h) => h.label), ['moon', 'planet', 'transport'], 'group order: moons, planets, transport');
  // moon: duration(sp) = 600/sp*(11-sp): sp10 -> 60, sp9 -> 133, sp8 -> 225, sp7 -> 342 >= 300 -> speed 7
  assert.equal(hs[0].speed, 7); assert.equal(hs[0].landing, false);
  // transport (circular): needs 150 s: near 400/sp*(11-sp): sp10 40, sp9 88.9, sp8 150 -> speed 8
  assert.equal(hs[2].speed, 8); assert.equal(hs[2].need, 150);
  // fuel limit: speed 7 to the moon costs 70; with deutLimit 50 the moon gets speed 5 (5·10=50, duration 720)
  const lim = S.hypotheses({ candidates: [cands[1]], flight, minFlightSec: 300, deutLimit: 50, fleetroom: 1e9 });
  assert.equal(lim[0].speed, 5);
  // threshold unreachable: deploy lands (longest affordable), transport is dropped
  const land = S.hypotheses({ candidates: cands, flight, minFlightSec: 1e6, deutLimit: 1e9, fleetroom: 1e9 });
  assert.deepEqual(land.map((h) => [h.label, h.landing, h.speed]), [['moon', true, 1], ['planet', true, 1]]);
  // a landing on the moon comes after a planet that reaches the threshold, before the expedition
  const mixed = S.hypotheses({ candidates: [{ mission: 4, target: { k: 'near' }, group: 0, label: 'moon' }, { mission: 4, target: { k: 'far' }, group: 1, label: 'planet' },
    { mission: 15, target: { k: 'far' }, group: 3, label: 'expo', risky: true }], flight, minFlightSec: 5000, deutLimit: 1e9, fleetroom: 1e9 });
  assert.deepEqual(mixed.map((h) => [h.label, h.landing]), [['planet', false], ['moon', true], ['expo', false]]);
  // same group: sorted by fuel, then shorter duration
  const g = S.hypotheses({ candidates: [{ mission: 4, target: { k: 'far' }, group: 0, label: 'far' }, { mission: 4, target: { k: 'moon' }, group: 0, label: 'moon' }], flight, minFlightSec: 300, deutLimit: 1e9, fleetroom: 1e9 });
  assert.deepEqual(g.map((h) => h.label), ['moon', 'far']);
  assert.equal(S.minOneWay(4, 100), 100); assert.equal(S.minOneWay(3, 100), 50); assert.equal(S.minOneWay(8, 100), 50);
});

T.test('recall moment: start + oneWay/2 + jitter, moved so the fleet lands home after the horizon, never at/after arrival - 5 s', () => {
  const { S } = load();
  const r = S.recallAt({ start: 0, destArrival: 100000, jitterMs: 2000, horizon: 30000 });
  assert.equal(r.at, 52000);
  const moved = S.recallAt({ start: 0, destArrival: 100000, jitterMs: 2000, horizon: 160000 });
  assert.equal(moved.at, 82000, 'home = 2R - start = horizon + 4 s (whole-second margin)');
  const late = S.recallAt({ start: 0, destArrival: 100000, jitterMs: 2000, horizon: 200000 });
  assert.equal(late.at, null); assert.equal(late.reason, 'late');
  assert.equal(S.recallAt({ start: 0, destArrival: 10000, jitterMs: 4000, horizon: 0 }).at, null, 'jitter past arrival - 5 s');
});

T.test('threat filters in order: whitelist -> missiles -> espionage -> weak (only known composition) -> nothing to lose -> save', () => {
  const { S } = load();
  const th = (o) => Object.assign({ key: 'k', bodyKey: 'p1', mission: 1, ships: { 204: 10 }, units: 10, ownerId: 3843, ownerName: 'Jon', probesOnly: false }, o);
  const c = (t, cfg = {}, ourPoints = null) => S.classify(th(t), { cfg: cfgOf(cfg), ourPoints, catalog });
  assert.equal(c({}).decision, 'save');
  assert.equal(c({}, { whitelist: ['3843'] }).filter, 'whitelist');
  assert.equal(c({}, { whitelist: ['Jon Snow'] }).filter, 'whitelist', 'one-word stored name: first word of the entry');
  assert.equal(c({ ownerName: 'Jon Snow', ownerId: null }, { whitelist: ['jon snow'] }).filter, 'whitelist', 'full name (botcore reads names with spaces)');
  assert.equal(c({ ownerName: 'Jon Snow', ownerId: null }, { whitelist: ['Jon'] }).decision, 'save', 'a first word alone never whitelists a longer name');
  assert.equal(c({ mission: 10, ships: { 503: 5 } }, { whitelist: ['3843'] }).filter, 'whitelist', 'whitelist before missiles');
  assert.equal(c({ mission: 10, ships: { 503: 5 } }).decision, 'abm');
  assert.equal(c({ mission: 10, ships: { 503: 5 } }, { abm: false }).decision, 'notify');
  assert.equal(c({ mission: 6, ships: { 210: 3 }, probesOnly: true }).filter, 'probes');
  assert.equal(c({ mission: 6, ships: { 210: 3 }, probesOnly: true }, { ignoreProbes: false }).decision, 'save');
  const ours = { fleet: 2000, defense: 500, res: 1000 };
  // attacker 10 x 204 = 40 points < 2500 / 3
  assert.equal(c({}, {}, ours).decision, 'save', 'weakIgnore off');
  assert.equal(c({}, { weakIgnore: true }, ours).filter, 'weak');
  assert.equal(c({ ships: { 204: 10 }, units: 500 }, { weakIgnore: true }, ours).decision, 'save', 'unknown part of the composition: never weak');
  assert.equal(c({ ships: null, units: 10 }, { weakIgnore: true }, ours).decision, 'save', 'unknown composition: never weak');
  assert.equal(c({ ships: { 207: 100 } }, { weakIgnore: true }, ours).decision, 'save', '6000 points is not weak');
  assert.equal(c({}, { minFleetPoints: 5000 }, ours).filter, 'nothing');
  assert.equal(c({}, { minFleetPoints: 500 }, ours).decision, 'save');
  assert.equal(c({ bodyKey: null }).decision, 'ignore');
  assert.equal(S.pointsOf({ 204: 10, 401: 2 }, catalog), 44);
});

T.test('spy the attacker: probes = the suite setting spy.probes (OGX.api.spyProbes, else OGX.settings, default 1100) — no module count', () => {
  const run = (OGX) => {
    const window = { OGX: Object.assign({ module: () => {} }, OGX) };
    vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { window, setTimeout, clearTimeout, console }, { filename: FILE });
    return window.OGX.botSave.spyProbesSetting();
  };
  assert.equal(run({ api: { spyProbes: () => 777 } }), 777, 'OGX.api.spyProbes');
  assert.equal(run({ settings: { get: (k) => (k === 'spy.probes' ? '42' : undefined) } }), 42, 'OGX.settings spy.probes');
  assert.equal(run({ settings: { get: () => undefined } }), 1100, 'unset: 1100');
  assert.equal(run({}), 1100, 'no settings: 1100');
  const src = fs.readFileSync(FILE, 'utf8');
  assert.ok(!/210\]?:\s*3\b|probes\s*[:=]\s*3\b/.test(src), 'no hard-coded 3 probes');
});
