/* shared/core/10-calc.js — GALAXYZ (2Moons fork) formulas with the ogamex.eu/Aeternum universe constants. Owner: core.
 * Sources: specs/galaxyz/mechanics.md (constants measured on the saved real pages), specs/galaxyz/mechanics-calc.js and upstream
 * 2Moons (class.BuildFunctions.php prices/times, class.PlanetRessUpdate.php production, class.FleetFunctions.php flights,
 * calculateSteal.php loot, MissionCaseExpedition.class.php finds). Inputs that are missing default to level 0.
 * There are no player classes, crawlers, plasma or position bonuses on GALAXYZ: those parameters are accepted and ignored. */
(function (OGX) {
  'use strict';
  const calc = (OGX.calc = OGX.calc || {});
  const RES = ['metal', 'crystal', 'deuterium'];
  const zero = () => ({ metal: 0, crystal: 0, deuterium: 0, energy: 0 });
  const obj = (id) => {
    const o = OGX.catalog.get(id);
    if (!o) throw new Error('OGX.calc: unknown object ' + id);
    return o;
  };
  const isUnit = (o) => o.type === 'ship' || o.type === 'defense';

  /** Universe constants of ogamex.eu/Aeternum (mechanics.md §0). `server` objects may override any of them by name.
   *  gameSpeed (build/research/shipyard time, 1 = 2500) is not visible on any saved page: null = unknown. */
  calc.gz = {
    resourceMultiplier: 22000,                              // REAL resources.html: mines and basic income x22000
    storageMultiplier: 5,                                   // REAL ticker limits = 5 x upstream formula
    maxOverflow: 1,                                         // REAL spied planets sit at exactly 100 % of storage
    energySpeed: 1,                                         // REAL energy rows = upstream formula x1
    basicIncome: { metal: 20, crystal: 10, deuterium: 0 },  // REAL "Basic Production 440.000 220.000 0"
    fleetSpeed: 7,                                          // REAL fleetStep1 data.gamespeed (fleet_speed 17500 / 2500)
    gameSpeed: null,                                        // UNKNOWN
    factorUniversity: 8,                                    // UPSTREAM default (% research time per University level)
    minBuildTime: 1, minFleetTime: 5,                       // UPSTREAM / REAL fleetStep1 fleetMinDuration
    debrisFleetPct: 30, debrisDefensePct: 0, moonFactor: 1, moonChanceMax: 20,   // UPSTREAM defaults, not verified
    lootPct: 0.5,                                           // UPSTREAM calculateSteal
  };
  /** calc.gz with the values a server object (state.server()) knows. A value the server object only defaults (fleetSpeedKnown false,
   *  e.g. a lanedirt-style default of 1) never replaces the measured Aeternum constant. */
  calc.config = function (server) {
    const out = Object.assign({}, calc.gz);
    for (const k of Object.keys(calc.gz)) {
      if (!server || server[k] === undefined || server[k] === null) continue;
      if (k === 'fleetSpeed' && (server.fleetSpeedKnown === false || !(+server.fleetSpeed > 0))) continue;
      out[k] = server[k];
    }
    return out;
  };

  /** No player classes on GALAXYZ; kept for callers: 'miner'|'collector' -> 'miner' etc., else 'none'. */
  calc.normClass = function (c) {
    const s = String(c || '').toLowerCase();
    if (s === 'miner' || s === 'collector') return 'miner';
    if (s === 'warrior' || s === 'general') return 'warrior';
    if (s === 'explorer' || s === 'discoverer') return 'explorer';
    return 'none';
  };

  /** Level of an object in a {id|machine|className: level} map. */
  function lv(map, id) {
    if (!map) return 0;
    const o = OGX.catalog.get(id);
    const v = map[id] ?? map[String(id)] ?? (o ? map[o.machine] ?? map[o.className] : undefined);
    return +v || 0;
  }
  calc._lv = lv;

  /** 2Moons getFactors: bonus sums from officers ({601: 18, ...}, level x bonus) and active dark matter boosts ([701, ...]).
   *  Keys: Attack, Defensive, Shield, BuildTime, ResearchTime, ShipTime, DefensiveTime, Resource, Energy, ResourceStorage,
   *  ShipStorage, FlyTime, FleetSlots, Planets, SpyPower. An object that already has these keys is returned as is. */
  calc.factors = function ({ officers, boosts } = {}) {
    const f = { Attack: 0, Defensive: 0, Shield: 0, BuildTime: 0, ResearchTime: 0, ShipTime: 0, DefensiveTime: 0, Resource: 0, Energy: 0,
      ResourceStorage: 0, ShipStorage: 0, FlyTime: 0, FleetSlots: 0, Planets: 0, SpyPower: 0 };
    const add = (id, n) => { const o = OGX.catalog.get(+id); if (o && o.bonus && n) for (const [k, v] of Object.entries(o.bonus)) f[k] = (f[k] || 0) + v * n; };
    for (const [id, n] of Object.entries(officers || {})) add(id, +n || 0);
    for (const id of boosts || []) add(id, 1);
    return f;
  };
  const factorsOf = (o) => (o && o.factors) || calc.factors(o || {});

  // ------------------------------------------------------------------ costs and times
  /** Price of reaching `level` (buildings/research: cost x factor^(level-1), floored), or of one unit. BuildFunctions::getElementPrice.
   *  Officers cost dark matter only (catalog price.darkMatter); fork-only conveyors 71-73 have no known price (all 0, priceKnown false). */
  calc.cost = function (id, level = 1) {
    const o = obj(id);
    const p = o.price;
    if (isUnit(o)) return { metal: p.metal, crystal: p.crystal, deuterium: p.deuterium, energy: p.energy };
    if (!level || level < 1) return zero();
    const f = Math.pow(p.factor || 1, level - 1);
    return { metal: Math.floor(p.metal * f), crystal: Math.floor(p.crystal * f), deuterium: Math.floor(p.deuterium * f), energy: Math.floor(p.energy * f) };
  };
  calc.costRange = function (id, fromLevelExcl, toLevelIncl) {
    const out = zero();
    for (let l = (fromLevelExcl || 0) + 1; l <= toLevelIncl; l++) {
      const c = calc.cost(id, l);
      for (const k of Object.keys(out)) out[k] += c[k];
    }
    return out;
  };
  calc.unitCost = function (id, n = 1) {
    const c = calc.cost(id);
    return { metal: c.metal * n, crystal: c.crystal * n, deuterium: c.deuterium * n, energy: c.energy * n };
  };
  /** Tear-down cost of `level`: half its price (2Moons; no ion technology discount). The third argument is ignored. */
  calc.downgradeCost = function (id, level) {
    const o = obj(id);
    const p = o.price;
    if (!level || level < 1) return zero();
    const f = Math.pow(p.factor || 1, level - 1) / 2;
    return { metal: Math.floor(p.metal * f), crystal: Math.floor(p.crystal * f), deuterium: Math.floor(p.deuterium * f), energy: 0 };
  };

  // Effective game speed (1 = 2500): explicit option, then the known universe value, then the caller's economySpeed.
  const gameSpeedOf = (o) => +o.gameSpeed || +calc.gz.gameSpeed || +o.economySpeed || 1;
  const seconds = (h, destroy) => Math.max(calc.gz.minBuildTime, Math.floor(h * (destroy ? 1300 : 3600)));

  /** Building time in seconds for reaching targetLevel. BuildFunctions::getBuildingTime:
   *  (metal+crystal) / (2500 x gameSpeed x (1 + robotics)) x 0.5^nanite x (1 + BuildTime). No OGame max(4 - L/2, 1) divisor.
   *  Options: robotics, nanite, gameSpeed|economySpeed, officers/boosts|factors, destroy (tear-down of level targetLevel). */
  calc.buildTime = function (id, targetLevel, opts = {}) {
    const { robotics = 0, nanite = 0, destroy = false } = opts;
    const pr = destroy ? calc.downgradeCost(id, targetLevel) : calc.cost(id, targetLevel);
    const f = factorsOf(opts);
    const h = (pr.metal + pr.crystal) / (2500 * gameSpeedOf(opts) * (1 + robotics)) * Math.pow(0.5, nanite) * (1 + f.BuildTime);
    return seconds(h, destroy);
  };
  /** Seconds per unit: (metal+crystal) / (2500 x gameSpeed x (1 + shipyard)) x 0.5^nanite x (1 + ShipTime|DefensiveTime). */
  calc.unitTime = function (id, opts = {}) {
    const { shipyard = 0, nanite = 0 } = opts;
    const o = obj(id);
    const f = factorsOf(opts);
    const bonus = o.type === 'defense' ? f.DefensiveTime : f.ShipTime;
    const h = (o.price.metal + o.price.crystal) / (2500 * gameSpeedOf(opts) * (1 + shipyard)) * Math.pow(0.5, nanite) * (1 + bonus);
    return seconds(h, false);
  };
  /** Research time in seconds: (metal+crystal) / (1000 x (1 + labLevel)) / gameSpeed x (1 - 8 %)^university x (1 + ResearchTime).
   *  labLevel = effective lab (calc.effectiveLab for the Intergalactic Research Network). researchSpeed/playerClass are ignored. */
  calc.researchTime = function (id, targetLevel, opts = {}) {
    const { labLevel = 0, university = 0 } = opts;
    const pr = calc.cost(id, targetLevel);
    const f = factorsOf(opts);
    const h = (pr.metal + pr.crystal) / (1000 * (1 + labLevel)) / gameSpeedOf(opts)
      * Math.pow(1 - calc.gz.factorUniversity / 100, university) * (1 + f.ResearchTime);
    return seconds(h, false);
  };
  /** Lab level for research `id` with IRN (123): this planet's lab plus up to `irnLevel` best other labs, each counted only
   *  when it meets the research's lab requirement. BuildFunctions::getBuildingTime + PlanetRessUpdate. */
  calc.effectiveLab = function (id, currentLab, otherLabs = [], irnLevel = 0) {
    const r = (obj(id).req || []).find(([rid]) => rid === 31);
    const need = r ? r[1] : 0;
    const labs = [currentLab || 0].concat(otherLabs.slice().sort((a, b) => b - a).slice(0, irnLevel || 0));
    return labs.reduce((s, l) => s + (l >= need ? l : 0), 0);
  };
  /** Dark matter to halve the remaining time. OgameX HalvingService formula: GALAXYZ has no known halving rule. */
  calc.halvingCost = function (remainingSecs, kind = 'building') {
    const c = Math.max(750, Math.ceil(((Math.max(0, remainingSecs) / 60) / 30) * 750));
    return Math.min(c, kind === 'research' ? 108000 : 72000);
  };

  // ------------------------------------------------------------------ economy
  /** Storage of a store at `level`: floor(2.5 x 1.8331954764^L) x 5000 x storageMultiplier (x5 on Aeternum). Level 0 = 50 000. */
  calc.storageCapacity = function (level, server) {
    const c = calc.config(server);
    const f = server && server.factors ? 1 + (server.factors.ResourceStorage || 0) : 1;
    return Math.floor(2.5 * Math.pow(1.8331954764, level || 0)) * 5000 * c.storageMultiplier * f;
  };
  /** No planet position bonus on GALAXYZ. */
  calc.positionBonus = () => [1, 1, 1];

  // 2Moons production grid (install.sql:948-996), reproduced exactly on REAL resources.html. p = setting 0..10, T = Tmax, e = energy tech.
  const PROD = {
    1: { metal: (L, p) => 30 * L * Math.pow(1.1, L) * 0.1 * p, energy: (L, p) => -10 * L * Math.pow(1.1, L) * 0.1 * p },
    2: { crystal: (L, p) => 20 * L * Math.pow(1.1, L) * 0.1 * p, energy: (L, p) => -10 * L * Math.pow(1.1, L) * 0.1 * p },
    3: { deuterium: (L, p, T) => 10 * L * Math.pow(1.1, L) * (1.28 - 0.002 * T) * 0.1 * p, energy: (L, p) => -30 * L * Math.pow(1.1, L) * 0.1 * p },
    4: { energy: (L, p) => 20 * L * Math.pow(1.1, L) * 0.1 * p },
    12: { deuterium: (L, p) => -10 * L * Math.pow(1.1, L) * 0.1 * p, energy: (L, p, T, e) => 30 * L * Math.pow(1.05 + e * 0.01, L) * 0.1 * p },
    212: { energy: (L, p, T) => ((T + 160) / 6) * 0.1 * p * L },   // per satellite, not floored
  };
  calc.producerIds = Object.keys(PROD).map(Number);

  /** Hourly production of one body (PlanetRessUpdate::ReBuildCache). Input: { levels, percents (0..100), ships: {212}, tempMax,
   *  isMoon, research: {113, 131, 132, 133}, officers: {601, 603, ...}, boosts: [704, ...] | factors, server: calc.gz overrides }.
   *  perHour is the exact float the game's resourceTicker uses (includes basic income and the officer/research bonus).
   *  breakdown: base (basic income), mines (gross mine output after the energy factor), bonus (officers + 131-133), use (fusion deuterium). */
  calc.production = function (input = {}) {
    const res0 = () => ({ metal: 0, crystal: 0, deuterium: 0 });
    const cfg = calc.config(input.server);
    const f = factorsOf(input);
    const out = {
      perHour: res0(), energy: { production: 0, consumption: 0, balance: 0 }, factor: 1,
      breakdown: { base: res0(), mines: res0(), bonus: res0(), use: res0(), position: res0(), plasma: res0(), class: res0(), crawler: res0() },
      maxCrawlers: 0,
    };
    const T = +input.tempMax || 0;
    const eTech = lv(input.research, 113);
    const plus = { metal: 0, crystal: 0, deuterium: 0, energy: 0 };
    const minus = { metal: 0, crystal: 0, deuterium: 0, energy: 0 };
    for (const id of calc.producerIds) {
      const L = id === 212 ? lv(input.ships, 212) || lv(input.levels, 212) : lv(input.levels, id);
      if (!L) continue;
      const pc = input.percents ? input.percents[id] ?? input.percents[String(id)] : undefined;
      const p = pc === undefined || pc === null ? 10 : Math.max(0, +pc) / 10;
      for (const [r, fn] of Object.entries(PROD[id])) {
        const v = fn(L, p, T, eTech);
        if (v > 0) plus[r] += v; else minus[r] += v;
      }
    }
    const energy = Math.round(plus.energy * cfg.energySpeed * (1 + f.Energy));
    const used = minus.energy * cfg.energySpeed;
    const prodLevel = used === 0 ? 0 : Math.min(1, energy / Math.abs(used));
    out.factor = prodLevel;
    out.energy = { production: energy, consumption: Math.round(Math.abs(used)), balance: Math.round(energy + used) };
    if (input.isMoon) return out;   // moons never produce (PlanetRessUpdate::ExecCalc)
    const resBonus = { metal: lv(input.research, 131), crystal: lv(input.research, 132), deuterium: lv(input.research, 133) };
    for (const r of RES) {
      const base = (cfg.basicIncome[r] || 0) * cfg.resourceMultiplier;
      const mines = used === 0 ? 0 : plus[r] * prodLevel * cfg.resourceMultiplier;
      const bonus = mines * (f.Resource + 0.02 * resBonus[r]);
      const use = used === 0 ? 0 : minus[r] * cfg.resourceMultiplier;
      out.perHour[r] = base + mines + bonus + use;
      out.breakdown.base[r] = Math.round(base);   // rounded like the rows of page=resources
      out.breakdown.mines[r] = Math.round(mines);
      out.breakdown.bonus[r] = Math.round(bonus);
      out.breakdown.use[r] = Math.round(use);
    }
    return out;
  };

  /** Stock at `at` (ServerMs), 2Moons ExecCalc: grows only while the stock is at most the storage (capped there);
   *  negative production always applies and floors at 0. r = { amount, storage, perHour, t }. */
  calc.amountAt = function (r, at) {
    if (!r) return 0;
    const a0 = +r.amount || 0;
    const cap = r.storage === undefined || r.storage === null ? Infinity : +r.storage * calc.gz.maxOverflow;
    const ph = +r.perHour || 0;
    const dt = Math.max(0, ((at === undefined ? OGX.time.serverNow() : at) - (+r.t || 0)) / 1000);
    if (ph < 0) return Math.max(0, a0 + (ph / 3600) * dt);
    if (a0 > cap) return a0;
    return Math.min(cap, a0 + (ph / 3600) * dt);
  };
  calc.secondsUntilFull = function (r, at) {
    const a = calc.amountAt(r, at);
    const cap = +r.storage;
    if (!Number.isFinite(cap)) return Infinity;
    if (a >= cap) return 0;
    return r.perHour > 0 ? (cap - a) / (r.perHour / 3600) : Infinity;
  };
  calc.timeUntilAffordable = function (cost, resources, at) {
    let t = 0;
    for (const k of RES) {
      const need = (cost && cost[k]) || 0;
      if (need <= 0) continue;
      const r = resources && resources[k];
      const have = calc.amountAt(r, at);
      if (have >= need) continue;
      if (!r || !(r.perHour > 0)) return Infinity;
      const cap = r.storage === undefined || r.storage === null ? Infinity : +r.storage;
      if (need > cap) return Infinity;
      t = Math.max(t, (need - have) / (r.perHour / 3600));
    }
    return t;
  };
  /** Cost overlay (OL §5.5): signed diffs and transporters needed, plus time until affordable. */
  calc.costOverlay = function (cost, resources, at, { capSC = 0, capLC = 0 } = {}) {
    const ships = (amount, cap) => (cap > 0 ? Math.ceil(amount / cap) : 0);
    const out = { total: 0, missingTotal: 0, rows: {}, sc: 0, lc: 0, secondsUntilAffordable: 0 };
    for (const k of RES) {
      const need = (cost && cost[k]) || 0;
      out.total += need;
      const have = calc.amountAt(resources && resources[k], at);
      const diff = have - need;
      out.missingTotal += Math.max(0, -diff);
      out.rows[k] = { need, have, diff, sc: ships(Math.abs(diff), capSC), lc: ships(Math.abs(diff), capLC) };
    }
    out.sc = ships(out.missingTotal, capSC);
    out.lc = ships(out.missingTotal, capLC);
    out.secondsUntilAffordable = calc.timeUntilAffordable(cost, resources, at);
    return out;
  };

  // ------------------------------------------------------------------ fleet
  const DRIVE_TECH = { 1: [115, 0.1], 2: [117, 0.2], 3: [118, 0.3] };
  // FleetFunctions::GetShipSpeed: speedTech 4 = Light Cargo (impulse from impulse 5), 5 = Planet Bomber (hyperspace from hyperspace 8).
  function driveOf(o, research) {
    let t = (o.props && o.props.speedTech) || 0;
    if (t === 4) t = lv(research, 117) >= 5 ? 2 : 1;
    if (t === 5) t = lv(research, 118) >= 8 ? 3 : 2;
    return t;
  }
  /** Effective speed: base x (1 + 10 % combustion | 20 % impulse | 30 % hyperspace per level). Upstream always uses the
   *  first speed value, also after a drive switch. playerClass is ignored. */
  calc.shipSpeed = function (id, research) {
    const o = obj(id);
    const d = DRIVE_TECH[driveOf(o, research)];
    if (!d || !o.props || !o.props.speed) return 0;
    return o.props.speed * (1 + d[1] * lv(research, d[0]));
  };
  /** Deuterium use per ship (FleetFunctions::GetShipConsumption: the second value after the 202/211 drive switch). */
  calc.shipFuel = function (id, research) {
    const o = obj(id);
    if (!o.props) return 0;
    const sw = (o.id === 202 && lv(research, 117) >= 5) || (o.id === 211 && lv(research, 118) >= 8);
    return sw ? o.props.fuel2 : o.props.fuel;
  };
  /** Cargo per ship: base x (1 + ShipStorage) (officer 607 +50 %/level). No hyperspace technology bonus on GALAXYZ (REAL fleetroom). */
  calc.cargoCapacity = function (id, research, playerClass, opts = {}) {
    const o = obj(id);
    return ((o.props && o.props.cargo) || 0) * (1 + factorsOf(opts).ShipStorage);
  };
  /** Fuel counts against cargo on GALAXYZ (fleetroom - consumption), so the fuel capacity is the cargo capacity. */
  calc.fuelCapacity = (id, research, opts = {}) => calc.cargoCapacity(id, research, null, opts);
  /** Effective values of all ships. opts: { officers } | { factors } for the 607 cargo bonus. */
  calc.shipStats = function (research, playerClass, opts = {}) {
    const out = {};
    for (const id of OGX.catalog.shipIds) {
      const fuel = calc.shipFuel(id, research);
      const cargo = calc.cargoCapacity(id, research, null, opts);
      out[id] = { speed: calc.shipSpeed(id, research), cargo, fuel, fuelConsumption: fuel, fuelCapacity: cargo };
    }
    return out;
  };
  /** OgameX check-target shipsData -> the same shape as shipStats. */
  calc.statsFromShipsData = function (shipsData) {
    const out = {};
    for (const [id, s] of Object.entries(shipsData || {})) {
      out[id] = { speed: +s.speed, cargo: +s.baseCargoCapacity, fuel: +s.fuelConsumption, fuelConsumption: +s.fuelConsumption, fuelCapacity: +s.baseFuelCapacity };
    }
    return out;
  };
  /** GALAXYZ fleetStep1 inline data.ships ({ id: { speed, consumption, amount } }, the server's own values) -> shipStats shape. */
  calc.statsFromStep1 = function (ships, opts = {}) {
    const out = {};
    for (const [id, s] of Object.entries(ships || {})) {
      const o = OGX.catalog.get(+id);
      const cargo = o ? calc.cargoCapacity(+id, null, null, opts) : 0;
      out[id] = { speed: +s.speed, cargo, fuel: +s.consumption, fuelConsumption: +s.consumption, fuelCapacity: cargo };
    }
    return out;
  };

  /** FleetFunctions::GetTargetDistance: no circular galaxies or systems, no empty-system skipping (options are ignored). */
  calc.distance = function (a, b) {
    const [g1, s1, p1] = OGX.util.coordsArr(a);
    const [g2, s2, p2] = OGX.util.coordsArr(b);
    if (g1 !== g2) return Math.abs(g1 - g2) * 20000;
    if (s1 !== s2) return Math.abs(s1 - s2) * 95 + 2700;
    if (p1 !== p2) return Math.abs(p1 - p2) * 5 + 1000;
    return 5;
  };
  const WAR = [1, 2, 6, 8, 9, 10], PEACEFUL = [3, 4, 7, 11, 15], HOLDING = [5];
  calc.missionSpeedClass = (m) => (WAR.includes(+m) ? 'war' : PEACEFUL.includes(+m) ? 'peaceful' : HOLDING.includes(+m) ? 'holding' : null);
  /** GALAXYZ has one fleet speed for every mission (fleetStep1 gamespeed): server.fleetSpeed, else the Aeternum value 7. */
  calc.missionSpeedFactor = function (mission, server = {}) {
    const s = server || {};
    const c = calc.missionSpeedClass(mission);
    const per = c === 'war' ? s.fleetSpeedWar : c === 'holding' ? s.fleetSpeedHolding : c === 'peaceful' ? s.fleetSpeedPeaceful : undefined;
    return +s.fleetSpeed || +per || calc.gz.fleetSpeed;
  };
  /** Flight time (flotten.js): max(round((35000 / speedPct x sqrt(10 d / maxSpeed) + 10) / gamespeed) x flyFactor, 5 s).
   *  speedPct 1..10 (10 = 100 %), speedFactor = gamespeed, flyFactor = fleetspeedfactor (1 + FlyTime, General -10 %/level). */
  calc.flightDuration = function ({ distance, maxSpeed, speedPct = 10, speedFactor = 1, flyFactor = 1 }) {
    if (!(maxSpeed > 0) || !(speedFactor > 0)) return Infinity;
    return Math.max(Math.round((35000 / speedPct * Math.sqrt(distance * 10 / maxSpeed) + 10) / speedFactor) * flyFactor, calc.gz.minFleetTime);
  };
  const selected = (ships) => Object.entries(ships || {}).filter(([, n]) => +n > 0);
  calc.fleetMaxSpeed = function (ships, stats) {
    let min = Infinity;
    for (const [id] of selected(ships)) { const s = stats[id] && stats[id].speed; if (s > 0) min = Math.min(min, s); }
    return Number.isFinite(min) ? min : 0;
  };
  /** Deuterium for one way (FleetFunctions::GetFleetConsumption = flotten.js): round(sum of
   *  fuel x n x d / 35000 x (spd / 10 + 1)^2) + 1, spd = 35000 / (round(duration) x gamespeed - 10) x sqrt(10 d / speed).
   *  Hold and expedition time cost nothing. variant 'server' with speedPct recomputes the duration from fleetSpeed. */
  calc.fuel = function ({ ships, stats, distance, duration, speedFactor = 1, variant = 'client', fleetSpeed, speedPct }) {
    let gs = speedFactor || 1;
    let dur = duration;
    if (variant === 'server') {
      gs = fleetSpeed || gs;
      if (speedPct) dur = calc.flightDuration({ distance, maxSpeed: calc.fleetMaxSpeed(ships, stats), speedPct, speedFactor: gs });
    }
    let c = 0, any = false;
    for (const [id, n] of selected(ships)) {
      const s = stats[id];
      if (!s || !(s.speed > 0)) continue;
      any = true;
      const spd = 35000 / (Math.round(dur) * gs - 10) * Math.sqrt((distance * 10) / s.speed);
      c += (s.fuelConsumption ?? s.fuel ?? 0) * n * distance / 35000 * Math.pow(spd / 10 + 1, 2);
    }
    return any ? Math.round(c) + 1 : 0;
  };
  calc.fleetCargo = function (ships, stats) {
    let t = 0;
    for (const [id, n] of selected(ships)) t += ((stats[id] && stats[id].cargo) || 0) * n;
    return Math.floor(t);
  };
  calc.cargoNeeded = function (amount, shipId, stats, { reservePct = 0 } = {}) {
    const cap = stats && stats[shipId] ? stats[shipId].cargo : 0;
    return cap > 0 ? Math.ceil((amount * (1 + (reservePct || 0) / 100)) / cap) : 0;
  };
  /** Fleet slots 1 + computer + Commander (611, +3 per level); expedition slots floor(sqrt(astrophysics 124)). */
  calc.slots = function ({ computer = 0, astrophysics = 0, bonusExpeditionSlots = 0, officers, factors } = {}) {
    const f = factorsOf({ officers, factors });
    return {
      fleet: 1 + (computer || 0) + f.FleetSlots,
      expedition: Math.floor(Math.sqrt(astrophysics || 0)) + (bonusExpeditionSlots || 0),
    };
  };

  // ------------------------------------------------------------------ combat, loot, debris
  /** 50 % of each resource for everybody (no classes). */
  calc.lootPct = () => calc.gz.lootPct;
  /** calculateSteal fill order on the lootable amounts: metal up to 1/3 of the cargo, crystal up to half the rest,
   *  deuterium the rest, then metal tops up with half of what is left and crystal with the remainder. */
  calc.distributeLoot = function (loot, capacity) {
    const L = { metal: Math.max(0, loot.metal || 0), crystal: Math.max(0, loot.crystal || 0), deuterium: Math.max(0, loot.deuterium || 0) };
    const d = { metal: 0, crystal: 0, deuterium: 0 };
    let cap = capacity;
    if (!(cap > 0)) return d;
    d.metal = Math.min(cap / 3, L.metal); cap -= d.metal;
    d.crystal = Math.min(cap / 2, L.crystal); cap -= d.crystal;
    d.deuterium = Math.min(cap, L.deuterium); cap -= d.deuterium;
    const m2 = Math.min(cap / 2, L.metal - d.metal); d.metal += m2; cap -= m2;
    d.crystal += Math.min(cap, L.crystal - d.crystal);
    return d;
  };
  /** Smallest cargo capacity for which distributeLoot(loot, capacity) takes the whole loot (the fill order needs more room than
   * the loot sum when one resource dominates: metal alone needs 1.5 x). loot = the lootable amounts { metal, crystal, deuterium }. */
  calc.lootCapacity = function (loot) {
    const L = { metal: Math.max(0, (loot && loot.metal) || 0), crystal: Math.max(0, (loot && loot.crystal) || 0), deuterium: Math.max(0, (loot && loot.deuterium) || 0) };
    const total = L.metal + L.crystal + L.deuterium;
    if (!(total > 0)) return 0;
    const got = (cap) => { const d = calc.distributeLoot(L, cap); return d.metal + d.crystal + d.deuterium; };
    const eps = Math.max(1e-6, total * 1e-12);
    if (got(total) >= total - eps) return Math.ceil(total);
    let lo = total, hi = total * 3;
    while (got(hi) < total - eps) hi *= 2;
    for (let i = 0; i < 200 && hi - lo > 1e-9 * total; i++) {
      const mid = (lo + hi) / 2;
      if (got(mid) >= total - eps) hi = mid; else lo = mid;
    }
    let c = Math.max(Math.ceil(total), Math.floor(hi));                     // integer capacity: settle the float edge
    while (got(c) < total - eps) c++;
    while (c - 1 >= total && got(c - 1) >= total - eps) c--;
    return c;
  };
  calc.loot = function (res, { cargo = Infinity, pct } = {}) {
    const p = pct === undefined ? calc.lootPct() : pct;
    const raw = {};
    for (const k of RES) raw[k] = Math.max(0, (res && res[k]) || 0) * p;
    const d = calc.distributeLoot(raw, cargo);
    const fl = (v) => Math.floor(v + 1e-6);   // the fill order works on thirds and halves: drop float noise before flooring
    const out = { metal: fl(d.metal), crystal: fl(d.crystal), deuterium: fl(d.deuterium) };
    out.total = out.metal + out.crystal + out.deuterium;
    return out;
  };
  /** Debris of destroyed units: Fleet_Cdr % of ships' metal+crystal, Defs_Cdr % of defence. server = { debrisFleetPct = 30,
   *  debrisDefensePct = 0, debrisDeuterium = false } (upstream defaults, Aeternum unverified). */
  calc.debris = function (lostUnits, server = {}) {
    const fleetPct = server.debrisFleetPct ?? calc.gz.debrisFleetPct, defPct = server.debrisDefensePct ?? calc.gz.debrisDefensePct;
    const deut = !!server.debrisDeuterium;
    const out = { metal: 0, crystal: 0, deuterium: 0 };
    for (const [id, n] of selected(lostUnits)) {
      const o = OGX.catalog.get(+id);
      if (!o || !isUnit(o)) continue;
      const pct = o.type === 'defense' ? defPct : fleetPct;
      out.metal += Math.floor((o.price.metal * n * pct) / 100);
      out.crystal += Math.floor((o.price.crystal * n * pct) / 100);
      if (deut) out.deuterium += Math.floor((o.price.deuterium * n * pct) / 100);
    }
    return out;
  };
  /** MissionCaseAttack: min(round(debris / 100000 x moonFactor), maxChance) %. */
  calc.moonChance = (debrisTotal, maxChance = calc.gz.moonChanceMax, moonFactor = calc.gz.moonFactor) =>
    Math.max(0, Math.min(Math.round(((debrisTotal || 0) / 100000) * moonFactor), maxChance));
  calc.unitsValue = function (units) {
    const out = { metal: 0, crystal: 0, deuterium: 0 };
    for (const [id, n] of selected(units)) {
      const o = OGX.catalog.get(+id);
      if (!o) continue;
      out.metal += o.price.metal * n; out.crystal += o.price.crystal * n; out.deuterium += o.price.deuterium * n;
    }
    out.total = out.metal + out.crystal + out.deuterium;
    out.points = out.total / 1000;
    return out;
  };
  /** 'M:C:D' text -> [m, c, d] (all > 0) | null. Accepts '1:2:4', '1;1,5;3', '3/2/1'. */
  calc.parseRates = function (s) {
    const a = String(s || '').trim().split(/[:;/ ]+/).map((x) => parseFloat(String(x).replace(',', '.')));
    return a.length === 3 && a.every((x) => Number.isFinite(x) && x > 0) ? a : null;
  };
  /** Metal-unit rates of this account: the user's «Курс для единиц металла» (setting stats.msuRates, shared by Stats and Spy),
   * else the server's trader rate. GALAXYZ Aeternum: REAL trader.html «The exchange rate is: 4/2/1» = M:C:D 1:2:4
   * (mechanics.md §8, [UPSTREAM ShowTraderPage charge]); OgameX: the usual 1:1.5:3. text: an explicit setting value. */
  calc.msuRates = function (text) {
    let s = text;
    if (s === undefined) { try { s = OGX.settings.get('stats.msuRates'); } catch (e) { s = ''; } }
    const r = calc.parseRates(s);
    if (r) return r;
    return OGX.page && OGX.page.isGz && OGX.page.isGz() ? [1, 2, 4] : [1, 1.5, 3];
  };
  calc.msu = (res, rates = [1, 1.5, 3]) => ((res && res.metal) || 0) * rates[0] + ((res && res.crystal) || 0) * rates[1] + ((res && res.deuterium) || 0) * rates[2];

  // ------------------------------------------------------------------ expeditions
  /** Expedition points of a fleet: sum of (metal+crystal) x 5 / 1000 per ship (MissionCaseExpedition). */
  calc.expeditionPoints = (ships) => selected(ships).reduce((s, [id, n]) => {
    const o = OGX.catalog.get(+id);
    return s + (o ? ((o.price.metal + o.price.crystal) * 5 / 1000) * n : 0);
  }, 0);
  /** BASE cargo of a fleet as MissionCaseExpedition counts it: sum(pricelist capacity x n), no Storage expert 607 factor. */
  calc.baseCargo = (ships) => Math.floor(selected(ships).reduce((s, [id, n]) => { const o = OGX.catalog.get(+id); return s + ((o && o.props && o.props.cargo) || 0) * n; }, 0));
  /** Resource find of the expedition fleet `ships`: min(free cargo, 200 x expedition points) — the event size never changes it
   *  (upstream min(maxFactor, max(200, factor)) with factor <= 200), and it does not scale with the economy.
   *  Free cargo = cargo when given, else the BASE cargo of `ships` (calc.baseCargo, no officers: upstream MissionCaseExpedition)
   *  minus cargoOnBoard (number or { metal, crystal, deuterium }). Without ships every value is 0. -> also free, cargoBase. */
  calc.expeditionMaxFind = function ({ ships, cargo, cargoOnBoard = 0 } = {}) {
    const points = calc.expeditionPoints(ships);
    const onBoard = typeof cargoOnBoard === 'object' && cargoOnBoard ? RES.reduce((a, k) => a + (+cargoOnBoard[k] || 0), 0) : (+cargoOnBoard || 0);
    const cargoBase = ships && selected(ships).length ? calc.baseCargo(ships) : null;
    const free = cargo !== undefined && cargo !== null ? cargo : cargoBase !== null ? Math.max(0, cargoBase - onBoard) : Infinity;
    const max = Math.round(Math.min(free, 200 * points));
    const res = () => ({ metal: max, crystal: max, deuterium: max });
    return Object.assign(res(), { min: max, base: max, points, free, cargoBase, limitedByCargo: free < 200 * points, normal: res(), rare: res(), exceptional: res() });
  };
  /** Ship-find value per event size [UPSTREAM MissionCaseExpedition]: max(round(size x min(points, topPoints >= 5e6 ? 6000 : 4500)),
   *  10000) of metal + crystal, size 50 / 100 / 200. topPoints unknown (null) -> cap 4500 and capKnown false. */
  calc.expeditionShipFind = function ({ points = 0, topPoints = null } = {}) {
    const known = topPoints !== null && topPoints !== undefined && Number.isFinite(+topPoints);
    const cap = known && +topPoints >= 5e6 ? 6000 : 4500;
    const v = (size) => Math.max(Math.round(size * Math.min(+points || 0, cap)), 10000);
    return { normal: v(50), rare: v(100), exceptional: v(200), cap, capKnown: known, capped: (+points || 0) > cap };
  };
  /** Minimum ships of each type in `ids` (default 202 + 203) to carry maxMetal: { id: n }, 0 when the cargo is unknown. */
  calc.expeditionMinShips = function (maxMetal, stats, ids = [202, 203]) {
    const cap = (id) => (stats && stats[id] && stats[id].cargo) || 0;
    return Object.fromEntries(ids.map((id) => [id, cap(id) > 0 ? Math.ceil(maxMetal / cap(id)) : 0]));
  };

  // ------------------------------------------------------------------ misc
  /** ShowPhalanxPage: level 1 = 1 system, else level^2 - 1 (own galaxy only). */
  calc.phalanxRange = (level) => (!level ? 0 : level === 1 ? 1 : level * level - 1);
  calc.missileRange = (impulseLevel) => Math.max(0, 5 * (impulseLevel || 0) - 1);
})(window.OGX);
