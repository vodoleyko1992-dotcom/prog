// GALAXYZ (ogamex.eu, 2Moons 1.8 fork) game mechanics, ported 1:1 from upstream 2Moons PHP.
// Spec: specs/galaxyz/mechanics.md. Every function names its upstream source (paths relative to src/2Moons).
// No dependencies. Works in Node (module.exports) and in a content script (globalThis.GZCalc).
// Unit stats/costs/rapidfire come from specs/galaxyz/elements.json (pass `E = elements.json.elements`).
// Resource ids: 901 metal, 902 crystal, 903 deuterium, 911 energy, 921 dark matter.
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- server config
  // UPSTREAM defaults: install/install.sql:155-291 (table %PREFIX%config). Fork admins change these.
  const UPSTREAM_CONFIG = {
    game_speed: 2500,            // 2500 = x1 economy; build/ship/research time divisor (install.sql:160)
    fleet_speed: 2500,           // 2500 = x1 fleet (install.sql:161)
    resource_multiplier: 1,      // production multiplier (install.sql:162)
    storage_multiplier: 1,       // storage multiplier (install.sql:163)
    halt_speed: 1,               // expedition/hold hours divisor (install.sql:166)
    Fleet_Cdr: 30,               // % of destroyed SHIP (metal+crystal) into debris (install.sql:167)
    Defs_Cdr: 0,                 // % of destroyed DEFENSE (metal+crystal, after rebuild) into debris (install.sql:168)
    initial_fields: 163,         // home planet fields (install.sql:169)
    metal_basic_income: 20, crystal_basic_income: 10, deuterium_basic_income: 0, energy_basic_income: 0, // install.sql:174-177
    noobprotection: 0, noobprotectiontime: 5000, noobprotectionmulti: 5,  // install.sql:181-183
    min_build_time: 1,           // seconds (install.sql:212)
    max_galaxy: 9, max_system: 400, max_planets: 15,  // install.sql:244-246 (expedition = max_planets + 1)
    planet_factor: 1.0,          // colony field multiplier (install.sql:247)
    max_elements_build: 5, max_elements_tech: 2, max_elements_ships: 10, // queue lengths (install.sql:248-250)
    min_player_planets: 9, planets_tech: 11, planets_officier: 5, planets_per_tech: 0.5, // install.sql:251-254
    max_fleet_per_build: 1000000, deuterium_cost_galaxy: 10, max_dm_missions: 1,      // install.sql:255-257
    max_overflow: 1.0,           // storage overflow factor (install.sql:258)
    moon_factor: 1.0, moon_chance: 20,                         // install.sql:259-260
    darkmatter_cost_trader: 750, factor_university: 8,          // install.sql:261-262
    max_fleets_per_acs: 16, debris_moon: 1,                     // install.sql:263-264 (debris_moon=1: moon creation wipes the debris field)
    vmode_min_time: 259200, gate_wait_time: 3600,               // install.sql:265-266
    silo_factor: 1, energySpeed: 1, stat_settings: 1000,        // install.sql:281,284,191
    trade_charge: 30,                                           // fleet trade fee % (install.sql:230)
  };

  // Aeternum values that real pages prove (DERIVED, see mechanics.md §1). Unknown keys fall back to upstream.
  const AETERNUM_CONFIG = Object.assign({}, UPSTREAM_CONFIG, {
    fleet_speed: 17500,          // fleetStep1 data.gamespeed = fleet_speed/2500 = 7 [REAL fleetStep1.html]
    resource_multiplier: 22000,  // resources.html: Basic Production 440.000 = 20 x 22000; mines reproduce exactly
    energySpeed: 1,              // resources.html: energy rows = upstream formula x 1
    storage_multiplier: 5,       // resources.html: storage = 5 x upstream formula (ResourceStorage bonus 0 assumed)
    initial_fields: 400,         // home planet 405 fields with Terraformer 1 (+5) [REAL imperium.html]
    darkmatter_cost_trader: 100, // trader.html "The value of the merchant is 100 Dark Matter!"
    game_speed: null,            // UNKNOWN: no time is printed on any saved page
  });

  const C = UPSTREAM_CONFIG;
  const MIN_FLEET_TIME = 5;           // includes/constants.php:79
  const MAX_ATTACK_ROUNDS = 6;        // includes/constants.php:101
  const PHALANX_DEUTERIUM = 5000;     // includes/constants.php:82
  const FIELDS_BY_TERRAFORMER = 5;    // includes/constants.php:67
  const FIELDS_BY_MOONBASIS_LEVEL = 3;// includes/constants.php:64
  const SPY_DIFFENCE_FACTOR = 1, SPY_VIEW_FACTOR = 1; // includes/constants.php:123,134

  const cost = (E, id) => (E[id] && E[id].cost) || {};
  const mc = (E, id) => (cost(E, id)[901] || 0) + (cost(E, id)[902] || 0);

  // ---------------------------------------------------------------- bonuses ("factor")
  // getFactors(): includes/GeneralFunctions.php:18-55. Officers: level x bonus; DM boosts 701-707: flat bonus while active.
  // Values: install/install.sql:1018-1039 (UPSTREAM; maxLevel matches the REAL officier page).
  const OFFICER_BONUS = {
    601: { Resource: 0.05 },                                   // Geologist, max 20
    602: { Attack: 0.05, Defensive: 0.05, Shield: 0.05 },      // Admiral, max 20
    603: { Attack: 0.05, Defensive: 0.05, Energy: 0.05 },      // Engineer, max 10
    604: { ShipTime: -0.05 },                                  // Technocrat, max 10
    605: { BuildTime: -0.10 },                                 // Constructor, max 3
    606: { ResearchTime: -0.10 },                              // Scientist, max 3
    607: { ShipStorage: 0.50 },                                // Storage expert, max 2
    608: { DefensiveTime: -0.25 },                             // Minister of Defence, max 2
    610: { SpyPower: 0.35 },                                   // Spy, max 2
    611: { FleetSlots: 3 },                                    // Commander, max 3 (absolute slots per level)
    613: { FlyTime: -0.10 },                                   // General, max 3
    615: { Planets: 2 },                                       // cssKey rpg_empereur (REAL name "Raider"), max 1
  };
  const DM_BONUS = {   // active for timeBonus=86400 s after purchase; cost in DM (install.sql:1033-1039)
    701: { Attack: 0.10, Defensive: 0.10 }, 702: { Shield: 0.10 }, 703: { BuildTime: -0.10 },
    704: { Resource: 0.10 }, 705: { Energy: 0.10 }, 706: { ResearchTime: -0.10 }, 707: { FlyTime: -0.10 },
  };
  const BONUS_KEYS = ['Attack', 'Defensive', 'Shield', 'BuildTime', 'ResearchTime', 'ShipTime', 'DefensiveTime', 'Resource',
    'Energy', 'ResourceStorage', 'ShipStorage', 'FlyTime', 'FleetSlots', 'Planets', 'SpyPower', 'Expedition', 'GateCoolTime', 'MoreFound'];
  // NOTE naming trap: 'Defensive' = SHIELD multiplier in combat, 'Shield' = HULL multiplier (calculateAttack.php:90-92).
  function factors({ officers = {}, dmActive = [] } = {}) {
    const f = Object.fromEntries(BONUS_KEYS.map((k) => [k, 0]));
    for (const [id, lvl] of Object.entries(officers)) for (const [k, v] of Object.entries(OFFICER_BONUS[id] || {})) f[k] += v * lvl;
    for (const id of dmActive) for (const [k, v] of Object.entries(DM_BONUS[id] || {})) f[k] += v;
    return f;
  }

  // ---------------------------------------------------------------- prices & times
  // getElementPrice(): includes/classes/class.BuildFunctions.php:65-108. Price of building/research LEVEL `level`
  // (i.e. upgrade from level-1) = cost * factor^(level-1). Units: cost * n. Demolish = price of current level / 2.
  function price(E, id, level, { n = 1, destroy = false } = {}) {
    const e = E[id] || {}; const out = {};
    for (const [r, v] of Object.entries(e.cost || {})) {
      if (!v) continue;
      let p = v;
      if (e.kind === 'building' || e.kind === 'research' || e.kind === 'officer') {
        if (e.factor && e.factor !== 1) p *= Math.pow(e.factor, level - 1);
      } else p *= n;
      if (destroy) p /= 2;
      out[r] = p;   // the page floors for display (pretty_number)
    }
    return out;
  }

  // getBuildingTime(): class.BuildFunctions.php:129-180. Returns SECONDS (floored, >= min_build_time).
  // kind 'building': robot=14 level, nanite=15 level. 'ship'/'defense': shipyard=21 level. 'research': lab = effective lab level.
  // gameSpeed = config game_speed (2500 = x1). No OGame "max(4 - L/2, 1)" divider for buildings.
  function buildTime(E, id, level, o = {}) {
    const cfg = Object.assign({}, C, o.config || {});
    const f = o.factor || factors();
    const e = E[id] || {};
    const p = o.price || price(E, id, level, { n: o.n || 1, destroy: !!o.destroy });
    const cst = (p[901] || 0) + (p[902] || 0);
    let h = 0;
    if (e.kind === 'building') h = cst / (cfg.game_speed * (1 + (o.robot || 0))) * Math.pow(0.5, o.nanite || 0) * (1 + f.BuildTime);
    else if (e.kind === 'ship') h = cst / (cfg.game_speed * (1 + (o.shipyard || 0))) * Math.pow(0.5, o.nanite || 0) * (1 + f.ShipTime);
    else if (e.kind === 'defense' || e.kind === 'missile') h = cst / (cfg.game_speed * (1 + (o.shipyard || 0))) * Math.pow(0.5, o.nanite || 0) * (1 + f.DefensiveTime);
    else if (e.kind === 'research') h = cst / (1000 * (1 + (o.lab || 0))) / (cfg.game_speed / 2500)
      * Math.pow(1 - cfg.factor_university / 100, o.university || 0) * (1 + f.ResearchTime);
    const s = Math.floor(h * (o.destroy ? 1300 : 3600));     // demolish uses 1300 instead of 3600 (:173-177)
    return Math.max(s, cfg.min_build_time);
  }
  // Effective lab level for research `id` (class.BuildFunctions.php:158-168 + class.PlanetRessUpdate.php:186-209):
  // labs = [current planet lab, ...up to IRN(123) other labs sorted desc]; sum the labs whose level >= the research's lab requirement.
  function effectiveLab(E, id, currentLab, otherLabs = [], irnLevel = 0) {
    const req = ((E[id] || {}).requirements || {})[31] || 0;
    const list = [currentLab, ...otherLabs.slice().sort((a, b) => b - a).slice(0, irnLevel)];
    return list.reduce((s, l) => s + (l >= req ? l : 0), 0);
  }

  // ---------------------------------------------------------------- production & storage
  // ProdGrid formulas: install/install.sql:948-996 (UPSTREAM, reproduced EXACTLY on REAL resources.html, see verify.js).
  // L = level, p = production setting 0..10 (10 = 100 %), Tmax = planet temp_max, eT = Energy Technology (113).
  const PROD = {
    1: { 901: (L, p) => 30 * L * 1.1 ** L * 0.1 * p, 911: (L, p) => -10 * L * 1.1 ** L * 0.1 * p },
    2: { 902: (L, p) => 20 * L * 1.1 ** L * 0.1 * p, 911: (L, p) => -10 * L * 1.1 ** L * 0.1 * p },
    3: { 903: (L, p, T) => 10 * L * 1.1 ** L * (-0.002 * T + 1.28) * 0.1 * p, 911: (L, p) => -30 * L * 1.1 ** L * 0.1 * p },
    4: { 911: (L, p) => 20 * L * 1.1 ** L * 0.1 * p },
    12: { 903: (L, p) => -10 * L * 1.1 ** L * 0.1 * p, 911: (L, p, T, eT) => 30 * L * (1.05 + eT * 0.01) ** L * 0.1 * p },
    212: { 911: (L, p, T) => (T + 160) / 6 * 0.1 * p * L },   // per satellite, NOT floored
  };
  // floor(2.5 * 1.8331954764^L) * 5000  (= OGame 5000*floor(2.5*e^(20L/33))), install.sql:957-959
  const storageBase = (L) => Math.floor(2.5 * Math.pow(1.8331954764, L)) * 5000;

  // ResourceUpdate::ReBuildCache + ExecCalc: includes/classes/class.PlanetRessUpdate.php:141-306.
  // planet: { type: 1|3, tempMax, levels: {1,2,3,4,12,22,23,24,212}, pct: {1:10,...}, stock: {901,902,903} }
  // user:   { research: {113,131,132,133}, factor }
  function production(planet, user = {}, cfgIn = {}) {
    const cfg = Object.assign({}, C, cfgIn);
    const f = user.factor || factors();
    const r = user.research || {};
    const lv = planet.levels || {}, pct = planet.pct || {}, stock = planet.stock || {};
    const T = planet.tempMax || 0;
    const t = { 901: { plus: 0, minus: 0 }, 902: { plus: 0, minus: 0 }, 903: { plus: 0, minus: 0 }, 911: { plus: 0, minus: 0 } };
    const rows = {};
    for (const [pid, grid] of Object.entries(PROD)) {
      const L = lv[pid] || 0, p = pct[pid] == null ? 10 : pct[pid];
      rows[pid] = {};
      for (const [rid, fn] of Object.entries(grid)) {
        const v = fn(L, p, T, r[113] || 0);
        rows[pid][rid] = v;
        if (v > 0) t[rid].plus += v;
        else if (rid !== '911' && !(stock[rid] > 0)) continue;   // consumption of a resource with 0 stock is ignored (:268-270)
        else t[rid].minus += v;
      }
    }
    const isMoon = planet.type === 3;
    const storageF = cfg.storage_multiplier * (1 + f.ResourceStorage);
    const max = {
      901: storageBase(lv[22] || 0) * storageF, 902: storageBase(lv[23] || 0) * storageF, 903: storageBase(lv[24] || 0) * storageF,
    };
    const energy = Math.round(t[911].plus * cfg.energySpeed * (1 + f.Energy));
    const energyUsed = t[911].minus * cfg.energySpeed;
    const prodLevel = energyUsed === 0 ? 0 : Math.min(1, energy / Math.abs(energyUsed));
    const research = { 901: r[131] || 0, 902: r[132] || 0, 903: r[133] || 0 };
    const perHourMines = {}, basic = {}, perHour = {}, bonus = {};
    for (const id of [901, 902, 903]) {
      perHourMines[id] = energyUsed === 0 ? 0
        : (t[id].plus * (1 + f.Resource + 0.02 * research[id]) * prodLevel + t[id].minus) * cfg.resource_multiplier;
      basic[id] = isMoon ? 0 : cfg[['metal', 'crystal', 'deuterium'][id - 901] + '_basic_income'] * cfg.resource_multiplier;
      perHour[id] = isMoon ? 0 : perHourMines[id] + basic[id];       // moons never produce (ExecCalc :143-144)
      // page=resources "Bonus (Officers/Bonus)" row (ShowResourcesPage.class.php:186-191) — uses the pct-scaled, prodLevel-scaled plus
      bonus[id] = t[id].plus * prodLevel * cfg.resource_multiplier * (f.Resource + 0.02 * research[id]);
    }
    bonus[911] = t[911].plus * cfg.energySpeed * f.Energy;
    return { perHour, perHourMines, basic, bonus, energy, energyUsed, energyBalance: energy + energyUsed, prodLevel, max,
      limit: { 901: max[901] * cfg.max_overflow, 902: max[902] * cfg.max_overflow, 903: max[903] * cfg.max_overflow }, rows };
  }
  // Stock after `sec` seconds (ExecCalc :141-182): grows only while stock <= limit, capped at limit; negative production always applies, floor 0.
  function amountAt(amount, perHour, limit, sec) {
    const d = sec * perHour / 3600;
    if (d < 0) return Math.max(amount + d, 0);
    if (amount <= limit) return Math.min(amount + d, limit);
    return amount;
  }

  // ---------------------------------------------------------------- planets, slots
  const maxFields = (fieldMax, terraformer = 0, moonBase = 0) => fieldMax + terraformer * FIELDS_BY_TERRAFORMER + moonBase * FIELDS_BY_MOONBASIS_LEVEL; // GeneralFunctions.php:185-189
  // PlayerUtil::maxPlanetCount (classes/PlayerUtil.class.php:567-587); astro = Expedition Research 124
  function maxPlanets(astro, f = factors(), cfgIn = {}) {
    const cfg = Object.assign({}, C, cfgIn);
    const tech = cfg.min_player_planets == 0 ? 999 : cfg.planets_tech, bonus = cfg.min_player_planets == 0 ? 999 : cfg.planets_officier;
    return Math.ceil(cfg.min_player_planets + Math.min(tech, astro * cfg.planets_per_tech) + Math.min(bonus, f.Planets));
  }
  const fleetSlots = (computer, f = factors()) => 1 + computer + f.FleetSlots;          // class.FleetFunctions.php:129-133
  const expeditionSlots = (astro) => Math.floor(Math.sqrt(astro));                    // class.FleetFunctions.php:67-70 (no class/officer bonus)
  const expeditionHours = (astro, cfgIn = {}) => Array.from({ length: astro }, (_, i) => Math.round((i + 1) / Object.assign({}, C, cfgIn).halt_speed * 100) / 100); // :186-191
  const holdHours = [1, 2, 4, 8, 12, 16, 32];                                         // mission 5 (:196-199)
  // colony temp/fields table: includes/PlanetData.php:19-33, index = ceil(pos / (max_planets/15)); temp_min = temp_max - 40;
  // fields = floor(rand(fields) * planet_factor); diameter = floor(1000 * sqrt(fields)). (PlayerUtil.class.php:238-252)
  const PLANET_DATA = { 1: [220, 260, 95, 108], 2: [170, 210, 97, 110], 3: [120, 160, 98, 137], 4: [70, 110, 123, 203], 5: [60, 100, 148, 210],
    6: [50, 90, 148, 226], 7: [40, 80, 141, 273], 8: [30, 70, 169, 246], 9: [20, 60, 161, 238], 10: [10, 50, 154, 224], 11: [0, 40, 148, 204],
    12: [-10, 30, 136, 171], 13: [-50, -10, 109, 121], 14: [-90, -50, 81, 93], 15: [-130, -90, 65, 74] }; // [tMaxLo, tMaxHi, fieldsLo, fieldsHi]

  // ---------------------------------------------------------------- flight (see fleet.md §4, verified on REAL numbers)
  // class.FleetFunctions.php:87-99: NO donut wrap, no empty-system skipping.
  function distance(a, b) {
    if (a.g != b.g) return Math.abs(a.g - b.g) * 20000;
    if (a.s != b.s) return Math.abs(a.s - b.s) * 95 + 2700;
    if (a.p != b.p) return Math.abs(a.p - b.p) * 5 + 1000;
    return 5;
  }
  // GetShipSpeed (:34-65). speedTech 1 combustion(115) 2 impulse(117) 3 hyperspace(118); 4 = 202 rule, 5 = 211 rule.
  // UPSTREAM reads only $pricelist[id]['speed'] (= vars.speed1) for every drive; vars.speed2 is display-only
  // (ShowInformationPage.class.php:280-281). So Light Cargo 202 at impulse >= 5 = 5000 x (1 + 0.2 x impulse), NOT 10000-based.
  function shipSpeed(E, id, r = {}) {
    const e = E[id] || {}; let t = e.speedTech; const base = e.speed || 0;
    if (t === 4) t = (r[117] || 0) >= 5 ? 2 : 1;
    if (t === 5) t = (r[118] || 0) >= 8 ? 3 : 2;
    if (t === 1) return base * (1 + 0.1 * (r[115] || 0));
    if (t === 2) return base * (1 + 0.2 * (r[117] || 0));
    if (t === 3) return base * (1 + 0.3 * (r[118] || 0));
    return 0;
  }
  const shipConsumption = (E, id, r = {}) => ((r[117] || 0) >= 5 && id == 202) || ((r[118] || 0) >= 8 && id == 211) ? E[id].consumption2 : E[id].consumption; // :22-27
  // GetMissionDuration (:101-114): speed10 = 1..10, gameSpeedFactor = fleet_speed/2500, flyFactor = 1 + FlyTime factor
  const duration = (speed10, maxSpeed, dist, gameSpeedFactor, flyTime = 0) =>
    Math.max(((3500 / (speed10 * 0.1)) * Math.sqrt(dist * 10 / maxSpeed) + 10) / gameSpeedFactor * Math.max(0, 1 + flyTime), MIN_FLEET_TIME);
  // GetFleetConsumption (:162-176): ships = {id: {n, speed, consumption}}
  function consumption(ships, sec, dist, gameSpeedFactor) {
    let c = 0;
    for (const s of Object.values(ships)) {
      const spd = 35000 / (Math.round(sec) * gameSpeedFactor - 10) * Math.sqrt(dist * 10 / s.speed);
      c += s.consumption * s.n * dist / 35000 * (spd / 10 + 1) ** 2;
    }
    return Math.round(c) + 1;
  }
  const cargo = (E, ships, f = factors()) => Object.entries(ships).reduce((s, [id, n]) => s + (E[id].capacity || 0) * n, 0) * (1 + f.ShipStorage); // ShowFleetStep1Page.class.php:45-50
  const missileRange = (impulse) => Math.max(impulse * 5 - 1, 0);                 // class.FleetFunctions.php:77-80
  const mipDuration = (dSystems, fleetSpeed = C.fleet_speed) => Math.max(Math.round((30 + 60 * dSystems) / (fleetSpeed / 2500)), MIN_FLEET_TIME); // :116-122
  const phalanxRange = (L) => (L == 1 ? 1 : L * L - 1);                           // ShowPhalanxPage.class.php:38-41 (own galaxy only, costs 5000 deut)
  const siloCapacity = (L, cfgIn = {}) => L * 10 * Math.max(Object.assign({}, C, cfgIn).silo_factor, 1); // interceptor = 1 slot, IPM = 2 (class.BuildFunctions.php:221-250)

  // ---------------------------------------------------------------- combat (calculateAttack.php:19-314, "xnova" aggregate engine)
  // side = [{ techs: {109, 110, 111}, factor, unit: {id: n} }, ...]  (ACS: several fleets per side)
  // rng() in [0,1); randInt mimics PHP rand(a,b). Pass rng = () => 0.5 for a deterministic "expected" run (still not an average!).
  function battle(E, attackersIn, defendersIn, { fleetDebrisPct = C.Fleet_Cdr, defDebrisPct = C.Defs_Cdr, rng = Math.random, rounds = MAX_ATTACK_ROUNDS } = {}) {
    const randInt = (a, b) => a + Math.floor(rng() * (b - a + 1));
    const att = attackersIn.map((x) => ({ ...x, unit: { ...x.unit }, factor: x.factor || factors() }));
    const def = defendersIn.map((x) => ({ ...x, unit: { ...x.unit }, factor: x.factor || factors() }));
    const c9 = (id, r) => (cost(E, id)[r] || 0);
    const ARES = { 901: 0, 902: 0 }, DRES = { 901: 0, 902: 0 }, TRES = { a: 0, d: 0 }, START = {};
    for (const a of att) for (const [id, n] of Object.entries(a.unit)) { ARES[901] += c9(id, 901) * n; ARES[902] += c9(id, 902) * n; }
    TRES.a = ARES[901] + ARES[902];
    for (const d of def) for (const [id, n] of Object.entries(d.unit)) {
      if (+id < 300) { DRES[901] += c9(id, 901) * n; DRES[902] += c9(id, 902) * n; } else START[id] = (START[id] || 0) + n;
      TRES.d += (c9(id, 901) + c9(id, 902)) * n;
    }
    const RF = {};   // RF[target][shooter] = shots
    for (const [e, x] of Object.entries(E)) for (const [t, sd] of Object.entries((x.rapidfire && x.rapidfire.to) || {})) if (sd) (RF[t] = RF[t] || {})[e] = sd;
    const log = []; let aAmt, dAmt;
    const stats = (side, isDef) => {
      const dmg = { total: 0 }, shd = { total: 0 }, amt = { total: 0 }, arr = [];
      side.forEach((s, i) => {
        const tech = [1 + 0.1 * (s.techs[109] || 0) + s.factor.Attack, 1 + 0.1 * (s.techs[110] || 0) + s.factor.Defensive, 1 + 0.1 * (s.techs[111] || 0) + s.factor.Shield];
        dmg[i] = shd[i] = amt[i] = 0; arr[i] = {};
        for (const [id, n] of Object.entries(s.unit)) {
          let a = n * (E[id].attack || 0) * tech[0] * (randInt(80, 120) / 100);
          if (isDef && (id == 407 || id == 408 || id == 409)) a = 0;
          const sh = n * (E[id].shield || 0) * tech[1], hull = n * mc(E, id) / 10 * tech[2];
          arr[i][id] = { att: a, def: sh, shield: hull };
          dmg[i] += a; dmg.total += a; shd[i] += sh; shd.total += sh; amt[i] += n; amt.total += n;
        }
      });
      return { dmg, shd, amt, arr };
    };
    for (let R = 0; R <= rounds; R++) {
      const A = stats(att, false), D = stats(def, true);
      aAmt = A.amt; dAmt = D.amt;
      log.push({ attackers: att.map((s) => ({ ...s.unit })), defenders: def.map((s) => ({ ...s.unit })) });
      if (R >= rounds || dAmt.total <= 0 || aAmt.total <= 0) break;
      const aPct = att.map((_, i) => aAmt[i] / aAmt.total), dPct = def.map((_, i) => dAmt[i] / dAmt.total);
      const hit = (side, own, ownAmt, ownPct, enemyDmgTotal, enemy, enemyArr, enemyAmt) => side.map((s, i) => {
        const out = {};
        for (const [id, n] of Object.entries(s.unit)) {
          if (n <= 0) { out[id] = 0; continue; }
          let moc = n * (enemyDmgTotal * ownPct[i]) / ownAmt[i];
          for (const [shooter, shots] of Object.entries(RF[id] || {})) enemyArr.forEach((ea, j) => {
            if (!(ea[shooter] && ea[shooter].att) || ownAmt[i] <= 0) return;
            moc += ea[shooter].att * shots / (n / ownAmt[i] * ownPct[i]);
            enemyAmt.total += (enemy[j].unit[shooter] || 0) * shots;
          });
          const u = own[i][id];
          if (u.def / n >= moc) { out[id] = Math.round(n); continue; }
          const maxRemove = Math.floor(n * enemyAmt.total / ownAmt[i] * ownPct[i]);
          moc -= Math.min(u.def, moc);
          const kill = Math.max(Math.min(maxRemove, n * Math.min(moc / u.shield * (randInt(0, 200) / 100), 1)), 0);
          out[id] = Math.max(Math.ceil(n - kill), 0);
        }
        return out;
      });
      const aN = hit(att, A.arr, aAmt, aPct, D.dmg.total, def, D.arr, dAmt);
      const dN = hit(def, D.arr, dAmt, dPct, A.dmg.total, att, A.arr, aAmt);
      att.forEach((s, i) => { s.unit = Object.fromEntries(Object.entries(aN[i]).map(([k, v]) => [k, Math.round(v)])); });
      def.forEach((s, i) => { s.unit = Object.fromEntries(Object.entries(dN[i]).map(([k, v]) => [k, Math.round(v)])); });
    }
    const won = aAmt.total <= 0 && dAmt.total > 0 ? 'r' : aAmt.total > 0 && dAmt.total <= 0 ? 'a' : 'w';
    for (const a of att) for (const [id, n] of Object.entries(a.unit)) { TRES.a -= mc(E, id) * n; ARES[901] -= c9(id, 901) * n; ARES[902] -= c9(id, 902) * n; }
    const DD = { 901: 0, 902: 0 }; const rebuilt = {};
    for (const d of def) for (const [id, n] of Object.entries(d.unit)) {
      TRES.d -= mc(E, id) * n;
      if (+id < 300) { DRES[901] -= c9(id, 901) * n; DRES[902] -= c9(id, 902) * n; continue; }
      const lost = START[id] - n, back = Math.round(lost * (randInt(56, 84) / 100));   // per defense TYPE, 56..84 %
      d.unit[id] += back; rebuilt[id] = (rebuilt[id] || 0) + back;
      DD[901] += c9(id, 901) * (lost - back); DD[902] += c9(id, 902) * (lost - back);
    }
    for (const o of [ARES, DRES]) { o[901] = Math.max(o[901], 0); o[902] = Math.max(o[902], 0); }
    const debris = {
      901: ARES[901] * fleetDebrisPct / 100 + DRES[901] * fleetDebrisPct / 100 + DD[901] * defDebrisPct / 100,
      902: ARES[902] * fleetDebrisPct / 100 + DRES[902] * fleetDebrisPct / 100 + DD[902] * defDebrisPct / 100,
    };
    return { won, rounds: log.length, attackers: att.map((s) => s.unit), defenders: def.map((s) => s.unit), rebuilt, debris,
      lost: { attacker: Math.max(TRES.a, 0), defender: Math.max(TRES.d, 0) }, log };
  }
  // Monte-Carlo wrapper: the engine has very high variance (kills x rand(0..2), damage x rand(0.8..1.2)).
  function simulate(E, attackers, defenders, opts = {}, runs = 50) {
    const res = []; for (let i = 0; i < runs; i++) res.push(battle(E, attackers, defenders, opts));
    const avg = (fn) => res.reduce((s, r) => s + fn(r), 0) / runs;
    return { runs, win: avg((r) => r.won === 'a'), draw: avg((r) => r.won === 'w'), loss: avg((r) => r.won === 'r'),
      debris: { 901: avg((r) => r.debris[901]), 902: avg((r) => r.debris[902]) },
      lostAttacker: avg((r) => r.lost.attacker), lostDefender: avg((r) => r.lost.defender) };
  }

  // ---------------------------------------------------------------- loot, debris, moon
  // calculateSteal(): missions/functions/calculateSteal.php:18-102. Only if the attacker WINS ('a'). 50 % of each resource max.
  // capacity = sum(capacity x n) x (1 + ShipStorage) - resources already carried.
  function loot(res, capacity) {
    const s = { 901: 0, 902: 0, 903: 0 }; let cap = capacity;
    if (cap <= 0) return s;
    s[901] = Math.min(cap / 3, res[901] / 2); cap -= s[901];
    s[902] = Math.min(cap / 2, res[902] / 2); cap -= s[902];
    s[903] = Math.min(cap, res[903] / 2); cap -= s[903];
    const old = s[901]; s[901] += Math.min(cap / 2, res[901] / 2 - s[901]); cap -= s[901] - old;
    s[902] += Math.min(cap, res[902] / 2 - s[902]);
    return s;
  }
  // MissionCaseAttack.class.php:340-352: only if the target is a planet without a moon. Moon created if mt_rand(1,100) <= chance.
  const moonChance = (debrisTotal, cfgIn = {}) => { const cfg = Object.assign({}, C, cfgIn); return Math.min(Math.round(debrisTotal / 100000 * cfg.moon_factor), cfg.moon_chance); };
  // PlayerUtil::createMoon (PlayerUtil.class.php:336-342): diameter from the CHANCE (%), not from debris; 1 field; temps = planet - rand(10..45)
  const moonDiameter = (chance, x /* 10..20 */) => Math.floor(Math.sqrt(x + 3 * chance) * 1000);
  // MissionCaseDestruction.class.php:355,406
  const moonDestroyChance = (diameter, rips) => Math.round((100 - Math.sqrt(diameter)) * Math.sqrt(rips) * 10) / 10;
  const ripLossChance = (diameter) => Math.round(Math.sqrt(diameter) / 2);

  // ---------------------------------------------------------------- espionage (MissionCaseSpy.class.php:75-111)
  function spy(probes, ownSpy, targetSpy, f = factors()) {
    const amount = probes * (1 + f.SpyPower);
    const s = Math.max(ownSpy, 1), t = Math.max(targetSpy, 1);
    const min = (s > t ? -1 : 1) * Math.pow(Math.abs(s - t) * SPY_DIFFENCE_FACTOR, 2);
    const X = Math.floor(Math.min(amount / 4 * (t / s), 100));          // mt_rand(0, X): X truncated to int
    return {
      resources: true, fleet: amount >= min, defense: amount >= min + 1 * SPY_VIEW_FACTOR,
      buildings: amount >= min + 3 * SPY_VIEW_FACTOR, research: amount >= min + 5 * SPY_VIEW_FACTOR,
      // destroyed if mt_rand(0,X) >= mt_rand(0,100)  ->  P = (X+2)/202 ; no combat, probes die, debris = probes cost x Fleet_Cdr %
      counterChance: (X + 2) / 202,
    };
  }

  // ---------------------------------------------------------------- expedition (MissionCaseExpedition.class.php:31-535)
  // GetEvent = mt_rand(1,9): 1 resources, 2 dark matter, 3 ships, 4 pirates/aliens, 5 FLEET LOST, 6 delay(75%)/early(25%), 7-9 nothing.
  const EXPEDITION_ODDS = { resources: 1 / 9, darkMatter: 1 / 9, ships: 1 / 9, battle: 1 / 9, fleetLost: 1 / 9, time: 1 / 9, nothing: 3 / 9 };
  const expeditionPoints = (E, ships) => Object.entries(ships).reduce((s, [id, n]) => s + mc(E, id) * 5 / 1000 * n, 0); // :40-53
  // Resources (:64-129): factor <= 200 always, so min(maxFactor, max(200, factor)) = 200 -> found = min(freeCargo, 200 x points)
  // = min(freeCargo, total metal+crystal cost of the fleet). Type: metal 3/6, crystal 2/6, deuterium 1/6. No resource_multiplier.
  const expeditionResources = (E, ships, freeCargo) => Math.round(Math.min(freeCargo, 200 * expeditionPoints(E, ships)));
  // Dark matter (:130-146): 100..300 (90 %), 301..600 (10 %), 601..3000 (1 %); delivered on return.
  // Ships (:147-217): budget (metal+crystal) = max(round(size x min(points, top<5M ? 4500 : 6000)), 10000), size 10..50 / 52..100 / 102..200;
  //   only ship types already in the fleet, except 208/209/214, random counts.
  const expeditionShipBudget = (E, ships, size, topPoints) => Math.max(Math.round(size * Math.min(expeditionPoints(E, ships), topPoints < 5000000 ? 4500 : 6000)), 10000);

  // ---------------------------------------------------------------- missiles (calculateMIPAttack.php:18-59)
  // each IPM: 12000 x (1 + 0.1 x weapons); destroys whole units of the primary target first (structure (m+c)/10 x (1+0.1 x armour)), then the rest in order.
  function mip(E, missiles, interceptors, weapons, targetArmour, defense, primary) {
    let n = missiles - interceptors; const out = {};
    if (n <= 0) return out;
    let dmg = n * (E[503].attack || 12000) * (1 + 0.1 * weapons);
    const order = primary in defense ? [primary, ...Object.keys(defense).filter((k) => k != primary)] : Object.keys(defense);
    for (const id of order) {
      const sp = mc(E, id) * (1 + 0.1 * targetArmour) / 10;
      const k = Math.min(Math.floor(dmg / sp), defense[id]);
      dmg -= k * sp; out[id] = k;
      if (dmg <= 0) break;
    }
    return out;
  }

  // ---------------------------------------------------------------- misc
  // CheckNoobProtec (GeneralFunctions.php:271-304): off when noobprotection==0 (upstream default!)
  function noob(ownPoints, targetPoints, cfgIn = {}) {
    const c = Object.assign({}, C, cfgIn);
    if (!c.noobprotection || !c.noobprotectiontime || !c.noobprotectionmulti) return { noob: false, strong: false };
    return { noob: targetPoints <= c.noobprotectiontime && ownPoints > targetPoints * c.noobprotectionmulti,
      strong: ownPoints < c.noobprotectiontime && ownPoints * c.noobprotectionmulti < targetPoints };
  }
  const points = (resSpent, cfgIn = {}) => resSpent / Object.assign({}, C, cfgIn).stat_settings;   // class.statbuilder.php:188-254
  // Trader (ShowTraderPage.class.php:28-32): 1 unit of `buy` costs RATE[sell][buy] units of `sell`; fee darkmatter_cost_trader DM per trade.
  const TRADER_RATE = { 901: { 902: 2, 903: 4 }, 902: { 901: 0.5, 903: 2 }, 903: { 901: 0.25, 902: 0.5 } };

  const api = { UPSTREAM_CONFIG, AETERNUM_CONFIG, OFFICER_BONUS, DM_BONUS, PROD, PLANET_DATA, EXPEDITION_ODDS, TRADER_RATE,
    MIN_FLEET_TIME, MAX_ATTACK_ROUNDS, PHALANX_DEUTERIUM,
    factors, price, buildTime, effectiveLab, storageBase, production, amountAt, maxFields, maxPlanets, fleetSlots, expeditionSlots,
    expeditionHours, holdHours, distance, shipSpeed, shipConsumption, duration, consumption, cargo, missileRange, mipDuration, phalanxRange,
    siloCapacity, battle, simulate, loot, moonChance, moonDiameter, moonDestroyChance, ripLossChance, spy, expeditionPoints,
    expeditionResources, expeditionShipBudget, mip, noob, points };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.GZCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
