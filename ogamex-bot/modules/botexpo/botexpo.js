/* ogamex-bot/modules/botexpo/botexpo.js — «Бот: экспедиции и колонизация». Owner: module agent 5.
 * Contract: specs/bot/BOT_CONTRACT.md (C1, C2, C5 botexpo, C6 botexpo events, C8); algorithm: specs/bot/BOT_DESIGN.md §9 (F5, F6, F14, F16).
 *
 * Engine facts used here (re-checked in upstream 2Moons, scratchpad/src/2Moons):
 *   F5 [UPSTREAM MissionCaseExpedition.php:36-125] event = mt_rand(1,9): 1 resources, 2 dark matter, 3 ships, 4 battle, 5 black hole
 *      (whole fleet lost), 6 time, 7-9 nothing. Resource find = round(min(freeCargo, min(maxFactor, max(200, factor)) * fleetPoints))
 *      with factor <= 200, fleetPoints = sum((M+C)*5/1000): i.e. min(free BASE cargo, sum(M+C) of the fleet). Free cargo = pricelist
 *      capacity (no Storage expert) minus cargo on board (incl. dark matter). DM find 100..3000 whatever the fleet. The outcome message
 *      is category 15 dated at the stay end (:512), the return message (with the amounts) category 4 dated at the return (:530).
 *   F6 staytime option texts of fleetStep2 are hours (key / halt_speed): the option is chosen by its text, never by the key.
 *   F14 expedition slots come only from page=fleetTable («x / y expedition»).
 *   F16 step 2 of the fleet dispatch is a free probe: an empty position offers mission 7 (with a 208), position 16 offers 15.
 *   Colonisation [UPSTREAM MissionCaseColonisation.php:37-110, PlayerUtil.php:567-613]: position free + allowPlanetPosition (1/15 >= 8,
 *      2/14 >= 6, 3/13 >= 4, else >= 1 levels of 124) + planets < maxPlanetCount, else the ship returns; the cargo is unloaded on the
 *      new planet (StoreGoodsToPlanet); the report is category 4.
 *
 * Worker 'botexpo' (prio fleet): one expedition fleet per run. Every run re-reads page=fleetTable of the origin (slots + ships), sends
 * min(expedition slots free, fleet slots free - botcore.slotsReserve) fleets per round with betweenMinSec..betweenMaxSec between them,
 * then waits for the first expedition return + afterReturnMinSec..afterReturnMaxSec (bot:fleet-returned wakes it); a free slot that
 * cannot be used is retried after 4-6 min. A wake before the planned time (bot:fleet-returned of ANY fleet, e.g. botfarm raids) does not
 * re-read the slots unless an expedition came back or the settings changed; a run that sends nothing backs off 60 s doubling to 10 min
 * (expoGate / idleDelay); dry-run starts a new (journal-only) round at most every 5 min. EV of the round (OGX.botSim.expedition) -> journal expo-ev. Modes: dm (default, one
 * cheapest ship per slot: 210 when step 2 offers mission 15 for it, else 202), resources (Battle Transporters 217 only — John's
 * rule for every resource carrier, no fallback; sized fleetShare of the origin's 217 split over the slots, + 1x210 when
 * addCheapTypes; never loaded), auto (the higher EV per
 * slot-hour, tie -> dm). Target own system :16, mission 15, speed 100 %, staytime option whose hour text equals stayHours (else the
 * smallest). Results: messages cat 15 (outcome) and cat 4 (amounts) when botcore.readMessages -> expo-result + botexpo.stats.
 * Worker 'botexpo:colonize' (prio fleet, only with colonize on): targets from colonizeTargets, allowed positions by 124, planet count
 * from #countColonies minus colonizers in flight, emptiness by probe.target (no galaxy view), blacklist with TTL, mission 7 with one
 * 208 and payload fleetroom - fuel (metal then crystal), result via the planet list / cat 4 message, optional colonizer build.
 * Every game request goes through wctx.act (C1); a wctx.decide precedes every action. Code comments English, user text Russian. */
window.OGX = window.OGX || {};
(function (OGX) {
  'use strict';
  const NAME = 'botexpo';
  const COL_ID = 'botexpo:colonize';
  const SEC = 'Бот: экспедиции и колонизация';
  const RES = ['metal', 'crystal', 'deuterium'];
  const H = 3600000;
  const DAY = 24 * H;
  const EXPO_POS = 16;                       // max_planets + 1 (15 + 1 on Aeternum)
  const PROBE_TTL = 6 * H;                   // probe.target answers (missions/staytime options) are reused this long
  const DM_SHIPS = [210, 202];               // mode dm: cheapest first [SPEC §6]
  const CARGO_SHIPS = [(OGX.catalog && OGX.catalog.transportShip) || 217];   // mode resources: Battle Transporters only (John's rule)
  const OUTCOMES = ['resources', 'darkMatter', 'ships', 'battle', 'blackHole', 'time', 'nothing', 'unknown'];
  const OUTCOME_RU = { resources: 'ресурсы', darkMatter: 'тёмная материя', ships: 'корабли', battle: 'бой', blackHole: 'чёрная дыра', time: 'сдвиг времени', nothing: 'ничего', unknown: 'не распознано' };
  const MAX_PROBES_PER_RUN = 5;
  const IDLE_MIN = 60000;                    // a run that sent nothing: next read not before 60 s, doubling per idle run ...
  const IDLE_MAX = 10 * 60000;               // ... up to 10 min (any wake — e.g. every bot:fleet-returned of botfarm — waits too)
  const DRY_PLAN_GAP = 5 * 60000;            // dry-run: a new round (the same plan journaled again) at most every 5 min
  const DM_ID = 'botexpo:dm';
  const SEC_DM = 'Бот: поиск тёмной материи';
  const DM_SHIP = 220;                       // «Сборщик Тёмной материи» (Dark Matter Collector)
  // GALAXYZ is War of Galaxyz / Xterium (github BrowserGameScriptz/2moons-xterium, MissionCaseFoundDM): chance = min(30, 15 + 0.25 x ships) %
  // (max at 60 ships; vanilla 2Moons 30/0.25/50), a success scraps the collectors; the amount on Aeternum is unknown (vanilla 423..1278).
  // Mission 11 = own moon + only 220, limit max_dm_missions (server config, NOT shown: the fleetTable counter «x / y Asteroids» is
  // mission 16, asteroid mining = 4 + asteroid tech / 5). The bot assumes 5 and learns a lower limit from a step-3 refusal.
  const DM_RULE = { base: 15, perShip: 0.25, max: 30, findMin: 423, findMax: 1278 };
  const DM_LIMIT_GUESS = 5;
  const LEARN_DEFAULT = [{ ships: { 210: 1 } }, { ships: { 210: 100 } }, { ships: { 210: 2000 } }, { ships: { 210: 10000 } }, { ships: { 210: 1 }, stay: 2 }];

  const SETTINGS = {
    on: { type: 'bool', default: true, label: 'Экспедиции и колонизация включены', section: SEC },
    expeditions: { type: 'bool', default: true, label: 'Отправлять экспедиции', section: SEC },
    mode: { type: 'enum', default: 'dm', label: 'Режим экспедиций', section: SEC,
      options: [{ value: 'dm', label: 'Тёмная материя — зонды (число ниже) в каждый слот' }, { value: 'learn', label: 'Подбор состава — бот сам ищет флот, дающий больше всего ТМ в час (по результатам)' }, { value: 'auto', label: 'Авто — выбирать по ожиданию за слот-час (формулы 2Moons)' }, { value: 'resources', label: 'Ресурсы — грузовые корабли (находка ресурсов)' }] },
    expoProbes: { type: 'int', default: 5000, min: 1, max: 100000000, label: 'Режим «Тёмная материя»: зондов в одной экспедиции (ТМ растёт с очками флота; нет столько — сколько есть сверх резерва)', section: SEC },
    learnFleets: { type: 'json', default: LEARN_DEFAULT, label: 'Подбор состава: варианты флота (JSON [{"ships":{"210":100},"stay":1}]; stay — часы удержания)', section: SEC },
    learnMinTrips: { type: 'int', default: 8, min: 1, max: 200, label: 'Подбор состава: полётов на каждый вариант до выбора лучшего', section: SEC },
    learnExplore: { type: 'float', default: 0.1, min: 0, max: 1, step: 0.05, label: 'Подбор состава: доля проверочных полётов других вариантов после выбора', section: SEC },
    keepProbes: { type: 'int', default: 2000, min: 0, label: 'Не брать в экспедиции последние N зондов тела (для шпионажа)', section: SEC },
    probeBuild: { type: 'bool', default: true, label: 'Достраивать зонды (210) на планете старта: чёрная дыра забирает весь флот экспедиции', section: SEC },
    probeStock: { type: 'int', default: 0, min: 0, max: 1000000000, label: 'Держать зондов на планете старта (дома + в экспедициях; 0 = 2 × слоты экспедиций × зондов в экспедиции + резерв для шпионажа)', section: SEC },
    fleetShare: { type: 'float', default: 0.1, min: 0, max: 1, step: 0.05, label: 'Доля грузового флота в экспедициях (режим «Ресурсы»)', section: SEC },
    ships: { type: 'json', default: [], label: 'Типы кораблей для режима «Ресурсы» (JSON; разрешён только 217 «Улучшенный транспорт», пусто = 217)', section: SEC },
    addCheapTypes: { type: 'bool', default: true, label: 'Режим «Ресурсы»: добавлять 1 зонд (находка кораблей)', section: SEC },
    stayHours: { type: 'float', default: 1, min: 0, max: 100, step: 0.5, label: 'Удержание экспедиции (ч, по тексту варианта; нет такого — минимальное)', section: SEC },
    origins: { type: 'json', default: [], label: 'Точки старта (JSON: id или координаты тел; пусто = автоматически)', section: SEC },
    betweenMinSec: { type: 'int', default: 5, min: 0, max: 600, label: 'Пауза между флотами, мин. (с)', section: SEC },
    betweenMaxSec: { type: 'int', default: 15, min: 0, max: 600, label: 'Пауза между флотами, макс. (с)', section: SEC },
    afterReturnMinSec: { type: 'int', default: 3, min: 0, max: 3600, label: 'Новый раунд после возврата, мин. (с)', section: SEC },
    afterReturnMaxSec: { type: 'int', default: 15, min: 0, max: 7200, label: 'Новый раунд после возврата, макс. (с)', section: SEC },
    dmValueMsu: { type: 'float', default: 0, min: 0, label: 'Цена 1 ТМ в металлическом эквиваленте (для режима auto)', section: SEC },
    colonize: { type: 'bool', default: true, label: 'Колонизировать', section: SEC },
    colonizeTargets: { type: 'json', default: [], label: 'Цели колонизации (JSON: [{"galaxy":2,"systems":[60,80],"positions":[8,7,9,6,10]}])', section: SEC },
    colonizeMinFields: { type: 'json', default: {}, label: 'Мин. полей по позиции (JSON {"8":200}; меньше — только запись в журнал)', section: SEC },
    colonizePayload: { type: 'bool', default: true, label: 'Загружать колонизатор ресурсами (металл, затем кристалл)', section: SEC },
    buildColonizers: { type: 'bool', default: true, label: 'Строить колонизатор, если его нет', section: SEC },
    dmHunt: { type: 'bool', default: true, label: 'Поиск ТМ сборщиками (миссия 11: только «Сборщики ТМ» 220 на свою луну)', section: SEC_DM },
    dmShipsPerFleet: { type: 'int', default: 60, min: 1, max: 1000000, label: 'Сборщиков в одном флоте, не больше (шанс 15 % + 0,25 % за корабль, максимум 30 % при 60)', section: SEC_DM },
    dmMaxFleets: { type: 'int', default: 0, min: 0, max: 50, label: 'Флотов поиска ТМ одновременно (0 = 5, меньше — если сервер откажет)', section: SEC_DM },
    dmTargets: { type: 'json', default: [], label: 'Цели поиска ТМ (JSON: id или координаты своих лун; пусто = все свои луны)', section: SEC_DM },
    dmBuild: { type: 'bool', default: true, label: 'Строить «Сборщики ТМ» (220), чтобы их хватало', section: SEC_DM },
    dmStock: { type: 'int', default: 400, min: 0, max: 1000000, label: 'Держать сборщиков на планете старта (дома + в полёте)', section: SEC_DM },
  };

  // ------------------------------------------------------------------ small helpers (pure)
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const num = (v, d = 0) => (v === undefined || v === null || v === '' || !Number.isFinite(+v) ? d : +v);
  const fmtN = (n) => { try { return OGX.fmt.short(n); } catch (e) { return String(Math.round(n)); } };
  const fmtT = (ms) => { try { return OGX.fmt.time(ms); } catch (e) { return '—'; } };
  const errText = (e) => (e && e.message ? e.message : String(e));
  const isMoon = (b) => !!b && (b.type === 'moon' || /^m/.test(String(b.key || '')));
  const shipSum = (s) => Object.values(s || {}).reduce((a, n) => a + (+n || 0), 0);
  function coordsOf(x) {
    if (!x) return null;
    if (typeof x === 'string') { const m = /(\d+):(\d+):(\d+)/.exec(x); return m ? m[1] + ':' + m[2] + ':' + m[3] : null; }
    if (Array.isArray(x)) return x.length >= 3 ? x.slice(0, 3).join(':') : null;
    const p = x.position !== undefined ? x.position : x.planet;
    return +x.galaxy > 0 ? [+x.galaxy, +x.system, +p].join(':') : null;
  }
  function targetOf(coords, type = 1) { const a = String(coords).split(':').map(Number); return { galaxy: a[0], system: a[1], position: a[2], type }; }
  function expoTarget(originCoords) { const a = String(originCoords).split(':').map(Number); return { galaxy: a[0], system: a[1], position: EXPO_POS, type: 1 }; }
  function shipsLabel(ships) { return Object.entries(ships || {}).filter(([, n]) => +n > 0).map(([id, n]) => n + '×' + id).join(', ') || '—'; }

  /** Upstream allowPlanetPosition: 1/15 need 124 >= 8, 2/14 >= 6, 3/13 >= 4, every other position >= 1 (maxPlanets = 15). */
  function allowedPosition(position, astro, maxPlanets = 15) {
    const p = +position; const a = +astro || 0;
    if (!(p >= 1 && p <= maxPlanets)) return false;
    if (p === 1 || p === maxPlanets) return a >= 8;
    if (p === 2 || p === maxPlanets - 1) return a >= 6;
    if (p === 3 || p === maxPlanets - 2) return a >= 4;
    return a >= 1;
  }
  /**
   * The staytime option to use: the one whose hour text equals `hours` (float compare), else the smallest by hours. Options are the
   * fleetStep2 `<select name=staytime>` entries { value, hours } (hours = the option text, F6). Returns { option, exact } or null.
   */
  function pickStay(options, hours) {
    const list = (options || []).filter((o) => o && Number.isFinite(+o.hours));
    if (!list.length) return null;
    const exact = list.find((o) => Math.abs(+o.hours - +hours) < 1e-6);
    if (exact) return { option: exact, exact: true };
    return { option: list.slice().sort((a, b) => a.hours - b.hours || a.value - b.value)[0], exact: false };
  }
  /** Expedition slots to fill now: min(expedition slots free, fleet slots free - reserve), never below 0. */
  function slotsToSend(slots, reserve) {
    if (!slots || !slots.fleet || !slots.expedition) return { n: 0, expFree: 0, fleetFree: 0 };
    const expFree = Math.max(0, num(slots.expedition.max) - num(slots.expedition.used));
    const fleetFree = Math.max(0, num(slots.fleet.max) - num(slots.fleet.used) - Math.max(0, num(reserve)));
    return { n: Math.min(expFree, fleetFree), expFree, fleetFree };
  }
  /** Catalog price/cargo of a ship: { metal, crystal, deuterium, cargo }. */
  function shipInfo(id, cat) {
    let c = null;
    try { c = cat ? cat(id) : (OGX.catalog && OGX.catalog.get(+id)); } catch (e) { c = null; }
    if (!c) return null;
    const p = c.price || {};
    return { id: +id, metal: num(p.metal), crystal: num(p.crystal), deuterium: num(p.deuterium), cargo: num(c.props && c.props.cargo), speed: num(c.props && c.props.speed) };
  }
  /** Mode dm: the cheapest flyable ship present (210 when step 2 offered mission 15 for it, else 202). */
  function dmShip(have, { probeOk = {}, cat } = {}) {
    for (const id of DM_SHIPS) {
      if (num(have[id]) < 1) continue;
      if (probeOk[id] === false) continue;
      const i = shipInfo(id, cat);
      if (i && i.speed > 0) return id;
    }
    return null;
  }
  /** Mode dm: expoProbes probes per slot (Aeternum: expedition DM grows with the fleet points), the last keepProbes stay home for
   *  spying — a body below the reserve sends nothing (null → the «нет кораблей» skip; probeBuild restores the stock), never a single
   *  probe out of the reserve. Another ship (step 2 did not offer mission 15 to a probe): one ship — the documented 1×202 fallback. */
  function dmComposition(have, { want = 5000, keep = 2000, probeOk = {}, cat } = {}) {
    const id = dmShip(have || {}, { probeOk, cat });
    if (!id) return null;
    if (id !== 210) return { [id]: 1 };
    const w = Math.max(1, Math.floor(num(want, 5000)));
    const free = Math.floor(num(have[210]) - Math.max(0, num(keep, 2000)));
    if (free < 1) return null;
    return { 210: Math.min(w, free) };
  }
  /**
   * Mode resources: Battle Transporters 217 only (a user's list is cut to them: no other resource carrier), sized
   * floor(count x share / slots), plus 1 x 210 when present (addCheapTypes, probes are exempt) for ship finds; never any cargo on board.
   */
  function resourcesFleet(have, { share = 0.1, slots = 1, ids = null, addCheap = true, cat } = {}) {
    const n = Math.max(1, Math.floor(num(slots, 1)));
    const list = Array.isArray(ids) && ids.length ? ids.map(Number).filter((id) => CARGO_SHIPS.includes(id)) : CARGO_SHIPS.slice();
    const out = {};
    for (const id of list) {
      const c = Math.floor(num(have[id]));
      const k = Math.floor(c * Math.max(0, num(share)) / n);
      if (k > 0) out[id] = k;
    }
    if (!Object.keys(out).length) return null;
    if (addCheap) {
      if (num(have[210]) >= 1 && !out[210]) out[210] = 1;
    }
    return out;
  }
  /** Outcome name of messages.parse.expedition -> stats bucket. */
  function outcomeOf(parsed) {
    const o = String((parsed && (parsed.outcome || parsed.key)) || '').toLowerCase();
    if (/fleet_lost|loss_of_fleet|black/.test(o)) return 'blackHole';
    if (/^resources|gain_resources/.test(o)) return 'resources';
    if (/dark/.test(o)) return 'darkMatter';
    if (/ships/.test(o)) return 'ships';
    if (/battle|pirate|alien/.test(o)) return 'battle';
    if (/delay|speedup/.test(o)) return 'time';
    if (/nothing|failed/.test(o)) return 'nothing';
    return 'unknown';
  }
  function emptyStats() {
    const outcomes = {}; for (const k of OUTCOMES) outcomes[k] = 0;
    return { trips: 0, outcomes, finds: [], found: { metal: 0, crystal: 0, deuterium: 0 }, dm: 0, shipsFound: {}, lostShips: {}, since: null, last: null };
  }
  /** Adds one classified result to the stats (pure; returns the stats). */
  function addOutcome(stats, trip, outcome) {
    stats.trips += 1;
    stats.outcomes[outcome] = (stats.outcomes[outcome] || 0) + 1;
    if (outcome === 'blackHole') for (const [id, n] of Object.entries(trip.ships || {})) stats.lostShips[id] = (stats.lostShips[id] || 0) + n;
    stats.last = trip.stayEnd || null;
    if (!stats.since) stats.since = trip.sentAt || null;
    return stats;
  }
  /** Adds the amounts of a return message (resources found compared with min(free cargo, sum(M+C)) = F5). */
  function addAmounts(stats, trip, amounts) {
    const got = num(amounts.metal) + num(amounts.crystal) + num(amounts.deuterium);
    for (const r of RES) stats.found[r] += num(amounts[r]);
    stats.dm += num(amounts.darkMatter);
    if (trip.outcome === 'resources') {
      const exp = trip.expectedFind || null;
      stats.finds.push({ t: trip.back || null, got, expected: exp ? exp.max : null, free: exp ? exp.free : null, sumMC: exp ? 200 * exp.points : null,
        ratio: exp && exp.max > 0 ? got / exp.max : null, ships: trip.ships });
      if (stats.finds.length > 100) stats.finds = stats.finds.slice(-100);
    }
    if (trip.outcome === 'ships' && trip.foundShips) for (const [id, n] of Object.entries(trip.foundShips)) stats.shipsFound[id] = (stats.shipsFound[id] || 0) + n;
    return stats;
  }
  /** Colonisation candidates in target order: [{ coords, position }] (allowed by 124, not own, not blacklisted). */
  function colonizeCandidates(targets, { astro, own = new Set(), black = {}, now = 0, maxPlanets = 15, limit = 50 } = {}) {
    const out = [];
    for (const t of Array.isArray(targets) ? targets : []) {
      if (!t) continue;
      let list = [];
      if (typeof t === 'string') { const c = coordsOf(t); if (c) list = [c]; }
      else if (+t.galaxy > 0 && (t.position !== undefined || t.planet !== undefined) && t.systems === undefined) list = [coordsOf(t)];
      else if (+t.galaxy > 0) {
        const sys = Array.isArray(t.systems) ? t.systems : [num(t.system, 1), num(t.system, 1)];
        const a = Math.max(1, Math.min(num(sys[0], 1), num(sys[1], sys[0]))); const b = Math.max(num(sys[0], 1), num(sys[1], sys[0]));
        const pos = Array.isArray(t.positions) && t.positions.length ? t.positions : [8, 7, 9, 6, 10];
        for (let s = a; s <= b && list.length < limit * 4; s++) for (const p of pos) list.push([+t.galaxy, s, +p].join(':'));
      }
      for (const c of list) {
        if (!c) continue;
        const p = +c.split(':')[2];
        if (!allowedPosition(p, astro, maxPlanets)) continue;
        if (own.has(c)) continue;
        const bl = black[c];
        if (bl && bl.until > now) continue;
        if (out.some((x) => x.coords === c)) continue;
        out.push({ coords: c, position: p });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }
  /** Colonizer payload: room = fleetroom - fuel, filled metal then crystal (StoreGoodsToPlanet [UPSTREAM]). */
  function colonizePayload(room, avail) {
    const r = Math.max(0, Math.floor(num(room)));
    const metal = Math.min(r, Math.max(0, Math.floor(num(avail && avail.metal))));
    const crystal = Math.min(r - metal, Math.max(0, Math.floor(num(avail && avail.crystal))));
    return { metal, crystal, deuterium: 0 };
  }

  // ------------------------------------------------------------------ learn mode (pure): which expedition fleet brings the most DM per hour
  /** Normalised candidate list: [{ key, ships: { id: n }, stay }] (bad entries dropped; key = '100x210@1h'). */
  function learnCandidates(list) {
    let a = list;
    if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { a = null; } }
    if (!Array.isArray(a) || !a.length) a = LEARN_DEFAULT;
    const out = [];
    for (const c of a) {
      if (!c || typeof c !== 'object') continue;
      const src = c.ships && typeof c.ships === 'object' ? c.ships : c;
      const ships = {};
      for (const [id, n] of Object.entries(src)) if (/^\d+$/.test(id) && Math.floor(num(n)) > 0) ships[+id] = Math.floor(num(n));
      if (!Object.keys(ships).length) continue;
      const stay = num(c.stay, 1) > 0 ? num(c.stay, 1) : 1;
      const key = Object.entries(ships).sort((x, y) => +x[0] - +y[0]).map(([id, n]) => n + 'x' + id).join('+') + '@' + stay + 'h';
      if (!out.some((x) => x.key === key)) out.push({ key, ships, stay });
    }
    return out;
  }
  /** Probes to hold on an origin (home + in expeditions): the setting, else 2 x expedition slots x probes per slot + keep (spare for black holes). */
  function probeTarget({ stock = 0, slots = 0, perSlot = 0, keep = 0 } = {}) {
    if (num(stock) > 0) return Math.floor(num(stock));
    return Math.max(0, 2 * Math.max(0, Math.floor(num(slots))) * Math.max(0, Math.floor(num(perSlot))) + Math.max(0, Math.floor(num(keep))));
  }
  /** DM per hour of a learn bucket { trips, dm, hours } (null without trips). */
  function learnRate(b) { return b && b.trips > 0 && b.hours > 0 ? b.dm / b.hours : null; }
  /**
   * The candidate for the next expedition: the feasible ones (enough ships on the body above keep) with fewer than minTrips results
   * first (fewest tried), else the best DM per hour, except an `explore` share of trips on another feasible candidate.
   * -> { cand, key, why, phase: 'explore' | 'best' | 'check' } | null
   */
  function learnPick(cands, stats, have, { minTrips = 8, explore = 0.1, rnd = Math.random, keep = {}, pending = {} } = {}) {
    const ok = cands.filter((c) => Object.entries(c.ships).every(([id, n]) => num(have[id]) - num(keep[id]) >= n));
    if (!ok.length) return null;
    const b = (c) => (stats && stats[c.key]) || { trips: 0, dm: 0, hours: 0 };
    // trips still in flight count as tried, so the slots of one round test different candidates
    const tried = (c) => b(c).trips + num(pending[c.key]);
    const young = ok.filter((c) => tried(c) < minTrips).sort((x, y) => tried(x) - tried(y) || cands.indexOf(x) - cands.indexOf(y));
    if (young.length) return { cand: young[0], key: young[0].key, phase: 'explore', why: `проверка варианта (${b(young[0]).trips} из ${minTrips} полётов, в полёте ${num(pending[young[0].key])})` };
    const ranked = ok.slice().sort((x, y) => (learnRate(b(y)) || 0) - (learnRate(b(x)) || 0));
    const best = ranked[0];
    if (ranked.length > 1 && rnd() < explore) {
      const other = ranked[1 + Math.floor(rnd() * (ranked.length - 1))];
      return { cand: other, key: other.key, phase: 'check', why: 'контрольный полёт другого варианта' };
    }
    return { cand: best, key: best.key, phase: 'best', why: `лучший вариант: ${(learnRate(b(best)) || 0).toFixed(1)} ТМ/ч за ${b(best).trips} полётов` };
  }
  /** Adds one finished trip to a learn bucket (pure; returns the stats object). */
  function learnAdd(stats, key, { dm = 0, hours = 1, lost = false } = {}) {
    if (!key) return stats;
    const b = stats[key] || (stats[key] = { trips: 0, dm: 0, hours: 0, lost: 0 });
    b.trips += 1; b.dm += Math.max(0, num(dm)); b.hours += Math.max(1 / 60, num(hours, 1)); if (lost) b.lost = num(b.lost) + 1;
    return stats;
  }

  // ------------------------------------------------------------------ DM search with collectors (pure)
  /** Chance (0..1) of a DM find for a fleet of n ships [UPSTREAM MissionCaseFoundDM]. */
  function dmChance(n, rule = DM_RULE) { return num(n) > 0 ? Math.min(rule.max, rule.base + num(n) * rule.perShip) / 100 : 0; }
  /**
   * Split `have` collectors over at most `fleets` fleets of at most `perFleet` ships: a fleet slot alone is worth the base chance
   * (15 %), an extra ship only 0.25 %, so every fleet gets at least one ship, the rest is shared evenly. -> [n1, n2, ...] (largest first)
   */
  function allocateCollectors(have, fleets, perFleet = 60) {
    const h = Math.max(0, Math.floor(num(have)));
    const cap = Math.max(1, Math.floor(num(perFleet, 60)));
    const k = Math.max(0, Math.min(Math.floor(num(fleets)), h));
    if (!k) return [];
    const use = Math.min(h, k * cap);
    const base = Math.floor(use / k);
    return Array.from({ length: k }, (_, i) => base + (i < use - base * k ? 1 : 0));
  }
  /** Expected DM of a fleet of n collectors. */
  function dmExpected(n, rule = DM_RULE) { return dmChance(n, rule) * (rule.findMin + rule.findMax) / 2; }
  /** DM amount in the text of a fleet message ('... 1.234 Тёмная материя' or 'Dark Matter 1.234'), else null. */
  function dmFromText(text) {
    const t = String(text || '').replace(/\s+/g, ' ');
    const m = /(?:т[её]мн\S* матери\S*|dark matter|ТМ)\D{0,12}?(\d[\d.,\s]*\d|\d)/i.exec(t) || /(\d[\d.,\s]*\d|\d)\s*(?:единиц\S* )?(?:т[её]мн\S* матери|dark matter)/i.exec(t);
    if (!m) return null;
    const n = +m[1].replace(/[.,\s]/g, '');
    return Number.isFinite(n) ? n : null;
  }
  /** Positive increments of the DM counter (top bar) within the last `windowMs`: { gain, hours, perHour } | null. */
  function dmGain(samples, now, windowMs = DAY) {
    const s = (samples || []).filter((x) => x && x.t >= now - windowMs && Number.isFinite(+x.dm)).sort((a, b) => a.t - b.t);
    if (s.length < 2) return null;
    let gain = 0;
    for (let i = 1; i < s.length; i++) if (s[i].dm > s[i - 1].dm) gain += s[i].dm - s[i - 1].dm;
    const hours = (s[s.length - 1].t - s[0].t) / H;
    return { gain, hours, perHour: hours > 0 ? gain / hours : null };
  }

  // ------------------------------------------------------------------ module state (leader tab; persisted in ctx.store)
  const M = {
    ctx: null, loaded: false, handle: null, colHandle: null,
    trips: {}, stats: emptyStats(), meta: {}, colo: {}, black: {}, dm: {}, dmStats: null, dmState: null, dmHandle: null,
    lastRun: null, lastColRun: null, settingsAt: 0, stepSent: false, lastSlots: null, lastEv: null, colState: null,
  };
  async function load() {
    if (M.loaded) return;
    const st = M.ctx.store;
    const [t, s, m, c, b, d, ds] = await Promise.all([st.get('trips', {}), st.get('stats', null), st.get('meta', {}), st.get('colo', {}), st.get('black', {}), st.get('dm', {}), st.get('dmStats', null)]);
    M.dm = d && typeof d === 'object' ? d : {};
    M.dmStats = ds && typeof ds === 'object' ? ds : null;
    M.trips = t && typeof t === 'object' ? t : {};
    M.stats = s && typeof s === 'object' && s.outcomes ? Object.assign(emptyStats(), s) : emptyStats();
    M.meta = m && typeof m === 'object' ? m : {};
    M.colo = c && typeof c === 'object' ? c : {};
    M.black = b && typeof b === 'object' ? b : {};
    M.lastEv = M.meta.lastEv || null;
    M.loaded = true;
  }
  async function save() {
    const st = M.ctx.store;
    const t = OGX.time.serverNow();
    for (const [k, x] of Object.entries(M.trips)) if (x.done && t - (x.back || x.sentAt || 0) > 7 * DAY) delete M.trips[k];
    for (const [k, x] of Object.entries(M.colo)) if (x.done && t - (x.arrival || x.sentAt || 0) > 7 * DAY) delete M.colo[k];
    for (const [k, x] of Object.entries(M.black)) if (!(x.until > t)) delete M.black[k];
    for (const [k, x] of Object.entries(M.dm || {})) if (x.done && t - (x.back || x.sentAt || 0) > 2 * DAY) delete M.dm[k];
    M.meta.lastEv = M.lastEv;
    await st.set('trips', clone(M.trips));
    await st.set('stats', clone(M.stats));
    await st.set('meta', clone(M.meta));
    await st.set('colo', clone(M.colo));
    await st.set('black', clone(M.black));
    await st.set('dm', clone(M.dm || {}));
    await st.set('dmStats', clone(M.dmStats));
  }

  // ------------------------------------------------------------------ data helpers
  function bodyById(bodies, id) { return Object.values(bodies).find((b) => +b.id === +id) || null; }
  function bodyByRef(bodies, ref) {
    if (ref === null || ref === undefined || ref === '') return null;
    const s = String(ref).trim();
    if (/^\d+$/.test(s)) return bodyById(bodies, +s);
    const c = coordsOf(s);
    if (!c) return bodies[s] || null;
    const wantMoon = /moon|луна|\(m\)|:3$/i.test(s);
    return Object.values(bodies).find((b) => b.coords === c && isMoon(b) === wantMoon) || Object.values(bodies).find((b) => b.coords === c) || null;
  }
  /** Origins: the user's list (ids / coords) or every body in planet-list order (state ships with the wanted types first). */
  function originList(bodies, cfg, wanted) {
    let refs = cfg;
    if (typeof refs === 'string') { try { refs = JSON.parse(refs); } catch (e) { refs = refs.split(/[,;\s]+/); } }
    const list = Array.isArray(refs) && refs.length ? refs.map((r) => bodyByRef(bodies, r)).filter(Boolean) : Object.values(bodies).sort((a, b) => num(a.order, 999) - num(b.order, 999));
    const seen = new Set();
    const uniq = list.filter((b) => b && b.coords && !seen.has(b.key) && seen.add(b.key));
    if (Array.isArray(refs) && refs.length) return uniq;
    const score = (b) => (b.ships ? wanted.reduce((s, id) => s + (num(b.ships[id]) > 0 ? 1 : 0), 0) : 0.5);
    return uniq.map((b, i) => ({ b, i, s: score(b) })).sort((x, y) => y.s - x.s || x.i - y.i).map((x) => x.b);
  }
  async function researchLevels() {
    try { const r = await OGX.state.research(); return (r && r.levels) || {}; } catch (e) { return {}; }
  }
  async function topPoints() {
    try { const t = await OGX.storage.get('topScore', null, { scope: 'server' }); if (t && +t.points > 0) return +t.points; } catch (e) { /* none */ }
    return 1000000;
  }
  function flight(from, to, ships) {
    try { const f = OGX.bot.flightTime({ from, to, ships, speed: 10 }); return Number.isFinite(f.duration) ? f : { duration: 0, fuel: 0, distance: f.distance }; } catch (e) { return { duration: 0, fuel: 0, distance: null }; }
  }
  /** decide + read.fleetTable of a body: { ships: { id: n }, slots, flights } | null. */
  async function readFleetTable(wctx, body, why, { fresh = false } = {}) {
    wctx.decide(`Читаю флот и слоты на ${body.coords}${isMoon(body) ? ' (луна)' : ''}`, { why, inputs: { bodyId: body.id }, chosen: 'read.fleetTable', alternatives: [] });
    const r = await wctx.act(Object.assign({ type: 'read.fleetTable', bodyId: body.id, prio: 'read', params: {}, why: 'Экспедиции: слоты и корабли на ' + body.coords }, fresh ? { fresh: true } : {}));
    if (!r || !r.ok || !r.data || !r.data.fleetTable) return null;
    const ft = r.data.fleetTable;
    sampleDm(wctx.now(), r.data.doc);
    const ships = {};
    for (const s of ft.ships || []) if (+s.count > 0) ships[s.id] = +s.count;
    const slots = ft.slots ? { fleet: { used: +ft.slots.used, max: +ft.slots.max }, expedition: ft.expeditions ? { used: +ft.expeditions.used, max: +ft.expeditions.max } : { used: 0, max: 0 } } : null;
    // GALAXYZ prints a third counter «x / y Asteroids» = asteroid mining (mission 16), kept for the journal only
    const ast = (ft.extraCounters || []).find((c) => c && /asteroid|астероид/i.test(c.label || '')) || (ft.extraCounters || [])[0] || null;
    if (slots && ast && Number.isFinite(+ast.max)) slots.asteroids = { used: +ast.used, max: +ast.max };
    if (slots) M.lastSlots = Object.assign({ t: wctx.now() }, slots);
    // returning expeditions of this body confirm / correct the return time of our trips (a «сдвиг времени» seen before its report)
    noteFleetRows(wctx, body, ft.flights || []);
    return { t: wctx.now(), ships, slots, flights: ft.flights || [] };
  }
  const VIEW_MS = 60000;                     // a view derived from the last send serves the next fleet of the round this long
  /** The fleet table after a send, without a page read: the sent ships gone, the fleet slot (and the expedition slot) taken. */
  function viewAfterSend(ft, comp, { expedition = false, t = 0 } = {}) {
    const ships = Object.assign({}, (ft && ft.ships) || {});
    for (const [id, k] of Object.entries(comp || {})) { ships[id] = Math.max(0, num(ships[id]) - num(k)); if (!ships[id]) delete ships[id]; }
    let slots = null;
    if (ft && ft.slots) {
      slots = { fleet: { used: num(ft.slots.fleet.used) + 1, max: num(ft.slots.fleet.max) },
        expedition: { used: num(ft.slots.expedition && ft.slots.expedition.used) + (expedition ? 1 : 0), max: num(ft.slots.expedition && ft.slots.expedition.max) } };
      if (ft.slots.asteroids) slots.asteroids = ft.slots.asteroids;
    }
    return { t: t || (ft && ft.t) || 0, ships, slots, flights: (ft && ft.flights) || [], view: true };
  }
  /** The view kept after the last successful send (M.view / M.dmView) of body o, while younger than VIEW_MS; null = read the page. */
  function viewOf(v, o, now, roundId) {
    if (!v || !v.ok || !v.ft || !v.ft.slots || +v.originId !== +o.id || !(now - v.t < VIEW_MS)) return null;
    if (roundId !== undefined && v.round !== roundId) return null;
    return v.ft;
  }
  /** After a 'limit' refusal of botcore: the reopen time of the hit limit (bot.status().limitsHit) + 2..10 s, else 4-6 min. */
  function limitRetryAt(wctx) {
    let at = 0;
    try { for (const l of OGX.bot.status().limitsHit || []) if (l && (l.limit === 'fleetSends' || l.limit === 'actions') && +l.reopensAt > at) at = +l.reopensAt; } catch (e) { at = 0; }
    const now = wctx.now();
    if (at > now) return Math.min(at, now + H) + OGX.bot.randMs([2000, 10000]);
    return now + OGX.bot.randMs(OGX.bot.INTERVALS.m6);
  }
  /** DM counter of the top bar of a page read by the bot -> M.meta.dmSamples (one sample per 5 min, 48 h kept). */
  function sampleDm(t, doc) {
    let dm = null;
    try { dm = doc && OGX.parse && OGX.parse.gz ? OGX.parse.gz.resources(doc).darkmatter : null; } catch (e) { dm = null; }
    if (!Number.isFinite(+dm) || dm === null) return;
    const list = Array.isArray(M.meta.dmSamples) ? M.meta.dmSamples : (M.meta.dmSamples = []);
    const last = list[list.length - 1];
    if (last && t - last.t < 5 * 60000 && last.dm === +dm) return;
    if (last && t - last.t < 5 * 60000) list.pop();
    list.push({ t, dm: +dm });
    while (list.length && list[0].t < t - 2 * DAY) list.shift();
    if (list.length > 700) list.splice(0, list.length - 700);
  }
  /** read.messages of a category. The core may answer from its read cache: a list read before notBefore (ServerMs, the moment the
   *  awaited message exists) is read again with fresh: true; fresh: true (a retry) never takes the cached list. */
  async function readMessages(wctx, cat, why, { fresh = false, notBefore = 0 } = {}) {
    let r = await wctx.act({ type: 'read.messages', prio: 'read', fresh: !!fresh, params: { cat }, why });
    if (!fresh && notBefore && r && r.ok && !r.dry && +r.at > 0 && +r.at < notBefore) r = await wctx.act({ type: 'read.messages', prio: 'read', fresh: true, params: { cat }, why });
    return r;
  }
  /** probe.target (fleetTable + steps 1-2, no step 3; free, allowed in dry-run but skipped there so dry-run posts nothing). */
  async function probe(wctx, body, target, ships, why, prio = 'read') {
    wctx.decide(`Проверяю цель [${coordsOf(target)}] шагом 2 отправки`, { why, inputs: { origin: body.id, ships, target }, chosen: 'probe.target', alternatives: ['просмотр галактики (стоит дейтерий)'] });
    const r = await wctx.act({ type: 'probe.target', bodyId: body.id, prio, params: { ships, target, speed: 10 }, why: 'Проверка цели [' + coordsOf(target) + ']' });
    return r;
  }

  // ------------------------------------------------------------------ expeditions: EV
  async function evFor(wctx, fleet, { stayHours, durationSec, levels, top, seed }) {
    if (!fleet || !OGX.botSim || !OGX.botSim.expedition) return null;
    const rates = { c: num(wctx.core('rateC'), 1.5), d: num(wctx.core('rateD'), 3) };
    let attackerTech = { weapons: num(levels[109]), shielding: num(levels[110]), armour: num(levels[111]) };
    if (!levels[109] && !levels[110] && !levels[111]) {
      try { const b = await OGX.state.combatBonus(); if (b) attackerTech = { bonusPct: { attack: num(b.attack), defense: num(b.defense), shield: num(b.shield) } }; } catch (e) { /* none */ }
    }
    let e;
    try { e = OGX.botSim.expedition({ ships: fleet, cargoOnBoard: 0, topPoints: top, attackerTech, runs: 300, seed, stayHours, rates }); } catch (x) { return { error: errText(x) }; }
    const dmValue = num(wctx.cfg('dmValueMsu'));
    const perTrip = e.ev.msu + e.ev.dm * dmValue;
    const tripH = Math.max(1 / 60, (2 * num(durationSec) + num(stayHours) * 3600) / 3600);
    return { fleet, perTrip, perSlotHour: perTrip / tripH, tripHours: tripH, evMsu: e.ev.msu, evDm: e.ev.dm, dmValue,
      find: { max: e.find.max, capByCargo: e.find.capByCargo, capByPoints: e.find.capByPoints, expectedMsu: e.find.expected.msu },
      shipsMsu: e.shipsFound.msu, battleMsu: e.battleLoss.expectedMsu, blackHoleMsu: e.blackHoleLoss.msu / 9, fleetMsu: e.fleetValue.msu, probs: e.probs };
  }
  const evShort = (e) => (e ? { perTrip: Math.round(e.perTrip), perSlotHour: Math.round(e.perSlotHour), evMsu: Math.round(e.evMsu), evDm: Math.round(e.evDm), fleetMsu: Math.round(e.fleetMsu), findMax: e.find ? e.find.max : null } : null);

  // ------------------------------------------------------------------ expeditions: results (messages)
  // GALAXYZ (2Moons includes/common.php) runs the fleet handler only for requests WITHOUT ajax=1, and the bot reads messages with
  // ajax=1: the bot's own reads never create the report of a stay end (cat 15, dated fleet_end_stay) or of a return (cat 4, dated
  // fleet_end_time). A report is therefore read only after a full-page request made after its event (botcore's lastPageAt: the
  // step's fleetTable GET, a build order, this page's own load; after RESULT_FORCE_MS without one the module reads the origin's
  // fleetTable itself), first RESULT_DELAY after the event, retried RESULT_RETRY x tries later, at most RESULT_TRIES times within
  // RESULT_WINDOW; a trip whose report never shows up is closed as unread (counted apart, never «flying» forever).
  const RESULT_DELAY = 20000;
  const RESULT_RETRY = 30000;
  const RESULT_TRIES = 6;
  const RESULT_WINDOW = 15 * 60000;
  const RESULT_FORCE_MS = 45000;            // no full-page request this long after the event: the module makes one
  const MATCH_MS = 5000;                     // message date (1-s resolution) vs the trip's event time
  const PAGE_SKEW_MS = 2000;                 // lastPageAt is the estimated server time (about ±1 s): a page counts only this long after the event
  function liveTrips() { return Object.values(M.trips).filter((x) => !x.dry); }
  /** ServerMs of the last full-page request known: botcore's (bot.lastPageAt) or this page's own load; 0 = unknown (no page rule). */
  function lastPageAt() {
    let t = 0;
    try { if (OGX.bot && typeof OGX.bot.lastPageAt === 'function') t = Math.max(t, num(OGX.bot.lastPageAt())); } catch (e) { /* none */ }
    try {
      if (typeof performance !== 'undefined' && performance && +performance.timeOrigin > 0 && OGX.time && OGX.time.serverNow) t = Math.max(t, OGX.time.serverNow() - (Date.now() - +performance.timeOrigin));
    } catch (e) { /* no page clock */ }
    return t;
  }
  /**
   * Pure: is the report of an event (stayEnd for cat 15, back for cat 4) to be read now? tries / nextAt = reads so far and the planned
   * retry, pageAt = last full-page request (0 = unknown, no page rule). -> { read, force (read the origin's fleetTable first), giveUp,
   * nextAt (the next check) }
   */
  function resultDue({ eventAt, tries = 0, nextAt = 0, now, pageAt = 0 }) {
    if (!(eventAt > 0)) return { read: false, force: false, giveUp: false, nextAt: null };
    if (num(tries) >= RESULT_TRIES || now > eventAt + RESULT_WINDOW) return { read: false, force: false, giveUp: true, nextAt: null };
    const at = Math.max(num(nextAt), eventAt + RESULT_DELAY);
    if (now < at) return { read: false, force: false, giveUp: false, nextAt: at };
    if (pageAt > 0 && pageAt < eventAt + PAGE_SKEW_MS) {
      // no full-page request since the event: the report does not exist yet — wait for one, after RESULT_FORCE_MS make one
      if (now >= eventAt + RESULT_FORCE_MS) return { read: true, force: true, giveUp: false, nextAt: at };
      return { read: false, force: false, giveUp: false, nextAt: Math.min(now + RESULT_RETRY, eventAt + RESULT_FORCE_MS) };
    }
    return { read: true, force: false, giveUp: false, nextAt: at };
  }
  /** Pure: messages (ascending date) assigned to trips, each message to the nearest trip within MATCH_MS of timeOf(trip), so a missing
   *  report never lets a trip claim its neighbour's; extra(trip, msg) may widen the match. -> Map(trip -> message) */
  function assignByTime(rows, trips, timeOf, extra) {
    const out = new Map();
    for (const r of rows.slice().sort((a, b) => a.ts - b.ts)) {
      let best = null; let bd = Infinity;
      for (const x of trips) {
        if (out.has(x)) continue;
        const d = Math.abs(r.ts - timeOf(x));
        if ((d <= MATCH_MS || (extra && extra(x, r))) && d < bd) { best = x; bd = d; }
      }
      if (best) out.set(best, r);
    }
    return out;
  }
  /** Upstream MissionCaseExpedition event 6 («сдвиг времени»): a delay returns at end_stay + back leg + stay + 2..5 s (fleet_start_time
   *  is the arrival, so the stay is the pure stay); a speed-up sets fleet_end_time = max(1, …): the fleet lands at the next run of the
   *  fleet handler. -> { back, tol, kind } */
  function shiftedBack(x, raw, now) {
    const backLeg = x.back && x.stayEnd ? Math.max(0, x.back - x.stayEnd) : 0;
    const stay = x.stayEnd && x.arrival ? Math.max(0, x.stayEnd - x.arrival) : Math.round(num(x.stayHours, 1) * H);
    if (/speed|fast/i.test(String(raw || ''))) return { back: Math.max(num(now), num(x.stayEnd)) + 1000, tol: 120000, kind: 'speedup' };
    return { back: num(x.stayEnd) + backLeg + stay + 2000, tol: 5000, kind: 'delay' };
  }
  /** A read at t that showed no report of an event counts as a miss when the report had to exist: a full-page request after the event
   *  (or none known) and RESULT_DELAY passed — so the neighbour's read serves a trip too and no second read follows 5 s later. */
  const missedAt = (eventAt, t, pageAt) => t >= eventAt + RESULT_DELAY && (!(pageAt > 0) || pageAt >= eventAt + PAGE_SKEW_MS);
  function setBack(x, back, tol, kind) {
    x.backPlanned = x.backPlanned || x.back || null;
    x.back = back; x.backTol = tol; x.timeShift = kind; x.returnSeen = false; x.tries4 = 0; x.next4At = 0;
  }
  function applyTimeShift(wctx, x, raw) {
    const s = shiftedBack(x, raw, wctx.now());
    const old = x.back;
    setBack(x, s.back, s.tol, s.kind);
    wctx.rec('decision', `Экспедиция ${x.fleetId}: ${s.kind === 'delay' ? 'задержка' : 'ускорение'} — возврат ${fmtT(x.back)} вместо ${fmtT(old)}`,
      { why: 'сдвиг времени (2Moons: задержка = конец удержания + обратный путь + удержание + 2..5 с; ускорение = ближайшая обработка событий)',
        inputs: { fleetId: x.fleetId, raw, oldBack: old }, chosen: { back: x.back, tol: s.tol }, alternatives: [] });
  }
  /** page=fleetTable rows of returning expeditions (mission 15, «(R)», timerUnix = the server's return time) confirm or correct the
   *  return time of our trips: the exact back of a known trip, a delay seen before its report, the corrected back after one. */
  function noteFleetRows(wctx, body, flights) {
    const rows = (flights || []).filter((f) => f && +f.missionId === 15 && f.returning === true && +f.timerUnix > 0 && (!f.origin || !body || !body.coords || f.origin === body.coords))
      .map((f) => ({ t: +f.timerUnix * 1000, f }));
    if (!rows.length) return;
    const trips = liveTrips().filter((x) => !x.done && x.outcome !== 'blackHole' && x.back && (!body || x.origin === body.id)).sort((a, b) => a.back - b.back);
    const used = new Set();
    const pick = (t, tol) => { let best = null; let bd = Infinity; for (const r of rows) { if (used.has(r)) continue; const d = Math.abs(r.t - t); if (d <= tol && d < bd) { best = r; bd = d; } } return best; };
    // two passes: every row at a trip's expected return first, only the rows left may show a delay — so a trip that came home on time
    // never takes the row of its delayed neighbour (their shifted and real return times are seconds apart)
    const hit = new Map();
    for (const x of trips) { const r = pick(x.back, 20000); if (r) { used.add(r); hit.set(x, { r, shifted: false }); } }
    // the rows left go to the unmatched trips by the smallest distance to their shifted return (not in trip order)
    const pairs = [];
    for (const x of trips) {
      // only a trip that can still be delayed: no report yet, or a report that said «сдвиг времени» / an unknown text
      if (hit.has(x) || x.timeShift || (x.outcome && x.outcome !== 'time' && x.outcome !== 'unknown')) continue;
      const sb = shiftedBack(x, 'delay', wctx.now()).back;
      for (const r of rows) if (!used.has(r) && Math.abs(r.t - sb) <= 20000) pairs.push({ x, r, d: Math.abs(r.t - sb) });
    }
    for (const p of pairs.sort((a, b) => a.d - b.d)) if (!hit.has(p.x) && !used.has(p.r)) { used.add(p.r); hit.set(p.x, { r: p.r, shifted: true }); }
    for (const x of trips) {
      if (!hit.has(x)) continue;
      const { r, shifted } = hit.get(x);
      const old = x.back;
      if (shifted) {
        setBack(x, r.t, 5000, 'delay');
        x.shiftSeen = 'fleetTable';
        wctx.rec('decision', `Экспедиция ${x.fleetId}: по странице флота возврат ${fmtT(x.back)} вместо ${fmtT(old)} (задержка)`,
          { why: 'строка возвращающейся экспедиции на page=fleetTable', inputs: { fleetId: x.fleetId, oldBack: old }, chosen: { back: x.back }, alternatives: [] });
      } else if (Math.abs(r.t - x.back) > 1000) x.back = r.t;
      x.backConfirmed = true;
    }
  }
  function closeUnread(wctx, x, cat) {
    // no report (cat 15) but the fleet is still away or its return not read yet: the trip stays open for its return message (cat 4,
    // the found resources / DM); it is closed by that read or by the cat-4 give-up
    x.done = cat !== 15 || !x.back || !!x.amounts;
    if (cat === 15) { x.unread15 = true; M.stats.unread15 = num(M.stats.unread15) + 1; } else { x.unread4 = true; M.stats.unread4 = num(M.stats.unread4) + 1; }
    wctx.rec('expo-result', `Экспедиция ${x.fleetId} с ${x.originCoords}: ${cat === 15 ? 'отчёт' : 'сообщение о возврате'} не найдено за ${Math.round(RESULT_WINDOW / 60000)} мин (чтений: ${cat === 15 ? num(x.tries15) : num(x.tries4)})`,
      { fleetId: x.fleetId, unread: cat, outcome: x.outcome || null, tries: cat === 15 ? num(x.tries15) : num(x.tries4), ships: x.ships, stats: statsShort() });
  }
  /** Text of a message row (GALAXYZ: the body td; OgameX: the li), one line, 240 chars. */
  function msgText(it) {
    try {
      let el = null;
      if (it && it.body && it.body.textContent !== undefined) el = it.body;
      else if (it && it.li) el = it.li.nextElementSibling && /messages_body/.test(String(it.li.nextElementSibling.className || '')) ? it.li.nextElementSibling : it.li;
      return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240) : '';
    } catch (e) { return ''; }
  }
  /** An expedition text the texts table does not know: a learn line in the journal (once a day per text) so the table can be fixed. */
  function noteUnknownText(x, text, messageId) {
    if (!text) return;
    const key = text.slice(0, 80);
    const seen = M.meta.unknownTexts && typeof M.meta.unknownTexts === 'object' ? M.meta.unknownTexts : (M.meta.unknownTexts = {});
    const t = OGX.time.serverNow();
    for (const [k, v] of Object.entries(seen)) if (!(v > t - 7 * DAY)) delete seen[k];
    if (seen[key] > t - DAY) return;
    seen[key] = t;
    try { OGX.log.rec('L', 'botexpo:expedition-text', 'Неизвестный текст отчёта экспедиции: ' + text, { key: 'expedition-text-unknown:' + key, text, messageId, fleetId: x.fleetId, ships: x.ships }); } catch (e) { /* no journal */ }
  }
  /** No full-page request since the event for RESULT_FORCE_MS: one read of the origin's fleetTable (it runs the server's fleet
   *  handler and shows the fleet's real return time). */
  async function forcePage(wctx, x, why) {
    let body = null;
    try { body = bodyById(await wctx.bodies(), x.origin); } catch (e) { body = null; }
    if (body) await readFleetTable(wctx, body, why, { fresh: true });   // a cached answer would not reach the server
  }
  async function readResults(wctx) {
    const now = wctx.now();
    const canRead = wctx.core('readMessages') !== false;
    for (const x of liveTrips()) {
      if (x.done) continue;
      // nothing can be read: closed 60 s after the return; a safety net for very old trips (never «flying» forever)
      const end = x.back || (x.stayEnd ? x.stayEnd + H : null);
      if (!canRead && end && now > end + 60000) x.done = true;
      else if (x.sentAt && now - x.sentAt > 2 * DAY) x.done = true;
    }
    if (!canRead) return;
    const pageAt = lastPageAt();
    // cat 15: the outcome, dated at the stay end
    const plan15 = []; let force = null;
    for (const x of liveTrips()) {
      if (x.done || x.outcome || x.unread15 || !x.stayEnd) continue;
      const d = resultDue({ eventAt: x.stayEnd, tries: x.tries15, nextAt: x.next15At, now, pageAt });
      if (d.giveUp) closeUnread(wctx, x, 15);
      else if (d.read) { plan15.push(x); if (d.force && !force) force = x; }
    }
    if (plan15.length) {
      if (force) await forcePage(wctx, force, 'отчёт экспедиции появляется только после обычного (не ajax) запроса к серверу');
      wctx.decide('Читаю отчёты экспедиций', { why: 'узнать исход и проверить статистику (F5); отчёт есть только после обычного (не ajax) запроса', inputs: { fleets: plan15.map((x) => x.fleetId), pageAt }, chosen: 'read.messages cat 15', alternatives: [] });
      const r = await readMessages(wctx, 15, 'Экспедиции: отчёты', { fresh: plan15.some((x) => (x.tries15 || 0) > 0), notBefore: Math.max(...plan15.map((x) => num(x.stayEnd))) + 1000 });
      const t = wctx.now();
      const rows = [];
      if (r && r.ok && r.data && r.data.doc) {
        let items = [];
        try { items = OGX.messages.parse.list(r.data.doc) || []; } catch (e) { items = []; }
        const used = new Set(Object.values(M.trips).map((x) => x.msg15).filter(Boolean));
        for (const it of items) {
          if (!it || !it.ts || used.has(it.id)) continue;
          let p = null;
          try { p = OGX.messages.parse.expedition(it.li); } catch (e) { p = null; }
          rows.push({ id: it.id, ts: it.ts, parsed: p, it });
        }
      }
      // every unresolved trip whose stay ended may take a report (one read serves them all); a miss counts only for the planned ones
      const cands = liveTrips().filter((x) => !x.done && !x.outcome && !x.unread15 && x.stayEnd && x.stayEnd <= t + MATCH_MS).sort((a, b) => a.stayEnd - b.stayEnd);
      const hits = assignByTime(rows, cands, (x) => x.stayEnd);
      const page15 = lastPageAt();
      for (const x of cands) if (!hits.has(x) && (plan15.includes(x) || missedAt(x.stayEnd, t, page15))) { x.tries15 = (x.tries15 || 0) + 1; x.next15At = t + RESULT_RETRY * x.tries15; }
      for (const [x, hit] of hits) {
        x.msg15 = hit.id;
        x.outcome = outcomeOf(hit.parsed);
        x.outcomeRaw = hit.parsed ? hit.parsed.outcome || null : null;
        if (hit.parsed && hit.parsed.ships) x.foundShips = hit.parsed.ships;
        const text = x.outcome === 'unknown' ? msgText(hit.it) : null;
        if (text) noteUnknownText(x, text, hit.id);
        addOutcome(M.stats, x, x.outcome);
        if (x.outcome === 'blackHole') {
          x.done = true;
          if (x.learnKey) learnAdd(learnStats(), x.learnKey, { dm: 0, hours: x.back && x.sentAt ? (x.back - x.sentAt) / H : num(x.stayHours, 1), lost: true });
        } else if (x.amounts) x.done = true;   // the return was read before the report
        // a delay the fleet page showed already (x.back = the server's return time) is not shifted a second time
        if (x.outcome === 'time' && !x.shiftSeen) applyTimeShift(wctx, x, x.outcomeRaw);
        // the fleet page row was taken for a delay but the report says otherwise: back to the planned return
        if (x.outcome !== 'time' && x.shiftSeen && x.backPlanned) { x.back = x.backPlanned; x.backTol = 0; x.timeShift = null; x.shiftSeen = null; x.tries4 = 0; x.next4At = 0; }
        wctx.rec('expo-result', `Экспедиция ${x.fleetId} с ${x.originCoords}: ${OUTCOME_RU[x.outcome] || x.outcome}`,
          Object.assign({ fleetId: x.fleetId, outcome: x.outcome, raw: x.outcomeRaw, messageId: hit.id, ships: x.ships, foundShips: x.foundShips || null, stats: statsShort() }, text ? { text } : {}));
      }
    }
    // cat 4: the return with the amounts, dated at the return (the corrected one after a time shift); read even before the report
    const now4 = wctx.now();
    const page4 = Math.max(pageAt, lastPageAt());
    const plan4 = []; force = null;
    for (const x of liveTrips()) {
      if (x.done || x.outcome === 'blackHole' || x.amounts || !x.back) continue;
      const d = resultDue({ eventAt: x.back, tries: x.tries4, nextAt: x.next4At, now: now4, pageAt: page4 });
      if (d.giveUp) closeUnread(wctx, x, 4);
      else if (d.read) { plan4.push(x); if (d.force && !force) force = x; }
    }
    if (!plan4.length) return;
    if (force) await forcePage(wctx, force, 'сообщение о возврате появляется только после обычного (не ajax) запроса к серверу');
    wctx.decide('Читаю сообщения о возврате экспедиций', { why: 'найденные ресурсы и ТМ приходят в сообщении о возврате (кат. 4)', inputs: { fleets: plan4.map((x) => x.fleetId), pageAt: page4 }, chosen: 'read.messages cat 4', alternatives: [] });
    const r = await readMessages(wctx, 4, 'Экспедиции: возврат флота', { fresh: plan4.some((x) => (x.tries4 || 0) > 0), notBefore: Math.max(...plan4.map((x) => num(x.back))) + 1000 });
    const t = wctx.now();
    const rows = [];
    if (r && r.ok && r.data && r.data.doc) {
      let items = [];
      try { items = OGX.messages.parse.list(r.data.doc) || []; } catch (e) { items = []; }
      const used = new Set(Object.values(M.trips).map((x) => x.msg4).filter(Boolean));
      for (const it of items) {
        if (!it || !it.ts || used.has(it.id)) continue;
        if (it.kind && !/^return_expedition/.test(it.kind)) continue;
        let fm = null;
        try { fm = OGX.messages.parse.fleetMessage(it.li); } catch (e) { fm = null; }
        if (!fm) continue;
        const kind = fm.kind || it.kind || '';
        if (kind && !/^return_expedition/.test(kind)) continue;
        const raw = (fm.gz && fm.gz.resources) || {};
        const res = fm.resources || {};
        rows.push({ id: it.id, ts: it.ts, amounts: { metal: num(res.metal), crystal: num(res.crystal), deuterium: num(res.deuterium), darkMatter: num(raw[921]) } });
      }
    }
    const cands = liveTrips().filter((x) => !x.done && x.outcome !== 'blackHole' && !x.amounts && x.back && x.back <= t + MATCH_MS).sort((a, b) => a.back - b.back);
    // a time-shifted trip has its own tolerance; a sped-up fleet's message may carry the engine's bogus date (fleet_end_time = 1)
    const hits = assignByTime(rows, cands, (x) => x.back, (x, m) => (num(x.backTol) > MATCH_MS && Math.abs(m.ts - x.back) <= num(x.backTol)) || (x.timeShift === 'speedup' && m.ts < num(x.sentAt)));
    const page4b = lastPageAt();
    for (const x of cands) if (!hits.has(x) && (plan4.includes(x) || missedAt(x.back, t, page4b))) { x.tries4 = (x.tries4 || 0) + 1; x.next4At = t + RESULT_RETRY * x.tries4; }
    for (const [x, hit] of hits) {
      x.msg4 = hit.id;
      x.amounts = hit.amounts;
      // an outcome the texts table did not know: the amounts tell (a DM find / a resource find)
      if (x.outcome === 'unknown') {
        const by = num(hit.amounts.darkMatter) > 0 ? 'darkMatter' : num(hit.amounts.metal) + num(hit.amounts.crystal) + num(hit.amounts.deuterium) > 0 ? 'resources' : null;
        if (by) { M.stats.outcomes.unknown = Math.max(0, num(M.stats.outcomes.unknown) - 1); M.stats.outcomes[by] = num(M.stats.outcomes[by]) + 1; x.outcome = by; x.reclassified = true; }
      }
      addAmounts(M.stats, x, hit.amounts);
      x.done = !!x.outcome || !!x.unread15;   // without the report (cat 15 still pending) the trip stays open for it
      if (x.learnKey) learnAdd(learnStats(), x.learnKey, { dm: hit.amounts.darkMatter, hours: x.sentAt && hit.ts > x.sentAt ? (hit.ts - x.sentAt) / H : num(x.stayHours, 1) });
      const got = num(hit.amounts.metal) + num(hit.amounts.crystal) + num(hit.amounts.deuterium);
      const exp = x.expectedFind;
      wctx.rec('expo-result', `Экспедиция ${x.fleetId} вернулась: ${fmtN(hit.amounts.metal)} / ${fmtN(hit.amounts.crystal)} / ${fmtN(hit.amounts.deuterium)}, ТМ ${fmtN(hit.amounts.darkMatter)}`
        + (x.outcome === 'resources' && exp ? ` (по формуле 2Moons ${fmtN(exp.max)})` : '') + (x.reclassified ? ` — исход уточнён по возврату: ${OUTCOME_RU[x.outcome]}` : ''),
        { fleetId: x.fleetId, outcome: x.outcome, amounts: hit.amounts, messageId: hit.id, expectedFind: exp || null, reclassified: !!x.reclassified,
          f5: x.outcome === 'resources' && exp ? { got, expected: exp.max, match: got === exp.max } : null, stats: statsShort() });
    }
  }
  function learnStats() { if (!M.meta.learn || typeof M.meta.learn !== 'object') M.meta.learn = {}; return M.meta.learn; }
  /** Learn buckets sorted by DM per hour: [{ key, trips, dm, hours, lost, perHour }]. */
  function learnSummary() {
    return Object.entries(learnStats()).map(([key, b]) => ({ key, trips: b.trips, dm: Math.round(b.dm), hours: Math.round(b.hours * 10) / 10, lost: num(b.lost),
      perHour: learnRate(b) === null ? null : Math.round(learnRate(b) * 10) / 10 })).sort((a, b) => (b.perHour || 0) - (a.perHour || 0));
  }
  function statsShort() {
    const s = M.stats;
    return { trips: s.trips, outcomes: clone(s.outcomes), blackHoleShare: s.trips ? s.outcomes.blackHole / s.trips : null, finds: s.finds.length,
      findMatch: s.finds.filter((f) => f.ratio !== null && Math.abs(f.ratio - 1) < 1e-9).length, dm: s.dm };
  }

  // ------------------------------------------------------------------ expeditions: sending
  function earliestReturn(now, flights) {
    const t = [];
    for (const x of liveTrips()) if (!x.done && x.outcome !== 'blackHole' && x.back && x.back > now) t.push(x.back);
    for (const f of flights || []) {
      if (!f) continue;
      if (f.own && +f.missionType === 15 && +f.arrival > now) t.push(+f.arrival);
      // a page=fleetTable row (parse.gz.fleetTable): a returning expedition frees its slot at timerUnix
      else if (+f.missionId === 15 && f.returning === true && +f.timerUnix * 1000 > now) t.push(+f.timerUnix * 1000);
    }
    return t.length ? Math.min(...t) : null;
  }
  /** Back-off of a run that sent nothing: 60 s, 120 s, 240 s ... capped at 10 min (streak = idle runs in a row, from 1). */
  function idleDelay(streak) { return Math.min(IDLE_MAX, IDLE_MIN * Math.pow(2, Math.max(0, num(streak, 1) - 1))); }
  /** Was an expedition back home in (since, now]? (a trip of ours or an own mission-15 flight of the flight cache) */
  function expoReturnedSince(since, now, flights) {
    for (const x of liveTrips()) if (x.back && x.back > since && x.back <= now && x.outcome !== 'blackHole') return true;
    for (const f of flights || []) if (f && f.own && +f.missionType === 15 && +f.arrival > since && +f.arrival <= now) return true;
    return false;
  }
  /** Pure gate of expoRun: { run: true } or { run: false, nextAt, reason } — the step (and its read.fleetTable) only runs when its
   * planned time came, an expedition returned since the last step, or the settings / dry-run changed. */
  function expoGate(gate, { now, cfgSig, returned, settingsAt = 0 }) {
    if (!gate || !(num(gate.nextAt) > now)) return { run: true, why: 'time' };
    if (gate.cfgSig !== cfgSig || num(settingsAt) > num(gate.at)) return { run: true, why: 'settings' };
    if (returned) return { run: true, why: 'return' };
    return { run: false, nextAt: num(gate.nextAt), reason: (gate.reason || 'ожидание') + ' (ранний вызов: слоты не перечитываю)' };
  }
  function cfgSigOf(wctx) {
    return JSON.stringify([!!wctx.dryRun, wctx.cfg('expeditions') !== false, wctx.cfg('mode') || 'learn', wctx.cfg('origins') || [], num(wctx.cfg('stayHours'), 1), num(wctx.core('slotsReserve'), 1)]);
  }
  function noteReturns(wctx) {
    const now = wctx.now();
    for (const x of liveTrips()) {
      if (x.returnSeen || !x.back || x.back > now || x.outcome === 'blackHole') continue;
      x.returnSeen = true;
      if (!(num(M.meta.notBefore) > now)) {
        const a = num(wctx.cfg('afterReturnMinSec'), 30); const b = Math.max(a, num(wctx.cfg('afterReturnMaxSec'), 300));
        M.meta.notBefore = x.back + OGX.bot.randMs([a * 1000, b * 1000]);
        wctx.rec('decision', `Экспедиция ${x.fleetId} вернулась: новый раунд не раньше ${fmtT(M.meta.notBefore)}`, { why: 'пауза после возврата (afterReturn)', inputs: { fleetId: x.fleetId, back: x.back }, chosen: 'wait', alternatives: [] });
      }
    }
  }
  function between(wctx) { const a = num(wctx.cfg('betweenMinSec'), 5); const b = Math.max(a, num(wctx.cfg('betweenMaxSec'), 15)); return OGX.bot.randMs([a * 1000, b * 1000]); }
  function afterRound(wctx, flights, why) {
    const now = wctx.now();
    const first = earliestReturn(now, flights);
    if (first) {
      const a = num(wctx.cfg('afterReturnMinSec'), 30); const b = Math.max(a, num(wctx.cfg('afterReturnMaxSec'), 300));
      return { nextAt: first + OGX.bot.randMs([a * 1000, b * 1000]), reason: why + '; ближайший возврат ' + fmtT(first), byReturn: true };
    }
    return { nextAt: now + OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: why + '; возвратов не видно, повтор через 4-6 мин' };
  }
  function closeRound(why) { if (M.meta.round && !M.meta.round.closed) { M.meta.round.closed = true; M.meta.round.closeWhy = why; } M.view = null; }

  async function expoStep(wctx) {
    const now = wctx.now();
    const flights = wctx.flights();
    if (num(M.meta.notBefore) > now) return { nextAt: M.meta.notBefore, reason: 'пауза после возврата экспедиции', byReturn: true };
    const bodies = await wctx.bodies();
    const mode = wctx.cfg('mode') || 'learn';
    const wanted = mode === 'dm' ? DM_SHIPS : mode === 'learn' ? Array.from(new Set(learnCandidates(wctx.cfg('learnFleets')).flatMap((c) => Object.keys(c.ships).map(Number)))) : CARGO_SHIPS.concat(DM_SHIPS);
    const origins = originList(bodies, wctx.cfg('origins'), wanted);
    if (!origins.length) { wctx.rec('skip', 'Экспедиции: нет точек старта', { reason: 'noOrigin' }); return { nextAt: now + OGX.bot.randMs(OGX.bot.INTERVALS.m16), reason: 'нет точек старта' }; }
    const reserve = num(wctx.core('slotsReserve'), 1);
    const round = M.meta.round && !M.meta.round.closed ? M.meta.round : null;
    // dry-run: a new journal-only round (the same plan again) at most every 5 min
    if (!round && wctx.dryRun && num(M.meta.dryRoundAt) > now - DRY_PLAN_GAP) {
      return { nextAt: num(M.meta.dryRoundAt) + DRY_PLAN_GAP, reason: 'пробный режим: план уже записан, повтор не чаще раза в 5 мин' };
    }
    let reads = 0;
    let lastWhy = 'нет подходящих кораблей';
    for (const o of origins) {
      const lock = wctx.locked(o.key);
      if (lock) { wctx.rec('skip', `Экспедиции с ${o.coords}: тело под угрозой (удар ${fmtT(lock.arrival)})`, { reason: 'threat', body: o.id, threat: lock.key }); lastWhy = 'угроза'; M.view = null; continue; }
      // within a round the view derived from the last successful send (ships minus that fleet, both slot counters + 1) serves the next
      // fleet for VIEW_MS: one page=fleetTable GET per expedition (the send's own step 0), not two
      const view = round ? viewOf(M.view, o, now, round.id) : null;
      if (!view && reads >= 3) break;
      if (!view) reads++;
      else wctx.decide(`Слоты и корабли на ${o.coords} — по снимку после прошлой отправки`, { why: 'внутри раунда страница флота не перечитывается перед каждым флотом (отправка сама читает её шагом 0)', inputs: { bodyId: o.id, ageMs: now - M.view.t }, chosen: 'view', alternatives: ['read.fleetTable'] });
      const ft = view || await readFleetTable(wctx, o, 'начало раунда экспедиций: свободные слоты');
      if (!ft || !ft.slots) { lastWhy = 'слоты неизвестны'; continue; }
      if (mode === 'dm' || mode === 'learn') await probeBuild(wctx, o, ft, mode);
      // slots other modules hold for a coming send (botfarm escorts) count as used (runtime slot holds)
      let held = 0;
      try { const c = await wctx.canSend('normal'); held = num(c && c.held); } catch (e) { held = 0; }
      const sl = slotsToSend(ft.slots, reserve + held);
      // slots «taken» by dry-run sends of this round (also in a live round when dry-run was switched on mid-round)
      const dryUsed = round ? num(round.drySent, round.dry ? round.sent : 0) : 0;
      const n = Math.max(0, sl.n - dryUsed);
      const expFreeEff = Math.max(0, sl.expFree - dryUsed);
      if (expFreeEff <= 0) {
        closeRound('нет свободного слота экспедиции');
        if (round && dryUsed > 0) return { nextAt: now + OGX.bot.randMs(OGX.bot.INTERVALS.m35), reason: 'пробный раунд окончен' };
        return afterRound(wctx, flights.concat(ft.flights || []), `слоты экспедиций заняты (${ft.slots.expedition.used}/${ft.slots.expedition.max})`);
      }
      if (n <= 0) {
        closeRound('резерв слотов флота');
        wctx.rec('skip', `Экспедиции: свободный слот экспедиции есть, но слотов флота ${ft.slots.fleet.max - ft.slots.fleet.used} при резерве ${reserve}${held ? ' и ' + held + ' занятых другими модулями' : ''}`, { reason: 'reserve', slots: ft.slots, reserve, held });
        return { nextAt: now + OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: 'резерв слотов флота: повтор через 4-6 мин' };
      }
      const r = await sendFrom(wctx, o, ft, { n, expFree: expFreeEff, mode, round, now });
      if (r.sent) return r.result;
      lastWhy = r.why || lastWhy;
      if (r.stop) return r.result;
    }
    closeRound(lastWhy);
    return { nextAt: wctx.now() + OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: 'слот свободен, отправить нечего (' + lastWhy + '): повтор через 4-6 мин' };
  }

  /** Composition, EV, staytime, sleep check and the send of one expedition fleet from body o. */
  async function sendFrom(wctx, o, ft, { n, expFree = n, mode, round, now }) {
    const have = ft.ships;
    const target = expoTarget(o.coords);
    const tcoords = coordsOf(target);
    // learn mode: the candidate fleet (and its staytime) picked from the DM per hour measured so far
    let pick = null;
    if (mode === 'learn') {
      M.meta.learn = M.meta.learn && typeof M.meta.learn === 'object' ? M.meta.learn : {};
      pick = learnPick(learnCandidates(wctx.cfg('learnFleets')), M.meta.learn, have, { minTrips: num(wctx.cfg('learnMinTrips'), 8),
        explore: num(wctx.cfg('learnExplore'), 0.1), keep: { 210: num(wctx.cfg('keepProbes'), 2000) },
        pending: liveTrips().filter((x) => !x.done && x.learnKey).reduce((a, x) => { a[x.learnKey] = (a[x.learnKey] || 0) + 1; return a; }, {}) });
    }
    const stayHours = pick ? pick.cand.stay : num(wctx.cfg('stayHours'), 1);
    const probeKey = o.id + ':15';
    let pr = M.meta.probe && M.meta.probe[probeKey];
    M.meta.probe = M.meta.probe || {};
    // the step-2 answer for mission 15 (missions + staytime options), once per PROBE_TTL per origin; skipped in dry-run (nothing posted)
    const firstDm = dmShip(have, { probeOk: pr && pr.t > now - PROBE_TTL ? pr.ok : {} });
    if ((!pr || !(pr.t > now - PROBE_TTL) || (firstDm && pr.ok && pr.ok[firstDm] === undefined)) && firstDm && !wctx.dryRun) {
      const r = await probe(wctx, o, target, { [firstDm]: 1 }, 'миссия 15 и варианты удержания берутся со шага 2 (часы = текст варианта)');
      if (r && r.ok && r.data) {
        pr = { t: wctx.now(), ok: Object.assign({}, (pr && pr.ok) || {}, { [firstDm]: (r.data.missions || []).includes(15) }), stayOptions: r.data.stayOptions || [], missions: r.data.missions || [] };
        M.meta.probe[probeKey] = pr;
      } else if (r && (r.refused || r.error)) {
        wctx.rec('skip', `Экспедиции с ${o.coords}: проверка цели не удалась (${r.message || r.error || r.refused})`, { reason: r.refused || r.error, body: o.id });
        return { why: 'проверка цели не удалась' };
      }
    }
    const probeOk = pr && pr.t > now - PROBE_TTL ? pr.ok || {} : {};
    // compositions
    const roundSlots = round && round.n0 ? round.n0 : n;
    // mode dm: expoProbes probes (Xterium: expedition DM = fleet points x 0.5..1.5), never below 1, the last keepProbes stay home
    const dmComp = dmComposition(have, { want: wctx.cfg('expoProbes'), keep: wctx.cfg('keepProbes'), probeOk });
    let resIds = wctx.cfg('ships');
    if (typeof resIds === 'string') { try { resIds = JSON.parse(resIds); } catch (e) { resIds = []; } }
    const sizing = round && round.sizes && round.sizes[o.id] ? round.sizes[o.id] : null;
    const resComp = sizing ? (() => { const out = {}; for (const [id, k] of Object.entries(sizing)) { if (!CARGO_SHIPS.includes(+id) && +id !== 210) continue; const m = Math.min(k, num(have[id])); if (m > 0) out[id] = m; } return Object.keys(out).length && Object.keys(out).some((id) => CARGO_SHIPS.includes(+id)) ? out : null; })()
      : resourcesFleet(have, { share: num(wctx.cfg('fleetShare'), 0.1), slots: roundSlots, ids: resIds, addCheap: wctx.cfg('addCheapTypes') !== false });
    const levels = await researchLevels();
    const top = await topPoints();
    const seed = 'botexpo:' + (round ? round.id : now);
    const evOf = async (fleet) => (fleet ? evFor(wctx, fleet, { stayHours, durationSec: flight(o.coords, tcoords, fleet).duration, levels, top, seed }) : null);
    const evDm = mode === 'resources' || mode === 'learn' ? null : await evOf(dmComp);
    const evRes = mode === 'dm' || mode === 'learn' ? null : await evOf(resComp);
    let chosen = null; let comp = null; let ev = null;
    if (mode === 'learn') { chosen = 'learn'; comp = pick ? Object.assign({}, pick.cand.ships) : null; ev = comp ? await evOf(comp) : null; }
    else if (mode === 'dm') { chosen = 'dm'; comp = dmComp; ev = evDm; }
    else if (mode === 'resources') { chosen = 'resources'; comp = resComp; ev = evRes; }
    else {
      const a = evDm && Number.isFinite(evDm.perSlotHour) ? evDm.perSlotHour : null;
      const b = evRes && Number.isFinite(evRes.perSlotHour) ? evRes.perSlotHour : null;
      if (b !== null && (a === null || b > a)) { chosen = 'resources'; comp = resComp; ev = evRes; } else { chosen = 'dm'; comp = dmComp; ev = evDm; }
    }
    if (!round) {
      // a new round: EV journaled once per round (expo-ev)
      const id = String(now);
      M.meta.round = { id, startedAt: now, n0: n, sent: 0, drySent: 0, dry: !!wctx.dryRun, mode: chosen, sizes: {}, closed: false };
      if (wctx.dryRun) M.meta.dryRoundAt = now;
      round = M.meta.round;
      M.lastEv = { t: now, mode, chosen, perTrip: ev ? ev.perTrip : null, perSlotHour: ev ? ev.perSlotHour : null, evDm: evShort(evDm), evRes: evShort(evRes), fleet: comp, slots: n };
      wctx.rec('expo-ev', `Раунд экспедиций: слотов ${n}, режим «${MODE_RU[mode] || mode}»${mode === 'auto' ? ' → «' + (MODE_RU[chosen] || chosen) + '»' : ''}; ожидание за полёт ≈ ${ev ? fmtN(ev.perTrip) : '—'} (ТМ ${ev ? ev.evDm.toFixed(0) : '—'})`,
        { round: id, mode, chosen, slots: n, fleet: comp, ev: ev ? evShort(ev) : null, evDm: evShort(evDm), evRes: evShort(evRes), probs: ev ? ev.probs : null,
          find: ev ? ev.find : null, rates: { c: num(wctx.core('rateC'), 1.5), d: num(wctx.core('rateD'), 3) }, dmValueMsu: num(wctx.cfg('dmValueMsu')),
          learn: mode === 'learn' || mode === 'dm' ? learnSummary() : undefined, pick: pick ? { key: pick.key, phase: pick.phase, why: pick.why } : undefined,
          note: 'находка ресурсов = min(свободный трюм, Σ(M+C) флота); 1/9 полётов — чёрная дыра (весь флот)' });
    }
    if (chosen === 'resources' && resComp && !round.sizes[o.id]) { const s = {}; for (const [id, k] of Object.entries(resComp)) s[id] = k; round.sizes[o.id] = s; }
    if (!comp) {
      wctx.rec('skip', `Экспедиции с ${o.coords}: нет кораблей для режима «${MODE_RU[chosen] || chosen}»` + (chosen === 'resources' ? ' (нужны Ул. трансп.: на теле ' + num(have[CARGO_SHIPS[0]]) + ')' : '')
        + (chosen === 'learn' ? ` (ни один вариант не помещается: зондов ${num(have[210])}, оставляю ${num(wctx.cfg('keepProbes'), 2000)})` : '')
        + (chosen === 'dm' ? ` (зондов ${num(have[210])}, резерв для шпионажа ${num(wctx.cfg('keepProbes'), 2000)} не трогаю)` : ''), { reason: 'ships', body: o.id, have, mode: chosen, keepProbes: num(wctx.cfg('keepProbes'), 2000) });
      return { why: 'нет кораблей' };
    }
    // staytime by the option text (F6); unknown options (dry-run without a cached probe): the configured hours, the server picks
    const stay = pr && pr.stayOptions && pr.stayOptions.length ? pickStay(pr.stayOptions, stayHours) : null;
    const stayH = stay ? +stay.option.hours : stayHours;
    const ft1 = flight(o.coords, tcoords, comp);
    const backAt = now + (2 * ft1.duration + Math.round(stayH * 3600)) * 1000;
    const sc = wctx.sleepCheck(backAt);
    if (!sc.ok) {
      closeRound('сон');
      wctx.rec('skip', `Экспедиции: возврат ${fmtT(backAt)} попадает в сон`, { reason: sc.reason, backAt });
      return { stop: true, result: { nextAt: now + OGX.bot.randMs(OGX.bot.INTERVALS.m16), reason: 'сон' } };
    }
    const avail = wctx.available(o.key);
    if (Number.isFinite(ft1.fuel) && ft1.fuel > 0 && avail.deuterium < ft1.fuel) {
      wctx.rec('skip', `Экспедиции с ${o.coords}: мало дейтерия (${fmtN(avail.deuterium)} < ${fmtN(ft1.fuel)})`, { reason: 'fuel', body: o.id, need: ft1.fuel, avail: avail.deuterium });
      return { why: 'нет топлива' };
    }
    let expectedFind = null;
    try { expectedFind = OGX.botSim.expeditionFind({ ships: comp, cargoOnBoard: 0 }); } catch (e) { expectedFind = null; }
    wctx.decide(`Экспедиция ${round.sent + 1}/${round.n0} с ${o.coords} на [${tcoords}]: ${shipsLabel(comp)}, удержание ${stayH} ч`, {
      why: chosen === 'learn' ? 'режим «Подбор состава»: ' + (pick ? pick.why : '') : chosen === 'dm' ? 'режим «Тёмная материя»: один самый дешёвый корабль на слот (ценность — ТМ и находка кораблей)' : 'режим «Ресурсы»: находка = min(трюм, Σ(M+C)), флот поделён на слоты',
      inputs: { slotsFree: n, origin: o.id, have: { 202: have[202] || 0, 203: have[203] || 0, 210: have[210] || 0, 217: have[217] || 0 }, stayOptions: pr ? pr.stayOptions : null, stayHours, probeOk },
      chosen: { mode: chosen, ships: comp, staytime: stay ? stay.option : null, stayExact: stay ? stay.exact : null, speed: 10, target: tcoords },
      alternatives: [evShort(evDm) && { mode: 'dm', ev: evShort(evDm) }, evShort(evRes) && { mode: 'resources', ev: evShort(evRes) }].filter(Boolean) });
    const r = await wctx.act({ type: 'fleet.send', bodyId: o.id, prio: 'fleet', cls: 'normal',
      params: { target, ships: comp, mission: 15, speed: 10, cargo: { metal: 0, crystal: 0, deuterium: 0 }, staytime: stayH, expectArrival: now + ft1.duration * 1000, arrivalTolMs: 600000 },
      why: `Экспедиция с ${o.coords}: ${shipsLabel(comp)}, ${stayH} ч`, plan: { mode: chosen, ev: ev ? evShort(ev) : null, expectedFind, round: round.id },
      dedupeKey: 'botexpo:' + o.id + ':' + round.id + ':' + round.sent, returnAt: backAt });
    const nextBetween = () => ({ nextAt: wctx.now() + between(wctx), reason: 'следующий флот раунда' });
    if (r && r.dry) {
      round.sent++;
      round.drySent = num(round.drySent) + 1;
      M.view = { originId: o.id, round: round.id, t: wctx.now(), ok: true, ft };   // nothing left the body: the same view serves the next dry send
      const id = 'dry:' + round.id + ':' + round.sent;
      M.trips[id] = { id, dry: true, fleetId: null, origin: o.id, originCoords: o.coords, ships: comp, mode: chosen, sentAt: now, stayHours: stayH, done: true };
      wctx.rec('expo-sent', `[пробный режим] Экспедиция с ${o.coords}: ${shipsLabel(comp)}, удержание ${stayH} ч`, { dry: true, origin: o.id, ships: comp, mode: chosen, staytime: stay ? stay.option : null, stayHours: stayH, target: tcoords, round: round.id });
      if (n - 1 <= 0) { closeRound('все слоты (пробный режим)'); return { sent: true, result: { nextAt: wctx.now() + OGX.bot.randMs(OGX.bot.INTERVALS.m35), reason: 'пробный раунд окончен' } }; }
      return { sent: true, result: nextBetween() };
    }
    if (!r || !r.ok) {
      const why = r ? r.message || r.error || r.refused : 'нет ответа';
      wctx.rec('skip', `Экспедиция с ${o.coords} не отправлена: ${why}`, { reason: r ? r.refused || r.error : 'none', body: o.id, ships: comp });
      M.view = null;
      // 'expeditionLimit' = the server's «Вы не можете отправить больше экспедиций.» (fl_no_expedition_slot): its count of the
      // expedition slots differs from ours — like 'slots', wait for a return
      if (r && (r.refused === 'slots' || r.refused === 'expeditionLimit')) { closeRound('слоты'); return { stop: true, result: afterRound(wctx, wctx.flights(), r.refused === 'expeditionLimit' ? 'сервер: слотов экспедиций нет' : 'нет слота') }; }
      // an hourly limit of botcore: the retry when it reopens, not a blind 4-6 min
      if (r && r.refused === 'limit') { closeRound('лимит'); return { stop: true, result: { nextAt: limitRetryAt(wctx), reason: 'отказ: лимит действий/отправок в час, повтор после его открытия' } }; }
      if (r && ['stopped', 'notLeader', 'expired', 'threat', 'sleep', 'userActive'].includes(r.refused)) return { stop: true, result: { nextAt: wctx.now() + OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: 'отказ: ' + r.refused } };
      return { why };
    }
    round.sent++;
    M.stepSent = true;
    M.view = { originId: o.id, round: round.id, t: wctx.now(), ok: true, ft: viewAfterSend(ft, comp, { expedition: true, t: wctx.now() }) };
    if (M.view.ft.slots) M.lastSlots = Object.assign({ t: wctx.now() }, M.view.ft.slots);
    const d = r.data || {};
    const arrival = d.arrival || now + ft1.duration * 1000;
    const stayEnd = arrival + Math.round(stayH * 3600) * 1000;
    const id = d.fleetId !== null && d.fleetId !== undefined ? String(d.fleetId) : 'x' + now;
    M.trips[id] = { id, fleetId: d.fleetId === undefined ? null : d.fleetId, origin: o.id, originCoords: o.coords, ships: comp, mode: chosen, sentAt: r.at || now,
      arrival, stayEnd, back: d.back || null, stayHours: stayH, staytime: stay ? stay.option.value : null, expectedFind, round: round.id, outcome: null, amounts: null, done: false, verified: !!r.verified,
      // dm mode feeds the same «DM per hour by fleet» table as the learn mode (key '5000x210@1h')
      learnKey: pick ? pick.key : (chosen === 'dm' && comp ? (learnCandidates([{ ships: comp, stay: stayH }])[0] || {}).key || null : null) };
    wctx.rec('expo-sent', `Экспедиция ${d.fleetId || '?'} с ${o.coords}: ${shipsLabel(comp)}, удержание ${stayH} ч, возврат ${fmtT(d.back)}`,
      { fleetId: d.fleetId, origin: o.id, ships: comp, mode: chosen, staytime: stay ? stay.option : null, stayHours: stayH, target: tcoords, arrival, stayEnd, back: d.back || null, verified: !!r.verified, round: round.id });
    if (n - 1 <= 0) {
      closeRound('все слоты заняты');
      // an expedition slot left free only because of the fleet-slot reserve: retry in 4-6 min [SPEC §6]
      if (expFree - 1 > 0) return { sent: true, result: { nextAt: wctx.now() + OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: 'слот экспедиции свободен, но резерв слотов флота: повтор через 4-6 мин' } };
      return { sent: true, result: afterRound(wctx, wctx.flights().concat(ft.flights || []), 'раунд окончен') };
    }
    return { sent: true, result: nextBetween() };
  }

  async function expoRun(wctx) {
    if (!OGX.bot.isActive(NAME)) return { nextInMs: OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: 'off' };
    await load();
    const now = wctx.now();
    M.lastRun = now;
    let out = { nextAt: now + OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: 'ожидание' };
    try {
      noteReturns(wctx);
      const cfgSig = cfgSigOf(wctx);
      const gate = M.meta.gate || null;
      const g = expoGate(gate, { now, cfgSig, settingsAt: M.settingsAt, returned: !!gate && expoReturnedSince(num(gate.at), now, wctx.flights()) });
      if (!g.run) out = { nextAt: g.nextAt, reason: g.reason };
      else {
        M.stepSent = false;
        if (wctx.cfg('expeditions') !== false) out = await expoStep(wctx);
        else out = { nextAt: now + OGX.bot.randMs(OGX.bot.INTERVALS.m16), reason: 'экспедиции выключены' };
        // nothing sent for real (also a dry-run «send»): back off 60 s doubling to 10 min; a wait for a known return keeps its time
        const t = wctx.now();
        const idle = M.meta.idle || { streak: 0, sig: null };
        if (M.stepSent) M.meta.idle = { streak: 0, sig: null };
        else {
          const sl = M.lastSlots ? { f: M.lastSlots.fleet, e: M.lastSlots.expedition } : null;
          const sig = JSON.stringify([sl, cfgSig]);
          const streak = idle.sig === sig ? num(idle.streak) + 1 : 1;
          M.meta.idle = { streak, sig };
          const floor = out.byReturn ? 0 : t + idleDelay(streak);
          if (!(out.nextAt >= floor)) out = { nextAt: floor, reason: out.reason + `; ничего не отправлено — пауза ${Math.round((floor - t) / 1000)} с` };
        }
        M.meta.gate = { at: t, nextAt: out.nextAt, reason: out.reason, cfgSig };
      }
      // the results after the step: its page=fleetTable GET made the server process the events due by then (the reports exist)
      await readResults(wctx);
      // results due earlier than the next send: the schedule of resultDue (RESULT_DELAY after the event, retries, the page rule)
      if (wctx.core('readMessages') !== false) {
        const t = wctx.now(); const pageAt = lastPageAt();
        for (const x of liveTrips()) {
          if (x.done) continue;
          const d15 = !x.outcome && !x.unread15 && x.stayEnd ? resultDue({ eventAt: x.stayEnd, tries: x.tries15, nextAt: x.next15At, now: t, pageAt }) : null;
          const d4 = x.outcome !== 'blackHole' && !x.amounts && x.back ? resultDue({ eventAt: x.back, tries: x.tries4, nextAt: x.next4At, now: t, pageAt }) : null;
          for (const d of [d15, d4]) if (d && d.nextAt) out.nextAt = Math.min(out.nextAt, Math.max(d.nextAt, t + 2000));
        }
      }
    } finally { await save(); }
    return { nextAt: Math.max(out.nextAt, wctx.now() + 1000), reason: out.reason };
  }

  // ------------------------------------------------------------------ DM search with collectors (mission 11, «Asteroids»)
  function dmTrips() { return Object.values(M.dm || {}).filter((x) => !x.dry); }
  /** Targets: [{ origin, target, tkey }] — every own moon (or the dmTargets list), launched from the planet with the same coords,
   *  else (no moon) the expedition position of a planet when the step-2 probe offered mission 11 there (cached in M.meta.dmProbe). */
  function dmRoutes(bodies, cfg) {
    const all = Object.values(bodies || {});
    let refs = parseJson(cfg, []);
    if (!Array.isArray(refs)) refs = [];
    const moons = refs.length ? refs.map((r) => bodyByRef(bodies, r)).filter((b) => b && isMoon(b)) : all.filter(isMoon).sort((a, b) => num(a.order, 999) - num(b.order, 999));
    const out = [];
    for (const m of moons) {
      const planet = all.find((b) => !isMoon(b) && b.coords === m.coords) || null;
      if (!planet) continue;
      out.push({ origin: planet, target: targetOf(m.coords, 3), tkey: m.coords + ':3', moon: m });
    }
    return out;
  }
  function dmNext(wctx, why, ms = OGX.bot.INTERVALS.m16) { M.dmState = why; return { nextAt: wctx.now() + OGX.bot.randMs(ms), reason: why }; }

  function dmSigOf(wctx, bodies) {
    return JSON.stringify([!!wctx.dryRun, wctx.cfg('dmHunt') !== false, wctx.cfg('dmTargets') || [], num(wctx.cfg('dmMaxFleets'), 0), num(wctx.cfg('dmShipsPerFleet'), 60),
      wctx.cfg('expeditions') !== false, num(wctx.core('slotsReserve'), 1), Object.values(bodies || {}).map((b) => String(b.key || b.id) + ':' + (isMoon(b) ? 'm' : 'p')).sort()]);
  }
  /** A DM search of ours came home in (since, now]? (also an own mission-11 flight of the flight cache) */
  function dmReturnedSince(since, now, flights) {
    for (const x of dmTrips()) if (x.back && x.back > since && x.back <= now) return true;
    for (const f of flights || []) if (f && f.own && +f.missionType === 11 && +f.arrival > since && +f.arrival <= now) return true;
    return false;
  }
  async function dmRun(wctx) {
    if (!OGX.bot.isActive(NAME)) return { nextInMs: OGX.bot.randMs(OGX.bot.INTERVALS.m16), reason: 'off' };
    await load();
    if (wctx.cfg('dmHunt') === false) { M.dmState = 'выключен'; return { nextInMs: OGX.bot.randMs(OGX.bot.INTERVALS.m16), reason: 'поиск ТМ выключен' }; }
    let out;
    try {
      const now = wctx.now();
      // the gate (expoGate): a wake — every bot:fleet-returned of any module — runs the step only when its planned time came, a DM
      // search of ours returned, the bodies (a new moon) or the settings changed: no fleetTable read and no skip line per wake
      let bodies = {};
      try { bodies = await wctx.bodies(); } catch (e) { bodies = {}; }
      const cfgSig = dmSigOf(wctx, bodies);
      const gate = M.meta.dmGate || null;
      const g = expoGate(gate, { now, cfgSig, settingsAt: M.settingsAt, returned: !!gate && dmReturnedSince(num(gate.at), now, wctx.flights()) });
      if (!g.run) out = { nextAt: g.nextAt, reason: g.reason };
      else {
        out = await dmStep(wctx);
        M.meta.dmGate = { at: wctx.now(), nextAt: out.nextAt, reason: out.reason, cfgSig };
      }
      // the results after the step (its page read made the server process the returns due by then)
      await dmResults(wctx);
      // a fleet comes back: its result (and a free place) by the result schedule
      if (wctx.core('readMessages') !== false) {
        const t = wctx.now(); const pageAt = lastPageAt();
        for (const x of dmTrips()) {
          if (x.done || !x.back) continue;
          const d = resultDue({ eventAt: x.back, tries: x.tries, nextAt: x.nextAt, now: t, pageAt });
          if (d.nextAt) out.nextAt = Math.min(out.nextAt, Math.max(d.nextAt, t + 2000));
        }
      }
    } finally { await save(); }
    return { nextAt: Math.max(out.nextAt, wctx.now() + 1000), reason: out.reason };
  }

  async function dmStep(wctx) {
    const now = wctx.now();
    const bodies = await wctx.bodies();
    let routes = dmRoutes(bodies, wctx.cfg('dmTargets'));
    if (!routes.length) {
      // no moon: one free check per 6 h whether this server offers mission 11 at the expedition position (needs a collector on the planet)
      const withShip = Object.values(bodies).filter((b) => !isMoon(b) && b.ships && num(b.ships[DM_SHIP]) > 0);
      const pr = M.meta.dmProbe;
      if (pr && pr.ok && pr.t > now - PROBE_TTL) {
        const o = bodyById(bodies, pr.origin);
        if (o) routes = [{ origin: o, target: expoTarget(o.coords), tkey: expoTarget(o.coords).galaxy + ':' + expoTarget(o.coords).system + ':16:1', moon: null }];
      } else if (withShip.length && !wctx.dryRun && !(pr && pr.t > now - PROBE_TTL)) {
        const o = withShip[0];
        const t = expoTarget(o.coords);
        const r = await probe(wctx, o, t, { [DM_SHIP]: 1 }, 'лун нет: проверяю, предлагает ли сервер поиск ТМ (миссия 11) на позиции 16', 'read');
        const ok = !!(r && r.ok && r.data && (r.data.missions || []).includes(11));
        M.meta.dmProbe = { t: wctx.now(), ok, origin: o.id, missions: r && r.data ? r.data.missions || [] : null };
        wctx.rec('dm-probe', ok ? `Поиск ТМ доступен на [${coordsOf(t)}] без луны` : `Поиск ТМ на [${coordsOf(t)}] не предложен (миссии ${(M.meta.dmProbe.missions || []).join(',') || '—'}): нужна своя луна`, { ok, origin: o.id, missions: M.meta.dmProbe.missions });
        if (ok) routes = [{ origin: o, target: t, tkey: coordsOf(t) + ':1', moon: null }];
      }
      if (!routes.length) {
        // no moon: the panel shows «нужна своя луна»; one journal line per PROBE_TTL and the next check after about that long (a new
        // moon changes the gate's signature through bot:bodies-changed: the step runs at once)
        if (!(num(M.meta.dmSkipAt) > now - PROBE_TTL)) { M.meta.dmSkipAt = now; wctx.rec('skip', 'Поиск ТМ: нет своей луны (миссия 11 летит только на свою луну и только «Сборщиками ТМ»)', { reason: 'noMoon' }); }
        return dmNext(wctx, 'нужна своя луна', [PROBE_TTL - 30 * 60000, PROBE_TTL + 30 * 60000]);
      }
    }
    // every place taken by our own searches: no page read until the first comes back
    const flyingAll = dmTrips().filter((x) => !x.done && x.back && x.back > now);
    if (flyingAll.length >= dmLimit(wctx)) {
      M.dmState = `в полёте ${flyingAll.length}`;
      return { nextAt: Math.min(...flyingAll.map((x) => x.back)) + OGX.bot.randMs([3000, 15000]), reason: `все места поиска ТМ заняты (${flyingAll.length}/${dmLimit(wctx)})` };
    }
    const reserve = num(wctx.core('slotsReserve'), 1);
    const perFleet = Math.max(1, num(wctx.cfg('dmShipsPerFleet'), 60));
    let lastWhy = 'нет сборщиков';
    for (const rt of routes.slice(0, 3)) {
      const o = rt.origin;
      const lock = wctx.locked(o.key);
      if (lock) { lastWhy = 'угроза'; wctx.rec('skip', `Поиск ТМ с ${o.coords}: тело под угрозой`, { reason: 'threat', body: o.id }); M.dmView = null; continue; }
      // the fleets of one round: the view after the last send instead of a page read per fleet (VIEW_MS)
      // (not after a return of ours since that view: the collectors back home are not in it)
      const view = M.dmView && !dmReturnedSince(num(M.dmView.t), now, []) ? viewOf(M.dmView, o, now) : null;
      if (view) wctx.decide(`Сборщики и слоты на ${o.coords} — по снимку после прошлой отправки`, { why: 'в одном раунде поиска ТМ страница флота читается один раз', inputs: { bodyId: o.id, ageMs: now - M.dmView.t }, chosen: 'view', alternatives: ['read.fleetTable'] });
      const ft = view || await readFleetTable(wctx, o, 'поиск ТМ: сборщики и слоты флота');
      if (!ft || !ft.slots) { lastWhy = 'слоты неизвестны'; continue; }
      const have = num(ft.ships[DM_SHIP]);
      // away = searches not back yet; a returned one is home (in «have») or scrapped by its find, even before its message is read
      const flying = dmTrips().filter((x) => !x.done && x.origin === o.id && !(x.back && x.back <= now)).reduce((a, x) => a + num(x.n), 0);
      // keep the stock: order collectors on the launch planet (cheap; the shipyard queue decides when they are ready)
      await dmBuild(wctx, o, have + flying);
      if (have < 1) { lastWhy = 'нет сборщиков (220) на ' + o.coords; continue; }
      let held = 0;
      try { const c = await wctx.canSend('normal'); held = num(c && c.held); } catch (e) { held = 0; }
      const ex = ft.slots.expedition || { used: 0, max: 0 };
      // expeditions keep their fleet slots: every free expedition slot is reserved for botexpo's own expeditions
      const expHold = wctx.cfg('expeditions') !== false ? Math.max(0, num(ex.max) - num(ex.used)) : 0;
      const fleetFree = Math.max(0, num(ft.slots.fleet.max) - num(ft.slots.fleet.used) - reserve - held - expHold);
      // DM searches flying (own trips + mission-11 rows of the fleet table, whichever is larger)
      const mineTrips = dmTrips().filter((x) => !x.done && x.back && x.back > wctx.now()).length;
      const mineRows = (ft.flights || []).filter((f) => f && +f.missionId === 11).length;
      const mine = Math.max(mineTrips, mineRows);
      const limit = dmLimit(wctx);
      const dmFree = Math.max(0, limit - mine);
      const k = Math.min(fleetFree, dmFree);
      if (k <= 0) {
        lastWhy = dmFree <= 0 ? `все места поиска ТМ заняты (${mine}/${limit})` : 'нет свободного слота флота (резерв и экспедиции)';
        const backs = dmTrips().filter((x) => !x.done && x.back > wctx.now()).map((x) => x.back);
        if (backs.length) return { nextAt: Math.min(...backs) + OGX.bot.randMs([3000, 15000]), reason: lastWhy };
        continue;
      }
      const alloc = allocateCollectors(have, k, perFleet);
      return dmSend(wctx, o, rt, alloc[0], { k, have, slots: ft.slots, alloc, ft });
    }
    return dmNext(wctx, lastWhy, OGX.bot.INTERVALS.m6);
  }

  /** Keeps the probe stock of an expedition origin (home + flying) at probeTarget: one shipyard order at most every 3 min per body. */
  async function probeBuild(wctx, o, ft, mode) {
    if (wctx.cfg('probeBuild') === false) return;
    const now = wctx.now();
    if (num((M.meta.probeBuildAt || {})[o.id]) > now - 3 * 60000) return;
    const perSlot = mode === 'learn' ? Math.max(0, ...learnCandidates(wctx.cfg('learnFleets')).map((c) => num(c.ships[210])))
      : Math.max(1, Math.floor(num(wctx.cfg('expoProbes'), 5000)));
    const keep = Math.max(0, num(wctx.cfg('keepProbes'), 2000));
    const target = probeTarget({ stock: num(wctx.cfg('probeStock'), 0), slots: num(ft.slots && ft.slots.expedition && ft.slots.expedition.max), perSlot, keep });
    const home = num(ft.ships && ft.ships[210]);
    const fl = probesFlying(o, ft, now, wctx.flights());
    const flying = fl.total;
    const want = target - home - flying;
    if (want < 1) return;
    M.meta.probeBuildAt = Object.assign({}, M.meta.probeBuildAt || {}, { [o.id]: now });
    const info = shipInfo(210) || { metal: 0, crystal: 1000, deuterium: 0 };
    const avail = wctx.available(o.key);
    let n = want;
    for (const r of RES) if (num(info[r]) > 0) n = Math.min(n, Math.floor(num(avail[r]) / num(info[r])));
    if (n < 1) { wctx.rec('skip', `Зонды на ${o.coords}: не хватает ресурсов на ${want}`, { reason: 'resources', body: o.id, want, target }); return; }
    const cost = { metal: num(info.metal) * n, crystal: num(info.crystal) * n, deuterium: num(info.deuterium) * n };
    const resId = wctx.reserve(o.key, cost, { ttlMs: 10 * 60000, label: 'зонды для экспедиций' });
    wctx.decide(`Строю ${n} зондов на ${o.coords}`, { why: `держать ${target} зондов (дома ${home}, в экспедициях ${flying}): чёрная дыра забирает весь флот, ${keep} — резерв для шпионажа`,
      inputs: { target, home, flying, perSlot, keep, cost, avail }, chosen: 'build.units 210 x' + n, alternatives: [] });
    const r = await wctx.act({ type: 'build.units', bodyId: o.id, prio: 'build', params: { units: { 210: n } }, why: 'Экспедиции: постройка зондов на ' + o.coords });
    if (!(r && r.ok && !r.dry)) wctx.release(resId);
    wctx.rec('probe-build', (r && r.dry ? '[пробный режим] ' : '') + `Зонды ×${n} заказаны на ${o.coords} (держать ${target}, дома ${home}, в полёте ${flying}${fl.spy ? ', из них в шпионаже ' + fl.spy : ''})` + (r && !r.ok && !r.dry ? ': ' + (r.message || r.error || r.refused) : ''),
      { body: o.id, n, target, home, flying, flyingExpo: fl.expo, flyingSpy: fl.spy, ok: !!(r && r.ok), dry: !!(r && r.dry) });
  }
  /** Probes of a fleet row (page=fleetTable: ships by name) or of a flight-cache entry (ships by id). */
  function probesIn(f) {
    if (!f) return 0;
    const ships = f.ships || {};
    if (ships[210] !== undefined) return num(ships[210]);
    let n = 0; let named = false;
    for (const [name, k] of Object.entries(ships)) {
      named = true;
      let id = null;
      try { if (OGX.catalog && typeof OGX.catalog.idByName === 'function') id = OGX.catalog.idByName(name); } catch (e) { id = null; }
      if (+id === 210 || (id === null && /зонд|probe|sonde|spion/i.test(String(name)))) n += num(k);
    }
    // no ship list (a hidden tooltip): a spy fleet is probes only
    if (!named && +f.missionId === 6) return num(f.amount);
    return n;
  }
  /** Probes of body o away from home: our live expeditions until their (possibly corrected) return or the mission-15 rows of the fleet
   *  table / flight cache, whichever is larger (a closed or unknown trip still shows there), plus the body's spy flights (mission 6). */
  function probesFlying(o, ft, now, flights) {
    const mine = liveTrips().filter((x) => !x.done && x.origin === o.id && x.ships && x.outcome !== 'blackHole' && (!x.back || x.back > now)).reduce((a, x) => a + num(x.ships[210]), 0);
    const rows = ((ft && ft.flights) || []).filter((f) => f && (!f.origin || !o.coords || f.origin === o.coords));
    // the flight cache lists a fleet up to three times (outward, hold end, return): one entry per fleet, its home = the origin of the
    // outward leg or the destination of the return leg
    const seen = new Set();
    const cache = (flights || []).filter((f) => {
      if (!f || !f.own) return false;
      const home = f.returnFlight ? f.destKey : f.originKey;
      if (home && o.key && home !== o.key) return false;
      const id = f.realMissionId !== undefined && f.realMissionId !== null ? f.realMissionId : f.fleetId;
      if (id !== undefined && id !== null) { if (seen.has(String(id))) return false; seen.add(String(id)); }
      return true;
    });
    const sum = (list, mission) => list.filter((f) => +(f.missionId !== undefined ? f.missionId : f.missionType) === mission).reduce((a, f) => a + probesIn(f), 0);
    const expo = Math.max(mine, sum(rows, 15), sum(cache, 15));
    const spy = Math.max(sum(rows, 6), sum(cache, 6));
    return { total: expo + spy, expo, spy };
  }
  /** Max DM searches at once: the setting, else the limit learnt from a refusal, else 5. */
  function dmLimit(wctx) {
    const cfg = num(wctx.cfg('dmMaxFleets'), 0);
    if (cfg > 0) return cfg;
    const learnt = num(M.meta.dmLimit, 0);
    return learnt > 0 ? learnt : DM_LIMIT_GUESS;
  }
  async function dmBuild(wctx, o, total) {
    if (wctx.cfg('dmBuild') === false) return;
    const want = Math.max(0, num(wctx.cfg('dmStock'), 400) - num(total));
    const now = wctx.now();
    const last = (M.meta.dmBuildAt || {})[o.id];
    if (want < 1 || num(last) > now - 3 * 60000) return;
    const info = shipInfo(DM_SHIP) || { metal: 60000, crystal: 70000, deuterium: 30000 };
    const avail = wctx.available(o.key);
    let n = want;
    for (const r of RES) if (num(info[r]) > 0) n = Math.min(n, Math.floor(num(avail[r]) / num(info[r])));
    if (n < 1) { wctx.rec('skip', `Сборщики ТМ на ${o.coords}: не хватает ресурсов`, { reason: 'resources', body: o.id, want }); return; }
    const cost = { metal: info.metal * n, crystal: info.crystal * n, deuterium: info.deuterium * n };
    const resId = wctx.reserve(o.key, cost, { ttlMs: 10 * 60000, label: 'сборщики ТМ' });
    wctx.decide(`Строю ${n} «Сборщиков ТМ» на ${o.coords}`, { why: `держать ${num(wctx.cfg('dmStock'), 400)} сборщиков (сейчас ${total}); удачный поиск ТМ сжигает весь флот`, inputs: { total, cost, avail }, chosen: 'build.units 220 x' + n, alternatives: [] });
    const r = await wctx.act({ type: 'build.units', bodyId: o.id, prio: 'build', params: { units: { [DM_SHIP]: n } }, why: 'Поиск ТМ: постройка сборщиков на ' + o.coords });
    if (!(r && r.ok && !r.dry)) wctx.release(resId);
    M.meta.dmBuildAt = Object.assign({}, M.meta.dmBuildAt || {}, { [o.id]: now });
    wctx.rec('dm-build', (r && r.dry ? '[пробный режим] ' : '') + `Сборщики ТМ ×${n} заказаны на ${o.coords}` + (r && !r.ok && !r.dry ? ': ' + (r.message || r.error || r.refused) : ''), { body: o.id, n, ok: !!(r && r.ok), dry: !!(r && r.dry) });
  }

  async function dmSend(wctx, o, rt, n, { k, have, slots, alloc, ft }) {
    const now = wctx.now();
    const ships = { [DM_SHIP]: n };
    const tcoords = coordsOf(rt.target);
    // step 2 answer (mission 11 offered + staytime options), once per PROBE_TTL per route
    M.meta.dmRouteProbe = M.meta.dmRouteProbe || {};
    let pr = M.meta.dmRouteProbe[o.id + '>' + rt.tkey];
    if ((!pr || !(pr.t > now - PROBE_TTL)) && !wctx.dryRun) {
      const r = await probe(wctx, o, rt.target, { [DM_SHIP]: 1 }, 'миссия 11 и вариант удержания берутся со шага 2', 'read');
      if (!r || !r.ok || !r.data) { wctx.rec('skip', `Поиск ТМ: проверка [${tcoords}] не удалась (${r ? r.message || r.error || r.refused : 'нет ответа'})`, { reason: r ? r.refused || r.error : 'none' }); return dmNext(wctx, 'проверка цели не удалась', OGX.bot.INTERVALS.m6); }
      pr = { t: wctx.now(), ok: (r.data.missions || []).includes(11), missions: r.data.missions || [], stayOptions: r.data.stayOptions || [] };
      M.meta.dmRouteProbe[o.id + '>' + rt.tkey] = pr;
    }
    if (pr && !pr.ok) {
      wctx.rec('skip', `Поиск ТМ: сервер не предлагает миссию 11 на [${tcoords}] (миссии ${(pr.missions || []).join(',') || '—'})`, { reason: 'mission', target: tcoords, missions: pr.missions });
      return dmNext(wctx, 'миссия 11 не предложена на ' + tcoords, [45 * 60000, 75 * 60000]);
    }
    // the shortest staytime option: the chance does not depend on the stay, a short trip frees the place sooner (Xterium: 0.2..0.8 h)
    const stay = pr && pr.stayOptions && pr.stayOptions.length ? pickStay(pr.stayOptions, 0) : null;
    const stayH = stay ? +stay.option.hours : 1;
    const f = flight(o.coords, tcoords, ships);
    const backAt = now + (2 * f.duration + Math.round(stayH * 3600)) * 1000;
    const sc = wctx.sleepCheck(backAt);
    if (!sc.ok) { wctx.rec('skip', `Поиск ТМ: возврат ${fmtT(backAt)} попадает в сон`, { reason: sc.reason }); return dmNext(wctx, 'сон'); }
    const avail = wctx.available(o.key);
    if (Number.isFinite(f.fuel) && f.fuel > 0 && avail.deuterium < f.fuel) { wctx.rec('skip', `Поиск ТМ с ${o.coords}: мало дейтерия`, { reason: 'fuel', need: f.fuel }); return dmNext(wctx, 'нет топлива', OGX.bot.INTERVALS.m6); }
    const chance = dmChance(n);
    wctx.decide(`Поиск ТМ: ${n} сборщиков с ${o.coords} на [${tcoords}]${rt.moon ? ' (луна)' : ''}, шанс ≈ ${Math.round(chance * 100)} %`, {
      why: `свободно мест ${k}, сборщиков ${have}: каждому флоту хотя бы 1 корабль (база 15 %), остальное поровну до ${num(wctx.cfg('dmShipsPerFleet'), 60)}`,
      inputs: { have, k, alloc, slots }, chosen: { mission: 11, ships, target: tcoords, staytime: stay ? stay.option : null, expectedDm: Math.round(dmExpected(n)) }, alternatives: [] });
    const r = await wctx.act({ type: 'fleet.send', bodyId: o.id, prio: 'fleet', cls: 'normal',
      params: { target: rt.target, ships, mission: 11, speed: 10, cargo: { metal: 0, crystal: 0, deuterium: 0 }, staytime: stayH, expectArrival: now + f.duration * 1000, arrivalTolMs: 600000 },
      why: `Поиск ТМ: ${n}×220 на [${tcoords}]`, plan: { chance, expectedDm: dmExpected(n) }, dedupeKey: 'botexpo:dm:' + o.id + ':' + now, returnAt: backAt });
    if (r && r.dry) {
      wctx.rec('dm-sent', `[пробный режим] Поиск ТМ: ${n}×220 с ${o.coords} на [${tcoords}]`, { dry: true, origin: o.id, n, target: tcoords });
      return dmNext(wctx, 'пробный режим: план записан', OGX.bot.INTERVALS.m35);
    }
    if (!r || !r.ok) {
      const why = r ? r.message || r.error || r.refused : 'нет ответа';
      wctx.rec('skip', `Поиск ТМ не отправлен: ${why}`, { reason: r ? r.refused || r.error : 'none', origin: o.id, n });
      M.dmView = null;
      if (r && r.refused === 'limit') return { nextAt: limitRetryAt(wctx), reason: 'отказ: лимит действий/отправок в час, повтор после его открытия' };
      // botcore's 'expeditionLimit' («Вы не можете отправить больше экспедиций.» = fl_no_expedition_slot, also for mission 11)
      if (r && (r.refused === 'expeditionLimit' || /expedition|экспедиц|slot|слот/i.test(String(r.message || '')))) {
        // fl_no_expedition_slot: the server limit (max_dm_missions) is the number flying now
        const flying = dmTrips().filter((x) => !x.done && x.back && x.back > wctx.now()).length;
        if (!(num(wctx.cfg('dmMaxFleets'), 0) > 0) && flying > 0) { M.meta.dmLimit = flying; wctx.rec('dm-limit', `Поиск ТМ: сервер разрешает ${flying} флотов одновременно`, { limit: flying }); }
        const backs = dmTrips().filter((x) => !x.done && x.back > wctx.now()).map((x) => x.back);
        return backs.length ? { nextAt: Math.min(...backs) + OGX.bot.randMs([3000, 15000]), reason: 'места поиска ТМ заняты' } : dmNext(wctx, 'места поиска ТМ заняты', OGX.bot.INTERVALS.m6);
      }
      return dmNext(wctx, 'отправка не удалась', OGX.bot.INTERVALS.m6);
    }
    const d = r.data || {};
    const arrival = d.arrival || now + f.duration * 1000;
    const id = d.fleetId !== null && d.fleetId !== undefined ? String(d.fleetId) : 'x' + now;
    M.dm = M.dm || {};
    M.dm[id] = { id, fleetId: d.fleetId === undefined ? null : d.fleetId, origin: o.id, originCoords: o.coords, target: tcoords, n, chance, sentAt: r.at || now,
      arrival, stayEnd: arrival + Math.round(stayH * 3600) * 1000, back: d.back || backAt, done: false, found: null };
    wctx.rec('dm-sent', `Поиск ТМ ${d.fleetId || '?'}: ${n}×220 с ${o.coords} на [${tcoords}], шанс ≈ ${Math.round(chance * 100)} %, возврат ${fmtT(d.back || backAt)}`,
      { fleetId: d.fleetId, origin: o.id, n, target: tcoords, chance, back: d.back || backAt, verified: !!r.verified });
    M.dmView = ft ? { originId: o.id, t: wctx.now(), ok: true, ft: viewAfterSend(ft, ships, { expedition: false, t: wctx.now() }) } : null;
    const flyingNow = dmTrips().filter((x) => !x.done).length;
    if (flyingNow > num(M.meta.dmLimit, 0) && num(M.meta.dmLimit, 0) > 0) M.meta.dmLimit = flyingNow;
    M.dmState = `в полёте ${flyingNow}`;
    if (k - 1 > 0) return { nextAt: wctx.now() + between(wctx), reason: 'следующий флот поиска ТМ' };
    return { nextAt: Math.min(...dmTrips().filter((x) => !x.done && x.back).map((x) => x.back)) + OGX.bot.randMs([3000, 15000]), reason: 'все места поиска ТМ заняты' };
  }

  /** Result of a returned DM search: the return message at the return time carries the DM (cat 4; Xterium files it under the
   *  expeditions, cat 15), no DM = nothing found. Read by the result schedule (resultDue: after a full-page request, retries 30 s × n,
   *  RESULT_TRIES within RESULT_WINDOW; one trip never «flying» forever); the category that answered is learnt (M.meta.dmResultCat), the
   *  other one is tried only on the first and the last read, not twice per try. */
  async function dmResults(wctx) {
    const now = wctx.now();
    if (wctx.core('readMessages') === false) { for (const x of dmTrips()) if (!x.done && x.back && now > x.back + 60000) { x.done = true; x.found = null; } return; }
    M.dmStats = M.dmStats || { trips: 0, wins: 0, dm: 0, ships: 0, lostShips: 0 };
    const pageAt = lastPageAt();
    const plan = []; let force = null;
    for (const x of dmTrips()) {
      if (x.done || !x.back) continue;
      const d = resultDue({ eventAt: x.back, tries: x.tries, nextAt: x.nextAt, now, pageAt });
      if (d.giveUp) {
        // counted apart (not as a loss): the win rate of the hunt stays honest
        x.done = true; x.found = null; x.unread = true;
        M.dmStats.unread = num(M.dmStats.unread) + 1;
        wctx.rec('dm-result', `Поиск ТМ ${x.fleetId || '?'} вернулся: сообщение не найдено за ${Math.round(RESULT_WINDOW / 60000)} мин (чтений: ${num(x.tries)})`,
          { fleetId: x.fleetId, n: x.n, found: null, unread: true, tries: num(x.tries), chance: x.chance, messageId: null, stats: Object.assign({}, M.dmStats) });
      } else if (d.read) { plan.push(x); if (d.force && !force) force = x; }
    }
    if (!plan.length) return;
    if (force) await forcePage(wctx, force, 'сообщение о возврате появляется только после обычного (не ajax) запроса к серверу');
    const first = num(M.meta.dmResultCat) === 15 ? 15 : 4;
    const other = first === 4 ? 15 : 4;
    wctx.decide('Читаю сообщения о возврате поиска ТМ', { why: `найденная ТМ приходит в сообщении о возврате (кат. ${first})`, inputs: { fleets: plan.map((x) => x.fleetId), pageAt }, chosen: 'read.messages cat ' + first, alternatives: ['cat ' + other] });
    const notBefore = Math.max(...plan.map((x) => num(x.back))) + 1000;
    const fresh = plan.some((x) => num(x.tries) > 0);
    const used = new Set(dmTrips().map((x) => x.msg).filter(Boolean).concat(Object.values(M.trips).map((x) => x.msg4).filter(Boolean)));
    const rows = [];
    const readCat = async (cat) => {
      const r = await readMessages(wctx, cat, cat === 4 ? 'Поиск ТМ: возврат флота' : 'Поиск ТМ: отчёты', { fresh, notBefore });
      let items = [];
      if (r && r.ok && r.data && r.data.doc) { try { items = OGX.messages.parse.list(r.data.doc) || []; } catch (e) { items = []; } }
      for (const m of items) {
        if (!m || !m.ts || used.has(m.id)) continue;
        let text = ''; let parsed = null;
        try { text = (m.li && m.li.nextElementSibling ? m.li.nextElementSibling.textContent : m.li ? m.li.textContent : '') || ''; } catch (e) { text = ''; }
        try { const fm = OGX.messages.parse.fleetMessage(m.li); const raw = fm && fm.gz && fm.gz.resources; if (raw && Number.isFinite(+raw[921])) parsed = +raw[921]; } catch (e) { parsed = null; }
        // an expedition (mission 15) return lists «delivers Metal …» — never ours [UPSTREAM sys_expe_back_home vs sys_expe_back_home_with_dm]
        if (/доставил груз|deliver/i.test(text)) continue;
        rows.push({ id: m.id, ts: m.ts, cat, dm: Math.max(num(parsed), num(dmFromText(text))), text });
      }
    };
    await readCat(first);
    const t = wctx.now();
    const cands = dmTrips().filter((x) => !x.done && x.back && x.back <= t + MATCH_MS).sort((a, b) => a.back - b.back);
    let hits = assignByTime(rows, cands, (x) => x.back);
    // the other category: when the learnt one answered nothing, on the first read of a trip and on its last
    if (plan.some((x) => !hits.has(x)) && (!M.meta.dmResultCat || plan.some((x) => !hits.has(x) && (num(x.tries) === 0 || num(x.tries) >= RESULT_TRIES - 1)))) {
      await readCat(other);
      hits = assignByTime(rows, cands, (x) => x.back);
    }
    const pageNow = lastPageAt();
    for (const x of cands) if (!hits.has(x) && (plan.includes(x) || missedAt(x.back, t, pageNow))) { x.tries = num(x.tries) + 1; x.nextAt = wctx.now() + RESULT_RETRY * x.tries; }
    for (const [x, hit] of hits) {
      x.done = true; x.msg = hit.id; x.found = num(hit.dm);
      M.meta.dmResultCat = hit.cat;
      M.dmStats.trips += 1; M.dmStats.ships += num(x.n);
      if (x.found > 0) { M.dmStats.wins += 1; M.dmStats.dm += x.found; M.dmStats.lostShips += num(x.n); }
      wctx.rec('dm-result', `Поиск ТМ ${x.fleetId || '?'} вернулся: ${x.found > 0 ? 'найдено ' + fmtN(x.found) + ' ТМ (сборщики израсходованы)' : 'ничего не найдено'}`,
        { fleetId: x.fleetId, n: x.n, found: x.found, chance: x.chance, messageId: hit.id, cat: hit.cat, stats: Object.assign({}, M.dmStats) });
    }
  }

  // ------------------------------------------------------------------ colonization
  function parseJson(v, d) { if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return d; } } return v === undefined || v === null ? d : v; }
  async function planetCount(wctx, why) {
    wctx.decide('Читаю обзор: число планет «[x / y]»', { why, inputs: {}, chosen: 'read.page overview', alternatives: [] });
    const spec = { type: 'read.page', prio: 'read', bodyId: (await currentBodyId()), params: { page: 'overview' }, why: 'Колонизация: число планет' };
    let r = await wctx.act(spec);
    // a colonizer arrived: an overview the core answers from its read cache must be newer than the arrival, or the colony is missed
    const now = wctx.now();
    const landed = Object.values(M.colo || {}).filter((c) => !c.dry && !c.done && c.arrival && c.arrival <= now).map((c) => num(c.arrival));
    if (landed.length && r && r.ok && +r.at > 0 && +r.at < Math.max(...landed) + 1000) r = await wctx.act(Object.assign({ fresh: true }, spec));
    if (!r || !r.ok || !r.data || !r.data.doc) return null;
    let b = null;
    try { b = OGX.parse.gz.bodies(r.data.doc); } catch (e) { b = null; }
    if (!b) return null;
    return { count: b.count || null, coords: (b.list || []).filter((x) => !x.isMoon).map((x) => coordsOf(x.coords)).filter(Boolean) };
  }
  async function currentBodyId() { try { const c = OGX.state.current(); return c && c.id ? c.id : null; } catch (e) { return null; } }
  async function astroLevel(wctx) {
    const lv = await researchLevels();
    if (lv[124] !== undefined && lv[124] !== null) return { level: num(lv[124]), src: 'research' };
    // page=research is a free GET; its tech list carries the level
    wctx.decide('Читаю исследования: уровень астрофизики (124)', { why: 'разрешённые позиции колонизации зависят от 124', inputs: {}, chosen: 'read.page research', alternatives: ['оценка по слотам экспедиций'] });
    const r = await wctx.act({ type: 'read.page', prio: 'read', bodyId: await currentBodyId(), params: { page: 'research' }, why: 'Колонизация: уровень астрофизики' });
    if (r && r.ok && r.data && r.data.doc) {
      try { const s = OGX.state.snapshotSync(r.data.doc); const it = (s.techList || []).find((x) => +x.id === 124); if (it) return { level: num(it.value !== undefined ? it.value : it.level), src: 'page' }; } catch (e) { /* ignore */ }
    }
    const sl = M.lastSlots;
    if (sl && sl.expedition && sl.expedition.max > 0) return { level: sl.expedition.max * sl.expedition.max, src: 'slots' };
    return { level: 0, src: 'unknown' };
  }

  async function colonizeRun(wctx) {
    if (!OGX.bot.isActive(NAME)) return { nextInMs: OGX.bot.randMs(OGX.bot.INTERVALS.m16), reason: 'off' };
    await load();
    if (!wctx.cfg('colonize')) return { nextInMs: OGX.bot.randMs(OGX.bot.INTERVALS.m16), reason: 'колонизация выключена' };
    const now = wctx.now();
    M.lastColRun = now;
    let out;
    try {
      // the gate (expoGate): a wake runs the step only when its planned time came, a colonizer of ours arrived, the bodies or the
      // settings changed — not on every fleet return of the other modules
      let bodies = {};
      try { bodies = await wctx.bodies(); } catch (e) { bodies = {}; }
      const cfgSig = colSigOf(wctx, bodies);
      const gate = M.meta.colGate || null;
      const arrived = !!gate && Object.values(M.colo || {}).some((c) => !c.dry && !c.done && c.arrival && c.arrival > num(gate.at) && c.arrival <= now);
      const g = expoGate(gate, { now, cfgSig, settingsAt: M.settingsAt, returned: arrived });
      if (!g.run) out = { nextAt: g.nextAt, reason: g.reason };
      else {
        out = await colonizeStep(wctx);
        // a colonizer of ours in flight or just landed: the step again right after its arrival (its result needs the overview)
        for (const c of Object.values(M.colo || {})) if (!c.dry && !c.done && c.arrival) out.nextAt = Math.min(out.nextAt, Math.max(c.arrival + 4000, wctx.now() + 30000));
        M.meta.colGate = { at: wctx.now(), nextAt: out.nextAt, reason: out.reason, cfgSig };
      }
    } finally { await save(); }
    return { nextAt: Math.max(out.nextAt, wctx.now() + 1000), reason: out.reason };
  }
  function colSigOf(wctx, bodies) {
    return JSON.stringify([!!wctx.dryRun, !!wctx.cfg('colonize'), wctx.cfg('colonizeTargets') || [], wctx.cfg('origins') || [], !!wctx.cfg('buildColonizers'),
      Object.values(bodies || {}).map((b) => String(b.key || b.id)).sort()]);
  }
  function colNext(wctx, why) { return { nextAt: wctx.now() + OGX.bot.randMs([30 * 60000, 60 * 60000]), reason: why }; }

  async function colonizeStep(wctx) {
    const now = wctx.now();
    const targets = parseJson(wctx.cfg('colonizeTargets'), []);
    const pending = Object.values(M.colo || {}).some((c) => !c.dry && !c.done);
    // an empty list and no colonizer in flight: nothing to read (the overview GET per run was the whole cost of the default «on»);
    // the skip is journaled once per 6 h
    if ((!Array.isArray(targets) || !targets.length) && !pending) {
      M.colState = 'нет целей';
      if (!(num(M.meta.colSkipAt) > now - 6 * H)) { M.meta.colSkipAt = now; wctx.rec('skip', 'Колонизация: список целей пуст', { reason: 'noTargets' }); }
      return colNext(wctx, 'нет целей');
    }
    const pc = await planetCount(wctx, 'свободные места под планеты и проверка прилетевших колонизаторов');
    // results of colonizers that arrived
    await colonizeResults(wctx, pc);
    if (!Array.isArray(targets) || !targets.length) { M.colState = 'нет целей'; return colNext(wctx, 'нет целей'); }
    if (!pc || !pc.count) { M.colState = 'число планет неизвестно'; wctx.rec('skip', 'Колонизация: число планет «[x / y]» не прочитано', { reason: 'count' }); return colNext(wctx, 'число планет неизвестно'); }
    const flights = wctx.flights();
    const inFlight = new Set();
    for (const f of flights) if (f && f.own && +f.missionType === 7 && !f.returnFlight) inFlight.add(String(f.fleetId || coordsOf(f.to)));
    for (const c of Object.values(M.colo)) if (!c.dry && !c.done && c.arrival > now) inFlight.add(String(c.fleetId || c.coords));
    const free = pc.count.max - pc.count.used - inFlight.size;
    if (free <= 0) {
      M.colState = `мест нет: планет ${pc.count.used}/${pc.count.max}, колонизаторов в пути ${inFlight.size}`;
      wctx.rec('skip', `Колонизация: мест нет (планет ${pc.count.used}/${pc.count.max}, в пути ${inFlight.size})`, { reason: 'maxPlanets', count: pc.count, inFlight: inFlight.size });
      const arr = Object.values(M.colo).filter((c) => !c.dry && !c.done && c.arrival > now).map((c) => c.arrival);
      return arr.length ? { nextAt: Math.min(...arr) + 5000, reason: 'ждём колонизатор' } : colNext(wctx, 'мест нет');
    }
    const astro = await astroLevel(wctx);
    const bodies = await wctx.bodies();
    const own = new Set((pc.coords || []).concat(Object.values(bodies).map((b) => b.coords)));
    for (const c of Object.values(M.colo)) if (!c.done) own.add(c.coords);
    const cands = colonizeCandidates(targets, { astro: astro.level, own, black: M.black, now, limit: 40 });
    if (!cands.length) {
      M.colState = 'нет разрешённых свободных позиций';
      wctx.rec('skip', `Колонизация: нет кандидатов (астрофизика ${astro.level}, ЧС ${Object.keys(M.black).length})`, { reason: 'noCandidates', astro, black: Object.keys(M.black).length });
      return colNext(wctx, 'нет кандидатов');
    }
    // origin with a colony ship
    const origins = originList(bodies, wctx.cfg('origins'), [208]);
    let origin = null; let have = null; let reads = 0;
    for (const o of origins) {
      if (wctx.locked(o.key)) continue;
      if (o.ships && o.shipsT && num(o.ships[208]) < 1 && now - o.shipsT < 10 * 60000) continue;
      if (reads >= 3) break;
      reads++;
      const ft = await readFleetTable(wctx, o, 'нужен колонизатор (208)');
      if (ft && num(ft.ships[208]) >= 1) { origin = o; have = ft.ships; break; }
    }
    if (!origin) return buildColonizer(wctx, bodies, origins);
    let probes = 0;
    for (const c of cands) {
      const target = targetOf(c.coords, 1);
      let probeRes = null;
      if (!wctx.dryRun) {
        if (probes >= MAX_PROBES_PER_RUN) break;
        probes++;
        const r = await probe(wctx, origin, target, { 208: 1 }, 'позиция пуста, если шаг 2 предлагает миссию 7 (без просмотра галактики)', 'fleet');
        if (!r || !r.ok) {
          const why = r ? r.message || r.error || r.refused : 'нет ответа';
          if (r && (r.error === 'target' || /target|цель/i.test(why || ''))) { M.black[c.coords] = { until: now + DAY, reason: 'шаг 2: ' + why, t: now }; wctx.rec('colonize-target', `[${c.coords}] не подходит: ${why}`, { coords: c.coords, ok: false, reason: why }); continue; }
          wctx.rec('skip', `Колонизация: проверка [${c.coords}] не удалась (${why})`, { reason: r ? r.refused || r.error : 'none', coords: c.coords });
          return { nextAt: wctx.now() + OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: 'проверка не удалась' };
        }
        probeRes = r.data || {};
        if (!(probeRes.missions || []).includes(7)) {
          M.black[c.coords] = { until: now + DAY, reason: 'занято', t: now };
          wctx.rec('colonize-target', `[${c.coords}] занята (шаг 2 предлагает ${(probeRes.missions || []).join(',') || 'ничего'}): в чёрный список на 1 день`, { coords: c.coords, ok: false, missions: probeRes.missions || [], until: now + DAY });
          continue;
        }
      }
      return sendColonizer(wctx, origin, have, c, probeRes, { astro, pc, free });
    }
    M.colState = 'свободных позиций не найдено';
    return { nextAt: wctx.now() + OGX.bot.randMs(OGX.bot.INTERVALS.m16), reason: 'проверены ' + probes + ' позиций' };
  }

  async function sendColonizer(wctx, origin, have, c, probeRes, { astro, pc, free }) {
    const now = wctx.now();
    const target = targetOf(c.coords, 1);
    const ships = { 208: 1 };
    const ft1 = flight(origin.coords, c.coords, ships);
    const arriveAt = now + ft1.duration * 1000;
    const sc = wctx.sleepCheck(arriveAt);
    if (!sc.ok) { wctx.rec('skip', `Колонизация [${c.coords}]: прибытие во время сна`, { reason: sc.reason, coords: c.coords }); return { nextAt: now + OGX.bot.randMs(OGX.bot.INTERVALS.m16), reason: 'сон' }; }
    const can = await wctx.canSend('normal');
    if (!can.ok) { wctx.rec('skip', `Колонизация: нет свободного слота (свободно ${can.free}, резерв ${can.reserve})`, { reason: 'slots', can }); return { nextAt: now + OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: 'нет слота' }; }
    let cargo = { metal: 0, crystal: 0, deuterium: 0 };
    let room = null;
    if (wctx.cfg('colonizePayload') !== false) {
      const d = (probeRes && probeRes.data) || {};
      const fuel = probeRes && probeRes.consumption !== undefined && probeRes.consumption !== null ? num(probeRes.consumption) : num(ft1.fuel);
      const fr = d.fleetroom !== undefined ? num(d.fleetroom) : num((shipInfo(208) || {}).cargo, 7500);
      room = Math.max(0, fr - fuel);
      cargo = colonizePayload(room, wctx.available(origin.key));
    }
    wctx.rec('colonize-target', `Колонизация: цель [${c.coords}] (позиция ${c.position}, астрофизика ${astro.level})`, { coords: c.coords, ok: true, position: c.position, astro, probe: probeRes ? { missions: probeRes.missions, consumption: probeRes.consumption } : null, dry: !!wctx.dryRun, free });
    const resId = cargo.metal + cargo.crystal > 0 ? wctx.reserve(origin.key, cargo, { ttlMs: 10 * 60000, label: 'груз колонизатора' }) : null;
    wctx.decide(`Колонизатор с ${origin.coords} на [${c.coords}], груз ${fmtN(cargo.metal)} / ${fmtN(cargo.crystal)}`, {
      why: wctx.dryRun ? 'пробный режим: позиция не проверялась (проверка — POST шагов 1-2)' : 'шаг 2 предлагает миссию 7: позиция свободна',
      inputs: { planets: pc.count, free, origin: origin.id, have208: num(have[208]), room, payload: wctx.cfg('colonizePayload') !== false },
      chosen: { mission: 7, ships, cargo, target: c.coords, speed: 10 }, alternatives: [] });
    const r = await wctx.act({ type: 'fleet.send', bodyId: origin.id, prio: 'fleet', cls: 'normal',
      params: { target, ships, mission: 7, speed: 10, cargo, expectArrival: arriveAt, arrivalTolMs: 600000 },
      why: `Колонизация [${c.coords}] с ${origin.coords}`, plan: { coords: c.coords, cargo }, dedupeKey: 'botexpo:colonize:' + c.coords });
    if (resId) wctx.release(resId);
    if (r && r.dry) {
      M.colo['dry:' + c.coords] = { coords: c.coords, dry: true, done: true, sentAt: now, origin: origin.id, cargo };
      wctx.rec('colonize-sent', `[пробный режим] Колонизатор на [${c.coords}] с грузом ${fmtN(cargo.metal)} / ${fmtN(cargo.crystal)}`, { dry: true, coords: c.coords, origin: origin.id, cargo });
      M.colState = 'пробный режим: план отправки записан';
      return { nextAt: now + OGX.bot.randMs([30 * 60000, 60 * 60000]), reason: 'пробный режим' };
    }
    if (!r || !r.ok) {
      const why = r ? r.message || r.error || r.refused : 'нет ответа';
      if (r && !r.refused && r.code === 'step3') M.black[c.coords] = { until: now + DAY, reason: why, t: now };
      wctx.rec('skip', `Колонизатор на [${c.coords}] не отправлен: ${why}`, { reason: r ? r.refused || r.error : 'none', coords: c.coords });
      return { nextAt: now + OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: 'отправка не удалась' };
    }
    const d = r.data || {};
    const key = d.fleetId !== null && d.fleetId !== undefined ? String(d.fleetId) : c.coords;
    M.colo[key] = { key, fleetId: d.fleetId === undefined ? null : d.fleetId, coords: c.coords, position: c.position, origin: origin.id, originCoords: origin.coords, cargo, sentAt: r.at || now,
      arrival: d.arrival || arriveAt, back: d.back || null, done: false, verified: !!r.verified };
    M.colState = `колонизатор летит на [${c.coords}], прибытие ${fmtT(d.arrival || arriveAt)}`;
    wctx.rec('colonize-sent', `Колонизатор ${d.fleetId || '?'} на [${c.coords}] с ${origin.coords}: груз ${fmtN(cargo.metal)} / ${fmtN(cargo.crystal)}, прибытие ${fmtT(d.arrival)}`,
      { fleetId: d.fleetId, coords: c.coords, origin: origin.id, cargo, arrival: d.arrival || null, verified: !!r.verified });
    return { nextAt: (d.arrival || arriveAt) + 4000, reason: 'ждём прибытия колонизатора' };
  }

  async function colonizeResults(wctx, pc) {
    const now = wctx.now();
    const due = Object.values(M.colo).filter((c) => !c.dry && !c.done && c.arrival && now > c.arrival + 2000);
    if (!due.length) return;
    let bodies = {};
    try { bodies = await wctx.bodies(); } catch (e) { bodies = {}; }
    const listCoords = new Set((pc && pc.coords) || []);
    for (const b of Object.values(bodies)) if (!isMoon(b)) listCoords.add(b.coords);
    let msgs = null;
    for (const c of due) {
      if (listCoords.has(c.coords)) {
        c.done = true; c.ok = true;
        const body = Object.values(bodies).find((b) => b.coords === c.coords && !isMoon(b)) || null;
        const minMap = parseJson(wctx.cfg('colonizeMinFields'), {}) || {};
        const min = num(minMap[c.position] !== undefined ? minMap[c.position] : minMap[String(c.position)], 0);
        const fields = body && body.fieldsMax ? +body.fieldsMax : null;
        c.fields = fields;
        const low = min > 0 && fields !== null && fields < min;
        wctx.rec('colonize-result', `Колония на [${c.coords}] основана` + (fields !== null ? `: полей ${fields}` : '') + (low ? ` — меньше порога ${min} (бросать вручную, бот не бросает)` : ''),
          { coords: c.coords, ok: true, fleetId: c.fleetId, bodyId: body ? body.id : null, fields, minFields: min || null, lowFields: low, count: pc ? pc.count : null });
        continue;
      }
      if (now < c.arrival + 60000 && wctx.core('readMessages') !== false && !c.msgTried) {
        if (msgs === null) {
          wctx.decide('Читаю системные сообщения: отчёт колонизации', { why: 'колония не появилась в списке планет', inputs: { fleets: due.map((x) => x.fleetId) }, chosen: 'read.messages cat 4', alternatives: [] });
          const r = await readMessages(wctx, 4, 'Колонизация: отчёт', { notBefore: Math.max(...due.map((x) => num(x.arrival))) + 1000 });
          msgs = [];
          if (r && r.ok && r.data && r.data.doc) { try { msgs = OGX.messages.parse.list(r.data.doc) || []; } catch (e) { msgs = []; } }
        }
        c.msgTried = true;
        const hit = msgs.find((m) => m && m.ts && Math.abs(m.ts - c.arrival) <= 5000 && m.li && (m.li.nextElementSibling ? m.li.nextElementSibling.textContent : '').indexOf(c.coords) >= 0);
        const text = hit && hit.li && hit.li.nextElementSibling ? hit.li.nextElementSibling.textContent.replace(/\s+/g, ' ').trim() : null;
        if (text && /occupied|занят|not possible|более|больше|maximum|maxcolo/i.test(text)) {
          c.done = true; c.ok = false;
          M.black[c.coords] = { until: now + DAY, reason: 'колонизация не удалась', t: now };
          wctx.rec('colonize-result', `Колонизация [${c.coords}] не удалась: ${text.slice(0, 160)}`, { coords: c.coords, ok: false, fleetId: c.fleetId, text, until: now + DAY });
          continue;
        }
        if (!text) continue;
      }
      if (now >= c.arrival + 60000) {
        c.done = true; c.ok = false;
        M.black[c.coords] = { until: now + DAY, reason: 'колония не появилась', t: now };
        wctx.rec('colonize-result', `Колонизация [${c.coords}]: планета не появилась в списке — считаю неудачей`, { coords: c.coords, ok: false, fleetId: c.fleetId, until: now + DAY });
      }
    }
  }

  async function buildColonizer(wctx, bodies, origins) {
    const now = wctx.now();
    if (!wctx.cfg('buildColonizers')) {
      M.colState = 'нет колонизатора (208)';
      wctx.rec('skip', 'Колонизация: нет колонизатора (208), постройка выключена', { reason: 'noColonizer' });
      return colNext(wctx, 'нет колонизатора');
    }
    if (num(M.meta.colBuildAt) > now - 30 * 60000) return colNext(wctx, 'колонизатор уже заказан');
    const levels = await researchLevels();
    const info = shipInfo(208) || { metal: 10000, crystal: 20000, deuterium: 10000 };
    const cost = { metal: info.metal, crystal: info.crystal, deuterium: info.deuterium };
    for (const b of origins) {
      if (isMoon(b)) continue;
      const lv = b.levels || {};
      if (num(lv[21]) < 4 || (levels[117] !== undefined && num(levels[117]) < 3)) continue;
      const avail = wctx.available(b.key);
      if (RES.some((r) => avail[r] < cost[r])) { wctx.rec('skip', `Колонизатор на ${b.coords}: не хватает ресурсов`, { reason: 'resources', body: b.id, cost, avail }); continue; }
      const resId = wctx.reserve(b.key, cost, { ttlMs: 30 * 60000, label: 'колонизатор' });
      wctx.decide(`Строю колонизатор на ${b.coords}`, { why: 'для колонизации нужен 208, ни на одном теле его нет', inputs: { cost, avail, shipyard: lv[21], impulse: levels[117] }, chosen: 'build.units 208 x1', alternatives: [] });
      const r = await wctx.act({ type: 'build.units', bodyId: b.id, prio: 'build', params: { units: { 208: 1 } }, why: 'Колонизация: постройка колонизатора на ' + b.coords });
      if (!(r && r.ok && !r.dry)) wctx.release(resId);
      M.meta.colBuildAt = now;
      wctx.rec('colonizer-build', (r && r.dry ? '[пробный режим] ' : '') + `Колонизатор заказан на ${b.coords}` + (r && !r.ok && !r.dry ? ': ' + (r.message || r.error || r.refused) : ''), { body: b.id, cost, ok: !!(r && r.ok), dry: !!(r && r.dry), verified: !!(r && r.verified) });
      M.colState = 'колонизатор строится на ' + b.coords;
      return { nextAt: now + OGX.bot.randMs(OGX.bot.INTERVALS.m16), reason: 'ждём колонизатор' };
    }
    M.colState = 'нет колонизатора и негде построить';
    wctx.rec('skip', 'Колонизация: построить колонизатор негде (верфь ≥ 4, импульсный ≥ 3, ресурсы)', { reason: 'cannotBuild' });
    return colNext(wctx, 'негде построить');
  }

  // ------------------------------------------------------------------ panel section
  const MODE_RU = { learn: 'Подбор состава', auto: 'Авто', dm: 'Тёмная материя', resources: 'Ресурсы' };
  function renderPanel(container) {
    const h = (...a) => OGX.dom.h(...a);
    const now = OGX.time.serverNow();
    const left = (t) => (t ? (t > now ? 'через ' + Math.ceil((t - now) / 1000) + ' с' : fmtT(t)) : '—');
    const sl = M.lastSlots;
    container.appendChild(h('div', { class: 'ogx-b-expo-slots' }, sl ? `Слоты экспедиций: ${sl.expedition.used}/${sl.expedition.max}; флота: ${sl.fleet.used}/${sl.fleet.max}` : 'Слоты ещё не прочитаны.'));
    const ev = M.lastEv;
    container.appendChild(h('div', { class: 'ogx-b-expo-ev' }, ev ? `Ожидание за полёт (режим «${MODE_RU[ev.chosen || ev.mode] || ev.chosen || ev.mode}»): ≈ ${fmtN(ev.perTrip || 0)} в металле` + (ev.evDm ? `, ТМ ≈ ${num(ev.evDm.evDm)}` : '') + `; за слот-час ≈ ${fmtN(ev.perSlotHour || 0)}` : 'Ожидание ещё не считалось.'));
    const flying = liveTrips().filter((x) => !x.done && x.back && x.back > now).sort((a, b) => a.back - b.back);
    if (flying.length) container.appendChild(h('div', { class: 'ogx-b-bot-muted' }, 'В полёте: ' + flying.map((x) => `${shipsLabel(x.ships)} (возврат ${left(x.back)})`).join('; ')));
    if (M.meta.notBefore > now) container.appendChild(h('div', { class: 'ogx-b-bot-muted' }, 'Следующий раунд не раньше ' + fmtT(M.meta.notBefore)));
    const s = M.stats;
    container.appendChild(h('div', { class: 'ogx-b-bot-h' }, 'Исходы экспедиций (проверка формул 2Moons)'));
    if (!s.trips) {
      const why = OGX.bot.isDryRun() ? 'в пробном режиме экспедиции не отправляются и сообщения не читаются'
        : OGX.bot.cfg('botcore.readMessages') === false ? 'включите «Бот может открывать сообщения» во вкладке «Общие»'
          : 'итоги появятся, когда вернутся отправленные экспедиции';
      container.appendChild(h('div', { class: 'ogx-b-bot-muted' }, 'Результатов пока нет (' + why + ').'));
    }
    else {
      container.appendChild(h('table', { class: 'ogx-table ogx-b-expo-stats' }, h('tbody', null,
        h('tr', null, h('th', null, 'Исход'), h('th', null, 'Раз'), h('th', null, 'Доля'), h('th', null, 'Теория')),
        OUTCOMES.filter((k) => s.outcomes[k] || k !== 'unknown').map((k) => h('tr', { dataset: { outcome: k } }, h('td', null, OUTCOME_RU[k]), h('td', null, String(s.outcomes[k] || 0)),
          h('td', null, (100 * (s.outcomes[k] || 0) / s.trips).toFixed(1) + ' %'), h('td', null, k === 'nothing' ? '33.3 %' : k === 'unknown' ? '—' : '11.1 %'))))));
      const ok = s.finds.filter((f) => f.ratio !== null && Math.abs(f.ratio - 1) < 1e-9).length;
      container.appendChild(h('div', { class: 'ogx-b-bot-muted' }, `Находки ресурсов: ${s.finds.length}, из них равны min(трюм, Σ(M+C)): ${ok}. Найдено ${fmtN(s.found.metal)} / ${fmtN(s.found.crystal)} / ${fmtN(s.found.deuterium)}, ТМ ${fmtN(s.dm)}.`));
      if (num(s.unread15) || num(s.unread4)) container.appendChild(h('div', { class: 'ogx-b-bot-muted ogx-b-expo-unread' }, `Без сообщения (не найдено за 15 мин): отчётов ${num(s.unread15)}, возвратов ${num(s.unread4)}.`));
    }
    // learn mode: DM per hour of every tried expedition fleet
    const ls = learnSummary();
    if (ls.length) {
      container.appendChild(h('div', { class: 'ogx-b-bot-h' }, 'ТМ по составу экспедиций (ТМ в час на слот)'));
      container.appendChild(h('table', { class: 'ogx-table ogx-b-expo-learn' }, h('tbody', null,
        h('tr', null, h('th', null, 'Флот'), h('th', null, 'Полётов'), h('th', null, 'ТМ'), h('th', null, 'ТМ/ч'), h('th', null, 'Потеряно')),
        ls.map((x, i) => h('tr', { dataset: { key: x.key } }, h('td', null, (i === 0 ? '★ ' : '') + x.key.replace(/x/g, '×').replace('@', ', ').replace('210', 'зонд').replace('217', 'Ул.тр.')),
          h('td', null, String(x.trips)), h('td', null, fmtN(x.dm)), h('td', null, x.perHour === null ? '—' : String(x.perHour)), h('td', null, String(x.lost || 0)))))));
    }
    // DM search with collectors
    container.appendChild(h('div', { class: 'ogx-b-bot-h' }, 'Поиск ТМ сборщиками (миссия 11, своя луна)'));
    const ds = M.dmStats;
    const dmFly = dmTrips().filter((x) => !x.done);
    container.appendChild(h('div', { class: 'ogx-b-expo-dm' }, OGX.settings.get('botexpo.dmHunt') === false ? 'Выключен.'
      : (M.dmState || 'ещё не запускался') + (dmFly.length ? `; в полёте ${dmFly.length}: ` + dmFly.map((x) => `${x.n}×220 (возврат ${left(x.back)})`).join(', ') : '')));
    if (ds && ds.trips) container.appendChild(h('div', { class: 'ogx-b-bot-muted' }, `Полётов ${ds.trips}, удачных ${ds.wins} (${Math.round(100 * ds.wins / ds.trips)} %), найдено ${fmtN(ds.dm)} ТМ, израсходовано сборщиков ${fmtN(ds.lostShips)}.` + (num(ds.unread) ? ` Без сообщения: ${num(ds.unread)}.` : '')));
    const g = dmGain(M.meta.dmSamples, now);
    container.appendChild(h('div', { class: 'ogx-b-bot-muted ogx-b-expo-dmgain' }, g && g.hours >= 0.5 ? `Прирост ТМ по счётчику в шапке: +${fmtN(g.gain)} за ${g.hours.toFixed(1)} ч (≈ ${fmtN(g.perHour || 0)} в час; все источники).` : 'Прирост ТМ в час появится после часа работы бота.'));
    container.appendChild(h('div', { class: 'ogx-b-bot-h' }, 'Колонизация'));
    let targets = [];
    try { targets = parseJson(OGX.settings.get('botexpo.colonizeTargets'), []) || []; } catch (e) { targets = []; }
    container.appendChild(h('div', { class: 'ogx-b-expo-col' }, OGX.settings.get('botexpo.colonize') ? `Целей: ${targets.length}. ${M.colState || ''}` : 'Колонизация выключена.'));
    const colo = Object.values(M.colo).filter((c) => !c.dry).sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0)).slice(0, 5);
    if (colo.length) container.appendChild(h('div', { class: 'ogx-b-bot-muted' }, colo.map((c) => `[${c.coords}] ${c.done ? (c.ok ? 'основана' + (c.fields ? ', полей ' + c.fields : '') : 'неудача') : 'летит, прибытие ' + left(c.arrival)}`).join('; ')));
    const black = Object.entries(M.black).filter(([, v]) => v.until > now);
    container.appendChild(h('div', { class: 'ogx-b-bot-muted ogx-b-expo-black' }, black.length ? 'Чёрный список: ' + black.map(([k, v]) => `[${k}] до ${fmtT(v.until)} (${v.reason})`).join('; ') : 'Чёрный список пуст.'));
  }

  // ------------------------------------------------------------------ module
  OGX.module({
    name: NAME,
    title: 'Бот: экспедиции и колонизация',
    settings: SETTINGS,
    async init(ctx) {
      M.ctx = ctx;
      if (!OGX.bot || !OGX.botSim) { ctx.log.warn('OGX.bot / OGX.botSim missing: botexpo idle'); return; }
      await OGX.bot.ready;
      await load();
      // a botcore / botexpo setting change (botcore restarts the workers): the next run re-reads the slots despite the gate
      try { OGX.bus.on('settings:changed', (p) => { if (p && /^(botcore|botexpo)\./.test(String(p.key || ''))) M.settingsAt = OGX.time.serverNow(); }); } catch (e) { /* no bus */ }
      M.handle = OGX.bot.register({ id: NAME, module: NAME, prio: 'fleet', startJitter: [20000, 50000], wakeOn: ['bot:fleet-returned'], run: expoRun });
      M.dmHandle = OGX.bot.register({ id: DM_ID, module: NAME, prio: 'fleet', startJitter: [25000, 55000], wakeOn: ['bot:bodies-changed', 'bot:fleet-returned'], run: dmRun });
      // colonizer arrivals are known from M.colo (nextAt = arrival + 4 s): no wake per fleet return
      M.colHandle = OGX.bot.register({ id: COL_ID, module: NAME, prio: 'fleet', startJitter: [20000, 50000], wakeOn: ['bot:bodies-changed'], run: colonizeRun });
      OGX.bot.panelSection(NAME, renderPanel);
      // the panel copy in non-leader tabs follows the stored state
      const follower = () => { try { return !OGX.bot.status().leader; } catch (e) { return false; } };
      ctx.store.subscribe('trips', (v) => { if (follower() && v && typeof v === 'object') M.trips = v; });
      ctx.store.subscribe('stats', (v) => { if (follower() && v && v.outcomes) M.stats = v; });
      ctx.store.subscribe('meta', (v) => { if (follower() && v && typeof v === 'object') { M.meta = v; M.lastEv = v.lastEv || M.lastEv; } });
      ctx.store.subscribe('colo', (v) => { if (follower() && v && typeof v === 'object') M.colo = v; });
      ctx.store.subscribe('black', (v) => { if (follower() && v && typeof v === 'object') M.black = v; });
      ctx.store.subscribe('dm', (v) => { if (follower() && v && typeof v === 'object') M.dm = v; });
      ctx.store.subscribe('dmStats', (v) => { if (follower() && v && typeof v === 'object') M.dmStats = v; });
    },
  });

  // Pure helpers for tests (tests/gz-bot-mod-botexpo.test.js); not an API for other modules.
  OGX.botExpo = { version: '1.1.2', _lib: { probeTarget, learnCandidates, learnPick, learnAdd, learnRate, dmChance, allocateCollectors, dmExpected, dmFromText, dmGain, dmRoutes, readMessages, idleDelay, expoGate, allowedPosition, pickStay, slotsToSend, dmShip, dmComposition, resourcesFleet, outcomeOf, emptyStats, addOutcome, addAmounts, colonizeCandidates, colonizePayload, coordsOf, expoTarget,
    resultDue, assignByTime, shiftedBack, noteFleetRows, viewAfterSend, probesIn, probesFlying, limitRetryAt }, _M: M, SETTINGS };
})(window.OGX);
