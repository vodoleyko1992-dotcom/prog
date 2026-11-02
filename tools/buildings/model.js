// Sample game state + OgameX formulas (PlanetService / ObjectService / GameObjectProduction).
'use strict';
const fs = require('fs');
const path = require('path');
const S = path.resolve(__dirname, '../../..'); // scratchpad root (ogx/tools/buildings -> ../../..)

const BASE = 'http://localhost'; // APP_URL default
const NOW = Date.UTC(2026, 9, 30, 1, 0, 0) / 1000; // 2026-10-30 01:00:00 UTC
const CSRF = 'Qm3c4p0tXgF9b2kLr8VwZy1sNuHdEj6aTo5iCxYe';

const SETTINGS = { economySpeed: 2, researchSpeed: 1, fleetSpeed: 2, basicIncome: { metal: 30, crystal: 15, deuterium: 0, energy: 0 } };

// ---- objects ------------------------------------------------------------
const CLASS_NAMES = {
  metal_mine: 'metalMine', crystal_mine: 'crystalMine', deuterium_synthesizer: 'deuteriumSynthesizer', solar_plant: 'solarPlant', fusion_plant: 'fusionPlant',
  metal_store: 'metalStorage', crystal_store: 'crystalStorage', deuterium_store: 'deuteriumStorage',
  small_cargo: 'transporterSmall', large_cargo: 'transporterLarge', colony_ship: 'colonyShip', recycler: 'recycler', espionage_probe: 'espionageProbe', solar_satellite: 'solarSatellite', crawler: 'resbuggy', pathfinder: 'explorer',
  rocket_launcher: 'rocketLauncher', light_laser: 'laserCannonLight', heavy_laser: 'laserCannonHeavy', gauss_cannon: 'gaussCannon', ion_cannon: 'ionCannon', plasma_turret: 'plasmaCannon', small_shield_dome: 'shieldDomeSmall', large_shield_dome: 'shieldDomeLarge', anti_ballistic_missile: 'missileInterceptor', interplanetary_missile: 'missileInterplanetary',
  light_fighter: 'fighterLight', heavy_fighter: 'fighterHeavy', cruiser: 'cruiser', battle_ship: 'battleship', battlecruiser: 'interceptor', bomber: 'bomber', destroyer: 'destroyer', deathstar: 'deathstar', reaper: 'reaper',
  energy_technology: 'energyTechnology', laser_technology: 'laserTechnology', ion_technology: 'ionTechnology', hyperspace_technology: 'hyperspaceTechnology', plasma_technology: 'plasmaTechnology', combustion_drive: 'combustionDriveTechnology', impulse_drive: 'impulseDriveTechnology', hyperspace_drive: 'hyperspaceDriveTechnology', espionage_technology: 'espionageTechnology', computer_technology: 'computerTechnology', astrophysics: 'astrophysicsTechnology', intergalactic_research_network: 'researchNetworkTechnology', graviton_technology: 'gravitonTechnology', weapon_technology: 'weaponsTechnology', shielding_technology: 'shieldingTechnology', armor_technology: 'armorTechnology',
  robot_factory: 'roboticsFactory', shipyard: 'shipyard', research_lab: 'researchLaboratory', alliance_depot: 'allianceDepot', missile_silo: 'missileSilo', nano_factory: 'naniteFactory', terraformer: 'terraformer', space_dock: 'repairDock', lunar_base: 'moonbase', sensor_phalanx: 'sensorPhalanx', jump_gate: 'jumpGate',
};
const TYPE_MAP = { BuildingObject: 'Building', StationObject: 'Station', ResearchObject: 'Research', ShipObject: 'Ship', DefenseObject: 'Defense' };
const IMG = { // assets->imgSmall / imgMicro exceptions (see app/GameObjects/*.php)
  nano_factory: 'nanite_factory', astrophysics: 'astrophysics_technology', weapon_technology: 'weapons_technology', battle_ship: 'battleship',
};

const OBJ = {};
for (const line of fs.readFileSync(path.join(S, 'ogx/specs/objects.jsonl'), 'utf8').trim().split('\n')) {
  const j = JSON.parse(line);
  const p = j.price.split(',').map((x) => x.trim());
  const o = {
    id: Number(j.id), machine_name: j.name, type: TYPE_MAP[j.type], class_name: CLASS_NAMES[j.name],
    price: { metal: +p[0], crystal: +p[1], deuterium: +p[2], energy: +p[3], factor: p[4] ? +p[4] : 1, round: p[5] === 'true' },
    req: j.req.map(([n, l]) => [n, +l]),
    props: j.props ? j.props.split(',').map((x) => +x.trim()) : null,
  };
  const imgBase = IMG[j.name] || j.name;
  o.imgSmall = imgBase + '_small.jpg';
  o.imgMicro = (['light_fighter', 'heavy_fighter', 'cruiser', 'battle_ship', 'battlecruiser', 'bomber', 'destroyer', 'deathstar'].includes(j.name) ? imgBase + '_small.jpg' : imgBase + '_micro.jpg');
  o.consumesPlanetField = j.name !== 'space_dock';
  OBJ[j.name] = o;
}
const byId = (id) => Object.values(OBJ).find((o) => o.id === Number(id));

// ---- state ------------------------------------------------------------------
const player = {
  id: 1, username: 'Commander Orion', class: 'collector', className: 'Collector', darkMatter: 8000, highscoreRank: 3,
  officers: { commanding_staff: false, engineer: false, geologist: false },
  research: {
    energy_technology: 12, laser_technology: 12, ion_technology: 5, hyperspace_technology: 8, plasma_technology: 7,
    combustion_drive: 10, impulse_drive: 7, hyperspace_drive: 6, espionage_technology: 10, computer_technology: 12,
    astrophysics: 9, intergalactic_research_network: 2, graviton_technology: 0,
    weapon_technology: 12, shielding_technology: 11, armor_technology: 12,
  },
};

const ZERO_UNITS = {};
for (const o of Object.values(OBJ)) if (o.type === 'Ship' || o.type === 'Defense') ZERO_UNITS[o.machine_name] = 0;
const ZERO_BLD = {};
for (const o of Object.values(OBJ)) if (o.type === 'Building' || o.type === 'Station') ZERO_BLD[o.machine_name] = 0;

const planets = [
  {
    id: 4, name: 'Homeworld', type: 'planet', g: 1, s: 102, p: 8, diameter: 12800, field_max: 163, temp_min: 23, temp_max: 63,
    metal: 1234567.4583333, crystal: 512345.81944444, deuterium: 245678.12638889,
    levels: Object.assign({}, ZERO_BLD, {
      metal_mine: 22, crystal_mine: 19, deuterium_synthesizer: 15, solar_plant: 24, fusion_plant: 8,
      metal_store: 8, crystal_store: 7, deuterium_store: 6,
      robot_factory: 10, shipyard: 8, research_lab: 10, alliance_depot: 2, missile_silo: 2, nano_factory: 1, terraformer: 0, space_dock: 1,
    }),
    units: Object.assign({}, ZERO_UNITS, {
      small_cargo: 25, large_cargo: 120, light_fighter: 300, cruiser: 45, battle_ship: 60, battlecruiser: 20, destroyer: 5,
      colony_ship: 1, recycler: 40, espionage_probe: 80, crawler: 20,
      rocket_launcher: 400, light_laser: 300, heavy_laser: 60, gauss_cannon: 20, ion_cannon: 10, plasma_turret: 2,
      small_shield_dome: 1, large_shield_dome: 1, anti_ballistic_missile: 10,
    }),
    percent: { metal_mine: 10, crystal_mine: 10, deuterium_synthesizer: 10, solar_plant: 10, fusion_plant: 10, solar_satellite: 10, crawler: 10 },
    // building queue: currently building metal mine 22 -> 23, queued crystal mine 19 -> 20
    buildQueue: [
      { id: 1287, object: 'metal_mine', level_target: 23, time_start: NOW - 4380, active: true },
      { id: 1288, object: 'crystal_mine', level_target: 20, active: false },
    ],
    researchQueue: [{ id: 342, object: 'plasma_technology', level_target: 8, time_start: NOW - 9000, active: true }],
    unitQueue: [
      { id: 5521, object: 'large_cargo', amount: 50, time_start: NOW - 1650, active: true },
      { id: 5522, object: 'light_fighter', amount: 100, active: false },
    ],
    moonId: 9,
  },
  {
    id: 7, name: 'Colony', type: 'planet', g: 1, s: 105, p: 4, diameter: 10800, field_max: 141, temp_min: 71, temp_max: 111,
    metal: 312045.5, crystal: 98210.25, deuterium: 35400.75,
    levels: Object.assign({}, ZERO_BLD, {
      metal_mine: 18, crystal_mine: 16, deuterium_synthesizer: 10, solar_plant: 19, fusion_plant: 0,
      metal_store: 5, crystal_store: 4, deuterium_store: 3, robot_factory: 6, shipyard: 4, research_lab: 1,
    }),
    units: Object.assign({}, ZERO_UNITS, { small_cargo: 10, large_cargo: 15, espionage_probe: 5, rocket_launcher: 50, light_laser: 20 }),
    percent: { metal_mine: 10, crystal_mine: 10, deuterium_synthesizer: 10, solar_plant: 10, fusion_plant: 10, solar_satellite: 10, crawler: 10 },
    buildQueue: [], researchQueue: [], unitQueue: [],
  },
  {
    id: 9, name: 'Moon', type: 'moon', g: 1, s: 102, p: 8, diameter: 8366, field_max: 1, temp_min: 23, temp_max: 63,
    metal: 50120, crystal: 32010, deuterium: 120500,
    levels: Object.assign({}, ZERO_BLD, { robot_factory: 2, shipyard: 1, lunar_base: 3, sensor_phalanx: 2, jump_gate: 1 }),
    units: Object.assign({}, ZERO_UNITS, { large_cargo: 50, espionage_probe: 10 }),
    percent: {},
    buildQueue: [], researchQueue: [], unitQueue: [],
    parentId: 4,
  },
];
const P = (id) => planets.find((p) => p.id === id);

// ---- formulas -------------------------------------------------------------
const coordStr = (pl) => `${pl.g}:${pl.s}:${pl.p}`;
function biome(pl) {
  const map = { 1: ['dry', 'desert'], 2: ['dry', 'desert'], 3: ['dry', 'desert'], 4: ['normal', 'dry'], 5: ['normal', 'dry'], 6: ['jungle', 'normal'], 7: ['jungle', 'normal'], 8: ['water', 'jungle'], 9: ['water', 'jungle'], 10: ['ice', 'water'], 11: ['ice', 'water'], 12: ['gas', 'ice'], 13: ['gas', 'ice'], 14: ['normal', 'gas'], 15: ['normal', 'gas'] };
  return map[pl.p][pl.s % 2 === 0 ? 1 : 0];
}
function imageType(pl) {
  const map = { 1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 8, 7: 9, 8: 10, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 6, 15: 7 };
  let mod = (pl.s % 10) - 1; if (mod === -1) mod = 9;
  let t = map[pl.p] + mod; if (t > 10) t -= 10;
  if (pl.type === 'moon' && t > 5) t -= 5;
  return String(t);
}
const tempAvg = (pl) => Math.round((pl.temp_min + pl.temp_max) / 2);
function fieldMax(pl) {
  let x = 0;
  if (pl.levels.terraformer) x += pl.levels.terraformer * 5 + Math.floor(pl.levels.terraformer / 2);
  if (pl.levels.lunar_base) x += pl.levels.lunar_base * 3;
  return x + pl.field_max;
}
function buildingCount(pl) {
  let c = 0;
  for (const o of Object.values(OBJ)) if ((o.type === 'Building' || o.type === 'Station') && o.consumesPlanetField) c += pl.levels[o.machine_name] || 0;
  return c;
}
function rawPrice(mn, level) {
  const o = OBJ[mn];
  if (o.type === 'Building' || o.type === 'Station' || o.type === 'Research') {
    if (level === 0) return { metal: 0, crystal: 0, deuterium: 0, energy: 0 };
    const f = Math.pow(o.price.factor, level - 1);
    let r = { metal: Math.floor(o.price.metal * f), crystal: Math.floor(o.price.crystal * f), deuterium: Math.floor(o.price.deuterium * f), energy: Math.floor(o.price.energy * f) };
    if (o.price.round) for (const k of ['metal', 'crystal', 'deuterium', 'energy']) r[k] = Math.round(r[k] / 100) * 100;
    return r;
  }
  return { metal: o.price.metal, crystal: o.price.crystal, deuterium: o.price.deuterium, energy: o.price.energy };
}
const curLevel = (pl, mn) => (OBJ[mn].type === 'Research' ? player.research[mn] : OBJ[mn].type === 'Ship' || OBJ[mn].type === 'Defense' ? pl.units[mn] : pl.levels[mn]);
const price = (pl, mn) => (OBJ[mn].type === 'Ship' || OBJ[mn].type === 'Defense' ? rawPrice(mn) : rawPrice(mn, curLevel(pl, mn) + 1));

function buildingTime(pl, mn, level /* target level */) {
  const pr = rawPrice(mn, level);
  const sp = SETTINGS.economySpeed;
  let h;
  if (mn === 'nano_factory') h = (pr.metal + pr.crystal) / (2500 * (1 + pl.levels.robot_factory) * sp * 2 ** pl.levels.nano_factory);
  else h = (pr.metal + pr.crystal) / (2500 * Math.max(4 - level / 2, 1) * (1 + pl.levels.robot_factory) * sp * 2 ** pl.levels.nano_factory);
  return Math.max(1, Math.trunc(h * 3600));
}
function downgradeTime(pl, mn) { return buildingTime(pl, mn, pl.levels[mn]); }
function unitTime(pl, mn) {
  const si = OBJ[mn].props[0];
  const h = si / (2500 * (1 + pl.levels.shipyard) * SETTINGS.economySpeed * 2 ** pl.levels.nano_factory);
  return Math.max(1, Math.trunc(h * 3600));
}
function researchTime(pl, mn) {
  const pr = price(pl, mn);
  // IRN level 2: combine the 3 best labs (only Homeworld lab 10 + Colony lab 1 here)
  const lab = pl.levels.research_lab + (pl.id === 4 ? 1 : 10);
  let s = Math.trunc(((pr.metal + pr.crystal) / (1000 * (1 + lab) * SETTINGS.economySpeed * SETTINGS.researchSpeed)) * 3600);
  return Math.max(1, s); // Collector: no research multiplier
}

function storage(level) { return 5000 * Math.floor(2.5 * Math.exp((20 * level) / 33)); }

// Production per object (ProductionIndex), mirrors GameObjectProduction::calculate
const POS_BONUS = { 1: [1, 1.4, 1], 2: [1, 1.3, 1], 3: [1, 1.2, 1], 6: [1.17, 1, 1], 7: [1.23, 1, 1], 8: [1.35, 1, 1], 9: [1.23, 1, 1], 10: [1.17, 1, 1] };
function productionIndex(pl, mn, level, pct /* 0..1 incl. factor */) {
  const z = () => ({ metal: 0, crystal: 0, deuterium: 0, energy: 0 });
  const idx = { mine: z(), planet_slot: z(), plasma_technology: z(), engineer: z(), geologist: z(), character_class: z(), crawler: z(), commanding_staff: z(), items: z(), total: z() };
  const sp = SETTINGS.economySpeed;
  const L = level;
  const f = {
    metal_mine: { metal: 30 * L * 1.1 ** L, energy: -10 * L * 1.1 ** L },
    crystal_mine: { crystal: 20 * L * 1.1 ** L, energy: -10 * L * 1.1 ** L },
    deuterium_synthesizer: { deuterium: 10 * L * 1.1 ** L * (1.44 - 0.004 * tempAvg(pl)), energy: -20 * L * 1.1 ** L },
    solar_plant: { energy: 20 * L * 1.1 ** L },
    fusion_plant: { deuterium: -10 * L * 1.1 ** L, energy: 30 * L * (1.05 + player.research.energy_technology * 0.01) ** L },
    solar_satellite: { energy: Math.floor((pl.temp_max + 140) / 6) * L },
  }[mn];
  for (const r of ['metal', 'crystal', 'deuterium']) if (f[r] !== undefined) idx.mine[r] = f[r] * pct * sp;
  if (f.energy !== undefined) idx.mine.energy = f.energy * pct;
  const b = POS_BONUS[pl.p] || [1, 1, 1];
  idx.planet_slot.metal = Math.floor(idx.mine.metal * (b[0] - 1));
  idx.planet_slot.crystal = Math.floor(idx.mine.crystal * (b[1] - 1));
  idx.planet_slot.deuterium = Math.floor(idx.mine.deuterium * (b[2] - 1));
  const pt = player.research.plasma_technology;
  if (f.metal && idx.mine.metal > 0) idx.plasma_technology.metal = Math.floor((idx.mine.metal + idx.planet_slot.metal) * 0.01 * pt);
  if (f.crystal && idx.mine.crystal > 0) idx.plasma_technology.crystal = Math.floor((idx.mine.crystal + idx.planet_slot.crystal) * 0.0066 * pt);
  if (f.deuterium && idx.mine.deuterium > 0) idx.plasma_technology.deuterium = Math.floor((idx.mine.deuterium + idx.planet_slot.deuterium) * 0.0033 * pt);
  if (player.class === 'collector') {
    for (const r of ['metal', 'crystal', 'deuterium']) if (idx.mine[r] > 0) idx.character_class[r] = Math.floor((idx.mine[r] + idx.planet_slot[r]) * 0.25);
    if (idx.mine.energy > 0) idx.character_class.energy = Math.floor(idx.mine.energy * 0.1);
  }
  const crawlers = pl.units.crawler || 0;
  if (crawlers > 0) {
    const maxC = (pl.levels.metal_mine + pl.levels.crystal_mine + pl.levels.deuterium_synthesizer) * 8;
    const eff = Math.min(crawlers, maxC);
    let bonus = eff * 0.0002 * ((pl.percent.crawler ?? 10) / 10);
    if (player.class === 'collector') bonus *= 1.5;
    for (const r of ['metal', 'crystal', 'deuterium']) if (idx.mine[r] > 0) idx.crawler[r] = Math.floor((idx.mine[r] + idx.planet_slot[r]) * bonus);
  }
  for (const k of Object.keys(idx)) if (k !== 'total') for (const r of ['metal', 'crystal', 'deuterium', 'energy']) idx.total[r] += idx[k][r];
  return idx;
}
const PROD_OBJECTS = ['metal_mine', 'crystal_mine', 'deuterium_synthesizer', 'solar_plant', 'fusion_plant', 'solar_satellite'];
const levelOf = (pl, mn) => (mn === 'solar_satellite' ? pl.units.solar_satellite : pl.levels[mn]);
function objectProduction(pl, mn, level, forceFactor) {
  const factor = forceFactor ? 1 : productionFactor(pl) / 100;
  const pct = ((pl.percent[mn] ?? 10) / 10) * factor;
  const t = productionIndex(pl, mn, level ?? levelOf(pl, mn), pct).total;
  return { metal: Math.ceil(t.metal), crystal: Math.ceil(t.crystal), deuterium: Math.ceil(t.deuterium), energy: Math.floor(t.energy) };
}
function crawlerEnergy(pl) {
  const c = pl.units.crawler || 0; if (!c) return 0;
  const maxC = (pl.levels.metal_mine + pl.levels.crystal_mine + pl.levels.deuterium_synthesizer) * 8;
  const eff = Math.min(c, maxC);
  const pc = (pl.percent.crawler ?? 10) / 10;
  let e = 50 * pc; if (pc > 1) e += 50 * (pc - 1);
  return -Math.floor(eff * e);
}
function energyStats(pl) {
  let prod = 0, cons = 0;
  if (pl.type === 'moon') return { prod: 0, cons: 0 };
  for (const mn of PROD_OBJECTS) {
    const p = objectProduction(pl, mn, null, true);
    if (p.energy > 0) prod += p.energy; else cons += Math.abs(p.energy);
  }
  cons += Math.abs(crawlerEnergy(pl));
  return { prod, cons };
}
function productionFactor(pl) {
  const { prod, cons } = energyStats(pl);
  if (!cons) return 100; if (!prod) return 0;
  return Math.max(0, Math.min(100, Math.floor((prod / cons) * 100)));
}
function basicIncome(pl) {
  if (pl.type === 'moon') return { metal: 0, crystal: 0, deuterium: 0, energy: 0 };
  const b = POS_BONUS[pl.p] || [1, 1, 1];
  const sp = SETTINGS.economySpeed;
  return { metal: 30 * sp * b[0], crystal: 15 * sp * b[1], deuterium: 0, energy: 0 };
}
function hourly(pl) {
  if (pl.type === 'moon') return { metal: 0, crystal: 0, deuterium: 0 };
  const bi = basicIncome(pl);
  const tot = { metal: 0, crystal: 0, deuterium: 0 };
  for (const mn of PROD_OBJECTS) { const p = objectProduction(pl, mn, null, true); tot.metal += p.metal; tot.crystal += p.crystal; tot.deuterium += p.deuterium; }
  const f = productionFactor(pl) / 100;
  return { metal: Math.ceil(bi.metal + tot.metal * f), crystal: Math.ceil(bi.crystal + tot.crystal * f), deuterium: Math.ceil(bi.deuterium + tot.deuterium * f) };
}

function reqMet(pl, mn) {
  for (const [n, l] of OBJ[mn].req) {
    const lv = OBJ[n].type === 'Research' ? player.research[n] : pl.levels[n];
    if ((lv || 0) < l) return false;
  }
  return true;
}
function classMet(mn) {
  if (mn === 'reaper') return player.class === 'general';
  if (mn === 'pathfinder') return player.class === 'discoverer';
  if (mn === 'crawler') return player.class === 'collector';
  return true;
}
const MOON_ONLY = ['lunar_base', 'sensor_phalanx', 'jump_gate'];
const PLANET_ONLY = ['metal_mine', 'crystal_mine', 'deuterium_synthesizer', 'solar_plant', 'fusion_plant', 'research_lab', 'alliance_depot', 'nano_factory', 'terraformer', 'space_dock', 'crawler'];
function validPlanetType(pl, mn) {
  if (MOON_ONLY.includes(mn)) return pl.type === 'moon';
  if (PLANET_ONLY.includes(mn)) return pl.type === 'planet';
  return true;
}
function energyNow(pl) { const s = energyStats(pl); return s.prod - s.cons; }
function hasResources(pl, pr, useProductionEnergy) {
  const en = useProductionEnergy ? energyStats(pl).prod : energyNow(pl);
  return pl.metal >= pr.metal && pl.crystal >= pr.crystal && pl.deuterium >= pr.deuterium && en >= pr.energy;
}
function maxBuildAmount(pl, mn, rm) {
  if (!rm) return 0;
  if (mn === 'small_shield_dome' || mn === 'large_shield_dome') return pl.units[mn] ? 0 : 1;
  const pr = price(pl, mn);
  const arr = [];
  if (pr.metal > 0) arr.push(Math.floor(pl.metal / pr.metal));
  if (pr.crystal > 0) arr.push(Math.floor(pl.crystal / pr.crystal));
  if (pr.deuterium > 0) arr.push(Math.floor(pl.deuterium / pr.deuterium));
  if (pr.energy > 0) arr.push(Math.floor((['terraformer', 'space_dock'].includes(mn) ? energyStats(pl).prod : energyNow(pl)) / pr.energy));
  if (mn === 'interplanetary_missile' || mn === 'anti_ballistic_missile') {
    const cap = pl.levels.missile_silo * 10 - (pl.units.interplanetary_missile * 2 + pl.units.anti_ballistic_missile);
    const m = mn === 'interplanetary_missile' ? Math.floor(cap / 2) : cap;
    if (m <= 0) return 0; arr.push(m);
  }
  return arr.length ? Math.min(...arr) : 0;
}

// Queue view models
function buildingQueueVM(pl) {
  let t = NOW;
  const out = [];
  for (const q of pl.buildQueue) {
    const dur = buildingTime(pl, q.object, q.level_target);
    if (q.active) {
      const time_end = q.time_start + dur;
      out.push({ ...q, obj: OBJ[q.object], time_total: dur, time_end, time_countdown: Math.max(0, time_end - NOW), dm_halved: false });
    } else out.push({ ...q, obj: OBJ[q.object], time_total: dur });
  }
  return { active: out.find((x) => x.active) || null, queue: out.filter((x) => !x.active) };
}
function researchQueueVM(pl) {
  const out = [];
  for (const q of pl.researchQueue) {
    const dur = researchTime(pl, q.object);
    const time_end = q.time_start + dur;
    out.push({ ...q, obj: OBJ[q.object], planet: pl, time_total: dur, time_end, time_countdown: Math.max(0, time_end - NOW) });
  }
  return { active: out.find((x) => x.active) || null, queue: out.filter((x) => !x.active) };
}
function unitQueueVM(pl) {
  const out = [];
  let lastEnd = NOW;
  for (const q of pl.unitQueue) {
    const per = unitTime(pl, q.object);
    if (q.active) {
      const time_end = q.time_start + per * q.amount;
      const elapsed = NOW - q.time_start;
      const done = Math.floor(elapsed / per);
      const remaining = q.amount - done;
      const nextSingle = per - (elapsed - done * per);
      out.push({ ...q, obj: OBJ[q.object], time_total: per * q.amount, time_end, time_countdown: time_end - NOW, object_amount_remaining: remaining, time_countdown_object_next: nextSingle, time_countdown_per_object: per, dm_halved: false });
      lastEnd = time_end;
    } else {
      const time_end = lastEnd + per * q.amount;
      out.push({ ...q, obj: OBJ[q.object], time_total: per * q.amount, time_start: lastEnd, time_end });
      lastEnd = time_end;
    }
  }
  return { active: out.find((x) => x.active) || null, queue: out.filter((x) => !x.active), queueEnd: out.length ? lastEnd : 0 };
}
function halvingCost(sec, type) {
  const c = Math.max(750, Math.ceil(((sec / 60) / 30) * 750));
  return Math.min(c, type === 'research' ? 108000 : 72000);
}

module.exports = {
  BASE, NOW, CSRF, SETTINGS, OBJ, byId, player, planets, P, coordStr, biome, imageType, tempAvg, fieldMax, buildingCount,
  rawPrice, price, curLevel, buildingTime, downgradeTime, unitTime, researchTime, storage, productionIndex, objectProduction,
  crawlerEnergy, energyStats, productionFactor, basicIncome, hourly, reqMet, classMet, validPlanetType, energyNow, hasResources,
  maxBuildAmount, buildingQueueVM, researchQueueVM, unitQueueVM, halvingCost, PROD_OBJECTS, levelOf,
};
