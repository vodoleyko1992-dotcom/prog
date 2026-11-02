'use strict';
// RETIRED (OgameX-only): runs against the old lanedirt OgameX mock (tests/server.js + fixtures/*). GALAXYZ is the target now;
// kept for reference, not run by default: node tests/run-all.js --legacy
// OGX.parse, OGX.flights, OGX.galaxy and OGX.messages parsers against the fixtures and the verified
// expected-parse files (layout-, fleet-, galaxy-, messages-, ogamelive-expected-parse.json).
// The parsers run inside the real core (isolated world of a test extension) on DOMParser documents.
//   node tests/legacy-ogamex/core-parse.test.js
const T = require('../lib');
const { assert } = T;
const { coreExt } = require('../core-ext');

/** Every key of `exp` must deep-equal the same key in `act` (arrays: same length, element-wise subset). */
function subset(act, exp, where = '') {
  if (exp === null || typeof exp !== 'object') {
    assert.deepEqual(act, exp, `${where}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)}`);
    return;
  }
  if (Array.isArray(exp)) {
    assert.ok(Array.isArray(act), `${where}: not an array (${JSON.stringify(act)})`);
    assert.equal(act.length, exp.length, `${where}: length ${act.length} != ${exp.length}`);
    exp.forEach((e, i) => subset(act[i], e, `${where}[${i}]`));
    return;
  }
  assert.ok(act && typeof act === 'object', `${where}: missing object`);
  for (const k of Object.keys(exp)) subset(act[k], exp[k], where ? `${where}.${k}` : k);
}

const F = (n) => T.fixture(n);
let env, page;
async function ogxPage() {
  if (page) return page;
  env = await T.launch({ ext: coreExt({ name: 'live' }), scenario: 'vega' });
  page = await env.open('/overview');
  return page;
}
// The runner closes envs after each test; keep one per test.
async function fresh() { page = null; return ogxPage(); }

T.test('layout parsers (layout-expected-parse.json, ogamelive-expected-parse.json)', async () => {
  const p = await fresh();
  const files = ['layout-overview-planet.html', 'layout-overview-moon.html', 'layout-overview-compact.html'];
  const input = Object.fromEntries(files.map((f) => [f, F(f)]));
  const got = await env.evalOgx(p, (I) => {
    const out = {};
    for (const [f, html] of Object.entries(I)) {
      const d = new DOMParser().parseFromString(html, 'text/html');
      const base = 'http://localhost/overview';
      const rows = OGX.parse.planetList(d, base);
      out[f] = {
        isOgx: OGX.page.isOgx(d, { hostname: 'localhost' }),
        body: d.body.id,
        cur: String(OGX.parse.metas(d).planetId),
        planets: rows.map((r) => ({ id: r.planetId, name: r.name, coords: r.coords, fields: r.fieldsMax ? [r.fieldsUsed, r.fieldsMax] : null, diameter: r.diameter,
          moonId: r.moonId, moonFields: r.moon ? [r.moon.fieldsUsed, r.moon.fieldsMax] : null, building: r.building, active: r.isCurrent, moonActive: !!(r.moon && r.moon.isCurrent) })),
        res: Object.fromEntries(['metal', 'crystal', 'deuterium'].map((k) => { const x = OGX.parse.inlineResources(d)[k]; return [k, { amount: x.amount, storage: x.storage, perSec: x.perSecond }]; })),
        serverTimeUTC: OGX.time.parseServerWall(OGX.parse.serverTimeString(d)),
        serverTimeFromHtml: OGX.parse.serverTimeString(html),
        cls: OGX.parse.player(d).playerClass,
        dm: OGX.parse.player(d).darkMatter,
        player: OGX.parse.player(d),
        metas: OGX.parse.metas(d),
        currentBody: OGX.parse.currentBody(d, base),
        tooltips: OGX.parse.resourceTooltips(d),
        rows,
      };
    }
    return out;
  }, input);
  const exp = T.fixtureJson('layout-expected-parse.json');
  for (const f of files) {
    const { serverTimeFromHtml, player, metas, currentBody, tooltips, rows, ...cmp } = got[f];
    subset(cmp, exp[f], f);
  }
  const ol = T.fixtureJson('ogamelive-expected-parse.json');
  const planet = got['layout-overview-planet.html'];
  subset(planet.rows.map((r) => ({ planetId: r.planetId, rowId: r.rowId, name: r.name, coords: r.coords, moonId: r.moonId, building: r.building })), ol.bodiesPlanet, 'bodiesPlanet');
  subset(planet.currentBody, ol.currentPlanet, 'currentPlanet');
  subset(got['layout-overview-moon.html'].currentBody, ol.currentMoon, 'currentMoon');
  const tt = (t) => ({ M: { dispo: t.metal.amount, capa: t.metal.storage, prod: t.metal.perHour }, C: { dispo: t.crystal.amount, capa: t.crystal.storage, prod: t.crystal.perHour },
    D: { dispo: t.deuterium.amount, capa: t.deuterium.storage, prod: t.deuterium.perHour }, E: { dispo: t.energy.available, prod: t.energy.production, conso: t.energy.consumption } });
  const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); for (const k of ['M', 'C', 'D']) delete c[k].cache; return c; };
  subset(tt(planet.tooltips), strip(ol.tooltips), 'tooltips');
  subset(tt(got['layout-overview-moon.html'].tooltips), strip(ol.tooltipsMoon), 'tooltipsMoon');
  assert.equal(planet.serverTimeFromHtml, '2026-10-30 00:57:17');
  assert.deepEqual([planet.player.id, planet.player.name, planet.player.rank, planet.player.unreadMessages, planet.player.isAdmin], [108, 'Commander Vega', 37, 3, false]);
  assert.deepEqual([planet.metas.economySpeed, planet.metas.fleetSpeed, planet.metas.lang, planet.metas.planetCoords], [1, 1, 'en', '1:42:8']);
  assert.deepEqual([planet.rows[0].tempMin, planet.rows[0].tempMax, planet.rows[0].moon.name], [12, 52, 'Moon']);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('buildings parsers (techList, queues, settings, overview, techDetails, techtree, server settings)', async () => {
  const p = await fresh();
  const I = {
    res: F('buildings-resources.html'), research: F('buildings-research.html'), fac: F('buildings-facilities.html'), facMoon: F('buildings-facilities-moon.html'),
    over: F('buildings-overview.html'), overMoon: F('buildings-overview-moon.html'), yard: F('buildings-shipyard.html'), def: F('buildings-defense.html'), set: F('buildings-resource-settings.html'),
    td1: F('buildings-ajax-resources-1.json'), td4: F('buildings-ajax-resources-4.json'), td43: F('buildings-ajax-facilities-43-moon.json'), td203: F('buildings-ajax-shipyard-203.json'),
    td407: F('buildings-ajax-defense-407.json'), tt203: F('ogamelive-techtree-tab2-203.html'), ss: F('layout-overlay-server-settings.html'), lt1: F('layout-ajax-resources-technology-1.json'),
  };
  const got = await env.evalOgx(p, (I) => {
    const D = (h) => new DOMParser().parseFromString(h, 'text/html');
    const P = OGX.parse;
    const levels = (h) => Object.fromEntries(P.techList(D(h)).map((x) => [x.className, x.value]));
    const list = (h) => P.techList(D(h)).map((x) => `${x.id}:${x.className}:${x.status}:${x.value}${x.target !== null ? '>' + x.target : ''}`);
    return {
      levelsResources: levels(I.res), levelsResearch: levels(I.research), levelsFacilities: levels(I.fac),
      listRes: list(I.res), listFacMoon: list(I.facMoon), listYard: list(I.yard), listDef: list(I.def), listResearch: list(I.research),
      qOver: P.queueTimers(I.over), qRes: P.queueTimers(D(I.res)), qOverMoon: P.queueTimers(I.overMoon), qYard: P.queueTimers(I.yard),
      settings: P.resourceSettings(D(I.set)),
      overview: P.overviewInfo(I.over), overviewMoon: P.overviewInfo(D(I.overMoon)),
      td1: P.techDetails(JSON.parse(I.td1)), td4: P.techDetails(JSON.parse(I.td4)), td43: P.techDetails(JSON.parse(I.td43)),
      td203: P.techDetails(JSON.parse(I.td203)), td407: P.techDetails(JSON.parse(I.td407)), lt1: P.techDetails(JSON.parse(I.lt1)),
      tt203: P.shipProps(I.tt203), ss: P.serverSettings(I.ss), titles: P.titles(D(I.yard)),
    };
  }, I);
  const ol = T.fixtureJson('ogamelive-expected-parse.json');
  subset(got.levelsResources, ol.levelsResources, 'levelsResources');
  subset(got.levelsResearch, ol.levelsResearch, 'levelsResearch');
  subset(got.levelsFacilities, ol.levelsFacilities, 'levelsFacilities');
  // buildings.md §13 verified excerpts
  for (const x of ['1:metalMine:active:22>23', '4:solarPlant:disabled:24', '217:resbuggy:on:20']) assert.ok(got.listRes.includes(x), x);
  for (const x of ['41:moonbase:disabled:3', '43:jumpGate:disabled:1']) assert.ok(got.listFacMoon.includes(x), x);
  for (const x of ['203:transporterLarge:active:120>167', '218:reaper:disabled:0']) assert.ok(got.listYard.includes(x), x);
  for (const x of ['401:rocketLauncher:on:400', '407:shieldDomeSmall:disabled:1', '503:missileInterplanetary:off:0']) assert.ok(got.listDef.includes(x), x);
  for (const x of ['122:plasmaTechnology:active:7>8', '199:gravitonTechnology:off:0']) assert.ok(got.listResearch.includes(x), x);
  // queues (timersOverview / timersResources of OL + buildings.md §4.3)
  const q = got.qOver;
  assert.deepEqual([q.building.secs, q.building.title, q.building.targetLevel, q.building.objectId, q.building.downgrade, q.building.listId],
    [ol.timersOverview.buildingCountdown, ol.timersOverview.buildingTitle, ol.timersOverview.buildingTarget, ol.timersOverview.buildingObjectId, false, 1287]);
  assert.deepEqual(q.building.queued, [{ objectId: 2, listId: 1288, targetLevel: 20 }]);
  assert.deepEqual([q.research.secs, q.research.objectId, q.research.targetLevel], [ol.timersOverview.researchCountdown, 122, 8]);
  assert.deepEqual([q.unit.totalSecs, q.unit.nextSecs, q.unit.remaining, q.unit.techId, q.unit.perUnitSecs], [22350, 270, 47, 203, 480]);
  assert.deepEqual(q.unit.queued, [{ id: 204, amount: 100 }]);
  assert.ok(q.cancelIds.some((c) => c.objectId === 1 && c.listId === 1287));
  assert.equal(got.qRes.building.secs, ol.timersResources.buildingCountdown);
  assert.equal(got.qRes.unit.totalSecs, ol.timersResources.unitCountdown);
  assert.equal(got.qRes.research, null);
  assert.equal(got.qOverMoon.building, null);
  // resource settings: OL keys -> ids
  const rs = ol.resourceSettings;
  assert.deepEqual(got.settings, { percents: { 1: rs.metal, 2: rs.cristal, 3: rs.deut, 4: rs.ces, 12: rs.cef, 212: rs.sat, 217: rs.foreuse }, factor: rs.factor });
  assert.deepEqual([got.overview.diameter, got.overview.fieldsUsed, got.overview.fieldsMax, got.overview.tempMin, got.overview.tempMax], [12800, 142, 163, 23, 63]);
  assert.deepEqual([got.overviewMoon.diameter, got.overviewMoon.fieldsUsed, got.overviewMoon.fieldsMax], [8366, 9, 10]);
  assert.equal(got.overview.coords, '1:102:8');
  // technology details (buildings.md §6.2 table)
  assert.deepEqual([got.td1.id, got.td1.current, got.td1.durationSecs, got.td1.costs.metal.value, got.td1.costs.crystal.value, got.td1.energyNeeded],
    [1, 22, 5 * 3600 + 6 * 60 + 4, 448909, 112227, 269]);
  assert.deepEqual([got.td4.current, got.td4.durationSecs, got.td4.costs.metal.value, got.td4.costs.metal.enough, got.td4.canBuild], [24, 16 * 3600 + 4 * 60 + 8, 1262558, false, false]);
  assert.deepEqual([got.td43.current, got.td43.durationSecs], [1, 7 * 86400 + 4 * 86400 + 2 * 3600 + 40 * 60]);
  assert.deepEqual([got.td203.current, got.td203.durationSecs, got.td203.maxAmount], [120, 480, 85]);
  assert.deepEqual([got.td407.current, got.td407.canBuild, got.td407.maxAmount], [1, false, 0]);
  assert.equal(got.td1.nextLevel, 23);
  assert.ok(got.td1.canDowngrade && got.td1.demolish.metal > 0, 'demolish costs');
  assert.equal(got.lt1.id, 1);
  subset(got.tt203, ol.techtree203, 'techtree203');
  subset(got.ss, { economySpeed: ol.serverSettings.economySpeed, researchSpeed: ol.serverSettings.researchSpeed, fleetSpeedWar: 2, fleetSpeedHolding: 1, fleetSpeedPeaceful: 1, galaxies: 9, systems: 499 }, 'serverSettings');
  subset(got.ss, { universeName: 'Universe', debrisFleetPct: 30, debrisDefensePct: 0, debrisDeuterium: false, acs: true, ignoreEmpty: true, ignoreInactive: true, planetFieldBonus: 0, darkMatterBonus: 8000 }, 'serverSettings extra');
  subset(got.titles, ol.titlesShipyard, 'titles');
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('fleet parsers: dispatch page, event list, movement (fleet-expected-parse.json, OL flights)', async () => {
  const p = await fresh();
  const I = { disp: F('fleet-dispatch-planet.html'), pre: F('fleet-dispatch-prefill.html'), none: F('fleet-dispatch-noships.html'), evl: F('fleet-eventlist.html'), mov: F('fleet-movement.html'), yard: F('buildings-shipyard.html') };
  const got = await env.evalOgx(p, (I) => {
    const D = (h) => new DOMParser().parseFromString(h, 'text/html');
    const titles = OGX.parse.titles(D(I.yard));
    const own = new Set(['1:42:8', '2:118:12']);
    const bodies = { p1: { key: 'p1', id: 1, type: 'planet', coords: '1:42:8' }, m5: { key: 'm5', id: 5, type: 'moon', coords: '1:42:8' }, p3: { key: 'p3', id: 3, type: 'planet', coords: '2:118:12' } };
    const evl = OGX.flights.parseEventList(I.evl, { ownCoords: own, bodies, titles });
    return {
      disp: OGX.parse.fleetPage(I.disp), dispDoc: OGX.parse.fleetPage(D(I.disp)), pre: OGX.parse.fleetPage(I.pre), none: OGX.parse.fleetPage(D(I.none)),
      evl, mov: OGX.flights.parseMovement(D(I.mov), { ownCoords: own, bodies, titles }),
      movFlights: OGX.flights._movementToFlights(OGX.flights.parseMovement(D(I.mov), { ownCoords: own, bodies, titles })),
      inFlight: OGX.flights.inFlight(evl), hostile: OGX.flights.hostile(evl).map((f) => f.rowId),
      incoming: Object.fromEntries(Object.entries(OGX.flights.incomingByBody(evl)).map(([k, v]) => [k, v.map((f) => f.rowId)])),
    };
  }, I);
  const fx = T.fixtureJson('fleet-expected-parse.json');
  const ol = T.fixtureJson('ogamelive-expected-parse.json');
  // dispatch page
  const byClass = ol.fleetPage.fleet;
  for (const [cls, n] of Object.entries(byClass)) {
    const id = { fighterLight: 204, fighterHeavy: 205, cruiser: 206, battleship: 207, interceptor: 215, bomber: 211, destroyer: 213, deathstar: 214, reaper: 218, explorer: 219,
      transporterSmall: 202, transporterLarge: 203, colonyShip: 208, recycler: 209, espionageProbe: 210 }[cls];
    assert.equal(got.disp.shipsOnPlanet[id] || 0, n, cls);
  }
  assert.equal(Object.keys(got.disp.shipsOnPlanet).length, 7);
  assert.deepEqual(got.disp.slots, { used: ol.fleetPage.slots.used, max: ol.fleetPage.slots.max });
  assert.deepEqual(got.disp.expSlots, { used: ol.fleetPage.expeSlots.used, max: ol.fleetPage.expeSlots.max });
  assert.deepEqual(got.dispDoc.shipsOnPlanet, got.disp.shipsOnPlanet);
  assert.deepEqual(got.disp.currentPlanet, { galaxy: 1, system: 42, position: 8, type: 1, name: 'Homeworld' });
  assert.deepEqual([got.disp.maxGalaxy, got.disp.maxSystem], [9, 499]);
  assert.ok(got.disp.speedFactors.peaceful > 0 && got.disp.speedFactors.war > 0 && got.disp.speedFactors.holding > 0);
  assert.ok(got.disp.ownBodies.length >= 1 && got.disp.ownBodies.every((b) => b.g && b.s && b.p && (b.type === 1 || b.type === 3)));
  assert.equal(got.disp.resources.metal, 152347);
  assert.deepEqual(got.pre.targetPlanet, { galaxy: 1, system: 45, position: 6, type: 1, name: 'Homeworld' });
  assert.equal(got.pre.mission, 1);
  assert.equal(got.none.noShips, true);
  // event list vs fleet-expected-parse.json (arrival in ServerMs here)
  assert.deepEqual(got.evl.map((r) => r.rowId), fx.eventlist.map((r) => r.rowId));
  assert.deepEqual(got.evl.map((r) => r.realMissionId), fx.eventlist.map((r) => r.realMissionId));
  assert.deepEqual(got.evl.map((r) => r.arrival / 1000), fx.eventlist.map((r) => r.arrival));
  assert.deepEqual(got.evl.map((r) => r.returnFlight), fx.eventlist.map((r) => r.returnFlight));
  assert.deepEqual(got.evl.map((r) => r.units), fx.eventlist.map((r) => r.units));
  assert.deepEqual(got.evl.map((r) => r.recallable), fx.eventlist.map((r) => r.recallable));
  for (const e of fx.eventlist.filter((r) => r.status)) assert.equal(got.evl.find((r) => r.rowId === e.rowId).status, e.status, 'status ' + e.rowId);
  const r1203 = got.evl.find((r) => r.rowId === 1203);
  assert.deepEqual([r1203.cargo.metal, r1203.cargo.crystal, r1203.cargo.deuterium, r1203.ships[203]], [50000, 30000, 10790, 5]);
  const r1199 = got.evl.find((r) => r.rowId === 1199);
  assert.deepEqual([r1199.from, r1199.to, r1199.destKey], ['1:42:9', '1:42:8', 'p1']);
  assert.deepEqual(got.evl.filter((r) => r.synthetic).map((r) => [r.rowId, r.synthetic]), [[890090, 'holdEnd'], [1001201, 'return'], [1001200, 'return'], [1001202, 'return']]);
  // the same rows as OGame Live's flights recipe (ogamelive-expected-parse.json)
  for (const [id, f] of Object.entries(ol.flights)) {
    const g = got.evl.find((r) => String(r.rowId) === id);
    assert.ok(g, 'flight ' + id);
    assert.deepEqual([g.realMissionId, g.synthetic, g.arrival, g.missionType, g.returnFlight, g.own, g.units], [f.realMissionId, f.synthetic, f.arrivalTime, f.missionType, f.returnFlight, f.own, f.detailsFleet], 'flight ' + id);
    assert.deepEqual([g.from, g.to], [f.coords.from, f.coords.dest], 'coords ' + id);
    assert.deepEqual([g.cargo.metal, g.cargo.crystal, g.cargo.deuterium], [f.resources.M, f.resources.C, f.resources.D], 'cargo ' + id);
    assert.equal(g.destKey, f.destination, 'destination ' + id);
  }
  // movement page
  const mv = got.mov.map((r) => ({ id: r.id, missionType: r.missionType, returnFlight: r.returnFlight, arrival: r.arrival / 1000, status: r.missionClass,
    timer: r.timer / 1000, returnArrival: r.returnArrival === null ? null : r.returnArrival / 1000, origin: r.origin, destination: r.destination }));
  assert.deepEqual(mv, fx.movement);
  // movement -> event-list-shaped flights: same synthetic ids for own missions
  const ids = got.movFlights.map((f) => f.rowId);
  for (const id of [890090, 1001201, 1001200, 1001202, 1201, 1203]) assert.ok(ids.includes(id), 'movement flight ' + id);
  assert.ok(!ids.includes(1202), 'expedition in hold has no arrival row');
  // derived views
  assert.equal(got.inFlight.metal, ol.flights['1199'].resources.M + ol.flights['1201'].resources.M + ol.flights['890090'].resources.M + ol.flights['1203'].resources.M);
  assert.deepEqual(got.hostile, [1210]);
  assert.ok(got.incoming.p1.includes(1210) && got.incoming.p1.includes(1199) && got.incoming.p1.includes(1001200));
  assert.ok(got.incoming.p3.includes(1211));
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('galaxy parsers (galaxy-expected-parse.json)', async () => {
  const p = await fresh();
  const names = ['galaxy-ajax-1-42.json', 'galaxy-ajax-1-45.json', 'galaxy-ajax-1-45-from-moon.json', 'galaxy-ajax-1-42-discoverer.json', 'galaxy-ajax-1-44-empty.json'];
  const I = Object.fromEntries(names.map((n) => [n, F(n)]));
  I.hsPage = F('galaxy-highscore-page.html'); I.hsAllies = F('galaxy-highscore-ajax-alliances.html'); I.hsMil = F('galaxy-highscore-ajax-players-military.html'); I.hsP2 = F('galaxy-highscore-ajax-players-page2.html');
  const got = await env.evalOgx(p, (I) => {
    const out = {};
    for (const [k, v] of Object.entries(I)) if (k.endsWith('.json')) { const s = OGX.galaxy.parseSystem(JSON.parse(v)); if (s) delete s.t; out[k] = s; }
    const hs = OGX.parse.highscorePlayers(I.hsPage);
    out.hs = Object.assign({}, hs, { rows: hs.rows.filter((r) => r.rank <= 3 || r.me) });
    out.allies = OGX.parse.highscoreAlliances(I.hsAllies);
    out.mil = OGX.parse.highscorePlayers(I.hsMil).rows[0];
    out.top2 = OGX.parse.topScore(I.hsP2);
    out.top1 = OGX.parse.topScore(I.hsPage);
    const c = OGX.galaxy._compact(OGX.galaxy.parseSystem(JSON.parse(I['galaxy-ajax-1-42.json'])));
    out.roundTrip = OGX.galaxy._expand(1, 42, JSON.parse(JSON.stringify(c)));
    return out;
  }, I);
  const exp = T.fixtureJson('galaxy-expected-parse.json');
  subset(got['galaxy-ajax-1-42.json'], exp['galaxy-ajax-1-42.json'], '1-42');
  subset(got['galaxy-ajax-1-45.json'], exp['galaxy-ajax-1-45.json'], '1-45');
  subset(got['galaxy-ajax-1-45-from-moon.json'].positions.map((x) => ({ position: x.position, canPhalanx: x.canPhalanx, canMissile: x.canMissile })), exp['galaxy-ajax-1-45-from-moon.json'], 'from-moon');
  subset(got['galaxy-ajax-1-42-discoverer.json'].expeditionDebris, exp['galaxy-ajax-1-42-discoverer.json (expeditionDebris)'], 'discoverer');
  subset(got['galaxy-ajax-1-44-empty.json'], exp['galaxy-ajax-1-44-empty.json'], 'empty');
  subset(got.hs, exp['galaxy-highscore-page.html (first 3 + me)'], 'highscore');
  subset(got.allies, exp['galaxy-highscore-ajax-alliances.html'], 'alliances');
  subset(got.mil, exp['post /ajax/highscore military (first row)'], 'military');
  const ol = T.fixtureJson('ogamelive-expected-parse.json');
  assert.deepEqual([got.top2.playerId, got.top2.points], [ol.topScorePage2.rank, ol.topScorePage2.points]);
  assert.deepEqual([got.top1.rank, got.top1.points], [1, 1284330]);
  const rt = got.roundTrip;
  const orig = got['galaxy-ajax-1-42.json'];
  assert.deepEqual(rt.positions, orig.positions, 'compact cache round trip');
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('messages parsers (messages-expected-parse.json, recipes ported unchanged)', async () => {
  const p = await fresh();
  const I = {
    espionage: F('messages-ajax-fleets-espionage.html'), combat: F('messages-ajax-fleets-combat_reports.html'), exp1: F('messages-ajax-fleets-expeditions.html'),
    exp2: F('messages-ajax-fleets-expeditions-page2.html'), transport: F('messages-ajax-fleets-transport.html'), other: F('messages-ajax-fleets-other.html'),
    economy: F('messages-ajax-economy-economy.html'), universe: F('messages-ajax-universe-universe.html'),
    espFull: F('messages-ajax-message-2051-espionage-full.html'), espMoon: F('messages-ajax-message-2044-espionage-moon-partial.html'), espDebris: F('messages-ajax-message-2038-espionage-debris.html'),
    batWin: F('messages-ajax-message-2053-battle-attacker-win.html'), batLoss: F('messages-ajax-message-2050-battle-defender-loss.html'), batExp: F('messages-ajax-message-2034-battle-expedition-pirates.html'),
  };
  const got = await env.evalOgx(p, (I) => {
    const M = OGX.messages, R = M._recipes;
    const P = (h) => new DOMParser().parseFromString(h, 'text/html');
    const li = (doc, id) => doc.querySelector(`li.msg[data-msg-id="${id}"]`);
    const listWithKeys = (html, subtab) => {
      const doc = P(html);
      const items = M.parse.list(doc);
      const l = { page: items.page, totalPages: items.totalPages, messages: items.map((m) => ({ id: m.id, unread: m.unread, title: m.title, titleClass: m.titleClass, date: m.date, ts: m.ts, from: m.from, detailsUrl: m.detailsUrl, key: M.classify(li(doc, m.id), subtab), isNew: m.isNew, sender: m.sender })) };
      return { doc, l };
    };
    const r = {};
    { const { doc, l } = listWithKeys(I.espionage, 'espionage'); r.espionageList = l;
      r.espionageShort = l.messages.filter((m) => m.key === 'espionage_report').map((m) => M.parse.espionageShort(li(doc, m.id)));
      r.espionageDetected = l.messages.filter((m) => m.key === 'espionage_detected').map((m) => M.parse.espionageDetected(li(doc, m.id))); }
    { const { doc, l } = listWithKeys(I.combat, 'combat_reports'); r.combatList = l;
      r.battleShort = l.messages.filter((m) => m.key === 'battle_report').map((m) => M.parse.battleShort(li(doc, m.id))); }
    { const a = listWithKeys(I.exp1, 'expeditions'); const b = listWithKeys(I.exp2, 'expeditions');
      r.expeditionPages = [a.l.page + '/' + a.l.totalPages, b.l.page + '/' + b.l.totalPages];
      r.expeditions = [...a.l.messages.map((m) => M.parse.expedition(li(a.doc, m.id))), ...b.l.messages.map((m) => M.parse.expedition(li(b.doc, m.id)))]; }
    for (const [name, html, sub] of [['transport', I.transport, 'transport'], ['other', I.other, 'other'], ['economy', I.economy, 'economy'], ['universe', I.universe, 'universe']]) {
      const { doc, l } = listWithKeys(html, sub);
      r[name] = l.messages.map((m) => (/^(return_of_fleet|fleet_deployment|transport_|debris_field_harvest|acs_defend)/.test(m.key)
        ? M.parse.fleetMessage(li(doc, m.id), m.key) : { id: m.id, key: m.key, title: m.title }));
    }
    r.espionageFull = [I.espFull, I.espMoon, I.espDebris].map((h) => M.parse.espionageFull(P(h)));
    r.battleFull = [I.batWin, I.batLoss, I.batExp].map((h) => M.parse.battleFull(P(h), h));
    // raw recipe output, byte-for-byte comparable
    r.raw = { battleFull: [I.batWin, I.batLoss, I.batExp].map((h) => R.parseBattleFull(P(h), h)), espionageFull: [I.espFull, I.espMoon, I.espDebris].map((h) => R.parseEspionageFull(P(h))) };
    return r;
  }, I);
  const exp = T.fixtureJson('messages-expected-parse.json');
  for (const k of ['espionageList', 'espionageShort', 'espionageDetected', 'combatList', 'battleShort', 'expeditionPages', 'expeditions', 'transport', 'other', 'economy', 'universe', 'espionageFull', 'battleFull']) {
    subset(got[k], exp[k], k);
  }
  assert.deepEqual(got.raw.battleFull, exp.battleFull, 'parseBattleFull unchanged');
  assert.deepEqual(got.raw.espionageFull, exp.espionageFull, 'parseEspionageFull unchanged');
  // DESIGN aliases
  assert.equal(got.espionageList.messages[0].isNew, true);
  assert.equal(got.espionageList.messages[0].sender, 'Fleet Command');
  assert.equal(got.battleShort[0].coords, '1:39:4');
  assert.equal(got.battleShort[0].lootSum, exp.battleShort[0].lootApprox);
  assert.equal(got.espionageShort[0].target.coordsStr, '1:45:9');
  assert.ok(got.expeditions.find((e) => e.key === 'expedition_gain_ships').ships[202] === 5);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('fleet messages in every OgameX locale (t_messages.php en/fr/zh-TW; nl and it fall back to en)', async () => {
  const p = await fresh();
  const html = F('messages-ajax-fleets-transport.html');
  const got = await env.evalOgx(p, (html) => {
    const M = OGX.messages;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const tpl = doc.querySelector('li.msg[data-msg-id]');
    const A = '<a href="/galaxy?galaxy=1&system=42&position=8" class="txt_link">Homeworld [1:42:8]</a>';
    const B = '<a href="/galaxy?galaxy=2&system=118&position=12" class="txt_link">Colony [2:118:12]</a>';
    const D = '<a href="/galaxy?galaxy=2&system=118&position=12" class="txt_link">[2:118:12]</a>';
    const bodies = {
      fr_transport: `Votre flotte de ${A} atteint ${B} et livre ses marchandises :<br />\nMétal : 75,000 Cristal : 40,000 Deutérium : 12,500`,
      fr_return: `Votre flotte revient du ${B} au ${A} et a livré sa marchandise :<br />\n<br />\nMétal : 1,234 Cristal : 0<br />\nDeutérium : 5`,
      fr_return_empty: `Votre flotte revient du ${B} au ${A}.<br />\n<br />\nLa flotte ne livre pas de marchandises.`,
      fr_deploy: `Une de vos flottes de ${A} a atteint ${B} et a livré ses marchandises :<br />\n<br />\nMétal : 10<br />\nCristal : 20<br />\nDeutérium : 30`,
      fr_harvest: `Vos Recycleur (12 vaisseaux) ont une capacité de stockage totale de 240,000. Sur la cible ${D}, 100,000 Métal, 50,000 Cristal et 0 Deutérium flottent dans l'espace. Vous avez récolté 100,000 Métal, 50,000 Cristal et 0 Deutérium.`,
      zh_transport: `您來自 ${A} 的艦隊到達 ${B} 並運送了貨物：<br />\n金屬：75,000 晶體：40,000 重氫：12,500`,
      zh_received: `一支來自 ${A} 的來襲艦隊已到達您的星球 ${B} 並運送了貨物：<br />\n金屬：1 晶體：2 重氫：3`,
      zh_harvest: `您的 回收船（3 艘船）總儲存容量為 60,000。在目標 ${D} 太空中漂浮著 9,000 金屬、8,000 晶體和 7 重氫。您收穫了 9,000 金屬、8,000 晶體和 7 重氫。`,
      en_transport: `Your fleet from ${A} reaches ${B} and delivers its goods:<br />\nMetal: 75,000 Crystal: 40,000 Deuterium: 12,500`,
      en_harvest: `Your Recycler (2 ships) have a total storage capacity of 40,000. At the target ${D}, 5,000 Metal, 6,000 Crystal and 0 Deuterium are floating in space. You have harvested 5,000 Metal, 6,000 Crystal and 0 Deuterium.`,
    };
    const out = {};
    for (const [k, b] of Object.entries(bodies)) {
      const li = tpl.cloneNode(true);
      li.querySelector('.msg_content').innerHTML = b;
      const key = M.classify(li, 'transport');
      const r = M.parse.fleetMessage(li, key);
      out[k] = { key, res: r.resources || null, harvest: r.harvest || null, from: r.from && r.from.coordsStr, to: r.to && r.to.coordsStr };
    }
    return out;
  }, html);
  const R = (metal, crystal, deuterium) => ({ metal, crystal, deuterium });
  assert.deepEqual(got.fr_transport, { key: 'transport_arrived', res: R(75000, 40000, 12500), harvest: null, from: '1:42:8', to: '2:118:12' });
  assert.deepEqual(got.fr_return, { key: 'return_of_fleet_with_resources', res: R(1234, 0, 5), harvest: null, from: '2:118:12', to: '1:42:8' });
  assert.equal(got.fr_return_empty.key, 'return_of_fleet');
  assert.equal(got.fr_return_empty.res, null);
  assert.deepEqual([got.fr_deploy.key, got.fr_deploy.res], ['fleet_deployment_with_resources', R(10, 20, 30)]);
  assert.deepEqual([got.zh_transport.key, got.zh_transport.res], ['transport_arrived', R(75000, 40000, 12500)]);
  assert.deepEqual([got.zh_received.key, got.zh_received.res], ['transport_received', R(1, 2, 3)]);
  assert.deepEqual(got.en_transport, got.fr_transport, 'same result in en and fr');
  const H = (ship, ships, capacity, f, h) => ({ ship, ships, capacity, field: f, harvested: h });
  assert.equal(got.fr_harvest.key, 'debris_field_harvest');
  assert.deepEqual(got.fr_harvest.harvest, H('Recycleur', 12, 240000, R(100000, 50000, 0), R(100000, 50000, 0)));
  assert.equal(got.fr_harvest.to, '2:118:12');
  assert.deepEqual(got.zh_harvest.harvest, H('回收船', 3, 60000, R(9000, 8000, 7), R(9000, 8000, 7)));
  assert.deepEqual(got.en_harvest.harvest, H('Recycler', 2, 40000, R(5000, 6000, 0), R(5000, 6000, 0)));
  assert.deepEqual(env.ogxErrors(), []);
});
