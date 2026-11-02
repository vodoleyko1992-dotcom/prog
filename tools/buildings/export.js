// Computes all controller/view-model values for the buildings fixtures (sample universe in model.js)
// and writes them as JSON for gen_buildings_fixtures.php, which renders the REAL Blade templates.
// Usage: node export.js > viewdata.json
'use strict';
const M = require('./model');
const { OBJ, P, NOW, player } = M;

const R = (r) => ({ __res: [r.metal || 0, r.crystal || 0, r.deuterium || 0, r.energy || 0] });
const O = (mn) => ({ __obj: mn });
const PL = (id) => ({ __planet: id });

function planetData(pl) {
  const es = M.energyStats(pl);
  return {
    id: pl.id, name: pl.name, coords: [pl.g, pl.s, pl.p], diameter: pl.diameter,
    fields_used: M.buildingCount(pl), fields_max: M.fieldMax(pl), temp: [pl.temp_min, pl.temp_max],
    moon: pl.type === 'moon', building: pl.buildQueue.some((q) => q.active), downgrading: false,
    levels: pl.levels, units: pl.units,
    res: { metal: pl.metal, crystal: pl.crystal, deuterium: pl.deuterium },
    prod: M.hourly(pl),
    storage: { metal: M.storage(pl.levels.metal_store), crystal: M.storage(pl.levels.crystal_store), deuterium: M.storage(pl.levels.deuterium_store) },
    energy: { max: es.prod, used: es.cons },
    moonId: pl.moonId || null, parentId: pl.parentId || null,
  };
}

// ---- queue view models (app/ViewModels/Queue/*)
function bqVM(pl) {
  const v = M.buildingQueueVM(pl);
  const m = (q) => q && { id: q.id, object: O(q.object), level_target: q.level_target, is_downgrade: false, time_countdown: q.time_countdown ?? 0, time_total: q.time_total, dm_halved: false, planet: PL(pl.id) };
  return { active: m(v.active), queue: v.queue.map(m), raw: v };
}
function rqVM() {
  const rp = M.planets.find((p) => p.researchQueue.length);
  if (!rp) return { active: null, queue: [], raw: { active: null, queue: [] } };
  const v = M.researchQueueVM(rp);
  const m = (q) => q && { id: q.id, object: O(q.object), level_target: q.level_target, time_countdown: q.time_countdown ?? 0, time_total: q.time_total, planet: PL(rp.id) };
  return { active: m(v.active), queue: v.queue.map(m), raw: v };
}
function uqVM(pl) {
  const v = M.unitQueueVM(pl);
  const m = (q) => q && { id: q.id, object: O(q.object), object_amount: q.amount, object_amount_remaining: q.object_amount_remaining ?? q.amount, time_countdown: q.time_countdown ?? 0, time_total: q.time_total, time_countdown_object_next: q.time_countdown_object_next ?? 0, time_countdown_per_object: q.time_countdown_per_object ?? M.unitTime(pl, q.object), dm_halved: false };
  return { active: m(v.active), queue: v.queue.map(m), countdown: v.queueEnd ? v.queueEnd - NOW : 0, raw: v };
}

// ---- AbstractBuildingsController::indexPageParams (lines 59-217)
function buildingsIndex(pl, names, headerIds) {
  const bq = bqVM(pl);
  const researching = M.planets.some((p) => p.researchQueue.length > 0); // PlayerService::isResearching (player-wide)
  const shipBusy = pl.unitQueue.length > 0; // PlayerService::isBuildingShipsOrDefense (current planet)
  const all = [bq.raw.active, ...bq.raw.queue].filter(Boolean);
  let ch = 0; for (const q of all) if (OBJ[q.object].consumesPlanetField) ch += q.level_target - pl.levels[q.object];
  const projected = M.buildingCount(pl) + ch, maxF = M.fieldMax(pl);
  const rows = names.map((mn, i) => {
    const o = OBJ[mn];
    const isBld = o.type === 'Building' || o.type === 'Station';
    const cur = isBld ? pl.levels[mn] : pl.units[mn];
    const active = bq.raw.active && bq.raw.active.object === mn;
    return {
      count: i + 1, object: O(mn), current_level: cur, requirements_met: M.reqMet(pl, mn), character_class_met: M.classMet(mn),
      valid_planet_type: M.validPlanetType(pl, mn), enough_resources: M.hasResources(pl, M.price(pl, mn), ['terraformer', 'space_dock'].includes(mn)),
      currently_building: !!active, target_level: active ? bq.raw.active.level_target : null, is_downgrade: false,
      research_in_progress: researching, ship_or_defense_in_progress: shipBusy,
      uses_last_field: isBld && o.consumesPlanetField ? projected + 1 >= maxF : false,
      fields_exceeded: isBld && o.consumesPlanetField ? projected >= maxF : false,
    };
  });
  let header = pl.type === 'planet' ? M.biome(pl) : 'moon_' + M.imageType(pl);
  for (const id of headerIds) { const o = M.byId(id); const lv = o.type === 'Ship' ? pl.units[o.machine_name] : pl.levels[o.machine_name]; if (lv >= 1) header += '_' + id; }
  return {
    planet_id: pl.id, planet_name: pl.name, planet: PL(pl.id), header_filename: header, buildings: [rows],
    build_active: bq.active, build_queue: bq.queue, build_queue_max: bq.queue.length >= 4, open_tech_id: 0,
    jump_gate_level: pl.type === 'moon' ? pl.levels.jump_gate : 0, is_in_vacation_mode: false,
  };
}

// ---- AbstractUnitsController::indexPage (lines 51-125)
function unitsIndex(pl, rowsNames) {
  const uq = uqVM(pl);
  const units = rowsNames.map((names) => names.map((mn, i) => {
    const rm = M.reqMet(pl, mn), cm = M.classMet(mn);
    const active = uq.raw.active && uq.raw.active.object === mn;
    return {
      __unitvm: true, object: O(mn), count: i + 1, amount: pl.units[mn], requirements_met: rm, character_class_met: cm,
      enough_resources: M.hasResources(pl, M.price(pl, mn)), max_build_amount: M.maxBuildAmount(pl, mn, rm && cm),
      currently_building: !!active, currently_building_amount: active ? uq.raw.active.object_amount_remaining : 0,
    };
  }));
  return {
    planet_id: pl.id, planet_name: pl.name, units, build_active: uq.active, build_queue: uq.queue, build_queue_countdown: uq.countdown,
    open_tech_id: 0, is_in_vacation_mode: false,
    shipyard_upgrading: pl.buildQueue.some((q) => q.active && q.object === 'shipyard'),
    nanite_upgrading: pl.buildQueue.some((q) => q.active && q.object === 'nano_factory'),
  };
}

// ---- ResearchController::index (lines 47-137)
function researchIndex(pl) {
  const rows = [
    ['energy_technology', 'laser_technology', 'ion_technology', 'hyperspace_technology', 'plasma_technology'],
    ['combustion_drive', 'impulse_drive', 'hyperspace_drive'],
    ['espionage_technology', 'computer_technology', 'astrophysics', 'intergalactic_research_network', 'graviton_technology'],
    ['weapon_technology', 'shielding_technology', 'armor_technology'],
  ];
  const rq = rqVM();
  const labUpg = M.planets.some((p) => p.buildQueue.some((q) => q.active && q.object === 'research_lab'));
  const bonus = player.class === 'general' ? 2 : 0;
  let count = 0;
  return {
    planet_id: pl.id, planet_name: pl.name,
    research: rows.map((names) => names.map((mn) => ({
      object: O(mn), current_level: player.research[mn], requirements_met: M.reqMet(pl, mn), count: ++count,
      enough_resources: M.hasResources(pl, M.price(pl, mn)),
      currently_building: !!(rq.raw.active && rq.raw.active.object === mn), research_lab_upgrading: labUpg,
      bonus_level: ['weapon_technology', 'shielding_technology', 'armor_technology'].includes(mn) ? bonus : 0,
    }))),
    build_active: rq.active, build_queue: rq.queue,
    build_queue_max: (rq.raw.active ? 1 : 0) + rq.raw.queue.length >= 5,
    research_lab_upgrading: labUpg, open_tech_id: 0,
  };
}

// ---- ResourcesController::settings (lines 107-226)
function settingsVars(pl) {
  const factor = M.productionFactor(pl);
  const z = () => ({ metal: 0, crystal: 0, deuterium: 0, energy: 0 });
  const tot = { basic: z(), mine: z(), plasma_technology: z(), planet_slot: z(), engineer: z(), geologist: z(), character_class: z(), crawler: z(), commanding_staff: z(), items: z(), total: z() };
  const resRows = [], enRows = [];
  for (const mn of M.PROD_OBJECTS) {
    const o = OBJ[mn];
    const level = M.levelOf(pl, mn);
    const idx = M.productionIndex(pl, mn, level, ((pl.percent[mn] ?? 10) / 10) * (factor / 100));
    for (const k of Object.keys(idx)) if (k !== 'total') for (const r of Object.keys(tot.total)) tot[k][r] += idx[k][r];
    const pw = z();
    for (const k of ['mine', 'plasma_technology', 'planet_slot', 'engineer', 'geologist', 'commanding_staff', 'items']) for (const r of Object.keys(pw)) pw[r] += idx[k][r];
    pw.metal = Math.ceil(pw.metal); pw.crystal = Math.ceil(pw.crystal); pw.deuterium = Math.ceil(pw.deuterium); pw.energy = Math.floor(pw.energy);
    const base = { id: o.id, title: { __title: mn }, level, production: R(pw), percentage: pl.percent[mn] ?? 10 };
    if (pw.energy < 0) resRows.push({ ...base, actual_energy_use: Math.floor(pw.energy * (factor / 100)) });
    else enRows.push({ ...base, type: { __enum: o.type } });
  }
  tot.crawler.energy = M.crawlerEnergy(pl);
  const h = M.hourly(pl); const es = M.energyStats(pl);
  // ProductionIndex::total = basic income + sum of all building totals; metal/crystal/deut overwritten by cached planet production
  const bi = M.basicIncome(pl);
  tot.total.metal = h.metal; tot.total.crystal = h.crystal; tot.total.deuterium = h.deuterium; tot.total.energy += bi.energy;
  const pi = {}; for (const k of Object.keys(tot)) pi[k] = R(tot[k]);
  return {
    currentPlayer: { __player: true }, basic_income: R(bi), planet_name: pl.name,
    building_resource_rows: resRows, building_energy_rows: enRows, production_total: { __pi: pi }, production_factor: factor,
    metal: pl.metal, metal_storage: M.storage(pl.levels.metal_store), metal_storage_formatted: { __fmtLong: M.storage(pl.levels.metal_store) },
    crystal: pl.crystal, crystal_storage: M.storage(pl.levels.crystal_store), crystal_storage_formatted: { __fmtLong: M.storage(pl.levels.crystal_store) },
    deuterium: pl.deuterium, deuterium_storage: M.storage(pl.levels.deuterium_store), deuterium_storage_formatted: { __fmtLong: M.storage(pl.levels.deuterium_store) },
    plasma_technology_level: player.research.plasma_technology, crawler_count: pl.units.crawler,
    max_crawlers: (pl.levels.metal_mine + pl.levels.crystal_mine + pl.levels.deuterium_synthesizer) * 8,
    crawler_percentage: pl.percent.crawler ?? 10, max_crawler_overload: player.class === 'collector' ? 150 : 100,
    officers: player.officers,
  };
}

// ---- OverviewController::index (lines 32-143)
function overviewVars(pl) {
  const bq = bqVM(pl), rq = rqVM(), uq = uqVM(pl);
  const other = pl.type === 'planet' && pl.moonId ? pl.moonId : pl.type === 'moon' ? pl.parentId : null;
  return {
    header_filename: pl.type === 'moon' ? 'moon/' + M.imageType(pl) : M.biome(pl),
    planet_name: pl.name, planet_diameter: pl.diameter, planet_temp_min: pl.temp_min, planet_temp_max: pl.temp_max,
    planet_coordinates: M.coordStr(pl), planet_galaxy: pl.g, planet_system: pl.s, planet_position: pl.p,
    user_points: '1,284,551', user_rank: player.highscoreRank, max_rank: 57, user_honor_points: 0,
    build_active: bq.active, building_count: M.buildingCount(pl), max_building_count: M.fieldMax(pl), build_queue: bq.queue,
    research_active: rq.active, research_queue: rq.queue, ship_active: uq.active, ship_queue: uq.queue, ship_queue_time_countdown: uq.countdown,
    has_moon: pl.type === 'planet' && !!pl.moonId, has_planet: pl.type === 'moon', other_planet: other ? PL(other) : null,
    wreck_field: null, show_wreck_field_icon: false, planet_move: null, planet_move_countdown: 0, planet_move_target: '', planet_move_blockers: [], planet_move_cooldown: 0,
  };
}

// ---- ObjectAjaxTrait::ajaxHandler (lines 25-335)
function canDowngrade(pl, mn) {
  const o = OBJ[mn];
  if (!(o.type === 'Building' || o.type === 'Station')) return false;
  const cur = pl.levels[mn];
  if (cur <= 0 || mn === 'terraformer') return false;
  if (mn === 'missile_silo' && (pl.units.interplanetary_missile > 0 || pl.units.anti_ballistic_missile > 0)) return false;
  for (const c of Object.values(OBJ)) {
    if (!['Building', 'Station', 'Research'].includes(c.type) || c.machine_name === mn) continue;
    for (const [n, l] of c.req) if (n === mn && l >= cur) {
      const lv = c.type === 'Research' ? player.research[c.machine_name] : pl.levels[c.machine_name];
      if (lv >= l) return false;
    }
  }
  return true;
}
function ajaxVars(pl, mn, endpointQueue) {
  const o = OBJ[mn];
  const isUnit = o.type === 'Ship' || o.type === 'Defense';
  const isBld = o.type === 'Building' || o.type === 'Station';
  const cur = M.curLevel(pl, mn), next = cur + 1;
  const rm = M.reqMet(pl, mn);
  const pr = M.price(pl, mn);
  const t = isBld ? M.buildingTime(pl, mn, next) : isUnit ? M.unitTime(pl, mn) : M.researchTime(pl, mn);
  let prodNext = [], energyDiff = 0;
  if (M.PROD_OBJECTS.includes(mn)) {
    const pc = M.objectProduction(pl, mn, M.levelOf(pl, mn) || null);
    const pn = M.objectProduction(pl, mn, next);
    prodNext = R(pn); energyDiff = (pn.energy - pc.energy) * -1;
  } else if (mn === 'crawler') {
    const pc = (pl.percent.crawler ?? 10) / 10; let en = 50 * pc; if (pc > 1) en += 50 * (pc - 1); energyDiff = Math.floor(en);
  }
  const storageKey = { metal_store: 'metal', crystal_store: 'crystal', deuterium_store: 'deuterium' }[mn];
  let items, active;
  if (endpointQueue === 'building') { const v = M.buildingQueueVM(pl); active = v.active; items = [v.active, ...v.queue].filter(Boolean); }
  else if (endpointQueue === 'research') { const rp = M.planets.find((p) => p.researchQueue.length) || pl; const v = M.researchQueueVM(rp); active = v.active; items = [v.active, ...v.queue].filter(Boolean); }
  else { const v = M.unitQueueVM(pl); active = v.active; items = [v.active, ...v.queue].filter(Boolean); }
  let fieldsExceeded = false;
  if (isBld && o.consumesPlanetField) {
    let ch = 0; for (const it of items) if (it.level_target !== undefined && OBJ[it.object].consumesPlanetField) ch += it.level_target - pl.levels[it.object];
    fieldsExceeded = M.buildingCount(pl) + ch >= M.fieldMax(pl);
  }
  let dg = null, dgDur = null, dgDurF = null, ion = 0, ionB = 0, canDg = false;
  if (isBld && cur > 0) {
    let maxT = cur;
    if (endpointQueue === 'building') for (const it of items) if (it.object === mn && it.level_target > maxT) maxT = it.level_target;
    const raw = M.rawPrice(mn, maxT);
    ion = player.research.ion_technology; ionB = ion * 4;
    const f = 1 - ion * 0.04;
    dg = R({ metal: Math.max(0, Math.floor(raw.metal * f)), crystal: Math.max(0, Math.floor(raw.crystal * f)), deuterium: Math.max(0, Math.floor(raw.deuterium * f)) });
    dgDur = M.buildingTime(pl, mn, maxT); dgDurF = { __fmtTime: dgDur }; canDg = canDowngrade(pl, mn);
  }
  const silo = mn === 'missile_silo';
  let description = { __desc: mn };
  return {
    object: O(mn), object_type: { __enum: o.type }, planet_id: pl.id, current_level: cur, next_level: next,
    description, title: { __title: mn }, price: R(pr), planet: PL(pl.id),
    production_time: { __fmtTime: t }, production_datetime: { __fmtDateTime: t }, production_next: prodNext, energy_difference: energyDiff,
    enough_resources: M.hasResources(pl, pr, ['terraformer', 'space_dock'].includes(mn)), has_requirements: o.req.length > 0,
    requirements_met: rm, character_class_met: M.classMet(mn), valid_planet_type: M.validPlanetType(pl, mn),
    build_active: items.length,
    build_active_current: active && active.object === mn ? { id: active.id, object: O(mn), level_target: active.level_target } : null,
    build_queue_max: items.length >= 5,
    storage: !!storageKey, current_storage: storageKey ? pl[storageKey] : 0, max_storage: storageKey ? M.storage(pl.levels[mn]) : 0,
    max_build_amount: M.maxBuildAmount(pl, mn, rm), current_amount: isUnit ? pl.units[mn] : 0,
    research_lab_upgrading: o.type === 'Research' && M.planets.some((p) => p.buildQueue.some((q) => q.active && q.object === 'research_lab')),
    research_in_progress: isBld && M.planets.some((p) => p.researchQueue.length > 0),
    shipyard_upgrading: isUnit && pl.buildQueue.some((q) => q.active && q.object === 'shipyard'),
    nanite_upgrading: isUnit && pl.buildQueue.some((q) => q.active && q.object === 'nano_factory'),
    ship_or_defense_in_progress: isBld && pl.unitQueue.length > 0,
    downgrade_price: dg, downgrade_duration: dgDur, downgrade_duration_formatted: dgDurF, ion_technology_level: ion, ion_technology_bonus: ionB,
    can_downgrade: canDg, is_in_vacation_mode: false, is_missile_silo: silo,
    current_missiles: silo && cur > 0 ? pl.units.interplanetary_missile + pl.units.anti_ballistic_missile : 0,
    max_missiles: silo && cur > 0 ? cur * 10 : 0, fields_exceeded: fieldsExceeded, use_production_energy: ['terraformer', 'space_dock'].includes(mn),
    __extraDescription: mn === 'interplanetary_missile' ? ` Your interplanetary missiles have got a coverage of ${player.research.impulse_drive * 5 - 1} systems.` : mn === 'solar_satellite' ? ` A solar satellite produces ${Math.floor((pl.temp_max + 140) / 6)} energy on this planet.` : '',
  };
}

// ---- TechtreeController
function techinfoVars(pl, mn) {
  const curL = pl.levels[mn];
  const p0 = (l) => (l === 0 ? { metal: 0, crystal: 0, deuterium: 0, energy: 0 } : M.objectProduction(pl, mn, l, true));
  const rk = ['metal', 'crystal', 'deuterium', 'energy'].find((k) => p0(1)[k] > 0);
  const amountCur = p0(curL)[rk];
  const minL = curL - 2 > 1 ? curL - 2 : 1;
  const rows = [];
  for (let i = minL; i < minL + 15; i++) {
    const r = p0(i), prev = p0(i - 1)[rk];
    rows.push({
      level: i, production: r[rk], production_difference: r[rk] - amountCur,
      production_difference_per_level: i === curL ? 0 : (i - 1 < curL ? (r[rk] - prev) * -1 : r[rk] - prev),
      energy_balance: r.energy, energy_difference: i === curL ? 0 : r.energy - p0(curL).energy,
      deuterium_consumption: r.deuterium, deuterium_consumption_per_level: i === curL ? 0 : r.deuterium - p0(curL).deuterium, protected: 0,
    });
  }
  return { object: O(mn), planet: PL(pl.id), production_table: rows, current_level: curL };
}
function techtreeVars(pl, mn) {
  // TechtreeController::getTechtreeArray -> depth-first requirement tree (one level of depth here is enough for a fixture)
  const lv = (n) => (OBJ[n].type === 'Research' ? player.research[n] : pl.levels[n]);
  const root = { gameObject: O(mn), levelRequired: 1, levelCurrent: Math.min(1, M.curLevel(pl, mn)), depth: 0, column: 0, parent: null };
  const list = [root];
  OBJ[mn].req.forEach(([n, l], i) => list.push({ gameObject: O(n), levelRequired: l, levelCurrent: lv(n), depth: 1, column: i, parent: { __ref: 0 } }));
  return { object: O(mn), techtree: list };
}
function applicationsVars(pl, mn) {
  return { object: O(mn), required_by: Object.values(OBJ).filter((c) => c.req.some(([n]) => n === mn)).map((c) => ({ gameObject: O(c.machine_name), requirementsMet: M.reqMet(pl, c.machine_name) })) };
}

const pages = [
  { file: 'buildings-overview.html', view: 'ingame.overview.index', path: '/overview', query: {}, body_id: 'overview', current: 4, vars: overviewVars(P(4)) },
  { file: 'buildings-overview-moon.html', view: 'ingame.overview.index', path: '/overview', query: { cp: '9' }, body_id: 'overview', current: 9, vars: overviewVars(P(9)) },
  { file: 'buildings-resources.html', view: 'ingame.resources.index', path: '/resources', query: {}, body_id: 'resources', current: 4,
    vars: Object.assign(buildingsIndex(P(4), ['metal_mine', 'crystal_mine', 'deuterium_synthesizer', 'solar_plant', 'fusion_plant', 'solar_satellite', 'crawler', 'metal_store', 'crystal_store', 'deuterium_store'], [1, 2, 3, 4, 12, 212]),
      (() => { const u = uqVM(P(4)); return { unit_build_active: u.active, unit_build_queue: u.queue, unit_queue_time_countdown: u.countdown }; })()) },
  { file: 'buildings-resources-colony.html', view: 'ingame.resources.index', path: '/resources', query: { cp: '7' }, body_id: 'resources', current: 7,
    vars: Object.assign(buildingsIndex(P(7), ['metal_mine', 'crystal_mine', 'deuterium_synthesizer', 'solar_plant', 'fusion_plant', 'solar_satellite', 'crawler', 'metal_store', 'crystal_store', 'deuterium_store'], [1, 2, 3, 4, 12, 212]),
      { unit_build_active: null, unit_build_queue: [], unit_queue_time_countdown: 0 }) },
  { file: 'buildings-resources-moon.html', view: 'ingame.resources.index', path: '/resources', query: { cp: '9' }, body_id: 'resources', current: 9,
    vars: Object.assign(buildingsIndex(P(9), ['metal_mine', 'crystal_mine', 'deuterium_synthesizer', 'solar_plant', 'fusion_plant', 'solar_satellite', 'metal_store', 'crystal_store', 'deuterium_store'], [41, 42, 43]),
      { unit_build_active: null, unit_build_queue: [], unit_queue_time_countdown: 0 }) },
  { file: 'buildings-facilities.html', view: 'ingame.facilities.index', path: '/facilities', query: {}, body_id: 'station', current: 4,
    vars: Object.assign(buildingsIndex(P(4), ['robot_factory', 'shipyard', 'research_lab', 'alliance_depot', 'missile_silo', 'nano_factory', 'terraformer', 'space_dock'], [14, 21, 31, 34, 15, 33]), { alliance_depot_level: P(4).levels.alliance_depot, wreckField: null }) },
  { file: 'buildings-facilities-moon.html', view: 'ingame.facilities.index', path: '/facilities', query: { cp: '9' }, body_id: 'station', current: 9,
    vars: Object.assign(buildingsIndex(P(9), ['robot_factory', 'shipyard', 'lunar_base', 'sensor_phalanx', 'jump_gate'], [41, 42, 43]), { wreckField: null }) },
  { file: 'buildings-research.html', view: 'ingame.research.index', path: '/research', query: {}, body_id: 'research', current: 4, vars: researchIndex(P(4)) },
  { file: 'buildings-shipyard.html', view: 'ingame.shipyard.index', path: '/shipyard', query: {}, body_id: 'shipyard', current: 4,
    vars: unitsIndex(P(4), [['light_fighter', 'heavy_fighter', 'cruiser', 'battle_ship', 'battlecruiser', 'bomber', 'destroyer', 'deathstar', 'reaper', 'pathfinder'], ['small_cargo', 'large_cargo', 'colony_ship', 'recycler', 'espionage_probe', 'solar_satellite', 'crawler']]) },
  { file: 'buildings-defense.html', view: 'ingame.defense.index', path: '/defense', query: {}, body_id: 'defense', current: 4,
    vars: unitsIndex(P(4), [['rocket_launcher', 'light_laser', 'heavy_laser', 'gauss_cannon', 'ion_cannon', 'plasma_turret', 'small_shield_dome', 'large_shield_dome', 'anti_ballistic_missile', 'interplanetary_missile']]) },
  { file: 'buildings-resource-settings.html', view: 'ingame.resources.settings', path: '/resources/settings', query: {}, body_id: 'resourceSettings', current: 4, vars: settingsVars(P(4)) },
];
const ajax = [
  ['buildings-ajax-resources-1.json', 4, 'metal_mine', 'building', '/ajax/resources'],
  ['buildings-ajax-resources-4.json', 4, 'solar_plant', 'building', '/ajax/resources'],
  ['buildings-ajax-resources-12.json', 4, 'fusion_plant', 'building', '/ajax/resources'],
  ['buildings-ajax-resources-22.json', 4, 'metal_store', 'building', '/ajax/resources'],
  ['buildings-ajax-resources-212.json', 4, 'solar_satellite', 'building', '/ajax/resources'],
  ['buildings-ajax-resources-217.json', 4, 'crawler', 'building', '/ajax/resources'],
  ['buildings-ajax-facilities-21.json', 4, 'shipyard', 'building', '/ajax/facilities'],
  ['buildings-ajax-facilities-33.json', 4, 'terraformer', 'building', '/ajax/facilities'],
  ['buildings-ajax-facilities-44.json', 4, 'missile_silo', 'building', '/ajax/facilities'],
  ['buildings-ajax-facilities-43-moon.json', 9, 'jump_gate', 'building', '/ajax/facilities'],
  ['buildings-ajax-research-122.json', 4, 'plasma_technology', 'research', '/ajax/research'],
  ['buildings-ajax-research-124.json', 4, 'astrophysics', 'research', '/ajax/research'],
  ['buildings-ajax-shipyard-203.json', 4, 'large_cargo', 'unit', '/ajax/shipyard'],
  ['buildings-ajax-shipyard-218.json', 4, 'reaper', 'unit', '/ajax/shipyard'],
  ['buildings-ajax-defense-401.json', 4, 'rocket_launcher', 'unit', '/ajax/defense'],
  ['buildings-ajax-defense-407.json', 4, 'small_shield_dome', 'unit', '/ajax/defense'],
  ['buildings-ajax-defense-503.json', 4, 'interplanetary_missile', 'unit', '/ajax/defense'],
].map(([file, pid, mn, q, path]) => ({ file, path, current: pid, technology: OBJ[mn].id, vars: ajaxVars(P(pid), mn, q) }));

const objects = {};
for (const o of Object.values(OBJ)) objects[o.machine_name] = { id: o.id, machine_name: o.machine_name, class_name: o.class_name, type: o.type, consumesPlanetField: o.consumesPlanetField, imgSmall: o.imgSmall, imgMicro: o.imgMicro, hasRequirements: o.req.length > 0, production: M.PROD_OBJECTS.includes(o.machine_name), storage: ['metal_store', 'crystal_store', 'deuterium_store'].includes(o.machine_name) };

process.stdout.write(JSON.stringify({
  now: NOW, csrf: M.CSRF, economySpeed: M.SETTINGS.economySpeed, fleetSpeed: M.SETTINGS.fleetSpeed,
  player: { id: player.id, username: player.username, class: { collector: 1, general: 2, discoverer: 3 }[player.class] ?? null, maxPlanets: 1 + Math.round(player.research.astrophysics / 2), darkMatter: player.darkMatter, highscoreRank: player.highscoreRank },
  planets: M.planets.map(planetData), objects, pages, ajax,
  techtree: [
    { file: 'buildings-techtree-tab1-122.html', view: 'ingame.techtree.techtree', current: 4, vars: techtreeVars(P(4), 'plasma_technology') },
    { file: 'buildings-techtree-tab2-1.html', view: 'ingame.techtree.techinfo', current: 4, vars: techinfoVars(P(4), 'metal_mine') },
    { file: 'buildings-techtree-tab3-1.html', view: 'ingame.techtree.technology', current: 4, vars: { object: O('metal_mine') } },
    { file: 'buildings-techtree-tab4-113.html', view: 'ingame.techtree.applications', current: 4, vars: applicationsVars(P(4), 'energy_technology') },
  ],
}, null, 1));
