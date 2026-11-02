'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// OGX.flights: get() (one request, cache, shared in-flight, force/invalidate), the game's own event-list XHR,
// the movement page, synthetic ids, inFlight, incomingByBody, applyArrivals, polling.
//   node tests/legacy-ogamex/core-flights.test.js
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');

T.test('get(): one event-list request, cached, shared while in flight; force and invalidate refetch', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  env.clearRequests();
  const r = await env.evalOgx(page, async () => {
    const [a, b] = await Promise.all([OGX.flights.get(), OGX.flights.get()]);
    const c = await OGX.flights.get();
    return { n: a.flights.length, same: a.t === b.t && b.t === c.t, ids: a.flights.map((f) => f.rowId), keys: Object.fromEntries(a.flights.map((f) => [f.rowId, [f.originKey, f.destKey, f.synthetic, f.own]])) };
  });
  assert.equal(env.requests('GET', '/ajax/fleet/eventlist/fetch').length, 1, 'one request for three calls');
  assert.equal(r.n, 9);
  assert.ok(r.same);
  assert.deepEqual(r.ids, [1210, 1199, 1201, 890090, 1211, 1001201, 1001200, 1203, 1001202]);
  assert.deepEqual(r.keys[1199], [null, 'p1', null, true]); // harvest return from the debris field at 1:42:9
  assert.deepEqual(r.keys[1203].slice(0, 2), ['p3', 'p1']);
  assert.deepEqual(r.keys[1001200].slice(1), ['p1', 'return', true]);
  assert.deepEqual(r.keys[1211].slice(1), ['p3', null, false]);
  const stored = await env.evalOgx(page, async () => { await OGX.storage.flush(); return true; }).then(() => env.get('flights'));
  assert.equal(stored.src, 'eventlist');
  assert.equal(stored.flights.length, 9);
  await env.evalOgx(page, async () => { await OGX.flights.get({ force: true }); await OGX.flights.invalidate(); await OGX.flights.get(); await OGX.flights.get({ maxAgeMs: 0 }); return true; });
  assert.equal(env.requests('GET', '/ajax/fleet/eventlist/fetch').length, 4);
  // an error is reported, not thrown
  env.server.route('GET', '/ajax/fleet/eventlist/fetch', (req, res, ctx) => ctx.send(500, 'oops'));
  const e = await env.evalOgx(page, () => OGX.flights.get({ force: true }));
  assert.ok(e.error, 'error result');
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('derived views: inFlight per realMissionId, hostile, incomingByBody, applyArrivals (OL §5.7)', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, async () => {
    const { flights } = await OGX.flights.get();
    const res = () => ({ metal: { amount: 100 }, crystal: { amount: 100 }, deuterium: { amount: 100 } });
    const bodies = { p1: { key: 'p1', res: res(), ships: { 202: 1 } }, p3: { key: 'p3', res: res() }, m5: { key: 'm5', res: res() } };
    const all = OGX.flights.applyArrivals(bodies, flights, 0, Infinity);
    const win = OGX.flights.applyArrivals(bodies, flights, 1793322750000, 1793330056000);
    const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
    const inF = OGX.flights.inFlight(flights);
    return {
      all: Object.fromEntries(Object.entries(all).map(([k, b]) => [k, [b.res.metal.amount, b.res.crystal.amount, b.res.deuterium.amount, sum(b.ships)]])),
      win: Object.fromEntries(Object.entries(win).map(([k, b]) => [k, [b.res.metal.amount, b.res.crystal.amount, b.res.deuterium.amount, sum(b.ships)]])),
      untouched: [bodies.p1.res.metal.amount, sum(bodies.p1.ships)],
      inF: [inF.metal, inF.crystal, inF.deuterium], byMission: inF.byMission,
      hostile: OGX.flights.hostile(flights).map((f) => f.rowId),
      incoming: Object.fromEntries(Object.entries(OGX.flights.incomingByBody(flights)).map(([k, v]) => [k, v.map((f) => f.rowId)])),
      sorted: Object.values(OGX.flights.incomingByBody(flights)).every((v) => v.every((f, i) => !i || v[i - 1].arrival <= f.arrival)),
    };
  });
  // p1: 1199 own return (+31200/18900, 4 ships), 1203 own transport (+50000/30000/10790, ships stay), returns 1001200 (30) and 1001201 (12)
  assert.deepEqual(r.all.p1, [100 + 31200 + 50000, 100 + 18900 + 30000, 100 + 10790, 1 + 4 + 30 + 12]);
  // p3: foreign transport 1211 (+20000/10000/20) and the synthetic return of 1203 (5 ships)
  assert.deepEqual(r.all.p3, [20100, 10100, 120, 5]);
  assert.deepEqual(r.all.m5, [100, 100, 100, 0]);
  // (from, to]: 1199 at `from` is excluded, 1203 at `to` included; 1001202 later
  assert.deepEqual(r.win.p1, [100 + 50000, 100 + 30000, 100 + 10790, 1 + 30 + 12]);
  assert.deepEqual(r.win.p3, [20100, 10100, 120, 0]);
  assert.deepEqual(r.untouched, [100, 1], 'input bodies are not mutated');
  // in flight: 1199 (return row), 1201 (outbound), 1202 (hold end), 1203 (outbound); foreign rows ignored
  assert.deepEqual(r.inF, [31200 + 0 + 0 + 50000, 18900 + 30000, 106 + 60 + 10790]);
  assert.deepEqual(Object.keys(r.byMission).sort(), ['1', '15', '3', '8']);
  assert.deepEqual(r.hostile, [1210]);
  assert.deepEqual(r.incoming.p1.sort(), [1001200, 1001201, 1199, 1203, 1210].sort());
  assert.deepEqual(r.incoming.p3.sort(), [1001202, 1211].sort());
  assert.ok(r.sorted);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('free data: the game\'s own event-list XHR and the movement page refresh the stored flights', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  env.clearRequests();
  await page.evaluate(() => new Promise((res) => { const x = new XMLHttpRequest(); x.open('GET', '/ajax/fleet/eventlist/fetch'); x.setRequestHeader('X-Requested-With', 'XMLHttpRequest'); x.onloadend = res; x.send(); }));
  await page.waitForTimeout(500);
  await env.evalOgx(page, () => OGX.storage.flush());
  const fromGame = await env.get('flights');
  assert.equal(fromGame.src, 'game');
  assert.equal(fromGame.flights.length, 9);
  assert.equal(env.requests('GET', '/ajax/fleet/eventlist/fetch').length, 1, 'only the game request');
  // movement page: parsed on load (no extra request), synthetic ids match the event list
  await env.clearStorage();
  const mv = await env.open('/fleet/movement');
  await mv.waitForTimeout(300);
  await env.evalOgx(mv, () => OGX.storage.flush());
  const fromMov = await env.get('flights');
  assert.equal(fromMov.src, 'movement');
  // same rows, ids, order and ownership as the event list (fleet-expected-parse.json)
  assert.deepEqual(fromMov.flights.map((f) => f.rowId), fromGame.flights.map((f) => f.rowId));
  assert.deepEqual(fromMov.flights.map((f) => f.own), fromGame.flights.map((f) => f.own));
  assert.deepEqual(fromMov.flights.map((f) => f.arrival), fromGame.flights.map((f) => f.arrival));
  const ret = fromMov.flights.find((f) => f.rowId === 1001202);
  assert.deepEqual([ret.destKey, ret.synthetic, ret.returnFlight], ['p3', 'return', true]);
  const slots = await env.evalOgx(mv, () => OGX.state.slots());
  assert.deepEqual([slots.fleet, slots.expedition], [{ max: 6, used: 4 }, { max: 2, used: 1 }], 'slots from the movement page');
  assert.equal(env.requests('GET', '/ajax/fleet/eventlist/fetch').length, 1);
  assert.deepEqual(env.server.unhandled, []);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('polling: tick-driven eventbox poll, event list refetched only when counts change', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega', settings: { 'core.flightsPollSec': 1, 'core.tickMs': 250, 'core.httpGapMs': 200 } });
  const page = await env.open('/overview');
  env.clearRequests();
  await env.evalOgx(page, () => { window.__stop = OGX.flights.startPolling(); window.__same = OGX.flights.startPolling() === window.__stop; return true; });
  await page.waitForTimeout(2600);
  const box1 = env.requests('GET', '/ajax/fleet/eventbox/fetch').length;
  const list1 = env.requests('GET', '/ajax/fleet/eventlist/fetch').length;
  assert.ok(box1 >= 2, 'eventbox polled: ' + box1);
  assert.equal(list1, 1, 'event list only once while counts stay the same');
  env.setState({ eventbox: 'empty' });
  await page.waitForTimeout(1600);
  assert.equal(env.requests('GET', '/ajax/fleet/eventlist/fetch').length, 2, 'refetched after the counts changed');
  const same = await env.evalOgx(page, () => { window.__stop(); return window.__same; });
  assert.equal(same, true, 'one poller per tab');
  env.clearRequests();
  await page.waitForTimeout(1500);
  assert.equal(env.requests('GET', '/ajax/fleet/eventbox/fetch').length, 0, 'stopped');
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('decision 21: half the fuel is removed from own outbound deuterium when the flight can be recomputed', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, () => {
    const C = OGX.calc;
    const stats = C.shipStats({ 115: 6, 117: 4, 118: 0, 114: 0 }, 'none');
    const server = { fleetSpeed: 1, fleetSpeedWar: 1, fleetSpeedPeaceful: 1, fleetSpeedHolding: 1 };
    const ships = { 203: 5 };
    const from = '2:118:12', to = '1:42:8';
    const distance = C.distance(from, to);
    const oneWay = C.flightDuration({ distance, maxSpeed: C.fleetMaxSpeed(ships, stats), speedPct: 7.5, speedFactor: 1 });
    const fuel = C.fuel({ ships, stats, distance, duration: oneWay, speedFactor: 1, variant: 'server', fleetSpeed: 1, speedPct: 7.5 });
    const dep = 1793318837000, arr = dep + oneWay * 1000;
    const row = (o) => Object.assign({ rowId: 1, realMissionId: 1, synthetic: null, isUnion: false, missionType: 3, returnFlight: false, arrival: arr,
      from, fromType: 1, to, toType: 1, units: 5, ships, own: true, departure: dep, cargo: { metal: 50000, crystal: 0, deuterium: 1000 + fuel / 2, approx: false } }, o);
    const fixed = OGX.flights.fixOutboundFuel([row({})], { stats, server, playerClass: 'none' })[0];
    const wrongStats = OGX.flights.fixOutboundFuel([row({})], { stats: C.shipStats({}, 'none'), server })[0];
    const noDeparture = OGX.flights.fixOutboundFuel([row({ departure: null })], { stats, server })[0];
    const foreign = OGX.flights.fixOutboundFuel([row({ own: false })], { stats, server })[0];
    return { fuel, fixed: fixed.cargo, wrongStats: wrongStats.cargo, noDeparture: noDeparture.cargo, foreign: foreign.cargo };
  });
  assert.ok(r.fuel > 2);
  assert.equal(r.fixed.deuterium, 1000);
  assert.equal(r.fixed.fuelRemoved, Math.round(r.fuel / 2));
  assert.equal(r.fixed.approx, false);
  assert.equal(r.wrongStats.approx, true, 'duration does not match with base stats -> approx');
  assert.equal(r.noDeparture.approx, true);
  assert.equal(r.foreign.fuelRemoved, undefined, 'foreign rows untouched');
  assert.deepEqual(env.ogxErrors(), []);
});
