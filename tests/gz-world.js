'use strict';
// Stateful GALAXYZ (2Moons 1.8 fork) world for the bot mock (BOT_CONTRACT C7.1 / C7.2, BOT_DESIGN §10). No dependencies.
//
//   const { createWorld, loadScenario } = require('./gz-world');
//   const world = createWorld('basic');             // name of fixtures/galaxyz/bot-scenarios/<name>.json, or a WorldSpec object
//   world.clock.nowUnix() / world.clock.advance(sec) ; world.process(now) ; world.snapshot()
//   world.send({ originId, ships, target: { galaxy, system, position, type }, mission, speed, cargo, staytime }) -> { ok, fleet } | { ok: false, error }
//   world.recall(fleetId) ; world.order('buildings'|'research'|'shipyard', bodyId, params) ; world.viewGalaxy(bodyId, g, s)
//   world.addHostile({ at, from, toBodyId, mission, ships, ownerId, ownerName, flightSec }) ; world.setVacation(otherId, on) ; world.logout() ; world.captcha(on)
//
// Server logic follows upstream 2Moons (scratchpad/src/2Moons) [UPSTREAM]: FleetFunctions (distance, duration, consumption,
// GetAvailableMissions, SendFleetBack), ShowFleetStep3Page checks, MissionCase* (attack via OGX.botSim when present, spy
// thresholds + counter-espionage, recycling, transport, deploy, colonisation, expedition, hold, return), ShowFleetAjaxPage.
// Deterministic for spec.seed: every random draw comes from one seeded generator (xmur3 + sfc32) in event order.
// Times are unix seconds of the world clock (real time x speedup + advance()); the wall clock printed on pages is
// unix + spec.tzOffsetSec (server zone UTC+2 on Aeternum).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SCENARIO_DIR = path.join(ROOT, 'fixtures', 'galaxyz', 'bot-scenarios');
const CATALOG_FILE = path.join(ROOT, 'shared', 'core', '08-catalog-data.js');
const BOTSIM_FILE = path.join(ROOT, 'ogamex-bot', 'modules', 'botsim', 'botsim.js');

const RES = ['metal', 'crystal', 'deuterium'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Mission labels as the fork prints them (7 Colonize / 8 Recycle REAL, others upstream; all parse with parse.gz.missionIdByName).
const MISSION_NAMES = { 1: 'Attack', 2: 'Alliance Attack', 3: 'Transport', 4: 'Deploy', 5: 'Hold', 6: 'Spy', 7: 'Colonize', 8: 'Recycle', 9: 'Destroy', 10: 'Missile attack', 11: 'DM Investigation', 15: 'Expedition' };
const FLEET_STYLE = { 1: 'attack', 2: 'federation', 3: 'transport', 4: 'deploy', 5: 'hold', 6: 'espionage', 7: 'colony', 8: 'harvest', 9: 'destroy', 10: 'missile', 11: 'transport', 15: 'transport' };
const TYPE_PLANET = { 1: 'Planet', 2: 'Debris Field', 3: 'Moon' };
const TYPE_SHORT = { 1: 'P', 2: 'D', 3: 'M' };
const LIVE = 'https://ogamex.eu/Aeternum/game.php';

// ------------------------------------------------------------------ catalog
let catalogCache = null;
/** GALAXYZ element catalog (shared/core/08-catalog-data.js evaluated in a sandbox): { byId: Map, list, ships, defense, buildings, research }. */
function catalog() {
  if (catalogCache) return catalogCache;
  const sb = { console }; sb.window = sb; sb.OGX = {};
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(CATALOG_FILE, 'utf8'), sb, { filename: CATALOG_FILE });
  const list = sb.OGX.catalog._data;
  const byId = new Map(list.map((o) => [o.id, o]));
  const ids = (pred) => list.filter(pred).map((o) => o.id).sort((a, b) => a - b);
  catalogCache = {
    list, byId,
    ships: ids((o) => o.type === 'ship'),
    defense: ids((o) => o.type === 'defense' && o.id < 500),
    missiles: ids((o) => o.id >= 500 && o.id < 600),
    buildings: ids((o) => o.type === 'building' || o.type === 'station'),
    research: ids((o) => o.type === 'research'),
    name: (id) => (byId.get(+id) || {}).en || 'Element ' + id,
  };
  return catalogCache;
}

let botsimCache;
/** OGX.botSim (node build) when the sim agent's file exists and exports battle/steal, else null (forced outcomes). */
function botsim() {
  if (botsimCache !== undefined) return botsimCache;
  botsimCache = null;
  try {
    if (fs.existsSync(BOTSIM_FILE)) {
      const S = require(BOTSIM_FILE);
      if (S && typeof S.battle === 'function' && typeof S.steal === 'function') botsimCache = S;
    }
  } catch (e) { botsimCache = null; }
  return botsimCache;
}

// ------------------------------------------------------------------ helpers
/** xmur3 hash -> sfc32 generator; int(min, max) inclusive like PHP mt_rand. */
function makeRng(seed) {
  const str = String(seed);
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  const next = () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
  let a = next(); let b = next(); let c = next(); let d = next();
  const float = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  return { float, int: (min, max) => { min = Math.floor(min); max = Math.floor(max); return max <= min ? min : min + Math.floor(float() * (max - min + 1)); }, seed };
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const parseCoords = (c) => String(c).split(':').map(Number);
const coordsOf = (g, s, p) => `${g}:${s}:${p}`;
const num = (v, d = 0) => (v === undefined || v === null || v === '' || isNaN(+v) ? d : +v);
const sumShips = (o) => Object.values(o || {}).reduce((s, n) => s + (+n || 0), 0);
const cleanShips = (o) => { const out = {}; for (const [k, v] of Object.entries(o || {})) if (Math.floor(+v) > 0) out[+k] = Math.floor(+v); return out; };
/** pretty_number: '.' thousands, no decimals (floor like PHP number_format of a floored value). */
const pretty = (n) => { const v = Math.floor(Math.abs(+n || 0)); const s = String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return (+n < 0 ? '-' : '') + s; };
/** floatToString: raw number, no grouping, at most 2 decimals (upstream helper used in data JSON and textForBlind). */
const raw = (n) => { const v = Math.round((+n || 0) * 100) / 100; return Number.isInteger(v) ? String(v) : String(v); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** PHP sprintf('%.0f'): nearest, exact .5 ties to even (what the spy report cells show). */
function roundHalfEven(x) {
  const f = Math.floor(x); const d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

function wallParts(unix, tzOffsetSec) {
  const d = new Date((Math.floor(unix) + tzOffsetSec) * 1000);
  return { Y: d.getUTCFullYear(), M: d.getUTCMonth(), D: d.getUTCDate(), h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds(), dow: d.getUTCDay() };
}
const p2 = (n) => String(n).padStart(2, '0');
/** php_tdformat 'd. M Y, H:i:s' -> '30. Oct 2026, 10:20:01' (server wall clock). */
function fmtDate(unix, tz) { const w = wallParts(unix, tz); return `${p2(w.D)}. ${MONTHS[w.M]} ${w.Y}, ${p2(w.h)}:${p2(w.m)}:${p2(w.s)}`; }
function fmtTime(unix, tz) { const w = wallParts(unix, tz); return `${p2(w.h)}:${p2(w.m)}:${p2(w.s)}`; }
function fmtRest(sec) { sec = Math.max(0, Math.floor(sec)); return `${p2(Math.floor(sec / 3600))}:${p2(Math.floor(sec / 60) % 60)}:${p2(sec % 60)}`; }

// ------------------------------------------------------------------ scenarios
function loadScenario(name) {
  const f = path.join(SCENARIO_DIR, path.basename(String(name)).replace(/\.json$/, '') + '.json');
  if (!fs.existsSync(f)) throw new Error('gz-world: no scenario ' + name + ' (' + f + ')');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function scenarioNames() { try { return fs.readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort(); } catch (e) { return []; } }

const UNIVERSE_DEFAULTS = { galaxies: 9, systems: 499, maxPlanets: 15, fleetDebrisPct: 30, defDebrisPct: 0, resourceMultiplier: 22000, storageMultiplier: 5,
  maxDmMissions: 5, moonFactor: 1, moonChance: 20, debrisMoon: 1, topPoints: 1000000, galaxyDeuteriumCost: 10, ecoSpeed: null, buildTimeSec: null, researchTimeSec: null,
  unitTimeSec: null, minFleetTime: 5, spyProbesSetting: 3, inactiveSec: 604800, inactiveLongSec: 2419200, maxBuildQueue: 5, maxFleetsPerAcs: 16 };

// ------------------------------------------------------------------ the world
function createWorld(specOrName, opts = {}) {
  const spec = clone(typeof specOrName === 'string' ? loadScenario(specOrName) : (specOrName || {}));
  const C = catalog();
  const U = Object.assign({}, UNIVERSE_DEFAULTS, spec.universe || {});
  const gamespeed = num(spec.gamespeed, 7);           // fleet_speed / 2500 (data.gamespeed)
  const haltSpeed = num(spec.haltSpeed, 1);
  const ecoSpeed = U.ecoSpeed != null ? +U.ecoSpeed : gamespeed;
  const tz = num(spec.tzOffsetSec, 7200);
  const rng = makeRng(spec.seed !== undefined ? spec.seed : 1);

  // ---------- clock
  let base = spec.startUnix ? +spec.startUnix : Math.floor((opts.now || Date.now()) / 1000);
  let t0 = opts.now || Date.now();
  let offset = 0;
  let speedup = num(spec.speedup, 1);
  const clock = {
    nowExact() { return base + ((Date.now() - t0) / 1000) * speedup + offset; },
    nowUnix() { return Math.floor(clock.nowExact()); },
    advance(sec) { offset += +sec || 0; world.process(clock.nowUnix()); return clock.nowUnix(); },
    get speedup() { return speedup; },
    set speedup(v) { base = clock.nowExact(); t0 = Date.now(); offset = 0; speedup = +v || 1; },
    tz, wall: (unix) => wallParts(unix === undefined ? clock.nowUnix() : unix, tz),
    fmtDate: (unix) => fmtDate(unix, tz), fmtTime: (unix) => fmtTime(unix, tz),
  };
  const now0 = clock.nowUnix();

  // ---------- player
  const P = spec.player || {};
  const player = {
    name: P.name || 'vodoleyko1992', id: num(P.id, 4377), research: Object.assign({}, P.research || {}), officers: Object.assign({}, P.officers || {}),
    darkMatter: num(P.darkMatter, 0), vacation: !!P.vacation, spyMessagesMode: num(P.spyMessagesMode, 0), maxPlanets: num(P.maxPlanets, 6),
    bonusPct: P.bonusPct || null, rank: num(P.rank, 194), points: num(P.points, 50000000), allyId: P.allyId || 0,
    spyProbes: num(P.spyProbes, U.spyProbesSetting), extraSlots: num(P.extraSlots, 0),
    storageFactor: P.storageFactor !== undefined ? +P.storageFactor : 0.5 * num((P.officers || {})[607], 0),
    flyTimeFactor: num(P.flyTimeFactor, 0), authLevel: num(P.authLevel, 0),
  };
  const lv = (id) => num(player.research[id], 0);

  // ---------- bodies
  const bodies = [];
  function mkBody(b) {
    const [g, s, p] = parseCoords(b.coords);
    const isMoon = b.type === 'moon';
    const levels = Object.assign({}, b.levels || {});
    const fieldsUsed = b.fieldsUsed !== undefined ? +b.fieldsUsed : Object.values(levels).reduce((x, y) => x + (+y || 0), 0);
    return {
      id: +b.id, type: isMoon ? 'moon' : 'planet', planetId: isMoon ? +b.planetId || null : null, moonId: null,
      name: b.name || (isMoon ? 'Moon' : 'Colony'), coords: coordsOf(g, s, p), g, s, p,
      tempMax: num(b.tempMax, isMoon ? 0 : 40), tempMin: b.tempMin !== undefined ? +b.tempMin : num(b.tempMax, isMoon ? 0 : 40) - 40,
      fieldsMax: num(b.fieldsMax, isMoon ? 1 : 200), fieldsUsed, diameter: num(b.diameter, isMoon ? 8888 : 12800),
      image: b.image || (isMoon ? 'mond' : 'dschjungelplanet07'),
      res: { metal: num((b.res || {}).metal), crystal: num((b.res || {}).crystal), deuterium: num((b.res || {}).deuterium) },
      levels, ships: cleanShips(b.ships), defense: cleanShips(b.defense),
      perHour: b.perHour || null, storage: b.storage || null, energy: b.energy || null,
      buildQueue: [], shipyardQueue: [], lastUpdate: now0, created: now0, sat0: num(cleanShips(b.ships)[212]),
    };
  }
  for (const b of spec.bodies || []) bodies.push(mkBody(b));
  for (const m of bodies.filter((x) => x.type === 'moon')) {
    const pl = bodies.find((x) => x.id === m.planetId) || bodies.find((x) => x.type === 'planet' && x.coords === m.coords);
    if (pl) { pl.moonId = m.id; m.planetId = pl.id; }
  }

  // ---------- other players
  const others = (spec.others || []).map((o) => ({
    id: +o.id, name: o.name, status: o.status || '', rank: num(o.rank, 1000), points: num(o.points, 1000), research: Object.assign({}, o.research || {}),
    allyId: o.allyId || 0, allyName: o.allyName || null, allyTag: o.allyTag || null, protection: o.protection || null, authAttack: num(o.authAttack, 0),
    planets: (o.planets || []).map((p) => {
      const [g, s, pos] = parseCoords(p.coords);
      return {
        id: +p.id, coords: coordsOf(g, s, pos), g, s, p: pos, name: p.name || 'Planet', image: p.image || 'normaltempplanet02',
        res: { metal: num((p.res || {}).metal), crystal: num((p.res || {}).crystal), deuterium: num((p.res || {}).deuterium) }, energy: num(p.energy, 0),
        levels: Object.assign({}, p.levels || {}), ships: cleanShips(p.ships), defense: cleanShips(p.defense), perHour: p.perHour || null,
        moon: p.moon ? { id: +p.moon.id, name: p.moon.name || 'Moon', diameter: num(p.moon.diameter, 8888), tempMin: num(p.moon.tempMin, -20),
          res: Object.assign({ metal: 0, crystal: 0, deuterium: 0 }, p.moon.res || {}), levels: Object.assign({}, p.moon.levels || {}),
          ships: cleanShips(p.moon.ships), defense: cleanShips(p.moon.defense) } : null,
        lastActivity: p.lastActivity !== undefined ? p.lastActivity : null, lastUpdate: now0,
      };
    }),
  }));

  // ---------- debris (stored per position like upstream der_metal / der_crystal on the planet row)
  const debris = new Map();
  for (const b of spec.bodies || []) if (b.debris) debris.set(coordsOf(...parseCoords(b.coords)), { metal: num(b.debris.metal), crystal: num(b.debris.crystal) });
  for (const o of spec.others || []) for (const p of o.planets || []) if (p.debris) debris.set(coordsOf(...parseCoords(p.coords)), { metal: num(p.debris.metal), crystal: num(p.debris.crystal) });
  for (const d of spec.debris || []) debris.set(coordsOf(...parseCoords(d.coords)), { metal: num(d.metal), crystal: num(d.crystal) });

  let nextFleetId = num(spec.firstFleetId, 396900);
  let nextMsgId = num(spec.firstMessageId, 520500);
  let nextBodyId = Math.max(254106, ...bodies.map((b) => b.id), ...others.flatMap((o) => o.planets.flatMap((p) => [p.id, p.moon ? p.moon.id : 0]))) + 1;

  const world = {
    spec, clock, player, bodies, others, debris, fleets: [], messages: [], raports: {}, researchQueue: [],
    log: { sent: [], recalled: [], builds: [], ajax: [], galaxyViews: [], refusals: [], events: [], script: [] },
    session: { loggedOut: false, captcha: false }, universe: U, gamespeed, haltSpeed, ecoSpeed, rng,
    combatMode: spec.combat || 'sim', expeditionOutcomes: clone(spec.expeditionOutcomes || []), combatFallback: null,
    catalog: C, MISSION_NAMES, FLEET_STYLE, TYPE_PLANET, TYPE_SHORT, fmt: { pretty, raw, esc, fmtRest, roundHalfEven },
  };

  // ---------- lookups
  world.body = (id) => bodies.find((b) => b.id === +id) || null;
  world.planets = () => bodies.filter((b) => b.type === 'planet');
  world.other = (x) => {
    if (x === undefined || x === null) return null;
    if (typeof x === 'number' || /^\d+$/.test(String(x))) return others.find((o) => o.id === +x) || null;
    return others.find((o) => o.planets.some((p) => p.coords === x)) || others.find((o) => o.name === x) || null;
  };
  /** Who is at coords: { coords, type, own: body|null, other: player|null, planet: planet obj|null, moon, exists } (type 3 = moon of that position). */
  world.at = (coords, type = 1) => {
    const own = bodies.find((b) => b.coords === coords && (type === 3 ? b.type === 'moon' : b.type === 'planet')) || null;
    const ownPlanet = bodies.find((b) => b.coords === coords && b.type === 'planet') || null;
    let other = null; let planet = null;
    for (const o of others) { const p = o.planets.find((x) => x.coords === coords); if (p) { other = o; planet = p; break; } }
    const target = own || (planet ? (type === 3 ? (planet.moon ? Object.assign(planet.moon, { coords, g: planet.g, s: planet.s, p: planet.p }) : null) : planet) : null);
    return { coords, type, own, ownPlanet, other, planet, target, occupied: !!(ownPlanet || planet), exists: !!target };
  };
  world.isInactive = (o) => /i/i.test(o.status || '');
  world.isVacation = (o) => /v/.test(o.status || '');

  // ---------- formulas [UPSTREAM class.FleetFunctions.php]
  const DRIVE = { 1: [115, 0.1], 2: [117, 0.2], 3: [118, 0.3] };
  world.shipSpeed = (id) => {
    const o = C.byId.get(+id); if (!o || !o.props) return 0;
    let t = o.props.speedTech || 0;
    if (t === 4) t = lv(117) >= 5 ? 2 : 1;
    if (t === 5) t = lv(118) >= 8 ? 3 : 2;
    const d = DRIVE[t];
    return d ? o.props.speed * (1 + d[1] * lv(d[0])) : 0;
  };
  world.shipFuel = (id) => { const o = C.byId.get(+id); if (!o || !o.props) return 0; return (+id === 202 && lv(117) >= 5) || (+id === 211 && lv(118) >= 8) ? o.props.fuel2 : o.props.fuel; };
  world.capacityOf = (ships, withStorage = true) => { let c = 0; for (const [id, n] of Object.entries(ships || {})) { const o = C.byId.get(+id); c += (o && o.props ? o.props.cargo : 0) * n; } return c * (withStorage ? 1 + player.storageFactor : 1); };
  world.maxSpeed = (ships) => Math.min(...Object.keys(ships).map((id) => world.shipSpeed(id)));
  world.distance = (a, b) => (a[0] !== b[0] ? Math.abs(a[0] - b[0]) * 20000 : a[1] !== b[1] ? Math.abs(a[1] - b[1]) * 95 + 2700 : a[2] !== b[2] ? Math.abs(a[2] - b[2]) * 5 + 1000 : 5);
  world.flyFactor = () => Math.max(0, 1 + player.flyTimeFactor);
  /** Seconds one way (flotten.js / fleet.md §4 rounding). */
  world.duration = (speed10, dist, maxSpeed) => Math.max(Math.round((3500 / (speed10 * 0.1) * Math.sqrt(dist * 10 / maxSpeed) + 10) / gamespeed) * world.flyFactor(), U.minFleetTime);
  world.consumption = (ships, sec, dist) => {
    let c = 0;
    for (const [id, n] of Object.entries(ships)) {
      const spd = 35000 / (Math.round(sec) * gamespeed - 10) * Math.sqrt(dist * 10 / world.shipSpeed(id));
      c += world.shipFuel(id) * n * dist / 35000 * (spd / 10 + 1) ** 2;
    }
    return Math.round(c) + 1;
  };
  world.slotsMax = () => 1 + lv(108) + player.extraSlots;
  world.expeditionsMax = () => Math.floor(Math.sqrt(lv(124)));
  world.ownFleets = () => world.fleets.filter((f) => f.owner === 'me' && f.state !== 'done');
  world.slotsUsed = () => world.ownFleets().filter((f) => f.mission !== 10).length;
  world.missionCount = (m) => world.ownFleets().filter((f) => f.mission === m).length;
  world.expeditionPoints = (ships) => { let p = 0; for (const [id, n] of Object.entries(ships)) { const o = C.byId.get(+id); if (o) p += n * (o.price.metal + o.price.crystal) * 5 / 1000; } return p; };
  world.staytimeOptions = (missions) => {
    if (missions.includes(15)) { const o = []; for (let i = 1; i <= lv(124); i++) o.push({ value: i, hours: Math.round(i / haltSpeed * 100) / 100 }); return o; }
    if (missions.includes(11)) return [{ value: 1, hours: num(U.dmStayHours, 1) }];   // dmStayHours: test-only shortcut (upstream: 1 h)
    if (missions.includes(5)) return [1, 2, 4, 8, 12, 16, 32].map((h) => ({ value: h, hours: h }));
    return [];
  };
  /** FleetFunctions::GetAvailableMissions [UPSTREAM 408-452] for a fleet from `origin` (body) to target coords/type. */
  world.availableMissions = (ships, target, opt = {}) => {
    const coords = coordsOf(target.galaxy, target.system, target.position);
    const type = +target.type || 1;
    const out = [];
    if (+target.position === U.maxPlanets + 1) { out.push(15); return out; }
    const a = world.at(coords, type === 3 ? 3 : 1);
    if (type === 2) {
      const d = debris.get(coords);
      if ((ships[209] || ships[219]) && d && !(d.metal === 0 && d.crystal === 0)) out.push(8);
      return out;
    }
    const used = type === 3 ? a.exists : a.occupied;
    const mine = !!(type === 3 ? a.own : a.ownPlanet);
    if (!used) { if (ships[208] && type === 1) out.push(7); return out; }
    out.push(3);
    const onlyProbes = Object.keys(ships).length === 1 && ships[210];
    if (!mine && onlyProbes) out.push(6);
    if (!mine) { out.push(1); out.push(5); } else out.push(4);
    if (opt.acs && !mine) out.push(2);
    if (!mine && type === 3 && ships[214]) out.push(9);
    if (mine && type === 3 && Object.keys(ships).length === 1 && ships[220]) out.push(11);
    return out;
  };

  // ---------- production / storage (simple upstream-like formulas; spec perHour / storage win)
  function perHourOf(b) {
    if (b.perHour) return { metal: num(b.perHour.metal), crystal: num(b.perHour.crystal), deuterium: num(b.perHour.deuterium) };
    if (b.type === 'moon') return { metal: 0, crystal: 0, deuterium: 0 };
    const L = (id) => num(b.levels[id]);
    const m = U.resourceMultiplier / 1000;
    return {
      metal: (30 * L(1) * Math.pow(1.1, L(1)) + 30) * m,
      crystal: (20 * L(2) * Math.pow(1.1, L(2)) + 15) * m,
      deuterium: 10 * L(3) * Math.pow(1.1, L(3)) * (1.44 - 0.004 * b.tempMax) * m,
    };
  }
  function storageOf(b) {
    if (b.storage) return { metal: num(b.storage.metal, Infinity), crystal: num(b.storage.crystal, Infinity), deuterium: num(b.storage.deuterium, Infinity) };
    const st = (l) => Math.floor(2.5 * Math.pow(1.8331954764, num(l))) * 5000 * U.storageMultiplier;
    return { metal: st(b.levels[22]), crystal: st(b.levels[23]), deuterium: st(b.levels[24]) };
  }
  world.perHour = perHourOf;
  world.storage = storageOf;
  // Solar satellites built after the start add to the production at the per-satellite output of the saved resources page
  // (30817 energy from 797 satellites [REAL resources.html]), so a bot that builds satellites sees its deficit close.
  const SAT_OUT = 30817 / 797;
  const satExtra = (b) => Math.max(0, num((b.ships || {})[212]) - num(b.sat0)) * SAT_OUT;
  world.energyOf = (b) => (b.energy ? { production: Math.round(num(b.energy.production) + satExtra(b)), consumption: num(b.energy.consumption) }
    : { production: Math.round(20 * num(b.levels[4]) * Math.pow(1.1, num(b.levels[4])) * 22 + satExtra(b)), consumption: 0 });
  function grow(b, t) {
    const dt = t - b.lastUpdate;
    if (dt <= 0) return;
    const ph = perHourOf(b); const st = storageOf(b);
    for (const r of RES) {
      if (b.res[r] < st[r]) b.res[r] = Math.min(st[r], b.res[r] + ph[r] * dt / 3600);
    }
    b.lastUpdate = t;
  }
  function growOther(p, t) {
    if (!p.perHour) { p.lastUpdate = t; return; }
    const dt = t - p.lastUpdate; if (dt <= 0) return;
    for (const r of RES) p.res[r] += num(p.perHour[r]) * dt / 3600;
    p.lastUpdate = t;
  }
  world.growAll = (t) => { for (const b of bodies) grow(b, t); for (const o of others) for (const p of o.planets) growOther(p, t); };

  // ---------- messages
  world.addMessage = (m) => {
    const msg = Object.assign({ id: nextMsgId++, cat: 4, unix: clock.nowUnix(), from: 'Fleet Headquarters', subject: 'Message', body: '', read: false }, m);
    world.messages.push(msg);
    return msg;
  };
  world.unread = (cat) => world.messages.filter((m) => !m.read && (cat === undefined || cat === 100 || m.cat === cat)).length;

  // ---------- costs and times (catalog prices x factor^(level-1)) [UPSTREAM BuildFunctions]
  world.costOf = (id, level) => {
    const o = C.byId.get(+id); const f = o.price.factor || 1;
    const k = Math.pow(f, Math.max(0, level - 1));
    return { metal: Math.floor(o.price.metal * k), crystal: Math.floor(o.price.crystal * k), deuterium: Math.floor(o.price.deuterium * k) };
  };
  world.buildTime = (b, id, level) => {
    const c = world.costOf(id, level);
    const isResearch = C.byId.get(+id).type === 'research';
    if (isResearch && U.researchTimeSec != null) return +U.researchTimeSec;
    if (!isResearch && U.buildTimeSec != null) return +U.buildTimeSec;
    const h = isResearch ? (c.metal + c.crystal) / (1000 * (1 + num(b.levels[31])))
      : (c.metal + c.crystal) / (2500 * (1 + num(b.levels[14])) * Math.pow(2, num(b.levels[15])));
    return Math.max(1, Math.round(h * 3600 / ecoSpeed));
  };
  world.unitTime = (b, id) => {
    if (U.unitTimeSec != null) return +U.unitTimeSec;
    const o = C.byId.get(+id);
    const h = (o.price.metal + o.price.crystal) / (2500 * (1 + num(b.levels[21])) * Math.pow(2, num(b.levels[15])));
    return Math.max(1, Math.round(h * 3600 / ecoSpeed));
  };
  const affordable = (b, c) => b.res.metal >= c.metal && b.res.crystal >= c.crystal && b.res.deuterium >= c.deuterium;
  const pay = (b, c) => { for (const r of RES) b.res[r] -= c[r]; };
  const refund = (b, c) => { for (const r of RES) b.res[r] += c[r]; };
  const refuse = (kind, why, data) => { world.log.refusals.push(Object.assign({ t: clock.nowUnix(), kind, why }, data || {})); return { ok: false, error: why }; };

  function queuedLevel(b, id) {
    const q = b.buildQueue.filter((x) => x.id === +id);
    return q.length ? q[q.length - 1].level : num(b.levels[id]);
  }
  function startHead(b, t) {
    const head = b.buildQueue[0];
    if (!head || head.start) return;
    const c = world.costOf(head.id, head.level);
    if (!affordable(b, c)) { world.log.refusals.push({ t, kind: 'build', why: 'resources at start', bodyId: b.id, id: head.id }); b.buildQueue.shift(); startHead(b, t); return; }
    pay(b, c); head.cost = c; head.start = t; head.end = t + world.buildTime(b, head.id, head.level);
  }
  function startResearch(t) {
    const head = world.researchQueue[0];
    if (!head || head.start) return;
    const b = world.body(head.bodyId);
    const c = world.costOf(head.id, head.level);
    if (!b || !affordable(b, c)) { world.log.refusals.push({ t, kind: 'research', why: 'resources at start', id: head.id }); world.researchQueue.shift(); startResearch(t); return; }
    pay(b, c); head.cost = c; head.start = t; head.end = t + world.buildTime(b, head.id, head.level);
  }

  /**
   * Orders [UPSTREAM ShowBuildingsPage / ShowResearchPage / ShowShipyardPage]: refusals are silent upstream (the page redirects
   * and the queue is unchanged); here they are logged in world.log.refusals with the reason.
   *   order('buildings', bodyId, { cmd: 'insert'|'destroy'|'cancel'|'remove', id, listid })
   *   order('research', bodyId, { cmd: 'insert'|'cancel', id })
   *   order('shipyard', bodyId, { units: { id: n } })
   */
  world.order = (kind, bodyId, prm) => {
    const t = clock.nowUnix();
    world.process(t);
    const b = world.body(bodyId);
    if (!b) return refuse(kind, 'no body', { bodyId });
    if (player.vacation) return refuse(kind, 'vacation', { bodyId });
    const rec = Object.assign({ t, kind, bodyId }, clone(prm));
    if (kind === 'buildings') {
      const cmd = prm.cmd || 'insert';
      if (cmd === 'cancel') {
        const head = b.buildQueue.shift();
        if (head && head.cost) refund(b, head.cost);
        startHead(b, t); world.log.builds.push(rec); return { ok: true };
      }
      if (cmd === 'remove') {
        const i = num(prm.listid) - 1;
        if (i >= 1 && i < b.buildQueue.length) b.buildQueue.splice(i, 1);
        world.log.builds.push(rec); return { ok: true };
      }
      const id = +prm.id;
      const o = C.byId.get(id);
      if (!o || !(o.type === 'building' || o.type === 'station')) return refuse(kind, 'not a building', { bodyId, id });
      if (b.buildQueue.length >= U.maxBuildQueue) return refuse(kind, 'queue full', { bodyId, id });
      const destroy = cmd === 'destroy';
      const fieldsQueued = b.buildQueue.filter((x) => !x.destroy).length;
      if (!destroy && b.fieldsUsed + fieldsQueued >= b.fieldsMax) return refuse(kind, 'fields', { bodyId, id });
      if ((id === 31 || id === 6) && world.researchQueue.length) return refuse(kind, 'research running (31/6)', { bodyId, id });
      if ((id === 15 || id === 21) && b.shipyardQueue.length) return refuse(kind, 'shipyard busy (15/21)', { bodyId, id });
      const level = destroy ? queuedLevel(b, id) - 1 : queuedLevel(b, id) + 1;
      if (destroy && level < 0) return refuse(kind, 'level 0', { bodyId, id });
      if (!b.buildQueue.length && !affordable(b, world.costOf(id, Math.max(1, level)))) return refuse(kind, 'resources', { bodyId, id });
      b.buildQueue.push({ id, level, destroy, start: null, end: null });
      startHead(b, t);
      world.log.builds.push(Object.assign(rec, { id, level }));
      return { ok: true, level };
    }
    if (kind === 'research') {
      const cmd = prm.cmd || 'insert';
      if (cmd === 'cancel') { const head = world.researchQueue.shift(); if (head && head.cost) refund(world.body(head.bodyId) || b, head.cost); startResearch(t); world.log.builds.push(rec); return { ok: true }; }
      const id = +prm.id;
      const o = C.byId.get(id);
      if (!o || o.type !== 'research') return refuse(kind, 'not a research', { bodyId, id });
      if (!num(b.levels[31])) return refuse(kind, 'no research lab', { bodyId, id });
      if (bodies.some((x) => x.buildQueue.some((q) => q.id === 31 || q.id === 6))) return refuse(kind, 'lab under construction', { bodyId, id });
      if (world.researchQueue.length >= U.maxBuildQueue) return refuse(kind, 'queue full', { bodyId, id });
      const last = world.researchQueue.filter((x) => x.id === id).pop();
      const level = (last ? last.level : lv(id)) + 1;
      if (!world.researchQueue.length && !affordable(b, world.costOf(id, level))) return refuse(kind, 'resources', { bodyId, id });
      world.researchQueue.push({ id, level, bodyId: b.id, start: null, end: null });
      startResearch(t);
      world.log.builds.push(Object.assign(rec, { id, level }));
      return { ok: true, level };
    }
    if (kind === 'shipyard') {
      if (b.buildQueue.some((q) => q.id === 21 || q.id === 15)) return refuse(kind, 'shipyard/nanite upgrading', { bodyId });
      if (!num(b.levels[21])) return refuse(kind, 'no shipyard', { bodyId });
      const accepted = {};
      for (const [sid, nRaw] of Object.entries(prm.units || {})) {
        const id = +sid; let n = Math.floor(num(nRaw));
        const o = C.byId.get(id);
        if (!o || !(o.type === 'ship' || o.type === 'defense') || n < 1) continue;
        const c = world.costOf(id, 1);
        const maxAff = Math.min(...RES.map((r) => (c[r] > 0 ? Math.floor(b.res[r] / c[r]) : Infinity)));
        n = Math.min(n, maxAff);
        if ((id === 407 || id === 408 || id === 409) && n > 0) n = Math.min(n, (b.defense[id] || 0) + b.shipyardQueue.filter((q) => q.id === id).reduce((s, q) => s + q.count, 0) > 0 ? 0 : 1);
        if (n < 1) { world.log.refusals.push({ t, kind, why: 'resources', bodyId, id }); continue; }
        pay(b, { metal: c.metal * n, crystal: c.crystal * n, deuterium: c.deuterium * n });
        const last = b.shipyardQueue[b.shipyardQueue.length - 1];
        const per = world.unitTime(b, id);
        const start = last ? last.start + last.count * last.per : t;
        b.shipyardQueue.push({ id, count: n, per, start: Math.max(start, t), done: 0 });
        accepted[id] = n;
      }
      if (!Object.keys(accepted).length) return refuse(kind, 'nothing accepted', { bodyId });
      world.log.builds.push(Object.assign(rec, { accepted }));
      return { ok: true, accepted };
    }
    return refuse(kind, 'unknown order', { bodyId });
  };

  // ---------- fleets
  function fleetOwnerName(f) { if (f.owner === 'me') return player.name; const o = world.other(f.owner); return o ? o.name : f.ownerName || 'Unknown'; }
  function planetNameAt(coords, type) {
    const a = world.at(coords, type === 3 ? 3 : 1);
    if (a.own) return a.own.name;
    if (a.target) return a.target.name;
    if (a.ownPlanet) return a.ownPlanet.name;
    if (a.planet) return a.planet.name;
    return '';
  }
  world.planetNameAt = planetNameAt;
  world.fleetOwnerName = fleetOwnerName;

  /**
   * Send a fleet (ShowFleetStep3Page checks in upstream order) from body originId. Returns { ok, fleet, duration, consumption }
   * or { ok: false, error: <fl_* text>, code }. opts.skipSlots for fleetAjax (it checks slots itself).
   */
  world.send = (req, opts = {}) => {
    const t = clock.nowUnix();
    world.process(t);
    const from = world.body(req.originId);
    const fail = (error, code) => { world.log.refusals.push({ t, kind: 'fleet', why: error, code, req: clone(req) }); return { ok: false, error, code }; };
    if (!from) return fail('No valid start planet', 'origin');
    if (player.vacation) return fail('You are in vacation mode', 'vacation');
    const tg = req.target || {};
    const target = { galaxy: num(tg.galaxy), system: num(tg.system), position: num(tg.position !== undefined ? tg.position : tg.planet), type: num(tg.type, 1) };
    const ships = cleanShips(req.ships);
    const mission = num(req.mission, 3);
    const speed = num(req.speed, 10);
    const tcoords = coordsOf(target.galaxy, target.system, target.position);
    if (from.coords === tcoords && (from.type === 'moon' ? 3 : 1) === target.type) return fail('Start and destination planet are identical!', 'samePlanet');
    if (target.galaxy < 1 || target.galaxy > U.galaxies || target.system < 1 || target.system > U.systems || target.position < 1 || target.position > U.maxPlanets + 1 || ![1, 2, 3].includes(target.type)) return fail('No valid target', 'target');
    const cargoReq = { metal: Math.max(0, Math.round(num((req.cargo || {}).metal))), crystal: Math.max(0, Math.round(num((req.cargo || {}).crystal))), deuterium: Math.max(0, Math.round(num((req.cargo || {}).deuterium))) };
    if (mission === 3 && cargoReq.metal + cargoReq.crystal + cargoReq.deuterium < 1) return fail('No raw materials loaded!', 'noResource');
    if (!opts.skipSlots && world.slotsMax() <= world.slotsUsed()) return fail('Without slots avaliable', 'slots');
    if (!Object.keys(ships).length) return fail('Not all ships present.', 'ships');
    const a = world.at(tcoords, target.type === 3 ? 3 : 1);
    if (mission === 7) {
      if (a.occupied) return fail('Target planet', 'occupied');
      if (target.type !== 1) return fail('Only planets can be colonized.', 'colonizeType');
    } else if (mission !== 15 && !(target.type === 2 ? a.occupied || debris.has(tcoords) : a.exists)) return fail('No available target planet', 'noTarget');
    for (const [id, n] of Object.entries(ships)) if (n > (from.ships[id] || 0)) return fail('Not all ships present.', 'ships');
    // Xterium: max_dm_missions is not shown anywhere (the «Asteroids» counter is mission 16, asteroid mining = 4 + tech / 5)
    if (mission === 11 && world.missionCount(11) >= U.maxDmMissions) return fail('You cant start more expeditions!', 'expeditionSlots');
    if (mission === 15 && world.missionCount(15) >= world.expeditionsMax()) return fail('You cant start more expeditions!', 'expeditionSlots');
    const missions = world.availableMissions(ships, target, { acs: false });
    if (!missions.includes(mission)) return fail('Invalid mission', 'mission');
    const targetOwner = a.own || a.ownPlanet ? null : a.other;
    if (mission !== 8 && targetOwner && world.isVacation(targetOwner)) return fail('Target planet', 'vacation');
    if ([1, 2, 5, 6, 9].includes(mission) && targetOwner) {
      if (targetOwner.authAttack > player.authLevel) return fail('You can not attack this player', 'admin');
      if (!world.isInactive(targetOwner) && targetOwner.protection === 'noob') return fail('Player is in the Noob Protection!', 'noob');
      if (!world.isInactive(targetOwner) && targetOwner.protection === 'strong') return fail('Player is too strong!', 'strong');
    }
    if (mission === 5 && targetOwner && targetOwner.allyId !== player.allyId) return fail('The target player of the planet must be of your Alliance or be on your friends list!', 'hold');
    const dist = world.distance([from.g, from.s, from.p], [target.galaxy, target.system, target.position]);
    const maxSpeed = world.maxSpeed(ships);
    const duration = world.duration(speed, dist, maxSpeed);
    const consumption = world.consumption(ships, duration, dist);
    if (from.res.deuterium < consumption) return fail('Not enough deuterium available.', 'fuel');
    let stay = 0;
    if ([5, 11, 15].includes(mission)) {
      const opt = world.staytimeOptions(missions).find((o) => o.value === num(req.staytime));
      if (!opt) return fail('Invalid retention time.', 'staytime');
      stay = Math.round(opt.hours * 3600);
    }
    const room = world.capacityOf(ships) - consumption;
    const load = { metal: Math.min(cargoReq.metal, Math.floor(from.res.metal)), crystal: Math.min(cargoReq.crystal, Math.floor(from.res.crystal)), deuterium: Math.min(cargoReq.deuterium, Math.floor(from.res.deuterium - consumption)) };
    if (load.metal + load.crystal + load.deuterium > room) return fail('You have not enough cargo space available.', 'cargo');
    from.res.metal -= load.metal; from.res.crystal -= load.crystal; from.res.deuterium -= load.deuterium + consumption;
    for (const [id, n] of Object.entries(ships)) { from.ships[id] -= n; if (!from.ships[id]) delete from.ships[id]; }
    const arrival = t + duration;
    const stayEnd = arrival + stay;
    const fleet = {
      id: nextFleetId++, owner: 'me', mission, ships, cargo: Object.assign({ darkmatter: 0 }, load), speed, consumption, distance: dist, maxSpeed,
      from: { coords: from.coords, type: from.type === 'moon' ? 3 : 1, bodyId: from.id, name: from.name },
      to: { coords: tcoords, type: target.type, bodyId: a.target ? a.target.id : null, name: planetNameAt(tcoords, target.type) },
      targetOwner: a.own || a.ownPlanet ? 'me' : a.other ? a.other.id : null,
      start: t, arrival, stayEnd: stay ? stayEnd : null, back: stayEnd + duration, duration, state: 'out', recallable: true, via: opts.via || 'step3',
    };
    world.fleets.push(fleet);
    world.log.sent.push({ t, fleetId: fleet.id, via: fleet.via, mission, ships: clone(ships), cargo: clone(load), from: from.coords, originId: from.id, to: tcoords, type: target.type, speed, arrival, back: fleet.back, consumption, staytime: req.staytime === undefined ? null : num(req.staytime) });
    return { ok: true, fleet, duration, consumption, distance: dist, maxSpeed, missions };
  };

  /** SendFleetBack [UPSTREAM FleetFunctions:298-384]: refused when not own or already returning. */
  world.recall = (fleetId) => {
    const t = clock.nowUnix();
    world.process(t);
    const f = world.fleets.find((x) => x.id === +fleetId);
    if (!f || f.owner !== 'me' || f.state === 'back' || f.state === 'done' || player.vacation) { world.log.refusals.push({ t, kind: 'recall', why: 'not recallable', fleetId: +fleetId }); return false; }
    const back = f.mission === 5 && f.state === 'hold' ? (f.arrival - f.start) + t : (t - f.start) + t;
    world.log.recalled.push({ t, fleetId: f.id, from: f.state, oldBack: f.back, back });
    f.stayEnd = t; f.back = back; f.state = 'back'; f.recalled = true;
    return true;
  };

  /** ShowFleetAjaxPage [UPSTREAM 38-219]: { slots, ships, code, mess }. */
  world.fleetAjax = (cpId, mission, planetId) => {
    const t = clock.nowUnix();
    world.process(t);
    const from = world.body(cpId) || bodies[0];
    const out = { slots: world.slotsUsed(), ships: {} };
    const done = (code, mess) => { out.code = code; out.mess = mess; world.log.ajax.push({ t, cp: from && from.id, mission, planetId, code, mess }); return out; };
    if (player.vacation) return done(620, 'You are in vacation mode!');
    if (!num(planetId)) return done(601, 'The planet does not exist!');
    if (world.slotsMax() <= world.slotsUsed()) return done(612, 'No more slots available!');
    let fleet = {};
    let target = null; let owner = null; let ttype = 1;
    for (const o of others) for (const p of o.planets) { if (p.id === +planetId) { target = p; owner = o; } else if (p.moon && p.moon.id === +planetId) { target = Object.assign(p.moon, { coords: p.coords }); owner = o; ttype = 3; } }
    const own = world.body(planetId);
    if (own) { target = own; ttype = own.type === 'moon' ? 3 : 1; }
    if (+mission === 6) {
      const n = Math.min(player.spyProbes, from.ships[210] || 0);
      if (!n) return done(611, 'No spy probes available!');
      fleet = { 210: n }; out.ships[210] = (from.ships[210] || 0) - n;
    } else if (+mission === 8) {
      if (!target) return done(601, 'The planet does not exist!');
      const d = debris.get(target.coords) || { metal: 0, crystal: 0 };
      let total = d.metal + d.crystal;
      for (const id of [219, 209]) {
        const cap = C.byId.get(id).props.cargo;
        const need = Math.min(Math.ceil(total / cap), from.ships[id] || 0);
        total -= need * cap; fleet[id] = need; out.ships[id] = (from.ships[id] || 0) - need;
        if (total <= 0) break;
      }
      fleet = cleanShips(fleet);
      if (!Object.keys(fleet).length) return done(611, 'No recyclers available!');
    } else return done(610, 'Not enough probes!');
    if (!target) return done(601, 'The planet does not exist!');
    if (+mission === 6) {
      if (owner && owner.authAttack > player.authLevel) return done(619, 'Action not allowed!');
      if (owner && world.isVacation(owner)) return done(605, 'Player is in vacation mode!');
      if (owner && !world.isInactive(owner) && owner.protection === 'noob') return done(603, 'Player is too weak!');
      if (owner && !world.isInactive(owner) && owner.protection === 'strong') return done(604, 'Player is too strong!');
      if (own) return done(618, 'You can not spy yourself!');
    }
    const [g, s, p] = parseCoords(target.coords);
    const dist = world.distance([from.g, from.s, from.p], [g, s, p]);
    const dur = world.duration(10, dist, world.maxSpeed(fleet));
    const cons = world.consumption(fleet, dur, dist);
    if (from.res.deuterium - cons < 0) return done(613, 'Not enough deuterium!');
    if (cons > world.capacityOf(fleet, false)) return done(613, 'Not enough cargo space for the fuel!');
    const r = world.send({ originId: from.id, ships: fleet, target: { galaxy: g, system: s, position: p, type: +mission === 8 ? 2 : ttype }, mission: +mission, speed: 10 }, { skipSlots: true, via: 'fleetAjax' });
    if (!r.ok) return done(+mission === 8 ? 611 : 610, r.error);
    out.slots++;
    const first = Object.keys(fleet)[0];
    return done(600, `Send ${sumShips(fleet)} ${C.name(first)} to ${g}:${s}:${p} ...`);
  };

  /** Galaxy view [UPSTREAM ShowGalaxyPage:56-67]: another system costs galaxyDeuteriumCost from the current body. */
  world.viewGalaxy = (cpId, g, s) => {
    const t = clock.nowUnix();
    world.process(t);
    const b = world.body(cpId) || bodies[0];
    const own = b && b.g === g && b.s === s;
    const cost = own ? 0 : U.galaxyDeuteriumCost;
    if (cost && b.res.deuterium < cost) { world.log.galaxyViews.push({ t, cp: b.id, galaxy: g, system: s, cost: 0, refused: true }); return { ok: false, error: 'You dont have enough deuterium to view the galaxy' }; }
    b.res.deuterium -= cost;
    world.log.galaxyViews.push({ t, cp: b.id, galaxy: g, system: s, cost });
    return { ok: true, cost };
  };

  // ---------- hostile fleets and scripted changes
  world.addHostile = (h) => {
    const t = clock.nowUnix();
    const to = world.body(h.toBodyId) || bodies[0];
    const owner = world.other(h.ownerId) || null;
    const flight = num(h.flightSec, 60);
    const arrival = h.arrivalUnix ? +h.arrivalUnix : t + flight;
    const f = {
      id: nextFleetId++, owner: owner ? owner.id : num(h.ownerId, 999999), ownerName: h.ownerName || (owner ? owner.name : 'Enemy'), mission: num(h.mission, 1),
      ships: cleanShips(h.ships || { 204: 10 }), cargo: { metal: 0, crystal: 0, deuterium: 0, darkmatter: 0 },
      from: { coords: h.from || (owner && owner.planets[0] ? owner.planets[0].coords : '1:1:1'), type: 1, bodyId: null, name: h.fromName || (owner && owner.planets[0] ? owner.planets[0].name : 'Planet') },
      to: { coords: to.coords, type: to.type === 'moon' ? 3 : 1, bodyId: to.id, name: to.name }, targetOwner: 'me',
      start: arrival - flight, arrival, stayEnd: null, back: arrival + flight, duration: flight, state: 'out', recallable: false, group: num(h.group, 0),
      tech: h.tech || null,
    };
    world.fleets.push(f);
    world.log.events.push({ t, kind: 'hostile-added', fleetId: f.id, arrival, to: to.coords, mission: f.mission });
    return f;
  };
  world.setVacation = (otherId, on) => { const o = world.other(otherId); if (o) { o.status = (o.status || '').replace(/v/g, '') + (on ? 'v' : ''); } return !!o; };
  world.logout = () => { world.session.loggedOut = true; };
  world.login = () => { world.session.loggedOut = false; };
  world.captcha = (on = true) => { world.session.captcha = !!on; };

  /** Script / inspection commands (spec.script entries and POST /__ogx/world). */
  world.command = (cmd, args = {}) => {
    switch (cmd) {
      case 'advance': return clock.advance(num(args.sec !== undefined ? args.sec : args));
      case 'setSpeedup': clock.speedup = num(args.speedup !== undefined ? args.speedup : args, 1); return clock.speedup;
      case 'addHostile': return world.addHostile(args).id;
      case 'setVacation': return world.setVacation(args.otherId !== undefined ? args.otherId : args.id, args.on !== false);
      case 'setPlayerVacation': player.vacation = args.on !== false; return player.vacation;
      case 'logout': world.logout(); return true;
      case 'login': world.login(); return true;
      case 'captcha': world.captcha(args.on !== false); return true;
      case 'setRes': { const b = world.body(args.bodyId); if (b) Object.assign(b.res, args.res || {}); return !!b; }
      case 'setShips': { const b = world.body(args.bodyId); if (b) b.ships = cleanShips(Object.assign({}, b.ships, args.ships)); return !!b; }
      case 'setOther': {
        const o = world.other(args.id !== undefined ? args.id : args.coords);
        if (!o) return false;
        for (const k of ['status', 'rank', 'points', 'protection', 'name']) if (args[k] !== undefined) o[k] = args[k];
        if (args.planet) { const p = o.planets.find((x) => x.coords === args.planet.coords || x.id === +args.planet.id); if (p) for (const k of ['res', 'ships', 'defense', 'levels']) if (args.planet[k]) p[k] = k === 'res' ? Object.assign(p.res, args.planet[k]) : cleanShips(args.planet[k]); }
        return true;
      }
      case 'setDebris': { const k = args.coords; debris.set(k, { metal: num(args.metal), crystal: num(args.crystal) }); return true; }
      case 'setResearch': Object.assign(player.research, args.research || args); return true;
      case 'expeditionOutcome': world.expeditionOutcomes.push(args); return world.expeditionOutcomes.length;
      case 'message': return world.addMessage(args).id;
      default: throw new Error('gz-world: unknown command ' + cmd);
    }
  };

  // ---------- event processing
  function dueEvents(now) {
    const ev = [];
    for (const f of world.fleets) {
      if (f.state === 'out' && f.arrival <= now) ev.push({ t: f.arrival, k: 0, f, kind: 'arrive' });
      else if (f.state === 'hold' && f.stayEnd <= now) ev.push({ t: f.stayEnd, k: 1, f, kind: 'stayEnd' });
      else if (f.state === 'back' && f.back <= now) ev.push({ t: f.back, k: 2, f, kind: 'return' });
    }
    for (const b of bodies) {
      const h = b.buildQueue[0];
      if (h && h.start && h.end <= now) ev.push({ t: h.end, k: 3, b, kind: 'build' });
      const sq = b.shipyardQueue[0];
      if (sq && sq.start + (sq.done + 1) * sq.per <= now) ev.push({ t: sq.start + (sq.done + 1) * sq.per, k: 4, b, kind: 'unit' });
    }
    const r = world.researchQueue[0];
    if (r && r.start && r.end <= now) ev.push({ t: r.end, k: 3, kind: 'research' });
    for (const s of scriptQueue) if (s.t <= now) ev.push({ t: s.t, k: -1, s, kind: 'script' });
    ev.sort((a, b) => a.t - b.t || a.k - b.k || ((a.f && b.f) ? a.f.id - b.f.id : 0));
    return ev;
  }
  const scriptQueue = [];
  for (const s of spec.script || []) scriptQueue.push({ t: now0 + num(s.at), do: s.do, args: s.args || {} });
  for (const h of spec.hostile || []) scriptQueue.push({ t: now0 + num(h.at), do: 'addHostile', args: h });

  let processing = false;
  world.process = (nowArg) => {
    if (processing) return 0;
    processing = true;
    let n = 0;
    try {
      const now = nowArg === undefined ? clock.nowUnix() : Math.floor(nowArg);
      for (let guard = 0; guard < 10000; guard++) {
        const ev = dueEvents(now)[0];
        if (!ev) break;
        world.growAll(ev.t);
        run(ev);
        n++;
      }
      world.growAll(now);
      for (const b of bodies) startHead(b, now);
      startResearch(now);
    } finally { processing = false; }
    return n;
  };

  function run(ev) {
    const t = ev.t;
    if (ev.kind === 'script') {
      scriptQueue.splice(scriptQueue.indexOf(ev.s), 1);
      world.log.script.push({ t, do: ev.s.do });
      if (ev.s.do === 'addHostile') {
        const h = ev.s.args; const flight = num(h.flightSec, 60);
        world.addHostile(Object.assign({}, h, { arrivalUnix: t + flight }));
      } else world.command(ev.s.do, ev.s.args);
      return;
    }
    if (ev.kind === 'build') {
      const b = ev.b; const h = b.buildQueue.shift();
      b.levels[h.id] = h.level;
      if (h.destroy) b.fieldsUsed = Math.max(0, b.fieldsUsed - 1); else b.fieldsUsed += 1;
      world.log.events.push({ t, kind: 'build-done', bodyId: b.id, id: h.id, level: h.level });
      startHead(b, t);
      return;
    }
    if (ev.kind === 'research') {
      const h = world.researchQueue.shift();
      player.research[h.id] = h.level;
      world.log.events.push({ t, kind: 'research-done', id: h.id, level: h.level });
      startResearch(t);
      return;
    }
    if (ev.kind === 'unit') {
      const b = ev.b; const q = b.shipyardQueue[0];
      q.done++;
      const into = q.id >= 400 ? b.defense : b.ships;
      into[q.id] = (into[q.id] || 0) + 1;
      if (q.done >= q.count) { b.shipyardQueue.shift(); world.log.events.push({ t, kind: 'units-done', bodyId: b.id, id: q.id, count: q.count }); if (b.shipyardQueue[0]) b.shipyardQueue[0].start = Math.max(b.shipyardQueue[0].start, t); }
      return;
    }
    const f = ev.f;
    if (ev.kind === 'arrive') return f.owner === 'me' ? arriveOwn(f, t) : arriveHostile(f, t);
    if (ev.kind === 'stayEnd') return stayEnd(f, t);
    if (ev.kind === 'return') return returnHome(f, t);
  }

  const goBack = (f) => { f.state = 'back'; };
  const kill = (f, t, why) => { f.state = 'done'; f.ended = t; f.endReason = why; };
  const addTo = (o, add) => { for (const [k, v] of Object.entries(add || {})) if (v) o[k] = (o[k] || 0) + v; };
  function targetObj(f) { const a = world.at(f.to.coords, f.to.type === 3 ? 3 : 1); return a; }

  function arriveOwn(f, t) {
    world.log.events.push({ t, kind: 'arrive', fleetId: f.id, mission: f.mission, to: f.to.coords });
    const a = targetObj(f);
    switch (f.mission) {
      case 1: case 2: case 9: {
        if (!a.target) { goBack(f); return; }
        const res = combat({ attacker: { ships: f.ships, tech: player.research, owner: 'me', name: player.name, coords: f.from.coords, cargo: f.cargo },
          defender: { obj: a.target, tech: a.other ? a.other.research : player.research, owner: a.other ? a.other.id : 'me', name: a.other ? a.other.name : player.name },
          coords: f.to.coords, type: f.to.type, t });
        f.ships = res.attackerAfter;
        if (!sumShips(f.ships)) { kill(f, t, 'destroyed'); return; }
        addTo(f.cargo, res.loot);
        goBack(f);
        return;
      }
      case 3: {
        if (a.target) { addTo(a.target.res, { metal: f.cargo.metal, crystal: f.cargo.crystal, deuterium: f.cargo.deuterium }); }
        world.addMessage({ cat: 5, unix: t, subject: 'Transportmessage', body: `One of your fleets reaches the planet ${esc(f.to.name)} <a href="game.php?page=galaxy&amp;galaxy=${a.target ? parseCoords(f.to.coords)[0] : ''}&amp;system=${parseCoords(f.to.coords)[1]}" class="">[${f.to.coords}]</a> and delivers ${pretty(f.cargo.metal)} Metal, ${pretty(f.cargo.crystal)} Crystal and ${pretty(f.cargo.deuterium)} Deuterium.` });
        f.cargo.metal = 0; f.cargo.crystal = 0; f.cargo.deuterium = 0;
        goBack(f);
        return;
      }
      case 4: {
        const b = a.own || world.body(f.to.bodyId);
        if (!b) { goBack(f); return; }
        addTo(b.ships, f.ships);
        addTo(b.res, { metal: f.cargo.metal, crystal: f.cargo.crystal, deuterium: f.cargo.deuterium });
        world.addMessage({ cat: 5, unix: t, subject: 'Located fleet', body: `Your fleet reaches the planet <a href="game.php?page=galaxy&amp;galaxy=${b.g}&amp;system=${b.s}" class="">[${b.coords}]</a> and delivers ${pretty(f.cargo.metal)} Metal, ${pretty(f.cargo.crystal)} Crystal and ${pretty(f.cargo.deuterium)} Deuterium.` });
        kill(f, t, 'deployed');
        return;
      }
      case 5: case 11: case 15: {
        f.state = 'hold';
        if (!f.stayEnd) f.stayEnd = t;
        return;
      }
      case 6: return spyArrive(f, t, a);
      case 7: return colonize(f, t);
      case 8: return recycle(f, t);
      default: goBack(f);
    }
  }

  function stayEnd(f, t) {
    if (f.mission === 15) return expeditionOutcome(f, t);
    if (f.mission === 11) {
      const dm = rng.int(100, 300);
      f.cargo.darkmatter = (f.cargo.darkmatter || 0) + dm;
      world.addMessage({ cat: 15, unix: t, subject: 'Expedition report', body: 'Our expedition has found an ancient space station, which already floated in space for a long time. The station itself was completely useless, however, still stored in one of its reactors a small set of dark matter was found.' });
    }
    goBack(f);
  }

  function returnHome(f, t) {
    if (f.owner !== 'me') { kill(f, t, 'foreign-return'); return; }
    const b = world.body(f.from.bodyId);
    // [UPSTREAM MissionCaseFoundDM::ReturnEvent] a DM find scraps the collectors (fleet_array '220,0'), only the DM comes home
    if (f.mission === 11 && f.cargo.darkmatter > 0) f.ships = {};
    if (b) {
      addTo(b.ships, f.ships);
      addTo(b.res, { metal: f.cargo.metal, crystal: f.cargo.crystal, deuterium: f.cargo.deuterium });
      if (f.cargo.darkmatter) player.darkMatter += f.cargo.darkmatter;
    }
    const total = f.cargo.metal + f.cargo.crystal + f.cargo.deuterium;
    const [g, s] = parseCoords(f.from.coords);
    let body;
    if (f.mission === 11) body = f.cargo.darkmatter > 0 ? `Your fleet has returned from the expedition.<br>They found (Dark Matter)${pretty(f.cargo.darkmatter)} but the ships were scrapped. <br>the Dark Matter was saved.` : 'Your fleet has returned from the expedition.';
    else if (f.mission === 15) body = `Your fleet has returned from the expedition.<br>It deliveres Metal ${pretty(f.cargo.metal)}, Crystal ${pretty(f.cargo.crystal)}, Deuterium ${pretty(f.cargo.deuterium)} and Dark Matter ${pretty(f.cargo.darkmatter || 0)}.`;
    else if ((f.mission === 1 || f.mission === 2 || f.mission === 9) && !f.recalled) body = `One of your fleets returns from a attack at the planet ${esc(f.from.name)} <a href="game.php?page=galaxy&amp;galaxy=${parseCoords(f.to.coords)[0]}&amp;system=${parseCoords(f.to.coords)[1]}" class="">[${f.to.coords}]</a>. You have captured ${pretty(f.cargo.metal)} Metal, ${pretty(f.cargo.crystal)} Crystal and ${pretty(f.cargo.deuterium)} Deuterium `;
    else if (total > 0) body = `One of your fleets reaches the planet ${esc(f.from.name)} <a href="game.php?page=galaxy&amp;galaxy=${g}&amp;system=${s}" class="">[${f.from.coords}]</a> and delivers ${pretty(f.cargo.metal)} Metal, ${pretty(f.cargo.crystal)} Crystal and ${pretty(f.cargo.deuterium)} Deuterium.`;
    else body = `One of your fleets returns from the planet ${esc(f.from.name)} <a href="game.php?page=galaxy&amp;galaxy=${g}&amp;system=${s}" class="">[${f.from.coords}]</a>.`;
    world.addMessage({ cat: 4, unix: t, subject: 'Fleet return', body });
    world.log.events.push({ t, kind: 'return', fleetId: f.id, mission: f.mission, bodyId: f.from.bodyId, cargo: clone(f.cargo) });
    kill(f, t, 'returned');
  }

  // ---- spy [UPSTREAM MissionCaseSpy.php:75-205]
  function spyArrive(f, t, a) {
    const tgt = a.target;
    if (!tgt) { goBack(f); return; }
    const owner = a.other;
    const n = (f.ships[210] || 0) * (1 + num(player.spyPower));
    const ours = Math.max(lv(106), 1);
    const theirs = Math.max(owner ? num(owner.research[106]) : lv(106), 1);
    const diff = Math.abs(ours - theirs);
    const minAmount = (ours > theirs ? -1 : 1) * Math.pow(diff * 1, 2);
    const show = { 900: true, 200: n >= minAmount, 400: n >= minAmount + 1, 0: n >= minAmount + 3, 100: n >= minAmount + 5 };
    const targetChance = rng.int(0, Math.min((n / 4) * (theirs / ours), 100));
    const spyChance = rng.int(0, 100);
    const data = [];
    if (show[900]) data.push([900, [[901, tgt.res.metal], [902, tgt.res.crystal], [903, tgt.res.deuterium], [911, tgt.energy !== undefined ? tgt.energy : (tgt.levels ? Math.round(world.energyOf(tgt).production) : 0)]]]);
    if (show[200]) data.push([200, C.ships.map((id) => [id, num(tgt.ships && tgt.ships[id])])]);
    if (show[400]) data.push([400, C.defense.concat(C.missiles).map((id) => [id, num(tgt.defense && tgt.defense[id])])]);
    if (show[0]) data.push([0, C.buildings.map((id) => [id, num(tgt.levels && tgt.levels[id])])]);
    if (show[100]) data.push([100, C.research.map((id) => [id, owner ? num(owner.research[id]) : lv(id)])]);
    if (player.spyMessagesMode === 1) for (const d of data) d[1] = d[1].filter((x) => x[1]);
    const [g, s, p] = parseCoords(f.to.coords);
    const head = { 900: 'Ressources', 200: 'Ships', 400: 'Defense', 0: 'Buildings', 100: 'Research' };
    const rname = { 901: 'Metal', 902: 'Crystal', 903: 'Deuterium', 911: 'Energy' };
    let html = `<div class="spyRaport"> <div class="spyRaportHead"> <a href="${LIVE}?page=galaxy&amp;galaxy=${g}&amp;system=${s}">Spy Report ${esc(tgt.name)} [${g}:${s}:${p}] on ${fmtDate(f.back || t, tz)}</a> </div>`;
    for (const [cls, items] of data) {
      html += ` <div class="spyRaportContainer"> <div class="spyRaportContainerHead spyRaportContainerHeadClass${cls}">${head[cls]}</div>`;
      items.forEach(([id, amount], i) => {
        if (i % 2 === 0) html += ' <div class="spyRaportContainerRow clearfix">';
        html += ` <div class="spyRaportContainerCell">${rname[id] || esc(C.name(id))}</div> <div class="spyRaportContainerCell">${pretty(roundHalfEven(amount))}</div>`;
        if (i % 2 === 1) html += ' </div>';
      });
      html += ' </div>';
    }
    const sim = data.flatMap(([, items]) => items.map(([id, amount]) => `&amp;im[${id}]=${raw(amount)}`)).join('');
    const destroyed = targetChance >= spyChance;
    html += ` <div class="spyRaportFooter"> <a href="${LIVE}?page=fleetTable&amp;galaxy=${g}&amp;system=${s}&amp;planet=${p}&amp;planettype=${f.to.type}&amp;target_mission=1">Attack</a> <br>${destroyed ? '<font color="red">Your spy probes were destroyed! </font>' : `The spy probes discovery chance was:  ${targetChance} % `}\t\t<br><a href="${LIVE}?page=battleSimulator${sim}">Simulate</a> </div> </div>`;
    world.addMessage({ cat: 0, unix: t, from: 'Spying department', subject: 'Intelligence report', body: html, spy: { coords: f.to.coords, sections: Object.keys(show).filter((k) => show[k]).map(Number), probes: n, destroyed } });
    world.log.events.push({ t, kind: 'spy', fleetId: f.id, to: f.to.coords, probes: n, sections: data.map((d) => d[0]), targetChance, spyChance, destroyed });
    if (destroyed) {
      const d = debris.get(f.to.coords) || { metal: 0, crystal: 0 };
      const pr = C.byId.get(210).price;
      d.metal += n * pr.metal * U.fleetDebrisPct / 100; d.crystal += n * pr.crystal * U.fleetDebrisPct / 100;
      debris.set(f.to.coords, d);
      kill(f, t, 'probes destroyed');
    } else goBack(f);
  }

  // ---- recycle [UPSTREAM MissionCaseRecycling.php]
  function recycle(f, t) {
    const d = debris.get(f.to.coords) || { metal: 0, crystal: 0 };
    const total = d.metal + d.crystal;
    let got = { metal: 0, crystal: 0 };
    if (total > 0) {
      let rec = 0; let other = 0;
      for (const [id, n] of Object.entries(f.ships)) { const cap = C.byId.get(+id).props.cargo * n; if (+id === 209 || +id === 219) rec += cap; else other += cap; }
      const sf = 1 + player.storageFactor;
      rec *= sf; other *= sf;
      const incoming = f.cargo.metal + f.cargo.crystal + f.cargo.deuterium;
      const storage = rec + Math.min(0, other - incoming);
      const factor = Math.min(1, storage / total);
      got = { metal: Math.ceil(d.metal * factor), crystal: Math.ceil(d.crystal * factor) };
      d.metal = Math.max(0, d.metal - got.metal); d.crystal = Math.max(0, d.crystal - got.crystal);
      debris.set(f.to.coords, d);
      f.cargo.metal += got.metal; f.cargo.crystal += got.crystal;
    }
    world.addMessage({ cat: 5, unix: t, subject: 'Recycling Report', body: `Having arrived at there destination your Recyclers collect ${pretty(got.metal)} Metal and ${pretty(got.crystal)} Crystal`, harvest: got });
    world.log.events.push({ t, kind: 'recycle', fleetId: f.id, to: f.to.coords, got, left: clone(d) });
    goBack(f);
  }

  // ---- colonize [UPSTREAM MissionCaseColonisation.php]
  function colonize(f, t) {
    const [g, s, p] = parseCoords(f.to.coords);
    const a = world.at(f.to.coords, 1);
    const planets = world.planets().length;
    let ok = !a.occupied && planets < player.maxPlanets;
    let body;
    if (ok) {
      body = mkBody({ id: nextBodyId++, coords: f.to.coords, name: 'Colony', fieldsMax: 163 + (num(spec.colonyFieldsBonus, 0)), tempMax: 40, res: { metal: 0, crystal: 0, deuterium: 0 } });
      body.lastUpdate = t; body.created = t;
      if (spec.colonyFields && spec.colonyFields[f.to.coords]) body.fieldsMax = +spec.colonyFields[f.to.coords];
      bodies.push(body);
      addTo(body.res, { metal: f.cargo.metal, crystal: f.cargo.crystal, deuterium: f.cargo.deuterium });
      f.cargo.metal = 0; f.cargo.crystal = 0; f.cargo.deuterium = 0;
      f.ships[208] -= 1; if (!f.ships[208]) delete f.ships[208];
      world.addMessage({ cat: 4, unix: t, from: 'Colonisation', subject: 'Colonisation report', body: `One of your fleets reaches the coordinates <a href="game.php?page=galaxy&amp;galaxy=${g}&amp;system=${s}" class="">[${f.to.coords}]</a>. The settlers start to colonise the new planet.`, colonize: { ok: true, bodyId: body.id } });
    } else {
      world.addMessage({ cat: 4, unix: t, from: 'Colonisation', subject: 'Colonisation report', body: a.occupied ? `The fleet has reached the specified coordinates <a href="game.php?page=galaxy&amp;galaxy=${g}&amp;system=${s}" class="">[${f.to.coords}]</a>, the planet is already occupied. The fleet returns.` : `The fleet has reached the specified coordinates <a href="game.php?page=galaxy&amp;galaxy=${g}&amp;system=${s}" class="">[${f.to.coords}]</a>, but it is not possible to have more planets. The fleet returns.`, colonize: { ok: false } });
    }
    world.log.events.push({ t, kind: 'colonize', fleetId: f.id, to: f.to.coords, ok, bodyId: body ? body.id : null });
    if (!sumShips(f.ships)) kill(f, t, 'colonized'); else goBack(f);
  }

  // ---- expedition [UPSTREAM MissionCaseExpedition.php:30-250]
  const EXPO_TEXT = {
    resources: 'Your expedition has discovered a small asteroids cluster from which some resources could be won. ',
    darkMatter: 'Our expedition has found an ancient space station, which already floated in space for a long time. The station itself was completely useless, however, still stored in one of its reactors a small set of dark matter was found.',
    ships: 'We have found a deserted pirate base. Some old ships are still located in the hangar. Our technicians look, whether still some of the ships are useable.',
    nothing: 'Scans of this sector first promised to be good, but unfortunately we came back empty-handed.',
    delay: 'For some unknown reasons the jump of the expedition fleet missed it`s target completely. The fleet almost would have come out in the heart of a sun. Fortunately it landed in a known system, the return will, however, last longer than thought originally.',
    speedup: 'An unforeseen relay in the energy coils of the drive aggregates accelerated the return of the expedition. According to first reports it has however, nothing thrilling to report.',
    blackHole: 'A nuclear breach on one of the commanding ships led to a chain reaction which destroyed the complete expedition in a spectacular explosion.',
    battle: 'The call for help of another expeditionfleet turned out to be a trap of some cunning pirates. A battle was unavoidable.',
  };
  function expeditionOutcome(f, t) {
    let o = world.expeditionOutcomes.length ? world.expeditionOutcomes.shift() : null;
    let freeCargo = 0; let points = 0;
    for (const [id, n] of Object.entries(f.ships)) { const e = C.byId.get(+id); freeCargo += e.props.cargo * n; points += n * (e.price.metal + e.price.crystal) * 5 / 1000; }
    freeCargo -= f.cargo.metal + f.cargo.crystal + f.cargo.deuterium + (f.cargo.darkmatter || 0);
    if (!o) {
      const ev = rng.int(1, 9);
      o = { type: { 1: 'resources', 2: 'darkMatter', 3: 'ships', 4: 'battle', 5: 'blackHole', 6: 'time' }[ev] || 'nothing', seeded: true };
    }
    let text = EXPO_TEXT[o.type] || EXPO_TEXT.nothing;
    const result = { type: o.type };
    if (o.type === 'resources') {
      const tp = U.topPoints; const maxFactor = tp > 5000000 ? 12000 : tp > 1000000 ? 9000 : tp > 100000 ? 6000 : 2400;
      let factor = rng.int(10, 50); const which = o.res || (rng.int(1, 6) > 3 ? 'metal' : 'crystal');
      if (which === 'crystal') factor /= 2; if (which === 'deuterium') factor /= 3;
      const found = o.amount !== undefined ? +o.amount : Math.round(Math.min(freeCargo, Math.min(maxFactor, Math.max(200, factor)) * points));
      f.cargo[which] += found; result.res = which; result.amount = found;
      text = 'The asteroid belt around an unknown planet contained vast amounts of raw materials. The expedition fleet filled its storage rooms!';
      if (o.type === 'resources' && o.small !== false) text = EXPO_TEXT.resources;
    } else if (o.type === 'darkMatter') {
      const dm = o.amount !== undefined ? +o.amount : rng.int(100, 300);
      f.cargo.darkmatter = (f.cargo.darkmatter || 0) + dm; result.amount = dm;
    } else if (o.type === 'ships') {
      const found = cleanShips(o.ships || { 202: rng.int(1, 5) });
      addTo(f.ships, found); result.ships = found;
      text += Object.entries(found).map(([id, n]) => `<br>${C.name(id)}: ${pretty(n)}`).join('');
    } else if (o.type === 'blackHole') {
      world.addMessage({ cat: 15, unix: t, subject: 'Expedition report', body: text, expedition: result });
      world.log.events.push({ t, kind: 'expedition', fleetId: f.id, outcome: result });
      kill(f, t, 'black hole');
      return;
    } else if (o.type === 'battle') {
      const loss = o.lossPct !== undefined ? +o.lossPct : 0;
      for (const id of Object.keys(f.ships)) f.ships[id] = Math.floor(f.ships[id] * (1 - loss / 100));
      f.ships = cleanShips(f.ships); result.lossPct = loss;
      if (!sumShips(f.ships)) { world.addMessage({ cat: 15, unix: t, subject: 'Expedition report', body: text, expedition: result }); kill(f, t, 'expedition battle'); return; }
    } else if (o.type === 'time') {
      const delay = o.delaySec !== undefined ? +o.delaySec : Math.round((f.back - f.stayEnd) * 0.5);
      if (delay >= 0) text = EXPO_TEXT.delay; else text = EXPO_TEXT.speedup;
      f.back += delay; result.delaySec = delay;
    }
    world.addMessage({ cat: 15, unix: t, subject: 'Expedition report', body: text, expedition: result });
    world.log.events.push({ t, kind: 'expedition', fleetId: f.id, outcome: result });
    goBack(f);
  }

  // ---- hostile arrival (battle against our body) [UPSTREAM MissionCaseAttack / MissionCaseSpy for the target]
  function arriveHostile(f, t) {
    const b = world.body(f.to.bodyId);
    world.log.events.push({ t, kind: 'hostile-arrive', fleetId: f.id, mission: f.mission, to: f.to.coords });
    if (!b) { goBack(f); return; }
    if (f.mission === 6) {
      world.addMessage({ cat: 0, unix: t, from: 'Room monitoring', subject: 'Spying activity', body: `A hostile fleet of the planet ${esc(f.from.name)} <a href="game.php?page=galaxy&amp;galaxy=${parseCoords(f.from.coords)[0]}&amp;system=${parseCoords(f.from.coords)[1]}">[${f.from.coords}]</a> was sighted near your planet\n\t\t${esc(b.name)} <a href="game.php?page=galaxy&amp;galaxy=${b.g}&amp;system=${b.s}">[${b.coords}]</a> sighted` });
      goBack(f);
      return;
    }
    if ([1, 2, 9].includes(f.mission)) {
      const owner = world.other(f.owner);
      const res = combat({ attacker: { ships: f.ships, tech: f.tech || (owner ? owner.research : {}), owner: f.owner, name: f.ownerName, coords: f.from.coords, cargo: f.cargo },
        defender: { obj: b, tech: player.research, owner: 'me', name: player.name }, coords: b.coords, type: b.type === 'moon' ? 3 : 1, t });
      f.ships = res.attackerAfter;
      addTo(f.cargo, res.loot);
      if (!sumShips(f.ships)) { kill(f, t, 'destroyed'); return; }
    } else if (f.mission === 3) {
      addTo(b.res, { metal: f.cargo.metal, crystal: f.cargo.crystal, deuterium: f.cargo.deuterium });
    }
    goBack(f);
  }

  // ---- combat (OGX.botSim battle + steal when available; forced outcomes otherwise) [UPSTREAM MissionCaseAttack]
  function combat({ attacker, defender, coords, type, t }) {
    const S = world.combatMode === 'sim' ? botsim() : null;
    const tgt = defender.obj;
    const defUnits = Object.assign({}, cleanShips(tgt.ships), cleanShips(tgt.defense));
    const techOf = (r) => ({ weapons: num(r[109]), shielding: num(r[110]), armour: num(r[111]) });
    let out;
    if (S) {
      const seed = 'battle:' + rng.int(0, 2147483646);
      const r = S.battle({ attackers: [{ units: Object.assign({}, attacker.ships), tech: techOf(attacker.tech) }], defenders: [{ units: defUnits, tech: techOf(defender.tech) }],
        fleetDebrisPct: U.fleetDebrisPct, defDebrisPct: U.defDebrisPct, seed, moonFactor: U.moonFactor, moonMax: U.moonChance });
      const after = cleanShips(r.attackers[0].after);
      let loot = { metal: 0, crystal: 0, deuterium: 0 };
      if (r.won === 'a') {
        const st = S.steal({ ships: after, storageFactor: player.storageFactor && attacker.owner === 'me' ? player.storageFactor : 0, carried: { metal: attacker.cargo.metal, crystal: attacker.cargo.crystal, deuterium: attacker.cargo.deuterium }, planet: { metal: tgt.res.metal, crystal: tgt.res.crystal, deuterium: tgt.res.deuterium } });
        loot = { metal: Math.floor(st.metal || 0), crystal: Math.floor(st.crystal || 0), deuterium: Math.floor(st.deuterium || 0) };
      }
      out = { won: r.won, rounds: r.rounds, attackerAfter: after, defenderAfter: cleanShips(r.defenders[0].after), debris: { metal: r.debris.metal, crystal: r.debris.crystal },
        lost: { attacker: lostValue(r.lostValue && r.lostValue.attacker), defender: lostValue(r.lostValue && r.lostValue.defender) }, moonChance: r.moonChance || 0, loot, engine: 'botsim' };
    } else {
      const forced = world.combatMode === 'sim' ? 'win' : world.combatMode;
      if (world.combatMode === 'sim') world.combatFallback = 'botsim missing or without battle(): forced win';
      const won = forced === 'win' ? 'a' : forced === 'lose' ? 'r' : 'w';
      const value = (u) => Object.entries(u).reduce((s, [id, n]) => { const p = C.byId.get(+id).price; return s + (p.metal + p.crystal) * n; }, 0);
      const debrisOf = (u, pct) => Object.entries(u).reduce((d, [id, n]) => { const p = C.byId.get(+id).price; d.metal += p.metal * n * pct / 100; d.crystal += p.crystal * n * pct / 100; return d; }, { metal: 0, crystal: 0 });
      const defShips = cleanShips(tgt.ships);
      let attackerAfter = Object.assign({}, attacker.ships); let defenderAfter = Object.assign({}, defUnits); let debr = { metal: 0, crystal: 0 }; let lostA = 0; let lostD = 0;
      if (won === 'a') { defenderAfter = cleanShips(tgt.defense); debr = debrisOf(defShips, U.fleetDebrisPct); lostD = value(defUnits); }
      if (won === 'r') { attackerAfter = {}; debr = debrisOf(attacker.ships, U.fleetDebrisPct); lostA = value(attacker.ships); }
      let loot = { metal: 0, crystal: 0, deuterium: 0 };
      if (won === 'a') {
        const cap = Math.max(0, world.capacityOf(attackerAfter, attacker.owner === 'me') - attacker.cargo.metal - attacker.cargo.crystal - attacker.cargo.deuterium);
        const half = { metal: tgt.res.metal / 2, crystal: tgt.res.crystal / 2, deuterium: tgt.res.deuterium / 2 };
        const tot = half.metal + half.crystal + half.deuterium; const k = tot > cap && tot > 0 ? cap / tot : 1;
        loot = { metal: Math.floor(half.metal * k), crystal: Math.floor(half.crystal * k), deuterium: Math.floor(half.deuterium * k) };
      }
      out = { won, rounds: won === 'w' ? 6 : 1, attackerAfter: cleanShips(attackerAfter), defenderAfter: cleanShips(defenderAfter), debris: debr, lost: { attacker: lostA, defender: lostD }, moonChance: 0, loot, engine: 'forced:' + forced };
    }
    // apply: defender losses (defense after = incl. rebuilt), loot, debris (no deuterium)
    const ds = {}; const dd = {};
    for (const [id, n] of Object.entries(out.defenderAfter)) { if (+id >= 400) dd[id] = n; else ds[id] = n; }
    const defBefore = { ships: clone(tgt.ships), defense: clone(tgt.defense) };
    tgt.ships = ds; tgt.defense = dd;
    for (const r of RES) tgt.res[r] = Math.max(0, tgt.res[r] - out.loot[r]);
    if (out.debris.metal + out.debris.crystal > 0) {
      const d = debris.get(coords) || { metal: 0, crystal: 0 };
      d.metal += out.debris.metal; d.crystal += out.debris.crystal;
      debris.set(coords, d);
    }
    // moon chance [UPSTREAM MissionCaseAttack:341-351]
    const chance = Math.min(Math.round((out.debris.metal + out.debris.crystal) / 100000 * U.moonFactor), U.moonChance);
    let moonCreated = false;
    if (chance > 0 && type === 1 && rng.int(1, 100) <= chance) {
      const a = world.at(coords, 1);
      if (a.planet && !a.planet.moon) { a.planet.moon = { id: nextBodyId++, name: 'Moon', diameter: 8888, tempMin: -20, res: { metal: 0, crystal: 0, deuterium: 0 }, levels: {}, ships: {}, defense: {} }; moonCreated = true; }
      // [UPSTREAM MissionCaseAttack:380-386 + install.sql debris_moon DEFAULT 1]: a new moon erases the whole field (old + new)
      if (moonCreated && U.debrisMoon !== 0) debris.delete(coords);
    }
    const rid = (Math.floor(rng.float() * 0xffffffff).toString(16) + Math.floor(rng.float() * 0xffffffff).toString(16) + t.toString(16)).padEnd(32, '0').slice(0, 32);
    const report = { rid, t, coords, type, won: out.won, rounds: out.rounds, attacker: { name: attacker.name, coords: attacker.coords, tech: techOf(attacker.tech), before: clone(attacker.ships), after: out.attackerAfter },
      defender: { name: defender.name, coords, tech: techOf(defender.tech), before: Object.assign({}, defBefore.ships, defBefore.defense), after: out.defenderAfter },
      loot: out.loot, debris: out.debris, lost: out.lost, moonChance: chance, moonCreated, engine: out.engine };
    world.raports[rid] = report;
    const [g, s, p] = parseCoords(coords);
    const cls = out.won === 'a' ? ['raportWin', 'raportLose'] : out.won === 'r' ? ['raportLose', 'raportWin'] : ['raportDraw', 'raportDraw'];
    const viewerIsAttacker = attacker.owner === 'me';
    const html = `<div class="raportMessage"><table><tr><td colspan="2"><a href="game.php?page=raport&raport=${rid}" target="_blank"><span class="${viewerIsAttacker ? cls[0] : cls[1]}">Fight report [${g}:${s}:${p}] (${TYPE_SHORT[type] || 'P'})</span></a></td></tr><tr><td>Losses</td><td><span class="${cls[0]}">Attacker: ${pretty(out.lost.attacker)}</span>&nbsp;<span class="${cls[1]}">Defender: ${pretty(out.lost.defender)}</span></td></tr><tr><td>Profit</td><td><span>Metal:&nbsp;<span class="reportSteal element901">${pretty(out.loot.metal)}</span>&nbsp;</span><span>Crystal:&nbsp;<span class="reportSteal element902">${pretty(out.loot.crystal)}</span>&nbsp;</span><span>Deuterium:&nbsp;<span class="reportSteal element903">${pretty(out.loot.deuterium)}</span></span></td></tr><tr><td>Rubblefield</td><td><span>Metal:&nbsp;<span class="reportDebris element901">${pretty(out.debris.metal)}</span>&nbsp;</span><span>Crystal:&nbsp;<span class="reportDebris element902">${pretty(out.debris.crystal)}</span></span></td></tr></table></div>`;
    world.addMessage({ cat: 3, unix: t, subject: 'Fight report', body: html, combat: { rid, won: out.won, viewerIsAttacker } });
    world.log.events.push({ t, kind: 'battle', coords, won: out.won, engine: out.engine, loot: out.loot, debris: out.debris, rid });
    return out;
  }
  function lostValue(v) { return v ? Math.floor((+v.metal || 0) + (+v.crystal || 0)) : 0; }

  // ---------- snapshot / inspection
  world.snapshot = () => ({
    now: clock.nowUnix(), wall: fmtDate(clock.nowUnix(), tz), gamespeed, haltSpeed, player: clone(player), session: clone(world.session),
    bodies: clone(bodies), others: clone(others), debris: Object.fromEntries([...debris.entries()].map(([k, v]) => [k, clone(v)])),
    fleets: clone(world.fleets), messages: world.messages.map((m) => ({ id: m.id, cat: m.cat, unix: m.unix, subject: m.subject, read: m.read })),
    researchQueue: clone(world.researchQueue), log: clone(world.log), slots: { used: world.slotsUsed(), max: world.slotsMax(), expeditions: world.missionCount(15), expeditionsMax: world.expeditionsMax() },
    combatFallback: world.combatFallback,
  });

  // ---------- flights and messages present at start (C7.1)
  for (const fl of spec.flights || []) {
    const own = fl.owner === undefined || fl.owner === 'me';
    if (!own) { world.addHostile(Object.assign({ arrivalUnix: now0 + num(fl.arrivalIn, num(fl.flightSec, 60)) }, fl)); continue; }
    const from = world.body(fl.fromBodyId || (fl.from && fl.from.bodyId)) || bodies[0];
    const tc = fl.to && fl.to.coords ? fl.to.coords : fl.to;
    const ttype = num(fl.to && fl.to.type, 1);
    const dur = num(fl.duration, 600);
    const arrival = now0 + num(fl.arrivalIn, dur);
    const stay = num(fl.staySec, 0);
    const f = { id: nextFleetId++, owner: 'me', mission: num(fl.mission, 3), ships: cleanShips(fl.ships || { 202: 1 }),
      cargo: Object.assign({ metal: 0, crystal: 0, deuterium: 0, darkmatter: 0 }, fl.cargo || {}), speed: 10, consumption: 0,
      from: { coords: from.coords, type: from.type === 'moon' ? 3 : 1, bodyId: from.id, name: from.name },
      to: { coords: tc, type: ttype, bodyId: null, name: planetNameAt(tc, ttype) }, targetOwner: null,
      start: arrival - dur, arrival, stayEnd: stay ? arrival + stay : null, back: arrival + stay + dur, duration: dur,
      state: fl.state || 'out', recallable: true, via: 'spec' };
    if (f.state === 'back') { f.back = now0 + num(fl.backIn, dur); }
    world.fleets.push(f);
  }
  for (const m of spec.messages || []) world.addMessage(Object.assign({ unix: now0 - num(m.ago, 60) }, m));

  world.process(now0);
  return world;
}

module.exports = { createWorld, worldHandler, divEnd, loadScenario, scenarioNames, catalog, botsim, makeRng, fmtDate, fmtTime, fmtRest, wallParts, pretty, raw, esc, roundHalfEven, parseCoords, MISSION_NAMES, FLEET_STYLE, TYPE_PLANET, SCENARIO_DIR, LIVE };

// =================================================================== pages of the world mode (used by gz-server.js)
/** Index just after the </div> that closes the <div ...> starting at `start` (balanced), or -1. */
function divEnd(html, start) {
  const re = /<div\b|<\/div>/gi;
  re.lastIndex = start;
  let depth = 0; let m;
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') { depth--; if (depth === 0) return m.index + m[0].length; } else depth++;
  }
  return -1;
}
function replaceDiv(html, startMarker, content) {
  const a = html.indexOf(startMarker);
  if (a < 0) return html;
  const b = divEnd(html, a);
  if (b < 0) return html;
  return html.slice(0, a) + content + html.slice(b);
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortNum = (n) => { n = Math.floor(n); if (n >= 1e9) return Math.floor(n / 1e9) + '&nbsp;B'; if (n >= 1e6) return Math.floor(n / 1e6) + '&nbsp;M'; if (n >= 1e4) return Math.floor(n / 1e3) + 'K'; return pretty(n); };
const fmtDur = (sec) => `${Math.floor(sec / 3600)}:${p2(Math.floor(sec / 60) % 60)}:${p2(sec % 60)} h`;

/**
 * Request handler of the world mode: (ctx, H) -> response | undefined (undefined = fall through to the static mock).
 * H = { pageFile(name), infoPage(html, message, buttons), messagesFragment(html) } from gz-server.js.
 */
function worldHandler(world, H) {
  const W = world; const C = W.catalog; const tz = W.clock.tz;
  const LINK = (q) => `${LIVE}?${q}`;
  const tokens = new Map();
  const galLink = (coords, cls) => { const [g, s] = parseCoords(coords); return `<a href="${LINK(`page=galaxy&amp;galaxy=${g}&amp;system=${s}`)}" class="${cls}">[${coords}]</a>`; };
  const typeWord = (t) => (t === 3 ? 'Moon' : 'Planet');

  // ---------------------------------------------------------------- frame (every full page)
  function selectorOptions(cur) {
    const out = [];
    for (const p of W.planets()) {
      out.push(`<option value="${p.id}"${p.id === cur.id ? ' selected="selected"' : ''}>${esc(p.name)} [${p.coords}]</option>`);
      const m = p.moonId ? W.body(p.moonId) : null;
      if (m) out.push(`<option value="${m.id}"${m.id === cur.id ? ' selected="selected"' : ''}>${esc(m.name)} (Moon) [${m.coords}]</option>`);
    }
    return out.join('\n') + '\n';
  }
  function planetList(cur) {
    const items = W.planets().map((p) => {
      const m = p.moonId ? W.body(p.moonId) : null;
      const tip = (b) => esc(`\n\t\t\t\t<div style='text-align:left'>\n\t\t\t\t<b>${b.name} [${b.coords}]</b><br>\n\t\t\t\t${b.tempMin}°C to ${b.tempMax}°C<br>\n\t\t\t\t${pretty(b.diameter)} km (${b.fieldsUsed} / ${b.fieldsMax})<br>\n\t\t\t\t<a href='game.php?page=overview&cp=${b.id}'>Overview</a><br>\n\t\t\t\t</div>`);
      const building = p.buildQueue.length ? '<i class="bi bi-building-fill-up buildingIco"></i>' : '';
      const active = p.id === cur.id ? ' active active-planet' : '';
      // moon link: [UPSTREAM] main.navigation planet list (a.moonlink), never saved live
      const moon = m ? `\n\t\t\t\t\t\t\t<a href="${LINK(`page=overview&amp;cp=${m.id}`)}" class="moonlink${m.id === cur.id ? ' active' : ''} tooltipLeft js_hideTipOnMobile" title="${tip(m)}"><img class="icon-moon" src="./1_files/s_mond.gif" alt=""></a>` : '';
      return `<div id="planetList">\n\t\t\t\t\t\t<div class="smallplanet">\n\n\t\t\t\t\t\t\t<a href="${LINK(`page=overview&amp;cp=${p.id}`)}" class="planetlink ${active} planetPic reloadTips tooltipRight tooltipClose js_hideTipOnMobile" title="${tip(p)}">\n\t\t\t\t\t\t\t\t<img class="planetPic" src="./1_files/s_${p.image}.gif">\n\t\t\t\t\t\t\t\t<span class="planet-name">${esc(p.name)}</span>\n\t\t\t\t\t\t\t\t<span class="planet-koords">[${p.coords}]\n\t\t\t\t\t\t\t\t${building}</span>\n\t\t\t\t\t\t\t</a>${moon}\n\t\t\t\t\t\t</div>\n\t\t\t\t\t</div>`;
    });
    return items.join('\n\t\t\t\t\t');
  }
  function shipsBlind(ships) { return Object.entries(ships).map(([id, n]) => `${n} ${C.name(id)}`).join('; '); }
  function shipsTip(ships) {
    return esc(`<table style='width:200px'>${Object.entries(ships).map(([id, n]) => `<tr><td style='width:50%;color:white'>${C.name(id)}:</td><td style='width:50%;color:white'>${pretty(n)}</td></tr>`).join('')}</table>`);
  }
  /** FlyingFleetsTable events [UPSTREAM class.FlyingFleetsTable.php]: [{ time, fleet, status }] sorted by time. */
  function events(now) {
    const out = [];
    for (const f of W.fleets) {
      if (f.state === 'done') continue;
      if (f.owner === 'me') {
        if (f.state === 'out' && f.arrival > now) out.push({ time: f.arrival, f, status: 'flight' });
        if (f.mission === 10) continue;
        if (f.mission === 4 && f.state === 'out') continue;
        if (f.mission === 5 && (f.state === 'out' || f.state === 'hold') && f.stayEnd > now) out.push({ time: f.stayEnd, f, status: 'holding' });
        if (f.back > now) out.push({ time: f.back, f, status: 'return' });
      } else if (f.state === 'out' && f.arrival > now && f.mission !== 8) out.push({ time: f.arrival, f, status: 'flight' });
    }
    return out.sort((a, b) => a.time - b.time || a.f.id - b.f.id);
  }
  function eventText(e) {
    const f = e.f; const own = f.owner === 'me'; const style = (own ? 'own' : '') + FLEET_STYLE[f.mission];
    const fleetsA = `<a href="${LINK('page=overview#')}" data-tooltip-content="${shipsTip(f.ships)}" class="tooltip ${style}">Fleets</a>`;
    let blind;
    if (own || num(W.player.research[106]) >= 8) blind = `<span class="textForBlind"> (${shipsBlind(f.ships)})</span>`;
    else blind = `<span class="textForBlind"> (The fleet is composed of ${sumShips(f.ships)} units: ${Object.keys(f.ships).map((id) => C.name(id)).join('; ')})</span>`;
    const cargo = own && f.cargo.metal + f.cargo.crystal + f.cargo.deuterium > 0 ? `<span class="textForBlind"> (Ressources: ${pretty(f.cargo.metal)} Metal; ${pretty(f.cargo.crystal)} Crystal; ${pretty(f.cargo.deuterium)} Deuterium)</span>` : '';
    const from = `${typeWord(f.from.type)} ${esc(f.from.name)} ${galLink(f.from.coords, style)}`;
    const toName = f.to.name || W.planetNameAt(f.to.coords, f.to.type);
    const mission = `Mission: ${MISSION_NAMES[f.mission]}`;
    if (!own) {
      const pm = `${esc(W.fleetOwnerName(f))} <a href="#" onclick="return Dialog.PM(${typeof f.owner === 'number' ? f.owner : 0})">PM</a>`;
      return `A hostile ${fleetsA}${blind} from player ${pm} from ${from} reached the ${typeWord(f.to.type)} ${esc(toName)} ${galLink(f.to.coords, style)}. ${mission}`;
    }
    if (f.mission === 15) {
      if (e.status === 'return') return `One of your ${fleetsA}${blind}${cargo} returns from the Position ${galLink(f.to.coords, style)} back to ${from}. ${mission}`;
      return `One of your ${fleetsA}${blind}${cargo} from ${from} reached the Position ${galLink(f.to.coords, style)}. ${mission}`;
    }
    if (f.mission === 8) {
      if (e.status === 'return') return `One of your ${fleetsA}${blind}${cargo} returns from debris ${galLink(f.to.coords, style)} back to planet ${esc(f.from.name)} ${galLink(f.from.coords, style)}. ${mission}`;
      return `One of your ${fleetsA}${blind}${cargo} from ${from} reached the debris ${galLink(f.to.coords, style)}. ${mission}`;
    }
    const to = `${typeWord(f.to.type)} ${esc(toName)} ${galLink(f.to.coords, style)}`;
    if (e.status === 'return') return `One of your ${fleetsA}${blind}${cargo} returns from ${to} back to ${from}. ${mission}`;
    if (e.status === 'holding') return `One of your ${fleetsA}${blind}${cargo} from ${from} are in orbit around ${to}. ${mission}`;
    return `One of your ${fleetsA}${blind}${cargo} from ${from} reached the ${to}. ${mission}`;
  }
  function eventBox(now) {
    const evs = events(now);
    const one = (e, hidden) => {
      const style = (e.f.owner === 'me' ? 'own' : '') + FLEET_STYLE[e.f.mission];
      const hs = hidden ? ' style="display: none;"' : '';
      return `<div id="OvfleetEvents" class="OvfleetEvents_" style="padding:5px 10px;background-color:#000">
                <span id="fleettime_${e.time}${e.f.id}" class="fleets" data-fleet-end-time="${e.time}" data-fleet-time="${e.time - now}"${hs}>${fmtRest(e.time - now)}</span>
				<span class="fleet_static_time" data-fleet-end-time="${fmtTime(e.time, tz)}"${hidden ? ' data-hide="true"' + hs : ''}>${fmtTime(e.time, tz)}</span>
				<span${hidden ? ' data-hide="true"' : ''}><span class="${e.status} ${style}"${hs}>${eventText(e)}</span></span>
            </div>`;
    };
    const button = `<div id="OvfleetContent">
            <span style="text-align:center">
                <a class="OvfleetButton" href="javascript:eventHeader(&#39;.allFleetsEvent&#39;);" title="Activities"><img src="./1_files/dot.gif" width="15" height="15" alt=""></a>
            </span>
        </div>`;
    let html = '<div id="messages_collapsed" class="messpositionDiv" style="z-index:5;">\n';
    if (evs.length) {
      html += button + '\n' + one(evs[0], false) + '\n';
      for (const e of evs) html += `<div class="allFleetsEvent">\n${one(e, false)}\n</div>\n`;
    }
    return html + '</div>';
  }
  function frame(html, cur) {
    const now = W.clock.nowUnix();
    const w = wallParts(now, tz);
    html = html.replace(/(serverTime\s*=\s*new Date\()[^)]*\)/, `$1${w.Y}, ${w.M}, ${w.D}, ${w.h}, ${p2(w.m)}, ${p2(w.s)})`);
    html = html.replace(/(<div id="clock"[^>]*>)[^<]*/, `$1${MONTHS[w.M]} ${DOW[w.dow]} ${w.D} ${p2(w.h)}:${p2(w.m)}:${p2(w.s)}`);
    html = html.replace(/(<select id="planetSelector"[^>]*>)[^]*?(<\/select>)/, (m0, a, b) => `${a}\n${selectorOptions(cur)}\n${b}`);
    html = html.replace(/(<td id="planetImage">\s*<img src="[^"]*?s_)[a-z]+\d*(\.(?:gif|jpg|png))/, `$1${cur.image}$2`);
    html = html.replace(/(<span id="planetNameHeader">)[^<]*/, `$1${esc(cur.name)}`);
    const ph = W.perHour(cur); const st = W.storage(cur);
    for (const r of RES) {
      const v = cur.res[r];
      html = html.replace(new RegExp(`(id="current_${r}" data-real=")[^"]*(" data-tooltip-content=")[^"]*(">)[^<]*`), `$1${v}$2${pretty(v)}$3${shortNum(v)}`);
      html = html.replace(new RegExp(`resourceTicker\\(\\{\\s*available:\\s*\\([^)]*\\),\\s*limit:\\s*\\[0, "[^"]*"\\],\\s*production:\\s*[^,]*,\\s*valueElem:\\s*"current_${r}"`),
        `resourceTicker({\n            \t\t\tavailable: (${v}),\n            \t\t\tlimit: [0, "${Number.isFinite(st[r]) ? st[r] : 1e15}"],\n            \t\t\tproduction: ${ph[r]},\n            \t\t\tvalueElem: "current_${r}"`);
    }
    const en = W.energyOf(cur);
    html = html.replace(/(class="res_current tooltip Imperium[^"]*" t=")[^"]*(">\s*<span>\s*)[^<]*/, `$1${pretty(en.production - en.consumption)} / ${pretty(en.production)}$2${pretty(en.production - en.consumption)}&nbsp;/&nbsp;${shortNum(en.production)}\n                                    `);
    html = html.replace(/(id="current_darkmatter" data-real=")[^"]*(" data-tooltip-content=")[^"]*/, `$1${W.player.darkMatter}$2${pretty(W.player.darkMatter)}`);
    html = html.replace(/(var vacation\s*=\s*)\d+/, `$1${W.player.vacation ? 1 : 0}`);
    if (W.player.vacation && !/class="infobox"/.test(html)) html = html.replace(/<div id="messages_collapsed"/, '<div class="infobox">You are in vacation mode</div>\n<div id="messages_collapsed"');
    html = html.replace(/(class="new-msg-count">)\s*\d*/, `$1${W.unread()}`);
    if (html.includes('<div id="messages_collapsed"')) html = replaceDiv(html, '<div id="messages_collapsed"', eventBox(now));
    html = html.replace(/(<div id="countColonies">\s*<p class="textCenter"><span>)\[\d+ \/ \d+\]/, `$1[${W.planets().length} / ${W.player.maxPlanets}]`);
    const first = html.indexOf('<div id="planetList">');
    if (first >= 0) {
      let end = first; let at = first;
      while (at >= 0) { const e = divEnd(html, at); if (e < 0) break; end = e; at = html.indexOf('<div id="planetList">', e); if (at >= 0 && html.slice(e, at).trim()) break; }
      html = html.slice(0, first) + planetList(cur) + html.slice(end);
    }
    return html;
  }
  /** Replace the content between .headerRS and .footerRS (the page body of most game pages). */
  function mainRS(html, content) {
    const a = html.indexOf('<div class="mainRS');
    if (a < 0) return html;
    const b = divEnd(html, a);
    return html.slice(0, a) + content + html.slice(b);
  }

  // ---------------------------------------------------------------- fleetTable
  function fleetTable(html, cur, q) {
    const now = W.clock.nowUnix();
    const used = W.slotsUsed(); const max = W.slotsMax();
    const rows = W.ownFleets().sort((a, b) => a.start - b.start || a.id - b.id).map((f, i) => {
      const back = f.state === 'back';
      const timer = f.state === 'out' ? f.arrival : f.state === 'hold' ? f.stayEnd : f.back;
      const recall = f.recallable && !back ? `<form action="${LINK('page=fleetTable&amp;action=sendfleetback')}" method="post">
                                        <input name="fleetID" value="${f.id}" type="hidden">
                                        <input class="button red small tooltip" data-tooltip-content="Return" value="Return" type="submit">
                                    </form>` : '';
      const tip = esc(`<table list listOfOthers><tr><th colspan='2' style='text-align:center;'>Details</th></tr>${Object.entries(f.ships).map(([id, n]) => `<tr><td class='transparent'>${C.name(id)}:</td><td class='transparent'>${n}</td></tr>`).join('')}</table>`);
      return `                <tr>
                    <td>${i + 1}</td>
                    <td>${MISSION_NAMES[f.mission]}
                                                    <br><a title="${back ? 'Return to the Planet' : 'Fleet Target'}">${back ? '(R)' : '(A)'}</a>
                                            </td>
                    <td><a class="tooltip_sticky" data-tooltip-content="${tip}">${pretty(sumShips(f.ships))}</a>
                    </td>
                    <td><a href="${LINK(`page=galaxy&amp;galaxy=${parseCoords(f.from.coords)[0]}&amp;system=${parseCoords(f.from.coords)[1]}`)}">[${f.from.coords}]</a>
                    </td>
                    <td${back ? '' : ' style="color:lime"'}>${fmtDate(f.arrival, tz)}</td>
                        <td><a href="${LINK(`page=galaxy&amp;galaxy=${parseCoords(f.to.coords)[0]}&amp;system=${parseCoords(f.to.coords)[1]}`)}">[${f.to.coords}]</a>
                        </td>
                                                    <td${back ? ' style="color:lime"' : ''}>${fmtDate(f.back, tz)}</td>
                                                        <td id="fleettime_${i + 1}" class="fleets" data-fleet-end-time="${timer}" data-fleet-time="${Math.max(0, timer - now)}">${fmtRest(timer - now)}</td>
                            <td>
                                                                    ${recall}
                                                                                                </td>
                </tr>`;
    }).join('\n');
    const noSlots = used >= max ? '\n            <tr><td colspan="9">No more free fleet slots!</td></tr>' : '';
    const ships = Object.keys(cur.ships).map(Number).sort((a, b) => a - b).filter((id) => cur.ships[id] > 0).map((id) => {
      const name = C.name(id);
      if (id === 212) return `                                    <tr>\n\n                        <td><img src="./7_files/212.gif" alt="${name}" width="25" height="25" align="left">${name}\n                                                        </td>\n                        <td id="ship212_value">${pretty(cur.ships[id])}</td>\n                                                    <td>&nbsp;</td>\n                            <td>&nbsp;</td>\n                                            </tr>`;
      return `                                    <tr>\n\n                        <td><img src="./7_files/${id}.gif" alt="${name}" width="25" height="25" align="left"> <span class="tooltip" data-tooltip-content="Speed:  ${Math.round(W.shipSpeed(id))}">${name}</span>                        </td>\n                        <td id="ship${id}_value">${pretty(cur.ships[id])}</td>\n                                                    <td><a class="button black small" href="javascript:maxShip(&#39;ship${id}&#39;);">max</a>\n                            </td>\n                            <td><input name="ship${id}" id="ship${id}_input" size="10" value="0"></td>\n                                            </tr>`;
    }).join('\n');
    const lv = (id) => num(W.player.research[id]);
    const B = W.player.bonusPct || { attack: lv(109) * 10, defense: lv(110) * 10, shield: lv(111) * 10, combustion: lv(115) * 10, impulse: lv(117) * 20, hyperspace: lv(118) * 30 };
    const pre = { galaxy: num(q.galaxy, cur.g), system: num(q.system, cur.s), planet: num(q.planet, cur.p), type: num(q.planettype, 1), mission: num(q.target_mission, 0) };
    const bon = (t, img, v) => `<td><img class="tooltipTop js_hideTipOnMobile" title="${t} +${v} %" src="./7_files/${img}" alt="">+${v} %</td>`;
    const content = `<div class="mainRS fleetTablemain">

        <table style="width:650px;margin-left:8px" class="list listOfOthers">
            <tbody><tr>
                <th colspan="9" style="text-align:center;">
                    <div class="transparent" style="text-align:left;float:left;">Fleet ${used} /
                        ${max}</div>
                    <div class="transparent" style="text-align:right;float:right;">${W.missionCount(15)} / ${W.expeditionsMax()}
                        expedition</div>
                    <div class="transparent" style="text-align:right;float:right;">${W.missionCount(16)} / 4
                        Asteroids&nbsp;&nbsp;</div>
                </th>
            </tr>
            <tr>
                <th class="textCenter">ID</th>
                <th class="textCenter">Mission</th>
                <th class="textCenter">Number</th>
                <th class="textCenter">Start</th>
                <th class="textCenter">Arrival(Destination)</th>
                <th class="textCenter">Destination</th>
                <th class="textCenter">Arrival(Back)</th>
                <th class="textCenter">Objective</th>
                <th class="textCenter">Order</th>
            </tr>
${rows}${noSlots}
                    </tbody></table>



                <form action="${LINK('page=fleetStep1')}" method="post">
            <input type="hidden" name="galaxy" value="${pre.galaxy}">
            <input type="hidden" name="system" value="${pre.system}">
            <input type="hidden" name="planet" value="${pre.planet}">
            <input type="hidden" name="type" value="${pre.type}">
            <input type="hidden" name="target_mission" value="${pre.mission}">
            <table class="table519 list listOfOthers hard-table">
                <tbody><tr>
                    <th colspan="4" style="text-align:left;">New mission: Select fleet</th>
                </tr>
                <tr>
                    <th class="textCenter">Type of Ship</th>
                    <th class="textCenter">Ships available</th>
                    <th class="textCenter">-</th>
                    <th class="textCenter">-</th>
                </tr>
${ships || '                <tr><td colspan="4">No ships available</td></tr>'}

                <tr class="alt">
                                            <td colspan="2"><a class="button black small" href="javascript:noShips();">No ship</a></td>
                        <td colspan="2"><a class="button black small" href="javascript:maxShips();">All ships</a></td>
                                    </tr>
${ships && used < max ? `
                                    <tr style="height:20px;">
                        <td colspan="4"><input class="button green" type="submit" value="Continue"></td>
                                </tr>` : ''}</tbody></table>
            <table class="hard-table">
                <tbody><tr>
                    <th colspan="3" style="text-align:center">Bonus</th>
                </tr>
                <tr>
                    <th style="width:33%;text-align:center">Weapons</th>
                    <th style="width:33%;text-align:center">Defense</th>
                    <th style="width:33%;text-align:center">Shield</th>
                </tr>
                <tr>
                    ${bon('Weapons', 'attack.png', B.attack)}
                    ${bon('Defense', 'defence.png', B.defense)}
                    ${bon('Shield', 'shield.png', B.shield)}
                </tr>
                <tr>
                    <th style="width:33%;text-align:center">Combustion Engine</th>
                    <th style="width:33%;text-align:center">Impulse Engine</th>
                    <th style="width:33%;text-align:center">Hyperspace Engine</th>
                </tr>
                <tr>
                    ${bon('Combustion Engine', 'combustion.png', B.combustion)}
                    ${bon('Impulse Engine', 'impulse.png', B.impulse)}
                    ${bon('Hyperspace Engine', 'hiperspace.png', B.hyperspace)}
                </tr>
            </tbody></table>
    </form></div>`;
    html = html.replace(/(<h2>Details: )[^<]*/, `$1${esc(cur.name)}`);
    return mainRS(html, content);
  }

  // ---------------------------------------------------------------- fleet steps
  const tokenOk = (form) => {
    const t = tokens.get(String(form.token || ''));
    if (!t) return { redirect: 'page=fleetTable&code=1' };
    if (W.clock.nowUnix() - t.time > 600) { tokens.delete(form.token); return { redirect: 'page=fleetTable&code=0' }; }
    return { t };
  };
  function step1(html, cur, ships, target, mission, token) {
    const dist = W.distance([cur.g, cur.s, cur.p], [target.galaxy, target.system, target.planet]);
    const maxSpeed = W.maxSpeed(ships);
    const dur = W.duration(10, dist, maxSpeed);
    const cons = W.consumption(ships, dur, dist);
    const room = W.capacityOf(ships);
    const now = W.clock.nowUnix();
    const data = { fleetroom: String(Math.floor(room)), gamespeed: W.gamespeed, fleetspeedfactor: W.flyFactor(), planet: { galaxy: String(cur.g), system: String(cur.s), planet: String(cur.p), planet_type: cur.type === 'moon' ? '3' : '1' },
      maxspeed: maxSpeed, ships: Object.fromEntries(Object.entries(ships).map(([id, n]) => [id, { consumption: String(W.shipFuel(id)), speed: W.shipSpeed(id), amount: String(n) }])), fleetMinDuration: W.universe.minFleetTime };
    const clk = (u) => { const w = wallParts(u, tz); return `${MONTHS[w.M]} ${DOW[w.dow]} ${w.D} ${p2(w.h)}:${p2(w.m)}:${p2(w.s)}`; };
    const others = W.bodies.filter((b) => b.id !== cur.id);
    let cols = '';
    others.forEach((b, i) => {
      if (i % 2 === 0) cols += '                            <tr style="height:20px;">';
      cols += `                    <td>\n                        <a href="javascript:setTarget(${b.g},${b.s},${b.p},${b.type === 'moon' ? 3 : 1});updateVars();">${esc(b.name)}${b.type === 'moon' ? ' (Moon)' : ''}                            [${b.coords}]</a>\n                    </td>\n`;
      if (i % 2 === 1) cols += '                                                        </tr>';
    });
    if (others.length % 2 === 1) cols += '                                                                    <td>&nbsp;</td>\n        </tr>';
    html = html.replace(/(name="token" value=")[^"]*/, `$1${token}`)
      .replace(/(name="target_mission" value=")\d*/, `$1${mission}`)
      .replace(/(id="galaxy" name="galaxy"[^>]*value=")\d*/, `$1${target.galaxy}`)
      .replace(/(id="system" name="system"[^>]*value=")\d*/, `$1${target.system}`)
      .replace(/(id="planet" name="planet"[^>]*value=")\d*/, `$1${target.planet}`)
      .replace(/(<select id="type" name="type"[^>]*>)[^]*?(<\/select>)/, (m0, a, b) => `${a}\n${[1, 2, 3].map((t) => `<option value="${t}"${t === target.type ? ' selected="selected"' : ''}>${TYPE_PLANET[t]}</option>`).join('\n')}\n\n                    ${b}`)
      .replace(/(<td id="distance">)[^<]*/, `$1${pretty(dist)}`)
      .replace(/(<td id="duration">)[^<]*/, `$1${fmtDur(dur)}`)
      .replace(/(<td id="arrival">)[^<]*/, `$1${clk(now + dur)}`)
      .replace(/(<td id="return">)[^<]*/, `$1${clk(now + 2 * dur)}`)
      .replace(/(<td id="consumption"><font color=")\w+(">)[^<]*/, `$1${cons <= cur.res.deuterium ? 'lime' : 'red'}$2${pretty(cons)}`)
      .replace(/(<td id="maxspeed">)[^<]*/, `$1${pretty(maxSpeed)}`)
      .replace(/(<td id="storage"><font color=")\w+(">)[^<]*/, `$1lime$2${pretty(room - cons)}`)
      .replace(/^(\s*data\s*=\s*)\{.*\};\s*$/m, (m0, a) => `${a}${JSON.stringify(data)};`);
    const a = html.indexOf('My planets</th>');
    if (a >= 0) {
      const s = html.indexOf('</tr>', a) + 5; const e = html.indexOf('</tbody></table>', s);
      if (s > 4 && e > 0) html = html.slice(0, s) + '\n' + cols + '\n' + html.slice(e);
    }
    return html;
  }
  function step2(html, t, missions) {
    const cur = W.body(t.cpId);
    const dist = W.distance([cur.g, cur.s, cur.p], [t.target.galaxy, t.target.system, t.target.planet]);
    const dur = W.duration(t.speed, dist, W.maxSpeed(t.ships));
    const cons = W.consumption(t.ships, dur, dist);
    const room = W.capacityOf(t.ships);
    const radios = missions.map((id) => `<input id="radio_${id}" type="radio" name="mission" value="${id}"${id === t.mission || missions.length === 1 ? ' checked="checked"' : ''}><label for="radio_${id}"><span></span>${MISSION_NAMES[id]}</label><br>${id === 15 ? '\n                                        <br><div style="color:red;padding-left:13px;">Attention! Explorations are dangerous missions, you can lose your fleet!</div><br>' : ''}`).join('\n                                        ');
    const stay = W.staytimeOptions(missions);
    // staytime: [UPSTREAM page.fleetStep2.default.tpl:222-231] (never saved live)
    const stayHtml = stay.length ? `
                <tr style="height:20px;"><th>At Flying</th></tr>
                <tr style="height:20px;">
                    <td>
                    <select name="staytime">
${stay.map((o) => `<option value="${o.value}">${o.hours}</option>`).join('\n')}
</select> Hours
                    </td>
                </tr>` : '';
    html = html.replace(/(name="token" value=")[^"]*/, `$1${t.token}`)
      .replace(/(<h2>Send fleet )[^<]*/, `$1${t.target.galaxy}:${t.target.system}:${t.target.planet} - ${TYPE_PLANET[t.target.type]}`)
      .replace(/<input id="radio_7"[^]*?<br>/, radios)
      .replace(/(id="remainingresources"><font color=")\w+(">)[^<]*/, `$1lime$2${pretty(room - cons)}`)
      .replace(/(<span id="consumption" class="consumption">)[^<]*/, `$1${cons}`)
      .replace(/(<span id="fleetPoints" class="fleetPoints">)[^<]*/, `$1${Math.round(W.expeditionPoints(t.ships))}`)
      .replace(/^(\s*data\s*=\s*)\{.*\};\s*$/m, (m0, a) => `${a}${JSON.stringify({ fleetroom: String(Math.floor(room)), consumption: String(cons) })};`);
    if (stayHtml) html = html.replace(/(\n\s*<tr style="height:20px;">\s*<td class="transparent" colspan="3">Fleet points)/, stayHtml + '$1');
    return html;
  }
  function step3(html, r) {
    const f = r.fleet;
    const rows = [['Mission', MISSION_NAMES[f.mission]], ['Distance', pretty(f.distance)], ['Fleet speed', pretty(f.maxSpeed)], ['Consumption of deuterium', pretty(f.consumption)],
      ['From', f.from.coords], ['Destination', f.to.coords], ['Target time', fmtDate(f.arrival, tz)], ['Time of Return', fmtDate(f.back, tz)]];
    const content = `<div class="mainRS">	
<table class="table519 list listOfOthers hard-table">
	<tbody><tr>
		<th colspan="2" class="success">Fleet sent</th>
	</tr>
${rows.map(([k, v], i) => `    <tr${i % 2 ? ' class="alt"' : ''}>\n        <td>${k}</td>\n        <td>${v}</td>\n	</tr>`).join('\n')}
    <tr>
        <th colspan="2">Fleet</th>
    </tr>
${Object.entries(f.ships).map(([id, n]) => `		<tr>\n		<td>${C.name(id)}</td>\n		<td>${pretty(n)}</td>\n	</tr>`).join('\n')}
	
</tbody></table>
</div>`;
    return mainRS(html, content);
  }

  // ---------------------------------------------------------------- galaxy
  function galaxyPage(html, cur, g, s) {
    const lv = (id) => num(W.player.research[id]);
    const rows = [];
    let colonized = 0;
    for (let pos = 1; pos <= W.universe.maxPlanets; pos++) {
      const coords = coordsOf(g, s, pos);
      const a = W.at(coords, 1);
      const deb = W.debris.get(coords);
      if (!a.occupied) {
        rows.push(`		<tr class="row">
    		<td class="position">
			<a class="tooltipTop js_hideTipOnMobile" title="Planet fields: 150-250&lt;br /&gt;Approximately20°Cto60°C&lt;br /&gt;" href="${LINK(`page=fleetTable&amp;galaxy=${g}&amp;system=${s}&amp;planet=${pos}&amp;planettype=1&amp;target_mission=7`)}"><span style="font-weight:bold;color:#FF1010">${pos}</span></a>
		</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
    	</tr>`);
        continue;
      }
      colonized++;
      const own = !!a.ownPlanet;
      const pl = own ? a.ownPlanet : a.planet;
      const o = a.other;
      const moon = own ? (pl.moonId ? W.body(pl.moonId) : null) : pl.moon;
      const name = own ? W.player.name : o.name;
      const fl = (u, mission, type = 1) => `&lt;li&gt;&lt;a href=&#39;?page=fleetTable&amp;amp;galaxy=${g}&amp;amp;system=${s}&amp;amp;planet=${pos}&amp;amp;planettype=${type}&amp;amp;target_mission=${mission}&#39;&gt;${u}&lt;/a&gt;&lt;/li&gt;`;
      const links = own ? `&lt;li&gt;&lt;/li&gt;\n\t\t\t${fl('Deploy', 4)}\n\t\t\t${fl('Transport', 3)}`
        : `&lt;li&gt;&lt;a href=&#39;javascript:doit(6,${pl.id});&#39;&gt;Espionage&lt;/a&gt;&lt;/li&gt;\n\t\t\t${fl('Attack', 1)}\n\t\t\t${fl('Hold', 5)}\n\t\t\t${fl('Transport', 3)}`;
      const pTip = `&lt;div style=&#39;&#39; class=&#39;htmlTooltip galaxyTooltip&#39;&gt;&lt;h1&gt;Planet ${esc(esc(pl.name))}&lt;/h1&gt;&lt;div class=&#39;splitLine&#39;&gt;&lt;/div&gt;&lt;ul class=&#39;ListImage&#39;&gt;&lt;li&gt;&lt;span id=&#39;pos-planet&#39;&gt;[${coords}]&lt;/span&gt;&lt;/li&gt;&lt;li&gt;&lt;img class=&#39;planetTooltip jungle_2&#39; src=&#39;./styles/theme/gow/planeten/small/s_${pl.image}.gif&#39;  alt=&#39;&#39; height=&#39;33&#39;&gt;&lt;/li&gt;&lt;/ul&gt;\n\t\t\t&lt;ul class=&#39;ListLinks&#39;&gt;\n\t\t\t${links}\n\t\t\t\t&lt;/ul&gt;\n\t\t\t\t&lt;/div&gt;\n\t\t\t`;
      let act = '';
      if (!own && pl.lastActivity !== null && pl.lastActivity !== undefined) act = +pl.lastActivity <= 15 ? ' (*)' : +pl.lastActivity < 60 ? ` (${+pl.lastActivity} min)` : '';
      // moon cell [UPSTREAM galaxy row tpl:110-116] in the live style of the synthetic fixture
      const moonCell = moon ? `\n			<a class="tooltipRight tooltipClose js_hideTipOnMobile" title="&lt;div class=&#39;htmlTooltip galaxyTooltip&#39;&gt;&lt;h1&gt;Moon ${esc(esc(moon.name))} [${coords}]&lt;/h1&gt;&lt;div class=&#39;splitLine&#39;&gt;&lt;/div&gt;&lt;table&gt;&lt;tr&gt;&lt;td&gt;Diameter&lt;/td&gt;&lt;td&gt;${pretty(moon.diameter)}&lt;/td&gt;&lt;/tr&gt;&lt;tr&gt;&lt;td&gt;Temperature&lt;/td&gt;&lt;td&gt;${moon.tempMin}&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;&lt;ul class=&#39;ListLinks&#39;&gt;${own ? fl('Deploy', 4, 3) : `&lt;li&gt;&lt;a href=&#39;javascript:doit(6,${moon.id});&#39;&gt;Espionage&lt;/a&gt;&lt;/li&gt;${fl('Attack', 1, 3)}`}&lt;/ul&gt;&lt;/div&gt;"><img src="./styles/theme/gow/planeten/small/s_mond.gif" height="22" width="22" alt=""></a>\n\t\t` : '';
      const debCell = deb && deb.metal + deb.crystal > 0 ? `\n			<a class="tooltipRight tooltipClose js_hideTipOnMobile" title="&lt;div class=&#39;htmlTooltip galaxyTooltip&#39;&gt;&lt;h1&gt;Debris Field [${coords}]&lt;/h1&gt;&lt;div class=&#39;splitLine&#39;&gt;&lt;/div&gt;&lt;table&gt;&lt;tr&gt;&lt;td&gt;Metal:&lt;/td&gt;&lt;td&gt;${pretty(deb.metal)}&lt;/td&gt;&lt;/tr&gt;&lt;tr&gt;&lt;td&gt;Crystal:&lt;/td&gt;&lt;td&gt;${pretty(deb.crystal)}&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;&lt;ul class=&#39;ListLinks&#39;&gt;&lt;li&gt;&lt;a href=&#39;javascript:doit(8, ${pl.id});&#39;&gt;Recycle&lt;/a&gt;&lt;/li&gt;&lt;/ul&gt;&lt;/div&gt;"><img src="./styles/theme/gow/planeten/debris.gif" height="22" width="22" alt=""></a>\n\t\t` : '';
      const st = own ? '' : o.status || '';
      const flags = [];
      if (st.includes('b')) flags.push('banned');
      if (st.includes('v')) flags.push('vacation');
      if (st.includes('I')) flags.push('inactive', 'longinactive'); else if (st.includes('i')) flags.push('inactive');
      if (!own && o.protection === 'noob') flags.push('noob');
      if (!own && o.protection === 'strong') flags.push('strong');
      const short = { banned: 'b', vacation: 'v', inactive: 'i', longinactive: 'I', noob: 'n', strong: 's' };
      const shown = flags.filter((f) => !(f === 'inactive' && flags.includes('longinactive')));
      const flagSpans = shown.length ? `\n				<span>(</span>${shown.map((f) => `<span class="galaxy-short-${f} galaxy-short">${short[f]}</span>`).join('&nbsp;')}<span>)</span>` : '';
      const rank = own ? W.player.rank : o.rank;
      const pid = own ? W.player.id : o.id;
      const plTip = `\n			&lt;div id=&#39;player&#39; style=&#39;&#39; class=&#39;htmlTooltip galaxyTooltip&#39;&gt;\n			&lt;h1&gt;Player: &lt;span&gt;${esc(esc(name))}&lt;/span&gt;&lt;/h1&gt;\n			&lt;div class=&#39;splitLine&#39;&gt;&lt;/div&gt;\n			&lt;ul class=&#39;ListLinks&#39;&gt;\n				&lt;li class=&#39;rank&#39;&gt;Ranking: ${rank}&lt;/li&gt;\n${own ? '' : `				&lt;li&gt;&lt;a href=&#39;#&#39; onclick=&#39;return Dialog.Buddy(${pid})&#39;&gt;Friend request&lt;/a&gt;&lt;/li&gt;\n				&lt;li&gt;&lt;a href=&#39;#&#39; onclick=&#39;return Dialog.Playercard(${pid});&#39;&gt;Player profile&lt;/a&gt;&lt;/li&gt;\n`}						&lt;li&gt;&lt;a href=&#39;?page=statistics&amp;amp;who=1&amp;amp;start=${rank}&#39;&gt;Stats&lt;/li&gt;&lt;/ul&gt;\n			&lt;/div&gt;`;
      const ally = !own && o.allyTag ? `\n			<a class="tooltipRight tooltipClose js_hideTipOnMobile" title="&lt;div class=&#39;htmlTooltip galaxyTooltip&#39;&gt;&lt;h1&gt;Alliance ${esc(esc(o.allyName || o.allyTag))}&lt;/h1&gt;&lt;ul class=&#39;ListLinks&#39;&gt;&lt;li&gt;&lt;a href=&#39;?page=alliance&amp;amp;mode=info&amp;amp;id=${o.allyId}&#39;&gt;Information&lt;/a&gt;&lt;/li&gt;&lt;/ul&gt;&lt;/div&gt;"><span class="galaxy-alliance">${esc(o.allyTag)}</span></a>` : '';
      const actions = own ? '' : `<a href="javascript:doit(6,${pl.id},{&quot;210&quot;:&quot;${W.player.spyProbes}&quot;})"><img src="./styles/theme/gow/img/e.gif" title="Spying" alt=""></a><a href="#" onclick="return Dialog.PM(${pid})"><img src="./styles/theme/gow/img/m.gif" title="Write message" alt=""></a><a href="#" onclick="return Dialog.Buddy(${pid})"><img src="./styles/theme/gow/img/b.gif" title="Friend request" alt=""></a>`;
      rows.push(`		<tr class="row">
    		<td class="position">
			<span style="color:#FC4242">${pos}</span>
		</td>
        		<td class="microplanet1">
			<a class="tooltipRight tooltipClose js_hideTipOnMobile" title="${pTip}">
				<img src="./styles/theme/gow/planeten/small/s_${pl.image}.gif" height="30" width="30" alt="">
			</a>
		</td>
		<td align="center" class="planetname1" style="white-space: nowrap;">${esc(pl.name)}${act}</td>
		<td class="moon" style="white-space: nowrap;">${moonCell}
					</td>
		<td class="spacer02" style="white-space: nowrap;">
		</td>

		<td class="debris" style="white-space: nowrap;">${debCell}
         		</td>

		<td class="playername">
			<a class="tooltipRight tooltipClose js_hideTipOnMobile" title="${plTip}">
				<span class="${flags.map((f) => 'galaxy-username-' + f).join(' ')}${flags.length ? ' ' : ''}galaxy-username">${esc(name)}</span>${flagSpans}
							</a>
		</td>
		<td class="spacer03"></td>
		<td class="allytag" style="white-space: nowrap;">${ally}
			 		</td>
		<td class="spacer04"></td>
		<td class="action" colspan="2" style="white-space: nowrap;">
			 ${actions}					</td>
		</tr>`);
    }
    const rec = num(cur.ships[209]); const giga = num(cur.ships[219]);
    html = html.replace(/(<input type="text" name="galaxy" value=")\d*/, `$1${g}`)
      .replace(/(<input type="text" name="system" value=")\d*/, `$1${s}`)
      .replace(/(page=fleetTable&amp;galaxy=)\d+(&amp;system=)\d+(&amp;planet=16)/, `$1${g}$2${s}$3`)
      .replace(/\d[\d.]*(\s*Spy Probes)/, `${pretty(num(cur.ships[210]))}$1`)
      .replace(/\d[\d.]*(\s*Recycler\s)/, `${pretty(rec)}$1`)
      .replace(/\d[\d.]*(\s*Giga Recycler)/, `${pretty(giga)}$1`)
      .replace(/\d[\d.]*(\s*Available Missiles)/, `${pretty(num(cur.defense[503]))}$1`)
      .replace(/(<span id="slotValue">\s*<!--[^>]*-->\s*)\d+\/\d+/, `$1${W.slotsUsed()}/${W.slotsMax()}`)
      .replace(/(<span id="colonized">\()\d+/, `$1${colonized}`);
    const a = html.indexOf('<tbody>', html.indexOf('id="galaxyheadbg2"'));
    const b = html.indexOf('</tbody>', a);
    if (a > 0 && b > a) html = html.slice(0, a + 7) + '\n' + rows.join('\n') + '\n' + html.slice(b);
    return html;
  }

  // ---------------------------------------------------------------- buildings / research / shipyard
  function techPage(html, cur, kind) {
    const now = W.clock.nowUnix();
    const levelOf = (id) => (kind === 'research' ? num(W.player.research[id]) : id >= 400 ? num(cur.defense[id]) : id >= 200 ? num(cur.ships[id]) : num(cur.levels[id]));
    // never let one item's match run into the next item (an item without the level span would shift every later level)
    html = html.replace(/(data-technology="(\d+)"(?:(?!data-technology=)[^])*?<span class="level" data-value=")\d+("[^>]*>\s*<span>)[\d.]*(<\/span>)/g, (m0, a, id, b, c) => `${a}${levelOf(+id)}${b}${levelOf(+id)}${c}`);
    // REAL research.html markup: <a class="detail_button" data-technology="117"><span class="ecke"><span class="level" style="...">7</span>
    html = html.replace(/(data-technology="(\d+)"(?:(?!data-technology=)[^])*?<span class="level" style="[^"]*">)[\d.]*(<\/span>)/g, (m0, a, id, c) => `${a}${levelOf(+id)}${c}`);
    let box = '';
    if (kind === 'buildings' || kind === 'research') {
      const q = kind === 'buildings' ? cur.buildQueue : W.researchQueue;
      const field = kind === 'buildings' ? 'building' : 'tech';
      let end = now;
      // queue box [UPSTREAM page.buildings.default.tpl / page.research.default.tpl buildlist]
      box = q.length ? `<div id="buildlist" class="buildlist">\n\t<table style="width:760px">\n${q.map((x, i) => {
        const dur = x.end ? x.end - (x.start || now) : W.buildTime(W.body(x.bodyId || cur.id) || cur, x.id, x.level);
        end = x.end || end + dur;
        const head = i === 0;
        return `\t\t<tr>\n\t\t\t<td style="width:70%;vertical-align:top;" class="left">\n\t\t\t\t${i + 1}.: \n\t\t\t\t<form class="build_form" action="game.php?page=${kind}" method="post">\n\t\t\t\t\t<input type="hidden" name="cmd" value="insert">\n\t\t\t\t\t<input type="hidden" name="${field}" value="${x.id}">\n\t\t\t\t\t<button type="submit" class="build_submit onlist">${esc(C.name(x.id))} ${x.level}</button>\n\t\t\t\t</form>${head ? `\n\t\t\t\t<br><br><div id="progressbar" data-time="${Math.max(0, end - now)}"></div>` : ''}\n\t\t\t</td>\n\t\t\t<td>${head ? `\n\t\t\t\t<div id="time" data-time="${Math.max(0, end - now)}"><br></div>\n\t\t\t\t<form action="game.php?page=${kind}" method="post" class="build_form">\n\t\t\t\t\t<input type="hidden" name="cmd" value="cancel">\n\t\t\t\t\t<button type="submit" class="build_submit onlist">Cancel</button>\n\t\t\t\t</form>` : `\n\t\t\t\t<form action="game.php?page=${kind}" method="post" class="build_form">\n\t\t\t\t\t<input type="hidden" name="cmd" value="remove">\n\t\t\t\t\t<input type="hidden" name="listid" value="${i + 1}">\n\t\t\t\t\t<button type="submit" class="build_submit onlist">Cancel</button>\n\t\t\t\t</form>`}\n\t\t\t\t<br><span style="color:lime" data-time="${end}" class="timer">${fmtDate(end, tz)}</span>\n\t\t\t</td>\n\t\t</tr>`;
      }).join('\n')}\n\t</table>\n</div>` : '';
    } else {
      const items = cur.shipyardQueue.map((x) => [C.name(x.id), x.count - x.done, x.per, x.id]);
      const head = cur.shipyardQueue[0];
      const plus = head ? Math.max(0, now - (head.start + head.done * head.per)) : 0;
      const total = cur.shipyardQueue.reduce((s2, x) => s2 + (x.count - x.done) * x.per, 0) - plus;
      // shipyard queue [UPSTREAM page.shipyard.default.tpl: inline data + #bx]
      box = items.length ? `<div id="bx" class="z"></div>\n<script type="text/javascript">\ndata = ${JSON.stringify({ Queue: items, b_hangar_id_plus: plus, pretty_time_b_hangar: fmtRest(total) })};\n</script>` : '';
    }
    html = html.replace(/(<div class="largebox">)\s*(<\/div>)/, `$1\n${box}\n$2`);
    return html;
  }

  // ---------------------------------------------------------------- imperium (empire overview)
  // The saved REAL imperium.html shows the live account; the world regenerates its table.empire from the world's bodies
  // (same row/section layout: Empire header rows, then Resources 901-903+911, Buildings, Technologies, Ships, Defenses with
  // one row per id in ascending id order; column 2 = total / research level, then one column per body).
  const IMPERIUM_ROWS = [
    ['Resources', [901, 902, 903, 911]],
    ['Buildings', [1, 2, 3, 4, 6, 12, 14, 15, 21, 22, 23, 24, 31, 33, 34, 41, 42, 43, 44, 71, 72, 73]],
    ['Technologies', [106, 108, 109, 110, 111, 113, 114, 115, 117, 118, 120, 121, 122, 123, 124, 131, 132, 133, 199]],
    ['Ships', [202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220]],
    ['Defenses', [401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411]],
  ];
  function imperiumPage(html) {
    const a = html.indexOf('<table class="empire');
    const b = a >= 0 ? html.indexOf('</table>', a) : -1;
    if (a < 0 || b < 0) return html;
    const list = W.bodies.slice();
    const cols = list.length + 2;
    const row = (label, total, vals) => `\t\t<tr>\n\t\t\t<td>${esc(label)}</td>\n\t\t\t<td>${total}</td>\n${vals.map((v) => `\t\t\t\t\t\t\t<td>${v}</td>`).join('\n')}\n\t\t</tr>`;
    const head = (t) => `\t\t<tr>\n\t\t\t<th colspan="${cols}">${t}</th>\n\t\t</tr>`;
    const valueOf = (b, id) => {
      if (id === 901) return b.res.metal; if (id === 902) return b.res.crystal; if (id === 903) return b.res.deuterium;
      if (id === 911) return W.energyOf(b).production;
      if (id >= 400) return num(b.defense[id]); if (id >= 200) return num(b.ships[id]);
      return num(b.levels[id]);
    };
    const out = [head('Empire'),
      `\t\t<tr>\n\t\t\t<td style="width:100px">Planet</td>\n\t\t\t<td style="width:100px;font-size: 50px;">Σ</td>\n${list.map((x) => `\t\t\t\t\t\t<td style="width:100px"><a href="${LINK('page=overview&amp;cp=' + x.id)}"><img width="38" height="38" border="0" src="./10_files/s_${x.image}.gif"></a></td>`).join('\n')}\n\t\t</tr>`,
      row('Name', 'Total', list.map((x) => esc(x.name))),
      row('Coordinates', '-', list.map((x) => `<a href="${LINK('page=galaxy&amp;galaxy=' + x.g + '&amp;system=' + x.s)}">[${x.coords}]</a>`)),
      row('Fields', '-', list.map((x) => `${num(x.fieldsUsed)} / ${num(x.fieldsMax)}`))];
    for (const [title, ids] of IMPERIUM_ROWS) {
      out.push(head(title));
      for (const id of ids) {
        if (title === 'Technologies') { const lv = num(W.player.research[id]); out.push(row(C.name(id), lv, list.map(() => lv))); continue; }
        const vals = list.map((x) => Math.floor(valueOf(x, id)));
        const total = vals.reduce((s2, v) => s2 + v, 0);
        out.push(row(C.name(id), pretty(total), vals.map(pretty)));
      }
    }
    return html.slice(0, a) + '<table class="empire statList list listOfResourceSettingsPerPlanet" style="margin-left:0;">\n\t<tbody>\n' + out.join('\n') + '\n\t</tbody>\n' + html.slice(b);
  }

  // ---------------------------------------------------------------- messages
  function messageRows(list) {
    return list.map((m) => `		<tr id="message_${m.id}" class="message_head${m.read ? '' : ' mes_unread'}">
		<td style="width:40px;" rowspan="2">
		<input name="messageID[${m.id}]" value="1" type="checkbox">		</td>
		<td>${fmtDate(m.unix, tz)}</td>
		<td>${esc(m.from)}</td>
		<td>${esc(m.subject)}
				</td>
	</tr>
	<tr class="messages_body">
		<td colspan="3" class="left">
		${m.body}
		</td>
	</tr>`).join('\n');
  }
  function messagesForm(cat, site) {
    const list = W.messages.filter((m) => cat === 100 || m.cat === cat).sort((a, b) => b.unix - a.unix || b.id - a.id);
    const per = 10; const pages = Math.max(1, Math.ceil(list.length / per));
    const page = list.slice((site - 1) * per, site * per);
    const sel = (n) => `<select name="action${n}">
				<option value="readmarked">Mark selected messages as read</option>
				<option value="readtypeall">Mark all messages of this type as read</option>
				<option value="readall">Mark all messages as read</option>
				<option value="deletemarked">Delete marked messages</option>
				<option value="deleteunmarked">Delete all messages not marked</option>
				<option value="deletetypeall">Delete all messages of this type</option>
				<option value="deleteall">Delete all messages</option>
			</select>
			<input value="Confirm" type="submit" name="submit${n}">`;
    const pager = Array.from({ length: pages }, (_, i) => `<a href="${LINK('page=messages#')}" onclick="Message.getMessages(${cat}, ${i + 1});return false;">${i + 1 === site ? `<b>[${i + 1}]</b>` : `[${i + 1}]`}</a>`).join('&nbsp;');
    const out = `<form action="${LINK('page=messages')}" method="post">
<input type="hidden" name="mode" value="action">
<input type="hidden" name="ajax" value="1">
<input type="hidden" name="messcat" value="${cat}">
<input type="hidden" name="side" value="${site}">
<div class="mainRS">
<table id="messagestable" class="hard-table" style="width:760px;">
	<tbody><tr>
		<th colspan="4">Messages</th>
	</tr>
		<tr>
		<td colspan="4">
			${sel('Top')}
		</td>
	</tr>
		<tr style="height: 20px;">
		<td class="right" colspan="4">Page: ${pager}</td>
	</tr>
	<tr style="height: 20px;">
		<td>Action</td>
		<td>Date</td>
		<td>From</td>
		<td>Subject</td>
	</tr>
${messageRows(page)}
		<tr>
		<td colspan="4">
			${sel('Bottom')}
		</td>
	</tr>
	</tbody></table>
</div>
</form>`;
    for (const m of page) m.read = true;   // ShowMessagesPage view marks the shown page read [UPSTREAM]
    return out;
  }
  function messagesPage(html, cat) {
    const counts = (c) => { const l = W.messages.filter((m) => c === 100 || m.cat === c); return [l.filter((m) => !m.read).length, l.length]; };
    html = html.replace(/(<span id="unread_(\d+)">)\d+(<\/span>\/<span id="total_\d+">)\d+/g, (m0, a, c, b) => { const [u, t] = counts(+c); return `${a}${u}${b}${t}`; });
    const frag = messagesForm(cat, 1);
    const at = html.indexOf('id="messagestable"');
    if (at < 0) return html;
    const s = html.lastIndexOf('<form', at); const e = html.indexOf('</form>', at);
    return html.slice(0, s) + frag + html.slice(e + 7);
  }
  function messageAction(form) {
    const action = String(form.actionBottom && form.submitBottom ? form.actionBottom : form.actionTop || form.actionBottom || '');
    const cat = num(form.messcat, 100);
    const marked = Object.keys(form).map((k) => /^messageID\[(\d+)\]$/.exec(k)).filter(Boolean).map((m) => +m[1]);
    const inCat = (m) => cat === 100 || m.cat === cat;
    const del = (pred) => { for (let i = W.messages.length - 1; i >= 0; i--) if (pred(W.messages[i])) W.messages.splice(i, 1); };
    if (action === 'readmarked') W.messages.forEach((m) => { if (marked.includes(m.id)) m.read = true; });
    else if (action === 'readtypeall') W.messages.forEach((m) => { if (inCat(m)) m.read = true; });
    else if (action === 'readall') W.messages.forEach((m) => { m.read = true; });
    else if (action === 'deletemarked') del((m) => marked.includes(m.id));
    else if (action === 'deleteunmarked') del((m) => inCat(m) && !marked.includes(m.id));
    else if (action === 'deletetypeall') del(inCat);
    else if (action === 'deleteall') del(() => true);
    W.log.events.push({ t: W.clock.nowUnix(), kind: 'messages-action', action, cat, marked });
  }

  // ---------------------------------------------------------------- statistics / raport / captcha [UPSTREAM templates]
  function statisticsContent(range) {
    const all = [{ id: W.player.id, name: W.player.name, rank: W.player.rank, points: W.player.points, me: true, allyId: W.player.allyId, allyName: null }]
      .concat(W.others.map((o) => ({ id: o.id, name: o.name, rank: o.rank, points: o.points, me: false, allyId: o.allyId, allyName: o.allyName })))
      .sort((a, b) => a.rank - b.rank);
    const start = Math.max(1, num(range, 1));
    const rows = all.filter((p) => p.rank >= start && p.rank < start + 100);
    const opts = Array.from({ length: Math.max(1, Math.ceil(Math.max(...all.map((p) => p.rank)) / 100)) }, (_, i) => i * 100 + 1)
      .map((v) => `<option value="${v}"${v === start ? ' selected="selected"' : ''}>${v}-${v + 99}</option>`).join('\n');
    return `<form name="stats" id="stats" method="post" action="">
	<table class="table519">
		<tr>
			<th>Statistics (Updated: ${fmtDate(W.clock.nowUnix() - (W.clock.nowUnix() % 1800), tz)})</th>
		</tr>
		<tr>
			<td>
				<label for="who">Show</label> <select name="who" id="who" onchange="$('#stats').submit();"><option value="1" selected="selected">Player</option>
<option value="2">Alliance</option></select>
				<label for="type">by</label> <select name="type" id="type" onchange="$('#stats').submit();"><option value="1" selected="selected">Points</option>
<option value="2">Fleets</option>
<option value="3">Research</option>
<option value="4">Buildings</option>
<option value="5">Defense</option></select>
				<label for="range">in the positions</label> <select name="range" id="range" onchange="$('#stats').submit();">${opts}</select>
			</td>
		</tr>
	</table>
</form>
<table class="table519">
<tr>
	<th style="width:60px;">Position</th>
	<th>Player</th>
	<th>&nbsp;</th>
	<th>Alliance</th>
	<th>Points</th>
</tr>
${rows.map((p) => `<tr>
	<td><a class="tooltip" data-tooltip-content="<span style='color:#87CEEB'>*</span>">${p.rank}</a></td>
	<td><a href="#" onclick="return Dialog.Playercard(${p.id}, '${esc(p.name)}');"${p.me ? ' style="color:lime"' : ''}>${esc(p.name)}</a></td>
	<td>${p.me ? '' : `<a href="#" onclick="return Dialog.PM(${p.id});"><img src="./styles/theme/gow/img/m.gif" title="Write message" alt="Write message"></a>`}</td>
	<td>${p.allyName ? `<a href="game.php?page=alliance&amp;mode=info&amp;id=${p.allyId}">${esc(p.allyName)}</a>` : '-'}</td>
	<td>${pretty(p.points)}</td>
</tr>`).join('')}
</table>`;
  }
  function raportPage(rid) {
    const r = W.raports[rid];
    if (!r) return null;
    const side = (who, x, units) => `<td class="transparent"><table><tr><td>${who} ${esc(x.name)} ([${x.coords}])<br>Weapons: ${x.tech.weapons * 10}% Shields: ${x.tech.shielding * 10}% Armour: ${x.tech.armour * 10}%</td></tr>${Object.keys(units).length ? `<tr><td><table><tr><td>Type</td>${Object.keys(units).map((id) => `<td>${C.name(id)}</td>`).join('')}</tr><tr><td>Number</td>${Object.values(units).map((n) => `<td>${pretty(n)}</td>`).join('')}</tr></table></td></tr>` : '<tr><td>Destroyed</td></tr>'}</table></td>`;
    const result = r.won === 'a' ? `The attacker has won the battle!<br>He captures ${pretty(r.loot.metal)} Metal, ${pretty(r.loot.crystal)} Crystal and ${pretty(r.loot.deuterium)} Deuterium` : r.won === 'r' ? 'The defender has won the battle!' : 'The battle ended in a draw, both fleets withdraw to their home planets.';
    // [UPSTREAM shared.mission.raport.tpl] condensed: rounds 1 (start) and last (after)
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="generator" content="GALAXYZ 1.8.git"><title>Combat report</title></head><body class="popup"><div id="content"><table>
<tr><td>At ${fmtDate(r.t, tz)} the following fleets met in battle:</td></tr>
<tr><td><table><tr>${side('Attacker', r.attacker, r.attacker.before)}${side('Defender', r.defender, r.defender.before)}</tr></table></td></tr>
<tr><td><table><tr>${side('Attacker', r.attacker, r.attacker.after)}${side('Defender', r.defender, r.defender.after)}</tr></table></td></tr>
<tr><td>${result}<br><br>The attacker has lost a total of ${pretty(r.lost.attacker)} units.<br>The defender has lost a total of ${pretty(r.lost.defender)} units.<br>At the coordinates are now: ${pretty(r.debris.metal)} Metal and ${pretty(r.debris.crystal)} Crystaldebris.<br>The chance of a moon was ${r.moonChance}%.${r.moonCreated ? '<br>The huge amounts of free-floating metal and crystal particles attract each other and slowly form a moon in orbit around the planet.' : ''}</td></tr>
</table></div></body></html>`;
  }
  const captchaPage = () => '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="generator" content="GALAXYZ 1.8.git"><title>Captcha</title></head><body><div id="content"><table class="table519"><tr><th>Info</th></tr><tr><td><p>Please solve the captcha to continue.</p><form id="captcha" method="post" action="game.php?page=overview"><div class="g-recaptcha" data-sitekey="x"></div><input type="submit" value="Send"></form></td></tr></table></div></body></html>';

  // ---------------------------------------------------------------- dispatch
  return function handle(ctx) {
    const { query, form, method } = ctx;
    const lc = String(ctx.page || 'overview').toLowerCase();
    const mode = String(ctx.mode || '').toLowerCase();
    const param = (k) => (query[k] !== undefined ? query[k] : form[k]);
    if (W.session.loggedOut) return ctx.send(302, '', 'text/html; charset=UTF-8', { Location: `${ctx.origin}/${ctx.srv.universe}/index.php` });
    if (W.session.captcha) { ctx.rec.fixture = 'world captcha'; return ctx.send(200, captchaPage()); }
    W.process(W.clock.nowUnix());
    const cur = W.body(ctx.state.cp) || W.bodies[0];
    if (!cur) return undefined;
    ctx.rec.world = { now: W.clock.nowUnix(), cp: cur.id };
    const page = (name, transform) => ctx.sendPage(name, (html) => frame(transform ? transform(html) : html, cur));
    const info = (message, buttons = []) => { ctx.rec.info = message; return ctx.sendPage('fleetStep3', (html) => frame(H.infoPage(html, message, buttons), cur)); };
    const back = [{ url: 'game.php?page=fleetTable', label: 'Back' }];

    if (/details?ajax$/.test(lc) || (lc === 'overview' && String(param('ajax') || '') === '1')) return undefined;
    if (lc === 'fleetstep1' && mode === 'checktarget') return undefined;

    if (lc === 'fleetstep1' && method === 'POST') {
      const ships = {};
      for (const [k, v] of Object.entries(form)) { const m = /^ship(\d+)$/.exec(k); if (m && Math.round(+v) >= 1 && m[1] !== '212') ships[m[1]] = Math.round(+v); }
      if (!Object.keys(ships).some((id) => num(cur.ships[id]) > 0)) return ctx.redirect('page=fleetTable');   // GotoFleetPage
      const token = require('crypto').randomBytes(16).toString('hex');
      const target = { galaxy: num(form.galaxy, cur.g), system: num(form.system, cur.s), planet: num(form.planet, cur.p), type: num(form.type, 1) };
      const mission = num(form.target_mission, 0);
      tokens.set(token, { token, time: W.clock.nowUnix(), ships, cpId: cur.id, target, mission, speed: 10, fleetGroup: num(form.fleet_group, 0) });
      return page('fleetStep1', (html) => step1(html, cur, ships, target, mission, token));
    }
    if (lc === 'fleetstep2' && method === 'POST') {
      const chk = tokenOk(form);
      if (chk.redirect) return ctx.redirect(chk.redirect);
      const t = chk.t;
      t.speed = Math.min(10, Math.max(1, num(form.speed, 10)));
      t.target = { galaxy: num(form.galaxy, t.target.galaxy), system: num(form.system, t.target.system), planet: num(form.planet, t.target.planet), type: num(form.type, t.target.type) };
      const from = W.body(t.cpId);
      const tg = { galaxy: t.target.galaxy, system: t.target.system, position: t.target.planet, type: t.target.type };
      const coords = coordsOf(tg.galaxy, tg.system, tg.position);
      const deb = W.debris.get(coords);
      if (tg.type === 2 && (!deb || deb.metal + deb.crystal <= 0)) return info("Don't have any debris fields!", back);
      const missions = W.availableMissions(t.ships, tg);
      if (!missions.length) return info('Without mission available (the planet exist?)', back);
      const dist = W.distance([from.g, from.s, from.p], [tg.galaxy, tg.system, tg.position]);
      const cons = W.consumption(t.ships, W.duration(t.speed, dist, W.maxSpeed(t.ships)), dist);
      if (cons > from.res.deuterium) return info('Not enough deuterium available.', back);
      return page('fleetStep2', (html) => step2(html, t, missions));
    }
    if (lc === 'fleetstep3' && method === 'POST') {
      const chk = tokenOk(form);
      if (chk.redirect) return ctx.redirect(chk.redirect);
      const t = chk.t;
      tokens.delete(t.token);
      const r = W.send({ originId: t.cpId, ships: t.ships, target: { galaxy: t.target.galaxy, system: t.target.system, position: t.target.planet, type: t.target.type },
        mission: num(form.mission, 0), speed: t.speed, staytime: form.staytime, cargo: { metal: form.metal, crystal: form.crystal, deuterium: form.deuterium } });
      if (!r.ok) return info(r.error, back);
      return page('fleetStep3', (html) => step3(html, r));
    }
    if (lc === 'fleetstep2' || lc === 'fleetstep3') return ctx.redirect('page=fleetTable');
    if (lc === 'fleetajax') return ctx.json(W.fleetAjax(cur.id, num(param('mission'), 0), num(param('planetID'), 0)));
    if (lc === 'fleettable') {
      if (String(param('action') || '').toLowerCase() === 'sendfleetback' && num(param('fleetID'), 0)) W.recall(num(param('fleetID'), 0));
      return page('fleetTable', (html) => fleetTable(html, cur, query));
    }
    if (lc === 'galaxy') {
      const g = num(param('galaxy'), cur.g); const s = num(param('system'), cur.s);
      const v = W.viewGalaxy(cur.id, g, s);
      if (!v.ok) return info(v.error);
      return page('galaxy', (html) => galaxyPage(html, cur, g, s));
    }
    if ((lc === 'buildings' || lc === 'research') && method === 'POST' && param('cmd')) {
      const cmd = String(param('cmd'));
      const id = num(lc === 'research' ? (param('tech') !== undefined ? param('tech') : param('building')) : param('building'), 0);
      W.order(lc, cur.id, { cmd, id, listid: param('listid') });
      return ctx.redirect('page=' + lc);
    }
    if (lc === 'buildings' || lc === 'research') return page(lc, (html) => techPage(html, cur, lc));
    if (lc === 'imperium') return page('imperium', (html) => imperiumPage(html));
    if (lc === 'shipyard') {
      if (method === 'POST') {
        const units = {};
        for (const [k, v] of Object.entries(form)) { const m = /^fmenge\[(\d+)\]$/.exec(k); if (m && num(v) > 0) units[m[1]] = num(v); }
        if (Object.keys(units).length) W.order('shipyard', cur.id, { units });
      }
      const defense = mode === 'defense';
      return page(defense ? 'shipyard-defense' : 'shipyard-fleet', (html) => techPage(html, cur, 'shipyard'));
    }
    if (lc === 'messages' && mode === 'view') {
      const cat = num(param('messcat'), 100); const site = Math.max(1, num(param('site'), 1));
      ctx.rec.fixture = 'world messages ' + cat + '/' + site;
      return ctx.send(200, ctx.rewrite(messagesForm(cat, site)));
    }
    if (lc === 'messages' && method === 'POST') { messageAction(form); return ctx.redirect('page=messages&category=' + num(param('messcat'), 100) + '&side=' + num(param('side'), 1)); }
    if (lc === 'messages') { const cat = num(query.category !== undefined ? query.category : query.messcat, 100); return page(cat === 0 ? 'messages-spy' : 'messages-all', (html) => messagesPage(html, cat)); }
    if (lc === 'statistics') {
      ctx.rec.fixture = 'world statistics';
      return page('overview', (html) => { const a = html.indexOf('<div id="inhalt">'); if (a < 0) return html; const b = divEnd(html, a); return html.slice(0, a) + `<div id="inhalt"><div id="content">${statisticsContent(param('range'))}</div></div>` + html.slice(b); });
    }
    if (lc === 'raport') { const h = raportPage(String(param('raport') || '')); ctx.rec.fixture = 'world raport'; return h ? ctx.send(200, h) : info('The combat report was not found.'); }
    if (method === 'GET' || method === 'POST') {
      const f = require('./gz-server').fileFor(ctx.page, ctx.mode, query);
      if (f && H.pageFile(f) != null && lc !== 'trader' && !(lc === 'resources' && method === 'POST')) return page(f);
    }
    return undefined;
  };
}
