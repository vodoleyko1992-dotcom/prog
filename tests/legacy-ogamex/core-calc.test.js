'use strict';
// RETIRED (OgameX-only): checks the old lanedirt OgameX catalog and formulas. The core now ships the GALAXYZ catalog
// (tests/gz-catalog.test.js); the OgameX data generator is tools/legacy-ogamex/gen_catalog.js. Kept for reference, not run by run-all.
// OGX.calc against known OgameX values: hand-computed vectors, OgameX's own PHPUnit expectations
// (FleetDispatchGenericTest, BattleEngineTestAbstract), tools/buildings/model.js (port of PlanetService /
// GameObjectProduction used to generate the fixtures) and fixtures/ogamelive-expected-parse.json.
// Pure Node: the non-DOM core files are loaded into a vm context (tests/core-ext.js nodeCore()).
//   node tests/core-calc.test.js
const T = require('../lib');
const { assert } = T;
const { nodeCore } = require('../core-ext');
const model = require('../../tools/buildings/model.js');

const OGX = nodeCore();
const C = OGX.calc;
const plain = (o) => JSON.parse(JSON.stringify(o));

T.test('costs: buildings, research, astrophysics rounding, units', async () => {
  assert.deepEqual(plain(C.cost(1, 1)), { metal: 60, crystal: 15, deuterium: 0, energy: 0 });
  assert.deepEqual(plain(C.cost(1, 10)), { metal: 2306, crystal: 576, deuterium: 0, energy: 0 });
  assert.deepEqual(plain(C.cost(2, 2)), { metal: 76, crystal: 38, deuterium: 0, energy: 0 });
  assert.deepEqual(plain(C.cost(3, 3)), { metal: 506, crystal: 168, deuterium: 0, energy: 0 });
  assert.deepEqual(plain(C.cost(1, 0)), { metal: 0, crystal: 0, deuterium: 0, energy: 0 });
  // astrophysics: 4000*1.75^4 = 37515.6 -> floor 37515 -> nearest 100 = 37500
  assert.deepEqual(plain(C.cost(124, 5)), { metal: 37500, crystal: 75000, deuterium: 37500, energy: 0 });
  assert.deepEqual(plain(C.cost(124, 1)), { metal: 4000, crystal: 8000, deuterium: 4000, energy: 0 });
  // units: per piece, level ignored
  assert.deepEqual(plain(C.cost(203, 7)), { metal: 6000, crystal: 6000, deuterium: 0, energy: 0 });
  assert.deepEqual(plain(C.unitCost(202, 5)), { metal: 10000, crystal: 10000, deuterium: 0, energy: 0 });
  // every building and research at several levels against the model port of ObjectService::getObjectRawPrice
  for (const o of OGX.catalog.list().filter((x) => ['building', 'station', 'research'].includes(x.type))) {
    for (const L of [1, 2, 3, 5, 8, 12, 22]) {
      const m = model.rawPrice(o.machine, L);
      const c = C.cost(o.id, L);
      assert.deepEqual([c.metal, c.crystal, c.deuterium, c.energy], [m.metal, m.crystal, m.deuterium, m.energy], `${o.machine} L${L}`);
    }
  }
  assert.deepEqual(plain(C.costRange(1, 0, 3)), { metal: 60 + 90 + 135, crystal: 15 + 22 + 33, deuterium: 0, energy: 0 });
  // downgrade: ion technology -4% per level
  assert.deepEqual(plain(C.downgradeCost(1, 10, 5)), { metal: Math.floor(2306 * 0.8), crystal: Math.floor(576 * 0.8), deuterium: 0, energy: 0 });
});

T.test('times: building, research, unit (model.js), halving', async () => {
  const p = model.P(4); // orion Homeworld: robotics 10, nanite 1, shipyard 8, lab 10 (+IRN 1), economy 2
  for (const [mn, lvl] of [['metal_mine', 23], ['crystal_mine', 20], ['nano_factory', 2], ['robot_factory', 11], ['solar_plant', 3], ['metal_mine', 1]]) {
    const o = OGX.catalog.get(mn);
    assert.equal(C.buildTime(o.id, lvl, { robotics: 10, nanite: 1, economySpeed: 2 }), model.buildingTime(p, mn, lvl), `${mn} ${lvl}`);
  }
  assert.equal(C.buildTime(1, 23, { robotics: 10, nanite: 1, economySpeed: 2 }), 18364);
  assert.equal(C.researchTime(122, 8, { labLevel: 11, economySpeed: 2, researchSpeed: 1 }), 115200);
  assert.equal(C.researchTime(122, 8, { labLevel: 11, economySpeed: 2, playerClass: 'explorer' }), 86400);
  assert.equal(C.unitTime(203, { shipyard: 8, nanite: 1, economySpeed: 2 }), 480);
  assert.equal(C.unitTime(203, { shipyard: 8, nanite: 1, economySpeed: 2 }), model.unitTime(p, 'large_cargo'));
  assert.equal(C.unitTime(210, { shipyard: 0, nanite: 0, economySpeed: 1 }), 1440);
  assert.equal(C.unitTime(210, { shipyard: 12, nanite: 10, economySpeed: 8 }), 1); // minimum 1 s
  // HalvingService: 13984 s remaining -> 5,827 DM (buildings-overview fixture); research total 115200 s -> 48,000 DM
  assert.equal(C.halvingCost(13984, 'building'), 5827);
  assert.equal(C.halvingCost(115200, 'research'), 48000);
  assert.equal(C.halvingCost(10, 'unit'), 750);
  assert.equal(C.halvingCost(1e7, 'building'), 72000);
  assert.equal(C.halvingCost(1e7, 'research'), 108000);
});

T.test('storage capacity and production (GameObjectProduction, model.js, fixture reloadResources)', async () => {
  assert.equal(C.storageCapacity(0), 10000);
  assert.equal(C.storageCapacity(1), 20000);
  assert.equal(C.storageCapacity(8), 1590000);
  for (let L = 0; L <= 25; L++) assert.equal(C.storageCapacity(L), model.storage(L), 'storage L' + L);

  // metal mine level 10 alone, 100%, economy 1, position 8 (+35% metal), no class/plasma: energy factor limited by solar 0
  const lone = C.production({ levels: { 1: 10 }, tempMin: 20, tempMax: 60, position: 4, server: { economySpeed: 1 } });
  assert.equal(lone.energy.production, 0);
  assert.equal(lone.factor, 0);
  assert.deepEqual(plain(lone.perHour), { metal: 30, crystal: 15, deuterium: 0 }); // basic income only
  // metal mine 10 with enough solar: 30*10*1.1^10 = 778.12 -> ceil 779 + base 30
  const mm10 = C.production({ levels: { 1: 10, 4: 10 }, tempMin: 20, tempMax: 60, position: 4, server: { economySpeed: 1 } });
  assert.equal(mm10.factor, 1);
  assert.equal(mm10.perHour.metal, 30 + Math.ceil(30 * 10 * Math.pow(1.1, 10)));
  assert.equal(mm10.energy.production, Math.floor(20 * 10 * Math.pow(1.1, 10)));
  assert.equal(mm10.energy.consumption, Math.ceil(10 * 10 * Math.pow(1.1, 10)));

  // the orion sample planets (Collector, plasma 7, energy 12, economy 2, crawlers) against the model and the fixture
  for (const id of [4, 7]) {
    const p = model.P(id);
    const levels = {};
    for (const [mn, l] of Object.entries(p.levels)) levels[OGX.catalog.get(mn).id] = l;
    const research = {};
    for (const [mn, l] of Object.entries(model.player.research)) research[OGX.catalog.get(mn).id] = l;
    const r = C.production({ levels, percents: {}, ships: { 212: p.units.solar_satellite, 217: p.units.crawler }, tempMin: p.temp_min, tempMax: p.temp_max,
      position: p.p, isMoon: false, research, playerClass: 'collector', server: { economySpeed: 2 } });
    assert.deepEqual(plain(r.perHour), model.hourly(p), 'hourly planet ' + id);
    const es = model.energyStats(p);
    assert.deepEqual([r.energy.production, r.energy.consumption], [es.prod, es.cons], 'energy planet ' + id);
  }
  // fixture buildings-resources.html reloadResources: production per second 5.3652777777778 / 1.6894444444444 (x3600)
  const hw = C.production({ levels: { 1: 22, 2: 19, 3: 15, 4: 24, 12: 8 }, ships: { 217: 20 }, tempMin: 23, tempMax: 63, position: 8,
    research: { 113: 12, 122: 7 }, playerClass: 'miner', server: { economySpeed: 2 } });
  assert.deepEqual(plain(hw.perHour), { metal: 19315, crystal: 6082, deuterium: 1690 });
  assert.equal(hw.maxCrawlers, 8 * (22 + 19 + 15));
  // moon: nothing
  assert.deepEqual(plain(C.production({ levels: { 1: 10 }, isMoon: true }).perHour), { metal: 0, crystal: 0, deuterium: 0 });
});

T.test('projection: amountAt, secondsUntilFull, costOverlay (OL §5 vectors)', async () => {
  const exp = T.fixtureJson('ogamelive-expected-parse.json');
  const r = (o) => ({ amount: o.dispo, storage: o.capa, perHour: o.prod, t: 1000 });
  const prod = { M: { dispo: 1000, capa: 10000, prod: 3600 }, C: { dispo: 9990, capa: 10000, prod: 3600 }, D: { dispo: 0, capa: 10000, prod: 0 } };
  assert.equal(C.amountAt(r(prod.M), 11000), exp.project10s.M.dispo);
  assert.equal(C.amountAt(r(prod.C), 11000), exp.project10s.C.dispo);
  assert.equal(C.amountAt(r(prod.D), 11000), exp.project10s.D.dispo);
  assert.equal(C.amountAt({ amount: 20000, storage: 10000, perHour: 3600, t: 0 }, 60000), 20000, 'above storage does not grow');
  assert.equal(C.amountAt({ amount: 100, storage: 10000, perHour: -36000, t: 0 }, 60000), 0, 'negative production floors at 0');
  assert.equal(C.amountAt({ amount: 120000, storage: 100000, perHour: -3600, t: 0 }, 3600000), 120000, 'over-full stock with negative production stays put (PlanetService)');
  assert.equal(C.amountAt({ amount: 100000, storage: 100000, perHour: -3600, t: 0 }, 3600000), 100000, 'full stock with negative production stays put');
  assert.equal(C.secondsUntilFull(r(prod.M), 1000), exp.untilFull.M);
  assert.equal(C.secondsUntilFull(r(prod.C), 1000), exp.untilFull.C);
  assert.equal(C.secondsUntilFull(r(prod.D), 1000), Infinity);
  const res = { metal: r(prod.M), crystal: r(prod.C), deuterium: { amount: 0, storage: 10000, perHour: 1800, t: 1000 } };
  const ov = C.costOverlay({ metal: 5000, crystal: 2000, deuterium: 500 }, res, 1000, { capSC: 6250, capLC: 41250 });
  const e = exp.costOverlay;
  assert.equal(ov.total, e.total);
  assert.equal(ov.missingTotal, e.missingTotal);
  assert.equal(ov.secondsUntilAffordable, e.secondsUntilAffordable);
  assert.equal(ov.sc, e.sc);
  assert.equal(ov.lc, e.lc);
  assert.deepEqual([ov.rows.metal.diff, ov.rows.crystal.diff, ov.rows.deuterium.diff], [e.rows.M.diff, e.rows.C.diff, e.rows.D.diff]);
  assert.deepEqual([ov.rows.metal.sc, ov.rows.crystal.sc, ov.rows.deuterium.lc], [e.rows.M.sc, e.rows.C.sc, e.rows.D.lc]);
  assert.equal(C.timeUntilAffordable({ metal: 20000 }, { metal: r(prod.M) }, 1000), Infinity, 'cost above storage is never affordable');
});

T.test('fleet: ship stats, distance, duration, fuel (OgameX PHPUnit vectors)', async () => {
  // Collector, hyperspace tech 8, combustion 10: LC 22500 speed / 41250 cargo (techtree fixture), SC 8250 cargo
  const st = C.shipStats({ 114: 8, 115: 10, 117: 7, 118: 6 }, 'miner');
  const tt = T.fixtureJson('ogamelive-expected-parse.json').techtree203;
  assert.equal(st[203].speed, tt.speed);
  assert.equal(st[203].cargo, tt.capacity);
  assert.equal(st[202].cargo, 8250);
  assert.equal(st[203].fuel, tt.consumption);
  // drive rules (SpeedPropertyService): SC impulse >= 5 -> base 10000 and +20%/level
  assert.equal(C.shipSpeed(202, { 115: 10, 117: 4 }), 5000 * 2);
  assert.equal(C.shipSpeed(202, { 115: 10, 117: 10 }), 30000);
  assert.equal(C.shipSpeed(209, { 115: 6, 117: 17 }), 4000 + 4000 * 0.2 * 17);
  assert.equal(C.shipSpeed(209, { 115: 6, 117: 17, 118: 15 }), 6000 + 6000 * 0.3 * 15);
  assert.equal(C.shipSpeed(204, { 115: 10 }, 'warrior'), 12500 * 2 + 12500);
  assert.equal(C.cargoCapacity(209, {}, 'general'), 20000 + 4000);
  assert.equal(C.fuelCapacity(203, { 114: 8 }), Math.trunc(OGX.catalog.get(203).props.fuelCapacity * 1.4));

  // distance (FleetMissionService::calculateFleetMissionDistance)
  assert.equal(C.distance('1:42:8', '1:45:6'), 2985);
  assert.equal(C.distance('1:42:8', '1:42:9'), 1005);
  assert.equal(C.distance('1:42:8', '1:42:8'), 5);
  assert.equal(C.distance('1:1:1', '9:1:1'), 20000, 'donut galaxies');
  assert.equal(C.distance('1:1:1', '4:1:1'), 60000);
  assert.equal(C.distance('1:1:1', '1:499:1'), 2795, 'donut systems');
  assert.equal(C.distance('1:10:1', '1:20:1', { emptySystems: 4, inactiveSystems: 3 }), 2700 + 95 * 3);
  assert.equal(C.distance('1:10:1', '1:12:1', { emptySystems: 4 }), 2795, 'at least one system');

  // FleetDispatchGenericTest::testFleetDurationCalculation: 5 SC, drives 10/10/10, one system, fleet speed 1 -> 3388 s
  const research = { 115: 10, 117: 10, 118: 10 };
  const stats = C.shipStats(research, 'none');
  const d1 = C.distance('1:10:1', '1:11:1');
  assert.equal(C.flightDuration({ distance: d1, maxSpeed: C.fleetMaxSpeed({ 202: 5 }, stats), speedPct: 10, speedFactor: 1 }), 3388);
  // ::testFleetDeuteriumConsumptionCalculation: 1000 heavy fighters, same trip -> 23959 deuterium
  const dur = C.flightDuration({ distance: d1, maxSpeed: C.fleetMaxSpeed({ 205: 1000 }, stats), speedPct: 10, speedFactor: 1 });
  assert.equal(C.fuel({ ships: { 205: 1000 }, stats, distance: d1, duration: dur, speedFactor: 1, variant: 'server', fleetSpeed: 1, speedPct: 10 }), 23959);
  assert.equal(C.fuel({ ships: { 205: 1000 }, stats, distance: d1, duration: dur, speedFactor: 1 }), 23959, 'client = server when factors are 1');
  // General: server total x0.5 (int); client uses fuelConsumption that already includes it
  const gstats = C.shipStats(research, 'warrior');
  const gdur = C.flightDuration({ distance: d1, maxSpeed: C.fleetMaxSpeed({ 205: 1000 }, gstats), speedPct: 10, speedFactor: 1 });
  const gs = C.fuel({ ships: { 205: 1000 }, stats: gstats, distance: d1, duration: gdur, variant: 'server', fleetSpeed: 1, speedPct: 10, playerClass: 'warrior' });
  const gfull = C.fuel({ ships: { 205: 1000 }, stats: Object.assign({}, gstats, { 205: Object.assign({}, gstats[205], { fuelConsumption: 75 }) }), distance: d1, duration: gdur });
  assert.equal(gs, Math.trunc(gfull * 0.5));
  // holding cost: max(floor(sum(fuel*n*h)/10), 1)
  const base = C.fuel({ ships: { 205: 1000 }, stats, distance: d1, duration: dur });
  assert.equal(C.fuel({ ships: { 205: 1000 }, stats, distance: d1, duration: dur, holdingHours: 2 }), base + Math.floor(75 * 1000 * 2 / 10));
  // hand-computed: 10 LC (22500) 1:42:8 -> 1:45:6, war factor 2: 2021 s, 171 deuterium
  const dW = C.flightDuration({ distance: 2985, maxSpeed: 22500, speedPct: 10, speedFactor: 2 });
  assert.equal(dW, 2021);
  assert.equal(C.fuel({ ships: { 203: 10 }, stats: st, distance: 2985, duration: dW, speedFactor: 2 }), 171);
  assert.equal(C.flightDuration({ distance: 2985, maxSpeed: 0 }), Infinity);

  // mission speed classes (GameMission::getFleetSpeedType)
  const srv = { fleetSpeedWar: 2, fleetSpeedHolding: 3, fleetSpeedPeaceful: 4 };
  assert.deepEqual([1, 2, 6, 8, 9, 10].map((m) => C.missionSpeedFactor(m, srv)), [2, 2, 2, 2, 2, 2]);
  assert.deepEqual([3, 4, 7, 15].map((m) => C.missionSpeedFactor(m, srv)), [4, 4, 4, 4]);
  assert.equal(C.missionSpeedFactor(5, srv), 3);
  assert.equal(C.fleetCargo({ 202: 5, 203: 2 }, stats), 5 * 5000 + 2 * 25000);
  assert.equal(C.cargoNeeded(100000, 203, st), 3);
  assert.equal(C.cargoNeeded(100000, 203, st, { reservePct: 30 }), 4);
  assert.deepEqual(plain(C.slots({ computer: 12, astrophysics: 9, playerClass: 'warrior' })), { fleet: 15, expedition: 3 });
  assert.deepEqual(plain(C.slots({ computer: 5, astrophysics: 16, playerClass: 'explorer', bonusExpeditionSlots: 1 })), { fleet: 6, expedition: 7 });
});

T.test('loot (LootService::distributeLoot, BattleEngineTestAbstract), debris, moon chance', async () => {
  // 5 small cargo = 25000 capacity
  assert.deepEqual(plain(C.loot({ metal: 10000, crystal: 5000, deuterium: 0 }, { cargo: 25000 })), { metal: 5000, crystal: 2500, deuterium: 0, total: 7500 });
  assert.deepEqual(plain(C.loot({ metal: 100000, crystal: 100000, deuterium: 0 }, { cargo: 25000 })), { metal: 12500, crystal: 12500, deuterium: 0, total: 25000 });
  assert.deepEqual(plain(C.loot({ metal: 100000, crystal: 100000, deuterium: 10000 }, { cargo: 25000 })), { metal: 10000, crystal: 10000, deuterium: 5000, total: 25000 });
  assert.equal(C.lootPct('explorer'), 0.75);
  assert.equal(C.lootPct('miner'), 0.5);
  assert.deepEqual(plain(C.loot({ metal: 1000, crystal: 0, deuterium: 0 }, { attackerClass: 'discoverer' })), { metal: 750, crystal: 0, deuterium: 0, total: 750 });
  assert.deepEqual(plain(C.distributeLoot({ metal: 9000, crystal: 300, deuterium: 300 }, 3000)), { metal: 2400, crystal: 300, deuterium: 300 });
  // debris: 30% of ships, 0% defense by default
  assert.deepEqual(plain(C.debris({ 204: 10, 401: 100 })), { metal: 9000, crystal: 3000, deuterium: 0 });
  assert.deepEqual(plain(C.debris({ 206: 1 }, { debrisFleetPct: 50, debrisDeuterium: true })), { metal: 10000, crystal: 3500, deuterium: 1000 });
  assert.equal(C.moonChance(250000), 2);
  assert.equal(C.moonChance(5e6), 20);
  assert.equal(C.moonChance(5e6, 15), 15);
  const v = C.unitsValue({ 203: 2, 401: 10 });
  assert.deepEqual([v.metal, v.crystal, v.total, v.points], [32000, 12000, 44000, 44]);
  assert.equal(C.msu({ metal: 100, crystal: 100, deuterium: 100 }), 100 + 150 + 300);
});

T.test('expeditions (ExpeditionMission, ogamelive-expected-parse.json), ranges', async () => {
  const exp = T.fixtureJson('ogamelive-expected-parse.json').expedition;
  const a = C.expeditionMaxFind({ topPoints: 21339, playerClass: 'miner', economySpeed: 2 });
  const b = C.expeditionMaxFind({ topPoints: 21339, playerClass: 'explorer', economySpeed: 2, hasPathfinder: true });
  assert.deepEqual([a.metal, a.crystal, a.deuterium, a.min], [exp[0].metal, exp[0].crystal, exp[0].deuterium, exp[0].min]);
  assert.deepEqual([b.metal, b.crystal, b.deuterium, b.min], [exp[1].metal, exp[1].crystal, exp[1].deuterium, exp[1].min]);
  assert.deepEqual(plain(a.rare), { metal: 1500000, crystal: 1000000, deuterium: 500000 });
  assert.equal(a.exceptional.metal, 5000000);
  assert.equal(C.expeditionMaxFind({ topPoints: 5000 }).metal, 40000);
  assert.equal(C.expeditionMaxFind({ topPoints: 2e8 }).metal, 5e6);
  assert.equal(C.expeditionMaxFind({ topPoints: 2e8, rewardMultiplier: 1.5 }).metal, 7.5e6);
  const st = C.shipStats({ 114: 8 }, 'miner');
  assert.deepEqual(plain(C.expeditionMinShips(500000, st)), { 202: Math.ceil(500000 / 8250), 203: Math.ceil(500000 / 41250) });
  assert.equal(C.phalanxRange(4), 15);
  assert.equal(C.phalanxRange(4, 'explorer'), 18);
  assert.equal(C.phalanxRange(0), 0);
  assert.equal(C.missileRange(5), 24);
});

T.test('util and fmt (Russian formatting, OgameX number parsing)', async () => {
  const U = OGX.util, F = OGX.fmt;
  const nums = T.fixtureJson('ogamelive-expected-parse.json').num;
  for (const [s, v] of Object.entries(nums)) assert.equal(U.parseGameNumber(s), v, s);
  assert.equal(U.parseGameNumber('152347.29861111'), 152347.29861111);
  assert.equal(U.parseGameNumber('12K'), 12000);
  assert.deepEqual(plain(U.parseGameNumberEx('1.25Mn')), { value: 1250000, approx: true });
  assert.equal(U.parseShortComma('7,7K'), 7700);
  assert.equal(U.parseDotThousands('1.250'), 1250);
  assert.equal(U.parseIsoDuration('PT1W4D2H40M'), 7 * 86400 + 4 * 86400 + 2 * 3600 + 40 * 60);
  assert.equal(U.parseIsoDuration('PT5H6M4S'), 18364);
  assert.equal(U.coords('Homeworld [1:42:8] -> [2:118:12]'), '2:118:12');
  assert.deepEqual(plain(U.coordsArr('1:42:8')), [1, 42, 8]);
  assert.equal(U.sameSystem('1:42:8', '1:42:3'), true);
  assert.equal(F.num(1234567), '1 234 567');
  assert.equal(F.num(-1234.7), '-1 234');
  assert.equal(F.num(NaN), '—');
  assert.equal(F.short(12345), '12,3\u00a0тыс.');
  assert.equal(F.short(1234567), '1,23\u00a0млн');
  assert.equal(F.short(4.5e9), '4,5\u00a0млрд');
  assert.equal(F.short(9999), '9 999');
  assert.equal(F.signed(1234), '+1 234');
  assert.equal(F.pct(0.256), '26%');
  assert.equal(F.duration(0), 'Готово');
  assert.equal(F.duration(Infinity), '∞');
  assert.equal(F.duration(45), '45с');
  assert.equal(F.duration(725), '12:05');
  assert.equal(F.duration(11045), '3:04:05');
  assert.equal(F.duration(2 * 86400 + 11045), '2д 03:04:05');
  assert.equal(F.duration(5 * 604800 + 2 * 86400 + 11045), '5н 2д 03:04');
  assert.equal(F.durationShort(2 * 86400 + 3 * 3600), '2д 3ч');
  assert.equal(F.coords('1:42:8', 3), '[1:42:8]\u00a0Л');
  assert.equal(F.coords('1:42:8', 2), '[1:42:8]\u00a0ПО');
  assert.equal(F.plural(1, ['корабль', 'корабля', 'кораблей']), 'корабль');
  assert.equal(F.plural(3, ['корабль', 'корабля', 'кораблей']), 'корабля');
  assert.equal(F.plural(11, ['корабль', 'корабля', 'кораблей']), 'кораблей');
  assert.equal(F.plural(22, ['корабль', 'корабля', 'кораблей']), 'корабля');
  assert.equal(F.res({ metal: 1234, crystal: 5678, deuterium: 90 }), 'М 1 234 · К 5 678 · Д 90');
});

T.test('catalog lookups', async () => {
  const K = OGX.catalog;
  assert.equal(K.get(1).machine, 'metal_mine');
  assert.equal(K.get('transporterLarge').id, 203);
  assert.equal(K.get('large_cargo').id, 203);
  assert.equal(K.get('203').id, 203);
  assert.equal(K.get(999), null);
  assert.deepEqual(plain(K.shipIds), [204, 205, 206, 207, 215, 211, 213, 214, 218, 202, 203, 208, 209, 210, 212, 217, 219]);
  assert.equal(K.fleetShipIds.includes(212) || K.fleetShipIds.includes(217), false);
  assert.deepEqual(plain(K.list('ship').map((o) => o.id)), plain(K.shipIds));
  assert.deepEqual(plain(K.buildingIds('moon')), [22, 23, 24, 14, 21, 44, 41, 42, 43]);
  assert.ok(K.buildingIds('moon').includes(41) && !K.buildingIds('moon').includes(1));
  assert.ok(K.buildingIds('planet').includes(1) && !K.buildingIds('planet').includes(41));
  assert.equal(K.idFromTitle('Large Cargo'), 203);
  assert.equal(K.idFromTitle('Большой транспорт'), 203);
  assert.equal(K.idFromTitle('nope'), null);
  assert.equal(K.name(203), 'Большой транспорт');
  assert.equal(K.missionName(15), 'Экспедиция');
  assert.equal(K.missionName(9), 'Уничтожение луны');
  assert.equal(K.get(217).classOnly, 'miner');
  assert.equal(K.get(212).page, 'shipyard');
  for (const id of K.shipIds) assert.ok(K.get(id).props && K.get(id).props.structural > 0, 'props ' + id);
});
