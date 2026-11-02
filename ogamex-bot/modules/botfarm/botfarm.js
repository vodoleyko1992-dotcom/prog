/* ogamex-bot/modules/botfarm/botfarm.js — «Бот: фарм неактивных». Owner: module agent 2.
 * Contract: specs/bot/BOT_CONTRACT.md (C1, C2, C5 botfarm, C6 botfarm events, C8); algorithm: specs/bot/BOT_DESIGN.md §6.
 *
 * What it does (only while OGX.bot says the module is active: master on + botfarm.on; dry-run journals every request instead):
 *   1. targets from the galaxy cache (OGX.galaxy.cached: free) around the origins, optionally scanned with read.galaxy when
 *      botfarm.scanGalaxy and the deuterium budget botcore.galaxyViewsPerHour allow (F12); filter inactive i / I, never v / b /
 *      admin, rank >= minRank, not excluded (F8: inactive players have no noob protection in 2Moons);
 *   2. a persisted state machine per target (botfarm.targets, key 'g:s:p:type'):
 *        new -> probing -> reported -> (attack: flying -> new) | needMoreProbes | waitShips | notSuitable / vacation / gone / probesLost (cooldown);
 *   3. espionage with the probe count of 2Moons MissionCaseSpy (OGX.botSim.spyNeeded, F7), from the nearest origin with probes
 *      (moon wins ties) by fleet.send mission 6, or fleet.ajax mission 6 when useFleetAjax and the planet id is known (F11);
 *      the report is read with read.messages cat 0 (marks read; needs botcore.readMessages) matched by coordinates and list date,
 *      parsed by OGX.messages.parse.espionageFull and stored with OGX.bot.intel.put; missing fleet/defense sections -> more probes
 *      by raising the estimate of the target's espionage level (<= maxProbeRetries);
 *   4. the attack decision: expected resources at arrival (calc.production from section-0 levels at x22000, capped by storage),
 *      loot = calculateSteal halves (F3) vs minLoot; composition: no units at all -> cargo only (minCapacityForLoot x (1+surplus)),
 *      else OGX.botSim.optimizeRaid (attacker bonus % of the fleetTable «Bonus» table, winMin, maxLossShare, simRuns); speed = the
 *      fastest of 10..1 with fuel <= maxFuelShare x loot and duration <= maxFlightSec (never a fallback to 100 %); when botdebris
 *      follows battles and the target already has a field (pre-send possible), the battle is placed at least the recycler flight
 *      + 150 s ahead: the fastest speed that is slow enough, else the slowest allowed speed with a delayed departure (<= 15 min,
 *      ActionSpec.at), so the recyclers can arrive 1-2 s after the battle; order by net
 *      MSU per hour of slot time; fresh intel (<= maxReportAgeMin) or re-spy; farm slots <= maxSlots (own registry),
 *      wctx.canSend('normal'), wctx.sleepCheck, threat locks of the origin (now and at the return);
 *   5. fleet.send mission 1 with expectArrival; on success OGX.bot.battles.put (owner botfarm, debris of the raid simulation,
 *      existing debris of the galaxy row) -> bus bot:battle-planned for botdebris;
 *   6. buildShips (off by default): optimizeRaid.missing -> build.units on the origin when affordable after reservations, the
 *      shipyard has no 15/21 upgrade queued and the calibrated unit time + flight fit buildMaxWaitMin; then waitShips -> attack;
 *   7. spy escort (requirement 2): timer 'botfarm:escort' at arrival - escortLeadSec; a second worker 'botfarm:escort'
 *      (prio deadline) sends probes to arrive 20-30 s before the attack, reads the report, re-simulates with the flying fleet;
 *      new ships/defense (win < winMin or losses > maxLossShare), resources dropped (net <= 0), vacation (step-3 text
 *      'Target planet' [UPSTREAM fl_target_exists] / fleetAjax 605), planet gone (mission 6 not offered), a moon in the galaxy
 *      cache -> fleet.recall before arrival - 3 s (recallOnChange) + OGX.bot.battles.remove -> bot:battle-cancelled;
 *   8. combat reports (cat 3, readMessages) -> journal 'report' predicted vs actual loot (calibration); deleteReports deletes only
 *      own processed spy reports.
 * Every game request goes through wctx.act (C1); a wctx.decide precedes every action; journal kinds 'botfarm:<event>' (C6).
 * Code comments English, user-visible text Russian. */
window.OGX = window.OGX || {};
(function (OGX) {
  'use strict';
  const NAME = 'botfarm';
  const SEC = 'Бот: фарм';
  const RES = ['metal', 'crystal', 'deuterium'];
  const PROBE = 210;
  // John's rule: loot is carried ONLY by Battle Transporters (217 «Улучшенный транспорт»), no fallback ship; combat ships stay escort
  const TRANSPORT = (OGX.catalog && OGX.catalog.transportShip) || 217;
  const CARGO_IDS = [TRANSPORT];
  const COMBAT_IDS = [204, 205, 206, 207, 211, 213, 215];
  const NO_FIGHT = new Set([502, 503]);
  const H = 3600000;
  const COOLDOWN = { shortage: 20 * 60000, notSuitable: 3 * H, vacation: 24 * H, gone: 24 * H, probesLost: 24 * H, attackLimit: 24 * H, needFleet: 6 * H, noReport: 30 * 60000, error: 30 * 60000 };
  const REGROW_MIN = 30 * 60000;               // a poor target is re-spied when its stock should pass minLoot again ...
  const REGROW_MAX = 7 * 24 * H;               // ... but not sooner than 30 min and not later than a week
  const DB_REPORTS = 10;                       // reports kept per target in the target database
  const DB_RAIDS = 20;                         // raids kept per target
  // server answer «Превышен лимит количества атак в сутки на данный пункт назначения.» (attacks per day on one target)
  const ATTACK_LIMIT_RE = /лимит\s+количества\s+атак|attacks?\s+per\s+day|attack\s+limit/i;

  const SETTINGS = {
    on: { type: 'bool', default: true, label: 'Фарм неактивных включён', section: SEC },
    origins: { type: 'json', default: [], label: 'Планеты/луны отправки (id или координаты; пусто = все)', section: SEC },
    scanGalaxy: { type: 'bool', default: true, label: 'Сканировать галактику (стоит дейтерий, лимит в «Общих»)', section: SEC },
    scanScope: { type: 'enum', default: 'galaxy', label: 'Где искать цели', section: SEC,
      options: [{ value: 'galaxy', label: 'Вся моя галактика (все системы галактик, где есть мои планеты)' }, { value: 'radius', label: 'Только радиус вокруг моих планет' }] },
    scanRadius: { type: 'int', default: 15, min: 0, max: 499, label: 'Радиус поиска целей (систем от точки отправки)', section: SEC },
    scanPerCycle: { type: 'int', default: 40, min: 1, max: 300, label: 'Просмотров галактики за один проход, не больше', section: SEC },
    scanEveryH: { type: 'int', default: 24, min: 1, max: 720, label: 'Пересканировать систему не чаще (ч)', section: SEC },
    includeShortInactive: { type: 'bool', default: true, label: 'Брать и «i» (7 дней), не только «I» (28 дней)', section: SEC },
    minRank: { type: 'int', default: 0, min: 0, max: 100000, label: 'Только игроки с местом не выше этого (0 = все)', section: SEC },
    minLoot: { type: 'int', default: 10000000, min: 0, label: 'Минимальная добыча (МСУ, половина ресурсов)', section: SEC },
    maxFlightSec: { type: 'int', default: 7200, min: 10, max: 864000, label: 'Полёт в одну сторону не дольше (с)', section: SEC },
    maxFuelShare: { type: 'float', default: 0.1, min: 0, max: 1, step: 0.01, label: 'Топливо не больше доли добычи', section: SEC },
    maxReportAgeMin: { type: 'int', default: 30, min: 1, max: 1440, label: 'Доклад старше (мин) — шпионить заново', section: SEC },
    escort: { type: 'bool', default: true, label: 'Шпионское сопровождение атаки', section: SEC },
    escortLeadSec: { type: 'int', default: 60, min: 10, max: 3600, label: 'Сопровождение: за сколько секунд до удара', section: SEC },
    recallOnChange: { type: 'bool', default: true, label: 'Отзывать атаку, если обстановка изменилась', section: SEC },
    winMin: { type: 'float', default: 0.99, min: 0.5, max: 1, step: 0.01, label: 'Вероятность не проиграть (победа или ничья), не меньше', section: SEC },
    minWin: { type: 'float', default: 0.8, min: 0.3, max: 1, step: 0.01, label: 'Вероятность победы, не меньше (ничья: флот цел, но без добычи)', section: SEC },
    mixedFleet: { type: 'bool', default: true, label: 'Смешанный флот из своих боевых кораблей (+ Ул. трансп. как прикрытие), без достройки', section: SEC },
    maxLossShare: { type: 'float', default: 0.25, min: 0, max: 5, step: 0.01, label: 'Потери не больше доли добычи', section: SEC },
    simRuns: { type: 'int', default: 60, min: 5, max: 1000, label: 'Прогонов симулятора на вариант', section: SEC },
    surplusPct: { type: 'int', default: 10, min: 0, max: 200, label: 'Запас трюма (%)', section: SEC },
    partialLoot: { type: 'bool', default: true, label: 'Не хватает Ул. трансп.: отправлять сколько есть (неполная добыча)', section: SEC },
    minLootShare: { type: 'float', default: 0.5, min: 0, max: 1, step: 0.05, label: 'Неполная добыча: вывезти не меньше доли ожидаемой', section: SEC },
    maxSlots: { type: 'int', default: 3, min: 0, max: 50, label: 'Атак фарма в полёте одновременно, не больше', section: SEC },
    buildShips: { type: 'bool', default: true, label: 'Достраивать недостающие корабли', section: SEC },
    buildMaxWaitMin: { type: 'int', default: 30, min: 1, max: 1440, label: 'Достройка + полёт не дольше (мин)', section: SEC },
    regrowRespy: { type: 'bool', default: true, label: 'Бедная цель: шпионить снова, когда ресурсы отрастут (по её добыче)', section: SEC },
    needFleetPauseH: { type: 'int', default: 6, min: 1, max: 168, label: 'Цели нужен флот больше, чем есть: пауза (ч)', section: SEC },
    dbKeepDays: { type: 'int', default: 14, min: 1, max: 365, label: 'База целей: хранить пропавшие цели (дней)', section: SEC },
    maxProbeRetries: { type: 'int', default: 2, min: 0, max: 10, label: 'Повторов шпионажа с бо́льшим числом зондов', section: SEC },
    useFleetAjax: { type: 'bool', default: true, label: 'Шпионить быстрой отправкой (fleetAjax), если известен id планеты', section: SEC },
    deleteReports: { type: 'bool', default: true, label: 'Удалять обработанные шпионские доклады', section: SEC },
    targetsPerCycle: { type: 'int', default: 10, min: 1, max: 200, label: 'Целей за один проход, не больше', section: SEC },
    exclude: { type: 'json', default: [], label: 'Исключить (координаты, имена или id игроков)', section: SEC },
  };

  // ------------------------------------------------------------------ small helpers (pure)
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const res0 = () => ({ metal: 0, crystal: 0, deuterium: 0 });
  const num = (v, d = 0) => (v === undefined || v === null || v === '' || !Number.isFinite(+v) ? d : +v);
  const cleanUnits = (o) => { const out = {}; for (const [k, v] of Object.entries(o || {})) if (Math.floor(+v) > 0 && !NO_FIGHT.has(+k)) out[+k] = Math.floor(+v); return out; };
  const sumUnits = (o) => Object.values(o || {}).reduce((s, n) => s + (+n || 0), 0);
  const coordsStr = (t) => [t.galaxy, t.system, t.position].join(':');
  const keyOf = (t) => [+t.galaxy, +t.system, +t.position, +(t.type || 1)].join(':');
  const tgtOf = (key) => { const a = String(key).split(':').map(Number); return { galaxy: a[0], system: a[1], position: a[2], type: a[3] || 1 }; };
  const shipsRu = (o) => Object.entries(o || {}).filter(([, n]) => +n > 0).map(([id, n]) => { let nm = id; try { nm = OGX.catalog.shortName(+id) || OGX.catalog.name(+id) || id; } catch (e) { /* id */ } return nm + ' ×' + n; }).join(', ') || '—';
  const fmtN = (n) => { try { return OGX.fmt.short(n); } catch (e) { return String(Math.round(n)); } };
  const fmtT = (ms) => { try { return OGX.fmt.time(ms); } catch (e) { return '—'; } };
  const rnd = (a, b) => (OGX.bot && OGX.bot.rand ? OGX.bot.rand(a, b) : a + Math.floor(Math.random() * (b - a + 1)));
  const msu = (r) => (OGX.bot && OGX.bot.msu ? OGX.bot.msu(r) : (+r.metal || 0) + (+r.crystal || 0) * 1.5 + (+r.deuterium || 0) * 3);
  function errText(e) { return e && e.message ? e.message : String(e); }

  /** Galaxy row status letters -> farm class: 'I' long inactive, 'i' inactive, null not a target (v / b / active). */
  function inactiveClass(status, { includeShort = true } = {}) {
    const s = String(status || '');
    if (/[vbA]/.test(s)) return null;            // vacation, banned, admin are never targets (F8)
    if (/I/.test(s)) return 'I';
    if (/i/.test(s)) return includeShort ? 'i' : null;
    return null;
  }
  /** Exclusion list entries: 'g:s:p' coordinates, player names or player ids (numbers or numeric strings). */
  function excluded(list, row) {
    for (const x of Array.isArray(list) ? list : []) {
      const s = String(x).trim();
      if (!s) continue;
      if (/^\d+:\d+:\d+$/.test(s) && s === row.coords) return true;
      if (/^\d+$/.test(s) && row.playerId !== null && row.playerId !== undefined && +s === +row.playerId) return true;
      if (row.playerName && s.toLowerCase() === String(row.playerName).toLowerCase()) return true;
    }
    return false;
  }
  /** Production per hour of the target from its report (section 0 levels, research 113, temperature) — calc.production (x22000). */
  function perHourOf(intel, { tempMax = 40, server } = {}) {
    if (!intel || !intel.buildings || !Object.keys(intel.buildings).length) return res0();
    try {
      const p = OGX.calc.production({ levels: intel.buildings, tempMax, research: intel.research || {}, server });
      return { metal: Math.max(0, +p.perHour.metal || 0), crystal: Math.max(0, +p.perHour.crystal || 0), deuterium: Math.max(0, +p.perHour.deuterium || 0) };
    } catch (e) { return res0(); }
  }
  /** Expected stock at `atMs`: report stock + production x dt, growing only while below storage (2Moons ExecCalc), capped there. */
  function expectedAt(intel, atMs, { tempMax = 40, server } = {}) {
    const out = res0();
    if (!intel || !intel.res) return out;
    const ph = perHourOf(intel, { tempMax, server });
    const dtH = Math.max(0, (+atMs || 0) - (+intel.ts || 0)) / H;
    const lv = (id) => num((intel.buildings || {})[id], 0);
    const cap = { metal: OGX.calc.storageCapacity(lv(22), server), crystal: OGX.calc.storageCapacity(lv(23), server), deuterium: OGX.calc.storageCapacity(lv(24), server) };
    for (const r of RES) {
      let v = Math.max(0, num(intel.res[r]));
      if (v < cap[r] && intel.buildings) v = Math.min(cap[r], v + ph[r] * dtH);
      out[r] = Math.floor(v);
    }
    return out;
  }
  const halvesOf = (r) => ({ metal: (+r.metal || 0) / 2, crystal: (+r.crystal || 0) / 2, deuterium: (+r.deuterium || 0) / 2 });
  /** Probe count: the suite setting spy.probes (OGX.api.spyProbes, default 1100 — the same count as Infinity «Шпионаж», «Почта»
   * and the game's spycount) is what is sent; the 2Moons formula (F7, MissionCaseSpy thresholds via OGX.botSim.spyNeeded: known
   * espionage level -> exact, unknown -> ours - 2, +2 per retry) is only the minimum: { probes: max(spy.probes, formula), min: formula }. */
  function probesFor({ ourSpy, theirSpy, theirSpyKnown, spyPower = 0, tries = 0, spyProbes = spyProbesSetting() }) {
    const S = OGX.botSim;
    const est = theirSpyKnown ? +theirSpy : Math.max(0, +ourSpy - 2) + 2 * tries;
    const n = Math.max(1, S.spyNeeded({ ourSpy: +ourSpy, theirSpy: est, spyPower, want: 'defense' }));
    return { probes: Math.max(n, Math.floor(num(spyProbes, 0))), min: n, theirSpyEstimate: est };
  }
  /** spy.probes (the Infinity «Шпионаж» setting, default 1100): via OGX.api.spyProbes, else the setting itself. */
  function spyProbesSetting() {
    let v = NaN;
    try { v = OGX.api && typeof OGX.api.spyProbes === 'function' ? +OGX.api.spyProbes() : parseInt(OGX.settings.get('spy.probes'), 10); } catch (e) { v = NaN; }
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 1100;
  }
  /** Intel object (C2.7) from an espionageFull result. */
  function intelFrom(rep, coordsKey, { ts, probesSent } = {}) {
    const known = rep.known || {};
    const units = (o, isKnown) => (isKnown ? cleanUnits(o) : null);
    const r = rep.resources || {};
    return {
      coordsKey, reportId: rep.id || null, ts: +ts || +rep.ts || null,
      res: { metal: num(r.metal), crystal: num(r.crystal), deuterium: num(r.deuterium) },
      ships: units(rep.ships, known.ships), defense: units(rep.defense, known.defense),
      buildings: known.buildings ? Object.fromEntries(Object.entries(rep.buildings || {}).map(([k, v]) => [+k, +v || 0])) : null,
      research: known.research ? Object.fromEntries(Object.entries(rep.research || {}).map(([k, v]) => [+k, +v || 0])) : null,
      known: { ships: !!known.ships, defense: !!known.defense, buildings: !!known.buildings, research: !!known.research },
      probesSent: probesSent || null, probesLost: rep.probesDestroyed === undefined ? null : !!rep.probesDestroyed,
      counterEspionage: rep.counterEspionage !== undefined ? rep.counterEspionage : null, exact: rep.exact !== undefined ? !!rep.exact : null,
    };
  }
  /** Defender Side for OGX.botSim from intel: units of sections 200 + 400 (no missiles); tech of section 100, else ours + 2 (conservative). */
  function defenderSide(intel, ourResearch) {
    const units = Object.assign({}, cleanUnits(intel.ships), cleanUnits(intel.defense));
    const rs = intel.research;
    const lv = (id) => (rs && rs[id] !== undefined ? +rs[id] : num((ourResearch || {})[id]) + 2);
    return { units, tech: { weapons: lv(109), shielding: lv(110), armour: lv(111) } };
  }
  const isUndefended = (intel) => !sumUnits(cleanUnits(intel.ships)) && !sumUnits(cleanUnits(intel.defense));
  /** Attacker Side: the fleetTable «Bonus» % when known (A9), else research levels. */
  function attackerSide(units, { bonus, research, storageFactor = 0 }) {
    const s = { units: Object.assign({}, units), storageFactor };
    if (bonus && Number.isFinite(+bonus.attack)) s.bonusPct = { attack: +bonus.attack || 0, defense: +bonus.defense || 0, shield: +bonus.shield || 0 };
    else s.tech = { weapons: num((research || {})[109]), shielding: num((research || {})[110]), armour: num((research || {})[111]) };
    return s;
  }
  /** Catalog requirements of a unit on a body: research from the player's levels; building levels from the body when the core
   * knows them; when it does not, a unit already present on that body proves its requirements (else: not allowed). */
  function reqMet(id, body, research) {
    let o = null;
    try { o = OGX.catalog.get(+id); } catch (e) { o = null; }
    if (!o) return false;
    const present = body && body.ships && +body.ships[id] > 0;
    for (const [rid, lvl] of o.req || []) {
      let ro = null;
      try { ro = OGX.catalog.get(+rid); } catch (e) { ro = null; }
      if (ro && ro.type === 'research') { if (num((research || {})[rid]) < +lvl) return false; continue; }
      if (body && body.levels && body.levels[rid] !== undefined) { if (+body.levels[rid] < +lvl) return false; continue; }
      if (!present) return false;
    }
    return true;
  }
  /** Simulation summary for the journal / plan (JSON-small). */
  function simSummary(sim, extra) {
    if (!sim) return Object.assign({ sim: null }, extra || {});
    return Object.assign({
      runs: sim.runs, win: sim.win, draw: sim.draw, loss: sim.loss,
      lootMsu: Math.round(sim.loot.mean.msu), lootP10Msu: Math.round((sim.loot.p10 || {}).msu || 0),
      attackerLossMsu: Math.round(sim.attackerLoss.mean.msu), netMsu: Math.round(sim.net.mean), netP10Msu: Math.round(sim.net.p10 || 0),
      debris: { mean: roundRes(sim.debris.mean), p10: roundRes(sim.debris.p10), p50: roundRes(sim.debris.p50) },
      moonChance: sim.moonChance ? Math.round(+sim.moonChance.mean || 0) : 0,
    }, extra || {});
  }
  /** Expected loot of a plan (cargo-limited), never the uncapped half of the planet's stock. */
  function lootOf(P) { return Number.isFinite(+P.lootExp) ? +P.lootExp : (P.sim && P.sim.loot ? +P.sim.loot.mean.msu || 0 : +P.lootMsu || 0); }
  /** calculateSteal of the plan's fleet on the expected stock (undefended targets have no simulation). */
  function stealOf(P) {
    try { return OGX.botSim.steal({ ships: P.ships, storageFactor: P.storageFactor || 0, planet: P.planet }); } catch (x) { return halvesOf(P.planet); }
  }
  function roundRes(r) { const o = {}; for (const k of Object.keys(r || {})) o[k] = Math.round(+r[k] || 0); return o; }

  // ------------------------------------------------------------------ target database (T.db inside botfarm.targets, one writer)
  /** Build cost of units in MSU (defense / fleet value of a target, own losses). */
  function unitsMsu(units) {
    const m = res0();
    for (const [id, n] of Object.entries(units || {})) {
      if (!(+n > 0)) continue;
      let c = null;
      try { c = OGX.calc.unitCost(+id, +n); } catch (e) { c = null; }
      if (c) for (const r of RES) m[r] += +c[r] || 0;
    }
    return msu(m);
  }
  function dbOf(T) {
    if (!T.db || typeof T.db !== 'object') T.db = {};
    const d = T.db;
    if (!Array.isArray(d.reports)) d.reports = [];
    if (!Array.isArray(d.raids)) d.raids = [];
    d.totals = Object.assign({ spies: 0, probesLostMsu: 0, raids: 0, lootMsu: 0, predMsu: 0, fuelMsu: 0, lossMsu: 0 }, d.totals || {});
    return d;
  }
  /** A spy report enters the database: stock, defense / fleet value, production per hour (x22000 calc from section 0). */
  function dbReport(T, intel, server) {
    const d = dbOf(T);
    const ph = perHourOf(intel, { server });
    const row = { ts: +intel.ts || Date.now(), resMsu: Math.round(msu(intel.res || res0())), res: roundRes(intel.res || res0()),
      defMsu: intel.known && intel.known.defense ? Math.round(unitsMsu(intel.defense)) : null, fleetMsu: intel.known && intel.known.ships ? Math.round(unitsMsu(intel.ships)) : null,
      prodMsuH: Math.round(msu(ph)), probesLost: !!intel.probesLost };
    d.reports = d.reports.filter((x) => x.ts !== row.ts).concat([row]).sort((a, b) => a.ts - b.ts).slice(-DB_REPORTS);
    d.last = row;
    d.defense = intel.known && intel.known.defense ? cleanUnits(intel.defense) : d.defense || null;
    d.fleet = intel.known && intel.known.ships ? cleanUnits(intel.ships) : d.fleet || null;
    d.prodMsuH = row.prodMsuH;
    if (intel.probesLost && intel.probesSent) d.totals.probesLostMsu += Math.round(msu({ crystal: 1000 * +intel.probesSent }));
    return row;
  }
  function dbVerdict(T, kind, text, extra) { dbOf(T).verdict = Object.assign({ kind, text, t: Date.now() }, extra || {}); }
  function dbRaidSent(T, A, P) {
    const d = dbOf(T);
    const lossMsu = P.sim ? Math.round(P.sim.attackerLoss.mean.msu) : 0;
    d.raids = d.raids.concat([{ id: A.id, t: A.sentAt, arrival: A.arrival, origin: A.originCoords, ships: A.ships, predMsu: Math.round(lootOf(P)), fuelMsu: Math.round(msu({ deuterium: P.fuel })), predLossMsu: lossMsu, lootMsu: null, lossMsu: null, result: 'flying' }]).slice(-DB_RAIDS);
    d.totals.raids++;
    d.totals.predMsu += Math.round(lootOf(P));
    d.totals.fuelMsu += Math.round(msu({ deuterium: P.fuel }));
  }
  function dbRaidResult(T, A, { lootMsu, lossMsu, result }) {
    const d = dbOf(T);
    const r = d.raids.find((x) => x.id === A.id);
    if (!r || r.lootMsu !== null) return;
    r.lootMsu = Math.round(+lootMsu || 0); r.lossMsu = Math.round(+lossMsu || 0); r.result = result || 'done';
    d.totals.lootMsu += r.lootMsu; d.totals.lossMsu += r.lossMsu;
  }
  /** Own attacks on this target in the last 24 h (server limit «attacks per day on one destination»). */
  function attacks24(T, now) { return dbOf(T).raids.filter((r) => r.t > now - 24 * H && r.result !== 'refused').length; }
  /** Net of the database: actual loot (predicted until the combat report is read) minus fuel, losses and lost probes. */
  function dbNet(T) {
    const d = dbOf(T); const t = d.totals;
    let loot = 0;
    for (const r of d.raids) loot += r.lootMsu !== null ? r.lootMsu : (r.result === 'done' ? r.predMsu : 0);
    const lootAll = Math.max(t.lootMsu, loot);
    return Math.round(lootAll - t.fuelMsu - t.lossMsu - t.probesLostMsu);
  }
  /** When the expected loot (half of the stock, growing with the target's production, capped by storage) reaches minLoot:
   * bisection over expectedAt(); null = never (no production / storage too small), else ServerMs. */
  function regrowAt(intel, minLoot, now, server) {
    if (!intel || !intel.res) return null;
    const lootAt = (t) => msu(halvesOf(expectedAt(intel, t, { server })));
    if (lootAt(now) >= minLoot) return now;
    if (lootAt(now + REGROW_MAX) < minLoot) return null;
    let lo = now; let hi = now + REGROW_MAX;
    for (let i = 0; i < 40 && hi - lo > 60000; i++) { const mid = Math.floor((lo + hi) / 2); if (lootAt(mid) >= minLoot) hi = mid; else lo = mid; }
    return hi;
  }

  // ------------------------------------------------------------------ module state (shared by the two workers of this tab)
  const M = { targets: {}, attacks: {}, cal: {}, scanAt: {}, loaded: false, busy: 0, ctx: null, handle: null, escortHandle: null, lastRun: null };
  async function load(force) {
    if (M.loaded && !force) return;
    if (M.busy > 1 && M.loaded) return;   // the other worker of this tab holds newer in-memory data
    const st = M.ctx.store;
    const [t, a, c, s] = await Promise.all([st.get('targets', {}), st.get('attacks', {}), st.get('cal', {}), st.get('scanAt', {})]);
    M.targets = t && typeof t === 'object' ? t : {};
    M.attacks = a && typeof a === 'object' ? a : {};
    M.cal = c && typeof c === 'object' ? c : {};
    M.scanAt = s && typeof s === 'object' ? s : {};
    M.loaded = true;
  }
  async function save(...keys) {
    const st = M.ctx.store;
    for (const k of keys.length ? keys : ['targets', 'attacks', 'cal', 'scanAt']) await st.set(k, clone(M[k]));
  }
  function setState(wctx, T, state, why, extra) {
    const from = T.state;
    T.state = state;
    T.stateAt = wctx.now();
    if (why) T.note = why;
    if (extra) Object.assign(T, extra);
    if (from !== state) wctx.rec('state', `[${T.coords}] ${stateRu(from)} → ${stateRu(state)}${why ? ': ' + why : ''}`, { key: T.key, from, to: state, why });
  }
  function stateRu(s) {
    return { new: 'новая', probing: 'шпионаж', reported: 'есть доклад', needMoreProbes: 'нужно больше зондов', waitShips: 'ждёт корабли',
      attackFlying: 'атака в полёте', notSuitable: 'не подходит', vacation: 'отпуск', gone: 'нет планеты', probesLost: 'нет доклада', attackLimit: 'лимит атак в сутки',
      needFleet: 'нужен флот больше', poor: 'мало ресурсов' }[s] || s || '—';
  }
  function cooldown(wctx, T, state, why, ms) {
    setState(wctx, T, state, why, { cooldownUntil: wctx.now() + (ms || COOLDOWN[state] || COOLDOWN.notSuitable) });
    wctx.rec('cooldown', `[${T.coords}] пауза до ${fmtT(T.cooldownUntil)}: ${why}`, { key: T.key, until: T.cooldownUntil, state, why });
  }
  function skip(wctx, what, reason, data) { wctx.rec('skip', what, Object.assign({ reason }, data || {})); }

  // ------------------------------------------------------------------ environment per run (research, ships, flight estimates)
  async function runEnv(wctx) {
    // research levels (espionage 106, weapons 109..111): the core knows them only after page=research / imperium was seen
    let rs = await OGX.state.research().catch(() => null);
    if (!rs || !rs.levels || rs.levels[106] === undefined) {
      if (!M._researchReadAt || wctx.now() - M._researchReadAt > 30 * 60000) {
        M._researchReadAt = wctx.now();
        wctx.decide('Читаю исследования', { why: 'уровень шпионажа и боевых технологий неизвестен (страница исследований не открывалась)', inputs: {}, chosen: 'read.page research', alternatives: [] });
        await wctx.act({ type: 'read.page', prio: 'read', params: { page: 'research' }, why: 'Фарм: уровни исследований' });
      }
    }
    const [research, server, stats, factors, bonus, bodies] = await Promise.all([
      OGX.state.research().then((r) => (r && r.levels) || {}).catch(() => ({})),
      OGX.state.server().catch(() => ({})),
      OGX.state.shipStats().catch(() => ({})),
      (OGX.state.factors ? OGX.state.factors() : Promise.resolve(null)).catch(() => null),
      OGX.state.combatBonus().catch(() => null),
      wctx.bodies(),
    ]);
    const fleetSpeed = server && server.fleetSpeedKnown ? +server.fleetSpeed : (+(M.cal.fleetSpeed || 0) || +((server || {}).fleetSpeed) || 7);
    return { research, server: server || {}, stats: stats || {}, factors, bonus, bodies: bodies || {}, fleetSpeed,
      storageFactor: storageFactorOf(stats, factors) };
  }
  /** Cargo factor - 1 for the simulator, the same as the core's cargo: state.shipStats()[217].cargo (the measured fleetroom factor
   * or base x (1 + Storage expert 607)) over the catalog base; without it the officer sum of state.factors(). */
  function storageFactorOf(stats, factors) {
    const s = stats && stats[TRANSPORT];
    let base = 0;
    try { base = OGX.calc.cargoCapacity(TRANSPORT); } catch (e) { base = 0; }
    if (s && +s.cargo > 0 && base > 0) return Math.max(0, +s.cargo / base - 1);
    return factors && Number.isFinite(+factors.ShipStorage) ? +factors.ShipStorage : 0;
  }
  /** Cargo of one Battle Transporter (core shipStats incl. officer / measured factor, else catalog x (1 + sf)). */
  function transportCap(env) {
    const s = env.stats && env.stats[TRANSPORT];
    if (s && +s.cargo > 0) return +s.cargo;
    let base = 0;
    try { base = OGX.calc.cargoCapacity(TRANSPORT); } catch (e) { base = 40000000; }
    return base * (1 + (+env.storageFactor || 0));
  }
  function est(env, from, to, ships, speed = 10, gamespeed) {
    const fg = OGX.fleet.gz;
    const d = fg.dataFor(ships, env.stats, { fleetSpeed: gamespeed || env.fleetSpeed }, env.factors);
    const distance = fg.distance(from, to);
    if (distance === null) return { duration: Infinity, fuel: Infinity, distance: null, raw: Infinity };
    const duration = fg.duration(d, distance, speed);
    const fuel = Number.isFinite(duration) ? fg.consumption(d, distance, duration) : Infinity;
    return { duration, fuel, distance, raw: fg.durationRaw(d, distance, speed) };
  }
  /** Fleet speed calibration from a real send (one-way seconds measured by the server): the bot executor does not merge
   * fleetStep1 pages into state, so state.server().fleetSpeed stays the default 7 until the user opens one. */
  function calibrate(env, from, to, ships, speed, measuredSec) {
    if (!(measuredSec > 8)) return;
    const base = est(env, from, to, ships, speed, 1).raw;
    if (!Number.isFinite(base) || base <= 0) return;
    const gs = base / measuredSec;
    if (gs > 0.5 && gs < 100000) M.cal.fleetSpeed = Math.round(gs * 100) / 100;
  }
  function originList(wctx, env) {
    const want = wctx.cfg('origins');
    const all = Object.values(env.bodies || {}).filter((b) => b && b.coords && b.id);
    if (!Array.isArray(want) || !want.length) return all;
    return all.filter((b) => want.some((w) => {
      const s = String(w).trim();
      return s === String(b.id) || s === b.key || s === b.coords || (b.type === 'moon' && s === b.coords + ':3');
    }));
  }
  const bodyKey = (b) => b.key || ((b.type === 'moon' ? 'm' : 'p') + b.id);
  /** Ship counts of a body; re-read page=fleetTable (free) when unknown or older than maxAgeMs. */
  async function freshShips(wctx, env, body, maxAgeMs = 10 * 60000) {
    // a fleet that came home (bot:fleet-returned, or an own attack past its return time) makes every older count stale
    const ret = Math.max(+((M.returnedAt || {})[body.id]) || 0, +((M.staleAt || {})[body.id]) || 0);
    if (body.shipsT && body.shipsT > ret && wctx.now() - body.shipsT < maxAgeMs && body.ships) return body.ships;
    const seen = (M.shipsSeen = M.shipsSeen || {})[body.id];
    if (seen && seen.t > ret && wctx.now() - seen.t < maxAgeMs && !(body.shipsT && body.shipsT > seen.t)) { body.ships = Object.assign({}, seen.ships); return body.ships; }
    if (env._read && env._read[body.id]) return body.ships || {};
    env._read = env._read || {};
    env._read[body.id] = true;
    wctx.decide(`Читаю флот на ${body.coords}`, { why: 'нужны свежие данные о кораблях на теле отправки', inputs: { bodyId: body.id, shipsT: body.shipsT || null }, chosen: 'read.fleetTable', alternatives: [] });
    // the core may answer from its read cache (another module read this fleetTable < 30 s ago): fine, unless that read was
    // taken before the fleet came home / the ships were built
    let r = await wctx.act({ type: 'read.fleetTable', bodyId: body.id, prio: 'read', params: {}, why: 'Фарм: корабли на ' + body.coords });
    if (ret && r && r.ok && +r.at > 0 && +r.at < ret) r = await wctx.act({ type: 'read.fleetTable', bodyId: body.id, prio: 'read', fresh: true, params: {}, why: 'Фарм: корабли на ' + body.coords });
    if (r && r.ok && r.data && r.data.fleetTable) {
      const ships = {};
      for (const s of r.data.fleetTable.ships || []) ships[s.id] = +s.count || 0;
      const seenAt = Math.max(ret + 1, Math.min(wctx.now(), +r.at || wctx.now()));
      body.ships = ships; body.shipsT = seenAt;
      M.shipsSeen[body.id] = { t: seenAt, ships: Object.assign({}, ships) };
      return ships;
    }
    return body.ships || {};
  }
  /** Ships just sent leave the body: keep this run's and the cached counts honest until the next fleetTable read. */
  function deduct(env, body, ships) {
    const sub = (o) => { if (!o) return; for (const [id, n] of Object.entries(ships || {})) o[id] = Math.max(0, (+o[id] || 0) - (+n || 0)); };
    sub(body.ships);
    const seen = M.shipsSeen && M.shipsSeen[body.id];
    if (seen) sub(seen.ships);
    const b2 = env.bodies && env.bodies[bodyKey(body)];
    if (b2 && b2 !== body) sub(b2.ships);
  }
  /** Ships came home to a body: the next freshShips() reads its fleetTable again. */
  function markReturned(bodyId, t) {
    if (!(+bodyId > 0)) return;
    (M.returnedAt = M.returnedAt || {})[+bodyId] = Math.max(+((M.returnedAt || {})[+bodyId]) || 0, +t || Date.now());
    if (M.shipsSeen) delete M.shipsSeen[+bodyId];
  }
  function forgetShips(env, bodyId) {
    if (M.shipsSeen) delete M.shipsSeen[bodyId];
    let t = Date.now();
    try { t = OGX.time.serverNow(); } catch (e) { /* local clock */ }
    (M.staleAt = M.staleAt || {})[bodyId] = t;   // a cached fleetTable read before this is not trusted
    for (const b of Object.values(env.bodies || {})) if (b && +b.id === +bodyId) b.shipsT = 0;
    if (env._read) delete env._read[bodyId];
  }
  /** Return lands inside a threat lock of the origin (C2.6): threat arrival - threatLockSec .. arrival + 60 s. */
  function returnLocked(wctx, bkey, backMs) {
    const lockSec = num(wctx.core('threatLockSec'), 3600);
    for (const t of wctx.threats() || []) {
      if (t.bodyKey !== bkey || t.probesOnly || t.mission === 10) continue;
      if (backMs >= t.arrival - lockSec * 1000 && backMs <= t.arrival + 60000) return t;
    }
    return null;
  }

  // ------------------------------------------------------------------ discovery
  /** Cached galaxy row of g:s, reading the galaxy key once per pass (`gal` memo). Falls back to OGX.galaxy.cached. */
  async function cachedSystem(gal, g, s) {
    if (OGX.galaxy && typeof OGX.galaxy._expand === 'function' && OGX.storage && typeof OGX.storage.get === 'function') {
      if (!(g in gal)) { try { gal[g] = await OGX.storage.get('galaxy.g' + g, null, { scope: 'server' }); } catch (e) { gal[g] = null; } }
      return gal[g] && gal[g][s] ? OGX.galaxy._expand(+g, +s, gal[g][s]) : null;
    }
    return OGX.galaxy.cached(g, s);
  }
  async function discover(wctx, env, origins) {
    const radius = num(wctx.cfg('scanRadius'), 15);
    const includeShort = wctx.cfg('includeShortInactive') !== false;
    const minRank = num(wctx.cfg('minRank'), 0);
    const exclude = wctx.cfg('exclude');
    const systems = new Map();
    const whole = wctx.cfg('scanScope') !== 'radius';
    const maxSys = 499;
    for (const o of origins) {
      const [g, s] = OGX.util.coordsArr(o.coords) || [];
      if (!g) continue;
      // 'galaxy' (default): every system of each galaxy that holds an own body, ordered by distance from the nearest one
      const lo = whole ? 1 - s : -radius; const hi = whole ? maxSys - s : radius;
      for (let d = lo; d <= hi; d++) { const ss = s + d; if (ss >= 1 && ss <= maxSys) { const k = g + ':' + ss; const dist = Math.abs(d); if (!systems.has(k) || systems.get(k) > dist) systems.set(k, dist); } }
    }
    // optional galaxy scan (costs deuterium; budget botcore.galaxyViewsPerHour)
    if (wctx.cfg('scanGalaxy') === true) await scanSystems(wctx, systems);
    const now = wctx.now();
    let seen = 0; let fresh = 0;
    const found = [];
    const gal = {};   // one storage read per galaxy (galaxy.cached clones the whole galaxy key on every call)
    const seenPos = new Set();
    for (const k of systems.keys()) {
      const [g, s] = k.split(':').map(Number);
      let sys = null;
      try { sys = await cachedSystem(gal, g, s); } catch (e) { sys = null; }
      if (!sys || !Array.isArray(sys.positions)) continue;
      seen++;
      for (const p of sys.positions) if (p && p.position) seenPos.add([g, s, p.position].join(':') + ':1');
      // a planet of the database that the newer galaxy view no longer shows: gone (destroyed / abandoned)
      for (let pos = 1; pos <= 15; pos++) {
        const T0 = M.targets[[g, s, pos, 1].join(':')];
        const row = sys.positions.find((x) => x && +x.position === pos);
        if (T0 && sys.t && +sys.t > (+T0.galaxyT || 0) && (!row || !row.playerName) && T0.state !== 'attackFlying' && T0.state !== 'gone') {
          cooldown(wctx, T0, 'gone', 'планеты больше нет в галактике', COOLDOWN.gone);
          T0.galaxyT = +sys.t;
          dbVerdict(T0, 'gone', 'планеты нет в галактике');
        }
      }
      for (const p of sys.positions) {
        if (!p || p.own || !p.playerName) continue;
        const coords = [g, s, p.position].join(':');
        const key = coords + ':1';
        const cls = inactiveClass(p.status, { includeShort });
        const T = M.targets[key];
        if (!cls) {
          if (T && /v/.test(String(p.status || '')) && T.state !== 'vacation' && T.state !== 'attackFlying') cooldown(wctx, T, 'vacation', 'игрок в режиме отпуска (галактика)');
          else if (/v/.test(String(p.status || '')) && /[iI]/.test(String(p.status || ''))) {
            if (!M._vacSkip || !M._vacSkip[key]) { (M._vacSkip = M._vacSkip || {})[key] = 1; skip(wctx, `[${coords}] ${p.playerName}: режим отпуска — не цель`, 'vacation', { key, status: p.status }); }
          }
          continue;
        }
        if (minRank > 0 && p.rank !== null && p.rank !== undefined && +p.rank < minRank) { skip(wctx, `[${coords}] ${p.playerName}: место ${p.rank} выше ${minRank}`, 'rank', { key }); continue; }
        if (excluded(exclude, { coords, playerId: p.playerId, playerName: p.playerName })) { skip(wctx, `[${coords}] исключено настройкой`, 'exclude', { key }); continue; }
        found.push(key);
        if (!T) {
          M.targets[key] = { key, coords, target: tgtOf(key), playerId: p.playerId ?? null, playerName: p.playerName, status: p.status || '', cls, rank: p.rank ?? null,
            planetId: p.planetId || null, moon: !!p.moon, debris: p.debris ? { metal: num(p.debris.metal), crystal: num(p.debris.crystal) } : null,
            galaxyT: sys.t || null, state: 'new', stateAt: now, tries: 0, created: now, lastSeen: sys.t || now };
          fresh++;
          wctx.rec('target', `Новая цель [${coords}] ${p.playerName} (${cls === 'I' ? 'I' : 'i'}${p.rank ? ', место ' + p.rank : ''})`, { key, player: p.playerName, status: p.status, rank: p.rank ?? null, planetId: p.planetId || null });
        } else {
          Object.assign(T, { playerId: p.playerId ?? T.playerId, playerName: p.playerName, status: p.status || '', cls, rank: p.rank ?? T.rank,
            planetId: p.planetId || T.planetId, debris: p.debris ? { metal: num(p.debris.metal), crystal: num(p.debris.crystal) } : null,
            galaxyT: sys.t || T.galaxyT, lastSeen: Math.max(+T.lastSeen || 0, +sys.t || 0) || T.lastSeen });
          if (T.state === 'vacation' && T.cooldownUntil && T.cooldownUntil < now) setState(wctx, T, 'new', 'отпуск закончился');
          if (T.state === 'gone' && sys.t && +sys.t > (+T.stateAt || 0)) setState(wctx, T, 'new', 'планета снова в галактике', { cooldownUntil: null });
          if (p.moon && !T.moon && T.state !== 'attackFlying') T.moon = true;
        }
      }
    }
    if (fresh || !M._scanJournaled || now - M._scanJournaled > 30 * 60000) {
      M._scanJournaled = now;
      wctx.rec('scan', `Галактика (кэш): систем ${seen} из ${systems.size}, целей ${found.length}, новых ${fresh}`, { systems: systems.size, cached: seen, targets: found.length, fresh });
    }
    return found;
  }
  async function scanSystems(wctx, systems) {
    const per = num(wctx.core('galaxyViewsPerHour'), 0);
    if (per <= 0) { if (!M._scanOff) { M._scanOff = 1; skip(wctx, 'Сканирование галактики выключено лимитом (0 просмотров в час)', 'galaxyBudget'); } return; }
    const st = OGX.bot.status();
    const used = st && st.limits && st.limits.galaxyViews ? st.limits.galaxyViews.used : 0;
    let budget = Math.min(per - used, num(wctx.cfg('scanPerCycle'), 40));
    const gal = {};
    const every = num(wctx.cfg('scanEveryH'), 24) * H;
    const order = [...systems.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    for (const k of order) {
      if (budget <= 0) break;
      const [g, s] = k.split(':').map(Number);
      let sys = null;
      try { sys = await cachedSystem(gal, g, s); } catch (e) { sys = null; }
      const last = Math.max(+(M.scanAt[k] || 0), sys && sys.t ? +sys.t : 0);
      if (last && wctx.now() - last < every) continue;
      wctx.decide(`Просмотр галактики ${k}`, { why: 'поиск неактивных (стоит дейтерий)', inputs: { system: k, lastSeen: last || null, budgetLeft: budget }, chosen: 'read.galaxy', alternatives: ['кэш галактики'] });
      const r = await wctx.act({ type: 'read.galaxy', prio: 'read', params: { galaxy: g, system: s }, why: 'Фарм: поиск целей в ' + k });
      M.scanAt[k] = wctx.now();
      budget--;
      if (r && r.dry) continue;
      if (!r || !r.ok) { skip(wctx, 'Просмотр галактики не удался: ' + ((r && (r.refused || r.message || r.error)) || '?'), 'galaxy', { system: k }); break; }
    }
    await save('scanAt');
  }

  // ------------------------------------------------------------------ reports (spy cat 0, combat cat 3)
  /** One message category. fresh: never the core's cached list (a retry, the escort right before a recall decision);
   *  notBefore (ServerMs): a cached list older than this (read before the report could exist) is read again. */
  async function readCategory(wctx, cat, why, { fresh = false, notBefore = 0 } = {}) {
    if (wctx.core('readMessages') === false) { if (!M._rmOff || wctx.now() - M._rmOff > 30 * 60000) { M._rmOff = wctx.now(); skip(wctx, 'Чтение сообщений выключено (botcore.readMessages): доклады не читаются', 'readMessagesOff'); } return null; }
    wctx.decide(`Читаю сообщения (категория ${cat})`, { why, inputs: { cat, fresh: !!fresh }, chosen: 'read.messages', alternatives: [] });
    let r = await wctx.act({ type: 'read.messages', prio: 'read', fresh: !!fresh, params: { cat, site: 1 }, why: 'Фарм: ' + why });
    if (!fresh && notBefore && r && r.ok && !r.dry && +r.at > 0 && +r.at < notBefore) r = await wctx.act({ type: 'read.messages', prio: 'read', fresh: true, params: { cat, site: 1 }, why: 'Фарм: ' + why });
    if (!r || r.dry || !r.ok || !r.data || !r.data.doc) return { dry: !!(r && r.dry), items: [] };
    let items = [];
    try { items = OGX.messages.parse.list(r.data.doc) || []; } catch (e) { items = []; }
    return { items, doc: r.data.doc };
  }
  /** Spy report rows of a list for the coordinates, not older than sinceMs (list date = probes' arrival). */
  function spyReportsFor(list, coords, sinceMs) {
    const out = [];
    for (const it of list.items || []) {
      if (it.kind && it.kind !== 'spy_report') continue;
      let rep = null;
      try { rep = OGX.messages.parse.espionageFull(it.li || it); } catch (e) { rep = null; }
      if (!rep) continue;
      const ap = rep.attackParams;
      const c = ap ? [ap.galaxy, ap.system, ap.position].join(':') : (rep.target && rep.target.coordsStr);
      if (c !== coords) continue;
      const ts = +it.ts || +rep.ts || 0;
      if (sinceMs && ts && ts < sinceMs - 5000) continue;
      out.push({ rep, ts, id: it.id || rep.id });
    }
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }
  async function processSpyReports(wctx, env) {
    const now = wctx.now();
    const due = Object.values(M.targets).filter((T) => T.state === 'probing' && T.spy && T.spy.reportAt && T.spy.reportAt <= now);
    if (!due.length) return;
    const list = await readCategory(wctx, 0, 'шпионские доклады (' + due.map((T) => T.coords).join(', ') + ')',
      { fresh: due.some((T) => (T.spy.reads || 0) > 0), notBefore: Math.max(...due.map((T) => num(T.spy.arrival))) + 1000 });
    if (!list) { for (const T of due) cooldown(wctx, T, 'notSuitable', 'чтение сообщений выключено', COOLDOWN.noReport); await save('targets'); return; }
    if (list.dry) return;
    const processed = [];
    for (const T of due) {
      const hits = spyReportsFor(list, T.coords, T.spy.sentAt);
      if (!hits.length) {
        T.spy.reads = (T.spy.reads || 0) + 1;
        if (T.spy.reads >= 3 || now > (T.spy.arrival || now) + 10 * 60000) cooldown(wctx, T, 'probesLost', 'доклад не найден (зонды не вернулись или сообщение не пришло)');
        else T.spy.reportAt = now + rnd(20000, 50000);
        continue;
      }
      const h = hits[0];
      const intel = intelFrom(h.rep, T.key, { ts: h.ts, probesSent: T.spy.probes });
      OGX.bot.intel.put(T.key, intel);
      try { dbReport(T, intel, env && env.server); } catch (x) { /* the database is a view: never blocks the farm */ }
      processed.push(h.id);
      T.lastReportAt = intel.ts; T.reportId = intel.reportId;
      if (intel.research && intel.research[106] !== undefined) { T.theirSpy = +intel.research[106]; T.theirSpyKnown = true; }
      const units = { ships: intel.ships, defense: intel.defense };
      wctx.rec('report', `Доклад [${T.coords}]: ${fmtN(msu(intel.res))} МСУ; флот ${intel.known.ships ? shipsRu(intel.ships) : '?'}; оборона ${intel.known.defense ? shipsRu(intel.defense) : '?'}`,
        { key: T.key, reportId: intel.reportId, ts: intel.ts, res: intel.res, known: intel.known, units, research: intel.research, probes: T.spy.probes, probesLost: intel.probesLost, exact: intel.exact, counterEspionage: intel.counterEspionage });
      if (!intel.known.ships || !intel.known.defense) {
        T.tries = (T.tries || 0) + 1;
        if (T.tries > num(wctx.cfg('maxProbeRetries'), 2)) cooldown(wctx, T, 'notSuitable', 'флот/оборона не видны даже после ' + (T.tries - 1) + ' повторов');
        else setState(wctx, T, 'needMoreProbes', 'в докладе нет ' + (!intel.known.ships ? 'флота' : 'обороны') + ': больше зондов');
      } else {
        T.tries = 0;
        setState(wctx, T, 'reported', 'доклад получен');
      }
      T.spy = null;
    }
    await save('targets');
    if (processed.length && wctx.cfg('deleteReports') === true) {
      wctx.decide('Удаляю обработанные доклады', { why: 'настройка «удалять доклады»; только свои обработанные шпионские доклады', inputs: { ids: processed }, chosen: 'messages.delete', alternatives: [] });
      await wctx.act({ type: 'messages.delete', prio: 'read', params: { ids: processed, cat: 0 }, why: 'Фарм: удалить ' + processed.length + ' докладов' });
    }
  }
  async function processCombatReports(wctx) {
    const now = wctx.now();
    const due = Object.values(M.attacks).filter((A) => (A.status === 'flying' || A.status === 'done') && !A.combatRead && A.arrival + 5000 <= now && now - A.arrival < 6 * H);
    if (!due.length || wctx.core('readMessages') === false) { for (const A of due) A.combatRead = 'skipped'; return; }
    const list = await readCategory(wctx, 3, 'боевые доклады для сверки добычи', { fresh: due.some((A) => (A.combatTries || 0) > 0), notBefore: Math.max(...due.map((A) => num(A.arrival))) + 1000 });
    if (!list || list.dry) return;
    for (const A of due) {
      let hit = null;
      for (const it of list.items) {
        let b = null;
        try { b = OGX.messages.parse.battleShort(it.li || it); } catch (e) { b = null; }
        if (!b || b.coords !== A.coords) continue;
        const ts = +it.ts || +b.ts || 0;
        if (ts && Math.abs(ts - A.arrival) > 120000) continue;
        hit = b; break;
      }
      A.combatRead = hit ? 'yes' : (A.combatTries = (A.combatTries || 0) + 1) >= 2 ? 'missing' : null;
      if (!hit) continue;
      const actual = { metal: num(hit.loot && hit.loot.metal), crystal: num(hit.loot && hit.loot.crystal), deuterium: num(hit.loot && hit.loot.deuterium) };
      const pred = A.predictedLoot || res0();
      const ratio = msu(pred) > 0 ? msu(actual) / msu(pred) : null;
      (M.cal.loot = M.cal.loot || []).push({ t: now, key: A.key, pred: msu(pred), actual: msu(actual) });
      {
        const T0 = M.targets[A.key];
        const lossRaw = hit.attacker && Number.isFinite(+hit.attacker.losses) ? +hit.attacker.losses : null;
        const plan = A.plan || {};
        if (T0) dbRaidResult(T0, A, { lootMsu: msu(actual), lossMsu: lossRaw !== null ? lossRaw : num(plan.attackerLossMsu), result: hit.winner === 'a' || msu(actual) > 0 ? 'won' : (hit.winner === 'w' || hit.winner === 'draw' ? 'draw' : 'done') });
      }
      if (M.cal.loot.length > 50) M.cal.loot.splice(0, M.cal.loot.length - 50);
      wctx.rec('report', `Бой [${A.coords}]: добыча ${fmtN(msu(actual))} МСУ, прогноз ${fmtN(msu(pred))} МСУ${ratio !== null ? ' (' + Math.round(ratio * 100) + ' %)' : ''}`,
        { key: A.key, battle: A.id, kind: 'combat', winner: hit.winner || null, loot: actual, predicted: pred, ratio, debris: hit.debris || null, predictedDebris: A.debrisP50 || null, reportId: hit.reportId || null });
    }
    await save('attacks', 'cal');
  }

  // ------------------------------------------------------------------ espionage
  async function spyTarget(wctx, env, T, origins, { reason }) {
    const ourSpy = num(env.research[106], 0);
    const spyPower = env.factors && Number.isFinite(+env.factors.SpyPower) ? +env.factors.SpyPower : 0;
    const p = probesFor({ ourSpy, theirSpy: T.theirSpy, theirSpyKnown: !!T.theirSpyKnown, spyPower, tries: T.tries || 0 });
    // spy.probes from the nearest origin that has them (moon wins ties), not locked; a body with fewer sends what it has (like
    // the game's spycount: min(setting, probes there)) when that still meets the formula minimum
    const cands = [];
    for (const b of origins) {
      const bk = bodyKey(b);
      if (wctx.locked(bk)) { cands.push({ b, why: 'угроза' }); continue; }
      const ships = await freshShips(wctx, env, b);
      const have = +ships[PROBE] || 0;
      if (have < p.min) { cands.push({ b, why: 'зондов ' + have + ' < ' + p.min }); continue; }
      cands.push({ b, ok: true, n: Math.min(p.probes, have), dist: OGX.fleet.gz.distance(b.coords, T.coords) });
    }
    const ok = cands.filter((c) => c.ok).sort((a, b) => (b.n >= p.probes) - (a.n >= p.probes) || a.dist - b.dist || (a.b.type === 'moon' ? -1 : 0) - (b.b.type === 'moon' ? -1 : 0));
    if (!ok.length) {
      const locked = cands.filter((c) => c.why === 'угроза').length;
      skip(wctx, `[${T.coords}] шпионаж: нет тела с ${p.min} зондами` + (locked ? ` (под угрозой: ${locked})` : ''), locked && locked === cands.length ? 'threat' : 'noProbes', { key: T.key, probes: p.probes, min: p.min, origins: cands.map((c) => ({ id: c.b.id, why: c.why || null })) });
      return { stop: false };
    }
    const o = ok[0].b;
    const n = ok[0].n;
    const e = est(env, o.coords, T.coords, { [PROBE]: n }, 10);
    const back = wctx.now() + 2 * (Number.isFinite(e.duration) ? e.duration : 60) * 1000;
    const sl = wctx.sleepCheck(back);
    if (!sl.ok) { skip(wctx, `[${T.coords}] шпионаж: возврат во время сна`, 'sleep', { key: T.key, back }); return { stop: true }; }
    if (returnLocked(wctx, bodyKey(o), back)) { skip(wctx, `[${T.coords}] шпионаж: возврат в окно угрозы на ${o.coords}`, 'threat', { key: T.key }); return { stop: false }; }
    const cs = await wctx.canSend('normal');
    // the slots this module holds for the escorts of its flying attacks are not free for a normal spy either (canSend only
    // subtracts OTHER modules' holds)
    const ownHolds = Object.values(M.attacks).filter((a) => a.status === 'flying' && a.arrival > wctx.now() && a.escort && a.escort.hold).length;
    const room = Number.isFinite(+cs.free) ? +cs.free - num(cs.held) - ownHolds : -1;
    if (!cs.ok || room <= num(cs.reserve)) { skip(wctx, `Шпионаж: нет свободного слота (свободно ${cs.free}, резерв ${cs.reserve}${ownHolds ? ', держу ' + ownHolds + ' для сопровождений' : ''})`, 'slots', { key: T.key, free: cs.free, reserve: cs.reserve, ownHolds, slotsReason: cs.reason }); return { stop: true }; }
    const ajax = wctx.cfg('useFleetAjax') === true && T.planetId;
    wctx.decide(`Шпионаж [${T.coords}] ${n} зонд(ов) с ${o.coords}`, {
      why: reason + `; зондов по настройке «Зондов на шпионаж» ${p.probes}` + (n < p.probes ? ` (на ${o.coords} только ${n})` : '') + `, минимум по формуле 2Moons ${p.min}: наш шпионаж ${ourSpy}, их ${T.theirSpyKnown ? T.theirSpy : '≈' + p.theirSpyEstimate}`,
      inputs: { key: T.key, probes: n, want: p.probes, min: p.min, ourSpy, theirSpy: T.theirSpyKnown ? T.theirSpy : null, theirSpyEstimate: p.theirSpyEstimate, tries: T.tries || 0, spyPower, origin: o.id, duration: e.duration, slotsFree: cs.free },
      chosen: ajax ? 'fleet.ajax 6' : 'fleet.send 6', alternatives: ok.slice(1, 4).map((c) => c.b.coords),
    });
    const spec = ajax
      ? { type: 'fleet.ajax', bodyId: o.id, prio: 'fleet', params: { mission: 6, planetId: +T.planetId }, why: `Фарм: шпионаж [${T.coords}]`, dedupeKey: 'botfarm:spy:' + T.key, returnAt: back }
      : { type: 'fleet.send', bodyId: o.id, prio: 'fleet', params: { target: T.target, ships: { [PROBE]: n }, mission: 6, speed: 10 }, why: `Фарм: шпионаж [${T.coords}] ${n} зонд.`, dedupeKey: 'botfarm:spy:' + T.key, plan: { probes: n, origin: o.id }, returnAt: back };
    const sentAt = wctx.now();
    const r = await wctx.act(spec);
    if (r.dry) { T.dryAt = wctx.now(); T.note = 'пробный режим: шпионаж только запланирован'; return { stop: false, dry: true }; }
    if (r.ok) {
      const arrival = (r.data && r.data.arrival) || (sentAt + (Number.isFinite(e.duration) ? e.duration : 30) * 1000);
      const probes = ajax ? (num(r.data && r.data.shipsSent && r.data.shipsSent[PROBE], n) || n) : n;
      dbOf(T).totals.spies++;
      T.spy = { sentAt: r.at || sentAt, arrival, probes, origin: o.id, fleetId: (r.data && r.data.fleetId) || null, reportAt: arrival + rnd(5000, 15000), via: ajax ? 'fleetAjax' : 'fleetStep3' };
      setState(wctx, T, 'probing', `${probes} зонд(ов), прибытие ${fmtT(arrival)}`);
      wctx.rec('spy-sent', `Шпионаж [${T.coords}]: ${probes} зонд(ов) с ${o.coords}, прибытие ${fmtT(arrival)}`, { key: T.key, probes, origin: o.id, arrival, fleetId: T.spy.fleetId, via: T.spy.via, action: r.id });
      if (!ajax) deduct(env, o, { [PROBE]: n });
      return { stop: false };
    }
    return handleRefusal(wctx, T, r, 'шпионаж');
  }
  function isAttackLimit(r) { return !!r && ATTACK_LIMIT_RE.test(String(r.message || '') + ' ' + String(r.error || '')); }
  /** Common handling of refused / failed sends. Returns { stop } (stop = no more sends in this cycle). */
  function handleRefusal(wctx, T, r, what) {
    const msg = (r && (r.message || r.error)) || '';
    // attacks-per-day limit of this target: 24 h pause (persisted with the targets), journaled once, other targets go on
    if (isAttackLimit(r)) {
      const n = attacks24(T, wctx.now());
      if (n > 0 && (!(num(M.cal.attackLimit) > 0) || n < num(M.cal.attackLimit))) { M.cal.attackLimit = n; wctx.rec('cooldown', `Лимит сервера: не больше ${n} атак в сутки на одну цель (узнал по отказу [${T.coords}])`, { key: T.key, attackLimit: n }); }
      if (!(T.state === 'attackLimit' && num(T.cooldownUntil) > wctx.now())) cooldown(wctx, T, 'attackLimit', 'сервер: лимит атак в сутки на эту цель (' + msg + ')');
      return { stop: false, attackLimit: true };
    }
    if (r.refused === 'limit' || r.refused === 'slots' || r.refused === 'sleep' || r.refused === 'stopped' || r.refused === 'notLeader' || r.refused === 'userActive') {
      skip(wctx, `[${T.coords}] ${what}: отклонено (${r.refused})`, r.refused, { key: T.key, message: msg });
      return { stop: true, limit: r.refused === 'limit' };
    }
    if (r.refused === 'duplicate') return { stop: false };
    // botcore could not tell whether the fleet left (lost step-3 answer, the check failed): never send to this target again soon
    if (r.error === 'uncertain') { cooldown(wctx, T, 'notSuitable', what + ': неизвестно, улетел ли флот (ответ сервера потерян) — не повторяю', Math.max(COOLDOWN.notSuitable, 2 * num(wctx.cfg('maxFlightSec'), 7200) * 1000)); return { stop: true }; }
    if (/Target planet|vacation|отпуск|urlaub/i.test(msg) || +r.code === 605) { cooldown(wctx, T, 'vacation', 'сервер: цель в режиме отпуска / недоступна (' + msg + ')'); return { stop: false }; }
    if (r.error === 'mission' || /Invalid mission|No available target|не предложена/i.test(msg)) { cooldown(wctx, T, 'gone', 'миссия недоступна: планеты нет? (' + msg + ')'); return { stop: false }; }
    if (r.refused) { skip(wctx, `[${T.coords}] ${what}: ${r.refused} ${msg}`, r.refused, { key: T.key, message: msg }); T.note = what + ': ' + r.refused; return { stop: false }; }
    cooldown(wctx, T, 'notSuitable', what + ': ошибка ' + (r.error || '') + ' ' + msg, COOLDOWN.error);
    return { stop: false };
  }

  // ------------------------------------------------------------------ attack planning
  function tempOf(T) { return 40; }
  const RECYCLER = 219;                        // debris goes ONLY to Battle Recyclers 219 (John's rule, no 209 fallback)
  const RECYCLER_PREP_SEC = 150;               // botdebris: departure >= planning + 90 s, plus its probe/fleetTable reads
  const RECYCLER_MAX_DELAY_MS = 15 * 60000;    // longest an attack departure is held back for the recyclers
  /**
   * botdebris pre-sends recyclers (they must arrive 1-2 s after the battle) only when the field already exists before the battle
   * (mission 8 is offered only for a non-empty field). Then the battle must be at least (recycler flight + preparation) away
   * from now. Returns { needSec, recSec, from, field } or null when no timing constraint applies. Settings and ship counts only:
   * no request.
   */
  function recyclerTiming(wctx, env, T, sim) {
    try {
      if (!OGX.bot.isActive('botdebris') || OGX.bot.cfg('botdebris.followBattles') === false) return null;
      const ex = T.debris || {};
      const exist = num(ex.metal) + num(ex.crystal);
      if (exist <= 0) return null;
      const p50 = sim && sim.debris && sim.debris.p50 ? sim.debris.p50 : null;
      const add = p50 ? num(p50.metal) + num(p50.crystal) : 0;
      if (add <= 0) return null;
      let base = 20000000;
      try { base = OGX.calc.cargoCapacity(RECYCLER) || base; } catch (e) { /* catalog 20M */ }
      const cap = num(env.stats && env.stats[RECYCLER] && (env.stats[RECYCLER].cargo || env.stats[RECYCLER].capacity), base) || base;
      const need = Math.max(1, Math.ceil((exist + add) / cap));
      const holders = [];
      for (const b of Object.values(env.bodies || {})) {
        const seen = M.shipsSeen && M.shipsSeen[b.id];
        const have = num(((seen && seen.ships) || b.ships || {})[RECYCLER]);
        if (have <= 0 || wctx.locked(bodyKey(b))) continue;
        const x = est(env, b.coords, T.coords, { [RECYCLER]: Math.min(have, need) }, 10);
        if (!Number.isFinite(x.duration)) continue;
        holders.push({ id: b.id, coords: b.coords, have, sec: x.duration, full: have >= need });
      }
      if (!holders.length) return null;
      // like botdebris: the nearest body with enough recyclers, else the one with most
      const full = holders.filter((h) => h.full).sort((a, b) => a.sec - b.sec);
      const h = full[0] || holders.sort((a, b) => b.have - a.have || a.sec - b.sec)[0];
      return { needSec: Math.ceil(h.sec + RECYCLER_PREP_SEC), recSec: Math.round(h.sec), from: h.id, fromCoords: h.coords, field: Math.round(exist + add), recyclers: need };
    } catch (e) { return null; }
  }
  /** Profit of a plan for the database: net per raid (loot - fuel - losses, simulator mean), per hour of slot time, payback. */
  function profitOf(T, P) {
    const d = dbOf(T);
    const loss = P.sim ? +P.sim.attackerLoss.mean.msu || 0 : 0;
    const fuel = msu({ deuterium: P.fuel });
    const cost = loss + fuel;
    d.profit = { t: Date.now(), lootMsu: Math.round(lootOf(P)), netMsu: Math.round(P.net), perHourMsu: Math.round(P.perHour), lossMsu: Math.round(loss), fuelMsu: Math.round(fuel),
      roi: cost > 0 ? Math.round((lootOf(P) / cost) * 10) / 10 : null, win: P.sim ? P.sim.win : 1, ships: P.ships, origin: P.origin.coords, mixed: !!(P.sim && P.mixed) };
    T.need = null;
    dbVerdict(T, 'farm', `выгодно: ≈ ${fmtN(P.net)} МСУ за рейд` + (P.sim ? `, победа ${Math.round(P.sim.win * 100)} %` : ', без защиты'));
  }
  /** Loot below minLoot: wait until the stock regrows (the target's own production, capped by storage), not a fixed 3 h. */
  function poorTarget(wctx, env, T, pr) {
    const now = wctx.now();
    const minLoot = num(wctx.cfg('minLoot'), 10000000);
    const intel = pr.intel || OGX.bot.intel.get(T.key);
    const lootNow = Math.max(0, ...(pr.rejects || []).map((x) => num(x.lootMsu)));
    let until = now + COOLDOWN.notSuitable;
    let why = `добыча ${fmtN(lootNow)} < ${fmtN(minLoot)} МСУ`;
    if (wctx.cfg('regrowRespy') !== false) {
      const at = regrowAt(intel, minLoot, now, env.server);
      if (at === null) { until = now + REGROW_MAX; why += ': ресурсы почти не растут (нет шахт / мало хранилищ) — проверю через неделю'; }
      else { until = Math.min(now + REGROW_MAX, Math.max(now + REGROW_MIN, at)); why += `: отрастёт к ${fmtT(until)}`; }
    }
    cooldown(wctx, T, 'poor', why, until - now);
    dbVerdict(T, 'poor', why, { regrowAt: until });
  }
  /** opts.noBuild: own ships only (the fallback when the build allowance would take longer than buildMaxWaitMin). */
  async function planAttack(wctx, env, T, origins, opts = {}) {
    const S = OGX.botSim;
    const intel = OGX.bot.intel.get(T.key);
    if (!intel || !intel.res) return { skip: 'noIntel' };
    const now = wctx.now();
    const lootMin = num(wctx.cfg('minLoot'), 10000000);
    const winMin = num(wctx.cfg('winMin'), 0.99);
    const minWin = Math.min(winMin, num(wctx.cfg('minWin'), 0.8));
    const mixed = wctx.cfg('mixedFleet') !== false;
    const maxLossShare = num(wctx.cfg('maxLossShare'), 0.25);
    const runs = num(wctx.cfg('simRuns'), 60);
    const surplusPct = num(wctx.cfg('surplusPct'), 10);
    const maxFlight = num(wctx.cfg('maxFlightSec'), 7200);
    const maxFuelShare = num(wctx.cfg('maxFuelShare'), 0.1);
    const rates = { c: num(wctx.core('rateC'), 1.5), d: num(wctx.core('rateD'), 3) };
    const defender = defenderSide(intel, env.research);
    const undefended = isUndefended(intel);
    const plans = [];
    const rejects = [];
    for (const o of origins) {
      const bk = bodyKey(o);
      if (wctx.locked(bk)) { rejects.push({ origin: o.id, why: 'тело под угрозой', shortage: true }); continue; }
      const ships = await freshShips(wctx, env, o);
      const available = {};
      for (const id of CARGO_IDS.concat(COMBAT_IDS)) if (+ships[id] > 0) available[id] = +ships[id];
      const canBuild = wctx.cfg('buildShips') === true && !opts.noBuild;
      if (!Object.keys(available).length && !canBuild) { rejects.push({ origin: o.id, why: 'нет кораблей', shortage: true }); continue; }
      const e10 = est(env, o.coords, T.coords, { [TRANSPORT]: 1 }, 10);
      const arrivalEst = now + (Number.isFinite(e10.duration) ? e10.duration : 0) * 1000;
      const planet = expectedAt(intel, arrivalEst, { tempMax: tempOf(T), server: env.server });
      const halves = halvesOf(planet);
      const lootMsu = msu(halves);
      if (lootMsu < lootMin) { rejects.push({ origin: o.id, why: `добыча ${fmtN(lootMsu)} < ${fmtN(lootMin)} МСУ`, loot: true, lootMsu }); continue; }
      // build allowance (buildShips): what the body can afford after reservations, for ids whose requirements are met
      let maxShips = null;
      if (canBuild) {
        const av = wctx.available(bk);
        maxShips = {};
        for (const id of CARGO_IDS.concat(COMBAT_IDS)) {
          if (!reqMet(id, o, env.research)) continue;
          let c;
          try { c = OGX.calc.unitCost(id, 1); } catch (x) { c = null; }
          if (!c) continue;
          const n = Math.min(...RES.map((r) => (+c[r] > 0 ? Math.floor(av[r] / c[r]) : Infinity)));
          if (Number.isFinite(n) && n > 0) maxShips[id] = n;
        }
      }
      const fuelOf = (s) => { const x = est(env, o.coords, T.coords, s, 10); return Number.isFinite(x.fuel) ? x.fuel : 1e12; };
      const timeOf = (s) => { const x = est(env, o.coords, T.coords, s, 10); return Number.isFinite(x.duration) ? 2 * x.duration : 1e9; };
      const att = attackerSide({}, env);
      const runOpt = (allow) => S.optimizeRaid({ defender, planet, available, attackerTech: att.bonusPct ? { bonusPct: att.bonusPct } : { tech: att.tech },
        storageFactor: env.storageFactor, cargoIds: CARGO_IDS, combatIds: COMBAT_IDS, winMin, minWin, maxDefeat: 1 - winMin, mixed, maxLossShare, runs, seed: T.key + ':' + intel.ts,
        fuelOf, timeOf, rates, surplusPct, maxShips: allow || undefined, fleetDebrisPct: 30, defDebrisPct: 0,
        targetType: +((T.target || {}).type || 1), hasMoon: !!T.moon });
      let opt = null;
      try {
        // own ships first; the build allowance only when they are not enough (never build what is already there)
        if (Object.keys(available).length) opt = runOpt(null);
        const short = opt && opt.ok && P_short(opt, planet, env.storageFactor);
        if ((!opt || !opt.ok || short) && maxShips) { const o2 = runOpt(maxShips); if (o2 && o2.ok) opt = o2; }
      } catch (x) { rejects.push({ origin: o.id, why: 'симулятор: ' + errText(x) }); continue; }
      if (!opt || !opt.ok || !Object.keys(opt.ships || {}).length) {
        // undefended and not one 217 on the body: no fallback ship, the whole hold is missing
        if (undefended && !(num(available[TRANSPORT]) > 0)) {
          const n = transportShort({}, planet, env);
          rejects.push({ origin: o.id, why: `не хватает ${n} Ул. трансп. (на ${o.coords} нет ни одного)`, shortage: true, transport: { short: n, have: 0 } });
          continue;
        }
        rejects.push({ origin: o.id, why: (opt && opt.why) || 'нет состава', tried: opt && opt.tried, shortage: !!(opt && /транспорт/i.test(opt.why || '')) }); continue;
      }
      // defended too: the loot goes ONLY in 217 (John's rule). A fleet without one Battle Transporter would carry the loot in
      // the escort's hold (optimizeRaid falls back to a combat-only fleet when no 217 is available): skip, no fallback carrier.
      if (!(num((opt.ships || {})[TRANSPORT]) > 0) && lootMsu > 0) {
        const n = transportShort({}, planet, env);
        rejects.push({ origin: o.id, why: `не хватает ${n} Ул. трансп. (на ${o.coords} нет ни одного; трюм боевых кораблей не считается)`, shortage: true, transport: { short: n, have: 0 }, ships: opt.ships });
        continue;
      }
      const missing = cleanUnits(opt.missing);
      // what the fleet can carry home: the simulator's mean loot (cargo-limited, after losses); undefended -> calculateSteal
      // with the fleet's capacity. The minLoot threshold and the fuel share apply to THIS, not to the uncapped halves.
      let lootExp = lootMsu;
      try {
        if (opt.sim && opt.sim.loot && opt.sim.loot.mean) lootExp = +opt.sim.loot.mean.msu || 0;
        else lootExp = msu(S.steal({ ships: Object.assign({}, opt.ships, missing), storageFactor: env.storageFactor, planet }));
      } catch (x) { lootExp = lootMsu; }
      // too few 217 for the whole loot: send what is there only when partialLoot allows it and they carry >= minLootShare of it
      const shortN = transportShort(Object.assign({}, opt.ships), planet, env);
      let partial = null;
      if (shortN > 0) {
        const share = lootMsu > 0 ? lootExp / lootMsu : 0;
        const minShare = num(wctx.cfg('minLootShare'), 0.5);
        const haveT = num((opt.ships || {})[TRANSPORT]);
        if (wctx.cfg('partialLoot') === false || share < minShare) {
          rejects.push({ origin: o.id, why: `не хватает ${shortN} Ул. трансп. (есть ${haveT}; вывезут ${Math.round(share * 100)} % добычи` + (wctx.cfg('partialLoot') === false ? ', неполная добыча выключена)' : `, нужно ≥ ${Math.round(minShare * 100)} %)`),
            cargo: true, shortage: true, transport: { short: shortN, have: haveT, share }, lootMsu, lootExpMsu: Math.round(lootExp), ships: opt.ships });
          continue;
        }
        partial = { short: shortN, have: haveT, share };
      }
      if (lootExp < lootMin) {
        rejects.push({ origin: o.id, why: `вывезет ≈ ${fmtN(lootExp)} МСУ из ${fmtN(lootMsu)} (порог ${fmtN(lootMin)}): мало трюма` + (shortN > 0 ? `, не хватает ${shortN} Ул. трансп.` : ''), cargo: true, shortage: true, lootMsu, lootExpMsu: Math.round(lootExp), ships: opt.ships });
        continue;
      }
      // speed: the fastest of 10..1 with fuel <= maxFuelShare x loot and duration <= maxFlightSec
      let pick = null;
      const tried = [];
      const okSpeeds = [];
      for (let sp = 10; sp >= 1; sp--) {
        const x = est(env, o.coords, T.coords, opt.ships, sp);
        tried.push({ speed: sp, duration: x.duration, fuel: x.fuel });
        if (!Number.isFinite(x.duration) || x.duration > maxFlight) continue;
        if (msu({ deuterium: x.fuel }) > maxFuelShare * lootExp) continue;
        okSpeeds.push({ speed: sp, duration: x.duration, fuel: x.fuel });
      }
      pick = okSpeeds[0] || null;
      if (!pick) { rejects.push({ origin: o.id, why: 'нет скорости: топливо или время полёта сверх лимитов', speeds: tried.slice(0, 3) }); continue; }
      // recyclers 1-2 s after the battle (botdebris pre-send): they leave before the battle, so the battle must not come sooner
      // than their flight + the preparation lead. Slower attack first (also cheaper fuel), else a delayed departure.
      const rt = recyclerTiming(wctx, env, T, opt.sim);
      if (rt) {
        const slow = okSpeeds.find((x) => x.duration >= rt.needSec);
        if (slow) pick = Object.assign({}, slow, { recyclers: Object.assign({}, rt, { how: slow.speed === okSpeeds[0].speed ? 'none' : 'slower', fastest: okSpeeds[0].speed }) });
        else {
          const slowest = okSpeeds[okSpeeds.length - 1];
          const delayMs = Math.ceil(rt.needSec - slowest.duration) * 1000;
          if (delayMs <= RECYCLER_MAX_DELAY_MS) pick = Object.assign({}, slowest, { delayMs, recyclers: Object.assign({}, rt, { how: 'delay', fastest: okSpeeds[0].speed }) });
          else pick = Object.assign({}, pick, { recyclers: Object.assign({}, rt, { how: 'impossible', fastest: okSpeeds[0].speed }) });
        }
      }
      const sim = opt.sim;
      const net = sim ? sim.net.mean : lootExp - msu({ deuterium: pick.fuel });
      const hours = Math.max(1 / 60, (2 * pick.duration) / 3600);
      plans.push({ origin: o, ships: opt.ships, missing, partial, speed: pick.speed, duration: pick.duration, fuel: pick.fuel, delayMs: pick.delayMs || 0, recyclers: pick.recyclers || null, planet, lootMsu, lootExp, storageFactor: env.storageFactor, sim, why: opt.why, tried: opt.tried,
        undefended, net, perHour: net / hours, defender, mixed: opt.mixed || null, dist: OGX.fleet.gz.distance(o.coords, T.coords) });
    }
    if (!plans.length) return { skip: 'noPlan', rejects, intel };
    plans.sort((a, b) => (Object.keys(a.missing).length - Object.keys(b.missing).length) || (b.perHour - a.perHour) || (a.dist - b.dist) || ((a.origin.type === 'moon' ? -1 : 0) - (b.origin.type === 'moon' ? -1 : 0)));
    return { plan: plans[0], alternatives: plans.slice(1, 4), rejects, intel };
  }
  /** Battle Transporters missing for the whole loot (minCapacityForLoot of the expected stock) with `ships`: 0 = enough. Only the
   * 217 hold counts (John's rule: loot only in 217): the escort's hold is never a substitute carrier. */
  function transportShort(ships, planet, env) {
    try {
      const need = OGX.botSim.minCapacityForLoot(planet);
      const cap = num((ships || {})[TRANSPORT]) * transportCap(env);
      const per = transportCap(env);
      return cap >= need || !(per > 0) ? 0 : Math.ceil((need - cap) / per);
    } catch (e) { return 0; }
  }
  /** Own ships too few for the whole loot (optimizeRaid caps the cargo at what is available): build would help. */
  function P_short(opt, planet, sf) {
    try {
      const need = OGX.botSim.minCapacityForLoot(planet);
      const T = OGX.botSim.unitTable();
      let cap = 0;
      for (const [id, n] of Object.entries(opt.ships || {})) cap += (T[id] ? T[id].capacity : 0) * n;
      return cap * (1 + (sf || 0)) < need;
    } catch (e) { return false; }
  }
  function farmFlying() { return Object.values(M.attacks).filter((A) => A.status === 'flying' && A.arrival > (OGX.time.serverNow() - 60000)).length; }

  async function attack(wctx, env, T, P, intel) {
    const now = wctx.now();
    const o = P.origin;
    const maxSlots = num(wctx.cfg('maxSlots'), 3);
    if (farmFlying() >= maxSlots) { skip(wctx, `[${T.coords}] атака: уже ${farmFlying()} атак фарма в полёте (максимум ${maxSlots})`, 'maxSlots', { key: T.key, flying: farmFlying(), maxSlots }); return { stop: true }; }
    const lim = num(M.cal.attackLimit, 0);
    if (lim > 0 && attacks24(T, now) >= lim) {
      const first = dbOf(T).raids.filter((r) => r.t > now - 24 * H).map((r) => r.t).sort((a, b) => a - b)[0] || now;
      cooldown(wctx, T, 'attackLimit', `уже ${attacks24(T, now)} атак за сутки (лимит сервера ≈ ${lim})`, Math.max(10 * 60000, first + 24 * H - now));
      return { stop: false };
    }
    const age = now - (+intel.ts || 0);
    const maxAge = num(wctx.cfg('maxReportAgeMin'), 30) * 60000;
    if (age > maxAge) { setState(wctx, T, 'new', 'доклад старше ' + Math.round(age / 60000) + ' мин: шпионить заново'); return { stop: false, respy: true }; }
    const delayMs = Math.max(0, num(P.delayMs));
    if (delayMs > 0 && age + delayMs > maxAge + 10 * 60000) { setState(wctx, T, 'new', 'доклад устареет к отложенному вылету: шпионить заново'); return { stop: false, respy: true }; }
    const departAt = now + delayMs;
    const back = departAt + 2 * P.duration * 1000;
    const sl = wctx.sleepCheck(back);
    if (!sl.ok) { skip(wctx, `[${T.coords}] атака: возврат ${fmtT(back)} попадает в сон`, 'sleep', { key: T.key, back, sleepReason: sl.reason }); return { stop: true }; }
    const rl = returnLocked(wctx, bodyKey(o), back);
    if (rl) { skip(wctx, `[${T.coords}] атака: возврат на ${o.coords} в окно угрозы (${fmtT(rl.arrival)})`, 'threat', { key: T.key, back, threat: rl.key }); return { stop: false }; }
    const cs = await wctx.canSend('normal');
    // the attack needs its own slot plus one for its escort probe (held for it right after the send), and the slots already held
    // for the escorts of flying attacks stay free too
    const escortOn = wctx.cfg('escort') !== false;
    const ownHolds = Object.values(M.attacks).filter((a) => a.status === 'flying' && a.arrival > now && a.escort && a.escort.hold).length;
    const room = Number.isFinite(+cs.free) ? +cs.free - num(cs.held) - ownHolds - (escortOn ? 1 : 0) : -1;
    if (!cs.ok || room <= num(cs.reserve)) { skip(wctx, `Атака [${T.coords}]: нет свободного слота (свободно ${cs.free}, резерв ${cs.reserve}${escortOn ? ', +1 для сопровождения' : ''}${ownHolds ? ', держу ' + ownHolds + ' для сопровождений' : ''})`, 'slots', { key: T.key, free: cs.free, reserve: cs.reserve, held: num(cs.held), ownHolds, escort: escortOn, slotsReason: cs.reason }); return { stop: true }; }
    const av = wctx.available(bodyKey(o));
    if (av.deuterium < P.fuel) { skip(wctx, `[${T.coords}] атака: дейтерия ${fmtN(av.deuterium)} < ${fmtN(P.fuel)}`, 'fuel', { key: T.key }); return { stop: false }; }
    const arrivalEst = departAt + P.duration * 1000;
    const rc = P.recyclers;
    const recTxt = !rc ? '' : rc.how === 'slower' ? `; скорость снижена с ${rc.fastest * 10} %: переработчикам с ${rc.fromCoords} нужно ${rc.recSec} с + ${RECYCLER_PREP_SEC} с подготовки, чтобы прибыть через 1–2 с после боя`
      : rc.how === 'delay' ? `; вылет отложен на ${Math.round(delayMs / 1000)} с: переработчикам с ${rc.fromCoords} нужно ${rc.recSec} с + ${RECYCLER_PREP_SEC} с подготовки`
        : rc.how === 'impossible' ? `; переработчики (${rc.recSec} с) не успеют к бою даже с задержкой ${Math.round(RECYCLER_MAX_DELAY_MS / 60000)} мин — соберут после боя` : '';
    const summary = simSummary(P.sim, { ships: P.ships, speed: P.speed * 10, fuel: P.fuel, duration: P.duration, expected: P.planet, lootHalvesMsu: Math.round(P.lootMsu), lootExpMsu: Math.round(lootOf(P)), undefended: P.undefended, tried: P.tried, why: P.why, perHourMsu: Math.round(P.perHour) });
    const lootTxt = `добыча ≈ ${fmtN(lootOf(P))} МСУ` + (lootOf(P) < P.lootMsu * 0.95 ? ` (на планете половина = ${fmtN(P.lootMsu)}, трюма меньше)` : '')
      + (P.partial ? `; не хватает ${P.partial.short} Ул. трансп. — неполная добыча (${Math.round(P.partial.share * 100)} %)` : '');
    wctx.rec('attack-planned', `Атака [${T.coords}] с ${o.coords}: ${shipsRu(P.ships)}, скорость ${P.speed * 10} %, ${lootTxt}`, Object.assign({ key: T.key, origin: o.id, lootExpMsu: Math.round(lootOf(P)), recyclers: rc, delayMs, departAt }, summary));
    wctx.decide(`Атака [${T.coords}] ${shipsRu(P.ships)}`, {
      why: P.why + `; скорость ${P.speed * 10} % (топливо ${fmtN(P.fuel)} ≤ ${num(wctx.cfg('maxFuelShare'), 0.1) * 100} % добычи, полёт ${Math.round(P.duration)} с)` + recTxt,
      inputs: { key: T.key, reportAge: Math.round(age / 1000), expected: P.planet, defender: P.defender, origin: o.id, slotsFree: cs.free, farmFlying: farmFlying(), sim: summary, recyclers: rc },
      chosen: { ships: P.ships, speed: P.speed, origin: o.id, delayMs }, alternatives: (P.alternatives || []).map((a) => ({ origin: a.origin.id, ships: a.ships, perHour: Math.round(a.perHour) })),
    });
    const r = await wctx.act(Object.assign({ type: 'fleet.send', bodyId: o.id, prio: 'fleet', params: { target: T.target, ships: P.ships, mission: 1, speed: P.speed, expectArrival: arrivalEst, arrivalTolMs: 120000 },
      why: `Фарм: атака [${T.coords}] ${shipsRu(P.ships)}` + (delayMs ? ` (вылет ${fmtT(departAt)} под переработчики)` : ''), plan: Object.assign({}, summary, { recyclers: rc }), dedupeKey: 'botfarm:attack:' + T.key, returnAt: back },
    delayMs ? { at: departAt, deadline: departAt + 5 * 60000 } : {}));
    if (r.dry) { T.dryAt = wctx.now(); T.note = 'пробный режим: атака только запланирована'; return { stop: false, dry: true }; }
    if (!r.ok) { if (r.refused === 'ships') forgetShips(env, o.id); return handleRefusal(wctx, T, r, 'атака'); }
    const arrival = (r.data && r.data.arrival) || arrivalEst;
    const backAt = (r.data && r.data.back) || (arrival + P.duration * 1000);
    const measured = (arrival - (r.at || now)) / 1000;
    calibrate(env, o.coords, T.coords, P.ships, P.speed, measured);
    deduct(env, o, P.ships);
    const id = 'farm:' + T.key + ':' + Math.round(arrival / 1000);
    const debris = P.sim ? { metal: Math.round(P.sim.debris.mean.metal), crystal: Math.round(P.sim.debris.mean.crystal),
      p10: roundRes(P.sim.debris.p10), p50: roundRes(P.sim.debris.p50) } : { metal: 0, crystal: 0, p10: { metal: 0, crystal: 0 }, p50: { metal: 0, crystal: 0 } };
    const A = { id, key: T.key, coords: T.coords, target: T.target, origin: o.id, originCoords: o.coords, originKey: bodyKey(o), ships: P.ships, speed: P.speed,
      fleetId: (r.data && r.data.fleetId) || null, sentAt: r.at || now, arrival, back: backAt, status: 'flying', verified: !!r.verified,
      predictedLoot: P.sim ? roundRes(P.sim.loot.mean) : roundRes(stealOf(P)), planet: P.planet, lootMsu: Math.round(lootOf(P)), lootHalvesMsu: Math.round(P.lootMsu), lootExpMsu: Math.round(lootOf(P)), debrisP50: debris.p50,
      plan: summary, defUnits: P.defender && P.defender.units ? Object.assign({}, P.defender.units) : null, moonAtSend: !!T.moon, escort: { state: wctx.cfg('escort') === false ? 'off' : 'pending', at: arrival - num(wctx.cfg('escortLeadSec'), 60) * 1000 } };
    // one fleet slot held for the escort probe until it is sent (other modules' normal sends cannot take it)
    if (A.escort.state === 'pending' && typeof wctx.holdSlot === 'function') A.escort.hold = wctx.holdSlot({ until: arrival, label: 'сопровождение [' + T.coords + ']' });
    M.attacks[id] = A;
    try { dbRaidSent(T, A, P); } catch (x) { /* view only */ }
    // lastAttackAt = the IMPACT: every report older than the battle (incl. the escort report a minute before it) shows ships and
    // resources that the battle changed, so only a report taken after it may plan the next attack
    setState(wctx, T, 'attackFlying', `атака летит, удар ${fmtT(arrival)}`, { attackId: id, lastAttackAt: arrival, lastAttackSentAt: now });
    wctx.rec('attack-sent', `Атака [${T.coords}] отправлена: ${shipsRu(P.ships)}, удар ${fmtT(arrival)}, возврат ${fmtT(backAt)}`, { key: T.key, battle: id, fleetId: A.fleetId, arrival, back: backAt, verified: !!r.verified, lateMs: r.lateMs ?? null, action: r.id, ships: P.ships });
    try {
      OGX.bot.battles.put({ id, owner: NAME, target: T.target, arrival, fleetId: A.fleetId, status: 'flying', debris,
        existingDebris: T.debris && (T.debris.metal || T.debris.crystal) ? { metal: T.debris.metal, crystal: T.debris.crystal } : null,
        targetHasMoon: !!T.moon,   // additive: botdebris discounts the field by the moon chance only for a planet without a moon [UPSTREAM]
        sim: summary });
    } catch (x) { wctx.rec('error', 'Реестр боёв: ' + errText(x)); }
    if (A.escort.state === 'pending') armEscort(A);
    await save('attacks', 'targets', 'cal');
    return { stop: false, sent: true };
  }

  // ------------------------------------------------------------------ build missing ships (§6.4)
  /** Shipyard speed factor (x1 calc time / real seconds) from any queue the core has seen (Body.queues.unit) or a stored calibration. */
  function unitSpeed(env) {
    for (const b of Object.values(env.bodies || {})) {
      const q = b && b.queues && b.queues.unit;
      if (!q || !q.techId || !(+q.perUnitSecs > 0)) continue;
      try {
        const x1 = OGX.calc.unitTime(q.techId, { shipyard: num(b.levels && b.levels[21]), nanite: num(b.levels && b.levels[15]), gameSpeed: 1, factors: env.factors || undefined });
        if (x1 > 0) { M.cal.unitSpeed = x1 / +q.perUnitSecs; M.cal.unitSpeedT = Date.now(); }
      } catch (e) { /* ignore */ }
    }
    return +M.cal.unitSpeed || null;
  }
  /** Shipyard queue of an origin as last seen: M.yard[bodyId] = { t (read time), endsAt (unit queue end, ServerMs; 0 = empty) }.
   *  Kept in memory; an order updates it from its answer. */
  const YARD_REUSE_MS = 60000;          // a read this young is reused as is (several plans of one cycle on the same origin)
  const YARD_LEARN_MS = 30 * 60000;     // unit speed unknown: look at the shipyard (queue -> calibration) at most this often
  function yardFromBody(wctx, body) {
    const uq = body && body.queues && body.queues.unit;
    return { t: wctx.now(), endsAt: uq && num(uq.endsAt) > wctx.now() ? num(uq.endsAt) : 0 };
  }
  /** read.page shipyard of the origin (fresh: true right before an order) -> refreshed body; M.yard updated. */
  async function readYard(wctx, env, o, { fresh, why }) {
    const bk = bodyKey(o);
    wctx.decide(`Верфь ${o.coords}: проверяю очередь`, { why, inputs: { bodyId: o.id, last: (M.yard || {})[o.id] || null }, chosen: 'read.page shipyard', alternatives: ['данные верфи из памяти'] });
    await wctx.act({ type: 'read.page', bodyId: o.id, prio: 'read', fresh: !!fresh, params: { page: 'shipyard', mode: 'fleet' }, why: 'Фарм: очередь верфи ' + o.coords });
    const bodies = await wctx.bodies();
    env.bodies = bodies;
    const body = bodies[bk] || o;
    (M.yard = M.yard || {})[o.id] = yardFromBody(wctx, body);
    return body;
  }
  /** Checks of a build on known data -> { skip: [what, reason, data] } | { secs, queued, cost, waitMs }. */
  function buildCheck(wctx, env, T, P, body, speed) {
    const o = P.origin;
    const missing = P.missing;
    const maxWait = num(wctx.cfg('buildMaxWaitMin'), 30) * 60000;
    const y = (M.yard || {})[o.id];
    const bq = body.queues && body.queues.building;
    const building = bq && num(bq.endsAt, Infinity) > wctx.now() ? +bq.objectId : null;
    if ([15, 21].includes(+building)) return { skip: [`[${T.coords}] достройка: на ${o.coords} строится ${+building === 21 ? 'верфь' : 'фабрика нанитов'}`, 'shipyardBusy', { key: T.key }] };
    let secs = 0;
    const uq = body.queues && body.queues.unit;
    const endsAt = Math.max(uq && num(uq.endsAt) > 0 ? num(uq.endsAt) : 0, y ? num(y.endsAt) : 0);
    const queued = Math.max(0, endsAt - wctx.now()) / 1000;
    const cost = res0();
    for (const [id, n] of Object.entries(missing)) {
      const x1 = OGX.calc.unitTime(+id, { shipyard: num(body.levels && body.levels[21]), nanite: num(body.levels && body.levels[15]), gameSpeed: 1, factors: env.factors || undefined });
      secs += Math.max(1, x1 / speed) * n;
      const c = OGX.calc.unitCost(+id, n);
      for (const r of RES) cost[r] += +c[r] || 0;
    }
    const waitMs = (queued + secs + P.duration) * 1000;
    if (waitMs > maxWait) return { skip: [`[${T.coords}] достройка: ${Math.round(waitMs / 60000)} мин > ${Math.round(maxWait / 60000)} мин`, 'buildTooLong', { key: T.key, secs, queued, missing }] };
    const av = wctx.available(bodyKey(o));
    if (RES.some((r) => av[r] < cost[r] + (r === 'deuterium' ? P.fuel : 0))) return { skip: [`[${T.coords}] достройка: не хватает ресурсов на ${o.coords}`, 'buildCost', { key: T.key, cost, available: av }] };
    return { secs, queued, cost, waitMs, av };
  }
  async function buildMissing(wctx, env, T, P) {
    const o = P.origin;
    const missing = P.missing;
    const bk = bodyKey(o);
    const maxWait = num(wctx.cfg('buildMaxWaitMin'), 30) * 60000;
    let body = (env.bodies && env.bodies[bk]) || o;
    // 1. unit speed: learnt from a shipyard queue the core saw; unknown -> look at the shipyard at most every 30 min, no order
    let speed = unitSpeed(env);
    if (!speed) {
      const y = (M.yard || {})[o.id];
      if (!y || wctx.now() - y.t > YARD_LEARN_MS) { body = await readYard(wctx, env, o, { fresh: false, why: 'скорость верфи неизвестна: ищу очередь на верфи для калибровки' }); speed = unitSpeed(env); }
      if (!speed) {
        // the same answer every cycle: a short pause for the target (re-evaluated when a fleet returns), no shipyard read per cycle
        skip(wctx, `[${T.coords}] достройка: скорость верфи неизвестна — откройте верфь во время постройки, бот её запомнит`, 'unitTimeUnknown', { key: T.key, missing });
        cooldown(wctx, T, 'notSuitable', 'достройка: скорость верфи неизвестна', COOLDOWN.shortage);
        T.shortage = true;
        return { stop: false };
      }
    }
    // 2. everything decidable from known data (the queue end only grows by new orders: a too long wait stays too long)
    let chk = buildCheck(wctx, env, T, P, body, speed);
    if (chk.skip) { skip(wctx, ...chk.skip); return { stop: false, skipped: chk.skip[1], why: chk.skip[0] }; }
    // 3. the shipyard queue right before the order (reused only from this very minute: several plans of one cycle)
    const y = (M.yard || {})[o.id];
    if (!y || wctx.now() - y.t > YARD_REUSE_MS) {
      body = await readYard(wctx, env, o, { fresh: true, why: 'перед заказом достройки: очередь верфи и стройка 15/21' });
      chk = buildCheck(wctx, env, T, P, body, speed);
      if (chk.skip) { skip(wctx, ...chk.skip); return { stop: false, skipped: chk.skip[1], why: chk.skip[0] }; }
    }
    const { secs, queued, cost, waitMs, av } = chk;
    const intel = OGX.bot.intel.get(T.key);
    const ageAtArrival = wctx.now() + waitMs - (+intel.ts || 0);
    const maxAge = (num(wctx.cfg('maxReportAgeMin'), 30) + num(wctx.cfg('buildMaxWaitMin'), 30)) * 60000;
    if (ageAtArrival > maxAge) { setState(wctx, T, 'new', 'доклад устареет к удару: сначала шпионаж'); return { stop: false }; }
    const resId = wctx.reserve(bk, Object.assign({}, cost, { deuterium: cost.deuterium + P.fuel }), { ttlMs: Math.min(2 * H, waitMs + 10 * 60000), label: 'фарм: достройка + топливо [' + T.coords + ']' });
    wctx.decide(`Достройка на ${o.coords}: ${shipsRu(missing)}`, { why: `для атаки [${T.coords}] не хватает кораблей; постройка ≈ ${Math.round(secs)} с + полёт ${Math.round(P.duration)} с ≤ ${Math.round(maxWait / 60000)} мин`,
      inputs: { key: T.key, missing, cost, secs: Math.round(secs), queuedSecs: Math.round(queued), unitSpeed: speed, available: av }, chosen: 'build.units', alternatives: ['ждать / пропустить'] });
    const r = await wctx.act({ type: 'build.units', bodyId: o.id, prio: 'build', params: { units: missing }, why: `Фарм: достройка для [${T.coords}] ${shipsRu(missing)}`, plan: { key: T.key, missing, cost } });
    if (r.dry) { wctx.release(resId); T.dryAt = wctx.now(); T.note = 'пробный режим: достройка только запланирована'; return { stop: false, dry: true }; }
    if (!r.ok) { wctx.release(resId); return handleRefusal(wctx, T, r, 'достройка'); }
    let readyAt = wctx.now() + (queued + secs) * 1000;
    try {
      const sq = r.data && r.data.doc ? OGX.parse.gz.shipyardQueue(r.data.doc) : null;
      if (sq && sq.items && sq.items.length) {
        readyAt = wctx.now() + sq.totalSecs * 1000;
        const mine = sq.items.find((x) => +x.id === +Object.keys(missing)[0]);
        if (mine && +mine.secsPerUnit > 0) {
          const x1 = OGX.calc.unitTime(mine.id, { shipyard: num(body.levels && body.levels[21]), nanite: num(body.levels && body.levels[15]), gameSpeed: 1, factors: env.factors || undefined });
          M.cal.unitSpeed = x1 / mine.secsPerUnit;
        }
      }
    } catch (x) { /* keep the estimate */ }
    (M.yard = M.yard || {})[o.id] = { t: wctx.now(), endsAt: readyAt };
    // ships are paid at the order: keep only the fuel reserved until the attack
    wctx.release(resId);
    const fuelRes = wctx.reserve(bk, { metal: 0, crystal: 0, deuterium: P.fuel }, { ttlMs: Math.min(2 * H, readyAt - wctx.now() + 15 * 60000), label: 'фарм: топливо [' + T.coords + ']' });
    setState(wctx, T, 'waitShips', `верфь: ${shipsRu(missing)} к ${fmtT(readyAt)}`, { readyAt, buildOrigin: o.id, fuelReservation: fuelRes });
    wctx.rec('build-ships', `Достройка на ${o.coords}: ${shipsRu(missing)}, готово ≈ ${fmtT(readyAt)}`, { key: T.key, origin: o.id, missing, readyAt, verified: !!r.verified, action: r.id });
    await save('targets', 'cal');
    return { stop: false, built: true };
  }

  // ------------------------------------------------------------------ escort (requirement 2) — worker 'botfarm:escort'
  function armEscort(A) {
    try {
      const at = Math.max(A.escort.at, OGX.time.serverNow() + 1000);
      OGX.bot.at(at, () => { if (M.escortHandle) M.escortHandle.wake('escort ' + A.id); }, { label: 'botfarm:escort', payload: { id: A.id } });
    } catch (e) { /* the escort worker still finds it by time */ }
  }
  async function escortRun(wctx) {
    if (!OGX.bot.isActive(NAME)) return { nextInMs: OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: 'off' };
    M.busy++;
    try {
      await load(false);
      const env = await runEnv(wctx);
      const now = wctx.now();
      let next = Infinity;
      for (const A of Object.values(M.attacks)) {
        if (A.status !== 'flying') continue;
        if (A.arrival <= now) continue;
        const E = A.escort || {};
        if (E.state === 'pending') {
          if (now >= E.at - 1500) await escortSpy(wctx, env, A);
          else next = Math.min(next, E.at);
        }
        if (E.state === 'sent') {
          if (now >= E.reportAt) await escortReport(wctx, env, A);
          else next = Math.min(next, E.reportAt);
        }
        if (A.escort && A.escort.state === 'sent') next = Math.min(next, A.escort.reportAt);
      }
      await save('attacks', 'targets');
      if (Number.isFinite(next)) return { nextAt: Math.max(next, wctx.now() + 300), reason: 'escort' };
      return { nextInMs: OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: 'idle' };
    } finally { M.busy--; }
  }
  /** exclude: origin ids whose probes the executor's fresh fleetTable did not confirm (the stored count was wrong): the escort is
   *  tried once more from the next best body while there is time. */
  async function escortSpy(wctx, env, A, exclude = new Set()) {
    const T = M.targets[A.key] || { key: A.key, coords: A.coords, target: A.target };
    const intel = OGX.bot.intel.get(A.key) || {};
    const ourSpy = num(env.research[106], 0);
    const theirKnown = intel.research && intel.research[106] !== undefined;
    const p = probesFor({ ourSpy, theirSpy: theirKnown ? intel.research[106] : null, theirSpyKnown: theirKnown, tries: 0 });
    const min = Math.max(1, theirKnown ? p.min : Math.max(p.min, Math.min(p.probes, num(intel.probesSent, 1))));
    const bodies = env.bodies;
    const origins = originList(wctx, env).filter((b) => !wctx.locked(bodyKey(b)) && !exclude.has(+b.id));
    let best = null;
    for (const b of origins) {
      const ships = (bodies[bodyKey(b)] || b).ships || {};
      const have = +ships[PROBE] || 0;
      if (have < min) continue;
      const k = Math.min(p.probes, have);
      const e = est(env, b.coords, A.coords, { [PROBE]: k }, 10);
      const d = OGX.fleet.gz.distance(b.coords, A.coords);
      const full = k >= p.probes;
      if (!best || (full && !best.full) || (full === best.full && (d < best.d || (d === best.d && b.type === 'moon')))) best = { b, e, d, n: k, full };
    }
    const now = wctx.now();
    if (!best) { releaseHold(wctx, A); A.escort.state = 'skipped'; A.escort.why = 'нет зондов'; skip(wctx, `[${A.coords}] сопровождение: нет тела с ${min} зондами`, 'noProbes', { battle: A.id, probes: p.probes, min }); return; }
    const n = best.n;
    const probeSec = Number.isFinite(best.e.duration) ? best.e.duration : 10;
    let sendAt = A.arrival - rnd(20000, 30000) - probeSec * 1000;
    if (sendAt < now) sendAt = now;
    const latest = A.arrival - probeSec * 1000 - 8000;
    if (sendAt > latest) { releaseHold(wctx, A); A.escort.state = 'skipped'; A.escort.why = 'поздно'; skip(wctx, `[${A.coords}] сопровождение: поздно (зонды не успеют до удара)`, 'tooLate', { battle: A.id, arrival: A.arrival, probeSec }); return; }
    const cs = await wctx.canSend('normal');
    if (!cs.ok) { releaseHold(wctx, A); A.escort.state = 'skipped'; A.escort.why = 'нет слота'; skip(wctx, `[${A.coords}] сопровождение: нет слота`, 'slots', { battle: A.id, free: cs.free, reserve: cs.reserve }); return; }
    const ajax = wctx.cfg('useFleetAjax') === true && T.planetId;
    wctx.decide(`Сопровождение [${A.coords}]: ${n} зонд(ов) к ${fmtT(sendAt + probeSec * 1000)}`, {
      why: `доразведка перед ударом в ${fmtT(A.arrival)}: зонды прибудут за 20–30 с до атаки`,
      inputs: { battle: A.id, arrival: A.arrival, probeSec, origin: best.b.id, sendAt }, chosen: ajax ? 'fleet.ajax 6' : 'fleet.send 6', alternatives: [],
    });
    const spec = ajax
      ? { type: 'fleet.ajax', bodyId: best.b.id, prio: 'deadline', at: sendAt, deadline: latest, params: { mission: 6, planetId: +T.planetId }, why: `Фарм: сопровождение [${A.coords}]`, dedupeKey: 'botfarm:escort:' + A.id }
      : { type: 'fleet.send', bodyId: best.b.id, prio: 'deadline', at: sendAt, deadline: latest, params: { target: A.target, ships: { [PROBE]: n }, mission: 6, speed: 10 }, why: `Фарм: сопровождение [${A.coords}] ${n} зонд.`, dedupeKey: 'botfarm:escort:' + A.id };
    A.escort.state = 'sending';
    const r = await wctx.act(spec);
    releaseHold(wctx, A);
    if (r.dry) { A.escort.state = 'dry'; return; }
    if (!r.ok) {
      const msg = r.message || r.error || '';
      if (r.refused === 'ships' && exclude.size < 2 && wctx.now() < latest) {
        // the stored probe count of that body was wrong (no probes there now): the next best body, same deadline
        wctx.rec('escort-spy', `[${A.coords}] сопровождение: на ${best.b.coords} нет зондов (${msg}) — пробую другое тело`, { battle: A.id, refused: r.refused, message: msg, origin: best.b.id });
        forgetShips(env, best.b.id);
        const bk = bodyKey(best.b);
        if (env.bodies && env.bodies[bk]) env.bodies[bk] = Object.assign({}, env.bodies[bk], { ships: Object.assign({}, env.bodies[bk].ships, { [PROBE]: 0 }) });
        exclude.add(+best.b.id);
        A.escort.state = 'pending';
        return escortSpy(wctx, env, A, exclude);
      }
      A.escort.state = 'failed'; A.escort.why = r.refused || msg;
      wctx.rec('escort-spy', `[${A.coords}] сопровождение не отправлено: ${r.refused || ''} ${msg}`, { battle: A.id, refused: r.refused || null, error: r.error || null, message: msg, code: r.code ?? null });
      let change = null;
      if (/Target planet|vacation|отпуск|urlaub/i.test(msg) || +r.code === 605) change = { kind: 'vacation', why: 'цель в режиме отпуска / недоступна (' + msg + ')' };
      else if (r.error === 'mission' || /Invalid mission|No available target|не предложена/i.test(msg)) change = { kind: 'gone', why: 'планеты больше нет (миссия недоступна: ' + msg + ')' };
      if (change) await recallAttack(wctx, A, change);
      return;
    }
    const arrival = (r.data && r.data.arrival) || (wctx.now() + probeSec * 1000);
    A.escort = Object.assign(A.escort, { state: 'sent', sentAt: r.at || wctx.now(), spyArrival: arrival, reportAt: arrival + rnd(1500, 3000), probes: n, origin: best.b.id, fleetId: (r.data && r.data.fleetId) || null });
    wctx.rec('escort-spy', `Сопровождение [${A.coords}]: ${n} зонд(ов), прибытие ${fmtT(arrival)} (удар ${fmtT(A.arrival)})`, { battle: A.id, probes: n, spyArrival: arrival, arrival: A.arrival, fleetId: A.escort.fleetId, action: r.id });
  }
  /** Frees the slot held for the escort of attack A (sent, failed or no longer needed). */
  function releaseHold(wctx, A) {
    if (!A || !A.escort || !A.escort.hold) return;
    try { if (typeof wctx.releaseSlot === 'function') wctx.releaseSlot(A.escort.hold); } catch (e) { /* ignore */ }
    A.escort.hold = null;
  }
  async function escortReport(wctx, env, A) {
    const list = await readCategory(wctx, 0, 'доклад сопровождения [' + A.coords + ']', { fresh: true });
    const now = wctx.now();
    if (!list || list.dry) { A.escort.state = list ? 'dry' : 'noRead'; return; }
    const hits = spyReportsFor(list, A.coords, A.escort.sentAt);
    if (!hits.length) {
      A.escort.reads = (A.escort.reads || 0) + 1;
      if (A.escort.reads < 3 && now + 4000 < A.arrival) { A.escort.reportAt = now + 1500; return; }
      A.escort.state = 'noReport';
      wctx.rec('escort-report', `[${A.coords}] сопровождение: доклада нет, атака продолжается`, { battle: A.id });
      return;
    }
    const h = hits[0];
    const intel = intelFrom(h.rep, A.key, { ts: h.ts, probesSent: A.escort.probes });
    OGX.bot.intel.put(A.key, intel);
    A.escort.state = 'reported';
    // compare with the plan: re-simulate the flying fleet against what the probes saw
    const change = compareEscort(wctx, env, A, intel);
    wctx.rec('escort-report', `Сопровождение [${A.coords}]: ${change ? 'ИЗМЕНЕНИЕ — ' + change.why : 'без изменений'}`, Object.assign({ battle: A.id, changed: !!change, kind: change ? change.kind : null, res: intel.res, ships: intel.ships, defense: intel.defense }, change && change.sim ? { sim: change.sim } : {}));
    if (change) await recallAttack(wctx, A, change);
  }
  function compareEscort(wctx, env, A, intel) {
    const S = OGX.botSim;
    if (!intel.known.ships || !intel.known.defense) return null;   // the escort saw less than the plan: keep the plan
    const T = M.targets[A.key];
    if (T && T.moon && !A.moonAtSend) return { kind: 'moon', why: 'у цели появилась луна' };
    const planet = expectedAt(intel, A.arrival, { tempMax: 40, server: env.server });
    const winMin = num(wctx.cfg('winMin'), 0.99);
    const minWin = Math.min(winMin, num(wctx.cfg('minWin'), 0.8));
    const maxLossShare = num(wctx.cfg('maxLossShare'), 0.25);
    const runs = num(wctx.cfg('simRuns'), 60);
    let sim;
    try {
      sim = S.raid({ attacker: attackerSide(A.ships, env), defender: defenderSide(intel, env.research), planet, runs, seed: A.id + ':escort', rates: { c: num(wctx.core('rateC'), 1.5), d: num(wctx.core('rateD'), 3) }, fleetDebrisPct: 30, defDebrisPct: 0 });
    } catch (e) { return null; }
    const seen = Object.assign({}, cleanUnits(intel.ships), cleanUnits(intel.defense));
    const sum = simSummary(sim, { units: seen });
    // A fresh simulation of an unchanged target differs from the planning one by sampling noise only (a plan at win 0.99 can
    // re-simulate at 0.98): the win/loss checks apply when the target got stronger than the plan assumed (more of a unit type or
    // a new one), or when the plan's composition is unknown. Falling resources are checked always.
    const planned = A.defUnits || null;
    const stronger = !planned || Object.keys(seen).some((id) => num(seen[id]) > num(planned[id]));
    if (stronger && (sim.win < minWin || sim.loss > 1 - winMin + 1e-12)) return { kind: 'units', why: `победа ${(sim.win * 100).toFixed(0)} % (нужно ≥ ${(minWin * 100).toFixed(0)} %), поражение ${(sim.loss * 100).toFixed(0)} % (новый флот/оборона: ${shipsRu(Object.assign({}, intel.ships, intel.defense))})`, sim: sum };
    if (stronger && sim.attackerLoss.mean.msu > maxLossShare * Math.max(1, sim.loot.mean.msu)) return { kind: 'units', why: `потери ${fmtN(sim.attackerLoss.mean.msu)} > ${Math.round(maxLossShare * 100)} % добычи`, sim: sum };
    if (sim.net.mean <= 0) return { kind: 'resources', why: `ресурсы упали: итог ${fmtN(sim.net.mean)} МСУ ≤ 0`, sim: sum };
    return null;
  }
  async function recallAttack(wctx, A, change) {
    const now = wctx.now();
    if (wctx.cfg('recallOnChange') === false) { wctx.rec('decision', `[${A.coords}] изменение (${change.why}), но отзыв выключен`, { why: change.why, inputs: { battle: A.id }, chosen: 'keep', alternatives: ['fleet.recall'] }); return; }
    if (!A.fleetId) { skip(wctx, `[${A.coords}] отзыв невозможен: нет id флота`, 'noFleetId', { battle: A.id }); return; }
    if (now > A.arrival - 3000) { skip(wctx, `[${A.coords}] отзыв поздно: удар в ${fmtT(A.arrival)}`, 'tooLate', { battle: A.id }); return; }
    wctx.decide(`Отзыв атаки [${A.coords}]`, { why: change.why, inputs: { battle: A.id, fleetId: A.fleetId, arrival: A.arrival, kind: change.kind, sim: change.sim || null }, chosen: 'fleet.recall', alternatives: ['продолжить атаку'] });
    const r = await wctx.act({ type: 'fleet.recall', bodyId: A.origin, prio: 'deadline', cls: 'force', deadline: A.arrival - 3000, params: { fleetId: A.fleetId }, why: `Фарм: отзыв [${A.coords}] — ${change.why}`, plan: { kind: change.kind, sim: change.sim || null }, dedupeKey: 'botfarm:recall:' + A.id });
    if (r.dry) { A.recallDry = true; return; }
    if (!r.ok) { wctx.rec('attack-recalled', `[${A.coords}] отзыв НЕ удался: ${r.refused || r.error || ''} ${r.message || ''}`, { battle: A.id, ok: false, refused: r.refused || null, error: r.error || null }); return; }
    A.status = 'recalled'; A.recalledAt = r.at || now; A.recallWhy = change.why;
    { const T0 = M.targets[A.key]; if (T0) dbRaidResult(T0, A, { lootMsu: 0, lossMsu: 0, result: 'recalled' }); }
    releaseHold(wctx, A);
    { const T0 = M.targets[A.key]; if (T0 && T0.lastAttackAt === A.arrival) T0.lastAttackAt = A.sentAt || T0.lastAttackSentAt || now; }   // no battle happened
    wctx.rec('attack-recalled', `Атака [${A.coords}] отозвана: ${change.why}`, { battle: A.id, fleetId: A.fleetId, ok: true, verified: !!r.verified, kind: change.kind, arrival: A.arrival, at: A.recalledAt, action: r.id });
    try { OGX.bot.battles.remove(A.id, 'recall: ' + change.kind); } catch (e) { /* ignore */ }
    const T = M.targets[A.key];
    if (T) {
      if (change.kind === 'vacation') cooldown(wctx, T, 'vacation', change.why);
      else if (change.kind === 'gone') cooldown(wctx, T, 'gone', change.why);
      else cooldown(wctx, T, 'notSuitable', change.why);
    }
  }

  // ------------------------------------------------------------------ main worker
  async function mainRun(wctx) {
    if (!OGX.bot.isActive(NAME)) return { nextInMs: OGX.bot.randMs(OGX.bot.INTERVALS.m6), reason: 'off' };
    M.busy++;
    try {
      await load(M.busy === 1);
      M.lastRun = wctx.now();
      const env = await runEnv(wctx);
      const now = wctx.now();
      // 1. housekeeping of own attacks
      for (const A of Object.values(M.attacks)) {
        if ((A.status === 'flying' || A.status === 'recalled') && now > A.back + 30000) {
          const was = A.status;
          A.status = was === 'flying' ? 'done' : 'recalledDone';
          { const T0 = M.targets[A.key]; const rr = T0 && dbOf(T0).raids.find((x) => x.id === A.id); if (rr && rr.result === 'flying') rr.result = 'done'; }
          markReturned(A.origin, Math.min(now, A.back || now));
          M.lastReturnAt = Math.max(+M.lastReturnAt || 0, Math.min(now, A.back || now));
          const T = M.targets[A.key];
          if (T && T.state === 'attackFlying' && T.attackId === A.id) setState(wctx, T, 'new', 'атака вернулась: повторный шпионаж');
        }
        // the battle entry stays for botdebris until an hour after the return, then leaves the registry
        if (A.status === 'done' && !A.battleRemoved && now > A.back + H) { A.battleRemoved = true; try { OGX.bot.battles.remove(A.id, 'done'); } catch (e) { /* ignore */ } }
        if (now - A.arrival > 24 * H) delete M.attacks[A.id];
      }
      for (const T of Object.values(M.targets)) {
        if (T.state === 'probing' && T.spy && now > (T.spy.arrival || 0) + 30 * 60000) cooldown(wctx, T, 'probesLost', 'доклад не прочитан вовремя');
        if (T.state === 'gone' && now - (+T.stateAt || 0) > num(wctx.cfg('dbKeepDays'), 14) * 24 * H) { delete M.targets[T.key]; wctx.rec('state', `[${T.coords}] удалена из базы: нет в галактике ${num(wctx.cfg('dbKeepDays'), 14)} дн.`, { key: T.key, removed: true }); continue; }
        if (T.cooldownUntil && T.cooldownUntil <= now && ['notSuitable', 'vacation', 'probesLost', 'attackLimit', 'needFleet', 'poor'].includes(T.state)) setState(wctx, T, 'new', 'пауза закончилась', { cooldownUntil: null, tries: 0, shortage: false });
        else if (T.shortage && T.state === 'notSuitable' && (+M.lastReturnAt || 0) > (+T.stateAt || 0)) setState(wctx, T, 'new', 'флот вернулся: оцениваю снова', { cooldownUntil: null, shortage: false });
        if (T.state === 'attackFlying' && (!T.attackId || !M.attacks[T.attackId] || M.attacks[T.attackId].status !== 'flying')) setState(wctx, T, 'new', 'атака завершена');
      }
      // 2. reports
      await processSpyReports(wctx, env);
      await processCombatReports(wctx);
      // 3. discovery
      const origins = originList(wctx, env);
      if (!origins.length) { skip(wctx, 'Нет тел отправки (настройка «Планеты/луны отправки»)', 'noOrigins'); return { nextInMs: OGX.bot.randMs(OGX.bot.INTERVALS.m16), reason: 'no origins' }; }
      await discover(wctx, env, origins);
      await save('targets');
      // 4. candidates
      const per = num(wctx.cfg('targetsPerCycle'), 10);
      const maxAge = num(wctx.cfg('maxReportAgeMin'), 30) * 60000;
      const list = Object.values(M.targets).filter((T) => !(T.cooldownUntil && T.cooldownUntil > now));
      const toSpy = []; const toEval = [];
      for (const T of list) {
        if (T.state === 'probing' || T.state === 'attackFlying') continue;
        if (T.state === 'waitShips') { if (now >= (T.readyAt || 0)) toEval.push(T); continue; }
        const intel = OGX.bot.intel.get(T.key);
        // a report taken before our last attack shows resources that are gone: never plan from it
        const fresh = intel && intel.ts && now - intel.ts <= maxAge && intel.known && intel.known.ships && intel.known.defense && !(T.lastAttackAt && intel.ts < T.lastAttackAt);
        if (fresh && (T.state === 'reported' || T.state === 'new')) toEval.push(T);
        else if (['new', 'needMoreProbes', 'reported'].includes(T.state)) toSpy.push(T);
      }
      // evaluation (simulation) first: the attack plans
      const plans = [];
      for (const T of toEval.slice(0, per)) {
        if (T.state === 'waitShips') forgetShips(env, T.buildOrigin);   // the new ships are only on a fresh fleetTable
        const pr = await planAttack(wctx, env, T, origins);
        if (pr.skip) {
          const lootLow = pr.rejects && pr.rejects.length && pr.rejects.every((x) => x.loot);
          if (pr.skip === 'noIntel') { setState(wctx, T, 'new', 'нет доклада'); continue; }
          wctx.rec('sim', `[${T.coords}] вариантов нет: ${(pr.rejects || []).map((x) => x.why).join('; ')}`, { key: T.key, ok: false, rejects: pr.rejects || [] });
          const tr = (pr.rejects || []).filter((x) => x.transport).sort((a, b) => a.transport.short - b.transport.short)[0];
          if (tr) skip(wctx, `[${T.coords}] не хватает ${tr.transport.short} Ул. трансп.`, 'transport', { key: T.key, short: tr.transport.short, have: tr.transport.have, origin: tr.origin });
          // own ships away/too few (they come back): a short pause, not the 3 h «not suitable» one
          const shortage = !lootLow && pr.rejects && pr.rejects.length && pr.rejects.every((x) => x.shortage || x.loot);
          if (lootLow) poorTarget(wctx, env, T, pr);
          else if (shortage) {
            const why = ((pr.rejects || []).find((x) => x.shortage) || {}).why;
            cooldown(wctx, T, 'notSuitable', 'сейчас не хватает кораблей: ' + why, COOLDOWN.shortage); T.shortage = true;
            dbVerdict(T, 'shortage', 'не хватает своих кораблей: ' + why);
          } else {
            const why = (pr.rejects || []).map((x) => x.why)[0] || 'нет подходящего состава';
            cooldown(wctx, T, 'notSuitable', why);
            dbVerdict(T, 'tooStrong', 'защита сильнее флота: ' + why);
          }
          continue;
        }
        const P = pr.plan;
        P.alternatives = pr.alternatives;
        const summary = simSummary(P.sim, { ships: P.ships, missing: P.missing, speed: P.speed * 10, fuel: P.fuel, duration: P.duration, undefended: P.undefended, tried: P.tried, why: P.why, perHourMsu: Math.round(P.perHour), expected: P.planet, lootHalvesMsu: Math.round(P.lootMsu), lootExpMsu: Math.round(lootOf(P)), origin: P.origin.id });
        wctx.rec('sim', `[${T.coords}] ${P.why}`, Object.assign({ key: T.key, ok: true }, summary));
        T.plan = { ships: P.ships, missing: P.missing, perHour: Math.round(P.perHour), lootMsu: Math.round(lootOf(P)), lootHalvesMsu: Math.round(P.lootMsu), lootExpMsu: Math.round(lootOf(P)), net: Math.round(P.net), origin: P.origin.id, t: now };
        profitOf(T, P);
        plans.push({ T, P, intel: pr.intel });
      }
      plans.sort((a, b) => b.P.perHour - a.P.perHour);
      let stop = false;
      for (const item of plans) {
        if (stop) break;
        const { T, intel } = item;
        let P = item.P;
        // an earlier send of this cycle may have taken the ships of this plan: re-plan with what is left
        const left = (P.origin.ships || {});
        if (Object.entries(P.ships).some(([id, n]) => (+left[id] || 0) < n) && !Object.keys(P.missing).length) {
          const pr = await planAttack(wctx, env, T, origins);
          if (pr.skip) { skip(wctx, `[${T.coords}] после предыдущей отправки кораблей не хватает`, 'ships', { key: T.key, rejects: pr.rejects || [] }); continue; }
          P = pr.plan; P.alternatives = pr.alternatives;
          wctx.rec('sim', `[${T.coords}] пересчёт: ${P.why}`, Object.assign({ key: T.key, ok: true, replan: true }, simSummary(P.sim, { ships: P.ships, missing: P.missing, speed: P.speed * 10, undefended: P.undefended, tried: P.tried, why: P.why, expected: P.planet, lootHalvesMsu: Math.round(P.lootMsu), lootExpMsu: Math.round(lootOf(P)), origin: P.origin.id })));
        }
        if (Object.keys(P.missing).length) {
          if (T.state === 'waitShips') { skip(wctx, `[${T.coords}] корабли ещё не готовы`, 'waitShips', { key: T.key, missing: P.missing }); continue; }
          let b = { stop: false, skipped: 'buildOff', why: 'достройка выключена' };
          if (wctx.cfg('buildShips') === true) b = await buildMissing(wctx, env, T, P);
          if (b.stop) stop = true;
          if (!b.skipped) continue;
          // the build is not possible now (too long, no resources, shipyard busy): attack with own ships only when that pays, else
          // the target waits needFleetPauseH (no re-spy every 30 min for a plan that cannot fly)
          const fb = await planAttack(wctx, env, T, origins, { noBuild: true });
          if (fb.plan && !Object.keys(fb.plan.missing || {}).length) {
            P = fb.plan; P.alternatives = fb.alternatives;
            profitOf(T, P);
            wctx.rec('sim', `[${T.coords}] без достройки (${b.why}): ${P.why}`, Object.assign({ key: T.key, ok: true, noBuild: true }, simSummary(P.sim, { ships: P.ships, speed: P.speed * 10, undefended: P.undefended, why: P.why, expected: P.planet, lootHalvesMsu: Math.round(P.lootMsu), lootExpMsu: Math.round(lootOf(P)), origin: P.origin.id })));
          } else {
            const need = { ships: P.missing, origin: P.origin.coords, why: b.why, t: now };
            T.need = need;
            dbVerdict(T, 'needFleet', `нужно ещё ${shipsRu(P.missing)} на ${P.origin.coords} (${b.why}); добыча ≈ ${fmtN(lootOf(P))} МСУ за рейд`, { need });
            // a busy shipyard / resources still coming: short pause; a build that is simply too big: needFleetPauseH
            const pauseMs = ['shipyardBusy', 'buildCost'].includes(b.skipped) ? COOLDOWN.shortage : num(wctx.cfg('needFleetPauseH'), 6) * H;
            cooldown(wctx, T, 'needFleet', `нужно ещё ${shipsRu(P.missing)} (${b.why})`, pauseMs);
            continue;
          }
        }
        if (Object.keys(P.missing).length) continue;
        if (T.state === 'waitShips' && T.fuelReservation) { wctx.release(T.fuelReservation); T.fuelReservation = null; }
        const r = await attack(wctx, env, T, P, intel);
        if (r.stop) stop = true;
        if (r.respy && !toSpy.includes(T)) toSpy.push(T);
      }
      // espionage
      let spied = 0;
      if (!stop) {
        toSpy.sort((a, b) => (a.state === 'needMoreProbes' ? -1 : 0) - (b.state === 'needMoreProbes' ? -1 : 0) || OGX.fleet.gz.distance(origins[0].coords, a.coords) - OGX.fleet.gz.distance(origins[0].coords, b.coords));
        for (const T of toSpy) {
          if (spied >= per) break;
          if (T.dryAt && now - T.dryAt < 20 * 60000 && OGX.bot.isDryRun()) continue;
          const intel = OGX.bot.intel.get(T.key);
          const reason = T.state === 'needMoreProbes' ? 'в прошлом докладе не хватило секций' : intel ? 'доклад устарел (' + Math.round((now - (intel.ts || 0)) / 60000) + ' мин)' : 'новая цель';
          const r = await spyTarget(wctx, env, T, origins, { reason });
          spied++;
          await save('targets');
          if (r.stop) break;
        }
      }
      await save();
      // next run
      let next = now + OGX.bot.randMs(OGX.bot.INTERVALS.m6);
      for (const T of Object.values(M.targets)) {
        if (T.state === 'probing' && T.spy && T.spy.reportAt) next = Math.min(next, T.spy.reportAt);
        if (T.state === 'waitShips' && T.readyAt) next = Math.min(next, T.readyAt + rnd(5000, 15000));
      }
      for (const A of Object.values(M.attacks)) {
        if (A.status === 'flying' && !A.combatRead && wctx.core('readMessages') !== false) next = Math.min(next, A.arrival + rnd(5000, 15000));
        if (A.status === 'flying') next = Math.min(next, A.back + rnd(20000, 50000));
      }
      return { nextAt: Math.max(next, wctx.now() + 2000), reason: `целей ${Object.keys(M.targets).length}, атак ${farmFlying()}` };
    } finally { M.busy--; }
  }

  // ------------------------------------------------------------------ panel section
  function renderPanel(container) {
    const h = (...a) => OGX.dom.h(...a);
    const now = OGX.time.serverNow();
    const targets = Object.values(M.targets).sort((a, b) => (a.coords < b.coords ? -1 : 1));
    const attacks = Object.values(M.attacks).filter((A) => A.status === 'flying' || (A.status === 'recalled' && now - (A.recalledAt || 0) < H)).sort((a, b) => a.arrival - b.arrival);
    container.appendChild(h('div', { class: 'ogx-b-farm-sum' }, `Целей: ${targets.length}; атак в полёте: ${farmFlying()} из ${num(OGX.settings.get('botfarm.maxSlots'), 3)}` +
      (M.lastRun ? `; последний проход ${fmtT(M.lastRun)}` : '')));
    if (attacks.length) {
      container.appendChild(h('div', { class: 'ogx-b-bot-h' }, 'Атаки в полёте'));
      container.appendChild(h('table', { class: 'ogx-table ogx-b-farm-attacks' }, h('tbody', null,
        h('tr', null, h('th', null, 'Цель'), h('th', null, 'Флот'), h('th', null, 'Удар'), h('th', null, 'Сопровождение'), h('th', null, 'Статус')),
        attacks.map((A) => h('tr', { dataset: { battle: A.id } }, h('td', null, '[' + A.coords + ']'), h('td', null, shipsRu(A.ships)), h('td', null, fmtT(A.arrival)),
          h('td', null, escortRu(A.escort)), h('td', null, A.status === 'recalled' ? 'отозвана: ' + (A.recallWhy || '') : 'летит'))))));
    }
    // target database: the most profitable first, then the ones that need something (fleet / regrowth), then the rest
    const rank = (T) => { const v = (T.db && T.db.verdict && T.db.verdict.kind) || ''; return { farm: 0, needFleet: 1, shortage: 2, poor: 3, tooStrong: 4 }[v] ?? 5; };
    const perH = (T) => num(T.db && T.db.profit && T.db.verdict && T.db.verdict.kind === 'farm' ? T.db.profit.perHourMsu : 0);
    targets.sort((a, b) => rank(a) - rank(b) || perH(b) - perH(a) || (a.coords < b.coords ? -1 : 1));
    const cnt = {}; let lootAll = 0; let netAll = 0; let raidsAll = 0;
    for (const T of targets) { const v = (T.db && T.db.verdict && T.db.verdict.kind) || 'new'; cnt[v] = (cnt[v] || 0) + 1; if (T.db) { lootAll += num(T.db.totals && T.db.totals.lootMsu); netAll += dbNet(T); raidsAll += num(T.db.totals && T.db.totals.raids); } }
    container.appendChild(h('div', { class: 'ogx-b-bot-h' }, 'База целей'));
    container.appendChild(h('div', { class: 'ogx-b-farm-dbsum' },
      `Выгодных ${cnt.farm || 0}, нужен флот ${cnt.needFleet || 0}, не хватает кораблей ${cnt.shortage || 0}, бедных ${cnt.poor || 0}, сильная защита ${cnt.tooStrong || 0}, без оценки ${(cnt.new || 0)}. ` +
      `Рейдов ${raidsAll}, добыто ${fmtN(lootAll)} МСУ, итог после топлива и потерь ${fmtN(netAll)} МСУ` + (num(M.cal.attackLimit) > 0 ? `; лимит сервера ${M.cal.attackLimit} атак/сутки на цель` : '') + '.'));
    container.appendChild(h('button', { type: 'button', class: 'ogx-btn ogx-b-farm-csv', onClick: () => downloadCsv() }, 'Скачать базу целей (CSV)'));
    if (!targets.length) { container.appendChild(h('div', { class: 'ogx-b-bot-muted' }, 'Целей нет: включите «Сканировать галактику» (бот сам обойдёт всю вашу галактику) или откройте галактику вручную.')); return; }
    container.appendChild(h('table', { class: 'ogx-table ogx-b-farm-targets' }, h('tbody', null,
      h('tr', null, h('th', null, 'Цель'), h('th', null, 'Игрок'), h('th', null, 'Ресурсы'), h('th', null, 'Оборона / флот'), h('th', null, 'Рейд: добыча → итог'), h('th', null, 'Добыто'), h('th', null, 'Оценка'), h('th', null, 'Дальше')),
      targets.slice(0, 150).map((T) => {
        const d = T.db || {};
        const L = d.last;
        const age = L && L.ts ? Math.round((now - L.ts) / 60000) : null;
        const res = L ? fmtN(L.resMsu) + (age !== null ? ` (${age < 120 ? age + ' мин' : Math.round(age / 60) + ' ч'})` : '') + (d.prodMsuH ? `, +${fmtN(d.prodMsuH)}/ч` : '') : '—';
        const def = L ? (L.defMsu === null ? '?' : L.defMsu ? fmtN(L.defMsu) : 'нет') + ' / ' + (L.fleetMsu === null ? '?' : L.fleetMsu ? fmtN(L.fleetMsu) : 'нет') : '—';
        const pf = d.profit && d.verdict && ['farm', 'needFleet'].includes(d.verdict.kind) ? d.profit : null;
        const raid = pf ? `${fmtN(pf.lootMsu)} → ${fmtN(pf.netMsu)}` + (pf.roi ? ` (×${pf.roi})` : '') : (T.plan ? fmtN(T.plan.lootMsu) : '—');
        const tot = d.totals && d.totals.raids ? `${d.totals.raids} / ${fmtN(dbNet(T))}` : '—';
        const verdict = d.verdict ? d.verdict.text : stateRu(T.state);
        return h('tr', { dataset: { key: T.key, state: T.state, verdict: (d.verdict && d.verdict.kind) || '' } }, h('td', null, '[' + T.coords + ']'),
          h('td', null, (T.playerName || '?') + ' (' + (T.status || '') + (T.rank ? ', ' + T.rank : '') + ')'), h('td', null, res), h('td', null, def), h('td', null, raid), h('td', null, tot),
          h('td', null, verdict), h('td', null, nextRu(T, now)));
      }))));
  }
  /** CSV of the target database (one row per target; ; separated for Russian Excel). */
  function dbCsv() {
    const q = (v) => { const t = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const rows = [['coords', 'player', 'status', 'rank', 'state', 'verdict', 'report_time', 'res_msu', 'metal', 'crystal', 'deuterium', 'prod_msu_h', 'defense_msu', 'fleet_msu', 'defense',
      'raid_loot_msu', 'raid_net_msu', 'raid_per_hour_msu', 'raid_loss_msu', 'raid_fuel_msu', 'payback_x', 'raids', 'looted_msu', 'net_msu', 'spies', 'need_ships', 'next']];
    const now = OGX.time.serverNow();
    for (const T of Object.values(M.targets)) {
      const d = T.db || {}; const L = d.last || {}; const pf = d.profit || {}; const t = d.totals || {};
      rows.push([T.coords, T.playerName, T.status, T.rank, T.state, d.verdict ? d.verdict.text : '', L.ts ? new Date(L.ts).toISOString() : '', L.resMsu, L.res && L.res.metal, L.res && L.res.crystal, L.res && L.res.deuterium,
        d.prodMsuH, L.defMsu, L.fleetMsu, d.defense ? shipsRu(d.defense) : '', pf.lootMsu, pf.netMsu, pf.perHourMsu, pf.lossMsu, pf.fuelMsu, pf.roi, t.raids || 0, t.lootMsu || 0, T.db ? dbNet(T) : 0, t.spies || 0,
        T.need ? shipsRu(T.need.ships) : '', nextRu(T, now)]);
    }
    return '\ufeff' + rows.map((r) => r.map(q).join(';')).join('\r\n');
  }
  function downloadCsv() {
    const text = dbCsv();
    const name = 'ogx-farm-targets-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.csv';
    if (OGX.diaglib && OGX.diaglib.download) OGX.diaglib.download(name, text, 'text/csv');
  }
  function escortRu(E) {
    if (!E) return '—';
    return { off: 'выкл.', pending: 'ждёт ' + fmtT(E.at), sending: 'отправка', sent: 'зонды летят', reported: 'доклад прочитан', skipped: 'пропущено: ' + (E.why || ''), failed: 'ошибка: ' + (E.why || ''), noReport: 'нет доклада', dry: 'пробный режим' }[E.state] || E.state;
  }
  function nextRu(T, now) {
    if (T.cooldownUntil && T.cooldownUntil > now) return 'пауза до ' + fmtT(T.cooldownUntil) + (T.note ? ' — ' + T.note : '');
    if (T.state === 'probing') return 'доклад ≈ ' + fmtT(T.spy && T.spy.reportAt);
    if (T.state === 'waitShips') return 'корабли к ' + fmtT(T.readyAt);
    if (T.state === 'attackFlying') return 'атака летит';
    if (T.state === 'reported') return 'оценка / атака';
    if (T.state === 'gone') return 'нет в галактике';
    return T.note || 'шпионаж';
  }

  // ------------------------------------------------------------------ module
  OGX.module({
    name: NAME,
    title: 'Бот: фарм неактивных',
    settings: SETTINGS,
    async init(ctx) {
      M.ctx = ctx;
      if (!OGX.bot || !OGX.botSim) { ctx.log.warn('OGX.bot / OGX.botSim missing: botfarm idle'); return; }
      await OGX.bot.ready;
      await load(true);
      M.handle = OGX.bot.register({ id: NAME, module: NAME, prio: 'fleet', startJitter: [40000, 140000], wakeOn: ['bot:fleet-returned', 'bot:threat'], run: mainRun });
      M.escortHandle = OGX.bot.register({ id: NAME + ':escort', module: NAME, prio: 'deadline', startJitter: [3000, 8000], wakeOn: ['bot:fleet-returned'], run: escortRun });
      OGX.bot.onTimer('botfarm:escort', () => { if (M.escortHandle) M.escortHandle.wake('escort timer'); });
      // ship counts cached for the origin are stale once any own fleet lands there
      OGX.bus.on('bot:fleet-returned', (ev) => {
        const id = ev && ev.bodyKey ? +String(ev.bodyKey).replace(/^[pm]/, '') : 0;
        const t = OGX.time && OGX.time.serverNow ? OGX.time.serverNow() : Date.now();
        if (id > 0) markReturned(id, t);
        M.lastReturnAt = t;
      });
      OGX.bot.panelSection(NAME, renderPanel);
      // keep the panel's in-memory copy fresh in non-leader tabs
      ctx.store.subscribe('targets', (v) => { if (!M.busy && v && typeof v === 'object') M.targets = v; });
      ctx.store.subscribe('attacks', (v) => { if (!M.busy && v && typeof v === 'object') M.attacks = v; });
    },
  });

  // Pure helpers for tests (tests/gz-bot-mod-botfarm.test.js); not an API for other modules.
  OGX.botFarm = { _lib: { dbCsv, dbOf, dbReport, dbRaidSent, dbRaidResult, dbNet, attacks24, regrowAt, unitsMsu, profitOf, poorTarget, cachedSystem, discover, buildMissing, buildCheck, readCategory, escortSpy, isAttackLimit, handleRefusal, spyProbesSetting, inactiveClass, excluded, perHourOf, expectedAt, halvesOf, probesFor, intelFrom, defenderSide, isUndefended, attackerSide, reqMet, simSummary, keyOf, tgtOf, transportShort, storageFactorOf, transportCap, TRANSPORT, RECYCLER }, _M: M };
})(window.OGX);
