'use strict';
// Quick core smoke (about 5 s): the headline GALAXYZ values in plain Node, then a few parsers on fixtures and a
// boot in a real Chromium with the extension loaded. The full suites are gz-catalog / core-parse / core-detect /
// core-storage / core-http / core-flights / core-boot.
//   node tests/core.test.js
const T = require('./lib');
const { assert } = T;
const { coreExt, nodeCore } = require('./core-ext');

T.test('formulas: known GALAXYZ values (plain Node)', async () => {
  // headline numbers from the real ogamex.eu/Aeternum pages; the full set is tests/gz-catalog.test.js
  const OGX = nodeCore();
  const C = OGX.calc;
  const plain = (o) => JSON.parse(JSON.stringify(o));
  // BuildFunctions::getElementPrice: cost x factor^(level-1)
  assert.deepEqual(plain(C.cost(1, 39)), { metal: 294862195, crystal: 73715548, deuterium: 0, energy: 0 });
  assert.deepEqual(plain(C.cost(220)), { metal: 60000, crystal: 70000, deuterium: 30000, energy: 0 });   // fleetDealer CostInfo
  // storage x5 (resourceTicker limit at level 18) and the main planet's production (resourceTicker, Geologist 18, Engineer 4)
  assert.equal(C.storageCapacity(18), 3416925000);
  const p = C.production({ levels: { 1: 38, 2: 35, 3: 33, 4: 30 }, ships: { 212: 797 }, tempMax: 72,
    research: { 113: 12, 131: 8, 133: 8 }, officers: { 601: 18, 603: 4 } });
  assert.ok(Math.abs(p.perHour.metal - 1932927923.2055) < 0.01);
  assert.deepEqual(plain(p.energy), { production: 49544, consumption: 47042, balance: 2502 });
  // fleetStep1: one colony ship [2:68:5] -> [2:68:9] at 100 %, gamespeed 7: 1020 / 653 s / 118 deuterium
  const stats = C.shipStats({ 115: 12, 117: 7, 118: 4, 114: 8 });
  const d = C.distance('2:68:5', '2:68:9');
  const dur = C.flightDuration({ distance: d, maxSpeed: C.fleetMaxSpeed({ 208: 1 }, stats), speedPct: 10, speedFactor: 7 });
  assert.deepEqual([d, dur, C.fuel({ ships: { 208: 1 }, stats, distance: d, duration: dur, speedFactor: 7 })], [1020, 653, 118]);
  // calculateSteal
  assert.deepEqual(plain(C.loot({ metal: 100000, crystal: 100000, deuterium: 10000 }, { cargo: 25000 })), { metal: 10000, crystal: 10000, deuterium: 5000, total: 25000 });
  // formatting (Russian)
  assert.equal(OGX.fmt.num(1234567), '1 234 567');
});

T.test('parsers + boot: fixtures parsed inside the loaded extension', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const I = { evl: T.fixture('fleet-eventlist.html'), gx: T.fixture('galaxy-ajax-1-42.json'), esp: T.fixture('messages-ajax-message-2051-espionage-full.html') };
  const r = await env.evalOgx(page, (I) => {
    const D = (h) => new DOMParser().parseFromString(h, 'text/html');
    return {
      ready: document.documentElement.dataset.ogxLive,
      player: OGX.state.current() && OGX.parse.player(document).id,
      tooltips: OGX.state.snapshot().tooltips.metal,
      rows: OGX.flights.parseEventList(I.evl, { ownCoords: ['1:42:8', '2:118:12'] }).map((f) => f.rowId),
      gx: OGX.galaxy.parseSystem(JSON.parse(I.gx)).positions.length,
      esp: OGX.messages._recipes.parseEspionageFull(D(I.esp)),
      espAlias: OGX.messages.parse.espionageFull(D(I.esp)).target.coordsStr,
    };
  }, I);
  assert.equal(r.ready, 'ready');
  assert.equal(r.player, 108);
  assert.deepEqual(r.tooltips, { amount: 152347, storage: 255000, perHour: 4128 });
  assert.deepEqual(r.rows, T.fixtureJson('fleet-expected-parse.json').eventlist.map((x) => x.rowId));
  assert.ok(r.gx > 0);
  assert.deepEqual(r.esp, T.fixtureJson('messages-expected-parse.json').espionageFull[0]);
  assert.equal(r.espAlias, '1:45:9');
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((q) => q.method + ' ' + q.path), []);
});
